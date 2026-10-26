/**
 * V0.2 普通/高胡参考构筑的固定 Boss 场景校准（设计验证，不进入游戏运行时）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §数值预算验证：
 * - 预算模型输出只做算术一致性检查，不是通关率；
 * - 普通参考构筑只能用常见商品（普通/稀有道具，无成品、无棱彩海克斯）；
 * - 固定 Boss 场景用真实属性聚合、伤害减免与目录数值，不注入隐藏加成；
 * - 每档保留 普通 48.9–58.1 秒、高胡 22.0–26.2 秒的 Boss 理论用时目标。
 *
 * 场景是**固定输入脚本**的算术结算，不是 AI 通关：玩家持续对 Boss 输出、
 * 技能按冷却施放、Boss 每 1.4 秒提供一个 30 伤害等价窗口且 30% 命中
 * （与预算模型同一组测试假设）。不模拟走位、地图拥堵与 Boss 全部动作。
 *
 * 本模块只读取 `src/game/**` 的真实规则与目录数据，不复制数值。
 */
import {
  CHARACTER_LIST,
  getCharacter,
  getFreeSkill,
  getShopItem,
  type CharacterDefinition,
  type CharacterId,
  type DamageType,
} from '../../src/game/data';
import {
  characterBaseStats,
  StatAggregator,
  type StatModifier,
} from '../../src/game/stats';
import { ITEM_EFFECT_IDS, itemStatModifiers } from '../../src/game/item-effects';
import { ownedHexStatModifiers } from '../../src/game/hex-effects';
import {
  CRAFTED_ITEM_IDS,
  RECIPE_EFFECT_PARAMS,
  craftFee,
  craftedStatModifiers,
  type CraftedItemId,
} from '../../src/game/crafting';
import {
  G01_DAMAGE_BONUS_PER_STACK,
  G03_COOLDOWN_REDUCTION_PER_STACK,
  G04_MAX_HEALTH_BONUS_PER_STACK,
} from '../../src/game/upgrade-effects';
import {
  freeSkillStrength,
  freeSkillUpgradePrice,
  type FreeSkillLevel,
} from '../../src/game/free-skills';
import { shopPrice } from '../../src/game/shop-offer';
import { computeDamage } from '../../src/game/combat';
import { getEnemy } from '../../src/game/data/enemies';
import {
  FREE_SKILL_S01_DAMAGE_PER_SECOND,
  FREE_SKILL_S01_DAMAGE_TYPE,
  FREE_SKILL_S01_DURATION_SECONDS,
  FREE_SKILL_S02_DAMAGE,
  FREE_SKILL_S02_DAMAGE_TYPE,
  FREE_SKILL_S03_DAMAGE,
  FREE_SKILL_S03_DAMAGE_TYPE,
  FREE_SKILL_S04_DAMAGE_PER_SECOND,
  FREE_SKILL_S04_DAMAGE_TYPE,
  FREE_SKILL_S04_FIRE_DURATION_SECONDS,
  FREE_SKILL_S05_DAMAGE_PER_SECOND,
  FREE_SKILL_S05_DAMAGE_TYPE,
  FREE_SKILL_S05_DURATION_SECONDS,
  FREE_SKILL_S07_DAMAGE,
  FREE_SKILL_S07_DAMAGE_TYPE,
  FREE_SKILL_S08_DAMAGE_PER_SECOND,
  FREE_SKILL_S08_DAMAGE_TYPE,
  FREE_SKILL_S08_DURATION_SECONDS,
  FREE_SKILL_S09_DAMAGE_RATIO,
  FREE_SKILL_S09_DURATION_SECONDS,
  FREE_SKILL_S10_CONTACT_DAMAGE,
  FREE_SKILL_S10_DAMAGE_TYPE,
  FREE_SKILL_S11_DAMAGE,
  FREE_SKILL_S11_DAMAGE_TYPE,
  FREE_SKILL_S11_PELLET_COUNT,
  FREE_SKILL_S11_REPEAT_RATIO,
} from '../../src/game/free-skill-effects';
import { COMBAT_HEX_PARAMS } from '../../src/game/combat-hex-effects';
import { SORCERER_HEX_PARAMS } from '../../src/game/sorcerer-hex-effects';
import { TACTICIAN_HEX_PARAMS } from '../../src/game/tactician-hex-effects';
import { KNIGHT_HEX_PARAMS } from '../../src/game/knight-hex-effects';
import { EMOTIONAL_ABSORPTION_HITS } from '../../src/game/amiya';
import {
  E02_HITS_REQUIRED,
  E02_TRIGGER_DAMAGE,
  E04_PHANTOM_DAMAGE_RATIO,
  E04_PHANTOM_DURATION_SECONDS,
  E04_PHANTOM_INTERVAL_SECONDS,
  E04_SUMMON_DAMAGE_BONUS,
  E06_CASTS_REQUIRED,
  E06_ECHO_STRENGTH,
  E08_HITS_REQUIRED,
  E08_SIDE_BULLET_COUNT,
  E08_SIDE_BULLET_DAMAGE_RATIO,
} from '../../src/game/core-effects';
import {
  R05_FLOWFORM_ATTACK_INTERVAL_SECONDS,
  R05_FLOWFORM_DAMAGE,
  R05_FLOWFORM_DURATION_SECONDS,
  R05_FLOWFORM_INTERVAL_SECONDS,
} from '../../src/game/crafted-effects';

