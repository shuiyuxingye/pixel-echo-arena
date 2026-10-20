/**
 * 维什戴尔 L「爆裂黎明」（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/game-design.md` §5.1：
 * - 冷却 30 秒；启动后接下来 6 发 J 的直接与余震伤害 +100%、溅射半径 +50%、
 *   发射间隔 1.1 秒；
 * - 弹药只在 J 实际射出时扣除，20 秒未用完即失效；
 * - 冷却中重复触发不重置弹药与冷却。
 *
 * W04 追加装药（`docs/game-design.md` §6.3）：弹药 6→9，最后一发溅射半径额外 +25%。
 *
 * 时间按固定逻辑步长的秒数累计；强化后的攻击定义由 `modifyAttack` 生成，
 * 场景把它交给弹体与榴弹系统，避免在多个模块里散落倍率计算。
 */
import { requireUpgradeParam, type AttackDefinition } from './data';
import type { BurstWorldSnapshot } from './world-snapshot';

/** 浮点累计容差。 */
const TIME_EPSILON = 1e-9;

/** W04 的弹药数与最后一发范围加成。 */
export const W04_SHOTS = Math.max(1, Math.floor(requireUpgradeParam('W04', 'shots')));
export const W04_LAST_SHOT_RADIUS_BONUS = requireUpgradeParam(
  'W04',
  'lastShotRadiusBonus',
);

export interface BurstConfig {
  readonly cooldownSeconds: number;
  /** 启动时获得并逐发消耗的弹药数。 */
  readonly shots: number;
  /** 直接与余震伤害倍率（+100% → 2）。 */
  readonly damageMultiplier: number;
  /** 直接溅射半径倍率（+50% → 1.5）。 */
  readonly splashRadiusMultiplier: number;
  /** 强化弹药的发射间隔（秒）。 */
  readonly fireIntervalSeconds: number;
  /** 弹药失效时间（秒），从启动时起算。 */
  readonly ammoExpirySeconds: number;
}

/**
 * 爆裂黎明状态机：冷却、弹药、逐发消耗与超时失效。
 * 只由固定逻辑步调用 `step`；`consumeShot` 必须在 J 真正射出时调用。
 */
export class BurstSystem {
  private readonly config: BurstConfig;
  private elapsed = 0;
  private cooldownSeconds = 0;
  private cooldownMultiplier = 1;
  private ammo = 0;
  private expiresAt = 0;
  /** W04 提供的额外弹药数。 */
  private bonusShots = 0;
  /** W04 最后一发的额外溅射半径比例；0 表示未拥有。 */
  private lastShotRadiusBonus = 0;

  constructor(config: BurstConfig) {
    if (!(config.cooldownSeconds > 0) || !Number.isFinite(config.cooldownSeconds)) {
      throw new Error('BurstSystem requires a positive cooldownSeconds');
    }
    if (!Number.isInteger(config.shots) || config.shots < 1) {
      throw new Error('BurstSystem requires shots >= 1');
    }
    if (!(config.damageMultiplier > 0) || !Number.isFinite(config.damageMultiplier)) {
      throw new Error('BurstSystem requires a positive damageMultiplier');
    }
    if (
      !(config.splashRadiusMultiplier > 0) ||
      !Number.isFinite(config.splashRadiusMultiplier)
    ) {
      throw new Error('BurstSystem requires a positive splashRadiusMultiplier');
    }
    if (!(config.fireIntervalSeconds > 0) || !Number.isFinite(config.fireIntervalSeconds)) {
      throw new Error('BurstSystem requires a positive fireIntervalSeconds');
    }
    if (!(config.ammoExpirySeconds > 0) || !Number.isFinite(config.ammoExpirySeconds)) {
      throw new Error('BurstSystem requires a positive ammoExpirySeconds');
    }

    this.config = config;
  }

  get cooldownRemaining(): number {
    return Math.max(0, this.cooldownSeconds);
  }

  /** 更新 G03 的冷却倍率；只影响之后启动的冷却，不追溯当前剩余时间。 */
  setCooldownMultiplier(multiplier: number): void {
    this.cooldownMultiplier =
      Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  }

  /** G08 返还剩余冷却；`minimumSeconds` 为 40% 冷却缩减上限对应的下限。 */
  reduceCooldown(seconds: number, minimumSeconds = 0): void {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return;
    if (this.cooldownSeconds <= TIME_EPSILON) return;
    const minimum = Number.isFinite(minimumSeconds) ? Math.max(0, minimumSeconds) : 0;
    // 剩余冷却已到 40% 缩减下限或更低时不再返还，也不允许反向抬高。
    if (this.cooldownSeconds <= minimum + TIME_EPSILON) return;
    this.cooldownSeconds = Math.max(minimum, this.cooldownSeconds - seconds);
  }

  get ammoRemaining(): number {
    return this.ammo;
  }

  get maxAmmo(): number {
    return this.config.shots + this.bonusShots;
  }

