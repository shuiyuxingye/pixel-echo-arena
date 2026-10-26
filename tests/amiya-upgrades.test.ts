import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  A01_EXTRA_PIERCE,
  A01_SUBSEQUENT_DAMAGE_RATIO,
  A02_HITS_PER_TRIGGER,
  A03_DELAY_SECONDS,
  A03_DAMAGE_RATIO,
  A03_SHOTS,
  A04_CHIMERA_DURATION_SECONDS,
  A04_WEAKNESS_SLOW_REMOVED,
  AmiyaCombat,
  EMOTIONAL_ABSORPTION_HITS,
  amiyaJPierce,
  type AmiyaBurstShot,
  type AmiyaCombatConfig,
} from '../src/game/amiya';
import {
  Combatant,
  createProjectile,
  registerProjectileHit,
  resolveProjectileHit,
} from '../src/game/combat';
import { getCharacter, getUpgrade, listUpgradesForCharacter } from '../src/game/data';

const ROOT = process.cwd();
const STEP = 1 / 60;
const AMIYA = getCharacter('amiya');

function createAmiyaCombat(): AmiyaCombat {
  const config: AmiyaCombatConfig = {
    kCooldownSeconds: AMIYA.skillK.cooldownSeconds,
    burstDurationSeconds: AMIYA.skillK.durationSeconds ?? 0,
    shots: AMIYA.skillK.params?.shots ?? 0,
    damagePerShot: AMIYA.skillK.params?.damagePerShot ?? 0,
    fatigueSeconds: AMIYA.skillK.params?.fatigueSeconds ?? 0,
    burstDamageType: AMIYA.attack.damageType,
    chimeraCooldownSeconds: AMIYA.skillL.cooldownSeconds,
    chimeraDurationSeconds: AMIYA.skillL.durationSeconds ?? 0,
    chimeraDamageBonus: AMIYA.skillL.params?.damageBonus ?? 0,
    weaknessSeconds: AMIYA.skillL.params?.weaknessSeconds ?? 0,
    weaknessMoveSpeedMultiplier:
      AMIYA.skillL.params?.weaknessMoveSpeedMultiplier ?? 1,
  };
  return new AmiyaCombat(config);
}

function enemy(id: string, x: number, y: number, maxHealth = 1000): Combatant {
  return new Combatant({ id, x, y, radius: 12, maxHealth, armor: 0 });
}

function stepFor(combat: AmiyaCombat, steps: number, facing: 'east' | 'north' = 'east'): AmiyaBurstShot[] {
  const shots: AmiyaBurstShot[] = [];
  for (let step = 0; step < steps; step += 1) {
    shots.push(...combat.step(STEP, facing));
  }
  return shots;
}

describe('A01 穿透术式', () => {
  it('J 额外穿透 2 个敌人，后续命中按 70% 结算', () => {
    const first = enemy('a', 100, 100);
    const second = enemy('b', 200, 100);
    const third = enemy('c', 300, 100);
    const projectile = createProjectile(
      1,
      { x: 0, y: 100 },
      'east',
      AMIYA.attack,
      { pierce: amiyaJPierce(1) },
    );
    expect(projectile.pierce).toEqual({
      extraTargets: A01_EXTRA_PIERCE,
      subsequentDamageRatio: A01_SUBSEQUENT_DAMAGE_RATIO,
    });
    expect(A01_EXTRA_PIERCE).toBe(2);
    expect(A01_SUBSEQUENT_DAMAGE_RATIO).toBeCloseTo(0.7, 12);

    // 第一个目标全额 20 法伤，穿透后继续飞行。
    expect(resolveProjectileHit(projectile, first).damage).toBeCloseTo(20, 12);
    expect(registerProjectileHit(projectile, 'a')).toBe(true);

    // 第二、第三个目标为后续命中，各 20 × 0.7 = 14。
    expect(resolveProjectileHit(projectile, second).damage).toBeCloseTo(14, 12);
    expect(registerProjectileHit(projectile, 'b')).toBe(true);
    expect(resolveProjectileHit(projectile, third).damage).toBeCloseTo(14, 12);
    // 额外 2 个目标用尽，这一发命中后消失。
    expect(registerProjectileHit(projectile, 'c')).toBe(false);
    expect(projectile.hitTargetIds.size).toBe(3);
  });

  it('同一发弹体不会对同一目标重复结算', () => {
    const target = enemy('a', 100, 100);
    const projectile = createProjectile(
      1,
      { x: 0, y: 100 },
      'east',
      AMIYA.attack,
      { pierce: amiyaJPierce(1) },
    );

    resolveProjectileHit(projectile, target);
    registerProjectileHit(projectile, 'a');
    expect(projectile.hitTargetIds.has('a')).toBe(true);
    // 穿透计数只随新目标增长；重复命中不额外消耗穿透次数。
    expect(projectile.hitTargetIds.size).toBe(1);
    expect(resolveProjectileHit(projectile, target).damage).toBeCloseTo(14, 12);
  });

  it('未拥有 A01 时首个命中即结束', () => {
    const projectile = createProjectile(1, { x: 0, y: 100 }, 'east', AMIYA.attack);
    expect(amiyaJPierce(0)).toBeNull();
    expect(projectile.pierce).toBeNull();
    resolveProjectileHit(projectile, enemy('a', 100, 100));
    expect(registerProjectileHit(projectile, 'a')).toBe(false);
  });
});