/** 设计预算目标（01 §数值预算验证）。 */
export const NORMAL_TTK_RANGE_SECONDS = { min: 48.9, max: 58.1 } as const;
export const HIGH_ROLL_TTK_RANGE_SECONDS = { min: 22.0, max: 26.2 } as const;
/** economy.csv 的参考金币总量；普通不要求成品，因此只校验不超预算。 */
export const NORMAL_GOLD_BUDGET = 2139;
export const HIGH_ROLL_GOLD_BUDGET = 2458;
/** 普通构筑的承伤余量下限（01 §数值预算验证：1.59–1.82）。 */
export const NORMAL_CAPACITY_MARGIN_MIN = 1.3;
/** Boss 每 1.4 秒一个 30 伤害等价窗口，命中率 30%（预算模型同一假设）。 */
export const BOSS_WINDOW_SECONDS = 1.4;
export const BOSS_WINDOW_DAMAGE = 30;
export const BOSS_HIT_RATE = 0.3;
/** 购买预算里的固定项：两瓶药剂与每商店一次重抽（01 §普通金币预算示例）。 */
export const POTION_BUDGET_GOLD = 180;
export const REROLL_BUDGET_GOLD = 90;

export type BuildTier = 'normal' | 'highRoll';

export interface ItemPurchase {
  readonly itemId: string;
  /** 该层在哪个商店（波末商店，1–17）购买，用于按真实波次价计价。 */
  readonly shopWave: number;
}

export interface SkillPurchase {
  readonly skillId: string;
  readonly shopWave: number;
  /** 购买后升到的等级；等级 2/3 的差价按 `freeSkillUpgradePrice` 计价。 */
  readonly targetLevel: FreeSkillLevel;
  readonly upgradeWave: number;
}

export interface ReferenceBuild {
  readonly id: string;
  readonly tier: BuildTier;
  readonly heroId: CharacterId;
  readonly label: string;
  /** 结算时持有的永久道具层数（合成材料已被成品消耗）。 */
  readonly items: Readonly<Record<string, number>>;
  /** 升级选择（等级为总层数）。 */
  readonly upgrades: Readonly<Record<string, number>>;
  readonly hexes: readonly string[];
  readonly cores: readonly string[];
  readonly crafted: readonly CraftedItemId[];
  readonly skills: readonly SkillPurchase[];
  /** 实际购买过的永久道具（含被合成消耗的材料），用于按波次价核对预算。 */
  readonly purchases: readonly ItemPurchase[];
  /**
   * H06 滑步开火（闪避后 1.5 秒攻速 +50%）在固定场景中的覆盖率。
   * 普通构筑取 0（不假设走位优化）；高胡按固定闪避节奏取 0.2–0.3。
   */
  readonly dodgeUptime?: number;
  /** 证据文字：构筑假设与固定场景的取舍。 */
  readonly assumptions: readonly string[];
}

export interface StreamBreakdown {
  readonly name: string;
  readonly damageType: DamageType;
  readonly rawDps: number;
  readonly dps: number;
}

export interface CalibrationRow {
  readonly buildId: string;
  readonly tier: BuildTier;
  readonly heroId: CharacterId;
  readonly heroName: string;
  readonly goldCost: number;
  readonly goldBudget: number;
  readonly maxHealth: number;
  readonly armor: number;
  readonly magicResist: number;
  readonly damageMultiplier: number;
  readonly attackSpeedMultiplier: number;
  readonly cooldownReduction: number;
  readonly regenPerSecond: number;
  readonly totalDps: number;
  readonly ttkSeconds: number;
  readonly expectedHits: number;
  readonly capacityMargin: number;
  readonly streams: readonly StreamBreakdown[];
  /** 本场景实际生效的加成来源 ID；必须全部来自构筑拥有集合。 */
  readonly appliedBonusSources: readonly string[];
  readonly notes: readonly string[];
}

const BOSS = getEnemy('boss');

function requireBoss(): { maxHealth: number; armor: number; magicResist: number } {
  if (!BOSS || BOSS.maxHealth !== 12000 || BOSS.armor !== 20) {
    throw new Error('Boss 数值与 01 §普通怪与最终Boss 不一致，校准场景已失效');
  }
  return BOSS;
}

/** 属性聚合：与 ArenaScene.syncStatSources 相同的来源顺序与口径。 */
export function aggregateBuild(build: ReferenceBuild): StatAggregator {
  const character = getCharacter(build.heroId);
  const stats = new StatAggregator(characterBaseStats(character));

  for (const itemId of ITEM_EFFECT_IDS) {
    stats.setSource(`item:${itemId}`, itemStatModifiers(itemId, build.items[itemId] ?? 0));
  }
  const percent = (entries: readonly { stat: StatModifier['stat']; value: number }[]): StatModifier[] =>
    entries
      .filter((entry) => Number.isFinite(entry.value) && entry.value !== 0)
      .map((entry) => ({ ...entry, mode: 'percent' }));
  stats.setSource(
    'upgrade:G01',
    percent([
      {
        stat: 'damage',
        value: G01_DAMAGE_BONUS_PER_STACK * (build.upgrades.G01 ?? 0),
      },
    ]),
  );
  stats.setSource(
    'upgrade:G03',
    percent([
      {
        stat: 'cooldownReduction',
        value: G03_COOLDOWN_REDUCTION_PER_STACK * (build.upgrades.G03 ?? 0),
      },
    ]),
  );
  const g04 = build.upgrades.G04 ?? 0;
  stats.setSource(
    'upgrade:G04',
    g04 > 0
      ? [
          {
            stat: 'maxHealth',
            mode: 'flat',
            value: G04_MAX_HEALTH_BONUS_PER_STACK * g04,
          },
        ]
      : [],
  );
  stats.setSource('hex:attribute', ownedHexStatModifiers(build.hexes));
  for (const recipeId of CRAFTED_ITEM_IDS) {
    stats.setSource(
      `craft:${recipeId}`,
      build.crafted.includes(recipeId) ? craftedStatModifiers(recipeId) : [],
    );
  }
  return stats;
}

