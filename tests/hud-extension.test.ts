/**
 * US-057 战斗 HUD 扩展：
 * 短提示（金币/战利品资格）、普通敌人血条/名称规则、预警与职业配色，
 * 以及暂停/商店/奖励面板后的 HUD 重同步接线。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHARACTER_EFFECT_COLORS, ENEMY_WARNING } from '../src/game/feedback';
import {
  HUD_TOAST,
  HUD_TOAST_COLORS,
  formatGoldToast,
  formatLootToast,
  hudToastViews,
  pruneHudToasts,
  pushHudToast,
  type HudToast,
} from '../src/game/hud-toast';
import { createHudState, applyHudEvent, buildHudModel } from '../src/game/hud';
import {
  ENEMY_REVEAL_SECONDS,
  enemyHudVisibility,
} from '../src/game/markers';
import { CHARACTER_LIST } from '../src/game/data';

const ROOT = resolve(import.meta.dirname, '..');

function readSource(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

function toastTexts(toasts: readonly HudToast[]): string[] {
  return toasts.map((toast) => toast.text);
}

describe('战斗短提示', () => {
  it('金币与战利品资格用固定短句，不夹带换行或弹窗', () => {
    expect(formatGoldToast(3)).toBe('金币+3');
    expect(formatGoldToast(18)).toBe('金币+18');
    expect(formatGoldToast(-2)).toBe('金币+0');
    expect(formatGoldToast(Number.NaN)).toBe('金币+0');
    expect(formatLootToast()).toBe('战利品资格+1');
    expect(formatLootToast(2)).toBe('战利品资格+2');
    expect(formatGoldToast(3)).not.toContain('\n');
    expect(formatLootToast()).not.toContain('\n');
  });

  it('入队、上限与过期清理', () => {
    let toasts: readonly HudToast[] = [];
    toasts = pushHudToast(toasts, { kind: 'gold', text: '金币+1' }, 0, 1);
    toasts = pushHudToast(toasts, { kind: 'loot', text: '战利品资格+1' }, 0, 2);
    expect(toastTexts(toasts)).toEqual(['金币+1', '战利品资格+1']);

    // 空白文本不入队，返回原引用便于场景跳过重绘。
    const unchanged = pushHudToast(toasts, { kind: 'gold', text: '   ' }, 0, 3);
    expect(unchanged).toBe(toasts);

    // 超过同屏上限时丢弃最旧的一条。
    for (let id = 3; id <= 6; id += 1) {
      toasts = pushHudToast(
        toasts,
        { kind: 'gold', text: `金币+${id}` },
        0,
        id,
      );
    }
    expect(toasts).toHaveLength(HUD_TOAST.maxVisible);
    expect(toastTexts(toasts)).toEqual([
      '金币+3',
      '金币+4',
      '金币+5',
      '金币+6',
    ]);
  });

  it('持续时间结束后移除，边界值与非法时间都安全', () => {
    const toasts = pushHudToast([], { kind: 'gold', text: '金币+3' }, 0, 1);
    expect(pruneHudToasts(toasts, HUD_TOAST.durationSeconds - 0.01)).toHaveLength(1);
    expect(pruneHudToasts(toasts, HUD_TOAST.durationSeconds)).toHaveLength(0);
    expect(pruneHudToasts(toasts, Number.NaN)).toHaveLength(1);
    const views = hudToastViews(toasts, 0);
    expect(views[0]?.alpha).toBe(1);
    expect(views[0]?.y).toBe(HUD_TOAST.topY);
  });

  it('视图按顺序堆叠并在后段淡出，不阻塞战斗', () => {
    let toasts: readonly HudToast[] = [];
    toasts = pushHudToast(toasts, { kind: 'gold', text: '金币+3' }, 10, 1);
    toasts = pushHudToast(toasts, { kind: 'loot', text: '战利品资格+1' }, 10, 2);
    const start = hudToastViews(toasts, 10);
    expect(start).toHaveLength(2);
    expect(start[1]?.y).toBe(HUD_TOAST.topY + HUD_TOAST.lineHeight);
    expect(start.every((view) => view.alpha === 1)).toBe(true);

    const fadeAt =
      10 + HUD_TOAST.durationSeconds * (HUD_TOAST.fadeStartRatio + 0.1);
    const fading = hudToastViews(toasts, fadeAt);
    expect(fading[0]?.alpha).toBeLessThan(1);
    expect(fading[0]?.alpha).toBeGreaterThan(0);
    // 自上而上移动，但不会离开 HUD 顶部安全区。
    expect(fading[0]?.y).toBeLessThan(HUD_TOAST.topY);
    expect(fading[0]?.y).toBeGreaterThan(HUD_TOAST.topY - HUD_TOAST.rise - 1);
  });

  it('每种提示都有可读的文字颜色', () => {
    for (const color of Object.values(HUD_TOAST_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('普通敌人血条与名称规则', () => {
  it('普通敌人未受伤时不显示血条与名称', () => {
    expect(
      enemyHudVisibility({
        boss: false,
        elite: false,
        revealRemainingSeconds: 0,
      }),
    ).toEqual({ showHealthBar: false, showName: false });
  });

  it('普通敌人受伤后的短窗口内显示血条与名称', () => {
    expect(ENEMY_REVEAL_SECONDS).toBeGreaterThan(0);
    expect(
      enemyHudVisibility({
        boss: false,
        elite: false,
        revealRemainingSeconds: ENEMY_REVEAL_SECONDS,
      }),
    ).toEqual({ showHealthBar: true, showName: true });
    expect(
      enemyHudVisibility({
        boss: false,
        elite: false,
        revealRemainingSeconds: 0.01,
      }).showHealthBar,
    ).toBe(true);
    expect(
      enemyHudVisibility({
        boss: false,
        elite: false,
        revealRemainingSeconds: -1,
      }),
    ).toEqual({ showHealthBar: false, showName: false });
  });

  it('精英与 Boss 常驻血条与名称，不依赖受伤窗口', () => {
    for (const input of [
      { boss: true, elite: false, revealRemainingSeconds: 0 },
      { boss: false, elite: true, revealRemainingSeconds: 0 },
      { boss: true, elite: true, revealRemainingSeconds: 0 },
    ]) {
      expect(enemyHudVisibility(input)).toEqual({
        showHealthBar: true,
        showName: true,
      });
    }
  });
});

describe('敌方预警与友方配色', () => {
  it('敌方预警统一为暖红/橙，红色分量占主导', () => {
    for (const color of [ENEMY_WARNING.fill, ENEMY_WARNING.stroke, ENEMY_WARNING.core]) {
      const red = (color >> 16) & 0xff;
      const green = (color >> 8) & 0xff;
      const blue = color & 0xff;
      // 暖红/橙要求红色分量占主导；纯红 0xff3b3b 的绿蓝相等也是合法暖红。
      expect(red).toBeGreaterThan(green);
      expect(red).toBeGreaterThan(blue);
    }
  });

  it('四名角色的友方施法色互不相同', () => {
    const primaries = CHARACTER_LIST.map(
      (character) => CHARACTER_EFFECT_COLORS[character.id].primary,
    );
    expect(new Set(primaries).size).toBe(CHARACTER_LIST.length);
  });
});

describe('HUD 字段与重同步', () => {
  it('波次行带倒计时，金币与生命/护盾/经验都有文字标签', () => {
    let state = createHudState('amiya');
    state = applyHudEvent(state, {
      type: 'wave',
      wave: 4,
      kills: 12,
      aliveEnemies: 3,
      remainingSeconds: 41.2,
      unlimited: false,
    });
    state = applyHudEvent(state, { type: 'gold', gold: 87 });
    state = applyHudEvent(state, {
      type: 'vitals',
      health: 60,
      maxHealth: 100,
      shield: 15,
      shieldRemaining: 2.5,
    });
    const model = buildHudModel(state);
    expect(model.lines.wave).toContain('第 4 波');
    expect(model.lines.wave).toContain('剩余 42s');
    expect(model.lines.gold).toContain('金币');
    expect(model.lines.gold).toContain('87');
    expect(model.lines.vitals).toContain('生命');
    expect(model.lines.vitals).toContain('护盾');
    expect(model.lines.progress).toContain('经验');
    // J/K/L 与自由技能槽的键位由底部技能条独立渲染，字段仍保留冷却文字。
    expect(model.skills.map((skill) => skill.key)).toEqual(['J', 'K', 'L']);
    expect(model.dodge.text).toContain('闪避');
  });

  it('场景在暂停、奖励与下一波恢复时整体重同步 HUD', () => {
    const scene = readSource('src/game/scenes/ArenaScene.ts');
    expect(scene).toContain('private resyncHudFromSystems(): void');
    expect(scene).toContain('this.resyncHudFromSystems();');
    // 暂停恢复：在面 hides 后立即重写金币/护盾/冷却/倒计时。
    expect(scene).toMatch(
      /resumeCombat\([\s\S]*pauseHint\.setVisible\(false\);[\s\S]*resyncHudFromSystems\(\)/,
    );
    // 奖励面板关闭回到战斗时重同步。
    expect(scene).toMatch(
      /runState\.returnToCombat\(\);\s*\n\s*\/\/[^\n]*\n\s*this\.resyncHudFromSystems\(\);/,
    );
    // 离开波间/商店后进入下一波时重同步。
    expect(scene).toMatch(
      /startWave\(this\.waveNumber \+ 1\);[\s\S]*resyncHudFromSystems\(\)/,
    );
    for (const marker of [
      'syncHealthHud();',
      'updateWaveHud();',
      'syncSkillHud();',
      'syncBurstHud();',
      'syncChimeraHud();',
    ]) {
      expect(scene).toContain(marker);
    }
  });

  it('场景用短提示上报金币与战利品资格，不弹窗', () => {
    const scene = readSource('src/game/scenes/ArenaScene.ts');
    expect(scene).toContain("this.showHudToast('gold', formatGoldToast(amount));");
    expect(scene).toContain("this.showHudToast('loot', formatLootToast(1));");
    expect(scene).toContain(
      "this.showHudToast('gold', formatGoldToast(completionGold));",
    );
    expect(scene).toContain('hudToastViews(this.hudToasts, this.simulatedSeconds)');
    // 短提示每逻辑步按模拟秒推进；暂停时模拟秒不前进，与 HUD 一起冻结。
    expect(scene).toMatch(/updateCombat\(stepSeconds\);[\s\S]*refreshHudToasts\(\)/);
    // 金币入账仍有原地的击杀点浮字，但短提示不创建任何 DOM 弹窗。
    const domPanels = readSource('src/ui/pause-menu.ts');
    expect(domPanels).not.toContain('金币+');
  });

  it('敌人同步用纯规则控制血条/名称显隐', () => {
    const scene = readSource('src/game/scenes/ArenaScene.ts');
    expect(scene).toContain('enemyHudVisibility({');
    expect(scene).toContain('revealRemainingSeconds: view.revealRemaining');
    expect(scene).toContain('view.revealRemaining = ENEMY_REVEAL_SECONDS;');
    expect(scene).toContain('view.hpFill.setVisible(visibility.showHealthBar);');
    expect(scene).toContain('view.nameText.setVisible(visibility.showName);');
    // 普通敌人创建时不显示血条/名称；精英与 Boss 常驻。
    expect(scene).toMatch(
      /const alwaysShowHud = isBoss \|\| unit\.enemy\.elite === true;[\s\S]*hpBackground\.setVisible\(alwaysShowHud\)/,
    );
  });
});
