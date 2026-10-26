/**
 * 单局成绩（docs/game-design.md §9）：纯数据与 localStorage 读写，不依赖 Phaser/DOM。
 *
 * - 胜败结算各记录一次；同一 `runId` 重复提交只保留第一条；
 * - 只保留最近 10 局，新记录排在最前；
 * - 使用独立的 localStorage 键与 `schemaVersion`，不触碰设置、键位或续局快照；
 * - 存储不可写时返回 `saved: false`，由结算界面提示，不阻断本局。
 */
import { TOTAL_WAVES, UPGRADE_LIST, getCharacter, isCharacterId, type CharacterId } from './data';
import { createUniqueSuffix } from './random';
import type { RunOutcome } from './run-state';

import { V2_STORAGE_KEYS } from './storage-namespace';

/** 成绩记录的 localStorage 键；不与续局快照混用。 */
export const RUN_RESULTS_STORAGE_KEY = V2_STORAGE_KEYS.results;

/** 成绩结构版本；未知版本按损坏处理并允许新记录覆盖。 */
export const RUN_RESULTS_SCHEMA_VERSION = 1;

/** 最多保留的最近局数。 */
export const MAX_RUN_RECORDS = 10;

/** 场景完成一局时发出的事件；应用壳监听后显示结算面板。 */
export const RUN_RESULT_EVENT = 'pixel-echo.run-result';

/** 最终构筑的一项：强化 ID 与获得的层数。 */
export interface RunResultUpgrade {
  readonly id: string;
  readonly stacks: number;
}

/** 一局结算成绩；字段全部可序列化。 */
export interface RunResultRecord {
  /** 本局唯一标识；结算去重只认它。 */
  readonly runId: string;
  readonly characterId: CharacterId;
  readonly outcome: RunOutcome;
  readonly wave: number;
  readonly durationSeconds: number;
  readonly kills: number;
  readonly damageDealt: number;
  readonly upgrades: readonly RunResultUpgrade[];
  readonly recordedAt: string;
}

/** 场景提交的草稿；`recordedAt` 由写入函数补齐。 */
export type RunResultDraft = Omit<RunResultRecord, 'recordedAt'>;

/** 结算事件载荷；`saved` 为 false 时界面提示本局成绩未能保存。 */
export interface RunResultPayload {
  readonly record: RunResultRecord;
  readonly saved: boolean;
}

export interface RunResultAppendOutcome {
  readonly saved: boolean;
  /** 同一 `runId` 已记录过，本次没有写入新条目。 */
  readonly duplicate: boolean;
  readonly record: RunResultRecord;
  readonly records: readonly RunResultRecord[];
}

interface StoredRunResults {
  readonly schemaVersion: number;
  readonly records: readonly RunResultRecord[];
}

/** 生成跨页面刷新也唯一的本局标识。 */
export function createRunKey(now: number = Date.now()): string {
  // 熵源集中在 random.ts；成绩标识不参与玩法随机。
  const suffix = createUniqueSuffix(6);
  return `${now.toString(36)}-${suffix}`;
}

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

/** 构筑项只允许正式强化卡，层数在 1..maxStacks 内且同一局不重复。 */
function isValidUpgrades(upgrades: unknown): upgrades is RunResultUpgrade[] {
  if (!Array.isArray(upgrades)) return false;
  const seen = new Set<string>();
  for (const entry of upgrades) {
    if (typeof entry !== 'object' || entry === null) return false;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || seen.has(record.id)) return false;
    const card = UPGRADE_LIST.find((upgrade) => upgrade.id === record.id);
    if (!card) return false;
    if (!isInteger(record.stacks) || record.stacks < 1 || record.stacks > card.maxStacks) {
      return false;
    }
    seen.add(record.id);
  }
  return true;
}

/** 校验一条成绩记录；返回 null 表示合法，否则给出原因。 */
export function validateRunResultRecord(
  value: unknown,
): value is RunResultRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.runId !== 'string' || record.runId.length === 0) return false;
  if (!isCharacterId(record.characterId)) return false;
  if (record.outcome !== 'victory' && record.outcome !== 'defeat') return false;
  if (!isInteger(record.wave) || record.wave < 1 || record.wave > TOTAL_WAVES) return false;
  if (!isFiniteNumber(record.durationSeconds) || record.durationSeconds < 0) return false;
  if (!isInteger(record.kills) || record.kills < 0) return false;
  if (!isFiniteNumber(record.damageDealt) || record.damageDealt < 0) return false;
  if (!isValidUpgrades(record.upgrades)) return false;
  if (typeof record.recordedAt !== 'string' || record.recordedAt.length === 0) {
    return false;
  }
  return true;
}

