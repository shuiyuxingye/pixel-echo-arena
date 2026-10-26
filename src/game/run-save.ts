/**
 * 续局快照（docs/game-design.md §9）：纯数据与 localStorage 读写，不依赖 Phaser/DOM。
 *
 * - 在波初、波间、生成强化选项、重抽完成与选卡完成时写入同一份快照；
 * - 快照只包含可序列化的逻辑状态（角色、生命、等级经验、金币、已选强化、波次、重抽、
 *   随机状态、待选手牌与奖励队列），不包含渲染对象、音频或函数；
 * - 明确 `schemaVersion`，损坏或未知版本提示原因，重置只删除本游戏的键；
 * - 存储不可写时返回 false，由场景显示“本局无法保存”，不阻断本局。
 */
import {
  TOTAL_WAVES,
  UPGRADE_LIST,
  getConsumable,
  getFreeSkill,
  getHex,
  getRecipe,
  getShopItem,
  isCharacterId,
  type CharacterId,
} from './data';
import { HEX_OWNER_BY_CHARACTER } from './hex';
import { CORE_REWARD_IDS } from './elite';
import { ELITE_CORE_IDS } from './core-offer';
import type { RunItemStack } from './item-inventory';
import { MAX_LEVEL, MIN_LEVEL } from './progression';
import {
  MAX_REWARD_ENTRIES,
  isRewardKind,
  isRewardStatus,
  isValidRewardExtra,
  type RewardEntry,
} from './rewards';
import {
  validateWorldSnapshot,
  type RunWorldSnapshot,
} from './world-snapshot';
import {
  validateTriggerGateSnapshot,
  type TriggerGateSnapshot,
} from './trigger-gates';
import {
  validateCoreEffectsSnapshot,
  type CoreEffectsSnapshot,
} from './core-effects';
import {
  MATERIAL_SUPPLY_INTERVAL_SHOPS,
  type RecipeTrackerSnapshot,
} from './recipe-tracking';
import { isFreeSkillSave, type FreeSkillSave } from './free-skills';
import {
  isFreeSkillEffectsSave,
  type FreeSkillEffectsSave,
} from './free-skill-effects';
import {
  isCraftedMechanicsSave,
  type CraftedMechanicsSave,
} from './crafted-effects';
import {
  isConsumableSave,
  type ConsumableGroupSave,
  type ConsumableSave,
} from './consumable-effects';
import { CRAFTED_ITEM_IDS, isCraftedItemId } from './crafting';
import { isValidRandomState, type RunRandomSnapshot } from './random';
import { isItemUsableByCharacter } from './item-requirements';
import {
  P02_FIRST_SHOP_WAVE,
  SHOP_EMERGENCY_POTION_ID,
  SHOP_LAST_WAVE,
  SHOP_MAIN_SLOT_COUNT,
  shopOfferKindForSlot,
  type ShopShelfSnapshot,
} from './shop-offer';

import { V2_STORAGE_KEYS } from './storage-namespace';

/** 续局快照的 localStorage 键；重置只 delete 这一个键。 */
export const RUN_SAVE_STORAGE_KEY = V2_STORAGE_KEYS.run;

/** Phaser registry 中交给场景的续局快照键（由应用壳在创建游戏前写入）。 */
export const RUN_CHECKPOINT_REGISTRY_KEY = 'pixel-echo.run-checkpoint';

/** 快照结构版本；不兼容时进入“未知版本”分支，不尝试猜测字段。 */
export const RUN_SAVE_SCHEMA_VERSION = 1;

/** 本局默认重抽次数上限的宽松校验值，只用于拒绝异常数据。 */
const MAX_REROLLS = 99;

/** 奖励队列的宽松上限，避免损坏数据造成异常循环。 */
const MAX_PENDING_REWARDS = 20;

/** 支付账本单个道具的宽松记录上限，防止损坏数据造成异常循环。 */
const MAX_PAYMENT_LAYERS = 99;

/**
 * 保存时机，与 §9 的检查点列表一一对应。
 * 阶段类检查点（波初/波末/波间/选项/重抽）之外，每个会改变账本的提交边界
 * 另有独立类型，便于刷新后判断恢复的是边界之前还是之后的确定状态。
 */
export type RunCheckpointKind =
  | 'wave-start'
  | 'wave-end'
  | 'intermission'
  | 'upgrade-options'
  | 'reroll'
  | 'card-selected'
  | 'reward-claimed'
  | 'chest-claimed'
  | 'core-claimed'
  | 'hex-selected'
  | 'shop-purchase'
  | 'shop-craft'
  | 'skill-equipped';

const CHECKPOINT_KINDS: ReadonlySet<string> = new Set<RunCheckpointKind>([
  'wave-start',
  'wave-end',
  'intermission',
  'upgrade-options',
  'reroll',
  'card-selected',
  'reward-claimed',
  'chest-claimed',
  'core-claimed',
  'hex-selected',
  'shop-purchase',
  'shop-craft',
  'skill-equipped',
]);

