/**
 * 缪尔赛思主流形规则（纯逻辑，不依赖 Phaser）。
 *
 * - 初始自带一个近战流形；同一时刻只有一个主流形。
 * - K「塑形」：冷却 6 秒，在近战/远程流形间切换；切换保留生命百分比，
 *   不刷新 L 或治疗。流形死亡后 K 改为重建当前形态，重建后才开始 6 秒冷却。
 * - 近战流形：90 生命，攻击 90 范围内最近敌人，每 0.7 秒 16 物伤；
 *   每次命中使自身伤害 +2、护甲 +2，最多 5 层，重建清零。
 * - 远程流形：60 生命，射程 230，每 0.8 秒 14 法伤；每 8 次攻击生成一个
 *   持续 5 秒、伤害为主流形 50% 的副本，默认最多 1 个。
 * - L「浅层非熵适应」：冷却 24 秒、持续 6 秒。近战形态每 2 秒将半径 100 内
 *   普通敌人向主流形拉近 35 并眩晕 0.5 秒；远程形态立即刷新副本寿命，
 *   主流形与副本命中束缚 0.5 秒。无主流形时不消耗冷却。
 * - Boss 免疫强制位移；眩晕/束缚转为原持续时间 30% 的减速。
 * - 跟随玩家；距离玩家超过 240 时回到身边最近空位，不穿墙、不卡墙。
 *   跟随移动复用 arena 的圆形碰撞与通视切向绕行原语，不另建寻路。
 * - 切换至近战、重建或流形死亡时清除远程副本，反复切换不会累积。
 * - 专属强化 M01–M04（`docs/game-design.md` §6.3）：副本/窃取上限、主流形回复、
 *   拉拽范围与束缚时间、玩家 J 命中后的主流形补攻。
 *
 * 数值来自 `src/game/data/characters.ts` 与 `docs/game-design.md` §5.4。
 */
import {
  hasLineOfSight,
  isCircleBlocked,
  moveCircleWithCollision,
  type ArenaLayout,
} from './arena';
import {
  computeDamage,
  distanceSquared,
  type Combatant,
  type CombatPoint,
  type DamageResult,
} from './combat';
import { requireUpgradeParam, type DamageType } from './data';
import { FACING_LIST, facingFromVector, type Facing } from './movement';
import type { MuelsyseWorldSnapshot } from './world-snapshot';

/** 距离玩家超过该值即回到身边空位（docs/game-design.md §5.4）。 */
export const MUELSYSE_RETURN_DISTANCE = 240;
/** 默认跟随站位距玩家 52 像素，稳定跟在左后方。 */
export const MUELSYSE_FOLLOW_DISTANCE = 52;
/** 跟随移动速度（逻辑像素/秒）；高于玩家 165，保证不掉队。 */
export const MUELSYSE_FOLLOW_SPEED = 240;
/** 流形碰撞半径；与玩家一致，不按 Q 版轮廓扩大。 */
export const MUELSYSE_FORM_RADIUS = 12;
/** 远程副本的碰撞半径；表现比主流形略小。 */
export const MUELSYSE_COPY_RADIUS = 10;
/** Boss 的眩晕/束缚转为减速后，持续时间相对于原值的比例。 */
export const BOSS_CONTROL_DURATION_RATIO = 0.3;
/** Boss 控制转减速后的移速倍率（50% 减速）。 */
export const BOSS_CONTROL_SLOW_MULTIPLIER = 0.5;
/** 远程副本的默认站位偏移（相对主流形）。 */
const COPY_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-38, 16],
  [38, 16],
  [0, -42],
];

/** M01 双生流形：远程副本上限与近战攻击窃取层数上限。 */
export const M01_RANGED_MAX_COPIES = Math.max(
  0,
  Math.floor(requireUpgradeParam('M01', 'rangedMaxCopies')),
);
export const M01_MELEE_MAX_STACKS = Math.max(
  0,
  Math.floor(requireUpgradeParam('M01', 'meleeMaxStacks')),
);

/** M02 生态复苏：主流形每秒回复最大生命的比例与 L 开启时的即时回复比例。 */
export const M02_HEAL_PERCENT_PER_SECOND = requireUpgradeParam(
  'M02',
  'healPercentPerSecond',
);
export const M02_HEAL_ON_ACTIVATE_PERCENT = requireUpgradeParam(
  'M02',
  'healOnActivatePercent',
);

/** M03 聚合涡旋：近战 L 拉拽范围加成与远程 L 束缚时间加成。 */
export const M03_PULL_RANGE_BONUS = requireUpgradeParam('M03', 'pullRangeBonus');
export const M03_ROOT_BONUS_SECONDS = requireUpgradeParam('M03', 'rootBonusSeconds');

/** M04 水镜共鸣：补攻伤害比例与内置冷却。 */
export const M04_DAMAGE_RATIO = requireUpgradeParam('M04', 'damageRatio');
export const M04_INTERNAL_COOLDOWN_SECONDS = requireUpgradeParam(
  'M04',
  'internalCooldownSeconds',
);
/** 被掩体遮断时的绕行持续时间。 */
const AVOID_SECONDS = 0.5;
const TIME_EPSILON = 1e-9;

export type StreamForm = 'melee' | 'ranged';

/** 远程副本的生成与寿命参数（docs/game-design.md §5.4）。 */
export interface MuelsyseCopyConfig {
  /** 主流形每多少次远程攻击生成一个副本。 */
  readonly everyAttacks: number;
  readonly durationSeconds: number;
  /** 副本伤害相对主流形远程伤害的比例。 */
  readonly damageRatio: number;
  readonly maxCopies: number;
}

/** L「浅层非熵适应」参数（docs/game-design.md §5.4）。 */
export interface MuelsyseShallowAdaptationConfig {
  readonly cooldownSeconds: number;
  readonly durationSeconds: number;
  readonly pullIntervalSeconds: number;
  readonly pullRadius: number;
  readonly pullDistance: number;
  readonly stunSeconds: number;
  readonly rootSeconds: number;
  /** Boss 控制转换比例；缺省 30%。 */
  readonly bossControlDurationRatio?: number;
  /** Boss 控制转减速后的移速倍率；缺省 0.5。 */
  readonly bossSlowMultiplier?: number;
}

export interface MuelsyseFormConfig {
  readonly maxHealth: number;
  readonly attackRange: number;
  readonly attackIntervalSeconds: number;
  readonly damage: number;
  readonly damageType: DamageType;
}

