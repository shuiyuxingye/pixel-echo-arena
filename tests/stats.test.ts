import { describe, expect, it } from 'vitest';
import { AttackTimer, HealthState, computeDamage } from '../src/game/combat';
import { getCharacter } from '../src/game/data';
import {
  ARMOR_MAX,
  ARMOR_MIN,
  ATTACK_SPEED_MAX,
  ATTACK_SPEED_MIN,
  COOLDOWN_REDUCTION_CAP,
  DAMAGE_MULTIPLIER_MIN,
  LIFESTEAL_CAP,
  LIFESTEAL_HEAL_PER_SECOND_CAP,
  MAGIC_RESIST_CAP,
  MIN_MAX_HEALTH,
  MOVE_SPEED_MAX,
  MOVE_SPEED_MIN,
  LifestealTracker,
  StatAggregator,
  applyHealingModifier,
  characterBaseStats,
  type BaseStats,
  type StatModifier,
} from '../src/game/stats';

function base(overrides: Partial<BaseStats> = {}): BaseStats {
  return {
    maxHealth: 120,
    armor: 10,
    magicResist: 0,
    moveSpeed: 160,
    ...overrides,
  };
}

function aggregator(overrides: Partial<BaseStats> = {}): StatAggregator {
  return new StatAggregator(base(overrides));
}

function percent(
  stat: StatModifier['stat'],
  value: number,
): StatModifier {
  return { stat, mode: 'percent', value };
}

describe('四职业基础值', () => {
  it('与 V0.2 01 §数值初值与上限一致', () => {
    const expected = {
      vishdal: { maxHealth: 120, armor: 10, magicResist: 0, moveSpeed: 160 },
      amiya: { maxHealth: 110, armor: 0, magicResist: 0.15, moveSpeed: 175 },
      saria: { maxHealth: 200, armor: 35, magicResist: 0.1, moveSpeed: 150 },
      muelsyse: { maxHealth: 125, armor: 5, magicResist: 0.1, moveSpeed: 175 },
    } as const;

    for (const [id, values] of Object.entries(expected)) {
      const character = getCharacter(id);
      expect(characterBaseStats(character)).toEqual(values);
      // 聚合器默认不添加任何来源时等于基础值。
      expect(new StatAggregator(characterBaseStats(character)).snapshot()).toMatchObject(
        values,
      );
    }
  });
});

describe('护甲与法抗边界', () => {
  it('物理伤害按 100/(100+护甲) 结算，护甲钳制到 −20–200', () => {
    expect(computeDamage(100, 'physical', 0, 0)).toBeCloseTo(100, 12);
    expect(computeDamage(100, 'physical', 10, 0)).toBeCloseTo(100 * (100 / 110), 12);
    expect(computeDamage(100, 'physical', ARMOR_MIN, 0)).toBeCloseTo(125, 12);
    expect(computeDamage(100, 'physical', ARMOR_MAX, 0)).toBeCloseTo(100 / 3, 12);

    // 超出边界的输入不会继续放大或缩小伤害。
    expect(computeDamage(100, 'physical', -500, 0)).toBeCloseTo(125, 12);
    expect(computeDamage(100, 'physical', 5000, 0)).toBeCloseTo(100 / 3, 12);
  });

  it('负护甲增加伤害，法抗上限为 60%', () => {
    expect(computeDamage(100, 'physical', -20, 0)).toBeGreaterThan(100);
    expect(computeDamage(100, 'magic', 0, MAGIC_RESIST_CAP)).toBeCloseTo(40, 12);
    expect(computeDamage(100, 'magic', 0, 0.9)).toBeCloseTo(40, 12);
    expect(computeDamage(100, 'magic', 0, -0.5)).toBeCloseTo(100, 12);
  });

  it('HealthState 同步护甲/法抗时使用同一钳制范围', () => {
    const health = new HealthState({ maxHealth: 100, armor: -80, magicResist: 0.9 });
    expect(health.armor).toBe(ARMOR_MIN);
    expect(health.magicResist).toBe(MAGIC_RESIST_CAP);

    health.setDefenses(999, -1);
    expect(health.armor).toBe(ARMOR_MAX);
    expect(health.magicResist).toBe(0);
  });
});

