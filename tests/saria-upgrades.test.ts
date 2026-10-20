import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Combatant, HealthState } from '../src/game/combat';
import { getCharacter, getUpgrade, listUpgradesForCharacter } from '../src/game/data';
import {
  S01_HEAL_DAMAGE_RATIO,
  S01_RADIUS,
  S02_DAMAGE_PER_SECOND,
  S03_DAMAGE,
  S03_INTERNAL_COOLDOWN_SECONDS,
  S03_RADIUS,
  S04_COOLDOWN_REDUCTION_SECONDS,
  S04_HEALS_PER_TRIGGER,
  S04_PASSIVE_COOLDOWN_REDUCTION_SECONDS,
  SARIA_PASSIVE_COOLDOWN_REDUCTION_SECONDS,
  SariaCombat,
  resolveSariaAreaDamage,
  type SariaCombatConfig,
} from '../src/game/saria';
import { G05_DAMAGE, G07_DAMAGE, UpgradeEffects } from '../src/game/upgrade-effects';

const ROOT = process.cwd();
const STEP = 1 / 60;
const SARIA = getCharacter('saria');

function createSariaCombat(): SariaCombat {
  const config: SariaCombatConfig = {
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
  };
  return new SariaCombat(config);
}

function createHealth(maxHealth = SARIA.maxHealth): HealthState {
  return new HealthState({ maxHealth, armor: 0, magicResist: 0 });
}

function combatant(id: string, x: number, y: number, maxHealth = 1000): Combatant {
  return new Combatant({ id, x, y, radius: 12, maxHealth, armor: 0, magicResist: 0 });
}

function advance(
  combat: SariaCombat,
  seconds: number,
  health?: HealthState,
): { fieldDamageTicks: number; fieldHealCooldownReduction: number } {
  const steps = Math.round(seconds / STEP);
  let fieldDamageTicks = 0;
  let fieldHealCooldownReduction = 0;
  for (let step = 0; step < steps; step += 1) {
    const result = combat.step(STEP, health);
    fieldDamageTicks += result.fieldDamageTicks;
    fieldHealCooldownReduction += result.fieldHealCooldownReduction;
  }
  return { fieldDamageTicks, fieldHealCooldownReduction };
}

function effectsWith(stacks: Readonly<Record<string, number>> = {}): UpgradeEffects {
  return new UpgradeEffects({ stacksOf: (upgradeId) => stacks[upgradeId] ?? 0 });
}

describe('塞雷娅专属强化数值与卡片同源', () => {
  it('S01–S04 的常量直接读取 UPGRADE_LIST.params', () => {
    expect(S01_HEAL_DAMAGE_RATIO).toBe(getUpgrade('S01').params?.healDamageRatio);
    expect(S01_RADIUS).toBe(getUpgrade('S01').params?.radius);
    expect(S02_DAMAGE_PER_SECOND).toBe(getUpgrade('S02').params?.damagePerSecond);
    expect(S03_RADIUS).toBe(getUpgrade('S03').params?.radius);
    expect(S03_DAMAGE).toBe(getUpgrade('S03').params?.damage);
    expect(S03_INTERNAL_COOLDOWN_SECONDS).toBe(
      getUpgrade('S03').params?.internalCooldownSeconds,
    );
    expect(S04_PASSIVE_COOLDOWN_REDUCTION_SECONDS).toBe(
      getUpgrade('S04').params?.passiveCooldownReduction,
    );
    expect(S04_HEALS_PER_TRIGGER).toBe(getUpgrade('S04').params?.healsPerTrigger);
    expect(S04_COOLDOWN_REDUCTION_SECONDS).toBe(
      getUpgrade('S04').params?.cooldownReduction,
    );
  });

  it('S01–S04 只属于塞雷娅且各 1 层', () => {
    const sariaIds = listUpgradesForCharacter('saria')
      .filter((upgrade) => upgrade.owner === 'saria')
      .map((upgrade) => upgrade.id);
    expect(sariaIds).toEqual(['S01', 'S02', 'S03', 'S04']);
    for (const id of sariaIds) {
      expect(getUpgrade(id).maxStacks).toBe(1);
      expect(listUpgradesForCharacter('amiya').some((card) => card.id === id)).toBe(
        false,
      );
    }
  });
});

