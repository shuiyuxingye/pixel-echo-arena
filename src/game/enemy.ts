/**
 * 普通敌人行为（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/game-design.md` §7：
 * - 追击者 60 HP、接触 8 物伤；
 * - 射手 45 HP、每 1.6 秒发射 10 物伤弹；
 * - 冲锋者 80 HP、预警 0.7 秒后直线冲锋，命中 18 物伤；
 * - 重装者 160 HP、护甲 40、缓慢近战 14 物伤；
 * - 出生点距玩家至少 220，提前 0.8 秒红圈提示，不生成在墙中；
 * - 近战敌人受障碍阻挡，直射弹体命中障碍销毁；
 * - 所有敌人接触伤害共享 0.5 秒受击间隔，弹体命中无敌期无伤。
 *
 * 数值来自 `src/game/data/enemies.ts`；文档未给出的移动/射程参数集中在本文件，
 * 只用于让行为可玩，不改变伤害与生命基线。
 */
import {
  hasLineOfSight,
  isCircleBlocked,
  moveCircleWithCollision,
  type ArenaLayout,
} from './arena';
import {
  BOSS_CHARGE_DAMAGE,
  BOSS_CHARGE_DAMAGE_TYPE,
  BOSS_CHARGE_SPEED,
  BOSS_RADIUS,
  BossCombat,
  type BossExplosion,
  type BossStepResult,
  type BossSummonEvent,
} from './boss';
import { Combatant, distanceSquared, type DamageResult } from './combat';
import type { DamageType, EnemyBehavior, EnemyDefinition } from './data';
import type { EnemySystemWorldSnapshot } from './world-snapshot';

/** 默认圆形碰撞半径（逻辑像素）。 */
export const ENEMY_RADIUS = 14;

/** 出生约束：距玩家至少 220，最远 520；提前 0.8 秒提示。 */
export const SPAWN_MIN_DISTANCE = 220;
export const SPAWN_MAX_DISTANCE = 520;
export const SPAWN_TELEGRAPH_SECONDS = 0.8;

/** 敌人接触伤害共享的受击间隔。 */
export const CONTACT_HIT_INTERVAL_SECONDS = 0.5;

/** 各行为的移动速度（逻辑像素/秒），仅用于手感调校。 */
export const ENEMY_MOVE_SPEED: Readonly<Record<EnemyBehavior, number>> = {
  chase: 100,
  shoot: 65,
  charge: 82,
  heavy: 48,
  boss: 0,
};

/** 射手：保持距离、开火射程与弹速。 */
export const SHOOTER_STANDOFF_DISTANCE = 230;
export const SHOOTER_FIRE_RANGE = 380;
export const SHOOTER_PROJECTILE_SPEED = 300;
export const SHOOTER_PROJECTILE_RADIUS = 6;
export const SHOOTER_PROJECTILE_RANGE = 440;

/** 冲锋者：触发距离、冲刺速度/时长与再次触发冷却。 */
export const CHARGER_TRIGGER_RANGE = 260;
export const CHARGE_DASH_SPEED = 320;
export const CHARGE_DASH_SECONDS = 0.35;
export const CHARGE_COOLDOWN_SECONDS = 1.6;

/** 绕掩体时沿切向行走的持续时间与侧向选择。 */
const AVOID_SECONDS = 0.6;

const TIME_EPSILON = 1e-9;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface EnemyPoint {
  readonly x: number;
  readonly y: number;
}

/** 玩家作为敌人攻击目标时所需的最小信息。 */
export interface EnemyPlayerTarget extends EnemyPoint {
  readonly radius: number;
  readonly isInvulnerable: boolean;
}

/**
 * 可被近战敌人攻击的召唤物（缪尔赛思主流形）。
 * 只有距离比玩家更近时才会成为追击/重装敌人的目标。
 */
export interface EnemySummonTarget extends EnemyPoint {
  readonly radius: number;
  readonly isAlive: boolean;
}

export interface EnemySpawnTelegraph extends EnemyPoint {
  readonly id: string;
  readonly enemy: EnemyDefinition;
  remainingSeconds: number;
}

export type EnemyActivity = 'idle' | 'windup' | 'dash';

/** 场上的一个存活敌人实例。 */
export interface EnemyUnit {
  readonly id: string;
  readonly enemy: EnemyDefinition;
  readonly combatant: Combatant;
  readonly radius: number;
  activity: EnemyActivity;
  windupRemaining: number;
  dashRemaining: number;
  dashX: number;
  dashY: number;
  attackCooldown: number;
  chargeCooldown: number;
  avoidSeconds: number;
  avoidSign: 1 | -1;
}

export interface EnemyProjectileState {
  readonly id: number;
  readonly ownerId: string;
  readonly damage: number;
  readonly damageType: DamageType;
  readonly radius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  remainingRange: number;
}

export type EnemyProjectileStatus = 'active' | 'blocked' | 'expired';

export interface EnemyContactHit {
  readonly enemyId: string;
  readonly damage: DamageResult;
}

export interface EnemySummonHit {
  readonly enemyId: string;
  readonly damage: DamageResult;
}

