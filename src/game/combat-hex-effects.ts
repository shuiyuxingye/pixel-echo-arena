/**
 * 通用触发/循环类海克斯 H01/H02/H06/H07/H08/H13/H14/H16/H21（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/02-content-catalog.md` §48 种海克斯：
 * - H01 双倍委托：U/I 的第一次施放不进冷却，每波每个槽位各一次；
 * - H02 余烬之路：闪避期间沿移动路径留下 2 秒火路，每秒 18 法术伤害；
 * - H06 滑步开火：闪避结束后 1.5 秒内 J 攻击速度 +50%；
 * - H07 分身礼炮：召唤物消失时 50 法伤爆破，每秒全局最多 2 次；
 * - H08 冷却银行：U/I 都就绪时每 4 秒存一层（最多 3 层），
 *   施放技能消耗全部层数，每层让本次冷却少 10%；
 * - H13 追击扳机：连续命中同一目标每次 +4% 伤害，上限 +24%，换目标重置；
 * - H14 折返弹：每第三发 J 到最远距离后折返一次，返程伤害 35%，不触发额外弹；
 * - H16 连携时刻：与上一次施放的槽位不同时，本次技能伤害 +25%；
 *   只统计真实施放，E06 复施等触发型效果由场景跳过本入口，不能继续计数；
 * - H21 漂浮弹幕：每 12 次 J 命中发出 8 向各 22 法伤弹，触发弹不计数；
 * - H05 不动要塞：站定满 1 秒后护甲 +30，移动立即移除；
 * - H11 以伤换金：每波第一次受到敌人伤害获得 15 金币（自伤不经过本入口）；
 * - H17 护盾呼吸：3 秒未受伤后每秒获得 3 护盾，上限 30，受伤中断；
 * - H18 濒危爆发：生命首次低于 35% 时对半径 140 内敌人造成 120 法伤，每波一次；
 * - H22 精英收藏：击败精英后永久 +6% 伤害，获取前击败的精英不追溯；
 * - H24 多重保险：每波首次致命伤消耗 60 金币抵消并给 1 秒无敌，每局最多 2 次。
 *
 * 拥有关系仍以 `HexRun.has` 为唯一真源；本模块不保存层数副本。
 * 每波开始由场景调用 `resetForWave()` 清空首施标记、银行层数、闪避增益、
 * 连携链、H13 连击以及 H05/H11/H17/H18/H24 的每波状态；
 * H14 发射计数、H21 命中计数、H22 精英击杀数与 H24 每局次数跨波累计。
 */
import type { TriggerGateRule } from './trigger-gates';
import type { DamageChainTracker } from './damage-events';
import type { CombatEventSource } from './damage-events';
import type { FreeSkillSlotKey } from './free-skills';

/** 本模块落地的 15 种通用触发/循环海克斯。 */
export const COMBAT_HEX_IDS = [
  'H01',
  'H02',
  'H05',
  'H06',
  'H07',
  'H08',
  'H11',
  'H13',
  'H14',
  'H16',
  'H17',
  'H18',
  'H21',
  'H22',
  'H24',
] as const;

export type CombatHexId = (typeof COMBAT_HEX_IDS)[number];

const COMBAT_HEX_ID_SET: ReadonlySet<string> = new Set(COMBAT_HEX_IDS);

export function isCombatHexId(hexId: string): hexId is CombatHexId {
  return COMBAT_HEX_ID_SET.has(hexId);
}

/** 单张通用触发海克斯的数值；百分比字段以百分点书写。 */
export interface CombatHexParams {
  /** H01：每波每个槽位的不进冷却次数。 */
  readonly freeCastsPerWavePerSlot?: number;
  /** H02：火路火焰寿命（秒）。 */
  readonly trailDurationSeconds?: number;
  /** H02：火路每秒法术伤害。 */
  readonly damagePerSecond?: number;
  /** H02：火路伤害结算间隔（秒）。 */
  readonly tickSeconds?: number;
  /** H02：闪避中相邻两团火焰的最小移动距离（逻辑像素）。 */
  readonly strideDistance?: number;
  /** H02：单团火焰的作用半径（逻辑像素）。 */
  readonly radius?: number;
  /** H06：闪避结束后的攻击速度加成（百分点）。 */
  readonly attackSpeedPercent?: number;
  /** H06：加成持续秒数。 */
  readonly buffDurationSeconds?: number;
  /** H07：召唤物消失时的爆破法术伤害。 */
  readonly summonBlastDamage?: number;
  /** H07：爆破半径（02 未给出，取 100 逻辑像素）。 */
  readonly summonBlastRadius?: number;
  /** H07：每秒全局最多触发次数。 */
  readonly summonBlastPerSecond?: number;
  /** H08：存一层的间隔秒数。 */
  readonly chargeIntervalSeconds?: number;
  /** H08：银行最多层数。 */
  readonly maxCharges?: number;
  /** H08：每层减免本次冷却的百分点。 */
  readonly cooldownReductionPercentPerCharge?: number;
  /** H13：每次连续命中同一目标的增伤百分点。 */
  readonly damagePercentPerConsecutiveHit?: number;
  /** H13：连续命中增伤上限百分点。 */
  readonly maxDamagePercent?: number;
  /** H14：每第几发 J 获得一次折返。 */
  readonly returnEveryNthShot?: number;
  /** H14：返程伤害比例。 */
  readonly returnDamageRatio?: number;
  /** H16：连携成功时本次技能伤害加成（百分点）。 */
  readonly damagePercent?: number;
  /** H21：触发一次弹幕所需的 J 命中次数。 */
  readonly barrageHitInterval?: number;
  /** H21：弹幕方向数。 */
  readonly barrageProjectileCount?: number;
  /** H21：每枚弹幕弹的法术伤害。 */
  readonly barrageDamagePerProjectile?: number;
  /** H21：弹幕射程（02 未给出，取 220 逻辑像素）。 */
  readonly barrageRange?: number;
  /** H05：站定多少秒后获得护甲。 */
  readonly standSeconds?: number;
  /** H05：站定满足条件后的护甲加成。 */
  readonly armorBonus?: number;
  /** H11：每波首次受敌人伤害获得的金币。 */
  readonly damageGold?: number;
  /** H17：连续未受伤多少秒后开始生成护盾。 */
  readonly idleSeconds?: number;
  /** H17：每秒生成的护盾。 */
  readonly shieldPerSecond?: number;
  /** H17：H17 自身生成护盾的上限。 */
  readonly maxShield?: number;
  /** H18：触发时生命低于生命上限的百分比（百分点）。 */
  readonly healthThresholdPercent?: number;
  /** H18：爆发半径（逻辑像素）。 */
  readonly burstRadius?: number;
  /** H18：爆发法术伤害。 */
  readonly burstDamage?: number;
  /** H22：每次击败精英获得的永久伤害加成（百分点）。 */
  readonly eliteDamagePercent?: number;
  /** H24：每次抵消致命伤消耗的金币。 */
  readonly lethalGoldCost?: number;
  /** H24：抵消后获得的无敌秒数。 */
  readonly lethalInvulnerableSeconds?: number;
  /** H24：每局最多触发次数。 */
  readonly maxLethalSavesPerRun?: number;
}

