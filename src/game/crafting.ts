/**
 * 三件合成事务 R01–R06（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §三件合成与
 * `02-content-catalog.md` §6 条三件合成：
 * - 集齐配方三种材料各 1 件并支付手续费后才能合成；材料层数多于 1 时只消耗 1 层；
 * - 原材料全部正负效果随层数移除，不保留材料属性再叠一次成品；
 * - 确认前提供净属性变化（材料移除 + 成品生效）与新增机制文本；
 * - 一次提交：校验 → 扣手续费 → 移除材料 → 发放成品；任一步失败全额回滚金币与材料；
 * - 成品每件唯一、不可拆解或出售，已拥有时不再出现合成入口；
 * - 成品属性走 `StatAggregator` 来源，机制数值集中在本模块的 `params`，
 *   具体战斗机制由 US-035/US-036 接入。
 */
import { getRecipe, getShopItem, type RecipeDefinition } from './data';
import { describeItemEffect, itemStatModifiers } from './item-effects';
import {
  MIN_MAX_HEALTH,
  clampArmor,
  clampAttackSpeedMultiplier,
  clampCooldownReduction,
  clampDamageMultiplier,
  clampMoveSpeedMultiplier,
  type StatId,
  type StatMode,
  type StatModifier,
} from './stats';

/** 6 件配方成品；与内容目录的 6 条配方一一对应。 */
export const CRAFTED_ITEM_IDS = [
  'R01',
  'R02',
  'R03',
  'R04',
  'R05',
  'R06',
] as const;

export type CraftedItemId = (typeof CRAFTED_ITEM_IDS)[number];

const CRAFTED_ITEM_ID_SET: ReadonlySet<string> = new Set(CRAFTED_ITEM_IDS);

export function isCraftedItemId(itemId: string): itemId is CraftedItemId {
  return CRAFTED_ITEM_ID_SET.has(itemId);
}

/** 每条配方固定消耗每种材料 1 层；重复层数不会多扣。 */
export const CRAFT_MATERIAL_LAYERS = 1;

/**
 * 成品数值：属性修正、新增机制文案与后续机制接线所需参数。
 * 所有数字与 `02-content-catalog.md` §6 条三件合成逐项对应。
 */
export interface RecipeEffectParams {
  readonly statModifiers: readonly StatModifier[];
  /** 确认前展示的新增机制；不含属性部分。 */
  readonly mechanics: readonly string[];
  /** 成品机制数值；US-035/US-036 接入战斗时读取，不在场景另写常量。 */
  readonly params: Readonly<Record<string, number>>;
}

const R01_STATS: readonly StatModifier[] = [
  { stat: 'maxHealth', mode: 'flat', value: 80 },
  { stat: 'armor', mode: 'flat', value: 20 },
  { stat: 'moveSpeed', mode: 'percent', value: -0.06 },
];

const R02_STATS: readonly StatModifier[] = [
  { stat: 'explosionRadius', mode: 'percent', value: 0.3 },
  // 与 I16 的 damageOverTime 分开，二者在持续通道里叠乘而不是加算。
  { stat: 'recipeDamageOverTime', mode: 'percent', value: 0.3 },
  { stat: 'attackSpeed', mode: 'percent', value: -0.08 },
];

const R03_STATS: readonly StatModifier[] = [
  { stat: 'attackSpeed', mode: 'percent', value: 0.2 },
  { stat: 'normalAttackDamage', mode: 'percent', value: -0.1 },
];

const R04_STATS: readonly StatModifier[] = [
  { stat: 'skillDamage', mode: 'percent', value: 0.3 },
  { stat: 'cooldownReduction', mode: 'percent', value: 0.15 },
  { stat: 'maxHealth', mode: 'flat', value: -20 },
];

const R05_STATS: readonly StatModifier[] = [
  { stat: 'summonDamage', mode: 'percent', value: 0.25 },
  { stat: 'summonHealth', mode: 'percent', value: 0.35 },
  { stat: 'normalAttackDamage', mode: 'percent', value: -0.1 },
];

