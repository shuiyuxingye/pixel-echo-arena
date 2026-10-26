import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HealthState } from '../src/game/combat';
import { getCharacter, HEX_LIST } from '../src/game/data';
import {
  KNIGHT_HEX_IDS,
  KNIGHT_HEX_PARAMS,
  KNIGHT_H41_PIERCE_EXTRA_TARGETS,
  KnightHexEffects,
  isKnightHexId,
  resolveKnightBashDamageMultiplier,
  resolveKnightFieldDamage,
  resolveKnightHealShock,
  resolveKnightShieldCounter,
  resolveKnightShieldGainMultiplier,
} from '../src/game/knight-hex-effects';
import { SARIA_PASSIVE_COOLDOWN_REDUCTION_SECONDS, SariaCombat } from '../src/game/saria';

const SARIA = getCharacter('saria');
const STEP = 1 / 60;
const SCENE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/game/scenes/ArenaScene.ts'),
  'utf8',
);

function createSariaCombat(): SariaCombat {
  return new SariaCombat({
    kCooldownSeconds: SARIA.skillK.cooldownSeconds,
    healAmount: SARIA.skillK.params?.heal ?? 0,
    shieldAmount: SARIA.skillK.params?.shield ?? 0,
    shieldDurationSeconds: SARIA.skillK.params?.shieldDurationSeconds ?? 0,
    passiveLCooldownReductionSeconds: SARIA_PASSIVE_COOLDOWN_REDUCTION_SECONDS,
    lCooldownSeconds: SARIA.skillL.cooldownSeconds,
    lDurationSeconds: SARIA.skillL.durationSeconds ?? 0,
    fieldRadius: SARIA.skillL.params?.fieldRadius ?? 0,
    fieldHealPerSecond: SARIA.skillL.params?.healPerSecond ?? 0,
    enemySlowPercent: SARIA.skillL.params?.enemySlowPercent ?? 0,
    enemyMagicVulnerability: SARIA.skillL.params?.enemyMagicVulnerability ?? 0,
    attackBonusMagicDamage: SARIA.skillL.params?.attackBonusMagicDamage ?? 0,
  });
}

function createHealth(maxHealth = SARIA.maxHealth): HealthState {
  return new HealthState({ maxHealth, armor: 0, magicResist: 0 });
}

function knightWith(...hexIds: readonly string[]): KnightHexEffects {
  const owned = new Set(hexIds);
  return new KnightHexEffects({ has: (hexId) => owned.has(hexId) });
}

function runSteps(combat: SariaCombat, seconds: number, health?: HealthState): void {
  const steps = Math.round(seconds / STEP);
  for (let step = 0; step < steps; step += 1) combat.step(STEP, health);
}

function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\n  private ', start + signature.length);
  const nextPublic = source.indexOf('\n  public ', start + signature.length);
  const candidates = [next, nextPublic].filter((index) => index > 0);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

describe('骑士专属海克斯目录', () => {
  it('恰好覆盖 H37–H42 且都存在于海克斯目录', () => {
    expect(KNIGHT_HEX_IDS).toEqual(['H37', 'H38', 'H39', 'H40', 'H41', 'H42']);
    for (const hexId of KNIGHT_HEX_IDS) {
      expect(isKnightHexId(hexId)).toBe(true);
      expect(KNIGHT_HEX_PARAMS[hexId]).toBeDefined();
      expect(HEX_LIST.some((hex) => hex.id === hexId)).toBe(true);
    }
    expect(isKnightHexId('H36')).toBe(false);
    expect(isKnightHexId('H43')).toBe(false);
  });

  it('六张牌都属于骑士且与 02 数值一致', () => {
    for (const hexId of KNIGHT_HEX_IDS) {
      const definition = HEX_LIST.find((hex) => hex.id === hexId);
      expect(definition?.owner).toBe('骑士');
    }
    expect(KNIGHT_HEX_PARAMS.H37).toMatchObject({
      healDamageRatio: 0.8,
      healShockRadius: 100,
    });
    expect(KNIGHT_HEX_PARAMS.H38.fieldDamagePerSecond).toBe(16);
    expect(KNIGHT_HEX_PARAMS.H39).toMatchObject({
      counterRadius: 85,
      counterDamage: 18,
      counterCooldownSeconds: 0.8,
    });
    expect(KNIGHT_HEX_PARAMS.H40).toMatchObject({
      shieldGainMultiplier: 0.8,
      bashDamageMultiplier: 1.35,
    });
    expect(KNIGHT_HEX_PARAMS.H41).toMatchObject({
      everyNthJ: 4,
      throwRange: 180,
      throwDamageRatio: 0.6,
    });
    expect(KNIGHT_HEX_PARAMS.H41.pierceExtraTargets).toBe(
      KNIGHT_H41_PIERCE_EXTRA_TARGETS,
    );
    expect(KNIGHT_HEX_PARAMS.H42).toMatchObject({
      fieldShieldPerSecond: 8,
      bashMagicRatio: 0.15,
      bashMagicCap: 30,
    });
  });
});

