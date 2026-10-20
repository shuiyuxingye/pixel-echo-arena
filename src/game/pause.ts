/**
 * 暂停语义（docs/game-design.md §3、§4）：纯逻辑，不依赖 Phaser 或 DOM。
 *
 * - 暂停期间场景不推进固定逻辑步，敌人、弹体、冷却、持续效果与波次计时全部冻结；
 * - 失焦自动暂停，恢复焦点后必须 Enter 明确继续；手动 Esc 暂停可用 Esc 返回；
 * - 从续局快照恢复时先保持暂停，同样只接受 Enter（US-023 复用）。
 */

export type PauseReason = 'manual' | 'blur' | 'checkpoint';

/** 恢复来源：菜单按钮/Enter 视为明确确认，Esc 只对非失焦暂停有效。 */
export type PauseResumeInput = 'enter' | 'escape';

/** Phaser game 事件：请求应用壳显示暂停面板。 */
export const PAUSE_MENU_EVENT = 'pixel-echo:pause-menu';

export interface PauseMenuPayload {
  readonly reason: PauseReason;
}

/** 失焦与续局恢复必须先显示暂停面板，并且只接受 Enter 继续。 */
export function pauseRequiresEnter(reason: PauseReason | null): boolean {
  return reason === 'blur' || reason === 'checkpoint';
}

export class PauseController {
  private reasonValue: PauseReason | null = null;

  get isPaused(): boolean {
    return this.reasonValue !== null;
  }

  get reason(): PauseReason | null {
    return this.reasonValue;
  }

  /** 重复暂停返回 false，不覆盖最初的原因。 */
  pause(reason: PauseReason): boolean {
    if (this.reasonValue !== null) return false;
    this.reasonValue = reason;
    return true;
  }

  canResume(input: PauseResumeInput): boolean {
    if (this.reasonValue === null) return false;
    if (pauseRequiresEnter(this.reasonValue)) return input === 'enter';
    return true;
  }

  /** 成功恢复后清空原因；不满足条件时保持暂停。 */
  resume(input: PauseResumeInput): boolean {
    if (!this.canResume(input)) return false;
    this.reasonValue = null;
    return true;
  }

  reset(): void {
    this.reasonValue = null;
  }
}
