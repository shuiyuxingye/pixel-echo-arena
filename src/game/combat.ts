/**
 * 战斗核心规则（纯逻辑，不依赖 Phaser）：伤害结算、生命/护盾、前方扇形选敌、
 * 按住式普通攻击计时、直线弹体与定向技能落点。
 *
 * 所有位置为逻辑像素，时间按固定逻辑步长传入，不读取渲染帧长。
 * 数值来自 `src/game/data/characters.ts` 与 `docs/game-design.md` §4、§5。
 */
import { isCircleBlocked, type ArenaLayout } from './arena';
import type { AttackDefinition, DamageType } from './data';
import { FACING_VECTORS, type Facing } from './movement';

/** 自动选敌/提示目标的前方扇区总张角（docs/game-design.md §4）。 */
export const TARGET_SECTOR_DEGREES = 120;

/** 普通弹体的飞行速度（逻辑像素/秒）与碰撞半径。 */
export const PROJECTILE_SPEED = 620;
export const PROJECTILE_RADIUS = 5;

/** 弹体/射线推进的子步上限，避免高速位移穿过掩体。 */
const MAX_SUBSTEP_PIXELS = 4;

/** 浮点累计容差。 */
const TIME_EPSILON = 1e-9;
const SECTOR_EPSILON = 1e-9;

/** 地面技能落点采样的步长（逻辑像素）。 */
const GROUND_CAST_SAMPLE_STEP = 2;

/** 地面落点与障碍的保留间距：让落点停在墙前而不是墙内。 */
const GROUND_CAST_CLEARANCE = 1;

export interface CombatPoint {
  x: number;
  y: number;
}

/** 可被选为目标的最小信息；`isAlive` 缺省视为存活。 */
export interface Targetable {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius?: number;
  readonly isAlive?: boolean;
}

export interface DamageResult {
  /** 是否真正结算了伤害；已死亡目标返回 false。 */
  readonly applied: boolean;
  /** 减免前的原始伤害。 */
  readonly rawDamage: number;
  /** 按护甲/法抗减免后的伤害。 */
  readonly damage: number;
  readonly shieldAbsorbed: number;
  readonly healthLost: number;
  /** 本次伤害是否造成死亡；重复击杀返回 false。 */
  readonly died: boolean;
  readonly health: number;
  readonly shield: number;
}

/**
 * 物理伤害 = 原始 × 100 / (100 + 护甲)；
 * 法术伤害 = 原始 × (1 − 法抗)；
 * 真实伤害不受减免。内部保留小数（docs/game-design.md §5 通用约定）。
 */
export function computeDamage(
  rawDamage: number,
  damageType: DamageType,
  armor: number,
  magicResist: number,
): number {
  if (!Number.isFinite(rawDamage) || rawDamage <= 0) return 0;

  const safeArmor = Number.isFinite(armor) ? Math.max(0, armor) : 0;
  const safeMagicResist = Number.isFinite(magicResist)
    ? Math.min(Math.max(magicResist, 0), 1)
    : 0;

  switch (damageType) {
    case 'physical':
      return (rawDamage * 100) / (100 + safeArmor);
    case 'magic':
      return rawDamage * (1 - safeMagicResist);
    case 'true':
      return rawDamage;
  }
}

/** HUD 显示值统一向上取整；内部生命/伤害仍保留小数。 */
export function hudValue(value: number): number {
  return Math.ceil(value);
}

export interface HealthStateOptions {
  readonly maxHealth: number;
  readonly armor?: number;
  readonly magicResist?: number;
  readonly shield?: number;
}

/**
 * 生命与护盾：伤害先扣护盾再扣生命，生命 ≤ 0 判死亡。
 * 死亡后再次受击直接忽略，保证重复击杀不会重复计数。
 */
export class HealthState {
  readonly armor: number;
  readonly magicResist: number;

