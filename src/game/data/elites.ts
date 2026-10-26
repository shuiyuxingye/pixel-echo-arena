/**
 * V0.2 精英波配置（`docs/design/v0.2/01-systems-and-balance.md` §普通怪与最终Boss、
 * `docs/design/v0.2/data/waves.csv`）。
 *
 * - 6/9/12/15 波各 1 名精英，生命初值固定为 600/1000/1600/2400；
 * - 精英沿用对应普通怪的占位行为（冲锋猪/喷菇/盾壳蟹/团团怪），保留技能差异；
 * - 每名精英有唯一 ID，击败该 ID 才绑定对应的核心奖励资格；
 * - 纯数据，不依赖 Phaser。
 */
import type { EnemyId } from './enemies';

export interface EliteDefinition {
  /** 唯一精英 ID；核心奖励只绑定这个 ID。 */
  readonly id: string;
  /** 出现波次。 */
  readonly wave: number;
  /** 基础行为来源；精英沿用其攻击方式。 */
  readonly enemyId: EnemyId;
  /** 固定生命初值，不叠加普通波的生命成长倍率。 */
  readonly maxHealth: number;
  /** 击败该精英后可记资格的核心奖励 ID；每个精英各绑定一个。 */
  readonly coreRewardId: string;
}

export const ELITE_LIST: readonly EliteDefinition[] = [
  {
    id: 'elite-6',
    wave: 6,
    enemyId: 'charger',
    maxHealth: 600,
    coreRewardId: 'core-6',
  },
  {
    id: 'elite-9',
    wave: 9,
    enemyId: 'spitter',
    maxHealth: 1000,
    coreRewardId: 'core-9',
  },
  {
    id: 'elite-12',
    wave: 12,
    enemyId: 'bulwark',
    maxHealth: 1600,
    coreRewardId: 'core-12',
  },
  {
    id: 'elite-15',
    wave: 15,
    enemyId: 'blob',
    maxHealth: 2400,
    coreRewardId: 'core-15',
  },
];

/** 精英波次，按出现顺序排列。 */
export const ELITE_WAVES: readonly number[] = ELITE_LIST.map((elite) => elite.wave);

/** 四档精英生命初值，键为波次。 */
export const ELITE_WAVE_HEALTH: Readonly<Record<number, number>> = Object.fromEntries(
  ELITE_LIST.map((elite) => [elite.wave, elite.maxHealth]),
);

const BY_WAVE: ReadonlyMap<number, EliteDefinition> = new Map(
  ELITE_LIST.map((elite) => [elite.wave, elite]),
);

const BY_ID: ReadonlyMap<string, EliteDefinition> = new Map(
  ELITE_LIST.map((elite) => [elite.id, elite]),
);

/** 按波次取精英配置；普通波与 Boss 波返回 undefined。 */
export function getEliteForWave(wave: number): EliteDefinition | undefined {
  return BY_WAVE.get(wave);
}

/** 按唯一 ID 取精英配置；核心奖励绑定与存档校验共用。 */
export function getEliteById(id: string): EliteDefinition | undefined {
  return BY_ID.get(id);
}

export function isEliteWave(wave: number): boolean {
  return BY_WAVE.has(wave);
}
