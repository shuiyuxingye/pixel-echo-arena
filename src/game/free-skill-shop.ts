/**
 * 自由技能的商店交易（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §两个自由技能槽：
 * - 第一商店保证一个基础 70 金币档技能，并提供一次 25 金币新手首购补贴，
 *   实付 45 且不与其他折扣叠加；
 * - 空槽直接装备；满槽时替换，旧技能按实付总额 40% 回收；
 * - 同名技能再次出现改为升级（最高 3 级），升级价为当前波价格 60%/90% 向上取整；
 * - 一次提交：校验→扣款→装配/替换→标记售出，任何一步失败全额回滚。
 *
 * 与 `ShopSession` 分开：技能需要选择槽位并计算升级/回收净额，
 * 不能复用“按格扣款并发货”的通用路径；货架售出标记仍由同一个 `ShopShelf` 维护。
 */
import { getFreeSkill } from './data';
import {
  FREE_SKILL_FIRST_PURCHASE_SUBSIDY,
  freeSkillRefund,
  freeSkillUpgradePrice,
  type FreeSkillLevel,
  type FreeSkillLoadout,
  type FreeSkillSlotKey,
  type FreeSkillStack,
} from './free-skills';
import {
  FIRST_SHOP_SKILL_BASE_PRICE,
  resolveShopPrice,
  shopPrice,
} from './shop-offer';
import type { ShopOffer, ShopShelf } from './shop-offer';
import type { ShopGoldLedger } from './shop-transaction';

export type FreeSkillPurchaseAction = 'equip' | 'replace' | 'upgrade';

export type FreeSkillTradeFailureReason =
  | 'unknown-slot'
  | 'already-sold'
  | 'not-a-skill'
  | 'unknown-skill'
  | 'slots-full'
  | 'max-level'
  | 'insufficient-gold'
  | 'delivery-failed'
  | 'shop-unavailable';

export interface FreeSkillTradeFailure {
  readonly ok: false;
  readonly reason: FreeSkillTradeFailureReason;
  /** 距离可购买还差多少金币；其他失败为 0。 */
  readonly shortfall: number;
  readonly gold: number;
  readonly offer?: undefined;
}

/** 替换前的技能摘要；升级与空槽装备为 null。 */
export interface FreeSkillReplacedInfo {
  readonly id: string;
  readonly name: string;
  readonly level: FreeSkillLevel;
  readonly cooldownSeconds: number;
  readonly paidTotal: number;
  readonly refund: number;
}

export interface FreeSkillQuoteSuccess {
  readonly ok: true;
  readonly offerSlot: number;
  readonly action: FreeSkillPurchaseAction;
  readonly skillId: string;
  readonly skillName: string;
  /** 升级/装备/替换后所在的槽位。 */
  readonly targetSlot: FreeSkillSlotKey;
  readonly level: FreeSkillLevel;
  readonly cooldownSeconds: number;
  readonly description: string;
  readonly price: number;
  /** 替换旧技能的回收金币；升级与空槽装备为 0。 */
  readonly refund: number;
  /** 净金币变化：回收 − 支付，可为负。 */
  readonly netGold: number;
  /** 本次是否使用第一商店首购补贴。 */
  readonly subsidized: boolean;
  readonly replaced: FreeSkillReplacedInfo | null;
  /** 当前金币不足以支付；按钮据此禁用并显示差额。 */
  readonly affordable: boolean;
  readonly shortfall: number;
}

export type FreeSkillQuoteResult =
  | FreeSkillQuoteSuccess
  | (FreeSkillTradeFailure & { readonly offerSlot?: undefined });

export interface FreeSkillPurchaseSuccess {
  readonly ok: true;
  readonly offer: ShopOffer;
  readonly offerSlot: number;
  readonly action: FreeSkillPurchaseAction;
  readonly skillId: string;
  readonly skillName: string;
  readonly targetSlot: FreeSkillSlotKey;
  readonly level: FreeSkillLevel;
  readonly cooldownSeconds: number;
  readonly price: number;
  readonly refund: number;
  readonly netGold: number;
  readonly goldBefore: number;
  readonly goldAfter: number;
  readonly subsidized: boolean;
  readonly replaced: FreeSkillReplacedInfo | null;
  /** 技能不占道具层数；保留字段让开发商店操作共用同一份报告结构。 */
  readonly stacksAfter: null;
}

