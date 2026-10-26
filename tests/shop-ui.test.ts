import { describe, expect, it } from 'vitest';
import type {
  FreeSkillQuoteResult,
  FreeSkillQuoteSuccess,
} from '../src/game/free-skill-shop';
import type { ShopOffer } from '../src/game/shop-offer';
import type { ShopTradeFailure } from '../src/game/shop-transaction';
import {
  SHOP_NO_BENEFIT,
  SHOP_NO_COST,
  ShopUiCursor,
  buildShopUiView,
  describeEmergencyPotionEntry,
  describeItemEntry,
  describePotionEntry,
  describeRecipeEntry,
  describeSellEntry,
  describeSkillEntry,
  describeSupplyEntry,
  formatGoldChange,
  formatGoldGain,
  formatShortfall,
  indexOfShopKey,
  isNegativeShopLine,
  shopConfirmHint,
  shopConfirmLabel,
  shopEntrySlotLabel,
  splitShopLines,
  type ShopUiTracking,
} from '../src/game/shop-ui';

const GOLD = 120;

function itemOffer(overrides: Partial<ShopOffer> = {}): ShopOffer {
  return {
    slot: 0,
    kind: 'item',
    id: 'I01',
    name: '生命护符',
    price: 45,
    sold: false,
    locked: false,
    rarity: '普通',
    tag: '生命',
    description: '最大生命 100 → 110',
    cost: '移速 100% → 90%',
    prerequisite: null,
    stacks: 1,
    stackCap: 3,
    nextStacks: 2,
    ...overrides,
  };
}

function failure(reason: string, shortfall = 0): ShopTradeFailure {
  return {
    ok: false,
    reason: reason as ShopTradeFailure['reason'],
    shortfall,
    gold: GOLD,
  };
}

function skillFailure(reason: string, shortfall = 0): FreeSkillQuoteResult {
  return {
    ok: false,
    reason: reason as never,
    shortfall,
    gold: GOLD,
  };
}

const EMPTY_TRACKING: ShopUiTracking = {
  tracked: false,
  recipeId: null,
  name: null,
  ownedIngredients: 0,
  requiredIngredients: 3,
  ingredients: [],
  missingNames: [],
  craftable: false,
  fee: null,
  shortfall: 0,
};

describe('商店文本与净变化', () => {
  it('把分号分隔的收益/代价拆行，并保留占位行', () => {
    expect(splitShopLines('最大生命 100 → 110；移速 100% → 90%')).toEqual([
      '最大生命 100 → 110',
      '移速 100% → 90%',
    ]);
    expect(splitShopLines(null)).toEqual([]);
  });

  it('负值代价行需要暖红样式，占位行不算', () => {
    expect(isNegativeShopLine('移速 100% → 90%')).toBe(true);
    expect(isNegativeShopLine(SHOP_NO_COST)).toBe(false);
    expect(isNegativeShopLine(SHOP_NO_BENEFIT)).toBe(false);
  });

  it('金币变化与差额文案固定', () => {
    expect(formatGoldChange(120, 45)).toBe('金币 120 → 75（-45）');
    expect(formatGoldChange(30, 45)).toBe('金币 30 → 0（-45）');
    expect(formatGoldGain(30, 12)).toBe('金币 30 → 42（+12）');
    expect(formatShortfall(30, 45)).toBe('差 15');
    expect(formatShortfall(45, 45)).toBeNull();
  });
});

