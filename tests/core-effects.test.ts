import { describe, expect, it } from 'vitest';
import {
  CoreEffects,
  E01_COOLDOWN_SECONDS,
  E01_HITS_REQUIRED,
  E01_RADIUS_BONUS,
  E02_HITS_REQUIRED,
  E02_TRIGGER_DAMAGE,
  E03_MAX_TRIGGERS_PER_RUN,
  E04_SUMMON_DAMAGE_BONUS,
  E05_DAMAGE_BONUS_PER_STACK,
  E05_GOLD_PER_STACK,
  E05_MAX_DAMAGE_BONUS,
  E06_CASTS_REQUIRED,
  E06_ECHO_DELAY_SECONDS,
  E06_ECHO_STRENGTH,
  E07_DAMAGE_BONUS,
  E07_DODGE_COOLDOWN_REDUCTION,
  E07_HEALTH_THRESHOLD,
  E08_HITS_REQUIRED,
  E08_SIDE_BULLET_COUNT,
  E08_SIDE_BULLET_DAMAGE_RATIO,
  validateCoreEffectsSnapshot,
} from '../src/game/core-effects';
import { DamageChainTracker } from '../src/game/damage-events';
import { requireCoreParam } from '../src/game/data';

function createEffects(...coreIds: string[]): CoreEffects {
  const owned = new Set(coreIds);
  return new CoreEffects({ hasCore: (coreId) => owned.has(coreId) });
}

describe('E01 炉心契约', () => {
  it('未拥有时不累计、不蓄力', () => {
    const effects = createEffects();
    expect(effects.recordExplosionHits(['a', 'b', 'c'])).toBe(false);
    expect(effects.e01Armed).toBe(false);
    expect(effects.consumeExplosionRadiusMultiplier()).toBe(1);
  });

  it('需要 3 个不同敌人；重复命中同一敌人不重复计数', () => {
    const effects = createEffects('E01');
    expect(effects.recordExplosionHits(['a', 'b'])).toBe(false);
    expect(effects.recordExplosionHits(['a', 'b'])).toBe(false);
    expect(effects.recordExplosionHits(['b', 'c'])).toBe(true);
    expect(effects.e01ChargedTargetIds).toEqual([]);
    expect(effects.e01Armed).toBe(true);
  });

  it('蓄力后下一次爆炸 +35%，消耗后回到 1', () => {
    const effects = createEffects('E01');
    effects.recordExplosionHits(['a', 'b', 'c']);
    expect(effects.consumeExplosionRadiusMultiplier()).toBeCloseTo(
      1 + E01_RADIUS_BONUS,
      10,
    );
    expect(effects.consumeExplosionRadiusMultiplier()).toBe(1);
    expect(effects.e01Armed).toBe(false);
  });

  it('蓄力期间重复命中不会叠加，也不会重置冷却', () => {
    const effects = createEffects('E01');
    effects.recordExplosionHits(['a', 'b', 'c']);
    expect(effects.recordExplosionHits(['d', 'e', 'f'])).toBe(false);
    effects.step(E01_COOLDOWN_SECONDS / 2);
    expect(effects.consumeExplosionRadiusMultiplier()).toBeCloseTo(
      1 + E01_RADIUS_BONUS,
      10,
    );
    expect(effects.e01CooldownRemaining).toBeCloseTo(
      E01_COOLDOWN_SECONDS / 2,
      10,
    );
  });

  it('冷却 2 秒内不能再次蓄力，结束后重新累计 3 个不同敌人', () => {
    const effects = createEffects('E01');
    effects.recordExplosionHits(['a', 'b', 'c']);
    effects.consumeExplosionRadiusMultiplier();

    expect(effects.recordExplosionHits(['a', 'b', 'c'])).toBe(false);
    effects.step(E01_COOLDOWN_SECONDS - 0.1);
    expect(effects.e01CooldownRemaining).toBeCloseTo(0.1, 10);
    expect(effects.recordExplosionHits(['a', 'b', 'c'])).toBe(false);

    effects.step(0.1);
    expect(effects.e01CooldownRemaining).toBe(0);
    expect(effects.recordExplosionHits(['a', 'b'])).toBe(false);
    expect(effects.recordExplosionHits(['c'])).toBe(true);
  });

  it('非法步长不推进冷却', () => {
    const effects = createEffects('E01');
    effects.recordExplosionHits(['a', 'b', 'c']);
    effects.step(Number.NaN);
    effects.step(-1);
    expect(effects.e01CooldownRemaining).toBe(E01_COOLDOWN_SECONDS);
  });
});

