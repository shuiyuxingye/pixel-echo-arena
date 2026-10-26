/**
 * 波末奖励队列（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §精英核心：
 * - 统一顺序：有效击杀/金币 → 完成金币与波间恢复 → 宝箱资格 → 精英核心资格 →
 *   升级/海克斯队列 → 商店；
 * - 每份资格都有唯一奖励 ID 与 `pending/claimed/abandoned` 状态；
 * - 多份同类资格逐个处理，面板显示剩余待领取数量；
 * - 第 1–17 波处理完奖励才进入商店，第 18 波直接结算。
 */
import { getWave } from './data';
import { ELITE_CORE_IDS } from './core-offer';

/** 奖励种类；队列顺序与数组顺序一致。 */
export type RewardKind = 'chest' | 'core' | 'upgrade' | 'mechanic';

/** 每份资格的领取状态；放弃也是已处理状态，不会重新出现。 */
export type RewardStatus = 'pending' | 'claimed' | 'abandoned';

/** 奖励队列的固定处理顺序：宝箱 → 精英核心 → 升级/海克斯 → 机制。 */
export const REWARD_KIND_ORDER: readonly RewardKind[] = [
  'chest',
  'core',
  'upgrade',
  'mechanic',
];

/** 队列条目上限；与续局快照的宽松上限保持一致。 */
export const MAX_REWARD_ENTRIES = 20;

export const REWARD_KIND_LABELS: Readonly<Record<RewardKind, string>> = {
  chest: '宝箱战利品',
  core: '精英核心',
  upgrade: '升级选择',
  mechanic: '机制强化',
};

export interface RewardEntry {
  readonly id: string;
  readonly kind: RewardKind;
  readonly status: RewardStatus;
  /** 来源标识（如 `core-6`、宝箱实例 ID）；只用于展示与排查。 */
  readonly sourceId?: string;
  /** 宝箱资格已固定的道具候选 ID；抽取后不再刷新。 */
  readonly offers?: readonly string[];
  /** 宝箱完全没有有效道具时转换的金币。 */
  readonly fallbackGold?: number;
  /** 核心资格已固定的 E01–E08 候选 ID；抽取后不再刷新。 */
  readonly coreOffers?: readonly string[];
}

export interface RewardEntryExtra {
  readonly offers?: readonly string[];
  readonly fallbackGold?: number;
  readonly coreOffers?: readonly string[];
}

export interface RewardEntryInput extends RewardEntryExtra {
  readonly kind: RewardKind;
  readonly id: string;
  readonly sourceId?: string;
}

/** 队列内部可写条目；对外只暴露只读快照。 */
interface MutableRewardEntry {
  id: string;
  kind: RewardKind;
  status: RewardStatus;
  sourceId?: string;
  offers?: readonly string[];
  fallbackGold?: number;
  coreOffers?: readonly string[];
}

/** 宝箱候选上限；与 `chest-offer` 的 CHEST_OFFER_COUNT 一致。 */
const MAX_REWARD_OFFERS = 2;

/** 核心候选上限；与 `core-offer` 的 CORE_OFFER_COUNT 一致。 */
const MAX_CORE_OFFERS = 3;

function cloneEntry(entry: MutableRewardEntry): RewardEntry {
  return {
    ...entry,
    ...(entry.offers ? { offers: [...entry.offers] } : {}),
    ...(entry.coreOffers ? { coreOffers: [...entry.coreOffers] } : {}),
  };
}

/** 候选必须是 0–2 个互不重复的非空 ID；核心候选为 0–3 个合法 E ID。 */
export function isValidRewardExtra(extra: RewardEntryExtra | undefined): boolean {
  if (!extra) return true;
  if (extra.offers !== undefined) {
    if (!Array.isArray(extra.offers)) return false;
    if (extra.offers.length > MAX_REWARD_OFFERS) return false;
    const seen = new Set<string>();
    for (const itemId of extra.offers) {
      if (typeof itemId !== 'string' || itemId.length === 0) return false;
      if (seen.has(itemId)) return false;
      seen.add(itemId);
    }
  }
  if (extra.coreOffers !== undefined) {
    if (!Array.isArray(extra.coreOffers)) return false;
    if (extra.coreOffers.length > MAX_CORE_OFFERS) return false;
    const seen = new Set<string>();
    for (const coreId of extra.coreOffers) {
      if (typeof coreId !== 'string' || !ELITE_CORE_IDS.has(coreId)) return false;
      if (seen.has(coreId)) return false;
      seen.add(coreId);
    }
  }
  if (extra.fallbackGold !== undefined) {
    if (
      typeof extra.fallbackGold !== 'number' ||
      !Number.isInteger(extra.fallbackGold) ||
      extra.fallbackGold < 0
    ) {
      return false;
    }
  }
  return true;
}

