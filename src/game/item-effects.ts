/**
 * 永久商店道具 I01–I24 的实际效果（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/data/catalog.json` 与 `01-systems-and-balance.md` §商店：
 * - 每层按目录数值叠加，收益与代价同时生效；叠层上限由目录决定；
 * - 属性类效果只注册 `StatModifier`，由 `StatAggregator` 统一聚合，
 *   不直接改写角色或生命对象；
 * - I09 每 5 秒回复、I10 造成伤害吸血（每秒上限 4×层数）、
 *   I12 静止 0.8 秒后增伤、I18 受击后下次 J 增伤、I21 每 6 次 J 命中弹射
 *   与 I23 每波首次低血护盾需要临时状态，由本模块按固定逻辑步推进；
 * - I24 的“每第 5 次爆炸”状态由 `GrenadeSystem` 维护，本模块只提供参数；
 * - 商店/宝箱卡面用 `previewItemCard` 展示聚合后的真实当前值 → 购买后值，
 *   不重复目录的收益/代价文案。
 */
import { getShopItem } from './data';
import { sustainedChannelNote } from './damage-channel';
import {
  ATTACK_RANGE_MIN,
  LIFESTEAL_CAP,
  LifestealTracker,
  MIN_MAX_HEALTH,
  PROJECTILE_RADIUS_MIN,
  clampArmor,
  clampAttackSpeedMultiplier,
  clampCooldownReduction,
  clampDamageMultiplier,
  clampMoveSpeedMultiplier,
  type StatModifier,
} from './stats';

/** 本模块负责的永久道具；I01–I12 普通、I13–I24 稀有/史诗。 */
export const ITEM_EFFECT_IDS = [
  'I01',
  'I02',
  'I03',
  'I04',
  'I05',
  'I06',
  'I07',
  'I08',
  'I09',
  'I10',
  'I11',
  'I12',
  'I13',
  'I14',
  'I15',
  'I16',
  'I17',
  'I18',
  'I19',
  'I20',
  'I21',
  'I22',
  'I23',
  'I24',
] as const;

export type ItemEffectId = (typeof ITEM_EFFECT_IDS)[number];

const ITEM_EFFECT_ID_SET: ReadonlySet<string> = new Set(ITEM_EFFECT_IDS);

export function isItemEffectId(itemId: string): itemId is ItemEffectId {
  return ITEM_EFFECT_ID_SET.has(itemId);
}

/** 单层效果；百分比以 0.1 表示 10%，与 `StatModifier.percent` 同口径。 */
export interface ItemEffectParams {
  readonly maxHealthFlat?: number;
  readonly armorFlat?: number;
  readonly damagePercent?: number;
  readonly attackSpeedPercent?: number;
  readonly moveSpeedPercent?: number;
  readonly cooldownReductionPercent?: number;
  readonly attackRangePercent?: number;
  readonly projectileRadiusPercent?: number;
  readonly skillDamagePercent?: number;
  readonly normalAttackDamagePercent?: number;
  /** I15：技能持续时间。 */
  readonly skillDurationPercent?: number;
  /** I15：技能冷却惩罚（正数延长冷却）。 */
  readonly skillCooldownPercent?: number;
  /** I13：爆炸半径。 */
  readonly explosionRadiusPercent?: number;
  /** I13：爆炸伤害。 */
  readonly explosionDamagePercent?: number;
  /** I16：持续伤害。 */
  readonly damageOverTimePercent?: number;
  /** I16：直接伤害；只作用于直击，不并入全局 `damage`。 */
  readonly directDamagePercent?: number;
  /** I17：经验吸取半径。 */
  readonly xpRadiusPercent?: number;
  /** I17：击杀金币。 */
  readonly killGoldPercent?: number;
  /** I19：召唤物伤害。 */
  readonly summonDamagePercent?: number;
  /** I20：召唤物生命上限。 */
  readonly summonHealthPercent?: number;
  /** I20：召唤物每秒回复最大生命的比例。 */
  readonly summonRegenPercentPerSecond?: number;
  /** I23：恢复效果。 */
  readonly healingEffectPercent?: number;
  /** I22：波次完成奖励金币。 */
  readonly completionGoldPercent?: number;
  /** I24：爆炸技能冷却惩罚。 */
  readonly explosionSkillCooldownPercent?: number;
  /** I09：每 5 秒回复的生命。 */
  readonly healPerFiveSeconds?: number;
  /** I10：造成伤害转为治疗的比例。 */
  readonly lifestealPercent?: number;
  /** I10：每秒基础治疗上限（每层）。 */
  readonly lifestealCapPerSecond?: number;
  /** I12：需要保持静止的秒数。 */
  readonly stationarySeconds?: number;
  /** I12：满足静止条件后的伤害加成。 */
  readonly stationaryDamagePercent?: number;
  /** I14：每层追加的非穿透 J 弹数量。 */
  readonly extraProjectileCount?: number;
  /** I14：追加弹的伤害比例。 */
  readonly extraProjectileDamageRatio?: number;
  /** I18：受击后下次 J 的增伤。 */
  readonly nextJDamagePercent?: number;
  /** I18：内置冷却（秒）。 */
  readonly internalCooldownSeconds?: number;
  /** I21：每 N 次 J 命中触发一次弹射。 */
  readonly ricochetEvery?: number;
  /** I21：弹射伤害比例（法伤）。 */
  readonly ricochetDamageRatio?: number;
  /** I23：触发护盾的生命比例阈值。 */
  readonly lowHealthThreshold?: number;
  /** I23：护盾量（每层）。 */
  readonly lowHealthShield?: number;
  /** I23：护盾持续秒数。 */
  readonly shieldDurationSeconds?: number;
  /** I22：从普通池转移的权重百分点（每层）。 */
  readonly shopWeightTransfer?: number;
  /** I24：每 N 次爆炸触发一次小爆炸。 */
  readonly fissionEvery?: number;
  /** I24：小爆炸的伤害比例。 */
  readonly fissionDamagePercent?: number;
}