/** 近战流形额外的攻击窃取层数参数。 */
export interface MuelsyseMeleeFormConfig extends MuelsyseFormConfig {
  readonly stackDamagePerHit: number;
  readonly stackArmorPerHit: number;
  readonly maxStacks: number;
}

export interface MuelsyseCombatConfig {
  readonly switchCooldownSeconds: number;
  readonly melee: MuelsyseMeleeFormConfig;
  readonly ranged: MuelsyseFormConfig;
  readonly copies: MuelsyseCopyConfig;
  readonly shallowAdaptation: MuelsyseShallowAdaptationConfig;
  readonly layout: ArenaLayout;
  /** 玩家出生位置；流形初始站在其左侧空位。 */
  readonly startX: number;
  readonly startY: number;
  readonly formRadius?: number;
  readonly followDistance?: number;
  readonly followSpeed?: number;
  readonly returnDistance?: number;
}

export interface ShapeShiftResult {
  readonly action: 'switch' | 'rebuild';
  readonly previousForm: StreamForm;
  readonly form: StreamForm;
  readonly health: number;
  readonly maxHealth: number;
  /** 切换后保留的生命百分比。 */
  readonly healthPercent: number;
}

/** L 启动结果：无主流形/冷却中都不消耗冷却。 */
export type ShallowAdaptationResult =
  | {
      readonly activated: true;
      readonly form: StreamForm;
      /** 远程形态立即刷新的副本数量。 */
      readonly refreshedCopies: number;
    }
  | {
      readonly activated: false;
      readonly reason: 'no-form' | 'cooldown';
    };

/** 远程副本的只读快照；场景据此创建/回收视觉。 */
export interface MuelsyseCopySnapshot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly remainingSeconds: number;
}

/** 主流形或副本一次自动攻击的结算结果；场景据此播放表现与击杀。 */
export interface MuelsyseAttackEvent {
  readonly targetId: string;
  readonly result: DamageResult;
  readonly form: StreamForm;
  /** 攻击来源：主流形或远程副本。 */
  readonly source: 'form' | 'copy';
  readonly copyId?: string;
  readonly damageType: DamageType;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  /** 本次命中施加的控制；Boss 已转换为减速。 */
  readonly control?: 'stun' | 'root' | 'slow';
}

/** 近战 L 的一次拉拽；场景负责把敌人移向主流形并显示表现。 */
export interface MuelsysePullEvent {
  readonly targetId: string;
  readonly fromX: number;
  readonly fromY: number;
  readonly towardX: number;
  readonly towardY: number;
  readonly distance: number;
  readonly stunSeconds: number;
}

export interface MuelsyseStepContext {
  readonly player: CombatPoint;
  readonly targets: readonly Combatant[];
  /** G01 等全局伤害倍率；只作用于本次攻击。 */
  readonly damageMultiplier?: number;
  /** 目标是否为 Boss；Boss 的眩晕/束缚转为减速且免疫拉拽。 */
  readonly isBoss?: (targetId: string) => boolean;
}

export interface MuelsyseStepResult {
  readonly attacks: readonly MuelsyseAttackEvent[];
  /** 本步触发的近战 L 拉拽（每 2 秒一批）。 */
  readonly pulls: readonly MuelsysePullEvent[];
  /** 本步新生成的副本数量。 */
  readonly spawnedCopies: number;
  /** 本步是否因超过 240 距离而回到玩家身边。 */
  readonly teleported: boolean;
  /** 本步是否发生了跟随位移。 */
  readonly moved: boolean;
  /** 本步 M02 生态复苏为主流形回复的生命；未拥有或满血为 0。 */
  readonly formHealed: number;
}

/** 内部副本状态。 */
interface CopyState {
  readonly id: string;
  readonly slot: number;
  x: number;
  y: number;
  remainingSeconds: number;
  attackCooldownSeconds: number;
}

/** 每个目标身上的控制计时；按逻辑步衰减。 */
interface ControlState {
  stun: number;
  root: number;
  slow: number;
}

/**
 * 在玩家周围寻找最近的可站立空位。
 * 优先左、右、上、下与四个斜角；全部被挡时退回玩家位置。
 */
export function resolveFormReturnPoint(
  layout: ArenaLayout,
  player: CombatPoint,
  radius = MUELSYSE_FORM_RADIUS,
  preferredDistance = MUELSYSE_FOLLOW_DISTANCE,
): CombatPoint {
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-Math.SQRT1_2, -Math.SQRT1_2],
    [Math.SQRT1_2, -Math.SQRT1_2],
    [-Math.SQRT1_2, Math.SQRT1_2],
    [Math.SQRT1_2, Math.SQRT1_2],
  ];
  for (const distance of [preferredDistance, preferredDistance + 16, preferredDistance + 32]) {
    for (const [dx, dy] of offsets) {
      const x = player.x + dx * distance;
      const y = player.y + dy * distance;
      if (!isCircleBlocked(layout, x, y, radius)) return { x, y };
    }
  }
  return { x: player.x, y: player.y };
}

/** 跟随站位：玩家左后方的稳定空位；被墙/掩体挡住时换到其他方向。 */
export function resolveFollowPoint(
  layout: ArenaLayout,
  player: CombatPoint,
  radius = MUELSYSE_FORM_RADIUS,
  followDistance = MUELSYSE_FOLLOW_DISTANCE,
): CombatPoint {
  return resolveFormReturnPoint(layout, player, radius, followDistance);
}

/**
 * 缪尔赛思的主形状态：形态切换、生命百分比、近战窃取层数与跟随。
 * 场景每个固定逻辑步调用一次 `step`，渲染帧率不影响任何计时。
 */
export class MuelsyseCombat {
  private readonly config: MuelsyseCombatConfig;
  private readonly layout: ArenaLayout;
  private readonly radius: number;
  private readonly followDistance: number;
  private readonly followSpeed: number;
  private readonly returnDistance: number;

  private formType: StreamForm = 'melee';
  private x: number;
  private y: number;
  private health: number;
  private stacks = 0;
  private facingValue: Facing = 'east';
  private kCooldownSeconds = 0;
  private lCooldownSeconds = 0;
  private lRemainingSeconds = 0;
  private lActiveThisStep = false;
  private nextPullAtSeconds = 0;
  private cooldownMultiplier = 1;
  private attackCooldownSeconds = 0;
  private avoidSeconds = 0;
  private avoidSign: 1 | -1 = 1;
  private copiesValue: CopyState[] = [];
  private nextCopyId = 1;
  private rangedAttacksSinceCopy = 0;
  // 专属强化 M01–M04 的实效；0/null 表示未拥有。
  private maxCopiesOverride: number | null = null;
  private maxMeleeStacksOverride: number | null = null;
  private healPercentPerSecondValue = 0;
  private healOnActivatePercentValue = 0;
  private healAccumulatorSeconds = 0;
  private pullRangeBonusValue = 0;
  private rootBonusSecondsValue = 0;
  private waterMirrorDamageRatioValue = 0;
  private waterMirrorCooldownSecondsValue = 0;
  private waterMirrorCooldownRemaining = 0;
  private readonly controls = new Map<string, ControlState>();

