import { describe, expect, it } from 'vitest';
import { createArenaLayout, hasLineOfSight, isCircleBlocked } from '../src/game/arena';
import { HealthState, type DamageResult } from '../src/game/combat';
import { getCharacter, getEnemy, type DamageType } from '../src/game/data';
import {
  BOMBER_EXPLOSION_RADIUS,
  BOMBER_TRIGGER_RANGE,
  BOMBER_WINDUP_SECONDS,
  BROODMOTHER_MAX_LARVAE,
  BROODMOTHER_SUMMON_COUNT,
  BROODMOTHER_SUMMON_INTERVAL_SECONDS,
  BULWARK_WEAK_ARC,
  CHARGE_DASH_SECONDS,
  CHARGER_TRIGGER_RANGE,
  CONTACT_HIT_INTERVAL_SECONDS,
  ENEMY_RADIUS,
  ENEMY_MOVE_SPEED,
  EnemySystem,
  MENDER_HEAL_INTERVAL_SECONDS,
  MENDER_HEAL_PERCENT,
  MENDER_HEAL_RANGE,
  SHOOTER_PROJECTILE_SPEED,
  SKITTER_FLANK_DISTANCE,
  SPAWN_MIN_DISTANCE,
  SPAWN_TELEGRAPH_SECONDS,
  SPITTER_WINDUP_SECONDS,
  bulwarkWeakPointAngle,
  enemyGrantsChestReward,
  enemyGrantsKillRewards,
  isBulwarkWeakPointHit,
  resolveEnemySpawnPoint,
  stepEnemyProjectile,
  type EnemyPlayerTarget,
  type EnemyProjectileState,
  type EnemyStepContext,
} from '../src/game/enemy';
import { GrenadeSystem, type GrenadeTarget } from '../src/game/grenade';

const STEP = 1 / 60;
const LAYOUT = createArenaLayout();
const VISHDA = getCharacter('vishdal');
const AFTERIMAGE = VISHDA.passive.afterimage;

function player(
  x: number,
  y: number,
  isInvulnerable = false,
): EnemyPlayerTarget {
  return { x, y, radius: 12, isInvulnerable };
}

interface DamageSink {
  readonly health: HealthState;
  readonly calls: { damage: number; damageType: DamageType; result: DamageResult }[];
  readonly apply: (damage: number, damageType: DamageType) => DamageResult;
}

function damageSink(maxHealth = 1000, armor = 0): DamageSink {
  const health = new HealthState({ maxHealth, armor });
  const calls: DamageSink['calls'] = [];
  return {
    health,
    calls,
    apply: (damage, damageType) => {
      const result = health.applyDamage(damage, damageType);
      calls.push({ damage, damageType, result });
      return result;
    },
  };
}

function context(
  target: EnemyPlayerTarget,
  sink: DamageSink,
  overrides: Partial<EnemyStepContext> = {},
): EnemyStepContext {
  return {
    player: target,
    applyPlayerDamage: sink.apply,
    ...overrides,
  };
}

