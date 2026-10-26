/**
 * V0.1 设置的一次性导入：只迁移键位与静音（音量）开关。
 *
 * - 旧构筑、旧成绩与 9 波进行中进度一律不导入；
 * - 必须由玩家在设置页二次确认后调用，取消不写任何键；
 * - 导入完成后写入 V2 标记，不再重复提示；
 * - V2 读路径（settings/run-save/run-results）不读取这里的 V1 键。
 * 本模块不依赖 DOM/Phaser。
 */

import {
  DEFAULT_KEY_BINDINGS,
  KEY_BINDING_ACTIONS,
  isBindableKeyCode,
  type KeyBindings,
} from './settings';
import {
  LEGACY_SETTINGS_IMPORT_MARKER_KEY,
  V1_STORAGE_KEYS,
} from './storage-namespace';

/** 可迁移的旧设置子集：键位与静音开关。 */
export interface LegacySettingsSnapshot {
  readonly keyBindings: KeyBindings;
  readonly muted: boolean;
}

export type LegacySettingsImportResult =
  | { readonly status: 'missing' }
  | { readonly status: 'already-imported' }
  | { readonly status: 'corrupt' }
  | { readonly status: 'ready'; readonly settings: LegacySettingsSnapshot };

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * 已被 V0.2 认可的 `KeyboardEvent.code` 形态。
 * 刻意不含 `Esc`、`Space` 与纯修饰键：旧版保存的是显示名，无法可靠转成物理 code。
 */
const KEYBOARD_CODE_PATTERN =
  /^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(?:Up|Down|Left|Right)|F(?:[1-9]|1[0-2])|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Tab|Home|End|PageUp|PageDown|Insert|Delete)$/;

/**
 * 把 V0.1 键位显示名归一化为 `KeyboardEvent.code`。
 * 单字母（大小写均可）转成 `Key{大写字母}`；已经是合法 code 的原样返回；
 * 其余（`Esc`、`Space`、含空格、空串、非字符串）返回 null，由调用方回退默认键位。
 */
export function normalizeLegacyKeyCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (/^[A-Za-z]$/.test(value)) return `Key${value.toUpperCase()}`;
  return KEYBOARD_CODE_PATTERN.test(value) ? value : null;
}

/**
 * 把 V0.1 设置 JSON 解析为可导入子集。
 * 键位先归一化为物理 code；非法、保留键或重复的键位逐项回退默认值，避免把坏绑定带进 V2；
 * `muted` 不是布尔值时按未静音处理。
 */
export function parseLegacySettings(value: unknown): LegacySettingsSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const stored =
    typeof record.keyBindings === 'object' && record.keyBindings !== null
      ? (record.keyBindings as Record<string, unknown>)
      : {};

  const keyBindings: KeyBindings = { ...DEFAULT_KEY_BINDINGS };
  const writable = keyBindings as Record<keyof KeyBindings, string>;
  const used = new Set<string>();
  for (const action of KEY_BINDING_ACTIONS) {
    const candidate = normalizeLegacyKeyCode(stored[action]);
    if (candidate !== null && isBindableKeyCode(candidate) && !used.has(candidate)) {
      writable[action] = candidate;
      used.add(candidate);
      continue;
    }
    const fallback = DEFAULT_KEY_BINDINGS[action];
    const safeFallback = used.has(fallback)
      ? (KEY_BINDING_ACTIONS.map((key) => DEFAULT_KEY_BINDINGS[key]).find(
          (code) => !used.has(code),
        ) ?? fallback)
      : fallback;
    writable[action] = safeFallback;
    used.add(safeFallback);
  }

  return {
    keyBindings,
    muted: typeof record.muted === 'boolean' ? record.muted : false,
  };
}

/** 旧设置导入是否已完成（或玩家已明确处理过）。 */
export function isLegacySettingsImportDone(
  storage: Storage | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(LEGACY_SETTINGS_IMPORT_MARKER_KEY) === '1';
  } catch {
    return false;
  }
}

/** 记录“旧设置导入已处理”，避免下一次进入设置页再次提示。 */
export function markLegacySettingsImportDone(
  storage: Storage | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LEGACY_SETTINGS_IMPORT_MARKER_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取可导入的旧设置。只读取 `pixel-echo.settings.v1`：
 * 缺失返回 `missing`，标记已存在返回 `already-imported`，
 * JSON 损坏返回 `corrupt`，其余返回键位与静音子集。
 */
export function readLegacySettingsForImport(
  storage: Storage | null = defaultStorage(),
): LegacySettingsImportResult {
  if (!storage) return { status: 'missing' };
  if (isLegacySettingsImportDone(storage)) return { status: 'already-imported' };

  let raw: string | null;
  try {
    raw = storage.getItem(V1_STORAGE_KEYS.settings);
  } catch {
    return { status: 'missing' };
  }
  if (!raw) return { status: 'missing' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt' };
  }
  const settings = parseLegacySettings(parsed);
  if (!settings) return { status: 'corrupt' };
  return { status: 'ready', settings };
}
