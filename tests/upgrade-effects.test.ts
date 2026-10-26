import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/game/arena';
import { BurstSystem } from '../src/game/burst';
import { Combatant } from '../src/game/combat';
import { getCharacter, getUpgrade } from '../src/game/data';
import { GrenadeSystem } from '../src/game/grenade';
import { PlayerMotion } from '../src/game/movement';
import { SoulSystem } from '../src/game/soul';
import {
  COOLDOWN_REDUCTION_CAP,
  G01_DAMAGE_BONUS_PER_STACK,
  G02_MOVE_SPEED_BONUS_PER_STACK,
  G03_COOLDOWN_REDUCTION_PER_STACK,
  G04_HEAL_ON_ACQUIRE,
  G04_MAX_HEALTH_BONUS_PER_STACK,
  G05_DAMAGE,
  G05_RADIUS,
  G06_EXPIRY_SECONDS,
  G07_DAMAGE,
  G07_RADIUS,
  G08_COOLDOWN_REDUCTION_SECONDS,
  G08_KILLS_PER_TRIGGER,
  UpgradeEffects,
  describeUpgradeEffect,
  type UpgradeDamageTarget,
} from '../src/game/upgrade-effects';
import { UpgradeRun } from '../src/game/upgrade';

const ROOT = process.cwd();

function effectsWith(stacks: Readonly<Record<string, number>> = {}): UpgradeEffects {
  return new UpgradeEffects({ stacksOf: (upgradeId) => stacks[upgradeId] ?? 0 });
}

function target(id: string, x: number, y: number, maxHealth = 200): Combatant {
  return new Combatant({
    id,
    x,
    y,
    maxHealth,
    armor: 0,
    magicResist: 0,
  });
}

/** 通过 UpgradeRun 走正式层数上限，避免测试自己绕开叠层规则。 */
function runWith(ids: readonly string[]): UpgradeRun {
  const run = new UpgradeRun({ characterId: 'vishdal', seed: 20261019 });
  for (const id of ids) run.acquire(id);
  return run;
}

describe('G01 强袭', () => {
  it('每层 +12% 伤害，3 层封顶为 +36%', () => {
    expect(effectsWith({ G01: 1 }).damageMultiplier).toBeCloseTo(1.12, 10);
    expect(effectsWith({ G01: 2 }).damageMultiplier).toBeCloseTo(1.24, 10);

    const run = runWith(['G01', 'G01', 'G01', 'G01']);
    expect(run.stacksOf('G01')).toBe(3);
    const effects = new UpgradeEffects({ stacksOf: (id) => run.stacksOf(id) });
    expect(effects.damageMultiplier).toBeCloseTo(1 + G01_DAMAGE_BONUS_PER_STACK * 3, 10);
  });

  it('榴弹直接命中按 G01 倍率结算，参数来自强化数据', () => {
    const character = getCharacter('vishdal');
    if (!character.passive.afterimage) throw new Error('缺少残影配置');
    const grenade = new GrenadeSystem(character.attack, character.passive.afterimage);
    grenade.setDamageMultiplier(1.12);
    const enemy = target('enemy-a', 100, 100);

    const detonation = grenade.detonate({ x: 100, y: 100 }, 'enemy-a', [enemy]);
    expect(detonation.hits[0]?.damage.damage).toBeCloseTo(36 * 1.12, 10);
  });
});

describe('G02 轻装', () => {
  it('每层 +8% 移速，3 层封顶为 +24%', () => {
    expect(effectsWith({ G02: 1 }).moveSpeedMultiplier).toBeCloseTo(1.08, 10);

    const run = runWith(['G02', 'G02', 'G02', 'G02']);
    expect(run.stacksOf('G02')).toBe(3);
    const effects = new UpgradeEffects({ stacksOf: (id) => run.stacksOf(id) });
    expect(effects.moveSpeedMultiplier).toBeCloseTo(
      1 + G02_MOVE_SPEED_BONUS_PER_STACK * 3,
      10,
    );
  });

  it('PlayerMotion 按倍率移动，逻辑秒与渲染帧无关', () => {
    const layout = createArenaLayout();
    const motion = new PlayerMotion({
      layout,
      moveSpeed: 150,
      startX: layout.spawn.x,
      startY: layout.spawn.y,
    });
    motion.setMoveSpeedMultiplier(1.24);
    motion.pressKey('KeyD');
    motion.step(1);

    expect(motion.position.x).toBeCloseTo(layout.spawn.x + 150 * 1.24, 6);
    expect(motion.position.y).toBeCloseTo(layout.spawn.y, 6);
  });
});

