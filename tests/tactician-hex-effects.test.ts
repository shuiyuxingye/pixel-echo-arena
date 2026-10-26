import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/game/arena';
import { Combatant } from '../src/game/combat';
import { getCharacter, HEX_LIST } from '../src/game/data';
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
import {
  TACTICIAN_HEX_IDS,
  TACTICIAN_HEX_PARAMS,
  TacticianHexEffects,
  isTacticianHexId,
  resolveTacticianAggregationVortex,
  resolveTacticianDualForm,
  resolveTacticianEcologicalRecovery,
  resolveTacticianWaterMirror,
  type TacticianHexSnapshot,
} from '../src/game/tactician-hex-effects';

const STEP = 1 / 60;
const MUELSYSE = getCharacter('muelsyse');
const PLAYER = { x: 720, y: 480 };
const SCENE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/game/scenes/ArenaScene.ts'),
  'utf8',
);

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

function tacticianWith(...hexIds: readonly string[]): TacticianHexEffects {
  const owned = new Set(hexIds);
  return new TacticianHexEffects({ has: (hexId) => owned.has(hexId) });
}

/** 按场景的合并顺序把 H43–H48 同步到主形；M01–M04 按需传入。 */
function syncTactician(
  combat: MuelsyseCombat,
  options: {
    readonly hexes?: readonly string[];
    readonly m01?: boolean;
    readonly m02?: boolean;
    readonly m03?: boolean;
    readonly m04?: boolean;
  } = {},
): TacticianHexEffects {
  const hexes = tacticianWith(...(options.hexes ?? []));
  const dualForm = resolveTacticianDualForm(
    {
      maxCopies: combat.baseMaxCopies,
      maxMeleeStacks: combat.baseMaxMeleeStacks,
    },
    options.m01
      ? {
          maxCopies: M01_RANGED_MAX_COPIES,
          maxMeleeStacks: M01_MELEE_MAX_STACKS,
        }
      : null,
    hexes.has('H43'),
  );
  combat.setDualForm(
    dualForm?.maxCopies ?? null,
    dualForm?.maxMeleeStacks ?? null,
  );
  const recovery = resolveTacticianEcologicalRecovery(
    options.m02
      ? {
          healPercentPerSecond: M02_HEAL_PERCENT_PER_SECOND,
          healOnActivatePercent: M02_HEAL_ON_ACTIVATE_PERCENT,
        }
      : null,
    hexes.has('H44'),
  );
  combat.setEcologicalRecovery(
    recovery?.healPercentPerSecond ?? 0,
    recovery?.healOnActivatePercent ?? 0,
  );
  const vortex = resolveTacticianAggregationVortex(
    options.m03
      ? {
          pullRangeBonus: M03_PULL_RANGE_BONUS,
          rootBonusSeconds: M03_ROOT_BONUS_SECONDS,
        }
      : null,
    hexes.has('H45'),
  );
  combat.setAggregationVortex(
    vortex?.pullRangeBonus ?? 0,
    vortex?.rootBonusSeconds ?? 0,
  );
  const mirror = resolveTacticianWaterMirror(
    options.m04
      ? {
          damageRatio: M04_DAMAGE_RATIO,
          internalCooldownSeconds: M04_INTERNAL_COOLDOWN_SECONDS,
        }
      : null,
    hexes.has('H47'),
  );
  combat.setWaterMirrorEcho(
    mirror?.damageRatio ?? 0,
    mirror?.internalCooldownSeconds ?? 0,
  );
  combat.setTacticianSummonBonuses(
    hexes.summonDamageMultiplier,
    hexes.summonHealthMultiplier,
  );
  combat.setFormRelay(hexes.attackSpeedBonusRatio, hexes.attackSpeedBonusSeconds);
  return hexes;
}

