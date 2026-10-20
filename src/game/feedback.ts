/**
 * 战斗反馈的集中配色与规则（docs/game-design.md §8）。
 * 纯数据模块，不依赖 Phaser；场景只消费这里的结果，测试可直接断言。
 *
 * 约定：
 * - 友方技能按角色配色，敌方攻击统一暖红警戒色；
 * - 警戒层的绘制深度高于友方特效，强特效下仍能看清危险范围；
 * - 命中至少包含闪白与伤害字两项可见反馈。
 */

import type { CharacterId } from './data';

export interface CharacterEffectColors {
  /** 普通攻击/主技能的主色。 */
  readonly primary: number;
  /** 余震、附加效果或辅助特效色。 */
  readonly secondary: number;
  /** 浮字与技能名文字色。 */
  readonly label: string;
  /** 弹体填充与描边；Saria 无弹体但保留完整字段。 */
  readonly projectileFill: number;
  readonly projectileStroke: number;
}

/** 四角色技能特效配色：轮廓可区分，不共用同一个色调。 */
export const CHARACTER_EFFECT_COLORS: Readonly<
  Record<CharacterId, CharacterEffectColors>
> = {
  // 维什戴尔：红橙炮火与暗色魂灵。
  vishdal: {
    primary: 0xffb347,
    secondary: 0xc77dff,
    label: '#ffd166',
    projectileFill: 0xffb347,
    projectileStroke: 0xffe6a8,
  },
  // 阿米娅：蓝黑术式与奇美拉高亮轮廓。
  amiya: {
    primary: 0x5b9dff,
    secondary: 0xd6e8ff,
    label: '#a8d8ff',
    projectileFill: 0x5b9dff,
    projectileStroke: 0xa8d8ff,
  },
  // 塞雷娅：白橙防护与领域边界。
  saria: {
    primary: 0xffd166,
    secondary: 0xffb3c1,
    label: '#ffe9a8',
    projectileFill: 0xffd166,
    projectileStroke: 0xfff2c9,
  },
  // 缪尔赛思：青绿水体与半透明流形。
  muelsyse: {
    primary: 0x5fd8d0,
    secondary: 0x9df2dd,
    label: '#9df2dd',
    projectileFill: 0x5fd8d0,
    projectileStroke: 0xb9fff7,
  },
};

const FALLBACK_EFFECT_COLORS = CHARACTER_EFFECT_COLORS.vishdal;

/** 未知角色回退到维什戴尔配色，避免渲染路径因缺少条目中断。 */
export function characterEffectColors(characterId: string): CharacterEffectColors {
  return (
    CHARACTER_EFFECT_COLORS[characterId as CharacterId] ?? FALLBACK_EFFECT_COLORS
  );
}

/** 敌方攻击统一暖红警戒纹理（§8）。 */
export const ENEMY_WARNING = {
  fill: 0xff3b3b,
  stroke: 0xff8a5c,
  core: 0xff7a4d,
  projectile: 0xff5a3c,
  text: '#ffb4a2',
  /**
   * 高于友方爆炸（7）与弹体（6），保证警报圈不会被技能特效盖住。
   * 玩家与敌人本体在 4–5，警戒层覆盖它们属于预期：危险范围优先可读。
   */
  depth: 8,
} as const;

/** 友方特效的绘制深度上限；测试用它约束警戒层必须更高。 */
export const FRIENDLY_EFFECT_DEPTH = {
  projectile: 6,
  explosion: 7,
  castPulse: 7,
} as const;

/** 命中闪白与伤害字的固定参数。 */
export const HIT_FEEDBACK = {
  flashColor: 0xffffff,
  flashDurationMs: 80,
  playerHurtSeconds: 0.18,
} as const;

/** 强化获取时的可见反馈参数。 */
export const UPGRADE_FEEDBACK = {
  pulseDurationMs: 420,
  pulseRadius: 26,
  pulseScale: 2.4,
} as const;

export interface HitFeedbackPlan {
  readonly flashColor: number;
  readonly flashDurationMs: number;
  readonly showDamageNumber: boolean;
}

/**
 * 伤害结算 → 可见反馈。未实际造成伤害（无敌期、已死亡目标）不闪不跳字。
 * 实际伤害为 0 但结算成立（例如全部被护盾吸收）仍闪白，让玩家知道命中生效。
 */
export function planHitFeedback(
  applied: boolean,
  damage: number,
): HitFeedbackPlan | null {
  if (!applied) return null;
  return {
    flashColor: HIT_FEEDBACK.flashColor,
    flashDurationMs: HIT_FEEDBACK.flashDurationMs,
    showDamageNumber: damage > 0,
  };
}
