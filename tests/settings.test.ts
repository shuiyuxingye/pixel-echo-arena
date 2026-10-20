// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArenaLayout } from '../src/game/arena';
import { FixedStepLoop } from '../src/game/loop';
import { PlayerMotion } from '../src/game/movement';
import { PauseController, pauseRequiresEnter } from '../src/game/pause';
import {
  DEFAULT_KEY_BINDINGS,
  DEFAULT_USER_SETTINGS,
  KEY_BINDING_ACTIONS,
  USER_SETTINGS_STORAGE_KEY,
  applyKeyBinding,
  combatBindingActionForKeyCode,
  createSettingsStore,
  findKeyBindingConflict,
  isBindableKeyCode,
  keyCodeLabel,
  loadUserSettings,
  movementBindingActionForKeyCode,
  resetKeyBindings,
  type UserSettings,
} from '../src/game/settings';

const ROOT = resolve(import.meta.dirname, '..');

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('键位重绑规则', () => {
  it('默认覆盖移动、攻击、两个技能、闪避与切换目标', () => {
    expect(KEY_BINDING_ACTIONS).toEqual(Object.keys(DEFAULT_KEY_BINDINGS));
    expect(DEFAULT_KEY_BINDINGS).toEqual({
      moveUp: 'KeyW',
      moveDown: 'KeyS',
      moveLeft: 'KeyA',
      moveRight: 'KeyD',
      attack: 'KeyJ',
      skillK: 'KeyK',
      skillL: 'KeyL',
      dodge: 'Space',
      cycleTarget: 'Tab',
    });
  });

  it('检测重复键位冲突，但同一动作重复绑定自己的键不算冲突', () => {
    expect(findKeyBindingConflict(DEFAULT_KEY_BINDINGS, 'attack', 'Space')).toBe(
      'dodge',
    );
    expect(findKeyBindingConflict(DEFAULT_KEY_BINDINGS, 'attack', 'KeyJ')).toBeNull();
    expect(findKeyBindingConflict(DEFAULT_KEY_BINDINGS, 'moveUp', 'KeyJ')).toBe(
      'attack',
    );
  });

  it('applyKeyBinding 返回新对象且不修改原绑定；恢复默认始终是新副本', () => {
    const next = applyKeyBinding(DEFAULT_KEY_BINDINGS, 'attack', 'KeyU');
    expect(next.attack).toBe('KeyU');
    expect(DEFAULT_KEY_BINDINGS.attack).toBe('KeyJ');
    expect(next).not.toBe(DEFAULT_KEY_BINDINGS);

    const defaults = resetKeyBindings();
    expect(defaults).toEqual(DEFAULT_KEY_BINDINGS);
    expect(defaults).not.toBe(DEFAULT_KEY_BINDINGS);
    const writable = defaults as unknown as Record<string, string>;
    writable.attack = 'KeyI';
    expect(DEFAULT_KEY_BINDINGS.attack).toBe('KeyJ');
  });

  it('Esc/Enter/修饰键不可绑定，字母、数字、Tab 与空格可绑定', () => {
    for (const code of [
      'Escape',
      'Enter',
      'NumpadEnter',
      'ShiftLeft',
      'ControlRight',
      'AltLeft',
      'MetaRight',
      '',
    ]) {
      expect(isBindableKeyCode(code)).toBe(false);
    }
    for (const code of ['KeyU', 'Digit1', 'Tab', 'Space', 'ArrowUp']) {
      expect(isBindableKeyCode(code)).toBe(true);
    }
    expect(keyCodeLabel('KeyU')).toBe('U');
    expect(keyCodeLabel('Space')).toBe('空格');
    expect(keyCodeLabel('Digit1')).toBe('1');
    expect(keyCodeLabel('Numpad4')).toBe('小键盘 4');
    expect(keyCodeLabel('ArrowLeft')).toBe('←');
  });

  it('按当前绑定解析移动与战斗动作', () => {
    const bindings = applyKeyBinding(DEFAULT_KEY_BINDINGS, 'moveUp', 'KeyI');
    expect(movementBindingActionForKeyCode(bindings, 'KeyI')).toBe('moveUp');
    expect(movementBindingActionForKeyCode(bindings, 'KeyW')).toBeNull();
    expect(combatBindingActionForKeyCode(bindings, 'Space')).toBe('dodge');
    expect(combatBindingActionForKeyCode(bindings, 'KeyJ')).toBe('attack');
    expect(combatBindingActionForKeyCode(bindings, 'KeyZ')).toBeNull();
  });

  it('PlayerMotion 使用重绑后的移动键，旧 WASD 立即失效', () => {
    const layout = createArenaLayout();
    const bindings = {
      ...DEFAULT_KEY_BINDINGS,
      moveUp: 'KeyI',
      moveLeft: 'KeyO',
    };
    const motion = new PlayerMotion({
      layout,
      moveSpeed: 100,
      startX: layout.spawn.x,
      startY: layout.spawn.y,
      keyBindings: bindings,
    });

    motion.pressKey('KeyW');
    expect(motion.moveDirection).toEqual({ x: 0, y: 0 });
    motion.step(1 / 60);
    expect(motion.isMoving).toBe(false);

    motion.pressKey('KeyI');
    motion.step(1 / 60);
    expect(motion.facingDirection).toBe('north');

    motion.setKeyBindings(DEFAULT_KEY_BINDINGS);
    expect(motion.moveDirection).toEqual({ x: 0, y: 0 });
    motion.pressKey('KeyA');
    expect(motion.moveDirection.x).toBe(-1);
  });
});

