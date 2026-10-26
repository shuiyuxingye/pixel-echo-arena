/**
 * 消耗品 P01–P08 的实际效果（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/02-content-catalog.md` §8 种消耗品与
 * `01-systems-and-balance.md` §商店、§数值初值与上限：
 * - P01/P02 立即回复生命，可重复购买；回复不超过生命上限由 `HealthState.heal` 钳制；
 * - P03–P08 购买后排队到下一波生效，同一波购买次数受目录上限约束；
 * - 临时增益与代价在波末一起清除；P05 的剩余护盾进入商店时清除；
 * - H23「药剂效果 +30%，药剂价格 +15%」在购买时各乘一次：
 *   效果倍率快照进本次购买，价格加价由商店价格的修正入口合并一次，
 *   不因重复读取层数/修正而二次放大。
 */
import type { StatModifier } from './stats';

/** 目录中的 8 种消耗品；P01 常驻货架外，P02–P08 轮流出现。 */
export const CONSUMABLE_IDS = [
  'P01',
  'P02',
  'P03',
  'P04',
  'P05',
  'P06',
  'P07',
  'P08',
] as const;

export type ConsumableId = (typeof CONSUMABLE_IDS)[number];

const CONSUMABLE_ID_SET: ReadonlySet<string> = new Set(CONSUMABLE_IDS);

export function isConsumableId(id: string): id is ConsumableId {
  return CONSUMABLE_ID_SET.has(id);
}

/** 需要排队到下一波生效的消耗品；P01/P02 是立即治疗。 */
export const TEMPORARY_BUFF_IDS = [
  'P03',
  'P04',
  'P05',
  'P06',
  'P07',
  'P08',
] as const;

export type TemporaryBuffId = (typeof TEMPORARY_BUFF_IDS)[number];

const TEMPORARY_BUFF_ID_SET: ReadonlySet<string> = new Set(TEMPORARY_BUFF_IDS);

export function isTemporaryBuffId(id: string): id is TemporaryBuffId {
  return TEMPORARY_BUFF_ID_SET.has(id);
}

/** 单层效果；百分比以 0.1 表示 10%，与 `StatModifier.percent` 同口径。 */
export interface ConsumableEffectParams {
  /** P01：立即回复的生命。 */
  readonly healFlat?: number;
  /** P02：立即回复最大生命的比例。 */
  readonly healMaxHealthPercent?: number;
  /** P03：下一波伤害。 */
  readonly damagePercent?: number;
  /** P04：下一波移动速度。 */
  readonly moveSpeedPercent?: number;
  /** P05：下一波初始护盾。 */
  readonly shieldFlat?: number;
  /** P06：下一波冷却缩减；最终仍受总上限 50% 钳制。 */
  readonly cooldownReductionPercent?: number;
  /** P07：下一波每秒回复生命。 */
  readonly regenPerSecond?: number;
  /** P08：下一波攻击速度。 */
  readonly attackSpeedPercent?: number;
  /** P08：下一波护甲（负数为代价）。 */
  readonly armorFlat?: number;
  /** 同一波最多购买次数；缺省 0 表示不限制（P01/P02）。 */
  readonly maxPerWave?: number;
}

/** 8 种消耗品的数值；效果文案仍以目录为准。 */
export const CONSUMABLE_EFFECT_PARAMS: Readonly<
  Record<ConsumableId, ConsumableEffectParams>
> = {
  P01: { healFlat: 30 },
  P02: { healMaxHealthPercent: 0.25 },
  P03: { damagePercent: 0.12, maxPerWave: 2 },
  P04: { moveSpeedPercent: 0.12, maxPerWave: 1 },
  P05: { shieldFlat: 40, maxPerWave: 2 },
  P06: { cooldownReductionPercent: 0.1, maxPerWave: 1 },
  P07: { regenPerSecond: 1, maxPerWave: 2 },
  P08: { attackSpeedPercent: 0.2, armorFlat: -8, maxPerWave: 1 },
};

/** H23 精炼药剂：药剂效果 +30%。 */
export const H23_POTION_EFFECT_PERCENT = 30;

