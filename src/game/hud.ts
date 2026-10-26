/**
 * HUD 字段、事件映射与三档视口布局（docs/game-design.md §8）。
 *
 * 纯逻辑模块：不依赖 Phaser/DOM，场景只负责把这里产出的字段渲染到文本与图标上。
 * - 所有数值字段都带文字标签，不允许只显示图形；
 * - 金币与击杀分开显示，金币随击杀即时入账；
 * - J/K/L 每个技能槽包含按键徽标、技能名、状态与冷却秒数；
 * - 字号按逻辑像素定义，1280×720 下最小字号仍 ≥16 CSS px；
 * - 视口用等比缩放 + letterbox，绝不非等比拉伸像素。
 */

import { hudValue } from './combat';
import { getCharacter, type CharacterId } from './data';
import { INITIAL_GOLD } from './economy';
import { DODGE } from './movement';

/** 与 Phaser 逻辑视口一致；HUD 按该坐标系排版后由 Scale.FIT 等比缩放。 */
export const HUD_DESIGN = {
  width: 960,
  height: 540,
} as const;

/** 普通界面最小 CSS 字号；1280×720 下 12 逻辑像素 × 4/3 = 16。 */
export const HUD_MIN_CSS_FONT_PX = 16;
export const HUD_MIN_FONT_PX = 12;

/** HUD 字号阶梯（逻辑像素）。 */
export const HUD_FONT_PX = {
  micro: 12,
  small: 14,
  body: 16,
  title: 20,
  display: 30,
} as const;

export type HudFontKey = keyof typeof HUD_FONT_PX;

/** 验收要求的三档窗口。 */
export const HUD_VIEWPORTS = [
  { id: '1280x720', width: 1280, height: 720 },
  { id: '1440x900', width: 1440, height: 900 },
  { id: '1920x1080', width: 1920, height: 1080 },
] as const;

export interface HudViewportLayout {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** 等比缩放系数；canvas 宽高 = 逻辑尺寸 × scale。 */
  readonly scale: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** letterbox 留白（CSS 像素）。 */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly cssFontSizes: Readonly<Record<HudFontKey, number>>;
  /** 最小 HUD 字号对应的 CSS 像素；1280×720 下应 ≥16。 */
  readonly minCssFontSize: number;
  readonly fitsMinimumFont: boolean;
}

function positiveDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 计算 FIT 缩放后的画布大小、letterbox 与字号。 */
export function computeHudViewport(width: number, height: number): HudViewportLayout {
  const safeWidth = positiveDimension(width, HUD_VIEWPORTS[0].width);
  const safeHeight = positiveDimension(height, HUD_VIEWPORTS[0].height);
  const scale = Math.min(safeWidth / HUD_DESIGN.width, safeHeight / HUD_DESIGN.height);
  const canvasWidth = HUD_DESIGN.width * scale;
  const canvasHeight = HUD_DESIGN.height * scale;
  const cssFontSizes = Object.fromEntries(
    Object.entries(HUD_FONT_PX).map(([key, size]) => [key, size * scale]),
  ) as Record<HudFontKey, number>;
  const minCssFontSize = HUD_MIN_FONT_PX * scale;
  return {
    id: `${Math.round(safeWidth)}x${Math.round(safeHeight)}`,
    width: safeWidth,
    height: safeHeight,
    scale,
    canvasWidth,
    canvasHeight,
    offsetX: (safeWidth - canvasWidth) / 2,
    offsetY: (safeHeight - canvasHeight) / 2,
    cssFontSizes,
    minCssFontSize,
    fitsMinimumFont: minCssFontSize >= HUD_MIN_CSS_FONT_PX,
  };
}

/** 文本宽度估算：CJK 按全角、ASCII 按等宽字体近似，用于断言不截断。 */
export function estimateHudTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x2e80) {
      width += fontSize;
    } else if (char === ' ') {
      width += fontSize * 0.34;
    } else {
      width += fontSize * 0.6;
    }
  }
  return width;
}

export function hudTextFits(text: string, fontSize: number, maxWidth: number): boolean {
  return estimateHudTextWidth(text, fontSize) <= maxWidth;
}

/** 技能条布局（逻辑像素）；三档视口共用同一逻辑坐标。 */
export const HUD_SKILL_BAR = {
  slotWidth: 200,
  slotHeight: 62,
  slotGap: 8,
  dodgeWidth: 150,
  groupGap: 12,
  marginBottom: 14,
  nameFontSize: 15,
  statusFontSize: 14,
} as const;

