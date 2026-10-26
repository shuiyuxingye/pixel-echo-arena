import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArenaLayout, isCircleBlocked } from '../src/game/arena';
import { getCharacter } from '../src/game/data';
import {
  SOUL_RADIUS,
  SOUL_SPAWN_DISTANCE,
  SoulSystem,
  resolveSoulSpawnPoint,
  type SoulConfig,
  type SoulMarkSink,
  type SoulTarget,
} from '../src/game/soul';
import { FACING_VECTORS, type Facing } from '../src/game/movement';
import { DEFAULT_KEY_BINDINGS } from '../src/game/settings';

const ROOT = process.cwd();
const VISHDA = getCharacter('vishdal');
const K = VISHDA.skillK;

const STEP = 1 / 60;
const FACINGS: readonly Facing[] = [
  'east',
  'southEast',
  'south',
  'southWest',
  'west',
  'northWest',
  'north',
  'northEast',
];

function config(overrides: Partial<SoulConfig> = {}): SoulConfig {
  return {
    cooldownSeconds: K.cooldownSeconds,
    durationSeconds: K.durationSeconds ?? 12,
    maxSummons: K.params?.maxSummons ?? 1,
    tickSeconds: K.params?.tickSeconds ?? 1.5,
    markRadius: K.params?.markRadius ?? 240,
    slowPercent: K.params?.slowPercent ?? 0.2,
    slowDurationSeconds: K.params?.slowDurationSeconds ?? 1,
    ...overrides,
  };
}

class FakeMarks implements SoulMarkSink {
  readonly marked = new Set<string>();
  readonly markOrder: string[] = [];

  mark(targetId: string): void {
    this.marked.add(targetId);
    this.markOrder.push(targetId);
  }

  isMarked(targetId: string): boolean {
    return this.marked.has(targetId);
  }
}

function target(id: string, x: number, y: number, isAlive = true): SoulTarget {
  return { id, x, y, isAlive };
}

function system(overrides: Partial<SoulConfig> = {}, marks = new FakeMarks()): SoulSystem {
  return new SoulSystem(config(overrides), marks);
}

describe('魂灵生成位置', () => {
  it('八个面向都在玩家前方 40 像素生成', () => {
    const layout = createArenaLayout();
    const origin = layout.spawn;

    for (const facing of FACINGS) {
      const point = resolveSoulSpawnPoint(layout, origin, facing);
      const direction = FACING_VECTORS[facing];
      expect(point.x).toBeCloseTo(origin.x + direction.x * SOUL_SPAWN_DISTANCE, 9);
      expect(point.y).toBeCloseTo(origin.y + direction.y * SOUL_SPAWN_DISTANCE, 9);
      expect(isCircleBlocked(layout, point.x, point.y, SOUL_RADIUS)).toBe(false);
    }
  });

  it('理想点被墙阻挡时改取附近最近合法空位', () => {
    const layout = createArenaLayout();
    const origin = { x: 40, y: 480 };
    const ideal = { x: origin.x - SOUL_SPAWN_DISTANCE, y: origin.y };

    expect(isCircleBlocked(layout, ideal.x, ideal.y, SOUL_RADIUS)).toBe(true);

    const point = resolveSoulSpawnPoint(layout, origin, 'west');
    expect(isCircleBlocked(layout, point.x, point.y, SOUL_RADIUS)).toBe(false);
    expect(Math.hypot(point.x - ideal.x, point.y - ideal.y)).toBeLessThanOrEqual(160);
  });
});

describe('魂灵寿命与上限', () => {
  it('召唤后持续 12 秒，寿命终点仍结算最后一次标记', () => {
    const soul = system();
    expect(soul.trySummon({ x: 100, y: 100 })).not.toBeNull();
    expect(soul.soulCount).toBe(1);
    expect(soul.snapshots[0]?.remainingSeconds).toBeCloseTo(12, 12);

    let tickCount = 0;
    for (let step = 0; step < 719; step += 1) {
      tickCount += soul.step(STEP, []).ticks.length;
    }
    expect(soul.soulCount).toBe(1);
    expect(tickCount).toBe(7);

    const final = soul.step(STEP, []);
    expect(final.ticks).toHaveLength(1);
    expect(final.expiredSoulIds).toEqual([1]);
    expect(soul.soulCount).toBe(0);
  });

  it('默认上限 1 个，达到上限时替换最早生成者', () => {
    const soul = system({ cooldownSeconds: 1 });

    const first = soul.trySummon({ x: 0, y: 0 });
    expect(first?.replacedSoulId).toBeNull();
    soul.step(1, []);

    const second = soul.trySummon({ x: 40, y: 0 });
    expect(second?.replacedSoulId).toBe(1);
    expect(second?.soul.id).toBe(2);
    expect(soul.soulCount).toBe(1);
    expect(soul.snapshots.map((snapshot) => snapshot.id)).toEqual([2]);
  });

  it('上限为 2 时只替换最早的一个并保留另一个', () => {
    const soul = system({ cooldownSeconds: 0.1, maxSummons: 2 });

    soul.trySummon({ x: 0, y: 0 });
    soul.step(0.1, []);
    soul.trySummon({ x: 40, y: 0 });
    soul.step(0.1, []);

    const third = soul.trySummon({ x: 80, y: 0 });
    expect(third?.replacedSoulId).toBe(1);
    expect(soul.soulCount).toBe(2);
    expect(soul.snapshots.map((snapshot) => snapshot.id)).toEqual([2, 3]);
  });

  it('冷却 14 秒内再次召唤无效，冷却结束后可再次召唤', () => {
    const soul = system();
    soul.trySummon({ x: 0, y: 0 });
    expect(soul.cooldownRemaining).toBeCloseTo(14, 12);

    expect(soul.trySummon({ x: 40, y: 0 })).toBeNull();
    soul.step(13.9, []);
    expect(soul.trySummon({ x: 40, y: 0 })).toBeNull();

    soul.step(0.1, []);
    expect(soul.cooldownRemaining).toBe(0);
    expect(soul.trySummon({ x: 40, y: 0 })).not.toBeNull();
  });

  it('进入下一波清空剩余冷却，K 立即就绪且保留已有魂灵', () => {
    const soul = system();
    soul.trySummon({ x: 0, y: 0 });
    soul.step(2, []);

    soul.resetForWaveStart();
    expect(soul.cooldownRemaining).toBe(0);
    expect(soul.soulCount).toBe(1);
    expect(soul.trySummon({ x: 40, y: 0 })).not.toBeNull();
  });
});