/** H23 精炼药剂：药剂价格 +15%。 */
export const H23_POTION_PRICE_PERCENT = 15;

/**
 * 药剂修正。H23 唯一（不叠层），因此这里按“是否拥有”生效；
 * 传入多层也只应用一次，避免同一修正被重复放大。
 */
export interface ConsumableModifiers {
  readonly effectMultiplier: number;
  readonly priceSurchargePercent: number;
}

export const IDENTITY_CONSUMABLE_MODIFIERS: ConsumableModifiers = Object.freeze({
  effectMultiplier: 1,
  priceSurchargePercent: 0,
});

/**
 * H23 层数 → 药剂修正。H23 是唯一海克斯，层数 ≥1 与 1 层完全等价；
 * 效果倍率与价格加价都只在这里产生一次。
 */
export function consumableModifiersForH23(
  h23Stacks: number,
): ConsumableModifiers {
  const owned = Number.isFinite(h23Stacks) && h23Stacks >= 1;
  if (!owned) return { ...IDENTITY_CONSUMABLE_MODIFIERS };
  return {
    effectMultiplier: 1 + H23_POTION_EFFECT_PERCENT / 100,
    priceSurchargePercent: H23_POTION_PRICE_PERCENT,
  };
}

function safeMaxHealth(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** 一次购买中已生效的层数快照；倍率在购买时固定，之后获得 H23 不改写。 */
interface BuffStack {
  readonly multiplier: number;
  readonly count: number;
}

function totalStacks(
  map: ReadonlyMap<TemporaryBuffId, readonly BuffStack[]>,
  id: TemporaryBuffId,
): number {
  return (map.get(id) ?? []).reduce((total, entry) => total + entry.count, 0);
}

function scaledValue(
  map: ReadonlyMap<TemporaryBuffId, readonly BuffStack[]>,
  id: TemporaryBuffId,
  perStack: number,
): number {
  return (map.get(id) ?? []).reduce(
    (total, entry) => total + perStack * entry.count * entry.multiplier,
    0,
  );
}

function mergedBuffStacks(
  stacks: readonly BuffStack[],
): BuffStack[] {
  const merged: BuffStack[] = [];
  for (const entry of stacks) {
    const existing = merged.find(
      (candidate) => candidate.multiplier === entry.multiplier,
    );
    if (existing) {
      const index = merged.indexOf(existing);
      merged[index] = { ...existing, count: existing.count + entry.count };
    } else {
      merged.push({ ...entry });
    }
  }
  return merged;
}

function countRecord(
  map: ReadonlyMap<TemporaryBuffId, readonly BuffStack[]>,
): Readonly<Record<string, number>> {
  const record: Record<string, number> = {};
  for (const id of TEMPORARY_BUFF_IDS) {
    const count = totalStacks(map, id);
    if (count > 0) record[id] = count;
  }
  return record;
}

export type ConsumablePurchaseFailureReason =
  | 'unknown-consumable'
  | 'limit-reached';

export interface ConsumableImmediatePurchase {
  readonly ok: true;
  readonly potionId: ConsumableId;
  readonly kind: 'immediate';
  /** 未应用治疗修正与生命上限钳制的原始回复量。 */
  readonly heal: number;
  readonly effectMultiplier: number;
}

export interface ConsumableBuffPurchase {
  readonly ok: true;
  readonly potionId: ConsumableId;
  readonly kind: 'buff';
  /** 购买后本次排队到下一波的层数。 */
  readonly stacks: number;
  readonly limit: number;
  readonly effectMultiplier: number;
}

export interface ConsumablePurchaseFailure {
  readonly ok: false;
  readonly potionId: string;
  readonly reason: ConsumablePurchaseFailureReason;
  /** 达到上限时的上限值与当前层数；未知消耗品为 0。 */
  readonly limit: number;
  readonly stacks: number;
}

export type ConsumablePurchaseResult =
  | ConsumableImmediatePurchase
  | ConsumableBuffPurchase
  | ConsumablePurchaseFailure;

export interface ConsumablePurchaseContext {
  readonly maxHealth: number;
}

export interface ConsumableWaveStart {
  /** 本波开始时应授予的 P05 初始护盾。 */
  readonly shieldToGrant: number;
  /** 上一波残留、应在本波开始前移除的药剂护盾。 */
  readonly shieldToRemove: number;
}

/** 开发快照用：当前排队/生效层数与护盾/回复状态。 */
export interface ConsumableSnapshot {
  readonly effectMultiplier: number;
  readonly priceSurchargePercent: number;
  readonly pending: Readonly<Record<string, number>>;
  readonly active: Readonly<Record<string, number>>;
  readonly activeDamagePercent: number;
  readonly activeMoveSpeedPercent: number;
  readonly activeAttackSpeedPercent: number;
  readonly activeArmorFlat: number;
  readonly activeCooldownReductionPercent: number;
  readonly regenPerSecond: number;
  readonly initialShield: number;
  readonly shieldRemaining: number;
  readonly regenBudget: number;
}

/** 单层药剂增益快照：购买时的效果倍率与合并后的层数。 */
export interface ConsumableStackSave {
  readonly multiplier: number;
  readonly count: number;
}

/** 同一药剂的排队/生效层数组。 */
export interface ConsumableGroupSave {
  readonly id: TemporaryBuffId;
  readonly stacks: readonly ConsumableStackSave[];
}

/** V2 续局快照中的消耗品状态（US-065）。 */
export interface ConsumableSave {
  readonly pending: readonly ConsumableGroupSave[];
  readonly active: readonly ConsumableGroupSave[];
  readonly shieldGranted: number;
  readonly shieldRemaining: number;
  readonly regenBudget: number;
}

/** 单种药剂宽松层数上限，只用于拒绝异常数据。 */
const MAX_CONSUMABLE_STACKS = 99;

/** H23 效果倍率上限，只用于拒绝异常数据。 */
const MAX_CONSUMABLE_MULTIPLIER = 10;

function isFiniteNonNegative(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}

function isConsumableGroupSave(value: unknown): value is ConsumableGroupSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !isTemporaryBuffId(record.id)) return false;
  if (
    !Array.isArray(record.stacks) ||
    record.stacks.length === 0 ||
    record.stacks.length > MAX_CONSUMABLE_STACKS
  ) {
    return false;
  }
  for (const stack of record.stacks) {
    if (typeof stack !== 'object' || stack === null) return false;
    const entry = stack as Record<string, unknown>;
    if (
      typeof entry.multiplier !== 'number' ||
      !Number.isFinite(entry.multiplier) ||
      entry.multiplier <= 0 ||
      entry.multiplier > MAX_CONSUMABLE_MULTIPLIER
    ) {
      return false;
    }
    if (
      !Number.isInteger(entry.count) ||
      (entry.count as number) < 1 ||
      (entry.count as number) > MAX_CONSUMABLE_STACKS
    ) {
      return false;
    }
  }
  return true;
}

