/**
 * 商店界面（US-046）的纯视图模型与键盘状态机。
 *
 * 这里不依赖 Phaser / DOM：
 * - `describe*Entry` 把货架、技能、药剂、出售与配方数据转成可直接渲染的卡片；
 * - `ShopUiCursor` 管理页面、焦点、二次确认与短提示；
 * - `buildShopUiView` 汇总顶部信息、右侧缺件与底部 U/I。
 *
 * 场景负责取值与提交交易，DOM 面板只按类型渲染，规则测试可直接断言本模块。
 */

import { hudValue } from './combat';
import type { ItemRarity } from './data';
import type { FreeSkillQuoteResult } from './free-skill-shop';
import type {
  ShopEmergencyPotion,
  ShopMaterialSupply,
  ShopOffer,
} from './shop-offer';
import type {
  ShopPurchaseCheck,
  ShopSellCheck,
  ShopTradeFailure,
} from './shop-transaction';

export const SHOP_PANEL_EVENT = 'shop-panel';

export const SHOP_UI_PAGES = ['shelf', 'equipment', 'recipe'] as const;
export type ShopUiPage = (typeof SHOP_UI_PAGES)[number];

export const SHOP_PAGE_LABELS: Readonly<Record<ShopUiPage, string>> = {
  shelf: '货架',
  equipment: '装备',
  recipe: '配方',
};

export type ShopUiTone = 'neutral' | 'benefit' | 'cost' | 'warn' | 'good';

export interface ShopUiMessage {
  readonly text: string;
  readonly tone: ShopUiTone;
}

export interface ShopUiDetailLine {
  readonly text: string;
  readonly tone: ShopUiTone;
}

export type ShopUiEntryKind =
  | 'item'
  | 'skill'
  | 'potion'
  | 'supply'
  | 'sell'
  | 'recipe';

export interface ShopUiEntry {
  readonly key: string;
  readonly kind: ShopUiEntryKind;
  readonly id: string;
  /** 货架格号；非货架条目为 null。 */
  readonly slot: number | null;
  readonly name: string;
  readonly tag: string;
  readonly rarity: ItemRarity | null;
  /** 正收益逐行；没有时固定为「无新增收益」。 */
  readonly benefit: readonly string[];
  /** 代价逐行；没有时固定为「无新增代价」，负值行由面板标暖红。 */
  readonly cost: readonly string[];
  readonly meta: readonly string[];
  readonly price: number;
  readonly priceLabel: string;
  readonly stateLabel: string | null;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
  readonly shortfall: number;
  /** 可合成/缺件供给等需要高亮的条目。 */
  readonly highlight: boolean;
  /** 药剂类条目：已买过时确认文案用「再买一个」。 */
  readonly repeatable: boolean;
  /** 选中后展示在卡片下方的明细。 */
  readonly detail: readonly ShopUiDetailLine[];
}

/**
 * 卡片左上角的槽位标签：货架格号，或非货架条目的类型。
 * 药剂/缺件/配方不是可装备道具，不能统一兜底成「装备」。
 */
export function shopEntrySlotLabel(entry: ShopUiEntry): string {
  if (entry.slot !== null) return `[${entry.slot + 1}]`;
  switch (entry.kind) {
    case 'sell':
      return '出售';
    case 'potion':
      return '药剂';
    case 'supply':
      return '缺件';
    case 'recipe':
      return '配方';
    default:
      return '装备';
  }
}

export interface ShopUiTab {
  readonly id: ShopUiPage;
  readonly label: string;
  readonly active: boolean;
}

export interface ShopUiTrackingIngredient {
  readonly id: string;
  readonly name: string;
  readonly stacks: number;
  readonly required: number;
  readonly missing: boolean;
}

export interface ShopUiTracking {
  readonly tracked: boolean;
  readonly recipeId: string | null;
  readonly name: string | null;
  readonly ownedIngredients: number;
  readonly requiredIngredients: number;
  readonly ingredients: readonly ShopUiTrackingIngredient[];
  readonly missingNames: readonly string[];
  readonly craftable: boolean;
  readonly fee: number | null;
  readonly shortfall: number;
}

export interface ShopUiSkillSlot {
  readonly slot: 'U' | 'I';
  readonly name: string;
  readonly level: number | null;
  readonly cooldownSeconds: number | null;
  readonly description: string;
}

export interface ShopUiAttribute {
  readonly label: string;
  readonly value: string;
}

export interface ShopUiGroup {
  readonly title: string;
  readonly lines: readonly string[];
}