  constructor(config: MuelsyseCombatConfig) {
    if (
      !(config.switchCooldownSeconds > 0) ||
      !Number.isFinite(config.switchCooldownSeconds)
    ) {
      throw new Error('MuelsyseCombat requires a positive switchCooldownSeconds');
    }
    validateForm('melee', config.melee);
    validateForm('ranged', config.ranged);
    validateCopies(config.copies);
    validateShallowAdaptation(config.shallowAdaptation);
    if (config.melee.stackDamagePerHit < 0 || config.melee.stackArmorPerHit < 0) {
      throw new Error('MuelsyseCombat requires non-negative stack bonuses');
    }
    if (!Number.isInteger(config.melee.maxStacks) || config.melee.maxStacks < 0) {
      throw new Error('MuelsyseCombat requires maxStacks >= 0');
    }
    if (!Number.isFinite(config.startX) || !Number.isFinite(config.startY)) {
      throw new Error('MuelsyseCombat requires finite start coordinates');
    }

    this.config = config;
    this.layout = config.layout;
    this.radius =
      config.formRadius !== undefined && config.formRadius > 0
        ? config.formRadius
        : MUELSYSE_FORM_RADIUS;
    this.followDistance =
      config.followDistance !== undefined && config.followDistance > 0
        ? config.followDistance
        : MUELSYSE_FOLLOW_DISTANCE;
    this.followSpeed =
      config.followSpeed !== undefined && config.followSpeed > 0
        ? config.followSpeed
        : MUELSYSE_FOLLOW_SPEED;
    this.returnDistance =
      config.returnDistance !== undefined && config.returnDistance > 0
        ? config.returnDistance
        : MUELSYSE_RETURN_DISTANCE;

    const start = resolveFollowPoint(
      this.layout,
      { x: config.startX, y: config.startY },
      this.radius,
      this.followDistance,
    );
    this.x = start.x;
    this.y = start.y;
    this.health = this.formConfig.maxHealth;
  }

  get form(): StreamForm {
    return this.formType;
  }

  get formPosition(): Readonly<CombatPoint> {
    return { x: this.x, y: this.y };
  }

  get formFacing(): Facing {
    return this.facingValue;
  }

  get formRadius(): number {
    return this.radius;
  }

  get isFormAlive(): boolean {
    return this.health > TIME_EPSILON;
  }

  get formHealth(): number {
    return Math.max(0, this.health);
  }

  get formMaxHealth(): number {
    return this.formConfig.maxHealth;
  }

  get formStacks(): number {
    return this.stacks;
  }

  /** 近战流形的护甲：每层窃取 +2；远程流形没有层数加成。 */
  get formArmor(): number {
    return this.formType === 'melee'
      ? this.stacks * this.config.melee.stackArmorPerHit
      : 0;
  }

  /** 本次攻击的基础伤害，已计入近战窃取层数。 */
  get formDamage(): number {
    return this.formType === 'melee'
      ? this.config.melee.damage + this.stacks * this.config.melee.stackDamagePerHit
      : this.config.ranged.damage;
  }

  get attackRange(): number {
    return this.formConfig.attackRange;
  }

  get attackIntervalSeconds(): number {
    return this.formConfig.attackIntervalSeconds;
  }

  get attackDamageType(): DamageType {
    return this.formConfig.damageType;
  }

  get maxMeleeStacks(): number {
    return this.maxMeleeStacksOverride ?? this.config.melee.maxStacks;
  }

  get kCooldownRemaining(): number {
    return Math.max(0, this.kCooldownSeconds);
  }

  get lCooldownRemaining(): number {
    return Math.max(0, this.lCooldownSeconds);
  }

  get shallowAdaptationRemaining(): number {
    return Math.max(0, this.lRemainingSeconds);
  }

  get isShallowAdaptationActive(): boolean {
    return this.lRemainingSeconds > TIME_EPSILON;
  }

  get shallowAdaptationDurationSeconds(): number {
    return this.config.shallowAdaptation.durationSeconds;
  }

  /** 近战 L 的拉拽半径，已计入 M03 的 +30%。 */
  get meleePullRadius(): number {
    return this.config.shallowAdaptation.pullRadius * (1 + this.pullRangeBonusValue);
  }

  /** 远程 L 的束缚时长，已计入 M03 的 +0.25 秒。 */
  get shallowAdaptationRootSeconds(): number {
    return this.config.shallowAdaptation.rootSeconds + this.rootBonusSecondsValue;
  }

  get maxCopies(): number {
    return this.maxCopiesOverride ?? this.config.copies.maxCopies;
  }

  get copyDurationSeconds(): number {
    return this.config.copies.durationSeconds;
  }

  /** 远程副本数量。 */
  get copyCount(): number {
    return this.copiesValue.length;
  }

  /** 远程副本快照；场景据此同步视觉，不直接改内部状态。 */
  get copies(): readonly MuelsyseCopySnapshot[] {
    return this.copiesValue.map((copy) => ({
      id: copy.id,
      x: copy.x,
      y: copy.y,
      remainingSeconds: Math.max(0, copy.remainingSeconds),
    }));
  }

  /** 波中快照：形态/生命/位置、冷却、副本、控制计时与 M02/M04 进度。 */
  snapshotWorld(): MuelsyseWorldSnapshot {
    return {
      form: this.formType,
      x: this.x,
      y: this.y,
      health: this.formHealth,
      stacks: this.stacks,
      facing: this.facingValue,
      kCooldownSeconds: this.kCooldownSeconds,
      lCooldownSeconds: this.lCooldownSeconds,
      lRemainingSeconds: this.lRemainingSeconds,
      nextPullAtSeconds: this.nextPullAtSeconds,
      attackCooldownSeconds: this.attackCooldownSeconds,
      avoidSeconds: this.avoidSeconds,
      avoidSign: this.avoidSign,
      copies: this.copiesValue.map((copy) => ({ ...copy })),
      nextCopyId: this.nextCopyId,
      rangedAttacksSinceCopy: this.rangedAttacksSinceCopy,
      waterMirrorCooldownRemaining: this.waterMirrorCooldownRemaining,
      healAccumulatorSeconds: this.healAccumulatorSeconds,
      controls: [...this.controls.entries()].map(([targetId, state]) => ({
        targetId,
        stun: state.stun,
        root: state.root,
        slow: state.slow,
      })),
    };
  }

