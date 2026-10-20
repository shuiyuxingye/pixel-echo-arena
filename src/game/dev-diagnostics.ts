/**
 * 开发环境诊断桥（docs/game-design.md §10）：帧率采样、DOM 输入监听计数与
 * 存活 Phaser 实例计数，供 `tools/perf/perf-check.mjs` 做性能与重开泄漏检查。
 *
 * 只在 `import.meta.env.DEV` 分支安装；生产构建会摇掉整个模块。
 * 桥只读：不提供跳关、无敌或修改完成状态的入口。
 */

/** 诊断桥的全局名；生产构建中不得出现。 */
export const DEV_DIAGNOSTICS_GLOBAL = '__PIXEL_ECHO_DIAG__';

/** 诊断入口标记：用于断言生产构建已移除。 */
export const DEV_DIAGNOSTICS_MARKER = 'pixel-echo.dev-diagnostics.v1';

export interface DomListenerCounts {
  readonly total: number;
  readonly window: number;
  readonly document: number;
  readonly canvas: number;
  readonly other: number;
}

export interface FpsSample {
  /** 仍在采样中。 */
  readonly running: boolean;
  /** 采样目标时长（秒）。 */
  readonly targetSeconds: number;
  /** 已采样毫秒数。 */
  readonly elapsedMs: number;
  /** 已渲染帧数。 */
  readonly frames: number;
  /** 平均 FPS = 帧数 / 实际采样秒数。 */
  readonly averageFps: number;
  /** 完整秒桶中的最低 FPS；不足一秒时为 0。 */
  readonly minSecondFps: number;
  /** 完整秒桶中的最高 FPS；不足一秒时为 0。 */
  readonly maxSecondFps: number;
  /** 每个完整秒桶的 FPS，按时间顺序。 */
  readonly perSecond: readonly number[];
  /** 采样期间页面是否可见；后台标签页的 rAF 会被节流。 */
  readonly visibility: string;
}

/** 纯函数：把原始采样数据折算为可断言的 FPS 摘要。 */
export function summarizeFpsSample(input: {
  readonly running: boolean;
  readonly targetSeconds: number;
  readonly elapsedMs: number;
  readonly frames: number;
  readonly perSecond: readonly number[];
  readonly visibility: string;
}): FpsSample {
  const elapsedSeconds = input.elapsedMs > 0 ? input.elapsedMs / 1000 : 0;
  const averageFps = elapsedSeconds > 0 ? input.frames / elapsedSeconds : 0;
  const perSecond = [...input.perSecond];
  return Object.freeze({
    running: input.running,
    targetSeconds: input.targetSeconds,
    elapsedMs: input.elapsedMs,
    frames: input.frames,
    averageFps,
    minSecondFps: perSecond.length > 0 ? Math.min(...perSecond) : 0,
    maxSecondFps: perSecond.length > 0 ? Math.max(...perSecond) : 0,
    perSecond: Object.freeze(perSecond),
    visibility: input.visibility,
  });
}

type ListenerKey = string;

function listenerKey(type: string, capture: boolean): ListenerKey {
  return `${type}|${capture ? 'capture' : 'bubble'}`;
}

/**
 * 跟踪 `addEventListener` / `removeEventListener` 的有效条目。
 * 同一 target + type + capture + listener 重复注册按原生语义只计一次；
 * `{ once: true }` 的监听器会自行注销，不计入泄漏基线。
 */