const STATUSES: ReadonlySet<string> = new Set<RewardStatus>([
  'pending',
  'claimed',
  'abandoned',
]);

const KINDS: ReadonlySet<string> = new Set<RewardKind>(REWARD_KIND_ORDER);

export function isRewardKind(value: unknown): value is RewardKind {
  return typeof value === 'string' && KINDS.has(value);
}

export function isRewardStatus(value: unknown): value is RewardStatus {
  return typeof value === 'string' && STATUSES.has(value);
}

export function rewardKindRank(kind: RewardKind): number {
  return REWARD_KIND_ORDER.indexOf(kind);
}

/** 奖励种类的固定顺序比较；同种类保持入队顺序。 */
export function compareRewardKind(a: RewardKind, b: RewardKind): number {
  return rewardKindRank(a) - rewardKindRank(b);
}

/**
 * 本波奖励队列。
 *
 * 入队时按种类插入到固定位置，因此即使场景先记录核心、后记录宝箱，
 * 处理顺序仍然是宝箱 → 核心 → 升级 → 机制。唯一 ID 重复的资格被拒绝，
 * 已领取/已放弃的条目不会被 `current` 再次返回。
 */
export class RewardQueue {
  private entriesValue: MutableRewardEntry[] = [];

  /** 全部条目（含已处理），按处理顺序排列；返回副本防止外部改写状态。 */
  get entries(): readonly RewardEntry[] {
    return this.entriesValue.map(cloneEntry);
  }

  /** 尚未处理的条目。 */
  get pendingEntries(): readonly RewardEntry[] {
    return this.entriesValue
      .filter((entry) => entry.status === 'pending')
      .map(cloneEntry);
  }

  /** 下一个待处理资格；没有则为 null。 */
  get current(): RewardEntry | null {
    const entry = this.entriesValue.find((candidate) => candidate.status === 'pending');
    return entry ? cloneEntry(entry) : null;
  }

  /** 剩余待领取数量。 */
  get remainingCount(): number {
    return this.entriesValue.reduce(
      (total, entry) => total + (entry.status === 'pending' ? 1 : 0),
      0,
    );
  }

  /** 是否全部处理完（含空队列）。 */
  get isComplete(): boolean {
    return this.remainingCount === 0;
  }

  /** 指定种类尚未处理的数量。 */
  remainingOf(kind: RewardKind): number {
    return this.entriesValue.reduce(
      (total, entry) =>
        total + (entry.kind === kind && entry.status === 'pending' ? 1 : 0),
      0,
    );
  }

  /**
   * 入队一份资格。ID 为空、非字符串或重复时返回 null，
   * 队列已满时同样拒绝，避免损坏存档造成异常循环。
   * `extra` 只承载宝箱已固定的候选与兜底金币。
   */
  enqueue(
    kind: RewardKind,
    id: string,
    sourceId?: string,
    extra?: RewardEntryExtra,
  ): RewardEntry | null {
    if (!isRewardKind(kind)) return null;
    if (typeof id !== 'string' || id.length === 0) return null;
    if (this.entriesValue.length >= MAX_REWARD_ENTRIES) return null;
    if (this.entriesValue.some((entry) => entry.id === id)) return null;
    if (!isValidRewardExtra(extra)) return null;
    // 核心候选只能挂在核心资格上，避免其他奖励种类混入 E ID。
    if (kind !== 'core' && extra?.coreOffers !== undefined) return null;

    const entry: RewardEntry = {
      id,
      kind,
      status: 'pending',
      ...(sourceId ? { sourceId } : {}),
      ...(extra?.offers ? { offers: [...extra.offers] } : {}),
      ...(extra?.fallbackGold !== undefined
        ? { fallbackGold: extra.fallbackGold }
        : {}),
      ...(extra?.coreOffers !== undefined
        ? { coreOffers: [...extra.coreOffers] }
        : {}),
    };
    // 同种类按到达顺序排列：插到第一个排名更大的条目之前。
    const rank = rewardKindRank(kind);
    const insertAt = this.entriesValue.findIndex(
      (candidate) => rewardKindRank(candidate.kind) > rank,
    );
    if (insertAt < 0) this.entriesValue.push(entry);
    else this.entriesValue.splice(insertAt, 0, entry);
    return cloneEntry(entry);
  }

