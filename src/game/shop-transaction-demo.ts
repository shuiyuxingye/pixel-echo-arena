/**
 * 开发专用商店交易演示（纯逻辑，仅在 `?dev=1` 场景创建时调用）。
 *
 * 正式商店界面属于 US-046；本演示用固定种子给 Validator 一份可直接断言的
 * 只读证据，覆盖本故事（US-022）的核心规则：
 * - 折扣/加价合并、净折扣 35% 上限与最低 1 金币；
 * - 锁定价/首购补贴/技能升级价各自独立，不重复叠加；
 * - 购买原子完成、重复确认不重复扣款、金币不足给出差额；
 * - 发货失败全额回滚、满层不可购买；
 * - 出售按实际支付 40% 向下取整，免费奖励层为 0；
 * - 锁定保留到下个商店，价格不变、属性预览按当前层数重算；
 * - 长按 Enter 只接受第一次 keydown。
 *
 * 演示使用独立的钱包、库存与货架实例，不读写本局金币、道具库存或
 * `RunRandomStreams`，也不提供跳关/改数值入口。
 */
import {
  getConsumable,
  getFreeSkill,
  getShopItem,
  listShopItems,
} from './data';
import { ItemInventory } from './item-inventory';
import { SeededRandom } from './random';
import {
  ShopShelf,
  resolveShopPrice,
  shopPrice,
  type ShopOffer,
  type ShopPriceSource,
} from './shop-offer';
import {
  ItemPaymentLedger,
  ShopKeyGate,
  ShopSession,
  type ShopGoldLedger,
} from './shop-transaction';

/** 演示固定种子；与正式对局种子无关。 */
export const SHOP_TRANSACTION_DEMO_SEED = 20261022;

const DEMO_CHARACTER = 'vishdal' as const;
const DEMO_SHOP_WAVE = 7;
const DEMO_NEXT_WAVE = 8;
const DEMO_START_GOLD = 200;

/** 演示用的独立钱包，不触碰本局 `EconomyLedger`。 */
class DemoWallet implements ShopGoldLedger {
  private value: number;

  constructor(initial: number) {
    this.value = initial;
  }

  get gold(): number {
    return this.value;
  }

  addGold(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const added = Math.floor(amount);
    this.value += added;
    return added;
  }

  spendGold(amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const cost = Math.floor(amount);
    if (cost > this.value) return false;
    this.value -= cost;
    return true;
  }
}

function drawState(
  shopWave: number,
  stacks: Readonly<Record<string, number>> = {},
) {
  return {
    shopWave,
    characterId: DEMO_CHARACTER,
    stacksOf: (itemId: string) => stacks[itemId] ?? 0,
  };
}

function firstItemOffer(shelf: ShopShelf): ShopOffer {
  const offer = shelf.offers.find((entry) => entry.kind === 'item');
  if (!offer) throw new Error('演示货架缺少永久道具格');
  return offer;
}

function basePriceOf(offer: ShopOffer): number {
  if (offer.kind === 'item') return getShopItem(offer.id)?.basePrice ?? 0;
  if (offer.kind === 'skill') return getFreeSkill(offer.id)?.basePrice ?? 0;
  return getConsumable(offer.id)?.basePrice ?? 0;
}

export interface ShopTransactionDemoPriceExample {
  readonly label: string;
  readonly price: number;
  readonly source: ShopPriceSource;
  readonly baseWavePrice: number;
}

export interface ShopTransactionDemoPurchase {
  readonly slot: number;
  readonly id: string;
  readonly price: number;
  readonly goldBefore: number;
  readonly goldAfter: number;
  readonly soldAfter: boolean;
  readonly stacksAfter: number;
  /** 重复确认同一格：应返回 already-sold 且金币不变。 */
  readonly repeatReason: string;
  readonly repeatGoldAfter: number;
}

export interface ShopTransactionDemoInsufficient {
  readonly id: string;
  readonly price: number;
  readonly gold: number;
  readonly reason: string;
  readonly shortfall: number;
}

export interface ShopTransactionDemoAtomicFailure {
  readonly id: string;
  readonly goldBefore: number;
  readonly goldAfter: number;
  readonly reason: string;
  readonly sold: boolean;
  readonly stacks: number;
}

