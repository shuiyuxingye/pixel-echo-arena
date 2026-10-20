/**
 * DOM 结算面板：显示胜败、角色、波次、用时、击杀、伤害与最终构筑。
 *
 * 三个动作全部可用键盘完成：W/S 或方向键移动焦点，Enter/空格确认。
 * 「查看记录」打开最近 10 局列表，Enter/Esc 返回结算菜单。
 */

import { getCharacter, getUpgrade, type CharacterId } from '../game/data';
import {
  formatRunDuration,
  formatRunRecordLine,
  type RunResultPayload,
  type RunResultRecord,
} from '../game/run-results';

export interface ResultPanelOptions {
  doc?: Document;
  /** 同角色重开；应用壳销毁本局并以同一角色创建新局。 */
  onRestart: (characterId: CharacterId) => void;
  onReturnToSelect: () => void;
  /** 读取最近成绩；每次打开记录时重新读取，避免使用过期列表。 */
  getRecords: () => readonly RunResultRecord[];
}

export interface ResultPanelHandle {
  show: (payload: RunResultPayload) => void;
  hide: () => void;
  isVisible: () => boolean;
}

const UP_KEYS = new Set(['ArrowUp', 'KeyW']);
const DOWN_KEYS = new Set(['ArrowDown', 'KeyS']);
const ACTIVATE_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);
const BACK_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'Escape', 'Backspace']);

interface ResultEntry {
  readonly button: HTMLButtonElement;
  readonly activate: () => void;
}

