import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getConsumable,
  getFreeSkill,
  getShopItem,
  listFreeSkills,
  listShopItems,
  type CharacterId,
} from '../src/game/data';
import { RunRandomStreams, SeededRandom } from '../src/game/random';
import { isItemUsableByCharacter } from '../src/game/item-requirements';
import {
  I22_WEIGHT_TRANSFER,
  P02_FIRST_SHOP_WAVE,
  SHOP_EMERGENCY_POTION_ID,
  SHOP_ITEM_SLOT_COUNT,
  SHOP_LAST_WAVE,
  SHOP_MAIN_SLOT_COUNT,
  SHOP_POTION_SLOT,
  SHOP_SKILL_SLOT,
  ShopShelf,
  applyI22WeightShift,
  drawShopShelf,
  formatShopShelfText,
  listShopItemCandidates,
  listShopPotionCandidates,
  shopPrice,
  shopRarityWeights,
  shopRerollCost,
  type ShopDrawState,
  type ShopOffer,
} from '../src/game/shop-offer';

const CHARACTERS: readonly CharacterId[] = [
  'vishdal',
  'amiya',
  'saria',
  'muelsyse',
];

function stateFor(
  characterId: CharacterId,
  shopWave: number,
  stacks: Readonly<Record<string, number>> = {},
): ShopDrawState {
  return {
    shopWave,
    characterId,
    stacksOf: (itemId) => stacks[itemId] ?? 0,
  };
}

/** 把所有永久道具补到满层，便于只留指定候选。 */
function fullStacks(): Record<string, number> {
  return Object.fromEntries(
    listShopItems().map((item) => [item.id, item.stackCap]),
  );
}

function offersOfKind(
  offers: readonly ShopOffer[],
  kind: ShopOffer['kind'],
): ShopOffer[] {
  return offers.filter((offer) => offer.kind === kind);
}

describe('商店品质权重', () => {
  it('按第 1–5 / 6–11 / 12–17 商店给出三档权重', () => {
    for (const shopWave of [1, 5]) {
      expect(shopRarityWeights(shopWave)).toEqual({ 普通: 80, 稀有: 20, 史诗: 0 });
    }
    for (const shopWave of [6, 11]) {
      expect(shopRarityWeights(shopWave)).toEqual({ 普通: 55, 稀有: 35, 史诗: 10 });
    }
    for (const shopWave of [12, 17]) {
      expect(shopRarityWeights(shopWave)).toEqual({ 普通: 35, 稀有: 45, 史诗: 20 });
    }
  });

  it('商店波数越界直接报错，不静默套用错误档位', () => {
    for (const shopWave of [0, 18, 1.5, Number.NaN]) {
      expect(() => shopRarityWeights(shopWave)).toThrow();
    }
    expect(SHOP_LAST_WAVE).toBe(17);
  });
});

