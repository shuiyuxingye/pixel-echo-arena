import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/game/arena';
import {
  BOSS_CHARGE_DAMAGE,
  BOSS_CHARGE_WINDUP_SECONDS,
  BOSS_CONTROL_SLOW_MULTIPLIER,
  BOSS_FAN_DAMAGE,
  BOSS_FAN_GAP_INDEX,
  BOSS_FAN_PROJECTILE_SPEED,
  BOSS_FAN_SLOTS,
  BOSS_HAMMER_DAMAGE,
  BOSS_HAMMER_WARNING_SECONDS,
  BOSS_PHASE_THRESHOLD,
  BOSS_RADIUS,
  BOSS_SUMMON_COUNT,
  BOSS_SUMMON_INTERVAL_SECONDS,
  BOSS_SUMMON_MAX_ALIVE,
  BossCombat,
  buildBossFanVolley,
  type BossStepContext,
  type BossStepResult,
} from '../src/game/boss';
import { HealthState, type DamageResult } from '../src/game/combat';
import { getEnemy, type DamageType } from '../src/game/data';
import {
  EnemySystem,
  enemyGrantsKillRewards,
  type EnemyStepContext,
} from '../src/game/enemy';
import { resolvePostDamagePhase } from '../src/game/run-state';

const STEP = 1 / 60;
const LAYOUT = createArenaLayout();
const ROOT = resolve(import.meta.dirname, '..');
const BOSS_MAX_HEALTH = 12000;
const PHASE_2_HEALTH = BOSS_MAX_HEALTH * BOSS_PHASE_THRESHOLD - 1;

function bossContext(
  health = BOSS_MAX_HEALTH,
  maxHealth = BOSS_MAX_HEALTH,
  playerX = 900,
  playerY = 480,
): BossStepContext {
  return {
    boss: { x: 500, y: 480, health, maxHealth },
    player: { x: playerX, y: playerY },
  };
}

function advance(
  combat: BossCombat,
  seconds: number,
  context: BossStepContext,
): BossStepResult[] {
  const results: BossStepResult[] = [];
  const steps = Math.ceil(seconds / STEP);
  for (let index = 0; index < steps; index += 1) {
    results.push(combat.step(STEP, context));
  }
  return results;
}

interface DamageSink {
  readonly health: HealthState;
  readonly calls: { damage: number; damageType: DamageType; result: DamageResult }[];
  readonly apply: (damage: number, damageType: DamageType) => DamageResult;
}

function damageSink(maxHealth = 2000): DamageSink {
  const health = new HealthState({ maxHealth });
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
  sink: DamageSink,
  playerX = 900,
  playerY = 480,
  isInvulnerable = false,
  controls: { readonly stunned?: boolean; readonly rooted?: boolean } = {},
): EnemyStepContext {
  return {
    player: { x: playerX, y: playerY, radius: 12, isInvulnerable },
    applyPlayerDamage: sink.apply,
    isStunned: () => controls.stunned === true,
    isRooted: () => controls.rooted === true,
  };
}

describe('裂隙炉王基础数值', () => {
  it('12000 HP、护甲 20、法抗 15%，不随波次倍率放大', () => {
    const boss = getEnemy('boss');
    expect(boss.name).toBe('裂隙炉王');
    expect(boss.maxHealth).toBe(BOSS_MAX_HEALTH);
    expect(boss.armor).toBe(20);
    expect(boss.magicResist).toBeCloseTo(0.15, 10);
    expect(boss.boss?.phaseThreshold).toBe(BOSS_PHASE_THRESHOLD);
    expect(boss.boss?.summonIntervalSeconds).toBe(BOSS_SUMMON_INTERVAL_SECONDS);
    expect(boss.boss?.summonCount).toBe(BOSS_SUMMON_COUNT);
    expect(boss.boss?.summonMaxAlive).toBe(BOSS_SUMMON_MAX_ALIVE);
  });

  it('弹体/锤击/冲锋三档基础伤害为 18/35/28', () => {
    expect(BOSS_FAN_DAMAGE).toBe(18);
    expect(BOSS_HAMMER_DAMAGE).toBe(35);
    expect(BOSS_CHARGE_DAMAGE).toBe(28);
  });
});