describe('H37 回生冲击', () => {
  it('未拥有 S01/H37 时无治疗转伤，拥有任一即 80%/半径 100', () => {
    expect(resolveKnightHealShock(false, false)).toBeNull();
    expect(resolveKnightHealShock(true, false)).toEqual({ ratio: 0.8, radius: 100 });
    expect(resolveKnightHealShock(false, true)).toEqual({ ratio: 0.8, radius: 100 });
    // 同时拥有不叠成 1.6 倍，只取一次。
    expect(resolveKnightHealShock(true, true)).toEqual({ ratio: 0.8, radius: 100 });
  });

  it('K 按实际治疗量的 80% 转化，满血施放为 0', () => {
    const combat = createSariaCombat();
    combat.setHealShock(0.8, 100);
    const health = createHealth();
    health.applyDamage(100, 'true');

    const result = combat.tryActivateK(health);
    expect(result?.healed).toBeCloseTo(SARIA.skillK.params?.heal ?? 0, 10);
    expect(result?.healShockDamage).toBeCloseTo(
      (SARIA.skillK.params?.heal ?? 0) * 0.8,
      10,
    );

    const fullCombat = createSariaCombat();
    fullCombat.setHealShock(0.8, 100);
    const full = createHealth();
    const fullResult = fullCombat.tryActivateK(full);
    expect(fullResult).not.toBeNull();
    expect(fullResult?.healShockDamage).toBe(0);
  });
});

describe('H38 钙质反应', () => {
  it('未拥有 S02/H38 时为 0，拥有任一即每秒 16', () => {
    expect(resolveKnightFieldDamage(false, false)).toBe(0);
    expect(resolveKnightFieldDamage(true, false)).toBe(16);
    expect(resolveKnightFieldDamage(false, true)).toBe(16);
  });

  it('领域每满 1 秒返回一次伤害 tick', () => {
    const combat = createSariaCombat();
    combat.setFieldDamagePerSecond(16);
    expect(combat.tryActivateL()).toBe(true);
    expect(combat.step(1, createHealth()).fieldDamageTicks).toBe(1);
  });
});

describe('H39 坚盾反击', () => {
  it('未拥有 S03/H39 时关闭，拥有任一即 85 半径/18 物伤/0.8 秒冷却', () => {
    expect(resolveKnightShieldCounter(false, false).enabled).toBe(false);
    for (const counter of [
      resolveKnightShieldCounter(true, false),
      resolveKnightShieldCounter(false, true),
    ]) {
      expect(counter).toEqual({
        enabled: true,
        radius: 85,
        damage: 18,
        cooldownSeconds: 0.8,
      });
    }
  });

  it('护盾吸收触发一次后进入 0.8 秒内置冷却', () => {
    const combat = createSariaCombat();
    combat.setShieldCounter(true, 85, 18, 0.8);
    expect(combat.registerShieldAbsorb(0)).toBe(false);
    expect(combat.registerShieldAbsorb(10)).toBe(true);
    expect(combat.registerShieldAbsorb(10)).toBe(false);
    runSteps(combat, 0.8, createHealth());
    expect(combat.registerShieldAbsorb(10)).toBe(true);
  });
});

