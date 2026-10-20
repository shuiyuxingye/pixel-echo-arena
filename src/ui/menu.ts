/**
 * DOM 主菜单：标题 + 继续/开始/帮助/设置按钮。
 * 纯键盘可用：方向键或 W/S 移动可见焦点，Enter/空格激活，鼠标只作为可选便利。
 * 有续局快照时置顶“继续试炼”；损坏或未知版本的快照给出可见提示与键盘确认重置。
 */

/** 主菜单显示时查询的续局状态；由应用壳读取 localStorage 后提供。 */
export interface MenuResumeState {
  readonly available: boolean;
  readonly invalid: 'corrupt' | 'unsupported' | null;
  readonly detail?: string;
}

export interface MenuOptions {
  doc?: Document;
  onStart: () => void;
  onContinue?: () => void;
  onHelp?: () => void;
  onSettings?: () => void;
  getResumeState?: () => MenuResumeState;
  /** 键盘确认清除损坏/未知版本的续局存档（只删除本游戏的键）。 */
  onResetSave?: () => void;
}

export interface MenuHandle {
  show: () => void;
  hide: () => void;
  focusStart: () => void;
  /** 重新读取续局状态并刷新按钮与提示。 */
  refresh: () => void;
}

const ENTER_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);
const FOCUS_UP_KEYS = new Set(['ArrowUp', 'KeyW']);
const FOCUS_DOWN_KEYS = new Set(['ArrowDown', 'KeyS']);

const NO_RESUME: MenuResumeState = { available: false, invalid: null };

interface MenuEntry {
  readonly button: HTMLButtonElement;
  readonly activate: () => void;
}

export function mountMenu({
  doc = document,
  onStart,
  onContinue,
  onHelp,
  onSettings,
  getResumeState,
  onResetSave,
}: MenuOptions): MenuHandle {
  const overlay = doc.querySelector<HTMLElement>('#menu-overlay');
  const startButton = doc.querySelector<HTMLButtonElement>('#start-button');
  const continueButton = doc.querySelector<HTMLButtonElement>('#continue-button');
  const resetButton = doc.querySelector<HTMLButtonElement>('#reset-save-button');
  const saveNotice = doc.querySelector<HTMLElement>('#save-notice');

  if (!overlay || !startButton) {
    throw new Error('Menu requires #menu-overlay and #start-button');
  }

  let entries: MenuEntry[] = [];
  let started = false;
  let visible = true;
  let focusIndex = 0;

  const renderFocus = (): void => {
    entries.forEach((entry, index) => {
      entry.button.classList.toggle('is-focused', index === focusIndex);
      entry.button.tabIndex = index === focusIndex ? 0 : -1;
    });
  };

  const focusCurrent = (): void => {
    entries[focusIndex]?.button.focus({ preventScroll: true });
    renderFocus();
  };

  const hide = (): void => {
    visible = false;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    // 隐藏后不再响应 Enter；show() 会重新挂载监听。
    doc.removeEventListener('keydown', onKeyDown);
  };

  const start = (): void => {
    if (started) return;
    started = true;
    doc.removeEventListener('keydown', onKeyDown);
    hide();
    onStart();
  };

  const resume = (): void => {
    if (started) return;
    started = true;
    doc.removeEventListener('keydown', onKeyDown);
    hide();
    onContinue?.();
  };

  const buildEntries = (state: MenuResumeState): void => {
    entries = [];
    const add = (
      button: HTMLButtonElement | null,
      activate: () => void,
    ): void => {
      if (button) entries.push({ button, activate });
    };

    if (state.available && onContinue) {
      add(continueButton, resume);
    }
    add(startButton, start);
    add(doc.querySelector<HTMLButtonElement>('#help-button'), () => {
      onHelp?.();
    });
    add(doc.querySelector<HTMLButtonElement>('#settings-button'), () => {
      onSettings?.();
    });
    if (state.invalid && onResetSave) {
      add(resetButton, () => {
        onResetSave();
        refresh();
      });
    }
  };

  const refresh = (): void => {
    const state = getResumeState?.() ?? NO_RESUME;
    if (continueButton) continueButton.hidden = !(state.available && onContinue);
    if (resetButton) resetButton.hidden = !(state.invalid && onResetSave);
    if (saveNotice) {
      saveNotice.hidden = !state.invalid;
      saveNotice.textContent = state.invalid
        ? state.invalid === 'unsupported'
          ? '续局存档版本不受支持。按 Enter 清除本游戏存档后重新开始。'
          : `续局存档损坏（${state.detail ?? '无法读取'}）。按 Enter 清除本游戏存档后重新开始。`
        : '';
    }

    buildEntries(state);
    if (focusIndex >= entries.length) focusIndex = 0;
    // 有续局时默认聚焦“继续试炼”，否则回到开始按钮。
    if (state.available && onContinue) focusIndex = 0;
    renderFocus();
  };

  const show = (): void => {
    started = false;
    visible = true;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    doc.removeEventListener('keydown', onKeyDown);
    doc.addEventListener('keydown', onKeyDown);
    refresh();
    focusCurrent();
  };

  const focusStart = (): void => {
    const index = entries.findIndex((entry) => entry.button === startButton);
    focusIndex = index >= 0 ? index : 0;
    focusCurrent();
  };

  const move = (delta: number): void => {
    if (entries.length === 0) return;
    focusIndex = (focusIndex + delta + entries.length) % entries.length;
    focusCurrent();
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!visible) return;
    if (ENTER_KEYS.has(event.code) || ENTER_KEYS.has(event.key)) {
      event.preventDefault();
      if (!event.repeat) entries[focusIndex]?.activate();
      return;
    }
    if (FOCUS_UP_KEYS.has(event.code)) {
      event.preventDefault();
      move(-1);
      return;
    }
    if (FOCUS_DOWN_KEYS.has(event.code)) {
      event.preventDefault();
      move(1);
    }
  }

  /** 按钮事件在每次 refresh 后按当前 entries 对齐。 */
  const bindButton = (button: HTMLButtonElement | null): void => {
    if (!button) return;
    button.addEventListener('click', () => {
      if (!visible) return;
      const index = entries.findIndex((entry) => entry.button === button);
      if (index < 0) return;
      focusIndex = index;
      renderFocus();
      entries[index]?.activate();
    });
    button.addEventListener('focus', () => {
      const index = entries.findIndex((entry) => entry.button === button);
      if (index < 0) return;
      focusIndex = index;
      renderFocus();
    });
  };

  bindButton(continueButton);
  bindButton(startButton);
  bindButton(doc.querySelector<HTMLButtonElement>('#help-button'));
  bindButton(doc.querySelector<HTMLButtonElement>('#settings-button'));
  bindButton(resetButton);

  doc.addEventListener('keydown', onKeyDown);
  refresh();
  focusCurrent();

  return { show, hide, focusStart, refresh };
}