describe('扇形弹幕', () => {
  it('9 个槽位留空 1 个，缺口为 30°，其余 8 发均匀覆盖 ±60°', () => {
    const volley = buildBossFanVolley({ x: 500, y: 480 }, 0);
    expect(volley.shots).toHaveLength(BOSS_FAN_SLOTS - 1);
    expect(volley.shots.every((shot) => shot.damage === BOSS_FAN_DAMAGE)).toBe(true);
    expect(volley.shots.every((shot) => shot.speed === BOSS_FAN_PROJECTILE_SPEED)).toBe(true);

    const degrees = volley.shots
      .map((shot) => (shot.angle * 180) / Math.PI)
      .sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let index = 1; index < degrees.length; index += 1) {
      gaps.push((degrees[index] ?? 0) - (degrees[index - 1] ?? 0));
    }
    expect(Math.max(...gaps)).toBeCloseTo(30, 6);
    // 缺口位于瞄准中心：相邻两发为 -15° 与 +15°。
    expect(degrees.some((value) => Math.abs(value + 15) < 1e-6)).toBe(true);
    expect(degrees.some((value) => Math.abs(value - 15) < 1e-6)).toBe(true);
    expect(degrees.some((value) => Math.abs(value) < 1e-6)).toBe(false);
    expect((volley.gapCenterAngle * 180) / Math.PI).toBeCloseTo(0, 6);
    // 留空的是中心槽位。
    expect(BOSS_FAN_GAP_INDEX).toBe((BOSS_FAN_SLOTS - 1) / 2);
  });
});

describe('攻击节奏与阶段', () => {
  it('一阶段扇形弹幕与锤击交替，锤击预警 ≥ 0.8 秒', () => {
    expect(BOSS_HAMMER_WARNING_SECONDS).toBeGreaterThanOrEqual(0.8);

    const combat = new BossCombat();
    const context = bossContext();
    const events: ('fan' | 'hammer')[] = [];
    let hammerRemainingAtCreation = 0;
    let explosionResult: BossStepResult | null = null;

    for (let index = 0; index < Math.ceil(10 / STEP); index += 1) {
      const blastsBefore = combat.blasts.length;
      const result = combat.step(STEP, context);
      if (result.fanVolleys.length > 0) events.push('fan');
      if (combat.blasts.length > blastsBefore) {
        events.push('hammer');
        // 预警刚创建：剩余时间等于常量。
        if (events.filter((event) => event === 'hammer').length === 1) {
          hammerRemainingAtCreation = combat.blasts[0]?.remainingSeconds ?? 0;
        }
      }
      if (result.explosions.length > 0 && !explosionResult) explosionResult = result;
    }

    // 前四次攻击严格交替：弹幕 → 锤击 → 弹幕 → 锤击。
    expect(events.slice(0, 4)).toEqual(['fan', 'hammer', 'fan', 'hammer']);
    expect(hammerRemainingAtCreation).toBeCloseTo(BOSS_HAMMER_WARNING_SECONDS, 6);
    expect(explosionResult?.explosions).toHaveLength(1);
    expect(explosionResult?.explosions[0]?.damage).toBe(BOSS_HAMMER_DAMAGE);
    expect(explosionResult?.explosions[0]?.damageType).toBe('physical');
  });

  it('锤击预警未满 0.9 秒不落，满 0.9 秒当步落地', () => {
    const combat = new BossCombat();
    const context = bossContext();
    // 推进到第一次锤击预警出现。
    while (combat.blasts.length === 0) combat.step(STEP, context);
    expect(combat.blasts).toHaveLength(1);

    const before = combat.step(BOSS_HAMMER_WARNING_SECONDS - 0.05, context);
    expect(before.explosions).toHaveLength(0);
    expect(combat.blasts).toHaveLength(1);

    const after = combat.step(0.05, context);
    expect(after.explosions).toHaveLength(1);
    expect(combat.blasts).toHaveLength(0);
  });

  it('生命严格低于 50% 才进入二阶段，且不会回退', () => {
    const combat = new BossCombat();
    // 恰好 50% 仍是一阶段。
    expect(
      combat.step(STEP, bossContext(BOSS_MAX_HEALTH / 2, BOSS_MAX_HEALTH)).enteredPhase2,
    ).toBe(false);
    expect(combat.phase).toBe(1);

    const entered = combat.step(STEP, bossContext(PHASE_2_HEALTH, BOSS_MAX_HEALTH));
    expect(entered.enteredPhase2).toBe(true);
    expect(combat.phase).toBe(2);
    expect(combat.summonRemainingSeconds).toBe(BOSS_SUMMON_INTERVAL_SECONDS);

    // 即使生命被治疗回 50% 以上，二阶段也不回退。
    combat.step(STEP, bossContext(BOSS_MAX_HEALTH, BOSS_MAX_HEALTH));
    expect(combat.phase).toBe(2);
  });

  it('二阶段在弹幕/锤击循环中加入 0.9 秒预警的横向冲锋', () => {
    expect(BOSS_CHARGE_WINDUP_SECONDS).toBeGreaterThanOrEqual(0.8);
    const combat = new BossCombat();
    // 玩家在 Boss 右上方：冲锋仍只沿水平方向，朝玩家所在的右侧。
    const context = bossContext(PHASE_2_HEALTH, BOSS_MAX_HEALTH, 900, 700);
    let windupSeen = 0;
    let sawDash = false;
    for (let index = 0; index < Math.ceil(12 / STEP); index += 1) {
      const result = combat.step(STEP, context);
      if (combat.activity === 'windup') {
        expect(combat.windupRemaining).toBeGreaterThan(0);
        windupSeen = Math.max(windupSeen, combat.windupRemaining);
      }
      if (result.dashVector) {
        sawDash = true;
        // 横向冲锋：y 分量为 0，x 指向玩家一侧。
        expect(result.dashVector).toEqual({ x: 1, y: 0 });
      }
      if (sawDash) break;
    }
    expect(windupSeen).toBeGreaterThan(BOSS_CHARGE_WINDUP_SECONDS - STEP * 2);
    expect(sawDash).toBe(true);
  });

  it('一阶段不会冲锋', () => {
    const combat = new BossCombat();
    const context = bossContext();
    for (let index = 0; index < Math.ceil(12 / STEP); index += 1) {
      expect(combat.step(STEP, context).dashVector).toBeNull();
      expect(combat.activity).toBe('idle');
    }
  });
});