describe('四种普通敌人的行为', () => {
  it('团团怪直接追击，接触造成 8 物伤', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const chaser = system.addEnemy(getEnemy('blob'), 500, 480);
    const target = player(800, 480);
    const sink = damageSink();

    for (let step = 0; step < 60; step += 1) {
      system.step(STEP, context(target, sink));
    }
    // 1 秒按 100 像素/秒接近，且没有越过玩家。
    expect(chaser.combatant.x).toBeCloseTo(600, 0);
    expect(chaser.combatant.y).toBeCloseTo(480, 6);

    let steps = 0;
    while (sink.calls.length === 0 && steps < 600) {
      system.step(STEP, context(target, sink));
      steps += 1;
    }

    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]?.damage).toBe(8);
    expect(sink.calls[0]?.damageType).toBe('physical');
    expect(sink.health.health).toBe(1000 - 8);
    expect(800 - chaser.combatant.x).toBeLessThanOrEqual(ENEMY_RADIUS + 12 + 1);
  });

  it('镰足虫远距离高速绕侧，进入近距离后直线扑击', () => {
    const far = new EnemySystem({ layout: LAYOUT });
    const skitter = far.addEnemy(getEnemy('skitter'), 600, 480);
    const target = player(900, 480);
    const sink = damageSink();

    expect(ENEMY_MOVE_SPEED.flank).toBeGreaterThan(ENEMY_MOVE_SPEED.chase);
    expect(SKITTER_FLANK_DISTANCE).toBeLessThan(300);

    for (let step = 0; step < 60; step += 1) {
      far.step(STEP, context(target, sink));
    }
    // 绕侧：1 秒内横向位移明显，直线追击者此时 y 不变。
    const lateral = Math.abs(skitter.combatant.y - 480);
    const forward = Math.abs(skitter.combatant.x - 600);
    expect(lateral).toBeGreaterThan(60);
    expect(forward).toBeGreaterThan(0);
    expect(lateral).toBeGreaterThan(forward);

    // 近距离：不再绕侧，直接扑向目标，接触造成 5 物伤。
    const near = new EnemySystem({ layout: LAYOUT });
    const closeSkitter = near.addEnemy(getEnemy('skitter'), 760, 480);
    const closeTarget = player(900, 480);
    const closeSink = damageSink();
    expect(Math.hypot(900 - 760, 0)).toBeLessThanOrEqual(SKITTER_FLANK_DISTANCE);

    near.step(STEP, context(closeTarget, closeSink));
    expect(closeSkitter.combatant.y).toBeCloseTo(480, 9);
    expect(closeSkitter.combatant.x).toBeGreaterThan(760);

    let steps = 0;
    while (closeSink.calls.length === 0 && steps < 300) {
      near.step(STEP, context(closeTarget, closeSink));
      steps += 1;
    }
    expect(closeSink.calls).toHaveLength(1);
    expect(closeSink.calls[0]?.damage).toBe(5);
    expect(closeSink.calls[0]?.damageType).toBe('physical');
  });

  it('喷菇停顿 0.7 秒后发射 10 物伤孢子弹，预警方向与弹道一致', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const spitter = system.addEnemy(getEnemy('spitter'), 760, 480);
    const target = player(1000, 480);
    const sink = damageSink();
    const attack = getEnemy('spitter').attack;

    expect(attack?.windupSeconds).toBeGreaterThanOrEqual(0.7);
    expect(SPITTER_WINDUP_SECONDS).toBe(0.7);

    // 初始 1.6 秒攻击冷却内不发射；冷却结束先进入 0.7 秒停顿。
    for (let step = 0; step < 95; step += 1) {
      system.step(STEP, context(target, sink));
    }
    expect(system.projectiles).toHaveLength(0);
    expect(spitter.activity).toBe('idle');
    expect(sink.calls).toHaveLength(0);

    system.step(STEP, context(target, sink));
    expect(spitter.activity).toBe('windup');
    expect(spitter.windupRemaining).toBeCloseTo(SPITTER_WINDUP_SECONDS, 6);
    expect(system.projectiles).toHaveLength(0);

    // 预警期间原地停顿，且不会提前发射。
    const windupX = spitter.combatant.x;
    const windupY = spitter.combatant.y;
    let windupSteps = 0;
    while (spitter.activity === 'windup' && windupSteps < 120) {
      system.step(STEP, context(target, sink));
      windupSteps += 1;
      if (spitter.activity === 'windup') {
        expect(system.projectiles).toHaveLength(0);
      }
    }
    // 0.7 秒 = 42 步；进入预警的那一步不计入。
    expect(windupSteps).toBe(42);
    expect(spitter.combatant.x).toBeCloseTo(windupX, 9);
    expect(spitter.combatant.y).toBeCloseTo(windupY, 9);

    expect(system.projectiles).toHaveLength(1);
    const projectile = system.projectiles[0];
    expect(projectile?.damage).toBe(10);
    expect(projectile?.damageType).toBe('physical');
    // 预警指向玩家；实际弹道同向，命中后造成与预警一致的 10 伤害。
    const aim = Math.atan2(
      target.y - spitter.combatant.y,
      target.x - spitter.combatant.x,
    );
    expect(Math.atan2(projectile?.vy ?? 0, projectile?.vx ?? 0)).toBeCloseTo(aim, 6);
    expect(Math.hypot(projectile?.vx ?? 0, projectile?.vy ?? 0)).toBeCloseTo(
      SHOOTER_PROJECTILE_SPEED,
      6,
    );

    let steps = 0;
    while (sink.calls.length === 0 && steps < 120) {
      system.step(STEP, context(target, sink));
      steps += 1;
    }
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]?.damage).toBe(10);
    expect(sink.health.health).toBe(990);
  });

  it('冲锋猪预警 0.7 秒后冲刺，命中造成 18 物伤', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    // 100 像素在触发距离内，且从头到尾都通视。
    const charger = system.addEnemy(getEnemy('charger'), 620, 480);
    expect(100).toBeLessThanOrEqual(CHARGER_TRIGGER_RANGE);
    const target = player(720, 480);
    const sink = damageSink();

    system.step(STEP, context(target, sink));
    expect(charger.activity).toBe('windup');
    expect(charger.windupRemaining).toBeCloseTo(0.7, 9);
    // 预警方向与冲刺方向共用同一字段，指向玩家。
    expect(charger.dashX).toBeCloseTo(1, 9);
    expect(charger.dashY).toBeCloseTo(0, 9);

    let windupSteps = 1;
    while (charger.activity === 'windup' && windupSteps < 60) {
      system.step(STEP, context(target, sink));
      windupSteps += 1;
    }
    // 0.7 秒 = 42 步；进入预警本身占 1 步。
    expect(windupSteps).toBe(43);
    expect(charger.activity).toBe('dash');
    expect(charger.dashRemaining).toBeCloseTo(CHARGE_DASH_SECONDS, 9);
    expect(sink.calls).toHaveLength(0);

    let dashSteps = 0;
    while (sink.calls.length === 0 && dashSteps < 60) {
      system.step(STEP, context(target, sink));
      dashSteps += 1;
    }
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]?.damage).toBe(18);
    expect(sink.health.health).toBe(1000 - 18);
    // 冲撞命中后立刻结束冲刺。
    expect(charger.activity).toBe('idle');
  });

  it('冲锋猪蓄力时预警方向持续指向玩家，冲刺沿用最后一帧方向', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const charger = system.addEnemy(getEnemy('charger'), 600, 480);
    const sink = damageSink();

    system.step(STEP, context(player(750, 480), sink));
    expect(charger.activity).toBe('windup');
    expect(charger.dashX).toBeCloseTo(1, 9);
    expect(charger.dashY).toBeCloseTo(0, 9);

    // 蓄力中玩家移动到右下方，预警方向随之更新。
    const moved = player(750, 630);
    system.step(STEP, context(moved, sink));
    const half = 1 / Math.SQRT2;
    expect(charger.dashX).toBeCloseTo(half, 9);
    expect(charger.dashY).toBeCloseTo(half, 9);

    const lockedX = charger.dashX;
    const lockedY = charger.dashY;
    while (charger.activity === 'windup') {
      system.step(STEP, context(moved, sink));
    }
    expect(charger.activity).toBe('dash');
    expect(charger.dashX).toBeCloseTo(lockedX, 9);
    expect(charger.dashY).toBeCloseTo(lockedY, 9);
    // 预警期间不造成伤害；伤害只在冲刺接触时结算。
    expect(sink.calls).toHaveLength(0);
  });

  it('盾壳蟹挡路移动比追击者慢，接触造成 14 物伤', () => {
    const slowSystem = new EnemySystem({ layout: LAYOUT });
    const heavy = slowSystem.addEnemy(getEnemy('bulwark'), 500, 480);
    const fastSystem = new EnemySystem({ layout: LAYOUT });
    const chaser = fastSystem.addEnemy(getEnemy('blob'), 500, 480);
    const target = player(900, 480);
    const sink = damageSink();

    for (let step = 0; step < 60; step += 1) {
      slowSystem.step(STEP, context(target, sink));
      fastSystem.step(STEP, context(target, sink));
    }
    expect(heavy.combatant.x).toBeCloseTo(500 + ENEMY_MOVE_SPEED.guard, 0);
    expect(chaser.combatant.x).toBeCloseTo(500 + ENEMY_MOVE_SPEED.chase, 0);
    expect(ENEMY_MOVE_SPEED.guard).toBeLessThan(ENEMY_MOVE_SPEED.chase);

    const closeSystem = new EnemySystem({ layout: LAYOUT });
    closeSystem.addEnemy(getEnemy('bulwark'), 700, 480);
    const closeTarget = player(760, 480);
    const closeSink = damageSink();
    let steps = 0;
    while (closeSink.calls.length === 0 && steps < 300) {
      closeSystem.step(STEP, context(closeTarget, closeSink));
      steps += 1;
    }
    expect(closeSink.calls).toHaveLength(1);
    expect(closeSink.calls[0]?.damage).toBe(14);
    expect(closeSink.calls[0]?.damageType).toBe('physical');
  });
});

