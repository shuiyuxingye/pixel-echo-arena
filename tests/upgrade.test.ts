import { describe, expect, it } from 'vitest';
import {
  UPGRADE_LIST,
  type CharacterId,
  type Rarity,
  type UpgradeDefinition,
  type UpgradeOwner,
} from '../src/game/data';
import {
  CARDS_PER_HAND,
  DEFAULT_REROLLS_PER_RUN,
  RARITY_WEIGHTS,
  SeededRandom,
  UpgradeChoice,
  UpgradeRun,
  drawMechanicHand,
  drawUpgradeHand,
  type UpgradePoolState,
} from '../src/game/upgrade';
import { WaveRewardFlow } from '../src/game/wave';

/** 临时测试卡牌数据，用于验证抽取规则；不依赖正式 24 张强化池。 */
function card(
  id: string,
  owner: UpgradeOwner,
  rarity: Rarity,
  maxStacks = 1,
): UpgradeDefinition {
  return {
    id,
    name: `卡${id}`,
    rarity,
    maxStacks,
    owner,
    description: `${id} 的测试效果`,
    appliesTo: 'J',
  };
}

function poolState(
  pool: readonly UpgradeDefinition[],
  characterId: CharacterId = 'vishdal',
  stacks: Readonly<Record<string, number>> = {},
): UpgradePoolState {
  return {
    characterId,
    pool,
    stacks: new Map(Object.entries(stacks)),
  };
}

/** 固定随机序列：按顺序返回值，用尽后返回 0。 */
function sequenceRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index] ?? 0;
    index += 1;
    return value;
  };
}

const THREE_RARITY_POOL: readonly UpgradeDefinition[] = [
  card('S1', 'general', 'silver'),
  card('S2', 'general', 'silver'),
  card('S3', 'general', 'silver'),
  card('G1', 'general', 'gold'),
  card('G2', 'general', 'gold'),
  card('G3', 'general', 'gold'),
  card('P1', 'general', 'prismatic'),
];

describe('随机源', () => {
  it('同种子序列完全一致，不同种子不同，且落在 [0, 1)', () => {
    const first = new SeededRandom(20261019);
    const second = new SeededRandom(20261019);
    const left = [first.next(), first.next(), first.next(), first.next()];
    const right = [second.next(), second.next(), second.next(), second.next()];

    expect(left).toEqual(right);
    expect(left.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new SeededRandom(1).next()).not.toBe(new SeededRandom(2).next());
    expect(() => new SeededRandom(Number.NaN)).toThrow();
  });
});

describe('普通三选一抽取', () => {
  it('一手 3 张互不重复，只出通用与当前角色专属', () => {
    const pool = [
      card('G01', 'general', 'silver'),
      card('G02', 'general', 'gold'),
      card('G03', 'general', 'prismatic'),
      card('W01', 'vishdal', 'silver'),
      card('W02', 'vishdal', 'gold'),
      card('A01', 'amiya', 'gold'),
      card('S01', 'saria', 'gold'),
      card('M01', 'muelsyse', 'gold'),
    ];

    for (let round = 0; round < 40; round += 1) {
      const random = new SeededRandom(round * 97 + 3);
      const hand = drawUpgradeHand(() => random.next(), poolState(pool));
      expect(hand).toHaveLength(CARDS_PER_HAND);
      expect(new Set(hand.map((entry) => entry.id)).size).toBe(CARDS_PER_HAND);
      expect(
        hand.every((entry) => entry.owner === 'general' || entry.owner === 'vishdal'),
      ).toBe(true);
      expect(hand.some((entry) => entry.owner === 'amiya')).toBe(false);
    }
  });

  it('角色适用过滤：阿米娅不抽到维什戴尔专属', () => {
    const pool = [
      card('W01', 'vishdal', 'silver'),
      card('A01', 'amiya', 'silver'),
      card('G01', 'general', 'silver'),
    ];
    const hand = drawUpgradeHand(sequenceRandom([0, 0, 0, 0, 0, 0]), poolState(pool, 'amiya'));

    expect(hand.map((entry) => entry.id)).not.toContain('W01');
    expect(hand.some((entry) => entry.id === 'A01')).toBe(true);
  });

  it('满层强化不再出现；有效卡不足时只出剩余数量', () => {
    const pool = [
      card('G01', 'general', 'silver', 3),
      card('G02', 'general', 'gold', 1),
      card('W01', 'vishdal', 'prismatic', 1),
    ];
    const hand = drawUpgradeHand(
      sequenceRandom([0, 0, 0, 0, 0, 0]),
      poolState(pool, 'vishdal', { G02: 1, W01: 1 }),
    );

    expect(hand.map((entry) => entry.id)).toEqual(['G01']);
  });

  it('同种子与同操作序列产生同一手牌；不同种子不同', () => {
    const pool = THREE_RARITY_POOL;
    const first = new UpgradeRun({ characterId: 'vishdal', pool, seed: 424242 });
    const second = new UpgradeRun({ characterId: 'vishdal', pool, seed: 424242 });
    const other = new UpgradeRun({ characterId: 'vishdal', pool, seed: 424243 });

    const firstChoice = first.createChoice('upgrade');
    const secondChoice = second.createChoice('upgrade');
    expect(firstChoice.hand.map((entry) => entry.id)).toEqual(
      secondChoice.hand.map((entry) => entry.id),
    );
    expect(firstChoice.reroll()).toBe(true);
    expect(secondChoice.reroll()).toBe(true);
    expect(firstChoice.hand.map((entry) => entry.id)).toEqual(
      secondChoice.hand.map((entry) => entry.id),
    );

    const otherChoice = other.createChoice('upgrade');
    expect(otherChoice.hand.map((entry) => entry.id)).not.toEqual(
      firstChoice.hand.map((entry) => entry.id),
    );
  });
});

