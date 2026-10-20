import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/game/arena';
import {
  AttackTimer,
  Combatant,
  HealthState,
  TARGET_SECTOR_DEGREES,
  TargetTracker,
  computeDamage,
  createProjectile,
  hudValue,
  isTargetInSector,
  listFrontTargets,
  projectileHitsTarget,
  resolveGroundCastPoint,
  selectFrontTarget,
  stepProjectile,
  type Targetable,
} from '../src/game/combat';
import { getCharacter } from '../src/game/data';
import { DEFAULT_KEY_BINDINGS } from '../src/game/settings';
import {
  FACING_LIST,
  FACING_VECTORS,
  PlayerMotion,
  type Facing,
} from '../src/game/movement';

const ROOT = process.cwd();
const STEP = 1 / 60;
const layout = createArenaLayout();
const VISHDA_ATTACK = getCharacter('vishdal').attack;
const MOVE_SPEED = getCharacter('vishdal').moveSpeed;

function target(id: string, x: number, y: number, isAlive = true): Targetable {
  return { id, x, y, radius: 12, isAlive };
}

const MOVE_KEYS_BY_FACING: Readonly<Record<Facing, readonly string[]>> = {
  east: ['KeyD'],
  southEast: ['KeyD', 'KeyS'],
  south: ['KeyS'],
  southWest: ['KeyA', 'KeyS'],
  west: ['KeyA'],
  northWest: ['KeyA', 'KeyW'],
  north: ['KeyW'],
  northEast: ['KeyD', 'KeyW'],
};

function createMotion(x = layout.spawn.x, y = layout.spawn.y): PlayerMotion {
  return new PlayerMotion({
    layout,
    moveSpeed: MOVE_SPEED,
    startX: x,
    startY: y,
    radius: getCharacter('vishdal').radius,
  });
}

function oppositeFacing(facing: Facing): Facing {
  const index = FACING_LIST.indexOf(facing);
  return FACING_LIST[(index + 4) % FACING_LIST.length] as Facing;
}

describe('伤害结算', () => {
  it('物理伤害按 原始×100/(100+护甲) 计算并保留小数', () => {
    expect(computeDamage(36, 'physical', 0, 0)).toBeCloseTo(36, 12);
    expect(computeDamage(36, 'physical', 40, 0)).toBeCloseTo(36 * (100 / 140), 12);
    expect(computeDamage(36, 'physical', 8, 0)).toBeCloseTo(36 * (100 / 108), 12);
  });

  it('法术伤害按 原始×(1−法抗) 计算', () => {
    expect(computeDamage(20, 'magic', 0, 0.15)).toBeCloseTo(17, 12);
    expect(computeDamage(20, 'magic', 999, 0)).toBeCloseTo(20, 12);
  });

  it('真实伤害不受护甲与法抗影响', () => {
    expect(computeDamage(26, 'true', 40, 0.15)).toBe(26);
  });

  it('伤害先扣护盾再扣生命，生命 ≤0 判死亡', () => {
    const health = new HealthState({ maxHealth: 60, shield: 25 });

    const first = health.applyDamage(30, 'physical');
    expect(first.applied).toBe(true);
    expect(first.shieldAbsorbed).toBe(25);
    expect(first.healthLost).toBe(5);
    expect(first.health).toBe(55);
    expect(first.shield).toBe(0);
    expect(first.died).toBe(false);

    const lethal = health.applyDamage(70, 'physical');
    expect(lethal.healthLost).toBe(55);
    expect(lethal.health).toBe(0);
    expect(lethal.died).toBe(true);
    expect(health.isDead).toBe(true);
    expect(health.deathCount).toBe(1);
  });

  it('重复击杀保护：死亡后再次受击被忽略，击杀只计一次', () => {
    const health = new HealthState({ maxHealth: 10 });
    expect(health.applyDamage(12, 'true').died).toBe(true);

    const again = health.applyDamage(12, 'true');
    expect(again.applied).toBe(false);
    expect(again.died).toBe(false);
    expect(health.health).toBe(0);
    expect(health.deathCount).toBe(1);
  });

  it('内部生命保留小数，HUD 向上取整', () => {
    const health = new HealthState({ maxHealth: 60, armor: 5 });
    const result = health.applyDamage(10, 'physical');

    expect(result.damage).toBeCloseTo(10 * (100 / 105), 12);
    expect(health.health).toBeCloseTo(60 - 10 * (100 / 105), 12);
    expect(Number.isInteger(health.health)).toBe(false);
    expect(hudValue(health.health)).toBe(51);
  });

  it('Combatant 把伤害转发给生命状态', () => {
    const enemy = new Combatant({
      id: 'enemy-1',
      x: 0,
      y: 0,
      radius: 14,
      maxHealth: 45,
      armor: 0,
      magicResist: 0.15,
    });

    const result = enemy.applyDamage(20, 'magic');
    expect(result.damage).toBeCloseTo(17, 12);
    expect(enemy.health.health).toBeCloseTo(28, 12);
    expect(enemy.isAlive).toBe(true);
  });
});

