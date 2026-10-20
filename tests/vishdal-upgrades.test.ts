import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Combatant } from '../src/game/combat';
import { getCharacter, getUpgrade, listUpgradesForCharacter } from '../src/game/data';
import { UPGRADE_LIST } from '../src/game/data/upgrades';
import {
  GrenadeSystem,
  W01_EXTRA_AFTERSHOCK_DAMAGE_RATIO,
  W01_EXTRA_AFTERSHOCK_DELAY_SECONDS,
  W02_SPREAD_TARGETS,
} from '../src/game/grenade';
import {
  W04_LAST_SHOT_RADIUS_BONUS,
  W04_SHOTS,
  BurstSystem,
  burstHudText,
  type BurstConfig,
} from '../src/game/burst';
import { SoulSystem, W03_MAX_SUMMONS, type SoulMarkSink } from '../src/game/soul';
import { drawUpgradeHand, SeededRandom, type UpgradePoolState } from '../src/game/upgrade';

const ROOT = process.cwd();
const VISHDA = getCharacter('vishdal');
const AFTERIMAGE = VISHDA.passive.afterimage!;

function enemy(
  id: string,
  x: number,
  y: number,
  maxHealth = 1000,
  armor = 0,
): Combatant {
  return new Combatant({ id, x, y, radius: 12, maxHealth, armor });
}

function grenadeSystem(): GrenadeSystem {
  return new GrenadeSystem(VISHDA.attack, AFTERIMAGE);
}

function burstConfig(overrides: Partial<BurstConfig> = {}): BurstConfig {
  return {
    cooldownSeconds: 30,
    shots: 6,
    damageMultiplier: 2,
    splashRadiusMultiplier: 1.5,
    fireIntervalSeconds: 1.1,
    ammoExpirySeconds: 20,
    ...overrides,
  };
}

function burstSystem(): BurstSystem {
  return new BurstSystem(burstConfig());
}

function markSink(): SoulMarkSink & { readonly ids: Set<string> } {
  const ids = new Set<string>();
  return {
    ids,
    mark: (targetId) => ids.add(targetId),
    isMarked: (targetId) => ids.has(targetId),
  };
}

describe('W01 二次余震', () => {
  it('每发榴弹追加一次 0.7 秒后、直接伤害 50% 的余震', () => {
    const grenade = grenadeSystem();
    grenade.setSecondAftershock(true);
    const target = enemy('target', 100, 100);

    const detonation = grenade.detonate({ x: 100, y: 100 }, 'target', [target]);
    expect(detonation.extraAftershockDelaySeconds).toBeCloseTo(0.7, 12);
    expect(detonation.extraAftershockRadius).toBe(32);
    expect(grenade.pendingAftershockCount).toBe(2);

    // 0.35 秒只结算基础余震；目标带残影，追加 24 引爆伤害。
    const first = grenade.step(0.35, [target]);
    expect(first).toHaveLength(1);
    expect(first[0]?.hits[0]?.damage.damage).toBeCloseTo(18, 12);
    expect(target.health.health).toBeCloseTo(1000 - 36 - 18 - 24, 12);
    expect(grenade.pendingAftershockCount).toBe(1);

    // 0.7 秒时第二发余震才到，造成 36 的 50% = 18 物伤。
    const second = grenade.step(0.35, [target]);
    expect(second).toHaveLength(1);
    expect(second[0]?.hits[0]?.damage.damage).toBeCloseTo(18, 12);
    expect(grenade.pendingAftershockCount).toBe(0);
    expect(target.health.health).toBeCloseTo(1000 - 36 - 18 - 24 - 18, 12);
  });

  it('追加余震按该发实际直接伤害的 50% 计算', () => {
    const grenade = grenadeSystem();
    grenade.setSecondAftershock(true);
    const target = enemy('target', 100, 100);
    const empowered = {
      ...VISHDA.attack,
      damage: 72,
      splashRadius: 48,
      aftershock: { ...VISHDA.attack.aftershock!, damage: 36 },
    };

    grenade.detonate({ x: 100, y: 100 }, 'target', [target], empowered);
    grenade.step(0.35, [target]);
    const second = grenade.step(0.35, [target]);
    expect(second[0]?.hits[0]?.damage.damage).toBeCloseTo(36, 12);
  });

  it('未拥有 W01 时只登记基础余震', () => {
    const grenade = grenadeSystem();
    const target = enemy('target', 100, 100);

    const detonation = grenade.detonate({ x: 100, y: 100 }, 'target', [target]);
    expect(detonation.extraAftershockDelaySeconds).toBeNull();
    expect(detonation.extraAftershockRadius).toBeNull();
    expect(grenade.pendingAftershockCount).toBe(1);
  });
});