describe('战术家专属海克斯目录', () => {
  it('恰好覆盖 H43–H48 且都存在于海克斯目录', () => {
    expect(TACTICIAN_HEX_IDS).toEqual([
      'H43',
      'H44',
      'H45',
      'H46',
      'H47',
      'H48',
    ]);
    for (const hexId of TACTICIAN_HEX_IDS) {
      expect(isTacticianHexId(hexId)).toBe(true);
      expect(TACTICIAN_HEX_PARAMS[hexId]).toBeDefined();
      expect(HEX_LIST.some((hex) => hex.id === hexId)).toBe(true);
    }
    expect(isTacticianHexId('H42')).toBe(false);
    expect(isTacticianHexId('H49')).toBe(false);
  });

  it('六张牌都属于战术家且与 02 的品质一致', () => {
    const rarities: Record<string, string> = {
      H43: '棱彩',
      H44: '金',
      H45: '金',
      H46: '银',
      H47: '棱彩',
      H48: '金',
    };
    for (const hexId of TACTICIAN_HEX_IDS) {
      const hex = HEX_LIST.find((entry) => entry.id === hexId);
      expect(hex?.owner).toBe('战术家');
      expect(hex?.rarity).toBe(rarities[hexId]);
    }
  });

  it('六张牌的数值与 02 内容目录一致', () => {
    expect(TACTICIAN_HEX_PARAMS.H43.rangedMaxCopiesBonus).toBe(1);
    expect(TACTICIAN_HEX_PARAMS.H43.meleeMaxStacksBonus).toBe(3);
    expect(TACTICIAN_HEX_PARAMS.H44.healPercentPerSecond).toBeCloseTo(0.02, 10);
    expect(TACTICIAN_HEX_PARAMS.H44.healOnActivatePercent).toBeCloseTo(0.2, 10);
    expect(TACTICIAN_HEX_PARAMS.H45.pullRangeBonus).toBeCloseTo(0.3, 10);
    expect(TACTICIAN_HEX_PARAMS.H45.rootBonusSeconds).toBeCloseTo(0.25, 10);
    expect(TACTICIAN_HEX_PARAMS.H46.summonDamageMultiplier).toBeCloseTo(1.35, 10);
    expect(TACTICIAN_HEX_PARAMS.H46.summonHealthMultiplier).toBeCloseTo(0.75, 10);
    expect(TACTICIAN_HEX_PARAMS.H47.damageRatio).toBeCloseTo(0.4, 10);
    expect(TACTICIAN_HEX_PARAMS.H47.internalCooldownSeconds).toBeCloseTo(0.6, 10);
    expect(TACTICIAN_HEX_PARAMS.H48.attackSpeedBonusRatio).toBeCloseTo(0.4, 10);
    expect(TACTICIAN_HEX_PARAMS.H48.attackSpeedBonusSeconds).toBe(3);
  });
});

describe('H43 双生流形', () => {
  it('只有 H43 时在基础值上 +1 副本 / +3 窃取', () => {
    const limits = resolveTacticianDualForm(
      { maxCopies: 1, maxMeleeStacks: 5 },
      null,
      true,
    );
    expect(limits).toEqual({ maxCopies: 2, maxMeleeStacks: 8 });
  });

  it('未拥有 M01/H43 时返回 null，交回角色基础配置', () => {
    expect(
      resolveTacticianDualForm({ maxCopies: 1, maxMeleeStacks: 5 }, null, false),
    ).toBeNull();
  });

  it('M01 与 H43 同时拥有不叠成 +2 / +6', () => {
    const legacy = {
      maxCopies: M01_RANGED_MAX_COPIES,
      maxMeleeStacks: M01_MELEE_MAX_STACKS,
    };
    expect(
      resolveTacticianDualForm({ maxCopies: 1, maxMeleeStacks: 5 }, legacy, true),
    ).toEqual({ maxCopies: 2, maxMeleeStacks: 8 });
    expect(
      resolveTacticianDualForm({ maxCopies: 1, maxMeleeStacks: 5 }, legacy, false),
    ).toEqual({ maxCopies: 2, maxMeleeStacks: 8 });
  });

  it('基础值变化时上限随基础值走', () => {
    expect(
      resolveTacticianDualForm({ maxCopies: 3, maxMeleeStacks: 5 }, null, true),
    ).toEqual({ maxCopies: 4, maxMeleeStacks: 8 });
  });

  it('远程副本上限 1→2，第二个副本可实际生成', () => {
    for (const [hasH43, expected] of [
      [false, 1],
      [true, 2],
    ] as const) {
      const combat = createCombat();
      syncTactician(combat, { hexes: hasH43 ? ['H43'] : [] });
      expect(combat.maxCopies).toBe(expected);
      combat.tryActivateK(PLAYER);
      const form = combat.formPosition;
      const target = combatant('dummy', form.x + 100, form.y);
      advance(combat, 10, context([target]));
      expect(combat.copyCount).toBe(1);
      expect(combat.tryActivateL().activated).toBe(true);
      advance(combat, 2.5, context([target]));
      expect(combat.copyCount).toBe(expected);
    }
  });

  it('近战窃取层数上限 5→8', () => {
    const combat = createCombat();
    syncTactician(combat, { hexes: ['H43'] });
    expect(combat.maxMeleeStacks).toBe(8);
    const form = combat.formPosition;
    const target = combatant('dummy', form.x + 60, form.y);
    advance(combat, 0.7 * 10, context([target]));
    expect(combat.formStacks).toBe(8);
    expect(combat.formDamage).toBe(16 + 8 * 2);
  });
});

