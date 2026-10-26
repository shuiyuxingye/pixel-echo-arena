import { describe, expect, it } from 'vitest';
import { TRIGGER_DEMO_RULE_IDS, runTriggerDemo } from '../src/game/trigger-demo';

describe('开发触发链演示', () => {
  const report = runTriggerDemo();

  it('原生多段共享同一条链，衍生深度最多为 1', () => {
    expect(report.maxDepth).toBe(1);

    const nativeHits = report.events.filter(
      (event) => event.kind === 'damage' && event.origin === 'native',
    );
    expect(nativeHits).toHaveLength(3);
    expect(new Set(nativeHits.map((event) => event.chainId))).toEqual(
      new Set([report.nativeChainId]),
    );

    const derived = report.events.filter((event) => event.origin === 'derived');
    expect(derived.length).toBeGreaterThan(0);
    for (const event of derived) {
      expect(event.depth).toBe(1);
      expect(event.chainId).toBe(report.nativeChainId);
    }
  });

  it('分裂/反击的再派生全部被拦截', () => {
    expect(report.blockedDerivations).toHaveLength(3);
    for (const blocked of report.blockedDerivations) {
      expect(blocked.parentDepth).toBe(1);
    }
    expect(
      report.blockedDerivations.map((entry) => entry.attemptedSourceId),
    ).toEqual(['demo.explosion', 'demo.split', 'demo.counter']);
  });

  it('四类闸门各自在超限后拒绝触发', () => {
    const reasons = new Set(
      report.decisions
        .filter((decision) => !decision.allowed)
        .map((decision) => decision.reason),
    );
    expect(reasons).toEqual(
      new Set(['cooldown', 'per-wave', 'per-run', 'per-second']),
    );

    // 每类规则都有一次“超限后重置/滑窗再恢复”的成功触发。
    for (const ruleId of Object.values(TRIGGER_DEMO_RULE_IDS)) {
      const decisions = report.decisions.filter(
        (decision) => decision.ruleId === ruleId,
      );
      expect(decisions.some((decision) => decision.allowed)).toBe(true);
      expect(decisions.some((decision) => !decision.allowed)).toBe(true);
    }
  });

  it('治疗事件同样携带来源链，且演示不依赖任何外部状态', () => {
    const heals = report.events.filter((event) => event.kind === 'heal');
    expect(heals).toHaveLength(1);
    expect(heals[0]).toMatchObject({
      targetId: 'player',
      sourceId: 'demo.lifesteal',
      origin: 'derived',
      depth: 1,
      chainId: report.nativeChainId,
    });

    const again = runTriggerDemo();
    expect(again.events).toEqual(report.events);
    expect(again.decisions).toEqual(report.decisions);
  });
});
