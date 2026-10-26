/**
 * 精英核心波末三选一（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §精英核心：
 * - 击败指定精英后记 1 个核心资格，波末从 E01–E08 三选一；
 * - 至少一项匹配当前角色或已拥有标签，至少一项为通用生存/经济方向；
 * - 不出现已拥有核心，同一手候选不重复；
 * - 核心唯一、不出售，不能从商店或宝箱获得；
 * - 候选在资格生成时用 `reward` 随机流固定，写入奖励队列后不再重抽。
 */
import {
  getEliteCore,
  listEliteCores,
  type CharacterId,
  type EliteCoreDefinition,
} from './data';

/** 每个核心资格展示的候选数量。 */
export const CORE_OFFER_COUNT = 3;

/**
 * 通用生存/经济方向的核心：不依赖任何角色专属机制。
 * E03 不屈圣印（防护保命）、E05 猎金之约（经济）、E07 逆风齿轮（生存）。
 */
export const GENERIC_CORE_IDS: readonly string[] = ['E03', 'E05', 'E07'];

/** 全部精英核心 ID；存档与候选校验只接受这些值。 */
export const ELITE_CORE_IDS: ReadonlySet<string> = new Set(
  listEliteCores().map((core) => core.id),
);

/** 当前角色自带的构筑标签；与内容目录的 core.tag 同名比较。 */
const CHARACTER_CORE_TAGS: Readonly<Record<CharacterId, readonly string[]>> = {
  // 榴弹与爆发：爆破、弹道、技能。
  vishdal: ['爆破', '弹道', '技能'],
  // 术式与奇美拉：奥术、弹道、技能。
  amiya: ['奥术', '弹道', '技能'],
  // 盾击与治疗领域：防护、生存、技能。
  saria: ['防护', '生存', '技能'],
  // 流形召唤：召唤、技能。
  muelsyse: ['召唤', '技能'],
};

export interface CoreOfferDrawState {
  readonly characterId: CharacterId;
  /** 已拥有核心 ID，必须从候选中排除。 */
  readonly ownedCoreIds: readonly string[];
  /** 已拥有永久道具的目录标签（如 `爆破`、`奥术`），用于“已拥有标签”匹配。 */
  readonly ownedItemTags?: readonly string[];
}

export type CoreOfferReason = 'three' | 'partial' | 'no-valid-cores';

export interface CoreOfferDraw {
  /** 展示顺序即抽取顺序；空数组表示没有可用核心。 */
  readonly coreIds: readonly string[];
  readonly reason: CoreOfferReason;
}

/** 是否精英核心 ID；未知值返回 false。 */
export function isEliteCoreId(value: string): boolean {
  return ELITE_CORE_IDS.has(value);
}

/** 允许出场的标签：角色自带 + 已拥有道具/核心的标签。 */
export function compatibleCoreTags(state: CoreOfferDrawState): Set<string> {
  const tags = new Set<string>(CHARACTER_CORE_TAGS[state.characterId] ?? []);
  for (const tag of state.ownedItemTags ?? []) tags.add(tag);
  for (const coreId of state.ownedCoreIds) {
    const core = getEliteCore(coreId);
    if (core) tags.add(core.tag);
  }
  return tags;
}

/** 未拥有且按目录顺序排列的核心候选。 */
export function listCoreCandidates(
  state: CoreOfferDrawState,
): EliteCoreDefinition[] {
  const owned = new Set(state.ownedCoreIds);
  return listEliteCores().filter((core) => !owned.has(core.id));
}

/** 从候选池随机取一个并从池中移除；空池返回 null。 */
function takeRandom(
  random: () => number,
  pool: EliteCoreDefinition[],
): EliteCoreDefinition | null {
  if (pool.length === 0) return null;
  const index = Math.min(
    pool.length - 1,
    Math.max(0, Math.floor(random() * pool.length)),
  );
  const [picked] = pool.splice(index, 1);
  return picked ?? null;
}

/**
 * 从剩余池中移除已选核心。
 * 通用/兼容池是 `remaining` 的过滤副本，`takeRandom` 只从副本里 splice，
 * 若不同步移除，补齐阶段会再次抽到同一核心，产生重复候选。
 */
