import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArenaLayout, isCircleBlocked } from '../src/game/arena';
import { Combatant, type DamageResult } from '../src/game/combat';
import {
  E04_PHANTOM_DAMAGE_RATIO,
  E04_PHANTOM_DURATION_SECONDS,
  E04_PHANTOM_INTERVAL_SECONDS,
  E04_SUMMON_DAMAGE_BONUS,
} from '../src/game/core-effects';
import { getCharacter, getEnemy } from '../src/game/data';
import { EnemySystem } from '../src/game/enemy';
import {
  BOSS_CONTROL_DURATION_RATIO,
  BOSS_CONTROL_SLOW_MULTIPLIER,
  MUELSYSE_RETURN_DISTANCE,
  MuelsyseCombat,
  resolveFormReturnPoint,
  type MuelsyseCopyConfig,
  type MuelsyseStepContext,
} from '../src/game/muelsyse';

const ROOT = process.cwd();
const STEP = 1 / 60;
const MUELSYSE = getCharacter('muelsyse');
const SKILL_L = MUELSYSE.skillL;
const L_PARAMS = SKILL_L.params ?? {};

function createCombat(
  overrides: Partial<{
    returnDistance: number;
    copies: Partial<MuelsyseCopyConfig>;
  }> = {},
): MuelsyseCombat {
  const params = MUELSYSE.skillK.params ?? {};
  return new MuelsyseCombat({
    switchCooldownSeconds: MUELSYSE.skillK.cooldownSeconds,
    melee: {
      maxHealth: params.meleeHealth ?? 0,
      attackRange: params.meleeRange ?? 0,
      attackIntervalSeconds: params.meleeIntervalSeconds ?? 0,
      damage: params.meleeDamage ?? 0,
      damageType: 'physical',
      stackDamagePerHit: params.meleeStackDamage ?? 0,
      stackArmorPerHit: params.meleeStackArmor ?? 0,
      maxStacks: params.meleeMaxStacks ?? 0,
    },
    ranged: {
      maxHealth: params.rangedHealth ?? 0,
      attackRange: params.rangedRange ?? 0,
      attackIntervalSeconds: params.rangedIntervalSeconds ?? 0,
      damage: params.rangedDamage ?? 0,
      damageType: 'magic',
    },
    copies: {
      everyAttacks: params.rangedCopyEveryAttacks ?? 0,
      durationSeconds: params.rangedCopyDurationSeconds ?? 0,
      damageRatio: params.rangedCopyDamageRatio ?? 0,
      maxCopies: params.rangedMaxCopies ?? 0,
      ...overrides.copies,
    },
    shallowAdaptation: {
      cooldownSeconds: SKILL_L.cooldownSeconds,
      durationSeconds: SKILL_L.durationSeconds ?? 0,
      pullIntervalSeconds: L_PARAMS.pullIntervalSeconds ?? 0,
      pullRadius: L_PARAMS.pullRadius ?? 0,
      pullDistance: L_PARAMS.pullDistance ?? 0,
      stunSeconds: L_PARAMS.stunSeconds ?? 0,
      rootSeconds: L_PARAMS.rootSeconds ?? 0,
    },
    layout: createArenaLayout(),
    startX: 720,
    startY: 480,
    returnDistance: overrides.returnDistance,
  });
}

function context(player: { x: number; y: number }, targets: Combatant[] = []): MuelsyseStepContext {
  return { player, targets };
}

function advance(
  combat: MuelsyseCombat,
  seconds: number,
  ctx: MuelsyseStepContext,
): { attacks: number; teleported: boolean } {
  const steps = Math.round(seconds / STEP);
  let attacks = 0;
  let teleported = false;
  for (let step = 0; step < steps; step += 1) {
    const result = combat.step(STEP, ctx);
    attacks += result.attacks.length;
    teleported = teleported || result.teleported;
  }
  return { attacks, teleported };
}

function combatant(id: string, x: number, y: number, maxHealth = 1000): Combatant {
  return new Combatant({ id, x, y, radius: 12, maxHealth });
}

