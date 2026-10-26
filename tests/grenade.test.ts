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

describe('I13 爆炸半径/伤害与 I24 裂变火药', () => {
  it('I13 半径倍率作用于直接溅射、余震与残影，伤害倍率只乘爆炸伤害', () => {
    const grenade = system();
    grenade.setExplosionModifiers(1.54, 0.85);
    const primary = enemy('primary', 100, 100);
    const near = enemy('near', 149, 100);

    const detonation = grenade.detonate({ x: 100, y: 100 }, 'primary', [
      primary,
      near,
    ]);

    expect(detonation.splashRadius).toBeCloseTo(32 * 1.54, 12);
    expect(detonation.aftershockRadius).toBeCloseTo(32 * 1.54, 12);
    expect(detonation.hits.map((hit) => hit.targetId)).toEqual([
      'primary',
      'near',
    ]);
    for (const hit of detonation.hits) {
      expect(hit.damage.damage).toBeCloseTo(36 * 0.85, 12);
    }

    // 余震同样使用放大后的半径与缩小的爆炸伤害。
    const resolutions = grenade.step(0.36, [primary, near]);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.radius).toBeCloseTo(32 * 1.54, 12);
    for (const hit of resolutions[0]?.hits ?? []) {
      expect(hit.damage.damage).toBeCloseTo(18 * 0.85, 12);
    }
  });

  it('I24 每第 5 次爆炸追加 45% 伤害小爆炸，且小爆炸不再计数', () => {
    const grenade = system();
    grenade.setFissionPowder(true, 5, 0.45);
    const targets = [enemy('primary', 100, 100), enemy('near', 120, 100)];

    for (let index = 1; index <= 4; index += 1) {
      const detonation = grenade.detonate(
        { x: 100, y: 100 },
        'primary',
        targets,
      );
      expect(detonation.fissionExplosion, String(index)).toBeNull();
      expect(grenade.explosionCount).toBe(index);
    }

    const fifth = grenade.detonate({ x: 100, y: 100 }, 'primary', targets);
    expect(fifth.fissionExplosion).not.toBeNull();
    expect(fifth.fissionExplosion?.radius).toBeCloseTo(32, 12);
    expect(fifth.fissionExplosion?.hits.map((hit) => hit.targetId)).toEqual([
      'primary',
      'near',
    ]);
    for (const hit of fifth.fissionExplosion?.hits ?? []) {
      expect(hit.damage.damage).toBeCloseTo(36 * 0.45, 12);
    }
    // 小爆炸本身不进入计数：第 5 次仍是 5，第 6 次也不会再追加。
    expect(grenade.explosionCount).toBe(5);
    const sixth = grenade.detonate({ x: 100, y: 100 }, 'primary', targets);
    expect(sixth.fissionExplosion).toBeNull();
    expect(grenade.explosionCount).toBe(6);
  });

  it('I24 余震也参与每第 N 次爆炸计数', () => {
    const grenade = system();
    grenade.setFissionPowder(true, 2, 0.45);
    const targets = [enemy('primary', 100, 100)];
    const detonation = grenade.detonate({ x: 100, y: 100 }, 'primary', targets);
    expect(detonation.fissionExplosion).toBeNull();
    const resolutions = grenade.step(0.36, targets);
    expect(resolutions[0]?.fissionExplosion).not.toBeNull();
    // 主目标带残影，余震还会引爆一次残影爆炸，因此计到第 3 次。
    expect(resolutions[0]?.explosions).toHaveLength(1);
    expect(resolutions[0]?.explosions[0]?.fissionExplosion).toBeNull();
    expect(grenade.explosionCount).toBe(3);
  });

  it('关闭 I24 后不追加小爆炸；爆炸次数随世界快照恢复', () => {
    const grenade = system();
    grenade.setFissionPowder(true, 1, 0.45);
    grenade.detonate({ x: 100, y: 100 }, 'primary', [enemy('primary', 100, 100)]);
    expect(grenade.explosionCount).toBe(1);
    grenade.setFissionPowder(false, 1, 0.45);
    expect(
      grenade.detonate({ x: 100, y: 100 }, 'primary', [enemy('other', 100, 100)])
        .fissionExplosion,
    ).toBeNull();

    const snapshot = grenade.snapshotWorld();
    const restored = system();
    restored.restoreWorld(snapshot);
    expect(restored.explosionCount).toBe(2);
  });
});

