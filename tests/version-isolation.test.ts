// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHARACTER_DISPLAY_NAMES,
  CHARACTER_LIST,
  LEGACY_CHARACTER_NAMES,
  getCharacter,
  type CharacterId,
} from '../src/game/data';
import {
  LEGACY_SETTINGS_IMPORT_MARKER_KEY,
  V1_STORAGE_KEYS,
  V2_STORAGE_KEYS,
} from '../src/game/storage-namespace';
import {
  DEFAULT_KEY_BINDINGS,
  DEFAULT_USER_SETTINGS,
  RUN_SETTINGS_REGISTRY_KEY,
  USER_SETTINGS_STORAGE_KEY,
  combatBindingActionForKeyCode,
  createSettingsStore,
  loadUserSettings,
  saveUserSettings,
} from '../src/game/settings';
import {
  RUN_SAVE_STORAGE_KEY,
  clearRunCheckpoint,
  loadRunCheckpoint,
  saveRunCheckpoint,
  type RunCheckpointDraft,
} from '../src/game/run-save';
import {
  RUN_RESULTS_STORAGE_KEY,
  appendRunResult,
  createRunResultRecord,
  loadRunResults,
} from '../src/game/run-results';
import {
  isLegacySettingsImportDone,
  normalizeLegacyKeyCode,
  parseLegacySettings,
  readLegacySettingsForImport,
} from '../src/game/legacy-settings';
import { mountSettingsPanel } from '../src/ui/settings-panel';

const SAVED_AT = new Date('2026-10-20T06:00:00.000Z');

function validDraft(): RunCheckpointDraft {
  return {
    kind: 'wave-start',
    characterId: 'vishdal',
    wave: 1,
    health: { current: 110, max: 110 },
    level: 1,
    experience: 0,
    totalExperience: 0,
    pendingLevelUps: 0,
    upgrades: [],
    rerollsRemaining: 2,
    randomState: 1,
    hand: null,
    handKind: null,
    focusIndex: 0,
    rewardStage: 'none',
    rewardPendingLevelUps: 0,
    world: null,
  };
}

function seedV1Keys(): Record<string, string> {
  const values: Record<string, string> = {
    [V1_STORAGE_KEYS.settings]: JSON.stringify({
      keyBindings: { ...DEFAULT_KEY_BINDINGS, attack: 'KeyU', dodge: 'KeyG' },
      muted: true,
      screenShake: false,
      reducedMotion: true,
    }),
    [V1_STORAGE_KEYS.run]: JSON.stringify({ schemaVersion: 1, wave: 9 }),
    [V1_STORAGE_KEYS.results]: JSON.stringify({ schemaVersion: 1, records: [] }),
  };
  for (const [key, value] of Object.entries(values)) {
    localStorage.setItem(key, value);
  }
  return values;
}

function expectV1KeysUnchanged(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    expect(localStorage.getItem(key)).toBe(value);
  }
}

function mountSettingsDom(): void {
  document.body.innerHTML = `
    <div id="settings-overlay" hidden>
      <div id="settings-list"></div>
      <p id="settings-message"></p>
    </div>
  `;
}

function settingsMessage(): string {
  return document.querySelector<HTMLElement>('#settings-message')?.textContent ?? '';
}

