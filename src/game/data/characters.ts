/**
 * 四名角色的集中数值配置（docs/game-design.md §5）。
 * 纯数据，不依赖 Phaser；逻辑与渲染模块都从这里读取角色参数。
 */

export type CharacterId = 'vishdal' | 'amiya' | 'saria' | 'muelsyse';

/** 主菜单进入选角页时的默认焦点角色（docs/game-design.md §5.1）。 */
export const DEFAULT_CHARACTER_ID: CharacterId = 'vishdal';

/** V0.2 玩家可见的四职业名；界面只使用这一份映射。 */
export const CHARACTER_DISPLAY_NAMES: Readonly<Record<CharacterId, string>> = {
  vishdal: '爆破手',
  amiya: '术士',
  saria: '骑士',
  muelsyse: '战术家',
};

/** V0.1 旧显示名；只用于内部兼容映射与历史档案，不再进入界面。 */
export const LEGACY_CHARACTER_NAMES: Readonly<Record<CharacterId, string>> = {
  vishdal: '维什戴尔',
  amiya: '阿米娅',
  saria: '塞雷娅',
  muelsyse: '缪尔赛思',
};

export type DamageType = 'physical' | 'magic' | 'true';

export interface AttackDefinition {
  readonly key: 'J';
  readonly name: string;
  /** 攻击间隔（秒），按逻辑步长累计，不按帧数计时。 */
  readonly intervalSeconds: number;
  readonly range: number;
  readonly damage: number;
  readonly damageType: DamageType;
  /** 溅射半径（逻辑像素）。 */
  readonly splashRadius?: number;
  /** 近战扇形张角（度）。 */
  readonly arcDegrees?: number;
  /** 击退距离（逻辑像素）。 */
  readonly knockback?: number;
  /** 延迟余震参数。 */
  readonly aftershock?: {
    readonly delaySeconds: number;
    readonly damage: number;
    readonly damageType: DamageType;
    readonly radius: number;
  };
}

export interface SkillDefinition {
  readonly key: 'K' | 'L';
  readonly name: string;
  readonly cooldownSeconds: number;
  readonly durationSeconds?: number;
  readonly description: string;
  /** 机制数值，供后续故事直接读取。 */
  readonly params?: Readonly<Record<string, number>>;
}

export interface PassiveDefinition {
  readonly name: string;
  readonly description: string;
  /** 残影引爆参数；只有维什戴尔的被动使用。 */
  readonly afterimage?: {
    readonly damage: number;
    readonly damageType: DamageType;
    readonly radius: number;
    readonly stunSeconds: number;
  };
}

export interface CharacterDefinition {
  readonly id: CharacterId;
  readonly name: string;
  readonly maxHealth: number;
  readonly armor: number;
  /** 法术抗性，0–1。 */
  readonly magicResist: number;
  readonly moveSpeed: number;
  /** 圆形碰撞半径（逻辑像素）。 */
  readonly radius: number;
  readonly attack: AttackDefinition;
  readonly skillK: SkillDefinition;
  readonly skillL: SkillDefinition;
  readonly passive: PassiveDefinition;
}

