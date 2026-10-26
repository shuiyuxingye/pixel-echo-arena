/**
 * 三件成品的战斗机制 R01–R06（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §三件合成与
 * `docs/design/v0.2/02-content-catalog.md` §6 条三件合成：
 * - R01 锻心引擎：击败正式敌人累积成长（普通每 15 杀 +3、精英 +15，上限 +120）；
 *   受到敌人有效命中后每 4 秒首次蓄势，下一发 J 追加最大生命 5% 的物伤（上限 60）；
 * - R02 连锁反应堆：爆炸击杀产生一次 50% 小爆炸的规则由 `GrenadeSystem` 执行，
 *   本模块只提供参数；
 * - R03 折镜机关：每次原生 J 发射追加 2 枚 40% 侧弹；侧弹必须由原生攻击派生，
 *   已衍生的来源不能再生成侧弹，因此不会递归；
 * - R04 永昼回路：每第 4 次成功技能施放返还该技能当前冷却的 35%；
 * - R05 潮生母巢：每 12 秒生成一个持续 5 秒的小流形；小流形的索敌与伤害由场景消费；
 * - R06 命运交易所：每个商店第一次重抽免费、首次购买永久道具 −20%、波后恢复减半。
 *
 * 成长只统计普通波次的正式敌人：宝箱、巢母幼虫与 Boss 二阶段增援不计；
 * 巢母本体是正式敌人，仍可计入成长。
 */
import { RECIPE_EFFECT_PARAMS, type CraftedItemId } from './crafting';
import type { CombatEventSource, DamageChainTracker } from './damage-events';

const R01_PARAMS = RECIPE_EFFECT_PARAMS.R01.params;
const R02_PARAMS = RECIPE_EFFECT_PARAMS.R02.params;
const R03_PARAMS = RECIPE_EFFECT_PARAMS.R03.params;
const R04_PARAMS = RECIPE_EFFECT_PARAMS.R04.params;
const R05_PARAMS = RECIPE_EFFECT_PARAMS.R05.params;
const R06_PARAMS = RECIPE_EFFECT_PARAMS.R06.params;

