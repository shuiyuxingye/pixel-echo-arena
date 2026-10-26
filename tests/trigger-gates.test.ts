import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TriggerGate,
  validateTriggerGateSnapshot,
  type TriggerGateSnapshot,
} from '../src/game/trigger-gates';

describe('触发闸门配置', () => {
  it('拒绝空 ID、重复 ID 与非法上限', () => {
    expect(() => new TriggerGate([{ id: '' }])).toThrow();
    expect(() => new TriggerGate([{ id: 'a', perWave: 0 }])).toThrow();
    expect(() => new TriggerGate([{ id: 'a', perRun: 1.5 }])).toThrow();
    expect(() => new TriggerGate([{ id: 'a', perSecond: -1 }])).toThrow();
    expect(() => new TriggerGate([{ id: 'a', cooldownSeconds: -1 }])).toThrow();
    expect(
      () => new TriggerGate([{ id: 'a' }, { id: 'a' }]),
    ).toThrow();
  });

  it('未知规则直接拒绝，不产生副作用', () => {
    const gate = new TriggerGate([{ id: 'known' }]);
    const decision = gate.tryTrigger('missing');
    expect(decision).toMatchObject({
      allowed: false,
      reason: 'unknown-rule',
      waveCount: 0,
      runCount: 0,
    });
    expect(gate.ruleIds).toEqual(['known']);
  });
});

describe('四类触发上限', () => {
  it('冷却：冷却期间拒绝，剩余秒数衰减后恢复', () => {
    const gate = new TriggerGate([{ id: 'cd', cooldownSeconds: 2 }]);
    expect(gate.tryTrigger('cd').allowed).toBe(true);

    gate.step(0.5);
    const denied = gate.tryTrigger('cd');
    expect(denied).toMatchObject({ allowed: false, reason: 'cooldown' });
    expect(denied.remainingCooldownSeconds).toBeCloseTo(1.5);

    gate.step(1.5);
    const allowed = gate.tryTrigger('cd');
    expect(allowed.allowed).toBe(true);
    expect(allowed.remainingCooldownSeconds).toBe(2);
  });

  it('每波：达到上限后拒绝，波末重置后可再次触发', () => {
    const gate = new TriggerGate([{ id: 'wave', perWave: 2 }]);

    expect(gate.tryTrigger('wave').allowed).toBe(true);
    expect(gate.tryTrigger('wave').allowed).toBe(true);
    const denied = gate.tryTrigger('wave');
    expect(denied).toMatchObject({
      allowed: false,
      reason: 'per-wave',
      waveCount: 2,
    });

    gate.endWave();
    expect(gate.tryTrigger('wave').allowed).toBe(true);
  });

  it('每局：达到上限后拒绝，换局重置后可再次触发', () => {
    const gate = new TriggerGate([{ id: 'run', perRun: 3 }]);
    for (let index = 0; index < 3; index += 1) {
      expect(gate.tryTrigger('run').allowed).toBe(true);
    }
    expect(gate.tryTrigger('run')).toMatchObject({
      allowed: false,
      reason: 'per-run',
      runCount: 3,
    });

    gate.resetRun();
    expect(gate.tryTrigger('run')).toMatchObject({ allowed: true, runCount: 1 });
  });

  it('每秒：同一秒内超过全局上限拒绝，1 秒窗口滑过后恢复', () => {
    const gate = new TriggerGate([{ id: 'sec', perSecond: 2 }]);
    gate.step(0.1);
    expect(gate.tryTrigger('sec').allowed).toBe(true);
    gate.step(0.2);
    expect(gate.tryTrigger('sec').allowed).toBe(true);
    gate.step(0.3);
    expect(gate.tryTrigger('sec')).toMatchObject({
      allowed: false,
      reason: 'per-second',
      secondCount: 2,
    });

    // 到 t=1.1：第一次触发（t=0.1）滑出 1 秒窗口，只保留一次计数。
    gate.step(0.5);
    expect(gate.tryTrigger('sec').allowed).toBe(true);
  });

  it('检查顺序为冷却 → 每波 → 每局 → 每秒', () => {
    const gate = new TriggerGate([
      { id: 'all', cooldownSeconds: 1, perWave: 1, perRun: 1, perSecond: 1 },
    ]);
    expect(gate.tryTrigger('all').allowed).toBe(true);
    expect(gate.tryTrigger('all').reason).toBe('cooldown');

    gate.endWave();
    gate.step(1);
    expect(gate.tryTrigger('all').reason).toBe('per-run');

    gate.resetRun();
    expect(gate.tryTrigger('all').allowed).toBe(true);
  });

  it('canTrigger 只检查不消费', () => {
    const gate = new TriggerGate([{ id: 'preview', perWave: 1 }]);
    expect(gate.canTrigger('preview').allowed).toBe(true);
    expect(gate.canTrigger('preview').allowed).toBe(true);
    expect(gate.tryTrigger('preview').allowed).toBe(true);
    expect(gate.canTrigger('preview')).toMatchObject({
      allowed: false,
      reason: 'per-wave',
    });
  });
});

