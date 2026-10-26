/**
 * 阿米娅技能规则（纯逻辑，不依赖 Phaser）。
 *
 * - 被动「情绪吸收」：每 5 次 J 对敌命中，使 K 当前剩余冷却减少 1 秒；
 *   同一发弹体命中多个敌人只累计一次。
 * - K「精神爆发」：冷却 9 秒，0.8 秒内连续发射 6 发、每发 14 法伤；
 *   每发沿真正发射瞬间的当前面向飞出，不追踪目标；
 *   结束后 0.5 秒不能 J，但不限制移动与闪避。
 * - L「奇美拉」：冷却 30 秒、持续 8 秒；期间 J/K 转为真实伤害且伤害 +60%；
 *   结束后 3 秒虚弱：移速 −25%、不能 K/L，但仍可 J 与闪避。
 * - 专属强化 A01–A04（`docs/game-design.md` §6.3）：穿透、情绪吸收阈值、
 *   K 延迟追加连射与奇美拉持续时间/虚弱减速。
 *
 * 数值来自 `src/game/data/characters.ts` 与 `docs/game-design.md` §5.2。
 */
import type { ProjectilePierceOptions } from './combat';
import { requireUpgradeParam, type AttackDefinition, type DamageType } from './data';
import type { Facing } from './movement';
import type { AmiyaWorldSnapshot } from './world-snapshot';

/** 每多少次 J 命中触发一次情绪吸收（未获得 A02 时）。 */
export const EMOTIONAL_ABSORPTION_HITS = 5;
/** 每次情绪吸收减少的 K 剩余冷却（秒）。 */
export const EMOTIONAL_ABSORPTION_COOLDOWN_SECONDS = 1;

/** A01 穿透术式：J 额外穿透的目标数与后续命中伤害比例。 */
export const A01_EXTRA_PIERCE = Math.max(
  0,
  Math.floor(requireUpgradeParam('A01', 'extraPierce')),
);
export const A01_SUBSEQUENT_DAMAGE_RATIO = requireUpgradeParam(
  'A01',
  'subsequentDamageRatio',
);

/** A02 心绪共鸣：情绪吸收触发所需的 J 命中数。 */
export const A02_HITS_PER_TRIGGER = Math.max(
  1,
  Math.floor(requireUpgradeParam('A02', 'hitsPerTrigger')),
);

/** A03 双重吟唱：K 结束后的追加延迟、发数与每发伤害比例。 */
export const A03_DELAY_SECONDS = requireUpgradeParam('A03', 'delaySeconds');
export const A03_SHOTS = Math.max(1, Math.floor(requireUpgradeParam('A03', 'shots')));
export const A03_DAMAGE_RATIO = requireUpgradeParam('A03', 'damageRatio');

/** A04 意志余辉：奇美拉持续时间与虚弱是否移除减速。 */
export const A04_CHIMERA_DURATION_SECONDS = requireUpgradeParam(
  'A04',
  'durationSeconds',
);
export const A04_WEAKNESS_SLOW_REMOVED =
  requireUpgradeParam('A04', 'weaknessSlowRemoved') > 0;

/** A01 拥有时 J 的穿透参数；场景在发射瞬间调用，未拥有返回 null。 */
export function amiyaJPierce(stacks: number): ProjectilePierceOptions | null {
  if (!Number.isFinite(stacks) || Math.floor(stacks) <= 0) return null;
  return {
    extraTargets: A01_EXTRA_PIERCE,
    subsequentDamageRatio: A01_SUBSEQUENT_DAMAGE_RATIO,
  };
}

/** 浮点累计容差，避免 0.8 秒这类定时留下 1e-16 残差。 */
const TIME_EPSILON = 1e-9;

