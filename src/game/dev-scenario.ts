/**
 * 开发环境场景参数（docs/game-design.md §10）。
 *
 * 只在 `import.meta.env.DEV` 分支内调用；生产构建会把整个入口摇掉。
 * URL 形如 `?dev=1&seed=20261020&character=amiya&wave=5&enemies=blob:3,spitter:2&upgrades=W01,W02`：
 * - `dev=1` 启用开发入口；
 * - `seed` 固定本局强化随机序列；
 * - `character` 指定本局角色（由应用壳直接开局）；
 * - `wave` 从指定波次开始（1–18）；
 * - `enemies` 覆盖起始波的实际敌人组合，格式 `id:数量`，逗号分隔；
 * - `upgrades` 开局直接授予指定强化，格式 `id,id`，重复 ID 按层数逐次授予；
 * - `hexes` 开局直接授予指定海克斯，格式 `H01,H02`，每种最高 1 层；
 * - `xp` 开局预置经验（0–10000），用于直接触发 2 级海克斯三选一；
 * - `cores` 开局直接授予指定精英核心，格式 `E01,E02`；
 * - `items` 开局直接授予指定永久道具，格式 `I01,I01,I06`，重复 ID 按层数叠加；
 * - `shopOps` 第一个商店创建后依次执行购买/出售，格式 `buy:0,sell:0`；
 *   `buy` 接受商品槽位（0–4）、永久道具 ID 或消耗品 ID（`P01` 走常驻按钮，
 *   P02–P08 须在当手货架），`sell` 接受商品槽位（解析该格道具）或永久道具 ID；
 * - `shopPotion` 强制第一个商店的轮换药剂，格式 `P03`（P01 与货架外/未开放药剂回退随机）；
 * - `craft` 指定波间合成面板展示的配方，格式 `R01`；用真实键盘 C 确认合成，
 *   材料由 `items` 预置、金币由 `gold` 预置；
 * - `track` 开局追踪一条配方（R01–R06）；波间按 T 可切换，追踪写入续局快照；
 * - `crafted` 开局直接授予成品 R01–R06（每件唯一），用于核对成品战斗机制；
 * - `gold` 预置本局金币，用于在第 1/7/13 次商店按需补足验收资金；
 * - `maxHealth=N` 覆盖本局玩家生命上限（40–999），只影响当前局，不写设置或成绩；
 * - `damageTaken=N` 玩家受伤倍率（1–100），用于快速构造致命伤与保命场景；
 * - `waveSpeed=N` 波内逻辑时钟倍率（1–10），只加快刷怪/倒计时推进，不改规则与奖励；
 * - `eliteOnly=1` 第 6/9/12/15 波只刷精英、不混普通怪；
 * - `perf=1` 进入隔离性能场景：跳过波次流程，持续维持固定数量的敌人、敌弹与
 *   流形，用于 `tools/perf/perf-check.mjs` 的 60 秒帧率与重开泄漏检查；
 * - `triggerDemo=1` 运行只读触发链演示，结果写入开发快照，不改变本局状态。
 * 非法字段单独忽略并回退默认值，避免开发页因一个笔误完全打不开；回退不是静默的：
 * `resolveDevScenario` 同时返回原始请求、实际生效值与可读失败原因，供开发快照取证。
 */
import { isCharacterId, type CharacterId } from './data/characters';
import {
  CONSUMABLE_LIST,
  FREE_SKILL_LIST,
  HEX_LIST,
  SHOP_ITEM_LIST,
} from './data/catalog';
import { CRAFTED_ITEM_IDS } from './crafting';
import { ELITE_CORE_IDS } from './core-offer';
import { NORMAL_ENEMY_LIST, type EnemyId } from './data/enemies';
import { UPGRADE_LIST } from './data/upgrades';
import { TOTAL_WAVES, type WaveDefinition } from './data/waves';
import { SHOP_MAIN_SLOT_COUNT } from './shop-offer';

