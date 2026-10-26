/**
 * 强化三选一、重抽与机制选择（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/game-design.md` §4、§6.2：
 * - 普通升级按银/金/棱彩 50/35/15 抽取；无有效卡的稀有度移出并重新归一化；
 *   同稀有度内等概率，卡片互不重复，只出通用或当前角色专属卡，满层不再出现；
 * - 第 3/6 波机制选择优先当前角色 4 张专属中未拥有的，不足用未拥有的金色通用补齐，
 *   再不足用有效银卡补齐；
 * - 重抽只换当前 3 张，不改变已获得强化；每局默认 2 次；池足够时新 3 张排除旧 3 张，
 *   否则允许交集但同一手不重复；
 * - 所有抽取使用本局种子与独立奖励随机序列，同种子可重现。
 */
import {
  UPGRADE_LIST,
  type CharacterId,
  type Rarity,
  type UpgradeDefinition,
} from './data';
import { SeededRandom, type RandomSource } from './random';

export { SeededRandom } from './random';

/** 每种稀有度在普通抽取中的权重；无有效卡的稀有度会先移除再归一化。 */
export const RARITY_WEIGHTS: Readonly<Record<Rarity, number>> = {
  silver: 50,
  gold: 35,
  prismatic: 15,
};

/** 固定权重顺序，保证同种子抽取可重现。 */
export const RARITY_ORDER: readonly Rarity[] = ['silver', 'gold', 'prismatic'];

/** 每次三选一的卡片数。 */
export const CARDS_PER_HAND = 3;

/** 本局默认重抽次数。 */
export const DEFAULT_REROLLS_PER_RUN = 2;

/** 稀有度的中文显示名，供卡片面板使用。 */
export const RARITY_LABELS: Readonly<Record<Rarity, string>> = {
  silver: '银',
  gold: '金',
  prismatic: '棱彩',
};

/** 抽取时使用的已获得强化状态。 */
export interface UpgradePoolState {
  readonly characterId: CharacterId;
  readonly pool: readonly UpgradeDefinition[];
  /** 已获得强化 ID → 当前层数。 */
  readonly stacks: ReadonlyMap<string, number>;
}

export interface DrawHandOptions {
  readonly count?: number;
  readonly excludeIds?: readonly string[];
}

/** 当前角色可抽到且未满层的强化。 */
export function isUpgradeAvailable(
  upgrade: UpgradeDefinition,
  state: UpgradePoolState,
): boolean {
  if (upgrade.owner !== 'general' && upgrade.owner !== state.characterId) {
    return false;
  }
  return (state.stacks.get(upgrade.id) ?? 0) < upgrade.maxStacks;
}

/** 按稀有度分组，只保留有效卡。 */
function listCandidates(state: UpgradePoolState): UpgradeDefinition[] {
  return state.pool.filter((upgrade) => isUpgradeAvailable(upgrade, state));
}

/**
 * 普通升级三选一：按银/金/棱彩 50/35/15 抽取。
 * 某稀有度没有有效卡时，该稀有度直接移出，剩余权重重新归一化。
 */
export function drawUpgradeHand(
  random: () => number,
  state: UpgradePoolState,
  options: DrawHandOptions = {},
): UpgradeDefinition[] {
  const count = Math.max(0, Math.floor(options.count ?? CARDS_PER_HAND));
  const excluded = new Set(options.excludeIds ?? []);
  let candidates = listCandidates(state).filter((upgrade) => !excluded.has(upgrade.id));
  const hand: UpgradeDefinition[] = [];

  while (hand.length < count) {
    const byRarity: Record<Rarity, UpgradeDefinition[]> = {
      silver: [],
      gold: [],
      prismatic: [],
    };
    for (const upgrade of candidates) byRarity[upgrade.rarity].push(upgrade);

    const available = RARITY_ORDER.filter((rarity) => byRarity[rarity].length > 0);
    if (available.length === 0) break;

    const totalWeight = available.reduce(
      (total, rarity) => total + RARITY_WEIGHTS[rarity],
      0,
    );
    let roll = random() * totalWeight;
    let pickedRarity = available[available.length - 1] as Rarity;
    for (const rarity of available) {
      roll -= RARITY_WEIGHTS[rarity];
      if (roll < 0) {
        pickedRarity = rarity;
        break;
      }
    }

    const sameRarity = byRarity[pickedRarity];
    const index = Math.min(
      sameRarity.length - 1,
      Math.floor(random() * sameRarity.length),
    );
    const card = sameRarity[Math.max(0, index)];
    if (!card) break;

    hand.push(card);
    candidates = candidates.filter((upgrade) => upgrade.id !== card.id);
  }

  return hand;
}

