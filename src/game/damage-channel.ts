/**
 * 伤害通道：持续伤害（sustained）与直击（direct）的区分规则（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §数值初值与上限与 US-064：
 * - 只有每秒结算的 S01 旋刃环、S04 燃烧轨迹、S08 重力井走持续通道；
 * - J 弹体、榴弹爆炸、召唤物（S05 炮台、S09 替身）与一次性技能均为直击；
 * - I16 催化孢子「持续伤害 +25%」只乘持续通道，其「直接伤害 −5%」只乘直击；
 * - R02 连锁反应堆「持续伤害 +30%」只乘持续通道，并与 I16 叠乘；
 * - 每个倍率只乘一次，持续伤害不会同时吃 I16 的 −5% 与 +25%。
 */
import { FREE_SKILL_LIST, getFreeSkill } from './data';

/** 伤害通道；持续通道只由下面三个每秒结算技能产生。 */
export type DamageChannel = 'sustained' | 'direct';

/** 走持续伤害通道的自由技能 ID。 */
export const SUSTAINED_DAMAGE_SKILL_IDS = ['S01', 'S04', 'S08'] as const;

export type SustainedDamageSkillId = (typeof SUSTAINED_DAMAGE_SKILL_IDS)[number];

const SUSTAINED_SKILL_ID_SET: ReadonlySet<string> = new Set(
  SUSTAINED_DAMAGE_SKILL_IDS,
);

/** 该技能是否按持续伤害结算。 */
export function isSustainedDamageSkill(skillId: string): skillId is SustainedDamageSkillId {
  return SUSTAINED_SKILL_ID_SET.has(skillId);
}

/** 未装备任何持续类技能时的卡面/构筑提示。 */
export const SUSTAINED_CHANNEL_REQUIRED_NOTE = '需持续类技能';

/**
 * 当前装备中受影响的持续来源，按目录顺序输出 `S01 旋刃环` 形式。
 * 未装备/未知/非持续技能会被忽略；同一技能重复出现只列一次。
 */
export function sustainedDamageSourceLabels(
  skillIds: readonly string[] | undefined,
): string[] {
  if (!Array.isArray(skillIds) || skillIds.length === 0) return [];
  const equipped = new Set(skillIds);
  const labels: string[] = [];
  for (const skill of FREE_SKILL_LIST) {
    if (!isSustainedDamageSkill(skill.id)) continue;
    if (!equipped.has(skill.id)) continue;
    labels.push(`${skill.id} ${skill.name}`);
  }
  return labels;
}

/**
 * 卡面/构筑摘要提示：没有持续类技能时写「需持续类技能」，
 * 拥有时列出受影响来源名称。
 */
export function sustainedChannelNote(skillIds: readonly string[] | undefined): string {
  const labels = sustainedDamageSourceLabels(skillIds);
  return labels.length > 0
    ? `影响 ${labels.join('、')}`
    : SUSTAINED_CHANNEL_REQUIRED_NOTE;
}

/** 伤害通道倍率所需的聚合值；直接传 `ComputedStats` 即可。 */
export interface DamageChannelStats {
  readonly damageMultiplier: number;
  readonly skillDamageMultiplier?: number;
  readonly directDamageMultiplier?: number;
  readonly damageOverTimeMultiplier?: number;
  readonly recipeDamageOverTimeMultiplier?: number;
  /** I12 静止增伤等条件倍率；缺省 1。 */
  readonly conditionalDamageMultiplier?: number;
}

function factor(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 1;
}

/**
 * 直击倍率：全局伤害 × 该类攻击修正（技能或 J）× I16 直接伤害 × 条件增伤。
 * 持续伤害倍率不在这里出现。
 */
export function directDamageMultiplierOf(
  stats: DamageChannelStats,
  kindMultiplier = 1,
): number {
  return (
    factor(stats.damageMultiplier) *
    factor(kindMultiplier) *
    factor(stats.directDamageMultiplier) *
    factor(stats.conditionalDamageMultiplier)
  );
}

/**
 * 持续伤害倍率：全局伤害 × 技能修正 × I16 持续伤害 × R02 持续伤害 × 条件增伤。
 * I16 的直接伤害 −5% 不在这里出现；两个持续加成各乘一次。
 */
export function sustainedDamageMultiplierOf(stats: DamageChannelStats): number {
  return (
    factor(stats.damageMultiplier) *
    factor(stats.skillDamageMultiplier) *
    factor(stats.damageOverTimeMultiplier) *
    factor(stats.recipeDamageOverTimeMultiplier) *
    factor(stats.conditionalDamageMultiplier)
  );
}

/** 技能名称；未知 ID 原样返回，便于卡面文案兜底。 */
export function sustainedSkillLabel(skillId: string): string {
  const skill = getFreeSkill(skillId);
  return skill ? `${skill.id} ${skill.name}` : skillId;
}
