import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProjectile } from '../src/game/combat';
import { PLAYER } from '../src/game/config';
import { getCharacter, getEnemy } from '../src/game/data';
import {
  COPY_MARKER,
  FACING_INDICATOR,
  FORM_LABEL_OFFSET_Y,
  FORM_MARKERS,
  MARKER_RING_RADIUS,
  PLAYER_MARKER,
  enemyMarkerFor,
  facingIndicatorAt,
} from '../src/game/markers';
import { FACING_LIST, FACING_VECTORS, type Facing } from '../src/game/movement';
import {
  PLAYER_COLLISION_RADIUS,
  PLAYER_SPRITE_IDS,
  playerArtFor,
} from '../src/game/player-art';

const ROOT = process.cwd();

describe('占位标记映射', () => {
  it('本体/主流形/副本用不同短标签、形状与外圈线型区分，不只靠颜色', () => {
    const markers = [
      PLAYER_MARKER,
      FORM_MARKERS.melee,
      FORM_MARKERS.ranged,
      COPY_MARKER,
    ];

    expect(new Set(markers.map((marker) => marker.kind)).size).toBe(3);
    expect(new Set(markers.map((marker) => marker.label)).size).toBe(4);
    expect(new Set(markers.map((marker) => marker.glyph)).size).toBe(3);
    expect(PLAYER_MARKER.label).toBe('本体');
    expect(FORM_MARKERS.melee.label).toBe('近战流形');
    expect(FORM_MARKERS.ranged.label).toBe('远程流形');
    expect(COPY_MARKER.label).toBe('副本');
    expect(FORM_MARKERS.melee.glyph).not.toBe(COPY_MARKER.glyph);

    // 外圈线型：本体单圈、主流形双圈、副本细圈。
    expect(PLAYER_MARKER.ringStyle).toBe('solid');
    expect(FORM_MARKERS.melee.ringStyle).toBe('double');
    expect(FORM_MARKERS.ranged.ringStyle).toBe('double');
    expect(COPY_MARKER.ringStyle).toBe('thin');
    expect(COPY_MARKER.ringWidth).toBeLessThan(PLAYER_MARKER.ringWidth);

    // 标记本身没有颜色字段：区分不能只靠换色。
    expect(Object.keys(PLAYER_MARKER)).not.toContain('color');
  });

  it('八种普通怪、幼虫与 Boss 各有形状字符，名称与形状同时显示', () => {
    const expected: Array<[string, string]> = [
      ['blob', '●'],
      ['skitter', '»'],
      ['spitter', '✶'],
      ['charger', '►'],
      ['bulwark', '■'],
      ['mender', '✚'],
      ['bomber', '✸'],
      ['broodmother', '❖'],
      ['larva', '·'],
      ['boss', '★'],
    ];
    const glyphs = new Set<string>();
    for (const [id, glyph] of expected) {
      const enemy = getEnemy(id);
      const marker = enemyMarkerFor({
        behavior: enemy.behavior,
        name: enemy.name,
        markerGlyph: enemy.markerGlyph,
      });
      expect(marker.glyph, `${id} 应有独立形状字符`).toBe(glyph);
      expect(marker.label).toBe(enemy.name);
      expect(marker.kind).toBe(enemy.behavior === 'boss' ? 'boss' : 'enemy');
      glyphs.add(marker.glyph);
    }
    expect(glyphs.size).toBe(expected.length);
  });

  it('后四种普通怪与幼虫用行为形状/短标签区分，不只依赖颜色', () => {
    const ids = ['bulwark', 'mender', 'bomber', 'broodmother', 'larva'] as const;
    const markers = ids.map((id) => {
      const enemy = getEnemy(id);
      return enemyMarkerFor({
        behavior: enemy.behavior,
        name: enemy.name,
        markerGlyph: enemy.markerGlyph,
      });
    });

    expect(new Set(markers.map((marker) => marker.glyph)).size).toBe(ids.length);
    expect(new Set(markers.map((marker) => marker.label)).size).toBe(ids.length);
    for (const marker of markers) {
      expect(Object.keys(marker)).not.toContain('color');
    }
  });

  it('前四种普通怪用形状、名称与外圈线宽区分，不只依赖颜色', () => {
    const ids = ['blob', 'skitter', 'spitter', 'charger'] as const;
    const markers = ids.map((id) => {
      const enemy = getEnemy(id);
      return enemyMarkerFor({ behavior: enemy.behavior, name: enemy.name });
    });

    expect(new Set(markers.map((marker) => marker.glyph)).size).toBe(ids.length);
    expect(new Set(markers.map((marker) => marker.label)).size).toBe(ids.length);
    // 标记没有颜色字段：种类差异必须在形状/文本/线型上可见。
    for (const marker of markers) {
      expect(Object.keys(marker)).not.toContain('color');
    }
    // 行为映射只读名称与行为，不改变敌人数值。
    expect(getEnemy('blob').maxHealth).toBe(35);
    expect(getEnemy('skitter').maxHealth).toBe(28);
    expect(getEnemy('spitter').maxHealth).toBe(42);
    expect(getEnemy('charger').maxHealth).toBe(85);
  });

  it('精英带“精英”前缀并加粗为双层外圈，Boss 保留自己的形状与线宽', () => {
    const normal = enemyMarkerFor({ behavior: 'chase', name: '团团怪' });
    const elite = enemyMarkerFor({ behavior: 'chase', name: '团团怪', elite: true });
    expect(normal.label).toBe('团团怪');
    expect(elite.label).toBe('精英 团团怪');
    expect(elite.ringWidth).toBeGreaterThan(normal.ringWidth);
    expect(elite.ringStyle).toBe('double');
    expect(elite.glyph).toBe(normal.glyph);

    const boss = enemyMarkerFor({ behavior: 'boss', name: '裂隙炉王' });
    expect(boss.kind).toBe('boss');
    expect(boss.ringWidth).toBeGreaterThan(normal.ringWidth);
  });
});