/**
 * I01–I24 每层数值；与 `catalog.json` 的 benefit/cost 文案逐项对应。
 * 新增/调整数值只改这张表，属性注册、卡面预览与构筑面板同源读取。
 */
export const ITEM_EFFECT_PARAMS: Readonly<Record<ItemEffectId, ItemEffectParams>> = {
  I01: { maxHealthFlat: 25, moveSpeedPercent: -0.03 },
  I02: { damagePercent: 0.15, attackSpeedPercent: -0.06 },
  I03: { attackSpeedPercent: 0.18, damagePercent: -0.06 },
  I04: { projectileRadiusPercent: 0.2, attackRangePercent: -0.1 },
  I05: { attackRangePercent: 0.15, moveSpeedPercent: -0.02 },
  I06: { armorFlat: 12, attackSpeedPercent: -0.05 },
  I07: { skillDamagePercent: 0.2, normalAttackDamagePercent: -0.08 },
  I08: { cooldownReductionPercent: 0.08, maxHealthFlat: -10 },
  I09: { damagePercent: -0.04, healPerFiveSeconds: 4 },
  I10: { armorFlat: -5, lifestealPercent: 0.02, lifestealCapPerSecond: 4 },
  I11: { moveSpeedPercent: 0.1, armorFlat: -4 },
  I12: { moveSpeedPercent: -0.05, stationarySeconds: 0.8, stationaryDamagePercent: 0.18 },
  I13: { explosionRadiusPercent: 0.18, explosionDamagePercent: -0.05 },
  I14: { extraProjectileCount: 1, extraProjectileDamageRatio: 0.35, attackSpeedPercent: -0.1 },
  I15: { skillDurationPercent: 0.15, skillCooldownPercent: 0.05 },
  I16: { damageOverTimePercent: 0.25, directDamagePercent: -0.05 },
  I17: { xpRadiusPercent: 0.4, killGoldPercent: 0.08, maxHealthFlat: -10 },
  I18: { nextJDamagePercent: 0.6, internalCooldownSeconds: 4, moveSpeedPercent: -0.04 },
  I19: { summonDamagePercent: 0.18, normalAttackDamagePercent: -0.05 },
  I20: {
    summonHealthPercent: 0.25,
    summonRegenPercentPerSecond: 0.01,
    maxHealthFlat: -10,
  },
  I21: { ricochetEvery: 6, ricochetDamageRatio: 0.4, normalAttackDamagePercent: -0.05 },
  I22: { shopWeightTransfer: 12, completionGoldPercent: -0.15 },
  I23: {
    lowHealthThreshold: 0.3,
    lowHealthShield: 35,
    shieldDurationSeconds: 5,
    healingEffectPercent: -0.1,
  },
  I24: { fissionEvery: 5, fissionDamagePercent: 0.45, explosionSkillCooldownPercent: 0.08 },
};

function stacksCount(stacks: number): number {
  return Number.isFinite(stacks) ? Math.max(0, Math.floor(stacks)) : 0;
}

/**
 * 把一件道具的层数展开成属性修正。I09/I10/I12/I18/I21/I23 的非属性效果
 * （周期回复、吸血、静止增伤、受击强化、J 命中弹射、低血护盾）不在这里注册，
 * 由 `ItemEffects` 推进；I24 的爆炸计数由 `GrenadeSystem` 维护。
 */
export function itemStatModifiers(itemId: string, stacks: number): StatModifier[] {
  if (!isItemEffectId(itemId)) return [];
  const count = stacksCount(stacks);
  if (count <= 0) return [];
  const params = ITEM_EFFECT_PARAMS[itemId];
  const modifiers: StatModifier[] = [];
  const flat = (stat: StatModifier['stat'], value: number | undefined): void => {
    if (value === undefined || value === 0) return;
    modifiers.push({ stat, mode: 'flat', value: value * count });
  };
  const percent = (stat: StatModifier['stat'], value: number | undefined): void => {
    if (value === undefined || value === 0) return;
    modifiers.push({ stat, mode: 'percent', value: value * count });
  };

  flat('maxHealth', params.maxHealthFlat);
  flat('armor', params.armorFlat);
  percent('damage', params.damagePercent);
  percent('attackSpeed', params.attackSpeedPercent);
  percent('moveSpeed', params.moveSpeedPercent);
  percent('cooldownReduction', params.cooldownReductionPercent);
  percent('attackRange', params.attackRangePercent);
  percent('projectileRadius', params.projectileRadiusPercent);
  percent('skillDamage', params.skillDamagePercent);
  percent('normalAttackDamage', params.normalAttackDamagePercent);
  percent('lifesteal', params.lifestealPercent);
  percent('skillDuration', params.skillDurationPercent);
  percent('skillCooldown', params.skillCooldownPercent);
  percent('explosionRadius', params.explosionRadiusPercent);
  percent('explosionDamage', params.explosionDamagePercent);
  percent('damageOverTime', params.damageOverTimePercent);
  // I16 的直接伤害代价单独成键，只由直击通道读取；持续通道不承担 −5%。
  percent('directDamage', params.directDamagePercent);
  percent('xpRadius', params.xpRadiusPercent);
  percent('killGold', params.killGoldPercent);
  percent('summonDamage', params.summonDamagePercent);
  percent('summonHealth', params.summonHealthPercent);
  percent('healingEffect', params.healingEffectPercent);
  percent('completionGold', params.completionGoldPercent);
  percent('explosionSkillCooldown', params.explosionSkillCooldownPercent);
  return modifiers;
}

