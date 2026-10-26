/**
 * 永久道具层数账本（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §宝箱/§商店：
 * - 每件永久道具按 ID 记录层数，上限取自 `catalog.json` 的 `stackCap`；
 * - 宝箱与商店都通过同一入口获得道具，已满层不再进入候选；
 * - 层数写入续局快照，刷新后不会丢掉刚领取的道具。
 *
 * 本模块只维护层数事实，不结算道具的正负效果；效果由后续道具故事接入。
 */
import { getShopItem } from './data';

export interface RunItemStack {
  readonly id: string;
  readonly stacks: number;
}

export class ItemInventory {
  private readonly stacksValue = new Map<string, number>();

  /** 当前已有层数；未拥有或未知 ID 为 0。 */
  stacksOf(itemId: string): number {
    return this.stacksValue.get(itemId) ?? 0;
  }

  /** 是否已达叠层上限；未知 ID 视为不可获得。 */
  isFull(itemId: string): boolean {
    const item = getShopItem(itemId);
    if (!item) return true;
    return this.stacksOf(itemId) >= item.stackCap;
  }

  /**
   * 获得 1 层道具。未知 ID、非正叠层上限或已满层都返回 false，
   * 由调用方决定是否转入兜底金币。
   */
  acquire(itemId: string): boolean {
    const item = getShopItem(itemId);
    if (!item || item.stackCap <= 0) return false;
    const current = this.stacksOf(itemId);
    if (current >= item.stackCap) return false;
    this.stacksValue.set(itemId, current + 1);
    return true;
  }

  /**
   * 移除 1 层道具（商店出售）。未拥有时返回 false，不会产生负数层数。
   * 道具的正负效果由效果模块按层数派生，移除层数即移除对应效果。
   */
  release(itemId: string): boolean {
    const current = this.stacksOf(itemId);
    if (current <= 0) return false;
    if (current === 1) {
      this.stacksValue.delete(itemId);
    } else {
      this.stacksValue.set(itemId, current - 1);
    }
    return true;
  }

  /** 已拥有道具的层数快照，按首次获得顺序输出，便于稳定落盘与断言。 */
  snapshot(): RunItemStack[] {
    return [...this.stacksValue.entries()]
      .filter(([, stacks]) => stacks > 0)
      .map(([id, stacks]) => ({ id, stacks }));
  }

  /**
   * 从快照恢复。未知 ID、越界层数与重复条目被忽略，不抛错；
   * 正常存档已由 `run-save` 严格校验，这里只防止损坏数据污染账本。
   */
  restore(entries: readonly RunItemStack[] | undefined): void {
    this.stacksValue.clear();
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { id, stacks } = entry;
      if (typeof id !== 'string' || this.stacksValue.has(id)) continue;
      const item = getShopItem(id);
      if (!item) continue;
      if (!Number.isInteger(stacks) || stacks < 1 || stacks > item.stackCap) {
        continue;
      }
      this.stacksValue.set(id, stacks);
    }
  }

  reset(): void {
    this.stacksValue.clear();
  }
}
