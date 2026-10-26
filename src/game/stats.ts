/**
 * 统一属性聚合入口（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §数值初值与上限：
 * - 同一属性的百分比来源先加算，互不相关的属性在最终换算时各自相乘；
 * - 每个加成只进入计算一次，同一来源重复注册不会叠加；
 * - 护甲 −20–200，法抗上限 60%，伤害倍率 ≥0.25，攻速 0.4–2.5，
 *   移速 0.6–1.6，冷却缩减 ≤50%，最大生命 ≥40；
 * - 吸血只按实际伤害结算，排除宝箱与无伤害命中；总比例 ≤8%，
 *   基础每秒治疗上限 12，再应用治疗效果修正。
 *
 * 内容模块（强化、商店道具、海克斯等）只提供 `StatModifier` 与来源 ID，
 * 不直接改写角色数据或生命对象；基础值来自 `characterBaseStats()`。
 */
import type { CharacterDefinition } from './data';

/** 护甲下限/上限：负护甲提高受到的物理伤害。 */
export const ARMOR_MIN = -20;
export const ARMOR_MAX = 200;

/** 最终伤害倍率下限。 */
export const DAMAGE_MULTIPLIER_MIN = 0.25;

/** 攻击速度倍率范围。 */
export const ATTACK_SPEED_MIN = 0.4;
export const ATTACK_SPEED_MAX = 2.5;

/** 移动速度倍率范围。 */
export const MOVE_SPEED_MIN = 0.6;
export const MOVE_SPEED_MAX = 1.6;

/** 射程与弹体尺寸倍率下限；道具会同时提供正负修正，避免缩到不可玩。 */
export const ATTACK_RANGE_MIN = 0.25;
export const PROJECTILE_RADIUS_MIN = 0.25;

/** 冷却缩减上限（V0.2 由 40% 提高到 50%）。 */
export const COOLDOWN_REDUCTION_CAP = 0.5;

/** 法术抗性上限（0–0.6）。 */
export const MAGIC_RESIST_CAP = 0.6;

/** 最大生命下限。 */
export const MIN_MAX_HEALTH = 40;

/** 总吸血比例上限。 */
export const LIFESTEAL_CAP = 0.08;

/** 吸血的基础每秒治疗上限；先截断，再应用治疗效果修正。 */
export const LIFESTEAL_HEAL_PER_SECOND_CAP = 12;

export type StatId =
  | 'maxHealth'
  | 'armor'
  | 'magicResist'
  | 'moveSpeed'
  | 'attackSpeed'
  | 'damage'
  /** I16：只作用于直击的直接伤害倍率，不并入全局 `damage`。 */
  | 'directDamage'
  | 'skillDamage'
  | 'normalAttackDamage'
  | 'attackRange'
  | 'projectileRadius'
  | 'cooldownReduction'
  | 'lifesteal'
  | 'healingEffect'
  /** I15：技能持续时间倍率；正数延长。 */
  | 'skillDuration'
  /** I15/I24：技能冷却惩罚；正数延长冷却，与冷却缩减分别相乘。 */
  | 'skillCooldown'
  /** I13：爆炸半径倍率。 */
  | 'explosionRadius'
  /** I13：爆炸伤害倍率。 */
  | 'explosionDamage'
  /** I24：爆炸技能额外冷却惩罚（只作用于爆炸技能）。 */
  | 'explosionSkillCooldown'
  /** I16：持续伤害倍率；只乘在持续通道上。 */
  | 'damageOverTime'
  /** R02：独立的持续伤害倍率；与 I16 的 `damageOverTime` 叠乘。 */
  | 'recipeDamageOverTime'
  /** I19：召唤物伤害倍率。 */
  | 'summonDamage'
  /** I20：召唤物生命上限倍率。 */
  | 'summonHealth'
  /** I17：经验吸取半径倍率。 */
  | 'xpRadius'
  /** I17：击杀金币倍率。 */
  | 'killGold'
  /** I22：波次完成奖励金币倍率。 */
  | 'completionGold';

export type StatMode = 'flat' | 'percent';

/** 内容模块提供的单条修正；`percent` 以 0.1 表示 +10%。 */
export interface StatModifier {
  readonly stat: StatId;
  readonly mode: StatMode;
  readonly value: number;
}

