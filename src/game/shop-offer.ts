/**
 * 商店货架与商品生成（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §商店：
 * - 主货架 5 格：3 件永久道具、1 个自由技能、1 种轮换药剂；
 *   P01 应急药剂始终是货架外的独立按钮，不参与货架抽取；
 * - 永久道具品质权重：第 1–5 商店 80/20/0，第 6–11 55/35/10，
 *   第 12–17 35/45/20；品类内等概率；
 * - I22 从普通池转移 12 个百分点，按当前稀有/史诗比例分配，
 *   不提前开放 0 权重史诗；
 * - 候选空池重归一化：某品质已无可用道具时，从剩余品质的权重里重新归一；
 * - 同一手不重复、已满层排除；
 * - 价格 `round(基础价 × (1 + 0.025 × (本商店波数 − 1)))`；
 *   重抽费用 `6 + floor(波数 / 3) + 2 × 本商店已重抽次数`，进入下一商店清零；
 * - 售出格保留「已售出」，不自动补货；只有重抽才换货；
 * - 候选与重抽的随机数由调用方注入（本局 `RunRandomStreams.reward`），
 *   本模块不新建随机源，固定种子下抽战斗流不改变货架。
 */
import {
  ITEM_RARITIES,
  getConsumable,
  getFreeSkill,
  getRecipe,
  getShopItem,
  listConsumables,
  listFreeSkills,
  listShopItems,
  type CharacterId,
  type ConsumableDefinition,
  type FreeSkillDefinition,
  type ItemRarity,
  type ShopItemDefinition,
} from './data';
import { isItemUsableByCharacter, itemPrerequisite } from './item-requirements';
import type { ItemCardPreview } from './item-effects';

/** 主货架格数：3 永久道具 + 1 自由技能 + 1 轮换药剂。 */
export const SHOP_MAIN_SLOT_COUNT = 5;
export const SHOP_ITEM_SLOT_COUNT = 3;
export const SHOP_SKILL_SLOT = 3;
export const SHOP_POTION_SLOT = 4;

/** 最后一个带商店的波次；第 18 波击败 Boss 后直接结算。 */
export const SHOP_LAST_WAVE = 17;

/** 常驻独立按钮的应急药剂。 */
export const SHOP_EMERGENCY_POTION_ID = 'P01';

/** I22 每层从普通池转移的百分点。 */
export const I22_WEIGHT_TRANSFER = 12;

/** 浓缩药剂 P02 的最早出现商店波次。 */
export const P02_FIRST_SHOP_WAVE = 7;

/** 第一商店保底自由技能的价格档：基础 70 金币。 */
export const FIRST_SHOP_SKILL_BASE_PRICE = 70;

/** 合并折扣与加价后的净折扣上限（百分比）。 */
export const MAX_NET_DISCOUNT_PERCENT = 35;

/** 任何商品最终价格至少 1 金币。 */
export const MIN_SHOP_PRICE = 1;

/** 价格折扣/加价来源；在基础波次价格上合并，不各自乘算。 */
export interface ShopPriceModifiers {
  /** 正数表示降价百分比。 */
  readonly discountPercent?: number;
  /** 正数表示加价百分比。 */
  readonly surchargePercent?: number;
}

export type ShopPriceSource =
  | 'base'
  | 'modifiers'
  | 'locked'
  | 'first-purchase'
  | 'upgrade';

export interface ShopPriceRequest {
  readonly basePrice: number;
  readonly shopWave: number;
  readonly modifiers?: ShopPriceModifiers;
  /** 锁定价优先于其他任何规则。 */
  readonly lockedPrice?: number | null;
  /** 第一商店新手首购补贴；不与其他折扣/加价叠加。 */
  readonly firstPurchaseSubsidy?: number | null;
  /** 同名技能等级 2/3；按当前波价格 60%/90% 向上取整，不叠加其他优惠。 */
  readonly skillLevel?: 1 | 2 | 3;
}

export interface ShopPriceBreakdown {
  readonly price: number;
  readonly source: ShopPriceSource;
  readonly baseWavePrice: number;
}

/** 某商店波次的品质权重。 */
export type ShopRarityWeights = Readonly<Record<ItemRarity, number>>;

/** 商品品类：永久道具 / 自由技能 / 轮换药剂。 */
export type ShopOfferKind = 'item' | 'skill' | 'potion';

function assertShopWave(shopWave: number): void {
  if (!Number.isInteger(shopWave) || shopWave < 1 || shopWave > SHOP_LAST_WAVE) {
    throw new Error(`商店波数必须是 1–${SHOP_LAST_WAVE} 的整数，收到 ${shopWave}`);
  }
}

function safeRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 0.9999999999999999);
}

/**
 * 某商店波次的永久道具品质权重。
 * 第 1–5 商店 80/20/0，第 6–11 55/35/10，第 12–17 35/45/20。
 */
export function shopRarityWeights(shopWave: number): ShopRarityWeights {
  assertShopWave(shopWave);
  if (shopWave <= 5) return { 普通: 80, 稀有: 20, 史诗: 0 };
  if (shopWave <= 11) return { 普通: 55, 稀有: 35, 史诗: 10 };
  return { 普通: 35, 稀有: 45, 史诗: 20 };
}

/**
 * I22 的权重转移：每层从普通池转移 12 个百分点，按当前稀有/史诗比例分配。
 * 史诗权重为 0 时不提前开放，全部分给稀有；转移量不超过普通池剩余权重。
 */
