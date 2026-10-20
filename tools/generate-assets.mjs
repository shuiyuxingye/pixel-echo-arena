/**
 * 生成游戏内像素资源（无第三方依赖，PNG 由 zlib 直接编码）。
 * 运行：npm run assets
 * 资源是游戏源文件，生成结果提交到 public/assets/。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- PNG 编码 ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 画布与颜色 ----------

function color(hex) {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
    255,
  ];
}

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
  }

  set(x, y, rgba) {
    // 坐标可能来自缩放后的多边形/盾牌；先取整，避免非整数偏移写坏相邻像素的通道。
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    this.pixels.set(rgba, (py * this.width + px) * 4);
  }

  rect(x, y, width, height, rgba) {
    for (let py = y; py < y + height; py += 1) {
      for (let px = x; px < x + width; px += 1) this.set(px, py, rgba);
    }
  }

  ellipse(cx, cy, radiusX, radiusY, rgba) {
    for (let y = Math.floor(cy - radiusY); y <= Math.ceil(cy + radiusY); y += 1) {
      for (let x = Math.floor(cx - radiusX); x <= Math.ceil(cx + radiusX); x += 1) {
        const dx = (x - cx) / radiusX;
        const dy = (y - cy) / radiusY;
        if (dx * dx + dy * dy <= 1) this.set(x, y, rgba);
      }
    }
  }

  blendEllipse(cx, cy, radiusX, radiusY, rgba, alpha) {
    for (let y = Math.floor(cy - radiusY); y <= Math.ceil(cy + radiusY); y += 1) {
      for (let x = Math.floor(cx - radiusX); x <= Math.ceil(cx + radiusX); x += 1) {
        const dx = (x - cx) / radiusX;
        const dy = (y - cy) / radiusY;
        if (dx * dx + dy * dy <= 1) this.blend(x, y, rgba, alpha);
      }
    }
  }

  /** 半透明叠加，用于污渍、地面标记。 */
  blend(x, y, rgba, alpha) {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const index = (py * this.width + px) * 4;
    const srcAlpha = (rgba[3] / 255) * alpha;
    for (let channel = 0; channel < 3; channel += 1) {
      this.pixels[index + channel] = Math.round(
        rgba[channel] * srcAlpha + this.pixels[index + channel] * (1 - srcAlpha),
      );
    }
    this.pixels[index + 3] = Math.max(this.pixels[index + 3], Math.round(255 * srcAlpha));
  }

  /** 扫描线填充多边形，用于角、发梢等有棱角的像素形状。 */
  polygon(points, rgba) {
    const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]))));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(...points.map((p) => p[1]))));
    for (let y = minY; y <= maxY; y += 1) {
      const crossings = [];
      for (let i = 0; i < points.length; i += 1) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        const sampleY = y + 0.5;
        if ((y1 <= sampleY && y2 > sampleY) || (y2 <= sampleY && y1 > sampleY)) {
          crossings.push(x1 + ((sampleY - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const startX = Math.max(0, Math.round(crossings[i]));
        const endX = Math.min(this.width - 1, Math.round(crossings[i + 1]) - 1);
        for (let x = startX; x <= endX; x += 1) this.set(x, y, rgba);
      }
    }
  }

  /** 给多边形描边：把同一形状向四周平移若干像素后叠加。 */
  polygonOutline(points, rgba, thickness = 1) {
    for (let dy = -thickness; dy <= thickness; dy += 1) {
      for (let dx = -thickness; dx <= thickness; dx += 1) {
        if (dx * dx + dy * dy > thickness * thickness + 0.5) continue;
        this.polygon(
          points.map(([x, y]) => [x + dx, y + dy]),
          rgba,
        );
      }
    }
  }

  /** 像素直线：沿 Bresenham 路径盖方形笔刷，不做抗锯齿。 */
  line(x0, y0, x1, y1, thickness, rgba) {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const endX = Math.round(x1);
    const endY = Math.round(y1);
    const dx = Math.abs(endX - x);
    const dy = -Math.abs(endY - y);
    const stepX = x < endX ? 1 : -1;
    const stepY = y < endY ? 1 : -1;
    const half = Math.floor(thickness / 2);
    let error = dx + dy;
    for (let guard = 0; guard < 256; guard += 1) {
      for (let oy = -half; oy < thickness - half; oy += 1) {
        for (let ox = -half; ox < thickness - half; ox += 1) {
          this.set(x + ox, y + oy, rgba);
        }
      }
      if (x === endX && y === endY) break;
      const doubled = error * 2;
      if (doubled >= dy) {
        error += dy;
        x += stepX;
      }
      if (doubled <= dx) {
        error += dx;
        y += stepY;
      }
    }
  }

  /** 把另一张画布叠到当前画布，可选水平镜像（左右朝向共用一套绘制）。 */
  blit(source, dx, dy, flipX = false) {
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const index = (y * source.width + x) * 4;
        if (source.pixels[index + 3] === 0) continue;
        const sourceX = flipX ? source.width - 1 - x : x;
        const targetX = dx + sourceX;
        const targetY = dy + y;
        if (targetX < 0 || targetY < 0 || targetX >= this.width || targetY >= this.height) {
          continue;
        }
        const targetIndex = (targetY * this.width + targetX) * 4;
        this.pixels.set(source.pixels.subarray(index, index + 4), targetIndex);
      }
    }
  }

  save(relativePath) {
    const target = resolve(ROOT, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, encodePng(this.width, this.height, this.pixels));
    console.log(`wrote ${relativePath} (${this.width}x${this.height})`);
  }
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 场地地砖 ----------

const ARENA_WIDTH = 1440;
const ARENA_HEIGHT = 960;
const TILE = 48;

function drawFloor() {
  const canvas = new Canvas(ARENA_WIDTH, ARENA_HEIGHT);
  const random = mulberry32(0x7e11a);
  const base = color('#17141d');

  canvas.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT, base);

  // 逐块地砖：轻微明暗差异 + 板缝
  for (let ty = 0; ty < ARENA_HEIGHT / TILE; ty += 1) {
    for (let tx = 0; tx < ARENA_WIDTH / TILE; tx += 1) {
      const shade = Math.floor(random() * 10) - 5;
      const tile = [26 + shade, 23 + shade, 33 + shade, 255];
      canvas.rect(tx * TILE + 1, ty * TILE + 1, TILE - 2, TILE - 2, tile);
      // 板缝
      canvas.rect(tx * TILE, ty * TILE, TILE, 1, color('#0e0c12'));
      canvas.rect(tx * TILE, ty * TILE, 1, TILE, color('#0e0c12'));
      // 偶尔的亮边，模拟磨损金属
      if (random() < 0.18) {
        canvas.rect(tx * TILE + 2, ty * TILE + 2, TILE - 4, 1, color('#24202c'));
      }
    }
  }

  // 散落污渍与灰尘
  for (let i = 0; i < 260; i += 1) {
    const x = Math.floor(random() * ARENA_WIDTH);
    const y = Math.floor(random() * ARENA_HEIGHT);
    const radius = 2 + Math.floor(random() * 12);
    canvas.blendEllipse(x, y, radius, radius * 0.6, [0, 0, 0, 255], 0.18 + random() * 0.16);
  }

  // 划痕
  for (let i = 0; i < 90; i += 1) {
    const x = Math.floor(random() * ARENA_WIDTH);
    const y = Math.floor(random() * ARENA_HEIGHT);
    const length = 4 + Math.floor(random() * 22);
    const slanted = random() < 0.5;
    for (let step = 0; step < length; step += 1) {
      canvas.blend(x + step, y + (slanted ? Math.floor(step / 3) : 0), color('#2f2a38'), 0.5);
    }
  }

  // 中央废弃实验标记：双环 + 十字刻线
  const cx = ARENA_WIDTH / 2;
  const cy = ARENA_HEIGHT / 2;
  for (let angle = 0; angle < 360; angle += 1) {
    if (Math.floor(angle / 8) % 2 === 0) continue;
    const radians = (angle * Math.PI) / 180;
    for (const radius of [150, 212]) {
      canvas.blend(
        Math.round(cx + Math.cos(radians) * radius),
        Math.round(cy + Math.sin(radians) * radius * 0.75),
        color('#4a4157'),
        0.55,
      );
    }
  }
  for (let offset = -120; offset <= 120; offset += 1) {
    canvas.blend(Math.round(cx + offset), Math.round(cy), color('#4a4157'), 0.35);
    canvas.blend(Math.round(cx), Math.round(cy + offset), color('#4a4157'), 0.35);
  }

  // 外围 32px 墙基阴影
  const rim = color('#0c0a10');
  canvas.rect(0, 0, ARENA_WIDTH, 10, rim);
  canvas.rect(0, ARENA_HEIGHT - 10, ARENA_WIDTH, 10, rim);
  canvas.rect(0, 0, 10, ARENA_HEIGHT, rim);
  canvas.rect(ARENA_WIDTH - 10, 0, 10, ARENA_HEIGHT, rim);

  canvas.save('public/assets/arena/floor.png');
}

// ---------- 墙体 / 掩体图块 ----------

function drawWallTile() {
  const canvas = new Canvas(32, 32);
  const random = mulberry32(0x5eed1);
  canvas.rect(0, 0, 32, 32, color('#241f2c'));
  canvas.rect(2, 2, 28, 28, color('#342d3f'));
  canvas.rect(2, 2, 28, 2, color('#4a4058'));
  canvas.rect(2, 28, 28, 2, color('#171320'));
  canvas.rect(28, 2, 2, 28, color('#211b2b'));
  // 铆钉
  for (const [x, y] of [
    [5, 5],
    [25, 5],
    [5, 25],
    [25, 25],
  ]) {
    canvas.rect(x, y, 2, 2, color('#6a5d7d'));
    canvas.rect(x, y + 1, 2, 1, color('#1a1622'));
  }
  // 金属噪点
  for (let i = 0; i < 26; i += 1) {
    const x = 3 + Math.floor(random() * 26);
    const y = 3 + Math.floor(random() * 26);
    canvas.set(x, y, color(random() < 0.5 ? '#2b2536' : '#3d3549'));
  }
  canvas.save('public/assets/arena/wall.png');
}

function drawCoverTile() {
  const canvas = new Canvas(32, 32);
  canvas.rect(0, 0, 32, 32, color('#1a1622'));
  canvas.rect(2, 2, 28, 28, color('#3f3327'));
  canvas.rect(2, 2, 28, 2, color('#5c4a33'));
  canvas.rect(2, 28, 28, 2, color('#120f17'));
  // 黄黑警戒斜纹
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      if ((x + y) % 10 < 5) canvas.blend(x, y, color('#c9952b'), 0.35);
    }
  }
  canvas.rect(0, 12, 32, 3, color('#c9952b'));
  canvas.rect(0, 12, 32, 1, color('#f2c14e'));
  canvas.rect(0, 17, 32, 3, color('#c9952b'));
  canvas.rect(0, 17, 32, 1, color('#f2c14e'));
  // 铆钉
  for (const [x, y] of [
    [5, 5],
    [25, 5],
    [5, 25],
    [25, 25],
  ]) {
    canvas.rect(x, y, 2, 2, color('#8a7450'));
  }
  canvas.save('public/assets/arena/cover.png');
}

// ---------- 玩家精灵：维什戴尔 Q 版像素精灵表（64×64） ----------
//
// 造型基准：docs/references/wisadel-chibi-reference.png
// 精灵表布局 8 列 × 5 行：
//   列 0-1 待机、2-5 行走、6 攻击、7 受击；
//   行 0 下、1 右、2 上、3 左（左向由右向镜像）；
//   行 4 为八向施法指向帧：北、东北、东、东南、南、西南、西、西北。
// 脚底锚点在每帧 y = 61，逻辑碰撞半径保持 12。

const CHIBI = {
  frameSize: 64,
  columns: 8,
  rows: 5,
  baseline: 61,
};

const CHIBI_PALETTE = {
  outline: color('#17131f'),
  outlineSoft: color('#2a2233'),
  hair: color('#c9ced8'),
  hairLight: color('#f3f5fa'),
  hairShade: color('#9aa2b1'),
  hairDark: color('#6b7283'),
  horn: color('#b3222c'),
  hornLight: color('#e2453b'),
  hornDark: color('#5b1119'),
  skin: color('#f8d9c0'),
  skinShade: color('#e9bb98'),
  skinDeep: color('#c98f6f'),
  eyeWhite: color('#fff7e2'),
  iris: color('#f7a81f'),
  irisLight: color('#ffd45c'),
  irisDark: color('#cf6f10'),
  pupil: color('#2a1a14'),
  blush: color('#ef8f92'),
  jacket: color('#221d2a'),
  jacketDark: color('#15121c'),
  jacketRed: color('#b8262e'),
  jacketRedLight: color('#e34a3c'),
  jacketRedDark: color('#6f141d'),
  shirt: color('#e8e4ef'),
  belt: color('#121019'),
  metal: color('#566173'),
  metalLight: color('#a3aebd'),
  metalDark: color('#2c3341'),
  muzzle: color('#ff9f2e'),
  muzzleHot: color('#ffe066'),
  boot: color('#191521'),
  bootLight: color('#3a3147'),
};

function lineLoop(canvas, points, thickness, rgba) {
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    canvas.line(x0, y0, x1, y1, thickness, rgba);
  }
}