function numberParam(
  params: Readonly<Record<string, number>>,
  key: string,
): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** R01：每击败多少普通敌人获得一次成长。 */
export const R01_GROWTH_EVERY_NORMAL_KILLS = numberParam(
  R01_PARAMS,
  'growthEveryNormalKills',
);
/** R01：每次普通成长的最大生命增量。 */
export const R01_GROWTH_PER_NORMAL_KILL = numberParam(
  R01_PARAMS,
  'growthPerNormalKill',
);
/** R01：击败精英的最大生命增量。 */
export const R01_GROWTH_PER_ELITE_KILL = numberParam(
  R01_PARAMS,
  'growthPerEliteKill',
);
/** R01：成长总计上限（不含成品自带的 +80 最大生命）。 */
export const R01_GROWTH_CAP = numberParam(R01_PARAMS, 'growthCap');
/** R01：受击蓄势的内置冷却（秒）。 */
export const R01_COUNTER_INTERVAL_SECONDS = numberParam(
  R01_PARAMS,
  'counterIntervalSeconds',
);
/** R01：反击附加伤害占最大生命的比例。 */
export const R01_COUNTER_MAX_HEALTH_RATIO = numberParam(
  R01_PARAMS,
  'counterMaxHealthRatio',
);
/** R01：反击附加伤害上限。 */
export const R01_COUNTER_DAMAGE_CAP = numberParam(
  R01_PARAMS,
  'counterDamageCap',
);
/** R02：爆炸击杀小爆炸的伤害比例。 */
export const R02_DEATH_EXPLOSION_RATIO = numberParam(
  R02_PARAMS,
  'deathExplosionRatio',
);
/** R03：每次 J 的侧弹数量。 */
export const R03_SIDE_PROJECTILE_COUNT = Math.max(
  0,
  Math.floor(numberParam(R03_PARAMS, 'sideProjectileCount')),
);
/** R03：侧弹伤害占本次 J 的比例。 */
export const R03_SIDE_PROJECTILE_DAMAGE_RATIO = numberParam(
  R03_PARAMS,
  'sideProjectileDamageRatio',
);
/** R04：每第几次技能施放返还冷却。 */
export const R04_REFUND_EVERY_CASTS = Math.max(
  1,
  Math.floor(numberParam(R04_PARAMS, 'refundEveryCasts')),
);
/** R04：返还该技能当前冷却的比例。 */
export const R04_REFUND_COOLDOWN_RATIO = numberParam(
  R04_PARAMS,
  'refundCooldownRatio',
);
/** R05：小流形的生成间隔（秒）。 */
export const R05_FLOWFORM_INTERVAL_SECONDS = numberParam(
  R05_PARAMS,
  'spawnEverySeconds',
);
/** R05：小流形的存在时长（秒）。 */
export const R05_FLOWFORM_DURATION_SECONDS = numberParam(
  R05_PARAMS,
  'spawnDurationSeconds',
);
/** R05：小流形每次攻击的伤害（未乘召唤物/技能倍率）。 */
export const R05_FLOWFORM_DAMAGE = numberParam(R05_PARAMS, 'flowformDamage');
/** R05：小流形的攻击间隔（秒）。 */
export const R05_FLOWFORM_ATTACK_INTERVAL_SECONDS = numberParam(
  R05_PARAMS,
  'flowformAttackIntervalSeconds',
);
/** R05：小流形的索敌射程（逻辑像素）。 */
export const R05_FLOWFORM_RANGE = numberParam(R05_PARAMS, 'flowformRange');
/** R06：每个商店的免费重抽次数。 */
export const R06_FREE_REROLLS_PER_SHOP = Math.max(
  0,
  Math.floor(numberParam(R06_PARAMS, 'freeRerollsPerShop')),
);
/** R06：首次购买永久道具的减价百分比。 */
export const R06_FIRST_ITEM_DISCOUNT_PERCENT = numberParam(
  R06_PARAMS,
  'firstItemDiscountPercent',
);
/** R06：波后恢复倍率；0.5 表示减半。 */
export const R06_INTERMISSION_HEAL_MULTIPLIER = numberParam(
  R06_PARAMS,
  'intermissionHealMultiplier',
);

/** R01 的一次击杀归类；`excluded` 表示宝箱/幼虫/增援，不参与成长。 */
export type R01GrowthKind = 'normal' | 'elite' | 'excluded';

/** 判定成长所需的最小敌人信息；宝箱沿用 `kind: 'chest'`。 */
export interface R01KillTarget {
  readonly enemyId: string;
  readonly elite?: boolean;
  readonly summoned?: boolean;
  readonly kind?: 'enemy' | 'chest';
}

/**
 * 击杀归类：宝箱、巢母幼虫与 Boss 二阶段增援不参与成长；
 * 其余精英 +15、普通敌人累计 15 杀 +3。
 */
export function r01GrowthKind(target: R01KillTarget): R01GrowthKind {
  if (target.kind === 'chest') return 'excluded';
  if (target.summoned === true) return 'excluded';
  if (target.enemyId === 'larva') return 'excluded';
  return target.elite === true ? 'elite' : 'normal';
}

/** R03 一次 J 的侧弹计划；来源已带衍生标记，不会再次生成侧弹。 */
export interface R03SideShotPlan {
  readonly count: number;
  readonly damageRatio: number;
  /** 侧弹的衍生来源（depth=1）；侧弹命中不再计入原生 J 链。 */
  readonly source: CombatEventSource;
}

/**
 * R03：从原生 J 派生一次侧弹。
 * `chains.derive` 对衍生来源返回 null，因此侧弹命中不会再次生成侧弹。
 */
export function planR03SideShots(
  owned: boolean,
  chains: DamageChainTracker,
  parent: CombatEventSource,
): R03SideShotPlan | null {
  if (!owned) return null;
  if (R03_SIDE_PROJECTILE_COUNT <= 0 || R03_SIDE_PROJECTILE_DAMAGE_RATIO <= 0) {
    return null;
  }
  const source = chains.derive(parent, 'R03');
  if (!source) return null;
  return {
    count: R03_SIDE_PROJECTILE_COUNT,
    damageRatio: R03_SIDE_PROJECTILE_DAMAGE_RATIO,
    source,
  };
}

