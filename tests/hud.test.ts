/**
 * HUD 字段、事件映射与三档视口布局（US-025b）。
 * 纯逻辑断言 + 场景/DOM 接入检查；浏览器截图与真实字号验收由 Validator 执行。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHARACTER_LIST,
  type CharacterId,
} from '../src/game/data';
import {
  A02_HITS_PER_TRIGGER,
  EMOTIONAL_ABSORPTION_HITS,
} from '../src/game/amiya';
import { DODGE } from '../src/game/movement';
import {
  HUD_DESIGN,
  HUD_FONT_PX,
  HUD_MIN_CSS_FONT_PX,
  HUD_MIN_FONT_PX,
  HUD_SKILL_BAR,
  HUD_SKILL_ICONS,
  HUD_VIEWPORTS,
  applyHudEvent,
  buildHudModel,
  computeHudSkillBarLayout,
  computeHudViewport,
  createHudState,
  estimateHudTextWidth,
  hudCooldownProgress,
  hudSkillIcon,
  hudSkillStatusText,
  hudTextFits,
  type HudSkillKey,
  type HudSkillState,
  type HudState,
} from '../src/game/hud';

const ROOT = resolve(import.meta.dirname, '..');

function readSource(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

function skill(
  key: HudSkillKey,
  overrides: Partial<HudSkillState> = {},
): HudSkillState {
  return {
    key,
    name: '技能',
    status: 'ready',
    cooldownRemaining: 0,
    cooldownTotal: 10,
    effectRemaining: 0,
    detail: '',
    ...overrides,
  };
}

function withSkills(
  state: HudState,
  overrides: Partial<Record<HudSkillKey, Partial<HudSkillState>>>,
): HudState {
  let next = state;
  for (const key of ['J', 'K', 'L'] as const) {
    const patch = overrides[key];
    if (!patch) continue;
    next = applyHudEvent(next, {
      type: 'skill',
      skill: { ...next.skills[key], ...patch },
    });
  }
  return next;
}

describe('HUD 三档视口布局', () => {
  it('三档窗口等比缩放、letterbox 居中且不非等比拉伸', () => {
    const expected: Record<string, { scale: number; offsetY: number }> = {
      '1280x720': { scale: 1280 / 960, offsetY: 0 },
      '1440x900': { scale: 1.5, offsetY: 45 },
      '1920x1080': { scale: 2, offsetY: 0 },
    };
    for (const viewport of HUD_VIEWPORTS) {
      const layout = computeHudViewport(viewport.width, viewport.height);
      expect(layout.id).toBe(viewport.id);
      expect(layout.scale).toBeCloseTo(expected[viewport.id]!.scale, 6);
      expect(layout.canvasWidth).toBeCloseTo(viewport.width, 6);
      expect(layout.canvasHeight).toBeLessThanOrEqual(viewport.height + 1e-6);
      expect(layout.offsetX).toBeCloseTo(0, 6);
      expect(layout.offsetY).toBeCloseTo(expected[viewport.id]!.offsetY, 6);
      // 宽高比与逻辑视口一致：只缩放，不拉伸。
      expect(layout.canvasWidth / layout.canvasHeight).toBeCloseTo(
        HUD_DESIGN.width / HUD_DESIGN.height,
        6,
      );
    }
  });

  it('三档窗口下最小 HUD 字号仍 ≥16 CSS px', () => {
    for (const viewport of HUD_VIEWPORTS) {
      const layout = computeHudViewport(viewport.width, viewport.height);
      expect(layout.fitsMinimumFont).toBe(true);
      expect(layout.minCssFontSize).toBeGreaterThanOrEqual(HUD_MIN_CSS_FONT_PX);
      for (const size of Object.values(layout.cssFontSizes)) {
        expect(size).toBeGreaterThanOrEqual(HUD_MIN_CSS_FONT_PX);
      }
      expect(layout.cssFontSizes.small).toBeGreaterThanOrEqual(HUD_MIN_CSS_FONT_PX);
      expect(layout.cssFontSizes.body).toBeGreaterThanOrEqual(HUD_MIN_CSS_FONT_PX);
    }
  });

  it('低于最低窗口时明确标记字号不足，而不是假装通过', () => {
    const tiny = computeHudViewport(960, 540);
    expect(tiny.scale).toBe(1);
    expect(tiny.fitsMinimumFont).toBe(false);
    expect(tiny.minCssFontSize).toBeLessThan(HUD_MIN_CSS_FONT_PX);
  });

  it('非法尺寸回退到 1280×720，不产生 NaN 布局', () => {
    const layout = computeHudViewport(Number.NaN, -1);
    expect(layout.width).toBe(1280);
    expect(layout.height).toBe(720);
    expect(Number.isFinite(layout.scale)).toBe(true);
  });

  it('技能条三槽 + 闪避槽全部落在设计视口内且互不重叠', () => {
    const layout = computeHudSkillBarLayout();
    const rects = [
      layout.slots.J,
      layout.slots.K,
      layout.slots.L,
      layout.dodge,
    ];
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(16);
      expect(rect.x + rect.width).toBeLessThanOrEqual(HUD_DESIGN.width - 16);
      expect(rect.y + rect.height).toBeLessThanOrEqual(HUD_DESIGN.height - 8);
    }
    for (let index = 1; index < rects.length; index += 1) {
      expect(rects[index]!.x).toBeGreaterThanOrEqual(
        rects[index - 1]!.x + rects[index - 1]!.width,
      );
    }
  });

  it('四角色技能名与最长状态文本都不超出槽位', () => {
    const nameWidth = HUD_SKILL_BAR.slotWidth - 72;
    for (const character of CHARACTER_LIST) {
      for (const name of [
        character.attack.name,
        character.skillK.name,
        character.skillL.name,
      ]) {
        expect(
          hudTextFits(name, HUD_SKILL_BAR.nameFontSize, nameWidth),
        ).toBe(true);
      }
    }

    const statusWidth = HUD_SKILL_BAR.slotWidth - 72;
    const statusTexts = [
      '就绪',
      '未开放',
      '冷却 30.0s',
      '生效 20.0s',
      '弹药 9/9 · 20.0s',
      '连射 6/6',
      '真伤 · 11.0s',
      '虚弱 3.0s',
      '领域 · 8.0s',
      '拉拽 · 6.0s',
      '束缚 · 6.0s',
      '疲劳 0.5s',
    ];
    for (const text of statusTexts) {
      expect(
        hudTextFits(text, HUD_SKILL_BAR.statusFontSize, statusWidth),
      ).toBe(true);
    }
  });

  it('文本宽度估算把 CJK 当全角、ASCII 当半角', () => {
    expect(estimateHudTextWidth('生命', 14)).toBeCloseTo(28, 6);
    expect(estimateHudTextWidth('ab', 14)).toBeCloseTo(16.8, 6);
    expect(estimateHudTextWidth('', 14)).toBe(0);
  });
});

describe('HUD 字段与事件映射', () => {
  it('新局初值来自角色数据，J/K/L 名称与冷却上限正确', () => {
    for (const character of CHARACTER_LIST) {
      const state = createHudState(character.id);
      expect(state.health).toBe(character.maxHealth);
      expect(state.maxHealth).toBe(character.maxHealth);
      expect(state.level).toBe(1);
      expect(state.wave).toBe(1);
      expect(state.dodgeCooldownTotal).toBe(DODGE.cooldownSeconds);
      expect(state.skills.J.name).toBe(character.attack.name);
      expect(state.skills.J.cooldownTotal).toBe(character.attack.intervalSeconds);
      expect(state.skills.K.name).toBe(character.skillK.name);
      expect(state.skills.K.cooldownTotal).toBe(character.skillK.cooldownSeconds);
      expect(state.skills.L.name).toBe(character.skillL.name);
      expect(state.skills.L.cooldownTotal).toBe(character.skillL.cooldownSeconds);
    }
  });

  it('生命/护盾/等级/经验/波次/击杀/目标事件逐项映射到字段', () => {
    let state = createHudState('saria');
    state = applyHudEvent(state, {
      type: 'vitals',
      health: 123.2,
      maxHealth: 180,
      shield: 25.4,
      shieldRemaining: 3.2,
    });
    state = applyHudEvent(state, {
      type: 'progression',
      level: 3,
      experience: 70,
      experienceToNextLevel: 80,
    });
    state = applyHudEvent(state, {
      type: 'wave',
      wave: 5,
      kills: 7,
      aliveEnemies: 4,
    });
    state = applyHudEvent(state, {
      type: 'target',
      target: { label: '重装者', health: 100.2, maxHealth: 160 },
    });
    const model = buildHudModel(state);
    const byId = new Map(model.fields.map((field) => [field.id, field]));

    // 生命向上取整，护盾保留剩余秒数。
    expect(byId.get('health')?.text).toBe('生命 124/180');
    expect(byId.get('shield')?.text).toBe('护盾 26（3.2s）');
    expect(byId.get('level')?.text).toBe('等级 3');
    expect(byId.get('experience')?.text).toBe('经验 70/80');
    expect(byId.get('wave')?.text).toBe('波次 第 5 波');
    expect(byId.get('kills')?.text).toBe('击杀 7');
    expect(byId.get('target')?.text).toBe('目标 重装者 101/160');
    expect(model.lines.vitals).toBe('生命 124/180 · 护盾 26（3.2s）');
    expect(model.lines.wave).toBe('波次 第 5 波 · 存活敌人 4');
  });

  it('满级经验显示“满级”，不会把 Infinity 当成 0', () => {
    let state = createHudState('amiya');
    state = applyHudEvent(state, {
      type: 'progression',
      level: 9,
      experience: 999,
      experienceToNextLevel: Number.POSITIVE_INFINITY,
    });
    const experience = buildHudModel(state).fields.find(
      (field) => field.id === 'experience',
    );
    expect(experience?.value).toBe('满级');
    expect(experience?.text).toBe('经验 满级');
  });

  it('每个字段文本都以文字标签开头，数值旁不会只剩图形', () => {
    const state = createHudState('vishdal');
    for (const field of buildHudModel(state).fields) {
      expect(field.text.startsWith(field.label)).toBe(true);
      expect(field.value.length).toBeGreaterThan(0);
    }
  });

  it('无目标时显示“目标 无”，状态字不残留旧目标', () => {
    let state = applyHudEvent(createHudState('amiya'), {
      type: 'target',
      target: { label: '追击者', health: 60, maxHealth: 60 },
    });
    state = applyHudEvent(state, { type: 'target', target: null });
    expect(buildHudModel(state).lines.target).toBe('目标 无');
  });

  it('闪避冷却事件映射为秒数与进度', () => {
    let state = createHudState('vishdal');
    state = applyHudEvent(state, {
      type: 'dodge',
      cooldownRemaining: 1.5,
      cooldownTotal: DODGE.cooldownSeconds,
    });
    let model = buildHudModel(state);
    expect(model.lines.dodge).toBe('闪避 冷却 1.5s');
    expect(model.dodge.progress).toBeCloseTo(0.5, 6);

    state = applyHudEvent(state, {
      type: 'dodge',
      cooldownRemaining: 0,
      cooldownTotal: DODGE.cooldownSeconds,
    });
    model = buildHudModel(state);
    expect(model.lines.dodge).toBe('闪避 就绪');
    expect(model.dodge.progress).toBe(1);
  });

  it('技能事件覆盖就绪/冷却/生效/锁定/未开放与进度', () => {
    let state = createHudState('amiya');
    state = withSkills(state, {
      J: { status: 'cooldown', cooldownRemaining: 4, cooldownTotal: 10 },
      K: { status: 'active', detail: '连射 3/6' },
      L: {
        status: 'locked',
        detail: '虚弱',
        effectRemaining: 2.1,
      },
    });
    const model = buildHudModel(state);
    const [j, k, l] = model.skills;
    expect(j?.statusText).toBe('冷却 4.0s');
    expect(j?.progress).toBeCloseTo(0.6, 6);
    expect(k?.statusText).toBe('连射 3/6');
    expect(k?.progress).toBe(1);
    expect(l?.statusText).toBe('虚弱 2.1s');
    expect(l?.progress).toBe(0);
    expect(l?.text).toBe('L 奇美拉 虚弱 2.1s');

    state = applyHudEvent(state, {
      type: 'skill',
      skill: skill('J', { status: 'empty' }),
    });
    expect(hudSkillStatusText(state.skills.J)).toBe('未开放');
  });

  it('生效状态优先显示附加说明与剩余秒数', () => {
    const state = withSkills(createHudState('vishdal'), {
      L: {
        status: 'active',
        detail: '弹药 6/6',
        effectRemaining: 18.2,
        cooldownTotal: 30,
      },
    });
    const view = buildHudModel(state).skills.find((entry) => entry.key === 'L');
    expect(view?.statusText).toBe('弹药 6/6 · 18.2s');
    expect(view?.progress).toBe(1);
  });

  it('冷却进度被钳制在 0–1；负冷却按已就绪处理', () => {
    expect(
      hudCooldownProgress(
        skill('K', { status: 'cooldown', cooldownRemaining: -2, cooldownTotal: 10 }),
      ),
    ).toBe(1);
    expect(
      hudCooldownProgress(
        skill('K', { status: 'cooldown', cooldownRemaining: 5, cooldownTotal: 10 }),
      ),
    ).toBe(0.5);
    let state = createHudState('vishdal');
    state = applyHudEvent(state, {
      type: 'skill',
      skill: skill('K', {
        status: 'cooldown',
        cooldownRemaining: -2,
        cooldownTotal: -5,
      }),
    });
    expect(state.skills.K.cooldownRemaining).toBe(0);
    expect(state.skills.K.cooldownTotal).toBe(0);
    expect(buildHudModel(state).skills[1]?.statusText).toBe('冷却 0.0s');
  });

  it('非法生命与负盾值被归一化，不产生 NaN 文本', () => {
    let state = createHudState('saria');
    state = applyHudEvent(state, {
      type: 'vitals',
      health: Number.NaN,
      maxHealth: 0,
      shield: -5,
      shieldRemaining: -1,
    });
    const model = buildHudModel(state);
    expect(model.lines.vitals).toBe('生命 0/1 · 护盾 0');
    expect(model.lines.vitals).not.toContain('NaN');
  });

  it('角色资源与技能详情事件映射到独立行', () => {
    let state = createHudState('muelsyse');
    state = applyHudEvent(state, {
      type: 'resource',
      text: '远程流形 60/60 · 副本 1/1',
      color: '#9df2dd',
    });
    state = applyHudEvent(state, {
      type: 'skill-detail',
      text: '浅层非熵适应 · 命中束缚目标',
      color: '#9df2dd',
    });
    const model = buildHudModel(state);
    expect(model.lines.resource).toBe('资源 远程流形 60/60 · 副本 1/1');
    expect(model.lines.skillDetail).toBe('浅层非熵适应 · 命中束缚目标');
    expect(model.resourceColor).toBe('#9df2dd');
    expect(model.skillDetailColor).toBe('#9df2dd');
  });

  it('事件映射是不可变的：原状态不被修改', () => {
    const original = createHudState('amiya');
    const next = applyHudEvent(original, {
      type: 'vitals',
      health: 50,
      maxHealth: 100,
      shield: 0,
      shieldRemaining: 0,
    });
    expect(next).not.toBe(original);
    expect(original.health).toBe(100);
    expect(next.health).toBe(50);
    expect(next.skills).toBe(original.skills);
  });

  it('角色资源行在顶部面板宽度内不截断', () => {
    const longest: Record<CharacterId, string> = {
      vishdal: '资源 魂灵 2/2 · 爆裂弹药 9/9',
      amiya: '资源 情绪吸收 2/3',
      saria: '资源 护盾 25（4.0s） · 精神回复 12 次',
      muelsyse: '资源 远程流形 60/60 · 副本 2/2',
    };
    for (const character of CHARACTER_LIST) {
      expect(
        hudTextFits(longest[character.id], HUD_FONT_PX.small, 560),
      ).toBe(true);
    }
  });
});

describe('HUD 技能图标', () => {
  it('四角色 J/K/L 都有可区分的形状、配色与文字色', () => {
    for (const character of CHARACTER_LIST) {
      const icons = (['J', 'K', 'L'] as const).map((key) =>
        hudSkillIcon(character.id, key),
      );
      const unique = new Set(
        icons.map((icon) => `${icon.shape}:${icon.color}:${icon.label}`),
      );
      expect(unique.size).toBe(3);
      for (const icon of icons) {
        expect(icon.color).toBeGreaterThanOrEqual(0);
        expect(icon.color).toBeLessThanOrEqual(0xffffff);
        expect(icon.label.startsWith('#')).toBe(true);
      }
    }
  });

  it('图标表只包含四名已知角色，未知角色不会静默生成', () => {
    expect(Object.keys(HUD_SKILL_ICONS).sort()).toEqual(
      CHARACTER_LIST.map((character) => character.id).sort(),
    );
  });
});

describe('HUD 场景与样式接入', () => {
  it('场景用纯 HUD 模块驱动顶部字段、技能条与开发快照', () => {
    const scene = readSource('src/game/scenes/ArenaScene.ts');
    for (const marker of [
      'createHudState',
      'buildHudModel',
      'applyHudEvent',
      'computeHudSkillBarLayout',
      'computeHudViewport',
      'syncSkillHud',
      'updateSkillKeyLabels',
      'characterResourceText',
      'characterSkillDetail',
      'this.dodgeHud',
      'this.skillBar',
      'HUD_FONT_PX',
      'skills: hud.skills.map',
    ]) {
      expect(scene).toContain(marker);
    }
    // 每个逻辑步同步冷却；暂停时 update 直接返回，不会刷新。
    expect(scene).toContain('this.syncSkillHud();');
    // 重绑后键帽刷新。
    expect(scene).toMatch(
      /subscribe\(\(settings\) => \{[\s\S]*updateSkillKeyLabels\(settings\.keyBindings\)/,
    );
  });

  it('阿米娅情绪吸收资源行的分母是触发阈值（默认 5，A02 后 3）', () => {
    const scene = readSource('src/game/scenes/ArenaScene.ts');
    // 分母必须是阈值，不是累计命中数；否则初始显示 0/0，A02 后也不变成 /3。
    expect(scene).toMatch(
      /情绪吸收 \$\{amiya\.emotionalAbsorptionProgress\}\/\$\{amiya\.emotionalAbsorptionThreshold\}/,
    );
    expect(scene).not.toMatch(
      /情绪吸收 \$\{amiya\.emotionalAbsorptionProgress\}\/\$\{amiya\.emotionalAbsorptionHits\}/,
    );

    expect(EMOTIONAL_ABSORPTION_HITS).toBe(5);
    expect(A02_HITS_PER_TRIGGER).toBe(3);
  });

  it('开发快照包含 HUD 字段、技能与视口字号，供浏览器验收断言', () => {
    const scene = readSource('src/game/scenes/ArenaScene.ts');
    const snapshot = readSource('src/game/dev-snapshot.ts');
    expect(scene).toContain('hud: {');
    expect(scene).toContain('minCssFontSize');
    expect(scene).toContain('fitsMinimumFont');
    expect(snapshot).toContain('export interface DevHudSnapshot');
    expect(snapshot).toContain('readonly hud: DevHudSnapshot');
    expect(snapshot).toContain('Object.freeze(snapshot.hud)');
  });

  it('Phaser 使用像素风 + FIT 等比缩放，CSS 用最近邻渲染', () => {
    const config = readSource('src/game/game.ts');
    expect(config).toContain('pixelArt: true');
    expect(config).toContain('roundPixels: true');
    expect(config).toContain('Phaser.Scale.FIT');
    expect(config).toContain('Phaser.Scale.CENTER_BOTH');
    const css = readSource('src/style.css');
    expect(css).toContain('image-rendering: pixelated');
    expect(css).toContain('image-rendering: crisp-edges');
  });

  it('DOM 普通界面没有低于 16 CSS px 的字号', () => {
    const css = readSource('src/style.css');
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((match) =>
      Number(match[1]),
    );
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(16);
    }
  });

  it('HUD 字号阶梯都不低于最小逻辑字号', () => {
    for (const size of Object.values(HUD_FONT_PX)) {
      expect(size).toBeGreaterThanOrEqual(HUD_MIN_FONT_PX);
    }
    expect(HUD_MIN_FONT_PX * (HUD_VIEWPORTS[0].width / HUD_DESIGN.width)).toBeCloseTo(
      HUD_MIN_CSS_FONT_PX,
      6,
    );
  });
});
