/**
 * 角色 Q 版精灵表的帧布局、锚点与显示缩放约定。
 * 纯数据模块，不依赖 Phaser，测试可直接在 Node 环境导入。
 *
 * 四名角色都使用 V0.2 的 96×96 帧：8 列方向动作（列 8 为受击）+ 施法行；
 * 战术家的水形分身复用同一张表，靠透明度与脚下标记区分。
 * `PLAYER_ART` 是 V0.1 的 64×64 兼容规格，保留给旧布局的默认参数。
 */

/** 所有角色共享的逻辑碰撞半径；视觉大头不扩大受击范围。 */
export const PLAYER_COLLISION_RADIUS = 12;

export const PLAYER_DIRECTIONS = ['down', 'right', 'up', 'left'] as const;
export type PlayerDirection = (typeof PLAYER_DIRECTIONS)[number];

export const PLAYER_ACTION_NAMES = ['idle', 'walk', 'attack', 'hurt'] as const;
export type PlayerAction = (typeof PLAYER_ACTION_NAMES)[number];

/** 角色精灵表规格：帧尺寸、动画列、锚点与按显示缩放换算的碰撞体参数。 */
export interface PlayerArtSpec {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly sheetColumns: number;
  readonly sheetRows: number;
  readonly sheetWidth: number;
  readonly sheetHeight: number;
  /** 每帧脚底所在的像素行（y 坐标），用于稳定落脚。 */
  readonly footBaseline: number;
  readonly originX: number;
  readonly originY: number;
  /** 世界坐标中的逻辑碰撞半径，所有角色恒为 12。 */
  readonly collisionRadius: number;
  /** 源码像素中的碰撞半径；ArenaScene 以它调用 setCircle，乘显示缩放后仍为 12。 */
  readonly bodyRadius: number;
  /** Phaser Arcade 圆形碰撞体的帧内左上角偏移（源码像素）。 */
  readonly bodyOffsetX: number;
  readonly bodyOffsetY: number;
  /** 场内最近邻显示缩放；96 帧为 0.7，约 67 逻辑像素。 */
  readonly displayScale: number;
  /** 选角预览的最近邻放大倍数（整数，避免像素错位）。 */
  readonly previewScale: number;
  readonly actionColumns: Readonly<Record<PlayerAction, readonly number[]>>;
  /** 八向施法帧所在行。 */
  readonly castRow: number;
}

interface PlayerArtOptions {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly sheetColumns: number;
  readonly sheetRows: number;
  readonly footBaseline: number;
  readonly displayScale: number;
  readonly previewScale: number;
  readonly actionColumns: Readonly<Record<PlayerAction, readonly number[]>>;
  readonly castRow: number;
}

function definePlayerArt(options: PlayerArtOptions): PlayerArtSpec {
  const {
    frameWidth,
    frameHeight,
    sheetColumns,
    sheetRows,
    footBaseline,
    displayScale,
    actionColumns,
    castRow,
    previewScale,
  } = options;
  const bodyRadius = PLAYER_COLLISION_RADIUS / displayScale;
  return {
    frameWidth,
    frameHeight,
    sheetColumns,
    sheetRows,
    sheetWidth: frameWidth * sheetColumns,
    sheetHeight: frameHeight * sheetRows,
    footBaseline,
    originX: 0.5,
    originY: footBaseline / frameHeight,
    collisionRadius: PLAYER_COLLISION_RADIUS,
    bodyRadius,
    bodyOffsetX: frameWidth / 2 - bodyRadius,
    bodyOffsetY: footBaseline - bodyRadius * 2,
    displayScale,
    previewScale,
    actionColumns,
    castRow,
  };
}

/** V0.1 的 64×64 兼容规格：四名角色均已升级到 96 帧，仅保留旧布局默认参数。 */
export const PLAYER_ART: PlayerArtSpec = definePlayerArt({
  frameWidth: 64,
  frameHeight: 64,
  sheetColumns: 8,
  sheetRows: 5,
  footBaseline: 61,
  displayScale: 1,
  previewScale: 4,
  actionColumns: {
    idle: [0, 1],
    walk: [2, 3, 4, 5],
    attack: [6],
    hurt: [7],
  },
  castRow: 4,
});

/** V0.2 爆破手样板：96×96 透明帧，9 列（待机 2 / 行走 4 / 攻击 2 / 受击 1）+ 八向施法行。 */
export const DEMOLITIONIST_ART: PlayerArtSpec = definePlayerArt({
  frameWidth: 96,
  frameHeight: 96,
  sheetColumns: 9,
  sheetRows: 5,
  footBaseline: 92,
  displayScale: 0.7,
  previewScale: 2,
  actionColumns: {
    idle: [0, 1],
    walk: [2, 3, 4, 5],
    attack: [6, 7],
    hurt: [8],
  },
  castRow: 4,
});

