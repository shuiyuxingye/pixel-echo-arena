import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ASSET_PATHS, PLAYER } from '../src/game/config';
import {
  PLAYER_ACTION_COLUMNS,
  PLAYER_ART,
  PLAYER_CAST_DIRECTIONS,
  PLAYER_CAST_ROW,
  PLAYER_DIRECTIONS,
  PLAYER_SPRITE_IDS,
  playerAnimationKey,
  playerCastFrameIndex,
  playerFrameIndex,
} from '../src/game/player-art';

const ROOT = process.cwd();
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface DecodedPng {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** 解码本工程生成的 RGBA8 非隔行 PNG（含 0-4 全部行过滤器）。 */
function decodePng(urlPath: string): DecodedPng {
  const buffer = readFileSync(resolve(ROOT, `public${urlPath}`));
  expect(buffer.subarray(0, 8)).toEqual(PNG_SIGNATURE);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }

  expect(bitDepth).toBe(8);
  expect(colorType).toBe(6);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const rowStart = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x += 1) {
      const byte = raw[rowStart + x] ?? 0;
      const left = x >= 4 ? (pixels[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upperLeft = y > 0 && x >= 4 ? (pixels[(y - 1) * stride + x - 4] ?? 0) : 0;
      let value = byte;
      if (filter === 1) value = byte + left;
      else if (filter === 2) value = byte + up;
      else if (filter === 3) value = byte + Math.floor((left + up) / 2);
      else if (filter === 4) {
        const estimate = left + up - upperLeft;
        const distanceLeft = Math.abs(estimate - left);
        const distanceUp = Math.abs(estimate - up);
        const distanceUpperLeft = Math.abs(estimate - upperLeft);
        const predictor =
          distanceLeft <= distanceUp && distanceLeft <= distanceUpperLeft
            ? left
            : distanceUp <= distanceUpperLeft
              ? up
              : upperLeft;
        value = byte + predictor;
      } else if (filter !== 0) {
        throw new Error(`不支持的 PNG 行过滤器：${filter}`);
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }

  return { width, height, pixels };
}

function alphaAt(png: DecodedPng, x: number, y: number): number {
  return png.pixels[(y * png.width + x) * 4 + 3] ?? 0;
}

function countOpaqueInFrame(
  png: DecodedPng,
  column: number,
  row: number,
  predicate: (x: number, y: number) => boolean = () => true,
): number {
  let count = 0;
  const originX = column * PLAYER_ART.frameWidth;
  const originY = row * PLAYER_ART.frameHeight;
  for (let y = 0; y < PLAYER_ART.frameHeight; y += 1) {
    for (let x = 0; x < PLAYER_ART.frameWidth; x += 1) {
      if (predicate(x, y) && alphaAt(png, originX + x, originY + y) > 0) count += 1;
    }
  }
  return count;
}

describe('维什戴尔 Q 版精灵表', () => {
  it('按 64×64 帧规格生成 8×5 精灵表', () => {
    const png = decodePng(ASSET_PATHS.playerVishdal);

    expect(ASSET_PATHS.playerVishdal).toBe('/assets/sprites/player-vishdal.png');
    expect(statSync(resolve(ROOT, `public${ASSET_PATHS.playerVishdal}`)).size).toBeGreaterThan(0);
    expect(PLAYER_ART.frameWidth).toBe(64);
    expect(PLAYER_ART.frameHeight).toBe(64);
    expect(png.width).toBe(PLAYER_ART.sheetWidth);
    expect(png.height).toBe(PLAYER_ART.sheetHeight);
    expect(PLAYER.frameWidth).toBe(PLAYER_ART.frameWidth);
    expect(PLAYER.frameHeight).toBe(PLAYER_ART.frameHeight);
  });

  it('每帧都有内容、背景透明且四周没有被裁掉的角色部位', () => {
    const png = decodePng(ASSET_PATHS.playerVishdal);
    const { frameWidth, frameHeight, sheetColumns, sheetRows } = PLAYER_ART;

    for (let row = 0; row < sheetRows; row += 1) {
      for (let column = 0; column < sheetColumns; column += 1) {
        const opaque = countOpaqueInFrame(png, column, row);
        expect(opaque, `帧 r${row}c${column} 不应为空`).toBeGreaterThan(500);

        const originX = column * frameWidth;
        const originY = row * frameHeight;
        for (const [x, y] of [
          [0, 0],
          [frameWidth - 1, 0],
          [0, frameHeight - 1],
          [frameWidth - 1, frameHeight - 1],
        ] as const) {
          expect(alphaAt(png, originX + x, originY + y), `帧 r${row}c${column} 角落透明`).toBe(0);
        }

        const edgePixels = countOpaqueInFrame(
          png,
          column,
          row,
          (x, y) => x === 0 || y === 0 || x === frameWidth - 1 || y === frameHeight - 1,
        );
        expect(edgePixels, `帧 r${row}c${column} 的角/头发/武器不应触边`).toBe(0);
      }
    }
  });

  it('脚底锚点稳定，逻辑碰撞圆仍为半径 12', () => {
    const png = decodePng(ASSET_PATHS.playerVishdal);

    expect(PLAYER.radius).toBe(12);
    expect(PLAYER.originX * PLAYER.frameWidth).toBe(PLAYER_ART.frameWidth / 2);
    expect(Math.round(PLAYER.originY * PLAYER.frameHeight)).toBe(PLAYER_ART.footBaseline);
    expect(PLAYER.bodyOffsetX + PLAYER.radius).toBe(PLAYER_ART.frameWidth / 2);
    expect(PLAYER.bodyOffsetY + PLAYER.radius * 2).toBe(PLAYER_ART.footBaseline);

    for (const direction of PLAYER_DIRECTIONS) {
      const row = PLAYER_DIRECTIONS.indexOf(direction);
      const column = PLAYER_ACTION_COLUMNS.idle[0] ?? 0;
      const baselineOpaque = countOpaqueInFrame(
        png,
        column,
        row,
        (_x, y) => y === PLAYER_ART.footBaseline,
      );
      expect(baselineOpaque, `${direction} 待机帧应有脚底像素`).toBeGreaterThan(0);
      const belowBaseline = countOpaqueInFrame(
        png,
        column,
        row,
        (_x, y) => y > PLAYER_ART.footBaseline,
      );
      expect(belowBaseline, `${direction} 待机帧不应低于脚底基线`).toBe(0);
    }
  });

  it('四向动作与八向施法帧索引完整且不重叠', () => {
    const animationFrames = new Set<number>();
    const animationKeys = new Set<string>();

    for (const direction of PLAYER_DIRECTIONS) {
      for (const action of Object.keys(PLAYER_ACTION_COLUMNS) as Array<
        keyof typeof PLAYER_ACTION_COLUMNS
      >) {
        const columns = PLAYER_ACTION_COLUMNS[action];
        for (const column of columns) {
          expect(column).toBeLessThan(PLAYER_ART.sheetColumns);
        }
        const index = playerFrameIndex(direction, action);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(PLAYER_ART.sheetColumns * PLAYER_ART.sheetRows);
        expect(animationFrames.has(index)).toBe(false);
        animationFrames.add(index);
        expect(animationKeys.has(playerAnimationKey(direction, action))).toBe(false);
        animationKeys.add(playerAnimationKey(direction, action));
      }
    }

    expect(animationFrames.size).toBe(PLAYER_DIRECTIONS.length * 4);
    expect(PLAYER_CAST_DIRECTIONS).toHaveLength(PLAYER_ART.sheetColumns);
    const castFrames = PLAYER_CAST_DIRECTIONS.map(playerCastFrameIndex);
    expect(new Set(castFrames).size).toBe(PLAYER_CAST_DIRECTIONS.length);
    for (const index of castFrames) {
      expect(index).toBeGreaterThanOrEqual(PLAYER_CAST_ROW * PLAYER_ART.sheetColumns);
      expect(index).toBeLessThan((PLAYER_CAST_ROW + 1) * PLAYER_ART.sheetColumns);
    }
  });

  it('场景按精灵表加载，生成脚本输出同一路径', () => {
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    const generatorSource = readFileSync(resolve(ROOT, 'tools/generate-assets.mjs'), 'utf8');

    expect(sceneSource).toContain('load.spritesheet');
    expect(sceneSource).toContain('PLAYER.originX');
    expect(sceneSource).toContain('PLAYER.bodyOffsetX');
    expect(sceneSource).toContain('createPlayerAnimations');
    expect(generatorSource).toContain('public/assets/sprites/player-vishdal.png');
    expect(generatorSource).toContain('frameSize: 64');
  });
});

describe('阿米娅 Q 版精灵表', () => {
  it('与维什戴尔共用 64×64 帧规格与 8×5 布局', () => {
    const png = decodePng(ASSET_PATHS.playerAmiya);

    expect(ASSET_PATHS.playerAmiya).toBe('/assets/sprites/player-amiya.png');
    expect(statSync(resolve(ROOT, `public${ASSET_PATHS.playerAmiya}`)).size).toBeGreaterThan(0);
    expect(png.width).toBe(PLAYER_ART.sheetWidth);
    expect(png.height).toBe(PLAYER_ART.sheetHeight);
    expect(playerAnimationKey('down', 'idle', 'amiya')).toBe('amiya-down-idle');
    expect(playerAnimationKey('up', 'walk', 'amiya')).toBe('amiya-up-walk');
  });

  it('每帧都有内容、背景透明且四周没有被裁掉的兔耳/头发/术式', () => {
    const png = decodePng(ASSET_PATHS.playerAmiya);
    const { frameWidth, frameHeight, sheetColumns, sheetRows } = PLAYER_ART;

    for (let row = 0; row < sheetRows; row += 1) {
      for (let column = 0; column < sheetColumns; column += 1) {
        const opaque = countOpaqueInFrame(png, column, row);
        expect(opaque, `帧 r${row}c${column} 不应为空`).toBeGreaterThan(500);

        const originX = column * frameWidth;
        const originY = row * frameHeight;
        for (const [x, y] of [
          [0, 0],
          [frameWidth - 1, 0],
          [0, frameHeight - 1],
          [frameWidth - 1, frameHeight - 1],
        ] as const) {
          expect(alphaAt(png, originX + x, originY + y), `帧 r${row}c${column} 角落透明`).toBe(0);
        }

        const edgePixels = countOpaqueInFrame(
          png,
          column,
          row,
          (x, y) => x === 0 || y === 0 || x === frameWidth - 1 || y === frameHeight - 1,
        );
        expect(edgePixels, `帧 r${row}c${column} 的兔耳/头发/术式不应触边`).toBe(0);
      }
    }
  });

  it('脚底锚点稳定，四向待机与施法帧完整', () => {
    const png = decodePng(ASSET_PATHS.playerAmiya);

    for (const direction of PLAYER_DIRECTIONS) {
      const row = PLAYER_DIRECTIONS.indexOf(direction);
      const column = PLAYER_ACTION_COLUMNS.idle[0] ?? 0;
      const baselineOpaque = countOpaqueInFrame(
        png,
        column,
        row,
        (_x, y) => y === PLAYER_ART.footBaseline,
      );
      expect(baselineOpaque, `${direction} 待机帧应有脚底像素`).toBeGreaterThan(0);
      const belowBaseline = countOpaqueInFrame(
        png,
        column,
        row,
        (_x, y) => y > PLAYER_ART.footBaseline,
      );
      expect(belowBaseline, `${direction} 待机帧不应低于脚底基线`).toBe(0);
    }

    const castFrames = PLAYER_CAST_DIRECTIONS.map(playerCastFrameIndex);
    expect(new Set(castFrames).size).toBe(PLAYER_CAST_DIRECTIONS.length);
  });

  it('场景与生成脚本都使用阿米娅精灵表', () => {
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    const generatorSource = readFileSync(resolve(ROOT, 'tools/generate-assets.mjs'), 'utf8');

    expect(sceneSource).toContain('ASSET_KEYS.playerAmiya');
    expect(sceneSource).toContain('ASSET_PATHS.playerAmiya');
    expect(generatorSource).toContain('public/assets/sprites/player-amiya.png');
    expect(generatorSource).toContain('AMIYA_PALETTE');
    expect(generatorSource).toContain('drawAmiyaEars');
  });
});

describe('缪尔赛思 Q 版精灵表', () => {
  it('与维什戴尔/阿米娅/塞雷娅共用 64×64 帧规格与 8×5 布局', () => {
    const png = decodePng(ASSET_PATHS.playerMuelsyse);

    expect(ASSET_PATHS.playerMuelsyse).toBe('/assets/sprites/player-muelsyse.png');
    expect(statSync(resolve(ROOT, `public${ASSET_PATHS.playerMuelsyse}`)).size).toBeGreaterThan(0);
    expect(png.width).toBe(PLAYER_ART.sheetWidth);
    expect(png.height).toBe(PLAYER_ART.sheetHeight);
    expect(playerAnimationKey('down', 'idle', 'muelsyse')).toBe('muelsyse-down-idle');
    expect(playerAnimationKey('up', 'walk', 'muelsyse')).toBe('muelsyse-up-walk');
  });

  it('每帧都有内容、背景透明且四周没有被裁掉的长发/尖耳/水滴', () => {
    const png = decodePng(ASSET_PATHS.playerMuelsyse);
    const { frameWidth, frameHeight, sheetColumns, sheetRows } = PLAYER_ART;

    for (let row = 0; row < sheetRows; row += 1) {
      for (let column = 0; column < sheetColumns; column += 1) {
        const opaque = countOpaqueInFrame(png, column, row);
        expect(opaque, `帧 r${row}c${column} 不应为空`).toBeGreaterThan(500);

        const originX = column * frameWidth;
        const originY = row * frameHeight;
        for (const [x, y] of [
          [0, 0],
          [frameWidth - 1, 0],
          [0, frameHeight - 1],
          [frameWidth - 1, frameHeight - 1],
        ] as const) {
          expect(alphaAt(png, originX + x, originY + y), `帧 r${row}c${column} 角落透明`).toBe(0);
        }

        const edgePixels = countOpaqueInFrame(
          png,
          column,
          row,
          (x, y) => x === 0 || y === 0 || x === frameWidth - 1 || y === frameHeight - 1,
        );
        expect(edgePixels, `帧 r${row}c${column} 的长发/尖耳/水滴不应触边`).toBe(0);
      }
    }
  });

  it('脚底锚点稳定，四向待机与施法帧完整', () => {
    const png = decodePng(ASSET_PATHS.playerMuelsyse);

    for (const direction of PLAYER_DIRECTIONS) {
      const row = PLAYER_DIRECTIONS.indexOf(direction);
      const column = PLAYER_ACTION_COLUMNS.idle[0] ?? 0;
      const baselineOpaque = countOpaqueInFrame(
        png,
        column,
        row,
        (_x, y) => y === PLAYER_ART.footBaseline,
      );
      expect(baselineOpaque, `${direction} 待机帧应有脚底像素`).toBeGreaterThan(0);
      const belowBaseline = countOpaqueInFrame(
        png,
        column,
        row,
        (_x, y) => y > PLAYER_ART.footBaseline,
      );
      expect(belowBaseline, `${direction} 待机帧不应低于脚底基线`).toBe(0);
    }

    const castFrames = PLAYER_CAST_DIRECTIONS.map(playerCastFrameIndex);
    expect(new Set(castFrames).size).toBe(PLAYER_CAST_DIRECTIONS.length);
  });

  it('场景与生成脚本都使用缪尔赛思精灵表，并保留长发/尖耳/水滴识别点', () => {
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    const generatorSource = readFileSync(resolve(ROOT, 'tools/generate-assets.mjs'), 'utf8');

    expect(sceneSource).toContain('ASSET_KEYS.playerMuelsyse');
    expect(sceneSource).toContain('ASSET_PATHS.playerMuelsyse');
    expect(generatorSource).toContain('public/assets/sprites/player-muelsyse.png');
    expect(generatorSource).toContain('MUELSYSE_PALETTE');
    expect(generatorSource).toContain('drawMuelsyseEars');
    expect(generatorSource).toContain('drawMuelsyseLongLocks');
    expect(generatorSource).toContain('drawMuelsyseDrop');
  });
});

describe('塞雷娅 Q 版精灵表', () => {
  it('与维什戴尔/阿米娅共用 64×64 帧规格与 8×5 布局', () => {
    const png = decodePng(ASSET_PATHS.playerSaria);

    expect(ASSET_PATHS.playerSaria).toBe('/assets/sprites/player-saria.png');
    expect(statSync(resolve(ROOT, `public${ASSET_PATHS.playerSaria}`)).size).toBeGreaterThan(0);
    expect(png.width).toBe(PLAYER_ART.sheetWidth);
    expect(png.height).toBe(PLAYER_ART.sheetHeight);
    expect(playerAnimationKey('down', 'idle', 'saria')).toBe('saria-down-idle');
    expect(playerAnimationKey('up', 'walk', 'saria')).toBe('saria-up-walk');
  });

  it('每帧都有内容、背景透明且四周没有被裁掉的角/尾/盾牌', () => {
    const png = decodePng(ASSET_PATHS.playerSaria);
    const { frameWidth, frameHeight, sheetColumns, sheetRows } = PLAYER_ART;

    for (let row = 0; row < sheetRows; row += 1) {
      for (let column = 0; column < sheetColumns; column += 1) {
        const opaque = countOpaqueInFrame(png, column, row);
        expect(opaque, `帧 r${row}c${column} 不应为空`).toBeGreaterThan(500);

        const originX = column * frameWidth;
        const originY = row * frameHeight;
        for (const [x, y] of [
          [0, 0],
          [frameWidth - 1, 0],
          [0, frameHeight - 1],
          [frameWidth - 1, frameHeight - 1],
        ] as const) {
          expect(alphaAt(png, originX + x, originY + y), `帧 r${row}c${column} 角落透明`).toBe(0);
        }

        const edgePixels = countOpaqueInFrame(
          png,
          column,
          row,
          (x, y) => x === 0 || y === 0 || x === frameWidth - 1 || y === frameHeight - 1,
        );
        expect(edgePixels, `帧 r${row}c${column} 的角/尾巴/盾牌不应触边`).toBe(0);
      }
    }
  });

  it('脚底锚点稳定，四向待机与施法帧完整', () => {
    const png = decodePng(ASSET_PATHS.playerSaria);

    for (const direction of PLAYER_DIRECTIONS) {
      const row = PLAYER_DIRECTIONS.indexOf(direction);
      const column = PLAYER_ACTION_COLUMNS.idle[0] ?? 0;
      const baselineOpaque = countOpaqueInFrame(
        png,
        column,
        row,
        (_x, y) => y === PLAYER_ART.footBaseline,
      );
      expect(baselineOpaque, `${direction} 待机帧应有脚底像素`).toBeGreaterThan(0);
      const belowBaseline = countOpaqueInFrame(
        png,
        column,
        row,
        (_x, y) => y > PLAYER_ART.footBaseline,
      );
      expect(belowBaseline, `${direction} 待机帧不应低于脚底基线`).toBe(0);
    }

    const castFrames = PLAYER_CAST_DIRECTIONS.map(playerCastFrameIndex);
    expect(new Set(castFrames).size).toBe(PLAYER_CAST_DIRECTIONS.length);
  });

  it('场景与生成脚本都使用塞雷娅精灵表，并保留角/尾/盾牌识别点', () => {
    const sceneSource = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    const generatorSource = readFileSync(resolve(ROOT, 'tools/generate-assets.mjs'), 'utf8');

    expect(sceneSource).toContain('ASSET_KEYS.playerSaria');
    expect(sceneSource).toContain('ASSET_PATHS.playerSaria');
    expect(generatorSource).toContain('public/assets/sprites/player-saria.png');
    expect(generatorSource).toContain('SARIA_PALETTE');
    expect(generatorSource).toContain('drawSariaHorns');
    expect(generatorSource).toContain('drawSariaTail');
    expect(generatorSource).toContain('drawSariaShield');
  });
});

describe('四角色动画帧配置', () => {
  const SHEETS = [
    ASSET_PATHS.playerVishdal,
    ASSET_PATHS.playerAmiya,
    ASSET_PATHS.playerSaria,
    ASSET_PATHS.playerMuelsyse,
  ] as const;

  it('每人都具备四向待机、至少两帧行走、攻击、受击与八向施法帧', () => {
    expect(PLAYER_SPRITE_IDS).toHaveLength(4);
    expect(PLAYER_ACTION_COLUMNS.walk.length).toBeGreaterThanOrEqual(2);

    for (const path of SHEETS) {
      const png = decodePng(path);
      expect(png.width).toBe(PLAYER_ART.sheetWidth);
      expect(png.height).toBe(PLAYER_ART.sheetHeight);

      for (const direction of PLAYER_DIRECTIONS) {
        const row = PLAYER_DIRECTIONS.indexOf(direction);
        for (const action of Object.keys(PLAYER_ACTION_COLUMNS) as Array<
          keyof typeof PLAYER_ACTION_COLUMNS
        >) {
          for (const column of PLAYER_ACTION_COLUMNS[action]) {
            expect(
              countOpaqueInFrame(png, column, row),
              `${path} ${direction} ${action} 第 ${column} 列不应为空`,
            ).toBeGreaterThan(200);
          }
        }
      }

      for (const direction of PLAYER_CAST_DIRECTIONS) {
        const frame = playerCastFrameIndex(direction);
        const column = frame % PLAYER_ART.sheetColumns;
        const row = Math.floor(frame / PLAYER_ART.sheetColumns);
        expect(row).toBe(PLAYER_CAST_ROW);
        expect(
          countOpaqueInFrame(png, column, row),
          `${path} ${direction} 施法帧不应为空`,
        ).toBeGreaterThan(200);
      }
    }
  });

  it('四张精灵表均存在且互不相同，不是同一占位图复用', () => {
    const hashes = new Set(
      SHEETS.map((path) =>
        createHash('sha1')
          .update(readFileSync(resolve(ROOT, `public${path}`)))
          .digest('hex'),
      ),
    );
    expect(hashes.size).toBe(SHEETS.length);
  });
});