/** 呆毛：从头顶向右侧翘起的两段曲线。 */
function drawAhoge(canvas, x, y, sway) {
  const points = [
    [33 + x, 13 + y],
    [32 + x, 10 + y],
    [33 + x + sway, 7 + y],
    [36 + x + sway, 4 + y],
    [40 + x + sway, 3 + y],
    [43 + x, 5 + y],
    [44 + x, 8 + y],
    [42 + x, 10 + y],
  ];
  lineLoop(canvas, points, 5, CHIBI_PALETTE.outline);
  lineLoop(canvas, points, 3, CHIBI_PALETTE.hair);
  canvas.line(37 + x + sway, 4 + y, 41 + x, 6 + y, 1, CHIBI_PALETTE.hairLight);
}

/** 红黑角饰：主角 + 侧后短刺 + 耳侧小角，均为块状红色配深色描边。 */
function drawHorn(canvas, side, y) {
  const mirror = (points) => points.map(([px, py]) => [side > 0 ? 64 - px : px, py + y]);
  const main = mirror([
    [17, 15],
    [12, 12],
    [7, 7],
    [4, 4],
    [3, 8],
    [8, 12],
    [12, 17],
    [16, 17],
  ]);
  const spike = mirror([
    [14, 19],
    [9, 17],
    [5, 15],
    [4, 20],
    [9, 23],
    [14, 22],
  ]);
  const ear = mirror([
    [13, 26],
    [8, 25],
    [4, 29],
    [9, 32],
    [13, 30],
  ]);
  const { outline, horn, hornLight, hornDark } = CHIBI_PALETTE;
  for (const shape of [main, spike, ear]) {
    canvas.polygonOutline(shape, outline, 1);
    canvas.polygon(shape, horn);
  }
  canvas.polygon(
    mirror([
      [13, 15],
      [9, 12],
      [5, 8],
      [5, 10],
      [9, 14],
      [13, 17],
    ]),
    hornLight,
  );
  canvas.polygon(
    mirror([
      [4, 4],
      [2, 7],
      [5, 8],
      [6, 5],
    ]),
    hornDark,
  );
  canvas.polygon(
    mirror([
      [5, 17],
      [4, 20],
      [8, 21],
      [8, 18],
    ]),
    hornDark,
  );
}

function drawHairCap(canvas, cx, cy, rx, ry) {
  const { outline, hair, hairLight, hairShade } = CHIBI_PALETTE;
  canvas.ellipse(cx, cy, rx + 1.5, ry + 1.5, outline);
  canvas.ellipse(cx, cy, rx, ry, hair);
  canvas.ellipse(cx, cy - ry * 0.28, rx * 0.78, ry * 0.35, hairLight);
  canvas.ellipse(cx + rx * 0.52, cy + ry * 0.18, rx * 0.34, ry * 0.5, hairShade);
  canvas.ellipse(cx - rx * 0.55, cy + ry * 0.12, rx * 0.28, ry * 0.45, hairShade);
}

function drawSideLocks(canvas, x, y, mode) {
  const { outline, hair, hairShade, hairLight } = CHIBI_PALETTE;
  const back = mode === 'up';
  const locks = [
    [14, 20],
    [20, 22],
    [18, 32],
    [16, 41],
    [12, 43],
    [10, 34],
    [10, 25],
  ];
  const rightLock = locks.map(([px, py]) => [64 - px, py]);
  // 侧面只需要后脑一侧的发束，另一侧交给脸部轮廓
  const shapes = mode === 'side' ? [locks] : [locks, rightLock];
  for (const shape of shapes) {
    canvas.polygonOutline(shape.map(([px, py]) => [px + x, py + y]), outline, 1);
    canvas.polygon(shape.map(([px, py]) => [px + x, py + y]), hair);
  }
  canvas.line(14 + x, 25 + y, 13 + x, 38 + y, 1, hairShade);
  if (mode !== 'side') canvas.line(50 + x, 25 + y, 51 + x, 38 + y, 1, hairShade);
  if (!back) {
    canvas.line(15 + x, 24 + y, 13 + x, 35 + y, 1, hairLight);
    if (mode !== 'side') canvas.line(49 + x, 24 + y, 51 + x, 35 + y, 1, hairLight);
  }
}

function drawFringe(canvas, x, y, mode) {
  const { hair, hairLight, hairShade, outline } = CHIBI_PALETTE;
  if (mode === 'back') return;
  const bands =
    mode === 'side'
      ? [
          [28, 35, 22],
          [35, 40, 26],
          [40, 45, 22],
          [45, 50, 25],
        ]
      : [
          [14, 20, 21],
          [20, 25, 25],
          [25, 29, 21],
          [29, 34, 27],
          [34, 38, 22],
          [38, 43, 25],
          [43, 47, 21],
          [47, 51, 23],
        ];
  for (const [x0, x1, bottom] of bands) {
    canvas.rect(x0 + x, 10 + y, x1 - x0, bottom - 10, hair);
    canvas.rect(x0 + x, bottom - 1 + y, x1 - x0, 1, hairShade);
  }
  // 额前高光与发缝
  canvas.rect(20 + x, 12 + y, 5, 1, hairLight);
  canvas.rect(35 + x, 12 + y, 6, 1, hairLight);
  canvas.line(31 + x, 11 + y, 29 + x, 19 + y, 1, hairShade);
  canvas.line(35 + x, 11 + y, 37 + x, 18 + y, 1, hairShade);
  canvas.rect(29 + x, 22 + y, 1, 4, outline);
}

function drawEye(canvas, cx, cy, mood, big = false) {
  const {
    outline,
    eyeWhite,
    iris,
    irisLight,
    irisDark,
    pupil,
    skin,
  } = CHIBI_PALETTE;
  if (mood === 'hurt') {
    canvas.line(cx - 4, cy - 4, cx + 3, cy - 1, 1, outline);
    canvas.line(cx - 4, cy + 2, cx + 3, cy + 5, 1, outline);
    return;
  }
  const wide = mood === 'attack' ? 1 : 0;
  const grow = big ? 1 : 0;
  canvas.ellipse(cx, cy, 6 + grow, 5.5 + grow, outline);
  canvas.ellipse(cx, cy, 4.5 + grow, 4.5 + grow, eyeWhite);
  canvas.ellipse(cx, cy + 1, 3.5 + grow, 3.8 + grow, iris);
  canvas.ellipse(cx, cy + 2, 3 + grow, 2.6 + grow * 0.5, irisLight);
  canvas.rect(cx - 1, cy + 1 - wide, 2, 4 + wide + grow, pupil);
  canvas.rect(cx - 3, cy - 1, 1, 2 + grow, eyeWhite);
  canvas.rect(cx + 2, cy + 3, 1, 1, irisDark);
  // 半垂的上眼睑，形成漫不经心的狡黠表情
  const lidY = mood === 'attack' ? cy - 6 : cy - 4 - grow;
  canvas.rect(cx - 5 - grow, lidY, 10 + grow * 2, mood === 'attack' ? 1 : 2, outline);
  if (mood !== 'attack') canvas.rect(cx - 4 - grow, lidY + 1, 9 + grow * 2, 1, skin);
}

function drawMouth(canvas, cx, cy, mood) {
  const { outline, skinDeep, irisDark } = CHIBI_PALETTE;
  if (mood === 'attack' || mood === 'hurt') {
    canvas.ellipse(cx, cy, 2, 2.5, outline);
    canvas.rect(cx - 1, cy + 1, 2, 1, irisDark);
    return;
  }
  // 猫嘴形 ω
  canvas.set(cx - 2, cy, outline);
  canvas.set(cx - 1, cy + 1, outline);
  canvas.set(cx, cy, outline);
  canvas.set(cx + 1, cy + 1, outline);
  canvas.set(cx + 2, cy, outline);
  canvas.rect(cx - 1, cy + 2, 3, 1, skinDeep);
}

function drawBlush(canvas, cy) {
  const { blush } = CHIBI_PALETTE;
  for (const [x0, rows] of [
    [18, [0, 1, 1]],
    [43, [1, 0, 0]],
  ]) {
    rows.forEach((offset, index) => {
      canvas.rect(x0 + index, cy + offset, 1, 1, blush);
    });
    canvas.rect(x0 + 1, cy + 1, 2, 1, blush);
  }
}

function drawHeadFront(canvas, x, y, mood, back) {
  const p = CHIBI_PALETTE;
  drawHairCap(canvas, 32 + x, 25 + y, 19, 17);
  drawSideLocks(canvas, x, y, back ? 'up' : 'down');
  if (back) {
    // 后脑：发旋与低马尾束
    canvas.rect(28 + x, 14 + y, 9, 1, p.hairLight);
    canvas.line(31 + x, 15 + y, 33 + x, 25 + y, 1, p.hairShade);
    canvas.ellipse(32 + x, 37 + y, 8, 5, p.hairShade);
    canvas.polygon(
      [
        [27 + x, 38 + y],
        [37 + x, 38 + y],
        [34 + x, 44 + y],
        [29 + x, 44 + y],
      ],
      p.hairDark,
    );
    return;
  }
  canvas.ellipse(32 + x, 30 + y, 15, 13, p.outline);
  canvas.ellipse(32 + x, 30 + y, 14, 12, p.skin);
  canvas.ellipse(32 + x, 39 + y, 10, 3, p.skinShade);
  drawFringe(canvas, x, y, 'front');
  drawEye(canvas, 24 + x, 31 + y, mood);
  drawEye(canvas, 40 + x, 31 + y, mood);
  drawMouth(canvas, 32 + x, 39 + y, mood);
  drawBlush(canvas, 37 + y);
}

function drawHeadSide(canvas, x, y, mood) {
  const p = CHIBI_PALETTE;
  drawHairCap(canvas, 30 + x, 25 + y, 19, 17);
  drawSideLocks(canvas, x, y, 'side');
  canvas.ellipse(41 + x, 30 + y, 11.5, 12.5, p.outline);
  canvas.ellipse(41 + x, 30 + y, 10.5, 11.5, p.skin);
  canvas.ellipse(44 + x, 39 + y, 7, 3, p.skinShade);
  drawFringe(canvas, x, y, 'side');
  drawEye(canvas, 42 + x, 31 + y, mood, true);
  canvas.set(50 + x, 35 + y, p.skinDeep);
  canvas.rect(46 + x, 39 + y, 2, 1, p.skinDeep);
  drawMouth(canvas, 47 + x, 39 + y, mood);
  canvas.rect(45 + x, 37 + y, 3, 1, p.blush);
  canvas.rect(45 + x, 38 + y, 2, 1, p.blush);
}

function drawBoot(canvas, x, y, width, height) {
  const { outline, boot, bootLight } = CHIBI_PALETTE;
  canvas.rect(x - 1, y - 1, width + 2, height + 2, outline);
  canvas.rect(x, y, width, height, boot);
  canvas.rect(x, y, width, 1, bootLight);
}

function drawBodyFront(canvas, x, y, legPhase, back) {
  const p = CHIBI_PALETTE;
  const swing = legPhase * 2;
  // 短腿与厚靴：脚底固定在同一行，身体起伏不影响落脚点
  drawBoot(canvas, 23 + x + swing, 57, 8, 4);
  drawBoot(canvas, 33 + x - swing, 57, 8, 4);
  canvas.rect(24 + x + swing, 54, 6, 3, p.jacketDark);
  canvas.rect(34 + x - swing, 54, 6, 3, p.jacketDark);
  // 躯干轮廓
  canvas.rect(17 + x, 41 + y, 30, 16, p.outline);
  canvas.rect(18 + x, 42 + y, 28, 14, p.jacket);
  // 红色夹克侧片
  canvas.rect(18 + x, 42 + y, 5, 14, p.jacketRed);
  canvas.rect(41 + x, 42 + y, 5, 14, p.jacketRed);
  canvas.rect(18 + x, 42 + y, 1, 14, p.jacketRedDark);
  canvas.rect(45 + x, 42 + y, 1, 14, p.jacketRedDark);
  canvas.rect(21 + x, 43 + y, 1, 10, p.jacketRedLight);
  canvas.rect(42 + x, 43 + y, 1, 10, p.jacketRedLight);
  if (back) {
    // 背面：红色肩线、中央黑色背带与金属扣
    canvas.rect(23 + x, 42 + y, 18, 2, p.jacketRed);
    canvas.rect(28 + x, 45 + y, 8, 8, p.jacketDark);
    canvas.rect(30 + x, 47 + y, 4, 1, p.jacketRedLight);
    canvas.polygon(
      [
        [30 + x, 49 + y],
        [34 + x, 49 + y],
        [32 + x, 52 + y],
      ],
      p.jacketRed,
    );
  } else {
    // 正面：白色内衬与红色领结
    canvas.polygon(
      [
        [27 + x, 42 + y],
        [37 + x, 42 + y],
        [32 + x, 49 + y],
      ],
      p.shirt,
    );
    canvas.rect(31 + x, 43 + y, 2, 4, p.jacketRed);
    canvas.polygon(
      [
        [29 + x, 43 + y],
        [31 + x, 44 + y],
        [30 + x, 46 + y],
      ],
      p.jacketRedDark,
    );
    canvas.polygon(
      [
        [35 + x, 43 + y],
        [33 + x, 44 + y],
        [34 + x, 46 + y],
      ],
      p.jacketRedDark,
    );
  }
  // 腰带与扣
  canvas.rect(18 + x, 52 + y, 28, 2, p.belt);
  canvas.rect(31 + x, 52 + y, 3, 2, p.metalLight);
  // 手臂
  canvas.rect(11 + x, 44 + y, 8, 11, p.outline);
  canvas.rect(12 + x, 45 + y, 6, 9, p.jacketRed);
  canvas.rect(12 + x, 45 + y, 1, 8, p.jacketRedDark);
  canvas.rect(13 + x, 51 + y, 3, 3, p.skin);
  canvas.rect(45 + x, 44 + y, 8, 11, p.outline);
  canvas.rect(46 + x, 45 + y, 6, 9, p.jacketRed);
  canvas.rect(50 + x, 45 + y, 1, 8, p.jacketRedDark);
  canvas.rect(47 + x, 51 + y, 3, 3, p.skin);
}

