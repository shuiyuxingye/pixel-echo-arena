/**
 * Boss「裂隙炉王」行为（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §普通怪与最终Boss：
 * - 基础 12000 HP、护甲 20、法抗 15%（数值在 `src/game/data/enemies.ts`）；
 * - 第一阶段：扇形弹幕与锤击交替，弹幕始终保留一个可走位缺口；
 * - 半血后进入二阶段：加入横向冲锋，并每 20 秒产生一组 4 只增援；
 * - 弹体/锤击/冲锋基础伤害 18/35/28，锤击与冲锋预警均 ≥ 0.8 秒；
 * - 控制（眩晕/束缚）不冻结 Boss，只转换为减速，避免被无限控制锁死；
 * - 不复制新的 Boss，也不能靠超时跳过。
 *
 * 文档未给出的射速、半径与预警形状集中在本文件，只用于让攻击可躲、可读，
 * 不改变生命、护甲、法抗与三档伤害基线。
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
/** 弹体基础伤害 18（01 §普通怪与最终Boss）。 */
export const BOSS_FAN_DAMAGE = 18;
export const BOSS_FAN_DAMAGE_TYPE: DamageType = 'magic';
export const BOSS_FAN_PROJECTILE_SPEED = 240;
export const BOSS_FAN_PROJECTILE_RADIUS = 7;
export const BOSS_FAN_PROJECTILE_RANGE = 700;

/**
 * 锤击：在玩家当前位置落下一个大范围预警圈，0.9 秒后砸落。
 * 预警时间高于规则下限 0.8 秒，伤害取 35 物伤。
 */
export const BOSS_HAMMER_WARNING_SECONDS = 0.9;
export const BOSS_HAMMER_RADIUS = 80;
export const BOSS_HAMMER_DAMAGE = 35;
export const BOSS_HAMMER_DAMAGE_TYPE: DamageType = 'physical';

/** 二阶段横向冲锋：0.9 秒前摇后沿水平方向冲刺，接触 28 物伤。 */
export const BOSS_CHARGE_WINDUP_SECONDS = 0.9;
export const BOSS_CHARGE_DASH_SECONDS = 1.2;
export const BOSS_CHARGE_SPEED = 480;
export const BOSS_CHARGE_DAMAGE = 28;
export const BOSS_CHARGE_DAMAGE_TYPE: DamageType = 'physical';

/** 二阶段增援：每 20 秒一组 4 只，场上最多 8 只，不给金币/经验。 */
export const BOSS_SUMMON_INTERVAL_SECONDS = 20;
export const BOSS_SUMMON_COUNT = 4;
export const BOSS_SUMMON_MAX_ALIVE = 8;
export const BOSS_SUMMON_ENEMY_ID: EnemyId = 'blob';

/**
 * 控制转减速：Boss 免疫眩晕/束缚，只按该倍率降低冲锋移动速度。
 * 与缪尔赛思的 Boss 控制转换共用同一数值。
 */
export const BOSS_CONTROL_SLOW_MULTIPLIER = 0.5;

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

/** 锤击落点预警；持久化字段仍沿用 `blasts` 以兼容既有续局快照。 */
export interface BossBlast {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly damage: number;
  readonly damageType: DamageType;
  remainingSeconds: number;
}

/** 锤击落地的结算结果；`id` 与对应预警圈相同。 */
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
        // 横向冲锋：只沿水平方向冲刺，朝玩家所在的一侧；预警期间仍可走位躲开。
        this.dashX = context.player.x >= context.boss.x ? 1 : -1;
        this.dashY = 0;
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
        this.createHammerStrike(context.player);
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

  /**
   * 锤击落点：以玩家当前位置为中心的单个大范围预警圈。
   * 预警与落地共用同一个 `id`，0.9 秒后按范围与通视结算 35 物伤。
   */
  private createHammerStrike(player: BossPoint): BossBlast[] {
    const strike: BossBlast = {
      id: this.nextBlastId,
      x: player.x,
      y: player.y,
      radius: BOSS_HAMMER_RADIUS,
      damage: BOSS_HAMMER_DAMAGE,
      damageType: BOSS_HAMMER_DAMAGE_TYPE,
      remainingSeconds: BOSS_HAMMER_WARNING_SECONDS,
    };
    this.nextBlastId += 1;
    this.blastsList.push(strike);
    return [strike];
  }

  /** 一阶段：弹幕 → 锤击循环；二阶段：弹幕 → 锤击 → 横向冲锋循环。 */
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