/** V0.2 术士样板：与爆破手同规格的 96×96 帧，棕发与长耳兜帽独立剪影。 */
export const SORCERER_ART: PlayerArtSpec = definePlayerArt({
  frameWidth: 96,
  frameHeight: 96,
  sheetColumns: 9,
  sheetRows: 5,
  footBaseline: 92,
  displayScale: 0.7,
  previewScale: 2,
  actionColumns: {
    idle: [0, 1],
    walk: [2, 3, 4, 5],
    attack: [6, 7],
    hurt: [8],
  },
  castRow: 4,
});

/** V0.2 骑士样板：白金短发、金色角状头饰、大盾与短靴，与爆破手同规格。 */
export const KNIGHT_ART: PlayerArtSpec = definePlayerArt({
  frameWidth: 96,
  frameHeight: 96,
  sheetColumns: 9,
  sheetRows: 5,
  footBaseline: 92,
  displayScale: 0.7,
  previewScale: 2,
  actionColumns: {
    idle: [0, 1],
    walk: [2, 3, 4, 5],
    attack: [6, 7],
    hurt: [8],
  },
  castRow: 4,
});

/** V0.2 战术家：与前三名角色同规格的 96×96 帧，薄荷白发、尖耳与绿色短外套。 */
export const MUELSYSE_ART: PlayerArtSpec = definePlayerArt({
  frameWidth: 96,
  frameHeight: 96,
  sheetColumns: 9,
  sheetRows: 5,
  footBaseline: 92,
  displayScale: 0.7,
  previewScale: 2,
  actionColumns: {
    idle: [0, 1],
    walk: [2, 3, 4, 5],
    attack: [6, 7],
    hurt: [8],
  },
  castRow: 4,
});

/** 角色内部 ID → 精灵表规格；新角色在自己的故事里追加。 */
export function playerArtFor(characterId: string): PlayerArtSpec {
  if (characterId === 'vishdal') return DEMOLITIONIST_ART;
  if (characterId === 'amiya') return SORCERER_ART;
  if (characterId === 'saria') return KNIGHT_ART;
  if (characterId === 'muelsyse') return MUELSYSE_ART;
  return PLAYER_ART;
}

/** 兼容 64×64 角色的动作列；96 帧角色请读 `playerArtFor(id).actionColumns`。 */
export const PLAYER_ACTION_COLUMNS = PLAYER_ART.actionColumns;

export const PLAYER_ANIMATION_SETTINGS = {
  idle: { frameRate: 3, repeat: -1 },
  walk: { frameRate: 10, repeat: -1 },
  attack: { frameRate: 8, repeat: 0 },
  hurt: { frameRate: 8, repeat: 0 },
} as const;

export const PLAYER_CAST_ROW = 4;
export const PLAYER_CAST_DIRECTIONS = [
  'north',
  'northEast',
  'east',
  'southEast',
  'south',
  'southWest',
  'west',
  'northWest',
] as const;
export type PlayerCastDirection = (typeof PLAYER_CAST_DIRECTIONS)[number];

/** 某朝向、动作在精灵表中的帧索引。frame 会按该动作的帧数循环。 */
export function playerFrameIndex(
  direction: PlayerDirection,
  action: PlayerAction,
  frame = 0,
  art: PlayerArtSpec = PLAYER_ART,
): number {
  const columns = art.actionColumns[action];
  const column = columns[frame % columns.length] ?? columns[0] ?? 0;
  const row = PLAYER_DIRECTIONS.indexOf(direction);
  return row * art.sheetColumns + column;
}

/** 八向施法帧索引，位于精灵表的施法行。 */
export function playerCastFrameIndex(
  direction: PlayerCastDirection,
  art: PlayerArtSpec = PLAYER_ART,
): number {
  return art.castRow * art.sheetColumns + PLAYER_CAST_DIRECTIONS.indexOf(direction);
}

/** 已接入场内精灵表的角色；后续角色故事继续追加。 */
export const PLAYER_SPRITE_IDS = ['vishdal', 'amiya', 'saria', 'muelsyse'] as const;
export type PlayerSpriteId = (typeof PLAYER_SPRITE_IDS)[number];

/** Phaser 动画键名，例如 vishdal-down-walk / amiya-up-idle。 */
export function playerAnimationKey(
  direction: PlayerDirection,
  action: PlayerAction,
  characterId: string = 'vishdal',
): string {
  return `${characterId}-${direction}-${action}`;
}