/** 可能发生在波内的提交边界；这些检查点必须一并保存世界状态与技能效果。 */
const WORLD_CHECKPOINT_KINDS: ReadonlySet<string> = new Set<RunCheckpointKind>([
  'upgrade-options',
  'reroll',
  'card-selected',
  'hex-selected',
]);

/** 该检查点是否在波内提交（需要世界快照）。 */
export function isWorldCheckpointKind(kind: RunCheckpointKind): boolean {
  return WORLD_CHECKPOINT_KINDS.has(kind);
}

/** 快照里保留的奖励流转阶段；`absorb` 是同一逻辑步内的瞬时阶段，不必落盘。 */
export type RunSavedRewardStage =
  | 'none'
  | 'briefing'
  | 'chest'
  | 'core'
  | 'upgrade'
  | 'mechanic'
  | 'intermission';

const REWARD_STAGES: ReadonlySet<string> = new Set<RunSavedRewardStage>([
  'none',
  'briefing',
  'chest',
  'core',
  'upgrade',
  'mechanic',
  'intermission',
]);

export interface RunUpgradeStack {
  readonly id: string;
  readonly stacks: number;
}

/** 逐件道具的购买支付账本；每层实际支付金币，出售时按 40% 回收。 */
export interface RunShopPayment {
  readonly id: string;
  readonly paid: readonly number[];
}

/** V2 快照中的当前商店：货架身份/价格/售出/锁定、缺件、重抽与 R06 免费次数。 */
export interface RunShopCheckpoint extends ShopShelfSnapshot {
  readonly freeRerollsUsed: number;
}

export interface RunCheckpointHealth {
  readonly current: number;
  readonly max: number;
  /** 当前护盾；旧版快照没有该字段时按 0 处理。 */
  readonly shield?: number;
}

/** 场景写入快照时提供的字段；schemaVersion/savedAt 由写入函数补齐。 */
export interface RunCheckpointDraft {
  readonly kind: RunCheckpointKind;
  readonly characterId: CharacterId;
  readonly wave: number;
  readonly health: RunCheckpointHealth;
  readonly level: number;
  readonly experience: number;
  readonly totalExperience: number;
  readonly pendingLevelUps: number;
  readonly upgrades: readonly RunUpgradeStack[];
  /** 已拥有的海克斯 ID（每种最高 1 层）；旧版快照没有该字段时为空。 */
  readonly hexes?: readonly string[];
  readonly rerollsRemaining: number;
  readonly randomState: number;
  /** 战斗与商店/奖励两条随机流的独立状态；旧版快照没有该字段时退回 `randomState`。 */
  readonly randomStates?: RunRandomSnapshot;
  /** 本波剩余时间（秒）；Boss 波与无波内计时的阶段为 0。旧版快照没有该字段时按 0 处理。 */
  readonly remainingSeconds?: number;
  /** 待选手牌卡片 ID；没有打开三选一时为 null。 */
  readonly hand: readonly string[] | null;
  readonly handKind: 'upgrade' | 'mechanic' | 'hex' | null;
  readonly focusIndex: number;
  readonly rewardStage: RunSavedRewardStage;
  readonly rewardPendingLevelUps: number;
  /** 波末奖励队列（含唯一 ID 与领取状态）；旧版快照没有该字段时为空。 */
  readonly rewardQueue?: readonly RewardEntry[];
  /** 本波击杀数，仅用于波末简报；旧版快照没有该字段时按 0 恢复。 */
  readonly waveKills?: number;
  /** 本局截至检查点的击杀数；旧版快照没有该字段时按 0 恢复。 */
  readonly kills?: number;
  /** 本局截至检查点的金币；旧版快照没有该字段时按初始金币恢复。 */
  readonly gold?: number;
  /** 本局截至检查点的累计伤害；旧版快照没有该字段时按 0 恢复。 */
  readonly damageDealt?: number;
  /** 已击败精英获得的核心资格；旧版快照没有该字段时为空。 */
  readonly coreRewardIds?: readonly string[];
  /** 已获得永久道具的层数；旧版快照没有该字段时为空。 */
  readonly items?: readonly RunItemStack[];
  /** 已拥有精英核心 E01–E08；旧版快照没有该字段时为空。 */
  readonly coreIds?: readonly string[];
  /** 触发闸门的剩余冷却与计数；旧版快照没有该字段时全部归零。 */
  readonly triggerGates?: TriggerGateSnapshot;
  /** E01–E08 的蓄力、冷却、计数与低血开关；旧版快照没有该字段时归零。 */
  readonly coreEffects?: CoreEffectsSnapshot;
  /** 追踪的 R01–R06 配方与缺件保底计数；旧版快照没有该字段时不追踪。 */
  readonly recipeTracking?: RecipeTrackerSnapshot;
  /** 自由技能 U/I 两槽（等级、累计实付、首购补贴标记）；旧版快照没有该字段时为空。 */
  readonly freeSkills?: FreeSkillSave;
  /** 已合成的成品 R01–R06；旧版快照没有该字段时为空。 */
  readonly crafted?: readonly string[];
  /** R01 成长与 R02–R06 机制计数；旧版快照没有该字段时归零。 */
  readonly craftedMechanics?: CraftedMechanicsSave;
  /** 消耗品排队/生效层数、P05 护盾账与 P07 回复预算；旧版快照没有该字段时为空。 */
  readonly consumables?: ConsumableSave;
  /** 波中仍在生效的自由技能效果；旧版快照没有该字段时按未激活恢复。 */
  readonly freeSkillEffects?: FreeSkillEffectsSave;
  /** 当前商店货架/锁定/缺件/重抽次数与 R06 免费重抽计数；非波间检查点为 null。 */
  readonly shop?: RunShopCheckpoint | null;
  /** 跨商店共享的道具逐层实际支付账本；旧版快照没有该字段时为空。 */
  readonly payments?: readonly RunShopPayment[];
  /** 波中检查点的世界状态；波初/波间/波末检查点为 null。 */
  readonly world: RunWorldSnapshot | null;
}

