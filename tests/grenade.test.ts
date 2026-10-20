import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Combatant } from '../src/game/combat';
import { getCharacter } from '../src/game/data';
import { GrenadeSystem } from '../src/game/grenade';

const ROOT = process.cwd();
const VISHDA = getCharacter('vishdal');
// 维什戴尔的被动在数据配置中必须存在残影参数。
const AFTERIMAGE = VISHDA.passive.afterimage!;

const STEP = 1 / 60;
const AFTERSHOCK_DELAY_STEPS = 21;

function enemy(
  id: string,
  x: number,
  y: number,
  maxHealth = 1000,
  armor = 0,
): Combatant {
  return new Combatant({ id, x, y, radius: 12, maxHealth, armor });
}

function system(): GrenadeSystem {
  return new GrenadeSystem(VISHDA.attack, AFTERIMAGE);
}

describe('榴弹直接命中', () => {
  it('以命中点为中心造成 36 物伤，半径 32 包含边界', () => {
    const grenade = system();
    const primary = enemy('primary', 100, 100);
    const inside = enemy('inside', 131, 100);
    const edge = enemy('edge', 132, 100);
    const outside = enemy('outside', 133, 100);

    const detonation = grenade.detonate({ x: 100, y: 100 }, 'primary', [
      primary,
      inside,
      edge,
      outside,
    ]);

    expect(detonation.hits.map((hit) => hit.targetId)).toEqual(['primary', 'inside', 'edge']);
    for (const hit of detonation.hits) {
      expect(hit.damage.applied).toBe(true);
      expect(hit.damage.damage).toBeCloseTo(36, 12);
    }
    expect(primary.health.health).toBeCloseTo(964, 12);
    expect(inside.health.health).toBeCloseTo(964, 12);
    expect(edge.health.health).toBeCloseTo(964, 12);
    expect(outside.health.health).toBe(1000);
  });

  it('只有直接命中的主目标附着残影，溅射到的其他敌人不附着', () => {
    const grenade = system();
    const primary = enemy('primary', 100, 100);
    const splashed = enemy('splashed', 120, 100);

    const detonation = grenade.detonate({ x: 100, y: 100 }, 'primary', [primary, splashed]);

    expect(detonation.primaryTargetId).toBe('primary');
    expect(detonation.markedTargetId).toBe('primary');
    expect(grenade.isMarked('primary')).toBe(true);
    expect(grenade.isMarked('splashed')).toBe(false);
  });

  it('主目标死亡后不附着残影', () => {
    const grenade = system();
    const primary = enemy('primary', 100, 100, 30);

    const detonation = grenade.detonate({ x: 100, y: 100 }, 'primary', [primary]);

    expect(primary.isAlive).toBe(false);
    expect(detonation.markedTargetId).toBeNull();
    expect(grenade.isMarked('primary')).toBe(false);
  });
});

describe('延时余震', () => {
  it('0.35 秒前不结算，到点后在同一位置造成 18 物伤并引爆残影', () => {
    const grenade = system();
    const primary = enemy('primary', 100, 100);

    grenade.detonate({ x: 100, y: 100 }, 'primary', [primary]);
    expect(primary.health.health).toBeCloseTo(964, 12);
    expect(grenade.pendingAftershockCount).toBe(1);

    for (let step = 1; step < AFTERSHOCK_DELAY_STEPS; step += 1) {
      expect(grenade.step(STEP, [primary])).toHaveLength(0);
    }
    expect(primary.health.health).toBeCloseTo(964, 12);
    expect(grenade.pendingAftershockCount).toBe(1);

    const resolutions = grenade.step(STEP, [primary]);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({ x: 100, y: 100, radius: 32 });
    expect(resolutions[0]?.hits.map((hit) => hit.targetId)).toEqual(['primary']);
    // 余震本身固定造成 18 物伤。
    expect(resolutions[0]?.hits[0]?.damage.damage).toBeCloseTo(18, 12);
    // 主目标在直接命中时已附着残影，余震命中后立即消耗标记并追加 24 物伤爆炸。
    expect(resolutions[0]?.explosions).toHaveLength(1);
    expect(primary.health.health).toBeCloseTo(964 - 18 - 24, 12);
    expect(grenade.isMarked('primary')).toBe(false);
    expect(grenade.pendingAftershockCount).toBe(0);
  });

  it('绑定命中位置而不是目标：主目标死亡后仍在原位置爆炸', () => {
    const grenade = system();
    const primary = enemy('primary', 100, 100, 30);
    const bystander = enemy('bystander', 120, 100);

    grenade.detonate({ x: 100, y: 100 }, 'primary', [primary, bystander]);
    expect(primary.isAlive).toBe(false);

    const resolutions = grenade.step(0.35, [primary, bystander]);

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.x).toBe(100);
    expect(resolutions[0]?.y).toBe(100);
    // 旁观者先吃 36 直接溅射，再吃 18 余震。
    expect(bystander.health.health).toBeCloseTo(1000 - 36 - 18, 12);
  });

  it('按逻辑步长累计，与渲染帧长无关', () => {
    const grenade = system();
    const primary = enemy('primary', 100, 100);

    grenade.detonate({ x: 100, y: 100 }, 'primary', [primary]);
    expect(grenade.step(0.2, [primary])).toHaveLength(0);
    expect(grenade.step(0.149, [primary])).toHaveLength(0);
    expect(grenade.step(0.001, [primary])).toHaveLength(1);
  });
});

