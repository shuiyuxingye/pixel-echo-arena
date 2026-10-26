/**
 * US-048：V2 快照新增字段（剩余时间、两条随机流、商店货架/支付账本、自由技能）的
 * 往返、恢复与拒绝损坏数据的规则测试。纯逻辑，不启动 Phaser。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getShopItem } from '../src/game/data';
import { EconomyLedger } from '../src/game/economy';
import {
  FreeSkillLoadout,
  isFreeSkillSave,
  type FreeSkillSave,
} from '../src/game/free-skills';
import { ItemInventory } from '../src/game/item-inventory';
import { RunRandomStreams, SeededRandom } from '../src/game/random';
import {
  RUN_SAVE_SCHEMA_VERSION,
  RUN_SAVE_STORAGE_KEY,
  loadRunCheckpoint,
  saveRunCheckpoint,
  type RunCheckpointDraft,
  type RunShopCheckpoint,
} from '../src/game/run-save';
import {
  buildShopMaterialSupply,
  ShopShelf,
  type ShopDrawState,
} from '../src/game/shop-offer';
import {
  ItemPaymentLedger,
  ShopSession,
} from '../src/game/shop-transaction';
import { V1_STORAGE_KEYS } from '../src/game/storage-namespace';

const SAVED_AT = new Date('2026-10-23T02:00:00.000Z');

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

function stateFor(shopWave: number): ShopDrawState {
  return {
    shopWave,
    characterId: 'vishdal',
    stacksOf: () => 0,
  };
}

/** 抽一手货架，锁定第 1 格并卖出第 2 格，再重抽一次，得到可落盘的真实状态。 */
function drawnShop(shopWave = 7): {
  shelf: ShopShelf;
  snapshot: RunShopCheckpoint;
} {
  const random = new SeededRandom(20261023);
  const shelf = new ShopShelf(() => random.next(), stateFor(shopWave));
  shelf.lock(shelf.offers[0]!.slot);
  shelf.markSold(shelf.offers[1]!.slot);
  shelf.reroll();
  return {
    shelf,
    snapshot: { ...shelf.snapshot(), freeRerollsUsed: 1 },
  };
}

/** 读回快照里第一格价格，用于验证写入时已做深拷贝。 */
function loadedPrice(storage: Storage): number | undefined {
  const loaded = loadRunCheckpoint(storage);
  return loaded.status === 'ok' ? loaded.checkpoint.shop?.offers[0]?.price : undefined;
}

function freeSkillSave(): FreeSkillSave {  return {
    slots: [
      { slot: 'U', id: 'S01', level: 2, paidTotal: 112 },
      { slot: 'I', id: 'S02', level: 1, paidTotal: 70 },
    ],
    firstPurchaseSubsidyUsed: true,
  };
}

function validDraft(
  overrides: Partial<RunCheckpointDraft> = {},
): RunCheckpointDraft {
  const shop = overrides.shop ?? null;
  const wave = overrides.wave ?? (shop ? shop.shopWave : 7);
  return {
    kind: 'intermission',
    characterId: 'vishdal',
    wave,
    health: { current: 80, max: 120 },
    level: 6,
    experience: 3,
    totalExperience: 420,
    pendingLevelUps: 0,
    upgrades: [],
    hexes: ['H01'],
    rerollsRemaining: 1,
    randomState: 424242,
    randomStates: { combat: 123456789, reward: 424242 },
    remainingSeconds: 0,
    hand: null,
    handKind: null,
    focusIndex: 0,
    rewardStage: 'intermission',
    rewardPendingLevelUps: 0,
    coreRewardIds: [],
    items: [{ id: 'I01', stacks: 2 }],
    coreIds: [],
    freeSkills: freeSkillSave(),
    payments: [{ id: 'I01', paid: [50, 55] }],
    shop,
    world: null,
    ...overrides,
  };
}