describe('G03 蓄能', () => {
  it('每层 +8% K/L 冷却缩减，且总缩减不超过 50%', () => {
    expect(effectsWith({ G03: 1 }).cooldownReduction).toBeCloseTo(
      G03_COOLDOWN_REDUCTION_PER_STACK,
      10,
    );

    const run = runWith(['G03', 'G03', 'G03', 'G03']);
    expect(run.stacksOf('G03')).toBe(3);
    const effects = new UpgradeEffects({ stacksOf: (id) => run.stacksOf(id) });
    expect(effects.cooldownReduction).toBeCloseTo(0.24, 10);
    expect(effects.effectiveCooldown(30)).toBeCloseTo(22.8, 10);

    // 即使层数异常高于卡面上限，百分比冷却缩减仍被 50% 上限截断。
    const capped = effectsWith({ G03: 10 });
    expect(capped.cooldownReduction).toBe(COOLDOWN_REDUCTION_CAP);
    expect(capped.cooldownMultiplier).toBeCloseTo(0.5, 10);
  });

  it('魂灵与爆裂黎明的启动冷却按 G03 倍率缩短', () => {
    const marks = { mark: () => undefined, isMarked: () => false };
    const soul = new SoulSystem(
      {
        cooldownSeconds: 14,
        durationSeconds: 12,
        maxSummons: 1,
        tickSeconds: 1.5,
        markRadius: 240,
        slowPercent: 0.2,
        slowDurationSeconds: 1,
      },
      marks,
    );
    soul.setCooldownMultiplier(0.76);
    soul.trySummon({ x: 100, y: 100 });
    expect(soul.cooldownRemaining).toBeCloseTo(14 * 0.76, 10);

    const burst = new BurstSystem({
      cooldownSeconds: 30,
      shots: 6,
      damageMultiplier: 2,
      splashRadiusMultiplier: 1.5,
      fireIntervalSeconds: 1.1,
      ammoExpirySeconds: 20,
    });
    burst.setCooldownMultiplier(0.76);
    expect(burst.tryActivate()).toBe(true);
    expect(burst.cooldownRemaining).toBeCloseTo(30 * 0.76, 10);
  });
});

describe('G04 生存训练', () => {
  it('每次获取最大生命 +20 并回复 20，最多 3 层', () => {
    const effects = effectsWith({ G04: 1 });
    expect(effects.onAcquire('G04')).toEqual({
      maxHealthBonus: G04_MAX_HEALTH_BONUS_PER_STACK,
      heal: G04_HEAL_ON_ACQUIRE,
    });

    const run = runWith(['G04', 'G04', 'G04', 'G04']);
    expect(run.stacksOf('G04')).toBe(3);
    expect(
      new UpgradeEffects({ stacksOf: (id) => run.stacksOf(id) }).maxHealthBonus,
    ).toBe(G04_MAX_HEALTH_BONUS_PER_STACK * 3);
  });

  it('其他强化没有即时生命效果', () => {
    const effects = effectsWith({ G01: 1 });
    expect(effects.onAcquire('G01')).toEqual({ maxHealthBonus: 0, heal: 0 });
    expect(() => effects.onAcquire('X99')).toThrow(/Unknown upgrade id/);
  });
});

describe('G05 余烬扩散', () => {
  it('击杀后对半径 50 内造成 12 法伤，且自身倍率计入 G01', () => {
    const effects = effectsWith({ G05: 1, G01: 1 });
    const near = target('near', 49, 0);
    const edge = target('edge', 0, 50);
    const far = target('far', 51, 0);

    const explosion = effects.resolveKillExplosion(
      { x: 0, y: 0 },
      [near, edge, far],
      { allowTrigger: true },
    );

    expect(explosion).not.toBeNull();
    expect(explosion?.radius).toBe(G05_RADIUS);
    expect(explosion?.hits.map((hit) => hit.targetId)).toEqual(['near', 'edge']);
    expect(explosion?.hits[0]?.damage.damage).toBeCloseTo(G05_DAMAGE * 1.12, 10);
    expect(far.health.health).toBe(200);
  });

  it('爆炸自身的命中不可再次触发本卡', () => {
    const effects = effectsWith({ G05: 1 });
    const enemy = target('enemy', 10, 0);

    expect(
      effects.resolveKillExplosion({ x: 0, y: 0 }, [enemy], { allowTrigger: false }),
    ).toBeNull();
    expect(effects.resolveKillExplosion({ x: 0, y: 0 }, [enemy])?.hits).toHaveLength(1);
  });

  it('未拥有 G05 时不产生击杀爆炸，且爆炸不穿墙', () => {
    const enemy = target('enemy', 10, 0);
    expect(effectsWith().resolveKillExplosion({ x: 0, y: 0 }, [enemy])).toBeNull();

    const blocked = effectsWith({ G05: 1 }).resolveKillExplosion(
      { x: 0, y: 0 },
      [enemy],
      { allowTrigger: true, lineOfSight: () => false },
    );
    expect(blocked?.hits).toHaveLength(0);
    expect(enemy.health.health).toBe(200);
  });
});

