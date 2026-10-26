import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getFreeSkill, listFreeSkills } from '../src/game/data';
import {
  FREE_SKILL_FIRST_PURCHASE_SUBSIDY,
  FREE_SKILL_MAX_LEVEL,
  FreeSkillLoadout,
  freeSkillControlMultiplier,
  freeSkillRefund,
  freeSkillStrength,
  freeSkillUpgradePrice,
} from '../src/game/free-skills';
import { FREE_SKILL_S06_HEAL_AMOUNT } from '../src/game/free-skill-effects';
import { FreeSkillShop } from '../src/game/free-skill-shop';
import {
  FIRST_SHOP_SKILL_BASE_PRICE,
  ShopShelf,
  drawShopShelf,
  listFreeSkillCandidates,
  shopPrice,
} from '../src/game/shop-offer';
import { SeededRandom } from '../src/game/random';

function ledger(gold: number) {
  return {
    gold,
    addGold(amount: number) {
      this.gold += amount;
      return this.gold;
    },
    spendGold(amount: number) {
      if (amount > this.gold) return false;
      this.gold -= amount;
      return true;
    },
  };
}

function shelfWithSkill(skillId: string, shopWave = 1): ShopShelf {
  const random = new SeededRandom(20261021 + shopWave);
  return new ShopShelf(
    () => random.next(),
    {
      shopWave,
      characterId: 'vishdal',
      stacksOf: () => 0,
      skillOverride: skillId,
    },
  );
}

function skillOfferSlot(shelf: ShopShelf): number {
  const offer = shelf.offers.find((entry) => entry.kind === 'skill');
  if (!offer) throw new Error('测试货架没有技能格');
  return offer.slot;
}