describe('V2 快照新增字段往返', () => {
  it('保存并读回剩余时间、两条随机流、自由技能、商店货架与支付账本', () => {
    const storage = memoryStorage();
    const { snapshot } = drawnShop();
    const draft = validDraft({ shop: snapshot });

    expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;

    expect(loaded.checkpoint.remainingSeconds).toBe(0);
    expect(loaded.checkpoint.randomStates).toEqual({
      combat: 123456789,
      reward: 424242,
    });
    expect(loaded.checkpoint.freeSkills).toEqual(freeSkillSave());
    expect(loaded.checkpoint.payments).toEqual([{ id: 'I01', paid: [50, 55] }]);
    expect(loaded.checkpoint.shop).toEqual(snapshot);
    expect(loaded.checkpoint.schemaVersion).toBe(RUN_SAVE_SCHEMA_VERSION);
  });

  it('写入副本：调用方后续修改草稿不改变已写入的快照', () => {
    const storage = memoryStorage();
    const shop = drawnShop().snapshot;
    const offers = shop.offers.map((offer) => ({ ...offer }));
    const draft = validDraft({ shop: { ...shop, offers } });
    expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);

    const originalPrice = loadedPrice(storage);
    offers[0]!.price = -1;
    expect(loadedPrice(storage)).toBe(originalPrice);
  });

  it('两条随机流独立保存，读回后仍各自继续', () => {
    const storage = memoryStorage();
    expect(
      saveRunCheckpoint(
        validDraft({
          randomStates: { combat: 7, reward: 9000 },
          randomState: 9000,
        }),
        storage,
        SAVED_AT,
      ),
    ).toBe(true);
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    const snapshot = loaded.checkpoint.randomStates!;
    expect(snapshot.combat).not.toBe(snapshot.reward);

    const streams = new RunRandomStreams(1);
    expect(streams.restore(snapshot)).toBe(true);
    const rewardBefore = streams.reward.snapshotState;
    streams.nextCombat();
    expect(streams.reward.snapshotState).toBe(rewardBefore);
  });

  it('旧 V2 快照缺少新增字段仍可读取，V1 键不受影响', () => {
    const storage = memoryStorage();
    const v1Run = '{"schemaVersion":1,"wave":9}';
    storage.setItem(V1_STORAGE_KEYS.run, v1Run);
    const legacy: RunCheckpointDraft = {
      ...validDraft(),
      freeSkills: undefined,
      payments: undefined,
      shop: undefined,
      randomStates: undefined,
      remainingSeconds: undefined,
    };
    expect(saveRunCheckpoint(legacy, storage, SAVED_AT)).toBe(true);
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.checkpoint.freeSkills).toBeUndefined();
    expect(loaded.checkpoint.shop).toBeUndefined();
    expect(storage.getItem(V1_STORAGE_KEYS.run)).toBe(v1Run);
  });

  it('拒绝越界/损坏的新字段，且不写出坏快照', () => {
    const storage = memoryStorage();
    const shop = drawnShop().snapshot;

    expect(
      saveRunCheckpoint(validDraft({ remainingSeconds: -1 }), storage),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({ randomStates: { combat: -1, reward: 1 } }),
        storage,
      ),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({
          freeSkills: {
            slots: [{ slot: 'U', id: 'NOPE', level: 1, paidTotal: 0 }],
            firstPurchaseSubsidyUsed: false,
          },
        }),
        storage,
      ),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({ payments: [{ id: 'I01', paid: [-5] }] }),
        storage,
      ),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({ shop: { ...shop, rerollCount: -1 } }),
        storage,
      ),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({ shop: { ...shop, freeRerollsUsed: -1 } }),
        storage,
      ),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({ shop: { ...shop, offers: [shop.offers[1]!, shop.offers[1]!] } }),
        storage,
      ),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({
          shop: {
            ...shop,
            offers: [{ ...shop.offers[0]!, kind: 'potion' }],
          },
        }),
        storage,
      ),
    ).toBe(false);
    // 商店波次必须与续局波次一致。
    expect(
      saveRunCheckpoint(validDraft({ wave: 8, shop }), storage),
    ).toBe(false);
    expect(storage.getItem(RUN_SAVE_STORAGE_KEY)).toBeNull();
  });
});