describe('稀有度权重', () => {
  it('银/金/棱彩权重为 50/35/15', () => {
    expect(RARITY_WEIGHTS).toEqual({ silver: 50, gold: 35, prismatic: 15 });
  });

  it('权重切分：0–49% 银、50–84% 金、85% 以上棱彩', () => {
    const state = poolState(THREE_RARITY_POOL);
    const rarityFor = (roll: number): Rarity => {
      const hand = drawUpgradeHand(sequenceRandom([roll, 0]), state, { count: 1 });
      return hand[0]?.rarity ?? 'silver';
    };

    expect(rarityFor(0)).toBe('silver');
    expect(rarityFor(0.49)).toBe('silver');
    expect(rarityFor(0.5)).toBe('gold');
    expect(rarityFor(0.84)).toBe('gold');
    expect(rarityFor(0.85)).toBe('prismatic');
    expect(rarityFor(0.99)).toBe('prismatic');
  });

  it('无有效卡的稀有度移出并按剩余权重重新归一化', () => {
    // 银卡全部满层 → 只剩金 35 / 棱彩 15，归一化后 70% / 30%。
    const state = poolState(THREE_RARITY_POOL, 'vishdal', { S1: 1, S2: 1, S3: 1 });
    const rarityFor = (roll: number): Rarity => {
      const hand = drawUpgradeHand(sequenceRandom([roll, 0]), state, { count: 1 });
      return hand[0]?.rarity ?? 'silver';
    };

    expect(rarityFor(0)).toBe('gold');
    expect(rarityFor(0.69)).toBe('gold');
    expect(rarityFor(0.71)).toBe('prismatic');
  });

  it('同稀有度内等概率', () => {
    const state = poolState(THREE_RARITY_POOL);
    const pick = (withinRoll: number): string | undefined =>
      drawUpgradeHand(sequenceRandom([0, withinRoll]), state, { count: 1 })[0]?.id;

    expect(pick(0)).toBe('S1');
    expect(pick(0.34)).toBe('S2');
    expect(pick(0.67)).toBe('S3');
  });
});