describe('自由技能槽与升级', () => {
  it('空槽直接装备，重复装备同一技能被禁止', () => {
    const loadout = new FreeSkillLoadout();
    expect(loadout.firstEmptySlot()).toBe('U');
    expect(loadout.equip('U', 'S06', 45)).toBe(true);
    expect(loadout.slotAt('U')).toEqual({ id: 'S06', level: 1, paidTotal: 45 });
    expect(loadout.slotOf('S06')).toBe('U');
    expect(loadout.equip('I', 'S06', 45)).toBe(false);
    expect(loadout.firstEmptySlot()).toBe('I');
    expect(loadout.equip('I', 'S01', 35)).toBe(true);
    expect(loadout.isFull()).toBe(true);
  });

  it('同名升级最高 3 级，实付累计且强度/控制倍率符合规则', () => {
    const loadout = new FreeSkillLoadout();
    loadout.equip('U', 'S06', 45);
    expect(loadout.upgrade('S06', 42)).toBe(true);
    expect(loadout.slotAt('U')).toEqual({ id: 'S06', level: 2, paidTotal: 87 });
    expect(loadout.upgrade('S06', 63)).toBe(true);
    expect(loadout.slotAt('U')).toEqual({ id: 'S06', level: 3, paidTotal: 150 });
    expect(loadout.upgrade('S06', 999)).toBe(false);
    expect(FREE_SKILL_MAX_LEVEL).toBe(3);
    expect(freeSkillStrength(1)).toBe(1);
    expect(freeSkillStrength(2)).toBe(1.2);
    expect(freeSkillStrength(3)).toBe(1.45);
    expect(freeSkillControlMultiplier(1)).toBe(1);
    expect(freeSkillControlMultiplier(2)).toBe(1.2);
    expect(freeSkillControlMultiplier(3)).toBe(1.25);
  });

  it('满槽替换返回旧技能并保留其累计实付', () => {
    const loadout = new FreeSkillLoadout();
    loadout.setSlot('U', { id: 'S06', level: 2, paidTotal: 87 });
    loadout.setSlot('I', { id: 'S02', level: 1, paidTotal: 70 });
    const old = loadout.replace('U', 'S03', 85);
    expect(old).toEqual({ id: 'S06', level: 2, paidTotal: 87 });
    expect(loadout.slotAt('U')).toEqual({ id: 'S03', level: 1, paidTotal: 85 });
    expect(loadout.slotOf('S06')).toBeNull();
    expect(freeSkillRefund(old?.paidTotal ?? 0)).toBe(34);
  });

  it('冷却独立、波初清空且受聚合冷却缩减影响', () => {
    const loadout = new FreeSkillLoadout();
    loadout.equip('U', 'S06', 45);
    loadout.equip('I', 'S01', 70);
    const first = loadout.cast('U');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.cooldownSeconds).toBe(16);
    expect(loadout.cooldownRemaining('U')).toBe(16);
    expect(loadout.cooldownRemaining('I')).toBe(0);
    const blocked = loadout.cast('U');
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.reason).toBe('cooldown');
    loadout.step(10);
    expect(loadout.cooldownRemaining('U')).toBeCloseTo(6, 9);
    loadout.setCooldownMultiplier(0.5);
    loadout.resetForWaveStart();
    const second = loadout.cast('U');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.cooldownSeconds).toBe(8);
  });

  it('返还剩余冷却不会低于 0，空槽/已就绪不返还', () => {
    const loadout = new FreeSkillLoadout();
    loadout.equip('U', 'S06', 45);
    expect(loadout.reduceCooldown('U', 5)).toBe(0);
    const cast = loadout.cast('U');
    expect(cast.ok).toBe(true);
    if (!cast.ok) return;
    // R04 的 35%：16 秒 × 35% = 5.6 秒，剩余 10.4 秒。
    const refunded = loadout.reduceCooldown('U', cast.cooldownSeconds * 0.35);
    expect(refunded).toBeCloseTo(5.6, 10);
    expect(loadout.cooldownRemaining('U')).toBeCloseTo(10.4, 10);
    // 超过剩余冷却时只扣到 0，不会变成负数。
    expect(loadout.reduceCooldown('U', 100)).toBeCloseTo(10.4, 10);
    expect(loadout.cooldownRemaining('U')).toBe(0);
    expect(loadout.reduceCooldown('I', 5)).toBe(0);
  });

  it('空槽施法返回 empty，不进入冷却', () => {
    const loadout = new FreeSkillLoadout();
    const result = loadout.cast('I');
    expect(result).toEqual({ ok: false, reason: 'empty', cooldownRemaining: 0 });
    expect(loadout.cooldownRemaining('I')).toBe(0);
  });

  it('H01 免费首施不进冷却，可立即再次施放并进入正常冷却', () => {
    const loadout = new FreeSkillLoadout();
    loadout.equip('U', 'S01', 70);
    const free = loadout.cast('U', { skipCooldown: true });
    expect(free.ok).toBe(true);
    if (!free.ok) return;
    expect(free.cooldownSeconds).toBe(0);
    expect(loadout.cooldownRemaining('U')).toBe(0);
    const next = loadout.cast('U');
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.cooldownSeconds).toBe(12);
    expect(loadout.cooldownRemaining('U')).toBe(12);
  });

  it('H08 冷却银行按倍率缩减本次冷却，并钳制到合法区间', () => {
    const loadout = new FreeSkillLoadout();
    loadout.equip('U', 'S01', 70);
    loadout.equip('I', 'S02', 70);
    loadout.setCooldownMultiplier(0.5);
    const reduced = loadout.cast('U', { cooldownScale: 0.7 });
    expect(reduced.ok).toBe(true);
    if (!reduced.ok) return;
    // 12 秒 × 0.5 冷却缩减 × 0.7 银行 = 4.2 秒。
    expect(reduced.cooldownSeconds).toBeCloseTo(4.2, 9);
    loadout.resetForWaveStart();
    const clamped = loadout.cast('I', { cooldownScale: 2 });
    expect(clamped.ok).toBe(true);
    if (!clamped.ok) return;
    // 非法倍率按 1 处理（上限 1），不会放大冷却。
    expect(clamped.cooldownSeconds).toBe(7);
  });
});