describe('W02 标记传染', () => {
  it('残影引爆给周围最多 2 个未标记敌人附着残影，本次爆炸不引爆新标记', () => {
    const grenade = grenadeSystem();
    grenade.setMarkSpread(true);
    const primary = enemy('primary', 100, 100);
    const dead = enemy('dead', 110, 100, 10);
    const near1 = enemy('near1', 120, 100);
    const near2 = enemy('near2', 130, 100);
    const near3 = enemy('near3', 140, 100);
    const far = enemy('far', 145, 100);
    const targets = [primary, dead, near1, near2, near3, far];

    grenade.detonate({ x: 100, y: 100 }, 'primary', targets);
    const resolutions = grenade.step(0.35, targets);

    expect(resolutions).toHaveLength(1);
    const explosion = resolutions[0]?.explosions[0];
    if (!explosion) throw new Error('缺少残影爆炸');
    // 最近的 near1 / near2 获得标记；near3 超出 2 个上限，far 超出 42 半径。
    expect(explosion.spreadTargetIds).toEqual(['near1', 'near2']);
    expect(grenade.isMarked('near1')).toBe(true);
    expect(grenade.isMarked('near2')).toBe(true);
    expect(grenade.isMarked('near3')).toBe(false);
    expect(grenade.isMarked('far')).toBe(false);
    expect(grenade.isMarked('primary')).toBe(false);
    expect(grenade.isMarked('dead')).toBe(false);
    // 新标记没有在本次爆炸中引爆：本次只有 primary 一个引爆源。
    expect(resolutions[0]?.explosions).toHaveLength(1);
  });

  it('W01+W02 同时存在时不会无限递归', () => {
    const grenade = grenadeSystem();
    grenade.setSecondAftershock(true);
    grenade.setMarkSpread(true);
    const primary = enemy('primary', 100, 100);
    const near1 = enemy('near1', 120, 100);
    const near2 = enemy('near2', 130, 100);
    const near3 = enemy('near3', 140, 100);
    const far = enemy('far', 145, 100);
    const targets = [primary, near1, near2, near3, far];

    grenade.detonate({ x: 100, y: 100 }, 'primary', targets);

    // 0.35 秒：基础余震引爆 primary，并向 near1/near2 扩散标记。
    const first = grenade.step(0.35, targets);
    expect(first[0]?.explosions).toHaveLength(1);
    expect(first[0]?.explosions[0]?.spreadTargetIds).toEqual(['near1', 'near2']);

    // 0.7 秒：W01 追加余震可引爆扩散出的标记，但每次爆炸最多再扩散 2 个。
    const second = grenade.step(0.35, targets);
    expect(second).toHaveLength(1);
    const explosions = second[0]?.explosions ?? [];
    expect(explosions.length).toBeGreaterThan(0);
    for (const explosion of explosions) {
      expect(explosion.spreadTargetIds.length).toBeLessThanOrEqual(W02_SPREAD_TARGETS);
    }

    // 追加余震用完后不再生成新余震；持续步进不会产生新的爆炸链。
    expect(grenade.pendingAftershockCount).toBe(0);
    const markedAfterChain = [...grenade.markedIds].sort();
    for (let step = 0; step < 120; step += 1) {
      expect(grenade.step(1 / 60, targets)).toHaveLength(0);
    }
    expect([...grenade.markedIds].sort()).toEqual(markedAfterChain);
    expect(grenade.pendingAftershockCount).toBe(0);
  });

  it('未拥有 W02 时引爆不扩散标记', () => {
    const grenade = grenadeSystem();
    const primary = enemy('primary', 100, 100);
    const near = enemy('near', 120, 100);

    grenade.detonate({ x: 100, y: 100 }, 'primary', [primary, near]);
    const resolutions = grenade.step(0.35, [primary, near]);

    expect(resolutions[0]?.explosions[0]?.spreadTargetIds).toEqual([]);
    expect(grenade.isMarked('near')).toBe(false);
  });
});

