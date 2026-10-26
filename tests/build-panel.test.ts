// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUILD_GROUP_LABELS,
  BUILD_SCROLL_LINE_PX,
  BuildPanelScroll,
  buildBuildPanelView,
  buildPanelToggleAction,
  type BuildPanelInput,
  type BuildStatInput,
} from '../src/game/build-panel';
import { mountBuildPanel } from '../src/ui/build-panel';

const STATS: BuildStatInput = {
  armor: 12,
  magicResist: 0.15,
  moveSpeed: 100,
  moveSpeedMultiplier: 1.1,
  attackSpeedMultiplier: 1.25,
  damageMultiplier: 1.12,
  skillDamageMultiplier: 1.05,
  normalAttackDamageMultiplier: 0.95,
  cooldownReduction: 0.1,
  explosionRadiusMultiplier: 1.3,
  damageOverTimeMultiplier: 1.25,
  recipeDamageOverTimeMultiplier: 1.3,
  summonDamageMultiplier: 1.35,
  killGoldMultiplier: 1.08,
  completionGoldMultiplier: 1.15,
  lifesteal: 0.02,
  regenPerFiveSeconds: 1.5,
};

function input(overrides: Partial<BuildPanelInput> = {}): BuildPanelInput {
  return {
    wave: 7,
    health: 122.25,
    maxHealth: 135.8,
    shield: 4.2,
    stats: STATS,
    potions: [],
    items: [],
    cores: [],
    crafted: [],
    hexes: [],
    ...overrides,
  };
}

function groupOf(view: ReturnType<typeof buildBuildPanelView>, kind: string) {
  const group = view.groups.find((entry) => entry.kind === kind);
  expect(group, `缺少分组 ${kind}`).toBeDefined();
  return group!;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('构筑面板视图', () => {
  it('始终输出五类来源分组，顺序固定且空分组保留', () => {
    const view = buildBuildPanelView(input());
    expect(view.groups.map((group) => group.kind)).toEqual([
      'potion',
      'item',
      'core',
      'crafted',
      'hex',
    ]);
    expect(view.groups.map((group) => group.title)).toEqual([
      BUILD_GROUP_LABELS.potion,
      BUILD_GROUP_LABELS.item,
      BUILD_GROUP_LABELS.core,
      BUILD_GROUP_LABELS.crafted,
      BUILD_GROUP_LABELS.hex,
    ]);
    for (const group of view.groups) {
      expect(group.count).toBe(0);
      expect(group.emptyLabel.length).toBeGreaterThan(0);
    }
  });

  it('临时饮剂区分生效与待生效层数，并给出未生效条件', () => {
    const view = buildBuildPanelView(
      input({
        potions: [
          { id: 'P03', pending: 1, active: 0 },
          { id: 'P04', pending: 1, active: 2 },
        ],
      }),
    );
    const potions = groupOf(view, 'potion');
    expect(potions.count).toBe(2);
    const pending = potions.entries[0]!;
    expect(pending.name).toBe('强袭饮剂');
    expect(pending.stacksLabel).toBe('×1 层');
    expect(pending.inactive).toBe(true);
    expect(pending.condition).toContain('未生效');
    expect(pending.sourceLabel).toBe('商店药剂');

    const mixed = potions.entries[1]!;
    expect(mixed.stacksLabel).toBe('×3 层');
    expect(mixed.inactive).toBe(false);
    expect(mixed.condition).toContain('另有 1 层下一波生效');
  });

  it('永久道具显示层数/上限与 I16 持续伤害的生效条件', () => {
    const view = buildBuildPanelView(
      input({
        items: [{ id: 'I16', stacks: 2 }],
        sustainedSkillIds: [],
      }),
    );
    const items = groupOf(view, 'item');
    const entry = items.entries[0]!;
    expect(entry.stacksLabel).toBe('2/3 层');
    expect(entry.sourceLabel).toBe('永久道具');
    expect(entry.effect).toContain('持续伤害');
    expect(entry.effect).toContain('需持续类技能');
  });

  it('精英核心、配方成品与海克斯按各自来源分组', () => {
    const view = buildBuildPanelView(
      input({
        cores: ['E01'],
        crafted: ['R01'],
        hexes: ['H01'],
        craftedNotes: { R01: ['成长 +3/60'] },
      }),
    );
    expect(groupOf(view, 'core').entries[0]!.name).toBe('炉心契约');
    expect(groupOf(view, 'core').entries[0]!.sourceLabel).toBe('精英核心');
    const crafted = groupOf(view, 'crafted').entries[0]!;
    expect(crafted.name.length).toBeGreaterThan(0);
    expect(crafted.effect).toContain('成长 +3/60');
    const hex = groupOf(view, 'hex').entries[0]!;
    expect(hex.name).toBe('双倍委托');
    expect(hex.sourceLabel).toBe('海克斯 · 通用');
  });

  it('净属性与战斗 HUD 同口径：生命/护盾取整，百分比不带长浮点', () => {
    const view = buildBuildPanelView(input());
    const values = new Map(
      view.attributes.map((attribute) => [attribute.label, attribute.value]),
    );
    expect(values.get('生命')).toBe('123/136');
    expect(values.get('护盾')).toBe('5');
    expect(values.get('法抗')).toBe('15%');
    expect(values.get('移速')).toBe('100 · 110%');
    expect(values.get('伤害')).toBe('112%');
    expect(values.get('持续伤害')).toBe('125%');
    expect(values.get('每 5 秒回复')).toBe('1.5');
    expect(values.get('吸血')).toBe('2%');
    expect(view.attributes.length).toBe(18);
  });

  it('B 在关闭时打开、打开时关闭；Esc 只关闭', () => {
    expect(buildPanelToggleAction('KeyB', false)).toBe('open');
    expect(buildPanelToggleAction('KeyB', true)).toBe('close');
    expect(buildPanelToggleAction('Escape', true)).toBe('close');
    expect(buildPanelToggleAction('Escape', false)).toBeNull();
    expect(buildPanelToggleAction('KeyJ', false)).toBeNull();
  });
});

describe('构筑面板键盘滚动', () => {
  it('按行滚动并钳制在 0 与最大值之间', () => {
    const scroll = new BuildPanelScroll();
    scroll.setViewport(120);
    expect(scroll.scrollBy(-BUILD_SCROLL_LINE_PX)).toBe(0);
    expect(scroll.scrollBy(BUILD_SCROLL_LINE_PX)).toBe(BUILD_SCROLL_LINE_PX);
    expect(scroll.scrollBy(10_000)).toBe(120);
    expect(scroll.scrollBy(-BUILD_SCROLL_LINE_PX)).toBe(120 - BUILD_SCROLL_LINE_PX);
  });

  it('翻页按视口 80% 计算，Home/End 直达两端', () => {
    const scroll = new BuildPanelScroll();
    scroll.setViewport(500);
    expect(scroll.pageBy(1, 400)).toBe(320);
    expect(scroll.toBottom()).toBe(500);
    expect(scroll.toTop()).toBe(0);
    expect(scroll.offset).toBe(0);
  });

  it('视口变化后把旧偏移钳回新上限', () => {
    const scroll = new BuildPanelScroll();
    scroll.setViewport(500);
    scroll.toBottom();
    expect(scroll.offset).toBe(500);
    scroll.setViewport(200);
    expect(scroll.offset).toBe(200);
    scroll.setViewport(0);
    expect(scroll.offset).toBe(0);
    expect(scroll.max).toBe(0);
  });
});

function mountDom(): HTMLElement {
  document.body.innerHTML = `
    <div id="build-overlay" hidden aria-hidden="true">
      <section id="build-panel" tabindex="-1">
        <h2 id="build-title"></h2>
        <p id="build-summary"></p>
        <div id="build-attributes"></div>
        <div id="build-groups"></div>
        <p id="build-hint"></p>
      </section>
    </div>
  `;
  return document.querySelector<HTMLElement>('#build-panel')!;
}

function press(code: string, repeat = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    code,
    key: code,
    bubbles: true,
    cancelable: true,
    repeat,
  });
  document.dispatchEvent(event);
  return event;
}

