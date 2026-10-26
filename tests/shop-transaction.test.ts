import { describe, expect, it } from 'vitest';
import {
  getConsumable,
  getFreeSkill,
  getShopItem,
} from '../src/game/data';
import { EconomyLedger } from '../src/game/economy';
import { ItemInventory } from '../src/game/item-inventory';
import { SeededRandom } from '../src/game/random';
import {
  MAX_NET_DISCOUNT_PERCENT,
  MIN_SHOP_PRICE,
  SHOP_SKILL_SLOT,
  ShopShelf,
  applyShopPriceModifiers,
  resolveShopPrice,
  shopPrice,
  type ShopOffer,
} from '../src/game/shop-offer';
import {
  ItemPaymentLedger,
  SELL_REFUND_PERCENT,
  ShopKeyGate,
  ShopSession,
  shopSellPrice,
} from '../src/game/shop-transaction';

const WAVE = 7;
const NEXT_WAVE = 8;
const START_GOLD = 200;

function drawState(
  shopWave: number,
  stacks: Readonly<Record<string, number>> = {},
) {
  return {
    shopWave,
    characterId: 'vishdal' as const,
    stacksOf: (itemId: string) => stacks[itemId] ?? 0,
  };
}

interface SessionHarness {
  readonly shelf: ShopShelf;
  readonly economy: EconomyLedger;
  readonly inventory: ItemInventory;
  readonly payments: ItemPaymentLedger;
  readonly session: ShopSession;
}

function makeSession(
  options: {
    readonly gold?: number;
    readonly wave?: number;
    readonly seed?: number;
    readonly stacks?: Readonly<Record<string, number>>;
    readonly payments?: ItemPaymentLedger;
    readonly deliver?: (offer: ShopOffer) => boolean;
    readonly isSellable?: (itemId: string) => boolean;
    readonly crafted?: {
      readonly freeRerollsPerShop: number;
      firstItemDiscountPercent(): number;
      consumeFirstItemDiscount(): number;
    };
  } = {},
): SessionHarness {
  const random = new SeededRandom(options.seed ?? 20261022);
  const shelf = new ShopShelf(
    () => random.next(),
    drawState(options.wave ?? WAVE, options.stacks ?? {}),
  );
  const economy = new EconomyLedger();
  economy.restore(options.gold ?? START_GOLD);
  const inventory = new ItemInventory();
  const payments = options.payments ?? new ItemPaymentLedger();
  const session = new ShopSession({
    shelf,
    gold: economy,
    inventory,
    payments,
    ...(options.deliver ? { deliver: options.deliver } : {}),
    ...(options.isSellable ? { isSellable: options.isSellable } : {}),
    ...(options.crafted ? { crafted: options.crafted } : {}),
  });
  return { shelf, economy, inventory, payments, session };
}

function firstItem(shelf: ShopShelf): ShopOffer {
  const offer = shelf.offers.find((entry) => entry.kind === 'item');
  if (!offer) throw new Error('货架缺少永久道具');
  return offer;
}

function basePriceOf(offer: ShopOffer): number {
  if (offer.kind === 'item') return getShopItem(offer.id)?.basePrice ?? 0;
  if (offer.kind === 'skill') return getFreeSkill(offer.id)?.basePrice ?? 0;
  return getConsumable(offer.id)?.basePrice ?? 0;
}

