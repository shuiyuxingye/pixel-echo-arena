/**
 * 塞雷娅技能规则（纯逻辑，不依赖 Phaser）。
 *
 * - J「盾击」：70 距离、100° 扇区内的敌人受 26 物伤；普通敌人被击退 12，
 *   精英/Boss 不被击退。命中结果与当前面向一致。
 * - K「急救配置」：冷却 10 秒；自身恢复 40 生命并获得 25 护盾持续 4 秒。
 *   治疗不超过生命上限；护盾不叠加，取较高剩余量并刷新持续时间。
 * - 被动「精神回复」：K 实际恢复生命时，使 L 剩余冷却减少 2 秒；
 *   满血施放不触发，持续治疗（L 领域）不进入该入口，因此不会递归触发。
 * - L「钙质化」：冷却 28 秒、持续 8 秒，以自身为圆心半径 120 跟随移动；
 *   每秒回复自身 8 生命；领域内敌人减速 35%、受到法伤 +30%；
 *   期间 J 命中额外造成 10 法伤。领域成员资格每步按当前位置重新判定，
 *   不在敌人身上保存状态，因此离开/结束立即失效，重复进入不会叠乘。
 * - 专属强化 S01–S04（docs/game-design.md §6.3）：
 *   S01 按 K 实际治疗量的 80% 对半径 100 敌人造成法伤；
 *   S02 领域每秒对敌人造成 16 法伤（同样享受领域 +30%）；
 *   S03 护盾吸收伤害时触发半径 85、18 物伤反击，内置冷却 0.8 秒；
 *   S04 精神回复 2→4 秒，领域累计 5 次有效治疗后 K 剩余冷却 −1 秒。
 *   所有法伤来源共用 `magicDamageMultiplier` 回调，由场景注入领域增伤，
 *   保证同一来源只乘一次。
 *
 * 数值来自 `src/game/data/characters.ts`、`src/game/data/upgrades.ts` 与
 * `docs/game-design.md` §5.3、§6.3。
 */
import {
  distanceSquared,
  listFrontTargets,
  TARGET_SECTOR_DEGREES,
  type Combatant,
  type CombatPoint,
  type DamageResult,
} from './combat';
import { requireUpgradeParam, type AttackDefinition, type DamageType } from './data';
import type { Facing } from './movement';
import type { SariaWorldSnapshot } from './world-snapshot';

/** 浮点累计容差，避免 4 秒护盾这类定时留下 1e-16 残差。 */
const TIME_EPSILON = 1e-9;

/** 精神回复每次减少的 L 剩余冷却（秒）。 */
export const SARIA_PASSIVE_COOLDOWN_REDUCTION_SECONDS = 2;

// S01–S04 的数值与卡片 `params` 同源，避免说明与实效分叉。
/** S01：K 实际治疗量转化为法伤的比例。 */
export const S01_HEAL_DAMAGE_RATIO = requireUpgradeParam('S01', 'healDamageRatio');
/** S01：治疗转伤害的作用半径。 */
export const S01_RADIUS = requireUpgradeParam('S01', 'radius');
/** S02：钙质化领域每秒对敌人造成的法伤。 */
export const S02_DAMAGE_PER_SECOND = requireUpgradeParam('S02', 'damagePerSecond');
/** S03：护盾吸收伤害时的反击半径。 */
export const S03_RADIUS = requireUpgradeParam('S03', 'radius');
/** S03：反击的物理伤害。 */
export const S03_DAMAGE = requireUpgradeParam('S03', 'damage');
/** S03：反击内置冷却（秒）。 */
export const S03_INTERNAL_COOLDOWN_SECONDS = requireUpgradeParam(
  'S03',
  'internalCooldownSeconds',
);
/** S04：精神回复减少 L 剩余冷却的提升后数值。 */
export const S04_PASSIVE_COOLDOWN_REDUCTION_SECONDS = requireUpgradeParam(
  'S04',
  'passiveCooldownReduction',
);
/** S04：领域有效治疗累计多少次后触发一次 K 冷却返还。 */
export const S04_HEALS_PER_TRIGGER = requireUpgradeParam('S04', 'healsPerTrigger');
/** S04：领域治疗累计触发时减少的 K 剩余冷却。 */
export const S04_COOLDOWN_REDUCTION_SECONDS = requireUpgradeParam('S04', 'cooldownReduction');

