/**
 * 构筑面板（US-047）的纯视图模型与键盘滚动状态。
 *
 * 战斗内按 B 打开：场景暂停，DOM 面板只渲染本模块生成的视图。
 * 五类来源分组固定为临时饮剂、永久道具、精英核心、配方成品、海克斯，
 * 每项显示层数/来源与未生效条件；净属性与战斗结算同源。
 * 本模块不依赖 Phaser / DOM，规则测试可直接断言。
 */
import { hudValue } from './combat';
import { describeCraftedItem, statLabel } from './crafting';
import { getConsumable, getEliteCore, getHex, getShopItem } from './data';
import { describeItemEffect } from './item-effects';
import type { StatModifier } from './stats';

/** Phaser game 事件：请求应用壳显示构筑面板。 */
export const BUILD_PANEL_EVENT = 'pixel-echo:build-panel';

/** 面板打开期间的战斗键位：B 切换、Esc 关闭，其余按键交给面板滚动。 */
export const BUILD_PANEL_TOGGLE_KEY = 'KeyB';

export type BuildPanelEventPayload =
  | { readonly type: 'open'; readonly view: BuildPanelView }
  | { readonly type: 'close' };

/** 战斗内开关判定：B 在关闭时打开、打开时关闭；Esc 只负责关闭。 */
export function buildPanelToggleAction(
  code: string,
  open: boolean,
): 'open' | 'close' | null {
  if (code === BUILD_PANEL_TOGGLE_KEY) return open ? 'close' : 'open';
  if (open && code === 'Escape') return 'close';
  return null;
}

export const BUILD_GROUP_ORDER = [
  'potion',
  'item',
  'core',
  'crafted',
  'hex',
] as const;

export type BuildGroupKind = (typeof BUILD_GROUP_ORDER)[number];

export const BUILD_GROUP_LABELS: Readonly<Record<BuildGroupKind, string>> = {
  potion: '临时饮剂',
  item: '永久道具',
  core: '精英核心',
  crafted: '配方成品',
  hex: '海克斯',
};

const BUILD_GROUP_EMPTY: Readonly<Record<BuildGroupKind, string>> = {
  potion: '暂无临时饮剂',
  item: '暂无永久道具',
  core: '暂无精英核心',
  crafted: '暂无配方成品',
  hex: '暂无海克斯',
};

export interface BuildEntryView {
  readonly id: string;
  readonly name: string;
  readonly tag: string;
  /** 层数或件数的短标签，例如「×2 层」「1/3 层」。 */
  readonly stacksLabel: string;
  /** 来源分组内的具体来源，例如「商店药剂」「海克斯 · 爆破手」。 */
  readonly sourceLabel: string;
  readonly effect: string;
  /** 当前状态与未生效条件；常驻生效来源为 null。 */
  readonly condition: string | null;
  /** 当前未生效（如排队中的下一波药剂）。 */
  readonly inactive: boolean;
}

export interface BuildGroupView {
  readonly kind: BuildGroupKind;
  readonly title: string;
  readonly count: number;
  readonly emptyLabel: string;
  readonly entries: readonly BuildEntryView[];
}

export interface BuildAttributeView {
  readonly label: string;
  readonly value: string;
}

export interface BuildPanelView {
  readonly title: string;
  readonly wave: number;
  readonly summary: string;
  readonly groups: readonly BuildGroupView[];
  readonly attributes: readonly BuildAttributeView[];
  readonly scrollHint: string;
  readonly closeHint: string;
}

export interface BuildPotionInput {
  readonly id: string;
  /** 已排队、下一波开始生效的层数。 */
  readonly pending: number;
  /** 当前波已生效的层数。 */
  readonly active: number;
}

export interface BuildItemInput {
  readonly id: string;
  readonly stacks: number;
}

/** 净属性输入：全部取战斗结算的聚合值。 */
export interface BuildStatInput {
  readonly armor: number;
  readonly magicResist: number;
  readonly moveSpeed: number;
  readonly moveSpeedMultiplier: number;
  readonly attackSpeedMultiplier: number;
  readonly damageMultiplier: number;
  readonly skillDamageMultiplier: number;
  readonly normalAttackDamageMultiplier: number;
  readonly cooldownReduction: number;
  readonly explosionRadiusMultiplier: number;
  readonly damageOverTimeMultiplier: number;
  readonly recipeDamageOverTimeMultiplier: number;
  readonly summonDamageMultiplier: number;
  readonly killGoldMultiplier: number;
  readonly completionGoldMultiplier: number;
  readonly lifesteal: number;
  readonly regenPerFiveSeconds: number;
}

export interface BuildAttributeInput extends BuildStatInput {
  readonly health: number;
  readonly maxHealth: number;
  readonly shield: number;
}

