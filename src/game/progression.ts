/**
 * 经验球、等级与升级队列（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/game-design.md` §6.1：
 * - 普通敌人经验 5、精英 25，吸取半径 55，波末自动吸取剩余经验；
 * - 等级 1–9，从等级 n 升到 n+1 需要 `40 + 20 × (n−1)` 点经验，溢出保留；
 * - 满级后不再产生升级弹窗；
 * - 每次升级最大生命 +5 并回复 5；同时升多级时排队逐个选择。
 */

/** 普通/精英敌人的经验值。 */
export const XP_PER_NORMAL_ENEMY = 5;
export const XP_PER_ELITE_ENEMY = 25;

/** 经验球吸取半径（逻辑像素）。 */
export const XP_PICKUP_RADIUS = 55;

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 9;

/** 每次升级的最大生命增量与回复量。 */
export const LEVEL_HEALTH_BONUS = 5;
export const LEVEL_HEAL_AMOUNT = 5;

const EXPERIENCE_EPSILON = 1e-9;

/**
 * 从 `level` 升到下一级所需经验。
 * 满级没有下一级，返回 `Infinity`。
 */
export function levelUpThreshold(level: number): number {
  if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
    throw new Error(`Level must be an integer in ${MIN_LEVEL}..${MAX_LEVEL}, received ${level}`);
  }
  if (level >= MAX_LEVEL) return Number.POSITIVE_INFINITY;
  return 40 + 20 * (level - 1);
}

export interface ExperienceOrb {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly value: number;
  readonly isElite: boolean;
}

export interface ExperienceCollection {
  readonly orbs: readonly ExperienceOrb[];
  readonly amount: number;
}

export interface ExperienceGain {
  readonly amount: number;
  /** 本次新增的等级数（可能一次升多级）。 */
  readonly levelUps: number;
  readonly level: number;
  readonly experience: number;
  readonly pendingLevelUps: number;
}

/** 玩家位置的最小信息。 */
export interface ExperienceCollector {
  readonly x: number;
  readonly y: number;
}

/** 续局恢复所需的等级与经验；不包含生命，生命由场景的 HealthState 单独恢复。 */
export interface ProgressionRestoreState {
  readonly level: number;
  readonly experience: number;
  readonly totalExperience: number;
  readonly pendingLevelUps: number;
}

/**
 * 经验与升级状态：经验球在场地上等待吸取，进入半径 55 立即结算。
 * 升级产生的选择保持排队，由场景逐个消费，避免同时升多级时漏选。
 */
export class ProgressionSystem {
  private levelValue = MIN_LEVEL;
  private experienceValue = 0;
  private totalExperienceValue = 0;
  private pendingLevelUpsValue = 0;
  private readonly orbList: ExperienceOrb[] = [];
  private nextOrbId = 1;

  get level(): number {
    return this.levelValue;
  }

  /** 当前等级内已累积的经验。 */
  get experience(): number {
    return this.experienceValue;
  }

  /** 升到下一级还需的经验；满级为 `Infinity`。 */
  get experienceToNextLevel(): number {
    return levelUpThreshold(this.levelValue);
  }

  get totalExperience(): number {
    return this.totalExperienceValue;
  }

  /** 等待玩家逐个确认的升级次数。 */
  get pendingLevelUps(): number {
    return this.pendingLevelUpsValue;
  }

  get isMaxLevel(): boolean {
    return this.levelValue >= MAX_LEVEL;
  }

  /** 升级累计的最大生命增量：每级 +5。 */
  get maxHealthBonus(): number {
    return (this.levelValue - MIN_LEVEL) * LEVEL_HEALTH_BONUS;
  }

  get orbs(): readonly ExperienceOrb[] {
    return this.orbList;
  }

  get orbCount(): number {
    return this.orbList.length;
  }

