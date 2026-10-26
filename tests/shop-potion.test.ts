import { describe, expect, it } from 'vitest';
import { EconomyLedger } from '../src/game/economy';
import { ItemInventory } from '../src/game/item-inventory';
import { SeededRandom } from '../src/game/random';
import {
  SHOP_POTION_SLOT,
  ShopShelf,
  type ShopDrawState,
} from '../src/game/shop-offer';
import { ShopSession } from '../src/game/shop-transaction';

function state(
  overrides: Partial<ShopDrawState> = {},
): ShopDrawState {
  return {
    shopWave: 3,
    characterId: 'vishdal',
    stacksOf: () => 0,
    potionOverride: 'P03',
    ...overrides,
  };
}

function makeSession(options: {
  readonly gold?: number;
  readonly state?: ShopDrawState;
  readonly deliverPotion?: (potionId: string) => boolean;
  readonly deliverEmergency?: (potionId: string) => boolean;
} = {}) {
  const random = new SeededRandom(20261023);
  const shelf = new ShopShelf(() => random.next(), options.state ?? state());
  const economy = new EconomyLedger();
  economy.restore(options.gold ?? 100);
  const inventory = new ItemInventory();
  const deliveredPotionIds: string[] = [];
  const deliveredEmergencyIds: string[] = [];
  const session = new ShopSession({
    shelf,
    gold: economy,
    inventory,
    deliver: (offer) => {
      if (offer.kind !== 'potion') return false;
      deliveredPotionIds.push(offer.id);
      return options.deliverPotion ? options.deliverPotion(offer.id) : true;
    },
    supportedKinds: ['item', 'potion'],
    deliverEmergencyPotion: (potionId) => {
      deliveredEmergencyIds.push(potionId);
      return options.deliverEmergency
        ? options.deliverEmergency(potionId)
        : true;
    },
  });
  return { shelf, economy, session, deliveredPotionIds, deliveredEmergencyIds };
}

describe('货架药剂购买', () => {
  it('购买药剂格扣款、发货并标记已售出，不能再次购买', () => {
    const { shelf, economy, session, deliveredPotionIds } = makeSession();
    const offer = shelf.offers.find(
      (entry) => entry.slot === SHOP_POTION_SLOT,
    );
    expect(offer?.id).toBe('P03');
    const price = offer?.price ?? 0;
    const before = economy.gold;

    const result = session.purchase(SHOP_POTION_SLOT);
    expect(result.ok).toBe(true);
    expect(economy.gold).toBe(before - price);
    expect(deliveredPotionIds).toEqual(['P03']);
    expect(
      shelf.offers.find((entry) => entry.slot === SHOP_POTION_SLOT)?.sold,
    ).toBe(true);

    const again = session.purchase(SHOP_POTION_SLOT);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('already-sold');
    expect(economy.gold).toBe(before - price);
    expect(deliveredPotionIds).toEqual(['P03']);
  });

  it('发货失败全额退款，药剂格保持未售出', () => {
    const { shelf, economy, session } = makeSession({
      deliverPotion: () => false,
    });
    const before = economy.gold;
    const result = session.purchase(SHOP_POTION_SLOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('delivery-failed');
    expect(economy.gold).toBe(before);
    expect(
      shelf.offers.find((entry) => entry.slot === SHOP_POTION_SLOT)?.sold,
    ).toBe(false);
  });

  it('没有药剂发货入口时返回 unsupported-kind 且不扣款', () => {
    const random = new SeededRandom(7);
    const shelf = new ShopShelf(() => random.next(), state());
    const economy = new EconomyLedger();
    economy.restore(100);
    const session = new ShopSession({
      shelf,
      gold: economy,
      inventory: new ItemInventory(),
    });
    const result = session.purchase(SHOP_POTION_SLOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-kind');
    expect(economy.gold).toBe(100);
  });
});

describe('P01 常驻药剂按钮', () => {
  it('同一商店可重复购买，每次都扣款并发货', () => {
    const { shelf, economy, session, deliveredEmergencyIds } = makeSession({
      gold: 100,
    });
    const price = shelf.emergencyPotion.price;
    const first = session.purchaseEmergencyPotion();
    const second = session.purchaseEmergencyPotion();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(deliveredEmergencyIds).toEqual(['P01', 'P01']);
    expect(economy.gold).toBe(100 - price * 2);
  });

  it('金币不足返回差额且不发货', () => {
    const { shelf, economy, session, deliveredEmergencyIds } = makeSession({
      gold: 10,
    });
    const result = session.purchaseEmergencyPotion();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('insufficient-gold');
      expect(result.shortfall).toBe(shelf.emergencyPotion.price - 10);
    }
    expect(deliveredEmergencyIds).toEqual([]);
    expect(economy.gold).toBe(10);
  });

  it('发货失败全额退款', () => {
    const { economy, session, deliveredEmergencyIds } = makeSession({
      gold: 100,
      deliverEmergency: () => false,
    });
    const result = session.purchaseEmergencyPotion();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('delivery-failed');
    expect(economy.gold).toBe(100);
    expect(deliveredEmergencyIds).toEqual(['P01']);
  });

  it('H23 的药剂价格 +15% 只应用一次', () => {
    const { shelf, session } = makeSession({
      gold: 100,
      state: state({ potionPriceModifiers: { surchargePercent: 15 } }),
    });
    // P01 基础价 18，第 3 商店基础波次价 19；+15% → 21.85 → 22。
    expect(shelf.emergencyPotion.price).toBe(22);
    const result = session.purchaseEmergencyPotion();
    expect(result.ok).toBe(true);
  });

  it('没有常驻发货入口时返回 unsupported-kind', () => {
    const random = new SeededRandom(11);
    const shelf = new ShopShelf(() => random.next(), state());
    const economy = new EconomyLedger();
    economy.restore(100);
    const session = new ShopSession({
      shelf,
      gold: economy,
      inventory: new ItemInventory(),
    });
    const result = session.purchaseEmergencyPotion();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-kind');
    expect(economy.gold).toBe(100);
  });
});
