/**
 * 永久道具的可用性判定（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §商店：
 * 不得向当前职业提供完全无法利用的正收益与真实代价组合；
 * 依赖特定能力（弹体/爆炸/持续伤害/召唤物）的道具在卡面写清前置。
 *
 * 宝箱与商店共用这份判定，避免两处各写一套职业能力表而分叉。
 */
import { listShopItems, type CharacterId } from './data';

/** 道具正收益所依赖的职业能力。 */
export type ItemCapability =
  | 'projectile'
  | 'explosion'
  | 'damageOverTime'
  | 'summon';

/**
 * 24 件永久道具中依赖特定能力的条目；其余为全职业通用。
 * 依据 `02-content-catalog.md` 的收益文案与四名角色的现有技能组。
 */
export const ITEM_CAPABILITY_REQUIREMENTS: Readonly<
  Record<string, ItemCapability>
> = {
  // 弹体直径 / 额外非穿透弹：近战盾击完全不适用。
  I04: 'projectile',
  I14: 'projectile',
  // 爆炸半径 / 每第 5 次爆炸：只有爆破手的榴弹具备爆炸。
  I13: 'explosion',
  I24: 'explosion',
  // I16 不再按职业过滤：S01/S04/S08 是任意角色都能购买的自由技能，
  // 卡面用「需持续类技能」提示当前是否已有来源（US-064）。
  // 召唤物伤害/生命：只有战术家的流形是伤害型召唤物。
  I19: 'summon',
  I20: 'summon',
};

/** 卡面显示的前置条件文案。 */
export const ITEM_CAPABILITY_PREREQUISITES: Readonly<
  Record<ItemCapability, string>
> = {
  projectile: '需要弹体攻击',
  explosion: '需要爆炸技能',
  damageOverTime: '需要持续伤害技能',
  summon: '需要召唤物',
};

const CHARACTER_CAPABILITIES: Readonly<
  Record<CharacterId, readonly ItemCapability[]>
> = {
  vishdal: ['projectile', 'explosion'],
  amiya: ['projectile'],
  saria: [],
  muelsyse: ['projectile', 'summon'],
};

/** 道具依赖的能力；通用道具返回 null。 */
export function itemCapabilityRequirement(itemId: string): ItemCapability | null {
  return ITEM_CAPABILITY_REQUIREMENTS[itemId] ?? null;
}

/** 卡面前置文案；通用道具返回 null。未知 ID 也按通用处理。 */
export function itemPrerequisite(itemId: string): string | null {
  const requirement = itemCapabilityRequirement(itemId);
  return requirement ? ITEM_CAPABILITY_PREREQUISITES[requirement] : null;
}

/** 当前职业是否能利用该道具的正收益。未知 ID 视为不适用。 */
export function isItemUsableByCharacter(
  itemId: string,
  characterId: CharacterId,
): boolean {
  const item = listShopItems().find((candidate) => candidate.id === itemId);
  if (!item) return false;
  const requirement = itemCapabilityRequirement(item.id);
  if (!requirement) return true;
  const capabilities = CHARACTER_CAPABILITIES[characterId];
  return capabilities ? capabilities.includes(requirement) : false;
}
