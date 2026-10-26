/**
 * 波次推进与波末奖励顺序（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md`：
 * - 第 1–17 波普通敌人配额 `12 + 3 × 波数`，在本波 65% 时长前完成定额刷怪；
 * - 普通波时长 `30 + 2 × 波数` 秒，精英波再加 8 秒；Boss 波没有时间到即过关；
 * - 第 6/9/12/15 波各 1 名精英，生命取固定初值 600/1000/1600/2400；
 * - 精英沿用基础敌人的行为，伤害叠加波次倍率与精英倍率；
 * - 第 18 波为唯一 Boss 波；
 * - 清空当前波才进入波末，顺序：吸取经验 → 波末简报 → 宝箱 → 精英核心 →
 *   升级/海克斯 → 机制 → 商店（第 1–17 波）。
 */
import {
  ELITE_DAMAGE_MULTIPLIER,
  WAVE_SPAWN_WINDOW_RATIO,
  getEnemy,
  getWave,
  remainingEnemyCapacity,
  waveDamageMultiplier,
  waveHealthMultiplier,
  type EliteDefinition,
  type EnemyDefinition,
  type WaveDefinition,
} from './data';
import type { WaveClockSnapshot } from './world-snapshot';
import type { ChestOfferDraw } from './chest-offer';
import {
  RewardQueue,
  type RewardEntry,
  type RewardStatus,
} from './rewards';

const TIME_EPSILON = 1e-9;

/**
 * 按波次倍率派生普通敌人定义。
 * 精英与 Boss 的生命是固定初值，不吃普通怪波次生命缩放；伤害仍按波次增长。
 */
export function scaleEnemyForWave(
  enemy: EnemyDefinition,
  wave: number,
): EnemyDefinition {
  const fixedHealth = enemy.behavior === 'boss' || enemy.elite === true;
  const healthMultiplier = fixedHealth ? 1 : waveHealthMultiplier(wave);
  const damageMultiplier = waveDamageMultiplier(wave);

  return {
    ...enemy,
    maxHealth: enemy.maxHealth * healthMultiplier,
    contactDamage: enemy.contactDamage * damageMultiplier,
    attack: enemy.attack
      ? { ...enemy.attack, damage: enemy.attack.damage * damageMultiplier }
      : undefined,
  };
}

/**
 * 按精英配置派生敌人定义：
 * - 生命固定为配置初值，不叠加普通波成长；
 * - 伤害仍随波次增长，并叠加精英伤害倍率；
 * - 写入唯一精英 ID 与核心奖励绑定，供击败时记录资格。
 */
export function scaleEliteForWave(
  elite: EliteDefinition,
  wave: number,
): EnemyDefinition {
  const base = getEnemy(elite.enemyId);
  const damageMultiplier = waveDamageMultiplier(wave) * ELITE_DAMAGE_MULTIPLIER;

  return {
    ...base,
    maxHealth: elite.maxHealth,
    contactDamage: base.contactDamage * damageMultiplier,
    attack: base.attack
      ? { ...base.attack, damage: base.attack.damage * damageMultiplier }
      : undefined,
    elite: true,
    eliteId: elite.id,
    coreRewardId: elite.coreRewardId,
    eliteWave: elite.wave,
  };
}

export interface WaveSpawnRequest {
  /** 已按波次倍率缩放的敌人定义；Boss 保持基础数值。 */
  readonly enemy: EnemyDefinition;
  readonly isElite: boolean;
  /** Boss 波唯一首领；普通与精英为 false。 */
  readonly isBoss: boolean;
  /** 本波第几个普通敌人（用于分散出生方位）；Boss 为 0。 */
  readonly spawnIndex: number;
}

export interface WaveStepContext {
  /** 当前仍存活的敌人数量。 */
  readonly aliveEnemyCount: number;
  /** 已排入 0.8 秒出生提示、尚未落地的敌人数量。 */
  readonly pendingEnemyCount: number;
}

export interface WaveStepResult {
  readonly spawned: readonly WaveSpawnRequest[];
  readonly cleared: boolean;
  /** 本步因倒计时归零而过关；调用方需移除残余敌人/弹体且不发放击杀奖励。 */
  readonly timedOut: boolean;
}