describe('H44 生态复苏', () => {
  it('只有 H44 时按目录数值合并', () => {
    expect(resolveTacticianEcologicalRecovery(null, false)).toBeNull();
    expect(resolveTacticianEcologicalRecovery(null, true)).toEqual({
      healPercentPerSecond: 0.02,
      healOnActivatePercent: 0.2,
    });
  });

  it('M02 与 H44 同时拥有沿用同一组数值，不叠成双倍回复', () => {
    const recovery = resolveTacticianEcologicalRecovery(
      {
        healPercentPerSecond: M02_HEAL_PERCENT_PER_SECOND,
        healOnActivatePercent: M02_HEAL_ON_ACTIVATE_PERCENT,
      },
      true,
    );
    expect(recovery).toEqual({
      healPercentPerSecond: M02_HEAL_PERCENT_PER_SECOND,
      healOnActivatePercent: M02_HEAL_ON_ACTIVATE_PERCENT,
    });

    const combat = createCombat();
    syncTactician(combat, { hexes: ['H44'], m02: true });
    combat.damageForm(50, 'true');
    const half = advance(combat, 0.5, context());
    expect(half.formHealed).toBe(0);
    const one = advance(combat, 0.5, context());
    expect(one.formHealed).toBeCloseTo(90 * 0.02, 10);
  });

  it('主流形每秒回复 2%，L 开启时回复 20%', () => {
    const combat = createCombat();
    syncTactician(combat, { hexes: ['H44'] });
    combat.damageForm(50, 'true');
    expect(combat.tryActivateL().activated).toBe(true);
    expect(combat.formHealth).toBeCloseTo(40 + 90 * 0.2, 10);
    const healed = advance(combat, 1, context());
    expect(healed.formHealed).toBeCloseTo(90 * 0.02, 10);
  });
});