/** 购买预算：道具按购买时的真实波次价，技能含购买价与升到目标等级的差价。 */
export function buildGoldCost(build: ReferenceBuild): number {
  let total = 0;
  for (const purchase of build.purchases) {
    const item = getShopItem(purchase.itemId);
    if (!item) throw new Error(`未知永久道具 ${purchase.itemId}`);
    total += shopPrice(item.basePrice, purchase.shopWave);
  }
  for (const purchase of build.skills) {
    const skill = getFreeSkill(purchase.skillId);
    if (!skill) throw new Error(`未知自由技能 ${purchase.skillId}`);
    let currentWavePrice = shopPrice(skill.basePrice, purchase.shopWave);
    total += currentWavePrice;
    for (let level = 2; level <= purchase.targetLevel; level += 1) {
      const upgrade = freeSkillUpgradePrice(currentWavePrice, level as 2 | 3);
      total += upgrade;
      currentWavePrice = shopPrice(skill.basePrice, purchase.upgradeWave);
    }
  }
  for (const recipeId of build.crafted) {
    total += craftFee(recipeId);
  }
  return total + POTION_BUDGET_GOLD + REROLL_BUDGET_GOLD;
}

interface Stream {
  readonly name: string;
  readonly damageType: DamageType;
  /** 每秒原始伤害；尚未乘构筑倍率与 Boss 减免。 */
  readonly rawDps: number;
  readonly channel: 'j' | 'skill' | 'sustained' | 'summon';
  /** 该流是否来自 U/I 自由技能（E06/R04 只放大自由技能）。 */
  readonly freeSkill?: boolean;
  /** 该流每秒的命中次数（E02 只统计法术命中）；缺省不计。 */
  readonly hitsPerSecond?: number;
}

/**
 * 术士 K 的固定场景等效冷却：被动「情绪吸收」每 N 次 J 命中使剩余冷却 −1 秒，
 * H32 把 N 由 5 降到 3。设每秒 J 命中 h、触发阈值 N，自洽解为
 * `base / (1 + h / N)`；只读取角色定义与 `SORCERER_HEX_PARAMS.H32`。
 */
export function emotionalAbsorptionCooldown(
  character: CharacterDefinition,
  hasResonance: boolean,
): number {
  const hitsPerTrigger = hasResonance
    ? Math.max(
        1,
        Math.floor(SORCERER_HEX_PARAMS.H32.hitsPerTrigger ?? EMOTIONAL_ABSORPTION_HITS),
      )
    : EMOTIONAL_ABSORPTION_HITS;
  const hitsPerSecond = 1 / character.attack.intervalSeconds;
  return character.skillK.cooldownSeconds / (1 + hitsPerSecond / hitsPerTrigger);
}

function attackSpeedStreams(
  character: CharacterDefinition,
  build: ReferenceBuild,
): Stream[] {
  const attack = character.attack;
  const streams: Stream[] = [
    {
      name: `${attack.key} ${attack.name}`,
      damageType: attack.damageType,
      rawDps: attack.damage / attack.intervalSeconds,
      channel: 'j',
      hitsPerSecond: 1 / attack.intervalSeconds,
    },
  ];
  if (character.id === 'vishdal' && attack.aftershock) {
    // 固定场景：Boss 体积足以被余震命中；直击附着的残影被同一发余震引爆。
    const afterimage = character.passive.afterimage?.damage ?? 0;
    streams.push({
      name: '余震 + 残影引爆',
      damageType: attack.aftershock.damageType,
      rawDps: ((attack.aftershock.damage + afterimage) / attack.intervalSeconds),
      channel: 'j',
    });
    // L 爆裂黎明：30 秒内 6 发榴弹伤害翻倍。
    streams.push({
      name: 'L 爆裂黎明（6 发翻倍）',
      damageType: attack.damageType,
      rawDps: (attack.damage * (character.skillL.params?.shots ?? 0)) / character.skillL.cooldownSeconds,
      channel: 'j',
    });
  }
  if (character.id === 'amiya') {
    const shots = character.skillK.params?.shots ?? 0;
    const perShot = character.skillK.params?.damagePerShot ?? 0;
    const kCooldown = emotionalAbsorptionCooldown(
      character,
      build.hexes.includes('H32'),
    );
    streams.push({
      name: 'K 精神爆发',
      damageType: 'magic',
      rawDps: (shots * perShot) / kCooldown,
      channel: 'skill',
      hitsPerSecond: shots / kCooldown,
    });
    // L 奇美拉：8 秒 +60%，按 J+K 伤害放大；真实伤害转换对高法抗目标略有增益，
    // 固定场景按基础倍率计。
    streams.push({
      name: 'L 奇美拉（+60%，8/30 秒）',
      damageType: 'magic',
      rawDps:
        ((attack.damage / attack.intervalSeconds + (shots * perShot) / kCooldown) *
          (character.skillL.params?.damageBonus ?? 0) *
          (character.skillL.durationSeconds ?? 0)) /
        character.skillL.cooldownSeconds,
      channel: 'skill',
    });
  }
  if (character.id === 'saria') {
    // L 钙质化：领域内每次 J 额外 10 法伤，持续 8/28 秒。
    streams.push({
      name: 'L 钙质化（每次 J 额外 10 法伤）',
      damageType: 'magic',
      rawDps:
        ((character.skillL.params?.attackBonusMagicDamage ?? 0) / attack.intervalSeconds) *
        ((character.skillL.durationSeconds ?? 0) / character.skillL.cooldownSeconds),
      channel: 'skill',
    });
  }
  if (character.id === 'muelsyse') {
    // 近战流形持续攻击；固定场景取近战形态并视为已叠满层数
    //（5 层 ×2 伤害，约 3.5 秒达成，相对 20–60 秒的 Boss 战可忽略爬坡）。
    const params = character.skillK.params ?? {};
    const damage =
      (params.meleeDamage ?? 0) + (params.meleeStackDamage ?? 0) * (params.meleeMaxStacks ?? 0);
    streams.push({
      name: '近战流形召唤物（满层）',
      damageType: 'physical',
      rawDps: damage / (params.meleeIntervalSeconds ?? 1),
      channel: 'summon',
    });
  }
  return streams;
}