export interface AmiyaCombatConfig {
  readonly kCooldownSeconds: number;
  readonly burstDurationSeconds: number;
  readonly shots: number;
  readonly damagePerShot: number;
  readonly fatigueSeconds: number;
  /** K 的基础伤害类型；奇美拉期间改为 true。 */
  readonly burstDamageType?: DamageType;
  readonly chimeraCooldownSeconds: number;
  readonly chimeraDurationSeconds: number;
  /** 奇美拉期间 J/K 的增伤比例，例如 0.6 表示 +60%。 */
  readonly chimeraDamageBonus: number;
  readonly weaknessSeconds: number;
  /** 虚弱期间的移速倍率，例如 0.75 表示 −25%。 */
  readonly weaknessMoveSpeedMultiplier: number;
}

/** 一次精神爆发的单发术式：伤害、类型与发射瞬间的面向在创建时固定。 */
export interface AmiyaBurstShot {
  /** 本次爆发中的第几发，从 0 开始。 */
  readonly index: number;
  readonly damage: number;
  readonly damageType: DamageType;
  /** 本发是否在奇美拉期间射出（真实伤害 + 增伤）。 */
  readonly empowered: boolean;
  /** 发射瞬间的当前面向；之后转身不会改变这发的方向。 */
  readonly facing: Facing;
  /** burst 为 K 本体连射，doubleCast 为 A03 结束后的追加连射。 */
  readonly source: 'burst' | 'doubleCast';
}

export interface EmotionalAbsorptionEvent {
  /** 本发是否首次计入（同一弹体 ID 重复上报为 false）。 */
  readonly counted: boolean;
  /** 累计计入的 J 命中次数。 */
  readonly totalHits: number;
  /** 当前进度 0–4；累计到 5 触发后归零。 */
  readonly progress: number;
  /** 本次实际减少的 K 剩余冷却秒数；K 已就绪时为 0。 */
  readonly cooldownReducedSeconds: number;
}

/**
 * 阿米娅的 K 冷却、爆发连射、疲劳窗口与情绪吸收计数。
 * 场景每个固定逻辑步调用一次 `step(stepSeconds, 当前面向)`，
 * 返回本步应发射的爆发弹；方向在发射时读取，之后转身不影响已发出的弹。
 */
export class AmiyaCombat {
  private readonly config: AmiyaCombatConfig;
  private readonly burstDamageType: DamageType;
  private cooldownSeconds = 0;
  private cooldownMultiplier = 1;
  /** I15：技能持续时间倍率（奇美拉）；爆发窗口的固定 0.8 秒不随之改变。 */
  private durationMultiplier = 1;
  private burstElapsed = 0;
  private burstActive = false;
  private burstShotsFired = 0;
  private fatigueSeconds = 0;
  private chimeraCooldownSeconds = 0;
  private chimeraRemainingSeconds = 0;
  private weaknessRemainingSeconds = 0;
  private totalJHits = 0;
  private emotionalAbsorptionHitsPerTrigger = EMOTIONAL_ABSORPTION_HITS;
  private chimeraDurationOverride: number | null = null;
  private weaknessSecondsOverride: number | null = null;
  private weaknessSlowRemoved = false;
  /** H36：奇美拉结束后额外禁 J 的秒数；0 表示没有该效果。 */
  private aftermathJLockSeconds = 0;
  /** H36：当前奇美拉结束后的禁 J 剩余秒数。 */
  private jLockSeconds = 0;
  private doubleCast: {
    readonly delaySeconds: number;
    readonly shots: number;
    readonly damageRatio: number;
  } | null = null;
  private followupPending = false;
  private followupRemainingSeconds = 0;
  private readonly countedProjectileIds = new Set<number>();