/** 使用 Fisher–Yates 洗牌，随机源由本局种子决定。 */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.min(index, Math.floor(random() * (index + 1)));
    const swap = result[index] as T;
    result[index] = result[other] as T;
    result[other] = swap;
  }
  return result;
}

/**
 * 第 3/6 波机制选择：
 * 1. 当前角色 4 张专属中未拥有的；
 * 2. 不足时用未拥有的金色通用机制卡补齐；
 * 3. 仍不足时用有效银卡补齐。
 * 同一手不重复；`excludeIds` 用于重抽时排除旧手牌。
 */
export function drawMechanicHand(
  random: () => number,
  state: UpgradePoolState,
  options: DrawHandOptions = {},
): UpgradeDefinition[] {
  const count = Math.max(0, Math.floor(options.count ?? CARDS_PER_HAND));
  const excluded = new Set(options.excludeIds ?? []);
  const hand: UpgradeDefinition[] = [];
  const taken = new Set<string>();

  const take = (list: readonly UpgradeDefinition[]): void => {
    for (const upgrade of shuffled(list, random)) {
      if (hand.length >= count) return;
      if (taken.has(upgrade.id) || excluded.has(upgrade.id)) continue;
      hand.push(upgrade);
      taken.add(upgrade.id);
    }
  };

  const unowned = (upgrade: UpgradeDefinition): boolean =>
    (state.stacks.get(upgrade.id) ?? 0) === 0;

  // 1. 当前角色专属，未拥有。
  take(
    state.pool.filter(
      (upgrade) =>
        upgrade.owner === state.characterId && unowned(upgrade),
    ),
  );

  // 2. 未拥有的金色通用机制卡。
  if (hand.length < count) {
    take(
      state.pool.filter(
        (upgrade) =>
          upgrade.owner === 'general' &&
          upgrade.rarity === 'gold' &&
          unowned(upgrade),
      ),
    );
  }

  // 3. 有效银卡补齐（未满层即可，允许已拥有的银卡继续叠层）。
  if (hand.length < count) {
    take(
      listCandidates(state).filter((upgrade) => upgrade.rarity === 'silver'),
    );
  }

  return hand;
}

export type UpgradeChoiceKind = 'upgrade' | 'mechanic';

export interface UpgradeChoiceCallbacks {
  /** 按排除列表抽一手牌。 */
  readonly draw: (excludedIds: readonly string[]) => readonly UpgradeDefinition[];
  readonly rerollsRemaining: () => number;
  readonly consumeReroll: () => boolean;
  readonly acquire: (upgradeId: string) => void;
}

export interface UpgradeChoiceRestoreOptions {
  /** 续局恢复：直接使用快照里的手牌，不消耗随机序列、不重抽。 */
  readonly hand?: readonly UpgradeDefinition[];
  readonly focusIndex?: number;
}

/**
 * 一次三选一面板：维护当前手牌、键盘焦点、重抽与确认。
 * 确认只能发生一次；重抽只换当前手牌，不触碰已获得强化。
 */
export class UpgradeChoice {
  readonly kind: UpgradeChoiceKind;

  private readonly drawCallback: UpgradeChoiceCallbacks['draw'];
  private readonly rerollsRemainingCallback: UpgradeChoiceCallbacks['rerollsRemaining'];
  private readonly consumeRerollCallback: UpgradeChoiceCallbacks['consumeReroll'];
  private readonly acquireCallback: UpgradeChoiceCallbacks['acquire'];

  private handValue: readonly UpgradeDefinition[];
  private focusIndexValue = 0;
  private confirmedValue: UpgradeDefinition | null = null;

