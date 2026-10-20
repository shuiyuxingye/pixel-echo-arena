import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/game/arena';
import { Combatant } from '../src/game/combat';
import { getCharacter, getUpgrade, listUpgradesForCharacter } from '../src/game/data';
import {
  M01_MELEE_MAX_STACKS,
  M01_RANGED_MAX_COPIES,
  M02_HEAL_ON_ACTIVATE_PERCENT,
  M02_HEAL_PERCENT_PER_SECOND,
  M03_PULL_RANGE_BONUS,
  M03_ROOT_BONUS_SECONDS,
  M04_DAMAGE_RATIO,
  M04_INTERNAL_COOLDOWN_SECONDS,
  MuelsyseCombat,
  type MuelsyseCombatConfig,
  type MuelsyseStepContext,
} from '../src/game/muelsyse';

const ROOT = process.cwd();
const STEP = 1 / 60;
const MUELSYSE = getCharacter('muelsyse');
const PLAYER = { x: 720, y: 480 };

function createCombat(): MuelsyseCombat {
  const params = MUELSYSE.skillK.params ?? {};
  const lParams = MUELSYSE.skillL.params ?? {};
  const config: MuelsyseCombatConfig = {
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
    },
    shallowAdaptation: {
      cooldownSeconds: MUELSYSE.skillL.cooldownSeconds,
      durationSeconds: MUELSYSE.skillL.durationSeconds ?? 0,
      pullIntervalSeconds: lParams.pullIntervalSeconds ?? 0,
      pullRadius: lParams.pullRadius ?? 0,
      pullDistance: lParams.pullDistance ?? 0,
      stunSeconds: lParams.stunSeconds ?? 0,
      rootSeconds: lParams.rootSeconds ?? 0,
    },
    layout: createArenaLayout(),
    startX: PLAYER.x,
    startY: PLAYER.y,
  };
  return new MuelsyseCombat(config);
}

function combatant(
  id: string,
  x: number,
  y: number,
  maxHealth = 1_000_000,
): Combatant {
  return new Combatant({ id, x, y, radius: 12, maxHealth });
}

function context(
  targets: Combatant[] = [],
  extra: Omit<MuelsyseStepContext, 'player' | 'targets'> = {},
): MuelsyseStepContext {
  return { player: PLAYER, targets, ...extra };
}

function advance(
  combat: MuelsyseCombat,
  seconds: number,
  ctx: MuelsyseStepContext,
): { attacks: number; pulls: number; formHealed: number } {
  const steps = Math.round(seconds / STEP);
  let attacks = 0;
  let pulls = 0;
  let formHealed = 0;
  for (let step = 0; step < steps; step += 1) {
    const result = combat.step(STEP, ctx);
    attacks += result.attacks.length;
    pulls += result.pulls.length;
    formHealed += result.formHealed;
  }
  return { attacks, pulls, formHealed };
}

describe('缪尔赛思专属强化数值与卡片同源', () => {
  it('M01–M04 的常量直接读取 UPGRADE_LIST.params', () => {
    expect(M01_RANGED_MAX_COPIES).toBe(getUpgrade('M01').params?.rangedMaxCopies);
    expect(M01_MELEE_MAX_STACKS).toBe(getUpgrade('M01').params?.meleeMaxStacks);
    expect(M02_HEAL_PERCENT_PER_SECOND).toBe(
      getUpgrade('M02').params?.healPercentPerSecond,
    );
    expect(M02_HEAL_ON_ACTIVATE_PERCENT).toBe(
      getUpgrade('M02').params?.healOnActivatePercent,
    );
    expect(M03_PULL_RANGE_BONUS).toBe(getUpgrade('M03').params?.pullRangeBonus);
    expect(M03_ROOT_BONUS_SECONDS).toBe(getUpgrade('M03').params?.rootBonusSeconds);
    expect(M04_DAMAGE_RATIO).toBe(getUpgrade('M04').params?.damageRatio);
    expect(M04_INTERNAL_COOLDOWN_SECONDS).toBe(
      getUpgrade('M04').params?.internalCooldownSeconds,
    );
  });

  it('M01–M04 只属于缪尔赛思且各 1 层', () => {
    const muelsyseIds = listUpgradesForCharacter('muelsyse')
      .filter((upgrade) => upgrade.owner === 'muelsyse')
      .map((upgrade) => upgrade.id);
    expect(muelsyseIds).toEqual(['M01', 'M02', 'M03', 'M04']);
    for (const id of muelsyseIds) {
      expect(getUpgrade(id).maxStacks).toBe(1);
      expect(listUpgradesForCharacter('amiya').some((card) => card.id === id)).toBe(
        false,
      );
      expect(listUpgradesForCharacter('saria').some((card) => card.id === id)).toBe(
        false,
      );
      expect(
        listUpgradesForCharacter('vishdal').some((card) => card.id === id),
      ).toBe(false);
    }
  });
});