describe('H45 聚合涡旋', () => {
  it('只有 H45 时拉拽范围 +30%、束缚 +0.25 秒', () => {
    expect(resolveTacticianAggregationVortex(null, false)).toBeNull();
    expect(resolveTacticianAggregationVortex(null, true)).toEqual({
      pullRangeBonus: 0.3,
      rootBonusSeconds: 0.25,
    });
  });

  it('M03 与 H45 同时拥有不叠成 +60% / +0.5 秒', () => {
    const vortex = resolveTacticianAggregationVortex(
      {
        pullRangeBonus: M03_PULL_RANGE_BONUS,
        rootBonusSeconds: M03_ROOT_BONUS_SECONDS,
      },
      true,
    );
    expect(vortex).toEqual({
      pullRangeBonus: M03_PULL_RANGE_BONUS,
      rootBonusSeconds: M03_ROOT_BONUS_SECONDS,
    });

    const combat = createCombat();
    syncTactician(combat, { hexes: ['H45'], m03: true });
    expect(combat.meleePullRadius).toBeCloseTo(130, 10);
    expect(combat.shallowAdaptationRootSeconds).toBeCloseTo(0.75, 10);
  });

  it('半径 130 内拉拽、130.5 外不拉拽；远程束缚 0.75 秒', () => {
    const combat = createCombat();
    syncTactician(combat, { hexes: ['H45'] });
    expect(combat.meleePullRadius).toBeCloseTo(130, 10);
    combat.tryActivateL();
    const form = combat.formPosition;
    const inside = combatant('inside', form.x + 130, form.y);
    const outside = combatant('outside', form.x + 130.5, form.y);
    const result = advance(combat, 2.05, context([inside, outside]));
    expect(result.pulls).toBe(1);

    const ranged = createCombat();
    syncTactician(ranged, { hexes: ['H45'] });
    ranged.tryActivateK(PLAYER);
    ranged.tryActivateL();
    const target = combatant('target', ranged.formPosition.x + 100, ranged.formPosition.y);
    ranged.step(STEP, context([target]));
    expect(ranged.enemyRootRemaining('target')).toBeCloseTo(0.75, 10);
  });
});

describe('H46 脆弱军团', () => {
  it('召唤物伤害 +35%、生命 −25%', () => {
    expect(tacticianWith().summonDamageMultiplier).toBe(1);
    expect(tacticianWith().summonHealthMultiplier).toBe(1);
    const hexes = tacticianWith('H46');
    expect(hexes.summonDamageMultiplier).toBeCloseTo(1.35, 10);
    expect(hexes.summonHealthMultiplier).toBeCloseTo(0.75, 10);
  });

  it('主流形生命上限 90→67.5，当前生命被钳制', () => {
    const combat = createCombat();
    expect(combat.formMaxHealth).toBe(90);
    syncTactician(combat, { hexes: ['H46'] });
    expect(combat.formMaxHealth).toBeCloseTo(67.5, 10);
    expect(combat.formHealth).toBeCloseTo(67.5, 10);
  });

  it('主流形与 H47 补攻都按 1.35 倍结算', () => {
    const combat = createCombat();
    syncTactician(combat, { hexes: ['H46'] });
    const form = combat.formPosition;
    const target = combatant('target', form.x + 60, form.y);
    const result = advance(combat, STEP, context([target]));
    expect(result.attacks).toBe(1);
    expect(target.health.health).toBeCloseTo(1_000_000 - 16 * 1.35, 10);

    const echoCombat = createCombat();
    syncTactician(echoCombat, { hexes: ['H46', 'H47'] });
    const echoTarget = combatant(
      'echo',
      echoCombat.formPosition.x + 200,
      echoCombat.formPosition.y,
    );
    const echo = echoCombat.resolveWaterMirrorHit(echoTarget);
    expect(echo?.result.damage).toBeCloseTo(16 * 0.4 * 1.35, 10);
    expect(echoCombat.formMaxHealth).toBeCloseTo(67.5, 10);
  });
});

describe('H47 水镜共鸣', () => {
  it('只有 H47 时补攻 40%、冷却 0.6 秒', () => {
    expect(resolveTacticianWaterMirror(null, false)).toBeNull();
    expect(resolveTacticianWaterMirror(null, true)).toEqual({
      damageRatio: 0.4,
      internalCooldownSeconds: 0.6,
    });
  });

  it('M04 与 H47 同时拥有不叠成双倍补攻', () => {
    const mirror = resolveTacticianWaterMirror(
      {
        damageRatio: M04_DAMAGE_RATIO,
        internalCooldownSeconds: M04_INTERNAL_COOLDOWN_SECONDS,
      },
      true,
    );
    expect(mirror).toEqual({
      damageRatio: M04_DAMAGE_RATIO,
      internalCooldownSeconds: M04_INTERNAL_COOLDOWN_SECONDS,
    });
  });

  it('J 命中补一次 40% 攻击，内置冷却 0.6 秒', () => {
    const combat = createCombat();
    syncTactician(combat, { hexes: ['H47'] });
    const form = combat.formPosition;
    const target = combatant('target', form.x + 200, form.y);
    const echo = combat.resolveWaterMirrorHit(target);
    expect(echo).not.toBeNull();
    expect(echo?.result.damage).toBeCloseTo(16 * 0.4, 10);
    expect(combat.resolveWaterMirrorHit(target)).toBeNull();
    advance(combat, 0.61, context());
    expect(combat.resolveWaterMirrorHit(target)).not.toBeNull();
  });

  it('补攻不触发远程分裂计数', () => {
    const combat = createCombat();
    syncTactician(combat, { hexes: ['H47'] });
    combat.tryActivateK(PLAYER);
    const form = combat.formPosition;
    const target = combatant('dummy', form.x + 100, form.y);
    expect(combat.resolveWaterMirrorHit(target)).not.toBeNull();
    advance(combat, 5.2, context([target]));
    expect(combat.copyCount).toBe(0);
    advance(combat, 1.0, context([target]));
    expect(combat.copyCount).toBe(1);
  });
});

