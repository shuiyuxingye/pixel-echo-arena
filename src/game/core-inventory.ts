/**
 * 已拥有精英核心账本（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §精英核心：
 * - 核心唯一：同一 ID 只能获得一次，获得后不再进入候选；
 * - 核心不出售、不能从商店或宝箱获得，只由波末三选一写入；
 * - 已拥有核心写入续局快照，刷新后不会重复领取。
 */
import { getEliteCore } from './data';

export class CoreInventory {
  private readonly idsValue = new Set<string>();

  /** 已拥有的核心数量；上限为内容目录的 8 件。 */
  get size(): number {
    return this.idsValue.size;
  }

  has(coreId: string): boolean {
    return this.idsValue.has(coreId);
  }

  /**
   * 获得一件核心。未知 ID 或已拥有都返回 false，
   * 由调用方决定如何提示，绝不重复登记。
   */
  acquire(coreId: string): boolean {
    if (!getEliteCore(coreId)) return false;
    if (this.idsValue.has(coreId)) return false;
    this.idsValue.add(coreId);
    return true;
  }

  /** 已拥有核心 ID，按获得顺序输出，便于稳定落盘与断言。 */
  snapshot(): string[] {
    return [...this.idsValue];
  }

  /**
   * 从快照恢复。未知 ID 与重复条目被忽略，不抛错；
   * 正常存档已由 `run-save` 严格校验，这里只防止损坏数据污染账本。
   */
  restore(coreIds: readonly string[] | undefined): void {
    this.idsValue.clear();
    if (!Array.isArray(coreIds)) return;
    for (const coreId of coreIds) {
      if (typeof coreId !== 'string') continue;
      if (!getEliteCore(coreId)) continue;
      this.idsValue.add(coreId);
    }
  }

  reset(): void {
    this.idsValue.clear();
  }
}
