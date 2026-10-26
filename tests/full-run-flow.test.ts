// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHEST_WAVES,
  Chest,
  collectChestEligibility,
  waveHasChest,
} from '../src/game/chest';
import { drawChestOffers, resolveChestClaim, type ChestOfferDraw } from '../src/game/chest-offer';
import { CoreInventory } from '../src/game/core-inventory';
import {
  drawCoreOffers,
  resolveCoreClaim,
  type CoreOfferDraw,
} from '../src/game/core-offer';
import { CraftedInventory, CraftingSession } from '../src/game/crafting';
import {
  BOSS_WAVE,
  TOTAL_WAVES,
  getWave,
  shopAfterWave,
  type CharacterId,
} from '../src/game/data';
import {
  EconomyLedger,
  INITIAL_GOLD,
  completionGoldForWave,
} from '../src/game/economy';
import {
  EliteCoreTracker,
  eligibleCoreIdsForWave,
} from '../src/game/elite';
import { HexRun } from '../src/game/hex';
import { ItemInventory } from '../src/game/item-inventory';
import {
  HEX_LEVELS,
  MAX_LEVEL,
  ProgressionSystem,
  XP_PER_ELITE_ENEMY,
  XP_PER_NORMAL_ENEMY,
} from '../src/game/progression';
import { SeededRandom } from '../src/game/random';
import {
  rewardKindRank,
  waveEndChannel,
  type RewardKind,
} from '../src/game/rewards';
import {
  RunStateMachine,
  WAVE_COUNTDOWN_SECONDS,
  resolvePostDamagePhase,
} from '../src/game/run-state';
import {
  appendRunResult,
  createRunResultRecord,
  loadRunResults,
  type RunResultPayload,
  type RunResultRecord,
} from '../src/game/run-results';
import {
  RUN_SAVE_STORAGE_KEY,
  clearRunCheckpoint,
  loadRunCheckpoint,
  saveRunCheckpoint,
  type RunCheckpointDraft,
} from '../src/game/run-save';
import { SHOP_LAST_WAVE, ShopShelf, type ShopOffer } from '../src/game/shop-offer';
import { ItemPaymentLedger, ShopSession } from '../src/game/shop-transaction';
import { WaveRewardFlow, WaveRunner } from '../src/game/wave';
import { buildBuildPanelView } from '../src/game/build-panel';
import { mountBuildPanel } from '../src/ui/build-panel';
import { mountResultPanel } from '../src/ui/result-panel';

const ROOT = resolve(import.meta.dirname, '..');
const STEP = 1 / 60;
const CHARACTER: CharacterId = 'vishdal';
const SAVED_AT = new Date('2026-10-25T08:00:00.000Z');

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

function read(relative: string): string {
  return readFileSync(resolve(ROOT, relative), 'utf8');
}

