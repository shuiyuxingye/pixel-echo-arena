/**
 * 术士专属海克斯 H31–H36（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/02-content-catalog.md` §48 种海克斯：
 * - H31 穿透术式：J 穿透 2 个额外目标，后续命中 70% 伤害；
 * - H32 心绪共鸣：情绪吸收阈值由 5 降到 3；
 * - H33 双重吟唱：K 追加 3 发 60% 术式，且不再触发第二次疲劳；
 * - H34 代偿契约：奇美拉持续 +3 秒，结束后虚弱 +1 秒；
 * - H35 暗星轨道：每 8 次 J 命中生成一个 4 秒环绕术式，最多 3 个，各每秒 12 法伤；
 * - H36 失控奇美拉：奇美拉期间每第 4 次命中追加 50 真伤，结束后 2 秒不能 J。
 *
 * H31–H34 与旧强化 A01–A04 是同效果的不同来源，场景按「或」合并成一次，
 * 同时拥有不会叠成两份；H34 的 +3 秒与 A04 的 8→11 秒同为一次加成。
 * H35 的环绕物、命中计数与 H36 的待结算追加伤害都存于本模块，
 * 伤害由场景在逻辑步末尾统一结算；拥有关系仍以 `HexRun` 为唯一真源。
 */
import type { ProjectilePierceOptions } from './combat';

/** 本模块落地的 6 种术士专属海克斯。 */
export const SORCERER_HEX_IDS = [
  'H31',
  'H32',
  'H33',
  'H34',
  'H35',
  'H36',
] as const;

export type SorcererHexId = (typeof SORCERER_HEX_IDS)[number];

const SORCERER_HEX_ID_SET: ReadonlySet<string> = new Set(SORCERER_HEX_IDS);

export function isSorcererHexId(hexId: string): hexId is SorcererHexId {
  return SORCERER_HEX_ID_SET.has(hexId);
}

/**
 * H35 环绕术式的伤害半径。02 只写「环绕术式」，未给半径；
 * 取 110，落在霜环 140 与旋刃环 120 之内，保证近身环绕的手感。
 */
export const SORCERER_H35_ORBIT_RADIUS = 110;

/** 环绕术式每秒结算一次伤害。 */
export const SORCERER_H35_TICK_SECONDS = 1;

const TIME_EPSILON = 1e-9;

/** 六种术士专属海克斯的数值；百分比字段以比例书写。 */
export interface SorcererHexParams {
  /** H31：J 额外穿透的目标数。 */
  readonly extraPierce?: number;
  /** H31：穿透后续目标的伤害比例。 */
  readonly subsequentDamageRatio?: number;
  /** H32：情绪吸收触发所需的 J 命中数。 */
  readonly hitsPerTrigger?: number;
  /** H33：K 结束后追加的术式发数。 */
  readonly extraShots?: number;
  /** H33：追加术式的伤害比例。 */
  readonly doubleCastDamageRatio?: number;
  /** H33：追加术式相对 K 结束的延迟（与 A03 同口径）。 */
  readonly doubleCastDelaySeconds?: number;
  /** H34：奇美拉持续时间加成（秒）。 */
  readonly chimeraDurationBonusSeconds?: number;
  /** H34：奇美拉虚弱时间加成（秒）。 */
  readonly weaknessBonusSeconds?: number;
  /** H35：每多少次 J 命中生成一个环绕术式。 */
  readonly jHitsPerOrb?: number;
  /** H35：环绕术式的持续秒数。 */
  readonly orbDurationSeconds?: number;
  /** H35：同时存在的环绕术式上限。 */
  readonly maxOrbs?: number;
  /** H35：每个环绕术式每秒的法术伤害。 */
  readonly orbDamagePerSecond?: number;
  /** H36：奇美拉期间每第几次命中追加真实伤害。 */
  readonly chimeraHitsPerBonus?: number;
  /** H36：每次追加的真实伤害。 */
  readonly chimeraBonusDamage?: number;
  /** H36：奇美拉结束后的禁 J 秒数。 */
  readonly aftermathJLockSeconds?: number;
}

