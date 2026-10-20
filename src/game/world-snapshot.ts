/**
 * 波中世界状态快照（docs/game-design.md §9）的纯数据结构与校验。
 *
 * 只包含可序列化的逻辑状态：没有 Phaser 对象、音频或函数。
 * 各规则模块的 `snapshotWorld()` / `restoreWorld()` 使用这里的类型，
 * `run-save.ts` 在写入与读取时统一用 `validateWorldSnapshot` 拒绝损坏数据。
 */
import type { AttackDefinition, DamageType, EnemyDefinition } from './data';
import type { Facing } from './movement';

/** 玩家位置、八向面向与闪避冷却。 */
export interface PlayerWorldSnapshot {
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  readonly dodgeCooldownSeconds: number;
}

/** 波次刷怪时钟与已刷出进度。 */
export interface WaveClockSnapshot {
  readonly elapsedSeconds: number;
  readonly nextNormalIndex: number;
  readonly eliteSpawned: boolean;
  readonly bossSpawned: boolean;
}

export type EnemyActivityWorld = 'idle' | 'windup' | 'dash';

export interface EnemyUnitWorldSnapshot {
  readonly id: string;
  /** 已按波次倍率缩放的敌人定义，可直接用于重建。 */
  readonly enemy: EnemyDefinition;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly shield: number;
  readonly activity: EnemyActivityWorld;
  readonly windupRemaining: number;
  readonly dashRemaining: number;
  readonly dashX: number;
  readonly dashY: number;
  readonly attackCooldown: number;
  readonly chargeCooldown: number;
  readonly avoidSeconds: number;
  readonly avoidSign: 1 | -1;
}

export interface EnemyTelegraphWorldSnapshot {
  readonly id: string;
  readonly enemy: EnemyDefinition;
  readonly x: number;
  readonly y: number;
  readonly remainingSeconds: number;
}

export interface EnemyProjectileWorldSnapshot {
  readonly id: number;
  readonly ownerId: string;
  readonly damage: number;
  readonly damageType: DamageType;
  readonly radius: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly remainingRange: number;
}

export type BossActivityWorld = 'idle' | 'windup' | 'dash';

export interface BossBlastWorldSnapshot {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly damage: number;
  readonly damageType: DamageType;
  readonly remainingSeconds: number;
}

export interface BossWorldSnapshot {
  readonly phase: 1 | 2;
  readonly attackTimer: number;
  readonly patternIndex: number;
  readonly activity: BossActivityWorld;
  readonly windupRemaining: number;
  readonly dashRemaining: number;
  readonly dashX: number;
  readonly dashY: number;
  readonly summonTimer: number;
  readonly blasts: readonly BossBlastWorldSnapshot[];
  readonly nextBlastId: number;
}

export interface EnemySystemWorldSnapshot {
  readonly elapsedSeconds: number;
  readonly contactCooldownSeconds: number;
  readonly nextUnitId: number;
  readonly nextTelegraphId: number;
  readonly nextProjectileId: number;
  readonly units: readonly EnemyUnitWorldSnapshot[];
  readonly telegraphs: readonly EnemyTelegraphWorldSnapshot[];
  readonly projectiles: readonly EnemyProjectileWorldSnapshot[];
  readonly boss: BossWorldSnapshot | null;
}

export interface ProjectilePierceWorldSnapshot {
  readonly extraTargets: number;
  readonly subsequentDamageRatio: number;
}

export interface PlayerProjectileWorldSnapshot {
  readonly id: number;
  readonly source: 'J' | 'K';
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly radius: number;
  readonly remainingRange: number;
  readonly attack: AttackDefinition;
  readonly damage: number;
  readonly damageType: DamageType;
  readonly facing: Facing;
  readonly pierce: ProjectilePierceWorldSnapshot | null;
  readonly hitTargetIds: readonly string[];
}

