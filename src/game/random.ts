/**
 * 本局随机流：战斗与商店/奖励分离的命名随机序列（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 PRD §7、US-059 / US-048：
 * - 一局有 `combat` 与 `reward` 两条命名流，各自维护独立状态与消费顺序；
 *   商店货架/重抽、宝箱候选、精英核心候选与海克斯手牌都从 `reward` 取数，
 *   战斗中的随机判定从 `combat` 取数；
 * - 同一 seed 与相同消费顺序重放结果完全一致；消耗一条流不改变另一条流；
 * - 两条流都提供快照与恢复；非法/越界状态拒绝恢复并保留原状态，不消耗随机数；
 * - 本文件是全项目唯一直接调用 `Math.random()` 的位置：只用于开新局种子与
 *   跨刷新唯一标识，不参与已开局内的任何玩法选择。
 */

/** 一局的命名随机流；`reward` 同时服务商店与波末奖励。 */
export const RANDOM_STREAM_NAMES = ['combat', 'reward'] as const;

export type RandomStreamName = (typeof RANDOM_STREAM_NAMES)[number];

/** 两条流的可序列化状态；写入 V2 快照时分开保存（US-048）。 */
export interface RunRandomSnapshot {
  readonly combat: number;
  readonly reward: number;
}

/** 单条流的快照；`name` 用于拒绝把一条流的状态恢复进另一条流。 */
export interface RandomStreamSnapshot {
  readonly name: RandomStreamName;
  readonly state: number;
}

/** 规则系统消费随机数的最小接口；`SeededRandom` 与 `RandomStream` 都满足。 */
export interface RandomSource {
  next(): number;
  readonly snapshotState: number;
  restoreState(value: unknown): boolean;
}

/** 合法的 mulberry32 内部状态：0..0xffffffff 的整数。 */
export function isValidRandomState(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffffff
  );
}

/** 确定性伪随机数发生器（mulberry32）：同种子产生同序列。 */
export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new Error(`Seed must be finite, received ${seed}`);
    }
    this.state = Math.floor(seed) >>> 0;
  }

  /** 返回 [0, 1) 的浮点数。 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  /** 当前内部状态；续局快照保存它即可精确恢复后续随机序列。 */
  get snapshotState(): number {
    return this.state;
  }

  /** 恢复内部状态；非法值返回 false 并保持原状态（不消耗随机数）。 */
  restoreState(value: unknown): boolean {
    if (!isValidRandomState(value)) return false;
    this.state = value >>> 0;
    return true;
  }
}

/** 从一局种子派生某条命名流的初始状态；两条流的派生结果互不相同。 */
export function deriveStreamSeed(seed: number, name: RandomStreamName): number {
  if (!Number.isFinite(seed)) {
    throw new Error(`Seed must be finite, received ${seed}`);
  }
  if (!RANDOM_STREAM_NAMES.includes(name)) {
    throw new Error(`Unknown random stream: ${String(name)}`);
  }
  const base = Math.floor(seed) >>> 0;
  const salt = name === 'combat' ? 0x9e3779b9 : 0x85ebca6b;
  let value = (base ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97) >>> 0;
  return (value ^ (value >>> 15)) >>> 0;
}

/** 命名随机流：把一条可序列化序列与消费顺序封装成独立实体。 */
export class RandomStream implements RandomSource {
  readonly name: RandomStreamName;
  /** 派生后的流种子；只用于复现与诊断，运行中以 `snapshotState` 为准。 */
  readonly seed: number;
  private readonly random: SeededRandom;

  constructor(name: RandomStreamName, seed: number) {
    if (!RANDOM_STREAM_NAMES.includes(name)) {
      throw new Error(`Unknown random stream: ${String(name)}`);
    }
    this.random = new SeededRandom(seed);
    this.name = name;
    this.seed = Math.floor(seed) >>> 0;
  }

  /** 返回 [0, 1) 的浮点数并推进本条流的状态。 */
  next(): number {
    return this.random.next();
  }

  /** 当前状态；不推进序列。 */
  get snapshotState(): number {
    return this.random.snapshotState;
  }

  /** 恢复状态；非法值返回 false 并保持原状态，不消耗随机数。 */
  restoreState(value: unknown): boolean {
    return this.random.restoreState(value);
  }

  /** 带流名的快照，防止把一条流的状态误恢复进另一条。 */
  snapshot(): RandomStreamSnapshot {
    return { name: this.name, state: this.snapshotState };
  }

  /** 从带流名的快照恢复；名字不符或状态非法都拒绝且不改变原状态。 */
  restore(snapshot: unknown): boolean {
    if (typeof snapshot !== 'object' || snapshot === null) return false;
    const candidate = snapshot as { readonly name?: unknown; readonly state?: unknown };
    if (candidate.name !== this.name) return false;
    return this.restoreState(candidate.state);
  }
}

/** 单局的两条随机流；构造时从同一局种子派生两个互不相同的初始状态。 */
export class RunRandomStreams {
  readonly seed: number;
  readonly combat: RandomStream;
  readonly reward: RandomStream;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new Error(`Seed must be finite, received ${seed}`);
    }
    this.seed = Math.floor(seed) >>> 0;
    this.combat = new RandomStream('combat', deriveStreamSeed(this.seed, 'combat'));
    this.reward = new RandomStream('reward', deriveStreamSeed(this.seed, 'reward'));
  }

  /** 按名字取流；未知名字直接报错，避免静默落到另一条流。 */
  stream(name: RandomStreamName): RandomStream {
    if (name === 'combat') return this.combat;
    if (name === 'reward') return this.reward;
    throw new Error(`Unknown random stream: ${String(name)}`);
  }

  /** 战斗判定取数。 */
  nextCombat(): number {
    return this.combat.next();
  }

  /** 商店/海克斯/波末奖励取数。 */
  nextReward(): number {
    return this.reward.next();
  }

  /** 两条流的独立状态；同一对象可直接写入 V2 快照。 */
  snapshot(): RunRandomSnapshot {
    return {
      combat: this.combat.snapshotState,
      reward: this.reward.snapshotState,
    };
  }

  /**
   * 原子恢复：先校验两条流，任一非法时整体返回 false，
   * 两条流都保持原状态且不消耗随机数。
   */
  restore(snapshot: unknown): boolean {
    if (typeof snapshot !== 'object' || snapshot === null) return false;
    const candidate = snapshot as { readonly combat?: unknown; readonly reward?: unknown };
    if (!isValidRandomState(candidate.combat) || !isValidRandomState(candidate.reward)) {
      return false;
    }
    this.combat.restoreState(candidate.combat);
    this.reward.restoreState(candidate.reward);
    return true;
  }

  /** 只恢复其中一条流；非法状态拒绝且保留该流原状态。 */
  restoreStream(name: RandomStreamName, state: unknown): boolean {
    return this.stream(name).restoreState(state);
  }
}

/**
 * 生成新局种子。这是全项目唯一直接调用 `Math.random()` 的位置之一；
 * 只负责“开新局”的熵，不参与已开局内的任何随机选择。
 */
export function createEntropySeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/** 生成跨刷新唯一的短后缀（成绩 runId）；不参与玩法随机。 */
export function createUniqueSuffix(length = 6): string {
  const size = Math.max(1, Math.floor(length));
  return Math.random().toString(36).slice(2, 2 + size);
}