function isConsumableGroupList(value: unknown): value is readonly ConsumableGroupSave[] {
  if (!Array.isArray(value) || value.length > TEMPORARY_BUFF_IDS.length) {
    return false;
  }
  const seen = new Set<string>();
  for (const group of value) {
    if (!isConsumableGroupSave(group)) return false;
    if (seen.has(group.id)) return false;
    seen.add(group.id);
  }
  return true;
}

/** 快照校验：药剂 ID 唯一、层数/倍率有限、护盾与回复预算非负。 */
export function isConsumableSave(value: unknown): value is ConsumableSave {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!isConsumableGroupList(record.pending)) return false;
  if (!isConsumableGroupList(record.active)) return false;
  if (!isFiniteNonNegative(record.shieldGranted, Number.MAX_SAFE_INTEGER)) {
    return false;
  }
  if (
    !isFiniteNonNegative(record.shieldRemaining, Number.MAX_SAFE_INTEGER) ||
    record.shieldRemaining > record.shieldGranted
  ) {
    return false;
  }
  if (!isFiniteNonNegative(record.regenBudget, 1000)) return false;
  return true;
}

function groupSave(
  map: ReadonlyMap<TemporaryBuffId, readonly BuffStack[]>,
): ConsumableGroupSave[] {
  const groups: ConsumableGroupSave[] = [];
  for (const id of TEMPORARY_BUFF_IDS) {
    const stacks = map.get(id);
    if (!stacks || stacks.length === 0) continue;
    groups.push({
      id,
      stacks: stacks.map((entry) => ({
        multiplier: entry.multiplier,
        count: entry.count,
      })),
    });
  }
  return groups;
}