describe('属性聚合与上限', () => {
  it('同一属性的百分比加算，互不相关类别分别相乘', () => {
    const stats = aggregator();
    stats.setSource('item:A', [percent('damage', 0.1)]);
    stats.setSource('hex:B', [percent('damage', 0.2)]);
    stats.setSource('item:C', [percent('attackSpeed', 0.25)]);

    // 伤害的两个来源加算为 +30%，而不是 1.1 × 1.2。
    expect(stats.damageMultiplier).toBeCloseTo(1.3, 12);
    expect(stats.attackSpeedMultiplier).toBeCloseTo(1.25, 12);
    // 不同属性在战斗公式中相乘：1.3 × 1.25。
    expect(stats.damageMultiplier * stats.attackSpeedMultiplier).toBeCloseTo(1.625, 12);
  });

  it('伤害倍率最低 0.25', () => {
    const stats = aggregator();
    stats.setSource('debuff:all', [percent('damage', -0.9)]);
    expect(stats.damageMultiplier).toBe(DAMAGE_MULTIPLIER_MIN);
  });

  it('攻速倍率限制在 0.4–2.5', () => {
    const slow = aggregator();
    slow.setSource('debuff:slow', [percent('attackSpeed', -0.9)]);
    expect(slow.attackSpeedMultiplier).toBe(ATTACK_SPEED_MIN);

    const fast = aggregator();
    fast.setSource('buff:fast', [percent('attackSpeed', 5)]);
    expect(fast.attackSpeedMultiplier).toBe(ATTACK_SPEED_MAX);
    expect(fast.attackIntervalMultiplier).toBeCloseTo(1 / ATTACK_SPEED_MAX, 12);
  });

  it('移速倍率限制在 0.6–1.6', () => {
    const slow = aggregator();
    slow.setSource('item:heavy', [percent('moveSpeed', -0.8)]);
    expect(slow.moveSpeedMultiplier).toBe(MOVE_SPEED_MIN);
    expect(slow.moveSpeed).toBeCloseTo(160 * MOVE_SPEED_MIN, 12);

    const fast = aggregator();
    fast.setSource('item:boots', [percent('moveSpeed', 2)]);
    expect(fast.moveSpeedMultiplier).toBe(MOVE_SPEED_MAX);
    expect(fast.moveSpeed).toBeCloseTo(160 * MOVE_SPEED_MAX, 12);
  });

  it('冷却缩减上限 50%，法抗上限 60%', () => {
    const stats = aggregator();
    stats.setSource('item:cdr', [percent('cooldownReduction', 0.8)]);
    stats.setSource('item:mr', [{ stat: 'magicResist', mode: 'flat', value: 1 }]);

    expect(stats.cooldownReduction).toBe(COOLDOWN_REDUCTION_CAP);
    expect(stats.cooldownMultiplier).toBeCloseTo(0.5, 12);
    expect(stats.magicResist).toBe(MAGIC_RESIST_CAP);
  });

  it('最大生命不低于 40，且上限增加与百分比修正各只计算一次', () => {
    const stats = aggregator({ maxHealth: 120 });
    stats.setSource('penalty:health', [
      { stat: 'maxHealth', mode: 'flat', value: -200 },
    ]);
    expect(stats.maxHealth).toBe(MIN_MAX_HEALTH);

    const mixed = aggregator({ maxHealth: 120 });
    mixed.setSource('level', [{ stat: 'maxHealth', mode: 'flat', value: 15 }]);
    mixed.setSource('item:red', [percent('maxHealth', -0.25)]);
    mixed.setSource('hex:glass', [percent('maxHealth', -0.25)]);
    // 百分比先加算为 −50%，再乘到 (120 + 15) 上。
    expect(mixed.maxHealth).toBeCloseTo((120 + 15) * 0.5, 12);
  });

  it('总吸血比例上限 8%', () => {
    const stats = aggregator();
    stats.setSource('item:pump', [percent('lifesteal', 0.03)]);
    stats.setSource('hex:blood', [percent('lifesteal', 0.2)]);
    expect(stats.lifesteal).toBe(LIFESTEAL_CAP);
  });
});

describe('来源注册与基础值保护', () => {
  it('同一来源重复注册只应用一次；替换来源不会叠加旧值', () => {
    const stats = aggregator();
    stats.setSource('item:I02', [percent('damage', 0.15)]);
    stats.setSource('item:I02', [percent('damage', 0.15)]);
    expect(stats.damageMultiplier).toBeCloseTo(1.15, 12);

    stats.setSource('item:I02', [percent('damage', 0.3)]);
    expect(stats.damageMultiplier).toBeCloseTo(1.3, 12);

    expect(stats.removeSource('item:I02')).toBe(true);
    expect(stats.damageMultiplier).toBe(1);
  });

  it('内容模块只注册修正，不直接改写角色基础值', () => {
    const character = getCharacter('saria');
    const stats = new StatAggregator(characterBaseStats(character));
    stats.setSource('item:I01', [
      { stat: 'maxHealth', mode: 'flat', value: 25 },
      percent('moveSpeed', -0.03),
    ]);

    expect(character.maxHealth).toBe(200);
    expect(character.moveSpeed).toBe(150);
    expect(stats.baseStats.maxHealth).toBe(200);
    expect(stats.maxHealth).toBe(225);
    expect(stats.moveSpeed).toBeCloseTo(150 * 0.97, 12);
  });

  it('非法值与空来源按忽略处理', () => {
    const stats = aggregator();
    stats.setSource('weird', [
      { stat: 'damage', mode: 'percent', value: Number.NaN },
      { stat: 'attackSpeed', mode: 'percent', value: Number.POSITIVE_INFINITY },
    ]);
    expect(stats.damageMultiplier).toBe(1);
    expect(stats.attackSpeedMultiplier).toBe(1);
    expect(() => stats.setSource('', [])).toThrow();
  });
});