/** 每次施放对单 Boss 的原始伤害；数值与伤害类型全部取自 `free-skill-effects`。 */
const FREE_SKILL_DAMAGE: Readonly<Record<string, (strength: number) => number>> = {
  S01: (s) => FREE_SKILL_S01_DAMAGE_PER_SECOND * FREE_SKILL_S01_DURATION_SECONDS * s,
  S02: (s) => FREE_SKILL_S02_DAMAGE * s,
  // 连锁电弧跳 4 个不同敌人；固定 Boss 场景只吃首目标一发。
  S03: (s) => FREE_SKILL_S03_DAMAGE * s,
  S04: (s) => FREE_SKILL_S04_DAMAGE_PER_SECOND * FREE_SKILL_S04_FIRE_DURATION_SECONDS * s,
  S05: (s) => FREE_SKILL_S05_DAMAGE_PER_SECOND * FREE_SKILL_S05_DURATION_SECONDS * s,
  S06: () => 0,
  S07: (s) => FREE_SKILL_S07_DAMAGE * s,
  S08: (s) => FREE_SKILL_S08_DAMAGE_PER_SECOND * FREE_SKILL_S08_DURATION_SECONDS * s,
  S09: () => 0,
  S10: (s) => FREE_SKILL_S10_CONTACT_DAMAGE * s,
  // 首弹吃满伤害，后续弹丸按 repeatDamageRatio 结算。
  S11: (s) =>
    (FREE_SKILL_S11_DAMAGE +
      (FREE_SKILL_S11_PELLET_COUNT - 1) * FREE_SKILL_S11_DAMAGE * FREE_SKILL_S11_REPEAT_RATIO) *
    s,
  S12: () => 0,
};

const FREE_SKILL_DAMAGE_TYPE: Readonly<Record<string, DamageType>> = {
  S01: FREE_SKILL_S01_DAMAGE_TYPE,
  S02: FREE_SKILL_S02_DAMAGE_TYPE,
  S03: FREE_SKILL_S03_DAMAGE_TYPE,
  S04: FREE_SKILL_S04_DAMAGE_TYPE,
  S05: FREE_SKILL_S05_DAMAGE_TYPE,
  S07: FREE_SKILL_S07_DAMAGE_TYPE,
  S08: FREE_SKILL_S08_DAMAGE_TYPE,
  S10: FREE_SKILL_S10_DAMAGE_TYPE,
  S11: FREE_SKILL_S11_DAMAGE_TYPE,
};

function freeSkillStreams(
  build: ReferenceBuild,
  cooldownMultiplier: number,
  character: CharacterDefinition,
): Stream[] {
  const streams: Stream[] = [];
  for (const skill of build.skills) {
    const definition = getFreeSkill(skill.skillId);
    if (!definition) throw new Error(`未知自由技能 ${skill.skillId}`);
    // S09 水镜替身：复制 J 的 35% 伤害，按存在时间/冷却折算。
    if (skill.skillId === 'S09') {
      const uptime = FREE_SKILL_S09_DURATION_SECONDS /
        (definition.cooldownSeconds * cooldownMultiplier);
      streams.push({
        name: 'S09 水镜替身（复制 J 35%）',
        damageType: character.attack.damageType,
        rawDps:
          (character.attack.damage / character.attack.intervalSeconds) *
          FREE_SKILL_S09_DAMAGE_RATIO *
          uptime,
        channel: 'j',
        freeSkill: true,
      });
      continue;
    }
    const strength = freeSkillStrength(skill.targetLevel);
    const damage = FREE_SKILL_DAMAGE[skill.skillId]?.(strength) ?? 0;
    if (damage <= 0) continue;
    const cooldown = definition.cooldownSeconds * cooldownMultiplier;
    const channel = skill.skillId === 'S01' || skill.skillId === 'S04' || skill.skillId === 'S08'
      ? 'sustained'
      : skill.skillId === 'S05'
        ? 'summon'
        : 'skill';
    streams.push({
      name: `${skill.skillId} ${definition.name}`,
      damageType: FREE_SKILL_DAMAGE_TYPE[skill.skillId] ?? 'magic',
      rawDps: damage / cooldown,
      channel,
      freeSkill: true,
    });
  }
  return streams;
}

/** 触发类加成产生的独立伤害流；`source` 为贡献该效果的构筑 ID。 */
interface BonusStream {
  readonly name: string;
  readonly source: string;
  readonly damageType: DamageType;
  readonly rawDps: number;
  readonly channel: 'j' | 'skill' | 'sustained' | 'summon';
  readonly freeSkill?: boolean;
}

/**
 * 高胡专属触发倍率。每条效果都按**它自己的海克斯/成品 ID** 读取参数
 *（`COMBAT_HEX_PARAMS`、`SORCERER_HEX_PARAMS`、`TACTICIAN_HEX_PARAMS`、
 * `KNIGHT_HEX_PARAMS`、`core-effects`、`RECIPE_EFFECT_PARAMS`），
 * 未拥有该 ID 时不生效；`sources` 记录本场景真正用到的来源，供测试校验
 * 「生效来源 ⊆ 构筑拥有集合」。
 */