/** 单个场景允许生成的最大敌人总数；覆盖常规第 17 波的 63。 */
export const DEV_SCENARIO_MAX_ENEMIES = 120;

/** 单个敌人类型允许的最大数量。 */
export const DEV_SCENARIO_MAX_ENEMIES_PER_GROUP = 60;

/** 开发场景一次可预置的强化条目上限（按全部卡满层计）。 */
export const DEV_SCENARIO_MAX_UPGRADES = UPGRADE_LIST.reduce(
  (total, upgrade) => total + upgrade.maxStacks,
  0,
);

/** 开发场景可预置的金币上限；足够覆盖第 17 波商店的高价商品。 */
export const DEV_SCENARIO_MAX_GOLD = 99999;

/** 开发场景可预置的经验上限；覆盖 1→15 级所需的 2065 经验并留出余量。 */
export const DEV_SCENARIO_MAX_XP = 10000;

/** 开发验证参数：玩家生命上限允许范围（与 `stats.ts` 的最低生命上限一致）。 */
export const DEV_SCENARIO_MAX_HEALTH_MIN = 40;
export const DEV_SCENARIO_MAX_HEALTH_MAX = 999;
/** 开发验证参数：玩家受伤倍率允许范围。 */
export const DEV_SCENARIO_DAMAGE_TAKEN_MIN = 1;
export const DEV_SCENARIO_DAMAGE_TAKEN_MAX = 100;
/** 开发验证参数：波内逻辑时钟倍率允许范围。 */
export const DEV_SCENARIO_WAVE_SPEED_MIN = 1;
export const DEV_SCENARIO_WAVE_SPEED_MAX = 10;

/** 性能场景规格（docs/game-design.md §10）：80 敌人、40 弹体、3 流形同屏 60 秒。 */
export const DEV_PERF_ENEMY_COUNT = 80;
export const DEV_PERF_ENEMY_PROJECTILE_COUNT = 40;
/** 主流形 + 2 个远程副本。 */
export const DEV_PERF_MANIFOLD_COUNT = 3;
export const DEV_PERF_DURATION_SECONDS = 60;

const NORMAL_ENEMY_IDS: ReadonlySet<string> = new Set(
  NORMAL_ENEMY_LIST.map((enemy) => enemy.id),
);

const KNOWN_UPGRADE_IDS: ReadonlySet<string> = new Set(
  UPGRADE_LIST.map((upgrade) => upgrade.id),
);

/** 可预置的海克斯 ID；全部 48 种，每种最高 1 层。 */
const KNOWN_HEX_IDS: ReadonlySet<string> = new Set(
  HEX_LIST.map((hex) => hex.id),
);

const SHOP_ITEM_STACK_CAPS: ReadonlyMap<string, number> = new Map(
  SHOP_ITEM_LIST.map((item) => [item.id, item.stackCap]),
);

/** 自由技能 ID 与基础价，用于开发预置与商店操作解析。 */
const FREE_SKILL_BASE_PRICES: ReadonlyMap<string, number> = new Map(
  FREE_SKILL_LIST.map((skill) => [skill.id, skill.basePrice]),
);

/** 可由 `shopPotion` 指定的轮换药剂；P01 是常驻按钮，不参与货架覆盖。 */
const SHOP_POTION_IDS: ReadonlySet<string> = new Set(
  CONSUMABLE_LIST.filter((consumable) => consumable.id !== 'P01').map(
    (consumable) => consumable.id,
  ),
);

/** 可指定的三件合成配方；与内容目录的 6 条配方一致。 */
const CRAFT_RECIPE_IDS: ReadonlySet<string> = new Set(CRAFTED_ITEM_IDS);

/** 开发场景一次可预置的永久道具条目上限（按全部道具满层计）。 */
const DEV_SCENARIO_MAX_ITEMS = SHOP_ITEM_LIST.reduce(
  (total, item) => total + item.stackCap,
  0,
);

export interface DevEnemyGroup {
  readonly enemyId: EnemyId;
  readonly count: number;
}