describe('M01 双生流形', () => {
  it('远程副本上限 1→2，近战窃取层数上限 5→8', () => {
    expect(createCombat().maxCopies).toBe(1);
    expect(createCombat().maxMeleeStacks).toBe(5);

    const combat = createCombat();
    combat.setDualForm(M01_RANGED_MAX_COPIES, M01_MELEE_MAX_STACKS);
    expect(combat.maxCopies).toBe(2);
    expect(combat.maxMeleeStacks).toBe(8);
  });

  it('远程副本上限 1→2，基础配置仍只有 1 个', () => {
    for (const [upgraded, expected] of [
      [false, 1],
      [true, 2],
    ] as const) {
      const combat = createCombat();
      if (upgraded) combat.setDualForm(M01_RANGED_MAX_COPIES, M01_MELEE_MAX_STACKS);
      combat.tryActivateK(PLAYER);
      const form = combat.formPosition;
      const target = combatant('dummy', form.x + 100, form.y);
      advance(combat, 10, context([target]));
      expect(combat.copyCount).toBe(1);
      // 远程 L 刷新副本寿命，让第一个副本活到第二次分裂（默认 5 秒寿命 < 6.4 秒分裂间隔）。
      expect(combat.tryActivateL().activated).toBe(true);
      advance(combat, 2.5, context([target]));
      expect(combat.copyCount).toBe(expected);
    }
  });

  it('近战窃取层数可到 8 层，未拥有 M01 时停在 5 层', () => {
    for (const [upgraded, expected] of [
      [false, 5],
      [true, 8],
    ] as const) {
      const combat = createCombat();
      if (upgraded) combat.setDualForm(M01_RANGED_MAX_COPIES, M01_MELEE_MAX_STACKS);
      const form = combat.formPosition;
      const target = combatant('dummy', form.x + 60, form.y);
      advance(combat, 0.7 * 10, context([target]));
      expect(combat.formStacks).toBe(expected);
      expect(combat.formDamage).toBe(16 + expected * 2);
    }
  });
});

describe('M02 生态复苏', () => {
  it('主流形每秒恢复最大生命 2%，按整秒结算', () => {
    const combat = createCombat();
    combat.setEcologicalRecovery(M02_HEAL_PERCENT_PER_SECOND, 0);
    combat.damageForm(50, 'true');
    expect(combat.formHealth).toBeCloseTo(40, 10);

    const half = advance(combat, 0.5, context());
    expect(half.formHealed).toBe(0);
    expect(combat.formHealth).toBeCloseTo(40, 10);

    const one = advance(combat, 0.5, context());
    expect(one.formHealed).toBeCloseTo(90 * 0.02, 10);
    expect(combat.formHealth).toBeCloseTo(40 + 90 * 0.02, 10);
  });

  it('未拥有 M02 时不回复', () => {
    const combat = createCombat();
    combat.damageForm(50, 'true');
    const result = advance(combat, 2, context());
    expect(result.formHealed).toBe(0);
    expect(combat.formHealth).toBeCloseTo(40, 10);
  });

  it('L 开启时立即恢复最大生命 20%，且不超过生命上限', () => {
    const combat = createCombat();
    combat.setEcologicalRecovery(M02_HEAL_PERCENT_PER_SECOND, M02_HEAL_ON_ACTIVATE_PERCENT);
    combat.damageForm(50, 'true');
    expect(combat.tryActivateL().activated).toBe(true);
    expect(combat.formHealth).toBeCloseTo(40 + 90 * 0.2, 10);

    const capped = createCombat();
    capped.setEcologicalRecovery(M02_HEAL_PERCENT_PER_SECOND, M02_HEAL_ON_ACTIVATE_PERCENT);
    capped.damageForm(5, 'true');
    capped.tryActivateL();
    expect(capped.formHealth).toBe(90);
  });

  it('主流形死亡后不再回复', () => {
    const combat = createCombat();
    combat.setEcologicalRecovery(M02_HEAL_PERCENT_PER_SECOND, 0);
    combat.damageForm(1000, 'true');
    expect(combat.isFormAlive).toBe(false);
    const result = advance(combat, 2, context());
    expect(result.formHealed).toBe(0);
    expect(combat.formHealth).toBe(0);
  });

  it('重复同步同一配置不清空已累计的整秒进度', () => {
    const combat = createCombat();
    combat.setEcologicalRecovery(M02_HEAL_PERCENT_PER_SECOND, 0);
    combat.damageForm(50, 'true');
    advance(combat, 0.5, context());
    combat.setEcologicalRecovery(M02_HEAL_PERCENT_PER_SECOND, 0);
    const result = advance(combat, 0.5, context());
    expect(result.formHealed).toBeCloseTo(90 * 0.02, 10);
  });
});