function groupMap(
  groups: readonly ConsumableGroupSave[],
): Map<TemporaryBuffId, BuffStack[]> {
  const map = new Map<TemporaryBuffId, BuffStack[]>();
  for (const group of groups) {
    map.set(
      group.id,
      group.stacks.map((entry) => ({
        multiplier: entry.multiplier,
        count: entry.count,
      })),
    );
  }
  return map;
}

/**
 * 一局内的消耗品状态：立即治疗只返回原始回复量（由场景结算并钳制上限），
 * P03–P08 先在商店排队，下一波开始时转为生效，波末统一清除。
 */
export class ConsumableEffects {
  private modifiersValue: ConsumableModifiers = { ...IDENTITY_CONSUMABLE_MODIFIERS };
  private pending = new Map<TemporaryBuffId, BuffStack[]>();
  private active = new Map<TemporaryBuffId, BuffStack[]>();
  private potionShieldGrantedValue = 0;
  private potionShieldRemainingValue = 0;
  private regenBudgetValue = 0;

  get modifiers(): ConsumableModifiers {
    return { ...this.modifiersValue };
  }

  /** 场景在获得/失去 H23 时同步；已购买层数保留购买时的倍率。 */
  setModifiers(modifiers: ConsumableModifiers): void {
    const multiplier =
      Number.isFinite(modifiers.effectMultiplier) && modifiers.effectMultiplier > 0
        ? modifiers.effectMultiplier
        : 1;
    const surcharge =
      Number.isFinite(modifiers.priceSurchargePercent) &&
      modifiers.priceSurchargePercent > 0
        ? modifiers.priceSurchargePercent
        : 0;
    this.modifiersValue = {
      effectMultiplier: multiplier,
      priceSurchargePercent: surcharge,
    };
  }

  /** 本次排队到下一波的层数（同一波购买上限）。 */
  pendingCount(potionId: string): number {
    return isTemporaryBuffId(potionId) ? totalStacks(this.pending, potionId) : 0;
  }

  /** 当前波生效的层数。 */
  activeCount(potionId: string): number {
    return isTemporaryBuffId(potionId) ? totalStacks(this.active, potionId) : 0;
  }

  /** 本波实际每秒回复；未生效 P07 时为 0。 */
  get regenPerSecond(): number {
    return scaledValue(
      this.active,
      'P07',
      CONSUMABLE_EFFECT_PARAMS.P07.regenPerSecond ?? 0,
    );
  }

  /** P05 本波已授予的护盾量。 */
  get potionShieldGranted(): number {
    return this.potionShieldGrantedValue;
  }

  /** P05 仍记在药剂账上的护盾量；被伤害消耗的部分不在此扣减。 */
  get potionShieldRemaining(): number {
    return this.potionShieldRemainingValue;
  }

