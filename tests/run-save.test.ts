// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthState } from '../src/game/combat';
import { PauseController } from '../src/game/pause';
import { ProgressionSystem } from '../src/game/progression';
import {
  RUN_SAVE_SCHEMA_VERSION,
  RUN_SAVE_STORAGE_KEY,
  clearRunCheckpoint,
  loadRunCheckpoint,
  parseCheckpoint,
  restoredCombatStats,
  saveRunCheckpoint,
  type RunCheckpointDraft,
} from '../src/game/run-save';
import { createRunResultRecord } from '../src/game/run-results';
import { USER_SETTINGS_STORAGE_KEY } from '../src/game/settings';
import { RunStateMachine } from '../src/game/run-state';
import { UpgradeRun } from '../src/game/upgrade';
import { WaveRewardFlow } from '../src/game/wave';
import { mountMenu, type MenuResumeState } from '../src/ui/menu';

const ROOT = resolve(import.meta.dirname, '..');
const SAVED_AT = new Date('2026-10-20T04:30:00.000Z');

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
    kind: 'wave-start',
    characterId: 'vishdal',
    wave: 3,
    health: { current: 74, max: 100 },
    level: 3,
    experience: 12,
    totalExperience: 112,
    pendingLevelUps: 0,
    upgrades: [
      { id: 'G01', stacks: 1 },
      { id: 'G02', stacks: 2 },
    ],
    rerollsRemaining: 1,
    randomState: 123456,
    hand: null,
    handKind: null,
    focusIndex: 0,
    rewardStage: 'none',
    rewardPendingLevelUps: 0,
    kills: 12,
    damageDealt: 345.5,
    world: null,
    ...overrides,
  };
}

function menuDom(): void {
  document.body.innerHTML = `
    <div id="menu-overlay">
      <button id="continue-button" type="button" hidden>继续试炼</button>
      <button id="start-button" type="button">开始试炼</button>
      <button id="help-button" type="button">帮助</button>
      <button id="settings-button" type="button">设置</button>
      <button id="reset-save-button" type="button" hidden>清除损坏存档</button>
      <p id="save-notice" hidden></p>
    </div>
  `;
}

