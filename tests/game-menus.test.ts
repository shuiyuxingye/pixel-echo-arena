// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEY_BINDINGS,
  DEFAULT_USER_SETTINGS,
  createSettingsStore,
  loadUserSettings,
} from '../src/game/settings';
import { mountHelp } from '../src/ui/help-panel';
import { mountMenu } from '../src/ui/menu';
import { mountPauseMenu } from '../src/ui/pause-menu';
import { mountSettingsPanel } from '../src/ui/settings-panel';

const ROOT = resolve(import.meta.dirname, '..');

function mountDom(): void {
  document.body.innerHTML = `
    <div id="app">
      <div id="game-root"></div>
      <div id="menu-overlay">
        <button id="start-button" type="button">开始试炼</button>
        <button id="help-button" type="button">帮助</button>
        <button id="settings-button" type="button">设置</button>
      </div>
      <div id="character-select-overlay" hidden>
        <div id="character-select-list"></div>
      </div>
      <div id="help-overlay" hidden>
        <div id="help-content"></div>
        <button id="help-back-button" type="button">返回</button>
      </div>
      <div id="settings-overlay" hidden>
        <div id="settings-list"></div>
        <div id="settings-message"></div>
      </div>
      <div id="pause-overlay" hidden>
        <p id="pause-reason"></p>
        <div id="pause-menu">
          <button id="pause-continue" type="button">继续游戏</button>
          <button id="pause-help" type="button">帮助</button>
          <button id="pause-settings" type="button">设置</button>
          <button id="pause-return" type="button">返回选角</button>
        </div>
      </div>
    </div>
  `;
}

function press(code: string, key = code): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    code,
    key,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

function pressDown(count: number): void {
  for (let index = 0; index < count; index += 1) press('ArrowDown');
}

function activeRowId(): string | null {
  return (document.activeElement as HTMLElement | null)?.dataset.rowId ?? null;
}