describe('残影引爆', () => {
  it('余震命中带残影目标时消耗标记，造成半径 42、24 物伤与 0.3 秒眩晕', () => {
    const grenade = system();
    const primary = enemy('primary', 100, 100);
    // 距离命中点 41：不在 32 余震半径内，但在残影爆炸的 42 半径边界内。
    const inside = enemy('inside', 141, 100);
    const edge = enemy('edge', 142, 100);
    const outside = enemy('outside', 143, 100);

    grenade.detonate({ x: 100, y: 100 }, 'primary', [primary, inside, edge, outside]);
    const resolutions = grenade.step(0.35, [primary, inside, edge, outside]);

    expect(resolutions).toHaveLength(1);
    const resolution = resolutions[0];
    if (!resolution) throw new Error('缺少余震结算');
    expect(resolution.hits.map((hit) => hit.targetId)).toEqual(['primary']);
    expect(resolution.explosions).toHaveLength(1);
    const explosion = resolution.explosions[0];
    if (!explosion) throw new Error('缺少残影爆炸');
    expect(explosion).toMatchObject({ sourceTargetId: 'primary', radius: 42, stunSeconds: 0.3 });
    expect(explosion.hits.map((hit) => hit.targetId)).toEqual(['primary', 'inside', 'edge']);
    for (const hit of explosion.hits) {
      expect(hit.damage.damage).toBeCloseTo(24, 12);
    }

    expect(primary.health.health).toBeCloseTo(1000 - 36 - 18 - 24, 12);
    expect(inside.health.health).toBeCloseTo(1000 - 24, 12);
    expect(edge.health.health).toBeCloseTo(1000 - 24, 12);
    expect(outside.health.health).toBe(1000);

    expect(grenade.isMarked('primary')).toBe(false);
    expect(grenade.stunRemaining('primary')).toBeCloseTo(0.3, 12);
    expect(grenade.stunRemaining('inside')).toBeCloseTo(0.3, 12);
    expect(grenade.stunRemaining('edge')).toBeCloseTo(0.3, 12);
    expect(grenade.stunRemaining('outside')).toBe(0);
    expect(grenade.isStunned('inside')).toBe(true);
  });

  it('眩晕随逻辑时间衰减到 0', () => {
    const grenade = system();
    const primary = enemy('primary', 100, 100);

    grenade.detonate({ x: 100, y: 100 }, 'primary', [primary]);
    grenade.step(0.35, [primary]);
    expect(grenade.stunRemaining('primary')).toBeCloseTo(0.3, 12);

    grenade.step(0.2, [primary]);
    expect(grenade.stunRemaining('primary')).toBeCloseTo(0.1, 12);
    grenade.step(0.1, [primary]);
    expect(grenade.isStunned('primary')).toBe(false);
  });

  it('余震命中没有残影的敌人时只结算 18 伤害，不触发爆炸与眩晕', () => {
    const grenade = system();
    // 主目标被直接伤害击杀，不附着残影；旁观的未标记敌人只吃余震。
    const primary = enemy('primary', 100, 100, 30);
    const unmarked = enemy('unmarked', 120, 100);

    grenade.detonate({ x: 100, y: 100 }, 'primary', [primary, unmarked]);
    const resolutions = grenade.step(0.35, [primary, unmarked]);

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.hits.map((hit) => hit.targetId)).toEqual(['unmarked']);
    expect(resolutions[0]?.explosions).toHaveLength(0);
    expect(unmarked.health.health).toBeCloseTo(1000 - 36 - 18, 12);
    expect(grenade.isStunned('unmarked')).toBe(false);
  });
});

describe('无递归', () => {
  it('引爆不再生成余震，也不消耗或引爆其他残影', () => {
    const grenade = system();
    const source = enemy('source', 100, 100);
    // 距离 source 38：在 42 爆炸半径内、32 余震半径外。
    const other = enemy('other', 138, 100);

    grenade.detonate({ x: 100, y: 100 }, 'source', [source, other]);
    grenade.mark('other');
    expect([...grenade.markedIds].sort()).toEqual(['other', 'source']);

    const resolutions = grenade.step(0.35, [source, other]);

    expect(resolutions).toHaveLength(1);
    const resolution = resolutions[0];
    if (!resolution) throw new Error('缺少余震结算');
    expect(resolution.explosions).toHaveLength(1);
    expect(resolution.explosions[0]?.sourceTargetId).toBe('source');
    expect(resolution.explosions[0]?.hits.map((hit) => hit.targetId)).toEqual(['source', 'other']);

    // 引爆本身不得登记新的余震。
    expect(grenade.pendingAftershockCount).toBe(0);
    // 被爆炸波及的 other 仍然是带标记者，说明爆炸没有再次引爆炸记。
    expect(grenade.isMarked('source')).toBe(false);
    expect(grenade.isMarked('other')).toBe(true);
    expect(other.health.health).toBeCloseTo(1000 - 24, 12);
  });
});

describe('场景接入', () => {
  it('竞技场场景接入 GrenadeSystem 并暴露余震/残影状态', () => {
    const source = readFileSync(resolve(ROOT, 'src/game/scenes/ArenaScene.ts'), 'utf8');

    expect(source).toContain('GrenadeSystem');
    expect(source).toContain('.detonate(');
    expect(source).toContain('pendingAftershockCount');
    expect(source).toContain('markedIds');
    expect(source).toContain('stunRemaining');
    expect(source).toContain('renderAftershock');
    expect(source).toContain('showAftershockTelegraph');
  });
});
