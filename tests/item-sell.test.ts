import { describe, expect, it } from 'vitest';
import { HealthState } from '../src/game/combat';
import { getCharacter } from '../src/game/data';
import { EconomyLedger } from '../src/game/economy';
import { ItemInventory } from '../src/game/item-inventory';
import {
  ITEM_EFFECT_IDS,
  ItemEffects,
  itemStatModifiers,
} from '../src/game/item-effects';
import { SeededRandom } from '../src/game/random';
import { ShopShelf, type ShopOffer } from '../src/game/shop-offer';
import {
  ItemPaymentLedger,
  ShopSession,
  shopSellPrice,
} from '../src/game/shop-transaction';
import { StatAggregator, characterBaseStats } from '../src/game/stats';

const BASE = getCharacter('vishdal');

interface BuildHarness {
  readonly inventory: ItemInventory;
  readonly stats: StatAggregator;
  readonly effects: ItemEffects;
  readonly health: HealthState;
  /** 按当前层数重算属性来源，并把最大生命同步到生命状态（与场景一致）。 */
  readonly refresh: () => void;
}

function makeBuild(inventory = new ItemInventory()): BuildHarness {
  const stats = new StatAggregator(characterBaseStats(BASE));
  const effects = new ItemEffects({
    stacksOf: (itemId) => inventory.stacksOf(itemId),
  });
  const health = new HealthState({
    maxHealth: BASE.maxHealth,
    armor: BASE.armor,
    magicResist: BASE.magicResist,
  });
  const refresh = (): void => {
    for (const itemId of ITEM_EFFECT_IDS) {
      stats.setSource(`item:${itemId}`, itemStatModifiers(itemId, inventory.stacksOf(itemId)));
    }
    health.setDefenses(stats.armor, stats.magicResist);
    health.setMaxHealth(stats.maxHealth);
  };
  refresh();
  return { inventory, stats, effects, health, refresh };
}

function makeSession(
  inventory: ItemInventory,
  economy: EconomyLedger,
  payments = new ItemPaymentLedger(),
): ShopSession {
  const random = new SeededRandom(7);
  const shelf = new ShopShelf(() => random.next(), {
    shopWave: 1,
    characterId: 'vishdal',
    stacksOf: (itemId) => inventory.stacksOf(itemId),
  });
  return new ShopSession({ shelf, gold: economy, inventory, payments });
}

/** 找一个能抽到指定道具的固定种子货架，供真实购买路径使用。 */
function shelfWithItem(
  itemId: string,
  inventory: ItemInventory,
): { shelf: ShopShelf; offer: ShopOffer; session: ShopSession; economy: EconomyLedger } {
  const economy = new EconomyLedger();
  economy.restore(1000);
  for (let seed = 1; seed <= 2000; seed += 1) {
    const random = new SeededRandom(seed);
    const shelf = new ShopShelf(() => random.next(), {
      shopWave: 1,
      characterId: 'vishdal',
      stacksOf: (id) => inventory.stacksOf(id),
    });
    const offer = shelf.offers.find(
      (entry) => entry.kind === 'item' && entry.id === itemId,
    );
    if (!offer) continue;
    const session = new ShopSession({ shelf, gold: economy, inventory });
    return { shelf, offer, session, economy };
  }
  throw new Error(`没有种子在首商店抽到 ${itemId}`);
}

