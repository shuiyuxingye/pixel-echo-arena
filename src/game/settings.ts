/**
 * 局外用户设置（docs/game-design.md §9）：保存在 localStorage，与单局临时状态分离。
 * 返回选角、死亡重开、刷新页面都不得清除这里的设置与键位。
 *
 * 键位重绑（docs/game-design.md §4）：编辑中的候选键先经过冲突检查，
 * 取消编辑不写回；设置面板与场景共用本模块的 store，修改立即通知订阅者并持久化。
 * 本模块不依赖 DOM/Phaser。
 */

import { V2_STORAGE_KEYS } from './storage-namespace';

export const USER_SETTINGS_STORAGE_KEY = V2_STORAGE_KEYS.settings;

/** Phaser registry 中共享设置 store 的键。 */
export const RUN_SETTINGS_REGISTRY_KEY = 'pixel-echo.settings-store';

export interface KeyBindings {
  readonly moveUp: string;
  readonly moveDown: string;
  readonly moveLeft: string;
  readonly moveRight: string;
  readonly attack: string;
  readonly skillK: string;
  readonly skillL: string;
  readonly skillU: string;
  readonly skillI: string;
  readonly dodge: string;
  readonly cycleTarget: string;
}

/** 与当前战斗实现一致的物理键位 code（docs/game-design.md §4）。 */
export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  moveUp: 'KeyW',
  moveDown: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  attack: 'KeyJ',
  skillK: 'KeyK',
  skillL: 'KeyL',
  skillU: 'KeyU',
  skillI: 'KeyI',
  dodge: 'Space',
  cycleTarget: 'Tab',
};

export interface UserSettings {
  readonly keyBindings: KeyBindings;
  readonly screenShake: boolean;
  readonly reducedMotion: boolean;
  readonly muted: boolean;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  keyBindings: DEFAULT_KEY_BINDINGS,
  screenShake: true,
  reducedMotion: false,
  muted: false,
};

const KEY_BINDING_KEYS = Object.keys(DEFAULT_KEY_BINDINGS) as (keyof KeyBindings)[];

