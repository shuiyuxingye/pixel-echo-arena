/**
 * V0.2 内容目录（`docs/design/v0.2/data/catalog.json`、`02-content-catalog.md`）。
 *
 * - 24 件永久道具（品质/叠层/收益/代价）、8 种消耗品（基础价/购买限制）、
 *   12 个自由技能（基础价/冷却）、8 件精英核心、6 条三件配方（材料/手续费）、
 *   48 种海克斯（品质/归属）；
 * - 只收录静态数值与只读查询，不实现效果逻辑，不读写存档；
 * - 模块加载即校验 ID 唯一、各品类数量、配方材料引用、叠层与品质取值，
 *   非法或缺失条目直接抛错，不静默兜底；
 * - 纯数据，不依赖 Phaser 或 DOM（patterns-architecture）。
 */

/** 永久道具品质，与设计目录一致。 */
export const ITEM_RARITIES = ['普通', '稀有', '史诗'] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];

/** 海克斯品质，与设计目录一致。 */
export const HEX_RARITIES = ['银', '金', '棱彩'] as const;
export type HexRarity = (typeof HEX_RARITIES)[number];

/** 海克斯归属：通用或四名角色之一。 */
export const HEX_OWNERS = ['通用', '爆破手', '术士', '骑士', '战术家'] as const;
export type HexOwner = (typeof HEX_OWNERS)[number];

/** 各品类条目数量（PRD §6、02 内容目录）。 */
export const CATALOG_COUNTS = {
  items: 24,
  consumables: 8,
  skills: 12,
  eliteCores: 8,
  recipes: 6,
  hexes: 48,
} as const;

export interface ShopItemDefinition {
  readonly id: string;
  readonly name: string;
  readonly basePrice: number;
  /** 最大叠层；1 表示唯一，不可重复购买。 */
  readonly stackCap: number;
  /** 购买收益描述，同时用于购买前展示。 */
  readonly benefit: string;
  /** 购买代价描述；必须在购买前与收益一起显示。 */
  readonly cost: string;
  readonly tag: string;
  readonly rarity: ItemRarity;
}

export interface ConsumableDefinition {
  readonly id: string;
  readonly name: string;
  readonly basePrice: number;
  readonly effect: string;
  /** 购买限制（每波次数、出现波次等）。 */
  readonly limit: string;
}

export interface FreeSkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly basePrice: number;
  /** 冷却秒数。 */
  readonly cooldownSeconds: number;
  readonly effect: string;
  readonly tag: string;
  /** 机制数值；尚未实装的技能可以缺省。 */
  readonly params?: Readonly<Record<string, number>>;
}

export interface EliteCoreDefinition {
  readonly id: string;
  readonly name: string;
  readonly effect: string;
  readonly tag: string;
  /** 核心机制数值；尚未实装的核心可以缺省。 */
  readonly params?: Readonly<Record<string, number>>;
}

export interface RecipeDefinition {
  readonly id: string;
  readonly name: string;
  /** 三种材料道具 ID，必须全部引用真实道具且互不重复。 */
  readonly ingredients: readonly [string, string, string];
  /** 合成手续费。 */
  readonly fee: number;
  readonly effect: string;
  readonly tag: string;
}

export interface HexDefinition {
  readonly id: string;
  readonly name: string;
  readonly rarity: HexRarity;
  readonly effect: string;
  readonly owner: HexOwner;
}

export interface ContentCatalog {
  readonly items: readonly ShopItemDefinition[];
  readonly consumables: readonly ConsumableDefinition[];
  readonly skills: readonly FreeSkillDefinition[];
  readonly eliteCores: readonly EliteCoreDefinition[];
  readonly recipes: readonly RecipeDefinition[];
  readonly hexes: readonly HexDefinition[];
}