/** 钙质化领域以自身为圆心；成员资格按当前距离实时判定。 */
export interface CalciumFieldGeometry {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * 目标中心是否在领域内（边界包含在半径上）。
 * 领域跟随自身移动，成员资格不落盘，离开范围后自然不再属于领域。
 */
export function isInsideCalciumField(
  field: CalciumFieldGeometry,
  target: CombatPoint,
): boolean {
  const radius = Number.isFinite(field.radius) ? Math.max(0, field.radius) : 0;
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
  return Math.hypot(target.x - field.x, target.y - field.y) <= radius + TIME_EPSILON;
}

/**
 * 领域内敌人的移动倍率：减速 35% 即返回 0.65。
 * 返回值只取决于本次是否在领域内，不做乘法累计，因此重复进入不会叠乘。
 */
export function calciumFieldSlowMultiplier(
  inField: boolean,
  slowPercent: number,
): number {
  if (!inField) return 1;
  const percent = Number.isFinite(slowPercent)
    ? Math.min(Math.max(slowPercent, 0), 1)
    : 0;
  return 1 - percent;
}

/**
 * 领域内敌人受到的法术伤害倍率：+30% 即返回 1.3。
 * 只在结算该次伤害时读取，离开领域或效果结束后立即回到 1。
 */
export function calciumFieldMagicMultiplier(
  inField: boolean,
  vulnerability: number,
): number {
  if (!inField) return 1;
  const bonus = Number.isFinite(vulnerability) ? Math.max(0, vulnerability) : 0;
  return 1 + bonus;
}

export interface SariaCombatConfig {
  readonly kCooldownSeconds: number;
  readonly healAmount: number;
  readonly shieldAmount: number;
  readonly shieldDurationSeconds: number;
  /** 精神回复在 K 实际治疗时减少的 L 剩余冷却（秒）。 */
  readonly passiveLCooldownReductionSeconds: number;
  readonly lCooldownSeconds: number;
  readonly lDurationSeconds: number;
  /** 钙质化领域半径（逻辑像素），跟随自身。 */
  readonly fieldRadius: number;
  /** 领域生效期间每秒回复自身的生命。 */
  readonly fieldHealPerSecond: number;
  /** 领域内敌人减速比例，0.35 表示减速 35%。 */
  readonly enemySlowPercent: number;
  /** 领域内敌人受到法术伤害的额外比例，0.3 表示 +30%。 */
  readonly enemyMagicVulnerability: number;
  /** 领域生效期间 J 每次命中追加的法术伤害。 */
  readonly attackBonusMagicDamage: number;
}

/**
 * 塞雷娅 K/被动需要的最小生命接口；`HealthState` 直接满足。
 * 治疗与护盾都写进同一份生命状态，保证伤害结算与 HUD 读取同一真源。
 */
export interface SariaShieldTarget {
  readonly health: number;
  readonly maxHealth: number;
  readonly shield: number;
  readonly isDead: boolean;
  heal(amount: number): void;
  setShield(amount: number): void;
}

/**
 * S01/S02/S03 共用的范围伤害目标：场景的 `Combatant` 直接满足。
 */
export interface SariaDamageTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly isAlive: boolean;
  applyDamage(rawDamage: number, damageType: DamageType): DamageResult;
}

export interface SariaAreaOptions {
  /** G01 等全局伤害倍率，与卡片说明同源，由场景注入。 */
  readonly damageMultiplier?: number;
  /**
   * 领域法伤增伤入口：仅 `damageType === 'magic'` 时对每个目标调用一次。
   * 所有法伤来源共用同一回调，保证领域 ×1.3 只乘一次、不重复乘算。
   */
  readonly magicDamageMultiplier?: (targetId: string) => number;
  /** 返回 false 的目标不受伤害（爆炸/反击不穿墙）。 */
  readonly lineOfSight?: (from: CombatPoint, to: CombatPoint) => boolean;
}

export interface SariaAreaHit {
  readonly targetId: string;
  readonly result: DamageResult;
}

