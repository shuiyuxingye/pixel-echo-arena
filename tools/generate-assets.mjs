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

// ---------- 爆破手：V0.2 96×96 透明帧样板 ----------
//
// 造型基准：docs/design/v0.2/art/heroes-concept.png（DEMOLITIONIST 母版）
// 与 docs/references/wisadel-chibi-reference.png。
// 精灵表 9 列 × 5 行：
//   列 0-1 待机、2-5 行走、6-7 攻击、8 受击；
//   行 0 下、1 右、2 上、3 左（左向由右向镜像）；
//   行 4 为八向施法指向帧：北、东北、东、东南、南、西南、西、西北。
// 脚底锚点在每帧 y = 92，四边至少留 1px 透明；场内按 0.7 缩放显示约 67 逻辑像素。

const DEMO = {
  frameSize: 96,
  columns: 9,
  rows: 5,
  baseline: 92,
};

/** 战术家 V0.2 96×96 帧：与其余三人共用 9 列 × 5 行布局与脚底基线。 */
const MUELSYSE = {
  frameSize: DEMO.frameSize,
  columns: DEMO.columns,
  rows: DEMO.rows,
  baseline: DEMO.baseline,
};
/** 现有战术家绘制按 64 空间书写，统一按 1.5 倍映射到 96 帧。 */
const MUELSYSE_SCALE = 1.5;

const DEMO_PALETTE = {
  outline: color('#17131f'),
  outlineSoft: color('#332a3d'),
  hair: color('#d2d6df'),
  hairLight: color('#f6f8fc'),
  hairShade: color('#a5adbc'),
  hairDark: color('#727b8d'),
  horn: color('#c0242e'),
  hornLight: color('#ef4a3f'),
  hornDark: color('#641019'),
  skin: color('#fadcc4'),
  skinShade: color('#eec0a0'),
  skinDeep: color('#cd9070'),
  eyeWhite: color('#fff8e6'),
  iris: color('#f9a71c'),
  irisLight: color('#ffd35a'),
  irisDark: color('#d16f0b'),
  pupil: color('#2a1a14'),
  blush: color('#f39497'),
  jacket: color('#26202e'),
  jacketDark: color('#16121d'),
  jacketRed: color('#c02a32'),
  jacketRedLight: color('#eb4f40'),
  jacketRedDark: color('#701620'),
  shirt: color('#eee9f3'),
  belt: color('#121019'),
  metal: color('#5a6578'),
  metalLight: color('#aab4c2'),
  metalDark: color('#2b3240'),
  muzzle: color('#ff9f2e'),
  muzzleHot: color('#ffe77a'),
  boot: color('#1b1724'),
  bootLight: color('#3c324b'),
  armor: color('#cfd2d9'),
};

/** 连接折线的粗像素笔刷，用于呆毛与嘴。 */
function lineLoop(canvas, points, thickness, rgba) {
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    canvas.line(x0, y0, x1, y1, thickness, rgba);
  }
}

function demoMirror(points, side) {
  return points.map(([x, y]) => [side > 0 ? x : DEMO.frameSize - x, y]);
}

/** 夸张呆毛：从头顶向右上翘起的粗曲线，逐帧轻微摆动。 */
function drawDemoAhoge(canvas, x, y, sway) {
  const p = DEMO_PALETTE;
  const points = [
    [46 + x, 16 + y],
    [45 + x, 12 + y],
    [47 + x, 9 + y],
    [51 + x, 6 + y],
    [56 + x, 4 + y],
    [61 + x + sway, 5 + y],
    [64 + x + sway, 8 + y],
    [62 + x, 11 + y],
    [59 + x, 10 + y],
    [58 + x, 7 + y],
    [54 + x, 7 + y],
    [51 + x, 9 + y],
    [50 + x, 12 + y],
    [49 + x, 16 + y],
  ];
  lineLoop(canvas, points, 6, p.outline);
  lineLoop(canvas, points.slice(0, 12), 3, p.hair);
  canvas.line(53 + x + sway, 6 + y, 59 + x, 8 + y, 1, p.hairLight);
}

/** 红黑角饰：从额角向上翘起的尖头弯角，压在发帽之上。 */
function drawDemoHorn(canvas, side, x, y) {
  const p = DEMO_PALETTE;
  const band = demoMirror(
    [
      [62, 26],
      [64, 14],
      [71, 7],
      [80, 4],
      [87, 8],
      [83, 12],
      [76, 11],
      [70, 15],
      [68, 22],
      [66, 28],
    ],
    side,
  ).map(([px, py]) => [px + x, py + y]);
  canvas.polygonOutline(band, p.outline, 2);
  canvas.polygon(band, p.horn);
  const light = demoMirror([[66, 16], [72, 9], [79, 7], [76, 10], [70, 13]], side).map(
    ([px, py]) => [px + x, py + y],
  );
  canvas.polygon(light, p.hornLight);
  // 尖端延长成深红短刺
  canvas.polygon(
    demoMirror([[82, 10], [90, 6], [88, 14], [84, 13]], side).map(([px, py]) => [
      px + x,
      py + y,
    ]),
    p.hornDark,
  );
}

/** 侧面时远侧角只露出尖端，避免和近侧角抢轮廓。 */
function drawDemoHornTip(canvas, side, x, y) {
  const p = DEMO_PALETTE;
  const tip = demoMirror([[71, 8], [77, 5], [81, 9], [79, 15], [74, 16]], side).map(
    ([px, py]) => [px + x, py + y],
  );
  canvas.polygonOutline(tip, p.outline, 2);
  canvas.polygon(tip, p.hornDark);
}

function drawDemoHairCap(canvas, cx, cy, rx, ry) {
  const p = DEMO_PALETTE;
  canvas.ellipse(cx, cy, rx + 2, ry + 2, p.outline);
  canvas.ellipse(cx, cy, rx, ry, p.hair);
  canvas.ellipse(cx, cy - ry * 0.3, rx * 0.72, ry * 0.32, p.hairLight);
  canvas.ellipse(cx + rx * 0.58, cy + ry * 0.14, rx * 0.32, ry * 0.46, p.hairShade);
  canvas.ellipse(cx - rx * 0.6, cy + ry * 0.1, rx * 0.28, ry * 0.42, p.hairShade);
}

/** 前额碎发：块状尖束压住发际线，中央留出脸和眼睛。 */
function drawDemoFringe(canvas, x, y) {
  const p = DEMO_PALETTE;
  // 整片刘海盖住额头，只在中缝和两侧留出皮肤
  const baseBand = [
    [20, 32],
    [22, 22],
    [34, 19],
    [48, 18],
    [62, 19],
    [74, 22],
    [76, 32],
    [68, 28],
    [60, 30],
    [52, 32],
    [44, 30],
    [36, 28],
    [28, 30],
  ];
  canvas.polygon(baseBand.map(([px, py]) => [px + x, py + y]), p.hair);
  const bands = [
    [[20, 24], [29, 21], [33, 30], [26, 33], [21, 30]],
    [[30, 21], [39, 20], [41, 32], [33, 31]],
    [[40, 20], [47, 21], [46, 37], [42, 33]],
    [[49, 21], [56, 20], [54, 32], [50, 37]],
    [[57, 20], [66, 21], [63, 31], [56, 32]],
    [[67, 21], [76, 24], [75, 30], [68, 30]],
  ];
  for (const shape of bands) {
    canvas.polygon(shape.map(([px, py]) => [px + x, py + y]), p.hair);
  }
  canvas.polygon(
    [
      [44 + x, 29 + y],
      [52 + x, 29 + y],
      [50 + x, 40 + y],
      [46 + x, 40 + y],
    ],
    p.hair,
  );
  for (const [x0, x1, bottom] of [
    [22, 26, 31],
    [32, 36, 31],
    [42, 46, 37],
    [51, 55, 36],
    [59, 63, 31],
    [69, 74, 30],
  ]) {
    canvas.line(x0 + x, bottom - 2 + y, x1 + x, bottom - 2 + y, 1, p.hairShade);
  }
  canvas.line(52 + x, 22 + y, 50 + x, 31 + y, 1, p.hairShade);
  canvas.rect(33 + x, 22 + y, 6, 1, p.hairLight);
  canvas.rect(59 + x, 22 + y, 6, 1, p.hairLight);
  canvas.rect(46 + x, 20 + y, 4, 1, p.hairLight);
}

/** 两侧蓬松发束：覆盖脸颊边缘，让头部轮廓比身体大出一圈。 */
function drawDemoSideLocks(canvas, x, y) {
  const p = DEMO_PALETTE;
  const locks = [
    [[22, 24], [16, 26], [13, 34], [14, 46], [18, 56], [25, 62], [27, 54], [24, 44], [26, 34]],
    [[74, 24], [80, 26], [83, 34], [82, 46], [78, 56], [71, 62], [69, 54], [72, 44], [70, 34]],
  ];
  const shapes = locks;
  for (const shape of shapes) {
    canvas.polygonOutline(
      shape.map(([px, py]) => [px + x, py + y]),
      p.outline,
      1,
    );
    canvas.polygon(shape.map(([px, py]) => [px + x, py + y]), p.hair);
  }
  canvas.line(19 + x, 30 + y, 21 + x, 52 + y, 1, p.hairShade);
  canvas.line(77 + x, 30 + y, 75 + x, 52 + y, 1, p.hairShade);
  canvas.line(18 + x, 30 + y, 20 + x, 46 + y, 1, p.hairLight);
}

/** 半睁的黄橙大眼：上眼睑压低，攻击帧睁大，受击帧改为 X 眼。 */
function drawDemoEye(canvas, cx, cy, mood) {
  const p = DEMO_PALETTE;
  if (mood === 'hurt') {
    canvas.line(cx - 6, cy - 5, cx + 6, cy + 5, 2, p.outline);
    canvas.line(cx - 6, cy + 5, cx + 6, cy - 5, 2, p.outline);
    return;
  }
  const wide = mood === 'attack';
  canvas.ellipse(cx, cy, 8, 8, p.outline);
  canvas.ellipse(cx, cy, 6.5, 6.5, p.eyeWhite);
  canvas.ellipse(cx, cy + 1, 5.5, 5.5, p.iris);
  canvas.ellipse(cx, cy + 2.5, 4.5, 3, p.irisLight);
  canvas.ellipse(cx, cy + 2, 3.2, 2.2, p.irisDark);
  canvas.ellipse(cx, cy + 1, 2.6, 2.2, p.iris);
  canvas.rect(cx - 1, cy + 1 - (wide ? 1 : 0), 3, 5 + (wide ? 1 : 0), p.pupil);
  canvas.rect(cx - 3, cy - 2, 1, 2, p.eyeWhite);
  if (wide) {
    canvas.rect(cx - 7, cy - 7, 14, 1, p.outline);
    canvas.set(cx - 8, cy - 5, p.outline);
    canvas.set(cx + 8, cy - 5, p.outline);
  } else {
    canvas.rect(cx - 7, cy - 6, 14, 3, p.outline);
    canvas.rect(cx - 6, cy - 3, 12, 1, p.skinShade);
  }
}

/** 小小 w 嘴；攻击/受击改为张开的小口。 */
function drawDemoMouth(canvas, cx, cy, mood) {
  const p = DEMO_PALETTE;
  if (mood === 'hurt' || mood === 'attack') {
    canvas.ellipse(cx, cy + 1, 3, 4, p.outline);
    canvas.rect(cx - 2, cy + 2, 4, 2, p.skinDeep);
    return;
  }
  const points = [
    [cx - 5, cy - 1],
    [cx - 4, cy],
    [cx - 3, cy - 1],
    [cx - 2, cy],
    [cx, cy + 1],
    [cx + 2, cy],
    [cx + 3, cy - 1],
    [cx + 4, cy],
    [cx + 5, cy - 1],
  ];
  lineLoop(canvas, points, 1, p.outline);
  canvas.rect(cx - 2, cy + 2, 5, 1, p.skinDeep);
}

function drawDemoBlush(canvas, cx, cy) {
  const p = DEMO_PALETTE;
  for (let i = 0; i < 4; i += 1) {
    canvas.line(cx + i * 3, cy + 3, cx + 2 + i * 3, cy, 1, p.blush);
  }
  canvas.rect(cx + 1, cy + 2, 8, 1, p.blush);
}

/** 正面/背面头：银灰蓬松发、红角、黄橙大眼、w 嘴与腮红。 */
function drawDemoHeadFront(canvas, x, y, mood, back) {
  const p = DEMO_PALETTE;
  drawDemoHairCap(canvas, 48 + x, 33 + y, 30, 26);
  if (back) {
    // 后脑：发旋、分层发束与短马尾
    canvas.ellipse(48 + x, 40 + y, 24, 20, p.hairShade);
    canvas.ellipse(48 + x, 34 + y, 18, 12, p.hair);
    canvas.line(40 + x, 20 + y, 48 + x, 30 + y, 1, p.hairLight);
    canvas.line(56 + x, 20 + y, 48 + x, 30 + y, 1, p.hairLight);
    canvas.polygon(
      [
        [40 + x, 54 + y],
        [56 + x, 54 + y],
        [52 + x, 64 + y],
        [44 + x, 64 + y],
      ],
      p.hairDark,
    );
    drawDemoSideLocks(canvas, x, y);
    return;
  }
  canvas.ellipse(48 + x, 45 + y, 25, 22, p.outline);
  canvas.ellipse(48 + x, 45 + y, 24, 21, p.skin);
  canvas.ellipse(48 + x, 58 + y, 17, 7, p.skinShade);
  drawDemoFringe(canvas, x, y);
  drawDemoSideLocks(canvas, x, y);
  drawDemoEye(canvas, 37 + x, 47 + y, mood);
  drawDemoEye(canvas, 59 + x, 47 + y, mood);
  drawDemoMouth(canvas, 48 + x, 57 + y, mood);
  drawDemoBlush(canvas, 27 + x, 54 + y);
  drawDemoBlush(canvas, 66 + x, 54 + y);
}