function drawBodySide(canvas, x, y, legPhase) {
  const p = CHIBI_PALETTE;
  const swing = legPhase * 3;
  drawBoot(canvas, 25 + x - swing, 57, 9, 4);
  drawBoot(canvas, 35 + x + swing, 57, 9, 4);
  canvas.rect(26 + x - swing, 54, 6, 3, p.jacketDark);
  canvas.rect(36 + x + swing, 54, 6, 3, p.jacketDark);
  canvas.rect(20 + x, 41 + y, 25, 16, p.outline);
  canvas.rect(21 + x, 42 + y, 23, 14, p.jacket);
  canvas.rect(21 + x, 42 + y, 4, 14, p.jacketRed);
  canvas.rect(40 + x, 42 + y, 4, 14, p.jacketRed);
  canvas.rect(21 + x, 42 + y, 1, 14, p.jacketRedDark);
  canvas.rect(43 + x, 42 + y, 1, 14, p.jacketRedDark);
  canvas.rect(22 + x, 43 + y, 1, 10, p.jacketRedLight);
  canvas.rect(24 + x, 42 + y, 8, 2, p.jacketRedDark);
  canvas.rect(21 + x, 52 + y, 23, 2, p.belt);
  canvas.rect(24 + x, 52 + y, 2, 2, p.metalLight);
  // 前伸的手臂
  canvas.rect(40 + x, 44 + y, 10, 10, p.outline);
  canvas.rect(41 + x, 45 + y, 8, 8, p.jacketRed);
  canvas.rect(41 + x, 45 + y, 1, 7, p.jacketRedDark);
  canvas.rect(46 + x, 50 + y, 4, 3, p.skin);
}

function drawLauncher(canvas, x0, y0, x1, y1) {
  const { outline, metal, metalLight, metalDark, muzzle, jacketRed } = CHIBI_PALETTE;
  canvas.line(x0, y0, x1, y1, 8, outline);
  canvas.line(x0, y0, x1, y1, 5, metal);
  canvas.line(x0, y0, x1, y1, 1, metalLight);
  canvas.line(x0 + 1, y0 + 2, x1 + 1, y1 + 2, 2, metalDark);
  // 枪口与红色识别带
  canvas.rect(x1 - 2, y1 - 2, 5, 5, outline);
  canvas.rect(x1 - 1, y1 - 1, 3, 3, muzzle);
  const midX = Math.round((x0 + x1) / 2);
  const midY = Math.round((y0 + y1) / 2);
  canvas.rect(midX - 1, midY - 1, 3, 3, jacketRed);
  canvas.rect(x0 - 1, y0 - 1, 3, 3, metalLight);
  // 握把
  canvas.line(x0 - 2, y0 + 1, x0 - 4, y0 + 5, 3, outline);
}

function drawMuzzleFlash(canvas, x, y) {
  const { muzzle, muzzleHot } = CHIBI_PALETTE;
  canvas.rect(x - 2, y, 5, 1, muzzle);
  canvas.rect(x, y - 2, 1, 5, muzzle);
  canvas.rect(x - 1, y - 1, 3, 3, muzzleHot);
  canvas.set(x - 3, y, muzzle);
  canvas.set(x, y - 3, muzzle);
  canvas.set(x + 3, y, muzzle);
  canvas.set(x, y + 3, muzzle);
}

/** 八向施法枪口几何，避开脸部并保证不触帧边缘。 */
const CAST_POSES = [
  { base: 'right', x0: 53, y0: 46, x1: 53, y1: 20, fx: 53, fy: 17 },
  { base: 'right', x0: 45, y0: 47, x1: 57, y1: 32, fx: 59, fy: 30 },
  { base: 'right', x0: 43, y0: 49, x1: 58, y1: 49, fx: 59, fy: 49 },
  { base: 'right', x0: 44, y0: 50, x1: 54, y1: 57, fx: 56, fy: 59 },
  { base: 'down', x0: 46, y0: 52, x1: 52, y1: 58, fx: 54, fy: 58 },
  { base: 'left', x0: 18, y0: 50, x1: 9, y1: 57, fx: 7, fy: 59 },
  { base: 'left', x0: 20, y0: 49, x1: 5, y1: 49, fx: 4, fy: 49 },
  { base: 'left', x0: 18, y0: 47, x1: 7, y1: 31, fx: 5, fy: 29 },
];

function drawChibiFrame(direction, action, frameIndex) {
  let frame = new Canvas(CHIBI.frameSize, CHIBI.frameSize);
  const p = CHIBI_PALETTE;
  const mirror = direction === 'left';
  const base = mirror ? 'right' : direction;
  const mood = action === 'hurt' ? 'hurt' : action === 'attack' ? 'attack' : 'idle';
  const idle = action === 'idle';
  const walk = action === 'walk';
  const legPhase = walk ? [-1, 0, 1, 0][frameIndex % 4] : 0;
  const bob = idle ? frameIndex % 2 : walk ? (frameIndex % 2 === 0 ? 0 : 1) : 0;
  const headX = action === 'hurt' ? 2 : 0;
  const headY = (action === 'hurt' ? 1 : 0) + bob;
  const bodyY = action === 'hurt' ? 1 : bob;
  const showWeapon = action !== 'cast';

  // 角先画，发帽会压住根部，形成从发侧伸出的层次
  if (base === 'down' || base === 'up') {
    drawHorn(frame, 1, headY);
    drawHorn(frame, -1, headY);
  } else {
    drawHorn(frame, 1, headY);
    // 远侧角只露出尖端
    frame.polygonOutline(
      [
        [3, 14 + headY],
        [8, 17 + headY],
        [9, 22 + headY],
        [4, 19 + headY],
      ],
      p.outline,
      1,
    );
    frame.polygon(
      [
        [4, 16 + headY],
        [8, 18 + headY],
        [8, 21 + headY],
        [5, 19 + headY],
      ],
      p.hornDark,
    );
  }
  drawAhoge(frame, headX, headY, idle ? (frameIndex % 2 ? 1 : 0) : 0);

  if (base === 'right') {
    drawBodySide(frame, 0, bodyY, legPhase);
    if (showWeapon && action !== 'attack') {
      drawLauncher(frame, 45, 50, 59, 50);
    }
    if (showWeapon && action === 'attack') {
      drawLauncher(frame, 43, 48, 56, 48);
      drawMuzzleFlash(frame, 59, 48);
    }
    drawHeadSide(frame, headX, headY, mood);
  } else {
    const back = base === 'up';
    drawBodyFront(frame, 0, bodyY, legPhase, back);
    if (showWeapon && action !== 'attack') {
      drawLauncher(frame, 44, 53, 58, 44);
    }
    if (showWeapon && action === 'attack') {
      drawLauncher(frame, 46, 54, 56, 36);
      drawMuzzleFlash(frame, 58, 34);
    }
    drawHeadFront(frame, headX, headY, mood, back);
  }

  if (action === 'hurt') {
    // 受击：红色冲击碎片 + 后仰位移
    frame.rect(9, 20, 1, 3, p.jacketRedLight);
    frame.rect(7, 24, 2, 1, p.muzzle);
    frame.rect(53, 18, 1, 2, p.jacketRedLight);
    frame.rect(55, 22, 1, 1, p.muzzle);
  }

  if (mirror) {
    const mirrored = new Canvas(CHIBI.frameSize, CHIBI.frameSize);
    mirrored.blit(frame, 0, 0, true);
    frame = mirrored;
  }

  if (action === 'cast') {
    // 施法帧的枪口坐标已按最终屏幕朝向定义，镜像之后再叠加
    const pose = CAST_POSES[frameIndex];
    drawLauncher(frame, pose.x0, pose.y0, pose.x1, pose.y1);
    drawMuzzleFlash(frame, pose.fx, pose.fy);
  }

  return frame;
}

function drawVishdal() {
  const sheet = new Canvas(
    CHIBI.frameSize * CHIBI.columns,
    CHIBI.frameSize * CHIBI.rows,
  );
  const directionRows = ['down', 'right', 'up', 'left'];
  const frameActions = [
    'idle',
    'idle',
    'walk',
    'walk',
    'walk',
    'walk',
    'attack',
    'hurt',
  ];
  directionRows.forEach((direction, row) => {
    for (let column = 0; column < CHIBI.columns; column += 1) {
      const frame = drawChibiFrame(direction, frameActions[column], column);
      sheet.blit(frame, column * CHIBI.frameSize, row * CHIBI.frameSize);
    }
  });
  for (let column = 0; column < CHIBI.columns; column += 1) {
    const pose = CAST_POSES[column];
    const baseFrame =
      pose.base === 'left'
        ? drawChibiFrame('left', 'cast', column)
        : drawChibiFrame(pose.base, 'cast', column);
    sheet.blit(baseFrame, column * CHIBI.frameSize, 4 * CHIBI.frameSize);
  }
  sheet.save('public/assets/sprites/player-vishdal.png');
}

// ---------- 阿米娅 Q 版精灵表 ----------
//
// 与维什戴尔共用 64×64、8 列 × 5 行的帧布局与脚底基线；
// 造型保留棕发、长兔耳、黑蓝服装与蓝黑术式，不套用维什戴尔的角与炮。

const AMIYA_PALETTE = {
  outline: color('#1a1420'),
  hair: color('#6f4a34'),
  hairLight: color('#a97a57'),
  hairShade: color('#563626'),
  hairDark: color('#3a2418'),
  earInner: color('#d99292'),
  earInnerDark: color('#b06d6d'),
  skin: color('#f8d9c0'),
  skinShade: color('#e9bb98'),
  skinDeep: color('#c98f6f'),
  eyeWhite: color('#fff8ea'),
  iris: color('#4a86d8'),
  irisLight: color('#8cc4ff'),
  irisDark: color('#1f4585'),
  pupil: color('#141a2e'),
  blush: color('#ef9c9c'),
  coat: color('#222a44'),
  coatDark: color('#161b2e'),
  coatLight: color('#38456b'),
  trim: color('#4a74c9'),
  trimLight: color('#7fa9f0'),
  shirt: color('#e9eef7'),
  belt: color('#0f1320'),
  boot: color('#151726'),
  bootLight: color('#2d3346'),
  orb: color('#4d8fe0'),
  orbLight: color('#a8d8ff'),
  orbDark: color('#234a8e'),
};

/** 长兔耳：先画远侧再画近侧；内耳为粉色，根部由发帽压住。 */
function drawAmiyaEars(canvas, x, y, mode, sway = 0) {
  const p = AMIYA_PALETTE;
  const outer = (mirror) => {
    const points = [
      [23 + x, 18 + y],
      [20 + x + sway, 12 + y],
      [17 + x + sway, 7 + y],
      [16 + x + sway, 3 + y],
      [19 + x + sway, 2 + y],
      [23 + x, 7 + y],
      [26 + x, 13 + y],
      [27 + x, 18 + y],
    ];
    return mirror ? points.map(([px, py]) => [64 - px, py]) : points;
  };
  const inner = (mirror) => {
    const points = [
      [21 + x, 15 + y],
      [19 + x + sway, 10 + y],
      [19 + x + sway, 5 + y],
      [21 + x + sway, 4 + y],
      [22 + x, 9 + y],
      [24 + x, 15 + y],
    ];
    return mirror ? points.map(([px, py]) => [64 - px, py]) : points;
  };
  const drawEar = (mirror, fill, innerFill) => {
    const shape = outer(mirror);
    canvas.polygonOutline(shape, p.outline, 1);
    canvas.polygon(shape, fill);
    canvas.polygon(inner(mirror), innerFill);
  };

  if (mode === 'side') {
    // 右向：远侧（左）耳朵只作为压暗轮廓，近侧（右）为完整兔耳。
    drawEar(false, p.hairShade, p.earInnerDark);
    drawEar(true, p.hair, p.earInner);
    return;
  }
  if (mode === 'back') {
    drawEar(true, p.hairShade, p.earInnerDark);
    drawEar(false, p.hair, p.earInner);
    return;
  }
  drawEar(true, p.hair, p.earInner);
  drawEar(false, p.hair, p.earInner);
}

function drawAmiyaHairCap(canvas, cx, cy, rx, ry) {
  const p = AMIYA_PALETTE;
  canvas.ellipse(cx, cy, rx + 1.5, ry + 1.5, p.outline);
  canvas.ellipse(cx, cy, rx, ry, p.hair);
  canvas.ellipse(cx, cy - ry * 0.28, rx * 0.78, ry * 0.36, p.hairLight);
  canvas.ellipse(cx + rx * 0.5, cy + ry * 0.2, rx * 0.35, ry * 0.5, p.hairShade);
  canvas.ellipse(cx - rx * 0.55, cy + ry * 0.12, rx * 0.28, ry * 0.45, p.hairShade);
}