/**
 * 单波运行器：把定额敌人均匀铺在本波 65% 时长内，精英在窗口中点加入。
 * 第 1–17 波在「配额全部刷完、落地并清空」或「倒计时归零」时过关；
 * 第 18 波没有超时过关，必须击败 Boss。
 */
export class WaveRunner {
  readonly definition: WaveDefinition;

  private elapsed = 0;
  private nextNormalIndex = 0;
  private eliteSpawned = false;
  private bossSpawned = false;
  private clearedValue = false;
  private timedOutValue = false;

  constructor(wave: number | WaveDefinition) {
    this.definition = typeof wave === 'number' ? getWave(wave) : wave;
  }

  get wave(): number {
    return this.definition.wave;
  }

  get elapsedSeconds(): number {
    return this.elapsed;
  }

  get cleared(): boolean {
    return this.clearedValue;
  }

  /** 本波是否因倒计时归零而结束。 */
  get timedOut(): boolean {
    return this.timedOutValue;
  }

  /** 本波倒计时总秒数；Boss 波为 0（无时限）。 */
  get durationSeconds(): number {
    return Math.max(0, this.definition.durationSeconds);
  }

  /** 是否按倒计时结束本波；Boss 波恒为 false。 */
  get hasTimeLimit(): boolean {
    return this.definition.kind !== 'boss' && this.durationSeconds > 0;
  }

  /** 倒计时剩余秒数；Boss 波返回 0，由调用方显示“无时限”。 */
  get remainingSeconds(): number {
    if (!this.hasTimeLimit) return 0;
    return Math.max(0, this.durationSeconds - this.elapsed);
  }

  /** 常规敌人刷怪窗口：本波时长的 65%。 */
  get spawnWindowSeconds(): number {
    return this.durationSeconds * WAVE_SPAWN_WINDOW_RATIO;
  }

  get normalSpawnedCount(): number {
    return this.nextNormalIndex;
  }

  get eliteSpawnedCount(): number {
    return this.eliteSpawned ? this.definition.eliteCount : 0;
  }

  get remainingToSpawn(): number {
    if (this.definition.kind === 'boss') {
      return this.bossSpawned ? 0 : 1;
    }
    return (
      this.definition.enemyCount -
      this.nextNormalIndex +
      (this.definition.eliteCount - this.eliteSpawnedCount)
    );
  }

  /** 第 index 个普通敌人的预定出生时间：均匀分布在 65% 时长窗口内。 */
  spawnTimeForIndex(index: number): number {
    const count = this.definition.enemyCount;
    const window = this.spawnWindowSeconds;
    if (count <= 0 || window <= 0) return 0;
    return (index * window) / count;
  }

  /** 波中快照：已推进的波内时钟与刷怪进度。 */
  snapshotWorld(): WaveClockSnapshot {
    return {
      elapsedSeconds: this.elapsed,
      nextNormalIndex: this.nextNormalIndex,
      eliteSpawned: this.eliteSpawned,
      bossSpawned: this.bossSpawned,
    };
  }

  /**
   * 从波中快照恢复：时钟与已刷出进度直接写回，刷新后不重复刷同一批敌人。
   * 非法或越界进度被钳制到本波定义范围内。
   */
  restoreWorld(state: WaveClockSnapshot): void {
    this.elapsed = Number.isFinite(state.elapsedSeconds)
      ? Math.max(0, state.elapsedSeconds)
      : 0;
    this.nextNormalIndex = Number.isInteger(state.nextNormalIndex)
      ? Math.min(Math.max(0, state.nextNormalIndex), this.definition.enemyCount)
      : 0;
    this.eliteSpawned = state.eliteSpawned === true;
    this.bossSpawned =
      this.definition.kind === 'boss' ? state.bossSpawned === true : false;
    this.clearedValue = false;
    this.timedOutValue = false;
  }

  /** 精英出生时间取刷怪窗口中点。 */
  get eliteSpawnTime(): number {
    return this.spawnWindowSeconds / 2;
  }

