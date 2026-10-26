/**
 * 自由技能 S01–S12 的效果规则（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/02-content-catalog.md` §12 种自由技能：
 * - S01：围绕自身旋转 3 秒，每秒最多对同一敌人造成 45 物理伤害；
 * - S02：半径 140 内 50 法术伤害并减速 40%，持续 3 秒；
 * - S03：跳跃 4 个不同敌人，各 45 法术伤害，同一敌人只结算一次；
 * - S04：移动路径留火 4 秒，每秒 22 法术伤害，同源重叠只结算一层；
 * - S05：放置 8 秒炮台，每秒 24 物理伤害，默认最多 1 座；
 * - S06：恢复自身 30 生命，半径内召唤物恢复最大生命 20%；
 * - S07：获得 35 护盾 4 秒，周围 40 物理伤害并把普通敌人击退；
 * - S08：面向前方生成半径 110 的 3 秒聚敌区，每秒 18 法术伤害；
 * - S09：生成 6 秒替身，复制 J 命中的 35% 伤害，不复制任何触发链；
 * - S10：立起 6 秒战旗区，玩家在区域内护甲 +15，敌人首次接触受 45 物理伤害；
 * - S11：前方 50° 扇射 5 枚各 18 物伤弹，同一目标后续弹只结算 35%；
 * - S12：标记面向目标 8 秒，其受到伤害 +15%，击杀额外 12 金币、每波最多 2 次；
 * - S01/S02 以自身为圆心；S03/S08/S11/S12 的首目标选择走 ±25° 轻自瞄、射程与遮挡；
 * - Boss 的硬控（眩晕/束缚/拉拽）统一转换为减速，避免被永久锁死；
 * - 技能伤害走原生链，同一次施放的多段命中共享 chainId；衍生攻击不能再派生。
 *
 * 数值从内容目录 `params` 读取，不在玩法模块另写手调常量。
 */
import type { DamageType } from './data';
import { requireFreeSkillParam } from './data';
import { freeSkillControlMultiplier } from './free-skills';
import {
  distanceSquared,
  resolveAimAssist,
  type CombatPoint,
  type LineOfSightCheck,
} from './combat';
import {
  FACING_VECTORS,
  normalizeVector,
  type Facing,
  type MoveVector,
} from './movement';
import type {
  CombatEventSource,
  DamageChainTracker,
} from './damage-events';

/** S01 旋转半径（逻辑像素）。 */
export const FREE_SKILL_S01_RADIUS = requireFreeSkillParam('S01', 'radius');
/** S01 持续时间（秒）。 */
export const FREE_SKILL_S01_DURATION_SECONDS = requireFreeSkillParam(
  'S01',
  'durationSeconds',
);
/** S01 每秒对同一敌人的物理伤害。 */
export const FREE_SKILL_S01_DAMAGE_PER_SECOND = requireFreeSkillParam(
  'S01',
  'damagePerSecond',
);
/** S01 伤害结算间隔：每秒一次，同一敌人每 tick 最多一次。 */
export const FREE_SKILL_S01_TICK_SECONDS = 1;
export const FREE_SKILL_S01_DAMAGE_TYPE: DamageType = 'physical';

/** S02 作用半径（逻辑像素）。 */
export const FREE_SKILL_S02_RADIUS = requireFreeSkillParam('S02', 'radius');
/** S02 基础法术伤害。 */
export const FREE_SKILL_S02_DAMAGE = requireFreeSkillParam('S02', 'damage');
/** S02 减速比例：0.4 表示移速 ×0.6。 */
export const FREE_SKILL_S02_SLOW_PERCENT = requireFreeSkillParam(
  'S02',
  'slowPercent',
);
/** S02 基础减速时长（秒）。 */
export const FREE_SKILL_S02_SLOW_DURATION_SECONDS = requireFreeSkillParam(
  'S02',
  'slowDurationSeconds',
);
export const FREE_SKILL_S02_DAMAGE_TYPE: DamageType = 'magic';

/**
 * S02 的减速时长：等级 2/3 按控制增幅延长，封顶 125%（3.6 / 3.75 秒）。
 * 回响复施只缩放伤害，不再延长控制，避免短 CD 技能叠加成长时间锁定。
 */
export function freeSkillSlowDurationSeconds(level: number): number {
  return FREE_SKILL_S02_SLOW_DURATION_SECONDS * freeSkillControlMultiplier(level);
}

/** Boss 抵挡硬控后改为的减速比例。 */
export const BOSS_CONTROL_SLOW_PERCENT = 0.4;

const TIME_EPSILON = 1e-9;

/** 续局快照中坐标的宽松范围：只拒绝非有限值，允许场外负坐标。 */
function isSnapshotPoint(value: unknown): value is CombatPoint {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.x === 'number' &&
    Number.isFinite(record.x) &&
    typeof record.y === 'number' &&
    Number.isFinite(record.y)
  );
}

function isSnapshotSeconds(value: unknown, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max + TIME_EPSILON
  );
}

function isSnapshotCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function isSnapshotStrength(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 100
  );
}

/** 单次施放的最长持续时间上限，用于拒绝异常剩余秒数。 */
const MAX_SNAPSHOT_EFFECT_SECONDS = 60;

/** S01 旋转的续局快照。 */
export interface SpinningBladeSave {
  readonly remainingSeconds: number;
  readonly tickElapsedSeconds: number;
  readonly strength: number;
}

export function isSpinningBladeSave(value: unknown): value is SpinningBladeSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isSnapshotSeconds(record.remainingSeconds, MAX_SNAPSHOT_EFFECT_SECONDS) &&
    isSnapshotSeconds(record.tickElapsedSeconds, MAX_SNAPSHOT_EFFECT_SECONDS) &&
    isSnapshotStrength(record.strength)
  );
}

/**
 * S01 的旋转计时：每满 1 秒返回一次伤害 tick。
 * 计时只在实际生效时长内累计，持续 3 秒恰好结算 3 次，不因步长切分多打。
 */
export class SpinningBladeState {
  private remainingSeconds = 0;
  private tickElapsedSeconds = 0;
  private strengthValue = 1;
  private firedTicks = 0;

  /** 开始（或刷新）一次旋转；`strength` 为等级 × 回响强度。 */
  start(strength: number): void {
    this.remainingSeconds = FREE_SKILL_S01_DURATION_SECONDS;
    this.tickElapsedSeconds = 0;
    this.strengthValue = Number.isFinite(strength) && strength > 0 ? strength : 1;
    this.firedTicks = 0;
  }

  get isActive(): boolean {
    return this.remainingSeconds > TIME_EPSILON;
  }

  get remainingSecondsLeft(): number {
    return Math.max(0, this.remainingSeconds);
  }

  /** 本技能当前效果强度；非激活时为 1。 */
  get strength(): number {
    return this.isActive ? this.strengthValue : 1;
  }

  /** 已结算的伤害 tick 总数；用于开发快照核对每秒一次。 */
  get ticksFired(): number {
    return this.firedTicks;
  }

  /** 单次 tick 对同一敌人的伤害（未乘全局伤害倍率与护甲减免）。 */
  damagePerTick(): number {
    return FREE_SKILL_S01_DAMAGE_PER_SECOND * this.strengthValue;
  }

  /**
   * 推进一个逻辑步，返回本步应结算的 tick 数（通常 0 或 1）。
   * 超长步长最多补到剩余时长内的整秒数，不会超过 3 次。
   */
  step(seconds: number): number {
    if (!(seconds > 0) || !Number.isFinite(seconds) || !this.isActive) return 0;
    const effective = Math.min(seconds, this.remainingSeconds);
    this.remainingSeconds = Math.max(0, this.remainingSeconds - effective);
    this.tickElapsedSeconds += effective;

    const ticks = Math.floor(
      this.tickElapsedSeconds / FREE_SKILL_S01_TICK_SECONDS + TIME_EPSILON,
    );
    if (ticks <= 0) return 0;
    this.tickElapsedSeconds -= ticks * FREE_SKILL_S01_TICK_SECONDS;
    this.firedTicks += ticks;
    return ticks;
  }

  /** 续局快照：剩余时长、本秒已累计时间与效果强度。 */
  saveSnapshot(): SpinningBladeSave {
    return {
      remainingSeconds: this.remainingSecondsLeft,
      tickElapsedSeconds: this.tickElapsedSeconds,
      strength: this.strengthValue,
    };
  }

  /** 从快照恢复；缺省/损坏时清空。 */
  restore(save: SpinningBladeSave | null | undefined): void {
    this.reset();
    if (!isSpinningBladeSave(save)) return;
    this.remainingSeconds = save.remainingSeconds;
    this.tickElapsedSeconds = Math.min(
      save.tickElapsedSeconds,
      FREE_SKILL_S01_TICK_SECONDS,
    );
    this.strengthValue = save.strength;
  }

  /** 波初/重开清空，不保留上一波旋转。 */
  reset(): void {
    this.remainingSeconds = 0;
    this.tickElapsedSeconds = 0;
    this.strengthValue = 1;
    this.firedTicks = 0;
  }
}

export interface FreeSkillSlowEntry {
  readonly targetId: string;
  readonly percent: number;
  readonly remainingSeconds: number;
}

/** S02/S08 减速的续局快照；敌人 ID 与世界快照一致。 */
export interface FreeSkillSlowSave {
  readonly entries: readonly FreeSkillSlowEntry[];
}

/** 单个敌人同时只保留一条减速；上限只用于拒绝异常存档。 */
const MAX_SLOW_ENTRIES = 500;

export function isFreeSkillSlowSave(value: unknown): value is FreeSkillSlowSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.entries) || record.entries.length > MAX_SLOW_ENTRIES) {
    return false;
  }
  const seen = new Set<string>();
  for (const entry of record.entries) {
    if (typeof entry !== 'object' || entry === null) return false;
    const slow = entry as Record<string, unknown>;
    if (typeof slow.targetId !== 'string' || slow.targetId.length === 0) {
      return false;
    }
    if (seen.has(slow.targetId)) return false;
    if (
      typeof slow.percent !== 'number' ||
      !Number.isFinite(slow.percent) ||
      slow.percent <= 0 ||
      slow.percent > 1
    ) {
      return false;
    }
    if (
      !isSnapshotSeconds(slow.remainingSeconds, MAX_SNAPSHOT_EFFECT_SECONDS)
    ) {
      return false;
    }
    seen.add(slow.targetId);
  }
  return true;
}

