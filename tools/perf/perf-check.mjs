#!/usr/bin/env node
/*
 * 性能与重开泄漏检查（docs/game-design.md §10、US-026b）。
 *
 * 用法：
 *   node tools/perf/perf-check.mjs
 *   node tools/perf/perf-check.mjs --seconds 60 --restarts 5 --character muelsyse
 *
 * 前置：开发服务已在 5343 运行（npm run dev -- --port 5343 --strictPort）。
 * 脚本通过 agent-browser（--session + 完整 --cdp URL）打开隔离性能场景：
 *   ?dev=1&perf=1&character=muelsyse&seed=20261020&upgrades=M01
 * M01 让远程副本上限为 2，场景维持 80 敌人、40 敌弹、3 个流形（主流形 + 2 副本）。
 *
 * 1) 用页面内 rAF 采样 60 秒平均 FPS，要求 ≥50；
 * 2) 经由真实 UI（Esc 暂停 → 返回选角 → Enter 确认）连续重开 5 局，
 *    比较 DOM 输入监听、存活 Phaser 实例、画布、实体与场景监听计数是否回到基线；
 * 3) 结果写入 docs/perf-runs/perf-<时间戳>.json，截图写入 screenshots/perf/。
 *
 * 退出码 0 = 性能与泄漏检查全部通过；1 = 任一未通过或环境错误。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BROWSER_PY = resolve(ROOT, '.claude/skills/agent-browser-skill/scripts/browser.py');
const BASE_URL = process.env.PERF_URL ?? 'http://localhost:5343/';

const MIN_AVERAGE_FPS = 50;
const PERF_ENEMY_COUNT = 80;
const PERF_PROJECTILE_COUNT = 40;
const PERF_MANIFOLD_COUNT = 3;

function parseArgs(argv) {
  const args = {
    seconds: 60,
    restarts: 5,
    character: 'muelsyse',
    seed: 20261020,
    settleMs: 1500,
    pollSeconds: 5,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--seconds') {
      args.seconds = Number(value);
      index += 1;
    } else if (flag === '--restarts') {
      args.restarts = Number(value);
      index += 1;
    } else if (flag === '--character') {
      args.character = value;
      index += 1;
    } else if (flag === '--seed') {
      args.seed = Number(value);
      index += 1;
    } else if (flag === '--settle-ms') {
      args.settleMs = Number(value);
      index += 1;
    } else if (flag === '--poll-seconds') {
      args.pollSeconds = Number(value);
      index += 1;
    }
  }
  return args;
}

function command(file, args, options = {}) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

const args = parseArgs(process.argv.slice(2));
if (!Number.isFinite(args.seconds) || args.seconds < 1) {
  throw new Error('--seconds 必须 ≥ 1');
}
if (!Number.isInteger(args.restarts) || args.restarts < 1) {
  throw new Error('--restarts 必须为 ≥ 1 的整数');
}

const WS_URL = process.env.PERF_CDP_URL?.trim()
  || command('python3', [BROWSER_PY, 'ensure']).trim();
if (!WS_URL.startsWith('ws://')) {
  throw new Error(`browser.py ensure did not return a websocket URL: ${WS_URL}`);
}
const SESSION = process.env.PERF_SESSION?.trim()
  || command('python3', [BROWSER_PY, 'session']).trim();
console.log(`[perf] cdp=${WS_URL} session=${SESSION}`);

function ab(abArgs) {
  return command('agent-browser', ['--session', SESSION, '--cdp', WS_URL, ...abArgs]);
}

function evaluate(expression) {
  const raw = ab(['eval', '--json', expression]);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`agent-browser eval returned non-JSON: ${raw.slice(0, 400)}`, {
      cause: error,
    });
  }
  if (!parsed.success) {
    throw new Error(`eval failed: ${JSON.stringify(parsed.error)}`);
  }
  return parsed.data.result;
}

/** 读取页面内开发诊断；快照/诊断尚未就绪时返回 null。 */
function readState() {
  const raw = evaluate(`JSON.stringify((() => {
    const dev = window.__PIXEL_ECHO_DEV__;
    const diag = window.__PIXEL_ECHO_DIAG__;
    if (!dev || !dev.getSnapshot) return null;
    const snapshot = dev.getSnapshot();
    const diagnostics = dev.getDiagnostics ? dev.getDiagnostics() : null;
    return {
      snapshot: snapshot
        ? { audioUnlocked: snapshot.audio ? snapshot.audio.unlocked : null,
            paused: snapshot.paused, phase: snapshot.phase }
        : null,
      diagnostics,
      dom: diag ? diag.getDomListeners() : null,
      liveGames: diag ? diag.getLiveGames() : null,
      fps: diag ? diag.getFpsSample() : null,
      canvasCount: document.querySelectorAll('canvas').length,
      visibility: document.visibilityState,
    };
  })())`);
  return raw ? JSON.parse(raw) : null;
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let tick = 0;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    tick += 1;
    if (tick % 10 === 0) {
      console.log(`[perf] waiting ${label} (${Math.round((deadline - Date.now()) / 1000)}s left)`);
    }
    await sleep(250);
  }
  return false;
}