function drawAmiyaSideLocks(canvas, x, y, mode) {
  const p = AMIYA_PALETTE;
  const longLock = [
    [13, 21],
    [20, 23],
    [19, 33],
    [17, 43],
    [14, 46],
    [11, 44],
    [9, 34],
    [9, 25],
  ];
  const rightLock = longLock.map(([px, py]) => [64 - px, py]);
  const shapes = mode === 'side' ? [longLock] : [longLock, rightLock];
  for (const shape of shapes) {
    canvas.polygonOutline(shape.map(([px, py]) => [px + x, py + y]), p.outline, 1);
    canvas.polygon(shape.map(([px, py]) => [px + x, py + y]), p.hair);
  }
  canvas.line(13 + x, 26 + y, 12 + x, 40 + y, 1, p.hairShade);
  if (mode !== 'side') canvas.line(51 + x, 26 + y, 52 + x, 40 + y, 1, p.hairShade);
  if (mode !== 'up') {
    canvas.line(15 + x, 25 + y, 13 + x, 37 + y, 1, p.hairLight);
    if (mode !== 'side') canvas.line(49 + x, 25 + y, 51 + x, 37 + y, 1, p.hairLight);
  }
}

function drawAmiyaFringe(canvas, x, y, mode) {
  const p = AMIYA_PALETTE;
  if (mode === 'back') return;
  const bands =
    mode === 'side'
      ? [
          [28, 35, 22],
          [35, 40, 26],
          [40, 45, 22],
          [45, 50, 25],
        ]
      : [
          [14, 20, 22],
          [20, 25, 25],
          [25, 29, 21],
          [29, 34, 27],
          [34, 38, 22],
          [38, 43, 25],
          [43, 47, 21],
          [47, 51, 23],
        ];
  for (const [x0, x1, bottom] of bands) {
    canvas.rect(x0 + x, 10 + y, x1 - x0, bottom - 10, p.hair);
    canvas.rect(x0 + x, bottom - 1 + y, x1 - x0, 1, p.hairShade);
  }
  canvas.rect(20 + x, 12 + y, 5, 1, p.hairLight);
  canvas.rect(35 + x, 12 + y, 6, 1, p.hairLight);
  canvas.line(31 + x, 11 + y, 29 + x, 19 + y, 1, p.hairShade);
  canvas.line(35 + x, 11 + y, 37 + x, 18 + y, 1, p.hairShade);
}

/** 蓝色大眼：平直上眼睑与内收眉形表达认真表情。 */
function drawAmiyaEye(canvas, cx, cy, mood, big = false) {
  const p = AMIYA_PALETTE;
  if (mood === 'hurt') {
    canvas.line(cx - 4, cy - 4, cx + 3, cy - 1, 1, p.outline);
    canvas.line(cx - 4, cy + 2, cx + 3, cy + 5, 1, p.outline);
    return;
  }
  const wide = mood === 'attack' ? 1 : 0;
  const grow = big ? 1 : 0;
  canvas.ellipse(cx, cy, 6 + grow, 5.6 + grow, p.outline);
  canvas.ellipse(cx, cy, 4.6 + grow, 4.6 + grow, p.eyeWhite);
  canvas.ellipse(cx, cy + 1, 3.6 + grow, 3.9 + grow, p.iris);
  canvas.ellipse(cx, cy + 2, 3 + grow, 2.6 + grow * 0.5, p.irisLight);
  canvas.rect(cx - 1, cy + 1 - wide, 2, 4 + wide + grow, p.pupil);
  canvas.rect(cx - 3, cy - 1, 1, 2 + grow, p.eyeWhite);
  canvas.rect(cx + 2, cy + 3, 1, 1, p.irisDark);
  const lidY = mood === 'attack' ? cy - 6 : cy - 4 - grow;
  canvas.rect(cx - 5 - grow, lidY, 10 + grow * 2, 1, p.hairDark);
  if (mood !== 'attack') canvas.rect(cx - 4 - grow, lidY + 1, 9 + grow * 2, 1, p.skin);
  canvas.set(cx + 5 + grow, lidY + 1, p.hairDark);
}

function drawAmiyaBrows(canvas, x, y, mood, side = false) {
  const p = AMIYA_PALETTE;
  const steep = mood === 'attack' ? 2 : 1;
  if (side) {
    canvas.line(37 + x, 27 + y, 45 + x, 28 + y - steep, 1, p.hairDark);
    return;
  }
  canvas.line(19 + x, 27 + y, 26 + x, 28 + y - steep, 1, p.hairDark);
  canvas.line(45 + x, 27 + y, 38 + x, 28 + y - steep, 1, p.hairDark);
}

function drawAmiyaMouth(canvas, cx, cy, mood) {
  const p = AMIYA_PALETTE;
  if (mood === 'attack') {
    canvas.ellipse(cx, cy, 2, 2.5, p.outline);
    canvas.rect(cx - 1, cy + 1, 2, 1, p.skinDeep);
    return;
  }
  if (mood === 'hurt') {
    canvas.set(cx - 1, cy, p.outline);
    canvas.set(cx, cy + 1, p.outline);
    canvas.set(cx + 1, cy, p.outline);
    return;
  }
  canvas.set(cx - 1, cy, p.outline);
  canvas.set(cx, cy + 1, p.outline);
  canvas.set(cx + 1, cy, p.outline);
}

function drawAmiyaBlush(canvas, cy) {
  const { blush } = AMIYA_PALETTE;
  for (const [x0, rows] of [
    [18, [0, 1, 1]],
    [43, [1, 0, 0]],
  ]) {
    rows.forEach((offset, index) => {
      canvas.rect(x0 + index, cy + offset, 1, 1, blush);
    });
    canvas.rect(x0 + 1, cy + 1, 2, 1, blush);
  }
}

function drawAmiyaHeadFront(canvas, x, y, mood, back, earSway = 0) {
  const p = AMIYA_PALETTE;
  drawAmiyaEars(canvas, x, y, back ? 'back' : 'front', earSway);
  drawAmiyaHairCap(canvas, 32 + x, 25 + y, 19, 16);
  drawAmiyaSideLocks(canvas, x, y, back ? 'up' : 'down');
  if (back) {
    // 后脑：发旋、长发束与蓝色发带
    canvas.rect(28 + x, 14 + y, 9, 1, p.hairLight);
    canvas.line(31 + x, 15 + y, 33 + x, 25 + y, 1, p.hairShade);
    canvas.ellipse(32 + x, 38 + y, 8, 6, p.hairShade);
    canvas.polygon(
      [
        [27 + x, 39 + y],
        [37 + x, 39 + y],
        [35 + x, 45 + y],
        [29 + x, 45 + y],
      ],
      p.hairDark,
    );
    canvas.rect(29 + x, 40 + y, 6, 2, p.trim);
    canvas.rect(31 + x, 42 + y, 3, 3, p.trimLight);
    return;
  }
  canvas.ellipse(32 + x, 30 + y, 15, 13, p.outline);
  canvas.ellipse(32 + x, 30 + y, 14, 12, p.skin);
  canvas.ellipse(32 + x, 39 + y, 10, 3, p.skinShade);
  drawAmiyaFringe(canvas, x, y, 'front');
  drawAmiyaBrows(canvas, x, y, mood);
  drawAmiyaEye(canvas, 24 + x, 32 + y, mood);
  drawAmiyaEye(canvas, 40 + x, 32 + y, mood);
  drawAmiyaMouth(canvas, 32 + x, 40 + y, mood);
  drawAmiyaBlush(canvas, 38 + y);
}

function drawAmiyaHeadSide(canvas, x, y, mood, earSway = 0) {
  const p = AMIYA_PALETTE;
  drawAmiyaEars(canvas, x, y, 'side', earSway);
  drawAmiyaHairCap(canvas, 30 + x, 25 + y, 19, 16);
  drawAmiyaSideLocks(canvas, x, y, 'side');
  canvas.ellipse(41 + x, 30 + y, 11.5, 12.5, p.outline);
  canvas.ellipse(41 + x, 30 + y, 10.5, 11.5, p.skin);
  canvas.ellipse(44 + x, 39 + y, 7, 3, p.skinShade);
  drawAmiyaFringe(canvas, x, y, 'side');
  drawAmiyaBrows(canvas, x, y, mood, true);
  drawAmiyaEye(canvas, 42 + x, 32 + y, mood, true);
  canvas.set(50 + x, 35 + y, p.skinDeep);
  drawAmiyaMouth(canvas, 47 + x, 40 + y, mood);
  canvas.rect(45 + x, 38 + y, 2, 1, p.blush);
}

function drawAmiyaBoot(canvas, x, y, width, height) {
  const p = AMIYA_PALETTE;
  canvas.rect(x - 1, y - 1, width + 2, height + 2, p.outline);
  canvas.rect(x, y, width, height, p.boot);
  canvas.rect(x, y, width, 1, p.bootLight);
}

function drawAmiyaBodyFront(canvas, x, y, legPhase, back) {
  const p = AMIYA_PALETTE;
  const swing = legPhase * 2;
  drawAmiyaBoot(canvas, 23 + x + swing, 57, 8, 4);
  drawAmiyaBoot(canvas, 33 + x - swing, 57, 8, 4);
  canvas.rect(24 + x + swing, 54, 6, 3, p.coatDark);
  canvas.rect(34 + x - swing, 54, 6, 3, p.coatDark);
  // 黑蓝短外套：深色轮廓 + 蓝色侧边与浅色滚边
  canvas.rect(17 + x, 41 + y, 30, 16, p.outline);
  canvas.rect(18 + x, 42 + y, 28, 14, p.coat);
  canvas.rect(18 + x, 42 + y, 4, 14, p.trim);
  canvas.rect(42 + x, 42 + y, 4, 14, p.trim);
  canvas.rect(18 + x, 42 + y, 1, 14, p.coatDark);
  canvas.rect(45 + x, 42 + y, 1, 14, p.coatDark);
  canvas.rect(21 + x, 43 + y, 1, 8, p.trimLight);
  canvas.rect(42 + x, 43 + y, 1, 8, p.trimLight);
  if (back) {
    canvas.rect(23 + x, 42 + y, 18, 2, p.trim);
    canvas.rect(28 + x, 45 + y, 8, 8, p.coatDark);
    canvas.polygon(
      [
        [30 + x, 46 + y],
        [34 + x, 46 + y],
        [32 + x, 51 + y],
      ],
      p.trimLight,
    );
  } else {
    canvas.polygon(
      [
        [27 + x, 42 + y],
        [37 + x, 42 + y],
        [32 + x, 49 + y],
      ],
      p.shirt,
    );
    canvas.rect(31 + x, 44 + y, 2, 3, p.trimLight);
    canvas.rect(30 + x, 47 + y, 4, 1, p.trim);
  }
  canvas.rect(18 + x, 52 + y, 28, 2, p.belt);
  canvas.rect(31 + x, 52 + y, 3, 2, p.trimLight);
  // 短手臂
  canvas.rect(11 + x, 44 + y, 8, 11, p.outline);
  canvas.rect(12 + x, 45 + y, 6, 9, p.coat);
  canvas.rect(12 + x, 45 + y, 1, 8, p.trim);
  canvas.rect(13 + x, 51 + y, 3, 3, p.skin);
  canvas.rect(45 + x, 44 + y, 8, 11, p.outline);
  canvas.rect(46 + x, 45 + y, 6, 9, p.coat);
  canvas.rect(50 + x, 45 + y, 1, 8, p.trim);
  canvas.rect(47 + x, 51 + y, 3, 3, p.skin);
}

function drawAmiyaBodySide(canvas, x, y, legPhase) {
  const p = AMIYA_PALETTE;
  const swing = legPhase * 3;
  drawAmiyaBoot(canvas, 25 + x - swing, 57, 9, 4);
  drawAmiyaBoot(canvas, 35 + x + swing, 57, 9, 4);
  canvas.rect(26 + x - swing, 54, 6, 3, p.coatDark);
  canvas.rect(36 + x + swing, 54, 6, 3, p.coatDark);
  canvas.rect(20 + x, 41 + y, 25, 16, p.outline);
  canvas.rect(21 + x, 42 + y, 23, 14, p.coat);
  canvas.rect(21 + x, 42 + y, 4, 14, p.trim);
  canvas.rect(40 + x, 42 + y, 4, 14, p.trim);
  canvas.rect(21 + x, 42 + y, 1, 14, p.coatDark);
  canvas.rect(43 + x, 42 + y, 1, 14, p.coatDark);
  canvas.rect(22 + x, 43 + y, 1, 8, p.trimLight);
  canvas.rect(24 + x, 42 + y, 8, 2, p.coatDark);
  canvas.rect(21 + x, 52 + y, 23, 2, p.belt);
  canvas.rect(24 + x, 52 + y, 2, 2, p.trimLight);
  // 前伸手臂
  canvas.rect(40 + x, 44 + y, 10, 10, p.outline);
  canvas.rect(41 + x, 45 + y, 8, 8, p.coat);
  canvas.rect(41 + x, 45 + y, 1, 7, p.trim);
  canvas.rect(46 + x, 50 + y, 4, 3, p.skin);
}

/** 蓝黑术式球：半透明光晕 + 深色核心 + 高光，保证 64×64 内不触边。 */
function drawAmiyaOrb(canvas, cx, cy, hot) {
  const p = AMIYA_PALETTE;
  canvas.blendEllipse(cx, cy, 6, 6, p.orb, 0.22);
  canvas.ellipse(cx, cy, 4, 4, p.outline);
  canvas.ellipse(cx, cy, 3, 3, p.orbDark);
  canvas.ellipse(cx, cy, 2, 2, p.orb);
  canvas.set(cx - 1, cy - 1, p.orbLight);
  if (hot) {
    canvas.set(cx - 4, cy, p.orbLight);
    canvas.set(cx + 4, cy, p.orbLight);
    canvas.set(cx, cy - 4, p.orbLight);
    canvas.set(cx, cy + 4, p.orbLight);
  }
}