describe('I22 权重转移', () => {
  it('未拥有 I22 时权重不变', () => {
    const weights = shopRarityWeights(7);
    expect(applyI22WeightShift(weights, 0)).toEqual(weights);
    expect(applyI22WeightShift(weights, -3)).toEqual(weights);
  });

  it('第 1–5 商店每层从普通转移 12 点，史诗保持 0', () => {
    expect(applyI22WeightShift(shopRarityWeights(1), 1)).toEqual({
      普通: 68,
      稀有: 32,
      史诗: 0,
    });
    expect(applyI22WeightShift(shopRarityWeights(1), 2)).toEqual({
      普通: 56,
      稀有: 44,
      史诗: 0,
    });
  });

  it('按当前稀有/史诗比例分配转移量', () => {
    const one = applyI22WeightShift(shopRarityWeights(7), 1);
    expect(one.普通).toBe(55 - I22_WEIGHT_TRANSFER);
    expect(one.稀有).toBeCloseTo(35 + (I22_WEIGHT_TRANSFER * 35) / 45, 10);
    expect(one.史诗).toBeCloseTo(10 + (I22_WEIGHT_TRANSFER * 10) / 45, 10);
    expect(one.普通 + one.稀有 + one.史诗).toBeCloseTo(100, 10);

    const late = applyI22WeightShift(shopRarityWeights(13), 1);
    expect(late.普通).toBe(23);
    expect(late.稀有).toBeCloseTo(45 + (I22_WEIGHT_TRANSFER * 45) / 65, 10);
    expect(late.史诗).toBeCloseTo(20 + (I22_WEIGHT_TRANSFER * 20) / 65, 10);
  });

  it('转移量不超过普通池剩余权重，不产生负权重', () => {
    const shifted = applyI22WeightShift({ 普通: 5, 稀有: 95, 史诗: 0 }, 2);
    expect(shifted.普通).toBe(0);
    expect(shifted.稀有).toBeCloseTo(100, 10);
    expect(shifted.史诗).toBe(0);
  });

  it('抽取时按 I22 层数取权重；未拥有 I22 不受影响', () => {
    const plainRandom = new SeededRandom(7);
    const without = drawShopShelf(
      () => plainRandom.next(),
      stateFor('vishdal', 7),
    );
    expect(without.weights).toEqual(shopRarityWeights(7));

    const i22Random = new SeededRandom(7);
    const withI22 = drawShopShelf(
      () => i22Random.next(),
      stateFor('vishdal', 7, { I22: 2 }),
    );
    expect(withI22.weights.普通).toBe(31);
    expect(withI22.weights.普通 + withI22.weights.稀有 + withI22.weights.史诗).toBeCloseTo(
      100,
      10,
    );
  });
});

describe('价格与重抽费用', () => {
  it('价格按 round(基础价 × (1 + 0.025 × (波数 − 1))) 计算', () => {
    expect(shopPrice(45, 1)).toBe(45);
    expect(shopPrice(45, 3)).toBe(47);
    expect(shopPrice(45, 7)).toBe(52);
    expect(shopPrice(45, 13)).toBe(59);
    expect(shopPrice(45, 17)).toBe(63);
    expect(shopPrice(18, 7)).toBe(21);
  });

  it('恰好落在 .5 金币时向上取整（浮点误差不得抹掉半金币）', () => {
    expect(shopPrice(50, 7)).toBe(58); // 50 × 1.15 = 57.5
    expect(shopPrice(60, 2)).toBe(62); // 60 × 1.025 = 61.5
    expect(shopPrice(90, 7)).toBe(104); // 90 × 1.15 = 103.5
    expect(shopPrice(50, 14)).toBe(66); // 50 × 1.325 = 66.25
    expect(shopPrice(20, 5)).toBe(22); // 20 × 1.1 = 22
  });

  it('拒绝非法基础价与波数', () => {
    expect(() => shopPrice(-1, 1)).toThrow();
    expect(() => shopPrice(Number.NaN, 1)).toThrow();
    expect(() => shopPrice(45, 18)).toThrow();
  });

  it('重抽费用按 6 + floor(波数/3) + 2×已重抽次数 计算', () => {
    expect(shopRerollCost(1, 0)).toBe(6);
    expect(shopRerollCost(3, 0)).toBe(7);
    expect(shopRerollCost(6, 0)).toBe(8);
    expect(shopRerollCost(7, 0)).toBe(8);
    expect(shopRerollCost(13, 0)).toBe(10);
    expect(shopRerollCost(17, 0)).toBe(11);
    expect(shopRerollCost(7, 1)).toBe(10);
    expect(shopRerollCost(7, 3)).toBe(14);
    expect(() => shopRerollCost(7, -1)).toThrow();
    expect(() => shopRerollCost(7, 1.5)).toThrow();
  });
});

