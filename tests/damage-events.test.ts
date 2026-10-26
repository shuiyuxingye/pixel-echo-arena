import { describe, expect, it } from 'vitest';
import {
  CombatEventLog,
  DamageChainTracker,
  UNATTRIBUTED_SOURCE,
  type CombatEvent,
} from '../src/game/damage-events';
import { Combatant, HealthState, computeDamage } from '../src/game/combat';

describe('伤害来源链', () => {
  it('每次原生攻击生成独立链，多段命中共享同一条链', () => {
    const chains = new DamageChainTracker();
    const first = chains.beginNative('J');
    const second = chains.beginNative('J');

    expect(first.chainId).toBe('chain-1');
    expect(second.chainId).toBe('chain-2');
    expect(first.origin).toBe('native');
    expect(first.depth).toBe(0);
    expect(chains.nativeHit(first)).toBe(first);
    expect(chains.nativeHit(first).chainId).toBe(first.chainId);
  });

  it('原生来源可派生一次，衍生来源不能再派生', () => {
    const chains = new DamageChainTracker();
    const native = chains.beginNative('E01');

    const split = chains.derive(native, 'demo.split');
    expect(split).not.toBeNull();
    expect(split).toMatchObject({
      sourceId: 'demo.split',
      chainId: native.chainId,
      origin: 'derived',
      depth: 1,
    });
    expect(chains.canDerive(native)).toBe(true);

    if (!split) return;
    expect(chains.canDerive(split)).toBe(false);
    expect(chains.derive(split, 'demo.explosion')).toBeNull();
    expect(chains.derive(split, 'demo.counter')).toBeNull();
  });

  it('非法来源 ID 直接抛错，避免无来源事件进入日志', () => {
    const chains = new DamageChainTracker();
    expect(() => chains.beginNative('')).toThrow();
    const native = chains.beginNative('J');
    expect(() => chains.derive(native, '')).toThrow();
  });
});

describe('战斗事件日志', () => {
  it('记录伤害与治疗事件并返回副本', () => {
    const log = new CombatEventLog(4);
    const source = new DamageChainTracker().beginNative('J');
    const event: CombatEvent = {
      kind: 'damage',
      targetId: 'enemy-1',
      amount: 12,
      rawAmount: 12,
      applied: true,
      damageType: 'physical',
      ...source,
    };
    log.record(event);

    const snapshot = log.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      kind: 'damage',
      targetId: 'enemy-1',
      sourceId: 'J',
      chainId: source.chainId,
      origin: 'native',
      depth: 0,
    });

    const mutable = snapshot as CombatEvent[];
    mutable.pop();
    expect(log.size).toBe(1);
  });

  it('超过容量时丢弃最旧事件', () => {
    const log = new CombatEventLog(2);
    const source = new DamageChainTracker().beginNative('J');
    for (const targetId of ['a', 'b', 'c']) {
      log.record({
        kind: 'damage',
        targetId,
        amount: 1,
        rawAmount: 1,
        applied: true,
        damageType: 'true',
        ...source,
      });
    }
    expect(log.snapshot().map((event) => event.targetId)).toEqual(['b', 'c']);
  });
});

describe('HealthState 事件接线', () => {
  it('伤害事件携带来源、链与减免前后数值', () => {
    const log = new CombatEventLog();
    const source = new DamageChainTracker().beginNative('J');
    const health = new HealthState({
      id: 'enemy-1',
      events: log,
      maxHealth: 100,
      armor: 25,
    });

    const result = health.applyDamage(40, 'physical', source);
    expect(result.applied).toBe(true);

    const [event] = log.snapshot();
    expect(event).toMatchObject({
      kind: 'damage',
      targetId: 'enemy-1',
      sourceId: 'J',
      chainId: source.chainId,
      origin: 'native',
      depth: 0,
      rawAmount: 40,
      amount: computeDamage(40, 'physical', 25, 0),
      applied: true,
      damageType: 'physical',
    });
  });

  it('重复命中已死亡目标仍记录事件但 applied=false', () => {
    const log = new CombatEventLog();
    const source = new DamageChainTracker().beginNative('J');
    const health = new HealthState({ id: 'enemy-1', events: log, maxHealth: 10 });

    health.applyDamage(30, 'true', source);
    const second = health.applyDamage(30, 'true', source);
    expect(second.applied).toBe(false);

    const events = log.snapshot();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ kind: 'damage', applied: false });
  });

  it('治疗事件记录实际恢复量，满血与死亡时不再回复', () => {
    const log = new CombatEventLog();
    const source = new DamageChainTracker().beginNative('K');
    const health = new HealthState({ id: 'player', events: log, maxHealth: 100 });

    expect(health.heal(30, source)).toBe(0);
    health.applyDamage(50, 'true', source);
    expect(health.heal(30, source)).toBe(30);
    expect(health.heal(100, source)).toBe(20);
    expect(health.heal(10, source)).toBe(0);

    const heals = log.snapshot().filter((event) => event.kind === 'heal');
    expect(heals.map((event) => event.amount)).toEqual([0, 30, 20, 0]);
    expect(heals.map((event) => event.applied)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(heals[0]).toMatchObject({
      sourceId: 'K',
      chainId: source.chainId,
      origin: 'native',
      depth: 0,
      targetId: 'player',
    });
  });

  it('未提供来源时使用兜底来源，字段仍然齐全', () => {
    const log = new CombatEventLog();
    const health = new HealthState({ events: log, maxHealth: 100 });
    health.applyDamage(10, 'true');

    const [event] = log.snapshot();
    expect(event).toMatchObject({
      ...UNATTRIBUTED_SOURCE,
      targetId: 'unknown',
      kind: 'damage',
    });
  });

  it('Combatant 把目标 ID 传给生命事件', () => {
    const log = new CombatEventLog();
    const combatant = new Combatant({
      id: 'enemy-9',
      x: 0,
      y: 0,
      maxHealth: 50,
      events: log,
    });
    const source = new DamageChainTracker().beginNative('J');
    combatant.applyDamage(10, 'true', source);

    expect(log.snapshot()[0]).toMatchObject({ targetId: 'enemy-9' });
  });
});