describe('E02 星蚀之眼', () => {
  it('未拥有时不计次', () => {
    const effects = createEffects();
    const chains = new DamageChainTracker();
    const source = chains.beginNative('J');
    for (let hit = 0; hit < E02_HITS_REQUIRED; hit += 1) {
      expect(effects.registerSpellHit(source, chains)).toBeNull();
    }
    expect(effects.e02Hits).toBe(0);
  });

  it('第 8 次命中触发 90 真实伤害并重置计数', () => {
    const effects = createEffects('E02');
    const chains = new DamageChainTracker();
    const source = chains.beginNative('J');

    for (let hit = 1; hit < E02_HITS_REQUIRED; hit += 1) {
      expect(effects.registerSpellHit(source, chains)).toBeNull();
      expect(effects.e02Hits).toBe(hit);
    }

    const trigger = effects.registerSpellHit(source, chains);
    expect(trigger).not.toBeNull();
    expect(trigger?.damage).toBe(E02_TRIGGER_DAMAGE);
    expect(trigger?.source.origin).toBe('derived');
    expect(trigger?.source.depth).toBe(1);
    expect(trigger?.source.chainId).toBe(source.chainId);
    expect(trigger?.source.sourceId).toBe('E02');
    expect(effects.e02Hits).toBe(0);
    expect(effects.e02Triggers).toBe(1);

    // 触发之后重新从 0 开始累计。
    expect(effects.registerSpellHit(source, chains)).toBeNull();
    expect(effects.e02Hits).toBe(1);
  });

  it('触发伤害不能再派生，也不继续计数（递归上限）', () => {
    const effects = createEffects('E02');
    const chains = new DamageChainTracker();
    const native = chains.beginNative('J');
    for (let hit = 1; hit < E02_HITS_REQUIRED; hit += 1) {
      effects.registerSpellHit(native, chains);
    }
    const trigger = effects.registerSpellHit(native, chains);
    expect(trigger).not.toBeNull();
    if (!trigger) return;

    // 模拟触发伤害自己的命中事件：衍生来源直接拒绝。
    expect(effects.registerSpellHit(trigger.source, chains)).toBeNull();
    expect(effects.e02Hits).toBe(0);
    expect(effects.e02Triggers).toBe(1);
    expect(chains.derive(trigger.source, 'E02')).toBeNull();
  });
});

describe('E03 不屈圣印', () => {
  it('未拥有时不保命', () => {
    expect(createEffects().tryPreventDeath()).toBe(false);
  });

  it('每波首次生效，第二次同波不再触发', () => {
    const effects = createEffects('E03');
    expect(effects.tryPreventDeath()).toBe(true);
    expect(effects.tryPreventDeath()).toBe(false);
    expect(effects.e03UsedThisWave).toBe(true);
    expect(effects.e03UsedThisRun).toBe(1);
  });

  it('新波重新获得一次机会，每局最多 3 次', () => {
    const effects = createEffects('E03');
    for (let wave = 0; wave < E03_MAX_TRIGGERS_PER_RUN; wave += 1) {
      effects.startWave();
      expect(effects.tryPreventDeath()).toBe(true);
    }
    effects.startWave();
    expect(effects.tryPreventDeath()).toBe(false);
    expect(effects.e03UsedThisRun).toBe(E03_MAX_TRIGGERS_PER_RUN);
  });

  it('startWave 不清除每局次数', () => {
    const effects = createEffects('E03');
    effects.tryPreventDeath();
    effects.startWave();
    expect(effects.e03UsedThisRun).toBe(1);
    expect(effects.e03UsedThisWave).toBe(false);
  });
});