/** 右侧头：单眼、侧脸与后脑发束；左侧由整帧镜像生成。 */
function drawDemoHeadSide(canvas, x, y, mood) {
  const p = DEMO_PALETTE;
  drawDemoHairCap(canvas, 50 + x, 33 + y, 29, 26);
  canvas.ellipse(60 + x, 46 + y, 21, 21, p.outline);
  canvas.ellipse(60 + x, 46 + y, 20, 20, p.skin);
  canvas.ellipse(63 + x, 59 + y, 13, 5, p.skinShade);
  drawDemoFringe(canvas, 6 + x, y);
  // 后脑一侧的发束从耳后垂到肩
  const backLock = [
    [30, 26],
    [23, 28],
    [21, 38],
    [23, 52],
    [29, 62],
    [38, 60],
    [36, 52],
    [33, 40],
    [36, 32],
  ];
  canvas.polygonOutline(
    backLock.map(([px, py]) => [px + x, py + y]),
    p.outline,
    1,
  );
  canvas.polygon(backLock.map(([px, py]) => [px + x, py + y]), p.hair);
  canvas.line(26 + x, 32 + y, 29 + x, 52 + y, 1, p.hairShade);
  drawDemoEye(canvas, 65 + x, 47 + y, mood);
  canvas.rect(78 + x, 52 + y, 3, 2, p.skinDeep);
  drawDemoMouth(canvas, 69 + x, 58 + y, mood);
  drawDemoBlush(canvas, 60 + x, 56 + y);
}

/** 短腿厚靴：靴底固定压到 y=92，走路只抬起另一只脚。 */
function drawDemoBoot(canvas, x, bottom, width, height) {
  const p = DEMO_PALETTE;
  canvas.rect(x - 1, bottom - height - 1, width + 2, height + 2, p.outline);
  canvas.rect(x, bottom - height, width, height, p.boot);
  canvas.rect(x, bottom - height, width, 2, p.bootLight);
  canvas.rect(x + 1, bottom - 2, width - 2, 1, p.armor);
}

function drawDemoBodyFront(canvas, y, legPhase, back) {
  const p = DEMO_PALETTE;
  const swingLeft = legPhase > 0 ? 2 : legPhase < 0 ? -1 : 0;
  const swingRight = legPhase < 0 ? 2 : legPhase > 0 ? -1 : 0;
  const liftLeft = legPhase > 0 ? 2 : 0;
  const liftRight = legPhase < 0 ? 2 : 0;
  const baseline = DEMO.baseline;

  // 腿与靴
  canvas.rect(38 + swingLeft, 82 + y, 8, 6, p.jacketDark);
  canvas.rect(50 + swingRight, 82 + y, 8, 6, p.jacketDark);
  drawDemoBoot(canvas, 35 + swingLeft, baseline - liftLeft, 13, 7);
  drawDemoBoot(canvas, 49 + swingRight, baseline - liftRight, 13, 7);

  // 躯干
  canvas.rect(30, 62 + y, 36, 24, p.outline);
  canvas.rect(31, 63 + y, 34, 22, p.jacket);
  canvas.rect(31, 63 + y, 7, 22, p.jacketRed);
  canvas.rect(58, 63 + y, 7, 22, p.jacketRed);
  canvas.rect(31, 63 + y, 1, 22, p.jacketRedDark);
  canvas.rect(64, 63 + y, 1, 22, p.jacketRedDark);
  canvas.rect(35, 64 + y, 1, 18, p.jacketRedLight);
  canvas.rect(61, 64 + y, 1, 18, p.jacketRedLight);

  if (back) {
    canvas.rect(38, 63 + y, 20, 3, p.jacketRed);
    canvas.rect(44, 66 + y, 8, 16, p.jacketDark);
    canvas.rect(47, 68 + y, 2, 2, p.metalLight);
    canvas.polygon(
      [
        [44 + 0, 70 + y],
        [52, 70 + y],
        [48, 77 + y],
      ],
      p.jacketRed,
    );
  } else {
    canvas.polygon(
      [
        [40, 63 + y],
        [56, 63 + y],
        [48, 75 + y],
      ],
      p.shirt,
    );
    canvas.rect(46, 64 + y, 5, 4, p.jacketRed);
    canvas.polygon(
      [
        [42, 65 + y],
        [46, 66 + y],
        [44, 70 + y],
      ],
      p.jacketRedDark,
    );
    canvas.polygon(
      [
        [54, 65 + y],
        [50, 66 + y],
        [52, 70 + y],
      ],
      p.jacketRedDark,
    );
  }

  // 手臂：红色短袖 + 露出的手
  canvas.rect(20, 65 + y, 11, 19, p.outline);
  canvas.rect(21, 66 + y, 9, 17, p.jacketRed);
  canvas.rect(21, 66 + y, 1, 15, p.jacketRedDark);
  canvas.rect(23, 80 + y, 6, 5, p.skin);
  canvas.rect(65, 65 + y, 11, 19, p.outline);
  canvas.rect(66, 66 + y, 9, 17, p.jacketRed);
  canvas.rect(74, 66 + y, 1, 15, p.jacketRedDark);
  canvas.rect(67, 80 + y, 6, 5, p.skin);

  // 腰带与金属扣
  canvas.rect(31, 81 + y, 34, 4, p.belt);
  canvas.rect(46, 81 + y, 5, 4, p.metalLight);
  canvas.rect(47, 82 + y, 3, 1, p.metalDark);
}

function drawDemoBodySide(canvas, y, legPhase) {
  const p = DEMO_PALETTE;
  const swingFront = legPhase > 0 ? 2 : legPhase < 0 ? -2 : 0;
  const swingBack = -swingFront;
  const liftFront = legPhase > 0 ? 2 : 0;
  const liftBack = legPhase < 0 ? 2 : 0;
  const baseline = DEMO.baseline;

  canvas.rect(40 + swingBack, 82 + y, 8, 6, p.jacketDark);
  canvas.rect(52 + swingFront, 82 + y, 8, 6, p.jacketDark);
  drawDemoBoot(canvas, 38 + swingBack, baseline - liftBack, 12, 7);
  drawDemoBoot(canvas, 51 + swingFront, baseline - liftFront, 12, 7);

  canvas.rect(33, 62 + y, 33, 24, p.outline);
  canvas.rect(34, 63 + y, 31, 22, p.jacket);
  canvas.rect(34, 63 + y, 6, 22, p.jacketRed);
  canvas.rect(60, 63 + y, 5, 22, p.jacketRed);
  canvas.rect(34, 63 + y, 1, 22, p.jacketRedDark);
  canvas.rect(64, 63 + y, 1, 22, p.jacketRedDark);
  canvas.rect(38, 64 + y, 1, 18, p.jacketRedLight);
  canvas.rect(34, 63 + y, 10, 3, p.jacketRedDark);
  canvas.rect(34, 81 + y, 31, 4, p.belt);
  canvas.rect(39, 81 + y, 4, 4, p.metalLight);

  // 前伸手臂与手
  canvas.rect(52, 66 + y, 16, 15, p.outline);
  canvas.rect(53, 67 + y, 14, 13, p.jacketRed);
  canvas.rect(53, 67 + y, 1, 11, p.jacketRedDark);
  canvas.rect(63, 78 + y, 6, 5, p.skin);
}

/** 大号发射器：粗描边、金属高光、红色识别带与方口枪口。 */
function drawDemoLauncher(canvas, x0, y0, x1, y1) {
  const p = DEMO_PALETTE;
  canvas.line(x0, y0, x1, y1, 16, p.outline);
  canvas.line(x0, y0, x1, y1, 12, p.metal);
  canvas.line(x0 - 1, y0 - 1, x1 - 1, y1 - 1, 4, p.metalLight);
  canvas.line(x0 + 2, y0 + 2, x1 + 2, y1 + 2, 4, p.metalDark);
  const midX = Math.round((x0 + x1) / 2);
  const midY = Math.round((y0 + y1) / 2);
  canvas.rect(midX - 4, midY - 4, 8, 8, p.outline);
  canvas.rect(midX - 3, midY - 3, 6, 6, p.jacketRed);
  canvas.rect(midX - 3, midY - 3, 6, 2, p.jacketRedLight);
  // 枪口方环
  canvas.rect(x1 - 6, y1 - 6, 13, 13, p.outline);
  canvas.rect(x1 - 5, y1 - 5, 11, 11, p.metalDark);
  canvas.rect(x1 - 3, y1 - 3, 7, 7, p.muzzle);
  canvas.rect(x1 - 2, y1 - 2, 4, 4, color('#2a1a14'));
  // 握把
  canvas.line(x0 - 1, y0 + 1, x0 - 7, y0 + 9, 6, p.outline);
  canvas.line(x0 - 2, y0 + 2, x0 - 6, y0 + 8, 3, p.metal);
}

function drawDemoMuzzleFlash(canvas, x, y) {
  const p = DEMO_PALETTE;
  canvas.rect(x - 3, y, 7, 1, p.muzzle);
  canvas.rect(x, y - 3, 1, 7, p.muzzle);
  canvas.rect(x - 2, y - 2, 5, 5, p.muzzleHot);
  canvas.set(x - 4, y + 1, p.muzzle);
  canvas.set(x + 4, y - 1, p.muzzle);
  canvas.set(x - 1, y - 4, p.muzzle);
  canvas.set(x + 1, y + 4, p.muzzle);
}

/** 正面持枪：常态斜挎在身侧，攻击两帧抬枪并后坐。 */
function drawDemoFrontWeapon(canvas, attack, local) {
  if (!attack) {
    drawDemoLauncher(canvas, 36, 70, 12, 82);
    return;
  }
  if (local === 0) {
    drawDemoLauncher(canvas, 38, 68, 10, 58);
    return;
  }
  drawDemoLauncher(canvas, 38, 70, 12, 62);
  drawDemoMuzzleFlash(canvas, 9, 59);
}

/** 右侧持枪：枪口朝右，攻击第二帧闪光。 */
function drawDemoSideWeapon(canvas, attack, local) {
  if (!attack) {
    drawDemoLauncher(canvas, 55, 69, 86, 64);
    return;
  }
  if (local === 0) {
    drawDemoLauncher(canvas, 55, 66, 86, 60);
    return;
  }
  drawDemoLauncher(canvas, 53, 68, 84, 62);
  drawDemoMuzzleFlash(canvas, 87, 62);
}

/** 八向施法枪口几何；坐标按最终屏幕朝向给定，镜像后再叠加。 */
const DEMO_CAST_POSES = [
  { base: 'up', x0: 70, y0: 66, x1: 80, y1: 14, fx: 80, fy: 10 },
  { base: 'up', x0: 66, y0: 66, x1: 84, y1: 28, fx: 87, fy: 25 },
  { base: 'right', x0: 56, y0: 66, x1: 86, y1: 60, fx: 89, fy: 60 },
  { base: 'down', x0: 54, y0: 70, x1: 76, y1: 82, fx: 79, fy: 86 },
  { base: 'down', x0: 48, y0: 70, x1: 48, y1: 82, fx: 48, fy: 86 },
  { base: 'left', x0: 32, y0: 70, x1: 10, y1: 82, fx: 7, fy: 86 },
  { base: 'left', x0: 34, y0: 66, x1: 10, y1: 60, fx: 7, fy: 60 },
  { base: 'left', x0: 32, y0: 66, x1: 10, y1: 28, fx: 7, fy: 25 },
];

function demoLocalFrame(action, column) {
  if (action === 'walk') return column - 2;
  if (action === 'attack') return column - 6;
  if (action === 'idle') return column;
  return 0;
}

function drawDemoFrame(direction, action, column) {
  let frame = new Canvas(DEMO.frameSize, DEMO.frameSize);
  const p = DEMO_PALETTE;
  const mirror = direction === 'left';
  const base = mirror ? 'right' : direction;
  const local = demoLocalFrame(action, column);
  const idle = action === 'idle';
  const walk = action === 'walk';
  const attack = action === 'attack';
  const hurt = action === 'hurt';
  const bob = idle || walk ? local % 2 : 0;
  const recoil = attack && local === 1 ? 2 : 0;
  const headX = hurt ? 2 : base === 'right' ? -recoil : recoil;
  const headY = (hurt ? 2 : 0) + bob;
  const bodyY = (hurt ? 1 : 0) + bob;
  const legPhase = walk ? [0, 1, 0, -1][local] ?? 0 : 0;
  const mood = hurt ? 'hurt' : attack ? 'attack' : 'idle';

  // 先画呆毛，发帽压住根部；角饰留到头部之后，让它压在银发上更醒目
  drawDemoAhoge(frame, headX, headY, idle ? (local % 2 ? 1 : 0) : 0);

  if (base === 'right') {
    drawDemoBodySide(frame, bodyY, legPhase);
    if (action !== 'cast') drawDemoSideWeapon(frame, attack, local);
    drawDemoHeadSide(frame, headX, headY, mood);
    drawDemoHorn(frame, 1, headX, headY);
    drawDemoHornTip(frame, -1, headX, headY);
  } else {
    const back = base === 'up';
    drawDemoBodyFront(frame, bodyY, legPhase, back);
    if (action !== 'cast') drawDemoFrontWeapon(frame, attack, local);
    drawDemoHeadFront(frame, headX, headY, mood, back);
    drawDemoHorn(frame, 1, headX, headY);
    drawDemoHorn(frame, -1, headX, headY);
  }

  if (hurt) {
    // 受击：红色冲击碎片 + 后仰位移
    frame.rect(14, 26, 2, 5, p.jacketRedLight);
    frame.rect(12, 32, 4, 2, p.muzzle);
    frame.rect(80, 22, 2, 4, p.jacketRedLight);
    frame.rect(82, 28, 3, 2, p.muzzle);
  }

  if (mirror) {
    const mirrored = new Canvas(DEMO.frameSize, DEMO.frameSize);
    mirrored.blit(frame, 0, 0, true);
    frame = mirrored;
  }

  if (action === 'cast') {
    const pose = DEMO_CAST_POSES[column];
    drawDemoLauncher(frame, pose.x0, pose.y0, pose.x1, pose.y1);
    drawDemoMuzzleFlash(frame, pose.fx, pose.fy);
  }

  return frame;
}

