/**
 * 配方追踪与缺件供给（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §商店：
 * - 同时只追踪 1 条 R01–R06 配方，且只能追踪当前职业可用、尚未拥有的配方；
 * - 已有至少 1 种材料时，每 3 个商店至少一次提供一件缺失材料；
 * - 缺件供给按正常价格收费，不占主货架 5 格与 P01 常驻按钮；
 * - 更换追踪或合成完成后清除旧追踪，追踪状态随 V2 续局快照保存。
 *
 * 本模块只负责“追踪哪条、下一个商店给哪件缺件”，不做金币交易；
 * 定价与购买由 `shop-offer` / `shop-transaction` 在同一商店会话内完成。
 */
import { getRecipe, getShopItem, listRecipes, type CharacterId, type RecipeDefinition } from './data';
import { isCraftedItemId } from './crafting';
import { isItemUsableByCharacter } from './item-requirements';
import { shopRarityWeights } from './shop-offer';

/** 同时可追踪的配方数量（01 §商店：只追踪 1 条）。 */
export const MAX_TRACKED_RECIPES = 1;

/** 缺件供给保底间隔：每 3 个符合条件的商店至少提供一次。 */
export const MATERIAL_SUPPLY_INTERVAL_SHOPS = 3;

/** 追踪判定所需的本局状态；所有读取都走回调，不持有库存副本。 */
export interface RecipeTrackingContext {
  readonly characterId: CharacterId;
  /** 永久道具层数真源，通常传 `ItemInventory.stacksOf`。 */
  readonly stacksOf: (itemId: string) => number;
  /** 是否已拥有该配方成品，通常传 `CraftedInventory.has`。 */
  readonly hasCrafted: (recipeId: string) => boolean;
}

/** 写入 V2 续局快照的追踪状态；字段名保持稳定，便于跨刷新恢复。 */
export interface RecipeTrackerSnapshot {
  readonly recipeId: string | null;
  readonly shopsSinceSupply: number;
}

export interface RecipeIngredientStatus {
  readonly id: string;
  readonly name: string;
  readonly stacks: number;
  /** 当前 0 层即为缺失材料。 */
  readonly missing: boolean;
}

/** 一条被追踪配方的当前进度，供面板与开发快照展示。 */
export interface TrackedRecipeStatus {
  readonly recipeId: string;
  readonly name: string;
  readonly ingredients: readonly RecipeIngredientStatus[];
  readonly ownedIngredients: number;
  readonly missing: readonly string[];
}

/** 本商店要提供的缺件；由场景交给 `buildShopMaterialSupply` 定价。 */
export interface MaterialSupplyDecision {
  readonly recipeId: string;
  readonly ingredientId: string;
  readonly missing: readonly string[];
  readonly ownedIngredients: number;
}

/** 目录里没有名称时回退 ID，避免开发页因未知材料空白。 */
function ingredientName(itemId: string): string {
  return getShopItem(itemId)?.name ?? itemId;
}

/**
 * 配方是否可追踪：目录存在、尚未拥有成品，
 * 且三种材料都能被当前职业利用（与商店道具可用性同一口径）。
 */
export function recipeTrackable(
  recipeId: string,
  ctx: RecipeTrackingContext,
): boolean {
  if (!isCraftedItemId(recipeId)) return false;
  if (ctx.hasCrafted(recipeId)) return false;
  const recipe = getRecipe(recipeId);
  if (!recipe) return false;
  return recipe.ingredients.every((itemId) =>
    isItemUsableByCharacter(itemId, ctx.characterId),
  );
}

/** 当前职业可追踪且尚未拥有的配方，保持目录顺序。 */
export function listTrackableRecipes(
  ctx: RecipeTrackingContext,
): readonly RecipeDefinition[] {
  return listRecipes().filter((recipe) => recipeTrackable(recipe.id, ctx));
}

/** 被追踪配方当前的逐件材料进度；不可追踪/未知配方返回 null。 */
export function trackedRecipeStatus(
  recipeId: string,
  ctx: RecipeTrackingContext,
): TrackedRecipeStatus | null {
  if (!recipeTrackable(recipeId, ctx)) return null;
  const recipe = getRecipe(recipeId);
  if (!recipe) return null;
  const ingredients = recipe.ingredients.map((itemId) => {
    const stacks = Math.max(0, Math.floor(ctx.stacksOf(itemId)));
    return {
      id: itemId,
      name: ingredientName(itemId),
      stacks,
      missing: stacks <= 0,
    };
  });
  const missing = ingredients
    .filter((ingredient) => ingredient.missing)
    .map((ingredient) => ingredient.id);
  return {
    recipeId,
    name: recipe.name,
    ingredients,
    ownedIngredients: ingredients.length - missing.length,
    missing,
  };
}

