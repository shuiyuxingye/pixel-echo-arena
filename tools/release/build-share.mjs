#!/usr/bin/env node
/**
 * 把生产构建 dist/ 打包成可通过 file:// 双击打开的单文件 HTML。
 *
 * 只使用 Node 标准库：
 * - 内联入口 JS 与 CSS（保留 type="module" / <style>）；
 * - 把 HTML/JS/CSS 中引用的 /assets/*.png 替换为 data:image/png;base64,...；
 * - 移除 modulepreload 等外部预加载链接；
 * - 做静态自检并生成 output/share/build-report.json；
 * - 从 node_modules 读取运行时依赖的许可证，生成 THIRD_PARTY_NOTICES.txt。
 *
 * 用法：npm run build:share
 * 产物：output/share/game/像素回响.html
 *
 * 本脚本不修改 src/、vite.config.ts 或正常构建产物。
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST_DIR = path.join(ROOT, 'dist');
const OUT_DIR = path.join(ROOT, 'output', 'share', 'game');
const ARTIFACT_PATH = path.join(OUT_DIR, '像素回响.html');
const NOTICES_PATH = path.join(OUT_DIR, 'THIRD_PARTY_NOTICES.txt');
const REPORT_PATH = path.join(ROOT, 'output', 'share', 'build-report.json');

const MIME_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.wav', 'audio/wav'],
]);

function fail(message) {
  console.error(`\n[build-share] 失败：${message}`);
  process.exit(1);
}

function readText(filePath, label) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    fail(`无法读取${label}：${rel(filePath)}（请先运行 npm run build）`);
  }
}

function readBuffer(filePath, label) {
  try {
    return readFileSync(filePath);
  } catch {
    fail(`无法读取${label}：${rel(filePath)}`);
  }
}

function rel(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? match[1] : null;
}

function safeDistPath(urlPath) {
  if (!urlPath.startsWith('/')) {
    fail(`生产 HTML 引用了非绝对路径资源：${urlPath}`);
  }
  const resolved = path.resolve(DIST_DIR, `.${urlPath}`);
  const distPrefix = `${path.resolve(DIST_DIR)}${path.sep}`;
  if (!resolved.startsWith(distPrefix)) {
    fail(`资源路径越出 dist/：${urlPath}`);
  }
  if (!existsSync(resolved)) {
    fail(`dist/ 缺少被引用资源：${urlPath}`);
  }
  return resolved;
}

function gitInfo() {
  const run = (args) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  const status = run(['status', '--porcelain']);
  return {
    commit: run(['rev-parse', 'HEAD']),
    branch: run(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: Boolean(status),
    dirtyEntries: status ? status.split('\n').filter(Boolean).length : 0,
  };
}

function uniqueMatches(text, regex) {
  return [...new Set([...text.matchAll(regex)].map((match) => match[0]))];
}

function packageVersion(name) {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8'),
    );
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// 1. 读取生产 HTML，内联入口 JS / CSS，移除外部预加载链接。
// ---------------------------------------------------------------------------

const distHtml = readText(path.join(DIST_DIR, 'index.html'), '生产 HTML');
let html = distHtml;

const removedPreloadLinks = [];
html = html.replace(/<link\b[^>]*>/gi, (tag) => {
  const relValue = (attr(tag, 'rel') ?? '').toLowerCase();
  if (relValue.split(/\s+/).includes('modulepreload')) {
    removedPreloadLinks.push(tag);
    return '';
  }
  return tag;
});

const inlinedScripts = [];
html = html.replace(
  /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi,
  (tag, src) => {
    const filePath = safeDistPath(src);
    const source = readText(filePath, '入口 JS');
    if (/<\/script/i.test(source)) {
      fail('入口 JS 含 </script 文本，无法安全内联。');
    }
    if (source.includes('<!--')) {
      fail('入口 JS 含 <!-- 文本，内联后可能改变 HTML 解析状态。');
    }
    const isModule = (attr(tag, 'type') ?? '').toLowerCase() === 'module';
    inlinedScripts.push({
      source: rel(filePath),
      bytes: Buffer.byteLength(source, 'utf8'),
      module: isModule,
    });
    return `<script${isModule ? ' type="module"' : ''}>\n${source}\n</script>`;
  },
);

const inlinedStylesheets = [];
html = html.replace(/<link\b[^>]*>/gi, (tag) => {
  const relValue = (attr(tag, 'rel') ?? '').toLowerCase();
  if (!relValue.split(/\s+/).includes('stylesheet')) {
    return tag;
  }
  const href = attr(tag, 'href');
  if (!href) {
    return tag;
  }
  if (/^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith('data:')) {
    return tag;
  }
  const filePath = safeDistPath(href);
  const source = readText(filePath, '入口 CSS');
  if (/<\/style/i.test(source)) {
    fail('入口 CSS 含 </style 文本，无法安全内联。');
  }
  inlinedStylesheets.push({
    source: rel(filePath),
    bytes: Buffer.byteLength(source, 'utf8'),
  });
  return `<style>\n${source}\n</style>`;
});

if (inlinedScripts.length === 0) {
  fail('生产 HTML 中没有找到可内联的入口 JS。');
}
if (inlinedStylesheets.length === 0) {
  fail('生产 HTML 中没有找到可内联的样式表。');
}

// ---------------------------------------------------------------------------
// 2. 把 /assets/ 下的静态资源替换成 data URI。
// ---------------------------------------------------------------------------

const assetPattern =
  /\/assets\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|gif|webp|svg|woff2?|ttf|otf|mp3|ogg|wav)/g;
const assetRefs = [...new Set(html.match(assetPattern) ?? [])].sort();
if (assetRefs.length === 0) {
  fail('生产 HTML/JS/CSS 中没有发现 /assets/ 静态资源引用。');
}

const assetManifest = [];
const placeholders = [];
assetRefs.forEach((ref, index) => {
  const filePath = safeDistPath(ref);
  const bytes = readBuffer(filePath, `资源 ${ref}`);
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES.get(ext);
  if (!mime) {
    fail(`未配置 MIME 类型：${ref}`);
  }
  const token = `\u0000SHARE_ASSET_${index}\u0000`;
  placeholders.push([token, `data:${mime};base64,${bytes.toString('base64')}`]);
  html = html.split(ref).join(token);
  assetManifest.push({
    url: ref,
    source: rel(filePath),
    bytes: bytes.length,
    mime,
    inlined: true,
  });
});
for (const [token, dataUri] of placeholders) {
  html = html.split(token).join(dataUri);
}

// ---------------------------------------------------------------------------
// 3. 静态自检：产物中不得再有运行时外部依赖。
// ---------------------------------------------------------------------------

const scriptSrcs = uniqueMatches(html, /<script\b[^>]*\bsrc\s*=\s*["'][^"']+["']/gi);
const stylesheetLinks = uniqueMatches(
  html,
  /<link\b[^>]*\brel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*>/gi,
);
const modulePreloadLinks = uniqueMatches(
  html,
  /<link\b[^>]*\brel\s*=\s*["'][^"']*modulepreload[^"']*["'][^>]*>/gi,
);
const remoteTagRefs = uniqueMatches(
  html,
  /<(?:script|link|img|iframe|audio|video|source)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\/[^"']+["']/gi,
);
const remoteCssUrls = uniqueMatches(html, /url\(\s*["']?https?:\/\/[^)"']+/gi);
const dynamicImports = uniqueMatches(html, /\bimport\s*\(\s*["'`][^"'`]+["'`]/g);
const staticImports = uniqueMatches(html, /(?:^|[;\n}])\s*import\s+(?:[\w*{]|["'])/g);
const remainingAssetRefs = uniqueMatches(html, /\/assets\/[A-Za-z0-9._/-]+/g);
const remoteStringHosts = uniqueMatches(html, /https?:\/\/[A-Za-z0-9.-]+/g).sort();

const staticChecks = {
  externalScriptTags: scriptSrcs.length,
  externalStylesheetLinks: stylesheetLinks.length,
  modulePreloadLinks: modulePreloadLinks.length,
  remoteTagReferences: remoteTagRefs.length,
  remoteCssUrls: remoteCssUrls.length,
  dynamicImports: dynamicImports.length,
  staticImports: staticImports.length,
  remainingAssetUrls: remainingAssetRefs.length,
  remainingAssetUrlSamples: remainingAssetRefs.slice(0, 5),
  inertRemoteStringHosts: remoteStringHosts,
  hasInlineModuleScript: /<script\s+type="module">/.test(html),
  hasInlineStyle: /<style>/.test(html),
};

const blockingProblems = [];
if (staticChecks.externalScriptTags > 0) blockingProblems.push('仍存在外部 <script src>');
if (staticChecks.externalStylesheetLinks > 0)
  blockingProblems.push('仍存在外部样式表 <link>');
if (staticChecks.remoteTagReferences > 0) blockingProblems.push('标签仍引用远程 URL');
if (staticChecks.remoteCssUrls > 0) blockingProblems.push('CSS 仍引用远程 URL');
if (staticChecks.dynamicImports > 0) blockingProblems.push('存在动态 import 外部模块');
if (staticChecks.staticImports > 0) blockingProblems.push('存在静态 import 外部模块');
if (staticChecks.remainingAssetUrls > 0)
  blockingProblems.push('仍有 /assets/ 外部资源引用');
if (staticChecks.modulePreloadLinks > 0) blockingProblems.push('仍有 modulepreload 链接');

if (blockingProblems.length > 0) {
  fail(blockingProblems.join('；'));
}

// ---------------------------------------------------------------------------
// 4. 写出单文件 HTML。
// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(ARTIFACT_PATH, html, 'utf8');
const artifactBytes = statSync(ARTIFACT_PATH).size;

// ---------------------------------------------------------------------------
// 5. 第三方许可说明。
// ---------------------------------------------------------------------------

const viteLicenseFull = readText(
  path.join(ROOT, 'node_modules/vite/LICENSE.md'),
  'Vite 许可证',
);
const viteCoreLicense = viteLicenseFull
  .split('# Licenses of bundled dependencies')[0]
  .trim();
const notices = [
  '像素回响：泰拉试炼 — 单文件分享版 第三方许可说明',
  '=================================================',
  '',
  `生成时间：${new Date().toISOString()}`,
  `源提交：${gitInfo().commit ?? 'unknown'}`,
  `产物：像素回响.html（${artifactBytes} 字节）`,
  '',
  '本单文件包含以下第三方运行时软件/生成的样式。游戏代码与美术资源来自本项目。',
  '',
  '--------------------------------------------------',
  `Phaser ${packageVersion('phaser')} — MIT License`,
  'Copyright (c) 2024 Richard Davey, Phaser Studio Inc.',
  'https://phaser.io',
  '--------------------------------------------------',
  readText(path.join(ROOT, 'node_modules/phaser/LICENSE.md'), 'Phaser 许可证').trim(),
  '',
  '--------------------------------------------------',
  `Tailwind CSS ${packageVersion('tailwindcss')} — MIT License（编译后的 CSS）`,
  'https://tailwindcss.com',
  '--------------------------------------------------',
  readText(path.join(ROOT, 'node_modules/tailwindcss/LICENSE'), 'Tailwind 许可证').trim(),
  '',
  '--------------------------------------------------',
  `daisyUI ${packageVersion('daisyui')} — MIT License（编译后的 CSS）`,
  'https://daisyui.com',
  '--------------------------------------------------',
  readText(path.join(ROOT, 'node_modules/daisyui/LICENSE'), 'daisyUI 许可证').trim(),
  '',
  '--------------------------------------------------',
  `Vite ${packageVersion('vite')} — MIT License（产物中的 modulepreload 辅助代码）`,
  'https://vite.dev',
  '--------------------------------------------------',
  viteCoreLicense,
  '',
  '--------------------------------------------------',
  `EventEmitter3 ${packageVersion('eventemitter3')} — MIT License（Phaser 依赖）`,
  '--------------------------------------------------',
  readText(path.join(ROOT, 'node_modules/eventemitter3/LICENSE'), 'EventEmitter3 许可证').trim(),
  '',
  '--------------------------------------------------',
  '美术资源',
  'public/assets/ 下的 PNG 由本项目 tools/generate-assets.mjs 生成，随游戏本体分发。',
  '--------------------------------------------------',
  '',
].join('\n');
writeFileSync(NOTICES_PATH, notices, 'utf8');
const noticesBytes = statSync(NOTICES_PATH).size;

// ---------------------------------------------------------------------------
// 6. 构建报告。每次重建重新标记浏览器验收状态，不复用旧产物的结论。
// ---------------------------------------------------------------------------

const git = gitInfo();
const distAssets = [
  ...inlinedScripts.map((entry) => ({
    kind: 'javascript',
    path: entry.source,
    bytes: entry.bytes,
  })),
  ...inlinedStylesheets.map((entry) => ({
    kind: 'css',
    path: entry.source,
    bytes: entry.bytes,
  })),
  ...assetManifest.map((entry) => ({
    kind: 'image',
    path: entry.source,
    bytes: entry.bytes,
    url: entry.url,
  })),
];

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    gitCommit: git.commit,
    gitBranch: git.branch,
    workingTreeDirty: git.dirty,
    workingTreeDirtyEntries: git.dirtyEntries,
    packageVersion: JSON.parse(readText(path.join(ROOT, 'package.json'), 'package.json'))
      .version,
    command: 'npm run build:share',
  },
  artifact: {
    path: rel(ARTIFACT_PATH),
    bytes: artifactBytes,
    encoding: 'utf-8',
    fileName: path.basename(ARTIFACT_PATH),
  },
  notices: {
    path: rel(NOTICES_PATH),
    bytes: noticesBytes,
  },
  inlining: {
    javascriptFiles: inlinedScripts.length,
    stylesheetFiles: inlinedStylesheets.length,
    imageAssets: assetManifest.length,
    modulePreloadLinksRemoved: removedPreloadLinks.length,
  },
  productionInputs: {
    distIndex: {
      path: 'dist/index.html',
      bytes: Buffer.byteLength(distHtml, 'utf8'),
    },
    files: distAssets,
  },
  productionAssets: assetManifest,
  staticChecks: {
    status: 'passed',
    checks: staticChecks,
    note: '远程字符串是库声明或命名空间；外部资源标签、CSS url() 与模块 import 静态检查通过。',
  },
  verification: {
    staticInlining: {
      status: 'passed',
      checkedAt: new Date().toISOString(),
      note: '所有运行资源均位于单 HTML 内；无外部 script/link/modulepreload/import。',
    },
    fileProtocolBrowser: {
      status: 'pending',
      note: '需在断网环境中用 file:// 打开产物，验证主菜单→选角→战斗、四角色资产、移动/攻击/暂停与 localStorage。',
    },
    notVerified: [
      '整局通关与试玩机器人：US-026a 已被用户主动 blocked，本次不重新打开。',
      '性能/泄漏指标：US-026b 已单独验收，本次不重跑。',
      '除已验证浏览器外的其他浏览器/系统组合。',
    ],
  },
};
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log('[build-share] 完成');
console.log(`  产物    ${rel(ARTIFACT_PATH)}  ${artifactBytes} 字节`);
console.log(`  许可    ${rel(NOTICES_PATH)}  ${noticesBytes} 字节`);
console.log(`  报告    ${rel(REPORT_PATH)}`);
console.log(
  `  内联    JS ${inlinedScripts.length} / CSS ${inlinedStylesheets.length} / 图片 ${assetManifest.length}`,
);
