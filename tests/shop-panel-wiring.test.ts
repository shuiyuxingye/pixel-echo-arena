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

describe('商店界面接线', () => {
  it('进入波间后打开正式面板，奖励键盘在面板打开时让位', () => {
    const source = read('src/game/scenes/ArenaScene.ts');
    const enter = section(
      source,
      'private enterIntermission(): void {',
      'private handleRewardKey(',
    );
    expect(enter).toContain('this.openShopPanel()');

    const rewardKey = section(
      source,
      'private handleRewardKey(event: KeyboardEvent): void {',
      'private confirmRewardStep()',
    );
    expect(rewardKey).toContain('if (this.shopPanelOpen) return;');
    // 开发合成 C 入口仍排在让位之前。
    expect(rewardKey.indexOf('KeyC')).toBeLessThan(
      rewardKey.indexOf('if (this.shopPanelOpen) return;'),
    );

    const intermission = section(
      source,
      'private showIntermissionOverlay(): void {',
      'private refreshRewardOverlay(): void {',
    );
    expect(intermission).toContain('this.openShopPanel()');
    expect(intermission).toContain('this.rewardOverlay.setVisible(false)');
  });

  it('面板动作经会话提交购买/出售/合成，并在交易后刷新卡面与构筑', () => {
    const source = read('src/game/scenes/ArenaScene.ts');
    const action = section(
      source,
      'handleShopPanelAction(action: ShopUiAction): void {',
      'private openShopPanel(): void {',
    );
    expect(action).toContain("case 'confirm'");
    expect(action).toContain("case 'reroll'");
    expect(action).toContain("case 'lock'");
    expect(action).toContain("case 'next-wave'");

    const execute = section(
      source,
      'private executeShopEntry(entry: ShopUiEntry): void {',
      'private afterShopChange(kind: RunCheckpointKind = \'intermission\'): void {',
    );
    expect(execute).toContain('this.purchaseShopSlot(');
    expect(execute).toContain('this.purchaseEmergencyPotion()');
    expect(execute).toContain('this.purchaseMaterialSupply()');
    expect(execute).toContain('this.sellShopItem(');
    expect(execute).toContain('this.craftRecipe(');

    const after = section(
      source,
      'private afterShopChange(kind: RunCheckpointKind = \'intermission\'): void {',
      'private rerollShopFromPanel(): void {',
    );
    expect(after).toContain('this.shopShelf?.refreshItemPreviews()');
    expect(after).toContain('this.updateBuildHud()');
    expect(after).toContain('this.syncHealthHud()');
  });

  it('应用壳挂载商店面板并转发动作，索引页提供覆盖层', () => {
    const app = read('src/app.ts');
    expect(app).toContain("import { mountShopPanel } from './ui/shop-panel';");
    expect(app).toContain('SHOP_PANEL_EVENT');
    expect(app).toContain('handleShopPanelAction');
    expect(app).toContain('shopPanel.show(payload.view)');
    expect(app).toContain('shopPanel.hide()');

    const html = read('index.html');
    for (const id of [
      'shop-overlay',
      'shop-title',
      'shop-meta',
      'shop-tabs',
      'shop-main',
      'shop-tracking',
      'shop-detail',
      'shop-confirm',
      'shop-message',
      'shop-skills',
      'shop-reroll',
      'shop-lock',
      'shop-next-wave',
      'shop-hint',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('商店面板只读视图，不直接扣金币或改库存', () => {
    const ui = read('src/ui/shop-panel.ts');
    expect(ui).not.toContain('spendGold');
    expect(ui).not.toContain('acquire(');
    expect(ui).not.toContain('addGold');
  });
});