describe('G06 战术回响', () => {
  it('K 生效后登记，5 秒未用失效，消耗后不可重复', () => {
    const effects = effectsWith({ G06: 1 });
    expect(effects.armTacticalEcho()).toBe(true);
    expect(effects.echoRemainingSeconds).toBe(G06_EXPIRY_SECONDS);

    effects.step(4.9);
    expect(effects.echoRemainingSeconds).toBeCloseTo(0.1, 10);
    expect(effects.consumeTacticalEcho()).toBe(true);
    expect(effects.consumeTacticalEcho()).toBe(false);

    effects.armTacticalEcho();
    effects.step(G06_EXPIRY_SECONDS);
    expect(effects.echoRemainingSeconds).toBe(0);
    expect(effects.consumeTacticalEcho()).toBe(false);
  });

  it('未拥有时不登记，未登记时不可消耗', () => {
    const effects = effectsWith();
    expect(effects.armTacticalEcho()).toBe(false);
    expect(effects.consumeTacticalEcho()).toBe(false);
  });
});

describe('G07 闪避脉冲', () => {
  it('闪避终点半径 65 内造成 20 法伤并减速 20% 持续 1 秒', () => {
    const effects = effectsWith({ G07: 1 });
    const inside = target('inside', 64, 0);
    const edge = target('edge', 65, 0);
    const outside = target('outside', 66, 0);

    const pulse = effects.resolveDodgePulse({ x: 0, y: 0 }, [inside, edge, outside]);
    expect(pulse?.radius).toBe(G07_RADIUS);
    expect(pulse?.slowRemainingSeconds).toBe(1);
    expect(pulse?.hits.map((hit) => hit.targetId)).toEqual(['inside', 'edge']);
    expect(pulse?.hits[0]?.damage.damage).toBeCloseTo(G07_DAMAGE, 10);
    expect(outside.health.health).toBe(200);

    expect(effects.isSlowed('inside')).toBe(true);
    expect(effects.slowMultiplier('inside')).toBeCloseTo(0.8, 10);
    expect(effects.slowRemaining('edge')).toBeCloseTo(1, 10);
    expect(effects.isSlowed('outside')).toBe(false);

    effects.step(0.5);
    expect(effects.slowRemaining('inside')).toBeCloseTo(0.5, 10);
    effects.step(0.5);
    expect(effects.isSlowed('inside')).toBe(false);
    expect(effects.slowMultiplier('inside')).toBe(1);
  });

  it('未拥有 G07 时不产生脉冲', () => {
    expect(effectsWith().resolveDodgePulse({ x: 0, y: 0 }, [target('a', 0, 0)])).toBeNull();
  });
});

describe('G08 极限回转', () => {
  it('K/L 冷却期间每 10 次击杀各减少剩余冷却 2 秒', () => {
    const effects = effectsWith({ G08: 1 });
    for (let index = 0; index < G08_KILLS_PER_TRIGGER - 1; index += 1) {
      expect(
        effects.registerKill({ kCooldownActive: true, lCooldownActive: true }),
      ).toEqual({ k: 0, l: 0 });
    }
    expect(
      effects.registerKill({ kCooldownActive: true, lCooldownActive: true }),
    ).toEqual({ k: G08_COOLDOWN_REDUCTION_SECONDS, l: G08_COOLDOWN_REDUCTION_SECONDS });
    expect(effects.killProgress).toEqual({ k: 0, l: 0 });
  });

  it('技能不在冷却时不计入对应进度', () => {
    const effects = effectsWith({ G08: 1 });
    for (let index = 0; index < G08_KILLS_PER_TRIGGER; index += 1) {
      expect(
        effects.registerKill({ kCooldownActive: false, lCooldownActive: true }),
      ).toEqual({ k: 0, l: index === G08_KILLS_PER_TRIGGER - 1 ? 2 : 0 });
    }
    expect(effects.killProgress).toEqual({ k: 0, l: 0 });
  });

  it('G03 百分比与 G08 返还合计不超过 50% 冷却缩减', () => {
    const effects = effectsWith({ G03: 3, G08: 1 });
    const base = 30;
    const floor = effects.cooldownFloor(base);
    expect(floor).toBeCloseTo(base * (1 - COOLDOWN_REDUCTION_CAP), 10);

    const burst = new BurstSystem({
      cooldownSeconds: base,
      shots: 6,
      damageMultiplier: 2,
      splashRadiusMultiplier: 1.5,
      fireIntervalSeconds: 1.1,
      ammoExpirySeconds: 20,
    });
    burst.setCooldownMultiplier(effects.cooldownMultiplier);
    burst.tryActivate();
    for (let index = 0; index < 10; index += 1) {
      burst.reduceCooldown(G08_COOLDOWN_REDUCTION_SECONDS, floor);
    }
    expect(burst.cooldownRemaining).toBeCloseTo(floor, 10);
    expect(base - burst.cooldownRemaining).toBeLessThanOrEqual(base * COOLDOWN_REDUCTION_CAP);
  });
});