/**
 * 以自身为圆心的范围伤害：S01 治疗冲击、S02 领域每秒伤害与 S03 盾反共用。
 * 只命中存活、在半径内且通视的目标；成员资格按本次结算位置实时判定，不落盘。
 */
export function resolveSariaAreaDamage(
  center: CombatPoint,
  radius: number,
  rawDamage: number,
  damageType: DamageType,
  targets: readonly SariaDamageTarget[],
  options: SariaAreaOptions = {},
): SariaAreaHit[] {
  const area = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  const base = Number.isFinite(rawDamage) ? Math.max(0, rawDamage) : 0;
  if (area <= 0 || base <= 0) return [];

  const globalMultiplier = finitePositive(options.damageMultiplier, 1);
  const maxDistanceSquared = (area + TIME_EPSILON) * (area + TIME_EPSILON);
  const hits: SariaAreaHit[] = [];
  for (const target of targets) {
    if (target.isAlive === false) continue;
    if (distanceSquared(center, target) > maxDistanceSquared) continue;
    if (options.lineOfSight && !options.lineOfSight(center, target)) continue;

    const magicMultiplier =
      damageType === 'magic'
        ? finitePositive(options.magicDamageMultiplier?.(target.id), 1)
        : 1;
    hits.push({
      targetId: target.id,
      result: target.applyDamage(
        base * globalMultiplier * magicMultiplier,
        damageType,
      ),
    });
  }
  return hits;
}

/** 倍率非法（负数、NaN、Infinity）时回退到 1，避免治疗/护盾类来源被吞伤害。 */
function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export interface SariaKResult {
  /** 实际恢复的生命；满血施放为 0。 */
  readonly healed: number;
  /** 施放后的护盾总量（取较高剩余量）。 */
  readonly shield: number;
  /** 是否满足精神回复触发条件（实际恢复了生命）。 */
  readonly passiveTriggered: boolean;
  /** 本次实际减少的 L 剩余冷却秒数；L 已就绪时为 0。 */
  readonly lCooldownReducedSeconds: number;
  /** S01：按实际治疗量转化的范围法伤（未拥有 S01 或未治疗时为 0）。 */
  readonly healShockDamage: number;
}

/** 一步领域结算的结果；场景据此显示 S02 伤害与 S04 冷却返还。 */
export interface SariaStepResult {
  /** 本步到期的领域伤害次数（每秒 1 次）；0 表示无。 */
  readonly fieldDamageTicks: number;
  /** 本步由领域累计有效治疗触发的 K 剩余冷却减少秒数。 */
  readonly fieldHealCooldownReduction: number;
}

/** J 盾击的可选目标：精英/Boss 不被击退。 */
export interface ShieldBashTarget {
  readonly combatant: Combatant;
  readonly isElite?: boolean;
}

export interface ShieldBashHit {
  readonly targetId: string;
  readonly result: DamageResult;
  /** 本次应施加的击退距离；0 表示不击退（精英或攻击本身无击退）。 */
  readonly knockbackDistance: number;
  /** 钙质化期间追加的 10 法伤结算；未处于领域时缺省。 */
  readonly bonusMagicResult?: DamageResult;
}

export interface ShieldBashOptions {
  /** 钙质化领域生效时追加的法术伤害（已含 G01 前的基础值）。 */
  readonly bonusMagicDamage?: number;
  /** 目标受到的法术伤害倍率；钙质化领域内返回 1.3。 */
  readonly magicDamageMultiplier?: (targetId: string) => number;
}

/**
 * 盾击命中结算：只取当前面向前方 `arcDegrees` 扇区、`range` 内的存活目标。
 * 伤害已在纯逻辑层结算，场景只按返回结果播放表现与施加击退。
 * 领域追加法伤走同一入口，保证盾击与领域增伤只结算一次。
 */
