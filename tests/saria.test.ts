import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/game/arena';
import { AttackTimer, Combatant, HealthState } from '../src/game/combat';
import { getCharacter, getEnemy } from '../src/game/data';
import { EnemySystem } from '../src/game/enemy';
import {
  SARIA_PASSIVE_COOLDOWN_REDUCTION_SECONDS,
  SariaCombat,
  calciumFieldMagicMultiplier,
  calciumFieldSlowMultiplier,
  isInsideCalciumField,
  resolveShieldBash,
} from '../src/game/saria';

const ROOT = process.cwd();
const STEP = 1 / 60;
const SARIA = getCharacter('saria');

function createSariaCombat(): SariaCombat {
  return new SariaCombat({
    kCooldownSeconds: SARIA.skillK.cooldownSeconds,
    healAmount: SARIA.skillK.params?.heal ?? 0,
    shieldAmount: SARIA.skillK.params?.shield ?? 0,
    shieldDurationSeconds: SARIA.skillK.params?.shieldDurationSeconds ?? 0,
    passiveLCooldownReductionSeconds: SARIA_PASSIVE_COOLDOWN_REDUCTION_SECONDS,
    lCooldownSeconds: SARIA.skillL.cooldownSeconds,
    lDurationSeconds: SARIA.skillL.durationSeconds ?? 0,
    fieldRadius: SARIA.skillL.params?.fieldRadius ?? 0,
    fieldHealPerSecond: SARIA.skillL.params?.healPerSecond ?? 0,
    enemySlowPercent: SARIA.skillL.params?.enemySlowPercent ?? 0,
    enemyMagicVulnerability: SARIA.skillL.params?.enemyMagicVulnerability ?? 0,
    attackBonusMagicDamage: SARIA.skillL.params?.attackBonusMagicDamage ?? 0,
  });
}

function createHealth(): HealthState {
  return new HealthState({
    maxHealth: SARIA.maxHealth,
    armor: SARIA.armor,
    magicResist: SARIA.magicResist,
  });
}

/** 按固定逻辑步推进，模拟真实战斗中的冷却与护盾衰减。 */
function advance(
  combat: SariaCombat,
  seconds: number,
  health?: HealthState,
): void {
  const steps = Math.round(seconds / STEP);
  for (let step = 0; step < steps; step += 1) combat.step(STEP, health);
}

function combatant(id: string, x: number, y: number): Combatant {
  return new Combatant({ id, x, y, radius: 12, maxHealth: 180 });
}

describe('塞雷娅基础数值', () => {
  it('使用已确认的生命、护甲、法抗与移速', () => {
    expect(SARIA).toMatchObject({
      maxHealth: 200,
      armor: 35,
      magicResist: 0.1,
      moveSpeed: 150,
      radius: 12,
    });
  });

  it('J 盾击每 0.55 秒、82 距离、110° 扇区、26 物伤、击退 12', () => {
    expect(SARIA.attack).toMatchObject({
      intervalSeconds: 0.55,
      range: 82,
      damage: 26,
      damageType: 'physical',
      arcDegrees: 110,
      knockback: 12,
    });

    const timer = new AttackTimer(SARIA.attack.intervalSeconds);
    let swings = 0;
    for (let step = 0; step < 60; step += 1) {
      if (timer.update(STEP, true)) swings += 1;
    }
    // 1 秒内按 0.55 秒间隔挥击 2 次（第 0、0.55 秒）。
    expect(swings).toBe(2);
  });
});

