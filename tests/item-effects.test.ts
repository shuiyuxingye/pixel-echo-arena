import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCharacter, getShopItem } from '../src/game/data';
import {
  ITEM_EFFECT_IDS,
  ITEM_EFFECT_PARAMS,
  ItemEffects,
  describeItemEffect,
  itemStatModifiers,
  previewItemCard,
  type ItemPreviewInput,
} from '../src/game/item-effects';
import {
  StatAggregator,
  characterBaseStats,
  type ComputedStats,
} from '../src/game/stats';

const ROOT = process.cwd();

interface RawItem {
  id: string;
  name: string;
  stack_cap: number;
  benefit: string;
  cost: string;
  rarity: string;
}

function catalogItems(): RawItem[] {
  const raw = JSON.parse(
    readFileSync(resolve(ROOT, 'docs/design/v0.2/data/catalog.json'), 'utf8'),
  ) as { items: RawItem[] };
  return raw.items;
}

function statsWith(itemId: string, stacks: number): ComputedStats {
  const stats = new StatAggregator(
    characterBaseStats(getCharacter('vishdal')),
  );
  stats.setSource(`item:${itemId}`, itemStatModifiers(itemId, stacks));
  return stats.snapshot();
}

function effectStack(stacks: Partial<Record<string, number>>): ItemEffects {
  return new ItemEffects({ stacksOf: (itemId) => stacks[itemId] ?? 0 });
}

function previewInput(overrides: Partial<ItemPreviewInput> = {}): ItemPreviewInput {
  return {
    maxHealth: 120,
    armor: 10,
    moveSpeed: 160,
    moveSpeedMultiplier: 1,
    attackSpeedMultiplier: 1,
    damageMultiplier: 1,
    directDamageMultiplier: 1,
    skillDamageMultiplier: 1,
    normalAttackDamageMultiplier: 1,
    cooldownReduction: 0,
    attackRange: 290,
    attackRangeMultiplier: 1,
    projectileDiameter: 18,
    projectileRadiusMultiplier: 1,
    healPerFiveSeconds: 0,
    lifesteal: 0,
    lifestealCapPerSecond: 0,
    stationaryDamageBonus: 0,
    skillDurationMultiplier: 1,
    skillCooldownMultiplier: 1,
    explosionRadius: 32,
    explosionRadiusMultiplier: 1,
    explosionDamageMultiplier: 1,
    damageOverTimeMultiplier: 1,
    xpPickupRadius: 55,
    killGoldMultiplier: 1,
    summonDamageMultiplier: 1,
    summonHealthMultiplier: 1,
    completionGoldMultiplier: 1,
    ...overrides,
  };
}

describe('I01–I24 目录与叠层', () => {
  it('24 件道具都有单层效果表，叠层上限与品质/收益/代价与 catalog.json 一致', () => {
    const raw = catalogItems();
    expect(ITEM_EFFECT_IDS).toHaveLength(24);
    for (const id of ITEM_EFFECT_IDS) {
      const item = getShopItem(id);
      const source = raw.find((entry) => entry.id === id);
      expect(item, id).toBeDefined();
      expect(source, id).toBeDefined();
      if (!item || !source) continue;
      expect(item.stackCap, id).toBe(source.stack_cap);
      expect(item.rarity, id).toBe(source.rarity);
      expect(item.benefit, id).toBe(source.benefit);
      expect(item.cost, id).toBe(source.cost);
      expect(ITEM_EFFECT_PARAMS[id], id).toBeDefined();
    }
  });

  it('稀有/史诗叠层上限与 AC 一致', () => {
    const caps: Record<string, number> = {
      I13: 3,
      I14: 1,
      I15: 3,
      I16: 3,
      I17: 3,
      I18: 1,
      I19: 3,
      I20: 3,
      I21: 1,
      I22: 2,
      I23: 1,
      I24: 1,
    };
    for (const [id, cap] of Object.entries(caps)) {
      expect(getShopItem(id)?.stackCap, id).toBe(cap);
    }
  });

  it('未知/零层不产生修正', () => {
    expect(itemStatModifiers('I99', 3)).toEqual([]);
    expect(itemStatModifiers('I01', 0)).toEqual([]);
    expect(itemStatModifiers('I01', Number.NaN)).toEqual([]);
  });
});