describe('E04 群落意志', () => {
  it('未拥有时召唤物倍率为 1，拥有时 +20%', () => {
    expect(createEffects().summonDamageMultiplier).toBe(1);
    expect(createEffects('E04').summonDamageMultiplier).toBeCloseTo(
      1 + E04_SUMMON_DAMAGE_BONUS,
      10,
    );
  });

  it('数值全部来自内容目录参数', () => {
    expect(E01_HITS_REQUIRED).toBe(
      requireCoreParam('E01', 'hitsRequired'),
    );
    expect(E01_RADIUS_BONUS).toBe(requireCoreParam('E01', 'radiusBonus'));
    expect(E02_TRIGGER_DAMAGE).toBe(requireCoreParam('E02', 'damage'));
    expect(E04_SUMMON_DAMAGE_BONUS).toBe(
      requireCoreParam('E04', 'summonDamageBonus'),
    );
    expect(E05_GOLD_PER_STACK).toBe(requireCoreParam('E05', 'goldPerStack'));
    expect(E05_MAX_DAMAGE_BONUS).toBe(
      requireCoreParam('E05', 'maxDamageBonus'),
    );
    expect(E06_ECHO_STRENGTH).toBe(requireCoreParam('E06', 'echoStrength'));
    expect(E07_DAMAGE_BONUS).toBe(requireCoreParam('E07', 'damageBonus'));
    expect(E08_SIDE_BULLET_COUNT).toBe(
      requireCoreParam('E08', 'sideBulletCount'),
    );
  });
});

describe('E05 猎金之约', () => {
  it('未拥有时不累计也不加成', () => {
    const effects = createEffects();
    effects.recordKillGold(120);
    effects.endWave();
    expect(effects.e05KillGoldThisWave).toBe(0);
    expect(effects.e05DamageBonus).toBe(0);
  });

  it('每 30 击杀金币 +3%，不足 30 的部分不计层', () => {
    const effects = createEffects('E05');
    effects.recordKillGold(E05_GOLD_PER_STACK - 1);
    effects.endWave();
    expect(effects.e05DamageBonus).toBe(0);

    effects.recordKillGold(E05_GOLD_PER_STACK);
    effects.endWave();
    expect(effects.e05DamageBonus).toBeCloseTo(E05_DAMAGE_BONUS_PER_STACK, 10);
    expect(effects.e05Stacks).toBe(1);

    effects.recordKillGold(E05_GOLD_PER_STACK * 2 + E05_GOLD_PER_STACK - 1);
    effects.endWave();
    expect(effects.e05Stacks).toBe(3);
    expect(effects.e05DamageBonus).toBeCloseTo(
      E05_DAMAGE_BONUS_PER_STACK * 3,
      10,
    );
  });

  it('加成在波末生成，下一波开始仍保留，本波计数清零', () => {
    const effects = createEffects('E05');
    effects.recordKillGold(E05_GOLD_PER_STACK * 2);
    expect(effects.e05DamageBonus).toBe(0);
    effects.endWave();
    expect(effects.e05KillGoldThisWave).toBe(0);
    expect(effects.e05DamageBonus).toBeCloseTo(
      E05_DAMAGE_BONUS_PER_STACK * 2,
      10,
    );

    effects.startWave();
    expect(effects.e05DamageBonus).toBeCloseTo(
      E05_DAMAGE_BONUS_PER_STACK * 2,
      10,
    );
    effects.recordKillGold(E05_GOLD_PER_STACK);
    effects.endWave();
    expect(effects.e05Stacks).toBe(3);
  });

  it('累计加成上限为 +30%，超出部分不再累计', () => {
    const effects = createEffects('E05');
    effects.recordKillGold(E05_GOLD_PER_STACK * 100);
    effects.endWave();
    expect(effects.e05DamageBonus).toBeCloseTo(E05_MAX_DAMAGE_BONUS, 10);

    effects.recordKillGold(E05_GOLD_PER_STACK * 10);
    effects.endWave();
    expect(effects.e05DamageBonus).toBeCloseTo(E05_MAX_DAMAGE_BONUS, 10);
  });

  it('非法金币与被动的完成奖励不进入本波计数', () => {
    const effects = createEffects('E05');
    effects.recordKillGold(Number.NaN);
    effects.recordKillGold(-20);
    effects.recordKillGold(0);
    expect(effects.e05KillGoldThisWave).toBe(0);
  });
});

