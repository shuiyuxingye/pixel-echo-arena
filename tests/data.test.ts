import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHARACTER_LIST,
  ENEMY_LIST,
  MAX_ALIVE_ENEMIES,
  NORMAL_ENEMY_LIST,
  TOTAL_WAVES,
  UPGRADE_LIST,
  WAVE_LIST,
  getCharacter,
  getEnemy,
  getUpgrade,
  getWave,
  listUpgrades,
  listUpgradesForCharacter,
  listWaves,
  remainingEnemyCapacity,
  shopAfterWave,
  waveDamageMultiplier,
  waveDurationSeconds,
  waveHealthMultiplier,
  waveSpawnWindowSeconds,
} from '../src/game/data';

const ROOT = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

describe('logic / render separation', () => {
  it('keeps logic and data modules free of Phaser imports', () => {
    const logicFiles = [
      'src/game/config.ts',
      'src/game/arena.ts',
      'src/game/loop.ts',
      'src/game/combat.ts',
      'src/game/chest.ts',
      'src/game/chest-offer.ts',
      'src/game/item-requirements.ts',
      'src/game/shop-offer.ts',
      'src/game/shop-demo.ts',
      'src/game/shop-transaction.ts',
      'src/game/shop-transaction-demo.ts',
      'src/game/item-inventory.ts',
      'src/game/item-effects.ts',
      'src/game/core-offer.ts',
      'src/game/core-inventory.ts',
      'src/game/core-effects.ts',
      'src/game/skill-echo-demo.ts',
      'src/game/damage-events.ts',
      'src/game/trigger-gates.ts',
      'src/game/trigger-demo.ts',
      'src/game/stats.ts',
      'src/game/amiya.ts',
      'src/game/saria.ts',
      'src/game/muelsyse.ts',
      'src/game/grenade.ts',
      'src/game/enemy.ts',
      'src/game/soul.ts',
      'src/game/burst.ts',
      'src/game/progression.ts',
      'src/game/economy.ts',
      'src/game/rewards.ts',
      'src/game/random.ts',
      'src/game/upgrade.ts',
      'src/game/upgrade-effects.ts',
      'src/game/wave.ts',
      'src/game/elite.ts',
      'src/game/data/index.ts',
      'src/game/data/catalog.ts',
      'src/game/data/characters.ts',
      'src/game/data/elites.ts',
      'src/game/data/enemies.ts',
      'src/game/data/waves.ts',
      'src/game/data/upgrades.ts',
    ];

    for (const file of logicFiles) {
      const source = readSource(file);
      expect(source, file).not.toMatch(/from\s+['"]phaser['"]/);
      expect(source, file).not.toMatch(/Phaser\./);
    }
  });
});

describe('character data', () => {
  it('defines exactly four unique characters with full skill sets', () => {
    expect(CHARACTER_LIST).toHaveLength(4);
    expect(new Set(CHARACTER_LIST.map((character) => character.id)).size).toBe(4);

    for (const character of CHARACTER_LIST) {
      expect(getCharacter(character.id)).toBe(character);
      expect(character.maxHealth).toBeGreaterThan(0);
      expect(character.radius).toBe(12);
      expect(character.attack.key).toBe('J');
      expect(character.attack.intervalSeconds).toBeGreaterThan(0);
      expect(character.skillK.key).toBe('K');
      expect(character.skillL.key).toBe('L');
      expect(character.skillK.cooldownSeconds).toBeGreaterThan(0);
      expect(character.skillL.cooldownSeconds).toBeGreaterThan(0);
      expect(character.passive.name.length).toBeGreaterThan(0);
    }
  });

  it('matches the approved Vishdal baseline', () => {
    const vishdal = getCharacter('vishdal');
    expect(vishdal).toMatchObject({
      name: '爆破手',
      maxHealth: 120,
      armor: 10,
      magicResist: 0,
      moveSpeed: 160,
    });
    expect(vishdal.attack).toMatchObject({
      intervalSeconds: 0.9,
      range: 290,
      damage: 36,
      damageType: 'physical',
      splashRadius: 32,
      aftershock: { delaySeconds: 0.35, damage: 18, radius: 32 },
    });
    expect(vishdal.skillK).toMatchObject({ cooldownSeconds: 14, durationSeconds: 12 });
    expect(vishdal.skillK.params).toMatchObject({ maxSummons: 1, tickSeconds: 1.5 });
    expect(vishdal.skillL).toMatchObject({ cooldownSeconds: 30 });
    expect(vishdal.skillL.params).toMatchObject({ shots: 6, ammoExpirySeconds: 20 });
    expect(vishdal.passive.afterimage).toMatchObject({
      damage: 24,
      damageType: 'physical',
      radius: 42,
      stunSeconds: 0.3,
    });
  });

  it('matches the approved Amiya baseline', () => {
    const amiya = getCharacter('amiya');
    expect(amiya).toMatchObject({
      maxHealth: 110,
      armor: 0,
      magicResist: 0.15,
      moveSpeed: 175,
    });
    expect(amiya.attack).toMatchObject({
      intervalSeconds: 0.4,
      range: 260,
      damage: 20,
      damageType: 'magic',
    });
    expect(amiya.skillK).toMatchObject({ cooldownSeconds: 9, durationSeconds: 0.8 });
    expect(amiya.skillK.params).toMatchObject({ shots: 6, damagePerShot: 14 });
    expect(amiya.skillL).toMatchObject({ cooldownSeconds: 30, durationSeconds: 8 });
    expect(amiya.skillL.params).toMatchObject({ damageBonus: 0.6, weaknessSeconds: 3 });
  });

  it('matches the approved Saria baseline', () => {
    const saria = getCharacter('saria');
    expect(saria).toMatchObject({
      maxHealth: 200,
      armor: 35,
      magicResist: 0.1,
      moveSpeed: 150,
    });
    expect(saria.attack).toMatchObject({
      intervalSeconds: 0.55,
      range: 82,
      damage: 26,
      arcDegrees: 110,
      knockback: 12,
    });
    expect(saria.skillK).toMatchObject({ cooldownSeconds: 10 });
    expect(saria.skillK.params).toMatchObject({ heal: 40, shield: 25, shieldDurationSeconds: 4 });
    expect(saria.skillL).toMatchObject({ cooldownSeconds: 28, durationSeconds: 8 });
    expect(saria.skillL.params).toMatchObject({
      fieldRadius: 120,
      healPerSecond: 8,
      enemySlowPercent: 0.35,
      enemyMagicVulnerability: 0.3,
    });
  });

  it('matches the approved Muelsyse baseline', () => {
    const muelsyse = getCharacter('muelsyse');
    expect(muelsyse).toMatchObject({
      maxHealth: 125,
      armor: 5,
      magicResist: 0.1,
      moveSpeed: 175,
    });
    expect(muelsyse.attack).toMatchObject({
      intervalSeconds: 0.55,
      range: 250,
      damage: 18,
      damageType: 'magic',
    });
    expect(muelsyse.skillK).toMatchObject({ cooldownSeconds: 6 });
    expect(muelsyse.skillK.params).toMatchObject({
      meleeHealth: 90,
      rangedHealth: 60,
      meleeMaxStacks: 5,
      rangedCopyEveryAttacks: 8,
    });
    expect(muelsyse.skillL).toMatchObject({ cooldownSeconds: 24, durationSeconds: 6 });
  });

  it('throws on an unknown character id', () => {
    expect(() => getCharacter('unknown')).toThrow(/Unknown character id/);
  });
});

describe('enemy data', () => {
  it('defines eight normal enemies, one larva summon and one boss', () => {
    expect(NORMAL_ENEMY_LIST).toHaveLength(8);
    // 八种普通怪 + 巢母召唤的幼虫 + Boss。
    expect(ENEMY_LIST).toHaveLength(10);
    expect(getEnemy('boss').id).toBe('boss');
    // 幼虫不参与波次名册，不能作为普通波次刷新项出现。
    expect(NORMAL_ENEMY_LIST.map((enemy) => enemy.id)).not.toContain('larva');
    expect(getEnemy('larva').unlockWave).toBeUndefined();
  });

  it('matches the approved normal enemy health and unlock waves', () => {
    const expected = [
      ['blob', '团团怪', 35, 1],
      ['skitter', '镰足虫', 28, 2],
      ['spitter', '喷菇', 42, 3],
      ['charger', '冲锋猪', 85, 4],
      ['bulwark', '盾壳蟹', 120, 5],
      ['mender', '灯灵', 65, 7],
      ['bomber', '爆爆兽', 45, 10],
      ['broodmother', '巢母', 110, 13],
    ] as const;

    expect(NORMAL_ENEMY_LIST.map((enemy) => enemy.id)).toEqual(
      expected.map(([id]) => id),
    );
    expected.forEach(([id, name, maxHealth, unlockWave]) => {
      expect(getEnemy(id)).toMatchObject({ id, name, maxHealth, unlockWave });
    });
  });

  it('后四种普通怪有独立行为，幼虫只给 1 金币/1 经验', () => {
    expect(getEnemy('bulwark').behavior).toBe('guard');
    expect(getEnemy('mender').behavior).toBe('mend');
    expect(getEnemy('bomber').behavior).toBe('explode');
    expect(getEnemy('broodmother').behavior).toBe('summon');
    expect(getEnemy('bomber').attack?.windupSeconds).toBe(0.9);

    const larva = getEnemy('larva');
    expect(larva).toMatchObject({
      name: '幼虫',
      behavior: 'chase',
      goldReward: 1,
      xpReward: 1,
      markerGlyph: '·',
    });

    // 基础金币与 01 §钱与经验一致，供经济系统直接读取。
    const goldByEnemy: Readonly<Record<string, number>> = {
      blob: 2,
      skitter: 2,
      spitter: 3,
      charger: 3,
      bulwark: 4,
      mender: 4,
      bomber: 4,
      broodmother: 5,
      larva: 1,
    };
    for (const [id, gold] of Object.entries(goldByEnemy)) {
      expect(getEnemy(id).goldReward, `${id} 金币`).toBe(gold);
    }
  });

  it('matches the approved boss values and phase parameters', () => {
    const boss = getEnemy('boss');
    expect(boss).toMatchObject({
      name: '裂隙炉王',
      maxHealth: 12000,
      armor: 20,
      magicResist: 0.15,
      boss: {
        phaseThreshold: 0.5,
        summonIntervalSeconds: 20,
        summonCount: 4,
        summonMaxAlive: 8,
        summonId: 'blob',
      },
    });
  });

  it('caps the field at 100 and counts alive plus pending spawns', () => {
    expect(MAX_ALIVE_ENEMIES).toBe(100);
    expect(remainingEnemyCapacity(0, 0)).toBe(100);
    expect(remainingEnemyCapacity(99, 0)).toBe(1);
    expect(remainingEnemyCapacity(99, 1)).toBe(0);
    expect(remainingEnemyCapacity(MAX_ALIVE_ENEMIES, 0)).toBe(0);
    expect(remainingEnemyCapacity(-5, -1)).toBe(100);
  });

  it('throws on an unknown enemy id', () => {
    expect(() => getEnemy('unknown')).toThrow(/Unknown enemy id/);
  });
});

describe('wave data', () => {
  it('defines eighteen ordered waves', () => {
    expect(TOTAL_WAVES).toBe(18);
    expect(WAVE_LIST).toHaveLength(18);
    expect(listWaves()).toBe(WAVE_LIST);
    expect(WAVE_LIST.map((wave) => wave.wave)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1),
    );
  });

  it('uses the approved normal enemy counts, multipliers and elites', () => {
    const counts = WAVE_LIST.slice(0, 17).map((wave) => wave.enemyCount);
    expect(counts).toEqual(Array.from({ length: 17 }, (_, index) => 12 + 3 * (index + 1)));

    expect(WAVE_LIST.filter((wave) => wave.eliteCount > 0).map((wave) => wave.wave)).toEqual([
      6, 9, 12, 15,
    ]);
    expect(getWave(6).elite?.id).toBe('elite-6');
    expect(getWave(6).elite?.maxHealth).toBe(600);
    expect(getWave(9).elite?.maxHealth).toBe(1000);
    expect(getWave(12).elite?.maxHealth).toBe(1600);
    expect(getWave(15).elite?.maxHealth).toBe(2400);
    expect(getWave(6).kind).toBe('elite');

    expect(waveHealthMultiplier(1)).toBe(1);
    expect(waveDamageMultiplier(1)).toBe(1);
    expect(waveHealthMultiplier(3)).toBeCloseTo(1.2, 10);
    expect(waveDamageMultiplier(3)).toBeCloseTo(1.12, 10);
    expect(waveHealthMultiplier(8)).toBeCloseTo(1.7, 10);
    expect(waveDamageMultiplier(8)).toBeCloseTo(1.42, 10);
    expect(waveHealthMultiplier(18)).toBeCloseTo(3.24, 10);
    expect(getWave(5).healthMultiplier).toBeCloseTo(1.4, 10);
    expect(getWave(5).damageMultiplier).toBeCloseTo(1.24, 10);
  });

  it('unlocks normal enemies by first appearance wave', () => {
    const expected: ReadonlyArray<[number, readonly string[]]> = [
      [1, ['blob']],
      [2, ['blob', 'skitter']],
      [3, ['blob', 'skitter', 'spitter']],
      [4, ['blob', 'skitter', 'spitter', 'charger']],
      [5, ['blob', 'skitter', 'spitter', 'charger', 'bulwark']],
      [6, ['blob', 'skitter', 'spitter', 'charger', 'bulwark']],
      [7, ['blob', 'skitter', 'spitter', 'charger', 'bulwark', 'mender']],
      [9, ['blob', 'skitter', 'spitter', 'charger', 'bulwark', 'mender']],
      [
        10,
        ['blob', 'skitter', 'spitter', 'charger', 'bulwark', 'mender', 'bomber'],
      ],
      [
        13,
        [
          'blob',
          'skitter',
          'spitter',
          'charger',
          'bulwark',
          'mender',
          'bomber',
          'broodmother',
        ],
      ],
      [
        17,
        [
          'blob',
          'skitter',
          'spitter',
          'charger',
          'bulwark',
          'mender',
          'bomber',
          'broodmother',
        ],
      ],
    ];

    for (const [wave, roster] of expected) {
      expect(getWave(wave).roster, `wave ${wave}`).toEqual(roster);
    }
    expect(getWave(18).roster).toEqual([]);
  });

  it('makes wave eighteen the boss wave', () => {
    const bossWave = getWave(18);
    expect(bossWave.kind).toBe('boss');
    expect(bossWave.bossId).toBe('boss');
    expect(bossWave.enemyCount).toBe(0);
    expect(bossWave.eliteCount).toBe(0);
    expect(bossWave.elite).toBeUndefined();
    expect(bossWave.healthMultiplier).toBe(1);
    expect(bossWave.damageMultiplier).toBe(1);
    expect(bossWave.durationSeconds).toBe(0);
    expect(bossWave.shopAfter).toBe(false);
  });

  it('defines timers 30+2w (+8 elite), a shop after 1–17 and the 65% spawn window', () => {
    for (let wave = 1; wave <= 18; wave += 1) {
      const definition = getWave(wave);
      const expected =
        wave === 18 ? 0 : 30 + 2 * wave + (definition.kind === 'elite' ? 8 : 0);
      expect(definition.durationSeconds, `wave ${wave}`).toBe(expected);
      expect(waveDurationSeconds(wave)).toBe(expected);
      expect(definition.shopAfter).toBe(wave < 18);
      expect(shopAfterWave(wave)).toBe(wave < 18);
      expect(waveSpawnWindowSeconds(wave)).toBeCloseTo(expected * 0.65, 10);
    }
    expect(waveDurationSeconds(9)).toBe(56);
    expect(waveDurationSeconds(17)).toBe(64);
    // 17 波倒计时合计 848 秒。
    const total = Array.from({ length: 17 }, (_, index) => waveDurationSeconds(index + 1))
      .reduce((sum, seconds) => sum + seconds, 0);
    expect(total).toBe(848);
  });

  it('matches docs/design/v0.2/data/waves.csv row by row', () => {
    const lines = readSource('docs/design/v0.2/data/waves.csv')
      .trim()
      .split(/\r?\n/);
    const header = lines[0]?.split(',') ?? [];
    expect(header).toEqual([
      'wave',
      'kind',
      'timer_seconds',
      'normal_quota',
      'elite_hp',
      'boss_hp',
      'chest_count',
      'completion_gold',
      'shop_after',
    ]);
    const rows = lines.slice(1).map((line) => line.split(','));
    expect(rows).toHaveLength(18);

    rows.forEach((cells, index) => {
      const wave = index + 1;
      const definition = getWave(wave);
      const [csvWave, kind, timer, quota, eliteHp, bossHp, , , shopAfter] = cells;
      expect(Number(csvWave)).toBe(wave);
      expect(kind).toBe(definition.kind);
      expect(Number(timer)).toBe(definition.durationSeconds);
      expect(Number(quota)).toBe(definition.enemyCount);
      expect(Number(eliteHp)).toBe(definition.elite?.maxHealth ?? 0);
      expect(Number(bossHp)).toBe(definition.kind === 'boss' ? 12000 : 0);
      expect(shopAfter).toBe(definition.shopAfter ? 'True' : 'False');
    });

    expect(getWave(9).kind).toBe('elite');
    expect(getWave(9).elite?.id).toBe('elite-9');
    expect(WAVE_LIST.filter((wave) => wave.kind === 'boss')).toHaveLength(1);
  });

  it('rejects out-of-range waves', () => {
    expect(() => getWave(0)).toThrow(/Wave must be an integer/);
    expect(() => getWave(19)).toThrow(/Wave must be an integer/);
    expect(() => getWave(1.5)).toThrow(/Wave must be an integer/);
  });
});

describe('upgrade data', () => {
  it('defines 24 unique upgrades across five owners', () => {
    expect(UPGRADE_LIST).toHaveLength(24);
    expect(new Set(UPGRADE_LIST.map((upgrade) => upgrade.id)).size).toBe(24);

    const countsByOwner = new Map<string, number>();
    for (const upgrade of UPGRADE_LIST) {
      countsByOwner.set(upgrade.owner, (countsByOwner.get(upgrade.owner) ?? 0) + 1);
    }
    expect(countsByOwner.get('general')).toBe(8);
    expect(countsByOwner.get('vishdal')).toBe(4);
    expect(countsByOwner.get('amiya')).toBe(4);
    expect(countsByOwner.get('saria')).toBe(4);
    expect(countsByOwner.get('muelsyse')).toBe(4);
  });

  it('matches the approved rarity distribution and stack caps', () => {
    const silver = listUpgrades({ rarity: 'silver' });
    const gold = listUpgrades({ rarity: 'gold' });
    const prismatic = listUpgrades({ rarity: 'prismatic' });

    expect(silver).toHaveLength(4);
    expect(gold).toHaveLength(11);
    expect(prismatic).toHaveLength(9);
    expect(silver.map((upgrade) => upgrade.id)).toEqual(['G01', 'G02', 'G03', 'G04']);

    for (const upgrade of UPGRADE_LIST) {
      const silverStacked = ['G01', 'G02', 'G03', 'G04'].includes(upgrade.id);
      expect(upgrade.maxStacks).toBe(silverStacked ? 3 : 1);
      expect(upgrade.description.length).toBeGreaterThan(0);
      expect(upgrade.appliesTo.length).toBeGreaterThan(0);
    }
  });

  it('loads upgrades by id and filters by character', () => {
    expect(getUpgrade('W04')).toMatchObject({
      name: '追加装药',
      rarity: 'prismatic',
      owner: 'vishdal',
      params: { shots: 9 },
    });

    const vishdalPool = listUpgradesForCharacter('vishdal');
    expect(vishdalPool).toHaveLength(12);
    expect(vishdalPool.some((upgrade) => upgrade.id === 'G01')).toBe(true);
    expect(vishdalPool.some((upgrade) => upgrade.id === 'W01')).toBe(true);
    expect(vishdalPool.some((upgrade) => upgrade.id === 'A01')).toBe(false);

    expect(listUpgrades({ owner: 'general' })).toHaveLength(8);
    expect(() => getUpgrade('X99')).toThrow(/Unknown upgrade id/);
  });
});