/** 角色数据里的基础值快照；聚合器不持有角色对象，也不回写它。 */
export interface BaseStats {
  readonly maxHealth: number;
  readonly armor: number;
  /** 0–1 的小数，例如 0.15 表示 15%。 */
  readonly magicResist: number;
  readonly moveSpeed: number;
}

/** 聚合后的只读结果；HUD 与调试快照读取同一份。 */
export interface ComputedStats {
  readonly maxHealth: number;
  readonly armor: number;
  readonly magicResist: number;
  readonly moveSpeed: number;
  readonly moveSpeedMultiplier: number;
  readonly attackSpeedMultiplier: number;
  readonly attackIntervalMultiplier: number;
  readonly damageMultiplier: number;
  /** I16：只作用于直击的直接伤害倍率；与 `damageMultiplier` 相乘。 */
  readonly directDamageMultiplier: number;
  /** I07 等只作用于 K/L/U/I 技能伤害的倍率；与 `damageMultiplier` 相乘。 */
  readonly skillDamageMultiplier: number;
  /** I07 等只作用于 J 普攻伤害的倍率；与 `damageMultiplier` 相乘。 */
  readonly normalAttackDamageMultiplier: number;
  readonly attackRangeMultiplier: number;
  readonly projectileRadiusMultiplier: number;
  readonly cooldownReduction: number;
  readonly cooldownMultiplier: number;
  readonly lifesteal: number;
  readonly healingMultiplier: number;
  /** I15：技能持续时间倍率（1 = 不变）。 */
  readonly skillDurationMultiplier: number;
  /** I15：技能冷却惩罚倍率（1 = 不变，>1 表示更长）。 */
  readonly skillCooldownMultiplier: number;
  /** I13：爆炸半径倍率。 */
  readonly explosionRadiusMultiplier: number;
  /** I13：爆炸伤害倍率。 */
  readonly explosionDamageMultiplier: number;
  /** I24：爆炸技能额外冷却倍率。 */
  readonly explosionSkillCooldownMultiplier: number;
  /** I16：持续伤害倍率。 */
  readonly damageOverTimeMultiplier: number;
  /** R02：独立的持续伤害倍率；与 I16 叠乘。 */
  readonly recipeDamageOverTimeMultiplier: number;
  /** I19：召唤物伤害倍率。 */
  readonly summonDamageMultiplier: number;
  /** I20：召唤物生命上限倍率。 */
  readonly summonHealthMultiplier: number;
  /** I17：经验吸取半径倍率。 */
  readonly xpRadiusMultiplier: number;
  /** I17：击杀金币倍率。 */
  readonly killGoldMultiplier: number;
  /** I22：波次完成奖励金币倍率。 */
  readonly completionGoldMultiplier: number;
}

/** 角色基础值快照；内容模块不得修改返回对象以改写数值。 */
export function characterBaseStats(
  character: Pick<CharacterDefinition, 'maxHealth' | 'armor' | 'magicResist' | 'moveSpeed'>,
): BaseStats {
  return {
    maxHealth: character.maxHealth,
    armor: character.armor,
    magicResist: character.magicResist,
    moveSpeed: character.moveSpeed,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 护甲钳制到 −20–200；非法值按 0 处理。 */
export function clampArmor(value: number): number {
  return Number.isFinite(value) ? clamp(value, ARMOR_MIN, ARMOR_MAX) : 0;
}

/** 法抗钳制到 0–60%；非法值按 0 处理。 */
export function clampMagicResist(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, MAGIC_RESIST_CAP) : 0;
}

/** 伤害倍率下限 0.25。 */
export function clampDamageMultiplier(value: number): number {
  return Number.isFinite(value)
    ? Math.max(DAMAGE_MULTIPLIER_MIN, value)
    : 1;
}

/** 攻速倍率 0.4–2.5。 */
export function clampAttackSpeedMultiplier(value: number): number {
  return Number.isFinite(value)
    ? clamp(value, ATTACK_SPEED_MIN, ATTACK_SPEED_MAX)
    : 1;
}

/** 移速倍率 0.6–1.6。 */
export function clampMoveSpeedMultiplier(value: number): number {
  return Number.isFinite(value)
    ? clamp(value, MOVE_SPEED_MIN, MOVE_SPEED_MAX)
    : 1;
}

/** 冷却缩减 0–50%。 */
export function clampCooldownReduction(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, COOLDOWN_REDUCTION_CAP) : 0;
}