describe('出售移除正负效果', () => {
  it('逐件出售：该件收益与代价一起撤销，其他道具不受影响', () => {
    const build = makeBuild();
    const economy = new EconomyLedger();
    economy.restore(500);
    const session = makeSession(build.inventory, economy);

    build.inventory.acquire('I01');
    build.inventory.acquire('I06');
    build.refresh();
    expect(build.stats.maxHealth).toBe(BASE.maxHealth + 25);
    expect(build.stats.armor).toBe(BASE.armor + 12);
    expect(build.stats.attackSpeedMultiplier).toBeLessThan(1);

    const soldI01 = session.sell('I01');
    expect(soldI01.ok).toBe(true);
    build.effects.onItemRemoved('I01');
    build.refresh();
    // I01 的最大生命收益与移速代价一起移除；I06 仍保留。
    expect(build.stats.maxHealth).toBe(BASE.maxHealth);
    expect(build.stats.armor).toBe(BASE.armor + 12);
    expect(build.stats.attackSpeedMultiplier).toBeLessThan(1);

    const soldI06 = session.sell('I06');
    expect(soldI06.ok).toBe(true);
    build.effects.onItemRemoved('I06');
    build.refresh();
    expect(build.stats.armor).toBe(BASE.armor);
    expect(build.stats.attackSpeedMultiplier).toBe(1);
  });

  it('整件出售多层：一次移除该件全部层数的收益并把当前生命钳制到新上限', () => {
    const build = makeBuild();
    build.inventory.acquire('I01');
    build.inventory.acquire('I01');
    build.inventory.acquire('I01');
    build.refresh();
    expect(build.stats.maxHealth).toBe(BASE.maxHealth + 75);
    build.health.restoreHealth(BASE.maxHealth + 75, BASE.maxHealth + 75);

    const economy = new EconomyLedger();
    economy.restore(500);
    const session = makeSession(build.inventory, economy);
    const sold = session.sell('I01');
    expect(sold.ok).toBe(true);
    build.effects.onItemRemoved('I01');
    build.refresh();
    expect(build.inventory.stacksOf('I01')).toBe(0);
    expect(build.stats.maxHealth).toBe(BASE.maxHealth);
    expect(build.health.maxHealth).toBe(BASE.maxHealth);
    expect(build.health.health).toBe(BASE.maxHealth);
  });

  it('单层出售只移除一层，收益按剩余层数收缩', () => {
    const build = makeBuild();
    build.inventory.acquire('I01');
    build.inventory.acquire('I01');
    build.inventory.acquire('I01');
    build.refresh();
    expect(build.stats.maxHealth).toBe(BASE.maxHealth + 75);

    const economy = new EconomyLedger();
    economy.restore(500);
    const session = makeSession(build.inventory, economy);
    const expected = [BASE.maxHealth + 50, BASE.maxHealth + 25, BASE.maxHealth];
    for (const nextMax of expected) {
      expect(session.sellLayer('I01').ok).toBe(true);
      build.effects.onItemRemoved('I01');
      build.refresh();
      expect(build.stats.maxHealth).toBe(nextMax);
      expect(build.health.maxHealth).toBe(nextMax);
    }
    expect(build.inventory.stacksOf('I01')).toBe(0);
  });

  it('最大生命降低时当前生命钳制到新上限，买卖不回复生命', () => {
    const build = makeBuild();
    const economy = new EconomyLedger();
    economy.restore(500);
    const session = makeSession(build.inventory, economy);

    // I08 的代价是最大生命 -10：获得时上限下降，当前生命被钳制。
    build.inventory.acquire('I08');
    build.refresh();
    expect(build.stats.maxHealth).toBe(BASE.maxHealth - 10);
    expect(build.health.maxHealth).toBe(BASE.maxHealth - 10);
    expect(build.health.health).toBe(BASE.maxHealth - 10);

    // 出售（免费来源，金币不变）把上限还原，但不会补回被钳制的 10 点生命。
    const goldBefore = economy.gold;
    const sold = session.sell('I08');
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(sold.refund).toBe(0);
    build.effects.onItemRemoved('I08');
    build.refresh();
    expect(build.stats.maxHealth).toBe(BASE.maxHealth);
    expect(build.health.maxHealth).toBe(BASE.maxHealth);
    expect(build.health.health).toBe(BASE.maxHealth - 10);
    expect(economy.gold).toBe(goldBefore);

    // I08 已在上一段卖出，此时只剩 I01：上限 = 基础 + 25，当前生命仍为被钳制值。
    build.inventory.acquire('I01');
    build.refresh();
    expect(build.health.maxHealth).toBe(BASE.maxHealth + 25);
    expect(build.health.health).toBe(BASE.maxHealth - 10);
    expect(session.sell('I01').ok).toBe(true);
    build.effects.onItemRemoved('I01');
    build.refresh();
    expect(build.health.health).toBe(BASE.maxHealth - 10);
  });

  it('卖出后再买回同一件：金币严格减少，反复循环不增值也不回血', () => {
    const inventory = new ItemInventory();
    const build = makeBuild(inventory);
    const goldStart = 1000;
    const healthStart = build.health.health;

    let previousGold = goldStart;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const { offer, session, economy } = shelfWithItem('I01', inventory);
      economy.restore(previousGold);
      const goldBeforeBuy = economy.gold;
      const maxBefore = build.stats.maxHealth;
      const purchase = session.purchase(offer.slot);
      expect(purchase.ok).toBe(true);
      build.refresh();
      // 购买只提高上限，当前生命不变。
      expect(build.stats.maxHealth).toBe(maxBefore + 25);
      expect(build.health.health).toBe(healthStart);
      expect(economy.gold).toBeLessThan(goldBeforeBuy);

      const sold = session.sell('I01');
      expect(sold.ok).toBe(true);
      if (!sold.ok) return;
      expect(sold.refund).toBe(shopSellPrice(offer.price));
      build.effects.onItemRemoved('I01');
      build.refresh();
      // 卖出只钳制当前生命，绝不治疗；金币净减少 60%。
      expect(build.health.health).toBe(healthStart);
      expect(build.health.maxHealth).toBe(maxBefore);
      expect(economy.gold).toBeLessThan(goldBeforeBuy);
      expect(economy.gold).toBe(goldBeforeBuy - (offer.price - sold.refund));
      previousGold = economy.gold;
    }
    expect(previousGold).toBeLessThan(goldStart);
  });
});