function triggerMultipliers(build: ReferenceBuild): {
  j: number;
  skill: number;
  summon: number;
  sources: string[];
  bonusStreams: BonusStream[];
  extraTrueDps: (magicHitsPerSecond: number) => number;
  extraMagicDps: number;
  extraFlatTrueDps: number;
} {
  const has = (id: string): boolean =>
    build.hexes.includes(id) || build.cores.includes(id);
  const character = getCharacter(build.heroId);
  const sources: string[] = [];
  const bonusStreams: BonusStream[] = [];
  const apply = (source: string): void => {
    sources.push(source);
  };
  let j = 1;
  let skill = 1;
  let summon = 1;
  let extraMagicDps = 0;
  let extraFlatTrueDps = 0;
  // H13 追击扳机：连续命中同一目标叠满 +24%，固定场景视为稳定满层。
  if (has('H13')) {
    j *= 1 + (COMBAT_HEX_PARAMS.H13.maxDamagePercent ?? 24) / 100;
    apply('H13');
  }
  // H14 折返弹：每第 N 发返程 35%，按发射频率折算平均加成。
  if (has('H14')) {
    const every = Math.max(1, Math.floor(COMBAT_HEX_PARAMS.H14.returnEveryNthShot ?? 3));
    j *= 1 + (COMBAT_HEX_PARAMS.H14.returnDamageRatio ?? 0.35) / every;
    apply('H14');
  }
  // E08 折光王冠：每 6 次 J 命中 2 枚 30% 侧弹。
  if (has('E08')) {
    j *= 1 + (E08_SIDE_BULLET_COUNT * E08_SIDE_BULLET_DAMAGE_RATIO) / E08_HITS_REQUIRED;
    apply('E08');
  }
  // R03 折镜机关：每次 J 追加 2 枚 40% 侧弹。
  if (build.crafted.includes('R03')) {
    const params = RECIPE_EFFECT_PARAMS.R03.params;
    j *=
      1 +
      (params.sideProjectileCount ?? 2) * (params.sideProjectileDamageRatio ?? 0.4);
    apply('R03');
  }
  // 术士 H32 心绪共鸣：情绪吸收阈值 5→3。K 频率的提升在 `attackSpeedStreams` 内按
  // `resolveEmotionalAbsorptionHits` 的同一口径结算，这里只登记来源。
  if (build.heroId === 'amiya' && has('H32')) apply('H32');
  // 术士 H36 失控奇美拉：奇美拉期间每第 4 次命中 50 真伤。
  if (build.heroId === 'amiya' && has('H36')) {
    const hitsPerSecond = 1 / character.attack.intervalSeconds;
    const duration = character.skillL.durationSeconds ?? 8;
    const every = Math.max(
      1,
      Math.floor(SORCERER_HEX_PARAMS.H36.chimeraHitsPerBonus ?? 4),
    );
    const bonus = SORCERER_HEX_PARAMS.H36.chimeraBonusDamage ?? 50;
    extraFlatTrueDps +=
      (bonus * ((hitsPerSecond * duration) / character.skillL.cooldownSeconds)) / every;
    apply('H36');
  }
  // 骑士 H40 守护转攻：盾击（本体 J）伤害 +35%；护盾获得 −20% 不影响固定场景输出。
  if (build.heroId === 'saria' && has('H40')) {
    j *= KNIGHT_HEX_PARAMS.H40.bashDamageMultiplier ?? 1.35;
    apply('H40');
  }
  // 骑士 H38 钙质反应：领域每秒 16 法伤，按 L 的持续/冷却折算。
  if (build.heroId === 'saria' && has('H38')) {
    const fieldDps = KNIGHT_HEX_PARAMS.H38.fieldDamagePerSecond ?? 16;
    bonusStreams.push({
      name: 'H38 钙质反应（领域每秒 16 法伤）',
      source: 'H38',
      damageType: 'magic',
      rawDps:
        fieldDps *
        ((character.skillL.durationSeconds ?? 8) / character.skillL.cooldownSeconds),
      channel: 'skill',
    });
    apply('H38');
  }
  // 战术家 H46 脆弱军团：召唤物伤害 +35%（生命 −25% 不影响输出上限）。
  if (build.heroId === 'muelsyse' && has('H46')) {
    summon *= TACTICIAN_HEX_PARAMS.H46.summonDamageMultiplier ?? 1.35;
    apply('H46');
  }
  // 战术家 H47 水镜共鸣：J 命中使主流形补一次 40% 攻击，内置冷却 0.6 秒。
  // 追加攻击按召唤物结算（不是 J 本体倍率），且只在构筑明确拥有 H47 时生效。
  if (build.heroId === 'muelsyse' && has('H47')) {
    const flowform = character.skillK.params ?? {};
    const flowformDamage =
      (flowform.meleeDamage ?? 0) +
      (flowform.meleeStackDamage ?? 0) * (flowform.meleeMaxStacks ?? 0);
    const jHitsPerSecond = 1 / character.attack.intervalSeconds;
    const internalCooldown = TACTICIAN_HEX_PARAMS.H47.internalCooldownSeconds ?? 0.6;
    const procPerSecond = Math.min(jHitsPerSecond, 1 / internalCooldown);
    bonusStreams.push({
      name: 'H47 水镜共鸣（主流形补击）',
      source: 'H47',
      damageType: 'physical',
      rawDps:
        flowformDamage * (TACTICIAN_HEX_PARAMS.H47.damageRatio ?? 0.4) * procPerSecond,
      channel: 'summon',
    });
    apply('H47');
  }
  // E06 回响之核：每第 3 次 U/I 施放 45% 复唱 → 免费技能平均 +15%。
  if (has('E06')) {
    skill *= 1 + E06_ECHO_STRENGTH / E06_CASTS_REQUIRED;
    apply('E06');
  }
  // R04 永昼回路：每第 4 次施放返还 35% 冷却。
  if (build.crafted.includes('R04')) {
    const params = RECIPE_EFFECT_PARAMS.R04.params;
    skill *=
      1 +
      (params.refundCooldownRatio ?? 0.35) /
        Math.max(1, Math.floor(params.refundEveryCasts ?? 4));
    apply('R04');
  }
  // E04 群落意志：召唤物 +20%，幻影按存在占比再放大。
  if (has('E04')) {
    summon *=
      (1 + E04_SUMMON_DAMAGE_BONUS) *
      (1 +
        E04_PHANTOM_DAMAGE_RATIO *
          (E04_PHANTOM_DURATION_SECONDS / E04_PHANTOM_INTERVAL_SECONDS));
    apply('E04');
  }
  // H21 漂浮弹幕：每 12 次 J 命中发出 8 向各 22 法伤弹；单体 Boss 只吃 1 发。
  if (has('H21')) {
    extraMagicDps =
      (1 / character.attack.intervalSeconds /
        Math.max(1, Math.floor(COMBAT_HEX_PARAMS.H21.barrageHitInterval ?? 12))) *
      (COMBAT_HEX_PARAMS.H21.barrageDamagePerProjectile ?? 22);
    apply('H21');
  }
  // E02 星蚀之眼：每 8 次法术命中 90 真实伤害；命中数由 evaluateBuild 回填。
  if (has('E02')) apply('E02');
  return {
    j,
    skill,
    summon,
    sources,
    bonusStreams,
    extraTrueDps: (magicHitsPerSecond: number) =>
      has('E02') ? (magicHitsPerSecond / E02_HITS_REQUIRED) * E02_TRIGGER_DAMAGE : 0,
    extraMagicDps,
    extraFlatTrueDps,
  };
}