  constructor(
    kind: UpgradeChoiceKind,
    callbacks: UpgradeChoiceCallbacks,
    restore: UpgradeChoiceRestoreOptions = {},
  ) {
    this.kind = kind;
    this.drawCallback = callbacks.draw;
    this.rerollsRemainingCallback = callbacks.rerollsRemaining;
    this.consumeRerollCallback = callbacks.consumeReroll;
    this.acquireCallback = callbacks.acquire;
    if (restore.hand && restore.hand.length > 0) {
      this.handValue = [...restore.hand];
      this.focusIndexValue = Math.min(
        restore.hand.length - 1,
        Math.max(0, Math.trunc(restore.focusIndex ?? 0)),
      );
    } else {
      this.handValue = this.drawCallback([]);
    }
  }

  get hand(): readonly UpgradeDefinition[] {
    return this.handValue;
  }

  get focusIndex(): number {
    return this.focusIndexValue;
  }

  get focusedCard(): UpgradeDefinition | null {
    return this.handValue[this.focusIndexValue] ?? null;
  }

  /** 已确认的卡片；未确认或本次确认已消费时为 null。 */
  get confirmed(): UpgradeDefinition | null {
    return this.confirmedValue;
  }

  get rerollsRemaining(): number {
    return this.rerollsRemainingCallback();
  }

  get canReroll(): boolean {
    return this.confirmedValue === null && this.rerollsRemaining > 0;
  }

  /** 焦点在 0..手牌数−1 内移动，布局边界不跳到无关控件。 */
  moveFocus(delta: number): number {
    if (this.handValue.length === 0) return 0;
    const next = this.focusIndexValue + Math.trunc(delta);
    this.focusIndexValue = Math.min(
      this.handValue.length - 1,
      Math.max(0, next),
    );
    return this.focusIndexValue;
  }

  /** 数字键 1–3 直接跳转到对应卡；越界忽略。 */
  focusTo(index: number): number {
    const target = Math.trunc(index);
    if (target >= 0 && target < this.handValue.length) {
      this.focusIndexValue = target;
    }
    return this.focusIndexValue;
  }

  /**
   * 重抽当前 3 张并扣除一次次数。
   * 池足够时新牌排除旧 3 张；不足时允许交集，但同一手不重复。
   */
  reroll(): boolean {
    if (!this.canReroll) return false;

    const previousIds = this.handValue.map((upgrade) => upgrade.id);
    let next = this.drawCallback(previousIds);
    if (next.length < CARDS_PER_HAND) {
      next = this.drawCallback([]);
    }
    if (next.length === 0) return false;
    if (!this.consumeRerollCallback()) return false;

    this.handValue = next;
    this.focusIndexValue = 0;
    this.confirmedValue = null;
    return true;
  }

  /** 确认焦点卡；每次面板只能确认一次。 */
  confirm(): UpgradeDefinition | null {
    if (this.confirmedValue !== null) return null;
    const card = this.handValue[this.focusIndexValue];
    if (!card) return null;
    this.confirmedValue = card;
    this.acquireCallback(card.id);
    return card;
  }
}

export interface UpgradeRunConfig {
  readonly characterId: CharacterId;
  /** 默认使用正式 24 张强化池；测试可注入临时数据。 */
  readonly pool?: readonly UpgradeDefinition[];
  /** 本局种子；同种子与同操作序列产生同结果。 */
  readonly seed: number;
  /**
   * 本局奖励随机流；商店/海克斯/波末奖励共用这一条。
   * 不传时按 `seed` 自建一条（纯模块测试与旧调用方兼容）。
   */
  readonly random?: RandomSource;
  /** 本局重抽次数，默认 2。 */
  readonly rerolls?: number;
}

/** 续局恢复用的已选强化层数与随机状态。 */
export interface UpgradeRunRestoreState {
  readonly stacks: readonly { readonly id: string; readonly stacks: number }[];
  readonly rerollsRemaining: number;
  readonly randomState: number;
}

/** 续局恢复手牌：只给出卡片 ID，由 `UpgradeRun` 校验后解析为正式数据。 */
export interface UpgradeChoiceRestoreRequest {
  readonly hand?: readonly string[];
  readonly focusIndex?: number;
}

/**
 * 一局游戏的强化状态：已获得层数、剩余重抽次数与奖励随机序列。
 * 每打开一次三选一面板创建一个 `UpgradeChoice`，共享同一随机序列。
 */
export class UpgradeRun {
  readonly characterId: CharacterId;
  readonly pool: readonly UpgradeDefinition[];
  readonly seed: number;

