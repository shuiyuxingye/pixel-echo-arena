import { ITEM_ART, NAME_ART } from '../game/art-manifest';
/**
 * DOM 商店面板（US-046）：只负责渲染 `ShopUiView` 并把键盘/点击转成动作。
 * 所有交易与状态都在场景/纯模块里，面板不直接改金币或库存。
 */

import {
  SHOP_UI_PAGES,
  isNegativeShopLine,
  shopEntrySlotLabel,
  type ShopUiAction,
  type ShopUiEntry,
  type ShopUiView,
} from '../game/shop-ui';
import { ShopKeyGate } from '../game/shop-transaction';

export interface ShopPanelOptions {
  readonly doc?: Document;
  readonly onAction: (action: ShopUiAction) => void;
}

export interface ShopPanelHandle {
  show(view: ShopUiView): void;
  update(view: ShopUiView): void;
  hide(): void;
  isVisible(): boolean;
  destroy(): void;
}

interface Elements {
  readonly overlay: HTMLElement;
  readonly title: HTMLElement;
  readonly meta: HTMLElement;
  readonly tabs: HTMLElement;
  readonly main: HTMLElement;
  readonly tracking: HTMLElement;
  readonly detail: HTMLElement;
  readonly confirm: HTMLElement;
  readonly message: HTMLElement;
  readonly skills: HTMLElement;
  readonly reroll: HTMLElement;
  readonly lock: HTMLElement;
  readonly nextWave: HTMLButtonElement;
  readonly hint: HTMLElement;
}

function findElements(doc: Document): Elements {
  const pick = <T extends HTMLElement>(id: string): T => {
    const found = doc.querySelector<T>(`#${id}`);
    if (!found) throw new Error(`Shop panel requires #${id}`);
    return found;
  };
  return {
    overlay: pick('shop-overlay'),
    title: pick('shop-title'),
    meta: pick('shop-meta'),
    tabs: pick('shop-tabs'),
    main: pick('shop-main'),
    tracking: pick('shop-tracking'),
    detail: pick('shop-detail'),
    confirm: pick('shop-confirm'),
    message: pick('shop-message'),
    skills: pick('shop-skills'),
    reroll: pick('shop-reroll'),
    lock: pick('shop-lock'),
    nextWave: pick<HTMLButtonElement>('shop-next-wave'),
    hint: pick('shop-hint'),
  };
}

const MOVE_LEFT = new Set(['ArrowLeft', 'KeyA']);
const MOVE_RIGHT = new Set(['ArrowRight', 'KeyD']);
const MOVE_UP = new Set(['ArrowUp', 'KeyW']);
const MOVE_DOWN = new Set(['ArrowDown', 'KeyS']);
const ACTIVATE = new Set(['Enter', 'NumpadEnter']);
const GATED = new Set(['Enter', 'NumpadEnter', 'KeyR', 'KeyF', 'Tab', 'Space', 'Escape']);

function toneClass(tone: string): string {
  return tone === 'neutral' ? '' : ` is-${tone}`;
}

function clear(element: HTMLElement): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function make<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function appendLines(
  doc: Document,
  parent: HTMLElement,
  lines: readonly string[],
  className: string,
  marker: string,
  negativeCheck = false,
): void {
  for (const line of lines) {
    const negative = negativeCheck && isNegativeShopLine(line);
    const row = make(
      doc,
      'p',
      `${className}${negative ? ' is-cost' : ''}`,
      `${marker}${line}`,
    );
    parent.appendChild(row);
  }
}