/** 攻击帧的短促术式闪光，保持指向右侧且不触及帧边。 */
function drawAmiyaBoltFlash(canvas, x, y) {
  const p = AMIYA_PALETTE;
  canvas.line(x, y, x + 4, y - 2, 1, p.orbLight);
  canvas.line(x, y, x + 3, y + 2, 1, p.orb);
  canvas.set(x + 5, y - 1, p.orbLight);
}

/** 八向施法球位置：球心与光晕都留在 2–61 像素内。 */
const AMIYA_CAST_POSES = [
  { base: 'up', x: 32, y: 9 },
  { base: 'right', x: 49, y: 16 },
  { base: 'right', x: 55, y: 32 },
  { base: 'right', x: 49, y: 48 },
  { base: 'down', x: 32, y: 55 },
  { base: 'left', x: 15, y: 48 },
  { base: 'left', x: 9, y: 32 },
  { base: 'left', x: 15, y: 16 },
];

function drawAmiyaFrame(direction, action, frameIndex) {
  let frame = new Canvas(CHIBI.frameSize, CHIBI.frameSize);
  const p = AMIYA_PALETTE;
  const mirror = direction === 'left';
  const base = mirror ? 'right' : direction;
  const mood = action === 'hurt' ? 'hurt' : action === 'attack' ? 'attack' : 'idle';
  const idle = action === 'idle';
  const walk = action === 'walk';
  const legPhase = walk ? [-1, 0, 1, 0][frameIndex % 4] : 0;
  const bob = idle ? frameIndex % 2 : walk ? (frameIndex % 2 === 0 ? 0 : 1) : 0;
  const headX = action === 'hurt' ? 2 : 0;
  const headY = (action === 'hurt' ? 1 : 0) + bob;
  const bodyY = action === 'hurt' ? 1 : bob;
  const showFocus = action !== 'cast';
  const earSway = idle ? (frameIndex % 2 ? 1 : 0) : 0;

  if (base === 'right') {
    drawAmiyaBodySide(frame, 0, bodyY, legPhase);
    if (showFocus) {
      const orbX = action === 'attack' ? 54 : 53;
      const orbY = action === 'attack' ? 46 : 48 + bob;
      drawAmiyaOrb(frame, orbX, orbY, action === 'attack');
      if (action === 'attack') drawAmiyaBoltFlash(frame, 54, 46);
    }
    drawAmiyaHeadSide(frame, headX, headY, mood, earSway);
  } else {
    const back = base === 'up';
    drawAmiyaBodyFront(frame, 0, bodyY, legPhase, back);
    if (showFocus) {
      const orbX = action === 'attack' ? 55 : 52;
      const orbY = action === 'attack' ? 44 : 49 + bob;
      drawAmiyaOrb(frame, orbX, orbY, action === 'attack');
      if (action === 'attack') drawAmiyaBoltFlash(frame, 55, 44);
    }
    drawAmiyaHeadFront(frame, headX, headY, mood, back, earSway);
  }

  if (action === 'hurt') {
    // 受击：红色冲击碎片 + 轻微后仰
    frame.rect(9, 20, 1, 3, p.earInner);
    frame.rect(7, 24, 2, 1, p.orbLight);
    frame.rect(53, 18, 1, 2, p.earInner);
    frame.rect(55, 22, 1, 1, p.orbLight);
  }

  if (mirror) {
    const mirrored = new Canvas(CHIBI.frameSize, CHIBI.frameSize);
    mirrored.blit(frame, 0, 0, true);
    frame = mirrored;
  }

  if (action === 'cast') {
    // 施法球坐标按最终屏幕朝向定义，镜像之后再叠加。
    const pose = AMIYA_CAST_POSES[frameIndex];
    drawAmiyaOrb(frame, pose.x, pose.y, true);
    for (const t of [0.18, 0.34, 0.5]) {
      const px = Math.round(pose.x + (32 - pose.x) * t);
      const py = Math.round(pose.y + (38 - pose.y) * t);
      frame.set(px, py, p.orbLight);
    }
  }

  return frame;
}

function drawAmiya() {
  const sheet = new Canvas(
    CHIBI.frameSize * CHIBI.columns,
    CHIBI.frameSize * CHIBI.rows,
  );
  const directionRows = ['down', 'right', 'up', 'left'];
  const frameActions = [
    'idle',
    'idle',
    'walk',
    'walk',
    'walk',
    'walk',
    'attack',
    'hurt',
  ];
  directionRows.forEach((direction, row) => {
    for (let column = 0; column < CHIBI.columns; column += 1) {
      const frame = drawAmiyaFrame(direction, frameActions[column], column);
      sheet.blit(frame, column * CHIBI.frameSize, row * CHIBI.frameSize);
    }
  });
  for (let column = 0; column < CHIBI.columns; column += 1) {
    const pose = AMIYA_CAST_POSES[column];
    const baseFrame = drawAmiyaFrame(pose.base, 'cast', column);
    sheet.blit(baseFrame, column * CHIBI.frameSize, 4 * CHIBI.frameSize);
  }
  sheet.save('public/assets/sprites/player-amiya.png');
}

// ---------- 塞雷娅：浅发、瓦伊凡角与尾、白黑橙护甲、盾牌 ----------

const SARIA_PALETTE = {
  outline: color('#1b1720'),
  hair: color('#e8d9b8'),
  hairLight: color('#f8efd6'),
  hairShade: color('#c9b48c'),
  hairDark: color('#8f7a56'),
  skin: color('#f8dcc2'),
  skinShade: color('#e5b994'),
  skinDeep: color('#c08e6a'),
  eyeWhite: color('#fff8ea'),
  iris: color('#e39a3f'),
  irisLight: color('#ffd58a'),
  irisDark: color('#a35f18'),
  pupil: color('#241a12'),
  blush: color('#e99b8f'),
  horn: color('#e9dfcf'),
  hornLight: color('#fbf6ea'),
  hornShade: color('#b9a98f'),
  armor: color('#e9e4dc'),
  armorLight: color('#fffdf7'),
  armorShade: color('#c3bcb0'),
  armorDark: color('#8d867a'),
  cloth: color('#2b2a2e'),
  clothLight: color('#45444a'),
  trim: color('#e08a2e'),
  trimLight: color('#ffb554'),
  trimDark: color('#a95f17'),
  belt: color('#202024'),
  boot: color('#2a282d'),
  bootLight: color('#4a474f'),
  shield: color('#cfd3d8'),
  shieldLight: color('#f2f4f6'),
  shieldDark: color('#8f979f'),
  shieldRim: color('#e08a2e'),
  tail: color('#e6d7b8'),
  tailShade: color('#c0ad86'),
  tailPlate: color('#e9e4dc'),
};

/** 瓦伊凡角：粗短、向后上方弯，尖端保持浅色高光。 */
function drawSariaHorns(canvas, x, y, mode, sway = 0) {
  const p = SARIA_PALETTE;
  const horn = (mirror) => {
    const points = [
      [22 + x, 15 + y],
      [15 + x + sway, 11 + y],
      [11 + x + sway, 5 + y],
      [13 + x + sway, 3 + y],
      [18 + x, 8 + y],
      [22 + x, 14 + y],
    ];
    return mirror ? points.map(([px, py]) => [64 - px, py]) : points;
  };
  const drawHorn = (mirror, fill, tip) => {
    const shape = horn(mirror);
    canvas.polygonOutline(shape, p.outline, 1);
    canvas.polygon(shape, fill);
    const [tipX, tipY] = mirror ? [64 - (14 + x + sway), 4 + y] : [14 + x + sway, 4 + y];
    canvas.rect(tipX, tipY, 2, 2, tip);
  };

  if (mode === 'side') {
    // 右向：远侧角只露尖端，近侧角完整向后弯。
    const far = [
      [30 + x, 14 + y],
      [24 + x, 10 + y],
      [21 + x, 6 + y],
      [23 + x, 5 + y],
      [27 + x, 9 + y],
    ];
    canvas.polygonOutline(far, p.outline, 1);
    canvas.polygon(far, p.hornShade);
    const near = [
      [36 + x, 14 + y],
      [28 + x, 9 + y],
      [22 + x + sway, 4 + y],
      [24 + x + sway, 2 + y],
      [31 + x, 8 + y],
      [38 + x, 13 + y],
    ];
    canvas.polygonOutline(near, p.outline, 1);
    canvas.polygon(near, p.horn);
    canvas.rect(24 + x + sway, 3 + y, 2, 2, p.hornLight);
    return;
  }

  if (mode === 'back') {
    drawHorn(true, p.hornShade, p.horn);
    drawHorn(false, p.hornShade, p.horn);
    return;
  }
  drawHorn(true, p.horn, p.hornLight);
  drawHorn(false, p.horn, p.hornLight);
}

function drawSariaHairCap(canvas, cx, cy, rx, ry) {
  const p = SARIA_PALETTE;
  canvas.ellipse(cx, cy, rx + 1.5, ry + 1.5, p.outline);
  canvas.ellipse(cx, cy, rx, ry, p.hair);
  canvas.ellipse(cx, cy - ry * 0.3, rx * 0.8, ry * 0.36, p.hairLight);
  canvas.ellipse(cx + rx * 0.52, cy + ry * 0.22, rx * 0.32, ry * 0.5, p.hairShade);
  canvas.ellipse(cx - rx * 0.56, cy + ry * 0.14, rx * 0.26, ry * 0.44, p.hairShade);
}

/** 塞雷娅的短发侧束只到下颌，比武什戴尔/阿米娅更利落。 */
function drawSariaSideStrands(canvas, x, y, mode) {
  const p = SARIA_PALETTE;
  const strand = [
    [14, 21],
    [20, 23],
    [20, 30],
    [17, 36],
    [13, 38],
    [10, 34],
    [10, 26],
  ];
  const right = strand.map(([px, py]) => [64 - px, py]);
  const shapes = mode === 'side' ? [strand] : [strand, right];
  for (const shape of shapes) {
    canvas.polygonOutline(shape.map(([px, py]) => [px + x, py + y]), p.outline, 1);
    canvas.polygon(shape.map(([px, py]) => [px + x, py + y]), p.hair);
  }
  canvas.line(13 + x, 25 + y, 12 + x, 33 + y, 1, p.hairShade);
  if (mode !== 'side') canvas.line(51 + x, 25 + y, 52 + x, 33 + y, 1, p.hairShade);
  if (mode !== 'up') {
    canvas.line(16 + x, 24 + y, 14 + x, 31 + y, 1, p.hairLight);
    if (mode !== 'side') canvas.line(48 + x, 24 + y, 50 + x, 31 + y, 1, p.hairLight);
  }
}

function drawSariaFringe(canvas, x, y, mode) {
  const p = SARIA_PALETTE;
  if (mode === 'back') return;
  const bands =
    mode === 'side'
      ? [
          [29, 36, 21],
          [36, 41, 24],
          [41, 46, 20],
          [46, 50, 23],
        ]
      : [
          [15, 21, 21],
          [21, 26, 24],
          [26, 31, 20],
          [31, 35, 24],
          [35, 39, 21],
          [39, 44, 24],
          [44, 48, 20],
          [48, 51, 22],
        ];
  for (const [x0, x1, bottom] of bands) {
    canvas.rect(x0 + x, 10 + y, x1 - x0, bottom - 10, p.hair);
    canvas.rect(x0 + x, bottom - 1 + y, x1 - x0, 1, p.hairShade);
  }
  canvas.rect(20 + x, 11 + y, 6, 1, p.hairLight);
  canvas.rect(34 + x, 11 + y, 7, 1, p.hairLight);
  canvas.line(30 + x, 10 + y, 28 + x, 18 + y, 1, p.hairShade);
  canvas.line(34 + x, 10 + y, 36 + x, 17 + y, 1, p.hairShade);
  // 橙色发夹：塞雷娅在白黑护甲之外的第二识别点。
  canvas.rect(43 + x, 13 + y, 5, 2, p.trim);
  canvas.rect(44 + x, 13 + y, 3, 1, p.trimLight);
}

/** 琥珀色眼睛与略压低的眉，表达沉稳的防护者气质。 */
function drawSariaEye(canvas, cx, cy, mood, big = false) {
  const p = SARIA_PALETTE;
  if (mood === 'hurt') {
    canvas.line(cx - 4, cy - 4, cx + 3, cy - 1, 1, p.outline);
    canvas.line(cx - 4, cy + 2, cx + 3, cy + 5, 1, p.outline);
    return;
  }
  const wide = mood === 'attack' ? 1 : 0;
  const grow = big ? 1 : 0;
  canvas.ellipse(cx, cy, 5.6 + grow, 5.4 + grow, p.outline);
  canvas.ellipse(cx, cy, 4.2 + grow, 4.4 + grow, p.eyeWhite);
  canvas.ellipse(cx, cy + 1, 3.4 + grow, 3.7 + grow, p.iris);
  canvas.ellipse(cx, cy + 2, 2.8 + grow, 2.4 + grow * 0.5, p.irisLight);
  canvas.rect(cx - 1, cy + 1 - wide, 2, 4 + wide + grow, p.pupil);
  canvas.rect(cx - 3, cy - 1, 1, 2 + grow, p.eyeWhite);
  const lidY = mood === 'attack' ? cy - 5 : cy - 4 - grow;
  canvas.rect(cx - 5 - grow, lidY, 10 + grow * 2, 1, p.hairDark);
  if (mood !== 'attack') canvas.rect(cx - 4 - grow, lidY + 1, 9 + grow * 2, 1, p.skin);
}

