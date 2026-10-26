import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CraftedInventory, CraftingSession } from '../src/game/crafting';
import { EconomyLedger } from '../src/game/economy';
import { HexRun } from '../src/game/hex';
import { ItemInventory } from '../src/game/item-inventory';
import { SeededRandom } from '../src/game/random';
import {
  RUN_SAVE_STORAGE_KEY,
  isWorldCheckpointKind,
  loadRunCheckpoint,
  saveRunCheckpoint,
  type RunCheckpoint,
  type RunCheckpointDraft,
  type RunCheckpointKind,
} from '../src/game/run-save';
import { ShopShelf, type ShopOffer } from '../src/game/shop-offer';
import { ItemPaymentLedger, ShopSession } from '../src/game/shop-transaction';
import { V1_STORAGE_KEYS } from '../src/game/storage-namespace';
import { WaveRewardFlow } from '../src/game/wave';

const ROOT = resolve(import.meta.dirname, '..');
const SAVED_AT = new Date('2026-10-23T09:00:00.000Z');
const SHOP_WAVE = 7;

const BOUNDARY_KINDS: readonly RunCheckpointKind[] = [
  'chest-claimed',
  'core-claimed',
  'hex-selected',
  'shop-purchase',
  'shop-craft',
  'skill-equipped',
];

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  } as unknown as Storage;
}

function validDraft(
  overrides: Partial<RunCheckpointDraft> = {},
): RunCheckpointDraft {
  return {
    kind: 'intermission',
    characterId: 'vishdal',
    wave: SHOP_WAVE,
    health: { current: 74, max: 100 },
    level: 3,
    experience: 12,
    totalExperience: 112,
    pendingLevelUps: 0,
    upgrades: [],
    rerollsRemaining: 1,
    randomState: 123456,
    hand: null,
    handKind: null,
    focusIndex: 0,
    rewardStage: 'intermission',
    rewardPendingLevelUps: 0,
    world: null,
    ...overrides,
  };
}

function drawState() {
  return {
    shopWave: SHOP_WAVE,
    characterId: 'vishdal' as const,
    stacksOf: () => 0,
  };
}

/** 固定种子的货架 + 金币/库存/支付账本，用于购买边界。 */
function shopHarness(options: { deliver?: (offer: ShopOffer) => boolean } = {}) {
  const random = new SeededRandom(20261023);
  const shelf = new ShopShelf(() => random.next(), drawState());
  const economy = new EconomyLedger();
  economy.restore(200);
  const inventory = new ItemInventory();
  const payments = new ItemPaymentLedger();
  const session = new ShopSession({
    shelf,
    gold: economy,
    inventory,
    payments,
    ...(options.deliver ? { deliver: options.deliver } : {}),
  });
  const offer = shelf.offers.find((entry) => entry.kind === 'item');
  if (!offer) throw new Error('测试货架缺少永久道具');
  return { shelf, economy, inventory, payments, session, offer };
}

function boundaryDraft(
  kind: RunCheckpointKind,
  overrides: Partial<RunCheckpointDraft> = {},
): RunCheckpointDraft {
  return validDraft({ kind, ...overrides });
}

/** 模拟一次刷新：落盘当前状态，再从快照恢复出新的账本。 */
function snapshotAndRestore(draft: RunCheckpointDraft): RunCheckpoint {
  const storage = memoryStorage();
  expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
  const loaded = loadRunCheckpoint(storage);
  expect(loaded.status).toBe('ok');
  if (loaded.status !== 'ok') throw new Error('快照读取失败');
  return loaded.checkpoint;
}