describe('H48 形态接力', () => {
  it('未拥有时攻速倍率保持 1，切换后也没有窗口', () => {
    const combat = createCombat();
    syncTactician(combat);
    expect(combat.attackSpeedMultiplier).toBe(1);
    expect(combat.tryActivateK(PLAYER)?.action).toBe('switch');
    expect(combat.formRelayRemainingSeconds).toBe(0);
    expect(combat.attackSpeedMultiplier).toBe(1);
    expect(combat.effectiveAttackIntervalSeconds).toBeCloseTo(0.8, 10);
  });

  it('切换后 3 秒召唤物攻速 +40%，3 秒后恢复', () => {
    const combat = createCombat();
    syncTactician(combat, { hexes: ['H48'] });
    expect(combat.attackSpeedMultiplier).toBe(1);
    combat.tryActivateK(PLAYER);
    expect(combat.formRelayRemainingSeconds).toBeCloseTo(3, 10);
    expect(combat.attackSpeedMultiplier).toBeCloseTo(1.4, 10);
    // 切到远程形态：0.8 秒 / 1.4 ≈ 0.5714 秒。
    expect(combat.effectiveAttackIntervalSeconds).toBeCloseTo(0.8 / 1.4, 10);

    advance(combat, 2.9, context());
    expect(combat.attackSpeedMultiplier).toBeCloseTo(1.4, 10);
    advance(combat, 0.2, context());
    expect(combat.formRelayRemainingSeconds).toBe(0);
    expect(combat.attackSpeedMultiplier).toBe(1);
    expect(combat.effectiveAttackIntervalSeconds).toBeCloseTo(0.8, 10);
  });

  it('窗口内的实际攻击更频繁', () => {
    const boosted = createCombat();
    syncTactician(boosted, { hexes: ['H48'] });
    boosted.tryActivateK(PLAYER);
    const targetA = combatant(
      'dummy-a',
      boosted.formPosition.x + 100,
      boosted.formPosition.y,
    );
    const boostedAttacks = advance(boosted, 2.4, context([targetA])).attacks;

    const base = createCombat();
    base.tryActivateK(PLAYER);
    const targetB = combatant(
      'dummy-b',
      base.formPosition.x + 100,
      base.formPosition.y,
    );
    const baseAttacks = advance(base, 2.4, context([targetB])).attacks;

    expect(boostedAttacks).toBeGreaterThan(baseAttacks);
    // 0.5714 秒一发：2.4 秒内 5 发；0.8 秒一发：3 发。
    expect(boostedAttacks).toBe(5);
    expect(baseAttacks).toBe(3);
  });

  it('切换仍遵守 K 冷却，H48 不跳过冷却', () => {
    const combat = createCombat();
    syncTactician(combat, { hexes: ['H48'] });
    expect(combat.tryActivateK(PLAYER)?.action).toBe('switch');
    expect(combat.tryActivateK(PLAYER)).toBeNull();
    // 6 秒冷却结束后才能再次切换。
    advance(combat, 5.9, context());
    expect(combat.tryActivateK(PLAYER)).toBeNull();
    advance(combat, 0.2, context());
    expect(combat.tryActivateK(PLAYER)?.action).toBe('switch');
  });

  it('重建不开启形态接力窗口', () => {
    const combat = createCombat();
    syncTactician(combat, { hexes: ['H48'] });
    combat.damageForm(1_000, 'true');
    const rebuilt = combat.tryActivateK(PLAYER);
    expect(rebuilt?.action).toBe('rebuild');
    expect(combat.formRelayRemainingSeconds).toBe(0);
    expect(combat.attackSpeedMultiplier).toBe(1);
  });

  it('波初清空剩余窗口，快照/恢复保留剩余秒数', () => {
    const combat = createCombat();
    syncTactician(combat, { hexes: ['H48'] });
    combat.tryActivateK(PLAYER);
    advance(combat, 1, context());
    expect(combat.formRelayRemainingSeconds).toBeCloseTo(2, 10);

    const restored = createCombat();
    syncTactician(restored, { hexes: ['H48'] });
    restored.restoreWorld(combat.snapshotWorld());
    expect(restored.formRelayRemainingSeconds).toBeCloseTo(2, 10);
    expect(restored.attackSpeedMultiplier).toBeCloseTo(1.4, 10);

    combat.resetForWaveStart();
    expect(combat.formRelayRemainingSeconds).toBe(0);
    expect(combat.attackSpeedMultiplier).toBe(1);
  });
});