describe('R02 连锁反应堆：爆炸击杀小爆炸', () => {
  it('默认关闭；开启后爆炸击杀在目标位置产生 50% 小爆炸', () => {
    const off = system();
    const kill = enemy('primary', 100, 100, 30);
    expect(off.detonate({ x: 100, y: 100 }, 'primary', [kill]).deathExplosions).toEqual(
      [],
    );

    const grenade = system();
    grenade.setDeathExplosion(true, 0.5);
    const primary = enemy('primary', 100, 100, 30);
    const bystander = enemy('bystander', 120, 100);
    const detonation = grenade.detonate({ x: 100, y: 100 }, 'primary', [
      primary,
      bystander,
    ]);

    expect(primary.isAlive).toBe(false);
    expect(detonation.deathExplosions).toHaveLength(1);
    const blast = detonation.deathExplosions[0]!;
    expect(blast.x).toBe(100);
    expect(blast.y).toBe(100);
    // 小爆炸沿用本次爆炸的半径，伤害为直接伤害的 50%（36 → 18）。
    expect(blast.radius).toBe(32);
    expect(blast.hits.map((hit) => hit.targetId)).toEqual(['bystander']);
    expect(blast.hits[0]!.damage.damage).toBeCloseTo(18, 12);
    // 旁观者先吃直接溅射 36，再吃小爆炸 18。
    expect(bystander.health.health).toBeCloseTo(946, 12);
    // 小爆炸不计入 I24 的爆炸次数。
    expect(grenade.explosionCount).toBe(1);
  });

  it('小爆炸击杀不再产生小爆炸（不递归）', () => {
    const grenade = system();
    grenade.setDeathExplosion(true, 0.5);
    // a、b 在直接爆炸半径 32 内且都会被击杀；c 距离 a 40、距离 b 20。
    const a = enemy('a', 100, 100, 30);
    const b = enemy('b', 120, 100, 30);
    const c = enemy('c', 140, 100, 10);

    const detonation = grenade.detonate({ x: 100, y: 100 }, 'a', [a, b, c]);

    expect(a.isAlive).toBe(false);
    expect(b.isAlive).toBe(false);
    // c 只被 b 的小爆炸击杀；它不会再触发第三个 blast。
    expect(c.isAlive).toBe(false);
    expect(detonation.deathExplosions).toHaveLength(2);
    expect(detonation.deathExplosions.map((blast) => blast.x)).toEqual([100, 120]);
    expect(detonation.deathExplosions.some((blast) => blast.x === 140)).toBe(false);
  });

  it('宝箱被爆炸打破不产生小爆炸', () => {
    const grenade = system();
    grenade.setDeathExplosion(true, 0.5);
    const chest = new Combatant({
      id: 'chest',
      x: 100,
      y: 100,
      radius: 12,
      maxHealth: 20,
      kind: 'chest',
    });

    const detonation = grenade.detonate({ x: 100, y: 100 }, 'chest', [chest]);

    expect(chest.isAlive).toBe(false);
    expect(detonation.deathExplosions).toEqual([]);
  });

  it('余震击杀同样产生小爆炸', () => {
    const grenade = system();
    grenade.setDeathExplosion(true, 0.5);
    const primary = enemy('primary', 100, 100, 1000);
    // 直接溅射 36 后剩 4，余震 18 击杀。
    const target = enemy('target', 100, 120, 40);
    grenade.detonate({ x: 100, y: 100 }, 'primary', [primary, target]);

    const resolutions = grenade.step(0.36, [primary, target]);
    expect(resolutions).toHaveLength(1);
    const resolution = resolutions[0]!;
    expect(
      resolution.hits.find((hit) => hit.targetId === 'target')?.damage.died,
    ).toBe(true);
    expect(resolution.deathExplosions).toHaveLength(1);
    const blast = resolution.deathExplosions[0]!;
    expect(blast.x).toBe(100);
    expect(blast.y).toBe(120);
    expect(blast.hits.map((hit) => hit.targetId)).toEqual(['primary']);
    expect(blast.hits[0]!.damage.damage).toBeCloseTo(9, 12);
  });

  it('I24 小爆炸击杀不触发 R02 小爆炸（衍生链不递归）', () => {
    const grenade = system();
    grenade.setDeathExplosion(true, 0.5);
    grenade.setFissionPowder(true, 1, 0.45);
    const primary = enemy('primary', 100, 100, 1000);
    // 直接溅射 36 后剩 14，I24 小爆炸 16.2 击杀。
    const fragile = enemy('fragile', 120, 100, 50);

    const detonation = grenade.detonate({ x: 100, y: 100 }, 'primary', [
      primary,
      fragile,
    ]);

    expect(detonation.fissionExplosion).not.toBeNull();
    expect(fragile.isAlive).toBe(false);
    expect(
      detonation.hits.find((hit) => hit.targetId === 'fragile')?.damage.died,
    ).toBe(false);
    // 击杀发生在 I24 衍生小爆炸里，不再产生 R02 小爆炸。
    expect(detonation.deathExplosions).toEqual([]);
  });
});
