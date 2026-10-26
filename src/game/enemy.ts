/**
 * 普通敌人行为（纯逻辑，不依赖 Phaser）。
 *
 * 前四种普通怪（US-011）：
 * - 团团怪 直接追击（接触伤害）；
 * - 镰足虫 高速绕侧，接近后扑向目标（接触伤害）；
 * - 喷菇 停顿 0.7 秒后朝玩家发射孢子弹；
 * - 冲锋猪 0.7 秒蓄力后锁定方向直线冲锋。
 * 后四种普通怪（US-012）：
 * - 盾壳蟹 慢速挡路，朝向缓慢转向玩家，背侧是弱点；
 * - 灯灵 远程射击，每 4 秒治疗周围一名受伤敌人 8% 最大生命，
 *   不治疗其他灯灵与 Boss；
 * - 爆爆兽 蓄力 0.9 秒后自爆，伤害区在蓄力期间先显示，提前击杀可打断；
 * - 巢母 每 8 秒召唤 2 只幼虫，单个巢母终生最多 6 只，幼虫占用同屏 100 上限；
 * - 幼虫沿用追击行为，击杀只给 1 金币/1 经验。
 * 其余通用规则：
 * - 出生点距玩家至少 220，提前 0.8 秒红圈提示，不生成在墙中；
 * - 近战敌人受障碍阻挡，直射弹体命中障碍销毁；
 * - 所有敌人接触伤害共享 0.5 秒受击间隔，弹体命中无敌期无伤；
 * - 同屏敌人上限 100（含召唤物），召唤不能突破该名额。
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
import type { CombatEventSink } from './damage-events';
import {
  BOSS_CHARGE_DAMAGE,
  BOSS_CHARGE_DAMAGE_TYPE,
  BOSS_CHARGE_SPEED,
  BOSS_CONTROL_SLOW_MULTIPLIER,
  BOSS_RADIUS,
  BOSS_SUMMON_MAX_ALIVE,
  BossCombat,
  type BossExplosion,
  type BossStepResult,
  type BossSummonEvent,
} from './boss';
import { Combatant, distanceSquared, type DamageResult } from './combat';
import {
  remainingEnemyCapacity,
  waveDamageMultiplier,
  type DamageType,
  type EnemyBehavior,
  type EnemyDefinition,
  type EnemyId,
} from './data';
import {
  ELITE_ATTACK_WARNING_SECONDS,
  ELITE_BLAST_DAMAGE,
  ELITE_BLAST_FIRST_DELAY_SECONDS,
  ELITE_BLAST_INTERVAL_SECONDS,
  ELITE_BLAST_RADIUS,
} from './elite';
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
  flank: 150,
  spit: 65,
  shoot: 65,
  charge: 82,
  guard: 48,
  mend: 65,
  explode: 95,
  summon: 48,
  heavy: 48,
  boss: 0,
};

/** 镰足虫绕侧：距目标超过该值先走斜向弧线，进入后直线扑近。 */
export const SKITTER_FLANK_DISTANCE = 170;
/** 镰足虫绕侧相对直冲方向的偏移角（弧度），约 60°。 */
export const SKITTER_FLANK_ANGLE = Math.PI / 3;

/** 喷菇攻击前停顿（预警）时长；不得低于普通攻击 0.7 秒下限。 */
export const SPITTER_WINDUP_SECONDS = 0.7;

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

/** 盾壳蟹：转向速度与背侧弱点张角；弱点命中按 1.5 倍增伤。 */
export const BULWARK_TURN_RATE = 2.4;
export const BULWARK_WEAK_ARC = (Math.PI * 2) / 3;
export const BULWARK_WEAK_DAMAGE_MULTIPLIER = 1.5;

/** 灯灵：每 4 秒治疗周围一名受伤敌人最大生命的 8%。 */
export const MENDER_HEAL_INTERVAL_SECONDS = 4;
export const MENDER_HEAL_PERCENT = 0.08;
export const MENDER_HEAL_RANGE = 240;

/** 爆爆兽：触发距离、0.9 秒蓄力与自爆半径。 */
export const BOMBER_TRIGGER_RANGE = 240;
export const BOMBER_WINDUP_SECONDS = 0.9;
export const BOMBER_EXPLOSION_RADIUS = 90;

/** 巢母：每 8 秒召唤 2 只幼虫，单个巢母终生最多 6 只。 */
export const BROODMOTHER_SUMMON_INTERVAL_SECONDS = 8;
export const BROODMOTHER_SUMMON_COUNT = 2;
export const BROODMOTHER_MAX_LARVAE = 6;
export const BROODMOTHER_SUMMON_ID: EnemyId = 'larva';

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
  /** Boss 二阶段增援：不计入金币/经验收益。 */
  readonly summoned?: boolean;
  remainingSeconds: number;
}

export type EnemyActivity = 'idle' | 'windup' | 'dash';

