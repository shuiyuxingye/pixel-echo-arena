import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { SCENE_KEYS } from '../src/game/config';
import { getWave } from '../src/game/data';
import {
  DEV_PERF_DURATION_SECONDS,
  DEV_PERF_ENEMY_COUNT,
  DEV_PERF_ENEMY_PROJECTILE_COUNT,
  DEV_PERF_MANIFOLD_COUNT,
  DEV_SCENARIO_DAMAGE_TAKEN_MAX,
  DEV_SCENARIO_DAMAGE_TAKEN_MIN,
  DEV_SCENARIO_MAX_ENEMIES,
  DEV_SCENARIO_MAX_GOLD,
  DEV_SCENARIO_MAX_HEALTH_MAX,
  DEV_SCENARIO_MAX_HEALTH_MIN,
  DEV_SCENARIO_MAX_XP,
  DEV_SCENARIO_WAVE_SPEED_MAX,
  DEV_SCENARIO_WAVE_SPEED_MIN,
  DEV_SHOP_OPS_MAX,
  applyEliteOnlyToWave,
  applyScenarioToWave,
  parseDevScenario,
  resolveDevScenario,
  scenarioStartWave,
} from '../src/game/dev-scenario';
import { WaveRunner } from '../src/game/wave';
import {
  DEV_DIAGNOSTICS_GLOBAL,
  DEV_DIAGNOSTICS_MARKER,
} from '../src/game/dev-diagnostics';
import {
  DEV_ENTRY_MARKER,
  DEV_SNAPSHOT_GLOBAL,
  installDevSnapshotBridge,
  readDevSceneDiagnostics,
  readDevSnapshot,
  type DevStateSnapshot,
} from '../src/game/dev-snapshot';
import { SeededRandom, UpgradeRun } from '../src/game/upgrade';
import { UPGRADE_LIST } from '../src/game/data/upgrades';
import { UpgradeEffects } from '../src/game/upgrade-effects';

const ROOT = resolve(import.meta.dirname, '..');
const DEV_URL =
  '?dev=1&seed=20261020&character=amiya&wave=5&enemies=blob:3,spitter:2';

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[DEV_SNAPSHOT_GLOBAL];
});

function snapshotFixture(): DevStateSnapshot {
  return {
    characterId: 'amiya',
    seed: 20261020,
    phase: 'combat',
    wave: 5,
    countdownRemaining: 0,
    simulatedSeconds: 12.5,
    paused: false,
    health: { current: 90, max: 100, shield: 25, dead: false },
    player: {
      x: 640,
      y: 480,
      facing: 'east',
      moveX: 1,
      moveY: 0,
      moving: true,
      dodging: false,
    },
    combat: {
      attackHeld: true,
      attackCooldownRemaining: 0.4,
      dodgeCooldownRemaining: 0,
      skillKCooldownRemaining: 2,
      skillLCooldownRemaining: 10,
    },
    hud: {
      target: '目标 追击者 60/60',
      vitals: '生命 90/100 · 护盾 25',
      progress: '等级 3 · 经验 70/80',
      wave: '第 5 波 · 存活敌人 1 · 击杀 7',
      kills: '击杀 7',
      dodge: '闪避 就绪',
      resource: '资源 情绪吸收 2/5',
      skillDetail: '',
      skills: [
        {
          key: 'J',
          name: '源石术式',
          status: 'ready',
          statusText: '就绪',
          cooldownText: '就绪',
          text: 'J 源石术式 就绪',
        },
      ],
      viewport: {
        width: 1280,
        height: 720,
        scale: 4 / 3,
        canvasWidth: 1280,
        canvasHeight: 720,
        minCssFontSize: 16,
        fitsMinimumFont: true,
      },
    },
    level: 3,
    experience: 70,
    experienceToNextLevel: 80,
    pendingLevelUps: 0,
    kills: 7,
    damageDealt: 412,
    rewardStage: 'none',
    remainingToSpawn: 12,
    pendingSpawnCount: 1,
    enemyProjectileCount: 2,
    enemyProjectiles: [{ x: 700, y: 430, vx: -120, vy: 0, radius: 6 }],
    playerProjectileCount: 1,
    enemies: [
      {
        id: 'enemy-1',
        enemyId: 'blob',
        name: '团团怪',
        behavior: 'chase',
        activity: 'idle',
        dashX: 0,
        dashY: 0,
        x: 700,
        y: 420,
        health: 35,
        maxHealth: 35,
        shield: 0,
        alive: true,
        elite: false,
        summoned: false,
        stunned: false,
        rooted: false,
        marked: true,
      },
    ],
    souls: [{ id: 1, x: 760, y: 480, remainingSeconds: 9 }],
    summon: null,
    upgrades: [{ id: 'G01', stacks: 2 }],
    upgradeChoice: null,
  };
}

