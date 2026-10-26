import { describe, expect, it } from 'vitest';
import { DamageChainTracker } from '../src/game/damage-events';
import {
  CraftedEffects,
  R01_COUNTER_DAMAGE_CAP,
  R01_COUNTER_INTERVAL_SECONDS,
  R01_COUNTER_MAX_HEALTH_RATIO,
  R01_GROWTH_CAP,
  R01_GROWTH_EVERY_NORMAL_KILLS,
  R01_GROWTH_PER_ELITE_KILL,
  R01_GROWTH_PER_NORMAL_KILL,
  R02_DEATH_EXPLOSION_RATIO,
  R03_SIDE_PROJECTILE_COUNT,
  R03_SIDE_PROJECTILE_DAMAGE_RATIO,
  R04_REFUND_COOLDOWN_RATIO,
  R04_REFUND_EVERY_CASTS,
  R05_FLOWFORM_ATTACK_INTERVAL_SECONDS,
  R05_FLOWFORM_DAMAGE,
  R05_FLOWFORM_DURATION_SECONDS,
  R05_FLOWFORM_INTERVAL_SECONDS,
  R05_FLOWFORM_RANGE,
  R06_FIRST_ITEM_DISCOUNT_PERCENT,
  R06_FREE_REROLLS_PER_SHOP,
  R06_INTERMISSION_HEAL_MULTIPLIER,
  planR03SideShots,
  r01GrowthKind,
} from '../src/game/crafted-effects';

function effects(owned: readonly string[] = ['R01']): CraftedEffects {
  const set = new Set(owned);
  return new CraftedEffects({ has: (itemId) => set.has(itemId) });
}

describe('成品 R01–R03 数值', () => {
  it('与 02 §6 条三件合成逐项一致', () => {
    expect(R01_GROWTH_EVERY_NORMAL_KILLS).toBe(15);
    expect(R01_GROWTH_PER_NORMAL_KILL).toBe(3);
    expect(R01_GROWTH_PER_ELITE_KILL).toBe(15);
    expect(R01_GROWTH_CAP).toBe(120);
    expect(R01_COUNTER_INTERVAL_SECONDS).toBe(4);
    expect(R01_COUNTER_MAX_HEALTH_RATIO).toBe(0.05);
    expect(R01_COUNTER_DAMAGE_CAP).toBe(60);
    expect(R02_DEATH_EXPLOSION_RATIO).toBe(0.5);
    expect(R03_SIDE_PROJECTILE_COUNT).toBe(2);
    expect(R03_SIDE_PROJECTILE_DAMAGE_RATIO).toBe(0.4);
    expect(R04_REFUND_EVERY_CASTS).toBe(4);
    expect(R04_REFUND_COOLDOWN_RATIO).toBe(0.35);
    expect(R05_FLOWFORM_INTERVAL_SECONDS).toBe(12);
    expect(R05_FLOWFORM_DURATION_SECONDS).toBe(5);
    expect(R05_FLOWFORM_DAMAGE).toBe(14);
    expect(R05_FLOWFORM_ATTACK_INTERVAL_SECONDS).toBe(0.8);
    expect(R05_FLOWFORM_RANGE).toBe(230);
    expect(R06_FREE_REROLLS_PER_SHOP).toBe(1);
    expect(R06_FIRST_ITEM_DISCOUNT_PERCENT).toBe(20);
    expect(R06_INTERMISSION_HEAL_MULTIPLIER).toBe(0.5);
  });
});