  /** 当前生效的药剂属性修正；由 `StatAggregator` 统一聚合与钳制。 */
  statModifiers(): StatModifier[] {
    const modifiers: StatModifier[] = [];
    const damage = scaledValue(
      this.active,
      'P03',
      CONSUMABLE_EFFECT_PARAMS.P03.damagePercent ?? 0,
    );
    if (damage !== 0) {
      modifiers.push({ stat: 'damage', mode: 'percent', value: damage });
    }
    const moveSpeed = scaledValue(
      this.active,
      'P04',
      CONSUMABLE_EFFECT_PARAMS.P04.moveSpeedPercent ?? 0,
    );
    if (moveSpeed !== 0) {
      modifiers.push({ stat: 'moveSpeed', mode: 'percent', value: moveSpeed });
    }
    const cooldownReduction = scaledValue(
      this.active,
      'P06',
      CONSUMABLE_EFFECT_PARAMS.P06.cooldownReductionPercent ?? 0,
    );
    if (cooldownReduction !== 0) {
      modifiers.push({
        stat: 'cooldownReduction',
        mode: 'percent',
        value: cooldownReduction,
      });
    }
    const attackSpeed = scaledValue(
      this.active,
      'P08',
      CONSUMABLE_EFFECT_PARAMS.P08.attackSpeedPercent ?? 0,
    );
    if (attackSpeed !== 0) {
      modifiers.push({
        stat: 'attackSpeed',
        mode: 'percent',
        value: attackSpeed,
      });
    }
    const armor = scaledValue(
      this.active,
      'P08',
      CONSUMABLE_EFFECT_PARAMS.P08.armorFlat ?? 0,
    );
    if (armor !== 0) {
      modifiers.push({ stat: 'armor', mode: 'flat', value: armor });
    }
    return modifiers;
  }

  /**
   * 购买一次消耗品。P01/P02 返回原始回复量（不写生命对象）；
   * P03–P08 排队到下一波，超过同一波上限返回 `limit-reached`。
   */
  purchase(
    potionId: string,
    context: ConsumablePurchaseContext,
  ): ConsumablePurchaseResult {
    if (!isConsumableId(potionId)) {
      return {
        ok: false,
        potionId,
        reason: 'unknown-consumable',
        limit: 0,
        stacks: 0,
      };
    }
    const params = CONSUMABLE_EFFECT_PARAMS[potionId];
    if (potionId === 'P01' || potionId === 'P02') {
      const base =
        potionId === 'P01'
          ? params.healFlat ?? 0
          : safeMaxHealth(context.maxHealth) * (params.healMaxHealthPercent ?? 0);
      return {
        ok: true,
        potionId,
        kind: 'immediate',
        heal: base * this.modifiersValue.effectMultiplier,
        effectMultiplier: this.modifiersValue.effectMultiplier,
      };
    }

    const limit = Math.max(0, Math.floor(params.maxPerWave ?? 0));
    const stacks = this.pendingCount(potionId) + this.activeCount(potionId);
    if (limit > 0 && stacks >= limit) {
      return {
        ok: false,
        potionId,
        reason: 'limit-reached',
        limit,
        stacks,
      };
    }

    const buffId = potionId as TemporaryBuffId;
    const list = this.pending.get(buffId) ?? [];
    list.push({
      multiplier: this.modifiersValue.effectMultiplier,
      count: 1,
    });
    this.pending.set(buffId, mergedBuffStacks(list));
    return {
      ok: true,
      potionId,
      kind: 'buff',
      stacks: stacks + 1,
      limit,
      effectMultiplier: this.modifiersValue.effectMultiplier,
    };
  }

  /**
   * 下一波开始：先移除上一波残留的药剂护盾，再把排队层数转为生效并授予
   * P05 初始护盾。场景负责把两个数值写入 `HealthState.shield`。
   */
  beginWave(): ConsumableWaveStart {
    const shieldToRemove = this.potionShieldRemainingValue;
    this.potionShieldGrantedValue = 0;
    this.potionShieldRemainingValue = 0;

    this.active = new Map(this.pending);
    this.pending = new Map();
    this.regenBudgetValue = 0;

    const shieldToGrant = scaledValue(
      this.active,
      'P05',
      CONSUMABLE_EFFECT_PARAMS.P05.shieldFlat ?? 0,
    );
    this.potionShieldGrantedValue = shieldToGrant;
    this.potionShieldRemainingValue = shieldToGrant;
    return { shieldToGrant, shieldToRemove };
  }

