// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSET_PATHS } from '../src/game/config';
import { CHARACTER_LIST, getCharacter, type CharacterId } from '../src/game/data';
import {
  CHARACTER_SELECT_ENTRIES,
  CHARACTER_SELECT_ORDER,
  CharacterSelectState,
  getCharacterSelectEntry,
} from '../src/game/character-select';
import { createRunSessionStore } from '../src/game/run-session';
import {
  DEFAULT_KEY_BINDINGS,
  DEFAULT_USER_SETTINGS,
  USER_SETTINGS_STORAGE_KEY,
  loadUserSettings,
  saveUserSettings,
} from '../src/game/settings';
import { playerArtFor } from '../src/game/player-art';
import { mountCharacterSelect } from '../src/ui/character-select';

const ROOT = process.cwd();

const PREVIEW_PATHS: Readonly<Record<CharacterId, string>> = {
  vishdal: ASSET_PATHS.playerVishdal,
  amiya: ASSET_PATHS.playerAmiya,
  saria: ASSET_PATHS.playerSaria,
  muelsyse: ASSET_PATHS.playerMuelsyse,
};

const SKILL_KEYS = ['J', 'K', 'L'] as const;

function mountSelectDom(): void {
  document.body.innerHTML = `
    <div id="game-root"></div>
    <div id="menu-overlay" hidden>
      <button id="start-button" type="button">开始试炼</button>
    </div>
    <div id="character-select-overlay" hidden aria-hidden="true">
      <div id="character-select-list"></div>
    </div>
  `;
}

function press(code: string, key = code): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