export const CHARACTER_LIST: readonly CharacterDefinition[] = [
  {
    id: 'vishdal',
    name: CHARACTER_DISPLAY_NAMES.vishdal,
    maxHealth: 120,
    armor: 10,
    magicResist: 0,
    moveSpeed: 160,
    radius: 12,
    attack: {
      key: 'J',
      name: '榴弹',
      intervalSeconds: 0.9,
      range: 290,
      damage: 36,
      damageType: 'physical',
      splashRadius: 32,
      aftershock: {
        delaySeconds: 0.35,
        damage: 18,
        damageType: 'physical',
        radius: 32,
      },
    },
    skillK: {
      key: 'K',
      name: '魂灵之影',
      cooldownSeconds: 14,
      durationSeconds: 12,
      description: '召唤魂灵，每 1.5 秒为范围内未标记敌人附着残影并减速。',
      params: {
        maxSummons: 1,
        tickSeconds: 1.5,
        markRadius: 240,
        slowPercent: 0.2,
        slowDurationSeconds: 1,
      },
    },
    skillL: {
      key: 'L',
      name: '爆裂黎明',
      cooldownSeconds: 30,
      description: '接下来 6 发榴弹伤害翻倍、溅射半径提高 50%，弹药 20 秒后失效。',
      params: {
        shots: 6,
        damageMultiplier: 2,
        splashRadiusMultiplier: 1.5,
        fireIntervalSeconds: 1.1,
        ammoExpirySeconds: 20,
      },
    },
    passive: {
      name: '残影',
      description: '余震命中带残影的敌人时引爆，造成范围伤害与 0.3 秒眩晕。',
      afterimage: {
        damage: 24,
        damageType: 'physical',
        radius: 42,
        stunSeconds: 0.3,
      },
    },
  },
  {
    id: 'amiya',
    name: CHARACTER_DISPLAY_NAMES.amiya,
    maxHealth: 110,
    armor: 0,
    magicResist: 0.15,
    moveSpeed: 175,
    radius: 12,
    attack: {
      key: 'J',
      name: '源石术式',
      intervalSeconds: 0.4,
      range: 260,
      damage: 20,
      damageType: 'magic',
    },
    skillK: {
      key: 'K',
      name: '精神爆发',
      cooldownSeconds: 9,
      durationSeconds: 0.8,
      description: '0.8 秒内沿当前面向连续发射 6 发术式，每发 14 法伤。',
      params: {
        shots: 6,
        damagePerShot: 14,
        fatigueSeconds: 0.5,
      },
    },
    skillL: {
      key: 'L',
      name: '奇美拉',
      cooldownSeconds: 30,
      durationSeconds: 8,
      description: 'J/K 转为真实伤害且伤害 +60%，结束后 3 秒移速 −25%，不能 K/L。',
      params: {
        damageBonus: 0.6,
        weaknessSeconds: 3,
        weaknessMoveSpeedMultiplier: 0.75,
      },
    },
    passive: {
      name: '情绪吸收',
      description: '每 5 次 J 对敌命中，使 K 当前剩余冷却减少 1 秒。',
    },
  },
  {
    id: 'saria',
    name: CHARACTER_DISPLAY_NAMES.saria,
    maxHealth: 200,
    armor: 35,
    magicResist: 0.1,
    moveSpeed: 150,
    radius: 12,
    attack: {
      key: 'J',
      name: '盾击',
      intervalSeconds: 0.55,
      range: 82,
      damage: 26,
      damageType: 'physical',
      arcDegrees: 110,
      knockback: 12,
    },
    skillK: {
      key: 'K',
      name: '急救配置',
      cooldownSeconds: 10,
      description: '恢复 40 生命并获得 25 护盾，持续 4 秒，护盾不叠加。',
      params: {
        heal: 40,
        shield: 25,
        shieldDurationSeconds: 4,
      },
    },
    skillL: {
      key: 'L',
      name: '钙质化',
      cooldownSeconds: 28,
      durationSeconds: 8,
      description: '半径 120 领域：每秒回复 8 生命，敌人减速 35% 且受到法伤 +30%。',
      params: {
        fieldRadius: 120,
        healPerSecond: 8,
        enemySlowPercent: 0.35,
        enemyMagicVulnerability: 0.3,
        attackBonusMagicDamage: 10,
      },
    },
    passive: {
      name: '精神回复',
      description: 'K 实际恢复生命时，使 L 剩余冷却减少 2 秒。',
    },
  },
  {
    id: 'muelsyse',
    name: CHARACTER_DISPLAY_NAMES.muelsyse,
    maxHealth: 125,
    armor: 5,
    magicResist: 0.1,
    moveSpeed: 175,
    radius: 12,
    attack: {
      key: 'J',
      name: '水弹',
      intervalSeconds: 0.55,
      range: 250,
      damage: 18,
      damageType: 'magic',
    },
    skillK: {
      key: 'K',
      name: '塑形',
      cooldownSeconds: 6,
      description: '在近战/远程流形间切换，保留生命百分比。',
      params: {
        meleeHealth: 90,
        meleeRange: 90,
        meleeIntervalSeconds: 0.7,
        meleeDamage: 16,
        meleeStackDamage: 2,
        meleeStackArmor: 2,
        meleeMaxStacks: 5,
        rangedHealth: 60,
        rangedRange: 230,
        rangedIntervalSeconds: 0.8,
        rangedDamage: 14,
        rangedCopyEveryAttacks: 8,
        rangedCopyDurationSeconds: 5,
        rangedCopyDamageRatio: 0.5,
        rangedMaxCopies: 1,
      },
    },
    skillL: {
      key: 'L',
      name: '浅层非熵适应',
      cooldownSeconds: 24,
      durationSeconds: 6,
      description: '近战形态周期性拉近并眩晕敌人；远程形态刷新副本并束缚命中目标。',
      params: {
        pullIntervalSeconds: 2,
        pullRadius: 100,
        pullDistance: 35,
        stunSeconds: 0.5,
        rootSeconds: 0.5,
      },
    },
    passive: {
      name: '流形',
      description: '初始自带一个近战流形；流形死亡时 K 改为重建当前形态。',
    },
  },
];

const CHARACTERS_BY_ID: ReadonlyMap<string, CharacterDefinition> = new Map(
  CHARACTER_LIST.map((character) => [character.id, character]),
);

/** 按 ID 查询角色；未知 ID 直接报错，避免静默使用错误数值。 */
export function getCharacter(id: string): CharacterDefinition {
  const character = CHARACTERS_BY_ID.get(id);
  if (!character) {
    throw new Error(`Unknown character id: ${id}`);
  }
  return character;
}

export function listCharacters(): readonly CharacterDefinition[] {
  return CHARACTER_LIST;
}

/** 类型守卫：URL 参数与 Phaser registry 中的值都可能是任意类型。 */
export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string' && CHARACTERS_BY_ID.has(value);
}
