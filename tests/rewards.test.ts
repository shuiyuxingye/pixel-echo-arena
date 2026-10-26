import { describe, expect, it } from 'vitest';
import {
  MAX_REWARD_ENTRIES,
  RewardQueue,
  REWARD_KIND_ORDER,
  formatRewardPrompt,
  formatWaveBriefing,
  rewardKindRank,
  waveEndChannel,
  type RewardEntry,
} from '../src/game/rewards';

describe('奖励队列顺序与唯一 ID', () => {
  it('固定按宝箱 → 核心 → 升级 → 机制处理，与入队顺序无关', () => {
    const queue = new RewardQueue();
    queue.enqueue('mechanic', 'mechanic:6');
    queue.enqueue('upgrade', 'upgrade:6:2');
    queue.enqueue('upgrade', 'upgrade:6:1');
    queue.enqueue('core', 'core:core-6', 'core-6');
    queue.enqueue('chest', 'chest:w6-1', 'w6-1');

    expect(queue.entries.map((entry) => entry.kind)).toEqual([
      'chest',
      'core',
      'upgrade',
      'upgrade',
      'mechanic',
    ]);
    // 同种类保持入队顺序。
    expect(queue.entries.map((entry) => entry.id)).toEqual([
      'chest:w6-1',
      'core:core-6',
      'upgrade:6:2',
      'upgrade:6:1',
      'mechanic:6',
    ]);
    expect(REWARD_KIND_ORDER.map(rewardKindRank)).toEqual([0, 1, 2, 3]);
  });

  it('重复 ID 被拒绝，不会出现两份相同奖励', () => {
    const queue = new RewardQueue();
    expect(queue.enqueue('core', 'core:core-6', 'core-6')).not.toBeNull();
    expect(queue.enqueue('core', 'core:core-6', 'core-6')).toBeNull();
    expect(queue.entries).toHaveLength(1);
    expect(queue.remainingCount).toBe(1);
  });

  it('空 ID、未知种类与超过上限的条目被拒绝', () => {
    const queue = new RewardQueue();
    expect(queue.enqueue('chest', '')).toBeNull();
    expect(
      queue.enqueue('nope' as unknown as 'chest', 'reward-1'),
    ).toBeNull();

    for (let index = 0; index < MAX_REWARD_ENTRIES; index += 1) {
      expect(queue.enqueue('chest', `chest:${index}`)).not.toBeNull();
    }
    expect(queue.enqueue('chest', 'chest:overflow')).toBeNull();
    expect(queue.entries).toHaveLength(MAX_REWARD_ENTRIES);
  });
});

describe('多份资格逐个处理', () => {
  it('每次只暴露当前条目，并实时更新剩余数量', () => {
    const queue = new RewardQueue();
    queue.enqueue('chest', 'chest:w6-1');
    queue.enqueue('chest', 'chest:w6-2');
    queue.enqueue('core', 'core:core-6', 'core-6');

    expect(queue.current?.id).toBe('chest:w6-1');
    expect(queue.remainingCount).toBe(3);

    expect(queue.resolveCurrent('claimed')).toBe(true);
    expect(queue.current?.id).toBe('chest:w6-2');
    expect(queue.remainingCount).toBe(2);

    expect(queue.abandon('chest:w6-2')).toBe(true);
    expect(queue.current?.id).toBe('core:core-6');
    expect(queue.remainingCount).toBe(1);

    expect(queue.resolveCurrent('claimed')).toBe(true);
    expect(queue.current).toBeNull();
    expect(queue.isComplete).toBe(true);
  });

  it('已处理的条目不能重复领取或反向改状态', () => {
    const queue = new RewardQueue();
    queue.enqueue('core', 'core:core-6', 'core-6');
    expect(queue.claim('core:core-6')).toBe(true);
    expect(queue.claim('core:core-6')).toBe(false);
    expect(queue.abandon('core:core-6')).toBe(false);
    expect(queue.entries[0]?.status).toBe('claimed');
    expect(queue.remainingOf('core')).toBe(0);
  });

  it('未知 ID 与 pending 状态不会改变队列', () => {
    const queue = new RewardQueue();
    queue.enqueue('upgrade', 'upgrade:7:1');
    expect(queue.resolve('missing', 'claimed')).toBe(false);
    expect(queue.resolve('upgrade:7:1', 'pending')).toBe(false);
    expect(queue.entries[0]?.status).toBe('pending');
  });
});