function renderEntry(
  doc: Document,
  entry: ShopUiEntry,
  focused: boolean,
  confirming: boolean,
): HTMLButtonElement {
  const card = make(doc, 'button', 'shop-card');
  card.type = 'button';
  card.dataset.key = entry.key;
  card.tabIndex = -1;
  card.setAttribute('aria-disabled', entry.disabled ? 'true' : 'false');
  if (focused) card.classList.add('is-focused');
  if (confirming) card.classList.add('is-confirming');
  if (entry.highlight) card.classList.add('is-highlight');
  if (entry.disabled) card.classList.add('is-disabled');

  const head = make(doc, 'span', 'shop-card-head');
  const slotLabel = shopEntrySlotLabel(entry);
  head.appendChild(make(doc, 'span', 'shop-card-slot', slotLabel));
  head.appendChild(make(doc, 'span', 'shop-card-name', entry.name));
  if (entry.rarity) {
    head.appendChild(make(doc, 'span', 'shop-card-rarity', entry.rarity));
  } else if (entry.tag && entry.tag !== slotLabel) {
    head.appendChild(make(doc, 'span', 'shop-card-rarity', entry.tag));
  }
  card.appendChild(head);
  const artPath = ITEM_ART[entry.id] ?? NAME_ART[entry.name];
  if (artPath) {
    const image = make(doc, 'img', 'shop-item-art');
    image.src = artPath; image.alt = ''; image.setAttribute('aria-hidden', 'true');
    card.appendChild(image);
  }

  card.appendChild(
    make(doc, 'span', 'shop-card-price', entry.priceLabel),
  );

  const benefitBox = make(doc, 'span', 'shop-card-section');
  appendLines(doc, benefitBox, entry.benefit, 'shop-card-line is-benefit', '▲ ');
  card.appendChild(benefitBox);

  const costBox = make(doc, 'span', 'shop-card-section');
  appendLines(doc, costBox, entry.cost, 'shop-card-line', '▼ ', true);
  card.appendChild(costBox);

  if (entry.meta.length > 0) {
    const metaBox = make(doc, 'span', 'shop-card-meta');
    for (const line of entry.meta) {
      metaBox.appendChild(make(doc, 'span', 'shop-card-meta-line', line));
    }
    card.appendChild(metaBox);
  }

  if (entry.stateLabel) {
    card.appendChild(make(doc, 'span', 'shop-card-state', entry.stateLabel));
  }
  if (entry.disabledReason) {
    card.appendChild(
      make(doc, 'span', 'shop-card-disabled', `禁用：${entry.disabledReason}`),
    );
  }
  return card;
}

function renderTracking(doc: Document, view: ShopUiView): HTMLElement {
  const box = make(doc, 'div', 'shop-tracking');
  const tracking = view.tracking;
  if (!tracking.tracked) {
    box.appendChild(
      make(doc, 'p', 'shop-tracking-empty', '未追踪 · Tab 到配方页选择'),
    );
    return box;
  }

  box.appendChild(
    make(
      doc,
      'p',
      'shop-tracking-title',
      `${tracking.name ?? tracking.recipeId ?? ''} · 材料 ${tracking.ownedIngredients}/${tracking.requiredIngredients}`,
    ),
  );
  const list = make(doc, 'ul', 'shop-tracking-list');
  for (const ingredient of tracking.ingredients) {
    const item = make(doc, 'li', ingredient.missing ? 'is-missing' : 'is-ready');
    item.textContent = `${ingredient.name} ${ingredient.stacks}/${ingredient.required}${
      ingredient.missing ? '（缺）' : ' ✓'
    }`;
    list.appendChild(item);
  }
  box.appendChild(list);

  if (tracking.craftable) {
    box.appendChild(
      make(
        doc,
        'p',
        'shop-craftable',
        `材料已齐 · 可合成${tracking.fee !== null ? `（手续费 ${tracking.fee}）` : ''} · Tab 到配方页`,
      ),
    );
  } else if (tracking.missingNames.length > 0) {
    box.appendChild(
      make(doc, 'p', 'shop-tracking-missing', `缺 ${tracking.missingNames.join('/')}`),
    );
  }
  return box;
}

function renderDetail(doc: Document, container: HTMLElement, view: ShopUiView): void {
  clear(container);
  container.appendChild(
    make(doc, 'h3', 'shop-detail-title', `选中：${view.detailTitle}`),
  );
  for (const line of view.detail) {
    container.appendChild(
      make(doc, 'p', `shop-detail-line${toneClass(line.tone)}`, line.text),
    );
  }
}

