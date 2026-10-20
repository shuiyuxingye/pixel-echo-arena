/**
 * 9 波敌人节奏与成长倍率的集中配置（docs/game-design.md §7）。
 * 纯数据，不依赖 Phaser。
 */
import type { EnemyId } from './enemies';

export const TOTAL_WAVES = 9;

/** 第 1–8 波普通敌人数。 */
export const NORMAL_WAVE_COUNTS: readonly number[] = [12, 16, 18, 22, 26, 28, 32, 36];

/** 第 3、6 波各额外 1 个精英。 */
export const ELITE_WAVES: readonly number[] = [3, 6];

export const ELITE_HEALTH_MULTIPLIER = 3;
export const ELITE_DAMAGE_MULTIPLIER = 1.3;

export type WaveKind = 'normal' | 'boss';

export interface WaveDefinition {
  readonly wave: number;
  readonly kind: WaveKind;
  /** 普通敌人数量；Boss 波为 0。 */
  readonly enemyCount: number;
  readonly eliteCount: number;
  /** 精英敌人的类型；无精英时为 undefined。 */
  readonly eliteEnemyId?: EnemyId;
  /** 本波可刷新的普通敌人类型。 */
  readonly roster: readonly EnemyId[];
  /** 普通敌人生命倍率；Boss 波固定为 1。 */
  readonly healthMultiplier: number;
  /** 普通敌人伤害倍率；Boss 波固定为 1。 */
  readonly damageMultiplier: number;
  /** Boss 波的首领 ID。 */
  readonly bossId?: EnemyId;
}

/** 普通敌人生命倍率：1 + 0.12 × (波数 − 1)。 */
export function waveHealthMultiplier(wave: number): number {
  return 1 + 0.12 * (wave - 1);
}

/** 普通敌人伤害倍率：1 + 0.06 × (波数 − 1)。 */
export function waveDamageMultiplier(wave: number): number {
  return 1 + 0.06 * (wave - 1);
}

const EARLY_ROSTER: readonly EnemyId[] = ['chaser', 'shooter'];
const MID_ROSTER: readonly EnemyId[] = ['chaser', 'shooter', 'charger', 'heavy'];

function createWave(wave: number): WaveDefinition {
  if (wave === TOTAL_WAVES) {
    return {
      wave,
      kind: 'boss',
      enemyCount: 0,
      eliteCount: 0,
      roster: [],
      healthMultiplier: 1,
      damageMultiplier: 1,
      bossId: 'boss',
    };
  }

  const eliteCount = ELITE_WAVES.includes(wave) ? 1 : 0;
  const eliteEnemyId = wave === 3 ? 'charger' : wave === 6 ? 'heavy' : undefined;
  const roster = wave <= 3 ? EARLY_ROSTER : MID_ROSTER;

  return {
    wave,
    kind: 'normal',
    enemyCount: NORMAL_WAVE_COUNTS[wave - 1] ?? 0,
    eliteCount,
    eliteEnemyId,
    roster,
    healthMultiplier: waveHealthMultiplier(wave),
    damageMultiplier: waveDamageMultiplier(wave),
  };
}

export const WAVE_LIST: readonly WaveDefinition[] = Array.from(
  { length: TOTAL_WAVES },
  (_, index) => createWave(index + 1),
);

/** 按波次查询；波次必须是 1–9 的整数。 */
export function getWave(wave: number): WaveDefinition {
  if (!Number.isInteger(wave) || wave < 1 || wave > TOTAL_WAVES) {
    throw new Error(`Wave must be an integer in 1..${TOTAL_WAVES}, received ${wave}`);
  }
  return WAVE_LIST[wave - 1] as WaveDefinition;
}

export function listWaves(): readonly WaveDefinition[] {
  return WAVE_LIST;
}