describe('I01–I12 正负效果按层生效', () => {
  it('I01 最大生命 +25 / 移速 −3%', () => {
    const one = statsWith('I01', 1);
    expect(one.maxHealth).toBe(145);
    expect(one.moveSpeedMultiplier).toBeCloseTo(0.97, 12);
    const three = statsWith('I01', 3);
    expect(three.maxHealth).toBe(195);
    expect(three.moveSpeedMultiplier).toBeCloseTo(0.91, 12);
  });

  it('I02 伤害 +15% / 攻速 −6%', () => {
    const one = statsWith('I02', 1);
    expect(one.damageMultiplier).toBeCloseTo(1.15, 12);
    expect(one.attackSpeedMultiplier).toBeCloseTo(0.94, 12);
    const three = statsWith('I02', 3);
    expect(three.damageMultiplier).toBeCloseTo(1.45, 12);
    expect(three.attackSpeedMultiplier).toBeCloseTo(0.82, 12);
  });

  it('I03 攻速 +18% / 伤害 −6%', () => {
    const one = statsWith('I03', 1);
    expect(one.attackSpeedMultiplier).toBeCloseTo(1.18, 12);
    expect(one.damageMultiplier).toBeCloseTo(0.94, 12);
    const three = statsWith('I03', 3);
    expect(three.attackSpeedMultiplier).toBeCloseTo(1.54, 12);
    expect(three.damageMultiplier).toBeCloseTo(0.82, 12);
  });

  it('I04 弹体直径 +20% / 射程 −10%', () => {
    const one = statsWith('I04', 1);
    expect(one.projectileRadiusMultiplier).toBeCloseTo(1.2, 12);
    expect(one.attackRangeMultiplier).toBeCloseTo(0.9, 12);
    const three = statsWith('I04', 3);
    expect(three.projectileRadiusMultiplier).toBeCloseTo(1.6, 12);
    expect(three.attackRangeMultiplier).toBeCloseTo(0.7, 12);
  });

  it('I05 射程 +15% / 移速 −2%', () => {
    const one = statsWith('I05', 1);
    expect(one.attackRangeMultiplier).toBeCloseTo(1.15, 12);
    expect(one.moveSpeedMultiplier).toBeCloseTo(0.98, 12);
    const three = statsWith('I05', 3);
    expect(three.attackRangeMultiplier).toBeCloseTo(1.45, 12);
    expect(three.moveSpeedMultiplier).toBeCloseTo(0.94, 12);
  });

  it('I06 护甲 +12 / 攻速 −5%', () => {
    const one = statsWith('I06', 1);
    expect(one.armor).toBe(22);
    expect(one.attackSpeedMultiplier).toBeCloseTo(0.95, 12);
    const three = statsWith('I06', 3);
    expect(three.armor).toBe(46);
    expect(three.attackSpeedMultiplier).toBeCloseTo(0.85, 12);
  });

  it('I07 技能伤害 +20% / J 普攻伤害 −8%', () => {
    const one = statsWith('I07', 1);
    expect(one.skillDamageMultiplier).toBeCloseTo(1.2, 12);
    expect(one.normalAttackDamageMultiplier).toBeCloseTo(0.92, 12);
    const three = statsWith('I07', 3);
    expect(three.skillDamageMultiplier).toBeCloseTo(1.6, 12);
    expect(three.normalAttackDamageMultiplier).toBeCloseTo(0.76, 12);
  });

  it('I08 冷却缩减 +8% / 最大生命 −10', () => {
    const one = statsWith('I08', 1);
    expect(one.cooldownReduction).toBeCloseTo(0.08, 12);
    expect(one.maxHealth).toBe(110);
    const three = statsWith('I08', 3);
    expect(three.cooldownReduction).toBeCloseTo(0.24, 12);
    expect(three.maxHealth).toBe(90);
  });

  it('I09 伤害 −4%，每 5 秒回复 4×层数', () => {
    const one = statsWith('I09', 1);
    expect(one.damageMultiplier).toBeCloseTo(0.96, 12);
    expect(effectStack({ I09: 1 }).regenPerFiveSeconds).toBe(4);
    expect(effectStack({ I09: 3 }).regenPerFiveSeconds).toBe(12);
  });

  it('I10 护甲 −5，吸血 2%/层，每秒上限 4/层', () => {
    const one = statsWith('I10', 1);
    expect(one.armor).toBe(5);
    expect(one.lifesteal).toBeCloseTo(0.02, 12);
    const effects = effectStack({ I10: 1 });
    expect(effects.lifesteal).toBeCloseTo(0.02, 12);
    expect(effects.lifestealCapPerSecond).toBe(4);
    const three = effectStack({ I10: 3 });
    expect(three.lifesteal).toBeCloseTo(0.06, 12);
    expect(three.lifestealCapPerSecond).toBe(12);
  });

  it('I11 移速 +10% / 护甲 −4', () => {
    const one = statsWith('I11', 1);
    expect(one.moveSpeedMultiplier).toBeCloseTo(1.1, 12);
    expect(one.armor).toBe(6);
    const three = statsWith('I11', 3);
    expect(three.moveSpeedMultiplier).toBeCloseTo(1.3, 12);
    expect(three.armor).toBe(-2);
  });

  it('I12 移速 −5%，静止 0.8 秒后伤害 +18%/层', () => {
    const one = statsWith('I12', 1);
    expect(one.moveSpeedMultiplier).toBeCloseTo(0.95, 12);
    const effects = effectStack({ I12: 1 });
    expect(effects.step(0.79, false).stationary).toBe(false);
    expect(effects.stationaryDamageBonus).toBe(0);
    expect(effects.step(0.01, false).stationary).toBe(true);
    expect(effects.stationaryDamageBonus).toBeCloseTo(0.18, 12);
    expect(effectStack({ I12: 3 }).stationaryDamageBonusAtStacks('I12', 3)).toBeCloseTo(
      0.54,
      12,
    );
  });
});