  private maxHealthValue: number;
  private healthValue: number;
  private shieldValue: number;
  private deaths = 0;

  constructor(options: HealthStateOptions) {
    this.maxHealthValue = Math.max(1, options.maxHealth);
    this.armor = Math.max(0, options.armor ?? 0);
    this.magicResist = Math.min(Math.max(options.magicResist ?? 0, 0), 1);
    this.healthValue = this.maxHealthValue;
    this.shieldValue = Math.max(0, options.shield ?? 0);
  }

  get maxHealth(): number {
    return this.maxHealthValue;
  }

  get health(): number {
    return this.healthValue;
  }

  /**
   * 提升最大生命并按需治疗（升级奖励：+5 上限并回复 5）。
   * 死亡角色不再回复生命，避免升级抵消死亡结算。
   */
  increaseMaxHealth(amount: number, healAmount = 0): void {
    const gain = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    if (gain <= 0) return;
    this.maxHealthValue += gain;
    if (!this.isDead) this.heal(healAmount);
  }

  /** 回复生命，不超过最大生命；死亡状态不复活。 */
  heal(amount: number): void {
    if (this.isDead || !Number.isFinite(amount) || amount <= 0) return;
    this.healthValue = Math.min(this.maxHealthValue, this.healthValue + amount);
  }

  /**
   * 续局恢复：直接写入最大生命与当前生命（含等级与 G04 加成），
   * 不触发升级回复或波间补给。非法最大生命保持原值，当前生命按上限钳制。
   */
  restoreHealth(current: number, maxHealth: number): void {
    if (Number.isFinite(maxHealth) && maxHealth >= 1) {
      this.maxHealthValue = maxHealth;
    }
    const value = Number.isFinite(current) ? current : this.maxHealthValue;
    this.healthValue = Math.min(this.maxHealthValue, Math.max(0, value));
  }

  get shield(): number {
    return this.shieldValue;
  }

  /**
   * 直接设置当前护盾值（塞雷娅 K 的护盾刷新与到期清除使用）。
   * 只改护盾，不触碰生命与上限；非法值按 0 处理。
   */
  setShield(amount: number): void {
    this.shieldValue = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  }

  get isDead(): boolean {
    return this.healthValue <= 0;
  }

  /** 死亡次数只会是 0 或 1；用于断言重复击杀保护。 */
  get deathCount(): number {
    return this.deaths;
  }

  applyDamage(rawDamage: number, damageType: DamageType): DamageResult {
    const damage = computeDamage(rawDamage, damageType, this.armor, this.magicResist);
    if (this.isDead || damage <= 0) {
      return {
        applied: false,
        rawDamage: Math.max(0, rawDamage),
        damage,
        shieldAbsorbed: 0,
        healthLost: 0,
        died: false,
        health: this.healthValue,
        shield: this.shieldValue,
      };
    }

    const shieldAbsorbed = Math.min(this.shieldValue, damage);
    this.shieldValue -= shieldAbsorbed;

    const remaining = damage - shieldAbsorbed;
    const healthLost = Math.min(this.healthValue, remaining);
    this.healthValue = Math.max(0, this.healthValue - remaining);

    const died = this.healthValue <= 0;
    if (died) this.deaths += 1;

    return {
      applied: true,
      rawDamage,
      damage,
      shieldAbsorbed,
      healthLost,
      died,
      health: this.healthValue,
      shield: this.shieldValue,
    };
  }
}

export interface CombatantOptions extends HealthStateOptions {
  readonly id: string;
  x: number;
  y: number;
  readonly radius?: number;
}

/** 场上的可受伤实体（敌人、召唤物等）的纯逻辑状态。 */
export class Combatant {
  readonly id: string;
  readonly radius: number;
  readonly health: HealthState;
  x: number;
  y: number;

  constructor(options: CombatantOptions) {
    this.id = options.id;
    this.x = options.x;
    this.y = options.y;
    this.radius = options.radius ?? 12;
    this.health = new HealthState(options);
  }

