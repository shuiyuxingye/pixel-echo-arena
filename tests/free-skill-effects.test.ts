import { describe, expect, it } from 'vitest';
import { getFreeSkill, requireFreeSkillParam } from '../src/game/data';
import { DamageChainTracker } from '../src/game/damage-events';
import {
  freeSkillControlMultiplier,
  freeSkillStrength,
} from '../src/game/free-skills';
import {
  FREE_SKILL_S01_DAMAGE_PER_SECOND,
  FREE_SKILL_S01_DAMAGE_TYPE,
  FREE_SKILL_S01_DURATION_SECONDS,
  FREE_SKILL_S01_RADIUS,
  FREE_SKILL_S02_DAMAGE,
  FREE_SKILL_S02_DAMAGE_TYPE,
  FREE_SKILL_S02_RADIUS,
  FREE_SKILL_S02_SLOW_DURATION_SECONDS,
  FREE_SKILL_S02_SLOW_PERCENT,
  FREE_SKILL_S03_DAMAGE,
  FREE_SKILL_S03_DAMAGE_TYPE,
  FREE_SKILL_S03_JUMP_RADIUS,
  FREE_SKILL_S03_JUMPS,
  FREE_SKILL_S03_RANGE,
  FREE_SKILL_S04_DAMAGE_PER_SECOND,
  FREE_SKILL_S04_DAMAGE_TYPE,
  FREE_SKILL_S04_FIRE_DURATION_SECONDS,
  FREE_SKILL_S04_RADIUS,
  FREE_SKILL_S04_STRIDE_DISTANCE,
  FREE_SKILL_S04_TRAIL_SECONDS,
  FREE_SKILL_S05_DAMAGE_PER_SECOND,
  FREE_SKILL_S05_DAMAGE_TYPE,
  FREE_SKILL_S05_DURATION_SECONDS,
  FREE_SKILL_S05_MAX_COUNT,
  FREE_SKILL_S05_RANGE,
  FREE_SKILL_S06_HEAL_AMOUNT,
  FREE_SKILL_S06_SUMMON_HEAL_RATIO,
  FREE_SKILL_S06_SUMMON_RADIUS,
  FREE_SKILL_S07_DAMAGE,
  FREE_SKILL_S07_DAMAGE_TYPE,
  FREE_SKILL_S07_KNOCKBACK_DISTANCE,
  FREE_SKILL_S07_RADIUS,
  FREE_SKILL_S07_SHIELD_AMOUNT,
  FREE_SKILL_S07_SHIELD_DURATION_SECONDS,
  FREE_SKILL_S08_CAST_DISTANCE,
  FREE_SKILL_S08_CAST_RANGE,
  FREE_SKILL_S08_DAMAGE_PER_SECOND,
  FREE_SKILL_S08_DAMAGE_TYPE,
  FREE_SKILL_S08_DURATION_SECONDS,
  FREE_SKILL_S08_PULL_PER_SECOND,
  FREE_SKILL_S08_RADIUS,
  FREE_SKILL_S08_TICK_SECONDS,
  FREE_SKILL_S09_DAMAGE_RATIO,
  FREE_SKILL_S09_DURATION_SECONDS,
  FREE_SKILL_S09_MAX_COUNT,
  FREE_SKILL_S10_ARMOR_BONUS,
  FREE_SKILL_S10_CONTACT_DAMAGE,
  FREE_SKILL_S10_DAMAGE_TYPE,
  FREE_SKILL_S10_DURATION_SECONDS,
  FREE_SKILL_S10_RADIUS,
  FREE_SKILL_S11_DAMAGE,
  FREE_SKILL_S11_DAMAGE_TYPE,
  FREE_SKILL_S11_PELLET_COUNT,
  FREE_SKILL_S11_RANGE,
  FREE_SKILL_S11_REPEAT_RATIO,
  FREE_SKILL_S11_SPREAD_DEGREES,
  FREE_SKILL_S12_BOUNTY_GOLD,
  FREE_SKILL_S12_DAMAGE_BONUS,
  FREE_SKILL_S12_DURATION_SECONDS,
  FREE_SKILL_S12_MAX_BOUNTY_PER_WAVE,
  FREE_SKILL_S12_RANGE,
  BountyMarkState,
  FireTrailState,
  FreeSkillSlowState,
  GravityWellState,
  ShotgunVolleyTracker,
  ShieldBurstState,
  SpinningBladeState,
  TurretFieldState,
  WarBannerState,
  WaterMirrorState,
  beginFreeSkillSource,
  findTurretTarget,
  freeSkillSlowDurationSeconds,
  listFreeSkillTargetsInRadius,
  listTargetsInFirePatches,
  resolveChainLightningTargets,
  resolveGravityWellPlacement,
  resolveHealingPulse,
  resolveWaterMirrorEcho,
  shotgunFanDirections,
  shotgunPelletDamage,
  toBossSafeControl,
} from '../src/game/free-skill-effects';

function target(id: string, x: number, y: number, isAlive = true) {
  return { id, x, y, isAlive };
}

describe('S01 旋刃环', () => {
  it('目录数值与 AC 一致：45 物伤/秒、3 秒、CD 12 秒', () => {
    const skill = getFreeSkill('S01');
    expect(skill?.cooldownSeconds).toBe(12);
    expect(FREE_SKILL_S01_DAMAGE_PER_SECOND).toBe(45);
    expect(FREE_SKILL_S01_DURATION_SECONDS).toBe(3);
    expect(FREE_SKILL_S01_DAMAGE_TYPE).toBe('physical');
    expect(requireFreeSkillParam('S01', 'radius')).toBe(FREE_SKILL_S01_RADIUS);
  });

  it('每满 1 秒结算一次 tick，3 秒共 3 次、同敌最多 135 伤害', () => {
    const spin = new SpinningBladeState();
    spin.start(1);
    expect(spin.isActive).toBe(true);
    expect(spin.damagePerTick()).toBe(45);

    expect(spin.step(0.99)).toBe(0);
    expect(spin.step(0.01)).toBe(1);

    let ticks = 1;
    for (let i = 0; i < 120; i += 1) ticks += spin.step(1 / 60);

    expect(ticks).toBe(3);
    expect(spin.ticksFired).toBe(3);
    expect(spin.isActive).toBe(false);
    expect(spin.step(1)).toBe(0);
    expect(3 * spin.damagePerTick()).toBe(135);
  });

  it('超长步长最多补满 3 秒的 tick，不会超发', () => {
    const spin = new SpinningBladeState();
    spin.start(1);
    expect(spin.step(10)).toBe(3);
    expect(spin.step(10)).toBe(0);
    expect(spin.ticksFired).toBe(3);
  });

  it('等级 2/3 按 120%/145% 放大每次 tick', () => {
    const spin = new SpinningBladeState();
    spin.start(freeSkillStrength(2));
    expect(spin.damagePerTick()).toBeCloseTo(45 * 1.2);
    spin.start(freeSkillStrength(3));
    expect(spin.damagePerTick()).toBeCloseTo(45 * 1.45);
  });

  it('范围边界包含 120、排除 121，且不读取面向（背后/上下都命中）', () => {
    const center = { x: 200, y: 200 };
    const targets = [
      target('inside', 200 + 119, 200),
      target('edge', 200 + 120, 200),
      target('outside', 200 + 121, 200),
      target('behind', 200 - 110, 200),
      target('above', 200, 200 - 110),
      target('dead', 200 + 10, 200, false),
    ];
    const hits = listFreeSkillTargetsInRadius(center, FREE_SKILL_S01_RADIUS, targets);
    expect(hits.map((hit) => hit.id)).toEqual(['inside', 'edge', 'behind', 'above']);
  });
});