describe('M03 聚合涡旋', () => {
  it('近战 L 拉拽范围 +30%（100→130，含边界）', () => {
    const combat = createCombat();
    combat.setAggregationVortex(M03_PULL_RANGE_BONUS, M03_ROOT_BONUS_SECONDS);
    expect(combat.meleePullRadius).toBeCloseTo(130, 10);
    combat.tryActivateL();
    const form = combat.formPosition;
    const inside = combatant('inside', form.x + 130, form.y);
    const outside = combatant('outside', form.x + 130.5, form.y);
    const result = advance(combat, 2.05, context([inside, outside]));
    expect(result.pulls).toBe(1);
    expect(inside.health.health).toBe(1_000_000);
  });

  it('未拥有 M03 时拉拽半径保持 100', () => {
    const combat = createCombat();
    combat.tryActivateL();
    const form = combat.formPosition;
    const justInside = combatant('just-inside', form.x + 99, form.y);
    const justOutside = combatant('just-outside', form.x + 101, form.y);
    const result = advance(combat, 2.05, context([justInside, justOutside]));
    expect(result.pulls).toBe(1);
    expect(combat.meleePullRadius).toBe(100);
  });

  it('远程 L 束缚时间 +0.25 秒，普通敌人按 0.75 秒束缚', () => {
    const combat = createCombat();
    combat.setAggregationVortex(M03_PULL_RANGE_BONUS, M03_ROOT_BONUS_SECONDS);
    combat.tryActivateK(PLAYER);
    combat.tryActivateL();
    expect(combat.shallowAdaptationRootSeconds).toBeCloseTo(0.75, 10);
    const form = combat.formPosition;
    const target = combatant('target', form.x + 100, form.y);
    combat.step(STEP, context([target]));
    expect(combat.enemyRootRemaining('target')).toBeCloseTo(0.75, 10);
  });

  it('Boss 的束缚仍按 30% 转为减速（0.75→0.225）', () => {
    const combat = createCombat();
    combat.setAggregationVortex(M03_PULL_RANGE_BONUS, M03_ROOT_BONUS_SECONDS);
    combat.tryActivateK(PLAYER);
    combat.tryActivateL();
    const form = combat.formPosition;
    const target = combatant('boss', form.x + 100, form.y);
    combat.step(STEP, context([target], { isBoss: () => true }));
    expect(combat.enemyRootRemaining('boss')).toBe(0);
    expect(combat.enemySlowRemaining('boss')).toBeCloseTo(0.75 * 0.3, 10);
    expect(combat.enemySlowMultiplier('boss')).toBeCloseTo(0.5, 10);
  });
});