export interface SoulWorldSnapshot {
  readonly cooldownSeconds: number;
  readonly elapsedSeconds: number;
  readonly nextSoulId: number;
  readonly maxSummonsOverride: number | null;
  readonly souls: readonly {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly remainingSeconds: number;
    readonly nextTickSeconds: number;
  }[];
  readonly slows: readonly { readonly targetId: string; readonly remainingSeconds: number }[];
}

export interface GrenadeWorldSnapshot {
  readonly elapsedSeconds: number;
  readonly marks: readonly string[];
  readonly stuns: readonly { readonly targetId: string; readonly remainingSeconds: number }[];
  readonly pending: readonly {
    readonly dueInSeconds: number;
    readonly x: number;
    readonly y: number;
    readonly damage: number;
    readonly damageType: DamageType;
    readonly radius: number;
  }[];
}

export interface BurstWorldSnapshot {
  readonly elapsedSeconds: number;
  readonly cooldownSeconds: number;
  readonly ammo: number;
  readonly ammoRemainingSeconds: number;
  readonly bonusShots: number;
  readonly lastShotRadiusBonus: number;
}

export interface AmiyaWorldSnapshot {
  readonly cooldownSeconds: number;
  readonly burstElapsedSeconds: number;
  readonly burstActive: boolean;
  readonly burstShotsFired: number;
  readonly fatigueSeconds: number;
  readonly chimeraCooldownSeconds: number;
  readonly chimeraRemainingSeconds: number;
  readonly weaknessRemainingSeconds: number;
  readonly totalJHits: number;
  readonly countedProjectileIds: readonly number[];
  readonly followupPending: boolean;
  readonly followupRemainingSeconds: number;
}

export interface SariaWorldSnapshot {
  readonly kCooldownSeconds: number;
  readonly lCooldownSeconds: number;
  readonly lActiveSeconds: number;
  readonly shieldRemainingSeconds: number;
  readonly passiveTriggers: number;
  readonly shieldCounterCooldownRemaining: number;
  readonly fieldHealCount: number;
  readonly fieldHealTickHadHealing: boolean;
  readonly fieldDamageAccumulator: number;
  readonly fieldHealAccumulator: number;
}

export interface MuelsyseCopyWorldSnapshot {
  readonly id: string;
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  readonly remainingSeconds: number;
  readonly attackCooldownSeconds: number;
}

export interface MuelsyseControlWorldSnapshot {
  readonly targetId: string;
  readonly stun: number;
  readonly root: number;
  readonly slow: number;
}

export interface MuelsyseWorldSnapshot {
  readonly form: 'melee' | 'ranged';
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly stacks: number;
  readonly facing: Facing;
  readonly kCooldownSeconds: number;
  readonly lCooldownSeconds: number;
  readonly lRemainingSeconds: number;
  readonly nextPullAtSeconds: number;
  readonly attackCooldownSeconds: number;
  readonly avoidSeconds: number;
  readonly avoidSign: 1 | -1;
  readonly copies: readonly MuelsyseCopyWorldSnapshot[];
  readonly nextCopyId: number;
  readonly rangedAttacksSinceCopy: number;
  readonly waterMirrorCooldownRemaining: number;
  readonly healAccumulatorSeconds: number;
  readonly controls: readonly MuelsyseControlWorldSnapshot[];
}

export interface UpgradeEffectsWorldSnapshot {
  readonly echoRemainingSeconds: number;
  readonly elapsedSeconds: number;
  readonly kKillProgress: number;
  readonly lKillProgress: number;
  readonly slows: readonly { readonly targetId: string; readonly remainingSeconds: number }[];
}