describe('H40 守护转攻', () => {
  it('护盾获得量 −20%，盾击伤害 +35%', () => {
    expect(resolveKnightShieldGainMultiplier(false)).toBe(1);
    expect(resolveKnightShieldGainMultiplier(true)).toBe(0.8);
    expect(resolveKnightBashDamageMultiplier(false)).toBe(1);
    expect(resolveKnightBashDamageMultiplier(true)).toBe(1.35);
  });

  it('K 的护盾按 80% 结算，基础盾量不变', () => {
    const combat = createSariaCombat();
    combat.setShieldGainMultiplier(0.8);
    const health = createHealth();
    const result = combat.tryActivateK(health);
    const baseShield = SARIA.skillK.params?.shield ?? 0;
    expect(result?.shield).toBeCloseTo(baseShield * 0.8, 10);
    expect(health.shield).toBeCloseTo(baseShield * 0.8, 10);
  });

  it('盾击攻击定义只放大物理伤害，未拥有时原样返回', () => {
    const effects = knightWith('H40');
    const attack = SARIA.attack;
    expect(effects.boostShieldBashDamage(attack).damage).toBeCloseTo(
      attack.damage * 1.35,
      10,
    );

    const plain = knightWith();
    expect(plain.boostShieldBashDamage(attack)).toBe(attack);
  });
});

describe('H41 重盾远投', () => {
  it('每第四次 J 变为飞盾，其余仍为盾击', () => {
    const effects = knightWith('H41');
    expect(effects.registerJAttack()).toEqual({ index: 1, isThrow: false });
    expect(effects.registerJAttack()).toEqual({ index: 2, isThrow: false });
    expect(effects.registerJAttack()).toEqual({ index: 3, isThrow: false });
    expect(effects.registerJAttack()).toEqual({ index: 4, isThrow: true });
    expect(effects.registerJAttack()).toEqual({ index: 5, isThrow: false });
    for (let index = 6; index <= 7; index += 1) effects.registerJAttack();
    expect(effects.registerJAttack()).toEqual({ index: 8, isThrow: true });
    expect(effects.snapshot().throw.jAttacks).toBe(8);
    expect(effects.snapshot().throw.throws).toBe(2);
  });

  it('未拥有 H41 时不计数也不变身', () => {
    const effects = knightWith();
    for (let index = 0; index < 8; index += 1) {
      expect(effects.registerJAttack().isThrow).toBe(false);
    }
    expect(effects.snapshot().throw.jAttacks).toBe(0);
    expect(effects.throwPierce).toBeNull();
  });

  it('飞盾为 180 距离、60% 伤害，并穿透后续目标', () => {
    const effects = knightWith('H41');
    const attack = SARIA.attack;
    const thrown = effects.buildThrowAttack(attack);
    expect(thrown.range).toBe(180);
    expect(thrown.damage).toBeCloseTo(attack.damage * 0.6, 10);
    expect(effects.throwPierce).toEqual({
      extraTargets: KNIGHT_H41_PIERCE_EXTRA_TARGETS,
      subsequentDamageRatio: 1,
    });
  });

  it('与 H40 同时拥有时先吃 +35% 再折算 60%', () => {
    const effects = knightWith('H40', 'H41');
    const attack = SARIA.attack;
    expect(effects.buildThrowAttack(attack).damage).toBeCloseTo(
      attack.damage * 1.35 * 0.6,
      10,
    );
  });

  it('波初重新计数，每局飞盾累计保留', () => {
    const effects = knightWith('H41');
    for (let index = 0; index < 4; index += 1) effects.registerJAttack();
    effects.resetForWave();
    expect(effects.snapshot().throw.jAttacks).toBe(0);
    expect(effects.snapshot().throw.throws).toBe(1);
    effects.reset();
    expect(effects.snapshot().throw.throws).toBe(0);
  });
});