function drawSariaBrows(canvas, x, y, mood, side = false) {
  const p = SARIA_PALETTE;
  const steep = mood === 'attack' ? 2 : 1;
  if (side) {
    canvas.line(36 + x, 27 + y, 45 + x, 28 + y - steep, 1, p.hairDark);
    return;
  }
  canvas.line(19 + x, 27 + y, 26 + x, 28 + y - steep, 1, p.hairDark);
  canvas.line(45 + x, 27 + y, 38 + x, 28 + y - steep, 1, p.hairDark);
}

function drawSariaMouth(canvas, cx, cy, mood) {
  const p = SARIA_PALETTE;
  if (mood === 'attack') {
    canvas.ellipse(cx, cy, 2, 2.2, p.outline);
    canvas.rect(cx - 1, cy + 1, 2, 1, p.skinDeep);
    return;
  }
  if (mood === 'hurt') {
    canvas.set(cx - 1, cy, p.outline);
    canvas.set(cx, cy + 1, p.outline);
    canvas.set(cx + 1, cy, p.outline);
    return;
  }
  // 平静的短嘴：比阿米娅略平。
  canvas.rect(cx - 2, cy + 1, 4, 1, p.outline);
}

function drawSariaBlush(canvas, cy) {
  const { blush } = SARIA_PALETTE;
  for (const [x0, rows] of [
    [17, [0, 1, 1]],
    [43, [1, 0, 0]],
  ]) {
    rows.forEach((offset, index) => {
      canvas.rect(x0 + index, cy + offset, 1, 1, blush);
    });
  }
}

function drawSariaHeadFront(canvas, x, y, mood, back, sway = 0) {
  const p = SARIA_PALETTE;
  drawSariaHorns(canvas, x, y, back ? 'back' : 'front', sway);
  drawSariaHairCap(canvas, 32 + x, 25 + y, 19, 16);
  drawSariaSideStrands(canvas, x, y, back ? 'up' : 'down');
  if (back) {
    canvas.rect(28 + x, 13 + y, 9, 1, p.hairLight);
    canvas.line(31 + x, 14 + y, 33 + x, 24 + y, 1, p.hairShade);
    canvas.ellipse(32 + x, 36 + y, 8, 6, p.hairShade);
    canvas.rect(27 + x, 37 + y, 10, 2, p.trim);
    return;
  }
  canvas.ellipse(32 + x, 30 + y, 15, 13, p.outline);
  canvas.ellipse(32 + x, 30 + y, 14, 12, p.skin);
  canvas.ellipse(32 + x, 39 + y, 10, 3, p.skinShade);
  drawSariaFringe(canvas, x, y, 'front');
  drawSariaBrows(canvas, x, y, mood);
  drawSariaEye(canvas, 24 + x, 32 + y, mood);
  drawSariaEye(canvas, 40 + x, 32 + y, mood);
  drawSariaMouth(canvas, 32 + x, 40 + y, mood);
  drawSariaBlush(canvas, 38 + y);
}

function drawSariaHeadSide(canvas, x, y, mood, sway = 0) {
  const p = SARIA_PALETTE;
  drawSariaHorns(canvas, x, y, 'side', sway);
  drawSariaHairCap(canvas, 30 + x, 25 + y, 19, 16);
  drawSariaSideStrands(canvas, x, y, 'side');
  canvas.ellipse(41 + x, 30 + y, 11.5, 12.5, p.outline);
  canvas.ellipse(41 + x, 30 + y, 10.5, 11.5, p.skin);
  canvas.ellipse(44 + x, 39 + y, 7, 3, p.skinShade);
  drawSariaFringe(canvas, x, y, 'side');
  drawSariaBrows(canvas, x, y, mood, true);
  drawSariaEye(canvas, 42 + x, 32 + y, mood, true);
  canvas.set(50 + x, 35 + y, p.skinDeep);
  drawSariaMouth(canvas, 47 + x, 40 + y, mood);
  // 侧面单侧发夹。
  canvas.rect(35 + x, 13 + y, 4, 2, p.trim);
}

/** 瓦伊凡尾巴：侧面甩在身后，正面从腿侧露出，背面收在身体后。 */
function drawSariaTail(canvas, mode, bob) {
  const p = SARIA_PALETTE;
  const y = bob;
  if (mode === 'right') {
    const shape = [
      [21 + 0, 49 + y],
      [14, 51 + y],
      [8, 55 + y],
      [5, 59 + y],
      [9, 60 + y],
      [14, 56 + y],
      [23, 53 + y],
    ];
    canvas.polygonOutline(shape, p.outline, 1);
    canvas.polygon(shape, p.tail);
    canvas.rect(8, 58 + y, 3, 2, p.tailPlate);
    canvas.rect(5, 59 + y, 2, 1, p.hairDark);
    return;
  }
  if (mode === 'up') {
    const shape = [
      [31, 52 + y],
      [27, 55 + y],
      [28, 59 + y],
      [32, 60 + y],
      [36, 58 + y],
      [35, 54 + y],
    ];
    canvas.polygonOutline(shape, p.outline, 1);
    canvas.polygon(shape, p.tailShade);
    canvas.rect(30, 57 + y, 4, 2, p.tailPlate);
    return;
  }
  const shape = [
    [45, 50 + y],
    [52, 52 + y],
    [58, 56 + y],
    [57, 60 + y],
    [52, 58 + y],
    [47, 55 + y],
    [44, 54 + y],
  ];
  canvas.polygonOutline(shape, p.outline, 1);
  canvas.polygon(shape, p.tail);
  canvas.rect(55, 56 + y, 3, 3, p.tailPlate);
  canvas.rect(58, 58 + y, 1, 2, p.hairDark);
}

function drawSariaBoot(canvas, x, y, width, height) {
  const p = SARIA_PALETTE;
  canvas.rect(x - 1, y - 1, width + 2, height + 2, p.outline);
  canvas.rect(x, y, width, height, p.boot);
  canvas.rect(x, y, width, 1, p.bootLight);
  canvas.rect(x, y + height - 1, width, 1, p.trimDark);
}

function drawSariaBodyFront(canvas, x, y, legPhase, back) {
  const p = SARIA_PALETTE;
  const swing = legPhase * 2;
  drawSariaBoot(canvas, 23 + x + swing, 57, 8, 4);
  drawSariaBoot(canvas, 33 + x - swing, 57, 8, 4);
  canvas.rect(24 + x + swing, 54, 6, 3, p.cloth);
  canvas.rect(34 + x - swing, 54, 6, 3, p.cloth);

  // 白黑橙胸甲：黑色内衬 + 白色板甲 + 橙色中缝。
  canvas.rect(17 + x, 41 + y, 30, 16, p.outline);
  canvas.rect(18 + x, 42 + y, 28, 14, p.cloth);
  canvas.rect(19 + x, 42 + y, 26, 12, p.armor);
  canvas.rect(19 + x, 42 + y, 26, 2, p.armorLight);
  canvas.rect(19 + x, 51 + y, 26, 3, p.armorShade);
  canvas.rect(31 + x, 43 + y, 2, 10, p.trim);
  canvas.rect(31 + x, 43 + y, 1, 10, p.trimLight);
  // 肩甲
  canvas.rect(12 + x, 42 + y, 8, 8, p.outline);
  canvas.rect(13 + x, 43 + y, 6, 6, p.armorLight);
  canvas.rect(13 + x, 48 + y, 6, 1, p.trim);
  canvas.rect(44 + x, 42 + y, 8, 8, p.outline);
  canvas.rect(45 + x, 43 + y, 6, 6, p.armorLight);
  canvas.rect(45 + x, 48 + y, 6, 1, p.trim);
  if (back) {
    canvas.rect(21 + x, 44 + y, 22, 6, p.armorShade);
    canvas.rect(27 + x, 44 + y, 10, 2, p.trim);
    canvas.rect(31 + x, 46 + y, 2, 4, p.trimDark);
  } else {
    canvas.rect(23 + x, 45 + y, 8, 5, p.armorLight);
    canvas.rect(34 + x, 45 + y, 7, 5, p.armorLight);
    canvas.rect(24 + x, 46 + y, 6, 1, p.armorShade);
  }
  canvas.rect(18 + x, 52 + y, 28, 2, p.belt);
  canvas.rect(30 + x, 52 + y, 4, 2, p.trim);
  // 手臂：短而厚，护腕为橙色。
  canvas.rect(11 + x, 46 + y, 7, 10, p.outline);
  canvas.rect(12 + x, 47 + y, 5, 8, p.cloth);
  canvas.rect(12 + x, 53 + y, 5, 2, p.trim);
  canvas.rect(46 + x, 46 + y, 7, 10, p.outline);
  canvas.rect(47 + x, 47 + y, 5, 8, p.cloth);
  canvas.rect(47 + x, 53 + y, 5, 2, p.trim);
}

function drawSariaBodySide(canvas, x, y, legPhase) {
  const p = SARIA_PALETTE;
  const swing = legPhase * 3;
  drawSariaBoot(canvas, 25 + x - swing, 57, 9, 4);
  drawSariaBoot(canvas, 35 + x + swing, 57, 9, 4);
  canvas.rect(26 + x - swing, 54, 6, 3, p.cloth);
  canvas.rect(36 + x + swing, 54, 6, 3, p.cloth);

  canvas.rect(19 + x, 41 + y, 26, 16, p.outline);
  canvas.rect(20 + x, 42 + y, 24, 14, p.cloth);
  canvas.rect(21 + x, 42 + y, 22, 12, p.armor);
  canvas.rect(21 + x, 42 + y, 22, 2, p.armorLight);
  canvas.rect(21 + x, 51 + y, 22, 3, p.armorShade);
  canvas.rect(30 + x, 43 + y, 2, 10, p.trim);
  canvas.rect(30 + x, 43 + y, 1, 10, p.trimLight);
  canvas.rect(19 + x, 42 + y, 7, 8, p.armorLight);
  canvas.rect(24 + x, 42 + y, 1, 8, p.armorShade);
  canvas.rect(19 + x, 48 + y, 7, 1, p.trim);
  canvas.rect(21 + x, 52 + y, 24, 2, p.belt);
  canvas.rect(23 + x, 52 + y, 3, 2, p.trim);
  // 前臂：盾牌前的短手臂。
  canvas.rect(40 + x, 45 + y, 9, 9, p.outline);
  canvas.rect(41 + x, 46 + y, 7, 7, p.cloth);
  canvas.rect(41 + x, 50 + y, 7, 2, p.trim);
}

/** 盾牌：橙色包边 + 金属面 + 白色人字纹；中心始终留在帧内。 */
function drawSariaShield(canvas, cx, cy, scale = 1, hot = false) {
  const p = SARIA_PALETTE;
  const hw = 8 * scale;
  const hh = 9 * scale;
  const outer = [
    [cx - hw, cy - hh],
    [cx + hw, cy - hh],
    [cx + hw + 1, cy - 1 * scale],
    [cx, cy + hh + 1],
    [cx - hw - 1, cy - 1 * scale],
  ];
  if (hot) {
    // 先铺光晕，再画盾面，形成一圈橙色高光边。
    canvas.ellipse(cx, cy, hw + 1, hh + 1, p.trimLight);
    canvas.polygonOutline(outer, p.trimLight, 1);
  }
  canvas.polygonOutline(outer, p.outline, 1);
  canvas.polygon(outer, p.shieldRim);
  const inner = [
    [cx - hw + 2, cy - hh + 2],
    [cx + hw - 2, cy - hh + 2],
    [cx + hw - 1, cy - 1 * scale],
    [cx, cy + hh - 1],
    [cx - hw + 1, cy - 1 * scale],
  ];
  canvas.polygon(inner, p.shield);
  canvas.polygon(
    [
      [cx - hw + 2, cy - hh + 2],
      [cx + hw - 2, cy - hh + 2],
      [cx + hw - 3, cy - hh + 4],
      [cx - hw + 3, cy - hh + 4],
    ],
    p.shieldLight,
  );
  canvas.line(cx - hw + 3, cy - 2 * scale, cx, cy + 2 * scale, 1, p.shieldLight);
  canvas.line(cx, cy + 2 * scale, cx + hw - 3, cy - 2 * scale, 1, p.shieldLight);
  canvas.rect(cx - 1, cy - hh + 3, 2, 4 * scale, p.shieldDark);
  if (hot) {
    canvas.rect(cx - hw - 2, cy - hh + 1, 2, 2, p.trimLight);
    canvas.rect(cx + hw - 1, cy + hh - 2, 2, 2, p.trimLight);
  }
}

/** 八向施法：把盾牌举向对应方向，缩小的盾面避免触边。 */
const SARIA_CAST_POSES = [
  { base: 'up', x: 32, y: 14 },
  { base: 'right', x: 48, y: 17 },
  { base: 'right', x: 53, y: 32 },
  { base: 'right', x: 48, y: 47 },
  { base: 'down', x: 32, y: 50 },
  { base: 'left', x: 16, y: 47 },
  { base: 'left', x: 11, y: 32 },
  { base: 'left', x: 16, y: 17 },
];