describe('价格合并与优惠优先级', () => {
  it('折扣与加价在基础波次价格上合并，不分别乘算', () => {
    expect(
      applyShopPriceModifiers(100, {
        discountPercent: 20,
        surchargePercent: 10,
      }),
    ).toBe(90);
    // 50% 折扣 + 20% 加价 = 净折扣 30%，未触发 35% 上限。
    expect(
      applyShopPriceModifiers(100, {
        discountPercent: 50,
        surchargePercent: 20,
      }),
    ).toBe(70);
  });

  it('净折扣上限 35%，最终价格至少 1 金币', () => {
    expect(MAX_NET_DISCOUNT_PERCENT).toBe(35);
    expect(MIN_SHOP_PRICE).toBe(1);
    expect(applyShopPriceModifiers(100, { discountPercent: 50 })).toBe(65);
    expect(applyShopPriceModifiers(100, { discountPercent: 100 })).toBe(65);
    expect(applyShopPriceModifiers(1, { discountPercent: 100 })).toBe(1);
    expect(applyShopPriceModifiers(7, { discountPercent: 35 })).toBe(5);
  });

  it('四舍五入覆盖恰好 .5 边界', () => {
    // 50 × 1.15 = 57.5，应向上取整到 58。
    expect(applyShopPriceModifiers(50, { surchargePercent: 15 })).toBe(58);
    expect(applyShopPriceModifiers(90, { surchargePercent: 15 })).toBe(104);
  });

  it('锁定价、首购补贴与技能升级价各按自己的规则，不叠加折扣', () => {
    const locked = resolveShopPrice({
      basePrice: 50,
      shopWave: WAVE,
      lockedPrice: 52,
      modifiers: { discountPercent: 50 },
      firstPurchaseSubsidy: 25,
      skillLevel: 2,
    });
    expect(locked.price).toBe(52);
    expect(locked.source).toBe('locked');

    const subsidy = resolveShopPrice({
      basePrice: 70,
      shopWave: 1,
      firstPurchaseSubsidy: 25,
      modifiers: { discountPercent: 50 },
    });
    expect(subsidy.price).toBe(45);
    expect(subsidy.source).toBe('first-purchase');

    const level2 = resolveShopPrice({
      basePrice: 70,
      shopWave: 1,
      skillLevel: 2,
      modifiers: { discountPercent: 50 },
    });
    expect(level2.price).toBe(42);
    expect(level2.source).toBe('upgrade');
    expect(
      resolveShopPrice({ basePrice: 70, shopWave: 1, skillLevel: 3 }).price,
    ).toBe(63);

    const modified = resolveShopPrice({
      basePrice: 100,
      shopWave: 1,
      modifiers: { discountPercent: 20 },
    });
    expect(modified.price).toBe(80);
    expect(modified.source).toBe('modifiers');
    expect(
      resolveShopPrice({ basePrice: 45, shopWave: WAVE }).price,
    ).toBe(shopPrice(45, WAVE));
  });
});

describe('出售价格', () => {
  it('回收实际支付的 40% 向下取整，免费物品为 0', () => {
    expect(SELL_REFUND_PERCENT).toBe(40);
    expect(shopSellPrice(0)).toBe(0);
    expect(shopSellPrice(1)).toBe(0);
    expect(shopSellPrice(45)).toBe(18);
    expect(shopSellPrice(55)).toBe(22);
    expect(shopSellPrice(99)).toBe(39);
  });
});

