import { describe, expect, it } from 'vitest';
import { CONSUMABLE_LIST } from '../src/game/data/catalog';
import {
  CONSUMABLE_EFFECT_PARAMS,
  CONSUMABLE_IDS,
  ConsumableEffects,
  H23_POTION_EFFECT_PERCENT,
  H23_POTION_PRICE_PERCENT,
  TEMPORARY_BUFF_IDS,
  consumableModifiersForH23,
  isConsumableId,
  isTemporaryBuffId,
} from '../src/game/consumable-effects';
import { HealthState } from '../src/game/combat';
import { StatAggregator } from '../src/game/stats';

function aggregator(): StatAggregator {
  return new StatAggregator({
    maxHealth: 100,
    armor: 35,
    magicResist: 0,
    moveSpeed: 150,
  });
}

function withH23(effects: ConsumableEffects): ConsumableEffects {
  effects.setModifiers(consumableModifiersForH23(1));
  return effects;
}

describe('消耗品目录与数值', () => {
  it('8 种药剂与目录 ID 一一对应，且都配有效果参数', () => {
    expect(CONSUMABLE_IDS).toEqual([
      'P01',
      'P02',
      'P03',
      'P04',
      'P05',
      'P06',
      'P07',
      'P08',
    ]);
    expect(CONSUMABLE_LIST.map((entry) => entry.id)).toEqual([...CONSUMABLE_IDS]);
    expect(TEMPORARY_BUFF_IDS).toEqual([
      'P03',
      'P04',
      'P05',
      'P06',
      'P07',
      'P08',
    ]);
    for (const id of CONSUMABLE_IDS) {
      expect(isConsumableId(id)).toBe(true);
      expect(CONSUMABLE_EFFECT_PARAMS[id]).toBeDefined();
    }
    expect(isConsumableId('I01')).toBe(false);
    expect(isTemporaryBuffId('P01')).toBe(false);
    expect(isTemporaryBuffId('P05')).toBe(true);
  });

  it('P01 立即回复 30 生命，可重复购买且不超过生命上限', () => {
    const effects = new ConsumableEffects();
    for (let index = 0; index < 3; index += 1) {
      const result = effects.purchase('P01', { maxHealth: 100 });
      expect(result).toMatchObject({ ok: true, kind: 'immediate', heal: 30 });
    }
    const health = new HealthState({ id: 'player', maxHealth: 100, armor: 0 });
    health.heal(30);
    health.heal(30);
    health.heal(30);
    health.heal(30);
    expect(health.health).toBe(100);
  });

  it('P02 回复最大生命的 25%', () => {
    const effects = new ConsumableEffects();
    expect(effects.purchase('P02', { maxHealth: 120 })).toMatchObject({
      ok: true,
      kind: 'immediate',
      heal: 30,
    });
    expect(effects.purchase('P02', { maxHealth: 999 })).toMatchObject({
      heal: 249.75,
    });
  });

  it('H23 效果 +30% 与价格 +15% 只应用一次', () => {
    expect(H23_POTION_EFFECT_PERCENT).toBe(30);
    expect(H23_POTION_PRICE_PERCENT).toBe(15);
    expect(consumableModifiersForH23(0)).toEqual({
      effectMultiplier: 1,
      priceSurchargePercent: 0,
    });
    expect(consumableModifiersForH23(1)).toEqual({
      effectMultiplier: 1.3,
      priceSurchargePercent: 15,
    });
    // H23 唯一：重复层数不会叠成 1.6/1.69。
    expect(consumableModifiersForH23(2)).toEqual(
      consumableModifiersForH23(1),
    );

    const effects = withH23(new ConsumableEffects());
    const first = effects.purchase('P01', { maxHealth: 100 });
    expect(first.ok && first.kind === 'immediate' ? first.heal : 0).toBeCloseTo(
      39,
      6,
    );
    // 重复设置同一修正不会二次乘算。
    effects.setModifiers(consumableModifiersForH23(1));
    const second = effects.purchase('P01', { maxHealth: 100 });
    expect(second.ok && second.kind === 'immediate' ? second.heal : 0).toBeCloseTo(
      39,
      6,
    );
    const third = effects.purchase('P02', { maxHealth: 100 });
    expect(third.ok && third.kind === 'immediate' ? third.heal : 0).toBeCloseTo(
      32.5,
      6,
    );
  });
});

