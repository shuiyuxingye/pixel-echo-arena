/**
 * 商店交易、锁定与出售（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §商店：
 * - 可免费锁定 1 格商品保留到下个商店；锁定价保持锁定时价格，
 *   其他格刷新，属性预览按当前层数重新计算（见 `shop-offer`）；
 * - 购买一次提交：金币不足不扣款并给出差额，发货失败整笔回滚，
 *   售出格不会再次发货；连续确认与长按 Enter 由 `ShopKeyGate` 与已售出状态共同防重；
 * - 出售回收该件实际支付金币的 40% 向下取整，免费奖励物品为 0；
 *   默认整件出售（移除全部层数），`sellLayer` 保留单层出售；
 *   出售前把支付账本裁剪到现存层数，配方消耗或外部移除的层不会留下退款记录；
 *   核心与配方成品由调用方通过 `isSellable` 排除；
 * - 折扣与加价在基础波次价格上合并（`resolveShopPrice`），
 *   净折扣上限 35%、最终价至少 1；锁定价、首购补贴与技能升级价各自独立，不重复叠加。
 */
import {
  applyShopPriceModifiers,
  type ShopOffer,
  type ShopOfferKind,
  type ShopShelf,
} from './shop-offer';

/** 出售回收比例：实际支付金币的 40%，向下取整。 */
export const SELL_REFUND_PERCENT = 40;

/** 金币账本的最小接口；本局传 `EconomyLedger`。 */
export interface ShopGoldLedger {
  readonly gold: number;
  addGold(amount: number): number;
  spendGold(amount: number): boolean;
}

/** 永久道具层数账本的最小接口；本局传 `ItemInventory`。 */
export interface ShopItemInventory {
  stacksOf(itemId: string): number;
  isFull(itemId: string): boolean;
  acquire(itemId: string): boolean;
  release(itemId: string): boolean;
}

/** 出售价：`floor(实际支付 × 40%)`；免费获得（支付 0）为 0。 */
export function shopSellPrice(paidPrice: number): number {
  if (!Number.isFinite(paidPrice) || paidPrice <= 0) return 0;
  // 整数分子避免 55 × 0.4 之类的浮点尾巴影响向下取整。
  return Math.floor((Math.floor(paidPrice) * SELL_REFUND_PERCENT) / 100);
}

/**
 * 永久道具的逐层支付账本：记录每次购买实际支付的金币，
 * 出售时按最近一次购买回收，免费奖励层没有记录、售价为 0。
 * 只记录商店购买，不复制层数（层数以 `ItemInventory` 为唯一真源）。
 */
export class ItemPaymentLedger {
  private readonly payments = new Map<string, number[]>();

  /** 记录一层购买的实际支付；负数与非法值忽略。 */
  record(itemId: string, paid: number): void {
    if (!Number.isFinite(paid) || paid < 0) return;
    const list = this.payments.get(itemId) ?? [];
    list.push(Math.floor(paid));
    this.payments.set(itemId, list);
  }

  /** 最近一次购买的实际支付；没有记录（免费奖励）为 0。不消费记录。 */
  peekLatest(itemId: string): number {
    const list = this.payments.get(itemId);
    return list && list.length > 0 ? (list[list.length - 1] as number) : 0;
  }

  /** 出售成功后消费一条支付记录，返回该层实际支付；免费层为 0。 */
  consumeLatest(itemId: string): number {
    const list = this.payments.get(itemId);
    if (!list || list.length === 0) return 0;
    const paid = list.pop() as number;
    if (list.length === 0) this.payments.delete(itemId);
    return paid;
  }

  /**
   * 只保留最近 `maxCount` 条支付记录。
   * 配方消耗或其他非出售途径移除层数后调用：已消耗的层不能再退款，
   * 支付账本也不应出现多于现存层数的幽灵条目。
   */
  trimTo(itemId: string, maxCount: number): void {
    const list = this.payments.get(itemId);
    if (!list) return;
    const keep = Number.isFinite(maxCount) ? Math.max(0, Math.floor(maxCount)) : 0;
    if (list.length > keep) {
      list.splice(0, list.length - keep);
    }
    if (list.length === 0) this.payments.delete(itemId);
  }

  /** 某件道具仍登记在案的支付层数；开发快照与出售校验用。 */
  countOf(itemId: string): number {
    return this.payments.get(itemId)?.length ?? 0;
  }