describe('性能场景弹体注入', () => {
  it('绕过射手冷却生成敌弹，仍按正常弹体推进', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const projectile = system.addDebugProjectile(500, 480, 120, 0, {
      damage: 2,
      range: 240,
    });
    expect(projectile.id).toBeGreaterThan(0);
    expect(projectile.ownerId).toBe('debug');
    expect(projectile.damage).toBe(2);
    expect(projectile.remainingRange).toBe(240);
    expect(system.projectiles).toHaveLength(1);
    expect(system.projectiles[0]?.vx).toBe(120);

    const playerTarget = player(500 + 120 * STEP + 1, 480, true);
    const result = system.step(STEP, context(playerTarget, damageSink()));
    // 无敌期不结算伤害，但弹体位置按速度推进。
    expect(result.projectileHits).toHaveLength(1);
    expect(system.projectiles).toHaveLength(0);
  });

  it('默认伤害/半径/射程与射手弹一致', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const projectile = system.addDebugProjectile(500, 480, 0, 60);
    expect(projectile.damage).toBe(1);
    expect(projectile.damageType).toBe('physical');
    expect(projectile.radius).toBeGreaterThan(0);
    expect(projectile.remainingRange).toBeGreaterThan(0);
  });

  it('可裁剪多余敌弹到固定上限，优先保留最新弹体', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    for (let index = 0; index < 5; index += 1) {
      system.addDebugProjectile(500 + index, 480, 0, 0);
    }
    const newestId = system.projectiles.at(-1)?.id;
    expect(system.trimProjectiles(3)).toBe(2);
    expect(system.projectiles).toHaveLength(3);
    expect(system.projectiles.at(-1)?.id).toBe(newestId);
    expect(system.trimProjectiles(3)).toBe(0);
    expect(system.trimProjectiles(0)).toBe(3);
    expect(system.projectiles).toHaveLength(0);
  });
});