export interface CraftedEffectsConfig {
  /** 成品唯一库存的只读查询口，通常直接传 `CraftedInventory.has`。 */
  readonly has: (itemId: CraftedItemId) => boolean;
}

/** 开发快照与测试读取的成品机制状态。 */
export interface CraftedMechanicsSnapshot {
  readonly r01Growth: number;
  readonly r01NormalKills: number;
  readonly r01CounterArmed: boolean;
  readonly r01CounterCooldownRemaining: number;
  /** 最近一次消耗的反击附加伤害；未触发过为 0。 */
  readonly r01LastCounterDamage: number;
  /** 本局已由 R02 生成的爆炸击杀小爆炸数量。 */
  readonly r02DeathExplosions: number;
  /** 本局已由 R03 生成的侧弹数量。 */
  readonly r03SideBullets: number;
  /** R04 已登记的成功技能施放次数。 */
  readonly r04CastCount: number;
  /** R04 距离下一次返还还差几次施放；未拥有时 0。 */
  readonly r04CastsUntilRefund: number;
  /** R04 最近一次返还的冷却秒数；未触发过为 0。 */
  readonly r04LastRefundSeconds: number;
  /** R04 本局累计返还的冷却秒数。 */
  readonly r04RefundTotalSeconds: number;
  /** R05 距离下一个小流形的秒数。 */
  readonly r05FlowformTimerSeconds: number;
  readonly r05FlowformActive: boolean;
  readonly r05FlowformRemainingSeconds: number;
  /** 本局已生成的小流形数量。 */
  readonly r05FlowformSpawns: number;
  /** R06 一次性首购折扣是否已使用。 */
  readonly r06FirstItemDiscountUsed: boolean;
  readonly r06FreeRerollsPerShop: number;
  readonly r06IntermissionHealMultiplier: number;
}

/**
 * V2 续局快照中的成品机制状态（US-065）：
 * R01 成长与普通击杀、受击蓄势/冷却，R02–R05 计数，R06 一次性首购折扣。
 */
export interface CraftedMechanicsSave {
  readonly r01Growth: number;
  readonly r01NormalKills: number;
  readonly r01CounterArmed: boolean;
  readonly r01CounterCooldownSeconds: number;
  readonly r02DeathExplosions: number;
  readonly r03SideBullets: number;
  readonly r04CastCount: number;
  readonly r04RefundTotalSeconds: number;
  readonly r05FlowformTimerSeconds: number;
  readonly r05FlowformSpawns: number;
  readonly r06FirstItemDiscountUsed: boolean;
}

function isCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function isSeconds(value: unknown, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max + TIME_EPSILON
  );
}

/** 快照校验：计数非负整数，成长不超过上限，冷却不超过各自间隔。 */
export function isCraftedMechanicsSave(
  value: unknown,
): value is CraftedMechanicsSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!isCount(record.r01Growth) || record.r01Growth > R01_GROWTH_CAP) {
    return false;
  }
  if (!isCount(record.r01NormalKills)) return false;
  if (typeof record.r01CounterArmed !== 'boolean') return false;
  if (!isSeconds(record.r01CounterCooldownSeconds, R01_COUNTER_INTERVAL_SECONDS)) {
    return false;
  }
  if (!isCount(record.r02DeathExplosions)) return false;
  if (!isCount(record.r03SideBullets)) return false;
  if (!isCount(record.r04CastCount)) return false;
  if (typeof record.r04RefundTotalSeconds !== 'number' ||
      !Number.isFinite(record.r04RefundTotalSeconds) ||
      record.r04RefundTotalSeconds < 0) {
    return false;
  }
  if (!isSeconds(record.r05FlowformTimerSeconds, R05_FLOWFORM_INTERVAL_SECONDS)) {
    return false;
  }
  if (!isCount(record.r05FlowformSpawns)) return false;
  if (typeof record.r06FirstItemDiscountUsed !== 'boolean') return false;
  return true;
}