describe('二阶段增援', () => {
  it('进入二阶段后每 20 秒一组 4 只，首次不早于 20 秒', () => {
    const combat = new BossCombat();
    const context = bossContext(PHASE_2_HEALTH, BOSS_MAX_HEALTH);

    const enter = combat.step(STEP, context);
    expect(enter.enteredPhase2).toBe(true);
    expect(enter.summons).toHaveLength(0);

    // 19.9 秒时还没有召唤。
    const early = advance(combat, BOSS_SUMMON_INTERVAL_SECONDS - 0.1, context);
    expect(early.flatMap((result) => result.summons)).toHaveLength(0);

    const due = combat.step(0.1, context);
    expect(due.summons).toHaveLength(1);
    expect(due.summons[0]).toEqual({ enemyId: 'blob', count: BOSS_SUMMON_COUNT });
    expect(combat.summonRemainingSeconds).toBeCloseTo(BOSS_SUMMON_INTERVAL_SECONDS, 6);

    // 下一个完整 20 秒再次召唤。
    const second = advance(combat, BOSS_SUMMON_INTERVAL_SECONDS, context);
    expect(second.flatMap((result) => result.summons)).toHaveLength(1);
  });

  it('场上增援最多 8 只，达到上限后不再生成请求', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const boss = system.addEnemy(getEnemy('boss'), 500, 480);
    boss.combatant.health.applyDamage(BOSS_MAX_HEALTH - PHASE_2_HEALTH, 'true');
    const sink = damageSink();
    const target = context(sink, 900, 480, true);

    let requested = 0;
    const steps = Math.ceil(61 / STEP);
    for (let index = 0; index < steps; index += 1) {
      const result = system.step(STEP, target);
      for (const request of result.bossSummonRequests) {
        requested += request.count;
        for (let slot = 0; slot < request.count; slot += 1) {
          system.queueSpawn(getEnemy(request.enemyId), target.player, slot, {
            summoned: true,
          });
        }
      }
    }

    const aliveReinforcements = system.enemies.filter(
      (unit) => unit.summoned && unit.combatant.isAlive,
    );
    // 20 秒与 40 秒各 4 只；60 秒时已满 8 只，请求被截断。
    expect(requested).toBe(BOSS_SUMMON_MAX_ALIVE);
    expect(aliveReinforcements).toHaveLength(BOSS_SUMMON_MAX_ALIVE);

    // 增援击杀不产生金币/经验收益；普通敌人仍正常给收益。
    expect(aliveReinforcements.every((unit) => !enemyGrantsKillRewards(unit))).toBe(true);
    expect(enemyGrantsKillRewards({ summoned: false })).toBe(true);
  });
});