describe('P03–P08 下一波增益与购买上限', () => {
  it('P03 同一波最多 2 次，伤害 +12%/层，波末清除', () => {
    const effects = new ConsumableEffects();
    expect(effects.purchase('P03', { maxHealth: 100 })).toMatchObject({
      ok: true,
      kind: 'buff',
      stacks: 1,
      limit: 2,
    });
    expect(effects.purchase('P03', { maxHealth: 100 })).toMatchObject({
      ok: true,
      stacks: 2,
    });
    expect(effects.purchase('P03', { maxHealth: 100 })).toMatchObject({
      ok: false,
      reason: 'limit-reached',
      limit: 2,
      stacks: 2,
    });
    expect(effects.pendingCount('P03')).toBe(2);
    expect(effects.statModifiers()).toEqual([]);

    effects.beginWave();
    expect(effects.activeCount('P03')).toBe(2);
    expect(effects.pendingCount('P03')).toBe(0);
    const stats = aggregator();
    stats.setSource('potion:active', effects.statModifiers());
    expect(stats.damageMultiplier).toBeCloseTo(1.24, 6);

    effects.endWave();
    stats.setSource('potion:active', effects.statModifiers());
    expect(stats.damageMultiplier).toBe(1);
    expect(effects.activeCount('P03')).toBe(0);
  });

  it('P04 同一波最多 1 次，移速 +12%', () => {
    const effects = new ConsumableEffects();
    expect(effects.purchase('P04', { maxHealth: 100 }).ok).toBe(true);
    expect(effects.purchase('P04', { maxHealth: 100 })).toMatchObject({
      ok: false,
      reason: 'limit-reached',
    });
    effects.beginWave();
    const stats = aggregator();
    stats.setSource('potion:active', effects.statModifiers());
    expect(stats.moveSpeedMultiplier).toBeCloseTo(1.12, 6);
    effects.endWave();
    stats.setSource('potion:active', effects.statModifiers());
    expect(stats.moveSpeedMultiplier).toBe(1);
  });

  it('P05 同一波最多 2 次，波初授予 40/层护盾，进入商店清除剩余护盾', () => {
    const effects = new ConsumableEffects();
    expect(effects.purchase('P05', { maxHealth: 100 }).ok).toBe(true);
    expect(effects.purchase('P05', { maxHealth: 100 }).ok).toBe(true);
    expect(effects.purchase('P05', { maxHealth: 100 })).toMatchObject({
      ok: false,
      reason: 'limit-reached',
    });
    const start = effects.beginWave();
    expect(start).toEqual({ shieldToGrant: 80, shieldToRemove: 0 });
    expect(effects.potionShieldRemaining).toBe(80);
    expect(effects.clearPotionShield()).toBe(80);
    expect(effects.clearPotionShield()).toBe(0);
    expect(effects.potionShieldRemaining).toBe(0);
  });

  it('P05 上一波未进商店的剩余护盾在下一波开始前移除', () => {
    const effects = new ConsumableEffects();
    effects.purchase('P05', { maxHealth: 100 });
    effects.beginWave();
    expect(effects.beginWave()).toEqual({ shieldToGrant: 0, shieldToRemove: 40 });
  });

  it('P06 同一波最多 1 次，冷却缩减 +10% 且遵守 50% 总上限', () => {
    const effects = new ConsumableEffects();
    expect(effects.purchase('P06', { maxHealth: 100 }).ok).toBe(true);
    expect(effects.purchase('P06', { maxHealth: 100 })).toMatchObject({
      ok: false,
      reason: 'limit-reached',
    });
    effects.beginWave();
    const stats = aggregator();
    stats.setSource('other', [
      { stat: 'cooldownReduction', mode: 'percent', value: 0.45 },
    ]);
    stats.setSource('potion:active', effects.statModifiers());
    expect(stats.cooldownReduction).toBeCloseTo(0.5, 6);
  });

  it('P07 同一波最多 2 次，每秒回复 1/层并在波末停止', () => {
    const effects = new ConsumableEffects();
    expect(effects.purchase('P07', { maxHealth: 100 }).ok).toBe(true);
    expect(effects.purchase('P07', { maxHealth: 100 }).ok).toBe(true);
    expect(effects.purchase('P07', { maxHealth: 100 })).toMatchObject({
      ok: false,
      reason: 'limit-reached',
    });
    effects.beginWave();
    expect(effects.regenPerSecond).toBe(2);
    // 逐步推进 10 秒；按整点结算，共 20 点。
    let healed = 0;
    for (let step = 0; step < 600; step += 1) {
      healed += effects.step(1 / 60);
    }
    expect(healed).toBe(20);
    effects.endWave();
    expect(effects.regenPerSecond).toBe(0);
    expect(effects.step(1)).toBe(0);
  });

  it('P07 受 H23 影响时按 1.3 倍累计', () => {
    const effects = withH23(new ConsumableEffects());
    effects.purchase('P07', { maxHealth: 100 });
    effects.purchase('P07', { maxHealth: 100 });
    effects.beginWave();
    expect(effects.regenPerSecond).toBeCloseTo(2.6, 6);
    let healed = 0;
    for (let step = 0; step < 600; step += 1) {
      healed += effects.step(1 / 60);
    }
    expect(healed).toBe(26);
  });

  it('P08 同一波最多 1 次，攻速 +20% 与护甲 -8 同时生效并同时到期', () => {
    const effects = new ConsumableEffects();
    expect(effects.purchase('P08', { maxHealth: 100 }).ok).toBe(true);
    expect(effects.purchase('P08', { maxHealth: 100 })).toMatchObject({
      ok: false,
      reason: 'limit-reached',
    });
    effects.beginWave();
    const stats = aggregator();
    stats.setSource('potion:active', effects.statModifiers());
    expect(stats.attackSpeedMultiplier).toBeCloseTo(1.2, 6);
    expect(stats.armor).toBe(27);

    effects.endWave();
    stats.setSource('potion:active', effects.statModifiers());
    expect(stats.attackSpeedMultiplier).toBe(1);
    expect(stats.armor).toBe(35);
  });

  it('排队层数不会跨波泄漏，新的一波从零开始', () => {
    const effects = new ConsumableEffects();
    effects.purchase('P03', { maxHealth: 100 });
    effects.beginWave();
    expect(effects.activeCount('P03')).toBe(1);
    effects.endWave();
    expect(effects.activeCount('P03')).toBe(0);
    effects.beginWave();
    expect(effects.activeCount('P03')).toBe(0);
    effects.purchase('P03', { maxHealth: 100 });
    expect(effects.pendingCount('P03')).toBe(1);
  });
});

