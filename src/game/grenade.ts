/**
 * 维什戴尔榴弹的溅射、延时余震与残影引爆（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/game-design.md` §5.1：
 * - 直接命中：以命中点为中心造成 36 物伤（半径 32），主目标附着一层残影；
 * - 0.35 秒后同位置余震：半径 32 内 18 物伤；
 * - 余震命中带残影的敌人时消耗标记，以其当前位置产生半径 42、24 物伤爆炸并眩晕 0.3 秒；
 * - 残影爆炸本身不再登记余震、也不附着或消耗新的残影，避免无限递归。
 *
 * 强化实效（`docs/game-design.md` §6.3）：
 * - W01 二次余震：每发榴弹额外登记一次 0.7 秒后、50% 直接伤害的余震；
 * - W02 标记传染：残影引爆后给爆心周围最多 2 个未标记敌人附着残影，
 *   新标记不在本次爆炸中引爆，也不登记新余震。
 *
 * 时间按固定逻辑步长的秒数累计；位置为逻辑像素。
 */
import { distanceSquared, type DamageResult } from './combat';
import {
  requireUpgradeParam,
  type AttackDefinition,
  type DamageType,
} from './data';
import type { GrenadeWorldSnapshot } from './world-snapshot';

/** 浮点累计容差。 */
const TIME_EPSILON = 1e-9;

/** W01 追加余震的延迟与伤害比例。 */
export const W01_EXTRA_AFTERSHOCK_DELAY_SECONDS = requireUpgradeParam('W01', 'delaySeconds');
export const W01_EXTRA_AFTERSHOCK_DAMAGE_RATIO = requireUpgradeParam('W01', 'damageRatio');

/** W02 每次残影引爆最多扩散的标记数。 */
export const W02_SPREAD_TARGETS = Math.max(
  0,
  Math.floor(requireUpgradeParam('W02', 'spreadTargets')),
);

/** 可被榴弹/余震/残影爆炸影响的最小实体信息。 */
export interface GrenadeTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly isAlive: boolean;
  applyDamage(rawDamage: number, damageType: DamageType): DamageResult;
}

/** 残影引爆参数（`CharacterDefinition.passive.afterimage`）。 */
export interface AfterimageConfig {
  readonly damage: number;
  readonly damageType: DamageType;
  readonly radius: number;
  readonly stunSeconds: number;
}

/** 爆炸中心到目标是否可见；返回 false 时该目标不受爆炸伤害（不穿墙）。 */
export type ExplosionLineOfSight = (
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
) => boolean;

export interface ExplosionHit {
  readonly targetId: string;
  readonly damage: DamageResult;
}

export interface GrenadeDetonation {
  readonly x: number;
  readonly y: number;
  /** 本次直接伤害使用的溅射半径（强化弹会提高）。 */
  readonly splashRadius: number;
  /** 直接伤害命中的目标（含主目标）。 */
  readonly hits: readonly ExplosionHit[];
  readonly primaryTargetId: string | null;
  /** 成功附着残影的目标；主目标已死亡时为 null。 */
  readonly markedTargetId: string | null;
  /** 本次引爆登记了延时余震时的延迟秒数；无余震配置时为 null。 */
  readonly aftershockDelaySeconds: number | null;
  /** 本次登记的延时余震半径（爆裂黎明只提高溅射半径，不改余震半径）。 */
  readonly aftershockRadius: number | null;
  /** W01 追加余震的延迟秒数；未拥有 W01 时为 null。 */
  readonly extraAftershockDelaySeconds: number | null;
  /** W01 追加余震的半径；未拥有 W01 时为 null。 */
  readonly extraAftershockRadius: number | null;
}

export interface AfterimageExplosion {
  readonly sourceTargetId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly stunSeconds: number;
  readonly hits: readonly ExplosionHit[];
  /** W02 本次引爆扩散到的新标记目标；未拥有 W02 时为空。 */
  readonly spreadTargetIds: readonly string[];
}

export interface AftershockResolution {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** 余震本身命中的目标。 */
  readonly hits: readonly ExplosionHit[];
  /** 由本次余震消耗残影触发的爆炸；每个带残影的被命中目标一次。 */
  readonly explosions: readonly AfterimageExplosion[];
}