function drawDemolitionist() {
  const sheet = new Canvas(
    DEMO.frameSize * DEMO.columns,
    DEMO.frameSize * DEMO.rows,
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
    'attack',
    'hurt',
  ];
  directionRows.forEach((direction, row) => {
    for (let column = 0; column < DEMO.columns; column += 1) {
      const frame = drawDemoFrame(direction, frameActions[column], column);
      sheet.blit(frame, column * DEMO.frameSize, row * DEMO.frameSize);
    }
  });
  for (let column = 0; column < DEMO_CAST_POSES.length; column += 1) {
    const pose = DEMO_CAST_POSES[column];
    const baseFrame = drawDemoFrame(pose.base, 'cast', column);
    sheet.blit(baseFrame, column * DEMO.frameSize, 4 * DEMO.frameSize);
  }
  sheet.save('public/assets/sprites/player-vishdal.png');
}

// ---------- 术士 Q 版精灵表 ----------
//
// 与爆破手共用 V0.2 的 96×96、9 列 × 5 行布局：
//   列 0-1 待机、2-5 行走、6-7 攻击、8 受击；
//   行 0 下、1 右、2 上、3 左（左向由右向整帧镜像）；
//   行 4 为八向施法指向帧：北、东北、东、东南、南、西南、西、西北。
// 造型基准：docs/design/v0.2/art/heroes-concept.png 的 WARLOCK ——
// 棕发、长耳尖兜帽、蓝紫术式、认真又困倦的眼神；不是爆破手换色。
// 脚底锚点 y=92，四边至少留 1px 透明，场内按 0.7 缩放显示约 67 逻辑像素。

const AMIYA = {
  frameSize: DEMO.frameSize,
  columns: DEMO.columns,
  rows: DEMO.rows,
  baseline: DEMO.baseline,
};

const AMIYA_PALETTE = {
  outline: color('#191426'),
  outlineSoft: color('#2d2740'),
  hair: color('#6b4630'),
  hairLight: color('#9c6b48'),
  hairShade: color('#4d3121'),
  hairDark: color('#382216'),
  hood: color('#2a2a4d'),
  hoodDark: color('#1b1b35'),
  hoodLight: color('#3d3d68'),
  hoodInner: color('#6b4b9e'),
  hoodInnerDark: color('#4a3272'),
  hoodInnerLight: color('#9a75d8'),
  rune: color('#c9c3d6'),
  runeLight: color('#f2eefb'),
  skin: color('#f6d8c2'),
  skinShade: color('#e6b899'),
  skinDeep: color('#c9906f'),
  eyeWhite: color('#fdf8ee'),
  iris: color('#4fb8d9'),
  irisLight: color('#9fe8f7'),
  irisDark: color('#1d6a8c'),
  pupil: color('#12202e'),
  blush: color('#ea9a9e'),
  robe: color('#2b2f52'),
  robeDark: color('#191c35'),
  robeLight: color('#414879'),
  trim: color('#7d5cb8'),
  trimLight: color('#b695e8'),
  shirt: color('#e8e4f2'),
  belt: color('#12101f'),
  boot: color('#1d1c38'),
  bootLight: color('#4b4a78'),
  orb: color('#7b4fe0'),
  orbLight: color('#c7a9ff'),
  orbDark: color('#3c1f86'),
  flame: color('#a86bf0'),
  flameLight: color('#e2c8ff'),
  tome: color('#8a5a2c'),
  tomeDark: color('#5b3a1c'),
  tomePage: color('#e6d8bd'),
};

/** 以头部中心镜像左半形状，保证左右朝向共用同一套坐标。 */
function amiyaMirror(points, centerX) {
  return points.map(([x, y]) => [2 * centerX - x, y]);
}

/** 兜帽长耳：深蓝外层 + 紫色内衬；耳根由帽壳压住，尖部留 1px 透明。 */
function drawAmiyaHoodEars(canvas, x, y, mode, sway = 0) {
  const p = AMIYA_PALETTE;
  const outer = [
    [38 + x, 32 + y],
    [31 + x + sway, 24 + y],
    [25 + x + sway, 14 + y],
    [20 + x + sway, 5 + y],
    [17 + x + sway, 2 + y],
    [22 + x + sway, 2 + y],
    [27 + x + sway, 8 + y],
    [33 + x + sway, 16 + y],
    [38 + x, 25 + y],
    [42 + x, 32 + y],
  ];
  const inner = [
    [36 + x, 28 + y],
    [30 + x + sway, 21 + y],
    [26 + x + sway, 13 + y],
    [23 + x + sway, 6 + y],
    [25 + x + sway, 6 + y],
    [29 + x + sway, 12 + y],
    [34 + x + sway, 19 + y],
    [37 + x, 26 + y],
  ];
  const ear = (flip, fill, lining) => {
    const shape = flip ? amiyaMirror(outer, 48 + x) : outer;
    const innerShape = flip ? amiyaMirror(inner, 48 + x) : inner;
    canvas.polygonOutline(shape, p.outline, 1);
    canvas.polygon(shape, fill);
    canvas.polygon(innerShape, lining);
  };

  if (mode === 'side') {
    // 右向：远侧耳朵压暗，近侧完整。
    ear(false, p.hoodDark, p.hoodInnerDark);
    ear(true, p.hood, p.hoodInner);
    return;
  }
  if (mode === 'back') {
    ear(true, p.hoodDark, p.hoodInnerDark);
    ear(false, p.hoodDark, p.hoodInnerDark);
    return;
  }
  ear(true, p.hood, p.hoodInner);
  ear(false, p.hood, p.hoodInner);
}

function drawAmiyaHoodDome(canvas, cx, cy, rx, ry) {
  const p = AMIYA_PALETTE;
  canvas.ellipse(cx, cy, rx + 2, ry + 2, p.outline);
  canvas.ellipse(cx, cy, rx, ry, p.hood);
  canvas.ellipse(cx, cy - ry * 0.35, rx * 0.72, ry * 0.3, p.hoodLight);
  canvas.ellipse(cx + rx * 0.6, cy + ry * 0.2, rx * 0.3, ry * 0.42, p.hoodDark);
}

/** 兜帽侧摆：从帽檐垂到肩前，内缘露出紫色衬里。 */
function drawAmiyaHoodDrapes(canvas, x, y, mode) {
  const p = AMIYA_PALETTE;
  if (mode === 'back') {
    const cape = [
      [22 + x, 52 + y],
      [31 + x, 58 + y],
      [31 + x, 80 + y],
      [23 + x, 84 + y],
      [15 + x, 73 + y],
      [16 + x, 58 + y],
    ];
    for (const shape of [cape, amiyaMirror(cape, 48 + x)]) {
      canvas.polygonOutline(shape, p.outline, 1);
      canvas.polygon(shape, p.hoodDark);
    }
    return;
  }
  if (mode === 'side') {
    const backDrape = [
      [30 + x, 40 + y],
      [36 + x, 46 + y],
      [37 + x, 64 + y],
      [33 + x, 76 + y],
      [25 + x, 72 + y],
      [24 + x, 56 + y],
      [26 + x, 44 + y],
    ];
    canvas.polygonOutline(backDrape, p.outline, 1);
    canvas.polygon(backDrape, p.hood);
    canvas.polygon(
      [
        [28 + x, 48 + y],
        [32 + x, 52 + y],
        [32 + x, 66 + y],
        [29 + x, 70 + y],
        [27 + x, 58 + y],
      ],
      p.hoodInnerDark,
    );
    return;
  }
  const left = [
    [21 + x, 38 + y],
    [26 + x, 44 + y],
    [27 + x, 62 + y],
    [23 + x, 74 + y],
    [16 + x, 71 + y],
    [13 + x, 57 + y],
    [15 + x, 44 + y],
  ];
  const right = amiyaMirror(left, 48 + x);
  for (const shape of [left, right]) {
    canvas.polygonOutline(shape, p.outline, 1);
    canvas.polygon(shape, p.hood);
  }
  const liningLeft = [
    [23 + x, 46 + y],
    [26 + x, 52 + y],
    [25 + x, 64 + y],
    [22 + x, 68 + y],
    [20 + x, 58 + y],
    [20 + x, 49 + y],
  ];
  for (const shape of [liningLeft, amiyaMirror(liningLeft, 48 + x)]) {
    canvas.polygon(shape, p.hoodInnerDark);
  }
}

/** 棕发刘海：帽檐下露出块状发束，中央留出困倦的眼睛。 */
function drawAmiyaFringe(canvas, x, y, mode) {
  const p = AMIYA_PALETTE;
  if (mode === 'back') return;
  if (mode === 'side') {
    const bands = [
      [[44, 33], [51, 30], [52, 44], [46, 42]],
      [[50, 30], [58, 30], [59, 45], [52, 43]],
      [[57, 30], [64, 32], [65, 47], [59, 45]],
      [[63, 32], [70, 36], [69, 43], [64, 46]],
    ];
    for (const shape of bands) {
      canvas.polygon(shape.map(([px, py]) => [px + x, py + y]), p.hair);
    }
    canvas.line(48 + x, 33 + y, 47 + x, 42 + y, 1, p.hairShade);
    canvas.line(61 + x, 34 + y, 60 + x, 44 + y, 1, p.hairShade);
    canvas.rect(52 + x, 33 + y, 5, 1, p.hairLight);
    return;
  }
  const base = [
    [27, 37], [32, 31], [40, 28], [48, 28], [56, 28], [64, 31], [69, 37],
    [63, 41], [56, 39], [48, 41], [40, 39], [33, 41],
  ];
  canvas.polygon(base.map(([px, py]) => [px + x, py + y]), p.hair);
  const strands = [
    [[28, 33], [34, 31], [33, 44], [28, 42]],
    [[34, 30], [41, 29], [41, 45], [34, 43]],
    [[42, 29], [48, 29], [47, 47], [42, 44]],
    [[49, 29], [56, 29], [56, 46], [49, 46]],
    [[57, 30], [64, 32], [63, 43], [57, 44]],
  ];
  for (const shape of strands) {
    canvas.polygon(shape.map(([px, py]) => [px + x, py + y]), p.hair);
  }
  for (const [x0, x1, bottom] of [
    [29, 33, 41],
    [36, 40, 42],
    [43, 47, 44],
    [50, 56, 43],
    [58, 63, 40],
  ]) {
    canvas.line(x0 + x, bottom + y, x1 + x, bottom - 2 + y, 1, p.hairShade);
  }
  canvas.rect(34 + x, 31 + y, 5, 1, p.hairLight);
  canvas.rect(56 + x, 31 + y, 5, 1, p.hairLight);
  canvas.line(48 + x, 30 + y, 47 + x, 38 + y, 1, p.hairShade);
}

/** 两侧棕发束：从帽檐内垂到肩前，压住脸颊边缘。 */
function drawAmiyaSideLocks(canvas, x, y, mode) {
  const p = AMIYA_PALETTE;
  if (mode === 'side') {
    const nearLock = [
      [70 + x, 40 + y],
      [75 + x, 45 + y],
      [76 + x, 57 + y],
      [73 + x, 68 + y],
      [68 + x, 65 + y],
      [67 + x, 54 + y],
      [68 + x, 44 + y],
    ];
    canvas.polygonOutline(nearLock, p.outline, 1);
    canvas.polygon(nearLock, p.hair);
    canvas.line(72 + x, 47 + y, 72 + x, 62 + y, 1, p.hairShade);
    canvas.line(70 + x, 46 + y, 70 + x, 58 + y, 1, p.hairLight);
    return;
  }
  if (mode === 'back') return;
  const left = [
    [27 + x, 38 + y],
    [23 + x, 43 + y],
    [22 + x, 54 + y],
    [24 + x, 66 + y],
    [29 + x, 71 + y],
    [32 + x, 64 + y],
    [30 + x, 53 + y],
    [31 + x, 42 + y],
  ];
  for (const shape of [left, amiyaMirror(left, 48 + x)]) {
    canvas.polygonOutline(shape, p.outline, 1);
    canvas.polygon(shape, p.hair);
  }
  canvas.line(26 + x, 45 + y, 27 + x, 62 + y, 1, p.hairShade);
  canvas.line(70 + x, 45 + y, 69 + x, 62 + y, 1, p.hairShade);
  canvas.line(28 + x, 44 + y, 30 + x, 58 + y, 1, p.hairLight);
  canvas.line(68 + x, 44 + y, 66 + x, 58 + y, 1, p.hairLight);
}