/** 波中检查点保存的完整世界状态。 */
export interface RunWorldSnapshot {
  readonly player: PlayerWorldSnapshot;
  readonly attackCooldownSeconds: number;
  readonly wave: WaveClockSnapshot;
  readonly enemies: EnemySystemWorldSnapshot;
  readonly projectiles: readonly PlayerProjectileWorldSnapshot[];
  readonly nextProjectileId: number;
  readonly simulatedSeconds: number;
  readonly souls: SoulWorldSnapshot | null;
  readonly grenade: GrenadeWorldSnapshot | null;
  readonly burst: BurstWorldSnapshot | null;
  readonly amiya: AmiyaWorldSnapshot | null;
  readonly saria: SariaWorldSnapshot | null;
  readonly muelsyse: MuelsyseWorldSnapshot | null;
  readonly effects: UpgradeEffectsWorldSnapshot;
}

const FACINGS: ReadonlySet<string> = new Set<Facing>([
  'east',
  'southEast',
  'south',
  'southWest',
  'west',
  'northWest',
  'north',
  'northEast',
]);

const DAMAGE_TYPES: ReadonlySet<string> = new Set<DamageType>([
  'physical',
  'magic',
  'true',
]);

const ACTIVITIES: ReadonlySet<string> = new Set<EnemyActivityWorld>([
  'idle',
  'windup',
  'dash',
]);

const MAX_ENTITIES = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNeg(value: unknown): value is number {
  return isNum(value) && value >= 0;
}

function isPos(value: unknown): value is number {
  return isNum(value) && value > 0;
}

function isInt(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return isNum(value) && Number.isInteger(value) && value >= min && value <= max;
}

function isBool(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function isFacing(value: unknown): value is Facing {
  return typeof value === 'string' && FACINGS.has(value);
}

function isDamageType(value: unknown): value is DamageType {
  return typeof value === 'string' && DAMAGE_TYPES.has(value);
}

function isActivity(value: unknown): value is EnemyActivityWorld {
  return typeof value === 'string' && ACTIVITIES.has(value);
}

function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
  max = MAX_ENTITIES,
): value is readonly T[] {
  return Array.isArray(value) && value.length <= max && value.every(guard);
}

function isAttack(value: unknown): value is AttackDefinition {
  if (!isRecord(value)) return false;
  if (value.key !== 'J' || typeof value.name !== 'string') return false;
  if (!isPos(value.intervalSeconds) || !isPos(value.range)) return false;
  if (!isNonNeg(value.damage) || !isDamageType(value.damageType)) return false;
  if (value.splashRadius !== undefined && !isPos(value.splashRadius)) return false;
  if (value.arcDegrees !== undefined && !isPos(value.arcDegrees)) return false;
  if (value.knockback !== undefined && !isNonNeg(value.knockback)) return false;
  if (value.aftershock !== undefined) {
    const aftershock = value.aftershock;
    if (!isRecord(aftershock)) return false;
    if (!isPos(aftershock.delaySeconds) || !isNonNeg(aftershock.damage)) return false;
    if (!isDamageType(aftershock.damageType) || !isPos(aftershock.radius)) return false;
  }
  return true;
}

function isEnemyDefinition(value: unknown): value is EnemyDefinition {
  if (!isRecord(value)) return false;
  if (!isId(value.id) || typeof value.name !== 'string') return false;
  if (!isPos(value.maxHealth) || !isNonNeg(value.armor)) return false;
  if (!isNum(value.magicResist) || value.magicResist < 0 || value.magicResist > 1) {
    return false;
  }
  if (!isNonNeg(value.contactDamage)) return false;
  if (
    value.behavior !== 'chase' &&
    value.behavior !== 'shoot' &&
    value.behavior !== 'charge' &&
    value.behavior !== 'heavy' &&
    value.behavior !== 'boss'
  ) {
    return false;
  }
  if (value.attack !== undefined) {
    const attack = value.attack;
    if (!isRecord(attack) || !isNonNeg(attack.damage)) return false;
    if (attack.damageType !== 'physical' && attack.damageType !== 'magic') return false;
    if (attack.intervalSeconds !== undefined && !isPos(attack.intervalSeconds)) return false;
    if (attack.windupSeconds !== undefined && !isPos(attack.windupSeconds)) return false;
  }
  if (value.elite !== undefined && !isBool(value.elite)) return false;
  return true;
}