export interface ShopUiView {
  readonly wave: number;
  readonly title: string;
  readonly gold: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly shield: number;
  readonly nextWaveLabel: string;
  readonly settlementLabel: string;
  readonly page: ShopUiPage;
  readonly tabs: readonly ShopUiTab[];
  readonly entries: readonly ShopUiEntry[];
  readonly focus: number;
  readonly detailTitle: string;
  readonly detail: readonly ShopUiDetailLine[];
  readonly tracking: ShopUiTracking;
  readonly skills: readonly ShopUiSkillSlot[];
  readonly attributes: readonly ShopUiAttribute[];
  readonly groups: readonly ShopUiGroup[];
  readonly message: ShopUiMessage | null;
  readonly confirm: ShopUiMessage | null;
  readonly footerHint: string;
  readonly focusHint: string;
  readonly nextWaveLabelForButton: string;
  readonly rerollLabel: string;
  readonly lockLabel: string;
}

export type ShopUiAction =
  | { readonly type: 'move'; readonly delta: number }
  | { readonly type: 'page'; readonly delta: number }
  | { readonly type: 'page-to'; readonly page: ShopUiPage }
  | { readonly type: 'confirm' }
  | { readonly type: 'reroll' }
  | { readonly type: 'lock' }
  | { readonly type: 'next-wave' }
  | { readonly type: 'cancel' }
  | { readonly type: 'activate'; readonly key: string };

export type ShopPanelEventPayload =
  | { readonly type: 'open'; readonly view: ShopUiView }
  | { readonly type: 'update'; readonly view: ShopUiView }
  | { readonly type: 'close' };

export const SHOP_NO_BENEFIT = '无新增收益';
export const SHOP_NO_COST = '无新增代价';