describe('开发场景参数', () => {
  it('只有 dev=1 才启用开发入口', () => {
    expect(parseDevScenario('')).toBeNull();
    expect(parseDevScenario('?seed=1&character=amiya&wave=5')).toBeNull();
    expect(parseDevScenario('?dev=0&seed=1')).toBeNull();
  });

  it('解析固定种子、角色、波次与敌人组合', () => {
    expect(parseDevScenario(DEV_URL)).toEqual({
      seed: 20261020,
      characterId: 'amiya',
      wave: 5,
      enemies: [
        { enemyId: 'blob', count: 3 },
        { enemyId: 'spitter', count: 2 },
      ],
      upgrades: null,
      hexes: null,
      xp: null,
      cores: null,
      items: null,
      skills: null,
      shopOps: null,
      shopPotion: null,
      shopSkill: null,
      craft: null,
      track: null,
      crafted: null,
      gold: null,
      maxHealth: null,
      damageTaken: null,
      waveSpeed: null,
      eliteOnly: false,
      perf: false,
      triggerDemo: false,
    });
  });

  it('非法字段单独忽略并回退默认值', () => {
    expect(
      parseDevScenario('?dev=1&seed=abc&character=unknown&wave=99&enemies=blob:0'),
    ).toEqual({
      seed: null,
      characterId: null,
      wave: null,
      enemies: null,
      upgrades: null,
      hexes: null,
      xp: null,
      cores: null,
      items: null,
      skills: null,
      shopOps: null,
      shopPotion: null,
      shopSkill: null,
      craft: null,
      track: null,
      crafted: null,
      gold: null,
      maxHealth: null,
      damageTaken: null,
      waveSpeed: null,
      eliteOnly: false,
      perf: false,
      triggerDemo: false,
    });
    expect(parseDevScenario('?dev=1&enemies=boss:1')?.enemies).toBeNull();
    expect(parseDevScenario('?dev=1&enemies=blob:61')?.enemies).toBeNull();
    expect(
      parseDevScenario(`?dev=1&enemies=blob:${DEV_SCENARIO_MAX_ENEMIES},spitter:1`)
        ?.enemies,
    ).toBeNull();
    expect(parseDevScenario('?dev=1&seed=0')?.seed).toBe(0);
  });

  it('解析预置金币；0 合法，负数/非数字/超上限回退', () => {
    expect(parseDevScenario('?dev=1&gold=300')?.gold).toBe(300);
    expect(parseDevScenario('?dev=1&gold=0')?.gold).toBe(0);
    expect(parseDevScenario('?dev=1&gold=-1')?.gold).toBeNull();
    expect(parseDevScenario('?dev=1&gold=abc')?.gold).toBeNull();
    expect(parseDevScenario(`?dev=1&gold=${DEV_SCENARIO_MAX_GOLD + 1}`)?.gold).toBeNull();
    expect(parseDevScenario(`?dev=1&gold=${DEV_SCENARIO_MAX_GOLD}`)?.gold).toBe(
      DEV_SCENARIO_MAX_GOLD,
    );
  });

  it('解析开局预置强化；重复 ID 保留用于叠层，非法 ID 整体回退', () => {
    expect(parseDevScenario('?dev=1&upgrades=W01,W02')?.upgrades).toEqual(['W01', 'W02']);
    expect(parseDevScenario('?dev=1&upgrades=G03,G03,G03,W03')?.upgrades).toEqual([
      'G03',
      'G03',
      'G03',
      'W03',
    ]);
    expect(parseDevScenario('?dev=1&upgrades=W01,unknown')?.upgrades).toBeNull();
    expect(parseDevScenario('?dev=1&upgrades=')?.upgrades).toBeNull();
    expect(parseDevScenario('?dev=1&upgrades=W03,W04')?.upgrades).toEqual(['W03', 'W04']);
  });

  it('解析开局预置海克斯；每种唯一，重复或非 H01–H48 整体回退', () => {
    expect(parseDevScenario('?dev=1&hexes=H01,H02')?.hexes).toEqual(['H01', 'H02']);
    expect(parseDevScenario('?dev=1&hexes=H03,H03')?.hexes).toBeNull();
    expect(parseDevScenario('?dev=1&hexes=H49')?.hexes).toBeNull();
    expect(parseDevScenario('?dev=1&hexes=')?.hexes).toBeNull();
  });

  it('解析预置经验；0–10000 之外回退', () => {
    expect(parseDevScenario('?dev=1&xp=50')?.xp).toBe(50);
    expect(parseDevScenario('?dev=1&xp=0')?.xp).toBe(0);
    expect(parseDevScenario('?dev=1&xp=abc')?.xp).toBeNull();
    expect(
      parseDevScenario(`?dev=1&xp=${DEV_SCENARIO_MAX_XP + 1}`)?.xp,
    ).toBeNull();
  });

  it('解析开局预置核心；重复或非 E01–E08 的 ID 整体回退', () => {
    expect(parseDevScenario('?dev=1&cores=E01,E02')?.cores).toEqual(['E01', 'E02']);
    expect(parseDevScenario('?dev=1&cores=E01,E01')?.cores).toBeNull();
    expect(parseDevScenario('?dev=1&cores=core-6')?.cores).toBeNull();
    expect(parseDevScenario('?dev=1&cores=')?.cores).toBeNull();
  });

  it('解析开局预置道具；重复 ID 可叠层到上限，未知/超上限整体回退', () => {
    expect(parseDevScenario('?dev=1&items=I01,I01,I06')?.items).toEqual([
      'I01',
      'I01',
      'I06',
    ]);
    expect(parseDevScenario('?dev=1&items=I01,I01,I01')?.items).toEqual([
      'I01',
      'I01',
      'I01',
    ]);
    expect(parseDevScenario('?dev=1&items=I01,I01,I01,I01')?.items).toBeNull();
    expect(parseDevScenario('?dev=1&items=I99')?.items).toBeNull();
    expect(parseDevScenario('?dev=1&items=')?.items).toBeNull();

    const resolution = resolveDevScenario('?dev=1&items=I01,I99');
    expect(resolution.report.devApplied.items).toBeUndefined();
    expect(resolution.report.failureReason).toContain('items=I01,I99');
  });

  it('解析商店买入/出售操作；槽位、道具 ID 与条数均校验', () => {
    expect(parseDevScenario('?dev=1&shopOps=buy:0,sell:I06')?.shopOps).toEqual([
      { kind: 'buy', target: 0 },
      { kind: 'sell', target: 'I06' },
    ]);
    expect(parseDevScenario('?dev=1&shopOps=buy:I01,sell:I01')?.shopOps).toEqual([
      { kind: 'buy', target: 'I01' },
      { kind: 'sell', target: 'I01' },
    ]);
    expect(parseDevScenario('?dev=1&shopOps=buy:4')?.shopOps).toEqual([
      { kind: 'buy', target: 4 },
    ]);
    // 药剂可按 ID 购买：P01 走常驻按钮，P03/P08 解析当手轮换药剂格。
    expect(
      parseDevScenario('?dev=1&shopOps=buy:P01,buy:P03,buy:P08')?.shopOps,
    ).toEqual([
      { kind: 'buy', target: 'P01' },
      { kind: 'buy', target: 'P03' },
      { kind: 'buy', target: 'P08' },
    ]);
    // 出售也可按槽位定位：买 0 号位后卖同一格，避免两次加载货架不同导致 ID 不匹配。
    expect(parseDevScenario('?dev=1&shopOps=buy:0,sell:0')?.shopOps).toEqual([
      { kind: 'buy', target: 0 },
      { kind: 'sell', target: 0 },
    ]);
    // R06 免费重抽取证：无参数的 `reroll` 与买入/出售混用。
    expect(parseDevScenario('?dev=1&shopOps=reroll,buy:0')?.shopOps).toEqual([
      { kind: 'reroll' },
      { kind: 'buy', target: 0 },
    ]);
    // 槽位越界、未知道具、未知操作与空参数整体回退。
    expect(parseDevScenario('?dev=1&shopOps=buy:5')?.shopOps).toBeNull();
    expect(parseDevScenario('?dev=1&shopOps=sell:5')?.shopOps).toBeNull();
    expect(parseDevScenario('?dev=1&shopOps=sell:E01')?.shopOps).toBeNull();
    expect(parseDevScenario('?dev=1&shopOps=buy:I99')?.shopOps).toBeNull();
    expect(parseDevScenario('?dev=1&shopOps=reroll:0')?.shopOps).toBeNull();
    expect(parseDevScenario('?dev=1&shopOps=')?.shopOps).toBeNull();
    const tooMany = Array.from({ length: DEV_SHOP_OPS_MAX + 1 }, () => 'sell:I01');
    expect(
      parseDevScenario(`?dev=1&shopOps=${tooMany.join(',')}`)?.shopOps,
    ).toBeNull();

    const resolution = resolveDevScenario('?dev=1&shopOps=buy:0,sell:I01');
    expect(resolution.report.devApplied.shopOps).toBe('buy:0,sell:I01');
    expect(resolution.report.failureReason).toBeNull();
  });

  it('shopPotion 只接受轮换药剂 P02–P08，P01 与其他值整体回退', () => {
    expect(parseDevScenario('?dev=1&shopPotion=P03')?.shopPotion).toBe('P03');
    expect(parseDevScenario('?dev=1&shopPotion=P02')?.shopPotion).toBe('P02');
    expect(parseDevScenario('?dev=1&shopPotion=P08')?.shopPotion).toBe('P08');
    expect(parseDevScenario('?dev=1&shopPotion=P01')).toMatchObject({
      shopPotion: null,
    });
    expect(parseDevScenario('?dev=1&shopPotion=I01')).toMatchObject({
      shopPotion: null,
    });
    const resolution = resolveDevScenario('?dev=1&shopPotion=P03');
    expect(resolution.report.devApplied.shopPotion).toBe('P03');
    expect(resolution.report.failureReason).toBeNull();
  });

  it('解析生命上限；40 与 999 为边界，越界/非整数回退', () => {
    expect(parseDevScenario(`?dev=1&maxHealth=${DEV_SCENARIO_MAX_HEALTH_MIN}`)?.maxHealth).toBe(
      DEV_SCENARIO_MAX_HEALTH_MIN,
    );
    expect(parseDevScenario(`?dev=1&maxHealth=${DEV_SCENARIO_MAX_HEALTH_MAX}`)?.maxHealth).toBe(
      DEV_SCENARIO_MAX_HEALTH_MAX,
    );
    expect(parseDevScenario('?dev=1&maxHealth=500')?.maxHealth).toBe(500);
    expect(parseDevScenario('?dev=1&maxHealth=39')?.maxHealth).toBeNull();
    expect(parseDevScenario('?dev=1&maxHealth=1000')?.maxHealth).toBeNull();
    expect(parseDevScenario('?dev=1&maxHealth=40.5')?.maxHealth).toBeNull();
    expect(parseDevScenario('?dev=1&maxHealth=abc')?.maxHealth).toBeNull();
    expect(parseDevScenario('?dev=1&maxHealth=-40')?.maxHealth).toBeNull();
    expect(parseDevScenario('?dev=1')?.maxHealth).toBeNull();
  });

  it('解析受伤倍率；1 与 100 为边界，0/101/小数回退', () => {
    expect(parseDevScenario(`?dev=1&damageTaken=${DEV_SCENARIO_DAMAGE_TAKEN_MIN}`)?.damageTaken).toBe(
      DEV_SCENARIO_DAMAGE_TAKEN_MIN,
    );
    expect(parseDevScenario(`?dev=1&damageTaken=${DEV_SCENARIO_DAMAGE_TAKEN_MAX}`)?.damageTaken).toBe(
      DEV_SCENARIO_DAMAGE_TAKEN_MAX,
    );
    expect(parseDevScenario('?dev=1&damageTaken=4')?.damageTaken).toBe(4);
    expect(parseDevScenario('?dev=1&damageTaken=0')?.damageTaken).toBeNull();
    expect(parseDevScenario('?dev=1&damageTaken=101')?.damageTaken).toBeNull();
    expect(parseDevScenario('?dev=1&damageTaken=1.5')?.damageTaken).toBeNull();
    expect(parseDevScenario('?dev=1&damageTaken=abc')?.damageTaken).toBeNull();
  });

  it('解析波内逻辑时钟倍率；1 与 10 为边界，越界/小数回退', () => {
    expect(parseDevScenario(`?dev=1&waveSpeed=${DEV_SCENARIO_WAVE_SPEED_MIN}`)?.waveSpeed).toBe(
      DEV_SCENARIO_WAVE_SPEED_MIN,
    );
    expect(parseDevScenario(`?dev=1&waveSpeed=${DEV_SCENARIO_WAVE_SPEED_MAX}`)?.waveSpeed).toBe(
      DEV_SCENARIO_WAVE_SPEED_MAX,
    );
    expect(parseDevScenario('?dev=1&waveSpeed=4')?.waveSpeed).toBe(4);
    expect(parseDevScenario('?dev=1&waveSpeed=0')?.waveSpeed).toBeNull();
    expect(parseDevScenario('?dev=1&waveSpeed=11')?.waveSpeed).toBeNull();
    expect(parseDevScenario('?dev=1&waveSpeed=2.5')?.waveSpeed).toBeNull();
  });

  it('解析仅精英开关；1 开启、0 关闭、其他写法视为非法', () => {
    expect(parseDevScenario('?dev=1&eliteOnly=1')?.eliteOnly).toBe(true);
    expect(parseDevScenario('?dev=1&eliteOnly=0')?.eliteOnly).toBe(false);
    expect(parseDevScenario('?dev=1')?.eliteOnly).toBe(false);
    expect(parseDevScenario('?dev=1&eliteOnly=2')?.eliteOnly).toBe(false);
    const resolution = resolveDevScenario('?dev=1&eliteOnly=2');
    expect(resolution.report.devApplied.eliteOnly).toBeUndefined();
    expect(resolution.report.devRequested.eliteOnly).toBe('2');
    expect(resolution.report.failureReason).toContain('eliteOnly=2');
  });

  it('请求与实际生效分开展示；非法参数回退但不静默', () => {
    const resolution = resolveDevScenario(
      '?dev=1&wave=5&maxHealth=500&damageTaken=0&waveSpeed=11&eliteOnly=1&enemies=blob:0',
    );
    expect(resolution.scenario?.wave).toBe(5);
    expect(resolution.scenario?.maxHealth).toBe(500);
    expect(resolution.scenario?.damageTaken).toBeNull();
    expect(resolution.scenario?.waveSpeed).toBeNull();
    expect(resolution.scenario?.eliteOnly).toBe(true);
    expect(resolution.scenario?.enemies).toBeNull();

    expect(resolution.report.devRequested).toEqual({
      wave: '5',
      maxHealth: '500',
      damageTaken: '0',
      waveSpeed: '11',
      eliteOnly: '1',
      enemies: 'blob:0',
    });
    expect(resolution.report.devApplied).toEqual({
      wave: 5,
      maxHealth: 500,
      eliteOnly: true,
    });

    const reason = resolution.report.failureReason;
    expect(reason).not.toBeNull();
    expect(reason).toContain('damageTaken=0');
    expect(reason).toContain('waveSpeed=11');
    expect(reason).toContain('enemies=blob:0');
  });

  it('全部参数合法时不产生失败原因，复合参数以规范化字符串生效', () => {
    const resolution = resolveDevScenario(
      '?dev=1&character=amiya&enemies=blob:3,spitter:2&upgrades=W01,W02&cores=E01&gold=0&perf=0&triggerDemo=0',
    );
    expect(resolution.report.failureReason).toBeNull();
    expect(resolution.report.devApplied).toEqual({
      character: 'amiya',
      enemies: 'blob:3,spitter:2',
      upgrades: 'W01,W02',
      cores: 'E01',
      gold: 0,
      perf: false,
      triggerDemo: false,
    });
    expect(resolution.report.devRequested.character).toBe('amiya');
  });

  it('没有 dev=1 时不解析任何参数，也不产生请求记录', () => {
    const resolution = resolveDevScenario('?maxHealth=500&damageTaken=4&waveSpeed=4');
    expect(resolution.scenario).toBeNull();
    expect(resolution.report.devRequested).toEqual({});
    expect(resolution.report.devApplied).toEqual({});
    expect(resolution.report.failureReason).toBeNull();
  });

  it('仅精英模式清空精英波普通配额，不改时长/倍率，非精英波与 Boss 波不变', () => {
    const base = getWave(6);
    const applied = applyEliteOnlyToWave(base);
    expect(applied.enemyCount).toBe(0);
    expect(applied.roster).toEqual([]);
    expect(applied.eliteCount).toBe(1);
    expect(applied.elite).toBe(base.elite);
    expect(applied.durationSeconds).toBe(base.durationSeconds);
    expect(applied.healthMultiplier).toBe(base.healthMultiplier);
    expect(applied.damageMultiplier).toBe(base.damageMultiplier);

    for (const wave of [9, 12, 15]) {
      expect(applyEliteOnlyToWave(getWave(wave)).enemyCount).toBe(0);
    }
    expect(applyEliteOnlyToWave(getWave(5))).toBe(getWave(5));
    expect(applyEliteOnlyToWave(getWave(18))).toBe(getWave(18));
  });

  it('仅精英波运行器只生成精英，击败后按清空过关', () => {
    const runner = new WaveRunner(applyEliteOnlyToWave(getWave(6)));
    const spawned = runner.step(runner.eliteSpawnTime + 0.01, {
      aliveEnemyCount: 0,
      pendingEnemyCount: 0,
    });
    expect(spawned.spawned).toHaveLength(1);
    expect(spawned.spawned[0]?.isElite).toBe(true);
    expect(spawned.spawned[0]?.enemy.elite).toBe(true);
    expect(runner.remainingToSpawn).toBe(0);

    const cleared = runner.step(1 / 60, { aliveEnemyCount: 0, pendingEnemyCount: 0 });
    expect(cleared.cleared).toBe(true);
    expect(cleared.spawned).toEqual([]);
  });

  it('解析隔离性能场景，规格为 80 敌人 / 40 弹体 / 3 流形 / 60 秒', () => {
    const scenario = parseDevScenario('?dev=1&perf=1&character=muelsyse&seed=20261020');
    expect(scenario?.perf).toBe(true);
    expect(scenario?.characterId).toBe('muelsyse');
    expect(parseDevScenario('?dev=1')?.perf).toBe(false);
    expect(parseDevScenario('?dev=1&perf=0')?.perf).toBe(false);
    expect(parseDevScenario('?dev=1&perf=1&wave=99')?.perf).toBe(true);
    expect(parseDevScenario('?dev=1&triggerDemo=1')?.triggerDemo).toBe(true);
    expect(parseDevScenario('?dev=1&triggerDemo=0')?.triggerDemo).toBe(false);
    expect(DEV_PERF_ENEMY_COUNT).toBe(80);
    expect(DEV_PERF_ENEMY_PROJECTILE_COUNT).toBe(40);
    expect(DEV_PERF_MANIFOLD_COUNT).toBe(3);
    expect(DEV_PERF_DURATION_SECONDS).toBe(60);
  });

  it('同一种子复现相同随机序列，不同种子不同', () => {
    const scenario = parseDevScenario('?dev=1&seed=987654321');
    expect(scenario?.seed).toBe(987654321);

    const first = new SeededRandom(scenario!.seed!);
    const second = new SeededRandom(scenario!.seed!);
    const firstSequence = Array.from({ length: 12 }, () => first.next());
    const secondSequence = Array.from({ length: 12 }, () => second.next());
    expect(firstSequence).toEqual(secondSequence);
    expect(new SeededRandom(987654322).next()).not.toBe(firstSequence[0]);
  });

  it('敌人组合替换起始波名册且保留波次倍率，Boss 波不被覆盖', () => {
    const groups = parseDevScenario('?dev=1&enemies=spitter:2,bulwark:1')?.enemies;
    expect(groups).not.toBeNull();

    const base = getWave(5);
    const custom = applyScenarioToWave(base, groups!);
    expect(custom.wave).toBe(5);
    expect(custom.enemyCount).toBe(3);
    expect(custom.roster).toEqual(['spitter', 'spitter', 'bulwark']);
    expect(custom.eliteCount).toBe(0);
    expect(custom.healthMultiplier).toBe(base.healthMultiplier);
    expect(custom.damageMultiplier).toBe(base.damageMultiplier);

    // 第 6 波原本有精英；开发组合以实际指定为准。
    const eliteOverride = applyScenarioToWave(getWave(6), groups!);
    expect(eliteOverride.eliteCount).toBe(0);
    expect(eliteOverride.elite).toBeUndefined();
    expect(eliteOverride.kind).toBe('normal');

    // Boss 波保持 Boss 流程。
    expect(applyScenarioToWave(getWave(18), groups!)).toBe(getWave(18));
  });

  it('未指定波次时仍从第 1 波开始', () => {
    expect(scenarioStartWave(null)).toBe(1);
    expect(scenarioStartWave(parseDevScenario('?dev=1&wave=4'))).toBe(4);
  });
});