/** 15 种通用触发/循环类海克斯的数值；与 02 内容目录逐项对应。 */
export const COMBAT_HEX_PARAMS: Readonly<
  Record<CombatHexId, CombatHexParams>
> = {
  // 目录只写「每波各限一次」与火路寿命/伤害；步距与半径取 S04 火路的近邻值。
  H01: { freeCastsPerWavePerSlot: 1 },
  H02: {
    trailDurationSeconds: 2,
    damagePerSecond: 18,
    tickSeconds: 1,
    strideDistance: 36,
    radius: 44,
  },
  H05: { standSeconds: 1, armorBonus: 30 },
  H06: { attackSpeedPercent: 50, buffDurationSeconds: 1.5 },
  // 02 只写「50 法伤爆破 / 每秒全局最多 2 次」，爆破半径取 100。
  H07: { summonBlastDamage: 50, summonBlastRadius: 100, summonBlastPerSecond: 2 },
  H08: {
    chargeIntervalSeconds: 4,
    maxCharges: 3,
    cooldownReductionPercentPerCharge: 10,
  },
  H11: { damageGold: 15 },
  H13: { damagePercentPerConsecutiveHit: 4, maxDamagePercent: 24 },
  H14: { returnEveryNthShot: 3, returnDamageRatio: 0.35 },
  H16: { damagePercent: 25 },
  H17: { idleSeconds: 3, shieldPerSecond: 3, maxShield: 30 },
  H18: { healthThresholdPercent: 35, burstRadius: 140, burstDamage: 120 },
  // 02 只写「8 向各 22 法伤」；射程取 220，与 J 的 250–290 射程区分。
  H21: {
    barrageHitInterval: 12,
    barrageProjectileCount: 8,
    barrageDamagePerProjectile: 22,
    barrageRange: 220,
  },
  H22: { eliteDamagePercent: 6 },
  H24: {
    lethalGoldCost: 60,
    lethalInvulnerableSeconds: 1,
    maxLethalSavesPerRun: 2,
  },
};

/** H07 的统一触发闸门规则：同一秒内跨所有召唤物最多 2 次爆破。 */
export const H07_TRIGGER_RULE: TriggerGateRule = {
  id: 'H07',
  perSecond: COMBAT_HEX_PARAMS.H07.summonBlastPerSecond ?? 2,
};

const H02_DURATION = COMBAT_HEX_PARAMS.H02.trailDurationSeconds ?? 2;
const H02_TICK_SECONDS = COMBAT_HEX_PARAMS.H02.tickSeconds ?? 1;
const H02_STRIDE = COMBAT_HEX_PARAMS.H02.strideDistance ?? 36;
const H02_MAX_PATCHES = 48;

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/** 单团 H02 火焰的只读快照。 */
export interface EmberTrailPatch {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly remainingSeconds: number;
}

/**
 * H02 火路：闪避开始与之后每移动 `strideDistance` 落一团火。
 * 每团火独立存活 2 秒；伤害按「本次闪避」的来源每秒结算一次，
 * 因此同一敌人站在多团重叠火焰里仍然只吃一层 18 法伤。
 */
export class EmberTrailState {
  private patchesList: {
    id: number;
    x: number;
    y: number;
    remainingSeconds: number;
  }[] = [];
  private tickElapsedSeconds = 0;
  private firedTicks = 0;
  private lastPosition: { x: number; y: number } | null = null;
  private distanceSinceDrop = 0;
  private nextPatchId = 1;
  private dodging = false;

  /** 闪避开始：落第一团火并打开铺设。 */
  begin(position: { readonly x: number; readonly y: number }): void {
    this.dodging = true;
    this.lastPosition = { x: position.x, y: position.y };
    this.distanceSinceDrop = 0;
    this.dropPatch(position);
  }

  /** 闪避结束：保留已有火焰自然到期，不再补火。 */
  end(): void {
    this.dodging = false;
    this.lastPosition = null;
  }

  get isActive(): boolean {
    return this.patchesList.length > 0;
  }