describe('八向面向指示', () => {
  it('八个面向都从同源向量出发，斜向精确为 ±45°', () => {
    const origin = { x: 320, y: 240 };
    const directions = new Set<string>();

    for (const facing of FACING_LIST) {
      const geometry = facingIndicatorAt(origin, facing);
      expect(geometry.direction.x).toBe(FACING_VECTORS[facing].x);
      expect(geometry.direction.y).toBe(FACING_VECTORS[facing].y);

      const startDistance = Math.hypot(
        geometry.start.x - origin.x,
        geometry.start.y - origin.y,
      );
      const endDistance = Math.hypot(geometry.end.x - origin.x, geometry.end.y - origin.y);
      expect(startDistance).toBeCloseTo(FACING_INDICATOR.innerRadius, 9);
      expect(endDistance).toBeCloseTo(FACING_INDICATOR.length, 9);

      // 起止点连线方向与逻辑面向一致，斜向不会退化为四向。
      const lineLength = Math.hypot(
        geometry.end.x - geometry.start.x,
        geometry.end.y - geometry.start.y,
      );
      expect((geometry.end.x - geometry.start.x) / lineLength).toBeCloseTo(
        FACING_VECTORS[facing].x,
        9,
      );
      expect((geometry.end.y - geometry.start.y) / lineLength).toBeCloseTo(
        FACING_VECTORS[facing].y,
        9,
      );
      directions.add(`${geometry.direction.x},${geometry.direction.y}`);
    }

    expect(directions.size).toBe(8);
  });

  it('相反面向的指示方向互为镜像，箭头两翼围绕终点', () => {
    const origin = { x: 100, y: 100 };
    const oppositePairs: Array<[Facing, Facing]> = [
      ['east', 'west'],
      ['southEast', 'northWest'],
      ['south', 'north'],
      ['southWest', 'northEast'],
    ];

    for (const [a, b] of oppositePairs) {
      const first = facingIndicatorAt(origin, a);
      const second = facingIndicatorAt(origin, b);
      expect(first.direction.x).toBeCloseTo(-second.direction.x, 9);
      expect(first.direction.y).toBeCloseTo(-second.direction.y, 9);
      expect(first.end.x - origin.x).toBeCloseTo(origin.x - second.end.x, 9);
      expect(first.end.y - origin.y).toBeCloseTo(origin.y - second.end.y, 9);
    }

    const geometry = facingIndicatorAt(origin, 'east');
    const headMidpoint = {
      x: (geometry.headLeft.x + geometry.headRight.x) / 2,
      y: (geometry.headLeft.y + geometry.headRight.y) / 2,
    };
    expect(headMidpoint.x).toBeLessThan(geometry.end.x);
    expect(headMidpoint.y).toBeCloseTo(geometry.end.y, 9);
  });

  it('指示方向与真实弹体方向一致，弹体射程取攻击定义', () => {
    const origin = { x: 480, y: 320 };
    const attack = getCharacter('vishdal').attack;

    for (const facing of FACING_LIST) {
      const projectile = createProjectile(1, origin, facing, attack);
      const speed = Math.hypot(projectile.vx, projectile.vy);
      const indicator = facingIndicatorAt(origin, facing);
      expect(projectile.vx / speed, `${facing} 弹体 x 方向应与指示一致`).toBeCloseTo(
        indicator.direction.x,
        9,
      );
      expect(projectile.vy / speed, `${facing} 弹体 y 方向应与指示一致`).toBeCloseTo(
        indicator.direction.y,
        9,
      );
      expect(projectile.remainingRange).toBe(attack.range);
      expect(projectile.x).toBe(origin.x);
      expect(projectile.y).toBe(origin.y);
    }
  });
});

