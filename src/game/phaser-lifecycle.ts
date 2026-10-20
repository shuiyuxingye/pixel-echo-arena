import type Phaser from 'phaser';

/**
 * Phaser 3.90 的监听清理补丁（US-026b 重开泄漏检查）。
 *
 * 每次 `new Phaser.Game()` 都会注册两类 Phaser 自身不回收的监听：
 * 1. `MouseManager.startListeners()` 注册 canvas 的 `wheel`，但 `stopListeners()`
 *    遗漏了它（node_modules/phaser/src/input/mouse/MouseManager.js）；
 * 2. `VisibilityHandler` 在 `Game.start()` 里向 document 注册 `visibilitychange`，
 *    且 Game 销毁流程没有任何移除入口（node_modules/phaser/src/core/VisibilityHandler.js）。
 * 应用壳按“创建前 mark、销毁时 reapSince”记录并移除后者，前者在销毁前按引用移除。
 */

type AddListenerFn = (
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
) => void;
type RemoveListenerFn = (
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | EventListenerOptions,
) => void;

export interface PhaserVisibilityReaper {
  /** 记录当前 document 上被跟踪的 visibilitychange 监听数量。 */
  mark(): number;
  /** 移除 mark 之后新增的 visibilitychange 监听；用于销毁对应的 Phaser 实例。 */
  reapSince(mark: number): void;
  /** 恢复 EventTarget 原型方法；应用壳卸载时调用。 */
  dispose(): void;
}

/**
 * 安装 document 级 visibilitychange 记录器。
 * 必须在创建第一个 Phaser.Game 之前调用；只记录 document 目标上的非 once 监听。
 * 这里与开发诊断一样替换 `EventTarget.prototype`（兼容其为每个 target 计数的包装），
 * 只处理 `this === doc` 的调用，避免影响其他事件目标。
 */
export function installPhaserVisibilityReaper(
  doc: Document = document,
): PhaserVisibilityReaper {
  const tracked: EventListenerOrEventListenerObject[] = [];
  const proto = EventTarget.prototype;
  const originalAdd = proto.addEventListener as unknown as AddListenerFn;
  const originalRemove = proto.removeEventListener as unknown as RemoveListenerFn;

  const patchedAdd = function patchedAdd(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (
      this === doc &&
      type === 'visibilitychange' &&
      listener &&
      !(typeof options === 'object' && options !== null && options.once === true) &&
      !tracked.includes(listener)
    ) {
      tracked.push(listener);
    }
    originalAdd.call(this, type, listener, options);
  };
  const patchedRemove = function patchedRemove(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (this === doc && type === 'visibilitychange' && listener) {
      const index = tracked.indexOf(listener);
      if (index >= 0) tracked.splice(index, 1);
    }
    originalRemove.call(this, type, listener, options);
  };

  proto.addEventListener = patchedAdd as typeof proto.addEventListener;
  proto.removeEventListener = patchedRemove as typeof proto.removeEventListener;

  return {
    mark: () => tracked.length,
    reapSince: (mark) => {
      const pending = tracked.splice(Math.max(0, mark));
      for (const listener of pending) {
        originalRemove.call(doc, 'visibilitychange', listener, false);
      }
    },
    dispose: () => {
      proto.addEventListener = originalAdd as typeof proto.addEventListener;
      proto.removeEventListener = originalRemove as typeof proto.removeEventListener;
    },
  };
}

/**
 * 移除 Phaser 3.90 MouseManager 未清理的 canvas `wheel` 监听。
 * 必须在 `game.destroy()` 之前调用：Game 的销毁是下一帧异步执行，
 * 此时 `InputManager.destroy()` 会把 `mouse.target` 置空，之后就取不到引用。
 */
export function releasePhaserMouseWheel(game: Phaser.Game | null): void {
  if (!game) return;
  const mouse = game.input?.mouse;
  const target = mouse?.target as EventTarget | null | undefined;
  const onWheel = mouse?.onMouseWheel as EventListener | undefined;
  if (target && typeof target.removeEventListener === 'function' && typeof onWheel === 'function') {
    // 注册时 capture 为 false（passive 不影响 removeEventListener 的匹配）。
    target.removeEventListener('wheel', onWheel);
  }
}