describe('W03 亡魂伴行', () => {
  it('魂灵上限提升到 2；每次 K 仍只召唤一个，达到上限替换最早者', () => {
    const marks = markSink();
    const soul = new SoulSystem(
      {
        cooldownSeconds: 5,
        durationSeconds: 100,
        maxSummons: 1,
        tickSeconds: 1.5,
        markRadius: 240,
        slowPercent: 0.2,
        slowDurationSeconds: 1,
      },
      marks,
    );

    soul.setMaxSummons(W03_MAX_SUMMONS);
    expect(soul.maxSummons).toBe(2);

    expect(soul.trySummon({ x: 0, y: 0 })?.soul.id).toBe(1);
    expect(soul.soulCount).toBe(1);

    soul.step(5, []);
    const second = soul.trySummon({ x: 10, y: 0 });
    expect(second?.replacedSoulId).toBeNull();
    expect(soul.soulCount).toBe(2);

    soul.step(5, []);
    const third = soul.trySummon({ x: 20, y: 0 });
    expect(third?.replacedSoulId).toBe(1);
    expect(soul.soulCount).toBe(2);
    expect(soul.snapshots.map((snapshot) => snapshot.id)).toEqual([2, 3]);

    // 清除覆盖后恢复角色配置的 1 个上限。
    soul.setMaxSummons(null);
    expect(soul.maxSummons).toBe(1);
  });
});

describe('W04 追加装药', () => {
  it('弹药 6→9，HUD 使用同一个上限', () => {
    const burst = burstSystem();
    burst.setAmmoUpgrade(true);

    expect(burst.maxAmmo).toBe(9);
    expect(burst.tryActivate()).toBe(true);
    expect(burst.ammoRemaining).toBe(9);
    expect(burstHudText(burst)).toContain('9/9');

    for (let shot = 9; shot >= 1; shot -= 1) {
      expect(burst.nextShotIsLast).toBe(shot === 1);
      expect(burst.consumeShot()).toBe(true);
    }
    expect(burst.ammoRemaining).toBe(0);
    expect(burst.consumeShot()).toBe(false);
  });

  it('最后一发溅射半径额外 +25%，其余发与伤害余震不变', () => {
    const burst = burstSystem();
    burst.setAmmoUpgrade(true);
    burst.tryActivate();

    const normal = burst.modifyAttack(VISHDA.attack);
    expect(normal.splashRadius).toBeCloseTo(48, 12);
    expect(normal.damage).toBeCloseTo(72, 12);
    expect(normal.aftershock?.damage).toBeCloseTo(36, 12);

    const last = burst.modifyAttack(VISHDA.attack, true);
    // 32 × 1.5（爆裂黎明）× 1.25（W04）= 60。
    expect(last.splashRadius).toBeCloseTo(60, 12);
    expect(last.damage).toBeCloseTo(72, 12);
    expect(last.aftershock?.damage).toBeCloseTo(36, 12);
  });

  it('未拥有 W04 时弹药仍为 6，最后一发没有额外范围', () => {
    const burst = burstSystem();
    burst.tryActivate();

    expect(burst.maxAmmo).toBe(6);
    expect(burst.ammoRemaining).toBe(6);
    expect(burst.modifyAttack(VISHDA.attack, true).splashRadius).toBeCloseTo(48, 12);
  });

  it('生效中获取 W04 立即补足新增弹药，不刷新失效时间', () => {
    const burst = burstSystem();
    burst.tryActivate();
    burst.consumeShot();
    burst.consumeShot();
    burst.step(2);
    const expiryBefore = burst.ammoExpiresInSeconds;

    burst.setAmmoUpgrade(true);

    expect(burst.maxAmmo).toBe(9);
    expect(burst.ammoRemaining).toBe(7);
    expect(burstHudText(burst)).toContain('7/9');
    expect(burst.ammoExpiresInSeconds).toBeCloseTo(expiryBefore, 9);
  });
});