/** R05 小流形在一个逻辑步中的推进结果；场景据此索敌与同步占位视觉。 */
export interface R05FlowformStepResult {
  /** 本步是否刚生成一只新小流形。 */
  readonly spawned: boolean;
  readonly active: boolean;
  readonly x: number;
  readonly y: number;
  readonly remainingSeconds: number;
  /** 本步到点的攻击次数（0 或更多）。 */
  readonly ticks: number;
}

const INACTIVE_FLOWFORM: R05FlowformStepResult = Object.freeze({
  spawned: false,
  active: false,
  x: 0,
  y: 0,
  remainingSeconds: 0,
  ticks: 0,
});

/** 小流形跟随玩家的站位偏移；与主流形左侧跟随位错开，避免视觉重叠。 */
const R05_FLOWFORM_OFFSET_X = 38;
const R05_FLOWFORM_OFFSET_Y = 14;

const TIME_EPSILON = 1e-9;

/**
 * R01–R03 的临时状态与触发逻辑。
 * 成品是否拥有仍以 `CraftedInventory` 为唯一真源，本类不保存副本。
 */
export class CraftedEffects {
  private readonly hasValue: (itemId: CraftedItemId) => boolean;
  private growthValue = 0;
  private normalKillsValue = 0;
  private counterArmedValue = false;
  private counterCooldownSeconds = 0;
  private lastCounterDamageValue = 0;
  private deathExplosionCountValue = 0;
  private sideBulletCountValue = 0;
  private r04CastCountValue = 0;
  private r04LastRefundValue = 0;
  private r04RefundTotalValue = 0;
  private r05TimerSeconds = R05_FLOWFORM_INTERVAL_SECONDS;
  private r05FlowformValue: {
    x: number;
    y: number;
    remainingSeconds: number;
    tickElapsedSeconds: number;
  } | null = null;
  private r05SpawnCountValue = 0;
  private r06FirstItemDiscountUsedValue = false;

  constructor(config: CraftedEffectsConfig) {
    this.hasValue = config.has;
  }

  /** R01 当前累计成长（0–120）。 */
  get r01Growth(): number {
    return this.growthValue;
  }

  /** R01 已累计的普通敌人击杀数（精英不计入该计数）。 */
  get r01NormalKills(): number {
    return this.normalKillsValue;
  }

  /** R01 反击是否已蓄势等待下一发 J。 */
  get r01CounterArmed(): boolean {
    return this.counterArmedValue;
  }

  /** R01 反击内置冷却剩余秒数。 */
  get r01CounterCooldownRemaining(): number {
    return this.counterCooldownSeconds;
  }

  /** R01 最近一次消耗的反击伤害；用于开发快照核对 5% 与 60 上限。 */
  get r01LastCounterDamage(): number {
    return this.lastCounterDamageValue;
  }

  /** R02 本局生成的爆炸击杀小爆炸数量。 */
  get r02DeathExplosions(): number {
    return this.deathExplosionCountValue;
  }

  /** R03 本局生成的侧弹数量。 */
  get r03SideBullets(): number {
    return this.sideBulletCountValue;
  }

  /** R04 已登记的成功技能施放次数。 */
  get r04CastCount(): number {
    return this.r04CastCountValue;
  }

  /** R04 距离下一次返还还差几次施放（含下一次）；未拥有 R04 时为 0。 */
  get r04CastsUntilRefund(): number {
    if (!this.hasValue('R04')) return 0;
    const remainder = this.r04CastCountValue % R04_REFUND_EVERY_CASTS;
    return R04_REFUND_EVERY_CASTS - remainder;
  }

  /** R04 最近一次返还的冷却秒数。 */
  get r04LastRefundSeconds(): number {
    return this.r04LastRefundValue;
  }

  /** R04 本局累计返还的冷却秒数。 */
  get r04RefundTotalSeconds(): number {
    return this.r04RefundTotalValue;
  }

  /** R05 距离下一个小流形的秒数。 */
  get r05FlowformTimerSeconds(): number {
    return Math.max(0, this.r05TimerSeconds);
  }

  /** R05 小流形是否在场。 */
  get r05FlowformActive(): boolean {
    return this.r05FlowformValue !== null;
  }

  /** R05 小流形剩余寿命；不在场为 0。 */
  get r05FlowformRemainingSeconds(): number {
    return Math.max(0, this.r05FlowformValue?.remainingSeconds ?? 0);
  }

