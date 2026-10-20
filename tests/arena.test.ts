import { describe, expect, it } from 'vitest';
import { ARENA, PLAYER, SCENE_KEYS, VIEWPORT } from '../src/game/config';
import {
  createArenaLayout,
  inspectWalkableArea,
  isCircleBlocked,
  type Rect,
} from '../src/game/arena';

const layout = createArenaLayout();

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

describe('arena shell config', () => {
  it('uses a 960x540 logical viewport and a 1440x960 arena', () => {
    expect(VIEWPORT).toEqual({ width: 960, height: 540 });
    expect(ARENA).toEqual({ width: 1440, height: 960 });
    expect(layout.width).toBe(ARENA.width);
    expect(layout.height).toBe(ARENA.height);
    expect(SCENE_KEYS.arena).toBe('ArenaScene');
  });

  it('surrounds the arena with four thickened walls', () => {
    expect(layout.walls).toHaveLength(4);
    expect(layout.wallThickness).toBe(32);
    for (const wall of layout.walls) {
      expect(wall.width === ARENA.width || wall.height === ARENA.height).toBe(true);
      expect(Math.min(wall.width, wall.height)).toBe(layout.wallThickness);
    }
  });

  it('places four short covers symmetric about the arena centre', () => {
    expect(layout.covers).toHaveLength(4);
    for (const cover of layout.covers) {
      expect(cover.width).toBeLessThanOrEqual(160);
      expect(cover.height).toBeLessThanOrEqual(40);
      expect(cover.width).toBeGreaterThan(PLAYER.radius * 2);
      expect(cover.height).toBeGreaterThan(0);
    }

    const mirrors = layout.covers.flatMap((cover) => [
      {
        x: ARENA.width - cover.x - cover.width,
        y: cover.y,
        width: cover.width,
        height: cover.height,
      },
      {
        x: cover.x,
        y: ARENA.height - cover.y - cover.height,
        width: cover.width,
        height: cover.height,
      },
    ]);
    for (const mirror of mirrors) {
      expect(layout.covers).toContainEqual(mirror);
    }
  });

  it('keeps covers clear of walls and of each other', () => {
    for (const cover of layout.covers) {
      for (const wall of layout.walls) {
        expect(overlaps(cover, wall)).toBe(false);
      }
      expect(cover.x).toBeGreaterThanOrEqual(layout.wallThickness + PLAYER.radius);
      expect(cover.x + cover.width).toBeLessThanOrEqual(
        ARENA.width - layout.wallThickness - PLAYER.radius,
      );
      expect(cover.y).toBeGreaterThanOrEqual(layout.wallThickness + PLAYER.radius);
      expect(cover.y + cover.height).toBeLessThanOrEqual(
        ARENA.height - layout.wallThickness - PLAYER.radius,
      );
    }

    for (let i = 0; i < layout.covers.length; i += 1) {
      for (let j = i + 1; j < layout.covers.length; j += 1) {
        const first = layout.covers[i] as Rect;
        const second = layout.covers[j] as Rect;
        expect(overlaps(first, second)).toBe(false);
      }
    }
  });
});

describe('arena walkability', () => {
  it('spawns the player in the centre open area', () => {
    expect(layout.spawn).toEqual({ x: ARENA.width / 2, y: ARENA.height / 2 });
    expect(isCircleBlocked(layout, layout.spawn.x, layout.spawn.y, PLAYER.radius)).toBe(false);
    for (const offset of [-80, 0, 80]) {
      expect(
        isCircleBlocked(layout, layout.spawn.x + offset, layout.spawn.y + offset, PLAYER.radius),
      ).toBe(false);
    }
  });

  it('blocks positions inside walls and cover blocks', () => {
    expect(isCircleBlocked(layout, 16, 16, PLAYER.radius)).toBe(true);
    expect(isCircleBlocked(layout, ARENA.width - 16, 16, PLAYER.radius)).toBe(true);
    const firstCover = layout.covers[0] as Rect;
    expect(
      isCircleBlocked(
        layout,
        firstCover.x + firstCover.width / 2,
        firstCover.y + firstCover.height / 2,
        PLAYER.radius,
      ),
    ).toBe(true);
  });

  it('has no enclosed dead zones: every walkable cell is reachable from spawn', () => {
    const report = inspectWalkableArea(layout, 8);
    expect(report.walkableCells).toBeGreaterThan(1000);
    expect(report.reachableCells).toBe(report.walkableCells);
    expect(report.unreachableCells).toBe(0);
  });
});
