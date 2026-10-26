import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOMBER_HEX_IDS,
  BOMBER_HEX_PARAMS,
  BomberHexEffects,
  isBomberHexId,
  planH27SmallShotAngles,
  resolveBomberSoulCapacity,
} from '../src/game/bomber-hex-effects';
import { BurstSystem, type BurstConfig } from '../src/game/burst';
import { Combatant } from '../src/game/combat';
import { getCharacter, HEX_LIST } from '../src/game/data';
import { GrenadeSystem } from '../src/game/grenade';
import { SoulSystem, type SoulMarkSink } from '../src/game/soul';
import { StatAggregator, characterBaseStats } from '../src/game/stats';

const VISHDA = getCharacter('vishdal');
const AFTERIMAGE = VISHDA.passive.afterimage!;
const SCENE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/game/scenes/ArenaScene.ts'),
  'utf8',
);

function bomberWith(...hexIds: readonly string[]): BomberHexEffects {
  const owned = new Set(hexIds);
  return new BomberHexEffects({ has: (hexId) => owned.has(hexId) });
}

function grenadeSystem(): GrenadeSystem {
  return new GrenadeSystem(VISHDA.attack, AFTERIMAGE);
}

function enemy(id: string, x: number, y: number, maxHealth = 1000): Combatant {
  return new Combatant({ id, x, y, radius: 12, maxHealth, armor: 0 });
}

