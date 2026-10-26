/**
 * 战术家专属海克斯 H43–H48（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/02-content-catalog.md` §48 种海克斯：
 * - H43 双生流形：远程副本上限 +1，近战窃取上限 +3；
 * - H44 生态复苏：主流形每秒回复 2%，L 开启时回复 20%；
 * - H45 聚合涡旋：近战拉拽范围 +30%，远程束缚 +0.25 秒；
 * - H46 脆弱军团：召唤物伤害 +35%、生命 −25%；
 * - H47 水镜共鸣：J 命中使主流形补一次 40% 攻击，冷却 0.6 秒，不触发分裂；
 * - H48 形态接力：切换形态后 3 秒召唤物攻击速度 +40%，切换仍遵守冷却。
 *
 * H43–H45/H47 与旧强化 M01–M04 是同效果的不同来源，场景按「或」合并成一次，
 * 同时拥有不会叠成两份；H46/H48 的数值由场景读取后交给 `MuelsyseCombat` 结算，
 * 拥有关系仍以 `HexRun` 为唯一真源。
 */

/** 本模块落地的 6 种战术家专属海克斯。 */
export const TACTICIAN_HEX_IDS = [
  'H43',
  'H44',
  'H45',
  'H46',
  'H47',
  'H48',
] as const;

export type TacticianHexId = (typeof TACTICIAN_HEX_IDS)[number];

const TACTICIAN_HEX_ID_SET: ReadonlySet<string> = new Set(TACTICIAN_HEX_IDS);

export function isTacticianHexId(hexId: string): hexId is TacticianHexId {
  return TACTICIAN_HEX_ID_SET.has(hexId);
}

/** 六种战术家专属海克斯的数值；百分比字段以比例书写。 */
export interface TacticianHexParams {
  /** H43：远程副本上限加成。 */
  readonly rangedMaxCopiesBonus?: number;
  /** H43：近战攻击窃取层数上限加成。 */
  readonly meleeMaxStacksBonus?: number;
  /** H44：主流形每秒回复最大生命的比例。 */
  readonly healPercentPerSecond?: number;
  /** H44：L 开启时的即时回复比例。 */
  readonly healOnActivatePercent?: number;
  /** H45：近战 L 拉拽范围加成比例。 */
  readonly pullRangeBonus?: number;
  /** H45：远程 L 束缚时间加成（秒）。 */
  readonly rootBonusSeconds?: number;
  /** H46：召唤物伤害倍率（+35% 即 1.35）。 */
  readonly summonDamageMultiplier?: number;
  /** H46：召唤物生命上限倍率（−25% 即 0.75）。 */
  readonly summonHealthMultiplier?: number;
  /** H47：补攻伤害相对主流形攻击的比例。 */
  readonly damageRatio?: number;
  /** H47：补攻的内置冷却（秒）。 */
  readonly internalCooldownSeconds?: number;
  /** H48：切换形态后的召唤物攻速加成比例。 */
  readonly attackSpeedBonusRatio?: number;
  /** H48：切换形态后的攻速加成持续时间（秒）。 */
  readonly attackSpeedBonusSeconds?: number;
}

/** 六种战术家专属海克斯的数值；与 02 内容目录逐项对应。 */
export const TACTICIAN_HEX_PARAMS: Readonly<
  Record<TacticianHexId, TacticianHexParams>
> = {
  H43: { rangedMaxCopiesBonus: 1, meleeMaxStacksBonus: 3 },
  H44: { healPercentPerSecond: 0.02, healOnActivatePercent: 0.2 },
  H45: { pullRangeBonus: 0.3, rootBonusSeconds: 0.25 },
  H46: { summonDamageMultiplier: 1.35, summonHealthMultiplier: 0.75 },
  H47: { damageRatio: 0.4, internalCooldownSeconds: 0.6 },
  H48: { attackSpeedBonusRatio: 0.4, attackSpeedBonusSeconds: 3 },
};

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/** H43 的远程副本与近战窃取上限。 */
export interface TacticianDualFormLimits {
  readonly maxCopies: number;
  readonly maxMeleeStacks: number;
}

/**
 * H43 的上限：在角色基础值上加 +1 副本 / +3 窃取层数，
 * 与 M01 同时拥有时取两者中更高的上限，不会叠成 +2 / +6。
 * 未拥有任一来源时返回 null，交回角色基础配置。
 */