function press(code: string, key = code): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      code,
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('续局快照读写', () => {
  it('写入后读回同样的可序列化字段，并带 schemaVersion 与保存时间', () => {
    const storage = memoryStorage();
    const draft = validDraft();

    expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
    const loaded = loadRunCheckpoint(storage);

    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.checkpoint).toEqual({
      ...draft,
      schemaVersion: RUN_SAVE_SCHEMA_VERSION,
      savedAt: SAVED_AT.toISOString(),
    });
  });

  it('海克斯手牌与拥有列表可落盘并读回；重复/其他职业/未知 ID 拒绝', () => {
    const storage = memoryStorage();
    const draft = validDraft({
      kind: 'upgrade-options',
      characterId: 'amiya',
      hand: ['H01', 'H07', 'H31'],
      handKind: 'hex',
      focusIndex: 2,
      pendingLevelUps: 1,
      hexes: ['H03', 'H31'],
    });

    expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.checkpoint.handKind).toBe('hex');
    expect(loaded.checkpoint.hand).toEqual(['H01', 'H07', 'H31']);
    expect(loaded.checkpoint.hexes).toEqual(['H03', 'H31']);

    expect(
      saveRunCheckpoint(
        validDraft({ characterId: 'amiya', hexes: ['H03', 'H03'] }),
        storage,
        SAVED_AT,
      ),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({ characterId: 'amiya', hexes: ['H25'] }),
        storage,
        SAVED_AT,
      ),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({
          characterId: 'amiya',
          hand: ['H01', 'H25'],
          handKind: 'hex',
          focusIndex: 0,
        }),
        storage,
        SAVED_AT,
      ),
    ).toBe(false);
  });

  it('覆盖七种保存时机：波初、波末、波间、生成选项、重抽、选卡与奖励领取', () => {
    const storage = memoryStorage();
    const drafts: RunCheckpointDraft[] = [
      validDraft({ kind: 'wave-start' }),
      validDraft({ kind: 'wave-end', rewardStage: 'briefing' }),
      validDraft({ kind: 'intermission', rewardStage: 'intermission' }),
      validDraft({
        kind: 'upgrade-options',
        hand: ['G01', 'G02'],
        handKind: 'upgrade',
        focusIndex: 1,
        pendingLevelUps: 1,
      }),
      validDraft({
        kind: 'reroll',
        hand: ['G03', 'G04', 'W01'],
        handKind: 'upgrade',
        rerollsRemaining: 0,
      }),
      validDraft({ kind: 'card-selected', hand: null }),
      validDraft({
        kind: 'reward-claimed',
        rewardStage: 'chest',
        rewardQueue: [
          { id: 'chest:w3-1', kind: 'chest', status: 'pending', sourceId: 'w3-1' },
        ],
      }),
    ];

    for (const draft of drafts) {
      expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
      const loaded = loadRunCheckpoint(storage);
      expect(loaded.status).toBe('ok');
      if (loaded.status === 'ok') {
        expect(loaded.checkpoint.kind).toBe(draft.kind);
        expect(loaded.checkpoint.hand).toEqual(draft.hand);
      }
    }
  });

  it('波末简报与奖励队列可往返，非法队列写入失败', () => {
    const storage = memoryStorage();
    const rewardQueue = [
      { id: 'chest:w3-1', kind: 'chest', status: 'claimed', sourceId: 'w3-1' },
      { id: 'core:core-6', kind: 'core', status: 'pending', sourceId: 'core-6' },
      { id: 'upgrade:3:1', kind: 'upgrade', status: 'pending' },
    ] as const;
    const draft = validDraft({
      kind: 'wave-end',
      rewardStage: 'briefing',
      rewardQueue: [...rewardQueue],
      waveKills: 7,
    });

    expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') {
      expect(loaded.checkpoint.rewardStage).toBe('briefing');
      expect(loaded.checkpoint.waveKills).toBe(7);
      expect(loaded.checkpoint.rewardQueue).toEqual(rewardQueue);
    }

    expect(
      saveRunCheckpoint(
        validDraft({
          rewardQueue: [
            { id: 'same', kind: 'chest', status: 'pending' },
            { id: 'same', kind: 'core', status: 'pending' },
          ],
        }),
        storage,
        SAVED_AT,
      ),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({
          rewardQueue: [
            {
              id: 'bad-kind',
              kind: 'nope' as unknown as 'chest',
              status: 'pending',
            },
          ],
        }),
        storage,
        SAVED_AT,
      ),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({
          rewardQueue: [
            {
              id: 'bad-status',
              kind: 'chest',
              status: 'nope' as unknown as 'pending',
            },
          ],
        }),
        storage,
        SAVED_AT,
      ),
    ).toBe(false);
    expect(saveRunCheckpoint(validDraft({ waveKills: -1 }), storage, SAVED_AT)).toBe(
      false,
    );
  });

  it('没有存档或存储不可用时返回 none', () => {
    expect(loadRunCheckpoint(memoryStorage()).status).toBe('none');
    expect(loadRunCheckpoint(null).status).toBe('none');
  });

  it('损坏 JSON 与非法字段返回 corrupt，而不是静默回退', () => {
    const storage = memoryStorage();
    storage.setItem(RUN_SAVE_STORAGE_KEY, '{not json');
    expect(loadRunCheckpoint(storage)).toMatchObject({ status: 'corrupt' });

    storage.setItem(RUN_SAVE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1 }));
    expect(loadRunCheckpoint(storage)).toMatchObject({
      status: 'corrupt',
      reason: '缺少保存时间',
    });

    storage.setItem(
      RUN_SAVE_STORAGE_KEY,
      JSON.stringify({
        ...validDraft(),
        schemaVersion: 1,
        savedAt: SAVED_AT.toISOString(),
        hand: ['A01'],
        handKind: 'upgrade',
        focusIndex: 0,
      }),
    );
    expect(loadRunCheckpoint(storage)).toMatchObject({ status: 'corrupt' });
  });

  it('未知 schemaVersion 单独返回 unsupported，并保留版本号', () => {
    const storage = memoryStorage();
    storage.setItem(
      RUN_SAVE_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 99, savedAt: SAVED_AT.toISOString() }),
    );
    expect(loadRunCheckpoint(storage)).toEqual({
      status: 'unsupported',
      version: 99,
    });
    expect(parseCheckpoint({ schemaVersion: '1' })).toMatchObject({
      status: 'corrupt',
    });
  });

  it('存储不可写时返回 false，本局继续且不删除其它键', () => {
    const other = memoryStorage();
    other.setItem(USER_SETTINGS_STORAGE_KEY, '{"muted":true}');
    other.setItem('pixel-echo.unrelated', 'keep');
    const failing = {
      get length() {
        return other.length;
      },
      getItem: (key: string) => other.getItem(key),
      key: (index: number) => other.key(index),
      removeItem: (key: string) => other.removeItem(key),
      clear: () => other.clear(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;

    expect(saveRunCheckpoint(validDraft(), failing, SAVED_AT)).toBe(false);
    expect(other.getItem(USER_SETTINGS_STORAGE_KEY)).toBe('{"muted":true}');
    expect(other.getItem('pixel-echo.unrelated')).toBe('keep');
    expect(loadRunCheckpoint(other).status).toBe('none');
  });

  it('重置只删除本游戏的键，设置与其它站点数据保持', () => {
    const storage = memoryStorage();
    storage.setItem(USER_SETTINGS_STORAGE_KEY, '{"muted":true}');
    storage.setItem('pixel-echo.unrelated', 'keep');
    expect(saveRunCheckpoint(validDraft(), storage)).toBe(true);

    expect(clearRunCheckpoint(storage)).toBe(true);
    expect(loadRunCheckpoint(storage).status).toBe('none');
    expect(storage.getItem(USER_SETTINGS_STORAGE_KEY)).toBe('{"muted":true}');
    expect(storage.getItem('pixel-echo.unrelated')).toBe('keep');
  });

  it('拒绝写入非法草稿（负数经验、越界波次、角色不适用的手牌）', () => {
    const storage = memoryStorage();
    expect(saveRunCheckpoint(validDraft({ wave: 0 }), storage)).toBe(false);
    expect(saveRunCheckpoint(validDraft({ experience: -1 }), storage)).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({
          hand: ['A01'],
          handKind: 'upgrade',
          focusIndex: 0,
        }),
        storage,
      ),
    ).toBe(false);
    expect(storage.getItem(RUN_SAVE_STORAGE_KEY)).toBeNull();
  });

  it('快照往返保留本局击杀数与累计伤害', () => {
    const storage = memoryStorage();
    expect(
      saveRunCheckpoint(validDraft({ kills: 27, damageDealt: 1234.75 }), storage, SAVED_AT),
    ).toBe(true);

    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.checkpoint.kills).toBe(27);
    expect(loaded.checkpoint.damageDealt).toBe(1234.75);
  });

  it('旧存档缺少击杀/伤害字段仍可恢复，按 0 起步而不是损坏', () => {
    const storage = memoryStorage();
    const legacy: Record<string, unknown> = {
      ...validDraft(),
      schemaVersion: RUN_SAVE_SCHEMA_VERSION,
      savedAt: SAVED_AT.toISOString(),
    };
    delete legacy.kills;
    delete legacy.damageDealt;
    storage.setItem(RUN_SAVE_STORAGE_KEY, JSON.stringify(legacy));

    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.checkpoint.kills).toBeUndefined();
    expect(loaded.checkpoint.damageDealt).toBeUndefined();
    expect(restoredCombatStats(loaded.checkpoint)).toEqual({
      kills: 0,
      damageDealt: 0,
    });
  });

  it('快照往返保留金币；旧存档缺省时保持 undefined 由场景回退初始 40', () => {
    const storage = memoryStorage();
    expect(saveRunCheckpoint(validDraft({ gold: 137 }), storage, SAVED_AT)).toBe(true);
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.checkpoint.gold).toBe(137);

    const legacy: Record<string, unknown> = {
      ...validDraft(),
      schemaVersion: RUN_SAVE_SCHEMA_VERSION,
      savedAt: SAVED_AT.toISOString(),
    };
    delete legacy.gold;
    storage.setItem(RUN_SAVE_STORAGE_KEY, JSON.stringify(legacy));
    const legacyLoaded = loadRunCheckpoint(storage);
    expect(legacyLoaded.status).toBe('ok');
    if (legacyLoaded.status !== 'ok') return;
    expect(legacyLoaded.checkpoint.gold).toBeUndefined();
  });

  it('拒绝非法金币：负数、非整数与无穷值', () => {
    const storage = memoryStorage();
    expect(saveRunCheckpoint(validDraft({ gold: -1 }), storage, SAVED_AT)).toBe(false);
    expect(saveRunCheckpoint(validDraft({ gold: 1.5 }), storage, SAVED_AT)).toBe(false);
    expect(
      saveRunCheckpoint(validDraft({ gold: Number.POSITIVE_INFINITY }), storage, SAVED_AT),
    ).toBe(false);
  });

  it('拒绝非法击杀/伤害：负数、非整数与无穷值', () => {
    const storage = memoryStorage();
    expect(saveRunCheckpoint(validDraft({ kills: -1 }), storage, SAVED_AT)).toBe(false);
    expect(saveRunCheckpoint(validDraft({ kills: 1.5 }), storage, SAVED_AT)).toBe(false);
    expect(
      saveRunCheckpoint(validDraft({ damageDealt: -1 }), storage, SAVED_AT),
    ).toBe(false);
    expect(
      saveRunCheckpoint(
        validDraft({ damageDealt: Number.POSITIVE_INFINITY }),
        storage,
        SAVED_AT,
      ),
    ).toBe(false);
    expect(storage.getItem(RUN_SAVE_STORAGE_KEY)).toBeNull();

    storage.setItem(
      RUN_SAVE_STORAGE_KEY,
      JSON.stringify({
        ...validDraft(),
        schemaVersion: RUN_SAVE_SCHEMA_VERSION,
        savedAt: SAVED_AT.toISOString(),
        kills: -2,
      }),
    );
    expect(loadRunCheckpoint(storage)).toMatchObject({
      status: 'corrupt',
      reason: '击杀数非法',
    });
  });
});

