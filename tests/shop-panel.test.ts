// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SHOP_NO_COST,
  type ShopUiEntry,
  type ShopUiView,
} from '../src/game/shop-ui';
import { mountShopPanel } from '../src/ui/shop-panel';

function mountDom(): void {
  document.body.innerHTML = `
    <div id="shop-overlay" hidden aria-hidden="true">
      <section id="shop-panel">
        <h2 id="shop-title"></h2>
        <div id="shop-meta"></div>
        <div id="shop-tabs"></div>
        <div id="shop-main"></div>
        <div id="shop-tracking"></div>
        <div id="shop-detail"></div>
        <div id="shop-confirm" hidden></div>
        <p id="shop-message"></p>
        <div id="shop-skills"></div>
        <span id="shop-reroll"></span>
        <span id="shop-lock"></span>
        <button id="shop-next-wave" type="button"></button>
        <p id="shop-hint"></p>
      </section>
    </div>
  `;
}

function entry(overrides: Partial<ShopUiEntry> = {}): ShopUiEntry {
  return {
    key: 'offer:0',
    kind: 'item',
    id: 'I01',
    slot: 0,
    name: '生命护符',
    tag: '生命',
    rarity: '普通',
    benefit: ['最大生命 100 → 110'],
    cost: ['移速 100% → 90%'],
    meta: ['层数 1/3 → 2/3'],
    price: 45,
    priceLabel: '45 金币',
    stateLabel: null,
    disabled: false,
    disabledReason: null,
    shortfall: 0,
    highlight: false,
    repeatable: false,
    detail: [
      { text: '金币 120 → 75（-45）', tone: 'neutral' },
      { text: '购买后：最大生命 100 → 110', tone: 'benefit' },
      { text: '代价：移速 100% → 90%', tone: 'cost' },
    ],
    ...overrides,
  };
}

function makeView(overrides: Partial<ShopUiView> = {}): ShopUiView {
  const entries = [
    entry(),
    entry({ key: 'offer:1', slot: 1, name: '锋刃碎片' }),
    entry({ key: 'offer:2', slot: 2, name: '铁壁石' }),
    entry({ key: 'offer:3', slot: 3, name: '霜环' }),
    entry({ key: 'offer:4', slot: 4, name: '狂怒药剂' }),
    entry({
      key: 'potion:P01',
      slot: null,
      id: 'P01',
      kind: 'potion',
      name: '应急治疗剂',
      priceLabel: '25 金币',
      stateLabel: '已买 1 次 · 可再买一个',
      cost: [SHOP_NO_COST],
      repeatable: true,
    }),
  ];
  return {
    wave: 4,
    title: '第 4 波后 · 商店',
    gold: 120,
    health: 80,
    maxHealth: 100,
    shield: 5,
    nextWaveLabel: '第 5 波 · 精英',
    settlementLabel: '本波奖励已全部领取 · 结算完成',
    page: 'shelf',
    tabs: [
      { id: 'shelf', label: '货架', active: true },
      { id: 'equipment', label: '装备', active: false },
      { id: 'recipe', label: '配方', active: false },
    ],
    entries,
    focus: 0,
    detailTitle: '生命护符 · 生命',
    detail: [
      { text: '金币 120 → 75（-45）', tone: 'neutral' },
      { text: '购买后：最大生命 100 → 110', tone: 'benefit' },
      { text: '代价：移速 100% → 90%', tone: 'cost' },
    ],
    tracking: {
      tracked: true,
      recipeId: 'R01',
      name: '嗜血护符',
      ownedIngredients: 1,
      requiredIngredients: 3,
      ingredients: [
        { id: 'I01', name: '生命护符', stacks: 1, required: 1, missing: false },
        { id: 'I02', name: '锋刃碎片', stacks: 0, required: 1, missing: true },
        { id: 'I06', name: '铁壁石', stacks: 0, required: 1, missing: true },
      ],
      missingNames: ['锋刃碎片', '铁壁石'],
      craftable: false,
      fee: 50,
      shortfall: 0,
    },
    skills: [
      {
        slot: 'U',
        name: '旋刃环',
        level: 2,
        cooldownSeconds: 8,
        description: '3 秒每秒 45 物伤',
      },
      {
        slot: 'I',
        name: '空槽',
        level: null,
        cooldownSeconds: null,
        description: '可在货架装备自由技能',
      },
    ],
    attributes: [],
    groups: [],
    message: null,
    confirm: null,
    footerHint: '卡片同屏显示收益与代价',
    focusHint: '← → 选卡 · Enter 购买/确认',
    nextWaveLabelForButton: '准备下一波',
    rerollLabel: '重抽 R · 8 金币（已重抽 1 次）',
    lockLabel: 'F 锁定选中',
    ...overrides,
  };
}

