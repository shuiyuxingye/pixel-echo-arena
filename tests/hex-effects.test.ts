import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getShopItem } from '../src/game/data';
import {
  ATTRIBUTE_HEX_IDS,
  HEX_ATTRIBUTE_PARAMS,
  HexEffects,
  hexStatModifiers,
  isAttributeHexId,
  ownedHexStatModifiers,
} from '../src/game/hex-effects';
import { HexRun } from '../src/game/hex';
import { ConsumableEffects } from '../src/game/consumable-effects';
import { EconomyLedger, INITIAL_GOLD } from '../src/game/economy';
import { ProgressionSystem } from '../src/game/progression';
import {
  applyShopPriceModifiers,
  drawShopShelf,
  shopPrice,
} from '../src/game/shop-offer';
import {
  StatAggregator,
  type BaseStats,
} from '../src/game/stats';

const BASE: BaseStats = {
  maxHealth: 120,
  armor: 10,
  magicResist: 0,
  moveSpeed: 160,
};

function aggregatorFor(hexIds: readonly string[]): StatAggregator {
  const stats = new StatAggregator(BASE);
  stats.setSource('hex:attribute', ownedHexStatModifiers(hexIds));
  return stats;
}

function effectsWith(...hexIds: readonly string[]): HexEffects {
  const owned = new Set(hexIds);
  return new HexEffects({ has: (hexId) => owned.has(hexId) });
}

const SCENE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/game/scenes/ArenaScene.ts'),
  'utf8',
);

describe('属性类海克斯目录', () => {
  it('恰好覆盖 9 种 ID，且都存在于海克斯目录', () => {
    expect(ATTRIBUTE_HEX_IDS).toEqual([
      'H03',
      'H04',
      'H09',
      'H10',
      'H12',
      'H15',
      'H19',
      'H20',
      'H23',
    ]);
    for (const hexId of ATTRIBUTE_HEX_IDS) {
      expect(isAttributeHexId(hexId)).toBe(true);
      expect(HEX_ATTRIBUTE_PARAMS[hexId]).toBeDefined();
    }
    expect(isAttributeHexId('H01')).toBe(false);
    expect(isAttributeHexId('H99')).toBe(false);
  });

  it('非属性类海克斯不提供属性修正', () => {
    expect(hexStatModifiers('H01')).toEqual([]);
    expect(hexStatModifiers('H99')).toEqual([]);
  });
});