describe('前方扇形选敌', () => {
  const origin = { x: 100, y: 100 };
  const range = 300;

  it('扇区总张角为 120°', () => {
    expect(TARGET_SECTOR_DEGREES).toBe(120);
  });

  it('选择面向前方的最近敌人，忽略背后更近的敌人', () => {
    const front = target('front', 210, 100);
    const behind = target('behind', 50, 100);

    expect(selectFrontTarget(origin, 'east', [behind, front], range)).toBe(front);
  });

  it('无前方目标时返回 null，不回退到全向最近', () => {
    expect(selectFrontTarget(origin, 'east', [target('behind', 90, 100)], range)).toBeNull();
  });

  it('扇区边界按 60° 半角判定', () => {
    const inside = target('inside', 100 + Math.cos((59 * Math.PI) / 180) * 100, 100 + Math.sin((59 * Math.PI) / 180) * 100);
    const outside = target('outside', 100 + Math.cos((61 * Math.PI) / 180) * 100, 100 + Math.sin((61 * Math.PI) / 180) * 100);

    expect(isTargetInSector(origin, 'east', inside, range)).toBe(true);
    expect(isTargetInSector(origin, 'east', outside, range)).toBe(false);
    expect(selectFrontTarget(origin, 'east', [outside, inside], range)).toBe(inside);
  });

  it('射程外不选，射程边界按中心距离判定', () => {
    expect(selectFrontTarget(origin, 'east', [target('far', 401, 100)], range)).toBeNull();
    expect(selectFrontTarget(origin, 'east', [target('edge', 400, 100)], 300)?.id).toBe('edge');
  });

  it('等距按稳定 ID 升序排序；死亡目标被排除', () => {
    const later = target('b', 200, 150);
    const earlier = target('a', 200, 50);
    expect(listFrontTargets(origin, 'east', [later, earlier], range).map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);

    const dead = target('a', 200, 50, false);
    expect(selectFrontTarget(origin, 'east', [dead, later], range)).toBe(later);
  });

  it.each(FACING_LIST)('%s：更近的背后敌人不抢前方目标', (facing) => {
    const vector = FACING_VECTORS[facing];
    const front = target('front', origin.x + vector.x * 120, origin.y + vector.y * 120);
    const behind = target('behind', origin.x - vector.x * 60, origin.y - vector.y * 60);

    expect(selectFrontTarget(origin, facing, [behind, front], range)).toBe(front);
  });
});