  /** 最近 `count` 层的实付合计；count 超过记录数时按全部记录求和。 */
  sumLatest(itemId: string, count: number): number {
    const list = this.payments.get(itemId);
    if (!list) return 0;
    const keep = Math.min(list.length, Math.max(0, Math.floor(count)));
    let total = 0;
    for (let index = list.length - keep; index < list.length; index += 1) {
      total += list[index] as number;
    }
    return total;
  }

  /** 清空某件道具的全部支付记录（整件出售后调用）。 */
  clear(itemId: string): void {
    this.payments.delete(itemId);
  }

  /** 逐层支付快照；开发快照与测试用。 */
  snapshot(): { id: string; paid: readonly number[] }[] {
    return [...this.payments.entries()].map(([id, paid]) => ({
      id,
      paid: [...paid],
    }));
  }

  /**
   * 从快照恢复逐层支付账本（刷新续局）。非法条目被忽略，
   * 已售出/配方消耗后残留的多余记录仍由 `trimTo` 在出售时裁剪。
   */
  restore(entries: readonly { id: string; paid: readonly number[] }[] | null | undefined): void {
    this.payments.clear();
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue;
      if (typeof entry.id !== 'string' || !Array.isArray(entry.paid)) continue;
      if (this.payments.has(entry.id)) continue;
      const values: readonly unknown[] = entry.paid;
      const paid = values
        .filter(
          (value): value is number =>
            typeof value === 'number' && Number.isFinite(value) && value >= 0,
        )
        .map((value) => Math.floor(value));
      if (paid.length > 0) this.payments.set(entry.id, paid);
    }
  }

  reset(): void {
    this.payments.clear();
  }
}

export type ShopTradeFailureReason =
  | 'unknown-slot'
  | 'already-sold'
  | 'insufficient-gold'
  | 'item-full'
  | 'unsupported-kind'
  | 'delivery-failed'
  | 'not-owned'
  | 'not-sellable'
  | 'no-material-supply'
  | 'shop-unavailable';

export interface ShopTradeFailure {
  readonly ok: false;
  readonly reason: ShopTradeFailureReason;
  /** 距离可购买还差多少金币；其他失败为 0。 */
  readonly shortfall: number;
  readonly gold: number;
}

export interface ShopPurchaseCheck {
  readonly ok: true;
  readonly offer: ShopOffer;
  readonly price: number;
  readonly shortfall: 0;
}

export interface ShopPurchaseSuccess {
  readonly ok: true;
  readonly offer: ShopOffer;
  readonly price: number;
  readonly goldBefore: number;
  readonly goldAfter: number;
  /** 购买后的层数；技能/药剂等非永久道具为 null。 */
  readonly stacksAfter: number | null;
}

export type ShopPurchaseResult =
  | ShopPurchaseSuccess
  | (ShopTradeFailure & { readonly offer?: undefined });

export interface ShopRerollSuccess {
  readonly ok: true;
  readonly cost: number;
  readonly goldBefore: number;
  readonly goldAfter: number;
  readonly rerollCount: number;
}

export type ShopRerollResult =
  | ShopRerollSuccess
  | (ShopTradeFailure & { readonly cost?: undefined });

export interface ShopSellSuccess {
  readonly ok: true;
  readonly itemId: string;
  readonly paid: number;
  readonly refund: number;
  readonly goldBefore: number;
  readonly goldAfter: number;
  readonly remainingStacks: number;
}

/** 可出售性检查：不扣款、不改状态，供按钮禁用与售价显示使用。 */
export interface ShopSellCheck {
  readonly ok: true;
  readonly itemId: string;
  /** 本次将出售的层数；整件出售等于当前层数。 */
  readonly layers: number;
  /** 这些层的实付金币合计。 */
  readonly paid: number;
  readonly refund: number;
  /** 出售前的层数。 */
  readonly stacks: number;
}

export type ShopSellResult =
  | ShopSellSuccess
  | (ShopTradeFailure & { readonly itemId?: undefined });

/** P01 常驻按钮的购买结果；不入货架、不标记售出，可在同一商店重复购买。 */
export interface ShopEmergencyPotionPurchaseSuccess {
  readonly ok: true;
  readonly potionId: string;
  readonly price: number;
  readonly goldBefore: number;
  readonly goldAfter: number;
}

export type ShopEmergencyPotionPurchaseResult =
  | ShopEmergencyPotionPurchaseSuccess
  | (ShopTradeFailure & { readonly potionId?: undefined });