describe('购买原子性', () => {
  it('成功购买一次性扣款、发货并标记售出', () => {
    const { shelf, economy, inventory, payments, session } = makeSession();
    const target = firstItem(shelf);
    const goldBefore = economy.gold;

    const result = session.purchase(target.slot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.price).toBe(target.price);
    expect(result.goldBefore).toBe(goldBefore);
    expect(result.goldAfter).toBe(goldBefore - target.price);
    expect(economy.gold).toBe(goldBefore - target.price);
    expect(inventory.stacksOf(target.id)).toBe(1);
    expect(result.stacksAfter).toBe(1);
    expect(payments.peekLatest(target.id)).toBe(target.price);
    expect(
      shelf.offers.find((offer) => offer.slot === target.slot)?.sold,
    ).toBe(true);
  });

  it('重复确认同一格不会重复扣款或发货', () => {
    const { shelf, economy, inventory, session } = makeSession();
    const target = firstItem(shelf);
    expect(session.purchase(target.slot).ok).toBe(true);
    const goldAfterFirst = economy.gold;
    const repeat = session.purchase(target.slot);
    expect(repeat.ok).toBe(false);
    if (repeat.ok) return;
    expect(repeat.reason).toBe('already-sold');
    expect(economy.gold).toBe(goldAfterFirst);
    expect(inventory.stacksOf(target.id)).toBe(1);
  });

  it('金币不足时禁用并给出差额，不扣款不发货', () => {
    const { shelf, economy, inventory, session } = makeSession({ gold: 0 });
    const target = firstItem(shelf);
    const check = session.canPurchase(target.slot);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe('insufficient-gold');
    expect(check.shortfall).toBe(target.price);

    expect(session.canPurchase(target.slot).ok).toBe(false);
    expect(economy.gold).toBe(0);
    expect(inventory.stacksOf(target.id)).toBe(0);
    expect(
      shelf.offers.find((offer) => offer.slot === target.slot)?.sold,
    ).toBe(false);
  });

  it('满层道具不可购买，金币与货架状态不变', () => {
    const { shelf, economy, inventory, session } = makeSession();
    const target = firstItem(shelf);
    const item = getShopItem(target.id);
    expect(item).toBeDefined();
    for (let index = 0; index < (item?.stackCap ?? 0); index += 1) {
      inventory.acquire(target.id);
    }
    const goldBefore = economy.gold;
    const result = session.purchase(target.slot);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('item-full');
    expect(economy.gold).toBe(goldBefore);
    expect(inventory.stacksOf(target.id)).toBe(item?.stackCap);
    expect(
      shelf.offers.find((offer) => offer.slot === target.slot)?.sold,
    ).toBe(false);
  });

  it('发货失败全额回滚，不扣钱不标记售出', () => {
    const { shelf, economy, inventory, session } = makeSession({
      deliver: () => false,
    });
    const target = firstItem(shelf);
    const goldBefore = economy.gold;
    const result = session.purchase(target.slot);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('delivery-failed');
    expect(economy.gold).toBe(goldBefore);
    expect(inventory.stacksOf(target.id)).toBe(0);
    expect(
      shelf.offers.find((offer) => offer.slot === target.slot)?.sold,
    ).toBe(false);
  });

  it('默认会话只支持永久道具；自定义发货可扩展技能购买', () => {
    const defaultSession = makeSession();
    const skill = defaultSession.shelf.offers.find(
      (offer) => offer.kind === 'skill',
    );
    expect(skill?.slot).toBe(SHOP_SKILL_SLOT);
    const rejected = defaultSession.session.canPurchase(SHOP_SKILL_SLOT);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe('unsupported-kind');
    expect(defaultSession.economy.gold).toBe(START_GOLD);

    const custom = makeSession({ deliver: () => true });
    const bought = custom.session.purchase(SHOP_SKILL_SLOT);
    expect(bought.ok).toBe(true);
    expect(custom.economy.gold).toBeLessThan(START_GOLD);
    expect(
      custom.shelf.offers.find((offer) => offer.slot === SHOP_SKILL_SLOT)?.sold,
    ).toBe(true);
  });
});

describe('重抽', () => {
  it('扣除本商店重抽费用并递增次数与费用', () => {
    const { shelf, economy, session } = makeSession();
    const cost = shelf.rerollCost;
    const goldBefore = economy.gold;
    const result = session.reroll();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost).toBe(cost);
    expect(result.goldAfter).toBe(goldBefore - cost);
    expect(shelf.rerollCount).toBe(1);
    expect(shelf.rerollCost).toBe(cost + 2);
  });

  it('金币不足时不重抽、不扣款并显示差额', () => {
    const { shelf, economy, session } = makeSession({ gold: 0 });
    const offersBefore = shelf.offers.map((offer) => offer.id);
    const result = session.reroll();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('insufficient-gold');
    expect(result.shortfall).toBe(shelf.rerollCost);
    expect(economy.gold).toBe(0);
    expect(shelf.rerollCount).toBe(0);
    expect(shelf.offers.map((offer) => offer.id)).toEqual(offersBefore);
  });
});