describe('塞雷娅 J 盾击扇区', () => {
  const origin = { x: 100, y: 100 };
  const halfAngle = 55 * (Math.PI / 180);

  it('只命中面前 110° 扇区内、射程内的存活目标', () => {
    const inside = combatant('inside', origin.x + 60, origin.y);
    const edgeAngle = combatant(
      'edge-angle',
      origin.x + 60 * Math.cos(halfAngle - 0.01),
      origin.y + 60 * Math.sin(halfAngle - 0.01),
    );
    const outsideAngle = combatant(
      'outside-angle',
      origin.x + 60 * Math.cos(halfAngle + 0.01),
      origin.y + 60 * Math.sin(halfAngle + 0.01),
    );
    const behind = combatant('behind', origin.x - 40, origin.y);
    const outOfRange = combatant('out-range', origin.x + 83, origin.y);
    const dead = combatant('dead', origin.x + 30, origin.y);
    dead.applyDamage(1000, 'true');

    const hits = resolveShieldBash(
      origin,
      'east',
      [inside, edgeAngle, outsideAngle, behind, outOfRange, dead].map((target) => ({
        combatant: target,
      })),
      SARIA.attack,
    );
    expect(new Set(hits.map((hit) => hit.targetId))).toEqual(
      new Set(['inside', 'edge-angle']),
    );
    for (const hit of hits) {
      expect(hit.result.applied).toBe(true);
      expect(hit.result.damage).toBeCloseTo(26, 10);
    }
  });

  it('命中结果随面向翻转，背后目标不会被命中', () => {
    const east = combatant('east-target', origin.x + 50, origin.y);
    const west = combatant('west-target', origin.x - 50, origin.y);
    const targets = [{ combatant: east }, { combatant: west }];

    expect(
      resolveShieldBash(origin, 'east', targets, SARIA.attack).map((hit) => hit.targetId),
    ).toEqual(['east-target']);
    expect(
      resolveShieldBash(origin, 'west', targets, SARIA.attack).map((hit) => hit.targetId),
    ).toEqual(['west-target']);
  });

  it('普通敌人被请求击退 12，精英不被击退', () => {
    const normal = combatant('normal', origin.x + 40, origin.y);
    const elite = combatant('elite', origin.x + 30, origin.y);
    const hits = resolveShieldBash(
      origin,
      'east',
      [
        { combatant: normal },
        { combatant: elite, isElite: true },
      ],
      SARIA.attack,
    );

    const byId = new Map(hits.map((hit) => [hit.targetId, hit]));
    expect(byId.get('normal')?.knockbackDistance).toBe(12);
    expect(byId.get('elite')?.knockbackDistance).toBe(0);
  });

  it('EnemySystem.knockback 沿远离玩家的方向位移并受阻挡约束', () => {
    const layout = createArenaLayout();
    const enemies = new EnemySystem({ layout });
    const enemy = enemies.addEnemy(getEnemy('blob'), 770, 480);
    const moved = enemies.knockback(enemy.id, { x: 720, y: 480 }, 12);

    expect(moved).toBeCloseTo(12, 6);
    expect(enemy.combatant.x).toBeCloseTo(782, 6);
    expect(enemy.combatant.y).toBeCloseTo(480, 6);
  });
});

describe('塞雷娅 K 急救配置', () => {
  it('恢复 40 生命并获得 25 护盾持续 4 秒，冷却 10 秒', () => {
    const combat = createSariaCombat();
    const health = createHealth();
    health.applyDamage(60, 'true');
    expect(health.health).toBe(SARIA.maxHealth - 60);

    const result = combat.tryActivateK(health);
    expect(result).not.toBeNull();
    expect(result?.healed).toBeCloseTo(40, 10);
    expect(health.health).toBeCloseTo(SARIA.maxHealth - 20, 10);
    expect(result?.shield).toBe(25);
    expect(health.shield).toBe(25);
    expect(combat.shieldRemaining).toBeCloseTo(4, 10);
    expect(combat.kCooldownRemaining).toBeCloseTo(10, 10);
  });

  it('治疗不超过生命上限，满血施放不触发精神回复', () => {
    const combat = createSariaCombat();
    const health = createHealth();
    health.applyDamage(5, 'true');
    expect(combat.tryActivateL()).toBe(true);
    expect(combat.lCooldownRemaining).toBeCloseTo(28, 10);

    const result = combat.tryActivateK(health);
    expect(result?.healed).toBeCloseTo(5, 10);
    expect(health.health).toBe(SARIA.maxHealth);
    // 只恢复到上限也属于实际治疗，因此会触发一次精神回复。
    expect(combat.lCooldownRemaining).toBeCloseTo(26, 10);
    expect(combat.passiveTriggerCount).toBe(1);

    const fullCombat = createSariaCombat();
    const fullHealth = createHealth();
    expect(fullHealth.health).toBe(SARIA.maxHealth);
    const fullResult = fullCombat.tryActivateK(fullHealth);
    expect(fullResult?.healed).toBe(0);
    expect(fullResult?.passiveTriggered).toBe(false);
    expect(fullCombat.passiveTriggerCount).toBe(0);
    // 满血仍会获得护盾。
    expect(fullHealth.shield).toBe(25);
  });

  it('护盾不叠加：取较高剩余量并刷新 4 秒持续时间', () => {
    const combat = createSariaCombat();
    const health = createHealth();

    expect(combat.tryActivateK(health)?.shield).toBe(25);
    health.applyDamage(10, 'true');
    expect(health.shield).toBe(15);

    // 通过冷却返还模拟下一次 K 可用；不得把护盾叠加到 40。
    expect(combat.reduceCooldown(10)).toBeCloseTo(10, 10);
    expect(combat.tryActivateK(health)?.shield).toBe(25);
    expect(health.shield).toBe(25);
    expect(combat.shieldRemaining).toBeCloseTo(4, 10);

    // 已有更高护盾时保持较高值，只刷新时间。
    const stronger = createSariaCombat();
    const strongHealth = createHealth();
    strongHealth.setShield(30);
    expect(stronger.tryActivateK(strongHealth)?.shield).toBe(30);
    expect(strongHealth.shield).toBe(30);
    expect(stronger.shieldRemaining).toBeCloseTo(4, 10);
  });

  it('护盾在 4 秒后到期并从生命状态清除', () => {
    const combat = createSariaCombat();
    const health = createHealth();
    combat.tryActivateK(health);

    advance(combat, 3.9, health);
    expect(combat.isShieldActive).toBe(true);
    expect(health.shield).toBe(25);

    advance(combat, 0.2, health);
    expect(combat.isShieldActive).toBe(false);
    expect(combat.shieldRemaining).toBe(0);
    expect(health.shield).toBe(0);
  });

  it('冷却中或死亡时不能再次施放', () => {
    const combat = createSariaCombat();
    const health = createHealth();
    expect(combat.tryActivateK(health)).not.toBeNull();
    expect(combat.tryActivateK(health)).toBeNull();

    const deadCombat = createSariaCombat();
    const deadHealth = createHealth();
    deadHealth.applyDamage(1000, 'true');
    expect(deadCombat.tryActivateK(deadHealth)).toBeNull();
  });
});