  constructor(config: AmiyaCombatConfig) {
    if (!(config.kCooldownSeconds > 0) || !Number.isFinite(config.kCooldownSeconds)) {
      throw new Error('AmiyaCombat requires a positive kCooldownSeconds');
    }
    if (!(config.burstDurationSeconds > 0) || !Number.isFinite(config.burstDurationSeconds)) {
      throw new Error('AmiyaCombat requires a positive burstDurationSeconds');
    }
    if (!Number.isInteger(config.shots) || config.shots < 1) {
      throw new Error('AmiyaCombat requires shots >= 1');
    }
    if (!(config.damagePerShot > 0) || !Number.isFinite(config.damagePerShot)) {
      throw new Error('AmiyaCombat requires a positive damagePerShot');
    }
    if (!(config.fatigueSeconds >= 0) || !Number.isFinite(config.fatigueSeconds)) {
      throw new Error('AmiyaCombat requires fatigueSeconds >= 0');
    }
    if (!(config.chimeraCooldownSeconds > 0) || !Number.isFinite(config.chimeraCooldownSeconds)) {
      throw new Error('AmiyaCombat requires a positive chimeraCooldownSeconds');
    }
    if (!(config.chimeraDurationSeconds > 0) || !Number.isFinite(config.chimeraDurationSeconds)) {
      throw new Error('AmiyaCombat requires a positive chimeraDurationSeconds');
    }
    if (!(config.chimeraDamageBonus >= 0) || !Number.isFinite(config.chimeraDamageBonus)) {
      throw new Error('AmiyaCombat requires chimeraDamageBonus >= 0');
    }
    if (!(config.weaknessSeconds >= 0) || !Number.isFinite(config.weaknessSeconds)) {
      throw new Error('AmiyaCombat requires weaknessSeconds >= 0');
    }
    if (
      !(config.weaknessMoveSpeedMultiplier > 0) ||
      config.weaknessMoveSpeedMultiplier > 1 ||
      !Number.isFinite(config.weaknessMoveSpeedMultiplier)
    ) {
      throw new Error('AmiyaCombat requires weaknessMoveSpeedMultiplier in (0, 1]');
    }
    this.config = config;
    this.burstDamageType = config.burstDamageType ?? 'magic';
  }

  get kCooldownRemaining(): number {
    return Math.max(0, this.cooldownSeconds);
  }

  /** 奇美拉剩余冷却；从启动瞬间开始计时。 */
  get lCooldownRemaining(): number {
    return Math.max(0, this.chimeraCooldownSeconds);
  }

  get isChimeraActive(): boolean {
    return this.chimeraRemainingSeconds > TIME_EPSILON;
  }

  get chimeraRemaining(): number {
    return Math.max(0, this.chimeraRemainingSeconds);
  }

  /** 奇美拉结束后的虚弱窗口：不能 K/L，但 J、移动与闪避正常。 */
  get isWeaknessActive(): boolean {
    return this.weaknessRemainingSeconds > TIME_EPSILON;
  }

  get weaknessRemaining(): number {
    return Math.max(0, this.weaknessRemainingSeconds);
  }

  /** 本次奇美拉结束后的虚弱时长（基础值或 H34 覆盖值）。 */
  get weaknessSeconds(): number {
    return this.weaknessSecondsOverride ?? this.config.weaknessSeconds;
  }

  /** 虚弱期间的移速倍率（0.75 = −25%）；A04 移除减速后恒为 1。 */
  get moveSpeedMultiplier(): number {
    return this.isWeaknessActive && !this.weaknessSlowRemoved
      ? this.config.weaknessMoveSpeedMultiplier
      : 1;
  }

  /** A04 生效后奇美拉的实际持续时间（秒）。 */
  get chimeraDurationSeconds(): number {
    return (
      (this.chimeraDurationOverride ?? this.config.chimeraDurationSeconds) *
      this.durationMultiplier
    );
  }

  get isBurstActive(): boolean {
    return this.burstActive;
  }

  /** 爆发结束后的 0.5 秒疲劳：只锁 J，不锁移动与闪避。 */
  get isJFiringLocked(): boolean {
    return this.fatigueSeconds > TIME_EPSILON || this.jLockSeconds > TIME_EPSILON;
  }

  get fatigueRemaining(): number {
    return Math.max(0, this.fatigueSeconds);
  }

  /** H36：奇美拉结束后的禁 J 剩余秒数；与疲劳分开显示。 */
  get chimeraJLockRemaining(): number {
    return Math.max(0, this.jLockSeconds);
  }

  /** J 锁定剩余：疲劳与 H36 禁 J 取较晚到期者，供 HUD 显示。 */
  get jFiringLockRemaining(): number {
    return Math.max(this.fatigueRemaining, this.chimeraJLockRemaining);
  }