describe('缪尔赛思基础数值与初始近战流形', () => {
  it('生命 125、护甲 5、法抗 10%、移速 175，J 每 0.55 秒 18 法伤射程 250', () => {
    expect(MUELSYSE).toMatchObject({
      maxHealth: 125,
      armor: 5,
      magicResist: 0.1,
      moveSpeed: 175,
      radius: 12,
    });
    expect(MUELSYSE.attack).toMatchObject({
      intervalSeconds: 0.55,
      range: 250,
      damage: 18,
      damageType: 'magic',
    });
    expect(MUELSYSE.skillK).toMatchObject({ cooldownSeconds: 6 });
  });

  it('开局自带近战流形：90 生命、射程 90、0.7 秒 16 物伤', () => {
    const combat = createCombat();
    expect(combat.form).toBe('melee');
    expect(combat.isFormAlive).toBe(true);
    expect(combat.formHealth).toBe(90);
    expect(combat.formMaxHealth).toBe(90);
    expect(combat.formStacks).toBe(0);
    expect(combat.formArmor).toBe(0);
    expect(combat.attackRange).toBe(90);
    expect(combat.attackIntervalSeconds).toBeCloseTo(0.7, 10);
    expect(combat.attackDamageType).toBe('physical');
    expect(combat.formDamage).toBe(16);
  });

  it('近战流形只攻击 90 范围内目标的最近者，边界包含', () => {
    const combat = createCombat();
    const origin = combat.formPosition;
    const inside = combatant('inside', origin.x + 90, origin.y);
    const outside = combatant('outside', origin.x + 91, origin.y);

    const first = combat.step(STEP, context({ x: 720, y: 480 }, [outside, inside]));
    expect(first.attacks.map((attack) => attack.targetId)).toEqual(['inside']);
    expect(first.attacks[0]?.result.damage).toBeCloseTo(16, 10);
    expect(outside.health.health).toBe(1000);

    // 再次推进不会命中范围外目标。
    const second = combat.step(STEP, context({ x: 720, y: 480 }, [outside]));
    expect(second.attacks).toHaveLength(0);
    expect(outside.health.health).toBe(1000);
  });

  it('近战攻击间隔 0.7 秒：1 秒内攻击 2 次', () => {
    const combat = createCombat();
    const origin = combat.formPosition;
    const target = combatant('target', origin.x + 50, origin.y);
    const result = advance(combat, 1, context({ x: 720, y: 480 }, [target]));
    expect(result.attacks).toBe(2);
    // 第一次 16，命中后 +1 层使第二次为 18。
    expect(target.health.health).toBeCloseTo(1000 - 16 - 18, 10);
  });
});

describe('缪尔赛思近战窃取层数', () => {
  it('每次命中 +2 伤害/+2 护甲，最多 5 层后不再增加', () => {
    const combat = createCombat();
    const origin = combat.formPosition;
    const target = combatant('target', origin.x + 50, origin.y);
    const damages: number[] = [];

    // 4 秒内按 0.7 秒间隔命中 6 次：16/18/20/22/24，封顶后保持 26。
    for (let step = 0; step < 60 * 4 && damages.length < 6; step += 1) {
      const result = combat.step(STEP, context({ x: 720, y: 480 }, [target]));
      for (const attack of result.attacks) damages.push(attack.result.damage);
    }

    expect(damages).toEqual([16, 18, 20, 22, 24, 26]);
    expect(combat.formStacks).toBe(5);
    expect(combat.formArmor).toBe(10);
    expect(combat.formDamage).toBe(26);
  });

  it('切换形态后近战窃取层数从 0 开始', () => {
    const combat = createCombat();
    const origin = combat.formPosition;
    const target = combatant('target', origin.x + 50, origin.y);
    advance(combat, 0.1, context({ x: 720, y: 480 }, [target]));
    expect(combat.formStacks).toBe(1);

    expect(combat.tryActivateK({ x: 720, y: 480 })?.action).toBe('switch');
    expect(combat.form).toBe('ranged');
    expect(combat.formStacks).toBe(0);
  });
});