describe('出售后的临时状态清理', () => {
  it('层数归零时清掉 I18 蓄势、I21 命中与 I23 护盾，并返回需移除的护盾量', () => {
    const build = makeBuild();
    const economy = new EconomyLedger();
    economy.restore(500);
    const session = makeSession(build.inventory, economy);

    build.inventory.acquire('I18');
    build.inventory.acquire('I21');
    build.inventory.acquire('I23');
    expect(build.effects.notifyEnemyHit()).toBe(true);
    expect(build.effects.isNextJBonusArmed).toBe(true);
    build.effects.registerJHit();
    build.effects.registerJHit();
    expect(build.effects.jHitCount).toBe(2);
    expect(build.effects.tryTriggerLowHealthShield(1, 100)).toBe(35);
    expect(build.effects.lowHealthShieldAmount).toBe(35);

    expect(session.sell('I18').ok).toBe(true);
    expect(build.effects.onItemRemoved('I18')).toBe(0);
    expect(build.effects.isNextJBonusArmed).toBe(false);

    expect(session.sell('I21').ok).toBe(true);
    build.effects.onItemRemoved('I21');
    expect(build.effects.jHitCount).toBe(0);

    expect(session.sell('I23').ok).toBe(true);
    expect(build.effects.onItemRemoved('I23')).toBe(35);
    expect(build.effects.lowHealthShieldAmount).toBe(0);
    expect(build.effects.lowHealthShieldRemainingSeconds).toBe(0);
  });

  it('仍持有剩余层数时不清理临时状态', () => {
    const build = makeBuild();
    build.inventory.acquire('I18');
    expect(build.effects.notifyEnemyHit()).toBe(true);
    // 仍持有 1 层 I18：蓄势保留，只有层数归零才清理。
    expect(build.effects.onItemRemoved('I18')).toBe(0);
    expect(build.effects.isNextJBonusArmed).toBe(true);
    build.inventory.release('I18');
    expect(build.effects.onItemRemoved('I18')).toBe(0);
    expect(build.effects.isNextJBonusArmed).toBe(false);
  });
});