  get shotsFiredInBurst(): number {
    return this.burstShotsFired;
  }

  get totalShotsPerBurst(): number {
    return this.config.shots;
  }

  /** 波中快照：K/L 冷却、爆发进度、疲劳、奇美拉/虚弱与情绪吸收计数。 */
  snapshotWorld(): AmiyaWorldSnapshot {
    return {
      cooldownSeconds: this.kCooldownRemaining,
      burstElapsedSeconds: this.burstElapsed,
      burstActive: this.burstActive,
      burstShotsFired: this.burstShotsFired,
      fatigueSeconds: this.fatigueSeconds,
      chimeraCooldownSeconds: this.chimeraCooldownSeconds,
      chimeraRemainingSeconds: this.chimeraRemainingSeconds,
      weaknessRemainingSeconds: this.weaknessRemainingSeconds,
      // H36 的禁 J 窗口随世界快照恢复；旧快照缺省为 0。
      chimeraJLockRemainingSeconds: this.chimeraJLockRemaining,
      totalJHits: this.totalJHits,
      countedProjectileIds: [...this.countedProjectileIds],
      followupPending: this.followupPending,
      followupRemainingSeconds: this.followupRemainingSeconds,
    };
  }

  /** 从波中快照恢复；A02–A04 的配置由场景按已选强化重新同步，不落盘。 */
  restoreWorld(state: AmiyaWorldSnapshot): void {
    this.cooldownSeconds = nonNegative(state.cooldownSeconds);
    this.burstElapsed = nonNegative(state.burstElapsedSeconds);
    this.burstActive = state.burstActive === true;
    this.burstShotsFired = Number.isInteger(state.burstShotsFired)
      ? Math.max(0, Math.min(this.config.shots, state.burstShotsFired))
      : 0;
    this.fatigueSeconds = nonNegative(state.fatigueSeconds);
    this.chimeraCooldownSeconds = nonNegative(state.chimeraCooldownSeconds);
    this.chimeraRemainingSeconds = nonNegative(state.chimeraRemainingSeconds);
    this.weaknessRemainingSeconds = nonNegative(state.weaknessRemainingSeconds);
    this.jLockSeconds = nonNegative(
      state.chimeraJLockRemainingSeconds ?? 0,
    );
    this.totalJHits = Number.isInteger(state.totalJHits)
      ? Math.max(0, state.totalJHits)
      : 0;
    this.countedProjectileIds.clear();
    for (const id of state.countedProjectileIds) {
      if (Number.isInteger(id) && id > 0) this.countedProjectileIds.add(id);
    }
    this.followupPending = state.followupPending === true;
    this.followupRemainingSeconds = nonNegative(state.followupRemainingSeconds);
  }

  get emotionalAbsorptionHits(): number {
    return this.totalJHits;
  }

  get emotionalAbsorptionProgress(): number {
    return this.totalJHits % this.emotionalAbsorptionHitsPerTrigger;
  }

  /** A02 生效时情绪吸收的触发阈值；HUD 与测试读取同一入口。 */
  get emotionalAbsorptionThreshold(): number {
    return this.emotionalAbsorptionHitsPerTrigger;
  }

  /** A02：把情绪吸收阈值从 5 改为 3；非正数输入忽略。 */
  setEmotionalAbsorptionHits(hitsPerTrigger: number): void {
    if (!Number.isFinite(hitsPerTrigger)) return;
    this.emotionalAbsorptionHitsPerTrigger = Math.max(1, Math.floor(hitsPerTrigger));
  }

  /** A04：覆盖奇美拉持续时间；传 null 恢复基础值。 */
  setChimeraDuration(seconds: number | null): void {
    if (seconds === null) {
      this.chimeraDurationOverride = null;
      return;
    }
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.chimeraDurationOverride = seconds;
  }

  /** A04：虚弱期仍禁用 K/L，但不再降低移速。 */
  setWeaknessSlowRemoved(removed: boolean): void {
    this.weaknessSlowRemoved = removed;
  }

