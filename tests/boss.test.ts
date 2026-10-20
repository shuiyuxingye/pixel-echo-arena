import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/game/arena';
import {
  BOSS_BLAST_COUNT,
  BOSS_BLAST_WARNING_SECONDS,
  BOSS_CHARGE_DAMAGE,
  BOSS_FAN_DAMAGE,
  BOSS_FAN_GAP_INDEX,
  BOSS_FAN_PROJECTILE_SPEED,
  BOSS_FAN_SLOTS,
  BOSS_PHASE_THRESHOLD,
  BOSS_RADIUS,
  BOSS_SUMMON_COUNT,
  BOSS_SUMMON_INTERVAL_SECONDS,
  BossCombat,
  buildBossFanVolley,
  type BossStepContext,
  type BossStepResult,
} from '../src/game/boss';
import { HealthState, type DamageResult } from '../src/game/combat';
import { getEnemy, type DamageType } from '../src/game/data';
import { EnemySystem, type EnemyStepContext } from '../src/game/enemy';
import { resolvePostDamagePhase } from '../src/game/run-state';

const STEP = 1 / 60;
const LAYOUT = createArenaLayout();
const ROOT = resolve(import.meta.dirname, '..');

function bossContext(
  health = 2600,
  maxHealth = 2600,
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
): EnemyStepContext {
  return {
    player: { x: playerX, y: playerY, radius: 12, isInvulnerable },
    applyPlayerDamage: sink.apply,
  };
}