/** 总吸血比例 0–8%。 */
export function clampLifesteal(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, LIFESTEAL_CAP) : 0;
}

/**
 * 治疗效果修正：`multiplier` 缺省/非法按 1，负值按 0。
 * 吸血等基础治疗先按上限截断，再调用本函数。
 */
export function applyHealingModifier(amount: number, multiplier = 1): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const factor =
    typeof multiplier === 'number' && Number.isFinite(multiplier)
      ? Math.max(0, multiplier)
      : 1;
  return amount * factor;
}

/**
 * 属性聚合器：所有内容来源通过 `setSource` 注册，读取时统一结算。
 *
 * 同一 `sourceId` 重复注册只保留最后一次的值，避免商店刷新、强化重算等
 * 重复调用把同一加成累计多次。不同来源的同类百分比加算，不同属性分别
 * 输出倍率，由战斗公式相乘（伤害 × 攻速等）。
 */
export class StatAggregator {
  private readonly base: BaseStats;
  private readonly sources = new Map<string, readonly StatModifier[]>();

  constructor(base: BaseStats) {
    this.base = { ...base };
  }

  /** 基础值只读快照；外部修改返回对象不影响聚合器。 */
  get baseStats(): Readonly<BaseStats> {
    return { ...this.base };
  }

  /** 注册/替换一个来源的全部修正；重复调用不会重复叠加。 */
  setSource(sourceId: string, modifiers: readonly StatModifier[]): void {
    if (typeof sourceId !== 'string' || sourceId.length === 0) {
      throw new Error('StatAggregator sourceId must be a non-empty string');
    }
    this.sources.set(
      sourceId,
      modifiers
        .filter(
          (modifier) =>
            Number.isFinite(modifier.value) &&
            (modifier.mode === 'flat' || modifier.mode === 'percent'),
        )
        .map((modifier) => ({ ...modifier })),
    );
  }

  removeSource(sourceId: string): boolean {
    return this.sources.delete(sourceId);
  }

  hasSource(sourceId: string): boolean {
    return this.sources.has(sourceId);
  }

  /** 清空所有内容来源，回到角色基础值。 */
  clearSources(): void {
    this.sources.clear();
  }

  private sum(stat: StatId, mode: StatMode): number {
    let total = 0;
    for (const modifiers of this.sources.values()) {
      for (const modifier of modifiers) {
        if (modifier.stat !== stat || modifier.mode !== mode) continue;
        total += modifier.value;
      }
    }
    return total;
  }

  private percentFactor(stat: StatId): number {
    return 1 + this.sum(stat, 'percent');
  }

  get maxHealth(): number {
    const flat = this.sum('maxHealth', 'flat');
    const raw = (this.base.maxHealth + flat) * this.percentFactor('maxHealth');
    return Math.max(MIN_MAX_HEALTH, Number.isFinite(raw) ? raw : MIN_MAX_HEALTH);
  }

  get armor(): number {
    const flat = this.sum('armor', 'flat');
    return clampArmor((this.base.armor + flat) * this.percentFactor('armor'));
  }

  get magicResist(): number {
    const flat = this.sum('magicResist', 'flat');
    return clampMagicResist(
      (this.base.magicResist + flat) * this.percentFactor('magicResist'),
    );
  }

  get moveSpeedMultiplier(): number {
    return clampMoveSpeedMultiplier(this.percentFactor('moveSpeed'));
  }

  get moveSpeed(): number {
    return this.base.moveSpeed * this.moveSpeedMultiplier;
  }

  get attackSpeedMultiplier(): number {
    return clampAttackSpeedMultiplier(this.percentFactor('attackSpeed'));
  }

  /** 攻击间隔 = 基础间隔 / 攻速倍率。 */
  get attackIntervalMultiplier(): number {
    return 1 / this.attackSpeedMultiplier;
  }

