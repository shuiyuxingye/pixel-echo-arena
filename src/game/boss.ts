/**
 * Boss「失控实验体」行为（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/game-design.md` §7：
 * - 基础 2600 HP、护甲 20、法抗 15%（数值在 `src/game/data/enemies.ts`）；
 * - 扇形弹幕与地面延迟爆破交替，弹幕始终保留一个可走位缺口；
 * - 地面危险预警 ≥ 0.7 秒；
 * - 生命低于 50% 进入二阶段，增加预警冲锋与每 15 秒召唤 4 个追击者；
 * - 不复制新的 Boss。
 *
 * 文档未给出的射速、伤害与半径集中在本文件，只用于让攻击可躲、可读，
 * 不改变 §7 的生命、护甲与法抗基线。
 */
import type { DamageType, EnemyId } from './data';
import type { BossWorldSnapshot } from './world-snapshot';

/** Boss 碰撞半径；比普通敌人更大，避免贴身时与视觉脱节。 */
export const BOSS_RADIUS = 30;

/** 进入二阶段的生命比例阈值：严格低于 50%。 */
export const BOSS_PHASE_THRESHOLD = 0.5;

/** 首次攻击前的准备时间。 */
export const BOSS_FIRST_ATTACK_DELAY_SECONDS = 1.2;

/** 同一种攻击之间的间隔；阶段切换不会清空该计时。 */
export const BOSS_ATTACK_INTERVAL_SECONDS = 2.4;

/** 扇形弹幕参数：-60° 到 +60° 共 9 个槽位，中间槽位留空形成 30° 缺口。 */
export const BOSS_FAN_ARC_DEGREES = 120;
export const BOSS_FAN_SLOTS = 9;
export const BOSS_FAN_GAP_INDEX = 4;
export const BOSS_FAN_DAMAGE = 12;
export const BOSS_FAN_DAMAGE_TYPE: DamageType = 'magic';
export const BOSS_FAN_PROJECTILE_SPEED = 240;
export const BOSS_FAN_PROJECTILE_RADIUS = 7;
export const BOSS_FAN_PROJECTILE_RANGE = 700;

/** 地面延迟爆破：以玩家当前位置为基准布置 3 个预警圈。 */
export const BOSS_BLAST_COUNT = 3;
export const BOSS_BLAST_WARNING_SECONDS = 0.9;
export const BOSS_BLAST_RADIUS = 55;
export const BOSS_BLAST_SPREAD = 70;
export const BOSS_BLAST_DAMAGE = 20;
export const BOSS_BLAST_DAMAGE_TYPE: DamageType = 'magic';

/** 二阶段预警冲锋：0.9 秒前摇后沿锁定方向冲刺 0.45 秒。 */
export const BOSS_CHARGE_WINDUP_SECONDS = 0.9;
export const BOSS_CHARGE_DASH_SECONDS = 0.45;
export const BOSS_CHARGE_SPEED = 360;
export const BOSS_CHARGE_DAMAGE = 24;
export const BOSS_CHARGE_DAMAGE_TYPE: DamageType = 'physical';

/** 二阶段召唤：每 15 秒召唤 4 个追击者。 */
export const BOSS_SUMMON_INTERVAL_SECONDS = 15;
export const BOSS_SUMMON_COUNT = 4;
export const BOSS_SUMMON_ENEMY_ID: EnemyId = 'chaser';

const TIME_EPSILON = 1e-9;
const DEG_TO_RAD = Math.PI / 180;

export interface BossPoint {
  readonly x: number;
  readonly y: number;
}

export interface BossHealthSnapshot {
  readonly health: number;
  readonly maxHealth: number;
}

export interface BossStepContext {
  readonly boss: BossPoint & BossHealthSnapshot;
  readonly player: BossPoint;
}

export interface BossFanShot {
  /** 世界坐标角度（弧度）。 */
  readonly angle: number;
  readonly damage: number;
  readonly damageType: DamageType;
  readonly speed: number;
  readonly radius: number;
  readonly range: number;
}

