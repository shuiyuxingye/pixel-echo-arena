/**
 * 续局快照（docs/game-design.md §9）：纯数据与 localStorage 读写，不依赖 Phaser/DOM。
 *
 * - 在波初、波间、生成强化选项、重抽完成与选卡完成时写入同一份快照；
 * - 快照只包含可序列化的逻辑状态（角色、生命、等级经验、已选强化、波次、重抽、
 *   随机状态、待选手牌与奖励队列），不包含渲染对象、音频或函数；
 * - 明确 `schemaVersion`，损坏或未知版本提示原因，重置只删除本游戏的键；
 * - 存储不可写时返回 false，由场景显示“本局无法保存”，不阻断本局。
 */
import { UPGRADE_LIST, isCharacterId, type CharacterId } from './data';
import { MAX_LEVEL, MIN_LEVEL } from './progression';
import {
  validateWorldSnapshot,
  type RunWorldSnapshot,
} from './world-snapshot';

/** 续局快照的 localStorage 键；重置只 delete 这一个键。 */
export const RUN_SAVE_STORAGE_KEY = 'pixel-echo.run.v1';

/** Phaser registry 中交给场景的续局快照键（由应用壳在创建游戏前写入）。 */
export const RUN_CHECKPOINT_REGISTRY_KEY = 'pixel-echo.run-checkpoint';

/** 快照结构版本；不兼容时进入“未知版本”分支，不尝试猜测字段。 */
export const RUN_SAVE_SCHEMA_VERSION = 1;

/** 本局默认重抽次数上限的宽松校验值，只用于拒绝异常数据。 */
const MAX_REROLLS = 99;

/** 奖励队列的宽松上限，避免损坏数据造成异常循环。 */
const MAX_PENDING_REWARDS = 20;

/** 保存时机，与 §9 的检查点列表一一对应。 */
export type RunCheckpointKind =
  | 'wave-start'
  | 'intermission'
  | 'upgrade-options'
  | 'reroll'
  | 'card-selected';

const CHECKPOINT_KINDS: ReadonlySet<string> = new Set<RunCheckpointKind>([
  'wave-start',
  'intermission',
  'upgrade-options',
  'reroll',
  'card-selected',
]);

/** 快照里保留的奖励流转阶段；`absorb` 是同一逻辑步内的瞬时阶段，不必落盘。 */
export type RunSavedRewardStage = 'none' | 'upgrade' | 'mechanic' | 'intermission';

const REWARD_STAGES: ReadonlySet<string> = new Set<RunSavedRewardStage>([
  'none',
  'upgrade',
  'mechanic',
  'intermission',
]);

export interface RunUpgradeStack {
  readonly id: string;
  readonly stacks: number;
}

export interface RunCheckpointHealth {
  readonly current: number;
  readonly max: number;
  /** 当前护盾；旧版快照没有该字段时按 0 处理。 */
  readonly shield?: number;
}

/** 场景写入快照时提供的字段；schemaVersion/savedAt 由写入函数补齐。 */
export interface RunCheckpointDraft {
  readonly kind: RunCheckpointKind;
  readonly characterId: CharacterId;
  readonly wave: number;
  readonly health: RunCheckpointHealth;
  readonly level: number;
  readonly experience: number;
  readonly totalExperience: number;
  readonly pendingLevelUps: number;
  readonly upgrades: readonly RunUpgradeStack[];
  readonly rerollsRemaining: number;
  readonly randomState: number;
  /** 待选手牌卡片 ID；没有打开三选一时为 null。 */
  readonly hand: readonly string[] | null;
  readonly handKind: 'upgrade' | 'mechanic' | null;
  readonly focusIndex: number;
  readonly rewardStage: RunSavedRewardStage;
  readonly rewardPendingLevelUps: number;
  /** 本局截至检查点的击杀数；旧版快照没有该字段时按 0 恢复。 */
  readonly kills?: number;
  /** 本局截至检查点的累计伤害；旧版快照没有该字段时按 0 恢复。 */
  readonly damageDealt?: number;
  /** 波中检查点的世界状态；波初/波间/波末检查点为 null。 */
  readonly world: RunWorldSnapshot | null;
}

export interface RunCheckpoint extends RunCheckpointDraft {
  readonly schemaVersion: number;
  readonly savedAt: string;
}

export type RunCheckpointLoadResult =
  | { readonly status: 'none' }
  | { readonly status: 'ok'; readonly checkpoint: RunCheckpoint }
  | { readonly status: 'corrupt'; readonly reason: string }
  | { readonly status: 'unsupported'; readonly version: number | null };

/** localStorage 在隐私模式或测试外不可用时返回 null；调用方按“无存档”继续。 */
function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function inRange(value: unknown, min: number, max: number): value is number {
  return isInteger(value) && value >= min && value <= max;
}

