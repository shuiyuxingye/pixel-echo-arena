import { describe, expect, it } from 'vitest';
import {
  getRecipe,
  getShopItem,
  listRecipes,
  type CharacterId,
} from '../src/game/data';
import { EconomyLedger } from '../src/game/economy';
import { ItemInventory } from '../src/game/item-inventory';
import { SeededRandom } from '../src/game/random';
import {
  MATERIAL_SUPPLY_INTERVAL_SHOPS,
  MAX_TRACKED_RECIPES,
  RecipeTracker,
  listTrackableRecipes,
  recipeTrackable,
  trackedRecipeStatus,
  type RecipeTrackingContext,
} from '../src/game/recipe-tracking';
import {
  ShopShelf,
  buildShopMaterialSupply,
  formatShopShelfText,
  resolveShopPrice,
  shopPrice,
  type ShopDrawState,
  type ShopMaterialSupply,
} from '../src/game/shop-offer';
import {
  ItemPaymentLedger,
  ShopSession,
} from '../src/game/shop-transaction';

const WAVE = 7;

function context(
  characterId: CharacterId = 'vishdal',
  stacks: Readonly<Record<string, number>> = {},
  crafted: readonly string[] = [],
): RecipeTrackingContext {
  return {
    characterId,
    stacksOf: (itemId) => stacks[itemId] ?? 0,
    hasCrafted: (recipeId) => crafted.includes(recipeId),
  };
}

function drawState(
  stacks: Readonly<Record<string, number>> = {},
  characterId: CharacterId = 'vishdal',
  shopWave = WAVE,
): ShopDrawState {
  return {
    shopWave,
    characterId,
    stacksOf: (itemId) => stacks[itemId] ?? 0,
  };
}

function supplyFor(
  recipeId: string,
  ingredientId: string,
  stacks: Readonly<Record<string, number>> = {},
): ShopMaterialSupply {
  const supply = buildShopMaterialSupply(drawState(stacks), {
    recipeId,
    ingredientId,
  });
  if (!supply) throw new Error('expected a material supply');
  return supply;
}

describe('配方可追踪性', () => {
  it('只追踪当前职业可用的配方', () => {
    const idsFor = (characterId: CharacterId) =>
      listTrackableRecipes(context(characterId)).map((recipe) => recipe.id);

    // R02 需要爆炸材料 I13/I24；I16 已改为全职业可用（持续伤害来自自由技能），
    // 因此爆破手可以追踪 R02。R05 需要召唤物。
    expect(idsFor('vishdal')).toEqual(['R01', 'R02', 'R03', 'R04', 'R06']);
    expect(idsFor('amiya')).toEqual(['R01', 'R03', 'R04', 'R06']);
    // 骑士只有盾击，没有弹体/爆炸/召唤物。
    expect(idsFor('saria')).toEqual(['R01', 'R04', 'R06']);
    // 战术家具备弹体与召唤物两套能力。
    expect(idsFor('muelsyse')).toEqual(['R01', 'R03', 'R04', 'R05', 'R06']);
    for (const recipe of listRecipes()) {
      expect(getRecipe(recipe.id)).toBeDefined();
    }
    expect(idsFor('amiya')).not.toContain('R02');
  });

  it('已拥有的配方不可再追踪', () => {
    expect(recipeTrackable('R01', context('vishdal', {}, ['R01']))).toBe(false);
    const tracker = new RecipeTracker();
    expect(tracker.track('R01', context('vishdal', {}, ['R01']))).toBe(false);
    expect(tracker.trackedRecipeId).toBeNull();
  });

  it('未知/非法配方 ID 不改变原追踪', () => {
    const tracker = new RecipeTracker();
    expect(tracker.track('R99', context())).toBe(false);
    expect(tracker.track('I01', context())).toBe(false);
    expect(tracker.trackedRecipeId).toBeNull();
    expect(tracker.track('R01', context())).toBe(true);
    expect(tracker.track('R99', context())).toBe(false);
    expect(tracker.trackedRecipeId).toBe('R01');
  });

  it('同时只保留 1 条追踪，换配方清零保底计数', () => {
    expect(MAX_TRACKED_RECIPES).toBe(1);
    const tracker = new RecipeTracker();
    // 两条配方各有 1 件材料：R01 缺 I06/I18，R03 缺 I14/I21。
    const ctx = context('vishdal', { I01: 1, I03: 1 });
    expect(tracker.track('R01', ctx)).toBe(true);
    tracker.beginShop(ctx, WAVE);
    expect(tracker.shopsSinceSupply).toBe(1);
    expect(tracker.track('R03', ctx)).toBe(true);
    expect(tracker.trackedRecipeId).toBe('R03');
    expect(tracker.shopsSinceSupply).toBe(0);
    // 同一配方重复调用不清零。
    tracker.beginShop(ctx, WAVE);
    expect(tracker.track('R03', ctx)).toBe(true);
    expect(tracker.shopsSinceSupply).toBe(1);
  });

  it('材料进度按 ID 层数判定缺失', () => {
    const status = trackedRecipeStatus('R01', context('vishdal', { I01: 2 }));
    expect(status).not.toBeNull();
    expect(status?.ownedIngredients).toBe(1);
    expect(status?.missing).toEqual(['I06', 'I18']);
    expect(status?.ingredients.map((entry) => entry.stacks)).toEqual([2, 0, 0]);
    expect(status?.ingredients[0]?.name).toBe(getShopItem('I01')?.name);
  });
});

