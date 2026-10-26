import { ITEM_ART, NAME_ART } from '../game/art-manifest';
/**
 * DOM 构筑面板（US-047）：只渲染 `BuildPanelView` 并把键盘滚动/关闭转成动作。
 * 打开时场景已暂停；面板不直接修改任何战斗状态。
 */

import {
  BUILD_SCROLL_LINE_PX,
  BuildPanelScroll,
  type BuildPanelView,
} from '../game/build-panel';

export interface BuildPanelOptions {
  readonly doc?: Document;
  /** B / Esc 关闭；由应用壳恢复场景。 */
  readonly onClose: () => void;
}

export interface BuildPanelHandle {
  show(view: BuildPanelView): void;
  hide(): void;
  isVisible(): boolean;
  destroy(): void;
}

interface Elements {
  readonly overlay: HTMLElement;
  readonly panel: HTMLElement;
  readonly title: HTMLElement;
  readonly summary: HTMLElement;
  readonly attributes: HTMLElement;
  readonly groups: HTMLElement;
  readonly hint: HTMLElement;
}

function findElements(doc: Document): Elements {
  const pick = <T extends HTMLElement>(id: string): T => {
    const found = doc.querySelector<T>(`#${id}`);
    if (!found) throw new Error(`Build panel requires #${id}`);
    return found;
  };
  return {
    overlay: pick('build-overlay'),
    panel: pick('build-panel'),
    title: pick('build-title'),
    summary: pick('build-summary'),
    attributes: pick('build-attributes'),
    groups: pick('build-groups'),
    hint: pick('build-hint'),
  };
}

const SCROLL_UP = new Set(['ArrowUp', 'KeyW']);
const SCROLL_DOWN = new Set(['ArrowDown', 'KeyS']);
const PAGE_UP = new Set(['PageUp']);
const PAGE_DOWN = new Set(['PageDown']);
const CLOSE_KEYS = new Set(['KeyB', 'Escape']);

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

function renderAttributes(
  doc: Document,
  container: HTMLElement,
  view: BuildPanelView,
): void {
  clear(container);
  for (const attribute of view.attributes) {
    const row = make(doc, 'div', 'build-attribute');
    row.appendChild(
      make(doc, 'span', 'build-attribute-label', attribute.label),
    );
    row.appendChild(
      make(doc, 'strong', 'build-attribute-value', attribute.value),
    );
    container.appendChild(row);
  }
}

function renderGroups(
  doc: Document,
  container: HTMLElement,
  view: BuildPanelView,
): void {
  clear(container);
  for (const group of view.groups) {
    const section = make(doc, 'section', 'build-group');
    section.dataset.group = group.kind;

    const heading = make(doc, 'h3', 'build-group-title');
    heading.appendChild(make(doc, 'span', 'build-group-name', group.title));
    heading.appendChild(
      make(
        doc,
        'span',
        'build-group-count',
        group.count > 0 ? `${group.count} 项` : '无',
      ),
    );
    section.appendChild(heading);

    if (group.entries.length === 0) {
      section.appendChild(
        make(doc, 'p', 'build-group-empty', group.emptyLabel),
      );
      container.appendChild(section);
      continue;
    }

    for (const entry of group.entries) {
      const card = make(
        doc,
        'article',
        `build-entry${entry.inactive ? ' is-inactive' : ''}`,
      );
      card.dataset.entryId = entry.id;

      const head = make(doc, 'header', 'build-entry-head');
      head.appendChild(make(doc, 'span', 'build-entry-id', entry.id));
      head.appendChild(make(doc, 'strong', 'build-entry-name', entry.name));
      head.appendChild(make(doc, 'span', 'build-entry-tag', entry.tag));
      head.appendChild(
        make(doc, 'span', 'build-entry-stacks', entry.stacksLabel),
      );
      card.appendChild(head);
      const artPath = ITEM_ART[entry.id] ?? NAME_ART[entry.name];
      if (artPath) {
        const image = make(doc, 'img', 'build-item-art');
        image.src = artPath; image.alt = ''; image.setAttribute('aria-hidden', 'true');
        card.appendChild(image);
      }

      card.appendChild(
        make(doc, 'p', 'build-entry-source', `来源：${entry.sourceLabel}`),
      );
      if (entry.effect) {
        card.appendChild(make(doc, 'p', 'build-entry-effect', entry.effect));
      }
      if (entry.condition) {
        card.appendChild(
          make(
            doc,
            'p',
            `build-entry-condition${entry.inactive ? ' is-inactive' : ''}`,
            entry.condition,
          ),
        );
      }
      section.appendChild(card);
    }
    container.appendChild(section);
  }
}

export function mountBuildPanel({
  doc = document,
  onClose,
}: BuildPanelOptions): BuildPanelHandle {
  const elements = findElements(doc);
  const scroll = new BuildPanelScroll();
  let visible = false;

  const syncViewport = (): void => {
    scroll.setViewport(
      elements.panel.scrollHeight - elements.panel.clientHeight,
    );
  };

  const applyScroll = (): void => {
    elements.panel.scrollTop = scroll.offset;
  };

  const render = (view: BuildPanelView): void => {
    elements.title.textContent = view.title;
    elements.summary.textContent = view.summary;
    renderAttributes(doc, elements.attributes, view);
    renderGroups(doc, elements.groups, view);
    elements.hint.textContent = `${view.scrollHint} ｜ ${view.closeHint}`;
  };

  const show = (view: BuildPanelView): void => {
    render(view);
    scroll.reset();
    elements.panel.scrollTop = 0;
    if (!visible) {
      visible = true;
      elements.overlay.hidden = false;
      elements.overlay.setAttribute('aria-hidden', 'false');
      doc.addEventListener('keydown', onKeyDown);
    }
    elements.panel.focus({ preventScroll: true });
  };

  const hide = (): void => {
    if (!visible) return;
    visible = false;
    doc.removeEventListener('keydown', onKeyDown);
    if (doc.activeElement === elements.panel) elements.panel.blur();
    elements.overlay.hidden = true;
    elements.overlay.setAttribute('aria-hidden', 'true');
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!visible) return;
    const code = event.code;

    if (CLOSE_KEYS.has(code)) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) onClose();
      return;
    }

    const isScroll =
      SCROLL_UP.has(code) ||
      SCROLL_DOWN.has(code) ||
      PAGE_UP.has(code) ||
      PAGE_DOWN.has(code) ||
      code === 'Home' ||
      code === 'End';
    if (!isScroll) return;

    event.preventDefault();
    event.stopPropagation();
    syncViewport();
    if (SCROLL_UP.has(code)) scroll.scrollBy(-BUILD_SCROLL_LINE_PX);
    else if (SCROLL_DOWN.has(code)) scroll.scrollBy(BUILD_SCROLL_LINE_PX);
    else if (PAGE_UP.has(code)) scroll.pageBy(-1, elements.panel.clientHeight);
    else if (PAGE_DOWN.has(code)) scroll.pageBy(1, elements.panel.clientHeight);
    else if (code === 'Home') scroll.toTop();
    else scroll.toBottom();
    applyScroll();
  }

  elements.overlay.hidden = true;
  elements.overlay.setAttribute('aria-hidden', 'true');

  return {
    show,
    hide,
    isVisible: () => visible,
    destroy: () => {
      hide();
      doc.removeEventListener('keydown', onKeyDown);
    },
  };
}
