import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AmiyaCombat,
  EMOTIONAL_ABSORPTION_COOLDOWN_SECONDS,
  EMOTIONAL_ABSORPTION_HITS,
} from '../src/game/amiya';
import { createArenaLayout } from '../src/game/arena';
import {
  AttackTimer,
  Combatant,
  createProjectile,
  resolveProjectileHit,
  stepProjectile,
} from '../src/game/combat';
import { getCharacter } from '../src/game/data';
import { PlayerMotion } from '../src/game/movement';

const ROOT = process.cwd();
const STEP = 1 / 60;

const AMIYA = getCharacter('amiya');

function createAmiyaCombat(): AmiyaCombat {
  return new AmiyaCombat({
    kCooldownSeconds: AMIYA.skillK.cooldownSeconds,
    burstDurationSeconds: AMIYA.skillK.durationSeconds ?? 0,
    shots: AMIYA.skillK.params?.shots ?? 0,
    damagePerShot: AMIYA.skillK.params?.damagePerShot ?? 0,
    fatigueSeconds: AMIYA.skillK.params?.fatigueSeconds ?? 0,
    burstDamageType: AMIYA.attack.damageType,
    chimeraCooldownSeconds: AMIYA.skillL.cooldownSeconds,
    chimeraDurationSeconds: AMIYA.skillL.durationSeconds ?? 0,
    chimeraDamageBonus: AMIYA.skillL.params?.damageBonus ?? 0,
    weaknessSeconds: AMIYA.skillL.params?.weaknessSeconds ?? 0,
    weaknessMoveSpeedMultiplier:
      AMIYA.skillL.params?.weaknessMoveSpeedMultiplier ?? 1,
  });
}

/** 推进若干固定逻辑步，收集期间发射的全部爆发弹。 */
function runBurst(
  combat: AmiyaCombat,
  steps: number,
  facingAt: (step: number) => 'east' | 'north' = () => 'east',
) {
  const shots: ReturnType<AmiyaCombat['step']>[number][] = [];
  for (let step = 0; step < steps; step += 1) {
    shots.push(...combat.step(STEP, facingAt(step)));
  }
  return shots;
}

describe('阿米娅基础数值', () => {
  it('使用已确认的生命、护甲、法抗与移速', () => {
    expect(AMIYA).toMatchObject({
      maxHealth: 100,
      armor: 0,
      magicResist: 0.15,
      moveSpeed: 165,
      radius: 12,
    });
  });

  it('J 源石术式每 0.4 秒、射程 260、20 法伤，允许空射', () => {
    expect(AMIYA.attack).toMatchObject({
      intervalSeconds: 0.4,
      range: 260,
      damage: 20,
      damageType: 'magic',
    });

    const timer = new AttackTimer(AMIYA.attack.intervalSeconds);
    let shots = 0;
    for (let step = 0; step < 60; step += 1) {
      if (timer.update(STEP, true)) shots += 1;
    }
    // 1 秒内按 0.4 秒间隔发射 3 次（第 0、0.4、0.8 秒），与是否有目标无关。
    expect(shots).toBe(3);
  });

  it('K 精神爆发 9 秒冷却、0.8 秒 6 发、每发 14 法伤', () => {
    const combat = createAmiyaCombat();
    expect(combat.tryActivateK()).toBe(true);
    expect(combat.kCooldownRemaining).toBeCloseTo(9, 10);
    expect(combat.isBurstActive).toBe(true);

    const shots = runBurst(combat, 48);
    expect(shots).toHaveLength(6);
    expect(shots.map((shot) => shot.index)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const shot of shots) expect(shot.damage).toBe(14);
    expect(combat.isBurstActive).toBe(false);
  });

  it('J 与 K 的伤害按法术减免结算，G01 倍率同样生效', () => {
    const target = new Combatant({
      id: 'target',
      x: 100,
      y: 100,
      radius: 12,
      maxHealth: 100,
      magicResist: 0.15,
    });
    const jProjectile = createProjectile(1, { x: 0, y: 100 }, 'east', AMIYA.attack);
    const jResult = resolveProjectileHit(jProjectile, target);
    expect(jResult.damage).toBeCloseTo(17, 10);

    const kAttack = {
      ...AMIYA.attack,
      damage: AMIYA.skillK.params?.damagePerShot ?? 0,
    };
    const kProjectile = createProjectile(2, { x: 0, y: 100 }, 'east', kAttack);
    const kResult = resolveProjectileHit(kProjectile, target);
    expect(kResult.damage).toBeCloseTo(11.9, 10);

    const boosted = new Combatant({
      id: 'boosted',
      x: 100,
      y: 100,
      maxHealth: 100,
      magicResist: 0.15,
    });
    expect(resolveProjectileHit(jProjectile, boosted, 1.12).damage).toBeCloseTo(19.04, 10);
  });
});

