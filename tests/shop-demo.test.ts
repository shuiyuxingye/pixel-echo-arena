import { describe, expect, it } from 'vitest';
import { SHOP_DEMO_SEED, SHOP_DEMO_WAVES, runShopDemo } from '../src/game/shop-demo';
import { SHOP_EMERGENCY_POTION_ID, shopRerollCost } from '../src/game/shop-offer';

describe('开发商店演示', () => {
  it('覆盖第 1/7/13 次商店并固定种子可复现', () => {
    const report = runShopDemo();
    expect(report.seed).toBe(SHOP_DEMO_SEED);
    expect(report.waves.map((wave) => wave.shopWave)).toEqual([...SHOP_DEMO_WAVES]);
    expect(report.hasCountdown).toBe(false);
    expect(runShopDemo()).toEqual(report);
  });

  it('三个档位的五格构成、权重与 P01 常驻正确', () => {
    const expectedWeights = {
      1: { 普通: 80, 稀有: 20, 史诗: 0 },
      7: { 普通: 55, 稀有: 35, 史诗: 10 },
      13: { 普通: 35, 稀有: 45, 史诗: 20 },
    } as const;

    for (const wave of runShopDemo().waves) {
      expect(wave.weights).toEqual(
        expectedWeights[wave.shopWave as 1 | 7 | 13],
      );
      expect(wave.offers).toHaveLength(5);
      expect(wave.offers.filter((offer) => offer.kind === 'item')).toHaveLength(3);
      expect(wave.offers.filter((offer) => offer.kind === 'skill')).toHaveLength(1);
      expect(wave.offers.filter((offer) => offer.kind === 'potion')).toHaveLength(1);
      expect(wave.offers.some((offer) => offer.id === SHOP_EMERGENCY_POTION_ID)).toBe(
        false,
      );
      expect(wave.emergencyPotion.id).toBe(SHOP_EMERGENCY_POTION_ID);
      expect(wave.rerollCount).toBe(0);
      expect(wave.rerollCost).toBe(shopRerollCost(wave.shopWave, 0));
    }
  });

  it('售出格保留已售出且不自动补货，重抽才换货', () => {
    for (const wave of runShopDemo().waves) {
      const soldBefore = wave.offersAfterSold.find(
        (offer) => offer.slot === wave.soldSlot,
      );
      expect(soldBefore?.id).toBe(wave.soldOfferId);
      expect(soldBefore?.sold).toBe(true);
      // 未售出的格在标记售出后保持原样。
      for (const offer of wave.offersAfterSold) {
        if (offer.slot === wave.soldSlot) continue;
        expect(wave.offers.find((initial) => initial.slot === offer.slot)).toEqual(offer);
      }

      const soldAfter = wave.offersAfterReroll.find(
        (offer) => offer.slot === wave.soldSlot,
      );
      expect(soldAfter?.sold).toBe(false);
      expect(wave.soldSlotAfterReroll).toBe(false);
      expect(wave.rerollCountAfter).toBe(1);
      expect(wave.rerollCostAfter).toBe(shopRerollCost(wave.shopWave, 1));
      expect(wave.emergencyPotionAfterReroll).toEqual(wave.emergencyPotion);
    }
  });
});