describe('商店货架快照恢复', () => {
  it('不消耗随机数即可还原格位、售出、锁定、重抽次数与缺件', () => {
    const random = new SeededRandom(99);
    const state = stateFor(7);
    const supply = buildShopMaterialSupply(state, {
      recipeId: 'R01',
      ingredientId: 'I06',
    });
    const shelf = new ShopShelf(
      () => random.next(),
      state,
      null,
      supply,
    );
    shelf.lock(shelf.offers[0]!.slot);
    shelf.markSold(shelf.offers[1]!.slot);
    shelf.reroll();
    const snapshot = shelf.snapshot();

    let draws = 0;
    const restored = new ShopShelf(
      () => {
        draws += 1;
        return 0.5;
      },
      stateFor(7),
      null,
      null,
      snapshot,
    );
    expect(draws).toBe(0);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.rerollCount).toBe(shelf.rerollCount);
    expect(restored.rerollCost).toBe(shelf.rerollCost);
    expect(restored.lockedOffer).toEqual(shelf.lockedOffer);
    expect(restored.materialSupply).toEqual(shelf.materialSupply);
    expect(restored.offers.find((offer) => offer.sold)?.slot).toBe(
      snapshot.offers.find((offer) => offer.sold)?.slot,
    );
  });

  it('恢复后仍可重抽，且已售出格会换货', () => {
    const { snapshot } = drawnShop();
    const random = new SeededRandom(5);
    const restored = new ShopShelf(
      () => random.next(),
      stateFor(snapshot.shopWave),
      null,
      null,
      snapshot,
    );
    const soldSlot = snapshot.offers.find((offer) => offer.sold)?.slot;
    restored.reroll();
    expect(restored.rerollCount).toBe(snapshot.rerollCount + 1);
    if (soldSlot !== undefined) {
      const after = restored.offers.find((offer) => offer.slot === soldSlot);
      expect(after?.sold).toBe(false);
    }
  });

  it('波次不一致或商品非法时退回重新抽货，不产生损坏货架', () => {
    const { snapshot } = drawnShop(7);
    const random = new SeededRandom(3);
    const restored = new ShopShelf(
      () => random.next(),
      stateFor(8),
      null,
      null,
      { ...snapshot, shopWave: 8 },
    );
    expect(restored.offers.length).toBeGreaterThan(0);
    expect(restored.offers.every((offer) => offer.id.length > 0)).toBe(true);
  });
});