describe('货架构成与职业可用性', () => {
  it('每手固定 3 道具 + 1 技能 + 1 药剂，道具不重复且未满层', () => {
    for (const characterId of CHARACTERS) {
      for (let seed = 1; seed <= 30; seed += 1) {
        const random = new SeededRandom(seed);
        const draw = drawShopShelf(() => random.next(), stateFor(characterId, 7));
        expect(draw.reason).toBe('full');
        expect(draw.offers).toHaveLength(SHOP_MAIN_SLOT_COUNT);
        expect(offersOfKind(draw.offers, 'item')).toHaveLength(SHOP_ITEM_SLOT_COUNT);
        expect(offersOfKind(draw.offers, 'skill')).toHaveLength(1);
        expect(offersOfKind(draw.offers, 'potion')).toHaveLength(1);
        expect(draw.offers.map((offer) => offer.slot)).toEqual([
          0, 1, 2, SHOP_SKILL_SLOT, SHOP_POTION_SLOT,
        ]);

        const itemIds = offersOfKind(draw.offers, 'item').map((offer) => offer.id);
        expect(new Set(itemIds).size).toBe(itemIds.length);
        for (const itemId of itemIds) {
          expect(isItemUsableByCharacter(itemId, characterId), itemId).toBe(true);
          const item = getShopItem(itemId);
          expect(item).toBeDefined();
          expect(0).toBeLessThan(item?.stackCap ?? 0);
        }

        const skill = offersOfKind(draw.offers, 'skill')[0];
        expect(listFreeSkills().some((entry) => entry.id === skill?.id)).toBe(true);
        const potion = offersOfKind(draw.offers, 'potion')[0];
        expect(potion?.id).not.toBe(SHOP_EMERGENCY_POTION_ID);
      }
    }
  });

  it('不向当前职业提供完全无法利用的正收益道具', () => {
    const forbidden: Readonly<Record<CharacterId, readonly string[]>> = {
      // 骑士没有弹体、爆炸与召唤物；I16 可配合任意角色购买的自由技能。
      saria: ['I04', 'I13', 'I14', 'I19', 'I20', 'I24'],
      // 术士有弹体，没有爆炸与召唤物。
      amiya: ['I13', 'I19', 'I20', 'I24'],
      // 战术家有弹体与召唤物，没有爆炸。
      muelsyse: ['I13', 'I24'],
      // 爆破手有弹体与爆炸，没有召唤物。
      vishdal: ['I19', 'I20'],
    };

    for (const characterId of CHARACTERS) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const random = new SeededRandom(seed);
        const draw = drawShopShelf(() => random.next(), stateFor(characterId, 7));
        for (const offer of offersOfKind(draw.offers, 'item')) {
          expect(forbidden[characterId], `${characterId} 不应获得 ${offer.id}`).not.toContain(
            offer.id,
          );
        }
      }
    }
  });

  it('依赖特定能力的道具在卡面写清前置', () => {
    const prerequisites: Record<string, string> = {
      I04: '需要弹体攻击',
      I13: '需要爆炸技能',
      I14: '需要弹体攻击',
      I19: '需要召唤物',
      I24: '需要爆炸技能',
    };
    for (let seed = 1; seed <= 120; seed += 1) {
      const random = new SeededRandom(seed);
      const draw = drawShopShelf(() => random.next(), stateFor('vishdal', 13));
      for (const offer of offersOfKind(draw.offers, 'item')) {
        if (prerequisites[offer.id]) {
          expect(offer.prerequisite).toBe(prerequisites[offer.id]);
        } else {
          expect(offer.prerequisite).toBeNull();
        }
      }
    }
  });

  it('全部商品价格使用同一波次系数，P01 常驻且不占格', () => {
    const random = new SeededRandom(20261021);
    const draw = drawShopShelf(() => random.next(), stateFor('vishdal', 13));
    for (const offer of draw.offers) {
      const base =
        offer.kind === 'item'
          ? getShopItem(offer.id)?.basePrice
          : offer.kind === 'skill'
            ? getFreeSkill(offer.id)?.basePrice
            : getConsumable(offer.id)?.basePrice;
      expect(offer.price).toBe(shopPrice(base ?? 0, 13));
    }
    expect(draw.offers.some((offer) => offer.id === SHOP_EMERGENCY_POTION_ID)).toBe(
      false,
    );
    const p01 = getConsumable(SHOP_EMERGENCY_POTION_ID);
    expect(draw.emergencyPotion).toEqual({
      id: SHOP_EMERGENCY_POTION_ID,
      name: p01?.name,
      price: shopPrice(p01?.basePrice ?? 0, 13),
      repeatable: true,
      limit: p01?.limit,
    });
  });

  it('P02 只从第 7 波商店起进入轮换池，P01 永不进入', () => {
    expect(listShopPotionCandidates(6).some((entry) => entry.id === 'P02')).toBe(false);
    expect(listShopPotionCandidates(P02_FIRST_SHOP_WAVE).some((entry) => entry.id === 'P02')).toBe(
      true,
    );
    for (const shopWave of [1, 7, 17]) {
      const ids = listShopPotionCandidates(shopWave).map((entry) => entry.id);
      expect(ids).not.toContain(SHOP_EMERGENCY_POTION_ID);
      for (const id of ['P03', 'P04', 'P05', 'P06', 'P07', 'P08']) {
        expect(ids).toContain(id);
      }
    }
  });
});

