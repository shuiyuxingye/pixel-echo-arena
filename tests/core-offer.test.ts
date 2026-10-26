import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CORE_OFFER_COUNT,
  GENERIC_CORE_IDS,
  compatibleCoreTags,
  describeCoreOffers,
  drawCoreOffers,
  formatCoreFallbackPrompt,
  formatCoreOfferCard,
  isEliteCoreId,
  listCoreCandidates,
  resolveCoreClaim,
  type CoreOfferDrawState,
} from '../src/game/core-offer';
import { CoreInventory } from '../src/game/core-inventory';
import {
  CHARACTER_LIST,
  getEliteCore,
  listEliteCores,
  listShopItems,
  type CharacterId,
} from '../src/game/data';
import { EliteCoreTracker, eligibleCoreIdsForWave } from '../src/game/elite';
import { SeededRandom } from '../src/game/random';
import { RewardQueue } from '../src/game/rewards';
import { WaveRewardFlow } from '../src/game/wave';

const SCENE_PATH = resolve(process.cwd(), 'src/game/scenes/ArenaScene.ts');

function stateFor(
  characterId: CharacterId,
  ownedCoreIds: readonly string[] = [],
  ownedItemTags: readonly string[] = [],
): CoreOfferDrawState {
  return { characterId, ownedCoreIds, ownedItemTags };
}

function draw(seed: number, state: CoreOfferDrawState) {
  const random = new SeededRandom(seed);
  return drawCoreOffers(() => random.next(), state);
}

describe('精英核心内容与来源', () => {
  it('E01–E08 全部存在，且不进入商店道具池', () => {
    expect(listEliteCores().map((core) => core.id)).toEqual([
      'E01',
      'E02',
      'E03',
      'E04',
      'E05',
      'E06',
      'E07',
      'E08',
    ]);
    const shopIds = new Set(listShopItems().map((item) => item.id));
    for (const core of listEliteCores()) {
      expect(getEliteCore(core.id)?.name).toBe(core.name);
      expect(shopIds.has(core.id)).toBe(false);
      expect(isEliteCoreId(core.id)).toBe(true);
    }
    expect(isEliteCoreId('I01')).toBe(false);
    expect(isEliteCoreId('core-6')).toBe(false);
  });
});