/** 帽檐与中央银扣：把兜帽、棕发与脸部层次分开。 */
function drawAmiyaBrim(canvas, x, y, mode) {
  const p = AMIYA_PALETTE;
  const shift = mode === 'side' ? 8 : 0;
  const band = [
    [22, 36], [28, 30], [38, 27], [48, 26], [58, 27], [68, 30], [74, 36],
    [68, 39], [58, 35], [48, 34], [38, 35], [28, 39],
  ].map(([px, py]) => [px + shift + x, py + y]);
  canvas.polygon(band, p.hood);
  canvas.line(29 + shift + x, 34 + y, 43 + shift + x, 29 + y, 1, p.hoodLight);
  canvas.line(53 + shift + x, 29 + y, 67 + shift + x, 33 + y, 1, p.hoodLight);
  canvas.line(25 + shift + x, 37 + y, 71 + shift + x, 37 + y, 1, p.hoodDark);
  const claspX = 48 + shift + x;
  const claspY = 33 + y;
  canvas.polygon(
    [
      [claspX, claspY - 6],
      [claspX + 4, claspY],
      [claspX, claspY + 6],
      [claspX - 4, claspY],
    ],
    p.outline,
  );
  canvas.polygon(
    [
      [claspX, claspY - 5],
      [claspX + 3, claspY],
      [claspX, claspY + 5],
      [claspX - 3, claspY],
    ],
    p.rune,
  );
  canvas.polygon(
    [
      [claspX, claspY - 2],
      [claspX + 2, claspY],
      [claspX, claspY + 2],
      [claspX - 2, claspY],
    ],
    p.hoodInnerLight,
  );
}

/** 蓝青大眼：上眼睑压低成半睁，表达认真又困倦；攻击睁大，受击改 X 眼。 */
function drawAmiyaEye(canvas, cx, cy, mood, big = false) {
  const p = AMIYA_PALETTE;
  if (mood === 'hurt') {
    canvas.line(cx - 5, cy - 4, cx + 5, cy + 4, 2, p.outline);
    canvas.line(cx - 5, cy + 4, cx + 5, cy - 4, 2, p.outline);
    return;
  }
  const wide = mood === 'attack';
  const grow = big ? 1 : 0;
  canvas.ellipse(cx, cy, 7 + grow, 7 + grow, p.outline);
  canvas.ellipse(cx, cy, 5.8 + grow, 5.8 + grow, p.eyeWhite);
  canvas.ellipse(cx, cy + 1.2, 4.8 + grow, 4.6 + grow, p.iris);
  canvas.ellipse(cx, cy + 2.4, 3.6 + grow, 2.4 + grow * 0.5, p.irisLight);
  canvas.rect(cx - 1, cy + 1 - (wide ? 1 : 0), 2, 4 + (wide ? 1 : 0) + grow, p.pupil);
  canvas.rect(cx - 3, cy - 1, 1, 2 + grow, p.eyeWhite);
  canvas.rect(cx + 2, cy + 3, 1, 1, p.irisDark);
  if (wide) {
    canvas.rect(cx - 7 - grow, cy - 7 - grow, 14 + grow * 2, 1, p.outline);
  } else {
    canvas.rect(cx - 7 - grow, cy - 7 - grow, 14 + grow * 2, 4, p.outline);
    canvas.rect(cx - 6 - grow, cy - 3 - grow, 12 + grow * 2, 1, p.skinShade);
  }
}

function drawAmiyaBrows(canvas, x, y, mood, side = false) {
  const p = AMIYA_PALETTE;
  const tilt = mood === 'attack' ? 2 : 1;
  if (side) {
    canvas.line(62 + x, 45 + y, 73 + x, 46 + y - tilt, 1, p.hairDark);
    return;
  }
  canvas.line(30 + x, 45 + y, 40 + x, 46 + y - tilt, 1, p.hairDark);
  canvas.line(66 + x, 45 + y, 56 + x, 46 + y - tilt, 1, p.hairDark);
}

function drawAmiyaMouth(canvas, cx, cy, mood) {
  const p = AMIYA_PALETTE;
  if (mood === 'attack' || mood === 'hurt') {
    canvas.ellipse(cx, cy, 2, 3, p.outline);
    canvas.rect(cx - 1, cy + 1, 2, 1, p.skinDeep);
    return;
  }
  canvas.set(cx - 3, cy - 1, p.outline);
  canvas.set(cx - 2, cy, p.outline);
  canvas.set(cx - 1, cy - 1, p.outline);
  canvas.set(cx, cy + 1, p.outline);
  canvas.set(cx + 1, cy - 1, p.outline);
  canvas.set(cx + 2, cy, p.outline);
  canvas.set(cx + 3, cy - 1, p.outline);
  canvas.set(cx, cy + 2, p.skinDeep);
}

function drawAmiyaBlush(canvas, cx, cy) {
  const { blush } = AMIYA_PALETTE;
  for (let i = 0; i < 3; i += 1) {
    canvas.line(cx + i * 3, cy + 2, cx + 2 + i * 3, cy, 1, blush);
  }
  canvas.rect(cx + 1, cy + 2, 6, 1, blush);
}

function drawAmiyaHeadFront(canvas, x, y, mood, back, earSway = 0) {
  const p = AMIYA_PALETTE;
  drawAmiyaHoodEars(canvas, x, y, back ? 'back' : 'front', earSway);
  drawAmiyaHoodDome(canvas, 48 + x, 40 + y, 30, 25);
  if (back) {
    // 后脑：兜帽背壳、垂坠帽尖与银扣，只露出一点棕发。
    canvas.ellipse(48 + x, 49 + y, 23, 26, p.hoodDark);
    canvas.ellipse(48 + x, 44 + y, 19, 17, p.hood);
    canvas.ellipse(48 + x, 46 + y, 14, 10, p.hoodLight);
    canvas.line(48 + x, 28 + y, 48 + x, 44 + y, 1, p.hoodDark);
    canvas.polygon(
      [
        [41 + x, 62 + y],
        [55 + x, 62 + y],
        [55 + x, 73 + y],
        [48 + x, 68 + y],
        [41 + x, 73 + y],
      ],
      p.hairShade,
    );
    canvas.rect(42 + x, 71 + y, 12, 2, p.hairDark);
    canvas.polygon(
      [
        [48 + x, 34 + y],
        [52 + x, 40 + y],
        [48 + x, 46 + y],
        [44 + x, 40 + y],
      ],
      p.rune,
    );
    canvas.rect(47 + x, 39 + y, 2, 2, p.hoodInnerLight);
    drawAmiyaHoodDrapes(canvas, x, y, 'back');
    return;
  }
  canvas.ellipse(48 + x, 51 + y, 22, 20, p.outline);
  canvas.ellipse(48 + x, 51 + y, 21, 19, p.skin);
  canvas.ellipse(48 + x, 62 + y, 15, 6, p.skinShade);
  drawAmiyaHoodDrapes(canvas, x, y, 'front');
  drawAmiyaFringe(canvas, x, y, 'front');
  drawAmiyaSideLocks(canvas, x, y, 'front');
  drawAmiyaBrim(canvas, x, y, 'front');
  drawAmiyaBrows(canvas, x, y, mood);
  drawAmiyaEye(canvas, 37 + x, 53 + y, mood);
  drawAmiyaEye(canvas, 59 + x, 53 + y, mood);
  drawAmiyaMouth(canvas, 48 + x, 65 + y, mood);
  drawAmiyaBlush(canvas, 30 + x, 62 + y);
  drawAmiyaBlush(canvas, 60 + x, 62 + y);
}

function drawAmiyaHeadSide(canvas, x, y, mood, earSway = 0) {
  const p = AMIYA_PALETTE;
  drawAmiyaHoodEars(canvas, x, y, 'side', earSway);
  drawAmiyaHoodDome(canvas, 52 + x, 40 + y, 29, 25);
  canvas.ellipse(61 + x, 51 + y, 19, 19, p.outline);
  canvas.ellipse(61 + x, 51 + y, 18, 18, p.skin);
  canvas.ellipse(64 + x, 62 + y, 12, 5, p.skinShade);
  drawAmiyaHoodDrapes(canvas, x, y, 'side');
  // 后脑棕发束从兜帽内垂到肩。
  const backLock = [
    [39 + x, 34 + y],
    [32 + x, 39 + y],
    [31 + x, 52 + y],
    [34 + x, 66 + y],
    [40 + x, 70 + y],
    [43 + x, 60 + y],
    [41 + x, 48 + y],
    [43 + x, 38 + y],
  ];
  canvas.polygonOutline(backLock, p.outline, 1);
  canvas.polygon(backLock, p.hair);
  canvas.line(35 + x, 42 + y, 36 + x, 62 + y, 1, p.hairShade);
  canvas.line(38 + x, 40 + y, 39 + x, 56 + y, 1, p.hairLight);
  drawAmiyaFringe(canvas, x, y, 'side');
  drawAmiyaSideLocks(canvas, x, y, 'side');
  drawAmiyaBrim(canvas, x, y, 'side');
  drawAmiyaBrows(canvas, x, y, mood, true);
  drawAmiyaEye(canvas, 68 + x, 53 + y, mood, true);
  canvas.set(79 + x, 58 + y, p.skinDeep);
  drawAmiyaMouth(canvas, 70 + x, 65 + y, mood);
  drawAmiyaBlush(canvas, 60 + x, 63 + y);
}

/** 短腿厚靴：靴底固定压到 y=92，走路只抬起另一只脚。 */
function drawAmiyaBoot(canvas, x, bottom, width, height) {
  const p = AMIYA_PALETTE;
  canvas.rect(x - 1, bottom - height - 1, width + 2, height + 2, p.outline);
  canvas.rect(x, bottom - height, width, height, p.boot);
  canvas.rect(x, bottom - height, width, 2, p.bootLight);
  canvas.rect(x + 1, bottom - 2, width - 2, 1, p.hoodInner);
}

function drawAmiyaBodyFront(canvas, y, legPhase, back) {
  const p = AMIYA_PALETTE;
  const swingLeft = legPhase > 0 ? 2 : legPhase < 0 ? -1 : 0;
  const swingRight = legPhase < 0 ? 2 : legPhase > 0 ? -1 : 0;
  const liftLeft = legPhase > 0 ? 2 : 0;
  const liftRight = legPhase < 0 ? 2 : 0;
  const baseline = AMIYA.baseline;

  // 腿与厚靴
  canvas.rect(39 + swingLeft, 82 + y, 8, 6, p.robeDark);
  canvas.rect(50 + swingRight, 82 + y, 8, 6, p.robeDark);
  drawAmiyaBoot(canvas, 36 + swingLeft, baseline - liftLeft, 12, 7);
  drawAmiyaBoot(canvas, 49 + swingRight, baseline - liftRight, 12, 7);

  // 深蓝长袍：紫色滚边、前襟与腰带
  canvas.rect(30, 61 + y, 36, 22, p.outline);
  canvas.rect(31, 62 + y, 34, 20, p.robe);
  canvas.rect(31, 62 + y, 6, 20, p.robeLight);
  canvas.rect(59, 62 + y, 6, 20, p.robeLight);
  canvas.rect(31, 62 + y, 1, 20, p.robeDark);
  canvas.rect(64, 62 + y, 1, 20, p.robeDark);
  canvas.rect(35, 63 + y, 1, 17, p.trim);
  canvas.rect(60, 63 + y, 1, 17, p.trim);
  if (back) {
    canvas.polygon(
      [
        [36, 61 + y],
        [60, 61 + y],
        [57, 76 + y],
        [48, 80 + y],
        [39, 76 + y],
      ],
      p.hoodDark,
    );
    canvas.rect(44, 62 + y, 8, 13, p.hood);
    canvas.rect(46, 64 + y, 4, 9, p.hoodInnerDark);
    canvas.rect(45, 74 + y, 6, 2, p.trim);
  } else {
    canvas.polygon(
      [
        [40, 62 + y],
        [56, 62 + y],
        [48, 77 + y],
      ],
      p.shirt,
    );
    canvas.polygon(
      [
        [44, 62 + y],
        [52, 62 + y],
        [48, 72 + y],
      ],
      p.hoodInnerDark,
    );
    canvas.rect(46, 66 + y, 4, 2, p.rune);
    canvas.rect(47, 69 + y, 2, 3, p.trimLight);
  }

  // 腰带与紫色宝石扣
  canvas.rect(31, 78 + y, 34, 4, p.belt);
  canvas.rect(45, 78 + y, 6, 4, p.rune);
  canvas.rect(47, 79 + y, 2, 2, p.hoodInnerLight);

  // 手臂：深蓝长袖与露出的手
  canvas.rect(20, 64 + y, 11, 18, p.outline);
  canvas.rect(21, 65 + y, 9, 16, p.robe);
  canvas.rect(21, 65 + y, 1, 14, p.trim);
  canvas.rect(23, 78 + y, 6, 5, p.skin);
  canvas.rect(65, 64 + y, 11, 18, p.outline);
  canvas.rect(66, 65 + y, 9, 16, p.robe);
  canvas.rect(74, 65 + y, 1, 14, p.trim);
  canvas.rect(67, 78 + y, 6, 5, p.skin);
}

function drawAmiyaBodySide(canvas, y, legPhase) {
  const p = AMIYA_PALETTE;
  const swingFront = legPhase > 0 ? 2 : legPhase < 0 ? -2 : 0;
  const swingBack = -swingFront;
  const liftFront = legPhase > 0 ? 2 : 0;
  const liftBack = legPhase < 0 ? 2 : 0;
  const baseline = AMIYA.baseline;

  canvas.rect(41 + swingBack, 82 + y, 8, 6, p.robeDark);
  canvas.rect(53 + swingFront, 82 + y, 8, 6, p.robeDark);
  drawAmiyaBoot(canvas, 39 + swingBack, baseline - liftBack, 12, 7);
  drawAmiyaBoot(canvas, 52 + swingFront, baseline - liftFront, 12, 7);

  canvas.rect(33, 61 + y, 34, 22, p.outline);
  canvas.rect(34, 62 + y, 32, 20, p.robe);
  canvas.rect(34, 62 + y, 6, 20, p.robeLight);
  canvas.rect(60, 62 + y, 5, 20, p.robeLight);
  canvas.rect(34, 62 + y, 1, 20, p.robeDark);
  canvas.rect(64, 62 + y, 1, 20, p.robeDark);
  canvas.rect(38, 63 + y, 1, 17, p.trim);
  canvas.rect(61, 63 + y, 1, 17, p.trim);
  canvas.rect(34, 61 + y, 10, 3, p.hoodDark);
  canvas.rect(34, 78 + y, 32, 4, p.belt);
  canvas.rect(42, 78 + y, 5, 4, p.rune);

  // 前伸手臂与手
  canvas.rect(52, 65 + y, 17, 15, p.outline);
  canvas.rect(53, 66 + y, 15, 13, p.robe);
  canvas.rect(53, 66 + y, 1, 11, p.trim);
  canvas.rect(63, 77 + y, 6, 5, p.skin);
}