export interface EnemyProjectileHit {
  readonly projectileId: number;
  /** 命中无敌期时为 null。 */
  readonly damage: DamageResult | null;
}

/** Boss 地面延迟爆破的结算结果；预警期间不造成伤害。 */
export interface EnemyBossBlastHit {
  readonly blastId: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** 玩家不在范围内、被墙体遮挡或处于无敌期时为 null。 */
  readonly damage: DamageResult | null;
}

/** 玩家本次胜利清理时移除的普通敌人、敌弹与出生提示。 */
export interface EnemyVictoryClear {
  readonly enemyIds: readonly string[];
  readonly projectileIds: readonly number[];
  readonly telegraphIds: readonly string[];
}

export interface EnemyStepContext {
  readonly player: EnemyPlayerTarget;
  readonly applyPlayerDamage: (rawDamage: number, damageType: DamageType) => DamageResult;
  /** 眩晕中的敌人不移动、不攻击、不造成接触伤害。 */
  readonly isStunned?: (enemyId: string) => boolean;
  /** 束缚中的敌人不移动，但射手仍可开火；冲锋者不会进入或推进冲刺。 */
  readonly isRooted?: (enemyId: string) => boolean;
  /** 减速倍率，例如魂灵减速返回 0.8。 */
  readonly speedMultiplier?: (enemyId: string) => number;
  /** 距离更近时会替代玩家成为近战敌人的目标（缪尔赛思主流形）。 */
  readonly summon?: EnemySummonTarget | null;
  /** 召唤物承受接触伤害的入口；没有召唤物时不调用。 */
  readonly applySummonDamage?: (rawDamage: number, damageType: DamageType) => DamageResult;
}

export interface EnemyStepResult {
  readonly spawned: readonly EnemyUnit[];
  readonly contactHits: readonly EnemyContactHit[];
  readonly summonHits: readonly EnemySummonHit[];
  readonly projectileHits: readonly EnemyProjectileHit[];
  readonly blockedProjectileIds: readonly number[];
  readonly expiredProjectileIds: readonly number[];
  readonly bossBlastHits: readonly EnemyBossBlastHit[];
  readonly bossSummonRequests: readonly BossSummonEvent[];
}

/**
 * 在距玩家至少 220 的合法空位中选择出生点。
 * `angleOffset` 让同一批敌人分散到不同方位；结果确定可复现。
 */
export function resolveEnemySpawnPoint(
  layout: ArenaLayout,
  player: EnemyPoint,
  angleOffset = 0,
  radius = ENEMY_RADIUS,
): EnemyPoint {
  for (let distance = SPAWN_MIN_DISTANCE; distance <= SPAWN_MAX_DISTANCE; distance += 40) {
    for (let index = 0; index < 12; index += 1) {
      const angle = angleOffset * GOLDEN_ANGLE + (index * Math.PI * 2) / 12;
      const x = player.x + Math.cos(angle) * distance;
      const y = player.y + Math.sin(angle) * distance;
      if (!isCircleBlocked(layout, x, y, radius)) return { x, y };
    }
  }
  throw new Error('无法找到满足 220 最小距离的敌人出生点');
}

/** 推进一枚直线敌弹；命中墙/掩体返回 blocked，飞满射程返回 expired。 */
export function stepEnemyProjectile(
  projectile: EnemyProjectileState,
  stepSeconds: number,
  layout: ArenaLayout,
): EnemyProjectileStatus {
  const speed = Math.hypot(projectile.vx, projectile.vy);
  if (speed === 0 || !(stepSeconds > 0) || !Number.isFinite(stepSeconds)) {
    return 'active';
  }

  const totalDistance = speed * stepSeconds;
  const substeps = Math.max(1, Math.ceil(totalDistance / 4));
  const unitX = projectile.vx / speed;
  const unitY = projectile.vy / speed;
  const substepDistance = totalDistance / substeps;

  for (let step = 0; step < substeps; step += 1) {
    projectile.x += unitX * substepDistance;
    projectile.y += unitY * substepDistance;
    projectile.remainingRange -= substepDistance;

    if (isCircleBlocked(layout, projectile.x, projectile.y, projectile.radius)) {
      return 'blocked';
    }
    if (projectile.remainingRange <= 0) {
      return 'expired';
    }
  }

  return 'active';
}

function decay(value: number, seconds: number): number {
  const next = value - seconds;
  return next <= TIME_EPSILON ? 0 : next;
}

function unitDirection(from: EnemyPoint, to: EnemyPoint): { x: number; y: number; distance: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { x: 0, y: 0, distance: 0 };
  return { x: dx / distance, y: dy / distance, distance };
}

/**
 * 敌人系统：管理出生提示、四种行为、接触伤害与敌弹。
 * 场景每个固定逻辑步调用一次 `step`，渲染帧率不影响任何计时。
 */