describe('重抽', () => {
  const sixSilver = (): UpgradeDefinition[] =>
    ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map((id) => card(id, 'general', 'silver'));

  it('默认每局 2 次；重抽扣次数，用尽后失败', () => {
    expect(DEFAULT_REROLLS_PER_RUN).toBe(2);
    const run = new UpgradeRun({ characterId: 'vishdal', pool: sixSilver(), seed: 11 });
    const choice = run.createChoice('upgrade');

    expect(choice.rerollsRemaining).toBe(2);
    expect(choice.reroll()).toBe(true);
    expect(choice.rerollsRemaining).toBe(1);
    expect(choice.reroll()).toBe(true);
    expect(choice.rerollsRemaining).toBe(0);
    expect(choice.reroll()).toBe(false);
    expect(choice.rerollsRemaining).toBe(0);
  });

  it('池足够时新 3 张排除旧 3 张，且同一手不重复', () => {
    const run = new UpgradeRun({ characterId: 'vishdal', pool: sixSilver(), seed: 7 });
    const choice = run.createChoice('upgrade');
    const first = choice.hand.map((entry) => entry.id);

    expect(choice.reroll()).toBe(true);
    const second = choice.hand.map((entry) => entry.id);

    expect(second).toHaveLength(3);
    expect(new Set(second).size).toBe(3);
    expect(second.some((id) => first.includes(id))).toBe(false);
  });

  it('池不足时允许交集，但同一手不重复', () => {
    const fourSilver = ['S1', 'S2', 'S3', 'S4'].map((id) =>
      card(id, 'general', 'silver'),
    );
    const run = new UpgradeRun({ characterId: 'vishdal', pool: fourSilver, seed: 31 });
    const choice = run.createChoice('upgrade');
    const first = choice.hand.map((entry) => entry.id);

    expect(choice.reroll()).toBe(true);
    const second = choice.hand.map((entry) => entry.id);

    expect(second).toHaveLength(3);
    expect(new Set(second).size).toBe(3);
    expect(second.some((id) => first.includes(id))).toBe(true);
  });

  it('重抽不改变已获得强化', () => {
    const run = new UpgradeRun({ characterId: 'vishdal', pool: sixSilver(), seed: 5 });
    const choice = run.createChoice('upgrade');
    const ownedBefore = [...run.ownedIds()];

    expect(choice.reroll()).toBe(true);
    expect([...run.ownedIds()]).toEqual(ownedBefore);

    const confirmed = choice.confirm();
    expect(confirmed).not.toBeNull();
    expect(run.ownedIds()).toEqual([confirmed?.id]);
  });
});

describe('机制强化选择', () => {
  const mechState = (stacks: Readonly<Record<string, number>> = {}): UpgradePoolState =>
    poolState(UPGRADE_LIST, 'vishdal', stacks);

  it('优先取当前角色 4 张专属中的 3 张未拥有卡', () => {
    const random = new SeededRandom(2026);
    const hand = drawMechanicHand(() => random.next(), mechState());

    expect(hand).toHaveLength(3);
    expect(new Set(hand.map((entry) => entry.id)).size).toBe(3);
    expect(hand.every((entry) => entry.owner === 'vishdal')).toBe(true);
    expect(hand.every((entry) => ['W01', 'W02', 'W03', 'W04'].includes(entry.id))).toBe(true);
  });

  it('专属不足时用未拥有的金色通用补齐', () => {
    const random = new SeededRandom(77);
    const hand = drawMechanicHand(
      () => random.next(),
      mechState({ W01: 1, W02: 1 }),
    );
    const ids = hand.map((entry) => entry.id);

    expect(hand).toHaveLength(3);
    expect(ids).toContain('W03');
    expect(ids).toContain('W04');
    const filler = hand.find((entry) => entry.owner === 'general');
    expect(filler?.rarity).toBe('gold');
    expect(filler?.id).toMatch(/^G0[567]$/);
  });

  it('专属与金色通用都不足时用有效银卡补齐', () => {
    const random = new SeededRandom(123);
    const hand = drawMechanicHand(
      () => random.next(),
      mechState({ W01: 1, W02: 1, W03: 1, W04: 1, G05: 1, G06: 1, G07: 1 }),
    );

    expect(hand).toHaveLength(3);
    expect(hand.every((entry) => entry.rarity === 'silver')).toBe(true);
    expect(hand.every((entry) => entry.owner === 'general')).toBe(true);
  });

  it('排除旧手牌时优先出未拥有的新卡，且同手不重复', () => {
    const random = new SeededRandom(9);
    const first = drawMechanicHand(() => random.next(), mechState());
    const second = drawMechanicHand(
      () => random.next(),
      mechState(),
      { excludeIds: first.map((entry) => entry.id) },
    );

    expect(second).toHaveLength(3);
    expect(new Set(second.map((entry) => entry.id)).size).toBe(3);
    expect(second.some((entry) => first.some((old) => old.id === entry.id))).toBe(false);
  });
});

