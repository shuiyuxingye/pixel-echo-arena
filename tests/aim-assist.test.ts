import { describe, expect, it } from 'vitest';
import { createArenaLayout, hasLineOfSight } from '../src/game/arena';
import {
  AIM_ASSIST_DEGREES,
  GRENADE_PROJECTILE_RADIUS,
  PROJECTILE_RADIUS,
  PROJECTILE_VISUAL_RADIUS_SCALE,
  TargetTracker,
  createProjectile,
  listFrontTargets,
  projectileVisualRadius,
  resolveAimAssist,
  stepProjectile,
  type Targetable,
} from '../src/game/combat';
import { getCharacter } from '../src/game/data';
import {
  FACING_LIST,
  nearestFacing,
  type Facing,
} from '../src/game/movement';

const STEP = 1 / 60;
const layout = createArenaLayout();
const VISHDA_ATTACK = getCharacter('vishdal').attack;
const AMIYA_ATTACK = getCharacter('amiya').attack;
const SARIA_ATTACK = getCharacter('saria').attack;

function atAngle(
  origin: { x: number; y: number },
  facing: Facing,
  degrees: number,
  distance: number,
  id: string,
  extra: Partial<Targetable> = {},
): Targetable {
  const facingDegrees = FACING_LIST.indexOf(facing) * 45;
  const radians = ((facingDegrees + degrees) * Math.PI) / 180;
  return {
    id,
    x: origin.x + Math.cos(radians) * distance,
    y: origin.y + Math.sin(radians) * distance,
    radius: 12,
    isAlive: true,
    ...extra,
  };
}

describe('轻自瞄 ±25° 扇区', () => {
  const origin = { x: 300, y: 300 };
  const range = 300;

  it('半角为 25°', () => {
    expect(AIM_ASSIST_DEGREES).toBe(25);
  });

  it('±25° 内命中最近瞄准线的目标，边界包含 25°', () => {
    const inside = atAngle(origin, 'east', 24, 200, 'inside');
    const boundary = atAngle(origin, 'east', 25, 180, 'boundary');
    const outside = atAngle(origin, 'east', 26, 160, 'outside');

    expect(
      resolveAimAssist(origin, 'east', [outside, inside], { range }).target?.id,
    ).toBe('inside');
    expect(
      resolveAimAssist(origin, 'east', [outside, boundary], { range }).target?.id,
    ).toBe('boundary');
    expect(resolveAimAssist(origin, 'east', [outside], { range }).target).toBeNull();
  });

  it('偏转角不超过 25°，方向指向被选中的目标', () => {
    const target = atAngle(origin, 'east', 20, 200, 'target');
    const aim = resolveAimAssist(origin, 'east', [target], { range });

    expect(aim.angleDegrees).toBeCloseTo(20, 6);
    expect(aim.direction.x).toBeCloseTo(Math.cos((20 * Math.PI) / 180), 6);
    expect(aim.direction.y).toBeCloseTo(Math.sin((20 * Math.PI) / 180), 6);
  });

  it('背后目标不抢方向；无候选时沿面向空射', () => {
    const behind = atAngle(origin, 'east', 180, 60, 'behind');
    const aim = resolveAimAssist(origin, 'east', [behind], { range });

    expect(aim.target).toBeNull();
    expect(aim.direction).toEqual({ x: 1, y: 0 });
    expect(aim.angleDegrees).toBe(0);
  });

  it('射程外目标不参与校正，射程边界按中心距离包含', () => {
    const outside = atAngle(origin, 'east', 0, 301, 'far');
    const boundary = atAngle(origin, 'east', 0, 300, 'edge');

    expect(resolveAimAssist(origin, 'east', [outside], { range }).target).toBeNull();
    expect(resolveAimAssist(origin, 'east', [boundary], { range }).target?.id).toBe(
      'edge',
    );
  });

  it('选择离瞄准线最近的目标，而不是最近距离', () => {
    const closerToLine = atAngle(origin, 'east', 8, 280, 'line');
    const fartherFromLine = atAngle(origin, 'east', 22, 60, 'near');

    expect(
      resolveAimAssist(origin, 'east', [fartherFromLine, closerToLine], { range })
        .target?.id,
    ).toBe('line');
  });

  it('默认敌人优先于宝箱，即使宝箱更靠近瞄准线', () => {
    const chest = atAngle(origin, 'east', 2, 120, 'chest', { kind: 'chest' });
    const enemy = atAngle(origin, 'east', 18, 200, 'enemy');

    expect(resolveAimAssist(origin, 'east', [chest, enemy], { range }).target?.id).toBe(
      'enemy',
    );
  });

  it('Tab 明确选中的宝箱在满足角度与射程时优先', () => {
    const chest = atAngle(origin, 'east', 2, 120, 'chest', { kind: 'chest' });
    const enemy = atAngle(origin, 'east', 18, 200, 'enemy');

    expect(
      resolveAimAssist(origin, 'east', [chest, enemy], {
        range,
        preferredTargetId: 'chest',
      }).target?.id,
    ).toBe('chest');
  });

  it('Tab 目标不满足 ±25° 时不抢自动选择', () => {
    const chest = atAngle(origin, 'east', 40, 120, 'chest', { kind: 'chest' });
    const enemy = atAngle(origin, 'east', 10, 200, 'enemy');

    expect(
      resolveAimAssist(origin, 'east', [chest, enemy], {
        range,
        preferredTargetId: 'chest',
      }).target?.id,
    ).toBe('enemy');
  });
});

