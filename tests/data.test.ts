import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHARACTER_LIST,
  ENEMY_LIST,
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
  waveDamageMultiplier,
  waveHealthMultiplier,
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
      'src/game/amiya.ts',
      'src/game/saria.ts',
      'src/game/muelsyse.ts',
      'src/game/grenade.ts',
      'src/game/enemy.ts',
      'src/game/soul.ts',
      'src/game/burst.ts',
      'src/game/progression.ts',
      'src/game/upgrade.ts',
      'src/game/upgrade-effects.ts',
      'src/game/wave.ts',
      'src/game/data/index.ts',
      'src/game/data/characters.ts',
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
      name: '维什戴尔',
      maxHealth: 110,
      armor: 8,
      magicResist: 0,
      moveSpeed: 150,
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
      maxHealth: 100,
      armor: 0,
      magicResist: 0.15,
      moveSpeed: 165,
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
      maxHealth: 180,
      armor: 35,
      magicResist: 0.1,
      moveSpeed: 140,
    });
    expect(saria.attack).toMatchObject({
      intervalSeconds: 0.55,
      range: 70,
      damage: 26,
      arcDegrees: 100,
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
      maxHealth: 105,
      armor: 5,
      magicResist: 0.1,
      moveSpeed: 165,
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
  it('defines four normal enemies and one boss', () => {
    expect(NORMAL_ENEMY_LIST).toHaveLength(4);
    expect(ENEMY_LIST).toHaveLength(5);
    expect(getEnemy('boss').id).toBe('boss');
  });

  it('matches the approved normal enemy values', () => {
    expect(getEnemy('chaser')).toMatchObject({
      maxHealth: 60,
      contactDamage: 8,
      behavior: 'chase',
    });
    expect(getEnemy('shooter')).toMatchObject({
      maxHealth: 45,
      behavior: 'shoot',
      attack: { damage: 10, intervalSeconds: 1.6 },
    });
    expect(getEnemy('charger')).toMatchObject({
      maxHealth: 80,
      behavior: 'charge',
      attack: { damage: 18, windupSeconds: 0.7 },
    });
    expect(getEnemy('heavy')).toMatchObject({
      maxHealth: 160,
      armor: 40,
      contactDamage: 14,
      behavior: 'heavy',
    });
  });

  it('matches the approved boss values and phase parameters', () => {
    const boss = getEnemy('boss');
    expect(boss).toMatchObject({
      name: '失控实验体',
      maxHealth: 2600,
      armor: 20,
      magicResist: 0.15,
      boss: {
        phaseThreshold: 0.5,
        summonIntervalSeconds: 15,
        summonCount: 4,
        summonId: 'chaser',
      },
    });
  });

  it('throws on an unknown enemy id', () => {
    expect(() => getEnemy('unknown')).toThrow(/Unknown enemy id/);
  });
});

describe('wave data', () => {
  it('defines nine ordered waves', () => {
    expect(TOTAL_WAVES).toBe(9);
    expect(WAVE_LIST).toHaveLength(9);
    expect(listWaves()).toBe(WAVE_LIST);
    expect(WAVE_LIST.map((wave) => wave.wave)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('uses the approved normal enemy counts, multipliers and elites', () => {
    const counts = WAVE_LIST.slice(0, 8).map((wave) => wave.enemyCount);
    expect(counts).toEqual([12, 16, 18, 22, 26, 28, 32, 36]);

    expect(WAVE_LIST.filter((wave) => wave.eliteCount > 0).map((wave) => wave.wave)).toEqual([
      3, 6,
    ]);
    expect(getWave(3).eliteEnemyId).toBe('charger');
    expect(getWave(6).eliteEnemyId).toBe('heavy');

    expect(waveHealthMultiplier(1)).toBe(1);
    expect(waveDamageMultiplier(1)).toBe(1);
    expect(waveHealthMultiplier(3)).toBeCloseTo(1.24, 10);
    expect(waveDamageMultiplier(3)).toBeCloseTo(1.12, 10);
    expect(waveHealthMultiplier(8)).toBeCloseTo(1.84, 10);
    expect(waveDamageMultiplier(8)).toBeCloseTo(1.42, 10);
    expect(getWave(5).healthMultiplier).toBeCloseTo(1.48, 10);
    expect(getWave(5).damageMultiplier).toBeCloseTo(1.24, 10);
  });

  it('makes wave nine the boss wave', () => {
    const bossWave = getWave(9);
    expect(bossWave.kind).toBe('boss');
    expect(bossWave.bossId).toBe('boss');
    expect(bossWave.enemyCount).toBe(0);
    expect(bossWave.eliteCount).toBe(0);
    expect(bossWave.healthMultiplier).toBe(1);
    expect(bossWave.damageMultiplier).toBe(1);
  });

  it('rejects out-of-range waves', () => {
    expect(() => getWave(0)).toThrow(/Wave must be an integer/);
    expect(() => getWave(10)).toThrow(/Wave must be an integer/);
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