describe('缪尔赛思 K 塑形切换', () => {
  it('切换保留生命百分比且不治疗', () => {
    const combat = createCombat();
    expect(combat.damageForm(45, 'physical').applied).toBe(true);
    expect(combat.formHealth).toBe(45);

    const switched = combat.tryActivateK({ x: 720, y: 480 });
    expect(switched?.action).toBe('switch');
    expect(switched?.form).toBe('ranged');
    expect(switched?.healthPercent).toBeCloseTo(0.5, 10);
    expect(combat.formHealth).toBeCloseTo(30, 10);
    expect(combat.formMaxHealth).toBe(60);
    expect(combat.kCooldownRemaining).toBeCloseTo(6, 10);
    // 冷却中不能连续切换。
    expect(combat.tryActivateK({ x: 720, y: 480 })).toBeNull();

    advance(combat, 6, context({ x: 720, y: 480 }));
    const back = combat.tryActivateK({ x: 720, y: 480 });
    expect(back?.form).toBe('melee');
    // 30/60 = 50% → 45/90；切换不额外回复生命。
    expect(combat.formHealth).toBeCloseTo(45, 10);
    expect(combat.formMaxHealth).toBe(90);
  });

  it('远程流形：60 生命、射程 230、0.8 秒 14 法伤', () => {
    const combat = createCombat();
    combat.tryActivateK({ x: 720, y: 480 });
    expect(combat.form).toBe('ranged');
    expect(combat.formHealth).toBe(60);
    expect(combat.formMaxHealth).toBe(60);
    expect(combat.attackRange).toBe(230);
    expect(combat.attackIntervalSeconds).toBeCloseTo(0.8, 10);
    expect(combat.attackDamageType).toBe('magic');
    expect(combat.formDamage).toBe(14);

    const origin = combat.formPosition;
    const inside = combatant('inside', origin.x + 230, origin.y);
    const outside = combatant('outside', origin.x + 231, origin.y);
    const result = combat.step(STEP, context({ x: 720, y: 480 }, [inside, outside]));
    expect(result.attacks.map((attack) => attack.targetId)).toEqual(['inside']);
    expect(result.attacks[0]?.result.damage).toBeCloseTo(14, 10);

    advance(combat, 0.8, context({ x: 720, y: 480 }, [inside]));
    // 0.8 秒后第二次攻击；远程不累计窃取层数。
    expect(combat.formStacks).toBe(0);
  });

  it('G01 伤害倍率作用于主流形攻击，G03 倍率作用于 K 冷却', () => {
    const combat = createCombat();
    const origin = combat.formPosition;
    const target = combatant('target', origin.x + 50, origin.y);
    const result = combat.step(STEP, {
      player: { x: 720, y: 480 },
      targets: [target],
      damageMultiplier: 1.12,
    });
    expect(result.attacks[0]?.result.damage).toBeCloseTo(16 * 1.12, 10);

    combat.setCooldownMultiplier(0.5);
    // 先等第一段攻击间隔结束，切换本身与攻击计时无关。
    combat.tryActivateK({ x: 720, y: 480 });
    expect(combat.kCooldownRemaining).toBeCloseTo(3, 10);
  });
});

describe('缪尔赛思流形重建', () => {
  it('流形死亡后 K 重建当前形态，满血且窃取层数清零', () => {
    const combat = createCombat();
    const origin = combat.formPosition;
    const target = combatant('target', origin.x + 50, origin.y);
    advance(combat, 0.1, context({ x: 720, y: 480 }, [target]));
    expect(combat.formStacks).toBeGreaterThan(0);

    expect(combat.damageForm(1000, 'true').died).toBe(true);
    expect(combat.isFormAlive).toBe(false);
    expect(combat.formHealth).toBe(0);

    const rebuilt = combat.tryActivateK({ x: 720, y: 480 });
    expect(rebuilt?.action).toBe('rebuild');
    expect(rebuilt?.form).toBe('melee');
    expect(combat.isFormAlive).toBe(true);
    expect(combat.formHealth).toBe(90);
    expect(combat.formStacks).toBe(0);
    expect(combat.kCooldownRemaining).toBeCloseTo(6, 10);
  });

  it('死亡时重建忽略剩余冷却，但重建后才开始新的 6 秒冷却', () => {
    const combat = createCombat();
    expect(combat.tryActivateK({ x: 720, y: 480 })?.action).toBe('switch');
    expect(combat.kCooldownRemaining).toBeCloseTo(6, 10);

    combat.damageForm(1000, 'true');
    const rebuilt = combat.tryActivateK({ x: 720, y: 480 });
    expect(rebuilt?.action).toBe('rebuild');
    expect(combat.form).toBe('ranged');
    expect(combat.kCooldownRemaining).toBeCloseTo(6, 10);
    expect(combat.tryActivateK({ x: 720, y: 480 })).toBeNull();

    advance(combat, 6, context({ x: 720, y: 480 }));
    expect(combat.tryActivateK({ x: 720, y: 480 })?.action).toBe('switch');
  });

  it('流形护甲按窃取层数减免物理伤害，死亡后不再重复结算', () => {
    const combat = createCombat();
    const origin = combat.formPosition;
    const target = combatant('target', origin.x + 50, origin.y);
    advance(combat, 0.1, context({ x: 720, y: 480 }, [target]));
    expect(combat.formArmor).toBe(2);

    const hit = combat.damageForm(10, 'physical');
    // 10 × 100 / (100 + 2) ≈ 9.804。
    expect(hit.damage).toBeCloseTo(10 * (100 / 102), 10);
    expect(combat.formHealth).toBeCloseTo(90 - 10 * (100 / 102), 10);

    combat.damageForm(1000, 'true');
    const again = combat.damageForm(10, 'physical');
    expect(again.applied).toBe(false);
    expect(again.died).toBe(false);
  });
});