describe('战术家海克斯开发快照', () => {
  it('快照含六张牌的参数与 H48 剩余窗口', () => {
    const hexes = tacticianWith('H43', 'H46', 'H48');
    const snapshot: TacticianHexSnapshot = hexes.snapshot(1.5);
    expect(snapshot.hexes).toEqual(['H43', 'H46', 'H48']);
    expect(snapshot.dualForm).toEqual({
      rangedMaxCopiesBonus: 1,
      meleeMaxStacksBonus: 3,
    });
    expect(snapshot.fragileLegion).toEqual({
      summonDamageMultiplier: 1.35,
      summonHealthMultiplier: 0.75,
    });
    expect(snapshot.formRelay).toEqual({
      attackSpeedBonusRatio: 0.4,
      attackSpeedBonusSeconds: 3,
      remainingSeconds: 1.5,
    });
    expect(snapshot.waterMirror).toEqual({
      damageRatio: 0.4,
      internalCooldownSeconds: 0.6,
    });
  });

  it('未拥有任何战术家海克斯时仍是完整快照', () => {
    const snapshot = tacticianWith().snapshot();
    expect(snapshot.hexes).toEqual([]);
    expect(snapshot.fragileLegion.summonDamageMultiplier).toBe(1);
    expect(snapshot.fragileLegion.summonHealthMultiplier).toBe(1);
    expect(snapshot.formRelay.remainingSeconds).toBe(0);
  });
});

describe('场景接线', () => {
  it('场景合并 M01–M04 与 H43–H48 后只调用一次 setter', () => {
    expect(SCENE_SOURCE).toContain("from '../tactician-hex-effects'");
    expect(SCENE_SOURCE).toContain('resolveTacticianDualForm(');
    expect(SCENE_SOURCE).toContain('resolveTacticianEcologicalRecovery(');
    expect(SCENE_SOURCE).toContain('resolveTacticianAggregationVortex(');
    expect(SCENE_SOURCE).toContain('resolveTacticianWaterMirror(');
    expect(SCENE_SOURCE).toContain('setTacticianSummonBonuses(');
    expect(SCENE_SOURCE).toContain('setFormRelay(');
    expect(SCENE_SOURCE).toContain('tacticianHexes: this.tacticianHexes.snapshot(');
    // 旧强化与新海克斯同效果：每个 setter 只在合并入口出现一次。
    expect(SCENE_SOURCE.match(/this\.muelsyse\.setDualForm\(/g)).toHaveLength(1);
    expect(SCENE_SOURCE.match(/this\.muelsyse\.setWaterMirrorEcho\(/g)).toHaveLength(
      1,
    );
  });
});