export function resolveTacticianDualForm(
  base: TacticianDualFormLimits,
  legacy: TacticianDualFormLimits | null,
  hasTwins: boolean,
): TacticianDualFormLimits | null {
  if (legacy === null && !hasTwins) return null;
  const baseCopies = nonNegativeInt(base.maxCopies);
  const baseStacks = nonNegativeInt(base.maxMeleeStacks);
  const hexCopies =
    baseCopies + nonNegativeInt(TACTICIAN_HEX_PARAMS.H43.rangedMaxCopiesBonus ?? 1);
  const hexStacks =
    baseStacks + nonNegativeInt(TACTICIAN_HEX_PARAMS.H43.meleeMaxStacksBonus ?? 3);
  return {
    maxCopies: Math.max(legacy ? nonNegativeInt(legacy.maxCopies) : 0, hasTwins ? hexCopies : 0),
    maxMeleeStacks: Math.max(
      legacy ? nonNegativeInt(legacy.maxMeleeStacks) : 0,
      hasTwins ? hexStacks : 0,
    ),
  };
}

/** H44 的生态复苏参数；未拥有 M02/H44 时为 null。 */
export function resolveTacticianEcologicalRecovery(
  legacy: {
    readonly healPercentPerSecond: number;
    readonly healOnActivatePercent: number;
  } | null,
  hasRecovery: boolean,
): { readonly healPercentPerSecond: number; readonly healOnActivatePercent: number } | null {
  if (legacy) {
    return {
      healPercentPerSecond: positive(legacy.healPercentPerSecond, 0.02),
      healOnActivatePercent: positive(legacy.healOnActivatePercent, 0.2),
    };
  }
  if (!hasRecovery) return null;
  return {
    healPercentPerSecond: positive(
      TACTICIAN_HEX_PARAMS.H44.healPercentPerSecond,
      0.02,
    ),
    healOnActivatePercent: positive(
      TACTICIAN_HEX_PARAMS.H44.healOnActivatePercent,
      0.2,
    ),
  };
}

/** H45 的聚合涡旋参数；未拥有 M03/H45 时为 null。 */
export function resolveTacticianAggregationVortex(
  legacy: {
    readonly pullRangeBonus: number;
    readonly rootBonusSeconds: number;
  } | null,
  hasVortex: boolean,
): { readonly pullRangeBonus: number; readonly rootBonusSeconds: number } | null {
  if (legacy) {
    return {
      pullRangeBonus: positive(legacy.pullRangeBonus, 0.3),
      rootBonusSeconds: positive(legacy.rootBonusSeconds, 0.25),
    };
  }
  if (!hasVortex) return null;
  return {
    pullRangeBonus: positive(TACTICIAN_HEX_PARAMS.H45.pullRangeBonus, 0.3),
    rootBonusSeconds: positive(TACTICIAN_HEX_PARAMS.H45.rootBonusSeconds, 0.25),
  };
}

/** H47 的水镜共鸣参数；未拥有 M04/H47 时为 null。 */
export function resolveTacticianWaterMirror(
  legacy: {
    readonly damageRatio: number;
    readonly internalCooldownSeconds: number;
  } | null,
  hasResonance: boolean,
): { readonly damageRatio: number; readonly internalCooldownSeconds: number } | null {
  if (legacy) {
    return {
      damageRatio: positive(legacy.damageRatio, 0.4),
      internalCooldownSeconds: positive(
        legacy.internalCooldownSeconds,
        0.6,
      ),
    };
  }
  if (!hasResonance) return null;
  return {
    damageRatio: positive(TACTICIAN_HEX_PARAMS.H47.damageRatio, 0.4),
    internalCooldownSeconds: positive(
      TACTICIAN_HEX_PARAMS.H47.internalCooldownSeconds,
      0.6,
    ),
  };
}

/** 开发快照：H43–H48 的判定参数与 H48 的剩余窗口。 */
export interface TacticianHexSnapshot {
  readonly hexes: readonly string[];
  readonly dualForm: {
    readonly rangedMaxCopiesBonus: number;
    readonly meleeMaxStacksBonus: number;
  };
  readonly ecologicalRecovery: {
    readonly healPercentPerSecond: number;
    readonly healOnActivatePercent: number;
  };
  readonly aggregationVortex: {
    readonly pullRangeBonus: number;
    readonly rootBonusSeconds: number;
  };
  readonly fragileLegion: {
    readonly summonDamageMultiplier: number;
    readonly summonHealthMultiplier: number;
  };
  readonly waterMirror: {
    readonly damageRatio: number;
    readonly internalCooldownSeconds: number;
  };
  readonly formRelay: {
    readonly attackSpeedBonusRatio: number;
    readonly attackSpeedBonusSeconds: number;
    /** 当前形态接力窗口剩余秒数；未切换或未拥有为 0。 */
    readonly remainingSeconds: number;
  };
}