  /** 从波中快照恢复；M01–M04 的配置由场景按已选强化重新同步。 */
  restoreWorld(state: MuelsyseWorldSnapshot): void {
    this.formType = state.form === 'ranged' ? 'ranged' : 'melee';
    if (Number.isFinite(state.x)) this.x = state.x;
    if (Number.isFinite(state.y)) this.y = state.y;
    this.health = Math.min(this.formMaxHealth, nonNegative(state.health));
    this.stacks = Number.isInteger(state.stacks)
      ? Math.max(0, Math.min(this.maxMeleeStacks, state.stacks))
      : 0;
    if (FACING_LIST.includes(state.facing)) this.facingValue = state.facing;
    this.kCooldownSeconds = nonNegative(state.kCooldownSeconds);
    this.lCooldownSeconds = nonNegative(state.lCooldownSeconds);
    this.lRemainingSeconds = nonNegative(state.lRemainingSeconds);
    this.nextPullAtSeconds = nonNegative(state.nextPullAtSeconds);
    this.attackCooldownSeconds = nonNegative(state.attackCooldownSeconds);
    this.avoidSeconds = nonNegative(state.avoidSeconds);
    this.avoidSign = state.avoidSign === -1 ? -1 : 1;
    this.copiesValue = state.copies.map((copy) => ({
      id: copy.id,
      slot: Number.isInteger(copy.slot) ? Math.max(0, copy.slot) : 0,
      x: copy.x,
      y: copy.y,
      remainingSeconds: nonNegative(copy.remainingSeconds),
      attackCooldownSeconds: nonNegative(copy.attackCooldownSeconds),
    }));
    this.nextCopyId = Number.isInteger(state.nextCopyId)
      ? Math.max(1, state.nextCopyId)
      : 1;
    this.rangedAttacksSinceCopy = Number.isInteger(state.rangedAttacksSinceCopy)
      ? Math.max(0, state.rangedAttacksSinceCopy)
      : 0;
    this.waterMirrorCooldownRemaining = nonNegative(state.waterMirrorCooldownRemaining);
    this.healAccumulatorSeconds = nonNegative(state.healAccumulatorSeconds);
    this.controls.clear();
    for (const control of state.controls) {
      const stun = nonNegative(control.stun);
      const root = nonNegative(control.root);
      const slow = nonNegative(control.slow);
      if (stun > 0 || root > 0 || slow > 0) {
        this.controls.set(control.targetId, { stun, root, slow });
      }
    }
  }

  /** 更新 G03 的冷却倍率；只影响之后启动的冷却。 */
  setCooldownMultiplier(multiplier: number): void {
    this.cooldownMultiplier =
      Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  }

  /**
   * M01 双生流形：远程副本上限与近战窃取层数上限。
   * 传 null 回到角色基础配置；已有副本不会因上限降低而立即消失。
   */
  setDualForm(copyLimit: number | null, meleeStackLimit: number | null): void {
    this.maxCopiesOverride = normalizeLimit(copyLimit);
    this.maxMeleeStacksOverride = normalizeLimit(meleeStackLimit);
  }

  /** M02 生态复苏：每秒回复比例与 L 开启时的即时回复比例；非正表示未拥有。 */
  setEcologicalRecovery(
    healPercentPerSecond: number,
    healOnActivatePercent: number,
  ): void {
    const nextPerSecond = normalizeNonNegative(healPercentPerSecond);
    if (nextPerSecond !== this.healPercentPerSecondValue) {
      this.healAccumulatorSeconds = 0;
    }
    this.healPercentPerSecondValue = nextPerSecond;
    this.healOnActivatePercentValue = normalizeNonNegative(healOnActivatePercent);
  }

  /** M03 聚合涡旋：近战拉拽范围加成比例与远程束缚时间加成。 */
  setAggregationVortex(pullRangeBonus: number, rootBonusSeconds: number): void {
    this.pullRangeBonusValue = normalizeNonNegative(pullRangeBonus);
    this.rootBonusSecondsValue = normalizeNonNegative(rootBonusSeconds);
  }

  /** M04 水镜共鸣：补攻伤害比例与内置冷却；任一非正表示未拥有。 */
  setWaterMirrorEcho(damageRatio: number, internalCooldownSeconds: number): void {
    const ratio = normalizeNonNegative(damageRatio);
    const cooldown = normalizeNonNegative(internalCooldownSeconds);
    const enabled = ratio > 0 && cooldown > 0;
    this.waterMirrorDamageRatioValue = enabled ? ratio : 0;
    this.waterMirrorCooldownSecondsValue = enabled ? cooldown : 0;
    if (!enabled) this.waterMirrorCooldownRemaining = 0;
  }

  /**
   * M04：玩家 J 命中后由主流形补一次攻击。
   * 只有主流形存活、目标存活且内置冷却就绪时触发；补攻不进入远程分裂计数，
   * 也不会再次触发本方法（不存在递归入口）。
   */
  resolveWaterMirrorHit(
    target: Combatant,
    options: {
      readonly damageMultiplier?: number;
      readonly isBoss?: (targetId: string) => boolean;
    } = {},
  ): MuelsyseAttackEvent | null {
    if (this.waterMirrorDamageRatioValue <= 0) return null;
    if (this.waterMirrorCooldownSecondsValue <= 0) return null;
    if (!this.isFormAlive || !target.isAlive) return null;
    if (this.waterMirrorCooldownRemaining > TIME_EPSILON) return null;

    this.waterMirrorCooldownRemaining = this.waterMirrorCooldownSecondsValue;
    const multiplier = resolveDamageMultiplier(options.damageMultiplier);
    const event = this.resolveAttack(
      'form',
      null,
      this.x,
      this.y,
      target,
      this.formDamage * this.waterMirrorDamageRatioValue * multiplier,
      this.attackDamageType,
      {
        player: { x: this.x, y: this.y },
        targets: [target],
        damageMultiplier: multiplier,
        ...(options.isBoss === undefined ? {} : { isBoss: options.isBoss }),
      },
    );
    // 近战补攻同样累计窃取层数；远程补攻不增加分裂计数。
    if (event.result.applied && this.formType === 'melee') {
      this.stacks = Math.min(this.maxMeleeStacks, this.stacks + 1);
    }
    return event;
  }

