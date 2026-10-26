import { describe, expect, it } from 'vitest';
import {
  CHEST_FALLBACK_GOLD,
  chestOfferRarityWeights,
  describeChestOffers,
  drawChestOffers,
  formatChestFallbackPrompt,
  formatChestOfferCard,
  isItemUsableByCharacter,
  listChestCandidates,
  resolveChestClaim,
  type ChestOfferDrawState,
} from '../src/game/chest-offer';
import { getShopItem, listShopItems } from '../src/game/data';
import { previewItemCard, type ItemPreviewInput } from '../src/game/item-effects';
import { ItemInventory } from '../src/game/item-inventory';
import { SeededRandom } from '../src/game/random';
import { RewardQueue } from '../src/game/rewards';
import { WaveRewardFlow } from '../src/game/wave';

function stateFor(
  characterId: ChestOfferDrawState['characterId'],
  stacks: Readonly<Record<string, number>> = {},
): ChestOfferDrawState {
  return { characterId, stacksOf: (itemId) => stacks[itemId] ?? 0 };
}

/** 把所有道具补到满层，便于只留指定候选。 */
function fullStacks(): Record<string, number> {
  return Object.fromEntries(
    listShopItems().map((item) => [item.id, item.stackCap]),
  );
}

describe('宝箱品质权重', () => {
  it('按 2/5、8/11、14/17 三档给出普通/稀有/史诗权重', () => {
    for (const wave of [2, 5]) {
      expect(chestOfferRarityWeights(wave)).toEqual({ 普通: 70, 稀有: 30, 史诗: 0 });
    }
    for (const wave of [8, 11]) {
      expect(chestOfferRarityWeights(wave)).toEqual({ 普通: 0, 稀有: 80, 史诗: 20 });
    }
    for (const wave of [14, 17]) {
      expect(chestOfferRarityWeights(wave)).toEqual({ 普通: 0, 稀有: 50, 史诗: 50 });
    }
  });

  it('非宝箱波拒绝抽取，不静默套用错误档位', () => {
    for (const wave of [1, 3, 6, 9, 12, 15, 18]) {
      expect(() => chestOfferRarityWeights(wave)).toThrow();
      expect(() =>
        drawChestOffers(() => 0.5, wave, stateFor('vishdal')),
      ).toThrow();
    }
  });

  it('实际抽取的首件品质接近该波权重', () => {
    const random = new SeededRandom(20261021);
    const countRarities = (wave: number, draws: number): Record<string, number> => {
      const randomSource = () => random.next();
      const counts: Record<string, number> = { 普通: 0, 稀有: 0, 史诗: 0 };
      for (let index = 0; index < draws; index += 1) {
        const draw = drawChestOffers(randomSource, wave, stateFor('vishdal'));
        const first = draw.itemIds[0];
        const rarity = first ? getShopItem(first)?.rarity : undefined;
        if (rarity) counts[rarity] = (counts[rarity] ?? 0) + 1;
      }
      return counts;
    };

    const early = countRarities(2, 3000);
    expect((early['普通'] ?? 0) / 3000).toBeGreaterThan(0.66);
    expect((early['普通'] ?? 0) / 3000).toBeLessThan(0.74);
    expect((early['稀有'] ?? 0) / 3000).toBeGreaterThan(0.26);
    expect((early['史诗'] ?? 0) / 3000).toBeLessThan(0.04);

    const late = countRarities(14, 3000);
    expect((late['稀有'] ?? 0) / 3000).toBeGreaterThan(0.45);
    expect((late['稀有'] ?? 0) / 3000).toBeLessThan(0.55);
    expect((late['史诗'] ?? 0) / 3000).toBeGreaterThan(0.45);
    expect((late['普通'] ?? 0) / 3000).toBeLessThan(0.02);
  });
});