  /** R05 本局已生成的小流形数量。 */
  get r05FlowformSpawns(): number {
    return this.r05SpawnCountValue;
  }

  /** R06 一次性首购折扣是否已使用。 */
  get r06FirstItemDiscountUsed(): boolean {
    return this.r06FirstItemDiscountUsedValue;
  }

  /** R06 每个商店的免费重抽次数；未拥有为 0。 */
  get freeRerollsPerShop(): number {
    return this.hasValue('R06') ? R06_FREE_REROLLS_PER_SHOP : 0;
  }

  /** R06 波后恢复倍率；未拥有为 1。 */
  get intermissionHealMultiplier(): number {
    return this.hasValue('R06') ? R06_INTERMISSION_HEAL_MULTIPLIER : 1;
  }

  /**
   * R06 首次购买永久道具的减价百分比；已使用或未拥有返回 0。
   * 只读，不消费；真正成交后由 `consumeFirstItemDiscount` 标记。
   */
  firstItemDiscountPercent(): number {
    if (!this.hasValue('R06')) return 0;
    if (this.r06FirstItemDiscountUsedValue) return 0;
    return R06_FIRST_ITEM_DISCOUNT_PERCENT;
  }

  /** 消费一次性首购折扣；返回实际应用的百分比，未应用返回 0。 */
  consumeFirstItemDiscount(): number {
    const percent = this.firstItemDiscountPercent();
    if (percent <= 0) return 0;
    this.r06FirstItemDiscountUsedValue = true;
    return percent;
  }

  /**
   * 登记一次击杀；返回本次实际获得的成长。
   * 未拥有 R01 或击杀被排除时返回 0；达到上限后不再增加。
   */
  registerKill(kind: R01GrowthKind): number {
    if (!this.hasValue('R01') || kind === 'excluded') return 0;
    if (kind === 'elite') {
      return this.addGrowth(R01_GROWTH_PER_ELITE_KILL);
    }
    this.normalKillsValue += 1;
    if (R01_GROWTH_EVERY_NORMAL_KILLS <= 0) return 0;
    if (this.normalKillsValue % R01_GROWTH_EVERY_NORMAL_KILLS !== 0) return 0;
    return this.addGrowth(R01_GROWTH_PER_NORMAL_KILL);
  }

  /**
   * 受到敌人有效命中后蓄势；内置冷却中或已蓄势时不重复触发。
   * 返回 true 表示本次受击第一次进入蓄势，场景可据此提示。
   */
  notifyEnemyHit(): boolean {
    if (!this.hasValue('R01')) return false;
    if (this.counterArmedValue) return false;
    if (this.counterCooldownSeconds > TIME_EPSILON) return false;
    this.counterArmedValue = true;
    this.counterCooldownSeconds = R01_COUNTER_INTERVAL_SECONDS;
    return true;
  }

  /**
   * 消耗蓄势并返回下一发 J 的反击附加物伤：
   * `min(最大生命 × 5%, 60)`；未蓄势返回 0。
   */
  consumeCounterBonus(maxHealth: number): number {
    if (!this.counterArmedValue) return 0;
    this.counterArmedValue = false;
    const ratio = Math.max(0, R01_COUNTER_MAX_HEALTH_RATIO);
    const cap = Math.max(0, R01_COUNTER_DAMAGE_CAP);
    const max = Number.isFinite(maxHealth) ? Math.max(0, maxHealth) : 0;
    const damage = Math.min(cap, max * ratio);
    this.lastCounterDamageValue = damage;
    return damage;
  }

  /** 推进反击内置冷却；只按逻辑步调用。 */
  step(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    if (this.counterCooldownSeconds <= 0) return;
    this.counterCooldownSeconds = Math.max(
      0,
      this.counterCooldownSeconds - seconds,
    );
  }

  /** 记录一次 R02 小爆炸的数量；只用于开发快照与测试。 */
  recordDeathExplosions(count: number): void {
    if (!Number.isFinite(count) || count <= 0) return;
    this.deathExplosionCountValue += Math.floor(count);
  }