export interface HudRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type HudSkillKey = 'J' | 'K' | 'L';

export interface HudSkillBarLayout {
  readonly y: number;
  readonly height: number;
  readonly slots: Readonly<Record<HudSkillKey, HudRect>>;
  readonly dodge: HudRect;
}

const HUD_SKILL_KEYS: readonly HudSkillKey[] = ['J', 'K', 'L'];

/** 三个技能槽 + 闪避槽在底部居中排布，总宽不超过设计视口。 */
export function computeHudSkillBarLayout(): HudSkillBarLayout {
  const {
    slotWidth,
    slotHeight,
    slotGap,
    dodgeWidth,
    groupGap,
    marginBottom,
  } = HUD_SKILL_BAR;
  const totalWidth =
    slotWidth * HUD_SKILL_KEYS.length +
    slotGap * (HUD_SKILL_KEYS.length - 1) +
    groupGap +
    dodgeWidth;
  const startX = (HUD_DESIGN.width - totalWidth) / 2;
  const y = HUD_DESIGN.height - slotHeight - marginBottom;
  const slots = {} as Record<HudSkillKey, HudRect>;
  HUD_SKILL_KEYS.forEach((key, index) => {
    slots[key] = {
      x: startX + index * (slotWidth + slotGap),
      y,
      width: slotWidth,
      height: slotHeight,
    };
  });
  return {
    y,
    height: slotHeight,
    slots,
    dodge: {
      x: startX + HUD_SKILL_KEYS.length * slotWidth + (HUD_SKILL_KEYS.length - 1) * slotGap + groupGap,
      y,
      width: dodgeWidth,
      height: slotHeight,
    },
  };
}

/** 两个自由技能槽在底部主技能条上方单独成条，避免挤压 J/K/L 的名称宽度。 */
export const HUD_FREE_SKILL_BAR = {
  slotWidth: 300,
  slotHeight: 80,
  slotGap: 8,
  marginAbove: 8,
} as const;

export type HudFreeSkillSlotKey = 'U' | 'I';

export interface HudFreeSkillBarLayout {
  readonly y: number;
  readonly height: number;
  readonly slots: Readonly<Record<HudFreeSkillSlotKey, HudRect>>;
}

/** 自由技能条：U/I 两槽居中排在主技能条上方。 */
export function computeHudFreeSkillBarLayout(): HudFreeSkillBarLayout {
  const { slotWidth, slotHeight, slotGap, marginAbove } = HUD_FREE_SKILL_BAR;
  const main = computeHudSkillBarLayout();
  const y = main.y - marginAbove - slotHeight;
  const keys: readonly HudFreeSkillSlotKey[] = ['U', 'I'];
  const totalWidth = slotWidth * keys.length + slotGap * (keys.length - 1);
  const startX = (HUD_DESIGN.width - totalWidth) / 2;
  const slots = {} as Record<HudFreeSkillSlotKey, HudRect>;
  keys.forEach((key, index) => {
    slots[key] = {
      x: startX + index * (slotWidth + slotGap),
      y,
      width: slotWidth,
      height: slotHeight,
    };
  });
  return { y, height: slotHeight, slots };
}

/**
 * 自由技能图标：按技能 ID 的定位给一个可区分的几何形状与主色，
 * 不用逐帧美术；文字名称与冷却仍由槽位文本承担。
 */
export function hudFreeSkillIcon(skillId: string): HudIconSpec {
  switch (skillId) {
    case 'S01':
      return { shape: 'spark', color: 0xffb347, label: '#ffd166' };
    case 'S02':
      return { shape: 'wave', color: 0x8fd3ff, label: '#b9e4ff' };
    case 'S03':
      return { shape: 'bolt', color: 0xc77dff, label: '#e0c0ff' };
    case 'S04':
      return { shape: 'drop', color: 0xff9a5a, label: '#ffc49a' };
    case 'S05':
      return { shape: 'field', color: 0x5fd8d0, label: '#9df2dd' };
    case 'S06':
      return { shape: 'wave', color: 0x9df2bc, label: '#c8ffd6' };
    case 'S07':
      return { shape: 'shield', color: 0xffd166, label: '#ffe9a8' };
    case 'S08':
      return { shape: 'field', color: 0xb28bff, label: '#d9c8ff' };
    case 'S09':
      return { shape: 'drop', color: 0x5fd8d0, label: '#9df2dd' };
    case 'S10':
      return { shape: 'shield', color: 0xffe08a, label: '#fff0c2' };
    case 'S11':
      return { shape: 'bolt', color: 0xffc46b, label: '#ffe0b0' };
    case 'S12':
      return { shape: 'orb', color: 0xffd166, label: '#ffe9a8' };
    default:
      return { shape: 'spark', color: 0xcfc4b6, label: '#e6ded2' };
  }
}