describe('空池重归一化与满层排除', () => {
  it('已满层道具不进入候选', () => {
    const stacks = fullStacks();
    stacks.I01 = 0;
    stacks.I02 = 0;
    const candidates = listShopItemCandidates(stateFor('vishdal', 1, stacks));
    expect(candidates.map((item) => item.id).sort()).toEqual(['I01', 'I02']);
  });

  it('道具只剩两件时给两格并标记 partial-items，技能与药剂仍保留', () => {
    const stacks = fullStacks();
    stacks.I01 = 0;
    stacks.I02 = 0;
    const random = new SeededRandom(5);
    const draw = drawShopShelf(() => random.next(), stateFor('vishdal', 1, stacks));
    expect(draw.reason).toBe('partial-items');
    expect(offersOfKind(draw.offers, 'item').map((offer) => offer.id).sort()).toEqual([
      'I01',
      'I02',
    ]);
    expect(offersOfKind(draw.offers, 'skill')).toHaveLength(1);
    expect(offersOfKind(draw.offers, 'potion')).toHaveLength(1);
  });

  it('所有道具满层时只发技能与药剂，标记 no-items', () => {
    const stacks = fullStacks();
    const random = new SeededRandom(5);
    const draw = drawShopShelf(() => random.next(), stateFor('vishdal', 1, stacks));
    expect(draw.reason).toBe('no-items');
    expect(offersOfKind(draw.offers, 'item')).toHaveLength(0);
    expect(draw.offers.map((offer) => offer.slot)).toEqual([
      SHOP_SKILL_SLOT,
      SHOP_POTION_SLOT,
    ]);
    expect(draw.offers).toHaveLength(2);
  });

  it('0 权重品质的候选耗尽后，从剩余品质的权重重新归一', () => {
    // 只留稀有候选：第 1–5 商店的史诗权重为 0，普通池为空，
    // 重归一后应全抽稀有，而不是按原始 80/20/0 静默缺格。
    const stacks = fullStacks();
    for (const item of listShopItems()) {
      if (item.rarity === '稀有' && isItemUsableByCharacter(item.id, 'vishdal')) {
        stacks[item.id] = 0;
      }
    }
    const random = new SeededRandom(11);
    const draw = drawShopShelf(() => random.next(), stateFor('vishdal', 1, stacks));
    expect(draw.reason).toBe('full');
    expect(offersOfKind(draw.offers, 'item').map((offer) => offer.rarity)).toEqual([
      '稀有',
      '稀有',
      '稀有',
    ]);
  });

  it('只剩 0 权重史诗候选时退化为等概率，保证仍有商品', () => {
    const stacks = fullStacks();
    for (const item of listShopItems()) {
      if (item.rarity === '史诗' && isItemUsableByCharacter(item.id, 'vishdal')) {
        stacks[item.id] = 0;
      }
    }
    const random = new SeededRandom(11);
    const draw = drawShopShelf(() => random.next(), stateFor('vishdal', 1, stacks));
    expect(draw.reason).toBe('full');
    const rarities = offersOfKind(draw.offers, 'item').map((offer) => offer.rarity);
    expect(rarities).toEqual(['史诗', '史诗', '史诗']);
  });

  it('I22 提升稀有/史诗占比', () => {
    const countRarities = (
      i22Stacks: number,
    ): { rare: number; epic: number; total: number } => {
      const random = new SeededRandom(20261021);
      let rare = 0;
      let epic = 0;
      let total = 0;
      for (let draw = 0; draw < 300; draw += 1) {
        for (const offer of offersOfKind(
          drawShopShelf(
            () => random.next(),
            stateFor('vishdal', 7, { I22: i22Stacks }),
          ).offers,
          'item',
        )) {
          total += 1;
          if (offer.rarity === '稀有') rare += 1;
          if (offer.rarity === '史诗') epic += 1;
        }
      }
      return { rare, epic, total };
    };

    const without = countRarities(0);
    const withI22 = countRarities(2);
    expect(withI22.rare / withI22.total).toBeGreaterThan(
      without.rare / without.total + 0.1,
    );
    expect(withI22.epic).toBeGreaterThan(0);
  });
});