describe('提示目标追踪（自动选敌与 Tab）', () => {
  const origin = { x: 100, y: 100 };
  const range = 300;
  const near = target('near', 200, 100);
  const far = target('far', 250, 100);
  const behind = target('behind', 50, 100);

  it('自动选择始终取前方最近目标', () => {
    const tracker = new TargetTracker(range);
    expect(tracker.update(origin, 'east', [far, near, behind])?.id).toBe('near');
    expect(tracker.targetId).toBe('near');

    const closer = target('closer', 150, 100);
    expect(tracker.update(origin, 'east', [closer, near, far])?.id).toBe('closer');
  });

  it('Tab 手动选择后保持，直到该目标失效', () => {
    const tracker = new TargetTracker(range);
    tracker.update(origin, 'east', [near, far]);
    expect(tracker.cycle(origin, 'east', [near, far])?.id).toBe('far');

    const closer = target('closer', 150, 100);
    expect(tracker.update(origin, 'east', [closer, near, far])?.id).toBe('far');

    const deadFar = target('far', 250, 100, false);
    expect(tracker.update(origin, 'east', [closer, near, deadFar])?.id).toBe('closer');
  });

  it('Tab 按距离与 ID 顺序循环切换，且不修改传入的面向', () => {
    const tracker = new TargetTracker(range);
    tracker.update(origin, 'east', [far, near]);
    expect(tracker.targetId).toBe('near');

    expect(tracker.cycle(origin, 'east', [far, near])?.id).toBe('far');
    expect(tracker.cycle(origin, 'east', [far, near])?.id).toBe('near');
    expect(tracker.targetId).toBe('near');
  });

  it('目标死亡、出射程或转到背后时取消并重新选择', () => {
    const tracker = new TargetTracker(range);
    tracker.update(origin, 'east', [near, far]);
    expect(tracker.targetId).toBe('near');

    expect(tracker.update(origin, 'east', [target('near', 200, 100, false), far])?.id).toBe('far');

    expect(tracker.update(origin, 'east', [target('far', 500, 100)])).toBeNull();
    expect(tracker.targetId).toBeNull();

    const behindTracker = new TargetTracker(range);
    behindTracker.update(origin, 'east', [near, behind]);
    expect(behindTracker.targetId).toBe('near');
    expect(behindTracker.update(origin, 'west', [near, behind])?.id).toBe('behind');
  });

  it('Tab 不改变玩家面向', () => {
    const motion = createMotion();
    motion.pressKey('KeyW');
    motion.step(STEP);
    motion.releaseKey('KeyW');
    expect(motion.facingDirection).toBe('north');

    const tracker = new TargetTracker(range);
    tracker.cycle(motion.position, motion.facingDirection, [near, far]);
    expect(motion.facingDirection).toBe('north');
  });
});

describe('按住式普通攻击', () => {
  it('首次按下立即发射，之后按攻击间隔发射', () => {
    const timer = new AttackTimer(VISHDA_ATTACK.intervalSeconds);

    expect(timer.update(STEP, false)).toBe(false);
    expect(timer.update(STEP, true)).toBe(true);
    expect(timer.cooldownRemaining).toBeCloseTo(0.9, 12);

    for (let step = 0; step < 53; step += 1) {
      expect(timer.update(STEP, true)).toBe(false);
    }
    expect(timer.update(STEP, true)).toBe(true);
  });

  it('松开按键不发射；再次按下要等剩余攻击间隔', () => {
    const timer = new AttackTimer(0.9);
    expect(timer.update(STEP, true)).toBe(true);

    for (let step = 0; step < 20; step += 1) {
      expect(timer.update(STEP, false)).toBe(false);
    }
    expect(timer.update(STEP, true)).toBe(false);
  });

  it('无敌人时也允许空射并消耗攻击间隔', () => {
    const timer = new AttackTimer(0.9);
    expect(timer.update(STEP, true)).toBe(true);
    expect(timer.cooldownRemaining).toBeCloseTo(0.9, 12);
  });

  it('可按发覆盖攻击间隔，用于爆裂黎明的 1.1 秒', () => {
    const timer = new AttackTimer(0.9);
    expect(timer.update(STEP, true, 1.1)).toBe(true);
    expect(timer.cooldownRemaining).toBeCloseTo(1.1, 12);

    for (let step = 0; step < 65; step += 1) {
      expect(timer.update(STEP, true, 1.1)).toBe(false);
    }
    expect(timer.cooldownRemaining).toBeCloseTo(1.1 - 65 * STEP, 9);
    expect(timer.update(STEP, true, 1.1)).toBe(true);
  });
});