/** 自由技能槽状态文字：空槽/冷却/就绪；说明文本由槽位单独展示。 */
export function freeSkillStatusText(
  empty: boolean,
  cooldownRemaining: number,
): string {
  if (empty) return '空槽 · 商店装备';
  if (cooldownRemaining > 0) return `冷却 ${formatSeconds(cooldownRemaining)}`;
  return '就绪';
}

/** 技能图标形状；场景按此绘制小型几何图形，不用 Emoji 或文字代替角色。 */export type HudIconShape =
  | 'shell'
  | 'bolt'
  | 'spark'
  | 'orb'
  | 'shield'
  | 'wave'
  | 'field'
  | 'drop';

export interface HudIconSpec {
  readonly shape: HudIconShape;
  readonly color: number;
  /** 状态文字与描边使用的 CSS 颜色。 */
  readonly label: string;
}

/** 四角色 × J/K/L 图标：形状与主色都可区分。 */
export const HUD_SKILL_ICONS: Readonly<
  Record<CharacterId, Readonly<Record<HudSkillKey, HudIconSpec>>>
> = {
  vishdal: {
    J: { shape: 'shell', color: 0xffb347, label: '#ffd166' },
    K: { shape: 'orb', color: 0xc77dff, label: '#e0c0ff' },
    L: { shape: 'spark', color: 0xffd166, label: '#ffe9a8' },
  },
  amiya: {
    J: { shape: 'bolt', color: 0x5b9dff, label: '#a8d8ff' },
    K: { shape: 'spark', color: 0xd6e8ff, label: '#d6e8ff' },
    L: { shape: 'field', color: 0x5b9dff, label: '#a8d8ff' },
  },
  saria: {
    J: { shape: 'shield', color: 0xffd166, label: '#ffe9a8' },
    K: { shape: 'wave', color: 0xffb3c1, label: '#ffd6dd' },
    L: { shape: 'field', color: 0xffd166, label: '#ffe9a8' },
  },
  muelsyse: {
    J: { shape: 'drop', color: 0x5fd8d0, label: '#9df2dd' },
    K: { shape: 'wave', color: 0x9df2dd, label: '#9df2dd' },
    L: { shape: 'field', color: 0x5fd8d0, label: '#9df2dd' },
  },
};

export function hudSkillIcon(
  characterId: CharacterId,
  key: HudSkillKey,
): HudIconSpec {
  return HUD_SKILL_ICONS[characterId][key];
}

export type HudSkillStatus = 'ready' | 'cooldown' | 'active' | 'locked' | 'empty';

export interface HudSkillState {
  readonly key: HudSkillKey;
  readonly name: string;
  readonly status: HudSkillStatus;
  /** 剩余冷却秒数；就绪时为 0。 */
  readonly cooldownRemaining: number;
  /** 该技能的基础冷却或攻击间隔，用于进度条。 */
  readonly cooldownTotal: number;
  /** 生效/锁定状态的剩余秒数；无持续效果时为 0。 */
  readonly effectRemaining: number;
  /** 附加说明，如“弹药 6/6”“连射 3/6”“疲劳”。 */
  readonly detail: string;
}

export interface HudTargetState {
  readonly label: string;
  readonly health: number;
  readonly maxHealth: number;
}

export interface HudState {
  readonly characterId: CharacterId;
  readonly health: number;
  readonly maxHealth: number;
  readonly shield: number;
  readonly shieldRemaining: number;
  readonly level: number;
  readonly experience: number;
  readonly experienceToNextLevel: number;
  readonly wave: number;
  /** 本波剩余秒数；无波次或未知时为 null。 */
  readonly waveRemainingSeconds: number | null;
  /** Boss 波没有倒计时。 */
  readonly waveUnlimited: boolean;
  readonly kills: number;
  /** 当前金币；击杀直接入账，不生成拾取物。 */
  readonly gold: number;
  readonly aliveEnemies: number;
  readonly target: HudTargetState | null;
  readonly dodgeCooldownRemaining: number;
  readonly dodgeCooldownTotal: number;
  readonly skills: Readonly<Record<HudSkillKey, HudSkillState>>;
  /** 角色专属资源：维什戴尔魂灵、阿米娅情绪吸收、塞雷娅护盾、缪尔赛思流形。 */
  readonly resource: string;
  readonly resourceColor: string;
  /** L/角色技能的长状态说明；无内容时留空。 */
  readonly skillDetail: string;
  readonly skillDetailColor: string;
}