  /** G08 可返还 K 剩余冷却；已到下限时不返还，也不回抬。 */
  reduceCooldown(seconds: number, minimumSeconds = 0): number {
    return this.reduceTimer('k', seconds, minimumSeconds);
  }

  /** G08 可返还 L 剩余冷却；规则与 K 一致。 */
  reduceLCooldown(seconds: number, minimumSeconds = 0): number {
    return this.reduceTimer('l', seconds, minimumSeconds);
  }

  private reduceTimer(
    kind: 'k' | 'l',
    seconds: number,
    minimumSeconds: number,
  ): number {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return 0;
    const current = kind === 'k' ? this.kCooldownSeconds : this.lCooldownSeconds;
    if (current <= TIME_EPSILON) return 0;
    const minimum = Number.isFinite(minimumSeconds) ? Math.max(0, minimumSeconds) : 0;
    if (current <= minimum + TIME_EPSILON) return 0;

    const next = Math.max(minimum, current - seconds);
    const reduced = current - next;
    const value = next <= TIME_EPSILON ? 0 : next;
    if (kind === 'k') this.kCooldownSeconds = value;
    else this.lCooldownSeconds = value;
    return reduced;
  }

  /**
   * L 浅层非熵适应：主流形存活且冷却就绪时启动 6 秒效果。
   * 无主流形或冷却中都不消耗冷却；远程形态启动时立即刷新已有副本寿命。
   */
  tryActivateL(): ShallowAdaptationResult {
    if (!this.isFormAlive) {
      return { activated: false, reason: 'no-form' };
    }
    if (this.lCooldownRemaining > TIME_EPSILON) {
      return { activated: false, reason: 'cooldown' };
    }

    this.lCooldownSeconds =
      this.config.shallowAdaptation.cooldownSeconds * this.cooldownMultiplier;
    this.lRemainingSeconds = this.config.shallowAdaptation.durationSeconds;
    this.nextPullAtSeconds = this.config.shallowAdaptation.pullIntervalSeconds;
    // M02 生态复苏：L 开启瞬间立即回复最大生命的一定比例。
    this.healForm(this.formMaxHealth * this.healOnActivatePercentValue);

    let refreshedCopies = 0;
    if (this.formType === 'ranged') {
      for (const copy of this.copiesValue) {
        copy.remainingSeconds = this.config.copies.durationSeconds;
        refreshedCopies += 1;
      }
    }
    return { activated: true, form: this.formType, refreshedCopies };
  }

  /** 目标剩余眩晕秒数（缪尔赛思施加的部分）。 */
  enemyStunRemaining(targetId: string): number {
    return this.controlRemaining(targetId, 'stun');
  }

  enemyRootRemaining(targetId: string): number {
    return this.controlRemaining(targetId, 'root');
  }

  enemySlowRemaining(targetId: string): number {
    return this.controlRemaining(targetId, 'slow');
  }

  isEnemyStunned(targetId: string): boolean {
    return this.enemyStunRemaining(targetId) > TIME_EPSILON;
  }

  isEnemyRooted(targetId: string): boolean {
    return this.enemyRootRemaining(targetId) > TIME_EPSILON;
  }

  /** 缪尔赛思施加的减速倍率；Boss 控制转换后生效。 */
  enemySlowMultiplier(targetId: string): number {
    if (this.enemySlowRemaining(targetId) <= TIME_EPSILON) return 1;
    return this.config.shallowAdaptation.bossSlowMultiplier ?? BOSS_CONTROL_SLOW_MULTIPLIER;
  }

  /** 清空全部远程副本；近战切换、重建、死亡与重开共用这一入口。 */
  clearSummons(): void {
    this.copiesValue = [];
    this.rangedAttacksSinceCopy = 0;
  }

  /** 清除全部控制计时；重开边界使用。 */
  clearControls(): void {
    this.controls.clear();
  }

  /**
   * K 塑形：存活时切换形态并保留生命百分比；死亡时重建当前形态。
   * 无论切换还是重建，成功后才开始 6 秒冷却；不会治疗或刷新 L。
   */
  tryActivateK(player: CombatPoint): ShapeShiftResult | null {
    if (!this.isFormAlive) {
      return this.rebuild(player);
    }
    if (this.kCooldownRemaining > TIME_EPSILON) return null;

    const previousForm = this.formType;
    const healthPercent = this.health / this.formMaxHealth;
    this.formType = previousForm === 'melee' ? 'ranged' : 'melee';
    // 百分比保留：90 的 50% → 60 的 50%，不额外治疗。
    this.health = healthPercent * this.formMaxHealth;
    // 新形态是全新的流形：近战窃取层数从 0 开始。
    this.stacks = 0;
    // 切近战移除全部远程副本；切远程时分裂计数重新开始。
    this.clearSummons();
    this.kCooldownSeconds =
      this.config.switchCooldownSeconds * this.cooldownMultiplier;
    this.attackCooldownSeconds = 0;

    return {
      action: 'switch',
      previousForm,
      form: this.formType,
      health: this.formHealth,
      maxHealth: this.formMaxHealth,
      healthPercent,
    };
  }

  /**
   * 流形承受伤害：护甲取当前窃取层数。
   * 死亡后重复受击返回 applied=false，避免重复击杀。
   */
  damageForm(rawDamage: number, damageType: DamageType): DamageResult {
    const damage = computeDamage(rawDamage, damageType, this.formArmor, 0);
    if (!this.isFormAlive || damage <= 0) {
      return {
        applied: false,
        rawDamage: Math.max(0, rawDamage),
        damage,
        shieldAbsorbed: 0,
        healthLost: 0,
        died: false,
        health: this.formHealth,
        shield: 0,
      };
    }

    const before = this.health;
    this.health = Math.max(0, before - damage);
    const died = this.health <= TIME_EPSILON && before > TIME_EPSILON;
    // 主流形消散时远程副本一并消失，避免无主分身继续输出。
    if (died) {
      this.clearSummons();
      this.healAccumulatorSeconds = 0;
    }
    return {
      applied: true,
      rawDamage: Math.max(0, rawDamage),
      damage,
      shieldAbsorbed: 0,
      healthLost: before - this.health,
      died,
      health: this.formHealth,
      shield: 0,
    };
  }

  /**
   * 推进一个逻辑步：冷却/控制衰减 → 跟随/回位 → 主流形与副本攻击 → L 拉拽。
   * 攻击只选射程内、通视且最近的存活敌人；命中后才累计近战窃取层数。
   */
  step(stepSeconds: number, context: MuelsyseStepContext): MuelsyseStepResult {
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) {
      return {
        attacks: [],
        pulls: [],
        spawnedCopies: 0,
        teleported: false,
        moved: false,
        formHealed: 0,
      };
    }

