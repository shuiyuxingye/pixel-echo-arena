import { describe, expect, it } from 'vitest';
import { createArenaLayout, hasLineOfSight, isCircleBlocked } from '../src/game/arena';
import { HealthState, type DamageResult } from '../src/game/combat';
import { getCharacter, getEnemy, type DamageType } from '../src/game/data';
import {
  CHARGE_DASH_SECONDS,
  CHARGER_TRIGGER_RANGE,
  CONTACT_HIT_INTERVAL_SECONDS,
  ENEMY_RADIUS,
  ENEMY_MOVE_SPEED,
  EnemySystem,
  SHOOTER_PROJECTILE_SPEED,
  SPAWN_MIN_DISTANCE,
  SPAWN_TELEGRAPH_SECONDS,
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
  it('追击者朝玩家移动，接触造成 8 物伤', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const chaser = system.addEnemy(getEnemy('chaser'), 500, 480);
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

  it('射手每 1.6 秒发射 10 物伤弹，弹体命中玩家后结算伤害', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    system.addEnemy(getEnemy('shooter'), 760, 480);
    const target = player(1000, 480);
    const sink = damageSink();

    for (let step = 0; step < 95; step += 1) {
      system.step(STEP, context(target, sink));
    }
    expect(system.projectiles).toHaveLength(0);
    expect(sink.calls).toHaveLength(0);

    system.step(STEP, context(target, sink));
    expect(system.projectiles).toHaveLength(1);
    expect(system.projectiles[0]?.damage).toBe(10);
    expect(system.projectiles[0]?.damageType).toBe('physical');

    let steps = 0;
    while (sink.calls.length === 0 && steps < 120) {
      system.step(STEP, context(target, sink));
      steps += 1;
    }
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]?.damage).toBe(10);
    expect(sink.health.health).toBe(990);
  });

  it('冲锋者预警 0.7 秒后冲刺，命中造成 18 物伤', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    // 100 像素在触发距离内，且从头到尾都通视。
    const charger = system.addEnemy(getEnemy('charger'), 620, 480);
    expect(100).toBeLessThanOrEqual(CHARGER_TRIGGER_RANGE);
    const target = player(720, 480);
    const sink = damageSink();

    system.step(STEP, context(target, sink));
    expect(charger.activity).toBe('windup');
    expect(charger.windupRemaining).toBeCloseTo(0.7, 9);

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

  it('重装者移动比追击者慢，接触造成 14 物伤', () => {
    const slowSystem = new EnemySystem({ layout: LAYOUT });
    const heavy = slowSystem.addEnemy(getEnemy('heavy'), 500, 480);
    const fastSystem = new EnemySystem({ layout: LAYOUT });
    const chaser = fastSystem.addEnemy(getEnemy('chaser'), 500, 480);
    const target = player(900, 480);
    const sink = damageSink();

    for (let step = 0; step < 60; step += 1) {
      slowSystem.step(STEP, context(target, sink));
      fastSystem.step(STEP, context(target, sink));
    }
    expect(heavy.combatant.x).toBeCloseTo(500 + ENEMY_MOVE_SPEED.heavy, 0);
    expect(chaser.combatant.x).toBeCloseTo(500 + ENEMY_MOVE_SPEED.chase, 0);
    expect(ENEMY_MOVE_SPEED.heavy).toBeLessThan(ENEMY_MOVE_SPEED.chase);

    const closeSystem = new EnemySystem({ layout: LAYOUT });
    closeSystem.addEnemy(getEnemy('heavy'), 700, 480);
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
    const telegraph = system.queueSpawn(getEnemy('chaser'), target, 0);

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
});

describe('接触伤害与无敌期', () => {
  it('多个敌人接触伤害共享 0.5 秒受击间隔', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    system.addEnemy(getEnemy('chaser'), 710, 480);
    system.addEnemy(getEnemy('chaser'), 730, 480);
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
    system.addEnemy(getEnemy('shooter'), 760, 480);
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
      getEnemy('chaser'),
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
    const chaser = system.addEnemy(getEnemy('chaser'), 500, 480);
    const shooter = system.addEnemy(getEnemy('shooter'), 560, 480);
    const target = player(800, 480);
    const sink = damageSink();
    const rooted = context(target, sink, { isRooted: (id) => id === chaser.id || id === shooter.id });

    const chaserX = chaser.combatant.x;
    const shooterX = shooter.combatant.x;
    system.step(STEP, rooted);
    expect(chaser.combatant.x).toBeCloseTo(chaserX, 10);
    expect(shooter.combatant.x).toBeCloseTo(shooterX, 10);

    // 射手初始 1.6 秒攻击冷却；推进到冷却结束后应照常发射敌弹。
    for (let step = 0; step < 60 * 2; step += 1) system.step(STEP, rooted);
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
    const chaser = system.addEnemy(getEnemy('chaser'), 600, 480);
    const boss = system.addEnemy(getEnemy('boss'), 480, 480);

    const moved = system.pullToward(chaser.id, { x: 700, y: 480 }, 35);
    expect(moved).toBeCloseTo(35, 6);
    expect(chaser.combatant.x).toBeCloseTo(635, 6);

    const bossMoved = system.pullToward(boss.id, { x: 700, y: 480 }, 35);
    expect(bossMoved).toBe(0);
    expect(boss.combatant.x).toBeCloseTo(480, 10);
  });
});