describe('快照与恢复', () => {
  it('按剩余秒数保存冷却，恢复后继续衰减且计数保留', () => {
    const gate = new TriggerGate([
      { id: 'snap', cooldownSeconds: 2, perWave: 3, perRun: 5 },
    ]);
    gate.tryTrigger('snap');
    gate.step(0.25);

    const snapshot = gate.snapshot();
    expect(snapshot.rules[0]).toEqual({
      id: 'snap',
      cooldownRemainingSeconds: 1.75,
      waveCount: 1,
      runCount: 1,
    });

    const restored = new TriggerGate([
      { id: 'snap', cooldownSeconds: 2, perWave: 3, perRun: 5 },
    ]);
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);

    restored.step(1.75);
    expect(restored.tryTrigger('snap')).toMatchObject({
      allowed: true,
      waveCount: 2,
      runCount: 2,
    });
  });

  it('恢复时忽略未知规则，缺失规则归零，非法数值按 0 处理', () => {
    const gate = new TriggerGate([
      { id: 'kept', cooldownSeconds: 2, perWave: 2, perRun: 2 },
      { id: 'missing', cooldownSeconds: 1 },
    ]);
    gate.tryTrigger('kept');
    gate.tryTrigger('kept');
    gate.tryTrigger('missing');

    gate.restore({
      rules: [
        {
          id: 'kept',
          cooldownRemainingSeconds: 0.5,
          waveCount: -3,
          runCount: 1,
        },
        { id: 'unknown', cooldownRemainingSeconds: 9, waveCount: 9, runCount: 9 },
      ],
    });

    const snapshot = gate.snapshot();
    expect(snapshot.rules).toEqual([
      { id: 'kept', cooldownRemainingSeconds: 0.5, waveCount: 0, runCount: 1 },
      { id: 'missing', cooldownRemainingSeconds: 0, waveCount: 0, runCount: 0 },
    ]);
  });

  it('结构校验拒绝损坏快照', () => {
    expect(validateTriggerGateSnapshot(null)).toBeNull();
    expect(validateTriggerGateSnapshot({})).toBeNull();
    expect(
      validateTriggerGateSnapshot({ rules: [{ id: 'a', cooldownRemainingSeconds: 'x' }] }),
    ).toBeNull();
    expect(
      validateTriggerGateSnapshot({
        rules: [
          { id: 'a', cooldownRemainingSeconds: 1, waveCount: 0, runCount: 0 },
          { id: 'a', cooldownRemainingSeconds: 1, waveCount: 0, runCount: 0 },
        ],
      }),
    ).toBeNull();

    const valid: TriggerGateSnapshot = {
      rules: [{ id: 'a', cooldownRemainingSeconds: 0.5, waveCount: 2, runCount: 3 }],
    };
    expect(validateTriggerGateSnapshot(valid)).toEqual(valid);
    expect(validateTriggerGateSnapshot(valid)).not.toBe(valid);
  });
});

describe('场景接线', () => {
  const scene = readFileSync(
    resolve(process.cwd(), 'src/game/scenes/ArenaScene.ts'),
    'utf8',
  );

  it('每逻辑步推进闸门，波末重置每波计数', () => {
    expect(scene).toContain('this.triggerGates.step(stepSeconds)');
    expect(scene).toContain('this.triggerGates.endWave()');
  });

  it('新局重置全部计数，续局按快照恢复', () => {
    expect(scene).toContain('this.triggerGates.resetRun()');
    expect(scene).toContain('this.triggerGates.restore(checkpoint.triggerGates)');
  });

  it('检查点写入闸门快照', () => {
    expect(scene).toContain('triggerGates: this.triggerGates.snapshot()');
  });
});
