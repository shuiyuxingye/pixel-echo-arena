import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMBAT_HEX_IDS,
  COMBAT_HEX_PARAMS,
  CombatHexEffects,
  EmberTrailState,
  H07_TRIGGER_RULE,
  isCombatHexId,
} from '../src/game/combat-hex-effects';
import {
  beginProjectileReturn,
  createProjectile,
  resolveProjectileHit,
  type ProjectileState,
} from '../src/game/combat';
import { TriggerGate } from '../src/game/trigger-gates';
import { HEX_LIST } from '../src/game/data';

function effectsWith(...hexIds: readonly string[]): CombatHexEffects {
  const owned = new Set(hexIds);
  return new CombatHexEffects({ has: (hexId) => owned.has(hexId) });
}

const SCENE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/game/scenes/ArenaScene.ts'),
  'utf8',
);

function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\n  private ', start + signature.length);
  const nextPublic = source.indexOf('\n  public ', start + signature.length);
  const candidates = [next, nextPublic].filter((index) => index > 0);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

describe('通用触发类海克斯目录', () => {
  it('恰好覆盖 15 种通用海克斯且都存在于海克斯目录', () => {
    expect(COMBAT_HEX_IDS).toEqual([
      'H01',
      'H02',
      'H05',
      'H06',
      'H07',
      'H08',
      'H11',
      'H13',
      'H14',
      'H16',
      'H17',
      'H18',
      'H21',
      'H22',
      'H24',
    ]);
    for (const hexId of COMBAT_HEX_IDS) {
      expect(isCombatHexId(hexId)).toBe(true);
      expect(COMBAT_HEX_PARAMS[hexId]).toBeDefined();
      expect(HEX_LIST.some((hex) => hex.id === hexId)).toBe(true);
    }
    expect(isCombatHexId('H03')).toBe(false);
    expect(isCombatHexId('H99')).toBe(false);
  });

  it('数值与 02 内容目录一致', () => {
    expect(COMBAT_HEX_PARAMS.H01.freeCastsPerWavePerSlot).toBe(1);
    expect(COMBAT_HEX_PARAMS.H02.trailDurationSeconds).toBe(2);
    expect(COMBAT_HEX_PARAMS.H02.damagePerSecond).toBe(18);
    expect(COMBAT_HEX_PARAMS.H05.standSeconds).toBe(1);
    expect(COMBAT_HEX_PARAMS.H05.armorBonus).toBe(30);
    expect(COMBAT_HEX_PARAMS.H06.attackSpeedPercent).toBe(50);
    expect(COMBAT_HEX_PARAMS.H06.buffDurationSeconds).toBe(1.5);
    expect(COMBAT_HEX_PARAMS.H07.summonBlastDamage).toBe(50);
    expect(COMBAT_HEX_PARAMS.H07.summonBlastPerSecond).toBe(2);
    expect(COMBAT_HEX_PARAMS.H08.chargeIntervalSeconds).toBe(4);
    expect(COMBAT_HEX_PARAMS.H08.maxCharges).toBe(3);
    expect(COMBAT_HEX_PARAMS.H08.cooldownReductionPercentPerCharge).toBe(10);
    expect(COMBAT_HEX_PARAMS.H11.damageGold).toBe(15);
    expect(COMBAT_HEX_PARAMS.H13.damagePercentPerConsecutiveHit).toBe(4);
    expect(COMBAT_HEX_PARAMS.H13.maxDamagePercent).toBe(24);
    expect(COMBAT_HEX_PARAMS.H14.returnEveryNthShot).toBe(3);
    expect(COMBAT_HEX_PARAMS.H14.returnDamageRatio).toBe(0.35);
    expect(COMBAT_HEX_PARAMS.H16.damagePercent).toBe(25);
    expect(COMBAT_HEX_PARAMS.H17.idleSeconds).toBe(3);
    expect(COMBAT_HEX_PARAMS.H17.shieldPerSecond).toBe(3);
    expect(COMBAT_HEX_PARAMS.H17.maxShield).toBe(30);
    expect(COMBAT_HEX_PARAMS.H18.healthThresholdPercent).toBe(35);
    expect(COMBAT_HEX_PARAMS.H18.burstRadius).toBe(140);
    expect(COMBAT_HEX_PARAMS.H18.burstDamage).toBe(120);
    expect(COMBAT_HEX_PARAMS.H21.barrageHitInterval).toBe(12);
    expect(COMBAT_HEX_PARAMS.H21.barrageProjectileCount).toBe(8);
    expect(COMBAT_HEX_PARAMS.H21.barrageDamagePerProjectile).toBe(22);
    expect(COMBAT_HEX_PARAMS.H22.eliteDamagePercent).toBe(6);
    expect(COMBAT_HEX_PARAMS.H24.lethalGoldCost).toBe(60);
    expect(COMBAT_HEX_PARAMS.H24.lethalInvulnerableSeconds).toBe(1);
    expect(COMBAT_HEX_PARAMS.H24.maxLethalSavesPerRun).toBe(2);
  });
});