/** 开发预置的自由技能：按槽位顺序放置，同 ID 重复表示升级。 */
export interface DevFreeSkillPreset {
  readonly id: string;
  readonly level: number;
}

export interface DevScenario {
  readonly seed: number | null;
  readonly characterId: CharacterId | null;
  readonly wave: number | null;
  readonly enemies: readonly DevEnemyGroup[] | null;
  /** 开局直接授予的强化 ID；重复 ID 按层数逐次授予（上限由卡片 maxStacks 决定）。 */
  readonly upgrades: readonly string[] | null;
  /** 开局直接拥有的海克斯 ID；每种最高 1 层，重复 ID 视为非法。 */
  readonly hexes: readonly string[] | null;
  /** 开局预置经验；null 表示从 0 开始。用于直接触发海克斯等级节点。 */
  readonly xp: number | null;
  /** 开局直接拥有的精英核心 ID，用于验证候选排除；不影响当前波精英资格。 */
  readonly cores: readonly string[] | null;
  /** 开局直接授予的永久道具 ID；重复 ID 按层数逐次授予（不超过目录上限）。 */
  readonly items: readonly string[] | null;
  /** 开局预置的自由技能槽（最多 2 个不同技能，各最高 3 级）。 */
  readonly skills: readonly DevFreeSkillPreset[] | null;
  /** 第一个商店创建后依次执行的购买/出售；null 表示不执行。 */
  readonly shopOps: readonly DevShopOp[] | null;
  /** 强制第一个商店的轮换药剂 ID（P02–P08）；null 表示按目录随机。 */
  readonly shopPotion: string | null;
  /** 强制第一个商店的自由技能 ID（S01–S12）；null 表示按目录候选随机。 */
  readonly shopSkill: string | null;
  /** 波间开发合成面板展示的配方 ID（R01–R06）；null 表示不显示。 */
  readonly craft: string | null;
  /** 开局追踪的配方 ID（R01–R06）；已有续局追踪时不覆盖。 */
  readonly track: string | null;
  /** 开局直接授予的成品 R01–R06；每件唯一。 */
  readonly crafted: readonly string[] | null;
  /** 开局预置金币；null 表示按正常新局 40 金币。 */
  readonly gold: number | null;
  /** 本局玩家生命上限覆盖；null 表示按聚合属性。 */
  readonly maxHealth: number | null;
  /** 玩家受伤倍率；null 表示不缩放。 */
  readonly damageTaken: number | null;
  /** 波内逻辑时钟倍率；null 表示 1。 */
  readonly waveSpeed: number | null;
  /** 精英波（6/9/12/15）只刷精英、不混普通怪。 */
  readonly eliteOnly: boolean;
  /** 隔离性能场景；开启后不进入正常波次流程。 */
  readonly perf: boolean;
  /** 只读触发链演示；不改变本局战斗状态，结果进入开发快照。 */
  readonly triggerDemo: boolean;
}

/**
 * 开发商店操作：`buy` 按槽位（0–4）、永久道具 ID、消耗品 ID 或 `supply`
 * 购买（`supply` 走追踪配方的缺件供给）；`sell` 按槽位解析该格道具或直接按道具 ID 出售 1 层；
 * `reroll` 走与正式重抽按钮相同的交易会话入口（用于 R06 免费重抽取证）。
 * 只在第一个商店执行一次，用于在没有正式商店界面时验证真实买入/出售/重抽路径。
 */
export type DevShopOp =
  | {
      readonly kind: 'buy';
      readonly target: number | string;
      /** 技能购买目标槽（U/I）；未指定时自动空槽，满槽则失败。 */
      readonly slot?: 'U' | 'I';
    }
  | { readonly kind: 'sell'; readonly target: number | string }
  | { readonly kind: 'reroll' };