describe('构筑面板效果摘要', () => {
  it('摘要数值与实际倍率同源', () => {
    expect(describeUpgradeEffect('G01', 2)).toBe('伤害 +24%');
    expect(describeUpgradeEffect('G02', 3)).toBe('移速 +24%');
    expect(describeUpgradeEffect('G03', 3)).toBe('K/L 冷却 -24%');
    expect(describeUpgradeEffect('G03', 10)).toBe('K/L 冷却 -50%');
    expect(describeUpgradeEffect('G04', 3)).toBe('最大生命 +60');
    expect(describeUpgradeEffect('G05', 1)).toContain('50/12');
    expect(describeUpgradeEffect('G06', 1)).toContain('5s');
    expect(describeUpgradeEffect('G07', 1)).toContain('65/20');
    expect(describeUpgradeEffect('G08', 1)).toContain('10');
    expect(describeUpgradeEffect('G01', 0)).toBe('');
    expect(describeUpgradeEffect('W01', 1)).toBe(getUpgrade('W01').description);
  });

  it('卡片参数与本模块读取的常量一致', () => {
    expect(getUpgrade('G01').params?.damageBonusPerStack).toBe(G01_DAMAGE_BONUS_PER_STACK);
    expect(getUpgrade('G02').params?.moveSpeedBonusPerStack).toBe(
      G02_MOVE_SPEED_BONUS_PER_STACK,
    );
    expect(getUpgrade('G03').params?.cooldownReductionPerStack).toBe(
      G03_COOLDOWN_REDUCTION_PER_STACK,
    );
    expect(getUpgrade('G04').params?.maxHealthBonusPerStack).toBe(
      G04_MAX_HEALTH_BONUS_PER_STACK,
    );
    expect(getUpgrade('G04').params?.healOnAcquire).toBe(G04_HEAL_ON_ACQUIRE);
  });
});

describe('场景接入', () => {
  it('竞技场场景在选卡、击杀、闪避与发射路径上接入 G01–G08', () => {
    const source = readFileSync(resolve(ROOT, 'src/game/scenes/ArenaScene.ts'), 'utf8');

    expect(source).toContain('UpgradeEffects');
    expect(source).toContain('applyAcquiredUpgrade');
    expect(source).toContain('syncBuildModifiers');
    expect(source).toContain('setDamageMultiplier');
    expect(source).toContain('setMoveSpeedMultiplier');
    expect(source).toContain('setCooldownMultiplier');
    expect(source).toContain('consumeTacticalEcho');
    expect(source).toContain('echoAttackOf');
    expect(source).toContain('triggerDodgePulse');
    expect(source).toContain('resolveKillExplosion');
    expect(source).toContain('allowKillExplosion');
    expect(source).toContain('reduceCooldown');
    expect(source).toContain('getBuildStats');
    expect(source).toContain('buildHud');
  });

  it('击杀爆炸的命中以 allowKillExplosion=false 回放，防止自触发', () => {
    const source = readFileSync(resolve(ROOT, 'src/game/scenes/ArenaScene.ts'), 'utf8');
    expect(source).toMatch(
      /for \(const hit of explosion\.hits\) \{\s*this\.showHitResult\(hit\.targetId, hit\.damage, false\);/,
    );
  });
});

describe('UpgradeDamageTarget', () => {
  it('Combatant 满足强化范围伤害接口', () => {
    const combatant: UpgradeDamageTarget = target('combatant', 0, 0);
    expect(combatant.applyDamage(10, 'magic').damage).toBe(10);
  });
});