const RAW_CONTENT_CATALOG: ContentCatalog = {
  items: [
  {
    id: 'I01',
    name: '红铜心',
    basePrice: 45,
    stackCap: 3,
    benefit: '最大生命 +25',
    cost: '移动速度 -3%',
    tag: '生命',
    rarity: '普通',
  },
  {
    id: 'I02',
    name: '增压弹匣',
    basePrice: 50,
    stackCap: 3,
    benefit: '伤害 +15%',
    cost: '攻击速度 -6%',
    tag: '弹道',
    rarity: '普通',
  },
  {
    id: 'I03',
    name: '轻量扳机',
    basePrice: 50,
    stackCap: 3,
    benefit: '攻击速度 +18%',
    cost: '伤害 -6%',
    tag: '弹道',
    rarity: '普通',
  },
  {
    id: 'I04',
    name: '广角镜',
    basePrice: 45,
    stackCap: 3,
    benefit: '弹体直径 +20%',
    cost: '射程 -10%',
    tag: '弹道',
    rarity: '普通',
  },
  {
    id: 'I05',
    name: '稳流阀',
    basePrice: 45,
    stackCap: 3,
    benefit: '射程 +15%',
    cost: '移动速度 -2%',
    tag: '弹道',
    rarity: '普通',
  },
  {
    id: 'I06',
    name: '反应护甲',
    basePrice: 55,
    stackCap: 3,
    benefit: '护甲 +12',
    cost: '攻击速度 -5%',
    tag: '钢铁',
    rarity: '普通',
  },
  {
    id: 'I07',
    name: '霓虹导管',
    basePrice: 55,
    stackCap: 3,
    benefit: 'K/L/U/I 技能伤害 +20%',
    cost: 'J 普攻伤害 -8%',
    tag: '奥术',
    rarity: '普通',
  },
  {
    id: 'I08',
    name: '回声线圈',
    basePrice: 60,
    stackCap: 3,
    benefit: '冷却缩减 +8%',
    cost: '最大生命 -10',
    tag: '奥术',
    rarity: '普通',
  },
  {
    id: 'I09',
    name: '治疗凝胶',
    basePrice: 45,
    stackCap: 3,
    benefit: '每 5 秒回复 4 生命',
    cost: '伤害 -4%',
    tag: '生命',
    rarity: '普通',
  },
  {
    id: 'I10',
    name: '血循环泵',
    basePrice: 65,
    stackCap: 3,
    benefit: '造成伤害的 2% 转为治疗，每秒最多 4 生命/层',
    cost: '护甲 -5',
    tag: '生命',
    rarity: '普通',
  },
  {
    id: 'I11',
    name: '疾行靴',
    basePrice: 45,
    stackCap: 3,
    benefit: '移动速度 +10%',
    cost: '护甲 -4',
    tag: '机动',
    rarity: '普通',
  },
  {
    id: 'I12',
    name: '稳固底座',
    basePrice: 55,
    stackCap: 3,
    benefit: '静止 0.8 秒后伤害 +18%',
    cost: '移动速度 -5%',
    tag: '钢铁',
    rarity: '普通',
  },
  {
    id: 'I13',
    name: '火种罐',
    basePrice: 60,
    stackCap: 3,
    benefit: '爆炸半径 +18%',
    cost: '爆炸伤害 -5%',
    tag: '爆破',
    rarity: '稀有',
  },
  {
    id: 'I14',
    name: '分裂棱镜',
    basePrice: 80,
    stackCap: 1,
    benefit: 'J 非穿透弹额外发射 1 枚，额外弹伤害 35%',
    cost: 'J 攻击间隔 +10%',
    tag: '弹道',
    rarity: '史诗',
  },
  {
    id: 'I15',
    name: '过载电容',
    basePrice: 70,
    stackCap: 3,
    benefit: '技能持续时间 +15%',
    cost: '技能冷却时间 +5%',
    tag: '奥术',
    rarity: '稀有',
  },
  {
    id: 'I16',
    name: '催化孢子',
    basePrice: 60,
    stackCap: 3,
    benefit: '持续伤害 +25%',
    cost: '直接伤害 -5%',
    tag: '异常',
    rarity: '稀有',
  },
  {
    id: 'I17',
    name: '磁性碎片',
    basePrice: 55,
    stackCap: 3,
    benefit: '经验吸取半径 +40%，击杀金币 +8%',
    cost: '最大生命 -10',
    tag: '经济',
    rarity: '稀有',
  },
  {
    id: 'I18',
    name: '锻心碎片',
    basePrice: 70,
    stackCap: 1,
    benefit: '受到敌人有效命中后，下次 J +60% 伤害，内置冷却 4 秒',
    cost: '移动速度 -4%',
    tag: '钢铁',
    rarity: '史诗',
  },
  {
    id: 'I19',
    name: '镜面晶核',
    basePrice: 70,
    stackCap: 3,
    benefit: '召唤物伤害 +18%',
    cost: '自身 J 伤害 -5%',
    tag: '召唤',
    rarity: '稀有',
  },
  {
    id: 'I20',
    name: '共生苔藓',
    basePrice: 65,
    stackCap: 3,
    benefit: '召唤物生命 +25%，每秒回复 1%',
    cost: '自身最大生命 -10',
    tag: '召唤',
    rarity: '稀有',
  },
  {
    id: 'I21',
    name: '分叉导线',
    basePrice: 65,
    stackCap: 1,
    benefit: '每第 6 次 J 命中向邻近敌人弹射 40% 法伤',
    cost: 'J 伤害 -5%',
    tag: '奥术',
    rarity: '史诗',
  },
  {
    id: 'I22',
    name: '赌徒筹码',
    basePrice: 50,
    stackCap: 2,
    benefit: '商店稀有及史诗合计权重 +12 个百分点（从普通转移）',
    cost: '完成奖励金币 -15%',
    tag: '经济',
    rarity: '史诗',
  },
  {
    id: 'I23',
    name: '保险齿轮',
    basePrice: 65,
    stackCap: 1,
    benefit: '每波首次降到 30% 生命时获得 35 护盾，持续 5 秒',
    cost: '恢复效果 -10%',
    tag: '钢铁',
    rarity: '史诗',
  },
  {
    id: 'I24',
    name: '裂变火药',
    basePrice: 80,
    stackCap: 1,
    benefit: '每第 5 次爆炸追加 45% 伤害小爆炸',
    cost: '爆炸技能冷却 +8%',
    tag: '爆破',
    rarity: '史诗',
  },
  ],
  consumables: [
  {
    id: 'P01',
    name: '应急药剂',
    basePrice: 18,
    effect: '立即回复 30 生命',
    limit: '每个商店可重复购买；不超过上限',
  },
  {
    id: 'P02',
    name: '浓缩药剂',
    basePrice: 32,
    effect: '立即回复最大生命 25%',
    limit: '第 7 波商店起可出现；可重复购买',
  },
  {
    id: 'P03',
    name: '强袭饮剂',
    basePrice: 24,
    effect: '下一波伤害 +12%',
    limit: '同一波最多 2 次，下一波结束清除',
  },
  {
    id: 'P04',
    name: '疾行饮剂',
    basePrice: 20,
    effect: '下一波移动速度 +12%',
    limit: '同一波最多 1 次',
  },
  {
    id: 'P05',
    name: '硬壳饮剂',
    basePrice: 24,
    effect: '下一波初始护盾 +40',
    limit: '同一波最多 2 次，进入商店清除剩余护盾',
  },
  {
    id: 'P06',
    name: '清醒饮剂',
    basePrice: 26,
    effect: '下一波冷却缩减 +10%',
    limit: '同一波最多 1 次，遵守总上限',
  },
  {
    id: 'P07',
    name: '生息饮剂',
    basePrice: 28,
    effect: '下一波每秒回复 1 生命',
    limit: '同一波最多 2 次',
  },
  {
    id: 'P08',
    name: '速燃饮剂',
    basePrice: 24,
    effect: '下一波攻击速度 +20%，护甲 -8',
    limit: '同一波最多 1 次，收益与代价同时到期',
  },
  ],
  skills: [
  {
    id: 'S01',
    name: '旋刃环',
    basePrice: 70,
    cooldownSeconds: 12,
    effect: '围绕自身旋转 3 秒，每秒最多对同一敌人造成 45 物伤',
    tag: '近战/持续',
    // 目录只给持续与每秒伤害；近身旋转半径取 120，避免与霜环 140 重叠成同一手感。
    params: { radius: 120, durationSeconds: 3, damagePerSecond: 45 },
  },
  {
    id: 'S02',
    name: '霜环',
    basePrice: 70,
    cooldownSeconds: 14,
    effect: '半径 140 内 50 法伤并减速 40% 持续 3 秒',
    tag: '控制',
    params: { radius: 140, damage: 50, slowPercent: 0.4, slowDurationSeconds: 3 },
  },
  {
    id: 'S03',
    name: '连锁电弧',
    basePrice: 85,
    cooldownSeconds: 10,
    effect: '跳跃 4 个不同敌人，各 45 法伤；同一敌人一次',
    tag: '法术/连锁',
    // 目录只给跳跃数与伤害；首目标射程与跳跃半径本轮取 320/180。
    params: { range: 320, jumpRadius: 180, jumps: 4, damage: 45 },
  },
  {
    id: 'S04',
    name: '燃烧轨迹',
    basePrice: 70,
    cooldownSeconds: 12,
    effect: '移动路径留火 4 秒，每秒 22 法伤；同源不叠加',
    tag: '移动/持续',
    // 目录只给火焰寿命与每秒伤害；铺设窗口、步距与火焰半径本轮取 4/40/40。
    params: {
      fireDurationSeconds: 4,
      damagePerSecond: 22,
      tickSeconds: 1,
      trailSeconds: 4,
      strideDistance: 40,
      radius: 40,
    },
  },
  {
    id: 'S05',
    name: '便携炮台',
    basePrice: 85,
    cooldownSeconds: 18,
    effect: '放置 8 秒炮台，每秒 24 物伤，默认最多 1 个',
    tag: '召唤',
    // 目录只给寿命、每秒伤害与默认上限；索敌射程本轮取 260。
    params: {
      durationSeconds: 8,
      damagePerSecond: 24,
      tickSeconds: 1,
      maxCount: 1,
      range: 260,
    },
  },
  {
    id: 'S06',
    name: '治疗脉冲',
    basePrice: 80,
    cooldownSeconds: 16,
    effect: '恢复自身 30 生命，附近召唤物恢复最大生命 20%',
    tag: '治疗',
    // 目录只给自疗量与召唤物比例；「附近」取 260，与炮台索敌同感。
    params: { healAmount: 30, summonHealRatio: 0.2, summonRadius: 260 },
  },
  {
    id: 'S07',
    name: '盾震',
    basePrice: 80,
    cooldownSeconds: 14,
    effect: '获得 35 护盾 4 秒，同时周围 40 物伤与击退',
    tag: '防护',
    // 目录只给护盾/时长/伤害；冲击半径与击退距离本轮取 150/60。
    params: {
      shieldAmount: 35,
      shieldDurationSeconds: 4,
      damage: 40,
      radius: 150,
      knockbackDistance: 60,
    },
  },
  {
    id: 'S08',
    name: '重力井',
    basePrice: 90,
    cooldownSeconds: 18,
    effect: '面向前方生成半径 110 的 3 秒聚敌区，每秒 18 法伤',
    tag: '控制/法术',
    // 目录只给区域半径/持续/每秒伤害；落点射程、默认前距与每秒拉近量本轮取 280/180/70。
    params: {
      radius: 110,
      durationSeconds: 3,
      damagePerSecond: 18,
      tickSeconds: 1,
      castRange: 280,
      castDistance: 180,
      pullPerSecond: 70,
    },
  },
  {
    id: 'S09',
    name: '水镜替身',
    basePrice: 90,
    cooldownSeconds: 20,
    effect: '生成 6 秒替身，复制 J 的 35% 伤害，不复制触发链',
    tag: '召唤',
    // 目录只给寿命与复制比例；默认同时存在 1 个替身。
    params: { durationSeconds: 6, damageRatio: 0.35, maxCount: 1 },
  },
  {
    id: 'S10',
    name: '反击战旗',
    basePrice: 75,
    cooldownSeconds: 18,
    effect: '自身区域内 6 秒护甲 +15，敌人首次接触受到 45 物伤',
    tag: '防护/区域',
    // 目录只给时长/护甲/接触伤害；战旗区域半径本轮取 160。
    params: {
      durationSeconds: 6,
      armorBonus: 15,
      contactDamage: 45,
      radius: 160,
    },
  },
  {
    id: 'S11',
    name: '霰弹扇射',
    basePrice: 75,
    cooldownSeconds: 9,
    effect: '前方 50° 发射 5 枚各 18 物伤弹；同一目标后续弹伤害 35%',
    tag: '弹道',
    // 目录只给张角、弹数、单弹伤害与后续比例；弹丸射程本轮取 320。
    params: {
      spreadDegrees: 50,
      pelletCount: 5,
      damage: 18,
      repeatDamageRatio: 0.35,
      range: 320,
    },
  },
  {
    id: 'S12',
    name: '赏金标记',
    basePrice: 80,
    cooldownSeconds: 25,
    effect: '标记面向目标 8 秒，目标受到伤害 +15%；击杀额外 12 金币，每波最多 2 次',
    tag: '经济/单体',
    // 目录只给时长/增伤/赏金/每波上限；标记射程本轮取 360。
    params: {
      durationSeconds: 8,
      damageBonus: 0.15,
      bountyGold: 12,
      maxBountyPerWave: 2,
      range: 360,
    },
  },
  ],
  eliteCores: [
  {
    id: 'E01',
    name: '炉心契约',
    effect: '爆炸命中 3 个不同敌人后，下次爆炸半径 +35%；冷却 2 秒',
    tag: '爆破',
    params: { hitsRequired: 3, radiusBonus: 0.35, cooldownSeconds: 2 },
  },
  {
    id: 'E02',
    name: '星蚀之眼',
    effect: '每第 8 次法术命中触发 90 真实伤害；触发伤害不继续计数',
    tag: '奥术',
    params: { hitsRequired: 8, damage: 90 },
  },
  {
    id: 'E03',
    name: '不屈圣印',
    effect: '每波首次生命归零改为 1 生命并获得 2 秒无敌；每局最多 3 次',
    tag: '防护',
    params: { invulnerableSeconds: 2, maxTriggersPerRun: 3 },
  },
  {
    id: 'E04',
    name: '群落意志',
    effect: '所有召唤物伤害 +20%；主召唤物每 8 秒复制一个 4 秒、30% 伤害幻影，最多 1 个',
    tag: '召唤',
    params: {
      summonDamageBonus: 0.2,
      phantomIntervalSeconds: 8,
      phantomDurationSeconds: 4,
      phantomDamageRatio: 0.3,
      maxPhantoms: 1,
    },
  },
  {
    id: 'E05',
    name: '猎金之约',
    effect: '本波每获得 30 击杀金币，下一波额外 +3% 伤害，最多累计 +30%',
    tag: '经济',
    params: {
      goldPerStack: 30,
      damageBonusPerStack: 0.03,
      maxDamageBonus: 0.3,
    },
  },
  {
    id: 'E06',
    name: '回响之核',
    effect: '每第 3 次释放 U/I，1 秒后以 45% 强度重复一次；不再递归触发',
    tag: '技能',
    params: { castsRequired: 3, echoDelaySeconds: 1, echoStrength: 0.45 },
  },
  {
    id: 'E07',
    name: '逆风齿轮',
    effect: '生命低于 50% 时伤害 +20%，闪避冷却 -25%；两者随条件实时开关',
    tag: '生存',
    params: {
      healthThreshold: 0.5,
      damageBonus: 0.2,
      dodgeCooldownReduction: 0.25,
    },
  },
  {
    id: 'E08',
    name: '折光王冠',
    effect: '每 6 次 J 命中产生 2 枚 30% 伤害侧弹；侧弹不累计计数',
    tag: '弹道',
    params: {
      hitsRequired: 6,
      sideBulletCount: 2,
      sideBulletDamageRatio: 0.3,
    },
  },
  ],
  recipes: [
  {
    id: 'R01',
    name: '锻心引擎',
    ingredients: ['I01', 'I06', 'I18'],
    fee: 50,
    effect: '最大生命 +80、护甲 +20、移动速度 -6%；每击败 15 个普通敌人永久 +3 生命，每击败精英 +15，成长上限 +120；每4秒首次受击后，下次J附加最大生命5%的物伤（上限60）；计数仅来自本体敌人',
    tag: '防护成长',
  },
  {
    id: 'R02',
    name: '连锁反应堆',
    ingredients: ['I13', 'I16', 'I24'],
    fee: 55,
    effect: '爆炸半径 +30%、持续伤害 +30%；爆炸击杀产生一次 50% 小爆炸，不能递归；攻击速度 -8%',
    tag: '爆破扩散',
  },
  {
    id: 'R03',
    name: '折镜机关',
    ingredients: ['I03', 'I14', 'I21'],
    fee: 60,
    effect: '攻击速度 +20%；每次 J 追加 2 枚 40% 侧弹，J 主弹伤害 -10%；追加弹不能触发追加弹',
    tag: '弹道分裂',
  },
  {
    id: 'R04',
    name: '永昼回路',
    ingredients: ['I07', 'I08', 'I15'],
    fee: 60,
    effect: '技能伤害 +30%、冷却缩减 +15%；每第 4 次技能施放返还该技能当前冷却的 35%，最大生命 -20',
    tag: '技能循环',
  },
  {
    id: 'R05',
    name: '潮生母巢',
    ingredients: ['I09', 'I19', 'I20'],
    fee: 55,
    effect: '召唤物伤害 +25%、生命 +35%；每 12 秒生成 5 秒小流形；自身 J 伤害 -10%',
    tag: '召唤续航',
  },
  {
    id: 'R06',
    name: '命运交易所',
    ingredients: ['I17', 'I22', 'I23'],
    fee: 45,
    effect: '每个商店第一次重抽免费，首次购买永久道具减价 20%；每波结束后生命恢复减半',
    tag: '经济转化',
  },
  ],
  hexes: [
  {
    id: 'H01',
    name: '双倍委托',
    rarity: '棱彩',
    effect: 'U/I 的第一次施放不进冷却；每波各限一次',
    owner: '通用',
  },
  {
    id: 'H02',
    name: '余烬之路',
    rarity: '金',
    effect: '闪避留下 2 秒火路，每秒 18 法伤',
    owner: '通用',
  },
  {
    id: 'H03',
    name: '薄命快枪',
    rarity: '银',
    effect: '攻击速度 +25%，最大生命 -20',
    owner: '通用',
  },
  {
    id: 'H04',
    name: '沉重火力',
    rarity: '银',
    effect: '伤害 +25%，移动速度 -8%',
    owner: '通用',
  },
  {
    id: 'H05',
    name: '不动要塞',
    rarity: '金',
    effect: '站定 1 秒后护甲 +30，移动时立即移除',
    owner: '通用',
  },
  {
    id: 'H06',
    name: '滑步开火',
    rarity: '金',
    effect: '闪避结束后 1.5 秒 J 攻击速度 +50%',
    owner: '通用',
  },
  {
    id: 'H07',
    name: '分身礼炮',
    rarity: '棱彩',
    effect: '召唤物消失时产生 50 法伤爆破，每秒全局最多 2 次',
    owner: '通用',
  },
  {
    id: 'H08',
    name: '冷却银行',
    rarity: '金',
    effect: 'U/I 都就绪时每 4 秒存一层，施放技能消耗层数每层减本次冷却 10%，最多 3 层',
    owner: '通用',
  },
  {
    id: 'H09',
    name: '献祭护甲',
    rarity: '银',
    effect: '技能伤害 +30%，护甲 -12',
    owner: '通用',
  },
  {
    id: 'H10',
    name: '精打细算',
    rarity: '银',
    effect: '购物价格 -8%，击杀经验 -10%',
    owner: '通用',
  },
  {
    id: 'H11',
    name: '以伤换金',
    rarity: '金',
    effect: '每波第一次受到敌人伤害获得 15 金币，不接受自伤触发',
    owner: '通用',
  },
  {
    id: 'H12',
    name: '拾荒者',
    rarity: '银',
    effect: '完成奖励 +15 金币，移动速度 -4%',
    owner: '通用',
  },
  {
    id: 'H13',
    name: '追击扳机',
    rarity: '金',
    effect: '连续命中同一目标每次 +4% 伤害，最多 +24%，换目标重置',
    owner: '通用',
  },
  {
    id: 'H14',
    name: '折返弹',
    rarity: '金',
    effect: '每第三发 J 到最远距离后折返一次，返程伤害 35%，不触发额外弹',
    owner: '通用',
  },
  {
    id: 'H15',
    name: '大号弹药',
    rarity: '银',
    effect: '弹体直径 +35%，攻击速度 -8%',
    owner: '通用',
  },
  {
    id: 'H16',
    name: '连携时刻',
    rarity: '金',
    effect: '交替施放 U 和 I，下一个技能伤害 +25%',
    owner: '通用',
  },
  {
    id: 'H17',
    name: '护盾呼吸',
    rarity: '金',
    effect: '3 秒未受伤时每秒获得 3 护盾，上限 30，受伤中断',
    owner: '通用',
  },
  {
    id: 'H18',
    name: '濒危爆发',
    rarity: '金',
    effect: '生命首次低于 35% 时造成半径 140、120 法伤，每波一次',
    owner: '通用',
  },
  {
    id: 'H19',
    name: '玻璃艺术',
    rarity: '棱彩',
    effect: '伤害 +45%，最大生命 -25%，护甲 -10',
    owner: '通用',
  },
  {
    id: 'H20',
    name: '持久战',
    rarity: '银',
    effect: '最大生命 +40，每秒回复 0.5，伤害 -10%',
    owner: '通用',
  },
  {
    id: 'H21',
    name: '漂浮弹幕',
    rarity: '棱彩',
    effect: '每 12 次 J 命中发出 8 向各 22 法伤弹，触发弹不计数',
    owner: '通用',
  },
  {
    id: 'H22',
    name: '精英收藏',
    rarity: '金',
    effect: '击败精英后获得永久 +6% 伤害，获取前击败的精英不追溯',
    owner: '通用',
  },
  {
    id: 'H23',
    name: '精炼药剂',
    rarity: '金',
    effect: '药剂效果 +30%，药剂价格 +15%',
    owner: '通用',
  },
  {
    id: 'H24',
    name: '多重保险',
    rarity: '棱彩',
    effect: '每波首次受致命伤改为消耗 60 金币抵消并给 1 秒无敌，每局最多 2 次；不足不触发',
    owner: '通用',
  },
  {
    id: 'H25',
    name: '二次余震',
    rarity: '金',
    effect: '榴弹追加一次 50% 余震',
    owner: '爆破手',
  },
  {
    id: 'H26',
    name: '残影传染',
    rarity: '棱彩',
    effect: '引爆向最多 2 名邻敌附着标记，同次爆炸不引爆新标记',
    owner: '爆破手',
  },
  {
    id: 'H27',
    name: '三炮齐鸣',
    rarity: '金',
    effect: '爆裂黎明每第三发追加两枚 25% 小弹',
    owner: '爆破手',
  },
  {
    id: 'H28',
    name: '魂灵游行',
    rarity: '金',
    effect: '魂灵上限 +1，并缓慢跟随',
    owner: '爆破手',
  },
  {
    id: 'H29',
    name: '巨型装药',
    rarity: '银',
    effect: '爆炸半径 +30%，发射间隔 +10%',
    owner: '爆破手',
  },
  {
    id: 'H30',
    name: '烟花谢幕',
    rarity: '棱彩',
    effect: '爆裂黎明最后一发造成 3 次各 60% 波纹，不能重复衍生',
    owner: '爆破手',
  },
  {
    id: 'H31',
    name: '穿透术式',
    rarity: '金',
    effect: 'J 穿透 2 个额外目标，后续 70% 伤害',
    owner: '术士',
  },
  {
    id: 'H32',
    name: '心绪共鸣',
    rarity: '金',
    effect: '被动触发命中数由 5 降到 3',
    owner: '术士',
  },
  {
    id: 'H33',
    name: '双重吟唱',
    rarity: '棱彩',
    effect: 'K 追加 3 发 60% 术式，不触发第二次疲劳',
    owner: '术士',
  },
  {
    id: 'H34',
    name: '代偿契约',
    rarity: '银',
    effect: '奇美拉持续 +3 秒，结束虚弱 +1 秒',
    owner: '术士',
  },
  {
    id: 'H35',
    name: '暗星轨道',
    rarity: '金',
    effect: '每 8 次 J 命中生成一个 4 秒环绕术式，最多 3 个，各每秒 12 法伤',
    owner: '术士',
  },
  {
    id: 'H36',
    name: '失控奇美拉',
    rarity: '棱彩',
    effect: '奇美拉期间每第四次命中追加 50 真伤，结束后 2 秒不能 J',
    owner: '术士',
  },
  {
    id: 'H37',
    name: '回生冲击',
    rarity: '金',
    effect: 'K 实际治疗量的 80% 转为周围法伤',
    owner: '骑士',
  },
  {
    id: 'H38',
    name: '钙质反应',
    rarity: '棱彩',
    effect: '领域每秒对敌造成 16 法伤',
    owner: '骑士',
  },
  {
    id: 'H39',
    name: '坚盾反击',
    rarity: '金',
    effect: '护盾受击触发 18 物伤反击，冷却 0.8 秒',
    owner: '骑士',
  },
  {
    id: 'H40',
    name: '守护转攻',
    rarity: '银',
    effect: '护盾获得量 -20%，盾击伤害 +35%',
    owner: '骑士',
  },
  {
    id: 'H41',
    name: '重盾远投',
    rarity: '金',
    effect: '每第四次 J 变为穿透飞盾，180 距离、60% 伤害；遵循轻自瞄',
    owner: '骑士',
  },
  {
    id: 'H42',
    name: '不落王城',
    rarity: '棱彩',
    effect: '领域内每秒获得 8 护盾，盾击附带护盾当前量 15% 的法伤，单次额外上限 30',
    owner: '骑士',
  },
  {
    id: 'H43',
    name: '双生流形',
    rarity: '棱彩',
    effect: '远程副本上限 +1，近战窃取上限 +3',
    owner: '战术家',
  },
  {
    id: 'H44',
    name: '生态复苏',
    rarity: '金',
    effect: '主流形每秒回复 2%，L 开启时回复 20%',
    owner: '战术家',
  },
  {
    id: 'H45',
    name: '聚合涡旋',
    rarity: '金',
    effect: '近战拉拽范围 +30%，远程束缚 +0.25 秒',
    owner: '战术家',
  },
  {
    id: 'H46',
    name: '脆弱军团',
    rarity: '银',
    effect: '召唤物伤害 +35%、生命 -25%',
    owner: '战术家',
  },
  {
    id: 'H47',
    name: '水镜共鸣',
    rarity: '棱彩',
    effect: 'J 命中使主流形补一次 40% 攻击，冷却 0.6 秒，不触发分裂',
    owner: '战术家',
  },
  {
    id: 'H48',
    name: '形态接力',
    rarity: '金',
    effect: '切换形态后 3 秒召唤物攻击速度 +40%，切换仍遵守冷却',
    owner: '战术家',
  },
  ],
};
function fail(message: string): never {
  throw new Error(`内容目录校验失败：${message}`);
}

