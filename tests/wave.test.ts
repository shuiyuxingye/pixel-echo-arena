import { describe, expect, it } from 'vitest';
import {
  ELITE_DAMAGE_MULTIPLIER,
  MAX_ALIVE_ENEMIES,
  WAVE_SPAWN_WINDOW_RATIO,
  getEnemy,
  getWave,
  waveDurationSeconds,
  waveHealthMultiplier,
} from '../src/game/data';
import {
  WaveRewardFlow,
  WaveRunner,
  scaleEliteForWave,
  scaleEnemyForWave,
} from '../src/game/wave';

const STEP = 1 / 60;

/** 以高存活数推进，模拟“敌人一直都在”，只观察刷怪节奏。 */
function spawnRequests(wave: number, seconds = getWave(wave).durationSeconds * WAVE_SPAWN_WINDOW_RATIO) {
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
  it('第 1–17 波普通数量依次为 15/18/21/…/63', () => {
    const expected = Array.from({ length: 17 }, (_, index) => 12 + 3 * (index + 1));
    for (let wave = 1; wave <= 17; wave += 1) {
      const requests = spawnRequests(wave);
      const normals = requests.filter((request) => !request.isElite);
      expect(normals).toHaveLength(expected[wave - 1] ?? 0);
      expect(normals.every((request) => request.isElite === false)).toBe(true);
    }
  });

  it('第 6/9/12/15 波额外 1 个精英，使用各自的固定生命', () => {
    const expectedHealth = [600, 1000, 1600, 2400];
    const waves = [6, 9, 12, 15];
    waves.forEach((wave, index) => {
      const elites = spawnRequests(wave).filter((request) => request.isElite);
      expect(elites).toHaveLength(1);
      expect(elites[0]?.enemy.maxHealth).toBe(expectedHealth[index]);
      expect(elites[0]?.enemy.elite).toBe(true);
      expect(elites[0]?.enemy.eliteId).toBe(`elite-${wave}`);
      expect(elites[0]?.enemy.coreRewardId).toBe(`core-${wave}`);
    });

    for (const wave of [1, 2, 3, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17]) {
      expect(spawnRequests(wave).filter((request) => request.isElite)).toHaveLength(0);
    }
  });

  it('第 1 波只有团团怪，之后按解锁波次逐类加入', () => {
    const ids = (wave: number) =>
      new Set(spawnRequests(wave).filter((request) => !request.isElite).map((r) => r.enemy.id));
    expect(ids(1)).toEqual(new Set(['blob']));
    expect(ids(2)).toEqual(new Set(['blob', 'skitter']));
    expect(ids(3)).toEqual(new Set(['blob', 'skitter', 'spitter']));
    expect(ids(4)).toEqual(
      new Set(['blob', 'skitter', 'spitter', 'charger']),
    );
    expect(ids(5)).toEqual(
      new Set(['blob', 'skitter', 'spitter', 'charger', 'bulwark']),
    );
    expect(ids(6)).toEqual(
      new Set(['blob', 'skitter', 'spitter', 'charger', 'bulwark']),
    );
    expect(ids(7)).toEqual(
      new Set(['blob', 'skitter', 'spitter', 'charger', 'bulwark', 'mender']),
    );
    expect(ids(9)).toEqual(
      new Set(['blob', 'skitter', 'spitter', 'charger', 'bulwark', 'mender']),
    );
    expect(ids(10)).toEqual(
      new Set([
        'blob',
        'skitter',
        'spitter',
        'charger',
        'bulwark',
        'mender',
        'bomber',
      ]),
    );
    expect(ids(13)).toEqual(
      new Set([
        'blob',
        'skitter',
        'spitter',
        'charger',
        'bulwark',
        'mender',
        'bomber',
        'broodmother',
      ]),
    );
    expect(ids(17)).toEqual(
      new Set([
        'blob',
        'skitter',
        'spitter',
        'charger',
        'bulwark',
        'mender',
        'bomber',
        'broodmother',
      ]),
    );
  });

  it('第 1–17 波最后一批常规敌人都在本波 65% 时长前生成', () => {
    for (let wave = 1; wave <= 17; wave += 1) {
      const runner = new WaveRunner(wave);
      const window = waveDurationSeconds(wave) * WAVE_SPAWN_WINDOW_RATIO;
      let lastSpawnAt = 0;
      for (let elapsed = 0; elapsed <= window; elapsed += STEP) {
        const result = runner.step(STEP, { aliveEnemyCount: 99, pendingEnemyCount: 0 });
        if (result.spawned.some((request) => !request.isElite)) {
          lastSpawnAt = runner.elapsedSeconds;
        }
      }
      expect(runner.remainingToSpawn, `wave ${wave}`).toBe(0);
      expect(lastSpawnAt, `wave ${wave}`).toBeLessThanOrEqual(window);
    }
  });
});

