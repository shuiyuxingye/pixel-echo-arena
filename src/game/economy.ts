/**
 * 金币账本与击杀/波末奖励口径（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §钱与经验各管一件事：
 * - 初始金币 40；击杀金币直接入账，不生成拾取物；
 * - 普通怪基础金币按种类 2/2/3/3/4/4/4/5，幼虫 1；精英额外 55；
 * - 第 1–17 波完成奖励 `18 + 3 × 波数`，超时过关同样发放；
 * - 同一敌人只奖励一次，召唤物击杀归玩家；Boss 二阶段增援不发奖励。
 */
import type { EnemyDefinition } from './data';

/** 新局初始金币。 */
export const INITIAL_GOLD = 40;

/** 精英击杀在基础金币之外追加的金币。 */
export const ELITE_GOLD_BONUS = 55;

/** 波次完成奖励常数：`18 + 3 × 波数`。 */
export const WAVE_COMPLETION_GOLD_BASE = 18;
export const WAVE_COMPLETION_GOLD_PER_WAVE = 3;

/** 最后一个带完成奖励的波次；第 18 波击败 Boss 后直接结算。 */
export const LAST_COMPLETION_REWARD_WAVE = 17;

/**
 * 第 `wave` 波完成奖励；第 18 波（Boss）与越界波次为 0。
 * 超时过关与提前清场走同一入口，金额只看波数。
 */
export function completionGoldForWave(wave: number): number {
  if (!Number.isInteger(wave) || wave < 1 || wave > LAST_COMPLETION_REWARD_WAVE) {
    return 0;
  }
  return WAVE_COMPLETION_GOLD_BASE + WAVE_COMPLETION_GOLD_PER_WAVE * wave;
}

/**
 * 单次击杀金币：敌人定义的基础金币 + 精英额外 55。
 * Boss 不进入后续经济循环，未配置 `goldReward` 时为 0。
 */
export function killGoldForEnemy(
  enemy: Pick<EnemyDefinition, 'goldReward' | 'elite'>,
  isElite: boolean = enemy.elite === true,
): number {
  const base = Number.isFinite(enemy.goldReward)
    ? Math.max(0, Math.floor(enemy.goldReward as number))
    : 0;
  return base + (isElite ? ELITE_GOLD_BONUS : 0);
}

export interface KillGoldAward {
  /** 首次结算该敌人时为 true；重复结算不返还金币。 */
  readonly awarded: boolean;
  /** 本次实际入账金币；重复结算为 0。 */
  readonly gold: number;
  /** 结算后的金币总额。 */
  readonly total: number;
}

/**
 * 本局金币账本。
 *
 * 击杀去重按敌人实例 ID，同一个敌人无论从哪条伤害链结算都只奖励一次；
 * 波末完成奖励按波次去重，超时与提前清场共用同一入口。
 */
export class EconomyLedger {
  private goldValue = INITIAL_GOLD;
  private readonly rewardedKills = new Set<string>();
  private readonly rewardedWaves = new Set<number>();

  get gold(): number {
    return this.goldValue;
  }

  /** 首次结算该敌人返回 true；同一实例重复结算返回 false。 */
  claimKill(unitId: string): boolean {
    if (this.rewardedKills.has(unitId)) return false;
    this.rewardedKills.add(unitId);
    return true;
  }

  /** 直接入账金币；非法或非正数不改变余额。返回实际入账金额。 */
  addGold(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const awarded = Math.floor(amount);
    this.goldValue += awarded;
    return awarded;
  }

  /**
   * 原子扣款：余额足够时一次扣完并返回 true，否则余额不变返回 false。
   * 商店交易先校验再调用，扣款后发货失败由调用方用 `addGold` 回滚。
   */
  spendGold(amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const cost = Math.floor(amount);
    if (cost > this.goldValue) return false;
    this.goldValue -= cost;
    return true;
  }

  /**
   * 结算一次击杀：同一敌人只奖励一次，金币按定义 + 精英追加。
   * `goldMultiplier` 来自 I17（每层 +8%）；先乘倍率再向下取整。
   * Boss 二阶段增援由调用方先用 `enemyGrantsKillRewards` 过滤。
   */
  awardKill(
    unitId: string,
    enemy: Pick<EnemyDefinition, 'goldReward' | 'elite'>,
    isElite: boolean = enemy.elite === true,
    goldMultiplier = 1,
  ): KillGoldAward {
    if (!this.claimKill(unitId)) {
      return { awarded: false, gold: 0, total: this.goldValue };
    }
    const base = killGoldForEnemy(enemy, isElite);
    const multiplier =
      Number.isFinite(goldMultiplier) && goldMultiplier > 0 ? goldMultiplier : 1;
    const gold = this.addGold(base * multiplier);
    return { awarded: true, gold, total: this.goldValue };
  }

  /**
   * 结算第 `wave` 波完成奖励；同一波只发放一次。
   * `goldMultiplier` 来自 I22（每层 −15%）；先乘倍率再向下取整。
   * `flatBonus` 来自 H12（+15 金币），只在确实有完成奖励的 1–17 波附加；
   * 第 18 波与越界波次没有完成奖励，也不发放该固定奖励。
   * 超时过关也走这里，因此金额只看波数。
   */
  awardWaveCompletion(
    wave: number,
    goldMultiplier = 1,
    flatBonus = 0,
  ): number {
    if (this.rewardedWaves.has(wave)) return 0;
    const base = completionGoldForWave(wave);
    if (base <= 0) return 0;
    const multiplier =
      Number.isFinite(goldMultiplier) && goldMultiplier > 0 ? goldMultiplier : 1;
    const bonus =
      Number.isFinite(flatBonus) && flatBonus > 0 ? flatBonus : 0;
    const gold = this.addGold(base * multiplier + bonus);
    if (gold > 0) this.rewardedWaves.add(wave);
    return gold;
  }

  /** 续局恢复金币；非法值回退到初始金币。已奖励记录不进入续局快照。 */
  restore(gold: number | undefined): void {
    this.goldValue =
      Number.isFinite(gold) && (gold as number) >= 0
        ? Math.floor(gold as number)
        : INITIAL_GOLD;
  }

  /** 本局已结算金币。 */
  snapshotGold(): number {
    return this.goldValue;
  }
}