describe('刷新与恢复', () => {
  it('快照往返保留唯一 ID、种类、来源与已领取状态', () => {
    const queue = new RewardQueue();
    queue.enqueueAll([
      { kind: 'chest', id: 'chest:w6-1', sourceId: 'w6-1' },
      { kind: 'core', id: 'core:core-6', sourceId: 'core-6' },
      { kind: 'upgrade', id: 'upgrade:6:1' },
    ]);
    queue.resolveCurrent('claimed');

    const snapshot = queue.snapshot();
    const restored = new RewardQueue();
    restored.restore(snapshot);

    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.entries.map((entry: RewardEntry) => entry.status)).toEqual([
      'claimed',
      'pending',
      'pending',
    ]);
    expect(restored.current?.kind).toBe('core');
  });

  it('恢复时忽略非法条目与重复 ID，并重新排好顺序', () => {
    const queue = new RewardQueue();
    queue.restore([
      { id: 'upgrade:7:1', kind: 'upgrade', status: 'pending' },
      { id: '', kind: 'chest', status: 'pending' },
      { id: 'bad-kind', kind: 'nope', status: 'pending' },
      { id: 'bad-status', kind: 'chest', status: 'nope' },
      { id: 'upgrade:7:1', kind: 'upgrade', status: 'claimed' },
      { id: 'core:core-9', kind: 'core', status: 'abandoned', sourceId: 'core-9' },
      { id: 'chest:w7-1', kind: 'chest', status: 'pending' },
    ] as unknown as RewardEntry[]);

    expect(queue.entries.map((entry) => entry.id)).toEqual([
      'chest:w7-1',
      'core:core-9',
      'upgrade:7:1',
    ]);
    expect(queue.entries.map((entry) => entry.status)).toEqual([
      'pending',
      'abandoned',
      'pending',
    ]);
    expect(queue.remainingCount).toBe(2);
  });

  it('恢复后不会重领已领取资格，也不会遗漏剩余资格', () => {
    const queue = new RewardQueue();
    queue.restore([
      { id: 'core:core-6', kind: 'core', status: 'claimed', sourceId: 'core-6' },
      { id: 'upgrade:6:1', kind: 'upgrade', status: 'pending' },
      { id: 'upgrade:6:2', kind: 'upgrade', status: 'pending' },
    ]);
    expect(queue.current?.id).toBe('upgrade:6:1');
    expect(queue.claim('core:core-6')).toBe(false);
    expect(queue.resolveCurrent('claimed')).toBe(true);
    expect(queue.current?.id).toBe('upgrade:6:2');
    expect(queue.remainingCount).toBe(1);
  });
});

describe('波末简报与出口', () => {
  it('简报先给本波击杀、完成金币、总金币与剩余奖励数量', () => {
    const text = formatWaveBriefing({
      wave: 6,
      waveKills: 12,
      completionGold: 36,
      totalGold: 128,
      remainingRewards: 2,
    });
    expect(text).toContain('第 6 波结束');
    expect(text).toContain('本波击杀 12');
    expect(text).toContain('完成金币 +36');
    expect(text).toContain('当前金币 128');
    expect(text).toContain('待领取奖励 2 项');
    expect(text).toContain('按 Enter 继续');
  });

  it('没有奖励时简报明确说明，不会伪造数量', () => {
    const text = formatWaveBriefing({
      wave: 1,
      waveKills: 3,
      completionGold: 21,
      totalGold: 61,
      remainingRewards: 0,
    });
    expect(text).toContain('没有待领取奖励');
    expect(text).not.toContain('待领取奖励 0 项');
  });

  it('奖励面板显示来源、剩余数量与确认/放弃按键', () => {
    const text = formatRewardPrompt(
      { kind: 'core', sourceId: 'core-6' },
      3,
    );
    expect(text).toContain('精英核心 · core-6');
    expect(text).toContain('剩余待领取 3 项');
    expect(text).toContain('Enter 确认领取');
    expect(text).toContain('X 放弃');
  });

  it('第 1–17 波进入商店，第 18 波直接结算', () => {
    for (let wave = 1; wave <= 17; wave += 1) {
      expect(waveEndChannel(wave)).toBe('shop');
    }
    expect(waveEndChannel(18)).toBe('result');
    expect(() => waveEndChannel(0)).toThrow();
    expect(() => waveEndChannel(19)).toThrow();
  });
});
