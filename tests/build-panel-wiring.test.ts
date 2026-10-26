import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

function read(relative: string): string {
  return readFileSync(resolve(ROOT, relative), 'utf8');
}

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `缺少起点：${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `缺少终点：${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('构筑面板接线', () => {
  it('战斗内 B 打开面板并暂停，关闭后恢复战斗', () => {
    const scene = read('src/game/scenes/ArenaScene.ts');

    const keyDown = section(
      scene,
      'private handleKeyDown(event: KeyboardEvent): void {',
      'private handleKeyUp(event: KeyboardEvent): void {',
    );
    expect(keyDown).toContain('buildPanelToggleAction');
    expect(keyDown).toContain("this.runState.phase !== 'countdown'");
    expect(keyDown).toContain('this.openBuildPanel()');

    const open = section(
      scene,
      'openBuildPanel(): boolean {',
      '/** 关闭构筑面板并恢复战斗',
    );
    expect(open).toContain("this.pauseController.pause('manual')");
    expect(open).toContain('this.freezeCombat()');
    expect(open).toContain('BUILD_PANEL_EVENT');
    expect(open).toContain('this.createBuildPanelView()');

    const close = section(
      scene,
      'closeBuildPanel(): boolean {',
      '/**\n   * 冻结战斗的公共路径',
    );
    expect(close).toContain('this.resumeCombat(');

    const freeze = section(
      scene,
      'private freezeCombat(): boolean {',
      'resumeCombat(',
    );
    expect(freeze).toContain('this.runState.pause()');
    expect(freeze).toContain('this.logicLoop.reset()');
  });

  it('面板五类来源全部从本局真实账本读取，净属性与战斗聚合同源', () => {
    const scene = read('src/game/scenes/ArenaScene.ts');
    const view = section(
      scene,
      'private createBuildPanelView(): BuildPanelView {',
      'private buildCraftedPanelNotes(',
    );
    for (const source of [
      'this.consumables.snapshot()',
      'this.itemInventory.snapshot()',
      'this.coreInventory.snapshot()',
      'this.craftedInventory.snapshot()',
      'this.hexRun.ownedIds',
      'this.playerHealth.health',
      'stats.attackSpeedMultiplier',
      'stats.damageOverTimeMultiplier',
    ]) {
      expect(view, `视图缺少来源：${source}`).toContain(source);
    }
  });

  it('应用壳挂载构筑面板、转发开关并在其它覆盖层出现时收起', () => {
    const app = read('src/app.ts');
    expect(app).toContain("import { mountBuildPanel } from './ui/build-panel';");
    expect(app).toContain('BUILD_PANEL_EVENT');
    expect(app).toContain('buildPanel.show(payload.view)');
    expect(app).toContain('buildPanel.hide()');
    expect(app).toContain('closeBuildPanel()');
    expect(app).toContain('buildPanel.destroy()');

    const pause = app.slice(
      app.indexOf('created.events.on(PAUSE_MENU_EVENT'),
      app.indexOf('created.events.on(RUN_RESULT_EVENT'),
    );
    expect(pause).toContain('buildPanel.hide()');
  });

  it('索引页提供构筑覆盖层与滚动容器，样式表覆盖面板结构', () => {
    const html = read('index.html');
    for (const id of [
      'build-overlay',
      'build-panel',
      'build-title',
      'build-summary',
      'build-attributes',
      'build-groups',
      'build-hint',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }

    const css = read('src/style.css');
    for (const selector of [
      '.build-overlay',
      '.build-panel',
      '.build-attributes',
      '.build-groups',
      '.build-entry',
      '.build-entry-condition',
    ]) {
      expect(css).toContain(selector);
    }
  });

  it('DOM 面板只渲染视图，不暂停场景也不改战斗状态', () => {
    const ui = read('src/ui/build-panel.ts');
    expect(ui).not.toContain('pauseController');
    expect(ui).not.toContain('runState');
    expect(ui).not.toContain('playerHealth');
  });
});