  /** 批量入队；返回实际接受的条目数。 */
  enqueueAll(inputs: readonly RewardEntryInput[]): number {
    let accepted = 0;
    for (const input of inputs) {
      if (this.enqueue(input.kind, input.id, input.sourceId, input)) accepted += 1;
    }
    return accepted;
  }

  /** 把一份待处理资格标记为已领取；已处理或未知 ID 返回 false。 */
  claim(id: string): boolean {
    return this.resolve(id, 'claimed');
  }

  /** 把一份待处理资格标记为已放弃；已处理或未知 ID 返回 false。 */
  abandon(id: string): boolean {
    return this.resolve(id, 'abandoned');
  }

  /**
   * 写入处理状态。只接受 `pending` 条目；重复领取、放弃后重领都返回 false。
   */
  resolve(id: string, status: RewardStatus): boolean {
    if (!isRewardStatus(status) || status === 'pending') return false;
    const entry = this.entriesValue.find((candidate) => candidate.id === id);
    if (!entry || entry.status !== 'pending') return false;
    entry.status = status;
    return true;
  }

  /** 当前条目的处理结果；没有待处理条目时返回 false。 */
  resolveCurrent(status: RewardStatus): boolean {
    const current = this.current;
    if (!current) return false;
    return this.resolve(current.id, status);
  }

  /** 序列化为可存档的纯数据；已领取状态一并保留。 */
  snapshot(): RewardEntry[] {
    return this.entriesValue.map(cloneEntry);
  }

  /**
   * 从快照恢复。非法条目被忽略，重复 ID 只保留第一条；
   * 已领取/已放弃状态原样保留，刷新后不会重领。
   */
  restore(entries: readonly RewardEntry[] | undefined): void {
    this.entriesValue = [];
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue;
      if (!isRewardKind(entry.kind)) continue;
      if (typeof entry.id !== 'string' || entry.id.length === 0) continue;
      if (!isRewardStatus(entry.status)) continue;
      const extra: RewardEntryExtra = {
        ...(entry.offers !== undefined ? { offers: entry.offers } : {}),
        ...(entry.fallbackGold !== undefined
          ? { fallbackGold: entry.fallbackGold }
          : {}),
        ...(entry.coreOffers !== undefined
          ? { coreOffers: entry.coreOffers }
          : {}),
      };
      const accepted = this.enqueue(entry.kind, entry.id, entry.sourceId, extra);
      if (!accepted) continue;
      if (entry.status !== 'pending') this.resolve(entry.id, entry.status);
    }
  }

  reset(): void {
    this.entriesValue = [];
  }
}

export interface WaveBriefingInput {
  readonly wave: number;
  readonly waveKills: number;
  readonly completionGold: number;
  readonly totalGold: number;
  readonly remainingRewards: number;
}

/** 波末简报：先看本波击杀与金币，再进入奖励队列。 */
export function formatWaveBriefing(input: WaveBriefingInput): string {
  const waveKills = Math.max(0, Math.floor(input.waveKills));
  const completionGold = Math.max(0, Math.floor(input.completionGold));
  const totalGold = Math.max(0, Math.floor(input.totalGold));
  const remaining = Math.max(0, Math.floor(input.remainingRewards));

  return [
    `第 ${input.wave} 波结束`,
    `本波击杀 ${waveKills} · 完成金币 +${completionGold}`,
    `当前金币 ${totalGold}`,
    remaining > 0 ? `待领取奖励 ${remaining} 项` : '没有待领取奖励',
    '按 Enter 继续',
  ].join('\n');
}

/** 单个奖励面板：标题、剩余数量与确认/放弃按键。 */
export function formatRewardPrompt(
  entry: Pick<RewardEntry, 'kind' | 'sourceId'>,
  remaining: number,
): string {
  const label = REWARD_KIND_LABELS[entry.kind] ?? entry.kind;
  const source = entry.sourceId ? ` · ${entry.sourceId}` : '';
  const count = Math.max(0, Math.floor(remaining));
  return [
    `${label}${source}`,
    `剩余待领取 ${count} 项`,
    'Enter 确认领取 · X 放弃',
  ].join('\n');
}

/** 波末出口：第 1–17 波进商店，第 18 波直接结算。 */
export type WaveEndChannel = 'shop' | 'result';

export function waveEndChannel(wave: number): WaveEndChannel {
  return getWave(wave).shopAfter ? 'shop' : 'result';
}
