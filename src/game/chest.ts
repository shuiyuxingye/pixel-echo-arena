/**
 * 宝箱规则（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §宝箱：
 * - 第 2/5/8/11/14/17 波各 1 个，波开始 8 秒出现；
 * - 生命 `45 + 6 × 波数`、无护甲；可被普攻/技能破坏，敌人不会攻击它；
 * - 打破只增加 1 个待领取资格，战斗内不弹窗、不立即发道具；
 * - 未打破的宝箱随波结束消失，不记资格；
 * - 宝箱不是敌人，不产生击杀金币/经验/成长。
 *
 * 生成位置保证在可达地面、离玩家至少 160、离敌人出生点至少 120、不卡墙。
 */
import { isCircleBlocked, type ArenaLayout, type Point } from './arena';
import { Combatant } from './combat';
import type { CombatEventSink } from './damage-events';

/** 会刷新宝箱的波次。 */
export const CHEST_WAVES: readonly number[] = [2, 5, 8, 11, 14, 17];

/** 宝箱在波开始后多少秒出现（倒计时不计入）。 */
export const CHEST_SPAWN_DELAY_SECONDS = 8;

/** 生成时与玩家的最小距离。 */
export const CHEST_MIN_PLAYER_DISTANCE = 160;

/** 生成时与任一敌人出生点的最小距离。 */
export const CHEST_MIN_ENEMY_SPAWN_DISTANCE = 120;

/** 宝箱基础生命与每波生命增量。 */
export const CHEST_BASE_HEALTH = 45;
export const CHEST_HEALTH_PER_WAVE = 6;

/** 宝箱碰撞/绘制半径（逻辑像素）。 */
export const CHEST_RADIUS = 16;

/** 生成位置与墙体/掩体之间额外保留的间距。 */
export const CHEST_SPAWN_CLEARANCE = 4;

const SPAWN_MAX_DISTANCE = 480;
const SPAWN_DISTANCE_STEP = 40;
const SPAWN_ANGLES = 24;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const REACHABILITY_GRID_STEP = 16;
const TIME_EPSILON = 1e-9;

/** 本波是否应刷新宝箱。 */
export function waveHasChest(wave: number): boolean {
  return CHEST_WAVES.includes(wave);
}

/** 宝箱生命：`45 + 6 × 波数`，无护甲。 */
export function chestMaxHealthForWave(wave: number): number {
  const safeWave = Number.isFinite(wave) ? Math.max(1, Math.floor(wave)) : 1;
  return CHEST_BASE_HEALTH + CHEST_HEALTH_PER_WAVE * safeWave;
}

/**
 * 波内计时是否已到宝箱出现时间。
 * 只有该波配置了宝箱且尚未生成时才返回 true，调用方据此只生成一次。
 */
export function shouldSpawnChest(
  wave: number,
  elapsedSeconds: number,
  alreadySpawned: boolean,
): boolean {
  if (alreadySpawned || !waveHasChest(wave)) return false;
  if (!Number.isFinite(elapsedSeconds)) return false;
  return elapsedSeconds + TIME_EPSILON >= CHEST_SPAWN_DELAY_SECONDS;
}

/**
 * 宝箱实体：沿用 `Combatant` 的受伤/死亡语义，但 `kind` 为 `chest`，
 * 让自动选敌优先敌人、Tab 手动选择可明确打宝箱。
 */
export interface ChestOptions {
  readonly id: string;
  readonly wave: number;
  readonly x: number;
  readonly y: number;
  readonly radius?: number;
  /** 可选战斗事件出口；宝箱伤害同样携带来源链进出日志。 */
  readonly events?: CombatEventSink;
}

export class Chest extends Combatant {
  readonly wave: number;
  private eligibilityGranted = false;

  constructor(options: ChestOptions) {
    super({
      id: options.id,
      x: options.x,
      y: options.y,
      radius: options.radius ?? CHEST_RADIUS,
      kind: 'chest',
      maxHealth: chestMaxHealthForWave(options.wave),
      armor: 0,
      magicResist: 0,
      events: options.events,
    });
    this.wave = options.wave;
  }

  get isBroken(): boolean {
    return this.health.isDead;
  }

  get hasGrantedEligibility(): boolean {
    return this.eligibilityGranted;
  }

  /** 打破只授予一次资格；已死亡且未授予时返回 true。 */
  claimBreakEligibility(): boolean {
    if (!this.isBroken || this.eligibilityGranted) return false;
    this.eligibilityGranted = true;
    return true;
  }
}

/**
 * 波末收集资格：只认已打破且尚未记录过的宝箱。
 * 未打破的宝箱既不记资格，也不会出现在返回值里（由场景移除）。
 */
export function collectChestEligibility(chests: readonly Chest[]): string[] {
  return chests.flatMap((chest) =>
    chest.isBroken && chest.claimBreakEligibility() ? [chest.id] : [],
  );
}

function clampCell(value: number, limit: number): number {
  return Math.min(limit - 1, Math.max(0, value));
}

