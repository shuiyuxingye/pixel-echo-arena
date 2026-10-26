/**
 * 经验球、等级与升级队列（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §钱与经验各管一件事：
 * - 普通敌人经验 5、精英 80，吸取半径 55，波末自动吸取剩余经验；
 * - 等级 1–15，从等级 n 升到 n+1 需要 `50 + 15 × (n−1)` 点经验，溢出保留；
 * - 满级后不再产生升级弹窗；
 * - 每次升级最大生命 +5 并回复 5；
 * - 海克斯三选一只在等级 2/4/6/8/10/12/14 排队，其余升级只给基础成长。
 */

/** 普通/精英敌人的经验值。 */
export const XP_PER_NORMAL_ENEMY = 5;
export const XP_PER_ELITE_ENEMY = 80;

/** 经验球吸取半径（逻辑像素）。 */
export const XP_PICKUP_RADIUS = 55;

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 15;

/** 获得海克斯三选一的等级；每局固定 7 次。 */
export const HEX_LEVELS: readonly number[] = [2, 4, 6, 8, 10, 12, 14];

/** 该等级是否奖励一次海克斯选择。 */
export function isHexLevel(level: number): boolean {
  return HEX_LEVELS.includes(level);
}

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
  return 50 + 15 * (level - 1);
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
  /** 本次新增的海克斯选择次数（只有 2/4/6/8/10/12/14 级会加）。 */
  readonly hexChoices: number;
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
 * 海克斯选择保持排队，由场景逐个消费，避免同时升多级时漏选。
 */
export class ProgressionSystem {
  private levelValue = MIN_LEVEL;
  private experienceValue = 0;
  private totalExperienceValue = 0;
  private pendingLevelUpsValue = 0;
  private readonly orbList: ExperienceOrb[] = [];
  private nextOrbId = 1;
  /** I17 经验吸取半径倍率；1 表示基础 55。 */
  private pickupRadiusMultiplierValue = 1;
  /** H10 击杀经验修正；1 表示不变，0.9 表示 −10%。 */
  private xpGainMultiplierValue = 1;

  /** 更新 I17 的经验吸取半径倍率；非法或非正数回到 1。 */
  setPickupRadiusMultiplier(multiplier: number): void {
    this.pickupRadiusMultiplierValue =
      Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  }

  /** 更新击杀经验倍率（H10 −10%）；非法或负数回到 1。 */
  setXpGainMultiplier(multiplier: number): void {
    this.xpGainMultiplierValue =
      Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : 1;
  }

  /** 当前击杀经验倍率；经验球生成时应用一次。 */
  get xpGainMultiplier(): number {
    return this.xpGainMultiplierValue;
  }

  /** 当前实际吸取半径（逻辑像素）。 */
  get pickupRadius(): number {
    return XP_PICKUP_RADIUS * this.pickupRadiusMultiplierValue;
  }

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

  /** 等待玩家逐个确认的海克斯选择次数；非海克斯等级升级不排队。 */
  get pendingLevelUps(): number {
    return this.pendingLevelUpsValue;
  }

  get isMaxLevel(): boolean {
    return this.levelValue >= MAX_LEVEL;
  }

  /** 升级累计的最大生命增量：每级 +5（与海克斯选择无关）。 */
  get maxHealthBonus(): number {
    return (this.levelValue - MIN_LEVEL) * LEVEL_HEALTH_BONUS;
  }

  get orbs(): readonly ExperienceOrb[] {
    return this.orbList;
  }

  get orbCount(): number {
    return this.orbList.length;
  }

  /**
   * 敌人在死亡位置掉落经验球；精英固定 80，普通固定 5。
   * 指定 `value` 时优先使用（巢母幼虫只给 1 经验）。
   * H10 的击杀经验 −10% 在生成时乘一次，吸取时不再重复缩放。
   */
  spawnXpOrb(
    x: number,
    y: number,
    isElite = false,
    value?: number,
  ): ExperienceOrb {
    const base =
      Number.isFinite(value) && (value as number) > 0
        ? (value as number)
        : isElite
          ? XP_PER_ELITE_ENEMY
          : XP_PER_NORMAL_ENEMY;
    const amount = base * this.xpGainMultiplierValue;
    const orb: ExperienceOrb = {
      id: this.nextOrbId,
      x,
      y,
      value: amount,
      isElite,
    };
    this.nextOrbId += 1;
    this.orbList.push(orb);
    return orb;
  }

  /**
   * 续局恢复：写入等级、经验、累计经验与排队的海克斯选择。
   * 等级钳制在 1–15；满级不保留下一级经验；场上经验球不进入快照，恢复时为空。
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
    const radius = this.pickupRadius;
    const radiusSquared = radius * radius;

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
        hexChoices: 0,
        level: this.levelValue,
        experience: this.experienceValue,
        pendingLevelUps: this.pendingLevelUpsValue,
      };
    }

    this.totalExperienceValue += amount;
    let levelUps = 0;
    let hexChoices = 0;

    if (this.levelValue < MAX_LEVEL) {
      this.experienceValue += amount;
      while (this.levelValue < MAX_LEVEL) {
        const threshold = levelUpThreshold(this.levelValue);
        if (this.experienceValue + EXPERIENCE_EPSILON < threshold) break;
        this.experienceValue -= threshold;
        this.levelValue += 1;
        // 只有 2/4/6/8/10/12/14 级排入海克斯选择；其他升级只给基础成长。
        if (isHexLevel(this.levelValue)) {
          this.pendingLevelUpsValue += 1;
          hexChoices += 1;
        }
        levelUps += 1;
      }
      // 满级后不再保留“下一级”经验，也不再产生升级弹窗。
      if (this.levelValue >= MAX_LEVEL) this.experienceValue = 0;
    }

    return {
      amount,
      levelUps,
      hexChoices,
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