/** 成品常驻被动产生的独立伤害流（当前只有 R05 每 12 秒生成 5 秒小流形）。 */
function craftedPassiveStreams(build: ReferenceBuild): BonusStream[] {
  if (!build.crafted.includes('R05')) return [];
  const uptime = R05_FLOWFORM_DURATION_SECONDS / R05_FLOWFORM_INTERVAL_SECONDS;
  return [
    {
      name: 'R05 潮生母巢（小流形，5/12 秒）',
      source: 'R05',
      damageType: 'magic',
      rawDps:
        (R05_FLOWFORM_DAMAGE / R05_FLOWFORM_ATTACK_INTERVAL_SECONDS) * uptime,
      channel: 'summon',
    },
  ];
}

/** 固定 Boss 场景结算。 */
export function evaluateBuild(build: ReferenceBuild): CalibrationRow {
  const boss = requireBoss();
  const character = getCharacter(build.heroId);
  const stats = aggregateBuild(build);
  const cooldownMultiplier = Math.max(0.1, 1 - stats.cooldownReduction);
  const triggers = triggerMultipliers(build);
  const craftedStreams = craftedPassiveStreams(build);

  // H13 与 H14 属于常驻触发，计入普通/高胡同一口径；普通构筑也允许金/银海克斯。
  const allStreams: Stream[] = [
    ...attackSpeedStreams(character, build),
    ...freeSkillStreams(build, cooldownMultiplier, character),
  ];
  // 未模拟走位/静止条件，I12 等条件增伤不参与固定场景。
  const jMultiplier =
    stats.damageMultiplier *
    stats.directDamageMultiplier *
    stats.normalAttackDamageMultiplier *
    triggers.j;
  const skillMultiplier =
    stats.damageMultiplier *
    stats.directDamageMultiplier *
    stats.skillDamageMultiplier;
  const sustainedMultiplier =
    stats.damageMultiplier *
    stats.skillDamageMultiplier *
    stats.damageOverTimeMultiplier *
    stats.recipeDamageOverTimeMultiplier;
  const summonMultiplier =
    stats.damageMultiplier * stats.summonDamageMultiplier * triggers.summon;
  const channelMultiplier = (channel: Stream['channel']): number => {
    switch (channel) {
      case 'j':
        return jMultiplier;
      case 'skill':
        return skillMultiplier;
      case 'sustained':
        return sustainedMultiplier;
      case 'summon':
        return summonMultiplier;
    }
  };

  const breakdown: StreamBreakdown[] = [];
  let magicHitsPerSecond = 0;
  for (const stream of allStreams) {
    const multiplier =
      channelMultiplier(stream.channel) * (stream.freeSkill ? triggers.skill : 1);
    // 攻速只作用于与 J 同节奏的直击/余震/残影流；H06 按固定闪避覆盖率折算。
    const dodgeFactor =
      stream.channel === 'j' && build.hexes.includes('H06')
        ? 1 + 0.5 * (build.dodgeUptime ?? 0)
        : 1;
    const attackSpeed =
      stream.channel === 'j' ? stats.attackSpeedMultiplier * dodgeFactor : 1;
    const rawDps = stream.rawDps * attackSpeed;
    const scaled = rawDps * multiplier;
    if (stream.damageType === 'magic' && stream.hitsPerSecond) {
      const frequency = stream.channel === 'skill' ? 1 / cooldownMultiplier : attackSpeed;
      magicHitsPerSecond += stream.hitsPerSecond * frequency;
    }
    breakdown.push({
      name: stream.name,
      damageType: stream.damageType,
      rawDps,
      dps: computeDamage(scaled, stream.damageType, boss.armor, boss.magicResist),
    });
  }

  // 触发/成品被动产生的独立伤害流：按各自通道倍率结算，不再叠加攻速。
  for (const bonus of [...triggers.bonusStreams, ...craftedStreams]) {
    const scaled = bonus.rawDps * channelMultiplier(bonus.channel);
    breakdown.push({
      name: bonus.name,
      damageType: bonus.damageType,
      rawDps: bonus.rawDps,
      dps: computeDamage(scaled, bonus.damageType, boss.armor, boss.magicResist),
    });
  }

  if (triggers.extraMagicDps > 0) {
    const scaled = triggers.extraMagicDps * stats.damageMultiplier;
    breakdown.push({
      name: 'H21 漂浮弹幕（单体 1 发）',
      damageType: 'magic',
      rawDps: triggers.extraMagicDps,
      dps: computeDamage(scaled, 'magic', boss.armor, boss.magicResist),
    });
  }

  const trueDps = triggers.extraTrueDps(magicHitsPerSecond) + triggers.extraFlatTrueDps;
  if (trueDps > 0) {
    breakdown.push({
      name: '真实伤害（E02/H36）',
      damageType: 'true',
      rawDps: trueDps,
      dps: trueDps,
    });
  }

  const totalDps = breakdown.reduce((sum, entry) => sum + entry.dps, 0);
  const ttkSeconds = boss.maxHealth / totalDps;
  const regenPerSecond = itemRegen(build) + (build.hexes.includes('H20') ? 0.5 : 0);
  const impact = computeDamage(BOSS_WINDOW_DAMAGE, 'physical', stats.armor, 0);
  const expectedHits = (ttkSeconds / BOSS_WINDOW_SECONDS) * BOSS_HIT_RATE;
  const capacity = (stats.maxHealth + regenPerSecond * ttkSeconds) / impact;

  return {
    buildId: build.id,
    tier: build.tier,
    heroId: build.heroId,
    heroName: character.name,
    goldCost: buildGoldCost(build),
    goldBudget: build.tier === 'normal' ? NORMAL_GOLD_BUDGET : HIGH_ROLL_GOLD_BUDGET,
    maxHealth: stats.maxHealth,
    armor: stats.armor,
    magicResist: stats.magicResist,
    damageMultiplier: stats.damageMultiplier,
    attackSpeedMultiplier: stats.attackSpeedMultiplier,
    cooldownReduction: stats.cooldownReduction,
    regenPerSecond,
    totalDps,
    ttkSeconds,
    expectedHits,
    capacityMargin: expectedHits > 0 ? capacity / expectedHits : Number.POSITIVE_INFINITY,
    streams: breakdown,
    appliedBonusSources: [
      ...triggers.sources,
      ...craftedStreams.map((stream) => stream.source),
    ],
    notes: build.assumptions,
  };
}