describe('宝箱候选过滤', () => {
  it('排除当前职业完全无法利用的道具', () => {
    // 爆炸类只有爆破手具备爆炸。
    expect(isItemUsableByCharacter('I13', 'vishdal')).toBe(true);
    expect(isItemUsableByCharacter('I24', 'vishdal')).toBe(true);
    for (const character of ['amiya', 'saria', 'muelsyse'] as const) {
      expect(isItemUsableByCharacter('I13', character)).toBe(false);
      expect(isItemUsableByCharacter('I24', character)).toBe(false);
    }
    // 召唤物收益只有战术家的流形是伤害型召唤物。
    expect(isItemUsableByCharacter('I19', 'muelsyse')).toBe(true);
    expect(isItemUsableByCharacter('I20', 'muelsyse')).toBe(true);
    for (const character of ['vishdal', 'amiya', 'saria'] as const) {
      expect(isItemUsableByCharacter('I19', character)).toBe(false);
      expect(isItemUsableByCharacter('I20', character)).toBe(false);
    }
    // 弹体直径与额外弹对近战盾击无效。
    expect(isItemUsableByCharacter('I04', 'saria')).toBe(false);
    expect(isItemUsableByCharacter('I14', 'saria')).toBe(false);
    expect(isItemUsableByCharacter('I04', 'amiya')).toBe(true);
    // I16 的持续伤害可由任意角色购买 S01/S04/S08 获得，因此不再按职业排除。
    for (const character of ['vishdal', 'amiya', 'saria', 'muelsyse'] as const) {
      expect(isItemUsableByCharacter('I16', character)).toBe(true);
    }
    // 通用生存/经济道具对所有职业可用。
    for (const character of ['vishdal', 'amiya', 'saria', 'muelsyse'] as const) {
      expect(isItemUsableByCharacter('I01', character)).toBe(true);
      expect(isItemUsableByCharacter('I22', character)).toBe(true);
    }
    expect(isItemUsableByCharacter('I99', 'vishdal')).toBe(false);
  });

  it('已满层的道具不进入候选', () => {
    const stacks = fullStacks();
    stacks['I01'] = 2;
    stacks['I02'] = 0;
    stacks['I03'] = 1;
    const candidates = listChestCandidates(stateFor('saria', stacks));
    expect(candidates.map((item) => item.id).sort()).toEqual(['I01', 'I02', 'I03']);
  });
});

describe('宝箱二选一抽取', () => {
  it('给出两件不同且当前可用的道具', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = new SeededRandom(seed);
      const draw = drawChestOffers(
        () => random.next(),
        8,
        stateFor('vishdal'),
      );
      expect(draw.reason).toBe('two');
      expect(draw.fallbackGold).toBe(0);
      expect(draw.itemIds).toHaveLength(2);
      expect(new Set(draw.itemIds).size).toBe(2);
      for (const itemId of draw.itemIds) {
        const item = getShopItem(itemId);
        expect(item).toBeDefined();
        expect(isItemUsableByCharacter(itemId, 'vishdal')).toBe(true);
      }
    }
  });

  it('同种子同消费顺序结果固定，不随刷新改变', () => {
    const drawOnce = (seed: number) => {
      const random = new SeededRandom(seed);
      return drawChestOffers(() => random.next(), 11, stateFor('amiya'));
    };
    expect(drawOnce(77)).toEqual(drawOnce(77));
  });

  it('可选不足两种时只给 1 件有效道具', () => {
    const stacks = fullStacks();
    stacks['I01'] = 0;
    const draw = drawChestOffers(
      () => 0.5,
      2,
      stateFor('saria', stacks),
    );
    expect(draw.reason).toBe('single');
    expect(draw.itemIds).toEqual(['I01']);
    expect(draw.fallbackGold).toBe(0);
  });

  it('完全无有效道具时转为 50 金币', () => {
    for (const character of ['vishdal', 'amiya', 'saria', 'muelsyse'] as const) {
      const draw = drawChestOffers(
        () => 0.3,
        17,
        stateFor(character, fullStacks()),
      );
      expect(draw).toEqual({
        itemIds: [],
        fallbackGold: CHEST_FALLBACK_GOLD,
        reason: 'no-valid-items',
      });
    }
  });

  it('权重档位耗尽时退化为剩余品质等概率，而不是错误转金币', () => {
    // 第 2 波普通/稀有都补齐，只剩史诗：仍应给出有效道具。
    const stacks = fullStacks();
    for (const item of listShopItems()) {
      if (item.rarity !== '史诗') continue;
      stacks[item.id] = 0;
    }
    const draw = drawChestOffers(() => 0.9, 2, stateFor('vishdal', stacks));
    expect(draw.reason).toBe('two');
    expect(draw.itemIds).toHaveLength(2);
    for (const itemId of draw.itemIds) {
      expect(getShopItem(itemId)?.rarity).toBe('史诗');
    }
  });
});