function overlayVisible(selector) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return Boolean(el && !el.hidden);
  })()`);
}

function perfReadyState() {
  const state = readState();
  if (!state || !state.diagnostics) return null;
  return state;
}

function countsOf(state) {
  const diagnostics = state.diagnostics;
  return {
    canvasCount: state.canvasCount,
    liveGames: state.liveGames,
    displayObjects: diagnostics.displayObjects,
    physicsBodies: diagnostics.physicsBodies,
    tweens: diagnostics.tweens,
    timers: diagnostics.timers,
    activeScenes: diagnostics.activeScenes,
    settingsSubscribers: diagnostics.settingsSubscribers,
    inputListeners: diagnostics.inputListeners,
    domListeners: state.dom,
    aliveEnemies: diagnostics.aliveEnemies,
    enemyProjectiles: diagnostics.enemyProjectiles,
    manifolds: diagnostics.manifolds,
  };
}

function near(actual, baseline, tolerance) {
  return Math.abs(actual - baseline) <= tolerance;
}

function compareLeakRun(baseline, current) {
  const failures = [];
  const checkEqual = (label, actual, expected) => {
    if (actual !== expected) failures.push(`${label}: ${actual} ≠ 基线 ${expected}`);
  };
  const checkNear = (label, actual, expected, tolerance) => {
    if (!near(actual, expected, tolerance)) {
      failures.push(`${label}: ${actual} 超出基线 ${expected} ±${tolerance}`);
    }
  };

  checkEqual('画布数量', current.canvasCount, baseline.canvasCount);
  checkEqual('存活 Phaser 实例', current.liveGames, baseline.liveGames);
  checkEqual('活跃场景数', current.activeScenes, baseline.activeScenes);
  checkEqual('设置订阅数', current.settingsSubscribers, baseline.settingsSubscribers);
  checkEqual('物理体', current.physicsBodies, baseline.physicsBodies);
  checkEqual('场景 keydown 监听', current.inputListeners.keydown, baseline.inputListeners.keydown);
  checkEqual('场景 keyup 监听', current.inputListeners.keyup, baseline.inputListeners.keyup);
  checkEqual('游戏 blur 监听', current.inputListeners.gameBlur, baseline.inputListeners.gameBlur);
  checkEqual(
    '场景 shutdown 监听',
    current.inputListeners.sceneShutdown,
    baseline.inputListeners.sceneShutdown,
  );
  checkEqual('DOM 监听总数', current.domListeners.total, baseline.domListeners.total);
  checkEqual('window 监听', current.domListeners.window, baseline.domListeners.window);
  checkEqual('document 监听', current.domListeners.document, baseline.domListeners.document);
  checkEqual('canvas 监听', current.domListeners.canvas, baseline.domListeners.canvas);
  // 战斗中的伤害字/补间/延时回调会随命中时刻轻微波动；监听器与规格实体用精确比较。
  checkNear('显示对象', current.displayObjects, baseline.displayObjects, 40);
  checkNear('补间动画', current.tweens, baseline.tweens, 20);
  checkNear('计时器', current.timers, baseline.timers, 30);

  // 性能场景的规格实体必须每局都恢复，避免旧局视觉残留被当成正常基线。
  checkEqual('存活敌人数', current.aliveEnemies, PERF_ENEMY_COUNT);
  checkEqual('敌弹数', current.enemyProjectiles, PERF_PROJECTILE_COUNT);
  checkEqual('流形数', current.manifolds, PERF_MANIFOLD_COUNT);
  return failures;
}

async function warmUp() {
  // 首个真实键盘确认会解锁音频并移除全局 unlock 监听，先做掉再取基线。
  ab(['press', 'Shift']);
  await sleep(300);
  let state = readState();
  if (state?.snapshot && state.snapshot.audioUnlocked === false) {
    // 某些键盘实现不把单独的 Shift 传给页面；用 Esc + Enter 走一次真实暂停/继续。
    ab(['press', 'Escape']);
    const paused = await waitFor(
      () => overlayVisible('#pause-overlay'),
      5000,
      'warm-up pause',
    );
    if (paused) {
      ab(['press', 'Enter']);
      await waitFor(
        () => evaluate("Boolean(document.querySelector('#pause-overlay')?.hidden)"),
        5000,
        'warm-up resume',
      );
    }
    await sleep(300);
    state = readState();
  }
  return state;
}

async function restartOnce(index) {
  console.log(`[perf] restart ${index}: Esc → 返回选角 → Enter`);
  ab(['press', 'Escape']);
  const paused = await waitFor(
    () => overlayVisible('#pause-overlay'),
    8000,
    'pause overlay',
  );
  if (!paused) throw new Error('按 Esc 后暂停面板未出现');

  evaluate("document.querySelector('#pause-return').click(); true");
  const returned = await waitFor(
    () => evaluate("Boolean(document.querySelector('#character-select-overlay') && !document.querySelector('#character-select-overlay').hidden)"),
    8000,
    'character select',
  );
  if (!returned) throw new Error('点击返回选角后未显示选角页');

  ab(['press', 'Enter']);
  const ready = await waitFor(
    () => Boolean(perfReadyState()?.diagnostics),
    15000,
    'perf snapshot',
  );
  if (!ready) throw new Error('重开后开发诊断未就绪');
  await sleep(args.settleMs);
  return perfReadyState();
}

async function main() {
  const url = `${BASE_URL}?dev=1&perf=1&character=${encodeURIComponent(args.character)}&seed=${args.seed}&upgrades=M01`;
  console.log(`[perf] open ${url}`);
  ab(['open', url]);

  const ready = await waitFor(
    () => Boolean(perfReadyState()?.diagnostics),
    20000,
    'perf scenario',
  );
  if (!ready) throw new Error('性能场景未就绪：请确认开发服务已启动且 URL 带 ?dev=1&perf=1');

  const initial = perfReadyState();
  const initialCounts = countsOf(initial);
  console.log(
    `[perf] initial enemies=${initialCounts.aliveEnemies} projectiles=${initialCounts.enemyProjectiles} manifolds=${initialCounts.manifolds}`,
  );
  if (
    initialCounts.aliveEnemies !== PERF_ENEMY_COUNT ||
    initialCounts.enemyProjectiles !== PERF_PROJECTILE_COUNT ||
    initialCounts.manifolds !== PERF_MANIFOLD_COUNT
  ) {
    throw new Error(
      `性能场景实体数量不符：期望 ${PERF_ENEMY_COUNT}/${PERF_PROJECTILE_COUNT}/${PERF_MANIFOLD_COUNT}，实际 ${initialCounts.aliveEnemies}/${initialCounts.enemyProjectiles}/${initialCounts.manifolds}`,
    );
  }

  // 预热键盘/音频，再开始采样，避免首个按键监听影响后续基线。
  await warmUp();

  // 若浏览器在预热期间失焦自动暂停，先按 Enter 明确继续，确保 60 秒采样的是运行中的战斗。
  const preSample = perfReadyState();
  if (preSample?.snapshot?.paused) {
    ab(['press', 'Enter']);
    const resumed = await waitFor(
      () => {
        const state = perfReadyState();
        return Boolean(state?.snapshot && !state.snapshot.paused);
      },
      5000,
      'resume before sampling',
    );
    if (!resumed) throw new Error('性能采样前无法从暂停恢复');
  }

  evaluate(`window.__PIXEL_ECHO_DIAG__.startFpsSample(${args.seconds}); true`);
  console.log(`[perf] sampling ${args.seconds}s ...`);
  const deadline = Date.now() + (args.seconds + 30) * 1000;
  let fps = null;
  const countSamples = [];
  while (Date.now() < deadline) {
    await sleep(args.pollSeconds * 1000);
    const state = readState();
    fps = state?.fps ?? null;
    if (state?.diagnostics) {
      const counts = {
        atSeconds: Number((state.fps?.elapsedMs ?? 0) / 1000),
        aliveEnemies: state.diagnostics.aliveEnemies,
        enemyProjectiles: state.diagnostics.enemyProjectiles,
        manifolds: state.diagnostics.manifolds,
        paused: Boolean(state.snapshot?.paused),
      };
      countSamples.push(counts);
      const stable =
        counts.aliveEnemies === PERF_ENEMY_COUNT &&
        counts.enemyProjectiles === PERF_PROJECTILE_COUNT &&
        counts.manifolds === PERF_MANIFOLD_COUNT;
      console.log(
        `[perf] counts @${counts.atSeconds.toFixed(1)}s enemies=${counts.aliveEnemies} projectiles=${counts.enemyProjectiles} manifolds=${counts.manifolds} ${stable ? 'ok' : 'DRIFT'}`,
      );
    }
    if (!fps) continue;
    console.log(
      `[perf] ${(fps.elapsedMs / 1000).toFixed(1)}/${args.seconds}s frames=${fps.frames} avg=${fps.averageFps.toFixed(1)}`,
    );
    if (!fps.running) break;
  }
  if (!fps || fps.running) {
    throw new Error(`帧率采样未在 ${args.seconds + 30}s 内完成`);
  }

  const performanceFailures = [];
  if (fps.averageFps < MIN_AVERAGE_FPS) {
    performanceFailures.push(
      `平均 FPS ${fps.averageFps.toFixed(1)} < ${MIN_AVERAGE_FPS}`,
    );
  }
  if (fps.visibility !== 'visible') {
    performanceFailures.push(`采样期间页面可见性为 ${fps.visibility}`);
  }
  const perfStateNow = perfReadyState();
  if (!perfStateNow?.diagnostics) {
    throw new Error('采样结束后开发诊断不可用');
  }
  const perfCountsNow = countsOf(perfStateNow);
  if (perfCountsNow.aliveEnemies !== PERF_ENEMY_COUNT) {
    performanceFailures.push(`60 秒后敌人数 ${perfCountsNow.aliveEnemies} ≠ ${PERF_ENEMY_COUNT}`);
  }
  if (perfCountsNow.enemyProjectiles !== PERF_PROJECTILE_COUNT) {
    performanceFailures.push(
      `60 秒后敌弹数 ${perfCountsNow.enemyProjectiles} ≠ ${PERF_PROJECTILE_COUNT}`,
    );
  }
  if (perfCountsNow.manifolds !== PERF_MANIFOLD_COUNT) {
    performanceFailures.push(`60 秒后流形数 ${perfCountsNow.manifolds} ≠ ${PERF_MANIFOLD_COUNT}`);
  }
  const drifted = countSamples.filter(
    (sample) =>
      sample.aliveEnemies !== PERF_ENEMY_COUNT ||
      sample.enemyProjectiles !== PERF_PROJECTILE_COUNT ||
      sample.manifolds !== PERF_MANIFOLD_COUNT,
  );
  if (drifted.length > 0) {
    performanceFailures.push(
      `采样期间实体数量漂移 ${drifted.length}/${countSamples.length} 次（首次 ${JSON.stringify(drifted[0])}）`,
    );
  }
  const pausedSamples = countSamples.filter((sample) => sample.paused);
  if (pausedSamples.length > 0 || perfStateNow?.snapshot?.paused) {
    performanceFailures.push(
      `采样期间游戏暂停 ${pausedSamples.length}/${countSamples.length} 次；暂停会冻结战斗逻辑，测量无效`,
    );
  }

  // 采样结束若处于暂停（例如窗口失焦），先明确继续再取泄漏基线。
  if (perfStateNow.snapshot?.paused) {
    ab(['press', 'Enter']);
    const resumed = await waitFor(
      () => {
        const state = perfReadyState();
        return Boolean(state?.snapshot && !state.snapshot.paused);
      },
      5000,
      'resume before baseline',
    );
    if (!resumed) throw new Error('泄漏基线前无法从暂停恢复');
  }

  // 基线必须在截图之前读取：截图若导致失焦暂停，不应把暂停面板监听算进基线。
  const baselineState = perfReadyState();
  if (!baselineState?.diagnostics) {
    throw new Error('泄漏基线开发诊断不可用');
  }
  const baseline = countsOf(baselineState);
  screenshot('perf');

  const restarts = [];
  for (let index = 1; index <= args.restarts; index += 1) {
    const state = await restartOnce(index);
    const current = countsOf(state);
    const failures = compareLeakRun(baseline, current);
    restarts.push({ index, counts: current, failures });
    console.log(
      `[perf] restart ${index}: dom=${current.domListeners.total} liveGames=${current.liveGames} objects=${current.displayObjects} enemies=${current.aliveEnemies} ${failures.length === 0 ? 'ok' : `FAIL(${failures.length})`}`,
    );
    for (const failure of failures) console.log(`[perf]   - ${failure}`);
  }

  screenshot('after-restarts');

  const leakPass = restarts.every((entry) => entry.failures.length === 0);
  const pass = performanceFailures.length === 0 && leakPass;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const record = {
    story: 'US-026b',
    generatedAt: new Date().toISOString(),
    url,
    character: args.character,
    seed: args.seed,
    durationSeconds: args.seconds,
    thresholds: {
      minAverageFps: MIN_AVERAGE_FPS,
      enemies: PERF_ENEMY_COUNT,
      projectiles: PERF_PROJECTILE_COUNT,
      manifolds: PERF_MANIFOLD_COUNT,
      restarts: args.restarts,
    },
    performance: {
      fps,
      countSamples,
      countsAfter: perfCountsNow,
      failures: performanceFailures,
      pass: performanceFailures.length === 0,
    },
    leak: {
      baseline,
      restarts,
      pass: leakPass,
    },
    pass,
  };

  const outPath = resolve(ROOT, `docs/perf-runs/perf-${stamp}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  console.log('[perf] ----------------------------------------');
  console.log(
    `[perf] FPS avg=${fps.averageFps.toFixed(1)} min/s=${fps.minSecondFps} max/s=${fps.maxSecondFps} → ${performanceFailures.length === 0 ? 'PASS' : 'FAIL'}`,
  );
  console.log(`[perf] leak restarts=${args.restarts} → ${leakPass ? 'PASS' : 'FAIL'}`);
  console.log(`[perf] record ${outPath}`);
  console.log(`[perf] RESULT: ${pass ? 'PASS' : 'FAIL'}`);

  if (!pass) {
    for (const failure of performanceFailures) console.log(`[perf] - ${failure}`);
    process.exitCode = 1;
  }
}

function screenshot(name) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = resolve(ROOT, `screenshots/perf/${name}-${stamp}.png`);
  mkdirSync(dirname(path), { recursive: true });
  try {
    ab(['screenshot', path]);
    console.log(`[perf] screenshot ${path}`);
  } catch (error) {
    console.log(`[perf] screenshot ${name} failed: ${error.message}`);
  }
}

main().catch((error) => {
  console.error(`[perf] ERROR: ${error.message}`);
  process.exitCode = 1;
});