  get damageMultiplier(): number {
    return clampDamageMultiplier(this.percentFactor('damage'));
  }

  /** I16：只作用于直击的直接伤害倍率；与全局 `damageMultiplier` 分别相乘。 */
  get directDamageMultiplier(): number {
    return this.positiveMultiplier('directDamage');
  }

  /** 技能伤害倍率（I07）；与全局 `damageMultiplier` 分别相乘。 */
  get skillDamageMultiplier(): number {
    return clampDamageMultiplier(this.percentFactor('skillDamage'));
  }

  /** J 普攻伤害倍率（I07）；与全局 `damageMultiplier` 分别相乘。 */
  get normalAttackDamageMultiplier(): number {
    return clampDamageMultiplier(this.percentFactor('normalAttackDamage'));
  }

  /** 射程倍率（I04/I05）；只由道具等来源提供。 */
  get attackRangeMultiplier(): number {
    return Math.max(ATTACK_RANGE_MIN, this.percentFactor('attackRange'));
  }

  /** 弹体碰撞半径倍率（I04）；显示时按直径换算。 */
  get projectileRadiusMultiplier(): number {
    return Math.max(PROJECTILE_RADIUS_MIN, this.percentFactor('projectileRadius'));
  }

  get cooldownReduction(): number {
    return clampCooldownReduction(this.sum('cooldownReduction', 'percent'));
  }

  get cooldownMultiplier(): number {
    return 1 - this.cooldownReduction;
  }

  get lifesteal(): number {
    return clampLifesteal(this.sum('lifesteal', 'percent'));
  }

  get healingMultiplier(): number {
    return Math.max(0, this.percentFactor('healingEffect'));
  }

  /** 正数倍率的通用钳制：非法或非正数回退 1，下限 0.25。 */
  private positiveMultiplier(stat: StatId): number {
    const value = this.percentFactor(stat);
    return Number.isFinite(value) ? Math.max(0.25, value) : 1;
  }

  /** I15：技能持续时间倍率。 */
  get skillDurationMultiplier(): number {
    return this.positiveMultiplier('skillDuration');
  }

  /** I15：技能冷却惩罚；与冷却缩减分别相乘，>1 表示冷却更长。 */
  get skillCooldownMultiplier(): number {
    return this.positiveMultiplier('skillCooldown');
  }

  /** I13：爆炸半径倍率。 */
  get explosionRadiusMultiplier(): number {
    return this.positiveMultiplier('explosionRadius');
  }

  /** I13：爆炸伤害倍率。 */
  get explosionDamageMultiplier(): number {
    return this.positiveMultiplier('explosionDamage');
  }

  /** I24：爆炸技能额外冷却倍率，只乘在爆炸技能上。 */
  get explosionSkillCooldownMultiplier(): number {
    return this.positiveMultiplier('explosionSkillCooldown');
  }

  /** I16：持续伤害倍率；只乘在持续通道上。 */
  get damageOverTimeMultiplier(): number {
    return this.positiveMultiplier('damageOverTime');
  }

  /** R02：独立的持续伤害倍率；与 I16 叠乘，每个加成只进入一次计算。 */
  get recipeDamageOverTimeMultiplier(): number {
    return this.positiveMultiplier('recipeDamageOverTime');
  }

  /** I19：召唤物伤害倍率。 */
  get summonDamageMultiplier(): number {
    return this.positiveMultiplier('summonDamage');
  }

  /** I20：召唤物生命上限倍率。 */
  get summonHealthMultiplier(): number {
    return this.positiveMultiplier('summonHealth');
  }

  /** I17：经验吸取半径倍率。 */
  get xpRadiusMultiplier(): number {
    return this.positiveMultiplier('xpRadius');
  }

  /** I17：击杀金币倍率。 */
  get killGoldMultiplier(): number {
    return this.positiveMultiplier('killGold');
  }

  /** I22：波次完成奖励金币倍率；代价可低于 1。 */
  get completionGoldMultiplier(): number {
    return this.positiveMultiplier('completionGold');
  }