describe('构筑面板 DOM', () => {
  it('打开后渲染五类分组、净属性，并把焦点交给面板', () => {
    mountDom();
    const onClose = vi.fn();
    const handle = mountBuildPanel({ onClose });
    const view = buildBuildPanelView(
      input({
        potions: [{ id: 'P03', pending: 1, active: 0 }],
        items: [{ id: 'I16', stacks: 1 }],
        cores: ['E01'],
        crafted: ['R01'],
        hexes: ['H01'],
      }),
    );
    handle.show(view);
    expect(handle.isVisible()).toBe(true);
    expect(document.querySelector('#build-overlay')?.hasAttribute('hidden')).toBe(false);
    expect(document.activeElement?.id).toBe('build-panel');
    expect(
      [...document.querySelectorAll<HTMLElement>('.build-group')].map(
        (node) => node.dataset.group,
      ),
    ).toEqual(['potion', 'item', 'core', 'crafted', 'hex']);
    expect(document.querySelectorAll('.build-attribute').length).toBe(18);
    expect(document.querySelector('#build-summary')?.textContent).toContain(
      '第 7 波',
    );
    expect(document.querySelector('.build-entry.is-inactive')).not.toBeNull();

    handle.destroy();
  });

  it('B 与 Esc 关闭面板，长按重复不再触发', () => {
    mountDom();
    const onClose = vi.fn();
    const handle = mountBuildPanel({ onClose });
    handle.show(buildBuildPanelView(input()));

    const first = press('KeyB');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);
    press('KeyB', true);
    expect(onClose).toHaveBeenCalledTimes(1);

    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(2);
    handle.destroy();
  });

  it('方向键/PgUp/PgDn/Home/End 滚动面板并阻止事件继续传播', () => {
    const panel = mountDom();
    Object.defineProperty(panel, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(panel, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    const onClose = vi.fn();
    const handle = mountBuildPanel({ onClose });
    handle.show(buildBuildPanelView(input()));

    const down = press('ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    expect(panel.scrollTop).toBe(BUILD_SCROLL_LINE_PX);

    press('End');
    expect(panel.scrollTop).toBe(600);

    press('Home');
    expect(panel.scrollTop).toBe(0);

    press('PageDown');
    expect(panel.scrollTop).toBeGreaterThan(0);

    press('PageUp');
    expect(panel.scrollTop).toBe(0);

    expect(onClose).not.toHaveBeenCalled();
    handle.destroy();
  });

  it('关闭后移除监听并隐藏覆盖层', () => {
    mountDom();
    const handle = mountBuildPanel({ onClose: vi.fn() });
    handle.show(buildBuildPanelView(input()));
    handle.hide();
    expect(handle.isVisible()).toBe(false);
    expect(document.querySelector('#build-overlay')?.hasAttribute('hidden')).toBe(true);

    const event = press('ArrowDown');
    expect(event.defaultPrevented).toBe(false);
    handle.destroy();
  });
});
