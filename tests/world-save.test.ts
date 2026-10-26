import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/game/arena';
import { AmiyaCombat } from '../src/game/amiya';
import { BurstSystem } from '../src/game/burst';
import { AttackTimer, HealthState } from '../src/game/combat';
import { getCharacter, getEnemy } from '../src/game/data';
import { EnemySystem, type EnemyPlayerTarget, type EnemyStepContext } from '../src/game/enemy';
import { GrenadeSystem, type GrenadeTarget } from '../src/game/grenade';
import { PlayerMotion } from '../src/game/movement';
import { MuelsyseCombat } from '../src/game/muelsyse';
import { PauseController } from '../src/game/pause';
import { RunStateMachine } from '../src/game/run-state';
import {
  loadRunCheckpoint,
  parseCheckpoint,
  saveRunCheckpoint,
  type RunCheckpointDraft,
} from '../src/game/run-save';
import { SariaCombat } from '../src/game/saria';
import { SoulSystem, type SoulMarkSink } from '../src/game/soul';
import { UpgradeEffects } from '../src/game/upgrade-effects';
import { scaleEnemyForWave, WaveRunner } from '../src/game/wave';
import type { RunWorldSnapshot } from '../src/game/world-snapshot';

const STEP = 1 / 60;
const LAYOUT = createArenaLayout();
const VISHDA = getCharacter('vishdal');
const AMIYA = getCharacter('amiya');
const SARIA = getCharacter('saria');
const MUELSYSE = getCharacter('muelsyse');
const AFTERIMAGE = VISHDA.passive.afterimage;
if (!AFTERIMAGE) throw new Error('维什戴尔缺少残影配置');

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  } as unknown as Storage;
}

class FakeMarks implements SoulMarkSink {
  readonly marked = new Set<string>();

  mark(targetId: string): void {
    this.marked.add(targetId);
  }

  isMarked(targetId: string): boolean {
    return this.marked.has(targetId);
  }
}

function damageTarget(id: string, x: number, y: number): GrenadeTarget & {
  readonly health: HealthState;
} {
  const health = new HealthState({ maxHealth: 500 });
  return {
    id,
    x,
    y,
    get isAlive() {
      return !health.isDead;
    },
    health,
    applyDamage: (damage, damageType) => health.applyDamage(damage, damageType),
  };
}

/** 构造一份合法的波中世界快照，供读写边界测试。 */
function worldSnapshot(
  overrides: Partial<RunWorldSnapshot> = {},
): RunWorldSnapshot {
  const chaser = scaleEnemyForWave(getEnemy('blob'), 3);
  return {
    player: { x: 720, y: 480, facing: 'northWest', dodgeCooldownSeconds: 1.25 },
    attackCooldownSeconds: 0.3,
    wave: {
      elapsedSeconds: 12,
      nextNormalIndex: 3,
      eliteSpawned: false,
      bossSpawned: false,
    },
    enemies: {
      elapsedSeconds: 12,
      contactCooldownSeconds: 0.2,
      nextUnitId: 3,
      nextTelegraphId: 4,
      nextProjectileId: 2,
      units: [
        {
          id: 'enemy-1',
          enemy: chaser,
          x: 640,
          y: 300,
          health: 41,
          shield: 0,
          activity: 'idle',
          windupRemaining: 0,
          dashRemaining: 0,
          dashX: 0,
          dashY: 0,
          attackCooldown: 0,
          chargeCooldown: 0,
          avoidSeconds: 0,
          avoidSign: 1,
        },
      ],
      telegraphs: [
        {
          id: 'telegraph-2',
          enemy: chaser,
          x: 800,
          y: 700,
          remainingSeconds: 0.4,
        },
      ],
      projectiles: [
        {
          id: 1,
          ownerId: 'enemy-2',
          damage: 10,
          damageType: 'physical',
          radius: 6,
          x: 700,
          y: 500,
          vx: 300,
          vy: 0,
          remainingRange: 300,
        },
      ],
      boss: null,
    },
    projectiles: [
      {
        id: 5,
        source: 'J',
        x: 730,
        y: 480,
        vx: 620,
        vy: 0,
        radius: 6,
        remainingRange: 200,
        attack: VISHDA.attack,
        damage: 12,
        damageType: 'physical',
        facing: 'east',
        pierce: null,
        hitTargetIds: ['enemy-1'],
      },
    ],
    nextProjectileId: 6,
    simulatedSeconds: 12,
    souls: null,
    grenade: null,
    burst: null,
    amiya: null,
    saria: null,
    muelsyse: null,
    effects: {
      echoRemainingSeconds: 0,
      elapsedSeconds: 12,
      kKillProgress: 1,
      lKillProgress: 0,
      slows: [{ targetId: 'enemy-1', remainingSeconds: 0.6 }],
    },
    ...overrides,
  };
}