function entryText(entry: ReturnType<typeof getCharacterSelectEntry>): string {
  return [
    entry.name,
    entry.role,
    entry.passive.name,
    entry.passive.description,
    ...entry.skills.flatMap((skill) => [skill.name, skill.description]),
  ].join('\n');
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('四角色选择映射', () => {
  it('按固定顺序映射到四名角色，确认结果就是当前焦点角色', () => {
    expect(CHARACTER_SELECT_ORDER).toEqual(['vishdal', 'amiya', 'saria', 'muelsyse']);
    expect(CHARACTER_SELECT_ENTRIES.map((entry) => entry.id)).toEqual(CHARACTER_SELECT_ORDER);

    const state = new CharacterSelectState();
    expect(state.focusedId).toBe('vishdal');
    for (const id of CHARACTER_SELECT_ORDER) {
      state.focusToCharacter(id);
      expect(state.confirm()).toBe(id);
    }
  });

  it('每名角色展示自己的姓名、定位、J/K/L 与被动，预览复用场内精灵表', () => {
    for (const id of CHARACTER_SELECT_ORDER) {
      const character = getCharacter(id);
      const entry = getCharacterSelectEntry(id);

      expect(entry.name).toBe(character.name);
      expect(entry.role.length).toBeGreaterThan(0);
      expect(entry.skills.map((skill) => skill.key)).toEqual([...SKILL_KEYS]);
      expect(entry.skills.map((skill) => skill.name)).toEqual([
        character.attack.name,
        character.skillK.name,
        character.skillL.name,
      ]);
      expect(entry.passive).toEqual({
        name: character.passive.name,
        description: character.passive.description,
      });
      expect(entry.stats).toEqual({
        maxHealth: character.maxHealth,
        armor: character.armor,
        magicResistPercent: Math.round(character.magicResist * 100),
        moveSpeed: character.moveSpeed,
      });

      expect(entry.preview.path).toBe(PREVIEW_PATHS[id]);
      const art = playerArtFor(id);
      expect(entry.preview.sheetWidth).toBe(art.sheetWidth);
      expect(entry.preview.sheetHeight).toBe(art.sheetHeight);
      expect(entry.preview.frameWidth).toBe(art.frameWidth);
      expect(entry.preview.frameHeight).toBe(art.frameHeight);
      expect(entry.preview.scale).toBe(art.previewScale);
      expect(entry.preview.width).toBe(art.frameWidth * art.previewScale);
      expect(entry.preview.height).toBe(art.frameHeight * art.previewScale);
    }
  });

  it('技能隔离：任一角色摘要都不含其他角色的 J/K/L 与被动名称', () => {
    for (const entry of CHARACTER_SELECT_ENTRIES) {
      const text = entryText(entry);
      for (const other of CHARACTER_LIST) {
        if (other.id === entry.id) continue;
        const foreignNames = [
          other.attack.name,
          other.skillK.name,
          other.skillL.name,
          other.passive.name,
        ];
        for (const name of foreignNames) {
          expect(text).not.toContain(name);
        }
      }
    }
  });

  it('焦点在四列布局内左右移动，边界不换行、不跳到无关控件', () => {
    const state = new CharacterSelectState('vishdal');
    expect(state.moveFocus('left')).toBe(false);
    expect(state.focusedId).toBe('vishdal');

    expect(state.moveFocus('right')).toBe(true);
    expect(state.focusedId).toBe('amiya');
    expect(state.moveFocus('right')).toBe(true);
    expect(state.moveFocus('right')).toBe(true);
    expect(state.focusedId).toBe('muelsyse');
    expect(state.moveFocus('right')).toBe(false);
    expect(state.focusedId).toBe('muelsyse');

    expect(state.moveFocus('down')).toBe(false);
    expect(state.moveFocus('up')).toBe(false);
    expect(state.focusedId).toBe('muelsyse');
  });
});

describe('选角页键盘与焦点', () => {
  it('渲染四张可键盘聚焦的卡片，显示预览、定位与技能摘要', () => {
    mountSelectDom();
    const handle = mountCharacterSelect({
      doc: document,
      onConfirm: () => undefined,
    });
    handle.show('saria');

    const overlay = document.querySelector<HTMLElement>('#character-select-overlay');
    expect(overlay?.hidden).toBe(false);
    expect(overlay?.getAttribute('aria-hidden')).toBe('false');

    const cards = [...document.querySelectorAll<HTMLButtonElement>('.character-card')];
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.dataset.characterId)).toEqual([
      'vishdal',
      'amiya',
      'saria',
      'muelsyse',
    ]);

    for (const entry of CHARACTER_SELECT_ENTRIES) {
      const card = document.querySelector<HTMLButtonElement>(
        `.character-card[data-character-id="${entry.id}"]`,
      );
      expect(card).not.toBeNull();
      const text = card?.textContent ?? '';
      expect(text).toContain(entry.name);
      expect(text).toContain(entry.role);
      expect(text).toContain(entry.passive.name);
      for (const skill of entry.skills) {
        expect(text).toContain(skill.key);
        expect(text).toContain(skill.name);
      }
      const art = card?.querySelector<HTMLElement>('.character-card-art');
      expect(art?.dataset.previewPath).toBe(entry.preview.path);
      expect(art?.style.backgroundImage).toContain(entry.preview.path);
      expect(art?.style.backgroundSize).toBe(
        `${entry.preview.sheetWidth * entry.preview.scale}px ${
          entry.preview.sheetHeight * entry.preview.scale
        }px`,
      );
      expect(art?.style.backgroundPosition).toBe('0px 0px');
      expect(art?.style.height).toBe(`${entry.preview.height}px`);
      expect(entry.preview.scale).toBe(playerArtFor(entry.id).previewScale);
    }

    expect(document.activeElement?.getAttribute('data-character-id')).toBe('saria');
    expect(
      document.querySelector<HTMLElement>('.character-card.is-focused')?.dataset.characterId,
    ).toBe('saria');
    handle.destroy();
  });

  it('WASD / 方向键移动焦点，Enter 只确认一次并把选中角色交给新局', () => {
    mountSelectDom();
    const onConfirm = vi.fn();
    const handle = mountCharacterSelect({ doc: document, onConfirm });
    handle.show();

    press('ArrowRight');
    expect(handle.focusedId).toBe('amiya');
    press('KeyD');
    expect(handle.focusedId).toBe('saria');
    press('ArrowLeft');
    expect(handle.focusedId).toBe('amiya');
    press('KeyA');
    expect(handle.focusedId).toBe('vishdal');
    press('KeyA');
    expect(handle.focusedId).toBe('vishdal');

    press('Enter');
    press('Enter', 'Enter');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('vishdal');

    handle.show('muelsyse');
    expect(handle.focusedId).toBe('muelsyse');
    expect(document.activeElement?.getAttribute('data-character-id')).toBe('muelsyse');

    press('Enter');
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenLastCalledWith('muelsyse');
    handle.destroy();
  });

  it('Esc 返回主菜单并停止拦截按键', () => {
    mountSelectDom();
    const onConfirm = vi.fn();
    const onBack = vi.fn();
    const handle = mountCharacterSelect({ doc: document, onConfirm, onBack });
    handle.show();

    const event = press('Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLElement>('#character-select-overlay')?.hidden).toBe(true);

    press('Enter');
    expect(onConfirm).not.toHaveBeenCalled();
    handle.destroy();
  });

  it('鼠标点击卡片可选中并确认（可选便利，不是键盘的前置条件）', () => {
    mountSelectDom();
    const onConfirm = vi.fn();
    const handle = mountCharacterSelect({ doc: document, onConfirm });
    handle.show();

    document
      .querySelector<HTMLButtonElement>('.character-card[data-character-id="amiya"]')
      ?.click();
    expect(onConfirm).toHaveBeenCalledWith('amiya');
    handle.destroy();
  });
});

