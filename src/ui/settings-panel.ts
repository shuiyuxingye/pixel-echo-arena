/**
 * DOM 设置页：战斗按键重绑、冲突提示、恢复默认、静音与屏震开关。
 *
 * 纯键盘操作：方向键/W-S 移动焦点，Enter/空格激活，Esc 返回；
 * 重绑时按 Esc 取消且不改变原绑定，冲突键不写回。所有修改经共享 store
 * 立即通知场景并持久化到 localStorage。
 */

import {
  KEY_BINDING_ACTIONS,
  KEY_BINDING_LABELS,
  findKeyBindingConflict,
  isBindableKeyCode,
  keyCodeLabel,
  type KeyBindingAction,
  type SettingsStore,
} from '../game/settings';
import {
  markLegacySettingsImportDone,
  readLegacySettingsForImport,
} from '../game/legacy-settings';

export interface SettingsPanelOptions {
  doc?: Document;
  store: SettingsStore;
  onBack: () => void;
  /** 旧设置导入来源；默认使用当前页面 localStorage。 */
  storage?: Storage | null;
}

export interface SettingsPanelHandle {
  show(): void;
  hide(): void;
  destroy(): void;
}

type ToggleSettingKey = 'muted' | 'screenShake' | 'reducedMotion';

type SettingsRow =
  | {
      readonly kind: 'binding';
      readonly id: string;
      readonly action: KeyBindingAction;
      readonly label: string;
    }
  | {
      readonly kind: 'toggle';
      readonly id: string;
      readonly key: ToggleSettingKey;
      readonly label: string;
    }
  | {
      readonly kind: 'action';
      readonly id: 'legacy-import' | 'reset' | 'back';
      readonly label: string;
    };

const TOGGLE_LABELS: Readonly<Record<ToggleSettingKey, string>> = {
  muted: '静音',
  screenShake: '屏幕震动',
  reducedMotion: '减少动态效果',
};

const BASE_SETTINGS_ROWS: readonly SettingsRow[] = [
  ...KEY_BINDING_ACTIONS.map((action) => ({
    kind: 'binding' as const,
    id: `binding:${action}`,
    action,
    label: KEY_BINDING_LABELS[action],
  })),
  { kind: 'toggle', id: 'toggle:muted', key: 'muted', label: TOGGLE_LABELS.muted },
  {
    kind: 'toggle',
    id: 'toggle:screenShake',
    key: 'screenShake',
    label: TOGGLE_LABELS.screenShake,
  },
  {
    kind: 'toggle',
    id: 'toggle:reducedMotion',
    key: 'reducedMotion',
    label: TOGGLE_LABELS.reducedMotion,
  },
  { kind: 'action', id: 'reset', label: '恢复默认键位' },
  { kind: 'action', id: 'back', label: '返回' },
];

/** 只有存在待导入的 V0.1 设置时才插入的额外行动行。 */
const LEGACY_IMPORT_ROW: SettingsRow = {
  kind: 'action',
  id: 'legacy-import',
  label: '导入 V0.1 键位与音量',
};