export interface RunCheckpoint extends RunCheckpointDraft {
  readonly schemaVersion: number;
  readonly savedAt: string;
}

export type RunCheckpointLoadResult =
  | { readonly status: 'none' }
  | { readonly status: 'ok'; readonly checkpoint: RunCheckpoint }
  | { readonly status: 'corrupt'; readonly reason: string }
  | { readonly status: 'unsupported'; readonly version: number | null };

/** localStorage 在隐私模式或测试外不可用时返回 null；调用方按“无存档”继续。 */
function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function inRange(value: unknown, min: number, max: number): value is number {
  return isInteger(value) && value >= min && value <= max;
}

/** 手牌只允许当前角色可用的正式强化卡，且同一手不重复。 */
function isPlayableHand(
  hand: readonly string[],
  characterId: CharacterId,
): boolean {
  if (hand.length === 0 || hand.length > 3) return false;
  const seen = new Set<string>();
  for (const id of hand) {
    if (typeof id !== 'string' || seen.has(id)) return false;
    const card = UPGRADE_LIST.find((entry) => entry.id === id);
    if (!card) return false;
    if (card.owner !== 'general' && card.owner !== characterId) return false;
    seen.add(id);
  }
  return true;
}

function isUpgradeList(
  upgrades: readonly RunUpgradeStack[],
  characterId: CharacterId,
): boolean {
  const seen = new Set<string>();
  for (const entry of upgrades) {
    if (typeof entry !== 'object' || entry === null) return false;
    if (typeof entry.id !== 'string' || seen.has(entry.id)) return false;
    const card = UPGRADE_LIST.find((upgrade) => upgrade.id === entry.id);
    if (!card) return false;
    if (card.owner !== 'general' && card.owner !== characterId) return false;
    if (!inRange(entry.stacks, 1, card.maxStacks)) return false;
    seen.add(entry.id);
  }
  return true;
}

/** 海克斯拥有列表：目录内 ID、不得重复、只允许通用或当前职业。 */
function isHexIdList(
  hexes: readonly string[],
  characterId: CharacterId,
): boolean {
  const owner = HEX_OWNER_BY_CHARACTER[characterId];
  const seen = new Set<string>();
  for (const id of hexes) {
    if (typeof id !== 'string' || seen.has(id)) return false;
    const hex = getHex(id);
    if (!hex) return false;
    if (hex.owner !== '通用' && hex.owner !== owner) return false;
    seen.add(id);
  }
  return true;
}

/** 海克斯手牌：1–3 张、互不重复、目录内且归属当前职业。 */
function isPlayableHexHand(
  hand: readonly string[],
  characterId: CharacterId,
): boolean {
  if (hand.length === 0 || hand.length > 3) return false;
  return isHexIdList(hand, characterId);
}

/** 永久道具只允许目录内的 ID，层数不超过该道具的叠层上限。 */
function isItemStackList(items: readonly RunItemStack[]): boolean {
  const seen = new Set<string>();
  for (const entry of items) {
    if (typeof entry !== 'object' || entry === null) return false;
    if (typeof entry.id !== 'string' || seen.has(entry.id)) return false;
    const item = getShopItem(entry.id);
    if (!item) return false;
    if (!inRange(entry.stacks, 1, item.stackCap)) return false;
    seen.add(entry.id);
  }
  return true;
}

/** 已合成成品列表：R01–R06 目录内、唯一。 */
function isCraftedIdList(crafted: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const id of crafted) {
    if (typeof id !== 'string' || !isCraftedItemId(id) || seen.has(id)) {
      return false;
    }
    seen.add(id);
  }
  return crafted.length <= CRAFTED_ITEM_IDS.length;
}