  get patchCount(): number {
    return this.patchesList.length;
  }

  get ticksFired(): number {
    return this.firedTicks;
  }

  /** 最晚消失的火焰剩余秒数。 */
  get remainingSecondsLeft(): number {
    return Math.max(0, ...this.patchesList.map((patch) => patch.remainingSeconds));
  }

  patches(): EmberTrailPatch[] {
    return this.patchesList.map((patch) => ({ ...patch }));
  }

  /** 单次 tick 对同一敌人的伤害（未乘抗性/减伤）。 */
  damagePerTick(): number {
    return COMBAT_HEX_PARAMS.H02.damagePerSecond ?? 18;
  }

  /**
   * 推进一个逻辑步：按移动距离补火、减少火焰寿命，并返回本步应结算的 tick 数。
   * `position` 只在闪避中传入；闪避结束后传入 null，已有火焰继续计时。
   */
  step(
    seconds: number,
    position: { readonly x: number; readonly y: number } | null,
  ): number {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return 0;
    const activeSeconds = this.remainingSecondsLeft;

    if (this.dodging && position) {
      if (!this.lastPosition) {
        this.lastPosition = { x: position.x, y: position.y };
        this.distanceSinceDrop = 0;
        this.dropPatch(position);
      } else {
        const dx = position.x - this.lastPosition.x;
        const dy = position.y - this.lastPosition.y;
        this.distanceSinceDrop += Math.sqrt(dx * dx + dy * dy);
        this.lastPosition = { x: position.x, y: position.y };
        // 大步长或瞬移时只补一团，余下距离保留到下一步，避免同点刷屏。
        if (this.distanceSinceDrop >= H02_STRIDE) {
          this.distanceSinceDrop %= H02_STRIDE;
          this.dropPatch(position);
        }
      }
    }

    for (const patch of this.patchesList) {
      patch.remainingSeconds = Math.max(0, patch.remainingSeconds - seconds);
    }
    this.patchesList = this.patchesList.filter(
      (patch) => patch.remainingSeconds > 1e-9,
    );

    if (activeSeconds <= 1e-9) {
      this.tickElapsedSeconds = 0;
      return 0;
    }

    this.tickElapsedSeconds += Math.min(seconds, activeSeconds);
    let ticks = 0;
    while (this.tickElapsedSeconds + 1e-9 >= H02_TICK_SECONDS) {
      this.tickElapsedSeconds -= H02_TICK_SECONDS;
      ticks += 1;
    }
    this.firedTicks += ticks;
    return ticks;
  }

  reset(): void {
    this.patchesList = [];
    this.tickElapsedSeconds = 0;
    this.firedTicks = 0;
    this.lastPosition = null;
    this.distanceSinceDrop = 0;
    this.dodging = false;
  }

  private dropPatch(position: { readonly x: number; readonly y: number }): void {
    if (this.patchesList.length >= H02_MAX_PATCHES) {
      this.patchesList.shift();
    }
    this.patchesList.push({
      id: this.nextPatchId,
      x: position.x,
      y: position.y,
      remainingSeconds: H02_DURATION,
    });
    this.nextPatchId += 1;
  }
}

export interface CombatHexEffectsConfig {
  readonly has: (hexId: string) => boolean;
}

/** H08 银行状态快照。 */
export interface CooldownBankSnapshot {
  readonly charges: number;
  readonly maxCharges: number;
  readonly accumulatedSeconds: number;
  readonly cooldownScale: number;
  readonly consumedTotal: number;
}

/** H01 首施状态快照；`available` 表示本波该槽位是否还能免费施放。 */
export interface FirstFreeCastSnapshot {
  readonly available: Record<FreeSkillSlotKey, boolean>;
  readonly used: Record<FreeSkillSlotKey, boolean>;
}

/** H06 闪避后攻速窗口快照。 */
export interface DodgeAttackSnapshot {
  readonly active: boolean;
  readonly remainingSeconds: number;
  readonly attackSpeedMultiplier: number;
}

/** H16 连携快照。 */
export interface ComboSnapshot {
  readonly lastSlot: FreeSkillSlotKey | null;
  /** 交替施放时本次技能的伤害倍率（拥有 H16 为 1.25）。 */
  readonly damageMultiplierOnAlternate: number;
  readonly triggers: number;
}

/** H13 连续命中快照。 */
export interface HitStreakSnapshot {
  readonly targetId: string | null;
  /** 对当前目标的连续命中次数；换目标或波初归零。 */
  readonly streak: number;
  /** 下一次命中当前目标时的伤害倍率；无连击时为 1。 */
  readonly damageMultiplier: number;
  readonly maxDamagePercent: number;
}

/** H14 折返弹快照。 */
export interface ReturnShotSnapshot {
  readonly everyNthShot: number;
  /** 本局已发射的原生 J 数；跨波累计。 */
  readonly shotsFired: number;
  /** 本局已实际开始折返的弹体数。 */
  readonly returnsStarted: number;
  readonly returnDamageRatio: number;
  /** 下一发 J 是否折返。 */
  readonly nextShotReturns: boolean;
}

/** H21 漂浮弹幕快照。 */
export interface BarrageSnapshot {
  /** 本局已登记的 J 命中数；跨波累计。 */
  readonly jHits: number;
  readonly hitInterval: number;
  readonly triggers: number;
  readonly projectileCount: number;
  readonly damagePerProjectile: number;
  readonly range: number;
}

/** H05 不动要塞快照。 */
export interface StationaryFortressSnapshot {
  readonly active: boolean;
  readonly standSeconds: number;
  readonly requiredSeconds: number;
  readonly armorBonus: number;
}