describe('塞雷娅被动精神回复', () => {
  it('K 实际恢复生命时使 L 剩余冷却减少 2 秒', () => {
    const combat = createSariaCombat();
    const health = createHealth();
    expect(combat.tryActivateL()).toBe(true);
    expect(combat.lCooldownRemaining).toBeCloseTo(28, 10);

    health.applyDamage(100, 'true');
    const result = combat.tryActivateK(health);
    expect(result?.passiveTriggered).toBe(true);
    expect(result?.lCooldownReducedSeconds).toBeCloseTo(2, 10);
    expect(combat.lCooldownRemaining).toBeCloseTo(26, 10);
    expect(combat.passiveTriggerCount).toBe(1);
  });

  it('L 已就绪时治疗不产生返还，也不出现负数冷却', () => {
    const combat = createSariaCombat();
    const health = createHealth();
    health.applyDamage(50, 'true');

    const result = combat.tryActivateK(health);
    expect(result?.passiveTriggered).toBe(true);
    expect(result?.lCooldownReducedSeconds).toBe(0);
    expect(combat.lCooldownRemaining).toBe(0);
  });

  it('持续治疗/直接治疗不递归触发，只有 K 的实际治疗计数', () => {
    const combat = createSariaCombat();
    const health = createHealth();
    combat.tryActivateL();
    health.applyDamage(100, 'true');
    combat.tryActivateK(health);
    expect(combat.passiveTriggerCount).toBe(1);
    const lCooldownAfterK = combat.lCooldownRemaining;

    // 领域持续治疗由 SariaCombat.step 内部结算，不经过 K 入口，因此不递归触发。
    for (let step = 0; step < 60; step += 1) combat.step(STEP, health);
    expect(combat.passiveTriggerCount).toBe(1);
    expect(combat.lCooldownRemaining).toBeCloseTo(lCooldownAfterK - 1, 6);
  });
});