describe('波次倍率与精英缩放', () => {
  it('普通敌人生命倍率 (1+0.10×(w−1))×(1+0.02×max(w−8,0))、伤害倍率 1+0.06×(波数−1)', () => {
    const blob = getEnemy('blob');
    const wave5 = scaleEnemyForWave(blob, 5);
    expect(wave5.maxHealth).toBeCloseTo(35 * 1.4, 6);
    expect(wave5.contactDamage).toBeCloseTo(8 * 1.24, 6);
    expect(wave5.elite).toBeUndefined();

    const spitterWave3 = scaleEnemyForWave(getEnemy('spitter'), 3);
    expect(spitterWave3.attack?.damage).toBeCloseTo(10 * 1.12, 6);
  });

  it('生命缩放覆盖 w=1/8/18，且 8 波后追加 2% 每波', () => {
    expect(scaleEnemyForWave(getEnemy('blob'), 1).maxHealth).toBeCloseTo(35, 10);
    expect(scaleEnemyForWave(getEnemy('blob'), 8).maxHealth).toBeCloseTo(
      35 * 1.7,
      10,
    );
    expect(scaleEnemyForWave(getEnemy('blob'), 18).maxHealth).toBeCloseTo(
      35 * 3.24,
      10,
    );
    // 第 9 波起才有额外 2%：w=9 → 1.8×1.02。
    expect(waveHealthMultiplier(9)).toBeCloseTo(1.836, 10);
    expect(waveHealthMultiplier(18)).toBeCloseTo(3.24, 10);
  });

  it('精英与 Boss 使用固定生命，不套用普通怪波次缩放', () => {
    const bossWave18 = scaleEnemyForWave(getEnemy('boss'), 18);
    expect(bossWave18.maxHealth).toBe(12000);
    expect(bossWave18.name).toBe('裂隙炉王');

    const elite15 = getWave(15).elite!;
    expect(scaleEnemyForWave(scaleEliteForWave(elite15, 15), 18).maxHealth).toBe(
      2400,
    );
    expect(elite15.maxHealth).toBe(2400);
  });

  it('精英使用固定生命初值，伤害随波次乘精英倍率', () => {
    const elite6 = getWave(6).elite!;
    const elite = scaleEliteForWave(elite6, 6);
    expect(elite.elite).toBe(true);
    expect(elite.eliteId).toBe('elite-6');
    expect(elite.coreRewardId).toBe('core-6');
    expect(elite.maxHealth).toBe(600);
    expect(elite.attack?.damage).toBeCloseTo(
      18 * (1 + 0.06 * 5) * ELITE_DAMAGE_MULTIPLIER,
      6,
    );

    const elite15 = scaleEliteForWave(getWave(15).elite!, 15);
    expect(elite15.maxHealth).toBe(2400);
    expect(elite15.eliteWave).toBe(15);
  });

  it('精英标记只在精英缩放时出现', () => {
    expect(scaleEnemyForWave(getEnemy('blob'), 4).elite).toBeUndefined();
    expect(scaleEliteForWave(getWave(9).elite!, 9).elite).toBe(true);
  });
});