describe('缺件供给保底', () => {
  it('已有至少 1 种材料时，每 3 个商店至少提供一次', () => {
    expect(MATERIAL_SUPPLY_INTERVAL_SHOPS).toBe(3);
    const tracker = new RecipeTracker();
    const stacks = { I01: 1 };
    const ctx = context('vishdal', stacks);
    tracker.track('R01', ctx);

    expect(tracker.beginShop(ctx, WAVE)).toBeNull();
    expect(tracker.shopsSinceSupply).toBe(1);
    expect(tracker.beginShop(ctx, WAVE)).toBeNull();
    expect(tracker.shopsSinceSupply).toBe(2);
    const decision = tracker.beginShop(ctx, WAVE);
    expect(decision).toEqual({
      recipeId: 'R01',
      ingredientId: 'I06',
      missing: ['I06', 'I18'],
      ownedIngredients: 1,
    });
    expect(tracker.shopsSinceSupply).toBe(0);

    // 下一个周期同样是 3 个商店：第 4、5 个商店不供给，第 6 个再供给。
    expect(tracker.beginShop(ctx, WAVE)).toBeNull();
    expect(tracker.beginShop(ctx, WAVE)).toBeNull();
    expect(tracker.beginShop(ctx, WAVE)?.ingredientId).toBe('I06');
  });

  it('没有任何材料时不推进保底，也不会凭空供给', () => {
    const tracker = new RecipeTracker();
    const empty = context('vishdal', {});
    tracker.track('R01', empty);
    for (let shop = 0; shop < 5; shop += 1) {
      expect(tracker.beginShop(empty, WAVE)).toBeNull();
      expect(tracker.shopsSinceSupply).toBe(0);
    }

    // 拿到第一种材料后重新开始计算：第 3 个符合条件的商店才供给。
    const stocked = context('vishdal', { I01: 1 });
    expect(tracker.beginShop(stocked, WAVE)).toBeNull();
    expect(tracker.beginShop(stocked, WAVE)).toBeNull();
    expect(tracker.beginShop(stocked, WAVE)?.ingredientId).toBe('I06');
  });

  it('缺件品质未开放时不供给也不推进计数', () => {
    // R03 缺 I14/I21，二者都是史诗；第 1–5 商店史诗权重为 0。
    const tracker = new RecipeTracker();
    const ctx = context('vishdal', { I03: 1 });
    tracker.track('R03', ctx);
    for (let shop = 1; shop <= 5; shop += 1) {
      expect(tracker.beginShop(ctx, shop)).toBeNull();
      expect(tracker.shopsSinceSupply).toBe(0);
    }
    // 第 6 商店起史诗开放，重新累计 3 个符合条件的商店。
    expect(tracker.beginShop(ctx, 6)).toBeNull();
    expect(tracker.beginShop(ctx, 7)).toBeNull();
    expect(tracker.beginShop(ctx, 8)?.ingredientId).toBe('I14');
  });

  it('材料已齐时不供给且不推进计数', () => {
    const tracker = new RecipeTracker();
    const ctx = context('vishdal', { I01: 1, I06: 1, I18: 1 });
    tracker.track('R01', ctx);
    for (let shop = 0; shop < 4; shop += 1) {
      expect(tracker.beginShop(ctx, WAVE)).toBeNull();
      expect(tracker.shopsSinceSupply).toBe(0);
    }
  });

  it('缺件按配方顺序选择，且跨周期仍指向未补齐的同一件', () => {
    const tracker = new RecipeTracker();
    const ctx = context('vishdal', { I01: 1 });
    tracker.track('R01', ctx);
    tracker.beginShop(ctx, WAVE);
    tracker.beginShop(ctx, WAVE);
    expect(tracker.beginShop(ctx, WAVE)?.ingredientId).toBe('I06');

    const middle = context('vishdal', { I01: 1, I06: 1 });
    tracker.beginShop(middle, WAVE);
    tracker.beginShop(middle, WAVE);
    expect(tracker.beginShop(middle, WAVE)?.ingredientId).toBe('I18');
  });

  it('已拥有的配方在下一次进入商店时自动清除追踪', () => {
    const tracker = new RecipeTracker();
    tracker.track('R01', context('vishdal', { I01: 1 }));
    const decision = tracker.beginShop(context('vishdal', { I01: 1 }, ['R01']), WAVE);
    expect(decision).toBeNull();
    expect(tracker.trackedRecipeId).toBeNull();
  });

  it('合成完成后只清除对应配方的追踪', () => {
    const tracker = new RecipeTracker();
    tracker.track('R01', context());
    expect(tracker.noteCrafted('R04')).toBe(false);
    expect(tracker.trackedRecipeId).toBe('R01');
    expect(tracker.noteCrafted('R01')).toBe(true);
    expect(tracker.trackedRecipeId).toBeNull();
    expect(tracker.shopsSinceSupply).toBe(0);
  });
});