export type HudEvent =
  | {
      readonly type: 'vitals';
      readonly health: number;
      readonly maxHealth: number;
      readonly shield: number;
      readonly shieldRemaining: number;
    }
  | {
      readonly type: 'progression';
      readonly level: number;
      readonly experience: number;
      readonly experienceToNextLevel: number;
    }
  | {
      readonly type: 'wave';
      readonly wave: number;
      readonly kills: number;
      readonly aliveEnemies: number;
      /** 本波剩余秒数；Boss 波或未知时传 null。 */
      readonly remainingSeconds?: number | null;
      /** Boss 波没有倒计时。 */
      readonly unlimited?: boolean;
    }
  | { readonly type: 'target'; readonly target: HudTargetState | null }
  | { readonly type: 'gold'; readonly gold: number }
  | {
      readonly type: 'dodge';
      readonly cooldownRemaining: number;
      readonly cooldownTotal: number;
    }
  | { readonly type: 'skill'; readonly skill: HudSkillState }
  | { readonly type: 'resource'; readonly text: string; readonly color: string }
  | {
      readonly type: 'skill-detail';
      readonly text: string;
      readonly color: string;
    };

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function safeInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function sanitizeSkill(skill: HudSkillState): HudSkillState {
  return {
    key: skill.key,
    name: skill.name,
    status: skill.status,
    cooldownRemaining: nonNegative(skill.cooldownRemaining),
    cooldownTotal: nonNegative(skill.cooldownTotal),
    effectRemaining: nonNegative(skill.effectRemaining),
    detail: skill.detail,
  };
}

/** 新局 HUD 初值；场景随后用事件同步各系统状态。 */
export function createHudState(characterId: CharacterId): HudState {
  const character = getCharacter(characterId);
  return {
    characterId,
    health: character.maxHealth,
    maxHealth: character.maxHealth,
    shield: 0,
    shieldRemaining: 0,
    level: 1,
    experience: 0,
    experienceToNextLevel: 50,
    wave: 1,
    waveRemainingSeconds: null,
    waveUnlimited: false,
    kills: 0,
    gold: INITIAL_GOLD,
    aliveEnemies: 0,
    target: null,
    dodgeCooldownRemaining: 0,
    dodgeCooldownTotal: DODGE.cooldownSeconds,
    skills: {
      J: {
        key: 'J',
        name: character.attack.name,
        status: 'ready',
        cooldownRemaining: 0,
        cooldownTotal: character.attack.intervalSeconds,
        effectRemaining: 0,
        detail: '',
      },
      K: {
        key: 'K',
        name: character.skillK.name,
        status: 'ready',
        cooldownRemaining: 0,
        cooldownTotal: character.skillK.cooldownSeconds,
        effectRemaining: 0,
        detail: '',
      },
      L: {
        key: 'L',
        name: character.skillL.name,
        status: 'ready',
        cooldownRemaining: 0,
        cooldownTotal: character.skillL.cooldownSeconds,
        effectRemaining: 0,
        detail: '',
      },
    },
    resource: '',
    resourceColor: '#cfc4b6',
    skillDetail: '',
    skillDetailColor: '#cfc4b6',
  };
}

