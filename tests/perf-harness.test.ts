import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEV_DIAGNOSTICS_GLOBAL,
  DEV_DIAGNOSTICS_MARKER,
  createDomListenerRegistry,
  summarizeFpsSample,
} from '../src/game/dev-diagnostics';
import {
  DEV_SCENARIO_MAX_ENEMIES,
  parseDevScenario,
} from '../src/game/dev-scenario';
import {
  installPhaserVisibilityReaper,
  releasePhaserMouseWheel,
} from '../src/game/phaser-lifecycle';

const ROOT = resolve(import.meta.dirname, '..');
const SCENE_SOURCE = readFileSync(
  resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
  'utf8',
);
const APP_SOURCE = readFileSync(resolve(ROOT, 'src/app.ts'), 'utf8');
const SNAPSHOT_SOURCE = readFileSync(resolve(ROOT, 'src/game/dev-snapshot.ts'), 'utf8');
const PERF_SCRIPT = readFileSync(resolve(ROOT, 'tools/perf/perf-check.mjs'), 'utf8');
const DEMO_SCRIPT = readFileSync(resolve(ROOT, 'docs/演示流程脚本.md'), 'utf8');
const ASSET_SOURCES = readFileSync(resolve(ROOT, 'docs/素材来源说明.md'), 'utf8');
const README = readFileSync(resolve(ROOT, 'README.md'), 'utf8');

describe('性能采样摘要', () => {
  it('按实际采样秒数计算平均 FPS，并给出每秒最小/最大值', () => {
    const sample = summarizeFpsSample({
      running: false,
      targetSeconds: 60,
      elapsedMs: 60_000,
      frames: 3_600,
      perSecond: [60, 58, 62, 55],
      visibility: 'visible',
    });
    expect(sample.averageFps).toBeCloseTo(60, 5);
    expect(sample.minSecondFps).toBe(55);
    expect(sample.maxSecondFps).toBe(62);
    expect(sample.perSecond).toEqual([60, 58, 62, 55]);
    expect(sample.running).toBe(false);
    expect(Object.isFrozen(sample)).toBe(true);
  });

  it('零秒与不足一秒不产生 NaN 或虚假最小值', () => {
    const empty = summarizeFpsSample({
      running: true,
      targetSeconds: 60,
      elapsedMs: 0,
      frames: 0,
      perSecond: [],
      visibility: 'visible',
    });
    expect(empty.averageFps).toBe(0);
    expect(empty.minSecondFps).toBe(0);
    expect(empty.maxSecondFps).toBe(0);

    const partial = summarizeFpsSample({
      running: true,
      targetSeconds: 60,
      elapsedMs: 500,
      frames: 30,
      perSecond: [],
      visibility: 'visible',
    });
    expect(partial.averageFps).toBeCloseTo(60, 5);
    expect(partial.minSecondFps).toBe(0);
  });
});

describe('DOM 输入监听计数', () => {
  it('按 target/type/capture 去重，移除后归零', () => {
    const registry = createDomListenerRegistry();
    const target = new EventTarget();
    const listener = (): void => {};

    registry.noteAdd(target, 'keydown', listener);
    registry.noteAdd(target, 'keydown', listener);
    registry.noteAdd(target, 'keydown', listener, { capture: true });
    expect(registry.snapshot().total).toBe(2);

    registry.noteRemove(target, 'keydown', listener);
    expect(registry.snapshot().total).toBe(1);
    registry.noteRemove(target, 'keydown', listener, { capture: true });
    expect(registry.snapshot()).toMatchObject({
      total: 0,
      window: 0,
      document: 0,
      canvas: 0,
      other: 0,
    });
  });

  it('once 监听器不计入泄漏基线', () => {
    const registry = createDomListenerRegistry();
    registry.noteAdd(new EventTarget(), 'keydown', () => {}, { once: true });
    expect(registry.snapshot().total).toBe(0);
  });
});

describe('Phaser 监听清理', () => {
  it('reapSince 只移除 mark 之后新增的 visibilitychange 监听', () => {
    const doc = new EventTarget() as unknown as Document;
    const reaper = installPhaserVisibilityReaper(doc);
    let early = 0;
    let late = 0;
    let resize = 0;
    doc.addEventListener('visibilitychange', () => {
      early += 1;
    });
    const mark = reaper.mark();
    doc.addEventListener('visibilitychange', () => {
      late += 1;
    });
    doc.addEventListener('resize', () => {
      resize += 1;
    });
    expect(reaper.mark()).toBe(mark + 1);

    reaper.reapSince(mark);
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.dispatchEvent(new Event('resize'));
    expect(early).toBe(1);
    expect(late).toBe(0);
    expect(resize).toBe(1);
    expect(reaper.mark()).toBe(mark);
    reaper.dispose();
  });

  it('once 监听不纳入跟踪，手动移除后 mark 回落', () => {
    const doc = new EventTarget() as unknown as Document;
    const reaper = installPhaserVisibilityReaper(doc);
    const start = reaper.mark();
    const onceListener = (): void => {};
    doc.addEventListener('visibilitychange', onceListener, { once: true });
    expect(reaper.mark()).toBe(start);

    const listener = (): void => {};
    doc.addEventListener('visibilitychange', listener);
    expect(reaper.mark()).toBe(start + 1);
    doc.removeEventListener('visibilitychange', listener);
    expect(reaper.mark()).toBe(start);
    reaper.dispose();
  });

  it('releasePhaserMouseWheel 在销毁前按引用移除 canvas wheel', () => {
    const canvas = new EventTarget();
    let wheelCount = 0;
    const onWheel = (): void => {
      wheelCount += 1;
    };
    canvas.addEventListener('wheel', onWheel);
    const game = {
      input: { mouse: { target: canvas, onMouseWheel: onWheel } },
    } as unknown as Parameters<typeof releasePhaserMouseWheel>[0];

    releasePhaserMouseWheel(game);
    canvas.dispatchEvent(new Event('wheel'));
    expect(wheelCount).toBe(0);
    expect(releasePhaserMouseWheel(null)).toBeUndefined();
  });
});