describe('H42 不落王城', () => {
  it('领域内每秒获得 8 护盾，并刷新护盾持续时间', () => {
    const combat = createSariaCombat();
    combat.setFieldShieldPerSecond(8);
    expect(combat.tryActivateL()).toBe(true);
    const health = createHealth();
    expect(combat.step(1, health).fieldShieldTicks).toBe(1);
    expect(health.shield).toBeCloseTo(8, 10);
    expect(combat.isShieldActive).toBe(true);
  });

  it('H40 的 −20% 同样作用于领域护盾（每秒 6.4）', () => {
    const combat = createSariaCombat();
    combat.setFieldShieldPerSecond(8);
    combat.setShieldGainMultiplier(0.8);
    expect(combat.tryActivateL()).toBe(true);
    const health = createHealth();
    combat.step(1, health);
    expect(health.shield).toBeCloseTo(6.4, 10);
  });

  it('领域结束后护盾按时到期清零', () => {
    const combat = createSariaCombat();
    combat.setFieldShieldPerSecond(8);
    expect(combat.tryActivateL()).toBe(true);
    const health = createHealth();
    const fieldSeconds = SARIA.skillL.durationSeconds ?? 0;
    runSteps(combat, fieldSeconds, health);
    expect(health.shield).toBeGreaterThan(0);
    // 最后一次领域护盾在领域结束瞬间获得，持续 4 秒后清除。
    runSteps(combat, (SARIA.skillK.params?.shieldDurationSeconds ?? 0) + 0.1, health);
    expect(health.shield).toBe(0);
  });

  it('盾击附带护盾当前量 15% 法伤，单次上限 30', () => {
    const effects = knightWith('H42');
    expect(effects.shieldBashMagicDamage(100)).toBeCloseTo(15, 10);
    expect(effects.shieldBashMagicDamage(200)).toBe(30);
    expect(effects.shieldBashMagicDamage(400)).toBe(30);
    expect(effects.shieldBashMagicDamage(0)).toBe(0);
    expect(effects.shieldBashMagicDamage(Number.NaN)).toBe(0);
    expect(knightWith().shieldBashMagicDamage(100)).toBe(0);
  });

  it('未拥有 H42 时不增加领域护盾 tick', () => {
    const combat = createSariaCombat();
    expect(combat.tryActivateL()).toBe(true);
    expect(combat.step(1, createHealth()).fieldShieldTicks).toBe(0);
  });
});

describe('骑士海克斯场景接线', () => {
  it('H37–H39 与旧强化 S01–S03 按「或」合并，H40/H42 接入 SariaCombat', () => {
    const build = methodBody(SCENE_SOURCE, 'private syncBuildModifiers(): void');
    expect(build).toContain('resolveKnightHealShock');
    expect(build).toContain('resolveKnightFieldDamage');
    expect(build).toContain('resolveKnightShieldCounter');
    expect(build).toContain("this.knightHexes.has('H37')");
    expect(build).toContain("this.knightHexes.has('H38')");
    expect(build).toContain("this.knightHexes.has('H39')");
    expect(build).toContain('setShieldGainMultiplier');
    expect(build).toContain('setFieldShieldPerSecond');
    expect(build.match(/setHealShock/g)).toHaveLength(1);
    expect(build.match(/setFieldDamagePerSecond/g)).toHaveLength(1);
    expect(build.match(/setShieldCounter/g)).toHaveLength(1);
  });

  it('H40/H42 盾击加成与 H41 飞盾均已接线', () => {
    const bash = methodBody(SCENE_SOURCE, 'private performShieldBash(');
    expect(bash).toContain('boostShieldBashDamage');
    expect(bash).toContain('shieldBashMagicDamage');

    const firing = methodBody(
      SCENE_SOURCE,
      'private updateCombat(stepSeconds: number): void',
    );
    expect(firing).toContain('registerJAttack().isThrow');
    expect(firing).toContain('performShieldThrow');

    const throwBody = methodBody(SCENE_SOURCE, 'private performShieldThrow(');
    expect(throwBody).toContain('resolveShotAim');
    expect(throwBody).toContain('createProjectile');
    expect(throwBody).toContain("source: 'J'");
    expect(throwBody).toContain('throwPierce');

    const reset = methodBody(
      SCENE_SOURCE,
      'private resetWaveReadyState(): void',
    );
    expect(reset).toContain('this.knightHexes.resetForWave()');
  });

  it('开发快照暴露 knightHexes，便于核对 J 计数与飞盾', () => {
    expect(SCENE_SOURCE).toContain(
      'knightHexes: this.knightHexes.snapshot()',
    );
  });
});
