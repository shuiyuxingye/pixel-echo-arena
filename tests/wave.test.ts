import { describe, expect, it } from 'vitest';
import {
  ELITE_DAMAGE_MULTIPLIER,
  ELITE_HEALTH_MULTIPLIER,
  getEnemy,
  getWave,
} from '../src/game/data';
import {
  WAVE_SPAWN_WINDOW_SECONDS,
  WaveRewardFlow,
  WaveRunner,
  scaleEnemyForWave,
} from '../src/game/wave';

const STEP = 1 / 60;

/** 以高存活数推进，模拟“敌人一直都在”，只观察刷怪节奏。 */
function spawnRequests(wave: number, seconds = WAVE_SPAWN_WINDOW_SECONDS) {
  const runner = new WaveRunner(wave);
  const requests = [];
  const steps = Math.ceil(seconds / STEP);
  for (let index = 0; index < steps; index += 1) {
    const result = runner.step(STEP, { aliveEnemyCount: 99, pendingEnemyCount: 0 });
    requests.push(...result.spawned);
    expect(result.cleared).toBe(false);
  }
  return requests;
}

describe('波次刷怪数量与类型', () => {
  it('第 1–8 波普通数量依次为 12/16/18/22/26/28/32/36', () => {
    const expected = [12, 16, 18, 22, 26, 28, 32, 36];
    for (let wave = 1; wave <= 8; wave += 1) {
      const requests = spawnRequests(wave);
      const normals = requests.filter((request) => !request.isElite);
      expect(normals).toHaveLength(expected[wave - 1] ?? 0);
      expect(normals.every((request) => request.isElite === false)).toBe(true);
    }
  });

  it('第 3/6 波额外 1 个精英：第 3 波精英冲锋者、第 6 波精英重装者', () => {
    const wave3 = spawnRequests(3);
    const wave6 = spawnRequests(6);
    const elite3 = wave3.filter((request) => request.isElite);
    const elite6 = wave6.filter((request) => request.isElite);

    expect(elite3).toHaveLength(1);
    expect(elite3[0]?.enemy.id).toBe('charger');
    expect(elite6).toHaveLength(1);
    expect(elite6[0]?.enemy.id).toBe('heavy');

    for (const wave of [1, 2, 4, 5, 7, 8]) {
      expect(spawnRequests(wave).filter((request) => request.isElite)).toHaveLength(0);
    }
  });

  it('第 1/2 波只有追击者与射手，第 4/5 波加入冲锋者与重装者', () => {
    const ids = (wave: number) =>
      new Set(spawnRequests(wave).filter((request) => !request.isElite).map((r) => r.enemy.id));
    expect(ids(1)).toEqual(new Set(['chaser', 'shooter']));
    expect(ids(2)).toEqual(new Set(['chaser', 'shooter']));
    expect(ids(3)).toEqual(new Set(['chaser', 'shooter']));
    expect(ids(4)).toEqual(new Set(['chaser', 'shooter', 'charger', 'heavy']));
    expect(ids(5)).toEqual(new Set(['chaser', 'shooter', 'charger', 'heavy']));
    expect(ids(6)).toEqual(new Set(['chaser', 'shooter', 'charger', 'heavy']));
    expect(ids(7)).toEqual(new Set(['chaser', 'shooter', 'charger', 'heavy']));
    expect(ids(8)).toEqual(new Set(['chaser', 'shooter', 'charger', 'heavy']));
  });

  it('前 30 秒内完成定额刷怪', () => {
    const runner = new WaveRunner(8);
    let lastSpawnAt = 0;
    for (let elapsed = 0; elapsed <= WAVE_SPAWN_WINDOW_SECONDS; elapsed += STEP) {
      const result = runner.step(STEP, { aliveEnemyCount: 99, pendingEnemyCount: 0 });
      if (result.spawned.length > 0) lastSpawnAt = runner.elapsedSeconds;
    }
    expect(runner.remainingToSpawn).toBe(0);
    expect(lastSpawnAt).toBeLessThanOrEqual(WAVE_SPAWN_WINDOW_SECONDS);
  });
});

describe('波次倍率与精英缩放', () => {
  it('生命倍率 1+0.12×(波数−1)、伤害倍率 1+0.06×(波数−1)', () => {
    const chaser = getEnemy('chaser');
    const wave5 = scaleEnemyForWave(chaser, 5);
    expect(wave5.maxHealth).toBeCloseTo(60 * 1.48, 6);
    expect(wave5.contactDamage).toBeCloseTo(8 * 1.24, 6);

    const shooterWave3 = scaleEnemyForWave(getEnemy('shooter'), 3);
    expect(shooterWave3.attack?.damage).toBeCloseTo(10 * 1.12, 6);
  });

  it('精英生命 ×3、伤害 ×1.3，并与波次倍率叠乘', () => {
    const charger = getEnemy('charger');
    const elite = scaleEnemyForWave(charger, 3, true);
    expect(elite.elite).toBe(true);
    expect(elite.maxHealth).toBeCloseTo(
      80 * (1 + 0.12 * 2) * ELITE_HEALTH_MULTIPLIER,
      6,
    );
    expect(elite.attack?.damage).toBeCloseTo(
      18 * (1 + 0.06 * 2) * ELITE_DAMAGE_MULTIPLIER,
      6,
    );

    const heavy = scaleEnemyForWave(getEnemy('heavy'), 6, true);
    expect(heavy.maxHealth).toBeCloseTo(160 * 1.6 * 3, 6);
    expect(heavy.contactDamage).toBeCloseTo(14 * 1.3 * 1.3, 6);
  });

  it('精英标记只有在精英缩放时出现', () => {
    expect(scaleEnemyForWave(getEnemy('chaser'), 4, false).elite).toBeUndefined();
    expect(scaleEnemyForWave(getEnemy('chaser'), 4, true).elite).toBe(true);
  });
});