function drawSariaFrame(direction, action, frameIndex) {
  let frame = new Canvas(CHIBI.frameSize, CHIBI.frameSize);
  const p = SARIA_PALETTE;
  const mirror = direction === 'left';
  const base = mirror ? 'right' : direction;
  const mood = action === 'hurt' ? 'hurt' : action === 'attack' ? 'attack' : 'idle';
  const idle = action === 'idle';
  const walk = action === 'walk';
  const legPhase = walk ? [-1, 0, 1, 0][frameIndex % 4] : 0;
  const bob = idle ? frameIndex % 2 : walk ? (frameIndex % 2 === 0 ? 0 : 1) : 0;
  const headX = action === 'hurt' ? 2 : 0;
  const headY = (action === 'hurt' ? 1 : 0) + bob;
  const bodyY = action === 'hurt' ? 1 : bob;
  const showShield = action !== 'cast';
  const sway = idle ? (frameIndex % 2 ? 1 : 0) : 0;

  drawSariaTail(frame, base, bob);

  if (base === 'right') {
    drawSariaBodySide(frame, 0, bodyY, legPhase);
    if (showShield) {
      const shieldX = action === 'attack' ? 53 : 51;
      const shieldY = action === 'attack' ? 46 : 48 + bob;
      drawSariaShield(frame, shieldX, shieldY, 1, action === 'attack');
      if (action === 'attack') {
        frame.rect(shieldX + 3, shieldY - 12, 2, 3, p.trimLight);
        frame.rect(shieldX + 8, shieldY - 7, 2, 2, p.armorLight);
      }
    }
    drawSariaHeadSide(frame, headX, headY, mood, sway);
  } else {
    const back = base === 'up';
    drawSariaBodyFront(frame, 0, bodyY, legPhase, back);
    if (showShield) {
      const shieldX = action === 'attack' ? 52 : 51;
      const shieldY = action === 'attack' ? 44 : 49 + bob;
      drawSariaShield(frame, shieldX, shieldY, 1, action === 'attack');
      if (action === 'attack') {
        frame.rect(shieldX, shieldY - 13, 2, 3, p.trimLight);
        frame.rect(shieldX + 6, shieldY - 9, 2, 2, p.armorLight);
      }
    }
    drawSariaHeadFront(frame, headX, headY, mood, back, sway);
  }

  if (action === 'hurt') {
    frame.rect(9, 20, 1, 3, p.trim);
    frame.rect(7, 24, 2, 1, p.armorLight);
    frame.rect(53, 18, 1, 2, p.trim);
    frame.rect(55, 22, 1, 1, p.armorLight);
  }

  if (mirror) {
    const mirrored = new Canvas(CHIBI.frameSize, CHIBI.frameSize);
    mirrored.blit(frame, 0, 0, true);
    frame = mirrored;
  }

  if (action === 'cast') {
    // 施法盾面坐标按最终屏幕朝向定义，镜像之后再叠加。
    const pose = SARIA_CAST_POSES[frameIndex];
    drawSariaShield(frame, pose.x, pose.y, 0.7, true);
    for (const t of [0.2, 0.4, 0.6]) {
      const px = Math.round(pose.x + (32 - pose.x) * t);
      const py = Math.round(pose.y + (38 - pose.y) * t);
      frame.set(px, py, p.trimLight);
    }
  }

  return frame;
}

function drawSaria() {
  const sheet = new Canvas(
    CHIBI.frameSize * CHIBI.columns,
    CHIBI.frameSize * CHIBI.rows,
  );
  const directionRows = ['down', 'right', 'up', 'left'];
  const frameActions = [
    'idle',
    'idle',
    'walk',
    'walk',
    'walk',
    'walk',
    'attack',
    'hurt',
  ];
  directionRows.forEach((direction, row) => {
    for (let column = 0; column < CHIBI.columns; column += 1) {
      const frame = drawSariaFrame(direction, frameActions[column], column);
      sheet.blit(frame, column * CHIBI.frameSize, row * CHIBI.frameSize);
    }
  });
  for (let column = 0; column < CHIBI.columns; column += 1) {
    const pose = SARIA_CAST_POSES[column];
    const baseFrame = drawSariaFrame(pose.base, 'cast', column);
    sheet.blit(baseFrame, column * CHIBI.frameSize, 4 * CHIBI.frameSize);
  }
  sheet.save('public/assets/sprites/player-saria.png');
}

const MUELSYSE_PALETTE = {
  outline: color('#16211f'),
  hair: color('#dcefe6'),
  hairLight: color('#f4fffa'),
  hairShade: color('#a9c9bd'),
  hairDark: color('#6f978a'),
  skin: color('#f8dcc2'),
  skinShade: color('#e5b994'),
  skinDeep: color('#c08e6a'),
  earInner: color('#e7a99c'),
  eyeWhite: color('#f8fffb'),
  iris: color('#4cc7ac'),
  irisLight: color('#a6f5df'),
  irisDark: color('#237a68'),
  pupil: color('#122420'),
  blush: color('#e99b8f'),
  cloth: color('#20292a'),
  clothLight: color('#394748'),
  white: color('#f2f7f2'),
  whiteShade: color('#cfdcd4'),
  green: color('#63cf9d'),
  greenLight: color('#a9f0c8'),
  greenDark: color('#358866'),
  water: color('#5fd8d0'),
  waterLight: color('#b9fff7'),
  waterDark: color('#2f9a95'),
  boot: color('#1d2526'),
  bootLight: color('#3c4a4c'),
  belt: color('#161d1e'),
};

/** 缪尔赛思的尖耳：从发际两侧向上外挑，正面双侧、侧面单侧、背面只露耳尖。 */
function drawMuelsyseEars(canvas, x, y, mode, sway = 0) {
  const p = MUELSYSE_PALETTE;
  const left = [
    [21 + x, 24 + y],
    [14 + x + sway, 18 + y],
    [9 + x + sway, 11 + y],
    [12 + x + sway, 9 + y],
    [19 + x, 17 + y],
    [23 + x, 22 + y],
  ];
  const drawEar = (shape, fill, inner) => {
    canvas.polygonOutline(shape, p.outline, 1);
    canvas.polygon(shape, fill);
    if (inner) {
      canvas.polygon(
        [
          shape[1],
          shape[2],
          [shape[2][0] + 2, shape[2][1] + 2],
          [shape[1][0] + 2, shape[1][1] + 2],
        ],
        p.earInner,
      );
    }
  };
  const mirrorShape = (shape) => shape.map(([px, py]) => [64 - px, py]);

  if (mode === 'side') {
    const near = [
      [34 + x, 24 + y],
      [27 + x + sway, 18 + y],
      [24 + x + sway, 11 + y],
      [27 + x + sway, 9 + y],
      [32 + x, 17 + y],
      [37 + x, 22 + y],
    ];
    drawEar(near, p.skin, true);
    return;
  }
  drawEar(left, mode === 'back' ? p.skinShade : p.skin, mode !== 'back');
  drawEar(mirrorShape(left), mode === 'back' ? p.skinShade : p.skin, mode !== 'back');
}

function drawMuelsyseHairCap(canvas, cx, cy, rx, ry) {
  const p = MUELSYSE_PALETTE;
  canvas.ellipse(cx, cy, rx + 1.5, ry + 1.5, p.outline);
  canvas.ellipse(cx, cy, rx, ry, p.hair);
  canvas.ellipse(cx, cy - ry * 0.3, rx * 0.8, ry * 0.36, p.hairLight);
  canvas.ellipse(cx + rx * 0.52, cy + ry * 0.22, rx * 0.32, ry * 0.5, p.hairShade);
  canvas.ellipse(cx - rx * 0.56, cy + ry * 0.14, rx * 0.26, ry * 0.44, p.hairShade);
}

/** 浅色长发：垂到腰侧的长发束，是缪尔赛思区别于塞雷娅短发的主要轮廓。 */
function drawMuelsyseLongLocks(canvas, x, y, mode) {
  const p = MUELSYSE_PALETTE;
  const left = [
    [16, 21],
    [22, 25],
    [21, 34],
    [19, 43],
    [17, 49],
    [14, 45],
    [12, 36],
    [12, 26],
  ];
  const right = left.map(([px, py]) => [64 - px, py]);
  const shapes = mode === 'side' ? [left] : [left, right];
  for (const shape of shapes) {
    canvas.polygonOutline(shape.map(([px, py]) => [px + x, py + y]), p.outline, 1);
    canvas.polygon(shape.map(([px, py]) => [px + x, py + y]), p.hair);
  }
  canvas.line(15 + x, 27 + y, 16 + x, 41 + y, 1, p.hairShade);
  canvas.line(17 + x, 26 + y, 18 + x, 38 + y, 1, p.hairLight);
  if (mode !== 'side') {
    canvas.line(49 + x, 27 + y, 48 + x, 41 + y, 1, p.hairShade);
    canvas.line(47 + x, 26 + y, 46 + x, 38 + y, 1, p.hairLight);
  }
  if (mode === 'up') {
    canvas.ellipse(32 + x, 37 + y, 14, 12, p.hairShade);
    canvas.ellipse(32 + x, 35 + y, 11, 9, p.hair);
    canvas.rect(26 + x, 37 + y, 12, 2, p.green);
    canvas.rect(30 + x, 37 + y, 4, 3, p.greenLight);
  }
}

function drawMuelsyseFringe(canvas, x, y, mode) {
  const p = MUELSYSE_PALETTE;
  if (mode === 'back') return;
  const bands =
    mode === 'side'
      ? [
          [28, 36, 21],
          [35, 41, 24],
          [40, 45, 20],
          [45, 49, 23],
        ]
      : [
          [15, 21, 21],
          [21, 26, 24],
          [26, 31, 20],
          [31, 35, 24],
          [35, 39, 21],
          [39, 44, 24],
          [44, 49, 21],
        ];
  for (const [x0, x1, bottom] of bands) {
    canvas.rect(x0 + x, 10 + y, x1 - x0, bottom - 10, p.hair);
    canvas.rect(x0 + x, bottom - 1 + y, x1 - x0, 1, p.hairShade);
  }
  canvas.rect(19 + x, 11 + y, 6, 1, p.hairLight);
  canvas.rect(35 + x, 11 + y, 6, 1, p.hairLight);
  canvas.line(30 + x, 10 + y, 27 + x, 18 + y, 1, p.hairShade);
  canvas.line(35 + x, 10 + y, 38 + x, 17 + y, 1, p.hairShade);
  // 水滴发夹：黑白绿之外的第二识别点。
  canvas.rect(42 + x, 13 + y, 4, 2, p.green);
  canvas.rect(43 + x, 12 + y, 2, 1, p.waterLight);
}

/** 青绿色大眼睛，轻快表情；攻击时睁大、受击时挤眼。 */
function drawMuelsyseEye(canvas, cx, cy, mood, big = false) {
  const p = MUELSYSE_PALETTE;
  if (mood === 'hurt') {
    canvas.line(cx - 4, cy - 4, cx + 3, cy - 1, 1, p.outline);
    canvas.line(cx - 4, cy + 2, cx + 3, cy + 5, 1, p.outline);
    return;
  }
  const wide = mood === 'attack' ? 1 : 0;
  const grow = big ? 1 : 0;
  canvas.ellipse(cx, cy, 5.6 + grow, 5.6 + grow, p.outline);
  canvas.ellipse(cx, cy, 4.2 + grow, 4.5 + grow, p.eyeWhite);
  canvas.ellipse(cx, cy + 1, 3.5 + grow, 3.8 + grow, p.iris);
  canvas.ellipse(cx, cy + 2, 2.9 + grow, 2.5 + grow * 0.5, p.irisLight);
  canvas.rect(cx - 1, cy + 1 - wide, 2, 4 + wide + grow, p.pupil);
  canvas.rect(cx - 3, cy - 1, 1, 2 + grow, p.eyeWhite);
  const lidY = mood === 'attack' ? cy - 6 : cy - 4 - grow;
  canvas.rect(cx - 5 - grow, lidY, 10 + grow * 2, 1, p.hairDark);
  if (mood !== 'attack') canvas.rect(cx - 4 - grow, lidY + 1, 9 + grow * 2, 1, p.skin);
}

function drawMuelsyseBrows(canvas, x, y, mood, side = false) {
  const p = MUELSYSE_PALETTE;
  const lift = mood === 'attack' ? 1 : 0;
  if (side) {
    canvas.line(36 + x, 27 + y - lift, 45 + x, 26 + y, 1, p.hairDark);
    return;
  }
  canvas.line(19 + x, 28 + y - lift, 26 + x, 27 + y, 1, p.hairDark);
  canvas.line(45 + x, 28 + y - lift, 38 + x, 27 + y, 1, p.hairDark);
}

function drawMuelsyseMouth(canvas, cx, cy, mood) {
  const p = MUELSYSE_PALETTE;
  if (mood === 'attack') {
    canvas.ellipse(cx, cy, 2.2, 2.4, p.outline);
    canvas.rect(cx - 1, cy + 1, 2, 1, p.skinDeep);
    return;
  }
  if (mood === 'hurt') {
    canvas.set(cx - 1, cy, p.outline);
    canvas.set(cx, cy + 1, p.outline);
    canvas.set(cx + 1, cy, p.outline);
    return;
  }
  // 轻快的浅笑：两端各上挑 1 像素。
  canvas.rect(cx - 2, cy + 1, 4, 1, p.outline);
  canvas.set(cx - 3, cy, p.outline);
  canvas.set(cx + 2, cy, p.outline);
}