describe('R01 击杀成长', () => {
  it('未拥有 R01 时不计数、不成长', () => {
    const crafted = effects([]);
    for (let index = 0; index < 15; index += 1) {
      expect(crafted.registerKill('normal')).toBe(0);
    }
    expect(crafted.registerKill('elite')).toBe(0);
    expect(crafted.r01NormalKills).toBe(0);
    expect(crafted.r01Growth).toBe(0);
  });

  it('每 15 个普通敌人 +3，前 14 个不给成长', () => {
    const crafted = effects();
    for (let index = 1; index < 15; index += 1) {
      expect(crafted.registerKill('normal')).toBe(0);
      expect(crafted.r01Growth).toBe(0);
    }
    expect(crafted.registerKill('normal')).toBe(3);
    expect(crafted.r01Growth).toBe(3);
    expect(crafted.r01NormalKills).toBe(15);
    // 第 16–29 个仍不成长，第 30 个再 +3。
    for (let index = 0; index < 14; index += 1) {
      expect(crafted.registerKill('normal')).toBe(0);
    }
    expect(crafted.registerKill('normal')).toBe(3);
    expect(crafted.r01Growth).toBe(6);
  });

  it('精英每次 +15，且不推进普通击杀计数', () => {
    const crafted = effects();
    expect(crafted.registerKill('elite')).toBe(15);
    expect(crafted.registerKill('elite')).toBe(15);
    expect(crafted.r01Growth).toBe(30);
    expect(crafted.r01NormalKills).toBe(0);
    for (let index = 0; index < 14; index += 1) crafted.registerKill('normal');
    // 普通计数仍从 0 开始：第 15 个普通击杀才 +3。
    expect(crafted.registerKill('normal')).toBe(3);
    expect(crafted.r01Growth).toBe(33);
  });

  it('成长封顶 +120，超出部分被截断', () => {
    const crafted = effects();
    for (let index = 0; index < 8; index += 1) {
      expect(crafted.registerKill('elite')).toBe(15);
    }
    expect(crafted.r01Growth).toBe(120);
    expect(crafted.registerKill('elite')).toBe(0);
    expect(crafted.registerKill('normal')).toBe(0);
    expect(crafted.r01Growth).toBe(120);
    // 普通击杀计数继续累计，但不再产生成长。
    for (let index = 0; index < 15; index += 1) crafted.registerKill('normal');
    expect(crafted.r01Growth).toBe(120);
  });

  it('接近上限时只补足剩余额度', () => {
    const crafted = effects();
    for (let index = 0; index < 7; index += 1) crafted.registerKill('elite');
    expect(crafted.r01Growth).toBe(105);
    // 再两次精英本应 +30，但只补到 120。
    expect(crafted.registerKill('elite')).toBe(15);
    expect(crafted.registerKill('elite')).toBe(0);
    expect(crafted.r01Growth).toBe(120);
  });

  it('宝箱、幼虫与 Boss 增援不参与成长', () => {
    const crafted = effects();
    expect(crafted.registerKill('excluded')).toBe(0);
    expect(crafted.r01Growth).toBe(0);
    expect(crafted.r01NormalKills).toBe(0);

    expect(
      r01GrowthKind({ enemyId: 'blob', kind: 'chest' }),
    ).toBe('excluded');
    expect(r01GrowthKind({ enemyId: 'larva' })).toBe('excluded');
    expect(
      r01GrowthKind({ enemyId: 'blob', summoned: true }),
    ).toBe('excluded');
    expect(
      r01GrowthKind({ enemyId: 'blob', elite: true, summoned: true }),
    ).toBe('excluded');
  });

  it('巢母本体计入普通敌人，精英优先于普通', () => {
    expect(r01GrowthKind({ enemyId: 'broodmother' })).toBe('normal');
    expect(r01GrowthKind({ enemyId: 'blob', elite: true })).toBe('elite');
    expect(r01GrowthKind({ enemyId: 'blob' })).toBe('normal');
    expect(r01GrowthKind({ enemyId: 'blob', kind: 'enemy' })).toBe('normal');
  });
});