describe('波次清空判定', () => {
  it('全部刷完、落地并清空后才判清空', () => {
    const runner = new WaveRunner(1);

    // 第一步刷出第一个敌人，但出生提示仍算未落地。
    const first = runner.step(STEP, { aliveEnemyCount: 0, pendingEnemyCount: 0 });
    expect(first.spawned).toHaveLength(1);
    expect(first.cleared).toBe(false);

    // 推进到 30 秒：所有敌人已排入刷怪，但本步新增的出生提示仍未落地。
    const rest = runner.step(WAVE_SPAWN_WINDOW_SECONDS, {
      aliveEnemyCount: 0,
      pendingEnemyCount: 0,
    });
    expect(runner.remainingToSpawn).toBe(0);
    expect(rest.cleared).toBe(false);

    // 出生提示全部处理完且场上无存活敌人，才进入波间。
    const final = runner.step(STEP, { aliveEnemyCount: 0, pendingEnemyCount: 0 });
    expect(final.cleared).toBe(true);
  });

  it('还有存活敌人或出生提示时不判清空', () => {
    const runner = new WaveRunner(1);
    runner.step(WAVE_SPAWN_WINDOW_SECONDS, { aliveEnemyCount: 1, pendingEnemyCount: 0 });
    expect(
      runner.step(STEP, { aliveEnemyCount: 1, pendingEnemyCount: 0 }).cleared,
    ).toBe(false);
    expect(
      runner.step(STEP, { aliveEnemyCount: 0, pendingEnemyCount: 2 }).cleared,
    ).toBe(false);
  });

  it('第 9 波只生成一个基础数值 Boss，且不按小怪清空自动结束', () => {
    const runner = new WaveRunner(9);
    const result = runner.step(1, { aliveEnemyCount: 0, pendingEnemyCount: 0 });
    const bosses = result.spawned.filter((request) => request.isBoss);
    expect(result.spawned).toHaveLength(1);
    expect(bosses).toHaveLength(1);
    expect(bosses[0]?.enemy.id).toBe('boss');
    // Boss 不叠加第 9 波的生命/伤害倍率。
    expect(bosses[0]?.enemy.maxHealth).toBe(2600);
    expect(bosses[0]?.enemy.armor).toBe(20);
    expect(bosses[0]?.enemy.magicResist).toBeCloseTo(0.15, 10);
    expect(runner.remainingToSpawn).toBe(0);
    expect(result.cleared).toBe(false);

    // 后续步进不会复制新的 Boss。
    const rest = runner.step(30, { aliveEnemyCount: 1, pendingEnemyCount: 0 });
    expect(rest.spawned).toHaveLength(0);
    expect(rest.cleared).toBe(false);
  });
});

describe('波末奖励顺序', () => {
  it('吸取经验 → 升级逐个选择 → 机制 → 波间补给', () => {
    const flow = new WaveRewardFlow(3);
    expect(flow.stage).toBe('none');

    expect(flow.begin(2)).toBe('absorb');
    expect(flow.stage).toBe('absorb');
    expect(flow.completeAbsorb(2)).toBe('upgrade');
    expect(flow.pendingLevelUps).toBe(2);

    expect(flow.completeUpgrade()).toBe('upgrade');
    expect(flow.pendingLevelUps).toBe(1);
    expect(flow.completeUpgrade()).toBe('mechanic');
    expect(flow.pendingLevelUps).toBe(0);

    expect(flow.completeMechanic()).toBe('intermission');
    expect(flow.completeIntermission()).toBe('none');
    expect(flow.isActive).toBe(false);
  });

  it('非 3/6 波没有机制阶段，直接进入波间补给', () => {
    const flow = new WaveRewardFlow(4);
    flow.begin(0);
    expect(flow.completeAbsorb(0)).toBe('intermission');
    expect(flow.completeMechanic()).toBe('intermission');
    expect(flow.completeIntermission()).toBe('none');
  });

  it('波末自动吸取新增的升级也进入同一队列', () => {
    const flow = new WaveRewardFlow(7);
    flow.begin(0);
    // 吸取阶段结算后才发现有 1 次升级。
    expect(flow.completeAbsorb(1)).toBe('upgrade');
    expect(flow.completeUpgrade()).toBe('intermission');
  });

  it('第 6 波也有机制选择，且非法波次被拒绝', () => {
    expect(new WaveRewardFlow(6).needsMechanicChoice).toBe(true);
    expect(getWave(6).eliteEnemyId).toBe('heavy');
    expect(() => new WaveRewardFlow(0)).toThrow();
    expect(() => new WaveRewardFlow(10)).toThrow();
  });
});