describe('E06 回响之核', () => {
  it('未拥有时不计次也不排入复施', () => {
    const effects = createEffects();
    for (let cast = 0; cast < E06_CASTS_REQUIRED; cast += 1) {
      expect(effects.registerSkillCast('U')).toBe(false);
    }
    effects.step(E06_ECHO_DELAY_SECONDS);
    expect(effects.e06EchoReady).toBe(false);
    expect(effects.consumeSkillEcho()).toBeNull();
  });

  it('第 3 次释放后 1 秒才可就绪，强度 45%', () => {
    const effects = createEffects('E06');
    expect(effects.registerSkillCast('U')).toBe(false);
    expect(effects.registerSkillCast('I')).toBe(false);
    expect(effects.registerSkillCast('U')).toBe(true);
    expect(effects.e06Casts).toBe(0);
    expect(effects.e06EchoPending).toBe(true);
    expect(effects.e06EchoRemainingSeconds).toBeCloseTo(
      E06_ECHO_DELAY_SECONDS,
      10,
    );

    effects.step(E06_ECHO_DELAY_SECONDS - 0.01);
    expect(effects.e06EchoReady).toBe(false);
    expect(effects.consumeSkillEcho()).toBeNull();

    effects.step(0.01);
    expect(effects.e06EchoReady).toBe(true);
    const trigger = effects.consumeSkillEcho();
    expect(trigger).toEqual({ slot: 'U', strength: E06_ECHO_STRENGTH });
    expect(effects.e06Echoes).toBe(1);
    expect(effects.e06EchoPending).toBe(false);
    expect(effects.consumeSkillEcho()).toBeNull();
  });

  it('复施不累计释放次数，也不会递归排入下一次复施', () => {
    const effects = createEffects('E06');
    for (let cast = 0; cast < E06_CASTS_REQUIRED; cast += 1) {
      effects.registerSkillCast('I');
    }
    effects.step(E06_ECHO_DELAY_SECONDS);
    effects.consumeSkillEcho();

    effects.step(10);
    expect(effects.e06EchoPending).toBe(false);
    expect(effects.e06Echoes).toBe(1);
    expect(effects.e06Casts).toBe(0);
  });

  it('待执行期间再次累计到第 3 次不会叠加第二个复施', () => {
    const effects = createEffects('E06');
    for (let cast = 0; cast < E06_CASTS_REQUIRED; cast += 1) {
      effects.registerSkillCast('U');
    }
    let scheduled = false;
    for (let cast = 0; cast < E06_CASTS_REQUIRED; cast += 1) {
      scheduled = effects.registerSkillCast('U') || scheduled;
    }
    expect(scheduled).toBe(false);
    effects.step(E06_ECHO_DELAY_SECONDS);
    expect(effects.consumeSkillEcho()).not.toBeNull();
    expect(effects.e06Echoes).toBe(1);
  });

  it('非法技能槽不计数', () => {
    const effects = createEffects('E06');
    effects.registerSkillCast('');
    expect(effects.e06Casts).toBe(0);
  });

  it('波初清空未执行的复施，但保留已累计的释放次数', () => {
    const effects = createEffects('E06');
    effects.registerSkillCast('U');
    effects.registerSkillCast('I');
    effects.registerSkillCast('U');
    expect(effects.e06EchoPending).toBe(true);

    effects.clearSkillEcho();
    expect(effects.e06EchoPending).toBe(false);
    expect(effects.e06EchoRemainingSeconds).toBe(0);
    effects.step(E06_ECHO_DELAY_SECONDS);
    expect(effects.consumeSkillEcho()).toBeNull();
    expect(effects.e06Echoes).toBe(0);
    expect(effects.e06Casts).toBe(0);
  });
});