describe('出生约束', () => {
  it('出生点至少距玩家 220，且不在墙/掩体内', () => {
    const origin = { x: 720, y: 480 };
    for (let offset = 0; offset < 8; offset += 1) {
      const point = resolveEnemySpawnPoint(LAYOUT, origin, offset);
      expect(Math.hypot(point.x - origin.x, point.y - origin.y)).toBeGreaterThanOrEqual(
        SPAWN_MIN_DISTANCE - 1e-9,
      );
      expect(isCircleBlocked(LAYOUT, point.x, point.y, ENEMY_RADIUS)).toBe(false);
    }
  });

  it('出生前有 0.8 秒提示，期间不产生敌人', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const target = player(720, 480);
    const sink = damageSink();
    const telegraph = system.queueSpawn(getEnemy('blob'), target, 0);

    expect(system.telegraphs).toHaveLength(1);
    expect(telegraph.remainingSeconds).toBeCloseTo(SPAWN_TELEGRAPH_SECONDS, 9);

    for (let step = 0; step < 47; step += 1) {
      const result = system.step(STEP, context(target, sink));
      expect(result.spawned).toHaveLength(0);
    }
    expect(system.enemies).toHaveLength(0);
    expect(system.telegraphs).toHaveLength(1);

    const result = system.step(STEP, context(target, sink));
    expect(result.spawned).toHaveLength(1);
    expect(system.enemies).toHaveLength(1);
    expect(system.telegraphs).toHaveLength(0);
  });

  it('activeEnemyCount 同时统计存活与待落地，死亡后释放名额', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    expect(system.activeEnemyCount).toBe(0);

    const unit = system.addEnemy(getEnemy('blob'), 500, 480);
    system.queueSpawn(getEnemy('blob'), player(800, 480), 0);
    expect(system.activeEnemyCount).toBe(2);

    unit.combatant.health.applyDamage(9999, 'true');
    expect(system.activeEnemyCount).toBe(1);
  });
});