describe('I09/I10/I12 临时状态', () => {
  it('I09 每满 5 秒结算一次，跨多周期累计正确', () => {
    const effects = effectStack({ I09: 2 });
    expect(effects.step(4.9, false).regenHeal).toBe(0);
    expect(effects.step(0.1, false).regenHeal).toBe(8);
    expect(effects.regenElapsedSeconds).toBeCloseTo(0, 12);
    expect(effects.step(10.1, false).regenHeal).toBe(16);
    expect(effects.regenElapsedSeconds).toBeCloseTo(0.1, 12);
  });

  it('I10 按实际伤害 2% 转治疗，每秒上限 4/层，移动/重置后重新计时', () => {
    const effects = effectStack({ I10: 1 });
    expect(effects.absorbLifesteal(100)).toBeCloseTo(2, 12);
    expect(effects.absorbLifesteal(1000)).toBeCloseTo(2, 12);
    expect(effects.lifestealHealedThisSecond).toBeCloseTo(4, 12);
    effects.step(1, false);
    expect(effects.absorbLifesteal(1000)).toBeCloseTo(4, 12);
    effects.reset();
    expect(effects.absorbLifesteal(1000, 0.5)).toBeCloseTo(2, 12);
    expect(effects.absorbLifesteal(1000, 1, true)).toBe(0);

    const three = effectStack({ I10: 3 });
    expect(three.absorbLifesteal(1000)).toBeCloseTo(12, 12);
  });

  it('I12 移动立即清空静止计时，重新静止 0.8 秒后恢复', () => {
    const effects = effectStack({ I12: 2 });
    expect(effects.step(0.8, false).stationary).toBe(true);
    expect(effects.stationaryDamageBonus).toBeCloseTo(0.36, 12);
    expect(effects.step(0.016, true).stationary).toBe(false);
    expect(effects.stationarySeconds).toBe(0);
    expect(effects.step(0.8, false).stationary).toBe(true);
  });
});