describe('八向射击与弹体', () => {
  it.each(FACING_LIST)('%s：移动后、松键后都沿最后面向出射', (facing) => {
    const motion = createMotion();
    const vector = FACING_VECTORS[facing];
    const keys = MOVE_KEYS_BY_FACING[facing];

    for (const key of keys) motion.pressKey(key);
    motion.step(STEP);
    expect(motion.facingDirection).toBe(facing);

    for (const key of keys) motion.releaseKey(key);
    motion.step(STEP);
    expect(motion.facingDirection).toBe(facing);

    const projectile = createProjectile(1, motion.position, motion.facingDirection, VISHDA_ATTACK);
    const speed = Math.hypot(projectile.vx, projectile.vy);
    expect(projectile.vx / speed).toBeCloseTo(vector.x, 9);
    expect(projectile.vy / speed).toBeCloseTo(vector.y, 9);
  });

  it.each(FACING_LIST)('%s：先朝反方向移动，再转身施放使用新面向', (facing) => {
    const motion = createMotion();
    const opposite = oppositeFacing(facing);

    for (const key of MOVE_KEYS_BY_FACING[opposite]) motion.pressKey(key);
    motion.step(STEP);
    expect(motion.facingDirection).toBe(opposite);
    for (const key of MOVE_KEYS_BY_FACING[opposite]) motion.releaseKey(key);

    for (const key of MOVE_KEYS_BY_FACING[facing]) motion.pressKey(key);
    motion.step(STEP);
    for (const key of MOVE_KEYS_BY_FACING[facing]) motion.releaseKey(key);
    motion.step(STEP);
    expect(motion.facingDirection).toBe(facing);

    const vector = FACING_VECTORS[facing];
    const projectile = createProjectile(1, motion.position, motion.facingDirection, VISHDA_ATTACK);
    const speed = Math.hypot(projectile.vx, projectile.vy);
    expect(projectile.vx / speed).toBeCloseTo(vector.x, 9);
    expect(projectile.vy / speed).toBeCloseTo(vector.y, 9);
  });

  it('转身后施放使用新面向，已发射弹体不改变方向', () => {
    const motion = createMotion();
    motion.pressKey('KeyD');
    motion.step(STEP);
    const first = createProjectile(1, motion.position, motion.facingDirection, VISHDA_ATTACK);
    expect(first.vx).toBeGreaterThan(0);

    motion.releaseKey('KeyD');
    motion.pressKey('KeyA');
    motion.step(STEP);
    expect(motion.facingDirection).toBe('west');

    const second = createProjectile(2, motion.position, motion.facingDirection, VISHDA_ATTACK);
    expect(second.vx).toBeLessThan(0);
    expect(first.vx).toBeGreaterThan(0);
    expect(first.vy).toBe(0);
  });

  it('弹体飞满射程后失效，位置沿面向前进', () => {
    const origin = { x: layout.spawn.x, y: layout.spawn.y };
    const projectile = createProjectile(1, origin, 'east', VISHDA_ATTACK);

    let status = stepProjectile(projectile, STEP, layout);
    let steps = 0;
    while (status === 'active' && steps < 600) {
      status = stepProjectile(projectile, STEP, layout);
      steps += 1;
    }

    expect(status).toBe('expired');
    expect(projectile.x - origin.x).toBeGreaterThanOrEqual(VISHDA_ATTACK.range);
    expect(projectile.x - origin.x).toBeLessThan(VISHDA_ATTACK.range + 4);
    expect(projectile.y).toBeCloseTo(origin.y, 9);
  });

  it('弹体命中墙体或掩体时停止并返回 blocked', () => {
    const origin = { x: 60, y: layout.spawn.y };
    const projectile = createProjectile(1, origin, 'west', VISHDA_ATTACK);

    let status = stepProjectile(projectile, STEP, layout);
    let steps = 0;
    while (status === 'active' && steps < 100) {
      status = stepProjectile(projectile, STEP, layout);
      steps += 1;
    }

    expect(status).toBe('blocked');
    expect(projectile.x).toBeGreaterThan(layout.wallThickness);
    expect(projectile.x).toBeLessThan(origin.x);
  });

  it('弹体与目标圆形重叠时判定命中', () => {
    const projectile = createProjectile(
      1,
      { x: 100, y: 100 },
      'east',
      { ...VISHDA_ATTACK, range: 10 },
    );
    projectile.x = 118;
    projectile.y = 100;

    expect(projectileHitsTarget(projectile, target('hit', 130, 100))).toBe(true);
    expect(projectileHitsTarget(projectile, target('miss', 160, 100))).toBe(false);
  });
});