describe('R06 命运交易所', () => {
  function r06Economy(freeRerollsPerShop = 1, discount = 20) {
    let used = false;
    return {
      freeRerollsPerShop,
      firstItemDiscountPercent: () => (used ? 0 : discount),
      consumeFirstItemDiscount: () => {
        if (used) return 0;
        used = true;
        return discount;
      },
    };
  }

  it('每个商店第一次重抽免费，第二次恢复货架价格', () => {
    const crafted = r06Economy();
    const { shelf, economy, session } = makeSession({
      gold: 200,
      crafted,
    });
    const goldBefore = economy.gold;
    expect(session.freeRerollAvailable).toBe(true);
    expect(session.nextRerollCost).toBe(0);

    const first = session.reroll();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.cost).toBe(0);
    expect(economy.gold).toBe(goldBefore);
    expect(shelf.rerollCount).toBe(1);
    expect(session.freeRerollAvailable).toBe(false);
    expect(session.nextRerollCost).toBe(shelf.rerollCost);

    const second = session.reroll();
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.cost).toBe(shelf.rerollCost - 2);
    expect(economy.gold).toBe(goldBefore - second.cost);
  });

  it('未拥有 R06 时首次重抽仍按货架价格扣款', () => {
    const { shelf, economy, session } = makeSession({ gold: 200 });
    expect(session.freeRerollAvailable).toBe(false);
    expect(session.nextRerollCost).toBe(shelf.rerollCost);
    const result = session.reroll();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost).toBeGreaterThan(0);
    expect(economy.gold).toBe(200 - result.cost);
  });

  it('首次购买永久道具减价 20%，之后按原价，折扣只消费一次', () => {
    const crafted = r06Economy();
    const { shelf, economy, session } = makeSession({ gold: 500, crafted });
    const items = shelf.offers.filter((offer) => offer.kind === 'item');
    expect(items.length).toBeGreaterThanOrEqual(2);
    const [firstOffer, secondOffer] = items;
    if (!firstOffer || !secondOffer) return;

    expect(session.firstItemDiscountAvailable).toBe(true);
    const discounted = Math.round(firstOffer.price * 0.8);
    expect(session.effectivePrice(firstOffer)).toBe(discounted);
    const check = session.canPurchase(firstOffer.slot);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.price).toBe(discounted);

    const first = session.purchase(firstOffer.slot);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.price).toBe(discounted);
    expect(economy.gold).toBe(500 - discounted);
    expect(crafted.firstItemDiscountPercent()).toBe(0);
    expect(session.firstItemDiscountAvailable).toBe(false);

    // 第二件永久道具不再享受折扣，按货架价成交。
    expect(session.effectivePrice(secondOffer)).toBe(secondOffer.price);
    const second = session.purchase(secondOffer.slot);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.price).toBe(secondOffer.price);
  });

  it('购买失败不会消费首购折扣', () => {
    const crafted = r06Economy();
    const { shelf, session } = makeSession({ gold: 0, crafted });
    const offer = firstItem(shelf);
    const result = session.purchase(offer.slot);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('insufficient-gold');
    expect(crafted.firstItemDiscountPercent()).toBe(20);
    expect(session.firstItemDiscountAvailable).toBe(true);
  });
});

