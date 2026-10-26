/**
 * V0.2 18 波波次表与成长倍率（`docs/design/v0.2/data/waves.csv`）。
 *
 * - 第 1–17 波普通敌人配额 `12 + 3 × 波数`；
 * - 第 6/9/12/15 波各 1 名精英，生命取固定初值（见 `data/elites.ts`）；
 * - 第 18 波为唯一 Boss 波；
 * - 普通敌人按首次出现波次解锁：团团怪 1、镰足虫 2、喷菇 3、冲锋猪 4、
 *   盾壳蟹 5、灯灵 7、爆爆兽 10、巢母 13；
 * - 普通敌人生命倍率 `(1+0.10×(w−1))×(1+0.02×max(w−8,0))`；
 * - 纯数据，不依赖 Phaser。
 */
import {
  unlockedEnemiesForWave,
  type EnemyId,
} from './enemies';
import { getEliteForWave, type EliteDefinition } from './elites';

export const TOTAL_WAVES = 18;

/** 唯一 Boss 波。 */
export const BOSS_WAVE = TOTAL_WAVES;

/** 第 1–17 波普通敌人配额：12 + 3 × 波数。 */
export const NORMAL_WAVE_COUNTS: readonly number[] = Array.from(
  { length: TOTAL_WAVES - 1 },
  (_, index) => 12 + 3 * (index + 1),
);

export const ELITE_DAMAGE_MULTIPLIER = 1.3;

/** 普通波时长 `30 + 2 × 波数` 秒；精英波额外加 8 秒。 */
export const WAVE_BASE_SECONDS = 30;
export const WAVE_SECONDS_PER_WAVE = 2;
export const ELITE_WAVE_EXTRA_SECONDS = 8;

/** 常规敌人配额必须在本波 65% 时长前全部排入出生提示。 */
export const WAVE_SPAWN_WINDOW_RATIO = 0.65;

export type WaveKind = 'normal' | 'elite' | 'boss';

export interface WaveDefinition {
  readonly wave: number;
  readonly kind: WaveKind;
  /** 普通敌人数量；Boss 波为 0。 */
  readonly enemyCount: number;
  readonly eliteCount: number;
  /** 精英配置；普通波与 Boss 波为 undefined。 */
  readonly elite?: EliteDefinition;
  /** 本波可刷新的普通敌人类型。 */
  readonly roster: readonly EnemyId[];
  /** 普通敌人生命倍率；Boss 波固定为 1。 */
  readonly healthMultiplier: number;
  /** 普通敌人伤害倍率；Boss 波固定为 1。 */
  readonly damageMultiplier: number;
  /** 本波倒计时秒数；Boss 波为 0（没有时间到即过关）。 */
  readonly durationSeconds: number;
  /** 波末是否进入商店；第 1–17 波均进入，第 18 波结算后直接结束。 */
  readonly shopAfter: boolean;
  /** Boss 波的首领 ID。 */
  readonly bossId?: EnemyId;
}

/** 普通敌人生命倍率：`(1+0.10×(波数−1))×(1+0.02×max(波数−8,0))`。 */
export function waveHealthMultiplier(wave: number): number {
  return (1 + 0.1 * (wave - 1)) * (1 + 0.02 * Math.max(wave - 8, 0));
}

/** 普通敌人伤害倍率：1 + 0.06 × (波数 − 1)。 */
export function waveDamageMultiplier(wave: number): number {
  return 1 + 0.06 * (wave - 1);
}

/** 本波倒计时秒数：普通波 `30 + 2 × 波数`，精英波再加 8 秒；Boss 波无时限。 */
export function waveDurationSeconds(wave: number): number {
  if (!Number.isInteger(wave) || wave < 1 || wave > TOTAL_WAVES) {
    throw new Error(`Wave must be an integer in 1..${TOTAL_WAVES}, received ${wave}`);
  }
  if (wave === BOSS_WAVE) return 0;
  const eliteBonus = getEliteForWave(wave) ? ELITE_WAVE_EXTRA_SECONDS : 0;
  return WAVE_BASE_SECONDS + WAVE_SECONDS_PER_WAVE * wave + eliteBonus;
}

/** 常规敌人刷怪窗口：本波时长的 65%。 */
export function waveSpawnWindowSeconds(wave: number): number {
  return waveDurationSeconds(wave) * WAVE_SPAWN_WINDOW_RATIO;
}

/** 第 1–17 波波末进入商店；第 18 波击败 Boss 后直接结算。 */
export function shopAfterWave(wave: number): boolean {
  if (!Number.isInteger(wave) || wave < 1 || wave > TOTAL_WAVES) {
    throw new Error(`Wave must be an integer in 1..${TOTAL_WAVES}, received ${wave}`);
  }
  return wave < BOSS_WAVE;
}

/** 本波可刷新的普通敌人：只包含到本波为止已解锁的种类。 */
export function rosterForWave(wave: number): readonly EnemyId[] {
  return unlockedEnemiesForWave(wave).map((enemy) => enemy.id);
}

function createWave(wave: number): WaveDefinition {
  if (wave === BOSS_WAVE) {
    return {
      wave,
      kind: 'boss',
      enemyCount: 0,
      eliteCount: 0,
      roster: [],
      healthMultiplier: 1,
      damageMultiplier: 1,
      durationSeconds: 0,
      shopAfter: false,
      bossId: 'boss',
    };
  }

  const elite = getEliteForWave(wave);

  return {
    wave,
    kind: elite ? 'elite' : 'normal',
    enemyCount: NORMAL_WAVE_COUNTS[wave - 1] ?? 0,
    eliteCount: elite ? 1 : 0,
    elite,
    roster: rosterForWave(wave),
    healthMultiplier: waveHealthMultiplier(wave),
    damageMultiplier: waveDamageMultiplier(wave),
    durationSeconds: waveDurationSeconds(wave),
    shopAfter: shopAfterWave(wave),
  };
}

export const WAVE_LIST: readonly WaveDefinition[] = Array.from(
  { length: TOTAL_WAVES },
  (_, index) => createWave(index + 1),
);

/** 按波次查询；波次必须是 1–18 的整数。 */
export function getWave(wave: number): WaveDefinition {
  if (!Number.isInteger(wave) || wave < 1 || wave > TOTAL_WAVES) {
    throw new Error(`Wave must be an integer in 1..${TOTAL_WAVES}, received ${wave}`);
  }
  return WAVE_LIST[wave - 1] as WaveDefinition;
}

export function listWaves(): readonly WaveDefinition[] {
  return WAVE_LIST;
}