describe('开发入口接线', () => {
  it('场景从开发参数取种子、起始波与敌人组合', () => {
    const scene = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );

    expect(scene).toContain('import.meta.env.DEV');
    expect(scene).toContain('resolveDevScenario(location.search)');
    // 生产构建不解析 dev 参数：解析调用必须位于静态 DEV 分支之后。
    expect(scene.indexOf('if (import.meta.env.DEV)')).toBeGreaterThan(-1);
    expect(scene.indexOf('if (import.meta.env.DEV)')).toBeLessThan(
      scene.indexOf('resolveDevScenario(location.search)'),
    );
    expect(scene).toContain('this.devScenarioReport = resolution.report');
    expect(scene).toContain('applyScenarioToWave(getWave(scenario.wave ?? 1), scenario.enemies)');
    expect(scene).toContain('this.devScenario?.seed ?? resolveRunSeed()');
    expect(scene).toContain('this.startWave(this.devScenario?.wave ?? 1)');
    expect(scene).toContain('this.devScenario?.upgrades');
    expect(scene).toContain('this.upgradeRun.acquire(id)');
    // 开发商店操作走与正式界面相同的购买/出售入口，并写入快照。
    expect(scene).toContain('this.runDevShopOps()');
    expect(scene).toContain('purchaseShopSlot(\n    slot: number,\n    skillSlot?: FreeSkillSlotKey,\n  ): ShopPurchaseResult | FreeSkillPurchaseResult');
    expect(scene).toContain('sellShopItem(itemId: string): ShopSellResult');
    expect(scene).toContain('isSellable: (itemId) => getShopItem(itemId) !== undefined');
    expect(scene).toContain('...(this.devShopOpsReport ? { shopOps: this.devShopOpsReport } : {})');
    expect(scene).toContain('getDevSnapshot(): DevStateSnapshot | null');
    expect(scene).toContain('private waveDefinitionFor(wave: number): WaveDefinition');
  });

  it('场景应用生命上限、受伤倍率、波速与仅精英参数并写入快照', () => {
    const scene = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );

    // 生命上限覆盖只走单一入口，升级/恢复/强化同步都不会把它改回聚合值。
    expect(scene).toContain('this.devScenario?.maxHealth ?? this.stats.maxHealth');
    expect(scene).toContain('this.playerHealth.setMaxHealth(this.effectiveMaxHealth())');
    expect(scene).toContain('this.effectiveMaxHealth()');
    // 受伤倍率在玩家承伤入口缩放，召唤物与敌人伤害不走这里。
    expect(scene).toContain('rawDamage * (this.devScenario?.damageTaken ?? 1)');
    // 波速只缩放传给 WaveRunner 的逻辑步长。
    expect(scene).toContain('stepSeconds * (this.devScenario?.waveSpeed ?? 1)');
    expect(scene).toContain('applyEliteOnlyToWave');
    // 快照暴露请求/生效对照、失败原因与波内计时。
    expect(scene).toContain('devRequested: { ...this.devScenarioReport.devRequested }');
    expect(scene).toContain('devApplied: { ...this.devScenarioReport.devApplied }');
    expect(scene).toContain('devFailureReason: this.devScenarioReport.failureReason');
    expect(scene).toContain('waveElapsedSeconds: this.waveRunner?.elapsedSeconds ?? 0');
    expect(scene).toContain('waveRemainingSeconds: this.waveRunner?.remainingSeconds ?? 0');
  });

  it('开发强化在 HUD 创建后授予，含 G04 的多强化开局不会在 create 阶段抛错', () => {
    const scenario = parseDevScenario(
      '?dev=1&character=vishdal&seed=17&wave=2&upgrades=G04',
    );
    expect(scenario).not.toBeNull();
    expect(scenario!.characterId).toBe('vishdal');
    expect(scenario!.seed).toBe(17);
    expect(scenario!.wave).toBe(2);
    expect(scenario!.upgrades).toEqual(['G04']);

    const scene = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    const grantIndex = scene.indexOf('if (this.devScenario?.upgrades)');
    const healthHudIndex = scene.indexOf('this.healthHud = this.add');
    const deathHintIndex = scene.indexOf('this.deathHint = this.add');
    const startWaveIndex = scene.indexOf('this.startWave(this.devScenario?.wave ?? 1)');

    // G04 的获取效果会走 applyAcquiredUpgrade → syncHealthHud，
    // 后者写 healthHud 与 deathHint；授予必须排在这两处 HUD 创建之后。
    expect(grantIndex).toBeGreaterThan(-1);
    expect(healthHudIndex).toBeGreaterThan(-1);
    expect(deathHintIndex).toBeGreaterThan(-1);
    expect(grantIndex).toBeGreaterThan(healthHudIndex);
    expect(grantIndex).toBeGreaterThan(deathHintIndex);
    // 授予仍发生在开局之前，快照读到的是已生效的起始强化。
    expect(grantIndex).toBeLessThan(startWaveIndex);
    expect(scene).toContain('this.deathHint.setVisible(health.isDead)');

    // 授予本身不能被跳过，也不能用 try/catch 吞掉异常。
    const grantBlock = scene.slice(
      grantIndex,
      scene.indexOf('this.runState = new RunStateMachine();', grantIndex),
    );
    expect(grantBlock).toContain('this.upgradeRun.acquire(id)');
    expect(grantBlock).toContain('this.applyAcquiredUpgrade(card)');
    expect(grantBlock).not.toContain('try {');
    expect(grantBlock).not.toContain('catch');
  });

  it('含 G04 的多张开发强化按层数累加生命上限', () => {
    const run = new UpgradeRun({ characterId: 'vishdal', seed: 17, pool: UPGRADE_LIST });
    const effects = new UpgradeEffects({
      stacksOf: (upgradeId) => run.stacksOf(upgradeId),
    });
    const bonusPerAcquire: number[] = [];
    for (const id of ['G04', 'G04', 'W01']) {
      const card = UPGRADE_LIST.find((entry) => entry.id === id);
      expect(card).toBeDefined();
      if (card!.owner !== 'general' && card!.owner !== 'vishdal') continue;
      const previousStacks = run.stacksOf(id);
      if (run.acquire(id) > previousStacks) {
        bonusPerAcquire.push(effects.onAcquire(id).maxHealthBonus);
      }
    }

    // 两次 G04 各 +20；W01 不改变生命上限。场景正是这样逐次结算获取效果。
    expect(bonusPerAcquire).toEqual([20, 20, 0]);
    expect(run.stacksOf('G04')).toBe(2);
    expect(effects.maxHealthBonus).toBe(40);
    expect(run.ownedIds().sort()).toEqual(['G04', 'W01']);
  });

  it('应用壳直接开局并安装只读快照桥', () => {
    const app = readFileSync(resolve(ROOT, 'src/app.ts'), 'utf8');

    expect(app).toContain('installDevSnapshotBridge(() => game)');
    expect(app).toContain('parseDevScenario(location.search)');
    expect(app).toContain('startRun(devScenario.characterId ?? runSessions.lastCharacterId)');
    expect(app).toContain('menu.hide()');
  });

  it('没有跳关、无敌或直接改完成状态的入口', () => {
    const scene = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    const app = readFileSync(resolve(ROOT, 'src/app.ts'), 'utf8');
    const snapshot = readFileSync(resolve(ROOT, 'src/game/dev-snapshot.ts'), 'utf8');

    for (const source of [scene, app, snapshot]) {
      expect(source).not.toContain('setInvincible');
      expect(source).not.toContain('toggleInvincible');
      expect(source).not.toContain('skipWave');
      expect(source).not.toContain('setWaveComplete');
      expect(source).not.toContain('completeRun');
    }
  });
});