/** H11 以伤换金快照。 */
export interface HurtForGoldSnapshot {
  readonly usedThisWave: boolean;
  readonly gold: number;
}

/** H17 护盾呼吸快照。 */
export interface ShieldBreathingSnapshot {
  readonly idleSeconds: number;
  readonly requiredSeconds: number;
  /** H17 自身仍留在护盾池里的护盾。 */
  readonly shield: number;
  readonly maxShield: number;
  readonly shieldPerSecond: number;
}

/** H18 濒危爆发快照。 */
export interface LowHealthBurstSnapshot {
  readonly usedThisWave: boolean;
  readonly thresholdPercent: number;
  readonly radius: number;
  readonly damage: number;
}

/** H22 精英收藏快照。 */
export interface EliteCollectionSnapshot {
  /** 本局获取 H22 后击败的精英数；获取前的击杀不追溯。 */
  readonly eliteKills: number;
  /** 当前永久伤害加成比例（0.06 = +6%）。 */
  readonly damageBonus: number;
}

/** H24 多重保险快照。 */
export interface LethalInsuranceSnapshot {
  readonly usedThisWave: boolean;
  readonly savesThisRun: number;
  readonly maxSavesPerRun: number;
  readonly goldCost: number;
  readonly invulnerableSeconds: number;
}

/** H24 致命伤保命判定结果。 */
export interface LethalSaveResult {
  readonly triggered: boolean;
  readonly goldCost: number;
  readonly invulnerableSeconds: number;
}

/** 开发快照用：15 种通用触发类海克斯的实时状态。 */
export interface CombatHexSnapshot {
  readonly hexes: readonly string[];
  readonly emberTrail: {
    readonly active: boolean;
    readonly patches: readonly EmberTrailPatch[];
    readonly ticksFired: number;
    readonly damagePerSecond: number;
    readonly radius: number;
    readonly remainingSeconds: number;
  };
  readonly firstFreeCast: FirstFreeCastSnapshot;
  readonly cooldownBank: CooldownBankSnapshot;
  readonly dodgeAttack: DodgeAttackSnapshot;
  readonly combo: ComboSnapshot;
  /** H07 静态参数；闸门实时计数在 `triggerGates`。 */
  readonly summonBlast: {
    readonly damage: number;
    readonly radius: number;
    readonly perSecond: number;
  };
  readonly hitStreak: HitStreakSnapshot;
  readonly returnShot: ReturnShotSnapshot;
  readonly barrage: BarrageSnapshot;
  readonly stationaryFortress: StationaryFortressSnapshot;
  readonly hurtForGold: HurtForGoldSnapshot;
  readonly shieldBreathing: ShieldBreathingSnapshot;
  readonly lowHealthBurst: LowHealthBurstSnapshot;
  readonly eliteCollection: EliteCollectionSnapshot;
  readonly lethalInsurance: LethalInsuranceSnapshot;
}

/**
 * 一局内 15 种通用触发/循环海克斯的运行状态。
 * 所有派生值在读取时按当前拥有集合计算，拥有关系来自 `HexRun`。
 */
export class CombatHexEffects {
  private readonly hasHex: (hexId: string) => boolean;
  private readonly emberTrailState = new EmberTrailState();
  private firstCastUsed: Record<FreeSkillSlotKey, boolean> = {
    U: false,
    I: false,
  };
  private bankAccumulatedSeconds = 0;
  private bankChargesValue = 0;
  private bankConsumedTotal = 0;
  private dodgeBuffRemainingSeconds = 0;
  private lastCastSlotValue: FreeSkillSlotKey | null = null;
  private comboTriggers = 0;
  /** H13：当前连续命中的目标与次数。 */
  private hitStreakTargetId: string | null = null;
  private hitStreakValue = 0;
  /** H14：本局已发射的原生 J 数（跨波累计）。 */
  private jShotsFiredValue = 0;
  private returnsStartedValue = 0;
  /** H21：本局 J 命中计数与弹幕触发次数（跨波累计）。 */
  private jHitsValue = 0;
  private barrageTriggersValue = 0;
  /** H05：连续站定秒数。 */
  private standSecondsValue = 0;
  /** H11：本波是否已经因受敌伤获得金币。 */
  private hurtForGoldUsedThisWave = false;
  /** H17：连续未受伤秒数、自上次受伤后已发放的层数与自身护盾余额。 */
  private shieldIdleSecondsValue = 0;
  private shieldGrantsSinceIdle = 0;
  private breathingShieldValue = 0;
  /** H18：本波是否已经触发过低血爆发。 */
  private lowHealthBurstUsedThisWave = false;
  /** H22：获取 H22 后击败的精英数；跨波累计。 */
  private eliteKillsValue = 0;
  /** H24：本波致命伤保命是否已用，以及本局已用次数。 */
  private lethalSaveUsedThisWave = false;
  private lethalSavesThisRun = 0;

  constructor(config: CombatHexEffectsConfig) {
    this.hasHex = config.has;
  }

  has(hexId: string): boolean {
    return this.hasHex(hexId);
  }

  /** 当前拥有的通用触发类海克斯，保持目录顺序。 */
  get ownedIds(): CombatHexId[] {
    return COMBAT_HEX_IDS.filter((hexId) => this.hasHex(hexId));
  }

  /** H02 火路状态；场景只读快照与步进。 */
  get emberTrail(): EmberTrailState {
    return this.emberTrailState;
  }

  /** H02：闪避开始，落第一团火。未拥有时不产生任何火焰。 */
  beginDodge(position: { readonly x: number; readonly y: number }): void {
    if (!this.hasHex('H02')) return;
    this.emberTrailState.begin(position);
  }