describe('Boss 控制转换与接入', () => {
  it('Boss 使用更大碰撞半径，并发射带缺口的扇形弹幕', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const boss = system.addEnemy(getEnemy('boss'), 500, 480);
    expect(boss.radius).toBe(BOSS_RADIUS);
    const sink = damageSink();
    const target = context(sink, 900, 480, true);

    for (let index = 0; index < Math.ceil(2 / STEP); index += 1) {
      system.step(STEP, target);
    }
    expect(system.projectiles).toHaveLength(BOSS_FAN_SLOTS - 1);
    const angles = system.projectiles
      .map((projectile) => (Math.atan2(projectile.vy, projectile.vx) * 180) / Math.PI)
      .sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let index = 1; index < angles.length; index += 1) {
      gaps.push((angles[index] ?? 0) - (angles[index - 1] ?? 0));
    }
    expect(Math.max(...gaps)).toBeCloseTo(30, 5);
  });

  it('锤击在预警结束后对范围内玩家结算 35 物伤', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    system.addEnemy(getEnemy('boss'), 500, 480);
    const sink = damageSink();
    const target = context(sink, 900, 480);

    for (let index = 0; index < Math.ceil(8 / STEP); index += 1) {
      system.step(STEP, target);
    }
    const hammerHit = sink.calls.find((call) => call.damage === BOSS_HAMMER_DAMAGE);
    expect(hammerHit).toBeDefined();
    expect(hammerHit?.damageType).toBe('physical');
  });

  it('二阶段增援走 EnemyStepResult 请求，落地后标记为增援', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const boss = system.addEnemy(getEnemy('boss'), 500, 480);
    boss.combatant.health.applyDamage(BOSS_MAX_HEALTH - PHASE_2_HEALTH, 'true');
    const sink = damageSink();
    const target = context(sink, 900, 480, true);

    let requestSeen = false;
    for (let index = 0; index < Math.ceil(21 / STEP); index += 1) {
      const result = system.step(STEP, target);
      if (result.bossSummonRequests.length > 0 && !requestSeen) {
        requestSeen = true;
        expect(result.bossSummonRequests[0]).toEqual({
          enemyId: 'blob',
          count: BOSS_SUMMON_COUNT,
        });
        // 本步只是请求，实体要等场景排入 0.8 秒出生提示。
        expect(system.enemies.filter((unit) => unit.summoned)).toHaveLength(0);
        for (let slot = 0; slot < result.bossSummonRequests[0]!.count; slot += 1) {
          system.queueSpawn(getEnemy('blob'), target.player, slot, { summoned: true });
        }
      }
    }
    expect(requestSeen).toBe(true);
    const spawned = system.enemies.filter((unit) => unit.summoned);
    expect(spawned).toHaveLength(BOSS_SUMMON_COUNT);
  });

  it('二阶段横向冲锋接触造成 28 物伤', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const boss = system.addEnemy(getEnemy('boss'), 500, 480);
    boss.combatant.health.applyDamage(BOSS_MAX_HEALTH - PHASE_2_HEALTH, 'true');
    const sink = damageSink();
    const target = context(sink, 900, 480);

    for (let index = 0; index < Math.ceil(12 / STEP); index += 1) {
      system.step(STEP, target);
    }
    expect(
      sink.calls.some(
        (call) => call.damage === BOSS_CHARGE_DAMAGE && call.damageType === 'physical',
      ),
    ).toBe(true);
  });

  it('眩晕与束缚不冻结 Boss，攻击照常推进且冲锋速度降为 50%', () => {
    function dashDistance(controlled: boolean): number {
      const system = new EnemySystem({ layout: LAYOUT });
      const boss = system.addEnemy(getEnemy('boss'), 500, 480);
      boss.combatant.health.applyDamage(BOSS_MAX_HEALTH - PHASE_2_HEALTH, 'true');
      const sink = damageSink();
      const target = context(sink, 900, 480, true, {
        stunned: controlled,
        rooted: controlled,
      });
      // 先确认控制期间仍在攻击：一阶段的第一发弹幕不依赖移动。
      for (let index = 0; index < Math.ceil(7 / STEP); index += 1) {
        system.step(STEP, target);
        if (system.boss?.activity === 'dash') break;
      }
      if (system.boss?.activity !== 'dash') throw new Error('Boss 未进入冲锋');
      const startX = boss.combatant.x;
      for (let index = 0; index < Math.ceil(1.2 / STEP); index += 1) {
        system.step(STEP, target);
      }
      return boss.combatant.x - startX;
    }

    const normal = dashDistance(false);
    const controlled = dashDistance(true);
    expect(controlled).toBeGreaterThan(0);
    expect(controlled).toBeCloseTo(normal * BOSS_CONTROL_SLOW_MULTIPLIER, 4);
  });

  it('控制期间 Boss 仍按节奏发射弹幕，不被无限锁死', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    system.addEnemy(getEnemy('boss'), 500, 480);
    const sink = damageSink();
    const target = context(sink, 900, 480, true, { stunned: true });
    for (let index = 0; index < Math.ceil(1.5 / STEP); index += 1) {
      system.step(STEP, target);
    }
    expect(system.projectiles.length).toBeGreaterThanOrEqual(BOSS_FAN_SLOTS - 1);
  });

  it('胜利清场移除普通敌人、敌弹与未落地提示，只保留已死亡 Boss', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const boss = system.addEnemy(getEnemy('boss'), 500, 480);
    system.addEnemy(getEnemy('blob'), 700, 480);
    system.addEnemy(getEnemy('spitter'), 760, 480);
    const sink = damageSink();
    const target = context(sink, 900, 480, true);
    for (let index = 0; index < Math.ceil(2 / STEP); index += 1) system.step(STEP, target);
    expect(system.projectiles.length).toBeGreaterThan(0);
    // 清场前一刻排入出生提示，验证未落地的敌人也被移除。
    system.queueSpawn(getEnemy('charger'), { x: 900, y: 480 });

    boss.combatant.health.applyDamage(15000, 'true');
    const cleared = system.clearForVictory();

    expect(cleared.enemyIds).toHaveLength(2);
    expect(cleared.projectileIds.length).toBeGreaterThan(0);
    expect(cleared.telegraphIds).toHaveLength(1);
    expect(system.projectiles).toHaveLength(0);
    expect(system.telegraphs).toHaveLength(0);
    expect(system.enemies.map((unit) => unit.enemy.id)).toEqual(['boss']);
    expect(system.enemies[0]?.combatant.isAlive).toBe(false);
  });
});

describe('必须击败 Boss', () => {
  it('同帧玩家死亡优先于 Boss 击败，结果为失败', () => {
    expect(
      resolvePostDamagePhase({
        playerDead: true,
        waveCleared: false,
        victory: true,
      }),
    ).toEqual({ phase: 'result', outcome: 'defeat', rewardsAllowed: false });
  });

  it('场景先处理玩家死亡、再判定 Boss 击败，且胜利只记录一次', () => {
    const scene = readFileSync(resolve(ROOT, 'src/game/scenes/ArenaScene.ts'), 'utf8');
    const deathIndex = scene.indexOf('this.handlePlayerDeath();');
    const victoryIndex = scene.indexOf('this.isBossDefeated()');
    expect(deathIndex).toBeGreaterThan(-1);
    expect(victoryIndex).toBeGreaterThan(deathIndex);

    // 结果守卫只允许第一次进入；清场与胜利结算在同一入口。
    expect(scene).toContain('private resultRecorded = false;');
    expect(scene).toContain('if (this.resultRecorded) return;');
    expect(scene).toContain('this.enemySystem.clearForVictory()');
    expect(scene).toContain("victory: true");
    expect(scene).toContain('this.runState.beginResult(resolution.outcome)');
  });
});