/**
 * 单条配方的追踪器。`beginShop` 每个商店只调用一次（重抽不调用），
 * 保证“每 3 个商店”按商店数而不是按货架刷新次数计数。
 */
export class RecipeTracker {
  private recipeIdValue: string | null = null;
  private shopsSinceSupplyValue = 0;

  get trackedRecipeId(): string | null {
    return this.recipeIdValue;
  }

  /** 已连续多少个符合条件的商店没有提供缺件（0–2）。 */
  get shopsSinceSupply(): number {
    return this.shopsSinceSupplyValue;
  }

  /**
   * 追踪一条配方；同一配方重复调用不清零计数，换配方则重新计数。
   * 配方不可追踪（职业不可用/已拥有/未知）时保持原追踪并返回 false。
   */
  track(recipeId: string, ctx: RecipeTrackingContext): boolean {
    if (!recipeTrackable(recipeId, ctx)) return false;
    if (this.recipeIdValue === recipeId) return true;
    this.recipeIdValue = recipeId;
    this.shopsSinceSupplyValue = 0;
    return true;
  }

  /** 清除追踪；原有计数一并归零，下一次追踪从第 1 个商店重新计时。 */
  clear(): void {
    this.recipeIdValue = null;
    this.shopsSinceSupplyValue = 0;
  }

  /** 合成成功后调用：只有完成的是当前追踪配方时才清除。 */
  noteCrafted(recipeId: string): boolean {
    if (this.recipeIdValue !== recipeId) return false;
    this.clear();
    return true;
  }

  /**
   * 进入一个商店：推进缺件供给保底计数，并在第 3 个符合条件的商店
   * 返回一件缺失材料。以下情况不计数、不供给：
   * - 没有追踪、配方已拥有或已不可追踪；
   * - 还没有任何材料（保底只对“已有至少 1 种材料”生效）；
   * - 材料已经集齐（等待合成，不再供给）；
   * - 所有缺件的品质在本商店权重为 0（如第 1–5 商店的史诗），
   *   此时不给件也不推进计数，等品质开放后重新累计。
   */
  beginShop(
    ctx: RecipeTrackingContext,
    shopWave: number,
  ): MaterialSupplyDecision | null {
    const recipeId = this.recipeIdValue;
    if (!recipeId) return null;
    const status = trackedRecipeStatus(recipeId, ctx);
    if (!status) {
      this.clear();
      return null;
    }
    if (status.ownedIngredients <= 0) return null;
    if (status.missing.length === 0) return null;

    // 品质规则：只供给本商店权重 > 0 的材料；早期商店不给史诗。
    const weights = shopRarityWeights(shopWave);
    const eligible = status.missing.filter((itemId) => {
      const item = getShopItem(itemId);
      return item ? weights[item.rarity] > 0 : false;
    });
    if (eligible.length === 0) return null;

    this.shopsSinceSupplyValue += 1;
    if (this.shopsSinceSupplyValue < MATERIAL_SUPPLY_INTERVAL_SHOPS) {
      return null;
    }
    this.shopsSinceSupplyValue = 0;
    return {
      recipeId,
      // 缺失材料按配方顺序取第一件品质可用的；场景会把这件从主货架候选中排除，
      // 因此不会与五格重复，也不会挤占五格。
      ingredientId: eligible[0] as string,
      missing: [...status.missing],
      ownedIngredients: status.ownedIngredients,
    };
  }

  snapshot(): RecipeTrackerSnapshot {
    return {
      recipeId: this.recipeIdValue,
      shopsSinceSupply: this.shopsSinceSupplyValue,
    };
  }

  /**
   * 从快照恢复：未知编号、职业不可用或已拥有的配方一律丢弃；
   * 计数只接受 0–2 的整数，非法值归零而不是让快照整体判损坏。
   */
  restore(
    snapshot: RecipeTrackerSnapshot | null | undefined,
    ctx: RecipeTrackingContext,
  ): void {
    this.clear();
    if (!snapshot || typeof snapshot !== 'object') return;
    const recipeId = snapshot.recipeId;
    if (typeof recipeId !== 'string') return;
    if (!recipeTrackable(recipeId, ctx)) return;
    const rawCounter = snapshot.shopsSinceSupply;
    const counter =
      Number.isInteger(rawCounter) &&
      rawCounter >= 0 &&
      rawCounter < MATERIAL_SUPPLY_INTERVAL_SHOPS
        ? rawCounter
        : 0;
    this.recipeIdValue = recipeId;
    this.shopsSinceSupplyValue = counter;
  }

  reset(): void {
    this.clear();
  }
}
