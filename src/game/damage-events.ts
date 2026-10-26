/**
 * 伤害来源链与战斗事件日志（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §数值初值与上限、
 * `docs/design/v0.2/02-content-catalog.md` §48 种海克斯：
 * - 所有伤害/治疗事件携带来源 ID、链 ID 与原生/衍生标记；
 * - 原生技能多段共享同一次原生攻击的链 ID；
 * - 衍生攻击不能再生成衍生攻击，链深度永远不超过 1；
 * - 分裂、反击、爆炸、弹射与召唤复制之间不得互相递归，统一由本模块拦截。
 */
import type { DamageType } from './data';

/** 攻击来源：原生技能或由原生技能派生出的效果。 */
export type DamageOrigin = 'native' | 'derived';

/** 一次攻击链的身份；同一原生施放的所有多段命中共享同一个 `chainId`。 */
export interface CombatEventSource {
  readonly sourceId: string;
  readonly chainId: string;
  readonly origin: DamageOrigin;
  /** 0 = 原生，1 = 衍生；不会出现 2 及以上。 */
  readonly depth: number;
}

export interface DamageEvent extends CombatEventSource {
  readonly kind: 'damage';
  readonly targetId: string;
  /** 减免后实际结算的伤害；未命中/已死亡时仍记录事件但 `applied=false`。 */
  readonly amount: number;
  readonly rawAmount: number;
  readonly applied: boolean;
  readonly damageType: DamageType;
}

export interface HealEvent extends CombatEventSource {
  readonly kind: 'heal';
  readonly targetId: string;
  /** 实际恢复的生命；满血或死亡时 `amount=0`、`applied=false`。 */
  readonly amount: number;
  readonly applied: boolean;
}

export type CombatEvent = DamageEvent | HealEvent;

/** `HealthState` 的可选事件出口；不注入时生命对象保持原有纯状态行为。 */
export interface CombatEventSink {
  record(event: CombatEvent): void;
}

/** 缺少调用方元数据时的兜底来源；字段仍然齐全，便于事件消费方统一处理。 */
export const UNATTRIBUTED_SOURCE: CombatEventSource = Object.freeze({
  sourceId: 'unattributed',
  chainId: 'chain-unattributed',
  origin: 'native' as const,
  depth: 0,
});

function requireSourceId(sourceId: string): string {
  if (typeof sourceId !== 'string' || sourceId.length === 0) {
    throw new Error('Damage sourceId must be a non-empty string');
  }
  return sourceId;
}

/**
 * 来源链跟踪器：每次原生施放调用一次 `beginNative`，多段命中继续复用返回的来源；
 * 强化产生的效果只能通过 `derive` 取得一层衍生来源。
 *
 * `derive` 对衍生来源返回 `null`，调用方必须把它当作“本次不触发”直接跳过，
 * 不允许自行伪造 depth=1 的来源绕过递归上限。
 */
export class DamageChainTracker {
  private nextChainId = 0;

  /** 开始一次原生攻击；每次施放生成新的链 ID。 */
  beginNative(sourceId: string): CombatEventSource {
    this.nextChainId += 1;
    return {
      sourceId: requireSourceId(sourceId),
      chainId: `chain-${this.nextChainId}`,
      origin: 'native',
      depth: 0,
    };
  }

  /** 原生技能的多段命中：沿用同一条链，不生成新链。 */
  nativeHit(source: CombatEventSource): CombatEventSource {
    if (source.origin !== 'native' || source.depth !== 0) {
      throw new Error('nativeHit requires a native source with depth 0');
    }
    return source;
  }

  /** 当前来源是否还能派生；衍生来源一律不能再次派生。 */
  canDerive(parent: CombatEventSource): boolean {
    return parent.origin === 'native' && parent.depth === 0;
  }

  /**
   * 从原生来源派生一次攻击；父级已是衍生时返回 null。
   * 派生来源沿用父级链 ID，`depth` 固定为 1，保证跨效果循环最多衍生一层。
   */
  derive(
    parent: CombatEventSource,
    sourceId: string,
  ): CombatEventSource | null {
    if (!this.canDerive(parent)) return null;
    return {
      sourceId: requireSourceId(sourceId),
      chainId: parent.chainId,
      origin: 'derived',
      depth: 1,
    };
  }
}

/**
 * 有界的战斗事件日志：只在开发/调试入口读取，不参与战斗结算。
 * 容量满了丢弃最旧事件，避免长时间一局无限增长。
 */
export class CombatEventLog implements CombatEventSink {
  private readonly records: CombatEvent[] = [];
  private readonly capacity: number;

  constructor(capacity = 256) {
    this.capacity =
      Number.isInteger(capacity) && capacity > 0 ? capacity : 256;
  }

  get size(): number {
    return this.records.length;
  }

  record(event: CombatEvent): void {
    if (!event || typeof event !== 'object') return;
    this.records.push({ ...event });
    while (this.records.length > this.capacity) this.records.shift();
  }

  /** 事件副本；调用方修改返回数组不会影响日志。 */
  snapshot(): readonly CombatEvent[] {
    return this.records.map((event) => ({ ...event }));
  }

  clear(): void {
    this.records.length = 0;
  }
}