describe('缪尔赛思跟随与回位', () => {
  it('距离玩家超过 240 时回到身边空位且不卡墙', () => {
    const combat = createCombat();
    const before = combat.formPosition;
    const farPlayer = { x: before.x + 300, y: before.y };
    const result = combat.step(STEP, context(farPlayer));
    expect(result.teleported).toBe(true);

    const after = combat.formPosition;
    expect(Math.hypot(after.x - farPlayer.x, after.y - farPlayer.y)).toBeLessThanOrEqual(53);
    expect(isCircleBlocked(createArenaLayout(), after.x, after.y, combat.formRadius)).toBe(false);
    expect(MUELSYSE_RETURN_DISTANCE).toBe(240);
  });

  it('玩家靠墙时回位点仍是可站立空位', () => {
    const layout = createArenaLayout();
    const point = resolveFormReturnPoint(layout, { x: 40, y: 40 }, 12, 52);
    expect(isCircleBlocked(layout, point.x, point.y, 12)).toBe(false);
  });

  it('跟随移动不穿墙，被掩体遮断时绕行并最终到位', () => {
    // 提高回位阈值，让流形必须自己绕过掩体而不是瞬移。
    const combat = createCombat({ returnDistance: 2000 });
    const layout = createArenaLayout();
    const hiddenPlayer = { x: 440, y: 260 };
    const ctx = context(hiddenPlayer);

    for (let step = 0; step < 600; step += 1) {
      combat.step(STEP, ctx);
      const position = combat.formPosition;
      expect(
        isCircleBlocked(layout, position.x, position.y, combat.formRadius),
        `第 ${step} 步流形不应进入墙体/掩体`,
      ).toBe(false);
    }

    const position = combat.formPosition;
    // 玩家左侧 52 像素是跟随站位；绕行后应稳定在附近。
    expect(Math.hypot(position.x - (hiddenPlayer.x - 52), position.y - hiddenPlayer.y)).toBeLessThan(
      40,
    );
  });
});

describe('缪尔赛思与敌人接触', () => {
  it('更近的主流形会替代玩家承受追击敌人的接触伤害', () => {
    const layout = createArenaLayout();
    const enemies = new EnemySystem({ layout });
    const chaser = enemies.addEnemy(getEnemy('blob'), 610, 480);
    const summon = { x: 600, y: 480, radius: 12, isAlive: true };
    let summonDamage = 0;

    const result = enemies.step(STEP, {
      player: { x: 720, y: 480, radius: 12, isInvulnerable: false },
      applyPlayerDamage: () => {
        throw new Error('追击者应优先攻击更近的流形');
      },
      summon,
      applySummonDamage: (rawDamage): DamageResult => {
        summonDamage += rawDamage;
        return {
          applied: true,
          rawDamage,
          damage: rawDamage,
          shieldAbsorbed: 0,
          healthLost: rawDamage,
          died: false,
          health: 90 - summonDamage,
          shield: 0,
        };
      },
    });

    expect(result.summonHits).toHaveLength(1);
    expect(result.summonHits[0]?.enemyId).toBe(chaser.id);
    expect(summonDamage).toBe(8);
    expect(result.contactHits).toHaveLength(0);
  });
});