/**
 * 从起点洪水填充可行走格，判断目标点是否可达。
 * 用固定 16 像素网格，与玩家半径同口径，避免“看着在场上其实隔着墙”的宝箱。
 */
export function isChestPositionReachable(
  layout: ArenaLayout,
  from: Point,
  to: Point,
  radius = CHEST_RADIUS,
): boolean {
  const cols = Math.max(1, Math.floor(layout.width / REACHABILITY_GRID_STEP));
  const rows = Math.max(1, Math.floor(layout.height / REACHABILITY_GRID_STEP));

  const walkable = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const point = {
        x: col * REACHABILITY_GRID_STEP + REACHABILITY_GRID_STEP / 2,
        y: row * REACHABILITY_GRID_STEP + REACHABILITY_GRID_STEP / 2,
      };
      if (!isCircleBlocked(layout, point.x, point.y, radius)) {
        walkable[row * cols + col] = 1;
      }
    }
  }

  const startCol = clampCell(Math.floor(from.x / REACHABILITY_GRID_STEP), cols);
  const startRow = clampCell(Math.floor(from.y / REACHABILITY_GRID_STEP), rows);

  const findOpenCell = (col: number, row: number): number | null => {
    for (let ring = 0; ring <= 2; ring += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        for (let dy = -ring; dy <= ring; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const nextCol = col + dx;
          const nextRow = row + dy;
          if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows) continue;
          const index = nextRow * cols + nextCol;
          if (walkable[index] === 1) return index;
        }
      }
    }
    return null;
  };

  const startIndex = findOpenCell(startCol, startRow);
  if (startIndex === null) return false;

  const visited = new Uint8Array(cols * rows);
  const queue: number[] = [startIndex];
  visited[startIndex] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head] as number;
    const row = Math.floor(index / cols);
    const col = index % cols;
    const neighbors = [
      [col - 1, row],
      [col + 1, row],
      [col, row - 1],
      [col, row + 1],
    ] as const;
    for (const [nextCol, nextRow] of neighbors) {
      if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows) continue;
      const nextIndex = nextRow * cols + nextCol;
      if (walkable[nextIndex] === 1 && visited[nextIndex] === 0) {
        visited[nextIndex] = 1;
        queue.push(nextIndex);
      }
    }
  }

  const goalCol = clampCell(Math.floor(to.x / REACHABILITY_GRID_STEP), cols);
  const goalRow = clampCell(Math.floor(to.y / REACHABILITY_GRID_STEP), rows);
  for (let ring = 0; ring <= 2; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const col = goalCol + dx;
        const row = goalRow + dy;
        if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
        if (visited[row * cols + col] === 1) return true;
      }
    }
  }
  return false;
}

export interface ChestSpawnOptions {
  readonly layout: ArenaLayout;
  /** 生成瞬间的玩家位置。 */
  readonly player: Point;
  /** 生成瞬间所有敌人出生点（含待落地提示）。 */
  readonly enemySpawnPoints?: readonly Point[];
  readonly radius?: number;
  /** 让不同波次从不同方位开始搜索，避免每波固定落点。 */
  readonly angleOffset?: number;
}

/**
 * 按设计约束寻找宝箱落点：以玩家为中心的螺旋候选，
 * 逐个检查距离、墙体与可达性；没有合法点时报错而不是悄悄卡进墙里。
 */
export function findChestSpawnPosition(options: ChestSpawnOptions): Point {
  const radius = options.radius ?? CHEST_RADIUS;
  const clearance = radius + CHEST_SPAWN_CLEARANCE;
  const player = options.player;
  const enemySpawnPoints = options.enemySpawnPoints ?? [];
  const offset = options.angleOffset ?? 0;

  for (
    let distance = CHEST_MIN_PLAYER_DISTANCE;
    distance <= SPAWN_MAX_DISTANCE;
    distance += SPAWN_DISTANCE_STEP
  ) {
    for (let index = 0; index < SPAWN_ANGLES; index += 1) {
      const angle = offset * GOLDEN_ANGLE + (index * Math.PI * 2) / SPAWN_ANGLES;
      const point = {
        x: player.x + Math.cos(angle) * distance,
        y: player.y + Math.sin(angle) * distance,
      };
      if (
        Math.hypot(point.x - player.x, point.y - player.y) <
        CHEST_MIN_PLAYER_DISTANCE
      ) {
        continue;
      }
      if (
        enemySpawnPoints.some(
          (spawn) =>
            Math.hypot(point.x - spawn.x, point.y - spawn.y) <
            CHEST_MIN_ENEMY_SPAWN_DISTANCE,
        )
      ) {
        continue;
      }
      if (isCircleBlocked(options.layout, point.x, point.y, clearance)) continue;
      if (!isChestPositionReachable(options.layout, player, point, radius)) continue;
      return point;
    }
  }

  throw new Error('无法找到满足宝箱生成约束的位置');
}