function key(
  code: string,
  options: { repeat?: boolean; shiftKey?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    code,
    key: code,
    bubbles: true,
    cancelable: true,
    repeat: options.repeat ?? false,
    shiftKey: options.shiftKey ?? false,
  });
  document.dispatchEvent(event);
  return event;
}

function keyUp(code: string): void {
  document.dispatchEvent(
    new KeyboardEvent('keyup', { code, key: code, bubbles: true }),
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('商店 DOM 面板', () => {
  it('渲染顶部信息、五格货物、负代价、缺件与 U/I', () => {
    mountDom();
    const panel = mountShopPanel({ onAction: vi.fn() });
    panel.show(makeView());

    expect(document.querySelector('#shop-title')?.textContent).toBe(
      '第 4 波后 · 商店',
    );
    const meta = document.querySelector('#shop-meta')?.textContent ?? '';
    expect(meta).toContain('金币');
    expect(meta).toContain('120');
    expect(meta).toContain('下波');
    expect(meta).toContain('第 5 波 · 精英');
    expect(meta).toContain('结算完成');

    const gridCards = document.querySelectorAll('#shop-main .shop-grid .shop-card');
    expect(gridCards.length).toBe(5);
    expect(document.querySelectorAll('.shop-card-line.is-cost').length).toBeGreaterThan(0);
    expect(document.querySelector('.shop-card-line.is-cost')?.textContent).toContain('▼');
    expect(document.querySelector('.shop-craftable')).toBeNull();
    expect(document.querySelectorAll('.shop-tracking-list .is-missing').length).toBe(2);
    expect(document.querySelectorAll('.shop-skill-slot').length).toBe(2);
    expect(document.querySelector('#shop-detail')?.textContent).toContain(
      '金币 120 → 75',
    );
    expect(document.querySelector('#shop-reroll')?.textContent).toContain('8 金币');
    expect(document.querySelector('#shop-lock')?.textContent).toContain('锁定');
  });

  it('非货架条目按类型标注槽位，不把药剂/配方写成「装备」', () => {
    mountDom();
    const panel = mountShopPanel({ onAction: vi.fn() });
    panel.show(
      makeView({
        entries: [
          entry(),
          entry({
            key: 'potion:P01',
            kind: 'potion',
            slot: null,
            id: 'P01',
            name: '应急治疗剂',
            tag: '常驻',
            rarity: null,
            priceLabel: '25 金币',
            cost: [SHOP_NO_COST],
            repeatable: true,
          }),
          entry({
            key: 'supply',
            kind: 'supply',
            slot: null,
            id: 'I02',
            name: '锋刃碎片',
            tag: '缺件',
            rarity: null,
            priceLabel: '50 金币',
            highlight: true,
          }),
          entry({
            key: 'recipe:R01',
            kind: 'recipe',
            slot: null,
            id: 'R01',
            name: '嗜血护符',
            tag: '配方',
            rarity: null,
            priceLabel: '手续费 50 金币',
          }),
        ],
      }),
    );

    const labels = [...document.querySelectorAll('.shop-card-slot')].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(['[1]', '药剂', '缺件', '配方']);
    expect(labels).not.toContain('装备');
    const tags = [...document.querySelectorAll('.shop-card-rarity')].map(
      (node) => node.textContent,
    );
    expect(tags).toContain('常驻');
  });

  it('焦点可见，方向键与 Tab/Enter/R/F/空格/Esc 上报动作', () => {
    mountDom();
    const onAction = vi.fn();
    const panel = mountShopPanel({ onAction });
    panel.show(makeView());

    const focused = document.querySelector<HTMLElement>('.shop-card.is-focused');
    expect(focused?.dataset.key).toBe('offer:0');
    expect(document.activeElement).toBe(focused);

    key('ArrowRight');
    expect(onAction).toHaveBeenLastCalledWith({ type: 'move', delta: 1 });
    key('ArrowUp');
    expect(onAction).toHaveBeenLastCalledWith({ type: 'move', delta: -1 });
    key('Tab');
    expect(onAction).toHaveBeenLastCalledWith({ type: 'page', delta: 1 });
    keyUp('Tab');
    key('Tab', { shiftKey: true });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'page', delta: -1 });
    key('KeyR');
    expect(onAction).toHaveBeenLastCalledWith({ type: 'reroll' });
    key('KeyF');
    expect(onAction).toHaveBeenLastCalledWith({ type: 'lock' });
    key('Space');
    expect(onAction).toHaveBeenLastCalledWith({ type: 'next-wave' });
    key('Escape');
    expect(onAction).toHaveBeenLastCalledWith({ type: 'cancel' });
    key('Enter');
    expect(onAction).toHaveBeenLastCalledWith({ type: 'confirm' });
  });

  it('Enter 长按不会重复购买，松开后才接受下一次', () => {
    mountDom();
    const onAction = vi.fn();
    const panel = mountShopPanel({ onAction });
    panel.show(makeView());

    key('Enter');
    key('Enter', { repeat: true });
    key('Enter');
    expect(onAction).toHaveBeenCalledTimes(1);
    keyUp('Enter');
    key('Enter');
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('切换页面后渲染装备列表与属性面板，并保持焦点', () => {
    mountDom();
    const onAction = vi.fn();
    const panel = mountShopPanel({ onAction });
    panel.show(makeView());

    const equipmentView = makeView({
      page: 'equipment',
      entries: [
        entry({
          key: 'sell:I01',
          kind: 'sell',
          slot: null,
          name: '生命护符',
          priceLabel: '+18 金币',
          benefit: ['回收 18 金币'],
          cost: ['出售后失去：最大生命 +10'],
          detail: [{ text: '金币 120 → 138（+18）', tone: 'neutral' }],
        }),
      ],
      focus: 0,
      attributes: [
        { label: '生命', value: '80/100' },
        { label: '护甲', value: '4' },
      ],
      groups: [{ title: '海克斯（1）', lines: ['H01 弱点感知'] }],
      tabs: [
        { id: 'shelf', label: '货架', active: false },
        { id: 'equipment', label: '装备', active: true },
        { id: 'recipe', label: '配方', active: false },
      ],
    });
    panel.update(equipmentView);

    expect(document.querySelectorAll('.shop-list .shop-card').length).toBe(1);
    expect(document.querySelector('.shop-attributes')?.textContent).toContain('生命');
    expect(document.querySelector('.shop-groups')?.textContent).toContain('H01');
    expect(document.querySelector<HTMLElement>('.shop-card.is-focused')?.dataset.key).toBe(
      'sell:I01',
    );
    expect(document.querySelector('.shop-card-line.is-cost')?.textContent).toContain(
      '出售后失去',
    );
  });

  it('确认状态、短提示与可合成高亮同屏显示', () => {
    mountDom();
    const panel = mountShopPanel({ onAction: vi.fn() });
    panel.show(
      makeView({
        confirm: { text: '购买 生命护符？ · 再次按 Enter 确认 · Esc 取消', tone: 'warn' },
        message: { text: '再次按 Enter 确认', tone: 'warn' },
        tracking: {
          ...makeView().tracking,
          craftable: true,
          missingNames: [],
          ingredients: [
            { id: 'I01', name: '生命护符', stacks: 1, required: 1, missing: false },
          ],
        },
      }),
    );

    const confirm = document.querySelector<HTMLElement>('#shop-confirm');
    expect(confirm?.hidden).toBe(false);
    expect(confirm?.textContent).toContain('再次按 Enter 确认');
    expect(document.querySelector('#shop-message')?.textContent).toContain(
      '再次按 Enter',
    );
    expect(document.querySelector('.shop-craftable')?.textContent).toContain(
      '可合成',
    );
    expect(document.querySelector('.shop-card.is-confirming')).not.toBeNull();
  });

  it('金币不足时卡片显示差额且点击仍上报激活', () => {
    mountDom();
    const onAction = vi.fn();
    const panel = mountShopPanel({ onAction });
    panel.show(
      makeView({
        entries: [
          entry({
            disabled: true,
            disabledReason: '金币不足 · 差 15',
            shortfall: 15,
          }),
        ],
      }),
    );

    expect(document.querySelector('.shop-card-disabled')?.textContent).toContain(
      '差 15',
    );
    const card = document.querySelector<HTMLButtonElement>('.shop-card');
    expect(card?.getAttribute('aria-disabled')).toBe('true');
    card?.click();
    expect(onAction).toHaveBeenCalledWith({ type: 'activate', key: 'offer:0' });
  });

  it('点击页签、下一波按钮与卡片分别上报对应动作', () => {
    mountDom();
    const onAction = vi.fn();
    const panel = mountShopPanel({ onAction });
    panel.show(makeView());

    document.querySelector<HTMLButtonElement>('[data-page="recipe"]')?.click();
    expect(onAction).toHaveBeenLastCalledWith({ type: 'page-to', page: 'recipe' });
    document.querySelector<HTMLButtonElement>('#shop-next-wave')?.click();
    expect(onAction).toHaveBeenLastCalledWith({ type: 'next-wave' });
    document.querySelectorAll<HTMLButtonElement>('.shop-card')[2]?.click();
    expect(onAction).toHaveBeenLastCalledWith({ type: 'activate', key: 'offer:2' });
  });

  it('隐藏后不再响应键盘', () => {
    mountDom();
    const onAction = vi.fn();
    const panel = mountShopPanel({ onAction });
    panel.show(makeView());
    panel.hide();
    key('Enter');
    expect(onAction).not.toHaveBeenCalled();
    expect(panel.isVisible()).toBe(false);
  });
});