describe('自由技能价格', () => {
  it('升级价为当前波价格的 60%/90% 向上取整', () => {
    expect(freeSkillUpgradePrice(70, 2)).toBe(42);
    expect(freeSkillUpgradePrice(70, 3)).toBe(63);
    expect(freeSkillUpgradePrice(71, 2)).toBe(43);
    expect(freeSkillUpgradePrice(71, 3)).toBe(64);
    expect(freeSkillUpgradePrice(1, 2)).toBe(1);
    expect(() => freeSkillUpgradePrice(Number.NaN, 2)).toThrow();
  });

  it('第一商店只抽基础 70 金币档技能，保证实付 45 的补贴价', () => {
    const candidates = listFreeSkillCandidates(1);
    expect(candidates.length).toBeGreaterThan(0);
    for (const skill of candidates) {
      expect(skill.basePrice).toBe(FIRST_SHOP_SKILL_BASE_PRICE);
    }
    for (let seed = 1; seed <= 20; seed += 1) {
      const random = new SeededRandom(seed);
      const draw = drawShopShelf(() => random.next(), {
        shopWave: 1,
        characterId: 'vishdal',
        stacksOf: () => 0,
      });
      const skill = draw.offers.find((offer) => offer.kind === 'skill');
      expect(skill).toBeDefined();
      expect(skill?.price).toBe(70);
      expect(getFreeSkill(skill?.id ?? '')?.basePrice).toBe(70);
    }
  });

  it('第一商店首购补贴只使用一次且不与升级价叠加', () => {
    const loadout = new FreeSkillLoadout();
    const gold = ledger(500);
    const firstShelf = shelfWithSkill('S04', 1);
    const firstShop = new FreeSkillShop({
      shelf: firstShelf,
      gold,
      skills: loadout,
      shopWave: 1,
    });
    const slot = skillOfferSlot(firstShelf);
    const quote = firstShop.quote(slot);
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.action).toBe('equip');
    expect(quote.targetSlot).toBe('U');
    expect(quote.price).toBe(70 - FREE_SKILL_FIRST_PURCHASE_SUBSIDY);
    expect(quote.price).toBe(45);
    expect(quote.subsidized).toBe(true);
    const bought = firstShop.purchase(slot);
    expect(bought.ok).toBe(true);
    expect(gold.gold).toBe(455);
    expect(loadout.firstPurchaseSubsidyUsed).toBe(true);

    // 同一第一商店再抽一个技能：补贴已用，恢复原价。
    const secondShelf = shelfWithSkill('S01', 1);
    const secondShop = new FreeSkillShop({
      shelf: secondShelf,
      gold,
      skills: loadout,
      shopWave: 1,
    });
    const secondQuote = secondShop.quote(skillOfferSlot(secondShelf));
    expect(secondQuote.ok).toBe(true);
    if (!secondQuote.ok) return;
    expect(secondQuote.price).toBe(70);
    expect(secondQuote.subsidized).toBe(false);

    // 同名升级按当前波价格 60% 计算，不享受首购补贴。
    const upgradeShelf = shelfWithSkill('S04', 1);
    const upgradeShop = new FreeSkillShop({
      shelf: upgradeShelf,
      gold,
      skills: loadout,
      shopWave: 1,
    });
    const upgradeQuote = upgradeShop.quote(skillOfferSlot(upgradeShelf));
    expect(upgradeQuote.ok).toBe(true);
    if (!upgradeQuote.ok) return;
    expect(upgradeQuote.action).toBe('upgrade');
    expect(upgradeQuote.level).toBe(2);
    expect(upgradeQuote.price).toBe(42);
    expect(upgradeQuote.subsidized).toBe(false);
  });

  it('满槽替换展示旧技能信息并按实付总额 40% 回收', () => {
    const loadout = new FreeSkillLoadout();
    loadout.setSlot('U', { id: 'S06', level: 2, paidTotal: 87 });
    loadout.setSlot('I', { id: 'S02', level: 1, paidTotal: 70 });
    // 首购补贴已在别处使用；替换价回到当前波基础价。
    loadout.markFirstPurchaseSubsidyUsed();
    const gold = ledger(500);
    const shelf = shelfWithSkill('S03', 1);
    const shop = new FreeSkillShop({ shelf, gold, skills: loadout, shopWave: 1 });
    const quote = shop.quote(skillOfferSlot(shelf), 'U');
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.action).toBe('replace');
    expect(quote.replaced).toEqual({
      id: 'S06',
      name: '治疗脉冲',
      level: 2,
      cooldownSeconds: 16,
      paidTotal: 87,
      refund: 34,
    });
    expect(quote.refund).toBe(34);
    expect(quote.price).toBe(85);
    expect(quote.netGold).toBe(34 - 85);

    const bought = shop.purchase(skillOfferSlot(shelf), 'U');
    expect(bought.ok).toBe(true);
    expect(gold.gold).toBe(500 - 85 + 34);
    expect(loadout.slotAt('U')).toEqual({ id: 'S03', level: 1, paidTotal: 85 });
    expect(loadout.slotOf('S06')).toBeNull();
  });

  it('两槽已满且未选择替换槽时拒绝购买；重复装备改为升级', () => {
    const loadout = new FreeSkillLoadout();
    loadout.setSlot('U', { id: 'S06', level: 1, paidTotal: 45 });
    loadout.setSlot('I', { id: 'S02', level: 1, paidTotal: 70 });
    const gold = ledger(500);
    const shelf = shelfWithSkill('S03', 1);
    const shop = new FreeSkillShop({ shelf, gold, skills: loadout, shopWave: 1 });
    const full = shop.quote(skillOfferSlot(shelf));
    expect(full.ok).toBe(false);
    if (full.ok) return;
    expect(full.reason).toBe('slots-full');

    const sameShelf = shelfWithSkill('S06', 1);
    const sameShop = new FreeSkillShop({
      shelf: sameShelf,
      gold,
      skills: loadout,
      shopWave: 1,
    });
    const upgrade = sameShop.quote(skillOfferSlot(sameShelf), 'I');
    expect(upgrade.ok).toBe(true);
    if (!upgrade.ok) return;
    expect(upgrade.action).toBe('upgrade');
    expect(upgrade.targetSlot).toBe('U');
    // S06 基础价 80：2 级升级价为 ceil(80 × 60%) = 48。
    expect(upgrade.price).toBe(48);
  });

  it('三级满级后同名技能不再可购买', () => {
    const loadout = new FreeSkillLoadout();
    loadout.setSlot('U', { id: 'S06', level: 3, paidTotal: 150 });
    const gold = ledger(500);
    const shelf = shelfWithSkill('S06', 1);
    const shop = new FreeSkillShop({ shelf, gold, skills: loadout, shopWave: 1 });
    const quote = shop.quote(skillOfferSlot(shelf));
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(quote.reason).toBe('max-level');
  });

  it('金币不足不扣款、不改槽位，差额可读', () => {
    const loadout = new FreeSkillLoadout();
    const gold = ledger(20);
    const shelf = shelfWithSkill('S01', 1);
    const shop = new FreeSkillShop({ shelf, gold, skills: loadout, shopWave: 1 });
    const quote = shop.quote(skillOfferSlot(shelf));
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.affordable).toBe(false);
    expect(quote.shortfall).toBe(25);
    const bought = shop.purchase(skillOfferSlot(shelf));
    expect(bought.ok).toBe(false);
    if (bought.ok) return;
    expect(bought.reason).toBe('insufficient-gold');
    expect(gold.gold).toBe(20);
    expect(loadout.slotAt('U')).toBeNull();
  });

  it('后续商店按完整目录抽取，价格使用当前波系数', () => {
    const random = new SeededRandom(77);
    const draw = drawShopShelf(() => random.next(), {
      shopWave: 9,
      characterId: 'vishdal',
      stacksOf: () => 0,
    });
    const skill = draw.offers.find((offer) => offer.kind === 'skill');
    expect(skill).toBeDefined();
    expect(getFreeSkill(skill?.id ?? '')).toBeDefined();
    expect(skill?.price).toBe(shopPrice(getFreeSkill(skill?.id ?? '')?.basePrice ?? 0, 9));
    expect(listFreeSkills().length).toBe(12);
    expect(FREE_SKILL_S06_HEAL_AMOUNT).toBe(30);
  });
});

