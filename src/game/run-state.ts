/**
 * 局流程状态机、波次节奏与波间补给（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/game-design.md` §3：
 * - `menu → character-select → countdown → combat → upgrade / intermission →
 *   combat → result`；每波开始进入 3 秒倒计时；
 * - 波间回复最大生命的 15%，死亡角色不复活，Enter 进入下一波；
 * - 普通波超过 90 秒显示残敌方向提示；
 * - 生命归零立即结束，先结算本帧伤害与死亡，再处理升级与胜利。
 */
import type { HealthState } from './combat';
import type { Facing } from './movement';

/** 每波开始前的倒计时秒数。 */
export const WAVE_COUNTDOWN_SECONDS = 3;

/** 波间补给回复最大生命的比例。 */
export const INTERMISSION_HEAL_RATIO = 0.15;

/** 普通波超过该秒数后显示残敌方向提示。 */
export const WAVE_STALE_HINT_SECONDS = 90;

const TIME_EPSILON = 1e-9;

/**
 * 局内状态。`paused` 只保存被暂停前的状态，恢复时回到原阶段；
 * 机制三选一与升级三选一都使用 `upgrade`。
 */
export type RunPhase =
  | 'menu'
  | 'character-select'
  | 'countdown'
  | 'combat'
  | 'upgrade'
  | 'intermission'
  | 'paused'
  | 'result';

export type RunOutcome = 'victory' | 'defeat';

/**
 * 只有战斗阶段响应技能、攻击与闪避输入。
 * 倒计时不抢跑，波末奖励面板与商店（intermission）内不施法，
 * 暂停/结算/菜单同样不接收战斗输入。
 */
export function canCastCombatSkills(phase: RunPhase): boolean {
  return phase === 'combat';
}

/** 状态机只允许合法阶段迁移；非法调用原样返回当前阶段。 */
export class RunStateMachine {
  private phaseValue: RunPhase = 'menu';
  private previousPhaseValue: RunPhase | null = null;
  private countdownRemainingValue = 0;
  private countdownElapsedValue = 0;
  private outcomeValue: RunOutcome | null = null;

  get phase(): RunPhase {
    return this.phaseValue;
  }

  /** 暂停前的阶段；只在 `paused` 时有值。 */
  get previousPhase(): RunPhase | null {
    return this.previousPhaseValue;
  }

  get countdownRemaining(): number {
    return this.countdownRemainingValue;
  }

  get outcome(): RunOutcome | null {
    return this.outcomeValue;
  }

  get isPaused(): boolean {
    return this.phaseValue === 'paused';
  }

  /** 升级/波间都处于奖励处理中。 */
  get isRewardPhase(): boolean {
    return this.phaseValue === 'upgrade' || this.phaseValue === 'intermission';
  }

  enterCharacterSelect(): RunPhase {
    if (this.phaseValue === 'menu') this.phaseValue = 'character-select';
    return this.phaseValue;
  }

  /** 选角确认后开始第一波倒计时。 */
  beginRun(): RunPhase {
    if (this.phaseValue !== 'character-select') return this.phaseValue;
    return this.beginWave();
  }

  /** 进入下一波倒计时；每波只从这里重置倒计时剩余时间。 */
  beginWave(): RunPhase {
    if (
      this.phaseValue !== 'character-select' &&
      this.phaseValue !== 'intermission'
    ) {
      return this.phaseValue;
    }
    this.phaseValue = 'countdown';
    this.countdownRemainingValue = WAVE_COUNTDOWN_SECONDS;
    this.countdownElapsedValue = 0;
    this.outcomeValue = null;
    return this.phaseValue;
  }

  /**
   * 推进倒计时。倒计时结束的那一步进入 `combat`；
   * 循环用累积经过时间判断，避免逐步减法在浮点上漂移。
   */
  stepCountdown(stepSeconds: number): RunPhase {
    if (this.phaseValue !== 'countdown') return this.phaseValue;
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) {
      return this.phaseValue;
    }