describe('H01 双倍委托', () => {
  it('每波 U/I 各一次免费首施，施放后各自消耗、同槽不互占', () => {
    const effects = effectsWith('H01');
    expect(effects.firstFreeCastAvailable('U')).toBe(true);
    expect(effects.firstFreeCastAvailable('I')).toBe(true);
    effects.markFirstFreeCastUsed('U');
    expect(effects.firstFreeCastAvailable('U')).toBe(false);
    expect(effects.firstFreeCastAvailable('I')).toBe(true);
    effects.markFirstFreeCastUsed('I');
    expect(effects.firstFreeCastAvailable('I')).toBe(false);
    expect(effects.snapshot().firstFreeCast).toEqual({
      available: { U: false, I: false },
      used: { U: true, I: true },
    });
  });

  it('未拥有 H01 时不提供免费首施，标记也不会伪造状态', () => {
    const effects = effectsWith();
    expect(effects.firstFreeCastAvailable('U')).toBe(false);
    effects.markFirstFreeCastUsed('U');
    expect(effects.snapshot().firstFreeCast.used).toEqual({ U: false, I: false });
  });

  it('波初重置后重新获得每波一次', () => {
    const effects = effectsWith('H01');
    effects.markFirstFreeCastUsed('U');
    effects.markFirstFreeCastUsed('I');
    effects.resetForWave();
    expect(effects.firstFreeCastAvailable('U')).toBe(true);
    expect(effects.firstFreeCastAvailable('I')).toBe(true);
  });
});

describe('H02 余烬之路', () => {
  it('闪避起点落火，火路存活 2 秒并每秒结算一次 18 法伤', () => {
    const trail = new EmberTrailState();
    trail.begin({ x: 0, y: 0 });
    expect(trail.patchCount).toBe(1);
    expect(trail.damagePerTick()).toBe(18);
    expect(trail.remainingSecondsLeft).toBe(2);

    // 第一步 0.5 秒：火焰寿命 1.5 秒，尚未到整秒 tick。
    expect(trail.step(0.5, { x: 0, y: 0 })).toBe(0);
    const firstPatch = trail.patches().at(0);
    expect(firstPatch?.remainingSeconds).toBeCloseTo(1.5, 9);
    // 累计到 1 秒：第 1 次伤害。
    expect(trail.step(0.5, { x: 0, y: 0 })).toBe(1);
    // 最后一步到 2 秒：火焰到期仍然结算第 2 次。
    expect(trail.step(1, { x: 0, y: 0 })).toBe(1);
    expect(trail.ticksFired).toBe(2);
    expect(trail.isActive).toBe(false);
    expect(trail.patchCount).toBe(0);
  });

  it('闪避中每移动一段距离补一团火，超出寿命后统一消失', () => {
    const trail = new EmberTrailState();
    trail.begin({ x: 0, y: 0 });
    trail.step(1 / 60, { x: COMBAT_HEX_PARAMS.H02.strideDistance ?? 36, y: 0 });
    expect(trail.patchCount).toBe(2);
    // 同一位置反复步进不会继续补火。
    for (let i = 0; i < 10; i += 1) {
      trail.step(1 / 60, {
        x: COMBAT_HEX_PARAMS.H02.strideDistance ?? 36,
        y: 0,
      });
    }
    expect(trail.patchCount).toBe(2);
    trail.step(2, null);
    expect(trail.isActive).toBe(false);
  });

  it('闪避结束不再补火，但已有火焰继续走完寿命', () => {
    const trail = new EmberTrailState();
    trail.begin({ x: 10, y: 10 });
    trail.end();
    expect(trail.step(1, null)).toBe(1);
    expect(trail.patchCount).toBe(1);
    expect(trail.step(1, null)).toBe(1);
    expect(trail.isActive).toBe(false);
  });

  it('未拥有 H02 时闪避不产生火路', () => {
    const effects = effectsWith();
    effects.beginDodge({ x: 0, y: 0 });
    expect(effects.emberTrail.patchCount).toBe(0);
    expect(effects.stepEmberTrail(1, { x: 0, y: 0 })).toBe(0);
  });

  it('拥有 H02 时由闪避开始并推进火路', () => {
    const effects = effectsWith('H02');
    effects.beginDodge({ x: 0, y: 0 });
    expect(effects.emberTrail.patchCount).toBe(1);
    expect(effects.stepEmberTrail(1, { x: 0, y: 0 })).toBe(1);
    effects.endDodge();
    expect(effects.stepEmberTrail(1.5, null)).toBe(1);
  });
});