export type FreeSkillPurchaseResult =
  | FreeSkillPurchaseSuccess
  | (FreeSkillTradeFailure & { readonly offer?: undefined });

export interface FreeSkillShopOptions {
  readonly shelf: ShopShelf;
  readonly gold: ShopGoldLedger;
  readonly skills: FreeSkillLoadout;
  /** 本商店对应波次；与货架一致，用于价格与首购补贴判断。 */
  readonly shopWave: number;
}

function failure(
  reason: FreeSkillTradeFailureReason,
  gold: number,
): FreeSkillTradeFailure {
  return { ok: false, reason, shortfall: 0, gold };
}

function replacedInfo(
  stack: FreeSkillStack,
  refund: number,
): FreeSkillReplacedInfo {
  const definition = getFreeSkill(stack.id);
  return {
    id: stack.id,
    name: definition?.name ?? stack.id,
    level: stack.level,
    cooldownSeconds: definition?.cooldownSeconds ?? 0,
    paidTotal: stack.paidTotal,
    refund,
  };
}

/**
 * 当前波基础价（不含折扣/加价）。升级价必须按这个价格计算，
 * 不能拿货架上已经打折的价格再乘 60%/90%，否则会重复叠加优惠。
 */
function currentWavePrice(basePrice: number, shopWave: number): number {
  return shopPrice(basePrice, shopWave);
}

/**
 * 单个商店的自由技能交易：报价与购买。
 * 报价不修改任何状态，供商店界面显示“替换前后 + 净金币”和禁用态。
 */
export class FreeSkillShop {
  private readonly shelf: ShopShelf;
  private readonly gold: ShopGoldLedger;
  private readonly skills: FreeSkillLoadout;
  private readonly shopWave: number;

  constructor(options: FreeSkillShopOptions) {
    this.shelf = options.shelf;
    this.gold = options.gold;
    this.skills = options.skills;
    this.shopWave = options.shopWave;
  }

  /** 第一商店保底技能价档，供货架抽取与测试共用。 */
  static get firstShopBasePrice(): number {
    return FIRST_SHOP_SKILL_BASE_PRICE;
  }

  /** 报价：不扣款、不改槽位。 */
  quote(offerSlot: number, targetSlot?: FreeSkillSlotKey): FreeSkillQuoteResult {
    const offer = this.shelf.offers.find((entry) => entry.slot === offerSlot);
    if (!offer) return failure('unknown-slot', this.gold.gold);
    if (offer.sold) return failure('already-sold', this.gold.gold);
    if (offer.kind !== 'skill') return failure('not-a-skill', this.gold.gold);

    const definition = getFreeSkill(offer.id);
    if (!definition) return failure('unknown-skill', this.gold.gold);

    const existingSlot = this.skills.slotOf(offer.id);
    if (existingSlot) {
      const current = this.skills.slotAt(existingSlot);
      if (!current || current.level >= 3) {
        return failure('max-level', this.gold.gold);
      }
      const nextLevel = (current.level + 1) as 2 | 3;
      const price = freeSkillUpgradePrice(
        currentWavePrice(definition.basePrice, this.shopWave),
        nextLevel,
      );
      const shortfall = Math.max(0, price - this.gold.gold);
      return {
        ok: true,
        offerSlot,
        action: 'upgrade',
        skillId: offer.id,
        skillName: definition.name,
        targetSlot: existingSlot,
        level: nextLevel,
        cooldownSeconds: definition.cooldownSeconds,
        description: definition.effect,
        price,
        refund: 0,
        netGold: -price,
        subsidized: false,
        replaced: null,
        affordable: shortfall === 0,
        shortfall,
      };
    }

    const target = targetSlot ?? this.skills.firstEmptySlot();
    if (!target) return failure('slots-full', this.gold.gold);
    const occupied = this.skills.slotAt(target);
    const action: FreeSkillPurchaseAction = occupied ? 'replace' : 'equip';
    const subsidized =
      this.shopWave === 1 && !this.skills.firstPurchaseSubsidyUsed;
    // 非补贴价直接用货架价：锁定价、折扣与加价都已在抽货时合并好。
    // 首购补贴按基础波次价减 25，不与其他折扣/加价叠加。
    const price = subsidized
      ? resolveShopPrice({
          basePrice: definition.basePrice,
          shopWave: this.shopWave,
          firstPurchaseSubsidy: FREE_SKILL_FIRST_PURCHASE_SUBSIDY,
        }).price
      : Math.max(1, Math.floor(offer.price));
    const refund = occupied ? freeSkillRefund(occupied.paidTotal) : 0;
    const shortfall = Math.max(0, price - this.gold.gold);
    return {
      ok: true,
      offerSlot,
      action,
      skillId: offer.id,
      skillName: definition.name,
      targetSlot: target,
      level: 1,
      cooldownSeconds: definition.cooldownSeconds,
      description: definition.effect,
      price,
      refund,
      netGold: refund - price,
      subsidized,
      replaced: occupied ? replacedInfo(occupied, refund) : null,
      affordable: shortfall === 0,
      shortfall,
    };
  }