  /**
   * H34：覆盖奇美拉结束后的虚弱时长（秒）；传 null 恢复基础值。
   * 只影响之后结束的奇美拉，已在倒计时的虚弱保持不变。
   */
  setWeaknessSeconds(seconds: number | null): void {
    if (seconds === null) {
      this.weaknessSecondsOverride = null;
      return;
    }
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.weaknessSecondsOverride = seconds;
  }

  /**
   * H36：奇美拉结束后额外禁 J 的秒数；0 关闭。
   * 只影响之后结束的奇美拉，不追溯当前窗口。
   */
  setChimeraAftermathJLock(seconds: number): void {
    this.aftermathJLockSeconds =
      Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  }

  /**
   * A03：开启 K 结束后的延迟追加连射；关闭时清掉尚未发射的追加弹。
   * 追加连射不重新进入 burst 状态，也不刷新疲劳。
   */
  setDoubleCast(enabled: boolean): void {
    this.doubleCast = enabled
      ? {
          delaySeconds: A03_DELAY_SECONDS,
          shots: A03_SHOTS,
          damageRatio: A03_DAMAGE_RATIO,
        }
      : null;
    if (!enabled) {
      this.followupPending = false;
      this.followupRemainingSeconds = 0;
    }
  }

  /** A03 待发射的追加连射剩余延迟；0 表示没有排队的追加。 */
  get doubleCastRemainingSeconds(): number {
    return this.followupPending ? Math.max(0, this.followupRemainingSeconds) : 0;
  }

  /** 更新 G03 的冷却倍率；只影响之后启动的冷却，不追溯当前剩余时间。 */
  setCooldownMultiplier(multiplier: number): void {
    this.cooldownMultiplier =
      Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  }

  /** I15：技能持续时间倍率；只影响之后启动的奇美拉。 */
  setDurationMultiplier(multiplier: number): void {
    this.durationMultiplier =
      Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  }

  /**
   * G08 与情绪吸收共用的剩余冷却返还。
   * `minimumSeconds` 为冷却缩减上限对应的下限；已到下限时不再返还，也不回抬。
   * 返回实际减少的秒数。
   */
  reduceCooldown(seconds: number, minimumSeconds = 0): number {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return 0;
    if (this.cooldownSeconds <= TIME_EPSILON) return 0;
    const minimum = Number.isFinite(minimumSeconds) ? Math.max(0, minimumSeconds) : 0;
    if (this.cooldownSeconds <= minimum + TIME_EPSILON) return 0;

    const next = Math.max(minimum, this.cooldownSeconds - seconds);
    const reduced = this.cooldownSeconds - next;
    this.cooldownSeconds = next <= TIME_EPSILON ? 0 : next;
    return reduced;
  }

  /**
   * 奇美拉期间把 J/K 的攻击改写为真实伤害并提高伤害；其余时间原样返回。
   * 返回值在发射瞬间固定，之后奇美拉结束不会追溯已飞出的弹体。
   */
  modifyAttack(attack: AttackDefinition): AttackDefinition {
    if (!this.isChimeraActive) return attack;
    return {
      ...attack,
      damage: attack.damage * (1 + this.config.chimeraDamageBonus),
      damageType: 'true',
    };
  }

  /** G08 的 L 冷却返还；语义与 K 一致，已到下限时不返还也不回抬。 */
  reduceLCooldown(seconds: number, minimumSeconds = 0): number {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return 0;
    if (this.chimeraCooldownSeconds <= TIME_EPSILON) return 0;
    const minimum = Number.isFinite(minimumSeconds) ? Math.max(0, minimumSeconds) : 0;
    if (this.chimeraCooldownSeconds <= minimum + TIME_EPSILON) return 0;

    const next = Math.max(minimum, this.chimeraCooldownSeconds - seconds);
    const reduced = this.chimeraCooldownSeconds - next;
    this.chimeraCooldownSeconds = next <= TIME_EPSILON ? 0 : next;
    return reduced;
  }