describe('H06 滑步开火', () => {
  it('闪避结束后 1.5 秒内 J 攻速 +50%，结束立即失效', () => {
    const effects = effectsWith('H06');
    expect(effects.dodgeAttackSpeedMultiplier).toBe(1);
    effects.activateDodgeAttackBuff();
    expect(effects.dodgeAttackSpeedMultiplier).toBeCloseTo(1.5, 9);
    expect(effects.dodgeAttackBuffRemaining).toBeCloseTo(1.5, 9);
    effects.stepTimers(1.4, false);
    expect(effects.dodgeAttackSpeedMultiplier).toBeCloseTo(1.5, 9);
    effects.stepTimers(0.2, false);
    expect(effects.dodgeAttackSpeedMultiplier).toBe(1);
    expect(effects.snapshot().dodgeAttack.active).toBe(false);
  });

  it('未拥有 H06 时闪避不提供攻速窗口', () => {
    const effects = effectsWith();
    effects.activateDodgeAttackBuff();
    expect(effects.dodgeAttackSpeedMultiplier).toBe(1);
    expect(effects.dodgeAttackBuffRemaining).toBe(0);
  });

  it('波初清空闪避窗口', () => {
    const effects = effectsWith('H06');
    effects.activateDodgeAttackBuff();
    effects.resetForWave();
    expect(effects.dodgeAttackSpeedMultiplier).toBe(1);
  });
});

describe('H08 冷却银行', () => {
  it('U/I 都就绪时每 4 秒存一层，最多 3 层', () => {
    const effects = effectsWith('H08');
    effects.stepTimers(4, true);
    expect(effects.bankCharges).toBe(1);
    effects.stepTimers(8, true);
    expect(effects.bankCharges).toBe(3);
    effects.stepTimers(12, true);
    expect(effects.bankCharges).toBe(3);
    expect(effects.snapshot().cooldownBank.accumulatedSeconds).toBe(0);
  });

  it('未全部就绪时不累计，且没存满的进度归零', () => {
    const effects = effectsWith('H08');
    effects.stepTimers(3, true);
    expect(effects.snapshot().cooldownBank.accumulatedSeconds).toBeCloseTo(3, 9);
    effects.stepTimers(1, false);
    expect(effects.bankCharges).toBe(0);
    expect(effects.snapshot().cooldownBank.accumulatedSeconds).toBe(0);
    effects.stepTimers(3, true);
    expect(effects.bankCharges).toBe(0);
    effects.stepTimers(1, true);
    expect(effects.bankCharges).toBe(1);
  });

  it('每层减本次冷却 10%，施放后消耗全部层数', () => {
    const effects = effectsWith('H08');
    effects.stepTimers(4, true);
    expect(effects.bankCooldownScale).toBeCloseTo(0.9, 9);
    effects.stepTimers(8, true);
    expect(effects.bankCooldownScale).toBeCloseTo(0.7, 9);
    expect(effects.consumeBankCharges()).toBe(3);
    expect(effects.bankCharges).toBe(0);
    expect(effects.bankCooldownScale).toBe(1);
    expect(effects.snapshot().cooldownBank.consumedTotal).toBe(3);
  });

  it('未拥有 H08 时不存储、不消耗', () => {
    const effects = effectsWith();
    effects.stepTimers(10, true);
    expect(effects.bankCharges).toBe(0);
    expect(effects.bankCooldownScale).toBe(1);
    expect(effects.consumeBankCharges()).toBe(0);
  });

  it('波初清空层数与累计', () => {
    const effects = effectsWith('H08');
    effects.stepTimers(5, true);
    effects.resetForWave();
    expect(effects.bankCharges).toBe(0);
    expect(effects.snapshot().cooldownBank.accumulatedSeconds).toBe(0);
  });
});

describe('H16 连携时刻', () => {
  it('交替施放 U/I 时第二个技能 +25%，同槽重复不触发', () => {
    const effects = effectsWith('H16');
    expect(effects.registerSkillCast('U')).toBe(1);
    expect(effects.registerSkillCast('I')).toBe(1.25);
    expect(effects.registerSkillCast('U')).toBe(1.25);
    // 同槽重复：本次不享受加成，并把链重置为当前槽。
    expect(effects.registerSkillCast('U')).toBe(1);
    expect(effects.registerSkillCast('I')).toBe(1.25);
    expect(effects.snapshot().combo.triggers).toBe(3);
  });

  it('未拥有 H16 时永远不增伤，也不记录连携链', () => {
    const effects = effectsWith();
    expect(effects.registerSkillCast('U')).toBe(1);
    expect(effects.registerSkillCast('I')).toBe(1);
    expect(effects.lastCastSlot).toBeNull();
  });

  it('波初清空连携链', () => {
    const effects = effectsWith('H16');
    effects.registerSkillCast('U');
    effects.resetForWave();
    expect(effects.lastCastSlot).toBeNull();
    expect(effects.registerSkillCast('I')).toBe(1);
  });
});