  /** 记录一次 R03 侧弹的数量；只用于开发快照与测试。 */
  recordSideBullets(count: number): void {
    if (!Number.isFinite(count) || count <= 0) return;
    this.sideBulletCountValue += Math.floor(count);
  }

  /**
   * 登记一次成功技能施放（K/L/U/I）。
   * 返回 true 表示本次是每第 N 次施放，调用方应返还该技能当前冷却的 35%。
   * 未拥有 R04、E06 复施与冷却中失败的施放不调用本方法。
   */
  registerSkillCast(): boolean {
    if (!this.hasValue('R04')) return false;
    this.r04CastCountValue += 1;
    return this.r04CastCountValue % R04_REFUND_EVERY_CASTS === 0;
  }

  /** 记录一次实际返还的冷却秒数；只用于开发快照与测试。 */
  recordCooldownRefund(seconds: number): void {
    if (!this.hasValue('R04')) return;
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.r04LastRefundValue = seconds;
    this.r04RefundTotalValue += seconds;
  }

  /**
   * 推进 R05 小流形：每 12 秒生成一只持续 5 秒的小流形，并跟随玩家。
   * 返回本步是否生成与到点的攻击次数；索敌和伤害由场景消费，
   * 与 `TurretFieldState` 的“纯计时 + 场景结算”分工一致。
   */
  stepFlowform(
    seconds: number,
    player: { readonly x: number; readonly y: number },
  ): R05FlowformStepResult {
    if (!this.hasValue('R05')) {
      this.r05FlowformValue = null;
      this.r05TimerSeconds = R05_FLOWFORM_INTERVAL_SECONDS;
      return INACTIVE_FLOWFORM;
    }
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return this.flowformResult(false, 0);
    }

    this.r05TimerSeconds = Math.max(0, this.r05TimerSeconds - seconds);
    let spawned = false;
    if (this.r05TimerSeconds <= TIME_EPSILON) {
      this.r05TimerSeconds = R05_FLOWFORM_INTERVAL_SECONDS;
      this.r05FlowformValue = {
        x: player.x + R05_FLOWFORM_OFFSET_X,
        y: player.y + R05_FLOWFORM_OFFSET_Y,
        remainingSeconds: R05_FLOWFORM_DURATION_SECONDS,
        tickElapsedSeconds: 0,
      };
      this.r05SpawnCountValue += 1;
      spawned = true;
    }

    const flowform = this.r05FlowformValue;
    if (!flowform) return INACTIVE_FLOWFORM;

    // 跟随玩家；纯占位单位不参与圆形碰撞，避免挡路或卡住刷新点。
    flowform.x = player.x + R05_FLOWFORM_OFFSET_X;
    flowform.y = player.y + R05_FLOWFORM_OFFSET_Y;
    if (spawned) return this.flowformResult(true, 0);

    const effective = Math.min(seconds, flowform.remainingSeconds);
    flowform.remainingSeconds = Math.max(
      0,
      flowform.remainingSeconds - effective,
    );
    flowform.tickElapsedSeconds += effective;
    const interval = Math.max(
      TIME_EPSILON,
      R05_FLOWFORM_ATTACK_INTERVAL_SECONDS,
    );
    const ticks = Math.floor(flowform.tickElapsedSeconds / interval + TIME_EPSILON);
    if (ticks > 0) flowform.tickElapsedSeconds -= ticks * interval;