describe('同屏敌人上限', () => {
  it('存活与待落地合计达到 100 时暂停生成，名额空出后继续', () => {
    const runner = new WaveRunner(17);
    const full = runner.step(runner.spawnWindowSeconds, {
      aliveEnemyCount: MAX_ALIVE_ENEMIES,
      pendingEnemyCount: 0,
    });
    expect(MAX_ALIVE_ENEMIES).toBe(100);
    expect(full.spawned).toHaveLength(0);
    expect(runner.remainingToSpawn).toBe(getWave(17).enemyCount);

    const pendingFull = runner.step(STEP, {
      aliveEnemyCount: MAX_ALIVE_ENEMIES - 1,
      pendingEnemyCount: 1,
    });
    expect(pendingFull.spawned).toHaveLength(0);

    const released = runner.step(STEP, {
      aliveEnemyCount: MAX_ALIVE_ENEMIES - 1,
      pendingEnemyCount: 0,
    });
    expect(released.spawned).toHaveLength(1);
    expect(released.spawned[0]?.spawnIndex).toBe(0);
    expect(runner.remainingToSpawn).toBe(getWave(17).enemyCount - 1);
  });

  it('只补到剩余名额，不替换存活敌人', () => {
    const runner = new WaveRunner(1);
    const result = runner.step(runner.spawnWindowSeconds, {
      aliveEnemyCount: MAX_ALIVE_ENEMIES - 2,
      pendingEnemyCount: 0,
    });
    expect(result.spawned).toHaveLength(2);
    expect(result.spawned.map((request) => request.spawnIndex)).toEqual([0, 1]);
    expect(result.spawned.every((request) => !request.isElite)).toBe(true);
    expect(runner.remainingToSpawn).toBe(getWave(1).enemyCount - 2);
  });

  it('精英也受上限约束，释放名额后优先补上', () => {
    const runner = new WaveRunner(6);
    const full = runner.step(runner.spawnWindowSeconds, {
      aliveEnemyCount: MAX_ALIVE_ENEMIES,
      pendingEnemyCount: 0,
    });
    expect(full.spawned).toHaveLength(0);
    expect(runner.eliteSpawnedCount).toBe(0);

    const released = runner.step(STEP, {
      aliveEnemyCount: MAX_ALIVE_ENEMIES - 1,
      pendingEnemyCount: 0,
    });
    expect(released.spawned).toHaveLength(1);
    expect(released.spawned[0]?.isElite).toBe(true);
    expect(runner.eliteSpawnedCount).toBe(1);
    expect(runner.remainingToSpawn).toBe(getWave(6).enemyCount);
  });
});