/** 场上的一个存活敌人实例。 */
export interface EnemyUnit {
  readonly id: string;
  readonly enemy: EnemyDefinition;
  readonly combatant: Combatant;
  readonly radius: number;
  /** Boss 二阶段增援：击杀后不提供金币/经验。 */
  readonly summoned: boolean;
  activity: EnemyActivity;
  windupRemaining: number;
  dashRemaining: number;
  dashX: number;
  dashY: number;
  attackCooldown: number;
  chargeCooldown: number;
  /** 下一次精英地面爆破的冷却；非精英为 0。 */
  eliteBlastCooldown: number;
  /** 盾壳蟹朝向（弧度）；弱点在朝向背面。其他敌人不读取。 */
  facingAngle: number;
  /** 灯灵下一次治疗冷却。 */
  healCooldown: number;
  /** 巢母下一次召唤冷却。 */
  summonCooldown: number;
  /** 单个巢母终生已召唤的幼虫数，最多 6。 */
  larvaeSummoned: number;
  avoidSeconds: number;
  avoidSign: 1 | -1;
}

/** 灯灵治疗事件；场景据此画治疗连线与浮字。 */
export interface EnemyHealEvent {
  readonly menderId: string;
  readonly targetId: string;
  /** 实际回复量（不会超过目标缺失生命）。 */
  readonly amount: number;
  readonly healerX: number;
  readonly healerY: number;
  readonly x: number;
  readonly y: number;
}

/** 爆爆兽自爆结果；伤害区在蓄力期间已由场景显示。 */
export interface EnemyBomberExplosion {
  readonly enemyId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** 玩家不在范围内、被遮挡或无敌时为 null。 */
  readonly damage: DamageResult | null;
}

/** 巢母召唤请求；数量已按终生上限截断，全局同屏上限由系统再次截断。 */
export interface EnemyBroodSummonRequest {
  readonly ownerId: string;
  readonly enemyId: EnemyId;
  readonly count: number;
}

/**
 * 击杀是否产生金币/经验收益。
 * Boss 二阶段增援只增加场面压力，击杀后不给任何经济收益。
 */
export function enemyGrantsKillRewards(unit: Pick<EnemyUnit, 'summoned'>): boolean {
  return unit.summoned !== true;
}

/**
 * 击杀是否计入宝箱/战利品资格。
 * 巢母与幼虫属于刷怪来源，不触发宝箱奖励；Boss 二阶段增援同样不计。
 * 该规则供后续宝箱系统消费，避免把召唤物当成正式击杀。
 */
export function enemyGrantsChestReward(
  unit: Pick<EnemyUnit, 'enemy' | 'summoned'>,
): boolean {
  if (unit.summoned === true) return false;
  return unit.enemy.id !== 'broodmother' && unit.enemy.id !== 'larva';
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

/** 精英地面爆破预警；预警圈与落地按同一 `id` 配对。 */
export interface EliteBlast {
  readonly id: number;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly damage: number;
  readonly damageType: DamageType;
  remainingSeconds: number;
}

/** 精英地面爆破落地结果；`blastId` 与对应预警圈相同。 */
export interface EnemyEliteBlastHit {
  readonly blastId: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
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
  readonly eliteBlastHits: readonly EnemyEliteBlastHit[];
  readonly bossSummonRequests: readonly BossSummonEvent[];
  /** 灯灵本步完成的治疗。 */
  readonly healEvents: readonly EnemyHealEvent[];
  /** 爆爆兽本步自爆；提前击杀的单位不会产生该事件。 */
  readonly bomberExplosions: readonly EnemyBomberExplosion[];
  /** 巢母本步发出的幼虫召唤请求（已考虑终生上限与全局同屏名额）。 */
  readonly broodSummonRequests: readonly EnemyBroodSummonRequest[];
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

/** 把角度归一化到 (-π, π]，用于朝向缓转与弱点夹角比较。 */
function normalizeAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value <= -Math.PI) value += Math.PI * 2;
  return value;
}

/** 盾壳蟹的弱点方向（单位：弧度），位于朝向背面。 */
export function bulwarkWeakPointAngle(
  unit: Pick<EnemyUnit, 'facingAngle'>,
): number {
  return normalizeAngle(unit.facingAngle + Math.PI);
}

/**
 * 命中点是否落在盾壳蟹背侧的弱点扇区内。
 * 只有盾壳蟹有弱点；其他敌人恒为 false。
 */
export function isBulwarkWeakPointHit(unit: EnemyUnit, origin: EnemyPoint): boolean {
  if (!unit.combatant.isAlive || unit.enemy.id !== 'bulwark') return false;
  const originAngle = Math.atan2(
    origin.y - unit.combatant.y,
    origin.x - unit.combatant.x,
  );
  const difference = normalizeAngle(originAngle - bulwarkWeakPointAngle(unit));
  return Math.abs(difference) <= BULWARK_WEAK_ARC / 2;
}