/** 配方缺件供给的购买结果；不占货架格、不参与锁定与重抽。 */
export interface ShopMaterialSupplyPurchaseSuccess {
  readonly ok: true;
  readonly itemId: string;
  readonly recipeId: string;
  readonly price: number;
  readonly goldBefore: number;
  readonly goldAfter: number;
  readonly stacksAfter: number;
}

export type ShopMaterialSupplyPurchaseResult =
  | ShopMaterialSupplyPurchaseSuccess
  | (ShopTradeFailure & { readonly itemId?: undefined });

export interface ShopSessionOptions {
  readonly shelf: ShopShelf;
  readonly gold: ShopGoldLedger;
  readonly inventory: ShopItemInventory;
  /** 跨商店共享的支付账本；缺省为本会话新建。 */
  readonly payments?: ItemPaymentLedger;
  /**
   * 成品 R06 命运交易所的经济加成；缺省视为未拥有。
   * 免费重抽按本会话（= 一个商店）计数，首购折扣跨商店共享一次性状态。
   */
  readonly crafted?: ShopCraftedEconomy;
  /**
   * 自定义发货；返回 false 表示发货失败，整笔购买回滚。
   * 缺省只处理永久道具并写入 `inventory`。
   */
  readonly deliver?: (offer: ShopOffer) => boolean;
  /** 允许交易的品类；缺省有自定义发货时为全部，否则仅永久道具。 */
  readonly supportedKinds?: readonly ShopOfferKind[];
  /**
   * P01 常驻按钮的发货入口；缺省时购买返回 `unsupported-kind`。
   * 与货架药剂共用消耗品效果，但 P01 不占货架、不标记售出。
   */
  readonly deliverEmergencyPotion?: (potionId: string) => boolean;
  /**
   * 配方缺件供给的发货入口；缺省写入 `inventory`。
   * 缺件是永久道具，购买后与货架道具一样记入支付账本。
   */
  readonly deliverMaterialSupply?: (itemId: string) => boolean;
  /**
   * 可出售的商品 ID；核心、配方成品与未知 ID 由调用方在这里排除。
   * 缺省允许出售库存中的所有条目。
   */
  readonly isSellable?: (itemId: string) => boolean;
  /** 续局恢复：本商店已经用掉的 R06 免费重抽次数；缺省 0。 */
  readonly freeRerollsUsed?: number;
}

/**
 * R06 命运交易所提供给商店会话的经济加成（结构接口，避免纯交易层依赖成品模块）。
 * `firstItemDiscountPercent` 只读，`consumeFirstItemDiscount` 在成交成功后消费一次；
 * 免费重抽由本会话自行计数，每个商店重新创建会话时自然重置。
 */
export interface ShopCraftedEconomy {
  readonly freeRerollsPerShop: number;
  firstItemDiscountPercent(): number;
  consumeFirstItemDiscount(): number;
}

function failure(
  reason: ShopTradeFailureReason,
  gold: number,
  shortfall = 0,
): ShopTradeFailure {
  return { ok: false, reason, shortfall, gold };
}

/**
 * 单个商店的交易会话：购买、重抽、锁定与出售。
 * 所有会改金币的操作都先校验再提交；发货或标记失败时把金币原样退回。
 */
export class ShopSession {
  readonly shelf: ShopShelf;
  private readonly gold: ShopGoldLedger;
  private readonly inventory: ShopItemInventory;
  readonly payments: ItemPaymentLedger;
  private readonly deliver: (offer: ShopOffer) => boolean;
  private readonly deliverEmergencyPotion: ((potionId: string) => boolean) | null;
  private readonly deliverMaterialSupply: (itemId: string) => boolean;
  private readonly supportedKinds: ReadonlySet<ShopOfferKind>;
  private readonly isSellable: (itemId: string) => boolean;
  private readonly crafted: ShopCraftedEconomy | null;
  /** 本商店已用掉的免费重抽次数（R06）。 */
  private freeRerollsUsed = 0;

  /** 本商店已用掉的免费重抽次数；写入续局快照，刷新后不恢复免费次数。 */
  get usedFreeRerolls(): number {
    return this.freeRerollsUsed;
  }