export const RECIPE_EFFECT_PARAMS: Readonly<
  Record<CraftedItemId, RecipeEffectParams>
> = {
  R01: {
    statModifiers: R01_STATS,
    mechanics: [
      '每击败 15 个普通敌人永久 +3 最大生命',
      '每击败精英 +15 最大生命',
      '成长上限 +120',
      '每 4 秒首次受击后，下次 J 附加最大生命 5% 物伤（上限 60）',
      '计数仅来自本体敌人',
    ],
    params: {
      growthEveryNormalKills: 15,
      growthPerNormalKill: 3,
      growthPerEliteKill: 15,
      growthCap: 120,
      counterIntervalSeconds: 4,
      counterMaxHealthRatio: 0.05,
      counterDamageCap: 60,
    },
  },
  R02: {
    statModifiers: R02_STATS,
    mechanics: ['爆炸击杀产生一次 50% 小爆炸', '小爆炸不能递归'],
    params: {
      deathExplosionRatio: 0.5,
    },
  },
  R03: {
    statModifiers: R03_STATS,
    mechanics: ['每次 J 追加 2 枚 40% 伤害侧弹', '追加弹不能触发追加弹'],
    params: {
      sideProjectileCount: 2,
      sideProjectileDamageRatio: 0.4,
    },
  },
  R04: {
    statModifiers: R04_STATS,
    mechanics: ['每第 4 次技能施放返还该技能当前冷却的 35%'],
    params: {
      refundEveryCasts: 4,
      refundCooldownRatio: 0.35,
    },
  },
  R05: {
    statModifiers: R05_STATS,
    mechanics: ['每 12 秒生成一个小流形，持续 5 秒'],
    params: {
      spawnEverySeconds: 12,
      spawnDurationSeconds: 5,
      // 设计稿只写“5 秒小流形”，未给独立数值；这里按缪尔赛思远程流形的
      // 14 法伤/0.8 秒/230 射程取值，作为一只缩小版流形。
      flowformDamage: 14,
      flowformAttackIntervalSeconds: 0.8,
      flowformRange: 230,
    },
  },
  R06: {
    statModifiers: [],
    mechanics: [
      '每个商店第一次重抽免费',
      '首次购买永久道具减价 20%',
      '每波结束后生命恢复减半',
    ],
    params: {
      freeRerollsPerShop: 1,
      firstItemDiscountPercent: 20,
      intermissionHealMultiplier: 0.5,
    },
  },
};

/** 成品属性修正；未拥有/未知 ID 返回空数组。 */
export function craftedStatModifiers(recipeId: string): StatModifier[] {
  if (!isCraftedItemId(recipeId)) return [];
  return RECIPE_EFFECT_PARAMS[recipeId].statModifiers.map((modifier) => ({
    ...modifier,
  }));
}

/** 构筑面板/快照用：成品名称、属性与新增机制，不依赖当前材料层数。 */
export interface CraftedItemDescription {
  readonly id: CraftedItemId;
  readonly name: string;
  readonly statModifiers: readonly StatModifier[];
  readonly mechanics: readonly string[];
}

export function describeCraftedItem(
  recipeId: string,
): CraftedItemDescription | null {
  if (!isCraftedItemId(recipeId)) return null;
  const recipe = getRecipe(recipeId);
  if (!recipe) return null;
  return {
    id: recipeId,
    name: recipe.name,
    statModifiers: craftedStatModifiers(recipeId),
    mechanics: [...RECIPE_EFFECT_PARAMS[recipeId].mechanics],
  };
}

/** 合成手续费；未知配方返回 0。 */
export function craftFee(recipeId: string): number {
  return getRecipe(recipeId)?.fee ?? 0;
}

/** 金币账本的最小接口；本局传 `EconomyLedger`。 */
export interface CraftGoldLedger {
  readonly gold: number;
  addGold(amount: number): number;
  spendGold(amount: number): boolean;
}

/** 永久道具层数账本的最小接口；本局传 `ItemInventory`。 */
export interface CraftItemInventory {
  stacksOf(itemId: string): number;
  acquire(itemId: string): boolean;
  release(itemId: string): boolean;
}