/** 蓝紫术式火球：紫色光晕、火舌与四角星，尺寸不超过 10px 半径。 */
function drawAmiyaOrb(canvas, cx, cy, hot) {
  const p = AMIYA_PALETTE;
  canvas.blendEllipse(cx, cy, 9, 9, p.orb, 0.2);
  const flames = hot
    ? [
        [cx - 5, cy - 3, cx - 9, cy - 7],
        [cx + 4, cy - 4, cx + 8, cy - 9],
        [cx, cy - 5, cx + 1, cy - 10],
      ]
    : [
        [cx - 5, cy - 2, cx - 8, cy - 6],
        [cx + 4, cy - 3, cx + 8, cy - 6],
        [cx, cy - 4, cx, cy - 9],
      ];
  for (const [x0, y0, x1, y1] of flames) {
    canvas.line(x0, y0, x1, y1, 3, p.outline);
    canvas.line(x0, y0, x1, y1, 2, p.flame);
    canvas.set(x1, y1, p.flameLight);
  }
  canvas.ellipse(cx, cy, 6, 6, p.outline);
  canvas.ellipse(cx, cy, 5, 5, p.orbDark);
  canvas.ellipse(cx, cy, 4, 4, p.orb);
  canvas.ellipse(cx, cy - 1, 2.5, 2, p.orbLight);
  canvas.rect(cx - 1, cy - 6, 2, 12, p.orbLight);
  canvas.rect(cx - 6, cy - 1, 12, 2, p.orbLight);
  canvas.set(cx, cy, p.flameLight);
  if (hot) {
    canvas.rect(cx - 2, cy - 9, 4, 18, p.orbLight);
    canvas.rect(cx - 9, cy - 2, 18, 4, p.orbLight);
    canvas.set(cx - 10, cy, p.flameLight);
    canvas.set(cx + 10, cy, p.flameLight);
    canvas.set(cx, cy - 10, p.flameLight);
    canvas.set(cx, cy + 10, p.flameLight);
  }
}

/** 攻击帧的短促术式火花，四向对称，落在帧内 1px 边距以内。 */
function drawAmiyaBoltFlash(canvas, x, y) {
  const p = AMIYA_PALETTE;
  canvas.set(x, y - 5, p.flameLight);
  canvas.set(x + 4, y - 2, p.orbLight);
  canvas.set(x + 4, y + 3, p.orbLight);
  canvas.set(x + 2, y + 5, p.flameLight);
  canvas.set(x - 3, y + 4, p.orbLight);
  canvas.set(x - 5, y - 1, p.flameLight);
  canvas.set(x - 2, y - 4, p.orbLight);
}

/** 腰间小书：棕色封皮、浅色书页与紫色符文。 */
function drawAmiyaTome(canvas, x, y) {
  const p = AMIYA_PALETTE;
  canvas.rect(x - 1, y - 1, 14, 16, p.outline);
  canvas.rect(x, y, 12, 14, p.tomeDark);
  canvas.rect(x + 1, y + 1, 10, 12, p.tome);
  canvas.rect(x + 1, y + 1, 10, 1, p.tomePage);
  canvas.rect(x + 2, y + 3, 8, 1, p.tomePage);
  canvas.rect(x + 2, y + 5, 8, 1, p.tomePage);
  canvas.rect(x + 5, y + 7, 2, 2, p.trimLight);
  canvas.rect(x + 5, y + 10, 2, 2, p.hoodInnerLight);
}

/** 八向施法球位置：球心与 10px 光刺都留在 2–94 像素内。 */
const AMIYA_CAST_POSES = [
  { base: 'up', x: 48, y: 13 },
  { base: 'up', x: 68, y: 23 },
  { base: 'right', x: 84, y: 68 },
  { base: 'down', x: 70, y: 78 },
  { base: 'down', x: 48, y: 80 },
  { base: 'down', x: 26, y: 78 },
  { base: 'left', x: 12, y: 68 },
  { base: 'left', x: 28, y: 23 },
];

function amiyaLocalFrame(action, column) {
  if (action === 'walk') return column - 2;
  if (action === 'attack') return column - 6;
  if (action === 'idle') return column;
  return 0;
}

function drawAmiyaFrame(direction, action, column) {
  let frame = new Canvas(AMIYA.frameSize, AMIYA.frameSize);
  const p = AMIYA_PALETTE;
  const mirror = direction === 'left';
  const base = mirror ? 'right' : direction;
  const local = amiyaLocalFrame(action, column);
  const idle = action === 'idle';
  const walk = action === 'walk';
  const attack = action === 'attack';
  const hurt = action === 'hurt';
  const bob = idle || walk ? local % 2 : 0;
  const recoil = attack && local === 1 ? 2 : 0;
  const headX = hurt ? 2 : base === 'right' ? -recoil : recoil;
  const headY = (hurt ? 2 : 0) + bob;
  const bodyY = (hurt ? 1 : 0) + bob;
  const legPhase = walk ? [0, 1, 0, -1][local] ?? 0 : 0;
  const mood = hurt ? 'hurt' : attack ? 'attack' : 'idle';
  const showFocus = action !== 'cast';
  const earSway = idle ? (local % 2 ? 1 : 0) : 0;

  if (base === 'right') {
    drawAmiyaBodySide(frame, bodyY, legPhase);
    if (showFocus) {
      const orbX = attack ? (local === 0 ? 76 : 82) : 76;
      const orbY = attack ? (local === 0 ? 74 : 70) : 77 + bob;
      drawAmiyaOrb(frame, orbX, orbY, attack);
      if (attack) drawAmiyaBoltFlash(frame, orbX + 1, orbY - 3);
    }
    drawAmiyaHeadSide(frame, headX, headY, mood, earSway);
    if (showFocus) drawAmiyaTome(frame, 28 + headX, 71);
  } else {
    const back = base === 'up';
    drawAmiyaBodyFront(frame, bodyY, legPhase, back);
    drawAmiyaHeadFront(frame, headX, headY, mood, back, earSway);
    if (showFocus) {
      // 火球画在头部之后：长耳兜帽的侧摆不会挡住手里的术式。
      drawAmiyaTome(frame, (back ? 63 : 16) + headX, 71);
      const orbX = attack ? (local === 0 ? 72 : 80) : 76;
      const orbY = attack ? (local === 0 ? 72 : 66) : 73 + bob;
      drawAmiyaOrb(frame, orbX, orbY, attack);
      if (attack) drawAmiyaBoltFlash(frame, orbX + 1, orbY - 3);
    }
  }

  if (hurt) {
    // 受击：蓝紫术式碎片 + 后仰位移
    frame.rect(11, 30, 2, 5, p.flameLight);
    frame.rect(8, 36, 4, 2, p.orbLight);
    frame.rect(82, 26, 2, 4, p.flameLight);
    frame.rect(85, 32, 3, 2, p.orb);
  }

  if (mirror) {
    const mirrored = new Canvas(AMIYA.frameSize, AMIYA.frameSize);
    mirrored.blit(frame, 0, 0, true);
    frame = mirrored;
  }

  if (action === 'cast') {
    // 施法球坐标按最终屏幕朝向定义，镜像之后再叠加。
    const pose = AMIYA_CAST_POSES[column];
    drawAmiyaOrb(frame, pose.x, pose.y, true);
    drawAmiyaBoltFlash(frame, pose.x + 3, pose.y - 3);
  }

  return frame;
}

function drawAmiya() {
  const sheet = new Canvas(
    AMIYA.frameSize * AMIYA.columns,
    AMIYA.frameSize * AMIYA.rows,
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
    'attack',
    'hurt',
  ];
  directionRows.forEach((direction, row) => {
    for (let column = 0; column < AMIYA.columns; column += 1) {
      const frame = drawAmiyaFrame(direction, frameActions[column], column);
      sheet.blit(frame, column * AMIYA.frameSize, row * AMIYA.frameSize);
    }
  });
  for (let column = 0; column < AMIYA_CAST_POSES.length; column += 1) {
    const baseFrame = drawAmiyaFrame(AMIYA_CAST_POSES[column].base, 'cast', column);
    sheet.blit(baseFrame, column * AMIYA.frameSize, 4 * AMIYA.frameSize);
  }
  sheet.save('public/assets/sprites/player-amiya.png');
}

// ---------- 骑士 Q 版精灵表 ----------
//
// 与爆破手/术士共用 V0.2 的 96×96、9 列 × 5 行布局：
//   列 0-1 待机、2-5 行走、6-7 攻击、8 受击；
//   行 0 下、1 右、2 上、3 左（左向由右向整帧镜像）；
//   行 4 为八向施法指向帧：北、东北、东、东南、南、西南、西、西北。
// 造型基准：docs/design/v0.2/art/heroes-concept.png 的 KNIGHT ——
// 白金短发、小型金色角状头饰、白金色板甲与橙色纹样、大盾、短靴；
// 盾牌立在身体一侧、不遮脸，视觉大头不扩大 12 像素碰撞半径。
// 脚底锚点 y=92，四边至少留 1px 透明，场内按 0.7 缩放显示约 67 逻辑像素。

const KNIGHT = {
  frameSize: DEMO.frameSize,
  columns: DEMO.columns,
  rows: DEMO.rows,
  baseline: DEMO.baseline,
};

const SARIA_PALETTE = {
  outline: color('#1d1820'),
  outlineSoft: color('#332c34'),
  hair: color('#ece3d2'),
  hairLight: color('#fdf8ec'),
  hairShade: color('#c9bca4'),
  hairDark: color('#8d8066'),
  skin: color('#f8dcc2'),
  skinShade: color('#e5b994'),
  skinDeep: color('#c08e6a'),
  eyeWhite: color('#fff8ea'),
  iris: color('#e3a03f'),
  irisLight: color('#ffd88c'),
  irisDark: color('#a3611b'),
  pupil: color('#241a12'),
  blush: color('#e99b8f'),
  horn: color('#e7b64f'),
  hornLight: color('#ffe38f'),
  hornShade: color('#a97a24'),
  armor: color('#eef0f3'),
  armorLight: color('#ffffff'),
  armorShade: color('#c6ccd4'),
  armorDark: color('#8d959f'),
  cloth: color('#2b2d36'),
  clothLight: color('#454854'),
  trim: color('#dd9a33'),
  trimLight: color('#ffcf72'),
  trimDark: color('#9a661a'),
  belt: color('#202129'),
  boot: color('#33313a'),
  bootLight: color('#57535f'),
  shield: color('#efe6cf'),
  shieldLight: color('#fff9ea'),
  shieldDark: color('#b6a684'),
  shieldRim: color('#d9a443'),
  shieldRimDark: color('#9a6d1c'),
  emblem: color('#e08a2e'),
  emblemLight: color('#ffc069'),
};

/** 以头部中心镜像左半形状；正面/背面头部中心为 x=48。 */
function knightMirror(points, centerX = 48) {
  return points.map(([x, y]) => [2 * centerX - x, y]);
}

/** 小型金色角状头饰：细长上扬 + 一个短侧枝；尖端离帧边至少 2px。 */
function drawSariaHorns(canvas, x, y, mode, sway = 0) {
  const p = SARIA_PALETTE;
  const blade = [
    [39, 30],
    [34, 22],
    [30, 13],
    [27, 5],
    [31, 3],
    [35, 10],
    [39, 18],
    [43, 26],
  ];
  const prong = [
    [34, 19],
    [28, 15],
    [25, 9],
    [29, 10],
    [34, 16],
  ];
  const drawGold = (shape, fill, tip) => {
    canvas.polygonOutline(shape, p.outline, 1);
    canvas.polygon(shape, fill);
    canvas.set(tip[0], tip[1], p.hornLight);
  };

  if (mode === 'side') {
    // 右向：远侧头饰压暗，只在后脑露一角；近侧完整并随待机轻摆。
    const far = [
      [47 + x, 25 + y],
      [42 + x, 19 + y],
      [39 + x, 12 + y],
      [42 + x, 11 + y],
      [46 + x, 17 + y],
      [50 + x, 24 + y],
    ];
    drawGold(far, p.hornShade, [40 + x, 12 + y]);
    const near = blade.map(([px, py]) => [px + 3 + x + sway, py + y]);
    const nearProng = prong.map(([px, py]) => [px + 3 + x + sway, py + y]);
    drawGold(near, p.horn, [34 + x + sway, 3 + y]);
    drawGold(nearProng, p.horn, [28 + x + sway, 10 + y]);
    return;
  }

  const back = mode === 'back';
  drawGold(
    blade.map(([px, py]) => [px + x, py + y]),
    back ? p.hornShade : p.horn,
    [31 + x, 3 + y],
  );
  drawGold(
    prong.map(([px, py]) => [px + x, py + y]),
    back ? p.hornShade : p.horn,
    [28 + x, 10 + y],
  );
  drawGold(
    knightMirror(blade).map(([px, py]) => [px + x, py + y]),
    back ? p.hornShade : p.horn,
    [65 + x, 3 + y],
  );
  drawGold(
    knightMirror(prong).map(([px, py]) => [px + x, py + y]),
    back ? p.hornShade : p.horn,
    [68 + x, 10 + y],
  );
}