describe('道具卡面实时预览', () => {
  it('I01 展示聚合后的当前生命/移速 → 购买后值', () => {
    const one = previewItemCard('I01', 0, previewInput());
    expect(one).not.toBeNull();
    expect(one?.previewed).toBe(true);
    expect(one?.benefit).toBe('最大生命 120 → 145');
    expect(one?.cost).toBe('移速 160 → 155.2');

    const stacked = previewItemCard(
      'I01',
      2,
      previewInput({
        maxHealth: 170,
        moveSpeed: 150.4,
        moveSpeedMultiplier: 0.94,
      }),
    );
    expect(stacked?.benefit).toBe('最大生命 170 → 195');
    expect(stacked?.cost).toBe('移速 150.4 → 145.6');
  });

  it('I02/I03 展示购买后的伤害与攻速实际值', () => {
    const i02 = previewItemCard(
      'I02',
      1,
      previewInput({ damageMultiplier: 1.15, attackSpeedMultiplier: 0.94 }),
    );
    expect(i02?.benefit).toBe('伤害 115% → 130%');
    expect(i02?.cost).toBe('攻速 94% → 88%');

    const i03 = previewItemCard(
      'I03',
      0,
      previewInput({ attackSpeedMultiplier: 1, damageMultiplier: 1 }),
    );
    expect(i03?.benefit).toBe('攻速 100% → 118%');
    expect(i03?.cost).toBe('伤害 100% → 94%');
  });

  it('I04/I05 展示弹体直径与射程的真实像素值', () => {
    const i04 = previewItemCard('I04', 0, previewInput());
    expect(i04?.benefit).toBe('弹体直径 18 → 21.6');
    expect(i04?.cost).toBe('射程 290 → 261');

    const i05 = previewItemCard('I05', 0, previewInput());
    expect(i05?.benefit).toBe('射程 290 → 333.5');
    expect(i05?.cost).toBe('移速 160 → 156.8');
  });

  it('I06/I08 展示护甲、冷却缩减与最大生命的实时值', () => {
    const i06 = previewItemCard('I06', 0, previewInput());
    expect(i06?.benefit).toBe('护甲 10 → 22');
    expect(i06?.cost).toBe('攻速 100% → 95%');

    const i08 = previewItemCard('I08', 0, previewInput());
    expect(i08?.benefit).toBe('冷却缩减 0% → 8%');
    expect(i08?.cost).toBe('最大生命 120 → 110');
  });

  it('I07 分别展示技能与 J 伤害，且不重复目录文案', () => {
    const preview = previewItemCard('I07', 0, previewInput());
    expect(preview?.benefit).toBe('技能伤害 100% → 120%');
    expect(preview?.cost).toBe('J 伤害 100% → 92%');
    expect(preview?.detail).toBe('技能伤害 100% → 120%；J 伤害 100% → 92%');
  });

  it('I09/I10/I12 展示周期回复、吸血与静止增伤的实际值', () => {
    const i09 = previewItemCard('I09', 0, previewInput());
    expect(i09?.benefit).toBe('每 5 秒回复 0 → 4');
    expect(i09?.cost).toBe('伤害 100% → 96%');

    const i10 = previewItemCard('I10', 0, previewInput());
    expect(i10?.benefit).toContain('吸血 0% → 2%');
    expect(i10?.benefit).toContain('每秒吸血上限 0 → 4');
    expect(i10?.cost).toBe('护甲 10 → 5');

    const i12 = previewItemCard('I12', 0, previewInput());
    expect(i12?.benefit).toBe('静止增伤 0% → 18%');
    expect(i12?.cost).toBe('移速 160 → 152');
  });

  it('上限钳制后显示真实可达值', () => {
    const i08 = previewItemCard(
      'I08',
      0,
      previewInput({ maxHealth: 45, cooldownReduction: 0.48 }),
    );
    expect(i08?.benefit).toBe('冷却缩减 48% → 50%');
    expect(i08?.cost).toBe('最大生命 45 → 40');
  });

  it('I01–I24 都使用实时预览；未知 ID 返回 null', () => {
    for (const id of ITEM_EFFECT_IDS) {
      const preview = previewItemCard(id, 0, previewInput());
      expect(preview, id).not.toBeNull();
      expect(preview?.previewed, id).toBe(true);
      expect(preview?.benefit.length, id).toBeGreaterThan(0);
      expect(preview?.cost.length, id).toBeGreaterThan(0);
    }
    expect(previewItemCard('I99', 0, previewInput())).toBeNull();
  });

  it('构筑面板摘要按层数汇总正负贡献', () => {
    expect(describeItemEffect('I01', 2)).toBe('最大生命 +50 / 移速 -6%');
    expect(describeItemEffect('I07', 1)).toBe('技能伤害 +20% / J 伤害 -8%');
    expect(describeItemEffect('I08', 1)).toBe('冷却缩减 +8% / 最大生命 -10');
    expect(describeItemEffect('I10', 1)).toContain('吸血 +2%（每秒上限 4）');
    expect(describeItemEffect('I99', 1)).toBe('');
  });
});