describe('快照恢复语义', () => {
  it('恢复后先保持暂停，续局暂停只接受 Enter', () => {
    const controller = new PauseController();
    expect(controller.pause('checkpoint')).toBe(true);
    expect(controller.canResume('escape')).toBe(false);
    expect(controller.resume('escape')).toBe(false);
    expect(controller.isPaused).toBe(true);
    expect(controller.resume('enter')).toBe(true);
  });

  it('波间恢复不重新结算补给；生命按快照直接写入', () => {
    const health = new HealthState({ maxHealth: 100 });
    health.applyDamage(40, 'true');
    health.restoreHealth(70, 120);
    expect(health.health).toBe(70);
    expect(health.maxHealth).toBe(120);
    // restoreHealth 不等于 heal：不会再叠加一次波间 15%。
    health.restoreHealth(120, 120);
    expect(health.health).toBe(120);

    const state = new RunStateMachine();
    state.enterCharacterSelect();
    expect(state.restoreIntermission()).toBe('intermission');
    expect(state.restoreIntermission()).toBe('intermission');
  });

  it('状态机可从波初倒计时恢复到升级阶段，也可从选角直接恢复', () => {
    const fromCountdown = new RunStateMachine();
    fromCountdown.enterCharacterSelect();
    fromCountdown.beginWave();
    expect(fromCountdown.restoreUpgrade()).toBe('upgrade');

    const fromSelect = new RunStateMachine();
    fromSelect.enterCharacterSelect();
    expect(fromSelect.restoreUpgrade()).toBe('upgrade');
    expect(fromSelect.restoreIntermission()).toBe('upgrade');
  });

  it('等级、经验与排队升级按快照还原，满级不保留下一级经验', () => {
    const progression = new ProgressionSystem();
    progression.restore({
      level: 4,
      experience: 35,
      totalExperience: 220,
      pendingLevelUps: 2,
    });
    expect(progression.level).toBe(4);
    expect(progression.experience).toBe(35);
    expect(progression.totalExperience).toBe(220);
    expect(progression.pendingLevelUps).toBe(2);
    expect(progression.maxHealthBonus).toBe(15);

    progression.restore({
      level: 15,
      experience: 50,
      totalExperience: 50,
      pendingLevelUps: 1,
    });
    expect(progression.level).toBe(15);
    expect(progression.experience).toBe(0);
  });

  it('奖励流转恢复到简报/宝箱/核心/升级/机制/波间，不重放吸取', () => {
    const flow = new WaveRewardFlow(3);
    expect(flow.restore('briefing', 0, [])).toBe('briefing');
    expect(
      flow.restore('chest', 0, [
        { id: 'chest:w3-1', kind: 'chest', status: 'pending', sourceId: 'w3-1' },
      ]),
    ).toBe('chest');
    expect(
      flow.restore('core', 0, [
        { id: 'core:core-6', kind: 'core', status: 'pending', sourceId: 'core-6' },
      ]),
    ).toBe('core');

    expect(flow.restore('upgrade', 2)).toBe('upgrade');
    expect(flow.pendingLevelUps).toBe(2);

    expect(flow.restore('mechanic', 0)).toBe('mechanic');
    expect(flow.restore('intermission', 0)).toBe('intermission');
    // 瞬时阶段不参与恢复。
    expect(flow.restore('absorb', 1)).toBe('intermission');
  });

  it('奖励队列恢复保留已领取状态，不重领', () => {
    const flow = new WaveRewardFlow(7);
    expect(
      flow.restore('upgrade', 1, [
        {
          id: 'upgrade:7:1',
          kind: 'upgrade',
          status: 'claimed',
        },
        {
          id: 'upgrade:7:2',
          kind: 'upgrade',
          status: 'pending',
        },
      ]),
    ).toBe('upgrade');
    expect(flow.remainingRewards).toBe(1);
    expect(flow.currentReward?.id).toBe('upgrade:7:2');
    expect(flow.completeUpgrade()).toBe('intermission');
  });

  it('强化层数、重抽次数与随机状态可还原；恢复手牌不消耗随机序列', () => {
    const source = new UpgradeRun({ characterId: 'vishdal', seed: 20261020 });
    const firstChoice = source.createChoice('upgrade');
    const handIds = firstChoice.hand.map((card) => card.id);
    const randomAfterHand = source.randomState;
    const rerolls = source.rerollsRemaining;
    const stacks = [{ id: 'W01', stacks: 1 }];

    const restored = new UpgradeRun({ characterId: 'vishdal', seed: 7 });
    restored.restore({
      stacks,
      rerollsRemaining: rerolls,
      randomState: randomAfterHand,
    });
    expect(restored.stacksOf('W01')).toBe(1);
    expect(restored.rerollsRemaining).toBe(rerolls);
    expect(restored.randomState).toBe(randomAfterHand);

    // 用快照手牌重建三选一：同一手牌、焦点还原，且随机状态不前进。
    const choice = restored.createChoice('upgrade', {
      hand: handIds,
      focusIndex: 2,
    });
    expect(choice.hand.map((card) => card.id)).toEqual(handIds);
    expect(choice.focusIndex).toBe(2);
    expect(restored.randomState).toBe(randomAfterHand);

    // 继续抽卡时与同一恢复状态下的新实例序列一致。
    const continued = restored.createChoice('upgrade');
    const uninterrupted = new UpgradeRun({ characterId: 'vishdal', seed: 7 });
    uninterrupted.restore({
      stacks,
      rerollsRemaining: rerolls,
      randomState: randomAfterHand,
    });
    expect(continued.hand.map((card) => card.id)).toEqual(
      uninterrupted.createChoice('upgrade').hand.map((card) => card.id),
    );
  });

  it('恢复后从保存值继续累计，再次保存与结算都包含刷新前部分', () => {
    const storage = memoryStorage();
    expect(
      saveRunCheckpoint(validDraft({ kills: 9, damageDealt: 420.5 }), storage, SAVED_AT),
    ).toBe(true);

    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    // 恢复只写入保存值一次，不会叠加成 18/841。
    const resumed = restoredCombatStats(loaded.checkpoint);
    expect(resumed).toEqual({ kills: 9, damageDealt: 420.5 });

    // 刷新后继续击杀与造成伤害：新值 = 保存值 + 新增部分。
    const totals = {
      kills: resumed.kills + 3,
      damageDealt: resumed.damageDealt + 79.5,
    };
    expect(totals).toEqual({ kills: 12, damageDealt: 500 });

    // 结算记录直接使用累计值，包含刷新前部分。
    const record = createRunResultRecord(
      {
        runId: 'run-resume-1',
        characterId: 'vishdal',
        outcome: 'victory',
        wave: 9,
        durationSeconds: 300,
        kills: totals.kills,
        damageDealt: totals.damageDealt,
        upgrades: [],
      },
      SAVED_AT,
    );
    expect(record.kills).toBe(12);
    expect(record.damageDealt).toBe(500);

    // 下一个检查点写回的总和再次读回仍然一致，不重复计数。
    expect(saveRunCheckpoint(validDraft(totals), storage, SAVED_AT)).toBe(true);
    const reloaded = loadRunCheckpoint(storage);
    expect(reloaded.status).toBe('ok');
    if (reloaded.status !== 'ok') return;
    expect(restoredCombatStats(reloaded.checkpoint)).toEqual(totals);
  });
});