describe('S02 霜环', () => {
  it('目录数值与 AC 一致：半径 140、50 法伤、减速 40% 持续 3 秒、CD 14 秒', () => {
    const skill = getFreeSkill('S02');
    expect(skill?.cooldownSeconds).toBe(14);
    expect(FREE_SKILL_S02_RADIUS).toBe(140);
    expect(FREE_SKILL_S02_DAMAGE).toBe(50);
    expect(FREE_SKILL_S02_DAMAGE_TYPE).toBe('magic');
    expect(FREE_SKILL_S02_SLOW_PERCENT).toBeCloseTo(0.4);
    expect(FREE_SKILL_S02_SLOW_DURATION_SECONDS).toBe(3);
  });

  it('范围边界包含 140、排除 141，并遵守遮挡', () => {
    const center = { x: 300, y: 300 };
    const targets = [
      target('inside', 300 + 139, 300),
      target('edge', 300 + 140, 300),
      target('outside', 300 + 141, 300),
      target('walled', 300, 300 - 100),
    ];
    const hits = listFreeSkillTargetsInRadius(
      center,
      FREE_SKILL_S02_RADIUS,
      targets,
      (_from, to) => to.y !== 200,
    );
    expect(hits.map((hit) => hit.id)).toEqual(['inside', 'edge']);
  });

  it('等级 2/3 的减速时长为 3.6 / 3.75 秒（控制增幅封顶 125%）', () => {
    expect(freeSkillControlMultiplier(2)).toBeCloseTo(1.2);
    expect(freeSkillControlMultiplier(3)).toBe(1.25);
    expect(freeSkillSlowDurationSeconds(1)).toBeCloseTo(3);
    expect(freeSkillSlowDurationSeconds(2)).toBeCloseTo(3.6);
    expect(freeSkillSlowDurationSeconds(3)).toBeCloseTo(3.75);
  });

  it('减速到期清零，移速倍率从 0.6 回到 1', () => {
    const slow = new FreeSkillSlowState();
    expect(slow.apply('e1', FREE_SKILL_S02_SLOW_PERCENT, 3)).toBe(true);
    expect(slow.slowMultiplier('e1')).toBeCloseTo(0.6);

    slow.step(2.9);
    expect(slow.remaining('e1')).toBeCloseTo(0.1, 6);
    expect(slow.slowMultiplier('e1')).toBeCloseTo(0.6);

    slow.step(0.1);
    expect(slow.remaining('e1')).toBe(0);
    expect(slow.slowMultiplier('e1')).toBe(1);
    expect(slow.entries()).toEqual([]);
  });

  it('重复施加只刷新为较长剩余，不叠加、不无限锁定', () => {
    const slow = new FreeSkillSlowState();
    slow.apply('e1', 0.4, 3);
    slow.step(2);
    slow.apply('e1', 0.4, 3);
    expect(slow.remaining('e1')).toBeCloseTo(3);
    slow.apply('e1', 0.2, 10);
    expect(slow.percent('e1')).toBeCloseTo(0.4);
    expect(slow.remaining('e1')).toBeCloseTo(10);
    expect(slow.slowMultiplier('e1')).toBeCloseTo(0.6);
  });

  it('Boss 的硬控转换为 40% 减速，普通敌人保持眩晕', () => {
    const stun = { kind: 'stun' as const, percent: 1, durationSeconds: 3 };
    expect(toBossSafeControl(stun, true)).toEqual({
      kind: 'slow',
      percent: 0.4,
      durationSeconds: 3,
    });
    expect(toBossSafeControl(stun, false)).toEqual(stun);
    expect(
      toBossSafeControl({ ...stun, kind: 'root' }, true).kind,
    ).toBe('slow');
    // 已经是减速的效果对 Boss 保持不变。
    const slow = {
      kind: 'slow' as const,
      percent: FREE_SKILL_S02_SLOW_PERCENT,
      durationSeconds: 3,
    };
    expect(toBossSafeControl(slow, true)).toEqual(slow);
  });
});

