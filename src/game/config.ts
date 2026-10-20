/** 视口、场地与资源键的集中配置。纯数据模块，不依赖 Phaser，可在 Node 测试中导入。 */

import { PLAYER_ART } from './player-art';

export const VIEWPORT = {
  width: 960,
  height: 540,
} as const;

export const ARENA = {
  width: 1440,
  height: 960,
} as const;

export const SCENE_KEYS = {
  arena: 'ArenaScene',
} as const;

export const ASSET_KEYS = {
  floor: 'arena-floor',
  wall: 'arena-wall',
  cover: 'arena-cover',
  playerVishdal: 'player-vishdal',
  playerAmiya: 'player-amiya',
  playerSaria: 'player-saria',
  playerMuelsyse: 'player-muelsyse',
} as const;

export const ASSET_PATHS = {
  floor: '/assets/arena/floor.png',
  wall: '/assets/arena/wall.png',
  cover: '/assets/arena/cover.png',
  playerVishdal: '/assets/sprites/player-vishdal.png',
  playerAmiya: '/assets/sprites/player-amiya.png',
  playerSaria: '/assets/sprites/player-saria.png',
  playerMuelsyse: '/assets/sprites/player-muelsyse.png',
} as const;

export type AssetKey = (typeof ASSET_KEYS)[keyof typeof ASSET_KEYS];

export const PLAYER = {
  /** 逻辑碰撞半径固定 12，不随 Q 版大头轮廓扩大。 */
  radius: PLAYER_ART.collisionRadius,
  frameWidth: PLAYER_ART.frameWidth,
  frameHeight: PLAYER_ART.frameHeight,
  originX: PLAYER_ART.originX,
  originY: PLAYER_ART.originY,
  bodyOffsetX: PLAYER_ART.bodyOffsetX,
  bodyOffsetY: PLAYER_ART.bodyOffsetY,
  /**
   * 碰撞圆圆心相对精灵锚点（脚底）的纵向偏移。
   * 圆心在脚底上方 12 像素，绘制时精灵 y = 碰撞圆心 y - bodyCenterOffsetY。
   */
  bodyCenterOffsetY:
    PLAYER_ART.bodyOffsetY +
    PLAYER_ART.collisionRadius -
    PLAYER_ART.originY * PLAYER_ART.frameHeight,
} as const;