describe('9 种属性类海克斯的数值', () => {
  it('H03 攻击速度 +25%，最大生命 -20', () => {
    expect(hexStatModifiers('H03')).toEqual([
      { stat: 'attackSpeed', mode: 'percent', value: 0.25 },
      { stat: 'maxHealth', mode: 'flat', value: -20 },
    ]);
    const stats = aggregatorFor(['H03']);
    expect(stats.maxHealth).toBe(100);
    expect(stats.attackSpeedMultiplier).toBeCloseTo(1.25);
  });

  it('H04 伤害 +25%，移动速度 -8%', () => {
    expect(hexStatModifiers('H04')).toEqual([
      { stat: 'damage', mode: 'percent', value: 0.25 },
      { stat: 'moveSpeed', mode: 'percent', value: -0.08 },
    ]);
    const stats = aggregatorFor(['H04']);
    expect(stats.damageMultiplier).toBeCloseTo(1.25);
    expect(stats.moveSpeedMultiplier).toBeCloseTo(0.92);
    expect(stats.moveSpeed).toBeCloseTo(160 * 0.92);
  });

  it('H09 技能伤害 +30%，护甲 -12', () => {
    expect(hexStatModifiers('H09')).toEqual([
      { stat: 'skillDamage', mode: 'percent', value: 0.3 },
      { stat: 'armor', mode: 'flat', value: -12 },
    ]);
    const stats = aggregatorFor(['H09']);
    expect(stats.skillDamageMultiplier).toBeCloseTo(1.3);
    expect(stats.armor).toBe(-2);
  });

  it('H10 购物价格 -8%，击杀经验 -10%（非战斗属性）', () => {
    expect(hexStatModifiers('H10')).toEqual([]);
    const effects = effectsWith('H10');
    expect(effects.shopPriceModifiers).toEqual({ discountPercent: 8 });
    expect(effects.killXpMultiplier).toBeCloseTo(0.9);
  });

  it('H12 完成奖励 +15 金币，移动速度 -4%', () => {
    expect(hexStatModifiers('H12')).toEqual([
      { stat: 'moveSpeed', mode: 'percent', value: -0.04 },
    ]);
    const effects = effectsWith('H12');
    expect(effects.completionGoldBonus).toBe(15);
    expect(aggregatorFor(['H12']).moveSpeedMultiplier).toBeCloseTo(0.96);
  });

  it('H15 弹体直径 +35%，攻击速度 -8%', () => {
    expect(hexStatModifiers('H15')).toEqual([
      { stat: 'attackSpeed', mode: 'percent', value: -0.08 },
      { stat: 'projectileRadius', mode: 'percent', value: 0.35 },
    ]);
    const stats = aggregatorFor(['H15']);
    // 半径与直径同比例：直径 ×1.35 等价于半径 ×1.35。
    expect(stats.projectileRadiusMultiplier).toBeCloseTo(1.35);
    expect(stats.attackSpeedMultiplier).toBeCloseTo(0.92);
  });

  it('H19 伤害 +45%，最大生命 -25%，护甲 -10', () => {
    expect(hexStatModifiers('H19')).toEqual([
      { stat: 'maxHealth', mode: 'percent', value: -0.25 },
      { stat: 'damage', mode: 'percent', value: 0.45 },
      { stat: 'armor', mode: 'flat', value: -10 },
    ]);
    const stats = aggregatorFor(['H19']);
    expect(stats.maxHealth).toBe(90);
    expect(stats.damageMultiplier).toBeCloseTo(1.45);
    expect(stats.armor).toBe(0);
  });

  it('H20 最大生命 +40，每秒回复 0.5，伤害 -10%', () => {
    expect(hexStatModifiers('H20')).toEqual([
      { stat: 'maxHealth', mode: 'flat', value: 40 },
      { stat: 'damage', mode: 'percent', value: -0.1 },
    ]);
    const stats = aggregatorFor(['H20']);
    expect(stats.maxHealth).toBe(160);
    expect(stats.damageMultiplier).toBeCloseTo(0.9);
    const effects = effectsWith('H20');
    expect(effects.regenPerSecond).toBe(0.5);
  });

  it('H23 药剂效果 +30%，药剂价格 +15%（非战斗属性）', () => {
    expect(hexStatModifiers('H23')).toEqual([]);
    const effects = effectsWith('H23');
    expect(effects.potionModifiers).toEqual({
      effectMultiplier: 1.3,
      priceSurchargePercent: 15,
    });
    expect(effects.potionPriceModifiers).toEqual({ surchargePercent: 15 });
  });
});

describe('叠加规则与唯一层数', () => {
  it('同属性百分比与道具来源加算，只进入一次计算', () => {
    const stats = new StatAggregator(BASE);
    stats.setSource('hex:attribute', ownedHexStatModifiers(['H04']));
    stats.setSource('item:test', [
      { stat: 'damage', mode: 'percent', value: 0.2 },
    ]);
    expect(stats.damageMultiplier).toBeCloseTo(1.45);

    // 重复注册同一来源只替换，不累计成 1.25 + 1.25。
    stats.setSource('hex:attribute', ownedHexStatModifiers(['H04']));
    expect(stats.damageMultiplier).toBeCloseTo(1.45);
  });

  it('重复 ID 在修正列表里只计一次', () => {
    const modifiers = ownedHexStatModifiers(['H03', 'H03', 'H99']);
    expect(modifiers).toEqual(hexStatModifiers('H03'));
  });

  it('HexRun 最高 1 层：重复获得被拒绝，效果不叠加', () => {
    const run = new HexRun({ characterId: 'amiya', seed: 1 });
    const effects = new HexEffects({ has: (hexId) => run.has(hexId) });
    expect(effects.statModifiers).toEqual([]);
    expect(run.acquire('H03')).toBe(true);
    expect(run.acquire('H03')).toBe(false);
    expect(effects.ownedAttributeIds).toEqual(['H03']);
    expect(
      ownedHexStatModifiers(effects.ownedAttributeIds).filter(
        (modifier) => modifier.stat === 'attackSpeed',
      ),
    ).toEqual([{ stat: 'attackSpeed', mode: 'percent', value: 0.25 }]);
  });

  it('正负代价同时生效：H19 的伤害增益与生命/护甲代价', () => {
    const stats = aggregatorFor(['H19', 'H20']);
    // 聚合口径为 (基础 + flat) × 百分比：(120 + 40) × 0.75 = 120；
    // 伤害 1.45 − 0.10 = 1.35。
    expect(stats.maxHealth).toBeCloseTo(120);
    expect(stats.damageMultiplier).toBeCloseTo(1.35);
    expect(stats.armor).toBe(0);
  });
});