    const active = flowform.remainingSeconds > TIME_EPSILON;
    if (!active) this.r05FlowformValue = null;
    return {
      spawned: false,
      active,
      x: flowform.x,
      y: flowform.y,
      remainingSeconds: active ? flowform.remainingSeconds : 0,
      ticks,
    };
  }

  private flowformResult(
    spawned: boolean,
    ticks: number,
  ): R05FlowformStepResult {
    const flowform = this.r05FlowformValue;
    if (!flowform) {
      return { ...INACTIVE_FLOWFORM, spawned };
    }
    return {
      spawned,
      active: flowform.remainingSeconds > TIME_EPSILON,
      x: flowform.x,
      y: flowform.y,
      remainingSeconds: Math.max(0, flowform.remainingSeconds),
      ticks,
    };
  }

  /** 新开一局时清空成长、蓄势与演示计数。 */
  reset(): void {
    this.growthValue = 0;
    this.normalKillsValue = 0;
    this.counterArmedValue = false;
    this.counterCooldownSeconds = 0;
    this.lastCounterDamageValue = 0;
    this.deathExplosionCountValue = 0;
    this.sideBulletCountValue = 0;
    this.r04CastCountValue = 0;
    this.r04LastRefundValue = 0;
    this.r04RefundTotalValue = 0;
    this.r05TimerSeconds = R05_FLOWFORM_INTERVAL_SECONDS;
    this.r05FlowformValue = null;
    this.r05SpawnCountValue = 0;
    this.r06FirstItemDiscountUsedValue = false;
  }

  snapshot(): CraftedMechanicsSnapshot {
    return {
      r01Growth: this.growthValue,
      r01NormalKills: this.normalKillsValue,
      r01CounterArmed: this.counterArmedValue,
      r01CounterCooldownRemaining: this.counterCooldownSeconds,
      r01LastCounterDamage: this.lastCounterDamageValue,
      r02DeathExplosions: this.deathExplosionCountValue,
      r03SideBullets: this.sideBulletCountValue,
      r04CastCount: this.r04CastCountValue,
      r04CastsUntilRefund: this.r04CastsUntilRefund,
      r04LastRefundSeconds: this.r04LastRefundValue,
      r04RefundTotalSeconds: this.r04RefundTotalValue,
      r05FlowformTimerSeconds: this.r05FlowformTimerSeconds,
      r05FlowformActive: this.r05FlowformActive,
      r05FlowformRemainingSeconds: this.r05FlowformRemainingSeconds,
      r05FlowformSpawns: this.r05SpawnCountValue,
      r06FirstItemDiscountUsed: this.r06FirstItemDiscountUsedValue,
      r06FreeRerollsPerShop: this.freeRerollsPerShop,
      r06IntermissionHealMultiplier: this.intermissionHealMultiplier,
    };
  }

  /** V2 快照：只保存成长、受击蓄势与机制计数，成品拥有仍由库存单独保存。 */
  saveSnapshot(): CraftedMechanicsSave {
    return {
      r01Growth: this.growthValue,
      r01NormalKills: this.normalKillsValue,
      r01CounterArmed: this.counterArmedValue,
      r01CounterCooldownSeconds: this.counterCooldownSeconds,
      r02DeathExplosions: this.deathExplosionCountValue,
      r03SideBullets: this.sideBulletCountValue,
      r04CastCount: this.r04CastCountValue,
      r04RefundTotalSeconds: this.r04RefundTotalValue,
      r05FlowformTimerSeconds: this.r05FlowformTimerSeconds,
      r05FlowformSpawns: this.r05SpawnCountValue,
      r06FirstItemDiscountUsed: this.r06FirstItemDiscountUsedValue,
    };
  }

  /**
   * 从续局快照恢复成长与机制计数；缺省/损坏时归零。
   * 快照已由 run-save 校验，这里再做一次防御性检查，避免测试直接传坏值。
   */
  restore(save: CraftedMechanicsSave | null | undefined): void {
    this.reset();
    if (!isCraftedMechanicsSave(save)) return;
    this.growthValue = save.r01Growth;
    this.normalKillsValue = save.r01NormalKills;
    this.counterArmedValue = save.r01CounterArmed;
    this.counterCooldownSeconds = save.r01CounterCooldownSeconds;
    this.deathExplosionCountValue = save.r02DeathExplosions;
    this.sideBulletCountValue = save.r03SideBullets;
    this.r04CastCountValue = save.r04CastCount;
    this.r04RefundTotalValue = save.r04RefundTotalSeconds;
    this.r05TimerSeconds = save.r05FlowformTimerSeconds;
    this.r05SpawnCountValue = save.r05FlowformSpawns;
    this.r06FirstItemDiscountUsedValue = save.r06FirstItemDiscountUsed;
  }

  private addGrowth(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const remaining = Math.max(0, R01_GROWTH_CAP - this.growthValue);
    const gained = Math.min(remaining, amount);
    this.growthValue += gained;
    return gained;
  }
}