describe('支付账本与自由技能快照', () => {
  it('逐层支付账本快照可恢复，出售仍按实付回收', () => {
    const ledger = new ItemPaymentLedger();
    ledger.record('I01', 50);
    ledger.record('I01', 55);
    ledger.record('I06', 0);
    const snapshot = ledger.snapshot();

    const restored = new ItemPaymentLedger();
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.peekLatest('I01')).toBe(55);
    expect(restored.sumLatest('I01', 2)).toBe(105);
    expect(restored.countOf('I06')).toBe(1);
  });

  it('恢复后的商店会话保留已用免费重抽次数', () => {
    const random = new SeededRandom(11);
    const shelf = new ShopShelf(() => random.next(), stateFor(7));
    const economy = new EconomyLedger();
    const inventory = new ItemInventory();
    const crafted = {
      freeRerollsPerShop: 1,
      firstItemDiscountPercent: () => 0,
      consumeFirstItemDiscount: () => 0,
    };
    const session = new ShopSession({
      shelf,
      gold: economy,
      inventory,
      crafted,
      freeRerollsUsed: 1,
    });
    expect(session.usedFreeRerolls).toBe(1);
    expect(session.freeRerollAvailable).toBe(false);
    expect(session.nextRerollCost).toBe(shelf.rerollCost);
  });

  it('自由技能两槽保存等级/累计实付/首购补贴，恢复后冷却归零', () => {
    const skills = new FreeSkillLoadout();
    expect(skills.equip('U', 'S01', 70)).toBe(true);
    expect(skills.upgrade('S01', 42)).toBe(true);
    expect(skills.equip('I', 'S02', 70)).toBe(true);
    skills.markFirstPurchaseSubsidyUsed();
    skills.step(1);
    const save = skills.saveSnapshot();
    expect(isFreeSkillSave(save)).toBe(true);

    const restored = new FreeSkillLoadout();
    restored.restore(save);
    expect(restored.slotAt('U')).toEqual({ id: 'S01', level: 2, paidTotal: 112 });
    expect(restored.slotAt('I')).toEqual({ id: 'S02', level: 1, paidTotal: 70 });
    expect(restored.firstPurchaseSubsidyUsed).toBe(true);
    expect(restored.cooldownRemaining('U')).toBe(0);
  });

  it('拒绝重复槽位、未知技能与越界等级的自由技能快照', () => {
    expect(
      isFreeSkillSave({
        slots: [
          { slot: 'U', id: 'S01', level: 1, paidTotal: 0 },
          { slot: 'U', id: 'S02', level: 1, paidTotal: 0 },
        ],
        firstPurchaseSubsidyUsed: false,
      }),
    ).toBe(false);
    expect(
      isFreeSkillSave({
        slots: [{ slot: 'U', id: 'S01', level: 4, paidTotal: 0 }],
        firstPurchaseSubsidyUsed: false,
      }),
    ).toBe(false);
    expect(
      isFreeSkillSave({
        slots: [{ slot: 'U', id: 'S99', level: 1, paidTotal: 0 }],
        firstPurchaseSubsidyUsed: false,
      }),
    ).toBe(false);
  });
});

describe('商店快照与目录一致', () => {
  it('道具格只接受当前职业可用的目录道具', () => {
    const { snapshot } = drawnShop();
    const itemOffer = snapshot.offers.find((offer) => offer.kind === 'item')!;
    const item = getShopItem(itemOffer.id);
    expect(item).toBeDefined();
    // 同 ID 放到技能格属于格位/品类不一致，必须拒绝。
    expect(
      saveRunCheckpoint(
        validDraft({
          shop: {
            ...snapshot,
            offers: [{ ...itemOffer, slot: 3, kind: 'skill' }],
          },
        }),
        memoryStorage(),
      ),
    ).toBe(false);
  });
});

describe('场景接线（US-048）', () => {
  const scene = readFileSync(
    resolve(import.meta.dirname, '../src/game/scenes/ArenaScene.ts'),
    'utf8',
  );

  it('收集检查点时写入两条随机流、剩余时间、自由技能、商店与支付账本', () => {
    expect(scene).toContain('randomStates: this.randomStreams.snapshot()');
    expect(scene).toContain('remainingSeconds: this.waveRunner');
    expect(scene).toContain('freeSkills: this.freeSkills.saveSnapshot()');
    expect(scene).toContain('shop: this.collectShopCheckpoint()');
    expect(scene).toContain('payments: this.shopPayments.snapshot()');
    expect(scene).toContain('freeRerollsUsed: this.shopSession.usedFreeRerolls');
  });

  it('恢复时按快照重建随机流、自由技能、支付账本与波间商店', () => {
    expect(scene).toContain('this.randomStreams.restore(checkpoint.randomStates)');
    expect(scene).toContain('this.freeSkills.restore(checkpoint.freeSkills)');
    expect(scene).toContain('this.shopPayments.restore(checkpoint.payments)');
    expect(scene).toContain('this.restoreShopFromCheckpoint(checkpoint)');
    // 商店恢复走 ShopShelf 的快照构造，不重新抽货。
    expect(scene).toContain('null,\n      null,\n      shop,');
  });

  it('暂停菜单收起商店后，恢复时重新发布面板', () => {
    expect(scene).toContain('if (this.shopPanelOpen) this.publishShopPanel();');
  });
});
