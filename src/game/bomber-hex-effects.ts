/**
 * 爆破手专属海克斯 H25–H30（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/02-content-catalog.md` §48 种海克斯：
 * - H25 二次余震：榴弹追加一次 50% 余震（延迟沿用 W01 的 0.7 秒）；
 * - H26 残影传染：残影引爆向最多 2 名邻敌附着标记，同次爆炸不引爆新标记；
 * - H27 三炮齐鸣：爆裂黎明每次启动后每第三发追加两枚 25% 小弹；
 * - H28 魂灵游行：魂灵上限 +1，并缓慢跟随玩家（02 未给速度，取 60 px/s）；
 * - H29 巨型装药：爆炸半径 +30%，发射间隔 +10%
 *   （按攻速倍率 0.9 实现，与 I14 同口径，不按 1/1.1 换算）；
 * - H30 烟花谢幕：爆裂黎明最后一发造成 3 次各 60% 波纹，波纹不再衍生。
 *
 * 本模块只存计数、波纹队列与派生数值；实际伤害由 `GrenadeSystem` 的
 * `applyRipple` 结算，魂灵跟随由 `SoulSystem.setFollowPlayer` 执行，
 * 爆裂黎明的第三发计数在 `BurstSystem` 内推进。拥有关系仍以 `HexRun` 为唯一真源。
 */
import type { StatModifier } from './stats';

/** 本模块落地的 6 种爆破手专属海克斯。 */
export const BOMBER_HEX_IDS = [
  'H25',
  'H26',
  'H27',
  'H28',
  'H29',
  'H30',
] as const;

export type BomberHexId = (typeof BOMBER_HEX_IDS)[number];

const BOMBER_HEX_ID_SET: ReadonlySet<string> = new Set(BOMBER_HEX_IDS);

export function isBomberHexId(hexId: string): hexId is BomberHexId {
  return BOMBER_HEX_ID_SET.has(hexId);
}

/** 六种专属海克斯的数值；百分比字段以百分点书写。 */
export interface BomberHexParams {
  /** H25：追加余震的延迟秒数（与 W01 同口径）。 */
  readonly secondAftershockDelaySeconds?: number;
  /** H25：追加余震的伤害比例。 */
  readonly secondAftershockDamageRatio?: number;
  /** H26：单次残影引爆最多扩散的标记数。 */
  readonly markSpreadTargets?: number;
  /** H27：每第几发强化弹触发一次小弹。 */
  readonly tripleShotEveryNth?: number;
  /** H27：每次追加的小弹数量。 */
  readonly tripleShotCount?: number;
  /** H27：小弹伤害比例。 */
  readonly tripleShotDamageRatio?: number;
  /** H27：小弹相对准星方向的偏转角（度）。 */
  readonly tripleShotSpreadDegrees?: number;
  /** H28：魂灵上限加成。 */
  readonly soulCapacityBonus?: number;
  /** H28：魂灵跟随速度（逻辑像素/秒）。 */
  readonly soulFollowSpeed?: number;
  /** H28：魂灵停止跟随的距离（逻辑像素）。 */
  readonly soulFollowDistance?: number;
  /** H29：爆炸半径加成（百分点）。 */
  readonly explosionRadiusPercent?: number;
  /** H29：发射间隔 +10% 对应的攻速削减（百分点）。 */
  readonly attackSpeedPercent?: number;
  /** H30：谢幕波纹次数。 */
  readonly finaleWaveCount?: number;
  /** H30：每次波纹的伤害比例。 */
  readonly finaleWaveDamageRatio?: number;
  /** H30：相邻两次波纹的间隔秒数。 */
  readonly finaleWaveIntervalSeconds?: number;
}

/** 六种爆破手专属海克斯的数值；与 02 内容目录逐项对应。 */
export const BOMBER_HEX_PARAMS: Readonly<Record<BomberHexId, BomberHexParams>> = {
  H25: {
    // 02 只写「追加一次 50% 余震」；延迟沿用 W01 的 0.7 秒。
    secondAftershockDelaySeconds: 0.7,
    secondAftershockDamageRatio: 0.5,
  },
  H26: { markSpreadTargets: 2 },
  H27: {
    tripleShotEveryNth: 3,
    tripleShotCount: 2,
    tripleShotDamageRatio: 0.25,
    tripleShotSpreadDegrees: 10,
  },
  H28: { soulCapacityBonus: 1, soulFollowSpeed: 60, soulFollowDistance: 40 },
  H29: { explosionRadiusPercent: 30, attackSpeedPercent: 10 },
  H30: {
    finaleWaveCount: 3,
    finaleWaveDamageRatio: 0.6,
    // 02 未给间隔；取 0.15 秒，让三次波纹在画面上可分辨但不拖慢战斗。
    finaleWaveIntervalSeconds: 0.15,
  },
};

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function percentPoints(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value / 100 : 0;
}