describe('精英核心三选一规则', () => {
  it('每名角色每手都是 3 张不重复候选，含通用生存/经济与匹配标签核心', () => {
    for (const character of CHARACTER_LIST) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const state = stateFor(character.id);
        const result = draw(seed, state);
        expect(result.coreIds).toHaveLength(CORE_OFFER_COUNT);
        expect(result.reason).toBe('three');
        expect(new Set(result.coreIds).size).toBe(CORE_OFFER_COUNT);

        const cores = result.coreIds.map((id) => getEliteCore(id)!);
        expect(cores.every((core) => core !== undefined)).toBe(true);
        expect(
          cores.some((core) => GENERIC_CORE_IDS.includes(core.id)),
          `${character.id} seed ${seed} 缺少通用核心`,
        ).toBe(true);
        const tags = compatibleCoreTags(state);
        expect(
          cores.some((core) => tags.has(core.tag)),
          `${character.id} seed ${seed} 缺少兼容标签核心`,
        ).toBe(true);
      }
    }
  });

  it('排除已拥有核心，并把已拥有道具/核心标签计入兼容条件', () => {
    const state = stateFor('amiya', ['E02'], ['爆破']);
    expect(listCoreCandidates(state).map((core) => core.id)).not.toContain('E02');

    const tags = compatibleCoreTags(state);
    expect(tags.has('奥术')).toBe(true);
    expect(tags.has('弹道')).toBe(true);
    expect(tags.has('技能')).toBe(true);
    expect(tags.has('爆破')).toBe(true);

    for (let seed = 1; seed <= 20; seed += 1) {
      const result = draw(seed, state);
      expect(result.coreIds).toHaveLength(3);
      expect(result.coreIds).not.toContain('E02');
      expect(new Set(result.coreIds).size).toBe(3);
    }
  });

  it('通用核心全部拥有时仍给 3 张不重复候选，优先保留兼容标签', () => {
    const state = stateFor('vishdal', ['E03', 'E05', 'E07']);
    for (let seed = 1; seed <= 20; seed += 1) {
      const result = draw(seed, state);
      expect(result.coreIds).toHaveLength(3);
      expect(result.coreIds.some((id) => GENERIC_CORE_IDS.includes(id))).toBe(false);
      expect(result.reason).toBe('three');
      const cores = result.coreIds.map((id) => getEliteCore(id)!);
      const tags = compatibleCoreTags(state);
      expect(cores.some((core) => tags.has(core.tag))).toBe(true);
    }
  });

  it('兼容标签耗尽时退化为剩余核心，候选不足 3 张返回实际数量', () => {
    // vishdal 的兼容核心 E01/E06/E08 与通用 E03/E05/E07 都已拥有，只剩 E02/E04。
    const state = stateFor('vishdal', ['E01', 'E03', 'E05', 'E06', 'E07', 'E08']);
    for (let seed = 1; seed <= 10; seed += 1) {
      const result = draw(seed, state);
      expect(result.coreIds.slice().sort()).toEqual(['E02', 'E04']);
      expect(result.reason).toBe('partial');
    }
  });

  it('全部核心都已拥有时返回空候选，不重复发放也不补金币', () => {
    const owned = listEliteCores().map((core) => core.id);
    const result = draw(7, stateFor('saria', owned));
    expect(result).toEqual({ coreIds: [], reason: 'no-valid-cores' });
    expect(formatCoreFallbackPrompt()).toContain('不补金币');
    expect(formatCoreFallbackPrompt()).not.toContain('金币 +');
  });

  it('同种子同状态得到同一手候选', () => {
    const state = stateFor('muelsyse', ['E04'], ['经济']);
    const first = draw(20261021, state);
    const second = draw(20261021, state);
    expect(second).toEqual(first);
  });

  it('大量种子下三张候选始终互不重复（回归：通用/兼容池副本未同步移除）', () => {
    for (const character of CHARACTER_LIST) {
      for (let seed = 1; seed <= 300; seed += 1) {
        const result = draw(seed, stateFor(character.id));
        expect(result.coreIds, `${character.id} seed ${seed}`).toHaveLength(
          CORE_OFFER_COUNT,
        );
        expect(
          new Set(result.coreIds).size,
          `${character.id} seed ${seed} → ${result.coreIds.join(',')}`,
        ).toBe(CORE_OFFER_COUNT);
      }
    }
  });
});

describe('核心卡面与领取解析', () => {
  it('确认前显示名称、标签与完整效果', () => {
    const [display] = describeCoreOffers(['E03']);
    expect(display).toBeDefined();
    const card = formatCoreOfferCard(display!, 0, true);
    expect(card).toContain('不屈圣印');
    expect(card).toContain('标签：防护');
    expect(card).toContain('每波首次生命归零改为 1 生命');
    expect(card).toContain('唯一');
    expect(card.startsWith('▶ [1]')).toBe(true);
  });

  it('未知核心 ID 不生成卡面，焦点越界返回 null', () => {
    expect(describeCoreOffers(['E99'])).toEqual([]);
    const entry = { coreOffers: ['E01', 'E03', 'E05'] };
    expect(resolveCoreClaim(entry, 0)).toBe('E01');
    expect(resolveCoreClaim(entry, 2)).toBe('E05');
    expect(resolveCoreClaim(entry, 3)).toBeNull();
    expect(resolveCoreClaim(entry, -1)).toBeNull();
    expect(resolveCoreClaim({}, 0)).toBeNull();
    expect(resolveCoreClaim({ coreOffers: ['E99'] }, 0)).toBeNull();
  });
});

describe('已拥有核心账本', () => {
  it('核心唯一：未知 ID 与重复获得都被拒绝', () => {
    const inventory = new CoreInventory();
    expect(inventory.acquire('E01')).toBe(true);
    expect(inventory.acquire('E01')).toBe(false);
    expect(inventory.acquire('I01')).toBe(false);
    expect(inventory.has('E01')).toBe(true);
    expect(inventory.size).toBe(1);
    expect(inventory.snapshot()).toEqual(['E01']);
  });

  it('恢复只接受已知核心并自动去重', () => {
    const inventory = new CoreInventory();
    inventory.restore(['E02', 'E02', 'E99', 'E05']);
    expect(inventory.snapshot()).toEqual(['E02', 'E05']);
    inventory.reset();
    expect(inventory.snapshot()).toEqual([]);
  });
});

