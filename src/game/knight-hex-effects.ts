/**
 * 骑士专属海克斯 H37–H42（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/02-content-catalog.md` §48 种海克斯：
 * - H37 回生冲击：K 实际治疗量的 80% 转为周围法伤；
 * - H38 钙质反应：领域每秒对敌造成 16 法伤；
 * - H39 坚盾反击：护盾受击触发 18 物伤反击，内置冷却 0.8 秒；
 * - H40 守护转攻：护盾获得量 −20%，盾击伤害 +35%；
 * - H41 重盾远投：每第四次 J 变为穿透飞盾，180 距离、60% 伤害，遵循轻自瞄；
 * - H42 不落王城：领域内每秒获得 8 护盾，盾击附带护盾当前量 15% 的法伤，
 *   单次额外上限 30。
 *
 * H37–H39 与旧强化 S01–S03 是同效果的不同来源，场景按「或」合并成一次，
 * 同时拥有不会叠成两份；H40/H42 的盾击加成与 H41 的飞盾由场景在 J 入口接入，
 * 拥有关系仍以 `HexRun` 为唯一真源。
 */
import type { ProjectilePierceOptions } from './combat';
import type { AttackDefinition } from './data';

/** 本模块落地的 6 种骑士专属海克斯。 */
export const KNIGHT_HEX_IDS = [
  'H37',
  'H38',
  'H39',
  'H40',
  'H41',
  'H42',
] as const;

export type KnightHexId = (typeof KNIGHT_HEX_IDS)[number];

const KNIGHT_HEX_ID_SET: ReadonlySet<string> = new Set(KNIGHT_HEX_IDS);

export function isKnightHexId(hexId: string): hexId is KnightHexId {
  return KNIGHT_HEX_ID_SET.has(hexId);
}

/** 飞盾穿透的额外目标数；02 未给数值，取 3（单次最多命中 4 个目标）。 */
export const KNIGHT_H41_PIERCE_EXTRA_TARGETS = 3;

/** 六种骑士专属海克斯的数值；百分比字段以比例书写。 */
export interface KnightHexParams {
  /** H37：K 实际治疗量转化为法伤的比例。 */
  readonly healDamageRatio?: number;
  /** H37：治疗转伤害的作用半径。 */
  readonly healShockRadius?: number;
  /** H38：领域每秒对敌人造成的法伤。 */
  readonly fieldDamagePerSecond?: number;
  /** H39：护盾反击的作用半径。 */
  readonly counterRadius?: number;
  /** H39：护盾反击的物理伤害。 */
  readonly counterDamage?: number;
  /** H39：护盾反击的内置冷却（秒）。 */
  readonly counterCooldownSeconds?: number;
  /** H40：护盾获得量倍率（−20% 即 0.8）。 */
  readonly shieldGainMultiplier?: number;
  /** H40：盾击伤害倍率（+35% 即 1.35）。 */
  readonly bashDamageMultiplier?: number;
  /** H41：每第几次 J 变为飞盾。 */
  readonly everyNthJ?: number;
  /** H41：飞盾射程。 */
  readonly throwRange?: number;
  /** H41：飞盾伤害相对本次盾击的比例。 */
  readonly throwDamageRatio?: number;
  /** H41：飞盾穿透的额外目标数。 */
  readonly pierceExtraTargets?: number;
  /** H42：领域内每秒获得的护盾。 */
  readonly fieldShieldPerSecond?: number;
  /** H42：盾击附带护盾当前量的法伤比例。 */
  readonly bashMagicRatio?: number;
  /** H42：单次盾击附带法伤的上限。 */
  readonly bashMagicCap?: number;
}

/** 六种骑士专属海克斯的数值；与 02 内容目录逐项对应。 */
export const KNIGHT_HEX_PARAMS: Readonly<
  Record<KnightHexId, KnightHexParams>
> = {
  H37: { healDamageRatio: 0.8, healShockRadius: 100 },
  H38: { fieldDamagePerSecond: 16 },
  H39: { counterRadius: 85, counterDamage: 18, counterCooldownSeconds: 0.8 },
  H40: { shieldGainMultiplier: 0.8, bashDamageMultiplier: 1.35 },
  H41: {
    everyNthJ: 4,
    throwRange: 180,
    throwDamageRatio: 0.6,
    pierceExtraTargets: KNIGHT_H41_PIERCE_EXTRA_TARGETS,
  },
  H42: { fieldShieldPerSecond: 8, bashMagicRatio: 0.15, bashMagicCap: 30 },
};

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function count(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(positive(value, fallback)));
}

/** H37 的治疗转伤害参数；未拥有 S01/H37 时返回 null。 */
export function resolveKnightHealShock(
  hasLegacy: boolean,
  hasHealShock: boolean,
): { readonly ratio: number; readonly radius: number } | null {
  if (!hasLegacy && !hasHealShock) return null;
  return {
    ratio: positive(KNIGHT_HEX_PARAMS.H37.healDamageRatio, 0.8),
    radius: positive(KNIGHT_HEX_PARAMS.H37.healShockRadius, 100),
  };
}

