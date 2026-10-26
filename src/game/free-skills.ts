/**
 * 两个自由技能槽（U/I）（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §两个自由技能槽：
 * - 固定 U/I 两个槽；空槽直接装备，满槽时由商店替换并回收旧技能实付总额的 40%；
 * - 同一技能不能同时占两个槽；再次购买同名技能改为升级，最高 3 级；
 * - 第 2/3 级效果强度为基础 120%/145%，控制时长增幅最多 25%；冷却不变；
 * - 冷却在波初统一清空，不跨波保留；冷却缩减来自聚合属性（I15/P06 等）。
 *
 * 本模块只保存槽位、等级、实付与冷却；伤害/治疗等实际效果由场景按 ID 执行，
 * 后续 S01–S12 故事继续在同一施法入口扩展。
 */
import { getFreeSkill, type FreeSkillDefinition } from './data';

/** 自由技能槽位键；默认绑定 U/I。 */
export const FREE_SKILL_SLOT_KEYS = ['U', 'I'] as const;
export type FreeSkillSlotKey = (typeof FREE_SKILL_SLOT_KEYS)[number];

/** 技能等级上限。 */
export const FREE_SKILL_MAX_LEVEL = 3;

/** 第 2/3 级的效果强度倍率；索引为等级。 */
export const FREE_SKILL_LEVEL_STRENGTH: Readonly<Record<1 | 2 | 3, number>> = {
  1: 1,
  2: 1.2,
  3: 1.45,
};

/** 控制时长增幅上限：等级 2 为 20%，等级 3 封顶 25%。 */
export const FREE_SKILL_CONTROL_MAX_MULTIPLIER = 1.25;

/** 第一商店一次性的新手首购补贴（金币）。 */
export const FREE_SKILL_FIRST_PURCHASE_SUBSIDY = 25;

/** 替换旧技能时按实付总额回收的比例。 */
export const FREE_SKILL_REPLACE_REFUND_PERCENT = 40;

export type FreeSkillLevel = 1 | 2 | 3;

/** 施放选项：H01 免费首施与 H08 冷却银行在不改动画布状态的前提下影响本次冷却。 */
export interface FreeSkillCastOptions {
  /** H01：本次施放不进冷却（返回的 `cooldownSeconds` 为 0）。 */
  readonly skipCooldown?: boolean;
  /** H08：本次冷却倍率（基础冷却 × 聚合减冷却 × 本倍率）；缺省 1。 */
  readonly cooldownScale?: number;
}

/** 已装备的自由技能：等级与实付总额都随升级累计。 */
export interface FreeSkillStack {
  readonly id: string;
  readonly level: FreeSkillLevel;
  /** 该技能从装备到现在的累计实付；替换时按此回收 40%。 */
  readonly paidTotal: number;
}

/** 单个槽位的只读快照。 */
export interface FreeSkillSlotSnapshot {
  readonly slot: FreeSkillSlotKey;
  readonly skill: FreeSkillStack | null;
  readonly cooldownRemaining: number;
  readonly cooldownSeconds: number;
}

export interface FreeSkillSnapshot {
  readonly slots: readonly FreeSkillSlotSnapshot[];
  readonly firstPurchaseSubsidyUsed: boolean;
}

/** 写入 V2 续局快照的槽位：保存装配事实与累计实付；冷却自 US-065 起随 `FreeSkillSave.cooldowns` 单独保存。 */
export interface FreeSkillSaveSlot {
  readonly slot: FreeSkillSlotKey;
  readonly id: string;
  readonly level: FreeSkillLevel;
  readonly paidTotal: number;
}

/** V2 续局快照中的 U/I 剩余冷却（秒）；旧快照缺省时从 0 起步。 */
export interface FreeSkillCooldownSave {
  readonly U: number;
  readonly I: number;
}