export class EnemySystem {
  private readonly layout: ArenaLayout;
  private readonly radius: number;
  private readonly units: EnemyUnit[] = [];
  private readonly spawnQueue: EnemySpawnTelegraph[] = [];
  private readonly projectileList: EnemyProjectileState[] = [];
  private bossCombat: BossCombat | null = null;
  private bossUnit: EnemyUnit | null = null;
  private contactCooldown = 0;
  private nextUnitId = 1;
  private nextTelegraphId = 1;
  private nextProjectileId = 1;
  private elapsed = 0;

  constructor(options: { readonly layout: ArenaLayout; readonly radius?: number }) {
    this.layout = options.layout;
    this.radius = options.radius ?? ENEMY_RADIUS;
  }

  get enemies(): readonly EnemyUnit[] {
    return this.units;
  }

  get telegraphs(): readonly EnemySpawnTelegraph[] {
    return this.spawnQueue;
  }

  get projectiles(): readonly EnemyProjectileState[] {
    return this.projectileList;
  }

  get elapsedSeconds(): number {
    return this.elapsed;
  }

  /** Boss 行为控制器；场上没有 Boss 时为 null。 */
  get boss(): BossCombat | null {
    return this.bossCombat;
  }

  /** 按敌人类型派生碰撞半径：Boss 更大，普通敌人沿用系统半径。 */
  private radiusFor(enemy: EnemyDefinition): number {
    return enemy.behavior === 'boss' ? BOSS_RADIUS : this.radius;
  }

  /** 排入一个 0.8 秒红圈提示的出生；返回可渲染的提示快照。 */
  queueSpawn(
    enemy: EnemyDefinition,
    player: EnemyPoint,
    angleOffset = 0,
  ): EnemySpawnTelegraph {
    const point = resolveEnemySpawnPoint(
      this.layout,
      player,
      angleOffset,
      this.radiusFor(enemy),
    );
    const telegraph: EnemySpawnTelegraph = {
      id: `telegraph-${this.nextTelegraphId}`,
      enemy,
      x: point.x,
      y: point.y,
      remainingSeconds: SPAWN_TELEGRAPH_SECONDS,
    };
    this.nextTelegraphId += 1;
    this.spawnQueue.push(telegraph);
    return telegraph;
  }

  /** 绕过提示直接放置敌人（测试与调试用）。 */
  addEnemy(enemy: EnemyDefinition, x: number, y: number): EnemyUnit {
    return this.createUnit(enemy, x, y);
  }

  /**
   * 绕过射手 AI 与攻击冷却直接放置一枚敌弹（测试与隔离性能场景用）。
   * 仍走正常的弹体移动、撞墙与命中结算。
   */
  addDebugProjectile(
    x: number,
    y: number,
    vx: number,
    vy: number,
    options: {
      readonly damage?: number;
      readonly damageType?: DamageType;
      readonly radius?: number;
      readonly range?: number;
    } = {},
  ): EnemyProjectileState {
    const projectile: EnemyProjectileState = {
      id: this.nextProjectileId,
      ownerId: 'debug',
      damage: options.damage ?? 1,
      damageType: options.damageType ?? 'physical',
      radius: options.radius ?? SHOOTER_PROJECTILE_RADIUS,
      x,
      y,
      vx,
      vy,
      remainingRange: options.range ?? SHOOTER_PROJECTILE_RANGE,
    };
    this.nextProjectileId += 1;
    this.projectileList.push(projectile);
    return projectile;
  }

  /**
   * 调试/隔离性能场景：把敌弹裁剪到上限，优先移除最早生成的弹体。
   * 正常战斗不使用；返回实际移除数量。
   */
  trimProjectiles(max: number): number {
    const limit = Math.max(0, Math.floor(max));
    if (this.projectileList.length <= limit) return 0;
    return this.projectileList.splice(0, this.projectileList.length - limit).length;
  }

  /**
   * 波中快照：存活敌人、出生提示、敌弹、Boss 控制器与各类计数器。
   * 已死亡单位不再保存，避免恢复后复活。
   */
  snapshotWorld(): EnemySystemWorldSnapshot {
    return {
      elapsedSeconds: this.elapsed,
      contactCooldownSeconds: this.contactCooldown,
      nextUnitId: this.nextUnitId,
      nextTelegraphId: this.nextTelegraphId,
      nextProjectileId: this.nextProjectileId,
      units: this.units
        .filter((unit) => unit.combatant.isAlive)
        .map((unit) => ({
          id: unit.id,
          enemy: unit.enemy,
          x: unit.combatant.x,
          y: unit.combatant.y,
          health: unit.combatant.health.health,
          shield: unit.combatant.health.shield,
          activity: unit.activity,
          windupRemaining: unit.windupRemaining,
          dashRemaining: unit.dashRemaining,
          dashX: unit.dashX,
          dashY: unit.dashY,
          attackCooldown: unit.attackCooldown,
          chargeCooldown: unit.chargeCooldown,
          avoidSeconds: unit.avoidSeconds,
          avoidSign: unit.avoidSign,
        })),
      telegraphs: this.spawnQueue.map((telegraph) => ({
        id: telegraph.id,
        enemy: telegraph.enemy,
        x: telegraph.x,
        y: telegraph.y,
        remainingSeconds: telegraph.remainingSeconds,
      })),
      projectiles: this.projectileList.map((projectile) => ({ ...projectile })),
      boss: this.bossCombat?.snapshotWorld() ?? null,
    };
  }