/** 手牌只允许当前角色可用的正式强化卡，且同一手不重复。 */
function isPlayableHand(
  hand: readonly string[],
  characterId: CharacterId,
): boolean {
  if (hand.length === 0 || hand.length > 3) return false;
  const seen = new Set<string>();
  for (const id of hand) {
    if (typeof id !== 'string' || seen.has(id)) return false;
    const card = UPGRADE_LIST.find((entry) => entry.id === id);
    if (!card) return false;
    if (card.owner !== 'general' && card.owner !== characterId) return false;
    seen.add(id);
  }
  return true;
}

function isUpgradeList(
  upgrades: readonly RunUpgradeStack[],
  characterId: CharacterId,
): boolean {
  const seen = new Set<string>();
  for (const entry of upgrades) {
    if (typeof entry !== 'object' || entry === null) return false;
    if (typeof entry.id !== 'string' || seen.has(entry.id)) return false;
    const card = UPGRADE_LIST.find((upgrade) => upgrade.id === entry.id);
    if (!card) return false;
    if (card.owner !== 'general' && card.owner !== characterId) return false;
    if (!inRange(entry.stacks, 1, card.maxStacks)) return false;
    seen.add(entry.id);
  }
  return true;
}

/**
 * 校验草稿字段。返回错误描述，`null` 表示可以写入。
 * 与 `parseCheckpoint` 共用同一口径，保证写入的数据一定能被读回。
 */
function validateDraft(draft: RunCheckpointDraft): string | null {
  if (!CHECKPOINT_KINDS.has(draft.kind)) return '未知的检查点类型';
  if (!isCharacterId(draft.characterId)) return '未知角色';
  if (!inRange(draft.wave, 1, 9)) return '波次越界';
  if (typeof draft.health !== 'object' || draft.health === null) {
    return '生命值不是对象';
  }
  if (!isFiniteNumber(draft.health.current) || !isFiniteNumber(draft.health.max)) {
    return '生命值不是有限数字';
  }
  if (draft.health.max <= 0) return '最大生命必须为正';
  if (draft.health.current <= 0) return '当前生命必须为正';
  if (draft.health.current > draft.health.max) {
    return '当前生命越界';
  }
  if (
    draft.health.shield !== undefined &&
    (!isFiniteNumber(draft.health.shield) || draft.health.shield < 0)
  ) {
    return '护盾值非法';
  }
  if (!inRange(draft.level, MIN_LEVEL, MAX_LEVEL)) return '等级越界';
  if (!isFiniteNumber(draft.experience) || draft.experience < 0) return '经验为负';
  if (!isFiniteNumber(draft.totalExperience) || draft.totalExperience < draft.experience) {
    return '累计经验小于当前经验';
  }
  if (!inRange(draft.pendingLevelUps, 0, MAX_PENDING_REWARDS)) {
    return '待选升级数量越界';
  }
  if (!Array.isArray(draft.upgrades) || !isUpgradeList(draft.upgrades, draft.characterId)) {
    return '已选强化列表非法';
  }
  if (!inRange(draft.rerollsRemaining, 0, MAX_REROLLS)) return '重抽次数越界';
  if (!inRange(draft.randomState, 0, 0xffffffff)) return '随机状态越界';
  if (draft.hand !== null) {
    if (!Array.isArray(draft.hand) || !isPlayableHand(draft.hand, draft.characterId)) {
      return '待选手牌非法';
    }
  }
  if (draft.hand === null) {
    if (draft.handKind !== null) return '没有手牌却记录了手牌类型';
    if (draft.focusIndex !== 0) return '没有手牌却记录了焦点';
  } else {
    if (draft.handKind !== 'upgrade' && draft.handKind !== 'mechanic') {
      return '手牌缺少类型';
    }
    if (!inRange(draft.focusIndex, 0, draft.hand.length - 1)) return '手牌焦点越界';
  }
  if (!REWARD_STAGES.has(draft.rewardStage)) return '未知奖励阶段';
  if (!inRange(draft.rewardPendingLevelUps, 0, MAX_PENDING_REWARDS)) {
    return '奖励队列数量越界';
  }
  // 旧版快照没有击杀/伤害字段，缺省按 0 恢复；一旦出现就必须是非负合法数值。
  if (draft.kills !== undefined && !inRange(draft.kills, 0, Number.MAX_SAFE_INTEGER)) {
    return '击杀数非法';
  }
  if (
    draft.damageDealt !== undefined &&
    (!isFiniteNumber(draft.damageDealt) || draft.damageDealt < 0)
  ) {
    return '累计伤害非法';
  }
  if (draft.world !== null && draft.world !== undefined) {
    if (!validateWorldSnapshot(draft.world)) return '波中世界状态非法';
  }
  return null;
}