/** 支付账本的最小接口；材料被合成消耗后裁剪幽灵退款记录。 */
export interface CraftPaymentLedger {
  trimTo(itemId: string, maxCount: number): void;
}

/**
 * 成品库存：每件配方成品唯一。
 * 与 `ItemInventory` 分开，避免成品误入商店叠层/出售路径。
 */
export class CraftedInventory {
  private readonly ownedValue = new Set<CraftedItemId>();

  has(recipeId: string): boolean {
    return isCraftedItemId(recipeId) && this.ownedValue.has(recipeId);
  }

  /** 获得成品；未知配方、已拥有都返回 false。 */
  acquire(recipeId: string): boolean {
    if (!isCraftedItemId(recipeId)) return false;
    if (this.ownedValue.has(recipeId)) return false;
    this.ownedValue.add(recipeId);
    return true;
  }

  /** 已拥有成品，按目录顺序输出，便于稳定落盘与断言。 */
  snapshot(): CraftedItemId[] {
    return CRAFTED_ITEM_IDS.filter((id) => this.ownedValue.has(id));
  }

  /** 从快照恢复；未知 ID 与重复条目被忽略，不抛错。 */
  restore(entries: readonly string[] | undefined): void {
    this.ownedValue.clear();
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (typeof entry !== 'string') continue;
      this.acquire(entry);
    }
  }

  reset(): void {
    this.ownedValue.clear();
  }
}

export interface CraftMaterialQuote {
  readonly id: string;
  readonly name: string;
  readonly stacksBefore: number;
  readonly stacksAfter: number;
  /** 本配方消耗的层数，固定为 1。 */
  readonly layersConsumed: number;
  /** 材料当前 1 层的收益/代价文案。 */
  readonly effect: string;
  readonly removedModifiers: readonly StatModifier[];
}

export interface CraftStatChange {
  readonly stat: StatId;
  readonly mode: StatMode;
  readonly label: string;
  /** 材料移除造成的修正合计（正负号与原始修正一致）。 */
  readonly removed: number;
  /** 成品提供的修正合计。 */
  readonly added: number;
  /** 净变化 = 成品 − 材料；正数表示合成后该属性提高。 */
  readonly net: number;
  /** true 表示数值为百分比（0.1 = 10%）。 */
  readonly percent: boolean;
}

export interface CraftInspection {
  readonly recipe: RecipeDefinition;
  readonly fee: number;
  readonly materials: readonly CraftMaterialQuote[];
  readonly addedModifiers: readonly StatModifier[];
  readonly removedModifiers: readonly StatModifier[];
  readonly netModifiers: readonly StatModifier[];
  readonly statChanges: readonly CraftStatChange[];
  readonly mechanics: readonly string[];
}

export interface CraftMissingMaterial {
  readonly id: string;
  readonly name: string;
  readonly required: number;
  readonly available: number;
}

export type CraftFailureReason =
  | 'unknown-recipe'
  | 'already-owned'
  | 'missing-materials'
  | 'insufficient-gold'
  | 'delivery-failed'
  | 'craft-unavailable';

export interface CraftFailure {
  readonly ok: false;
  readonly reason: CraftFailureReason;
  /** 失败后的金币；校验阶段失败时金币不变。 */
  readonly gold: number;
  /** 距离可合成还差多少金币；其他失败为 0。 */
  readonly shortfall: number;
  /** 材料不足的条目；其他失败为空。 */
  readonly missing: readonly CraftMissingMaterial[];
  /** 成品 ID；可能未知时为请求值。 */
  readonly recipeId: string;
}

export interface CraftCheckSuccess {
  readonly ok: true;
  readonly inspection: CraftInspection;
  readonly fee: number;
  readonly gold: number;
  readonly shortfall: 0;
}

export type CraftCheck = CraftCheckSuccess | CraftFailure;

export interface CraftMaterialResult {
  readonly id: string;
  readonly name: string;
  readonly stacksBefore: number;
  readonly stacksAfter: number;
}