describe('接触伤害与无敌期', () => {
  it('多个敌人接触伤害共享 0.5 秒受击间隔', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    system.addEnemy(getEnemy('blob'), 710, 480);
    system.addEnemy(getEnemy('blob'), 730, 480);
    const target = player(720, 480);
    const sink = damageSink();

    const first = system.step(STEP, context(target, sink));
    expect(first.contactHits).toHaveLength(1);
    expect(sink.health.health).toBe(992);

    let hits = 1;
    for (let step = 0; step < 29; step += 1) {
      hits += system.step(STEP, context(target, sink)).contactHits.length;
    }
    expect(hits).toBe(1);

    const next = system.step(STEP, context(target, sink));
    expect(next.contactHits).toHaveLength(1);
    expect(sink.calls).toHaveLength(2);
    expect(CONTACT_HIT_INTERVAL_SECONDS).toBe(0.5);
  });

  it('无敌期内敌弹命中不掉血，但仍然消耗弹体', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    system.addEnemy(getEnemy('spitter'), 760, 480);
    const target = player(1000, 480, true);
    const sink = damageSink();

    let invulnerableHits = 0;
    for (let step = 0; step < 240; step += 1) {
      const result = system.step(STEP, context(target, sink));
      invulnerableHits += result.projectileHits.filter((hit) => hit.damage === null).length;
    }

    expect(invulnerableHits).toBeGreaterThanOrEqual(1);
    expect(sink.calls).toHaveLength(0);
    expect(sink.health.health).toBe(1000);
  });
});

describe('障碍阻挡', () => {
  const cover = LAYOUT.covers[0];
  if (!cover) throw new Error('场地缺少掩体');

  it('敌弹命中掩体销毁并停在墙外', () => {
    const projectile: EnemyProjectileState = {
      id: 1,
      ownerId: 'enemy-1',
      damage: 10,
      damageType: 'physical',
      radius: 6,
      x: cover.x + cover.width / 2,
      y: cover.y - 100,
      vx: 0,
      vy: SHOOTER_PROJECTILE_SPEED,
      remainingRange: 500,
    };

    const status = stepEnemyProjectile(projectile, 1, LAYOUT);

    expect(status).toBe('blocked');
    expect(projectile.y).toBeLessThanOrEqual(cover.y);
    expect(projectile.y).toBeGreaterThanOrEqual(cover.y - 12);
  });

  it('爆炸不穿墙：被掩体挡住的目标不受直接溅射伤害', () => {
    if (!AFTERIMAGE) throw new Error('缺少残影配置');
    const primary: GrenadeTarget = {
      id: 'primary',
      x: cover.x + cover.width / 2,
      y: cover.y - 1,
      isAlive: true,
      applyDamage: () => damageSink().apply(0, 'physical'),
    };
    const blocked: GrenadeTarget = {
      id: 'blocked',
      x: cover.x + cover.width / 2,
      y: cover.y + cover.height + 1,
      isAlive: true,
      applyDamage: () => damageSink().apply(0, 'physical'),
    };

    expect(hasLineOfSight(LAYOUT, primary, blocked)).toBe(false);

    const openGrenade = new GrenadeSystem(VISHDA.attack, AFTERIMAGE);
    const open = openGrenade.detonate(
      { x: primary.x, y: primary.y },
      'primary',
      [primary, blocked],
    );
    expect(open.hits.map((hit) => hit.targetId)).toContain('blocked');

    const walledGrenade = new GrenadeSystem(VISHDA.attack, AFTERIMAGE, (from, to) =>
      hasLineOfSight(LAYOUT, from, to),
    );
    const walled = walledGrenade.detonate(
      { x: primary.x, y: primary.y },
      'primary',
      [primary, blocked],
    );
    expect(walled.hits.map((hit) => hit.targetId)).toEqual(['primary']);
  });

  it('追击者不会长期卡在掩体后，会绕行接近玩家', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const chaser = system.addEnemy(
      getEnemy('blob'),
      cover.x + cover.width / 2,
      cover.y - 60,
    );
    const target = player(cover.x + cover.width / 2, cover.y + cover.height + 60);
    const sink = damageSink();

    expect(hasLineOfSight(LAYOUT, chaser.combatant, target)).toBe(false);

    for (let step = 0; step < 300; step += 1) {
      system.step(STEP, context(target, sink));
    }

    expect(isCircleBlocked(LAYOUT, chaser.combatant.x, chaser.combatant.y, chaser.radius)).toBe(
      false,
    );
    const distance = Math.hypot(
      target.x - chaser.combatant.x,
      target.y - chaser.combatant.y,
    );
    expect(distance).toBeLessThanOrEqual(ENEMY_RADIUS + 12 + 1);
  });
});