describe('货架卡片', () => {
  it('道具卡同屏显示收益、代价、层数与购买后金币', () => {
    const entry = describeItemEntry({
      offer: itemOffer(),
      price: 45,
      gold: GOLD,
      check: { ok: true, offer: itemOffer(), price: 45, shortfall: 0 },
    });
    expect(entry.kind).toBe('item');
    expect(entry.benefit).toEqual(['最大生命 100 → 110']);
    expect(entry.cost).toEqual(['移速 100% → 90%']);
    expect(entry.meta).toContain('层数 1/3 → 2/3');
    expect(entry.disabled).toBe(false);
    expect(entry.detail[0]?.text).toBe('金币 120 → 75（-45）');
    expect(
      entry.detail.some((line) => line.tone === 'cost' && line.text.includes('移速')),
    ).toBe(true);
  });

  it('金币不足显示差额并禁用购买', () => {
    const entry = describeItemEntry({
      offer: itemOffer(),
      price: 45,
      gold: 30,
      check: failure('insufficient-gold', 15),
    });
    expect(entry.disabled).toBe(true);
    expect(entry.shortfall).toBe(15);
    expect(entry.disabledReason).toContain('差 15');
    expect(entry.detail.some((line) => line.tone === 'warn')).toBe(true);
  });

  it('已售出与已锁定状态互斥显示', () => {
    const sold = describeItemEntry({
      offer: itemOffer({ sold: true, locked: false }),
      price: 45,
      gold: GOLD,
      check: failure('already-sold'),
    });
    expect(sold.stateLabel).toBe('已售出');
    expect(sold.disabled).toBe(true);

    const locked = describeItemEntry({
      offer: itemOffer({ locked: true }),
      price: 45,
      gold: GOLD,
      check: { ok: true, offer: itemOffer(), price: 45, shortfall: 0 },
    });
    expect(locked.stateLabel).toBe('已锁定');
  });

  it('无新增代价时仍显示明确占位行', () => {
    const entry = describeItemEntry({
      offer: itemOffer({ cost: null }),
      price: 45,
      gold: GOLD,
      check: { ok: true, offer: itemOffer(), price: 45, shortfall: 0 },
    });
    expect(entry.cost).toEqual([SHOP_NO_COST]);
  });
});

describe('技能卡', () => {
  function skillOffer(): ShopOffer {
    return {
      slot: 3,
      kind: 'skill',
      id: 'S01',
      name: '旋刃环',
      price: 70,
      sold: false,
      locked: false,
      tag: '范围',
      description: '3 秒每秒 45 物伤',
      cost: null,
      prerequisite: null,
      cooldownSeconds: 8,
    };
  }

  function quote(): FreeSkillQuoteSuccess {
    return {
      ok: true,
      offerSlot: 3,
      action: 'replace',
      skillId: 'S02',
      skillName: '霜环',
      targetSlot: 'U',
      level: 1,
      cooldownSeconds: 8,
      description: '半径 140 法伤',
      price: 70,
      refund: 12,
      netGold: -58,
      subsidized: false,
      replaced: {
        id: 'S01',
        name: '旋刃环',
        level: 2,
        cooldownSeconds: 8,
        paidTotal: 30,
        refund: 12,
      },
      affordable: true,
      shortfall: 0,
    };
  }

  it('显示替换目标槽、等级、冷却与回收净金币', () => {
    const entry = describeSkillEntry({
      offer: skillOffer(),
      quote: quote(),
      gold: 120,
    });
    expect(entry.kind).toBe('skill');
    expect(entry.meta.join(' / ')).toContain('替换 → U 槽');
    expect(entry.meta.join(' / ')).toContain('替换回收 12 金币');
    expect(entry.detail[0]?.text).toContain('金币 120 → 62');
    expect(entry.disabled).toBe(false);
  });

  it('两槽已满时禁用并给出原因', () => {
    const entry = describeSkillEntry({
      offer: skillOffer(),
      quote: skillFailure('slots-full'),
      gold: 120,
    });
    expect(entry.disabled).toBe(true);
    expect(entry.disabledReason).toContain('U/I 两槽已满');
  });

  it('金币不足时显示差额', () => {
    const entry = describeSkillEntry({
      offer: skillOffer(),
      quote: { ...quote(), affordable: false, shortfall: 20 },
      gold: 50,
    });
    expect(entry.disabled).toBe(true);
    expect(entry.shortfall).toBe(20);
    expect(entry.disabledReason).toContain('差 20');
  });
});