  /**
   * 波末清除全部临时增益与代价（P03–P08 的排队/生效层数、回复预算）。
   * P05 已授予的剩余护盾按目录在进入商店时清除，见 `clearPotionShield`。
   */
  endWave(): void {
    this.active = new Map();
    this.pending = new Map();
    this.regenBudgetValue = 0;
  }

  /**
   * 进入商店：清除 P05 剩余护盾并返回应从玩家当前护盾中移除的量。
   * 已被伤害消耗的部分不再重复扣减；场景按 `min(当前护盾, 返回值)` 处理。
   */
  clearPotionShield(): number {
    const remaining = this.potionShieldRemainingValue;
    this.potionShieldGrantedValue = 0;
    this.potionShieldRemainingValue = 0;
    return remaining;
  }

  /**
   * 推进 P07 的每秒回复。返回本步应回复的整点生命；不足 1 点留到下一步，
   * 避免逐帧给 HUD 刷 0 点治疗或产生大量小数生命。
   */
  step(seconds: number): number {
    const rate = this.regenPerSecond;
    if (rate <= 0 || !Number.isFinite(seconds) || seconds <= 0) return 0;
    this.regenBudgetValue += rate * seconds;
    const whole = Math.floor(this.regenBudgetValue + 1e-6);
    if (whole <= 0) return 0;
    this.regenBudgetValue -= whole;
    return whole;
  }

  /** V2 快照：排队/生效层数（含购买时倍率）、P05 护盾账与 P07 回复预算。 */
  saveSnapshot(): ConsumableSave {
    return {
      pending: groupSave(this.pending),
      active: groupSave(this.active),
      shieldGranted: this.potionShieldGrantedValue,
      shieldRemaining: this.potionShieldRemainingValue,
      regenBudget: this.regenBudgetValue,
    };
  }

  /**
   * 从续局快照恢复排队/生效层数、P05 护盾账与 P07 回复预算。
   * 缺省/损坏时清空；修正配置（H23）仍由场景另行同步。
   */
  restore(save: ConsumableSave | null | undefined): void {
    this.reset();
    if (!isConsumableSave(save)) return;
    this.pending = groupMap(save.pending);
    this.active = groupMap(save.active);
    this.potionShieldGrantedValue = save.shieldGranted;
    this.potionShieldRemainingValue = save.shieldRemaining;
    this.regenBudgetValue = save.regenBudget;
  }

  /** 新开一局：清空排队/生效层数、护盾与回复预算；不改修正配置。 */
  reset(): void {
    this.pending = new Map();
    this.active = new Map();
    this.potionShieldGrantedValue = 0;
    this.potionShieldRemainingValue = 0;
    this.regenBudgetValue = 0;
  }

  snapshot(): ConsumableSnapshot {
    return {
      effectMultiplier: this.modifiersValue.effectMultiplier,
      priceSurchargePercent: this.modifiersValue.priceSurchargePercent,
      pending: countRecord(this.pending),
      active: countRecord(this.active),
      activeDamagePercent: scaledValue(
        this.active,
        'P03',
        CONSUMABLE_EFFECT_PARAMS.P03.damagePercent ?? 0,
      ),
      activeMoveSpeedPercent: scaledValue(
        this.active,
        'P04',
        CONSUMABLE_EFFECT_PARAMS.P04.moveSpeedPercent ?? 0,
      ),
      activeAttackSpeedPercent: scaledValue(
        this.active,
        'P08',
        CONSUMABLE_EFFECT_PARAMS.P08.attackSpeedPercent ?? 0,
      ),
      activeArmorFlat: scaledValue(
        this.active,
        'P08',
        CONSUMABLE_EFFECT_PARAMS.P08.armorFlat ?? 0,
      ),
      activeCooldownReductionPercent: scaledValue(
        this.active,
        'P06',
        CONSUMABLE_EFFECT_PARAMS.P06.cooldownReductionPercent ?? 0,
      ),
      regenPerSecond: this.regenPerSecond,
      initialShield: this.potionShieldGrantedValue,
      shieldRemaining: this.potionShieldRemainingValue,
      regenBudget: this.regenBudgetValue,
    };
  }
}