function drawSariaHairCap(canvas, cx, cy, rx, ry) {
  const p = SARIA_PALETTE;
  canvas.ellipse(cx, cy, rx + 1.5, ry + 1.5, p.outline);
  canvas.ellipse(cx, cy, rx, ry, p.hair);
  canvas.ellipse(cx, cy - ry * 0.32, rx * 0.78, ry * 0.34, p.hairLight);
  canvas.ellipse(cx + rx * 0.5, cy + ry * 0.24, rx * 0.3, ry * 0.48, p.hairShade);
  canvas.ellipse(cx - rx * 0.55, cy + ry * 0.16, rx * 0.26, ry * 0.42, p.hairShade);
}

/** 短发侧束只到下颌，让白金色的头型保持利落。 */
function drawSariaSideLocks(canvas, x, y, mode) {
  const p = SARIA_PALETTE;
  const lock = [
    [24, 36],
    [30, 38],
    [30, 48],
    [27, 57],
    [22, 60],
    [17, 55],
    [18, 44],
  ];
  const right = knightMirror(lock);
  const shapes = mode === 'side' ? [lock] : [lock, right];
  for (const shape of shapes) {
    const moved = shape.map(([px, py]) => [px + x, py + y]);
    canvas.polygonOutline(moved, p.outline, 1);
    canvas.polygon(moved, p.hair);
    canvas.line(22 + x, 42 + y, 24 + x, 55 + y, 1, p.hairShade);
  }
  if (mode !== 'side') canvas.line(74 + x, 42 + y, 72 + x, 55 + y, 1, p.hairShade);
}

function drawSariaFringe(canvas, x, y, mode) {
  if (mode === 'back') return;
  const p = SARIA_PALETTE;
  const bands =
    mode === 'side'
      ? [
          [40, 46, 35],
          [45, 50, 32],
          [49, 54, 36],
          [53, 57, 33],
          [57, 61, 37],
        ]
      : [
          [22, 28, 40],
          [27, 33, 35],
          [32, 38, 41],
          [37, 43, 36],
          [42, 48, 41],
          [47, 53, 36],
          [52, 58, 40],
          [57, 63, 35],
          [62, 69, 39],
        ];
  for (const [x0, x1, bottom] of bands) {
    canvas.rect(x0 + x, 23 + y, x1 - x0, bottom - 23, p.hair);
    canvas.rect(x0 + x, bottom - 1 + y, x1 - x0, 1, p.hairShade);
  }
  canvas.rect(26 + x, 24 + y, 6, 1, p.hairLight);
  canvas.rect(42 + x, 24 + y, 7, 1, p.hairLight);
  canvas.rect(58 + x, 24 + y, 5, 1, p.hairLight);
  canvas.line(32 + x, 23 + y, 30 + x, 32 + y, 1, p.hairShade);
  canvas.line(48 + x, 23 + y, 50 + x, 31 + y, 1, p.hairShade);
  // 金色小发扣：与角状头饰同色的第二识别点。
  canvas.rect(60 + x, 27 + y, 5, 2, p.horn);
  canvas.rect(61 + x, 27 + y, 3, 1, p.hornLight);
}

/** 琥珀色大眼 + 压低的眼睑与眉，表达自信而敦实的气质。 */
function drawSariaEye(canvas, cx, cy, mood, big = false) {
  const p = SARIA_PALETTE;
  if (mood === 'hurt') {
    canvas.line(cx - 5, cy - 4, cx + 5, cy + 4, 2, p.outline);
    canvas.line(cx - 5, cy + 4, cx + 5, cy - 4, 2, p.outline);
    return;
  }
  const wide = mood === 'attack';
  const grow = big ? 1 : 0;
  canvas.ellipse(cx, cy, 7 + grow, 7 + grow, p.outline);
  canvas.ellipse(cx, cy, 5.8 + grow, 5.8 + grow, p.eyeWhite);
  canvas.ellipse(cx, cy + 1.2, 4.8 + grow, 4.6 + grow, p.iris);
  canvas.ellipse(cx, cy + 2.4, 3.6 + grow, 2.4 + grow * 0.5, p.irisLight);
  canvas.rect(cx - 1, cy + 1 - (wide ? 1 : 0), 2, 4 + (wide ? 1 : 0) + grow, p.pupil);
  canvas.rect(cx - 3, cy - 1, 1, 2 + grow, p.eyeWhite);
  canvas.rect(cx + 2, cy + 3, 1, 1, p.irisDark);
  // 半睁的上眼睑压住虹膜上缘；攻击时抬开，受击时已在上面提前返回。
  const lidY = wide ? cy - 7 : cy - 6;
  canvas.rect(cx - 7 - grow, lidY, 14 + grow * 2, wide ? 1 : 3, p.outline);
  if (!wide) {
    canvas.rect(cx - 6 - grow, lidY + 3, 12 + grow * 2, 1, p.skinShade);
    const inner = cx > 48 ? cx - 8 : cx + 8;
    canvas.set(inner, lidY + 3, p.outline);
  }
}

function drawSariaBrows(canvas, x, y, mood, side = false) {
  const p = SARIA_PALETTE;
  const tilt = mood === 'attack' ? 3 : 2;
  if (side) {
    canvas.line(60 + x, 43 + y, 72 + x, 43 + y + tilt, 2, p.hairDark);
    return;
  }
  canvas.line(30 + x, 43 + y, 40 + x, 43 + y + tilt, 2, p.hairDark);
  canvas.line(66 + x, 43 + y, 56 + x, 43 + y + tilt, 2, p.hairDark);
}

function drawSariaMouth(canvas, cx, cy, mood) {
  const p = SARIA_PALETTE;
  if (mood === 'attack') {
    canvas.ellipse(cx, cy, 2.4, 2.8, p.outline);
    canvas.rect(cx - 1, cy + 1, 2, 1, p.skinDeep);
    return;
  }
  if (mood === 'hurt') {
    canvas.set(cx - 2, cy + 1, p.outline);
    canvas.set(cx - 1, cy, p.outline);
    canvas.set(cx, cy + 1, p.outline);
    canvas.set(cx + 1, cy, p.outline);
    canvas.set(cx + 2, cy + 1, p.outline);
    return;
  }
  // 自信的短笑：嘴角略微上扬。
  canvas.rect(cx - 2, cy, 5, 1, p.outline);
  canvas.set(cx + 3, cy - 1, p.outline);
  canvas.set(cx + 4, cy - 2, p.outline);
  canvas.set(cx - 1, cy + 1, p.skinDeep);
}

function drawSariaBlush(canvas, cx, cy) {
  const { blush } = SARIA_PALETTE;
  for (let i = 0; i < 3; i += 1) {
    canvas.line(cx + i * 3, cy + 2, cx + 2 + i * 3, cy, 1, blush);
  }
}

function drawSariaHeadFront(canvas, x, y, mood, back, sway = 0) {
  const p = SARIA_PALETTE;
  drawSariaHorns(canvas, x, y, back ? 'back' : 'front', sway);
  drawSariaHairCap(canvas, 48 + x, 39 + y, 29, 25);
  drawSariaSideLocks(canvas, x, y, 'front');
  if (back) {
    canvas.ellipse(48 + x, 51 + y, 22, 21, p.hairShade);
    canvas.ellipse(48 + x, 45 + y, 18, 15, p.hair);
    canvas.ellipse(48 + x, 41 + y, 13, 9, p.hairLight);
    canvas.line(48 + x, 31 + y, 48 + x, 55 + y, 1, p.hairDark);
    canvas.line(40 + x, 36 + y, 43 + x, 52 + y, 1, p.hairShade);
    canvas.line(56 + x, 36 + y, 53 + x, 52 + y, 1, p.hairShade);
    canvas.rect(44 + x, 58 + y, 8, 2, p.horn);
    canvas.rect(46 + x, 58 + y, 4, 1, p.hornLight);
    return;
  }
  canvas.ellipse(48 + x, 51 + y, 22, 20, p.outline);
  canvas.ellipse(48 + x, 51 + y, 21, 19, p.skin);
  canvas.ellipse(48 + x, 63 + y, 15, 5, p.skinShade);
  drawSariaFringe(canvas, x, y, 'front');
  drawSariaBrows(canvas, x, y, mood);
  drawSariaEye(canvas, 38 + x, 52 + y, mood);
  drawSariaEye(canvas, 58 + x, 52 + y, mood);
  canvas.set(48 + x, 58 + y, p.skinDeep);
  drawSariaMouth(canvas, 48 + x, 66 + y, mood);
  drawSariaBlush(canvas, 27 + x, 63 + y);
  drawSariaBlush(canvas, 60 + x, 63 + y);
}

function drawSariaHeadSide(canvas, x, y, mood, sway = 0) {
  const p = SARIA_PALETTE;
  drawSariaHorns(canvas, x, y, 'side', sway);
  drawSariaHairCap(canvas, 54 + x, 39 + y, 28, 25);
  // 后脑短发束垂到肩。
  const backLock = [
    [34, 31],
    [28, 36],
    [27, 47],
    [30, 57],
    [36, 60],
    [39, 51],
    [37, 40],
    [39, 33],
  ];
  const moved = backLock.map(([px, py]) => [px + x, py + y]);
  canvas.polygonOutline(moved, p.outline, 1);
  canvas.polygon(moved, p.hair);
  canvas.line(32 + x, 40 + y, 33 + x, 55 + y, 1, p.hairShade);
  canvas.ellipse(58 + x, 51 + y, 19, 19, p.outline);
  canvas.ellipse(58 + x, 51 + y, 18, 18, p.skin);
  canvas.ellipse(62 + x, 63 + y, 12, 5, p.skinShade);
  drawSariaFringe(canvas, x, y, 'side');
  drawSariaBrows(canvas, x, y, mood, true);
  drawSariaEye(canvas, 66 + x, 52 + y, mood, true);
  canvas.set(76 + x, 58 + y, p.skinDeep);
  drawSariaMouth(canvas, 70 + x, 66 + y, mood);
  drawSariaBlush(canvas, 58 + x, 63 + y);
}

/** 短靴：靴底固定压到 y=92；走路只抬起另一只脚。 */
function drawSariaBoot(canvas, x, bottom, width, height) {
  const p = SARIA_PALETTE;
  canvas.rect(x - 1, bottom - height - 1, width + 2, height + 2, p.outline);
  canvas.rect(x, bottom - height, width, height, p.boot);
  canvas.rect(x, bottom - height, width, 2, p.armorShade);
  canvas.rect(x + 1, bottom - 2, width - 2, 1, p.trimDark);
}

function drawSariaBodyFront(canvas, y, legPhase, back) {
  const p = SARIA_PALETTE;
  const swingLeft = legPhase > 0 ? 2 : legPhase < 0 ? -1 : 0;
  const swingRight = legPhase < 0 ? 2 : legPhase > 0 ? -1 : 0;
  const liftLeft = legPhase > 0 ? 2 : 0;
  const liftRight = legPhase < 0 ? 2 : 0;
  const baseline = KNIGHT.baseline;

  // 短腿与短靴
  canvas.rect(37 + swingLeft, 82 + y, 8, 7, p.cloth);
  canvas.rect(51 + swingRight, 82 + y, 8, 7, p.cloth);
  drawSariaBoot(canvas, 34 + swingLeft, baseline - liftLeft, 13, 7);
  drawSariaBoot(canvas, 49 + swingRight, baseline - liftRight, 13, 7);

  // 黑色内衬 + 白金色板甲 + 橙色中缝
  canvas.rect(30, 63 + y, 36, 21, p.outline);
  canvas.rect(31, 64 + y, 34, 19, p.cloth);
  canvas.rect(32, 64 + y, 32, 15, p.armor);
  canvas.rect(32, 64 + y, 32, 2, p.armorLight);
  canvas.rect(32, 77 + y, 32, 2, p.armorShade);
  canvas.rect(45, 64 + y, 6, 15, p.armorShade);
  canvas.rect(47, 65 + y, 2, 13, p.trim);
  canvas.rect(47, 65 + y, 1, 13, p.trimLight);
  canvas.rect(31, 81 + y, 34, 3, p.belt);
  canvas.rect(45, 81 + y, 6, 3, p.trim);

  // 大肩甲
  canvas.rect(17, 63 + y, 13, 11, p.outline);
  canvas.rect(18, 64 + y, 11, 9, p.armorLight);
  canvas.rect(18, 70 + y, 11, 3, p.armorShade);
  canvas.rect(18, 71 + y, 11, 2, p.trim);
  canvas.rect(66, 63 + y, 13, 11, p.outline);
  canvas.rect(67, 64 + y, 11, 9, p.armorLight);
  canvas.rect(67, 70 + y, 11, 3, p.armorShade);
  canvas.rect(67, 71 + y, 11, 2, p.trim);

  if (back) {
    // 背面：金色十字背纹
    canvas.rect(42, 66 + y, 12, 3, p.trim);
    canvas.rect(46, 66 + y, 4, 12, p.trim);
    canvas.rect(47, 67 + y, 2, 10, p.trimLight);
  } else {
    canvas.rect(37, 68 + y, 6, 7, p.armorLight);
    canvas.rect(53, 68 + y, 6, 7, p.armorLight);
    canvas.rect(37, 74 + y, 6, 1, p.armorShade);
    canvas.rect(53, 74 + y, 6, 1, p.armorShade);
  }

  // 护腕与手
  canvas.rect(20, 73 + y, 10, 10, p.outline);
  canvas.rect(21, 74 + y, 8, 8, p.armor);
  canvas.rect(21, 79 + y, 8, 2, p.trimDark);
  canvas.rect(66, 73 + y, 10, 10, p.outline);
  canvas.rect(67, 74 + y, 8, 8, p.armor);
  canvas.rect(67, 79 + y, 8, 2, p.trimDark);
}