function removePicked(
  pool: EliteCoreDefinition[],
  core: EliteCoreDefinition,
): void {
  const index = pool.indexOf(core);
  if (index >= 0) pool.splice(index, 1);
}

/**
 * 抽取一个核心资格的三张候选：
 * 1. 先取一张通用生存/经济核心（若仍有未拥有的）；
 * 2. 若手牌还没有匹配角色/已拥有标签的核心，再补一张；
 * 3. 剩余名额从全部未拥有核心中随机补齐，保证不重复。
 * 池子耗尽时返回实际数量（`partial`），完全为空时返回空数组。
 */
export function drawCoreOffers(
  random: () => number,
  state: CoreOfferDrawState,
): CoreOfferDraw {
  const remaining = listCoreCandidates(state);
  if (remaining.length === 0) {
    return { coreIds: [], reason: 'no-valid-cores' };
  }

  const tags = compatibleCoreTags(state);
  const picks: EliteCoreDefinition[] = [];
  const count = Math.min(CORE_OFFER_COUNT, remaining.length);

  const hasGeneric = (): boolean =>
    picks.some((core) => GENERIC_CORE_IDS.includes(core.id));
  const hasCompatible = (): boolean => picks.some((core) => tags.has(core.tag));

  if (!hasGeneric()) {
    const genericPool = remaining.filter((core) =>
      GENERIC_CORE_IDS.includes(core.id),
    );
    const picked = takeRandom(random, genericPool);
    if (picked) {
      picks.push(picked);
      removePicked(remaining, picked);
    }
  }

  if (!hasCompatible()) {
    const compatiblePool = remaining.filter((core) => tags.has(core.tag));
    const picked = takeRandom(random, compatiblePool);
    if (picked) {
      picks.push(picked);
      removePicked(remaining, picked);
    }
  }

  while (picks.length < count) {
    const picked = takeRandom(random, remaining);
    if (!picked) break;
    picks.push(picked);
  }

  return {
    coreIds: picks.map((core) => core.id),
    reason: picks.length >= CORE_OFFER_COUNT ? 'three' : 'partial',
  };
}

/** 卡面需要的已揭示数据；从目录派生，不写入存档。 */
export interface CoreOfferDisplay {
  readonly coreId: string;
  readonly name: string;
  readonly tag: string;
  readonly effect: string;
}

/** 把候选 ID 展开成卡面数据；未知 ID 被忽略。 */
export function describeCoreOffers(
  coreIds: readonly string[],
): CoreOfferDisplay[] {
  return coreIds.flatMap((coreId) => {
    const core = getEliteCore(coreId);
    if (!core) return [];
    return [
      {
        coreId: core.id,
        name: core.name,
        tag: core.tag,
        effect: core.effect,
      },
    ];
  });
}

/** 单张核心卡：名称、标签与完整效果在确认前同屏可见。 */
export function formatCoreOfferCard(
  offer: CoreOfferDisplay,
  index: number,
  focused: boolean,
): string {
  return [
    `${focused ? '▶' : ' '} [${index + 1}] ${offer.name} · 精英核心`,
    `标签：${offer.tag}`,
    '',
    `效果：${offer.effect}`,
    '',
    '唯一：获得后不再进入核心候选，不可出售',
  ].join('\n');
}

/** 没有可用核心候选时的兜底文案；不做金币替代。 */
export function formatCoreFallbackPrompt(): string {
  return [
    '精英核心',
    '本波已没有可用核心候选',
    '按 Enter 继续（不补金币、不重复获得）',
  ].join('\n');
}

export interface CoreOfferEntryLike {
  readonly coreOffers?: readonly string[];
}

/**
 * 解析一次核心领取：按焦点返回候选核心 ID。
 * 没有候选、焦点越界或候选不是已知核心时返回 null。
 */
export function resolveCoreClaim(
  entry: CoreOfferEntryLike,
  selectedIndex = 0,
): string | null {
  const offers = entry.coreOffers ?? [];
  const index = Math.floor(selectedIndex);
  if (!Number.isInteger(index) || index < 0 || index >= offers.length) {
    return null;
  }
  const coreId = offers[index];
  return coreId && ELITE_CORE_IDS.has(coreId) ? coreId : null;
}
