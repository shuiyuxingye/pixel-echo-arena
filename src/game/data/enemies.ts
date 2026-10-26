/**
 * 敌人与 Boss 的集中数值配置。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §普通怪与最终Boss、
 * `docs/design/v0.2/03-art-and-interface.md` §怪物。
 * 八种普通怪基础生命依次 35/28/42/85/120/65/45/110，按 `unlockWave` 首次出现；
 * 幼虫是巢母召唤物，不进入波次名册，击杀只给 1 金币/1 经验。
 * 纯数据，不依赖 Phaser。
 */

export type EnemyId =
  | 'blob'
  | 'skitter'
  | 'spitter'
  | 'charger'
  | 'bulwark'
  | 'mender'
  | 'bomber'
  | 'broodmother'
  | 'larva'
  | 'boss';

export type EnemyBehavior =
  | 'chase'
  | 'flank'
  | 'spit'
  | 'shoot'
  | 'charge'
  /** 盾壳蟹：慢速挡路并暴露背侧弱点。 */
  | 'guard'
  /** 灯灵：远程射击并按冷却治疗友军。 */
  | 'mend'
  /** 爆爆兽：蓄力后自爆。 */
  | 'explode'
  /** 巢母：按冷却召唤幼虫。 */
  | 'summon'
  /** 旧版重装占位行为；保留以兼容既有存档。 */
  | 'heavy'
  | 'boss';

export interface EnemyAttackDefinition {
  readonly damage: number;
  readonly damageType: 'physical' | 'magic';
  readonly intervalSeconds?: number;
  /** 冲锋等技能的前摇预警时间。 */
  readonly windupSeconds?: number;
}

export interface EnemyDefinition {
  readonly id: EnemyId;
  readonly name: string;
  readonly maxHealth: number;
  readonly armor: number;
  /** 法术抗性，0–1。 */
  readonly magicResist: number;
  /** 接触伤害；0 表示没有接触伤害。 */
  readonly contactDamage: number;
  readonly behavior: EnemyBehavior;
  /** 首次出现波次；普通怪按此解锁，Boss 与召唤物不参与波次编成。 */
  readonly unlockWave?: number;
  readonly attack?: EnemyAttackDefinition;
  /** 击杀金币；召唤幼虫只给 1。经济系统按此入账。 */
  readonly goldReward?: number;
  /** 击杀经验；缺省时普通 5、精英 80。幼虫只给 1。 */
  readonly xpReward?: number;
  /** 覆盖行为形状的专用字符（例如幼虫用更小的点），不影响行为。 */
  readonly markerGlyph?: string;
  /** 由精英波配置派生的精英标记；基础配置不设置。 */
  readonly elite?: boolean;
  /** 精英唯一 ID；普通敌人与 Boss 不设置。核心奖励绑定它。 */
  readonly eliteId?: string;
  /** 击败该精英后可记资格的核心奖励 ID；普通敌人与 Boss 不设置。 */
  readonly coreRewardId?: string;
  /** 精英所在波次；仅用于精英攻击的伤害缩放与存档校验。 */
  readonly eliteWave?: number;
  /** Boss 专属阶段参数。 */
  readonly boss?: {
    readonly phaseThreshold: number;
    readonly summonIntervalSeconds: number;
    readonly summonCount: number;
    /** 场上同时存活的增援上限；超出后不再产生召唤请求。 */
    readonly summonMaxAlive: number;
    readonly summonId: EnemyId;
  };
}

/** 同屏敌人上限；召唤幼虫也占用该上限。 */
export const MAX_ALIVE_ENEMIES = 100;

/** 全局敌人上限中剩余的生成名额（存活 + 待落地都计数）。 */
export function remainingEnemyCapacity(
  aliveEnemyCount: number,
  pendingEnemyCount = 0,
): number {
  const occupied = Math.max(0, aliveEnemyCount) + Math.max(0, pendingEnemyCount);
  return Math.max(0, MAX_ALIVE_ENEMIES - occupied);
}