/** 解析存储值；结构或任一条目非法时返回 null（调用方按损坏处理）。 */
export function parseRunResults(value: unknown): readonly RunResultRecord[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const stored = value as Record<string, unknown>;
  if (stored.schemaVersion !== RUN_RESULTS_SCHEMA_VERSION) return null;
  if (!Array.isArray(stored.records)) return null;

  const records: RunResultRecord[] = [];
  const seen = new Set<string>();
  for (const entry of stored.records) {
    if (!validateRunResultRecord(entry)) return null;
    if (seen.has(entry.runId)) return null;
    seen.add(entry.runId);
    records.push(entry);
    if (records.length >= MAX_RUN_RECORDS) break;
  }
  return records;
}

/** 读取最近成绩；没有记录、版本不符或数据损坏时返回空列表。 */
export function loadRunResults(
  storage: Storage | null = defaultStorage(),
): readonly RunResultRecord[] {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(RUN_RESULTS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return parseRunResults(parsed) ?? [];
}

/** 补齐记录时间并复制构筑数组，避免调用方后续修改影响已写入的数据。 */
export function createRunResultRecord(
  draft: RunResultDraft,
  now: Date = new Date(),
): RunResultRecord {
  return {
    runId: draft.runId,
    characterId: draft.characterId,
    outcome: draft.outcome,
    wave: draft.wave,
    durationSeconds: draft.durationSeconds,
    kills: draft.kills,
    damageDealt: draft.damageDealt,
    upgrades: draft.upgrades.map((entry) => ({ ...entry })),
    recordedAt: now.toISOString(),
  };
}

/**
 * 追加一局成绩。
 * 同一 `runId` 已存在时不重复写入；否则插到最前并截断为最近 10 局。
 */
export function appendRunResult(
  record: RunResultRecord,
  storage: Storage | null = defaultStorage(),
): RunResultAppendOutcome {
  const existing = loadRunResults(storage);
  const duplicateRecord = existing.find((entry) => entry.runId === record.runId);
  if (duplicateRecord) {
    return {
      saved: true,
      duplicate: true,
      record: duplicateRecord,
      records: existing,
    };
  }

  const records = [record, ...existing].slice(0, MAX_RUN_RECORDS);
  if (!storage) {
    return { saved: false, duplicate: false, record, records };
  }

  const stored: StoredRunResults = {
    schemaVersion: RUN_RESULTS_SCHEMA_VERSION,
    records,
  };
  try {
    storage.setItem(RUN_RESULTS_STORAGE_KEY, JSON.stringify(stored));
    return { saved: true, duplicate: false, record, records };
  } catch {
    return { saved: false, duplicate: false, record, records };
  }
}

/**
 * 玩家死亡后不再累计击杀与伤害等战斗统计（§3、§9）；
 * 死亡与结果阶段都返回 false，避免同帧后续结算把计数抬高。
 */
export function shouldRecordCombatStats(
  playerDead: boolean,
  phase: string,
): boolean {
  return !playerDead && phase !== 'result';
}

/** 用时显示为 `分:秒`，超过一小时按总分钟数显示。 */
export function formatRunDuration(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

/** 结算与记录列表共用的一行摘要；构筑只显示 ID 与层数。 */
export function formatRunRecordLine(record: RunResultRecord): string {
  const character = getCharacter(record.characterId);
  const outcome = record.outcome === 'victory' ? '胜利' : '失败';
  const build =
    record.upgrades.length > 0
      ? record.upgrades.map((entry) => `${entry.id}×${entry.stacks}`).join(' / ')
      : '暂无强化';
  return [
    `第 ${record.wave} 波`,
    outcome,
    character.name,
    formatRunDuration(record.durationSeconds),
    `击杀 ${record.kills}`,
    `伤害 ${Math.round(record.damageDealt)}`,
    build,
  ].join(' · ');
}
