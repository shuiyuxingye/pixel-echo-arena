import { describe, expect, it } from 'vitest';
import {
  E06_CASTS_REQUIRED,
  E06_ECHO_DELAY_SECONDS,
  E06_ECHO_STRENGTH,
} from '../src/game/core-effects';
import { runSkillEchoDemo } from '../src/game/skill-echo-demo';

describe('E06 复施开发演示', () => {
  it('第 3 次释放后 1 秒才就绪，以 45% 强度复施一次', () => {
    const report = runSkillEchoDemo();
    expect(report.castsRequired).toBe(E06_CASTS_REQUIRED);
    expect(report.castSlots).toHaveLength(E06_CASTS_REQUIRED);
    expect(report.echoScheduled).toBe(true);
    expect(report.readyBeforeDelay).toBe(false);
    expect(report.readyAfterDelay).toBe(true);
    expect(report.echoSlot).toBe('U');
    expect(report.echoStrength).toBe(E06_ECHO_STRENGTH);
    expect(report.echoStrengthApplied).toBeCloseTo(E06_ECHO_STRENGTH, 10);
    expect(report.echoDelaySeconds).toBe(E06_ECHO_DELAY_SECONDS);
  });

  it('复施不递归：消费后没有新的待执行复施，也不累计释放次数', () => {
    const report = runSkillEchoDemo();
    expect(report.echoStillPending).toBe(false);
    expect(report.recursiveEcho).toBe(false);
    expect(report.echoesAfterConsume).toBe(1);
    expect(report.castsAfterEcho).toBe(0);
    expect(report.snapshot.e06EchoPending).toBe(false);
    expect(report.snapshot.e06Casts).toBe(0);
  });
});
