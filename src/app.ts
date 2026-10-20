import Phaser from 'phaser';
import {
  createSettingsSoundPlayer,
  installSoundUnlock,
  type SoundPlayer,
} from './game/audio';
import type { CharacterId } from './game/data';
import { SCENE_KEYS } from './game/config';
import { installDevDiagnostics, registerDevGame } from './game/dev-diagnostics';
import { parseDevScenario } from './game/dev-scenario';
import { installDevSnapshotBridge } from './game/dev-snapshot';
import { createGameConfig, type GameOptions } from './game/game';
import {
  installPhaserVisibilityReaper,
  releasePhaserMouseWheel,
} from './game/phaser-lifecycle';
import { PAUSE_MENU_EVENT, type PauseMenuPayload, type PauseResumeInput } from './game/pause';
import {
  clearRunCheckpoint,
  loadRunCheckpoint,
  type RunCheckpoint,
} from './game/run-save';
import {
  RUN_RESULT_EVENT,
  loadRunResults,
  type RunResultPayload,
} from './game/run-results';
import { RETURN_TO_CHARACTER_SELECT_EVENT, runSessions } from './game/run-session';
import { createSettingsStore } from './game/settings';
import type { ArenaScene } from './game/scenes/ArenaScene';
import {
  mountCharacterSelect,
  type CharacterSelectHandle,
} from './ui/character-select';
import { mountHelp } from './ui/help-panel';
import { mountMenu, type MenuResumeState } from './ui/menu';
import { mountPauseMenu } from './ui/pause-menu';
import { mountResultPanel } from './ui/result-panel';
import { mountSettingsPanel } from './ui/settings-panel';

/**
 * 应用壳：DOM 主菜单 → 选角页 → 创建 Phaser 游戏。
 * 返回选角时销毁本局并清空单局状态；用户设置与键位保存在 localStorage，不随之重置。
 * 帮助、设置与暂停同为 DOM 覆盖层，全部可用键盘焦点与返回路径操作。
 */