function isPlayer(value: unknown): value is PlayerWorldSnapshot {
  return (
    isRecord(value) &&
    isNum(value.x) &&
    isNum(value.y) &&
    isFacing(value.facing) &&
    isNonNeg(value.dodgeCooldownSeconds)
  );
}

function isWaveClock(value: unknown): value is WaveClockSnapshot {
  return (
    isRecord(value) &&
    isNonNeg(value.elapsedSeconds) &&
    isInt(value.nextNormalIndex) &&
    isBool(value.eliteSpawned) &&
    isBool(value.bossSpawned)
  );
}

function isEnemyUnit(value: unknown): value is EnemyUnitWorldSnapshot {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isEnemyDefinition(value.enemy) &&
    isNum(value.x) &&
    isNum(value.y) &&
    isNonNeg(value.health) &&
    isNonNeg(value.shield) &&
    isActivity(value.activity) &&
    isNonNeg(value.windupRemaining) &&
    isNonNeg(value.dashRemaining) &&
    isNum(value.dashX) &&
    isNum(value.dashY) &&
    isNonNeg(value.attackCooldown) &&
    isNonNeg(value.chargeCooldown) &&
    isNonNeg(value.avoidSeconds) &&
    (value.avoidSign === 1 || value.avoidSign === -1)
  );
}

function isTelegraph(value: unknown): value is EnemyTelegraphWorldSnapshot {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isEnemyDefinition(value.enemy) &&
    isNum(value.x) &&
    isNum(value.y) &&
    isNonNeg(value.remainingSeconds)
  );
}

function isEnemyProjectile(value: unknown): value is EnemyProjectileWorldSnapshot {
  return (
    isRecord(value) &&
    isInt(value.id, 1) &&
    isId(value.ownerId) &&
    isNonNeg(value.damage) &&
    isDamageType(value.damageType) &&
    isPos(value.radius) &&
    isNum(value.x) &&
    isNum(value.y) &&
    isNum(value.vx) &&
    isNum(value.vy) &&
    isNonNeg(value.remainingRange)
  );
}

function isBossBlast(value: unknown): value is BossBlastWorldSnapshot {
  return (
    isRecord(value) &&
    isInt(value.id, 1) &&
    isNum(value.x) &&
    isNum(value.y) &&
    isPos(value.radius) &&
    isNonNeg(value.damage) &&
    isDamageType(value.damageType) &&
    isNonNeg(value.remainingSeconds)
  );
}

function isBoss(value: unknown): value is BossWorldSnapshot {
  return (
    isRecord(value) &&
    (value.phase === 1 || value.phase === 2) &&
    isNonNeg(value.attackTimer) &&
    isInt(value.patternIndex) &&
    isActivity(value.activity) &&
    isNonNeg(value.windupRemaining) &&
    isNonNeg(value.dashRemaining) &&
    isNum(value.dashX) &&
    isNum(value.dashY) &&
    isNonNeg(value.summonTimer) &&
    isArrayOf(value.blasts, isBossBlast) &&
    isInt(value.nextBlastId, 1)
  );
}

function isEnemySystem(value: unknown): value is EnemySystemWorldSnapshot {
  return (
    isRecord(value) &&
    isNonNeg(value.elapsedSeconds) &&
    isNonNeg(value.contactCooldownSeconds) &&
    isInt(value.nextUnitId, 1) &&
    isInt(value.nextTelegraphId, 1) &&
    isInt(value.nextProjectileId, 1) &&
    isArrayOf(value.units, isEnemyUnit) &&
    isArrayOf(value.telegraphs, isTelegraph) &&
    isArrayOf(value.projectiles, isEnemyProjectile) &&
    (value.boss === null || isBoss(value.boss))
  );
}