describe('随机流与确定性', () => {
  it('同种子同消费顺序得到同一手货架', () => {
    const drawOnce = (): ShopOffer[] => {
      const random = new SeededRandom(20261021);
      return [...drawShopShelf(() => random.next(), stateFor('amiya', 7)).offers];
    };
    expect(drawOnce()).toEqual(drawOnce());
  });

  it('货架只消费 reward 流；抽战斗流不改变货架', () => {
    const untouched = new RunRandomStreams(20261021);
    const untouchedDraw = drawShopShelf(
      () => untouched.reward.next(),
      stateFor('amiya', 7),
    );

    const combatDrawn = new RunRandomStreams(20261021);
    const rewardBefore = combatDrawn.reward.snapshotState;
    for (let index = 0; index < 50; index += 1) combatDrawn.combat.next();
    expect(combatDrawn.reward.snapshotState).toBe(rewardBefore);
    const combatDraw = drawShopShelf(
      () => combatDrawn.reward.next(),
      stateFor('amiya', 7),
    );
    expect(combatDraw.offers).toEqual(untouchedDraw.offers);

    const rewarded = new RunRandomStreams(20261021);
    const before = rewarded.reward.snapshotState;
    drawShopShelf(() => rewarded.reward.next(), stateFor('amiya', 7));
    expect(rewarded.reward.snapshotState).not.toBe(before);
  });

  it('商店规则不自行创建随机源', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../src/game/shop-offer.ts'),
      'utf8',
    );
    expect(source).not.toContain('SeededRandom');
    expect(source).not.toContain('Math.random');
  });
});