/** 单步开发商店操作的执行结果；数值为操作前后的实时状态。 */
export interface DevShopOpStep {
  readonly op: string;
  readonly ok: boolean;
  readonly reason: string | null;
  readonly itemId: string | null;
  /** 出售时该层实际支付与回收；购买时为 0。 */
  readonly paid: number;
  readonly refund: number;
  /** 购买后的层数或出售后的剩余层数；失败为 null。 */
  readonly stacks: number | null;
  readonly goldBefore: number;
  readonly goldAfter: number;
  readonly healthBefore: number;
  readonly healthAfter: number;
  readonly maxHealthBefore: number;
  readonly maxHealthAfter: number;
  readonly armorBefore: number;
  readonly armorAfter: number;
  readonly attackSpeedBefore: number;
  readonly attackSpeedAfter: number;
  /** 技能购买后的槽位与等级；非技能操作为 null。 */
  readonly skillSlot: 'U' | 'I' | null;
  readonly skillLevel: number | null;
  /** 新技能冷却与本次净金币（回收 − 支付）；非技能操作为 null。 */
  readonly skillCooldownSeconds: number | null;
  readonly netGold: number | null;
  /** 满槽替换时被换下的技能；其他操作为 null。 */
  readonly replacedId: string | null;
  readonly replacedLevel: number | null;
  readonly replacedCooldownSeconds: number | null;
}

/** `shopOps` 的执行报告；随开发快照返回。 */
export interface DevShopOpsReport {
  readonly requested: string;
  readonly steps: readonly DevShopOpStep[];
  /** 任一步失败的可读原因；全部成功为 null。 */
  readonly failureReason: string | null;
}

/** 实际生效的 dev 参数值；复合参数用规范化后的字符串表示。 */
export type DevAppliedParam = string | number | boolean;

/**
 * dev 参数的请求/生效对照。非法值回退默认值时，既要能在快照里看出玩家请求了什么，
 * 也要能看出实际生效了什么，并留下可读原因，避免把笔误当成正常对局。
 */
export interface DevScenarioReport {
  /** URL 中实际出现的 dev 参数原始值。 */
  readonly devRequested: Readonly<Record<string, string>>;
  /** 成功解析并生效的参数；非法参数不会出现在这里。 */
  readonly devApplied: Readonly<Record<string, DevAppliedParam>>;
  /** 全部非法参数的可读原因；没有非法参数时为 null。 */
  readonly failureReason: string | null;
}

export interface DevScenarioResolution {
  /** 没有 `dev=1` 时为 null；有开发入口时恒为对象（非法字段已回退）。 */
  readonly scenario: DevScenario | null;
  readonly report: DevScenarioReport;
}

function parseSeed(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw) >>> 0;
}

function parseCharacterId(raw: string | null): CharacterId | null {
  return isCharacterId(raw) ? raw : null;
}

function parseWave(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const wave = Number(raw);
  return Number.isInteger(wave) && wave >= 1 && wave <= TOTAL_WAVES ? wave : null;
}

function parseEnemyGroups(raw: string | null): readonly DevEnemyGroup[] | null {
  if (!raw) return null;

  const groups: DevEnemyGroup[] = [];
  let total = 0;
  for (const part of raw.split(',')) {
    const [id, countText, extra] = part.split(':');
    if (!id || !countText || extra !== undefined) return null;
    if (!NORMAL_ENEMY_IDS.has(id)) return null;

    const count = Number(countText);
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > DEV_SCENARIO_MAX_ENEMIES_PER_GROUP
    ) {
      return null;
    }
    total += count;
    if (total > DEV_SCENARIO_MAX_ENEMIES) return null;

    groups.push({ enemyId: id as EnemyId, count });
  }

  return groups.length > 0 ? groups : null;
}

function parseUpgradeIds(raw: string | null): readonly string[] | null {
  if (!raw) return null;

  const ids: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (!KNOWN_UPGRADE_IDS.has(id)) return null;
    ids.push(id);
  }

  // 重复 ID 保留，便于开发场景直接把银卡叠到 3 层复现组合差异。
  if (ids.length === 0 || ids.length > DEV_SCENARIO_MAX_UPGRADES) return null;
  return ids;
}

