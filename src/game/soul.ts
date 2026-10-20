/**
 * 维什戴尔 K「魂灵之影」（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/game-design.md` §4、§5.1：
 * - 生成位置在玩家面向前方 40 像素的最近合法空位；
 * - 持续 12 秒，默认上限 1 个，达到上限时替换最早生成者；
 * - 每 1.5 秒给半径 240 内「未标记」敌人附着残影并减速 20% 持续 1 秒；
 * - 魂灵无敌、不挡路、不直接造成伤害，因此本模块不提供受击或碰撞入口。
 *
 * W03 亡魂伴行（`docs/game-design.md` §6.3）：上限提升为 2，K 每次仍只召唤一个，
 * 达到上限时替换最早生成者。
 *
 * 残影标记通过 `SoulMarkSink` 写入共享标记集合（场景传入 `GrenadeSystem`），
 * 避免魂灵与榴弹各维护一套标记。时间按固定逻辑步长的秒数累计。
 */
import { isCircleBlocked, type ArenaLayout, type Point } from './arena';
import { requireUpgradeParam } from './data';
import { FACING_VECTORS, type Facing } from './movement';
import type { SoulWorldSnapshot } from './world-snapshot';

/** 浮点累计容差。 */
const TIME_EPSILON = 1e-9;

/** W03 提供的魂灵上限。 */
export const W03_MAX_SUMMONS = Math.max(
  1,
  Math.floor(requireUpgradeParam('W03', 'maxSummons')),
);

/** `docs/game-design.md` §4：召唤物新建位置在面向前方 40 逻辑像素。 */
export const SOUL_SPAWN_DISTANCE = 40;

/** 魂灵占位圆半径，仅用于判断生成点是否为合法空位。 */
export const SOUL_RADIUS = 10;

/** 生成点被阻挡时，围绕理想点向外搜索的步长、上限与角度数。 */
const SPAWN_SEARCH_STEP = 4;
const SPAWN_SEARCH_MAX = 160;
const SPAWN_SEARCH_ANGLES = 16;

/** 魂灵可影响的最小目标信息。 */
export interface SoulTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly isAlive: boolean;
}

/** 共享残影标记的写入/查询接口；`GrenadeSystem` 已实现同签名方法。 */
export interface SoulMarkSink {
  mark(targetId: string): void;
  isMarked(targetId: string): boolean;
}

export interface SoulConfig {
  readonly cooldownSeconds: number;
  readonly durationSeconds: number;
  readonly maxSummons: number;
  readonly tickSeconds: number;
  readonly markRadius: number;
  readonly slowPercent: number;
  readonly slowDurationSeconds: number;
}

export interface SoulSnapshot {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly remainingSeconds: number;
}

export interface SoulTickResult {
  readonly soulId: number;
  readonly x: number;
  readonly y: number;
  /** 本次标记并减速的目标 ID，按传入目标顺序排列。 */
  readonly affectedTargetIds: readonly string[];
}

export interface SoulSummonResult {
  readonly soul: SoulSnapshot;
  /** 因达到上限被替换掉的最早魂灵；没有替换时为 null。 */
  readonly replacedSoulId: number | null;
}

export interface SoulStepResult {
  readonly ticks: readonly SoulTickResult[];
  readonly expiredSoulIds: readonly number[];
}

interface ActiveSoul {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly expiresAt: number;
  nextTickAt: number;
}

/**
 * 魂灵状态机：冷却、寿命、数量上限、周期标记与减速。
 * 只由固定逻辑步调用 `step`，渲染帧率不影响任何计时。
 */
export class SoulSystem {
  private readonly config: SoulConfig;
  private readonly marks: SoulMarkSink;
  private cooldownSeconds = 0;
  private cooldownMultiplier = 1;
  private elapsed = 0;
  private nextSoulId = 1;
  private souls: ActiveSoul[] = [];
  private readonly slowUntil = new Map<string, number>();
  /** W03 的上限覆盖；null 表示使用角色配置。 */
  private maxSummonsOverride: number | null = null;