  /** H02：闪避结束，已有火焰继续自然到期。 */
  endDodge(): void {
    this.emberTrailState.end();
  }

  /**
   * H02：推进火路并返回本步 tick 数。只有闪避中才按位置补火；
   * 未拥有 H02 时不生成新火焰，但已存在的火焰仍会走完寿命（防御性口径）。
   */
  stepEmberTrail(
    seconds: number,
    position: { readonly x: number; readonly y: number } | null,
  ): number {
    if (!this.hasHex('H02') && !this.emberTrailState.isActive) return 0;
    return this.emberTrailState.step(seconds, position);
  }

  /** H02 火路伤害链来源；每次闪避开始时由场景建立一次。 */
  beginEmberTrailSource(chains: DamageChainTracker): CombatEventSource {
    return chains.beginNative('H02');
  }

  /** 本波该槽位是否还能享受 H01 的免费首施。 */
  firstFreeCastAvailable(slot: FreeSkillSlotKey): boolean {
    return (
      this.hasHex('H01') &&
      (COMBAT_HEX_PARAMS.H01.freeCastsPerWavePerSlot ?? 1) > 0 &&
      !this.firstCastUsed[slot]
    );
  }

  /** 施放成功后调用：消耗本波该槽位的免费首施。 */
  markFirstFreeCastUsed(slot: FreeSkillSlotKey): void {
    if (!this.hasHex('H01')) return;
    this.firstCastUsed[slot] = true;
  }

  /** H08 当前银行层数。 */
  get bankCharges(): number {
    return this.bankChargesValue;
  }

  /** H08：本次施放的冷却倍率；无层数或未拥有时为 1。 */
  get bankCooldownScale(): number {
    if (!this.hasHex('H08') || this.bankChargesValue <= 0) return 1;
    const reduction =
      positive(COMBAT_HEX_PARAMS.H08.cooldownReductionPercentPerCharge, 10) /
      100;
    return Math.max(0, 1 - reduction * this.bankChargesValue);
  }

  /**
   * H08：施放技能后消耗全部层数，返回消耗层数。
   * 未拥有 H08 时恒为 0；H01 免费施放同样消耗层数（本次冷却为 0，收益作废）。
   */
  consumeBankCharges(): number {
    if (!this.hasHex('H08')) return 0;
    const consumed = this.bankChargesValue;
    this.bankChargesValue = 0;
    this.bankAccumulatedSeconds = 0;
    this.bankConsumedTotal += consumed;
    return consumed;
  }

  /**
   * 推进 H06 窗口与 H08 存储。
   * `bothSkillsReady` 为 U/I 都装备且冷却为 0；不成立时银行计时归零。
   */
  stepTimers(seconds: number, bothSkillsReady: boolean): void {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return;

    if (this.dodgeBuffRemainingSeconds > 0) {
      this.dodgeBuffRemainingSeconds = Math.max(
        0,
        this.dodgeBuffRemainingSeconds - seconds,
      );
    }

    if (!this.hasHex('H08')) return;
    const maxCharges = Math.max(
      1,
      Math.floor(COMBAT_HEX_PARAMS.H08.maxCharges ?? 3),
    );
    if (!bothSkillsReady || this.bankChargesValue >= maxCharges) {
      this.bankAccumulatedSeconds = 0;
      return;
    }
    const interval = positive(COMBAT_HEX_PARAMS.H08.chargeIntervalSeconds, 4);
    this.bankAccumulatedSeconds += seconds;
    while (
      this.bankAccumulatedSeconds + 1e-9 >= interval &&
      this.bankChargesValue < maxCharges
    ) {
      this.bankAccumulatedSeconds -= interval;
      this.bankChargesValue += 1;
    }
    if (this.bankChargesValue >= maxCharges) this.bankAccumulatedSeconds = 0;
  }

  /** H06：闪避结束，开启 1.5 秒攻速窗口。 */
  activateDodgeAttackBuff(): void {
    if (!this.hasHex('H06')) return;
    this.dodgeBuffRemainingSeconds = positive(
      COMBAT_HEX_PARAMS.H06.buffDurationSeconds,
      1.5,
    );
  }

  get dodgeAttackBuffRemaining(): number {
    return this.dodgeBuffRemainingSeconds;
  }

  /** H06 的攻速倍率；窗口结束立即回到 1。 */
  get dodgeAttackSpeedMultiplier(): number {
    if (!this.hasHex('H06') || this.dodgeBuffRemainingSeconds <= 0) return 1;
    const percent =
      positive(COMBAT_HEX_PARAMS.H06.attackSpeedPercent, 50) / 100;
    return 1 + percent;
  }

  /**
   * H16：登记一次真实技能施放，返回本次技能伤害倍率。
   * 槽位与上一次不同（交替）时本次 +25%；同槽重复不触发并重置链。
   * 未拥有 H16、E06 复施等触发型效果不经过本入口。
   */
  registerSkillCast(slot: FreeSkillSlotKey): number {
    if (!this.hasHex('H16')) return 1;
    const alternated =
      this.lastCastSlotValue !== null && this.lastCastSlotValue !== slot;
    this.lastCastSlotValue = slot;
    if (!alternated) return 1;
    this.comboTriggers += 1;
    const percent = positive(COMBAT_HEX_PARAMS.H16.damagePercent, 25) / 100;
    return 1 + percent;
  }

  /** 上一个真实施放的槽位；未施放或波初为 null。 */
  get lastCastSlot(): FreeSkillSlotKey | null {
    return this.lastCastSlotValue;
  }

