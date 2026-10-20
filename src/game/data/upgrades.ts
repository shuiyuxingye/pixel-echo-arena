/**
 * 24 种强化的集中配置（docs/game-design.md §6.3）。
 * 纯数据，不依赖 Phaser；抽取权重按稀有度另行计算。
 */
import type { CharacterId } from './characters';

export type Rarity = 'silver' | 'gold' | 'prismatic';

/** general 为通用强化，其余为对应角色专属。 */
export type UpgradeOwner = 'general' | CharacterId;

export interface UpgradeDefinition {
  readonly id: string;
  readonly name: string;
  readonly rarity: Rarity;
  readonly maxStacks: number;
  readonly owner: UpgradeOwner;
  readonly description: string;
  /** 适用技能/机制的简短标识，供强化卡片显示。 */
  readonly appliesTo: string;
  /** 机制数值，供后续强化故事直接读取。 */
  readonly params?: Readonly<Record<string, number>>;
}

export const UPGRADE_LIST: readonly UpgradeDefinition[] = [
  {
    id: 'G01',
    name: '强袭',
    rarity: 'silver',
    maxStacks: 3,
    owner: 'general',
    description: '所有自身与召唤物伤害 +12%。',
    appliesTo: 'J/K/L/召唤物',
    params: { damageBonusPerStack: 0.12 },
  },
  {
    id: 'G02',
    name: '轻装',
    rarity: 'silver',
    maxStacks: 3,
    owner: 'general',
    description: '移速 +8%。',
    appliesTo: '移动',
    params: { moveSpeedBonusPerStack: 0.08 },
  },
  {
    id: 'G03',
    name: '蓄能',
    rarity: 'silver',
    maxStacks: 3,
    owner: 'general',
    description: 'K/L 冷却缩减 +8%。',
    appliesTo: 'K/L',
    params: { cooldownReductionPerStack: 0.08 },
  },
  {
    id: 'G04',
    name: '生存训练',
    rarity: 'silver',
    maxStacks: 3,
    owner: 'general',
    description: '最大生命 +20，获取时回复 20 生命。',
    appliesTo: '生命',
    params: { maxHealthBonusPerStack: 20, healOnAcquire: 20 },
  },
  {
    id: 'G05',
    name: '余烬扩散',
    rarity: 'gold',
    maxStacks: 1,
    owner: 'general',
    description: '自身击杀敌人后产生半径 50、12 法伤爆炸，不再次触发本卡。',
    appliesTo: '击杀',
    params: { radius: 50, damage: 12 },
  },
  {
    id: 'G06',
    name: '战术回响',
    rarity: 'gold',
    maxStacks: 1,
    owner: 'general',
    description: 'K 生效后下次 J 追加一次 50% 伤害攻击，5 秒未使用失效。',
    appliesTo: 'J/K',
    params: { damageRatio: 0.5, expirySeconds: 5 },
  },
  {
    id: 'G07',
    name: '闪避脉冲',
    rarity: 'gold',
    maxStacks: 1,
    owner: 'general',
    description: '闪避终点产生半径 65、20 法伤脉冲并减速 20% 持续 1 秒。',
    appliesTo: '闪避',
    params: { radius: 65, damage: 20, slowPercent: 0.2, slowDurationSeconds: 1 },
  },
  {
    id: 'G08',
    name: '极限回转',
    rarity: 'prismatic',
    maxStacks: 1,
    owner: 'general',
    description: 'K/L 冷却期间每累计击杀 10 个敌人，各减少剩余冷却 2 秒。',
    appliesTo: 'K/L',
    params: { killsPerTrigger: 10, cooldownReduction: 2 },
  },
  {
    id: 'W01',
    name: '二次余震',
    rarity: 'gold',
    maxStacks: 1,
    owner: 'vishdal',
    description: '每发榴弹多一次延迟 0.7 秒的 50% 伤害余震。',
    appliesTo: 'J',
    params: { delaySeconds: 0.7, damageRatio: 0.5 },
  },
  {
    id: 'W02',
    name: '标记传染',
    rarity: 'prismatic',
    maxStacks: 1,
    owner: 'vishdal',
    description: '残影引爆给周围最多 2 个未标记敌人附着标记，不连锁引爆。',
    appliesTo: '被动',
    params: { spreadTargets: 2 },
  },
  {
    id: 'W03',
    name: '亡魂伴行',
    rarity: 'gold',
    maxStacks: 1,
    owner: 'vishdal',
    description: '魂灵上限变为 2；K 每次仍只召唤一个。',
    appliesTo: 'K',
    params: { maxSummons: 2 },
  },
  {
    id: 'W04',
    name: '追加装药',
    rarity: 'prismatic',
    maxStacks: 1,
    owner: 'vishdal',
    description: '爆裂黎明弹药 6→9，最后一发范围额外 +25%。',
    appliesTo: 'L',
    params: { shots: 9, lastShotRadiusBonus: 0.25 },
  },
  {
    id: 'A01',
    name: '穿透术式',
    rarity: 'gold',
    maxStacks: 1,
    owner: 'amiya',
    description: 'J 可额外穿透 2 个敌人，后续命中伤害 70%。',
    appliesTo: 'J',
    params: { extraPierce: 2, subsequentDamageRatio: 0.7 },
  },
  {
    id: 'A02',
    name: '心绪共鸣',
    rarity: 'gold',
    maxStacks: 1,
    owner: 'amiya',
    description: '情绪吸收由每 5 次命中变为每 3 次。',
    appliesTo: '被动',
    params: { hitsPerTrigger: 3 },
  },
  {
    id: 'A03',
    name: '双重吟唱',
    rarity: 'prismatic',
    maxStacks: 1,
    owner: 'amiya',
    description: 'K 结束 0.5 秒后追加 3 发、每发原伤害 60% 的术式。',
    appliesTo: 'K',
    params: { delaySeconds: 0.5, shots: 3, damageRatio: 0.6 },
  },
  {
    id: 'A04',
    name: '意志余辉',
    rarity: 'prismatic',
    maxStacks: 1,
    owner: 'amiya',
    description: '奇美拉持续时间 8→11 秒；虚弱不再减速，但仍禁用 K/L。',
    appliesTo: 'L',
    params: { durationSeconds: 11, weaknessSlowRemoved: 1 },
  },
  {
    id: 'S01',
    name: '回生冲击',
    rarity: 'gold',
    maxStacks: 1,
    owner: 'saria',
    description: 'K 按实际治疗量的 80% 对半径 100 敌人造成法伤。',
    appliesTo: 'K',
    params: { healDamageRatio: 0.8, radius: 100 },
  },
  {
    id: 'S02',
    name: '钙质反应',
    rarity: 'prismatic',
    maxStacks: 1,
    owner: 'saria',
    description: '钙质化领域每秒对敌人造成 16 法伤，享受领域法伤增益。',
    appliesTo: 'L',
    params: { damagePerSecond: 16 },
  },
  {
    id: 'S03',
    name: '坚盾反击',
    rarity: 'gold',
    maxStacks: 1,
    owner: 'saria',
    description: '护盾吸收伤害时触发半径 85、18 物伤反击，内置冷却 0.8 秒。',
    appliesTo: '被动',
    params: { radius: 85, damage: 18, internalCooldownSeconds: 0.8 },
  },
  {
    id: 'S04',
    name: '充能循环',
    rarity: 'prismatic',
    maxStacks: 1,
    owner: 'saria',
    description: '精神回复减冷却 2→4 秒；领域累计 5 次有效治疗后 K 剩余冷却减少 1 秒。',
    appliesTo: '被动/L',
    params: { passiveCooldownReduction: 4, healsPerTrigger: 5, cooldownReduction: 1 },
  },
  {
    id: 'M01',
    name: '双生流形',
    rarity: 'prismatic',
    maxStacks: 1,
    owner: 'muelsyse',
    description: '远程副本上限 1→2，近战形态攻击窃取层数上限 5→8。',
    appliesTo: 'K/流形',
    params: { rangedMaxCopies: 2, meleeMaxStacks: 8 },
  },
  {
    id: 'M02',
    name: '生态复苏',
    rarity: 'gold',
    maxStacks: 1,
    owner: 'muelsyse',
    description: '主流形每秒恢复最大生命 2%，L 开启时立即恢复 20%。',
    appliesTo: '流形',
    params: { healPercentPerSecond: 0.02, healOnActivatePercent: 0.2 },
  },
  {
    id: 'M03',
    name: '聚合涡旋',
    rarity: 'gold',
    maxStacks: 1,
    owner: 'muelsyse',
    description: '近战 L 拉拽范围 +30%；远程 L 束缚时间 +0.25 秒。',
    appliesTo: 'L',
    params: { pullRangeBonus: 0.3, rootBonusSeconds: 0.25 },
  },
  {
    id: 'M04',
    name: '水镜共鸣',
    rarity: 'prismatic',
    maxStacks: 1,
    owner: 'muelsyse',
    description: '玩家 J 命中时主流形补一次 40% 伤害攻击，内置冷却 0.6 秒。',
    appliesTo: 'J/流形',
    params: { damageRatio: 0.4, internalCooldownSeconds: 0.6 },
  },
];