describe('E07 逆风齿轮', () => {
  it('未拥有时任何生命比例都不触发', () => {
    const effects = createEffects();
    expect(effects.updateLowHealth(1, 100)).toBe(false);
    expect(effects.e07Active).toBe(false);
    expect(effects.e07DamageBonus).toBe(0);
    expect(effects.dodgeCooldownMultiplier).toBe(1);
  });

  it('严格低于 50% 才触发，并提供 +20% 伤害与 −25% 闪避冷却', () => {
    const effects = createEffects('E07');
    const max = 200;
    expect(effects.updateLowHealth(max * E07_HEALTH_THRESHOLD, max)).toBe(false);
    expect(effects.e07Active).toBe(false);

    expect(effects.updateLowHealth(max * E07_HEALTH_THRESHOLD - 1, max)).toBe(
      true,
    );
    expect(effects.e07Active).toBe(true);
    expect(effects.e07DamageBonus).toBeCloseTo(E07_DAMAGE_BONUS, 10);
    expect(effects.dodgeCooldownMultiplier).toBeCloseTo(
      1 - E07_DODGE_COOLDOWN_REDUCTION,
      10,
    );
  });

  it('回到阈值以上实时关闭', () => {
    const effects = createEffects('E07');
    expect(effects.updateLowHealth(40, 100)).toBe(true);
    expect(effects.updateLowHealth(60, 100)).toBe(false);
    expect(effects.e07Active).toBe(false);
    expect(effects.e07DamageBonus).toBe(0);
    expect(effects.dodgeCooldownMultiplier).toBe(1);
  });

  it('非法生命值不触发', () => {
    const effects = createEffects('E07');
    expect(effects.updateLowHealth(Number.NaN, 100)).toBe(false);
    expect(effects.updateLowHealth(10, 0)).toBe(false);
    expect(effects.updateLowHealth(-1, 100)).toBe(false);
  });
});

describe('E08 折光王冠', () => {
  it('未拥有时不计数', () => {
    const effects = createEffects();
    const chains = new DamageChainTracker();
    const source = chains.beginNative('J');
    for (let hit = 0; hit < E08_HITS_REQUIRED; hit += 1) {
      expect(effects.registerJHit(source, chains)).toBeNull();
    }
    expect(effects.e08Hits).toBe(0);
  });

  it('第 6 次 J 命中触发 2 枚 30% 侧弹并清零计数', () => {
    const effects = createEffects('E08');
    const chains = new DamageChainTracker();
    const source = chains.beginNative('J');

    for (let hit = 1; hit < E08_HITS_REQUIRED; hit += 1) {
      expect(effects.registerJHit(source, chains)).toBeNull();
      expect(effects.e08Hits).toBe(hit);
    }

    const trigger = effects.registerJHit(source, chains);
    expect(trigger).not.toBeNull();
    expect(trigger?.count).toBe(E08_SIDE_BULLET_COUNT);
    expect(trigger?.damageRatio).toBeCloseTo(E08_SIDE_BULLET_DAMAGE_RATIO, 10);
    expect(trigger?.source.origin).toBe('derived');
    expect(trigger?.source.depth).toBe(1);
    expect(trigger?.source.chainId).toBe(source.chainId);
    expect(trigger?.source.sourceId).toBe('E08');
    expect(effects.e08Hits).toBe(0);
    expect(effects.e08Triggers).toBe(1);
  });

  it('侧弹等衍生命中不累计计数，也不能再次触发', () => {
    const effects = createEffects('E08');
    const chains = new DamageChainTracker();
    const source = chains.beginNative('J');
    for (let hit = 0; hit < E08_HITS_REQUIRED - 1; hit += 1) {
      effects.registerJHit(source, chains);
    }
    const trigger = effects.registerJHit(source, chains);
    expect(trigger).not.toBeNull();
    if (!trigger) return;

    for (let hit = 0; hit < E08_HITS_REQUIRED * 2; hit += 1) {
      expect(effects.registerJHit(trigger.source, chains)).toBeNull();
    }
    expect(effects.e08Hits).toBe(0);
    expect(effects.e08Triggers).toBe(1);
    expect(chains.derive(trigger.source, 'E08')).toBeNull();
  });

  it('触发后重新从 0 开始累计', () => {
    const effects = createEffects('E08');
    const chains = new DamageChainTracker();
    const source = chains.beginNative('J');
    for (let hit = 0; hit < E08_HITS_REQUIRED; hit += 1) {
      effects.registerJHit(source, chains);
    }
    expect(effects.registerJHit(source, chains)).toBeNull();
    expect(effects.e08Hits).toBe(1);
  });
});

