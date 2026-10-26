/** 视口、场地与资源键的集中配置。纯数据模块，不依赖 Phaser，可在 Node 测试中导入。 */

import { PLAYER_COLLISION_RADIUS } from './player-art';

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
  floor: '/assets/art/arena.png',
  wall: '/assets/art/wall.png',
  cover: '/assets/art/cover.png',
  playerVishdal: '/assets/art/hero-vishdal.png',
  playerAmiya: '/assets/art/hero-amiya.png',
  playerSaria: '/assets/art/hero-saria.png',
  playerMuelsyse: '/assets/art/hero-muelsyse.png',
} as const;

export type AssetKey = (typeof ASSET_KEYS)[keyof typeof ASSET_KEYS];

export const PLAYER = {
  /** 逻辑碰撞半径固定 12，不随 Q 版大头轮廓扩大。 */
  radius: PLAYER_COLLISION_RADIUS,
  /**
   * 碰撞圆圆心相对精灵锚点（脚底）的纵向偏移。
   * 圆心在脚底上方 12 像素，绘制时精灵 y = 碰撞圆心 y - bodyCenterOffsetY。
   * 帧尺寸与显示缩放变化时该值不变，因此 96×96 样板沿用同一套位置逻辑。
   */
  bodyCenterOffsetY: -PLAYER_COLLISION_RADIUS,
} as const;