describe('菜单与场景接入', () => {
  it('有续局时主菜单显示继续并默认聚焦，Enter 进入续局', () => {
    menuDom();
    const onStart = vi.fn();
    const onContinue = vi.fn();
    const resumeState: MenuResumeState = { available: true, invalid: null };
    const menu = mountMenu({
      doc: document,
      onStart,
      onContinue,
      getResumeState: () => resumeState,
    });

    const continueButton = document.querySelector<HTMLButtonElement>('#continue-button');
    expect(continueButton?.hidden).toBe(false);
    expect(document.activeElement).toBe(continueButton);

    press('Enter');
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
    menu.hide();
  });

  it('无续局时隐藏继续并聚焦开始', () => {
    menuDom();
    const onContinue = vi.fn();
    const menu = mountMenu({
      doc: document,
      onStart: vi.fn(),
      onContinue,
      getResumeState: () => ({ available: false, invalid: null }),
    });
    expect(
      document.querySelector<HTMLButtonElement>('#continue-button')?.hidden,
    ).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#start-button'));
    press('Enter');
    expect(onContinue).not.toHaveBeenCalled();
    menu.hide();
  });

  it('损坏存档显示可见提示；键盘确认重置只清除本游戏存档', () => {
    menuDom();
    let state: MenuResumeState = {
      available: false,
      invalid: 'corrupt',
      detail: '存档不是合法 JSON',
    };
    const onResetSave = vi.fn(() => {
      state = { available: false, invalid: null };
    });
    const menu = mountMenu({
      doc: document,
      onStart: vi.fn(),
      getResumeState: () => state,
      onResetSave,
    });

    const notice = document.querySelector<HTMLElement>('#save-notice');
    const resetButton = document.querySelector<HTMLButtonElement>('#reset-save-button');
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toContain('存档损坏');
    expect(resetButton?.hidden).toBe(false);

    // 焦点顺序：开始 → 帮助 → 设置 → 清除损坏存档。
    press('ArrowUp');
    expect(document.activeElement).toBe(resetButton);
    press('Enter');
    expect(onResetSave).toHaveBeenCalledTimes(1);
    expect(notice?.hidden).toBe(true);
    expect(resetButton?.hidden).toBe(true);
    menu.hide();
  });

  it('未知版本同样提示并允许重置', () => {
    menuDom();
    const menu = mountMenu({
      doc: document,
      onStart: vi.fn(),
      getResumeState: () => ({
        available: false,
        invalid: 'unsupported',
      }),
      onResetSave: vi.fn(),
    });
    expect(document.querySelector<HTMLElement>('#save-notice')?.textContent).toContain(
      '版本不受支持',
    );
    menu.hide();
  });

  it('场景在七个检查点写快照、恢复时暂停并在结算清除', () => {
    const scene = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    for (const kind of [
      'wave-start',
      'wave-end',
      'intermission',
      'upgrade-options',
      'reroll',
      'card-selected',
      'reward-claimed',
    ]) {
      expect(scene).toContain(`saveCheckpoint('${kind}')`);
    }
    expect(scene).toContain("requestPause('checkpoint')");
    expect(scene).toContain('clearRunCheckpoint()');
    expect(scene).toContain('本局无法保存');
    expect(scene).toContain('restoreHealth');
    expect(scene).toContain('startRestoredRun');
    expect(scene).toContain('randomState');
  });

  it('应用壳读取续局并传给游戏，HTML 提供继续与提示元素', () => {
    const app = readFileSync(resolve(ROOT, 'src/app.ts'), 'utf8');
    expect(app).toContain('loadRunCheckpoint');
    expect(app).toContain('clearRunCheckpoint');
    expect(app).toContain('checkpoint');
    expect(app).toContain('continueRun');

    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('id="continue-button"');
    expect(html).toContain('id="save-notice"');
    expect(html).toContain('id="reset-save-button"');

    const game = readFileSync(resolve(ROOT, 'src/game/game.ts'), 'utf8');
    expect(game).toContain('RUN_CHECKPOINT_REGISTRY_KEY');
    expect(game).toContain('options.checkpoint');
  });

  it('场景从快照恢复击杀/伤害，检查点与结算沿用同一累计值', () => {
    const scene = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    expect(scene).toContain('restoredCombatStats(checkpoint)');
    expect(scene).toContain('this.killCount = combatStats.kills');
    expect(scene).toContain('this.damageDealt = combatStats.damageDealt');
    // collectCheckpointDraft 与 publishRunResult 都读取实例上的累计值。
    expect(scene.match(/kills: this\.killCount/g)?.length).toBeGreaterThanOrEqual(2);
    expect(
      scene.match(/damageDealt: this\.damageDealt/g)?.length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('宝箱候选与永久道具层数存档', () => {
  it('候选、兜底金币与道具层数可往返', () => {
    const storage = memoryStorage();
    const draft = validDraft({
      kind: 'reward-claimed',
      rewardStage: 'chest',
      rewardQueue: [
        {
          id: 'chest:w2-1',
          kind: 'chest',
          status: 'claimed',
          sourceId: 'w2-1',
          offers: ['I01', 'I02'],
          fallbackGold: 0,
        },
      ],
      items: [
        { id: 'I01', stacks: 2 },
        { id: 'I14', stacks: 1 },
      ],
    });

    expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') {
      expect(loaded.checkpoint.rewardQueue?.[0]?.offers).toEqual(['I01', 'I02']);
      expect(loaded.checkpoint.items).toEqual([
        { id: 'I01', stacks: 2 },
        { id: 'I14', stacks: 1 },
      ]);
    }
  });

  it('拒绝越界道具层数、未知道具与重复候选', () => {
    const storage = memoryStorage();
    const invalidDrafts: RunCheckpointDraft[] = [
      validDraft({ items: [{ id: 'I01', stacks: 4 }] }),
      validDraft({ items: [{ id: 'I99', stacks: 1 }] }),
      validDraft({ items: [{ id: 'I01', stacks: 0 }] }),
      validDraft({
        items: [
          { id: 'I01', stacks: 1 },
          { id: 'I01', stacks: 2 },
        ],
      }),
      validDraft({
        rewardQueue: [
          {
            id: 'chest:x',
            kind: 'chest',
            status: 'pending',
            offers: ['I01', 'I01'],
          },
        ],
      }),
      validDraft({
        rewardQueue: [
          {
            id: 'chest:x',
            kind: 'chest',
            status: 'pending',
            fallbackGold: -1,
          },
        ],
      }),
    ];

    for (const draft of invalidDrafts) {
      expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(false);
    }
  });
});

describe('触发闸门存档', () => {
  it('剩余冷却、每波与每局计数可往返，且不被调用方改数组污染', () => {
    const storage = memoryStorage();
    const triggerGates = {
      rules: [
        {
          id: 'E01',
          cooldownRemainingSeconds: 1.25,
          waveCount: 2,
          runCount: 5,
        },
        {
          id: 'H07',
          cooldownRemainingSeconds: 0,
          waveCount: 0,
          runCount: 9,
        },
      ],
    };
    const draft = validDraft({ triggerGates });

    expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
    triggerGates.rules[0]!.waveCount = 99;

    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') {
      expect(loaded.checkpoint.triggerGates).toEqual({
        rules: [
          {
            id: 'E01',
            cooldownRemainingSeconds: 1.25,
            waveCount: 2,
            runCount: 5,
          },
          {
            id: 'H07',
            cooldownRemainingSeconds: 0,
            waveCount: 0,
            runCount: 9,
          },
        ],
      });
    }
  });

  it('拒绝非法闸门快照：负数冷却、重复 ID、非整数计数与缺失字段', () => {
    const storage = memoryStorage();
    const invalidDrafts: RunCheckpointDraft[] = [
      validDraft({
        triggerGates: {
          rules: [
            {
              id: 'E01',
              cooldownRemainingSeconds: -1,
              waveCount: 0,
              runCount: 0,
            },
          ],
        },
      }),
      validDraft({
        triggerGates: {
          rules: [
            { id: 'E01', cooldownRemainingSeconds: 0, waveCount: 0, runCount: 0 },
            { id: 'E01', cooldownRemainingSeconds: 0, waveCount: 0, runCount: 0 },
          ],
        },
      }),
      validDraft({
        triggerGates: {
          rules: [
            {
              id: 'E01',
              cooldownRemainingSeconds: 0,
              waveCount: 1.5,
              runCount: 0,
            },
          ],
        },
      }),
      validDraft({
        triggerGates: {
          rules: [{ id: 'E01', cooldownRemainingSeconds: 0 }] as never,
        },
      }),
    ];

    for (const draft of invalidDrafts) {
      expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(false);
    }
  });
});

describe('核心效果存档', () => {
  it('E01–E03 的蓄力、冷却与次数可往返，且不被调用方改数组污染', () => {
    const storage = memoryStorage();
    const coreEffects = {
      e01DistinctTargets: ['enemy-1', 'enemy-2'],
      e01Armed: true,
      e01CooldownRemaining: 1.5,
      e02Hits: 5,
      e02Triggers: 2,
      e03UsedThisWave: true,
      e03UsedThisRun: 2,
    };
    const draft = validDraft({ coreEffects });

    expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
    coreEffects.e01DistinctTargets.push('enemy-3');

    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') {
      expect(loaded.checkpoint.coreEffects).toEqual({
        e01DistinctTargets: ['enemy-1', 'enemy-2'],
        e01Armed: true,
        e01CooldownRemaining: 1.5,
        e02Hits: 5,
        e02Triggers: 2,
        e03UsedThisWave: true,
        e03UsedThisRun: 2,
      });
    }
  });

  it('E05–E08 的新字段可往返，旧存档缺字段仍然合法', () => {
    const storage = memoryStorage();
    const coreEffects = {
      e01DistinctTargets: [],
      e01Armed: false,
      e01CooldownRemaining: 0,
      e02Hits: 0,
      e02Triggers: 0,
      e03UsedThisWave: false,
      e03UsedThisRun: 0,
      e05KillGoldThisWave: 45,
      e05DamageBonus: 0.06,
      e06Casts: 2,
      e06Echoes: 1,
      e06EchoRemainingSeconds: 0.5,
      e06EchoPending: true,
      e06EchoSlot: 'I',
      e07Active: true,
      e08Hits: 4,
      e08Triggers: 2,
    };
    const draft = validDraft({ coreEffects });

    expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') {
      expect(loaded.checkpoint.coreEffects).toEqual(coreEffects);
    }

    // 旧存档只有 E01–E04 字段，不因新字段缺省被判损坏。
    const legacy = validDraft({
      coreEffects: {
        e01DistinctTargets: [],
        e01Armed: false,
        e01CooldownRemaining: 0,
        e02Hits: 0,
        e02Triggers: 0,
        e03UsedThisWave: false,
        e03UsedThisRun: 0,
      },
    });
    expect(saveRunCheckpoint(legacy, storage, SAVED_AT)).toBe(true);
  });

  it('拒绝非法核心效果快照：E02 计数越界、负数冷却与每局次数超限', () => {
    const storage = memoryStorage();
    const base = {
      e01DistinctTargets: [],
      e01Armed: false,
      e01CooldownRemaining: 0,
      e02Hits: 0,
      e02Triggers: 0,
      e03UsedThisWave: false,
      e03UsedThisRun: 0,
    };
    const invalidDrafts: RunCheckpointDraft[] = [
      validDraft({ coreEffects: { ...base, e02Hits: 8 } }),
      validDraft({ coreEffects: { ...base, e01CooldownRemaining: -1 } }),
      validDraft({ coreEffects: { ...base, e03UsedThisRun: 4 } }),
      validDraft({ coreEffects: { ...base, e01Armed: 1 } as never }),
      validDraft({ coreEffects: { ...base, e05DamageBonus: 0.31 } }),
      validDraft({ coreEffects: { ...base, e06Casts: 3 } }),
      validDraft({ coreEffects: { ...base, e06EchoRemainingSeconds: 2 } }),
      validDraft({ coreEffects: { ...base, e08Hits: 6 } }),
      validDraft({ coreEffects: { ...base, e08Triggers: -1 } }),
    ];

    for (const draft of invalidDrafts) {
      expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(false);
    }
  });
});

describe('精英核心候选与已拥有核心存档', () => {
  it('核心候选、已拥有核心可往返，恢复后不重抽', () => {
    const storage = memoryStorage();
    const draft = validDraft({
      kind: 'reward-claimed',
      rewardStage: 'core',
      rewardQueue: [
        {
          id: 'core:core-6',
          kind: 'core',
          status: 'pending',
          sourceId: 'core-6',
          coreOffers: ['E03', 'E05', 'E08'],
        },
      ],
      coreIds: ['E01', 'E02'],
    });

    expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') {
      expect(loaded.checkpoint.rewardQueue?.[0]?.coreOffers).toEqual([
        'E03',
        'E05',
        'E08',
      ]);
      expect(loaded.checkpoint.coreIds).toEqual(['E01', 'E02']);
    }
  });

  it('拒绝未知/重复核心、重复候选与挂错奖励种类的核心候选', () => {
    const storage = memoryStorage();
    const invalidDrafts: RunCheckpointDraft[] = [
      validDraft({ coreIds: ['E99'] }),
      validDraft({ coreIds: ['core-6'] }),
      validDraft({ coreIds: ['E01', 'E01'] }),
      validDraft({
        rewardQueue: [
          {
            id: 'core:x',
            kind: 'core',
            status: 'pending',
            coreOffers: ['E01', 'E01'],
          },
        ],
      }),
      validDraft({
        rewardQueue: [
          {
            id: 'core:x',
            kind: 'core',
            status: 'pending',
            coreOffers: ['E01', 'E02', 'E03', 'E04'],
          },
        ],
      }),
      validDraft({
        rewardQueue: [
          {
            id: 'chest:x',
            kind: 'chest',
            status: 'pending',
            coreOffers: ['E01'],
          },
        ],
      }),
    ];

    for (const draft of invalidDrafts) {
      expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(false);
    }
  });
});