describe('H07 分身礼炮', () => {
  it('召唤物消失爆破走统一闸门，同一秒全局最多 2 次', () => {
    const gate = new TriggerGate([H07_TRIGGER_RULE]);
    expect(H07_TRIGGER_RULE.perSecond).toBe(2);

    expect(gate.tryTrigger('H07').allowed).toBe(true);
    expect(gate.tryTrigger('H07').allowed).toBe(true);
    const denied = gate.tryTrigger('H07');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('per-second');

    // 下一秒窗口清空后重新允许 2 次。
    gate.step(1);
    expect(gate.tryTrigger('H07').allowed).toBe(true);
    expect(gate.tryTrigger('H07').allowed).toBe(true);
    expect(gate.tryTrigger('H07').allowed).toBe(false);
  });

  it('爆破参数为 50 法伤、半径 100；未拥有 H07 时场景不尝试触发', () => {
    const effects = effectsWith();
    expect(effects.has('H07')).toBe(false);
    expect(effects.snapshot().summonBlast).toEqual({
      damage: 50,
      radius: 100,
      perSecond: 2,
    });
  });
});

describe('H13 追击扳机', () => {
  it('连续命中同一目标每次 +4%，第 7 次起封顶 +24%', () => {
    const effects = effectsWith('H13');
    // 第一次命中没有连击，从第二次开始 +4%。
    expect(effects.registerJHit('enemy-a').damageMultiplier).toBe(1);
    expect(effects.registerJHit('enemy-a').damageMultiplier).toBeCloseTo(1.04, 9);
    expect(effects.registerJHit('enemy-a').damageMultiplier).toBeCloseTo(1.08, 9);
    expect(effects.registerJHit('enemy-a').damageMultiplier).toBeCloseTo(1.12, 9);
    expect(effects.registerJHit('enemy-a').damageMultiplier).toBeCloseTo(1.16, 9);
    expect(effects.registerJHit('enemy-a').damageMultiplier).toBeCloseTo(1.2, 9);
    expect(effects.registerJHit('enemy-a').damageMultiplier).toBeCloseTo(1.24, 9);
    // 封顶后继续命中同一目标不再增长。
    expect(effects.registerJHit('enemy-a').damageMultiplier).toBeCloseTo(1.24, 9);
    const snapshot = effects.snapshot().hitStreak;
    expect(snapshot.targetId).toBe('enemy-a');
    expect(snapshot.streak).toBe(8);
    expect(snapshot.maxDamagePercent).toBe(24);
  });

  it('换目标重置连击；再换回也从头开始', () => {
    const effects = effectsWith('H13');
    effects.registerJHit('a');
    effects.registerJHit('a');
    expect(effects.registerJHit('b').damageMultiplier).toBe(1);
    expect(effects.registerJHit('b').damageMultiplier).toBeCloseTo(1.04, 9);
    expect(effects.registerJHit('a').damageMultiplier).toBe(1);
  });

  it('波初清空连击，未拥有时永远不增伤', () => {
    const owned = effectsWith('H13');
    owned.registerJHit('a');
    owned.registerJHit('a');
    owned.resetForWave();
    expect(owned.snapshot().hitStreak.streak).toBe(0);
    expect(owned.registerJHit('a').damageMultiplier).toBe(1);

    const none = effectsWith();
    expect(none.registerJHit('a').damageMultiplier).toBe(1);
    expect(none.registerJHit('a').damageMultiplier).toBe(1);
    expect(none.snapshot().hitStreak.streak).toBe(0);
  });
});