describe('返回选角的重置范围', () => {
  it('结束一局只清空单局状态；同一角色重开也获得新的 runId', () => {
    const store = createRunSessionStore();
    const first = store.beginRun('amiya');
    expect(store.current).toEqual(first);
    expect(first.characterId).toBe('amiya');

    store.endRun();
    expect(store.current).toBeNull();
    expect(store.lastCharacterId).toBe('amiya');

    const second = store.beginRun('amiya');
    expect(second.runId).not.toBe(first.runId);
    expect(second.characterId).toBe('amiya');
    expect(store.current).toEqual(second);
  });

  it('重开与返回选角不会清除 localStorage 中的用户设置与键位', () => {
    const settings = {
      ...DEFAULT_USER_SETTINGS,
      keyBindings: { ...DEFAULT_KEY_BINDINGS, attack: 'KeyU', dodge: 'ShiftLeft' },
      screenShake: false,
      muted: true,
    };
    expect(saveUserSettings(settings, localStorage)).toBe(true);

    const store = createRunSessionStore();
    store.beginRun('saria');
    store.endRun();
    store.beginRun('muelsyse');

    const loaded = loadUserSettings(localStorage);
    expect(loaded.keyBindings.attack).toBe('KeyU');
    expect(loaded.keyBindings.dodge).toBe('ShiftLeft');
    expect(loaded.screenShake).toBe(false);
    expect(loaded.muted).toBe(true);
    expect(localStorage.getItem(USER_SETTINGS_STORAGE_KEY)).not.toBeNull();
  });

  it('设置损坏或字段缺失时逐字段回退默认值，不丢弃可读键位', () => {
    localStorage.setItem(USER_SETTINGS_STORAGE_KEY, '{broken json');
    expect(loadUserSettings(localStorage)).toEqual(DEFAULT_USER_SETTINGS);

    localStorage.setItem(
      USER_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        keyBindings: { attack: 'KeyU', dodge: 42 },
        muted: 'yes',
      }),
    );
    const loaded = loadUserSettings(localStorage);
    expect(loaded.keyBindings.attack).toBe('KeyU');
    expect(loaded.keyBindings.dodge).toBe(DEFAULT_KEY_BINDINGS.dodge);
    expect(loaded.keyBindings.moveUp).toBe(DEFAULT_KEY_BINDINGS.moveUp);
    expect(loaded.muted).toBe(DEFAULT_USER_SETTINGS.muted);
  });
});

describe('选角页接入', () => {
  it('HTML 提供选角容器，应用壳在菜单之后挂载选角并创建新局', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('id="character-select-overlay"');
    expect(html).toContain('id="character-select-list"');
    expect(html).toContain('选择你的回响');

    const appSource = readFileSync(resolve(ROOT, 'src/app.ts'), 'utf8');
    expect(appSource).toContain('mountCharacterSelect');
    expect(appSource).toContain('runSessions.beginRun');
    expect(appSource).toContain('runSessions.endRun');
    expect(appSource).toContain('RETURN_TO_CHARACTER_SELECT_EVENT');
    expect(appSource).toContain('destroy(true)');

    const gameSource = readFileSync(resolve(ROOT, 'src/game/game.ts'), 'utf8');
    expect(gameSource).toContain('RUN_CHARACTER_REGISTRY_KEY');
    expect(gameSource).toContain('preBoot');
  });

  it('场景创建时读取本局角色，死亡后 Enter 返回选角，局中没有切换角色的入口', () => {
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );

    expect(sceneSource).toContain('resolvePlayableCharacterId(this.registry)');
    expect(sceneSource).toContain('RUN_CHARACTER_REGISTRY_KEY');
    expect(sceneSource).toContain('isCharacterId');
    expect(sceneSource).toContain('this.game.events.emit(RETURN_TO_CHARACTER_SELECT_EVENT)');
    expect(sceneSource).toContain('按 Enter 返回选角');
    expect(sceneSource).not.toContain('setCharacterId');
    expect(sceneSource).toContain("this.character.id === 'amiya'");
    expect(sceneSource).toContain("this.character.id === 'saria'");
    expect(sceneSource).toContain("this.character.id === 'muelsyse'");
  });
});