export interface CraftSuccess {
  readonly ok: true;
  readonly recipeId: CraftedItemId;
  readonly name: string;
  readonly fee: number;
  readonly goldBefore: number;
  readonly goldAfter: number;
  readonly materials: readonly CraftMaterialResult[];
  /** 合成后的成品清单；成品唯一。 */
  readonly crafted: readonly CraftedItemId[];
  readonly inspection: CraftInspection;
}

export type CraftResult = CraftSuccess | CraftFailure;

const STAT_ORDER: readonly StatId[] = [
  'maxHealth',
  'armor',
  'magicResist',
  'moveSpeed',
  'attackSpeed',
  'damage',
  'directDamage',
  'skillDamage',
  'normalAttackDamage',
  'attackRange',
  'projectileRadius',
  'cooldownReduction',
  'lifesteal',
  'healingEffect',
  'skillDuration',
  'skillCooldown',
  'explosionRadius',
  'explosionDamage',
  'explosionSkillCooldown',
  'damageOverTime',
  'recipeDamageOverTime',
  'summonDamage',
  'summonHealth',
  'xpRadius',
  'killGold',
  'completionGold',
];

const STAT_LABELS: Readonly<Record<StatId, string>> = {
  maxHealth: '最大生命',
  armor: '护甲',
  magicResist: '法抗',
  moveSpeed: '移动速度',
  attackSpeed: '攻击速度',
  damage: '伤害',
  directDamage: '直接伤害',
  skillDamage: '技能伤害',
  normalAttackDamage: 'J 伤害',
  attackRange: '射程',
  projectileRadius: '弹体直径',
  cooldownReduction: '冷却缩减',
  lifesteal: '吸血',
  healingEffect: '恢复效果',
  skillDuration: '技能持续时间',
  skillCooldown: '技能冷却',
  explosionRadius: '爆炸半径',
  explosionDamage: '爆炸伤害',
  explosionSkillCooldown: '爆炸技能冷却',
  damageOverTime: '持续伤害',
  recipeDamageOverTime: '持续伤害（成品）',
  summonDamage: '召唤物伤害',
  summonHealth: '召唤物生命',
  xpRadius: '经验吸取半径',
  killGold: '击杀金币',
  completionGold: '完成奖励金币',
};

export function statLabel(stat: StatId): string {
  return STAT_LABELS[stat] ?? stat;
}