interface PendingAftershock {
  readonly dueAt: number;
  readonly x: number;
  readonly y: number;
  readonly damage: number;
  readonly damageType: DamageType;
  readonly radius: number;
}

/**
 * 榴弹结算器：维护残影标记、眩晕剩余时间与待结算的延时余震。
 * 场景只在逻辑步内调用 `step`，渲染帧率不影响任何计时。
 */
export class GrenadeSystem {
  private readonly directRadius: number;
  private readonly directDamage: number;
  private readonly directDamageType: DamageType;
  private readonly aftershock: {
    readonly delaySeconds: number;
    readonly damage: number;
    readonly damageType: DamageType;
    readonly radius: number;
  };
  private readonly afterimage: AfterimageConfig;
  /** 可选通视判定：爆炸/余震/引爆不伤害被墙挡住的敌人。 */
  private readonly lineOfSight: ExplosionLineOfSight | null;
  private readonly marks = new Set<string>();
  private readonly stunUntil = new Map<string, number>();
  private pending: PendingAftershock[] = [];
  private elapsed = 0;
  /** G01 等全局伤害增益；直接、余震与残影引爆统一乘该倍率。 */
  private damageMultiplier = 1;
  /** W01 是否追加第二次余震。 */
  private secondAftershockEnabled = false;
  /** W02 每次残影引爆最多扩散的标记数；0 表示关闭。 */
  private markSpreadTargets = 0;

  constructor(
    attack: AttackDefinition,
    afterimage: AfterimageConfig,
    lineOfSight: ExplosionLineOfSight | null = null,
  ) {
    if (!attack.aftershock) {
      throw new Error('GrenadeSystem requires attack.aftershock');
    }
    if (!(attack.splashRadius && attack.splashRadius > 0)) {
      throw new Error('GrenadeSystem requires a positive attack.splashRadius');
    }
    this.directRadius = attack.splashRadius;
    this.directDamage = attack.damage;
    this.directDamageType = attack.damageType;
    this.aftershock = attack.aftershock;
    this.afterimage = afterimage;
    this.lineOfSight = lineOfSight;
  }

  get pendingAftershockCount(): number {
    return this.pending.length;
  }

  /** 更新全局伤害倍率（G01 每层 +12%），立即作用于后续全部爆炸伤害。 */
  setDamageMultiplier(multiplier: number): void {
    this.damageMultiplier =
      Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  }

  /** W01：每发榴弹额外登记一次 0.7 秒后、50% 直接伤害的余震。 */
  setSecondAftershock(enabled: boolean): void {
    this.secondAftershockEnabled = enabled;
  }

  /**
   * W02：残影引爆后向爆心周围最多 N 个未标记敌人扩散标记。
   * 只附着标记，不登记余震、不在本次爆炸中引爆新标记。
   */
  setMarkSpread(enabled: boolean): void {
    this.markSpreadTargets = enabled ? W02_SPREAD_TARGETS : 0;
  }

  get markedIds(): readonly string[] {
    return [...this.marks];
  }

  /** 波中快照：残影标记、眩晕剩余与待结算余震。 */
  snapshotWorld(): GrenadeWorldSnapshot {
    return {
      elapsedSeconds: this.elapsed,
      marks: [...this.marks],
      stuns: [...this.stunUntil.entries()]
        .map(([targetId, until]) => ({
          targetId,
          remainingSeconds: Math.max(0, until - this.elapsed),
        }))
        .filter((entry) => entry.remainingSeconds > 0),
      pending: this.pending.map((entry) => ({
        dueInSeconds: Math.max(0, entry.dueAt - this.elapsed),
        x: entry.x,
        y: entry.y,
        damage: entry.damage,
        damageType: entry.damageType,
        radius: entry.radius,
      })),
    };
  }

  /** 从波中快照恢复：余震到期时间与眩晕按当前逻辑时钟换算。 */
  restoreWorld(state: GrenadeWorldSnapshot): void {
    this.elapsed = nonNegative(state.elapsedSeconds);
    this.marks.clear();
    for (const targetId of state.marks) this.marks.add(targetId);
    this.stunUntil.clear();
    for (const stun of state.stuns) {
      const remaining = nonNegative(stun.remainingSeconds);
      if (remaining > 0) this.stunUntil.set(stun.targetId, this.elapsed + remaining);
    }
    this.pending = state.pending.map((entry) => ({
      dueAt: this.elapsed + nonNegative(entry.dueInSeconds),
      x: entry.x,
      y: entry.y,
      damage: entry.damage,
      damageType: entry.damageType,
      radius: entry.radius,
    }));
  }