describe('R01 受击反击', () => {
  it('未拥有 R01 时受击不蓄势，也消费不到伤害', () => {
    const crafted = effects([]);
    expect(crafted.notifyEnemyHit()).toBe(false);
    expect(crafted.consumeCounterBonus(200)).toBe(0);
  });

  it('首次受击蓄势，内置冷却内不再蓄势', () => {
    const crafted = effects();
    expect(crafted.notifyEnemyHit()).toBe(true);
    expect(crafted.r01CounterArmed).toBe(true);
    expect(crafted.r01CounterCooldownRemaining).toBe(
      R01_COUNTER_INTERVAL_SECONDS,
    );
    // 已蓄势时再次受击不重复触发，也不重置冷却。
    expect(crafted.notifyEnemyHit()).toBe(false);
  });

  it('下一发 J 取 min(最大生命 5%, 60) 并清空蓄势', () => {
    const crafted = effects();
    crafted.notifyEnemyHit();
    expect(crafted.consumeCounterBonus(1000)).toBeCloseTo(50, 12);
    expect(crafted.r01CounterArmed).toBe(false);
    expect(crafted.r01LastCounterDamage).toBeCloseTo(50, 12);
    // 已经消费过，再取为 0。
    expect(crafted.consumeCounterBonus(1000)).toBe(0);
  });

  it('最大生命很高时按 60 封顶，非法生命按 0', () => {
    const high = effects();
    high.notifyEnemyHit();
    expect(high.consumeCounterBonus(2000)).toBe(60);

    const low = effects();
    low.notifyEnemyHit();
    expect(low.consumeCounterBonus(0)).toBe(0);

    const invalid = effects();
    invalid.notifyEnemyHit();
    expect(invalid.consumeCounterBonus(Number.NaN)).toBe(0);

    const exactCap = effects();
    exactCap.notifyEnemyHit();
    expect(exactCap.consumeCounterBonus(R01_COUNTER_DAMAGE_CAP / 0.05)).toBe(60);
  });

  it('冷却按逻辑步衰减，4 秒后可再次蓄势', () => {
    const crafted = effects();
    crafted.notifyEnemyHit();
    crafted.consumeCounterBonus(200);

    crafted.step(1.5);
    expect(crafted.r01CounterCooldownRemaining).toBeCloseTo(2.5, 12);
    expect(crafted.notifyEnemyHit()).toBe(false);

    crafted.step(2.5);
    expect(crafted.r01CounterCooldownRemaining).toBe(0);
    expect(crafted.notifyEnemyHit()).toBe(true);
  });

  it('非法步长与超额步长不会把冷却变成负数', () => {
    const crafted = effects();
    crafted.notifyEnemyHit();
    crafted.step(Number.NaN);
    crafted.step(-1);
    expect(crafted.r01CounterCooldownRemaining).toBe(
      R01_COUNTER_INTERVAL_SECONDS,
    );
    crafted.step(99);
    expect(crafted.r01CounterCooldownRemaining).toBe(0);
  });
});

describe('R03 侧弹不递归', () => {
  it('未拥有 R03 时不给侧弹计划', () => {
    const chains = new DamageChainTracker();
    const parent = chains.beginNative('J');
    expect(planR03SideShots(false, chains, parent)).toBeNull();
  });

  it('原生 J 派生 2 枚 40% 侧弹，来源为 depth=1', () => {
    const chains = new DamageChainTracker();
    const parent = chains.beginNative('J');
    const plan = planR03SideShots(true, chains, parent);
    expect(plan).not.toBeNull();
    expect(plan?.count).toBe(2);
    expect(plan?.damageRatio).toBe(0.4);
    expect(plan?.source.origin).toBe('derived');
    expect(plan?.source.depth).toBe(1);
    expect(plan?.source.chainId).toBe(parent.chainId);
    expect(plan?.source.sourceId).toBe('R03');
  });

  it('已衍生的来源不能再生成侧弹', () => {
    const chains = new DamageChainTracker();
    const parent = chains.beginNative('J');
    const first = planR03SideShots(true, chains, parent);
    expect(first).not.toBeNull();
    // 侧弹命中时若再尝试派生，必须被拒绝。
    expect(planR03SideShots(true, chains, first!.source)).toBeNull();
    expect(
      chains.derive(first!.source, 'R03'),
    ).toBeNull();
  });
});