describe('缪尔赛思远程副本分裂', () => {
  it('远程每 8 次攻击生成一个持续 5 秒、伤害 50% 的副本', () => {
    const combat = createCombat();
    expect(combat.tryActivateK({ x: 720, y: 480 })?.form).toBe('ranged');
    const origin = combat.formPosition;
    const target = combatant('target', origin.x + 120, origin.y, 100000);
    const ctx = context({ x: 720, y: 480 }, [target]);

    let formAttacks = 0;
    let copyDamage: number | null = null;
    let spawnedStep = -1;
    for (let step = 0; step < 60 * 8 && spawnedStep < 0; step += 1) {
      const result = combat.step(STEP, ctx);
      for (const attack of result.attacks) {
        if (attack.source === 'form') formAttacks += 1;
        else if (copyDamage === null) copyDamage = attack.result.damage;
      }
      if (result.spawnedCopies > 0) spawnedStep = step;
    }

    expect(formAttacks).toBe(8);
    expect(spawnedStep).toBeGreaterThanOrEqual(0);
    expect(combat.copyCount).toBe(1);
    expect(combat.maxCopies).toBe(1);
    // 副本伤害为主流形远程伤害的 50%：14 × 0.5 = 7。
    expect(copyDamage).toBeCloseTo(7, 10);

    // 5 秒寿命到期后副本消失；期间主流形最多再攻击 6 次，不会补出新副本。
    for (let step = 0; step < 60 * 5 + 2; step += 1) combat.step(STEP, ctx);
    expect(combat.copyCount).toBe(0);
  });

  it('默认副本上限为 1：长时间存活时 16 次攻击仍只有一个副本', () => {
    // 拉长寿命以观察上限，而不是等第一个副本自然消失。
    const combat = createCombat({ copies: { durationSeconds: 60 } });
    combat.tryActivateK({ x: 720, y: 480 });
    const origin = combat.formPosition;
    const target = combatant('target', origin.x + 120, origin.y, 100000);
    const ctx = context({ x: 720, y: 480 }, [target]);

    let formAttacks = 0;
    let spawnedTotal = 0;
    for (let step = 0; step < 60 * 14; step += 1) {
      const result = combat.step(STEP, ctx);
      formAttacks += result.attacks.filter((attack) => attack.source === 'form').length;
      spawnedTotal += result.spawnedCopies;
    }

    expect(formAttacks).toBeGreaterThanOrEqual(16);
    expect(spawnedTotal).toBe(1);
    expect(combat.copyCount).toBe(1);
  });

  it('切换近战立即移除副本，反复切换副本总量不增长', () => {
    const combat = createCombat({ copies: { durationSeconds: 60 } });
    const player = { x: 720, y: 480 };
    const origin = resolveFormReturnPoint(createArenaLayout(), player, 12, 52);
    const target = combatant('target', origin.x + 120, origin.y, 100000);
    const ctx = context(player, [target]);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      if (combat.form !== 'ranged') {
        // 等 K 冷却结束后切远程。
        for (let step = 0; step < 60 * 7; step += 1) combat.step(STEP, ctx);
        expect(combat.tryActivateK(player)?.form).toBe('ranged');
      }
      for (let step = 0; step < 60 * 8 && combat.copyCount === 0; step += 1) {
        combat.step(STEP, ctx);
      }
      expect(combat.copyCount).toBe(1);

      // 切近战需要 K 冷却就绪。
      for (let step = 0; step < 60 * 7; step += 1) combat.step(STEP, ctx);
      expect(combat.tryActivateK(player)?.form).toBe('melee');
      expect(combat.copyCount).toBe(0);
    }
    expect(combat.copyCount).toBeLessThanOrEqual(combat.maxCopies);
  });

  it('重开后没有残留副本与控制状态', () => {
    const combat = createCombat({ copies: { durationSeconds: 60 } });
    combat.tryActivateK({ x: 720, y: 480 });
    const origin = combat.formPosition;
    const target = combatant('target', origin.x + 120, origin.y, 100000);
    const ctx = context({ x: 720, y: 480 }, [target]);
    for (let step = 0; step < 60 * 8; step += 1) combat.step(STEP, ctx);
    expect(combat.copyCount).toBe(1);
    combat.tryActivateL();
    for (let step = 0; step < 10; step += 1) combat.step(STEP, ctx);
    expect(combat.enemyRootRemaining('target')).toBeGreaterThan(0);

    // 场景重开 = 新建一份战斗状态；召唤物与临时控制都必须归零。
    const restarted = createCombat();
    expect(restarted.copyCount).toBe(0);
    expect(restarted.copies).toEqual([]);
    expect(restarted.enemyStunRemaining('target')).toBe(0);
    expect(restarted.enemyRootRemaining('target')).toBe(0);
    expect(restarted.enemySlowRemaining('target')).toBe(0);
  });
});