describe('只读状态快照', () => {
  it('返回冻结的可序列化副本，全局属性不可写且只有读取方法', () => {
    const fakeScene = { getDevSnapshot: () => snapshotFixture() };
    const fakeGame = {
      scene: {
        getScene: (key: string) => (key === SCENE_KEYS.arena ? fakeScene : null),
      },
    };

    installDevSnapshotBridge(() => fakeGame);
    const bridge = (globalThis as Record<string, unknown>)[DEV_SNAPSHOT_GLOBAL] as {
      marker: string;
      getSnapshot: () => ReturnType<typeof snapshotFixture> & { marker: string };
      getDiagnostics: () => unknown;
    };

    expect(bridge.marker).toBe(DEV_ENTRY_MARKER);
    expect(Object.keys(bridge)).toEqual(['marker', 'getSnapshot', 'getDiagnostics']);

    const snapshot = bridge.getSnapshot();
    expect(snapshot.marker).toBe(DEV_ENTRY_MARKER);
    expect(snapshot.characterId).toBe('amiya');
    expect(snapshot.wave).toBe(5);
    expect(snapshot.health.shield).toBe(25);
    expect(snapshot.enemies[0]?.marked).toBe(true);
    // 断言代码无法通过快照改回游戏状态。
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.health)).toBe(true);
    expect(Object.isFrozen(snapshot.enemies)).toBe(true);
    expect(Object.isFrozen(snapshot.enemies[0])).toBe(true);
    expect(Object.isFrozen(snapshot.upgrades)).toBe(true);

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, DEV_SNAPSHOT_GLOBAL);
    expect(descriptor?.writable).toBe(false);
    expect(descriptor?.enumerable).toBe(false);
  });

  it('没有游戏或场景未创建时返回 null', () => {
    expect(readDevSnapshot(null)).toBeNull();
    expect(
      readDevSnapshot({ scene: { getScene: () => ({ getDevSnapshot: () => null }) } }),
    ).toBeNull();
    expect(readDevSnapshot({ scene: { getScene: () => null } })).toBeNull();
  });

  it('开发参数请求/生效对照随快照返回并被冻结', () => {
    const fixture = {
      ...snapshotFixture(),
      devRequested: { maxHealth: '500', damageTaken: '0' },
      devApplied: { maxHealth: 500, wave: 5 },
      devFailureReason: 'damageTaken=0：必须是 1–100 的整数',
      waveElapsedSeconds: 6,
      waveRemainingSeconds: 30,
    };
    const fakeScene = { getDevSnapshot: () => fixture };
    const snapshot = readDevSnapshot({
      scene: {
        getScene: (key: string) => (key === SCENE_KEYS.arena ? fakeScene : null),
      },
    });
    expect(snapshot?.devRequested).toEqual({ maxHealth: '500', damageTaken: '0' });
    expect(snapshot?.devApplied).toEqual({ maxHealth: 500, wave: 5 });
    expect(snapshot?.devFailureReason).toContain('damageTaken');
    expect(snapshot?.waveElapsedSeconds).toBe(6);
    expect(Object.isFrozen(snapshot?.devRequested)).toBe(true);
    expect(Object.isFrozen(snapshot?.devApplied)).toBe(true);
  });

  it('诊断快照只含实体与监听计数，并递归冻结', () => {
    const fakeScene = {
      getDevDiagnostics: () => ({
        displayObjects: 120,
        physicsBodies: 1,
        tweens: 4,
        timers: 2,
        activeScenes: 1,
        settingsSubscribers: 1,
        inputListeners: { keydown: 1, keyup: 1, gameBlur: 1, sceneShutdown: 1 },
        aliveEnemies: 80,
        enemyProjectiles: 40,
        manifolds: 3,
      }),
    };
    const diagnostics = readDevSceneDiagnostics({
      scene: {
        getScene: (key: string) => (key === SCENE_KEYS.arena ? fakeScene : null),
      },
    });
    expect(diagnostics?.aliveEnemies).toBe(80);
    expect(diagnostics?.enemyProjectiles).toBe(40);
    expect(diagnostics?.manifolds).toBe(3);
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(Object.isFrozen(diagnostics?.inputListeners)).toBe(true);
    expect(
      readDevSceneDiagnostics({ scene: { getScene: () => ({ getDevDiagnostics: () => null }) } }),
    ).toBeNull();
  });
});