  constructor(options: ShopSessionOptions) {
    this.shelf = options.shelf;
    this.gold = options.gold;
    this.inventory = options.inventory;
    this.payments = options.payments ?? new ItemPaymentLedger();
    this.crafted = options.crafted ?? null;
    this.deliver =
      options.deliver ??
      ((offer) =>
        offer.kind === 'item' && this.inventory.acquire(offer.id));
    this.deliverEmergencyPotion = options.deliverEmergencyPotion ?? null;
    this.deliverMaterialSupply =
      options.deliverMaterialSupply ?? ((itemId) => this.inventory.acquire(itemId));
    this.supportedKinds = new Set(
      options.supportedKinds ??
        (options.deliver ? ['item', 'skill', 'potion'] : ['item']),
    );
    this.isSellable = options.isSellable ?? (() => true);
    this.freeRerollsUsed =
      Number.isInteger(options.freeRerollsUsed) && (options.freeRerollsUsed as number) >= 0
        ? (options.freeRerollsUsed as number)
        : 0;
  }

  /** 下一次重抽的实际费用；R06 免费次数未用完时为 0。 */
  get nextRerollCost(): number {
    return this.freeRerollAvailable ? 0 : this.shelf.rerollCost;
  }

  /** R06 本商店是否还有免费重抽。 */
  get freeRerollAvailable(): boolean {
    if (!this.crafted) return false;
    return this.freeRerollsUsed < this.crafted.freeRerollsPerShop;
  }

  /** R06 一次性首购折扣是否仍可用（只读，不消费）。 */
  get firstItemDiscountAvailable(): boolean {
    return (this.crafted?.firstItemDiscountPercent() ?? 0) > 0;
  }

  /**
   * 永久道具的本次实际价格：R06 首购折扣只在第一次成交时生效。
   * 折扣经 `applyShopPriceModifiers` 计算，最终价至少 1 金币。
   */
  private itemPrice(price: number): number {
    const percent = this.crafted?.firstItemDiscountPercent() ?? 0;
    if (percent <= 0) return price;
    return applyShopPriceModifiers(price, { discountPercent: percent });
  }

  /**
   * 某个货架商品当前的实际成交价（含 R06 首购折扣）。
   * 供正式商店界面（US-046）与开发快照显示，不改变任何状态。
   */
  effectivePrice(offer: ShopOffer): number {
    return offer.kind === 'item' ? this.itemPrice(offer.price) : offer.price;
  }

  /**
   * 本商店缺件供给的实际成交价（含 R06 首购折扣）。
   * 没有缺件供给时返回 0；面板用它显示差额与禁用态，不改变状态。
   */
  effectiveMaterialSupplyPrice(): number {
    const supply = this.shelf.materialSupply;
    return supply ? this.itemPrice(supply.price) : 0;
  }

  /** 可购买性检查：不扣款、不改状态，供按钮禁用与差额显示使用。 */
  canPurchase(slot: number): ShopPurchaseCheck | ShopTradeFailure {
    const offer = this.shelf.offers.find((entry) => entry.slot === slot);
    if (!offer) return failure('unknown-slot', this.gold.gold);
    if (offer.sold) return failure('already-sold', this.gold.gold);
    if (!this.supportedKinds.has(offer.kind)) {
      return failure('unsupported-kind', this.gold.gold);
    }
    if (offer.kind === 'item' && this.inventory.isFull(offer.id)) {
      return failure('item-full', this.gold.gold);
    }
    const price = offer.kind === 'item' ? this.itemPrice(offer.price) : offer.price;
    const shortfall = Math.max(0, price - this.gold.gold);
    if (shortfall > 0) {
      return failure('insufficient-gold', this.gold.gold, shortfall);
    }
    return { ok: true, offer, price, shortfall: 0 };
  }

  /**
   * 购买一格商品。成功后扣款并发货；发货失败、标记售出失败都全额退款。
   * 重复确认同一格只会得到 `already-sold`，不会重复扣款或发货。
   */
  purchase(slot: number): ShopPurchaseResult {
    const check = this.canPurchase(slot);
    if (!check.ok) return check;
    const { offer, price } = check;
    const goldBefore = this.gold.gold;
    if (!this.gold.spendGold(price)) {
      return failure(
        'insufficient-gold',
        this.gold.gold,
        Math.max(0, price - this.gold.gold),
      );
    }

    if (!this.deliver(offer)) {
      this.gold.addGold(price);
      return failure('delivery-failed', this.gold.gold);
    }

    if (!this.shelf.markSold(slot)) {
      this.gold.addGold(price);
      if (offer.kind === 'item') this.inventory.release(offer.id);
      return failure('already-sold', this.gold.gold);
    }

    // R06：首购折扣只在真正成交后消费，失败分支不会吃掉这一次机会。
    if (offer.kind === 'item' && price < offer.price) {
      this.crafted?.consumeFirstItemDiscount();
    }

    if (offer.kind === 'item') this.payments.record(offer.id, price);
    return {
      ok: true,
      offer,
      price,
      goldBefore,
      goldAfter: this.gold.gold,
      stacksAfter:
        offer.kind === 'item' ? this.inventory.stacksOf(offer.id) : null,
    };
  }