describe('塞雷娅 L 冷却骨架与强化冷却', () => {
  it('L 冷却 28 秒、持续 8 秒；生效中或冷却中不能重复启动', () => {
    const combat = createSariaCombat();
    expect(combat.tryActivateL()).toBe(true);
    expect(combat.lCooldownRemaining).toBeCloseTo(28, 10);
    expect(combat.calciumFieldRemaining).toBeCloseTo(8, 10);
    expect(combat.tryActivateL()).toBe(false);

    advance(combat, 8.1);
    expect(combat.isCalciumFieldActive).toBe(false);
    expect(combat.lCooldownRemaining).toBeCloseTo(19.9, 6);
  });

  it('G03 冷却倍率只作用于之后启动的冷却', () => {
    const combat = createSariaCombat();
    combat.setCooldownMultiplier(0.75);
    const health = createHealth();
    combat.tryActivateK(health);
    combat.tryActivateL();
    expect(combat.kCooldownRemaining).toBeCloseTo(7.5, 10);
    expect(combat.lCooldownRemaining).toBeCloseTo(21, 10);
  });

  it('G08/被动返还遵守下限，已就绪时不回抬', () => {
    const combat = createSariaCombat();
    expect(combat.reduceCooldown(2)).toBe(0);
    expect(combat.reduceLCooldown(2)).toBe(0);

    const health = createHealth();
    combat.tryActivateK(health);
    expect(combat.reduceCooldown(100, 6)).toBeCloseTo(4, 10);
    expect(combat.kCooldownRemaining).toBeCloseTo(6, 10);
    expect(combat.reduceCooldown(2, 6)).toBe(0);

    combat.tryActivateL();
    expect(combat.reduceLCooldown(100, 16.8)).toBeCloseTo(11.2, 6);
    expect(combat.lCooldownRemaining).toBeCloseTo(16.8, 6);
    expect(combat.reduceLCooldown(2, 16.8)).toBe(0);
  });

  it('进入下一波清空 K/L 冷却并结束领域，两个技能立即就绪', () => {
    const combat = createSariaCombat();
    const health = createHealth();
    combat.tryActivateK(health);
    combat.tryActivateL();
    expect(combat.isCalciumFieldActive).toBe(true);
    expect(combat.kCooldownRemaining).toBeGreaterThan(0);
    expect(combat.lCooldownRemaining).toBeGreaterThan(0);

    combat.resetForWaveStart();
    expect(combat.kCooldownRemaining).toBe(0);
    expect(combat.lCooldownRemaining).toBe(0);
    expect(combat.isCalciumFieldActive).toBe(false);
    expect(combat.tryActivateK(health)).not.toBeNull();
    expect(combat.tryActivateL()).toBe(true);
  });
});