  /**
   * 进入下一波：清空 K/L 剩余冷却，并结束爆发、奇美拉、虚弱与疲劳，
   * 保证两个技能在下一波开始即可施放。
   */
  resetForWaveStart(): void {
    this.cooldownSeconds = 0;
    this.chimeraCooldownSeconds = 0;
    this.clearTemporaryEffects();
  }

  /** 启动精神爆发；冷却中、爆发中或虚弱期返回 false。 */
  tryActivateK(): boolean {
    if (this.isWeaknessActive || this.burstActive || this.kCooldownRemaining > TIME_EPSILON) {
      return false;
    }

    this.cooldownSeconds = this.config.kCooldownSeconds * this.cooldownMultiplier;
    this.burstActive = true;
    this.burstElapsed = 0;
    this.burstShotsFired = 0;
    this.fatigueSeconds = 0;
    return true;
  }

  /** 启动奇美拉；冷却中、已生效或虚弱期返回 false。 */
  tryActivateL(): boolean {
    if (
      this.isChimeraActive ||
      this.isWeaknessActive ||
      this.lCooldownRemaining > TIME_EPSILON
    ) {
      return false;
    }

    this.chimeraCooldownSeconds =
      this.config.chimeraCooldownSeconds * this.cooldownMultiplier;
    this.chimeraRemainingSeconds = this.chimeraDurationSeconds;
    return true;
  }

  /**
   * 清除临时状态（死亡/重开边界）：奇美拉真伤、虚弱、连射与疲劳。
   * 技能冷却保留；新一局的实例本身即为全空状态。
   */
  clearTemporaryEffects(): void {
    this.chimeraRemainingSeconds = 0;
    this.weaknessRemainingSeconds = 0;
    this.burstActive = false;
    this.burstElapsed = 0;
    this.burstShotsFired = 0;
    this.fatigueSeconds = 0;
    this.jLockSeconds = 0;
    this.followupPending = false;
    this.followupRemainingSeconds = 0;
  }

  /**
   * 推进一个逻辑步：先结算冷却、疲劳、虚弱与奇美拉计时，再按
   * “第几发应在何时射出”补发爆发弹；每发读取本步发射瞬间的奇美拉状态。
   * 每发使用调用方传入的当前面向；不会读取任何目标，因此目标死亡不改弹道。
   */
  step(stepSeconds: number, facing: Facing): readonly AmiyaBurstShot[] {
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) return [];

    if (this.cooldownSeconds > 0) {
      this.cooldownSeconds -= stepSeconds;
      if (this.cooldownSeconds <= TIME_EPSILON) this.cooldownSeconds = 0;
    }

    if (this.chimeraCooldownSeconds > 0) {
      this.chimeraCooldownSeconds -= stepSeconds;
      if (this.chimeraCooldownSeconds <= TIME_EPSILON) this.chimeraCooldownSeconds = 0;
    }

    if (this.fatigueSeconds > 0) {
      this.fatigueSeconds -= stepSeconds;
      if (this.fatigueSeconds <= TIME_EPSILON) this.fatigueSeconds = 0;
    }

    // H36 的禁 J 窗口与疲劳分开计时，结束时不覆盖疲劳的剩余时长。
    if (this.jLockSeconds > 0) {
      this.jLockSeconds -= stepSeconds;
      if (this.jLockSeconds <= TIME_EPSILON) this.jLockSeconds = 0;
    }

    // 先衰减已有虚弱，再推进奇美拉；奇美拉在这一步结束时才开始新的虚弱窗口。
    if (this.weaknessRemainingSeconds > 0) {
      this.weaknessRemainingSeconds -= stepSeconds;
      if (this.weaknessRemainingSeconds <= TIME_EPSILON) this.weaknessRemainingSeconds = 0;
    }