describe('S03 连锁电弧', () => {
  it('目录数值与 AC 一致：4 个目标、各 45 法伤、CD 10 秒', () => {
    const skill = getFreeSkill('S03');
    expect(skill?.cooldownSeconds).toBe(10);
    expect(FREE_SKILL_S03_DAMAGE).toBe(45);
    expect(FREE_SKILL_S03_JUMPS).toBe(4);
    expect(FREE_SKILL_S03_DAMAGE_TYPE).toBe('magic');
    expect(FREE_SKILL_S03_RANGE).toBe(320);
    expect(FREE_SKILL_S03_JUMP_RADIUS).toBe(180);
    expect(requireFreeSkillParam('S03', 'jumps')).toBe(4);
  });

  it('命中 4 个不同敌人且按最近未命中顺序跳跃，不重复结算', () => {
    const origin = { x: 0, y: 0 };
    const targets = [
      target('A', 100, 0),
      target('B', 180, 0),
      target('C', 180, 80),
      target('D', 180, 160),
      target('E', 180, 240),
      target('dead', 120, 0, false),
    ];
    const chain = resolveChainLightningTargets({
      origin,
      facing: 'east',
      targets,
    });
    const ids = chain.map((entry) => entry.id);
    expect(ids).toEqual(['A', 'B', 'C', 'D']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('首目标遵守 ±25° 轻自瞄：背后与扇区外目标不会起手', () => {
    const origin = { x: 0, y: 0 };
    const behind = target('behind', -120, 0);
    const outsideSector = target('outside', 120, 120);
    expect(
      resolveChainLightningTargets({
        origin,
        facing: 'east',
        targets: [behind, outsideSector],
      }),
    ).toEqual([]);
    // 射程外同样不起手。
    expect(
      resolveChainLightningTargets({
        origin,
        facing: 'east',
        targets: [target('far', 400, 0)],
        range: 320,
      }),
    ).toEqual([]);
  });

  it('跳跃受通视与跳跃半径限制，挡住的后续目标直接断链', () => {
    const origin = { x: 0, y: 0 };
    const first = target('first', 100, 0);
    const blocked = target('blocked', 180, 0);
    const chain = resolveChainLightningTargets({
      origin,
      facing: 'east',
      targets: [first, blocked],
      lineOfSight: (_from, to) => to.x < 150,
    });
    expect(chain.map((entry) => entry.id)).toEqual(['first']);

    // 相邻目标超出 180 跳跃半径时同样断链。
    expect(
      resolveChainLightningTargets({
        origin,
        facing: 'east',
        targets: [first, target('farJump', 320, 0)],
      }).map((entry) => entry.id),
    ).toEqual(['first']);
  });

  it('首目标本身被遮挡时不会打到墙后的敌人', () => {
    const blocked = target('blocked', 100, 0);
    expect(
      resolveChainLightningTargets({
        origin: { x: 0, y: 0 },
        facing: 'east',
        targets: [blocked],
        lineOfSight: () => false,
      }),
    ).toEqual([]);
  });
});

describe('S08 重力井', () => {
  it('目录数值与 AC 一致：半径 110、3 秒、每秒 18 法伤、CD 18 秒', () => {
    const skill = getFreeSkill('S08');
    expect(skill?.cooldownSeconds).toBe(18);
    expect(FREE_SKILL_S08_RADIUS).toBe(110);
    expect(FREE_SKILL_S08_DURATION_SECONDS).toBe(3);
    expect(FREE_SKILL_S08_DAMAGE_PER_SECOND).toBe(18);
    expect(FREE_SKILL_S08_TICK_SECONDS).toBe(1);
    expect(FREE_SKILL_S08_DAMAGE_TYPE).toBe('magic');
    expect(FREE_SKILL_S08_PULL_PER_SECOND).toBe(70);
    expect(FREE_SKILL_S08_CAST_RANGE).toBe(280);
    expect(FREE_SKILL_S08_CAST_DISTANCE).toBe(180);
  });

  it('3 秒内每秒结算一次 tick，共 3 次，结束后不再伤害', () => {
    const well = new GravityWellState();
    well.start({ x: 240, y: 200 }, 1);
    expect(well.isActive).toBe(true);
    expect(well.damagePerTick()).toBe(18);
    expect(well.pullDistancePerTick()).toBe(70);
    expect(well.center).toEqual({ x: 240, y: 200 });

    expect(well.step(0.99)).toBe(0);
    expect(well.step(0.01)).toBe(1);
    let ticks = 1;
    for (let i = 0; i < 120; i += 1) ticks += well.step(1 / 60);

    expect(ticks).toBe(3);
    expect(well.ticksFired).toBe(3);
    expect(well.isActive).toBe(false);
    expect(well.step(1)).toBe(0);
    // 结束后落点仍可读，供视觉与快照清理；波初 reset 才丢弃。
    expect(well.center).toEqual({ x: 240, y: 200 });
  });

  it('超长步长最多补满 3 秒的 tick，不会超发', () => {
    const well = new GravityWellState();
    well.start({ x: 0, y: 0 }, 1);
    expect(well.step(10)).toBe(3);
    expect(well.step(10)).toBe(0);
    expect(well.ticksFired).toBe(3);
  });

  it('等级 2/3 按 120%/145% 放大每秒伤害', () => {
    const well = new GravityWellState();
    well.start({ x: 0, y: 0 }, freeSkillStrength(2));
    expect(well.damagePerTick()).toBeCloseTo(18 * 1.2);
    well.start({ x: 0, y: 0 }, freeSkillStrength(3));
    expect(well.damagePerTick()).toBeCloseTo(18 * 1.45);
  });

  it('重复施放刷新落点与时长，不叠加多个井', () => {
    const well = new GravityWellState();
    well.start({ x: 0, y: 0 }, 1);
    well.step(2);
    well.start({ x: 200, y: 100 }, 1);
    expect(well.center).toEqual({ x: 200, y: 100 });
    expect(well.remainingSecondsLeft).toBe(3);
    expect(well.ticksFired).toBe(0);
  });

  it('落点优先落在轻自瞄目标上，无目标时沿面向前方 180', () => {
    const origin = { x: 100, y: 100 };
    const aimed = resolveGravityWellPlacement({
      origin,
      facing: 'east',
      targets: [target('e1', 240, 100)],
      lineOfSight: () => true,
    });
    expect(aimed).toEqual({ center: { x: 240, y: 100 }, targetId: 'e1' });

    expect(
      resolveGravityWellPlacement({ origin, facing: 'east', targets: [] }),
    ).toEqual({
      center: { x: 100 + FREE_SKILL_S08_CAST_DISTANCE, y: 100 },
      targetId: null,
    });

    // 背后目标不参与轻自瞄，落点回到面前。
    expect(
      resolveGravityWellPlacement({
        origin,
        facing: 'east',
        targets: [target('behind', 0, 100)],
      }),
    ).toEqual({
      center: { x: 100 + FREE_SKILL_S08_CAST_DISTANCE, y: 100 },
      targetId: null,
    });

    // 被遮挡的目标也不会把落点带到墙后。
    expect(
      resolveGravityWellPlacement({
        origin,
        facing: 'east',
        targets: [target('walled', 240, 100)],
        lineOfSight: () => false,
      }).targetId,
    ).toBeNull();
  });

  it('Boss 的拉拽转换为 40% 减速，普通敌人保留拉拽', () => {
    const pull = { kind: 'pull' as const, percent: 1, durationSeconds: 1 };
    expect(toBossSafeControl(pull, true)).toEqual({
      kind: 'slow',
      percent: 0.4,
      durationSeconds: 1,
    });
    expect(toBossSafeControl(pull, false)).toEqual(pull);
  });
});

describe('自由技能伤害链', () => {
  it('同一次施放共享原生链，衍生伤害不能再生成衍生伤害', () => {
    const chains = new DamageChainTracker();
    const native = beginFreeSkillSource(chains, 'S01');
    expect(native).toMatchObject({ sourceId: 'S01', origin: 'native', depth: 0 });

    const sharing = chains.nativeHit(native);
    expect(sharing.chainId).toBe(native.chainId);
    expect(chains.nativeHit(sharing).chainId).toBe(native.chainId);

    const derived = chains.derive(native, 'G05');
    expect(derived).toMatchObject({
      sourceId: 'G05',
      origin: 'derived',
      depth: 1,
      chainId: native.chainId,
    });
    expect(chains.derive(derived!, 'nested')).toBeNull();
  });
});

describe('S04 燃烧轨迹', () => {
  it('目录数值与 AC 一致：22 法伤/秒、火焰 4 秒、CD 12 秒', () => {
    const skill = getFreeSkill('S04');
    expect(skill?.cooldownSeconds).toBe(12);
    expect(FREE_SKILL_S04_DAMAGE_PER_SECOND).toBe(22);
    expect(FREE_SKILL_S04_FIRE_DURATION_SECONDS).toBe(4);
    expect(FREE_SKILL_S04_TRAIL_SECONDS).toBe(4);
    expect(FREE_SKILL_S04_DAMAGE_TYPE).toBe('magic');
    expect(requireFreeSkillParam('S04', 'radius')).toBe(FREE_SKILL_S04_RADIUS);
  });

  it('施放立即在脚下落火，移动每 40 像素补一团，站着不动不补', () => {
    const trail = new FireTrailState();
    trail.start({ x: 0, y: 0 }, 1);
    expect(trail.patchCount).toBe(1);
    expect(trail.patches()[0]).toMatchObject({
      x: 0,
      y: 0,
      remainingSeconds: FREE_SKILL_S04_FIRE_DURATION_SECONDS,
    });

    // 累计移动不足一个步距
    const shortHop = FREE_SKILL_S04_STRIDE_DISTANCE - 10;
    trail.step(0.1, { x: shortHop, y: 0 });
    expect(trail.patchCount).toBe(1);

    // 再移动 20 像素，累计超过步距，补一团
    const longHop = shortHop + 20;
    trail.step(0.1, { x: longHop, y: 0 });
    expect(trail.patchCount).toBe(2);
    expect(trail.patches()[1]).toMatchObject({ x: longHop, y: 0 });

    // 原地停留一整个 tick，不再生成火焰
    trail.step(1, { x: longHop, y: 0 });
    expect(trail.patchCount).toBe(2);
  });

  it('每团火独立存活 4 秒，第一团在 4 秒后消失且不跨铺设窗口留火', () => {
    const trail = new FireTrailState();
    trail.start({ x: 0, y: 0 }, 1);
    let ticks = 0;
    for (let i = 0; i < 240; i += 1) ticks += trail.step(1 / 60);
    expect(ticks).toBe(4);
    expect(trail.ticksFired).toBe(4);
    expect(trail.patchCount).toBe(0);
    expect(trail.isActive).toBe(false);

    // 铺设窗口已过：再移动也不会留火
    trail.step(1, { x: 100, y: 0 });
    expect(trail.patchCount).toBe(0);
  });

  it('同源火焰重叠只结算一层：重叠目标去重且每 tick 仍只出一次 22 伤害', () => {
    const trail = new FireTrailState();
    trail.start({ x: 0, y: 0 }, 1);
    trail.step(0.1, { x: 50, y: 0 });
    expect(trail.patchCount).toBe(2);

    const patches = trail.patches();
    const overlapping = target('e1', 25, 0);
    const insideOnlyFirst = target('e2', -35, 0);
    const outside = target('e3', 300, 0);
    const dead = target('e4', 25, 0, false);

    const hits = listTargetsInFirePatches(
      patches,
      FREE_SKILL_S04_RADIUS,
      [overlapping, insideOnlyFirst, outside, dead],
    );
    expect(hits.map((entry) => entry.id)).toEqual(['e1', 'e2']);
    expect(trail.damagePerTick()).toBe(FREE_SKILL_S04_DAMAGE_PER_SECOND);

    expect(trail.step(1, { x: 50, y: 0 })).toBe(1);
    expect(trail.ticksFired).toBe(1);
  });

  it('等级/回响只放大每次 tick 的伤害，不延长火焰或铺设窗口', () => {
    const trail = new FireTrailState();
    trail.start({ x: 0, y: 0 }, 1.5);
    expect(trail.damagePerTick()).toBe(33);
    expect(trail.remainingSecondsLeft).toBe(FREE_SKILL_S04_FIRE_DURATION_SECONDS);
  });

  it('重复施放替换上一次火路，不叠加旧火焰', () => {
    const trail = new FireTrailState();
    trail.start({ x: 0, y: 0 }, 1);
    trail.step(0.1, { x: 50, y: 0 });
    expect(trail.patchCount).toBe(2);

    trail.start({ x: 300, y: 0 }, 1);
    expect(trail.patchCount).toBe(1);
    expect(trail.patches()[0]).toMatchObject({ x: 300, y: 0 });
    expect(trail.ticksFired).toBe(0);
  });

  it('reset 清空火焰、计时与 tick 计数', () => {
    const trail = new FireTrailState();
    trail.start({ x: 0, y: 0 }, 2);
    trail.step(1.5, { x: 50, y: 0 });
    trail.reset();
    expect(trail.isActive).toBe(false);
    expect(trail.patchCount).toBe(0);
    expect(trail.remainingSecondsLeft).toBe(0);
    expect(trail.ticksFired).toBe(0);
    expect(trail.step(1, { x: 100, y: 0 })).toBe(0);
  });
});

describe('S09 水镜替身', () => {
  it('目录数值与 AC 一致：6 秒、复制 J 的 35%、默认 1 个、CD 20 秒', () => {
    const skill = getFreeSkill('S09');
    expect(skill?.cooldownSeconds).toBe(20);
    expect(FREE_SKILL_S09_DURATION_SECONDS).toBe(6);
    expect(FREE_SKILL_S09_DAMAGE_RATIO).toBeCloseTo(0.35);
    expect(FREE_SKILL_S09_MAX_COUNT).toBe(1);
    expect(requireFreeSkillParam('S09', 'damageRatio')).toBeCloseTo(0.35);
    expect(requireFreeSkillParam('S09', 'maxCount')).toBe(1);
  });

  it('6 秒寿命内复制 J 的 35%，到期后替身消失', () => {
    const mirror = new WaterMirrorState();
    const placed = mirror.place({ x: 10, y: 20 }, 1);
    expect(mirror.count).toBe(1);
    expect(mirror.entries()[0]).toMatchObject({
      id: placed.id,
      x: 10,
      y: 20,
      remainingSeconds: FREE_SKILL_S09_DURATION_SECONDS,
      strength: 1,
    });
    expect(mirror.damageFor(100)).toBeCloseTo(35);
    expect(mirror.damageFor(40)).toBeCloseTo(14);

    // 替身跟随玩家站位，5.99 秒时仍存活。
    expect(mirror.step(5.99, { x: 40, y: 20 })).toEqual([]);
    expect(mirror.entries()[0]).toMatchObject({ x: 40, y: 20 });
    expect(mirror.entries()[0]?.remainingSeconds).toBeCloseTo(0.01, 6);

    // 满 6 秒立即到期，不会延寿。
    expect(mirror.step(0.01, { x: 40, y: 20 })).toEqual([placed.id]);
    expect(mirror.count).toBe(0);
    expect(mirror.entries()).toEqual([]);
  });

  it('超长步长直接耗尽寿命，替身不会复活或延长', () => {
    const mirror = new WaterMirrorState();
    const placed = mirror.place({ x: 0, y: 0 }, 1);
    expect(mirror.step(30)).toEqual([placed.id]);
    expect(mirror.count).toBe(0);
    expect(mirror.step(1)).toEqual([]);
  });

  it('等级 2/3 按 120%/145% 放大复制伤害，寿命不变', () => {
    const mirror = new WaterMirrorState();
    mirror.place({ x: 0, y: 0 }, freeSkillStrength(2));
    const level2 = mirror.entries()[0]!;
    expect(mirror.damageFor(100, level2.strength)).toBeCloseTo(35 * 1.2);
    mirror.place({ x: 0, y: 0 }, freeSkillStrength(3));
    const level3 = mirror.entries()[0]!;
    expect(mirror.damageFor(100, level3.strength)).toBeCloseTo(35 * 1.45);
    expect(level3.remainingSeconds).toBe(FREE_SKILL_S09_DURATION_SECONDS);
  });

  it('默认上限 1 个：重复施放刷新并顶掉旧替身，不叠加数量', () => {
    const mirror = new WaterMirrorState();
    const first = mirror.place({ x: 0, y: 0 }, 1);
    mirror.step(3);
    const second = mirror.place({ x: 50, y: 0 }, 1);
    expect(second.replacedIds).toEqual([first.id]);
    expect(mirror.count).toBe(1);
    expect(mirror.entries()[0]).toMatchObject({
      id: second.id,
      x: 50,
      y: 0,
      remainingSeconds: FREE_SKILL_S09_DURATION_SECONDS,
    });

    // 上限提高后才允许并存；降低上限立即裁掉最旧的一个。
    mirror.setMaxCount(2);
    mirror.place({ x: 80, y: 0 }, 1);
    expect(mirror.count).toBe(2);
    mirror.setMaxCount(1);
    expect(mirror.count).toBe(1);
    expect(mirror.entries()[0]?.x).toBe(80);
  });

  it('复制只从原生 J 派生一层：分裂/回响等衍生来源不会被复制', () => {
    const chains = new DamageChainTracker();
    const native = chains.beginNative('J');
    const echo = resolveWaterMirrorEcho({
      chains,
      parent: native,
      jDamage: 100,
    });
    expect(echo).not.toBeNull();
    expect(echo?.damage).toBeCloseTo(35);
    expect(echo?.source).toMatchObject({
      sourceId: 'S09',
      origin: 'derived',
      depth: 1,
      chainId: native.chainId,
    });
    // 复制伤害本身是衍生来源：不能再派生，保证不复制触发链。
    expect(chains.derive(echo!.source, 'split')).toBeNull();

    // 父级已是衍生（I14 分裂、G06 回响、E08 侧弹等）时不再复制。
    const derived = chains.derive(native, 'I14')!;
    expect(
      resolveWaterMirrorEcho({ chains, parent: derived, jDamage: 100 }),
    ).toBeNull();
    // 没有 J 来源或 J 未造成伤害时也不复制。
    expect(resolveWaterMirrorEcho({ chains, parent: null, jDamage: 100 })).toBeNull();
    expect(
      resolveWaterMirrorEcho({ chains, parent: native, jDamage: 0 }),
    ).toBeNull();
  });

  it('reset 清空替身、计时与上限覆盖，波初不残留', () => {
    const mirror = new WaterMirrorState();
    mirror.setMaxCount(3);
    mirror.place({ x: 0, y: 0 }, 1);
    mirror.place({ x: 10, y: 0 }, 1);
    expect(mirror.count).toBe(2);

    mirror.reset();
    expect(mirror.count).toBe(0);
    expect(mirror.maxCount).toBe(FREE_SKILL_S09_MAX_COUNT);
    expect(mirror.entries()).toEqual([]);
    expect(mirror.step(1)).toEqual([]);
  });
});

describe('S05 便携炮台', () => {
  it('目录数值与 AC 一致：24 物伤/秒、8 秒寿命、默认 1 座、CD 18 秒', () => {
    const skill = getFreeSkill('S05');
    expect(skill?.cooldownSeconds).toBe(18);
    expect(FREE_SKILL_S05_DAMAGE_PER_SECOND).toBe(24);
    expect(FREE_SKILL_S05_DURATION_SECONDS).toBe(8);
    expect(FREE_SKILL_S05_MAX_COUNT).toBe(1);
    expect(FREE_SKILL_S05_DAMAGE_TYPE).toBe('physical');
    expect(requireFreeSkillParam('S05', 'range')).toBe(FREE_SKILL_S05_RANGE);
  });

  it('默认上限 1 座：再放一座顶掉最旧的，而不是叠加', () => {
    const field = new TurretFieldState();
    const first = field.place({ x: 0, y: 0 }, 1);
    expect(field.count).toBe(1);
    expect(first.replacedIds).toHaveLength(0);

    const second = field.place({ x: 60, y: 0 }, 1);
    expect(second.replacedIds).toEqual([first.id]);
    expect(field.count).toBe(1);
    expect(field.entries()[0]).toMatchObject({ id: second.id, x: 60, y: 0 });
  });

  it('上限可提高到 2；降回 1 时裁掉最旧的一座', () => {
    const field = new TurretFieldState();
    field.setMaxCount(2);
    const a = field.place({ x: 0, y: 0 }, 1);
    const b = field.place({ x: 40, y: 0 }, 1);
    expect(field.count).toBe(2);
    expect(field.entries().map((entry) => entry.id)).toEqual([a.id, b.id]);

    field.setMaxCount(1);
    expect(field.count).toBe(1);
    expect(field.entries()[0]?.id).toBe(b.id);
  });

  it('每座炮台独立每秒 tick，8 秒共 8 次后消失', () => {
    const field = new TurretFieldState();
    const placed = field.place({ x: 0, y: 0 }, 1);
    let ticks = 0;
    for (let i = 0; i < 480; i += 1) {
      for (const entry of field.step(1 / 60)) ticks += entry.ticks;
    }
    expect(ticks).toBe(8);
    expect(field.count).toBe(0);
    expect(field.entries()).toEqual([]);
    expect(placed.id).toBeGreaterThan(0);
  });

  it('超长步长只补到寿命内的 8 次 tick，不会超过寿命继续开火', () => {
    const field = new TurretFieldState();
    field.place({ x: 0, y: 0 }, 1);
    const firing = field.step(30);
    expect(firing).toHaveLength(1);
    expect(firing[0]?.ticks).toBe(8);
    expect(firing[0]?.strength).toBe(1);
    expect(field.count).toBe(0);
    expect(field.damagePerTick(1)).toBe(24);
    expect(field.damagePerTick(2)).toBe(48);
  });

  it('索敌选射程内最近的存活敌人，等距按 ID 排序，超程/遮挡不开火', () => {
    const turret = { x: 0, y: 0 };
    expect(
      findTurretTarget(turret, [target('far', 100, 0), target('near', 30, 0)], {
        range: 200,
      })?.id,
    ).toBe('near');
    expect(
      findTurretTarget(turret, [target('edge', FREE_SKILL_S05_RANGE, 0)], {
        range: FREE_SKILL_S05_RANGE,
      })?.id,
    ).toBe('edge');
    expect(
      findTurretTarget(turret, [target('out', 300, 0)], { range: 260 }),
    ).toBeNull();
    expect(
      findTurretTarget(turret, [target('b', 10, 0), target('a', -10, 0)]),
    ).toMatchObject({ id: 'a' });
    expect(
      findTurretTarget(turret, [
        target('dead', 10, 0, false),
        target('alive', 50, 0),
      ])?.id,
    ).toBe('alive');
    expect(
      findTurretTarget(turret, [target('walled', 10, 0)], {
        lineOfSight: () => false,
      }),
    ).toBeNull();
  });

  it('reset 清空炮台并恢复默认上限', () => {
    const field = new TurretFieldState();
    field.setMaxCount(3);
    field.place({ x: 0, y: 0 }, 1);
    field.place({ x: 20, y: 0 }, 1);
    field.reset();
    expect(field.count).toBe(0);
    expect(field.maxCount).toBe(FREE_SKILL_S05_MAX_COUNT);
    expect(field.step(1)).toEqual([]);
  });
});

describe('S06 治疗脉冲', () => {
  it('目录数值与 AC 一致：自疗 30、召唤物 20%、CD 16 秒', () => {
    const skill = getFreeSkill('S06');
    expect(skill?.cooldownSeconds).toBe(16);
    expect(FREE_SKILL_S06_HEAL_AMOUNT).toBe(30);
    expect(FREE_SKILL_S06_SUMMON_HEAL_RATIO).toBe(0.2);
    expect(FREE_SKILL_S06_SUMMON_RADIUS).toBe(260);
    expect(requireFreeSkillParam('S06', 'healAmount')).toBe(30);
  });

  it('无召唤物时仍治疗玩家 30；召唤物只受玩家自疗影响为空', () => {
    const result = resolveHealingPulse({ center: { x: 0, y: 0 } });
    expect(result.playerHeal).toBe(30);
    expect(result.summons).toEqual([]);
  });

  it('附近召唤物恢复最大生命 20%，并按当前生命钳制不溢出', () => {
    const result = resolveHealingPulse({
      center: { x: 0, y: 0 },
      summons: [
        { id: 'hurt', x: 100, y: 0, health: 100, maxHealth: 200 },
        { id: 'full', x: 0, y: 100, health: 200, maxHealth: 200 },
      ],
    });
    expect(result.playerHeal).toBe(30);
    expect(result.summons).toEqual([
      { id: 'hurt', amount: 40, healed: 40 },
      { id: 'full', amount: 40, healed: 0 },
    ]);
  });

  it('半径 260 包含边界，超出/死亡/非法生命不治疗', () => {
    const result = resolveHealingPulse({
      center: { x: 0, y: 0 },
      summons: [
        { id: 'edge', x: 260, y: 0, health: 50, maxHealth: 100 },
        { id: 'outside', x: 261, y: 0, health: 50, maxHealth: 100 },
        { id: 'dead', x: 10, y: 0, health: 0, maxHealth: 100 },
        { id: 'flag-dead', x: 10, y: 0, health: 50, maxHealth: 100, isAlive: false },
        { id: 'bad', x: 10, y: 0, health: 50, maxHealth: 0 },
      ],
    });
    expect(result.summons.map((entry) => entry.id)).toEqual(['edge']);
    expect(result.summons[0]?.amount).toBe(20);
  });

  it('等级 2/3 按 120%/145% 同时放大自疗与召唤物回复', () => {
    const level2 = resolveHealingPulse({
      center: { x: 0, y: 0 },
      strength: freeSkillStrength(2),
      summons: [{ id: 's', x: 0, y: 0, health: 0, maxHealth: 200 }],
    });
    expect(level2.playerHeal).toBeCloseTo(36);
    // 生命为 0 视为死亡，不给治疗；用 1 点生命验证比例放大。
    const level3 = resolveHealingPulse({
      center: { x: 0, y: 0 },
      strength: freeSkillStrength(3),
      summons: [{ id: 's', x: 0, y: 0, health: 1, maxHealth: 200 }],
    });
    expect(level3.playerHeal).toBeCloseTo(43.5);
    expect(level3.summons[0]?.amount).toBeCloseTo(58);
  });
});

describe('S07 盾震', () => {
  it('目录数值与 AC 一致：35 护盾 4 秒、40 物伤、CD 14 秒', () => {
    const skill = getFreeSkill('S07');
    expect(skill?.cooldownSeconds).toBe(14);
    expect(FREE_SKILL_S07_SHIELD_AMOUNT).toBe(35);
    expect(FREE_SKILL_S07_SHIELD_DURATION_SECONDS).toBe(4);
    expect(FREE_SKILL_S07_DAMAGE).toBe(40);
    expect(FREE_SKILL_S07_DAMAGE_TYPE).toBe('physical');
    expect(FREE_SKILL_S07_RADIUS).toBe(150);
    expect(FREE_SKILL_S07_KNOCKBACK_DISTANCE).toBe(60);
  });

  it('护盾恰好持续 4 秒，到期返回仍记在名下的护盾量', () => {
    const state = new ShieldBurstState();
    expect(state.start(1)).toBe(35);
    expect(state.isActive).toBe(true);
    expect(state.shieldAmount).toBe(35);
    expect(state.damagePerHit()).toBe(40);

    expect(state.step(3.9)).toBe(0);
    expect(state.remainingSecondsLeft).toBeCloseTo(0.1);
    expect(state.step(0.1)).toBe(35);
    expect(state.isActive).toBe(false);
    expect(state.shieldAmount).toBe(0);
    expect(state.step(1)).toBe(0);
  });

  it('超长步长只到期一次，不重复移除护盾', () => {
    const state = new ShieldBurstState();
    state.start(1);
    expect(state.step(10)).toBe(35);
    expect(state.step(10)).toBe(0);
  });

  it('等级 2/3 放大护盾与伤害，但时长仍为 4 秒', () => {
    const state = new ShieldBurstState();
    expect(state.start(freeSkillStrength(2))).toBeCloseTo(42);
    expect(state.damagePerHit()).toBeCloseTo(48);
    expect(state.remainingSecondsLeft).toBe(4);
    expect(state.start(freeSkillStrength(3))).toBeCloseTo(35 * 1.45);
    expect(state.damagePerHit()).toBeCloseTo(40 * 1.45);
    expect(state.remainingSecondsLeft).toBe(4);
  });

  it('重复施放刷新同一次护盾与计时，不叠加', () => {
    const state = new ShieldBurstState();
    state.start(1);
    state.step(2);
    expect(state.start(1)).toBe(35);
    expect(state.shieldAmount).toBe(35);
    expect(state.remainingSecondsLeft).toBe(4);
  });

  it('reset 清空护盾与计时', () => {
    const state = new ShieldBurstState();
    state.start(1);
    state.reset();
    expect(state.isActive).toBe(false);
    expect(state.shieldAmount).toBe(0);
    expect(state.step(1)).toBe(0);
  });
});

describe('S10 反击战旗', () => {
  it('目录数值与 AC 一致：6 秒、护甲 +15、45 物伤、CD 18 秒', () => {
    const skill = getFreeSkill('S10');
    expect(skill?.cooldownSeconds).toBe(18);
    expect(FREE_SKILL_S10_DURATION_SECONDS).toBe(6);
    expect(FREE_SKILL_S10_ARMOR_BONUS).toBe(15);
    expect(FREE_SKILL_S10_CONTACT_DAMAGE).toBe(45);
    expect(FREE_SKILL_S10_DAMAGE_TYPE).toBe('physical');
    expect(FREE_SKILL_S10_RADIUS).toBe(160);
  });

  it('区域按位置实时判定：边界内吃护甲，离开或到期立即失效', () => {
    const state = new WarBannerState();
    state.start({ x: 100, y: 100 }, 1);
    expect(state.isActive).toBe(true);
    expect(state.armorBonusAt({ x: 100, y: 100 })).toBe(15);
    expect(state.armorBonusAt({ x: 260, y: 100 })).toBe(15);
    expect(state.armorBonusAt({ x: 261, y: 100 })).toBe(0);
    expect(state.contactDamage()).toBe(45);

    state.step(5.9);
    expect(state.isActive).toBe(true);
    state.step(0.1);
    expect(state.isActive).toBe(false);
    expect(state.armorBonusAt({ x: 100, y: 100 })).toBe(0);
    expect(state.contains({ x: 100, y: 100 })).toBe(false);
  });

  it('每个敌人每次施放只吃一次首次接触伤害，离开再回来不重复', () => {
    const state = new WarBannerState();
    state.start({ x: 0, y: 0 }, 1);
    const targets = [
      target('inside', 100, 0),
      target('edge', 160, 0),
      target('outside', 161, 0),
      target('dead', 10, 0, false),
    ];

    const first = state.claimContacts(targets);
    expect(first.map((entry) => entry.id)).toEqual(['inside', 'edge']);
    expect(state.contactHitCount).toBe(2);

    // 仍在圈内：不会再次触发。
    const second = state.claimContacts(targets);
    expect(second).toEqual([]);
    expect(state.contactHitCount).toBe(2);

    // 离开再回来仍算同一目标的首次接触，不重复结算。
    state.claimContacts([target('edge', 500, 0)]);
    expect(state.claimContacts([target('edge', 160, 0)])).toEqual([]);

    // 后进入的新目标会正常触发。
    expect(
      state.claimContacts([target('late', 50, 0)]).map((entry) => entry.id),
    ).toEqual(['late']);
    expect(state.contactHitCount).toBe(3);
  });

  it('区域到期后不再接受接触，重新施放会清空首次接触记录', () => {
    const state = new WarBannerState();
    state.start({ x: 0, y: 0 }, 1);
    expect(state.claimContacts([target('a', 0, 0)])).toHaveLength(1);
    state.step(6);
    expect(state.claimContacts([target('a', 0, 0)])).toEqual([]);

    state.start({ x: 0, y: 0 }, 1);
    expect(state.claimContacts([target('a', 0, 0)])).toHaveLength(1);
    expect(state.contactHitCount).toBe(1);
  });

  it('等级 2/3 放大护甲与接触伤害，但区域时长仍为 6 秒', () => {
    const state = new WarBannerState();
    state.start({ x: 0, y: 0 }, freeSkillStrength(2));
    expect(state.armorBonusAt({ x: 0, y: 0 })).toBeCloseTo(18);
    expect(state.contactDamage()).toBeCloseTo(54);
    expect(state.remainingSecondsLeft).toBe(6);

    state.start({ x: 0, y: 0 }, freeSkillStrength(3));
    expect(state.armorBonusAt({ x: 0, y: 0 })).toBeCloseTo(21.75);
    expect(state.contactDamage()).toBeCloseTo(65.25);
    expect(state.remainingSecondsLeft).toBe(6);
  });

  it('reset 清空区域、计时与接触记录', () => {
    const state = new WarBannerState();
    state.start({ x: 0, y: 0 }, 1);
    state.claimContacts([target('a', 0, 0)]);
    state.reset();
    expect(state.isActive).toBe(false);
    expect(state.center).toBeNull();
    expect(state.armorBonusAt({ x: 0, y: 0 })).toBe(0);
    expect(state.contactHitCount).toBe(0);
  });
});

describe('S11 霰弹扇射', () => {
  it('目录数值与 AC 一致：5 弹 ×18 物伤、50° 扇区、后续 35%、CD 9 秒', () => {
    const skill = getFreeSkill('S11');
    expect(skill?.cooldownSeconds).toBe(9);
    expect(FREE_SKILL_S11_PELLET_COUNT).toBe(5);
    expect(FREE_SKILL_S11_DAMAGE).toBe(18);
    expect(FREE_SKILL_S11_SPREAD_DEGREES).toBe(50);
    expect(FREE_SKILL_S11_REPEAT_RATIO).toBe(0.35);
    expect(FREE_SKILL_S11_RANGE).toBe(320);
    expect(FREE_SKILL_S11_DAMAGE_TYPE).toBe('physical');
  });

  it('沿瞄准方向均分 5 枚弹，最外侧弹恰好偏 ±25°', () => {
    const directions = shotgunFanDirections({ x: 1, y: 0 });
    expect(directions).toHaveLength(5);
    const center = directions[2];
    expect(center?.x).toBeCloseTo(1);
    expect(center?.y).toBeCloseTo(0);

    const halfAngle = (FREE_SKILL_S11_SPREAD_DEGREES / 2) * (Math.PI / 180);
    expect(directions[0]?.x).toBeCloseTo(Math.cos(halfAngle));
    expect(directions[0]?.y).toBeCloseTo(-Math.sin(halfAngle));
    expect(directions[4]?.x).toBeCloseTo(Math.cos(halfAngle));
    expect(directions[4]?.y).toBeCloseTo(Math.sin(halfAngle));

    for (const direction of directions) {
      expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1);
    }
  });

  it('扇面随轻自瞄方向旋转，不追踪目标；非正/非法参数退回目录默认', () => {
    const directions = shotgunFanDirections({ x: 0, y: 2 });
    expect(directions[2]?.x).toBeCloseTo(0);
    expect(directions[2]?.y).toBeCloseTo(1);
    // 五枚弹的方向在发射瞬间固定，互相独立，没有共享的追踪目标。
    expect(new Set(directions.map((entry) => `${entry.x},${entry.y}`)).size).toBe(5);

    expect(shotgunFanDirections({ x: 0, y: 0 })).toHaveLength(5);
    expect(
      shotgunFanDirections({ x: 1, y: 0 }, { count: 1, spreadDegrees: 50 }),
    ).toEqual([{ x: 1, y: 0 }]);
    expect(
      shotgunFanDirections({ x: 1, y: 0 }, { count: 3, spreadDegrees: 0 }),
    ).toHaveLength(3);
  });

  it('等级 2/3 按 120%/145% 放大单弹伤害', () => {
    expect(shotgunPelletDamage(1)).toBe(18);
    expect(shotgunPelletDamage(freeSkillStrength(2))).toBeCloseTo(21.6);
    expect(shotgunPelletDamage(freeSkillStrength(3))).toBeCloseTo(26.1);
    expect(shotgunPelletDamage(0)).toBe(18);
    expect(shotgunPelletDamage(Number.NaN)).toBe(18);
  });

  it('同一目标后续弹只结算 35%，不同目标首次命中仍是满伤', () => {
    const volley = new ShotgunVolleyTracker();
    expect(volley.damageMultiplierOnHit('a')).toBe(1);
    expect(volley.damageMultiplierOnHit('a')).toBe(0.35);
    expect(volley.damageMultiplierOnHit('a')).toBe(0.35);
    expect(volley.damageMultiplierOnHit('b')).toBe(1);
    expect(volley.hasHit('a')).toBe(true);
    expect(volley.hitCount).toBe(2);

    volley.reset();
    expect(volley.hasHit('a')).toBe(false);
    expect(volley.damageMultiplierOnHit('a')).toBe(1);
  });
});

describe('S12 赏金标记', () => {
  it('目录数值与 AC 一致：8 秒、+15%、12 金币、每波 2 次、CD 25 秒', () => {
    const skill = getFreeSkill('S12');
    expect(skill?.cooldownSeconds).toBe(25);
    expect(FREE_SKILL_S12_DURATION_SECONDS).toBe(8);
    expect(FREE_SKILL_S12_DAMAGE_BONUS).toBe(0.15);
    expect(FREE_SKILL_S12_BOUNTY_GOLD).toBe(12);
    expect(FREE_SKILL_S12_MAX_BOUNTY_PER_WAVE).toBe(2);
    expect(FREE_SKILL_S12_RANGE).toBe(360);
  });

  it('只有标记目标受到 +15% 伤害，其他目标不受影响', () => {
    const state = new BountyMarkState();
    expect(state.mark('enemy-a', 1)).toBe(true);
    expect(state.isActive).toBe(true);
    expect(state.targetId).toBe('enemy-a');
    expect(state.damageMultiplierFor('enemy-a')).toBeCloseTo(1.15);
    expect(state.damageMultiplierFor('enemy-b')).toBe(1);
    expect(state.damageBonus()).toBeCloseTo(0.15);
  });

  it('标记恰好持续 8 秒，到期后失效并返回目标 ID', () => {
    const state = new BountyMarkState();
    state.mark('enemy-a', 1);
    expect(state.step(7.9)).toBeNull();
    expect(state.isActive).toBe(true);
    expect(state.remainingSecondsLeft).toBeCloseTo(0.1);
    expect(state.step(0.1)).toBe('enemy-a');
    expect(state.isActive).toBe(false);
    expect(state.targetId).toBeNull();
    expect(state.damageMultiplierFor('enemy-a')).toBe(1);
    // 到期后继续推进不会重复返回或复活。
    expect(state.step(5)).toBeNull();
  });

  it('重复施放替换旧标记，不叠加增伤', () => {
    const state = new BountyMarkState();
    state.mark('enemy-a', 1);
    state.step(3);
    state.mark('enemy-b', 1);
    expect(state.targetId).toBe('enemy-b');
    expect(state.remainingSecondsLeft).toBe(8);
    expect(state.damageMultiplierFor('enemy-a')).toBe(1);
    expect(state.damageMultiplierFor('enemy-b')).toBeCloseTo(1.15);
  });

  it('等级 2/3 放大增伤与赏金，但标记时长仍为 8 秒', () => {
    const state = new BountyMarkState();
    state.mark('enemy-a', freeSkillStrength(2));
    expect(state.damageMultiplierFor('enemy-a')).toBeCloseTo(1.18);
    expect(state.bountyGold()).toBe(14);
    expect(state.remainingSecondsLeft).toBe(8);

    state.mark('enemy-b', freeSkillStrength(3));
    expect(state.damageMultiplierFor('enemy-b')).toBeCloseTo(1.2175);
    expect(state.bountyGold()).toBe(17);
    expect(state.remainingSecondsLeft).toBe(8);
  });

  it('击杀标记目标领取 12 金币并消耗标记；每波最多 2 次', () => {
    const state = new BountyMarkState();
    state.mark('enemy-a', 1);
    expect(state.claimKill('enemy-a')).toBe(12);
    expect(state.claimedCount).toBe(1);
    expect(state.isActive).toBe(false);

    state.mark('enemy-b', 1);
    expect(state.claimKill('enemy-b')).toBe(12);
    expect(state.claimedCount).toBe(2);

    state.mark('enemy-c', 1);
    expect(state.claimKill('enemy-c')).toBe(0);
    expect(state.claimedCount).toBe(2);
    expect(state.maxPerWave).toBe(2);

    state.resetForWave();
    state.mark('enemy-d', 1);
    expect(state.claimKill('enemy-d')).toBe(12);
    expect(state.claimedCount).toBe(1);
  });

  it('非标记目标、宝箱与已领取过的目标都不给赏金', () => {
    const state = new BountyMarkState();
    state.mark('enemy-a', 1);
    expect(state.claimKill('enemy-b')).toBe(0);
    expect(state.isActive).toBe(true);

    // 宝箱即使命中了同一 ID 也不结算，标记保持。
    expect(state.claimKill('enemy-a', { isChest: true })).toBe(0);
    expect(state.isActive).toBe(true);

    expect(state.claimKill('enemy-a')).toBe(12);
    // 同一目标再次被标记也不会重复取钱（本波已领取记录）。
    state.mark('enemy-a', 1);
    expect(state.claimKill('enemy-a')).toBe(0);
    expect(state.claimedCount).toBe(1);
  });

  it('clear 只清当前标记，不重置本波已领取次数', () => {
    const state = new BountyMarkState();
    state.mark('enemy-a', 1);
    expect(state.claimKill('enemy-a')).toBe(12);
    state.mark('enemy-b', 1);
    // 目标死亡/离场由场景调用 clear。
    state.clear();
    expect(state.isActive).toBe(false);
    expect(state.claimedCount).toBe(1);
    expect(state.snapshot()).toMatchObject({
      active: false,
      targetId: null,
      claimedCount: 1,
      maxPerWave: 2,
    });
  });
});