export function createDomListenerRegistry(): {
  noteAdd(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  noteRemove(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
  snapshot(): DomListenerCounts;
} {
  const entries = new WeakMap<
    EventTarget,
    Map<ListenerKey, Set<EventListenerOrEventListenerObject>>
  >();
  // WeakMap 不可枚举，用强引用集合按目标分类汇总；条目归零即移除。
  const liveTargets = new Set<EventTarget>();

  const categoryOf = (target: EventTarget): keyof Omit<DomListenerCounts, 'total'> => {
    if (typeof window !== 'undefined' && target === (window as unknown as EventTarget)) {
      return 'window';
    }
    if (typeof document !== 'undefined' && target === (document as unknown as EventTarget)) {
      return 'document';
    }
    if (
      typeof HTMLCanvasElement !== 'undefined' &&
      target instanceof HTMLCanvasElement
    ) {
      return 'canvas';
    }
    return 'other';
  };

  const noteAdd = (
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    if (!listener) return;
    // once 监听器触发后由浏览器自动移除，本注册表无法观察，故不进基线。
    if (typeof options === 'object' && options?.once === true) return;

    const capture =
      typeof options === 'boolean' ? options : options?.capture === true;
    let byKey = entries.get(target);
    if (!byKey) {
      byKey = new Map();
      entries.set(target, byKey);
    }
    let listeners = byKey.get(listenerKey(type, capture));
    if (!listeners) {
      listeners = new Set();
      byKey.set(listenerKey(type, capture), listeners);
    }
    listeners.add(listener);
    liveTargets.add(target);
  };

  const noteRemove = (
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void => {
    if (!listener) return;
    const capture =
      typeof options === 'boolean' ? options : options?.capture === true;
    const byKey = entries.get(target);
    if (!byKey) return;
    const key = listenerKey(type, capture);
    const listeners = byKey.get(key);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size === 0) byKey.delete(key);
    if (byKey.size === 0) {
      entries.delete(target);
      liveTargets.delete(target);
    }
  };

  const snapshot = (): DomListenerCounts => {
    const counts = { window: 0, document: 0, canvas: 0, other: 0 };
    for (const target of liveTargets) {
      const byKey = entries.get(target);
      if (!byKey) continue;
      let targetCount = 0;
      for (const listeners of byKey.values()) targetCount += listeners.size;
      counts[categoryOf(target)] += targetCount;
    }
    return Object.freeze({
      total: counts.window + counts.document + counts.canvas + counts.other,
      ...counts,
    });
  };

  return { noteAdd, noteRemove, snapshot };
}

const domListeners = createDomListenerRegistry();

interface FpsSamplerState {
  running: boolean;
  targetSeconds: number;
  startMs: number;
  frames: number;
  perSecond: number[];
  secondStartMs: number;
  secondFrames: number;
  visibility: string;
}

let fpsState: FpsSamplerState | null = null;
let fpsFrameHandle: number | null = null;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function currentVisibility(): string {
  return typeof document !== 'undefined' ? document.visibilityState : 'unknown';
}

function finishFpsSample(atMs: number): FpsSample {
  const state = fpsState;
  if (!state) {
    return summarizeFpsSample({
      running: false,
      targetSeconds: 0,
      elapsedMs: 0,
      frames: 0,
      perSecond: [],
      visibility: currentVisibility(),
    });
  }
  return summarizeFpsSample({
    running: false,
    targetSeconds: state.targetSeconds,
    elapsedMs: Math.max(0, atMs - state.startMs),
    frames: state.frames,
    perSecond: state.perSecond,
    // 以结束时刻的可见性为准：采样途中切后台会节流 rAF，应判失败。
    visibility: currentVisibility(),
  });
}

function tickFpsSample(): void {
  const state = fpsState;
  if (!state) return;

  const atMs = nowMs();
  state.frames += 1;
  state.secondFrames += 1;

  if (atMs - state.secondStartMs >= 1000) {
    // 按真实桶时长折算，后台节流导致的长桶不会虚高每秒 FPS。
    const bucketMs = atMs - state.secondStartMs;
    state.perSecond.push(state.secondFrames / (bucketMs / 1000));
    state.secondStartMs = atMs;
    state.secondFrames = 0;
  }

  if ((atMs - state.startMs) / 1000 >= state.targetSeconds) {
    state.running = false;
    fpsFrameHandle = null;
    return;
  }

  if (typeof requestAnimationFrame === 'function') {
    fpsFrameHandle = requestAnimationFrame(tickFpsSample);
  } else {
    fpsFrameHandle = null;
  }
}

/** 开始一次 rAF 帧率采样；重复调用会以新的采样覆盖旧状态。 */
export function startFpsSample(seconds = 60): FpsSample {
  if (fpsFrameHandle !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(fpsFrameHandle);
  }
  const startMs = nowMs();
  fpsState = {
    running: true,
    targetSeconds: Math.max(1, seconds),
    startMs,
    frames: 0,
    perSecond: [],
    secondStartMs: startMs,
    secondFrames: 0,
    visibility: currentVisibility(),
  };
  if (typeof requestAnimationFrame === 'function') {
    fpsFrameHandle = requestAnimationFrame(tickFpsSample);
  }
  return getFpsSample();
}

/** 只读读取当前采样；尚未开始时返回零值摘要。 */
export function getFpsSample(): FpsSample {
  const state = fpsState;
  if (!state) {
    return summarizeFpsSample({
      running: false,
      targetSeconds: 0,
      elapsedMs: 0,
      frames: 0,
      perSecond: [],
      visibility: currentVisibility(),
    });
  }
  const atMs = nowMs();
  const elapsedMs = Math.max(0, atMs - state.startMs);
  const finished = !state.running || elapsedMs / 1000 >= state.targetSeconds;
  if (finished) {
    return finishFpsSample(state.startMs + state.targetSeconds * 1000);
  }
  return summarizeFpsSample({
    running: true,
    targetSeconds: state.targetSeconds,
    elapsedMs,
    frames: state.frames,
    perSecond: state.perSecond,
    visibility: state.visibility,
  });
}

/** 停止当前采样并返回截至此刻的摘要。 */
export function stopFpsSample(): FpsSample {
  if (fpsFrameHandle !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(fpsFrameHandle);
  }
  fpsFrameHandle = null;
  const sample = finishFpsSample(nowMs());
  if (fpsState) fpsState.running = false;
  return sample;
}

interface DevGameLike {
  readonly events: {
    once(event: string, listener: () => void): unknown;
  };
}

let liveGameCount = 0;

/** 注册一个存活的 Phaser 实例；销毁事件触发时自动扣减。 */
export function registerDevGame(game: DevGameLike | null | undefined): void {
  if (!game) return;
  liveGameCount += 1;
  game.events.once('destroy', () => {
    liveGameCount = Math.max(0, liveGameCount - 1);
  });
}

/** 当前仍存活的 Phaser 实例数；重开泄漏检查要求恒为 1。 */
export function getLiveGameCount(): number {
  return liveGameCount;
}

export interface DevDiagnosticsBridge {
  readonly marker: string;
  getDomListeners(): DomListenerCounts;
  getLiveGames(): number;
  startFpsSample(seconds?: number): FpsSample;
  getFpsSample(): FpsSample;
  stopFpsSample(): FpsSample;
}

let installed = false;

/**
 * 安装诊断桥并开始统计 DOM 监听器。
 * 必须在应用壳挂载任何菜单/画布之前调用，否则会漏记已有监听。
 */
export function installDevDiagnostics(): void {
  if (installed) return;
  installed = true;

  const originalAdd = EventTarget.prototype.addEventListener;
  const originalRemove = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = function patchedAdd(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    domListeners.noteAdd(this, type, listener, options);
    return originalAdd.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function patchedRemove(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    domListeners.noteRemove(this, type, listener, options);
    return originalRemove.call(this, type, listener, options);
  };

  const bridge: DevDiagnosticsBridge = Object.freeze({
    marker: DEV_DIAGNOSTICS_MARKER,
    getDomListeners: () => domListeners.snapshot(),
    getLiveGames: () => liveGameCount,
    startFpsSample: (seconds?: number) => startFpsSample(seconds),
    getFpsSample: () => getFpsSample(),
    stopFpsSample: () => stopFpsSample(),
  });

  Object.defineProperty(globalThis, DEV_DIAGNOSTICS_GLOBAL, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: bridge,
  });
}
