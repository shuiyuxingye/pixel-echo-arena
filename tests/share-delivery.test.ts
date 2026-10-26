import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 分享包交付断言：单 HTML / ZIP 体积、资源内联、开发入口排除。
 *
 * 依赖仓库内提交的 `output/share/` 产物；`npm run build:share` 与
 * `python3 tools/docs/package_delivery.py` 会重新生成它们。
 */

const ROOT = process.cwd();
const SHARE_DIR = resolve(ROOT, 'output/share');
const REPORT_PATH = resolve(SHARE_DIR, 'build-report.json');
const MANIFEST_PATH = resolve(SHARE_DIR, 'delivery-manifest.json');
const HTML_PATH = resolve(SHARE_DIR, 'game/像素回响.html');
const GAME_ZIP_PATH = resolve(SHARE_DIR, '像素回响-轻量游戏包.zip');

// 用户取消体积硬上限；继续验证完整内联、分发白名单与真实字节数。

interface BuildReport {
  artifact: { path: string; bytes: number };
  limits: { artifactMaxBytes: number | null; artifactWithinLimit: boolean | null; gameZipMaxBytes: number | null };
  inlining: { javascriptFiles: number; stylesheetFiles: number; imageAssets: number };
  staticChecks: {
    status: string;
    checks: Record<string, number | string | boolean | string[]>;
  };
  verification: { notVerified: string[] };
}

interface DeliveryManifest {
  game_zip_bytes: number;
  game_zip_within_limit: boolean | null;
  game_html_bytes: number;
  skipped_checks: string[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** 读取 ZIP 中央目录中的条目名，不依赖第三方解压库。 */
function zipEntryNames(buffer: Buffer): string[] {
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = buffer.lastIndexOf(eocdSignature);
  if (eocd < 0) throw new Error('ZIP 缺少 EOCD 记录');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`ZIP 中央目录第 ${index} 项签名不正确`);
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

describe('share delivery package', () => {
  it('ships a complete single HTML with all runtime assets inlined', () => {
    expect(existsSync(HTML_PATH)).toBe(true);
    const html = readFileSync(HTML_PATH, 'utf8');
    const bytes = statSync(HTML_PATH).size;

    expect(bytes).toBeGreaterThan(0);
    expect(html).toContain('<script type="module">');
    expect(html).toContain('<style>');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('<title>像素回响：四人试炼</title>');
    expect(html).toContain('18 波');

    expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=/i);
    expect(html).not.toMatch(/<link\b[^>]*\brel\s*=\s*["'][^"']*stylesheet/i);
    expect(html).not.toMatch(/<link\b[^>]*\brel\s*=\s*["'][^"']*modulepreload/i);
    expect(html).not.toMatch(/\/assets\/[A-Za-z0-9._/-]+/);
    expect(html).not.toMatch(/<(?:script|link|img|iframe|audio|video|source)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\//i);
    expect(html).not.toMatch(/url\(\s*["']?https?:\/\//i);
    expect(html).not.toMatch(/\bimport\s*\(\s*["'`][^"'`]+["'`]/);
  });

  it('excludes development entry points, credentials and screenshot references', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    expect(html).not.toContain('__PIXEL_ECHO_DEV__');
    expect(html).not.toContain('__PIXEL_ECHO_DIAG__');
    expect(html).not.toMatch(/\bdev=1\b/);
    expect(html).not.toMatch(/\bperf=1\b/);
    expect(html).not.toContain('screenshots/');
    expect(html).not.toMatch(/ANTHROPIC_API_KEY|OPENAI_API_KEY|BEGIN (?:RSA |EC )?PRIVATE KEY/);
  });

  it('only packages player-facing files and has no hard size cap', () => {
    expect(existsSync(GAME_ZIP_PATH)).toBe(true);
    const buffer = readFileSync(GAME_ZIP_PATH);
    expect(buffer.length).toBeGreaterThan(0);

    const names = zipEntryNames(buffer);
    expect(names).toContain('像素回响-试玩版/像素回响.html');
    expect(names).toContain('像素回响-试玩版/开始试玩.txt');
    expect(names).toContain('像素回响-试玩版/THIRD_PARTY_NOTICES.txt');
    const allowed = new Set(['像素回响.html', '开始试玩.txt', 'THIRD_PARTY_NOTICES.txt']);
    for (const name of names) {
      const parts = name.split('/');
      expect(parts).toHaveLength(2);
      const [dir, file] = parts;
      expect(dir).toBe('像素回响-试玩版');
      expect(file).toBeDefined();
      expect(allowed.has(file as string)).toBe(true);
      for (const forbidden of ['.git', '.claude', '.memory', 'node_modules', 'screenshots', '.DS_Store']) {
        expect(name).not.toContain(forbidden);
      }
    }
  });

  it('records the size limits, inline checks and skipped verifications in build evidence', () => {
    const report = readJson<BuildReport>(REPORT_PATH);
    const actualBytes = statSync(HTML_PATH).size;

    expect(report.artifact.bytes).toBe(actualBytes);
    expect(report.limits.artifactMaxBytes).toBeNull();
    expect(report.limits.artifactWithinLimit).toBeNull();
    expect(report.limits.gameZipMaxBytes).toBeNull();
    expect(report.inlining.javascriptFiles).toBeGreaterThan(0);
    expect(report.inlining.stylesheetFiles).toBeGreaterThan(0);
    expect(report.inlining.imageAssets).toBeGreaterThan(0);
    expect(report.staticChecks.status).toBe('passed');
    expect(report.staticChecks.checks.externalScriptTags).toBe(0);
    expect(report.staticChecks.checks.externalStylesheetLinks).toBe(0);
    expect(report.staticChecks.checks.remainingAssetUrls).toBe(0);
    expect(report.staticChecks.checks.devBridgeMarkers).toBe(0);
    expect(report.staticChecks.checks.credentialMarkers).toBe(0);
    expect(report.verification.notVerified.join('\n')).toContain('US-066');
    expect(report.verification.notVerified.join('\n')).toContain('US-051');
  });

  it('lists the user-skipped checks in the delivery manifest', () => {
    const manifest = readJson<DeliveryManifest>(MANIFEST_PATH);
    expect(manifest.game_zip_bytes).toBe(statSync(GAME_ZIP_PATH).size);
    expect(manifest.game_zip_within_limit).toBeNull();
    expect(manifest.game_html_bytes).toBe(statSync(HTML_PATH).size);
    expect(manifest.skipped_checks.join('\n')).toContain('US-066');
    expect(manifest.skipped_checks.join('\n')).toContain('US-051');
  });
});