/** 商店商品快照：格位与品类一致、ID 在目录内且当前职业可用、价格至少 1。 */
function isShopOfferSnapshot(
  entry: unknown,
  characterId: CharacterId,
  shopWave: number,
): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const offer = entry as Record<string, unknown>;
  if (!isInteger(offer.slot)) return false;
  if (shopOfferKindForSlot(offer.slot) !== offer.kind) return false;
  if (!isInteger(offer.price) || offer.price < 1) return false;
  if (typeof offer.sold !== 'boolean' || typeof offer.locked !== 'boolean') {
    return false;
  }
  if (offer.locked && offer.sold) return false;
  if (typeof offer.id !== 'string') return false;
  if (offer.kind === 'item') {
    const item = getShopItem(offer.id);
    return item !== undefined && isItemUsableByCharacter(item.id, characterId);
  }
  if (offer.kind === 'skill') return getFreeSkill(offer.id) !== undefined;
  if (offer.kind === 'potion') {
    const potion = getConsumable(offer.id);
    if (!potion || potion.id === SHOP_EMERGENCY_POTION_ID) return false;
    return potion.id !== 'P02' || shopWave >= P02_FIRST_SHOP_WAVE;
  }
  return false;
}

/** 逐层支付账本：目录内道具、每层非负整数、记录数不超过宽松上限。 */
function isPaymentList(entries: readonly RunShopPayment[]): boolean {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) return false;
    if (typeof entry.id !== 'string' || seen.has(entry.id)) return false;
    const item = getShopItem(entry.id);
    if (!item) return false;
    if (
      !Array.isArray(entry.paid) ||
      entry.paid.length > MAX_PAYMENT_LAYERS
    ) {
      return false;
    }
    for (const paid of entry.paid) {
      if (!inRange(paid, 0, Number.MAX_SAFE_INTEGER)) return false;
    }
    seen.add(entry.id);
  }
  return true;
}

/** 当前商店快照：波次与续局一致、格位唯一、最多一个锁定格、缺件与重抽计数合法。 */
function validateShopSnapshot(
  shop: RunShopCheckpoint,
  characterId: CharacterId,
  wave: number,
): string | null {
  if (typeof shop !== 'object' || shop === null) return '商店快照非法';
  if (!inRange(shop.shopWave, 1, SHOP_LAST_WAVE)) return '商店波次越界';
  if (shop.shopWave !== wave) return '商店波次与续局波次不一致';
  if (!Array.isArray(shop.offers) || shop.offers.length === 0) {
    return '商店货架为空';
  }
  if (shop.offers.length > SHOP_MAIN_SLOT_COUNT) return '商店货架过长';
  const seenSlots = new Set<number>();
  const seenIds = new Set<string>();
  let locked = 0;
  for (const offer of shop.offers) {
    if (!isShopOfferSnapshot(offer, characterId, shop.shopWave)) {
      return '商店商品非法';
    }
    if (seenSlots.has(offer.slot)) return '商店格位重复';
    const identity = `${offer.kind}:${offer.id}`;
    if (seenIds.has(identity)) return '商店商品重复';
    if (offer.locked) locked += 1;
    seenSlots.add(offer.slot);
    seenIds.add(identity);
  }
  if (locked > 1) return '商店锁定格过多';
  const supply = shop.materialSupply;
  if (supply !== null) {
    if (typeof supply !== 'object') return '缺件供给非法';
    if (typeof supply.id !== 'string' || getShopItem(supply.id) === undefined) {
      return '缺件材料非法';
    }
    const recipe = getRecipe(supply.recipeId);
    if (!recipe || !recipe.ingredients.includes(supply.id)) {
      return '缺件配方非法';
    }
    if (!isInteger(supply.price) || supply.price < 1) return '缺件价格非法';
    if (typeof supply.sold !== 'boolean') return '缺件售出标记非法';
  }
  if (!inRange(shop.rerollCount, 0, MAX_REROLLS)) return '商店重抽次数越界';
  if (!inRange(shop.freeRerollsUsed, 0, MAX_REROLLS)) {
    return '商店免费重抽次数越界';
  }
  return null;
}

/**
 * 校验草稿字段。返回错误描述，`null` 表示可以写入。
 * 与 `parseCheckpoint` 共用同一口径，保证写入的数据一定能被读回。
 */
