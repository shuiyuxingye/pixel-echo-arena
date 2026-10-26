/** Small deterministic RGBA PNG codec + nearest-neighbour sprite assembly. No network/dependencies. */
import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const table = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++)
    n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function chunk(type, b) { const t = Buffer.from(type); const d = Buffer.concat([t, b]); let c = 0xffffffff; for (const v of d)
    c = table[(c ^ v) & 255] ^ (c >>> 8); const h = Buffer.alloc(4); h.writeUInt32BE(b.length); const e = Buffer.alloc(4); e.writeUInt32BE((c ^ 0xffffffff) >>> 0); return Buffer.concat([h, d, e]); }
export function canvas(w, h) { return { w, h, p: new Uint8Array(w * h * 4) }; }
export function readPng(path) { const b = readFileSync(path); let w, h, type, parts = []; for (let o = 8; o < b.length;) {
    let n = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + n);
    if (t === 'IHDR') {
        w = d.readUInt32BE(0);
        h = d.readUInt32BE(4);
        type = d[9];
        if (d[8] !== 8 || ![2, 6].includes(type) || d[12])
            throw Error('Expected RGB/RGBA8 non-interlaced PNG: ' + path);
    }
    if (t === 'IDAT')
        parts.push(d);
    o += n + 12;
} const ch = type === 6 ? 4 : 3, stride = w * ch, raw = inflateSync(Buffer.concat(parts)), out = canvas(w, h), rows = new Uint8Array(stride * h); for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
        let a = x >= ch ? rows[y * stride + x - ch] : 0, u = y ? rows[(y - 1) * stride + x] : 0, ul = y && x >= ch ? rows[(y - 1) * stride + x - ch] : 0, v = raw[y * (stride + 1) + 1 + x];
        if (f === 1)
            v += a;
        else if (f === 2)
            v += u;
        else if (f === 3)
            v += Math.floor((a + u) / 2);
        else if (f === 4) {
            let p = a + u - ul, pa = Math.abs(p - a), pu = Math.abs(p - u), pl = Math.abs(p - ul);
            v += pa <= pu && pa <= pl ? a : pu <= pl ? u : ul;
        }
        rows[y * stride + x] = v & 255;
    }
} for (let i = 0; i < w * h; i++) {
    out.p[i * 4] = rows[i * ch];
    out.p[i * 4 + 1] = rows[i * ch + 1];
    out.p[i * 4 + 2] = rows[i * ch + 2];
    out.p[i * 4 + 3] = ch === 4 ? rows[i * ch + 3] : 255;
} return out; }
/** Adaptive standard PNG row filters reduce bytes without changing a single rendered pixel. */
export function savePng(path, image) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(image.w, 0);
    header.writeUInt32BE(image.h, 4);
    header[8] = 8;
    header[9] = 6;
    const stride = image.w * 4;
    const raw = Buffer.alloc((stride + 1) * image.h);
    for (let y = 0; y < image.h; y++) {
        let bestScore = Infinity;
        let bestType = 0;
        let bestRow;
        for (const filter of [0, 1, 2, 4]) {
            const row = Buffer.alloc(stride);
            let score = 0;
            for (let x = 0; x < stride; x++) {
                const at = y * stride + x;
                const left = x >= 4 ? image.p[at - 4] : 0;
                const up = y > 0 ? image.p[at - stride] : 0;
                const upperLeft = y > 0 && x >= 4 ? image.p[at - stride - 4] : 0;
                let predictor = 0;
                if (filter === 1) predictor = left;
                if (filter === 2) predictor = up;
                if (filter === 4) {
                    const estimate = left + up - upperLeft;
                    const dl = Math.abs(estimate - left);
                    const du = Math.abs(estimate - up);
                    const dul = Math.abs(estimate - upperLeft);
                    predictor = dl <= du && dl <= dul ? left : du <= dul ? up : upperLeft;
                }
                const byte = (image.p[at] - predictor) & 255;
                row[x] = byte;
                score += Math.min(byte, 256 - byte);
            }
            if (score < bestScore) {
                bestScore = score;
                bestType = filter;
                bestRow = row;
            }
        }
        raw[y * (stride + 1)] = bestType;
        bestRow.copy(raw, y * (stride + 1) + 1);
    }
    // Pixel clusters sometimes compress better without predictors; select actual compressed size.
    const unfiltered = Buffer.alloc((stride + 1) * image.h);
    for (let y = 0; y < image.h; y++) {
        Buffer.from(image.p.buffer, image.p.byteOffset + y * stride, stride).copy(unfiltered, y * (stride + 1) + 1);
    }
    const adaptiveBytes = deflateSync(raw, { level: 9 });
    const plainBytes = deflateSync(unfiltered, { level: 9 });
    const compressed = adaptiveBytes.length < plainBytes.length ? adaptiveBytes : plainBytes;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', compressed),
        chunk('IEND', Buffer.alloc(0)),
    ]));
}
export function crop(a, x, y, w, h) { const b = canvas(w, h); for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
        let sx = Math.max(0, Math.min(a.w - 1, x + px)), sy = Math.max(0, Math.min(a.h - 1, y + py));
        b.p.set(a.p.subarray((sy * a.w + sx) * 4, (sy * a.w + sx) * 4 + 4), (py * w + px) * 4);
    } return b; }
