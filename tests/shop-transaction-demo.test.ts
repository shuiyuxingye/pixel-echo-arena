import { describe, expect, it } from 'vitest';
import { getShopItem } from '../src/game/data';
import {
  SHOP_TRANSACTION_DEMO_SEED,
  runShopTransactionDemo,
} from '../src/game/shop-transaction-demo';
import { shopSellPrice } from '../src/game/shop-transaction';

describe('开发商店交易演示', () => {
  it('固定种子可复现，并覆盖价格/购买/出售/锁定/长按', () => {
    const report = runShopTransactionDemo();
    expect(report.seed).toBe(SHOP_TRANSACTION_DEMO_SEED);
    expect(runShopTransactionDemo()).toEqual(report);
    expect(report.priceExamples.length).toBeGreaterThanOrEqual(7);
    expect(report.purchase.price).toBeGreaterThan(0);
    expect(report.lock.nextLocked).toBe(true);
  });

  it('价格示例覆盖折扣上限、最低价与三种独立优惠', () => {
    const examples = runShopTransactionDemo().priceExamples;
    const byLabel = (label: string) => {
      const found = examples.find((example) => example.label.includes(label));
      if (!found) throw new Error(`缺少价格示例：${label}`);
      return found;
    };

    expect(byLabel('合并').price).toBe(90);
    expect(byLabel('封顶').price).toBe(65);
    expect(byLabel('最低价').price).toBe(1);
    expect(byLabel('首购补贴').price).toBe(45);
    expect(byLabel('2级').price).toBe(42);
    expect(byLabel('3级').price).toBe(63);
    expect(byLabel('锁定价').price).toBe(52);
    expect(byLabel('锁定价').source).toBe('locked');
  });

  it('购买扣款一次，重复确认返回 already-sold 且不重复扣款', () => {
    const { purchase } = runShopTransactionDemo();
    expect(purchase.goldAfter).toBe(purchase.goldBefore - purchase.price);
    expect(purchase.soldAfter).toBe(true);
    expect(purchase.stacksAfter).toBe(1);
    expect(purchase.repeatReason).toBe('already-sold');
    expect(purchase.repeatGoldAfter).toBe(purchase.goldAfter);
  });

  it('金币不足给出差额，满层与发货失败都原子回滚', () => {
    const report = runShopTransactionDemo();
    expect(report.insufficientGold.reason).toBe('insufficient-gold');
    expect(report.insufficientGold.shortfall).toBe(
      report.insufficientGold.price - report.insufficientGold.gold,
    );
    expect(report.insufficientGold.shortfall).toBeGreaterThan(0);

    for (const failure of [report.fullStack, report.deliveryFailure]) {
      expect(failure.goldAfter).toBe(failure.goldBefore);
      expect(failure.sold).toBe(false);
    }
    expect(report.fullStack.stacks).toBe(
      getShopItem(report.fullStack.id)?.stackCap,
    );
    expect(report.deliveryFailure.stacks).toBe(0);
    expect(report.fullStack.reason).toBe('item-full');
    expect(report.deliveryFailure.reason).toBe('delivery-failed');
  });

  it('出售按实际支付 40% 回收，免费奖励层为 0', () => {
    const { sell } = runShopTransactionDemo();
    expect(sell.refund).toBe(shopSellPrice(sell.paid));
    expect(sell.remainingStacks).toBe(0);
    expect(sell.goldAfter).toBe(sell.goldBefore + sell.refund);
    expect(sell.freePaid).toBe(0);
    expect(sell.freeRefund).toBe(0);
    expect(sell.freeRemainingStacks).toBe(0);
  });

  it('锁定跨商店保留身份与价格，属性预览重算且其他格按新波数刷新', () => {
    const { lock } = runShopTransactionDemo();
    expect(lock.afterRerollLocked).toBe(true);
    expect(lock.afterRerollId).toBe(lock.id);
    expect(lock.afterRerollPrice).toBe(lock.price);
    expect(lock.nextId).toBe(lock.id);
    expect(lock.nextPrice).toBe(lock.price);
    expect(lock.nextLocked).toBe(true);
    expect(lock.previewStacksBefore).toBe(0);
    expect(lock.nextStacks).toBe(1);
    expect(lock.nextPreviewStacks).toBe(2);
    expect(lock.otherSlotsRepricedForNextWave).toBe(true);
  });

  it('长按 Enter 只接受第一次 keydown', () => {
    const { longPress } = runShopTransactionDemo();
    expect(longPress.firstAccepted).toBe(true);
    expect(longPress.repeatedEventIgnored).toBe(false);
    expect(longPress.secondKeyDownWhileHeld).toBe(false);
    expect(longPress.acceptedAfterRelease).toBe(true);
  });
});