/** 构筑面板用的一行实际贡献；只显示该件道具自身提供的数值。 */
export function describeItemEffect(
  itemId: string,
  stacks: number,
  options: {
    /** 当前装备的自由技能 ID；用于写明持续伤害是否真的有来源。 */
    readonly sustainedSkillIds?: readonly string[];
  } = {},
): string {
  if (!isItemEffectId(itemId)) return '';
  const count = stacksCount(stacks);
  if (count <= 0) return '';
  const params = ITEM_EFFECT_PARAMS[itemId];
  const benefits: string[] = [];
  const costs: string[] = [];
  const push = (value: number, text: string): void => {
    (value > 0 ? benefits : costs).push(text);
  };
  const signed = (value: number, suffix = ''): string =>
    `${value > 0 ? '+' : ''}${formatNumber(value)}${suffix}`;
  const percent = (value: number | undefined, label: string): void => {
    if (value === undefined || value === 0) return;
    push(value, `${label} ${signed(value * count * 100)}%`);
  };
  const flat = (value: number | undefined, label: string): void => {
    if (value === undefined || value === 0) return;
    push(value, `${label} ${signed(value * count)}`);
  };

  flat(params.maxHealthFlat, '最大生命');
  flat(params.armorFlat, '护甲');
  percent(params.damagePercent, '伤害');
  percent(params.attackSpeedPercent, '攻速');
  percent(params.moveSpeedPercent, '移速');
  percent(params.cooldownReductionPercent, '冷却缩减');
  percent(params.attackRangePercent, '射程');
  percent(params.projectileRadiusPercent, '弹体直径');
  percent(params.skillDamagePercent, '技能伤害');
  percent(params.normalAttackDamagePercent, 'J 伤害');
  percent(params.skillDurationPercent, '技能持续时间');
  percent(params.explosionRadiusPercent, '爆炸半径');
  percent(params.explosionDamagePercent, '爆炸伤害');
  percent(
    params.damageOverTimePercent,
    `持续伤害（${sustainedChannelNote(options.sustainedSkillIds)}）`,
  );
  percent(params.directDamagePercent, '直接伤害');
  percent(params.xpRadiusPercent, '经验吸取半径');
  percent(params.killGoldPercent, '击杀金币');
  percent(params.summonDamagePercent, '召唤物伤害');
  percent(params.summonHealthPercent, '召唤物生命');
  percent(params.healingEffectPercent, '恢复效果');
  percent(params.completionGoldPercent, '完成奖励金币');
  // 冷却惩罚虽然数值为正，仍是明确代价：始终列入 cost。
  if (params.skillCooldownPercent) {
    costs.push(`技能冷却 ${signed(params.skillCooldownPercent * count * 100)}%`);
  }
  if (params.explosionSkillCooldownPercent) {
    costs.push(
      `爆炸技能冷却 ${signed(params.explosionSkillCooldownPercent * count * 100)}%`,
    );
  }
  if (params.healPerFiveSeconds) {
    push(params.healPerFiveSeconds, `每 5 秒回复 ${signed(params.healPerFiveSeconds * count)}`);
  }
  if (params.lifestealPercent) {
    push(
      params.lifestealPercent,
      `吸血 ${signed(params.lifestealPercent * count * 100)}%` +
        `（每秒上限 ${formatNumber((params.lifestealCapPerSecond ?? 0) * count)}）`,
    );
  }
  if (params.stationaryDamagePercent) {
    push(
      params.stationaryDamagePercent,
      `静止 ${formatNumber(params.stationarySeconds ?? 0)} 秒后伤害 ${signed(params.stationaryDamagePercent * count * 100)}%`,
    );
  }
  if (params.extraProjectileCount) {
    push(
      params.extraProjectileCount,
      `额外 J 弹 +${formatNumber(params.extraProjectileCount * count)} 枚` +
        `（${formatNumber((params.extraProjectileDamageRatio ?? 0) * 100)}% 伤害）`,
    );
  }
  if (params.nextJDamagePercent) {
    push(
      params.nextJDamagePercent,
      `受击后下次 J ${signed(params.nextJDamagePercent * count * 100)}%` +
        `（冷却 ${formatNumber(params.internalCooldownSeconds ?? 0)} 秒）`,
    );
  }
  if (params.ricochetEvery) {
    push(
      params.ricochetDamageRatio ?? 0,
      `每 ${formatNumber(params.ricochetEvery)} 次 J 命中弹射` +
        ` ${signed((params.ricochetDamageRatio ?? 0) * 100)}% 法伤`,
    );
  }
  if (params.lowHealthShield) {
    push(
      params.lowHealthShield,
      `每波首次降至 ${formatNumber((params.lowHealthThreshold ?? 0) * 100)}% 生命获得` +
        ` ${formatNumber(params.lowHealthShield * count)} 护盾` +
        ` ${formatNumber(params.shieldDurationSeconds ?? 0)} 秒`,
    );
  }
  if (params.shopWeightTransfer) {
    push(
      params.shopWeightTransfer,
      `商店稀有/史诗权重 +${formatNumber(params.shopWeightTransfer * count)} 点`,
    );
  }
  if (params.summonRegenPercentPerSecond) {
    push(
      params.summonRegenPercentPerSecond,
      `召唤物每秒回复 ${formatNumber(params.summonRegenPercentPerSecond * count * 100)}%`,
    );
  }
  if (params.fissionEvery) {
    push(
      params.fissionDamagePercent ?? 0,
      `每 ${formatNumber(params.fissionEvery)} 次爆炸追加` +
        ` ${signed((params.fissionDamagePercent ?? 0) * 100)}% 伤害小爆炸`,
    );
  }
  return [...benefits, ...costs].join(' / ');
}