function validateDraft(draft: RunCheckpointDraft): string | null {
  if (!CHECKPOINT_KINDS.has(draft.kind)) return '未知的检查点类型';
  if (!isCharacterId(draft.characterId)) return '未知角色';
  if (!inRange(draft.wave, 1, TOTAL_WAVES)) return '波次越界';
  if (typeof draft.health !== 'object' || draft.health === null) {
    return '生命值不是对象';
  }
  if (!isFiniteNumber(draft.health.current) || !isFiniteNumber(draft.health.max)) {
    return '生命值不是有限数字';
  }
  if (draft.health.max <= 0) return '最大生命必须为正';
  if (draft.health.current <= 0) return '当前生命必须为正';
  if (draft.health.current > draft.health.max) {
    return '当前生命越界';
  }
  if (
    draft.health.shield !== undefined &&
    (!isFiniteNumber(draft.health.shield) || draft.health.shield < 0)
  ) {
    return '护盾值非法';
  }
  if (!inRange(draft.level, MIN_LEVEL, MAX_LEVEL)) return '等级越界';
  if (!isFiniteNumber(draft.experience) || draft.experience < 0) return '经验为负';
  if (!isFiniteNumber(draft.totalExperience) || draft.totalExperience < draft.experience) {
    return '累计经验小于当前经验';
  }
  if (!inRange(draft.pendingLevelUps, 0, MAX_PENDING_REWARDS)) {
    return '待选升级数量越界';
  }
  if (!Array.isArray(draft.upgrades) || !isUpgradeList(draft.upgrades, draft.characterId)) {
    return '已选强化列表非法';
  }
  if (!inRange(draft.rerollsRemaining, 0, MAX_REROLLS)) return '重抽次数越界';
  if (!inRange(draft.randomState, 0, 0xffffffff)) return '随机状态越界';
  if (draft.hexes !== undefined) {
    if (!Array.isArray(draft.hexes) || !isHexIdList(draft.hexes, draft.characterId)) {
      return '已选海克斯列表非法';
    }
  }
  if (draft.hand !== null) {
    if (!Array.isArray(draft.hand)) return '待选手牌非法';
    if (draft.handKind === 'hex') {
      if (!isPlayableHexHand(draft.hand, draft.characterId)) {
        return '待选海克斯手牌非法';
      }
    } else if (!isPlayableHand(draft.hand, draft.characterId)) {
      return '待选手牌非法';
    }
  }
  if (draft.hand === null) {
    if (draft.handKind !== null) return '没有手牌却记录了手牌类型';
    if (draft.focusIndex !== 0) return '没有手牌却记录了焦点';
  } else {
    if (
      draft.handKind !== 'upgrade' &&
      draft.handKind !== 'mechanic' &&
      draft.handKind !== 'hex'
    ) {
      return '手牌缺少类型';
    }
    if (!inRange(draft.focusIndex, 0, draft.hand.length - 1)) return '手牌焦点越界';
  }
  if (!REWARD_STAGES.has(draft.rewardStage)) return '未知奖励阶段';
  if (!inRange(draft.rewardPendingLevelUps, 0, MAX_PENDING_REWARDS)) {
    return '奖励队列数量越界';
  }
  if (draft.waveKills !== undefined) {
    if (!inRange(draft.waveKills, 0, Number.MAX_SAFE_INTEGER)) {
      return '本波击杀数非法';
    }
  }
  if (draft.rewardQueue !== undefined) {
    if (!Array.isArray(draft.rewardQueue)) return '奖励队列不是数组';
    if (draft.rewardQueue.length > MAX_REWARD_ENTRIES) return '奖励队列过长';
    const seenRewards = new Set<string>();
    for (const entry of draft.rewardQueue) {
      if (typeof entry !== 'object' || entry === null) return '奖励队列条目非法';
      if (typeof entry.id !== 'string' || entry.id.length === 0) {
        return '奖励队列条目缺少 ID';
      }
      if (seenRewards.has(entry.id)) return '奖励队列 ID 重复';
      if (!isRewardKind(entry.kind)) return '奖励队列种类非法';
      if (!isRewardStatus(entry.status)) return '奖励队列状态非法';
      if (
        entry.sourceId !== undefined &&
        (typeof entry.sourceId !== 'string' || entry.sourceId.length === 0)
      ) {
        return '奖励来源非法';
      }
      if (!isValidRewardExtra(entry)) return '奖励候选非法';
      if (entry.kind !== 'core' && entry.coreOffers !== undefined) {
        return '核心候选种类非法';
      }
      seenRewards.add(entry.id);
    }
  }
  // 旧版快照没有击杀/伤害字段，缺省按 0 恢复；一旦出现就必须是非负合法数值。
  if (draft.kills !== undefined && !inRange(draft.kills, 0, Number.MAX_SAFE_INTEGER)) {
    return '击杀数非法';
  }
  if (draft.gold !== undefined && !inRange(draft.gold, 0, Number.MAX_SAFE_INTEGER)) {
    return '金币数非法';
  }
  if (
    draft.damageDealt !== undefined &&
    (!isFiniteNumber(draft.damageDealt) || draft.damageDealt < 0)
  ) {
    return '累计伤害非法';
  }
  if (draft.coreRewardIds !== undefined) {
    if (!Array.isArray(draft.coreRewardIds)) return '核心奖励列表非法';
    const seenRewards = new Set<string>();
    for (const rewardId of draft.coreRewardIds) {
      if (typeof rewardId !== 'string' || !CORE_REWARD_IDS.has(rewardId)) {
        return '核心奖励列表非法';
      }
      if (seenRewards.has(rewardId)) return '核心奖励列表非法';
      seenRewards.add(rewardId);
    }
  }
  if (draft.items !== undefined) {
    if (!Array.isArray(draft.items) || !isItemStackList(draft.items)) {
      return '道具列表非法';
    }
  }
  if (draft.coreIds !== undefined) {
    if (!Array.isArray(draft.coreIds)) return '核心列表非法';
    const seenCores = new Set<string>();
    for (const coreId of draft.coreIds) {
      if (typeof coreId !== 'string' || !ELITE_CORE_IDS.has(coreId)) {
        return '核心列表非法';
      }
      if (seenCores.has(coreId)) return '核心列表非法';
      seenCores.add(coreId);
    }
  }
  if (draft.triggerGates !== undefined) {
    if (!validateTriggerGateSnapshot(draft.triggerGates)) {
      return '触发闸门状态非法';
    }
  }
  if (draft.coreEffects !== undefined) {
    if (!validateCoreEffectsSnapshot(draft.coreEffects)) {
      return '核心效果状态非法';
    }
  }
  if (draft.recipeTracking !== undefined) {
    const tracking = draft.recipeTracking;
    if (typeof tracking !== 'object' || tracking === null) {
      return '配方追踪状态非法';
    }
    if (tracking.recipeId !== null) {
      if (typeof tracking.recipeId !== 'string' || !getRecipe(tracking.recipeId)) {
        return '配方追踪编号非法';
      }
    }
    if (
      !inRange(tracking.shopsSinceSupply, 0, MATERIAL_SUPPLY_INTERVAL_SHOPS - 1)
    ) {
      return '配方追踪计数越界';
    }
  }
  if (draft.remainingSeconds !== undefined) {
    if (!isFiniteNumber(draft.remainingSeconds) || draft.remainingSeconds < 0) {
      return '剩余时间非法';
    }
  }
  if (draft.randomStates !== undefined) {
    if (
      typeof draft.randomStates !== 'object' ||
      draft.randomStates === null ||
      !isValidRandomState(draft.randomStates.combat) ||
      !isValidRandomState(draft.randomStates.reward)
    ) {
      return '随机流状态非法';
    }
  }
  if (draft.freeSkills !== undefined) {
    if (!isFreeSkillSave(draft.freeSkills)) return '自由技能状态非法';
  }
  if (draft.crafted !== undefined) {
    if (!Array.isArray(draft.crafted) || !isCraftedIdList(draft.crafted)) {
      return '成品列表非法';
    }
  }
  if (draft.craftedMechanics !== undefined) {
    if (!isCraftedMechanicsSave(draft.craftedMechanics)) {
      return '成品机制状态非法';
    }
  }
  if (draft.consumables !== undefined) {
    if (!isConsumableSave(draft.consumables)) return '消耗品状态非法';
  }
  if (draft.freeSkillEffects !== undefined) {
    if (!isFreeSkillEffectsSave(draft.freeSkillEffects)) {
      return '自由技能效果状态非法';
    }
  }
  if (draft.shop !== undefined && draft.shop !== null) {
    const error = validateShopSnapshot(draft.shop, draft.characterId, draft.wave);
    if (error) return error;
  }
  if (draft.payments !== undefined) {
    if (!Array.isArray(draft.payments) || !isPaymentList(draft.payments)) {
      return '支付账本非法';
    }
  }
  if (draft.world !== null && draft.world !== undefined) {
    if (!validateWorldSnapshot(draft.world)) return '波中世界状态非法';
  }
  return null;
}