describe('R04 永昼回路冷却返还', () => {
  it('未拥有 R04 时不计数、不返还', () => {
    const crafted = effects([]);
    for (let index = 0; index < 8; index += 1) {
      expect(crafted.registerSkillCast()).toBe(false);
    }
    expect(crafted.r04CastCount).toBe(0);
    expect(crafted.r04CastsUntilRefund).toBe(0);
    crafted.recordCooldownRefund(3);
    expect(crafted.r04LastRefundSeconds).toBe(0);
    expect(crafted.r04RefundTotalSeconds).toBe(0);
  });

  it('每第 4 次成功施放触发一次返还，前三次不触发', () => {
    const crafted = effects(['R04']);
    expect(crafted.r04CastsUntilRefund).toBe(4);
    expect(crafted.registerSkillCast()).toBe(false);
    expect(crafted.registerSkillCast()).toBe(false);
    expect(crafted.registerSkillCast()).toBe(false);
    expect(crafted.r04CastsUntilRefund).toBe(1);
    expect(crafted.registerSkillCast()).toBe(true);
    expect(crafted.r04CastCount).toBe(4);
    expect(crafted.r04CastsUntilRefund).toBe(4);
    // 第 5–7 次继续重新计数，第 8 次再返还。
    for (let index = 0; index < 3; index += 1) {
      expect(crafted.registerSkillCast()).toBe(false);
    }
    expect(crafted.registerSkillCast()).toBe(true);
    expect(crafted.r04CastCount).toBe(8);
  });

  it('按施放技能的当前冷却 × 35% 记录返还，累计值可核对', () => {
    const crafted = effects(['R04']);
    // 12 秒冷却：第 4 次返还 4.2 秒。
    for (let index = 0; index < 4; index += 1) crafted.registerSkillCast();
    const first = 12 * R04_REFUND_COOLDOWN_RATIO;
    crafted.recordCooldownRefund(first);
    expect(crafted.r04LastRefundSeconds).toBeCloseTo(4.2, 10);
    expect(crafted.r04RefundTotalSeconds).toBeCloseTo(4.2, 10);
    // 不同技能按自己的冷却返还：6 秒 × 35% = 2.1 秒，累计 6.3 秒。
    for (let index = 0; index < 4; index += 1) crafted.registerSkillCast();
    crafted.recordCooldownRefund(6 * R04_REFUND_COOLDOWN_RATIO);
    expect(crafted.r04LastRefundSeconds).toBeCloseTo(2.1, 10);
    expect(crafted.r04RefundTotalSeconds).toBeCloseTo(6.3, 10);
    // 非正数不写入快照。
    crafted.recordCooldownRefund(0);
    crafted.recordCooldownRefund(-1);
    expect(crafted.r04LastRefundSeconds).toBeCloseTo(2.1, 10);
  });
});

describe('R05 潮生母巢小流形', () => {
  it('未拥有 R05 时不进入周期、不生成', () => {
    const crafted = effects([]);
    const result = crafted.stepFlowform(30, { x: 10, y: 20 });
    expect(result.active).toBe(false);
    expect(result.spawned).toBe(false);
    expect(crafted.r05FlowformSpawns).toBe(0);
    expect(crafted.r05FlowformTimerSeconds).toBe(R05_FLOWFORM_INTERVAL_SECONDS);
  });

  it('每 12 秒生成一只持续 5 秒的小流形，期间不再重复生成', () => {
    const crafted = effects(['R05']);
    expect(crafted.stepFlowform(11.9, { x: 0, y: 0 }).spawned).toBe(false);
    expect(crafted.r05FlowformActive).toBe(false);
    const spawned = crafted.stepFlowform(0.1, { x: 100, y: 50 });
    expect(spawned.spawned).toBe(true);
    expect(spawned.active).toBe(true);
    expect(spawned.remainingSeconds).toBe(R05_FLOWFORM_DURATION_SECONDS);
    expect(spawned.x).toBe(138);
    expect(spawned.y).toBe(64);
    expect(crafted.r05FlowformSpawns).toBe(1);
    expect(crafted.r05FlowformTimerSeconds).toBe(R05_FLOWFORM_INTERVAL_SECONDS);

    // 生成当步不补 tick；随后 4.8 秒内每 0.8 秒攻击一次，共 6 次。
    expect(spawned.ticks).toBe(0);
    const ticks = crafted.stepFlowform(4.8, { x: 100, y: 50 });
    expect(ticks.ticks).toBe(6);
    expect(ticks.active).toBe(true);
    expect(ticks.remainingSeconds).toBeCloseTo(0.2, 10);

    const expired = crafted.stepFlowform(0.2, { x: 100, y: 50 });
    expect(expired.active).toBe(false);
    expect(expired.ticks).toBe(0);
    expect(crafted.r05FlowformActive).toBe(false);
    // 同一次生成不会补出超过寿命的 tick。
    expect(crafted.stepFlowform(5, { x: 0, y: 0 }).ticks).toBe(0);
    expect(crafted.r05FlowformSpawns).toBe(1);
  });

  it('小流形跟随玩家位置，12 秒后再次生成并刷新寿命', () => {
    const crafted = effects(['R05']);
    crafted.stepFlowform(12, { x: 0, y: 0 });
    const moved = crafted.stepFlowform(1, { x: 300, y: 200 });
    expect(moved.x).toBe(338);
    expect(moved.y).toBe(214);
    // 再等 11 秒（本步累计 12 秒）生成第二只，寿命重新从 5 秒开始。
    const second = crafted.stepFlowform(11, { x: 300, y: 200 });
    expect(second.spawned).toBe(true);
    expect(second.remainingSeconds).toBe(R05_FLOWFORM_DURATION_SECONDS);
    expect(crafted.r05FlowformSpawns).toBe(2);
  });
});