describe('药剂卡', () => {
  function potionOffer(): ShopOffer {
    return {
      slot: 4,
      kind: 'potion',
      id: 'P03',
      name: '狂怒药剂',
      price: 30,
      sold: false,
      locked: false,
      description: '下一波伤害 +12%',
      cost: null,
      prerequisite: null,
      limit: '每波最多 2 次',
    };
  }

  it('显示本波上限与已排队层数，到达上限后禁用', () => {
    const entry = describePotionEntry({
      offer: potionOffer(),
      price: 30,
      gold: GOLD,
      check: { ok: true, offer: potionOffer(), price: 30, shortfall: 0 },
      queued: 2,
      perWaveLimit: 2,
      purchases: 2,
      limitReached: true,
    });
    expect(entry.disabled).toBe(true);
    expect(entry.disabledReason).toContain('本波最多 2 次');
    expect(entry.meta.join(' / ')).toContain('本波 2/2');
    expect(entry.stateLabel).toBe('本波上限');
  });

  it('常驻 P01 已买过时明确显示可再买一个', () => {
    const entry = describeEmergencyPotionEntry({
      potion: {
        id: 'P01',
        name: '应急治疗剂',
        price: 25,
        repeatable: true,
        limit: '立即治疗 40',
      },
      effect: '立即回复 40 生命',
      gold: GOLD,
      purchases: 2,
    });
    expect(entry.stateLabel).toContain('可再买一个');
    expect(entry.repeatable).toBe(true);
    expect(entry.meta.join(' / ')).toContain('本商店已买 2 次');
    expect(shopConfirmLabel(entry)).toBe('再买一个 应急治疗剂？');
  });

  it('常驻 P01 金币不足时禁用并显示差额', () => {
    const entry = describeEmergencyPotionEntry({
      potion: {
        id: 'P01',
        name: '应急治疗剂',
        price: 25,
        repeatable: true,
        limit: '立即治疗 40',
      },
      effect: '立即回复 40 生命',
      gold: 10,
      purchases: 0,
    });
    expect(entry.disabled).toBe(true);
    expect(entry.disabledReason).toContain('差 15');
  });
});

describe('缺件供给与出售', () => {
  it('缺件供给显示配方、层数与独立于五格', () => {
    const entry = describeSupplyEntry({
      supply: {
        recipeId: 'R01',
        id: 'I02',
        name: '锋刃碎片',
        price: 50,
        rarity: '稀有',
        description: '攻速 100% → 110%',
        cost: '最大生命 100 → 95',
        stacks: 1,
        stackCap: 3,
        sold: false,
      },
      price: 50,
      gold: GOLD,
      full: false,
    });
    expect(entry.kind).toBe('supply');
    expect(entry.highlight).toBe(true);
    expect(entry.meta.join(' / ')).toContain('配方 R01 缺件');
    expect(entry.cost).toEqual(['最大生命 100 → 95']);
  });

  it('出售行显示回收、剩余层数与出售后失去的效果', () => {
    const entry = describeSellEntry({
      itemId: 'I01',
      name: '生命护符',
      stacks: 2,
      stackCap: 3,
      effect: '最大生命 +10',
      check: {
        ok: true,
        itemId: 'I01',
        layers: 2,
        paid: 90,
        refund: 36,
        stacks: 2,
      },
      gold: 40,
    });
    expect(entry.priceLabel).toBe('+36 金币');
    expect(entry.benefit).toContain('回收 36 金币');
    expect(entry.cost[0]).toContain('出售后失去：最大生命 +10');
    expect(entry.meta.join(' / ')).toContain('出售后剩余 0 层');
    expect(entry.detail[0]?.text).toBe('金币 40 → 76（+36）');
  });
});

