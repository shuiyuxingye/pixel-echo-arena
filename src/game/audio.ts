/**
 * 本地合成音效（docs/game-design.md §8）。
 *
 * 不加载外链或在线素材：所有声音由 WebAudio 振荡器在运行时合成。
 * 浏览器要求用户手势后才能播放，因此首个键盘确认调用 `unlock()` 之前
 * `play()` 一律返回 false，不排队、不延迟补播。
 *
 * 本模块不依赖 Phaser；测试通过注入假的 AudioContext 断言触发与参数。
 */

import type { SettingsStore } from './settings';

/** Phaser registry 中共享声音播放器的键；应用壳创建后供场景复用。 */
export const SOUND_PLAYER_REGISTRY_KEY = 'pixel-echo.sound-player';

export type SfxName =
  | 'attack'
  | 'hit'
  | 'enemyDeath'
  | 'playerHurt'
  | 'dodge'
  | 'skillK'
  | 'skillL'
  | 'upgrade'
  | 'warning'
  | 'victory'
  | 'defeat';

export interface SfxTone {
  readonly wave: OscillatorType;
  readonly fromHz: number;
  /** 与 fromHz 相同表示不滑音。 */
  readonly toHz: number;
  readonly durationMs: number;
  /** 峰值增益，播放时衰减到接近 0，避免爆音。 */
  readonly gain: number;
  readonly delayMs?: number;
}

export interface SfxDefinition {
  readonly tones: readonly SfxTone[];
}

/** 固定音效表；测试逐条断言时长与确定性，不依赖随机噪声。 */
export const SFX_LIBRARY: Readonly<Record<SfxName, SfxDefinition>> = {
  attack: {
    tones: [{ wave: 'square', fromHz: 240, toHz: 140, durationMs: 55, gain: 0.04 }],
  },
  hit: {
    tones: [{ wave: 'triangle', fromHz: 520, toHz: 300, durationMs: 65, gain: 0.06 }],
  },
  enemyDeath: {
    tones: [
      { wave: 'sawtooth', fromHz: 200, toHz: 70, durationMs: 170, gain: 0.05 },
      { wave: 'triangle', fromHz: 320, toHz: 90, durationMs: 120, gain: 0.03, delayMs: 24 },
    ],
  },
  playerHurt: {
    tones: [{ wave: 'square', fromHz: 170, toHz: 70, durationMs: 180, gain: 0.07 }],
  },
  dodge: {
    tones: [{ wave: 'sine', fromHz: 520, toHz: 860, durationMs: 110, gain: 0.04 }],
  },
  skillK: {
    tones: [
      { wave: 'triangle', fromHz: 360, toHz: 620, durationMs: 120, gain: 0.05 },
      { wave: 'sine', fromHz: 620, toHz: 880, durationMs: 100, gain: 0.03, delayMs: 70 },
    ],
  },
  skillL: {
    tones: [
      { wave: 'sawtooth', fromHz: 220, toHz: 440, durationMs: 180, gain: 0.05 },
      { wave: 'triangle', fromHz: 440, toHz: 660, durationMs: 160, gain: 0.04, delayMs: 120 },
      { wave: 'sine', fromHz: 880, toHz: 660, durationMs: 140, gain: 0.03, delayMs: 240 },
    ],
  },
  upgrade: {
    tones: [
      { wave: 'sine', fromHz: 523, toHz: 523, durationMs: 90, gain: 0.05 },
      { wave: 'sine', fromHz: 659, toHz: 659, durationMs: 90, gain: 0.05, delayMs: 90 },
      { wave: 'sine', fromHz: 784, toHz: 784, durationMs: 150, gain: 0.05, delayMs: 180 },
    ],
  },
  warning: {
    tones: [
      { wave: 'square', fromHz: 620, toHz: 620, durationMs: 80, gain: 0.04 },
      { wave: 'square', fromHz: 500, toHz: 500, durationMs: 80, gain: 0.04, delayMs: 120 },
    ],
  },
  victory: {
    tones: [
      { wave: 'sine', fromHz: 523, toHz: 523, durationMs: 120, gain: 0.05 },
      { wave: 'sine', fromHz: 659, toHz: 659, durationMs: 120, gain: 0.05, delayMs: 120 },
      { wave: 'sine', fromHz: 784, toHz: 784, durationMs: 220, gain: 0.05, delayMs: 240 },
    ],
  },
  defeat: {
    tones: [
      { wave: 'triangle', fromHz: 330, toHz: 220, durationMs: 220, gain: 0.05 },
      { wave: 'triangle', fromHz: 220, toHz: 110, durationMs: 320, gain: 0.05, delayMs: 180 },
    ],
  },
};

