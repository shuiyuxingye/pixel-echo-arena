import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BurstSystem, type BurstConfig } from '../src/game/burst';
import { createProjectile } from '../src/game/combat';
import { getCharacter } from '../src/game/data';
import { FACING_VECTORS, type Facing } from '../src/game/movement';
import { DEFAULT_KEY_BINDINGS } from '../src/game/settings';

const ROOT = process.cwd();
const VISHDA = getCharacter('vishdal');

const FACINGS: readonly Facing[] = [
  'east',
  'southEast',
  'south',
  'southWest',
  'west',
  'northWest',
  'north',
  'northEast',
];

function config(overrides: Partial<BurstConfig> = {}): BurstConfig {
  return {
    cooldownSeconds: 30,
    shots: 6,
    damageMultiplier: 2,
    splashRadiusMultiplier: 1.5,
    fireIntervalSeconds: 1.1,
    ammoExpirySeconds: 20,
    ...overrides,
  };
}

function system(overrides: Partial<BurstConfig> = {}): BurstSystem {
  return new BurstSystem(config(overrides));
}

describe('爆裂黎明弹药', () => {
  it('启动后获得 6 发弹药并进入 30 秒冷却', () => {
    const burst = system();

    expect(burst.tryActivate()).toBe(true);
    expect(burst.ammoRemaining).toBe(6);
    expect(burst.maxAmmo).toBe(6);
    expect(burst.cooldownRemaining).toBeCloseTo(30, 12);
    expect(burst.fireIntervalSeconds).toBeCloseTo(1.1, 12);
    expect(burst.isActive).toBe(true);
  });

  it('每次实际射出消耗一发，第 7 发不再强化', () => {
    const burst = system();
    burst.tryActivate();

    for (let shot = 6; shot >= 1; shot -= 1) {
      expect(burst.ammoRemaining).toBe(shot);
      expect(burst.consumeShot()).toBe(true);
    }
    expect(burst.ammoRemaining).toBe(0);
    expect(burst.consumeShot()).toBe(false);
    expect(burst.isActive).toBe(false);
  });

  it('推进时间本身不扣弹；20 秒未用完才统一失效', () => {
    const burst = system();
    burst.tryActivate();
    burst.step(19);

    expect(burst.ammoRemaining).toBe(6);
    expect(burst.ammoExpiresInSeconds).toBeCloseTo(1, 9);

    burst.step(1);
    expect(burst.ammoRemaining).toBe(0);
    expect(burst.ammoExpiresInSeconds).toBe(0);
  });

  it('冷却中重复触发返回 false，不重置弹药也不刷新失效时间', () => {
    const burst = system();
    burst.tryActivate();
    expect(burst.consumeShot()).toBe(true);
    burst.step(1);

    const cooldownBefore = burst.cooldownRemaining;
    const expiryBefore = burst.ammoExpiresInSeconds;
    expect(burst.tryActivate()).toBe(false);
    expect(burst.ammoRemaining).toBe(5);
    expect(burst.cooldownRemaining).toBeCloseTo(cooldownBefore, 12);
    expect(burst.ammoExpiresInSeconds).toBeCloseTo(expiryBefore, 12);
  });

  it('冷却结束后可再次启动并补满弹药', () => {
    const burst = system();
    burst.tryActivate();
    burst.consumeShot();
    burst.step(30);

    expect(burst.cooldownRemaining).toBe(0);
    expect(burst.tryActivate()).toBe(true);
    expect(burst.ammoRemaining).toBe(6);
  });

  it('进入下一波清空剩余冷却与弹匣，L 立即就绪', () => {
    const burst = system();
    burst.tryActivate();
    burst.consumeShot();
    burst.step(3);

    burst.resetForWaveStart();
    expect(burst.cooldownRemaining).toBe(0);
    expect(burst.ammoRemaining).toBe(0);
    expect(burst.isActive).toBe(false);
    expect(burst.tryActivate()).toBe(true);
    expect(burst.ammoRemaining).toBe(6);
  });
});

describe('强化攻击定义', () => {
  it('直接与余震伤害 +100%、溅射半径 +50%，其余字段保持原值', () => {
    const burst = system();
    burst.tryActivate();

    const attack = burst.modifyAttack(VISHDA.attack);
    expect(attack.damage).toBeCloseTo(72, 12);
    expect(attack.damageType).toBe('physical');
    expect(attack.splashRadius).toBeCloseTo(48, 12);
    expect(attack.aftershock?.damage).toBeCloseTo(36, 12);
    expect(attack.aftershock?.radius).toBe(32);
    expect(attack.aftershock?.delaySeconds).toBeCloseTo(0.35, 12);
    expect(attack.intervalSeconds).toBeCloseTo(0.9, 12);
    expect(attack.range).toBe(290);

    // 不修改传入的定义。
    expect(VISHDA.attack.damage).toBe(36);
    expect(VISHDA.attack.splashRadius).toBe(32);
  });

  it('八向空射都沿当前面向出射，强化伤害随弹体锁定', () => {
    const burst = system();
    burst.tryActivate();
    const attack = burst.modifyAttack(VISHDA.attack);

    for (const facing of FACINGS) {
      const origin = { x: 300, y: 300 };
      const projectile = createProjectile(1, origin, facing, attack);
      const direction = FACING_VECTORS[facing];

      expect(projectile.vx).toBeCloseTo(direction.x * 620, 9);
      expect(projectile.vy).toBeCloseTo(direction.y * 620, 9);
      expect(projectile.damage).toBeCloseTo(72, 12);
      expect(projectile.damageType).toBe('physical');
      expect(projectile.x).toBe(origin.x);
      expect(projectile.y).toBe(origin.y);
    }
  });
});

describe('场景接入', () => {
  it('竞技场场景把逐发强化交给 BurstSystem，并只在射出时扣弹', () => {
    const source = readFileSync(resolve(ROOT, 'src/game/scenes/ArenaScene.ts'), 'utf8');

    expect(source).toContain('BurstSystem');
    // 键位经共享设置解析，默认 L 映射到 skillL（US-022 起不再硬编码物理键）。
    expect(DEFAULT_KEY_BINDINGS.skillL).toBe('KeyL');
    expect(source).toContain('combatBindingActionForKeyCode');
    expect(source).toContain("action === 'skillL'");
    expect(source).toContain('modifyAttack');
    expect(source).toContain('consumeShot');
    expect(source).toContain('fireIntervalSeconds');
    expect(source).toContain('ammoHud');
  });
});

describe('I15 技能持续时间倍率', () => {
  it('延长弹药失效时间，不影响冷却与每发间隔', () => {
    const burst = system();
    burst.setDurationMultiplier(1.15);
    expect(burst.tryActivate()).toBe(true);
    expect(burst.cooldownRemaining).toBeCloseTo(30, 12);
    burst.step(22.9);
    expect(burst.ammoRemaining).toBe(6);
    burst.step(0.2);
    expect(burst.ammoRemaining).toBe(0);
  });
});