function drawSariaBodySide(canvas, y, legPhase) {
  const p = SARIA_PALETTE;
  const swingFront = legPhase > 0 ? 2 : legPhase < 0 ? -2 : 0;
  const swingBack = -swingFront;
  const liftFront = legPhase > 0 ? 2 : 0;
  const liftBack = legPhase < 0 ? 2 : 0;
  const baseline = KNIGHT.baseline;

  canvas.rect(39 + swingBack, 82 + y, 8, 7, p.cloth);
  canvas.rect(53 + swingFront, 82 + y, 8, 7, p.cloth);
  drawSariaBoot(canvas, 37 + swingBack, baseline - liftBack, 13, 7);
  drawSariaBoot(canvas, 51 + swingFront, baseline - liftFront, 13, 7);

  canvas.rect(33, 63 + y, 35, 21, p.outline);
  canvas.rect(34, 64 + y, 33, 19, p.cloth);
  canvas.rect(35, 64 + y, 31, 15, p.armor);
  canvas.rect(35, 64 + y, 31, 2, p.armorLight);
  canvas.rect(35, 77 + y, 31, 2, p.armorShade);
  canvas.rect(50, 64 + y, 1, 15, p.trim);
  canvas.rect(34, 81 + y, 33, 3, p.belt);
  canvas.rect(46, 81 + y, 6, 3, p.trim);

  // 近侧肩甲
  canvas.rect(33, 63 + y, 13, 11, p.outline);
  canvas.rect(34, 64 + y, 11, 9, p.armorLight);
  canvas.rect(34, 70 + y, 11, 3, p.armorShade);
  canvas.rect(34, 71 + y, 11, 2, p.trim);

  // 前伸持盾的手臂与背后的短手臂
  canvas.rect(58, 66 + y, 13, 11, p.outline);
  canvas.rect(59, 67 + y, 11, 9, p.armor);
  canvas.rect(59, 73 + y, 11, 3, p.trimDark);
  canvas.rect(26, 68 + y, 9, 10, p.outline);
  canvas.rect(27, 69 + y, 7, 8, p.cloth);
  canvas.rect(27, 74 + y, 7, 2, p.trim);
}

/** 短剑：正面握在持盾手的对侧，剑尖低垂，始终留在帧内。 */
function drawSariaSwordFront(canvas, x, y) {
  const p = SARIA_PALETTE;
  const blade = [
    [27 + x, 79 + y],
    [23 + x, 81 + y],
    [12 + x, 89 + y],
    [10 + x, 87 + y],
    [21 + x, 77 + y],
    [25 + x, 75 + y],
  ];
  canvas.polygonOutline(blade, p.outline, 1);
  canvas.polygon(blade, p.armorLight);
  canvas.line(24 + x, 79 + y, 12 + x, 88 + y, 1, p.armorShade);
  canvas.rect(22 + x, 74 + y, 8, 2, p.outline);
  canvas.rect(23 + x, 74 + y, 6, 1, p.horn);
  canvas.rect(26 + x, 71 + y, 3, 4, p.outline);
  canvas.rect(27 + x, 72 + y, 1, 3, p.hornShade);
}

/** 侧向：短剑收在身后，只露出剑尖与护手。 */
function drawSariaSwordSide(canvas, x, y) {
  const p = SARIA_PALETTE;
  const blade = [
    [33 + x, 79 + y],
    [29 + x, 82 + y],
    [16 + x, 89 + y],
    [14 + x, 87 + y],
    [27 + x, 77 + y],
    [31 + x, 75 + y],
  ];
  canvas.polygonOutline(blade, p.outline, 1);
  canvas.polygon(blade, p.armorLight);
  canvas.line(30 + x, 79 + y, 17 + x, 88 + y, 1, p.armorShade);
  canvas.rect(30 + x, 73 + y, 6, 2, p.outline);
  canvas.rect(31 + x, 73 + y, 4, 1, p.horn);
}

/** 大盾：金色包边 + 米白盾面 + 橙色十字；盾面立在身体一侧，不遮脸。 */
function drawSariaShield(canvas, cx, cy, scale = 1, hot = false) {
  const p = SARIA_PALETTE;
  const hw = 12 * scale;
  const hh = 17 * scale;
  const outer = [
    [cx - hw, cy - hh],
    [cx + hw, cy - hh],
    [cx + hw + 1, cy - hh * 0.35],
    [cx + hw * 0.55, cy + hh * 0.55],
    [cx, cy + hh + 1],
    [cx - hw * 0.55, cy + hh * 0.55],
    [cx - hw - 1, cy - hh * 0.35],
  ];
  if (hot) {
    canvas.blendEllipse(cx, cy, hw + 1, hh + 1, p.trimLight, 0.28);
    canvas.polygonOutline(outer, p.trimLight, 1);
  }
  canvas.polygonOutline(outer, p.outline, 1);
  canvas.polygon(outer, p.shieldRimDark);
  const rim = [
    [cx - hw + 1, cy - hh + 1],
    [cx + hw - 1, cy - hh + 1],
    [cx + hw, cy - hh * 0.3],
    [cx + hw * 0.5, cy + hh * 0.5],
    [cx, cy + hh],
    [cx - hw * 0.5, cy + hh * 0.5],
    [cx - hw, cy - hh * 0.3],
  ];
  canvas.polygon(rim, p.shieldRim);
  const face = [
    [cx - hw + 3, cy - hh + 3],
    [cx + hw - 3, cy - hh + 3],
    [cx + hw - 2, cy - hh * 0.25],
    [cx + hw * 0.42, cy + hh * 0.45],
    [cx, cy + hh - 3],
    [cx - hw * 0.42, cy + hh * 0.45],
    [cx - hw + 2, cy - hh * 0.25],
  ];
  canvas.polygon(face, p.shield);
  canvas.polygon(
    [
      [cx - hw + 3, cy - hh + 3],
      [cx + hw - 3, cy - hh + 3],
      [cx + hw - 4, cy - hh + 6],
      [cx - hw + 4, cy - hh + 6],
    ],
    p.shieldLight,
  );
  // 橙色十字纹与中心高光。
  const armHalf = Math.max(3, Math.round(hw * 0.46));
  canvas.rect(cx - 1, cy - Math.round(hh * 0.52), 3, Math.round(hh * 0.95), p.emblem);
  canvas.rect(cx - armHalf, cy - 2, armHalf * 2, 3, p.emblem);
  canvas.rect(cx, cy - Math.round(hh * 0.44), 1, Math.round(hh * 0.35), p.emblemLight);
  canvas.rect(cx - 2, cy - 1, 5, 1, p.emblemLight);
  // 盾面下缘的浅色磨损高光。
  canvas.rect(cx - Math.round(hw * 0.42), cy + Math.round(hh * 0.34), 6, 1, p.shieldDark);
  canvas.rect(cx + 3, cy + Math.round(hh * 0.18), 4, 1, p.shieldDark);
  if (hot) {
    canvas.set(cx - hw - 2, cy - hh + 2, p.trimLight);
    canvas.set(cx + hw + 2, cy - hh + 2, p.trimLight);
    canvas.set(cx, cy - hh - 2, p.trimLight);
  }
}

/** 盾击命中的金色冲击星；最大外扩 5px，调用点已按帧内边距收好。 */
function drawSariaBashFlash(canvas, x, y) {
  const p = SARIA_PALETTE;
  canvas.set(x, y - 5, p.trimLight);
  canvas.set(x + 4, y - 2, p.emblemLight);
  canvas.set(x + 4, y + 3, p.trimLight);
  canvas.set(x + 2, y + 5, p.emblemLight);
  canvas.set(x - 3, y + 4, p.trimLight);
  canvas.set(x - 5, y - 1, p.emblemLight);
  canvas.set(x - 2, y - 4, p.trimLight);
  canvas.rect(x - 1, y - 1, 2, 2, p.trim);
}

/** 八向施法：小一号的盾面按最终屏幕方向举起，虚线拖尾指回身体。 */
const SARIA_CAST_POSES = [
  { base: 'up', x: 48, y: 15 },
  { base: 'up', x: 72, y: 24 },
  { base: 'right', x: 82, y: 66 },
  { base: 'down', x: 70, y: 78 },
  { base: 'down', x: 48, y: 80 },
  { base: 'down', x: 26, y: 78 },
  { base: 'left', x: 14, y: 66 },
  { base: 'left', x: 24, y: 24 },
];

function drawSariaCastTrail(canvas, x, y) {
  const p = SARIA_PALETTE;
  for (const t of [0.25, 0.45, 0.65]) {
    const px = Math.round(48 + (x - 48) * t);
    const py = Math.round(58 + (y - 58) * t);
    canvas.set(px, py, p.trimLight);
    canvas.set(px + 1, py, p.trim);
  }
}

function knightLocalFrame(action, column) {
  if (action === 'walk') return column - 2;
  if (action === 'attack') return column - 6;
  if (action === 'idle') return column;
  return 0;
}

function drawSariaFrame(direction, action, column) {
  let frame = new Canvas(KNIGHT.frameSize, KNIGHT.frameSize);
  const p = SARIA_PALETTE;
  const mirror = direction === 'left';
  const base = mirror ? 'right' : direction;
  const local = knightLocalFrame(action, column);
  const idle = action === 'idle';
  const walk = action === 'walk';
  const attack = action === 'attack';
  const hurt = action === 'hurt';
  const bob = idle || walk ? local % 2 : 0;
  const recoil = attack && local === 1 ? 2 : 0;
  const headX = hurt ? 2 : base === 'right' ? -recoil : recoil;
  const headY = (hurt ? 2 : 0) + bob;
  const bodyY = (hurt ? 1 : 0) + bob;
  const legPhase = walk ? ([0, 1, 0, -1][local] ?? 0) : 0;
  const mood = hurt ? 'hurt' : attack ? 'attack' : 'idle';
  const showShield = action !== 'cast';
  const sway = idle ? (local % 2 ? 1 : 0) : 0;
  const bash = attack && local === 1;

  if (base === 'right') {
    drawSariaSwordSide(frame, 0, 0);
    drawSariaBodySide(frame, bodyY, legPhase);
    if (showShield) {
      // 盾击第二帧把盾面沿面朝方向前推 5px 并点亮，方向一眼可辨。
      const shieldX = attack ? (local === 0 ? 69 : 79) : 74;
      const shieldY = attack ? (local === 0 ? 71 : 67) : 70 + bob;
      drawSariaShield(frame, shieldX, shieldY, 1, bash);
      if (bash) drawSariaBashFlash(frame, 89, 58);
    }
    drawSariaHeadSide(frame, headX, headY, mood, sway);
  } else {
    const back = base === 'up';
    drawSariaBodyFront(frame, bodyY, legPhase, back);
    drawSariaHeadFront(frame, headX, headY, mood, back, sway);
    if (showShield) {
      // 正面视角的盾击沿屏幕上下推出：南向下压盾面、闪光落在盾下缘；
      // 北向抬盾、闪光留在盾上缘。两向不能共用同一位移，否则盾击朝向无法区分。
      const shieldX = attack ? (local === 0 ? 73 : 80) : 79;
      if (back) {
        const shieldY = attack ? (local === 0 ? 71 : 68) : 71 + bob;
        drawSariaShield(frame, shieldX, shieldY, 1, bash);
        if (bash) drawSariaBashFlash(frame, 88, 54);
      } else {
        // cy=74 时盾底描边正好落在脚底基线 y=92，再下移就会破坏帧底。
        const shieldY = attack ? (local === 0 ? 71 : 74) : 71 + bob;
        drawSariaShield(frame, shieldX, shieldY, 1, bash);
        if (bash) drawSariaBashFlash(frame, 88, 84);
      }
    }
    drawSariaSwordFront(frame, 0, 0);
  }

  if (hurt) {
    // 受击：后仰位移 + 两侧金色/盾面碎片，左右镜像后仍可辨。
    frame.rect(9, 30, 2, 5, p.trimLight);
    frame.rect(6, 36, 4, 2, p.shieldLight);
    frame.rect(82, 26, 2, 4, p.trimLight);
    frame.rect(85, 32, 3, 2, p.trim);
  }

  if (mirror) {
    const mirrored = new Canvas(KNIGHT.frameSize, KNIGHT.frameSize);
    mirrored.blit(frame, 0, 0, true);
    frame = mirrored;
  }

  if (action === 'cast') {
    // 施法盾面坐标按最终屏幕朝向定义，镜像之后再叠加。
    const pose = SARIA_CAST_POSES[column];
    drawSariaCastTrail(frame, pose.x, pose.y);
    drawSariaShield(frame, pose.x, pose.y, 0.6, true);
    drawSariaBashFlash(frame, pose.x + 3, pose.y - 3);
  }

  return frame;
}

function drawSaria() {
  const sheet = new Canvas(
    KNIGHT.frameSize * KNIGHT.columns,
    KNIGHT.frameSize * KNIGHT.rows,
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
    'attack',
    'hurt',
  ];
  directionRows.forEach((direction, row) => {
    for (let column = 0; column < KNIGHT.columns; column += 1) {
      const frame = drawSariaFrame(direction, frameActions[column], column);
      sheet.blit(frame, column * KNIGHT.frameSize, row * KNIGHT.frameSize);
    }
  });
  for (let column = 0; column < SARIA_CAST_POSES.length; column += 1) {
    const baseFrame = drawSariaFrame(SARIA_CAST_POSES[column].base, 'cast', column);
    sheet.blit(baseFrame, column * KNIGHT.frameSize, 4 * KNIGHT.frameSize);
  }
  sheet.save('public/assets/sprites/player-saria.png');
}