export interface BuildPanelInput {
  readonly wave: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly shield: number;
  readonly stats: BuildStatInput;
  readonly potions: readonly BuildPotionInput[];
  readonly items: readonly BuildItemInput[];
  readonly cores: readonly string[];
  readonly crafted: readonly string[];
  readonly hexes: readonly string[];
  /** I16 持续伤害说明需要当前装备的技能，避免把加成写成无条件生效。 */
  readonly sustainedSkillIds?: readonly string[];
  /** 成品动态说明（如 R01 当前成长值、R02 持续通道来源）。 */
  readonly craftedNotes?: Readonly<Record<string, readonly string[]>>;
}

/** 百分比统一四舍五入到整数，避免 0.30000000000000004 出现在面板上。 */
function formatPercent(value: number): string {
  return `${Math.round((value + Number.EPSILON) * 100)}%`;
}

function formatNumber(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

/** 净属性：与战斗 HUD / 商店装备页使用同一批聚合值。 */
export function buildBuildAttributes(
  input: BuildAttributeInput,
): BuildAttributeView[] {
  return [
    {
      label: '生命',
      value: `${hudValue(input.health)}/${hudValue(input.maxHealth)}`,
    },
    { label: '护盾', value: `${hudValue(input.shield)}` },
    { label: '护甲', value: formatNumber(input.armor) },
    { label: '法抗', value: formatPercent(input.magicResist) },
    {
      label: '移速',
      value: `${formatNumber(input.moveSpeed)} · ${formatPercent(input.moveSpeedMultiplier)}`,
    },
    { label: '攻速', value: formatPercent(input.attackSpeedMultiplier) },
    { label: '伤害', value: formatPercent(input.damageMultiplier) },
    { label: '技能伤害', value: formatPercent(input.skillDamageMultiplier) },
    { label: 'J 伤害', value: formatPercent(input.normalAttackDamageMultiplier) },
    { label: '冷却缩减', value: formatPercent(input.cooldownReduction) },
    { label: '爆炸半径', value: formatPercent(input.explosionRadiusMultiplier) },
    { label: '持续伤害', value: formatPercent(input.damageOverTimeMultiplier) },
    {
      label: '成品持续伤害',
      value: formatPercent(input.recipeDamageOverTimeMultiplier),
    },
    { label: '召唤物伤害', value: formatPercent(input.summonDamageMultiplier) },
    { label: '每 5 秒回复', value: formatNumber(input.regenPerFiveSeconds) },
    { label: '吸血', value: formatPercent(input.lifesteal) },
    { label: '击杀金币', value: formatPercent(input.killGoldMultiplier) },
    { label: '完成奖励', value: formatPercent(input.completionGoldMultiplier) },
  ];
}

function craftModifierText(modifier: StatModifier): string {
  const value =
    modifier.mode === 'percent'
      ? `${Math.round(modifier.value * 100)}%`
      : `${modifier.value}`;
  const sign = modifier.value > 0 ? '+' : '';
  return `${statLabel(modifier.stat)} ${sign}${value}`;
}

function potionEntry(
  potion: BuildPotionInput,
): BuildEntryView | null {
  const pending = Math.max(0, Math.floor(potion.pending));
  const active = Math.max(0, Math.floor(potion.active));
  const total = pending + active;
  if (total <= 0) return null;
  const definition = getConsumable(potion.id);
  const condition =
    active <= 0
      ? '未生效：下一波开始生效'
      : pending > 0
        ? `生效中；另有 ${pending} 层下一波生效`
        : '生效中：本波结束清除';
  return {
    id: potion.id,
    name: definition?.name ?? potion.id,
    tag: '饮剂',
    stacksLabel: `×${total} 层`,
    sourceLabel: '商店药剂',
    effect: definition?.effect ?? '',
    condition,
    inactive: active <= 0,
  };
}

function itemEntry(
  item: BuildItemInput,
  sustainedSkillIds: readonly string[],
): BuildEntryView | null {
  const stacks = Math.max(0, Math.floor(item.stacks));
  if (stacks <= 0) return null;
  const definition = getShopItem(item.id);
  const described = describeItemEffect(item.id, stacks, { sustainedSkillIds });
  const fallback = definition
    ? `${definition.benefit}；代价：${definition.cost}`
    : '';
  return {
    id: item.id,
    name: definition?.name ?? item.id,
    tag: definition?.tag ?? '道具',
    stacksLabel: definition
      ? `${stacks}/${definition.stackCap} 层`
      : `×${stacks} 层`,
    sourceLabel: '永久道具',
    effect: described || fallback,
    condition: null,
    inactive: false,
  };
}

function coreEntry(coreId: string): BuildEntryView {
  const definition = getEliteCore(coreId);
  return {
    id: coreId,
    name: definition?.name ?? coreId,
    tag: definition?.tag ?? '核心',
    stacksLabel: '1 件',
    sourceLabel: '精英核心',
    effect: definition?.effect ?? '',
    condition: null,
    inactive: false,
  };
}

function craftedEntry(
  recipeId: string,
  notes: readonly string[],
): BuildEntryView {
  const description = describeCraftedItem(recipeId);
  const effects = [
    ...(description?.statModifiers ?? [])
      .filter((modifier) => Number.isFinite(modifier.value) && modifier.value !== 0)
      .map(craftModifierText),
    ...(description?.mechanics ?? []),
    ...notes,
  ];
  return {
    id: recipeId,
    name: description?.name ?? recipeId,
    tag: '成品',
    stacksLabel: '1 件',
    sourceLabel: '配方成品',
    effect: effects.join(' / '),
    condition: null,
    inactive: false,
  };
}

function hexEntry(hexId: string): BuildEntryView {
  const definition = getHex(hexId);
  return {
    id: hexId,
    name: definition?.name ?? hexId,
    tag: definition?.rarity ?? '海克斯',
    stacksLabel: '1 层',
    sourceLabel: definition ? `海克斯 · ${definition.owner}` : '海克斯',
    effect: definition?.effect ?? '',
    condition: null,
    inactive: false,
  };
}

function group(
  kind: BuildGroupKind,
  entries: readonly BuildEntryView[],
): BuildGroupView {
  return {
    kind,
    title: BUILD_GROUP_LABELS[kind],
    count: entries.length,
    emptyLabel: BUILD_GROUP_EMPTY[kind],
    entries,
  };
}

/** 生成一帧构筑视图；空分组也保留，面板结构始终为五类。 */
export function buildBuildPanelView(input: BuildPanelInput): BuildPanelView {
  const sustainedSkillIds = input.sustainedSkillIds ?? [];
  const notes = input.craftedNotes ?? {};
  const potions = input.potions
    .map(potionEntry)
    .filter((entry): entry is BuildEntryView => entry !== null);
  const items = input.items
    .map((item) => itemEntry(item, sustainedSkillIds))
    .filter((entry): entry is BuildEntryView => entry !== null);
  const groups = [
    group('potion', potions),
    group('item', items),
    group('core', input.cores.map(coreEntry)),
    group(
      'crafted',
      input.crafted.map((recipeId) => craftedEntry(recipeId, notes[recipeId] ?? [])),
    ),
    group('hex', input.hexes.map(hexEntry)),
  ];
  const total = groups.reduce((sum, entry) => sum + entry.count, 0);
  return {
    title: '构筑',
    wave: input.wave,
    summary: `第 ${input.wave} 波 · 来源 ${total} 项 · 生命 ${hudValue(input.health)}/${hudValue(input.maxHealth)}`,
    groups,
    attributes: buildBuildAttributes({
      ...input.stats,
      health: input.health,
      maxHealth: input.maxHealth,
      shield: input.shield,
    }),
    scrollHint: '↑↓ / PgUp PgDn 滚动 · Home / End 跳转',
    closeHint: 'B 或 Esc 关闭并继续战斗',
  };
}

/** 每行滚动的像素数；与 DOM 面板的键盘滚动共用。 */
export const BUILD_SCROLL_LINE_PX = 48;

/**
 * 键盘滚动状态：DOM 只负责把 scrollHeight − clientHeight 交给 `setViewport`，
 * 偏移量在这里统一钳制，测试无需真实布局即可覆盖边界。
 */
export class BuildPanelScroll {
  private offsetValue = 0;
  private maxValue = 0;

  get offset(): number {
    return this.offsetValue;
  }

  get max(): number {
    return this.maxValue;
  }

  setViewport(maxOffset: number): void {
    this.maxValue =
      Number.isFinite(maxOffset) && maxOffset > 0 ? Math.floor(maxOffset) : 0;
    this.offsetValue = clampOffset(this.offsetValue, this.maxValue);
  }

  scrollBy(delta: number): number {
    if (!Number.isFinite(delta) || delta === 0) {
      return this.offsetValue;
    }
    this.offsetValue = clampOffset(
      this.offsetValue + Math.trunc(delta),
      this.maxValue,
    );
    return this.offsetValue;
  }

  /** 翻页按视口高度的 80%；方向 −1 向上、1 向下。 */
  pageBy(direction: number, viewportHeight: number): number {
    const height =
      Number.isFinite(viewportHeight) && viewportHeight > 0
        ? viewportHeight
        : BUILD_SCROLL_LINE_PX * 6;
    const sign = direction < 0 ? -1 : 1;
    return this.scrollBy(sign * Math.max(BUILD_SCROLL_LINE_PX, height * 0.8));
  }

  toTop(): number {
    this.offsetValue = 0;
    return this.offsetValue;
  }

  toBottom(): number {
    this.offsetValue = this.maxValue;
    return this.offsetValue;
  }

  reset(): void {
    this.offsetValue = 0;
    this.maxValue = 0;
  }
}

function clampOffset(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return value >= max ? max : Math.floor(value);
}