  /**
   * 购买常驻的 P01 应急药剂：不占货架格、不标记售出，可重复购买。
   * 扣款成功后调用 `deliverEmergencyPotion`；发货失败全额退款。
   */
  purchaseEmergencyPotion(): ShopEmergencyPotionPurchaseResult {
    const potion = this.shelf.emergencyPotion;
    if (!this.deliverEmergencyPotion) {
      return failure('unsupported-kind', this.gold.gold);
    }
    const price = potion.price;
    const shortfall = Math.max(0, price - this.gold.gold);
    if (shortfall > 0) {
      return failure('insufficient-gold', this.gold.gold, shortfall);
    }
    const goldBefore = this.gold.gold;
    if (!this.gold.spendGold(price)) {
      return failure(
        'insufficient-gold',
        this.gold.gold,
        Math.max(0, price - this.gold.gold),
      );
    }
    if (!this.deliverEmergencyPotion(potion.id)) {
      this.gold.addGold(price);
      return failure('delivery-failed', this.gold.gold);
    }
    return {
      ok: true,
      potionId: potion.id,
      price,
      goldBefore,
      goldAfter: this.gold.gold,
    };
  }

  /**
   * 购买追踪配方的缺件供给：正常价格扣款，成功发货后标记已购买。
   * 不占五格、不参与锁定/重抽；发货或标记失败时金币与层数全额回滚。
   */
  purchaseMaterialSupply(): ShopMaterialSupplyPurchaseResult {
    const supply = this.shelf.materialSupply;
    if (!supply) return failure('no-material-supply', this.gold.gold);
    if (supply.sold) return failure('already-sold', this.gold.gold);
    if (this.inventory.isFull(supply.id)) {
      return failure('item-full', this.gold.gold);
    }
    const price = this.itemPrice(supply.price);
    const shortfall = Math.max(0, price - this.gold.gold);
    if (shortfall > 0) {
      return failure('insufficient-gold', this.gold.gold, shortfall);
    }
    const goldBefore = this.gold.gold;
    if (!this.gold.spendGold(price)) {
      return failure(
        'insufficient-gold',
        this.gold.gold,
        Math.max(0, price - this.gold.gold),
      );
    }
    if (!this.deliverMaterialSupply(supply.id)) {
      this.gold.addGold(price);
      return failure('delivery-failed', this.gold.gold);
    }
    if (!this.shelf.markMaterialSupplySold()) {
      this.inventory.release(supply.id);
      this.gold.addGold(price);
      return failure('already-sold', this.gold.gold);
    }
    if (price < supply.price) this.crafted?.consumeFirstItemDiscount();
    this.payments.record(supply.id, price);
    return {
      ok: true,
      itemId: supply.id,
      recipeId: supply.recipeId,
      price,
      goldBefore,
      goldAfter: this.gold.gold,
      stacksAfter: this.inventory.stacksOf(supply.id),
    };
  }

  /** 重抽未锁定商品：先校验金币再扣款，不足时货架与金币都不变。 */
  reroll(): ShopRerollResult {
    const cost = this.nextRerollCost;
    const free = this.freeRerollAvailable;
    const shortfall = Math.max(0, cost - this.gold.gold);
    if (shortfall > 0) {
      return failure('insufficient-gold', this.gold.gold, shortfall);
    }
    const goldBefore = this.gold.gold;
    // 费用为 0 时 `spendGold(0)` 会按非法金额拒绝，免费重抽直接提交。
    if (cost > 0 && !this.gold.spendGold(cost)) {
      return failure(
        'insufficient-gold',
        this.gold.gold,
        Math.max(0, cost - this.gold.gold),
      );
    }
    try {
      this.shelf.reroll();
    } catch (error) {
      if (cost > 0) this.gold.addGold(cost);
      throw error;
    }
    if (free) this.freeRerollsUsed += 1;
    return {
      ok: true,
      cost,
      goldBefore,
      goldAfter: this.gold.gold,
      rerollCount: this.shelf.rerollCount,
    };
  }