describe('生命增减与治疗边界', () => {
  it('提高最大生命不回复生命，降低时把当前生命钳制到新上限', () => {
    const health = new HealthState({ maxHealth: 120 });
    expect(health.applyDamage(30, 'true').applied).toBe(true);
    expect(health.health).toBe(90);

    health.increaseMaxHealth(20);
    expect(health.maxHealth).toBe(140);
    expect(health.health).toBe(90);

    health.setMaxHealth(60);
    expect(health.maxHealth).toBe(60);
    expect(health.health).toBe(60);

    // 提高上限同样不回血；只有明示治疗能回复。
    health.setMaxHealth(160);
    expect(health.maxHealth).toBe(160);
    expect(health.health).toBe(60);
    health.heal(20);
    expect(health.health).toBe(80);
  });

  it('明示治疗是唯一能让上限提升同时回血的入口', () => {
    const health = new HealthState({ maxHealth: 100 });
    health.applyDamage(50, 'true');
    health.increaseMaxHealth(20, 20);
    expect(health.maxHealth).toBe(120);
    expect(health.health).toBe(70);
  });

  it('非法最大生命值保持原上限', () => {
    const health = new HealthState({ maxHealth: 100 });
    health.setMaxHealth(Number.NaN);
    health.setMaxHealth(0);
    expect(health.maxHealth).toBe(100);
  });
});

describe('吸血与治疗效果修正', () => {
  it('按实际造成伤害与总比例结算', () => {
    const tracker = new LifestealTracker();
    expect(tracker.absorb(100, { lifesteal: 0.02 })).toBeCloseTo(2, 12);
    expect(tracker.healedThisSecond).toBeCloseTo(2, 12);
  });

  it('排除宝箱、无伤害命中与零比例', () => {
    const tracker = new LifestealTracker();
    expect(tracker.absorb(100, { lifesteal: 0.08, isChest: true })).toBe(0);
    expect(tracker.absorb(0, { lifesteal: 0.08 })).toBe(0);
    expect(tracker.absorb(-5, { lifesteal: 0.08 })).toBe(0);
    expect(tracker.absorb(100, { lifesteal: 0 })).toBe(0);
    expect(tracker.healedThisSecond).toBe(0);
  });

  it('总比例不超过 8%', () => {
    const tracker = new LifestealTracker();
    expect(tracker.absorb(100, { lifesteal: 0.5 })).toBeCloseTo(8, 12);
  });

  it('基础每秒治疗不超过 12，再应用治疗效果修正', () => {
    const tracker = new LifestealTracker();
    expect(tracker.absorb(1000, { lifesteal: 0.08 })).toBe(
      LIFESTEAL_HEAL_PER_SECOND_CAP,
    );
    // 同一秒内预算已耗尽。
    expect(tracker.absorb(1000, { lifesteal: 0.08 })).toBe(0);

    tracker.step(1);
    expect(tracker.healedThisSecond).toBe(0);
    // 先按 12 截断，再乘 50% 治疗修正。
    expect(
      tracker.absorb(1000, { lifesteal: 0.08, healingMultiplier: 0.5 }),
    ).toBeCloseTo(LIFESTEAL_HEAL_PER_SECOND_CAP * 0.5, 12);
  });

  it('每秒预算按逻辑秒重置，可跨多个半步累计', () => {
    const tracker = new LifestealTracker();
    expect(tracker.absorb(1000, { lifesteal: 0.08 })).toBe(12);
    tracker.step(0.5);
    expect(tracker.absorb(1000, { lifesteal: 0.08 })).toBe(0);
    tracker.step(0.5);
    expect(tracker.absorb(1000, { lifesteal: 0.08 })).toBe(12);
  });

  it('治疗效果修正非法时回退到 1，负值按 0', () => {
    expect(applyHealingModifier(10, Number.NaN)).toBe(10);
    expect(applyHealingModifier(10, -1)).toBe(0);
    expect(applyHealingModifier(0, 2)).toBe(0);
  });
});

describe('攻速接入攻击计时', () => {
  it('间隔倍率按聚合攻速缩放，非法值回到 1', () => {
    const timer = new AttackTimer(1);
    timer.setIntervalMultiplier(0.5);
    expect(timer.update(0.01, true)).toBe(true);
    expect(timer.cooldownRemaining).toBeCloseTo(0.5, 12);

    const fallback = new AttackTimer(1);
    fallback.setIntervalMultiplier(0);
    expect(fallback.update(0.01, true)).toBe(true);
    expect(fallback.cooldownRemaining).toBeCloseTo(1, 12);
  });
});