/** 把任意 JSON 值解析成快照；未知版本单独返回，便于界面给出不同提示。 */
export function parseCheckpoint(value: unknown): RunCheckpointLoadResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { status: 'corrupt', reason: '快照不是对象' };
  }
  const record = value as Record<string, unknown>;
  if (!isInteger(record.schemaVersion)) {
    return { status: 'corrupt', reason: '缺少 schemaVersion' };
  }
  if (record.schemaVersion !== RUN_SAVE_SCHEMA_VERSION) {
    return { status: 'unsupported', version: record.schemaVersion };
  }
  if (typeof record.savedAt !== 'string' || record.savedAt.length === 0) {
    return { status: 'corrupt', reason: '缺少保存时间' };
  }
  if (!Array.isArray(record.upgrades)) {
    return { status: 'corrupt', reason: '已选强化不是数组' };
  }
  if (record.hand !== null && !Array.isArray(record.hand)) {
    return { status: 'corrupt', reason: '手牌不是数组' };
  }

  let world: RunWorldSnapshot | null = null;
  if (record.world !== undefined && record.world !== null) {
    world = validateWorldSnapshot(record.world);
    if (!world) return { status: 'corrupt', reason: '波中世界状态非法' };
  }

  const draft: RunCheckpointDraft = {
    kind: record.kind as RunCheckpointKind,
    characterId: record.characterId as CharacterId,
    wave: record.wave as number,
    health: record.health as RunCheckpointHealth,
    level: record.level as number,
    experience: record.experience as number,
    totalExperience: record.totalExperience as number,
    pendingLevelUps: record.pendingLevelUps as number,
    upgrades: record.upgrades as RunUpgradeStack[],
    rerollsRemaining: record.rerollsRemaining as number,
    randomState: record.randomState as number,
    hand: record.hand as string[] | null,
    handKind: record.handKind as 'upgrade' | 'mechanic' | null,
    focusIndex: record.focusIndex as number,
    rewardStage: record.rewardStage as RunSavedRewardStage,
    rewardPendingLevelUps: record.rewardPendingLevelUps as number,
    kills: record.kills as number | undefined,
    damageDealt: record.damageDealt as number | undefined,
    world,
  };
  const error = validateDraft(draft);
  if (error) return { status: 'corrupt', reason: error };

  return {
    status: 'ok',
    checkpoint: {
      ...draft,
      schemaVersion: record.schemaVersion,
      savedAt: record.savedAt,
    },
  };
}

/**
 * 恢复后的本局战斗统计。旧版快照缺少击杀/伤害字段时按 0 起步；
 * 已通过校验的值原样保留，让 HUD 与结算从保存值继续累计。
 */
export interface RunCombatStats {
  readonly kills: number;
  readonly damageDealt: number;
}

export function restoredCombatStats(
  checkpoint: Pick<RunCheckpoint, 'kills' | 'damageDealt'>,
): RunCombatStats {
  const kills =
    isInteger(checkpoint.kills) && checkpoint.kills >= 0 ? checkpoint.kills : 0;
  const damageDealt =
    isFiniteNumber(checkpoint.damageDealt) && checkpoint.damageDealt >= 0
      ? checkpoint.damageDealt
      : 0;
  return { kills, damageDealt };
}

/**
 * 读取续局快照。存储不可用或没有键时返回 `none`；
 * JSON 损坏、字段非法与未知版本分别返回可提示的状态。
 */
export function loadRunCheckpoint(
  storage: Storage | null = defaultStorage(),
): RunCheckpointLoadResult {
  if (!storage) return { status: 'none' };

  let raw: string | null;
  try {
    raw = storage.getItem(RUN_SAVE_STORAGE_KEY);
  } catch {
    return { status: 'none' };
  }
  if (!raw) return { status: 'none' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', reason: '存档不是合法 JSON' };
  }
  return parseCheckpoint(parsed);
}

/**
 * 写入续局快照。存储不可写或字段非法时返回 false，由调用方显示“本局无法保存”；
 * 写入失败不会清理已有键或其它站点数据。
 */
export function saveRunCheckpoint(
  draft: RunCheckpointDraft,
  storage: Storage | null = defaultStorage(),
  now: Date = new Date(),
): boolean {
  if (!storage) return false;
  if (validateDraft(draft)) return false;

  const checkpoint: RunCheckpoint = {
    ...draft,
    upgrades: draft.upgrades.map((entry) => ({ ...entry })),
    hand: draft.hand ? [...draft.hand] : null,
    health: { ...draft.health },
    world: draft.world ?? null,
    schemaVersion: RUN_SAVE_SCHEMA_VERSION,
    savedAt: now.toISOString(),
  };

  try {
    storage.setItem(RUN_SAVE_STORAGE_KEY, JSON.stringify(checkpoint));
    return true;
  } catch {
    return false;
  }
}

/**
 * 清除续局快照（胜败结算、主动返回选角或用户确认重置）。
 * 只删除本游戏的键，不使用 clear()，不触碰设置/键位或其它站点数据。
 */
export function clearRunCheckpoint(storage: Storage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(RUN_SAVE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