    this.kCooldownSeconds = decay(this.kCooldownSeconds, stepSeconds);
    this.lCooldownSeconds = decay(this.lCooldownSeconds, stepSeconds);
    this.waterMirrorCooldownRemaining = decay(
      this.waterMirrorCooldownRemaining,
      stepSeconds,
    );
    this.decayControls(stepSeconds);
    // 本步开始时 L 仍生效；最后一步（剩余归零）也要结算触发点。
    this.lActiveThisStep = this.lRemainingSeconds > TIME_EPSILON;
    this.lRemainingSeconds = decay(this.lRemainingSeconds, stepSeconds);
    if (!this.isFormAlive) {
      return {
        attacks: [],
        pulls: [],
        spawnedCopies: 0,
        teleported: false,
        moved: false,
        formHealed: 0,
      };
    }

    // M02 生态复苏：按整秒结算，逻辑步长变化不改变每秒回复节奏。
    const formHealed = this.stepEcologicalRecovery(stepSeconds);
    const teleported = this.updateFollow(stepSeconds, context.player);
    const multiplier = resolveDamageMultiplier(context.damageMultiplier);
    this.attackCooldownSeconds = decay(this.attackCooldownSeconds, stepSeconds);

    const attacks: MuelsyseAttackEvent[] = [];
    let spawnedCopies = 0;

    // 主流形自动攻击；远程形态每累计 8 次尝试生成一个副本。
    if (this.attackCooldownSeconds <= TIME_EPSILON) {
      const target = this.selectTargetFrom(this.x, this.y, this.attackRange, context.targets);
      if (target) {
        const event = this.resolveAttack(
          'form',
          null,
          this.x,
          this.y,
          target,
          this.formDamage * multiplier,
          this.attackDamageType,
          context,
        );
        attacks.push(event);
        this.facingValue =
          facingFromVector({ x: target.x - this.x, y: target.y - this.y }) ??
          this.facingValue;
        if (event.result.applied && this.formType === 'melee') {
          this.stacks = Math.min(
            this.maxMeleeStacks,
            this.stacks + 1,
          );
        }
        this.attackCooldownSeconds = this.formConfig.attackIntervalSeconds;

        if (this.formType === 'ranged') {
          this.rangedAttacksSinceCopy += 1;
          if (this.rangedAttacksSinceCopy >= this.config.copies.everyAttacks) {
            this.rangedAttacksSinceCopy = 0;
            if (this.copiesValue.length < this.maxCopies) {
              this.spawnCopy();
              spawnedCopies += 1;
            }
          }
        }
      }
    }

    // 远程副本：先跟随主流形，再独立自动攻击；寿命与攻击计时同步衰减。
    const survivingCopies: CopyState[] = [];
    for (const copy of this.copiesValue) {
      copy.remainingSeconds = decay(copy.remainingSeconds, stepSeconds);
      if (copy.remainingSeconds <= TIME_EPSILON) continue;
      this.updateCopyFollow(copy, stepSeconds);
      copy.attackCooldownSeconds = decay(copy.attackCooldownSeconds, stepSeconds);
      if (copy.attackCooldownSeconds <= TIME_EPSILON) {
        const target = this.selectTargetFrom(
          copy.x,
          copy.y,
          this.config.ranged.attackRange,
          context.targets,
        );
        if (target) {
          attacks.push(
            this.resolveAttack(
              'copy',
              copy.id,
              copy.x,
              copy.y,
              target,
              this.config.ranged.damage * this.config.copies.damageRatio * multiplier,
              this.config.ranged.damageType,
              context,
            ),
          );
          copy.attackCooldownSeconds = this.config.ranged.attackIntervalSeconds;
        }
      }
      survivingCopies.push(copy);
    }
    this.copiesValue = survivingCopies;

    // 近战 L：每 2 秒把半径内普通敌人拉向主流形并眩晕；Boss 只转减速。
    const pulls =
      this.formType === 'melee' && this.lActiveThisStep
        ? this.resolveMeleePulls(context)
        : [];