/**
 * S02 等自由技能施加的限时减速。
 * 同一目标重复施加只刷新为「较高减速 + 较长剩余」，不会乘法叠加或无限延长。
 */
export class FreeSkillSlowState {
  private readonly slows = new Map<
    string,
    { percent: number; remainingSeconds: number }
  >();

  /** 施加/刷新减速；非法参数忽略。 */
  apply(targetId: string, percent: number, durationSeconds: number): boolean {
    if (typeof targetId !== 'string' || targetId.length === 0) return false;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
    const clampedPercent = Number.isFinite(percent)
      ? Math.min(1, Math.max(0, percent))
      : 0;
    if (clampedPercent <= 0) return false;

    const existing = this.slows.get(targetId);
    if (existing) {
      existing.percent = Math.max(existing.percent, clampedPercent);
      existing.remainingSeconds = Math.max(
        existing.remainingSeconds,
        durationSeconds,
      );
    } else {
      this.slows.set(targetId, {
        percent: clampedPercent,
        remainingSeconds: durationSeconds,
      });
    }
    return true;
  }

  remaining(targetId: string): number {
    return Math.max(0, this.slows.get(targetId)?.remainingSeconds ?? 0);
  }

  percent(targetId: string): number {
    return this.slows.get(targetId)?.percent ?? 0;
  }

  /** 移速倍率：减速 40% 返回 0.6；未被减速返回 1。 */
  slowMultiplier(targetId: string): number {
    return this.remaining(targetId) > 0 ? 1 - this.percent(targetId) : 1;
  }

  step(seconds: number): void {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return;
    for (const [targetId, slow] of this.slows) {
      slow.remainingSeconds -= seconds;
      if (slow.remainingSeconds <= TIME_EPSILON) this.slows.delete(targetId);
    }
  }

  entries(): FreeSkillSlowEntry[] {
    return [...this.slows.entries()]
      .map(([targetId, slow]) => ({
        targetId,
        percent: slow.percent,
        remainingSeconds: Math.max(0, slow.remainingSeconds),
      }))
      .filter((entry) => entry.remainingSeconds > 0);
  }

  /** 续局快照：各目标剩余减速与比例。 */
  saveSnapshot(): FreeSkillSlowSave {
    return { entries: this.entries() };
  }

  /** 从续局快照恢复；缺省/损坏时清空。 */
  restore(save: FreeSkillSlowSave | null | undefined): void {
    this.reset();
    if (!isFreeSkillSlowSave(save)) return;
    for (const entry of save.entries) {
      this.slows.set(entry.targetId, {
        percent: entry.percent,
        remainingSeconds: entry.remainingSeconds,
      });
    }
  }

  reset(): void {
    this.slows.clear();
  }
}

/** S03 首目标轻自瞄射程（逻辑像素）。 */
export const FREE_SKILL_S03_RANGE = requireFreeSkillParam('S03', 'range');
/** S03 相邻两次跳跃的最大距离（逻辑像素）。 */
export const FREE_SKILL_S03_JUMP_RADIUS = requireFreeSkillParam(
  'S03',
  'jumpRadius',
);
/** S03 最多命中的不同敌人数量（含首目标）。 */
export const FREE_SKILL_S03_JUMPS = requireFreeSkillParam('S03', 'jumps');
/** S03 每个目标的法术伤害。 */
export const FREE_SKILL_S03_DAMAGE = requireFreeSkillParam('S03', 'damage');
export const FREE_SKILL_S03_DAMAGE_TYPE: DamageType = 'magic';

export interface ChainLightningOptions<T extends FreeSkillAreaTarget> {
  readonly origin: CombatPoint;
  readonly facing: Facing;
  readonly targets: readonly T[];
  /** 首目标射程；缺省取目录值。 */
  readonly range?: number;
  /** 相邻跳跃半径；缺省取目录值。 */
  readonly jumpRadius?: number;
  /** 最多命中目标数（含首目标）；缺省取目录值。 */
  readonly maxTargets?: number;
  readonly halfAngleDegrees?: number;
  readonly preferredTargetId?: string | null;
  readonly lineOfSight?: LineOfSightCheck;
}

/**
 * S03 连锁电弧的选敌顺序：首目标走 ±25° 轻自瞄、射程与遮挡；
 * 后续从上一目标向跳跃半径内最近的未命中敌人跳跃，同样要求通视。
 * 同一敌人只会出现一次；没有合法首目标时返回空数组（技能空放）。
 */
export function resolveChainLightningTargets<T extends FreeSkillAreaTarget>(
  options: ChainLightningOptions<T>,
): T[] {
  const maxTargets = Math.max(
    0,
    Math.floor(options.maxTargets ?? FREE_SKILL_S03_JUMPS),
  );
  if (maxTargets === 0) return [];

  const aim = resolveAimAssist(options.origin, options.facing, options.targets, {
    range: options.range ?? FREE_SKILL_S03_RANGE,
    preferredTargetId: options.preferredTargetId ?? null,
    halfAngleDegrees: options.halfAngleDegrees,
    lineOfSight: options.lineOfSight,
  });
  const firstId = aim.target?.id;
  let current = firstId
    ? (options.targets.find((target) => target.id === firstId) ?? null)
    : null;

  const visited = new Set<string>();
  const chain: T[] = [];
  while (current && chain.length < maxTargets) {
    visited.add(current.id);
    chain.push(current);
    if (chain.length >= maxTargets) break;
    current = nearestUnvisitedChainTarget(
      current,
      options.targets,
      visited,
      options.jumpRadius ?? FREE_SKILL_S03_JUMP_RADIUS,
      options.lineOfSight,
    );
  }
  return chain;
}

/** 跳跃候选：半径内最近的存活未命中目标；等距按 ID 升序保证确定性。 */
function nearestUnvisitedChainTarget<T extends FreeSkillAreaTarget>(
  from: CombatPoint,
  targets: readonly T[],
  visited: ReadonlySet<string>,
  jumpRadius: number,
  lineOfSight?: LineOfSightCheck,
): T | null {
  const radius = Number.isFinite(jumpRadius) ? Math.max(0, jumpRadius) : 0;
  if (radius <= 0) return null;
  const maxDistanceSquared = (radius + TIME_EPSILON) * (radius + TIME_EPSILON);

  let best: T | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    if (target.isAlive === false || visited.has(target.id)) continue;
    const distance = distanceSquared(from, target);
    if (distance > maxDistanceSquared) continue;
    if (lineOfSight && !lineOfSight(from, target)) continue;
    const closer = distance < bestDistanceSquared - TIME_EPSILON;
    const sameDistance =
      Math.abs(distance - bestDistanceSquared) <= TIME_EPSILON &&
      best !== null &&
      target.id < best.id;
    if (closer || sameDistance) {
      best = target;
      bestDistanceSquared = distance;
    }
  }
  return best;
}

/** S04 每团火焰的寿命（秒）。 */
export const FREE_SKILL_S04_FIRE_DURATION_SECONDS = requireFreeSkillParam(
  'S04',
  'fireDurationSeconds',
);
/** S04 每秒对同一敌人的法术伤害。 */
export const FREE_SKILL_S04_DAMAGE_PER_SECOND = requireFreeSkillParam(
  'S04',
  'damagePerSecond',
);
/** S04 伤害结算间隔：每秒一次。 */
export const FREE_SKILL_S04_TICK_SECONDS = requireFreeSkillParam(
  'S04',
  'tickSeconds',
);
/** S04 施放后的铺设窗口（秒）：窗口内移动才会继续留火。 */
export const FREE_SKILL_S04_TRAIL_SECONDS = requireFreeSkillParam(
  'S04',
  'trailSeconds',
);
/** S04 相邻两团火焰的最小移动距离（逻辑像素）。 */
export const FREE_SKILL_S04_STRIDE_DISTANCE = requireFreeSkillParam(
  'S04',
  'strideDistance',
);
/** S04 单团火焰的作用半径（逻辑像素）。 */
export const FREE_SKILL_S04_RADIUS = requireFreeSkillParam('S04', 'radius');
export const FREE_SKILL_S04_DAMAGE_TYPE: DamageType = 'magic';

/** 同一次施放最多保留的火焰团数；正常步距下远用不到。 */
const FIRE_TRAIL_MAX_PATCHES = 64;

/** 单团火焰的只读快照；`id` 供场景同步占位视觉。 */
export interface FireTrailPatch {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly remainingSeconds: number;
}

/** S04 火路的续局快照：火焰团、铺设窗口与下一次补火所需的位置。 */
export interface FireTrailSave {
  readonly patches: readonly FireTrailPatch[];
  readonly emitRemainingSeconds: number;
  readonly tickElapsedSeconds: number;
  readonly strength: number;
  readonly lastPosition: CombatPoint | null;
  readonly distanceSinceDrop: number;
}

export function isFireTrailSave(value: unknown): value is FireTrailSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.patches) ||
    record.patches.length > FIRE_TRAIL_MAX_PATCHES
  ) {
    return false;
  }
  const seen = new Set<number>();
  for (const patch of record.patches) {
    if (!isFireTrailPatchSave(patch)) return false;
    if (seen.has(patch.id)) return false;
    seen.add(patch.id);
  }
  if (!isSnapshotSeconds(record.emitRemainingSeconds, FREE_SKILL_S04_TRAIL_SECONDS)) {
    return false;
  }
  if (!isSnapshotSeconds(record.tickElapsedSeconds, MAX_SNAPSHOT_EFFECT_SECONDS)) {
    return false;
  }
  if (!isSnapshotStrength(record.strength)) return false;
  if (record.lastPosition !== null && !isSnapshotPoint(record.lastPosition)) {
    return false;
  }
  if (
    typeof record.distanceSinceDrop !== 'number' ||
    !Number.isFinite(record.distanceSinceDrop) ||
    record.distanceSinceDrop < 0 ||
    record.distanceSinceDrop > 10000
  ) {
    return false;
  }
  return true;
}

function isFireTrailPatchSave(value: unknown): value is FireTrailPatch {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isSnapshotCount(record.id) &&
    record.id >= 1 &&
    isSnapshotPoint(record) &&
    isSnapshotSeconds(record.remainingSeconds, FREE_SKILL_S04_FIRE_DURATION_SECONDS)
  );
}

