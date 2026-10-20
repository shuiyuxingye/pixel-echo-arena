import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArenaLayout, isCircleBlocked } from '../src/game/arena';
import { PLAYER } from '../src/game/config';
import { getCharacter } from '../src/game/data';
import { DODGE, PlayerMotion } from '../src/game/movement';
import type { MoveVector } from '../src/game/movement';

const ROOT = process.cwd();
const STEP = 1 / 60;

const layout = createArenaLayout();
const MOVE_SPEED = getCharacter('vishdal').moveSpeed;

function createMotion(startX = layout.spawn.x, startY = layout.spawn.y): PlayerMotion {
  return new PlayerMotion({
    layout,
    moveSpeed: MOVE_SPEED,
    startX,
    startY,
    radius: PLAYER.radius,
  });
}

/** 以固定逻辑步推进指定秒数。 */
function advance(motion: PlayerMotion, seconds: number, stepSeconds = STEP): void {
  const steps = Math.round(seconds / stepSeconds);
  for (let step = 0; step < steps; step += 1) {
    motion.step(stepSeconds);
  }
}

function distanceFrom(start: Readonly<MoveVector>, end: Readonly<MoveVector>): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

describe('八向移动与面向', () => {
  it('初始位置为场地中心，初始面向向右', () => {
    const motion = createMotion();
    expect(motion.position).toEqual({ x: layout.spawn.x, y: layout.spawn.y });
    expect(motion.facingDirection).toBe('east');
  });

  it.each([
    { keys: ['KeyD'], x: 1, y: 0, facing: 'east' },
    { keys: ['KeyD', 'KeyS'], x: Math.SQRT1_2, y: Math.SQRT1_2, facing: 'southEast' },
    { keys: ['KeyS'], x: 0, y: 1, facing: 'south' },
    { keys: ['KeyA', 'KeyS'], x: -Math.SQRT1_2, y: Math.SQRT1_2, facing: 'southWest' },
    { keys: ['KeyA'], x: -1, y: 0, facing: 'west' },
    { keys: ['KeyW', 'KeyA'], x: -Math.SQRT1_2, y: -Math.SQRT1_2, facing: 'northWest' },
    { keys: ['KeyW'], x: 0, y: -1, facing: 'north' },
    { keys: ['KeyW', 'KeyD'], x: Math.SQRT1_2, y: -Math.SQRT1_2, facing: 'northEast' },
  ])('$facing：$keys 合成归一化方向并更新面向', ({ keys, x, y, facing }) => {
    const motion = createMotion();
    for (const key of keys) motion.pressKey(key);

    const direction = motion.moveDirection;
    expect(direction.x).toBeCloseTo(x, 9);
    expect(direction.y).toBeCloseTo(y, 9);

    motion.step(STEP);
    expect(motion.facingDirection).toBe(facing);
  });

  it('斜向移动速度与单轴一致，不会加速', () => {
    const straight = createMotion();
    straight.pressKey('KeyD');
    advance(straight, 1);

    const diagonal = createMotion();
    diagonal.pressKey('KeyW');
    diagonal.pressKey('KeyD');
    advance(diagonal, 1);

    expect(distanceFrom(layout.spawn, straight.position)).toBeCloseTo(MOVE_SPEED, 6);
    expect(distanceFrom(layout.spawn, diagonal.position)).toBeCloseTo(MOVE_SPEED, 6);
  });

  it('松键或相反键抵消时保持最后面向，不产生移动', () => {
    const motion = createMotion();
    motion.pressKey('KeyW');
    advance(motion, 0.5);
    expect(motion.facingDirection).toBe('north');
    const held = motion.position;

    motion.releaseKey('KeyW');
    motion.pressKey('KeyA');
    motion.pressKey('KeyD');
    advance(motion, 0.5);

    expect(motion.moveDirection).toEqual({ x: 0, y: 0 });
    expect(motion.facingDirection).toBe('north');
    expect(motion.position).toEqual(held);
    expect(motion.isMoving).toBe(false);
  });

  it('顶墙时仍可转身，但位置不会进入墙体', () => {
    const motion = createMotion(layout.wallThickness + PLAYER.radius, layout.spawn.y);
    motion.pressKey('KeyA');
    advance(motion, 2);

    expect(motion.facingDirection).toBe('west');
    expect(motion.position.x).toBeCloseTo(layout.wallThickness + PLAYER.radius, 9);
    expect(isCircleBlocked(layout, motion.position.x, motion.position.y, PLAYER.radius)).toBe(
      false,
    );
  });

  it('上墙阻挡：碰撞圆边缘不会越过墙体', () => {
    const motion = createMotion();
    motion.pressKey('KeyW');
    advance(motion, 5);

    expect(motion.position.y).toBeGreaterThanOrEqual(layout.wallThickness + PLAYER.radius - 1e-9);
    expect(motion.position.y).toBeLessThan(layout.wallThickness + PLAYER.radius + 5);
    expect(isCircleBlocked(layout, motion.position.x, motion.position.y, PLAYER.radius)).toBe(
      false,
    );
  });

  it('短掩体阻挡水平移动，且不改变另一轴', () => {
    const cover = layout.covers[0];
    if (!cover) throw new Error('缺少短掩体');
    const startY = cover.y + cover.height / 2;
    const motion = createMotion(cover.x - PLAYER.radius - 20, startY);
    motion.pressKey('KeyD');
    advance(motion, 2);

    expect(motion.position.x).toBeLessThanOrEqual(cover.x - PLAYER.radius + 1e-9);
    expect(motion.position.x).toBeGreaterThan(cover.x - PLAYER.radius - 5);
    expect(motion.position.y).toBeCloseTo(startY, 9);
    expect(isCircleBlocked(layout, motion.position.x, motion.position.y, PLAYER.radius)).toBe(
      false,
    );
  });
});

