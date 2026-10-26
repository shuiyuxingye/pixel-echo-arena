import { describe, expect, it } from 'vitest';
import { createArenaLayout, isCircleBlocked, type ArenaLayout } from '../src/game/arena';
import {
  CHEST_MIN_ENEMY_SPAWN_DISTANCE,
  CHEST_MIN_PLAYER_DISTANCE,
  CHEST_RADIUS,
  CHEST_SPAWN_DELAY_SECONDS,
  CHEST_WAVES,
  Chest,
  chestMaxHealthForWave,
  collectChestEligibility,
  findChestSpawnPosition,
  isChestPositionReachable,
  shouldSpawnChest,
  waveHasChest,
} from '../src/game/chest';

function createChest(id = 'chest-w2', wave = 2, x = 720, y = 480): Chest {
  return new Chest({ id, wave, x, y });
}

describe('宝箱出现波次与时间', () => {
  it('只在第 2/5/8/11/14/17 波刷新', () => {
    expect([...CHEST_WAVES]).toEqual([2, 5, 8, 11, 14, 17]);
    for (let wave = 1; wave <= 18; wave += 1) {
      expect(waveHasChest(wave), `wave ${wave}`).toBe(
        [2, 5, 8, 11, 14, 17].includes(wave),
      );
    }
    expect(waveHasChest(18)).toBe(false);
  });

  it('波开始 8 秒出现，且每波只生成一次', () => {
    expect(CHEST_SPAWN_DELAY_SECONDS).toBe(8);
    expect(shouldSpawnChest(2, 7.999, false)).toBe(false);
    expect(shouldSpawnChest(2, 8, false)).toBe(true);
    expect(shouldSpawnChest(2, 8.5, false)).toBe(true);
    expect(shouldSpawnChest(2, 8.5, true)).toBe(false);
    expect(shouldSpawnChest(3, 9, false)).toBe(false);
    expect(shouldSpawnChest(2, Number.NaN, false)).toBe(false);
  });
});

describe('宝箱生命与伤害', () => {
  it('生命为 45+6×波数且无护甲', () => {
    for (const wave of CHEST_WAVES) {
      expect(chestMaxHealthForWave(wave)).toBe(45 + 6 * wave);
    }
    expect(chestMaxHealthForWave(1)).toBe(51);
    expect(chestMaxHealthForWave(18)).toBe(153);

    const chest = createChest();
    expect(chest.kind).toBe('chest');
    expect(chest.radius).toBe(CHEST_RADIUS);
    expect(chest.health.maxHealth).toBe(57);
    expect(chest.health.armor).toBe(0);
    expect(chest.health.magicResist).toBe(0);
  });

  it('物理/法术/真实伤害都不减免；生命归零即破碎', () => {
    const physical = createChest('physical');
    const physicalResult = physical.applyDamage(10, 'physical');
    expect(physicalResult.damage).toBe(10);
    expect(physicalResult.died).toBe(false);

    const magic = createChest('magic');
    expect(magic.applyDamage(10, 'magic').damage).toBe(10);

    const trueDamage = createChest('true');
    expect(trueDamage.applyDamage(10, 'true').damage).toBe(10);

    const broken = createChest('broken');
    const result = broken.applyDamage(999, 'true');
    expect(result.died).toBe(true);
    expect(broken.isBroken).toBe(true);
    // 重复命中不再产生新结果，也不会重复记资格。
    expect(broken.applyDamage(999, 'true').applied).toBe(false);
  });
});

describe('宝箱资格', () => {
  it('打破只增加 1 个资格，重复读取不重复', () => {
    const chest = createChest('chest-w5', 5);
    expect(chest.claimBreakEligibility()).toBe(false);

    chest.applyDamage(999, 'true');
    expect(chest.claimBreakEligibility()).toBe(true);
    expect(chest.hasGrantedEligibility).toBe(true);
    expect(chest.claimBreakEligibility()).toBe(false);
    expect(collectChestEligibility([chest])).toEqual([]);
  });

  it('未打破的宝箱不记资格，且随波结束被丢弃', () => {
    const unbroken = createChest('unbroken');
    const broken = createChest('broken');
    broken.applyDamage(999, 'true');

    expect(collectChestEligibility([unbroken, broken])).toEqual(['broken']);
    // 第二次收集（模拟重复波末处理）不会重复发放。
    expect(collectChestEligibility([unbroken, broken])).toEqual([]);
    expect(unbroken.hasGrantedEligibility).toBe(false);
  });
});