export function resolveShieldBash(
  origin: CombatPoint,
  facing: Facing,
  targets: readonly ShieldBashTarget[],
  attack: AttackDefinition,
  damageMultiplier = 1,
  options: ShieldBashOptions = {},
): ShieldBashHit[] {
  const sectorDegrees = attack.arcDegrees ?? TARGET_SECTOR_DEGREES;
  const inSector = listFrontTargets(
    origin,
    facing,
    targets.map((target) => target.combatant),
    attack.range,
    sectorDegrees,
  );
  const multiplier =
    Number.isFinite(damageMultiplier) && damageMultiplier > 0 ? damageMultiplier : 1;
  const knockback = attack.knockback ?? 0;
  const byId = new Map(targets.map((target) => [target.combatant.id, target] as const));
  const bonusMagicDamage =
    Number.isFinite(options.bonusMagicDamage) && (options.bonusMagicDamage ?? 0) > 0
      ? (options.bonusMagicDamage as number) * multiplier
      : 0;

  const hits: ShieldBashHit[] = [];
  for (const targetable of inSector) {
    const target = byId.get(targetable.id);
    if (!target) continue;
    const result = target.combatant.applyDamage(
      attack.damage * multiplier,
      attack.damageType,
    );
    let bonusMagicResult: DamageResult | undefined;
    if (bonusMagicDamage > 0) {
      const vulnerability = options.magicDamageMultiplier?.(targetable.id) ?? 1;
      const factor =
        Number.isFinite(vulnerability) && vulnerability > 0 ? vulnerability : 1;
      bonusMagicResult = target.combatant.applyDamage(
        bonusMagicDamage * factor,
        'magic',
      );
    }
    hits.push({
      targetId: targetable.id,
      result,
      knockbackDistance: target.isElite === true ? 0 : knockback,
      bonusMagicResult,
    });
  }
  return hits;
}

/** 塞雷娅的 K 冷却、护盾计时、精神回复、L 冷却与领域持续治疗。 */
export class SariaCombat {
  private readonly config: SariaCombatConfig;
  private kCooldownSeconds = 0;
  private lCooldownSeconds = 0;
  private lActiveSeconds = 0;
  private cooldownMultiplier = 1;
  private shieldRemainingSeconds = 0;
  private passiveTriggers = 0;

  // S01：治疗转伤害比例与半径；比例为 0 表示未拥有。
  private healShockRatio = 0;
  private healShockRadiusValue = 0;
  // S02：领域每秒伤害；0 表示未拥有。
  private fieldDamagePerSecondValue = 0;
  // S03：护盾反击开关、数值与内置冷却。
  private shieldCounterEnabled = false;
  private shieldCounterRadiusValue = 0;
  private shieldCounterDamageValue = 0;
  private shieldCounterCooldownSecondsValue = 0;
  private shieldCounterCooldownRemainingValue = 0;
  // S04：精神回复提升值与领域有效治疗累计触发。
  private passiveCooldownReductionSeconds: number;
  private fieldHealChainHealsPerTrigger = 0;
  private fieldHealChainCooldownReduction = 0;
  private fieldHealCount = 0;
  private fieldHealTickHadHealing = false;
  // 领域伤害/治疗按 1 秒 tick 累计；逻辑步长变化不影响每秒节奏。
  private fieldDamageAccumulator = 0;
  private fieldHealAccumulator = 0;

  constructor(config: SariaCombatConfig) {
    if (!(config.kCooldownSeconds > 0) || !Number.isFinite(config.kCooldownSeconds)) {
      throw new Error('SariaCombat requires a positive kCooldownSeconds');
    }
    if (!(config.healAmount >= 0) || !Number.isFinite(config.healAmount)) {
      throw new Error('SariaCombat requires healAmount >= 0');
    }
    if (!(config.shieldAmount >= 0) || !Number.isFinite(config.shieldAmount)) {
      throw new Error('SariaCombat requires shieldAmount >= 0');
    }
    if (
      !(config.shieldDurationSeconds >= 0) ||
      !Number.isFinite(config.shieldDurationSeconds)
    ) {
      throw new Error('SariaCombat requires shieldDurationSeconds >= 0');
    }
    if (
      !(config.passiveLCooldownReductionSeconds >= 0) ||
      !Number.isFinite(config.passiveLCooldownReductionSeconds)
    ) {
      throw new Error('SariaCombat requires passiveLCooldownReductionSeconds >= 0');
    }
    if (!(config.lCooldownSeconds > 0) || !Number.isFinite(config.lCooldownSeconds)) {
      throw new Error('SariaCombat requires a positive lCooldownSeconds');
    }
    if (!(config.lDurationSeconds > 0) || !Number.isFinite(config.lDurationSeconds)) {
      throw new Error('SariaCombat requires a positive lDurationSeconds');
    }
    if (!(config.fieldRadius >= 0) || !Number.isFinite(config.fieldRadius)) {
      throw new Error('SariaCombat requires fieldRadius >= 0');
    }
    if (!(config.fieldHealPerSecond >= 0) || !Number.isFinite(config.fieldHealPerSecond)) {
      throw new Error('SariaCombat requires fieldHealPerSecond >= 0');
    }
    if (!(config.enemySlowPercent >= 0) || !Number.isFinite(config.enemySlowPercent)) {
      throw new Error('SariaCombat requires enemySlowPercent >= 0');
    }
    if (
      !(config.enemyMagicVulnerability >= 0) ||
      !Number.isFinite(config.enemyMagicVulnerability)
    ) {
      throw new Error('SariaCombat requires enemyMagicVulnerability >= 0');
    }
    if (
      !(config.attackBonusMagicDamage >= 0) ||
      !Number.isFinite(config.attackBonusMagicDamage)
    ) {
      throw new Error('SariaCombat requires attackBonusMagicDamage >= 0');
    }
    this.config = config;
    this.passiveCooldownReductionSeconds = config.passiveLCooldownReductionSeconds;
  }