export function cell(a, c, r, cols, rows) { const x = Math.round(a.w * c / cols), y = Math.round(a.h * r / rows); return crop(a, x, y, Math.round(a.w * (c + 1) / cols) - x, Math.round(a.h * (r + 1) / rows) - y); }
export function bounds(a) { let x0 = a.w, y0 = a.h, x1 = -1, y1 = -1; for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++)
        if (a.p[(y * a.w + x) * 4 + 3] > 100) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
        } if (x1 < 0)
    throw Error('Empty sprite'); return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }; }
export function resize(a, w, h, { quant = 8, alpha = true, brightness = 1 } = {}) { const b = canvas(w, h); for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
        let i = (Math.min(a.h - 1, Math.floor((y + .5) * a.h / h)) * a.w + Math.min(a.w - 1, Math.floor((x + .5) * a.w / w))) * 4, j = (y * w + x) * 4;
        for (let k = 0; k < 3; k++)
            b.p[j + k] = Math.min(255, Math.round(a.p[i + k] * brightness / quant) * quant);
        b.p[j + 3] = alpha ? (a.p[i + 3] > 100 ? 255 : 0) : 255;
    } return b; }
export function blit(dst, src, x, y, flip = false) { x = Math.round(x); y = Math.round(y); for (let py = 0; py < src.h; py++)
    for (let px = 0; px < src.w; px++) {
        let tx = x + px, ty = y + py;
        if (tx < 0 || tx >= dst.w || ty < 0 || ty >= dst.h)
            continue;
        let i = (py * src.w + (flip ? src.w - 1 - px : px)) * 4;
        if (src.p[i + 3])
            dst.p.set(src.p.subarray(i, i + 4), (ty * dst.w + tx) * 4);
    } }
export function fit(a, w, h, bottom = h - 3) { const bb = bounds(a), q = crop(a, bb.x, bb.y, bb.w, bb.h), s = Math.min((w - 6) / q.w, (h - 6) / q.h), small = resize(q, Math.round(q.w * s), Math.round(q.h * s)); const b = canvas(w, h); blit(b, small, (w - small.w) / 2, bottom - small.h + 1); return b; }
export function rect(a, x, y, w, h, c) { for (let py = Math.max(0, y); py < Math.min(a.h, y + h); py++)
    for (let px = Math.max(0, x); px < Math.min(a.w, x + w); px++) {
        const i = (py * a.w + px) * 4;
        a.p.set(c.length === 4 ? c : [...c, 255], i);
    } }