  step(stepSeconds: number, context: WaveStepContext): WaveStepResult {
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds) || this.clearedValue) {
      return {
        spawned: [],
        cleared: this.clearedValue,
        timedOut: false,
      };
    }

    this.elapsed += stepSeconds;
    const spawned: WaveSpawnRequest[] = [];
    // 同屏上限：存活与待落地都计数；满额时暂停生成，保留未刷出的配额。
    const capacity = remainingEnemyCapacity(
      context.aliveEnemyCount,
      context.pendingEnemyCount,
    );

    if (
      this.definition.kind === 'boss' &&
      !this.bossSpawned &&
      this.definition.bossId
    ) {
      // Boss 使用基础数值，不叠加普通波的生命/伤害倍率。
      this.bossSpawned = true;
      spawned.push({
        enemy: getEnemy(this.definition.bossId),
        isElite: false,
        isBoss: true,
        spawnIndex: 0,
      });
    }

    // 精英优先占用名额，避免持续满员时普通怪先占满而让精英一直排不进来。
    if (
      this.definition.eliteCount > 0 &&
      !this.eliteSpawned &&
      this.definition.elite &&
      spawned.length < capacity &&
      this.elapsed + TIME_EPSILON >= this.eliteSpawnTime
    ) {
      this.eliteSpawned = true;
      spawned.push({
        enemy: scaleEliteForWave(this.definition.elite, this.wave),
        isElite: true,
        isBoss: false,
        spawnIndex: this.definition.enemyCount,
      });
    }

    while (
      spawned.length < capacity &&
      this.nextNormalIndex < this.definition.enemyCount &&
      this.elapsed + TIME_EPSILON >= this.spawnTimeForIndex(this.nextNormalIndex)
    ) {
      const index = this.nextNormalIndex;
      const enemyId =
        this.definition.roster[index % Math.max(1, this.definition.roster.length)];
      if (enemyId) {
        spawned.push({
          enemy: scaleEnemyForWave(getEnemy(enemyId), this.wave),
          isElite: false,
          isBoss: false,
          spawnIndex: index,
        });
      }
      this.nextNormalIndex += 1;
    }

    const allSpawned = this.remainingToSpawn === 0;
    const pendingAfterStep = context.pendingEnemyCount + spawned.length;
    // Boss 波由首领击败判定结束，不按“刷怪完成且无小怪”自动清空，也没有超时。
    if (
      !this.clearedValue &&
      this.definition.kind !== 'boss' &&
      allSpawned &&
      pendingAfterStep <= 0 &&
      context.aliveEnemyCount <= 0
    ) {
      this.clearedValue = true;
    }

    // 倒计时归零同样过关；必须先让本步伤害/死亡结算完，场景再清残余。
    if (
      !this.clearedValue &&
      this.hasTimeLimit &&
      this.elapsed + TIME_EPSILON >= this.durationSeconds
    ) {
      this.clearedValue = true;
      this.timedOutValue = true;
    }

    return {
      spawned,
      cleared: this.clearedValue,
      timedOut: this.timedOutValue,
    };
  }
}

/**
 * 波末奖励阶段，顺序固定：
 * 吸取经验（瞬时）→ 波末简报 → 宝箱 → 精英核心 → 升级/海克斯 → 机制 → 商店/波间。
 */
export type WaveRewardStage =
  | 'none'
  | 'absorb'
  | 'briefing'
  | 'chest'
  | 'core'
  | 'upgrade'
  | 'mechanic'
  | 'intermission';

/** 波末可由快照稳定恢复的阶段；`none`/`absorb` 是瞬时阶段。 */
const RESTORABLE_REWARD_STAGES: ReadonlySet<WaveRewardStage> =
  new Set<WaveRewardStage>([
    'briefing',
    'chest',
    'core',
    'upgrade',
    'mechanic',
    'intermission',
  ]);

/** 本波额外产生的资格来源；宝箱由 US-016 接入，核心来自指定精英。 */
export interface WaveRewardEligibility {
  readonly chestIds?: readonly string[];
  readonly coreIds?: readonly string[];
  /**
   * 已在资格生成时固定的宝箱候选，按宝箱实例 ID 索引。
   * 由场景用 `reward` 随机流抽取后传入，队列只保存结果，不再重抽。
   */
  readonly chestOffers?: ReadonlyMap<string, ChestOfferDraw>;
  /**
   * 已在资格生成时固定的核心候选项，按核心奖励 ID 索引。
   * 由场景用 `reward` 随机流抽取后传入，恢复时不重抽。
   */
  readonly coreOffers?: ReadonlyMap<string, readonly string[]>;
}