function clickRow(id: string): void {
  const button = document.querySelector<HTMLButtonElement>(`[data-row-id="${id}"]`);
  expect(button).not.toBeNull();
  button?.click();
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('V0.2 职业显示名', () => {
  it('四职业映射为爆破手/术士/骑士/战术家，角色数据使用同一份映射', () => {
    expect(CHARACTER_DISPLAY_NAMES).toEqual({
      vishdal: '爆破手',
      amiya: '术士',
      saria: '骑士',
      muelsyse: '战术家',
    });
    const ids = CHARACTER_LIST.map((character) => character.id);
    expect(ids).toEqual(['vishdal', 'amiya', 'saria', 'muelsyse']);
    for (const id of ids) {
      expect(getCharacter(id).name).toBe(CHARACTER_DISPLAY_NAMES[id]);
    }
  });

  it('旧名只保留内部兼容映射，不出现在任何角色显示名中', () => {
    const legacyNames = Object.values(LEGACY_CHARACTER_NAMES);
    expect(legacyNames).toEqual(['维什戴尔', '阿米娅', '塞雷娅', '缪尔赛思']);
    const displayed = CHARACTER_LIST.map((character) => character.name);
    for (const legacy of legacyNames) {
      expect(displayed).not.toContain(legacy);
    }
  });
});

describe('V1/V2 存档键隔离', () => {
  it('三个 V2 键与 V1 键不同，且设置/成绩/续局各自独立', () => {
    expect(V2_STORAGE_KEYS.settings).toBe('pixel-echo.v2.settings');
    expect(V2_STORAGE_KEYS.results).toBe('pixel-echo.v2.results');
    expect(V2_STORAGE_KEYS.run).toBe('pixel-echo.v2.run');
    for (const key of Object.values(V2_STORAGE_KEYS)) {
      expect(Object.values(V1_STORAGE_KEYS)).not.toContain(key);
    }
    expect(USER_SETTINGS_STORAGE_KEY).toBe(V2_STORAGE_KEYS.settings);
    expect(RUN_RESULTS_STORAGE_KEY).toBe(V2_STORAGE_KEYS.results);
    expect(RUN_SAVE_STORAGE_KEY).toBe(V2_STORAGE_KEYS.run);
    expect(RUN_SETTINGS_REGISTRY_KEY).not.toBe(V2_STORAGE_KEYS.settings);
  });

  it('V2 读取路径不读取 V1 键，写入与清除也不改动 V1 值', () => {
    const v1 = seedV1Keys();

    expect(loadUserSettings(localStorage)).toEqual(DEFAULT_USER_SETTINGS);
    expect(loadRunCheckpoint(localStorage)).toEqual({ status: 'none' });
    expect(loadRunResults(localStorage)).toEqual([]);
    expectV1KeysUnchanged(v1);

    expect(saveUserSettings({ ...DEFAULT_USER_SETTINGS, muted: true }, localStorage)).toBe(
      true,
    );
    expect(saveRunCheckpoint(validDraft(), localStorage, SAVED_AT)).toBe(true);
    appendRunResult(
      createRunResultRecord(
        {
          runId: 'run-v2',
          characterId: 'vishdal',
          outcome: 'defeat',
          wave: 3,
          durationSeconds: 42,
          kills: 4,
          damageDealt: 120,
          upgrades: [],
        },
        SAVED_AT,
      ),
      localStorage,
    );

    expect(localStorage.getItem(V2_STORAGE_KEYS.settings)).not.toBeNull();
    expect(localStorage.getItem(V2_STORAGE_KEYS.run)).not.toBeNull();
    expect(localStorage.getItem(V2_STORAGE_KEYS.results)).not.toBeNull();
    expectV1KeysUnchanged(v1);

    expect(clearRunCheckpoint(localStorage)).toBe(true);
    expect(localStorage.getItem(V2_STORAGE_KEYS.run)).toBeNull();
    expectV1KeysUnchanged(v1);
  });
});

describe('V0.1 设置导入', () => {
  it('只提取键位与静音，保留非法的逐项默认回退', () => {
    const settings = parseLegacySettings({
      keyBindings: { attack: 'KeyU', moveUp: 'Escape', dodge: 'KeyU' },
      muted: true,
      screenShake: false,
    });
    expect(settings).toEqual({
      keyBindings: {
        ...DEFAULT_KEY_BINDINGS,
        attack: 'KeyU',
        // attack 已显式占用 KeyU，skillU 的默认键位回退到首个空闲的默认 code。
        skillU: 'KeyJ',
      },
      muted: true,
    });
    // 导入结果不得出现重复绑定：显式键位优先，回退键位让位到未占用的 code。
    const imported = Object.values(settings!.keyBindings);
    expect(new Set(imported).size).toBe(imported.length);
    expect(settings!.keyBindings.dodge).toBe(DEFAULT_KEY_BINDINGS.dodge);
    expect(settings!.keyBindings.moveUp).toBe(DEFAULT_KEY_BINDINGS.moveUp);
    expect(parseLegacySettings('not-an-object')).toBeNull();
  });

  it('把旧键位显示名归一化为 KeyboardEvent.code，导入后 J 可触发攻击', () => {
    expect(normalizeLegacyKeyCode('J')).toBe('KeyJ');
    expect(normalizeLegacyKeyCode('j')).toBe('KeyJ');
    expect(normalizeLegacyKeyCode('KeyJ')).toBe('KeyJ');
    expect(normalizeLegacyKeyCode('ArrowUp')).toBe('ArrowUp');
    expect(normalizeLegacyKeyCode('Esc')).toBeNull();
    expect(normalizeLegacyKeyCode('Space')).toBeNull();
    expect(normalizeLegacyKeyCode('Key J')).toBeNull();
    expect(normalizeLegacyKeyCode('')).toBeNull();
    expect(normalizeLegacyKeyCode(42)).toBeNull();

    const settings = parseLegacySettings({
      keyBindings: {
        attack: 'J',
        skillK: 'k',
        skillL: 'KeyJ',
        moveUp: 'ArrowUp',
        moveDown: 'ArrowDown',
        moveLeft: 'ArrowLeft',
        moveRight: 'ArrowRight',
        dodge: 'Esc',
        cycleTarget: 'NoSuchKey',
      },
    });
    expect(settings).not.toBeNull();
    const bindings = settings!.keyBindings;
    expect(bindings.attack).toBe('KeyJ');
    expect(bindings.skillK).toBe(DEFAULT_KEY_BINDINGS.skillK);
    // skillL 与 attack 归一化后重复，回退默认键位。
    expect(bindings.skillL).toBe(DEFAULT_KEY_BINDINGS.skillL);
    expect(bindings.moveUp).toBe('ArrowUp');
    expect(bindings.moveDown).toBe('ArrowDown');
    expect(bindings.moveLeft).toBe('ArrowLeft');
    expect(bindings.moveRight).toBe('ArrowRight');
    expect(bindings.dodge).toBe(DEFAULT_KEY_BINDINGS.dodge);
    expect(bindings.cycleTarget).toBe(DEFAULT_KEY_BINDINGS.cycleTarget);
    expect(combatBindingActionForKeyCode(bindings, 'KeyJ')).toBe('attack');
  });

  it('读取结果区分缺失、已导入、损坏与可导入', () => {
    expect(readLegacySettingsForImport(localStorage)).toEqual({ status: 'missing' });

    localStorage.setItem(V1_STORAGE_KEYS.settings, '{broken');
    expect(readLegacySettingsForImport(localStorage)).toEqual({ status: 'corrupt' });

    localStorage.setItem(LEGACY_SETTINGS_IMPORT_MARKER_KEY, '1');
    expect(isLegacySettingsImportDone(localStorage)).toBe(true);
    expect(readLegacySettingsForImport(localStorage)).toEqual({
      status: 'already-imported',
    });
  });

  it('玩家取消确认时不写 V2、不改设置，V1 键保持不变', () => {
    mountSettingsDom();
    const v1 = seedV1Keys();
    const store = createSettingsStore({ storage: localStorage });
    const panel = mountSettingsPanel({
      doc: document,
      store,
      storage: localStorage,
      onBack: vi.fn(),
    });
    panel.show();

    expect(document.querySelector('[data-row-id="legacy-import"]')).not.toBeNull();
    clickRow('legacy-import');
    expect(settingsMessage()).toContain('确认导入');
    expect(settingsMessage()).toContain('不会导入');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }),
    );
    expect(settingsMessage()).toContain('已取消导入');
    expect(store.get().keyBindings).toEqual(DEFAULT_KEY_BINDINGS);
    expect(store.get().muted).toBe(false);
    expect(localStorage.getItem(V2_STORAGE_KEYS.settings)).toBeNull();
    expect(isLegacySettingsImportDone(localStorage)).toBe(false);
    expectV1KeysUnchanged(v1);
    panel.destroy();
  });

  it('确认后只导入键位与静音，不导入旧构筑/成绩/进度并标记完成', () => {
    mountSettingsDom();
    const v1 = seedV1Keys();
    const store = createSettingsStore({ storage: localStorage });
    const panel = mountSettingsPanel({
      doc: document,
      store,
      storage: localStorage,
      onBack: vi.fn(),
    });
    panel.show();

    clickRow('legacy-import');
    clickRow('legacy-import');

    expect(store.get().keyBindings.attack).toBe('KeyU');
    expect(store.get().keyBindings.dodge).toBe('KeyG');
    expect(store.get().muted).toBe(true);
    // V2 非迁移开关保持自身默认值。
    expect(store.get().screenShake).toBe(true);
    expect(store.get().reducedMotion).toBe(false);

    const saved = loadUserSettings(localStorage);
    expect(saved.keyBindings.attack).toBe('KeyU');
    expect(saved.muted).toBe(true);
    expect(localStorage.getItem(LEGACY_SETTINGS_IMPORT_MARKER_KEY)).toBe('1');
    expect(localStorage.getItem(V2_STORAGE_KEYS.run)).toBeNull();
    expect(localStorage.getItem(V2_STORAGE_KEYS.results)).toBeNull();
    expectV1KeysUnchanged(v1);
    expect(settingsMessage()).toContain('已导入');
    expect(document.querySelector('[data-row-id="legacy-import"]')).toBeNull();
    panel.destroy();
  });
});

// 保证映射测试覆盖全部角色 ID，新增角色时必须补映射。
const ALL_IDS: readonly CharacterId[] = ['vishdal', 'amiya', 'saria', 'muelsyse'];
it('显示名映射覆盖全部角色 ID', () => {
  expect(Object.keys(CHARACTER_DISPLAY_NAMES).sort()).toEqual([...ALL_IDS].sort());
});