  get kCooldownRemaining(): number {
    return Math.max(0, this.kCooldownSeconds);
  }

  get lCooldownRemaining(): number {
    return Math.max(0, this.lCooldownSeconds);
  }

  get isCalciumFieldActive(): boolean {
    return this.lActiveSeconds > TIME_EPSILON;
  }

  get calciumFieldRemaining(): number {
    return Math.max(0, this.lActiveSeconds);
  }

  /** 领域半径；场景用它绘制跟随自身的范围提示。 */
  get fieldRadius(): number {
    return this.config.fieldRadius;
  }

  /** 领域内敌人减速比例（0.35 即减速 35%）。 */
  get enemySlowPercent(): number {
    return this.config.enemySlowPercent;
  }

  /** 领域内敌人受到法术伤害的额外比例（0.3 即 +30%）。 */
  get enemyMagicVulnerability(): number {
    return this.config.enemyMagicVulnerability;
  }

  /** 领域生效期间 J 每次命中追加的法术伤害。 */
  get attackBonusMagicDamage(): number {
    return this.config.attackBonusMagicDamage;
  }

  /** 护盾剩余持续时间；0 表示没有可刷新的护盾。 */
  get shieldRemaining(): number {
    return Math.max(0, this.shieldRemainingSeconds);
  }

  get isShieldActive(): boolean {
    return this.shieldRemainingSeconds > TIME_EPSILON;
  }

  /** 精神回复实际触发次数，供 HUD/测试确认满血施放与持续治疗不会触发。 */
  get passiveTriggerCount(): number {
    return this.passiveTriggers;
  }

  /** 波中快照：K/L 冷却与领域、护盾、反击冷却及领域治疗累计。 */
  snapshotWorld(): SariaWorldSnapshot {
    return {
      kCooldownSeconds: this.kCooldownSeconds,
      lCooldownSeconds: this.lCooldownSeconds,
      lActiveSeconds: this.lActiveSeconds,
      shieldRemainingSeconds: this.shieldRemainingSeconds,
      passiveTriggers: this.passiveTriggers,
      shieldCounterCooldownRemaining: this.shieldCounterCooldownRemainingValue,
      fieldHealCount: this.fieldHealCount,
      fieldHealTickHadHealing: this.fieldHealTickHadHealing,
      fieldDamageAccumulator: this.fieldDamageAccumulator,
      fieldHealAccumulator: this.fieldHealAccumulator,
    };
  }

  /** 从波中快照恢复；S01–S04 的配置由场景按已选强化重新同步。 */
  restoreWorld(state: SariaWorldSnapshot): void {
    this.kCooldownSeconds = nonNegative(state.kCooldownSeconds);
    this.lCooldownSeconds = nonNegative(state.lCooldownSeconds);
    this.lActiveSeconds = nonNegative(state.lActiveSeconds);
    this.shieldRemainingSeconds = nonNegative(state.shieldRemainingSeconds);
    this.passiveTriggers = Number.isInteger(state.passiveTriggers)
      ? Math.max(0, state.passiveTriggers)
      : 0;
    this.shieldCounterCooldownRemainingValue = nonNegative(
      state.shieldCounterCooldownRemaining,
    );
    this.fieldHealCount = Number.isInteger(state.fieldHealCount)
      ? Math.max(0, state.fieldHealCount)
      : 0;
    this.fieldHealTickHadHealing = state.fieldHealTickHadHealing === true;
    this.fieldDamageAccumulator = nonNegative(state.fieldDamageAccumulator);
    this.fieldHealAccumulator = nonNegative(state.fieldHealAccumulator);
  }