/**
 * S04 燃烧轨迹：施放时在脚下落一团火，并在 4 秒铺设窗口内每移动 40 像素补一团。
 * 每团火独立存活 4 秒；伤害按「来源」每秒结算一次，因此同一敌人站在多团同源
 * 火焰重叠处仍然只吃一层 22 法伤（AC：同源火焰重叠只结算一层）。
 * 重复施放替换上一次火路，不跨施放叠加。
 */
export class FireTrailState {
  private patchesList: {
    id: number;
    x: number;
    y: number;
    remainingSeconds: number;
  }[] = [];
  private emitRemainingSeconds = 0;
  private tickElapsedSeconds = 0;
  private strengthValue = 1;
  private firedTicks = 0;
  private lastPosition: CombatPoint | null = null;
  private distanceSinceDrop = 0;
  private nextPatchId = 1;

  /** 施放：清空旧火路，在 `position` 立即落火并打开铺设窗口。 */
  start(position: CombatPoint, strength: number): void {
    this.patchesList = [];
    this.emitRemainingSeconds = FREE_SKILL_S04_TRAIL_SECONDS;
    this.tickElapsedSeconds = 0;
    this.strengthValue =
      Number.isFinite(strength) && strength > 0 ? strength : 1;
    this.firedTicks = 0;
    this.lastPosition = { x: position.x, y: position.y };
    this.distanceSinceDrop = 0;
    this.dropPatch(position);
  }

  get isActive(): boolean {
    return this.emitRemainingSeconds > TIME_EPSILON || this.patchesList.length > 0;
  }

  /** 最晚消失的那团火（或铺设窗口）的剩余秒数。 */
  get remainingSecondsLeft(): number {
    return Math.max(
      this.emitRemainingSeconds,
      ...this.patchesList.map((patch) => patch.remainingSeconds),
      0,
    );
  }

  /** 本次施放已结算的伤害 tick 数。 */
  get ticksFired(): number {
    return this.firedTicks;
  }

  get patchCount(): number {
    return this.patchesList.length;
  }

  /** 当前存活火焰团的只读快照。 */
  patches(): FireTrailPatch[] {
    return this.patchesList.map((patch) => ({ ...patch }));
  }

  /** 单次 tick 对同一敌人的伤害（未乘全局倍率与抗性）。 */
  damagePerTick(): number {
    return FREE_SKILL_S04_DAMAGE_PER_SECOND * this.strengthValue;
  }

  /**
   * 推进一个逻辑步，返回本步应结算的伤害 tick 数（通常 0 或 1）。
   * `position` 为本步结束时的玩家位置：铺设窗口内按移动距离补火，
   * 站着不动不会再生成火焰。超出剩余时长的步长不会补打额外 tick。
   */
  step(seconds: number, position?: CombatPoint): number {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return 0;
    const activeSeconds = this.remainingSecondsLeft;

    const emissionSeconds = Math.min(seconds, this.emitRemainingSeconds);
    this.emitRemainingSeconds = Math.max(
      0,
      this.emitRemainingSeconds - emissionSeconds,
    );
    if (this.emitRemainingSeconds <= TIME_EPSILON) this.emitRemainingSeconds = 0;
    if (position) {
      if (this.lastPosition && emissionSeconds > TIME_EPSILON) {
        this.distanceSinceDrop += Math.sqrt(
          distanceSquared(this.lastPosition, position),
        );
      }
      this.lastPosition = { x: position.x, y: position.y };
      if (
        emissionSeconds > TIME_EPSILON &&
        this.distanceSinceDrop >= FREE_SKILL_S04_STRIDE_DISTANCE
      ) {
        // 大步长或瞬移时只补一团，余下距离保留到下个 tick，避免同点刷屏。
        this.distanceSinceDrop %= FREE_SKILL_S04_STRIDE_DISTANCE;
        this.dropPatch(position);
      }
    }

    for (const patch of this.patchesList) {
      patch.remainingSeconds -= seconds;
    }
    this.patchesList = this.patchesList.filter(
      (patch) => patch.remainingSeconds > TIME_EPSILON,
    );

    if (activeSeconds <= TIME_EPSILON) return 0;
    this.tickElapsedSeconds += Math.min(seconds, activeSeconds);
    const ticks = Math.floor(
      this.tickElapsedSeconds / FREE_SKILL_S04_TICK_SECONDS + TIME_EPSILON,
    );
    if (ticks <= 0) return 0;
    this.tickElapsedSeconds -= ticks * FREE_SKILL_S04_TICK_SECONDS;
    this.firedTicks += ticks;
    return ticks;
  }

  /** 续局快照：存活火焰的坐标/剩余秒数、铺设窗口与补火进度。 */
  saveSnapshot(): FireTrailSave {
    return {
      patches: this.patches(),
      emitRemainingSeconds: this.emitRemainingSeconds,
      tickElapsedSeconds: this.tickElapsedSeconds,
      strength: this.strengthValue,
      lastPosition: this.lastPosition ? { ...this.lastPosition } : null,
      distanceSinceDrop: this.distanceSinceDrop,
    };
  }

  /** 从续局快照恢复；缺省/损坏时清空。火焰 ID 从最大值之后继续分配。 */
  restore(save: FireTrailSave | null | undefined): void {
    this.reset();
    if (!isFireTrailSave(save)) return;
    this.patchesList = save.patches.map((patch) => ({
      id: patch.id,
      x: patch.x,
      y: patch.y,
      remainingSeconds: patch.remainingSeconds,
    }));
    this.emitRemainingSeconds = save.emitRemainingSeconds;
    this.tickElapsedSeconds = Math.min(
      save.tickElapsedSeconds,
      FREE_SKILL_S04_TICK_SECONDS,
    );
    this.strengthValue = save.strength;
    this.lastPosition = save.lastPosition
      ? { x: save.lastPosition.x, y: save.lastPosition.y }
      : null;
    this.distanceSinceDrop = save.distanceSinceDrop;
    this.nextPatchId =
      this.patchesList.reduce((max, patch) => Math.max(max, patch.id), 0) + 1;
  }

  /** 波初/重开清空火焰与计时，不保留上一波火路。 */
  reset(): void {
    this.patchesList = [];
    this.emitRemainingSeconds = 0;
    this.tickElapsedSeconds = 0;
    this.strengthValue = 1;
    this.firedTicks = 0;
    this.lastPosition = null;
    this.distanceSinceDrop = 0;
  }

  private dropPatch(position: CombatPoint): void {
    if (this.patchesList.length >= FIRE_TRAIL_MAX_PATCHES) return;
    this.patchesList.push({
      id: this.nextPatchId,
      x: position.x,
      y: position.y,
      remainingSeconds: FREE_SKILL_S04_FIRE_DURATION_SECONDS,
    });
    this.nextPatchId += 1;
  }
}

/**
 * 火焰范围选敌：目标只要落在任意一团火焰内就算命中。
 * 返回的目标最多出现一次，配合来源级每秒 tick 实现「同源不叠加」。
 */
export function listTargetsInFirePatches<T extends FreeSkillAreaTarget>(
  patches: readonly CombatPoint[],
  radius: number,
  targets: readonly T[],
): T[] {
  const area = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  if (area <= 0 || patches.length === 0) return [];
  const maxDistanceSquared = (area + TIME_EPSILON) * (area + TIME_EPSILON);
  return targets.filter((target) => {
    if (target.isAlive === false) return false;
    return patches.some(
      (patch) => distanceSquared(patch, target) <= maxDistanceSquared,
    );
  });
}

/** S05 炮台寿命（秒）。 */
export const FREE_SKILL_S05_DURATION_SECONDS = requireFreeSkillParam(
  'S05',
  'durationSeconds',
);
/** S05 每秒对单个目标的物理伤害。 */
export const FREE_SKILL_S05_DAMAGE_PER_SECOND = requireFreeSkillParam(
  'S05',
  'damagePerSecond',
);
/** S05 伤害结算间隔：每秒一次。 */
export const FREE_SKILL_S05_TICK_SECONDS = requireFreeSkillParam(
  'S05',
  'tickSeconds',
);
/** S05 默认同时存在的炮台上限。 */
export const FREE_SKILL_S05_MAX_COUNT = requireFreeSkillParam('S05', 'maxCount');
/** S05 索敌射程（逻辑像素）。 */
export const FREE_SKILL_S05_RANGE = requireFreeSkillParam('S05', 'range');
export const FREE_SKILL_S05_DAMAGE_TYPE: DamageType = 'physical';

/** 单座炮台的只读快照。 */
export interface TurretSnapshot {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly remainingSeconds: number;
}

/** 某个逻辑步中需要结算的炮台 tick。 */
export interface TurretTickEntry {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly ticks: number;
  readonly strength: number;
}

/** 单座炮台的续局快照：位置、剩余寿命、本秒计时与强度。 */
export interface TurretSaveEntry {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly remainingSeconds: number;
  readonly tickElapsedSeconds: number;
  readonly strength: number;
}

/** S05 炮台的续局快照。 */
export interface TurretFieldSave {
  readonly turrets: readonly TurretSaveEntry[];
}

/** 炮台数量的宽松上限，只用于拒绝异常存档。 */
const MAX_SAVED_TURRETS = 8;

export function isTurretFieldSave(value: unknown): value is TurretFieldSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.turrets) ||
    record.turrets.length > MAX_SAVED_TURRETS
  ) {
    return false;
  }
  const seen = new Set<number>();
  for (const turret of record.turrets) {
    if (typeof turret !== 'object' || turret === null) return false;
    const entry = turret as Record<string, unknown>;
    if (!isSnapshotCount(entry.id) || entry.id < 1 || seen.has(entry.id)) {
      return false;
    }
    if (!isSnapshotPoint(entry)) return false;
    if (
      !isSnapshotSeconds(entry.remainingSeconds, FREE_SKILL_S05_DURATION_SECONDS)
    ) {
      return false;
    }
    if (!isSnapshotSeconds(entry.tickElapsedSeconds, MAX_SNAPSHOT_EFFECT_SECONDS)) {
      return false;
    }
    if (!isSnapshotStrength(entry.strength)) return false;
    seen.add(entry.id);
  }
  return true;
}

/**
 * S05 炮台场：默认上限 1 座、每座存活 8 秒、每秒结算一次。
 * 达到上限时放置新炮台会顶掉最旧的一座（而不是静默失败），
 * 与「默认最多 1 个」的构筑预期一致。
 */