/** 事件 → 新状态；纯函数只替换受影响字段，便于逐项测试映射。 */
export function applyHudEvent(state: HudState, event: HudEvent): HudState {
  switch (event.type) {
    case 'vitals':
      return {
        ...state,
        health: nonNegative(event.health),
        maxHealth: Math.max(1, nonNegative(event.maxHealth)),
        shield: nonNegative(event.shield),
        shieldRemaining: nonNegative(event.shieldRemaining),
      };
    case 'progression':
      return {
        ...state,
        level: Math.max(1, safeInteger(event.level, state.level)),
        experience: nonNegative(event.experience),
        // 满级用 Infinity 表示；不能像普通字段那样回退为 0。
        experienceToNextLevel: Number.isFinite(event.experienceToNextLevel)
          ? Math.max(0, event.experienceToNextLevel)
          : Number.POSITIVE_INFINITY,
      };
    case 'wave':
      return {
        ...state,
        wave: Math.max(1, safeInteger(event.wave, state.wave)),
        kills: safeInteger(event.kills, state.kills),
        aliveEnemies: safeInteger(event.aliveEnemies, state.aliveEnemies),
        waveRemainingSeconds:
          event.remainingSeconds === undefined
            ? state.waveRemainingSeconds
            : event.remainingSeconds === null || !Number.isFinite(event.remainingSeconds)
              ? null
              : nonNegative(event.remainingSeconds),
        waveUnlimited:
          event.unlimited === undefined ? state.waveUnlimited : event.unlimited === true,
      };
    case 'target':
      return { ...state, target: event.target };
    case 'gold':
      return { ...state, gold: safeInteger(event.gold, state.gold) };
    case 'dodge':
      return {
        ...state,
        dodgeCooldownRemaining: nonNegative(event.cooldownRemaining),
        dodgeCooldownTotal: Math.max(0, nonNegative(event.cooldownTotal)),
      };
    case 'skill':
      return {
        ...state,
        skills: { ...state.skills, [event.skill.key]: sanitizeSkill(event.skill) },
      };
    case 'resource':
      return { ...state, resource: event.text, resourceColor: event.color };
    case 'skill-detail':
      return {
        ...state,
        skillDetail: event.text,
        skillDetailColor: event.color,
      };
    default:
      return state;
  }
}

export type HudFieldId =
  | 'target'
  | 'health'
  | 'shield'
  | 'level'
  | 'experience'
  | 'wave'
  | 'kills'
  | 'gold'
  | 'dodge'
  | 'skill-J'
  | 'skill-K'
  | 'skill-L'
  | 'resource';

export interface HudField {
  readonly id: HudFieldId;
  readonly label: string;
  readonly value: string;
  /** 标签 + 数值的完整文本；HUD 只读这一项，保证数值旁必有文字。 */
  readonly text: string;
}

export interface HudSkillView {
  readonly key: HudSkillKey;
  readonly name: string;
  readonly status: HudSkillStatus;
  readonly statusText: string;
  readonly detailText: string;
  readonly cooldownText: string;
  /** 0–1；冷却中表示充能进度，就绪/生效为 1，锁定为 0。 */
  readonly progress: number;
  readonly text: string;
  readonly icon: HudIconSpec;
}

export interface HudDodgeView {
  readonly statusText: string;
  readonly cooldownRemaining: number;
  readonly cooldownTotal: number;
  readonly progress: number;
  readonly text: string;
}

export interface HudModel {
  readonly characterId: CharacterId;
  readonly fields: readonly HudField[];
  readonly lines: {
    readonly target: string;
    readonly vitals: string;
    readonly progress: string;
    readonly wave: string;
    readonly kills: string;
    readonly gold: string;
    readonly dodge: string;
    readonly resource: string;
    readonly skillDetail: string;
  };
  readonly skills: readonly HudSkillView[];
  readonly dodge: HudDodgeView;
  readonly resourceColor: string;
  readonly skillDetailColor: string;
}

function formatSeconds(seconds: number): string {
  return `${nonNegative(seconds).toFixed(1)}s`;
}

/** 冷却进度：0 表示刚进入冷却，1 表示已就绪。 */
export function hudCooldownProgress(skill: HudSkillState): number {
  if (skill.status === 'locked') return 0;
  if (skill.status !== 'cooldown') return 1;
  if (skill.cooldownTotal <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - skill.cooldownRemaining / skill.cooldownTotal));
}

/** 技能状态文字：冷却必须带秒数，生效/锁定带剩余时间或弹药等说明。 */
export function hudSkillStatusText(skill: HudSkillState): string {
  switch (skill.status) {
    case 'ready':
      return '就绪';
    case 'cooldown':
      return `冷却 ${formatSeconds(skill.cooldownRemaining)}`;
    case 'active': {
      if (skill.detail && skill.effectRemaining > 0) {
        return `${skill.detail} · ${formatSeconds(skill.effectRemaining)}`;
      }
      if (skill.detail) return skill.detail;
      if (skill.effectRemaining > 0) return `生效 ${formatSeconds(skill.effectRemaining)}`;
      return '生效';
    }
    case 'locked': {
      if (skill.detail && skill.effectRemaining > 0) {
        return `${skill.detail} ${formatSeconds(skill.effectRemaining)}`;
      }
      return skill.detail || '锁定';
    }
    case 'empty':
      return '未开放';
    default:
      return '就绪';
  }
}

function skillField(skill: HudSkillState, view: HudSkillView): HudField {
  return {
    id: `skill-${skill.key}` as HudFieldId,
    label: `${skill.key} ${skill.name}`,
    value: view.statusText,
    text: view.text,
  };
}