export interface ShopTransactionDemoSell {
  readonly id: string;
  readonly paid: number;
  readonly refund: number;
  readonly goldBefore: number;
  readonly goldAfter: number;
  readonly remainingStacks: number;
  readonly freeItemId: string;
  readonly freePaid: number;
  readonly freeRefund: number;
  readonly freeRemainingStacks: number;
}

export interface ShopTransactionDemoLock {
  readonly slot: number;
  readonly id: string;
  readonly price: number;
  readonly previewStacksBefore: number;
  readonly afterRerollId: string;
  readonly afterRerollPrice: number;
  readonly afterRerollLocked: boolean;
  readonly nextWave: number;
  readonly nextId: string;
  readonly nextPrice: number;
  readonly nextLocked: boolean;
  readonly nextStacks: number;
  readonly nextPreviewStacks: number;
  readonly otherSlotsRepricedForNextWave: boolean;
}

export interface ShopTransactionDemoLongPress {
  readonly firstAccepted: boolean;
  readonly repeatedEventIgnored: boolean;
  readonly secondKeyDownWhileHeld: boolean;
  readonly acceptedAfterRelease: boolean;
}

export interface ShopTransactionDemoReport {
  readonly seed: number;
  readonly priceExamples: readonly ShopTransactionDemoPriceExample[];
  readonly purchase: ShopTransactionDemoPurchase;
  readonly insufficientGold: ShopTransactionDemoInsufficient;
  readonly fullStack: ShopTransactionDemoAtomicFailure;
  readonly deliveryFailure: ShopTransactionDemoAtomicFailure;
  readonly sell: ShopTransactionDemoSell;
  readonly lock: ShopTransactionDemoLock;
  readonly longPress: ShopTransactionDemoLongPress;
}

function priceExample(
  label: string,
  request: Parameters<typeof resolveShopPrice>[0],
): ShopTransactionDemoPriceExample {
  const result = resolveShopPrice(request);
  return {
    label,
    price: result.price,
    source: result.source,
    baseWavePrice: result.baseWavePrice,
  };
}

function runPriceExamples(): ShopTransactionDemoPriceExample[] {
  return [
    priceExample('折扣20% + 加价10% 合并', {
      basePrice: 100,
      shopWave: 1,
      modifiers: { discountPercent: 20, surchargePercent: 10 },
    }),
    priceExample('净折扣从50%封顶到35%', {
      basePrice: 100,
      shopWave: 1,
      modifiers: { discountPercent: 50 },
    }),
    priceExample('最低价保底1金币', {
      basePrice: 1,
      shopWave: 1,
      modifiers: { discountPercent: 100 },
    }),
    priceExample('首购补贴不叠加其他折扣', {
      basePrice: 70,
      shopWave: 1,
      firstPurchaseSubsidy: 25,
      modifiers: { discountPercent: 50 },
    }),
    priceExample('同名技能2级升级价', {
      basePrice: 70,
      shopWave: 1,
      skillLevel: 2,
      modifiers: { discountPercent: 50 },
    }),
    priceExample('同名技能3级升级价', {
      basePrice: 70,
      shopWave: 1,
      skillLevel: 3,
    }),
    priceExample('锁定价优先于折扣', {
      basePrice: 50,
      shopWave: 7,
      lockedPrice: 52,
      modifiers: { discountPercent: 50 },
    }),
  ];
}

function runPurchaseDemo(): {
  purchase: ShopTransactionDemoPurchase;
  wallet: DemoWallet;
  inventory: ItemInventory;
  payments: ItemPaymentLedger;
  purchased: ShopOffer;
} {
  const random = new SeededRandom(SHOP_TRANSACTION_DEMO_SEED);
  const shelf = new ShopShelf(() => random.next(), drawState(DEMO_SHOP_WAVE));
  const wallet = new DemoWallet(DEMO_START_GOLD);
  const inventory = new ItemInventory();
  const payments = new ItemPaymentLedger();
  const session = new ShopSession({ shelf, gold: wallet, inventory, payments });
  const target = firstItemOffer(shelf);

  const result = session.purchase(target.slot);
  if (!result.ok) throw new Error(`演示购买失败：${result.reason}`);

  const repeat = session.purchase(target.slot);
  const soldAfter = shelf.offers.find((offer) => offer.slot === target.slot);

  return {
    purchase: {
      slot: target.slot,
      id: target.id,
      price: result.price,
      goldBefore: result.goldBefore,
      goldAfter: result.goldAfter,
      soldAfter: soldAfter?.sold ?? false,
      stacksAfter: result.stacksAfter ?? 0,
      repeatReason: repeat.ok ? 'unexpected-success' : repeat.reason,
      repeatGoldAfter: wallet.gold,
    },
    wallet,
    inventory,
    payments,
    purchased: target,
  };
}

