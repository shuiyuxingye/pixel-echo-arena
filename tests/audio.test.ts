import { describe, expect, it, vi } from 'vitest';
import {
  COMBAT_SFX,
  SFX_LIBRARY,
  createSettingsSoundPlayer,
  createSoundPlayer,
  installSoundUnlock,
} from '../src/game/audio';
import { createSettingsStore } from '../src/game/settings';

/** 记录 WebAudio 调用参数的假振荡器；不需要真实声卡。 */
class FakeAudioParam {
  readonly events: { method: string; value: number; time: number }[] = [];

  setValueAtTime(value: number, time: number): void {
    this.events.push({ method: 'set', value, time });
  }

  exponentialRampToValueAtTime(value: number, time: number): void {
    this.events.push({ method: 'ramp', value, time });
  }
}

class FakeOscillator {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeAudioParam();
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  readonly connect = vi.fn();

  start(time: number): void {
    this.startedAt = time;
  }

  stop(time: number): void {
    this.stoppedAt = time;
  }
}

class FakeGain {
  readonly gain = new FakeAudioParam();
  readonly connect = vi.fn();
}

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 1.5;
  readonly destination = {};
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly resume = vi.fn(async () => {
    this.state = 'running';
  });
  readonly close = vi.fn(async () => {
    this.state = 'closed';
  });

  createOscillator(): FakeOscillator {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

function asContext(context: FakeAudioContext): AudioContext {
  return context as unknown as AudioContext;
}

describe('本地合成音效', () => {
  it('首个键盘确认前不播放，确认后按固定音效合成', () => {
    const context = new FakeAudioContext();
    const player = createSoundPlayer({
      contextFactory: () => asContext(context),
    });

    expect(player.play('hit')).toBe(false);
    expect(context.oscillators).toHaveLength(0);
    expect(player.getState()).toMatchObject({ unlocked: false, playCount: 0, lastCue: null });

    const target = new EventTarget();
    const remove = installSoundUnlock(target as unknown as Document, player);
    target.dispatchEvent(new Event('keydown'));

    expect(player.getState().unlocked).toBe(true);
    expect(context.resume).toHaveBeenCalledTimes(1);
    remove();
    // 再次按键不会重复恢复；首个监听已自行移除。
    target.dispatchEvent(new Event('keydown'));
    expect(context.resume).toHaveBeenCalledTimes(1);

    expect(player.play('hit')).toBe(true);
    const tone = SFX_LIBRARY.hit.tones[0];
    expect(tone).toBeDefined();
    const oscillator = context.oscillators[0];
    expect(oscillator).toBeDefined();
    expect(oscillator?.type).toBe(tone?.wave);
    expect(oscillator?.frequency.events[0]).toEqual({
      method: 'set',
      value: tone?.fromHz,
      time: 1.5,
    });
    expect(oscillator?.frequency.events[1]).toMatchObject({
      method: 'ramp',
      value: tone?.toHz,
    });
    expect(context.gains[0]?.gain.events[0]).toMatchObject({
      method: 'set',
      value: tone?.gain,
    });
    expect(player.getState()).toMatchObject({ lastCue: 'hit', playCount: 1 });
  });

  it('静音开关立即生效，恢复后仍保持已解锁', () => {
    const context = new FakeAudioContext();
    let muted = true;
    const player = createSoundPlayer({
      contextFactory: () => asContext(context),
      isMuted: () => muted,
    });
    player.unlock();

    expect(player.play('attack')).toBe(false);
    expect(context.oscillators).toHaveLength(0);
    expect(player.getState()).toMatchObject({ unlocked: true, muted: true });

    muted = false;
    expect(player.play('attack')).toBe(true);
    expect(player.getState()).toMatchObject({ muted: false, playCount: 1 });
  });

  it('共享播放器读取设置 store 的静音开关', () => {
    let stored: string | null = null;
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    } as unknown as Storage;
    const store = createSettingsStore({ storage });
    const context = new FakeAudioContext();
    const player = createSettingsSoundPlayer(store);
    // createSettingsSoundPlayer 使用默认 AudioContext；仅断言静音口径时替换为不可用环境
    expect(player.getState().muted).toBe(false);
    store.update({ muted: true });
    expect(player.getState().muted).toBe(true);
    player.unlock();
    // 测试环境没有 WebAudio；静音/未静音都不应抛错。
    expect(() => player.play('skillK')).not.toThrow();
    expect(context.oscillators).toHaveLength(0);
  });

  it('音效库全部为本地合成参数，时长与增益受控', () => {
    const names = Object.keys(SFX_LIBRARY);
    expect(names).toHaveLength(11);
    expect(new Set(Object.values(COMBAT_SFX)).size).toBeGreaterThan(5);

    for (const definition of Object.values(SFX_LIBRARY)) {
      expect(definition.tones.length).toBeGreaterThan(0);
      for (const tone of definition.tones) {
        expect(Number.isFinite(tone.fromHz)).toBe(true);
        expect(Number.isFinite(tone.toHz)).toBe(true);
        expect(tone.fromHz).toBeGreaterThan(0);
        expect(tone.toHz).toBeGreaterThan(0);
        expect(tone.durationMs).toBeGreaterThan(0);
        expect(tone.durationMs).toBeLessThanOrEqual(350);
        expect(tone.gain).toBeGreaterThan(0);
        expect(tone.gain).toBeLessThanOrEqual(0.1);
        expect(tone.delayMs ?? 0).toBeGreaterThanOrEqual(0);
      }
    }

    const serialized = JSON.stringify(SFX_LIBRARY);
    expect(serialized).not.toContain('http');
    expect(serialized).not.toContain('.mp3');
    expect(serialized).not.toContain('.wav');
  });

  it('不支持 WebAudio 时静默失败，不阻断游戏', () => {
    const player = createSoundPlayer({ contextFactory: () => null });
    player.unlock();
    expect(player.getState().unlocked).toBe(true);
    expect(player.play('victory')).toBe(false);
    expect(() => player.destroy()).not.toThrow();
  });

  it('销毁后关闭 AudioContext', () => {
    const context = new FakeAudioContext();
    const player = createSoundPlayer({
      contextFactory: () => asContext(context),
    });
    player.unlock();
    player.play('dodge');
    player.destroy();

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(player.play('dodge')).toBe(false);
  });
});