function isPierce(value: unknown): value is ProjectilePierceWorldSnapshot {
  return (
    isRecord(value) &&
    isInt(value.extraTargets) &&
    isNum(value.subsequentDamageRatio) &&
    value.subsequentDamageRatio >= 0
  );
}

function isPlayerProjectile(value: unknown): value is PlayerProjectileWorldSnapshot {
  return (
    isRecord(value) &&
    isInt(value.id, 1) &&
    (value.source === 'J' || value.source === 'K') &&
    isNum(value.x) &&
    isNum(value.y) &&
    isNum(value.vx) &&
    isNum(value.vy) &&
    isPos(value.radius) &&
    isNonNeg(value.remainingRange) &&
    isAttack(value.attack) &&
    isNonNeg(value.damage) &&
    isDamageType(value.damageType) &&
    isFacing(value.facing) &&
    (value.pierce === null || isPierce(value.pierce)) &&
    isArrayOf(value.hitTargetIds, isId)
  );
}

function isTimedId(value: unknown): value is { targetId: string; remainingSeconds: number } {
  return isRecord(value) && isId(value.targetId) && isNonNeg(value.remainingSeconds);
}

function isSoul(value: unknown): value is SoulWorldSnapshot {
  return (
    isRecord(value) &&
    isNonNeg(value.cooldownSeconds) &&
    isNonNeg(value.elapsedSeconds) &&
    isInt(value.nextSoulId, 1) &&
    (value.maxSummonsOverride === null || isInt(value.maxSummonsOverride, 1)) &&
    isArrayOf(
      value.souls,
      (item): item is SoulWorldSnapshot['souls'][number] =>
        isRecord(item) &&
        isInt(item.id, 1) &&
        isNum(item.x) &&
        isNum(item.y) &&
        isNonNeg(item.remainingSeconds) &&
        isNonNeg(item.nextTickSeconds),
    ) &&
    isArrayOf(value.slows, isTimedId)
  );
}

function isGrenade(value: unknown): value is GrenadeWorldSnapshot {
  return (
    isRecord(value) &&
    isNonNeg(value.elapsedSeconds) &&
    isArrayOf(value.marks, isId) &&
    isArrayOf(value.stuns, isTimedId) &&
    isArrayOf(
      value.pending,
      (item): item is GrenadeWorldSnapshot['pending'][number] =>
        isRecord(item) &&
        isNonNeg(item.dueInSeconds) &&
        isNum(item.x) &&
        isNum(item.y) &&
        isNonNeg(item.damage) &&
        isDamageType(item.damageType) &&
        isPos(item.radius),
    )
  );
}

function isBurst(value: unknown): value is BurstWorldSnapshot {
  return (
    isRecord(value) &&
    isNonNeg(value.elapsedSeconds) &&
    isNonNeg(value.cooldownSeconds) &&
    isInt(value.ammo) &&
    isNonNeg(value.ammoRemainingSeconds) &&
    isInt(value.bonusShots) &&
    isNonNeg(value.lastShotRadiusBonus)
  );
}

function isAmiya(value: unknown): value is AmiyaWorldSnapshot {
  return (
    isRecord(value) &&
    isNonNeg(value.cooldownSeconds) &&
    isNonNeg(value.burstElapsedSeconds) &&
    isBool(value.burstActive) &&
    isInt(value.burstShotsFired) &&
    isNonNeg(value.fatigueSeconds) &&
    isNonNeg(value.chimeraCooldownSeconds) &&
    isNonNeg(value.chimeraRemainingSeconds) &&
    isNonNeg(value.weaknessRemainingSeconds) &&
    isInt(value.totalJHits) &&
    isArrayOf(value.countedProjectileIds, (item): item is number => isInt(item, 1)) &&
    isBool(value.followupPending) &&
    isNonNeg(value.followupRemainingSeconds)
  );
}