export class TurretFieldState {
  private turretsList: {
    id: number;
    x: number;
    y: number;
    remainingSeconds: number;
    tickElapsedSeconds: number;
    strength: number;
  }[] = [];
  private nextTurretId = 1;
  private maxCountValue = FREE_SKILL_S05_MAX_COUNT;

  get maxCount(): number {
    return this.maxCountValue;
  }

  /** 调整上限（后续道具/海克斯可提高）；降低上限时立即裁掉最旧炮台。 */
  setMaxCount(count: number): void {
    const clamped = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
    this.maxCountValue = clamped;
    while (this.turretsList.length > clamped) this.turretsList.shift();
  }

  get count(): number {
    return this.turretsList.length;
  }

  /** 当前炮台快照；按放置顺序返回。 */
  entries(): TurretSnapshot[] {
    return this.turretsList.map((turret) => ({
      id: turret.id,
      x: turret.x,
      y: turret.y,
      remainingSeconds: Math.max(0, turret.remainingSeconds),
    }));
  }

  /** 放置一座炮台；超过上限时先移除最旧的，返回被顶掉的 ID。 */
  place(
    position: CombatPoint,
    strength: number,
  ): { readonly id: number; readonly replacedIds: readonly number[] } {
    const replacedIds: number[] = [];
    while (this.turretsList.length >= this.maxCountValue) {
      const oldest = this.turretsList.shift();
      if (oldest) replacedIds.push(oldest.id);
    }
    const turret = {
      id: this.nextTurretId,
      x: position.x,
      y: position.y,
      remainingSeconds: FREE_SKILL_S05_DURATION_SECONDS,
      tickElapsedSeconds: 0,
      strength: Number.isFinite(strength) && strength > 0 ? strength : 1,
    };
    this.nextTurretId += 1;
    this.turretsList.push(turret);
    return { id: turret.id, replacedIds };
  }

  /** 单座炮台的每秒伤害（未乘全局倍率与护甲减免）。 */
  damagePerTick(strength: number): number {
    const value = Number.isFinite(strength) && strength > 0 ? strength : 1;
    return FREE_SKILL_S05_DAMAGE_PER_SECOND * value;
  }

  /**
   * 推进一个逻辑步，返回本步到点需要开火的炮台。
   * 每座炮台独立计时；寿命结束的炮台在结算完本步后移除。
   */
  step(seconds: number): TurretTickEntry[] {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return [];
    const firing: TurretTickEntry[] = [];
    for (const turret of this.turretsList) {
      const effective = Math.min(seconds, turret.remainingSeconds);
      turret.remainingSeconds = Math.max(0, turret.remainingSeconds - effective);
      turret.tickElapsedSeconds += effective;
      const ticks = Math.floor(
        turret.tickElapsedSeconds / FREE_SKILL_S05_TICK_SECONDS + TIME_EPSILON,
      );
      if (ticks <= 0) continue;
      turret.tickElapsedSeconds -= ticks * FREE_SKILL_S05_TICK_SECONDS;
      firing.push({
        id: turret.id,
        x: turret.x,
        y: turret.y,
        ticks,
        strength: turret.strength,
      });
    }
    this.turretsList = this.turretsList.filter(
      (turret) => turret.remainingSeconds > TIME_EPSILON,
    );
    return firing;
  }

  /** 续局快照：每座炮台的坐标、剩余寿命与开火计时。 */
  saveSnapshot(): TurretFieldSave {
    return {
      turrets: this.turretsList.map((turret) => ({
        id: turret.id,
        x: turret.x,
        y: turret.y,
        remainingSeconds: Math.max(0, turret.remainingSeconds),
        tickElapsedSeconds: turret.tickElapsedSeconds,
        strength: turret.strength,
      })),
    };
  }

  /** 从续局快照恢复；缺省/损坏时清空。ID 从最大值之后继续分配。 */
  restore(save: TurretFieldSave | null | undefined): void {
    this.reset();
    if (!isTurretFieldSave(save)) return;
    this.turretsList = save.turrets.map((turret) => ({
      id: turret.id,
      x: turret.x,
      y: turret.y,
      remainingSeconds: turret.remainingSeconds,
      tickElapsedSeconds: Math.min(
        turret.tickElapsedSeconds,
        FREE_SKILL_S05_TICK_SECONDS,
      ),
      strength: turret.strength,
    }));
    this.nextTurretId =
      this.turretsList.reduce((max, turret) => Math.max(max, turret.id), 0) + 1;
  }

  /** 波初/重开清空所有炮台与计时。 */
  reset(): void {
    this.turretsList = [];
    this.maxCountValue = FREE_SKILL_S05_MAX_COUNT;
  }
}

/**
 * 炮台索敌：射程内最近的存活敌人；等距按 ID 升序保证确定性。
 * 超出射程或没有合法目标时返回 null，本秒不开火。
 */
export function findTurretTarget<T extends FreeSkillAreaTarget>(
  turret: CombatPoint,
  targets: readonly T[],
  options: {
    readonly range?: number;
    readonly lineOfSight?: LineOfSightCheck;
  } = {},
): T | null {
  const requestedRange = options.range ?? FREE_SKILL_S05_RANGE;
  const range = Number.isFinite(requestedRange)
    ? Math.max(0, requestedRange)
    : FREE_SKILL_S05_RANGE;
  if (range <= 0) return null;
  const maxDistanceSquared = (range + TIME_EPSILON) * (range + TIME_EPSILON);

  let best: T | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    if (target.isAlive === false) continue;
    const distance = distanceSquared(turret, target);
    if (distance > maxDistanceSquared) continue;
    if (options.lineOfSight && !options.lineOfSight(turret, target)) continue;
    const closer = distance < bestDistanceSquared - TIME_EPSILON;
    const sameDistance =
      Math.abs(distance - bestDistanceSquared) <= TIME_EPSILON &&
      best !== null &&
      target.id < best.id;
    if (closer || sameDistance) {
      best = target;
      bestDistanceSquared = distance;
    }
  }
  return best;
}


/** S06 治疗脉冲的基础自疗量。 */
export const FREE_SKILL_S06_HEAL_AMOUNT = requireFreeSkillParam(
  'S06',
  'healAmount',
);
/** S06 附近召唤物回复最大生命的比例：0.2 表示 20%。 */
export const FREE_SKILL_S06_SUMMON_HEAL_RATIO = requireFreeSkillParam(
  'S06',
  'summonHealRatio',
);
/** S06 可治疗召唤物的半径（逻辑像素）。 */
export const FREE_SKILL_S06_SUMMON_RADIUS = requireFreeSkillParam(
  'S06',
  'summonRadius',
);

/** S06 可被治疗的召唤物快照；当前只有缪尔赛思主流形带生命值。 */
export interface HealPulseSummon extends CombatPoint {
  readonly id: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly isAlive?: boolean;
}

export interface HealPulseSummonHeal {
  readonly id: string;
  /** 本应回复的量（最大生命 × 20% × 强度）。 */
  readonly amount: number;
  /** 按当前生命与上限折算后的实际回复量。 */
  readonly healed: number;
}

export interface HealPulseResult {
  /** 玩家自疗量（未乘角色治疗修正）。 */
  readonly playerHeal: number;
  readonly summons: readonly HealPulseSummonHeal[];
}

/**
 * S06 治疗脉冲：固定治疗自身，并让半径内仍存活的召唤物回复最大生命的 20%。
 * 没有召唤物时只返回玩家治疗量（AC：无召唤物时仍治疗玩家）。
 * 治疗不产生伤害事件，因此不会触发任何受伤/命中类递归效果。
 */
export function resolveHealingPulse(options: {
  readonly center: CombatPoint;
  readonly summons?: readonly HealPulseSummon[];
  readonly strength?: number;
  readonly radius?: number;
  readonly summonHealRatio?: number;
}): HealPulseResult {
  const strength =
    Number.isFinite(options.strength) && (options.strength as number) > 0
      ? (options.strength as number)
      : 1;
  const playerHeal = FREE_SKILL_S06_HEAL_AMOUNT * strength;

  const requestedRadius = options.radius ?? FREE_SKILL_S06_SUMMON_RADIUS;
  const radius = Number.isFinite(requestedRadius)
    ? Math.max(0, requestedRadius)
    : FREE_SKILL_S06_SUMMON_RADIUS;
  const requestedRatio = options.summonHealRatio ?? FREE_SKILL_S06_SUMMON_HEAL_RATIO;
  const ratio = Number.isFinite(requestedRatio)
    ? Math.min(1, Math.max(0, requestedRatio))
    : FREE_SKILL_S06_SUMMON_HEAL_RATIO;

  const summons: HealPulseSummonHeal[] = [];
  if (radius > 0 && ratio > 0) {
    const maxDistanceSquared = (radius + TIME_EPSILON) * (radius + TIME_EPSILON);
    for (const summon of options.summons ?? []) {
      if (!summon || summon.isAlive === false) continue;
      if (
        !Number.isFinite(summon.x) ||
        !Number.isFinite(summon.y) ||
        !Number.isFinite(summon.maxHealth) ||
        !Number.isFinite(summon.health)
      ) {
        continue;
      }
      if (summon.maxHealth <= 0 || summon.health <= 0) continue;
      if (distanceSquared(options.center, summon) > maxDistanceSquared) continue;
      const amount = summon.maxHealth * ratio * strength;
      const healed = Math.max(
        0,
        Math.min(summon.maxHealth, summon.health + amount) - summon.health,
      );
      summons.push({ id: summon.id, amount, healed });
    }
  }
  return { playerHeal, summons };
}

/** S07 盾震授予的护盾量。 */
export const FREE_SKILL_S07_SHIELD_AMOUNT = requireFreeSkillParam(
  'S07',
  'shieldAmount',
);
/** S07 护盾持续时间（秒）；等级只放大护盾量，不延长时长。 */
export const FREE_SKILL_S07_SHIELD_DURATION_SECONDS = requireFreeSkillParam(
  'S07',
  'shieldDurationSeconds',
);
/** S07 冲击波对每个敌人的物理伤害。 */
export const FREE_SKILL_S07_DAMAGE = requireFreeSkillParam('S07', 'damage');
/** S07 冲击波半径（逻辑像素）。 */
export const FREE_SKILL_S07_RADIUS = requireFreeSkillParam('S07', 'radius');
/** S07 普通敌人的击退距离；精英与 Boss 不击退。 */
export const FREE_SKILL_S07_KNOCKBACK_DISTANCE = requireFreeSkillParam(
  'S07',
  'knockbackDistance',
);
export const FREE_SKILL_S07_DAMAGE_TYPE: DamageType = 'physical';