/** V2 续局快照中的自由技能两槽（US-048，冷却自 US-065 起随快照保存）。 */
export interface FreeSkillSave {
  readonly slots: readonly FreeSkillSaveSlot[];
  readonly firstPurchaseSubsidyUsed: boolean;
  readonly cooldowns?: FreeSkillCooldownSave;
}

/** 冷却宽松上限，只用于拒绝异常数据。 */
const MAX_SAVED_COOLDOWN_SECONDS = 999;

function isSavedCooldown(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_SAVED_COOLDOWN_SECONDS
  );
}

function isFreeSkillCooldownSave(
  value: unknown,
): value is FreeSkillCooldownSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return isSavedCooldown(record.U) && isSavedCooldown(record.I);
}

/** 快照校验：槽位唯一、目录内技能、等级 1–3、累计实付非负整数。 */
export function isFreeSkillSave(value: unknown): value is FreeSkillSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as {
    slots?: unknown;
    firstPurchaseSubsidyUsed?: unknown;
    cooldowns?: unknown;
  };
  if (typeof record.firstPurchaseSubsidyUsed !== 'boolean') return false;
  if (
    record.cooldowns !== undefined &&
    !isFreeSkillCooldownSave(record.cooldowns)
  ) {
    return false;
  }
  if (!Array.isArray(record.slots) || record.slots.length > FREE_SKILL_SLOT_KEYS.length) {
    return false;
  }
  const seenSlots = new Set<string>();
  const seenSkills = new Set<string>();
  for (const entry of record.slots) {
    if (typeof entry !== 'object' || entry === null) return false;
    const slot = (entry as { slot?: unknown }).slot;
    const id = (entry as { id?: unknown }).id;
    const level = (entry as { level?: unknown }).level;
    const paidTotal = (entry as { paidTotal?: unknown }).paidTotal;
    if (!isSlotKey(slot) || seenSlots.has(slot)) return false;
    if (typeof id !== 'string' || seenSkills.has(id) || !getFreeSkill(id)) {
      return false;
    }
    if (level !== 1 && level !== 2 && level !== 3) return false;
    if (!Number.isInteger(paidTotal) || (paidTotal as number) < 0) return false;
    seenSlots.add(slot);
    seenSkills.add(id);
  }
  return true;
}

/** 等级效果强度：1/1.2/1.45。非法等级按 1 处理。 */
export function freeSkillStrength(level: number): number {
  if (level === 2) return FREE_SKILL_LEVEL_STRENGTH[2];
  if (level === 3) return FREE_SKILL_LEVEL_STRENGTH[3];
  return FREE_SKILL_LEVEL_STRENGTH[1];
}

/** 控制时长倍率：等级 2 为 120%，等级 3 封顶 125%。 */
export function freeSkillControlMultiplier(level: number): number {
  if (level !== 2 && level !== 3) return 1;
  return Math.min(FREE_SKILL_CONTROL_MAX_MULTIPLIER, freeSkillStrength(level));
}

/** 升级价：当前波价格的 60%/90%，向上取整；价格至少 1。 */
export function freeSkillUpgradePrice(
  baseWavePrice: number,
  level: 2 | 3,
): number {
  if (!Number.isFinite(baseWavePrice) || baseWavePrice < 0) {
    throw new Error(`技能当前波价格必须是非负数，收到 ${baseWavePrice}`);
  }
  const percent = level === 2 ? 60 : 90;
  return Math.max(1, Math.ceil((baseWavePrice * percent) / 100));
}

/** 替换回收：实付总额的 40%，向下取整；免费技能为 0。 */
export function freeSkillRefund(paidTotal: number): number {
  if (!Number.isFinite(paidTotal) || paidTotal <= 0) return 0;
  return Math.floor((Math.floor(paidTotal) * FREE_SKILL_REPLACE_REFUND_PERCENT) / 100);
}

function isSlotKey(value: unknown): value is FreeSkillSlotKey {
  return value === 'U' || value === 'I';
}

function coerceLevel(value: number): FreeSkillLevel {
  if (value >= 3) return 3;
  if (value === 2) return 2;
  return 1;
}