describe('I13–I24 正负效果按层生效', () => {
  it('I13 爆炸半径 +18% / 爆炸伤害 −5%', () => {
    const one = statsWith('I13', 1);
    expect(one.explosionRadiusMultiplier).toBeCloseTo(1.18, 12);
    expect(one.explosionDamageMultiplier).toBeCloseTo(0.95, 12);
    const three = statsWith('I13', 3);
    expect(three.explosionRadiusMultiplier).toBeCloseTo(1.54, 12);
    expect(three.explosionDamageMultiplier).toBeCloseTo(0.85, 12);
  });

  it('I14 额外非穿透 J 弹 1 枚 35% 伤害 / 攻速 −10%', () => {
    const one = statsWith('I14', 1);
    expect(one.attackSpeedMultiplier).toBeCloseTo(0.9, 12);
    const effects = effectStack({ I14: 1 });
    expect(effects.extraProjectileCount).toBe(1);
    expect(effects.extraProjectileDamageRatio).toBeCloseTo(0.35, 12);
    expect(effectStack({}).extraProjectileCount).toBe(0);
    expect(effectStack({}).extraProjectileDamageRatio).toBe(0);
  });

  it('I15 技能持续时间 +15% / 技能冷却 +5%', () => {
    const one = statsWith('I15', 1);
    expect(one.skillDurationMultiplier).toBeCloseTo(1.15, 12);
    expect(one.skillCooldownMultiplier).toBeCloseTo(1.05, 12);
    const three = statsWith('I15', 3);
    expect(three.skillDurationMultiplier).toBeCloseTo(1.45, 12);
    expect(three.skillCooldownMultiplier).toBeCloseTo(1.15, 12);
  });

  it('I16 持续伤害 +25% / 直接伤害 −5% 分键', () => {
    const one = statsWith('I16', 1);
    expect(one.damageOverTimeMultiplier).toBeCloseTo(1.25, 12);
    expect(one.directDamageMultiplier).toBeCloseTo(0.95, 12);
    // 直接伤害代价不再并入全局伤害倍率，持续通道不会同时吃 −5%。
    expect(one.damageMultiplier).toBeCloseTo(1, 12);
    const three = statsWith('I16', 3);
    expect(three.damageOverTimeMultiplier).toBeCloseTo(1.75, 12);
    expect(three.directDamageMultiplier).toBeCloseTo(0.85, 12);
    expect(three.damageMultiplier).toBeCloseTo(1, 12);
  });

  it('I17 经验吸取半径 +40%、击杀金币 +8% / 最大生命 −10', () => {
    const one = statsWith('I17', 1);
    expect(one.xpRadiusMultiplier).toBeCloseTo(1.4, 12);
    expect(one.killGoldMultiplier).toBeCloseTo(1.08, 12);
    expect(one.maxHealth).toBe(110);
    const three = statsWith('I17', 3);
    expect(three.xpRadiusMultiplier).toBeCloseTo(2.2, 12);
    expect(three.killGoldMultiplier).toBeCloseTo(1.24, 12);
    expect(three.maxHealth).toBe(90);
  });

  it('I18 受击后下次 J +60%（内置冷却 4 秒）/ 移速 −4%', () => {
    const one = statsWith('I18', 1);
    expect(one.moveSpeedMultiplier).toBeCloseTo(0.96, 12);
    const effects = effectStack({ I18: 1 });
    expect(effects.notifyEnemyHit()).toBe(true);
    expect(effects.isNextJBonusArmed).toBe(true);
    expect(effects.nextJBonus).toBeCloseTo(0.6, 12);
    // 已蓄势时不重复触发；内置冷却中也无法再蓄势。
    expect(effects.notifyEnemyHit()).toBe(false);
    expect(effects.consumeNextJBonus()).toBeCloseTo(0.6, 12);
    expect(effects.isNextJBonusArmed).toBe(false);
    expect(effects.notifyEnemyHit()).toBe(false);
    effects.step(3.9, false);
    expect(effects.notifyEnemyHit()).toBe(false);
    effects.step(0.2, false);
    expect(effects.notifyEnemyHit()).toBe(true);
    expect(effectStack({}).notifyEnemyHit()).toBe(false);
  });

  it('I19 召唤物伤害 +18% / 自身 J 伤害 −5%', () => {
    const one = statsWith('I19', 1);
    expect(one.summonDamageMultiplier).toBeCloseTo(1.18, 12);
    expect(one.normalAttackDamageMultiplier).toBeCloseTo(0.95, 12);
    const three = statsWith('I19', 3);
    expect(three.summonDamageMultiplier).toBeCloseTo(1.54, 12);
    expect(three.normalAttackDamageMultiplier).toBeCloseTo(0.85, 12);
  });

  it('I20 召唤物生命 +25%、每秒回复 1% / 自身最大生命 −10', () => {
    const one = statsWith('I20', 1);
    expect(one.summonHealthMultiplier).toBeCloseTo(1.25, 12);
    expect(one.maxHealth).toBe(110);
    const three = statsWith('I20', 3);
    expect(three.summonHealthMultiplier).toBeCloseTo(1.75, 12);
    expect(three.maxHealth).toBe(90);
    expect(ITEM_EFFECT_PARAMS.I20.summonRegenPercentPerSecond).toBeCloseTo(0.01, 12);
  });

  it('I21 每第 6 次 J 命中弹射 40% 法伤 / J 伤害 −5%', () => {
    const one = statsWith('I21', 1);
    expect(one.normalAttackDamageMultiplier).toBeCloseTo(0.95, 12);
    const effects = effectStack({ I21: 1 });
    expect(effects.ricochetDamageRatio).toBeCloseTo(0.4, 12);
    expect(effects.jHitsUntilRicochet).toBe(6);
    for (let hit = 1; hit <= 5; hit += 1) {
      expect(effects.registerJHit(), String(hit)).toBe(false);
    }
    expect(effects.registerJHit()).toBe(true);
    expect(effects.jHitCount).toBe(6);
    // 弹射伤害不会再调用 registerJHit；继续第 7–12 次命中才再次触发。
    for (let hit = 7; hit <= 11; hit += 1) {
      expect(effects.registerJHit(), String(hit)).toBe(false);
    }
    expect(effects.registerJHit()).toBe(true);
    expect(effectStack({}).registerJHit()).toBe(false);
  });

  it('I22 商店权重 +12 点 / 完成奖励金币 −15%，上限 2 层', () => {
    const one = statsWith('I22', 1);
    expect(one.completionGoldMultiplier).toBeCloseTo(0.85, 12);
    const two = statsWith('I22', 2);
    expect(two.completionGoldMultiplier).toBeCloseTo(0.7, 12);
    expect(ITEM_EFFECT_PARAMS.I22.shopWeightTransfer).toBe(12);
    expect(getShopItem('I22')?.stackCap).toBe(2);
  });

  it('I23 每波首次低血护盾 35 持续 5 秒 / 恢复效果 −10%', () => {
    const one = statsWith('I23', 1);
    expect(one.healingMultiplier).toBeCloseTo(0.9, 12);
    const effects = effectStack({ I23: 1 });
    expect(effects.tryTriggerLowHealthShield(37, 120)).toBe(0);
    expect(effects.tryTriggerLowHealthShield(36, 120)).toBe(35);
    expect(effects.lowHealthShieldUsedThisWave).toBe(true);
    // 同波第二次受击不再给盾。
    expect(effects.tryTriggerLowHealthShield(10, 120)).toBe(0);
    expect(effects.step(4.9, false).shieldExpired).toBe(0);
    expect(effects.step(0.2, false).shieldExpired).toBe(35);
    expect(effects.lowHealthShieldRemainingSeconds).toBe(0);
    // 下一波重新获得一次资格。
    effects.beginWave();
    expect(effects.lowHealthShieldUsedThisWave).toBe(false);
    expect(effects.tryTriggerLowHealthShield(30, 120)).toBe(35);
    expect(effectStack({}).tryTriggerLowHealthShield(1, 120)).toBe(0);
  });

  it('I24 每第 5 次爆炸追加 45% 小爆炸 / 爆炸技能冷却 +8%', () => {
    const one = statsWith('I24', 1);
    expect(one.explosionSkillCooldownMultiplier).toBeCloseTo(1.08, 12);
    expect(ITEM_EFFECT_PARAMS.I24.fissionEvery).toBe(5);
    expect(ITEM_EFFECT_PARAMS.I24.fissionDamagePercent).toBeCloseTo(0.45, 12);
  });
});