describe('实际入口：经验、奖励、价格与药剂', () => {
  it('H10 击杀经验 -10% 在经验球生成时生效（普通 4.5 / 精英 72 / 幼虫 0.9）', () => {
    const progression = new ProgressionSystem();
    progression.setXpGainMultiplier(effectsWith('H10').killXpMultiplier);
    expect(progression.spawnXpOrb(0, 0, false).value).toBeCloseTo(4.5);
    expect(progression.spawnXpOrb(0, 0, true).value).toBeCloseTo(72);
    expect(progression.spawnXpOrb(0, 0, false, 1).value).toBeCloseTo(0.9);

    // 未拥有 H10 时保持目录原值；非法倍率回退 1。
    const plain = new ProgressionSystem();
    expect(plain.spawnXpOrb(0, 0, false).value).toBe(5);
    plain.setXpGainMultiplier(Number.NaN);
    expect(plain.spawnXpOrb(0, 0, true).value).toBe(80);
  });

  it('H12 完成奖励 +15 金币：只对 1–17 波且每波一次', () => {
    const ledger = new EconomyLedger();
    expect(ledger.awardWaveCompletion(1, 1, 15)).toBe(36);
    expect(ledger.gold).toBe(INITIAL_GOLD + 36);
    expect(ledger.awardWaveCompletion(1, 1, 15)).toBe(0);

    // 与 I22 的完成奖励倍率叠加：floor(27 × 0.85 + 15) = 37。
    const discounted = new EconomyLedger();
    expect(discounted.awardWaveCompletion(3, 0.85, 15)).toBe(37);

    // 第 18 波没有完成奖励，H12 也不发放。
    const boss = new EconomyLedger();
    expect(boss.awardWaveCompletion(18, 1, 15)).toBe(0);
    expect(boss.gold).toBe(INITIAL_GOLD);
  });

  it('H10 购物价格 -8% 作用于道具、技能与药剂货架价', () => {
    const effects = effectsWith('H10');
    const modifiers = effects.shopPriceModifiers;
    const draw = drawShopShelf(
      () => 0.5,
      {
        shopWave: 7,
        characterId: 'vishdal',
        stacksOf: () => 0,
        priceModifiers: modifiers,
        potionOverride: 'P03',
        skillOverride: 'S01',
      },
    );
    const items = draw.offers.filter((offer) => offer.kind === 'item');
    expect(items.length).toBeGreaterThan(0);
    for (const offer of items) {
      const base = getShopItem(offer.id)?.basePrice ?? 0;
      expect(offer.price).toBe(
        applyShopPriceModifiers(shopPrice(base, 7), modifiers),
      );
    }
    const potion = draw.offers.find((offer) => offer.kind === 'potion');
    expect(potion?.price).toBe(26); // 24 × 1.15 = 28 波次价，再 × 0.92 = 25.76 → 26
    expect(draw.emergencyPotion.price).toBe(19); // 18 × 1.15 = 21，再 × 0.92 = 19.32 → 19
  });

  it('H23 药剂价格 +15% 与 H10 折扣按百分点合并一次', () => {
    const potionPrice = (hexIds: readonly string[]): number | undefined => {
      const effects = effectsWith(...hexIds);
      const draw = drawShopShelf(
        () => 0.5,
        {
          shopWave: 1,
          characterId: 'amiya',
          stacksOf: () => 0,
          priceModifiers: effects.shopPriceModifiers,
          potionPriceModifiers: effects.potionPriceModifiers,
          potionOverride: 'P03',
        },
      );
      return draw.offers.find((offer) => offer.kind === 'potion')?.price;
    };

    expect(potionPrice([])).toBe(24);
    expect(potionPrice(['H10'])).toBe(22); // 24 × 0.92
    expect(potionPrice(['H23'])).toBe(28); // 24 × 1.15 = 27.6 → 28
    expect(potionPrice(['H10', 'H23'])).toBe(26); // 净 +7%：25.68 → 26
  });

  it('H23 药剂效果 +30% 在购买时快照（P01 回复 39、P05 护盾 52）', () => {
    const effects = effectsWith('H23');
    const consumables = new ConsumableEffects();
    consumables.setModifiers(effects.potionModifiers);

    const p01 = consumables.purchase('P01', { maxHealth: 150 });
    expect(p01.ok).toBe(true);
    if (!p01.ok || p01.kind !== 'immediate') throw new Error('P01 应立即治疗');
    expect(p01.heal).toBeCloseTo(39);
    expect(p01.effectMultiplier).toBeCloseTo(1.3);

    const p05 = consumables.purchase('P05', { maxHealth: 150 });
    expect(p05.ok).toBe(true);
    expect(consumables.beginWave().shieldToGrant).toBeCloseTo(52);
  });

  it('H20 每秒回复 0.5 按整点结算，与步长无关', () => {
    const effects = effectsWith('H20');
    expect(effects.step(1)).toBe(0);
    expect(effects.step(1)).toBe(1);
    expect(effects.step(10)).toBe(5);

    const perFrame = effectsWith('H20');
    let healed = 0;
    for (let step = 0; step < 120; step += 1) healed += perFrame.step(1 / 60);
    expect(healed).toBe(1);

    effects.reset();
    expect(effects.snapshot().regenBudget).toBe(0);
    expect(effectsWith().step(10)).toBe(0);
  });
});