/**
 * 波末奖励流转：阶段只由外部显式完成推进，便于验证顺序与冻结。
 *
 * 升级/海克斯资格按 `pendingLevelUps` 逐个入队；宝箱与精英核心资格由调用方
 * 传入来源 ID。队列条目带唯一 ID 与领取状态，可整体写入续局快照。
 * 第 3/6 波的机制选择排在升级之后；全部处理完才进入商店（波间）。
 */
export class WaveRewardFlow {
  readonly wave: number;

  private stageValue: WaveRewardStage = 'none';
  private pendingLevelUpsValue = 0;
  private readonly rewards = new RewardQueue();

  constructor(wave: number) {
    getWave(wave);
    this.wave = wave;
  }

  get stage(): WaveRewardStage {
    return this.stageValue;
  }

  get isActive(): boolean {
    return this.stageValue !== 'none';
  }

  get pendingLevelUps(): number {
    return this.pendingLevelUpsValue;
  }

  /** 升级/海克斯之外还有多少份待领取资格（含当前面板）。 */
  get remainingRewards(): number {
    return this.rewards.remainingCount;
  }

  /** 当前待处理的奖励条目；升级/机制阶段用于标题，宝箱/核心阶段用于面板。 */
  get currentReward(): RewardEntry | null {
    return this.rewards.current;
  }

  /** 完整队列快照，含已领取/已放弃状态。 */
  get rewardQueueSnapshot(): RewardEntry[] {
    return this.rewards.snapshot();
  }

  get needsMechanicChoice(): boolean {
    return this.wave === 3 || this.wave === 6;
  }

  /** 波清空：进入吸取阶段；清空上一波残留的队列。 */
  begin(pendingLevelUps: number): WaveRewardStage {
    this.rewards.reset();
    this.stageValue = 'absorb';
    this.pendingLevelUpsValue = Math.max(0, Math.floor(pendingLevelUps));
    return this.stageValue;
  }

  /**
   * 吸取完成（含波末自动吸取产生的升级）：按固定顺序建立整个奖励队列，
   * 先停在波末简报，等玩家确认后才开始逐个领取。
   */
  completeAbsorb(
    pendingLevelUps: number,
    eligibility: WaveRewardEligibility = {},
  ): WaveRewardStage {
    if (this.stageValue !== 'absorb') return this.stageValue;
    this.pendingLevelUpsValue = Number.isFinite(pendingLevelUps)
      ? Math.max(0, Math.floor(pendingLevelUps))
      : 0;
    this.buildRewardQueue(eligibility);
    this.stageValue = 'briefing';
    return this.stageValue;
  }

  /** 简报确认后进入第一份待领取资格；没有资格则直接进入商店。 */
  completeBriefing(): WaveRewardStage {
    if (this.stageValue !== 'briefing') return this.stageValue;
    return this.advanceToCurrent();
  }

  /** 领取当前宝箱资格；核心阶段请统一用 `resolveCurrent`。 */
  completeChest(): WaveRewardStage {
    if (this.stageValue !== 'chest') return this.stageValue;
    this.rewards.resolveCurrent('claimed');
    return this.advanceToCurrent();
  }

  /**
   * 确认或放弃当前资格。宝箱/核心/升级/机制都走同一入口；
   * 升级仍由 `completeUpgrade` 负责同步 `pendingLevelUps`。
   */
  resolveCurrent(status: RewardStatus): WaveRewardStage {
    const current = this.rewards.current;
    if (!current) return this.advanceToCurrent();
    if (this.stageValue !== current.kind) return this.stageValue;
    if (current.kind === 'upgrade') return this.completeUpgrade();
    if (current.kind === 'mechanic') return this.completeMechanic();
    this.rewards.resolve(current.id, status);
    return this.advanceToCurrent();
  }

