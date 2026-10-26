/**
 * 精英规则（纯逻辑，不依赖 Phaser）。
 *
 * - 精英攻击预警至少 0.8 秒：地面爆破取 0.9 秒，冲锋前摇同样抬到 0.9 秒；
 * - 预警与落地共用同一个爆破 ID，场景按 ID 增删预警圈；
 * - 核心奖励只认指定精英 ID：只有击杀该精英才记录资格，未击败不记；
 * - 资格按唯一奖励 ID 去重，刷新恢复不会重复领取。
 */
import { ELITE_LIST, getEliteById, type EliteDefinition } from './data';

/** 精英攻击预警下限；地面爆破与冲锋前摇都不低于该值。 */
export const ELITE_ATTACK_WARNING_SECONDS = 0.9;

/** 精英地面爆破：以玩家当前位置为落点的可读范围预警。 */
export const ELITE_BLAST_RADIUS = 62;
export const ELITE_BLAST_DAMAGE = 18;
export const ELITE_BLAST_INTERVAL_SECONDS = 5.5;
export const ELITE_BLAST_FIRST_DELAY_SECONDS = 2.5;

/** 所有精英核心奖励 ID；存档与资格恢复只接受这些值。 */
export const CORE_REWARD_IDS: ReadonlySet<string> = new Set(
  ELITE_LIST.map((elite) => elite.coreRewardId),
);

/** 指定精英 ID 绑定的核心奖励；未知 ID 返回 null。 */
export function coreRewardForElite(eliteId: string | undefined | null): string | null {
  if (!eliteId) return null;
  const elite = getEliteById(eliteId);
  return elite?.coreRewardId ?? null;
}

/**
 * 精英核心资格账本：只记录“击败指定精英”这一事实。
 * 生成、超时清场与普通击杀都不会调用 `registerEliteDefeat`。
 */
export class EliteCoreTracker {
  private rewardIdsValue: string[] = [];

  get rewardIds(): readonly string[] {
    return this.rewardIdsValue;
  }

  /** 击败精英时记录资格；返回新获得的核心奖励 ID，重复或未绑定返回 null。 */
  registerEliteDefeat(eliteId: string | undefined | null): string | null {
    const rewardId = coreRewardForElite(eliteId);
    if (!rewardId) return null;
    if (this.rewardIdsValue.includes(rewardId)) return null;
    this.rewardIdsValue.push(rewardId);
    return rewardId;
  }

  hasReward(rewardId: string): boolean {
    return this.rewardIdsValue.includes(rewardId);
  }

  /** 续局恢复：只接受已知核心奖励 ID，并自动去重。 */
  restore(rewardIds: readonly string[] | undefined): void {
    this.rewardIdsValue = [];
    for (const rewardId of rewardIds ?? []) {
      if (!CORE_REWARD_IDS.has(rewardId)) continue;
      if (this.rewardIdsValue.includes(rewardId)) continue;
      this.rewardIdsValue.push(rewardId);
    }
  }

  reset(): void {
    this.rewardIdsValue = [];
  }
}

/** 精英定义只读查询，方便场景/测试按波次取绑定信息。 */
export function eliteForWave(wave: number): EliteDefinition | undefined {
  return ELITE_LIST.find((elite) => elite.wave === wave);
}

/**
 * 本波可入队核心资格的奖励 ID：
 * 只有当前波次指定的精英已被击败才返回 1 个 ID；
 * 超时清场、未击败精英或非精英波都返回空数组。
 */
export function eligibleCoreIdsForWave(
  wave: number,
  tracker: EliteCoreTracker,
): string[] {
  const elite = eliteForWave(wave);
  if (!elite) return [];
  return tracker.hasReward(elite.coreRewardId) ? [elite.coreRewardId] : [];
}
