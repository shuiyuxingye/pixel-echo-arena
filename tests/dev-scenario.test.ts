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
  DEV_SCENARIO_MAX_ENEMIES,
  applyScenarioToWave,
  parseDevScenario,
  scenarioStartWave,
} from '../src/game/dev-scenario';
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
  '?dev=1&seed=20261020&character=amiya&wave=5&enemies=chaser:3,shooter:2';

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
        enemyId: 'chaser',
        name: '追击者',
        behavior: 'chaser',
        activity: 'idle',
        dashX: 0,
        dashY: 0,
        x: 700,
        y: 420,
        health: 60,
        maxHealth: 60,
        shield: 0,
        alive: true,
        elite: false,
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
        { enemyId: 'chaser', count: 3 },
        { enemyId: 'shooter', count: 2 },
      ],
      upgrades: null,
      perf: false,
    });
  });

  it('非法字段单独忽略并回退默认值', () => {
    expect(
      parseDevScenario('?dev=1&seed=abc&character=unknown&wave=99&enemies=chaser:0'),
    ).toEqual({
      seed: null,
      characterId: null,
      wave: null,
      enemies: null,
      upgrades: null,
      perf: false,
    });
    expect(parseDevScenario('?dev=1&enemies=boss:1')?.enemies).toBeNull();
    expect(parseDevScenario('?dev=1&enemies=chaser:61')?.enemies).toBeNull();
    expect(
      parseDevScenario(`?dev=1&enemies=chaser:${DEV_SCENARIO_MAX_ENEMIES},shooter:1`)
        ?.enemies,
    ).toBeNull();
    expect(parseDevScenario('?dev=1&seed=0')?.seed).toBe(0);
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

  it('解析隔离性能场景，规格为 80 敌人 / 40 弹体 / 3 流形 / 60 秒', () => {
    const scenario = parseDevScenario('?dev=1&perf=1&character=muelsyse&seed=20261020');
    expect(scenario?.perf).toBe(true);
    expect(scenario?.characterId).toBe('muelsyse');
    expect(parseDevScenario('?dev=1')?.perf).toBe(false);
    expect(parseDevScenario('?dev=1&perf=0')?.perf).toBe(false);
    expect(parseDevScenario('?dev=1&perf=1&wave=99')?.perf).toBe(true);
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
    const groups = parseDevScenario('?dev=1&enemies=shooter:2,heavy:1')?.enemies;
    expect(groups).not.toBeNull();

    const base = getWave(5);
    const custom = applyScenarioToWave(base, groups!);
    expect(custom.wave).toBe(5);
    expect(custom.enemyCount).toBe(3);
    expect(custom.roster).toEqual(['shooter', 'shooter', 'heavy']);
    expect(custom.eliteCount).toBe(0);
    expect(custom.healthMultiplier).toBe(base.healthMultiplier);
    expect(custom.damageMultiplier).toBe(base.damageMultiplier);

    // 第 3 波原本有精英；开发组合以实际指定为准。
    expect(applyScenarioToWave(getWave(3), groups!).eliteCount).toBe(0);

    // Boss 波保持 Boss 流程。
    expect(applyScenarioToWave(getWave(9), groups!)).toBe(getWave(9));
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
    expect(scene).toContain('parseDevScenario(location.search)');
    expect(scene).toContain('applyScenarioToWave(getWave(scenario.wave ?? 1), scenario.enemies)');
    expect(scene).toContain('this.devScenario?.seed ?? resolveRunSeed()');
    expect(scene).toContain('this.startWave(this.devScenario?.wave ?? 1)');
    expect(scene).toContain('this.devScenario?.upgrades');
    expect(scene).toContain('this.upgradeRun.acquire(id)');
    expect(scene).toContain('getDevSnapshot(): DevStateSnapshot | null');
    expect(scene).toContain('private waveDefinitionFor(wave: number): WaveDefinition');
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