/** I09 每 5 秒回复 4 生命，按层数累计。 */
function itemRegen(build: ReferenceBuild): number {
  return ((build.items.I09 ?? 0) * 4) / 5;
}

export function evaluateAll(): CalibrationRow[] {
  return REFERENCE_BUILDS.map(evaluateBuild);
}

/** 固定输入场景的参考构筑；只使用目录里真实存在的 ID。 */
export const REFERENCE_BUILDS: readonly ReferenceBuild[] = [
  normalBuild('vishdal', 'E08', 'S03', 'S05', {
    items: { I02: 1 },
    hexes: ['H03', 'H04', 'H09', 'H14', 'H20'],
  }),
  normalBuild('amiya', 'E02', 'S03', 'S05', {
    hexes: ['H03', 'H04', 'H14', 'H20'],
  }),
  normalBuild('saria', 'E06', 'S01', 'S05', {
    hexes: ['H03', 'H04', 'H09', 'H13', 'H14'],
  }),
  normalBuild('muelsyse', 'E04', 'S01', 'S05', {
    hexes: ['H03', 'H04', 'H09', 'H13', 'H14', 'H20'],
  }),
  ...highRollBuilds(),
];

interface NormalOptions {
  readonly items?: Readonly<Record<string, number>>;
  readonly hexes?: readonly string[];
}

function purchaseWaves(itemId: string, count: number, startWave = 1): ItemPurchase[] {
  // 同一件道具的叠层按商店顺序错开购买，价格随波次真实上浮。
  return Array.from({ length: count }, (_, index) => ({
    itemId,
    shopWave: startWave + index * 2,
  }));
}

function normalBuild(
  heroId: CharacterId,
  core: string,
  skillA: string,
  skillB: string,
  options: NormalOptions = {},
): ReferenceBuild {
  const items: Record<string, number> = {
    I01: 3,
    I02: 3,
    I03: 3,
    I06: 3,
    I08: 2,
    I09: 2,
    I10: 1,
    ...options.items,
  };
  const purchases: ItemPurchase[] = [];
  for (const [itemId, stacks] of Object.entries(items)) {
    purchases.push(...purchaseWaves(itemId, stacks, itemId === 'I01' ? 1 : 2));
  }
  return {
    id: `${heroId}-normal`,
    tier: 'normal',
    heroId,
    label: `${getCharacter(heroId).name} 普通构筑`,
    items,
    upgrades: { G01: 3, G03: 1, G04: 3 },
    hexes: options.hexes ?? ['H03', 'H04', 'H09', 'H13'],
    cores: [core],
    crafted: [],
    skills: [
      { skillId: skillA, shopWave: 7, targetLevel: 2, upgradeWave: 10 },
      { skillId: skillB, shopWave: 8, targetLevel: 2, upgradeWave: 12 },
    ],
    purchases,
    assumptions: [
      '仅使用普通/稀有永久道具与金/银海克斯，不含成品与棱彩海克斯。',
      '固定场景：持续贴 Boss 输出，技能按冷却施放，Boss 命中率 30%。',
      '普通构筑按职业微调道具叠层，使四个职业落在同一预算窗口；未使用隐藏加成。',
    ],
  };
}