/** localStorage 在隐私模式或测试外不可用时返回 null，调用方使用默认值继续。 */
function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 读取设置；缺失、损坏或字段类型不合法时逐字段回退默认值。 */
export function loadUserSettings(storage: Storage | null = defaultStorage()): UserSettings {
  const fallback = DEFAULT_USER_SETTINGS;
  if (!storage) return fallback;

  let parsed: unknown;
  try {
    const raw = storage.getItem(USER_SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  if (typeof parsed !== 'object' || parsed === null) return fallback;
  const record = parsed as Record<string, unknown>;
  const storedBindings =
    typeof record.keyBindings === 'object' && record.keyBindings !== null
      ? (record.keyBindings as Record<string, unknown>)
      : {};

  const keyBindings: KeyBindings = {
    ...DEFAULT_KEY_BINDINGS,
  };
  const writable = keyBindings as Record<keyof KeyBindings, string>;
  for (const key of KEY_BINDING_KEYS) {
    const value = storedBindings[key];
    if (typeof value === 'string' && value.length > 0) writable[key] = value;
  }

  return {
    keyBindings,
    screenShake: readBoolean(record.screenShake, fallback.screenShake),
    reducedMotion: readBoolean(record.reducedMotion, fallback.reducedMotion),
    muted: readBoolean(record.muted, fallback.muted),
  };
}

/** 写入设置；存储不可写时返回 false，调用方可提示“本局无法保存”。 */
export function saveUserSettings(
  settings: UserSettings,
  storage: Storage | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export type KeyBindingAction = keyof KeyBindings;

/** 设置面板展示顺序，与默认绑定字段一致。 */
export const KEY_BINDING_ACTIONS: readonly KeyBindingAction[] = KEY_BINDING_KEYS;

export const KEY_BINDING_LABELS: Readonly<Record<KeyBindingAction, string>> = {
  moveUp: '向上移动',
  moveDown: '向下移动',
  moveLeft: '向左移动',
  moveRight: '向右移动',
  attack: '普通攻击',
  skillK: '战术技能 K',
  skillL: '招牌技能 L',
  skillU: '自由技能 U',
  skillI: '自由技能 I',
  dodge: '闪避',
  cycleTarget: '切换提示目标',
};

export type MovementBindingAction =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight';

export const MOVEMENT_BINDING_ACTIONS: readonly MovementBindingAction[] = [
  'moveUp',
  'moveDown',
  'moveLeft',
  'moveRight',
];

const STATIC_KEY_LABELS: Readonly<Record<string, string>> = {
  Space: '空格',
  Tab: 'Tab',
  Escape: 'Esc',
  Enter: 'Enter',
  NumpadEnter: '小键盘 Enter',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: '左 Shift',
  ShiftRight: '右 Shift',
  ControlLeft: '左 Ctrl',
  ControlRight: '右 Ctrl',
  AltLeft: '左 Alt',
  AltRight: '右 Alt',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

/** 物理键位 code → 玩家可见的短标签。 */
export function keyCodeLabel(code: string): string {
  const known = STATIC_KEY_LABELS[code];
  if (known) return known;
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad') && code.length > 6) return `小键盘 ${code.slice(6)}`;
  return code || '未绑定';
}

const RESERVED_KEY_CODES: ReadonlySet<string> = new Set([
  'Escape',
  'Enter',
  'NumpadEnter',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
]);

/** Esc/Enter 用于界面导航，纯修饰键无法独立触发，均不允许参与战斗重绑。 */
export function isBindableKeyCode(code: string): boolean {
  return code.length > 0 && !RESERVED_KEY_CODES.has(code);
}

/** 返回同键位冲突的其它动作；同一动作重复绑定自己的键不算冲突。 */
export function findKeyBindingConflict(
  bindings: KeyBindings,
  action: KeyBindingAction,
  code: string,
): KeyBindingAction | null {
  for (const other of KEY_BINDING_ACTIONS) {
    if (other === action) continue;
    if (bindings[other] === code) return other;
  }
  return null;
}

/** 纯函数：返回替换单个绑定后的新对象，不修改入参。 */
export function applyKeyBinding(
  bindings: KeyBindings,
  action: KeyBindingAction,
  code: string,
): KeyBindings {
  return { ...bindings, [action]: code };
}

/** 恢复默认键位；始终返回新对象，避免共享 DEFAULT 引用。 */
export function resetKeyBindings(): KeyBindings {
  return { ...DEFAULT_KEY_BINDINGS };
}

/** 当前键位中由该 code 触发的战斗动作；未绑定返回 null。 */
export function combatBindingActionForKeyCode(
  bindings: KeyBindings,
  code: string,
): KeyBindingAction | null {
  for (const action of KEY_BINDING_ACTIONS) {
    if (bindings[action] === code) return action;
  }
  return null;
}

/**
 * 界面快捷键（如 B 构筑面板）的冲突判定：该 code 是否已被战斗动作占用。
 * 只回答“会不会吞掉战斗输入”，不解析具体动作。
 */
export function isKeyBoundToCombatAction(
  bindings: KeyBindings,
  code: string,
): boolean {
  return combatBindingActionForKeyCode(bindings, code) !== null;
}

export function movementBindingActionForKeyCode(
  bindings: KeyBindings,
  code: string,
): MovementBindingAction | null {
  for (const action of MOVEMENT_BINDING_ACTIONS) {
    if (bindings[action] === code) return action;
  }
  return null;
}

export interface RebindResult {
  readonly ok: boolean;
  /** 失败时为已占用该键的其它动作。 */
  readonly conflict: KeyBindingAction | null;
}

export interface SettingsStore {
  get(): UserSettings;
  /** 立即应用并持久化非键位设置；返回最新完整设置。 */
  update(patch: Partial<Omit<UserSettings, 'keyBindings'>>): UserSettings;
  /** 冲突时不写入，保持原绑定；取消编辑由调用方直接丢弃候选键。 */
  rebind(action: KeyBindingAction, code: string): RebindResult;
  resetBindings(): UserSettings;
  /**
   * 一次性导入 V0.1 的键位与静音开关；由玩家确认后调用。
   * 屏幕震动/减少动态效果不迁移，保持当前 V2 设置。
   */
  importLegacySettings(patch: {
    readonly keyBindings: KeyBindings;
    readonly muted: boolean;
  }): UserSettings;
  /** 立即通知；返回取消订阅函数。 */
  subscribe(listener: (settings: UserSettings) => void): () => void;
  /** 最近一次写入是否成功；存储不可用时为 false，游戏可照常继续。 */
  readonly lastSaveOk: boolean;
  /** 当前订阅者数量；开发诊断用它确认场景销毁后没有残留订阅。 */
  readonly subscriberCount: number;
}

export interface SettingsStoreOptions {
  readonly storage?: Storage | null;
  readonly initial?: UserSettings;
}

/**
 * 共享设置 store：面板修改后立即通知场景与帮助页，并写入 localStorage。
 * 存储不可写只影响持久化，不阻断当前页面的立即生效。
 */
export function createSettingsStore(
  options: SettingsStoreOptions = {},
): SettingsStore {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  let current = options.initial ?? loadUserSettings(storage);
  let lastSaveOk = true;
  const listeners = new Set<(settings: UserSettings) => void>();

  const commit = (next: UserSettings): UserSettings => {
    current = next;
    lastSaveOk = saveUserSettings(current, storage);
    for (const listener of [...listeners]) listener(current);
    return current;
  };

  return {
    get: () => current,
    update: (patch) => commit({ ...current, ...patch }),
    rebind: (action, code) => {
      const conflict = findKeyBindingConflict(current.keyBindings, action, code);
      if (conflict) return { ok: false, conflict };
      commit({
        ...current,
        keyBindings: applyKeyBinding(current.keyBindings, action, code),
      });
      return { ok: true, conflict: null };
    },
    resetBindings: () =>
      commit({ ...current, keyBindings: resetKeyBindings() }),
    importLegacySettings: (patch) =>
      commit({
        ...current,
        keyBindings: { ...patch.keyBindings },
        muted: patch.muted,
      }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get lastSaveOk() {
      return lastSaveOk;
    },
    get subscriberCount() {
      return listeners.size;
    },
  };
}