describe('角色过滤与数值同源', () => {
  it('W01–W04 只出现在维什戴尔可抽池，层数上限均为 1', () => {
    const vishdalIds = listUpgradesForCharacter('vishdal')
      .filter((upgrade) => upgrade.id.startsWith('W'))
      .map((upgrade) => upgrade.id);
    expect(vishdalIds).toEqual(['W01', 'W02', 'W03', 'W04']);

    for (const characterId of ['amiya', 'saria', 'muelsyse'] as const) {
      expect(
        listUpgradesForCharacter(characterId).some((upgrade) =>
          upgrade.id.startsWith('W'),
        ),
      ).toBe(false);
    }

    for (const id of vishdalIds) {
      expect(getUpgrade(id).owner).toBe('vishdal');
      expect(getUpgrade(id).maxStacks).toBe(1);
    }
  });

  it('非维什戴尔角色的抽取不会出现 W 卡', () => {
    const random = new SeededRandom(20261020);
    const state: UpgradePoolState = {
      characterId: 'amiya',
      pool: UPGRADE_LIST,
      stacks: new Map(),
    };
    for (let draw = 0; draw < 30; draw += 1) {
      const hand = drawUpgradeHand(() => random.next(), state);
      expect(hand.some((upgrade) => upgrade.id.startsWith('W'))).toBe(false);
    }
  });

  it('战斗常量与卡片 params 同源', () => {
    expect(W01_EXTRA_AFTERSHOCK_DELAY_SECONDS).toBe(
      getUpgrade('W01').params?.delaySeconds,
    );
    expect(W01_EXTRA_AFTERSHOCK_DAMAGE_RATIO).toBe(
      getUpgrade('W01').params?.damageRatio,
    );
    expect(W02_SPREAD_TARGETS).toBe(getUpgrade('W02').params?.spreadTargets);
    expect(W03_MAX_SUMMONS).toBe(getUpgrade('W03').params?.maxSummons);
    expect(W04_SHOTS).toBe(getUpgrade('W04').params?.shots);
    expect(W04_LAST_SHOT_RADIUS_BONUS).toBe(
      getUpgrade('W04').params?.lastShotRadiusBonus,
    );
  });
});

describe('场景接入', () => {
  it('竞技场场景把 W01–W04 推给对应系统并支持开发场景预置', () => {
    const source = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );

    expect(source).toContain('setSecondAftershock');
    expect(source).toContain('setMarkSpread');
    expect(source).toContain('setMaxSummons');
    expect(source).toContain('setAmmoUpgrade');
    expect(source).toContain('burst.modifyAttack(this.character.attack, lastShot)');
    expect(source).toContain('burstHudText');
    expect(source).toContain('this.devScenario?.upgrades');
    expect(source).toContain('this.upgradeRun.stacksOf(\'W01\')');
    expect(source).toContain('this.upgradeRun.stacksOf(\'W02\')');
    expect(source).toContain('this.upgradeRun.stacksOf(\'W03\')');
    expect(source).toContain('this.upgradeRun.stacksOf(\'W04\')');
  });
});