describe('H14 折返弹', () => {
  it('每第三发原生 J 折返，其余两发不折返', () => {
    const effects = effectsWith('H14');
    expect(effects.registerJShot()).toBe(false);
    expect(effects.registerJShot()).toBe(false);
    expect(effects.registerJShot()).toBe(true);
    expect(effects.registerJShot()).toBe(false);
    expect(effects.registerJShot()).toBe(false);
    expect(effects.registerJShot()).toBe(true);
    expect(effects.snapshot().returnShot).toMatchObject({
      everyNthShot: 3,
      shotsFired: 6,
      returnDamageRatio: 0.35,
    });
  });

  it('未拥有 H14 时不登记折返', () => {
    const effects = effectsWith();
    expect(effects.registerJShot()).toBe(false);
    expect(effects.snapshot().returnShot.nextShotReturns).toBe(false);
  });

  it('射程终点调头一次，返程伤害 35% 且可再次命中同一目标', () => {
    const attack = {
      key: 'J' as const,
      name: '测试弹',
      intervalSeconds: 0.5,
      range: 200,
      damage: 100,
      damageType: 'physical' as const,
    };
    const projectile: ProjectileState = createProjectile(
      1,
      { x: 0, y: 0 },
      'east',
      attack,
      { returnCharges: 1, returnDamageRatio: 0.35 },
    );
    projectile.hitTargetIds.add('enemy-a');
    projectile.remainingRange = 0;

    expect(beginProjectileReturn(projectile)).toBe(true);
    expect(projectile.returning).toBe(true);
    expect(projectile.returnCharges).toBe(0);
    expect(projectile.remainingRange).toBe(attack.range);
    expect(projectile.hitTargetIds.size).toBe(0);
    // 只能折返一次。
    expect(beginProjectileReturn(projectile)).toBe(false);

    const applied: number[] = [];
    const target = {
      id: 'enemy-a',
      x: 0,
      y: 0,
      radius: 12,
      isAlive: true,
      applyDamage: (damage: number) => {
        applied.push(damage);
        return {
          applied: true,
          damage,
          rawDamage: damage,
          shieldAbsorbed: 0,
          healthLost: damage,
          died: false,
          health: 1,
          shield: 0,
        };
      },
    };
    resolveProjectileHit(
      projectile,
      target as unknown as Parameters<typeof resolveProjectileHit>[1],
      1,
    );
    expect(applied[0]).toBeCloseTo(35, 9);
  });

  it('场景在射程耗尽时调用折返，收尾不再销毁弹体', () => {
    const body = methodBody(SCENE_SOURCE, 'private stepProjectiles(');
    expect(body).toContain('beginProjectileReturn(entry.state)');
    expect(body).toContain('recordReturnStart()');
    const fire = SCENE_SOURCE.slice(
      SCENE_SOURCE.indexOf('const returnShot = this.combatHexes.registerJShot()'),
      SCENE_SOURCE.indexOf('const origin = this.motion.position', SCENE_SOURCE.indexOf('const returnShot = this.combatHexes.registerJShot()')),
    );
    expect(fire.length).toBeGreaterThan(0);
    expect(SCENE_SOURCE).toContain('returnCharges: 1');
    expect(SCENE_SOURCE).toContain('COMBAT_HEX_PARAMS.H14.returnDamageRatio');
  });
});

describe('H21 漂浮弹幕', () => {
  it('每 12 次 J 命中触发一次，未满不触发', () => {
    const effects = effectsWith('H21');
    for (let hit = 1; hit < 12; hit += 1) {
      expect(effects.registerJHit('enemy-a').barrage).toBe(false);
    }
    expect(effects.registerJHit('enemy-a').barrage).toBe(true);
    for (let hit = 13; hit < 24; hit += 1) {
      expect(effects.registerJHit('enemy-a').barrage).toBe(false);
    }
    expect(effects.registerJHit('enemy-a').barrage).toBe(true);
    expect(effects.snapshot().barrage).toMatchObject({
      jHits: 24,
      hitInterval: 12,
      triggers: 2,
      projectileCount: 8,
      damagePerProjectile: 22,
    });
  });

  it('未拥有 H21 时不计数、不触发', () => {
    const effects = effectsWith();
    for (let hit = 0; hit < 24; hit += 1) {
      expect(effects.registerJHit('enemy-a').barrage).toBe(false);
    }
    expect(effects.snapshot().barrage.jHits).toBe(0);
    expect(effects.snapshot().barrage.triggers).toBe(0);
  });

  it('波初保留跨波命中计数，新局才归零', () => {
    const effects = effectsWith('H21');
    for (let hit = 0; hit < 11; hit += 1) effects.registerJHit('enemy-a');
    effects.resetForWave();
    expect(effects.snapshot().barrage.jHits).toBe(11);
    expect(effects.registerJHit('enemy-a').barrage).toBe(true);
    effects.reset();
    expect(effects.snapshot().barrage.jHits).toBe(0);
  });

  it('弹幕由 H21 派生来源生成，命中不登记 J 命中', () => {
    const body = methodBody(SCENE_SOURCE, 'private spawnH21Barrage(');
    expect(body).toContain("derive(parent, 'H21')");
    expect(body).toContain('barrageProjectileCount');
    expect(body).toContain("source: 'H21'");
    expect(body).toContain('pendingDerivedBullets.push');
    // 命中侧只对原生 J 登记 H13/H21，触发弹与返程弹都不计数。
    expect(SCENE_SOURCE).toContain(
      "const nativeJHit =\n        hitEnemy !== null &&\n        entry.source === 'J' &&\n        entry.state.returning !== true;",
    );
    expect(SCENE_SOURCE).toContain('if (jHit?.barrage) this.spawnH21Barrage');
  });
});