function field(
  id: HudFieldId,
  label: string,
  value: string,
): HudField {
  return { id, label, value, text: `${label} ${value}` };
}

/** 由状态生成 HUD 字段、文本行与技能槽视图。 */
export function buildHudModel(state: HudState): HudModel {
  const healthField = field(
    'health',
    '生命',
    `${hudValue(state.health)}/${hudValue(state.maxHealth)}`,
  );
  const shieldValue =
    state.shield > 0
      ? `${hudValue(state.shield)}${
          state.shieldRemaining > 0 ? `（${formatSeconds(state.shieldRemaining)}）` : ''
        }`
      : '0';
  const shieldField = field('shield', '护盾', shieldValue);

  const experienceValue = Number.isFinite(state.experienceToNextLevel)
    ? `${hudValue(state.experience)}/${hudValue(state.experienceToNextLevel)}`
    : '满级';
  const experienceField = field('experience', '经验', experienceValue);
  const levelField = field('level', '等级', `${Math.max(1, Math.floor(state.level))}`);
  const waveField = field('wave', '波次', `第 ${Math.max(1, Math.floor(state.wave))} 波`);
  const waveTimer = state.waveUnlimited
    ? ' · Boss · 无时限'
    : state.waveRemainingSeconds !== null
      ? ` · 剩余 ${Math.max(0, Math.ceil(state.waveRemainingSeconds))}s`
      : '';
  const killsField = field('kills', '击杀', `${Math.max(0, Math.floor(state.kills))}`);
  const goldField = field('gold', '金币', `${Math.max(0, Math.floor(state.gold))}`);

  const targetValue = state.target
    ? `${state.target.label} ${hudValue(state.target.health)}/${hudValue(state.target.maxHealth)}`
    : '无';
  const targetField = field('target', '目标', targetValue);

  const dodgeReady = state.dodgeCooldownRemaining <= 0;
  const dodgeStatus = dodgeReady
    ? '就绪'
    : `冷却 ${formatSeconds(state.dodgeCooldownRemaining)}`;
  const dodgeField = field('dodge', '闪避', dodgeStatus);

  const skills = HUD_SKILL_KEYS.map((key): HudSkillView => {
    const skill = state.skills[key];
    const statusText = hudSkillStatusText(skill);
    const cooldownText =
      skill.status === 'cooldown'
        ? `冷却 ${formatSeconds(skill.cooldownRemaining)}`
        : skill.status === 'active'
          ? '生效'
          : skill.status === 'locked'
            ? '锁定'
            : '就绪';
    return {
      key,
      name: skill.name,
      status: skill.status,
      statusText,
      detailText: skill.detail,
      cooldownText,
      progress: hudCooldownProgress(skill),
      text: `${key} ${skill.name} ${statusText}`,
      icon: hudSkillIcon(state.characterId, key),
    };
  });

  const resourceField = field('resource', '资源', state.resource || '无');
  const dodgeProgress =
    state.dodgeCooldownTotal > 0
      ? Math.min(
          1,
          Math.max(0, 1 - state.dodgeCooldownRemaining / state.dodgeCooldownTotal),
        )
      : 1;

  const fields: HudField[] = [
    targetField,
    healthField,
    shieldField,
    levelField,
    experienceField,
    waveField,
    killsField,
    goldField,
    dodgeField,
    ...skills.map((view) => {
      const skill = state.skills[view.key];
      return skillField(skill, view);
    }),
    resourceField,
  ];

  return {
    characterId: state.characterId,
    fields,
    lines: {
      target: targetField.text,
      vitals: `${healthField.text} · ${shieldField.text}`,
      progress: `${levelField.text} · ${experienceField.text}`,
      wave: `${waveField.text} · 存活敌人 ${Math.max(0, Math.floor(state.aliveEnemies))}${waveTimer}`,
      kills: killsField.text,
      gold: goldField.text,
      dodge: dodgeField.text,
      resource: resourceField.text,
      skillDetail: state.skillDetail,
    },
    skills,
    dodge: {
      statusText: dodgeStatus,
      cooldownRemaining: nonNegative(state.dodgeCooldownRemaining),
      cooldownTotal: nonNegative(state.dodgeCooldownTotal),
      progress: dodgeProgress,
      text: dodgeField.text,
    },
    resourceColor: state.resourceColor,
    skillDetailColor: state.skillDetailColor,
  };
}