  /**
   * H14：登记一次原生 J 发射，返回本发是否应在射程终点折返。
   * 只统计主弹；I14 分裂、R03 侧弹与 G06 回响等派生弹不经过本入口。
   */
  registerJShot(): boolean {
    if (!this.hasHex('H14')) return false;
    const every = Math.max(
      1,
      Math.floor(COMBAT_HEX_PARAMS.H14.returnEveryNthShot ?? 3),
    );
    this.jShotsFiredValue += 1;
    return this.jShotsFiredValue % every === 0;
  }

  /** H14：场景实际让一发弹体调头时登记，供开发快照核对。 */
  recordReturnStart(): void {
    this.returnsStartedValue += 1;
  }

  /** 下一发 J 是否折返；用于 HUD 与开发快照。 */
  get nextShotReturns(): boolean {
    if (!this.hasHex('H14')) return false;
    const every = Math.max(
      1,
      Math.floor(COMBAT_HEX_PARAMS.H14.returnEveryNthShot ?? 3),
    );
    return (this.jShotsFiredValue + 1) % every === 0;
  }

  /**
   * H13/H21：登记一次原生 J 命中。
   * 返回本次命中的 H13 伤害倍率，以及本次是否凑满 H21 的 12 次弹幕。
   * 折返弹与 H21 触发弹不经过本入口，因此不会自我计数。
   */
  registerJHit(targetId: string): {
    readonly damageMultiplier: number;
    readonly barrage: boolean;
  } {
    let damageMultiplier = 1;
    if (this.hasHex('H13')) {
      if (this.hitStreakTargetId === targetId) {
        this.hitStreakValue += 1;
      } else {
        this.hitStreakTargetId = targetId;
        this.hitStreakValue = 1;
      }
      damageMultiplier = this.hitStreakDamageMultiplier();
    }

    let barrage = false;
    if (this.hasHex('H21')) {
      const every = Math.max(
        1,
        Math.floor(COMBAT_HEX_PARAMS.H21.barrageHitInterval ?? 12),
      );
      this.jHitsValue += 1;
      if (this.jHitsValue % every === 0) {
        this.barrageTriggersValue += 1;
        barrage = true;
      }
    }

    return { damageMultiplier, barrage };
  }

  /** H13：当前连击提供的伤害倍率；无连击时为 1。 */
  private hitStreakDamageMultiplier(): number {
    if (!this.hasHex('H13') || this.hitStreakValue <= 1) return 1;
    const perHit =
      positive(COMBAT_HEX_PARAMS.H13.damagePercentPerConsecutiveHit, 4) / 100;
    const max = positive(COMBAT_HEX_PARAMS.H13.maxDamagePercent, 24) / 100;
    return 1 + Math.min((this.hitStreakValue - 1) * perHit, max);
  }

  /** H13：下一次命中当前目标时的伤害倍率。 */
  get hitStreakDamageMultiplierValue(): number {
    return this.hitStreakDamageMultiplier();
  }

  // ---------------------------------------------------------------- H05

  /** H05：已连续站定的秒数。 */
  get standSeconds(): number {
    return this.standSecondsValue;
  }

  /**
   * H05：推进站定计时。`moved` 为本逻辑步实际位移大于 0；
   * 一旦移动立即清零，站定满 1 秒后由 `stationaryArmorBonus` 返回 +30。
   */
  stepStationary(seconds: number, moved: boolean): void {
    if (!this.hasHex('H05')) {
      this.standSecondsValue = 0;
      return;
    }
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.standSecondsValue = moved ? 0 : this.standSecondsValue + seconds;
  }

  /** H05：站定满 1 秒时的护甲加成；移动或未拥有时为 0。 */
  get stationaryArmorBonus(): number {
    if (!this.hasHex('H05')) return 0;
    const required = positive(COMBAT_HEX_PARAMS.H05.standSeconds, 1);
    if (this.standSecondsValue + 1e-9 < required) return 0;
    return positive(COMBAT_HEX_PARAMS.H05.armorBonus, 30);
  }

  // ---------------------------------------------------------------- H11/H17

  /**
   * 玩家受到一次敌人伤害后的统一入口：H11 每波首次返 15 金币；
   * 同时中断 H17 的呼吸计时，并按本次护盾吸收量扣减 H17 自身护盾。
   * 自伤、无敌期与零伤害不经过本入口。
   */
  registerPlayerDamage(shieldAbsorbed: number): number {
    this.shieldIdleSecondsValue = 0;
    this.shieldGrantsSinceIdle = 0;
    if (this.hasHex('H17')) {
      const absorbed =
        Number.isFinite(shieldAbsorbed) && shieldAbsorbed > 0
          ? shieldAbsorbed
          : 0;
      this.breathingShieldValue = Math.max(
        0,
        this.breathingShieldValue - absorbed,
      );
    }
    if (!this.hasHex('H11') || this.hurtForGoldUsedThisWave) return 0;
    this.hurtForGoldUsedThisWave = true;
    return Math.max(0, COMBAT_HEX_PARAMS.H11.damageGold ?? 15);
  }

  /** 本波是否已经触发过 H11。 */
  get hurtForGoldUsed(): boolean {
    return this.hurtForGoldUsedThisWave;
  }