/** 单步行为产出的非战斗事件；由 `step` 汇总到结果里。 */
interface EnemyUnitStepEvents {
  readonly heal?: EnemyHealEvent;
  readonly bomberExplosion?: EnemyBomberExplosion;
  readonly summon?: { readonly count: number };
}

/**
 * 敌人系统：管理出生提示、四种行为、接触伤害与敌弹。
 * 场景每个固定逻辑步调用一次 `step`，渲染帧率不影响任何计时。
 */
export class EnemySystem {
  private readonly layout: ArenaLayout;
  private readonly radius: number;
  private readonly events?: CombatEventSink;
  private readonly units: EnemyUnit[] = [];
  private readonly spawnQueue: EnemySpawnTelegraph[] = [];
  private readonly projectileList: EnemyProjectileState[] = [];
  private eliteBlastsList: EliteBlast[] = [];
  private nextEliteBlastId = 1;
  private bossCombat: BossCombat | null = null;
  private bossUnit: EnemyUnit | null = null;
  private contactCooldown = 0;
  private nextUnitId = 1;
  private nextTelegraphId = 1;
  private nextProjectileId = 1;
  private elapsed = 0;

  constructor(options: {
    readonly layout: ArenaLayout;
    readonly radius?: number;
    /** 注入后敌人受到的伤害/治疗都写入统一的来源链事件日志。 */
    readonly events?: CombatEventSink;
  }) {
    this.layout = options.layout;
    this.radius = options.radius ?? ENEMY_RADIUS;
    this.events = options.events;
  }

  get enemies(): readonly EnemyUnit[] {
    return this.units;
  }

  get telegraphs(): readonly EnemySpawnTelegraph[] {
    return this.spawnQueue;
  }

  /** 场上存活 + 待落地的敌人数；全局同屏上限按此计，召唤幼虫同样占用。 */
  get activeEnemyCount(): number {
    let count = this.spawnQueue.length;
    for (const unit of this.units) {
      if (unit.combatant.isAlive) count += 1;
    }
    return count;
  }

  get projectiles(): readonly EnemyProjectileState[] {
    return this.projectileList;
  }