/** 六种术士专属海克斯的数值；与 02 内容目录逐项对应。 */
export const SORCERER_HEX_PARAMS: Readonly<
  Record<SorcererHexId, SorcererHexParams>
> = {
  H31: { extraPierce: 2, subsequentDamageRatio: 0.7 },
  H32: { hitsPerTrigger: 3 },
  H33: {
    extraShots: 3,
    doubleCastDamageRatio: 0.6,
    // 02 未写延迟；与 A03 同为 0.5 秒，保持「双击」的节奏感。
    doubleCastDelaySeconds: 0.5,
  },
  H34: { chimeraDurationBonusSeconds: 3, weaknessBonusSeconds: 1 },
  H35: {
    jHitsPerOrb: 8,
    orbDurationSeconds: 4,
    maxOrbs: 3,
    orbDamagePerSecond: 12,
  },
  H36: { chimeraHitsPerBonus: 4, chimeraBonusDamage: 50, aftermathJLockSeconds: 2 },
};

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function count(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(positive(value, fallback)));
}

/**
 * H31 的 J 穿透：旧强化 A01 与新海克斯同效果，拥有任一即生效。
 * `legacy` 为 A01 已解析出的参数；同时拥有时沿用 A01，避免叠成 4 个目标。
 */
export function resolveSorcererJPierce(
  legacy: ProjectilePierceOptions | null,
  hasRunePierce: boolean,
): ProjectilePierceOptions | null {
  if (legacy) return legacy;
  if (!hasRunePierce) return null;
  return {
    extraTargets: count(SORCERER_HEX_PARAMS.H31.extraPierce, 2),
    subsequentDamageRatio: positive(
      SORCERER_HEX_PARAMS.H31.subsequentDamageRatio,
      0.7,
    ),
  };
}

/**
 * H32 的情绪吸收阈值：A02 与 H32 都把 5 降到 3，取两者中更低的门槛。
 * 非法输入回落到基础值。
 */
export function resolveEmotionalAbsorptionHits(
  baseHits: number,
  legacyHits: number | null,
  hasResonance: boolean,
): number {
  const base =
    Number.isFinite(baseHits) && baseHits >= 1 ? Math.floor(baseHits) : 5;
  const candidates = [base];
  if (legacyHits !== null && Number.isFinite(legacyHits) && legacyHits >= 1) {
    candidates.push(Math.floor(legacyHits));
  }
  if (hasResonance) {
    candidates.push(count(SORCERER_HEX_PARAMS.H32.hitsPerTrigger, 3));
  }
  return Math.max(1, Math.min(...candidates));
}

/**
 * H34 的奇美拉持续时间：A04 的 8→11 秒与 H34 的 +3 秒是同一次加成，
 * 同时拥有也只加一次。返回扣掉持续时间倍率前的秒数。
 */
export function resolveSorcererChimeraDuration(
  baseSeconds: number,
  hasLegacyDuration: boolean,
  hasContract: boolean,
): number {
  const base = positive(baseSeconds, 8);
  return hasLegacyDuration || hasContract
    ? base + count(SORCERER_HEX_PARAMS.H34.chimeraDurationBonusSeconds, 3)
    : base;
}

/** H34 的虚弱时长：基础值 + 1 秒；未拥有时返回基础值。 */
export function resolveSorcererWeaknessSeconds(
  baseSeconds: number,
  hasContract: boolean,
): number {
  const base = Number.isFinite(baseSeconds) && baseSeconds >= 0 ? baseSeconds : 0;
  return hasContract
    ? base + count(SORCERER_HEX_PARAMS.H34.weaknessBonusSeconds, 1)
    : base;
}