function highRollBuilds(): ReferenceBuild[] {
  return CHARACTER_LIST.map((character) => {
    const recipes: CraftedItemId[] =
      character.id === 'vishdal'
        ? ['R03']
        : character.id === 'amiya'
          ? ['R04']
          : character.id === 'saria'
            ? ['R03']
            : ['R05', 'R03'];
    const core =
      character.id === 'vishdal' || character.id === 'saria'
        ? 'E08'
        : character.id === 'amiya'
          ? 'E02'
          : 'E04';
    const items: Record<string, number> = {
      I01: 3,
      I02: 2,
      I03: 3,
      I06: 3,
      I07: 3,
      I08: 3,
      I09: 2,
      I23: 1,
    };
    const purchases: ItemPurchase[] = [];
    for (const [itemId, stacks] of Object.entries(items)) {
      purchases.push(...purchaseWaves(itemId, stacks, 2));
    }
    // 配方材料按真实层数购买；成品消耗 1 层，结算层数里扣掉。
    for (const recipe of recipes) {
      if (recipe === 'R03') {
        items.I03 = (items.I03 ?? 0) - 1;
        purchases.push({ itemId: 'I14', shopWave: 11 }, { itemId: 'I21', shopWave: 12 });
      }
      if (recipe === 'R04') {
        items.I07 = (items.I07 ?? 0) - 1;
        items.I08 = (items.I08 ?? 0) - 1;
        purchases.push({ itemId: 'I15', shopWave: 11 });
      }
      if (recipe === 'R05') {
        items.I09 = 1;
        purchases.push(
          { itemId: 'I19', shopWave: 11 },
          { itemId: 'I20', shopWave: 12 },
        );
      }
    }
    const hexes = ['H03', 'H04', 'H09', 'H19', 'H06'];
    // 触发类海克斯按职业取舍：近战职业用 R03 已能达标，不再叠 H13/H14。
    if (character.id === 'amiya') {
      hexes.push('H13', 'H14', 'H21', 'H32', 'H36');
    } else if (character.id === 'muelsyse') {
      hexes.push('H13', 'H14', 'H21');
    } else if (character.id === 'saria') {
      hexes.push('H13', 'H38', 'H40');
    } else if (character.id === 'vishdal') {
      hexes.push('H21');
    }
    if (character.id === 'muelsyse') {
      hexes.push('H45', 'H46');
    }
    // 高胡场景假设玩家保持闪避节奏，H06 的 1.5 秒窗口覆盖 20–30%。
    const dodgeUptime = character.id === 'saria' || character.id === 'muelsyse' ? 0.3 : 0.2;
    return {
      id: `${character.id}-high-roll`,
      tier: 'highRoll',
      heroId: character.id,
      label: `${character.name} 高胡构筑`,
      items,
      upgrades: { G01: 3, G03: 2, G04: 2 },
      hexes,
      cores: [core],
      crafted: recipes,
      skills: [
        { skillId: 'S01', shopWave: 7, targetLevel: 3, upgradeWave: 13 },
        { skillId: 'S03', shopWave: 9, targetLevel: 3, upgradeWave: 14 },
      ],
      dodgeUptime,
      purchases,
      assumptions: [
        '含成品、棱彩海克斯、职业专属海克斯与稀有/史诗道具，用于验证成型后的上限。',
        'H13/H14/H21 的触发按固定场景的稳定值折算，未模拟随机弹道。',
        'H06 按固定闪避节奏覆盖 20–30% 的 1.5 秒攻速窗口。',
        '骑士取 H38 领域与 H40 盾击；战术家取 H45 控制、H46 召唤物 +35% 与 R05 小流形；未拥有 H47，其补击不计入。',
      ],
    };
  });
}

export interface CalibrationSummary {
  readonly rows: readonly CalibrationRow[];
  readonly normalWithinBudget: boolean;
  readonly highRollWithinBudget: boolean;
  readonly normalTtkWithinRange: boolean;
  readonly highRollTtkWithinRange: boolean;
  readonly atLeastDoubleSpeed: boolean;
}

export function summarize(rows: readonly CalibrationRow[]): CalibrationSummary {
  const normal = rows.filter((row) => row.tier === 'normal');
  const high = rows.filter((row) => row.tier === 'highRoll');
  return {
    rows,
    normalWithinBudget: normal.every((row) => row.goldCost <= row.goldBudget),
    highRollWithinBudget: high.every((row) => row.goldCost <= row.goldBudget),
    normalTtkWithinRange: normal.every(
      (row) =>
        row.ttkSeconds >= NORMAL_TTK_RANGE_SECONDS.min &&
        row.ttkSeconds <= NORMAL_TTK_RANGE_SECONDS.max,
    ),
    highRollTtkWithinRange: high.every(
      (row) =>
        row.ttkSeconds >= HIGH_ROLL_TTK_RANGE_SECONDS.min &&
        row.ttkSeconds <= HIGH_ROLL_TTK_RANGE_SECONDS.max,
    ),
    atLeastDoubleSpeed: normal.every((normalRow) => {
      const highRow = high.find((row) => row.heroId === normalRow.heroId);
      return highRow !== undefined && normalRow.ttkSeconds >= highRow.ttkSeconds * 2;
    }),
  };
}