describe('永久道具隔离与快照', () => {
  it('波末清除只移除药剂临时来源，永久道具属性保持不变', () => {
    const effects = new ConsumableEffects();
    effects.purchase('P03', { maxHealth: 100 });
    effects.purchase('P08', { maxHealth: 100 });
    effects.beginWave();

    const stats = aggregator();
    stats.setSource('item:I01', [
      { stat: 'maxHealth', mode: 'flat', value: 25 },
    ]);
    stats.setSource('potion:active', effects.statModifiers());
    expect(stats.maxHealth).toBe(125);
    expect(stats.attackSpeedMultiplier).toBeCloseTo(1.2, 6);

    effects.endWave();
    stats.setSource('potion:active', effects.statModifiers());
    expect(stats.maxHealth).toBe(125);
    expect(stats.attackSpeedMultiplier).toBe(1);
    expect(stats.armor).toBe(35);
  });

  it('快照同时反映排队层数、生效层数与护盾/回复状态', () => {
    const effects = withH23(new ConsumableEffects());
    effects.purchase('P03', { maxHealth: 100 });
    effects.purchase('P05', { maxHealth: 100 });
    effects.purchase('P07', { maxHealth: 100 });
    const before = effects.snapshot();
    expect(before.pending).toEqual({ P03: 1, P05: 1, P07: 1 });
    expect(before.active).toEqual({});
    expect(before.effectMultiplier).toBe(1.3);
    expect(before.priceSurchargePercent).toBe(15);

    effects.beginWave();
    const active = effects.snapshot();
    expect(active.pending).toEqual({});
    expect(active.active).toEqual({ P03: 1, P05: 1, P07: 1 });
    expect(active.initialShield).toBe(52);
    expect(active.shieldRemaining).toBe(52);
    expect(active.activeDamagePercent).toBeCloseTo(0.156, 6);
    expect(active.regenPerSecond).toBeCloseTo(1.3, 6);

    effects.reset();
    expect(effects.snapshot().active).toEqual({});
    expect(effects.potionShieldRemaining).toBe(0);
  });
});