/** S07 护盾的续局快照：剩余时长、仍记在名下的护盾量与强度。 */
export interface ShieldBurstSave {
  readonly remainingSeconds: number;
  readonly shieldRemaining: number;
  readonly strength: number;
}

export function isShieldBurstSave(value: unknown): value is ShieldBurstSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isSnapshotSeconds(
      record.remainingSeconds,
      FREE_SKILL_S07_SHIELD_DURATION_SECONDS,
    ) &&
    typeof record.shieldRemaining === 'number' &&
    Number.isFinite(record.shieldRemaining) &&
    record.shieldRemaining >= 0 &&
    record.shieldRemaining <= 10000 &&
    isSnapshotStrength(record.strength)
  );
}

/**
 * S07 盾震的护盾计时：授予护盾并只持续 4 秒。
 * 到期时返回「仍记在本次护盾名下」的量，由场景从玩家护盾池中移除；
 * 被伤害提前消耗的部分已经不在池里，场景侧再做一次钳制。
 * 重复施放刷新时长与护盾量，不叠加两个独立计时器。
 */
export class ShieldBurstState {
  private remainingSeconds = 0;
  private shieldRemaining = 0;
  private strengthValue = 1;

  /** 开始（或刷新）护盾，返回本次授予的护盾量。 */
  start(strength: number): number {
    this.strengthValue =
      Number.isFinite(strength) && strength > 0 ? strength : 1;
    this.remainingSeconds = FREE_SKILL_S07_SHIELD_DURATION_SECONDS;
    this.shieldRemaining = FREE_SKILL_S07_SHIELD_AMOUNT * this.strengthValue;
    return this.shieldRemaining;
  }

  get isActive(): boolean {
    return this.remainingSeconds > TIME_EPSILON;
  }

  get remainingSecondsLeft(): number {
    return Math.max(0, this.remainingSeconds);
  }

  /** 本次护盾仍记在名下的量；到期后为 0。 */
  get shieldAmount(): number {
    return Math.max(0, this.shieldRemaining);
  }

  get strength(): number {
    return this.isActive ? this.strengthValue : 1;
  }

  /** 单个敌人的冲击波伤害（未乘全局倍率与护甲减免）。 */
  damagePerHit(): number {
    return FREE_SKILL_S07_DAMAGE * this.strengthValue;
  }

  /** 推进计时；到期返回应从玩家护盾池移除的量，其余时候返回 0。 */
  step(seconds: number): number {
    if (!(seconds > 0) || !Number.isFinite(seconds) || !this.isActive) return 0;
    this.remainingSeconds = Math.max(0, this.remainingSeconds - seconds);
    if (this.remainingSeconds > TIME_EPSILON) return 0;
    this.remainingSeconds = 0;
    const expired = this.shieldRemaining;
    this.shieldRemaining = 0;
    return expired;
  }

  /** 续局快照：剩余时长、护盾量与效果强度。 */
  saveSnapshot(): ShieldBurstSave {
    return {
      remainingSeconds: this.remainingSecondsLeft,
      shieldRemaining: this.shieldAmount,
      strength: this.strengthValue,
    };
  }

  /** 从续局快照恢复；缺省/损坏时清空。护盾已包含在生命快照里，不重复授予。 */
  restore(save: ShieldBurstSave | null | undefined): void {
    this.reset();
    if (!isShieldBurstSave(save)) return;
    this.remainingSeconds = save.remainingSeconds;
    this.shieldRemaining = save.shieldRemaining;
    this.strengthValue = save.strength;
  }

  /** 波初/重开清空，不把上一波护盾带入下一波。 */
  reset(): void {
    this.remainingSeconds = 0;
    this.shieldRemaining = 0;
    this.strengthValue = 1;
  }
}

/** S08 聚敌区半径（逻辑像素）。 */
export const FREE_SKILL_S08_RADIUS = requireFreeSkillParam('S08', 'radius');
/** S08 区域持续秒数。 */
export const FREE_SKILL_S08_DURATION_SECONDS = requireFreeSkillParam(
  'S08',
  'durationSeconds',
);
/** S08 每秒对区域内敌人的法术伤害。 */
export const FREE_SKILL_S08_DAMAGE_PER_SECOND = requireFreeSkillParam(
  'S08',
  'damagePerSecond',
);
/** S08 伤害与拉拽的结算间隔：每秒一次。 */
export const FREE_SKILL_S08_TICK_SECONDS = requireFreeSkillParam(
  'S08',
  'tickSeconds',
);
/** S08 落点的轻自瞄射程。 */
export const FREE_SKILL_S08_CAST_RANGE = requireFreeSkillParam(
  'S08',
  'castRange',
);
/** S08 没有合法目标时沿面向前方生成的距离。 */
export const FREE_SKILL_S08_CAST_DISTANCE = requireFreeSkillParam(
  'S08',
  'castDistance',
);
/** S08 每次 tick 把区域内普通敌人向中心拉近的距离。 */
export const FREE_SKILL_S08_PULL_PER_SECOND = requireFreeSkillParam(
  'S08',
  'pullPerSecond',
);
/** 已接近中心时保留的最小间距，避免拉拽越过中心来回抖动。 */
export const FREE_SKILL_S08_MIN_PULL_DISTANCE = 8;
export const FREE_SKILL_S08_DAMAGE_TYPE: DamageType = 'magic';

export interface GravityWellPlacement {
  /** 聚敌区中心；有目标时落在目标身上，否则沿面向前方固定距离。 */
  readonly center: CombatPoint;
  /** 轻自瞄选中的目标 ID；无目标为 null。 */
  readonly targetId: string | null;
}

/**
 * S08 落点：优先落在 ±25° 轻自瞄、射程内且无遮挡的目标位置；
 * 没有目标时沿面向前方 `castDistance` 处生成。
 */
export function resolveGravityWellPlacement<T extends FreeSkillAreaTarget>(options: {
  readonly origin: CombatPoint;
  readonly facing: Facing;
  readonly targets: readonly T[];
  readonly range?: number;
  readonly castDistance?: number;
  readonly halfAngleDegrees?: number;
  readonly preferredTargetId?: string | null;
  readonly lineOfSight?: LineOfSightCheck;
}): GravityWellPlacement {
  const aim = resolveAimAssist(options.origin, options.facing, options.targets, {
    range: options.range ?? FREE_SKILL_S08_CAST_RANGE,
    preferredTargetId: options.preferredTargetId ?? null,
    halfAngleDegrees: options.halfAngleDegrees,
    lineOfSight: options.lineOfSight,
  });
  if (aim.target) {
    return {
      center: { x: aim.target.x, y: aim.target.y },
      targetId: aim.target.id,
    };
  }
  const vector = FACING_VECTORS[options.facing];
  const distance = options.castDistance ?? FREE_SKILL_S08_CAST_DISTANCE;
  return {
    center: {
      x: options.origin.x + vector.x * distance,
      y: options.origin.y + vector.y * distance,
    },
    targetId: null,
  };
}

/** S08 重力井的续局快照：落点、剩余时长与本秒计时。 */
export interface GravityWellSave {
  readonly center: CombatPoint | null;
  readonly remainingSeconds: number;
  readonly tickElapsedSeconds: number;
  readonly strength: number;
}

export function isGravityWellSave(value: unknown): value is GravityWellSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.center !== null && !isSnapshotPoint(record.center)) return false;
  return (
    isSnapshotSeconds(
      record.remainingSeconds,
      FREE_SKILL_S08_DURATION_SECONDS,
    ) &&
    isSnapshotSeconds(record.tickElapsedSeconds, MAX_SNAPSHOT_EFFECT_SECONDS) &&
    isSnapshotStrength(record.strength)
  );
}

/**
 * S08 重力井计时：固定落点、持续 3 秒，每满 1 秒返回一次伤害/拉拽 tick。
 * 重复施放刷新为新的落点与时长，不叠加多个井。
 */
export class GravityWellState {
  private centerPoint: CombatPoint | null = null;
  private remainingSeconds = 0;
  private tickElapsedSeconds = 0;
  private strengthValue = 1;
  private firedTicks = 0;

  start(center: CombatPoint, strength: number): void {
    this.centerPoint = { x: center.x, y: center.y };
    this.remainingSeconds = FREE_SKILL_S08_DURATION_SECONDS;
    this.tickElapsedSeconds = 0;
    this.strengthValue =
      Number.isFinite(strength) && strength > 0 ? strength : 1;
    this.firedTicks = 0;
  }

  get isActive(): boolean {
    return this.remainingSeconds > TIME_EPSILON;
  }

  /** 最近一次施放的落点；未施放过为 null（结束后保留到波初清空）。 */
  get center(): CombatPoint | null {
    return this.centerPoint ? { ...this.centerPoint } : null;
  }

  get remainingSecondsLeft(): number {
    return Math.max(0, this.remainingSeconds);
  }

  get strength(): number {
    return this.isActive ? this.strengthValue : 1;
  }

  get ticksFired(): number {
    return this.firedTicks;
  }

  /** 单个 tick 对区域内每个敌人的伤害（未乘全局伤害倍率与抗性）。 */
  damagePerTick(): number {
    return FREE_SKILL_S08_DAMAGE_PER_SECOND * this.strengthValue;
  }

  /** 单个 tick 向中心的拉近距离。 */
  pullDistancePerTick(): number {
    return FREE_SKILL_S08_PULL_PER_SECOND * FREE_SKILL_S08_TICK_SECONDS;
  }

  /** 推进一个逻辑步，返回本步应结算的 tick 数（0–3）。 */
  step(seconds: number): number {
    if (!(seconds > 0) || !Number.isFinite(seconds) || !this.isActive) return 0;
    const effective = Math.min(seconds, this.remainingSeconds);
    this.remainingSeconds = Math.max(0, this.remainingSeconds - effective);
    this.tickElapsedSeconds += effective;

    const ticks = Math.floor(
      this.tickElapsedSeconds / FREE_SKILL_S08_TICK_SECONDS + TIME_EPSILON,
    );
    if (ticks <= 0) return 0;
    this.tickElapsedSeconds -= ticks * FREE_SKILL_S08_TICK_SECONDS;
    this.firedTicks += ticks;
    return ticks;
  }

