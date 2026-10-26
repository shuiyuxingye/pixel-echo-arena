/**
 * 属性类海克斯的实际效果 H03/H04/H09/H10/H12/H15/H19/H20/H23（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/02-content-catalog.md` §48 种海克斯与
 * `01-systems-and-balance.md` §数值初值与上限：
 * - 属性修正统一走 `StatAggregator`；同属性百分比来源先加算，再与其他乘区相乘，
 *   每个海克斯只注册一次，重复读取层数不会二次放大；
 * - H10 的购物价格 −8% 与 H23 的药剂价格 +15% 走商店价格修正入口，
 *   在抽取货架时按百分点合并一次；
 * - H10 的击杀经验 −10% 由 `ProgressionSystem` 在经验球生成时应用；
 * - H12 的完成奖励 +15 金币在波末完成奖励结算时附加，只对 1–17 波生效；
 * - H20 的每秒回复 0.5 由本模块累计，按整点交给 `HealthState.heal`；
 * - 海克斯每种最高 1 层，本模块以「是否拥有」判定，不另存层数副本。
 */
import {
  consumableModifiersForH23,
  H23_POTION_EFFECT_PERCENT,
  H23_POTION_PRICE_PERCENT,
  type ConsumableModifiers,
} from './consumable-effects';
import type { ShopPriceModifiers } from './shop-offer';
import type { StatId, StatModifier } from './stats';

/** 本模块落地的 9 种属性类海克斯。其余 H01–H48 由后续故事按组接入。 */
export const ATTRIBUTE_HEX_IDS = [
  'H03',
  'H04',
  'H09',
  'H10',
  'H12',
  'H15',
  'H19',
  'H20',
  'H23',
] as const;

export type AttributeHexId = (typeof ATTRIBUTE_HEX_IDS)[number];

const ATTRIBUTE_HEX_ID_SET: ReadonlySet<string> = new Set(ATTRIBUTE_HEX_IDS);

export function isAttributeHexId(hexId: string): hexId is AttributeHexId {
  return ATTRIBUTE_HEX_ID_SET.has(hexId);
}

/**
 * 单张属性海克斯的数值。
 * 百分比字段以「百分点」书写（25 表示 +25%），与目录文案同口径；
 * flat 字段是直接加减的绝对值。商店/经验/奖励类字段不是战斗属性。
 */
export interface HexAttributeParams {
  readonly attackSpeedPercent?: number;
  readonly maxHealthFlat?: number;
  readonly maxHealthPercent?: number;
  readonly damagePercent?: number;
  readonly moveSpeedPercent?: number;
  readonly skillDamagePercent?: number;
  readonly armorFlat?: number;
  /** H10：购物价格折扣（正数表示降价百分点）。 */
  readonly shopDiscountPercent?: number;
  /** H10：击杀经验修正（−10 表示 −10%）。 */
  readonly killXpPercent?: number;
  /** H12：波次完成奖励的固定金币。 */
  readonly completionGoldFlat?: number;
  /** H15：弹体直径修正；半径与直径同比例，直接作用于 `projectileRadius`。 */
  readonly projectileRadiusPercent?: number;
  /** H20：每秒回复生命（整数点按累计值结算）。 */
  readonly regenPerSecond?: number;
  /** H23：药剂效果百分比，与 `consumable-effects` 的 H23 常量同源。 */
  readonly potionEffectPercent?: number;
  /** H23：药剂价格加价百分点。 */
  readonly potionPricePercent?: number;
}

/** 9 种属性类海克斯的数值；全部与 `02-content-catalog.md` 逐项对应。 */
export const HEX_ATTRIBUTE_PARAMS: Readonly<
  Record<AttributeHexId, HexAttributeParams>
