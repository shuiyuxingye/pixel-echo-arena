import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArenaLayout } from '../src/game/arena';
import { HealthState, type DamageResult } from '../src/game/combat';
import {
  ELITE_LIST,
  ELITE_WAVE_HEALTH,
  ELITE_WAVES,
  getEliteById,
  getEliteForWave,
  getEnemy,
  getWave,
  type DamageType,
  type EnemyDefinition,
} from '../src/game/data';
import {
  ELITE_ATTACK_WARNING_SECONDS,
  EliteCoreTracker,
  coreRewardForElite,
} from '../src/game/elite';
import {
  EnemySystem,
  type EnemyEliteBlastHit,
  type EnemyPlayerTarget,
  type EnemyStepContext,
} from '../src/game/enemy';
import { ENEMY_WARNING, FRIENDLY_EFFECT_DEPTH } from '../src/game/feedback';
import { scaleEliteForWave } from '../src/game/wave';

const STEP = 1 / 60;
const LAYOUT = createArenaLayout();
const ROOT = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

function player(x: number, y: number, isInvulnerable = false): EnemyPlayerTarget {
  return { x, y, radius: 12, isInvulnerable };
}

interface DamageSink {
  readonly health: HealthState;
  readonly calls: { damage: number; damageType: DamageType; result: DamageResult }[];
  readonly apply: (damage: number, damageType: DamageType) => DamageResult;
}