  /** 续局快照：落点、剩余时长与 tick 进度。 */
  saveSnapshot(): GravityWellSave {
    return {
      center: this.center,
      remainingSeconds: this.remainingSecondsLeft,
      tickElapsedSeconds: this.tickElapsedSeconds,
      strength: this.strengthValue,
    };
  }

  /** 从续局快照恢复；缺省/损坏时清空。 */
  restore(save: GravityWellSave | null | undefined): void {
    this.reset();
    if (!isGravityWellSave(save)) return;
    this.centerPoint = save.center ? { x: save.center.x, y: save.center.y } : null;
    this.remainingSeconds = save.remainingSeconds;
    this.tickElapsedSeconds = Math.min(
      save.tickElapsedSeconds,
      FREE_SKILL_S08_TICK_SECONDS,
    );
    this.strengthValue = save.strength;
  }

  /** 波初/重开清空；落点一并丢弃。 */
  reset(): void {
    this.centerPoint = null;
    this.remainingSeconds = 0;
    this.tickElapsedSeconds = 0;
    this.strengthValue = 1;
    this.firedTicks = 0;
  }
}

/** S09 替身寿命（秒）。 */
export const FREE_SKILL_S09_DURATION_SECONDS = requireFreeSkillParam(
  'S09',
  'durationSeconds',
);
/** S09 复制 J 伤害的比例：0.35 表示每次 J 命中追加 35% 伤害。 */
export const FREE_SKILL_S09_DAMAGE_RATIO = requireFreeSkillParam(
  'S09',
  'damageRatio',
);
/** S09 默认同时存在的替身上限。 */
export const FREE_SKILL_S09_MAX_COUNT = requireFreeSkillParam('S09', 'maxCount');
/** S09 替身的占位站位距离（逻辑像素）：站在玩家面向的左手侧，避免重叠。 */
export const FREE_SKILL_S09_FOLLOW_DISTANCE = 30;

/** 单个替身的只读快照；位置由场景按玩家站位同步。 */
export interface WaterMirrorSnapshot {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly remainingSeconds: number;
  /** 本次施放的效果强度（等级 × 回响）。 */
  readonly strength: number;
}

/** 单个替身的续局快照：占位坐标、剩余寿命与强度。 */
export interface WaterMirrorSaveEntry {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly remainingSeconds: number;
  readonly strength: number;
}

/** S09 替身的续局快照。 */
export interface WaterMirrorSave {
  readonly mirrors: readonly WaterMirrorSaveEntry[];
}

/** 替身数量的宽松上限，只用于拒绝异常存档。 */
const MAX_SAVED_MIRRORS = 8;

export function isWaterMirrorSave(value: unknown): value is WaterMirrorSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.mirrors) ||
    record.mirrors.length > MAX_SAVED_MIRRORS
  ) {
    return false;
  }
  const seen = new Set<number>();
  for (const mirror of record.mirrors) {
    if (typeof mirror !== 'object' || mirror === null) return false;
    const entry = mirror as Record<string, unknown>;
    if (!isSnapshotCount(entry.id) || entry.id < 1 || seen.has(entry.id)) {
      return false;
    }
    if (!isSnapshotPoint(entry)) return false;
    if (
      !isSnapshotSeconds(
        entry.remainingSeconds,
        FREE_SKILL_S09_DURATION_SECONDS,
      )
    ) {
      return false;
    }
    if (!isSnapshotStrength(entry.strength)) return false;
    seen.add(entry.id);
  }
  return true;
}

/** 一次 S09 复制的结算结果；`source` 必然是 depth=1 的衍生来源。 */
export interface WaterMirrorEcho {
  readonly damage: number;
  readonly source: CombatEventSource;
}

/** S09 复制伤害折算：J 伤害 × 35% × 强度；非正输入返回 0。 */
export function waterMirrorCopyDamage(jDamage: number, strength = 1): number {
  if (!Number.isFinite(jDamage) || jDamage <= 0) return 0;
  const scale = Number.isFinite(strength) && strength > 0 ? strength : 1;
  return jDamage * FREE_SKILL_S09_DAMAGE_RATIO * scale;
}

/**
 * S09 水镜替身：外观复制玩家，每次 J 命中追加一次 35% 伤害。
 * 替身只复制 J 本体伤害，不复制分裂/回响/侧弹/爆炸等触发链：
 * - 复制的伤害来源只能从「原生 J」派生一层，衍生来源直接返回 null；
 * - 替身自身不生成弹体，也不会再次触发 J 命中类效果。
 * 默认同时最多 1 个；重复施放刷新时长并顶掉旧替身，不叠加数量。
 */
export class WaterMirrorState {
  private mirrorsList: {
    id: number;
    x: number;
    y: number;
    remainingSeconds: number;
    strength: number;
  }[] = [];
  private nextMirrorId = 1;
  private maxCountValue = FREE_SKILL_S09_MAX_COUNT;

  get maxCount(): number {
    return this.maxCountValue;
  }

  /** 调整上限（后续道具/海克斯可提高）；降低上限时立即裁掉最旧替身。 */
  setMaxCount(count: number): void {
    const clamped = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
    this.maxCountValue = clamped;
    while (this.mirrorsList.length > clamped) this.mirrorsList.shift();
  }

  get count(): number {
    return this.mirrorsList.length;
  }

  /** 当前替身快照；按放置顺序返回。 */
  entries(): WaterMirrorSnapshot[] {
    return this.mirrorsList.map((mirror) => ({
      id: mirror.id,
      x: mirror.x,
      y: mirror.y,
      remainingSeconds: Math.max(0, mirror.remainingSeconds),
      strength: mirror.strength,
    }));
  }

  /** 施放：达到上限时先顶掉最旧的替身，返回被顶掉的 ID。 */
  place(
    position: CombatPoint,
    strength: number,
  ): { readonly id: number; readonly replacedIds: readonly number[] } {
    const replacedIds: number[] = [];
    while (this.mirrorsList.length >= this.maxCountValue) {
      const oldest = this.mirrorsList.shift();
      if (oldest) replacedIds.push(oldest.id);
    }
    const mirror = {
      id: this.nextMirrorId,
      x: position.x,
      y: position.y,
      remainingSeconds: FREE_SKILL_S09_DURATION_SECONDS,
      strength: Number.isFinite(strength) && strength > 0 ? strength : 1,
    };
    this.nextMirrorId += 1;
    this.mirrorsList.push(mirror);
    return { id: mirror.id, replacedIds };
  }

  /** 单次复制对 J 伤害的折算（未乘目标减伤）。 */
  damageFor(jDamage: number, strength = 1): number {
    return waterMirrorCopyDamage(jDamage, strength);
  }

  /**
   * 推进寿命，并把替身同步到玩家站位；返回本步到期的替身 ID。
   * 超过剩余时长的步长不会让替身复活或延长。
   */
  step(seconds: number, position?: CombatPoint): number[] {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return [];
    const expired: number[] = [];
    const survivors: typeof this.mirrorsList = [];
    for (const mirror of this.mirrorsList) {
      mirror.remainingSeconds = Math.max(0, mirror.remainingSeconds - seconds);
      if (position) {
        mirror.x = position.x;
        mirror.y = position.y;
      }
      if (mirror.remainingSeconds <= TIME_EPSILON) expired.push(mirror.id);
      else survivors.push(mirror);
    }
    this.mirrorsList = survivors;
    return expired;
  }

  /** 续局快照：每个替身的坐标、剩余寿命与强度。 */
  saveSnapshot(): WaterMirrorSave {
    return { mirrors: this.entries() };
  }

  /** 从续局快照恢复；缺省/损坏时清空。ID 从最大值之后继续分配。 */
  restore(save: WaterMirrorSave | null | undefined): void {
    this.reset();
    if (!isWaterMirrorSave(save)) return;
    this.mirrorsList = save.mirrors.map((mirror) => ({
      id: mirror.id,
      x: mirror.x,
      y: mirror.y,
      remainingSeconds: mirror.remainingSeconds,
      strength: mirror.strength,
    }));
    this.nextMirrorId =
      this.mirrorsList.reduce((max, mirror) => Math.max(max, mirror.id), 0) + 1;
  }

  /** 波初/重开清空替身与计时。 */
  reset(): void {
    this.mirrorsList = [];
    this.maxCountValue = FREE_SKILL_S09_MAX_COUNT;
  }
}

/**
 * S09 的单次复制：只接受原生 J 来源，派生一层 S09 并折算 35% 伤害。
 * 父级已是衍生（分裂/回响/侧弹）或 J 未造成伤害时返回 null，
 * 保证替身不会复制触发链，也不会继续派生出新的触发。
 */
export function resolveWaterMirrorEcho(options: {
  readonly chains: DamageChainTracker;
  readonly parent: CombatEventSource | null;
  readonly jDamage: number;
  readonly strength?: number;
}): WaterMirrorEcho | null {
  if (!options.parent) return null;
  if (!Number.isFinite(options.jDamage) || options.jDamage <= 0) return null;
  const source = options.chains.derive(options.parent, 'S09');
  if (!source) return null;
  return {
    damage: waterMirrorCopyDamage(options.jDamage, options.strength ?? 1),
    source,
  };
}

/** S10 战旗区域持续秒数。 */
export const FREE_SKILL_S10_DURATION_SECONDS = requireFreeSkillParam(
  'S10',
  'durationSeconds',
);
/** S10 玩家站在区域内获得的护甲。 */
export const FREE_SKILL_S10_ARMOR_BONUS = requireFreeSkillParam(
  'S10',
  'armorBonus',
);
/** S10 敌人首次接触区域的物理伤害。 */
export const FREE_SKILL_S10_CONTACT_DAMAGE = requireFreeSkillParam(
  'S10',
  'contactDamage',
);
/** S10 战旗区域半径（逻辑像素）。 */
export const FREE_SKILL_S10_RADIUS = requireFreeSkillParam('S10', 'radius');
export const FREE_SKILL_S10_DAMAGE_TYPE: DamageType = 'physical';

/** S10 战旗的续局快照：落点、剩余时长、强度与首次接触记录。 */
export interface WarBannerSave {
  readonly center: CombatPoint | null;
  readonly remainingSeconds: number;
  readonly strength: number;
  readonly contactedIds: readonly string[];
  readonly contactHits: number;
}