describe('宝箱领取与放弃', () => {
  it('按焦点返回选中的道具，越界不误领', () => {
    expect(resolveChestClaim({ offers: ['I01', 'I02'] }, 1)).toEqual({
      itemId: 'I02',
      gold: 0,
    });
    expect(resolveChestClaim({ offers: ['I01'] }, 2)).toBeNull();
    expect(resolveChestClaim({ offers: ['I01'] }, -1)).toBeNull();
  });

  it('没有候选时返回兜底金币', () => {
    expect(resolveChestClaim({ offers: [] })).toEqual({
      itemId: null,
      gold: 50,
    });
    expect(resolveChestClaim({ fallbackGold: 50 })).toEqual({
      itemId: null,
      gold: 50,
    });
  });

  it('候选与兜底金币写入奖励队列并可完整恢复', () => {
    const random = new SeededRandom(7);
    const draw = drawChestOffers(() => random.next(), 2, stateFor('vishdal'));
    const flow = new WaveRewardFlow(2);
    flow.begin(0);
    flow.completeAbsorb(0, {
      chestIds: ['w2-1'],
      chestOffers: new Map([['w2-1', draw]]),
    });
    expect(flow.completeBriefing()).toBe('chest');
    expect(flow.currentReward?.offers).toEqual(draw.itemIds);

    const snapshot = flow.rewardQueueSnapshot;
    const restored = new WaveRewardFlow(2);
    restored.restore('chest', 0, snapshot);
    expect(restored.currentReward?.offers).toEqual(draw.itemIds);
    expect(restored.resolveCurrent('claimed')).toBe('intermission');
    expect(restored.rewardQueueSnapshot[0]?.status).toBe('claimed');

    const fallbackFlow = new WaveRewardFlow(2);
    fallbackFlow.begin(0);
    fallbackFlow.completeAbsorb(0, {
      chestIds: ['w2-2'],
      chestOffers: new Map([
        [
          'w2-2',
          {
            itemIds: [],
            fallbackGold: CHEST_FALLBACK_GOLD,
            reason: 'no-valid-items' as const,
          },
        ],
      ]),
    });
    expect(fallbackFlow.completeBriefing()).toBe('chest');
    expect(fallbackFlow.currentReward?.offers).toEqual([]);
    expect(fallbackFlow.currentReward?.fallbackGold).toBe(50);
  });

  it('放弃后状态落盘，恢复不会重新出现', () => {
    const flow = new WaveRewardFlow(5);
    flow.begin(0);
    flow.completeAbsorb(0, {
      chestIds: ['w5-1'],
      chestOffers: new Map([
        [
          'w5-1',
          {
            itemIds: ['I01', 'I02'],
            fallbackGold: 0,
            reason: 'two' as const,
          },
        ],
      ]),
    });
    expect(flow.completeBriefing()).toBe('chest');
    expect(flow.resolveCurrent('abandoned')).toBe('intermission');
    expect(flow.rewardQueueSnapshot[0]?.status).toBe('abandoned');

    const restored = new WaveRewardFlow(5);
    restored.restore('intermission', 0, flow.rewardQueueSnapshot);
    expect(restored.currentReward).toBeNull();
    expect(restored.rewardQueueSnapshot[0]?.status).toBe('abandoned');
  });
});