    if (this.chimeraRemainingSeconds > 0) {
      this.chimeraRemainingSeconds -= stepSeconds;
      if (this.chimeraRemainingSeconds <= TIME_EPSILON) {
        this.chimeraRemainingSeconds = 0;
        this.weaknessRemainingSeconds = this.weaknessSeconds;
        // H36 失控奇美拉：结束后 2 秒不能 J；与虚弱同时开始、互不覆盖。
        if (this.aftermathJLockSeconds > 0) {
          this.jLockSeconds = Math.max(
            this.jLockSeconds,
            this.aftermathJLockSeconds,
          );
        }
      }
    }

    // A03 延迟追加连射：在 K 结束后按当前面向齐射，不重新进入 burst 状态，
    // 也不刷新或延长疲劳；arming 发生在下面 burst 结束的同一逻辑步，本步不会自减。
    const shots: AmiyaBurstShot[] = [];
    if (this.followupPending) {
      this.followupRemainingSeconds -= stepSeconds;
      if (this.followupRemainingSeconds <= TIME_EPSILON) {
        this.followupPending = false;
        this.followupRemainingSeconds = 0;
        this.pushDoubleCastShots(shots, facing);
      }
    }

    if (!this.burstActive) return shots;

    this.burstElapsed += stepSeconds;
    const interval = this.config.burstDurationSeconds / this.config.shots;
    const empowered = this.isChimeraActive;

    const pushShot = (): void => {
      shots.push({
        index: this.burstShotsFired,
        damage:
          this.config.damagePerShot *
          (empowered ? 1 + this.config.chimeraDamageBonus : 1),
        damageType: empowered ? 'true' : this.burstDamageType,
        empowered,
        facing,
        source: 'burst',
      });
      this.burstShotsFired += 1;
    };

    while (
      this.burstShotsFired < this.config.shots &&
      this.burstShotsFired * interval <= this.burstElapsed + TIME_EPSILON
    ) {
      pushShot();
    }

    if (this.burstElapsed >= this.config.burstDurationSeconds - TIME_EPSILON) {
      // 浮点间隔下若仍有剩余发数，在爆发结束的这一步全部补发。
      while (this.burstShotsFired < this.config.shots) {
        pushShot();
      }
      this.burstActive = false;
      this.fatigueSeconds = this.config.fatigueSeconds;
      if (this.doubleCast) {
        this.followupPending = true;
        this.followupRemainingSeconds = this.doubleCast.delaySeconds;
      }
    }

    return shots;
  }

  /** A03 追加弹：每发为 K 原始单发伤害的固定比例，独立于 burst 发数计数。 */
  private pushDoubleCastShots(shots: AmiyaBurstShot[], facing: Facing): void {
    const config = this.doubleCast;
    if (!config) return;
    const empowered = this.isChimeraActive;
    const damage =
      this.config.damagePerShot *
      config.damageRatio *
      (empowered ? 1 + this.config.chimeraDamageBonus : 1);
    for (let index = 0; index < config.shots; index += 1) {
      shots.push({
        index,
        damage,
        damageType: empowered ? 'true' : this.burstDamageType,
        empowered,
        facing,
        source: 'doubleCast',
      });
    }
  }

  /**
   * 记录一次 J 对敌命中。同一发弹体（按 ID）只累计一次；
   * 每满阈值（默认 5，A02 后为 3）次使 K 当前剩余冷却减少 1 秒。
   */
  registerJHit(projectileId: number): EmotionalAbsorptionEvent {
    if (
      !Number.isFinite(projectileId) ||
      this.countedProjectileIds.has(projectileId)
    ) {
      return {
        counted: false,
        totalHits: this.totalJHits,
        progress: this.emotionalAbsorptionProgress,
        cooldownReducedSeconds: 0,
      };
    }

    this.countedProjectileIds.add(projectileId);
    this.totalJHits += 1;

    let cooldownReducedSeconds = 0;
    if (this.totalJHits % this.emotionalAbsorptionHitsPerTrigger === 0) {
      cooldownReducedSeconds = this.reduceCooldown(
        EMOTIONAL_ABSORPTION_COOLDOWN_SECONDS,
      );
    }

    return {
      counted: true,
      totalHits: this.totalJHits,
      progress: this.emotionalAbsorptionProgress,
      cooldownReducedSeconds,
    };
  }
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
