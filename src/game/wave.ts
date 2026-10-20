/**
 * 波次推进与波末奖励顺序（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/game-design.md` §6.1、§7：
 * - 第 1–8 波普通敌人数 12/16/18/22/26/28/32/36，前 30 秒完成定额刷怪；
 * - 生命倍率 `1 + 0.12 × (波数−1)`、伤害倍率 `1 + 0.06 × (波数−1)`；
 * - 第 3/6 波额外 1 精英，精英生命 ×3、伤害 ×1.3；
 * - 清空当前波才进入波间，波末顺序：吸取经验 → 升级选择 → 机制选择 → 波间补给。
 */
import {
  ELITE_DAMAGE_MULTIPLIER,
  ELITE_HEALTH_MULTIPLIER,
  getEnemy,
  getWave,
  waveDamageMultiplier,
  waveHealthMultiplier,
  type EnemyDefinition,
  type WaveDefinition,
} from './data';
import type { WaveClockSnapshot } from './world-snapshot';

/** 每波定额刷怪的完成窗口。 */
export const WAVE_SPAWN_WINDOW_SECONDS = 30;

const TIME_EPSILON = 1e-9;

/** 按波次倍率派生敌人定义；精英再叠加生命 ×3、伤害 ×1.3。 */
export function scaleEnemyForWave(
  enemy: EnemyDefinition,
  wave: number,
  elite = false,
): EnemyDefinition {
  const healthMultiplier =
    waveHealthMultiplier(wave) * (elite ? ELITE_HEALTH_MULTIPLIER : 1);
  const damageMultiplier =
    waveDamageMultiplier(wave) * (elite ? ELITE_DAMAGE_MULTIPLIER : 1);

  return {
    ...enemy,
    maxHealth: enemy.maxHealth * healthMultiplier,
    contactDamage: enemy.contactDamage * damageMultiplier,
    attack: enemy.attack
      ? { ...enemy.attack, damage: enemy.attack.damage * damageMultiplier }
      : undefined,
    elite: elite || undefined,
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
}

/**
 * 单波运行器：把定额敌人均匀铺在 30 秒窗口内，精英在窗口中点加入。
 * 只有全部敌人刷完、落地并清空后才判定 `cleared`。
 */
export class WaveRunner {
  readonly definition: WaveDefinition;

  private elapsed = 0;
  private nextNormalIndex = 0;
  private eliteSpawned = false;
  private bossSpawned = false;
  private clearedValue = false;

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

  /** 第 index 个普通敌人的预定出生时间：均匀分布在 30 秒内。 */
  spawnTimeForIndex(index: number): number {
    const count = this.definition.enemyCount;
    if (count <= 0) return 0;
    return (index * WAVE_SPAWN_WINDOW_SECONDS) / count;
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
  }

  /** 精英出生时间取刷怪窗口中点。 */
  get eliteSpawnTime(): number {
    return WAVE_SPAWN_WINDOW_SECONDS / 2;
  }

  step(stepSeconds: number, context: WaveStepContext): WaveStepResult {
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) {
      return { spawned: [], cleared: this.clearedValue };
    }

    this.elapsed += stepSeconds;
    const spawned: WaveSpawnRequest[] = [];

    while (
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

    if (
      this.definition.eliteCount > 0 &&
      !this.eliteSpawned &&
      this.definition.eliteEnemyId &&
      this.elapsed + TIME_EPSILON >= this.eliteSpawnTime
    ) {
      this.eliteSpawned = true;
      spawned.push({
        enemy: scaleEnemyForWave(
          getEnemy(this.definition.eliteEnemyId),
          this.wave,
          true,
        ),
        isElite: true,
        isBoss: false,
        spawnIndex: this.definition.enemyCount,
      });
    }

    const allSpawned = this.remainingToSpawn === 0;
    const pendingAfterStep = context.pendingEnemyCount + spawned.length;
    // Boss 波由首领击败判定结束，不按“刷怪完成且无小怪”自动清空。
    if (
      !this.clearedValue &&
      this.definition.kind !== 'boss' &&
      allSpawned &&
      pendingAfterStep <= 0 &&
      context.aliveEnemyCount <= 0
    ) {
      this.clearedValue = true;
    }

    return { spawned, cleared: this.clearedValue };
  }
}

/** 波末奖励阶段，顺序固定：吸取经验 → 升级 → 机制 → 波间补给。 */
export type WaveRewardStage =
  | 'none'
  | 'absorb'
  | 'upgrade'
  | 'mechanic'
  | 'intermission';

/**
 * 波末奖励流转：阶段只由外部显式完成推进，便于验证顺序与冻结。
 * 第 3/6 波在升级队列清空后进入机制选择，其余波直接进入波间补给。
 */
export class WaveRewardFlow {
  readonly wave: number;

  private stageValue: WaveRewardStage = 'none';
  private pendingLevelUpsValue = 0;

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

  get needsMechanicChoice(): boolean {
    return this.wave === 3 || this.wave === 6;
  }

  /** 波清空：进入吸取阶段。 */
  begin(pendingLevelUps: number): WaveRewardStage {
    this.stageValue = 'absorb';
    this.pendingLevelUpsValue = Math.max(0, Math.floor(pendingLevelUps));
    return this.stageValue;
  }

  /** 吸取完成（含波末自动吸取产生的升级），按队列进入下一阶段。 */
  completeAbsorb(pendingLevelUps: number): WaveRewardStage {
    if (this.stageValue !== 'absorb') return this.stageValue;
    this.pendingLevelUpsValue = Math.max(0, Math.floor(pendingLevelUps));
    return this.advanceAfterUpgrades();
  }

  /** 完成一次升级三选一；队列清空后才允许继续。 */
  completeUpgrade(): WaveRewardStage {
    if (this.stageValue !== 'upgrade') return this.stageValue;
    this.pendingLevelUpsValue = Math.max(0, this.pendingLevelUpsValue - 1);
    if (this.pendingLevelUpsValue === 0) return this.advanceAfterUpgrades();
    return this.stageValue;
  }

  completeMechanic(): WaveRewardStage {
    if (this.stageValue === 'mechanic') this.stageValue = 'intermission';
    return this.stageValue;
  }

  completeIntermission(): WaveRewardStage {
    if (this.stageValue === 'intermission') this.stageValue = 'none';
    return this.stageValue;
  }

  /**
   * 续局恢复：直接写入奖励阶段与队列，不重放吸取/补给。
   * 只接受会落盘的稳定阶段；瞬时 `none`/`absorb` 不恢复。
   */
  restore(stage: WaveRewardStage, pendingLevelUps: number): WaveRewardStage {
    if (stage !== 'upgrade' && stage !== 'mechanic' && stage !== 'intermission') {
      return this.stageValue;
    }
    this.stageValue = stage;
    this.pendingLevelUpsValue = Number.isFinite(pendingLevelUps)
      ? Math.max(0, Math.floor(pendingLevelUps))
      : 0;
    return this.stageValue;
  }

  private advanceAfterUpgrades(): WaveRewardStage {
    if (this.pendingLevelUpsValue > 0) {
      this.stageValue = 'upgrade';
    } else if (this.needsMechanicChoice) {
      this.stageValue = 'mechanic';
    } else {
      this.stageValue = 'intermission';
    }
    return this.stageValue;
  }
}
