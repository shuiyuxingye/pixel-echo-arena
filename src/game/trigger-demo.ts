/**
 * 开发专用触发链演示（纯逻辑，仅在 `?dev=1&triggerDemo=1` 时由场景调用）。
 *
 * 用固定的原生爆炸 → 分裂/反击 → 再派生 脚本，构造 Validator 需要的证据：
 * - 原生多段命中共享同一链 ID；
 * - 衍生攻击深度固定为 1，且无法再派生；
 * - 冷却、每波、每局与每秒四类闸门各自拒绝超限触发。
 *
 * 演示使用独立的链与闸门实例，不读写本局战斗状态，也不提供任何跳关/无敌入口。
 */
import {
  CombatEventLog,
  DamageChainTracker,
  type CombatEvent,
  type CombatEventSource,
} from './damage-events';
import {
  TriggerGate,
  type TriggerDeniedReason,
  type TriggerGateRuleSnapshot,
} from './trigger-gates';

/** 演示用规则 ID；只存在于开发场景，不进入正式内容目录。 */
export const TRIGGER_DEMO_RULE_IDS = {
  cooldown: 'demo.cooldown',
  perWave: 'demo.per-wave',
  perRun: 'demo.per-run',
  perSecond: 'demo.per-second',
} as const;

export interface TriggerDemoBlockedDerivation {
  readonly parentSourceId: string;
  readonly parentDepth: number;
  readonly attemptedSourceId: string;
}

export interface TriggerDemoDecision {
  readonly ruleId: string;
  readonly atSeconds: number;
  readonly allowed: boolean;
  readonly reason?: TriggerDeniedReason;
}

export interface TriggerDemoReport {
  readonly events: readonly CombatEvent[];
  readonly blockedDerivations: readonly TriggerDemoBlockedDerivation[];
  readonly decisions: readonly TriggerDemoDecision[];
  readonly gateStates: readonly TriggerGateRuleSnapshot[];
  /** 原生多段共享的链 ID。 */
  readonly nativeChainId: string;
  /** 本次演示出现过的最大衍生深度；按 AC 必须恒为 1。 */
  readonly maxDepth: number;
  readonly chainCount: number;
}

function damage(
  targetId: string,
  amount: number,
  source: CombatEventSource,
): CombatEvent {
  return {
    kind: 'damage',
    targetId,
    amount,
    rawAmount: amount,
    applied: true,
    damageType: source.sourceId.includes('split') ? 'physical' : 'magic',
    ...source,
  };
}

function heal(
  targetId: string,
  amount: number,
  source: CombatEventSource,
): CombatEvent {
  return {
    kind: 'heal',
    targetId,
    amount,
    applied: amount > 0,
    ...source,
  };
}

