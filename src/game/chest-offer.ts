/**
 * 宝箱波末二选一（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §宝箱：
 * - 每个资格展示两件不同、已揭示的随机永久商店道具，选 1 件免费获得；
 * - 不出现药剂、精英核心、配方成品或当前职业完全无法利用的道具；
 * - 已满层排除，同一手不重复，至少一项当前可用；
 * - 品质权重：第 2/5 波普通 70/稀有 30；第 8/11 波稀有 80/史诗 20；
 *   第 14/17 波稀有 50/史诗 50；
 * - 可选不足两种时给 1 件有效道具；完全没有有效道具时该资格转 50 金币；
 * - 抽取结果由调用方在资格生成时写入奖励队列并落盘，刷新不重抽。
 */
import {
  listShopItems,
  type CharacterId,
  type ItemRarity,
  type ShopItemDefinition,
} from './data';
import { waveHasChest } from './chest';
import { isItemUsableByCharacter } from './item-requirements';
import type { ItemCardPreview } from './item-effects';

// 宝箱旧调用点继续从本模块导入；能力表与实际判定已移到 item-requirements。
export { isItemUsableByCharacter } from './item-requirements';

/** 每个资格最多展示的道具数量。 */
export const CHEST_OFFER_COUNT = 2;

/** 完全没有有效道具时，该资格转换的金币。 */
export const CHEST_FALLBACK_GOLD = 50;

/** 道具品质的固定顺序，保证同种子抽取可重现。 */
export const ITEM_RARITY_ORDER: readonly ItemRarity[] = ['普通', '稀有', '史诗'];

/** 某波宝箱的品质权重。 */
export type ChestOfferWeights = Readonly<Record<ItemRarity, number>>;

/** 某波宝箱的品质权重；非宝箱波直接报错，避免静默套用错误档位。 */
export function chestOfferRarityWeights(wave: number): ChestOfferWeights {
  if (!waveHasChest(wave)) {
    throw new Error(`第 ${wave} 波不刷新宝箱`);
  }
  if (wave <= 5) return { 普通: 70, 稀有: 30, 史诗: 0 };
  if (wave <= 11) return { 普通: 0, 稀有: 80, 史诗: 20 };
  return { 普通: 0, 稀有: 50, 史诗: 50 };
}

export interface ChestOfferDrawState {
  readonly characterId: CharacterId;
  /** 当前道具层数查询口，通常传 `ItemInventory.stacksOf`。 */
  readonly stacksOf: (itemId: string) => number;
}

export type ChestOfferReason = 'two' | 'single' | 'no-valid-items';

export interface ChestOfferDraw {
  /** 展示顺序即抽取顺序；空数组表示没有有效道具。 */
  readonly itemIds: readonly string[];
  /** 无有效道具时的兜底金币；正常抽取为 0。 */
  readonly fallbackGold: number;
  readonly reason: ChestOfferReason;
}

/** 当前职业可用且未满层的永久道具，保持目录顺序。 */
export function listChestCandidates(
  state: ChestOfferDrawState,
): ShopItemDefinition[] {
  return listShopItems().filter(
    (item) =>
      isItemUsableByCharacter(item.id, state.characterId) &&
      state.stacksOf(item.id) < item.stackCap,
  );
}

function pickRarity(
  random: () => number,
  available: readonly ItemRarity[],
  weights: ChestOfferWeights,
): ItemRarity {
  const weighted = available.filter((rarity) => weights[rarity] > 0);
  // 权重档位内的道具耗尽、只剩 0 权重品质时，退化为在剩余品质内等概率，
  // 保证“可选不足两种给 1 件有效道具”而不是错误地转金币。
  const pool = weighted.length > 0 ? weighted : available;
  const total = pool.reduce(
    (sum, rarity) => sum + (weighted.length > 0 ? weights[rarity] : 1),
    0,
  );
  let roll = random() * total;
  for (const rarity of pool) {
    roll -= weighted.length > 0 ? weights[rarity] : 1;
    if (roll < 0) return rarity;
  }
  return pool[pool.length - 1] as ItemRarity;
}

function pickItem(
  random: () => number,
  items: readonly ShopItemDefinition[],
): ShopItemDefinition {
  const index = Math.min(
    items.length - 1,
    Math.max(0, Math.floor(random() * items.length)),
  );
  return items[index] as ShopItemDefinition;
}

/**
 * 抽取一个宝箱资格的两件候选。全部候选都先按“职业可用 + 未满层”过滤，
 * 因此返回的每件道具都可用；不足两件时返回 1 件，完全为空时转兜底金币。
 */