describe('S01 回生冲击', () => {
  it('按 K 实际治疗量的 80% 计算范围法伤，半径 100 含边界', () => {
    const combat = createSariaCombat();
    combat.setHealShock(S01_HEAL_DAMAGE_RATIO, S01_RADIUS);
    const health = createHealth();
    health.applyDamage(60, 'true');

    const result = combat.tryActivateK(health);
    expect(result?.healed).toBeCloseTo(40, 10);
    expect(result?.healShockDamage).toBeCloseTo(40 * 0.8, 10);

    const origin = { x: 100, y: 100 };
    const inside = combatant('inside', origin.x + 100, origin.y);
    const outside = combatant('outside', origin.x + 100.5, origin.y);
    const hits = resolveSariaAreaDamage(
      origin,
      combat.healShockRadius,
      result?.healShockDamage ?? 0,
      'magic',
      [inside, outside],
      { magicDamageMultiplier: () => 1 },
    );

    expect(hits.map((hit) => hit.targetId)).toEqual(['inside']);
    expect(hits[0]?.result.damage).toBeCloseTo(32, 10);
  });

  it('满血施放不产生治疗转伤害，冷却仍正常启动', () => {
    const combat = createSariaCombat();
    combat.setHealShock(S01_HEAL_DAMAGE_RATIO, S01_RADIUS);
    const health = createHealth();

    const result = combat.tryActivateK(health);
    expect(result?.healed).toBe(0);
    expect(result?.healShockDamage).toBe(0);
    expect(combat.kCooldownRemaining).toBeCloseTo(10, 10);
  });

  it('G01 与领域法伤增益各乘一次，不重复乘算', () => {
    const combat = createSariaCombat();
    combat.setHealShock(S01_HEAL_DAMAGE_RATIO, S01_RADIUS);
    const health = createHealth();
    health.applyDamage(60, 'true');
    const result = combat.tryActivateK(health);

    const target = combatant('target', 150, 100);
    const hits = resolveSariaAreaDamage(
      { x: 100, y: 100 },
      S01_RADIUS,
      result?.healShockDamage ?? 0,
      'magic',
      [target],
      { damageMultiplier: 1.12, magicDamageMultiplier: () => 1.3 },
    );
    expect(hits[0]?.result.damage).toBeCloseTo(32 * 1.12 * 1.3, 10);
  });
});

describe('S02 钙质反应', () => {
  it('领域生效期间每秒结算一次 16 法伤，8 秒共 8 次', () => {
    const combat = createSariaCombat();
    combat.setFieldDamagePerSecond(S02_DAMAGE_PER_SECOND);
    expect(combat.tryActivateL()).toBe(true);

    expect(advance(combat, 1).fieldDamageTicks).toBe(1);
    const rest = advance(combat, 7);
    expect(rest.fieldDamageTicks).toBe(7);

    // 领域结束后不再产生伤害 tick。
    expect(advance(combat, 1).fieldDamageTicks).toBe(0);
  });

  it('领域伤害享受领域法伤增益 ×1.3，未开启 S02 时为 0 次', () => {
    const target = combatant('target', 110, 100);
    const hits = resolveSariaAreaDamage(
      { x: 100, y: 100 },
      120,
      16,
      'magic',
      [target],
      { magicDamageMultiplier: () => 1.3 },
    );
    expect(hits[0]?.result.damage).toBeCloseTo(16 * 1.3, 10);

    const combat = createSariaCombat();
    expect(combat.tryActivateL()).toBe(true);
    expect(advance(combat, 3).fieldDamageTicks).toBe(0);
  });
});

describe('S03 坚盾反击', () => {
  it('护盾实际吸收伤害才触发，内置冷却 0.8 秒', () => {
    const combat = createSariaCombat();
    combat.setShieldCounter(
      true,
      S03_RADIUS,
      S03_DAMAGE,
      S03_INTERNAL_COOLDOWN_SECONDS,
    );

    expect(combat.registerShieldAbsorb(0)).toBe(false);
    expect(combat.registerShieldAbsorb(5)).toBe(true);
    expect(combat.registerShieldAbsorb(5)).toBe(false);

    combat.step(0.79);
    expect(combat.registerShieldAbsorb(5)).toBe(false);
    combat.step(0.02);
    expect(combat.registerShieldAbsorb(5)).toBe(true);
  });

  it('未拥有 S03 时任何吸收都不触发', () => {
    const combat = createSariaCombat();
    expect(combat.registerShieldAbsorb(10)).toBe(false);
  });

  it('反击为半径 85、18 物理伤害，物理伤害不读取领域法伤倍率', () => {
    const origin = { x: 100, y: 100 };
    const inside = combatant('inside', origin.x + 85, origin.y);
    const outside = combatant('outside', origin.x + 86, origin.y);
    const hits = resolveSariaAreaDamage(
      origin,
      S03_RADIUS,
      S03_DAMAGE,
      'physical',
      [inside, outside],
      { damageMultiplier: 1.12, magicDamageMultiplier: () => 1.3 },
    );

    expect(hits.map((hit) => hit.targetId)).toEqual(['inside']);
    expect(hits[0]?.result.damage).toBeCloseTo(18 * 1.12, 10);
  });
});