function runInsufficientDemo(): ShopTransactionDemoInsufficient {
  const random = new SeededRandom(SHOP_TRANSACTION_DEMO_SEED + 1);
  const shelf = new ShopShelf(() => random.next(), drawState(DEMO_SHOP_WAVE));
  const wallet = new DemoWallet(0);
  const session = new ShopSession({
    shelf,
    gold: wallet,
    inventory: new ItemInventory(),
  });
  const target = firstItemOffer(shelf);
  const check = session.canPurchase(target.slot);
  if (check.ok) throw new Error('零金币时不应可购买');
  return {
    id: target.id,
    price: target.price,
    gold: check.gold,
    reason: check.reason,
    shortfall: check.shortfall,
  };
}

function runFullStackDemo(): ShopTransactionDemoAtomicFailure {
  const random = new SeededRandom(SHOP_TRANSACTION_DEMO_SEED + 2);
  const shelf = new ShopShelf(() => random.next(), drawState(DEMO_SHOP_WAVE));
  const wallet = new DemoWallet(DEMO_START_GOLD);
  const inventory = new ItemInventory();
  const target = firstItemOffer(shelf);
  const item = getShopItem(target.id);
  if (!item) throw new Error('演示道具缺失');
  for (let index = 0; index < item.stackCap; index += 1) {
    inventory.acquire(target.id);
  }

  const session = new ShopSession({ shelf, gold: wallet, inventory });
  const goldBefore = wallet.gold;
  const result = session.purchase(target.slot);
  const offer = shelf.offers.find((entry) => entry.slot === target.slot);
  return {
    id: target.id,
    goldBefore,
    goldAfter: wallet.gold,
    reason: result.ok ? 'unexpected-success' : result.reason,
    sold: offer?.sold ?? false,
    stacks: inventory.stacksOf(target.id),
  };
}

function runDeliveryFailureDemo(): ShopTransactionDemoAtomicFailure {
  const random = new SeededRandom(SHOP_TRANSACTION_DEMO_SEED + 3);
  const shelf = new ShopShelf(() => random.next(), drawState(DEMO_SHOP_WAVE));
  const wallet = new DemoWallet(DEMO_START_GOLD);
  const inventory = new ItemInventory();
  const target = firstItemOffer(shelf);
  const session = new ShopSession({
    shelf,
    gold: wallet,
    inventory,
    deliver: () => false,
  });
  const goldBefore = wallet.gold;
  const result = session.purchase(target.slot);
  const offer = shelf.offers.find((entry) => entry.slot === target.slot);
  return {
    id: target.id,
    goldBefore,
    goldAfter: wallet.gold,
    reason: result.ok ? 'unexpected-success' : result.reason,
    sold: offer?.sold ?? false,
    stacks: inventory.stacksOf(target.id),
  };
}