describe('魂灵周期标记与减速', () => {
  it('每 1.5 秒给半径 240 内未标记的存活敌人附着残影，边界包含', () => {
    const marks = new FakeMarks();
    const soul = system({}, marks);
    soul.trySummon({ x: 0, y: 0 });
    marks.mark('already');

    const targets = [
      target('inside', 239, 0),
      target('edge', 240, 0),
      target('outside', 241, 0),
      target('dead', 0, 100, false),
      target('already', 0, -50),
    ];

    expect(soul.step(1.5, targets).ticks[0]?.affectedTargetIds).toEqual(['inside', 'edge']);
    expect(soul.step(0, targets).ticks).toHaveLength(0);
    expect([...marks.marked].sort()).toEqual(['already', 'edge', 'inside']);
  });

  it('只附着未标记者：已带残影的敌人不重复标记、不重新减速', () => {
    const marks = new FakeMarks();
    const soul = system({}, marks);
    soul.trySummon({ x: 0, y: 0 });
    marks.mark('marked');

    const targets = [target('marked', 10, 0), target('fresh', 20, 0)];
    const result = soul.step(1.5, targets);

    expect(result.ticks[0]?.affectedTargetIds).toEqual(['fresh']);
    expect(marks.markOrder).toEqual(['marked', 'fresh']);
    expect(soul.isSlowed('fresh')).toBe(true);
    expect(soul.isSlowed('marked')).toBe(false);
  });

  it('减速 20% 持续 1 秒，到期后移速恢复正常', () => {
    const soul = system();
    soul.trySummon({ x: 0, y: 0 });
    soul.step(1.5, [target('enemy', 100, 0)]);

    expect(soul.isSlowed('enemy')).toBe(true);
    expect(soul.slowRemaining('enemy')).toBeCloseTo(1, 9);
    expect(soul.slowMultiplier('enemy')).toBeCloseTo(0.8, 12);

    for (let step = 0; step < 59; step += 1) soul.step(STEP, []);
    expect(soul.slowRemaining('enemy')).toBeGreaterThan(0);

    soul.step(STEP, []);
    expect(soul.isSlowed('enemy')).toBe(false);
    expect(soul.slowMultiplier('enemy')).toBe(1);
  });

  it('魂灵不直接造成伤害，也不依赖 Phaser', () => {
    const source = readFileSync(resolve(ROOT, 'src/game/soul.ts'), 'utf8');
    expect(source).not.toContain('applyDamage');
    expect(source).not.toMatch(/from\s+['"]phaser['"]/);
  });
});

describe('场景接入', () => {
  it('竞技场场景用 K 召唤魂灵、每步推进并显示减速状态', () => {
    const source = readFileSync(resolve(ROOT, 'src/game/scenes/ArenaScene.ts'), 'utf8');

    expect(source).toContain('SoulSystem');
    expect(source).toContain('resolveSoulSpawnPoint');
    // 键位经共享设置解析，默认 K 映射到 skillK（US-022 起不再硬编码物理键）。
    expect(DEFAULT_KEY_BINDINGS.skillK).toBe('KeyK');
    expect(source).toContain('combatBindingActionForKeyCode');
    expect(source).toContain("action === 'skillK'");
    expect(source).toContain('this.soul.step');
    expect(source).toContain('slowRemaining');
  });
});

describe('I15 技能持续时间倍率', () => {
  it('延长魂灵寿命，不改变 tick 与冷却', () => {
    const soul = new SoulSystem(config(), new FakeMarks());
    soul.setDurationMultiplier(1.15);
    expect(soul.trySummon({ x: 720, y: 480 })).not.toBeNull();
    const stillAlive = soul.step(12.1, []);
    expect(stillAlive.expiredSoulIds).toHaveLength(0);
    expect(soul.soulCount).toBe(1);
    const expired = soul.step(1.8, []);
    expect(expired.expiredSoulIds).toHaveLength(1);
    expect(soul.soulCount).toBe(0);
  });
});