describe('奖励队列中的核心候选', () => {
  it('候选随核心资格入队、深拷贝并可恢复', () => {
    const queue = new RewardQueue();
    const entry = queue.enqueue('core', 'core:core-6', 'core-6', {
      coreOffers: ['E03', 'E05', 'E08'],
    });
    expect(entry?.coreOffers).toEqual(['E03', 'E05', 'E08']);

    const snapshot = queue.snapshot();
    expect(snapshot[0]?.coreOffers).toEqual(['E03', 'E05', 'E08']);

    const restored = new RewardQueue();
    restored.restore(snapshot);
    expect(restored.current?.coreOffers).toEqual(['E03', 'E05', 'E08']);
    expect(restored.resolveCurrent('claimed')).toBe(true);
    expect(restored.current).toBeNull();
  });

  it('核心候选不能挂在别的奖励种类上', () => {
    const queue = new RewardQueue();
    expect(
      queue.enqueue('chest', 'chest:x', undefined, { coreOffers: ['E01'] }),
    ).toBeNull();
  });

  it('波末队列按固定顺序进入核心阶段并保留候选', () => {
    const flow = new WaveRewardFlow(6);
    flow.begin(0);
    flow.completeAbsorb(0, {
      coreIds: ['core-6'],
      coreOffers: new Map([['core-6', ['E01', 'E03', 'E05']]]),
    });
    expect(flow.stage).toBe('briefing');
    expect(flow.completeBriefing()).toBe('core');
    expect(flow.currentReward?.coreOffers).toEqual(['E01', 'E03', 'E05']);

    const entries = flow.rewardQueueSnapshot;
    const restored = new WaveRewardFlow(6);
    restored.restore('core', 0, entries);
    expect(restored.stage).toBe('core');
    expect(restored.currentReward?.coreOffers).toEqual(['E01', 'E03', 'E05']);
  });

  it('核心候选非法时退回无候选条目，不静默丢失整条资格', () => {
    const flow = new WaveRewardFlow(6);
    flow.begin(0);
    flow.completeAbsorb(0, {
      coreIds: ['core-6'],
      // 重复候选会被队列校验拒绝；资格本身必须保留。
      coreOffers: new Map([['core-6', ['E01', 'E01', 'E03']]]),
    });
    expect(flow.completeBriefing()).toBe('core');
    expect(flow.currentReward?.kind).toBe('core');
    expect(flow.currentReward?.coreOffers).toBeUndefined();
  });
});

describe('精英击败与超时资格', () => {
  it('6/9/12/15 波只有击败指定精英才产生核心资格', () => {
    const tracker = new EliteCoreTracker();
    for (const wave of [6, 9, 12, 15]) {
      // 超时清场不会调用登记入口，因此资格保持为空。
      expect(eligibleCoreIdsForWave(wave, tracker)).toEqual([]);
    }

    expect(tracker.registerEliteDefeat('elite-6')).toBe('core-6');
    expect(eligibleCoreIdsForWave(6, tracker)).toEqual(['core-6']);
    // 其他波次不能借用已击败的精英资格。
    expect(eligibleCoreIdsForWave(9, tracker)).toEqual([]);
    expect(eligibleCoreIdsForWave(5, tracker)).toEqual([]);

    tracker.registerEliteDefeat('elite-9');
    expect(eligibleCoreIdsForWave(9, tracker)).toEqual(['core-9']);
    expect(eligibleCoreIdsForWave(12, tracker)).toEqual([]);
  });

  it('场景只在击杀结算路径登记核心资格，超时清场不登记', () => {
    const scene = readFileSync(SCENE_PATH, 'utf8');
    // 唯一一次登记位于 result.died 分支；超时清场没有第二次调用点。
    expect(scene.match(/registerEliteDefeat/g)?.length ?? 0).toBe(1);
    expect(scene).toContain('eligibleCoreIdsForWave(this.waveNumber, this.eliteCore)');
  });
});