  /**
   * W04：把弹药上限提升到 9，并让最后一发额外扩大溅射半径。
   * 强化到手时若爆发仍在生效，立即把新增弹药补进当前弹匣，但不刷新失效时间。
   */
  setAmmoUpgrade(enabled: boolean): void {
    const nextBonus = enabled ? Math.max(0, W04_SHOTS - this.config.shots) : 0;
    const delta = nextBonus - this.bonusShots;
    this.bonusShots = nextBonus;
    this.lastShotRadiusBonus = enabled ? W04_LAST_SHOT_RADIUS_BONUS : 0;

    if (this.ammo > 0) {
      this.ammo = delta > 0 ? this.ammo + delta : this.ammo;
    }
    this.ammo = Math.min(this.ammo, this.maxAmmo);
  }

  /** 下一发若为爆裂黎明的最后一发，则范围额外扩大。 */
  get nextShotIsLast(): boolean {
    return this.ammo === 1;
  }

  get isActive(): boolean {
    return this.ammo > 0;
  }

  /** 剩余有效时间（秒）；无弹药时为 0。 */
  get ammoExpiresInSeconds(): number {
    return this.ammo > 0 ? Math.max(0, this.expiresAt - this.elapsed) : 0;
  }

  get fireIntervalSeconds(): number {
    return this.config.fireIntervalSeconds;
  }

  get damageMultiplier(): number {
    return this.config.damageMultiplier;
  }

  get splashRadiusMultiplier(): number {
    return this.config.splashRadiusMultiplier;
  }

  /** 波中快照：冷却、剩余弹药与失效倒计时。 */
  snapshotWorld(): BurstWorldSnapshot {
    return {
      elapsedSeconds: this.elapsed,
      cooldownSeconds: this.cooldownRemaining,
      ammo: this.ammo,
      ammoRemainingSeconds: this.ammoExpiresInSeconds,
      bonusShots: this.bonusShots,
      lastShotRadiusBonus: this.lastShotRadiusBonus,
    };
  }

  /** 从波中快照恢复：失效时间按当前逻辑时钟换算为绝对时间。 */
  restoreWorld(state: BurstWorldSnapshot): void {
    this.elapsed = nonNegative(state.elapsedSeconds);
    this.cooldownSeconds = nonNegative(state.cooldownSeconds);
    this.ammo = Number.isInteger(state.ammo) ? Math.max(0, state.ammo) : 0;
    this.expiresAt = this.elapsed + nonNegative(state.ammoRemainingSeconds);
    this.bonusShots = Number.isInteger(state.bonusShots)
      ? Math.max(0, state.bonusShots)
      : 0;
    this.lastShotRadiusBonus = nonNegative(state.lastShotRadiusBonus);
  }

  /** 冷却中返回 false，不重置弹药与失效计时。 */
  tryActivate(): boolean {
    if (this.cooldownRemaining > TIME_EPSILON) return false;

    this.ammo = this.maxAmmo;
    this.expiresAt = this.elapsed + this.config.ammoExpirySeconds;
    this.cooldownSeconds = this.config.cooldownSeconds * this.cooldownMultiplier;
    return true;
  }

  /**
   * 一发 J 实际射出时调用：有弹药则消耗一发并返回 true（本发为强化弹）。
   * 未射出不调用，因此空射与冷却等待都不会扣弹。
   */
  consumeShot(): boolean {
    if (this.ammo <= 0) return false;
    this.ammo -= 1;
    return true;
  }

  /** 推进逻辑时间：冷却衰减与弹药超时失效。 */
  step(stepSeconds: number): void {
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) return;

    this.elapsed += stepSeconds;

    if (this.cooldownSeconds > 0) {
      this.cooldownSeconds -= stepSeconds;
      if (this.cooldownSeconds <= TIME_EPSILON) this.cooldownSeconds = 0;
    }

    if (this.ammo > 0 && this.elapsed + TIME_EPSILON >= this.expiresAt) {
      this.ammo = 0;
    }
  }

  /**
   * 生成强化后的攻击定义；不改动传入对象。
   * `lastShot=true` 时若拥有 W04，最后一发的溅射半径再额外 +25%。
   */
  modifyAttack(attack: AttackDefinition, lastShot = false): AttackDefinition {
    const lastShotMultiplier =
      lastShot && this.lastShotRadiusBonus > 0 ? 1 + this.lastShotRadiusBonus : 1;
    return {
      ...attack,
      damage: attack.damage * this.config.damageMultiplier,
      splashRadius:
        attack.splashRadius === undefined
          ? undefined
          : attack.splashRadius * this.config.splashRadiusMultiplier * lastShotMultiplier,
      aftershock: attack.aftershock
        ? {
            ...attack.aftershock,
            damage: attack.aftershock.damage * this.config.damageMultiplier,
          }
        : undefined,
    };
  }
}

/**
 * 爆裂黎明 HUD 文本。弹药上限随 W04 变化，场景与测试读同一入口，
 * 保证「追加装药」获得的第 7–9 发在 HUD 上同步显示。
 */
export function burstHudText(burst: BurstSystem): string {
  if (burst.ammoRemaining > 0) {
    return `爆裂黎明 弹药 ${burst.ammoRemaining}/${burst.maxAmmo} · ${burst.ammoExpiresInSeconds.toFixed(1)}s`;
  }
  if (burst.cooldownRemaining > 0) {
    return `爆裂黎明 冷却 ${burst.cooldownRemaining.toFixed(1)}s`;
  }
  return '爆裂黎明 就绪';
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