const UPGRADES_BY_ID: ReadonlyMap<string, UpgradeDefinition> = new Map(
  UPGRADE_LIST.map((upgrade) => [upgrade.id, upgrade]),
);

export function getUpgrade(id: string): UpgradeDefinition {
  const upgrade = UPGRADES_BY_ID.get(id);
  if (!upgrade) {
    throw new Error(`Unknown upgrade id: ${id}`);
  }
  return upgrade;
}

/**
 * 读取强化数值参数；缺失即报错，避免战斗实效静默使用与卡片说明不一致的默认值。
 */
export function requireUpgradeParam(upgradeId: string, key: string): number {
  const value = getUpgrade(upgradeId).params?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${upgradeId} 缺少数值参数 ${key}`);
  }
  return value;
}

export interface UpgradeFilter {
  readonly owner?: UpgradeOwner;
  readonly rarity?: Rarity;
}

export function listUpgrades(filter: UpgradeFilter = {}): readonly UpgradeDefinition[] {
  return UPGRADE_LIST.filter(
    (upgrade) =>
      (filter.owner === undefined || upgrade.owner === filter.owner) &&
      (filter.rarity === undefined || upgrade.rarity === filter.rarity),
  );
}

/** 某角色可抽到的强化：通用池 + 该角色专属池。 */
export function listUpgradesForCharacter(
  characterId: CharacterId,
): readonly UpgradeDefinition[] {
  return UPGRADE_LIST.filter(
    (upgrade) => upgrade.owner === 'general' || upgrade.owner === characterId,
  );
}
