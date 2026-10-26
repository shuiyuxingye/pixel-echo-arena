import { describe, expect, it } from 'vitest';
import { getEnemy } from '../src/game/data';
import {
  ELITE_GOLD_BONUS,
  EconomyLedger,
  INITIAL_GOLD,
  completionGoldForWave,
  killGoldForEnemy,
} from '../src/game/economy';

describe('击杀金币', () => {
  it('初始金币 40', () => {
    expect(INITIAL_GOLD).toBe(40);
    expect(new EconomyLedger().gold).toBe(40);
  });

  it('各普通怪金币：团团怪/镰足虫 2、喷菇/冲锋猪 3、盾壳蟹/灯灵/爆爆兽 4、巢母 5', () => {
    const expected: Readonly<Record<string, number>> = {
      blob: 2,
      skitter: 2,
      spitter: 3,
      charger: 3,
      bulwark: 4,
      mender: 4,
      bomber: 4,
      broodmother: 5,
    };
    for (const [id, gold] of Object.entries(expected)) {
      expect(killGoldForEnemy(getEnemy(id))).toBe(gold);
    }
  });

  it('精英在基础金币外额外 +55，幼虫 1 金币', () => {
    expect(ELITE_GOLD_BONUS).toBe(55);
    expect(killGoldForEnemy(getEnemy('spitter'), true)).toBe(58);
    expect(killGoldForEnemy(getEnemy('bulwark'), true)).toBe(59);
    expect(killGoldForEnemy(getEnemy('larva'))).toBe(1);
  });

  it('Boss 不进入经济循环，击杀金币为 0', () => {
    expect(killGoldForEnemy(getEnemy('boss'))).toBe(0);
  });

  it('击杀直接入账，同一敌人只奖励一次', () => {
    const ledger = new EconomyLedger();
    const first = ledger.awardKill('enemy-1', getEnemy('blob'));
    expect(first).toEqual({ awarded: true, gold: 2, total: 42 });
    expect(ledger.gold).toBe(42);

    const duplicate = ledger.awardKill('enemy-1', getEnemy('blob'));
    expect(duplicate).toEqual({ awarded: false, gold: 0, total: 42 });
    expect(ledger.gold).toBe(42);
  });

  it('不同敌人实例分别结算；巢母幼虫（召唤物击杀归玩家）给 1 金币', () => {
    const ledger = new EconomyLedger();
    ledger.awardKill('larva-1', getEnemy('larva'));
    ledger.awardKill('larva-2', getEnemy('larva'));
    expect(ledger.gold).toBe(42);
  });

  it('主动跳过增援：调用方先用 enemyGrantsKillRewards 过滤', () => {
    const ledger = new EconomyLedger();
    expect(ledger.claimKill('reinforcement-1')).toBe(true);
    expect(ledger.claimKill('reinforcement-1')).toBe(false);
    expect(ledger.gold).toBe(40);
  });
});

describe('波次完成奖励', () => {
  it('第 1–17 波为 18 + 3 × 波数，第 18 波为 0', () => {
    expect(completionGoldForWave(1)).toBe(21);
    expect(completionGoldForWave(2)).toBe(24);
    expect(completionGoldForWave(17)).toBe(69);
    expect(completionGoldForWave(18)).toBe(0);
    expect(completionGoldForWave(0)).toBe(0);
    expect(completionGoldForWave(19)).toBe(0);
  });

  it('完成奖励即使超时也发放，同一波只发一次', () => {
    const ledger = new EconomyLedger();
    expect(ledger.awardWaveCompletion(1)).toBe(21);
    expect(ledger.gold).toBe(61);
    expect(ledger.awardWaveCompletion(1)).toBe(0);
    expect(ledger.gold).toBe(61);
    // 第 18 波（Boss）不发放完成奖励。
    expect(ledger.awardWaveCompletion(18)).toBe(0);
    expect(ledger.gold).toBe(61);
  });
});

describe('续局恢复', () => {
  it('恢复快照金币；非法或缺失回退初始 40', () => {
    const ledger = new EconomyLedger();
    ledger.restore(123);
    expect(ledger.gold).toBe(123);

    ledger.restore(undefined);
    expect(ledger.gold).toBe(INITIAL_GOLD);

    ledger.restore(-5);
    expect(ledger.gold).toBe(INITIAL_GOLD);

    ledger.restore(17.8);
    expect(ledger.gold).toBe(17);
  });
});

describe('I17/I22 金币倍率', () => {
  it('击杀金币按 I17 倍率结算后再向下取整', () => {
    const economy = new EconomyLedger();
    const award = economy.awardKill(
      'enemy-1',
      { goldReward: 5, elite: false },
      false,
      1.24,
    );
    expect(award.gold).toBe(6);
    expect(economy.gold).toBe(46);
  });

  it('完成奖励按 I22 倍率结算，且同一波只发一次', () => {
    const economy = new EconomyLedger();
    const first = economy.awardWaveCompletion(3, 0.85);
    expect(first).toBe(Math.floor(completionGoldForWave(3) * 0.85));
    expect(economy.awardWaveCompletion(3, 0.85)).toBe(0);
  });

  it('非法倍率回退为 1', () => {
    const economy = new EconomyLedger();
    expect(economy.awardKill('enemy-2', { goldReward: 4, elite: false }, false, 0).gold).toBe(4);
  });
});