function settingsMessage(): string {
  return document.querySelector<HTMLElement>('#settings-message')?.textContent ?? '';
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('主菜单键盘焦点', () => {
  it('默认聚焦开始按钮，方向键在开始/帮助/设置之间移动焦点', () => {
    mountDom();
    const onStart = vi.fn();
    const onHelp = vi.fn();
    const onSettings = vi.fn();
    const menu = mountMenu({ doc: document, onStart, onHelp, onSettings });

    expect(document.activeElement).toBe(document.querySelector('#start-button'));

    press('ArrowDown');
    expect(document.activeElement).toBe(document.querySelector('#help-button'));
    press('ArrowDown');
    expect(document.activeElement).toBe(document.querySelector('#settings-button'));
    press('ArrowUp');
    expect(document.activeElement).toBe(document.querySelector('#help-button'));

    press('Enter');
    expect(onHelp).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
    expect(onSettings).not.toHaveBeenCalled();
    menu.hide();
  });

  it('Enter 激活开始；S 也能移动焦点到设置', () => {
    mountDom();
    const onStart = vi.fn();
    const onSettings = vi.fn();
    const menu = mountMenu({ doc: document, onStart, onSettings });

    press('KeyS');
    press('KeyS');
    press('Enter');
    expect(onSettings).toHaveBeenCalledTimes(1);
    menu.hide();

    mountDom();
    const start = vi.fn();
    const menuWithOnlyStart = mountMenu({ doc: document, onStart: start });
    press('Enter');
    expect(start).toHaveBeenCalledTimes(1);
    menuWithOnlyStart.hide();
  });
});

describe('设置页：重绑、冲突、取消、恢复默认与开关', () => {
  it('渲染全部键位、三个开关与恢复默认/返回行', () => {
    mountDom();
    const store = createSettingsStore({ storage: localStorage });
    const panel = mountSettingsPanel({ doc: document, store, onBack: vi.fn() });
    panel.show();

    const rows = document.querySelectorAll('.settings-row');
    expect(rows).toHaveLength(16);
    expect(activeRowId()).toBe('binding:moveUp');
    expect(rows[0]?.textContent).toContain('向上移动');
    expect(rows[0]?.textContent).toContain('W');
    expect(document.querySelector('[data-row-id="toggle:muted"]')?.textContent).toContain(
      '静音 · 关',
    );
    expect(document.querySelector('[data-row-id="reset"]')?.textContent).toBe(
      '恢复默认键位',
    );
    panel.destroy();
  });

  it('重绑成功立即写入 store 与 localStorage，并提示新键', () => {
    mountDom();
    const store = createSettingsStore({ storage: localStorage });
    const panel = mountSettingsPanel({ doc: document, store, onBack: vi.fn() });
    panel.show();

    pressDown(4);
    expect(activeRowId()).toBe('binding:attack');
    press('Enter');
    expect(settingsMessage()).toContain('按任意键绑定');
    press('KeyQ');

    expect(store.get().keyBindings.attack).toBe('KeyQ');
    expect(loadUserSettings(localStorage).keyBindings.attack).toBe('KeyQ');
    expect(settingsMessage()).toContain('已把「普通攻击」绑定到 Q');
    panel.destroy();
  });

  it('冲突键提示且不改变原绑定，仍停留在编辑状态', () => {
    mountDom();
    const store = createSettingsStore({ storage: localStorage });
    const panel = mountSettingsPanel({ doc: document, store, onBack: vi.fn() });
    panel.show();

    pressDown(4);
    press('Enter');
    press('Space');

    expect(settingsMessage()).toContain('冲突');
    expect(settingsMessage()).toContain('闪避');
    expect(store.get().keyBindings.attack).toBe('KeyJ');
    expect(loadUserSettings(localStorage).keyBindings.attack).toBe('KeyJ');
    expect(
      document.querySelector('[data-row-id="binding:attack"]')?.classList.contains(
        'is-editing',
      ),
    ).toBe(true);
    panel.destroy();
  });

  it('Esc 取消编辑不改变原绑定，再次 Esc 才返回', () => {
    mountDom();
    const store = createSettingsStore({ storage: localStorage });
    const onBack = vi.fn();
    const panel = mountSettingsPanel({ doc: document, store, onBack });
    panel.show();

    pressDown(9);
    expect(activeRowId()).toBe('binding:dodge');
    press('Enter');
    press('Escape');

    expect(store.get().keyBindings.dodge).toBe('Space');
    expect(settingsMessage()).toContain('已取消编辑');
    expect(onBack).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>('#settings-overlay')?.hidden).toBe(false);

    press('Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
    panel.destroy();
  });

  it('静音与屏震开关即时生效并写入存储，再次确认可切回', () => {
    mountDom();
    const store = createSettingsStore({ storage: localStorage });
    const panel = mountSettingsPanel({ doc: document, store, onBack: vi.fn() });
    panel.show();

    pressDown(11);
    expect(activeRowId()).toBe('toggle:muted');
    press('Enter');
    expect(store.get().muted).toBe(true);
    expect(loadUserSettings(localStorage).muted).toBe(true);
    const mutedRow = document.querySelector<HTMLElement>('[data-row-id="toggle:muted"]');
    expect(mutedRow?.textContent).toContain('开');
    expect(mutedRow?.getAttribute('aria-checked')).toBe('true');

    pressDown(1);
    expect(activeRowId()).toBe('toggle:screenShake');
    press('Enter');
    expect(store.get().screenShake).toBe(false);
    expect(loadUserSettings(localStorage).screenShake).toBe(false);

    press('Enter');
    expect(store.get().screenShake).toBe(true);
    panel.destroy();
  });

  it('恢复默认键位保留静音开关，返回行可离开设置页', () => {
    mountDom();
    const store = createSettingsStore({ storage: localStorage });
    store.update({ muted: true });
    store.rebind('attack', 'KeyQ');
    const onBack = vi.fn();
    const panel = mountSettingsPanel({ doc: document, store, onBack });
    panel.show();

    pressDown(14);
    expect(activeRowId()).toBe('reset');
    press('Enter');
    expect(store.get().keyBindings).toEqual(DEFAULT_KEY_BINDINGS);
    expect(store.get().muted).toBe(true);
    expect(settingsMessage()).toContain('已恢复默认键位');

    pressDown(1);
    expect(activeRowId()).toBe('back');
    press('Enter');
    expect(onBack).toHaveBeenCalledTimes(1);
    panel.destroy();
  });
});

describe('帮助页', () => {
  it('显示当前绑定、聚焦返回按钮，Enter 与 Esc 均可返回', () => {
    mountDom();
    const store = createSettingsStore({
      storage: localStorage,
      initial: {
        ...DEFAULT_USER_SETTINGS,
        keyBindings: { ...DEFAULT_KEY_BINDINGS, attack: 'KeyU' },
      },
    });
    const onBack = vi.fn();
    const help = mountHelp({ doc: document, store, onBack });
    help.show();

    const text = document.querySelector<HTMLElement>('#help-content')?.textContent ?? '';
    expect(text).toContain('18 波');
    expect(text).toContain('U：按住沿当前面向');
    expect(text).toContain('Esc 取消编辑');
    expect(document.activeElement).toBe(document.querySelector('#help-back-button'));

    press('Enter');
    expect(onBack).toHaveBeenCalledTimes(1);

    help.show();
    press('Escape');
    expect(onBack).toHaveBeenCalledTimes(2);
    help.destroy();
  });
});

describe('暂停面板', () => {
  it('默认聚焦继续，方向键移动到帮助并确认', () => {
    mountDom();
    const onHelp = vi.fn();
    const pause = mountPauseMenu({
      doc: document,
      onContinue: vi.fn(),
      onHelp,
    });
    pause.show('manual');

    expect(document.activeElement).toBe(document.querySelector('#pause-continue'));
    expect(document.querySelector<HTMLElement>('#pause-reason')?.textContent).toContain(
      'Esc 或 Enter',
    );
    press('ArrowDown');
    expect(document.activeElement).toBe(document.querySelector('#pause-help'));
    press('Enter');
    expect(onHelp).toHaveBeenCalledTimes(1);
    pause.hide();
  });

  it('手动暂停可用 Esc 返回；失焦暂停只接受 Enter', () => {
    mountDom();
    const onContinue = vi.fn();
    const pause = mountPauseMenu({ doc: document, onContinue });
    pause.show('manual');

    press('Escape');
    expect(onContinue).toHaveBeenCalledWith('escape');

    onContinue.mockClear();
    pause.show('blur');
    press('Escape');
    expect(onContinue).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>('#pause-reason')?.textContent).toContain(
      '只能按 Enter',
    );

    press('Enter');
    expect(onContinue).toHaveBeenCalledWith('enter');
    pause.hide();
  });

  it('返回选角按钮使用独立回调', () => {
    mountDom();
    const onReturnToSelect = vi.fn();
    const pause = mountPauseMenu({
      doc: document,
      onContinue: vi.fn(),
      onReturnToSelect,
    });
    pause.show('manual');
    pressDown(3);
    expect(document.activeElement).toBe(document.querySelector('#pause-return'));
    press('Enter');
    expect(onReturnToSelect).toHaveBeenCalledTimes(1);
    pause.hide();
  });
});

describe('HTML 覆盖层接入', () => {
  it('主菜单、帮助、设置、暂停均有独立容器与键盘入口', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
    for (const id of [
      'menu-overlay',
      'help-button',
      'settings-button',
      'help-overlay',
      'help-back-button',
      'settings-overlay',
      'settings-list',
      'pause-overlay',
      'pause-reason',
      'pause-continue',
      'pause-help',
      'pause-settings',
      'pause-return',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('settings');
  });
});
