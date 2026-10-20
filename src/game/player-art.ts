/**
 * 维什戴尔 Q 版像素精灵表的帧布局与锚点约定。
 * 纯数据模块，不依赖 Phaser，测试可直接在 Node 环境导入。
 *
 * 精灵表 8 列 × 5 行，每帧 64×64：
 * - 行 0-3：下 / 右 / 上 / 左（左向由右向镜像生成）；
 * - 列 0-1 待机、2-5 行走、6 攻击、7 受击；
 * - 行 4：八向施法指向帧（北、东北、东、东南、南、西南、西、西北）。
 */
export const PLAYER_ART = {
  frameWidth: 64,
  frameHeight: 64,
  sheetColumns: 8,
  sheetRows: 5,
  sheetWidth: 512,
  sheetHeight: 320,
  /** 每帧脚底所在的像素行（y 坐标），用于稳定落脚。 */
  footBaseline: 61,
  originX: 0.5,
  originY: 61 / 64,
  /** 游戏逻辑碰撞半径保持 12，不随大头轮廓扩大。 */
  collisionRadius: 12,
  /** Phaser Arcade 圆形碰撞体的帧内左上角偏移。 */
  bodyOffsetX: 20,
  bodyOffsetY: 37,
} as const;

export const PLAYER_DIRECTIONS = ['down', 'right', 'up', 'left'] as const;
export type PlayerDirection = (typeof PLAYER_DIRECTIONS)[number];

export const PLAYER_ACTION_COLUMNS = {
  idle: [0, 1],
  walk: [2, 3, 4, 5],
  attack: [6],
  hurt: [7],
} as const;
export type PlayerAction = keyof typeof PLAYER_ACTION_COLUMNS;

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
): number {
  const columns = PLAYER_ACTION_COLUMNS[action];
  const column = columns[frame % columns.length] ?? columns[0];
  const row = PLAYER_DIRECTIONS.indexOf(direction);
  return row * PLAYER_ART.sheetColumns + column;
}

/** 八向施法帧索引，位于精灵表最后一行。 */
export function playerCastFrameIndex(direction: PlayerCastDirection): number {
  return PLAYER_CAST_ROW * PLAYER_ART.sheetColumns + PLAYER_CAST_DIRECTIONS.indexOf(direction);
}

/** 已接入 64×64 精灵表的角色；后续角色故事继续追加。 */
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