/** 卡面预览所需的当前聚合值；由场景从 `StatAggregator` 与道具账本派生。 */
export interface ItemPreviewInput {
  readonly maxHealth: number;
  readonly armor: number;
  readonly moveSpeed: number;
  readonly moveSpeedMultiplier: number;
  readonly attackSpeedMultiplier: number;
  readonly damageMultiplier: number;
  /** 当前直击倍率（I16 直接伤害修正）；I16 卡面用。 */
  readonly directDamageMultiplier?: number;
  readonly skillDamageMultiplier: number;
  readonly normalAttackDamageMultiplier: number;
  readonly cooldownReduction: number;
  /** 当前 J 射程（已含道具修正）。 */
  readonly attackRange: number;
  readonly attackRangeMultiplier: number;
  /** 当前弹体直径（已含道具修正）。 */
  readonly projectileDiameter: number;
  readonly projectileRadiusMultiplier: number;
  /** I09 当前每 5 秒回复总量（含已有层数）。 */
  readonly healPerFiveSeconds: number;
  /** I10 当前吸血比例与每秒上限（含已有层数）。 */
  readonly lifesteal: number;
  readonly lifestealCapPerSecond: number;
  /** I12 当前静止增伤加成（含已有层数，不要求此刻静止）。 */
  readonly stationaryDamageBonus: number;
  /** I15 当前技能持续时间倍率。 */
  readonly skillDurationMultiplier?: number;
  /** I15 当前技能冷却惩罚倍率。 */
  readonly skillCooldownMultiplier?: number;
  /** I13 当前爆炸半径（像素）与半径倍率。 */
  readonly explosionRadius?: number;
  readonly explosionRadiusMultiplier?: number;
  /** I13 当前爆炸伤害倍率。 */
  readonly explosionDamageMultiplier?: number;
  /** I16 当前持续伤害倍率。 */
  readonly damageOverTimeMultiplier?: number;
  /** 当前装备的自由技能 ID；I16 卡面据此写明持续来源。 */
  readonly sustainedSkillIds?: readonly string[];
  /** I17 当前经验吸取半径（像素）。 */
  readonly xpPickupRadius?: number;
  /** I17 当前击杀金币倍率。 */
  readonly killGoldMultiplier?: number;
  /** I19 当前召唤物伤害倍率。 */
  readonly summonDamageMultiplier?: number;
  /** I20 当前召唤物生命上限倍率。 */
  readonly summonHealthMultiplier?: number;
  /** I22 当前完成奖励金币倍率。 */
  readonly completionGoldMultiplier?: number;
}

export interface ItemCardPreview {
  /** 正收益的当前值 → 购买后值。 */
  readonly benefit: string;
  /** 代价的当前值 → 购买后值。 */
  readonly cost: string;
  /** 两行合并；旧卡面/开发文本使用。 */
  readonly detail: string;
  /** true 表示这些是聚合后的实时数值，而不是目录原文。 */
  readonly previewed: boolean;
}