  /**
   * H17：推进护盾呼吸，返回本步应加入护盾池的量。
   * 连续 3 秒未受伤后，每满 1 秒生成 3 护盾；H17 自身贡献上限 30。
   * 受伤会清零计时与已发放层数，但已存在的护盾保留。
   */
  stepShieldBreathing(seconds: number): number {
    if (!this.hasHex('H17')) {
      this.shieldIdleSecondsValue = 0;
      this.shieldGrantsSinceIdle = 0;
      return 0;
    }
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;

    this.shieldIdleSecondsValue += seconds;
    const idleRequired = positive(COMBAT_HEX_PARAMS.H17.idleSeconds, 3);
    if (this.shieldIdleSecondsValue + 1e-9 < idleRequired) return 0;

    const perSecond = positive(COMBAT_HEX_PARAMS.H17.shieldPerSecond, 3);
    const cap = positive(COMBAT_HEX_PARAMS.H17.maxShield, 30);
    const maxGrants = Math.ceil(cap / perSecond);
    let granted = 0;
    while (this.shieldGrantsSinceIdle < maxGrants) {
      // 第 n 层在“3 秒 + (n−1) 秒”时发放：满 3 秒立即拿到第一层。
      const dueAt = idleRequired + this.shieldGrantsSinceIdle;
      if (this.shieldIdleSecondsValue + 1e-9 < dueAt) break;
      this.shieldGrantsSinceIdle += 1;
      const capacity = cap - this.breathingShieldValue;
      if (capacity <= 0) break;
      const amount = Math.min(perSecond, capacity);
      this.breathingShieldValue += amount;
      granted += amount;
    }
    return granted;
  }

  /** H17 自身仍留在护盾池里的护盾量。 */
  get breathingShield(): number {
    return this.breathingShieldValue;
  }

  // ---------------------------------------------------------------- H18

  /**
   * H18：生命首次低于 35% 时标记本波触发。调用方负责实际的半径 140、
   * 120 法伤结算；已死或本波已触发时返回 false。
   */
  tryLowHealthBurst(health: number, maxHealth: number): boolean {
    if (!this.hasHex('H18') || this.lowHealthBurstUsedThisWave) return false;
    if (
      !Number.isFinite(health) ||
      !Number.isFinite(maxHealth) ||
      maxHealth <= 0 ||
      health <= 0
    ) {
      return false;
    }
    const thresholdPercent = positive(
      COMBAT_HEX_PARAMS.H18.healthThresholdPercent,
      35,
    );
    // 严格「低于」：恰好 35% 不触发；用整数比较避开浮点边界。
    if (health * 100 + 1e-9 >= maxHealth * thresholdPercent) return false;
    this.lowHealthBurstUsedThisWave = true;
    return true;
  }

  get lowHealthBurstUsed(): boolean {
    return this.lowHealthBurstUsedThisWave;
  }

  // ---------------------------------------------------------------- H22

  /**
   * H22：登记一次精英击杀。返回本次获得的伤害加成（0.06）；
   * 未拥有 H22 时不计入，因此获取前击败的精英天然不追溯。
   */
  registerEliteKill(): number {
    if (!this.hasHex('H22')) return 0;
    this.eliteKillsValue += 1;
    return positive(COMBAT_HEX_PARAMS.H22.eliteDamagePercent, 6) / 100;
  }

  /** H22：获取后击败的精英数。 */
  get eliteKills(): number {
    return this.eliteKillsValue;
  }

  /** H22：当前永久伤害加成比例；未拥有或未击杀时为 0。 */
  get eliteDamageBonus(): number {
    if (!this.hasHex('H22')) return 0;
    return (
      (positive(COMBAT_HEX_PARAMS.H22.eliteDamagePercent, 6) / 100) *
      this.eliteKillsValue
    );
  }

  // ---------------------------------------------------------------- H24

  /**
   * H24：致命伤保命判定。每波首次、每局最多 2 次，且金币必须足够 60；
   * 成功时立即消费次数并返回应扣金币与无敌时长，扣款由场景完成。
   * 调用方必须先让 E03 判定失败，保证一次致命事件只触发一个保命效果。
   */
  tryLethalSave(gold: number): LethalSaveResult {
    const none: LethalSaveResult = {
      triggered: false,
      goldCost: 0,
      invulnerableSeconds: 0,
    };
    if (!this.hasHex('H24') || this.lethalSaveUsedThisWave) return none;
    const maxSaves = Math.max(
      1,
      Math.floor(COMBAT_HEX_PARAMS.H24.maxLethalSavesPerRun ?? 2),
    );
    if (this.lethalSavesThisRun >= maxSaves) return none;
    const goldCost = Math.max(0, COMBAT_HEX_PARAMS.H24.lethalGoldCost ?? 60);
    if (!Number.isFinite(gold) || gold < goldCost) return none;

    this.lethalSaveUsedThisWave = true;
    this.lethalSavesThisRun += 1;
    return {
      triggered: true,
      goldCost,
      invulnerableSeconds: positive(
        COMBAT_HEX_PARAMS.H24.lethalInvulnerableSeconds,
        1,
      ),
    };
  }

  /** 波初清空所有每波资源；H14/H21/H22 的计数与拥有集合不在此重置。 */
  resetForWave(): void {
    this.firstCastUsed = { U: false, I: false };
    this.bankAccumulatedSeconds = 0;
    this.bankChargesValue = 0;
    this.bankConsumedTotal = 0;
    this.dodgeBuffRemainingSeconds = 0;
    this.lastCastSlotValue = null;
    this.comboTriggers = 0;
    this.emberTrailState.reset();
    // H13 的连击链不跨波：新一波的第一个目标从 1 倍开始。
    this.hitStreakTargetId = null;
    this.hitStreakValue = 0;
    // H05/H11/H17/H18/H24 的每波条件重新开始；护盾余额与每局次数保留。
    this.standSecondsValue = 0;
    this.hurtForGoldUsedThisWave = false;
    this.shieldIdleSecondsValue = 0;
    this.shieldGrantsSinceIdle = 0;
    this.lowHealthBurstUsedThisWave = false;
    this.lethalSaveUsedThisWave = false;
  }