  /**
   * 从波中快照恢复：重建存活单位、提示、敌弹与 Boss 状态。
   * 只接受已校验数据；非法数值按 0 处理，不抛异常中断本局。
   */
  restoreWorld(state: EnemySystemWorldSnapshot): void {
    this.elapsed = nonNegative(state.elapsedSeconds);
    this.contactCooldown = nonNegative(state.contactCooldownSeconds);
    this.units.length = 0;
    this.spawnQueue.length = 0;
    this.projectileList.length = 0;
    this.bossCombat = null;
    this.bossUnit = null;

    let maxUnitId = 0;
    for (const saved of state.units) {
      const radius = this.radiusFor(saved.enemy);
      const unit: EnemyUnit = {
        id: saved.id,
        enemy: saved.enemy,
        combatant: new Combatant({
          id: saved.id,
          x: saved.x,
          y: saved.y,
          radius,
          maxHealth: saved.enemy.maxHealth,
          armor: saved.enemy.armor,
          magicResist: saved.enemy.magicResist,
        }),
        radius,
        activity: saved.activity,
        windupRemaining: nonNegative(saved.windupRemaining),
        dashRemaining: nonNegative(saved.dashRemaining),
        dashX: Number.isFinite(saved.dashX) ? saved.dashX : 0,
        dashY: Number.isFinite(saved.dashY) ? saved.dashY : 0,
        attackCooldown: nonNegative(saved.attackCooldown),
        chargeCooldown: nonNegative(saved.chargeCooldown),
        avoidSeconds: nonNegative(saved.avoidSeconds),
        avoidSign: saved.avoidSign === -1 ? -1 : 1,
      };
      unit.combatant.health.restoreHealth(saved.health, saved.enemy.maxHealth);
      unit.combatant.health.setShield(saved.shield);
      this.units.push(unit);
      if (saved.enemy.behavior === 'boss') {
        this.bossCombat = new BossCombat();
        this.bossUnit = unit;
      }
      const idNumber = Number.parseInt(saved.id.replace(/^enemy-/, ''), 10);
      if (Number.isFinite(idNumber)) maxUnitId = Math.max(maxUnitId, idNumber);
    }

    for (const saved of state.telegraphs) {
      this.spawnQueue.push({
        id: saved.id,
        enemy: saved.enemy,
        x: saved.x,
        y: saved.y,
        remainingSeconds: nonNegative(saved.remainingSeconds),
      });
    }

    for (const saved of state.projectiles) {
      this.projectileList.push({ ...saved });
    }

    if (this.bossCombat && state.boss) {
      this.bossCombat.restoreWorld(state.boss);
    }

    this.nextUnitId = Math.max(1, state.nextUnitId, maxUnitId + 1);
    this.nextTelegraphId = Math.max(1, state.nextTelegraphId);
    this.nextProjectileId = Math.max(1, state.nextProjectileId);
  }

  /** 将指定存活敌人沿远离 `origin` 的方向位移，受墙/掩体阻挡。
   * 盾击等击退复用 arena 的圆形碰撞原语；返回实际位移距离。
   */
  knockback(enemyId: string, origin: EnemyPoint, distance: number): number {
    return this.displace(enemyId, origin, distance, false);
  }

  /**
   * 将指定存活敌人沿朝向 `origin` 的方向拉近，受墙/掩体阻挡。
   * Boss 免疫强制位移，返回 0；返回实际位移距离。
   */
  pullToward(enemyId: string, origin: EnemyPoint, distance: number): number {
    return this.displace(enemyId, origin, distance, true);
  }

  private displace(
    enemyId: string,
    origin: EnemyPoint,
    distance: number,
    toward: boolean,
  ): number {
    if (!(distance > 0) || !Number.isFinite(distance)) return 0;
    const unit = this.units.find((entry) => entry.id === enemyId && entry.combatant.isAlive);
    if (!unit) return 0;
    // Boss 免疫强制位移（docs/game-design.md §5 通用约定）。
    if (unit.enemy.id === 'boss') return 0;

    const dx = toward ? origin.x - unit.combatant.x : unit.combatant.x - origin.x;
    const dy = toward ? origin.y - unit.combatant.y : unit.combatant.y - origin.y;
    const length = Math.hypot(dx, dy);
    if (length < TIME_EPSILON) return 0;

    const moved = moveCircleWithCollision(
      this.layout,
      unit.combatant.x,
      unit.combatant.y,
      unit.radius,
      (dx / length) * distance,
      (dy / length) * distance,
    );
    const actual = Math.hypot(moved.x - unit.combatant.x, moved.y - unit.combatant.y);
    unit.combatant.x = moved.x;
    unit.combatant.y = moved.y;
    return actual;
  }