describe('束缚与拉拽（缪尔赛思 L）', () => {
  it('束缚中的追击者不移动，但射手仍可开火', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const chaser = system.addEnemy(getEnemy('blob'), 500, 480);
    const shooter = system.addEnemy(getEnemy('spitter'), 560, 480);
    const target = player(800, 480);
    const sink = damageSink();
    const rooted = context(target, sink, { isRooted: (id) => id === chaser.id || id === shooter.id });

    const chaserX = chaser.combatant.x;
    const shooterX = shooter.combatant.x;
    system.step(STEP, rooted);
    expect(chaser.combatant.x).toBeCloseTo(chaserX, 10);
    expect(shooter.combatant.x).toBeCloseTo(shooterX, 10);

    // 射手初始 1.6 秒攻击冷却 + 0.7 秒停顿后照常发射敌弹。
    for (let step = 0; step < Math.ceil(2.5 / STEP); step += 1) system.step(STEP, rooted);
    expect(system.projectiles.length).toBeGreaterThanOrEqual(1);
    expect(shooter.combatant.x).toBeCloseTo(shooterX, 10);
  });

  it('束缚中的冲锋者不会进入预警或冲刺', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const charger = system.addEnemy(getEnemy('charger'), 600, 480);
    const target = player(800, 480);
    const sink = damageSink();
    const rooted = context(target, sink, { isRooted: () => true });

    for (let step = 0; step < 60; step += 1) system.step(STEP, rooted);
    expect(charger.activity).toBe('idle');
    expect(charger.combatant.x).toBeCloseTo(600, 10);
  });

  it('pullToward 拉近 35，Boss 免疫强制位移', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const chaser = system.addEnemy(getEnemy('blob'), 600, 480);
    const boss = system.addEnemy(getEnemy('boss'), 480, 480);

    const moved = system.pullToward(chaser.id, { x: 700, y: 480 }, 35);
    expect(moved).toBeCloseTo(35, 6);
    expect(chaser.combatant.x).toBeCloseTo(635, 6);

    const bossMoved = system.pullToward(boss.id, { x: 700, y: 480 }, 35);
    expect(bossMoved).toBe(0);
    expect(boss.combatant.x).toBeCloseTo(480, 10);
  });
});