/** 玩法事件 → 固定音效，避免场景各处散落字符串。 */
export const COMBAT_SFX = {
  attack: 'attack',
  enemyHit: 'hit',
  enemyDeath: 'enemyDeath',
  playerHurt: 'playerHurt',
  dodge: 'dodge',
  skillK: 'skillK',
  skillL: 'skillL',
  upgrade: 'upgrade',
  enemyWarning: 'warning',
  victory: 'victory',
  defeat: 'defeat',
} as const satisfies Readonly<Record<string, SfxName>>;

export interface SoundPlayerState {
  /** 是否已收到首个键盘确认。 */
  readonly unlocked: boolean;
  readonly muted: boolean;
  readonly lastCue: SfxName | null;
  readonly playCount: number;
}

export interface SoundPlayer {
  /** 首个键盘确认时调用；创建/恢复 AudioContext，之后才允许播放。 */
  unlock(): void;
  /** 播放固定音效；未解锁、静音或浏览器不支持时返回 false。 */
  play(cue: SfxName): boolean;
  getState(): SoundPlayerState;
  destroy(): void;
}

export interface SoundPlayerOptions {
  /** 测试注入；默认使用全局 AudioContext（不存在时返回 null）。 */
  readonly contextFactory?: () => AudioContext | null;
  /** 每次播放时读取，静音开关立即生效。 */
  readonly isMuted?: () => boolean;
}

type AudioContextConstructor = new () => AudioContext;

function resolveAudioContextConstructor(): AudioContextConstructor | null {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** 默认工厂：不支持 WebAudio 的环境返回 null，游戏照常运行。 */
export function createDefaultAudioContext(): AudioContext | null {
  const Constructor = resolveAudioContextConstructor();
  if (!Constructor) return null;
  try {
    return new Constructor();
  } catch {
    return null;
  }
}

/** 全部事件使用同一套本地合成规则，没有外链或在线素材。 */
export function createSoundPlayer(options: SoundPlayerOptions = {}): SoundPlayer {
  const factory = options.contextFactory ?? createDefaultAudioContext;
  const isMuted = options.isMuted ?? (() => false);
  let context: AudioContext | null = null;
  let unlocked = false;
  let lastCue: SfxName | null = null;
  let playCount = 0;

  const ensureContext = (): AudioContext | null => {
    if (context) return context;
    context = factory();
    return context;
  };

  const unlock = (): void => {
    unlocked = true;
    const active = ensureContext();
    if (active?.state === 'suspended') {
      void Promise.resolve(active.resume()).catch(() => undefined);
    }
  };

  const play = (cue: SfxName): boolean => {
    if (!unlocked || isMuted()) return false;
    const active = ensureContext();
    if (!active) return false;

    const definition = SFX_LIBRARY[cue];
    const startAt = active.currentTime;
    for (const tone of definition.tones) {
      const oscillator = active.createOscillator();
      const gain = active.createGain();
      const toneStart = startAt + (tone.delayMs ?? 0) / 1000;
      const toneEnd = toneStart + tone.durationMs / 1000;
      oscillator.type = tone.wave;
      oscillator.frequency.setValueAtTime(tone.fromHz, toneStart);
      if (tone.toHz !== tone.fromHz) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(1, tone.toHz),
          toneEnd,
        );
      }
      gain.gain.setValueAtTime(Math.max(0.0001, tone.gain), toneStart);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);
      oscillator.connect(gain);
      gain.connect(active.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneEnd + 0.01);
    }

    lastCue = cue;
    playCount += 1;
    return true;
  };

  return {
    unlock,
    play,
    getState: () => ({
      unlocked,
      muted: isMuted(),
      lastCue,
      playCount,
    }),
    destroy: () => {
      const active = context;
      context = null;
      unlocked = false;
      if (active) void Promise.resolve(active.close()).catch(() => undefined);
    },
  };
}

/** 应用壳创建共享播放器：静音开关读取设置 store，切换后下一次播放立即生效。 */
export function createSettingsSoundPlayer(store: SettingsStore): SoundPlayer {
  return createSoundPlayer({ isMuted: () => store.get().muted });
}

type KeyboardUnlockTarget = Pick<Document, 'addEventListener' | 'removeEventListener'>;

/**
 * 首个键盘确认后启用音频：只监听一次 keydown，不拦截按键、不 preventDefault，
 * 因此不会影响菜单或战斗的键盘操作。返回取消函数供应用壳销毁时清理。
 */
export function installSoundUnlock(
  target: KeyboardUnlockTarget,
  player: SoundPlayer,
): () => void {
  const onFirstKey = (): void => {
    player.unlock();
    target.removeEventListener('keydown', onFirstKey);
  };
  target.addEventListener('keydown', onFirstKey);
  return () => target.removeEventListener('keydown', onFirstKey);
}