describe('缪尔赛思 L 浅层非熵适应', () => {
  it('冷却 24 秒、持续 6 秒；近战每 2 秒拉近并眩晕半径 100 内普通敌人', () => {
    const combat = createCombat();
    expect(combat.form).toBe('melee');
    const origin = combat.formPosition;
    const inside = combatant('inside', origin.x + 80, origin.y, 100000);
    const boundary = combatant('boundary', origin.x, origin.y + 100, 100000);
    const outside = combatant('outside', origin.x + 101, origin.y, 100000);
    const ctx = context({ x: 720, y: 480 }, [inside, boundary, outside]);

    const activation = combat.tryActivateL();
    expect(activation).toEqual({
      activated: true,
      form: 'melee',
      refreshedCopies: 0,
    });
    expect(combat.lCooldownRemaining).toBeCloseTo(24, 10);
    expect(combat.isShallowAdaptationActive).toBe(true);

    const batches: { targetId: string; distance: number; stunSeconds: number }[][] = [];
    for (let step = 0; step < 60 * 6; step += 1) {
      const result = combat.step(STEP, ctx);
      if (result.pulls.length === 0) continue;
      batches.push(
        result.pulls.map((pull) => ({
          targetId: pull.targetId,
          distance: pull.distance,
          stunSeconds: pull.stunSeconds,
        })),
      );
      // 触发当步即可查询到 0.5 秒眩晕（随后逐步衰减）。
      expect(combat.enemyStunRemaining('inside')).toBeGreaterThan(0.45);
    }

    // 6 秒内每 2 秒一批，共 3 批；半径 100 含边界，101 不触发。
    expect(batches).toHaveLength(3);
    expect(batches[0]?.map((pull) => pull.targetId).sort()).toEqual(['boundary', 'inside']);
    for (const batch of batches) {
      for (const pull of batch) {
        expect(pull.distance).toBe(35);
        expect(pull.stunSeconds).toBe(0.5);
      }
    }

    expect(combat.isShallowAdaptationActive).toBe(false);
    expect(combat.lCooldownRemaining).toBeCloseTo(18, 5);
  });

  it('无主流形时 L 不消耗冷却并提示先重建', () => {
    const combat = createCombat();
    combat.damageForm(1000, 'true');
    expect(combat.isFormAlive).toBe(false);

    const result = combat.tryActivateL();
    expect(result).toEqual({ activated: false, reason: 'no-form' });
    expect(combat.lCooldownRemaining).toBe(0);
    expect(combat.isShallowAdaptationActive).toBe(false);

    // 重建后才可正常启动 L。
    expect(combat.tryActivateK({ x: 720, y: 480 })?.action).toBe('rebuild');
    expect(combat.tryActivateL()).toEqual({
      activated: true,
      form: 'melee',
      refreshedCopies: 0,
    });
    expect(combat.lCooldownRemaining).toBeCloseTo(24, 10);
  });

  it('Boss 免疫拉拽，眩晕按 30% 持续时间转为减速', () => {
    const combat = createCombat();
    const origin = combat.formPosition;
    const boss = combatant('boss', origin.x + 60, origin.y, 100000);
    const ctx: MuelsyseStepContext = {
      player: { x: 720, y: 480 },
      targets: [boss],
      isBoss: (id) => id === 'boss',
    };

    expect(combat.tryActivateL().activated).toBe(true);
    let slowSeen = 0;
    let pullCount = 0;
    for (let step = 0; step < 60 * 2 + 2; step += 1) {
      const result = combat.step(STEP, ctx);
      pullCount += result.pulls.length;
      slowSeen = Math.max(slowSeen, combat.enemySlowRemaining('boss'));
    }

    expect(pullCount).toBe(0);
    expect(slowSeen).toBeCloseTo(0.5 * BOSS_CONTROL_DURATION_RATIO, 5);
    expect(BOSS_CONTROL_DURATION_RATIO).toBe(0.3);
    expect(combat.enemySlowMultiplier('boss')).toBe(BOSS_CONTROL_SLOW_MULTIPLIER);
    // 0.15 秒后减速结束，恢复原速。
    for (let step = 0; step < 20; step += 1) combat.step(STEP, ctx);
    expect(combat.enemySlowRemaining('boss')).toBe(0);
    expect(combat.enemySlowMultiplier('boss')).toBe(1);
  });

  it('远程 L 刷新副本寿命，主流形命中束缚 0.5 秒', () => {
    const combat = createCombat();
    const player = { x: 720, y: 480 };
    combat.tryActivateK(player);
    const origin = combat.formPosition;
    const target = combatant('target', origin.x + 120, origin.y, 100000);
    const ctx = context(player, [target]);

    for (let step = 0; step < 60 * 8 && combat.copyCount === 0; step += 1) {
      combat.step(STEP, ctx);
    }
    expect(combat.copyCount).toBe(1);
    // 消耗一部分寿命，L 启动后应刷新回 5 秒。
    for (let step = 0; step < 60 * 2; step += 1) combat.step(STEP, ctx);
    expect(combat.copies[0]?.remainingSeconds).toBeLessThan(5);

    const activation = combat.tryActivateL();
    expect(activation).toEqual({
      activated: true,
      form: 'ranged',
      refreshedCopies: 1,
    });
    expect(combat.copies[0]?.remainingSeconds).toBeCloseTo(5, 10);
    // 等下一次攻击（间隔 0.8 秒）；命中应附加束缚。
    let rootApplied = false;
    for (let step = 0; step < Math.round(0.9 / STEP); step += 1) {
      const result = combat.step(STEP, ctx);
      if (result.attacks.some((attack) => attack.control === 'root')) {
        rootApplied = true;
        break;
      }
    }
    expect(rootApplied).toBe(true);
    expect(combat.enemyRootRemaining('target')).toBeGreaterThan(0.4);

    // 0.5 秒后束缚结束，且下一次攻击尚未到来。
    for (let step = 0; step < Math.round(0.6 / STEP); step += 1) combat.step(STEP, ctx);
    expect(combat.enemyRootRemaining('target')).toBe(0);
  });

  it('远程 L 对 Boss 的束缚转为 0.15 秒减速', () => {
    const combat = createCombat();
    const player = { x: 720, y: 480 };
    combat.tryActivateK(player);
    const origin = combat.formPosition;
    const boss = combatant('boss', origin.x + 120, origin.y, 100000);
    const ctx: MuelsyseStepContext = {
      player,
      targets: [boss],
      isBoss: (id) => id === 'boss',
    };

    expect(combat.tryActivateL().activated).toBe(true);
    const result = combat.step(STEP, ctx);
    const attack = result.attacks.find((entry) => entry.targetId === 'boss');
    expect(attack?.control).toBe('slow');
    expect(combat.enemySlowRemaining('boss')).toBeCloseTo(0.15, 5);
    expect(combat.enemyRootRemaining('boss')).toBe(0);
    expect(combat.enemySlowMultiplier('boss')).toBe(0.5);
  });

  it('进入下一波清空 K/L 冷却并结束浅层非熵适应，形态保留', () => {
    const combat = createCombat();
    const player = { x: 720, y: 480 };
    expect(combat.tryActivateK(player)).not.toBeNull();
    const form = combat.form;
    expect(combat.tryActivateL().activated).toBe(true);
    expect(combat.isShallowAdaptationActive).toBe(true);
    expect(combat.kCooldownRemaining).toBeGreaterThan(0);
    expect(combat.lCooldownRemaining).toBeGreaterThan(0);

    combat.resetForWaveStart();
    expect(combat.form).toBe(form);
    expect(combat.kCooldownRemaining).toBe(0);
    expect(combat.lCooldownRemaining).toBe(0);
    expect(combat.isShallowAdaptationActive).toBe(false);
    // 下一波开始即可重新切换形态与启动 L。
    expect(combat.tryActivateK(player)).not.toBeNull();
    expect(combat.tryActivateL().activated).toBe(true);
  });
});