export interface BossFanVolley {
  readonly origin: BossPoint;
  readonly centerAngle: number;
  /** 已剔除缺口槽位后的实际弹丸。 */
  readonly shots: readonly BossFanShot[];
  /** 槽位之间的角度间隔，供验收缺口宽度。 */
  readonly slotAngleDegrees: number;
  /** 被留空的槽位相对中心的角度（弧度）。 */
  readonly gapCenterAngle: number;
}

export interface BossBlast {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly damage: number;
  readonly damageType: DamageType;
  remainingSeconds: number;
}

export interface BossExplosion {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly damage: number;
  readonly damageType: DamageType;
}

export interface BossSummonEvent {
  readonly enemyId: EnemyId;
  readonly count: number;
}

export type BossActivity = 'idle' | 'windup' | 'dash';

export interface BossStepResult {
  readonly fanVolleys: readonly BossFanVolley[];
  readonly explosions: readonly BossExplosion[];
  readonly summons: readonly BossSummonEvent[];
  /** 冲刺中的单位方向；非冲刺阶段为 null。 */
  readonly dashVector: BossPoint | null;
  readonly enteredPhase2: boolean;
}

/**
 * 生成一次扇形弹幕。槽位角度对称铺满弧线，缺口槽位不产生弹丸，
 * 因此玩家总能从缺口穿过；缺口角度由槽位间隔决定（15° × 2 = 30°）。
 */
export function buildBossFanVolley(origin: BossPoint, centerAngle: number): BossFanVolley {
  const stepDegrees = BOSS_FAN_ARC_DEGREES / (BOSS_FAN_SLOTS - 1);
  const startDegrees = -BOSS_FAN_ARC_DEGREES / 2;
  const shots: BossFanShot[] = [];

  for (let slot = 0; slot < BOSS_FAN_SLOTS; slot += 1) {
    if (slot === BOSS_FAN_GAP_INDEX) continue;
    const angle = centerAngle + (startDegrees + slot * stepDegrees) * DEG_TO_RAD;
    shots.push({
      angle,
      damage: BOSS_FAN_DAMAGE,
      damageType: BOSS_FAN_DAMAGE_TYPE,
      speed: BOSS_FAN_PROJECTILE_SPEED,
      radius: BOSS_FAN_PROJECTILE_RADIUS,
      range: BOSS_FAN_PROJECTILE_RANGE,
    });
  }

  return {
    origin,
    centerAngle,
    shots,
    slotAngleDegrees: stepDegrees,
    gapCenterAngle: centerAngle + (startDegrees + BOSS_FAN_GAP_INDEX * stepDegrees) * DEG_TO_RAD,
  };
}

/**
 * Boss 行为控制器：由 `EnemySystem` 持有并每逻辑步推进。
 * 输出可直接渲染/结算的事件，场景不自行计算攻击节奏。
 */
export class BossCombat {
  private phaseValue: 1 | 2 = 1;
  private attackTimer = BOSS_FIRST_ATTACK_DELAY_SECONDS;
  private patternIndex = 0;
  private activityValue: BossActivity = 'idle';
  private windupRemainingValue = 0;
  private dashRemainingValue = 0;
  private dashX = 0;
  private dashY = 0;
  private summonTimer = BOSS_SUMMON_INTERVAL_SECONDS;
  private blastsList: BossBlast[] = [];
  private nextBlastId = 1;

  get phase(): 1 | 2 {
    return this.phaseValue;
  }

  get activity(): BossActivity {
    return this.activityValue;
  }

  get windupRemaining(): number {
    return this.windupRemainingValue;
  }

  get dashRemaining(): number {
    return this.dashRemainingValue;
  }

  get summonRemainingSeconds(): number {
    return this.summonTimer;
  }

  /** 当前仍处于预警中的地面爆破，供场景渲染；返回只读副本。 */
  get blasts(): readonly BossBlast[] {
    return this.blastsList;
  }

  /** 胜利清场：移除尚未落地的地面预警，不再结算。 */
  clearBlasts(): void {
    this.blastsList = [];
  }

  /** 波中快照：阶段、攻击节奏、冲锋与地面爆破预警。 */
  snapshotWorld(): BossWorldSnapshot {
    return {
      phase: this.phaseValue,
      attackTimer: this.attackTimer,
      patternIndex: this.patternIndex,
      activity: this.activityValue,
      windupRemaining: this.windupRemainingValue,
      dashRemaining: this.dashRemainingValue,
      dashX: this.dashX,
      dashY: this.dashY,
      summonTimer: this.summonTimer,
      blasts: this.blastsList.map((blast) => ({ ...blast })),
      nextBlastId: this.nextBlastId,
    };
  }