/**
 * H28 的魂灵上限：基础上限 + 旧强化 W03 的加成 + H28 的 +1。
 * 两个来源各自独立，同时拥有时叠到 3；非法输入按 1 处理。
 */
export function resolveBomberSoulCapacity(
  baseMaxSummons: number,
  legacyBonus: number,
  hasSoulMarch: boolean,
): number {
  const base =
    Number.isFinite(baseMaxSummons) && baseMaxSummons >= 1
      ? Math.floor(baseMaxSummons)
      : 1;
  const legacy =
    Number.isFinite(legacyBonus) && legacyBonus > 0
      ? Math.floor(legacyBonus)
      : 0;
  const bonus = hasSoulMarch
    ? Math.max(0, Math.floor(BOMBER_HEX_PARAMS.H28.soulCapacityBonus ?? 1))
    : 0;
  return Math.max(1, base + legacy + bonus);
}

/**
 * H27 两枚小弹相对准星方向的偏转角（弧度），左右各一枚。
 * 02 未给散射角，取 ±10°，让两枚小弹在画面上可分且仍贴近主弹道。
 */
export function planH27SmallShotAngles(): number[] {
  const count = Math.max(
    1,
    Math.floor(BOMBER_HEX_PARAMS.H27.tripleShotCount ?? 2),
  );
  const spread =
    (positive(BOMBER_HEX_PARAMS.H27.tripleShotSpreadDegrees, 10) * Math.PI) /
    180;
  // 两枚时固定 ±spread；更多枚时围绕准星均匀展开。
  if (count === 1) return [0];
  return Array.from(
    { length: count },
    (_, index) => -spread + (2 * spread * index) / (count - 1),
  );
}

/** 一次已到期的 H30 谢幕波纹。 */
export interface FinaleWave {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly damage: number;
}

interface PendingFinaleWave {
  readonly dueAt: number;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly damage: number;
}

/** 开发快照用：H27 计数与 H30 波纹队列的实时状态。 */
export interface BomberHexSnapshot {
  readonly hexes: readonly string[];
  readonly tripleShot: {
    readonly everyNthShot: number;
    readonly extraShots: number;
    readonly damageRatio: number;
    /** 本局实际触发「三炮齐鸣」的次数。 */
    readonly triggers: number;
  };
  readonly soulMarch: {
    readonly capacityBonus: number;
    readonly followSpeed: number;
    readonly followDistance: number;
  };
  readonly giantCharge: {
    readonly explosionRadiusPercent: number;
    readonly attackSpeedPercent: number;
  };
  readonly finale: {
    readonly waveCount: number;
    readonly damageRatio: number;
    readonly intervalSeconds: number;
    /** 本局排入的谢幕次数。 */
    readonly queues: number;
    /** 已实际结算的波纹数。 */
    readonly wavesResolved: number;
    /** 尚在等待结算的波纹数。 */
    readonly pendingWaves: number;
  };
}

export interface BomberHexEffectsConfig {
  readonly has: (hexId: string) => boolean;
}

/**
 * 一局内爆破手专属海克斯的计数与波纹队列。
 * H25/H26/H29 没有运行时状态，只在读取时派生；H27 的第三发计数在
 * `BurstSystem` 内完成，本模块只记录实际触发次数供核验。
 */
export class BomberHexEffects {
  private readonly hasHex: (hexId: string) => boolean;
  private elapsed = 0;
  private pendingWaves: PendingFinaleWave[] = [];
  private finaleQueues = 0;
  private finaleWavesResolved = 0;
  private tripleShotTriggers = 0;

  constructor(config: BomberHexEffectsConfig) {
    this.hasHex = config.has;
  }

  has(hexId: string): boolean {
    return this.hasHex(hexId);
  }

  /** 当前拥有的爆破手专属海克斯，保持目录顺序。 */
  get ownedIds(): BomberHexId[] {
    return BOMBER_HEX_IDS.filter((hexId) => this.hasHex(hexId));
  }

  /** H29 的战斗属性：爆炸半径 +30%，攻速 −10%（间隔约 ×1.111）。 */
  get statModifiers(): StatModifier[] {
    if (!this.hasHex('H29')) return [];
    const modifiers: StatModifier[] = [];
    const radius = percentPoints(BOMBER_HEX_PARAMS.H29.explosionRadiusPercent);
    if (radius !== 0) {
      modifiers.push({ stat: 'explosionRadius', mode: 'percent', value: radius });
    }
    const attackSpeed = -percentPoints(BOMBER_HEX_PARAMS.H29.attackSpeedPercent);
    if (attackSpeed !== 0) {
      modifiers.push({ stat: 'attackSpeed', mode: 'percent', value: attackSpeed });
    }
    return modifiers;
  }

  /** H28：魂灵上限加成；未拥有时为 0。 */
  get soulCapacityBonus(): number {
    return this.hasHex('H28')
      ? Math.max(0, Math.floor(BOMBER_HEX_PARAMS.H28.soulCapacityBonus ?? 1))
      : 0;
  }