describe('售出与重抽', () => {
  it('售出只标记该格，不自动补货；P01 不受影响', () => {
    const random = new SeededRandom(3);
    const shelf = new ShopShelf(() => random.next(), stateFor('vishdal', 7));
    const before = shelf.offers;
    const target = before[0];
    expect(target).toBeDefined();
    expect(shelf.markSold(0)).toBe(true);
    expect(shelf.offers[0]?.id).toBe(target?.id);
    expect(shelf.offers[0]?.sold).toBe(true);
    expect(shelf.offers.slice(1)).toEqual(before.slice(1));
    expect(shelf.emergencyPotion.id).toBe(SHOP_EMERGENCY_POTION_ID);
    expect(shelf.emergencyPotion.price).toBe(shopPrice(18, 7));

    // 再次标记同一格失败，也没有补货入口。
    expect(shelf.markSold(0)).toBe(false);
    expect(shelf.offers[0]?.sold).toBe(true);
    expect(shelf.offers[0]?.id).toBe(target?.id);
    expect(shelf.markSold(99)).toBe(false);
  });

  it('重抽换货、清除售出状态并递增次数与费用；P01 价格不变', () => {
    const random = new SeededRandom(9);
    const shelf = new ShopShelf(() => random.next(), stateFor('vishdal', 7));
    const p01Price = shelf.emergencyPotion.price;
    const baseCost = shelf.rerollCost;
    const soldId = shelf.offers[0]?.id;
    shelf.markSold(0);
    const beforeReroll = shelf.offers.map((offer) => offer.id);

    shelf.reroll();
    expect(shelf.rerollCount).toBe(1);
    expect(shelf.rerollCost).toBe(baseCost + 2);
    expect(shelf.offers.every((offer) => offer.sold === false)).toBe(true);
    expect(shelf.offers).toHaveLength(SHOP_MAIN_SLOT_COUNT);
    expect(shelf.emergencyPotion.price).toBe(p01Price);
    // 重抽至少换掉一部分商品；同一随机序列不应把手牌原样退回。
    expect(shelf.offers.map((offer) => offer.id)).not.toEqual(beforeReroll);
    expect(soldId).toBeDefined();

    shelf.reroll();
    expect(shelf.rerollCount).toBe(2);
    expect(shelf.rerollCost).toBe(baseCost + 4);
  });

  it('进入下一商店时重抽次数清零', () => {
    const random = new SeededRandom(4);
    const first = new ShopShelf(() => random.next(), stateFor('vishdal', 7));
    first.reroll();
    expect(first.rerollCount).toBe(1);
    const next = new ShopShelf(() => random.next(), stateFor('vishdal', 8));
    expect(next.rerollCount).toBe(0);
    expect(next.rerollCost).toBe(shopRerollCost(8, 0));
  });
});

describe('开发货架文本', () => {
  it('列出五格、权重、P01 与重抽费用，并说明无倒计时', () => {
    const random = new SeededRandom(8);
    const shelf = new ShopShelf(() => random.next(), stateFor('vishdal', 13));
    const text = formatShopShelfText(shelf);
    expect(text).toContain('第 13 波后');
    expect(text).toContain('品质权重 普通/稀有/史诗：35/45/20');
    expect(text).toContain('商店无倒计时');
    expect(text).toContain('P01 应急药剂');
    expect(text).toContain(`重抽 ${shopRerollCost(13, 0)} 金币`);
    for (const offer of shelf.offers) {
      expect(text).toContain(`[${offer.slot}] ${offer.id}`);
    }
  });
});

describe('商店道具卡面实时预览', () => {
  it('抽货时写入聚合预览，并在层数变化后 refresh 重算', () => {
    const stacks: Record<string, number> = {};
    const state: ShopDrawState = {
      shopWave: 1,
      characterId: 'vishdal',
      stacksOf: (itemId) => stacks[itemId] ?? 0,
      itemPreview: (itemId, count) => ({
        benefit: `${itemId} 当前 ${count} → ${count + 1}`,
        cost: `${itemId} 代价 ${count}`,
        detail: `${itemId} 当前 ${count} → ${count + 1}；代价 ${count}`,
        previewed: true,
      }),
    };
    const random = new SeededRandom(4);
    const shelf = new ShopShelf(() => random.next(), state);
    const before = shelf.offers.filter((offer) => offer.kind === 'item');
    expect(before.length).toBeGreaterThan(0);
    for (const offer of before) {
      expect(offer.previewed).toBe(true);
      expect(offer.description).toBe(`${offer.id} 当前 0 → 1`);
    }

    const first = before[0] as ShopOffer;
    stacks[first.id] = 1;
    shelf.refreshItemPreviews();
    const refreshed = shelf.offers.find((offer) => offer.slot === first.slot);
    expect(refreshed?.stacks).toBe(1);
    expect(refreshed?.nextStacks).toBe(2);
    expect(refreshed?.description).toBe(`${first.id} 当前 1 → 2`);
    expect(refreshed?.netChange).toContain(`代价 1`);
  });

  it('开发货架文本包含当前的卡面正负值', () => {
    const state: ShopDrawState = {
      shopWave: 1,
      characterId: 'vishdal',
      stacksOf: () => 0,
      itemPreview: () => ({
        benefit: '最大生命 120 → 145',
        cost: '移速 160 → 155.2',
        detail: '最大生命 120 → 145；移速 160 → 155.2',
        previewed: true,
      }),
    };
    const random = new SeededRandom(8);
    const shelf = new ShopShelf(() => random.next(), state);
    const text = formatShopShelfText(shelf);
    expect(text).toContain('增益（当前 → 购买后）：最大生命 120 → 145');
    expect(text).toContain('代价（当前 → 购买后）：移速 160 → 155.2');
  });
});