  get isAlive(): boolean {
    return !this.health.isDead;
  }

  applyDamage(rawDamage: number, damageType: DamageType): DamageResult {
    return this.health.applyDamage(rawDamage, damageType);
  }
}

/** 两点距离的平方，用于等距比较而无需开方。 */
export function distanceSquared(a: CombatPoint, b: CombatPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** 目标是否位于以面向为中心、总张角 sectorDegrees 的前方扇区内。 */
export function isTargetInSector(
  origin: CombatPoint,
  facing: Facing,
  target: CombatPoint,
  range: number,
  sectorDegrees = TARGET_SECTOR_DEGREES,
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = Math.hypot(dx, dy);

  if (distance > range) return false;
  if (distance === 0) return true;

  const facingVector = FACING_VECTORS[facing];
  const dot = (dx * facingVector.x + dy * facingVector.y) / distance;
  const halfAngleRadians = (Math.min(360, Math.max(0, sectorDegrees)) / 2) * (Math.PI / 180);
  return dot >= Math.cos(halfAngleRadians) - SECTOR_EPSILON;
}

/**
 * 列出前方扇区、射程内的存活目标，按距离升序；等距按稳定 ID 升序。
 */
export function listFrontTargets(
  origin: CombatPoint,
  facing: Facing,
  targets: readonly Targetable[],
  range: number,
  sectorDegrees = TARGET_SECTOR_DEGREES,
): Targetable[] {
  return targets
    .filter((target) => target.isAlive !== false)
    .filter((target) => isTargetInSector(origin, facing, target, range, sectorDegrees))
    .sort((left, right) => {
      const difference = distanceSquared(origin, left) - distanceSquared(origin, right);
      if (difference !== 0) return difference;
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    });
}

/** 前方扇区、射程内最近的目标；没有则返回 null，不回退到背后目标。 */
export function selectFrontTarget(
  origin: CombatPoint,
  facing: Facing,
  targets: readonly Targetable[],
  range: number,
  sectorDegrees = TARGET_SECTOR_DEGREES,
): Targetable | null {
  return listFrontTargets(origin, facing, targets, range, sectorDegrees)[0] ?? null;
}

/**
 * 当前提示目标的追踪器：
 * - 未手动切换时，每个逻辑步自动选择前方扇区射程内最近的目标；
 * - 目标死亡、出射程或转到背后时取消，并回到自动选择；
 * - Tab 按距离与稳定 ID 顺序循环切换后保持手动选择，直到该目标失效，且不改变面向。
 */
export class TargetTracker {
  private readonly range: number;
  private readonly sectorDegrees: number;
  private selectedId: string | null = null;
  private manualSelection = false;

  constructor(range: number, sectorDegrees = TARGET_SECTOR_DEGREES) {
    this.range = range;
    this.sectorDegrees = sectorDegrees;
  }

  get targetId(): string | null {
    return this.selectedId;
  }

  /** 每个逻辑步调用；返回当前有效提示目标。 */
  update(
    origin: CombatPoint,
    facing: Facing,
    targets: readonly Targetable[],
  ): Targetable | null {
    const candidates = this.candidates(origin, facing, targets);

    if (this.manualSelection) {
      const current = candidates.find((target) => target.id === this.selectedId);
      if (current) return current;
      this.manualSelection = false;
    }

    const next = candidates[0] ?? null;
    this.selectedId = next?.id ?? null;
    return next;
  }

  /** Tab：切换到下一个前方目标并保持手动选择；没有候选时清空。 */
  cycle(origin: CombatPoint, facing: Facing, targets: readonly Targetable[]): Targetable | null {
    const candidates = this.candidates(origin, facing, targets);
    if (candidates.length === 0) {
      this.selectedId = null;
      this.manualSelection = false;
      return null;
    }

    const currentIndex = candidates.findIndex((target) => target.id === this.selectedId);
    const next = candidates[(currentIndex + 1) % candidates.length] ?? null;
    this.selectedId = next?.id ?? null;
    this.manualSelection = true;
    return next;
  }

  clear(): void {
    this.selectedId = null;
    this.manualSelection = false;
  }

  private candidates(
    origin: CombatPoint,
    facing: Facing,
    targets: readonly Targetable[],
  ): Targetable[] {
    return listFrontTargets(origin, facing, targets, this.range, this.sectorDegrees);
  }
}

/** 按住式普通攻击的计时器；实际发射时由调用方取当前面向。 */
export class AttackTimer {
  private readonly intervalSeconds: number;
  private cooldownSeconds = 0;

  constructor(intervalSeconds: number) {
    this.intervalSeconds = Math.max(TIME_EPSILON, intervalSeconds);
  }

  get cooldownRemaining(): number {
    return this.cooldownSeconds;
  }

  /**
   * 推进一个逻辑步；按住且冷却结束时返回 true（本步应发射一发）。
   * 没有敌人时同样发射并消耗攻击间隔（允许空射）。
   *
   * `intervalOverrideSeconds` 用于逐发改变间隔（如维什戴尔 L 的 1.1 秒）：
   * 只在本次实际发射时生效，否则仍按构造时的基础间隔递减。
   */
  update(stepSeconds: number, held: boolean, intervalOverrideSeconds?: number): boolean {
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) return false;

    if (this.cooldownSeconds > 0) {
      this.cooldownSeconds -= stepSeconds;
      if (this.cooldownSeconds <= TIME_EPSILON) this.cooldownSeconds = 0;
    }

    if (!held || this.cooldownSeconds > 0) return false;

    const interval =
      intervalOverrideSeconds !== undefined &&
      Number.isFinite(intervalOverrideSeconds) &&
      intervalOverrideSeconds > 0
        ? intervalOverrideSeconds
        : this.intervalSeconds;
    this.cooldownSeconds = Math.max(TIME_EPSILON, interval);
    return true;
  }

  reset(): void {
    this.cooldownSeconds = 0;
  }

  /** 续局恢复：直接写入剩余攻击冷却，不重置已获得强化带来的间隔。 */
  restoreCooldown(seconds: number): void {
    this.cooldownSeconds =
      Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  }
}