describe('闪避', () => {
  it('基线为 0.18 秒、90 像素、0.15 秒无敌、3 秒冷却', () => {
    expect(DODGE.durationSeconds).toBe(0.18);
    expect(DODGE.distance).toBe(90);
    expect(DODGE.invulnerableSeconds).toBe(0.15);
    expect(DODGE.cooldownSeconds).toBe(3);
    expect(DODGE.speed).toBeCloseTo(500, 9);
  });

  it('静止时沿当前面向闪避，前 0.15 秒无敌，位移 90 像素', () => {
    const motion = createMotion();
    expect(motion.requestDodge()).toBe(true);
    expect(motion.isDodging).toBe(true);
    expect(motion.isInvulnerable).toBe(true);
    expect(motion.dodgeCooldownRemaining).toBeCloseTo(3, 9);

    motion.step(0.14);
    expect(motion.isInvulnerable).toBe(true);
    expect(motion.position.x - layout.spawn.x).toBeCloseTo(70, 6);

    motion.step(0.01);
    expect(motion.isInvulnerable).toBe(false);
    expect(motion.position.x - layout.spawn.x).toBeCloseTo(75, 6);

    motion.step(0.03);
    expect(motion.isDodging).toBe(false);
    expect(motion.position.x - layout.spawn.x).toBeCloseTo(90, 6);
    expect(motion.position.y).toBeCloseTo(layout.spawn.y, 9);
  });

  it('按移动输入方向闪避，静止后保留该面向', () => {
    const motion = createMotion();
    motion.pressKey('KeyW');
    motion.pressKey('KeyD');
    expect(motion.requestDodge()).toBe(true);
    expect(motion.facingDirection).toBe('northEast');

    motion.step(0.18);
    const delta = {
      x: motion.position.x - layout.spawn.x,
      y: motion.position.y - layout.spawn.y,
    };
    expect(Math.hypot(delta.x, delta.y)).toBeCloseTo(90, 6);
    expect(delta.x).toBeGreaterThan(0);
    expect(delta.y).toBeLessThan(0);
  });

  it('冷却期间不能再次闪避，3 秒后恢复', () => {
    const motion = createMotion();
    expect(motion.requestDodge()).toBe(true);
    expect(motion.requestDodge()).toBe(false);

    advance(motion, 2.9);
    expect(motion.dodgeCooldownRemaining).toBeGreaterThan(0);
    expect(motion.requestDodge()).toBe(false);

    advance(motion, 0.2);
    expect(motion.dodgeCooldownRemaining).toBe(0);
    expect(motion.requestDodge()).toBe(true);
  });

  it('闪避撞墙时停在墙边，不会穿墙', () => {
    const motion = createMotion(layout.wallThickness + PLAYER.radius, layout.spawn.y);
    motion.pressKey('KeyA');
    motion.step(STEP);
    motion.releaseKey('KeyA');
    expect(motion.facingDirection).toBe('west');

    expect(motion.requestDodge()).toBe(true);
    motion.step(0.18);

    expect(motion.position.x).toBeCloseTo(layout.wallThickness + PLAYER.radius, 9);
    expect(isCircleBlocked(layout, motion.position.x, motion.position.y, PLAYER.radius)).toBe(
      false,
    );
  });

  it('失焦清空按键并取消闪避，不会在恢复后自动移动', () => {
    const motion = createMotion();
    motion.pressKey('KeyD');
    advance(motion, 0.5);
    const held = motion.position;

    motion.clearKeys();
    advance(motion, 1);
    expect(motion.facingDirection).toBe('east');
    expect(motion.position).toEqual(held);

    expect(motion.requestDodge()).toBe(true);
    motion.cancelDodge();
    const cancelled = motion.position;
    advance(motion, 1);
    expect(motion.isDodging).toBe(false);
    expect(motion.isInvulnerable).toBe(false);
    expect(motion.position).toEqual(cancelled);
    expect(motion.dodgeCooldownRemaining).toBeGreaterThan(0);
  });
});

describe('物理键位与场景接入', () => {
  it('移动只认 WASD 的物理键位 code', () => {
    const motion = createMotion();
    motion.pressKey('KeyD');
    motion.pressKey('KeyW');
    expect(motion.moveDirection.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(motion.moveDirection.y).toBeCloseTo(-Math.SQRT1_2, 9);

    for (const code of ['ArrowRight', 'KeyJ', 'Space', 'Tab']) {
      motion.pressKey(code);
    }
    expect(motion.moveDirection.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(motion.moveDirection.y).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it('场景使用物理键位、阻止 Space/Tab 默认行为，并处理失焦暂停与 Enter 恢复', () => {
    const source = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );

    expect(source).toContain('event.code');
    expect(source).toContain('COMBAT_PREVENT_DEFAULT_CODES');
    expect(source).toContain('preventDefault');
    expect(source).toContain('Phaser.Core.Events.BLUR');
    expect(source).toContain('clearKeys');
    expect(source).toContain('resumeCombat');
    expect(source).toContain('startFollow');
  });
});