describe('塞雷娅 L 钙质化领域', () => {
  const origin = { x: 100, y: 100 };

  it('以自身为圆心半径 120 判定，边界包含、离开即移除', () => {
    const field = { x: origin.x, y: origin.y, radius: 120 };
    expect(isInsideCalciumField(field, { x: origin.x + 119, y: origin.y })).toBe(true);
    expect(isInsideCalciumField(field, { x: origin.x + 120, y: origin.y })).toBe(true);
    expect(isInsideCalciumField(field, { x: origin.x + 121, y: origin.y })).toBe(false);

    // 领域跟随自身：玩家移动后，同一个敌人从领域内变为领域外。
    const enemy = { x: origin.x + 100, y: origin.y };
    expect(isInsideCalciumField({ x: origin.x, y: origin.y, radius: 120 }, enemy)).toBe(true);
    expect(isInsideCalciumField({ x: origin.x + 300, y: origin.y, radius: 120 }, enemy)).toBe(
      false,
    );
    // 再走回原位置重新进入，仍是同一个包含关系，没有残留状态。
    expect(isInsideCalciumField({ x: origin.x, y: origin.y, radius: 120 }, enemy)).toBe(true);
  });

  it('领域内减速 35%、受到法伤 +30%；离开或结束后立即回到 1，不叠乘', () => {
    expect(calciumFieldSlowMultiplier(true, 0.35)).toBeCloseTo(0.65, 10);
    expect(calciumFieldSlowMultiplier(false, 0.35)).toBe(1);
    expect(calciumFieldMagicMultiplier(true, 0.3)).toBeCloseTo(1.3, 10);
    expect(calciumFieldMagicMultiplier(false, 0.3)).toBe(1);

    // 重复进入返回同一倍率，不会变成 0.65²；效果结束（inField=false）即移除。
    const firstEnter = calciumFieldSlowMultiplier(true, 0.35);
    const secondEnter = calciumFieldSlowMultiplier(true, 0.35);
    expect(secondEnter).toBe(firstEnter);
    expect(calciumFieldMagicMultiplier(true, 0.3)).toBeCloseTo(1.3, 10);
  });

  it('生效期间每秒回复自身 8 生命，8 秒结束后停止', () => {
    const combat = createSariaCombat();
    const health = createHealth();
    health.applyDamage(100, 'true');
    const afterDamage = SARIA.maxHealth - 100;
    expect(health.health).toBe(afterDamage);

    expect(combat.tryActivateL()).toBe(true);
    advance(combat, 1, health);
    expect(health.health).toBeCloseTo(afterDamage + 8, 6);

    advance(combat, 3, health);
    expect(health.health).toBeCloseTo(afterDamage + 32, 6);

    advance(combat, 4, health);
    expect(combat.isCalciumFieldActive).toBe(false);
    expect(health.health).toBeCloseTo(afterDamage + 64, 6);

    // 效果结束后不再治疗。
    advance(combat, 1, health);
    expect(health.health).toBeCloseTo(afterDamage + 64, 6);
  });

  it('领域内治疗不超过生命上限，死亡时不再回复', () => {
    const combat = createSariaCombat();
    const health = createHealth();
    health.applyDamage(5, 'true');
    combat.tryActivateL();
    advance(combat, 2, health);
    expect(health.health).toBe(SARIA.maxHealth);

    const deadCombat = createSariaCombat();
    const deadHealth = createHealth();
    deadHealth.applyDamage(1000, 'true');
    deadCombat.tryActivateL();
    advance(deadCombat, 1, deadHealth);
    expect(deadHealth.health).toBe(0);
  });

  it('领域期间 J 追加 10 法伤，领域内目标承受 +30% 法伤', () => {
    const inside = combatant('inside', origin.x + 50, origin.y);
    const outside = combatant('outside', origin.x + 40, origin.y + 10);
    const hits = resolveShieldBash(
      origin,
      'east',
      [{ combatant: inside }, { combatant: outside }],
      SARIA.attack,
      1,
      {
        bonusMagicDamage: 10,
        magicDamageMultiplier: (targetId) => (targetId === 'inside' ? 1.3 : 1),
      },
    );

    const byId = new Map(hits.map((hit) => [hit.targetId, hit]));
    // 物理 26 保持原样；追加法伤在领域内为 10 × 1.3 = 13，领域外为 10。
    expect(byId.get('inside')?.result.damage).toBeCloseTo(26, 10);
    expect(byId.get('inside')?.bonusMagicResult?.damage).toBeCloseTo(13, 10);
    expect(byId.get('outside')?.result.damage).toBeCloseTo(26, 10);
    expect(byId.get('outside')?.bonusMagicResult?.damage).toBeCloseTo(10, 10);
  });

  it('G01 全局伤害倍率同时作用于盾击与追加法伤', () => {
    const target = combatant('scaled', origin.x + 50, origin.y);
    const hits = resolveShieldBash(
      origin,
      'east',
      [{ combatant: target }],
      SARIA.attack,
      1.12,
      { bonusMagicDamage: 10, magicDamageMultiplier: () => 1.3 },
    );
    const hit = hits[0];
    expect(hit).toBeDefined();
    expect(hit?.result.damage).toBeCloseTo(26 * 1.12, 10);
    expect(hit?.bonusMagicResult?.damage).toBeCloseTo(10 * 1.12 * 1.3, 10);
  });
});

describe('塞雷娅场景接入', () => {
  it('开发环境可用 ?character=saria 切换，并接入盾击/急救/护盾 HUD', () => {
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );

    expect(sceneSource).toContain('SariaCombat');
    expect(sceneSource).toContain('resolveShieldBash');
    expect(sceneSource).toContain('createSariaCombat');
    expect(sceneSource).toContain('castFirstAid');
    expect(sceneSource).toContain('castCalciumField');
    expect(sceneSource).toContain('performShieldBash');
    expect(sceneSource).toContain('enemySystem.knockback');
    expect(sceneSource).toContain('isInsideCalciumField');
    expect(sceneSource).toContain('calciumFieldSlowMultiplier');
    expect(sceneSource).toContain('calciumFieldMagicMultiplier');
    expect(sceneSource).toContain('attackBonusMagicDamage');
    expect(sceneSource).toContain('syncCalciumFieldVisual');
    expect(sceneSource).toContain('ASSET_KEYS.playerSaria');
    expect(sceneSource).toContain('syncHealthHud');
    expect(sceneSource).toContain('saria.step');
    expect(sceneSource).toContain("'saria'");
  });
});

describe('I15 技能持续时间倍率', () => {
  it('只延长钙质化领域持续时间', () => {
    const combat = createSariaCombat();
    const base = SARIA.skillL.durationSeconds ?? 0;
    combat.setDurationMultiplier(1.15);
    expect(combat.tryActivateL()).toBe(true);
    advance(combat, base * 1.1);
    expect(combat.isCalciumFieldActive).toBe(true);
    advance(combat, base * 0.1);
    expect(combat.isCalciumFieldActive).toBe(false);
  });
});