describe('配方页', () => {
  function recipeInput(overrides: Partial<Parameters<typeof describeRecipeEntry>[0]> = {}) {
    return {
      recipeId: 'R01',
      name: '嗜血护符',
      tracked: true,
      ownedIngredients: 3,
      requiredIngredients: 3,
      ingredients: [
        { id: 'I01', name: '生命护符', stacks: 1, missing: false },
        { id: 'I02', name: '锋刃碎片', stacks: 1, missing: false },
        { id: 'I06', name: '铁壁石', stacks: 1, missing: false },
      ],
      craftable: true,
      fee: 50,
      gold: 120,
      shortfall: 0,
      missing: [],
      ...overrides,
    };
  }

  it('可合成时整行高亮，并显示逐件进度', () => {
    const entry = describeRecipeEntry(recipeInput());
    expect(entry.highlight).toBe(true);
    expect(entry.stateLabel).toBe('可合成');
    expect(entry.benefit).toContain('生命护符 1/1');
    expect(entry.detail.some((line) => line.tone === 'good')).toBe(true);
  });

  it('缺件显示名称与进度，并禁用合成', () => {
    const entry = describeRecipeEntry(
      recipeInput({
        ownedIngredients: 1,
        craftable: false,
        missing: ['锋刃碎片', '铁壁石'],
        ingredients: [
          { id: 'I01', name: '生命护符', stacks: 1, missing: false },
          { id: 'I02', name: '锋刃碎片', stacks: 0, missing: true },
          { id: 'I06', name: '铁壁石', stacks: 0, missing: true },
        ],
      }),
    );
    expect(entry.highlight).toBe(false);
    expect(entry.disabled).toBe(true);
    expect(entry.disabledReason).toContain('缺 锋刃碎片/铁壁石');
    expect(entry.benefit).toContain('锋刃碎片 0/1（缺）');
    expect(entry.meta.join(' / ')).toContain('材料 1/3');
  });

  it('未追踪配方可以按 Enter 进入追踪', () => {
    const entry = describeRecipeEntry(recipeInput({ tracked: false }));
    expect(entry.stateLabel).toBe('未追踪');
    expect(entry.disabled).toBe(false);
    expect(entry.meta).toContain('未追踪 · Enter 追踪');
  });
});

describe('商店键盘游标', () => {
  it('方向键循环移动焦点，移动会取消确认', () => {
    const cursor = new ShopUiCursor();
    cursor.move(1, 5);
    expect(cursor.focus).toBe(1);
    cursor.requestConfirm('offer:1', '购买', '再次确认');
    cursor.move(-1, 5);
    expect(cursor.focus).toBe(0);
    expect(cursor.confirm).toBeNull();
    cursor.move(-1, 5);
    expect(cursor.focus).toBe(4);
  });

  it('Tab 在货架/装备/配方之间循环，切页清空确认', () => {
    const cursor = new ShopUiCursor();
    cursor.requestConfirm('offer:0', '购买', '再次确认');
    expect(cursor.cyclePage(1, 4)).toBe('equipment');
    expect(cursor.confirm).toBeNull();
    expect(cursor.focus).toBe(0);
    expect(cursor.cyclePage(1, 4)).toBe('recipe');
    expect(cursor.cyclePage(1, 4)).toBe('shelf');
    expect(cursor.cyclePage(-1, 4)).toBe('recipe');
  });

  it('Enter 第一次进入确认，第二次返回 second', () => {
    const cursor = new ShopUiCursor();
    expect(cursor.requestConfirm('offer:0', '购买 A', '再次确认')).toBe('first');
    expect(cursor.confirm?.label).toBe('购买 A');
    expect(cursor.requestConfirm('offer:0', '购买 A', '再次确认')).toBe('second');
    expect(cursor.requestConfirm('offer:1', '购买 B', '再次确认')).toBe('first');
  });

  it('焦点夹取在条目数量内', () => {
    const cursor = new ShopUiCursor();
    cursor.focusTo(99, 5);
    expect(cursor.focus).toBe(4);
    cursor.clamp(2);
    expect(cursor.focus).toBe(1);
    cursor.clamp(0);
    expect(cursor.focus).toBe(0);
  });
});