const UP_KEYS = new Set(['ArrowUp', 'KeyW']);
const DOWN_KEYS = new Set(['ArrowDown', 'KeyS']);
const ACTIVATE_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);
const BACK_KEYS = new Set(['Escape']);

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function mountSettingsPanel(
  options: SettingsPanelOptions,
): SettingsPanelHandle {
  const { doc = document, store, onBack } = options;
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  const overlay = doc.querySelector<HTMLElement>('#settings-overlay');
  const list = doc.querySelector<HTMLElement>('#settings-list');
  const messageElement = doc.querySelector<HTMLElement>('#settings-message');

  if (!overlay || !list || !messageElement) {
    throw new Error(
      'Settings requires #settings-overlay, #settings-list and #settings-message',
    );
  }

  let visible = false;
  let focusIndex = 0;
  let editingAction: KeyBindingAction | null = null;
  let message = '';
  let confirmingLegacyImport = false;
  let rows: SettingsRow[] = [];
  let buttons: HTMLButtonElement[] = [];

  const legacyImportAvailable = (): boolean =>
    readLegacySettingsForImport(storage).status === 'ready';

  const buildRows = (): SettingsRow[] =>
    legacyImportAvailable()
      ? [
          ...BASE_SETTINGS_ROWS.slice(0, -2),
          LEGACY_IMPORT_ROW,
          ...BASE_SETTINGS_ROWS.slice(-2),
        ]
      : [...BASE_SETTINGS_ROWS];

  const createButton = (row: SettingsRow): HTMLButtonElement => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'settings-row';
    button.dataset.rowId = row.id;
    button.setAttribute('role', row.kind === 'toggle' ? 'menuitemcheckbox' : 'menuitem');
    button.addEventListener('click', () => {
      if (!visible) return;
      focusIndex = buttons.indexOf(button);
      activate();
    });
    button.addEventListener('focus', () => {
      focusIndex = buttons.indexOf(button);
      renderFocus();
    });
    return button;
  };

  const renderFocus = (): void => {
    buttons.forEach((button, index) => {
      const focused = index === focusIndex;
      button.classList.toggle('is-focused', focused);
      button.tabIndex = focused ? 0 : -1;
      if (!focused && doc.activeElement === button) button.blur();
    });
  };

  const rebuildRows = (): void => {
    rows = buildRows();
    buttons = rows.map(createButton);
    list.setAttribute('role', 'menu');
    list.replaceChildren(...buttons);
    if (focusIndex >= buttons.length) focusIndex = Math.max(0, buttons.length - 1);
    renderFocus();
  };

  const focusCurrent = (): void => {
    const button = buttons[focusIndex];
    button?.focus({ preventScroll: true });
    renderFocus();
  };

  const render = (): void => {
    const settings = store.get();
    rows.forEach((row, index) => {
      const button = buttons[index];
      if (!button) return;
      let value = '';
      let checked: boolean | null = null;
      if (row.kind === 'binding') {
        value =
          editingAction === row.action
            ? '等待按键…（Esc 取消）'
            : keyCodeLabel(settings.keyBindings[row.action]);
      } else if (row.kind === 'toggle') {
        checked = settings[row.key];
        value = checked ? '开' : '关';
      }
      button.textContent = value ? `${row.label} · ${value}` : row.label;
      if (checked !== null) {
        button.setAttribute('aria-checked', checked ? 'true' : 'false');
      } else {
        button.removeAttribute('aria-checked');
      }
      button.classList.toggle(
        'is-editing',
        row.kind === 'binding' && editingAction === row.action,
      );
    });
    messageElement.textContent = message;
    renderFocus();
  };

  const toggle = (key: ToggleSettingKey): void => {
    const next = !store.get()[key];
    store.update({ [key]: next });
    message = `${TOGGLE_LABELS[key]}：${next ? '开' : '关'}`;
    render();
  };

  const confirmLegacyImport = (): void => {
    const result = readLegacySettingsForImport(storage);
    confirmingLegacyImport = false;
    if (result.status === 'ready') {
      store.importLegacySettings(result.settings);
      markLegacySettingsImportDone(storage);
      message = '已导入 V0.1 键位与音量；旧构筑、成绩与进度未导入';
    } else if (result.status === 'already-imported') {
      message = 'V0.1 设置已经导入过';
    } else if (result.status === 'corrupt') {
      message = 'V0.1 设置无法读取，已保持默认值';
    } else {
      message = '没有找到可导入的 V0.1 设置';
    }
    rebuildRows();
    render();
  };

  const activate = (): void => {
    const row = rows[focusIndex];
    if (!row) return;
    if (row.kind === 'binding') {
      editingAction = row.action;
      message = `按任意键绑定「${row.label}」 · Esc 取消`;
      render();
      return;
    }
    if (row.kind === 'toggle') {
      toggle(row.key);
      return;
    }
    if (row.id === 'legacy-import') {
      if (!confirmingLegacyImport) {
        confirmingLegacyImport = true;
        message =
          '确认导入 V0.1 的键位与音量？旧构筑、成绩与进度不会导入。Enter 确认，Esc 取消';
      } else {
        confirmLegacyImport();
        return;
      }
      render();
      return;
    }
    if (row.id === 'reset') {
      store.resetBindings();
      message = '已恢复默认键位';
      render();
      return;
    }
    back();
  };

  const handleEditingKey = (event: KeyboardEvent): void => {
    const code = event.code;
    if (BACK_KEYS.has(code)) {
      event.preventDefault();
      editingAction = null;
      message = '已取消编辑，原绑定保持不变';
      render();
      return;
    }
    if (!isBindableKeyCode(code)) {
      event.preventDefault();
      message = `${keyCodeLabel(code)} 保留给界面操作，请换一个键或按 Esc 取消`;
      render();
      return;
    }
    const action = editingAction;
    if (!action) return;
    event.preventDefault();
    const conflict = findKeyBindingConflict(
      store.get().keyBindings,
      action,
      code,
    );
    if (conflict) {
      message = `冲突：「${KEY_BINDING_LABELS[conflict]}」已使用 ${keyCodeLabel(
        code,
      )}；请换一个键或按 Esc 取消`;
      render();
      return;
    }
    store.rebind(action, code);
    message = `已把「${KEY_BINDING_LABELS[action]}」绑定到 ${keyCodeLabel(code)}`;
    editingAction = null;
    render();
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!visible) return;
    if (editingAction) {
      handleEditingKey(event);
      return;
    }
    if (UP_KEYS.has(event.code)) {
      event.preventDefault();
      focusIndex = (focusIndex - 1 + buttons.length) % buttons.length;
      focusCurrent();
      return;
    }
    if (DOWN_KEYS.has(event.code)) {
      event.preventDefault();
      focusIndex = (focusIndex + 1) % buttons.length;
      focusCurrent();
      return;
    }
    if (ACTIVATE_KEYS.has(event.code)) {
      event.preventDefault();
      if (!event.repeat) activate();
      return;
    }
    if (BACK_KEYS.has(event.code)) {
      event.preventDefault();
      if (event.repeat) return;
      if (confirmingLegacyImport) {
        confirmingLegacyImport = false;
        message = '已取消导入，V0.1 设置保持不变';
        render();
        return;
      }
      back();
    }
  }

  const hide = (): void => {
    visible = false;
    editingAction = null;
    confirmingLegacyImport = false;
    message = '';
    doc.removeEventListener('keydown', onKeyDown);
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
  };

  const back = (): void => {
    hide();
    onBack();
  };

  const show = (): void => {
    visible = true;
    editingAction = null;
    confirmingLegacyImport = false;
    message = '';
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    doc.removeEventListener('keydown', onKeyDown);
    doc.addEventListener('keydown', onKeyDown);
    rebuildRows();
    render();
    focusCurrent();
  };

  const unsubscribe = store.subscribe(() => {
    if (visible) render();
  });

  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  rebuildRows();
  render();

  return {
    show,
    hide,
    destroy: () => {
      unsubscribe();
      hide();
      list.replaceChildren();
    },
  };
}
