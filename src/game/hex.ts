/**
 * 海克斯池、前置筛选与三选一（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/02-content-catalog.md` §48 种海克斯、
 * `01-systems-and-balance.md` §钱与经验各管一件事：
 * - H01–H48 分通用 24 与四职业各 6；品质银/金/棱彩基础权重 45/40/15；
 * - 只有当前职业可用的海克斯进池；前置不满足的牌不出现；
 * - 全部最高 1 层，已获得的牌不再进池，同一手不重复；
 * - 某品质没有候选时移出并按剩余可用权重重归一化；池空时返回空手牌，
 *   由调用方显示明确兜底提示，不静默卡死；
 * - 抽取只消费调用方注入的单一随机源（本局 `reward` 流），按顺序取数。
 */
import {
  HEX_LIST,
  type HexDefinition,
  type HexOwner,
  type HexRarity,
} from './data/catalog';
import type { CharacterId } from './data/characters';
import { SeededRandom, type RandomSource } from './random';

/** 品质基础权重；某品质无可用牌时整档移出再重归一化。 */
export const HEX_RARITY_WEIGHTS: Readonly<Record<HexRarity, number>> = {
  银: 45,
  金: 40,
  棱彩: 15,
};

/** 固定权重顺序，保证同种子抽取可重现。 */
export const HEX_RARITY_ORDER: readonly HexRarity[] = ['银', '金', '棱彩'];

/** 每次三选一的卡片数。 */
export const HEX_CARDS_PER_HAND = 3;

/** 全部海克斯最高 1 层。 */
export const HEX_MAX_STACKS = 1;

/** 职业 ID → 海克斯归属名。 */
export const HEX_OWNER_BY_CHARACTER: Readonly<Record<CharacterId, HexOwner>> = {
  vishdal: '爆破手',
  amiya: '术士',
  saria: '骑士',
  muelsyse: '战术家',
};

/** 提供召唤物的自由技能；与职业本体召唤来源一起满足召唤前置。 */
export const HEX_SUMMON_FREE_SKILL_IDS: readonly string[] = ['S05', 'S09'];

/** 职业本体自带召唤物的角色：爆破手魂灵、战术家流形。 */
const CHARACTER_SUMMON_SOURCES: ReadonlySet<CharacterId> = new Set<CharacterId>([
  'vishdal',
  'muelsyse',
]);

/** J 为近战扇面的角色：弹道尺寸/折返类海克斯对其不适用。 */
const MELEE_ATTACK_CHARACTERS: ReadonlySet<CharacterId> = new Set<CharacterId>([
  'saria',
]);

/**
 * 单张海克斯的前置条件。未列出的 ID 没有额外前置，只受职业归属与唯一层数约束。
 */
export interface HexPrerequisite {
  /** 至少装备几个自由技能（U/I）。 */
  readonly minFreeSkills?: number;
  /** 需要至少一个召唤来源：职业本体或 S05/S09。 */
  readonly requiresSummonSource?: boolean;
  /** 需要 J 为弹道攻击。 */
  readonly requiresProjectileAttack?: boolean;
}

/**
 * 前置条件表。按卡面实际依赖声明，避免把「当前构筑用不上」的牌塞进手牌：
 * - H01 依赖 U/I 施放，H08/H16 依赖两个槽位都装备技能；
 * - H07 依赖召唤物消失，H14/H15 依赖 J 为弹道攻击。
 */
export const HEX_PREREQUISITES: Readonly<Record<string, HexPrerequisite>> = {
  H01: { minFreeSkills: 1 },
  H07: { requiresSummonSource: true },
  H08: { minFreeSkills: 2 },
  H14: { requiresProjectileAttack: true },
  H15: { requiresProjectileAttack: true },
  H16: { minFreeSkills: 2 },
};

/** 抽取时使用的状态：职业、已拥有海克斯与当前自由技能装配。 */
export interface HexPoolState {
  readonly characterId: CharacterId;
  readonly ownedHexIds: ReadonlySet<string>;
  readonly freeSkillIds: readonly string[];
}

export interface DrawHexHandOptions {
  readonly count?: number;
}

/** 当前角色对应的海克斯归属名。 */
export function hexOwnerForCharacter(characterId: CharacterId): HexOwner {
  return HEX_OWNER_BY_CHARACTER[characterId];
}