describe('商店视图', () => {
  it('顶部显示金币/生命/下波类型/结算状态，底部显示 U/I', () => {
    const entries = [
      describeItemEntry({
        offer: itemOffer(),
        price: 45,
        gold: GOLD,
        check: { ok: true, offer: itemOffer(), price: 45, shortfall: 0 },
      }),
    ];
    const view = buildShopUiView({
      wave: 4,
      gold: GOLD,
      health: 80,
      maxHealth: 100,
      shield: 5,
      nextWave: 5,
      nextWaveKind: '精英',
      settlementLabel: '本波奖励已全部领取 · 结算完成',
      page: 'shelf',
      focus: 0,
      entries,
      tracking: EMPTY_TRACKING,
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
      rerollCost: 8,
      freeReroll: false,
      rerollCount: 1,
      rerollAffordable: true,
      rerollShortfall: 0,
      lockedSlot: null,
    });
    expect(view.title).toBe('第 4 波后 · 商店');
    expect(view.nextWaveLabel).toBe('第 5 波 · 精英');
    expect(view.settlementLabel).toContain('结算完成');
    expect(view.tabs.map((tab) => tab.label)).toEqual(['货架', '装备', '配方']);
    expect(view.detailTitle).toContain('生命护符');
    expect(view.skills.map((slot) => slot.slot)).toEqual(['U', 'I']);
    expect(view.rerollLabel).toBe('重抽 R · 8 金币（已重抽 1 次）');
    expect(view.lockLabel).toBe('F 锁定选中');
  });

  it('免费重抽与金币不足的反馈文案清楚', () => {
    const base = {
      wave: 3,
      gold: 5,
      health: 100,
      maxHealth: 100,
      shield: 0,
      nextWave: 4,
      nextWaveKind: '普通',
      settlementLabel: '结算完成',
      page: 'shelf' as const,
      focus: 0,
      entries: [],
      tracking: EMPTY_TRACKING,
      skills: [],
      attributes: [],
      groups: [],
      message: null,
      confirm: null,
      rerollCost: 8,
      rerollCount: 0,
    };
    const free = buildShopUiView({
      ...base,
      freeReroll: true,
      rerollAffordable: true,
      rerollShortfall: 0,
      lockedSlot: 3,
    });
    expect(free.rerollLabel).toContain('免费');
    expect(free.lockLabel).toBe('F 解除锁定 [4]');

    const poor = buildShopUiView({
      ...base,
      freeReroll: false,
      rerollAffordable: false,
      rerollShortfall: 3,
      lockedSlot: null,
    });
    expect(poor.rerollLabel).toContain('差 3');
  });

  it('确认文案对药剂使用「再买一个」，出售/合成使用对应动词', () => {
    const potion = describeEmergencyPotionEntry({
      potion: {
        id: 'P01',
        name: '应急治疗剂',
        price: 25,
        repeatable: true,
        limit: '立即治疗 40',
      },
      effect: '立即回复 40 生命',
      gold: 120,
      purchases: 1,
    });
    expect(shopConfirmLabel(potion)).toBe('再买一个 应急治疗剂？');
    expect(shopConfirmHint(potion)).toContain('长按不会重复购买');

    const sell = describeSellEntry({
      itemId: 'I01',
      name: '生命护符',
      stacks: 1,
      stackCap: 3,
      effect: null,
      check: { ok: true, itemId: 'I01', layers: 1, paid: 45, refund: 18, stacks: 1 },
      gold: 0,
    });
    expect(shopConfirmLabel(sell)).toBe('出售 生命护符？');
    expect(shopConfirmHint(sell)).toContain('出售全部层数');

    const recipe = describeRecipeEntry({
      recipeId: 'R01',
      name: '嗜血护符',
      tracked: true,
      ownedIngredients: 3,
      requiredIngredients: 3,
      ingredients: [],
      craftable: false,
      fee: 50,
      gold: 0,
      shortfall: 0,
      missing: [],
    });
    expect(shopConfirmLabel(recipe)).toBe('合成 嗜血护符？');
  });

  it('按 key 找到焦点下标，未知 key 回退 0', () => {
    const entries = [
      describeEmergencyPotionEntry({
        potion: { id: 'P01', name: 'P01', price: 25, repeatable: true, limit: '' },
        effect: '治疗',
        gold: 120,
        purchases: 0,
      }),
    ];
    expect(indexOfShopKey(entries, 'potion:P01')).toBe(0);
    expect(indexOfShopKey(entries, 'missing')).toBe(0);
  });
});