/** H33 的追加术式参数；与 A03 同效果，供场景一次性合并开关。 */
export function sorcererDoubleCastParams(): {
  readonly delaySeconds: number;
  readonly shots: number;
  readonly damageRatio: number;
} {
  return {
    delaySeconds: positive(
      SORCERER_HEX_PARAMS.H33.doubleCastDelaySeconds,
      0.5,
    ),
    shots: count(SORCERER_HEX_PARAMS.H33.extraShots, 3),
    damageRatio: positive(
      SORCERER_HEX_PARAMS.H33.doubleCastDamageRatio,
      0.6,
    ),
  };
}

/** 一次 J 命中的 H35 计数结果。 */
export interface SorcererJHitEvent {
  /** 本次命中是否生成了新的环绕术式。 */
  readonly spawnedOrb: boolean;
  /** 累计 J 命中数（波初清零）。 */
  readonly hits: number;
  /** 当前环绕术式数量。 */
  readonly activeOrbs: number;
}

/** 一次环绕术式的每秒结算结果。 */
export interface SorcererOrbTick {
  /** 本步结算的 tick 数（每个环绕术式每秒一次）。 */
  readonly ticks: number;
  /** 本步应结算的原始法术伤害（已按 tick 数与单发伤害乘好）。 */
  readonly damage: number;
}

/** 一条待结算的 H36 追加真伤。 */
export interface SorcererChimeraBonus {
  readonly targetId: string;
  readonly damage: number;
}

interface OrbitOrb {
  remainingSeconds: number;
  tickAccumulator: number;
}

/** 开发快照：H31–H36 的判定参数与运行态计数。 */
export interface SorcererHexSnapshot {
  readonly hexes: readonly string[];
  readonly runePierce: {
    readonly extraTargets: number;
    readonly subsequentDamageRatio: number;
  };
  readonly resonance: {
    readonly hitsPerTrigger: number;
  };
  readonly doubleCast: {
    readonly shots: number;
    readonly damageRatio: number;
    readonly delaySeconds: number;
  };
  readonly contract: {
    readonly chimeraDurationBonusSeconds: number;
    readonly weaknessBonusSeconds: number;
  };
  readonly darkStar: {
    readonly jHitsPerOrb: number;
    readonly maxOrbs: number;
    readonly orbDurationSeconds: number;
    readonly damagePerSecond: number;
    readonly radius: number;
    /** 本波累计 J 命中。 */
    readonly jHits: number;
    /** 本局实际生成的环绕术式数。 */
    readonly orbsSpawned: number;
    /** 当前环绕术式数量。 */
    readonly activeOrbs: number;
    /** 已结算的 tick 数。 */
    readonly ticksResolved: number;
    /** 已结算的原始伤害合计。 */
    readonly damageDealt: number;
  };
  readonly runawayChimera: {
    readonly hitsPerBonus: number;
    readonly bonusDamage: number;
    readonly aftermathJLockSeconds: number;
    /** 本次奇美拉内已累计的命中。 */
    readonly chimeraHits: number;
    /** 本局实际触发的追加真伤次数。 */
    readonly bonusTriggers: number;
    /** 尚待逻辑步末结算的追加真伤条数。 */
    readonly pendingBonuses: number;
  };
}

export interface SorcererHexEffectsConfig {
  readonly has: (hexId: string) => boolean;
}

/**
 * 一局内术士专属海克斯的环绕术式、命中计数与待结算追加伤害。
 * H31/H32/H33/H34 没有运行时状态，由静态 helper 合并；
 * 本类只保留 H35/H36 的波内状态，所有伤害都由场景在逻辑步末尾结算。
 */
export class SorcererHexEffects {
  private readonly hasHex: (hexId: string) => boolean;
  private jHits = 0;
  private orbs: OrbitOrb[] = [];
  private orbsSpawned = 0;
  private orbTicksResolved = 0;
  private orbDamageDealt = 0;
  private chimeraHits = 0;
  private chimeraBonusTriggers = 0;
  private pendingChimeraBonuses: string[] = [];

  constructor(config: SorcererHexEffectsConfig) {
    this.hasHex = config.has;
  }

  has(hexId: string): boolean {
    return this.hasHex(hexId);
  }