/** 截取一个方法的源码区间，避免后续新增代码让断言漂移。 */
function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `缺少起点：${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `缺少终点：${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

interface WavePlay {
  readonly spawnedNormals: number;
  readonly spawnedElites: number;
  readonly chest: Chest | null;
}

interface SimulatedRun {
  readonly economy: EconomyLedger;
  readonly progression: ProgressionSystem;
  readonly hexRun: HexRun;
  readonly items: ItemInventory;
  readonly cores: CoreInventory;
  readonly eliteCore: EliteCoreTracker;
  readonly random: SeededRandom;
  readonly state: RunStateMachine;
  readonly flow: WaveRewardFlow | null;
  readonly shops: readonly number[];
  readonly chestQualifications: readonly string[];
  readonly coreQualifications: readonly string[];
  readonly perWaveKinds: readonly (readonly RewardKind[])[];
  readonly upgradeSelections: number;
  readonly mechanicSelections: number;
  readonly kills: number;
  readonly completionGold: number;
}

/** 以“本波敌人全部被击杀”的规则上界推进一波，只观察刷怪配额与资格。 */
function playWave(
  wave: number,
  economy: EconomyLedger,
  progression: ProgressionSystem,
  eliteCore: EliteCoreTracker,
): WavePlay {
  const runner = new WaveRunner(wave);
  const spawned: { isElite: boolean; isBoss: boolean; enemyId?: string }[] = [];
  let guard = 0;
  while (!runner.cleared && guard < 60_000) {
    const result = runner.step(STEP, {
      aliveEnemyCount: 0,
      pendingEnemyCount: 0,
    });
    for (const request of result.spawned) {
      spawned.push({
        isElite: request.isElite,
        isBoss: request.isBoss,
        ...(request.enemy.eliteId ? { enemyId: request.enemy.eliteId } : {}),
      });
      economy.awardKill(
        `${wave}:${spawned.length}`,
        request.enemy,
        request.isElite,
      );
      progression.spawnXpOrb(0, 0, request.isElite);
      if (request.isElite && request.enemy.eliteId) {
        eliteCore.registerEliteDefeat(request.enemy.eliteId);
      }
    }
    guard += 1;
  }
  expect(runner.cleared, `第 ${wave} 波应在配额刷完并清空后过关`).toBe(true);
  expect(runner.timedOut).toBe(false);

  const definition = getWave(wave);
  const spawnedNormals = spawned.filter((entry) => !entry.isElite).length;
  const spawnedElites = spawned.filter((entry) => entry.isElite).length;
  expect(spawnedNormals).toBe(definition.enemyCount);
  expect(spawnedElites).toBe(definition.eliteCount);

  let chest: Chest | null = null;
  if (waveHasChest(wave)) {
    chest = new Chest({ id: `w${wave}-chest-1`, wave, x: 0, y: 0 });
    chest.applyDamage(chest.health.maxHealth + 1, 'physical');
    expect(chest.isBroken).toBe(true);
  }
  return { spawnedNormals, spawnedElites, chest };
}

/**
 * 从第 1 波推进到 `lastWave` 波末商店（第 1–17 波）。
 * 每一步都使用正式规则模块：WaveRunner、ProgressionSystem、WaveRewardFlow、
 * RewardQueue、宝箱资格与精英核心资格；不做跳关或改状态。
 */
function simulateWaves(lastWave: number): SimulatedRun {
  const economy = new EconomyLedger();
  const progression = new ProgressionSystem();
  const random = new SeededRandom(20261025);
  const hexRun = new HexRun({ characterId: CHARACTER, random });
  const items = new ItemInventory();
  const cores = new CoreInventory();
  const eliteCore = new EliteCoreTracker();
  const state = new RunStateMachine();
  state.enterCharacterSelect();
  state.beginRun();
  state.stepCountdown(WAVE_COUNTDOWN_SECONDS);

  const shops: number[] = [];
  const chestQualifications: string[] = [];
  const coreQualifications: string[] = [];
  const perWaveKinds: RewardKind[][] = [];
  let upgradeSelections = 0;
  let mechanicSelections = 0;
  let kills = 0;
  let completionGold = 0;
  let flow: WaveRewardFlow | null = null;

  for (let wave = 1; wave <= lastWave; wave += 1) {
    const played = playWave(wave, economy, progression, eliteCore);
    kills += played.spawnedNormals + played.spawnedElites;

    // 波末：先自动吸取经验球，再结算完成金币（与场景 beginWaveClear 同序）。
    progression.collectAll();
    completionGold += economy.awardWaveCompletion(wave);

    flow = new WaveRewardFlow(wave);
    flow.begin(progression.pendingLevelUps);
    const chestIds = played.chest ? collectChestEligibility([played.chest]) : [];
    const coreIds = eligibleCoreIdsForWave(wave, eliteCore);
    chestQualifications.push(...chestIds);
    coreQualifications.push(...coreIds);

    const chestOffers = new Map<string, ChestOfferDraw>();
    for (const chestId of chestIds) {
      chestOffers.set(
        chestId,
        drawChestOffers(() => random.next(), wave, {
          characterId: CHARACTER,
          stacksOf: (itemId) => items.stacksOf(itemId),
        }),
      );
    }
    const coreOffers = new Map<string, readonly string[]>();
    for (const rewardId of coreIds) {
      const draw: CoreOfferDraw = drawCoreOffers(() => random.next(), {
        characterId: CHARACTER,
        ownedCoreIds: cores.snapshot(),
      });
      coreOffers.set(rewardId, draw.coreIds);
    }

    expect(
      flow.completeAbsorb(progression.pendingLevelUps, {
        chestIds,
        coreIds,
        chestOffers,
        coreOffers,
      }),
    ).toBe('briefing');
    state.beginUpgrade();
    expect(flow.completeBriefing()).not.toBe('briefing');

    const kinds: RewardKind[] = [];
    let guard = 0;
    while (flow.stage !== 'intermission' && guard < 20) {
      const current = flow.currentReward;
      if (!current) throw new Error(`第 ${wave} 波奖励队列意外为空`);
      kinds.push(current.kind);
      if (current.kind === 'chest') {
        const claim = resolveChestClaim(current);
        if (claim?.itemId) items.acquire(claim.itemId);
        if (claim?.gold) economy.addGold(claim.gold);
        flow.completeChest();
      } else if (current.kind === 'core') {
        const coreId = resolveCoreClaim(current) ?? current.coreOffers?.[0] ?? null;
        if (coreId) cores.acquire(coreId);
        flow.resolveCurrent('claimed');
      } else if (current.kind === 'upgrade') {
        const choice = hexRun.createChoice();
        expect(choice.confirm()).not.toBeNull();
        progression.consumeLevelUp();
        flow.completeUpgrade();
      } else {
        flow.completeMechanic();
      }
      guard += 1;
    }
    expect(flow.stage).toBe('intermission');
    expect(flow.remainingRewards).toBe(0);
    expect(progression.pendingLevelUps).toBe(0);
    perWaveKinds.push(kinds);
    upgradeSelections += kinds.filter((kind) => kind === 'upgrade').length;
    mechanicSelections += kinds.filter((kind) => kind === 'mechanic').length;

    state.beginIntermission();
    // 第 1–17 波都有商店；本函数的调用范围也不超过 17。
    expect(waveEndChannel(wave)).toBe('shop');
    shops.push(wave);

    if (wave < lastWave) {
      flow.completeIntermission();
      state.beginWave();
      state.stepCountdown(WAVE_COUNTDOWN_SECONDS);
      expect(state.phase).toBe('combat');
    }
  }

  return {
    economy,
    progression,
    hexRun,
    items,
    cores,
    eliteCore,
    random,
    state,
    flow,
    shops,
    chestQualifications,
    coreQualifications,
    perWaveKinds,
    upgradeSelections,
    mechanicSelections,
    kills,
    completionGold,
  };
}

function checkpointDraft(
  overrides: Partial<RunCheckpointDraft> = {},
): RunCheckpointDraft {
  return {
    kind: 'wave-start',
    characterId: CHARACTER,
    wave: 1,
    health: { current: 100, max: 100 },
    level: 1,
    experience: 0,
    totalExperience: 0,
    pendingLevelUps: 0,
    upgrades: [],
    hexes: [],
    rerollsRemaining: 0,
    randomState: 1,
    hand: null,
    handKind: null,
    focusIndex: 0,
    rewardStage: 'none',
    rewardPendingLevelUps: 0,
    world: null,
    ...overrides,
  };
}

function saveAndLoad(draft: RunCheckpointDraft, storage = memoryStorage()) {
  expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
  const loaded = loadRunCheckpoint(storage);
  expect(loaded.status).toBe('ok');
  if (loaded.status !== 'ok') throw new Error('快照读取失败');
  return { storage, checkpoint: loaded.checkpoint };
}

function drawState(shopWave: number) {
  return {
    shopWave,
    characterId: CHARACTER,
    stacksOf: () => 0,
  };
}

/** 奖励流转没有直接暴露按种类计数，用队列快照统计待领取数量。 */
function pendingOf(flow: WaveRewardFlow, kind: RewardKind): number {
  return flow.rewardQueueSnapshot.filter(
    (entry) => entry.kind === kind && entry.status === 'pending',
  ).length;
}

describe('18 波完整流程计数', () => {
  it('从第 1 波推进到第 17 波商店：17 次商店、6 次宝箱资格、4 次精英核心、7 次海克斯选择', () => {
    const run = simulateWaves(17);

    expect(run.shops).toEqual(Array.from({ length: 17 }, (_, index) => index + 1));
    expect(run.shops).toHaveLength(17);
    expect(shopAfterWave(17)).toBe(true);
    expect(shopAfterWave(18)).toBe(false);
    expect(SHOP_LAST_WAVE).toBe(17);
    expect(waveEndChannel(18)).toBe('result');

    expect(run.chestQualifications).toEqual([
      'w2-chest-1',
      'w5-chest-1',
      'w8-chest-1',
      'w11-chest-1',
      'w14-chest-1',
      'w17-chest-1',
    ]);
    expect(CHEST_WAVES).toEqual([2, 5, 8, 11, 14, 17]);

    expect(run.coreQualifications).toEqual([
      'core-6',
      'core-9',
      'core-12',
      'core-15',
    ]);
    expect(run.eliteCore.rewardIds).toEqual(run.coreQualifications);

    expect(HEX_LEVELS).toHaveLength(7);
    expect(run.upgradeSelections).toBe(7);
    expect(run.progression.level).toBe(MAX_LEVEL);
    expect(run.mechanicSelections).toBe(2);
    expect(run.state.phase).toBe('intermission');

    // 第 17 波商店之后进入第 18 波（唯一 Boss 波），击败后直接结算而不是再进商店。
    const lastFlow = run.flow;
    if (!lastFlow) throw new Error('缺少第 17 波奖励流转');
    expect(lastFlow.stage).toBe('intermission');
    lastFlow.completeIntermission();
    expect(run.state.beginWave()).toBe('countdown');
    run.state.stepCountdown(WAVE_COUNTDOWN_SECONDS);
    expect(run.state.phase).toBe('combat');
    expect(getWave(BOSS_WAVE).kind).toBe('boss');
    expect(waveEndChannel(BOSS_WAVE)).toBe('result');
    expect(
      resolvePostDamagePhase({ playerDead: false, waveCleared: false, victory: true }),
    ).toMatchObject({ phase: 'result', outcome: 'victory' });
    run.state.beginResult('victory');
    expect(run.state.phase).toBe('result');
  });

  it('每波奖励严格按 宝箱 → 精英核心 → 升级/海克斯 → 机制 处理', () => {
    const run = simulateWaves(17);
    for (const kinds of run.perWaveKinds) {
      const ranks = kinds.map((kind) => rewardKindRank(kind));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }

    // 升级只落在海克斯等级（2/4/6/8/10/12/14），因此并非每波都有。
    expect(run.perWaveKinds[0]).toEqual(['upgrade']);
    expect(run.perWaveKinds[1]).toEqual(['chest']);
    expect(run.perWaveKinds[4]).toEqual(['chest', 'upgrade']);
    expect(run.perWaveKinds[5]).toEqual(['core', 'upgrade', 'mechanic']);
    expect(run.perWaveKinds[8]).toEqual(['core', 'upgrade']);
  });

  it('全流程击杀与经验来源为正式数值，完成金币共 765 且第 18 波为 0', () => {
    const run = simulateWaves(17);
    const normalKills = Array.from({ length: 17 }, (_, index) => 12 + 3 * (index + 1)).reduce(
      (sum, count) => sum + count,
      0,
    );

    expect(run.kills).toBe(normalKills + 4);
    expect(XP_PER_NORMAL_ENEMY).toBe(5);
    expect(XP_PER_ELITE_ENEMY).toBe(80);
    expect(run.completionGold).toBe(765);
    expect(completionGoldForWave(17)).toBe(69);
    expect(completionGoldForWave(18)).toBe(0);

    const firstShopGold = INITIAL_GOLD + run.completionGold;
    expect(run.economy.gold).toBeGreaterThan(firstShopGold);
  });
});

describe('第 1/9/18 波与提交边界刷新续接', () => {
  it('第 1 波波初刷新回到第 1 波，金币与等级保持初值', () => {
    const { storage, checkpoint } = saveAndLoad(
      checkpointDraft({
        kind: 'wave-start',
        wave: 1,
        gold: INITIAL_GOLD,
      }),
    );

    expect(checkpoint.wave).toBe(1);
    expect(checkpoint.kind).toBe('wave-start');
    expect(checkpoint.gold).toBe(INITIAL_GOLD);
    expect(checkpoint.level).toBe(1);
    expect(checkpoint.rewardStage).toBe('none');
    expect(checkpoint.rewardQueue).toBeUndefined();
    expect(checkpoint.coreRewardIds).toBeUndefined();
    expect(checkpoint.items).toBeUndefined();
    expect(storage.getItem(RUN_SAVE_STORAGE_KEY)).not.toBeNull();
  });

  it('第 9 波波末刷新保持波次、金币、奖励资格与已拥有内容，已领奖励不重发', () => {
    const run = simulateWaves(9);
    const flow = run.flow;
    if (!flow) throw new Error('第 9 波缺少奖励流转');
    expect(flow.stage).toBe('intermission');

    const draft = checkpointDraft({
      kind: 'intermission',
      wave: 9,
      level: run.progression.level,
      experience: run.progression.experience,
      totalExperience: run.progression.totalExperience,
      pendingLevelUps: run.progression.pendingLevelUps,
      hexes: run.hexRun.ownedIds,
      gold: run.economy.gold,
      items: run.items.snapshot(),
      coreRewardIds: [...run.eliteCore.rewardIds],
      coreIds: run.cores.snapshot(),
      rewardStage: 'intermission',
      rewardPendingLevelUps: flow.pendingLevelUps,
      rewardQueue: flow.rewardQueueSnapshot,
    });
    const { checkpoint } = saveAndLoad(draft);

    expect(checkpoint.wave).toBe(9);
    expect(checkpoint.gold).toBe(run.economy.gold);
    expect(checkpoint.items).toEqual(run.items.snapshot());
    expect(checkpoint.hexes).toEqual(run.hexRun.ownedIds);
    expect(checkpoint.coreIds).toEqual(run.cores.snapshot());
    expect(checkpoint.coreRewardIds).toEqual(['core-6', 'core-9']);
    expect(checkpoint.rewardQueue?.every((entry) => entry.status !== 'pending')).toBe(
      true,
    );

    // 恢复奖励流转后没有新的待领取资格，金币也不会因重放波末而增加。
    const restoredFlow = new WaveRewardFlow(9);
    expect(
      restoredFlow.restore(
        'intermission',
        checkpoint.rewardPendingLevelUps,
        checkpoint.rewardQueue,
      ),
    ).toBe('intermission');
    expect(restoredFlow.remainingRewards).toBe(0);

    const restoredGold = new EconomyLedger();
    restoredGold.restore(checkpoint.gold);
    expect(restoredFlow.completeIntermission()).toBe('none');
    expect(restoredGold.gold).toBe(run.economy.gold);

    const restoredCore = new EliteCoreTracker();
    restoredCore.restore(checkpoint.coreRewardIds);
    expect(eligibleCoreIdsForWave(9, restoredCore)).toEqual(['core-9']);
    expect(restoredCore.registerEliteDefeat('elite-9')).toBeNull();
  });

  it('第 18 波波初刷新保留整局构筑；胜利结算后清空续局', () => {
    const run = simulateWaves(17);
    if (!run.flow) throw new Error('缺少第 17 波奖励流转');
    run.flow.completeIntermission();
    run.state.beginWave();
    run.state.stepCountdown(WAVE_COUNTDOWN_SECONDS);
    expect(run.state.phase).toBe('combat');

    const { storage, checkpoint } = saveAndLoad(
      checkpointDraft({
        kind: 'wave-start',
        wave: BOSS_WAVE,
        level: run.progression.level,
        experience: run.progression.experience,
        totalExperience: run.progression.totalExperience,
        hexes: run.hexRun.ownedIds,
        gold: run.economy.gold,
        items: run.items.snapshot(),
        coreRewardIds: [...run.eliteCore.rewardIds],
        coreIds: run.cores.snapshot(),
      }),
    );

    expect(checkpoint.wave).toBe(18);
    expect(getWave(checkpoint.wave).kind).toBe('boss');
    expect(checkpoint.items).toEqual(run.items.snapshot());
    expect(checkpoint.hexes).toHaveLength(7);
    expect(checkpoint.coreIds).toHaveLength(4);

    // 胜败结算都会清除续局，刷新不会重新进入 Boss 战或重复领奖。
    expect(clearRunCheckpoint(storage)).toBe(true);
    expect(loadRunCheckpoint(storage).status).toBe('none');
  });

  it('宝箱资格领取边界刷新后只继续未领取资格，不重复发道具', () => {
    const flow = new WaveRewardFlow(2);
    flow.begin(1);
    flow.completeAbsorb(1, {
      chestIds: ['w2-chest-1'],
      chestOffers: new Map([
        ['w2-chest-1', { itemIds: ['I01', 'I02'], fallbackGold: 0, reason: 'two' }],
      ]),
    });
    flow.completeBriefing();
    expect(flow.stage).toBe('chest');
    const chestEntry = flow.currentReward;
    if (!chestEntry) throw new Error('缺少宝箱资格');
    const claim = resolveChestClaim(chestEntry);
    const claimedItem = claim?.itemId;
    expect(claimedItem).not.toBeNull();
    flow.completeChest();
    expect(flow.stage).toBe('upgrade');

    const { checkpoint } = saveAndLoad(
      checkpointDraft({
        kind: 'chest-claimed',
        wave: 2,
        level: 2,
        experience: 25,
        totalExperience: 75,
        items: [{ id: claimedItem ?? 'I01', stacks: 1 }],
        rewardStage: 'upgrade',
        rewardPendingLevelUps: 1,
        rewardQueue: flow.rewardQueueSnapshot,
      }),
    );

    const restored = new WaveRewardFlow(2);
    expect(
      restored.restore(
        checkpoint.rewardStage,
        checkpoint.rewardPendingLevelUps,
        checkpoint.rewardQueue,
      ),
    ).toBe('upgrade');
    expect(restored.currentReward?.kind).toBe('upgrade');
    expect(pendingOf(restored, 'chest')).toBe(0);
    expect(
      restored.rewardQueueSnapshot.find((entry) => entry.id === 'chest:w2-chest-1')
        ?.status,
    ).toBe('claimed');
    // 已领取的宝箱资格不会因为再次确认而回到待领取。
    expect(restored.completeChest()).toBe('upgrade');
    expect(pendingOf(restored, 'chest')).toBe(0);
  });

  it('精英核心领取边界刷新后核心唯一，不能重复获得', () => {
    const flow = new WaveRewardFlow(9);
    flow.begin(1);
    flow.completeAbsorb(1, {
      coreIds: ['core-9'],
      coreOffers: new Map([['core-9', ['E01', 'E02', 'E03']]]),
    });
    flow.completeBriefing();
    expect(flow.stage).toBe('core');
    const coreEntry = flow.currentReward;
    if (!coreEntry) throw new Error('缺少核心资格');
    const coreId = resolveCoreClaim(coreEntry);
    expect(coreId).not.toBeNull();
    const cores = new CoreInventory();
    if (coreId) cores.acquire(coreId);
    flow.resolveCurrent('claimed');
    expect(flow.stage).toBe('upgrade');

    const { checkpoint } = saveAndLoad(
      checkpointDraft({
        kind: 'core-claimed',
        wave: 9,
        level: 10,
        experience: 10,
        totalExperience: 1200,
        coreRewardIds: ['core-6', 'core-9'],
        coreIds: cores.snapshot(),
        rewardStage: 'upgrade',
        rewardPendingLevelUps: 1,
        rewardQueue: flow.rewardQueueSnapshot,
      }),
    );

    const restoredCores = new CoreInventory();
    restoredCores.restore(checkpoint.coreIds);
    expect(restoredCores.snapshot()).toEqual(cores.snapshot());
    expect(restoredCores.acquire(checkpoint.coreIds?.[0] ?? 'E01')).toBe(false);

    const restoredFlow = new WaveRewardFlow(9);
    restoredFlow.restore('upgrade', 1, checkpoint.rewardQueue);
    expect(pendingOf(restoredFlow, 'core')).toBe(0);
    expect(restoredFlow.currentReward?.kind).toBe('upgrade');
  });

  it('商店购买边界刷新后只扣一次钱，已售格不再成交', () => {
    const random = new SeededRandom(20261025);
    const shelf = new ShopShelf(() => random.next(), drawState(4));
    const economy = new EconomyLedger();
    economy.restore(200);
    const items = new ItemInventory();
    const payments = new ItemPaymentLedger();
    const session = new ShopSession({ shelf, gold: economy, inventory: items, payments });
    const offer: ShopOffer | undefined = shelf.offers.find(
      (entry) => entry.kind === 'item',
    );
    if (!offer) throw new Error('第 4 波商店缺少永久道具');

    const purchase = session.purchase(offer.slot);
    expect(purchase.ok).toBe(true);
    const goldAfter = economy.gold;

    const { checkpoint } = saveAndLoad(
      checkpointDraft({
        kind: 'shop-purchase',
        wave: 4,
        gold: goldAfter,
        items: items.snapshot(),
        payments: payments.snapshot(),
        shop: {
          ...shelf.snapshot(),
          freeRerollsUsed: session.usedFreeRerolls,
        },
      }),
    );

    const restoredEconomy = new EconomyLedger();
    restoredEconomy.restore(checkpoint.gold);
    const restoredItems = new ItemInventory();
    restoredItems.restore(checkpoint.items);
    const restoredPayments = new ItemPaymentLedger();
    restoredPayments.restore(checkpoint.payments);
    const restoredShelf = new ShopShelf(
      () => {
        throw new Error('恢复货架不应消耗随机数');
      },
      drawState(4),
      null,
      null,
      checkpoint.shop ?? null,
    );
    const restoredSession = new ShopSession({
      shelf: restoredShelf,
      gold: restoredEconomy,
      inventory: restoredItems,
      payments: restoredPayments,
      freeRerollsUsed: checkpoint.shop?.freeRerollsUsed ?? 0,
    });

    expect(restoredEconomy.gold).toBe(goldAfter);
    expect(restoredItems.stacksOf(offer.id)).toBe(1);
    expect(restoredPayments.countOf(offer.id)).toBe(1);
    expect(
      restoredShelf.offers.find((entry) => entry.slot === offer.slot)?.sold,
    ).toBe(true);

    const again = restoredSession.purchase(offer.slot);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('already-sold');
    expect(restoredEconomy.gold).toBe(goldAfter);
    expect(restoredItems.stacksOf(offer.id)).toBe(1);
  });

  it('合成边界刷新后成品唯一，手续费与材料不重复消耗', () => {
    const materials = ['I01', 'I06', 'I18'];
    const gold = new EconomyLedger();
    gold.restore(300);
    const items = new ItemInventory();
    for (const id of materials) expect(items.acquire(id)).toBe(true);
    const crafted = new CraftedInventory();
    const payments = new ItemPaymentLedger();
    const session = new CraftingSession({ gold, inventory: items, crafted, payments });

    const result = session.craft('R01');
    expect(result.ok).toBe(true);
    const goldAfter = gold.gold;
    expect(crafted.snapshot()).toEqual(['R01']);

    const { checkpoint } = saveAndLoad(
      checkpointDraft({
        kind: 'shop-craft',
        wave: 4,
        gold: goldAfter,
        items: items.snapshot(),
        crafted: crafted.snapshot(),
        payments: payments.snapshot(),
      }),
    );

    const restoredGold = new EconomyLedger();
    restoredGold.restore(checkpoint.gold);
    const restoredItems = new ItemInventory();
    restoredItems.restore(checkpoint.items);
    const restoredCrafted = new CraftedInventory();
    restoredCrafted.restore(checkpoint.crafted);
    const restoredSession = new CraftingSession({
      gold: restoredGold,
      inventory: restoredItems,
      crafted: restoredCrafted,
    });

    expect(restoredCrafted.snapshot()).toEqual(['R01']);
    expect(restoredGold.gold).toBe(goldAfter);
    for (const id of materials) expect(restoredItems.stacksOf(id)).toBe(0);

    const again = restoredSession.craft('R01');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('already-owned');
    expect(restoredGold.gold).toBe(goldAfter);
    expect(restoredCrafted.snapshot()).toEqual(['R01']);
  });

  it('场景恢复路径不重放波末结算，胜败时清空续局', () => {
    const scene = read('src/game/scenes/ArenaScene.ts');
    const restore = section(
      scene,
      'private startRestoredRun(',
      'private restoreWorldState(',
    );
    expect(restore).not.toContain('beginWaveClear');
    expect(restore).not.toContain('awardWaveCompletion');

    const death = section(
      scene,
      'private handlePlayerDeath(): void {',
      'private ownedUpgradeStacks(',
    );
    expect(death).toContain('clearRunCheckpoint()');

    const victory = section(
      scene,
      'private handleBossVictory(): void {',
      'private removeEnemyView(',
    );
    expect(victory).toContain('clearRunCheckpoint()');
    expect(victory).toContain("publishRunResult('victory')");
  });
});

describe('第 18 波胜负结算与 Boss 规则', () => {
  it('第 9 波是精英、第 18 波是唯一 Boss', () => {
    expect(getWave(9).kind).toBe('elite');
    expect(getWave(9).bossId).toBeUndefined();
    expect(getWave(BOSS_WAVE).kind).toBe('boss');
    expect(getWave(BOSS_WAVE).bossId).toBe('boss');
    for (let wave = 1; wave <= TOTAL_WAVES; wave += 1) {
      if (wave === BOSS_WAVE) continue;
      expect(getWave(wave).kind).not.toBe('boss');
    }
  });

  it('第 18 波没有时间到即过关，Boss 存活时不会超时清场', () => {
    const runner = new WaveRunner(BOSS_WAVE);
    expect(runner.hasTimeLimit).toBe(false);
    const spawn = runner.step(STEP, { aliveEnemyCount: 0, pendingEnemyCount: 0 });
    expect(spawn.spawned).toHaveLength(1);
    expect(spawn.spawned[0]?.isBoss).toBe(true);

    const longStep = runner.step(10_000, {
      aliveEnemyCount: 1,
      pendingEnemyCount: 0,
    });
    expect(longStep.timedOut).toBe(false);
    expect(longStep.cleared).toBe(false);
  });

  it('击败 Boss 进入胜利结算；玩家死亡优先、进入失败结算', () => {
    const victory = resolvePostDamagePhase({
      playerDead: false,
      waveCleared: false,
      victory: true,
    });
    expect(victory).toEqual({
      phase: 'result',
      outcome: 'victory',
      rewardsAllowed: false,
    });

    const death = resolvePostDamagePhase({
      playerDead: true,
      waveCleared: true,
      pendingLevelUps: 2,
      victory: true,
    });
    expect(death).toEqual({
      phase: 'result',
      outcome: 'defeat',
      rewardsAllowed: false,
    });

    const state = new RunStateMachine();
    state.enterCharacterSelect();
    state.beginRun();
    state.stepCountdown(WAVE_COUNTDOWN_SECONDS);
    expect(state.beginResult('victory')).toBe('result');
    expect(state.outcome).toBe('victory');
    expect(state.beginWave()).toBe('result');
  });

  it('胜败成绩各记录一次，同一局不重复写入，胜利波次为第 18 波', () => {
    const storage = memoryStorage();
    const victory = createRunResultRecord(
      {
        runId: 'run-victory',
        characterId: CHARACTER,
        outcome: 'victory',
        wave: BOSS_WAVE,
        durationSeconds: 1250,
        kills: 668,
        damageDealt: 51234,
        upgrades: [{ id: 'G01', stacks: 1 }],
      },
      SAVED_AT,
    );
    expect(victory.wave).toBe(18);
    expect(appendRunResult(victory, storage).saved).toBe(true);
    const duplicate = appendRunResult(victory, storage);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.records).toHaveLength(1);

    const defeat = createRunResultRecord(
      {
        runId: 'run-defeat',
        characterId: CHARACTER,
        outcome: 'defeat',
        wave: 12,
        durationSeconds: 640,
        kills: 240,
        damageDealt: 9800,
        upgrades: [],
      },
      SAVED_AT,
    );
    expect(appendRunResult(defeat, storage).saved).toBe(true);
    const records = loadRunResults(storage);
    expect(records.map((record) => record.outcome)).toEqual([
      'defeat',
      'victory',
    ]);
  });

  it('胜利结算面板可用键盘返回主菜单，失败结算显示生命归零', () => {
    resultDom();
    const onRestart = vi.fn();
    const onReturnToSelect = vi.fn();
    const panel = mountResultPanel({
      onRestart,
      onReturnToSelect,
      getRecords: () => [],
    });

    const victory = createRunResultRecord(
      {
        runId: 'run-victory',
        characterId: CHARACTER,
        outcome: 'victory',
        wave: BOSS_WAVE,
        durationSeconds: 1250,
        kills: 668,
        damageDealt: 51234,
        upgrades: [],
      },
      SAVED_AT,
    );
    panel.show(payload(victory));

    expect(textOf('result-title')).toBe('试炼完成');
    expect(textOf('result-subtitle')).toContain('Boss 已击败');
    // 焦点从“同角色重开”下移到“返回选角”，Enter 返回主菜单/选角。
    press('ArrowDown');
    press('Enter');
    expect(onReturnToSelect).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();

    const defeat = createRunResultRecord(
      {
        runId: 'run-defeat',
        characterId: CHARACTER,
        outcome: 'defeat',
        wave: 12,
        durationSeconds: 640,
        kills: 240,
        damageDealt: 9800,
        upgrades: [],
      },
      SAVED_AT,
    );
    panel.show(payload(defeat));
    expect(textOf('result-title')).toBe('试炼失败');
    expect(textOf('result-subtitle')).toContain('生命归零');
    panel.hide();
  });
});