describe('顶部信息带取整', () => {
  it('小数生命与护盾按 HUD 口径向上取整，不出现长浮点串', () => {
    const view = buildShopUiView({
      wave: 4,
      gold: GOLD,
      health: 122.25,
      maxHealth: 135.0000000001,
      shield: 4.000000000000001,
      nextWave: 5,
      nextWaveKind: '普通',
      settlementLabel: '结算完成',
      page: 'shelf',
      focus: 0,
      entries: [],
      tracking: EMPTY_TRACKING,
      skills: [],
      attributes: [],
      groups: [],
      message: null,
      confirm: null,
      rerollCost: 8,
      freeReroll: false,
      rerollCount: 0,
      rerollAffordable: true,
      rerollShortfall: 0,
      lockedSlot: null,
    });
    expect(view.health).toBe(123);
    expect(view.maxHealth).toBe(136);
    expect(view.shield).toBe(5);
    expect(`${view.health}/${view.maxHealth}`).toBe('123/136');
  });
});

describe('卡片槽位标签', () => {
  it('按条目类型标注，药剂/缺件/配方不再兜底成「装备」', () => {
    expect(
      shopEntrySlotLabel(
        describeItemEntry({
          offer: itemOffer(),
          price: 45,
          gold: GOLD,
          check: { ok: true, offer: itemOffer(), price: 45, shortfall: 0 },
        }),
      ),
    ).toBe('[1]');
    expect(
      shopEntrySlotLabel(
        describeEmergencyPotionEntry({
          potion: { id: 'P01', name: '应急治疗剂', price: 25, repeatable: true, limit: '' },
          effect: '治疗',
          gold: GOLD,
          purchases: 0,
        }),
      ),
    ).toBe('药剂');
    expect(
      shopEntrySlotLabel(
        describeSupplyEntry({
          supply: {
            recipeId: 'R01',
            id: 'I02',
            name: '锋刃碎片',
            price: 50,
            rarity: '稀有',
            description: '攻速 100% → 110%',
            cost: '最大生命 100 → 95',
            stacks: 1,
            stackCap: 3,
            sold: false,
          },
          price: 50,
          gold: GOLD,
          full: false,
        }),
      ),
    ).toBe('缺件');
    expect(
      shopEntrySlotLabel(
        describeSellEntry({
          itemId: 'I01',
          name: '生命护符',
          stacks: 1,
          stackCap: 3,
          effect: null,
          check: {
            ok: true,
            itemId: 'I01',
            layers: 1,
            paid: 45,
            refund: 18,
            stacks: 1,
          },
          gold: GOLD,
        }),
      ),
    ).toBe('出售');
    expect(
      shopEntrySlotLabel(
        describeRecipeEntry({
          recipeId: 'R01',
          name: '嗜血护符',
          tracked: false,
          ownedIngredients: 0,
          requiredIngredients: 3,
          ingredients: [],
          craftable: false,
          fee: 50,
          gold: GOLD,
          shortfall: 0,
          missing: [],
        }),
      ),
    ).toBe('配方');
  });
});