    return {
      attacks,
      pulls,
      spawnedCopies,
      teleported,
      moved: this.lastMoved,
      formHealed,
    };
  }

  /** 主流形/副本共用的命中结算；远程 L 生效时附加束缚（Boss 转减速）。 */
  private resolveAttack(
    source: 'form' | 'copy',
    copyId: string | null,
    fromX: number,
    fromY: number,
    target: Combatant,
    rawDamage: number,
    damageType: DamageType,
    context: MuelsyseStepContext,
  ): MuelsyseAttackEvent {
    const result = target.applyDamage(rawDamage, damageType);
    let control: 'stun' | 'root' | 'slow' | undefined;
    if (
      result.applied &&
      this.formType === 'ranged' &&
      this.lActiveThisStep
    ) {
      const boss = context.isBoss?.(target.id) ?? false;
      const kind = boss ? 'slow' : 'root';
      const seconds = this.convertControlSeconds(this.shallowAdaptationRootSeconds, boss);
      this.applyControl(target.id, kind, seconds);
      control = kind;
    }
    return {
      targetId: target.id,
      result,
      form: this.formType,
      source,
      ...(copyId === null ? {} : { copyId }),
      damageType,
      fromX,
      fromY,
      toX: target.x,
      toY: target.y,
      ...(control === undefined ? {} : { control }),
    };
  }

  /** 近战 L 的一次批量拉拽：半径 100 内普通敌人拉近 35 并眩晕 0.5 秒。 */
  private resolveMeleePulls(context: MuelsyseStepContext): MuelsysePullEvent[] {
    const config = this.config.shallowAdaptation;
    const elapsed = config.durationSeconds - this.lRemainingSeconds;
    if (elapsed + TIME_EPSILON < this.nextPullAtSeconds) return [];

    const pulls: MuelsysePullEvent[] = [];
    const radiusSquared = this.meleePullRadius * this.meleePullRadius;
    for (const target of context.targets) {
      if (!target.isAlive) continue;
      if (distanceSquared({ x: this.x, y: this.y }, target) > radiusSquared + TIME_EPSILON) {
        continue;
      }
      const boss = context.isBoss?.(target.id) ?? false;
      if (boss) {
        // Boss 免疫强制位移：眩晕转成原持续时间 30% 的减速。
        const seconds = this.convertControlSeconds(config.stunSeconds, true);
        this.applyControl(target.id, 'slow', seconds);
        continue;
      }
      this.applyControl(target.id, 'stun', config.stunSeconds);
      pulls.push({
        targetId: target.id,
        fromX: target.x,
        fromY: target.y,
        towardX: this.x,
        towardY: this.y,
        distance: config.pullDistance,
        stunSeconds: config.stunSeconds,
      });
    }

    // 拉拽按固定间隔推进；大步长时补齐多个触发点。
    const interval = config.pullIntervalSeconds;
    while (this.nextPullAtSeconds <= elapsed + TIME_EPSILON) {
      this.nextPullAtSeconds += interval;
    }
    return pulls;
  }

  /** 生成一个远程副本；站位避开墙体与已有副本。 */
  private spawnCopy(): void {
    const point = this.resolveCopyPoint();
    const slot = this.copiesValue.length % COPY_OFFSETS.length;
    this.copiesValue.push({
      id: `copy-${this.nextCopyId}`,
      slot,
      x: point.x,
      y: point.y,
      remainingSeconds: this.config.copies.durationSeconds,
      attackCooldownSeconds: 0,
    });
    this.nextCopyId += 1;
  }

  /** 副本生成点：主流形周围 40 像素内避开障碍与已有副本的空位。 */
  private resolveCopyPoint(): CombatPoint {
    const offsets: ReadonlyArray<readonly [number, number]> = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-Math.SQRT1_2, -Math.SQRT1_2],
      [Math.SQRT1_2, -Math.SQRT1_2],
      [-Math.SQRT1_2, Math.SQRT1_2],
      [Math.SQRT1_2, Math.SQRT1_2],
    ];
    for (const distance of [40, 56, 72]) {
      for (const [dx, dy] of offsets) {
        const x = this.x + dx * distance;
        const y = this.y + dy * distance;
        if (isCircleBlocked(this.layout, x, y, MUELSYSE_COPY_RADIUS)) continue;
        const overlaps = this.copiesValue.some(
          (copy) => Math.hypot(copy.x - x, copy.y - y) < MUELSYSE_COPY_RADIUS * 2,
        );
        if (!overlaps) return { x, y };
      }
    }
    return { x: this.x, y: this.y };
  }

  /** 副本跟随主流形：按槽位偏移移动，复用圆形碰撞不穿墙。 */
  private updateCopyFollow(copy: CopyState, stepSeconds: number): void {
    const [offsetX, offsetY] = COPY_OFFSETS[copy.slot] ?? COPY_OFFSETS[0]!;
    const targetX = this.x + offsetX;
    const targetY = this.y + offsetY;
    const dx = targetX - copy.x;
    const dy = targetY - copy.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 1) return;

    const travel = Math.min(distance, this.followSpeed * stepSeconds);
    const moved = moveCircleWithCollision(
      this.layout,
      copy.x,
      copy.y,
      MUELSYSE_COPY_RADIUS,
      (dx / distance) * travel,
      (dy / distance) * travel,
    );
    copy.x = moved.x;
    copy.y = moved.y;
  }

  /** 控制持续时间换算：Boss 的眩晕/束缚按 30% 转为减速。 */
  private convertControlSeconds(seconds: number, boss: boolean): number {
    if (!boss) return seconds;
    const ratio =
      this.config.shallowAdaptation.bossControlDurationRatio ?? BOSS_CONTROL_DURATION_RATIO;
    return seconds * ratio;
  }

  private applyControl(
    targetId: string,
    kind: 'stun' | 'root' | 'slow',
    seconds: number,
  ): void {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return;
    const state = this.controls.get(targetId) ?? { stun: 0, root: 0, slow: 0 };
    state[kind] = Math.max(state[kind], seconds);
    this.controls.set(targetId, state);
  }

  private controlRemaining(
    targetId: string,
    kind: 'stun' | 'root' | 'slow',
  ): number {
    return Math.max(0, this.controls.get(targetId)?.[kind] ?? 0);
  }

  private decayControls(stepSeconds: number): void {
    for (const [targetId, state] of this.controls) {
      state.stun = decay(state.stun, stepSeconds);
      state.root = decay(state.root, stepSeconds);
      state.slow = decay(state.slow, stepSeconds);
      if (state.stun <= 0 && state.root <= 0 && state.slow <= 0) {
        this.controls.delete(targetId);
      }
    }
  }

  /** M02 生态复苏：每满 1 秒回复最大生命的一定比例；返回本步实际回复量。 */
  private stepEcologicalRecovery(stepSeconds: number): number {
    if (this.healPercentPerSecondValue <= 0) return 0;
    this.healAccumulatorSeconds += stepSeconds;
    let healed = 0;
    while (this.healAccumulatorSeconds + TIME_EPSILON >= 1) {
      this.healAccumulatorSeconds -= 1;
      healed += this.healForm(this.formMaxHealth * this.healPercentPerSecondValue);
    }
    return healed;
  }

  /** 主流形回复生命，不超过上限；死亡时不结算。 */
  private healForm(amount: number): number {
    if (!(amount > 0) || !Number.isFinite(amount) || !this.isFormAlive) return 0;
    const before = this.health;
    this.health = Math.min(this.formMaxHealth, this.health + amount);
    return this.health - before;
  }

  private get formConfig(): MuelsyseFormConfig {
    return this.formType === 'melee' ? this.config.melee : this.config.ranged;
  }

  private lastMoved = false;

  /**
   * 跟随玩家：距离超过 240 直接回到身边空位；否则朝跟随站位移动，
   * 视线被掩体遮断时沿切向绕行，卡住时换另一侧。
   */
  private updateFollow(stepSeconds: number, player: CombatPoint): boolean {
    this.lastMoved = false;
    const distanceToPlayer = Math.hypot(player.x - this.x, player.y - this.y);
    if (distanceToPlayer > this.returnDistance) {
      const point = resolveFormReturnPoint(
        this.layout,
        player,
        this.radius,
        this.followDistance,
      );
      this.x = point.x;
      this.y = point.y;
      this.avoidSeconds = 0;
      this.lastMoved = true;
      return true;
    }

    const anchor = resolveFollowPoint(
      this.layout,
      player,
      this.radius,
      this.followDistance,
    );
    const dx = anchor.x - this.x;
    const dy = anchor.y - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 1) {
      this.avoidSeconds = decay(this.avoidSeconds, stepSeconds);
      return false;
    }

    let moveX = dx / distance;
    let moveY = dy / distance;
    const visible = hasLineOfSight(this.layout, { x: this.x, y: this.y }, anchor);
    if (!visible) {
      if (this.avoidSeconds <= 0) {
        this.avoidSign = this.chooseAvoidSign({ x: moveX, y: moveY });
        this.avoidSeconds = AVOID_SECONDS;
      }
      const sideX = -moveY * this.avoidSign;
      const sideY = moveX * this.avoidSign;
      const blended = normalize(sideX + moveX * 0.35, sideY + moveY * 0.35);
      moveX = blended.x;
      moveY = blended.y;
    } else {
      this.avoidSeconds = 0;
    }
    this.avoidSeconds = decay(this.avoidSeconds, stepSeconds);

    const travel = Math.min(distance, this.followSpeed * stepSeconds);
    const moved = moveCircleWithCollision(
      this.layout,
      this.x,
      this.y,
      this.radius,
      moveX * travel,
      moveY * travel,
    );
    const actual = Math.hypot(moved.x - this.x, moved.y - this.y);
    this.x = moved.x;
    this.y = moved.y;
    if (actual <= TIME_EPSILON) return false;

    this.lastMoved = true;
    this.facingValue = facingFromVector({ x: moveX, y: moveY }) ?? this.facingValue;
    // 完全走不动时换一侧绕行，避免长期顶住掩体角落。
    if (!visible && actual < travel * 0.25) {
      this.avoidSign = this.avoidSign === 1 ? -1 : 1;
      this.avoidSeconds = AVOID_SECONDS;
    }
    return false;
  }

  private chooseAvoidSign(direction: { x: number; y: number }): 1 | -1 {
    for (const sign of [this.avoidSign, this.avoidSign === 1 ? -1 : 1] as const) {
      const probeX = this.x + -direction.y * sign * this.radius;
      const probeY = this.y + direction.x * sign * this.radius;
      if (!isCircleBlocked(this.layout, probeX, probeY, this.radius)) return sign;
    }
    return this.avoidSign;
  }

  private selectTargetFrom(
    x: number,
    y: number,
    range: number,
    targets: readonly Combatant[],
  ): Combatant | null {
    const rangeSquared = range * range;
    let best: Combatant | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const target of targets) {
      if (!target.isAlive) continue;
      const distance = distanceSquared({ x, y }, target);
      if (distance > rangeSquared + TIME_EPSILON) continue;
      if (!hasLineOfSight(this.layout, { x, y }, target)) continue;
      // 等距时按 id 升序，保证同一局面下选择可复现。
      if (
        distance < bestDistance - TIME_EPSILON ||
        (Math.abs(distance - bestDistance) <= TIME_EPSILON &&
          best !== null &&
          target.id < best.id)
      ) {
        best = target;
        bestDistance = distance;
      }
    }
    return best;
  }

  private rebuild(player: CombatPoint): ShapeShiftResult {
    const previousForm = this.formType;
    this.health = this.formMaxHealth;
    this.stacks = 0;
    this.healAccumulatorSeconds = 0;
    this.clearSummons();
    const point = resolveFormReturnPoint(
      this.layout,
      player,
      this.radius,
      this.followDistance,
    );
    this.x = point.x;
    this.y = point.y;
    this.avoidSeconds = 0;
    this.attackCooldownSeconds = 0;
    // 重建本身成功后才开始 6 秒冷却，符合“死亡时 K 改为重建”的语义。
    this.kCooldownSeconds =
      this.config.switchCooldownSeconds * this.cooldownMultiplier;
    return {
      action: 'rebuild',
      previousForm,
      form: this.formType,
      health: this.formHealth,
      maxHealth: this.formMaxHealth,
      healthPercent: 1,
    };
  }
}