  /** 更新 G03 的冷却倍率；只影响之后启动的冷却，不追溯当前剩余时间。 */
  setCooldownMultiplier(multiplier: number): void {
    this.cooldownMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  }

  /** S01：设置治疗转伤害比例与半径；比例非正表示未拥有。 */
  setHealShock(ratio: number, radius: number): void {
    this.healShockRatio =
      Number.isFinite(ratio) && ratio > 0 ? Math.max(0, ratio) : 0;
    this.healShockRadiusValue =
      Number.isFinite(radius) && radius > 0 ? Math.max(0, radius) : 0;
  }

  /** S01 治疗转伤害的作用半径；场景用它绘制/结算范围。 */
  get healShockRadius(): number {
    return this.healShockRadiusValue;
  }

  /** S02：领域每秒对敌人造成的法伤；非正表示未拥有。 */
  setFieldDamagePerSecond(damagePerSecond: number): void {
    const next =
      Number.isFinite(damagePerSecond) && damagePerSecond > 0
        ? Math.max(0, damagePerSecond)
        : 0;
    if (next !== this.fieldDamagePerSecondValue) this.fieldDamageAccumulator = 0;
    this.fieldDamagePerSecondValue = next;
  }

  /** 领域每秒伤害的当前配置值（0 表示未拥有 S02）。 */
  get fieldDamagePerSecond(): number {
    return this.fieldDamagePerSecondValue;
  }

  /** S03：护盾吸收伤害时的反击配置；未拥有时 `enabled=false`。 */
  setShieldCounter(
    enabled: boolean,
    radius: number,
    damage: number,
    internalCooldownSeconds: number,
  ): void {
    this.shieldCounterEnabled = enabled;
    this.shieldCounterRadiusValue =
      Number.isFinite(radius) && radius > 0 ? Math.max(0, radius) : 0;
    this.shieldCounterDamageValue =
      Number.isFinite(damage) && damage > 0 ? Math.max(0, damage) : 0;
    this.shieldCounterCooldownSecondsValue =
      Number.isFinite(internalCooldownSeconds) && internalCooldownSeconds > 0
        ? Math.max(0, internalCooldownSeconds)
        : 0;
    if (!enabled) this.shieldCounterCooldownRemainingValue = 0;
  }

  get shieldCounterRadius(): number {
    return this.shieldCounterRadiusValue;
  }

  get shieldCounterDamage(): number {
    return this.shieldCounterDamageValue;
  }

  /** S03 内置冷却剩余；0 表示可再次触发。 */
  get shieldCounterCooldownRemaining(): number {
    return Math.max(0, this.shieldCounterCooldownRemainingValue);
  }

  /**
   * S03：登记一次护盾吸收。
   * 只有实际吸收 > 0 且内置冷却结束时返回 true；触发后立即开始 0.8 秒冷却。
   */
  registerShieldAbsorb(shieldAbsorbed: number): boolean {
    if (!this.shieldCounterEnabled) return false;
    if (!Number.isFinite(shieldAbsorbed) || shieldAbsorbed <= TIME_EPSILON) return false;
    if (this.shieldCounterCooldownRemainingValue > TIME_EPSILON) return false;
    this.shieldCounterCooldownRemainingValue =
      this.shieldCounterCooldownSecondsValue;
    return true;
  }

  /** S04：精神回复的 L 冷却返还值（默认 2，拥有 S04 后为 4）。 */
  setPassiveCooldownReduction(seconds: number): void {
    this.passiveCooldownReductionSeconds =
      Number.isFinite(seconds) && seconds >= 0 ? Math.max(0, seconds) : 0;
  }

  get passiveCooldownReduction(): number {
    return this.passiveCooldownReductionSeconds;
  }