  /**
   * 可出售性检查：不扣款、不改层数，供出售按钮禁用与回收金额显示使用。
   * 默认整件出售（全部层数）；核心、配方成品等非永久道具由 `isSellable` 拒绝，
   * 未知/未拥有条目返回 `not-owned`。
   */
  canSell(itemId: string): ShopSellCheck | ShopTradeFailure {
    return this.checkSell(itemId, null);
  }

  /** 单层出售的可售性检查；`paid` 只累计将卖出的那一层。 */
  canSellLayer(itemId: string): ShopSellCheck | ShopTradeFailure {
    return this.checkSell(itemId, 1);
  }

  private checkSell(
    itemId: string,
    layers: number | null,
  ): ShopSellCheck | ShopTradeFailure {
    if (!this.isSellable(itemId)) {
      return failure('not-sellable', this.gold.gold);
    }
    const stacks = this.inventory.stacksOf(itemId);
    if (stacks <= 0) {
      return failure('not-owned', this.gold.gold);
    }
    const sellCount =
      layers === null ? stacks : Math.min(stacks, Math.max(1, Math.floor(layers)));
    const paid = this.payments.sumLatest(itemId, sellCount);
    return {
      ok: true,
      itemId,
      layers: sellCount,
      paid,
      refund: shopSellPrice(paid),
      stacks,
    };
  }

  /**
   * 整件出售永久道具：移除该件及其全部层数的正负效果由调用方按剩余层数重算，
   * 回收该件实际支付金币合计的 40% 向下取整；免费奖励层没有支付记录，售价 0。
   *
   * 出售前把支付账本裁剪到现存层数：配方消耗或其他途径已移除的层
   * 不会再留下可退款的幽灵记录，回收总额不会超过实付的 40%。
   */
  sell(itemId: string): ShopSellResult {
    return this.sellLayers(itemId, null);
  }

  /** 单层出售（保留 US-022 的逐层能力）；回收该层实付的 40%。 */
  sellLayer(itemId: string): ShopSellResult {
    return this.sellLayers(itemId, 1);
  }

  private sellLayers(itemId: string, layers: number | null): ShopSellResult {
    const check = this.checkSell(itemId, layers);
    if (!check.ok) return check;

    this.payments.trimTo(itemId, check.stacks);
    let released = 0;
    while (released < check.layers && this.inventory.release(itemId)) {
      released += 1;
    }
    if (released <= 0) {
      return failure('not-owned', this.gold.gold);
    }
    // 极端情况下层数账本提前少了一层：按实际移除的层退款并保持账本同步。
    const paidForSold = this.payments.sumLatest(itemId, released);
    for (let index = 0; index < released; index += 1) {
      this.payments.consumeLatest(itemId);
    }
    const refund = shopSellPrice(paidForSold);
    const goldBefore = this.gold.gold;
    if (refund > 0) this.gold.addGold(refund);
    return {
      ok: true,
      itemId,
      paid: paidForSold,
      refund,
      goldBefore,
      goldAfter: this.gold.gold,
      remainingStacks: this.inventory.stacksOf(itemId),
    };
  }

  /** 免费锁定一格；未知格或已售出格返回 false。 */
  lock(slot: number): boolean {
    return this.shelf.lock(slot);
  }

  unlock(): void {
    this.shelf.unlock();
  }

  /** 下一商店应保留的锁定条目；没有锁定为 null。 */
  carryLock() {
    return this.shelf.lockedOffer;
  }
}

/**
 * 键盘长按闸门：同一按键在 keyUp 前只接受第一次 keydown。
 * 浏览器长按会持续派发 `repeat=true` 的 keydown，商店的 Enter 购买/确认
 * 必须经过这里，避免一次长按连续购买或重复确认。
 */
export class ShopKeyGate {
  private readonly held = new Set<string>();

  /** 返回 true 表示本次按下应被处理；长按重复与已按住都返回 false。 */
  keyDown(code: string, repeat = false): boolean {
    if (repeat || this.held.has(code)) return false;
    this.held.add(code);
    return true;
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  reset(): void {
    this.held.clear();
  }
}