  /** 敌人在死亡位置掉落经验球；精英固定 25，普通固定 5。 */
  spawnXpOrb(x: number, y: number, isElite = false): ExperienceOrb {
    const orb: ExperienceOrb = {
      id: this.nextOrbId,
      x,
      y,
      value: isElite ? XP_PER_ELITE_ENEMY : XP_PER_NORMAL_ENEMY,
      isElite,
    };
    this.nextOrbId += 1;
    this.orbList.push(orb);
    return orb;
  }

  /**
   * 续局恢复：写入等级、经验、累计经验与排队升级。
   * 等级钳制在 1–9；满级不保留下一级经验；场上经验球不进入快照，恢复时为空。
   */
  restore(state: ProgressionRestoreState): void {
    const level = Number.isFinite(state.level)
      ? Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.floor(state.level)))
      : MIN_LEVEL;
    const experience =
      Number.isFinite(state.experience) && state.experience > 0
        ? state.experience
        : 0;
    const pending =
      Number.isFinite(state.pendingLevelUps) && state.pendingLevelUps > 0
        ? Math.floor(state.pendingLevelUps)
        : 0;

    this.levelValue = level;
    this.experienceValue = level >= MAX_LEVEL ? 0 : experience;
    this.pendingLevelUpsValue = pending;
    this.totalExperienceValue = Math.max(
      this.experienceValue,
      Number.isFinite(state.totalExperience) ? state.totalExperience : 0,
    );
  }

  /** 吸取半径 55 内的经验球，并立即结算经验。 */
  step(player: ExperienceCollector): ExperienceCollection {
    const collected: ExperienceOrb[] = [];
    const survivors: ExperienceOrb[] = [];
    const radiusSquared = XP_PICKUP_RADIUS * XP_PICKUP_RADIUS;

    for (const orb of this.orbList) {
      const dx = orb.x - player.x;
      const dy = orb.y - player.y;
      if (dx * dx + dy * dy <= radiusSquared) {
        collected.push(orb);
      } else {
        survivors.push(orb);
      }
    }

    this.orbList.length = 0;
    this.orbList.push(...survivors);

    const amount = collected.reduce((total, orb) => total + orb.value, 0);
    if (amount > 0) this.addExperience(amount);

    return { orbs: collected, amount };
  }

  /** 波末自动吸取场上全部经验球，不需要玩家靠近。 */
  collectAll(): ExperienceCollection {
    const collected = [...this.orbList];
    this.orbList.length = 0;
    const amount = collected.reduce((total, orb) => total + orb.value, 0);
    if (amount > 0) this.addExperience(amount);
    return { orbs: collected, amount };
  }

  /** 增加经验；溢出的经验保留到下一级，满级后不再产生升级。 */
  addExperience(amount: number): ExperienceGain {
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        amount: 0,
        levelUps: 0,
        level: this.levelValue,
        experience: this.experienceValue,
        pendingLevelUps: this.pendingLevelUpsValue,
      };
    }

    this.totalExperienceValue += amount;
    let levelUps = 0;

    if (this.levelValue < MAX_LEVEL) {
      this.experienceValue += amount;
      while (this.levelValue < MAX_LEVEL) {
        const threshold = levelUpThreshold(this.levelValue);
        if (this.experienceValue + EXPERIENCE_EPSILON < threshold) break;
        this.experienceValue -= threshold;
        this.levelValue += 1;
        this.pendingLevelUpsValue += 1;
        levelUps += 1;
      }
      // 满级后不再保留“下一级”经验，也不再产生升级弹窗。
      if (this.levelValue >= MAX_LEVEL) this.experienceValue = 0;
    }

    return {
      amount,
      levelUps,
      level: this.levelValue,
      experience: this.experienceValue,
      pendingLevelUps: this.pendingLevelUpsValue,
    };
  }

  /** 消费一次排队中的升级选择；没有待选升级时返回 false。 */
  consumeLevelUp(): boolean {
    if (this.pendingLevelUpsValue <= 0) return false;
    this.pendingLevelUpsValue -= 1;
    return true;
  }
}