  /**
   * S04：领域有效治疗累计触发。
   * `healsPerTrigger` 非正表示未拥有；每个领域秒内实际回复过生命记为 1 次有效治疗，
   * 满血/已死亡不计数，累计达到阈值后 K 剩余冷却减少 `cooldownReduction` 秒。
   */
  setFieldHealChain(healsPerTrigger: number, cooldownReduction: number): void {
    const nextHeals =
      Number.isFinite(healsPerTrigger) && healsPerTrigger > 0
        ? Math.floor(healsPerTrigger)
        : 0;
    // 重复同步同一配置（例如获得其他强化）不得清空已累计的治疗次数。
    if (nextHeals !== this.fieldHealChainHealsPerTrigger) {
      this.fieldHealCount = 0;
      this.fieldHealAccumulator = 0;
      this.fieldHealTickHadHealing = false;
    }
    this.fieldHealChainHealsPerTrigger = nextHeals;
    this.fieldHealChainCooldownReduction =
      Number.isFinite(cooldownReduction) && cooldownReduction > 0
        ? Math.max(0, cooldownReduction)
        : 0;
  }

  /** S04 已累计的有效治疗次数（0–阈值−1），供 HUD/测试观察。 */
  get fieldHealProgress(): number {
    return this.fieldHealCount;
  }

  /** G08 与被动共用的剩余冷却返还；已到下限时不再返还，也不回抬。 */
  reduceCooldown(seconds: number, minimumSeconds = 0): number {
    return this.reduceLBy('k', seconds, minimumSeconds);
  }

  /** L 剩余冷却返还；G03/G08 的下限语义与 K 一致。 */
  reduceLCooldown(seconds: number, minimumSeconds = 0): number {
    return this.reduceLBy('l', seconds, minimumSeconds);
  }

  /**
   * K 急救配置：启动冷却、按上限治疗、刷新护盾，并在实际治疗时触发精神回复。
   * 冷却中或已死亡返回 null；满血施放仍会获得护盾，但不触发被动。
   */
  tryActivateK(target: SariaShieldTarget): SariaKResult | null {
    if (target.isDead || this.kCooldownRemaining > TIME_EPSILON) return null;

    this.kCooldownSeconds = this.config.kCooldownSeconds * this.cooldownMultiplier;

    const missingHealth = Math.max(0, target.maxHealth - target.health);
    const healed = Math.min(missingHealth, this.config.healAmount);
    if (healed > 0) target.heal(this.config.healAmount);

    let lCooldownReducedSeconds = 0;
    let passiveTriggered = false;
    let healShockDamage = 0;
    if (healed > TIME_EPSILON) {
      passiveTriggered = true;
      this.passiveTriggers += 1;
      lCooldownReducedSeconds = this.reduceLCooldown(
        this.passiveCooldownReductionSeconds,
      );
      // S01 只按实际治疗量转化；满血施放 healed=0，不产生伤害。
      healShockDamage = healed * this.healShockRatio;
    }

    // 护盾不叠加：保留较高剩余量，并重新开始 4 秒持续时间。
    const shield = Math.max(target.shield, this.config.shieldAmount);
    target.setShield(shield);
    this.shieldRemainingSeconds = this.config.shieldDurationSeconds;

    return {
      healed,
      shield,
      passiveTriggered,
      lCooldownReducedSeconds,
      healShockDamage,
    };
  }

  /**
   * 启动钙质化；冷却中或已生效返回 false。
   * 领域的位置与成员资格由场景每步按玩家当前位置判定，这里只维护冷却与持续时间；
   * 持续治疗在同一 `step` 入口结算，因此不会触发精神回复。
   */
  tryActivateL(): boolean {
    if (this.isCalciumFieldActive || this.lCooldownRemaining > TIME_EPSILON) return false;
    this.lCooldownSeconds = this.config.lCooldownSeconds * this.cooldownMultiplier;
    this.lActiveSeconds = this.config.lDurationSeconds;
    // 每次展开重新按整秒计 tick；S04 的累计次数跨领域保留。
    this.fieldDamageAccumulator = 0;
    this.fieldHealAccumulator = 0;
    this.fieldHealTickHadHealing = false;
    return true;
  }