describe('波中世界快照读写', () => {
  it('检查点包含世界状态时可序列化往返，形状不变', () => {
    const storage = memoryStorage();
    const world = worldSnapshot();
    const draft: RunCheckpointDraft = {
      kind: 'upgrade-options',
      characterId: 'vishdal',
      wave: 3,
      health: { current: 74, max: 100, shield: 25 },
      level: 3,
      experience: 12,
      totalExperience: 112,
      pendingLevelUps: 1,
      upgrades: [],
      rerollsRemaining: 1,
      randomState: 123456,
      hand: ['G01', 'G02', 'G03'],
      handKind: 'upgrade',
      focusIndex: 1,
      rewardStage: 'none',
      rewardPendingLevelUps: 0,
      world,
    };

    expect(saveRunCheckpoint(draft, storage)).toBe(true);
    const loaded = loadRunCheckpoint(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.checkpoint.world).toEqual(world);
    expect(loaded.checkpoint.health.shield).toBe(25);
  });

  it('非法世界状态在写入与读取边界都判为损坏', () => {
    const storage = memoryStorage();
    const broken = {
      ...worldSnapshot(),
      player: {
        x: 720,
        y: 480,
        facing: 'diagonal',
        dodgeCooldownSeconds: 0,
      },
    } as unknown as RunWorldSnapshot;

    expect(
      saveRunCheckpoint(
        {
          kind: 'upgrade-options',
          characterId: 'vishdal',
          wave: 3,
          health: { current: 74, max: 100 },
          level: 3,
          experience: 12,
          totalExperience: 112,
          pendingLevelUps: 1,
          upgrades: [],
          rerollsRemaining: 1,
          randomState: 123456,
          hand: null,
          handKind: null,
          focusIndex: 0,
          rewardStage: 'none',
          rewardPendingLevelUps: 0,
          world: broken,
        },
        storage,
      ),
    ).toBe(false);

    expect(
      parseCheckpoint({
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        kind: 'upgrade-options',
        characterId: 'vishdal',
        wave: 3,
        health: { current: 74, max: 100 },
        level: 3,
        experience: 12,
        totalExperience: 112,
        pendingLevelUps: 1,
        upgrades: [],
        rerollsRemaining: 1,
        randomState: 123456,
        hand: null,
        handKind: null,
        focusIndex: 0,
        rewardStage: 'none',
        rewardPendingLevelUps: 0,
        world: broken,
      }),
    ).toMatchObject({ status: 'corrupt' });
  });

  it('旧版检查点没有 world 字段时按无世界状态读回', () => {
    const parsed = parseCheckpoint({
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      kind: 'wave-start',
      characterId: 'vishdal',
      wave: 1,
      health: { current: 100, max: 100 },
      level: 1,
      experience: 0,
      totalExperience: 0,
      pendingLevelUps: 0,
      upgrades: [],
      rerollsRemaining: 2,
      randomState: 7,
      hand: null,
      handKind: null,
      focusIndex: 0,
      rewardStage: 'none',
      rewardPendingLevelUps: 0,
    });
    expect(parsed.status).toBe('ok');
    if (parsed.status === 'ok') expect(parsed.checkpoint.world).toBeNull();
  });
});