describe('M04 水镜共鸣', () => {
  it('J 命中时主流形补一次 40% 伤害攻击', () => {
    const combat = createCombat();
    combat.setWaterMirrorEcho(M04_DAMAGE_RATIO, M04_INTERNAL_COOLDOWN_SECONDS);
    const form = combat.formPosition;
    const target = combatant('target', form.x + 200, form.y);

    const echo = combat.resolveWaterMirrorHit(target);
    expect(echo).not.toBeNull();
    expect(echo?.source).toBe('form');
    expect(echo?.result.damage).toBeCloseTo(16 * M04_DAMAGE_RATIO, 10);
    expect(target.health.health).toBeCloseTo(
      1_000_000 - 16 * M04_DAMAGE_RATIO,
      10,
    );
  });

  it('内置冷却 0.6 秒内不重复补攻', () => {
    const combat = createCombat();
    combat.setWaterMirrorEcho(M04_DAMAGE_RATIO, M04_INTERNAL_COOLDOWN_SECONDS);
    const form = combat.formPosition;
    const target = combatant('target', form.x + 200, form.y);

    expect(combat.resolveWaterMirrorHit(target)).not.toBeNull();
    expect(combat.resolveWaterMirrorHit(target)).toBeNull();

    advance(combat, 0.61, context());
    expect(combat.resolveWaterMirrorHit(target)).not.toBeNull();
  });

  it('未拥有 M04 或主流形死亡时不补攻', () => {
    const base = createCombat();
    const form = base.formPosition;
    const target = combatant('target', form.x + 100, form.y);
    expect(base.resolveWaterMirrorHit(target)).toBeNull();

    const dead = createCombat();
    dead.setWaterMirrorEcho(M04_DAMAGE_RATIO, M04_INTERNAL_COOLDOWN_SECONDS);
    dead.damageForm(1000, 'true');
    expect(dead.resolveWaterMirrorHit(target)).toBeNull();
  });

  it('补攻不累计远程分裂计数：7 次自动攻击后仍无副本', () => {
    const combat = createCombat();
    combat.setWaterMirrorEcho(M04_DAMAGE_RATIO, M04_INTERNAL_COOLDOWN_SECONDS);
    combat.tryActivateK(PLAYER);
    const form = combat.formPosition;
    const target = combatant('dummy', form.x + 100, form.y);

    expect(combat.resolveWaterMirrorHit(target)).not.toBeNull();
    advance(combat, 5.2, context([target]));
    // 若补攻计入分裂，第 7 次自动攻击就会凑满 8 次并生成副本。
    expect(combat.copyCount).toBe(0);
    advance(combat, 1.0, context([target]));
    expect(combat.copyCount).toBe(1);
  });

  it('补攻不递归触发自身：每 0.6 秒最多一次', () => {
    const combat = createCombat();
    combat.setWaterMirrorEcho(M04_DAMAGE_RATIO, M04_INTERNAL_COOLDOWN_SECONDS);
    const form = combat.formPosition;
    const target = combatant('target', form.x + 200, form.y);

    let triggers = 0;
    for (let step = 0; step < 120; step += 1) {
      combat.step(STEP, context());
      if (combat.resolveWaterMirrorHit(target)) triggers += 1;
    }
    // 2 秒内最多 4 次（0、0.6、1.2、1.8 秒），不会因补攻自身产生额外触发。
    expect(triggers).toBeLessThanOrEqual(4);
    expect(triggers).toBeGreaterThanOrEqual(3);
  });

  it('补攻享受 G01 全局伤害倍率且不改变近战层数上限', () => {
    const combat = createCombat();
    combat.setDualForm(M01_RANGED_MAX_COPIES, M01_MELEE_MAX_STACKS);
    combat.setWaterMirrorEcho(M04_DAMAGE_RATIO, M04_INTERNAL_COOLDOWN_SECONDS);
    const form = combat.formPosition;
    const target = combatant('target', form.x + 200, form.y);
    const echo = combat.resolveWaterMirrorHit(target, { damageMultiplier: 1.3 });
    expect(echo?.result.damage).toBeCloseTo(16 * M04_DAMAGE_RATIO * 1.3, 10);
    // 近战补攻命中同样累计窃取层数，上限仍为 M01 的 8 层。
    expect(combat.formStacks).toBe(1);
  });
});

describe('缪尔赛思强化切换与副本总量', () => {
  it('切换形态保留生命百分比且反复切换不累积副本', () => {
    const combat = createCombat();
    combat.setDualForm(M01_RANGED_MAX_COPIES, M01_MELEE_MAX_STACKS);
    combat.damageForm(45, 'true');
    expect(combat.formHealth).toBeCloseTo(45, 10);

    for (let round = 0; round < 3; round += 1) {
      combat.reduceCooldown(10);
      const switched = combat.tryActivateK(PLAYER);
      expect(switched?.action).toBe('switch');
      if (combat.form === 'melee') {
        expect(combat.formHealth).toBeCloseTo(45, 10);
        expect(combat.copyCount).toBe(0);
      } else {
        expect(combat.formHealth).toBeCloseTo(45 * (60 / 90), 10);
        const form = combat.formPosition;
        const target = combatant('dummy', form.x + 100, form.y);
        advance(combat, 12.5, context([target]));
        expect(combat.copyCount).toBeLessThanOrEqual(M01_RANGED_MAX_COPIES);
      }
    }
  });
});

describe('缪尔赛思强化场景接入', () => {
  it('场景接线 M01–M04 与主流形回复提示', () => {
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );

    expect(sceneSource).toContain('setDualForm');
    expect(sceneSource).toContain('setEcologicalRecovery');
    expect(sceneSource).toContain('setAggregationVortex');
    expect(sceneSource).toContain('setWaterMirrorEcho');
    expect(sceneSource).toContain('resolveWaterMirrorHit');
    expect(sceneSource).toContain('showFormHeal');
    expect(sceneSource).toContain('meleePullRadius');
  });
});