function burstConfig(overrides: Partial<BurstConfig> = {}): BurstConfig {
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

function markSink(): SoulMarkSink {
  const ids = new Set<string>();
  return {
    mark: (targetId) => ids.add(targetId),
    isMarked: (targetId) => ids.has(targetId),
  };
}

function soulSystem(maxSummons = 1): SoulSystem {
  return new SoulSystem(
    {
      cooldownSeconds: 5,
      durationSeconds: 100,
      maxSummons,
      tickSeconds: 1.5,
      markRadius: 240,
      slowPercent: 0.2,
      slowDurationSeconds: 1,
    },
    markSink(),
  );
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

describe('爆破手专属海克斯目录', () => {
  it('恰好覆盖 H25–H30 且都存在于海克斯目录', () => {
    expect(BOMBER_HEX_IDS).toEqual([
      'H25',
      'H26',
      'H27',
      'H28',
      'H29',
      'H30',
    ]);
    for (const hexId of BOMBER_HEX_IDS) {
      expect(isBomberHexId(hexId)).toBe(true);
      expect(BOMBER_HEX_PARAMS[hexId]).toBeDefined();
      expect(HEX_LIST.some((hex) => hex.id === hexId)).toBe(true);
    }
    expect(isBomberHexId('H24')).toBe(false);
    expect(isBomberHexId('H31')).toBe(false);
  });

  it('数值与 02 内容目录一致', () => {
    expect(BOMBER_HEX_PARAMS.H25.secondAftershockDamageRatio).toBe(0.5);
    expect(BOMBER_HEX_PARAMS.H26.markSpreadTargets).toBe(2);
    expect(BOMBER_HEX_PARAMS.H27.tripleShotEveryNth).toBe(3);
    expect(BOMBER_HEX_PARAMS.H27.tripleShotCount).toBe(2);
    expect(BOMBER_HEX_PARAMS.H27.tripleShotDamageRatio).toBe(0.25);
    expect(BOMBER_HEX_PARAMS.H28.soulCapacityBonus).toBe(1);
    expect(BOMBER_HEX_PARAMS.H29.explosionRadiusPercent).toBe(30);
    expect(BOMBER_HEX_PARAMS.H29.attackSpeedPercent).toBe(10);
    expect(BOMBER_HEX_PARAMS.H30.finaleWaveCount).toBe(3);
    expect(BOMBER_HEX_PARAMS.H30.finaleWaveDamageRatio).toBe(0.6);
  });
});

describe('H25 二次余震', () => {
  it('每发榴弹追加一次 50% 余震，H25 参数直接生效', () => {
    const grenade = grenadeSystem();
    grenade.setSecondAftershock(
      true,
      BOMBER_HEX_PARAMS.H25.secondAftershockDelaySeconds,
      BOMBER_HEX_PARAMS.H25.secondAftershockDamageRatio,
    );
    const target = enemy('target', 100, 100);

    const detonation = grenade.detonate({ x: 100, y: 100 }, 'target', [target]);
    expect(detonation.extraAftershockDelaySeconds).toBeCloseTo(0.7, 12);
    expect(grenade.pendingAftershockCount).toBe(2);

    // 0.35 秒先结算基础余震并引爆残影；0.7 秒追加余震造成 36 的 50% = 18。
    grenade.step(0.35, [target]);
    const second = grenade.step(0.35, [target]);
    expect(second).toHaveLength(1);
    expect(second[0]?.hits[0]?.damage.damage).toBeCloseTo(18, 12);
    expect(grenade.pendingAftershockCount).toBe(0);
  });

  it('关闭或未拥有时只登记基础余震', () => {
    const grenade = grenadeSystem();
    const target = enemy('target', 100, 100);
    grenade.setSecondAftershock(
      false,
      BOMBER_HEX_PARAMS.H25.secondAftershockDelaySeconds,
      BOMBER_HEX_PARAMS.H25.secondAftershockDamageRatio,
    );

    const detonation = grenade.detonate({ x: 100, y: 100 }, 'target', [target]);
    expect(detonation.extraAftershockDelaySeconds).toBeNull();
    expect(grenade.pendingAftershockCount).toBe(1);
  });
});

describe('H26 残影传染', () => {
  it('最多向 2 名邻敌扩散标记，同次爆炸不引爆新标记', () => {
    const grenade = grenadeSystem();
    grenade.setMarkSpread(true, BOMBER_HEX_PARAMS.H26.markSpreadTargets);
    const primary = enemy('primary', 100, 100);
    const near1 = enemy('near1', 120, 100);
    const near2 = enemy('near2', 130, 100);
    const near3 = enemy('near3', 140, 100);
    const far = enemy('far', 145, 100);
    const targets = [primary, near1, near2, near3, far];

    grenade.detonate({ x: 100, y: 100 }, 'primary', targets);
    const resolutions = grenade.step(0.35, targets);
    const explosion = resolutions[0]?.explosions[0];
    if (!explosion) throw new Error('缺少残影爆炸');

    expect(explosion.spreadTargetIds).toEqual(['near1', 'near2']);
    expect(grenade.isMarked('near1')).toBe(true);
    expect(grenade.isMarked('near2')).toBe(true);
    expect(grenade.isMarked('near3')).toBe(false);
    expect(grenade.isMarked('far')).toBe(false);
    // 同次爆炸只有 primary 一个引爆源，新标记留到后续余震。
    expect(resolutions[0]?.explosions).toHaveLength(1);
  });

  it('扩散上限为 2，后续步进不会产生新的爆炸链', () => {
    const grenade = grenadeSystem();
    grenade.setMarkSpread(true, BOMBER_HEX_PARAMS.H26.markSpreadTargets);
    const targets = [
      enemy('primary', 100, 100),
      enemy('near1', 120, 100),
      enemy('near2', 130, 100),
      enemy('near3', 140, 100),
    ];

    grenade.detonate({ x: 100, y: 100 }, 'primary', targets);
    grenade.step(0.35, targets);
    expect(grenade.pendingAftershockCount).toBe(0);
    const markedAfterChain = [...grenade.markedIds].sort();
    for (let step = 0; step < 120; step += 1) {
      expect(grenade.step(1 / 60, targets)).toHaveLength(0);
    }
    expect([...grenade.markedIds].sort()).toEqual(markedAfterChain);
  });
});

describe('H27 三炮齐鸣', () => {
  it('爆裂黎明每第三发触发；小弹不消耗弹药也不计入下一发', () => {
    const burst = new BurstSystem(burstConfig());
    burst.setTripleShot(
      true,
      BOMBER_HEX_PARAMS.H27.tripleShotEveryNth,
    );
    expect(burst.tryActivate()).toBe(true);

    const triggers: number[] = [];
    for (let shot = 1; shot <= 6; shot += 1) {
      expect(burst.consumeShot()).toBe(true);
      if (burst.tripleShotTriggered) triggers.push(shot);
    }
    expect(triggers).toEqual([3, 6]);
    expect(burst.ammoRemaining).toBe(0);
    // 弹药耗尽后无法再通过 consumeShot 伪造第三发。
    expect(burst.consumeShot()).toBe(false);
    expect(burst.tripleShotTriggered).toBe(false);
  });

  it('W04 的 9 发弹药在第 3/6/9 发各触发一次', () => {
    const burst = new BurstSystem(burstConfig({ shots: 9 }));
    burst.setTripleShot(true, 3);
    burst.tryActivate();

    const triggers: number[] = [];
    for (let shot = 1; shot <= 9; shot += 1) {
      burst.consumeShot();
      if (burst.tripleShotTriggered) triggers.push(shot);
    }
    expect(triggers).toEqual([3, 6, 9]);
  });

  it('每次爆裂黎明启动重新计数，关闭时不触发', () => {
    const burst = new BurstSystem(burstConfig());
    burst.setTripleShot(true, 3);
    burst.tryActivate();
    burst.consumeShot();
    burst.consumeShot();
    burst.consumeShot();
    expect(burst.tripleShotTriggered).toBe(true);

    // 冷却结束后再次启动，第一发重新从 1 开始。
    burst.step(30);
    expect(burst.tryActivate()).toBe(true);
    expect(burst.volleyShotsFired).toBe(0);
    burst.consumeShot();
    expect(burst.tripleShotTriggered).toBe(false);

    const disabled = new BurstSystem(burstConfig());
    disabled.setTripleShot(false, 3);
    disabled.tryActivate();
    for (let shot = 0; shot < 3; shot += 1) disabled.consumeShot();
    expect(disabled.tripleShotTriggered).toBe(false);
  });

  it('两枚小弹沿准星左右偏转，数量与 02 一致', () => {
    const angles = planH27SmallShotAngles();
    expect(angles).toHaveLength(2);
    expect(angles[0]).toBeCloseTo(-angles[1]!, 12);
    expect(angles[1]).toBeGreaterThan(0);
  });
});

describe('H28 魂灵游行', () => {
  it('魂灵上限 +1，并与 W03 的加成叠加', () => {
    expect(resolveBomberSoulCapacity(1, 0, false)).toBe(1);
    expect(resolveBomberSoulCapacity(1, 0, true)).toBe(2);
    expect(resolveBomberSoulCapacity(1, 1, true)).toBe(3);
    expect(resolveBomberSoulCapacity(1, 1, false)).toBe(2);

    const soul = soulSystem();
    expect(soul.trySummon({ x: 0, y: 0 })).not.toBeNull();
    soul.step(5, []);
    // 上限覆盖到 2 后，两次召唤并存而不是替换。
    soul.setMaxSummons(resolveBomberSoulCapacity(1, 0, true));
    expect(soul.trySummon({ x: 10, y: 0 })?.replacedSoulId).toBeNull();
    expect(soul.soulCount).toBe(2);
  });

  it('开启后每秒朝玩家移动，进入停止距离后不再靠近', () => {
    const soul = soulSystem();
    soul.trySummon({ x: 0, y: 0 });
    soul.setFollowPlayer(
      true,
      BOMBER_HEX_PARAMS.H28.soulFollowSpeed,
      BOMBER_HEX_PARAMS.H28.soulFollowDistance,
    );

    soul.step(1, [], { x: 200, y: 0 });
    expect(soul.snapshots[0]?.x).toBeCloseTo(60, 9);
    expect(soul.snapshots[0]?.y).toBeCloseTo(0, 9);

    // 继续走近，直到距离 40 时停下。
    for (let step = 0; step < 20; step += 1) soul.step(1, [], { x: 200, y: 0 });
    expect(soul.snapshots[0]?.x).toBeCloseTo(160, 9);
  });

  it('未开启时位置保持不变', () => {
    const soul = soulSystem();
    soul.trySummon({ x: 0, y: 0 });
    soul.setFollowPlayer(false, 60, 40);
    soul.step(1, [], { x: 200, y: 0 });
    expect(soul.snapshots[0]?.x).toBe(0);
    expect(soul.isFollowingPlayer).toBe(false);
  });
});

describe('H29 巨型装药', () => {
  it('爆炸半径 +30%、攻速倍率 0.9（间隔约 ×1.111）', () => {
    const stats = new StatAggregator(characterBaseStats(VISHDA));
    stats.setSource('hex:bomber', bomberWith().statModifiers);
    expect(stats.explosionRadiusMultiplier).toBe(1);
    expect(stats.attackSpeedMultiplier).toBe(1);

    stats.setSource('hex:bomber', bomberWith('H29').statModifiers);
    expect(stats.explosionRadiusMultiplier).toBeCloseTo(1.3, 12);
    expect(stats.attackSpeedMultiplier).toBeCloseTo(0.9, 12);
    expect(stats.attackIntervalMultiplier).toBeCloseTo(1 / 0.9, 12);
  });

  it('只提供 H29 的两条修正，不夹带其他属性', () => {
    const effects = bomberWith('H29');
    expect(effects.statModifiers).toEqual([
      { stat: 'explosionRadius', mode: 'percent', value: 0.3 },
      { stat: 'attackSpeed', mode: 'percent', value: -0.1 },
    ]);
    expect(bomberWith('H25', 'H26', 'H27', 'H28', 'H30').statModifiers).toEqual(
      [],
    );
  });
});

describe('H30 烟花谢幕', () => {
  it('最后一发命中后排队 3 次各 60% 波纹，按 0.15 秒间隔结算', () => {
    const effects = bomberWith('H30');
    expect(effects.queueFinaleWaves({ x: 100, y: 100 }, 48, 72)).toBe(true);
    expect(effects.snapshot().finale.pendingWaves).toBe(3);
    expect(effects.snapshot().finale.queues).toBe(1);

    expect(effects.stepFinaleWaves(0.14)).toHaveLength(0);
    const first = effects.stepFinaleWaves(0.01);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ index: 1, x: 100, y: 100, radius: 48 });
    expect(first[0]?.damage).toBeCloseTo(72 * 0.6, 12);

    expect(effects.stepFinaleWaves(0.15)).toHaveLength(1);
    const third = effects.stepFinaleWaves(0.15);
    expect(third).toHaveLength(1);
    expect(third[0]?.index).toBe(3);
    expect(effects.snapshot().finale.pendingWaves).toBe(0);
    expect(effects.snapshot().finale.wavesResolved).toBe(3);
  });

  it('未拥有 H30 时不排队；结算完不会自己再生成波纹', () => {
    expect(
      bomberWith().queueFinaleWaves({ x: 0, y: 0 }, 32, 36),
    ).toBe(false);
    expect(bomberWith().stepFinaleWaves(1)).toHaveLength(0);

    const effects = bomberWith('H30');
    effects.queueFinaleWaves({ x: 0, y: 0 }, 32, 36);
    for (let step = 0; step < 30; step += 1) effects.stepFinaleWaves(1 / 60);
    expect(effects.snapshot().finale.wavesResolved).toBe(3);
    expect(effects.snapshot().finale.pendingWaves).toBe(0);

    // 波纹结算之后继续步进不会产生新波纹。
    const extra = [];
    for (let step = 0; step < 120; step += 1) {
      extra.push(...effects.stepFinaleWaves(1 / 60));
    }
    expect(extra).toHaveLength(0);
    expect(effects.snapshot().finale.queues).toBe(1);
  });

  it('applyRipple 不登记爆炸次数，也不生成 I24/R02 小爆炸', () => {
    const grenade = grenadeSystem();
    grenade.setFissionPowder(true, 1, 0.5);
    grenade.setDeathExplosion(true, 0.5);
    const target = enemy('target', 100, 100, 10);

    const hits = grenade.applyRipple({ x: 100, y: 100 }, 48, 18, 'physical', [
      target,
    ]);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.damage.damage).toBeCloseTo(18, 12);
    expect(grenade.explosionCount).toBe(0);
    expect(grenade.pendingAftershockCount).toBe(0);
    // 击杀也不会产生 R02 小爆炸：applyRipple 只返回本次命中。
    expect(target.isAlive).toBe(false);
  });

  it('波初清空尚未结算的波纹，但保留本局计数', () => {
    const effects = bomberWith('H30');
    effects.queueFinaleWaves({ x: 0, y: 0 }, 32, 36);
    expect(effects.snapshot().finale.pendingWaves).toBe(3);
    effects.resetForWave();
    expect(effects.snapshot().finale.pendingWaves).toBe(0);
    expect(effects.snapshot().finale.queues).toBe(1);
    expect(effects.snapshot().finale.wavesResolved).toBe(0);
  });
});