describe('H05 不动要塞', () => {
  it('站定满 1 秒后护甲 +30，移动立即移除', () => {
    const effects = effectsWith('H05');
    expect(effects.stationaryArmorBonus).toBe(0);
    effects.stepStationary(0.5, false);
    expect(effects.standSeconds).toBeCloseTo(0.5, 9);
    expect(effects.stationaryArmorBonus).toBe(0);
    effects.stepStationary(0.5, false);
    expect(effects.stationaryArmorBonus).toBe(30);
    // 移动立即清零，不等下一步。
    effects.stepStationary(1 / 60, true);
    expect(effects.standSeconds).toBe(0);
    expect(effects.stationaryArmorBonus).toBe(0);
  });

  it('未拥有 H05 时不计时也不提供护甲', () => {
    const effects = effectsWith();
    effects.stepStationary(5, false);
    expect(effects.stationaryArmorBonus).toBe(0);
    expect(effects.snapshot().stationaryFortress.active).toBe(false);
  });

  it('波初清零站定计时，护甲随之移除', () => {
    const effects = effectsWith('H05');
    effects.stepStationary(1.2, false);
    expect(effects.stationaryArmorBonus).toBe(30);
    effects.resetForWave();
    expect(effects.standSeconds).toBe(0);
    expect(effects.stationaryArmorBonus).toBe(0);
  });
});

describe('H11 以伤换金', () => {
  it('每波首次受到敌人伤害 +15 金币，后续受击不再给', () => {
    const effects = effectsWith('H11');
    expect(effects.registerPlayerDamage(0)).toBe(15);
    expect(effects.hurtForGoldUsed).toBe(true);
    expect(effects.registerPlayerDamage(0)).toBe(0);
  });

  it('波初重新获得每波一次；未拥有时不给金币', () => {
    const effects = effectsWith('H11');
    effects.registerPlayerDamage(0);
    effects.resetForWave();
    expect(effects.hurtForGoldUsed).toBe(false);
    expect(effects.registerPlayerDamage(0)).toBe(15);

    const withoutHex = effectsWith();
    expect(withoutHex.registerPlayerDamage(0)).toBe(0);
  });
});

describe('H17 护盾呼吸', () => {
  it('3 秒未受伤后每秒 +3，上限 30', () => {
    const effects = effectsWith('H17');
    expect(effects.stepShieldBreathing(2.9)).toBe(0);
    expect(effects.stepShieldBreathing(0.1)).toBe(3);
    expect(effects.breathingShield).toBe(3);
    expect(effects.stepShieldBreathing(1)).toBe(3);
    expect(effects.breathingShield).toBe(6);
    expect(effects.stepShieldBreathing(20)).toBe(24);
    expect(effects.breathingShield).toBe(30);
    // 已到上限，继续站定不再生成。
    expect(effects.stepShieldBreathing(10)).toBe(0);
    expect(effects.breathingShield).toBe(30);
  });

  it('一步内跨过多个发放点也只补到上限，不超发', () => {
    const effects = effectsWith('H17');
    expect(effects.stepShieldBreathing(100)).toBe(30);
    expect(effects.breathingShield).toBe(30);
    expect(effects.snapshot().shieldBreathing.shield).toBe(30);
  });

  it('受伤中断计时并按护盾吸收量扣减自身护盾', () => {
    const effects = effectsWith('H17');
    // 4 秒未受伤：第 3 秒与第 4 秒各发一层，共 6。
    effects.stepShieldBreathing(4);
    expect(effects.breathingShield).toBe(6);
    effects.registerPlayerDamage(2);
    expect(effects.breathingShield).toBe(4);
    // 计时从 0 重新开始：1 秒后仍不到 3 秒门槛。
    expect(effects.stepShieldBreathing(1)).toBe(0);
    expect(effects.stepShieldBreathing(2)).toBe(3);
    expect(effects.breathingShield).toBe(7);
  });

  it('未拥有 H17 时不生成护盾', () => {
    const effects = effectsWith();
    expect(effects.stepShieldBreathing(10)).toBe(0);
    expect(effects.breathingShield).toBe(0);
  });
});

describe('H18 濒危爆发', () => {
  it('生命严格低于 35% 才触发，每波一次', () => {
    const effects = effectsWith('H18');
    expect(effects.tryLowHealthBurst(36, 100)).toBe(false);
    // 恰好 35% 不算「低于」。
    expect(effects.tryLowHealthBurst(35, 100)).toBe(false);
    expect(effects.tryLowHealthBurst(34.99, 100)).toBe(true);
    expect(effects.lowHealthBurstUsed).toBe(true);
    expect(effects.tryLowHealthBurst(10, 100)).toBe(false);
  });

  it('波初恢复一次；未拥有或已死时不触发', () => {
    const effects = effectsWith('H18');
    expect(effects.tryLowHealthBurst(1, 100)).toBe(true);
    effects.resetForWave();
    expect(effects.lowHealthBurstUsed).toBe(false);
    expect(effects.tryLowHealthBurst(1, 100)).toBe(true);

    const withoutHex = effectsWith();
    expect(withoutHex.tryLowHealthBurst(1, 100)).toBe(false);
    const dead = effectsWith('H18');
    expect(dead.tryLowHealthBurst(0, 100)).toBe(false);
  });
});