/** A01 等穿透强化：首个命中后还能穿过多少个目标、后续命中伤害比例。 */
export interface ProjectilePierceOptions {
  readonly extraTargets: number;
  /** 第二个及之后命中目标的伤害比例，例如 0.7。 */
  readonly subsequentDamageRatio: number;
}

export interface ProjectileState {
  readonly id: number;
  readonly vx: number;
  readonly vy: number;
  readonly radius: number;
  readonly attack: AttackDefinition;
  readonly damage: number;
  readonly damageType: DamageType;
  readonly facing: Facing;
  /** null 表示首个命中后消失；否则按额外目标数继续飞行。 */
  readonly pierce: ProjectilePierceOptions | null;
  /** 本发已结算过的目标 ID，防止穿透后对同一敌人重复结算。 */
  readonly hitTargetIds: Set<string>;
  x: number;
  y: number;
  remainingRange: number;
}

export type ProjectileStepStatus = 'active' | 'expired' | 'blocked';

/** 按当前面向创建直线弹体；弹体方向在发射瞬间固定，随后转身不会改变它。 */
export function createProjectile(
  id: number,
  origin: CombatPoint,
  facing: Facing,
  attack: AttackDefinition,
  pierce: ProjectilePierceOptions | null = null,
): ProjectileState {
  const direction = FACING_VECTORS[facing];
  return {
    id,
    x: origin.x,
    y: origin.y,
    vx: direction.x * PROJECTILE_SPEED,
    vy: direction.y * PROJECTILE_SPEED,
    radius: PROJECTILE_RADIUS,
    attack,
    damage: attack.damage,
    damageType: attack.damageType,
    facing,
    pierce,
    hitTargetIds: new Set(),
    remainingRange: attack.range,
  };
}

