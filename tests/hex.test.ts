import { describe, expect, it } from 'vitest';
import {
  HEX_LIST,
  type CharacterId,
  type HexDefinition,
  type HexOwner,
  type HexRarity,
} from '../src/game/data';
import {
  EMPTY_HEX_POOL_PROMPT,
  HEX_CARDS_PER_HAND,
  HEX_MAX_STACKS,
  HEX_OWNER_BY_CHARACTER,
  HEX_PREREQUISITES,
  HEX_RARITY_ORDER,
  HEX_RARITY_WEIGHTS,
  HexRun,
  drawHexHand,
  hexOwnerForCharacter,
  isHexAvailable,
  listAvailableHexes,
  meetsHexPrerequisite,
  type HexPoolState,
} from '../src/game/hex';
import { RunRandomStreams } from '../src/game/random';
import {
  HEX_LEVELS,
  ProgressionSystem,
  isHexLevel,
  levelUpThreshold,
} from '../src/game/progression';

function hex(
  id: string,
  owner: HexOwner,
  rarity: HexRarity,
  effect = `${id} 的测试效果`,
): HexDefinition {
  return { id, name: `海克斯${id}`, rarity, effect, owner };
}

function poolState(
  characterId: CharacterId = 'amiya',
  options: {
    readonly owned?: readonly string[];
    readonly freeSkills?: readonly string[];
  } = {},
): HexPoolState {
  return {
    characterId,
    ownedHexIds: new Set(options.owned ?? []),
    freeSkillIds: [...(options.freeSkills ?? [])],
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

describe('海克斯目录与职业池', () => {
  it('H01–H48 全部进入目录，通用 24 + 四职业各 6', () => {
    expect(HEX_LIST).toHaveLength(48);
    expect(HEX_LIST.map((entry) => entry.id)).toEqual(
      Array.from({ length: 48 }, (_, index) => `H${String(index + 1).padStart(2, '0')}`),
    );

    const counts = new Map<HexOwner, number>();
    for (const entry of HEX_LIST) {
      counts.set(entry.owner, (counts.get(entry.owner) ?? 0) + 1);
    }
    expect(counts.get('通用')).toBe(24);
    expect(counts.get('爆破手')).toBe(6);
    expect(counts.get('术士')).toBe(6);
    expect(counts.get('骑士')).toBe(6);
    expect(counts.get('战术家')).toBe(6);
  });

  it('品质与归属取自内容目录，权重固定为银/金/棱彩 45/40/15', () => {
    expect(HEX_RARITY_ORDER).toEqual(['银', '金', '棱彩']);
    expect(HEX_RARITY_WEIGHTS).toEqual({ 银: 45, 金: 40, 棱彩: 15 });
    for (const entry of HEX_LIST) {
      expect(HEX_RARITY_ORDER).toContain(entry.rarity);
      expect(['通用', '爆破手', '术士', '骑士', '战术家']).toContain(entry.owner);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.effect.length).toBeGreaterThan(0);
    }
    expect(HEX_MAX_STACKS).toBe(1);
  });

  it('四名角色映射到正确职业归属', () => {
    expect(HEX_OWNER_BY_CHARACTER).toEqual({
      vishdal: '爆破手',
      amiya: '术士',
      saria: '骑士',
      muelsyse: '战术家',
    });
    expect(hexOwnerForCharacter('vishdal')).toBe('爆破手');
    expect(hexOwnerForCharacter('muelsyse')).toBe('战术家');
  });

  it('只出通用或当前职业专属，其他职业专属不进池', () => {
    for (const entry of HEX_LIST) {
      const vishdal = poolState('vishdal');
      const amiya = poolState('amiya');
      if (entry.owner === '通用') {
        // 通用牌不受职业限制，只受各自前置约束。
        expect(isHexAvailable(entry, vishdal)).toBe(
          meetsHexPrerequisite(entry.id, vishdal),
        );
        expect(isHexAvailable(entry, amiya)).toBe(
          meetsHexPrerequisite(entry.id, amiya),
        );
      } else if (entry.owner === '爆破手') {
        expect(isHexAvailable(entry, vishdal)).toBe(true);
        expect(isHexAvailable(entry, amiya)).toBe(false);
      } else if (entry.owner === '术士') {
        expect(isHexAvailable(entry, amiya)).toBe(true);
        expect(isHexAvailable(entry, vishdal)).toBe(false);
      } else if (entry.owner === '骑士') {
        expect(isHexAvailable(entry, poolState('saria'))).toBe(true);
        expect(isHexAvailable(entry, amiya)).toBe(false);
      } else {
        expect(isHexAvailable(entry, poolState('muelsyse'))).toBe(true);
        expect(isHexAvailable(entry, amiya)).toBe(false);
      }
    }
  });
});

describe('海克斯前置条件', () => {
  it('H01 需要至少一个自由技能，H08/H16 需要两个槽位', () => {
    expect(meetsHexPrerequisite('H01', poolState('amiya'))).toBe(false);
    expect(meetsHexPrerequisite('H01', poolState('amiya', { freeSkills: ['S01'] }))).toBe(true);
    expect(meetsHexPrerequisite('H08', poolState('amiya', { freeSkills: ['S01'] }))).toBe(false);
    expect(
      meetsHexPrerequisite('H08', poolState('amiya', { freeSkills: ['S01', 'S02'] })),
    ).toBe(true);
    expect(meetsHexPrerequisite('H16', poolState('amiya', { freeSkills: ['S03'] }))).toBe(false);
    expect(
      meetsHexPrerequisite('H16', poolState('amiya', { freeSkills: ['S03', 'S06'] })),
    ).toBe(true);
  });

  it('H07 需要召唤来源：职业本体或 S05/S09', () => {
    expect(meetsHexPrerequisite('H07', poolState('amiya'))).toBe(false);
    expect(meetsHexPrerequisite('H07', poolState('saria'))).toBe(false);
    expect(meetsHexPrerequisite('H07', poolState('amiya', { freeSkills: ['S05'] }))).toBe(true);
    expect(meetsHexPrerequisite('H07', poolState('saria', { freeSkills: ['S09'] }))).toBe(true);
    expect(meetsHexPrerequisite('H07', poolState('vishdal'))).toBe(true);
    expect(meetsHexPrerequisite('H07', poolState('muelsyse'))).toBe(true);
  });

  it('H14/H15 需要弹道 J，骑士盾击不适用', () => {
    expect(meetsHexPrerequisite('H14', poolState('saria'))).toBe(false);
    expect(meetsHexPrerequisite('H15', poolState('saria'))).toBe(false);
    expect(meetsHexPrerequisite('H14', poolState('amiya'))).toBe(true);
    expect(meetsHexPrerequisite('H15', poolState('vishdal'))).toBe(true);
  });

  it('前置不满足的牌不进入候选，满足后重新进入', () => {
    const withoutSkills = listAvailableHexes(poolState('amiya')).map((entry) => entry.id);
    const withSkills = listAvailableHexes(
      poolState('amiya', { freeSkills: ['S01', 'S02'] }),
    ).map((entry) => entry.id);
    expect(withoutSkills).not.toContain('H01');
    expect(withoutSkills).not.toContain('H08');
    expect(withSkills).toContain('H01');
    expect(withSkills).toContain('H08');
    expect(withSkills).toContain('H16');
  });

  it('前置表只声明确实有依赖的 ID，其余只受职业与唯一层约束', () => {
    for (const id of Object.keys(HEX_PREREQUISITES)) {
      expect(HEX_LIST.some((entry) => entry.id === id)).toBe(true);
    }
    expect(HEX_PREREQUISITES).toEqual({
      H01: { minFreeSkills: 1 },
      H07: { requiresSummonSource: true },
      H08: { minFreeSkills: 2 },
      H14: { requiresProjectileAttack: true },
      H15: { requiresProjectileAttack: true },
      H16: { minFreeSkills: 2 },
    });
  });
});

describe('海克斯抽取', () => {
  it('同种子抽三张互不重复且都可用', () => {
    const first = new HexRun({ characterId: 'amiya', seed: 20261021 });
    const second = new HexRun({ characterId: 'amiya', seed: 20261021 });
    const left = first.createChoice().hand.map((entry) => entry.id);
    const right = second.createChoice().hand.map((entry) => entry.id);
    expect(left).toHaveLength(HEX_CARDS_PER_HAND);
    expect(left).toEqual(right);
    expect(new Set(left).size).toBe(left.length);

    const available = new Set(
      listAvailableHexes(poolState('amiya')).map((entry) => entry.id),
    );
    for (const id of left) {
      expect(available.has(id)).toBe(true);
    }
  });

  it('已获得的海克斯不再进池，同手仍不重复', () => {
    const owned = ['H03', 'H04'];
    const hand = drawHexHand(
      sequenceRandom([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]),
      poolState('amiya', { owned }),
    );
    for (const entry of hand) {
      expect(owned).not.toContain(entry.id);
    }
    expect(new Set(hand.map((entry) => entry.id)).size).toBe(hand.length);

    const tinyPool = [hex('X1', '通用', '银')];
    const tiny = drawHexHand(sequenceRandom([0, 0, 0, 0]), poolState(), {}, tinyPool);
    expect(tiny.map((entry) => entry.id)).toEqual(['X1']);
  });

  it('空品质按剩余权重重归一化：银全空时 0.5 落在金而非棱彩', () => {
    const pool = [
      hex('G1', '通用', '金'),
      hex('P1', '通用', '棱彩'),
    ];
    const gold = drawHexHand(
      sequenceRandom([0.5, 0]),
      poolState(),
      { count: 1 },
      pool,
    );
    expect(gold.map((entry) => entry.id)).toEqual(['G1']);

    const prismatic = drawHexHand(
      sequenceRandom([0.8, 0]),
      poolState(),
      { count: 1 },
      pool,
    );
    expect(prismatic.map((entry) => entry.id)).toEqual(['P1']);
  });

  it('空池返回空手牌并给出明确兜底提示', () => {
    const allOwned = HEX_LIST.filter(
      (entry) => entry.owner === '通用' || entry.owner === '术士',
    ).map((entry) => entry.id);
    const hand = drawHexHand(
      sequenceRandom([0, 0]),
      poolState('amiya', { owned: allOwned }),
    );
    expect(hand).toEqual([]);
    expect(EMPTY_HEX_POOL_PROMPT).toContain('没有可选海克斯');
    expect(EMPTY_HEX_POOL_PROMPT).toContain('Enter');

    const run = new HexRun({ characterId: 'amiya', seed: 1 });
    for (const id of allOwned) run.acquire(id);
    const choice = run.createChoice();
    expect(choice.hand).toEqual([]);
    expect(choice.focusIndex).toBe(0);
    expect(choice.confirm()).toBeNull();
  });
});

describe('海克斯唯一层数与随机流', () => {
  it('每种最高 1 层，重复获得被拒绝', () => {
    const run = new HexRun({ characterId: 'amiya', seed: 3 });
    expect(run.acquire('H03')).toBe(true);
    expect(run.has('H03')).toBe(true);
    expect(run.acquire('H03')).toBe(false);
    expect(run.ownedIds).toEqual(['H03']);
    expect(run.ownedCount).toBe(1);

    const choice = run.createChoice({ hand: ['H03', 'H04'] });
    expect(choice.hand.map((entry) => entry.id)).not.toContain('H03');
    expect(choice.hand).toHaveLength(HEX_CARDS_PER_HAND);
  });

  it('48 个 ID 获得后都从池中移除，不会出现第二层', () => {
    for (const entry of HEX_LIST) {
      const characterId: CharacterId =
        entry.owner === '通用' || entry.owner === '术士'
          ? 'amiya'
          : entry.owner === '爆破手'
            ? 'vishdal'
            : entry.owner === '骑士'
              ? 'saria'
              : 'muelsyse';
      const state = poolState(characterId, {
        owned: [entry.id],
        freeSkills: ['S01', 'S02', 'S05'],
      });
      expect(isHexAvailable(entry, state)).toBe(false);

      const run = new HexRun({ characterId, seed: 11 });
      expect(run.acquire(entry.id)).toBe(true);
      expect(run.acquire(entry.id)).toBe(false);
      expect(run.ownedCount).toBe(1);
    }
  });

  it('其他职业专属不能通过 acquire 写入', () => {
    const run = new HexRun({ characterId: 'amiya', seed: 3 });
    expect(run.acquire('H25')).toBe(false);
    expect(run.acquire('H31')).toBe(true);
    expect(run.acquire('H43')).toBe(false);
    expect(run.acquire('H01')).toBe(true);
  });

  it('只消费注入的单一随机源，不触碰战斗流', () => {
    const streams = new RunRandomStreams(20261021);
    const combatBefore = streams.combat.snapshotState;
    const rewardBefore = streams.reward.snapshotState;
    const run = new HexRun({
      characterId: 'amiya',
      random: streams.reward,
      freeSkillIds: () => ['S01', 'S02'],
    });
    run.createChoice();
    expect(streams.combat.snapshotState).toBe(combatBefore);
    expect(streams.reward.snapshotState).not.toBe(rewardBefore);
  });

  it('恢复固定手牌不重抽：手牌、焦点与随机状态都不变', () => {
    const streams = new RunRandomStreams(77);
    const run = new HexRun({
      characterId: 'amiya',
      random: streams.reward,
      freeSkillIds: () => ['S01', 'S02'],
    });
    const choice = run.createChoice();
    const ids = choice.hand.map((entry) => entry.id);
    const savedState = run.randomState;
    expect(ids).toHaveLength(3);

    // 模拟刷新后已写入快照的状态：先让随机流走过一段，再恢复到保存点。
    streams.reward.next();
    const restored = new HexRun({
      characterId: 'amiya',
      random: streams.reward,
      freeSkillIds: () => ['S01', 'S02'],
    });
    restored.restore({ hexes: [], randomState: savedState });
    const restoredChoice = restored.createChoice({ hand: ids, focusIndex: 2 });
    expect(restoredChoice.hand.map((entry) => entry.id)).toEqual(ids);
    expect(restoredChoice.focusIndex).toBe(2);
    expect(restored.randomState).toBe(savedState);
  });

  it('确认写入唯一层数且不消费随机数；再次确认无效', () => {
    const run = new HexRun({ characterId: 'amiya', seed: 5 });
    const choice = run.createChoice();
    const first = choice.hand[0];
    expect(first).toBeDefined();
    const before = run.randomState;
    const picked = choice.confirm();
    expect(picked?.id).toBe(first?.id);
    expect(run.has(picked?.id ?? '')).toBe(true);
    expect(run.randomState).toBe(before);
    expect(choice.confirm()).toBeNull();
    expect(run.ownedCount).toBe(1);
  });

  it('快照恢复忽略未知/重复/其他职业的 ID', () => {
    const run = new HexRun({ characterId: 'amiya', seed: 9 });
    run.restore({
      hexes: ['H03', 'H03', 'H99', 'H25', 'H31'],
    });
    expect(run.ownedIds).toEqual(['H03', 'H31']);
  });
});

describe('等级节点', () => {
  it('2/4/6/8/10/12/14 各一次，每局共 7 次，其他升级只给基础成长', () => {
    expect(HEX_LEVELS).toEqual([2, 4, 6, 8, 10, 12, 14]);
    const progression = new ProgressionSystem();
    let hexChoices = 0;

    for (let level = 1; level < 15; level += 1) {
      const gain = progression.addExperience(levelUpThreshold(level));
      expect(gain.level).toBe(level + 1);
      expect(gain.hexChoices).toBe(isHexLevel(level + 1) ? 1 : 0);
      hexChoices += gain.hexChoices;
    }

    expect(hexChoices).toBe(7);
    expect(progression.level).toBe(15);
    expect(progression.pendingLevelUps).toBe(7);
    expect(progression.maxHealthBonus).toBe(14 * 5);
  });
});