  snapshot(): ComputedStats {
    return {
      maxHealth: this.maxHealth,
      armor: this.armor,
      magicResist: this.magicResist,
      moveSpeed: this.moveSpeed,
      moveSpeedMultiplier: this.moveSpeedMultiplier,
      attackSpeedMultiplier: this.attackSpeedMultiplier,
      attackIntervalMultiplier: this.attackIntervalMultiplier,
      damageMultiplier: this.damageMultiplier,
      directDamageMultiplier: this.directDamageMultiplier,
      skillDamageMultiplier: this.skillDamageMultiplier,
      normalAttackDamageMultiplier: this.normalAttackDamageMultiplier,
      attackRangeMultiplier: this.attackRangeMultiplier,
      projectileRadiusMultiplier: this.projectileRadiusMultiplier,
      cooldownReduction: this.cooldownReduction,
      cooldownMultiplier: this.cooldownMultiplier,
      lifesteal: this.lifesteal,
      healingMultiplier: this.healingMultiplier,
      skillDurationMultiplier: this.skillDurationMultiplier,
      skillCooldownMultiplier: this.skillCooldownMultiplier,
      explosionRadiusMultiplier: this.explosionRadiusMultiplier,
      explosionDamageMultiplier: this.explosionDamageMultiplier,
      explosionSkillCooldownMultiplier: this.explosionSkillCooldownMultiplier,
      damageOverTimeMultiplier: this.damageOverTimeMultiplier,
      recipeDamageOverTimeMultiplier: this.recipeDamageOverTimeMultiplier,
      summonDamageMultiplier: this.summonDamageMultiplier,
      summonHealthMultiplier: this.summonHealthMultiplier,
      xpRadiusMultiplier: this.xpRadiusMultiplier,
      killGoldMultiplier: this.killGoldMultiplier,
      completionGoldMultiplier: this.completionGoldMultiplier,
    };
  }
}

export interface LifestealOptions {
  /** 来自 `StatAggregator.lifesteal` 的总比例；内部再钳制到 8%。 */
  readonly lifesteal: number;
  /** 治疗效果修正，缺省 1。 */
  readonly healingMultiplier?: number;
  /** 宝箱伤害不产生吸血。 */
  readonly isChest?: boolean;
  /**
   * 本来源每秒基础治疗上限；缺省为全局 12。
   * I10 按层数传入 4×层数，避免低层数时提前吃满全局上限。
   */
  readonly healPerSecondCap?: number;
}

/**
 * 吸血结算器：按实际伤害与当前总比例换算，维护每秒基础治疗预算。
 *
 * 调用方只在伤害真正生效（`DamageResult.applied`）时传入 `result.damage`；
 * 未造成伤害的命中、宝箱与死亡目标不应调用。每满 1 秒重置一次预算。
 */
export class LifestealTracker {
  private healedThisSecondValue = 0;
  private windowSeconds = 0;

  /** 本秒已使用的基础治疗量（未乘治疗效果修正）。 */
  get healedThisSecond(): number {
    return this.healedThisSecondValue;
  }

  absorb(actualDamage: number, options: LifestealOptions): number {
    if (options.isChest) return 0;
    if (!Number.isFinite(actualDamage) || actualDamage <= 0) return 0;

    const ratio = clampLifesteal(options.lifesteal);
    const cap =
      typeof options.healPerSecondCap === 'number' &&
      Number.isFinite(options.healPerSecondCap)
        ? Math.max(0, options.healPerSecondCap)
        : LIFESTEAL_HEAL_PER_SECOND_CAP;
    const remaining = Math.max(0, cap - this.healedThisSecondValue);
    if (remaining <= 0 || ratio <= 0) return 0;

    const baseHeal = Math.min(actualDamage * ratio, remaining);
    this.healedThisSecondValue += baseHeal;
    return applyHealingModifier(baseHeal, options.healingMultiplier);
  }

  /** 推进逻辑时钟；每满 1 秒重置每秒治疗预算。 */
  step(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.windowSeconds += seconds;
    while (this.windowSeconds >= 1) {
      this.windowSeconds -= 1;
      this.healedThisSecondValue = 0;
    }
  }

  reset(): void {
    this.healedThisSecondValue = 0;
    this.windowSeconds = 0;
  }
}