/**
 * 自由技能装配与冷却状态。冷却与槽位同生共死，波初由场景统一重置。
 */
export class FreeSkillLoadout {
  private slots: Record<FreeSkillSlotKey, FreeSkillStack | null> = {
    U: null,
    I: null,
  };
  private cooldowns: Record<FreeSkillSlotKey, number> = { U: 0, I: 0 };
  private cooldownMultiplierValue = 1;
  private subsidyUsed = false;

  /** 第一商店新手首购补贴是否已经用掉。 */
  get firstPurchaseSubsidyUsed(): boolean {
    return this.subsidyUsed;
  }

  /** 标记补贴已使用；只有实际以补贴价完成一次装备/替换时调用。 */
  markFirstPurchaseSubsidyUsed(): void {
    this.subsidyUsed = true;
  }

  /** 读某个槽位；空槽为 null。返回副本，调用方不能改内部状态。 */
  slotAt(slot: FreeSkillSlotKey): FreeSkillStack | null {
    const stack = this.slots[slot];
    return stack ? { ...stack } : null;
  }

  /** 某技能当前所在的槽位；未装备为 null。 */
  slotOf(skillId: string): FreeSkillSlotKey | null {
    for (const slot of FREE_SKILL_SLOT_KEYS) {
      if (this.slots[slot]?.id === skillId) return slot;
    }
    return null;
  }

  /** 该技能累计实付；未装备为 0。 */
  paidTotal(skillId: string): number {
    const slot = this.slotOf(skillId);
    return slot ? (this.slots[slot]?.paidTotal ?? 0) : 0;
  }

  /** 第一个空槽；两个都满为 null。 */
  firstEmptySlot(): FreeSkillSlotKey | null {
    for (const slot of FREE_SKILL_SLOT_KEYS) {
      if (!this.slots[slot]) return slot;
    }
    return null;
  }

  /** 两个槽都满时为 true。 */
  isFull(): boolean {
    return this.firstEmptySlot() === null;
  }

  /** 空槽装备；槽位已有技能或技能已在另一槽时返回 false（重复装备禁止）。 */
  equip(slot: FreeSkillSlotKey, skillId: string, paid: number): boolean {
    if (!isSlotKey(slot) || this.slots[slot]) return false;
    if (!getFreeSkill(skillId) || this.slotOf(skillId) !== null) return false;
    const price = Number.isFinite(paid) && paid >= 0 ? Math.floor(paid) : 0;
    this.slots[slot] = { id: skillId, level: 1, paidTotal: price };
    return true;
  }

  /** 同名升级：等级 +1，实付累计；未装备或已满级返回 false。 */
  upgrade(skillId: string, paid: number): boolean {
    const slot = this.slotOf(skillId);
    if (!slot) return false;
    const current = this.slots[slot];
    if (!current || current.level >= FREE_SKILL_MAX_LEVEL) return false;
    const price = Number.isFinite(paid) && paid >= 0 ? Math.floor(paid) : 0;
    this.slots[slot] = {
      id: current.id,
      level: coerceLevel(current.level + 1),
      paidTotal: current.paidTotal + price,
    };
    return true;
  }

  /**
   * 满槽替换：把目标槽换成新技能并返回旧技能（供商店回收计算）；
   * 新技能重复装备或槽位为空时返回 null（空槽请走 `equip`）。
   */
  replace(slot: FreeSkillSlotKey, skillId: string, paid: number): FreeSkillStack | null {
    if (!isSlotKey(slot) || !this.slots[slot]) return null;
    if (!getFreeSkill(skillId) || this.slotOf(skillId) !== null) return null;
    const previous = this.slots[slot];
    const price = Number.isFinite(paid) && paid >= 0 ? Math.floor(paid) : 0;
    this.slots[slot] = { id: skillId, level: 1, paidTotal: price };
    return previous ? { ...previous } : null;
  }