export function isWarBannerSave(value: unknown): value is WarBannerSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.center !== null && !isSnapshotPoint(record.center)) return false;
  if (
    !isSnapshotSeconds(
      record.remainingSeconds,
      FREE_SKILL_S10_DURATION_SECONDS,
    )
  ) {
    return false;
  }
  if (!isSnapshotStrength(record.strength)) return false;
  if (
    !Array.isArray(record.contactedIds) ||
    record.contactedIds.length > MAX_SLOW_ENTRIES
  ) {
    return false;
  }
  const seen = new Set<string>();
  for (const id of record.contactedIds) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) return false;
    seen.add(id);
  }
  return isSnapshotCount(record.contactHits);
}

/**
 * S10 反击战旗：在施放位置立起固定区域，持续 6 秒。
 * - 玩家只有在区域内才获得护甲加成，离开或区域到期立即失效；
 * - 每个敌人每次施放只有第一次进入区域时受到 45 物理伤害，
 *   之后离开再回来不重复触发（AC：首次接触）。
 */
export class WarBannerState {
  private centerPoint: CombatPoint | null = null;
  private remainingSeconds = 0;
  private strengthValue = 1;
  private readonly contactedIds = new Set<string>();
  private contactHits = 0;

  /** 立起战旗；重复施放替换旧区域并清空首次接触记录。 */
  start(center: CombatPoint, strength: number): void {
    this.centerPoint = { x: center.x, y: center.y };
    this.remainingSeconds = FREE_SKILL_S10_DURATION_SECONDS;
    this.strengthValue =
      Number.isFinite(strength) && strength > 0 ? strength : 1;
    this.contactedIds.clear();
    this.contactHits = 0;
  }

  get isActive(): boolean {
    return this.remainingSeconds > TIME_EPSILON;
  }

  /** 战旗中心；区域到期后为 null。 */
  get center(): CombatPoint | null {
    return this.isActive && this.centerPoint
      ? { ...this.centerPoint }
      : null;
  }

  get remainingSecondsLeft(): number {
    return Math.max(0, this.remainingSeconds);
  }

  get strength(): number {
    return this.isActive ? this.strengthValue : 1;
  }

  /** 已触发首次接触伤害的敌人总数；供开发快照核对。 */
  get contactHitCount(): number {
    return this.contactHits;
  }

  /**
   * 护甲加成：区域未生效为 0；传入点位时还要求该点在区域内，
   * 用于「离开区域立即失效」的实时判定。
   */
  armorBonusAt(point?: CombatPoint): number {
    if (!this.isActive) return 0;
    if (point && !this.contains(point)) return 0;
    return FREE_SKILL_S10_ARMOR_BONUS * this.strengthValue;
  }

  /** 单次首次接触的伤害（未乘全局倍率与护甲减免）。 */
  contactDamage(): number {
    return FREE_SKILL_S10_CONTACT_DAMAGE * this.strengthValue;
  }

  /** 点位是否落在生效中的战旗区域内（边界包含）。 */
  contains(point: CombatPoint, radius = FREE_SKILL_S10_RADIUS): boolean {
    if (!this.isActive || !this.centerPoint) return false;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    const area = Number.isFinite(radius) ? Math.max(0, radius) : 0;
    if (area <= 0) return false;
    const maxDistanceSquared = (area + TIME_EPSILON) * (area + TIME_EPSILON);
    return distanceSquared(this.centerPoint, point) <= maxDistanceSquared;
  }

  /**
   * 选出本步首次进入区域的目标并记账；同一目标每次施放只返回一次。
   * 区域已结束或目标已死亡时不触发。
   */
  claimContacts<T extends FreeSkillAreaTarget>(
    targets: readonly T[],
    radius = FREE_SKILL_S10_RADIUS,
  ): T[] {
    if (!this.isActive || !this.centerPoint) return [];
    const hits: T[] = [];
    for (const target of targets) {
      if (target.isAlive === false) continue;
      if (this.contactedIds.has(target.id)) continue;
      if (!this.contains(target, radius)) continue;
      this.contactedIds.add(target.id);
      hits.push(target);
    }
    this.contactHits += hits.length;
    return hits;
  }

  /** 推进区域时长；到期后中心与首次接触记录一并清空。 */
  step(seconds: number): void {
    if (!(seconds > 0) || !Number.isFinite(seconds) || !this.isActive) return;
    this.remainingSeconds = Math.max(0, this.remainingSeconds - seconds);
    if (this.remainingSeconds > TIME_EPSILON) return;
    this.remainingSeconds = 0;
    this.centerPoint = null;
    this.contactedIds.clear();
  }

  /** 续局快照：区域、剩余时长与已触发首次接触的敌人。 */
  saveSnapshot(): WarBannerSave {
    return {
      center: this.center,
      remainingSeconds: this.remainingSecondsLeft,
      strength: this.strengthValue,
      contactedIds: [...this.contactedIds],
      contactHits: this.contactHits,
    };
  }

  /** 从续局快照恢复；缺省/损坏时清空。首次接触记录随敌人 ID 一起恢复。 */
  restore(save: WarBannerSave | null | undefined): void {
    this.reset();
    if (!isWarBannerSave(save)) return;
    this.centerPoint = save.center ? { x: save.center.x, y: save.center.y } : null;
    this.remainingSeconds = save.remainingSeconds;
    this.strengthValue = save.strength;
    for (const id of save.contactedIds) this.contactedIds.add(id);
    this.contactHits = save.contactHits;
  }

  /** 波初/重开清空战旗区域。 */
  reset(): void {
    this.centerPoint = null;
    this.remainingSeconds = 0;
    this.strengthValue = 1;
    this.contactedIds.clear();
    this.contactHits = 0;
  }
}

/** S11 扇射张角（度）：五枚弹平均分布在这个扇区内。 */
export const FREE_SKILL_S11_SPREAD_DEGREES = requireFreeSkillParam(
  'S11',
  'spreadDegrees',
);
/** S11 每次施放的弹丸数量。 */
export const FREE_SKILL_S11_PELLET_COUNT = requireFreeSkillParam(
  'S11',
  'pelletCount',
);
/** S11 每枚弹的基础物理伤害。 */
export const FREE_SKILL_S11_DAMAGE = requireFreeSkillParam('S11', 'damage');/** S11 同一目标被后续弹再次命中时的伤害比例。 */
export const FREE_SKILL_S11_REPEAT_RATIO = requireFreeSkillParam(
  'S11',
  'repeatDamageRatio',
);
/** S11 弹丸射程（逻辑像素）；目录未给，取与 S03 同级的 320。 */
export const FREE_SKILL_S11_RANGE = requireFreeSkillParam('S11', 'range');
export const FREE_SKILL_S11_DAMAGE_TYPE: DamageType = 'physical';

/** 单枚 S11 弹丸的伤害（仅乘技能强度，未乘全局技能倍率与目标减免）。 */
export function shotgunPelletDamage(strength = 1): number {
  const scale = Number.isFinite(strength) && strength > 0 ? strength : 1;
  return FREE_SKILL_S11_DAMAGE * scale;
}

/**
 * S11 扇射方向：以轻自瞄校正后的方向为中心，在 ±50°/2 内均分生成弹丸方向。
 * 方向在发射瞬间固定，弹丸之后不会追踪目标（只保留直线飞行）。
 */
