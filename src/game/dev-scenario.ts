/**
 * 开发环境场景参数（docs/game-design.md §10）。
 *
 * 只在 `import.meta.env.DEV` 分支内调用；生产构建会把整个入口摇掉。
 * URL 形如 `?dev=1&seed=20261020&character=amiya&wave=5&enemies=chaser:3,shooter:2&upgrades=W01,W02`：
 * - `dev=1` 启用开发入口；
 * - `seed` 固定本局强化随机序列；
 * - `character` 指定本局角色（由应用壳直接开局）；
 * - `wave` 从指定波次开始（1–9）；
 * - `enemies` 覆盖起始波的实际敌人组合，格式 `id:数量`，逗号分隔；
 * - `upgrades` 开局直接授予指定强化，格式 `id,id`，重复 ID 按层数逐次授予；
 * - `perf=1` 进入隔离性能场景：跳过波次流程，持续维持固定数量的敌人、敌弹与
 *   流形，用于 `tools/perf/perf-check.mjs` 的 60 秒帧率与重开泄漏检查。
 * 非法字段单独忽略，回退到正常流程，避免开发页因一个笔误完全打不开。
 */
import { isCharacterId, type CharacterId } from './data/characters';
import { NORMAL_ENEMY_LIST, type EnemyId } from './data/enemies';
import { UPGRADE_LIST } from './data/upgrades';
import { TOTAL_WAVES, type WaveDefinition } from './data/waves';

/** 单个场景允许生成的最大敌人总数；覆盖常规第 8 波的 36。 */
export const DEV_SCENARIO_MAX_ENEMIES = 120;

/** 单个敌人类型允许的最大数量。 */
export const DEV_SCENARIO_MAX_ENEMIES_PER_GROUP = 60;

/** 开发场景一次可预置的强化条目上限（按全部卡满层计）。 */
export const DEV_SCENARIO_MAX_UPGRADES = UPGRADE_LIST.reduce(
  (total, upgrade) => total + upgrade.maxStacks,
  0,
);

/** 性能场景规格（docs/game-design.md §10）：80 敌人、40 弹体、3 流形同屏 60 秒。 */
export const DEV_PERF_ENEMY_COUNT = 80;
export const DEV_PERF_ENEMY_PROJECTILE_COUNT = 40;
/** 主流形 + 2 个远程副本。 */
export const DEV_PERF_MANIFOLD_COUNT = 3;
export const DEV_PERF_DURATION_SECONDS = 60;

const NORMAL_ENEMY_IDS: ReadonlySet<string> = new Set(
  NORMAL_ENEMY_LIST.map((enemy) => enemy.id),
);

const KNOWN_UPGRADE_IDS: ReadonlySet<string> = new Set(
  UPGRADE_LIST.map((upgrade) => upgrade.id),
);

export interface DevEnemyGroup {
  readonly enemyId: EnemyId;
  readonly count: number;
}

export interface DevScenario {
  readonly seed: number | null;
  readonly characterId: CharacterId | null;
  readonly wave: number | null;
  readonly enemies: readonly DevEnemyGroup[] | null;
  /** 开局直接授予的强化 ID；重复 ID 按层数逐次授予（上限由卡片 maxStacks 决定）。 */
  readonly upgrades: readonly string[] | null;
  /** 隔离性能场景；开启后不进入正常波次流程。 */
  readonly perf: boolean;
}

function parseSeed(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw) >>> 0;
}

function parseCharacterId(raw: string | null): CharacterId | null {
  return isCharacterId(raw) ? raw : null;
}

function parseWave(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const wave = Number(raw);
  return Number.isInteger(wave) && wave >= 1 && wave <= TOTAL_WAVES ? wave : null;
}

function parseEnemyGroups(raw: string | null): readonly DevEnemyGroup[] | null {
  if (!raw) return null;

  const groups: DevEnemyGroup[] = [];
  let total = 0;
  for (const part of raw.split(',')) {
    const [id, countText, extra] = part.split(':');
    if (!id || !countText || extra !== undefined) return null;
    if (!NORMAL_ENEMY_IDS.has(id)) return null;

    const count = Number(countText);
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > DEV_SCENARIO_MAX_ENEMIES_PER_GROUP
    ) {
      return null;
    }
    total += count;
    if (total > DEV_SCENARIO_MAX_ENEMIES) return null;

    groups.push({ enemyId: id as EnemyId, count });
  }

  return groups.length > 0 ? groups : null;
}

function parseUpgradeIds(raw: string | null): readonly string[] | null {
  if (!raw) return null;

  const ids: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (!KNOWN_UPGRADE_IDS.has(id)) return null;
    ids.push(id);
  }

  // 重复 ID 保留，便于开发场景直接把银卡叠到 3 层复现组合差异。
  if (ids.length === 0 || ids.length > DEV_SCENARIO_MAX_UPGRADES) return null;
  return ids;
}

/**
 * 解析开发场景参数；没有 `dev=1` 时返回 null，调用方按正常流程启动。
 * 纯函数，不读取 `location`，便于单测固定 URL 输入。
 */
export function parseDevScenario(search: string): DevScenario | null {
  const params = new URLSearchParams(search);
  if (params.get('dev') !== '1') return null;

  return {
    seed: parseSeed(params.get('seed')),
    characterId: parseCharacterId(params.get('character')),
    wave: parseWave(params.get('wave')),
    enemies: parseEnemyGroups(params.get('enemies')),
    upgrades: parseUpgradeIds(params.get('upgrades')),
    perf: params.get('perf') === '1',
  };
}

/**
 * 用场景参数替换起始波的刷怪名册：数量取组合总和、不额外刷精英。
 * 波次生命/伤害倍率与 Boss 波语义保持不变（Boss 波忽略组合覆盖）。
 */
export function applyScenarioToWave(
  definition: WaveDefinition,
  groups: readonly DevEnemyGroup[],
): WaveDefinition {
  if (definition.kind === 'boss') return definition;

  const roster: EnemyId[] = [];
  for (const group of groups) {
    for (let index = 0; index < group.count; index += 1) {
      roster.push(group.enemyId);
    }
  }

  return {
    ...definition,
    enemyCount: roster.length,
    eliteCount: 0,
    eliteEnemyId: undefined,
    roster,
  };
}

/** 场景起始波：未指定时仍从第 1 波开始。 */
export function scenarioStartWave(scenario: DevScenario | null): number {
  return scenario?.wave ?? 1;
}