describe('后四种普通怪与幼虫（US-012）', () => {
  it('盾壳蟹慢速转向玩家，弱点固定在朝向背面', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const bulwark = system.addEnemy(getEnemy('bulwark'), 500, 480);
    const tank = damageSink(100000);

    // 初始朝向东，玩家在东侧时正面无弱点；背后（西侧）命中弱点扇区。
    expect(bulwarkWeakPointAngle(bulwark)).toBeCloseTo(Math.PI, 9);
    expect(isBulwarkWeakPointHit(bulwark, { x: 400, y: 480 })).toBe(true);
    expect(isBulwarkWeakPointHit(bulwark, { x: 600, y: 480 })).toBe(false);
    expect(BULWARK_WEAK_ARC).toBeGreaterThan(0);
    expect(ENEMY_MOVE_SPEED.guard).toBeLessThan(ENEMY_MOVE_SPEED.chase);

    // 玩家转到北侧后，朝向按有限角速度缓转，不会瞬间锁定。
    system.step(STEP, context(player(500, 200), tank));
    expect(bulwark.facingAngle).toBeLessThan(0);
    expect(bulwark.facingAngle).toBeGreaterThan(-Math.PI / 2);
    expect(isBulwarkWeakPointHit(bulwark, { x: 500, y: 300 })).toBe(false);
    expect(isBulwarkWeakPointHit(bulwark, { x: 400, y: 480 })).toBe(true);
  });

  it('灯灵每 4 秒治疗范围内一名受伤敌人最大生命 8%', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const mender = system.addEnemy(getEnemy('mender'), 560, 480);
    const wounded = system.addEnemy(getEnemy('blob'), 620, 480);
    const target = player(900, 480);
    const tank = damageSink(100000);

    wounded.combatant.health.applyDamage(20, 'true');
    const startHealth = wounded.combatant.health.health;
    expect(startHealth).toBeCloseTo(15, 9);

    // 固定住受伤目标，确保 4 秒内仍在治疗范围内。
    const rooted = context(target, tank, {
      isRooted: (enemyId) => enemyId === wounded.id,
    });
    const heals: Array<{ targetId: string; amount: number }> = [];
    const steps = Math.ceil(MENDER_HEAL_INTERVAL_SECONDS / STEP) + 2;
    for (let step = 0; step < steps; step += 1) {
      const result = system.step(STEP, rooted);
      for (const heal of result.healEvents) {
        heals.push({ targetId: heal.targetId, amount: heal.amount });
      }
    }

    expect(MENDER_HEAL_INTERVAL_SECONDS).toBe(4);
    expect(MENDER_HEAL_PERCENT).toBe(0.08);
    expect(MENDER_HEAL_RANGE).toBeGreaterThan(60);
    expect(heals).toHaveLength(1);
    expect(heals[0]?.targetId).toBe(wounded.combatant.id);
    expect(heals[0]?.amount).toBeCloseTo(35 * MENDER_HEAL_PERCENT, 9);
    expect(wounded.combatant.health.health).toBeCloseTo(
      startHealth + 35 * MENDER_HEAL_PERCENT,
      9,
    );

    // 治疗冷却重置后，4 秒内不会再治疗同一目标。
    const extra = system.step(STEP, rooted);
    expect(extra.healEvents).toHaveLength(0);
    expect(mender.combatant.isAlive).toBe(true);
  });

  it('灯灵不治疗其他灯灵与 Boss，只对受伤的普通敌人生效', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    system.addEnemy(getEnemy('mender'), 560, 480);
    const otherMender = system.addEnemy(getEnemy('mender'), 620, 480);
    const boss = system.addEnemy(getEnemy('boss'), 650, 480);
    const target = player(900, 480);
    const tank = damageSink(100000);

    otherMender.combatant.health.applyDamage(20, 'true');
    boss.combatant.health.applyDamage(1000, 'true');
    const otherHealth = otherMender.combatant.health.health;
    const bossHealth = boss.combatant.health.health;

    let heals = 0;
    const steps = Math.ceil(MENDER_HEAL_INTERVAL_SECONDS / STEP) + 2;
    for (let step = 0; step < steps; step += 1) {
      heals += system.step(STEP, context(target, tank)).healEvents.length;
    }

    expect(heals).toBe(0);
    expect(otherMender.combatant.health.health).toBeCloseTo(otherHealth, 9);
    expect(boss.combatant.health.health).toBeCloseTo(bossHealth, 9);
  });

  it('爆爆兽 0.9 秒蓄力后自爆，伤害区在蓄力期间显示且位置不变', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const bomber = system.addEnemy(getEnemy('bomber'), 680, 480);
    const target = player(760, 480);
    const tank = damageSink();

    expect(BOMBER_TRIGGER_RANGE).toBeGreaterThan(80);
    expect(getEnemy('bomber').attack?.windupSeconds).toBe(BOMBER_WINDUP_SECONDS);

    const first = system.step(STEP, context(target, tank));
    expect(first.bomberExplosions).toHaveLength(0);
    expect(bomber.activity).toBe('windup');
    expect(bomber.windupRemaining).toBeCloseTo(BOMBER_WINDUP_SECONDS, 9);

    const lockedX = bomber.combatant.x;
    const lockedY = bomber.combatant.y;
    let explosion: (typeof first.bomberExplosions)[number] | null = null;
    let steps = 0;
    while (!explosion && steps < 120) {
      const result = system.step(STEP, context(target, tank));
      explosion = result.bomberExplosions[0] ?? null;
      steps += 1;
    }

    expect(steps).toBeGreaterThanOrEqual(Math.ceil(BOMBER_WINDUP_SECONDS / STEP) - 1);
    expect(bomber.combatant.x).toBeCloseTo(lockedX, 9);
    expect(bomber.combatant.y).toBeCloseTo(lockedY, 9);
    expect(explosion?.enemyId).toBe(bomber.id);
    expect(explosion?.radius).toBe(BOMBER_EXPLOSION_RADIUS);
    expect(explosion?.damage?.damage).toBeCloseTo(14, 9);
    expect(tank.calls.at(-1)?.damage).toBeCloseTo(14, 9);
    expect(bomber.combatant.isAlive).toBe(false);
  });

  it('爆爆兽蓄力期间被击杀会打断自爆', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const bomber = system.addEnemy(getEnemy('bomber'), 680, 480);
    const target = player(760, 480);
    const tank = damageSink();

    system.step(STEP, context(target, tank));
    expect(bomber.activity).toBe('windup');

    bomber.combatant.applyDamage(9999, 'true');
    let explosions = 0;
    for (let step = 0; step < 90; step += 1) {
      explosions += system.step(STEP, context(target, tank)).bomberExplosions.length;
    }
    expect(explosions).toBe(0);
    expect(bomber.combatant.isAlive).toBe(false);
    expect(tank.calls).toHaveLength(0);
  });

  it('巢母每 8 秒召 2 只幼虫，终生最多 6 只', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const brood = system.addEnemy(getEnemy('broodmother'), 500, 480);
    const target = player(900, 480);
    const tank = damageSink(100000);

    const counts: number[] = [];
    const run = (seconds: number): void => {
      const steps = Math.ceil(seconds / STEP);
      for (let step = 0; step < steps; step += 1) {
        for (const request of system.step(STEP, context(target, tank)).broodSummonRequests) {
          counts.push(request.count);
        }
      }
    };

    run(BROODMOTHER_SUMMON_INTERVAL_SECONDS + 0.1);
    expect(counts).toEqual([BROODMOTHER_SUMMON_COUNT]);
    run(BROODMOTHER_SUMMON_INTERVAL_SECONDS);
    run(BROODMOTHER_SUMMON_INTERVAL_SECONDS);
    expect(counts).toEqual([2, 2, 2]);
    expect(brood.larvaeSummoned).toBe(BROODMOTHER_MAX_LARVAE);

    // 终生上限用尽后不再产生召唤请求。
    run(BROODMOTHER_SUMMON_INTERVAL_SECONDS * 2);
    expect(counts).toEqual([2, 2, 2]);
    expect(brood.larvaeSummoned).toBe(6);
  });

  it('幼虫占用同屏 100 上限，满员时只召唤剩余名额', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    system.addEnemy(getEnemy('broodmother'), 500, 480);
    // 98 只团团怪 + 巢母 = 99，剩余名额 1。
    for (let index = 0; index < 98; index += 1) {
      system.addEnemy(getEnemy('blob'), 700, 480);
    }
    expect(system.activeEnemyCount).toBe(99);

    const target = player(900, 480);
    const tank = damageSink(100000);
    const counts: number[] = [];
    const steps = Math.ceil((BROODMOTHER_SUMMON_INTERVAL_SECONDS + 0.1) / STEP);
    for (let step = 0; step < steps; step += 1) {
      for (const request of system.step(STEP, context(target, tank)).broodSummonRequests) {
        counts.push(request.count);
      }
    }

    expect(counts).toEqual([1]);
  });

  it('幼虫只给 1 金币/1 经验，巢母与幼虫不触发宝箱奖励', () => {
    const larva = getEnemy('larva');
    expect(larva.goldReward).toBe(1);
    expect(larva.xpReward).toBe(1);

    expect(enemyGrantsKillRewards({ summoned: false })).toBe(true);
    expect(enemyGrantsChestReward({ enemy: larva, summoned: false })).toBe(false);
    expect(
      enemyGrantsChestReward({ enemy: getEnemy('broodmother'), summoned: false }),
    ).toBe(false);
    expect(enemyGrantsChestReward({ enemy: getEnemy('blob'), summoned: false })).toBe(true);
    expect(enemyGrantsChestReward({ enemy: getEnemy('blob'), summoned: true })).toBe(false);
  });
});
