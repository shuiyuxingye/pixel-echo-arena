import { describe, expect, it } from 'vitest';
import { HealthState } from '../src/game/combat';
import {
  HEX_LEVELS,
  LEVEL_HEAL_AMOUNT,
  LEVEL_HEALTH_BONUS,
  MAX_LEVEL,
  MIN_LEVEL,
  ProgressionSystem,
  XP_PER_ELITE_ENEMY,
  XP_PER_NORMAL_ENEMY,
  XP_PICKUP_RADIUS,
  isHexLevel,
  levelUpThreshold,
} from '../src/game/progression';

const PLAYER = { x: 0, y: 0 };

describe('等级阈值', () => {
  it('等级 1–14 的升级阈值为 50 + 15 × (n−1)，满级无下一级', () => {
    const expected = [50, 65, 80, 95, 110, 125, 140, 155, 170, 185, 200, 215, 230, 245];
    for (let level = MIN_LEVEL; level < MAX_LEVEL; level += 1) {
      expect(levelUpThreshold(level)).toBe(expected[level - 1]);
    }
    expect(levelUpThreshold(MAX_LEVEL)).toBe(Number.POSITIVE_INFINITY);
  });

  it('拒绝 1–15 之外的等级', () => {
    expect(() => levelUpThreshold(0)).toThrow();
    expect(() => levelUpThreshold(16)).toThrow();
    expect(() => levelUpThreshold(1.5)).toThrow();
  });

  it('海克斯选择只在 2/4/6/8/10/12/14 级出现', () => {
    expect(HEX_LEVELS).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(HEX_LEVELS).toHaveLength(7);
    for (let level = MIN_LEVEL; level <= MAX_LEVEL; level += 1) {
      expect(isHexLevel(level)).toBe(level % 2 === 0 && level <= 14);
    }
  });
});

describe('经验球', () => {
  it('普通敌人经验 5、精英 80', () => {
    const progression = new ProgressionSystem();
    const normal = progression.spawnXpOrb(0, 0, false);
    const elite = progression.spawnXpOrb(10, 0, true);
    expect(normal.value).toBe(XP_PER_NORMAL_ENEMY);
    expect(elite.value).toBe(XP_PER_ELITE_ENEMY);
    expect(normal.value).toBe(5);
    expect(elite.value).toBe(80);
  });

  it('吸取半径为 55：边界内吸取，边界外保留', () => {
    const progression = new ProgressionSystem();
    progression.spawnXpOrb(XP_PICKUP_RADIUS - 1, 0);
    progression.spawnXpOrb(XP_PICKUP_RADIUS, 0);
    progression.spawnXpOrb(XP_PICKUP_RADIUS + 1, 0);

    const collection = progression.step(PLAYER);
    expect(collection.orbs).toHaveLength(2);
    expect(collection.amount).toBe(10);
    expect(progression.orbCount).toBe(1);
    expect(progression.experience).toBe(10);
  });

  it('波末自动吸取全部剩余经验，不受距离限制', () => {
    const progression = new ProgressionSystem();
    progression.spawnXpOrb(1000, 1000, false);
    progression.spawnXpOrb(-1000, -1000, true);

    const collection = progression.collectAll();
    expect(collection.amount).toBe(85);
    expect(progression.orbCount).toBe(0);
    // 85 点经验：1→2 消耗 50，剩余 35。
    expect(progression.level).toBe(2);
    expect(progression.experience).toBe(35);
  });
});

