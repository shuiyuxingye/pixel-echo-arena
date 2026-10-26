/**
 * 开发专用商店货架演示（纯逻辑，仅在 `?dev=1` 场景创建时调用）。
 *
 * 正式商店界面属于 US-046；本演示用固定的开发种子分别构造第 1/7/13 次商店，
 * 给 Validator 一份可直接断言的只读证据：
 * - 五格构成、品质权重与价格；
 * - P01 常驻独立按钮，重抽后价格不变；
 * - 售出格不自动补货，重抽后换货并清除售出状态；
 * - 重抽费用按次数递增。
 *
 * 演示使用独立的 `SeededRandom` 与货架实例，不读写本局金币、道具库存或
 * `RunRandomStreams`，也不提供购买/跳关/改数值入口。
 */
import { SeededRandom } from './random';
import {
  ShopShelf,
  type ShopOffer,
  type ShopRarityWeights,
} from './shop-offer';

/** 演示固定种子；与正式对局种子无关。 */
export const SHOP_DEMO_SEED = 20261021;

/** 演示覆盖三个品质档位对应的商店波次。 */
export const SHOP_DEMO_WAVES = [1, 7, 13] as const;

export interface ShopDemoOfferSnapshot {
  readonly slot: number;
  readonly kind: string;
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly sold: boolean;
  readonly rarity?: string;
}

export interface ShopDemoPotionSnapshot {
  readonly id: string;
  readonly name: string;
  readonly price: number;
}

export interface ShopDemoWaveReport {
  readonly shopWave: number;
  readonly weights: ShopRarityWeights;
  /** 初始货架；售出前。 */
  readonly offers: readonly ShopDemoOfferSnapshot[];
  readonly emergencyPotion: ShopDemoPotionSnapshot;
  readonly rerollCost: number;
  readonly rerollCount: number;
  /** 被标记售出的格与商品。 */
  readonly soldSlot: number;
  readonly soldOfferId: string;
  /** 标记售出后的整手状态：该格 sold=true，且商品未自动更换。 */
  readonly offersAfterSold: readonly ShopDemoOfferSnapshot[];
  /** 重抽后的整手状态：售出格换货且 sold=false。 */
  readonly offersAfterReroll: readonly ShopDemoOfferSnapshot[];
  readonly rerollCostAfter: number;
  readonly rerollCountAfter: number;
  readonly soldSlotAfterReroll: boolean;
  /** 重抽后的 P01：常驻按钮价格不变。 */
  readonly emergencyPotionAfterReroll: ShopDemoPotionSnapshot;
}

export interface ShopDemoReport {
  readonly seed: number;
  readonly waves: readonly ShopDemoWaveReport[];
  /** 商店没有倒计时；这是给浏览器的显式证据。 */
  readonly hasCountdown: boolean;
}

function snapshotOffers(offers: readonly ShopOffer[]): ShopDemoOfferSnapshot[] {
  return offers.map((offer) => ({
    slot: offer.slot,
    kind: offer.kind,
    id: offer.id,
    name: offer.name,
    price: offer.price,
    sold: offer.sold,
    ...(offer.rarity ? { rarity: offer.rarity } : {}),
  }));
}

function snapshotPotion(
  shelf: ShopShelf,
): ShopDemoPotionSnapshot {
  return {
    id: shelf.emergencyPotion.id,
    name: shelf.emergencyPotion.name,
    price: shelf.emergencyPotion.price,
  };
}

/**
 * 依次构造第 1/7/13 次商店：记录初始货架，标记首个道具格售出，
 * 再重抽一次并记录换货、售出清除与重抽费用递增。
 */
export function runShopDemo(seed = SHOP_DEMO_SEED): ShopDemoReport {
  const random = new SeededRandom(seed);
  const waves = SHOP_DEMO_WAVES.map((shopWave): ShopDemoWaveReport => {
    const shelf = new ShopShelf(() => random.next(), {
      shopWave,
      characterId: 'vishdal',
      stacksOf: () => 0,
    });
    const offers = snapshotOffers(shelf.offers);
    const emergencyPotion = snapshotPotion(shelf);
    const rerollCost = shelf.rerollCost;
    const rerollCount = shelf.rerollCount;

    const soldCandidate =
      shelf.offers.find((offer) => offer.kind === 'item') ??
      shelf.offers.find((offer) => !offer.sold);
    const soldSlot = soldCandidate?.slot ?? -1;
    const soldOfferId = soldCandidate?.id ?? '';
    const soldMarked = soldSlot >= 0 ? shelf.markSold(soldSlot) : false;
    const offersAfterSold = snapshotOffers(shelf.offers);

    shelf.reroll();
    const offersAfterReroll = snapshotOffers(shelf.offers);
    const rerolled = offersAfterReroll.find((offer) => offer.slot === soldSlot);

    return {
      shopWave,
      weights: { ...shelf.weights },
      offers,
      emergencyPotion,
      rerollCost,
      rerollCount,
      soldSlot,
      soldOfferId: soldMarked ? soldOfferId : '',
      offersAfterSold,
      offersAfterReroll,
      rerollCostAfter: shelf.rerollCost,
      rerollCountAfter: shelf.rerollCount,
      soldSlotAfterReroll: rerolled?.sold ?? false,
      emergencyPotionAfterReroll: snapshotPotion(shelf),
    };
  });

  return { seed, waves, hasCountdown: false };
}