  isMarked(targetId: string): boolean {
    return this.marks.has(targetId);
  }

  /** 附着一层残影；同一目标只保留一层。 */
  mark(targetId: string): void {
    this.marks.add(targetId);
  }

  /** 剩余眩晕秒数；非正数表示未眩晕。 */
  stunRemaining(targetId: string): number {
    const until = this.stunUntil.get(targetId);
    if (until === undefined) return 0;
    const remaining = until - this.elapsed;
    return remaining > TIME_EPSILON ? remaining : 0;
  }

  isStunned(targetId: string): boolean {
    return this.stunRemaining(targetId) > 0;
  }

  /**
   * 榴弹直接命中：以命中点为中心结算溅射伤害，主目标附着残影，并登记延时余震。
   * 余震绑定命中位置而不是目标，因此主目标死亡后仍会在原位置爆炸。
   *
   * `attack` 为实际发射该弹的攻击定义；爆裂黎明强化后的伤害/溅射半径由它带入，
   * 余震也按该发弹的余震参数登记。缺省时使用构造时的基础配置。
   */
  detonate(
    impact: { readonly x: number; readonly y: number },
    primaryTargetId: string,
    targets: readonly GrenadeTarget[],
    attack?: AttackDefinition,
  ): GrenadeDetonation {
    const splashRadius = attack?.splashRadius ?? this.directRadius;
    const directDamage = attack?.damage ?? this.directDamage;
    const directDamageType = attack?.damageType ?? this.directDamageType;
    const aftershock = attack?.aftershock ?? this.aftershock;

    const hits = this.damageWithin(
      impact,
      splashRadius,
      targets,
      directDamage,
      directDamageType,
    );

    const primary = targets.find((target) => target.id === primaryTargetId) ?? null;
    let markedTargetId: string | null = null;
    if (primary) {
      // 碰撞半径可能让主目标落在溅射半径外，直接命中仍必须结算一次伤害。
      if (!hits.some((hit) => hit.targetId === primary.id) && primary.isAlive) {
        hits.push({
          targetId: primary.id,
          damage: primary.applyDamage(
            directDamage * this.damageMultiplier,
            directDamageType,
          ),
        });
      }
      if (primary.isAlive) {
        this.marks.add(primary.id);
        markedTargetId = primary.id;
      }
    }

    this.pending.push({
      dueAt: this.elapsed + aftershock.delaySeconds,
      x: impact.x,
      y: impact.y,
      damage: aftershock.damage,
      damageType: aftershock.damageType,
      radius: aftershock.radius,
    });

    // W01：每发榴弹多一次 0.7 秒后、直接伤害 50% 的余震；同样绑定命中坐标。
    let extraAftershockDelaySeconds: number | null = null;
    let extraAftershockRadius: number | null = null;
    if (this.secondAftershockEnabled) {
      this.pending.push({
        dueAt: this.elapsed + W01_EXTRA_AFTERSHOCK_DELAY_SECONDS,
        x: impact.x,
        y: impact.y,
        damage: directDamage * W01_EXTRA_AFTERSHOCK_DAMAGE_RATIO,
        damageType: directDamageType,
        radius: aftershock.radius,
      });
      extraAftershockDelaySeconds = W01_EXTRA_AFTERSHOCK_DELAY_SECONDS;
      extraAftershockRadius = aftershock.radius;
    }

    return {
      x: impact.x,
      y: impact.y,
      splashRadius,
      hits,
      primaryTargetId: primary?.id ?? null,
      markedTargetId,
      aftershockDelaySeconds: aftershock.delaySeconds,
      aftershockRadius: aftershock.radius,
      extraAftershockDelaySeconds,
      extraAftershockRadius,
    };
  }

  /**
   * 推进逻辑时间并结算到期的余震。返回值按登记顺序排列，供场景逐次播放特效。
   */
  step(stepSeconds: number, targets: readonly GrenadeTarget[]): AftershockResolution[] {
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) return [];

