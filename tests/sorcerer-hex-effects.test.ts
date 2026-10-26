import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AmiyaCombat } from '../src/game/amiya';
import { getCharacter, HEX_LIST } from '../src/game/data';
import {
  SORCERER_HEX_IDS,
  SORCERER_HEX_PARAMS,
  SORCERER_H35_ORBIT_RADIUS,
  SORCERER_H35_TICK_SECONDS,
  SorcererHexEffects,
  isSorcererHexId,
  resolveEmotionalAbsorptionHits,
  resolveSorcererChimeraDuration,
  resolveSorcererJPierce,
  resolveSorcererWeaknessSeconds,
  sorcererDoubleCastParams,
} from '../src/game/sorcerer-hex-effects';

const AMIYA = getCharacter('amiya');
const STEP = 1 / 60;
const SCENE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/game/scenes/ArenaScene.ts'),
  'utf8',
);

function createAmiyaCombat(): AmiyaCombat {
  return new AmiyaCombat({
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
  });
}

function sorcererWith(...hexIds: readonly string[]): SorcererHexEffects {
  const owned = new Set(hexIds);
  return new SorcererHexEffects({ has: (hexId) => owned.has(hexId) });
}

function runSteps(combat: AmiyaCombat, seconds: number): void {
  const steps = Math.round(seconds / STEP);
  for (let step = 0; step < steps; step += 1) {
    combat.step(STEP, 'east');
  }
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

describe('术士专属海克斯目录', () => {
  it('恰好覆盖 H31–H36 且都存在于海克斯目录', () => {
    expect(SORCERER_HEX_IDS).toEqual([
      'H31',
      'H32',
      'H33',
      'H34',
      'H35',
      'H36',
    ]);
    for (const hexId of SORCERER_HEX_IDS) {
      expect(isSorcererHexId(hexId)).toBe(true);
      expect(SORCERER_HEX_PARAMS[hexId]).toBeDefined();
      expect(HEX_LIST.some((hex) => hex.id === hexId)).toBe(true);
    }
    expect(isSorcererHexId('H30')).toBe(false);
    expect(isSorcererHexId('H37')).toBe(false);
  });

  it('六张牌都属于术士且与 02 数值一致', () => {
    for (const hexId of SORCERER_HEX_IDS) {
      const definition = HEX_LIST.find((hex) => hex.id === hexId);
      expect(definition?.owner).toBe('术士');
    }
    expect(SORCERER_HEX_PARAMS.H31).toMatchObject({
      extraPierce: 2,
      subsequentDamageRatio: 0.7,
    });
    expect(SORCERER_HEX_PARAMS.H32.hitsPerTrigger).toBe(3);
    expect(SORCERER_HEX_PARAMS.H33).toMatchObject({
      extraShots: 3,
      doubleCastDamageRatio: 0.6,
    });
    expect(SORCERER_HEX_PARAMS.H34).toMatchObject({
      chimeraDurationBonusSeconds: 3,
      weaknessBonusSeconds: 1,
    });
    expect(SORCERER_HEX_PARAMS.H35).toMatchObject({
      jHitsPerOrb: 8,
      orbDurationSeconds: 4,
      maxOrbs: 3,
      orbDamagePerSecond: 12,
    });
    expect(SORCERER_HEX_PARAMS.H36).toMatchObject({
      chimeraHitsPerBonus: 4,
      chimeraBonusDamage: 50,
      aftermathJLockSeconds: 2,
    });
    expect(SORCERER_H35_ORBIT_RADIUS).toBe(110);
    expect(SORCERER_H35_TICK_SECONDS).toBe(1);
  });
});

describe('H31 穿透术式', () => {
  it('未拥有 A01/H31 时 J 不穿透', () => {
    expect(resolveSorcererJPierce(null, false)).toBeNull();
  });

  it('H31 单独提供 2 个额外目标、后续 70% 伤害', () => {
    expect(resolveSorcererJPierce(null, true)).toEqual({
      extraTargets: 2,
      subsequentDamageRatio: 0.7,
    });
  });

  it('与 A01 同时拥有时只生效一次，不叠成 4 个目标', () => {
    const legacy = { extraTargets: 2, subsequentDamageRatio: 0.7 };
    expect(resolveSorcererJPierce(legacy, true)).toBe(legacy);
    expect(resolveSorcererJPierce(legacy, true)?.extraTargets).toBe(2);
  });
});

describe('H32 心绪共鸣', () => {
  it('基础阈值为 5，拥有 H32 后降为 3', () => {
    expect(resolveEmotionalAbsorptionHits(5, null, false)).toBe(5);
    expect(resolveEmotionalAbsorptionHits(5, null, true)).toBe(3);
  });

  it('A02 与 H32 同效果，同时拥有仍为 3', () => {
    expect(resolveEmotionalAbsorptionHits(5, 3, true)).toBe(3);
    expect(resolveEmotionalAbsorptionHits(5, 3, false)).toBe(3);
  });

  it('非法基础值回落到 5', () => {
    expect(resolveEmotionalAbsorptionHits(0, null, false)).toBe(5);
    expect(resolveEmotionalAbsorptionHits(Number.NaN, null, true)).toBe(3);
  });
});

describe('H33 双重吟唱', () => {
  it('追加 3 发、每发 60%，与 A03 同口径', () => {
    expect(sorcererDoubleCastParams()).toEqual({
      delaySeconds: 0.5,
      shots: 3,
      damageRatio: 0.6,
    });
  });

  it('K 结束后追加 3 发，且不再触发第二次疲劳', () => {
    const combat = createAmiyaCombat();
    combat.setDoubleCast(true);
    expect(combat.tryActivateK()).toBe(true);

    const shots: ReturnType<AmiyaCombat['step']>[number][] = [];
    for (let step = 0; step < Math.round(1.5 / STEP); step += 1) {
      shots.push(...combat.step(STEP, 'east'));
    }

    const burst = shots.filter((shot) => shot.source === 'burst');
    const doubleCast = shots.filter((shot) => shot.source === 'doubleCast');
    expect(burst).toHaveLength(6);
    expect(doubleCast).toHaveLength(3);
    for (const shot of doubleCast) {
      expect(shot.damage).toBeCloseTo(
        (AMIYA.skillK.params?.damagePerShot ?? 0) * 0.6,
        10,
      );
    }
    // 追加弹位于 K 结束 0.5 秒后，此时基础疲劳已走完；若二次上疲劳会回到 0.5。
    expect(combat.fatigueRemaining).toBe(0);
  });
});

describe('H34 代偿契约', () => {
  it('奇美拉持续 +3 秒、虚弱 +1 秒；与 A04 同时拥有不叠成 +6', () => {
    expect(resolveSorcererChimeraDuration(8, false, false)).toBe(8);
    expect(resolveSorcererChimeraDuration(8, false, true)).toBe(11);
    expect(resolveSorcererChimeraDuration(8, true, true)).toBe(11);
    expect(resolveSorcererWeaknessSeconds(3, false)).toBe(3);
    expect(resolveSorcererWeaknessSeconds(3, true)).toBe(4);
  });

  it('AmiyaCombat 按覆盖值结束奇美拉并进入 4 秒虚弱', () => {
    const combat = createAmiyaCombat();
    combat.setChimeraDuration(11);
    combat.setWeaknessSeconds(4);
    expect(combat.tryActivateL()).toBe(true);

    runSteps(combat, 10.9);
    expect(combat.isChimeraActive).toBe(true);
    runSteps(combat, 0.2);
    expect(combat.isChimeraActive).toBe(false);
    expect(combat.isWeaknessActive).toBe(true);
    expect(combat.weaknessRemaining).toBeGreaterThan(3.9);
  });
});

describe('H35 暗星轨道', () => {
  it('每 8 次 J 命中生成一个环绕术式', () => {
    const effects = sorcererWith('H35');
    for (let hit = 1; hit <= 7; hit += 1) {
      expect(effects.registerJHit().spawnedOrb).toBe(false);
    }
    const eighth = effects.registerJHit();
    expect(eighth.spawnedOrb).toBe(true);
    expect(eighth.hits).toBe(8);
    expect(eighth.activeOrbs).toBe(1);
    expect(effects.activeOrbCount).toBe(1);
  });

  it('最多同时存在 3 个，达到上限后继续命中不再生成', () => {
    const effects = sorcererWith('H35');
    for (let hit = 0; hit < 32; hit += 1) effects.registerJHit();
    expect(effects.activeOrbCount).toBe(3);
    expect(effects.snapshot().darkStar.orbsSpawned).toBe(3);
  });

  it('每个环绕术式每秒 12 法伤、持续 4 秒；长步长不补 tick', () => {
    const effects = sorcererWith('H35');
    for (let hit = 0; hit < 8; hit += 1) effects.registerJHit();

    const first = effects.stepOrbs(0.5);
    expect(first).toEqual({ ticks: 0, damage: 0 });
    const second = effects.stepOrbs(0.5);
    expect(second).toEqual({ ticks: 1, damage: 12 });

    // 剩余 3 秒；一次 10 秒的大步长只补到剩余时长内的 3 个 tick。
    const tail = effects.stepOrbs(10);
    expect(tail).toEqual({ ticks: 3, damage: 36 });
    expect(effects.activeOrbCount).toBe(0);
    expect(effects.snapshot().darkStar.damageDealt).toBe(48);
  });

  it('三个环绕术式同秒各结算一次（共 36）', () => {
    const effects = sorcererWith('H35');
    for (let hit = 0; hit < 24; hit += 1) effects.registerJHit();
    expect(effects.stepOrbs(1)).toEqual({ ticks: 3, damage: 36 });
  });

  it('未拥有 H35 时 J 命中不计数也不生成', () => {
    const effects = sorcererWith();
    for (let hit = 0; hit < 16; hit += 1) {
      expect(effects.registerJHit().spawnedOrb).toBe(false);
    }
    expect(effects.snapshot().darkStar.jHits).toBe(0);
    expect(effects.activeOrbCount).toBe(0);
  });

  it('波初清空环绕物与命中计数', () => {
    const effects = sorcererWith('H35');
    for (let hit = 0; hit < 8; hit += 1) effects.registerJHit();
    effects.resetForWave();
    expect(effects.activeOrbCount).toBe(0);
    expect(effects.snapshot().darkStar.jHits).toBe(0);
  });
});

describe('H36 失控奇美拉', () => {
  it('未拥有 H36 时不登记也不追加', () => {
    const effects = sorcererWith();
    for (let hit = 0; hit < 8; hit += 1) {
      expect(effects.registerChimeraHit('enemy-1')).toBe(false);
    }
    expect(effects.flushChimeraBonuses()).toEqual([]);
  });

  it('奇美拉期间每第 4 次命中追加 50 真伤并排队', () => {
    const effects = sorcererWith('H36');
    expect(effects.registerChimeraHit('enemy-1')).toBe(false);
    expect(effects.registerChimeraHit('enemy-1')).toBe(false);
    expect(effects.registerChimeraHit('enemy-2')).toBe(false);
    expect(effects.registerChimeraHit('enemy-2')).toBe(true);
    expect(effects.snapshot().runawayChimera.pendingBonuses).toBe(1);

    expect(effects.flushChimeraBonuses()).toEqual([
      { targetId: 'enemy-2', damage: 50 },
    ]);
    expect(effects.flushChimeraBonuses()).toEqual([]);
  });

  it('离开奇美拉后计数归零，下一次奇美拉重新从第 1 次算起', () => {
    const effects = sorcererWith('H36');
    effects.registerChimeraHit('enemy-1');
    effects.registerChimeraHit('enemy-1');
    effects.registerChimeraHit('enemy-1');
    effects.trackChimera(false);
    expect(effects.snapshot().runawayChimera.chimeraHits).toBe(0);

    for (let hit = 0; hit < 3; hit += 1) {
      expect(effects.registerChimeraHit('enemy-1')).toBe(false);
    }
    expect(effects.registerChimeraHit('enemy-1')).toBe(true);
  });

  it('显式传 false 时清空计数且不产生追加', () => {
    const effects = sorcererWith('H36');
    effects.registerChimeraHit('enemy-1');
    expect(effects.registerChimeraHit('enemy-1', false)).toBe(false);
    expect(effects.snapshot().runawayChimera.chimeraHits).toBe(0);
  });

  it('结束后 2 秒不能 J，且与虚弱窗口互不覆盖', () => {
    const combat = createAmiyaCombat();
    combat.setChimeraAftermathJLock(2);
    expect(combat.tryActivateL()).toBe(true);

    // 基础奇美拉 8 秒；结束后立即进入 3 秒虚弱 + 2 秒禁 J。
    runSteps(combat, 8.05);
    expect(combat.isChimeraActive).toBe(false);
    expect(combat.isWeaknessActive).toBe(true);
    expect(combat.isJFiringLocked).toBe(true);
    expect(combat.chimeraJLockRemaining).toBeGreaterThan(1.9);

    runSteps(combat, 1.9);
    expect(combat.isJFiringLocked).toBe(true);
    runSteps(combat, 0.3);
    expect(combat.isJFiringLocked).toBe(false);
  });

  it('未开启 H36 时奇美拉结束不产生禁 J', () => {
    const combat = createAmiyaCombat();
    expect(combat.tryActivateL()).toBe(true);
    runSteps(combat, 8.05);
    expect(combat.isWeaknessActive).toBe(true);
    expect(combat.isJFiringLocked).toBe(false);
  });
});

describe('术士海克斯场景接线', () => {
  it('H31/H32/H33/H34 与旧强化 A01–A04 按「或」合并', () => {
    const build = methodBody(SCENE_SOURCE, 'private syncBuildModifiers(): void');
    expect(build).toContain('resolveEmotionalAbsorptionHits');
    expect(build).toContain("this.sorcererHexes.has('H32')");
    expect(build).toContain('setDoubleCast(legacyA03 || hasH33)');
    expect(build).toContain('resolveSorcererChimeraDuration');
    expect(build).toContain('resolveSorcererWeaknessSeconds');
    expect(build).toContain('setChimeraAftermathJLock');
    // 同时拥有 A02/A03/A04 时每个 setter 只调用一次。
    expect(build.match(/setEmotionalAbsorptionHits/g)).toHaveLength(1);
    expect(build.match(/setDoubleCast/g)).toHaveLength(1);
    expect(build.match(/setChimeraDuration/g)).toHaveLength(1);

    const firing = methodBody(
      SCENE_SOURCE,
      'private updateCombat(stepSeconds: number): void',
    );
    expect(firing).toContain('resolveSorcererJPierce');
    expect(firing).toContain('amiyaJPierce');
    expect(firing).toContain("this.sorcererHexes.has('H31')");
  });

  it('H35 命中计数、环绕结算与 H36 追加真伤均已接线', () => {
    const projectiles = methodBody(SCENE_SOURCE, 'private stepProjectiles(');
    expect(projectiles).toContain('this.sorcererHexes.registerJHit()');
    expect(projectiles).toContain('this.sorcererHexes.registerChimeraHit');
    expect(projectiles).toContain("entry.source === 'K'");

    const step = methodBody(
      SCENE_SOURCE,
      'private stepSorcererHexEffects(',
    );
    expect(step).toContain('trackChimera');
    expect(step).toContain('stepOrbs');
    expect(step).toContain('flushChimeraBonuses');
    expect(step).toContain("'true'");

    const orb = methodBody(SCENE_SOURCE, 'private applySorcererOrbDamage(');
    expect(orb).toContain('SORCERER_H35_ORBIT_RADIUS');
    expect(orb).toContain('freeSkillCombatantsInRadius');
    expect(orb).toContain("'magic'");

    const reset = methodBody(
      SCENE_SOURCE,
      'private resetWaveReadyState(): void',
    );
    expect(reset).toContain('this.sorcererHexes.resetForWave()');
    expect(reset).toContain('destroySorcererOrbVisuals');
  });

  it('开发快照暴露 sorcererHexes，便于核对环绕与追加真伤', () => {
    expect(SCENE_SOURCE).toContain(
      'sorcererHexes: this.sorcererHexes.snapshot()',
    );
  });
});