describe('R06 命运交易所经济', () => {
  it('未拥有 R06 时没有免费重抽、首购折扣或恢复减半', () => {
    const crafted = effects([]);
    expect(crafted.freeRerollsPerShop).toBe(0);
    expect(crafted.firstItemDiscountPercent()).toBe(0);
    expect(crafted.consumeFirstItemDiscount()).toBe(0);
    expect(crafted.intermissionHealMultiplier).toBe(1);
  });

  it('每个商店 1 次免费重抽，首购折扣只消费一次，恢复倍率 0.5', () => {
    const crafted = effects(['R06']);
    expect(crafted.freeRerollsPerShop).toBe(1);
    expect(crafted.intermissionHealMultiplier).toBe(0.5);
    expect(crafted.firstItemDiscountPercent()).toBe(R06_FIRST_ITEM_DISCOUNT_PERCENT);
    // 只读查询不消费。
    expect(crafted.firstItemDiscountPercent()).toBe(20);
    expect(crafted.consumeFirstItemDiscount()).toBe(20);
    expect(crafted.r06FirstItemDiscountUsed).toBe(true);
    expect(crafted.firstItemDiscountPercent()).toBe(0);
    expect(crafted.consumeFirstItemDiscount()).toBe(0);
    expect(crafted.firstItemDiscountPercent()).toBe(0);
  });
});

describe('成品机制快照', () => {
  it('记录成长、蓄势、小爆炸与侧弹计数，reset 全部清零', () => {
    const crafted = effects(['R01', 'R02', 'R03']);
    for (let index = 0; index < 8; index += 1) crafted.registerKill('elite');
    crafted.notifyEnemyHit();
    crafted.consumeCounterBonus(600);
    crafted.recordDeathExplosions(2);
    crafted.recordSideBullets(4);
    crafted.recordDeathExplosions(0);
    crafted.recordSideBullets(-1);

    expect(crafted.snapshot()).toEqual({
      r01Growth: 120,
      r01NormalKills: 0,
      r01CounterArmed: false,
      r01CounterCooldownRemaining: R01_COUNTER_INTERVAL_SECONDS,
      r01LastCounterDamage: 30,
      r02DeathExplosions: 2,
      r03SideBullets: 4,
      r04CastCount: 0,
      r04CastsUntilRefund: 0,
      r04LastRefundSeconds: 0,
      r04RefundTotalSeconds: 0,
      r05FlowformTimerSeconds: R05_FLOWFORM_INTERVAL_SECONDS,
      r05FlowformActive: false,
      r05FlowformRemainingSeconds: 0,
      r05FlowformSpawns: 0,
      r06FirstItemDiscountUsed: false,
      r06FreeRerollsPerShop: 0,
      r06IntermissionHealMultiplier: 1,
    });

    crafted.reset();
    expect(crafted.snapshot()).toEqual({
      r01Growth: 0,
      r01NormalKills: 0,
      r01CounterArmed: false,
      r01CounterCooldownRemaining: 0,
      r01LastCounterDamage: 0,
      r02DeathExplosions: 0,
      r03SideBullets: 0,
      r04CastCount: 0,
      r04CastsUntilRefund: 0,
      r04LastRefundSeconds: 0,
      r04RefundTotalSeconds: 0,
      r05FlowformTimerSeconds: R05_FLOWFORM_INTERVAL_SECONDS,
      r05FlowformActive: false,
      r05FlowformRemainingSeconds: 0,
      r05FlowformSpawns: 0,
      r06FirstItemDiscountUsed: false,
      r06FreeRerollsPerShop: 0,
      r06IntermissionHealMultiplier: 1,
    });
  });
});
