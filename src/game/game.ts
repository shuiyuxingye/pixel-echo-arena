import Phaser from 'phaser';
import { SOUND_PLAYER_REGISTRY_KEY, type SoundPlayer } from './audio';
import { VIEWPORT } from './config';
import type { CharacterId } from './data';
import { RUN_CHARACTER_REGISTRY_KEY } from './run-session';
import { RUN_CHECKPOINT_REGISTRY_KEY, type RunCheckpoint } from './run-save';
import { RUN_SETTINGS_REGISTRY_KEY, type SettingsStore } from './settings';
import { ArenaScene } from './scenes/ArenaScene';

export interface GameOptions {
  /** 选角页确认的角色；写入 registry，场景创建时只读取一次。 */
  readonly characterId?: CharacterId;
  /** 应用壳与设置面板共享的设置 store；场景读取键位并订阅即时修改。 */
  readonly settingsStore?: SettingsStore;
  /** 续局快照；提供时场景从该检查点恢复并以暂停状态开场。 */
  readonly checkpoint?: RunCheckpoint | null;
  /** 应用壳创建的本地合成音效播放器；首个键盘确认后启用。 */
  readonly soundPlayer?: SoundPlayer;
}

/** Phaser 游戏配置。视口保持 960×540 逻辑尺寸，由 CSS/Scale 等比放大。 */
export function createGameConfig(
  parent: string,
  options: GameOptions = {},
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0d0b12',
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    callbacks: {
      preBoot: (game) => {
        if (options.characterId) {
          game.registry.set(RUN_CHARACTER_REGISTRY_KEY, options.characterId);
        }
        if (options.settingsStore) {
          game.registry.set(RUN_SETTINGS_REGISTRY_KEY, options.settingsStore);
        }
        if (options.checkpoint) {
          game.registry.set(RUN_CHECKPOINT_REGISTRY_KEY, options.checkpoint);
        }
        if (options.soundPlayer) {
          game.registry.set(SOUND_PLAYER_REGISTRY_KEY, options.soundPlayer);
        }
      },
    },
    scene: [ArenaScene],
  };
}

export function createGame(parent: string, options: GameOptions = {}): Phaser.Game {
  return new Phaser.Game(createGameConfig(parent, options));
}