  /** 直接设置槽位（开发预置/恢复用）；传 null 清空。 */
  setSlot(
    slot: FreeSkillSlotKey,
    skill: { readonly id: string; readonly level: number; readonly paidTotal?: number } | null,
  ): boolean {
    if (!isSlotKey(slot)) return false;
    if (!skill) {
      this.slots[slot] = null;
      this.cooldowns[slot] = 0;
      return true;
    }
    if (!getFreeSkill(skill.id)) return false;
    // 同一技能不能占两个槽；开发预置也遵守该规则。
    const other = this.slotOf(skill.id);
    if (other !== null && other !== slot) return false;
    const paid =
      Number.isFinite(skill.paidTotal) && (skill.paidTotal as number) >= 0
        ? Math.floor(skill.paidTotal as number)
        : 0;
    this.slots[slot] = {
      id: skill.id,
      level: coerceLevel(skill.level),
      paidTotal: paid,
    };
    return true;
  }

  /** 还原一个槽位（交易失败回滚用）；不检查重复装备，按原状态写回。 */
  restoreSlot(slot: FreeSkillSlotKey, stack: FreeSkillStack | null): void {
    if (!isSlotKey(slot)) return;
    this.slots[slot] = stack ? { ...stack } : null;
    if (!stack) this.cooldowns[slot] = 0;
  }

  /** 技能定义；空槽或未知 ID 返回 undefined。 */
  definitionAt(slot: FreeSkillSlotKey): FreeSkillDefinition | undefined {
    const stack = this.slots[slot];
    return stack ? getFreeSkill(stack.id) : undefined;
  }

  /** 聚合后的冷却倍率（含 I15/P06）；0 或非法值按 1。 */
  setCooldownMultiplier(value: number): void {
    this.cooldownMultiplierValue =
      Number.isFinite(value) && value > 0 ? value : 1;
  }

  get cooldownMultiplier(): number {
    return this.cooldownMultiplierValue;
  }

  /** 槽位剩余冷却秒数；空槽为 0。 */
  cooldownRemaining(slot: FreeSkillSlotKey): number {
    return this.cooldowns[slot] ?? 0;
  }

  /** 该槽基础冷却（未乘冷却缩减）；空槽为 0。 */
  baseCooldown(slot: FreeSkillSlotKey): number {
    return this.definitionAt(slot)?.cooldownSeconds ?? 0;
  }

  /**
   * 尝试施放：空槽返回 `empty`，冷却中返回 `cooldown`；
   * 成功时进入该技能的完整冷却（基础冷却 × 聚合冷却倍率）。
   * H01 的免费首施传 `skipCooldown`，H08 的银行按 `cooldownScale` 缩减本次冷却。
   */
  cast(
    slot: FreeSkillSlotKey,
    options: FreeSkillCastOptions = {},
  ):
    | {
        readonly ok: true;
        readonly skill: FreeSkillStack;
        readonly definition: FreeSkillDefinition;
        readonly cooldownSeconds: number;
      }
    | {
        readonly ok: false;
        readonly reason: 'empty' | 'cooldown';
        readonly cooldownRemaining: number;
      } {
    const stack = this.slots[slot];
    const definition = stack ? getFreeSkill(stack.id) : undefined;
    if (!stack || !definition) {
      return { ok: false, reason: 'empty', cooldownRemaining: 0 };
    }
    const remaining = this.cooldownRemaining(slot);
    if (remaining > 0) {
      return { ok: false, reason: 'cooldown', cooldownRemaining: remaining };
    }
    const fullCooldown = Math.max(
      0,
      definition.cooldownSeconds * this.cooldownMultiplierValue,
    );
    const scale =
      typeof options.cooldownScale === 'number' &&
      Number.isFinite(options.cooldownScale)
        ? Math.min(1, Math.max(0, options.cooldownScale))
        : 1;
    const cooldownSeconds = options.skipCooldown
      ? 0
      : Math.max(0, fullCooldown * scale);
    this.cooldowns[slot] = cooldownSeconds;
    return { ok: true, skill: stack, definition, cooldownSeconds };
  }