export function drawChestOffers(
  random: () => number,
  wave: number,
  state: ChestOfferDrawState,
): ChestOfferDraw {
  const weights = chestOfferRarityWeights(wave);
  const pool = listChestCandidates(state);
  if (pool.length === 0) {
    return {
      itemIds: [],
      fallbackGold: CHEST_FALLBACK_GOLD,
      reason: 'no-valid-items',
    };
  }

  const count = Math.min(CHEST_OFFER_COUNT, pool.length);
  const remaining = [...pool];
  const picks: ShopItemDefinition[] = [];
  while (picks.length < count) {
    const available = ITEM_RARITY_ORDER.filter((rarity) =>
      remaining.some((item) => item.rarity === rarity),
    );
    if (available.length === 0) break;
    const rarity = pickRarity(random, available, weights);
    const sameRarity = remaining.filter((item) => item.rarity === rarity);
    if (sameRarity.length === 0) break;
    const item = pickItem(random, sameRarity);
    picks.push(item);
    remaining.splice(remaining.indexOf(item), 1);
  }

  return {
    itemIds: picks.map((item) => item.id),
    fallbackGold: 0,
    reason: picks.length >= CHEST_OFFER_COUNT ? 'two' : 'single',
  };
}

/** 奖励条目中与宝箱二选一相关的可读字段。 */
export interface ChestOfferEntryLike {
  readonly offers?: readonly string[];
  readonly fallbackGold?: number;
}

export interface ChestClaim {
  readonly itemId: string | null;
  readonly gold: number;
}

/**
 * 解析一次领取：有候选时按焦点取 1 件道具；没有候选时返回兜底金币。
 * 焦点越界返回 null，由调用方保持面板不变，避免误领。
 */
export function resolveChestClaim(
  entry: ChestOfferEntryLike,
  selectedIndex = 0,
): ChestClaim | null {
  const offers = entry.offers ?? [];
  if (offers.length > 0) {
    const index = Math.floor(selectedIndex);
    if (!Number.isInteger(index) || index < 0 || index >= offers.length) {
      return null;
    }
    return { itemId: offers[index] as string, gold: 0 };
  }
  return {
    itemId: null,
    gold: entry.fallbackGold ?? CHEST_FALLBACK_GOLD,
  };
}

/** 卡面需要的已揭示数据；从目录与当前层数派生，不写入存档。 */
export interface ChestOfferDisplay {
  readonly itemId: string;
  readonly name: string;
  readonly rarity: ItemRarity;
  readonly tag: string;
  /** 正收益：传入预览回调时为聚合后的“当前 → 购买后”值。 */
  readonly benefit: string;
  /** 代价：传入预览回调时为聚合后的“当前 → 购买后”值。 */
  readonly cost: string;
  readonly stacks: number;
  readonly stackCap: number;
  readonly nextStacks: number;
  readonly netChange: string;
  /** true 表示 benefit/cost 来自实时聚合，而不是目录原文。 */
  readonly previewed: boolean;
}

/**
 * 把候选 ID 展开成卡面数据；未知 ID 被忽略。
 * `itemPreview` 由场景注入，用当前聚合属性计算购买 1 层的真实变化；
 * 缺省时回退为目录文案（非 I01–I12 道具在各自故事落地前使用）。
 */
export function describeChestOffers(
  itemIds: readonly string[],
  stacksOf: (itemId: string) => number,
  itemPreview?: (itemId: string, stacks: number) => ItemCardPreview | null,
): ChestOfferDisplay[] {
  return itemIds.flatMap((itemId) => {
    const item = listShopItems().find((candidate) => candidate.id === itemId);
    if (!item) return [];
    const stacks = stacksOf(item.id);
    const preview = itemPreview?.(item.id, stacks) ?? null;
    return [
      {
        itemId: item.id,
        name: item.name,
        rarity: item.rarity,
        tag: item.tag,
        benefit: preview?.benefit ?? item.benefit,
        cost: preview?.cost ?? item.cost,
        stacks,
        stackCap: item.stackCap,
        nextStacks: Math.min(item.stackCap, stacks + 1),
        netChange: preview?.detail ?? `${item.benefit}；${item.cost}`,
        previewed: preview?.previewed ?? false,
      },
    ];
  });
}

/** 单张宝箱道具卡：收益、代价、层数与净变化同屏可见。 */
export function formatChestOfferCard(
  offer: ChestOfferDisplay,
  index: number,
  focused: boolean,
): string {
  const benefitLabel = offer.previewed ? '增益（当前 → 购买后）' : '收益';
  const costLabel = offer.previewed ? '代价（当前 → 购买后）' : '代价';
  return [
    `${focused ? '▶' : ' '} [${index + 1}] ${offer.name} · ${offer.rarity}`,
    `标签：${offer.tag}`,
    `${benefitLabel}：${offer.benefit}`,
    `${costLabel}：${offer.cost}`,
    `层数：${offer.stacks}/${offer.stackCap} → ${offer.nextStacks}/${offer.stackCap}`,
    `本层净变化：${offer.netChange}`,
  ].join('\n');
}

/** 兜底面板文案：完全无有效道具时明确说明原因。 */
export function formatChestFallbackPrompt(gold: number): string {
  return [
    '宝箱战利品',
    '道具已满：当前职业已没有可用的永久道具',
    `本资格转为 ${gold} 金币`,
    'Enter 领取金币',
  ].join('\n');
}