describe('阿米娅情绪吸收', () => {
  it('每 5 次 J 命中使 K 剩余冷却减少 1 秒', () => {
    const combat = createAmiyaCombat();
    combat.tryActivateK();
    combat.step(1, 'east'); // 结束爆发，K 冷却由 9 降到 8
    expect(combat.kCooldownRemaining).toBeCloseTo(8, 10);

    for (let id = 1; id <= 4; id += 1) {
      const event = combat.registerJHit(id);
      expect(event.counted).toBe(true);
      expect(event.cooldownReducedSeconds).toBe(0);
    }
    expect(combat.emotionalAbsorptionProgress).toBe(4);

    const fifth = combat.registerJHit(5);
    expect(fifth.counted).toBe(true);
    expect(fifth.totalHits).toBe(EMOTIONAL_ABSORPTION_HITS);
    expect(fifth.progress).toBe(0);
    expect(fifth.cooldownReducedSeconds).toBeCloseTo(
      EMOTIONAL_ABSORPTION_COOLDOWN_SECONDS,
      10,
    );
    expect(combat.kCooldownRemaining).toBeCloseTo(7, 10);
  });

  it('同一发穿透多敌只累计一次', () => {
    const combat = createAmiyaCombat();
    combat.tryActivateK();
    combat.step(1, 'east');
    const before = combat.kCooldownRemaining;

    for (let hit = 0; hit < 10; hit += 1) {
      combat.registerJHit(99);
    }

    expect(combat.emotionalAbsorptionHits).toBe(1);
    expect(combat.kCooldownRemaining).toBeCloseTo(before, 10);
  });

  it('K 已就绪时累计命中不会把冷却抬到负数', () => {
    const combat = createAmiyaCombat();
    const event = combat.registerJHit(7);
    expect(event.totalHits).toBe(1);
    expect(combat.kCooldownRemaining).toBe(0);
  });
});