describe('场景接线', () => {
  it('属性来源走统一聚合入口', () => {
    expect(SCENE_SOURCE).toContain(
      "this.stats.setSource('hex:attribute', this.hexEffects.statModifiers)",
    );
  });

  it('H10/H23 的价格修正进入货架抽取', () => {
    expect(SCENE_SOURCE).toContain(
      'priceModifiers: this.hexEffects.shopPriceModifiers',
    );
    expect(SCENE_SOURCE).toContain(
      'potionPriceModifiers: this.hexEffects.potionPriceModifiers',
    );
  });

  it('H10 经验、H12 完成奖励、H23 药剂与 H20 回复都接到实际入口', () => {
    expect(SCENE_SOURCE).toContain(
      'this.progression.setXpGainMultiplier(this.hexEffects.killXpMultiplier)',
    );
    expect(SCENE_SOURCE).toContain('this.hexEffects.completionGoldBonus');
    expect(SCENE_SOURCE).toContain(
      'this.consumables.setModifiers(this.hexEffects.potionModifiers)',
    );
    expect(SCENE_SOURCE).toContain('this.hexEffects.step(stepSeconds)');
  });

  it('获得海克斯后立即重算属性与生命 HUD', () => {
    const start = SCENE_SOURCE.indexOf("choice.kind === 'hex'");
    const end = SCENE_SOURCE.indexOf("choice.kind === 'upgrade'", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const branch = SCENE_SOURCE.slice(start, end);
    expect(branch).toContain('this.syncBuildModifiers()');
    expect(branch).toContain('this.syncHealthHud()');
  });

  it('开发快照暴露属性海克斯的派生修正', () => {
    expect(SCENE_SOURCE).toContain('hexEffects: this.hexEffects.snapshot()');
  });
});