  /**
   * 推进一个逻辑步：先结算领域持续治疗与 S02 伤害 tick，再衰减 K/L 冷却、
   * L 持续时间、护盾与 S03 内置冷却。
   * 护盾到期时把生命状态中的实际护盾清零；已被伤害消耗完时清零同样安全。
   * 领域只在本步实际覆盖的时间内治疗，效果结束的那一步不会多回复。
   * 领域伤害与 S04 有效治疗都按整秒 tick 结算，不受逻辑步长变化影响。
   */
  step(stepSeconds: number, target?: SariaShieldTarget): SariaStepResult {
    const result = { fieldDamageTicks: 0, fieldHealCooldownReduction: 0 };
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) return result;

    const fieldSeconds = Math.min(this.lActiveSeconds, stepSeconds);
    if (fieldSeconds > 0) {
      // S02：每满 1 秒结算一次领域伤害；场景按领域半径统一结算。
      if (this.fieldDamagePerSecondValue > 0) {
        this.fieldDamageAccumulator += fieldSeconds;
        while (this.fieldDamageAccumulator >= 1 - TIME_EPSILON) {
          this.fieldDamageAccumulator = Math.max(0, this.fieldDamageAccumulator - 1);
          result.fieldDamageTicks += 1;
        }
      }

      let actualHealed = 0;
      if (target && !target.isDead) {
        const amount = this.config.fieldHealPerSecond * fieldSeconds;
        if (amount > 0) {
          const missing = Math.max(0, target.maxHealth - target.health);
          actualHealed = Math.min(missing, amount);
          target.heal(amount);
        }
      }

      // S04：只有实际回复过生命的领域秒才计入有效治疗，满血不计数。
      if (this.fieldHealChainHealsPerTrigger > 0) {
        if (actualHealed > TIME_EPSILON) this.fieldHealTickHadHealing = true;
        this.fieldHealAccumulator += fieldSeconds;
        while (this.fieldHealAccumulator >= 1 - TIME_EPSILON) {
          this.fieldHealAccumulator = Math.max(0, this.fieldHealAccumulator - 1);
          if (!this.fieldHealTickHadHealing) continue;
          this.fieldHealTickHadHealing = false;
          this.fieldHealCount += 1;
          if (this.fieldHealCount >= this.fieldHealChainHealsPerTrigger) {
            this.fieldHealCount -= this.fieldHealChainHealsPerTrigger;
            result.fieldHealCooldownReduction += this.reduceLBy(
              'k',
              this.fieldHealChainCooldownReduction,
              0,
            );
          }
        }
      }
    }

    this.kCooldownSeconds = decay(this.kCooldownSeconds, stepSeconds);
    this.lCooldownSeconds = decay(this.lCooldownSeconds, stepSeconds);
    this.lActiveSeconds = decay(this.lActiveSeconds, stepSeconds);

    if (this.shieldCounterCooldownRemainingValue > 0) {
      this.shieldCounterCooldownRemainingValue = decay(
        this.shieldCounterCooldownRemainingValue,
        stepSeconds,
      );
    }

    if (this.shieldRemainingSeconds > 0) {
      this.shieldRemainingSeconds = decay(this.shieldRemainingSeconds, stepSeconds);
      if (this.shieldRemainingSeconds <= 0 && target) target.setShield(0);
    }
    return result;
  }

  private reduceLBy(kind: 'k' | 'l', seconds: number, minimumSeconds: number): number {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return 0;
    const current = kind === 'k' ? this.kCooldownSeconds : this.lCooldownSeconds;
    if (current <= TIME_EPSILON) return 0;
    const minimum = Number.isFinite(minimumSeconds) ? Math.max(0, minimumSeconds) : 0;
    if (current <= minimum + TIME_EPSILON) return 0;

    const next = Math.max(minimum, current - seconds);
    const reduced = current - next;
    if (kind === 'k') this.kCooldownSeconds = next <= TIME_EPSILON ? 0 : next;
    else this.lCooldownSeconds = next <= TIME_EPSILON ? 0 : next;
    return reduced;
  }
}

function decay(value: number, stepSeconds: number): number {
  if (value <= 0) return 0;
  const next = value - stepSeconds;
  return next <= TIME_EPSILON ? 0 : next;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