describe('共享设置 store 与持久化', () => {
  it('重绑后立即通知订阅者并写入 localStorage', () => {
    const store = createSettingsStore({ storage: localStorage });
    const seen: UserSettings[] = [];
    const unsubscribe = store.subscribe((settings) => seen.push(settings));
    expect(store.subscriberCount).toBe(1);

    expect(store.rebind('attack', 'KeyU')).toEqual({ ok: true, conflict: null });
    expect(store.get().keyBindings.attack).toBe('KeyU');
    expect(seen.at(-1)?.keyBindings.attack).toBe('KeyU');
    expect(loadUserSettings(localStorage).keyBindings.attack).toBe('KeyU');

    unsubscribe();
    expect(store.subscriberCount).toBe(0);
    store.update({ muted: true });
    expect(seen).toHaveLength(1);
  });

  it('冲突键不写入，原绑定保持对象不变', () => {
    const store = createSettingsStore({
      storage: localStorage,
      initial: DEFAULT_USER_SETTINGS,
    });
    const before = store.get();
    expect(store.rebind('attack', 'Space')).toEqual({
      ok: false,
      conflict: 'dodge',
    });
    expect(store.get()).toBe(before);
    expect(store.get().keyBindings.attack).toBe('KeyJ');
    expect(loadUserSettings(localStorage).keyBindings.attack).toBe('KeyJ');
  });

  it('静音与屏震开关即时生效并持久化', () => {
    const store = createSettingsStore({
      storage: localStorage,
      initial: DEFAULT_USER_SETTINGS,
    });
    store.update({ muted: true });
    expect(store.get().muted).toBe(true);
    store.update({ screenShake: false, reducedMotion: true });
    expect(store.get().screenShake).toBe(false);
    expect(store.get().reducedMotion).toBe(true);

    const loaded = loadUserSettings(localStorage);
    expect(loaded.muted).toBe(true);
    expect(loaded.screenShake).toBe(false);
    expect(loaded.reducedMotion).toBe(true);
  });

  it('恢复默认只重置键位，保留开关并写回存储', () => {
    const store = createSettingsStore({ storage: localStorage });
    store.update({ muted: true });
    store.rebind('attack', 'KeyU');
    store.resetBindings();

    expect(store.get().keyBindings).toEqual(DEFAULT_KEY_BINDINGS);
    expect(store.get().muted).toBe(true);
    const loaded = loadUserSettings(localStorage);
    expect(loaded.keyBindings).toEqual(DEFAULT_KEY_BINDINGS);
    expect(loaded.muted).toBe(true);
  });

  it('存储不可写时仍立即生效，只记录保存失败', () => {
    const throwingStorage: Storage = {
      length: 0,
      clear: () => undefined,
      getItem: () => null,
      key: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error('quota');
      },
    };
    const store = createSettingsStore({ storage: throwingStorage });
    store.update({ muted: true });
    expect(store.get().muted).toBe(true);
    expect(store.lastSaveOk).toBe(false);
    expect(localStorage.getItem(USER_SETTINGS_STORAGE_KEY)).toBeNull();
  });
});

describe('暂停时间冻结与失焦继续规则', () => {
  it('暂停期间固定逻辑步不推进；失焦暂停拒绝 Esc，只接受 Enter', () => {
    const controller = new PauseController();
    let ticks = 0;
    const loop = new FixedStepLoop({
      onStep: () => {
        if (!controller.isPaused) ticks += 1;
      },
    });

    loop.advance(0.5);
    const before = ticks;
    expect(before).toBeGreaterThan(0);

    expect(controller.pause('blur')).toBe(true);
    loop.advance(0.5);
    expect(ticks).toBe(before);
    expect(controller.isPaused).toBe(true);

    expect(controller.resume('escape')).toBe(false);
    expect(controller.isPaused).toBe(true);
    expect(pauseRequiresEnter('blur')).toBe(true);

    expect(controller.resume('enter')).toBe(true);
    expect(controller.isPaused).toBe(false);
    loop.advance(0.5);
    expect(ticks).toBeGreaterThan(before);
  });

  it('手动暂停允许 Esc 返回；重复暂停不覆盖原因', () => {
    const controller = new PauseController();
    expect(controller.pause('manual')).toBe(true);
    expect(controller.pause('blur')).toBe(false);
    expect(controller.reason).toBe('manual');
    expect(controller.resume('escape')).toBe(true);
    expect(controller.reason).toBeNull();
  });

  it('续局恢复同样要求 Enter', () => {
    const controller = new PauseController();
    controller.pause('checkpoint');
    expect(controller.resume('escape')).toBe(false);
    expect(controller.resume('enter')).toBe(true);
  });
});

describe('暂停与设置接入场景', () => {
  it('场景使用 Esc 暂停、失焦暂停、共享键位与屏震开关', () => {
    const scene = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    expect(scene).toContain('if (this.combatPaused) return;');
    expect(scene).toContain("code === 'Escape'");
    expect(scene).toContain("this.requestPause('manual')");
    expect(scene).toContain("this.requestPause('blur')");
    expect(scene).toContain('PAUSE_MENU_EVENT');
    expect(scene).toContain('combatBindingActionForKeyCode');
    expect(scene).toContain('settingsStore.subscribe');
    expect(scene).toContain('settings.screenShake');

    const app = readFileSync(resolve(ROOT, 'src/app.ts'), 'utf8');
    expect(app).toContain('createSettingsStore');
    expect(app).toContain('PAUSE_MENU_EVENT');
    expect(app).toContain('resumeCombat');
    expect(app).toContain('mountHelp');
    expect(app).toContain('mountSettingsPanel');
    expect(app).toContain('mountPauseMenu');

    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
    for (const id of [
      'help-overlay',
      'settings-overlay',
      'settings-list',
      'pause-overlay',
      'pause-menu',
      'help-button',
      'settings-button',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});