function requirePositiveInteger(value: number, label: string, allowZero = false): void {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    fail(`${label} 必须是${allowZero ? '非负' : '正'}整数，实际为 ${value}`);
  }
}

function requireNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} 不能为空`);
  }
}

function requireUniqueIds(group: string, entries: readonly { readonly id: string }[], seen: Set<string>): void {
  for (const entry of entries) {
    requireNonEmpty(entry.id, `${group} 的 ID`);
    if (seen.has(entry.id)) fail(`重复 ID ${entry.id}（${group}）`);
    seen.add(entry.id);
  }
}

/**
 * 校验完整内容目录并在失败时抛错；不做任何静默兜底。
 *
 * 校验项：各品类数量、跨品类 ID 唯一、名称非空、道具品质与叠层、
 * 消耗品/技能/配方的价格与冷却、配方三种材料全部引用真实道具、海克斯品质与归属。
 */
export function validateContentCatalog(catalog: ContentCatalog): ContentCatalog {
  const counts: readonly (readonly [keyof typeof CATALOG_COUNTS, string, readonly unknown[]])[] = [
    ['items', '永久道具', catalog.items],
    ['consumables', '消耗品', catalog.consumables],
    ['skills', '自由技能', catalog.skills],
    ['eliteCores', '精英核心', catalog.eliteCores],
    ['recipes', '配方', catalog.recipes],
    ['hexes', '海克斯', catalog.hexes],
  ];
  for (const [key, label, list] of counts) {
    if (!Array.isArray(list)) fail(`${label} 列表缺失`);
    if (list.length !== CATALOG_COUNTS[key]) {
      fail(`${label} 数量应为 ${CATALOG_COUNTS[key]}，实际为 ${list.length}`);
    }
  }

  const seen = new Set<string>();
  requireUniqueIds('永久道具', catalog.items, seen);
  requireUniqueIds('消耗品', catalog.consumables, seen);
  requireUniqueIds('自由技能', catalog.skills, seen);
  requireUniqueIds('精英核心', catalog.eliteCores, seen);
  requireUniqueIds('配方', catalog.recipes, seen);
  requireUniqueIds('海克斯', catalog.hexes, seen);

  for (const item of catalog.items) {
    requireNonEmpty(item.name, `道具 ${item.id} 的名称`);
    requirePositiveInteger(item.basePrice, `道具 ${item.id} 的基础价`);
    if (!Number.isInteger(item.stackCap) || item.stackCap < 1 || item.stackCap > 3) {
      fail(`道具 ${item.id} 的叠层上限必须是 1..3 的整数，实际为 ${item.stackCap}`);
    }
    if (!ITEM_RARITIES.includes(item.rarity)) {
      fail(`道具 ${item.id} 的品质 ${String(item.rarity)} 不在 ${ITEM_RARITIES.join('/')} 中`);
    }
    requireNonEmpty(item.benefit, `道具 ${item.id} 的收益`);
    requireNonEmpty(item.cost, `道具 ${item.id} 的代价`);
    requireNonEmpty(item.tag, `道具 ${item.id} 的标签`);
  }

  for (const consumable of catalog.consumables) {
    requireNonEmpty(consumable.name, `消耗品 ${consumable.id} 的名称`);
    requirePositiveInteger(consumable.basePrice, `消耗品 ${consumable.id} 的基础价`);
    requireNonEmpty(consumable.effect, `消耗品 ${consumable.id} 的效果`);
    requireNonEmpty(consumable.limit, `消耗品 ${consumable.id} 的购买限制`);
  }

  for (const skill of catalog.skills) {
    requireNonEmpty(skill.name, `自由技能 ${skill.id} 的名称`);
    requirePositiveInteger(skill.basePrice, `自由技能 ${skill.id} 的基础价`);
    if (!Number.isFinite(skill.cooldownSeconds) || skill.cooldownSeconds <= 0) {
      fail(`自由技能 ${skill.id} 的冷却必须是正数，实际为 ${skill.cooldownSeconds}`);
    }
    requireNonEmpty(skill.effect, `自由技能 ${skill.id} 的效果`);
    requireNonEmpty(skill.tag, `自由技能 ${skill.id} 的标签`);
  }

  for (const core of catalog.eliteCores) {
    requireNonEmpty(core.name, `精英核心 ${core.id} 的名称`);
    requireNonEmpty(core.effect, `精英核心 ${core.id} 的效果`);
    requireNonEmpty(core.tag, `精英核心 ${core.id} 的标签`);
  }

  const itemIds = new Set(catalog.items.map((item) => item.id));
  for (const recipe of catalog.recipes) {
    requireNonEmpty(recipe.name, `配方 ${recipe.id} 的名称`);
    if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length !== 3) {
      fail(`配方 ${recipe.id} 必须恰好引用三种材料`);
    }
    if (new Set(recipe.ingredients).size !== 3) {
      fail(`配方 ${recipe.id} 的材料不能重复`);
    }
    for (const ingredient of recipe.ingredients) {
      if (!itemIds.has(ingredient)) {
        fail(`配方 ${recipe.id} 引用了不存在的道具 ${ingredient}`);
      }
    }
    requirePositiveInteger(recipe.fee, `配方 ${recipe.id} 的手续费`, true);
    requireNonEmpty(recipe.effect, `配方 ${recipe.id} 的成品效果`);
    requireNonEmpty(recipe.tag, `配方 ${recipe.id} 的标签`);
  }

  for (const hex of catalog.hexes) {
    requireNonEmpty(hex.name, `海克斯 ${hex.id} 的名称`);
    if (!HEX_RARITIES.includes(hex.rarity)) {
      fail(`海克斯 ${hex.id} 的品质 ${String(hex.rarity)} 不在 ${HEX_RARITIES.join('/')} 中`);
    }
    if (!HEX_OWNERS.includes(hex.owner)) {
      fail(`海克斯 ${hex.id} 的归属 ${String(hex.owner)} 不在 ${HEX_OWNERS.join('/')} 中`);
    }
    requireNonEmpty(hex.effect, `海克斯 ${hex.id} 的效果`);
  }

  return Object.freeze({
    items: Object.freeze([...catalog.items]),
    consumables: Object.freeze([...catalog.consumables]),
    skills: Object.freeze([...catalog.skills]),
    eliteCores: Object.freeze([...catalog.eliteCores]),
    recipes: Object.freeze([...catalog.recipes]),
    hexes: Object.freeze([...catalog.hexes]),
  });
}

/** 通过校验的只读内容目录；模块加载时即完成校验。 */
export const CONTENT_CATALOG: ContentCatalog = validateContentCatalog(RAW_CONTENT_CATALOG);

export const SHOP_ITEM_LIST: readonly ShopItemDefinition[] = CONTENT_CATALOG.items;
export const CONSUMABLE_LIST: readonly ConsumableDefinition[] = CONTENT_CATALOG.consumables;
export const FREE_SKILL_LIST: readonly FreeSkillDefinition[] = CONTENT_CATALOG.skills;
export const ELITE_CORE_LIST: readonly EliteCoreDefinition[] = CONTENT_CATALOG.eliteCores;
export const RECIPE_LIST: readonly RecipeDefinition[] = CONTENT_CATALOG.recipes;
export const HEX_LIST: readonly HexDefinition[] = CONTENT_CATALOG.hexes;

function indexById<T extends { readonly id: string }>(list: readonly T[]): ReadonlyMap<string, T> {
  return new Map(list.map((entry) => [entry.id, entry]));
}

const SHOP_ITEM_BY_ID = indexById(SHOP_ITEM_LIST);
const CONSUMABLE_BY_ID = indexById(CONSUMABLE_LIST);
const FREE_SKILL_BY_ID = indexById(FREE_SKILL_LIST);
const ELITE_CORE_BY_ID = indexById(ELITE_CORE_LIST);
const RECIPE_BY_ID = indexById(RECIPE_LIST);
const HEX_BY_ID = indexById(HEX_LIST);

/** 按 ID 查询永久道具；未知 ID 返回 undefined。 */
export function getShopItem(id: string): ShopItemDefinition | undefined {
  return SHOP_ITEM_BY_ID.get(id);
}

export function listShopItems(): readonly ShopItemDefinition[] {
  return SHOP_ITEM_LIST;
}

/** 按 ID 查询消耗品；未知 ID 返回 undefined。 */
export function getConsumable(id: string): ConsumableDefinition | undefined {
  return CONSUMABLE_BY_ID.get(id);
}

export function listConsumables(): readonly ConsumableDefinition[] {
  return CONSUMABLE_LIST;
}

/** 按 ID 查询自由技能；未知 ID 返回 undefined。 */
export function getFreeSkill(id: string): FreeSkillDefinition | undefined {
  return FREE_SKILL_BY_ID.get(id);
}

export function listFreeSkills(): readonly FreeSkillDefinition[] {
  return FREE_SKILL_LIST;
}

/** 读取自由技能机制数值；缺失或非数值时直接抛错，避免玩法模块各自写常量。 */
export function requireFreeSkillParam(skillId: string, key: string): number {
  const value = getFreeSkill(skillId)?.params?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${skillId} 缺少数值参数 ${key}`);
  }
  return value;
}

/** 按 ID 查询精英核心；未知 ID 返回 undefined。 */
export function getEliteCore(id: string): EliteCoreDefinition | undefined {
  return ELITE_CORE_BY_ID.get(id);
}

export function listEliteCores(): readonly EliteCoreDefinition[] {
  return ELITE_CORE_LIST;
}

/** 读取核心机制数值；缺失或非数值时直接抛错，避免玩法模块各自写常量。 */
export function requireCoreParam(coreId: string, key: string): number {
  const value = getEliteCore(coreId)?.params?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${coreId} 缺少数值参数 ${key}`);
  }
  return value;
}

/** 按 ID 查询配方；未知 ID 返回 undefined。 */
export function getRecipe(id: string): RecipeDefinition | undefined {
  return RECIPE_BY_ID.get(id);
}

export function listRecipes(): readonly RecipeDefinition[] {
  return RECIPE_LIST;
}

/** 按 ID 查询海克斯；未知 ID 返回 undefined。 */
export function getHex(id: string): HexDefinition | undefined {
  return HEX_BY_ID.get(id);
}

export function listHexes(): readonly HexDefinition[] {
  return HEX_LIST;
}