export function applyI22WeightShift(
  weights: ShopRarityWeights,
  i22Stacks: number,
): ShopRarityWeights {
  const stacks = Number.isFinite(i22Stacks)
    ? Math.max(0, Math.floor(i22Stacks))
    : 0;
  if (stacks <= 0) return { ...weights };

  const transfer = Math.min(weights.普通, I22_WEIGHT_TRANSFER * stacks);
  if (transfer <= 0) return { ...weights };

  const rare = Math.max(0, weights.稀有);
  const epic = Math.max(0, weights.史诗);
  const total = rare + epic;
  // 两个高权重池都为 0 属于非法档位；保守地把转移量全给稀有，不开史诗。
  if (total <= 0) {
    return { 普通: weights.普通 - transfer, 稀有: rare + transfer, 史诗: epic };
  }

  return {
    普通: weights.普通 - transfer,
    稀有: rare + (transfer * rare) / total,
    史诗: epic + (transfer * epic) / total,
  };
}

/** 某商店波次应用 I22 层数后的品质权重；I22 未拥有时为原权重。 */
export function shopRarityWeightsWithI22(
  shopWave: number,
  i22Stacks: number,
): ShopRarityWeights {
  return applyI22WeightShift(shopRarityWeights(shopWave), i22Stacks);
}

/**
 * 商品价格：`round(基础价 × (1 + 0.025 × (本商店波数 − 1)))`。
 *
 * 0.025 = 1/40，用整数分子 `(40 + 波数 − 1) / 40` 计算，避免
 * `1 + 0.025 × 6` 得到 1.1499999999999999 之类误差把 .5 边界向下抹掉
 * （基础价 50 / 第 7 商店应为 58，浮点版本会算成 57）。
 */
export function shopPrice(basePrice: number, shopWave: number): number {
  assertShopWave(shopWave);
  if (!Number.isFinite(basePrice) || basePrice < 0) {
    throw new Error(`商品基础价必须是非负数，收到 ${basePrice}`);
  }
  return Math.round((basePrice * (40 + shopWave - 1)) / 40);
}