describe('升级、溢出与满级', () => {
  it('达到阈值升级并保留溢出经验；只有海克斯等级排队选择', () => {
    const progression = new ProgressionSystem();
    const first = progression.addExperience(50);
    expect(first.levelUps).toBe(1);
    expect(first.hexChoices).toBe(1);
    expect(progression.level).toBe(2);
    expect(progression.experience).toBe(0);
    expect(progression.pendingLevelUps).toBe(1);

    // 2→3 需要 65；多出的 10 点保留，3 级不是海克斯等级。
    const second = progression.addExperience(75);
    expect(second.levelUps).toBe(1);
    expect(second.hexChoices).toBe(0);
    expect(progression.level).toBe(3);
    expect(progression.experience).toBe(10);
    expect(progression.pendingLevelUps).toBe(1);
  });

  it('一次获得多级经验时逐级排队，只对海克斯等级排队', () => {
    const progression = new ProgressionSystem();
    // 1→4 需要 50 + 65 + 80 = 195；2/4 级各一次海克斯选择。
    const gain = progression.addExperience(195);
    expect(gain.levelUps).toBe(3);
    expect(gain.hexChoices).toBe(2);
    expect(progression.level).toBe(4);
    expect(progression.pendingLevelUps).toBe(2);
    expect(progression.maxHealthBonus).toBe(3 * LEVEL_HEALTH_BONUS);

    expect(progression.consumeLevelUp()).toBe(true);
    expect(progression.pendingLevelUps).toBe(1);
    expect(progression.consumeLevelUp()).toBe(true);
    expect(progression.consumeLevelUp()).toBe(false);
  });

  it('满级 15 后不再产生升级与经验需求', () => {
    const progression = new ProgressionSystem();
    // 1→15 共需 50+65+…+245 = 2065。
    progression.addExperience(2065);
    expect(progression.level).toBe(MAX_LEVEL);
    expect(progression.pendingLevelUps).toBe(7);
    expect(progression.experience).toBe(0);
    expect(progression.isMaxLevel).toBe(true);
    expect(progression.experienceToNextLevel).toBe(Number.POSITIVE_INFINITY);

    const extra = progression.addExperience(999);
    expect(extra.levelUps).toBe(0);
    expect(progression.level).toBe(MAX_LEVEL);
    expect(progression.pendingLevelUps).toBe(7);
    expect(progression.experience).toBe(0);
  });

  it('每次升级最大生命 +5 并回复 5', () => {
    const health = new HealthState({ maxHealth: 110 });
    health.applyDamage(20, 'true');
    expect(health.health).toBe(90);

    // 一次升 2 级：上限 +10，回复 10（不超过新的上限）。
    health.increaseMaxHealth(2 * LEVEL_HEALTH_BONUS, 2 * LEVEL_HEAL_AMOUNT);
    expect(health.maxHealth).toBe(120);
    expect(health.health).toBe(100);

    health.increaseMaxHealth(LEVEL_HEALTH_BONUS, LEVEL_HEAL_AMOUNT);
    expect(health.maxHealth).toBe(125);
  });

  it('治疗不超过最大生命，死亡状态不因升级回复', () => {
    // 满血时升级：上限 +5、回复 5，生命随之到 105（AC：最大生命 +5 并回复 5）。
    const health = new HealthState({ maxHealth: 100 });
    health.increaseMaxHealth(5, 5);
    expect(health.maxHealth).toBe(105);
    expect(health.health).toBe(105);

    // 回复量超过缺口时封顶在（提升后的）最大生命。
    const nearFull = new HealthState({ maxHealth: 100 });
    nearFull.applyDamage(1, 'true');
    nearFull.increaseMaxHealth(5, 50);
    expect(nearFull.maxHealth).toBe(105);
    expect(nearFull.health).toBe(105);

    const dead = new HealthState({ maxHealth: 100 });
    dead.applyDamage(200, 'true');
    expect(dead.isDead).toBe(true);
    dead.increaseMaxHealth(5, 5);
    expect(dead.maxHealth).toBe(105);
    expect(dead.health).toBe(0);
  });
});

describe('I17 经验吸取半径倍率', () => {
  it('默认 55；倍率 1.4 时 77 内吸取，77 外保留', () => {
    const progression = new ProgressionSystem();
    expect(progression.pickupRadius).toBe(55);
    progression.setPickupRadiusMultiplier(1.4);
    expect(progression.pickupRadius).toBeCloseTo(77, 12);

    progression.spawnXpOrb(176.9, 0);
    progression.spawnXpOrb(177.1, 0);
    const collected = progression.step({ x: 100, y: 0 });
    expect(collected.orbs).toHaveLength(1);
    expect(progression.orbCount).toBe(1);
  });

  it('非法倍率回退到 1', () => {
    const progression = new ProgressionSystem();
    progression.setPickupRadiusMultiplier(0);
    expect(progression.pickupRadius).toBe(55);
    progression.setPickupRadiusMultiplier(Number.NaN);
    expect(progression.pickupRadius).toBe(55);
  });
});