describe('A02 心绪共鸣', () => {
  it('默认每 5 次 J 命中触发一次情绪吸收', () => {
    const combat = createAmiyaCombat();
    expect(combat.emotionalAbsorptionThreshold).toBe(EMOTIONAL_ABSORPTION_HITS);
    expect(combat.tryActivateK()).toBe(true);

    for (let id = 1; id <= 4; id += 1) {
      expect(combat.registerJHit(id).cooldownReducedSeconds).toBe(0);
    }
    expect(combat.emotionalAbsorptionProgress).toBe(4);
    expect(combat.registerJHit(5).cooldownReducedSeconds).toBeCloseTo(1, 12);
    expect(combat.emotionalAbsorptionProgress).toBe(0);
  });

  it('A02 后每 3 次命中触发一次，且同一发弹体只累计一次', () => {
    const combat = createAmiyaCombat();
    combat.setEmotionalAbsorptionHits(A02_HITS_PER_TRIGGER);
    expect(combat.emotionalAbsorptionThreshold).toBe(3);
    expect(A02_HITS_PER_TRIGGER).toBe(3);
    expect(combat.tryActivateK()).toBe(true);

    expect(combat.registerJHit(1).cooldownReducedSeconds).toBe(0);
    expect(combat.registerJHit(2).cooldownReducedSeconds).toBe(0);
    expect(combat.registerJHit(3).cooldownReducedSeconds).toBeCloseTo(1, 12);
    expect(combat.emotionalAbsorptionProgress).toBe(0);

    // 同一发穿透命中多个敌人时场景会重复上报同一个 ID，只计一次。
    expect(combat.registerJHit(3).counted).toBe(false);
    expect(combat.emotionalAbsorptionHits).toBe(3);

    expect(combat.registerJHit(4).cooldownReducedSeconds).toBe(0);
    expect(combat.registerJHit(5).cooldownReducedSeconds).toBe(0);
    expect(combat.registerJHit(6).cooldownReducedSeconds).toBeCloseTo(1, 12);
  });
});

describe('A03 双重吟唱', () => {
  it('K 结束 0.5 秒后追加 3 发 60% 术式，且不刷新疲劳', () => {
    const combat = createAmiyaCombat();
    combat.setDoubleCast(true);
    expect(combat.tryActivateK()).toBe(true);

    const burst = stepFor(combat, 48);
    expect(burst).toHaveLength(6);
    expect(burst.every((shot) => shot.source === 'burst')).toBe(true);
    expect(combat.isBurstActive).toBe(false);
    expect(combat.fatigueRemaining).toBeCloseTo(0.5, 12);
    expect(combat.doubleCastRemainingSeconds).toBeCloseTo(A03_DELAY_SECONDS, 12);

    // 0.483 秒时追加连射尚未到达，疲劳仍在正常倒计时。
    expect(stepFor(combat, 29)).toHaveLength(0);
    expect(combat.fatigueRemaining).toBeGreaterThan(0);
    expect(combat.isJFiringLocked).toBe(true);

    // 0.5 秒整：追加 3 发，每发 14 × 0.6 = 8.4，沿发射瞬间的当前面向。
    const followup = stepFor(combat, 1, 'north');
    expect(followup).toHaveLength(A03_SHOTS);
    for (const shot of followup) {
      expect(shot.source).toBe('doubleCast');
      expect(shot.damage).toBeCloseTo(14 * A03_DAMAGE_RATIO, 12);
      expect(shot.damageType).toBe('magic');
      expect(shot.facing).toBe('north');
    }
    expect(A03_DAMAGE_RATIO).toBeCloseTo(0.6, 12);

    // 追加连射不重新进入 burst、不增加发数、不额外触发新一轮疲劳。
    expect(combat.isBurstActive).toBe(false);
    expect(combat.shotsFiredInBurst).toBe(6);
    expect(combat.isJFiringLocked).toBe(false);
    expect(combat.doubleCastRemainingSeconds).toBe(0);
    expect(combat.fatigueRemaining).toBe(0);
  });

  it('未拥有 A03 时 K 结束不追加连射', () => {
    const combat = createAmiyaCombat();
    expect(combat.tryActivateK()).toBe(true);
    expect(stepFor(combat, 48)).toHaveLength(6);
    expect(combat.doubleCastRemainingSeconds).toBe(0);
    expect(stepFor(combat, 40)).toHaveLength(0);
    expect(combat.emotionalAbsorptionHits).toBe(0);
  });
});