describe('宝箱卡面与兜底文案', () => {
  it('展示收益、代价、层数与净变化', () => {
    const [offer] = describeChestOffers(['I01'], () => 1);
    expect(offer).toBeDefined();
    if (!offer) return;
    expect(offer.name).toBe('红铜心');
    expect(offer.benefit).toBe('最大生命 +25');
    expect(offer.cost).toBe('移动速度 -3%');
    expect(offer.stacks).toBe(1);
    expect(offer.nextStacks).toBe(2);
    expect(offer.stackCap).toBe(3);
    expect(offer.netChange).toContain('最大生命 +25');
    expect(offer.netChange).toContain('移动速度 -3%');

    const card = formatChestOfferCard(offer, 0, true);
    expect(card).toContain('▶ [1] 红铜心');
    expect(card).toContain('收益：最大生命 +25');
    expect(card).toContain('代价：移动速度 -3%');
    expect(card).toContain('层数：1/3 → 2/3');
    expect(card).toContain('本层净变化：最大生命 +25；移动速度 -3%');
  });

  it('传入实时预览时卡面显示聚合后的当前值 → 购买后值', () => {
    const input: ItemPreviewInput = {
      maxHealth: 120,
      armor: 10,
      moveSpeed: 160,
      moveSpeedMultiplier: 1,
      attackSpeedMultiplier: 1,
      damageMultiplier: 1,
      skillDamageMultiplier: 1,
      normalAttackDamageMultiplier: 1,
      cooldownReduction: 0,
      attackRange: 290,
      attackRangeMultiplier: 1,
      projectileDiameter: 18,
      projectileRadiusMultiplier: 1,
      healPerFiveSeconds: 0,
      lifesteal: 0,
      lifestealCapPerSecond: 0,
      stationaryDamageBonus: 0,
    };
    const [offer] = describeChestOffers(
      ['I01'],
      () => 1,
      (itemId, stacks) => previewItemCard(itemId, stacks, input),
    );
    expect(offer).toBeDefined();
    if (!offer) return;
    expect(offer.previewed).toBe(true);
    expect(offer.benefit).toBe('最大生命 120 → 145');
    expect(offer.cost).toBe('移速 160 → 155.2');
    expect(offer.netChange).toBe('最大生命 120 → 145；移速 160 → 155.2');

    const card = formatChestOfferCard(offer, 0, true);
    expect(card).toContain('增益（当前 → 购买后）：最大生命 120 → 145');
    expect(card).toContain('代价（当前 → 购买后）：移速 160 → 155.2');
  });

  it('未知道具 ID 被忽略，兜底文案说明道具已满', () => {
    expect(describeChestOffers(['I99'], () => 0)).toEqual([]);
    const text = formatChestFallbackPrompt(50);
    expect(text).toContain('道具已满');
    expect(text).toContain('50 金币');
  });
});

describe('道具层数账本', () => {
  it('获得层数受叠层上限约束', () => {
    const inventory = new ItemInventory();
    expect(inventory.stacksOf('I14')).toBe(0);
    expect(inventory.acquire('I14')).toBe(true);
    expect(inventory.stacksOf('I14')).toBe(1);
    expect(inventory.acquire('I14')).toBe(false);
    expect(inventory.isFull('I14')).toBe(true);

    for (let index = 0; index < 3; index += 1) {
      expect(inventory.acquire('I01')).toBe(true);
    }
    expect(inventory.acquire('I01')).toBe(false);
    expect(inventory.acquire('I99')).toBe(false);
  });

  it('快照与恢复保留层数并拒绝越界数据', () => {
    const inventory = new ItemInventory();
    inventory.acquire('I01');
    inventory.acquire('I01');
    inventory.acquire('I14');
    const snapshot = inventory.snapshot();

    const restored = new ItemInventory();
    restored.restore(snapshot);
    expect(restored.stacksOf('I01')).toBe(2);
    expect(restored.stacksOf('I14')).toBe(1);

    restored.restore([
      { id: 'I01', stacks: 4 },
      { id: 'I99', stacks: 1 },
      { id: 'I02', stacks: 0 },
      { id: 'I03', stacks: 2 },
      { id: 'I03', stacks: 3 },
    ]);
    expect(restored.stacksOf('I01')).toBe(0);
    expect(restored.stacksOf('I99')).toBe(0);
    expect(restored.stacksOf('I02')).toBe(0);
    expect(restored.stacksOf('I03')).toBe(2);
  });
});

describe('奖励条目的候选字段校验', () => {
  it('拒绝重复、超量与非法兜底金币', () => {
    const queue = new RewardQueue();
    expect(
      queue.enqueue('chest', 'chest:x', 'x', { offers: ['I01', 'I01'] }),
    ).toBeNull();
    expect(
      queue.enqueue('chest', 'chest:x', 'x', {
        offers: ['I01', 'I02', 'I03'],
      }),
    ).toBeNull();
    expect(
      queue.enqueue('chest', 'chest:x', 'x', { fallbackGold: -1 }),
    ).toBeNull();
    expect(queue.current).toBeNull();
  });

  it('恢复时丢弃非法候选但不影响其他条目', () => {
    const queue = new RewardQueue();
    queue.restore([
      {
        id: 'chest:bad',
        kind: 'chest',
        status: 'pending',
        offers: ['I01', 'I01'],
      },
      {
        id: 'chest:good',
        kind: 'chest',
        status: 'pending',
        offers: ['I01', 'I02'],
      },
    ]);
    expect(queue.entries.map((entry) => entry.id)).toEqual(['chest:good']);
    expect(queue.current?.offers).toEqual(['I01', 'I02']);
  });
});