  constructor(config: SoulConfig, marks: SoulMarkSink) {
    if (!(config.cooldownSeconds > 0) || !Number.isFinite(config.cooldownSeconds)) {
      throw new Error('SoulSystem requires a positive cooldownSeconds');
    }
    if (!(config.durationSeconds > 0) || !Number.isFinite(config.durationSeconds)) {
      throw new Error('SoulSystem requires a positive durationSeconds');
    }
    if (!Number.isInteger(config.maxSummons) || config.maxSummons < 1) {
      throw new Error('SoulSystem requires maxSummons >= 1');
    }
    if (!(config.tickSeconds > 0) || !Number.isFinite(config.tickSeconds)) {
      throw new Error('SoulSystem requires a positive tickSeconds');
    }
    if (!(config.markRadius > 0) || !Number.isFinite(config.markRadius)) {
      throw new Error('SoulSystem requires a positive markRadius');
    }
    if (!(config.slowPercent >= 0) || config.slowPercent >= 1) {
      throw new Error('SoulSystem requires slowPercent in [0, 1)');
    }
    if (!(config.slowDurationSeconds > 0) || !Number.isFinite(config.slowDurationSeconds)) {
      throw new Error('SoulSystem requires a positive slowDurationSeconds');
    }

    this.config = config;
    this.marks = marks;
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

  get soulCount(): number {
    return this.souls.length;
  }

  /** 当前魂灵上限；W03 可提升为 2。 */
  get maxSummons(): number {
    return this.maxSummonsOverride ?? this.config.maxSummons;
  }

  /**
   * W03：覆盖魂灵上限；传入 null 恢复角色配置。
   * 非正整数忽略，避免非法参数把召唤入口锁死。
   */
  setMaxSummons(limit: number | null): void {
    if (limit === null) {
      this.maxSummonsOverride = null;
      return;
    }
    if (!Number.isInteger(limit) || limit < 1) return;
    this.maxSummonsOverride = limit;
  }

  get snapshots(): readonly SoulSnapshot[] {
    return this.souls.map((soul) => this.snapshot(soul));
  }

  /** 波中快照：冷却、魂灵寿命/下一 tick、上限覆盖与减速剩余。 */
  snapshotWorld(): SoulWorldSnapshot {
    return {
      cooldownSeconds: this.cooldownRemaining,
      elapsedSeconds: this.elapsed,
      nextSoulId: this.nextSoulId,
      maxSummonsOverride: this.maxSummonsOverride,
      souls: this.souls.map((soul) => ({
        id: soul.id,
        x: soul.x,
        y: soul.y,
        remainingSeconds: Math.max(0, soul.expiresAt - this.elapsed),
        nextTickSeconds: Math.max(0, soul.nextTickAt - this.elapsed),
      })),
      slows: [...this.slowUntil.entries()]
        .map(([targetId, until]) => ({
          targetId,
          remainingSeconds: Math.max(0, until - this.elapsed),
        }))
        .filter((entry) => entry.remainingSeconds > 0),
    };
  }

  /** 从波中快照恢复：寿命与 tick 转为相对当前逻辑时钟的绝对时间。 */
  restoreWorld(state: SoulWorldSnapshot): void {
    this.elapsed = nonNegative(state.elapsedSeconds);
    this.cooldownSeconds = nonNegative(state.cooldownSeconds);
    this.nextSoulId = Number.isInteger(state.nextSoulId)
      ? Math.max(1, state.nextSoulId)
      : 1;
    this.maxSummonsOverride =
      state.maxSummonsOverride !== null &&
      Number.isInteger(state.maxSummonsOverride) &&
      state.maxSummonsOverride >= 1
        ? state.maxSummonsOverride
        : null;
    this.souls = state.souls.map((soul) => ({
      id: soul.id,
      x: soul.x,
      y: soul.y,
      expiresAt: this.elapsed + nonNegative(soul.remainingSeconds),
      nextTickAt: this.elapsed + nonNegative(soul.nextTickSeconds),
    }));
    this.slowUntil.clear();
    for (const slow of state.slows) {
      const remaining = nonNegative(slow.remainingSeconds);
      if (remaining > 0) this.slowUntil.set(slow.targetId, this.elapsed + remaining);
    }
  }

  /** 冷却中返回 null，不改变既有魂灵与冷却。 */
  trySummon(point: Point): SoulSummonResult | null {
    if (this.cooldownRemaining > TIME_EPSILON) return null;

    this.cooldownSeconds = this.config.cooldownSeconds * this.cooldownMultiplier;

    let replacedSoulId: number | null = null;
    while (this.souls.length >= this.maxSummons) {
      const oldest = this.souls.shift();
      if (oldest) replacedSoulId = oldest.id;
    }

    const soul: ActiveSoul = {
      id: this.nextSoulId,
      x: point.x,
      y: point.y,
      expiresAt: this.elapsed + this.config.durationSeconds,
      nextTickAt: this.elapsed + this.config.tickSeconds,
    };
    this.nextSoulId += 1;
    this.souls.push(soul);

    return { soul: this.snapshot(soul), replacedSoulId };
  }

  /**
   * 推进逻辑时间：先结算本步到期的标记 tick，再移除到期魂灵。
   * 寿命终点（12 秒）恰好也是 tick 点时，先标记再消失。
   */
  step(stepSeconds: number, targets: readonly SoulTarget[]): SoulStepResult {
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) {
      return { ticks: [], expiredSoulIds: [] };
    }

    this.elapsed += stepSeconds;
    if (this.cooldownSeconds > 0) {
      this.cooldownSeconds -= stepSeconds;
      if (this.cooldownSeconds <= TIME_EPSILON) this.cooldownSeconds = 0;
    }

    const ticks: SoulTickResult[] = [];
    for (const soul of this.souls) {
      while (soul.nextTickAt <= this.elapsed + TIME_EPSILON) {
        ticks.push(this.applyTick(soul, targets));
        soul.nextTickAt += this.config.tickSeconds;
      }
    }

    const expiredSoulIds: number[] = [];
    this.souls = this.souls.filter((soul) => {
      if (soul.expiresAt <= this.elapsed + TIME_EPSILON) {
        expiredSoulIds.push(soul.id);
        return false;
      }
      return true;
    });

    for (const [targetId, until] of this.slowUntil) {
      if (until <= this.elapsed + TIME_EPSILON) this.slowUntil.delete(targetId);
    }

    return { ticks, expiredSoulIds };
  }