/**
 * 解析开局预置道具：只接受目录中的永久道具 ID。
 * 重复 ID 保留到各自叠层上限，便于直接复现 I01×3 等叠层效果；
 * 超过上限或未知道具视为非法，避免开发页静默少发一层。
 */
function parseItemIds(raw: string | null): readonly string[] | null {
  if (!raw) return null;

  const ids: string[] = [];
  const counts = new Map<string, number>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    const cap = SHOP_ITEM_STACK_CAPS.get(id);
    if (cap === undefined) return null;
    const count = (counts.get(id) ?? 0) + 1;
    if (count > cap) return null;
    counts.set(id, count);
    ids.push(id);
  }

  if (ids.length === 0 || ids.length > DEV_SCENARIO_MAX_ITEMS) return null;
  return ids;
}

/** 开发场景一次可执行的商店操作条数上限。 */
export const DEV_SHOP_OPS_MAX = 12;

function parseShopOps(raw: string | null): readonly DevShopOp[] | null {
  if (!raw) return null;

  const ops: DevShopOp[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    // 无参数的重抽：`shopOps=reroll`；R06 首次重抽的免费路径用它取证。
    if (trimmed === 'reroll') {
      ops.push({ kind: 'reroll' });
      continue;
    }
    const [kind, rawValue, extra] = trimmed.split(':');
    if (!kind || !rawValue || extra !== undefined) return null;
    // `buy:3@U`：先选槽再买的技能购买写法；非技能目标不允许带槽位。
    const [value, slotText, slotExtra] = rawValue.split('@');
    if (!value || slotExtra !== undefined) return null;
    let targetSlot: 'U' | 'I' | undefined;
    if (slotText !== undefined) {
      if (slotText !== 'U' && slotText !== 'I') return null;
      targetSlot = slotText;
    }
    if (kind === 'buy') {
      if (/^\d+$/.test(value)) {
        const slot = Number(value);
        if (!Number.isInteger(slot) || slot < 0 || slot >= SHOP_MAIN_SLOT_COUNT) {
          return null;
        }
        ops.push({ kind: 'buy', target: slot, ...(targetSlot ? { slot: targetSlot } : {}) });
      } else {
        if (
          !SHOP_ITEM_STACK_CAPS.has(value) &&
          !SHOP_POTION_IDS.has(value) &&
          !FREE_SKILL_BASE_PRICES.has(value) &&
          value !== 'P01' &&
          value !== 'supply'
        ) {
          return null;
        }
        ops.push({ kind: 'buy', target: value, ...(targetSlot ? { slot: targetSlot } : {}) });
      }
    } else if (kind === 'sell') {
      if (targetSlot) return null;
      if (/^\d+$/.test(value)) {
        const slot = Number(value);
        if (!Number.isInteger(slot) || slot < 0 || slot >= SHOP_MAIN_SLOT_COUNT) {
          return null;
        }
        ops.push({ kind: 'sell', target: slot });
      } else {
        if (!SHOP_ITEM_STACK_CAPS.has(value)) return null;
        ops.push({ kind: 'sell', target: value });
      }
    } else {
      return null;
    }
  }

  return ops.length > 0 && ops.length <= DEV_SHOP_OPS_MAX ? ops : null;
}

/** 复合参数在 `devApplied` 中的可读形式：`buy:0,sell:I06,reroll`。 */
function formatShopOps(ops: readonly DevShopOp[]): string {
  return ops
    .map((op) => {
      if (op.kind === 'reroll') return 'reroll';
      if (op.kind === 'buy' && op.slot) return `buy:${op.target}@${op.slot}`;
      return `${op.kind}:${op.target}`;
    })
    .join(',');
}

/** 只接受 S01–S12；与药剂覆盖一样只影响第一个商店的技能格。 */
function parseShopSkill(raw: string | null): string | null {
  if (!raw) return null;
  return FREE_SKILL_BASE_PRICES.has(raw) ? raw : null;
}