describe('S04 充能循环', () => {
  it('精神回复减冷却由 2 秒提升到 4 秒', () => {
    const combat = createSariaCombat();
    combat.setPassiveCooldownReduction(S04_PASSIVE_COOLDOWN_REDUCTION_SECONDS);
    const health = createHealth();
    health.applyDamage(100, 'true');

    expect(combat.tryActivateL()).toBe(true);
    const result = combat.tryActivateK(health);
    expect(result?.lCooldownReducedSeconds).toBeCloseTo(4, 10);
    expect(combat.lCooldownRemaining).toBeCloseTo(24, 10);
  });

  it('领域累计 5 次有效治疗使 K 剩余冷却减少 1 秒', () => {
    const combat = createSariaCombat();
    combat.setFieldHealChain(S04_HEALS_PER_TRIGGER, S04_COOLDOWN_REDUCTION_SECONDS);
    const health = createHealth();
    // 留出足够缺失生命，保证 5 秒领域治疗每次都有效。
    health.applyDamage(100, 'true');
    expect(combat.tryActivateK(health)).not.toBeNull();
    expect(combat.tryActivateL()).toBe(true);

    const afterFour = advance(combat, 4, health);
    expect(afterFour.fieldHealCooldownReduction).toBe(0);
    expect(combat.fieldHealProgress).toBe(4);

    const fifth = advance(combat, 1, health);
    expect(fifth.fieldHealCooldownReduction).toBeCloseTo(1, 10);
    expect(combat.fieldHealProgress).toBe(0);
    // K 冷却 10 秒 − 5 秒自然流逝 − 1 秒充能循环。
    expect(combat.kCooldownRemaining).toBeCloseTo(4, 6);
  });

  it('满血领域的治疗不计数、不刷新冷却', () => {
    const combat = createSariaCombat();
    combat.setFieldHealChain(S04_HEALS_PER_TRIGGER, S04_COOLDOWN_REDUCTION_SECONDS);
    const health = createHealth();
    expect(combat.tryActivateL()).toBe(true);

    const result = advance(combat, 5, health);
    expect(result.fieldHealCooldownReduction).toBe(0);
    expect(combat.fieldHealProgress).toBe(0);
  });

  it('重复同步同一配置不会清空已累计的治疗次数', () => {
    const combat = createSariaCombat();
    combat.setFieldHealChain(S04_HEALS_PER_TRIGGER, S04_COOLDOWN_REDUCTION_SECONDS);
    const health = createHealth();
    health.applyDamage(100, 'true');
    combat.tryActivateL();

    advance(combat, 2, health);
    expect(combat.fieldHealProgress).toBe(2);
    combat.setFieldHealChain(S04_HEALS_PER_TRIGGER, S04_COOLDOWN_REDUCTION_SECONDS);
    expect(combat.fieldHealProgress).toBe(2);
  });
});

describe('钙质领域法伤统一增伤入口', () => {
  it('G05 余烬扩散在领域内只乘一次 ×1.3', () => {
    const effects = effectsWith({ G05: 1 });
    const target = combatant('target', 110, 100);
    const result = effects.resolveKillExplosion(
      { x: 100, y: 100 },
      [target],
      { magicDamageMultiplier: () => 1.3 },
    );
    expect(result?.hits[0]?.damage.damage).toBeCloseTo(G05_DAMAGE * 1.3, 10);
  });

  it('G07 闪避脉冲在领域内只乘一次 ×1.3', () => {
    const effects = effectsWith({ G07: 1 });
    const target = combatant('target', 110, 100);
    const result = effects.resolveDodgePulse(
      { x: 100, y: 100 },
      [target],
      { magicDamageMultiplier: () => 1.3 },
    );
    expect(result?.hits[0]?.damage.damage).toBeCloseTo(G07_DAMAGE * 1.3, 10);
  });

  it('未提供领域入口时保持基础伤害，不隐式增伤', () => {
    const effects = effectsWith({ G05: 1 });
    const target = combatant('target', 110, 100);
    const result = effects.resolveKillExplosion({ x: 100, y: 100 }, [target]);
    expect(result?.hits[0]?.damage.damage).toBeCloseTo(G05_DAMAGE, 10);
  });
});

describe('塞雷娅强化场景接入', () => {
  it('场景接线 S01–S04 与统一法伤入口', () => {
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );

    expect(sceneSource).toContain('setHealShock');
    expect(sceneSource).toContain('setFieldDamagePerSecond');
    expect(sceneSource).toContain('setShieldCounter');
    expect(sceneSource).toContain('setPassiveCooldownReduction');
    expect(sceneSource).toContain('setFieldHealChain');
    expect(sceneSource).toContain('applyHealShock');
    expect(sceneSource).toContain('applyCalciumFieldDamage');
    expect(sceneSource).toContain('handleSariaShieldAbsorb');
    expect(sceneSource).toContain('resolveSariaAreaDamage');
    expect(sceneSource).toContain('enemyDamageMultiplier');
    expect(sceneSource).toContain('magicDamageMultiplier');
  });
});
