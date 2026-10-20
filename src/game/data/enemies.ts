/**
 * 敌人与 Boss 的集中数值配置（docs/game-design.md §7）。
 * 纯数据，不依赖 Phaser。
 */

export type EnemyId = 'chaser' | 'shooter' | 'charger' | 'heavy' | 'boss';

export type EnemyBehavior = 'chase' | 'shoot' | 'charge' | 'heavy' | 'boss';

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
  readonly attack?: EnemyAttackDefinition;
  /** 由波次倍率派生的精英标记；基础配置不设置。 */
  readonly elite?: boolean;
  /** Boss 专属阶段参数。 */
  readonly boss?: {
    readonly phaseThreshold: number;
    readonly summonIntervalSeconds: number;
    readonly summonCount: number;
    readonly summonId: EnemyId;
  };
}

export const ENEMY_LIST: readonly EnemyDefinition[] = [
  {
    id: 'chaser',
    name: '追击者',
    maxHealth: 60,
    armor: 0,
    magicResist: 0,
    contactDamage: 8,
    behavior: 'chase',
  },
  {
    id: 'shooter',
    name: '射手',
    maxHealth: 45,
    armor: 0,
    magicResist: 0,
    contactDamage: 0,
    behavior: 'shoot',
    attack: {
      damage: 10,
      damageType: 'physical',
      intervalSeconds: 1.6,
    },
  },
  {
    id: 'charger',
    name: '冲锋者',
    maxHealth: 80,
    armor: 0,
    magicResist: 0,
    contactDamage: 0,
    behavior: 'charge',
    attack: {
      damage: 18,
      damageType: 'physical',
      windupSeconds: 0.7,
    },
  },
  {
    id: 'heavy',
    name: '重装者',
    maxHealth: 160,
    armor: 40,
    magicResist: 0,
    contactDamage: 14,
    behavior: 'heavy',
  },
  {
    id: 'boss',
    name: '失控实验体',
    maxHealth: 2600,
    armor: 20,
    magicResist: 0.15,
    contactDamage: 0,
    behavior: 'boss',
    boss: {
      phaseThreshold: 0.5,
      summonIntervalSeconds: 15,
      summonCount: 4,
      summonId: 'chaser',
    },
  },
];

/** 普通敌人（不含 Boss）。 */
export const NORMAL_ENEMY_LIST: readonly EnemyDefinition[] = ENEMY_LIST.filter(
  (enemy) => enemy.id !== 'boss',
);

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