  /** 新开一局：连 H14/H21/H22/H24 的跨波计数一并归零。 */
  reset(): void {
    this.resetForWave();
    this.jShotsFiredValue = 0;
    this.returnsStartedValue = 0;
    this.jHitsValue = 0;
    this.barrageTriggersValue = 0;
    this.breathingShieldValue = 0;
    this.eliteKillsValue = 0;
    this.lethalSavesThisRun = 0;
  }

  snapshot(): CombatHexSnapshot {
    return {
      hexes: this.ownedIds,
      emberTrail: {
        active: this.emberTrailState.isActive,
        patches: this.emberTrailState.patches(),
        ticksFired: this.emberTrailState.ticksFired,
        damagePerSecond: this.emberTrailState.damagePerTick(),
        radius: COMBAT_HEX_PARAMS.H02.radius ?? 44,
        remainingSeconds: this.emberTrailState.remainingSecondsLeft,
      },
      firstFreeCast: {
        available: {
          U: this.firstFreeCastAvailable('U'),
          I: this.firstFreeCastAvailable('I'),
        },
        used: { U: this.firstCastUsed.U, I: this.firstCastUsed.I },
      },
      cooldownBank: {
        charges: this.bankChargesValue,
        maxCharges: Math.max(1, Math.floor(COMBAT_HEX_PARAMS.H08.maxCharges ?? 3)),
        accumulatedSeconds: this.bankAccumulatedSeconds,
        cooldownScale: this.bankCooldownScale,
        consumedTotal: this.bankConsumedTotal,
      },
      dodgeAttack: {
        active: this.dodgeAttackBuffRemaining > 0,
        remainingSeconds: this.dodgeAttackBuffRemaining,
        attackSpeedMultiplier: this.dodgeAttackSpeedMultiplier,
      },
      combo: {
        lastSlot: this.lastCastSlotValue,
        damageMultiplierOnAlternate:
          1 + (COMBAT_HEX_PARAMS.H16.damagePercent ?? 25) / 100,
        triggers: this.comboTriggers,
      },
      summonBlast: {
        damage: COMBAT_HEX_PARAMS.H07.summonBlastDamage ?? 50,
        radius: COMBAT_HEX_PARAMS.H07.summonBlastRadius ?? 100,
        perSecond: COMBAT_HEX_PARAMS.H07.summonBlastPerSecond ?? 2,
      },
      hitStreak: {
        targetId: this.hitStreakTargetId,
        streak: this.hitStreakValue,
        damageMultiplier: this.hitStreakDamageMultiplier(),
        maxDamagePercent: COMBAT_HEX_PARAMS.H13.maxDamagePercent ?? 24,
      },
      returnShot: {
        everyNthShot: COMBAT_HEX_PARAMS.H14.returnEveryNthShot ?? 3,
        shotsFired: this.jShotsFiredValue,
        returnsStarted: this.returnsStartedValue,
        returnDamageRatio: COMBAT_HEX_PARAMS.H14.returnDamageRatio ?? 0.35,
        nextShotReturns: this.nextShotReturns,
      },
      barrage: {
        jHits: this.jHitsValue,
        hitInterval: COMBAT_HEX_PARAMS.H21.barrageHitInterval ?? 12,
        triggers: this.barrageTriggersValue,
        projectileCount: COMBAT_HEX_PARAMS.H21.barrageProjectileCount ?? 8,
        damagePerProjectile:
          COMBAT_HEX_PARAMS.H21.barrageDamagePerProjectile ?? 22,
        range: COMBAT_HEX_PARAMS.H21.barrageRange ?? 220,
      },
      stationaryFortress: {
        active: this.stationaryArmorBonus > 0,
        standSeconds: this.standSecondsValue,
        requiredSeconds: COMBAT_HEX_PARAMS.H05.standSeconds ?? 1,
        armorBonus: this.stationaryArmorBonus,
      },
      hurtForGold: {
        usedThisWave: this.hurtForGoldUsedThisWave,
        gold: COMBAT_HEX_PARAMS.H11.damageGold ?? 15,
      },
      shieldBreathing: {
        idleSeconds: this.shieldIdleSecondsValue,
        requiredSeconds: COMBAT_HEX_PARAMS.H17.idleSeconds ?? 3,
        shield: this.breathingShieldValue,
        maxShield: COMBAT_HEX_PARAMS.H17.maxShield ?? 30,
        shieldPerSecond: COMBAT_HEX_PARAMS.H17.shieldPerSecond ?? 3,
      },
      lowHealthBurst: {
        usedThisWave: this.lowHealthBurstUsedThisWave,
        thresholdPercent:
          COMBAT_HEX_PARAMS.H18.healthThresholdPercent ?? 35,
        radius: COMBAT_HEX_PARAMS.H18.burstRadius ?? 140,
        damage: COMBAT_HEX_PARAMS.H18.burstDamage ?? 120,
      },
      eliteCollection: {
        eliteKills: this.eliteKillsValue,
        damageBonus: this.eliteDamageBonus,
      },
      lethalInsurance: {
        usedThisWave: this.lethalSaveUsedThisWave,
        savesThisRun: this.lethalSavesThisRun,
        maxSavesPerRun:
          COMBAT_HEX_PARAMS.H24.maxLethalSavesPerRun ?? 2,
        goldCost: COMBAT_HEX_PARAMS.H24.lethalGoldCost ?? 60,
        invulnerableSeconds:
          COMBAT_HEX_PARAMS.H24.lethalInvulnerableSeconds ?? 1,
      },
    };
  }
}