  /** 剩余减速秒数；非正数表示未被减速。 */
  slowRemaining(targetId: string): number {
    const until = this.slowUntil.get(targetId);
    if (until === undefined) return 0;
    const remaining = until - this.elapsed;
    return remaining > TIME_EPSILON ? remaining : 0;
  }

  isSlowed(targetId: string): boolean {
    return this.slowRemaining(targetId) > 0;
  }

  /** 减速后的移速倍率；未被减速时为 1。 */
  slowMultiplier(targetId: string): number {
    return this.isSlowed(targetId) ? 1 - this.config.slowPercent : 1;
  }

  private snapshot(soul: ActiveSoul): SoulSnapshot {
    return {
      id: soul.id,
      x: soul.x,
      y: soul.y,
      remainingSeconds: Math.max(0, soul.expiresAt - this.elapsed),
    };
  }

  private applyTick(soul: ActiveSoul, targets: readonly SoulTarget[]): SoulTickResult {
    const maxDistanceSquared = this.config.markRadius * this.config.markRadius;
    const affectedTargetIds: string[] = [];

    for (const target of targets) {
      if (!target.isAlive) continue;
      const dx = target.x - soul.x;
      const dy = target.y - soul.y;
      if (dx * dx + dy * dy > maxDistanceSquared) continue;
      // 只处理未标记敌人：已带残影者既不重复标记，也不重新减速。
      if (this.marks.isMarked(target.id)) continue;

      this.marks.mark(target.id);
      this.slowUntil.set(
        target.id,
        Math.max(
          this.slowUntil.get(target.id) ?? 0,
          this.elapsed + this.config.slowDurationSeconds,
        ),
      );
      affectedTargetIds.push(target.id);
    }

    return {
      soulId: soul.id,
      x: soul.x,
      y: soul.y,
      affectedTargetIds,
    };
  }
}

/**
 * 召唤位置：优先取面向前方 40 像素处；该点被墙/掩体阻挡时，
 * 围绕理想点由近到远搜索最近合法空位（边界与阻挡判定与玩家移动一致）。
 */
export function resolveSoulSpawnPoint(
  layout: ArenaLayout,
  origin: Point,
  facing: Facing,
  distance = SOUL_SPAWN_DISTANCE,
  radius = SOUL_RADIUS,
): Point {
  const direction = FACING_VECTORS[facing];
  const idealX = origin.x + direction.x * distance;
  const idealY = origin.y + direction.y * distance;

  if (!isCircleBlocked(layout, idealX, idealY, radius)) {
    return { x: idealX, y: idealY };
  }

  const baseAngle = Math.atan2(direction.y, direction.x);
  for (let offset = SPAWN_SEARCH_STEP; offset <= SPAWN_SEARCH_MAX; offset += SPAWN_SEARCH_STEP) {
    for (let index = 0; index < SPAWN_SEARCH_ANGLES; index += 1) {
      const angle = baseAngle + (index * 2 * Math.PI) / SPAWN_SEARCH_ANGLES;
      const x = idealX + Math.cos(angle) * offset;
      const y = idealY + Math.sin(angle) * offset;
      if (!isCircleBlocked(layout, x, y, radius)) return { x, y };
    }
  }

  // 场地内必然有合法点；兜底回到玩家位置（玩家所在处一定可行走）。
  return { x: origin.x, y: origin.y };
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