describe('全流程键盘路径', () => {
  it('奖励面板键盘覆盖 Enter/X/左右/数字；商店与合成走面板按键', () => {
    const scene = read('src/game/scenes/ArenaScene.ts');
    const rewardKey = section(
      scene,
      'private handleRewardKey(event: KeyboardEvent): void {',
      'private confirmRewardStep()',
    );
    for (const needle of [
      'ENTER_CODES',
      "'KeyX'",
      "'ArrowLeft'",
      "'ArrowRight'",
      'CARD_FOCUS_CODES',
    ]) {
      expect(rewardKey).toContain(needle);
    }
    expect(scene).toContain('handleShopPanelAction(action: ShopUiAction): void {');
    expect(scene).toContain("case 'confirm'");
    expect(scene).toContain("case 'next-wave'");
    // 技能槽装备/升级/替换与合成都从同一键盘确认入口提交。
    expect(scene).toContain('this.purchaseShopSlot(');
    expect(scene).toContain('this.craftRecipe(');

    const shopUi = read('src/ui/shop-panel.ts');
    for (const code of ['Enter', 'KeyR', 'KeyF', 'Tab', 'Space', 'Escape']) {
      expect(shopUi).toContain(`'${code}'`);
    }
  });

  it('B 构筑面板可用 B 键打开并关闭', () => {
    buildDom();
    const onClose = vi.fn();
    const panel = mountBuildPanel({ onClose });
    panel.show(
      buildBuildPanelView({
        wave: 18,
        health: 90,
        maxHealth: 100,
        shield: 0,
        stats: {
          armor: 0,
          magicResist: 0,
          moveSpeed: 180,
          moveSpeedMultiplier: 1,
          attackSpeedMultiplier: 1,
          damageMultiplier: 1,
          skillDamageMultiplier: 1,
          normalAttackDamageMultiplier: 1,
          cooldownReduction: 0,
          explosionRadiusMultiplier: 1,
          damageOverTimeMultiplier: 1,
          recipeDamageOverTimeMultiplier: 1,
          summonDamageMultiplier: 1,
          killGoldMultiplier: 1,
          completionGoldMultiplier: 1,
          lifesteal: 0,
          regenPerFiveSeconds: 0,
        },
        potions: [],
        items: [],
        cores: [],
        crafted: [],
        hexes: [],
      }),
    );

    expect(panel.isVisible()).toBe(true);
    press('KeyB');
    expect(onClose).toHaveBeenCalledTimes(1);
    panel.destroy();
  });
});