    this.countdownElapsedValue += stepSeconds;
    if (this.countdownElapsedValue + TIME_EPSILON >= WAVE_COUNTDOWN_SECONDS) {
      this.countdownElapsedValue = WAVE_COUNTDOWN_SECONDS;
      this.countdownRemainingValue = 0;
      this.phaseValue = 'combat';
    } else {
      this.countdownRemainingValue = Math.max(
        0,
        WAVE_COUNTDOWN_SECONDS - this.countdownElapsedValue,
      );
    }
    return this.phaseValue;
  }

  /** 战斗清空后进入升级三选一（机制三选一同样使用该阶段）。 */
  beginUpgrade(): RunPhase {
    if (this.phaseValue === 'combat') this.phaseValue = 'upgrade';
    return this.phaseValue;
  }

  /** 波间补给；从升级结束或无需升级的清空直接进入。 */
  beginIntermission(): RunPhase {
    if (this.phaseValue === 'combat' || this.phaseValue === 'upgrade') {
      this.phaseValue = 'intermission';
    }
    return this.phaseValue;
  }

  /** 波中升级选完后回到战斗；波末升级由调用方继续推进到波间。 */
  returnToCombat(): RunPhase {
    if (this.phaseValue === 'upgrade') this.phaseValue = 'combat';
    return this.phaseValue;
  }

  /**
   * 续局恢复到升级三选一：从选角或刚建立的波初倒计时进入，不新建波次。
   * 手牌与奖励队列由调用方按快照恢复。
   */
  restoreUpgrade(): RunPhase {
    if (
      this.phaseValue === 'character-select' ||
      this.phaseValue === 'countdown'
    ) {
      this.phaseValue = 'upgrade';
    }
    return this.phaseValue;
  }

  /**
   * 续局恢复到波中战斗：世界状态由调用方按快照重建，不重新倒计时。
   */
  restoreCombat(): RunPhase {
    if (this.phaseValue === 'character-select' || this.phaseValue === 'countdown') {
      this.phaseValue = 'combat';
    }
    return this.phaseValue;
  }

  /**
   * 续局恢复到波间补给：不重新倒计时，也不再次结算补给回血
   * （快照保存的是补给结算后的生命）。
   */
  restoreIntermission(): RunPhase {
    if (this.phaseValue === 'character-select') {
      this.phaseValue = 'intermission';
    }
    return this.phaseValue;
  }

  /** 结束一局：死亡或胜利；不再接受波次推进。 */
  beginResult(outcome: RunOutcome): RunPhase {
    this.phaseValue = 'result';
    this.outcomeValue = outcome;
    return this.phaseValue;
  }

  /** 保存当前阶段并暂停；结果阶段不可暂停。 */
  pause(): boolean {
    if (
      this.phaseValue !== 'countdown' &&
      this.phaseValue !== 'combat' &&
      this.phaseValue !== 'upgrade' &&
      this.phaseValue !== 'intermission'
    ) {
      return false;
    }
    this.previousPhaseValue = this.phaseValue;
    this.phaseValue = 'paused';
    return true;
  }

  /** 恢复到暂停前的阶段。 */
  resume(): RunPhase {
    if (this.phaseValue !== 'paused') return this.phaseValue;
    this.phaseValue = this.previousPhaseValue ?? 'combat';
    this.previousPhaseValue = null;
    return this.phaseValue;
  }
}

export interface PostDamageInput {
  /** 本帧伤害结算后玩家是否死亡。 */
  readonly playerDead: boolean;
  /** 本帧是否清空了当前波。 */
  readonly waveCleared: boolean;
  readonly pendingLevelUps?: number;
  /** 3/6 波清空后仍需机制三选一。 */
  readonly needsMechanicChoice?: boolean;
  /** 首领被击败（与玩家死亡同帧时按失败处理）。 */
  readonly victory?: boolean;
}

export interface PostDamageResolution {
  readonly phase: 'combat' | 'upgrade' | 'intermission' | 'result';
  readonly outcome: RunOutcome | null;
  readonly rewardsAllowed: boolean;
}

/**
 * 本帧伤害之后的阶段判定：
 * 死亡优先于胜利与任何升级/波间奖励，确保同帧死亡不再发奖励。
 */
export function resolvePostDamagePhase(
  input: PostDamageInput,
): PostDamageResolution {
  if (input.playerDead) {
    return { phase: 'result', outcome: 'defeat', rewardsAllowed: false };
  }
  if (input.victory) {
    return { phase: 'result', outcome: 'victory', rewardsAllowed: false };
  }
  if (!input.waveCleared) {
    return { phase: 'combat', outcome: null, rewardsAllowed: true };
  }

  const pendingLevelUps = Math.max(
    0,
    Math.floor(input.pendingLevelUps ?? 0),
  );
  if (pendingLevelUps > 0 || input.needsMechanicChoice === true) {
    return { phase: 'upgrade', outcome: null, rewardsAllowed: true };
  }
  return { phase: 'intermission', outcome: null, rewardsAllowed: true };
}