  /** 当前仍处于预警中的精英地面爆破；场景按 id 渲染预警圈。 */
  get eliteBlasts(): readonly EliteBlast[] {
    return this.eliteBlastsList;
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
    options: { readonly summoned?: boolean } = {},
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
      ...(options.summoned === true ? { summoned: true } : {}),
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
          summoned: unit.summoned,
          activity: unit.activity,
          windupRemaining: unit.windupRemaining,
          dashRemaining: unit.dashRemaining,
          dashX: unit.dashX,
          dashY: unit.dashY,
          attackCooldown: unit.attackCooldown,
          chargeCooldown: unit.chargeCooldown,
          eliteBlastCooldown: unit.eliteBlastCooldown,
          facingAngle: unit.facingAngle,
          healCooldown: unit.healCooldown,
          summonCooldown: unit.summonCooldown,
          larvaeSummoned: unit.larvaeSummoned,
          avoidSeconds: unit.avoidSeconds,
          avoidSign: unit.avoidSign,
        })),
      telegraphs: this.spawnQueue.map((telegraph) => ({
        id: telegraph.id,
        enemy: telegraph.enemy,
        x: telegraph.x,
        y: telegraph.y,
        remainingSeconds: telegraph.remainingSeconds,
        ...(telegraph.summoned === true ? { summoned: true } : {}),
      })),
      projectiles: this.projectileList.map((projectile) => ({ ...projectile })),
      eliteBlasts: this.eliteBlastsList.map((blast) => ({ ...blast })),
      nextEliteBlastId: this.nextEliteBlastId,
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
    this.eliteBlastsList = [];
    this.nextEliteBlastId = Number.isInteger(state.nextEliteBlastId)
      ? Math.max(1, state.nextEliteBlastId ?? 1)
      : 1;
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
          events: this.events,
        }),
        radius,
        summoned: saved.summoned === true,
        activity: saved.activity,
        windupRemaining: nonNegative(saved.windupRemaining),
        dashRemaining: nonNegative(saved.dashRemaining),
        dashX: Number.isFinite(saved.dashX) ? saved.dashX : 0,
        dashY: Number.isFinite(saved.dashY) ? saved.dashY : 0,
        attackCooldown: nonNegative(saved.attackCooldown),
        chargeCooldown: nonNegative(saved.chargeCooldown),
        eliteBlastCooldown: nonNegative(saved.eliteBlastCooldown ?? 0),
        facingAngle: Number.isFinite(saved.facingAngle) ? (saved.facingAngle as number) : 0,
        healCooldown: nonNegative(saved.healCooldown ?? MENDER_HEAL_INTERVAL_SECONDS),
        summonCooldown: nonNegative(
          saved.summonCooldown ?? BROODMOTHER_SUMMON_INTERVAL_SECONDS,
        ),
        larvaeSummoned: Number.isInteger(saved.larvaeSummoned)
          ? Math.max(0, saved.larvaeSummoned as number)
          : 0,
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
        ...(saved.summoned === true ? { summoned: true } : {}),
      });
    }

    for (const saved of state.projectiles) {
      this.projectileList.push({ ...saved });
    }

    for (const saved of state.eliteBlasts ?? []) {
      this.eliteBlastsList.push({ ...saved });
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
    const eliteBlastHits: EnemyEliteBlastHit[] = [];
    const bossSummonRequests: BossSummonEvent[] = [];
    const healEvents: EnemyHealEvent[] = [];
    const bomberExplosions: EnemyBomberExplosion[] = [];
    const broodSummonRequests: EnemyBroodSummonRequest[] = [];

    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) {
      return {
        spawned,
        contactHits,
        summonHits,
        projectileHits,
        blockedProjectileIds,
        expiredProjectileIds,
        bossBlastHits,
        eliteBlastHits,
        bossSummonRequests,
        healEvents,
        bomberExplosions,
        broodSummonRequests,
      };
    }

    this.elapsed += stepSeconds;
    this.contactCooldown = decay(this.contactCooldown, stepSeconds);

    // 出生提示倒计时结束才真正放下敌人。
    const pending: EnemySpawnTelegraph[] = [];
    for (const telegraph of this.spawnQueue) {
      telegraph.remainingSeconds = decay(telegraph.remainingSeconds, stepSeconds);
      if (telegraph.remainingSeconds <= TIME_EPSILON) {
        spawned.push(
          this.createUnit(
            telegraph.enemy,
            telegraph.x,
            telegraph.y,
            telegraph.summoned === true,
          ),
        );
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
      // 场内增援超过上限时截断本组请求；已存活与待落地的增援都计入上限，
      // 同时不能突破全局同屏 100（幼虫等召唤物共享同一名额）。
      for (const request of bossResult.summons) {
        const capacity = Math.max(
          0,
          Math.min(
            BOSS_SUMMON_MAX_ALIVE - this.reinforcementCount(),
            remainingEnemyCapacity(this.activeEnemyCount),
          ),
        );
        const count = Math.min(request.count, capacity);
        if (count > 0) bossSummonRequests.push({ ...request, count });
      }
    }

    // 巢母召唤在本步内共享全局名额：先按终生上限生成请求，
    // 再按“存活 + 待落地 + 本步已请求”截断，避免同帧多只巢母突破 100。
    let reservedSummons = 0;
    for (const unit of this.units) {
      if (!unit.combatant.isAlive) continue;
      // Boss 免疫眩晕/束缚，控制由 stepBoss 转换为减速；普通敌人才整步跳过。
      if (this.isControlLocked(unit, context)) continue;
      const rooted = this.isRooted(unit, context);
      const events = this.stepUnit(unit, stepSeconds, context, rooted);
      if (events.heal) healEvents.push(events.heal);
      if (events.bomberExplosion) bomberExplosions.push(events.bomberExplosion);
      if (events.summon && events.summon.count > 0) {
        const capacity = remainingEnemyCapacity(
          this.activeEnemyCount + reservedSummons,
        );
        const count = Math.min(events.summon.count, capacity);
        if (count > 0) {
          broodSummonRequests.push({
            ownerId: unit.id,
            enemyId: BROODMOTHER_SUMMON_ID,
            count,
          });
          unit.larvaeSummoned += count;
          unit.summonCooldown = BROODMOTHER_SUMMON_INTERVAL_SECONDS;
          reservedSummons += count;
        }
      }
    }

    // 精英地面爆破：先结算已有预警，再为冷却完成的精英布下新预警。
    eliteBlastHits.push(...this.stepEliteAttacks(stepSeconds, context));

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
      eliteBlastHits,
      bossSummonRequests,
      healEvents,
      bomberExplosions,
      broodSummonRequests,
    };
  }

  /**
   * 推进 Boss 控制器并把冲刺位移写回单位。
   * Boss 免疫眩晕/束缚：控制不冻结攻击节奏，只把冲锋移动降为 50% 速度。
   */
  private stepBoss(
    stepSeconds: number,
    context: EnemyStepContext,
  ): BossStepResult | null {
    const boss = this.bossCombat;
    const unit = this.bossUnit;
    if (!boss || !unit?.combatant.isAlive) return null;

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
      const speedMultiplier = Math.max(0, context.speedMultiplier?.(unit.id) ?? 1);
      const controlMultiplier = this.bossControlSlowMultiplier(unit, context);
      const distance = BOSS_CHARGE_SPEED * speedMultiplier * controlMultiplier * stepSeconds;
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

  /** 普通敌人被眩晕时整步跳过；Boss 只减速，从不被控制锁死。 */
  private isControlLocked(unit: EnemyUnit, context: EnemyStepContext): boolean {
    if (unit.enemy.behavior === 'boss') return false;
    return context.isStunned?.(unit.id) ?? false;
  }

  /** 普通敌人的束缚冻结位移；Boss 的束缚同样只转换为减速。 */
  private isRooted(unit: EnemyUnit, context: EnemyStepContext): boolean {
    if (unit.enemy.behavior === 'boss') return false;
    return context.isRooted?.(unit.id) ?? false;
  }

  /** Boss 受眩晕/束缚时只按减速倍率移动。 */
  private bossControlSlowMultiplier(
    unit: EnemyUnit,
    context: EnemyStepContext,
  ): number {
    if (unit.enemy.behavior !== 'boss') return 1;
    const controlled =
      (context.isStunned?.(unit.id) ?? false) || (context.isRooted?.(unit.id) ?? false);
    return controlled ? BOSS_CONTROL_SLOW_MULTIPLIER : 1;
  }

  /** 已存活与待落地的 Boss 增援总数，用于 8 只上限。 */
  private reinforcementCount(): number {
    let count = 0;
    for (const unit of this.units) {
      if (unit.summoned && unit.combatant.isAlive) count += 1;
    }
    for (const telegraph of this.spawnQueue) {
      if (telegraph.summoned === true) count += 1;
    }
    return count;
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

  /**
   * 精英地面爆破：每个存活精英按冷却在玩家当前位置布下预警，
   * 预警至少 0.9 秒后在同一个 ID 下落点结算。
   */
  private stepEliteAttacks(
    stepSeconds: number,
    context: EnemyStepContext,
  ): EnemyEliteBlastHit[] {
    const hits = this.stepEliteBlasts(stepSeconds, context);

    for (const unit of this.units) {
      if (!unit.combatant.isAlive || unit.enemy.elite !== true) continue;
      if (context.isStunned?.(unit.id)) continue;

      unit.eliteBlastCooldown = decay(unit.eliteBlastCooldown, stepSeconds);
      if (unit.eliteBlastCooldown > TIME_EPSILON) continue;

      this.createEliteBlast(unit, context.player);
      unit.eliteBlastCooldown = ELITE_BLAST_INTERVAL_SECONDS;
    }

    return hits;
  }

  /** 推进已有精英预警；到点的爆破按同一个 ID 产出落地结果。 */
  private stepEliteBlasts(
    stepSeconds: number,
    context: EnemyStepContext,
  ): EnemyEliteBlastHit[] {
    if (this.eliteBlastsList.length === 0) return [];
    const hits: EnemyEliteBlastHit[] = [];
    const survivors: EliteBlast[] = [];

    for (const blast of this.eliteBlastsList) {
      blast.remainingSeconds = decay(blast.remainingSeconds, stepSeconds);
      if (blast.remainingSeconds <= TIME_EPSILON) {
        const radius = blast.radius + context.player.radius;
        const within = distanceSquared(blast, context.player) <= radius * radius;
        const visible = hasLineOfSight(this.layout, blast, context.player);
        let damage: DamageResult | null = null;
        if (within && visible && !context.player.isInvulnerable) {
          damage = context.applyPlayerDamage(blast.damage, blast.damageType);
        }
        hits.push({
          blastId: blast.id,
          x: blast.x,
          y: blast.y,
          radius: blast.radius,
          damage,
        });
      } else {
        survivors.push(blast);
      }
    }

    this.eliteBlastsList = survivors;
    return hits;
  }

  private createEliteBlast(unit: EnemyUnit, player: EnemyPlayerTarget): EliteBlast {
    const wave = unit.enemy.eliteWave ?? 1;
    const blast: EliteBlast = {
      id: this.nextEliteBlastId,
      ownerId: unit.id,
      x: player.x,
      y: player.y,
      radius: ELITE_BLAST_RADIUS,
      damage: ELITE_BLAST_DAMAGE * waveDamageMultiplier(wave),
      damageType: 'magic',
      remainingSeconds: ELITE_ATTACK_WARNING_SECONDS,
    };
    this.nextEliteBlastId += 1;
    this.eliteBlastsList.push(blast);
    return blast;
  }

  /** 清场时移除尚未落地的精英预警，不再结算。 */
  clearEliteBlasts(): void {
    this.eliteBlastsList = [];
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

  private createUnit(
    enemy: EnemyDefinition,
    x: number,
    y: number,
    summoned = false,
  ): EnemyUnit {
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
        events: this.events,
      }),
      radius,
      summoned,
      activity: 'idle',
      windupRemaining: 0,
      dashRemaining: 0,
      dashX: 0,
      dashY: 0,
      attackCooldown: enemy.attack?.intervalSeconds ?? 0,
      chargeCooldown: 0,
      eliteBlastCooldown: enemy.elite === true ? ELITE_BLAST_FIRST_DELAY_SECONDS : 0,
      facingAngle: 0,
      healCooldown: MENDER_HEAL_INTERVAL_SECONDS,
      summonCooldown: BROODMOTHER_SUMMON_INTERVAL_SECONDS,
      larvaeSummoned: 0,
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
  ): EnemyUnitStepEvents {
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
      case 'flank':
        if (rooted) break;
        this.stepFlanker(unit, stepSeconds, context);
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
      case 'guard':
        if (rooted) break;
        this.stepGuard(unit, stepSeconds, context);
        break;
      case 'spit':
        this.stepSpitter(unit, stepSeconds, context, rooted);
        break;
      case 'shoot':
        this.stepShooter(unit, stepSeconds, context, rooted);
        break;
      case 'mend':
        return this.stepMender(unit, stepSeconds, context, rooted);
      case 'charge':
        // 束缚期间冻结预警/冲刺进度，也不会开始新的冲锋。
        if (rooted) break;
        this.stepCharger(unit, stepSeconds, context);
        break;
      case 'explode':
        if (rooted) break;
        return this.stepBomber(unit, stepSeconds, context);
      case 'summon':
        return this.stepBroodmother(unit, stepSeconds, context, rooted);
      case 'boss':
        break;
    }
    return {};
  }

  /**
   * 盾壳蟹：慢速朝玩家移动，朝向按有限角速度转向玩家。
   * 弱点固定在朝向背面，玩家绕后可以打弱点。
   */
  private stepGuard(
    unit: EnemyUnit,
    stepSeconds: number,
    context: EnemyStepContext,
  ): void {
    const target = this.meleeTarget(unit, context).point;
    const direction = unitDirection(unit.combatant, target);
    if (direction.distance > 0) {
      const desired = Math.atan2(direction.y, direction.x);
      const difference = normalizeAngle(desired - unit.facingAngle);
      const maxTurn = BULWARK_TURN_RATE * stepSeconds;
      unit.facingAngle = normalizeAngle(
        unit.facingAngle + Math.max(-maxTurn, Math.min(maxTurn, difference)),
      );
    }
    this.moveToward(
      unit,
      target,
      stepSeconds,
      ENEMY_MOVE_SPEED.guard,
      context,
    );
  }

  /**
   * 镰足虫：远离目标时沿直冲方向偏转 60° 的弧线快速绕侧，
   * 进入 170 后改为直线扑近；被掩体挡住时退回通用绕行。
   */
  private stepFlanker(
    unit: EnemyUnit,
    stepSeconds: number,
    context: EnemyStepContext,
  ): void {
    const target = this.meleeTarget(unit, context).point;
    const direction = unitDirection(unit.combatant, target);
    if (direction.distance === 0) return;

    if (
      direction.distance <= SKITTER_FLANK_DISTANCE ||
      !hasLineOfSight(this.layout, unit.combatant, target)
    ) {
      this.moveToward(unit, target, stepSeconds, ENEMY_MOVE_SPEED.flank, context);
      return;
    }

    const angle = SKITTER_FLANK_ANGLE * unit.avoidSign;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.moveDirection(
      unit,
      direction.x * cos - direction.y * sin,
      direction.x * sin + direction.y * cos,
      ENEMY_MOVE_SPEED.flank,
      stepSeconds,
      context,
    );
  }

  /**
   * 喷菇：维持射程与站位，攻击前停顿 0.7 秒并在原地蓄力，
   * 预警结束后朝玩家当前位置发射孢子弹；蓄力期间不移动。
   */
  private stepSpitter(
    unit: EnemyUnit,
    stepSeconds: number,
    context: EnemyStepContext,
    rooted: boolean,
  ): void {
    const attack = unit.enemy.attack;
    if (!attack) return;

    if (unit.activity === 'windup') {
      unit.windupRemaining = decay(unit.windupRemaining, stepSeconds);
      if (unit.windupRemaining <= TIME_EPSILON) {
        const aim = unitDirection(unit.combatant, context.player);
        unit.activity = 'idle';
        this.fireProjectile(unit, aim.x, aim.y, attack.damage, attack.damageType);
        unit.attackCooldown = attack.intervalSeconds ?? 1.6;
      }
      return;
    }

    const direction = unitDirection(unit.combatant, context.player);
    const visible = hasLineOfSight(this.layout, unit.combatant, context.player);

    if (!rooted) {
      if (direction.distance < SHOOTER_FIRE_RANGE && visible) {
        if (direction.distance > SHOOTER_STANDOFF_DISTANCE) {
          this.moveToward(unit, context.player, stepSeconds, ENEMY_MOVE_SPEED.spit, context);
        } else if (direction.distance < SHOOTER_STANDOFF_DISTANCE * 0.65) {
          this.moveAway(unit, context.player, stepSeconds, ENEMY_MOVE_SPEED.spit, context);
        }
      } else {
        this.moveToward(unit, context.player, stepSeconds, ENEMY_MOVE_SPEED.spit, context);
      }
    }

    unit.attackCooldown = decay(unit.attackCooldown, stepSeconds);
    if (unit.attackCooldown > 0) return;
    if (!visible || direction.distance > SHOOTER_FIRE_RANGE) return;

    unit.activity = 'windup';
    unit.windupRemaining = attack.windupSeconds ?? SPITTER_WINDUP_SECONDS;
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

  /**
   * 灯灵：与射手相同的维持距离与 1.8 秒直线射击，
   * 另外每 4 秒治疗周围一名受伤敌人最大生命的 8%。
   * 治疗目标排除灯灵自身/其他灯灵与 Boss；实际回复量不超过缺失生命。
   */
  private stepMender(
    unit: EnemyUnit,
    stepSeconds: number,
    context: EnemyStepContext,
    rooted: boolean,
  ): EnemyUnitStepEvents {
    const attack = unit.enemy.attack;

    if (attack) {
      const direction = unitDirection(unit.combatant, context.player);
      const visible = hasLineOfSight(this.layout, unit.combatant, context.player);

      if (!rooted) {
        if (direction.distance < SHOOTER_FIRE_RANGE && visible) {
          if (direction.distance > SHOOTER_STANDOFF_DISTANCE) {
            this.moveToward(unit, context.player, stepSeconds, ENEMY_MOVE_SPEED.mend, context);
          } else if (direction.distance < SHOOTER_STANDOFF_DISTANCE * 0.65) {
            this.moveAway(unit, context.player, stepSeconds, ENEMY_MOVE_SPEED.mend, context);
          }
        } else {
          this.moveToward(unit, context.player, stepSeconds, ENEMY_MOVE_SPEED.mend, context);
        }
      }

      unit.attackCooldown = decay(unit.attackCooldown, stepSeconds);
      if (unit.attackCooldown <= 0 && visible && direction.distance <= SHOOTER_FIRE_RANGE) {
        const aim = unitDirection(unit.combatant, context.player);
        this.fireProjectile(unit, aim.x, aim.y, attack.damage, attack.damageType);
        unit.attackCooldown = attack.intervalSeconds ?? 1.8;
      }
    }

    unit.healCooldown = decay(unit.healCooldown, stepSeconds);
    if (unit.healCooldown > TIME_EPSILON) return {};

    const target = this.findHealTarget(unit);
    if (!target) return {};

    const missing = target.combatant.health.maxHealth - target.combatant.health.health;
    const amount = Math.min(missing, target.combatant.health.maxHealth * MENDER_HEAL_PERCENT);
    if (!(amount > 0)) return {};

    target.combatant.health.heal(amount);
    unit.healCooldown = MENDER_HEAL_INTERVAL_SECONDS;
    return {
      heal: {
        menderId: unit.id,
        targetId: target.id,
        amount,
        healerX: unit.combatant.x,
        healerY: unit.combatant.y,
        x: target.combatant.x,
        y: target.combatant.y,
      },
    };
  }

  /** 治疗目标：范围内最缺血的友军；排除灯灵自身/其他灯灵与 Boss。 */
  private findHealTarget(unit: EnemyUnit): EnemyUnit | null {
    const rangeSquared = MENDER_HEAL_RANGE * MENDER_HEAL_RANGE;
    let best: EnemyUnit | null = null;
    let bestRatio = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of this.units) {
      if (candidate === unit || !candidate.combatant.isAlive) continue;
      if (candidate.enemy.id === 'mender' || candidate.enemy.behavior === 'boss') continue;
      const health = candidate.combatant.health;
      if (health.health >= health.maxHealth) continue;
      const distance = distanceSquared(unit.combatant, candidate.combatant);
      if (distance > rangeSquared) continue;
      const ratio = health.health / health.maxHealth;
      if (ratio < bestRatio - TIME_EPSILON || (Math.abs(ratio - bestRatio) <= TIME_EPSILON && distance < bestDistance)) {
        best = candidate;
        bestRatio = ratio;
        bestDistance = distance;
      }
    }

    return best;
  }

  /**
   * 爆爆兽：进入 240 距离后原地蓄力 0.9 秒，结束时自爆并死亡。
   * 蓄力期间被击杀则单位直接死亡，不再产生自爆事件。
   */
  private stepBomber(
    unit: EnemyUnit,
    stepSeconds: number,
    context: EnemyStepContext,
  ): EnemyUnitStepEvents {
    const attack = unit.enemy.attack;

    if (unit.activity === 'windup') {
      unit.windupRemaining = decay(unit.windupRemaining, stepSeconds);
      if (unit.windupRemaining > TIME_EPSILON) return {};
      return { bomberExplosion: this.detonateBomber(unit, context) };
    }

    const direction = unitDirection(unit.combatant, context.player);
    if (
      direction.distance <= BOMBER_TRIGGER_RANGE &&
      hasLineOfSight(this.layout, unit.combatant, context.player)
    ) {
      unit.activity = 'windup';
      unit.windupRemaining = attack?.windupSeconds ?? BOMBER_WINDUP_SECONDS;
      return {};
    }

    this.moveToward(
      unit,
      context.player,
      stepSeconds,
      ENEMY_MOVE_SPEED.explode,
      context,
    );
    return {};
  }

  /** 自爆结算：范围内且未被墙体遮挡才伤害玩家，随后自身死亡。 */
  private detonateBomber(
    unit: EnemyUnit,
    context: EnemyStepContext,
  ): EnemyBomberExplosion {
    const radius = BOMBER_EXPLOSION_RADIUS + context.player.radius;
    const within = distanceSquared(unit.combatant, context.player) <= radius * radius;
    const visible = hasLineOfSight(this.layout, unit.combatant, context.player);
    const attack = unit.enemy.attack;
    let damage: DamageResult | null = null;
    if (within && visible && !context.player.isInvulnerable && attack) {
      damage = context.applyPlayerDamage(attack.damage, attack.damageType);
    }

    unit.activity = 'idle';
    unit.windupRemaining = 0;
    // 自爆不是玩家击杀：直接耗尽生命，不经过击杀奖励入口。
    unit.combatant.applyDamage(
      unit.combatant.health.maxHealth + unit.combatant.health.shield + 1,
      'true',
    );

    return {
      enemyId: unit.id,
      x: unit.combatant.x,
      y: unit.combatant.y,
      radius: BOMBER_EXPLOSION_RADIUS,
      damage,
    };
  }

  /**
   * 巢母：每 8 秒尝试召唤 2 只幼虫，单个巢母终生最多 6 只。
   * 数量先按终生上限截断，全局同屏名额由 `step` 统一截断。
   */
  private stepBroodmother(
    unit: EnemyUnit,
    stepSeconds: number,
    context: EnemyStepContext,
    rooted: boolean,
  ): EnemyUnitStepEvents {
    if (!rooted) {
      this.moveToward(
        unit,
        this.meleeTarget(unit, context).point,
        stepSeconds,
        ENEMY_MOVE_SPEED.summon,
        context,
      );
    }

    unit.summonCooldown = decay(unit.summonCooldown, stepSeconds);
    if (unit.summonCooldown > TIME_EPSILON) return {};

    const remainingLifetime = BROODMOTHER_MAX_LARVAE - unit.larvaeSummoned;
    if (remainingLifetime <= 0) return {};
    return {
      summon: { count: Math.min(BROODMOTHER_SUMMON_COUNT, remainingLifetime) },
    };
  }

  /** 冲锋者：0.7 秒预警后锁定方向直线冲刺 0.35 秒；精英前摇抬到至少 0.9 秒。 */
  private stepCharger(
    unit: EnemyUnit,
    stepSeconds: number,
    context: EnemyStepContext,
  ): void {
    const attack = unit.enemy.attack;
    const baseWindup = attack?.windupSeconds ?? 0.7;
    const windupSeconds =
      unit.enemy.elite === true
        ? Math.max(baseWindup, ELITE_ATTACK_WARNING_SECONDS)
        : baseWindup;

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
      // 预警期间持续把朝向同步到玩家当前位置，场景用同一方向画预警线；
      // 冲刺沿用最后一帧的方向，保证预警与实际伤害路径一致。
      const aim = unitDirection(unit.combatant, context.player);
      unit.dashX = aim.x;
      unit.dashY = aim.y;
      unit.windupRemaining = decay(unit.windupRemaining, stepSeconds);
      if (unit.windupRemaining <= TIME_EPSILON) {
        unit.activity = 'dash';
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
      unit.dashX = direction.x;
      unit.dashY = direction.y;
      return;
    }

    this.moveToward(unit, context.player, stepSeconds, ENEMY_MOVE_SPEED.charge, context);
  }

  /**
   * 近战类敌人（追击/绕侧/重装/挡路/巢母）的目标：召唤物存活且比玩家更近时
   * 改为攻击召唤物。射手、灯灵、喷菇与冲锋者仍以玩家为目标。
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

  /**
   * 沿给定（未归一化）方向移动，受墙/掩体阻挡并应用减速倍率。
   */
  private moveDirection(
    unit: EnemyUnit,
    moveX: number,
    moveY: number,
    speed: number,
    stepSeconds: number,
    context: EnemyStepContext,
  ): void {
    const length = Math.hypot(moveX, moveY);
    if (length === 0) return;
    const multiplier = context.speedMultiplier?.(unit.id) ?? 1;
    const distance = speed * Math.max(0, multiplier) * stepSeconds;
    const moved = moveCircleWithCollision(
      this.layout,
      unit.combatant.x,
      unit.combatant.y,
      unit.radius,
      (moveX / length) * distance,
      (moveY / length) * distance,
    );
    unit.combatant.x = moved.x;
    unit.combatant.y = moved.y;
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
      if (this.isControlLocked(unit, context)) continue;

      const contact = this.contactDamage(unit);
      if (!contact) continue;

      // 只有近战类行为会改打更近的召唤物；冲锋仍按冲刺路径攻击玩家。
      const target =
        unit.enemy.behavior === 'chase' ||
        unit.enemy.behavior === 'flank' ||
        unit.enemy.behavior === 'heavy' ||
        unit.enemy.behavior === 'guard' ||
        unit.enemy.behavior === 'summon'
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
    this.clearEliteBlasts();
    return { enemyIds, projectileIds, telegraphIds };
  }
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