/** 修正值最多三位小数；求和后消除浮点尾巴，预览文案才不会出现 0.010000000000000009。 */
function roundModifier(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function sumModifiers(
  removed: readonly StatModifier[],
  added: readonly StatModifier[],
): CraftStatChange[] {
  const removedByKey = new Map<string, number>();
  for (const modifier of removed) {
    const key = `${modifier.stat}:${modifier.mode}`;
    removedByKey.set(key, (removedByKey.get(key) ?? 0) + modifier.value);
  }
  const addedByKey = new Map<string, number>();
  for (const modifier of added) {
    const key = `${modifier.stat}:${modifier.mode}`;
    addedByKey.set(key, (addedByKey.get(key) ?? 0) + modifier.value);
  }

  const changes: CraftStatChange[] = [];
  for (const stat of STAT_ORDER) {
    for (const mode of ['flat', 'percent'] as const) {
      const key = `${stat}:${mode}`;
      const removedValue = roundModifier(removedByKey.get(key) ?? 0);
      const addedValue = roundModifier(addedByKey.get(key) ?? 0);
      if (removedValue === 0 && addedValue === 0) continue;
      changes.push({
        stat,
        mode,
        label: statLabel(stat),
        removed: removedValue,
        added: addedValue,
        net: roundModifier(addedValue - removedValue),
        percent: mode === 'percent',
      });
    }
  }
  return changes;
}

function netModifiersOf(changes: readonly CraftStatChange[]): StatModifier[] {
  return changes
    .filter((change) => change.net !== 0)
    .map((change) => ({
      stat: change.stat,
      mode: change.mode,
      value: change.net,
    }));
}

function materialQuote(
  recipe: RecipeDefinition,
  inventory: CraftItemInventory,
): CraftMaterialQuote[] {
  return recipe.ingredients.map((id) => {
    const item = getShopItem(id);
    const stacksBefore = inventory.stacksOf(id);
    return {
      id,
      name: item?.name ?? id,
      stacksBefore,
      stacksAfter: Math.max(0, stacksBefore - CRAFT_MATERIAL_LAYERS),
      layersConsumed: CRAFT_MATERIAL_LAYERS,
      effect: describeItemEffect(id, CRAFT_MATERIAL_LAYERS),
      removedModifiers: itemStatModifiers(id, CRAFT_MATERIAL_LAYERS),
    };
  });
}

/**
 * 合成报价：材料、手续费、材料移除修正、成品修正与净变化。
 * 未知配方返回 null；不修改金币或库存。
 */
export function inspectRecipe(
  recipeId: string,
  inventory: CraftItemInventory,
): CraftInspection | null {
  if (!isCraftedItemId(recipeId)) return null;
  const recipe = getRecipe(recipeId);
  if (!recipe) return null;

  const materials = materialQuote(recipe, inventory);
  const removedModifiers = materials.flatMap((material) => [
    ...material.removedModifiers,
  ]);
  const addedModifiers = craftedStatModifiers(recipeId);
  const statChanges = sumModifiers(removedModifiers, addedModifiers);
  return {
    recipe,
    fee: recipe.fee,
    materials,
    addedModifiers,
    removedModifiers,
    netModifiers: netModifiersOf(statChanges),
    statChanges,
    mechanics: [...RECIPE_EFFECT_PARAMS[recipeId].mechanics],
  };
}

export interface CraftingSessionOptions {
  readonly gold: CraftGoldLedger;
  readonly inventory: CraftItemInventory;
  readonly crafted: CraftedInventory;
  /** 跨商店共享的支付账本；材料被消耗后裁剪到现存层数。 */
  readonly payments?: CraftPaymentLedger;
  /**
   * 自定义成品发货；返回 false 表示发货失败并整笔回滚。
   * 缺省写入 `crafted`，测试可用它构造回滚分支。
   */
  readonly deliver?: (recipeId: CraftedItemId) => boolean;
}

/**
 * 单个商店的三件合成会话。
 * 所有检查都不产生副作用；`craft` 严格按「校验 → 扣款 → 移除材料 → 发货」提交。
 */
export class CraftingSession {
  private readonly gold: CraftGoldLedger;
  private readonly inventory: CraftItemInventory;
  readonly crafted: CraftedInventory;
  private readonly payments: CraftPaymentLedger | null;
  private readonly deliver: (recipeId: CraftedItemId) => boolean;

  constructor(options: CraftingSessionOptions) {
    this.gold = options.gold;
    this.inventory = options.inventory;
    this.crafted = options.crafted;
    this.payments = options.payments ?? null;
    this.deliver =
      options.deliver ?? ((recipeId) => this.crafted.acquire(recipeId));
  }

  /** 合成报价；未知配方返回 null。不扣款、不改库存。 */
  inspect(recipeId: string): CraftInspection | null {
    return inspectRecipe(recipeId, this.inventory);
  }

  /** 当前可合成的成品 ID，按目录顺序；用于“商店出现可合成”入口。 */
  craftableIds(): CraftedItemId[] {
    return CRAFTED_ITEM_IDS.filter((id) => this.canCraft(id).ok);
  }

  private failure(
    recipeId: string,
    reason: CraftFailureReason,
    shortfall = 0,
    missing: readonly CraftMissingMaterial[] = [],
  ): CraftFailure {
    return {
      ok: false,
      reason,
      gold: this.gold.gold,
      shortfall,
      missing,
      recipeId,
    };
  }

  /**
   * 可合成性检查：不扣款、不消耗材料。
   * 已拥有成品优先于材料/金币检查，入口据此隐藏。
   */
  canCraft(recipeId: string): CraftCheck {
    const inspection = this.inspect(recipeId);
    if (!inspection) return this.failure(recipeId, 'unknown-recipe');
    if (this.crafted.has(recipeId)) {
      return this.failure(recipeId, 'already-owned');
    }

    const missing: CraftMissingMaterial[] = [];
    for (const material of inspection.materials) {
      if (material.stacksBefore < material.layersConsumed) {
        missing.push({
          id: material.id,
          name: material.name,
          required: material.layersConsumed,
          available: material.stacksBefore,
        });
      }
    }
    if (missing.length > 0) {
      return this.failure(recipeId, 'missing-materials', 0, missing);
    }

    const shortfall = Math.max(0, inspection.fee - this.gold.gold);
    if (shortfall > 0) {
      return this.failure(recipeId, 'insufficient-gold', shortfall);
    }

    return {
      ok: true,
      inspection,
      fee: inspection.fee,
      gold: this.gold.gold,
      shortfall: 0,
    };
  }

  /**
   * 合成一次：支付手续费、各消耗材料 1 层并发放唯一成品。
   * 材料移除或发货失败时把已移除材料与手续费全部退回。
   */
  craft(recipeId: string): CraftResult {
    const check = this.canCraft(recipeId);
    if (!check.ok) return check;

    const { inspection, fee } = check;
    const goldBefore = this.gold.gold;
    if (!this.gold.spendGold(fee)) {
      return this.failure(
        recipeId,
        'insufficient-gold',
        Math.max(0, fee - this.gold.gold),
      );
    }

    const consumed: string[] = [];
    for (const material of inspection.materials) {
      if (!this.inventory.release(material.id)) {
        for (let index = consumed.length - 1; index >= 0; index -= 1) {
          this.inventory.acquire(consumed[index] as string);
        }
        this.gold.addGold(fee);
        return this.failure(recipeId, 'missing-materials');
      }
      consumed.push(material.id);
    }

    if (!this.deliver(recipeId as CraftedItemId)) {
      for (let index = consumed.length - 1; index >= 0; index -= 1) {
        this.inventory.acquire(consumed[index] as string);
      }
      this.gold.addGold(fee);
      return this.failure(recipeId, 'delivery-failed');
    }

    // 已消耗的层不能留下可退款的支付记录。
    if (this.payments) {
      for (const materialId of consumed) {
        this.payments.trimTo(materialId, this.inventory.stacksOf(materialId));
      }
    }

    return {
      ok: true,
      recipeId: recipeId as CraftedItemId,
      name: inspection.recipe.name,
      fee,
      goldBefore,
      goldAfter: this.gold.gold,
      materials: inspection.materials.map((material) => ({
        id: material.id,
        name: material.name,
        stacksBefore: material.stacksBefore,
        stacksAfter: this.inventory.stacksOf(material.id),
      })),
      crafted: this.crafted.snapshot(),
      inspection,
    };
  }
}

/** 净变化展示所需的当前聚合值；由场景从 `StatAggregator` 派生。 */
export interface CraftStatSnapshot {
  readonly maxHealth: number;
  readonly armor: number;
  readonly moveSpeed: number;
  readonly moveSpeedMultiplier: number;
  readonly attackSpeedMultiplier: number;
  readonly damageMultiplier: number;
  readonly directDamageMultiplier: number;
  readonly skillDamageMultiplier: number;
  readonly normalAttackDamageMultiplier: number;
  readonly cooldownReduction: number;
  readonly explosionRadiusMultiplier: number;
  readonly damageOverTimeMultiplier: number;
  readonly recipeDamageOverTimeMultiplier: number;
  readonly summonDamageMultiplier: number;
  readonly summonHealthMultiplier: number;
}

export interface CraftNetChangeLine {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  /** 带净值的单行文案，例如「最大生命 120 → 175（净 +55）」。 */
  readonly text: string;
  readonly net: number;
  readonly percent: boolean;
  /** 净值非负；用于决定正收益/代价配色。 */
  readonly positive: boolean;
}

function roundDisplay(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatSigned(value: number, percent: boolean): string {
  const rounded = percent ? Math.round(value * 100) : roundDisplay(value);
  const prefix = rounded > 0 ? '+' : '';
  return percent ? `${prefix}${rounded}%` : `${prefix}${rounded}`;
}

function positiveMultiplier(value: number): number {
  return Number.isFinite(value) ? Math.max(0.25, value) : 1;
}

/**
 * 把净修正换算成「当前值 → 合成后值」的可读行。
 * 百分比来源在同一属性内加算，因此直接用当前倍率 + 净值即可；
 * 最大生命/护甲按当前值加减平面值（当前版本没有最大生命的百分比来源）。
 */
export function formatCraftNetChanges(
  inspection: CraftInspection,
  input: CraftStatSnapshot,
): CraftNetChangeLine[] {
  const lines: CraftNetChangeLine[] = [];
  for (const change of inspection.statChanges) {
    const net = change.net;
    let before: string;
    let after: string;
    switch (change.stat) {
      case 'maxHealth':
        before = `${roundDisplay(input.maxHealth)}`;
        after = `${roundDisplay(Math.max(MIN_MAX_HEALTH, input.maxHealth + net))}`;
        break;
      case 'armor':
        before = `${roundDisplay(input.armor)}`;
        after = `${roundDisplay(clampArmor(input.armor + net))}`;
        break;
      case 'moveSpeed': {
        const multiplier = clampMoveSpeedMultiplier(
          input.moveSpeedMultiplier + net,
        );
        const base =
          input.moveSpeedMultiplier !== 0
            ? input.moveSpeed / input.moveSpeedMultiplier
            : input.moveSpeed;
        before = `${roundDisplay(input.moveSpeed)}`;
        after = `${roundDisplay(base * multiplier)}`;
        break;
      }
      case 'attackSpeed':
        before = formatPercent(input.attackSpeedMultiplier);
        after = formatPercent(
          clampAttackSpeedMultiplier(input.attackSpeedMultiplier + net),
        );
        break;
      case 'damage':
        before = formatPercent(input.damageMultiplier);
        after = formatPercent(
          clampDamageMultiplier(input.damageMultiplier + net),
        );
        break;
      case 'directDamage':
        before = formatPercent(input.directDamageMultiplier);
        after = formatPercent(
          positiveMultiplier(input.directDamageMultiplier + net),
        );
        break;
      case 'skillDamage':
        before = formatPercent(input.skillDamageMultiplier);
        after = formatPercent(
          clampDamageMultiplier(input.skillDamageMultiplier + net),
        );
        break;
      case 'normalAttackDamage':
        before = formatPercent(input.normalAttackDamageMultiplier);
        after = formatPercent(
          clampDamageMultiplier(input.normalAttackDamageMultiplier + net),
        );
        break;
      case 'cooldownReduction':
        before = formatPercent(input.cooldownReduction);
        after = formatPercent(clampCooldownReduction(input.cooldownReduction + net));
        break;
      case 'explosionRadius':
        before = formatPercent(input.explosionRadiusMultiplier);
        after = formatPercent(
          positiveMultiplier(input.explosionRadiusMultiplier + net),
        );
        break;
      case 'damageOverTime':
        before = formatPercent(input.damageOverTimeMultiplier);
        after = formatPercent(
          positiveMultiplier(input.damageOverTimeMultiplier + net),
        );
        break;
      case 'recipeDamageOverTime':
        before = formatPercent(input.recipeDamageOverTimeMultiplier);
        after = formatPercent(
          positiveMultiplier(input.recipeDamageOverTimeMultiplier + net),
        );
        break;
      case 'summonDamage':
        before = formatPercent(input.summonDamageMultiplier);
        after = formatPercent(
          positiveMultiplier(input.summonDamageMultiplier + net),
        );
        break;
      case 'summonHealth':
        before = formatPercent(input.summonHealthMultiplier);
        after = formatPercent(
          positiveMultiplier(input.summonHealthMultiplier + net),
        );
        break;
      default:
        before = '—';
        after = formatSigned(net, change.percent);
        break;
    }
    lines.push({
      label: change.label,
      before,
      after,
      text: `${change.label} ${before} → ${after}（净 ${formatSigned(net, change.percent)}）`,
      net,
      percent: change.percent,
      positive: net >= 0,
    });
  }
  return lines;
}