function positivePercent(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/**
 * 各种折扣与价格加成先在基础波次价格上合并，再取整：
 * 净折扣上限 35%，最终价格至少 1。加价与折扣按百分点相加，
 * 不分别乘算，避免同一商品被重复放大/打折。
 */
export function applyShopPriceModifiers(
  baseWavePrice: number,
  modifiers?: ShopPriceModifiers,
): number {
  if (!Number.isFinite(baseWavePrice) || baseWavePrice < 0) {
    throw new Error(`商品基础价必须是非负数，收到 ${baseWavePrice}`);
  }
  const discount = positivePercent(modifiers?.discountPercent);
  const surcharge = positivePercent(modifiers?.surchargePercent);
  const net = Math.max(-MAX_NET_DISCOUNT_PERCENT, surcharge - discount);
  const price = Math.round((baseWavePrice * (100 + net)) / 100);
  return Math.max(MIN_SHOP_PRICE, price);
}

/**
 * 商品最终价格与来源。优先级固定为
 * 锁定价 → 首购补贴 → 同名技能升级 → 折扣/加价 → 基础波次价，
 * 同一件商品只套用一条特殊规则，禁止重复叠加优惠。
 */
export function resolveShopPrice(request: ShopPriceRequest): ShopPriceBreakdown {
  assertShopWave(request.shopWave);
  if (!Number.isFinite(request.basePrice) || request.basePrice < 0) {
    throw new Error(`商品基础价必须是非负数，收到 ${request.basePrice}`);
  }
  const baseWavePrice = shopPrice(request.basePrice, request.shopWave);

  const lockedPrice = request.lockedPrice;
  if (typeof lockedPrice === 'number' && Number.isFinite(lockedPrice)) {
    return {
      price: Math.max(MIN_SHOP_PRICE, Math.floor(lockedPrice)),
      source: 'locked',
      baseWavePrice,
    };
  }

  const subsidy = request.firstPurchaseSubsidy;
  if (typeof subsidy === 'number' && Number.isFinite(subsidy) && subsidy > 0) {
    return {
      price: Math.max(MIN_SHOP_PRICE, baseWavePrice - Math.floor(subsidy)),
      source: 'first-purchase',
      baseWavePrice,
    };
  }

  const skillLevel = request.skillLevel ?? 1;
  if (skillLevel === 2 || skillLevel === 3) {
    // 当前波价格的 60% / 90%，向上取整；用整数分子避免浮点误差。
    const numerator = skillLevel === 2 ? 60 : 90;
    return {
      price: Math.max(
        MIN_SHOP_PRICE,
        Math.ceil((baseWavePrice * numerator) / 100),
      ),
      source: 'upgrade',
      baseWavePrice,
    };
  }

  const hasModifier =
    positivePercent(request.modifiers?.discountPercent) > 0 ||
    positivePercent(request.modifiers?.surchargePercent) > 0;
  if (hasModifier) {
    return {
      price: applyShopPriceModifiers(baseWavePrice, request.modifiers),
      source: 'modifiers',
      baseWavePrice,
    };
  }

  return { price: baseWavePrice, source: 'base', baseWavePrice };
}

/** 重抽费用：`6 + floor(波数 / 3) + 2 × 本商店已重抽次数`。 */export function shopRerollCost(
  shopWave: number,
  rerollsThisShop = 0,
): number {
  assertShopWave(shopWave);
  if (!Number.isInteger(rerollsThisShop) || rerollsThisShop < 0) {
    throw new Error(`已重抽次数必须是非负整数，收到 ${rerollsThisShop}`);
  }
  return 6 + Math.floor(shopWave / 3) + 2 * rerollsThisShop;
}

/** 一个货架商品的可展示数据；从目录派生，不写入存档。 */
export interface ShopOffer {
  /** 0–2 永久道具，3 自由技能，4 轮换药剂。 */
  readonly slot: number;
  readonly kind: ShopOfferKind;
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly sold: boolean;
  /** 该格从上一商店锁定并保留；价格保持锁定时价格。 */
  readonly locked: boolean;
  readonly rarity?: ItemRarity;
  readonly tag?: string;
  /** 道具收益 / 技能或药剂效果。 */
  readonly description: string;
  /** 永久道具的代价；技能与药剂为 null。 */
  readonly cost: string | null;
  /** 依赖特定能力时的卡面前置；通用商品为 null。 */
  readonly prerequisite: string | null;
  readonly cooldownSeconds?: number;
  readonly limit?: string;
  readonly stacks?: number;
  readonly stackCap?: number;
  readonly nextStacks?: number;
  /** 道具正负净变化；传入卡面预览时是聚合后的“当前 → 购买后”值。 */
  readonly netChange?: string;
  /** true 表示 description/cost 来自实时聚合，而不是目录原文。 */
  readonly previewed?: boolean;
}

/** P01 常驻按钮；不占货架格，也不随售出/重抽消失。 */
export interface ShopEmergencyPotion {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly repeatable: boolean;
  readonly limit: string;
}

/**
 * 配方缺件供给：追踪配方的保底购买机会。
 * 不占主货架 5 格与 P01 按钮，价格与货架同款道具一致（正常收费，不赠送）。
 */
export interface ShopMaterialSupply {
  /** 该缺件所属的追踪配方。 */
  readonly recipeId: string;
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly rarity: ItemRarity;
  readonly description: string;
  readonly cost: string | null;
  /** 当前层数与叠层上限；保底只对缺失（0 层）材料生效。 */
  readonly stacks: number;
  readonly stackCap: number;
  readonly sold: boolean;
}

export interface MaterialSupplyRequest {
  readonly recipeId: string;
  readonly ingredientId: string;
}

/**
 * 把追踪器的缺件决定换算成可购买条目：价格走当前商店的波次价格与折扣，
 * 与五格中的同款道具一致；已满层或目录缺失时不提供。
 */
export function buildShopMaterialSupply(
  state: ShopDrawState,
  request: MaterialSupplyRequest,
): ShopMaterialSupply | null {
  const item = getShopItem(request.ingredientId);
  if (!item) return null;
  const stacks = state.stacksOf(item.id);
  if (stacks >= item.stackCap) return null;
  const preview = state.itemPreview?.(item.id, stacks) ?? null;
  return {
    recipeId: request.recipeId,
    id: item.id,
    name: item.name,
    price: drawnPrice(state, item.basePrice),
    rarity: item.rarity,
    description: preview?.benefit ?? item.benefit,
    cost: preview?.cost ?? item.cost,
    stacks,
    stackCap: item.stackCap,
    sold: false,
  };
}

export type ShopShelfReason = 'full' | 'partial-items' | 'no-items';

export interface ShopShelfDraw {
  readonly shopWave: number;
  readonly weights: ShopRarityWeights;
  readonly offers: readonly ShopOffer[];
  readonly emergencyPotion: ShopEmergencyPotion;
  readonly rerollCount: number;
  readonly rerollCost: number;
  readonly reason: ShopShelfReason;
}

export interface ShopDrawState {
  readonly shopWave: number;
  readonly characterId: CharacterId;
  /** 当前道具层数查询口，通常传 `ItemInventory.stacksOf`。 */
  readonly stacksOf: (itemId: string) => number;
  /** 折扣/加价来源；缺省为基础波次价格。 */
  readonly priceModifiers?: ShopPriceModifiers;
  /**
   * 只作用于药剂的价格修正（如 H23 的药剂价格 +15%）。
   * 与 `priceModifiers` 按百分点合并一次，不重复乘算。
   */
  readonly potionPriceModifiers?: ShopPriceModifiers;
  /**
   * 开发场景指定的轮换药剂（P02–P08）；缺省按目录候选随机抽取。
   * 只影响本商店的药剂格，不改变其他商品与随机流。
   */
  readonly potionOverride?: string | null;
  /**
   * 开发场景指定的自由技能；缺省按目录候选随机抽取。
   * 只影响本商店的技能格，不改变其他商品与随机流。
   */
  readonly skillOverride?: string | null;
  /**
   * 道具卡面实时预览；由场景注入，用当前聚合属性计算购买 1 层的真实变化。
   * 缺省时回退为目录收益/代价文案（非 I01–I12 道具在各自故事落地前使用）。
   */
  readonly itemPreview?: (itemId: string, stacks: number) => ItemCardPreview | null;
}

/**
 * 跨商店保留的锁定条目。
 * 只记录身份与锁定价；名称、收益与 `nextStacks` 等属性预览在下一商店
 * 按当前层数重新计算，不冻结玩家属性预览。
 */
export interface ShopLockedOffer {
  readonly slot: number;
  readonly kind: ShopOfferKind;
  readonly id: string;
  readonly price: number;
}

/** 当前职业可用且未满层的永久道具，保持目录顺序。 */
export function listShopItemCandidates(
  state: ShopDrawState,
): ShopItemDefinition[] {
  return listShopItems().filter(
    (item) =>
      isItemUsableByCharacter(item.id, state.characterId) &&
      state.stacksOf(item.id) < item.stackCap,
  );
}

/**
 * 轮换药剂池：P01 常驻货架外，P02 第 7 波商店起才可出现，
 * P03–P08 全程可能出现。
 */
export function listShopPotionCandidates(
  shopWave: number,
): ConsumableDefinition[] {
  assertShopWave(shopWave);
  return listConsumables().filter(
    (consumable) =>
      consumable.id !== SHOP_EMERGENCY_POTION_ID &&
      (consumable.id !== 'P02' || shopWave >= P02_FIRST_SHOP_WAVE),
  );
}

/**
 * 自由技能候选池：第一商店只从基础 70 金币档抽取，保证新手买得起；
 * 其余商店按完整目录等概率抽取。
 */
export function listFreeSkillCandidates(
  shopWave: number,
): FreeSkillDefinition[] {
  assertShopWave(shopWave);
  const all = listFreeSkills();
  return shopWave === 1
    ? all.filter((skill) => skill.basePrice === FIRST_SHOP_SKILL_BASE_PRICE)
    : [...all];
}

/** 开发场景指定的技能；只在目录中存在时生效。 */
function forcedSkill(state: ShopDrawState): FreeSkillDefinition | null {
  const id = state.skillOverride;
  if (!id) return null;
  return getFreeSkill(id) ?? null;
}

function emergencyPotion(state: ShopDrawState): ShopEmergencyPotion {
  const p01 = getConsumable(SHOP_EMERGENCY_POTION_ID);
  if (!p01) {
    throw new Error(`内容目录缺少常驻药剂 ${SHOP_EMERGENCY_POTION_ID}`);
  }
  return {
    id: p01.id,
    name: p01.name,
    price: drawnPotionPrice(state, p01.basePrice),
    repeatable: true,
    limit: p01.limit,
  };
}

function pickRandom<T>(random: () => number, list: readonly T[]): T | null {
  if (list.length === 0) return null;
  const index = Math.floor(safeRandom(random) * list.length);
  return list[Math.min(index, list.length - 1)] ?? null;
}

/**
 * 按当前可用品质重归一化后抽取一个品质。
 * 若剩余品质的权重全为 0（例如早期档位只剩史诗候选），退化为等概率，
 * 保证空池时仍然能给出有效商品而不是静默缺格。
 */
function pickRarity(
  random: () => number,
  available: readonly ItemRarity[],
  weights: ShopRarityWeights,
): ItemRarity | null {
  if (available.length === 0) return null;
  const positive = available.filter((rarity) => weights[rarity] > 0);
  const pool = positive.length > 0 ? positive : available;
  const useWeights = positive.length > 0;
  const total = pool.reduce(
    (sum, rarity) => sum + (useWeights ? weights[rarity] : 1),
    0,
  );
  let roll = safeRandom(random) * total;
  for (const rarity of pool) {
    roll -= useWeights ? weights[rarity] : 1;
    if (roll < 0) return rarity;
  }
  return pool[pool.length - 1] ?? null;
}

function drawnPrice(state: ShopDrawState, basePrice: number): number {
  return resolveShopPrice({
    basePrice,
    shopWave: state.shopWave,
    modifiers: state.priceModifiers,
  }).price;
}

/**
 * 药剂价格：基础波次价格上合并通用折扣与药剂专属修正（如 H23）各一次。
 * 两者都按百分点相加，再统一取整，避免同一修正被重复放大。
 */
function drawnPotionPrice(state: ShopDrawState, basePrice: number): number {
  const discountPercent =
    positivePercent(state.priceModifiers?.discountPercent) +
    positivePercent(state.potionPriceModifiers?.discountPercent);
  const surchargePercent =
    positivePercent(state.priceModifiers?.surchargePercent) +
    positivePercent(state.potionPriceModifiers?.surchargePercent);
  const modifiers =
    discountPercent > 0 || surchargePercent > 0
      ? { discountPercent, surchargePercent }
      : undefined;
  return resolveShopPrice({
    basePrice,
    shopWave: state.shopWave,
    modifiers,
  }).price;
}

/** 开发场景指定的轮换药剂；P01 常驻货架外，P02 仍受最早第 7 波商店限制。 */
function forcedPotion(state: ShopDrawState): ConsumableDefinition | null {
  const id = state.potionOverride;
  if (!id) return null;
  const potion = getConsumable(id);
  if (!potion || potion.id === SHOP_EMERGENCY_POTION_ID) return null;
  if (potion.id === 'P02' && state.shopWave < P02_FIRST_SHOP_WAVE) return null;
  return potion;
}

function itemOffer(
  item: ShopItemDefinition,
  slot: number,
  stacks: number,
  price: number,
  locked: boolean,
  itemPreview?: (itemId: string, stacks: number) => ItemCardPreview | null,
): ShopOffer {
  const preview = itemPreview?.(item.id, stacks) ?? null;
  return {
    slot,
    kind: 'item',
    id: item.id,
    name: item.name,
    price,
    sold: false,
    locked,
    rarity: item.rarity,
    tag: item.tag,
    description: preview?.benefit ?? item.benefit,
    cost: preview?.cost ?? item.cost,
    netChange: preview?.detail ?? `${item.benefit}；${item.cost}`,
    previewed: preview?.previewed ?? false,
    prerequisite: itemPrerequisite(item.id),
    stacks,
    stackCap: item.stackCap,
    nextStacks: Math.min(item.stackCap, stacks + 1),
  };
}

function skillOffer(
  skill: FreeSkillDefinition,
  price: number,
  locked: boolean,
): ShopOffer {
  return {
    slot: SHOP_SKILL_SLOT,
    kind: 'skill',
    id: skill.id,
    name: skill.name,
    price,
    sold: false,
    locked,
    tag: skill.tag,
    description: skill.effect,
    cost: null,
    prerequisite: null,
    cooldownSeconds: skill.cooldownSeconds,
  };
}

function potionOffer(
  potion: ConsumableDefinition,
  price: number,
  locked: boolean,
): ShopOffer {
  return {
    slot: SHOP_POTION_SLOT,
    kind: 'potion',
    id: potion.id,
    name: potion.name,
    price,
    sold: false,
    locked,
    description: potion.effect,
    cost: null,
    prerequisite: null,
    limit: potion.limit,
  };
}

function kindForSlot(slot: number): ShopOfferKind | null {
  if (slot >= 0 && slot < SHOP_ITEM_SLOT_COUNT) return 'item';
  if (slot === SHOP_SKILL_SLOT) return 'skill';
  if (slot === SHOP_POTION_SLOT) return 'potion';
  return null;
}

/** 货架格位对应的品类；非法格位返回 null。供快照校验复用同一口径。 */
export function shopOfferKindForSlot(slot: number): ShopOfferKind | null {
  return kindForSlot(slot);
}

/**
 * 把跨商店锁定的条目还原成当前商店的商品：
 * 身份与锁定价保留，层数预览按当前账本重新计算；
 * 道具已满层、职业不可用或目录缺失时放弃锁定，回到普通抽取。
 */
function lockedOfferFor(
  lock: ShopLockedOffer | null,
  state: ShopDrawState,
): ShopOffer | null {
  if (!lock) return null;
  if (!Number.isInteger(lock.slot) || kindForSlot(lock.slot) !== lock.kind) {
    return null;
  }
  if (!Number.isFinite(lock.price) || lock.price < MIN_SHOP_PRICE) return null;
  const price = Math.max(MIN_SHOP_PRICE, Math.floor(lock.price));

  if (lock.kind === 'item') {
    const item = getShopItem(lock.id);
    if (!item || !isItemUsableByCharacter(item.id, state.characterId)) {
      return null;
    }
    const stacks = state.stacksOf(item.id);
    if (stacks >= item.stackCap) return null;
    return itemOffer(item, lock.slot, stacks, price, true, state.itemPreview);
  }

  if (lock.kind === 'skill') {
    const skill = getFreeSkill(lock.id);
    if (!skill) return null;
    return skillOffer(skill, price, true);
  }

  const potion = getConsumable(lock.id);
  if (!potion || potion.id === SHOP_EMERGENCY_POTION_ID) return null;
  if (potion.id === 'P02' && state.shopWave < P02_FIRST_SHOP_WAVE) return null;
  return potionOffer(potion, price, true);
}

/**
 * 抽取一整手货架：3 件永久道具（品质加权、无重复、排除满层与不可用）、
 * 1 个自由技能、1 种轮换药剂，外加常驻 P01。
 * 道具候选不足 3 件时给出实际数量；完全没有道具候选时只保留技能与药剂。
 * 传入 `locked` 时该格保留锁定商品与原价，其余格按当前商店重新抽取。
 * `reservedItemId` 是配方缺件供给占用的道具，从主货架候选中排除：
 * 缺件不重复出现在五格里，也不挤占五格。
 */
export function drawShopShelf(
  random: () => number,
  state: ShopDrawState,
  rerollsThisShop = 0,
  locked: ShopLockedOffer | null = null,
  reservedItemId: string | null = null,
): ShopShelfDraw {
  assertShopWave(state.shopWave);
  const weights = shopRarityWeightsWithI22(
    state.shopWave,
    state.stacksOf('I22'),
  );
  const offers: ShopOffer[] = [];
  const carried = lockedOfferFor(locked, state);
  const remaining = listShopItemCandidates(state).filter(
    (item) => item.id !== carried?.id && item.id !== reservedItemId,
  );

  for (let slot = 0; slot < SHOP_ITEM_SLOT_COUNT; slot += 1) {
    if (carried && carried.slot === slot) {
      offers.push(carried);
      continue;
    }
    if (remaining.length === 0) continue;
    const available = ITEM_RARITIES.filter((rarity) =>
      remaining.some((item) => item.rarity === rarity),
    );
    const rarity = pickRarity(random, available, weights);
    if (!rarity) continue;
    const sameRarity = remaining.filter((item) => item.rarity === rarity);
    const item = pickRandom(random, sameRarity);
    if (!item) continue;
    remaining.splice(remaining.indexOf(item), 1);
    offers.push(
      itemOffer(
        item,
        slot,
        state.stacksOf(item.id),
        drawnPrice(state, item.basePrice),
        false,
        state.itemPreview,
      ),
    );
  }

  if (carried?.kind === 'skill') {
    offers.push(carried);
  } else {
    const skill =
      forcedSkill(state) ??
      pickRandom(random, listFreeSkillCandidates(state.shopWave));
    if (skill) {
      offers.push(
        skillOffer(
          skill,
          drawnPrice(state, skill.basePrice),
          false,
        ),
      );
    }
  }

  if (carried?.kind === 'potion') {
    offers.push(carried);
  } else {
    const potion =
      forcedPotion(state) ??
      pickRandom(random, listShopPotionCandidates(state.shopWave));
    if (potion) {
      offers.push(
        potionOffer(
          potion,
          drawnPotionPrice(state, potion.basePrice),
          false,
        ),
      );
    }
  }

  const itemSlotsFilled = offers.filter((offer) => offer.kind === 'item').length;
  return {
    shopWave: state.shopWave,
    weights,
    offers,
    emergencyPotion: emergencyPotion(state),
    rerollCount: rerollsThisShop,
    rerollCost: shopRerollCost(state.shopWave, rerollsThisShop),
    reason:
      itemSlotsFilled >= SHOP_ITEM_SLOT_COUNT
        ? 'full'
        : itemSlotsFilled > 0
          ? 'partial-items'
          : 'no-items',
  };
}

/**
 * 一个货架商品的可持久化身份：只记录格位、品类、ID、当格价格与售出/锁定标记，
 * 名称与效果文案在恢复时按当前目录/层数重新派生，不冻结玩家属性预览。
 */
export interface ShopOfferSnapshot {
  readonly slot: number;
  readonly kind: ShopOfferKind;
  readonly id: string;
  readonly price: number;
  readonly sold: boolean;
  readonly locked: boolean;
}

/** 配方缺件供给的可持久化部分；描述文案恢复时按当前层数重算。 */
export interface ShopMaterialSupplySnapshot {
  readonly recipeId: string;
  readonly id: string;
  readonly price: number;
  readonly sold: boolean;
}

/** 一个商店货架的完整可序列化状态（写入 V2 续局快照，US-048）。 */
export interface ShopShelfSnapshot {
  readonly shopWave: number;
  readonly offers: readonly ShopOfferSnapshot[];
  readonly materialSupply: ShopMaterialSupplySnapshot | null;
  readonly rerollCount: number;
}

/**
 * 一个商店的货架状态：初始抽取、售出标记、锁定与重抽。
 *
 * - `markSold` 只把该格标成已售出，不补货；P01 不在货架里，不受影响；
 * - `lock` 免费锁定 1 格；锁定格在重抽与下一商店保留身份与锁定价，
 *   其余格刷新，属性预览按当前层数重新计算；
 * - `reroll` 重新抽取未锁定商品，并累加本商店重抽次数；
 *   费用由调用方按 `rerollCost` 扣除，本类不做金币交易；
 * - 进入下一个商店时新建实例，重抽次数自然清零；
 *   调用方把 `lockedOffer` 传给下一实例即可保留锁定商品；
 * - 传入 `restored` 时按快照原样重建货架，不消耗随机数（刷新续局）。
 */
export class ShopShelf {
  readonly shopWave: number;
  private readonly random: () => number;
  private readonly state: ShopDrawState;
  private drawValue: ShopShelfDraw;
  private lockedValue: ShopLockedOffer | null = null;
  private materialSupplyValue: ShopMaterialSupply | null = null;

  constructor(
    random: () => number,
    state: ShopDrawState,
    locked: ShopLockedOffer | null = null,
    materialSupply: ShopMaterialSupply | null = null,
    restored: ShopShelfSnapshot | null = null,
  ) {
    assertShopWave(state.shopWave);
    this.random = random;
    this.state = state;
    this.shopWave = state.shopWave;
    this.lockedValue = locked;
    this.materialSupplyValue = materialSupply ? { ...materialSupply } : null;
    const restoredDraw = restored ? this.drawFromSnapshot(restored) : null;
    if (restored && restoredDraw) {
      this.drawValue = restoredDraw;
      this.materialSupplyValue = this.restoreMaterialSupply(restored.materialSupply);
    } else {
      this.drawValue = drawShopShelf(
        random,
        state,
        0,
        locked,
        this.materialSupplyValue?.id ?? null,
      );
    }
    this.syncLockFromOffers();
  }

  /** 按快照重建货架；品类/格位/ID/价格不合法时返回 null（退回重新抽货）。 */
  private drawFromSnapshot(snapshot: ShopShelfSnapshot): ShopShelfDraw | null {
    if (typeof snapshot !== 'object' || snapshot === null) return null;
    if (snapshot.shopWave !== this.state.shopWave) return null;
    if (!Array.isArray(snapshot.offers)) return null;
    const offers: ShopOffer[] = [];
    const seenSlots = new Set<number>();
    const seenIds = new Set<string>();
    for (const entry of snapshot.offers) {
      if (typeof entry !== 'object' || entry === null) return null;
      if (!Number.isInteger(entry.slot) || seenSlots.has(entry.slot)) return null;
      if (kindForSlot(entry.slot) !== entry.kind) return null;
      const identity = `${entry.kind}:${entry.id}`;
      if (seenIds.has(identity)) return null;
      seenIds.add(identity);
      if (!Number.isFinite(entry.price) || entry.price < MIN_SHOP_PRICE) return null;
      const price = Math.max(MIN_SHOP_PRICE, Math.floor(entry.price));
      const sold = entry.sold === true;
      let offer: ShopOffer;
      if (entry.kind === 'item') {
        const item = getShopItem(entry.id);
        if (!item || !isItemUsableByCharacter(item.id, this.state.characterId)) {
          return null;
        }
        const stacks = this.state.stacksOf(item.id);
        // 已售出格可能已经把玩家买到满层，不能按“当前仍可购买”拒绝整架快照。
        if (!sold && stacks >= item.stackCap) return null;
        offer = itemOffer(
          item,
          entry.slot,
          stacks,
          price,
          entry.locked === true,
          this.state.itemPreview,
        );
      } else if (entry.kind === 'skill') {
        const skill = getFreeSkill(entry.id);
        if (!skill) return null;
        offer = skillOffer(skill, price, entry.locked === true);
      } else {
        const potion = getConsumable(entry.id);
        if (!potion || potion.id === SHOP_EMERGENCY_POTION_ID) return null;
        if (potion.id === 'P02' && this.state.shopWave < P02_FIRST_SHOP_WAVE) {
          return null;
        }
        offer = potionOffer(potion, price, entry.locked === true);
      }
      if (sold) offer = { ...offer, sold: true, locked: false };
      seenSlots.add(entry.slot);
      offers.push(offer);
    }
    if (offers.filter((offer) => offer.locked).length > 1) return null;
    const rerollCount =
      Number.isInteger(snapshot.rerollCount) && snapshot.rerollCount >= 0
        ? snapshot.rerollCount
        : 0;
    const itemSlotsFilled = offers.filter((offer) => offer.kind === 'item').length;
    return {
      shopWave: this.state.shopWave,
      weights: shopRarityWeightsWithI22(
        this.state.shopWave,
        this.state.stacksOf('I22'),
      ),
      offers,
      emergencyPotion: emergencyPotion(this.state),
      rerollCount,
      rerollCost: shopRerollCost(this.state.shopWave, rerollCount),
      reason:
        itemSlotsFilled >= SHOP_ITEM_SLOT_COUNT
          ? 'full'
          : itemSlotsFilled > 0
            ? 'partial-items'
            : 'no-items',
    };
  }

  /** 恢复缺件供给；未知配方/材料不匹配时放弃供给，不判整架损坏。 */
  private restoreMaterialSupply(
    snapshot: ShopMaterialSupplySnapshot | null,
  ): ShopMaterialSupply | null {
    if (typeof snapshot !== 'object' || snapshot === null) return null;
    const item = getShopItem(snapshot.id);
    const recipe = getRecipe(snapshot.recipeId);
    if (!item || !recipe || !recipe.ingredients.includes(item.id)) return null;
    if (!Number.isFinite(snapshot.price) || snapshot.price < MIN_SHOP_PRICE) {
      return null;
    }
    const stacks = this.state.stacksOf(item.id);
    const preview = this.state.itemPreview?.(item.id, stacks) ?? null;
    return {
      recipeId: recipe.id,
      id: item.id,
      name: item.name,
      price: Math.max(MIN_SHOP_PRICE, Math.floor(snapshot.price)),
      rarity: item.rarity,
      description: preview?.benefit ?? item.benefit,
      cost: preview?.cost ?? item.cost,
      stacks,
      stackCap: item.stackCap,
      sold: snapshot.sold === true,
    };
  }

  /** 当前货架的持久化状态；写入 V2 续局快照。 */
  snapshot(): ShopShelfSnapshot {
    return {
      shopWave: this.shopWave,
      offers: this.drawValue.offers.map((offer) => ({
        slot: offer.slot,
        kind: offer.kind,
        id: offer.id,
        price: offer.price,
        sold: offer.sold,
        locked: offer.locked,
      })),
      materialSupply: this.materialSupplyValue
        ? {
            recipeId: this.materialSupplyValue.recipeId,
            id: this.materialSupplyValue.id,
            price: this.materialSupplyValue.price,
            sold: this.materialSupplyValue.sold,
          }
        : null,
      rerollCount: this.drawValue.rerollCount,
    };
  }

  private syncLockFromOffers(): void {
    const locked = this.drawValue.offers.find((offer) => offer.locked);
    this.lockedValue = locked
      ? {
          slot: locked.slot,
          kind: locked.kind,
          id: locked.id,
          price: locked.price,
        }
      : null;
  }

  get weights(): ShopRarityWeights {
    return this.drawValue.weights;
  }

  get offers(): readonly ShopOffer[] {
    return this.drawValue.offers;
  }

  get emergencyPotion(): ShopEmergencyPotion {
    return this.drawValue.emergencyPotion;
  }

  get rerollCount(): number {
    return this.drawValue.rerollCount;
  }

  get rerollCost(): number {
    return this.drawValue.rerollCost;
  }

  get reason(): ShopShelfReason {
    return this.drawValue.reason;
  }

  /** 当前锁定的商品描述；没有锁定为 null。返回副本，调用方不能改内部状态。 */
  get lockedOffer(): ShopLockedOffer | null {
    return this.lockedValue ? { ...this.lockedValue } : null;
  }

  /** 本商店的配方缺件供给；没有追踪/未到保底时为 null。返回副本。 */
  get materialSupply(): ShopMaterialSupply | null {
    return this.materialSupplyValue ? { ...this.materialSupplyValue } : null;
  }

  /**
   * 把缺件供给标记为已购买；未知条目或重复购买返回 false。
   * 缺件不进入五格，因此不参与 `markSold` 与锁定。
   */
  markMaterialSupplySold(): boolean {
    if (!this.materialSupplyValue || this.materialSupplyValue.sold) {
      return false;
    }
    this.materialSupplyValue = { ...this.materialSupplyValue, sold: true };
    return true;
  }

  /** 锁定某格；只能锁定未售出的货架商品，再次锁定其他格会移动锁定。 */
  lock(slot: number): boolean {
    const offer = this.drawValue.offers.find((entry) => entry.slot === slot);
    if (!offer || offer.sold) return false;
    this.lockedValue = {
      slot: offer.slot,
      kind: offer.kind,
      id: offer.id,
      price: offer.price,
    };
    this.drawValue = {
      ...this.drawValue,
      offers: this.drawValue.offers.map((entry) => ({
        ...entry,
        locked: entry.slot === slot,
      })),
    };
    return true;
  }

  /** 取消锁定；其他状态不变。 */
  unlock(): void {
    this.lockedValue = null;
    this.drawValue = {
      ...this.drawValue,
      offers: this.drawValue.offers.map((entry) =>
        entry.locked ? { ...entry, locked: false } : entry,
      ),
    };
  }

  /** 把某格标成已售出；未知格、P01 或重复出售返回 false。售出格自动解除锁定。 */
  markSold(slot: number): boolean {
    const index = this.drawValue.offers.findIndex((offer) => offer.slot === slot);
    if (index < 0) return false;
    const current = this.drawValue.offers[index];
    if (!current || current.sold) return false;
    const offers = this.drawValue.offers.map((offer, offerIndex) =>
      offerIndex === index ? { ...offer, sold: true, locked: false } : offer,
    );
    this.drawValue = { ...this.drawValue, offers };
    this.syncLockFromOffers();
    return true;
  }

  /** 重抽未锁定商品；已售出格换货，锁定格保留身份与价格，P01 不变。 */
  reroll(): ShopShelfDraw {
    const rerolls = this.drawValue.rerollCount + 1;
    this.drawValue = drawShopShelf(
      this.random,
      this.state,
      rerolls,
      this.lockedValue,
      // 未购买的缺件跨重抽保留，同一件材料不会又出现在五格；
      // 已购买后不再占用候选，五格可正常重抽到该道具。
      this.materialSupplyValue && !this.materialSupplyValue.sold
        ? this.materialSupplyValue.id
        : null,
    );
    this.syncLockFromOffers();
    return this.drawValue;
  }

  /**
   * 用当前属性与层数重算未售出道具格的卡面预览。
   * 商店内购买其他道具后调用，保证“当前 → 购买后”不会停在抽货时的快照。
   */
  refreshItemPreviews(): void {
    const preview = this.state.itemPreview;
    const supply = this.materialSupplyValue;
    if (supply && !supply.sold) {
      const item = getShopItem(supply.id);
      if (item) {
        const stacks = this.state.stacksOf(item.id);
        const card = preview?.(item.id, stacks) ?? null;
        this.materialSupplyValue = {
          ...supply,
          stacks,
          description: card?.benefit ?? item.benefit,
          cost: card?.cost ?? item.cost,
        };
      }
    }
    if (!preview) return;
    this.drawValue = {
      ...this.drawValue,
      offers: this.drawValue.offers.map((offer) => {
        if (offer.kind !== 'item' || offer.sold) return offer;
        const item = getShopItem(offer.id);
        if (!item) return offer;
        const stacks = this.state.stacksOf(offer.id);
        const nextStacks = Math.min(item.stackCap, stacks + 1);
        const card = preview(offer.id, stacks);
        if (!card) return { ...offer, stacks, nextStacks };
        return {
          ...offer,
          stacks,
          nextStacks,
          description: card.benefit,
          cost: card.cost,
          netChange: card.detail,
          previewed: card.previewed,
        };
      }),
    };
  }
}

/** 开发用货架文本：五格构成、品质权重、价格、重抽费用、锁定与 P01 常驻。 */
export function formatShopShelfText(
  shelf: ShopShelf,
  /** 下一次重抽的实际费用；R06 免费次数未用完时传 0，缺省读货架价格。 */
  nextRerollCost = shelf.rerollCost,
): string {
  const lines = [
    `商店 · 第 ${shelf.shopWave} 波后`,
    `品质权重 普通/稀有/史诗：${shelf.weights.普通}/${shelf.weights.稀有}/${shelf.weights.史诗}`,
    '商店无倒计时',
  ];
  for (const offer of shelf.offers) {
    const rarity = offer.rarity ? `（${offer.rarity}）` : '';
    const sold = offer.sold ? ' · 已售出' : '';
    const locked = offer.locked ? ' · 已锁定' : '';
    lines.push(
      `[${offer.slot}] ${offer.id} ${offer.name}${rarity} · ${offer.price} 金币${sold}${locked}`,
    );
    if (offer.kind === 'item' && offer.cost !== null) {
      const label = offer.previewed ? '增益（当前 → 购买后）' : '收益';
      const costLabel = offer.previewed ? '代价（当前 → 购买后）' : '代价';
      lines.push(`  ${label}：${offer.description}`);
      lines.push(`  ${costLabel}：${offer.cost}`);
      if (offer.stacks !== undefined && offer.nextStacks !== undefined) {
        lines.push(
          `  层数：${offer.stacks}/${offer.stackCap ?? '?'} → ${offer.nextStacks}/${offer.stackCap ?? '?'}`,
        );
      }
    }
  }
  lines.push(
    `P01 ${shelf.emergencyPotion.name} · ${shelf.emergencyPotion.price} 金币（常驻独立按钮）`,
  );
  const supply = shelf.materialSupply;
  if (supply) {
    const sold = supply.sold ? ' · 已购买' : '';
    lines.push(
      `配方缺件 ${supply.id} ${supply.name} · ${supply.price} 金币（正常价格，独立于五格与 P01）${sold}`,
    );
  }
  lines.push(
    `重抽 ${nextRerollCost <= 0 ? '免费' : `${nextRerollCost} 金币`}（本商店已重抽 ${shelf.rerollCount} 次）`,
  );
  return lines.join('\n');
}