export const ENEMY_LIST: readonly EnemyDefinition[] = [
  {
    id: 'blob',
    name: '团团怪',
    maxHealth: 35,
    armor: 0,
    magicResist: 0,
    contactDamage: 8,
    behavior: 'chase',
    unlockWave: 1,
    goldReward: 2,
  },
  {
    id: 'skitter',
    name: '镰足虫',
    maxHealth: 28,
    armor: 0,
    magicResist: 0,
    contactDamage: 5,
    behavior: 'flank',
    unlockWave: 2,
    goldReward: 2,
  },
  {
    id: 'spitter',
    name: '喷菇',
    maxHealth: 42,
    armor: 0,
    magicResist: 0,
    contactDamage: 0,
    behavior: 'spit',
    unlockWave: 3,
    goldReward: 3,
    attack: {
      damage: 10,
      damageType: 'physical',
      intervalSeconds: 1.6,
      windupSeconds: 0.7,
    },
  },
  {
    id: 'charger',
    name: '冲锋猪',
    maxHealth: 85,
    armor: 0,
    magicResist: 0,
    contactDamage: 0,
    behavior: 'charge',
    unlockWave: 4,
    goldReward: 3,
    attack: {
      damage: 18,
      damageType: 'physical',
      windupSeconds: 0.7,
    },
  },
  {
    id: 'bulwark',
    name: '盾壳蟹',
    maxHealth: 120,
    armor: 40,
    magicResist: 0,
    contactDamage: 14,
    behavior: 'guard',
    unlockWave: 5,
    goldReward: 4,
  },
  {
    id: 'mender',
    name: '灯灵',
    maxHealth: 65,
    armor: 0,
    magicResist: 0,
    contactDamage: 0,
    behavior: 'mend',
    unlockWave: 7,
    goldReward: 4,
    attack: {
      damage: 8,
      damageType: 'magic',
      intervalSeconds: 1.8,
    },
  },
  {
    id: 'bomber',
    name: '爆爆兽',
    maxHealth: 45,
    armor: 0,
    magicResist: 0,
    contactDamage: 0,
    behavior: 'explode',
    unlockWave: 10,
    goldReward: 4,
    attack: {
      damage: 14,
      damageType: 'physical',
      windupSeconds: 0.9,
    },
  },
  {
    id: 'broodmother',
    name: '巢母',
    maxHealth: 110,
    armor: 20,
    magicResist: 0,
    contactDamage: 10,
    behavior: 'summon',
    unlockWave: 13,
    goldReward: 5,
  },
  {
    id: 'larva',
    name: '幼虫',
    maxHealth: 18,
    armor: 0,
    magicResist: 0,
    contactDamage: 4,
    behavior: 'chase',
    goldReward: 1,
    xpReward: 1,
    markerGlyph: '·',
  },
  {
    id: 'boss',
    name: '裂隙炉王',
    maxHealth: 12000,
    armor: 20,
    magicResist: 0.15,
    contactDamage: 0,
    behavior: 'boss',
    boss: {
      phaseThreshold: 0.5,
      summonIntervalSeconds: 20,
      summonCount: 4,
      summonMaxAlive: 8,
      summonId: 'blob',
    },
  },
];

/** 普通敌人（不含 Boss 与巢母召唤的幼虫）；顺序与基础生命表一致。 */
export const NORMAL_ENEMY_LIST: readonly EnemyDefinition[] = ENEMY_LIST.filter(
  (enemy) => enemy.unlockWave !== undefined,
);

/** 指定波次已解锁的普通敌人，用于按波次编成名册。 */
export function unlockedEnemiesForWave(wave: number): readonly EnemyDefinition[] {
  return NORMAL_ENEMY_LIST.filter(
    (enemy) => (enemy.unlockWave ?? Number.POSITIVE_INFINITY) <= wave,
  );
}

const ENEMIES_BY_ID: ReadonlyMap<string, EnemyDefinition> = new Map(
  ENEMY_LIST.map((enemy) => [enemy.id, enemy]),
);

export function getEnemy(id: string): EnemyDefinition {
  const enemy = ENEMIES_BY_ID.get(id);
  if (!enemy) {
    throw new Error(`Unknown enemy id: ${id}`);
  }
  return enemy;
}
