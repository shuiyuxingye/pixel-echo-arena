/**
 * DOM 暂停面板：继续 / 帮助 / 设置 / 返回选角，全部可用键盘焦点操作。
 *
 * 失焦或续局恢复触发的暂停只接受 Enter 继续；手动 Esc 暂停可用 Esc 直接返回。
 */

import {
  pauseRequiresEnter,
  type PauseReason,
  type PauseResumeInput,
} from '../game/pause';

export interface PauseMenuOptions {
  doc?: Document;
  onContinue: (input: PauseResumeInput) => void;
  onHelp?: () => void;
  onSettings?: () => void;
  onReturnToSelect?: () => void;
}

export interface PauseMenuHandle {
  show(reason?: PauseReason): void;
  hide(): void;
  isVisible(): boolean;
  readonly reason: PauseReason | null;
}

const UP_KEYS = new Set(['ArrowUp', 'KeyW']);
const DOWN_KEYS = new Set(['ArrowDown', 'KeyS']);
const ACTIVATE_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);

const REASON_TEXT: Readonly<Record<PauseReason, string>> = {
  manual: '按 Esc 或 Enter 继续',
  blur: '窗口失焦已自动暂停 · 按 Enter 明确继续',
  checkpoint: '已从检查点恢复 · 按 Enter 明确继续',
};

interface PauseEntry {
  readonly button: HTMLButtonElement;
  readonly activate: () => void;
}

export function mountPauseMenu({
  doc = document,
  onContinue,
  onHelp,
  onSettings,
  onReturnToSelect,
}: PauseMenuOptions): PauseMenuHandle {
  const overlay = doc.querySelector<HTMLElement>('#pause-overlay');
  const reasonElement = doc.querySelector<HTMLElement>('#pause-reason');
  if (!overlay || !reasonElement) {
    throw new Error('Pause menu requires #pause-overlay and #pause-reason');
  }
  const reasonText = reasonElement;

  const entries: PauseEntry[] = [];
  const addEntry = (
    button: HTMLButtonElement | null,
    activate: () => void,
  ): void => {
    if (button) entries.push({ button, activate });
  };

  addEntry(doc.querySelector<HTMLButtonElement>('#pause-continue'), () =>
    onContinue('enter'),
  );
  addEntry(doc.querySelector<HTMLButtonElement>('#pause-help'), () => {
    onHelp?.();
  });
  addEntry(doc.querySelector<HTMLButtonElement>('#pause-settings'), () => {
    onSettings?.();
  });
  addEntry(doc.querySelector<HTMLButtonElement>('#pause-return'), () => {
    onReturnToSelect?.();
  });

  let visible = false;
  let focusIndex = 0;
  let reasonValue: PauseReason | null = null;

  const renderFocus = (): void => {
    entries.forEach((entry, index) => {
      const focused = index === focusIndex;
      entry.button.classList.toggle('is-focused', focused);
      entry.button.tabIndex = focused ? 0 : -1;
    });
  };

  const focusCurrent = (): void => {
    entries[focusIndex]?.button.focus({ preventScroll: true });
    renderFocus();
  };

  const hide = (): void => {
    visible = false;
    doc.removeEventListener('keydown', onKeyDown);
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
  };

  const show = (reason: PauseReason = reasonValue ?? 'manual'): void => {
    reasonValue = reason;
    visible = true;
    reasonText.textContent = REASON_TEXT[reason];
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    doc.removeEventListener('keydown', onKeyDown);
    doc.addEventListener('keydown', onKeyDown);
    focusIndex = 0;
    focusCurrent();
  };

  const move = (delta: number): void => {
    if (entries.length === 0) return;
    focusIndex = (focusIndex + delta + entries.length) % entries.length;
    focusCurrent();
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!visible) return;
    if (UP_KEYS.has(event.code)) {
      event.preventDefault();
      move(-1);
      return;
    }
    if (DOWN_KEYS.has(event.code)) {
      event.preventDefault();
      move(1);
      return;
    }
    if (ACTIVATE_KEYS.has(event.code)) {
      event.preventDefault();
      if (!event.repeat) entries[focusIndex]?.activate();
      return;
    }
    if (event.code === 'Escape') {
      event.preventDefault();
      if (event.repeat) return;
      if (pauseRequiresEnter(reasonValue)) {
        reasonText.textContent = '失焦暂停只能按 Enter 明确继续';
        return;
      }
      onContinue('escape');
    }
  }

  entries.forEach((entry, index) => {
    entry.button.addEventListener('click', () => {
      if (!visible) return;
      focusIndex = index;
      renderFocus();
      entry.activate();
    });
    entry.button.addEventListener('focus', () => {
      focusIndex = index;
      renderFocus();
    });
  });

  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');

  return {
    show,
    hide,
    isVisible: () => visible,
    get reason() {
      return reasonValue;
    },
  };
}