describe('U/I 场景接线', () => {
  it('默认键位、波初重置、施法门禁与 E06 复施都挂到同一入口', () => {
    const settings = readFileSync(
      resolve(import.meta.dirname, '../src/game/settings.ts'),
      'utf8',
    );
    expect(settings).toContain("skillU: 'KeyU'");
    expect(settings).toContain("skillI: 'KeyI'");

    const scene = readFileSync(
      resolve(import.meta.dirname, '../src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    expect(scene).toContain("if (action === 'skillU')");
    expect(scene).toContain("if (action === 'skillI')");
    expect(scene).toContain('this.freeSkills.resetForWaveStart()');
    expect(scene).toContain('this.freeSkills.step(stepSeconds)');
    expect(scene).toContain('this.coreEffects.registerSkillCast(slot)');
    expect(scene).toContain('this.coreEffects.consumeSkillEcho()');
    expect(scene).toContain('private castFreeSkill(');
    expect(scene).toContain('this.freeSkillShop = new FreeSkillShop(');
    expect(scene).toContain('this.purchaseShopSlot(offer.slot, op.slot)');
    // 施法输入统一经过 canCastCombatSkills，波末与商店内不施法。
    const gateIndex = scene.indexOf('if (!canCastCombatSkills(this.runState.phase)) return;');
    const castIndex = scene.indexOf("if (action === 'skillU')");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(castIndex).toBeGreaterThan(gateIndex);
  });

  it('S06 治疗脉冲无召唤物时仍直接治疗玩家，并治疗附近召唤物', () => {
    const scene = readFileSync(
      resolve(import.meta.dirname, '../src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    expect(scene).toContain("definition.id === 'S06'");
    expect(scene).toContain('resolveHealingPulse(');
    expect(scene).toContain('form.healSummon(');
    expect(scene).toContain('this.playerHealth.heal(');
  });
});