describe('提交边界检查点类型', () => {
  it('宝箱/核心/海克斯/购买/合成/技能替换各自有独立类型并可往返', () => {
    const storage = memoryStorage();
    for (const kind of BOUNDARY_KINDS) {
      expect(saveRunCheckpoint(boundaryDraft(kind), storage, SAVED_AT)).toBe(
        true,
      );
      const loaded = loadRunCheckpoint(storage);
      expect(loaded.status).toBe('ok');
      if (loaded.status === 'ok') {
        expect(loaded.checkpoint.kind).toBe(kind);
      }
    }
  });

  it('只有可能发生在波内的边界需要世界状态；商店交易边界不重放战斗', () => {
    expect(isWorldCheckpointKind('hex-selected')).toBe(true);
    expect(isWorldCheckpointKind('upgrade-options')).toBe(true);
    for (const kind of [
      'chest-claimed',
      'core-claimed',
      'shop-purchase',
      'shop-craft',
      'skill-equipped',
      'intermission',
      'wave-end',
    ] as const) {
      expect(isWorldCheckpointKind(kind)).toBe(false);
    }
  });

  it('波内海克斯边界保存世界状态；波末海克斯边界不带世界状态', () => {
    const withWorld = boundaryDraft('hex-selected', {
      hand: ['H01', 'H02'],
      handKind: 'hex',
    });
    // 没有 world 字段时仍然合法：场景只在还有 WaveRunner 时收集世界状态。
    expect(snapshotAndRestore(withWorld).world).toBeNull();
  });

  it('检查点携带本波剩余秒数，刷新后按原值继续', () => {
    const checkpoint = snapshotAndRestore(
      boundaryDraft('hex-selected', {
        hand: ['H01', 'H02'],
        handKind: 'hex',
        remainingSeconds: 42.5,
      }),
    );
    expect(checkpoint.remainingSeconds).toBe(42.5);
  });
});