describe('A04 意志余辉', () => {
  it('奇美拉 8→11 秒；虚弱不减速但仍禁用 K/L，且下次启动仍保持 11 秒', () => {
    const combat = createAmiyaCombat();
    expect(combat.chimeraDurationSeconds).toBe(8);
    combat.setChimeraDuration(A04_CHIMERA_DURATION_SECONDS);
    combat.setWeaknessSlowRemoved(A04_WEAKNESS_SLOW_REMOVED);
    expect(A04_CHIMERA_DURATION_SECONDS).toBe(11);
    expect(A04_WEAKNESS_SLOW_REMOVED).toBe(true);
    expect(combat.chimeraDurationSeconds).toBe(11);

    expect(combat.tryActivateL()).toBe(true);
    expect(combat.chimeraRemaining).toBeCloseTo(11, 12);

    // 基础 8 秒后仍在奇美拉。
    stepFor(combat, 486); // 8.1 秒
    expect(combat.isChimeraActive).toBe(true);

    stepFor(combat, 174); // 累计 11 秒
    expect(combat.isChimeraActive).toBe(false);
    expect(combat.isWeaknessActive).toBe(true);
    // A04 移除减速，但 K/L 仍被虚弱禁用。
    expect(combat.moveSpeedMultiplier).toBe(1);
    expect(combat.tryActivateK()).toBe(false);
    expect(combat.tryActivateL()).toBe(false);

    // 虚弱结束后仍可行动；A04 的永久时长不会随本轮结束被还原。
    stepFor(combat, 181);
    expect(combat.isWeaknessActive).toBe(false);
    expect(combat.moveSpeedMultiplier).toBe(1);
    combat.reduceLCooldown(30);
    expect(combat.tryActivateL()).toBe(true);
    expect(combat.chimeraRemaining).toBeCloseTo(11, 12);
  });

  it('未获得 A04 时奇美拉 8 秒、虚弱减速 25%', () => {
    const combat = createAmiyaCombat();
    expect(combat.tryActivateL()).toBe(true);
    expect(combat.chimeraRemaining).toBeCloseTo(8, 12);

    stepFor(combat, 480);
    expect(combat.isChimeraActive).toBe(false);
    expect(combat.isWeaknessActive).toBe(true);
    expect(combat.moveSpeedMultiplier).toBeCloseTo(0.75, 12);
  });
});

describe('四张专属卡的角色过滤与接线', () => {
  it('A01–A04 只属于阿米娅且各 1 层', () => {
    const amiyaIds = listUpgradesForCharacter('amiya').map((card) => card.id);
    for (const id of ['A01', 'A02', 'A03', 'A04']) {
      expect(amiyaIds).toContain(id);
      const card = getUpgrade(id);
      expect(card.owner).toBe('amiya');
      expect(card.maxStacks).toBe(1);
    }

    for (const characterId of ['vishdal', 'saria', 'muelsyse'] as const) {
      const ids = listUpgradesForCharacter(characterId).map((card) => card.id);
      for (const id of ['A01', 'A02', 'A03', 'A04']) {
        expect(ids).not.toContain(id);
      }
    }
  });

  it('场景按层数推送 A02–A04 并在 J 发射时挂上 A01 穿透', () => {
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    expect(sceneSource).toContain('setEmotionalAbsorptionHits');
    expect(sceneSource).toContain('setDoubleCast');
    expect(sceneSource).toContain('setChimeraDuration');
    expect(sceneSource).toContain('setWeaknessSlowRemoved');
    expect(sceneSource).toContain('amiyaJPierce');
    expect(sceneSource).toContain('registerProjectileHit');
  });
});