describe('追踪快照', () => {
  it('快照与恢复保留配方和保底计数', () => {
    const tracker = new RecipeTracker();
    const ctx = context('vishdal', { I01: 1 });
    tracker.track('R01', ctx);
    tracker.beginShop(ctx, WAVE);
    const snapshot = tracker.snapshot();
    expect(snapshot).toEqual({ recipeId: 'R01', shopsSinceSupply: 1 });

    const restored = new RecipeTracker();
    restored.restore(snapshot, ctx);
    expect(restored.trackedRecipeId).toBe('R01');
    expect(restored.shopsSinceSupply).toBe(1);
    expect(restored.beginShop(ctx, WAVE)).toBeNull();
    expect(restored.shopsSinceSupply).toBe(2);
  });

  it('非法/不适用快照被安全忽略', () => {
    const restored = new RecipeTracker();
    restored.restore({ recipeId: 'R99', shopsSinceSupply: 1 }, context());
    expect(restored.trackedRecipeId).toBeNull();

    // 职业不可用（骑士追踪 R05）时丢弃，而不是恢复成非法追踪。
    restored.restore({ recipeId: 'R05', shopsSinceSupply: 1 }, context('saria'));
    expect(restored.trackedRecipeId).toBeNull();

    // 已拥有成品时同样不恢复。
    restored.restore(
      { recipeId: 'R01', shopsSinceSupply: 1 },
      context('vishdal', {}, ['R01']),
    );
    expect(restored.trackedRecipeId).toBeNull();

    // 越界计数归零，配方本身仍恢复。
    restored.restore(
      { recipeId: 'R01', shopsSinceSupply: 9 },
      context('vishdal'),
    );
    expect(restored.trackedRecipeId).toBe('R01');
    expect(restored.shopsSinceSupply).toBe(0);

    restored.restore(null, context());
    expect(restored.trackedRecipeId).toBeNull();
  });
});