  /** 推进一个逻辑步。 */
  step(stepSeconds: number, context: EnemyStepContext): EnemyStepResult {
    const spawned: EnemyUnit[] = [];
    const contactHits: EnemyContactHit[] = [];
    const summonHits: EnemySummonHit[] = [];
    const projectileHits: EnemyProjectileHit[] = [];
    const blockedProjectileIds: number[] = [];
    const expiredProjectileIds: number[] = [];
    const bossBlastHits: EnemyBossBlastHit[] = [];
    const bossSummonRequests: BossSummonEvent[] = [];

    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) {
      return {
        spawned,
        contactHits,
        summonHits,
        projectileHits,
        blockedProjectileIds,
        expiredProjectileIds,
        bossBlastHits,
        bossSummonRequests,
      };
    }

    this.elapsed += stepSeconds;
    this.contactCooldown = decay(this.contactCooldown, stepSeconds);

    // 出生提示倒计时结束才真正放下敌人。
    const pending: EnemySpawnTelegraph[] = [];
    for (const telegraph of this.spawnQueue) {
      telegraph.remainingSeconds = decay(telegraph.remainingSeconds, stepSeconds);
      if (telegraph.remainingSeconds <= TIME_EPSILON) {
        spawned.push(this.createUnit(telegraph.enemy, telegraph.x, telegraph.y));
      } else {
        pending.push(telegraph);
      }
    }
    this.spawnQueue.length = 0;
    this.spawnQueue.push(...pending);

    // Boss 的攻击节奏、阶段与召唤都在纯逻辑层推进；场景只消费事件。
    const bossResult = this.stepBoss(stepSeconds, context);
    if (bossResult) {
      const ownerId = this.bossUnit?.id ?? 'boss';
      for (const volley of bossResult.fanVolleys) {
        for (const shot of volley.shots) {
          this.addEnemyProjectile(
            ownerId,
            volley.origin.x,
            volley.origin.y,
            Math.cos(shot.angle) * shot.speed,
            Math.sin(shot.angle) * shot.speed,
            shot.damage,
            shot.damageType,
            shot.radius,
            shot.range,
          );
        }
      }
      for (const explosion of bossResult.explosions) {
        bossBlastHits.push(this.resolveBossBlast(explosion, context));
      }
      bossSummonRequests.push(...bossResult.summons);
    }

    for (const unit of this.units) {
      if (!unit.combatant.isAlive) continue;
      if (context.isStunned?.(unit.id)) continue;
      const rooted = context.isRooted?.(unit.id) ?? false;
      this.stepUnit(unit, stepSeconds, context, rooted);
    }

    const survivors: EnemyProjectileState[] = [];
    for (const projectile of this.projectileList) {
      const status = stepEnemyProjectile(projectile, stepSeconds, this.layout);
      if (this.projectileHitsPlayer(projectile, context.player)) {
        let damage: DamageResult | null = null;
        if (!context.player.isInvulnerable) {
          damage = context.applyPlayerDamage(projectile.damage, projectile.damageType);
        }
        projectileHits.push({ projectileId: projectile.id, damage });
        continue;
      }
      if (status === 'blocked') {
        blockedProjectileIds.push(projectile.id);
        continue;
      }
      if (status === 'expired') {
        expiredProjectileIds.push(projectile.id);
        continue;
      }
      survivors.push(projectile);
    }
    this.projectileList.length = 0;
    this.projectileList.push(...survivors);

    this.resolveContactDamage(context, contactHits, summonHits);