  /** 当前拥有的术士专属海克斯，保持目录顺序。 */
  get ownedIds(): SorcererHexId[] {
    return SORCERER_HEX_IDS.filter((hexId) => this.hasHex(hexId));
  }

  get activeOrbCount(): number {
    return this.orbs.length;
  }

  /** H35：单次环绕 tick 的原始伤害（未乘全局倍率与抗性）。 */
  get orbDamagePerTick(): number {
    return (
      positive(SORCERER_HEX_PARAMS.H35.orbDamagePerSecond, 12) *
      SORCERER_H35_TICK_SECONDS
    );
  }

  /** H35：单发环绕术式的每秒伤害（02 数值，12）。 */
  get orbDamagePerSecond(): number {
    return positive(SORCERER_HEX_PARAMS.H35.orbDamagePerSecond, 12);
  }

  /** H36：奇美拉结束后的禁 J 秒数；未拥有时为 0。 */
  get aftermathJLockSeconds(): number {
    return this.hasHex('H36')
      ? positive(SORCERER_HEX_PARAMS.H36.aftermathJLockSeconds, 2)
      : 0;
  }

  /**
   * H35：登记一次原生 J 命中。每 8 次命中生成一个 4 秒环绕术式；
   * 已达上限 3 时不再生成，计数继续推进，空位出现后下一次阈值仍会触发。
   */
  registerJHit(): SorcererJHitEvent {
    if (!this.hasHex('H35')) {
      return { spawnedOrb: false, hits: this.jHits, activeOrbs: this.orbs.length };
    }
    this.jHits += 1;
    const perOrb = count(SORCERER_HEX_PARAMS.H35.jHitsPerOrb, 8);
    const maxOrbs = count(SORCERER_HEX_PARAMS.H35.maxOrbs, 3);
    let spawnedOrb = false;
    if (this.jHits % perOrb === 0 && this.orbs.length < maxOrbs) {
      this.orbs.push({
        remainingSeconds: positive(
          SORCERER_HEX_PARAMS.H35.orbDurationSeconds,
          4,
        ),
        tickAccumulator: 0,
      });
      this.orbsSpawned += 1;
      spawnedOrb = true;
    }
    return { spawnedOrb, hits: this.jHits, activeOrbs: this.orbs.length };
  }

  /**
   * H35：推进环绕计时，返回到期 tick。每个环绕术式独立计时，
   * 大步长会被钳到剩余时长，效果结束后不再补 tick。
   */
  stepOrbs(seconds: number): SorcererOrbTick {
    if (!(seconds > 0) || !Number.isFinite(seconds) || this.orbs.length === 0) {
      return { ticks: 0, damage: 0 };
    }

    let ticks = 0;
    for (const orb of this.orbs) {
      const effective = Math.min(seconds, orb.remainingSeconds);
      orb.remainingSeconds = Math.max(0, orb.remainingSeconds - effective);
      orb.tickAccumulator += effective;
      const orbTicks = Math.floor(
        orb.tickAccumulator / SORCERER_H35_TICK_SECONDS + TIME_EPSILON,
      );
      if (orbTicks > 0) {
        orb.tickAccumulator -= orbTicks * SORCERER_H35_TICK_SECONDS;
        ticks += orbTicks;
      }
    }
    this.orbs = this.orbs.filter(
      (orb) => orb.remainingSeconds > TIME_EPSILON,
    );

    const damage = ticks * this.orbDamagePerTick;
    this.orbTicksResolved += ticks;
    this.orbDamageDealt += damage;
    return { ticks, damage };
  }

  /**
   * H36：同步奇美拉的生效状态；离开奇美拉时清空本次的命中计数，
   * 下一次奇美拉从第 1 次命中重新开始。
   */
  trackChimera(active: boolean): void {
    if (!this.hasHex('H36') || !active) this.chimeraHits = 0;
  }