describe('出售', () => {
  it('按购买实际支付金币的 40% 回收并移除整件', () => {
    const { shelf, economy, inventory, session } = makeSession();
    const target = firstItem(shelf);
    const purchase = session.purchase(target.slot);
    expect(purchase.ok).toBe(true);
    const goldAfterBuy = economy.gold;

    const sold = session.sell(target.id);
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(sold.paid).toBe(target.price);
    expect(sold.refund).toBe(Math.floor((target.price * 40) / 100));
    expect(sold.goldBefore).toBe(goldAfterBuy);
    expect(sold.goldAfter).toBe(
      goldAfterBuy + Math.floor((target.price * 40) / 100),
    );
    expect(sold.remainingStacks).toBe(0);
    expect(inventory.stacksOf(target.id)).toBe(0);
  });

  it('免费奖励层售价为 0，且不能靠买卖套利', () => {
    const { shelf, economy, inventory, session } = makeSession();
    const target = firstItem(shelf);
    const goldBefore = economy.gold;
    inventory.acquire(target.id);
    const free = session.sell(target.id);
    expect(free.ok).toBe(true);
    if (!free.ok) return;
    expect(free.paid).toBe(0);
    expect(free.refund).toBe(0);
    expect(economy.gold).toBe(goldBefore);
    expect(free.remainingStacks).toBe(0);

    // 正常买一层再卖：回收 40%，金币必然净减少。
    const second = makeSession();
    const bought = firstItem(second.shelf);
    expect(second.session.purchase(bought.slot).ok).toBe(true);
    expect(second.session.sell(bought.id).ok).toBe(true);
    expect(second.economy.gold).toBeLessThan(START_GOLD);
  });

  it('单层出售按最近一次购买逐层回收', () => {
    const payments = new ItemPaymentLedger();
    const inventory = new ItemInventory();
    inventory.acquire('I01');
    inventory.acquire('I01');
    payments.record('I01', 60);
    payments.record('I01', 45);
    const harness = makeSession({ payments });
    // 会话库存必须与断言共用同一实例。
    const session = new ShopSession({
      shelf: harness.shelf,
      gold: harness.economy,
      inventory,
      payments,
    });

    const first = session.sellLayer('I01');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.paid).toBe(45);
    expect(first.refund).toBe(18);
    expect(first.remainingStacks).toBe(1);

    const second = session.sellLayer('I01');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.paid).toBe(60);
    expect(second.refund).toBe(24);
    expect(second.remainingStacks).toBe(0);
  });

  it('未拥有道具出售失败且金币不变', () => {
    const { economy, session } = makeSession();
    const sold = session.sell('I01');
    expect(sold.ok).toBe(false);
    if (sold.ok) return;
    expect(sold.reason).toBe('not-owned');
    expect(economy.gold).toBe(START_GOLD);
  });

  it('可出售性检查不扣款：未拥有为 not-owned，核心/成品为 not-sellable', () => {
    const { economy, inventory, session } = makeSession({
      isSellable: (itemId) => getShopItem(itemId) !== undefined,
    });
    const notOwned = session.canSell('I01');
    expect(notOwned.ok).toBe(false);
    if (notOwned.ok) return;
    expect(notOwned.reason).toBe('not-owned');

    // 核心/配方成品不在永久道具目录中，即使层数账本出现同 ID 也不可出售。
    const fakeInventory = {
      stacksOf: (itemId: string) => (itemId === 'E01' ? 1 : 0),
      isFull: () => false,
      acquire: () => false,
      release: () => true,
    };
    const fake = new ShopSession({
      shelf: makeSession().shelf,
      gold: economy,
      inventory: fakeInventory,
      isSellable: (itemId) => getShopItem(itemId) !== undefined,
    });
    const result = fake.sell('E01');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-sellable');
    expect(economy.gold).toBe(START_GOLD);

    inventory.acquire('I01');
    const owned = session.canSell('I01');
    expect(owned.ok).toBe(true);
    if (!owned.ok) return;
    expect(owned.refund).toBe(0);
  });

  it('出售前按现存层数裁剪支付账本，已消耗材料不会留下可退款记录', () => {
    const payments = new ItemPaymentLedger();
    const inventory = new ItemInventory();
    const harness = makeSession({ payments });
    // 两层实付 60/45；其中一层被配方消耗（只移层数、不退款）。
    inventory.acquire('I01');
    inventory.acquire('I01');
    payments.record('I01', 60);
    payments.record('I01', 45);
    expect(inventory.release('I01')).toBe(true);
    const session = new ShopSession({
      shelf: harness.shelf,
      gold: harness.economy,
      inventory,
      payments,
    });

    const sold = session.sell('I01');
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(sold.paid).toBe(45);
    expect(sold.refund).toBe(18);
    expect(sold.remainingStacks).toBe(0);
    expect(payments.countOf('I01')).toBe(0);
    // 回收 18 少于两层实付的 40%（42），配方消耗的层没有参与退款。
    expect(harness.economy.gold - START_GOLD).toBe(18);
  });

  it('整件出售移除全部层数，按总实付 40% 向下取整回收', () => {
    const payments = new ItemPaymentLedger();
    const inventory = new ItemInventory();
    const harness = makeSession({ payments });
    for (let index = 0; index < 3; index += 1) inventory.acquire('I01');
    payments.record('I01', 60);
    payments.record('I01', 45);
    payments.record('I01', 50);
    const session = new ShopSession({
      shelf: harness.shelf,
      gold: harness.economy,
      inventory,
      payments,
    });

    const check = session.canSell('I01');
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.layers).toBe(3);
    expect(check.paid).toBe(155);

    const sold = session.sell('I01');
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(sold.paid).toBe(155);
    expect(sold.refund).toBe(62);
    expect(sold.remainingStacks).toBe(0);
    expect(inventory.stacksOf('I01')).toBe(0);
    expect(payments.countOf('I01')).toBe(0);
    expect(harness.economy.gold - START_GOLD).toBe(62);
  });

  it('支付账本多于现存层数时丢弃最旧条目，整件回收不超过实付 40%', () => {
    const payments = new ItemPaymentLedger();
    const inventory = new ItemInventory();
    const harness = makeSession({ payments });
    inventory.acquire('I01');
    inventory.acquire('I01');
    payments.record('I01', 60);
    payments.record('I01', 45);
    payments.record('I01', 50);
    const session = new ShopSession({
      shelf: harness.shelf,
      gold: harness.economy,
      inventory,
      payments,
    });

    const sold = session.sell('I01');
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    // 保留最近两层 45/50；多出的 60 视为已消耗层，不参与退款。
    expect(sold.paid).toBe(95);
    expect(sold.refund).toBe(38);
    expect(sold.remainingStacks).toBe(0);
    expect(payments.countOf('I01')).toBe(0);
    expect(harness.economy.gold - START_GOLD).toBe(38);
  });
});