function payload(record: RunResultRecord): RunResultPayload {
  return { record, saved: true };
}

function resultDom(): void {
  document.body.innerHTML = `
    <div id="result-overlay" hidden>
      <section id="result-panel">
        <h2 id="result-title">结算</h2>
        <p id="result-subtitle"></p>
        <dl id="result-stats"></dl>
        <p id="result-build"></p>
        <div id="result-menu">
          <button id="result-restart" type="button">同角色重开</button>
          <button id="result-select" type="button">返回选角</button>
          <button id="result-records" type="button">查看记录</button>
        </div>
        <div id="result-records-view" hidden>
          <ol id="result-record-list"></ol>
          <button id="result-records-back" type="button">返回</button>
        </div>
        <p id="result-hint"></p>
      </section>
    </div>
  `;
}

function buildDom(): void {
  document.body.innerHTML = `
    <div id="build-overlay" hidden>
      <section id="build-panel" tabindex="0">
        <h2 id="build-title"></h2>
        <p id="build-summary"></p>
        <div id="build-attributes"></div>
        <div id="build-groups"></div>
        <p id="build-hint"></p>
      </section>
    </div>
  `;
}

function press(code: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    code,
    key: code,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

function textOf(id: string): string {
  return document.querySelector<HTMLElement>(`#${id}`)?.textContent ?? '';
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