describe('生产构建', () => {
  it('不包含开发入口标记或只读快照桥', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'pixel-echo-build-'));
    // Vitest 默认把 NODE_ENV 设为 test；Vite 据此定义 import.meta.env.DEV。
    // 临时切到 production，等价于 `npm run build` 的构建环境。
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await build({
        configFile: resolve(ROOT, 'vite.config.ts'),
        // 与 `npm run build` 一致：生产模式才会把 import.meta.env.DEV 折叠为 false。
        mode: 'production',
        logLevel: 'error',
        build: { outDir, emptyOutDir: true },
      });

      const jsFiles = readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
        .map((entry) => join(entry.parentPath, entry.name));
      expect(jsFiles.length).toBeGreaterThan(0);

      const bundle = jsFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
      // 先确认构建确实产出了游戏代码，再断言开发入口已被摇掉。
      expect(bundle).toContain(SCENE_KEYS.arena);
      expect(bundle.length).toBeGreaterThan(10_000);
      expect(bundle).not.toContain(DEV_ENTRY_MARKER);
      expect(bundle).not.toContain(DEV_SNAPSHOT_GLOBAL);
      expect(bundle).not.toContain(DEV_DIAGNOSTICS_MARKER);
      expect(bundle).not.toContain(DEV_DIAGNOSTICS_GLOBAL);
      // 开发验证参数的解析/上报只存在于开发模块：生产包不得出现请求对照与
      // 仅精英覆盖。`damageTaken`/`waveSpeed` 作为运行时倍率读出仍保留在建好的
      // 场景方法里，但 `devScenario` 在生产恒为 null，既不解析 URL 也不生效。
      expect(bundle).not.toContain('devRequested');
      expect(bundle).not.toContain('devApplied');
      expect(bundle).not.toContain('devFailureReason');
      expect(bundle).not.toContain('eliteOnly');
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 180_000);
});