describe('宝箱生成位置约束', () => {
  const layout = createArenaLayout();
  const player = { x: 720, y: 480 };

  it('离玩家至少 160、不在墙里、从玩家位置可达', () => {
    const point = findChestSpawnPosition({ layout, player, angleOffset: 2 });
    const distance = Math.hypot(point.x - player.x, point.y - player.y);
    expect(distance).toBeGreaterThanOrEqual(CHEST_MIN_PLAYER_DISTANCE);
    expect(isCircleBlocked(layout, point.x, point.y, CHEST_RADIUS)).toBe(false);
    expect(
      point.x - CHEST_RADIUS >= 0 &&
        point.y - CHEST_RADIUS >= 0 &&
        point.x + CHEST_RADIUS <= layout.width &&
        point.y + CHEST_RADIUS <= layout.height,
    ).toBe(true);
    expect(isChestPositionReachable(layout, player, point)).toBe(true);
  });

  it('离任一敌人出生点至少 120', () => {
    const enemySpawnPoints = [
      { x: player.x + CHEST_MIN_PLAYER_DISTANCE, y: player.y },
      { x: player.x, y: player.y + CHEST_MIN_PLAYER_DISTANCE },
      { x: player.x - CHEST_MIN_PLAYER_DISTANCE, y: player.y },
    ];
    const point = findChestSpawnPosition({
      layout,
      player,
      enemySpawnPoints,
      angleOffset: 0,
    });
    for (const spawn of enemySpawnPoints) {
      expect(Math.hypot(point.x - spawn.x, point.y - spawn.y)).toBeGreaterThanOrEqual(
        CHEST_MIN_ENEMY_SPAWN_DISTANCE,
      );
    }
  });

  it('玩家贴墙时仍落在可行走地面', () => {
    const cornerPlayer = { x: 56, y: 56 };
    const point = findChestSpawnPosition({
      layout,
      player: cornerPlayer,
      angleOffset: 3,
    });
    expect(isCircleBlocked(layout, point.x, point.y, CHEST_RADIUS)).toBe(false);
    expect(isChestPositionReachable(layout, cornerPlayer, point)).toBe(true);
  });

  it('找不到合法位置时显式报错', () => {
    const tiny: ArenaLayout = {
      width: 200,
      height: 200,
      wallThickness: 20,
      walls: [
        { x: 0, y: 0, width: 200, height: 20 },
        { x: 0, y: 180, width: 200, height: 20 },
        { x: 0, y: 0, width: 20, height: 200 },
        { x: 180, y: 0, width: 20, height: 200 },
      ],
      covers: [],
      spawn: { x: 100, y: 100 },
      playerRadius: 12,
    };
    expect(() =>
      findChestSpawnPosition({
        layout: tiny,
        player: { x: 100, y: 100 },
      }),
    ).toThrow(/无法找到满足宝箱生成约束的位置/);
  });

  it('被墙隔开的区域不算可达', () => {
    const split: ArenaLayout = {
      width: 480,
      height: 480,
      wallThickness: 20,
      walls: [
        { x: 0, y: 0, width: 480, height: 20 },
        { x: 0, y: 460, width: 480, height: 20 },
        { x: 0, y: 0, width: 20, height: 480 },
        { x: 460, y: 0, width: 20, height: 480 },
        { x: 238, y: 0, width: 4, height: 480 },
      ],
      covers: [],
      spawn: { x: 120, y: 240 },
      playerRadius: 12,
    };
    expect(
      isChestPositionReachable(split, { x: 100, y: 240 }, { x: 140, y: 240 }),
    ).toBe(true);
    expect(
      isChestPositionReachable(split, { x: 100, y: 240 }, { x: 380, y: 240 }),
    ).toBe(false);
  });
});