function runSellDemo(
  wallet: DemoWallet,
  inventory: ItemInventory,
  payments: ItemPaymentLedger,
  purchased: ShopOffer,
): ShopTransactionDemoSell {
  const session = new ShopSession({
    shelf: new ShopShelf(
      () => new SeededRandom(SHOP_TRANSACTION_DEMO_SEED + 4).next(),
      drawState(DEMO_SHOP_WAVE),
    ),
    gold: wallet,
    inventory,
    payments,
  });
  const paid = payments.peekLatest(purchased.id);
  const goldBefore = wallet.gold;
  const sold = session.sell(purchased.id);
  if (!sold.ok) throw new Error(`演示出售失败：${sold.reason}`);

  const freeItem = listShopItems().find(
    (item) => item.id !== purchased.id,
  );
  if (!freeItem) throw new Error('演示缺少免费奖励道具');
  inventory.acquire(freeItem.id);
  const freePaid = payments.peekLatest(freeItem.id);
  const free = session.sell(freeItem.id);
  if (!free.ok) throw new Error(`演示免费出售失败：${free.reason}`);

  return {
    id: purchased.id,
    paid,
    refund: sold.refund,
    goldBefore,
    goldAfter: sold.goldAfter,
    remainingStacks: sold.remainingStacks,
    freeItemId: freeItem.id,
    freePaid,
    freeRefund: free.refund,
    freeRemainingStacks: free.remainingStacks,
  };
}

function runLockDemo(): ShopTransactionDemoLock {
  const random = new SeededRandom(SHOP_TRANSACTION_DEMO_SEED + 5);
  const shelf = new ShopShelf(() => random.next(), drawState(DEMO_SHOP_WAVE));
  const wallet = new DemoWallet(DEMO_START_GOLD);
  const session = new ShopSession({
    shelf,
    gold: wallet,
    inventory: new ItemInventory(),
  });
  const target = firstItemOffer(shelf);
  if (!session.lock(target.slot)) throw new Error('演示锁定失败');

  session.reroll();
  const afterReroll = shelf.offers.find(
    (offer) => offer.slot === target.slot,
  );

  // 下一商店：锁定 ID 的层数变为 1，属性预览必须按当前层数重算。
  const nextShelf = new ShopShelf(
    () => random.next(),
    drawState(DEMO_NEXT_WAVE, { [target.id]: 1 }),
    session.carryLock(),
  );
  const nextLocked = nextShelf.offers.find(
    (offer) => offer.slot === target.slot,
  );
  const otherSlotsRepricedForNextWave = nextShelf.offers
    .filter((offer) => !offer.locked)
    .every(
      (offer) =>
        offer.price === shopPrice(basePriceOf(offer), DEMO_NEXT_WAVE),
    );
  if (!nextLocked) throw new Error('锁定商品未进入下一商店');

  return {
    slot: target.slot,
    id: target.id,
    price: target.price,
    previewStacksBefore: target.stacks ?? 0,
    afterRerollId: afterReroll?.id ?? '',
    afterRerollPrice: afterReroll?.price ?? 0,
    afterRerollLocked: afterReroll?.locked ?? false,
    nextWave: DEMO_NEXT_WAVE,
    nextId: nextLocked.id,
    nextPrice: nextLocked.price,
    nextLocked: nextLocked.locked,
    nextStacks: nextLocked.stacks ?? 0,
    nextPreviewStacks: nextLocked.nextStacks ?? 0,
    otherSlotsRepricedForNextWave,
  };
}

function runLongPressDemo(): ShopTransactionDemoLongPress {
  const gate = new ShopKeyGate();
  const firstAccepted = gate.keyDown('Enter');
  const repeatedEventIgnored = gate.keyDown('Enter', true);
  const secondKeyDownWhileHeld = gate.keyDown('Enter');
  gate.keyUp('Enter');
  const acceptedAfterRelease = gate.keyDown('Enter');
  return {
    firstAccepted,
    repeatedEventIgnored,
    secondKeyDownWhileHeld,
    acceptedAfterRelease,
  };
}

/** 运行全部交易演示；固定种子下结果可复现。 */
export function runShopTransactionDemo(): ShopTransactionDemoReport {
  const priceExamples = runPriceExamples();
  const purchaseDemo = runPurchaseDemo();
  const sell = runSellDemo(
    purchaseDemo.wallet,
    purchaseDemo.inventory,
    purchaseDemo.payments,
    purchaseDemo.purchased,
  );
  return {
    seed: SHOP_TRANSACTION_DEMO_SEED,
    priceExamples,
    purchase: purchaseDemo.purchase,
    insufficientGold: runInsufficientDemo(),
    fullStack: runFullStackDemo(),
    deliveryFailure: runDeliveryFailureDemo(),
    sell,
    lock: runLockDemo(),
    longPress: runLongPressDemo(),
  };
}