describe('I13–I24 卡面预览与构筑摘要', () => {
  it('I13/I14/I15 显示爆炸、额外弹与技能冷却的当前 → 购买后值', () => {
    const i13 = previewItemCard('I13', 0, previewInput());
    expect(i13?.benefit).toBe('爆炸半径 32 → 37.8');
    expect(i13?.cost).toBe('爆炸伤害 100% → 95%');

    const i14 = previewItemCard('I14', 0, previewInput());
    expect(i14?.benefit).toBe('额外 J 弹 0 → 1');
    expect(i14?.cost).toBe('攻速 100% → 90%');

    const i15 = previewItemCard('I15', 0, previewInput());
    expect(i15?.benefit).toBe('技能持续时间 100% → 115%');
    expect(i15?.cost).toBe('技能冷却 100% → 105%');
  });

  it('I16/I17/I18 显示持续伤害、经济收益与受击强化', () => {
    const i16 = previewItemCard('I16', 0, previewInput());
    expect(i16?.benefit).toBe('持续伤害 100% → 125%（需持续类技能）');
    expect(i16?.cost).toBe('直接伤害 100% → 95%');

    const i16WithSustained = previewItemCard(
      'I16',
      0,
      previewInput({ sustainedSkillIds: ['S01', 'S08'] }),
    );
    expect(i16WithSustained?.benefit).toBe(
      '持续伤害 100% → 125%（影响 S01 旋刃环、S08 重力井）',
    );

    const i17 = previewItemCard('I17', 0, previewInput());
    expect(i17?.benefit).toBe('经验吸取半径 55 → 77；击杀金币 100% → 108%');
    expect(i17?.cost).toBe('最大生命 120 → 110');

    const i18 = previewItemCard('I18', 0, previewInput());
    expect(i18?.benefit).toBe('受击后下次 J 增伤 0% → 60%');
    expect(i18?.cost).toBe('移速 160 → 153.6');
  });

  it('I19/I20/I21 显示召唤物、弹射与生命代价', () => {
    const i19 = previewItemCard('I19', 0, previewInput());
    expect(i19?.benefit).toBe('召唤物伤害 100% → 118%');
    expect(i19?.cost).toBe('J 伤害 100% → 95%');

    const i20 = previewItemCard('I20', 0, previewInput());
    expect(i20?.benefit).toBe('召唤物生命 100% → 125%；召唤物每秒回复 0% → 1%');
    expect(i20?.cost).toBe('最大生命 120 → 110');

    const i21 = previewItemCard('I21', 0, previewInput());
    expect(i21?.benefit).toBe('每 6 次 J 命中弹射 40% 法伤');
    expect(i21?.cost).toBe('J 伤害 100% → 95%');
  });

  it('I22/I23/I24 显示权重、低血护盾与裂变火药', () => {
    const i22 = previewItemCard('I22', 0, previewInput());
    expect(i22?.benefit).toBe('稀有/史诗权重 0 → 12');
    expect(i22?.cost).toBe('完成奖励金币 100% → 85%');

    const i23 = previewItemCard('I23', 0, previewInput());
    expect(i23?.benefit).toContain('低血护盾 0 → 35');
    expect(i23?.benefit).toContain('每波首次降至 30% 生命触发，持续 5 秒');
    expect(i23?.cost).toBe('恢复效果 100% → 90%');

    const i24 = previewItemCard('I24', 0, previewInput());
    expect(i24?.benefit).toBe('每 5 次爆炸追加 45% 伤害小爆炸');
    expect(i24?.cost).toBe('爆炸技能冷却 100% → 108%');
  });

  it('构筑面板摘要按层数汇总稀有/史诗贡献', () => {
    expect(describeItemEffect('I13', 1)).toBe('爆炸半径 +18% / 爆炸伤害 -5%');
    expect(describeItemEffect('I16', 1)).toBe(
      '持续伤害（需持续类技能） +25% / 直接伤害 -5%',
    );
    expect(
      describeItemEffect('I16', 1, { sustainedSkillIds: ['S04'] }),
    ).toBe('持续伤害（影响 S04 燃烧轨迹） +25% / 直接伤害 -5%');
    expect(describeItemEffect('I17', 2)).toBe(
      '经验吸取半径 +80% / 击杀金币 +16% / 最大生命 -20',
    );
    expect(describeItemEffect('I23', 1)).toBe(
      '每波首次降至 30% 生命获得 35 护盾 5 秒 / 恢复效果 -10%',
    );
    expect(describeItemEffect('I24', 1)).toBe(
      '每 5 次爆炸追加 +45% 伤害小爆炸 / 爆炸技能冷却 +8%',
    );
  });
});