/** 前置条件是否满足；未声明的 ID 默认满足。 */
export function meetsHexPrerequisite(
  hexId: string,
  state: HexPoolState,
): boolean {
  const prerequisite = HEX_PREREQUISITES[hexId];
  if (!prerequisite) return true;

  const minFreeSkills = prerequisite.minFreeSkills ?? 0;
  if (minFreeSkills > 0) {
    const equipped = new Set(state.freeSkillIds.filter((id) => id.length > 0));
    if (equipped.size < minFreeSkills) return false;
  }

  if (prerequisite.requiresSummonSource) {
    const hasSkillSummon = state.freeSkillIds.some((id) =>
      HEX_SUMMON_FREE_SKILL_IDS.includes(id),
    );
    if (!CHARACTER_SUMMON_SOURCES.has(state.characterId) && !hasSkillSummon) {
      return false;
    }
  }

  if (prerequisite.requiresProjectileAttack) {
    if (MELEE_ATTACK_CHARACTERS.has(state.characterId)) return false;
  }

  return true;
}

/**
 * 该海克斯是否进入当前池：职业匹配、未获得（最高 1 层）且前置满足。
 * 已拥有的 ID 只认卡池内的正式数据，未知 ID 不会让池子异常。
 */
export function isHexAvailable(
  hex: HexDefinition,
  state: HexPoolState,
): boolean {
  if (hex.owner !== '通用' && hex.owner !== hexOwnerForCharacter(state.characterId)) {
    return false;
  }
  if (state.ownedHexIds.has(hex.id)) return false;
  return meetsHexPrerequisite(hex.id, state);
}

/** 当前可抽的全部候选。 */
export function listAvailableHexes(
  state: HexPoolState,
  pool: readonly HexDefinition[] = HEX_LIST,
): HexDefinition[] {
  return pool.filter((hex) => isHexAvailable(hex, state));
}

/**
 * 抽一手海克斯。按银/金/棱彩 45/40/15 先选品质，再在同品质内等概率选牌；
 * 某品质无候选时移出并按剩余权重重归一化。同一手不重复。
 * 抽取顺序固定为「品质 → 牌」，每次抽牌消费两次随机数（池空时提前结束）。
 */