function damageSink(maxHealth = 5000): DamageSink {
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

function context(target: EnemyPlayerTarget, sink: DamageSink): EnemyStepContext {
  return { player: target, applyPlayerDamage: sink.apply };
}

function eliteDefinition(wave: number): EnemyDefinition {
  const definition = getWave(wave).elite;
  if (!definition) throw new Error(`wave ${wave} has no elite`);
  return scaleEliteForWave(definition, wave);
}

describe('精英四档生命与身份', () => {
  it('6/9/12/15 波精英生命初值为 600/1000/1600/2400', () => {
    expect(ELITE_WAVES).toEqual([6, 9, 12, 15]);
    expect(ELITE_WAVE_HEALTH).toEqual({ 6: 600, 9: 1000, 12: 1600, 15: 2400 });

    const expected = [600, 1000, 1600, 2400];
    [6, 9, 12, 15].forEach((wave, index) => {
      const definition = getEliteForWave(wave);
      expect(definition?.maxHealth).toBe(expected[index]);
      expect(scaleEliteForWave(definition!, wave).maxHealth).toBe(expected[index]);
    });
  });

  it('每名精英有唯一 ID 并绑定唯一核心奖励，保留基础行为差异', () => {
    expect(new Set(ELITE_LIST.map((elite) => elite.id)).size).toBe(ELITE_LIST.length);
    expect(new Set(ELITE_LIST.map((elite) => elite.coreRewardId)).size).toBe(
      ELITE_LIST.length,
    );
    expect(new Set(ELITE_LIST.map((elite) => elite.enemyId)).size).toBe(ELITE_LIST.length);

    const behaviors: Readonly<Record<string, string>> = {
      blob: 'chase',
      spitter: 'spit',
      charger: 'charge',
      bulwark: 'guard',
    };
    for (const elite of ELITE_LIST) {
      const scaled = scaleEliteForWave(elite, elite.wave);
      expect(scaled.elite).toBe(true);
      expect(scaled.eliteId).toBe(elite.id);
      expect(scaled.coreRewardId).toBe(elite.coreRewardId);
      expect(scaled.behavior).toBe(behaviors[getEliteById(elite.id)?.enemyId ?? '']);
    }
  });
});

describe('精英攻击预警', () => {
  it('预警时长不低于 0.8 秒，预警圈与落地按同一 id 配对', () => {
    expect(ELITE_ATTACK_WARNING_SECONDS).toBeGreaterThanOrEqual(0.8);

    const system = new EnemySystem({ layout: LAYOUT });
    const target = player(900, 480);
    const sink = damageSink();
    system.addEnemy(eliteDefinition(12), 400, 480);

    let warningId: number | null = null;
    for (let step = 0; step < 240 && warningId === null; step += 1) {
      system.step(STEP, context(target, sink));
      const warning = system.eliteBlasts[0];
      if (warning) {
        warningId = warning.id;
        expect(warning.remainingSeconds).toBeCloseTo(ELITE_ATTACK_WARNING_SECONDS, 6);
      }
    }
    expect(warningId).not.toBeNull();

    const hits: EnemyEliteBlastHit[] = [];
    for (let step = 0; step < 120 && hits.length === 0; step += 1) {
      hits.push(...system.step(STEP, context(target, sink)).eliteBlastHits);
    }
    expect(hits).toHaveLength(1);
    expect(hits[0]?.blastId).toBe(warningId);
    expect(hits[0]?.damage).not.toBeNull();
    expect(system.eliteBlasts).toHaveLength(0);
  });

  it('精英冲锋前摇抬到 0.9 秒，普通冲锋者仍是 0.7 秒', () => {
    const eliteSystem = new EnemySystem({ layout: LAYOUT });
    const elite = eliteSystem.addEnemy(eliteDefinition(6), 700, 480);
    const target = player(900, 480);
    const sink = damageSink();
    for (let step = 0; step < 120 && elite.activity !== 'windup'; step += 1) {
      eliteSystem.step(STEP, context(target, sink));
    }
    expect(elite.activity).toBe('windup');
    expect(elite.windupRemaining).toBeCloseTo(0.9, 6);
    expect(getEnemy('charger').attack?.windupSeconds).toBeCloseTo(0.7, 6);
  });
});

describe('精英核心资格绑定', () => {
  it('只有击败指定精英 ID 才记资格，重复击败不重复记录', () => {
    const tracker = new EliteCoreTracker();
    expect(tracker.rewardIds).toEqual([]);

    // 未击败：不调用 registerEliteDefeat，资格保持为空。
    expect(tracker.rewardIds).toEqual([]);

    expect(tracker.registerEliteDefeat('elite-6')).toBe('core-6');
    expect(tracker.rewardIds).toEqual(['core-6']);
    expect(tracker.registerEliteDefeat('elite-6')).toBeNull();
    expect(tracker.rewardIds).toEqual(['core-6']);

    // 未知/未绑定 ID 不产生资格。
    expect(tracker.registerEliteDefeat('elite-99')).toBeNull();
    expect(tracker.registerEliteDefeat(undefined)).toBeNull();
    expect(tracker.rewardIds).toEqual(['core-6']);
  });

  it('恢复时只接受已知核心奖励并去重', () => {
    const tracker = new EliteCoreTracker();
    tracker.restore(['core-9', 'core-9', 'unknown', 'core-15']);
    expect(tracker.rewardIds).toEqual(['core-9', 'core-15']);
    expect(tracker.hasReward('core-9')).toBe(true);
    expect(coreRewardForElite('elite-12')).toBe('core-12');
    expect(coreRewardForElite('elite-99')).toBeNull();
  });

  it('场景只在击杀分支记录资格，并按同一 id 移除精英预警', () => {
    const scene = readSource('src/game/scenes/ArenaScene.ts');
    expect(scene).toContain('registerEliteDefeat(view.unit.enemy.eliteId)');
    expect(scene).toContain('if (result.died)');
    expect(scene.indexOf('registerEliteDefeat')).toBeGreaterThan(scene.indexOf('if (result.died)'));
    expect(scene).toContain('removeEliteBlastView(hit.blastId)');
    expect(scene).toContain('syncEliteBlastWarnings');
  });
});

describe('精英预警可读性', () => {
  it('精英预警使用敌方警戒层，高于友方爆炸与施法脉冲', () => {
    expect(ENEMY_WARNING.depth).toBeGreaterThan(FRIENDLY_EFFECT_DEPTH.explosion);
    expect(ENEMY_WARNING.depth).toBeGreaterThan(FRIENDLY_EFFECT_DEPTH.castPulse);
    const scene = readSource('src/game/scenes/ArenaScene.ts');
    const sync = scene.slice(
      scene.indexOf('private syncEliteBlastWarnings'),
      scene.indexOf('private removeEliteBlastView'),
    );
    expect(sync).toContain('ENEMY_WARNING.depth');
    expect(sync).toContain('blast.id');
  });
});