describe('缺件供给定价与货架接线', () => {
  it('按正常波次价格收费，不赠送', () => {
    const item = getShopItem('I06');
    expect(item).toBeDefined();
    const supply = supplyFor('R01', 'I06', { I01: 1 });
    expect(supply.price).toBe(shopPrice(item?.basePrice ?? 0, WAVE));
    expect(supply.price).toBeGreaterThan(0);
    expect(supply.stacks).toBe(0);
    expect(supply.sold).toBe(false);
    expect(supply.recipeId).toBe('R01');
  });

  it('沿用商店折扣/加价规则，与同款货架道具一致', () => {
    const item = getShopItem('I06');
    const base = shopPrice(item?.basePrice ?? 0, WAVE);
    const state: ShopDrawState = {
      ...drawState({ I01: 1 }),
      priceModifiers: { discountPercent: 20 },
    };
    const supply = buildShopMaterialSupply(state, {
      recipeId: 'R01',
      ingredientId: 'I06',
    });
    const expected = resolveShopPrice({
      basePrice: item?.basePrice ?? 0,
      shopWave: WAVE,
      modifiers: { discountPercent: 20 },
    }).price;
    expect(supply?.price).toBe(expected);
    expect(expected).toBeLessThan(base);
  });

  it('满层/目录缺失时不提供缺件', () => {
    const cap = getShopItem('I01')?.stackCap ?? 1;
    expect(
      buildShopMaterialSupply(drawState({ I01: cap }), {
        recipeId: 'R01',
        ingredientId: 'I01',
      }),
    ).toBeNull();
    expect(
      buildShopMaterialSupply(drawState(), {
        recipeId: 'R01',
        ingredientId: 'I99',
      }),
    ).toBeNull();
  });

  it('缺件不占五格且与五格去重，重抽后仍保留', () => {
    const random = new SeededRandom(20261023);
    const state = drawState({ I01: 1 });
    const supply = supplyFor('R01', 'I06', { I01: 1 });
    const shelf = new ShopShelf(() => random.next(), state, null, supply);
    expect(shelf.materialSupply?.id).toBe('I06');
    expect(shelf.offers.length).toBeLessThanOrEqual(5);
    expect(shelf.offers.some((offer) => offer.id === 'I06')).toBe(false);
    // P01 仍在独立按钮上，缺件没有占用它。
    expect(shelf.emergencyPotion.id).toBe('P01');

    shelf.reroll();
    expect(shelf.materialSupply?.id).toBe('I06');
    expect(shelf.offers.some((offer) => offer.id === 'I06')).toBe(false);
    expect(
      shelf.offers.filter((offer) => offer.kind === 'item').length,
    ).toBeLessThanOrEqual(3);
  });

  it('已购买的缺件不会再次购买，文本标记已购买', () => {
    const random = new SeededRandom(20261024);
    const shelf = new ShopShelf(
      () => random.next(),
      drawState({ I01: 1 }),
      null,
      supplyFor('R01', 'I06', { I01: 1 }),
    );
    expect(shelf.markMaterialSupplySold()).toBe(true);
    expect(shelf.markMaterialSupplySold()).toBe(false);
    expect(shelf.materialSupply?.sold).toBe(true);
    expect(formatShopShelfText(shelf)).toContain('配方缺件 I06');
    expect(formatShopShelfText(shelf)).toContain('已购买');
  });
});