  /** 从波中快照恢复；非法数值钳制为非负，阶段只接受 1/2。 */
  restoreWorld(state: BossWorldSnapshot): void {
    this.phaseValue = state.phase === 2 ? 2 : 1;
    this.attackTimer = nonNegative(state.attackTimer);
    this.patternIndex = Number.isInteger(state.patternIndex)
      ? Math.max(0, state.patternIndex)
      : 0;
    this.activityValue = state.activity;
    this.windupRemainingValue = nonNegative(state.windupRemaining);
    this.dashRemainingValue = nonNegative(state.dashRemaining);
    this.dashX = Number.isFinite(state.dashX) ? state.dashX : 0;
    this.dashY = Number.isFinite(state.dashY) ? state.dashY : 0;
    this.summonTimer = nonNegative(state.summonTimer);
    this.blastsList = state.blasts.map((blast) => ({
      id: blast.id,
      x: blast.x,
      y: blast.y,
      radius: blast.radius,
      damage: blast.damage,
      damageType: blast.damageType,
      remainingSeconds: blast.remainingSeconds,
    }));
    this.nextBlastId = Number.isInteger(state.nextBlastId)
      ? Math.max(1, state.nextBlastId)
      : 1;
  }

  /** 下一次攻击是否已经就绪，便于 HUD 提示。 */
  get attackReady(): boolean {
    return this.attackTimer <= TIME_EPSILON && this.activityValue === 'idle';
  }

  step(stepSeconds: number, context: BossStepContext): BossStepResult {
    const empty: BossStepResult = {
      fanVolleys: [],
      explosions: [],
      summons: [],
      dashVector: null,
      enteredPhase2: false,
    };
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) return empty;

    const enteredPhase2 = this.updatePhase(context);
    const summons = enteredPhase2 ? [] : this.stepSummons(stepSeconds);
    // 刚进入二阶段的那一步不立即递减召唤计时，首次召唤严格发生在 15 秒后。
    if (enteredPhase2) this.summonTimer = BOSS_SUMMON_INTERVAL_SECONDS;
    const explosions = this.stepBlasts(stepSeconds);

    if (this.activityValue === 'windup') {
      this.windupRemainingValue = decay(this.windupRemainingValue, stepSeconds);
      if (this.windupRemainingValue <= TIME_EPSILON) {
        const dx = context.player.x - context.boss.x;
        const dy = context.player.y - context.boss.y;
        const length = Math.hypot(dx, dy);
        this.dashX = length > TIME_EPSILON ? dx / length : 1;
        this.dashY = length > TIME_EPSILON ? dy / length : 0;
        this.activityValue = 'dash';
        this.dashRemainingValue = BOSS_CHARGE_DASH_SECONDS;
      }
      return { ...empty, explosions, summons, enteredPhase2 };
    }

    if (this.activityValue === 'dash') {
      this.dashRemainingValue = decay(this.dashRemainingValue, stepSeconds);
      if (this.dashRemainingValue <= TIME_EPSILON) {
        this.activityValue = 'idle';
        this.attackTimer = BOSS_ATTACK_INTERVAL_SECONDS;
        return { ...empty, explosions, summons, enteredPhase2 };
      }
      return {
        ...empty,
        explosions,
        summons,
        enteredPhase2,
        dashVector: { x: this.dashX, y: this.dashY },
      };
    }

    const fanVolleys: BossFanVolley[] = [];
    this.attackTimer = decay(this.attackTimer, stepSeconds);
    if (this.attackTimer <= TIME_EPSILON) {
      const pattern = this.nextPattern();
      this.patternIndex += 1;
      if (pattern === 'charge') {
        this.activityValue = 'windup';
        this.windupRemainingValue = BOSS_CHARGE_WINDUP_SECONDS;
      } else if (pattern === 'fan') {
        const centerAngle = Math.atan2(
          context.player.y - context.boss.y,
          context.player.x - context.boss.x,
        );
        fanVolleys.push(buildBossFanVolley({ x: context.boss.x, y: context.boss.y }, centerAngle));
        this.attackTimer = BOSS_ATTACK_INTERVAL_SECONDS;
      } else {
        this.createBlasts(context.boss, context.player);
        this.attackTimer = BOSS_ATTACK_INTERVAL_SECONDS;
      }
    }

