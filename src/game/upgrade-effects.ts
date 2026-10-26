/**
 * 通用强化 G01–G08 的战斗实效（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/game-design.md` §5 通用约定、§6.3：
 * - G01/G02/G03/G04 为可叠 3 层的银卡，百分比同类加算；
 * - G05 击杀爆炸不可再次触发本卡；G06 战术回响 5 秒未用失效、只追加 J；
 * - G07 闪避终点脉冲；G08 冷却期间每累计 10 击杀减少剩余冷却 2 秒；
 * - G03 的百分比冷却缩减与 G08 的返还合并后，总冷却缩减不超过 40%。
 *
 * 数值直接读 `UPGRADE_LIST` 的 `params`，保证卡片说明与战斗实效同源。
 * 层数由 `UpgradeRun.stacksOf` 提供，本模块不重复维护层数真源。
 */
import { distanceSquared, type DamageResult } from './combat';
import { getUpgrade, type DamageType } from './data';
import {
  COOLDOWN_REDUCTION_CAP,
  clampCooldownReduction,
  clampDamageMultiplier,
  clampMoveSpeedMultiplier,
} from './stats';
import type { UpgradeEffectsWorldSnapshot } from './world-snapshot';

export { COOLDOWN_REDUCTION_CAP } from './stats';

/** 浮点累计容差。 */
const TIME_EPSILON = 1e-9;