  /** 完成一次升级三选一；队列清空后才允许继续。 */
  completeUpgrade(): WaveRewardStage {
    if (this.stageValue !== 'upgrade') return this.stageValue;
    const current = this.rewards.current;
    // 旧快照可能只有计数没有队列条目；匹配时一并标记，避免重领。
    if (current?.kind === 'upgrade') this.rewards.claim(current.id);
    this.pendingLevelUpsValue = Math.max(0, this.pendingLevelUpsValue - 1);
    if (this.pendingLevelUpsValue === 0) {
      // 防御：计数与条目短暂不一致时，剩余升级条目不能把商店挡在后面。
      for (const entry of this.rewards.pendingEntries) {
        if (entry.kind === 'upgrade') this.rewards.claim(entry.id);
      }
    }
    return this.advanceToCurrent();
  }

  completeMechanic(): WaveRewardStage {
    if (this.stageValue !== 'mechanic') return this.stageValue;
    const current = this.rewards.current;
    if (current?.kind === 'mechanic') this.rewards.claim(current.id);
    return this.advanceToCurrent();
  }

  completeIntermission(): WaveRewardStage {
    if (this.stageValue === 'intermission') {
      this.stageValue = 'none';
      this.rewards.reset();
    }
    return this.stageValue;
  }

  /**
   * 续局恢复：直接写入奖励阶段与队列，不重放吸取/补给。
   * 只接受会落盘的稳定阶段；瞬时 `none`/`absorb` 不恢复。
   */
  restore(
    stage: WaveRewardStage,
    pendingLevelUps: number,
    entries?: readonly RewardEntry[],
  ): WaveRewardStage {
    if (!RESTORABLE_REWARD_STAGES.has(stage)) return this.stageValue;
    this.stageValue = stage;
    this.pendingLevelUpsValue = Number.isFinite(pendingLevelUps)
      ? Math.max(0, Math.floor(pendingLevelUps))
      : 0;
    this.rewards.reset();
    if (entries) this.rewards.restore(entries);

    // 旧快照没有奖励队列字段：按阶段补出最小队列，保证还能继续处理。
    if (!entries) this.synthesizeRestoredQueue(stage);
    // 快照阶段与队列不一致时退回到当前条目，避免面板卡死。
    if (
      (stage === 'chest' || stage === 'core') &&
      this.rewards.current?.kind !== stage
    ) {
      this.stageValue = this.rewards.current?.kind ?? 'briefing';
    }
    return this.stageValue;
  }

  private advanceToCurrent(): WaveRewardStage {
    const current = this.rewards.current;
    this.stageValue = current ? current.kind : 'intermission';
    return this.stageValue;
  }

  private buildRewardQueue(eligibility: WaveRewardEligibility): void {
    for (const sourceId of eligibility.chestIds ?? []) {
      const offer = eligibility.chestOffers?.get(sourceId);
      this.rewards.enqueue(
        'chest',
        `chest:${sourceId}`,
        sourceId,
        offer
          ? { offers: offer.itemIds, fallbackGold: offer.fallbackGold }
          : undefined,
      );
    }
    for (const sourceId of eligibility.coreIds ?? []) {
      const offers = eligibility.coreOffers?.get(sourceId);
      const accepted = this.rewards.enqueue(
        'core',
        `core:${sourceId}`,
        sourceId,
        offers ? { coreOffers: offers } : undefined,
      );
      // 候选非法时不能静默丢掉整条核心资格：退回无候选条目，
      // 至少保留领取入口（面板显示“没有可用核心候选”）。
      if (!accepted && offers) {
        this.rewards.enqueue('core', `core:${sourceId}`, sourceId);
      }
    }
    for (let index = 0; index < this.pendingLevelUpsValue; index += 1) {
      this.rewards.enqueue(
        'upgrade',
        `upgrade:${this.wave}:${index + 1}`,
      );
    }
    if (this.needsMechanicChoice) {
      this.rewards.enqueue('mechanic', `mechanic:${this.wave}`);
    }
  }

  private synthesizeRestoredQueue(stage: WaveRewardStage): void {
    if (stage === 'upgrade') {
      for (let index = 0; index < this.pendingLevelUpsValue; index += 1) {
        this.rewards.enqueue(
          'upgrade',
          `upgrade:${this.wave}:restored-${index + 1}`,
        );
      }
    } else if (stage === 'mechanic') {
      this.rewards.enqueue('mechanic', `mechanic:${this.wave}`);
    }
  }
}