describe('核心效果快照', () => {
  it('往返恢复蓄力、冷却与次数', () => {
    const effects = createEffects('E01', 'E02', 'E03');
    effects.recordExplosionHits(['a', 'b']);
    effects.step(0.75);
    const chains = new DamageChainTracker();
    const source = chains.beginNative('J');
    for (let hit = 0; hit < 3; hit += 1) effects.registerSpellHit(source, chains);
    effects.tryPreventDeath();

    const snapshot = effects.snapshot();
    const restored = createEffects('E01', 'E02', 'E03');
    restored.restore(snapshot);

    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.e01ChargedTargetIds).toEqual(['a', 'b']);
    expect(restored.e02Hits).toBe(3);
    expect(restored.e03UsedThisWave).toBe(true);
  });

  it('损坏快照被拒绝并回到初始状态', () => {
    const effects = createEffects('E01', 'E02', 'E03');
    effects.tryPreventDeath();

    expect(
      validateCoreEffectsSnapshot({
        ...effects.snapshot(),
        e02Hits: E02_HITS_REQUIRED,
      }),
    ).toBe(false);

    effects.restore({
      e01DistinctTargets: ['a'],
      e01Armed: 'yes',
      e01CooldownRemaining: -1,
      e02Hits: Number.NaN,
      e02Triggers: 0,
      e03UsedThisWave: true,
      e03UsedThisRun: 9,
    } as never);

    expect(effects.snapshot()).toEqual({
      e01DistinctTargets: [],
      e01Armed: false,
      e01CooldownRemaining: 0,
      e02Hits: 0,
      e02Triggers: 0,
      e03UsedThisWave: false,
      e03UsedThisRun: 0,
      e05KillGoldThisWave: 0,
      e05DamageBonus: 0,
      e06Casts: 0,
      e06Echoes: 0,
      e06EchoRemainingSeconds: 0,
      e06EchoPending: false,
      e07Active: false,
      e08Hits: 0,
      e08Triggers: 0,
    });
  });

  it('E05–E08 状态随快照往返，旧快照缺字段按初始值恢复', () => {
    const effects = createEffects('E05', 'E06', 'E07', 'E08');
    effects.recordKillGold(E05_GOLD_PER_STACK * 2);
    effects.endWave();
    effects.registerSkillCast('U');
    effects.registerSkillCast('I');
    effects.registerSkillCast('U');
    effects.step(0.4);
    effects.updateLowHealth(20, 100);
    const chains = new DamageChainTracker();
    const source = chains.beginNative('J');
    for (let hit = 0; hit < 3; hit += 1) effects.registerJHit(source, chains);

    const snapshot = effects.snapshot();
    const restored = createEffects('E05', 'E06', 'E07', 'E08');
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.e05DamageBonus).toBeCloseTo(
      E05_DAMAGE_BONUS_PER_STACK * 2,
      10,
    );
    expect(restored.e06EchoPending).toBe(true);
    expect(restored.e06EchoRemainingSeconds).toBeCloseTo(
      E06_ECHO_DELAY_SECONDS - 0.4,
      10,
    );
    expect(restored.snapshot().e06EchoSlot).toBe('U');
    expect(restored.e07Active).toBe(true);
    expect(restored.e08Hits).toBe(3);

    const legacy = createEffects('E05', 'E06', 'E07', 'E08');
    legacy.restore({
      e01DistinctTargets: [],
      e01Armed: false,
      e01CooldownRemaining: 0,
      e02Hits: 0,
      e02Triggers: 0,
      e03UsedThisWave: false,
      e03UsedThisRun: 0,
    });
    expect(legacy.e05DamageBonus).toBe(0);
    expect(legacy.e06EchoPending).toBe(false);
    expect(legacy.e07Active).toBe(false);
    expect(legacy.e08Hits).toBe(0);
  });

  it('resetRun 清空所有计数', () => {
    const effects = createEffects('E01', 'E02', 'E03');
    effects.recordExplosionHits(['a', 'b', 'c']);
    effects.tryPreventDeath();
    effects.resetRun();
    expect(effects.e01Armed).toBe(false);
    expect(effects.e01CooldownRemaining).toBe(0);
    expect(effects.e03UsedThisRun).toBe(0);
  });
});