  /** H28：魂灵跟随速度；未拥有时为 0。 */
  get soulFollowSpeed(): number {
    return this.hasHex('H28')
      ? positive(BOMBER_HEX_PARAMS.H28.soulFollowSpeed, 60)
      : 0;
  }

  /** H28：魂灵停止跟随的距离；未拥有时为 0。 */
  get soulFollowDistance(): number {
    return this.hasHex('H28')
      ? positive(BOMBER_HEX_PARAMS.H28.soulFollowDistance, 40)
      : 0;
  }

  /** H27：场景实际追加过一次两枚小弹时登记，供开发快照核对。 */
  recordTripleShotTrigger(): void {
    this.tripleShotTriggers += 1;
  }

  /**
   * H30：爆裂黎明最后一发命中后排队 3 次波纹。
   * 只有拥有 H30 才接受；每次排队都是独立的一组，波纹本身不会再排队。
   */
  queueFinaleWaves(
    center: { readonly x: number; readonly y: number },
    radius: number,
    damage: number,
  ): boolean {
    if (!this.hasHex('H30')) return false;
    if (!(radius > 0) || !(damage > 0)) return false;
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return false;

    const count = Math.max(
      1,
      Math.floor(BOMBER_HEX_PARAMS.H30.finaleWaveCount ?? 3),
    );
    const interval = positive(
      BOMBER_HEX_PARAMS.H30.finaleWaveIntervalSeconds,
      0.15,
    );
    const ratio = positive(
      BOMBER_HEX_PARAMS.H30.finaleWaveDamageRatio,
      0.6,
    );
    for (let index = 0; index < count; index += 1) {
      this.pendingWaves.push({
        dueAt: this.elapsed + interval * (index + 1),
        index: index + 1,
        x: center.x,
        y: center.y,
        radius,
        damage: damage * ratio,
      });
    }
    this.finaleQueues += 1;
    return true;
  }

  /**
   * 推进 H30 波纹计时，返回到期波纹（按排队顺序）。
   * 只结算已有队列，不会生成新的波纹，因此不会递归。
   */
  stepFinaleWaves(seconds: number): FinaleWave[] {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return [];
    this.elapsed += seconds;
    if (this.pendingWaves.length === 0) return [];

    const due: PendingFinaleWave[] = [];
    const remaining: PendingFinaleWave[] = [];
    for (const wave of this.pendingWaves) {
      if (wave.dueAt <= this.elapsed + 1e-9) due.push(wave);
      else remaining.push(wave);
    }
    this.pendingWaves = remaining;
    this.finaleWavesResolved += due.length;
    return due.map((wave) => ({
      index: wave.index,
      x: wave.x,
      y: wave.y,
      radius: wave.radius,
      damage: wave.damage,
    }));
  }

  /** 波初清空尚未结算的波纹；每局计数保留。 */
  resetForWave(): void {
    this.pendingWaves = [];
    this.elapsed = 0;
  }

  /** 新开一局：连每局触发次数一并归零。 */
  reset(): void {
    this.resetForWave();
    this.finaleQueues = 0;
    this.finaleWavesResolved = 0;
    this.tripleShotTriggers = 0;
  }

  snapshot(): BomberHexSnapshot {
    return {
      hexes: this.ownedIds,
      tripleShot: {
        everyNthShot: Math.max(
          1,
          Math.floor(BOMBER_HEX_PARAMS.H27.tripleShotEveryNth ?? 3),
        ),
        extraShots: Math.max(
          1,
          Math.floor(BOMBER_HEX_PARAMS.H27.tripleShotCount ?? 2),
        ),
        damageRatio:
          positive(BOMBER_HEX_PARAMS.H27.tripleShotDamageRatio, 0.25),
        triggers: this.tripleShotTriggers,
      },
      soulMarch: {
        capacityBonus: this.soulCapacityBonus,
        followSpeed: this.soulFollowSpeed,
        followDistance: this.soulFollowDistance,
      },
      giantCharge: {
        explosionRadiusPercent: this.hasHex('H29')
          ? BOMBER_HEX_PARAMS.H29.explosionRadiusPercent ?? 30
          : 0,
        attackSpeedPercent: this.hasHex('H29')
          ? BOMBER_HEX_PARAMS.H29.attackSpeedPercent ?? 10
          : 0,
      },
      finale: {
        waveCount: Math.max(
          1,
          Math.floor(BOMBER_HEX_PARAMS.H30.finaleWaveCount ?? 3),
        ),
        damageRatio:
          positive(BOMBER_HEX_PARAMS.H30.finaleWaveDamageRatio, 0.6),
        intervalSeconds: positive(
          BOMBER_HEX_PARAMS.H30.finaleWaveIntervalSeconds,
          0.15,
        ),
        queues: this.finaleQueues,
        wavesResolved: this.finaleWavesResolved,
        pendingWaves: this.pendingWaves.length,
      },
    };
  }
}
