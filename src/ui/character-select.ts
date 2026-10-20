/**
 * DOM 选角页：四名角色的键盘焦点、64×64 场内精灵预览、J/K/L 与被动摘要。
 * 不依赖 Phaser；确认后由应用壳创建新一局。
 */

import {
  CharacterSelectState,
  CHARACTER_SELECT_ENTRIES,
  type CharacterSelectDirection,
  type CharacterSelectEntry,
} from '../game/character-select';
import { DEFAULT_CHARACTER_ID, type CharacterId } from '../game/data';

export interface CharacterSelectOptions {
  doc?: Document;
  onConfirm: (characterId: CharacterId) => void;
  onBack?: () => void;
  initialCharacterId?: CharacterId;
}

export interface CharacterSelectHandle {
  show(initialCharacterId?: CharacterId): void;
  hide(): void;
  destroy(): void;
  readonly focusedId: CharacterId;
}

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
const UP_KEYS = new Set(['ArrowUp', 'KeyW']);
const DOWN_KEYS = new Set(['ArrowDown', 'KeyS']);
const CONFIRM_KEYS = new Set(['Enter', 'NumpadEnter']);
const BACK_KEYS = new Set(['Escape']);

function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** 用同一张精灵表按最近邻放大显示下向待机首帧，确保和场内完全一致。 */
function createPreview(doc: Document, entry: CharacterSelectEntry): HTMLElement {
  const { preview } = entry;
  const art = createElement(doc, 'span', 'character-card-art');
  art.setAttribute('aria-hidden', 'true');
  art.dataset.previewPath = preview.path;
  art.style.width = `${preview.width}px`;
  art.style.height = `${preview.height}px`;
  art.style.backgroundImage = `url("${preview.path}")`;
  art.style.backgroundSize = `${preview.sheetWidth * preview.scale}px ${preview.sheetHeight * preview.scale}px`;
  const offsetX = preview.column * preview.frameWidth * preview.scale;
  const offsetY = preview.row * preview.frameHeight * preview.scale;
  art.style.backgroundPosition = `${offsetX === 0 ? '0px' : `-${offsetX}px`} ${
    offsetY === 0 ? '0px' : `-${offsetY}px`
  }`;
  return art;
}

function createCard(doc: Document, entry: CharacterSelectEntry): HTMLButtonElement {
  const card = createElement(doc, 'button', 'character-card');
  card.type = 'button';
  card.setAttribute('role', 'radio');
  card.setAttribute('aria-checked', 'false');
  card.dataset.characterId = entry.id;
  card.tabIndex = -1;

  card.append(createPreview(doc, entry));

  const body = createElement(doc, 'span', 'character-card-body');
  const head = createElement(doc, 'span', 'character-card-head');
  head.append(
    createElement(doc, 'span', 'character-card-name', entry.name),
    createElement(doc, 'span', 'character-card-role', entry.role),
  );
  body.append(head);

  const stats = createElement(
    doc,
    'span',
    'character-card-stats',
    `生命 ${entry.stats.maxHealth} · 护甲 ${entry.stats.armor} · 法抗 ${entry.stats.magicResistPercent}% · 移速 ${entry.stats.moveSpeed}`,
  );
  body.append(stats);

  for (const skill of entry.skills) {
    const line = createElement(doc, 'span', 'character-card-skill');
    line.dataset.skillKey = skill.key;
    const cooldown =
      skill.cooldownSeconds !== undefined ? `（${skill.cooldownSeconds} 秒冷却）` : '';
    line.append(
      createElement(doc, 'b', 'character-card-skill-key', skill.key),
      createElement(doc, 'span', 'character-card-skill-name', `${skill.name}${cooldown}`),
      createElement(doc, 'span', 'character-card-skill-desc', skill.description),
    );
    body.append(line);
  }

  const passive = createElement(doc, 'span', 'character-card-passive');
  passive.append(
    createElement(doc, 'b', 'character-card-passive-key', '被动'),
    createElement(doc, 'span', 'character-card-passive-name', entry.passive.name),
    createElement(doc, 'span', 'character-card-passive-desc', entry.passive.description),
  );
  body.append(passive);

  card.append(body);
  return card;
}

export function mountCharacterSelect({
  doc = document,
  onConfirm,
  onBack,
  initialCharacterId = DEFAULT_CHARACTER_ID,
}: CharacterSelectOptions): CharacterSelectHandle {
  const overlay = doc.querySelector<HTMLElement>('#character-select-overlay');
  const list = doc.querySelector<HTMLElement>('#character-select-list');

  if (!overlay || !list) {
    throw new Error('Character select requires #character-select-overlay and #character-select-list');
  }

  const state = new CharacterSelectState(initialCharacterId);
  const cards = CHARACTER_SELECT_ENTRIES.map((entry) => createCard(doc, entry));
  const cardsById = new Map<CharacterId, HTMLButtonElement>(
    cards.map((card) => [card.dataset.characterId as CharacterId, card]),
  );

  list.setAttribute('role', 'radiogroup');
  list.replaceChildren(...cards);

  let visible = false;
  let confirmed = false;

  const renderFocus = (): void => {
    for (const card of cards) {
      const focused = card.dataset.characterId === state.focusedId;
      const physicalFocus = doc.activeElement === card;
      card.classList.toggle('is-focused', focused);
      card.setAttribute('aria-checked', focused ? 'true' : 'false');
      card.tabIndex = focused ? 0 : -1;
      if (!focused && physicalFocus) card.blur();
    }
  };

  const focusFocusedCard = (): void => {
    cardsById.get(state.focusedId)?.focus({ preventScroll: true });
  };

  const hide = (): void => {
    visible = false;
    doc.removeEventListener('keydown', onKeyDown);
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
  };

  const show = (characterId: CharacterId = state.focusedId): void => {
    state.focusToCharacter(characterId);
    visible = true;
    confirmed = false;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    doc.removeEventListener('keydown', onKeyDown);
    doc.addEventListener('keydown', onKeyDown);
    renderFocus();
    focusFocusedCard();
  };

  const confirm = (): void => {
    if (confirmed) return;
    confirmed = true;
    onConfirm(state.confirm());
  };

  const move = (direction: CharacterSelectDirection): void => {
    if (state.moveFocus(direction)) {
      renderFocus();
      focusFocusedCard();
    }
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!visible) return;
    const code = event.code;

    if (LEFT_KEYS.has(code)) {
      event.preventDefault();
      move('left');
      return;
    }
    if (RIGHT_KEYS.has(code)) {
      event.preventDefault();
      move('right');
      return;
    }
    if (UP_KEYS.has(code)) {
      event.preventDefault();
      move('up');
      return;
    }
    if (DOWN_KEYS.has(code)) {
      event.preventDefault();
      move('down');
      return;
    }
    if (CONFIRM_KEYS.has(code)) {
      event.preventDefault();
      if (!event.repeat) confirm();
      return;
    }
    if (BACK_KEYS.has(code) && onBack) {
      event.preventDefault();
      hide();
      onBack();
    }
  }

  for (const card of cards) {
    card.addEventListener('click', () => {
      if (!visible) return;
      const id = card.dataset.characterId as CharacterId;
      state.focusToCharacter(id);
      renderFocus();
      focusFocusedCard();
      confirm();
    });
  }

  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  renderFocus();

  return {
    show,
    hide,
    destroy: () => {
      hide();
      list.replaceChildren();
    },
    get focusedId(): CharacterId {
      return state.focusedId;
    },
  };
}