  /** 推进冷却；暂停/奖励阶段不调用。 */
  step(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    for (const slot of FREE_SKILL_SLOT_KEYS) {
      const remaining = this.cooldowns[slot];
      if (remaining > 0) {
        const next = remaining - seconds;
        this.cooldowns[slot] = next <= 1e-9 ? 0 : next;
      }
    }
  }

  /**
   * 返还某槽位剩余冷却的指定秒数（R04 等成品机制使用）。
   * 空槽或已就绪返回 0；不会把剩余冷却抬回更高值。
   */
  reduceCooldown(slot: FreeSkillSlotKey, seconds: number): number {
    if (!isSlotKey(slot)) return 0;
    if (!(seconds > 0) || !Number.isFinite(seconds)) return 0;
    const remaining = this.cooldowns[slot] ?? 0;
    if (remaining <= 0) return 0;
    const next = Math.max(0, remaining - seconds);
    this.cooldowns[slot] = next <= 1e-9 ? 0 : next;
    return remaining - next;
  }

  /** 波初统一清空冷却；不改变已装备技能与补贴状态。 */
  resetForWaveStart(): void {
    this.cooldowns.U = 0;
    this.cooldowns.I = 0;
  }

  /** 新局重置：清空槽位、冷却与补贴标记。 */
  reset(): void {
    this.slots = { U: null, I: null };
    this.cooldowns = { U: 0, I: 0 };
    this.subsidyUsed = false;
    this.cooldownMultiplierValue = 1;
  }

  snapshot(): FreeSkillSnapshot {
    return {
      slots: FREE_SKILL_SLOT_KEYS.map((slot) => ({
        slot,
        skill: this.slotAt(slot),
        cooldownRemaining: this.cooldownRemaining(slot),
        cooldownSeconds: this.baseCooldown(slot),
      })),
      firstPurchaseSubsidyUsed: this.subsidyUsed,
    };
  }

  /** 续局快照：两个槽的等级/累计实付与首购补贴标记。 */
  saveSnapshot(): FreeSkillSave {
    const slots: FreeSkillSaveSlot[] = [];
    for (const slot of FREE_SKILL_SLOT_KEYS) {
      const stack = this.slots[slot];
      if (stack) {
        slots.push({
          slot,
          id: stack.id,
          level: stack.level,
          paidTotal: stack.paidTotal,
        });
      }
    }
    return {
      slots,
      firstPurchaseSubsidyUsed: this.subsidyUsed,
      cooldowns: { U: this.cooldowns.U, I: this.cooldowns.I },
    };
  }

  /**
   * 从续局快照恢复：清空冷却与槽位后按快照装配；
   * 非法槽位/未知技能/重复技能被忽略，不抛错（快照已由 run-save 严格校验）。
   * 旧快照没有冷却字段时从 0 起步。
   */
  restore(save: FreeSkillSave | null | undefined): void {
    this.reset();
    if (typeof save !== 'object' || save === null) return;
    this.subsidyUsed = save.firstPurchaseSubsidyUsed === true;
    if (isFreeSkillCooldownSave(save.cooldowns)) {
      this.cooldowns = { U: save.cooldowns.U, I: save.cooldowns.I };
    }
    if (!Array.isArray(save.slots)) return;
    const entries: readonly FreeSkillSaveSlot[] = save.slots;
    const used = new Set<string>();
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue;
      if (!isSlotKey(entry.slot) || this.slots[entry.slot]) continue;
      if (typeof entry.id !== 'string' || used.has(entry.id)) continue;
      if (!getFreeSkill(entry.id)) continue;
      const paid =
        Number.isFinite(entry.paidTotal) && entry.paidTotal >= 0
          ? Math.floor(entry.paidTotal)
          : 0;
      this.slots[entry.slot] = {
        id: entry.id,
        level: coerceLevel(entry.level),
        paidTotal: paid,
      };
      used.add(entry.id);
    }
  }
}