describe('阿米娅精神爆发的面向与弹道', () => {
  it('连射中转身只影响之后发出的弹体', () => {
    const combat = createAmiyaCombat();
    combat.tryActivateK();

    // 前 8 步（0.133 秒）朝东发射前两发，随后转向北。
    const shots = runBurst(combat, 48, (step) => (step < 8 ? 'east' : 'north'));
    expect(shots.map((shot) => shot.facing)).toEqual([
      'east',
      'east',
      'north',
      'north',
      'north',
      'north',
    ]);

    // 已飞出的弹体方向在创建时锁定：转身不影响速度分量。
    const first = shots[0];
    const projectile = createProjectile(
      1,
      { x: 200, y: 200 },
      first?.facing ?? 'east',
      { ...AMIYA.attack, damage: first?.damage ?? 14 },
    );
    const layout = createArenaLayout();
    expect(projectile.vx).toBeGreaterThan(0);
    expect(projectile.vy).toBe(0);
    stepProjectile(projectile, STEP, layout);
    expect(projectile.vx).toBeGreaterThan(0);
    expect(projectile.vy).toBe(0);
    expect(projectile.facing).toBe('east');
  });

  it('目标死亡不会改变已经发射的术式弹道', () => {
    const combat = createAmiyaCombat();
    combat.tryActivateK();
    const shots = runBurst(combat, 10, () => 'north');
    const shot = shots[0];
    const projectile = createProjectile(5, { x: 400, y: 400 }, shot?.facing ?? 'north', {
      ...AMIYA.attack,
      damage: shot?.damage ?? 14,
    });

    const target = new Combatant({ id: 'dying', x: 400, y: 300, maxHealth: 5 });
    target.applyDamage(999, 'true');
    expect(target.isAlive).toBe(false);

    const layout = createArenaLayout();
    stepProjectile(projectile, STEP, layout);
    expect(projectile.vx).toBe(0);
    expect(projectile.vy).toBeLessThan(0);
    expect(projectile.facing).toBe('north');
  });

  it('爆发结束后 0.5 秒不能 J，但不限制移动与闪避', () => {
    const combat = createAmiyaCombat();
    combat.tryActivateK();
    runBurst(combat, 48);
    expect(combat.isBurstActive).toBe(false);
    expect(combat.isJFiringLocked).toBe(true);
    expect(combat.fatigueRemaining).toBeCloseTo(0.5, 10);

    // 疲劳窗口内按住 J 不会发射；疲劳由技能逻辑步推进。
    const timer = new AttackTimer(AMIYA.attack.intervalSeconds);
    for (let step = 0; step < 29; step += 1) {
      combat.step(STEP, 'east');
      if (timer.update(STEP, !combat.isJFiringLocked)) {
        throw new Error(`疲劳窗口内不应发射 J（第 ${step} 步）`);
      }
    }
    expect(combat.isJFiringLocked).toBe(true);
    expect(combat.fatigueRemaining).toBeCloseTo(1 / 60, 10);

    // 0.5 秒到点后解除锁定，下一步即可恢复 J。
    combat.step(STEP, 'east');
    expect(combat.isJFiringLocked).toBe(false);
    expect(timer.update(STEP, true)).toBe(true);

    // 移动与闪避完全不受疲劳影响。
    const layout = createArenaLayout();
    const motion = new PlayerMotion({
      layout,
      moveSpeed: AMIYA.moveSpeed,
      startX: layout.spawn.x,
      startY: layout.spawn.y,
      radius: 12,
    });
    const lockedCombat = createAmiyaCombat();
    lockedCombat.tryActivateK();
    runBurst(lockedCombat, 48);
    expect(lockedCombat.isJFiringLocked).toBe(true);

    motion.pressKey('KeyD');
    const startX = motion.position.x;
    motion.step(STEP);
    expect(motion.position.x).toBeGreaterThan(startX);
    expect(motion.isMoving).toBe(true);

    expect(motion.requestDodge()).toBe(true);
    motion.step(STEP);
    expect(motion.isDodging).toBe(true);
    expect(motion.isInvulnerable).toBe(true);
    // 疲劳只存在于技能逻辑里，运动模块完全没有该状态。
    expect(lockedCombat.isJFiringLocked).toBe(true);
  });
});

describe('阿米娅冷却缩减规则', () => {
  it('G03 在启动 K 冷却时按倍率缩短', () => {
    const combat = createAmiyaCombat();
    combat.setCooldownMultiplier(1 - 0.08 * 2);
    combat.tryActivateK();
    expect(combat.kCooldownRemaining).toBeCloseTo(9 * 0.84, 10);
  });

  it('G08 返还冷却但不低于缩减上限对应的下限', () => {
    const combat = createAmiyaCombat();
    combat.tryActivateK();

    expect(combat.reduceCooldown(2, 5.4)).toBeCloseTo(2, 10);
    expect(combat.kCooldownRemaining).toBeCloseTo(7, 10);
    expect(combat.reduceCooldown(2, 5.4)).toBeCloseTo(1.6, 10);
    expect(combat.kCooldownRemaining).toBeCloseTo(5.4, 10);
    expect(combat.reduceCooldown(2, 5.4)).toBe(0);
    expect(combat.kCooldownRemaining).toBeCloseTo(5.4, 10);
  });

  it('G03 同样缩短奇美拉冷却，G08 的 L 返还遵守 40% 下限', () => {
    const combat = createAmiyaCombat();
    combat.setCooldownMultiplier(1 - 0.08 * 2);
    expect(combat.tryActivateL()).toBe(true);
    expect(combat.lCooldownRemaining).toBeCloseTo(30 * 0.84, 10);

    // 下限为 30×0.6 = 18 秒；返还不低于下限。
    expect(combat.reduceLCooldown(2, 18)).toBeCloseTo(2, 10);
    expect(combat.lCooldownRemaining).toBeCloseTo(23.2, 10);
    expect(combat.reduceLCooldown(20, 18)).toBeCloseTo(5.2, 10);
    expect(combat.lCooldownRemaining).toBeCloseTo(18, 10);
    expect(combat.reduceLCooldown(2, 18)).toBe(0);
    expect(combat.lCooldownRemaining).toBeCloseTo(18, 10);
  });
});

