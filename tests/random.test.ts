import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UPGRADE_LIST } from '../src/game/data';
import {
  RANDOM_STREAM_NAMES,
  RandomStream,
  RunRandomStreams,
  createEntropySeed,
  deriveStreamSeed,
  isValidRandomState,
} from '../src/game/random';
import { UpgradeRun } from '../src/game/upgrade';

const ROOT = process.cwd();

/** 连续消费指定次数，便于比较两条流的序列。 */
function take(stream: { next(): number }, count: number): number[] {
  return Array.from({ length: count }, () => stream.next());
}

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function handIds(run: UpgradeRun): string[] {
  return run.createChoice('upgrade').hand.map((card) => card.id);
}

describe('命名随机流', () => {
  it('战斗与商店/奖励是两条固定命名的流', () => {
    expect(RANDOM_STREAM_NAMES).toEqual(['combat', 'reward']);

    const streams = new RunRandomStreams(20261021);
    expect(streams.stream('combat')).toBe(streams.combat);
    expect(streams.stream('reward')).toBe(streams.reward);
    expect(() => streams.stream('unknown' as never)).toThrow();
  });

  it('同 seed 与相同消费顺序重放完全一致，不同 seed 不同', () => {
    const first = new RunRandomStreams(20261021);
    const second = new RunRandomStreams(20261021);
    const other = new RunRandomStreams(20261022);

    expect(take(first.combat, 8)).toEqual(take(second.combat, 8));
    expect(take(first.reward, 8)).toEqual(take(second.reward, 8));
    expect(take(other.combat, 8)).not.toEqual(take(first.combat, 8));
    expect(take(other.reward, 8)).not.toEqual(take(first.reward, 8));
  });

  it('两条流由同一局种子派生但初始序列互不相同', () => {
    const seed = 987654321;
    expect(deriveStreamSeed(seed, 'combat')).not.toBe(
      deriveStreamSeed(seed, 'reward'),
    );

    const streams = new RunRandomStreams(seed);
    expect(streams.seed).toBe(seed);
    expect(streams.combat.seed).not.toBe(streams.reward.seed);
    expect(take(streams.combat, 6)).not.toEqual(take(streams.reward, 6));
  });

  it('只消耗战斗流不改变商店/奖励流的下一个结果', () => {
    const streams = new RunRandomStreams(424242);
    const rewardBaseline = take(new RunRandomStreams(424242).reward, 8);

    expect(take(streams.combat, 32)).toHaveLength(32);
    expect(take(streams.reward, 8)).toEqual(rewardBaseline);
  });

  it('只消耗商店/奖励流不改变战斗流的下一个结果', () => {
    const streams = new RunRandomStreams(424242);
    const combatBaseline = take(new RunRandomStreams(424242).combat, 8);

    expect(take(streams.reward, 32)).toHaveLength(32);
    expect(take(streams.combat, 8)).toEqual(combatBaseline);
  });

  it('快照与恢复后从原位置继续，不重放也不跳号', () => {
    const streams = new RunRandomStreams(13579);
    take(streams.combat, 3);
    take(streams.reward, 5);
    const snapshot = streams.snapshot();

    const expectedCombat = take(streams.combat, 6);
    const expectedReward = take(streams.reward, 6);

    const restored = new RunRandomStreams(999);
    expect(restored.restore(snapshot)).toBe(true);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(take(restored.combat, 6)).toEqual(expectedCombat);
    expect(take(restored.reward, 6)).toEqual(expectedReward);
  });

  it('单条流提供快照与恢复接口，且拒绝把状态恢复进另一条流', () => {
    const combat = new RandomStream('combat', 777);
    const reward = new RandomStream('reward', 777);
    take(combat, 4);
    take(reward, 2);

    const combatSnapshot = combat.snapshot();
    expect(reward.restore(combatSnapshot)).toBe(false);
    expect(combat.restore(combatSnapshot)).toBe(true);
    expect(combat.snapshot()).toEqual(combatSnapshot);

    const expected = take(combat, 4);
    const restored = new RandomStream('combat', 1);
    expect(restored.restore(combatSnapshot)).toBe(true);
    expect(take(restored, 4)).toEqual(expected);
  });

  it('非法或越界状态拒绝恢复并保留原状态，不消耗随机数', () => {
    const invalidStates: unknown[] = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      1.5,
      0x100000000,
      '123',
      null,
      undefined,
    ];
    const seed = 60606;

    const streams = new RunRandomStreams(seed);
    take(streams.combat, 3);
    take(streams.reward, 2);
    const before = streams.snapshot();

    for (const invalid of invalidStates) {
      expect(streams.restore({ combat: invalid, reward: before.reward })).toBe(false);
      expect(streams.restore({ combat: before.combat, reward: invalid })).toBe(false);
      expect(streams.restore({ combat: invalid, reward: invalid })).toBe(false);
      expect(streams.snapshot()).toEqual(before);
    }
    expect(streams.restore(null)).toBe(false);
    expect(streams.restore({ combat: before.combat })).toBe(false);
    expect(streams.snapshot()).toEqual(before);

    // 与从未尝试恢复的对照序列一致，证明非法恢复没有消耗随机数。
    const control = new RunRandomStreams(seed);
    take(control.combat, 3);
    take(control.reward, 2);
    expect(take(streams.combat, 6)).toEqual(take(control.combat, 6));
    expect(take(streams.reward, 6)).toEqual(take(control.reward, 6));
  });

  it('单条流的非法恢复同样保留状态且不消耗随机数', () => {
    const stream = new RandomStream('reward', 24680);
    take(stream, 5);
    const state = stream.snapshotState;

    for (const invalid of [Number.NaN, -0.5, 0x1_0000_0000, '5', {}]) {
      expect(stream.restoreState(invalid)).toBe(false);
      expect(stream.snapshotState).toBe(state);
    }

    const control = new RandomStream('reward', 24680);
    take(control, 5);
    expect(take(stream, 5)).toEqual(take(control, 5));
  });

  it('状态合法性只接受 0..0xffffffff 的整数', () => {
    expect(isValidRandomState(0)).toBe(true);
    expect(isValidRandomState(0xffffffff)).toBe(true);
    for (const invalid of [
      -1,
      0.5,
      0x1_0000_0000,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '0',
      null,
    ]) {
      expect(isValidRandomState(invalid)).toBe(false);
    }
  });

  it('只恢复其中一条流时不改动另一条', () => {
    const streams = new RunRandomStreams(31415);
    take(streams.combat, 2);
    take(streams.reward, 7);
    const before = streams.snapshot();

    expect(streams.restoreStream('combat', before.combat)).toBe(true);
    expect(streams.restoreStream('reward', 0)).toBe(true);
    expect(streams.snapshot()).toEqual({ combat: before.combat, reward: 0 });
    expect(streams.restoreStream('reward', -1)).toBe(false);
    expect(streams.snapshot().reward).toBe(0);
  });

  it('新局种子落在合法无符号 32 位范围内', () => {
    for (let index = 0; index < 8; index += 1) {
      const seed = createEntropySeed();
      expect(isValidRandomState(seed)).toBe(true);
    }
  });
});