/** 波间补给的治疗量：最大生命的 15%，死亡角色为 0。 */
export function intermissionHealAmount(
  maxHealth: number,
  ratio = INTERMISSION_HEAL_RATIO,
): number {
  if (!Number.isFinite(maxHealth) || maxHealth <= 0) return 0;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return maxHealth * ratio;
}

/**
 * 应用波间补给并返回实际回复量。
 * 走 `HealthState.heal`，超过上限的部分不计，死亡角色不复活。
 */
export function applyIntermissionRecovery(
  health: HealthState,
  ratio = INTERMISSION_HEAL_RATIO,
): number {
  if (health.isDead) return 0;
  const before = health.health;
  health.heal(intermissionHealAmount(health.maxHealth, ratio));
  return Math.max(0, health.health - before);
}

export interface IntermissionUpgradeSummary {
  readonly id: string;
  readonly name: string;
  readonly stacks: number;
}

export interface IntermissionSummaryInput {
  readonly wave: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly upgrades: readonly IntermissionUpgradeSummary[];
  /** 本局实际恢复比例（R06 命运交易所减半时传 0.075）；缺省 15%。 */
  readonly healRatio?: number;
}

/** 波间补给面板：波次、生命与强化概览，Enter 进入下一波。 */
export function formatIntermissionSummary(
  input: IntermissionSummaryInput,
): string {
  const health = Math.max(0, input.health);
  const maxHealth = Math.max(1, input.maxHealth);
  const healRatio =
    typeof input.healRatio === 'number' &&
    Number.isFinite(input.healRatio) &&
    input.healRatio >= 0
      ? input.healRatio
      : INTERMISSION_HEAL_RATIO;
  const upgradeText =
    input.upgrades.length > 0
      ? input.upgrades
          .map((upgrade) => `${upgrade.id} ${upgrade.name} ×${upgrade.stacks}`)
          .join(' / ')
      : '暂无';

  return [
    `第 ${input.wave} 波清空 · 生命 ${Math.ceil(health)}/${Math.ceil(maxHealth)}`,
    `强化：${upgradeText}`,
    `波间补给：回复最大生命的 ${Math.round(healRatio * 1000) / 10}%`,
    '按 Enter 进入下一波',
  ].join('\n');
}

export interface StaleEnemyTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly isAlive: boolean;
}

export interface StaleEnemyHint {
  /** 仍存活的敌人数量。 */
  readonly count: number;
  /** 最近存活敌人相对玩家的八向方位。 */
  readonly direction: Facing;
  readonly label: string;
  readonly distance: number;
}

const ENEMY_DIRECTION_LABELS: Readonly<Record<Facing, string>> = {
  east: '右侧',
  southEast: '右下',
  south: '下方',
  southWest: '左下',
  west: '左侧',
  northWest: '左上',
  north: '上方',
  northEast: '右上',
};

const DIRECTION_ORDER: readonly Facing[] = [
  'east',
  'southEast',
  'south',
  'southWest',
  'west',
  'northWest',
  'north',
  'northEast',
];

/** 按 45° 扇区把位移向量映射为八向方位。 */
function directionFromDelta(dx: number, dy: number): Facing {
  if (dx === 0 && dy === 0) return 'east';
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return DIRECTION_ORDER[((octant % 8) + 8) % 8] ?? 'east';
}

/**
 * 普通波超过 90 秒后的残敌方向提示。
 * 只返回提示数据，不传送敌人、不击杀、不隐藏；等距按 id 稳定选择。
 */
export function resolveStaleEnemyHint(
  elapsedSeconds: number,
  player: { readonly x: number; readonly y: number },
  targets: readonly StaleEnemyTarget[],
): StaleEnemyHint | null {
  if (
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds + TIME_EPSILON < WAVE_STALE_HINT_SECONDS
  ) {
    return null;
  }

  const alive = targets.filter((target) => target.isAlive);
  if (alive.length === 0) return null;

  let nearest = alive[0];
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const target of alive) {
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const distanceSquared = dx * dx + dy * dy;
    if (
      distanceSquared < nearestDistanceSquared - TIME_EPSILON ||
      (Math.abs(distanceSquared - nearestDistanceSquared) <= TIME_EPSILON &&
        nearest !== undefined &&
        target.id < nearest.id)
    ) {
      nearest = target;
      nearestDistanceSquared = distanceSquared;
    }
  }

  if (!nearest) return null;
  const dx = nearest.x - player.x;
  const dy = nearest.y - player.y;
  const direction = directionFromDelta(dx, dy);
  return {
    count: alive.length,
    direction,
    label: ENEMY_DIRECTION_LABELS[direction],
    distance: Math.sqrt(dx * dx + dy * dy),
  };
}