describe('占位显示不改碰撞体', () => {
  it('玩家逻辑碰撞半径仍为 12，四名角色的显示缩放不改变碰撞体', () => {
    expect(PLAYER.radius).toBe(12);
    expect(PLAYER_COLLISION_RADIUS).toBe(12);
    for (const characterId of PLAYER_SPRITE_IDS) {
      const art = playerArtFor(characterId);
      expect(art.collisionRadius, `${characterId} 逻辑半径`).toBe(12);
      expect(art.bodyRadius * art.displayScale, `${characterId} 显示缩放后半径`).toBeCloseTo(
        12,
        9,
      );
    }
  });

  it('外圈只扩大可见标记，半径常量不进入碰撞半径', () => {
    expect(MARKER_RING_RADIUS.player).toBeGreaterThan(PLAYER_COLLISION_RADIUS);
    expect(MARKER_RING_RADIUS.form).toBeGreaterThan(PLAYER_COLLISION_RADIUS);
    expect(MARKER_RING_RADIUS.copy).toBeGreaterThanOrEqual(PLAYER_COLLISION_RADIUS);
    // 场景仍以美术规格的 bodyRadius 设置 Arcade 圆形碰撞体。
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    expect(sceneSource).toContain(
      'body.setCircle(art.bodyRadius, art.bodyOffsetX, art.bodyOffsetY)',
    );
  });
});

describe('场景接入与占位资源边界', () => {
  it('主流形短标签随实体逐帧移动，不会停在生成点', () => {
    expect(FORM_LABEL_OFFSET_Y).toBe(64);
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );

    // 创建与同步共用同一偏移常量，避免两处数值漂移。
    expect(sceneSource).toContain(
      '.text(position.x, position.y - FORM_LABEL_OFFSET_Y,',
    );

    const syncStart = sceneSource.indexOf('private syncMuelsyseForm');
    const syncEnd = sceneSource.indexOf('private syncMuelsyseCopies');
    expect(syncStart).toBeGreaterThan(-1);
    expect(syncEnd).toBeGreaterThan(syncStart);
    const syncBody = sceneSource.slice(syncStart, syncEnd);

    const positionSync = syncBody.indexOf(
      'this.formLabel?.setPosition(position.x, position.y - FORM_LABEL_OFFSET_Y)',
    );
    expect(positionSync).toBeGreaterThan(-1);
    // 位置同步必须在“存活”分支内，死亡隐藏时不额外移动标签。
    expect(positionSync).toBeGreaterThan(syncBody.indexOf('if (!alive) {'));
  });

  it('场景消费标记映射与八向指示，不新增 SVG/图片/精灵表', () => {
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    expect(sceneSource).toContain('enemyMarkerFor(');
    expect(sceneSource).toContain('facingIndicatorAt(');
    expect(sceneSource).toContain('PLAYER_MARKER');
    expect(sceneSource).toContain('FORM_MARKERS');
    expect(sceneSource).toContain('COPY_MARKER');
    expect(sceneSource).toContain('MARKER_RING_RADIUS');

    const markerSource = readFileSync(resolve(ROOT, 'src/game/markers.ts'), 'utf8');
    expect(markerSource).not.toContain('phaser');
    expect(markerSource).not.toContain('ASSET_');
    expect(markerSource).not.toContain('.png');
    expect(markerSource).not.toContain('.svg');
  });
});