export function mountShopPanel({
  doc = document,
  onAction,
}: ShopPanelOptions): ShopPanelHandle {
  const elements = findElements(doc);
  const gate = new ShopKeyGate();
  let visible = false;

  const render = (view: ShopUiView): void => {
    elements.title.textContent = view.title;

    clear(elements.meta);
    const metaRows: ReadonlyArray<readonly [string, string]> = [
      ['金币', `${view.gold}`],
      ['生命', `${view.health}/${view.maxHealth}`],
      ['护盾', `${view.shield}`],
      ['下波', view.nextWaveLabel],
      ['结算', view.settlementLabel],
    ];
    for (const [label, value] of metaRows) {
      const item = make(doc, 'span', 'shop-meta-item');
      item.appendChild(make(doc, 'span', 'shop-meta-label', label));
      item.appendChild(make(doc, 'strong', 'shop-meta-value', value));
      elements.meta.appendChild(item);
    }

    clear(elements.tabs);
    for (const tab of view.tabs) {
      const button = make(doc, 'button', `shop-tab${tab.active ? ' is-active' : ''}`);
      button.type = 'button';
      button.dataset.page = tab.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', tab.active ? 'true' : 'false');
      button.textContent = `${tab.label}页`;
      elements.tabs.appendChild(button);
    }

    clear(elements.main);
    const focusedKey = view.entries[view.focus]?.key ?? null;

    if (view.page === 'equipment') {
      const attributes = make(doc, 'div', 'shop-attributes');
      for (const attribute of view.attributes) {
        const row = make(doc, 'div', 'shop-attribute');
        row.appendChild(make(doc, 'span', 'shop-attribute-label', attribute.label));
        row.appendChild(make(doc, 'strong', 'shop-attribute-value', attribute.value));
        attributes.appendChild(row);
      }
      elements.main.appendChild(attributes);
    }

    if (view.page === 'shelf') {
      const grid = make(doc, 'div', 'shop-grid');
      const extras = make(doc, 'div', 'shop-extras');
      view.entries.forEach((entry, index) => {
        const card = renderEntry(
          doc,
          entry,
          index === view.focus,
          view.confirm !== null && entry.key === focusedKey,
        );
        if (entry.slot !== null) grid.appendChild(card);
        else extras.appendChild(card);
      });
      elements.main.appendChild(grid);
      if (extras.childElementCount > 0) {
        elements.main.appendChild(
          make(doc, 'h3', 'shop-section-title', '常驻与缺件'),
        );
        elements.main.appendChild(extras);
      }
    } else {
      const list = make(doc, 'div', 'shop-list');
      view.entries.forEach((entry, index) => {
        list.appendChild(
          renderEntry(
            doc,
            entry,
            index === view.focus,
            view.confirm !== null && entry.key === focusedKey,
          ),
        );
      });
      if (view.entries.length === 0) {
        list.appendChild(
          make(
            doc,
            'p',
            'shop-empty',
            view.page === 'equipment' ? '暂无永久道具' : '暂无可追踪配方',
          ),
        );
      }
      elements.main.appendChild(list);
    }

    if (view.page === 'equipment' && view.groups.length > 0) {
      const groups = make(doc, 'div', 'shop-groups');
      for (const group of view.groups) {
        groups.appendChild(make(doc, 'h3', 'shop-section-title', group.title));
        for (const line of group.lines) {
          groups.appendChild(make(doc, 'p', 'shop-group-line', line));
        }
      }
      elements.main.appendChild(groups);
    }

    clear(elements.tracking);
    elements.tracking.appendChild(renderTracking(doc, view));

    renderDetail(doc, elements.detail, view);

    if (view.confirm) {
      elements.confirm.hidden = false;
      elements.confirm.className = `shop-confirm${toneClass(view.confirm.tone)}`;
      elements.confirm.textContent = view.confirm.text;
    } else {
      elements.confirm.hidden = true;
      elements.confirm.textContent = '';
    }

    elements.message.className = `shop-message${view.message ? toneClass(view.message.tone) : ''}`;
    elements.message.textContent = view.message?.text ?? '';

    clear(elements.skills);
    for (const slot of view.skills) {
      const box = make(doc, 'div', 'shop-skill-slot');
      box.appendChild(make(doc, 'span', 'shop-skill-key', slot.slot));
      const body = make(doc, 'span', 'shop-skill-body');
      body.appendChild(make(doc, 'strong', 'shop-skill-name', slot.name));
      body.appendChild(
        make(
          doc,
          'span',
          'shop-skill-meta',
          slot.level === null ? '空槽 · 可在货架装备' : `Lv${slot.level} · 冷却 ${slot.cooldownSeconds ?? 0}s`,
        ),
      );
      box.appendChild(body);
      elements.skills.appendChild(box);
    }

    elements.reroll.textContent = view.rerollLabel;
    elements.reroll.className = `shop-reroll${view.rerollLabel.includes('差') ? ' is-warn' : ''}`;
    elements.lock.textContent = view.lockLabel;
    elements.nextWave.textContent = `${view.nextWaveLabelForButton}（空格）`;
    elements.hint.textContent = `${view.focusHint} ｜ ${view.footerHint}`;

    const focused = focusedKey
      ? elements.main.querySelector<HTMLElement>(
          `[data-key="${focusedKey.replace(/"/g, '\\"')}"]`,
        )
      : null;
    focused?.focus({ preventScroll: true });
    if (typeof focused?.scrollIntoView === 'function') {
      focused.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  const show = (view: ShopUiView): void => {
    if (!visible) {
      visible = true;
      gate.reset();
      elements.overlay.hidden = false;
      elements.overlay.setAttribute('aria-hidden', 'false');
      doc.addEventListener('keydown', onKeyDown);
      doc.addEventListener('keyup', onKeyUp);
    }
    render(view);
  };

  const hide = (): void => {
    if (!visible) return;
    visible = false;
    gate.reset();
    doc.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('keyup', onKeyUp);
    elements.overlay.hidden = true;
    elements.overlay.setAttribute('aria-hidden', 'true');
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!visible) return;
    const code = event.code;

    if (GATED.has(code)) {
      event.preventDefault();
      if (!gate.keyDown(code, event.repeat)) return;
    } else if (
      MOVE_LEFT.has(code) ||
      MOVE_RIGHT.has(code) ||
      MOVE_UP.has(code) ||
      MOVE_DOWN.has(code)
    ) {
      event.preventDefault();
    } else {
      return;
    }

    if (MOVE_LEFT.has(code) || MOVE_UP.has(code)) {
      onAction({ type: 'move', delta: -1 });
      return;
    }
    if (MOVE_RIGHT.has(code) || MOVE_DOWN.has(code)) {
      onAction({ type: 'move', delta: 1 });
      return;
    }
    if (ACTIVATE.has(code)) {
      onAction({ type: 'confirm' });
      return;
    }
    if (code === 'Tab') {
      onAction({ type: 'page', delta: event.shiftKey ? -1 : 1 });
      return;
    }
    if (code === 'KeyR') {
      onAction({ type: 'reroll' });
      return;
    }
    if (code === 'KeyF') {
      onAction({ type: 'lock' });
      return;
    }
    if (code === 'Space') {
      onAction({ type: 'next-wave' });
      return;
    }
    if (code === 'Escape') {
      onAction({ type: 'cancel' });
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    gate.keyUp(event.code);
  }

  elements.tabs.addEventListener('click', (event) => {
    if (!visible) return;
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-page]',
    );
    const page = target?.dataset.page;
    if (!page) return;
    const normalized = SHOP_UI_PAGES.find((entry) => entry === page);
    if (normalized) onAction({ type: 'page-to', page: normalized });
  });

  elements.main.addEventListener('click', (event) => {
    if (!visible) return;
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-key]',
    );
    const key = target?.dataset.key;
    if (key) onAction({ type: 'activate', key });
  });

  elements.nextWave.addEventListener('click', () => {
    if (!visible) return;
    onAction({ type: 'next-wave' });
  });

  elements.overlay.hidden = true;
  elements.overlay.setAttribute('aria-hidden', 'true');

  return {
    show,
    update: (view) => {
      if (!visible) show(view);
      else render(view);
    },
    hide,
    isVisible: () => visible,
    destroy: () => {
      hide();
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('keyup', onKeyUp);
    },
  };
}