/** 把任意 JSON 值解析成快照；未知版本单独返回，便于界面给出不同提示。 */
export function parseCheckpoint(value: unknown): RunCheckpointLoadResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { status: 'corrupt', reason: '快照不是对象' };
  }
  const record = value as Record<string, unknown>;
  if (!isInteger(record.schemaVersion)) {
    return { status: 'corrupt', reason: '缺少 schemaVersion' };
  }
  if (record.schemaVersion !== RUN_SAVE_SCHEMA_VERSION) {
    return { status: 'unsupported', version: record.schemaVersion };
  }
  if (typeof record.savedAt !== 'string' || record.savedAt.length === 0) {
    return { status: 'corrupt', reason: '缺少保存时间' };
  }
  if (!Array.isArray(record.upgrades)) {
    return { status: 'corrupt', reason: '已选强化不是数组' };
  }
  if (record.hand !== null && !Array.isArray(record.hand)) {
    return { status: 'corrupt', reason: '手牌不是数组' };
  }

  let world: RunWorldSnapshot | null = null;
  if (record.world !== undefined && record.world !== null) {
    world = validateWorldSnapshot(record.world);
    if (!world) return { status: 'corrupt', reason: '波中世界状态非法' };
  }

  const draft: RunCheckpointDraft = {
    kind: record.kind as RunCheckpointKind,
    characterId: record.characterId as CharacterId,
    wave: record.wave as number,
    health: record.health as RunCheckpointHealth,
    level: record.level as number,
    experience: record.experience as number,
    totalExperience: record.totalExperience as number,
    pendingLevelUps: record.pendingLevelUps as number,
    upgrades: record.upgrades as RunUpgradeStack[],
    hexes: record.hexes as string[] | undefined,
    rerollsRemaining: record.rerollsRemaining as number,
    randomState: record.randomState as number,
    randomStates: record.randomStates as RunRandomSnapshot | undefined,
    remainingSeconds: record.remainingSeconds as number | undefined,
    hand: record.hand as string[] | null,
    handKind: record.handKind as 'upgrade' | 'mechanic' | 'hex' | null,
    focusIndex: record.focusIndex as number,
    rewardStage: record.rewardStage as RunSavedRewardStage,
    rewardPendingLevelUps: record.rewardPendingLevelUps as number,
    rewardQueue: record.rewardQueue as RewardEntry[] | undefined,
    waveKills: record.waveKills as number | undefined,
    kills: record.kills as number | undefined,
    gold: record.gold as number | undefined,
    damageDealt: record.damageDealt as number | undefined,
    coreRewardIds: record.coreRewardIds as string[] | undefined,
    items: record.items as RunItemStack[] | undefined,
    coreIds: record.coreIds as string[] | undefined,
    triggerGates: record.triggerGates as TriggerGateSnapshot | undefined,
    coreEffects: record.coreEffects as CoreEffectsSnapshot | undefined,
    recipeTracking: record.recipeTracking as RecipeTrackerSnapshot | undefined,
    freeSkills: record.freeSkills as FreeSkillSave | undefined,
    crafted: record.crafted as string[] | undefined,
    craftedMechanics: record.craftedMechanics as CraftedMechanicsSave | undefined,
    consumables: record.consumables as ConsumableSave | undefined,
    freeSkillEffects: record.freeSkillEffects as
      | FreeSkillEffectsSave
      | undefined,
    shop: record.shop as RunShopCheckpoint | null | undefined,
    payments: record.payments as RunShopPayment[] | undefined,
    world,
  };
  const error = validateDraft(draft);
  if (error) return { status: 'corrupt', reason: error };

  return {
    status: 'ok',
    checkpoint: {
      ...draft,
      schemaVersion: record.schemaVersion,
      savedAt: record.savedAt,
    },
  };
}