describe('波中实体与冷却还原', () => {
  it('玩家位置、八向面向与闪避冷却按快照恢复，恢复后可直接按面向施法', () => {
    const source = new PlayerMotion({
      layout: LAYOUT,
      moveSpeed: VISHDA.moveSpeed,
      startX: 720,
      startY: 480,
    });
    source.pressKey('KeyD');
    source.pressKey('KeyW');
    for (let step = 0; step < 30; step += 1) source.step(STEP);
    expect(source.facingDirection).toBe('northEast');
    expect(source.requestDodge()).toBe(true);
    for (let step = 0; step < 15; step += 1) source.step(STEP);
    const saved = source.snapshotWorld();

    const restored = new PlayerMotion({
      layout: LAYOUT,
      moveSpeed: VISHDA.moveSpeed,
      startX: 200,
      startY: 200,
    });
    restored.restoreWorld(saved);
    expect(restored.position.x).toBeCloseTo(saved.x, 6);
    expect(restored.position.y).toBeCloseTo(saved.y, 6);
    expect(restored.facingDirection).toBe('northEast');
    expect(restored.dodgeCooldownRemaining).toBeCloseTo(
      saved.dodgeCooldownSeconds,
      6,
    );
    // 无方向键时面向保持保存值，第一次定向施法沿该方向。
    restored.step(STEP);
    expect(restored.facingDirection).toBe('northEast');
  });

  it('波内时钟与刷怪进度恢复后不重复刷同一批敌人', () => {
    const source = new WaveRunner(3);
    for (let step = 0; step < 600; step += 1) {
      source.step(STEP, { aliveEnemyCount: 99, pendingEnemyCount: 0 });
    }
    const saved = source.snapshotWorld();
    expect(saved.nextNormalIndex).toBeGreaterThan(0);

    const restored = new WaveRunner(3);
    restored.restoreWorld(saved);
    expect(restored.elapsedSeconds).toBeCloseTo(saved.elapsedSeconds, 6);
    expect(restored.normalSpawnedCount).toBe(saved.nextNormalIndex);

    const next = restored.step(STEP, { aliveEnemyCount: 99, pendingEnemyCount: 0 });
    expect(next.spawned.length).toBeLessThanOrEqual(1);
    expect(restored.normalSpawnedCount).toBe(saved.nextNormalIndex + next.spawned.filter((s) => !s.isElite).length);
  });

  it('敌人数量、位置、生命、状态、冷却与敌弹按快照还原', () => {
    const source = new EnemySystem({ layout: LAYOUT });
    source.addEnemy(getEnemy('spitter'), 400, 480);
    const chaser = source.addEnemy(getEnemy('blob'), 600, 520);
    const target: EnemyPlayerTarget = {
      x: 750,
      y: 480,
      radius: 12,
      isInvulnerable: true,
    };
    const context: EnemyStepContext = {
      player: target,
      applyPlayerDamage: (damage, damageType) =>
        new HealthState({ maxHealth: 100 }).applyDamage(damage, damageType),
    };
    chaser.combatant.health.applyDamage(20, 'true');
    // 喷菇首发需等 1.6 秒攻击间隔 + 0.7 秒蓄力（约 138 步），推进 150 步留出余量。
    for (let step = 0; step < 150; step += 1) source.step(STEP, context);
    expect(source.projectiles.length).toBeGreaterThan(0);
    const saved = source.snapshotWorld();
    expect(saved.units).toHaveLength(2);

    const restored = new EnemySystem({ layout: LAYOUT });
    restored.restoreWorld(saved);
    expect(restored.enemies).toHaveLength(2);
    const restoredShooter = restored.enemies.find((unit) => unit.enemy.id === 'spitter');
    expect(restoredShooter?.combatant.x).toBeCloseTo(saved.units[0]?.x ?? 0, 6);
    expect(restored.projectiles.length).toBe(saved.projectiles.length);
    expect(restored.projectiles[0]?.x).toBeCloseTo(saved.projectiles[0]?.x ?? 0, 6);
    expect(restored.enemies[1]?.combatant.health.health).toBe(
      saved.units[1]?.health,
    );
    expect(restored.enemies[1]?.attackCooldown).toBe(saved.units[1]?.attackCooldown);
    // 新增敌人使用未占用的 id，避免与恢复单位冲突。
    const added = restored.addEnemy(getEnemy('blob'), 900, 480);
    expect(saved.units.some((unit) => unit.id === added.id)).toBe(false);
  });

  it('魂灵与残影标记、余震在恢复后继续按原计时推进', () => {
    const marks = new FakeMarks();
    const soul = new SoulSystem(
      {
        cooldownSeconds: 12,
        durationSeconds: 12,
        maxSummons: 1,
        tickSeconds: 1.5,
        markRadius: 240,
        slowPercent: 0.2,
        slowDurationSeconds: 1,
      },
      marks,
    );
    expect(soul.trySummon({ x: 720, y: 480 })).not.toBeNull();
    soul.step(0.5, []);
    const savedSoul = soul.snapshotWorld();
    expect(savedSoul.cooldownSeconds).toBeCloseTo(11.5, 6);
    expect(savedSoul.souls).toHaveLength(1);

    const restoredMarks = new FakeMarks();
    const restoredSoul = new SoulSystem(
      {
        cooldownSeconds: 12,
        durationSeconds: 12,
        maxSummons: 1,
        tickSeconds: 1.5,
        markRadius: 240,
        slowPercent: 0.2,
        slowDurationSeconds: 1,
      },
      restoredMarks,
    );
    restoredSoul.restoreWorld(savedSoul);
    expect(restoredSoul.soulCount).toBe(1);
    expect(restoredSoul.cooldownRemaining).toBeCloseTo(savedSoul.cooldownSeconds, 6);
    expect(restoredSoul.snapshots[0]?.remainingSeconds).toBeCloseTo(
      savedSoul.souls[0]?.remainingSeconds ?? 0,
      6,
    );

    const grenade = new GrenadeSystem(VISHDA.attack, AFTERIMAGE);
    const victim = damageTarget('enemy-1', 720, 480);
    grenade.detonate({ x: 720, y: 480 }, 'enemy-1', [victim]);
    grenade.step(0.1, [victim]);
    const savedGrenade = grenade.snapshotWorld();
    expect(savedGrenade.marks).toContain('enemy-1');
    expect(savedGrenade.pending).toHaveLength(1);

    const restoredGrenade = new GrenadeSystem(VISHDA.attack, AFTERIMAGE);
    restoredGrenade.restoreWorld(savedGrenade);
    expect(restoredGrenade.isMarked('enemy-1')).toBe(true);
    expect(restoredGrenade.pendingAftershockCount).toBe(1);
    const resolutions = restoredGrenade.step(0.3, [victim]);
    expect(resolutions).toHaveLength(1);
  });

  it('攻击计时、爆裂弹药与阿米娅 K 状态按快照还原', () => {
    const timer = new AttackTimer(1);
    timer.update(0.4, true);
    timer.update(0.4, false);
    const restoredTimer = new AttackTimer(1);
    restoredTimer.restoreCooldown(timer.cooldownRemaining);
    expect(restoredTimer.cooldownRemaining).toBeCloseTo(0.6, 6);

    const burst = new BurstSystem({
      cooldownSeconds: 30,
      shots: 6,
      damageMultiplier: 2,
      splashRadiusMultiplier: 1.5,
      fireIntervalSeconds: 1.1,
      ammoExpirySeconds: 20,
    });
    expect(burst.tryActivate()).toBe(true);
    burst.consumeShot();
    burst.step(0.5);
    const restoredBurst = new BurstSystem({
      cooldownSeconds: 30,
      shots: 6,
      damageMultiplier: 2,
      splashRadiusMultiplier: 1.5,
      fireIntervalSeconds: 1.1,
      ammoExpirySeconds: 20,
    });
    restoredBurst.restoreWorld(burst.snapshotWorld());
    expect(restoredBurst.ammoRemaining).toBe(burst.ammoRemaining);
    expect(restoredBurst.cooldownRemaining).toBeCloseTo(burst.cooldownRemaining, 6);
    expect(restoredBurst.ammoExpiresInSeconds).toBeCloseTo(
      burst.ammoExpiresInSeconds,
      6,
    );

    const skillK = AMIYA.skillK;
    const amiya = new AmiyaCombat({
      kCooldownSeconds: skillK.cooldownSeconds,
      burstDurationSeconds: skillK.durationSeconds ?? 0.8,
      shots: 6,
      damagePerShot: 14,
      fatigueSeconds: 0.5,
      chimeraCooldownSeconds: AMIYA.skillL.cooldownSeconds,
      chimeraDurationSeconds: AMIYA.skillL.durationSeconds ?? 8,
      chimeraDamageBonus: 0.6,
      weaknessSeconds: 3,
      weaknessMoveSpeedMultiplier: 0.75,
    });
    expect(amiya.tryActivateK()).toBe(true);
    amiya.step(0.2, 'southWest');
    const savedAmiya = amiya.snapshotWorld();
    const restoredAmiya = new AmiyaCombat({
      kCooldownSeconds: skillK.cooldownSeconds,
      burstDurationSeconds: skillK.durationSeconds ?? 0.8,
      shots: 6,
      damagePerShot: 14,
      fatigueSeconds: 0.5,
      chimeraCooldownSeconds: AMIYA.skillL.cooldownSeconds,
      chimeraDurationSeconds: AMIYA.skillL.durationSeconds ?? 8,
      chimeraDamageBonus: 0.6,
      weaknessSeconds: 3,
      weaknessMoveSpeedMultiplier: 0.75,
    });
    restoredAmiya.restoreWorld(savedAmiya);
    expect(restoredAmiya.kCooldownRemaining).toBeCloseTo(amiya.kCooldownRemaining, 6);
    expect(restoredAmiya.isBurstActive).toBe(amiya.isBurstActive);
    expect(restoredAmiya.shotsFiredInBurst).toBe(amiya.shotsFiredInBurst);
  });

  it('塞雷娅护盾/领域与缪尔赛思形态冷却按快照还原', () => {
    const saria = new SariaCombat({
      kCooldownSeconds: SARIA.skillK.cooldownSeconds,
      healAmount: 40,
      shieldAmount: 25,
      shieldDurationSeconds: 4,
      passiveLCooldownReductionSeconds: 2,
      lCooldownSeconds: SARIA.skillL.cooldownSeconds,
      lDurationSeconds: SARIA.skillL.durationSeconds ?? 8,
      fieldRadius: 120,
      fieldHealPerSecond: 8,
      enemySlowPercent: 0.35,
      enemyMagicVulnerability: 0.3,
      attackBonusMagicDamage: 10,
    });
    const health = new HealthState({ maxHealth: 100 });
    health.applyDamage(50, 'true');
    saria.tryActivateK(health);
    saria.tryActivateL();
    saria.step(0.5, health);
    const savedSaria = saria.snapshotWorld();
    const restoredSaria = new SariaCombat({
      kCooldownSeconds: SARIA.skillK.cooldownSeconds,
      healAmount: 40,
      shieldAmount: 25,
      shieldDurationSeconds: 4,
      passiveLCooldownReductionSeconds: 2,
      lCooldownSeconds: SARIA.skillL.cooldownSeconds,
      lDurationSeconds: SARIA.skillL.durationSeconds ?? 8,
      fieldRadius: 120,
      fieldHealPerSecond: 8,
      enemySlowPercent: 0.35,
      enemyMagicVulnerability: 0.3,
      attackBonusMagicDamage: 10,
    });
    restoredSaria.restoreWorld(savedSaria);
    expect(restoredSaria.kCooldownRemaining).toBeCloseTo(saria.kCooldownRemaining, 6);
    expect(restoredSaria.lCooldownRemaining).toBeCloseTo(saria.lCooldownRemaining, 6);
    expect(restoredSaria.calciumFieldRemaining).toBeCloseTo(
      saria.calciumFieldRemaining,
      6,
    );
    expect(restoredSaria.shieldRemaining).toBeCloseTo(saria.shieldRemaining, 6);

    const muelsyse = new MuelsyseCombat({
      switchCooldownSeconds: MUELSYSE.skillK.cooldownSeconds,
      melee: {
        maxHealth: 90,
        attackRange: 90,
        attackIntervalSeconds: 0.7,
        damage: 16,
        damageType: 'physical',
        stackDamagePerHit: 2,
        stackArmorPerHit: 2,
        maxStacks: 5,
      },
      ranged: {
        maxHealth: 60,
        attackRange: 230,
        attackIntervalSeconds: 0.8,
        damage: 14,
        damageType: 'magic',
      },
      copies: {
        everyAttacks: 8,
        durationSeconds: 5,
        damageRatio: 0.5,
        maxCopies: 1,
      },
      shallowAdaptation: {
        cooldownSeconds: MUELSYSE.skillL.cooldownSeconds,
        durationSeconds: 6,
        pullIntervalSeconds: 2,
        pullRadius: 100,
        pullDistance: 35,
        stunSeconds: 0.5,
        rootSeconds: 0.5,
      },
      layout: LAYOUT,
      startX: 720,
      startY: 480,
    });
    muelsyse.tryActivateK({ x: 720, y: 480 });
    muelsyse.tryActivateL();
    muelsyse.step(0.4, { player: { x: 720, y: 480 }, targets: [] });
    const savedMuelsyse = muelsyse.snapshotWorld();
    const restoredMuelsyse = new MuelsyseCombat({
      switchCooldownSeconds: MUELSYSE.skillK.cooldownSeconds,
      melee: {
        maxHealth: 90,
        attackRange: 90,
        attackIntervalSeconds: 0.7,
        damage: 16,
        damageType: 'physical',
        stackDamagePerHit: 2,
        stackArmorPerHit: 2,
        maxStacks: 5,
      },
      ranged: {
        maxHealth: 60,
        attackRange: 230,
        attackIntervalSeconds: 0.8,
        damage: 14,
        damageType: 'magic',
      },
      copies: {
        everyAttacks: 8,
        durationSeconds: 5,
        damageRatio: 0.5,
        maxCopies: 1,
      },
      shallowAdaptation: {
        cooldownSeconds: MUELSYSE.skillL.cooldownSeconds,
        durationSeconds: 6,
        pullIntervalSeconds: 2,
        pullRadius: 100,
        pullDistance: 35,
        stunSeconds: 0.5,
        rootSeconds: 0.5,
      },
      layout: LAYOUT,
      startX: 100,
      startY: 100,
    });
    restoredMuelsyse.restoreWorld(savedMuelsyse);
    expect(restoredMuelsyse.form).toBe(muelsyse.form);
    expect(restoredMuelsyse.formPosition.x).toBeCloseTo(
      muelsyse.formPosition.x,
      6,
    );
    expect(restoredMuelsyse.kCooldownRemaining).toBeCloseTo(
      muelsyse.kCooldownRemaining,
      6,
    );
    expect(restoredMuelsyse.shallowAdaptationRemaining).toBeCloseTo(
      muelsyse.shallowAdaptationRemaining,
      6,
    );
  });

  it('G07 减速等持续效果按剩余秒数恢复', () => {
    const effects = new UpgradeEffects({ stacksOf: (id) => (id === 'G07' ? 1 : 0) });
    const target = damageTarget('enemy-1', 725, 480);
    effects.resolveDodgePulse({ x: 720, y: 480 }, [target]);
    effects.step(0.5);
    const saved = effects.snapshotWorld();
    expect(saved.slows[0]?.remainingSeconds).toBeGreaterThan(0);

    const restored = new UpgradeEffects({ stacksOf: (id) => (id === 'G07' ? 1 : 0) });
    restored.restoreWorld(saved);
    expect(restored.slowRemaining('enemy-1')).toBeCloseTo(
      effects.slowRemaining('enemy-1'),
      6,
    );
    expect(restored.isSlowed('enemy-1')).toBe(true);
  });
});

describe('恢复后保持暂停与场景接入', () => {
  it('状态机可从选角直接恢复到战斗；恢复暂停只接受 Enter', () => {
    const state = new RunStateMachine();
    state.enterCharacterSelect();
    expect(state.restoreCombat()).toBe('combat');

    const controller = new PauseController();
    expect(controller.pause('checkpoint')).toBe(true);
    expect(controller.canResume('escape')).toBe(false);
    expect(controller.resume('escape')).toBe(false);
    expect(controller.resume('enter')).toBe(true);
  });

  it('场景在波中检查点收集并恢复世界状态，恢复后请求暂停', () => {
    const scene = readFileSync(
      resolve(process.cwd(), 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    expect(scene).toContain('collectWorldSnapshot');
    expect(scene).toContain('restoreWorldState');
    expect(scene).toContain('restoreWorld');
    expect(scene).toContain('restoreCombat');
    expect(scene).toContain("requestPause('checkpoint')");
    expect(scene).toContain('world:');
    expect(scene).toContain('hitTargetIds');
  });
});