describe('Boss 基础数值', () => {
  it('2600 HP、护甲 20、法抗 15%，不随第 9 波倍率放大', () => {
    const boss = getEnemy('boss');
    expect(boss.maxHealth).toBe(2600);
    expect(boss.armor).toBe(20);
    expect(boss.magicResist).toBeCloseTo(0.15, 10);
    expect(boss.boss?.phaseThreshold).toBe(BOSS_PHASE_THRESHOLD);
    expect(boss.boss?.summonIntervalSeconds).toBe(BOSS_SUMMON_INTERVAL_SECONDS);
    expect(boss.boss?.summonCount).toBe(BOSS_SUMMON_COUNT);
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
  it('一阶段扇形弹幕与地面延迟爆破交替，预警 ≥ 0.7 秒后落地', () => {
    expect(BOSS_BLAST_WARNING_SECONDS).toBeGreaterThanOrEqual(0.7);

    const combat = new BossCombat();
    const context = bossContext();
    const events: ('fan' | 'blast')[] = [];
    let blastRemainingAtCreation = 0;
    let explosionResult: BossStepResult | null = null;

    for (let index = 0; index < Math.ceil(10 / STEP); index += 1) {
      const blastsBefore = combat.blasts.length;
      const result = combat.step(STEP, context);
      if (result.fanVolleys.length > 0) events.push('fan');
      if (combat.blasts.length > blastsBefore) {
        events.push('blast');
        // 预警刚创建：剩余时间等于常量。
        if (events.filter((event) => event === 'blast').length === 1) {
          blastRemainingAtCreation = combat.blasts[0]?.remainingSeconds ?? 0;
        }
      }
      if (result.explosions.length > 0 && !explosionResult) explosionResult = result;
    }

    // 前四次攻击严格交替：弹幕 → 爆破 → 弹幕 → 爆破。
    expect(events.slice(0, 4)).toEqual(['fan', 'blast', 'fan', 'blast']);
    expect(blastRemainingAtCreation).toBeCloseTo(BOSS_BLAST_WARNING_SECONDS, 6);
    expect(explosionResult?.explosions).toHaveLength(BOSS_BLAST_COUNT);
  });

  it('地面预警未满 0.9 秒不炸，满 0.9 秒当步落地', () => {
    expect(BOSS_BLAST_WARNING_SECONDS).toBeGreaterThanOrEqual(0.7);
    const combat = new BossCombat();
    const context = bossContext();
    // 推进到第一次地面爆破出现。
    while (combat.blasts.length === 0) combat.step(STEP, context);
    expect(combat.blasts).toHaveLength(BOSS_BLAST_COUNT);

    const before = combat.step(BOSS_BLAST_WARNING_SECONDS - 0.05, context);
    expect(before.explosions).toHaveLength(0);
    expect(combat.blasts).toHaveLength(BOSS_BLAST_COUNT);

    const after = combat.step(0.05, context);
    expect(after.explosions).toHaveLength(BOSS_BLAST_COUNT);
    expect(combat.blasts).toHaveLength(0);
  });

  it('生命严格低于 50% 才进入二阶段，且不会回退', () => {
    const combat = new BossCombat();
    // 恰好 50% 仍是一阶段。
    expect(combat.step(STEP, bossContext(1300, 2600)).enteredPhase2).toBe(false);
    expect(combat.phase).toBe(1);

    const entered = combat.step(STEP, bossContext(1299, 2600));
    expect(entered.enteredPhase2).toBe(true);
    expect(combat.phase).toBe(2);
    expect(combat.summonRemainingSeconds).toBe(BOSS_SUMMON_INTERVAL_SECONDS);

    // 即使生命被治疗回 50% 以上，二阶段也不回退。
    combat.step(STEP, bossContext(2600, 2600));
    expect(combat.phase).toBe(2);
  });

  it('二阶段在弹幕/爆破循环中加入 0.9 秒预警冲锋', () => {
    const combat = new BossCombat();
    const context = bossContext(1299, 2600);
    let sawWindup = false;
    let sawDash = false;
    for (let index = 0; index < Math.ceil(12 / STEP); index += 1) {
      const result = combat.step(STEP, context);
      if (combat.activity === 'windup') {
        expect(combat.windupRemaining).toBeGreaterThan(0);
        sawWindup = true;
      }
      if (result.dashVector) {
        sawDash = true;
        expect(Math.hypot(result.dashVector.x, result.dashVector.y)).toBeCloseTo(1, 6);
      }
      if (sawDash) break;
    }
    expect(sawWindup).toBe(true);
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

describe('二阶段召唤', () => {
  it('进入二阶段后每 15 秒召唤 4 个追击者，首次不早于 15 秒', () => {
    const combat = new BossCombat();
    const context = bossContext(1299, 2600);

    const enter = combat.step(STEP, context);
    expect(enter.enteredPhase2).toBe(true);
    expect(enter.summons).toHaveLength(0);

    // 14.9 秒时还没有召唤。
    const early = advance(combat, BOSS_SUMMON_INTERVAL_SECONDS - 0.1, context);
    expect(early.flatMap((result) => result.summons)).toHaveLength(0);

    const due = combat.step(0.1, context);
    expect(due.summons).toHaveLength(1);
    expect(due.summons[0]).toEqual({ enemyId: 'chaser', count: BOSS_SUMMON_COUNT });
    expect(combat.summonRemainingSeconds).toBeCloseTo(BOSS_SUMMON_INTERVAL_SECONDS, 6);

    // 下一个完整 15 秒再次召唤；完整一轮共 2 次。
    const second = advance(combat, BOSS_SUMMON_INTERVAL_SECONDS, context);
    expect(second.flatMap((result) => result.summons)).toHaveLength(1);
  });
});

describe('EnemySystem 接入', () => {
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

  it('地面爆破在预警结束后对范围内玩家结算 20 法伤', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    system.addEnemy(getEnemy('boss'), 500, 480);
    const sink = damageSink();
    const target = context(sink, 900, 480);

    for (let index = 0; index < Math.ceil(8 / STEP); index += 1) {
      system.step(STEP, target);
    }
    const blastHit = sink.calls.find((call) => call.damage === 20);
    expect(blastHit).toBeDefined();
    expect(blastHit?.damageType).toBe('magic');
  });

  it('二阶段召唤走 EnemyStepResult 的请求，不直接生成实体', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const boss = system.addEnemy(getEnemy('boss'), 500, 480);
    boss.combatant.health.applyDamage(1301, 'true');
    const sink = damageSink();
    const target = context(sink, 900, 480, true);

    const summons = [];
    for (let index = 0; index < Math.ceil(16 / STEP); index += 1) {
      const result = system.step(STEP, target);
      summons.push(...result.bossSummonRequests);
    }
    expect(summons).toHaveLength(1);
    expect(summons[0]).toEqual({ enemyId: 'chaser', count: BOSS_SUMMON_COUNT });
    // 本步只是请求，实体要等场景排入 0.8 秒出生提示。
    expect(system.enemies.filter((unit) => unit.enemy.id === 'chaser')).toHaveLength(0);
  });

  it('二阶段冲锋接触造成 24 物伤', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const boss = system.addEnemy(getEnemy('boss'), 500, 480);
    boss.combatant.health.applyDamage(1301, 'true');
    const sink = damageSink();
    // 距离 190：冲刺约 156 像素后进入接触范围（Boss 半径 30 + 玩家 12）。
    const target = context(sink, 690, 480);

    for (let index = 0; index < Math.ceil(12 / STEP); index += 1) {
      system.step(STEP, target);
    }
    expect(sink.calls.some((call) => call.damage === BOSS_CHARGE_DAMAGE)).toBe(true);
    expect(
      sink.calls.some(
        (call) => call.damage === BOSS_CHARGE_DAMAGE && call.damageType === 'physical',
      ),
    ).toBe(true);
  });

  it('胜利清场移除普通敌人、敌弹与未落地提示，只保留已死亡 Boss', () => {
    const system = new EnemySystem({ layout: LAYOUT });
    const boss = system.addEnemy(getEnemy('boss'), 500, 480);
    system.addEnemy(getEnemy('chaser'), 700, 480);
    system.addEnemy(getEnemy('shooter'), 760, 480);
    const sink = damageSink();
    const target = context(sink, 900, 480, true);
    for (let index = 0; index < Math.ceil(2 / STEP); index += 1) system.step(STEP, target);
    expect(system.projectiles.length).toBeGreaterThan(0);
    // 清场前一刻排入出生提示，验证未落地的敌人也被移除。
    system.queueSpawn(getEnemy('charger'), { x: 900, y: 480 });

    boss.combatant.health.applyDamage(3000, 'true');
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

describe('同帧死亡与胜利记录', () => {
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