describe('焦点与确认', () => {
  const pool = ['S1', 'S2', 'S3', 'S4'].map((id) => card(id, 'general', 'silver', 3));

  it('焦点在 0..2 内移动，数字键越界忽略', () => {
    const run = new UpgradeRun({ characterId: 'vishdal', pool, seed: 3 });
    const choice = run.createChoice('upgrade');

    expect(choice.focusIndex).toBe(0);
    expect(choice.moveFocus(-1)).toBe(0);
    expect(choice.moveFocus(1)).toBe(1);
    expect(choice.focusTo(2)).toBe(2);
    expect(choice.focusTo(9)).toBe(2);
    expect(choice.moveFocus(5)).toBe(2);
  });

  it('Enter 只确认一次，确认后记录层数且不可重复确认', () => {
    const run = new UpgradeRun({ characterId: 'vishdal', pool, seed: 4 });
    const choice = run.createChoice('upgrade');
    choice.focusTo(1);
    const focused = choice.hand[1];

    const confirmed = choice.confirm();
    expect(confirmed?.id).toBe(focused?.id);
    expect(choice.confirmed?.id).toBe(focused?.id);
    expect(run.stacksOf(focused?.id ?? '')).toBe(1);
    expect(choice.confirm()).toBeNull();
    expect(run.stacksOf(focused?.id ?? '')).toBe(1);
  });

  it('重抽把焦点移回第一张并允许重新确认', () => {
    const run = new UpgradeRun({ characterId: 'vishdal', pool, seed: 6 });
    const choice = run.createChoice('upgrade');
    choice.focusTo(2);

    expect(choice.reroll()).toBe(true);
    expect(choice.focusIndex).toBe(0);
    expect(choice.confirm()).not.toBeNull();
  });

  it('UpgradeChoice 可独立注入回调，便于单测', () => {
    const acquired: string[] = [];
    let rerolls = 1;
    let draws = 0;
    const choice = new UpgradeChoice('upgrade', {
      draw: () => {
        draws += 1;
        return [card('S1', 'general', 'silver'), card('S2', 'general', 'gold')];
      },
      rerollsRemaining: () => rerolls,
      consumeReroll: () => {
        rerolls -= 1;
        return true;
      },
      acquire: (id) => acquired.push(id),
    });

    expect(draws).toBe(1);
    expect(choice.hand).toHaveLength(2);
    expect(choice.reroll()).toBe(true);
    expect(draws).toBe(3);
    expect(choice.confirm()?.id).toBe('S1');
    expect(acquired).toEqual(['S1']);
  });
});

describe('波末奖励队列顺序', () => {
  it('第 3 波：吸取经验 → 升级逐个选卡 → 机制三选一 → 波间', () => {
    const flow = new WaveRewardFlow(3);
    const run = new UpgradeRun({
      characterId: 'vishdal',
      pool: UPGRADE_LIST,
      seed: 20261019,
    });

    expect(flow.begin(0)).toBe('absorb');
    expect(flow.completeAbsorb(2)).toBe('briefing');
    expect(flow.completeBriefing()).toBe('upgrade');

    const first = run.createChoice('upgrade');
    expect(first.hand).toHaveLength(CARDS_PER_HAND);
    expect(first.confirm()).not.toBeNull();
    expect(flow.completeUpgrade()).toBe('upgrade');

    const second = run.createChoice('upgrade');
    expect(second.hand).toHaveLength(CARDS_PER_HAND);
    expect(second.confirm()).not.toBeNull();
    expect(flow.completeUpgrade()).toBe('mechanic');

    const mechanic = run.createChoice('mechanic');
    expect(mechanic.kind).toBe('mechanic');
    expect(mechanic.hand).toHaveLength(CARDS_PER_HAND);
    expect(mechanic.hand.every((entry) => entry.owner === 'vishdal')).toBe(true);
    expect(mechanic.confirm()).not.toBeNull();
    expect(flow.completeMechanic()).toBe('intermission');
    expect(flow.completeIntermission()).toBe('none');
  });
});