/**
 * 恢复后的本局战斗统计。旧版快照缺少击杀/伤害字段时按 0 起步；
 * 已通过校验的值原样保留，让 HUD 与结算从保存值继续累计。
 */
export interface RunCombatStats {
  readonly kills: number;
  readonly damageDealt: number;
}

export function restoredCombatStats(
  checkpoint: Pick<RunCheckpoint, 'kills' | 'damageDealt'>,
): RunCombatStats {
  const kills =
    isInteger(checkpoint.kills) && checkpoint.kills >= 0 ? checkpoint.kills : 0;
  const damageDealt =
    isFiniteNumber(checkpoint.damageDealt) && checkpoint.damageDealt >= 0
      ? checkpoint.damageDealt
      : 0;
  return { kills, damageDealt };
}

/**
 * 读取续局快照。存储不可用或没有键时返回 `none`；
 * JSON 损坏、字段非法与未知版本分别返回可提示的状态。
 */
export function loadRunCheckpoint(
  storage: Storage | null = defaultStorage(),
): RunCheckpointLoadResult {
  if (!storage) return { status: 'none' };

  let raw: string | null;
  try {
    raw = storage.getItem(RUN_SAVE_STORAGE_KEY);
  } catch {
    return { status: 'none' };
  }
  if (!raw) return { status: 'none' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', reason: '存档不是合法 JSON' };
  }
  return parseCheckpoint(parsed);
}

/** 消耗品层数组的深拷贝：写入快照后调用方继续改内部 Map 不会影响存档。 */
function cloneConsumableGroups(
  groups: readonly ConsumableGroupSave[],
): ConsumableGroupSave[] {
  return groups.map((group) => ({
    id: group.id,
    stacks: group.stacks.map((entry) => ({ ...entry })),
  }));
}