/** H38 的领域每秒伤害；未拥有 S02/H38 时为 0。 */
export function resolveKnightFieldDamage(
  hasLegacy: boolean,
  hasFieldReaction: boolean,
): number {
  return hasLegacy || hasFieldReaction
    ? positive(KNIGHT_HEX_PARAMS.H38.fieldDamagePerSecond, 16)
    : 0;
}

/** H39 的护盾反击配置；未拥有 S03/H39 时 enabled=false。 */
export function resolveKnightShieldCounter(
  hasLegacy: boolean,
  hasShieldCounter: boolean,
): {
  readonly enabled: boolean;
  readonly radius: number;
  readonly damage: number;
  readonly cooldownSeconds: number;
} {
  const enabled = hasLegacy || hasShieldCounter;
  return {
    enabled,
    radius: positive(KNIGHT_HEX_PARAMS.H39.counterRadius, 85),
    damage: positive(KNIGHT_HEX_PARAMS.H39.counterDamage, 18),
    cooldownSeconds: positive(
      KNIGHT_HEX_PARAMS.H39.counterCooldownSeconds,
      0.8,
    ),
  };
}

/** H40 的护盾获得量倍率：拥有时为 0.8，否则为 1。 */
export function resolveKnightShieldGainMultiplier(hasGuard: boolean): number {
  return hasGuard
    ? positive(KNIGHT_HEX_PARAMS.H40.shieldGainMultiplier, 0.8)
    : 1;
}

/** H40 的盾击伤害倍率：拥有时为 1.35，否则为 1。 */
export function resolveKnightBashDamageMultiplier(hasGuard: boolean): number {
  return hasGuard
    ? positive(KNIGHT_HEX_PARAMS.H40.bashDamageMultiplier, 1.35)
    : 1;
}

/** 一次 J 攻击的 H41 计数结果。 */
export interface KnightJAttackEvent {
  /** 本波累计的第几次 J。 */
  readonly index: number;
  /** 本次是否变为穿透飞盾。 */
  readonly isThrow: boolean;
}

/** 开发快照：H37–H42 的判定参数、J 计数与飞盾统计。 */
export interface KnightHexSnapshot {
  readonly hexes: readonly string[];
  readonly healShock: {
    readonly ratio: number;
    readonly radius: number;
  };
  readonly field: {
    readonly damagePerSecond: number;
  };
  readonly shieldCounter: {
    readonly radius: number;
    readonly damage: number;
    readonly cooldownSeconds: number;
  };
  readonly guard: {
    readonly shieldGainMultiplier: number;
    readonly bashDamageMultiplier: number;
  };
  readonly throw: {
    readonly everyNthJ: number;
    readonly range: number;
    readonly damageRatio: number;
    readonly pierceExtraTargets: number;
    /** 本波已登记的 J 次数。 */
    readonly jAttacks: number;
    /** 本波已变出的飞盾数。 */
    readonly throws: number;
  };
  readonly fortress: {
    readonly fieldShieldPerSecond: number;
    readonly bashMagicRatio: number;
    readonly bashMagicCap: number;
  };
}

export interface KnightHexEffectsConfig {
  readonly has: (hexId: string) => boolean;
}

/**
 * 一局内骑士专属海克斯的 J 次数与盾击/护盾派生数值。
 * H37–H39 由静态 helper 与旧强化合并；本类只保留 H40–H42 的开关与 H41 计数，
 * 护盾本身仍只存 `HealthState.shield`，不另建副本。
 */
export class KnightHexEffects {
  private readonly hasHex: (hexId: string) => boolean;
  private jAttacks = 0;
  private throwCount = 0;

  constructor(config: KnightHexEffectsConfig) {
    this.hasHex = config.has;
  }

  has(hexId: string): boolean {
    return this.hasHex(hexId);
  }

  /** 当前拥有的骑士专属海克斯，保持目录顺序。 */
  get ownedIds(): KnightHexId[] {
    return KNIGHT_HEX_IDS.filter((hexId) => this.hasHex(hexId));
  }

  /** H40：护盾获得量倍率（未拥有为 1）。 */
  get shieldGainMultiplier(): number {
    return resolveKnightShieldGainMultiplier(this.hasHex('H40'));
  }

  /** H40：盾击伤害倍率（未拥有为 1）。 */
  get bashDamageMultiplier(): number {
    return resolveKnightBashDamageMultiplier(this.hasHex('H40'));
  }

  /** H42：领域内每秒获得的护盾（未拥有为 0）。 */
  get fieldShieldPerSecond(): number {
    return this.hasHex('H42')
      ? positive(KNIGHT_HEX_PARAMS.H42.fieldShieldPerSecond, 8)
      : 0;
  }

  /** H42：盾击附带法伤的比例（未拥有为 0）。 */
  get shieldBashMagicRatio(): number {
    return this.hasHex('H42')
      ? positive(KNIGHT_HEX_PARAMS.H42.bashMagicRatio, 0.15)
      : 0;
  }