export function drawHexHand(
  random: () => number,
  state: HexPoolState,
  options: DrawHexHandOptions = {},
  pool: readonly HexDefinition[] = HEX_LIST,
): HexDefinition[] {
  const count = Math.max(0, Math.floor(options.count ?? HEX_CARDS_PER_HAND));
  let candidates = listAvailableHexes(state, pool);
  const hand: HexDefinition[] = [];

  while (hand.length < count) {
    const byRarity: Record<HexRarity, HexDefinition[]> = {
      银: [],
      金: [],
      棱彩: [],
    };
    for (const hex of candidates) byRarity[hex.rarity].push(hex);

    const available = HEX_RARITY_ORDER.filter(
      (rarity) => byRarity[rarity].length > 0,
    );
    if (available.length === 0) break;

    const totalWeight = available.reduce(
      (total, rarity) => total + HEX_RARITY_WEIGHTS[rarity],
      0,
    );
    let roll = random() * totalWeight;
    let pickedRarity = available[available.length - 1] as HexRarity;
    for (const rarity of available) {
      roll -= HEX_RARITY_WEIGHTS[rarity];
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
    candidates = candidates.filter((candidate) => candidate.id !== card.id);
  }

  return hand;
}

/** 空池兜底提示；由场景在 `hand.length === 0` 时显示，按 Enter 消费本次选择。 */
export const EMPTY_HEX_POOL_PROMPT = '没有可选海克斯\n按 Enter 继续';

/** 续局恢复手牌：只给卡片 ID，由 `HexRun` 校验后解析为正式数据。 */
export interface HexChoiceRestoreRequest {
  readonly hand?: readonly string[];
  readonly focusIndex?: number;
}

/** 一次海克斯三选一面板：焦点移动与单次确认；不提供重抽。 */
export class HexChoice {
  readonly kind = 'hex' as const;

  private readonly acquireCallback: (hexId: string) => boolean;
  private handValue: readonly HexDefinition[];
  private focusIndexValue = 0;
  private confirmedValue: HexDefinition | null = null;

  constructor(
    hand: readonly HexDefinition[],
    acquire: (hexId: string) => boolean,
    restore: { readonly focusIndex?: number } = {},
  ) {
    this.handValue = [...hand];
    this.acquireCallback = acquire;
    this.focusIndexValue = Math.min(
      Math.max(0, this.handValue.length - 1),
      Math.max(0, Math.trunc(restore.focusIndex ?? 0)),
    );
  }

  get hand(): readonly HexDefinition[] {
    return this.handValue;
  }

  get focusIndex(): number {
    return this.focusIndexValue;
  }

  get focusedCard(): HexDefinition | null {
    return this.handValue[this.focusIndexValue] ?? null;
  }

  /** 已确认的卡片；每次面板只能确认一次。 */
  get confirmed(): HexDefinition | null {
    return this.confirmedValue;
  }

  /** 海克斯三选一没有重抽；保留只读属性便于面板共用。 */
  get rerollsRemaining(): number {
    return 0;
  }

  get canReroll(): boolean {
    return false;
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

  /** 确认焦点卡并写入唯一层数；写入失败（未知/已拥有）时不确认。 */
  confirm(): HexDefinition | null {
    if (this.confirmedValue !== null) return null;
    const card = this.handValue[this.focusIndexValue];
    if (!card) return null;
    if (!this.acquireCallback(card.id)) return null;
    this.confirmedValue = card;
    return card;
  }
}

export interface HexRunConfig {
  readonly characterId: CharacterId;
  /** 默认使用正式 48 张海克斯池；测试可注入临时数据。 */
  readonly pool?: readonly HexDefinition[];
  /** 本局种子；不传 `random` 时按它自建一条随机流。 */
  readonly seed?: number;
  /** 本局奖励随机流；商店/海克斯/波末奖励共用这一条。 */
  readonly random?: RandomSource;
  /** 当前已装备的自由技能；用于前置筛选，每次抽手时读取。 */
  readonly freeSkillIds?: () => readonly string[];
}

/** 续局恢复用的海克斯拥有列表与随机状态。 */
export interface HexRunRestoreState {
  readonly hexes?: readonly string[];
  readonly randomState?: number;
}

/**
 * 一局游戏的海克斯状态：唯一拥有集合与奖励随机序列。
 * 每种最高 1 层；重复获得返回 false，不会叠加。
 */
export class HexRun {
  readonly characterId: CharacterId;
  readonly pool: readonly HexDefinition[];

  private readonly random: RandomSource;
  private readonly freeSkillIdsCallback: () => readonly string[];
  private readonly owned = new Set<string>();

  constructor(config: HexRunConfig) {
    this.characterId = config.characterId;
    this.pool = config.pool ?? HEX_LIST;
    this.random = config.random ?? new SeededRandom(config.seed ?? 1);
    this.freeSkillIdsCallback = config.freeSkillIds ?? (() => []);
  }

  /** 已拥有海克斯 ID，按获得顺序。 */
  get ownedIds(): string[] {
    return [...this.owned];
  }

  get ownedCount(): number {
    return this.owned.size;
  }

  /** 当前奖励随机序列状态；续局快照保存后刷新不改变手牌。 */
  get randomState(): number {
    return this.random.snapshotState;
  }

  /** 是否已经拥有；海克斯最高 1 层。 */
  has(hexId: string): boolean {
    return this.owned.has(hexId);
  }

  /**
   * 记录一次获得。未知 ID、其他职业专属或已拥有时返回 false。
   * 前置条件只影响是否进池，不影响已经确认的获得。
   */
  acquire(hexId: string): boolean {
    const hex = this.pool.find((entry) => entry.id === hexId);
    if (!hex) return false;
    if (this.owned.has(hexId)) return false;
    if (
      hex.owner !== '通用' &&
      hex.owner !== hexOwnerForCharacter(this.characterId)
    ) {
      return false;
    }
    this.owned.add(hexId);
    return true;
  }

  /** 从续局快照恢复：忽略未知/重复/其他职业的 ID；非法随机状态保持原序列。 */
  restore(state: HexRunRestoreState): void {
    this.owned.clear();
    if (Array.isArray(state.hexes)) {
      for (const hexId of state.hexes) {
        if (typeof hexId === 'string') this.acquire(hexId);
      }
    }
    if (state.randomState !== undefined) {
      this.random.restoreState(state.randomState);
    }
  }

  /**
   * 创建一次三选一。快照里的手牌原样解析：只校验目录归属与唯一层数，
   * 不重新检查前置——手牌在生成时已固定，刷新不能因构筑上下文差异而重抽。
   * 未知/已获得/其他职业的 ID 才会退回重新抽取。
   */
  createChoice(restore: HexChoiceRestoreRequest = {}): HexChoice {
    let restoredHand: HexDefinition[] | undefined;
    if (restore.hand && restore.hand.length > 0) {
      const cards = restore.hand.map((id) =>
        this.pool.find((entry) => entry.id === id),
      );
      const valid =
        cards.length > 0 &&
        cards.every(
          (card): card is HexDefinition =>
            card !== undefined &&
            !this.owned.has(card.id) &&
            (card.owner === '通用' ||
              card.owner === hexOwnerForCharacter(this.characterId)),
        );
      if (valid) restoredHand = cards.filter((card) => card !== undefined);
    }

    const hand =
      restoredHand ??
      drawHexHand(
        () => this.random.next(),
        this.poolState(),
        {},
        this.pool,
      );

    return new HexChoice(
      hand,
      (hexId) => this.acquire(hexId),
      { focusIndex: restoredHand ? restore.focusIndex : 0 },
    );
  }

  private poolState(): HexPoolState {
    return {
      characterId: this.characterId,
      ownedHexIds: this.owned,
      freeSkillIds: this.freeSkillIdsCallback(),
    };
  }
}