/** 只接受 R01–R06；材料与金币仍由 `items`/`gold` 预置，不凭空发材料。 */
function parseCraft(raw: string | null): string | null {
  if (!raw) return null;
  return CRAFT_RECIPE_IDS.has(raw) ? raw : null;
}

/** 开局追踪的配方：只接受 R01–R06，职业可用与已拥有仍由追踪器判定。 */
function parseTrack(raw: string | null): string | null {
  if (!raw) return null;
  return CRAFT_RECIPE_IDS.has(raw) ? raw : null;
}

/**
 * 开发预置成品：只接受 R01–R06，每件唯一（重复 ID 判非法）。
 * 用于在正式商店/合成界面落地前核对成品战斗机制。
 */
function parseCrafted(raw: string | null): readonly string[] | null {
  if (!raw) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (!CRAFT_RECIPE_IDS.has(id) || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : null;
}

/** 开发预置技能：重复 ID 依次升级，最多 2 个不同技能、每个最高 3 级。 */
function parseSkillPresets(
  raw: string | null,
): readonly DevFreeSkillPreset[] | null {
  if (!raw) return null;
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (!FREE_SKILL_BASE_PRICES.has(id)) return null;
    const count = (counts.get(id) ?? 0) + 1;
    if (count > 3) return null;
    if (!counts.has(id)) order.push(id);
    counts.set(id, count);
  }
  if (order.length === 0 || order.length > 2) return null;
  return order.map((id) => ({ id, level: counts.get(id) ?? 1 }));
}

function formatSkillPresets(presets: readonly DevFreeSkillPreset[]): string {
  return presets.map((preset) => `${preset.id}:${preset.level}`).join(',');
}

/** 只接受 P02–P08；P01 是常驻按钮，不需要货架覆盖。 */
function parseShopPotion(raw: string | null): string | null {
  if (!raw) return null;
  return SHOP_POTION_IDS.has(raw) ? raw : null;
}

/**
 * 解析开局预置核心：只接受 E01–E08，重复 ID 直接判非法。
 * 核心唯一，开发场景也不允许靠重复参数叠出第二件。
 */
function parseCoreIds(raw: string | null): readonly string[] | null {
  if (!raw) return null;

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (!ELITE_CORE_IDS.has(id) || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }

  return ids.length > 0 ? ids : null;
}

/**
 * 解析预置金币：只接受 0–DEV_SCENARIO_MAX_GOLD 的整数。
 * 0 是合法值，用于验证金币不足分支；非法值回退到正常初始金币。
 */
/**
 * 解析开局预置海克斯：只接受 H01–H48，且不能重复（每种最高 1 层）。
 * 重复或未知 ID 视为非法，避免开发页静默少发一张。
 */
function parseHexIds(raw: string | null): readonly string[] | null {
  if (!raw) return null;

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (!KNOWN_HEX_IDS.has(id) || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }

  return ids.length > 0 && ids.length <= HEX_LIST.length ? ids : null;
}

function parseGold(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const gold = Number(raw);
  if (!Number.isSafeInteger(gold) || gold > DEV_SCENARIO_MAX_GOLD) return null;
  return gold;
}