function isSaria(value: unknown): value is SariaWorldSnapshot {
  return (
    isRecord(value) &&
    isNonNeg(value.kCooldownSeconds) &&
    isNonNeg(value.lCooldownSeconds) &&
    isNonNeg(value.lActiveSeconds) &&
    isNonNeg(value.shieldRemainingSeconds) &&
    isInt(value.passiveTriggers) &&
    isNonNeg(value.shieldCounterCooldownRemaining) &&
    isInt(value.fieldHealCount) &&
    isBool(value.fieldHealTickHadHealing) &&
    isNonNeg(value.fieldDamageAccumulator) &&
    isNonNeg(value.fieldHealAccumulator)
  );
}

function isMuelsyse(value: unknown): value is MuelsyseWorldSnapshot {
  return (
    isRecord(value) &&
    (value.form === 'melee' || value.form === 'ranged') &&
    isNum(value.x) &&
    isNum(value.y) &&
    isNonNeg(value.health) &&
    isInt(value.stacks) &&
    isFacing(value.facing) &&
    isNonNeg(value.kCooldownSeconds) &&
    isNonNeg(value.lCooldownSeconds) &&
    isNonNeg(value.lRemainingSeconds) &&
    isNonNeg(value.nextPullAtSeconds) &&
    isNonNeg(value.attackCooldownSeconds) &&
    isNonNeg(value.avoidSeconds) &&
    (value.avoidSign === 1 || value.avoidSign === -1) &&
    isArrayOf(
      value.copies,
      (item): item is MuelsyseCopyWorldSnapshot =>
        isRecord(item) &&
        isId(item.id) &&
        isInt(item.slot) &&
        isNum(item.x) &&
        isNum(item.y) &&
        isNonNeg(item.remainingSeconds) &&
        isNonNeg(item.attackCooldownSeconds),
    ) &&
    isInt(value.nextCopyId, 1) &&
    isInt(value.rangedAttacksSinceCopy) &&
    isNonNeg(value.waterMirrorCooldownRemaining) &&
    isNonNeg(value.healAccumulatorSeconds) &&
    isArrayOf(
      value.controls,
      (item): item is MuelsyseControlWorldSnapshot =>
        isRecord(item) &&
        isId(item.targetId) &&
        isNonNeg(item.stun) &&
        isNonNeg(item.root) &&
        isNonNeg(item.slow),
    )
  );
}

function isEffects(value: unknown): value is UpgradeEffectsWorldSnapshot {
  return (
    isRecord(value) &&
    isNonNeg(value.echoRemainingSeconds) &&
    isNonNeg(value.elapsedSeconds) &&
    isInt(value.kKillProgress) &&
    isInt(value.lKillProgress) &&
    isArrayOf(value.slows, isTimedId)
  );
}

/**
 * 校验并返回世界快照；任何字段不合法都返回 null。
 * 只在读写边界调用，避免损坏存档把异常状态送进规则模块。
 */
export function validateWorldSnapshot(value: unknown): RunWorldSnapshot | null {
  if (!isRecord(value)) return null;
  if (!isPlayer(value.player)) return null;
  if (!isNonNeg(value.attackCooldownSeconds)) return null;
  if (!isWaveClock(value.wave)) return null;
  if (!isEnemySystem(value.enemies)) return null;
  if (!isArrayOf(value.projectiles, isPlayerProjectile)) return null;
  if (!isInt(value.nextProjectileId, 1)) return null;
  if (!isNonNeg(value.simulatedSeconds)) return null;
  if (value.souls !== null && !isSoul(value.souls)) return null;
  if (value.grenade !== null && !isGrenade(value.grenade)) return null;
  if (value.burst !== null && !isBurst(value.burst)) return null;
  if (value.amiya !== null && !isAmiya(value.amiya)) return null;
  if (value.saria !== null && !isSaria(value.saria)) return null;
  if (value.muelsyse !== null && !isMuelsyse(value.muelsyse)) return null;
  if (!isEffects(value.effects)) return null;
  return value as unknown as RunWorldSnapshot;
}