export function shotgunFanDirections(
  centerDirection: MoveVector,
  options: {
    readonly spreadDegrees?: number;
    readonly count?: number;
  } = {},
): MoveVector[] {
  const normalized = normalizeVector(centerDirection.x, centerDirection.y);
  const fallback = normalized.x === 0 && normalized.y === 0
    ? { x: 1, y: 0 }
    : normalized;
  const spread = Number.isFinite(options.spreadDegrees)
    ? Math.min(180, Math.max(0, options.spreadDegrees as number))
    : FREE_SKILL_S11_SPREAD_DEGREES;
  const rawCount = options.count ?? FREE_SKILL_S11_PELLET_COUNT;
  const count = Number.isFinite(rawCount)
    ? Math.max(1, Math.floor(rawCount))
    : FREE_SKILL_S11_PELLET_COUNT;
  const centerAngle = Math.atan2(fallback.y, fallback.x);
  const spreadRadians = (spread * Math.PI) / 180;
  return Array.from({ length: count }, (_, index) => {
    const offset =
      count === 1 ? 0 : -spreadRadians / 2 + (spreadRadians * index) / (count - 1);
    const angle = centerAngle + offset;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
}

/**
 * S11 同一次施放的命中记账：同一目标第一次吃 100%，之后每次只吃 35%。
 * 五枚弹丸共享一个实例；不同目标之间互不影响。
 */
export class ShotgunVolleyTracker {
  private readonly hitTargetIds = new Set<string>();

  /** 结算一次命中并返回本次伤害倍率；重复命中同一目标返回 0.35。 */
  damageMultiplierOnHit(targetId: string): number {
    if (this.hitTargetIds.has(targetId)) return FREE_SKILL_S11_REPEAT_RATIO;
    this.hitTargetIds.add(targetId);
    return 1;
  }

  hasHit(targetId: string): boolean {
    return this.hitTargetIds.has(targetId);
  }

  get hitCount(): number {
    return this.hitTargetIds.size;
  }

  reset(): void {
    this.hitTargetIds.clear();
  }
}

/** S12 标记持续秒数。 */
export const FREE_SKILL_S12_DURATION_SECONDS = requireFreeSkillParam(
  'S12',
  'durationSeconds',
);
/** S12 目标受到伤害的额外比例：0.15 表示 ×1.15。 */
export const FREE_SKILL_S12_DAMAGE_BONUS = requireFreeSkillParam(
  'S12',
  'damageBonus',
);
/** S12 击杀标记目标额外获得的基础金币。 */
export const FREE_SKILL_S12_BOUNTY_GOLD = requireFreeSkillParam(
  'S12',
  'bountyGold',
);
/** S12 每波最多可领取的赏金次数。 */
export const FREE_SKILL_S12_MAX_BOUNTY_PER_WAVE = requireFreeSkillParam(
  'S12',
  'maxBountyPerWave',
);
/** S12 标记射程（逻辑像素）；目录未给，取 360 以便在 J 射程外先手标记。 */
export const FREE_SKILL_S12_RANGE = requireFreeSkillParam('S12', 'range');

/** 标记的只读快照。 */
export interface BountyMarkSnapshot {
  readonly active: boolean;
  readonly targetId: string | null;
  readonly remainingSeconds: number;
  /** 本次施放的效果强度（等级 × 回响）。 */
  readonly strength: number;
  /** 本波已领取的赏金次数。 */
  readonly claimedCount: number;
  readonly maxPerWave: number;
}

/** S12 标记的续局快照：目标、剩余时长、本波次数与已领取目标。 */
export interface BountyMarkSave {
  readonly targetId: string | null;
  readonly remainingSeconds: number;
  readonly strength: number;
  readonly claimedCount: number;
  readonly paidTargetIds: readonly string[];
}

export function isBountyMarkSave(value: unknown): value is BountyMarkSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    record.targetId !== null &&
    (typeof record.targetId !== 'string' || record.targetId.length === 0)
  ) {
    return false;
  }
  if (
    !isSnapshotSeconds(
      record.remainingSeconds,
      FREE_SKILL_S12_DURATION_SECONDS,
    )
  ) {
    return false;
  }
  if (!isSnapshotStrength(record.strength)) return false;
  if (!isSnapshotCount(record.claimedCount)) return false;
  if (
    !Array.isArray(record.paidTargetIds) ||
    record.paidTargetIds.length > MAX_SLOW_ENTRIES
  ) {
    return false;
  }
  const seen = new Set<string>();
  for (const id of record.paidTargetIds) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/**
 * S12 赏金标记：同一时间只保留一个标记，重复施放替换旧目标。
 * - 目标受到伤害 ×(1 + 15% × 强度)；
 * - 目标死亡时领取一次 12×强度 金币（四舍五入），每波最多 2 次；
 * - 已领取过赏金的目标不会再次给钱，宝箱即使传入也不结算；
 * - 标记目标死亡/离场由场景调用 `clear`，剩余时长走 `step`。
 */
export class BountyMarkState {
  private targetIdValue: string | null = null;
  private remainingSeconds = 0;
  private strengthValue = 1;
  private claimed = 0;
  private readonly paidTargetIds = new Set<string>();

  /** 标记目标；空 ID 或宝箱不标记。重复施放替换旧标记，不叠加。 */
  mark(targetId: string, strength: number): boolean {
    if (typeof targetId !== 'string' || targetId.length === 0) return false;
    this.targetIdValue = targetId;
    this.remainingSeconds = FREE_SKILL_S12_DURATION_SECONDS;
    this.strengthValue =
      Number.isFinite(strength) && strength > 0 ? strength : 1;
    return true;
  }

  get isActive(): boolean {
    return this.remainingSeconds > TIME_EPSILON && this.targetIdValue !== null;
  }

  get targetId(): string | null {
    return this.isActive ? this.targetIdValue : null;
  }

  get remainingSecondsLeft(): number {
    return Math.max(0, this.remainingSeconds);
  }

  get strength(): number {
    return this.strengthValue;
  }

  get claimedCount(): number {
    return this.claimed;
  }

  get maxPerWave(): number {
    return FREE_SKILL_S12_MAX_BOUNTY_PER_WAVE;
  }

  /** 本次标记的增伤比例（0.15 × 强度）。 */
  damageBonus(): number {
    return FREE_SKILL_S12_DAMAGE_BONUS * this.strengthValue;
  }

  /** 目标受到伤害的倍率；未标记该目标时为 1。 */
  damageMultiplierFor(targetId: string): number {
    if (!this.isActive || this.targetIdValue !== targetId) return 1;
    return 1 + this.damageBonus();
  }

  /** 击杀赏金：基础 12 × 强度，四舍五入；等级 1 恰为 12。 */
  bountyGold(): number {
    return Math.round(FREE_SKILL_S12_BOUNTY_GOLD * this.strengthValue);
  }

  /**
   * 领取一次击杀赏金并消耗标记；不满足条件返回 0：
   * 目标不是当前标记、宝箱、本波次数已满、或该目标已领取过。
   */
  claimKill(
    targetId: string,
    options: { readonly isChest?: boolean } = {},
  ): number {
    if (options.isChest === true) return 0;
    if (!this.isActive || this.targetIdValue !== targetId) return 0;
    if (this.claimed >= FREE_SKILL_S12_MAX_BOUNTY_PER_WAVE) return 0;
    if (this.paidTargetIds.has(targetId)) return 0;
    this.paidTargetIds.add(targetId);
    this.claimed += 1;
    const gold = this.bountyGold();
    this.clear();
    return gold;
  }

  /** 推进标记时长；到期返回被清除的目标 ID，否则 null。 */
  step(seconds: number): string | null {
    if (!(seconds > 0) || !Number.isFinite(seconds) || !this.isActive) {
      return null;
    }
    this.remainingSeconds = Math.max(0, this.remainingSeconds - seconds);
    if (this.remainingSeconds > TIME_EPSILON) return null;
    const expired = this.targetIdValue;
    this.clear();
    return expired;
  }

  /** 清除当前标记；不重置本波已领取次数。 */
  clear(): void {
    this.targetIdValue = null;
    this.remainingSeconds = 0;
    this.strengthValue = 1;
  }

  /** 波初重置：清标记、本波赏金次数与已领取目标。 */
  resetForWave(): void {
    this.clear();
    this.claimed = 0;
    this.paidTargetIds.clear();
  }

  /** 续局快照：当前标记、剩余时长与每波赏金记账。 */
  saveSnapshot(): BountyMarkSave {
    return {
      targetId: this.targetIdValue,
      remainingSeconds: this.remainingSecondsLeft,
      strength: this.strengthValue,
      claimedCount: this.claimed,
      paidTargetIds: [...this.paidTargetIds],
    };
  }

  /** 从续局快照恢复；缺省/损坏时清空。已领取次数与目标不随刷新重置。 */
  restore(save: BountyMarkSave | null | undefined): void {
    this.resetForWave();
    if (!isBountyMarkSave(save)) return;
    this.targetIdValue = save.targetId;
    this.remainingSeconds = save.remainingSeconds;
    this.strengthValue = save.strength;
    this.claimed = save.claimedCount;
    for (const id of save.paidTargetIds) this.paidTargetIds.add(id);
  }

  snapshot(): BountyMarkSnapshot {
    return {
      active: this.isActive,
      targetId: this.targetId,
      remainingSeconds: this.remainingSecondsLeft,
      strength: this.strengthValue,
      claimedCount: this.claimed,
      maxPerWave: FREE_SKILL_S12_MAX_BOUNTY_PER_WAVE,
    };
  }
}

/** 自由技能的控制类型：硬控与拉拽在 Boss 身上统一降级为减速。 */
export type FreeSkillControlKind = 'stun' | 'root' | 'slow' | 'pull';

export interface FreeSkillControlEffect {
  readonly kind: FreeSkillControlKind;
  readonly percent: number;
  readonly durationSeconds: number;
}

/**
 * Boss 控制转换：硬控（眩晕/束缚）与拉拽改为 40% 减速，时长不变。
 * 普通敌人与本来就是减速的效果原样返回，调用方据此写入同一个减速状态。
 */
export function toBossSafeControl(
  effect: FreeSkillControlEffect,
  isBoss: boolean,
): FreeSkillControlEffect {
  if (!isBoss || effect.kind === 'slow') return effect;
  return {
    kind: 'slow',
    percent: BOSS_CONTROL_SLOW_PERCENT,
    durationSeconds: effect.durationSeconds,
  };
}

/** 可被自由技能范围选中的最小目标；`Combatant` 直接满足。 */
export interface FreeSkillAreaTarget extends CombatPoint {
  readonly id: string;
  readonly isAlive: boolean;
}

/**
 * 以自身为圆心的范围选敌：不读取面向，前后左右一视同仁。
 * 边界按 `distance² <= radius²` 包含，与既有范围结算口径一致。
 */
export function listFreeSkillTargetsInRadius<T extends FreeSkillAreaTarget>(
  center: CombatPoint,
  radius: number,
  targets: readonly T[],
  lineOfSight?: (from: CombatPoint, to: CombatPoint) => boolean,
): T[] {
  const area = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  if (area <= 0) return [];
  const maxDistanceSquared = (area + TIME_EPSILON) * (area + TIME_EPSILON);
  return targets.filter((target) => {
    if (target.isAlive === false) return false;
    if (distanceSquared(center, target) > maxDistanceSquared) return false;
    if (lineOfSight && !lineOfSight(center, target)) return false;
    return true;
  });
}

/**
 * 一次自由技能施放建立一个原生伤害链；S01 的三次 tick 共用它。
 * 后续派生（击杀爆炸、追加伤害）只能经 `derive` 取得 depth=1，无法继续派生。
 */
export function beginFreeSkillSource(
  chains: DamageChainTracker,
  skillId: string,
): CombatEventSource {
  return chains.beginNative(skillId);
}

/**
 * V2 续局快照中的自由技能运行态（US-065）。
 * 各字段可选：旧存档缺少某项时按该效果未激活恢复，不判损坏。
 */
export interface FreeSkillEffectsSave {
  readonly spinningBlades?: SpinningBladeSave;
  readonly slows?: FreeSkillSlowSave;
  readonly fireTrail?: FireTrailSave;
  readonly turrets?: TurretFieldSave;
  readonly shieldBurst?: ShieldBurstSave;
  readonly gravityWell?: GravityWellSave;
  readonly waterMirror?: WaterMirrorSave;
  readonly warBanner?: WarBannerSave;
  readonly bountyMark?: BountyMarkSave;
}

export function isFreeSkillEffectsSave(
  value: unknown,
): value is FreeSkillEffectsSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.spinningBlades !== undefined && !isSpinningBladeSave(record.spinningBlades)) {
    return false;
  }
  if (record.slows !== undefined && !isFreeSkillSlowSave(record.slows)) {
    return false;
  }
  if (record.fireTrail !== undefined && !isFireTrailSave(record.fireTrail)) {
    return false;
  }
  if (record.turrets !== undefined && !isTurretFieldSave(record.turrets)) {
    return false;
  }
  if (record.shieldBurst !== undefined && !isShieldBurstSave(record.shieldBurst)) {
    return false;
  }
  if (record.gravityWell !== undefined && !isGravityWellSave(record.gravityWell)) {
    return false;
  }
  if (record.waterMirror !== undefined && !isWaterMirrorSave(record.waterMirror)) {
    return false;
  }
  if (record.warBanner !== undefined && !isWarBannerSave(record.warBanner)) {
    return false;
  }
  if (record.bountyMark !== undefined && !isBountyMarkSave(record.bountyMark)) {
    return false;
  }
  return true;
}