describe('波次清空判定', () => {
  it('全部刷完、落地并清空后才判清空', () => {
    const runner = new WaveRunner(1);

    // 第一步刷出第一个敌人，但出生提示仍算未落地。
    const first = runner.step(STEP, { aliveEnemyCount: 0, pendingEnemyCount: 0 });
    expect(first.spawned).toHaveLength(1);
    expect(first.cleared).toBe(false);

    // 推进到 65% 刷怪窗口：所有敌人已排入刷怪，但本步新增的出生提示仍未落地。
    const rest = runner.step(runner.spawnWindowSeconds, {
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
    runner.step(runner.spawnWindowSeconds, { aliveEnemyCount: 1, pendingEnemyCount: 0 });
    expect(
      runner.step(STEP, { aliveEnemyCount: 1, pendingEnemyCount: 0 }).cleared,
    ).toBe(false);
    expect(
      runner.step(STEP, { aliveEnemyCount: 0, pendingEnemyCount: 2 }).cleared,
    ).toBe(false);
  });

  it('首批敌人被打完不会跳过尚未生成的配额', () => {
    const runner = new WaveRunner(5);
    // 第一步只生成 1 个；即使场上清空，也必须等剩余配额全部排入并落地。
    const first = runner.step(STEP, { aliveEnemyCount: 0, pendingEnemyCount: 0 });
    expect(first.spawned).toHaveLength(1);
    const second = runner.step(STEP, { aliveEnemyCount: 0, pendingEnemyCount: 0 });
    expect(second.cleared).toBe(false);
    expect(runner.remainingToSpawn).toBeGreaterThan(0);

    // 只推进一半刷怪窗口，仍有未生成配额，不能因场上无敌人而提前过关。
    const halfWindow = runner.spawnWindowSeconds / 2;
    runner.step(halfWindow, { aliveEnemyCount: 0, pendingEnemyCount: 0 });
    expect(runner.remainingToSpawn).toBeGreaterThan(0);
    expect(runner.cleared).toBe(false);
  });

  it('倒计时归零即过关，即使场上仍有存活敌人', () => {
    const runner = new WaveRunner(3);
    expect(runner.hasTimeLimit).toBe(true);
    expect(runner.durationSeconds).toBe(36);
    expect(runner.remainingSeconds).toBe(36);
    expect(runner.spawnWindowSeconds).toBeCloseTo(36 * WAVE_SPAWN_WINDOW_RATIO, 10);

    // 刷出一部分敌人并保持存活。
    runner.step(runner.spawnWindowSeconds, { aliveEnemyCount: 5, pendingEnemyCount: 0 });
    expect(runner.cleared).toBe(false);

    // 倒计时未到零：仍不过关。
    const beforeTimeout = runner.step(
      runner.durationSeconds - runner.elapsedSeconds - 1,
      { aliveEnemyCount: 5, pendingEnemyCount: 0 },
    );
    expect(beforeTimeout.cleared).toBe(false);
    expect(beforeTimeout.timedOut).toBe(false);
    expect(runner.remainingSeconds).toBeCloseTo(1, 6);

    // 归零：过关并标记超时，供场景清理残余敌人且不发放击杀奖励。
    const timedOut = runner.step(1, { aliveEnemyCount: 5, pendingEnemyCount: 0 });
    expect(timedOut.cleared).toBe(true);
    expect(timedOut.timedOut).toBe(true);
    expect(runner.timedOut).toBe(true);
    expect(runner.remainingSeconds).toBe(0);
  });

  it('提前清场与超时过关互斥，超时只报告一次', () => {
    const cleared = new WaveRunner(1);
    cleared.step(cleared.spawnWindowSeconds, {
      aliveEnemyCount: 0,
      pendingEnemyCount: 0,
    });
    const early = cleared.step(STEP, { aliveEnemyCount: 0, pendingEnemyCount: 0 });
    expect(early.cleared).toBe(true);
    expect(early.timedOut).toBe(false);
    // 清场后再推进到本波结束也不会补报超时。
    expect(cleared.step(60, { aliveEnemyCount: 0, pendingEnemyCount: 0 }).timedOut).toBe(
      false,
    );
  });

  it('第 18 波只生成一个基础数值 Boss，且不按小怪清空自动结束', () => {
    const runner = new WaveRunner(18);
    const result = runner.step(1, { aliveEnemyCount: 0, pendingEnemyCount: 0 });
    const bosses = result.spawned.filter((request) => request.isBoss);
    expect(result.spawned).toHaveLength(1);
    expect(bosses).toHaveLength(1);
    expect(bosses[0]?.enemy.id).toBe('boss');
    // Boss 不叠加第 18 波的生命/伤害倍率。
    expect(bosses[0]?.enemy.maxHealth).toBe(12000);
    expect(bosses[0]?.enemy.name).toBe('裂隙炉王');
    expect(bosses[0]?.enemy.armor).toBe(20);
    expect(bosses[0]?.enemy.magicResist).toBeCloseTo(0.15, 10);
    expect(runner.remainingToSpawn).toBe(0);
    expect(result.cleared).toBe(false);
    expect(result.timedOut).toBe(false);

    // 后续步进不会复制新的 Boss。
    const rest = runner.step(30, { aliveEnemyCount: 1, pendingEnemyCount: 0 });
    expect(rest.spawned).toHaveLength(0);
    expect(rest.cleared).toBe(false);
  });

  it('Boss 波没有超时跳过：长时间步进仍不清空，必须击败 Boss', () => {
    const runner = new WaveRunner(18);
    expect(runner.hasTimeLimit).toBe(false);
    expect(runner.durationSeconds).toBe(0);
    runner.step(1, { aliveEnemyCount: 0, pendingEnemyCount: 0 });
    // 模拟 Boss 一直存活 10 分钟。
    for (let index = 0; index < 20; index += 1) {
      const result = runner.step(30, { aliveEnemyCount: 1, pendingEnemyCount: 0 });
      expect(result.spawned).toHaveLength(0);
      expect(result.cleared).toBe(false);
      expect(result.timedOut).toBe(false);
    }
    expect(runner.cleared).toBe(false);
    expect(runner.timedOut).toBe(false);
    expect(runner.remainingToSpawn).toBe(0);
  });
});

describe('波末奖励顺序', () => {
  it('吸取经验 → 简报 → 宝箱 → 核心 → 升级逐个选择 → 机制 → 波间', () => {
    const flow = new WaveRewardFlow(3);
    expect(flow.stage).toBe('none');

    expect(flow.begin(2)).toBe('absorb');
    expect(flow.stage).toBe('absorb');
    expect(
      flow.completeAbsorb(2, { chestIds: ['w3-1'], coreIds: ['core-6'] }),
    ).toBe('briefing');
    // 宝箱 + 核心 + 2 次升级 + 第 3 波机制。
    expect(flow.remainingRewards).toBe(5);
    expect(flow.pendingLevelUps).toBe(2);

    expect(flow.completeBriefing()).toBe('chest');
    expect(flow.completeChest()).toBe('core');
    expect(flow.resolveCurrent('claimed')).toBe('upgrade');
    expect(flow.pendingLevelUps).toBe(2);

    expect(flow.completeUpgrade()).toBe('upgrade');
    expect(flow.pendingLevelUps).toBe(1);
    expect(flow.completeUpgrade()).toBe('mechanic');
    expect(flow.pendingLevelUps).toBe(0);

    expect(flow.completeMechanic()).toBe('intermission');
    expect(flow.remainingRewards).toBe(0);
    expect(flow.completeIntermission()).toBe('none');
    expect(flow.isActive).toBe(false);
  });

  it('放弃核心不会重新出现，也不会补发其它奖励', () => {
    const flow = new WaveRewardFlow(4);
    flow.begin(0);
    expect(flow.completeAbsorb(0, { coreIds: ['core-9'] })).toBe('briefing');
    expect(flow.completeBriefing()).toBe('core');
    expect(flow.resolveCurrent('abandoned')).toBe('intermission');
    expect(flow.remainingRewards).toBe(0);
    expect(flow.currentReward).toBeNull();
  });

  it('非 3/6 波没有机制阶段，直接进入波间补给', () => {
    const flow = new WaveRewardFlow(4);
    flow.begin(0);
    expect(flow.completeAbsorb(0)).toBe('briefing');
    expect(flow.completeBriefing()).toBe('intermission');
    expect(flow.completeMechanic()).toBe('intermission');
    expect(flow.completeIntermission()).toBe('none');
  });

  it('波末自动吸取新增的升级也进入同一队列', () => {
    const flow = new WaveRewardFlow(7);
    flow.begin(0);
    // 吸取阶段结算后才发现有 1 次升级。
    expect(flow.completeAbsorb(1)).toBe('briefing');
    expect(flow.completeBriefing()).toBe('upgrade');
    expect(flow.completeUpgrade()).toBe('intermission');
  });

  it('多份升级资格按队列逐个处理，重进也不会跳过', () => {
    const flow = new WaveRewardFlow(7);
    flow.begin(0);
    flow.completeAbsorb(3);
    expect(flow.completeBriefing()).toBe('upgrade');
    expect(flow.remainingRewards).toBe(3);
    expect(flow.completeUpgrade()).toBe('upgrade');
    expect(flow.remainingRewards).toBe(2);
    expect(flow.completeUpgrade()).toBe('upgrade');
    expect(flow.completeUpgrade()).toBe('intermission');
  });

  it('奖励队列可恢复：已领取状态保留，未领取继续处理', () => {
    const flow = new WaveRewardFlow(6);
    flow.begin(0);
    flow.completeAbsorb(1, { coreIds: ['core-6'] });
    expect(flow.completeBriefing()).toBe('core');
    expect(flow.resolveCurrent('claimed')).toBe('upgrade');

    const snapshot = flow.rewardQueueSnapshot;
    // 第 6 波还有机制资格：核心已领取，升级与机制仍待处理。
    expect(snapshot.map((entry) => entry.status)).toEqual([
      'claimed',
      'pending',
      'pending',
    ]);

    const restored = new WaveRewardFlow(6);
    expect(restored.restore('upgrade', 1, snapshot)).toBe('upgrade');
    expect(restored.remainingRewards).toBe(2);
    expect(restored.currentReward?.kind).toBe('upgrade');
    expect(restored.completeUpgrade()).toBe('mechanic');
    expect(restored.completeMechanic()).toBe('intermission');
  });

  it('第 6 波也有机制选择，且非法波次被拒绝', () => {
    expect(new WaveRewardFlow(6).needsMechanicChoice).toBe(true);
    expect(getWave(6).elite?.id).toBe('elite-6');
    expect(() => new WaveRewardFlow(0)).toThrow();
    expect(() => new WaveRewardFlow(19)).toThrow();
  });
});
