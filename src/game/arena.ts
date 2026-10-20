/**
 * 竞技场几何（纯规则，不依赖 Phaser）。
 * 场地 1440×960：四周墙壁、中央开阔区、4 个对称短掩体；掩体不接触墙壁，因此不存在封闭死区。
 */
import { ARENA, PLAYER } from './config';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ArenaLayout {
  width: number;
  height: number;
  wallThickness: number;
  walls: Rect[];
  covers: Rect[];
  spawn: Point;
  playerRadius: number;
}

export interface WalkableAreaReport {
  step: number;
  cols: number;
  rows: number;
  walkableCells: number;
  reachableCells: number;
  unreachableCells: number;
}

const WALL_THICKNESS = 32;
const COVER_WIDTH = 128;
const COVER_HEIGHT = 28;

/** 4 个短掩体的中心，围绕场地中心 (720, 480) 双向对称。 */
const COVER_CENTERS: Point[] = [
  { x: ARENA.width / 2 - 280, y: ARENA.height / 2 - 180 },
  { x: ARENA.width / 2 + 280, y: ARENA.height / 2 - 180 },
  { x: ARENA.width / 2 - 280, y: ARENA.height / 2 + 180 },
  { x: ARENA.width / 2 + 280, y: ARENA.height / 2 + 180 },
];

export function createArenaLayout(): ArenaLayout {
  const walls: Rect[] = [
    { x: 0, y: 0, width: ARENA.width, height: WALL_THICKNESS },
    {
      x: 0,
      y: ARENA.height - WALL_THICKNESS,
      width: ARENA.width,
      height: WALL_THICKNESS,
    },
    { x: 0, y: 0, width: WALL_THICKNESS, height: ARENA.height },
    {
      x: ARENA.width - WALL_THICKNESS,
      y: 0,
      width: WALL_THICKNESS,
      height: ARENA.height,
    },
  ];

  const covers = COVER_CENTERS.map((center) => ({
    x: center.x - COVER_WIDTH / 2,
    y: center.y - COVER_HEIGHT / 2,
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
  }));

  return {
    width: ARENA.width,
    height: ARENA.height,
    wallThickness: WALL_THICKNESS,
    walls,
    covers,
    spawn: { x: ARENA.width / 2, y: ARENA.height / 2 },
    playerRadius: PLAYER.radius,
  };
}

export function circleIntersectsRect(
  centerX: number,
  centerY: number,
  radius: number,
  rect: Rect,
): boolean {
  const nearestX = Math.min(Math.max(centerX, rect.x), rect.x + rect.width);
  const nearestY = Math.min(Math.max(centerY, rect.y), rect.y + rect.height);
  const dx = centerX - nearestX;
  const dy = centerY - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

export function isCircleBlocked(
  layout: ArenaLayout,
  centerX: number,
  centerY: number,
  radius: number,
): boolean {
  const insideArena =
    centerX - radius >= 0 &&
    centerY - radius >= 0 &&
    centerX + radius <= layout.width &&
    centerY + radius <= layout.height;
  if (!insideArena) return true;

  for (const obstacle of [...layout.walls, ...layout.covers]) {
    if (circleIntersectsRect(centerX, centerY, radius, obstacle)) return true;
  }
  return false;
}

/** 视线/弹道的采样步长，避免高速位移跨过薄掩体。 */
const LINE_SAMPLE_STEP = 4;

/**
 * 两点之间是否通视：沿线段按 4 像素采样，任一点落在障碍内即视为被遮挡。
 * 用于爆炸不穿墙与敌人绕掩体判断。
 */
export function hasLineOfSight(
  layout: ArenaLayout,
  from: Point,
  to: Point,
  clearance = 1,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return true;

  const steps = Math.max(1, Math.ceil(distance / LINE_SAMPLE_STEP));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = from.x + dx * t;
    const y = from.y + dy * t;
    if (isCircleBlocked(layout, x, y, clearance)) return false;
  }
  return true;
}

export interface MovedCircle {
  readonly x: number;
  readonly y: number;
}

/**
 * 圆形实体带碰撞的位移：分轴判定并拆成不超过 4 像素的子步，
 * 因此顶住障碍时仍可沿边滑动，但不会穿墙。玩家、近战敌人与流形共用。
 */
export function moveCircleWithCollision(
  layout: ArenaLayout,
  x: number,
  y: number,
  radius: number,
  dx: number,
  dy: number,
): MovedCircle {
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { x, y };

  const substeps = Math.max(1, Math.ceil(distance / LINE_SAMPLE_STEP));
  const stepX = dx / substeps;
  const stepY = dy / substeps;
  let currentX = x;
  let currentY = y;

  for (let step = 0; step < substeps; step += 1) {
    const nextX = currentX + stepX;
    if (!isCircleBlocked(layout, nextX, currentY, radius)) currentX = nextX;
    const nextY = currentY + stepY;
    if (!isCircleBlocked(layout, currentX, nextY, radius)) currentY = nextY;
  }

  return { x: currentX, y: currentY };
}

/**
 * 以固定网格采样可行走区域，并从出生点做洪水填充。
 * unreachableCells 为 0 表示不存在与出生点隔离的封闭死区。
 */
export function inspectWalkableArea(
  layout: ArenaLayout = createArenaLayout(),
  step = 8,
): WalkableAreaReport {
  const cols = Math.floor(layout.width / step);
  const rows = Math.floor(layout.height / step);
  const walkable = new Uint8Array(cols * rows);

  let walkableCells = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * step + step / 2;
      const y = row * step + step / 2;
      if (!isCircleBlocked(layout, x, y, layout.playerRadius)) {
        walkable[row * cols + col] = 1;
        walkableCells += 1;
      }
    }
  }

  const startCol = Math.floor(layout.spawn.x / step);
  const startRow = Math.floor(layout.spawn.y / step);
  const visited = new Uint8Array(cols * rows);
  let reachableCells = 0;

  const startIndex = startRow * cols + startCol;
  if (walkable[startIndex] === 1) {
    const queue: number[] = [startIndex];
    visited[startIndex] = 1;
    reachableCells = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head] as number;
      const row = Math.floor(index / cols);
      const col = index % cols;
      const neighbors = [
        [col - 1, row],
        [col + 1, row],
        [col, row - 1],
        [col, row + 1],
      ] as const;
      for (const [nextCol, nextRow] of neighbors) {
        if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows) continue;
        const nextIndex = nextRow * cols + nextCol;
        if (walkable[nextIndex] === 1 && visited[nextIndex] === 0) {
          visited[nextIndex] = 1;
          reachableCells += 1;
          queue.push(nextIndex);
        }
      }
    }
  }

  return {
    step,
    cols,
    rows,
    walkableCells,
    reachableCells,
    unreachableCells: walkableCells - reachableCells,
  };
}