/** 读取强化参数；缺失即报错，避免静默使用与 docs 不一致的默认值。 */
function requireParam(upgradeId: string, key: string): number {
  const value = getUpgrade(upgradeId).params?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${upgradeId} 缺少数值参数 ${key}`);
  }
  return value;
}

export const G01_DAMAGE_BONUS_PER_STACK = requireParam('G01', 'damageBonusPerStack');
export const G02_MOVE_SPEED_BONUS_PER_STACK = requireParam('G02', 'moveSpeedBonusPerStack');
export const G03_COOLDOWN_REDUCTION_PER_STACK = requireParam('G03', 'cooldownReductionPerStack');
export const G04_MAX_HEALTH_BONUS_PER_STACK = requireParam('G04', 'maxHealthBonusPerStack');
export const G04_HEAL_ON_ACQUIRE = requireParam('G04', 'healOnAcquire');
export const G05_RADIUS = requireParam('G05', 'radius');
export const G05_DAMAGE = requireParam('G05', 'damage');
export const G06_DAMAGE_RATIO = requireParam('G06', 'damageRatio');
export const G06_EXPIRY_SECONDS = requireParam('G06', 'expirySeconds');
export const G07_RADIUS = requireParam('G07', 'radius');
export const G07_DAMAGE = requireParam('G07', 'damage');
export const G07_SLOW_PERCENT = requireParam('G07', 'slowPercent');
export const G07_SLOW_DURATION_SECONDS = requireParam('G07', 'slowDurationSeconds');
export const G08_KILLS_PER_TRIGGER = requireParam('G08', 'killsPerTrigger');
export const G08_COOLDOWN_REDUCTION_SECONDS = requireParam('G08', 'cooldownReduction');

/** 可被强化范围伤害结算的最小实体信息。 */
export interface UpgradeDamageTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly isAlive: boolean;
  applyDamage(rawDamage: number, damageType: DamageType): DamageResult;
}

/** 爆炸/脉冲中心到目标是否可见；返回 false 时该目标不受伤害。 */
export type UpgradeLineOfSight = (
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
) => boolean;

export interface UpgradeAreaHit {
  readonly targetId: string;
  readonly damage: DamageResult;
}

export interface KillExplosionResult {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly hits: readonly UpgradeAreaHit[];
}

export interface DodgePulseResult {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly slowRemainingSeconds: number;
  readonly hits: readonly UpgradeAreaHit[];
}

/** 获得一张强化时立即结算的效果；目前只有 G04 需要。 */
export interface AcquireUpgradeEffect {
  readonly maxHealthBonus: number;
  readonly heal: number;
}

/** 一次击杀让 K/L 剩余冷却各减少的秒数；0 表示本击杀未触发。 */
export interface KillCooldownReduction {
  readonly k: number;
  readonly l: number;
}

export interface UpgradeEffectsConfig {
  /** 已获得层数的只读查询口，通常直接传 `UpgradeRun.stacksOf`。 */
  readonly stacksOf: (upgradeId: string) => number;
}

export interface AreaResolveOptions {
  /** false 表示本次伤害不可再触发 G05（用于击杀爆炸自身的命中）。 */
  readonly allowTrigger?: boolean;
  readonly lineOfSight?: UpgradeLineOfSight;
  /**
   * 所有对敌法伤的统一增伤入口（钙质化领域 ×1.3）。
   * 仅 `damageType === 'magic'` 时对每个目标调用一次，保证不重复乘算。
   */
  readonly magicDamageMultiplier?: (targetId: string) => number;
}

const EMPTY_ACQUIRE_EFFECT: AcquireUpgradeEffect = { maxHealthBonus: 0, heal: 0 };

/**
 * 强化实效计算器：从层数派生伤害/移速/冷却倍率，并维护 G06 回响、
 * G07 减速与 G08 击杀进度的临时状态。
 */
export class UpgradeEffects {
  private readonly stacksOfValue: (upgradeId: string) => number;

  private echoRemainingValue = 0;
  private elapsed = 0;
  private kKillProgressValue = 0;
  private lKillProgressValue = 0;
  private readonly slowUntil = new Map<string, number>();

  constructor(config: UpgradeEffectsConfig) {
    this.stacksOfValue = config.stacksOf;
  }

  /** 层数对非负整数取整；层数真源仍在 `UpgradeRun`。 */
  stacks(upgradeId: string): number {
    const value = this.stacksOfValue(upgradeId);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  has(upgradeId: string): boolean {
    return this.stacks(upgradeId) > 0;
  }

  /** G01：所有自身与召唤物伤害倍率；同类百分比加算并遵守最低 0.25。 */
  get damageMultiplier(): number {
    return clampDamageMultiplier(1 + G01_DAMAGE_BONUS_PER_STACK * this.stacks('G01'));
  }

  /** G02：玩家移动速度倍率；按 V0.2 结算范围 0.6–1.6。 */
  get moveSpeedMultiplier(): number {
    return clampMoveSpeedMultiplier(1 + G02_MOVE_SPEED_BONUS_PER_STACK * this.stacks('G02'));
  }

  /** G03：K/L 百分比冷却缩减，单独也受 50% 上限约束。 */
  get cooldownReduction(): number {
    const raw = G03_COOLDOWN_REDUCTION_PER_STACK * this.stacks('G03');
    return clampCooldownReduction(raw);
  }

  /** 实际冷却是基础冷却乘以该倍率。 */
  get cooldownMultiplier(): number {
    return 1 - this.cooldownReduction;
  }

  /** G04 提供的最大生命加成（已获得层数 × 20）。 */
  get maxHealthBonus(): number {
    return G04_MAX_HEALTH_BONUS_PER_STACK * this.stacks('G04');
  }

  /** G03 百分比与 G08 返还合并后，剩余冷却不得低于基础的 60%。 */
  cooldownFloor(baseCooldownSeconds: number): number {
    if (!Number.isFinite(baseCooldownSeconds) || baseCooldownSeconds <= 0) return 0;
    return baseCooldownSeconds * (1 - COOLDOWN_REDUCTION_CAP);
  }

  /** 基础冷却按 G03 缩减后的值。 */
  effectiveCooldown(baseCooldownSeconds: number): number {
    if (!Number.isFinite(baseCooldownSeconds) || baseCooldownSeconds <= 0) return 0;
    return baseCooldownSeconds * this.cooldownMultiplier;
  }

  /** 获得强化时的即时效果；未知 ID 直接报错。 */
  onAcquire(upgradeId: string): AcquireUpgradeEffect {
    getUpgrade(upgradeId);
    if (upgradeId === 'G04') {
      return {
        maxHealthBonus: G04_MAX_HEALTH_BONUS_PER_STACK,
        heal: G04_HEAL_ON_ACQUIRE,
      };
    }
    return EMPTY_ACQUIRE_EFFECT;
  }

  /** G06：K 生效后登记一次待消耗的战术回响；未拥有时返回 false。 */
  armTacticalEcho(): boolean {
    if (!this.has('G06')) return false;
    this.echoRemainingValue = G06_EXPIRY_SECONDS;
    return true;
  }

  /** G06 剩余有效秒数；0 表示未登记或已失效。 */
  get echoRemainingSeconds(): number {
    return Math.max(0, this.echoRemainingValue);
  }

  get echoReady(): boolean {
    return this.echoRemainingValue > TIME_EPSILON;
  }

  /** 消耗一次已登记的回响；未登记或已过期返回 false。 */
  consumeTacticalEcho(): boolean {
    if (!this.echoReady) return false;
    this.echoRemainingValue = 0;
    return true;
  }

  /**
   * G05：自身击杀后的范围爆炸。
   * `allowTrigger=false` 时返回 null，因此爆炸自身的命中无法再次触发本卡。
   */
  resolveKillExplosion(
    center: { readonly x: number; readonly y: number },
    targets: readonly UpgradeDamageTarget[],
    options: AreaResolveOptions = {},
  ): KillExplosionResult | null {
    if (options.allowTrigger === false) return null;
    if (!this.has('G05')) return null;

    return {
      x: center.x,
      y: center.y,
      radius: G05_RADIUS,
      hits: this.damageWithin(
        center,
        G05_RADIUS,
        targets,
        G05_DAMAGE,
        'magic',
        options.lineOfSight,
        options.magicDamageMultiplier,
      ),
    };
  }

  /** G07：闪避终点的范围脉冲与减速；未拥有时返回 null。 */
  resolveDodgePulse(
    center: { readonly x: number; readonly y: number },
    targets: readonly UpgradeDamageTarget[],
    options: AreaResolveOptions = {},
  ): DodgePulseResult | null {
    if (!this.has('G07')) return null;

    const hits = this.damageWithin(
      center,
      G07_RADIUS,
      targets,
      G07_DAMAGE,
      'magic',
      options.lineOfSight,
      options.magicDamageMultiplier,
    );
    const slowUntil = this.elapsed + G07_SLOW_DURATION_SECONDS;
    for (const hit of hits) {
      this.slowUntil.set(
        hit.targetId,
        Math.max(this.slowUntil.get(hit.targetId) ?? 0, slowUntil),
      );
    }

    return {
      x: center.x,
      y: center.y,
      radius: G07_RADIUS,
      slowRemainingSeconds: G07_SLOW_DURATION_SECONDS,
      hits,
    };
  }

  /** G08：击杀时若对应技能仍在冷却，累计进度并返回本次减少的秒数。 */
  registerKill(context: {
    readonly kCooldownActive: boolean;
    readonly lCooldownActive: boolean;
  }): KillCooldownReduction {
    if (!this.has('G08')) return { k: 0, l: 0 };

    let k = 0;
    let l = 0;
    if (context.kCooldownActive) {
      this.kKillProgressValue += 1;
      if (this.kKillProgressValue >= G08_KILLS_PER_TRIGGER) {
        this.kKillProgressValue -= G08_KILLS_PER_TRIGGER;
        k = G08_COOLDOWN_REDUCTION_SECONDS;
      }
    }
    if (context.lCooldownActive) {
      this.lKillProgressValue += 1;
      if (this.lKillProgressValue >= G08_KILLS_PER_TRIGGER) {
        this.lKillProgressValue -= G08_KILLS_PER_TRIGGER;
        l = G08_COOLDOWN_REDUCTION_SECONDS;
      }
    }
    return { k, l };
  }

  /** 当前 K/L 冷却期间的击杀进度，供 HUD 与验收观察。 */
  get killProgress(): { readonly k: number; readonly l: number } {
    return { k: this.kKillProgressValue, l: this.lKillProgressValue };
  }

  /** 波中快照：G06 回响、G07 减速与 G08 击杀进度。 */
  snapshotWorld(): UpgradeEffectsWorldSnapshot {
    return {
      echoRemainingSeconds: this.echoRemainingSeconds,
      elapsedSeconds: this.elapsed,
      kKillProgress: this.kKillProgressValue,
      lKillProgress: this.lKillProgressValue,
      slows: [...this.slowUntil.entries()]
        .map(([targetId, until]) => ({
          targetId,
          remainingSeconds: Math.max(0, until - this.elapsed),
        }))
        .filter((entry) => entry.remainingSeconds > 0),
    };
  }

  /** 从波中快照恢复；减速到期时间按当前逻辑时钟换算。 */
  restoreWorld(state: UpgradeEffectsWorldSnapshot): void {
    this.elapsed = nonNegative(state.elapsedSeconds);
    this.echoRemainingValue = nonNegative(state.echoRemainingSeconds);
    this.kKillProgressValue = Number.isInteger(state.kKillProgress)
      ? Math.max(0, state.kKillProgress)
      : 0;
    this.lKillProgressValue = Number.isInteger(state.lKillProgress)
      ? Math.max(0, state.lKillProgress)
      : 0;
    this.slowUntil.clear();
    for (const slow of state.slows) {
      const remaining = nonNegative(slow.remainingSeconds);
      if (remaining > 0) this.slowUntil.set(slow.targetId, this.elapsed + remaining);
    }
  }

  /** G07 造成的减速剩余秒数。 */
  slowRemaining(targetId: string): number {
    const until = this.slowUntil.get(targetId);
    if (until === undefined) return 0;
    const remaining = until - this.elapsed;
    return remaining > TIME_EPSILON ? remaining : 0;
  }

  isSlowed(targetId: string): boolean {
    return this.slowRemaining(targetId) > 0;
  }

  /** G07 减速后的移速倍率；未被减速时为 1。 */
  slowMultiplier(targetId: string): number {
    return this.isSlowed(targetId) ? 1 - G07_SLOW_PERCENT : 1;
  }

  /** 推进回响有效期与减速计时；由固定逻辑步调用。 */
  step(seconds: number): void {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return;

    this.elapsed += seconds;
    if (this.echoRemainingValue > 0) {
      this.echoRemainingValue -= seconds;
      if (this.echoRemainingValue <= TIME_EPSILON) this.echoRemainingValue = 0;
    }
    for (const [targetId, until] of this.slowUntil) {
      if (until <= this.elapsed + TIME_EPSILON) this.slowUntil.delete(targetId);
    }
  }

  /** 对范围内仍存活且通视的目标结算伤害；G01 与领域法伤增伤各计入一次。 */
  private damageWithin(
    center: { readonly x: number; readonly y: number },
    radius: number,
    targets: readonly UpgradeDamageTarget[],
    rawDamage: number,
    damageType: DamageType,
    lineOfSight?: UpgradeLineOfSight,
    magicDamageMultiplier?: (targetId: string) => number,
  ): UpgradeAreaHit[] {
    const maxDistanceSquared = radius * radius;
    const damage = rawDamage * this.damageMultiplier;
    const hits: UpgradeAreaHit[] = [];

    for (const target of targets) {
      if (!target.isAlive) continue;
      if (distanceSquared(center, target) > maxDistanceSquared) continue;
      if (lineOfSight && !lineOfSight(center, target)) continue;
      const fieldMultiplier =
        damageType === 'magic'
          ? positiveOrOne(magicDamageMultiplier?.(target.id))
          : 1;
      hits.push({
        targetId: target.id,
        damage: target.applyDamage(damage * fieldMultiplier, damageType),
      });
    }
    return hits;
  }
}

/** 领域法伤倍率非法时回退到 1，避免一次配置错误吞掉整段伤害。 */
function positiveOrOne(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

/** 构筑面板用的一行效果摘要；数值与实际结算读取同一份 params。 */
export function describeUpgradeEffect(upgradeId: string, stacks: number): string {
  const count = Number.isFinite(stacks) ? Math.max(0, Math.floor(stacks)) : 0;
  if (count <= 0) return '';

  switch (upgradeId) {
    case 'G01':
      return `伤害 +${Math.round(count * G01_DAMAGE_BONUS_PER_STACK * 100)}%`;
    case 'G02':
      return `移速 +${Math.round(count * G02_MOVE_SPEED_BONUS_PER_STACK * 100)}%`;
    case 'G03': {
      const reduction = Math.min(
        COOLDOWN_REDUCTION_CAP,
        count * G03_COOLDOWN_REDUCTION_PER_STACK,
      );
      return `K/L 冷却 -${Math.round(reduction * 100)}%`;
    }
    case 'G04':
      return `最大生命 +${count * G04_MAX_HEALTH_BONUS_PER_STACK}`;
    case 'G05':
      return `击杀爆炸 ${G05_RADIUS}/${G05_DAMAGE}`;
    case 'G06':
      return `回响 ${G06_EXPIRY_SECONDS}s`;
    case 'G07':
      return `闪避脉冲 ${G07_RADIUS}/${G07_DAMAGE}`;
    case 'G08':
      return `每 ${G08_KILLS_PER_TRIGGER} 击杀 -${G08_COOLDOWN_REDUCTION_SECONDS}s`;
    default:
      return getUpgrade(upgradeId).description;
  }
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