describe('缪尔赛思场景接入', () => {
  it('开发环境可用 ?character=muelsyse 切换，并接入切换/跟随/自动攻击', () => {
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );

    expect(sceneSource).toContain('MuelsyseCombat');
    expect(sceneSource).toContain('createMuelsyseCombat');
    expect(sceneSource).toContain('castShapeShift');
    expect(sceneSource).toContain('castShallowAdaptation');
    expect(sceneSource).toContain('tryActivateL');
    expect(sceneSource).toContain('stepMuelsyse');
    expect(sceneSource).toContain('syncMuelsyseForm');
    expect(sceneSource).toContain('syncMuelsyseCopies');
    expect(sceneSource).toContain('renderMuelsyseAttack');
    expect(sceneSource).toContain('pullToward');
    expect(sceneSource).toContain('isRooted');
    expect(sceneSource).toContain('getMuelsyseCopies');
    expect(sceneSource).toContain('applySummonDamage');
    expect(sceneSource).toContain('ASSET_KEYS.playerMuelsyse');
    expect(sceneSource).toContain('ASSET_PATHS.playerMuelsyse');
    expect(sceneSource).toContain("'muelsyse'");
    expect(sceneSource).toContain('getMuelsyseForm');
  });
});

describe('E04 群落意志', () => {
  it('获得后 8 秒复制幻影，4 秒后消失，循环复制且同时只有 1 个', () => {
    const combat = createCombat();
    combat.setCorePhantom(true);
    const ctx = context({ x: 720, y: 480 }, []);

    advance(combat, E04_PHANTOM_INTERVAL_SECONDS - 0.3, ctx);
    expect(combat.corePhantom).toBeNull();

    advance(combat, 0.4, ctx);
    expect(combat.corePhantom).not.toBeNull();
    const first = combat.corePhantom;
    expect(first?.remainingSeconds).toBeLessThanOrEqual(
      E04_PHANTOM_DURATION_SECONDS,
    );

    // 4 秒寿命结束后消失；再过 8 秒重新复制。
    advance(combat, E04_PHANTOM_DURATION_SECONDS - 0.2, ctx);
    expect(combat.corePhantom).not.toBeNull();
    advance(combat, 0.3, ctx);
    expect(combat.corePhantom).toBeNull();

    // 下一次复制发生在首次生成后第 16 秒；生命周期仍为 4 秒。
    advance(combat, 3.9, ctx);
    expect(combat.corePhantom).not.toBeNull();
    advance(combat, E04_PHANTOM_DURATION_SECONDS + 0.2, ctx);
    expect(combat.corePhantom).toBeNull();
  });

  it('幻影伤害为主召唤物 30%，并叠加 E04 的 +20% 召唤物伤害', () => {
    const combat = createCombat();
    combat.setCoreSummonBonus(1 + E04_SUMMON_DAMAGE_BONUS);
    combat.setCorePhantom(true);
    const player = { x: 720, y: 480 };
    advance(combat, E04_PHANTOM_INTERVAL_SECONDS, context(player, []));

    const phantom = combat.corePhantom;
    expect(phantom).not.toBeNull();
    if (!phantom) return;

    const target = combatant('phantom-target', phantom.x, phantom.y, 1_000_000);
    const attacks: { copyId?: string; damage: number }[] = [];
    for (let step = 0; step < 30; step += 1) {
      for (const attack of combat.step(STEP, context(player, [target])).attacks) {
        attacks.push({ copyId: attack.copyId, damage: attack.result.damage });
      }
    }

    const phantomAttacks = attacks.filter((attack) => attack.copyId === 'core-phantom');
    expect(phantomAttacks.length).toBeGreaterThan(0);
    const expected =
      combat.formDamage * E04_PHANTOM_DAMAGE_RATIO * (1 + E04_SUMMON_DAMAGE_BONUS);
    for (const attack of phantomAttacks) {
      expect(attack.damage).toBeCloseTo(expected, 10);
    }
  });

  it('关闭核心时立即清除幻影，重新开启从头计时', () => {
    const combat = createCombat();
    combat.setCorePhantom(true);
    const ctx = context({ x: 720, y: 480 }, []);
    advance(combat, E04_PHANTOM_INTERVAL_SECONDS + 0.1, ctx);
    expect(combat.corePhantom).not.toBeNull();

    combat.setCorePhantom(false);
    expect(combat.corePhantom).toBeNull();

    combat.setCorePhantom(true);
    advance(combat, E04_PHANTOM_INTERVAL_SECONDS - 0.2, ctx);
    expect(combat.corePhantom).toBeNull();
  });

  it('E04 的 +20% 同时作用于主流形本体攻击', () => {
    const base = createCombat();
    const boosted = createCombat();
    boosted.setCoreSummonBonus(1 + E04_SUMMON_DAMAGE_BONUS);

    const basePosition = base.formPosition;
    const boostedPosition = boosted.formPosition;
    const baseTarget = combatant('a', basePosition.x, basePosition.y, 1_000_000);
    const boostedTarget = combatant(
      'b',
      boostedPosition.x,
      boostedPosition.y,
      1_000_000,
    );

    const baseAttack = base.step(
      STEP,
      context({ x: 720, y: 480 }, [baseTarget]),
    ).attacks[0];
    const boostedAttack = boosted.step(
      STEP,
      context({ x: 720, y: 480 }, [boostedTarget]),
    ).attacks[0];

    expect(baseAttack?.result.damage).toBeCloseTo(16, 10);
    expect(boostedAttack?.result.damage).toBeCloseTo(
      16 * (1 + E04_SUMMON_DAMAGE_BONUS),
      10,
    );
  });
});