  /** H42：单次盾击附带法伤的上限。 */
  get shieldBashMagicCap(): number {
    return this.hasHex('H42')
      ? positive(KNIGHT_HEX_PARAMS.H42.bashMagicCap, 30)
      : 0;
  }

  /** H41：飞盾射程（180）。 */
  get throwRange(): number {
    return positive(KNIGHT_HEX_PARAMS.H41.throwRange, 180);
  }

  /** H41：飞盾伤害相对本次盾击的比例（0.6）。 */
  get throwDamageRatio(): number {
    return positive(KNIGHT_HEX_PARAMS.H41.throwDamageRatio, 0.6);
  }

  /** H41：飞盾的穿透参数；未拥有时不穿透。 */
  get throwPierce(): ProjectilePierceOptions | null {
    if (!this.hasHex('H41')) return null;
    return {
      extraTargets: count(
        KNIGHT_HEX_PARAMS.H41.pierceExtraTargets,
        KNIGHT_H41_PIERCE_EXTRA_TARGETS,
      ),
      // 每次穿透命中仍按飞盾自身的 60% 伤害结算，不再递减。
      subsequentDamageRatio: 1,
    };
  }

  /**
   * H41：登记一次原生 J。每第 4 次 J 变成穿透飞盾；
   * 波初由场景调用 `resetForWave` 重新计数。
   */
  registerJAttack(): KnightJAttackEvent {
    if (!this.hasHex('H41')) return { index: 0, isThrow: false };
    this.jAttacks += 1;
    const everyNth = count(KNIGHT_HEX_PARAMS.H41.everyNthJ, 4);
    const isThrow = this.jAttacks % everyNth === 0;
    if (isThrow) this.throwCount += 1;
    return { index: this.jAttacks, isThrow };
  }

  /** H40：把盾击伤害 +35% 写进本次攻击定义；未拥有时原样返回。 */
  boostShieldBashDamage(attack: AttackDefinition): AttackDefinition {
    const multiplier = this.bashDamageMultiplier;
    return multiplier === 1
      ? attack
      : { ...attack, damage: attack.damage * multiplier };
  }

  /**
   * H41：把本次盾击攻击改写为飞盾——射程 180、伤害 60%（先吃 H40 的 +35%）。
   * 轻自瞄由场景在创建弹体前调用 `resolveShotAim`，不在本模块处理。
   */
  buildThrowAttack(attack: AttackDefinition): AttackDefinition {
    const boosted = this.boostShieldBashDamage(attack);
    return {
      ...boosted,
      range: this.throwRange,
      damage: boosted.damage * this.throwDamageRatio,
    };
  }

  /**
   * H42：按当前护盾计算本次盾击附带的法伤，单次上限 30。
   * 非法或负护盾按 0 处理，未拥有 H42 时为 0。
   */
  shieldBashMagicDamage(currentShield: number): number {
    const ratio = this.shieldBashMagicRatio;
    if (ratio <= 0) return 0;
    const shield =
      Number.isFinite(currentShield) && currentShield > 0 ? currentShield : 0;
    const cap = this.shieldBashMagicCap;
    return Math.min(cap, shield * ratio);
  }

  /** 波初重置 J 计数；每局累计的飞盾数保留。 */
  resetForWave(): void {
    this.jAttacks = 0;
  }

  /** 新开一局：连同每局累计统计一并归零。 */
  reset(): void {
    this.resetForWave();
    this.throwCount = 0;
  }

  snapshot(): KnightHexSnapshot {
    return {
      hexes: this.ownedIds,
      healShock: {
        ratio: positive(KNIGHT_HEX_PARAMS.H37.healDamageRatio, 0.8),
        radius: positive(KNIGHT_HEX_PARAMS.H37.healShockRadius, 100),
      },
      field: {
        damagePerSecond: positive(
          KNIGHT_HEX_PARAMS.H38.fieldDamagePerSecond,
          16,
        ),
      },
      shieldCounter: {
        radius: positive(KNIGHT_HEX_PARAMS.H39.counterRadius, 85),
        damage: positive(KNIGHT_HEX_PARAMS.H39.counterDamage, 18),
        cooldownSeconds: positive(
          KNIGHT_HEX_PARAMS.H39.counterCooldownSeconds,
          0.8,
        ),
      },
      guard: {
        shieldGainMultiplier: this.shieldGainMultiplier,
        bashDamageMultiplier: this.bashDamageMultiplier,
      },
      throw: {
        everyNthJ: count(KNIGHT_HEX_PARAMS.H41.everyNthJ, 4),
        range: this.throwRange,
        damageRatio: this.throwDamageRatio,
        pierceExtraTargets: count(
          KNIGHT_HEX_PARAMS.H41.pierceExtraTargets,
          KNIGHT_H41_PIERCE_EXTRA_TARGETS,
        ),
        jAttacks: this.jAttacks,
        throws: this.throwCount,
      },
      fortress: {
        fieldShieldPerSecond: this.fieldShieldPerSecond,
        bashMagicRatio: this.shieldBashMagicRatio,
        bashMagicCap: this.shieldBashMagicCap,
      },
    };
  }
}