/**
 * 推进弹体：命中墙体/掩体返回 blocked，飞满射程返回 expired。
 * 位置停在阻塞点或射程终点，由调用方决定移除与特效。
 */
export function stepProjectile(
  projectile: ProjectileState,
  stepSeconds: number,
  layout: ArenaLayout,
): ProjectileStepStatus {
  const speed = Math.hypot(projectile.vx, projectile.vy);
  if (speed === 0 || !(stepSeconds > 0) || !Number.isFinite(stepSeconds)) {
    return 'active';
  }

  const totalDistance = speed * stepSeconds;
  const substeps = Math.max(1, Math.ceil(totalDistance / MAX_SUBSTEP_PIXELS));
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

/** 弹体是否与目标圆形碰撞。 */
export function projectileHitsTarget(projectile: ProjectileState, target: Targetable): boolean {
  const radius = projectile.radius + (target.radius ?? 0);
  const dx = projectile.x - target.x;
  const dy = projectile.y - target.y;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * 直线弹体命中单个目标的直接伤害（无溅射、无余震）。
 * `damageMultiplier` 用于 G01 等全局伤害倍率，由场景注入同一真源。
 * 穿透弹体从第二个目标起按 `subsequentDamageRatio` 结算。
 */
export function resolveProjectileHit(
  projectile: ProjectileState,
  target: Combatant,
  damageMultiplier = 1,
): DamageResult {
  const globalMultiplier =
    Number.isFinite(damageMultiplier) && damageMultiplier > 0 ? damageMultiplier : 1;
  const pierceMultiplier =
    projectile.pierce && projectile.hitTargetIds.size > 0
      ? projectile.pierce.subsequentDamageRatio
      : 1;
  return target.applyDamage(
    projectile.damage * globalMultiplier * pierceMultiplier,
    projectile.damageType,
  );
}

/**
 * 登记一次命中：目标加入 `hitTargetIds`，同一发弹体不会对它重复结算。
 * 返回 true 表示弹体仍可继续飞行（穿透强化还有剩余目标），false 表示应移除。
 */
export function registerProjectileHit(
  projectile: ProjectileState,
  targetId: string,
): boolean {
  projectile.hitTargetIds.add(targetId);
  if (!projectile.pierce) return false;
  return projectile.hitTargetIds.size < 1 + projectile.pierce.extraTargets;
}

export interface GroundCastPoint extends CombatPoint {
  /** 实际到达的距离，遇墙时会小于请求距离。 */
  readonly distance: number;
  readonly truncated: boolean;
}

/**
 * 定向地面技能的落点：沿当前面向按配置距离前进，遇墙/掩体截断。
 * 自身治疗、领域、变身等不需要方向目标的技能不应调用本函数。
 */
export function resolveGroundCastPoint(
  layout: ArenaLayout,
  origin: CombatPoint,
  facing: Facing,
  distance: number,
): GroundCastPoint {
  const maxDistance = Math.max(0, distance);
  const direction = FACING_VECTORS[facing];
  let traveled = 0;

  while (traveled < maxDistance) {
    const nextStep = Math.min(GROUND_CAST_SAMPLE_STEP, maxDistance - traveled);
    const nextX = origin.x + direction.x * (traveled + nextStep);
    const nextY = origin.y + direction.y * (traveled + nextStep);
    if (isCircleBlocked(layout, nextX, nextY, GROUND_CAST_CLEARANCE)) break;
    traveled += nextStep;
  }

  traveled = Math.min(traveled, maxDistance);
  return {
    x: origin.x + direction.x * traveled,
    y: origin.y + direction.y * traveled,
    distance: traveled,
    truncated: traveled < maxDistance - TIME_EPSILON,
  };
}