  private readonly random: RandomSource;
  private readonly stacksValue = new Map<string, number>();
  private rerollsRemainingValue: number;

  constructor(config: UpgradeRunConfig) {
    this.characterId = config.characterId;
    this.pool = config.pool ?? UPGRADE_LIST;
    this.seed = config.seed;
    // 场景注入共享的 reward 流；纯模块调用方仍可只给 seed。
    this.random = config.random ?? new SeededRandom(config.seed);
    this.rerollsRemainingValue = Math.max(
      0,
      Math.floor(config.rerolls ?? DEFAULT_REROLLS_PER_RUN),
    );
  }

  get rerollsRemaining(): number {
    return this.rerollsRemainingValue;
  }

  /** 当前奖励随机序列的内部状态；续局快照保存后，刷新不重抽也不改变后续序列。 */
  get randomState(): number {
    return this.random.snapshotState;
  }

  /**
   * 从续局快照恢复：先清空层数，再写入合法层数、重抽次数与随机状态。
   * 未知或超出上限的卡片直接忽略；非法随机状态保持原序列。
   */
  restore(state: UpgradeRunRestoreState): void {
    this.stacksValue.clear();
    for (const entry of state.stacks) {
      const upgrade = this.pool.find((card) => card.id === entry.id);
      if (!upgrade) continue;
      const stacks = Math.min(
        upgrade.maxStacks,
        Math.max(0, Math.floor(entry.stacks)),
      );
      if (stacks > 0) this.stacksValue.set(upgrade.id, stacks);
    }
    this.rerollsRemainingValue = Math.max(
      0,
      Math.floor(state.rerollsRemaining),
    );
    this.random.restoreState(state.randomState);
  }

  /** 已获得强化 ID → 层数（只读视图）。 */
  get stacks(): ReadonlyMap<string, number> {
    return this.stacksValue;
  }

  stacksOf(upgradeId: string): number {
    return this.stacksValue.get(upgradeId) ?? 0;
  }

  ownedIds(): string[] {
    return [...this.stacksValue.entries()]
      .filter(([, stacks]) => stacks > 0)
      .map(([id]) => id);
  }

  /** 记录一次选择并返回新的层数；不会超过卡面层数上限。 */
  acquire(upgradeId: string): number {
    const upgrade = this.pool.find((entry) => entry.id === upgradeId);
    if (!upgrade) {
      throw new Error(`Unknown upgrade id: ${upgradeId}`);
    }
    const current = this.stacksOf(upgradeId);
    const next = Math.min(upgrade.maxStacks, current + 1);
    this.stacksValue.set(upgradeId, next);
    return next;
  }

  createChoice(
    kind: UpgradeChoiceKind,
    restore: UpgradeChoiceRestoreRequest = {},
  ): UpgradeChoice {
    const state = (): UpgradePoolState => ({
      characterId: this.characterId,
      pool: this.pool,
      stacks: this.stacksValue,
    });

    // 续局恢复：快照里的手牌原样解析为正式卡片，不调用抽卡、不消耗随机序列。
    let restoredHand: UpgradeDefinition[] | undefined;
    if (restore.hand && restore.hand.length > 0) {
      const cards = restore.hand.map((id) =>
        this.pool.find((card) => card.id === id),
      );
      const valid = cards.every(
        (card): card is UpgradeDefinition =>
          card !== undefined && isUpgradeAvailable(card, state()),
      );
      if (valid) {
        restoredHand = cards.filter(
          (card): card is UpgradeDefinition => card !== undefined,
        );
      }
    }

    return new UpgradeChoice(
      kind,
      {
        draw: (excludedIds) =>
          kind === 'upgrade'
            ? drawUpgradeHand(() => this.random.next(), state(), { excludeIds: excludedIds })
            : drawMechanicHand(() => this.random.next(), state(), { excludeIds: excludedIds }),
        rerollsRemaining: () => this.rerollsRemainingValue,
        consumeReroll: () => {
          if (this.rerollsRemainingValue <= 0) return false;
          this.rerollsRemainingValue -= 1;
          return true;
        },
        acquire: (upgradeId) => {
          this.acquire(upgradeId);
        },
      },
      {
        hand: restoredHand,
        focusIndex: restoredHand ? restore.focusIndex : 0,
      },
    );
  }
}