/** 有界整数参数：只接受十进制整数，越界返回 null（由调用方记录失败原因）。 */
function parseBoundedInt(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

/** 开关参数：`1` 开启、`0` 关闭；其他写法视为非法而不是静默当 false。 */
function parseFlag(raw: string): boolean | null {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

/** 复合参数在 `devApplied` 中的可读形式：`id:数量,id:数量`。 */
function formatEnemyGroups(groups: readonly DevEnemyGroup[]): string {
  return groups.map((group) => `${group.enemyId}:${group.count}`).join(',');
}

/**
 * 解析开发场景参数，同时产出请求/生效对照。
 * 没有 `dev=1` 时 scenario 为 null；纯函数，不读取 `location`，便于单测固定 URL 输入。
 */
export function resolveDevScenario(search: string): DevScenarioResolution {
  const params = new URLSearchParams(search);
  const devRequested: Record<string, string> = {};
  const devApplied: Record<string, DevAppliedParam> = {};
  const failures: string[] = [];

  if (params.get('dev') !== '1') {
    return {
      scenario: null,
      report: { devRequested, devApplied, failureReason: null },
    };
  }

  const readParam = <T>(
    key: string,
    parse: (raw: string) => T | null,
    summarize: (value: T) => DevAppliedParam,
    reason: string,
  ): T | null => {
    const raw = params.get(key);
    if (raw === null) return null;
    devRequested[key] = raw;
    const value = parse(raw);
    if (value === null) {
      failures.push(`${key}=${raw === '' ? '（空）' : raw}：${reason}`);
      return null;
    }
    devApplied[key] = summarize(value);
    return value;
  };

  const seed = readParam('seed', parseSeed, (value) => value, '必须是无符号整数');
  const characterId = readParam(
    'character',
    parseCharacterId,
    (value) => value,
    '未知角色 ID',
  );
  const wave = readParam(
    'wave',
    parseWave,
    (value) => value,
    `必须是 1–${TOTAL_WAVES} 的整数`,
  );
  const enemies = readParam(
    'enemies',
    parseEnemyGroups,
    formatEnemyGroups,
    `格式 id:数量，单个类型 1–${DEV_SCENARIO_MAX_ENEMIES_PER_GROUP}，总数 ≤${DEV_SCENARIO_MAX_ENEMIES}，且 id 必须是已解锁的普通敌人`,
  );
  const upgrades = readParam(
    'upgrades',
    parseUpgradeIds,
    (ids) => ids.join(','),
    '包含未知强化 ID 或数量超过全部卡满层',
  );
  const hexes = readParam(
    'hexes',
    parseHexIds,
    (ids) => ids.join(','),
    `只接受 H01–H48 且不能重复，条目 ≤${HEX_LIST.length}`,
  );
  const xp = readParam(
    'xp',
    (raw) => parseBoundedInt(raw, 0, DEV_SCENARIO_MAX_XP),
    (value) => value,
    `必须是 0–${DEV_SCENARIO_MAX_XP} 的整数`,
  );
  const cores = readParam(
    'cores',
    parseCoreIds,
    (ids) => ids.join(','),
    '只接受 E01–E08 且不能重复',
  );
  const items = readParam(
    'items',
    parseItemIds,
    (ids) => ids.join(','),
    `只接受目录中的永久道具，重复 ID 不能超过各自叠层上限，条目 ≤${DEV_SCENARIO_MAX_ITEMS}`,
  );
  const shopOps = readParam(
    'shopOps',
    parseShopOps,
    formatShopOps,
    `格式 buy:槽位|道具ID|药剂ID|技能ID[@U|@I],sell:槽位|道具ID,reroll；槽位 0–${SHOP_MAIN_SLOT_COUNT - 1}，条目 ≤${DEV_SHOP_OPS_MAX}`,
  );
  const shopPotion = readParam(
    'shopPotion',
    parseShopPotion,
    (value) => value,
    '只接受 P02–P08；P01 是常驻按钮',
  );
  const shopSkill = readParam(
    'shopSkill',
    parseShopSkill,
    (value) => value,
    '只接受 S01–S12',
  );
  const craft = readParam(
    'craft',
    parseCraft,
    (value) => value,
    '只接受 R01–R06',
  );
  const track = readParam(
    'track',
    parseTrack,
    (value) => value,
    '只接受 R01–R06',
  );
  const crafted = readParam(
    'crafted',
    parseCrafted,
    (ids) => ids.join(','),
    '只接受 R01–R06 且不能重复',
  );
  const skills = readParam(
    'skills',
    parseSkillPresets,
    formatSkillPresets,
    '只接受 S01–S12，最多 2 个不同技能，同一 ID 重复表示升级且最高 3 级',
  );
  const gold = readParam(
    'gold',
    parseGold,
    (value) => value,
    `必须是 0–${DEV_SCENARIO_MAX_GOLD} 的整数`,
  );
  const maxHealth = readParam(
    'maxHealth',
    (raw) =>
      parseBoundedInt(raw, DEV_SCENARIO_MAX_HEALTH_MIN, DEV_SCENARIO_MAX_HEALTH_MAX),
    (value) => value,
    `必须是 ${DEV_SCENARIO_MAX_HEALTH_MIN}–${DEV_SCENARIO_MAX_HEALTH_MAX} 的整数`,
  );
  const damageTaken = readParam(
    'damageTaken',
    (raw) =>
      parseBoundedInt(raw, DEV_SCENARIO_DAMAGE_TAKEN_MIN, DEV_SCENARIO_DAMAGE_TAKEN_MAX),
    (value) => value,
    `必须是 ${DEV_SCENARIO_DAMAGE_TAKEN_MIN}–${DEV_SCENARIO_DAMAGE_TAKEN_MAX} 的整数`,
  );
  const waveSpeed = readParam(
    'waveSpeed',
    (raw) =>
      parseBoundedInt(raw, DEV_SCENARIO_WAVE_SPEED_MIN, DEV_SCENARIO_WAVE_SPEED_MAX),
    (value) => value,
    `必须是 ${DEV_SCENARIO_WAVE_SPEED_MIN}–${DEV_SCENARIO_WAVE_SPEED_MAX} 的整数`,
  );
  const perf = readParam('perf', parseFlag, (value) => value, '只接受 1 或 0');
  const triggerDemo = readParam(
    'triggerDemo',
    parseFlag,
    (value) => value,
    '只接受 1 或 0',
  );
  const eliteOnly = readParam(
    'eliteOnly',
    parseFlag,
    (value) => value,
    '只接受 1 或 0',
  );

  return {
    scenario: {
      seed,
      characterId,
      wave,
      enemies,
      upgrades,
      hexes,
      xp,
      cores,
      items,
      skills,
      shopOps,
      shopPotion,
      shopSkill,
      craft,
      track,
      crafted,
      gold,
      maxHealth,
      damageTaken,
      waveSpeed,
      eliteOnly: eliteOnly ?? false,
      perf: perf ?? false,
      triggerDemo: triggerDemo ?? false,
    },
    report: {
      devRequested,
      devApplied,
      failureReason: failures.length > 0 ? failures.join('；') : null,
    },
  };
}

/**
 * 只取开发场景配置；需要请求/生效对照时用 `resolveDevScenario`。
 * 纯函数，不读取 `location`，便于单测固定 URL 输入。
 */
export function parseDevScenario(search: string): DevScenario | null {
  return resolveDevScenario(search).scenario;
}

/**
 * 用场景参数替换起始波的刷怪名册：数量取组合总和、不额外刷精英。
 * 波次生命/伤害倍率与 Boss 波语义保持不变（Boss 波忽略组合覆盖）。
 */
export function applyScenarioToWave(
  definition: WaveDefinition,
  groups: readonly DevEnemyGroup[],
): WaveDefinition {
  if (definition.kind === 'boss') return definition;

  const roster: EnemyId[] = [];
  for (const group of groups) {
    for (let index = 0; index < group.count; index += 1) {
      roster.push(group.enemyId);
    }
  }

  return {
    ...definition,
    kind: 'normal',
    enemyCount: roster.length,
    eliteCount: 0,
    elite: undefined,
    roster,
  };
}

/** 场景起始波：未指定时仍从第 1 波开始。 */
export function scenarioStartWave(scenario: DevScenario | null): number {
  return scenario?.wave ?? 1;
}

/**
 * `eliteOnly=1`：精英波只保留精英，把普通敌人配额清零。
 * 波次时长、生命/伤害倍率与精英核心资格保持不变，清空或倒计时归零仍按原规则过关；
 * 非精英波与 Boss 波原样返回。
 */
export function applyEliteOnlyToWave(definition: WaveDefinition): WaveDefinition {
  if (definition.eliteCount <= 0 || !definition.elite) return definition;
  return {
    ...definition,
    enemyCount: 0,
    roster: [],
  };
}