> = {
  H03: { attackSpeedPercent: 25, maxHealthFlat: -20 },
  H04: { damagePercent: 25, moveSpeedPercent: -8 },
  H09: { skillDamagePercent: 30, armorFlat: -12 },
  H10: { shopDiscountPercent: 8, killXpPercent: -10 },
  H12: { completionGoldFlat: 15, moveSpeedPercent: -4 },
  H15: { projectileRadiusPercent: 35, attackSpeedPercent: -8 },
  H19: { damagePercent: 45, maxHealthPercent: -25, armorFlat: -10 },
  H20: { maxHealthFlat: 40, regenPerSecond: 0.5, damagePercent: -10 },
  H23: {
    potionEffectPercent: H23_POTION_EFFECT_PERCENT,
    potionPricePercent: H23_POTION_PRICE_PERCENT,
  },
};

function percentPoints(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value / 100 : 0;
}

function flat(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function pushModifier(
  modifiers: StatModifier[],
  stat: StatId,
  mode: 'flat' | 'percent',
  value: number,
): void {
  if (value !== 0) modifiers.push({ stat, mode, value });
}

/** 单张海克斯的属性修正；未知 ID 与非属性类海克斯返回空数组。 */
export function hexStatModifiers(hexId: string): StatModifier[] {
  if (!isAttributeHexId(hexId)) return [];
  const params = HEX_ATTRIBUTE_PARAMS[hexId];
  const modifiers: StatModifier[] = [];
  pushModifier(modifiers, 'attackSpeed', 'percent', percentPoints(params.attackSpeedPercent));
  pushModifier(modifiers, 'maxHealth', 'flat', flat(params.maxHealthFlat));
  pushModifier(modifiers, 'maxHealth', 'percent', percentPoints(params.maxHealthPercent));
  pushModifier(modifiers, 'damage', 'percent', percentPoints(params.damagePercent));
  pushModifier(modifiers, 'moveSpeed', 'percent', percentPoints(params.moveSpeedPercent));
  pushModifier(modifiers, 'skillDamage', 'percent', percentPoints(params.skillDamagePercent));
  pushModifier(modifiers, 'armor', 'flat', flat(params.armorFlat));
  pushModifier(
    modifiers,
    'projectileRadius',
    'percent',
    percentPoints(params.projectileRadiusPercent),
  );
  return modifiers;
}

/**
 * 已拥有海克斯集合的属性修正。重复 ID 只计一次，未知 ID 被忽略；
 * 调用方把这些修正放进同一个 `stats.setSource`，由聚合器统一钳制与加算。
 */
export function ownedHexStatModifiers(
  ownedIds: Iterable<string>,
): StatModifier[] {
  const seen = new Set<string>();
  const modifiers: StatModifier[] = [];
  for (const hexId of ownedIds) {
    if (seen.has(hexId) || !isAttributeHexId(hexId)) continue;
    seen.add(hexId);
    modifiers.push(...hexStatModifiers(hexId));
  }
  return modifiers;
}

/** 属性类海克斯的实时状态；拥有关系由 `HexRun` 单一真源提供。 */
export interface HexEffectsConfig {
  readonly has: (hexId: string) => boolean;
}

/** 开发快照用：价格/经验/奖励/回复的当前修正。 */
export interface HexEffectsSnapshot {
  readonly attributeHexes: readonly string[];
  readonly shopDiscountPercent: number;
  readonly killXpMultiplier: number;
  readonly completionGoldBonus: number;
  readonly potionEffectMultiplier: number;
  readonly potionPriceSurchargePercent: number;
  readonly regenPerSecond: number;
  readonly regenBudget: number;
}

/**
 * 一局内的属性海克斯效果。所有派生值在读取时按当前拥有集合计算，
 * 不缓存副本；H20 的回复预算在 `step` 中累计。
 */
export class HexEffects {
  private readonly hasHex: (hexId: string) => boolean;
  private regenBudgetValue = 0;

  constructor(config: HexEffectsConfig) {
    this.hasHex = config.has;
  }

  /** 当前拥有的属性类海克斯，保持目录顺序。 */
  get ownedAttributeIds(): AttributeHexId[] {
    return ATTRIBUTE_HEX_IDS.filter((hexId) => this.hasHex(hexId));
  }

  has(hexId: string): boolean {
    return this.hasHex(hexId);
  }

  /** H03/H04/H09/H15/H19/H20 的战斗属性；H10/H12/H23 不在伤害通道。 */
  get statModifiers(): StatModifier[] {
    return ownedHexStatModifiers(this.ownedAttributeIds);
  }

  /** H10 购物价格 −8%；在货架抽取时与其他价格修正合并一次。 */
  get shopPriceModifiers(): ShopPriceModifiers {
    const discount = this.has('H10')
      ? HEX_ATTRIBUTE_PARAMS.H10.shopDiscountPercent ?? 0
      : 0;
    return discount > 0 ? { discountPercent: discount } : {};
  }

  /** H23 药剂价格 +15%；只作用于药剂，与通用折扣按百分点合并。 */
  get potionPriceModifiers(): ShopPriceModifiers {
    const surcharge = this.has('H23')
      ? HEX_ATTRIBUTE_PARAMS.H23.potionPricePercent ?? 0
      : 0;
    return surcharge > 0 ? { surchargePercent: surcharge } : {};
  }

  /** H23 药剂效果 +30%；购买时快照进本次购买。 */
  get potionModifiers(): ConsumableModifiers {
    return consumableModifiersForH23(this.has('H23') ? 1 : 0);
  }

  /** H10 击杀经验 −10%；其余情况为 1。 */
  get killXpMultiplier(): number {
    if (!this.has('H10')) return 1;
    const ratio = 1 + percentPoints(HEX_ATTRIBUTE_PARAMS.H10.killXpPercent);
    return Number.isFinite(ratio) && ratio >= 0 ? ratio : 1;
  }

  /** H12 波次完成奖励 +15 金币；未拥有时为 0。 */
  get completionGoldBonus(): number {
    return this.has('H12')
      ? Math.max(0, HEX_ATTRIBUTE_PARAMS.H12.completionGoldFlat ?? 0)
      : 0;
  }

  /** H20 每秒回复生命；未拥有时为 0。 */
  get regenPerSecond(): number {
    return this.has('H20')
      ? Math.max(0, HEX_ATTRIBUTE_PARAMS.H20.regenPerSecond ?? 0)
      : 0;
  }

  /**
   * 推进 H20 的每秒回复。返回本步应回复的整点生命；不足 1 点留到下一步，
   * 与 P07 的回复预算同口径，避免逐帧产生小数生命。
   */
  step(seconds: number): number {
    const rate = this.regenPerSecond;
    if (rate <= 0 || !Number.isFinite(seconds) || seconds <= 0) return 0;
    this.regenBudgetValue += rate * seconds;
    const whole = Math.floor(this.regenBudgetValue + 1e-6);
    if (whole <= 0) return 0;
    this.regenBudgetValue -= whole;
    return whole;
  }

  /** 新开一局：清空回复预算；拥有集合由 `HexRun` 恢复，不在此重置。 */
  reset(): void {
    this.regenBudgetValue = 0;
  }

  snapshot(): HexEffectsSnapshot {
    return {
      attributeHexes: this.ownedAttributeIds,
      shopDiscountPercent: this.has('H10')
        ? HEX_ATTRIBUTE_PARAMS.H10.shopDiscountPercent ?? 0
        : 0,
      killXpMultiplier: this.killXpMultiplier,
      completionGoldBonus: this.completionGoldBonus,
      potionEffectMultiplier: this.potionModifiers.effectMultiplier,
      potionPriceSurchargePercent: this.potionModifiers.priceSurchargePercent,
      regenPerSecond: this.regenPerSecond,
      regenBudget: this.regenBudgetValue,
    };
  }
}