describe('药剂价格与轮换覆盖', () => {
  it('H23 的药剂加价只作用于药剂，并按百分点合并一次', () => {
    const baseState = stateFor('vishdal', 1);
    const withH23: ShopDrawState = {
      ...baseState,
      potionOverride: 'P08',
      potionPriceModifiers: { surchargePercent: 15 },
    };
    const plain = drawShopShelf(() => 0.25, baseState);
    const boosted = drawShopShelf(() => 0.25, withH23);

    expect(boosted.offers.find((offer) => offer.kind === 'potion')?.price).toBe(
      28,
    );
    // 药剂价格 = round(24 × 1.15) = 28；不是 24 × 1.15 × 1.15 = 32。
    expect(boosted.emergencyPotion.price).toBe(21);

    const itemPrices = (offers: readonly ShopOffer[]) =>
      offers
        .filter((offer) => offer.kind === 'item')
        .map((offer) => `${offer.slot}:${offer.price}`);
    expect(itemPrices(boosted.offers)).toEqual(itemPrices(plain.offers));
    expect(boosted.offers.find((offer) => offer.kind === 'skill')?.price).toBe(
      plain.offers.find((offer) => offer.kind === 'skill')?.price,
    );
  });

  it('通用折扣与药剂加价先合并再取整，仍只套用一次', () => {
    const state: ShopDrawState = {
      ...stateFor('vishdal', 1),
      potionOverride: 'P08',
      priceModifiers: { discountPercent: 10 },
      potionPriceModifiers: { surchargePercent: 15 },
    };
    const drawn = drawShopShelf(() => 0.5, state);
    // 净加价 5%：24 × 1.05 = 25.2 → 25。
    expect(drawn.offers.find((offer) => offer.kind === 'potion')?.price).toBe(
      25,
    );
  });

  it('开发 shopPotion 覆盖轮换药剂，P01/未开放 P02 回退随机', () => {
    const forced = drawShopShelf(() => 0.1, {
      ...stateFor('vishdal', 1),
      potionOverride: 'P03',
    });
    expect(forced.offers.find((offer) => offer.kind === 'potion')?.id).toBe(
      'P03',
    );

    const p01 = drawShopShelf(() => 0.1, {
      ...stateFor('vishdal', 1),
      potionOverride: 'P01',
    });
    expect(p01.offers.find((offer) => offer.kind === 'potion')?.id).not.toBe(
      'P01',
    );

    const earlyP02 = drawShopShelf(() => 0.1, {
      ...stateFor('vishdal', 1),
      potionOverride: 'P02',
    });
    expect(earlyP02.offers.find((offer) => offer.kind === 'potion')?.id).not.toBe(
      'P02',
    );

    const lateP02 = drawShopShelf(() => 0.1, {
      ...stateFor('vishdal', P02_FIRST_SHOP_WAVE),
      potionOverride: 'P02',
    });
    expect(lateP02.offers.find((offer) => offer.kind === 'potion')?.id).toBe(
      'P02',
    );
  });
});