describe('自由技能开发参数', () => {
  it('skills 预置最多两个不同技能，同一 ID 重复表示升级', () => {
    expect(parseDevScenario('?dev=1&skills=S06,S01,S01')?.skills).toEqual([
      { id: 'S06', level: 1 },
      { id: 'S01', level: 2 },
    ]);
    expect(parseDevScenario('?dev=1&skills=S06,S06,S06')?.skills).toEqual([
      { id: 'S06', level: 3 },
    ]);
    expect(parseDevScenario('?dev=1&skills=S06,S06,S06,S06')?.skills).toBeNull();
    expect(parseDevScenario('?dev=1&skills=S06,S01,S02')?.skills).toBeNull();
    expect(parseDevScenario('?dev=1&skills=S99')?.skills).toBeNull();
  });

  it('shopSkill 只接受 S01–S12，shopOps 支持 buy:槽位@U|I', () => {
    expect(parseDevScenario('?dev=1&shopSkill=S03')?.shopSkill).toBe('S03');
    expect(parseDevScenario('?dev=1&shopSkill=S99')?.shopSkill).toBeNull();
    expect(
      parseDevScenario('?dev=1&shopOps=buy:3@U,buy:S06@I')?.shopOps,
    ).toEqual([
      { kind: 'buy', target: 3, slot: 'U' },
      { kind: 'buy', target: 'S06', slot: 'I' },
    ]);
    expect(parseDevScenario('?dev=1&shopOps=buy:3@X')?.shopOps).toBeNull();
    expect(parseDevScenario('?dev=1&shopOps=sell:3@U')?.shopOps).toBeNull();
  });

  it('craft 只接受 R01–R06，非法值回退 null 并记录原因', () => {
    expect(parseDevScenario('?dev=1&craft=R01')?.craft).toBe('R01');
    expect(parseDevScenario('?dev=1&craft=R06')?.craft).toBe('R06');
    expect(parseDevScenario('?dev=1&craft=R99')?.craft).toBeNull();
    expect(parseDevScenario('?dev=1&craft=I01')?.craft).toBeNull();
    const resolution = resolveDevScenario('?dev=1&craft=R02');
    expect(resolution.report.devApplied.craft).toBe('R02');
    expect(resolution.scenario?.craft).toBe('R02');
  });

  it('track 只接受 R01–R06，shopOps 支持 buy:supply', () => {
    expect(parseDevScenario('?dev=1&track=R01')?.track).toBe('R01');
    expect(parseDevScenario('?dev=1&track=R99')?.track).toBeNull();
    expect(
      parseDevScenario('?dev=1&shopOps=buy:supply')?.shopOps,
    ).toEqual([{ kind: 'buy', target: 'supply' }]);
    const resolution = resolveDevScenario('?dev=1&track=R04&shopOps=buy:supply');
    expect(resolution.report.devApplied.track).toBe('R04');
    expect(resolution.report.devApplied.shopOps).toBe('buy:supply');
    expect(resolution.report.failureReason).toBeNull();
  });

  it('crafted 预置 R01–R06，重复 ID 或未知 ID 整体回退', () => {
    expect(
      parseDevScenario('?dev=1&crafted=R01,R02,R03')?.crafted,
    ).toEqual(['R01', 'R02', 'R03']);
    expect(parseDevScenario('?dev=1&crafted=R01,R01')?.crafted).toBeNull();
    expect(parseDevScenario('?dev=1&crafted=R01,R99')?.crafted).toBeNull();
    expect(parseDevScenario('?dev=1&crafted=I01')?.crafted).toBeNull();
    const resolution = resolveDevScenario('?dev=1&crafted=R02');
    expect(resolution.report.devApplied.crafted).toBe('R02');
    expect(resolution.report.failureReason).toBeNull();
  });
});