  /**
   * 购买并装备/升级/替换技能。先扣款，再改槽位；全部成功才标记售出。
   * 标记售出失败时恢复原槽位并全额退回本笔金币。
   */
  purchase(
    offerSlot: number,
    targetSlot?: FreeSkillSlotKey,
  ): FreeSkillPurchaseResult {
    const quote = this.quote(offerSlot, targetSlot);
    if (!quote.ok) return quote;
    if (!quote.affordable) {
      return {
        ok: false,
        reason: 'insufficient-gold',
        shortfall: quote.shortfall,
        gold: this.gold.gold,
      };
    }

    const offer = this.shelf.offers.find((entry) => entry.slot === offerSlot);
    if (!offer) return failure('unknown-slot', this.gold.gold);

    const goldBefore = this.gold.gold;
    if (!this.gold.spendGold(quote.price)) {
      return {
        ok: false,
        reason: 'insufficient-gold',
        shortfall: Math.max(0, quote.price - this.gold.gold),
        gold: this.gold.gold,
      };
    }

    const previous =
      quote.action === 'replace' ? this.skills.slotAt(quote.targetSlot) : null;
    let delivered: boolean;
    if (quote.action === 'upgrade') {
      delivered = this.skills.upgrade(quote.skillId, quote.price);
    } else if (quote.action === 'replace') {
      delivered =
        this.skills.replace(quote.targetSlot, quote.skillId, quote.price) !== null;
    } else {
      delivered = this.skills.equip(quote.targetSlot, quote.skillId, quote.price);
    }

    if (!delivered) {
      this.gold.addGold(quote.price);
      return failure('delivery-failed', this.gold.gold);
    }

    if (!this.shelf.markSold(offerSlot)) {
      // 还原槽位：升级回退一级与实付，装备/替换恢复旧技能。
      if (quote.action === 'upgrade') {
        const stack = this.skills.slotAt(quote.targetSlot);
        if (stack) {
          this.skills.restoreSlot(quote.targetSlot, {
            id: stack.id,
            level: (stack.level - 1) as FreeSkillLevel,
            paidTotal: Math.max(0, stack.paidTotal - quote.price),
          });
        }
      } else {
        this.skills.restoreSlot(quote.targetSlot, previous);
      }
      this.gold.addGold(quote.price);
      return failure('already-sold', this.gold.gold);
    }

    if (quote.refund > 0) this.gold.addGold(quote.refund);
    if (quote.subsidized) this.skills.markFirstPurchaseSubsidyUsed();

    return {
      ok: true,
      offer,
      offerSlot,
      action: quote.action,
      skillId: quote.skillId,
      skillName: quote.skillName,
      targetSlot: quote.targetSlot,
      level: quote.level,
      cooldownSeconds: quote.cooldownSeconds,
      price: quote.price,
      refund: quote.refund,
      netGold: quote.netGold,
      goldBefore,
      goldAfter: this.gold.gold,
      subsidized: quote.subsidized,
      replaced: quote.replaced,
      stacksAfter: null,
    };
  }
}