// ---------- 战术家 Q 版精灵表 ----------
//
// 与爆破手/术士/骑士共用 V0.2 的 96×96、9 列 × 5 行布局：
//   列 0-1 待机、2-5 行走、6-7 攻击、8 受击；行 0-3 为下/右/上/左，行 4 为八向施法。
// 水形分身复用同一张脸与轮廓，场景再用水体透明度与脚下标记区分本体/主流形/副本。

/** 把 64 空间坐标按 1.5 倍映射到 96 帧；线宽保持像素感，不随坐标放大。 */
class ScaledBrush {
  constructor(canvas, scale) {
    this.canvas = canvas;
    this.scale = scale;
  }

  scalePoints(points) {
    return points.map(([x, y]) => [x * this.scale, y * this.scale]);
  }

  set(x, y, rgba) {
    this.canvas.set(x * this.scale, y * this.scale, rgba);
  }

  rect(x, y, width, height, rgba) {
    const x0 = Math.round(x * this.scale);
    const y0 = Math.round(y * this.scale);
    const x1 = Math.round((x + width) * this.scale);
    const y1 = Math.round((y + height) * this.scale);
    this.canvas.rect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0), rgba);
  }

  ellipse(cx, cy, radiusX, radiusY, rgba) {
    this.canvas.ellipse(
      cx * this.scale,
      cy * this.scale,
      radiusX * this.scale,
      radiusY * this.scale,
      rgba,
    );
  }

  blendEllipse(cx, cy, radiusX, radiusY, rgba, alpha) {
    this.canvas.blendEllipse(
      cx * this.scale,
      cy * this.scale,
      radiusX * this.scale,
      radiusY * this.scale,
      rgba,
      alpha,
    );
  }

  blend(x, y, rgba, alpha) {
    this.canvas.blend(x * this.scale, y * this.scale, rgba, alpha);
  }

  polygon(points, rgba) {
    this.canvas.polygon(this.scalePoints(points), rgba);
  }

  polygonOutline(points, rgba, thickness = 1) {
    this.canvas.polygonOutline(this.scalePoints(points), rgba, thickness);
  }

  line(x0, y0, x1, y1, thickness, rgba) {
    this.canvas.line(
      x0 * this.scale,
      y0 * this.scale,
      x1 * this.scale,
      y1 * this.scale,
      thickness,
      rgba,
    );
  }
}

const MUELSYSE_PALETTE = {
  outline: color('#16211f'),
  hair: color('#e2f6ee'),
  hairLight: color('#f7fffb'),
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
  // 好奇表情：待机时一侧眉梢抬高，另一侧保持平缓。
  const raise = mood === 'idle' ? 2 : 0;
  if (side) {
    canvas.line(36 + x, 27 + y - lift - raise, 45 + x, 26 + y - raise, 1, p.hairDark);
    return;
  }
  canvas.line(19 + x, 28 + y - lift, 26 + x, 28 + y - lift, 1, p.hairDark);
  canvas.line(45 + x, 27 + y - lift - raise, 38 + x, 26 + y - raise, 1, p.hairDark);
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
  // 好奇的微张小圆嘴：与攻击时的大张嘴、受击时的皱眉嘴区分开。
  canvas.rect(cx - 1, cy - 1, 3, 3, p.outline);
  canvas.rect(cx, cy, 1, 1, p.skinDeep);
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

  // 绿色短外套 + 白色衬衣前襟 + 黑色腰带，外套下摆停在腰线上。
  canvas.rect(17 + x, 41 + y, 30, 16, p.outline);
  canvas.rect(18 + x, 42 + y, 28, 14, p.white);
  canvas.rect(18 + x, 42 + y, 9, 14, p.green);
  canvas.rect(37 + x, 42 + y, 9, 14, p.green);
  canvas.rect(18 + x, 42 + y, 9, 2, p.greenLight);
  canvas.rect(37 + x, 42 + y, 9, 2, p.greenLight);
  canvas.rect(18 + x, 53 + y, 9, 3, p.greenDark);
  canvas.rect(37 + x, 53 + y, 9, 3, p.greenDark);
  canvas.rect(29 + x, 42 + y, 4, 11, p.white);
  canvas.rect(29 + x, 42 + y, 1, 11, p.whiteShade);
  canvas.rect(26 + x, 42 + y, 4, 3, p.cloth);
  canvas.rect(34 + x, 42 + y, 4, 3, p.cloth);
  canvas.rect(18 + x, 51 + y, 28, 2, p.belt);
  // 肩与短袖：绿色外套的肩线比衬衣更亮。
  canvas.rect(12 + x, 42 + y, 8, 8, p.outline);
  canvas.rect(13 + x, 43 + y, 6, 6, p.green);
  canvas.rect(13 + x, 43 + y, 6, 1, p.greenLight);
  canvas.rect(13 + x, 48 + y, 6, 1, p.greenDark);
  canvas.rect(44 + x, 42 + y, 8, 8, p.outline);
  canvas.rect(45 + x, 43 + y, 6, 6, p.green);
  canvas.rect(45 + x, 43 + y, 6, 1, p.greenLight);
  canvas.rect(45 + x, 48 + y, 6, 1, p.greenDark);
  if (back) {
    canvas.rect(20 + x, 43 + y, 24, 9, p.green);
    canvas.rect(26 + x, 44 + y, 12, 4, p.greenLight);
    canvas.rect(29 + x, 43 + y, 6, 3, p.whiteShade);
    canvas.rect(18 + x, 51 + y, 28, 2, p.belt);
    return;
  }
  canvas.rect(22 + x, 45 + y, 6, 2, p.greenLight);
  canvas.rect(36 + x, 45 + y, 6, 2, p.greenLight);
  canvas.rect(20 + x, 50 + y, 4, 1, p.greenDark);
  canvas.rect(40 + x, 50 + y, 4, 1, p.greenDark);
  canvas.rect(30 + x, 52 + y, 4, 2, p.green);
  // 短手臂与绿色袖口。
  canvas.rect(11 + x, 46 + y, 7, 10, p.outline);
  canvas.rect(12 + x, 47 + y, 5, 8, p.green);
  canvas.rect(12 + x, 53 + y, 5, 2, p.greenDark);
  canvas.rect(46 + x, 46 + y, 7, 10, p.outline);
  canvas.rect(47 + x, 47 + y, 5, 8, p.green);
  canvas.rect(47 + x, 53 + y, 5, 2, p.greenDark);
}

function drawMuelsyseBodySide(canvas, x, y, legPhase) {
  const p = MUELSYSE_PALETTE;
  const swing = legPhase * 3;
  drawMuelsyseBoot(canvas, 25 + x - swing, 57, 9, 4);
  drawMuelsyseBoot(canvas, 35 + x + swing, 57, 9, 4);
  canvas.rect(26 + x - swing, 53, 6, 4, p.cloth);
  canvas.rect(36 + x + swing, 53, 6, 4, p.cloth);

  // 侧面：绿色短外套覆盖躯干，前襟露出白色衬衣。
  canvas.rect(19 + x, 41 + y, 26, 16, p.outline);
  canvas.rect(20 + x, 42 + y, 24, 14, p.green);
  canvas.rect(20 + x, 42 + y, 24, 2, p.greenLight);
  canvas.rect(20 + x, 42 + y, 7, 14, p.white);
  canvas.rect(20 + x, 42 + y, 7, 2, p.whiteShade);
  canvas.rect(25 + x, 42 + y, 2, 11, p.greenDark);
  canvas.rect(21 + x, 51 + y, 23, 2, p.greenDark);
  canvas.rect(21 + x, 52 + y, 22, 2, p.belt);
  canvas.rect(23 + x, 52 + y, 3, 2, p.green);
  // 前臂：水形术式的手，袖口用外套绿色。
  canvas.rect(40 + x, 45 + y, 9, 9, p.outline);
  canvas.rect(41 + x, 46 + y, 7, 7, p.green);
  canvas.rect(41 + x, 46 + y, 7, 1, p.greenLight);
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

/** 攻击帧的水束：沿面朝方向推出，第二帧更远、更大，和待机一眼可分。 */
function drawMuelsyseAttackJet(canvas, base, local) {
  const p = MUELSYSE_PALETTE;
  const reach = local === 0 ? 0 : 2;
  if (base === 'right') {
    canvas.rect(48 + reach, 47, 8 + reach, 3, p.water);
    canvas.rect(49 + reach, 47, 6 + reach, 1, p.waterLight);
    drawMuelsyseDrop(canvas, 56 + reach, local === 0 ? 46 : 44, local === 0 ? 0.75 : 1, true);
    return;
  }
  if (base === 'up') {
    for (const t of [0.3, 0.55, 0.8]) {
      canvas.set(32 + Math.round(t * 2), 12 - Math.round(t * 5), p.waterLight);
    }
    drawMuelsyseDrop(canvas, local === 0 ? 32 : 34, local === 0 ? 8 : 7, 0.8, true);
    return;
  }
  for (const t of [0.3, 0.55, 0.8]) {
    canvas.set(32 - Math.round(t * 2), 46 + Math.round(t * 8), p.waterLight);
  }
  drawMuelsyseDrop(canvas, local === 0 ? 29 : 31, 54, 0.8, true);
}

function muelsyseLocalFrame(action, column) {
  if (action === 'walk') return column - 2;
  if (action === 'attack') return column - 6;
  if (action === 'idle') return column;
  return 0;
}

function drawMuelsyseFrame(direction, action, column) {
  let frame = new Canvas(MUELSYSE.frameSize, MUELSYSE.frameSize);
  const brush = new ScaledBrush(frame, MUELSYSE_SCALE);
  const p = MUELSYSE_PALETTE;
  const mirror = direction === 'left';
  const base = mirror ? 'right' : direction;
  const local = muelsyseLocalFrame(action, column);
  const mood = action === 'hurt' ? 'hurt' : action === 'attack' ? 'attack' : 'idle';
  const idle = action === 'idle';
  const walk = action === 'walk';
  const legPhase = walk ? [-1, 0, 1, 0][local % 4] : 0;
  const bob = idle ? local % 2 : walk ? (local % 2 === 0 ? 0 : 1) : 0;
  const headX = action === 'hurt' ? 2 : 0;
  const headY = (action === 'hurt' ? 1 : 0) + bob;
  const bodyY = action === 'hurt' ? 1 : bob;
  const sway = idle ? (local % 2 ? 1 : 0) : 0;
  const showDrop = action !== 'cast';

  if (base === 'right') {
    drawMuelsyseLongLocks(brush, -6, bob, 'side');
    drawMuelsyseBodySide(brush, 0, bodyY, legPhase);
    drawMuelsyseHeadSide(brush, headX, headY, mood, sway);
    if (showDrop) drawMuelsyseDrop(brush, 53, 26 + bob, 1, action === 'attack');
  } else {
    const back = base === 'up';
    drawMuelsyseBodyFront(brush, 0, bodyY, legPhase, back);
    drawMuelsyseHeadFront(brush, headX, headY, mood, back, sway);
    if (showDrop && !back) drawMuelsyseDrop(brush, 53, 47 + bob, 1, action === 'attack');
  }

  if (action === 'attack') drawMuelsyseAttackJet(brush, base, local);

  if (action === 'hurt') {
    brush.rect(9, 20, 1, 3, p.green);
    brush.rect(7, 24, 2, 1, p.waterLight);
    brush.rect(53, 18, 1, 2, p.green);
    brush.rect(55, 22, 1, 1, p.waterLight);
  }

  if (mirror) {
    const mirrored = new Canvas(MUELSYSE.frameSize, MUELSYSE.frameSize);
    mirrored.blit(frame, 0, 0, true);
    frame = mirrored;
  }

  if (action === 'cast') {
    // 球坐标按最终屏幕朝向定义，镜像后再叠加。
    const pose = MUELSYSE_CAST_POSES[column];
    for (const t of [0.25, 0.5, 0.75]) {
      const px = Math.round(pose.x + (32 - pose.x) * t);
      const py = Math.round(pose.y + (34 - pose.y) * t);
      brush.set(px, py, p.waterLight);
    }
    drawMuelsyseDrop(brush, pose.x, pose.y, 1.5, true);
  }

  return frame;
}

function drawMuelsyse() {
  const sheet = new Canvas(
    MUELSYSE.frameSize * MUELSYSE.columns,
    MUELSYSE.frameSize * MUELSYSE.rows,
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
    'attack',
    'hurt',
  ];
  directionRows.forEach((direction, row) => {
    for (let column = 0; column < MUELSYSE.columns; column += 1) {
      const frame = drawMuelsyseFrame(direction, frameActions[column], column);
      sheet.blit(frame, column * MUELSYSE.frameSize, row * MUELSYSE.frameSize);
    }
  });
  for (let column = 0; column < MUELSYSE_CAST_POSES.length; column += 1) {
    const pose = MUELSYSE_CAST_POSES[column];
    const baseFrame = drawMuelsyseFrame(pose.base, 'cast', column);
    sheet.blit(baseFrame, column * MUELSYSE.frameSize, 4 * MUELSYSE.frameSize);
  }
  sheet.save('public/assets/sprites/player-muelsyse.png');
}

drawFloor();
drawWallTile();
drawCoverTile();
drawDemolitionist();
drawAmiya();
drawSaria();
drawMuelsyse();
console.log('assets generated');