describe('爆破手海克斯场景接线', () => {
  it('H25/H26 与旧强化按「或」合成同一个开关', () => {
    const body = methodBody(SCENE_SOURCE, 'private syncBuildModifiers(): void');
    expect(body).toContain("this.bomberHexes.has('H25')");
    expect(body).toContain('setSecondAftershock');
    expect(body).toContain("this.bomberHexes.has('H26')");
    expect(body).toContain('setMarkSpread');
    // 同时拥有 W01/H25 时仍只调用一次 setSecondAftershock。
    expect(body.match(/setSecondAftershock/g)).toHaveLength(1);
    expect(body.match(/setMarkSpread/g)).toHaveLength(1);
  });

  it('H27 第三发追加小弹，H30 最后一发排队波纹', () => {
    const firing = methodBody(SCENE_SOURCE, 'private updateCombat(stepSeconds: number): void');
    expect(firing).toContain('burst?.tripleShotTriggered');
    expect(firing).toContain('spawnH27SmallShots');
    expect(firing).toContain('this.bomberHexes.has(\'H30\')');
    expect(firing).toContain('h30Finale');

    const projectiles = methodBody(SCENE_SOURCE, 'private stepProjectiles(');
    expect(projectiles).toContain('entry.h30Finale');
    expect(projectiles).toContain('queueFinaleWaves');

    const spawn = methodBody(
      SCENE_SOURCE,
      'private spawnH27SmallShots(',
    );
    expect(spawn).toContain("derive(parent, 'H27')");
    expect(spawn).toContain('recordTripleShotTrigger');
    expect(spawn).toContain('planH27SmallShotAngles');
  });

  it('H28 上限/跟随、H29 属性来源、H30 波纹结算均已接线', () => {
    const build = methodBody(SCENE_SOURCE, 'private syncBuildModifiers(): void');
    expect(build).toContain('resolveBomberSoulCapacity');
    expect(build).toContain('setFollowPlayer');
    expect(build).toContain("this.bomberHexes.has('H28')");

    const statSources = methodBody(SCENE_SOURCE, 'private syncStatSources(): void');
    expect(statSources).toContain("this.stats.setSource('hex:bomber'");
    expect(statSources).toContain('this.bomberHexes.statModifiers');

    const ripple = methodBody(SCENE_SOURCE, 'private stepFinaleWaves(');
    expect(ripple).toContain('applyRipple');
    expect(ripple).toContain('this.bomberHexes.stepFinaleWaves');

    const reset = methodBody(SCENE_SOURCE, 'private resetWaveReadyState(): void');
    expect(reset).toContain('this.bomberHexes.resetForWave()');
  });

  it('开发快照暴露 bomberHexes，便于核对触发次数与波纹队列', () => {
    expect(SCENE_SOURCE).toContain(
      'bomberHexes: this.bomberHexes.snapshot()',
    );
  });
});