describe('锁定与跨商店保留', () => {
  it('锁定未售出商品；售出格不可锁定', () => {
    const { shelf, session } = makeSession();
    const target = firstItem(shelf);
    expect(session.lock(target.slot)).toBe(true);
    const locked = shelf.lockedOffer;
    expect(locked).toEqual({
      slot: target.slot,
      kind: 'item',
      id: target.id,
      price: target.price,
    });
    expect(
      shelf.offers.find((offer) => offer.slot === target.slot)?.locked,
    ).toBe(true);

    shelf.markSold(target.slot);
    expect(shelf.lockedOffer).toBeNull();
    expect(session.lock(target.slot)).toBe(false);
    expect(session.lock(99)).toBe(false);
  });

  it('重抽保留锁定商品的身份与价格，其他格刷新', () => {
    const { shelf, session } = makeSession();
    const target = firstItem(shelf);
    session.lock(target.slot);
    const otherIdsBefore = shelf.offers
      .filter((offer) => offer.slot !== target.slot)
      .map((offer) => offer.id);

    session.reroll();
    const locked = shelf.offers.find((offer) => offer.slot === target.slot);
    expect(locked?.id).toBe(target.id);
    expect(locked?.price).toBe(target.price);
    expect(locked?.locked).toBe(true);
    expect(
      shelf.offers
        .filter((offer) => offer.slot !== target.slot)
        .map((offer) => offer.id),
    ).not.toEqual(otherIdsBefore);
  });

  it('下个商店保留锁定价，属性预览按当前层数重算', () => {
    const lateWave = 17;
    const { shelf, session } = makeSession();
    const target = firstItem(shelf);
    expect(session.lock(target.slot)).toBe(true);

    const random = new SeededRandom(777);
    const nextShelf = new ShopShelf(
      () => random.next(),
      drawState(lateWave, { [target.id]: 1 }),
      session.carryLock(),
    );
    const next = nextShelf.offers.find(
      (offer) => offer.slot === target.slot,
    );
    expect(next?.id).toBe(target.id);
    // 锁定时是第 7 商店价格，进入第 17 商店也不按新波数重新定价。
    expect(next?.price).toBe(target.price);
    expect(next?.price).not.toBe(shopPrice(basePriceOf(target), lateWave));
    expect(next?.locked).toBe(true);
    expect(next?.stacks).toBe(1);
    expect(next?.nextStacks).toBe(2);

    for (const offer of nextShelf.offers.filter((entry) => !entry.locked)) {
      expect(offer.price).toBe(shopPrice(basePriceOf(offer), lateWave));
    }
  });

  it('锁定道具在下一商店已满层时放弃锁定并正常刷新', () => {
    const { shelf, session } = makeSession();
    const target = firstItem(shelf);
    const item = getShopItem(target.id);
    expect(item).toBeDefined();
    expect(session.lock(target.slot)).toBe(true);

    const random = new SeededRandom(888);
    const nextShelf = new ShopShelf(
      () => random.next(),
      drawState(NEXT_WAVE, { [target.id]: item?.stackCap ?? 0 }),
      session.carryLock(),
    );
    expect(nextShelf.lockedOffer).toBeNull();
    expect(
      nextShelf.offers.some((offer) => offer.id === target.id),
    ).toBe(false);
  });
});

describe('长按防重', () => {
  it('同一按键在松开前只接受第一次 keydown', () => {
    const gate = new ShopKeyGate();
    expect(gate.keyDown('Enter')).toBe(true);
    expect(gate.keyDown('Enter', true)).toBe(false);
    expect(gate.keyDown('Enter')).toBe(false);
    gate.keyUp('Enter');
    expect(gate.keyDown('Enter')).toBe(true);
  });

  it('松开后再次长按仍是单独一次确认', () => {
    const gate = new ShopKeyGate();
    expect(gate.keyDown('KeyF')).toBe(true);
    expect(gate.keyDown('KeyF', true)).toBe(false);
    gate.keyUp('KeyF');
    expect(gate.keyDown('KeyF')).toBe(true);
    expect(gate.isHeld('KeyF')).toBe(true);
    gate.reset();
    expect(gate.isHeld('KeyF')).toBe(false);
  });
});