    this.elapsed += stepSeconds;

    const due: PendingAftershock[] = [];
    const remaining: PendingAftershock[] = [];
    for (const entry of this.pending) {
      if (entry.dueAt <= this.elapsed + TIME_EPSILON) due.push(entry);
      else remaining.push(entry);
    }
    this.pending = remaining;

    return due.map((entry) => this.resolveAftershock(entry, targets));
  }

  private resolveAftershock(
    entry: PendingAftershock,
    targets: readonly GrenadeTarget[],
  ): AftershockResolution {
    const hits = this.damageWithin(
      entry,
      entry.radius,
      targets,
      entry.damage,
      entry.damageType,
    );

    // 先收集本次余震命中的带标记者，再逐个引爆；引爆不消耗其他标记。
    const markedSources = hits
      .map((hit) => targets.find((target) => target.id === hit.targetId) ?? null)
      .filter((target): target is GrenadeTarget => target !== null && this.marks.has(target.id));

    const explosions: AfterimageExplosion[] = [];
    for (const source of markedSources) {
      this.marks.delete(source.id);
      const explosionHits = this.damageWithin(
        source,
        this.afterimage.radius,
        targets,
        this.afterimage.damage,
        this.afterimage.damageType,
      );
      for (const hit of explosionHits) {
        this.stunUntil.set(
          hit.targetId,
          Math.max(this.stunUntil.get(hit.targetId) ?? 0, this.elapsed + this.afterimage.stunSeconds),
        );
      }
      // W02 在爆炸结算后扩散标记；新标记不进入本次 markedSources，因此不会连锁引爆。
      const spreadTargetIds = this.spreadMarks(source, targets);
      explosions.push({
        sourceTargetId: source.id,
        x: source.x,
        y: source.y,
        radius: this.afterimage.radius,
        stunSeconds: this.afterimage.stunSeconds,
        hits: explosionHits,
        spreadTargetIds,
      });
    }

    return {
      x: entry.x,
      y: entry.y,
      radius: entry.radius,
      hits,
      explosions,
    };
  }

  /**
   * W02：给爆心周围最多 N 个未标记、仍存活且通视的敌人附着残影。
   * 排除引爆源自身，避免自己的爆炸反复把自己重新标记；等距按目标 ID 稳定排序。
   */
  private spreadMarks(source: GrenadeTarget, targets: readonly GrenadeTarget[]): string[] {
    if (this.markSpreadTargets <= 0) return [];

    const maxDistanceSquared = this.afterimage.radius * this.afterimage.radius;
    const candidates: Array<{ readonly target: GrenadeTarget; readonly distance: number }> = [];
    for (const target of targets) {
      if (!target.isAlive) continue;
      if (target.id === source.id) continue;
      if (this.marks.has(target.id)) continue;
      const distance = distanceSquared(source, target);
      if (distance > maxDistanceSquared) continue;
      if (this.lineOfSight && !this.lineOfSight(source, target)) continue;
      candidates.push({ target, distance });
    }

    candidates.sort((left, right) =>
      left.distance !== right.distance
        ? left.distance - right.distance
        : left.target.id < right.target.id
          ? -1
          : left.target.id > right.target.id
            ? 1
            : 0,
    );

    const spread = candidates.slice(0, this.markSpreadTargets);
    for (const { target } of spread) this.marks.add(target.id);
    return spread.map(({ target }) => target.id);
  }

  /** 对半径内仍存活且与爆心通视的目标逐一结算伤害；边界包含，按传入顺序返回。 */
  private damageWithin(
    center: { readonly x: number; readonly y: number },
    radius: number,
    targets: readonly GrenadeTarget[],
    rawDamage: number,
    damageType: DamageType,
  ): ExplosionHit[] {
    const maxDistanceSquared = radius * radius;
    const hits: ExplosionHit[] = [];
    for (const target of targets) {
      if (!target.isAlive) continue;
      if (distanceSquared(center, target) > maxDistanceSquared) continue;
      if (this.lineOfSight && !this.lineOfSight(center, target)) continue;
      hits.push({
        targetId: target.id,
        damage: target.applyDamage(rawDamage * this.damageMultiplier, damageType),
      });
    }
    return hits;
  }
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