describe('性能场景接线', () => {
  it('parseDevScenario 保留 perf 标记与常规场景互不干扰', () => {
    expect(parseDevScenario('?dev=1&perf=1')?.perf).toBe(true);
    expect(parseDevScenario('?dev=1&enemies=blob:2')?.perf).toBe(false);
    expect(parseDevScenario('?perf=1')).toBeNull();
    expect(
      parseDevScenario(`?dev=1&perf=1&enemies=blob:${DEV_SCENARIO_MAX_ENEMIES}`)?.perf,
    ).toBe(true);
  });

  it('场景在开发分支启动并维护性能场景，诊断只读输出计数', () => {
    expect(SCENE_SOURCE).toContain('this.perfScenario = scenario.perf');
    expect(SCENE_SOURCE).toContain('private startPerfScenario()');
    expect(SCENE_SOURCE).toContain('private maintainPerfScenario()');
    expect(SCENE_SOURCE).toContain('DEV_PERF_ENEMY_COUNT');
    expect(SCENE_SOURCE).toContain('DEV_PERF_ENEMY_PROJECTILE_COUNT');
    expect(SCENE_SOURCE).toContain('addDebugProjectile');
    expect(SCENE_SOURCE).toContain('trimProjectiles');
    expect(SCENE_SOURCE).toContain('getDevDiagnostics()');
    expect(SCENE_SOURCE).toContain('manifolds');
    // 诊断不得提供写回入口。
    const diagnosticsStart = SCENE_SOURCE.indexOf('getDevDiagnostics()');
    const diagnosticsBody = SCENE_SOURCE.slice(diagnosticsStart, diagnosticsStart + 1600);
    expect(diagnosticsBody).not.toContain('applyDamage');
    expect(diagnosticsBody).not.toContain('restoreHealth');
    expect(diagnosticsBody).not.toContain('restoreWorld');
  });

  it('重开销毁路径释放设置订阅与 Phaser 未清理的监听', () => {
    expect(SCENE_SOURCE).toContain('Phaser.Scenes.Events.DESTROY');
    expect(SCENE_SOURCE).toContain('releaseSceneResources');
    expect(APP_SOURCE).toContain('installPhaserVisibilityReaper');
    expect(APP_SOURCE).toContain('releasePhaserMouseWheel');
    expect(APP_SOURCE).toContain('reapSince');
  });

  it('应用壳先装诊断计数再挂 UI，并登记每个 Phaser 实例', () => {
    expect(APP_SOURCE).toContain('installDevDiagnostics');
    expect(APP_SOURCE).toContain('registerDevGame(created)');
    const installIndex = APP_SOURCE.indexOf('installDevDiagnostics();');
    const menuIndex = APP_SOURCE.indexOf('mountHelp(');
    expect(installIndex).toBeGreaterThan(0);
    expect(installIndex).toBeLessThan(menuIndex);
  });

  it('快照桥暴露独立的 getDiagnostics，且不混入游戏状态快照', () => {
    expect(SNAPSHOT_SOURCE).toContain('getDiagnostics: (): DevSceneDiagnostics | null');
    expect(SNAPSHOT_SOURCE).toContain('readDevSceneDiagnostics');
    expect(SNAPSHOT_SOURCE).toContain('freezeDevSceneDiagnostics');
  });
});

describe('交付材料', () => {
  it('性能脚本使用本工程 agent-browser 会话与完整 CDP，并记录结果', () => {
    expect(PERF_SCRIPT).toContain("'--session', SESSION, '--cdp', WS_URL");
    expect(PERF_SCRIPT).toContain('perf=1');
    expect(PERF_SCRIPT).toContain('upgrades=M01');
    expect(PERF_SCRIPT).toContain('startFpsSample');
    expect(PERF_SCRIPT).toContain('docs/perf-runs/perf-');
    expect(PERF_SCRIPT).toContain('screenshots/perf/');
    expect(PERF_SCRIPT).toContain('MIN_AVERAGE_FPS');
    expect(PERF_SCRIPT).toContain('compareLeakRun');
  });

  it('演示流程脚本覆盖启动、战斗、暂停、结算与性能检查', () => {
    for (const keyword of [
      'npm run dev -- --port 5343 --strictPort',
      '选角',
      'J',
      'K',
      'L',
      'Esc',
      '暂停',
      '结算',
      'perf-check.mjs',
    ]) {
      expect(DEMO_SCRIPT).toContain(keyword);
    }
  });

  it('素材来源说明与 README 标明本地生成、无外链运行时素材', () => {
    expect(ASSET_SOURCES).toContain('tools/generate-assets.mjs');
    expect(ASSET_SOURCES).toContain('public/assets/');
    expect(ASSET_SOURCES).toContain('96×96');
    expect(README).toContain('npm run build');
    expect(README).toContain('docs/演示流程脚本.md');
    expect(README).toContain('npm run test');
  });

  it('诊断常量使用独立全局名与标记', () => {
    expect(DEV_DIAGNOSTICS_GLOBAL).toBe('__PIXEL_ECHO_DIAG__');
    expect(DEV_DIAGNOSTICS_MARKER).toBe('pixel-echo.dev-diagnostics.v1');
  });
});