export function bootstrapGameShell(doc: Document = document): () => void {
  // 诊断桥必须先挂：它从这一刻起统计 DOM 输入监听的增删，供重开泄漏检查比较。
  if (import.meta.env.DEV) installDevDiagnostics();

  const gameRoot = doc.querySelector<HTMLElement>('#game-root');
  if (!gameRoot) throw new Error('Missing #game-root container');

  // Phaser 3.90 的 VisibilityHandler 每次 new Game 都向 document 注册
  // visibilitychange 且销毁时不移除；这里记录每次创建之后新增的监听，
  // 在销毁对应实例时一并移除（重开泄漏检查的 document 计数依赖它）。
  const visibilityReaper = installPhaserVisibilityReaper(doc);
  const visibilityMarks = new WeakMap<Phaser.Game, number>();

  const createRunGame = (options: GameOptions): Phaser.Game => {
    const mark = visibilityReaper.mark();
    const created = new Phaser.Game(createGameConfig(gameRoot.id, options));
    visibilityMarks.set(created, mark);
    return created;
  };

  const destroyRunGame = (target: Phaser.Game | null): void => {
    if (!target) return;
    // Phaser 3.90 MouseManager.stopListeners() 遗漏 wheel，销毁前按引用移除。
    releasePhaserMouseWheel(target);
    const mark = visibilityMarks.get(target);
    if (mark !== undefined) {
      visibilityReaper.reapSince(mark);
      visibilityMarks.delete(target);
    }
    target.destroy(true);
  };

  let game: Phaser.Game | null = null;
  let characterSelect: CharacterSelectHandle | null = null;
  let overlayReturn: 'menu' | 'pause' | null = null;

  // 设置 store 在菜单、暂停面板与 Phaser 场景之间共享；修改立即生效并持久化。
  const settingsStore = createSettingsStore();
  // 音效全部本地合成；首个键盘确认（菜单/选角/战斗任意位置）后解锁播放。
  const soundPlayer: SoundPlayer = createSettingsSoundPlayer(settingsStore);
  const removeSoundUnlock = installSoundUnlock(doc, soundPlayer);

  const help = mountHelp({
    doc,
    store: settingsStore,
    onBack: () => closeSubOverlay(),
  });
  const settingsPanel = mountSettingsPanel({
    doc,
    store: settingsStore,
    onBack: () => closeSubOverlay(),
  });

  const resumeArena = (input: PauseResumeInput): boolean => {
    const scene = game?.scene.getScene(SCENE_KEYS.arena) as ArenaScene | undefined;
    return scene?.resumeCombat(input) ?? false;
  };

  const pauseMenu = mountPauseMenu({
    doc,
    onContinue: (input) => {
      if (resumeArena(input)) pauseMenu.hide();
    },
    onHelp: () => openSubOverlay('help', 'pause'),
    onSettings: () => openSubOverlay('settings', 'pause'),
    onReturnToSelect: () => {
      pauseMenu.hide();
      returnToCharacterSelect();
    },
  });

  // 胜败结算面板：同角色重开 / 返回选角 / 查看最近 10 局，全部键盘可达。
  const resultPanel = mountResultPanel({
    doc,
    onRestart: (characterId) => {
      resultPanel.hide();
      startRun(characterId);
    },
    onReturnToSelect: () => {
      resultPanel.hide();
      returnToCharacterSelect();
    },
    getRecords: () => loadRunResults(),
  });

  function closeSubOverlay(): void {
    help.hide();
    settingsPanel.hide();
    const from = overlayReturn;
    overlayReturn = null;
    if (from === 'pause' && pauseMenu.reason) {
      pauseMenu.show();
    } else {
      menu.show();
    }
  }

  function openSubOverlay(
    target: 'help' | 'settings',
    from: 'menu' | 'pause',
  ): void {
    if (from === 'pause') {
      pauseMenu.hide();
    } else {
      menu.hide();
    }
    overlayReturn = from;
    if (target === 'help') {
      help.show();
    } else {
      settingsPanel.show();
    }
  }

  // 开发环境提供只读快照；生产构建会摇掉整段入口。
  if (import.meta.env.DEV) {
    installDevSnapshotBridge(() => game);
  }

  const hideOverlays = (): void => {
    help.hide();
    settingsPanel.hide();
    pauseMenu.hide();
    resultPanel.hide();
    overlayReturn = null;
  };

  const returnToCharacterSelect = (): void => {
    const lastCharacterId = runSessions.lastCharacterId;
    runSessions.endRun();
    // 主动返回选角即放弃本局；结算路径已清过一次，这里幂等。
    clearRunCheckpoint();
    hideOverlays();
    const previous = game;
    game = null;
    if (previous) destroyRunGame(previous);
    menu.hide();
    characterSelect?.show(lastCharacterId);
  };

  const startRun = (
    characterId: CharacterId,
    checkpoint: RunCheckpoint | null = null,
  ): void => {
    characterSelect?.hide();
    hideOverlays();
    runSessions.endRun();
    // 新开一局不带入旧检查点；续局则保留快照直到下一次安全检查点覆盖它。
    if (!checkpoint) clearRunCheckpoint();
    const session = runSessions.beginRun(characterId);
    destroyRunGame(game);
    const created = createRunGame({
      characterId: session.characterId,
      settingsStore,
      checkpoint,
      soundPlayer,
    });
    if (import.meta.env.DEV) registerDevGame(created);
    game = created;
    created.events.on(PAUSE_MENU_EVENT, (payload: PauseMenuPayload) => {
      help.hide();
      settingsPanel.hide();
      resultPanel.hide();
      overlayReturn = null;
      pauseMenu.show(payload.reason);
    });
    created.events.on(RUN_RESULT_EVENT, (payload: RunResultPayload) => {
      // 结算面板接管结果阶段；暂停等其他覆盖层先收起。
      pauseMenu.hide();
      help.hide();
      settingsPanel.hide();
      overlayReturn = null;
      resultPanel.show(payload);
    });
    created.events.on(RETURN_TO_CHARACTER_SELECT_EVENT, () => {
      // 结算面板可见时由面板决定去向（重开/选角/记录），场景的 Enter 不再重复处理。
      if (resultPanel.isVisible()) return;
      // 不要在 Phaser 自己的输入回调里同步销毁游戏，留到下一帧处理。
      globalThis.setTimeout(() => {
        // 期间若已用同角色重开，旧局事件不得再销毁新局。
        if (game !== created) return;
        returnToCharacterSelect();
      }, 0);
    });
  };

  /** 菜单“继续试炼”：重新读取快照，避免使用过期状态。 */
  const continueRun = (): void => {
    const loaded = loadRunCheckpoint();
    if (loaded.status !== 'ok') {
      // 快照在菜单显示后被清除或损坏：重新显示菜单与提示，不进入战斗。
      menu.show();
      return;
    }
    startRun(loaded.checkpoint.characterId, loaded.checkpoint);
  };

  const readResumeState = (): MenuResumeState => {
    const loaded = loadRunCheckpoint();
    if (loaded.status === 'ok') {
      return { available: true, invalid: null };
    }
    if (loaded.status === 'corrupt') {
      return { available: false, invalid: 'corrupt', detail: loaded.reason };
    }
    if (loaded.status === 'unsupported') {
      return { available: false, invalid: 'unsupported' };
    }
    return { available: false, invalid: null };
  };

  const menu = mountMenu({
    doc,
    onStart: () => {
      characterSelect?.show(runSessions.lastCharacterId);
    },
    onContinue: continueRun,
    onHelp: () => openSubOverlay('help', 'menu'),
    onSettings: () => openSubOverlay('settings', 'menu'),
    getResumeState: readResumeState,
    onResetSave: () => {
      clearRunCheckpoint();
    },
  });

  characterSelect = mountCharacterSelect({
    doc,
    initialCharacterId: runSessions.lastCharacterId,
    onConfirm: startRun,
    onBack: () => {
      characterSelect?.hide();
      menu.show();
    },
  });

  // 开发入口：?dev=1 直接以指定角色开局，跳过菜单与选角；生产构建不保留。
  const devScenario =
    import.meta.env.DEV && typeof location !== 'undefined'
      ? parseDevScenario(location.search)
      : null;
  if (devScenario) {
    menu.hide();
    startRun(devScenario.characterId ?? runSessions.lastCharacterId);
  }

  return () => {
    removeSoundUnlock();
    soundPlayer.destroy();
    runSessions.endRun();
    hideOverlays();
    destroyRunGame(game);
    game = null;
    visibilityReaper.dispose();
    characterSelect?.destroy();
    help.destroy();
    settingsPanel.destroy();
  };
}
