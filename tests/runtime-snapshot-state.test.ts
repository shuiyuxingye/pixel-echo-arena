/**
 * US-065：成品机制、消耗品与自由技能运行态的续局快照往返与校验。
 * 纯逻辑测试，不启动 Phaser；场景接线用源码字符串断言。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConsumableEffects, isConsumableSave } from '../src/game/consumable-effects';
import { CraftedInventory } from '../src/game/crafting';
import {
  CraftedEffects,
  R01_COUNTER_INTERVAL_SECONDS,
  R01_GROWTH_CAP,
  R05_FLOWFORM_INTERVAL_SECONDS,
  isCraftedMechanicsSave,
  type CraftedMechanicsSave,
} from '../src/game/crafted-effects';
import {
  BountyMarkState,
  FireTrailState,
  FreeSkillSlowState,
  GravityWellState,
  ShieldBurstState,
  SpinningBladeState,
  TurretFieldState,
  WarBannerState,
  WaterMirrorState,
  isFreeSkillEffectsSave,
  type FreeSkillEffectsSave,
} from '../src/game/free-skill-effects';
import { FreeSkillLoadout } from '../src/game/free-skills';
import {
  RUN_SAVE_STORAGE_KEY,
  loadRunCheckpoint,
  saveRunCheckpoint,
  type RunCheckpointDraft,
} from '../src/game/run-save';

const SAVED_AT = new Date('2026-10-23T04:00:00.000Z');

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

function mechanicsSave(): CraftedMechanicsSave {
  return {
    r01Growth: 40,
    r01NormalKills: 6,
    r01CounterArmed: true,
    r01CounterCooldownSeconds: 3,
    r02DeathExplosions: 2,
    r03SideBullets: 4,
    r04CastCount: 3,
    r04RefundTotalSeconds: 1.5,
    r05FlowformTimerSeconds: 7,
    r05FlowformSpawns: 2,
    r06FirstItemDiscountUsed: true,
  };
}

function effectsSave(): FreeSkillEffectsSave {
  return {
    spinningBlades: {
      remainingSeconds: 1.5,
      tickElapsedSeconds: 0.5,
      strength: 1.2,
    },
    slows: {
      entries: [{ targetId: 'enemy-1', percent: 0.4, remainingSeconds: 2 }],
    },
    fireTrail: {
      patches: [{ id: 3, x: 120, y: 80, remainingSeconds: 3.5 }],
      emitRemainingSeconds: 2,
      tickElapsedSeconds: 0.25,
      strength: 1.2,
      lastPosition: { x: 130, y: 80 },
      distanceSinceDrop: 10,
    },
    turrets: {
      turrets: [
        {
          id: 2,
          x: 200,
          y: 160,
          remainingSeconds: 6,
          tickElapsedSeconds: 0.5,
          strength: 1,
        },
      ],
    },
    shieldBurst: { remainingSeconds: 3, shieldRemaining: 35, strength: 1.2 },
    gravityWell: {
      center: { x: 300, y: 220 },
      remainingSeconds: 2,
      tickElapsedSeconds: 0.5,
      strength: 1.2,
    },
    waterMirror: {
      mirrors: [{ id: 4, x: 90, y: 60, remainingSeconds: 4, strength: 1 }],
    },
    warBanner: {
      center: { x: 70, y: 50 },
      remainingSeconds: 5,
      strength: 1,
      contactedIds: ['enemy-2'],
      contactHits: 1,
    },
    bountyMark: {
      targetId: 'enemy-3',
      remainingSeconds: 6,
      strength: 1,
      claimedCount: 1,
      paidTargetIds: ['enemy-2'],
    },
  };
}

function validDraft(
  overrides: Partial<RunCheckpointDraft> = {},
): RunCheckpointDraft {
  return {
    kind: 'upgrade-options',
    characterId: 'vishdal',
    wave: 7,
    health: { current: 80, max: 120, shield: 20 },
    level: 6,
    experience: 3,
    totalExperience: 420,
    pendingLevelUps: 0,
    upgrades: [],
    hexes: [],
    rerollsRemaining: 1,
    randomState: 424242,
    hand: null,
    handKind: null,
    focusIndex: 0,
    rewardStage: 'none',
    rewardPendingLevelUps: 0,
    freeSkills: {
      slots: [{ slot: 'U', id: 'S01', level: 2, paidTotal: 112 }],
      firstPurchaseSubsidyUsed: true,
      cooldowns: { U: 3.5, I: 0 },
    },
    crafted: ['R01', 'R04'],
    craftedMechanics: mechanicsSave(),
    consumables: {
      pending: [{ id: 'P03', stacks: [{ multiplier: 1.3, count: 2 }] }],
      active: [{ id: 'P05', stacks: [{ multiplier: 1, count: 1 }] }],
      shieldGranted: 40,
      shieldRemaining: 25,
      regenBudget: 0.5,
    },
    freeSkillEffects: effectsSave(),
    world: null,
    ...overrides,
  };
}

describe('成品与成长快照', () => {
  it('已拥有成品按目录顺序保存与恢复，未知/重复条目被忽略', () => {
    const inventory = new CraftedInventory();
    inventory.acquire('R03');
    inventory.acquire('R01');
    const saved = inventory.snapshot();
    expect(saved).toEqual(['R01', 'R03']);

    const restored = new CraftedInventory();
    restored.restore(['R03', 'NOPE', 'R03', 'R01']);
    expect(restored.snapshot()).toEqual(['R01', 'R03']);
    // 恢复后的「已拥有」判定仍阻止重复获得。
    expect(restored.acquire('R01')).toBe(false);
    expect(restored.acquire('R02')).toBe(true);
  });

  it('R01 成长、反击蓄势/冷却与 R02–R06 计数往返一致', () => {
    const inventory = new CraftedInventory();
    for (const id of ['R01', 'R04', 'R05', 'R06']) inventory.acquire(id);
    const effects = new CraftedEffects({ has: (id) => inventory.has(id) });

    effects.registerKill('elite');
    effects.registerKill('normal');
    effects.notifyEnemyHit();
    effects.step(1);
    effects.registerSkillCast();
    effects.recordCooldownRefund(0.5);
    effects.stepFlowform(0.5, { x: 10, y: 10 });
    expect(effects.consumeFirstItemDiscount()).toBeGreaterThan(0);

    const save = effects.saveSnapshot();
    expect(isCraftedMechanicsSave(save)).toBe(true);

    const restoredInventory = new CraftedInventory();
    restoredInventory.restore(inventory.snapshot());
    const restored = new CraftedEffects({
      has: (id) => restoredInventory.has(id),
    });
    restored.restore(save);

    expect(restored.r01Growth).toBe(effects.r01Growth);
    expect(restored.r01NormalKills).toBe(effects.r01NormalKills);
    expect(restored.r01CounterArmed).toBe(true);
    expect(restored.r01CounterCooldownRemaining).toBeCloseTo(
      effects.r01CounterCooldownRemaining,
      9,
    );
    expect(restored.r04CastCount).toBe(effects.r04CastCount);
    expect(restored.r04RefundTotalSeconds).toBe(effects.r04RefundTotalSeconds);
    expect(restored.r05FlowformSpawns).toBe(effects.r05FlowformSpawns);
    expect(restored.r06FirstItemDiscountUsed).toBe(true);
    expect(restored.firstItemDiscountPercent()).toBe(0);
  });

  it('拒绝成长越界、负数计数与越界冷却的成品机制快照', () => {
    expect(
      isCraftedMechanicsSave({ ...mechanicsSave(), r01Growth: R01_GROWTH_CAP + 1 }),
    ).toBe(false);
    expect(
      isCraftedMechanicsSave({ ...mechanicsSave(), r03SideBullets: -1 }),
    ).toBe(false);
    expect(
      isCraftedMechanicsSave({
        ...mechanicsSave(),
        r01CounterCooldownSeconds: R01_COUNTER_INTERVAL_SECONDS + 1,
      }),
    ).toBe(false);
    expect(
      isCraftedMechanicsSave({
        ...mechanicsSave(),
        r05FlowformTimerSeconds: R05_FLOWFORM_INTERVAL_SECONDS + 1,
      }),
    ).toBe(false);
  });
});

describe('消耗品层数与 P05 护盾快照', () => {
  it('排队/生效层数（含购买倍率）、护盾账与回复预算往返一致', () => {
    const effects = new ConsumableEffects();
    effects.setModifiers({ effectMultiplier: 1.3, priceSurchargePercent: 15 });
    expect(effects.purchase('P05', { maxHealth: 120 }).ok).toBe(true);
    expect(effects.purchase('P07', { maxHealth: 120 }).ok).toBe(true);
    expect(effects.beginWave().shieldToGrant).toBe(52);
    expect(effects.step(0.5)).toBe(0);

    const save = effects.saveSnapshot();
    expect(isConsumableSave(save)).toBe(true);

    const restored = new ConsumableEffects();
    restored.restore(save);
    expect(restored.activeCount('P05')).toBe(1);
    expect(restored.pendingCount('P07')).toBe(0);
    expect(restored.potionShieldGranted).toBe(52);
    expect(restored.potionShieldRemaining).toBe(52);
    expect(restored.snapshot().activeDamagePercent).toBe(
      effects.snapshot().activeDamagePercent,
    );
    expect(restored.regenPerSecond).toBe(effects.regenPerSecond);
  });

  it('缺省/损坏的快照清空状态且不抛错', () => {
    const effects = new ConsumableEffects();
    effects.purchase('P03', { maxHealth: 100 });
    effects.restore(undefined);
    expect(effects.pendingCount('P03')).toBe(0);
    effects.restore({} as never);
    expect(effects.pendingCount('P03')).toBe(0);
  });

  it('拒绝层数/倍率非法、护盾倒挂与重复药剂的快照', () => {
    const valid = {
      pending: [{ id: 'P03', stacks: [{ multiplier: 1, count: 1 }] }],
      active: [],
      shieldGranted: 40,
      shieldRemaining: 20,
      regenBudget: 0,
    };
    expect(isConsumableSave(valid)).toBe(true);
    expect(
      isConsumableSave({
        ...valid,
        pending: [{ id: 'P03', stacks: [{ multiplier: 1, count: 0 }] }],
      }),
    ).toBe(false);
    expect(
      isConsumableSave({
        ...valid,
        pending: [{ id: 'P03', stacks: [{ multiplier: 0, count: 1 }] }],
      }),
    ).toBe(false);
    expect(isConsumableSave({ ...valid, shieldRemaining: 41 })).toBe(false);
    expect(
      isConsumableSave({
        ...valid,
        pending: [
          { id: 'P03', stacks: [{ multiplier: 1, count: 1 }] },
          { id: 'P03', stacks: [{ multiplier: 1, count: 1 }] },
        ],
      }),
    ).toBe(false);
  });
});

describe('自由技能效果状态快照', () => {
  it('S01 剩余时长与本秒进度往返', () => {
    const blade = new SpinningBladeState();
    blade.start(1.2);
    blade.step(1.5);
    const restored = new SpinningBladeState();
    restored.restore(blade.saveSnapshot());
    expect(restored.isActive).toBe(true);
    expect(restored.remainingSecondsLeft).toBeCloseTo(1.5, 9);
    expect(restored.strength).toBeCloseTo(1.2, 9);
    expect(restored.step(0.25)).toBe(0);
    expect(restored.step(0.5)).toBe(1);
  });

  it('S02/S08 减速按目标恢复剩余秒数与比例', () => {
    const slows = new FreeSkillSlowState();
    slows.apply('enemy-1', 0.4, 3);
    slows.step(1);
    const restored = new FreeSkillSlowState();
    restored.restore(slows.saveSnapshot());
    expect(restored.remaining('enemy-1')).toBeCloseTo(2, 9);
    expect(restored.percent('enemy-1')).toBeCloseTo(0.4, 9);
    expect(restored.slowMultiplier('enemy-1')).toBeCloseTo(0.6, 9);
    expect(restored.slowMultiplier('enemy-2')).toBe(1);
  });

  it('S04 火路恢复火焰坐标、铺设窗口与补火进度', () => {
    const trail = new FireTrailState();
    trail.start({ x: 10, y: 20 }, 1.2);
    trail.step(0.5, { x: 70, y: 20 });
    const restored = new FireTrailState();
    restored.restore(trail.saveSnapshot());
    expect(restored.patchCount).toBe(trail.patchCount);
    expect(restored.patches()[0]).toEqual(trail.patches()[0]);
    expect(restored.remainingSecondsLeft).toBeCloseTo(
      trail.remainingSecondsLeft,
      9,
    );
    expect(restored.damagePerTick()).toBeCloseTo(trail.damagePerTick(), 9);
    // 恢复后继续移动仍能补火，且新火焰 ID 不与旧 ID 冲突。
    restored.step(0.5, { x: 140, y: 20 });
    const ids = restored.patches().map((patch) => patch.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('S05 炮台恢复坐标/寿命并让新炮台 ID 继续递增', () => {
    const field = new TurretFieldState();
    const first = field.place({ x: 100, y: 100 }, 1);
    field.place({ x: 120, y: 100 }, 1.2);
    const restored = new TurretFieldState();
    restored.restore(field.saveSnapshot());
    expect(restored.entries()).toEqual(field.entries());
    const placed = restored.place({ x: 140, y: 100 }, 1);
    expect(placed.id).toBeGreaterThan(first.id + 1);
    expect(placed.replacedIds.length).toBe(1);
  });

  it('S07 护盾只恢复账面，不重复授予生命护盾', () => {
    const shield = new ShieldBurstState();
    const granted = shield.start(1.2);
    shield.step(1);
    const restored = new ShieldBurstState();
    restored.restore(shield.saveSnapshot());
    expect(restored.shieldAmount).toBeCloseTo(granted, 9);
    expect(restored.remainingSecondsLeft).toBeCloseTo(
      shield.remainingSecondsLeft,
      9,
    );
    // 到期返回的仍是同一笔护盾，供场景从护盾池移除。
    expect(restored.step(10)).toBeCloseTo(granted, 9);
  });

  it('S08 重力井恢复落点与剩余 tick', () => {
    const well = new GravityWellState();
    well.start({ x: 300, y: 220 }, 1.2);
    well.step(1.5);
    const restored = new GravityWellState();
    restored.restore(well.saveSnapshot());
    expect(restored.center).toEqual(well.center);
    expect(restored.remainingSecondsLeft).toBeCloseTo(
      well.remainingSecondsLeft,
      9,
    );
    expect(restored.step(0.5)).toBe(1);
  });

  it('S09 替身恢复坐标/寿命并让新替身 ID 继续递增', () => {
    const mirror = new WaterMirrorState();
    const first = mirror.place({ x: 60, y: 40 }, 1);
    mirror.place({ x: 70, y: 40 }, 1);
    const restored = new WaterMirrorState();
    restored.restore(mirror.saveSnapshot());
    expect(restored.entries()).toEqual(mirror.entries());
    expect(restored.place({ x: 80, y: 40 }, 1).id).toBeGreaterThan(first.id + 1);
  });

  it('S10 战旗恢复区域、护甲与首次接触记录，不重复结算同一敌人', () => {
    const banner = new WarBannerState();
    banner.start({ x: 50, y: 60 }, 1);
    const target = { id: 'enemy-1', x: 55, y: 60, isAlive: true };
    expect(banner.claimContacts([target]).length).toBe(1);
    const restored = new WarBannerState();
    restored.restore(banner.saveSnapshot());
    expect(restored.center).toEqual(banner.center);
    expect(restored.armorBonusAt({ x: 50, y: 60 })).toBeGreaterThan(0);
    expect(restored.claimContacts([target]).length).toBe(0);
    // 回归后新目标仍可触发首次接触。
    expect(
      restored.claimContacts([{ id: 'enemy-2', x: 50, y: 60, isAlive: true }])
        .length,
    ).toBe(1);
  });

  it('S12 标记恢复目标与每波赏金记账，已领取目标不再给钱', () => {
    const mark = new BountyMarkState();
    mark.mark('enemy-1', 1);
    expect(mark.claimKill('enemy-1')).toBe(12);
    mark.mark('enemy-2', 1);

    const restored = new BountyMarkState();
    restored.restore(mark.saveSnapshot());
    expect(restored.targetId).toBe('enemy-2');
    expect(restored.claimedCount).toBe(1);
    // 已领取过的目标即使重新标记也不重复发赏金。
    restored.clear();
    restored.mark('enemy-1', 1);
    expect(restored.claimKill('enemy-1')).toBe(0);
    // 本波次数仍从 1 继续，剩余一次。
    restored.mark('enemy-3', 1);
    expect(restored.claimKill('enemy-3')).toBe(12);
    expect(restored.claimedCount).toBe(2);
  });
});

describe('自由技能效果聚合校验', () => {
  it('完整快照通过校验，缺省字段按未激活处理', () => {
    expect(isFreeSkillEffectsSave(effectsSave())).toBe(true);
    expect(isFreeSkillEffectsSave({})).toBe(true);
    expect(isFreeSkillEffectsSave(undefined)).toBe(false);
    expect(
      isFreeSkillEffectsSave({
        slows: { entries: [{ targetId: '', percent: 0.4, remainingSeconds: 1 }] },
      }),
    ).toBe(false);
    expect(
      isFreeSkillEffectsSave({
        turrets: { turrets: [{ id: 1, x: 0, y: 0, remainingSeconds: -1, tickElapsedSeconds: 0, strength: 1 }] },
      }),
    ).toBe(false);
    expect(
      isFreeSkillEffectsSave({
        bountyMark: {
          targetId: null,
          remainingSeconds: 999,
          strength: 1,
          claimedCount: 0,
          paidTargetIds: [],
        },
      }),
    ).toBe(false);
  });
});

describe('V2 快照读写接线', () => {
  it('成品、运行态与消耗品字段往返一致', () => {
    const storage = memoryStorage();
    expect(saveRunCheckpoint(validDraft(), storage, SAVED_AT)).toBe(true);
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.checkpoint.crafted).toEqual(['R01', 'R04']);
    expect(loaded.checkpoint.craftedMechanics).toEqual(mechanicsSave());
    expect(loaded.checkpoint.consumables).toEqual(validDraft().consumables);
    expect(loaded.checkpoint.freeSkillEffects).toEqual(effectsSave());
    expect(loaded.checkpoint.freeSkills?.cooldowns).toEqual({ U: 3.5, I: 0 });
  });

  it('写入副本：调用方修改草稿不改变已写入的快照', () => {
    const storage = memoryStorage();
    const draft = validDraft();
    expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
    (draft.crafted as string[]).push('R02');
    (
      draft.consumables!.pending[0]!.stacks as unknown as {
        multiplier: number;
      }[]
    )[0]!.multiplier = 9;
    (
      draft.freeSkillEffects!.turrets!.turrets as unknown as {
        x: number;
      }[]
    )[0]!.x = -500;
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.checkpoint.crafted).toEqual(['R01', 'R04']);
    expect(loaded.checkpoint.consumables?.pending[0]?.stacks[0]?.multiplier).toBe(
      1.3,
    );
    expect(loaded.checkpoint.freeSkillEffects?.turrets?.turrets[0]?.x).toBe(200);
  });

  it('旧快照缺少新字段仍可读取且不判损坏', () => {
    const storage = memoryStorage();
    expect(
      saveRunCheckpoint(
        validDraft({
          crafted: undefined,
          craftedMechanics: undefined,
          consumables: undefined,
          freeSkillEffects: undefined,
          freeSkills: { slots: [], firstPurchaseSubsidyUsed: false },
        }),
        storage,
        SAVED_AT,
      ),
    ).toBe(true);
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.checkpoint.crafted).toBeUndefined();
    expect(loaded.checkpoint.craftedMechanics).toBeUndefined();
    expect(loaded.checkpoint.consumables).toBeUndefined();
    expect(loaded.checkpoint.freeSkillEffects).toBeUndefined();
    expect(loaded.checkpoint.freeSkills?.cooldowns).toBeUndefined();
  });

  it('拒绝非法成品/消耗品/技能效果字段且不写出坏快照', () => {
    const storage = memoryStorage();
    expect(
      saveRunCheckpoint(validDraft({ crafted: ['R99'] }), storage),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({ crafted: ['R01', 'R01'] }),
        storage,
      ),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({
          craftedMechanics: { ...mechanicsSave(), r01Growth: -1 },
        }),
        storage,
      ),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({
          consumables: {
            pending: [{ id: 'P03', stacks: [{ multiplier: 1, count: 1 }] }],
            active: [],
            shieldGranted: 10,
            shieldRemaining: 11,
            regenBudget: 0,
          },
        }),
        storage,
      ),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({
          freeSkillEffects: {
            spinningBlades: {
              remainingSeconds: 1,
              tickElapsedSeconds: 0,
              strength: 0,
            },
          },
        }),
        storage,
      ),
    ).toBe(false);
    expect(storage.getItem(RUN_SAVE_STORAGE_KEY)).toBeNull();
  });
});

describe('自由技能冷却随快照恢复', () => {
  it('U/I 剩余冷却不再归零，旧快照没有冷却字段时从 0 起步', () => {
    const loadout = new FreeSkillLoadout();
    loadout.equip('U', 'S01', 70);
    loadout.cast('U');
    const remaining = loadout.cooldownRemaining('U');
    expect(remaining).toBeGreaterThan(0);

    const restored = new FreeSkillLoadout();
    restored.restore(loadout.saveSnapshot());
    expect(restored.cooldownRemaining('U')).toBeCloseTo(remaining, 9);

    const legacy = new FreeSkillLoadout();
    legacy.restore({ slots: [{ slot: 'U', id: 'S01', level: 1, paidTotal: 70 }], firstPurchaseSubsidyUsed: false });
    expect(legacy.cooldownRemaining('U')).toBe(0);
  });
});

describe('场景接线（US-065）', () => {
  const scene = readFileSync(
    resolve(import.meta.dirname, '../src/game/scenes/ArenaScene.ts'),
    'utf8',
  );

  it('收集检查点时写入成品、消耗品与自由技能效果', () => {
    expect(scene).toContain('crafted: this.craftedInventory.snapshot()');
    expect(scene).toContain(
      'craftedMechanics: this.craftedEffects.saveSnapshot()',
    );
    expect(scene).toContain('consumables: this.consumables.saveSnapshot()');
    expect(scene).toContain('this.collectFreeSkillEffectsSnapshot()');
  });

  it('恢复时按快照重建成品账本、消耗品与技能效果来源/视觉', () => {
    expect(scene).toContain('this.craftedInventory.restore(checkpoint.crafted)');
    expect(scene).toContain(
      'this.craftedEffects.restore(checkpoint.craftedMechanics)',
    );
    expect(scene).toContain('this.consumables.restore(checkpoint.consumables)');
    expect(scene).toContain(
      'this.restoreFreeSkillEffects(checkpoint.freeSkillEffects)',
    );
    expect(scene).toContain("beginFreeSkillSource(this.damageChains, 'S05')");
  });
});