describe('购买边界原子性', () => {
  it('发货失败整笔回滚：金币、层数与货架状态都不变', () => {
    const harness = shopHarness({ deliver: () => false });
    const goldBefore = harness.economy.gold;

    const result = harness.session.purchase(harness.offer.slot);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('delivery-failed');
    expect(harness.economy.gold).toBe(goldBefore);
    expect(harness.inventory.stacksOf(harness.offer.id)).toBe(0);
    expect(harness.payments.countOf(harness.offer.id)).toBe(0);
    expect(
      harness.shelf.offers.find((entry) => entry.slot === harness.offer.slot)
        ?.sold,
    ).toBe(false);
  });

  it('成交后写检查点，刷新只扣一次钱、只发一次货、已售格不再成交', () => {
    const harness = shopHarness();
    const goldBefore = harness.economy.gold;
    const result = harness.session.purchase(harness.offer.slot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('购买失败');
    const goldAfter = harness.economy.gold;
    expect(goldAfter).toBeLessThan(goldBefore);

    const checkpoint = snapshotAndRestore(
      boundaryDraft('shop-purchase', {
        gold: goldAfter,
        items: harness.inventory.snapshot(),
        payments: harness.payments.snapshot(),
        shop: {
          ...harness.shelf.snapshot(),
          freeRerollsUsed: harness.session.usedFreeRerolls,
        },
      }),
    );

    // 恢复后的账本与刷新前一致：一次扣款、一层道具、一条支付记录。
    const restoredEconomy = new EconomyLedger();
    restoredEconomy.restore(checkpoint.gold);
    const restoredInventory = new ItemInventory();
    restoredInventory.restore(checkpoint.items);
    const restoredPayments = new ItemPaymentLedger();
    restoredPayments.restore(checkpoint.payments);
    const restoredShelf = new ShopShelf(
      () => {
        throw new Error('恢复货架不应消耗随机数');
      },
      drawState(),
      null,
      null,
      checkpoint.shop ?? null,
    );
    const restoredSession = new ShopSession({
      shelf: restoredShelf,
      gold: restoredEconomy,
      inventory: restoredInventory,
      payments: restoredPayments,
      freeRerollsUsed: checkpoint.shop?.freeRerollsUsed ?? 0,
    });

    expect(restoredEconomy.gold).toBe(goldAfter);
    expect(restoredInventory.stacksOf(harness.offer.id)).toBe(1);
    expect(restoredPayments.countOf(harness.offer.id)).toBe(1);
    expect(
      restoredShelf.offers.find((entry) => entry.slot === harness.offer.slot)
        ?.sold,
    ).toBe(true);

    // 再次确认同一格只得到 already-sold，不会二次扣款或发货。
    const again = restoredSession.purchase(harness.offer.slot);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('already-sold');
    expect(restoredEconomy.gold).toBe(goldAfter);
    expect(restoredInventory.stacksOf(harness.offer.id)).toBe(1);
  });
});

describe('合成边界原子性', () => {
  const MATERIALS = ['I01', 'I06', 'I18'] as const;

  function craftHarness(deliver?: (recipeId: string) => boolean) {
    const gold = new EconomyLedger();
    gold.restore(200);
    const inventory = new ItemInventory();
    for (const id of MATERIALS) inventory.acquire(id);
    const crafted = new CraftedInventory();
    const payments = new ItemPaymentLedger();
    const session = new CraftingSession({
      gold,
      inventory,
      crafted,
      payments,
      ...(deliver ? { deliver } : {}),
    });
    return { gold, inventory, crafted, payments, session };
  }

  it('成品发货失败时手续费与三件材料全额回滚', () => {
    const harness = craftHarness(() => false);

    const result = harness.session.craft('R01');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('delivery-failed');
    expect(harness.gold.gold).toBe(200);
    expect(harness.crafted.has('R01')).toBe(false);
    for (const id of MATERIALS) expect(harness.inventory.stacksOf(id)).toBe(1);
  });

  it('成交后写检查点，刷新保持成品唯一且不会重复扣手续费', () => {
    const harness = craftHarness();
    const result = harness.session.craft('R01');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('合成失败');
    const goldAfter = harness.gold.gold;
    expect(harness.crafted.snapshot()).toEqual(['R01']);

    const checkpoint = snapshotAndRestore(
      boundaryDraft('shop-craft', {
        gold: goldAfter,
        items: harness.inventory.snapshot(),
        crafted: harness.crafted.snapshot(),
        payments: harness.payments.snapshot(),
      }),
    );

    const restoredGold = new EconomyLedger();
    restoredGold.restore(checkpoint.gold);
    const restoredInventory = new ItemInventory();
    restoredInventory.restore(checkpoint.items);
    const restoredCrafted = new CraftedInventory();
    restoredCrafted.restore(checkpoint.crafted);
    const restoredSession = new CraftingSession({
      gold: restoredGold,
      inventory: restoredInventory,
      crafted: restoredCrafted,
    });

    expect(restoredCrafted.snapshot()).toEqual(['R01']);
    expect(restoredGold.gold).toBe(goldAfter);
    for (const id of MATERIALS) {
      expect(restoredInventory.stacksOf(id)).toBe(0);
    }

    const again = restoredSession.craft('R01');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('already-owned');
    expect(restoredGold.gold).toBe(goldAfter);
  });
});

describe('连续刷新稳定性', () => {
  it('同一份快照连续刷新两次后字段完全一致（含边界类型与剩余时间）', () => {
    const draft = boundaryDraft('shop-craft', {
      gold: 137,
      remainingSeconds: 12.25,
      items: [{ id: 'I01', stacks: 1 }],
      crafted: ['R01'],
    });
    const first = snapshotAndRestore(draft);

    const storage = memoryStorage();
    expect(saveRunCheckpoint(first, storage, SAVED_AT)).toBe(true);
    const second = loadRunCheckpoint(storage);
    expect(second.status).toBe('ok');
    if (second.status !== 'ok') throw new Error('二次读取失败');

    expect(second.checkpoint).toEqual(first);
    expect(JSON.stringify(second.checkpoint)).toBe(JSON.stringify(first));
  });

  it('边界检查点只写 V2 键，V1 设置/成绩/续局保持原值', () => {
    const storage = memoryStorage();
    const v1 = {
      [V1_STORAGE_KEYS.settings]: '{"muted":true}',
      [V1_STORAGE_KEYS.run]: '{"schemaVersion":1,"wave":9}',
      [V1_STORAGE_KEYS.results]: '{"schemaVersion":1,"records":[]}',
    };
    for (const [key, value] of Object.entries(v1)) storage.setItem(key, value);

    expect(
      saveRunCheckpoint(
        boundaryDraft('shop-purchase', { gold: 88 }),
        storage,
        SAVED_AT,
      ),
    ).toBe(true);
    expect(storage.getItem(RUN_SAVE_STORAGE_KEY)).not.toBeNull();
    for (const [key, value] of Object.entries(v1)) {
      expect(storage.getItem(key)).toBe(value);
    }
  });
});

describe('奖励边界重开', () => {
  it('宝箱/核心边界刷新后保留已领取状态，只继续未领取的资格', () => {
    const checkpoint = snapshotAndRestore(
      boundaryDraft('core-claimed', {
        rewardStage: 'core',
        rewardQueue: [
          {
            id: 'chest:w7-1',
            kind: 'chest',
            status: 'claimed',
            sourceId: 'w7-1',
          },
          {
            id: 'core:core-6',
            kind: 'core',
            status: 'pending',
            sourceId: 'core-6',
          },
        ],
        coreRewardIds: ['core-6'],
      }),
    );

    const flow = new WaveRewardFlow(SHOP_WAVE);
    expect(
      flow.restore(
        'core',
        checkpoint.rewardPendingLevelUps,
        checkpoint.rewardQueue,
      ),
    ).toBe('core');
    expect(flow.remainingRewards).toBe(1);
    expect(flow.currentReward?.id).toBe('core:core-6');
    // 已领取的宝箱资格不会回到待领取队列。
    expect(
      flow.rewardQueueSnapshot.find((entry) => entry.id === 'chest:w7-1')
        ?.status,
    ).toBe('claimed');
  });

  it('海克斯选择边界刷新后手牌与已选列表不重抽', () => {
    const checkpoint = snapshotAndRestore(
      boundaryDraft('hex-selected', {
        hexes: ['H01'],
        hand: ['H02', 'H03'],
        handKind: 'hex',
        focusIndex: 1,
      }),
    );

    const run = new HexRun({ characterId: 'vishdal', seed: 1 });
    run.restore({ hexes: checkpoint.hexes });
    const choice = run.createChoice({
      hand: checkpoint.hand ?? [],
      focusIndex: checkpoint.focusIndex,
    });

    expect(choice.hand.map((card) => card.id)).toEqual(['H02', 'H03']);
    expect(choice.focusIndex).toBe(1);
    expect(run.ownedIds).toEqual(['H01']);
  });
});

describe('场景接线与恢复顺序', () => {
  const sceneSource = readFileSync(
    resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
    'utf8',
  );

  it('每个提交边界在场景中写对应类型的检查点', () => {
    const expected: readonly [RunCheckpointKind, string][] = [
      ['chest-claimed', "advanceRewardUi('chest-claimed')"],
      ['core-claimed', "advanceRewardUi('core-claimed')"],
      ['hex-selected', "advanceRewardUi('hex-selected')"],
      ['shop-purchase', "afterShopChange('shop-purchase')"],
      ['shop-craft', "afterShopChange(result.ok ? 'shop-craft' : 'intermission')"],
      ['skill-equipped', "'skill-equipped'"],
    ];
    for (const [, needle] of expected) {
      expect(sceneSource).toContain(needle);
    }
  });

  it('恢复时先同步构筑修正、再写入世界状态', () => {
    const statSync = sceneSource.indexOf('this.syncStatSources();');
    const buildSync = sceneSource.indexOf('this.syncBuildModifiers();');
    const worldRestore = sceneSource.indexOf('this.restoreWorldState(');
    expect(statSync).toBeGreaterThan(-1);
    expect(buildSync).toBeGreaterThan(-1);
    expect(worldRestore).toBeGreaterThan(-1);
    expect(statSync).toBeLessThan(worldRestore);
    expect(buildSync).toBeLessThan(worldRestore);
  });

  it('场景只在波内边界收集世界状态，并按剩余秒数恢复计时', () => {
    expect(sceneSource).toContain('isWorldCheckpointKind(kind)');
    expect(sceneSource).toContain('this.waveRunner !== null');
    expect(sceneSource).toContain('remainingSeconds:');
  });
});