describe('I19/I20 召唤物道具', () => {
  it('I19 召唤物伤害 +18% 只作用于召唤物攻击', () => {
    const baseline = createCombat();
    const boosted = createCombat();
    boosted.setSummonDamageMultiplier(1.18);
    const baseOrigin = baseline.formPosition;
    const boostedOrigin = boosted.formPosition;
    const target = new Combatant({
      id: 'target',
      x: baseOrigin.x + 30,
      y: baseOrigin.y,
      radius: 12,
      maxHealth: 1000,
    });
    const baseStep = baseline.step(STEP, context({ x: 720, y: 480 }, [target]));
    const boostedTarget = new Combatant({
      id: 'target',
      x: boostedOrigin.x + 30,
      y: boostedOrigin.y,
      radius: 12,
      maxHealth: 1000,
    });
    const boostedStep = boosted.step(
      STEP,
      context({ x: 720, y: 480 }, [boostedTarget]),
    );
    expect(baseStep.attacks).toHaveLength(1);
    expect(boostedStep.attacks).toHaveLength(1);
    const baseDamage = baseStep.attacks[0]?.result.damage ?? 0;
    const boostedDamage = boostedStep.attacks[0]?.result.damage ?? 0;
    expect(baseDamage).toBeGreaterThan(0);
    expect(boostedDamage).toBeCloseTo(baseDamage * 1.18, 12);
  });

  it('I20 召唤物生命 +25%，每秒回复最大生命 1%', () => {
    const combat = createCombat();
    const baseMax = combat.formMaxHealth;
    combat.setSummonHealthMultiplier(1.25);
    expect(combat.formMaxHealth).toBeCloseTo(baseMax * 1.25, 12);

    combat.damageForm(30, 'true');
    const before = combat.formHealth;
    combat.setSummonRegenPercentPerSecond(0.01);
    const result = combat.step(1, context({ x: 720, y: 480 }, []));
    expect(result.formHealed).toBeCloseTo(combat.formMaxHealth * 0.01, 12);
    expect(combat.formHealth).toBeCloseTo(before + combat.formMaxHealth * 0.01, 12);

    // 关闭后不再回复。
    combat.setSummonRegenPercentPerSecond(0);
    const healedOff = combat.step(1, context({ x: 720, y: 480 }, [])).formHealed;
    expect(healedOff).toBe(0);
  });

  it('I19/I20 非法倍率回退为 1/关闭', () => {
    const combat = createCombat();
    const baseMax = combat.formMaxHealth;
    combat.setSummonDamageMultiplier(0);
    combat.setSummonHealthMultiplier(Number.NaN);
    expect(combat.formMaxHealth).toBeCloseTo(baseMax, 12);
  });
});