describe('H22 精英收藏', () => {
  it('击败精英永久 +6% 伤害，多次可叠加', () => {
    const effects = effectsWith('H22');
    expect(effects.eliteDamageBonus).toBe(0);
    expect(effects.registerEliteKill()).toBeCloseTo(0.06, 9);
    expect(effects.eliteKills).toBe(1);
    expect(effects.eliteDamageBonus).toBeCloseTo(0.06, 9);
    effects.registerEliteKill();
    expect(effects.eliteDamageBonus).toBeCloseTo(0.12, 9);
    expect(effects.snapshot().eliteCollection).toEqual({
      eliteKills: 2,
      damageBonus: 0.12,
    });
  });

  it('获取前击败的精英不追溯，新局清零', () => {
    const owned = new Set<string>();
    const effects = new CombatHexEffects({ has: (hexId) => owned.has(hexId) });
    expect(effects.registerEliteKill()).toBe(0);
    owned.add('H22');
    expect(effects.eliteKills).toBe(0);
    expect(effects.eliteDamageBonus).toBe(0);
    effects.registerEliteKill();
    expect(effects.eliteDamageBonus).toBeCloseTo(0.06, 9);
    effects.reset();
    expect(effects.eliteKills).toBe(0);
    expect(effects.eliteDamageBonus).toBe(0);
  });

  it('跨波保留已获得的精英加成', () => {
    const effects = effectsWith('H22');
    effects.registerEliteKill();
    effects.resetForWave();
    expect(effects.eliteDamageBonus).toBeCloseTo(0.06, 9);
  });
});

describe('H24 多重保险', () => {
  it('金币足够时抵消致命伤并扣 60 金币、给 1 秒无敌', () => {
    const effects = effectsWith('H24');
    expect(effects.tryLethalSave(59)).toEqual({
      triggered: false,
      goldCost: 0,
      invulnerableSeconds: 0,
    });
    expect(effects.tryLethalSave(60)).toEqual({
      triggered: true,
      goldCost: 60,
      invulnerableSeconds: 1,
    });
  });

  it('每波最多一次；每局最多 2 次', () => {
    const effects = effectsWith('H24');
    expect(effects.tryLethalSave(60).triggered).toBe(true);
    // 同波第二次致命伤不再触发。
    expect(effects.tryLethalSave(60).triggered).toBe(false);
    effects.resetForWave();
    expect(effects.tryLethalSave(60).triggered).toBe(true);
    // 每局 2 次用尽后，换波也不能再用。
    effects.resetForWave();
    expect(effects.tryLethalSave(60).triggered).toBe(false);
  });

  it('未拥有 H24 或金币不足时永不触发', () => {
    const withoutHex = effectsWith();
    expect(withoutHex.tryLethalSave(999).triggered).toBe(false);

    const effects = effectsWith('H24');
    expect(effects.tryLethalSave(0).triggered).toBe(false);
    expect(effects.tryLethalSave(59).triggered).toBe(false);
    // 失败不消耗次数：补足金币后仍可在本波触发。
    expect(effects.tryLethalSave(60).triggered).toBe(true);
  });
});