export function mountResultPanel({
  doc = document,
  onRestart,
  onReturnToSelect,
  getRecords,
}: ResultPanelOptions): ResultPanelHandle {
  const overlay = doc.querySelector<HTMLElement>('#result-overlay');
  const title = doc.querySelector<HTMLElement>('#result-title');
  const subtitle = doc.querySelector<HTMLElement>('#result-subtitle');
  const stats = doc.querySelector<HTMLElement>('#result-stats');
  const build = doc.querySelector<HTMLElement>('#result-build');
  const menu = doc.querySelector<HTMLElement>('#result-menu');
  const recordsView = doc.querySelector<HTMLElement>('#result-records-view');
  const recordList = doc.querySelector<HTMLOListElement>('#result-record-list');
  const recordsBack = doc.querySelector<HTMLButtonElement>('#result-records-back');
  const hint = doc.querySelector<HTMLElement>('#result-hint');
  const restartButton = doc.querySelector<HTMLButtonElement>('#result-restart');
  const selectButton = doc.querySelector<HTMLButtonElement>('#result-select');
  const recordsButton = doc.querySelector<HTMLButtonElement>('#result-records');

  if (
    !overlay ||
    !title ||
    !subtitle ||
    !stats ||
    !build ||
    !menu ||
    !recordsView ||
    !recordList ||
    !recordsBack ||
    !restartButton ||
    !selectButton ||
    !recordsButton
  ) {
    throw new Error('Result panel requires #result-overlay and its child elements');
  }

  let visible = false;
  let outcome: RunResultPayload | null = null;
  let focusIndex = 0;
  let recordsMode = false;
  let recordsFocus = 0;
  let recordEntries: HTMLLIElement[] = [];

  const entries: ResultEntry[] = [
    {
      button: restartButton,
      activate: () => {
        if (!outcome) return;
        onRestart(outcome.record.characterId);
      },
    },
    { button: selectButton, activate: () => onReturnToSelect() },
    { button: recordsButton, activate: () => openRecords() },
  ];

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

  const move = (delta: number): void => {
    if (entries.length === 0) return;
    focusIndex = (focusIndex + delta + entries.length) % entries.length;
    focusCurrent();
  };

  const renderStats = (record: RunResultRecord): void => {
    const character = getCharacter(record.characterId);
    const won = record.outcome === 'victory';
    title.textContent = won ? '试炼完成' : '试炼失败';
    subtitle.textContent = won
      ? `${character.name} · 第 ${record.wave} 波 · Boss 已击败`
      : `${character.name} · 第 ${record.wave} 波 · 生命归零`;

    stats.replaceChildren();
    const rows: readonly [string, string][] = [
      ['角色', character.name],
      ['波次', `第 ${record.wave} 波`],
      ['用时', formatRunDuration(record.durationSeconds)],
      ['击杀', String(record.kills)],
      ['伤害', String(Math.round(record.damageDealt))],
    ];
    for (const [label, value] of rows) {
      const term = doc.createElement('dt');
      term.textContent = label;
      const detail = doc.createElement('dd');
      detail.textContent = value;
      detail.dataset.stat = label;
      stats.append(term, detail);
    }

    build.textContent =
      record.upgrades.length > 0
        ? record.upgrades
            .map((entry) => {
              const card = getUpgrade(entry.id);
              return `${card.id} ${card.name} ×${entry.stacks}`;
            })
            .join(' / ')
        : '暂无强化';
  };

  const renderRecords = (): void => {
    recordList.replaceChildren();
    recordEntries = [];
    const records = getRecords();
    if (records.length === 0) {
      const empty = doc.createElement('li');
      empty.className = 'result-record-empty';
      empty.textContent = '暂无记录';
      recordList.append(empty);
      return;
    }

    for (const record of records) {
      const item = doc.createElement('li');
      item.className = 'result-record';
      item.tabIndex = -1;
      item.textContent = formatRunRecordLine(record);
      item.dataset.runId = record.runId;
      item.addEventListener('click', () => {
        recordsFocus = recordEntries.indexOf(item);
        renderRecordsFocus();
      });
      recordList.append(item);
      recordEntries.push(item);
    }
  };

  const renderRecordsFocus = (): void => {
    const total = recordEntries.length + 1;
    if (recordsFocus >= total) recordsFocus = total - 1;
    recordEntries.forEach((item, index) => {
      item.classList.toggle('is-focused', index === recordsFocus);
    });
    const backFocused = recordsFocus === recordEntries.length;
    recordsBack.classList.toggle('is-focused', backFocused);
    const target = backFocused ? recordsBack : recordEntries[recordsFocus];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: 'nearest' });
  };

  const openRecords = (): void => {
    if (!visible) return;
    recordsMode = true;
    recordsFocus = 0;
    menu.hidden = true;
    recordsView.hidden = false;
    if (hint) hint.textContent = 'W/S 或方向键浏览 · Enter / Esc 返回';
    renderRecords();
    renderRecordsFocus();
  };

  const closeRecords = (): void => {
    recordsMode = false;
    recordsView.hidden = true;
    menu.hidden = false;
    if (hint) hint.textContent = 'W/S 或方向键选择 · Enter 确认';
    const index = entries.findIndex((entry) => entry.button === recordsButton);
    focusIndex = index >= 0 ? index : 0;
    focusCurrent();
  };

  const moveRecords = (delta: number): void => {
    const total = recordEntries.length + 1;
    recordsFocus = (recordsFocus + delta + total) % total;
    renderRecordsFocus();
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!visible) return;
    if (recordsMode) {
      if (UP_KEYS.has(event.code)) {
        event.preventDefault();
        moveRecords(-1);
        return;
      }
      if (DOWN_KEYS.has(event.code)) {
        event.preventDefault();
        moveRecords(1);
        return;
      }
      if (BACK_KEYS.has(event.code)) {
        event.preventDefault();
        if (!event.repeat) closeRecords();
      }
      return;
    }

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
      if (!visible || recordsMode) return;
      focusIndex = index;
      renderFocus();
    });
  });
  recordsBack.addEventListener('click', () => {
    if (visible && recordsMode) closeRecords();
  });

  const hide = (): void => {
    visible = false;
    recordsMode = false;
    doc.removeEventListener('keydown', onKeyDown);
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
  };

  const show = (payload: RunResultPayload): void => {
    outcome = payload;
    visible = true;
    recordsMode = false;
    focusIndex = 0;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    recordsView.hidden = true;
    menu.hidden = false;
    renderStats(payload.record);
    subtitle.textContent += payload.saved ? '' : ' · 本局成绩未能保存';
    if (hint) hint.textContent = 'W/S 或方向键选择 · Enter 确认';
    doc.removeEventListener('keydown', onKeyDown);
    doc.addEventListener('keydown', onKeyDown);
    focusCurrent();
  };

  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');

  return {
    show,
    hide,
    isVisible: () => visible,
  };
}
