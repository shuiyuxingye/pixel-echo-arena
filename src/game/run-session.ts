/**
 * 单局会话状态：只保存“这一局是谁、第几局”，不保存用户设置与键位。
 * 返回选角时 endRun() 清空单局状态；beginRun() 总是生成新的 runId，
 * 让强化、冷却、召唤物等每局临时状态可以安全地按局重建。
 */

import { DEFAULT_CHARACTER_ID, type CharacterId } from './data/characters';

/** 场景创建时从 Phaser registry 读取本局角色；由 createGameConfig 的 preBoot 写入。 */
export const RUN_CHARACTER_REGISTRY_KEY = 'pixel-echo.run-character';

/** 死亡结算后按 Enter 返回选角的场景事件；由应用壳监听并销毁本局。 */
export const RETURN_TO_CHARACTER_SELECT_EVENT = 'pixel-echo.return-to-character-select';

export interface RunSession {
  /** 单调递增的本局 ID；同一角色重开也会得到新 ID。 */
  readonly runId: number;
  readonly characterId: CharacterId;
}

export interface RunSessionStore {
  readonly current: RunSession | null;
  readonly lastCharacterId: CharacterId;
  /** 结束上一局临时状态并开始新局；局中不允许改角色。 */
  beginRun(characterId: CharacterId): RunSession;
  /** 清空单局状态，保留最近一次选择用于返回选角时的焦点。 */
  endRun(): void;
}

export function createRunSessionStore(
  defaultCharacterId: CharacterId = DEFAULT_CHARACTER_ID,
): RunSessionStore {
  let nextRunId = 1;
  let current: RunSession | null = null;
  let lastCharacterId = defaultCharacterId;

  return {
    get current(): RunSession | null {
      return current;
    },
    get lastCharacterId(): CharacterId {
      return lastCharacterId;
    },
    beginRun(characterId: CharacterId): RunSession {
      current = { runId: nextRunId, characterId };
      nextRunId += 1;
      lastCharacterId = characterId;
      return current;
    },
    endRun(): void {
      current = null;
    },
  };
}

/** 浏览器与应用壳共用的单例；测试使用 createRunSessionStore() 隔离。 */
export const runSessions: RunSessionStore = createRunSessionStore();