function drawMuelsyseBlush(canvas, cy) {
  const { blush } = MUELSYSE_PALETTE;
  for (const [x0, rows] of [
    [17, [0, 1, 1]],
    [44, [1, 0, 0]],
  ]) {
    rows.forEach((offset, index) => {
      canvas.rect(x0 + index, cy + offset, 1, 1, blush);
    });
  }
}

/** 漂浮的小水滴：贴在发侧/手边，提供水体识别点。 */
function drawMuelsyseDrop(canvas, cx, cy, scale = 1, hot = false) {
  const p = MUELSYSE_PALETTE;
  const r = 3 * scale;
  if (hot) {
    for (const [dx, dy] of [
      [0, -r - 2],
      [-r - 1, r],
      [r + 1, r],
    ]) {
      canvas.rect(cx + dx, cy + dy, 1, 1, p.waterLight);
    }
  }
  canvas.ellipse(cx, cy, r + 1, r + 1, p.outline);
  canvas.ellipse(cx, cy, r, r, p.water);
  canvas.ellipse(cx - r * 0.4, cy - r * 0.4, r * 0.45, r * 0.42, p.waterLight);
  canvas.rect(cx + r * 0.4, cy + r * 0.3, 1, 2, p.waterDark);
  canvas.polygonOutline(
    [
      [cx, cy - r - 3],
      [cx + 2, cy - r],
      [cx - 2, cy - r],
    ],
    p.outline,
    1,
  );
  canvas.polygon(
    [
      [cx, cy - r - 2],
      [cx + 1, cy - r],
      [cx - 1, cy - r],
    ],
    p.waterLight,
  );
}

function drawMuelsyseHeadFront(canvas, x, y, mood, back, sway = 0) {
  const p = MUELSYSE_PALETTE;
  drawMuelsyseEars(canvas, x, y, back ? 'back' : 'front', sway);
  drawMuelsyseLongLocks(canvas, x, y, back ? 'up' : 'down');
  drawMuelsyseHairCap(canvas, 32 + x, 24 + y, 19, 16);
  if (back) {
    canvas.rect(27 + x, 12 + y, 10, 1, p.hairLight);
    canvas.line(31 + x, 13 + y, 33 + x, 23 + y, 1, p.hairShade);
    return;
  }
  canvas.ellipse(32 + x, 30 + y, 15, 13, p.outline);
  canvas.ellipse(32 + x, 30 + y, 14, 12, p.skin);
  canvas.ellipse(32 + x, 39 + y, 10, 3, p.skinShade);
  drawMuelsyseFringe(canvas, x, y, 'front');
  drawMuelsyseBrows(canvas, x, y, mood);
  drawMuelsyseEye(canvas, 24 + x, 32 + y, mood);
  drawMuelsyseEye(canvas, 40 + x, 32 + y, mood);
  drawMuelsyseMouth(canvas, 32 + x, 40 + y, mood);
  drawMuelsyseBlush(canvas, 38 + y);
  drawMuelsyseDrop(canvas, 53 + x, 22 + y, 1, mood === 'attack');
}

function drawMuelsyseHeadSide(canvas, x, y, mood, sway = 0) {
  const p = MUELSYSE_PALETTE;
  drawMuelsyseEars(canvas, x, y, 'side', sway);
  drawMuelsyseHairCap(canvas, 30 + x, 24 + y, 19, 16);
  canvas.ellipse(41 + x, 30 + y, 12, 13, p.outline);
  canvas.ellipse(41 + x, 30 + y, 11, 12, p.skin);
  canvas.ellipse(44 + x, 39 + y, 7, 3, p.skinShade);
  drawMuelsyseFringe(canvas, x, y, 'side');
  drawMuelsyseBrows(canvas, x, y, mood, true);
  drawMuelsyseEye(canvas, 42 + x, 32 + y, mood, true);
  canvas.set(50 + x, 35 + y, p.skinDeep);
  drawMuelsyseMouth(canvas, 47 + x, 40 + y, mood);
  canvas.rect(35 + x, 13 + y, 4, 2, p.green);
  drawMuelsyseDrop(canvas, 54 + x, 44 + y, 1, mood === 'attack');
}

function drawMuelsyseBoot(canvas, x, y, width, height) {
  const p = MUELSYSE_PALETTE;
  canvas.rect(x - 1, y - 1, width + 2, height + 2, p.outline);
  canvas.rect(x, y, width, height, p.boot);
  canvas.rect(x, y, width, 1, p.bootLight);
  canvas.rect(x, y + height - 1, width, 1, p.greenDark);
}

function drawMuelsyseBodyFront(canvas, x, y, legPhase, back) {
  const p = MUELSYSE_PALETTE;
  const swing = legPhase * 2;
  drawMuelsyseBoot(canvas, 23 + x + swing, 57, 8, 4);
  drawMuelsyseBoot(canvas, 33 + x - swing, 57, 8, 4);
  canvas.rect(24 + x + swing, 53, 6, 4, p.cloth);
  canvas.rect(34 + x - swing, 53, 6, 4, p.cloth);

  // 黑白绿服装：白色衬衣 + 黑色短马甲 + 绿色中缝与腰带。
  canvas.rect(17 + x, 41 + y, 30, 16, p.outline);
  canvas.rect(18 + x, 42 + y, 28, 14, p.white);
  canvas.rect(18 + x, 42 + y, 8, 14, p.cloth);
  canvas.rect(38 + x, 42 + y, 8, 14, p.cloth);
  canvas.rect(18 + x, 42 + y, 8, 2, p.clothLight);
  canvas.rect(38 + x, 42 + y, 8, 2, p.clothLight);
  canvas.rect(19 + x, 43 + y, 6, 4, p.whiteShade);
  canvas.rect(39 + x, 43 + y, 6, 4, p.whiteShade);
  canvas.rect(31 + x, 42 + y, 2, 11, p.green);
  canvas.rect(31 + x, 42 + y, 1, 11, p.greenLight);
  canvas.rect(19 + x, 51 + y, 26, 2, p.greenDark);
  // 肩与短袖。
  canvas.rect(12 + x, 42 + y, 8, 8, p.outline);
  canvas.rect(13 + x, 43 + y, 6, 6, p.white);
  canvas.rect(13 + x, 47 + y, 6, 2, p.green);
  canvas.rect(44 + x, 42 + y, 8, 8, p.outline);
  canvas.rect(45 + x, 43 + y, 6, 6, p.white);
  canvas.rect(45 + x, 47 + y, 6, 2, p.green);
  if (back) {
    canvas.rect(26 + x, 43 + y, 12, 9, p.whiteShade);
    canvas.rect(30 + x, 43 + y, 4, 3, p.green);
    canvas.rect(18 + x, 51 + y, 28, 2, p.belt);
    return;
  }
  canvas.rect(23 + x, 45 + y, 6, 3, p.whiteShade);
  canvas.rect(35 + x, 45 + y, 6, 3, p.whiteShade);
  canvas.rect(18 + x, 52 + y, 28, 2, p.belt);
  canvas.rect(30 + x, 52 + y, 4, 2, p.green);
  // 短手臂与绿色袖口。
  canvas.rect(11 + x, 46 + y, 7, 10, p.outline);
  canvas.rect(12 + x, 47 + y, 5, 8, p.white);
  canvas.rect(12 + x, 53 + y, 5, 2, p.green);
  canvas.rect(46 + x, 46 + y, 7, 10, p.outline);
  canvas.rect(47 + x, 47 + y, 5, 8, p.white);
  canvas.rect(47 + x, 53 + y, 5, 2, p.green);
}

function drawMuelsyseBodySide(canvas, x, y, legPhase) {
  const p = MUELSYSE_PALETTE;
  const swing = legPhase * 3;
  drawMuelsyseBoot(canvas, 25 + x - swing, 57, 9, 4);
  drawMuelsyseBoot(canvas, 35 + x + swing, 57, 9, 4);
  canvas.rect(26 + x - swing, 53, 6, 4, p.cloth);
  canvas.rect(36 + x + swing, 53, 6, 4, p.cloth);

  canvas.rect(19 + x, 41 + y, 26, 16, p.outline);
  canvas.rect(20 + x, 42 + y, 24, 14, p.white);
  canvas.rect(20 + x, 42 + y, 7, 14, p.cloth);
  canvas.rect(20 + x, 42 + y, 7, 2, p.clothLight);
  canvas.rect(30 + x, 42 + y, 2, 11, p.green);
  canvas.rect(30 + x, 42 + y, 1, 11, p.greenLight);
  canvas.rect(21 + x, 51 + y, 23, 2, p.greenDark);
  canvas.rect(19 + x, 42 + y, 8, 7, p.whiteShade);
  canvas.rect(19 + x, 47 + y, 8, 2, p.green);
  canvas.rect(21 + x, 52 + y, 22, 2, p.belt);
  canvas.rect(23 + x, 52 + y, 3, 2, p.green);
  // 前臂：水形术式的手。
  canvas.rect(40 + x, 45 + y, 9, 9, p.outline);
  canvas.rect(41 + x, 46 + y, 7, 7, p.white);
  canvas.rect(41 + x, 50 + y, 7, 2, p.green);
  canvas.rect(46 + x, 52 + y, 3, 3, p.skin);
}

/** 八向施法：水球举向对应方向；缩小的球体避免触边。 */
const MUELSYSE_CAST_POSES = [
  { base: 'up', x: 32, y: 12 },
  { base: 'right', x: 48, y: 16 },
  { base: 'right', x: 53, y: 32 },
  { base: 'right', x: 48, y: 48 },
  { base: 'down', x: 32, y: 52 },
  { base: 'left', x: 16, y: 48 },
  { base: 'left', x: 11, y: 32 },
  { base: 'left', x: 16, y: 16 },
];

function drawMuelsyseFrame(direction, action, frameIndex) {
  let frame = new Canvas(CHIBI.frameSize, CHIBI.frameSize);
  const p = MUELSYSE_PALETTE;
  const mirror = direction === 'left';
  const base = mirror ? 'right' : direction;
  const mood = action === 'hurt' ? 'hurt' : action === 'attack' ? 'attack' : 'idle';
  const idle = action === 'idle';
  const walk = action === 'walk';
  const legPhase = walk ? [-1, 0, 1, 0][frameIndex % 4] : 0;
  const bob = idle ? frameIndex % 2 : walk ? (frameIndex % 2 === 0 ? 0 : 1) : 0;
  const headX = action === 'hurt' ? 2 : 0;
  const headY = (action === 'hurt' ? 1 : 0) + bob;
  const bodyY = action === 'hurt' ? 1 : bob;
  const sway = idle ? (frameIndex % 2 ? 1 : 0) : 0;
  const showDrop = action !== 'cast';

  if (base === 'right') {
    drawMuelsyseLongLocks(frame, -6, bob, 'side');
    drawMuelsyseBodySide(frame, 0, bodyY, legPhase);
    drawMuelsyseHeadSide(frame, headX, headY, mood, sway);
    if (showDrop) drawMuelsyseDrop(frame, 53, 26 + bob, 1, action === 'attack');
  } else {
    const back = base === 'up';
    drawMuelsyseBodyFront(frame, 0, bodyY, legPhase, back);
    drawMuelsyseHeadFront(frame, headX, headY, mood, back, sway);
    if (showDrop && !back) drawMuelsyseDrop(frame, 53, 47 + bob, 1, action === 'attack');
  }

  if (action === 'hurt') {
    frame.rect(9, 20, 1, 3, p.green);
    frame.rect(7, 24, 2, 1, p.waterLight);
    frame.rect(53, 18, 1, 2, p.green);
    frame.rect(55, 22, 1, 1, p.waterLight);
  }

  if (mirror) {
    const mirrored = new Canvas(CHIBI.frameSize, CHIBI.frameSize);
    mirrored.blit(frame, 0, 0, true);
    frame = mirrored;
  }

  if (action === 'cast') {
    // 球坐标按最终屏幕朝向定义，镜像后再叠加。
    const pose = MUELSYSE_CAST_POSES[frameIndex];
    for (const t of [0.25, 0.5, 0.75]) {
      const px = Math.round(pose.x + (32 - pose.x) * t);
      const py = Math.round(pose.y + (34 - pose.y) * t);
      frame.set(px, py, p.waterLight);
    }
    drawMuelsyseDrop(frame, pose.x, pose.y, 1.5, true);
  }

  return frame;
}

function drawMuelsyse() {
  const sheet = new Canvas(
    CHIBI.frameSize * CHIBI.columns,
    CHIBI.frameSize * CHIBI.rows,
  );
  const directionRows = ['down', 'right', 'up', 'left'];
  const frameActions = [
    'idle',
    'idle',
    'walk',
    'walk',
    'walk',
    'walk',
    'attack',
    'hurt',
  ];
  directionRows.forEach((direction, row) => {
    for (let column = 0; column < CHIBI.columns; column += 1) {
      const frame = drawMuelsyseFrame(direction, frameActions[column], column);
      sheet.blit(frame, column * CHIBI.frameSize, row * CHIBI.frameSize);
    }
  });
  for (let column = 0; column < CHIBI.columns; column += 1) {
    const pose = MUELSYSE_CAST_POSES[column];
    const baseFrame = drawMuelsyseFrame(pose.base, 'cast', column);
    sheet.blit(baseFrame, column * CHIBI.frameSize, 4 * CHIBI.frameSize);
  }
  sheet.save('public/assets/sprites/player-muelsyse.png');
}

drawFloor();
drawWallTile();
drawCoverTile();
drawVishdal();
drawAmiya();
drawSaria();
drawMuelsyse();
console.log('assets generated');