function validateForm(form: StreamForm, config: MuelsyseFormConfig): void {
  if (!(config.maxHealth > 0) || !Number.isFinite(config.maxHealth)) {
    throw new Error(`MuelsyseCombat requires positive ${form} maxHealth`);
  }
  if (!(config.attackRange > 0) || !Number.isFinite(config.attackRange)) {
    throw new Error(`MuelsyseCombat requires positive ${form} attackRange`);
  }
  if (
    !(config.attackIntervalSeconds > 0) ||
    !Number.isFinite(config.attackIntervalSeconds)
  ) {
    throw new Error(`MuelsyseCombat requires positive ${form} attackIntervalSeconds`);
  }
  if (!(config.damage >= 0) || !Number.isFinite(config.damage)) {
    throw new Error(`MuelsyseCombat requires ${form} damage >= 0`);
  }
}

function validateCopies(config: MuelsyseCopyConfig): void {
  if (!Number.isInteger(config.everyAttacks) || config.everyAttacks <= 0) {
    throw new Error('MuelsyseCombat requires copies.everyAttacks >= 1');
  }
  if (!(config.durationSeconds > 0) || !Number.isFinite(config.durationSeconds)) {
    throw new Error('MuelsyseCombat requires positive copies.durationSeconds');
  }
  if (!(config.damageRatio > 0) || !Number.isFinite(config.damageRatio)) {
    throw new Error('MuelsyseCombat requires positive copies.damageRatio');
  }
  if (!Number.isInteger(config.maxCopies) || config.maxCopies < 0) {
    throw new Error('MuelsyseCombat requires copies.maxCopies >= 0');
  }
}

function validateShallowAdaptation(
  config: MuelsyseShallowAdaptationConfig,
): void {
  if (!(config.cooldownSeconds > 0) || !Number.isFinite(config.cooldownSeconds)) {
    throw new Error('MuelsyseCombat requires positive shallowAdaptation.cooldownSeconds');
  }
  if (!(config.durationSeconds > 0) || !Number.isFinite(config.durationSeconds)) {
    throw new Error('MuelsyseCombat requires positive shallowAdaptation.durationSeconds');
  }
  if (!(config.pullIntervalSeconds > 0) || !Number.isFinite(config.pullIntervalSeconds)) {
    throw new Error('MuelsyseCombat requires positive shallowAdaptation.pullIntervalSeconds');
  }
  if (!(config.pullRadius > 0) || !(config.pullDistance > 0)) {
    throw new Error('MuelsyseCombat requires positive shallowAdaptation pull radius/distance');
  }
  if (!(config.stunSeconds > 0) || !(config.rootSeconds > 0)) {
    throw new Error('MuelsyseCombat requires positive shallowAdaptation control seconds');
  }
}

function resolveDamageMultiplier(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 1;
}

function normalizeNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeLimit(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function normalize(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: x / length, y: y / length };
}

function decay(value: number, stepSeconds: number): number {
  if (value <= 0) return 0;
  const next = value - stepSeconds;
  return next <= TIME_EPSILON ? 0 : next;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
