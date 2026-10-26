// @vitest-environment jsdom
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARENA, ASSET_KEYS, ASSET_PATHS, SCENE_KEYS, VIEWPORT } from '../src/game/config';
import { mountMenu } from '../src/ui/menu';

const ROOT = process.cwd();

function readIndexHtml(): string {
  return readFileSync(resolve(ROOT, 'index.html'), 'utf8');
}

/** 读取 PNG 头中的宽高，验证像素资源真实存在且尺寸符合设计。 */
function readPngSize(urlPath: string): { width: number; height: number; bytes: number } {
  const filePath = resolve(ROOT, `public${urlPath}`);
  const buffer = readFileSync(filePath);
  expect(buffer.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: statSync(filePath).size,
  };
}

function mountMenuDom() {
  document.body.innerHTML = `
    <div id="game-root"></div>
    <div id="menu-overlay">
      <button id="start-button" type="button">开始试炼</button>
    </div>
  `;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('project shell smoke test', () => {
  it('ships an HTML entry with the title and a keyboard start control', () => {
    const html = readIndexHtml();
    expect(html).toContain('<title>像素回响：四人试炼</title>');
    expect(html).toContain('id="game-root"');
    expect(html).toContain('id="menu-overlay"');
    expect(html).toContain('id="start-button"');
    expect(html).toContain('src="/src/main.ts"');
  });

  it('loads local pixel assets with the designed dimensions', () => {
    expect(ASSET_PATHS.playerVishdal).toBe('/assets/art/hero-vishdal.png');
    expect(ASSET_PATHS.playerAmiya).toBe('/assets/art/hero-amiya.png');
    expect(ASSET_PATHS.playerSaria).toBe('/assets/art/hero-saria.png');
    expect(ASSET_PATHS.playerMuelsyse).toBe('/assets/art/hero-muelsyse.png');

    for (const path of Object.values(ASSET_PATHS)) {
      expect(path.startsWith('/assets/')).toBe(true);
      expect(path).not.toContain('http');
      expect(readPngSize(path).bytes).toBeGreaterThan(0);
    }

    expect(readPngSize(ASSET_PATHS.floor)).toMatchObject({
      width: ARENA.width,
      height: ARENA.height,
    });
    expect(readPngSize(ASSET_PATHS.playerVishdal)).toMatchObject({ width: 864, height: 480 });
    expect(readPngSize(ASSET_PATHS.playerAmiya)).toMatchObject({ width: 864, height: 480 });
    expect(readPngSize(ASSET_PATHS.playerSaria)).toMatchObject({ width: 864, height: 480 });
    expect(readPngSize(ASSET_PATHS.playerMuelsyse)).toMatchObject({ width: 864, height: 480 });
    expect(readPngSize(ASSET_PATHS.wall)).toMatchObject({ width: 32, height: 32 });
    expect(readPngSize(ASSET_PATHS.cover)).toMatchObject({ width: 32, height: 32 });
    expect(Object.keys(ASSET_KEYS)).toHaveLength(7);
  });

  it('exposes a loadable scene configuration', () => {
    expect(SCENE_KEYS.arena).toBe('ArenaScene');
    expect(VIEWPORT).toEqual({ width: 960, height: 540 });
  });

  it('focuses the start button and starts on click exactly once', () => {
    mountMenuDom();
    const onStart = vi.fn();
    mountMenu({ doc: document, onStart });

    const startButton = document.querySelector<HTMLButtonElement>('#start-button');
    expect(document.activeElement).toBe(startButton);

    startButton?.click();
    startButton?.click();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLElement>('#menu-overlay')?.hidden).toBe(true);
  });

  it('starts from the keyboard with Enter', () => {
    mountMenuDom();
    const onStart = vi.fn();
    mountMenu({ doc: document, onStart });

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
    );

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLElement>('#menu-overlay')?.hidden).toBe(true);
  });
});