describe('阿米娅奇美拉', () => {
  it('L 冷却 30 秒、持续 8 秒，结束后进入 3 秒虚弱', () => {
    const combat = createAmiyaCombat();
    expect(combat.tryActivateL()).toBe(true);
    expect(combat.isChimeraActive).toBe(true);
    expect(combat.chimeraRemaining).toBe(8);
    expect(combat.lCooldownRemaining).toBe(30);
    expect(combat.isWeaknessActive).toBe(false);
    // 生效期间重复按 L 不重置持续时间。
    expect(combat.tryActivateL()).toBe(false);

    for (let step = 0; step < 8 * 60; step += 1) combat.step(STEP, 'east');
    expect(combat.isChimeraActive).toBe(false);
    expect(combat.isWeaknessActive).toBe(true);
    expect(combat.weaknessRemaining).toBeCloseTo(3, 10);
    expect(combat.lCooldownRemaining).toBeCloseTo(22, 10);
  });

  it('J 在奇美拉期间转为真实伤害且伤害 +60%，结束后恢复法伤', () => {
    const combat = createAmiyaCombat();
    const normal = combat.modifyAttack(AMIYA.attack);
    expect(normal.damage).toBe(20);
    expect(normal.damageType).toBe('magic');

    combat.tryActivateL();
    const chimera = combat.modifyAttack(AMIYA.attack);
    expect(chimera.damage).toBeCloseTo(32, 10);
    expect(chimera.damageType).toBe('true');

    // 50% 法抗目标：普通 20 法伤结算 10，奇美拉 32 真伤不减免。
    const resisted = new Combatant({
      id: 'resisted',
      x: 100,
      y: 100,
      maxHealth: 200,
      magicResist: 0.5,
    });
    expect(
      resolveProjectileHit(
        createProjectile(1, { x: 0, y: 100 }, 'east', normal),
        resisted,
      ).damage,
    ).toBeCloseTo(10, 10);
    expect(
      resolveProjectileHit(
        createProjectile(2, { x: 0, y: 100 }, 'east', chimera),
        resisted,
      ).damage,
    ).toBeCloseTo(32, 10);

    for (let step = 0; step < 8 * 60; step += 1) combat.step(STEP, 'east');
    const restored = combat.modifyAttack(AMIYA.attack);
    expect(restored.damage).toBe(20);
    expect(restored.damageType).toBe('magic');
  });

  it('K 在奇美拉期间逐发转为真实伤害且每发 +60%', () => {
    const combat = createAmiyaCombat();
    combat.tryActivateL();
    expect(combat.tryActivateK()).toBe(true);

    const shots = runBurst(combat, 48);
    expect(shots).toHaveLength(6);
    for (const shot of shots) {
      expect(shot.empowered).toBe(true);
      expect(shot.damage).toBeCloseTo(14 * 1.6, 10);
      expect(shot.damageType).toBe('true');
    }

    // 控制组：没有奇美拉时为 14 法伤。
    const plain = createAmiyaCombat();
    plain.tryActivateK();
    const plainShots = runBurst(plain, 48);
    for (const shot of plainShots) {
      expect(shot.empowered).toBe(false);
      expect(shot.damage).toBe(14);
      expect(shot.damageType).toBe('magic');
    }
  });

  it('虚弱 3 秒内不能 K/L，但 J 与闪避正常且移速 −25%', () => {
    const combat = createAmiyaCombat();
    combat.tryActivateL();
    for (let step = 0; step < 8 * 60; step += 1) combat.step(STEP, 'east');
    expect(combat.isWeaknessActive).toBe(true);
    expect(combat.moveSpeedMultiplier).toBeCloseTo(0.75, 10);

    expect(combat.tryActivateK()).toBe(false);
    expect(combat.tryActivateL()).toBe(false);
    // 虚弱不设置 J 疲劳，J 仍可正常发射。
    expect(combat.isJFiringLocked).toBe(false);

    const timer = new AttackTimer(AMIYA.attack.intervalSeconds);
    let jShots = 0;
    for (let step = 0; step < 30; step += 1) {
      combat.step(STEP, 'east');
      if (timer.update(STEP, true)) jShots += 1;
    }
    expect(jShots).toBeGreaterThan(0);
    expect(combat.isWeaknessActive).toBe(true);

    // 移动与闪避不受虚弱限制；减速只通过移速倍率体现。
    const layout = createArenaLayout();
    const motion = new PlayerMotion({
      layout,
      moveSpeed: AMIYA.moveSpeed,
      startX: layout.spawn.x,
      startY: layout.spawn.y,
      radius: 12,
    });
    motion.setMoveSpeedMultiplier(combat.moveSpeedMultiplier);
    motion.pressKey('KeyD');
    const startX = motion.position.x;
    motion.step(STEP);
    expect(motion.position.x).toBeGreaterThan(startX);
    expect(motion.requestDodge()).toBe(true);

    for (let step = 0; step < 180; step += 1) combat.step(STEP, 'east');
    expect(combat.isWeaknessActive).toBe(false);
    expect(combat.moveSpeedMultiplier).toBe(1);
    expect(combat.tryActivateK()).toBe(true);
    // L 的 30 秒冷却仍在进行，虚弱结束后不能立刻再次启动。
    expect(combat.tryActivateL()).toBe(false);
  });

  it('暂停不推进计时；死亡/重开清除临时真伤与虚弱', () => {
    const combat = createAmiyaCombat();
    combat.tryActivateL();
    combat.tryActivateK();
    const before = combat.chimeraRemaining;

    // 暂停期间不调用 step：剩余时间不因真实时间流逝而减少。
    expect(combat.chimeraRemaining).toBe(before);
    expect(combat.isChimeraActive).toBe(true);

    combat.step(STEP, 'east');
    expect(combat.chimeraRemaining).toBeCloseTo(before - STEP, 10);

    combat.clearTemporaryEffects();
    expect(combat.isChimeraActive).toBe(false);
    expect(combat.isWeaknessActive).toBe(false);
    expect(combat.isBurstActive).toBe(false);
    expect(combat.isJFiringLocked).toBe(false);
    expect(combat.moveSpeedMultiplier).toBe(1);
    expect(combat.modifyAttack(AMIYA.attack)).toEqual(AMIYA.attack);

    // 重开 = 新实例：冷却、真伤与虚弱均为空。
    const fresh = createAmiyaCombat();
    expect(fresh.isChimeraActive).toBe(false);
    expect(fresh.isWeaknessActive).toBe(false);
    expect(fresh.lCooldownRemaining).toBe(0);
    expect(fresh.kCooldownRemaining).toBe(0);
    expect(fresh.modifyAttack(AMIYA.attack)).toEqual(AMIYA.attack);
  });
});

describe('阿米娅场景接入', () => {
  it('开发环境按 ?character=amiya 切换到阿米娅，并使用同一套系统', () => {
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );

    expect(sceneSource).toContain("get('character')");
    expect(sceneSource).toContain('AmiyaCombat');
    expect(sceneSource).toContain('resolveProjectileHit');
    expect(sceneSource).toContain('registerJHit');
    expect(sceneSource).toContain('isJFiringLocked');
    expect(sceneSource).toContain('createAmiyaCombat');
    expect(sceneSource).toContain('tryActivateL');
    expect(sceneSource).toContain('castChimera');
    expect(sceneSource).toContain('modifyAttack');
    expect(sceneSource).toContain('clearTemporaryEffects');
    expect(sceneSource).toContain('syncChimeraHud');
    expect(sceneSource).toContain('isWeaknessActive');
    expect(sceneSource).toContain('reduceLCooldown');
    expect(sceneSource).toContain('createPlayerAnimations(this.character.id)');
    expect(sceneSource).toContain('ASSET_KEYS.playerAmiya');
    expect(sceneSource).toContain('playerAnimationKey(initialDirection, \'idle\', this.character.id)');
  });
});