interface PreviewLine {
  readonly text: string;
  /** 正收益归入 benefit，负收益归入 cost。 */
  readonly positive: boolean;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

function percentValue(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function percentLine(
  label: string,
  current: number,
  delta: number,
  clampNext?: (value: number) => number,
): PreviewLine {
  const next = current + delta;
  return {
    text: `${label} ${percentValue(current)} → ${percentValue(
      clampNext ? clampNext(next) : next,
    )}`,
    positive: delta >= 0,
  };
}

function actualLine(
  label: string,
  current: number,
  currentMultiplier: number,
  delta: number,
  clampMultiplier?: (value: number) => number,
): PreviewLine {
  const base =
    Number.isFinite(currentMultiplier) && currentMultiplier !== 0
      ? current / currentMultiplier
      : current;
  const nextMultiplier = clampMultiplier
    ? clampMultiplier(currentMultiplier + delta)
    : currentMultiplier + delta;
  const next = base * nextMultiplier;
  return {
    text: `${label} ${formatNumber(current)} → ${formatNumber(next)}`,
    positive: delta >= 0,
  };
}

function flatLine(
  label: string,
  current: number,
  delta: number,
  clampNext?: (value: number) => number,
): PreviewLine {
  const next = current + delta;
  return {
    text: `${label} ${formatNumber(current)} → ${formatNumber(
      clampNext ? clampNext(next) : next,
    )}`,
    positive: delta >= 0,
  };
}

/**
 * 一张道具卡的实时预览：当前聚合值 → 购买 1 层后的值。
 * `stacks` 为购买前层数；未知或非本模块道具回退到目录文案。
 */
export function previewItemCard(
  itemId: string,
  stacks: number,
  input: ItemPreviewInput,
): ItemCardPreview | null {
  if (!isItemEffectId(itemId)) {
    const item = getShopItem(itemId);
    if (!item) return null;
    return {
      benefit: item.benefit,
      cost: item.cost,
      detail: `${item.benefit}；${item.cost}`,
      previewed: false,
    };
  }

  const params = ITEM_EFFECT_PARAMS[itemId];
  const lines: PreviewLine[] = [];
  const percent = (
    label: string,
    value: number | undefined,
    current: number,
    clampNext?: (value: number) => number,
  ): void => {
    if (value === undefined || value === 0) return;
    lines.push(percentLine(label, current, value, clampNext));
  };
  const flat = (
    label: string,
    value: number | undefined,
    current: number,
    clampNext?: (value: number) => number,
  ): void => {
    if (value === undefined || value === 0) return;
    lines.push(flatLine(label, current, value, clampNext));
  };
  const actual = (
    label: string,
    value: number | undefined,
    current: number,
    multiplier: number,
    clampMultiplier?: (value: number) => number,
  ): void => {
    if (value === undefined || value === 0) return;
    lines.push(actualLine(label, current, multiplier, value, clampMultiplier));
  };

  flat('最大生命', params.maxHealthFlat, input.maxHealth, (value) =>
    Math.max(MIN_MAX_HEALTH, value),
  );
  flat('护甲', params.armorFlat, input.armor, clampArmor);
  actual(
    '移速',
    params.moveSpeedPercent,
    input.moveSpeed,
    input.moveSpeedMultiplier,
    clampMoveSpeedMultiplier,
  );
  percent('攻速', params.attackSpeedPercent, input.attackSpeedMultiplier, (value) =>
    clampAttackSpeedMultiplier(value),
  );
  percent('伤害', params.damagePercent, input.damageMultiplier, (value) =>
    clampDamageMultiplier(value),
  );
  percent('技能伤害', params.skillDamagePercent, input.skillDamageMultiplier, (value) =>
    clampDamageMultiplier(value),
  );
  percent(
    'J 伤害',
    params.normalAttackDamagePercent,
    input.normalAttackDamageMultiplier,
    (value) => clampDamageMultiplier(value),
  );
  actual(
    '射程',
    params.attackRangePercent,
    input.attackRange,
    input.attackRangeMultiplier,
    (value) => Math.max(ATTACK_RANGE_MIN, value),
  );
  actual(
    '弹体直径',
    params.projectileRadiusPercent,
    input.projectileDiameter,
    input.projectileRadiusMultiplier,
    (value) => Math.max(PROJECTILE_RADIUS_MIN, value),
  );
  percent(
    '冷却缩减',
    params.cooldownReductionPercent,
    input.cooldownReduction,
    (value) => clampCooldownReduction(value),
  );
  if (params.healPerFiveSeconds) {
    lines.push(
      flatLine('每 5 秒回复', input.healPerFiveSeconds, params.healPerFiveSeconds),
    );
  }
  if (params.lifestealPercent) {
    lines.push(
      percentLine('吸血', input.lifesteal, params.lifestealPercent, (value) =>
        Math.min(LIFESTEAL_CAP, value),
      ),
    );
    lines.push(
      flatLine(
        '每秒吸血上限',
        input.lifestealCapPerSecond,
        params.lifestealCapPerSecond ?? 0,
      ),
    );
  }
  if (params.stationaryDamagePercent) {
    lines.push(
      percentLine(
        '静止增伤',
        input.stationaryDamageBonus,
        params.stationaryDamagePercent,
      ),
    );
  }
  if (
    params.skillDurationPercent &&
    input.skillDurationMultiplier !== undefined
  ) {
    lines.push(
      percentLine(
        '技能持续时间',
        input.skillDurationMultiplier,
        params.skillDurationPercent,
      ),
    );
  }
  if (params.skillCooldownPercent && input.skillCooldownMultiplier !== undefined) {
    lines.push({
      ...percentLine(
        '技能冷却',
        input.skillCooldownMultiplier,
        params.skillCooldownPercent,
      ),
      positive: false,
    });
  }
  if (
    params.explosionRadiusPercent &&
    input.explosionRadius !== undefined &&
    input.explosionRadiusMultiplier !== undefined
  ) {
    lines.push(
      actualLine(
        '爆炸半径',
        input.explosionRadius,
        input.explosionRadiusMultiplier,
        params.explosionRadiusPercent,
      ),
    );
  }
  if (
    params.explosionDamagePercent &&
    input.explosionDamageMultiplier !== undefined
  ) {
    lines.push(
      percentLine(
        '爆炸伤害',
        input.explosionDamageMultiplier,
        params.explosionDamagePercent,
        (value) => clampDamageMultiplier(value),
      ),
    );
  }
  if (
    params.damageOverTimePercent &&
    input.damageOverTimeMultiplier !== undefined
  ) {
    const line = percentLine(
      '持续伤害',
      input.damageOverTimeMultiplier,
      params.damageOverTimePercent,
    );
    lines.push({
      ...line,
      text: `${line.text}（${sustainedChannelNote(input.sustainedSkillIds)}）`,
    });
  }
  if (params.directDamagePercent) {
    const current = input.directDamageMultiplier ?? input.damageMultiplier;
    lines.push(percentLine('直接伤害', current, params.directDamagePercent));
  }
  if (params.xpRadiusPercent && input.xpPickupRadius !== undefined) {
    lines.push(
      actualLine('经验吸取半径', input.xpPickupRadius, 1, params.xpRadiusPercent),
    );
  }
  if (params.killGoldPercent && input.killGoldMultiplier !== undefined) {
    lines.push(percentLine('击杀金币', input.killGoldMultiplier, params.killGoldPercent));
  }
  if (
    params.summonDamagePercent &&
    input.summonDamageMultiplier !== undefined
  ) {
    lines.push(
      percentLine(
        '召唤物伤害',
        input.summonDamageMultiplier,
        params.summonDamagePercent,
      ),
    );
  }
  if (
    params.summonHealthPercent &&
    input.summonHealthMultiplier !== undefined
  ) {
    lines.push(
      percentLine(
        '召唤物生命',
        input.summonHealthMultiplier,
        params.summonHealthPercent,
      ),
    );
  }
  if (params.summonRegenPercentPerSecond) {
    const current = params.summonRegenPercentPerSecond * stacksCount(stacks);
    lines.push(
      percentLine(
        '召唤物每秒回复',
        current,
        params.summonRegenPercentPerSecond,
      ),
    );
  }
  if (params.healingEffectPercent) {
    lines.push(
      percentLine(
        '恢复效果',
        1 + params.healingEffectPercent * stacksCount(stacks),
        params.healingEffectPercent,
      ),
    );
  }
  if (params.completionGoldPercent && input.completionGoldMultiplier !== undefined) {
    lines.push(
      percentLine(
        '完成奖励金币',
        input.completionGoldMultiplier,
        params.completionGoldPercent,
      ),
    );
  }
  if (params.explosionSkillCooldownPercent) {
    lines.push({
      ...percentLine('爆炸技能冷却', 1, params.explosionSkillCooldownPercent),
      positive: false,
    });
  }
  if (params.extraProjectileCount) {
    lines.push(
      flatLine(
        '额外 J 弹',
        params.extraProjectileCount * stacksCount(stacks),
        params.extraProjectileCount,
      ),
    );
  }
  if (params.nextJDamagePercent) {
    lines.push(
      percentLine(
        '受击后下次 J 增伤',
        params.nextJDamagePercent * stacksCount(stacks),
        params.nextJDamagePercent,
      ),
    );
  }
  if (params.ricochetEvery) {
    lines.push({
      text:
        `每 ${formatNumber(params.ricochetEvery)} 次 J 命中弹射` +
        ` ${percentValue(params.ricochetDamageRatio ?? 0)} 法伤`,
      positive: true,
    });
  }
  if (params.lowHealthShield) {
    lines.push(
      flatLine(
        '低血护盾',
        params.lowHealthShield * stacksCount(stacks),
        params.lowHealthShield,
      ),
    );
    lines.push({
      text:
        `每波首次降至 ${percentValue(params.lowHealthThreshold ?? 0)} 生命触发，` +
        `持续 ${formatNumber(params.shieldDurationSeconds ?? 0)} 秒`,
      positive: true,
    });
  }
  if (params.shopWeightTransfer) {
    lines.push(
      flatLine(
        '稀有/史诗权重',
        params.shopWeightTransfer * stacksCount(stacks),
        params.shopWeightTransfer,
      ),
    );
  }
  if (params.fissionEvery) {
    lines.push({
      text:
        `每 ${formatNumber(params.fissionEvery)} 次爆炸追加` +
        ` ${percentValue(params.fissionDamagePercent ?? 0)} 伤害小爆炸`,
      positive: true,
    });
  }

  // 购买后始终只加 1 层；`stacks` 已用于上面按现有层数计算的触发型数值。
  const benefits = lines.filter((line) => line.positive).map((line) => line.text);
  const costs = lines.filter((line) => !line.positive).map((line) => line.text);
  const benefit = benefits.length > 0 ? benefits.join('；') : '无新增收益';
  const cost = costs.length > 0 ? costs.join('；') : '无新增代价';
  return {
    benefit,
    cost,
    detail: `${benefit}；${cost}`,
    previewed: true,
  };
}

/** 固定逻辑步内的道具临时状态结果。 */
export interface ItemStepResult {
  /** 本步累计的周期回复量（已乘层数，未乘治疗效果修正）。 */
  readonly regenHeal: number;
  /** 本步结束时是否满足 I12 的静止条件。 */
  readonly stationary: boolean;
  /** I23 护盾到期时需从玩家护盾中移除的量；未到期为 0。 */
  readonly shieldExpired: number;
}

export interface ItemEffectsConfig {
  /** 道具层数只读查询口，通常直接传 `ItemInventory.stacksOf`。 */
  readonly stacksOf: (itemId: string) => number;
}

/** I09 的回复周期（秒）。 */
export const ITEM_REGEN_INTERVAL_SECONDS = 5;

const TIME_EPSILON = 1e-9;

/**
 * 道具临时状态：I09 周期回复、I10 吸血预算与 I12 连续静止计时。
 * 层数真源仍在 `ItemInventory`，这里不保存副本。
 */
export class ItemEffects {
  private readonly stacksOfValue: (itemId: string) => number;
  private readonly lifestealTracker = new LifestealTracker();
  private regenElapsedValue = 0;
  private stationarySecondsValue = 0;
  /** I18：受击后是否已蓄势等待下一发 J。 */
  private nextJBonusArmedValue = false;
  /** I18：内置冷却剩余秒数。 */
  private nextJBonusCooldownSeconds = 0;
  /** I21：已累计的 J 命中次数（跨波保留，重开清零）。 */
  private jHitCountValue = 0;
  /** I23：本波护盾剩余量；到期时整体移除。 */
  private lowHealthShieldRemainingValue = 0;
  /** I23：护盾剩余秒数。 */
  private lowHealthShieldSecondsValue = 0;
  /** I23：本波是否已触发过。 */
  private lowHealthShieldUsedThisWaveValue = false;

  constructor(config: ItemEffectsConfig) {
    this.stacksOfValue = config.stacksOf;
  }

  stacks(itemId: string): number {
    return stacksCount(this.stacksOfValue(itemId));
  }

  /** I09 每 5 秒回复量（4×层数）。 */
  get regenPerFiveSeconds(): number {
    return (ITEM_EFFECT_PARAMS.I09.healPerFiveSeconds ?? 0) * this.stacks('I09');
  }

  /** I09 当前周期内已累计的秒数；开发快照与测试用。 */
  get regenElapsedSeconds(): number {
    return this.regenElapsedValue;
  }

  /** I10 造成伤害转治疗的比例（2%×层数）。 */
  get lifesteal(): number {
    return (ITEM_EFFECT_PARAMS.I10.lifestealPercent ?? 0) * this.stacks('I10');
  }

  /** I10 每秒基础治疗上限（4×层数）。 */
  get lifestealCapPerSecond(): number {
    return (ITEM_EFFECT_PARAMS.I10.lifestealCapPerSecond ?? 0) * this.stacks('I10');
  }

  /** I10 本秒已使用的治疗量；开发快照与测试用。 */
  get lifestealHealedThisSecond(): number {
    return this.lifestealTracker.healedThisSecond;
  }

  /** I12 当前已连续静止的秒数。 */
  get stationarySeconds(): number {
    return this.stationarySecondsValue;
  }

  /** 是否满足 I12 的静止 0.8 秒条件。 */
  get isStationary(): boolean {
    const required = ITEM_EFFECT_PARAMS.I12.stationarySeconds ?? 0;
    return (
      this.stacks('I12') > 0 &&
      required > 0 &&
      this.stationarySecondsValue + TIME_EPSILON >= required
    );
  }

  /** I12 当前实际生效的伤害加成；未满足条件时为 0。 */
  get stationaryDamageBonus(): number {
    return this.isStationary
      ? (ITEM_EFFECT_PARAMS.I12.stationaryDamagePercent ?? 0) * this.stacks('I12')
      : 0;
  }

  /** 不要求当前静止的 I12 加成基数；卡面预览用。 */
  stationaryDamageBonusAtStacks(itemId: string, stacks: number): number {
    if (itemId !== 'I12') return 0;
    return (
      (ITEM_EFFECT_PARAMS.I12.stationaryDamagePercent ?? 0) * stacksCount(stacks)
    );
  }

  /** I14：每层追加的非穿透 J 弹数量（叠层上限 1，按层数返回）。 */
  get extraProjectileCount(): number {
    return (ITEM_EFFECT_PARAMS.I14.extraProjectileCount ?? 0) * this.stacks('I14');
  }

  /** I14：追加弹的伤害比例；未拥有时为 0。 */
  get extraProjectileDamageRatio(): number {
    return this.stacks('I14') > 0
      ? ITEM_EFFECT_PARAMS.I14.extraProjectileDamageRatio ?? 0
      : 0;
  }

  /** I18：当前是否已蓄势等待下一发 J。 */
  get isNextJBonusArmed(): boolean {
    return this.nextJBonusArmedValue;
  }

  /** I18：内置冷却剩余秒数。 */
  get nextJBonusCooldownRemaining(): number {
    return this.nextJBonusCooldownSeconds;
  }

  /** I18：蓄势中的增伤比例；未蓄势为 0。 */
  get nextJBonus(): number {
    return this.nextJBonusArmedValue
      ? (ITEM_EFFECT_PARAMS.I18.nextJDamagePercent ?? 0) * this.stacks('I18')
      : 0;
  }

  /** I18：受到敌人有效命中后蓄势；内置冷却中或已蓄势时不重复触发。 */
  notifyEnemyHit(): boolean {
    if (this.stacks('I18') <= 0) return false;
    if (this.nextJBonusArmedValue) return false;
    if (this.nextJBonusCooldownSeconds > TIME_EPSILON) return false;
    this.nextJBonusArmedValue = true;
    this.nextJBonusCooldownSeconds =
      ITEM_EFFECT_PARAMS.I18.internalCooldownSeconds ?? 0;
    return true;
  }

  /** I18：取出并清空蓄势增伤；下一发 J 使用，未蓄势为 0。 */
  consumeNextJBonus(): number {
    const bonus = this.nextJBonus;
    this.nextJBonusArmedValue = false;
    return bonus;
  }

  /** I21：已累计的 J 命中次数。 */
  get jHitCount(): number {
    return this.jHitCountValue;
  }

  /** I21：距离下一次弹射还需要的 J 命中次数；未拥有为 0。 */
  get jHitsUntilRicochet(): number {
    const every = ITEM_EFFECT_PARAMS.I21.ricochetEvery ?? 0;
    if (this.stacks('I21') <= 0 || every <= 0) return 0;
    const remainder = this.jHitCountValue % every;
    return remainder === 0 ? every : every - remainder;
  }

  /**
   * I21：登记一次 J 命中。返回 true 表示本次命中触发弹射；
   * 弹射伤害本身不登记，因此不会递归触发。
   */
  registerJHit(): boolean {
    const every = ITEM_EFFECT_PARAMS.I21.ricochetEvery ?? 0;
    if (this.stacks('I21') <= 0 || every <= 0) return false;
    this.jHitCountValue += 1;
    return this.jHitCountValue % every === 0;
  }

  /** I21：弹射伤害比例；未拥有时为 0。 */
  get ricochetDamageRatio(): number {
    return this.stacks('I21') > 0
      ? ITEM_EFFECT_PARAMS.I21.ricochetDamageRatio ?? 0
      : 0;
  }

  /** I23：本波是否已触发过低血护盾。 */
  get lowHealthShieldUsedThisWave(): boolean {
    return this.lowHealthShieldUsedThisWaveValue;
  }

  /** I23：当前护盾剩余秒数。 */
  get lowHealthShieldRemainingSeconds(): number {
    return this.lowHealthShieldSecondsValue;
  }

  /** I23：当前仍记录在案的护盾剩余量；到期时用于从玩家护盾中移除。 */
  get lowHealthShieldAmount(): number {
    return this.lowHealthShieldRemainingValue;
  }

  /**
   * I23：每波首次降到阈值生命时授予护盾。返回本波护盾量；
   * 未拥有、已触发、未到阈值或已死亡时返回 0。
   */
  tryTriggerLowHealthShield(health: number, maxHealth: number): number {
    if (this.stacks('I23') <= 0) return 0;
    if (this.lowHealthShieldUsedThisWaveValue) return 0;
    if (!(maxHealth > 0) || !(health > 0)) return 0;
    const threshold = ITEM_EFFECT_PARAMS.I23.lowHealthThreshold ?? 0;
    if (health > maxHealth * threshold + TIME_EPSILON) return 0;

    const shield = (ITEM_EFFECT_PARAMS.I23.lowHealthShield ?? 0) * this.stacks('I23');
    this.lowHealthShieldUsedThisWaveValue = true;
    this.lowHealthShieldRemainingValue = shield;
    this.lowHealthShieldSecondsValue =
      ITEM_EFFECT_PARAMS.I23.shieldDurationSeconds ?? 0;
    return shield;
  }

  /** 新一轮开始时重置 I23 的每波一次资格；仍在生效的护盾一并清除。 */
  beginWave(): void {
    this.lowHealthShieldUsedThisWaveValue = false;
    this.lowHealthShieldRemainingValue = 0;
    this.lowHealthShieldSecondsValue = 0;
  }

  /**
   * 推进临时状态。`moved` 表示本逻辑步玩家实际位移大于 0；
   * 移动会立即清空 I12 的静止计时，满足 0.8 秒后开始增伤。
   */
  step(seconds: number, moved: boolean): ItemStepResult {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return {
        regenHeal: 0,
        stationary: this.isStationary,
        shieldExpired: 0,
      };
    }

    if (moved) {
      this.stationarySecondsValue = 0;
    } else {
      this.stationarySecondsValue += seconds;
    }

    // I18 内置冷却按逻辑步衰减；蓄势本身不会过期，只等下一发 J 消耗。
    if (this.nextJBonusCooldownSeconds > 0) {
      this.nextJBonusCooldownSeconds = Math.max(
        0,
        this.nextJBonusCooldownSeconds - seconds,
      );
    }

    // I23 护盾到期时一次性移除剩余量；提前被伤害消耗的部分已经不在护盾里。
    let shieldExpired = 0;
    if (this.lowHealthShieldSecondsValue > 0) {
      this.lowHealthShieldSecondsValue -= seconds;
      if (this.lowHealthShieldSecondsValue <= TIME_EPSILON) {
        this.lowHealthShieldSecondsValue = 0;
        shieldExpired = this.lowHealthShieldRemainingValue;
        this.lowHealthShieldRemainingValue = 0;
      }
    }

    let regenHeal = 0;
    if (this.stacks('I09') > 0) {
      this.regenElapsedValue += seconds;
      while (this.regenElapsedValue + TIME_EPSILON >= ITEM_REGEN_INTERVAL_SECONDS) {
        this.regenElapsedValue -= ITEM_REGEN_INTERVAL_SECONDS;
        regenHeal += this.regenPerFiveSeconds;
      }
    }

    this.lifestealTracker.step(seconds);
    return { regenHeal, stationary: this.isStationary, shieldExpired };
  }

  /**
   * I10：把实际造成的伤害按比例转为治疗。
   * 宝箱与无伤害命中不吸血；每秒上限按层数单独计算。
   */
  absorbLifesteal(
    actualDamage: number,
    healingMultiplier = 1,
    isChest = false,
  ): number {
    const ratio = this.lifesteal;
    if (ratio <= 0) return 0;
    return this.lifestealTracker.absorb(actualDamage, {
      lifesteal: ratio,
      healingMultiplier,
      isChest,
      healPerSecondCap: this.lifestealCapPerSecond,
    });
  }

  /**
   * 波初清空临时计时（周期回复、静止、吸血预算、I18 蓄势、I23 护盾）；
   * I21 的 J 命中计数跨波保留，只有新开一局才清零。
   */
  resetForWave(): void {
    this.resetTemporaryState();
  }

  private resetTemporaryState(): void {
    this.regenElapsedValue = 0;
    this.stationarySecondsValue = 0;
    this.lifestealTracker.reset();
    this.nextJBonusArmedValue = false;
    this.nextJBonusCooldownSeconds = 0;
    this.lowHealthShieldRemainingValue = 0;
    this.lowHealthShieldSecondsValue = 0;
    this.lowHealthShieldUsedThisWaveValue = false;
  }

  /** 新一轮开始时清空临时计时与跨波计数；层数不受影响。 */
  reset(): void {
    this.resetTemporaryState();
    this.jHitCountValue = 0;
  }

  /**
   * 出售移除道具后清掉该件仍残留的临时状态；层数未归零时不动，
   * 剩余层数由属性聚合与读取时的层数自然生效。
   * 返回需要从玩家护盾中移除的 I23 残余量；已被伤害消耗的部分不在内。
   */
  onItemRemoved(itemId: string): number {
    if (this.stacks(itemId) > 0) return 0;
    switch (itemId) {
      case 'I09':
        this.regenElapsedValue = 0;
        break;
      case 'I10':
        this.lifestealTracker.reset();
        break;
      case 'I12':
        this.stationarySecondsValue = 0;
        break;
      case 'I18':
        this.nextJBonusArmedValue = false;
        this.nextJBonusCooldownSeconds = 0;
        break;
      case 'I21':
        this.jHitCountValue = 0;
        break;
      case 'I23': {
        const shield = this.lowHealthShieldRemainingValue;
        this.lowHealthShieldRemainingValue = 0;
        this.lowHealthShieldSecondsValue = 0;
        this.lowHealthShieldUsedThisWaveValue = false;
        return shield;
      }
      default:
        break;
    }
    return 0;
  }

  snapshot(): {
    readonly regenPerFiveSeconds: number;
    readonly regenElapsedSeconds: number;
    readonly lifesteal: number;
    readonly lifestealCapPerSecond: number;
    readonly lifestealHealedThisSecond: number;
    readonly stationarySeconds: number;
    readonly stationaryDamageBonus: number;
    readonly extraProjectileCount: number;
    readonly nextJBonusArmed: boolean;
    readonly nextJBonusCooldownRemaining: number;
    readonly jHitCount: number;
    readonly jHitsUntilRicochet: number;
    readonly lowHealthShieldUsedThisWave: boolean;
    readonly lowHealthShieldRemainingSeconds: number;
  } {
    return {
      regenPerFiveSeconds: this.regenPerFiveSeconds,
      regenElapsedSeconds: this.regenElapsedValue,
      lifesteal: this.lifesteal,
      lifestealCapPerSecond: this.lifestealCapPerSecond,
      lifestealHealedThisSecond: this.lifestealTracker.healedThisSecond,
      stationarySeconds: this.stationarySecondsValue,
      stationaryDamageBonus: this.stationaryDamageBonus,
      extraProjectileCount: this.extraProjectileCount,
      nextJBonusArmed: this.nextJBonusArmedValue,
      nextJBonusCooldownRemaining: this.nextJBonusCooldownSeconds,
      jHitCount: this.jHitCountValue,
      jHitsUntilRicochet: this.jHitsUntilRicochet,
      lowHealthShieldUsedThisWave: this.lowHealthShieldUsedThisWaveValue,
      lowHealthShieldRemainingSeconds: this.lowHealthShieldSecondsValue,
    };
  }
}
