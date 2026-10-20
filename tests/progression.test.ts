import { describe, expect, it } from 'vitest';
import { HealthState } from '../src/game/combat';
import {
  LEVEL_HEAL_AMOUNT,
  LEVEL_HEALTH_BONUS,
  MAX_LEVEL,
  MIN_LEVEL,
  ProgressionSystem,
  XP_PER_ELITE_ENEMY,
  XP_PER_NORMAL_ENEMY,
  XP_PICKUP_RADIUS,
  levelUpThreshold,
} from '../src/game/progression';

const PLAYER = { x: 0, y: 0 };

describe('等级阈值', () => {
  it('等级 1–8 的升级阈值为 40 + 20 × (n−1)，满级无下一级', () => {
    const expected = [40, 60, 80, 100, 120, 140, 160, 180];
    for (let level = MIN_LEVEL; level < MAX_LEVEL; level += 1) {
      expect(levelUpThreshold(level)).toBe(expected[level - 1]);
    }
    expect(levelUpThreshold(MAX_LEVEL)).toBe(Number.POSITIVE_INFINITY);
  });

  it('拒绝 1–9 之外的等级', () => {
    expect(() => levelUpThreshold(0)).toThrow();
    expect(() => levelUpThreshold(10)).toThrow();
    expect(() => levelUpThreshold(1.5)).toThrow();
  });
});

describe('经验球', () => {
  it('普通敌人经验 5、精英 25', () => {
    const progression = new ProgressionSystem();
    const normal = progression.spawnXpOrb(0, 0, false);
    const elite = progression.spawnXpOrb(10, 0, true);
    expect(normal.value).toBe(XP_PER_NORMAL_ENEMY);
    expect(elite.value).toBe(XP_PER_ELITE_ENEMY);
    expect(normal.value).toBe(5);
    expect(elite.value).toBe(25);
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
    expect(collection.amount).toBe(30);
    expect(progression.orbCount).toBe(0);
    expect(progression.experience).toBe(30);
  });
});

describe('升级、溢出与满级', () => {
  it('达到阈值升级并保留溢出经验', () => {
    const progression = new ProgressionSystem();
    const first = progression.addExperience(40);
    expect(first.levelUps).toBe(1);
    expect(progression.level).toBe(2);
    expect(progression.experience).toBe(0);
    expect(progression.pendingLevelUps).toBe(1);

    progression.addExperience(75);
    expect(progression.level).toBe(3);
    expect(progression.experience).toBe(15);
    expect(progression.pendingLevelUps).toBe(2);
  });

  it('一次获得多级经验时逐级排队', () => {
    const progression = new ProgressionSystem();
    const gain = progression.addExperience(40 + 60 + 80);
    expect(gain.levelUps).toBe(3);
    expect(progression.level).toBe(4);
    expect(progression.pendingLevelUps).toBe(3);
    expect(progression.maxHealthBonus).toBe(3 * LEVEL_HEALTH_BONUS);

    expect(progression.consumeLevelUp()).toBe(true);
    expect(progression.pendingLevelUps).toBe(2);
    expect(progression.consumeLevelUp()).toBe(true);
    expect(progression.consumeLevelUp()).toBe(true);
    expect(progression.consumeLevelUp()).toBe(false);
  });

  it('满级 9 后不再产生升级与经验需求', () => {
    const progression = new ProgressionSystem();
    // 1→9 共需 40+60+80+100+120+140+160+180 = 880。
    progression.addExperience(880);
    expect(progression.level).toBe(MAX_LEVEL);
    expect(progression.pendingLevelUps).toBe(8);
    expect(progression.experience).toBe(0);
    expect(progression.isMaxLevel).toBe(true);
    expect(progression.experienceToNextLevel).toBe(Number.POSITIVE_INFINITY);

    const extra = progression.addExperience(999);
    expect(extra.levelUps).toBe(0);
    expect(progression.level).toBe(MAX_LEVEL);
    expect(progression.pendingLevelUps).toBe(8);
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