/** 自由技能运行态深拷贝：坐标、火焰/炮台/替身数组逐项复制。 */
function cloneFreeSkillEffects(save: FreeSkillEffectsSave): FreeSkillEffectsSave {
  return {
    spinningBlades: save.spinningBlades
      ? { ...save.spinningBlades }
      : undefined,
    slows: save.slows
      ? { entries: save.slows.entries.map((entry) => ({ ...entry })) }
      : undefined,
    fireTrail: save.fireTrail
      ? {
          ...save.fireTrail,
          patches: save.fireTrail.patches.map((patch) => ({ ...patch })),
          lastPosition: save.fireTrail.lastPosition
            ? { ...save.fireTrail.lastPosition }
            : null,
        }
      : undefined,
    turrets: save.turrets
      ? { turrets: save.turrets.turrets.map((turret) => ({ ...turret })) }
      : undefined,
    shieldBurst: save.shieldBurst ? { ...save.shieldBurst } : undefined,
    gravityWell: save.gravityWell
      ? {
          ...save.gravityWell,
          center: save.gravityWell.center ? { ...save.gravityWell.center } : null,
        }
      : undefined,
    waterMirror: save.waterMirror
      ? { mirrors: save.waterMirror.mirrors.map((mirror) => ({ ...mirror })) }
      : undefined,
    warBanner: save.warBanner
      ? {
          ...save.warBanner,
          center: save.warBanner.center ? { ...save.warBanner.center } : null,
          contactedIds: [...save.warBanner.contactedIds],
        }
      : undefined,
    bountyMark: save.bountyMark
      ? {
          ...save.bountyMark,
          paidTargetIds: [...save.bountyMark.paidTargetIds],
        }
      : undefined,
  };
}

/**
 * 写入续局快照。存储不可写或字段非法时返回 false，由调用方显示“本局无法保存”；
 * 写入失败不会清理已有键或其它站点数据。
 */
export function saveRunCheckpoint(
  draft: RunCheckpointDraft,
  storage: Storage | null = defaultStorage(),
  now: Date = new Date(),
): boolean {
  if (!storage) return false;
  if (validateDraft(draft)) return false;

  const checkpoint: RunCheckpoint = {
    ...draft,
    upgrades: draft.upgrades.map((entry) => ({ ...entry })),
    hexes: draft.hexes ? [...draft.hexes] : undefined,
    hand: draft.hand ? [...draft.hand] : null,
    rewardQueue: draft.rewardQueue
      ? draft.rewardQueue.map((entry) => ({
          ...entry,
          ...(entry.offers ? { offers: [...entry.offers] } : {}),
          ...(entry.coreOffers ? { coreOffers: [...entry.coreOffers] } : {}),
        }))
      : undefined,
    items: draft.items
      ? draft.items.map((entry) => ({ ...entry }))
      : undefined,
    coreIds: draft.coreIds ? [...draft.coreIds] : undefined,
    triggerGates: draft.triggerGates
      ? { rules: draft.triggerGates.rules.map((rule) => ({ ...rule })) }
      : undefined,
    coreEffects: draft.coreEffects
      ? {
          ...draft.coreEffects,
          e01DistinctTargets: [...draft.coreEffects.e01DistinctTargets],
        }
      : undefined,
    randomStates: draft.randomStates ? { ...draft.randomStates } : undefined,
    freeSkills: draft.freeSkills
      ? {
          slots: draft.freeSkills.slots.map((slot) => ({ ...slot })),
          firstPurchaseSubsidyUsed: draft.freeSkills.firstPurchaseSubsidyUsed,
          ...(draft.freeSkills.cooldowns
            ? { cooldowns: { ...draft.freeSkills.cooldowns } }
            : {}),
        }
      : undefined,
    crafted: draft.crafted ? [...draft.crafted] : undefined,
    craftedMechanics: draft.craftedMechanics
      ? { ...draft.craftedMechanics }
      : undefined,
    consumables: draft.consumables
      ? {
          pending: cloneConsumableGroups(draft.consumables.pending),
          active: cloneConsumableGroups(draft.consumables.active),
          shieldGranted: draft.consumables.shieldGranted,
          shieldRemaining: draft.consumables.shieldRemaining,
          regenBudget: draft.consumables.regenBudget,
        }
      : undefined,
    freeSkillEffects: draft.freeSkillEffects
      ? cloneFreeSkillEffects(draft.freeSkillEffects)
      : undefined,
    shop: draft.shop
      ? {
          shopWave: draft.shop.shopWave,
          offers: draft.shop.offers.map((offer) => ({ ...offer })),
          materialSupply: draft.shop.materialSupply
            ? { ...draft.shop.materialSupply }
            : null,
          rerollCount: draft.shop.rerollCount,
          freeRerollsUsed: draft.shop.freeRerollsUsed,
        }
      : draft.shop === null
        ? null
        : undefined,
    payments: draft.payments
      ? draft.payments.map((entry) => ({ id: entry.id, paid: [...entry.paid] }))
      : undefined,
    health: { ...draft.health },
    world: draft.world ?? null,
    schemaVersion: RUN_SAVE_SCHEMA_VERSION,
    savedAt: now.toISOString(),
  };

  try {
    storage.setItem(RUN_SAVE_STORAGE_KEY, JSON.stringify(checkpoint));
    return true;
  } catch {
    return false;
  }
}

/**
 * 清除续局快照（胜败结算、主动返回选角或用户确认重置）。
 * 只删除本游戏的键，不使用 clear()，不触碰设置/键位或其它站点数据。
 */
export function clearRunCheckpoint(storage: Storage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(RUN_SAVE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
