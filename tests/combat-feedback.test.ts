import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHARACTER_EFFECT_COLORS,
  ENEMY_WARNING,
  FRIENDLY_EFFECT_DEPTH,
  HIT_FEEDBACK,
  characterEffectColors,
  planHitFeedback,
} from '../src/game/feedback';
import {
  PLAYER_ACTION_COLUMNS,
  PLAYER_CAST_DIRECTIONS,
  PLAYER_CAST_ROW,
  PLAYER_DIRECTIONS,
  PLAYER_SPRITE_IDS,
  playerCastFrameIndex,
  playerFrameIndex,
} from '../src/game/player-art';

const ROOT = process.cwd();

function readSource(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function red(color: number): number {
  return (color >> 16) & 0xff;
}

function green(color: number): number {
  return (color >> 8) & 0xff;
}

function blue(color: number): number {
  return color & 0xff;
}

describe('命中与技能反馈', () => {
  it('未实际命中不闪白不跳字，命中固定闪白并显示伤害字', () => {
    expect(planHitFeedback(false, 20)).toBeNull();

    const absorbed = planHitFeedback(true, 0);
    expect(absorbed).toEqual({
      flashColor: 0xffffff,
      flashDurationMs: HIT_FEEDBACK.flashDurationMs,
      showDamageNumber: false,
    });

    const hit = planHitFeedback(true, 36);
    expect(hit).toEqual({
      flashColor: HIT_FEEDBACK.flashColor,
      flashDurationMs: HIT_FEEDBACK.flashDurationMs,
      showDamageNumber: true,
    });
    expect(HIT_FEEDBACK.flashColor).toBe(0xffffff);
    expect(HIT_FEEDBACK.flashDurationMs).toBeGreaterThan(0);
  });

  it('四角色技能使用各自配色，未知角色稳定回退', () => {
    const ids = PLAYER_SPRITE_IDS;
    expect(ids).toHaveLength(4);
    const primary = ids.map((id) => CHARACTER_EFFECT_COLORS[id].primary);
    expect(new Set(primary).size).toBe(4);
    const labels = ids.map((id) => CHARACTER_EFFECT_COLORS[id].label);
    expect(new Set(labels).size).toBe(4);

    for (const id of ids) {
      const colors = CHARACTER_EFFECT_COLORS[id];
      expect(colors.projectileFill).toBeGreaterThan(0);
      expect(colors.projectileStroke).toBeGreaterThan(0);
      expect(colors.secondary).toBeGreaterThan(0);
    }
    expect(characterEffectColors('unknown')).toBe(CHARACTER_EFFECT_COLORS.vishdal);
  });

  it('敌方警戒色统一暖红，且绘制深度高于全部友方特效', () => {
    for (const color of [
      ENEMY_WARNING.fill,
      ENEMY_WARNING.stroke,
      ENEMY_WARNING.core,
      ENEMY_WARNING.projectile,
    ]) {
      expect(red(color)).toBeGreaterThan(green(color));
      expect(red(color)).toBeGreaterThan(blue(color));
    }

    const friendlyDepths = Object.values(FRIENDLY_EFFECT_DEPTH);
    expect(friendlyDepths.length).toBeGreaterThan(0);
    for (const depth of friendlyDepths) {
      expect(ENEMY_WARNING.depth).toBeGreaterThan(depth);
    }
  });

  it('四向动画与八向施法帧配置完整，行走至少两帧', () => {
    expect(PLAYER_ACTION_COLUMNS.walk.length).toBeGreaterThanOrEqual(2);
    expect(PLAYER_CAST_DIRECTIONS).toHaveLength(8);

    const frames = new Set<number>();
    for (const direction of PLAYER_DIRECTIONS) {
      for (const action of Object.keys(PLAYER_ACTION_COLUMNS) as Array<
        keyof typeof PLAYER_ACTION_COLUMNS
      >) {
        const index = playerFrameIndex(direction, action);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(frames.has(index)).toBe(false);
        frames.add(index);
      }
    }

    const castFrames = PLAYER_CAST_DIRECTIONS.map(playerCastFrameIndex);
    expect(new Set(castFrames).size).toBe(PLAYER_CAST_DIRECTIONS.length);
    for (const frame of castFrames) {
      expect(Math.floor(frame / 8)).toBe(PLAYER_CAST_ROW);
    }
  });

  it('场景接入闪白、受击动画、技能配色与音效事件', () => {
    const scene = readSource('src/game/scenes/ArenaScene.ts');

    // 命中反馈：纯逻辑计划 + 敌人身体闪白 + 伤害字。
    expect(scene).toContain('planHitFeedback(');
    expect(scene).toContain('flashEnemyHit(');
    expect(scene).toContain('setFillStyle(HIT_FEEDBACK.flashColor');
    expect(scene).toContain('feedback?.showDamageNumber');
    // 玩家受击播放四向受击帧并闪白。
    expect(scene).toContain("playerAnimationKey(direction, 'hurt'");
    expect(scene).toContain('hurtPoseSeconds');
    expect(scene).toContain('player.setTintFill(HIT_FEEDBACK.flashColor)');
    // 四角色技能配色与八向施法帧。
    expect(scene).toContain('characterEffectColors(this.character.id)');
    expect(scene).toContain('playerCastFrameIndex(this.castPoseFacing)');
    expect(scene).toContain('showCastPulse()');
    expect(scene).toContain('showUpgradePulse()');
    // 敌方预警统一暖红且高于友方特效层。
    expect(scene).toContain('ENEMY_WARNING.fill');
    expect(scene).toContain('ENEMY_WARNING.stroke');
    expect(scene).toContain('ENEMY_WARNING.depth');
    expect(scene).toContain('FRIENDLY_EFFECT_DEPTH.explosion');
    // 命中/死亡/技能/受伤/闪避/胜负均有固定音效触发。
    for (const cue of [
      'COMBAT_SFX.attack',
      'COMBAT_SFX.enemyHit',
      'COMBAT_SFX.enemyDeath',
      'COMBAT_SFX.playerHurt',
      'COMBAT_SFX.dodge',
      'COMBAT_SFX.skillK',
      'COMBAT_SFX.skillL',
      'COMBAT_SFX.upgrade',
      'COMBAT_SFX.enemyWarning',
      'COMBAT_SFX.victory',
      'COMBAT_SFX.defeat',
    ]) {
      expect(scene).toContain(cue);
    }
    expect(scene).toContain('this.soundPlayer?.unlock()');
  });

  it('应用壳创建共享播放器并在首个键盘确认后解锁', () => {
    const app = readSource('src/app.ts');
    expect(app).toContain('createSettingsSoundPlayer(settingsStore)');
    expect(app).toContain('installSoundUnlock(doc, soundPlayer)');
    expect(app).toContain('soundPlayer');
    expect(app).toContain('removeSoundUnlock()');

    const game = readSource('src/game/game.ts');
    expect(game).toContain('soundPlayer?: SoundPlayer');
    expect(game).toContain('SOUND_PLAYER_REGISTRY_KEY');
  });
});