/** 把「收益；代价」拆成逐行；空串返回空数组。 */
export function splitShopLines(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/[；\n]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function benefitLines(text: string | null | undefined): string[] {
  const lines = splitShopLines(text).filter(
    (line) => line !== SHOP_NO_BENEFIT && line !== SHOP_NO_COST,
  );
  return lines.length > 0 ? lines : [SHOP_NO_BENEFIT];
}

function costLines(text: string | null | undefined): string[] {
  const lines = splitShopLines(text).filter(
    (line) => line !== SHOP_NO_BENEFIT && line !== SHOP_NO_COST,
  );
  return lines.length > 0 ? lines : [SHOP_NO_COST];
}

/** 负值代价行需要暖红与下降箭头；占位行不算代价。 */
export function isNegativeShopLine(line: string): boolean {
  return line !== SHOP_NO_COST && line !== SHOP_NO_BENEFIT;
}

export function formatShopPrice(price: number): string {
  return `${Math.max(0, Math.floor(price))} 金币`;
}

/** 购买后的金币变化；不足时也显示到 0 并给出差额。 */
export function formatGoldChange(gold: number, price: number): string {
  const safeGold = Math.max(0, Math.floor(gold));
  const safePrice = Math.max(0, Math.floor(price));
  const next = Math.max(0, safeGold - safePrice);
  return `金币 ${safeGold} → ${next}（-${safePrice}）`;
}

/** 出售后的金币变化。 */
export function formatGoldGain(gold: number, refund: number): string {
  const safeGold = Math.max(0, Math.floor(gold));
  const safeRefund = Math.max(0, Math.floor(refund));
  return `金币 ${safeGold} → ${safeGold + safeRefund}（+${safeRefund}）`;
}

export function formatShortfall(gold: number, price: number): string | null {
  const shortfall = Math.max(0, Math.floor(price) - Math.floor(gold));
  if (shortfall <= 0) return null;
  return `差 ${shortfall}`;
}

/** 交易失败原因转成玩家可读的禁用文案。 */
export function shopFailureLabel(reason: string, shortfall = 0): string {
  switch (reason) {
    case 'insufficient-gold':
      return `金币不足 · 差 ${Math.max(0, Math.floor(shortfall))}`;
    case 'item-full':
      return '已达层数上限';
    case 'already-sold':
      return '本格已售出';
    case 'unsupported-kind':
      return '该商品暂不可交易';
    case 'delivery-failed':
      return '发货失败，金币已退回';
    case 'not-owned':
      return '未拥有该道具';
    case 'not-sellable':
      return '该条目不可出售';
    case 'slots-full':
      return 'U/I 两槽已满';
    case 'max-level':
      return '技能已满级';
    case 'not-a-skill':
      return '该商品不是技能';
    case 'unknown-skill':
      return '未知技能';
    case 'unknown-slot':
      return '未知商品格';
    case 'no-material-supply':
      return '本商店无缺件供给';
    case 'shop-unavailable':
      return '商店不可用';
    case 'unknown-recipe':
      return '未知配方';
    case 'already-owned':
      return '已拥有该成品';
    case 'missing-materials':
      return '材料不足';
    default:
      return '暂不可交易';
  }
}

export interface ItemEntryInput {
  readonly offer: ShopOffer;
  readonly price: number;
  readonly gold: number;
  readonly check: ShopPurchaseCheck | ShopTradeFailure;
}

/** 永久道具卡：收益、代价、层数与购买后金币同屏。 */
export function describeItemEntry(input: ItemEntryInput): ShopUiEntry {
  const { offer, price, gold, check } = input;
  const sold = offer.sold;
  const disabled = sold || !check.ok;
  const shortfall = check.ok ? 0 : check.shortfall;
  const disabledReason = sold
    ? shopFailureLabel('already-sold')
    : check.ok
      ? null
      : shopFailureLabel(check.reason, check.shortfall);

  const benefits = benefitLines(offer.description);
  const costs = costLines(offer.cost);
  const meta: string[] = [];
  if (offer.rarity) meta.push(`品质 ${offer.rarity}`);
  if (offer.stackCap !== undefined) {
    const stacks = offer.stacks ?? 0;
    const next = offer.nextStacks ?? Math.min(offer.stackCap, stacks + 1);
    meta.push(`层数 ${stacks}/${offer.stackCap} → ${next}/${offer.stackCap}`);
  }
  if (offer.prerequisite) meta.push(`前置：${offer.prerequisite}`);

  const detail: ShopUiDetailLine[] = [
    { text: formatGoldChange(gold, price), tone: 'neutral' },
  ];
  for (const line of benefits) {
    detail.push({ text: `购买后：${line}`, tone: 'benefit' });
  }
  for (const line of costs) {
    if (!isNegativeShopLine(line)) {
      detail.push({ text: line, tone: 'neutral' });
      continue;
    }
    detail.push({ text: `代价：${line}`, tone: 'cost' });
  }
  for (const line of meta) detail.push({ text: line, tone: 'neutral' });
  if (disabledReason) detail.push({ text: disabledReason, tone: 'warn' });

  return {
    key: `offer:${offer.slot}`,
    kind: 'item',
    id: offer.id,
    slot: offer.slot,
    name: offer.name,
    tag: offer.tag ?? '',
    rarity: offer.rarity ?? null,
    benefit: benefits,
    cost: costs,
    meta,
    price,
    priceLabel: formatShopPrice(price),
    stateLabel: sold ? '已售出' : offer.locked ? '已锁定' : null,
    disabled,
    disabledReason,
    shortfall,
    highlight: false,
    repeatable: false,
    detail,
  };
}

export interface SkillEntryInput {
  readonly offer: ShopOffer;
  readonly quote: FreeSkillQuoteResult;
  readonly gold: number;
}

const SKILL_ACTION_LABELS = {
  equip: '装备',
  upgrade: '升级',
  replace: '替换',
} as const;

/** 自由技能卡：显示装备/升级/替换、目标槽与回收后的净金币。 */
export function describeSkillEntry(input: SkillEntryInput): ShopUiEntry {
  const { offer, quote, gold } = input;
  const sold = offer.sold;
  const price = quote.ok ? quote.price : offer.price;
  const shortfall = quote.shortfall ?? 0;
  const disabled = sold || !quote.ok || !quote.affordable;
  const disabledReason = sold
    ? shopFailureLabel('already-sold')
    : !quote.ok
      ? shopFailureLabel(quote.reason, quote.shortfall)
      : !quote.affordable
        ? shopFailureLabel('insufficient-gold', quote.shortfall)
        : null;

  const meta: string[] = [];
  if (quote.ok) {
    meta.push(`${SKILL_ACTION_LABELS[quote.action]} → ${quote.targetSlot} 槽`);
    meta.push(`等级 Lv${quote.level} · 冷却 ${quote.cooldownSeconds}s`);
    if (quote.refund > 0) meta.push(`替换回收 ${quote.refund} 金币`);
    if (quote.subsidized) meta.push('第一商店首购补贴');
    if (quote.replaced) {
      meta.push(`替换 ${quote.replaced.name} Lv${quote.replaced.level}`);
    }
  } else {
    meta.push(`冷却 ${offer.cooldownSeconds ?? 0}s`);
  }

  const detail: ShopUiDetailLine[] = [];
  if (quote.ok) {
    const next = gold - quote.price + quote.refund;
    detail.push({
      text: `金币 ${gold} → ${Math.max(0, next)}（${quote.netGold >= 0 ? '+' : ''}${quote.netGold}）`,
      tone: 'neutral',
    });
    detail.push({
      text: `${SKILL_ACTION_LABELS[quote.action]} ${quote.skillName} → ${quote.targetSlot} 槽 Lv${quote.level}`,
      tone: 'benefit',
    });
    detail.push({
      text: `冷却 ${quote.cooldownSeconds}s`,
      tone: 'neutral',
    });
    if (quote.refund > 0) {
      detail.push({ text: `回收 ${quote.refund} 金币`, tone: 'benefit' });
    }
  } else {
    detail.push({ text: formatGoldChange(gold, price), tone: 'neutral' });
  }
  if (disabledReason) detail.push({ text: disabledReason, tone: 'warn' });

  return {
    key: `offer:${offer.slot}`,
    kind: 'skill',
    id: offer.id,
    slot: offer.slot,
    name: offer.name,
    tag: offer.tag ?? '',
    rarity: null,
    benefit: benefitLines(offer.description),
    cost: [SHOP_NO_COST],
    meta,
    price,
    priceLabel: formatShopPrice(price),
    stateLabel: sold ? '已售出' : quote.ok && quote.subsidized ? '首购补贴' : null,
    disabled,
    disabledReason,
    shortfall,
    highlight: quote.ok && quote.action === 'upgrade',
    repeatable: false,
    detail,
  };
}

export interface PotionEntryInput {
  readonly offer: ShopOffer;
  readonly price: number;
  readonly gold: number;
  readonly check: ShopPurchaseCheck | ShopTradeFailure;
  /** 本波已排队/生效层数（P03–P08）。 */
  readonly queued: number;
  /** 单波上限；0 表示无上限。 */
  readonly perWaveLimit: number;
  /** 本商店已购买次数，用于「再买一个」文案。 */
  readonly purchases: number;
  readonly limitReached: boolean;
}

/** 轮换药剂卡：显示效果、单波上限与已排队层数。 */
export function describePotionEntry(input: PotionEntryInput): ShopUiEntry {
  const { offer, price, gold, check, queued, perWaveLimit, purchases } = input;
  const sold = offer.sold;
  const disabled = sold || !check.ok || input.limitReached;
  const disabledReason = sold
    ? shopFailureLabel('already-sold')
    : input.limitReached
      ? `本波最多 ${perWaveLimit} 次 · 已达上限`
      : check.ok
        ? null
        : shopFailureLabel(check.reason, check.shortfall);
  const shortfall = check.ok ? 0 : check.shortfall;

  const meta: string[] = [];
  if (offer.limit) meta.push(`限制：${offer.limit}`);
  if (perWaveLimit > 0) meta.push(`本波 ${queued}/${perWaveLimit}`);
  if (purchases > 0) meta.push(`本商店已买 ${purchases} 次`);

  const detail: ShopUiDetailLine[] = [
    { text: formatGoldChange(gold, price), tone: 'neutral' },
    { text: `效果：${offer.description}`, tone: 'benefit' },
  ];
  for (const line of meta) detail.push({ text: line, tone: 'neutral' });
  if (disabledReason) detail.push({ text: disabledReason, tone: 'warn' });

  return {
    key: `offer:${offer.slot}`,
    kind: 'potion',
    id: offer.id,
    slot: offer.slot,
    name: offer.name,
    tag: '药剂',
    rarity: null,
    benefit: benefitLines(offer.description),
    cost: [SHOP_NO_COST],
    meta,
    price,
    priceLabel: formatShopPrice(price),
    stateLabel: sold
      ? '已售出'
      : input.limitReached
        ? '本波上限'
        : purchases > 0
          ? '可再买一个'
          : null,
    disabled,
    disabledReason,
    shortfall,
    highlight: false,
    repeatable: true,
    detail,
  };
}

export interface EmergencyPotionEntryInput {
  readonly potion: ShopEmergencyPotion;
  readonly effect: string;
  readonly gold: number;
  readonly purchases: number;
}

/** 常驻 P01：不占货架格，可重复购买，确认文案明确写「再买一个」。 */
export function describeEmergencyPotionEntry(
  input: EmergencyPotionEntryInput,
): ShopUiEntry {
  const { potion, effect, gold, purchases } = input;
  const shortfall = Math.max(0, potion.price - gold);
  const disabled = shortfall > 0;
  const meta = [
    '常驻 · 不占货架格',
    purchases > 0 ? `本商店已买 ${purchases} 次` : '可重复购买',
    '每次购买立即治疗',
  ];
  const detail: ShopUiDetailLine[] = [
    { text: formatGoldChange(gold, potion.price), tone: 'neutral' },
    { text: `效果：${effect}`, tone: 'benefit' },
  ];
  for (const line of meta) detail.push({ text: line, tone: 'neutral' });
  if (disabled) {
    detail.push({
      text: shopFailureLabel('insufficient-gold', shortfall),
      tone: 'warn',
    });
  }

  return {
    key: `potion:${potion.id}`,
    kind: 'potion',
    id: potion.id,
    slot: null,
    name: potion.name,
    tag: '常驻',
    rarity: null,
    benefit: benefitLines(effect),
    cost: [SHOP_NO_COST],
    meta,
    price: potion.price,
    priceLabel: formatShopPrice(potion.price),
    stateLabel:
      purchases > 0 ? `已买 ${purchases} 次 · 可再买一个` : '常驻',
    disabled,
    disabledReason: disabled
      ? shopFailureLabel('insufficient-gold', shortfall)
      : null,
    shortfall,
    highlight: false,
    repeatable: true,
    detail,
  };
}

export interface SupplyEntryInput {
  readonly supply: ShopMaterialSupply;
  readonly price: number;
  readonly gold: number;
  readonly full: boolean;
}

/** 配方缺件供给：独立于五格与 P01，正常价格买到一件缺失材料。 */
export function describeSupplyEntry(input: SupplyEntryInput): ShopUiEntry {
  const { supply, price, gold, full } = input;
  const sold = supply.sold;
  const shortfall = Math.max(0, price - gold);
  const disabled = sold || full || shortfall > 0;
  const disabledReason = sold
    ? shopFailureLabel('already-sold')
    : full
      ? shopFailureLabel('item-full')
      : shortfall > 0
        ? shopFailureLabel('insufficient-gold', shortfall)
        : null;
  const next = Math.min(supply.stackCap, supply.stacks + 1);
  const meta = [
    `配方 ${supply.recipeId} 缺件 · 独立于五格`,
    `层数 ${supply.stacks}/${supply.stackCap} → ${next}/${supply.stackCap}`,
    '正常价格 · 不参与锁定/重抽',
  ];
  const detail: ShopUiDetailLine[] = [
    { text: formatGoldChange(gold, price), tone: 'neutral' },
  ];
  for (const line of benefitLines(supply.description)) {
    detail.push({ text: `购买后：${line}`, tone: 'benefit' });
  }
  for (const line of meta) detail.push({ text: line, tone: 'neutral' });
  if (disabledReason) detail.push({ text: disabledReason, tone: 'warn' });

  return {
    key: 'supply',
    kind: 'supply',
    id: supply.id,
    slot: null,
    name: supply.name,
    tag: '缺件',
    rarity: supply.rarity,
    benefit: benefitLines(supply.description),
    cost: costLines(supply.cost),
    meta,
    price,
    priceLabel: formatShopPrice(price),
    stateLabel: sold ? '已购买' : '缺件供给',
    disabled,
    disabledReason,
    shortfall,
    highlight: true,
    repeatable: false,
    detail,
  };
}

export interface SellEntryInput {
  readonly itemId: string;
  readonly name: string;
  readonly stacks: number;
  readonly stackCap: number;
  /** 当前层数的效果摘要；出售后这些效果会一起消失。 */
  readonly effect: string | null;
  readonly check: ShopSellCheck | ShopTradeFailure;
  readonly gold: number;
}

/** 装备页出售行：显示层数、回收金额与出售后失去的效果。 */
export function describeSellEntry(input: SellEntryInput): ShopUiEntry {
  const { itemId, name, stacks, stackCap, effect, check, gold } = input;
  const disabled = !check.ok;
  const refund = check.ok ? check.refund : 0;
  const layers = check.ok ? check.layers : 0;
  const paid = check.ok ? check.paid : 0;
  const remaining = Math.max(0, stacks - layers);
  const meta = [
    `层数 ${stacks}/${stackCap}`,
    `本次出售全部 ${layers} 层`,
    `出售后剩余 ${remaining} 层`,
  ];
  const disabledReason = check.ok
    ? null
    : shopFailureLabel(check.reason, check.shortfall);
  const detail: ShopUiDetailLine[] = [
    { text: formatGoldGain(gold, refund), tone: 'neutral' },
    { text: `实际支付 ${paid} 金币 · 回收 40%`, tone: 'neutral' },
  ];
  if (effect) detail.push({ text: `出售后失去：${effect}`, tone: 'cost' });
  if (disabledReason) detail.push({ text: disabledReason, tone: 'warn' });

  return {
    key: `sell:${itemId}`,
    kind: 'sell',
    id: itemId,
    slot: null,
    name,
    tag: '出售',
    rarity: null,
    benefit: check.ok
      ? [`回收 ${refund} 金币`, `实付 ${paid} 的 40%`]
      : [SHOP_NO_BENEFIT],
    cost: effect ? [`出售后失去：${effect}`] : [SHOP_NO_COST],
    meta,
    price: refund,
    priceLabel: `+${refund} 金币`,
    stateLabel: check.ok ? '可出售' : '不可出售',
    disabled,
    disabledReason,
    shortfall: check.ok ? 0 : check.shortfall,
    highlight: false,
    repeatable: false,
    detail,
  };
}

export interface RecipeIngredientView {
  readonly id: string;
  readonly name: string;
  readonly stacks: number;
  readonly missing: boolean;
}

export interface RecipeEntryInput {
  readonly recipeId: string;
  readonly name: string;
  readonly tracked: boolean;
  readonly ownedIngredients: number;
  readonly requiredIngredients: number;
  readonly ingredients: readonly RecipeIngredientView[];
  readonly craftable: boolean;
  readonly fee: number;
  readonly gold: number;
  readonly shortfall: number;
  readonly missing: readonly string[];
  /** 合成净变化（已按当前装配技能上下文计算）；可缺省。 */
  readonly netChanges?: readonly {
    readonly text: string;
    readonly positive: boolean;
  }[];
}

/** 配方页条目：缺件名称与进度直接显示，可合成时整行高亮。 */
export function describeRecipeEntry(input: RecipeEntryInput): ShopUiEntry {
  const {
    recipeId,
    name,
    tracked,
    ownedIngredients,
    requiredIngredients,
    ingredients,
    craftable,
    fee,
    gold,
    shortfall,
    missing,
    netChanges = [],
  } = input;
  const disabled = tracked && !craftable;
  const disabledReason = !tracked
    ? null
    : craftable
      ? null
      : missing.length > 0
        ? `材料不足 · 缺 ${missing.join('/')}`
        : shopFailureLabel('insufficient-gold', shortfall);
  const ingredientLines = ingredients.map(
    (entry) => `${entry.name} ${entry.stacks}/1${entry.missing ? '（缺）' : ''}`,
  );
  const meta = [
    tracked ? '追踪中' : '未追踪 · Enter 追踪',
    `材料 ${ownedIngredients}/${requiredIngredients}`,
    `手续费 ${fee} 金币`,
  ];
  if (craftable) meta.push('材料已齐 · 可合成');
  else if (missing.length > 0) meta.push(`缺 ${missing.join('/')}`);

  const detail: ShopUiDetailLine[] = [
    { text: formatGoldChange(gold, fee), tone: 'neutral' },
    { text: `配方 ${recipeId} · 材料 ${ownedIngredients}/${requiredIngredients}`, tone: 'neutral' },
  ];
  for (const entry of ingredients) {
    detail.push({
      text: `${entry.name}：${entry.stacks}/1${entry.missing ? '（缺）' : ''}`,
      tone: entry.missing ? 'warn' : 'benefit',
    });
  }
  for (const change of netChanges) {
    detail.push({
      text: `合成后：${change.text}`,
      tone: change.positive ? 'benefit' : 'cost',
    });
  }
  if (craftable) {
    detail.push({ text: '材料与金币已齐 · 再次按 Enter 合成', tone: 'good' });
  } else if (disabledReason) {
    detail.push({ text: disabledReason, tone: 'warn' });
  }

  return {
    key: `recipe:${recipeId}`,
    kind: 'recipe',
    id: recipeId,
    slot: null,
    name,
    tag: tracked ? '追踪配方' : '配方',
    rarity: null,
    benefit:
      ingredientLines.length > 0 ? ingredientLines : [SHOP_NO_BENEFIT],
    cost: [SHOP_NO_COST],
    meta,
    price: fee,
    priceLabel: `手续费 ${fee} 金币`,
    stateLabel: !tracked
      ? '未追踪'
      : craftable
        ? '可合成'
        : `缺 ${missing.length} 件`,
    disabled,
    disabledReason,
    shortfall,
    highlight: tracked && craftable,
    repeatable: false,
    detail,
  };
}

export interface ShopUiConfirm {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
}

export type ShopUiConfirmStep = 'first' | 'second';

/**
 * 商店键盘状态：页面、焦点、二次确认与短提示。
 * 场景在每次变更后重新生成视图并广播给 DOM 面板。
 */
export class ShopUiCursor {
  private pageValue: ShopUiPage = 'shelf';
  private focusValue = 0;
  private confirmValue: ShopUiConfirm | null = null;
  private messageValue: ShopUiMessage | null = null;

  get page(): ShopUiPage {
    return this.pageValue;
  }

  get focus(): number {
    return this.focusValue;
  }

  get confirm(): ShopUiConfirm | null {
    return this.confirmValue;
  }

  get message(): ShopUiMessage | null {
    return this.messageValue;
  }

  reset(): void {
    this.pageValue = 'shelf';
    this.focusValue = 0;
    this.confirmValue = null;
    this.messageValue = null;
  }

  setPage(page: ShopUiPage, focusCount = 0): void {
    if (!SHOP_UI_PAGES.includes(page)) return;
    this.pageValue = page;
    this.focusValue = 0;
    this.confirmValue = null;
    this.clamp(focusCount);
  }

  cyclePage(delta: number, focusCount = 0): ShopUiPage {
    const index = SHOP_UI_PAGES.indexOf(this.pageValue);
    const step = delta < 0 ? -1 : 1;
    const next =
      (index + step + SHOP_UI_PAGES.length) % SHOP_UI_PAGES.length;
    this.pageValue = SHOP_UI_PAGES[next] ?? 'shelf';
    this.focusValue = 0;
    this.confirmValue = null;
    this.clamp(focusCount);
    return this.pageValue;
  }

  move(delta: number, focusCount: number): number {
    this.confirmValue = null;
    if (focusCount <= 0) {
      this.focusValue = 0;
      return this.focusValue;
    }
    const step = delta < 0 ? -1 : 1;
    this.focusValue =
      (this.focusValue + step + focusCount) % focusCount;
    return this.focusValue;
  }

  focusTo(index: number, focusCount: number): number {
    this.confirmValue = null;
    if (focusCount <= 0) {
      this.focusValue = 0;
      return this.focusValue;
    }
    this.focusValue = Math.min(Math.max(0, Math.floor(index)), focusCount - 1);
    return this.focusValue;
  }

  clamp(focusCount: number): void {
    if (focusCount <= 0) {
      this.focusValue = 0;
      return;
    }
    this.focusValue = Math.min(Math.max(0, this.focusValue), focusCount - 1);
  }

  setMessage(text: string, tone: ShopUiTone = 'neutral'): void {
    this.messageValue = { text, tone };
  }

  setMessageValue(message: ShopUiMessage | null): void {
    this.messageValue = message;
  }

  clearMessage(): void {
    this.messageValue = null;
  }

  clearConfirm(): void {
    this.confirmValue = null;
  }

  /**
   * 第一次调用进入确认，第二次对同一 key 返回 `second`。
   * 焦点移动/切页会清空确认，避免确认了另一张卡。
   */
  requestConfirm(key: string, label: string, hint: string): ShopUiConfirmStep {
    if (this.confirmValue?.key === key) return 'second';
    this.confirmValue = { key, label, hint };
    return 'first';
  }
}

/** 当前焦点的 key 在条目列表中的下标；找不到返回 0。 */
export function indexOfShopKey(
  entries: readonly ShopUiEntry[],
  key: string,
): number {
  const index = entries.findIndex((entry) => entry.key === key);
  return index >= 0 ? index : 0;
}

/** 二次确认的标题；药剂已买过时明确写「再买一个」。 */
export function shopConfirmLabel(entry: ShopUiEntry): string {
  switch (entry.kind) {
    case 'sell':
      return `出售 ${entry.name}？`;
    case 'recipe':
      return `合成 ${entry.name}？`;
    case 'potion': {
      const bought =
        entry.stateLabel === '可再买一个' ||
        entry.meta.some((line) => line.startsWith('本商店已买'));
      return `${bought ? '再买一个' : '购买'} ${entry.name}？`;
    }
    default:
      return `购买 ${entry.name}？`;
  }
}

/** 二次确认的提示：长按不重复购买、Esc 可取消。 */
export function shopConfirmHint(entry: ShopUiEntry): string {
  if (entry.kind === 'sell') {
    return '再次按 Enter 出售全部层数 · Esc 取消';
  }
  if (entry.kind === 'recipe') {
    return '再次按 Enter 合成并扣除手续费 · Esc 取消';
  }
  return '再次按 Enter 确认 · 长按不会重复购买 · Esc 取消';
}

export interface ShopUiViewInput {
  readonly wave: number;
  readonly gold: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly shield: number;
  readonly nextWave: number | null;
  readonly nextWaveKind: string | null;
  readonly settlementLabel: string;
  readonly page: ShopUiPage;
  readonly focus: number;
  readonly entries: readonly ShopUiEntry[];
  readonly tracking: ShopUiTracking;
  readonly skills: readonly ShopUiSkillSlot[];
  readonly attributes: readonly ShopUiAttribute[];
  readonly groups: readonly ShopUiGroup[];
  readonly message: ShopUiMessage | null;
  readonly confirm: ShopUiMessage | null;
  readonly rerollCost: number;
  readonly freeReroll: boolean;
  readonly rerollCount: number;
  readonly rerollAffordable: boolean;
  readonly rerollShortfall: number;
  readonly lockedSlot: number | null;
}

const PAGE_FOCUS_HINTS: Readonly<Record<ShopUiPage, string>> = {
  shelf:
    '← → / ↑ ↓ 选卡 · Enter 购买/确认 · R 重抽 · F 锁定 · Tab 切页 · 空格下一波',
  equipment:
    '↑ ↓ 选择装备 · Enter 出售/确认 · Tab 切页 · 空格下一波',
  recipe:
    '↑ ↓ 选择配方 · Enter 追踪/合成 · Tab 切页 · 空格下一波',
};

const PAGE_DETAIL_HINTS: Readonly<Record<ShopUiPage, string>> = {
  shelf: '卡片同屏显示收益与代价；选中卡下方显示购买后的属性与金币。',
  equipment: '出售按实付金币的 40% 回收；出售后属性立即重算。',
  recipe: '缺件名称与进度直接显示；材料与金币齐备时高亮可合成。',
};

/** 汇总成 DOM 面板可直接渲染的一帧。 */
export function buildShopUiView(input: ShopUiViewInput): ShopUiView {
  const focused = input.entries[input.focus] ?? null;
  const tabs: ShopUiTab[] = SHOP_UI_PAGES.map((id) => ({
    id,
    label: SHOP_PAGE_LABELS[id],
    active: id === input.page,
  }));
  const nextWaveLabel =
    input.nextWave === null
      ? '本波后结束'
      : `第 ${input.nextWave} 波 · ${input.nextWaveKind ?? '普通'}`;
  const rerollShortfall = input.freeReroll ? 0 : input.rerollShortfall;
  const rerollLabel = input.freeReroll
    ? `重抽 R · 免费（已重抽 ${input.rerollCount} 次）`
    : input.rerollAffordable
      ? `重抽 R · ${input.rerollCost} 金币（已重抽 ${input.rerollCount} 次）`
      : `重抽 R · ${input.rerollCost} 金币 · 差 ${rerollShortfall}`;
  const lockLabel =
    input.lockedSlot === null
      ? 'F 锁定选中'
      : `F 解除锁定 [${input.lockedSlot + 1}]`;

  return {
    wave: input.wave,
    title: `第 ${input.wave} 波后 · 商店`,
    gold: input.gold,
    // 顶部信息带与战斗 HUD 同口径取整：受伤带护甲/倍率后生命与护盾是小数，
    // 原值直出会出现 123.10714285714286 这类长浮点串。
    health: hudValue(input.health),
    maxHealth: hudValue(input.maxHealth),
    shield: hudValue(input.shield),
    nextWaveLabel,
    settlementLabel: input.settlementLabel,
    page: input.page,
    tabs,
    entries: input.entries,
    focus: input.entries.length > 0 ? Math.min(input.focus, input.entries.length - 1) : 0,
    detailTitle: focused
      ? `${focused.name}${focused.tag ? ` · ${focused.tag}` : ''}`
      : '未选择',
    detail: focused ? focused.detail : [],
    tracking: input.tracking,
    skills: input.skills,
    attributes: input.attributes,
    groups: input.groups,
    message: input.message,
    confirm: input.confirm,
    footerHint: PAGE_DETAIL_HINTS[input.page],
    focusHint: PAGE_FOCUS_HINTS[input.page],
    nextWaveLabelForButton: input.nextWave === null ? '结束本局' : '准备下一波',
    rerollLabel,
    lockLabel,
  };
}