export interface TacticianHexEffectsConfig {
  readonly has: (hexId: string) => boolean;
}

/**
 * 一局内战术家专属海克斯的派生数值。
 * H43–H45/H47 由静态 helper 与旧强化合并；H46/H48 的倍率由场景读取后
 * 同步给 `MuelsyseCombat`，本类不保存战斗运行态（剩余窗口由主形持有）。
 */
export class TacticianHexEffects {
  private readonly hasHex: (hexId: string) => boolean;

  constructor(config: TacticianHexEffectsConfig) {
    this.hasHex = config.has;
  }

  has(hexId: string): boolean {
    return this.hasHex(hexId);
  }

  /** 当前拥有的战术家专属海克斯，保持目录顺序。 */
  get ownedIds(): TacticianHexId[] {
    return TACTICIAN_HEX_IDS.filter((hexId) => this.hasHex(hexId));
  }

  /** H46：所有召唤物伤害倍率（未拥有为 1）。 */
  get summonDamageMultiplier(): number {
    return this.hasHex('H46')
      ? positive(TACTICIAN_HEX_PARAMS.H46.summonDamageMultiplier, 1.35)
      : 1;
  }

  /** H46：所有召唤物生命上限倍率（未拥有为 1）。 */
  get summonHealthMultiplier(): number {
    return this.hasHex('H46')
      ? positive(TACTICIAN_HEX_PARAMS.H46.summonHealthMultiplier, 0.75)
      : 1;
  }

  /** H48：切换形态后的召唤物攻速加成比例（未拥有为 0）。 */
  get attackSpeedBonusRatio(): number {
    return this.hasHex('H48')
      ? positive(TACTICIAN_HEX_PARAMS.H48.attackSpeedBonusRatio, 0.4)
      : 0;
  }

  /** H48：攻速加成的持续时间（未拥有为 0）。 */
  get attackSpeedBonusSeconds(): number {
    return this.hasHex('H48')
      ? positive(TACTICIAN_HEX_PARAMS.H48.attackSpeedBonusSeconds, 3)
      : 0;
  }

  snapshot(formRelayRemainingSeconds = 0): TacticianHexSnapshot {
    const remaining =
      Number.isFinite(formRelayRemainingSeconds) && formRelayRemainingSeconds > 0
        ? formRelayRemainingSeconds
        : 0;
    return {
      hexes: this.ownedIds,
      dualForm: {
        rangedMaxCopiesBonus: nonNegativeInt(
          TACTICIAN_HEX_PARAMS.H43.rangedMaxCopiesBonus ?? 1,
        ),
        meleeMaxStacksBonus: nonNegativeInt(
          TACTICIAN_HEX_PARAMS.H43.meleeMaxStacksBonus ?? 3,
        ),
      },
      ecologicalRecovery: {
        healPercentPerSecond: positive(
          TACTICIAN_HEX_PARAMS.H44.healPercentPerSecond,
          0.02,
        ),
        healOnActivatePercent: positive(
          TACTICIAN_HEX_PARAMS.H44.healOnActivatePercent,
          0.2,
        ),
      },
      aggregationVortex: {
        pullRangeBonus: positive(TACTICIAN_HEX_PARAMS.H45.pullRangeBonus, 0.3),
        rootBonusSeconds: positive(
          TACTICIAN_HEX_PARAMS.H45.rootBonusSeconds,
          0.25,
        ),
      },
      fragileLegion: {
        summonDamageMultiplier: this.summonDamageMultiplier,
        summonHealthMultiplier: this.summonHealthMultiplier,
      },
      waterMirror: {
        damageRatio: positive(TACTICIAN_HEX_PARAMS.H47.damageRatio, 0.4),
        internalCooldownSeconds: positive(
          TACTICIAN_HEX_PARAMS.H47.internalCooldownSeconds,
          0.6,
        ),
      },
      formRelay: {
        attackSpeedBonusRatio: this.attackSpeedBonusRatio,
        attackSpeedBonusSeconds: this.attackSpeedBonusSeconds,
        remainingSeconds: remaining,
      },
    };
  }
}

function nonNegativeInt(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}