describe('场景接线', () => {
  it('施放入口读取 H01/H08 并把连携倍率传入技能效果', () => {
    const body = methodBody(SCENE_SOURCE, 'private castFreeSkill(');
    expect(body).toContain('firstFreeCastAvailable(slot)');
    expect(body).toContain('bankCooldownScale');
    expect(body).toContain('markFirstFreeCastUsed(slot)');
    expect(body).toContain('consumeBankCharges()');
    expect(body).toContain('registerSkillCast(slot)');
    expect(body).toContain('comboMultiplier');
    // E06 复施只执行效果，不经过上述计数入口。
    const echoBody = methodBody(SCENE_SOURCE, 'private castFreeSkill(');
    expect(echoBody).toContain('echoStrength === null');
  });

  it('闪避开始铺 H02 火路，闪避结束开启 H06 窗口', () => {
    expect(SCENE_SOURCE).toContain('combatHexes.beginDodge(this.motion.position)');
    expect(SCENE_SOURCE).toContain('combatHexes.endDodge()');
    expect(SCENE_SOURCE).toContain('combatHexes.activateDodgeAttackBuff()');
    const stepBody = methodBody(SCENE_SOURCE, 'private stepCombatHexEffects(');
    expect(stepBody).toContain('stepTimers(stepSeconds, bothReady)');
    expect(stepBody).toContain('stepEmberTrail(');
    expect(stepBody).toContain('applyEmberTrailDamage(emberTicks)');
  });

  it('H02 火路按 18 法伤与统一抗性入口结算', () => {
    const body = methodBody(SCENE_SOURCE, 'private applyEmberTrailDamage(');
    expect(body).toContain('damagePerTick()');
    expect(body).toContain("enemyDamageMultiplier(target.id, 'magic')");
    expect(body).toContain('listTargetsInFirePatches');
  });

  it('每步把 H06 攻速倍率折算进 J 攻击间隔', () => {
    const hexIndex = SCENE_SOURCE.indexOf(
      'this.combatHexes.dodgeAttackSpeedMultiplier',
    );
    expect(hexIndex).toBeGreaterThanOrEqual(0);
    const window = SCENE_SOURCE.slice(Math.max(0, hexIndex - 200), hexIndex);
    expect(window).toContain('this.attackTimer.setIntervalMultiplier(');
    expect(window).toContain('this.stats.attackIntervalMultiplier /');
  });

  it('逻辑步里先推进 U/I 冷却，再推进通用海克斯，最后推进技能效果', () => {
    const freeStep = SCENE_SOURCE.indexOf('this.freeSkills.step(stepSeconds)');
    const hexStep = SCENE_SOURCE.indexOf(
      'this.stepCombatHexEffects(stepSeconds)',
    );
    const effectStep = SCENE_SOURCE.indexOf(
      'this.stepFreeSkillEffects(stepSeconds)',
    );
    expect(freeStep).toBeGreaterThanOrEqual(0);
    expect(hexStep).toBeGreaterThan(freeStep);
    expect(effectStep).toBeGreaterThan(hexStep);
  });

  it('波初重置通用海克斯每波状态并清空火路视觉', () => {
    const resetStart = SCENE_SOURCE.indexOf('private resetWaveReadyState()');
    expect(resetStart).toBeGreaterThanOrEqual(0);
    const block = SCENE_SOURCE.slice(
      resetStart,
      SCENE_SOURCE.indexOf('\n  private ', resetStart + 10),
    );
    expect(block).toContain('this.combatHexes.resetForWave()');
    expect(block).toContain('this.destroyEmberTrailVisuals()');
    expect(block).toContain('this.lastHexPosition = null');
    expect(block).toContain('this.syncCombatHexStats()');
  });

  it('H05 站定护甲与 H22 精英加成进入统一属性聚合', () => {
    const body = methodBody(SCENE_SOURCE, 'private syncCombatHexStats(');
    expect(body).toContain('this.combatHexes.stationaryArmorBonus');
    expect(body).toContain('this.combatHexes.eliteDamageBonus');
    expect(body).toContain("this.stats.setSource(\n      'hex:H05'");
    expect(body).toContain("this.stats.setSource(\n      'hex:H22'");
    expect(body).toContain('this.playerHealth.setDefenses(');
    // 每步按实际位移推进站定计时。
    const stepBody = methodBody(SCENE_SOURCE, 'private stepCombatHexEffects(');
    expect(stepBody).toContain('stepStationary(stepSeconds, moved)');
    expect(stepBody).toContain('syncCombatHexStats()');
  });

  it('H17 护盾呼吸加入共享护盾池并刷新 HUD', () => {
    const stepBody = methodBody(SCENE_SOURCE, 'private stepCombatHexEffects(');
    expect(stepBody).toContain('stepShieldBreathing(stepSeconds)');
    expect(stepBody).toContain(
      'this.playerHealth.setShield(\n        this.playerHealth.shield + breathingShield',
    );
    expect(stepBody).toContain('this.syncHealthHud()');
  });

  it('H11 受敌伤奖励金币，H18 在敌人步进后统一爆发', () => {
    const body = methodBody(SCENE_SOURCE, 'private stepEnemies(');
    expect(body).toContain(
      'this.combatHexes.registerPlayerDamage(\n            result.shieldAbsorbed',
    );
    expect(body).toContain('以伤换金');
    expect(body).toContain('this.pendingLowHealthBurst = true');
    expect(SCENE_SOURCE).toContain(
      "if (!this.playerHealth.isDead) this.applyLowHealthBurst()",
    );
    const burstBody = methodBody(SCENE_SOURCE, 'private applyLowHealthBurst(');
    expect(burstBody).toContain('COMBAT_HEX_PARAMS.H18');
    expect(burstBody).toContain("enemyDamageMultiplier(target.id, 'magic', origin)");
    expect(burstBody).toContain("beginNative('H18')");
  });

  it('H24 在 E03 之后判定，一次致命事件只触发一个保命效果', () => {
    const body = methodBody(SCENE_SOURCE, 'private stepEnemies(');
    const e03Index = body.indexOf('this.coreEffects.tryPreventDeath()');
    const h24Index = body.indexOf('this.combatHexes.tryLethalSave(');
    expect(e03Index).toBeGreaterThanOrEqual(0);
    expect(h24Index).toBeGreaterThan(e03Index);
    expect(body).toContain('if (result.died && !savedByCore)');
    expect(body).toContain('this.economy.spendGold(save.goldCost)');
    expect(body).toContain('this.playerHealth.restoreHealth(');
    expect(body).toContain('抵消');
  });

  it('H22 在精英击杀时登记永久伤害', () => {
    const body = methodBody(SCENE_SOURCE, 'private showDamageResult(');
    expect(body).toContain('this.combatHexes.registerEliteKill()');
    expect(body).toContain('精英收藏');
  });
});