describe('海克斯手牌使用奖励流', () => {
  it('注入 reward 流后，抽牌只推进 reward，不触碰 combat', () => {
    const seed = 20261021;
    const streams = new RunRandomStreams(seed);
    const combatState = streams.combat.snapshotState;
    const rewardState = streams.reward.snapshotState;

    const run = new UpgradeRun({
      characterId: 'vishdal',
      pool: UPGRADE_LIST,
      seed,
      random: streams.reward,
    });
    expect(handIds(run)).toHaveLength(3);

    expect(streams.combat.snapshotState).toBe(combatState);
    expect(streams.reward.snapshotState).not.toBe(rewardState);
    expect(run.randomState).toBe(streams.reward.snapshotState);
  });

  it('同 seed 下先消耗战斗流，海克斯手牌仍与未消耗时一致', () => {
    const seed = 88888;
    const clean = new RunRandomStreams(seed);
    const cleanRun = new UpgradeRun({
      characterId: 'vishdal',
      pool: UPGRADE_LIST,
      seed,
      random: clean.reward,
    });
    const expected = handIds(cleanRun);

    const consumed = new RunRandomStreams(seed);
    take(consumed.combat, 50);
    const run = new UpgradeRun({
      characterId: 'vishdal',
      pool: UPGRADE_LIST,
      seed,
      random: consumed.reward,
    });

    expect(handIds(run)).toEqual(expected);
  });

  it('奖励流快照恢复后从同一位置继续抽牌', () => {
    const seed = 55555;
    const first = new RunRandomStreams(seed);
    const run = new UpgradeRun({
      characterId: 'vishdal',
      pool: UPGRADE_LIST,
      seed,
      random: first.reward,
    });

    expect(handIds(run)).toHaveLength(3);
    const stateAfterFirstHand = run.randomState;
    const expectedSecondHand = handIds(run);

    const second = new RunRandomStreams(seed);
    const restoredRun = new UpgradeRun({
      characterId: 'vishdal',
      pool: UPGRADE_LIST,
      seed,
      random: second.reward,
    });
    restoredRun.restore({
      stacks: [],
      rerollsRemaining: run.rerollsRemaining,
      randomState: stateAfterFirstHand,
    });

    expect(handIds(restoredRun)).toEqual(expectedSecondHand);
  });
});

describe('玩法代码不直接调用 Math.random', () => {
  it('熵源只允许出现在 src/game/random.ts', () => {
    const offenders = listTsFiles(resolve(ROOT, 'src'))
      .filter((file) => readFileSync(file, 'utf8').includes('Math.random'))
      .map((file) => relative(ROOT, file).split('\\').join('/'))
      .filter((file) => file !== 'src/game/random.ts');

    expect(offenders).toEqual([]);
  });

  it('场景通过 createEntropySeed 开新局，成绩 id 通过统一后缀生成', () => {
    const scene = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    expect(scene).toContain('createEntropySeed()');
    expect(scene).not.toContain('Math.random');

    const results = readFileSync(resolve(ROOT, 'src/game/run-results.ts'), 'utf8');
    expect(results).toContain('createUniqueSuffix');
    expect(results).not.toContain('Math.random');
  });
});