describe('轻自瞄遮挡与目标失效', () => {
  const origin = { x: 300, y: 300 };
  const range = 400;
  const lineOfSight = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    hasLineOfSight(layout, from, to);

  it('被掩体遮挡的目标不参与校正，改选无遮挡目标', () => {
    // 中央偏左掩体：x 376–504、y 286–314。正东目标与掩体同高，视线被挡住。
    const blocked = { id: 'blocked', x: 580, y: 300, radius: 12, isAlive: true };
    const visible = atAngle(origin, 'east', 15, 200, 'visible');

    expect(lineOfSight(origin, blocked)).toBe(false);
    expect(lineOfSight(origin, visible)).toBe(true);
    expect(
      resolveAimAssist(origin, 'east', [blocked, visible], { range, lineOfSight })
        .target?.id,
    ).toBe('visible');
    expect(
      resolveAimAssist(origin, 'east', [blocked], { range, lineOfSight }).target,
    ).toBeNull();
  });

  it('目标死亡后下一发重新选择；已发弹体不改道', () => {
    const alive = atAngle(origin, 'east', 5, 200, 'alive');
    const dying = atAngle(origin, 'east', 15, 200, 'dying');
    const first = resolveAimAssist(origin, 'east', [alive, dying], { range });
    expect(first.target?.id).toBe('alive');

    const projectile = createProjectile(1, origin, 'east', VISHDA_ATTACK, {
      direction: first.direction,
      radius: GRENADE_PROJECTILE_RADIUS,
    });
    const vx = projectile.vx;
    const vy = projectile.vy;

    const dead = { ...dying, isAlive: false };
    const second = resolveAimAssist(origin, 'east', [dead], { range });
    expect(second.target).toBeNull();

    stepProjectile(projectile, STEP, layout);
    expect(projectile.vx).toBe(vx);
    expect(projectile.vy).toBe(vy);
  });
});

describe('提示目标追踪的类别优先级与遮挡', () => {
  const origin = { x: 100, y: 100 };
  const range = 300;
  const chest: Targetable = { id: 'chest', x: 150, y: 100, kind: 'chest' };
  const enemy: Targetable = { id: 'enemy', x: 220, y: 100 };

  it('自动选择优先敌人，Tab 可循环到宝箱并保持手动选中', () => {
    const tracker = new TargetTracker(range);
    expect(tracker.update(origin, 'east', [chest, enemy])?.id).toBe('enemy');
    expect(tracker.isManualSelection).toBe(false);

    expect(tracker.cycle(origin, 'east', [chest, enemy])?.id).toBe('chest');
    expect(tracker.isManualSelection).toBe(true);
    expect(tracker.update(origin, 'east', [chest, enemy])?.id).toBe('chest');
  });

  it('被遮挡目标不出现在提示候选中', () => {
    const occluded = { id: 'hidden', x: 130, y: 100 };
    const tracker = new TargetTracker(range, 120, (from, to) =>
      !(from.x === origin.x && to.x === occluded.x),
    );

    expect(tracker.update(origin, 'east', [occluded, enemy])?.id).toBe('enemy');
  });
});

describe('弹体碰撞与视觉尺寸', () => {
  it('普通弹碰撞半径 9、榴弹 11', () => {
    expect(PROJECTILE_RADIUS).toBe(9);
    expect(GRENADE_PROJECTILE_RADIUS).toBe(11);

    const normal = createProjectile(1, { x: 100, y: 100 }, 'east', AMIYA_ATTACK);
    const grenade = createProjectile(2, { x: 100, y: 100 }, 'east', VISHDA_ATTACK, {
      radius: GRENADE_PROJECTILE_RADIUS,
    });
    expect(normal.radius).toBe(9);
    expect(grenade.radius).toBe(11);
  });

  it('视觉直径约为碰撞直径的 1.1 倍', () => {
    expect(PROJECTILE_VISUAL_RADIUS_SCALE).toBe(1.1);
    expect(projectileVisualRadius(PROJECTILE_RADIUS) / PROJECTILE_RADIUS).toBeCloseTo(
      1.1,
      9,
    );
    expect(
      projectileVisualRadius(GRENADE_PROJECTILE_RADIUS) / GRENADE_PROJECTILE_RADIUS,
    ).toBeCloseTo(1.1, 9);
  });
});

describe('骑士盾面与八向指示', () => {
  const origin = { x: 100, y: 100 };

  it('盾击仍是近战扇面：82 距离、110° 张角', () => {
    expect(SARIA_ATTACK.range).toBe(82);
    expect(SARIA_ATTACK.arcDegrees).toBe(110);

    const halfAngle = 55 * (Math.PI / 180);
    const inside = {
      id: 'inside',
      x: origin.x + 80 * Math.cos(halfAngle - 0.01),
      y: origin.y + 80 * Math.sin(halfAngle - 0.01),
    };
    const outside = {
      id: 'outside',
      x: origin.x + 80 * Math.cos(halfAngle + 0.01),
      y: origin.y + 80 * Math.sin(halfAngle + 0.01),
    };
    const outOfRange = { id: 'far', x: origin.x + 83, y: origin.y };

    expect(
      listFrontTargets(origin, 'east', [inside, outside, outOfRange], 82, 110).map(
        (target) => target.id,
      ),
    ).toEqual(['inside']);
  });

  it('轻自瞄偏转后的施法帧取最近八向，身体仍按四向素材映射', () => {
    const nearlyEast = { x: Math.cos((10 * Math.PI) / 180), y: Math.sin((10 * Math.PI) / 180) };
    const diagonalish = {
      x: Math.cos((40 * Math.PI) / 180),
      y: Math.sin((40 * Math.PI) / 180),
    };

    expect(nearestFacing(nearlyEast)).toBe('east');
    expect(nearestFacing(diagonalish)).toBe('southEast');
    expect(nearestFacing({ x: 0, y: 0 })).toBeNull();
  });
});