describe('配方追踪存档', () => {
  it('追踪配方与保底计数可往返，旧存档缺字段仍然合法', () => {
    const storage = memoryStorage();
    const draft = validDraft({
      recipeTracking: { recipeId: 'R01', shopsSinceSupply: 2 },
    });
    expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(true);
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') {
      expect(loaded.checkpoint.recipeTracking).toEqual({
        recipeId: 'R01',
        shopsSinceSupply: 2,
      });
    }

    const legacy = memoryStorage();
    expect(saveRunCheckpoint(validDraft(), legacy, SAVED_AT)).toBe(true);
    const legacyLoaded = loadRunCheckpoint(legacy);
    expect(legacyLoaded.status).toBe('ok');
    if (legacyLoaded.status === 'ok') {
      expect(legacyLoaded.checkpoint.recipeTracking).toBeUndefined();
    }
  });

  it('未追踪 null 合法，非法编号与越界计数被拒绝', () => {
    const storage = memoryStorage();
    expect(
      saveRunCheckpoint(
        validDraft({ recipeTracking: { recipeId: null, shopsSinceSupply: 0 } }),
        storage,
        SAVED_AT,
      ),
    ).toBe(true);

    const invalidDrafts: RunCheckpointDraft[] = [
      validDraft({
        recipeTracking: { recipeId: 'R99', shopsSinceSupply: 0 },
      }),
      validDraft({
        recipeTracking: { recipeId: 'I01', shopsSinceSupply: 0 },
      }),
      validDraft({
        recipeTracking: { recipeId: 'R01', shopsSinceSupply: 3 },
      }),
      validDraft({
        recipeTracking: { recipeId: 'R01', shopsSinceSupply: -1 },
      }),
    ];
    for (const draft of invalidDrafts) {
      expect(saveRunCheckpoint(draft, storage, SAVED_AT)).toBe(false);
    }
  });
});