describe('缺件购买事务', () => {
  function makeSession(
    options: {
      readonly gold?: number;
      readonly stacks?: Readonly<Record<string, number>>;
      readonly supply?: ShopMaterialSupply | null;
      readonly deliverMaterialSupply?: (itemId: string) => boolean;
    } = {},
  ) {
    const random = new SeededRandom(20261025);
    const stacks = options.stacks ?? { I01: 1 };
    const state = drawState(stacks);
    const shelf = new ShopShelf(
      () => random.next(),
      state,
      null,
      options.supply === undefined
        ? supplyFor('R01', 'I06', stacks)
        : options.supply,
    );
    const economy = new EconomyLedger();
    economy.restore(options.gold ?? 200);
    const inventory = new ItemInventory();
    inventory.restore(
      Object.entries(stacks).map(([id, stackCount]) => ({
        id,
        stacks: stackCount,
      })),
    );
    const payments = new ItemPaymentLedger();
    const session = new ShopSession({
      shelf,
      gold: economy,
      inventory,
      payments,
      deliverMaterialSupply: options.deliverMaterialSupply,
    });
    return { shelf, economy, inventory, payments, session };
  }

  it('按正常价格扣款、入库存并记录支付账本', () => {
    const { shelf, economy, inventory, payments, session } = makeSession();
    const price = shelf.materialSupply?.price ?? 0;
    const goldBefore = economy.gold;
    const result = session.purchaseMaterialSupply();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itemId).toBe('I06');
    expect(result.recipeId).toBe('R01');
    expect(result.price).toBe(price);
    expect(result.goldBefore).toBe(goldBefore);
    expect(result.goldAfter).toBe(goldBefore - price);
    expect(economy.gold).toBe(goldBefore - price);
    expect(inventory.stacksOf('I06')).toBe(1);
    expect(result.stacksAfter).toBe(1);
    expect(payments.peekLatest('I06')).toBe(price);
    expect(shelf.materialSupply?.sold).toBe(true);

    const again = session.purchaseMaterialSupply();
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('already-sold');
    expect(economy.gold).toBe(goldBefore - price);
  });

  it('金币不足时给出差额且不扣款、不发货', () => {
    const price = supplyFor('R01', 'I06', { I01: 1 }).price;
    const { economy, inventory, session } = makeSession({ gold: price - 1 });
    const goldBefore = economy.gold;
    const result = session.purchaseMaterialSupply();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('insufficient-gold');
      expect(result.shortfall).toBe(1);
    }
    expect(economy.gold).toBe(goldBefore);
    expect(inventory.stacksOf('I06')).toBe(0);
  });

  it('发货失败全额退款且不标记已购买', () => {
    const { economy, inventory, shelf, session } = makeSession({
      deliverMaterialSupply: () => false,
    });
    const goldBefore = economy.gold;
    const result = session.purchaseMaterialSupply();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('delivery-failed');
    expect(economy.gold).toBe(goldBefore);
    expect(inventory.stacksOf('I06')).toBe(0);
    expect(shelf.materialSupply?.sold).toBe(false);
  });

  it('满层与没有缺件时拒绝购买', () => {
    // I18 的叠层上限是 1，用它构造“缺件条目已满层”的防御分支。
    const forged: ShopMaterialSupply = {
      ...supplyFor('R01', 'I18', { I01: 1 }),
      stacks: 1,
    };
    const noSupply = makeSession({ supply: null });
    expect(noSupply.session.purchaseMaterialSupply()).toMatchObject({
      ok: false,
      reason: 'no-material-supply',
    });

    const capped = makeSession({
      stacks: { I01: 1, I18: 1 },
      supply: forged,
    });
    expect(capped.session.purchaseMaterialSupply()).toMatchObject({
      ok: false,
      reason: 'item-full',
    });
    expect(capped.inventory.stacksOf('I18')).toBe(1);
    expect(capped.economy.gold).toBe(200);
  });
});