  /**
   * H36：奇美拉期间登记一次 J/K 原生命中。
   * 每第 4 次命中把 50 真伤排入待结算队列并返回 true；
   * 追加伤害不在命中回调内直接 apply，避免重入与同帧连锁。
   */
  registerChimeraHit(
    targetId: string,
    chimeraActive = true,
  ): boolean {
    if (!this.hasHex('H36')) return false;
    if (!chimeraActive) {
      this.chimeraHits = 0;
      return false;
    }
    if (typeof targetId !== 'string' || targetId.length === 0) return false;

    this.chimeraHits += 1;
    const perBonus = count(SORCERER_HEX_PARAMS.H36.chimeraHitsPerBonus, 4);
    if (this.chimeraHits % perBonus !== 0) return false;

    this.pendingChimeraBonuses.push(targetId);
    this.chimeraBonusTriggers += 1;
    return true;
  }

  /** 取走本步排队的 H36 追加真伤；目标死亡时由场景丢弃，不改判其他敌人。 */
  flushChimeraBonuses(): SorcererChimeraBonus[] {
    if (this.pendingChimeraBonuses.length === 0) return [];
    const damage = positive(SORCERER_HEX_PARAMS.H36.chimeraBonusDamage, 50);
    const pending = this.pendingChimeraBonuses;
    this.pendingChimeraBonuses = [];
    return pending.map((targetId) => ({ targetId, damage }));
  }

  /** 波初清空环绕物、命中计数与待结算追加伤害；每局累计计数保留。 */
  resetForWave(): void {
    this.jHits = 0;
    this.orbs = [];
    this.chimeraHits = 0;
    this.pendingChimeraBonuses = [];
  }

  /** 新开一局：连同每局累计计数一并归零。 */
  reset(): void {
    this.resetForWave();
    this.orbsSpawned = 0;
    this.orbTicksResolved = 0;
    this.orbDamageDealt = 0;
    this.chimeraBonusTriggers = 0;
  }

  snapshot(): SorcererHexSnapshot {
    return {
      hexes: this.ownedIds,
      runePierce: {
        extraTargets: count(SORCERER_HEX_PARAMS.H31.extraPierce, 2),
        subsequentDamageRatio: positive(
          SORCERER_HEX_PARAMS.H31.subsequentDamageRatio,
          0.7,
        ),
      },
      resonance: {
        hitsPerTrigger: count(SORCERER_HEX_PARAMS.H32.hitsPerTrigger, 3),
      },
      doubleCast: sorcererDoubleCastParams(),
      contract: {
        chimeraDurationBonusSeconds: count(
          SORCERER_HEX_PARAMS.H34.chimeraDurationBonusSeconds,
          3,
        ),
        weaknessBonusSeconds: count(
          SORCERER_HEX_PARAMS.H34.weaknessBonusSeconds,
          1,
        ),
      },
      darkStar: {
        jHitsPerOrb: count(SORCERER_HEX_PARAMS.H35.jHitsPerOrb, 8),
        maxOrbs: count(SORCERER_HEX_PARAMS.H35.maxOrbs, 3),
        orbDurationSeconds: positive(
          SORCERER_HEX_PARAMS.H35.orbDurationSeconds,
          4,
        ),
        damagePerSecond: this.orbDamagePerSecond,
        radius: SORCERER_H35_ORBIT_RADIUS,
        jHits: this.jHits,
        orbsSpawned: this.orbsSpawned,
        activeOrbs: this.orbs.length,
        ticksResolved: this.orbTicksResolved,
        damageDealt: this.orbDamageDealt,
      },
      runawayChimera: {
        hitsPerBonus: count(
          SORCERER_HEX_PARAMS.H36.chimeraHitsPerBonus,
          4,
        ),
        bonusDamage: positive(SORCERER_HEX_PARAMS.H36.chimeraBonusDamage, 50),
        aftermathJLockSeconds: this.aftermathJLockSeconds,
        chimeraHits: this.chimeraHits,
        bonusTriggers: this.chimeraBonusTriggers,
        pendingBonuses: this.pendingChimeraBonuses.length,
      },
    };
  }
}