    return {
      ...empty,
      fanVolleys,
      explosions,
      summons,
      enteredPhase2,
    };
  }

  /** 阈值严格低于 50% 才进入二阶段；一旦进入不会回退。 */
  private updatePhase(context: BossStepContext): boolean {
    if (this.phaseValue === 2) return false;
    const maxHealth = Math.max(1, context.boss.maxHealth);
    if (context.boss.health / maxHealth < BOSS_PHASE_THRESHOLD) {
      this.phaseValue = 2;
      this.summonTimer = BOSS_SUMMON_INTERVAL_SECONDS;
      return true;
    }
    return false;
  }

  /** 二阶段每满 15 秒产生一次召唤；一次大步长可结算多次。 */
  private stepSummons(stepSeconds: number): BossSummonEvent[] {
    if (this.phaseValue !== 2) return [];
    const summons: BossSummonEvent[] = [];
    this.summonTimer -= stepSeconds;
    while (this.summonTimer <= TIME_EPSILON) {
      summons.push({ enemyId: BOSS_SUMMON_ENEMY_ID, count: BOSS_SUMMON_COUNT });
      this.summonTimer += BOSS_SUMMON_INTERVAL_SECONDS;
    }
    return summons;
  }

  private stepBlasts(stepSeconds: number): BossExplosion[] {
    if (this.blastsList.length === 0) return [];
    const explosions: BossExplosion[] = [];
    const survivors: BossBlast[] = [];
    for (const blast of this.blastsList) {
      blast.remainingSeconds = decay(blast.remainingSeconds, stepSeconds);
      if (blast.remainingSeconds <= TIME_EPSILON) {
        explosions.push({
          id: blast.id,
          x: blast.x,
          y: blast.y,
          radius: blast.radius,
          damage: blast.damage,
          damageType: blast.damageType,
        });
      } else {
        survivors.push(blast);
      }
    }
    this.blastsList = survivors;
    return explosions;
  }

  /** 以玩家当前位置为中心，沿垂直于 Boss→玩家连线的方向铺开 3 个预警圈。 */
  private createBlasts(boss: BossPoint, player: BossPoint): BossBlast[] {
    const dx = player.x - boss.x;
    const dy = player.y - boss.y;
    const length = Math.hypot(dx, dy);
    // 垂直于瞄准线；Boss 与玩家重合时退化为水平方向，保证分布确定。
    const perpX = length > TIME_EPSILON ? -dy / length : 1;
    const perpY = length > TIME_EPSILON ? dx / length : 0;
    const blasts: BossBlast[] = [];
    for (let index = 0; index < BOSS_BLAST_COUNT; index += 1) {
      const offset = index - (BOSS_BLAST_COUNT - 1) / 2;
      blasts.push({
        id: this.nextBlastId,
        x: player.x + perpX * offset * BOSS_BLAST_SPREAD,
        y: player.y + perpY * offset * BOSS_BLAST_SPREAD,
        radius: BOSS_BLAST_RADIUS,
        damage: BOSS_BLAST_DAMAGE,
        damageType: BOSS_BLAST_DAMAGE_TYPE,
        remainingSeconds: BOSS_BLAST_WARNING_SECONDS,
      });
      this.nextBlastId += 1;
    }
    this.blastsList.push(...blasts);
    return blasts;
  }

  /** 一阶段：弹幕 → 爆破循环；二阶段：弹幕 → 爆破 → 冲锋循环。 */
  private nextPattern(): 'fan' | 'blast' | 'charge' {
    if (this.phaseValue === 2) {
      const cycle = this.patternIndex % 3;
      return cycle === 0 ? 'fan' : cycle === 1 ? 'blast' : 'charge';
    }
    return this.patternIndex % 2 === 0 ? 'fan' : 'blast';
  }
}

function decay(value: number, seconds: number): number {
  const next = value - seconds;
  return next <= TIME_EPSILON ? 0 : next;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