describe('定向地面落点', () => {
  it.each(FACING_LIST)('%s：沿面向按配置距离落点', (facing) => {
    const vector = FACING_VECTORS[facing];
    const origin = { x: layout.spawn.x, y: layout.spawn.y };
    const point = resolveGroundCastPoint(layout, origin, facing, 120);

    expect(point.distance).toBeCloseTo(120, 9);
    expect(point.truncated).toBe(false);
    expect(point.x - origin.x).toBeCloseTo(vector.x * 120, 9);
    expect(point.y - origin.y).toBeCloseTo(vector.y * 120, 9);
  });

  it('遇墙截断，落点停在墙前', () => {
    const origin = { x: 60, y: layout.spawn.y };
    const point = resolveGroundCastPoint(layout, origin, 'west', 200);

    expect(point.truncated).toBe(true);
    expect(point.distance).toBeGreaterThan(0);
    expect(point.distance).toBeLessThan(200);
    expect(point.x).toBeGreaterThan(layout.wallThickness);
  });

  it('遇掩体截断', () => {
    const cover = layout.covers[0];
    if (!cover) throw new Error('缺少短掩体');
    const origin = { x: cover.x - 120, y: cover.y + cover.height / 2 };
    const point = resolveGroundCastPoint(layout, origin, 'east', 200);

    expect(point.truncated).toBe(true);
    expect(point.x).toBeLessThan(cover.x);
  });
});

describe('场景接入', () => {
  it('竞技场场景使用 J 攻击、Tab 切换目标并接入敌人系统', () => {
    const source = readFileSync(resolve(ROOT, 'src/game/scenes/ArenaScene.ts'), 'utf8');

    // 键位经共享设置解析，默认 J/Tab 映射到 attack/cycleTarget（US-022 起不再硬编码物理键）。
    expect(DEFAULT_KEY_BINDINGS.attack).toBe('KeyJ');
    expect(DEFAULT_KEY_BINDINGS.cycleTarget).toBe('Tab');
    expect(source).toContain('combatBindingActionForKeyCode');
    expect(source).toContain("action === 'attack'");
    expect(source).toContain("action === 'cycleTarget'");
    expect(source).toContain('AttackTimer');
    expect(source).toContain('TargetTracker');
    expect(source).toContain('EnemySystem');
    // 伤害结算在纯逻辑系统中完成，场景消费 DamageResult 驱动表现（US-004）。
    expect(source).toContain('DamageResult');
    expect(source).toContain('playerCastFrameIndex');
  });
});

describe('类型覆盖', () => {
  it('面向向量覆盖全部八向', () => {
    const facings = Object.keys(FACING_VECTORS) as Facing[];
    expect(facings.sort()).toEqual([...FACING_LIST].sort());
  });
});