/** 运行一次固定演示；结果完全由纯逻辑决定，可重复单测。 */
export function runTriggerDemo(): TriggerDemoReport {
  const chains = new DamageChainTracker();
  const log = new CombatEventLog(64);

  const native = chains.beginNative('demo.explosion');
  // 原生爆炸多段：三次命中共享同一次原生攻击。
  for (const targetId of ['enemy-a', 'enemy-b', 'enemy-c']) {
    log.record(damage(targetId, 120, chains.nativeHit(native)));
  }

  const derivedSplit = chains.derive(native, 'demo.split');
  const derivedCounter = chains.derive(native, 'demo.counter');
  const derivedHeal = chains.derive(native, 'demo.lifesteal');
  const blockedDerivations: TriggerDemoBlockedDerivation[] = [];

  if (derivedSplit) {
    for (const targetId of ['enemy-a', 'enemy-b', 'enemy-c']) {
      log.record(damage(targetId, 60, derivedSplit));
    }
    blockedDerivations.push(
      blockDerivation(chains, derivedSplit, 'demo.explosion'),
    );
  }
  if (derivedCounter) {
    for (const targetId of ['enemy-b', 'enemy-c']) {
      log.record(damage(targetId, 45, derivedCounter));
    }
    blockedDerivations.push(
      blockDerivation(chains, derivedCounter, 'demo.split'),
      blockDerivation(chains, derivedCounter, 'demo.counter'),
    );
  }
  if (derivedHeal) {
    log.record(heal('player', 6, derivedHeal));
  }

  const events = log.snapshot();
  const maxDepth = events.reduce(
    (deepest, event) => Math.max(deepest, event.depth),
    0,
  );

  const decisions: TriggerDemoDecision[] = [];
  const gates: TriggerGate[] = [];

  // 冷却：2 秒内再次触发被拒，冷却结束后恢复。
  const cooldownGate = new TriggerGate([
    { id: TRIGGER_DEMO_RULE_IDS.cooldown, cooldownSeconds: 2 },
  ]);
  gates.push(cooldownGate);
  decisions.push(decide(cooldownGate, TRIGGER_DEMO_RULE_IDS.cooldown, 0));
  cooldownGate.step(0.5);
  decisions.push(decide(cooldownGate, TRIGGER_DEMO_RULE_IDS.cooldown, 0.5));
  cooldownGate.step(1.5);
  decisions.push(decide(cooldownGate, TRIGGER_DEMO_RULE_IDS.cooldown, 2));

  // 每波：2 次后拒绝，波末重置后恢复。
  const perWaveGate = new TriggerGate([
    { id: TRIGGER_DEMO_RULE_IDS.perWave, perWave: 2 },
  ]);
  gates.push(perWaveGate);
  decisions.push(decide(perWaveGate, TRIGGER_DEMO_RULE_IDS.perWave, 0));
  decisions.push(decide(perWaveGate, TRIGGER_DEMO_RULE_IDS.perWave, 0));
  decisions.push(decide(perWaveGate, TRIGGER_DEMO_RULE_IDS.perWave, 0));
  perWaveGate.endWave();
  decisions.push(decide(perWaveGate, TRIGGER_DEMO_RULE_IDS.perWave, 0));

  // 每局：3 次后拒绝，换局重置后恢复。
  const perRunGate = new TriggerGate([
    { id: TRIGGER_DEMO_RULE_IDS.perRun, perRun: 3 },
  ]);
  gates.push(perRunGate);
  for (let index = 0; index < 3; index += 1) {
    decisions.push(decide(perRunGate, TRIGGER_DEMO_RULE_IDS.perRun, 0));
  }
  decisions.push(decide(perRunGate, TRIGGER_DEMO_RULE_IDS.perRun, 0));
  perRunGate.resetRun();
  decisions.push(decide(perRunGate, TRIGGER_DEMO_RULE_IDS.perRun, 0));

  // 每秒：同一秒第 3 次被拒，1 秒窗口滑过后恢复。
  const perSecondGate = new TriggerGate([
    { id: TRIGGER_DEMO_RULE_IDS.perSecond, perSecond: 2 },
  ]);
  gates.push(perSecondGate);
  decisions.push(decide(perSecondGate, TRIGGER_DEMO_RULE_IDS.perSecond, 0));
  decisions.push(decide(perSecondGate, TRIGGER_DEMO_RULE_IDS.perSecond, 0));
  decisions.push(decide(perSecondGate, TRIGGER_DEMO_RULE_IDS.perSecond, 0));
  perSecondGate.step(1);
  decisions.push(decide(perSecondGate, TRIGGER_DEMO_RULE_IDS.perSecond, 1));

  return {
    events,
    blockedDerivations,
    decisions,
    gateStates: gates.flatMap((gate) => gate.snapshot().rules),
    nativeChainId: native.chainId,
    maxDepth,
    chainCount: new Set(events.map((event) => event.chainId)).size,
  };
}

function blockDerivation(
  chains: DamageChainTracker,
  parent: CombatEventSource,
  attemptedSourceId: string,
): TriggerDemoBlockedDerivation {
  chains.derive(parent, attemptedSourceId);
  return {
    parentSourceId: parent.sourceId,
    parentDepth: parent.depth,
    attemptedSourceId,
  };
}

function decide(
  gate: TriggerGate,
  ruleId: string,
  atSeconds: number,
): TriggerDemoDecision {
  const decision = gate.tryTrigger(ruleId);
  return {
    ruleId,
    atSeconds,
    allowed: decision.allowed,
    ...(decision.reason ? { reason: decision.reason } : {}),
  };
}