    return {
      spawned,
      contactHits,
      summonHits,
      projectileHits,
      blockedProjectileIds,
      expiredProjectileIds,
      bossBlastHits,
      bossSummonRequests,
    };
  }

  /**
   * 推进 Boss 控制器并把冲刺位移写回单位。
   * Boss 被眩晕/束缚时整步冻结，与其他敌人的控制语义一致。
   */
  private stepBoss(
    stepSeconds: number,
    context: EnemyStepContext,
  ): BossStepResult | null {
    const boss = this.bossCombat;
    const unit = this.bossUnit;
    if (!boss || !unit?.combatant.isAlive) return null;
    if (context.isStunned?.(unit.id) || context.isRooted?.(unit.id)) return null;

    const result = boss.step(stepSeconds, {
      boss: {
        x: unit.combatant.x,
        y: unit.combatant.y,
        health: unit.combatant.health.health,
        maxHealth: unit.combatant.health.maxHealth,
      },
      player: { x: context.player.x, y: context.player.y },
    });

    if (result.dashVector) {
      const multiplier = Math.max(0, context.speedMultiplier?.(unit.id) ?? 1);
      const distance = BOSS_CHARGE_SPEED * multiplier * stepSeconds;
      const moved = moveCircleWithCollision(
        this.layout,
        unit.combatant.x,
        unit.combatant.y,
        unit.radius,
        result.dashVector.x * distance,
        result.dashVector.y * distance,
      );
      unit.combatant.x = moved.x;
      unit.combatant.y = moved.y;
    }

    unit.activity = boss.activity;
    unit.windupRemaining = boss.windupRemaining;
    unit.dashRemaining = boss.dashRemaining;
    return result;
  }

  /** 爆破落地结算：范围内且未被墙体遮挡才造成伤害；无敌期无伤。 */
  private resolveBossBlast(
    explosion: BossExplosion,
    context: EnemyStepContext,
  ): EnemyBossBlastHit {
    const radius = explosion.radius + context.player.radius;
    const within = distanceSquared(explosion, context.player) <= radius * radius;
    const visible = hasLineOfSight(this.layout, explosion, context.player);
    let damage: DamageResult | null = null;
    if (within && visible && !context.player.isInvulnerable) {
      damage = context.applyPlayerDamage(explosion.damage, explosion.damageType);
    }
    return {
      blastId: explosion.id,
      x: explosion.x,
      y: explosion.y,
      radius: explosion.radius,
      damage,
    };
  }

  private addEnemyProjectile(
    ownerId: string,
    x: number,
    y: number,
    vx: number,
    vy: number,
    damage: number,
    damageType: DamageType,
    radius: number,
    range: number,
  ): void {
    this.projectileList.push({
      id: this.nextProjectileId,
      ownerId,
      damage,
      damageType,
      radius,
      x,
      y,
      vx,
      vy,
      remainingRange: range,
    });
    this.nextProjectileId += 1;
  }

  private createUnit(enemy: EnemyDefinition, x: number, y: number): EnemyUnit {
    const radius = this.radiusFor(enemy);
    const unit: EnemyUnit = {
      id: `enemy-${this.nextUnitId}`,
      enemy,
      combatant: new Combatant({
        id: `enemy-${this.nextUnitId}`,
        x,
        y,
        radius,
        maxHealth: enemy.maxHealth,
        armor: enemy.armor,
        magicResist: enemy.magicResist,
      }),
      radius,
      activity: 'idle',
      windupRemaining: 0,
      dashRemaining: 0,
      dashX: 0,
      dashY: 0,
      attackCooldown: enemy.attack?.intervalSeconds ?? 0,
      chargeCooldown: 0,
      avoidSeconds: 0,
      avoidSign: this.nextUnitId % 2 === 0 ? 1 : -1,
    };
    this.nextUnitId += 1;
    this.units.push(unit);
    if (enemy.behavior === 'boss') {
      this.bossCombat = new BossCombat();
      this.bossUnit = unit;
    }
    return unit;
  }

  private stepUnit(
    unit: EnemyUnit,
    stepSeconds: number,
    context: EnemyStepContext,
    rooted: boolean,
  ): void {
    switch (unit.enemy.behavior) {
      case 'chase':
        if (rooted) break;
        this.moveToward(
          unit,
          this.meleeTarget(unit, context).point,
          stepSeconds,
          ENEMY_MOVE_SPEED.chase,
          context,
        );
        break;
      case 'heavy':
        if (rooted) break;
        this.moveToward(
          unit,
          this.meleeTarget(unit, context).point,
          stepSeconds,
          ENEMY_MOVE_SPEED.heavy,
          context,
        );
        break;
      case 'shoot':
        this.stepShooter(unit, stepSeconds, context, rooted);
        break;
      case 'charge':
        // 束缚期间冻结预警/冲刺进度，也不会开始新的冲锋。
        if (rooted) break;
        this.stepCharger(unit, stepSeconds, context);
        break;
      case 'boss':
        break;
    }
  }

  /** 射手：维持 230 距离并在 1.6 秒间隔发射直线弹；被掩体挡住时先绕行。 */
  private stepShooter(
    unit: EnemyUnit,
    stepSeconds: number,
    context: EnemyStepContext,
    rooted: boolean,
  ): void {
    const attack = unit.enemy.attack;
    if (!attack) return;

    const direction = unitDirection(unit.combatant, context.player);
    const visible = hasLineOfSight(this.layout, unit.combatant, context.player);

    if (!rooted) {
      if (direction.distance < SHOOTER_FIRE_RANGE && visible) {
        if (direction.distance > SHOOTER_STANDOFF_DISTANCE) {
          this.moveToward(unit, context.player, stepSeconds, ENEMY_MOVE_SPEED.shoot, context);
        } else if (direction.distance < SHOOTER_STANDOFF_DISTANCE * 0.65) {
          this.moveAway(unit, context.player, stepSeconds, ENEMY_MOVE_SPEED.shoot, context);
        }
      } else {
        this.moveToward(unit, context.player, stepSeconds, ENEMY_MOVE_SPEED.shoot, context);
      }
    }

    unit.attackCooldown = decay(unit.attackCooldown, stepSeconds);
    if (unit.attackCooldown > 0) return;
    if (!visible || direction.distance > SHOOTER_FIRE_RANGE) return;

    const aim = unitDirection(unit.combatant, context.player);
    this.fireProjectile(unit, aim.x, aim.y, attack.damage, attack.damageType);
    unit.attackCooldown = attack.intervalSeconds ?? 1.6;
  }

  /** 冲锋者：0.7 秒预警后锁定方向直线冲刺 0.35 秒，命中造成 18 物伤。 */
  private stepCharger(
    unit: EnemyUnit,
    stepSeconds: number,
    context: EnemyStepContext,
  ): void {
    const attack = unit.enemy.attack;
    const windupSeconds = attack?.windupSeconds ?? 0.7;

    if (unit.activity === 'dash') {
      const moved = moveCircleWithCollision(
        this.layout,
        unit.combatant.x,
        unit.combatant.y,
        unit.radius,
        unit.dashX * CHARGE_DASH_SPEED * stepSeconds,
        unit.dashY * CHARGE_DASH_SPEED * stepSeconds,
      );
      unit.combatant.x = moved.x;
      unit.combatant.y = moved.y;
      unit.dashRemaining = decay(unit.dashRemaining, stepSeconds);
      if (unit.dashRemaining <= TIME_EPSILON) unit.activity = 'idle';
      return;
    }

    if (unit.activity === 'windup') {
      unit.windupRemaining = decay(unit.windupRemaining, stepSeconds);
      if (unit.windupRemaining <= TIME_EPSILON) {
        const aim = unitDirection(unit.combatant, context.player);
        unit.activity = 'dash';
        unit.dashX = aim.x;
        unit.dashY = aim.y;
        unit.dashRemaining = CHARGE_DASH_SECONDS;
        unit.chargeCooldown = CHARGE_COOLDOWN_SECONDS;
      }
      return;
    }

    unit.chargeCooldown = decay(unit.chargeCooldown, stepSeconds);
    const direction = unitDirection(unit.combatant, context.player);
    if (
      unit.chargeCooldown <= 0 &&
      direction.distance <= CHARGER_TRIGGER_RANGE &&
      hasLineOfSight(this.layout, unit.combatant, context.player)
    ) {
      unit.activity = 'windup';
      unit.windupRemaining = windupSeconds;
      return;
    }

    this.moveToward(unit, context.player, stepSeconds, ENEMY_MOVE_SPEED.charge, context);
  }

  /**
   * 追击/重装敌人的近战目标：召唤物存活且比玩家更近时改为攻击召唤物。
   * 射手与冲锋者仍以玩家为目标，保持既有远程/冲刺行为。
   */
  private meleeTarget(
    unit: EnemyUnit,
    context: EnemyStepContext,
  ): { readonly point: EnemyPoint; readonly kind: 'player' | 'summon'; readonly radius: number } {
    const summon = context.summon;
    if (summon?.isAlive) {
      const summonDistance = distanceSquared(unit.combatant, summon);
      const playerDistance = distanceSquared(unit.combatant, context.player);
      if (summonDistance < playerDistance) {
        return { point: summon, kind: 'summon', radius: summon.radius };
      }
    }
    return { point: context.player, kind: 'player', radius: context.player.radius };
  }

  /**
   * 朝目标移动；被掩体遮断视线时沿切向绕行，避免长期卡在掩体后。
   */
  private moveToward(
    unit: EnemyUnit,
    target: EnemyPoint,
    stepSeconds: number,
    speed: number,
    context: EnemyStepContext,
  ): void {
    const direction = unitDirection(unit.combatant, target);
    if (direction.distance === 0) return;

    let moveX = direction.x;
    let moveY = direction.y;
    const visible = hasLineOfSight(this.layout, unit.combatant, target);

    if (!visible) {
      if (unit.avoidSeconds <= 0) {
        unit.avoidSign = this.chooseAvoidSign(unit, direction);
        unit.avoidSeconds = AVOID_SECONDS;
      }
      const sideX = -direction.y * unit.avoidSign;
      const sideY = direction.x * unit.avoidSign;
      const blended = unitDirection(
        { x: 0, y: 0 },
        { x: sideX + direction.x * 0.35, y: sideY + direction.y * 0.35 },
      );
      moveX = blended.x;
      moveY = blended.y;
    } else {
      unit.avoidSeconds = 0;
    }

    unit.avoidSeconds = decay(unit.avoidSeconds, stepSeconds);
    const multiplier = context.speedMultiplier?.(unit.id) ?? 1;
    const distance = speed * Math.max(0, multiplier) * stepSeconds;
    const beforeX = unit.combatant.x;
    const beforeY = unit.combatant.y;
    const moved = moveCircleWithCollision(
      this.layout,
      beforeX,
      beforeY,
      unit.radius,
      moveX * distance,
      moveY * distance,
    );
    unit.combatant.x = moved.x;
    unit.combatant.y = moved.y;

    // 完全走不动时换一侧绕行，避免持续顶住掩体角落。
    if (!visible && Math.hypot(moved.x - beforeX, moved.y - beforeY) < distance * 0.25) {
      unit.avoidSign = unit.avoidSign === 1 ? -1 : 1;
      unit.avoidSeconds = AVOID_SECONDS;
    }
  }

  private moveAway(
    unit: EnemyUnit,
    target: EnemyPoint,
    stepSeconds: number,
    speed: number,
    context: EnemyStepContext,
  ): void {
    const direction = unitDirection(unit.combatant, target);
    const multiplier = context.speedMultiplier?.(unit.id) ?? 1;
    const distance = speed * Math.max(0, multiplier) * stepSeconds;
    const moved = moveCircleWithCollision(
      this.layout,
      unit.combatant.x,
      unit.combatant.y,
      unit.radius,
      -direction.x * distance,
      -direction.y * distance,
    );
    unit.combatant.x = moved.x;
    unit.combatant.y = moved.y;
  }

  private chooseAvoidSign(
    unit: EnemyUnit,
    direction: { x: number; y: number },
  ): 1 | -1 {
    for (const sign of [unit.avoidSign, unit.avoidSign === 1 ? -1 : 1] as const) {
      const probeX = unit.combatant.x + -direction.y * sign * this.radius;
      const probeY = unit.combatant.y + direction.x * sign * this.radius;
      if (!isCircleBlocked(this.layout, probeX, probeY, unit.radius)) return sign;
    }
    return unit.avoidSign;
  }

  private fireProjectile(
    unit: EnemyUnit,
    directionX: number,
    directionY: number,
    damage: number,
    damageType: DamageType,
  ): void {
    if (directionX === 0 && directionY === 0) return;
    this.projectileList.push({
      id: this.nextProjectileId,
      ownerId: unit.id,
      damage,
      damageType,
      radius: SHOOTER_PROJECTILE_RADIUS,
      x: unit.combatant.x,
      y: unit.combatant.y,
      vx: directionX * SHOOTER_PROJECTILE_SPEED,
      vy: directionY * SHOOTER_PROJECTILE_SPEED,
      remainingRange: SHOOTER_PROJECTILE_RANGE,
    });
    this.nextProjectileId += 1;
  }

  private projectileHitsPlayer(
    projectile: EnemyProjectileState,
    player: EnemyPlayerTarget,
  ): boolean {
    const radius = projectile.radius + player.radius;
    return distanceSquared(projectile, player) <= radius * radius;
  }

  /**
   * 接触伤害：同一 0.5 秒间隔内所有敌人合计只结算一次；
   * 玩家无敌时既不受伤也不消耗间隔。召唤物作为更近目标时同理单独结算。
   */
  private resolveContactDamage(
    context: EnemyStepContext,
    hits: EnemyContactHit[],
    summonHits: EnemySummonHit[],
  ): void {
    if (this.contactCooldown > 0) return;

    for (const unit of this.units) {
      if (!unit.combatant.isAlive) continue;
      if (context.isStunned?.(unit.id)) continue;

      const contact = this.contactDamage(unit);
      if (!contact) continue;

      // 只有追击/重装会改打更近的召唤物；冲锋仍按冲刺路径攻击玩家。
      const target =
        unit.enemy.behavior === 'chase' || unit.enemy.behavior === 'heavy'
          ? this.meleeTarget(unit, context)
          : { point: context.player, kind: 'player' as const, radius: context.player.radius };
      if (target.kind === 'player' && context.player.isInvulnerable) continue;

      const radius = unit.radius + target.radius;
      if (distanceSquared(unit.combatant, target.point) > radius * radius) continue;

      if (target.kind === 'summon') {
        if (!context.applySummonDamage) continue;
        summonHits.push({
          enemyId: unit.id,
          damage: context.applySummonDamage(contact.damage, contact.damageType),
        });
      } else {
        hits.push({
          enemyId: unit.id,
          damage: context.applyPlayerDamage(contact.damage, contact.damageType),
        });
      }
      this.contactCooldown = CONTACT_HIT_INTERVAL_SECONDS;
      if (unit.activity === 'dash') {
        unit.activity = 'idle';
        unit.dashRemaining = 0;
      }
      return;
    }
  }

  /** 接触伤害来源：冲锋冲撞与 Boss 冲刺取技能伤害，其余取 contactDamage。 */
  private contactDamage(
    unit: EnemyUnit,
  ): { readonly damage: number; readonly damageType: DamageType } | null {
    if (unit.enemy.behavior === 'boss') {
      if (unit.activity !== 'dash') return null;
      return { damage: BOSS_CHARGE_DAMAGE, damageType: BOSS_CHARGE_DAMAGE_TYPE };
    }
    if (unit.enemy.behavior === 'charge') {
      if (unit.activity !== 'dash' || !unit.enemy.attack) return null;
      return {
        damage: unit.enemy.attack.damage,
        damageType: unit.enemy.attack.damageType,
      };
    }
    if (unit.enemy.contactDamage > 0) {
      return { damage: unit.enemy.contactDamage, damageType: 'physical' };
    }
    return null;
  }

  /**
   * Boss 被击败后的清场：移除全部普通敌人、敌弹与未落地的出生提示。
   * Boss 本体保留（已死亡），由场景决定死亡表现。
   */
  clearForVictory(): EnemyVictoryClear {
    const enemyIds: string[] = [];
    for (let index = this.units.length - 1; index >= 0; index -= 1) {
      const unit = this.units[index];
      if (!unit || unit.enemy.behavior === 'boss') continue;
      enemyIds.push(unit.combatant.id);
      this.units.splice(index, 1);
    }

    const projectileIds = this.projectileList.map((projectile) => projectile.id);
    this.projectileList.length = 0;

    const telegraphIds = this.spawnQueue.map((telegraph) => telegraph.id);
    this.spawnQueue.length = 0;

    this.bossCombat?.clearBlasts();
    return { enemyIds, projectileIds, telegraphIds };
  }
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
