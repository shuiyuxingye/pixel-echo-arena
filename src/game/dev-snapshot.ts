/**
 * 开发环境只读状态快照（docs/game-design.md §10）。
 *
 * 仅在 `import.meta.env.DEV` 分支安装全局桥；生产构建不包含桥与标记字符串。
 * 桥只暴露 `getSnapshot()`，返回当帧的可序列化副本，没有任何跳关、无敌或
 * 直接修改完成状态的入口。
 */
import { SCENE_KEYS } from './config';
import type { CombatEvent } from './damage-events';
import type { CoreEffectsSnapshot } from './core-effects';
import type { Facing } from './movement';
import type { TriggerGateSnapshot } from './trigger-gates';
import type { TriggerDemoReport } from './trigger-demo';
import type { SkillEchoDemoReport } from './skill-echo-demo';
import type { ShopDemoReport } from './shop-demo';
import type { ShopTransactionDemoReport } from './shop-transaction-demo';
import type { DevShopOpsReport } from './dev-scenario';
import type { ShopLockedOffer, ShopRarityWeights } from './shop-offer';
import type { ConsumableSnapshot } from './consumable-effects';
import type { FreeSkillSnapshot } from './free-skills';
import type { CraftedMechanicsSnapshot } from './crafted-effects';
import type { HexEffectsSnapshot } from './hex-effects';
import type { CombatHexSnapshot } from './combat-hex-effects';
import type { BomberHexSnapshot } from './bomber-hex-effects';
import type { SorcererHexSnapshot } from './sorcerer-hex-effects';
import type { KnightHexSnapshot } from './knight-hex-effects';
import type { TacticianHexSnapshot } from './tactician-hex-effects';

/** 开发桥的全局名；浏览器验证用它读取快照。 */
export const DEV_SNAPSHOT_GLOBAL = '__PIXEL_ECHO_DEV__';

/** 开发入口标记：生产构建中不得出现。 */
export const DEV_ENTRY_MARKER = 'pixel-echo.dev-entry.v1';

export interface DevHealthSnapshot {
  readonly current: number;
  readonly max: number;
  readonly shield: number;
  readonly dead: boolean;
}

/** 玩家走位状态：完整试玩脚本用它判断墙边与朝向，不提供任何写入入口。 */
export interface DevPlayerSnapshot {
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  /** 已计入按键的移动输入方向（未归一化）；用于区分“输入没到”与“被墙阻挡”。 */
  readonly moveX: number;
  readonly moveY: number;
  readonly moving: boolean;
  readonly dodging: boolean;
}

/** 战斗输入与冷却：完整试玩脚本据此决定开火、闪避与技能时机。 */
export interface DevCombatSnapshot {
  readonly attackHeld: boolean;
  readonly attackCooldownRemaining: number;
  readonly dodgeCooldownRemaining: number;
  readonly skillKCooldownRemaining: number;
  readonly skillLCooldownRemaining: number;
  /** U/I 自由技能剩余冷却；旧快照缺省。 */
  readonly skillUCooldownRemaining?: number;
  readonly skillICooldownRemaining?: number;
}

/** 最近一发 J 的轻自瞄结果：浏览器验收记录瞄准角，不提供改方向入口。 */
export interface DevShotSnapshot {
  /** 本发校正到的目标；空射为 null。 */
  readonly targetId: string | null;
  /** 相对八向面向的偏转角（度），上限 25。 */
  readonly angleDegrees: number;
  /** 本发碰撞半径：普通弹 9、榴弹 11。 */
  readonly radius: number;
}

export interface DevEnemySnapshot {
  readonly id: string;
  readonly enemyId: string;
  readonly name: string;
  readonly behavior: string;
  /** 冲锋者 windup/dash、Boss 攻击等行为阶段；用于试玩脚本预判危险。 */
  readonly activity: string;
  /** 冲锋者锁定的冲刺方向（单位向量）；非冲刺状态为 0。 */
  readonly dashX: number;
  readonly dashY: number;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly shield: number;
  readonly alive: boolean;
  readonly elite: boolean;
  /** Boss 二阶段增援：击杀不提供金币/经验。 */
  readonly summoned: boolean;
  /** 精英唯一 ID 与绑定的核心奖励 ID；普通敌人/ Boss 为 undefined。 */
  readonly eliteId?: string;
  readonly coreRewardId?: string;
  readonly stunned: boolean;
  readonly rooted: boolean;
  readonly marked: boolean;
  /** 当前减速剩余秒数（含霜环/魂灵/G07 等来源）；旧快照缺省。 */
  readonly slowRemaining?: number;
}

export interface DevSoulSnapshot {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly remainingSeconds: number;
}

/** 缪尔赛思主流形（召唤物）；其他角色为 null。只读，试玩脚本据此决定是否按 K 重建。 */
export interface DevSummonSnapshot {
  readonly form: 'melee' | 'ranged';
  readonly alive: boolean;
  readonly health: number;
  readonly maxHealth: number;
  readonly x: number;
  readonly y: number;
  /** 远程副本数量；E04 幻影另计。 */
  readonly copies?: number;
  /** E04 幻影剩余寿命；不存在为 null。 */
  readonly phantomRemainingSeconds?: number | null;
}

/** 敌方弹体：试玩脚本据此侧移躲弹；只含位置与速度，不含伤害结算入口。 */
export interface DevEnemyProjectileSnapshot {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly radius: number;
}

export interface DevUpgradeSnapshot {
  readonly id: string;
  readonly stacks: number;
}

/** 本波宝箱占位状态；用于只读核对出现、受击与打破资格。 */
export interface DevChestSnapshot {
  readonly id: string;
  readonly wave: number;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly alive: boolean;
  readonly broken: boolean;
}

/** 波末奖励队列条目；用于只读核对顺序、唯一 ID 与领取状态。 */
export interface DevRewardEntrySnapshot {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly sourceId?: string;
  /** 宝箱资格已固定的道具候选 ID；非宝箱或旧快照缺省。 */
  readonly offers?: readonly string[];
  /** 宝箱完全没有有效道具时的兜底金币。 */
  readonly fallbackGold?: number;
  /** 核心资格已固定的 E01–E08 候选 ID；非核心或旧快照缺省。 */
  readonly coreOffers?: readonly string[];
}

/** 已获得永久道具的层数；用于只读核对宝箱领取与满层排除。 */
export interface DevItemStackSnapshot {
  readonly id: string;
  readonly stacks: number;
}

/** 商店货架商品；用于只读核对五格构成、价格、售出与锁定状态。 */
export interface DevShopOfferSnapshot {
  readonly slot: number;
  readonly kind: string;
  readonly id: string;
  readonly name: string;
  readonly price: number;
  /** R06 首购折扣后的实际成交价；没有折扣时与 `price` 相同。 */
  readonly effectivePrice?: number;
  readonly sold: boolean;
  readonly locked: boolean;
  readonly rarity?: string;
  readonly prerequisite: string | null;
  /** 当前层数与购买后层数；锁定跨商店时按新商店的当前层数重算。 */
  readonly stacks?: number;
  readonly nextStacks?: number;
  /** 卡面正负净变化；有实时预览时是聚合后的“当前 → 购买后”值。 */
  readonly description?: string;
  readonly cost?: string | null;
  readonly netChange?: string;
  readonly previewed?: boolean;
}

/** 配方缺件供给；不占五格与 P01，价格与货架同款一致。 */
export interface DevMaterialSupplySnapshot {
  readonly recipeId: string;
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly rarity: string;
  readonly stacks: number;
  readonly stackCap: number;
  readonly sold: boolean;
}

/** 当前波末商店货架；非商店阶段为 null。 */
export interface DevShopSnapshot {
  readonly wave: number;
  readonly weights: ShopRarityWeights;
  readonly offers: readonly DevShopOfferSnapshot[];
  readonly emergencyPotion: {
    readonly id: string;
    readonly name: string;
    readonly price: number;
    readonly repeatable: boolean;
  };
  /** 本商店的追踪配方缺件供给；没有追踪/未到保底时为 null。 */
  readonly materialSupply: DevMaterialSupplySnapshot | null;
  readonly rerollCost: number;
  /** 下一次重抽的实际费用；R06 免费次数未用完时为 0。 */
  readonly nextRerollCost: number;
  /** R06 本商店是否还有免费重抽。 */
  readonly freeRerollAvailable: boolean;
  /** R06 一次性首购 −20% 是否仍可用。 */
  readonly firstItemDiscountAvailable: boolean;
  readonly rerollCount: number;
  /** 本商店锁定的货架格；保留到下一商店时为锁定时的身份与价格。 */
  readonly locked: ShopLockedOffer | null;
  /** 本局永久道具的逐层购买支付账本；出售按此回收 40%。 */
  readonly payments: readonly {
    readonly id: string;
    readonly paid: readonly number[];
  }[];
}

/** 配方追踪状态：当前配方、逐件材料进度与缺件保底计数。 */
export interface DevRecipeTrackingSnapshot {
  readonly recipeId: string | null;
  readonly recipeName: string | null;
  readonly shopsSinceSupply: number;
  readonly ownedIngredients: number;
  readonly missing: readonly string[];
  readonly ingredients: readonly {
    readonly id: string;
    readonly name: string;
    readonly stacks: number;
    readonly missing: boolean;
  }[];
  readonly trackable: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}

/** 当前三选一手牌；试玩脚本据此选择构筑，只读。 */
export interface DevUpgradeChoiceSnapshot {
  readonly kind: string;
  readonly focusIndex: number;
  readonly rerollsRemaining: number;
  readonly cards: readonly {
    readonly id: string;
    readonly name: string;
    readonly rarity: string;
    /** 归属；强化为 general/角色 ID，海克斯为中文归属名。 */
    readonly owner?: string;
  }[];
}

/** Boss 波状态；普通波为 null。 */
export interface DevBossSnapshot {
  readonly phase: 1 | 2;
  readonly health: number;
  readonly maxHealth: number;
  readonly alive: boolean;
  readonly summonRemainingSeconds: number;
  readonly blastCount: number;
  /** 存活中的二阶段增援数量；上限 8。 */
  readonly reinforcementCount: number;
  readonly activity: string;
}

/** S01 旋转、S02 减速、S03 连锁与 S08 重力井的实时计时；用于浏览器验收。 */
export interface DevFreeSkillEffectsSnapshot {
  readonly spinning: {
    readonly active: boolean;
    readonly remainingSeconds: number;
    /** 本次施放已结算的伤害 tick 数；3 秒最多 3 次。 */
    readonly ticksFired: number;
    readonly radius: number;
    /** 单次 tick 对同一敌人的物理伤害（未乘通道倍率）。 */
    readonly damagePerTick: number;
    /** 已乘持续伤害通道倍率的实际单次 tick 伤害。 */
    readonly effectiveDamagePerTick: number;
  };
  readonly slows: readonly {
    readonly targetId: string;
    readonly percent: number;
    readonly remainingSeconds: number;
  }[];
  /** 最近一次 S03 的命中顺序（已去重）；用于核对 4 目标与跳跃顺序。 */
  readonly chain: {
    readonly targetIds: readonly string[];
    readonly range: number;
    readonly jumpRadius: number;
    readonly maxTargets: number;
  };
  /** S08 重力井的落点与剩余时间；未施放时 center 为 null。 */
  readonly gravityWell: {
    readonly active: boolean;
    readonly remainingSeconds: number;
    readonly ticksFired: number;
    readonly radius: number;
    readonly center: { readonly x: number; readonly y: number } | null;
    /** 每个 tick 向中心拉近的距离。 */
    readonly pullPerTick: number;
    /** 单次 tick 对区域内敌人的法术伤害（未乘通道倍率）。 */
    readonly damagePerTick: number;
    /** 已乘持续伤害通道倍率的实际单次 tick 伤害。 */
    readonly effectiveDamagePerTick: number;
  };
  /** S04 火路：存活火焰团与来源级 tick。 */
  readonly fireTrail: {
    readonly active: boolean;
    readonly remainingSeconds: number;
    readonly ticksFired: number;
    /** 单次 tick 对同一敌人的法术伤害（未乘全局倍率）。 */
    readonly damagePerTick: number;
    /** 已乘持续伤害通道倍率的实际单次 tick 伤害。 */
    readonly effectiveDamagePerTick: number;
    readonly radius: number;
    readonly patches: readonly {
      readonly id: number;
      readonly x: number;
      readonly y: number;
      readonly remainingSeconds: number;
    }[];
  };
  /** S05 炮台：位置、剩余时间与默认上限。 */
  readonly turrets: {
    readonly count: number;
    readonly maxCount: number;
    readonly range: number;
    readonly entries: readonly {
      readonly id: number;
      readonly x: number;
      readonly y: number;
      readonly remainingSeconds: number;
    }[];
  };
  /** S09 水镜替身：寿命、复制比例与已复制次数。 */
  readonly waterMirror: {
    readonly count: number;
    readonly maxCount: number;
    /** 复制 J 伤害的比例（0.35）。 */
    readonly damageRatio: number;
    /** 已复制的 J 命中次数与最近一次复制伤害（未乘目标减伤）。 */
    readonly echoHits: number;
    readonly lastEchoDamage: number;
    readonly entries: readonly {
      readonly id: number;
      readonly x: number;
      readonly y: number;
      readonly remainingSeconds: number;
      readonly strength: number;
    }[];
  };
  /** S06 治疗脉冲：最近一次施放的自疗与召唤物治疗结果。 */
  readonly healingPulse: {
    readonly playerHeal: number;
    readonly summonHealRatio: number;
    readonly summonRadius: number;
    readonly summons: readonly {
      readonly id: string;
      readonly healed: number;
    }[];
  };
  /** S07 盾震：护盾剩余、冲击波数值与击退距离。 */
  readonly shieldBurst: {
    readonly active: boolean;
    readonly remainingSeconds: number;
    /** 本次护盾仍记在名下的量;到期或被消耗后下降。 */
    readonly shieldAmount: number;
    /** 单个敌人的冲击波伤害（未乘全局倍率）。 */
    readonly damagePerHit: number;
    readonly radius: number;
    readonly knockbackDistance: number;
  };
  /** S10 反击战旗：区域、首次接触与玩家是否在区内吃护甲。 */
  readonly warBanner: {
    readonly active: boolean;
    readonly remainingSeconds: number;
    readonly radius: number;
    readonly center: { readonly x: number; readonly y: number } | null;
    /** 玩家当前是否站在生效中的区域内并吃到护甲加成。 */
    readonly armorActive: boolean;
    readonly armorBonus: number;
    readonly contactDamage: number;
    readonly contactHits: number;
  };
  /** S11 霰弹扇射：最近一次施放的弹丸参数与重复命中计数。 */
  readonly shotgun: {
    readonly pelletCount: number;
    readonly spreadDegrees: number;
    /** 单枚弹丸伤害（已乘本次施放强度，未乘全局倍率）。 */
    readonly damagePerPellet: number;
    readonly repeatDamageRatio: number;
    readonly range: number;
    /** 同一次施放中命中同一目标的后续弹次数。 */
    readonly repeatedHits: number;
  };
  /** S12 赏金标记：当前标记目标与本波赏金领取情况。 */
  readonly bountyMark: {
    readonly active: boolean;
    readonly targetId: string | null;
    readonly remainingSeconds: number;
    /** 当前标记的增伤比例（0.15 × 强度）。 */
    readonly damageBonus: number;
    /** 击杀当前标记可领取的金币（四舍五入）。 */
    readonly gold: number;
    readonly claimedCount: number;
    readonly maxPerWave: number;
  };
}

/** 局外设置快照：用于浏览器验收确认开关立即生效。 */
export interface DevSettingsSnapshot {
  readonly muted: boolean;
  readonly screenShake: boolean;
  readonly reducedMotion: boolean;
  readonly keyBindings: Readonly<Record<string, string>>;
}

/** 续局存储状态：浏览器验收确认检查点写入时机与不可写提示。 */
export interface DevSaveSnapshot {
  readonly lastSaveOk: boolean;
  readonly lastCheckpointKind: string | null;
}

/** 音效状态：浏览器验收确认首个键盘确认后解锁、静音立即生效。 */
export interface DevAudioSnapshot {
  readonly unlocked: boolean;
  readonly muted: boolean;
  readonly lastCue: string | null;
  readonly playCount: number;
}

/** HUD 字段与布局：浏览器验收按文本与 CSS 字号断言，不依赖截图识别。 */
export interface DevHudSkillSnapshot {
  readonly key: string;
  readonly name: string;
  readonly status: string;
  readonly statusText: string;
  readonly cooldownText: string;
  readonly text: string;
}

export interface DevHudViewportSnapshot {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly minCssFontSize: number;
  readonly fitsMinimumFont: boolean;
}

export interface DevHudSnapshot {
  readonly target: string;
  readonly vitals: string;
  readonly progress: string;
  readonly wave: string;
  readonly kills: string;
  /** 金币文本；旧快照没该字段时缺省。 */
  readonly gold?: string;
  readonly dodge: string;
  readonly resource: string;
  readonly skillDetail: string;
  readonly skills: readonly DevHudSkillSnapshot[];
  readonly viewport: DevHudViewportSnapshot;
}

/** 合成报价里的一种材料；层数为合成前后的真实值。 */
export interface DevCraftMaterialSnapshot {
  readonly id: string;
  readonly name: string;
  readonly stacksBefore: number;
  readonly stacksAfter: number;
  readonly layersConsumed: number;
}

export interface DevCraftModifierSnapshot {
  readonly stat: string;
  readonly mode: string;
  readonly value: number;
}

/** 合成净变化：净值与「当前 → 合成后」的展示值。 */
export interface DevCraftStatChangeSnapshot {
  readonly stat: string;
  readonly mode: string;
  readonly label: string;
  readonly removed: number;
  readonly added: number;
  readonly net: number;
  readonly percent: boolean;
  readonly before: string;
  readonly after: string;
}

export interface DevCraftMissingSnapshot {
  readonly id: string;
  readonly name: string;
  readonly required: number;
  readonly available: number;
}

/** 最近一次合成的成功/失败证据；失败时材料与金币应保持不变。 */
export interface DevCraftResultSnapshot {
  readonly ok: boolean;
  readonly recipeId: string;
  readonly reason: string | null;
  readonly shortfall: number;
  readonly fee: number;
  readonly goldBefore: number;
  readonly goldAfter: number;
  readonly materials: readonly DevCraftMaterialSnapshot[];
  readonly crafted: readonly string[];
}

/** 三件合成状态：当前可合成清单、开发面板配方与确认前净变化。 */
export interface DevCraftingSnapshot {
  readonly recipeId: string | null;
  readonly owned: readonly string[];
  readonly craftable: readonly string[];
  readonly fee: number | null;
  readonly gold: number;
  readonly reason: string | null;
  readonly shortfall: number;
  readonly missing: readonly DevCraftMissingSnapshot[];
  readonly materials: readonly DevCraftMaterialSnapshot[];
  readonly removedModifiers: readonly DevCraftModifierSnapshot[];
  readonly addedModifiers: readonly DevCraftModifierSnapshot[];
  readonly statChanges: readonly DevCraftStatChangeSnapshot[];
  readonly mechanics: readonly string[];
  readonly lastResult: DevCraftResultSnapshot | null;
}

/** 场景产出的纯数据快照；不含渲染对象、函数或内部可变引用。 */
export interface DevStateSnapshot {
  readonly characterId: string;
  readonly seed: number;
  /** 本局两条命名随机流的独立状态；旧快照没该字段时缺省。 */
  readonly randomStreams?: {
    readonly combat: number;
    readonly reward: number;
  };
  readonly phase: string;
  readonly wave: number;
  readonly countdownRemaining: number;
  readonly simulatedSeconds: number;
  readonly paused: boolean;
  /** 暂停原因（manual/blur/checkpoint）；未暂停为 undefined。 */
  readonly pauseReason?: string | null;
  /** URL 中请求的 dev 参数原始值；未启用开发入口时缺省。 */
  readonly devRequested?: Readonly<Record<string, string>>;
  /** 实际生效的 dev 参数；非法参数不会出现在这里。 */
  readonly devApplied?: Readonly<Record<string, string | number | boolean>>;
  /** 非法 dev 参数的可读原因；全部合法时为 null。 */
  readonly devFailureReason?: string | null;
  /** 当前波已推进的波内逻辑秒数（受 waveSpeed 缩放）；无波次运行器时为 0。 */
  readonly waveElapsedSeconds?: number;
  /** 当前波剩余逻辑秒数；Boss 波或无时限时为 0。 */
  readonly waveRemainingSeconds?: number;
  readonly settings?: DevSettingsSnapshot;
  readonly save?: DevSaveSnapshot;
  readonly audio?: DevAudioSnapshot;
  /** 触发闸门当前计数与剩余冷却；旧快照缺省。 */
  readonly triggerGates?: TriggerGateSnapshot;
  /** E01–E03 的蓄力、冷却与次数；旧快照缺省。 */
  readonly coreEffects?: CoreEffectsSnapshot;
  /** 最近 40 条伤害/治疗事件；每条都带来源 ID、链 ID 与原生/衍生标记。 */
  readonly combatEvents?: readonly CombatEvent[];
  /** `?dev=1&triggerDemo=1` 的只读触发链演示结果；未启用为 undefined。 */
  readonly triggerDemo?: TriggerDemoReport;
  /** `?dev=1&triggerDemo=1` 的 E06 复施演示；未启用为 undefined。 */
  readonly skillEchoDemo?: SkillEchoDemoReport;
  /** 开发环境商店货架演示（第 1/7/13 次商店）；未启用为 undefined。 */
  readonly shopDemo?: ShopDemoReport;
  /** 开发环境商店交易演示（价格/购买/出售/锁定/长按）；未启用为 undefined。 */
  readonly shopTransactionDemo?: ShopTransactionDemoReport;
  /** `?dev=1&shopOps=...` 在第一个商店的购买/出售执行报告；未启用为 undefined。 */
  readonly shopOps?: DevShopOpsReport;
  /** 当前波末商店货架；波中或未生成时为 null。 */
  readonly shop?: DevShopSnapshot | null;
  /** 配方追踪状态；旧快照没该字段时缺省。 */
  readonly recipeTracking?: DevRecipeTrackingSnapshot;
  readonly hud: DevHudSnapshot;
  readonly health: DevHealthSnapshot;
  readonly player: DevPlayerSnapshot;
  readonly combat: DevCombatSnapshot;
  /** 最近一发 J 的轻自瞄结果；尚未开火为 null。 */
  readonly lastShot?: DevShotSnapshot | null;
  readonly level: number;
  readonly experience: number;
  readonly experienceToNextLevel: number;
  readonly pendingLevelUps: number;
  readonly kills: number;
  /** 当前金币；旧快照没该字段时缺省。 */
  readonly gold?: number;
  /** 本局对敌人造成的累计伤害；失败后冻结。 */
  readonly damageDealt: number;
  /** 已击败指定精英后获得的核心资格 ID；未击败为空。 */
  readonly coreEligibleRewards?: readonly string[];
  /** 已拥有的精英核心 E01–E08；旧快照缺省。 */
  readonly ownedCoreIds?: readonly string[];
  readonly rewardStage: string;
  /** 奖励队列剩余待领取数量；旧快照没该字段时缺省。 */
  readonly rewardRemaining?: number;
  /** 奖励队列条目（含唯一 ID 与领取状态）；旧快照没该字段时缺省。 */
  readonly rewardQueue?: readonly DevRewardEntrySnapshot[];
  /** 宝箱二选一当前焦点；非宝箱阶段为 0。 */
  readonly rewardFocus?: number;
  /** 精英核心三选一当前焦点；非核心阶段为 0。 */
  readonly coreOfferFocus?: number;
  /** 已获得永久道具层数；旧快照没该字段时缺省。 */
  readonly items?: readonly DevItemStackSnapshot[];
  /** 已合成的唯一成品 R01–R06；旧快照没该字段时缺省。 */
  readonly crafted?: readonly string[];
  /** R01–R03 的成长、反击蓄势与小爆炸/侧弹计数；旧快照缺省。 */
  readonly craftedMechanics?: CraftedMechanicsSnapshot;
  /** 三件合成的可合成清单、开发面板报价与最近一次结果；旧快照缺省。 */
  readonly crafting?: DevCraftingSnapshot | null;
  /** 两个自由技能槽的等级、实付与冷却；旧快照缺省。 */
  readonly freeSkills?: FreeSkillSnapshot;
  /** S01 旋转 tick 与 S02 减速的实时计时；旧快照缺省。 */
  readonly freeSkillEffects?: DevFreeSkillEffectsSnapshot;
  /** 聚合后的玩家属性；用于核对道具卡片与构筑面板的真实数值。 */
  readonly stats?: {
    readonly maxHealth: number;
    readonly armor: number;
    readonly moveSpeed: number;
    readonly moveSpeedMultiplier: number;
    readonly attackSpeedMultiplier: number;
    readonly damageMultiplier: number;
    readonly directDamageMultiplier: number;
    readonly skillDamageMultiplier: number;
    readonly normalAttackDamageMultiplier: number;
    readonly attackRangeMultiplier: number;
    readonly projectileRadiusMultiplier: number;
    readonly cooldownReduction: number;
    readonly skillDurationMultiplier: number;
    readonly skillCooldownMultiplier: number;
    readonly explosionRadiusMultiplier: number;
    readonly explosionDamageMultiplier: number;
    readonly explosionSkillCooldownMultiplier: number;
    readonly damageOverTimeMultiplier: number;
    readonly recipeDamageOverTimeMultiplier: number;
    readonly summonDamageMultiplier: number;
    readonly summonHealthMultiplier: number;
    readonly xpRadiusMultiplier: number;
    readonly killGoldMultiplier: number;
    readonly completionGoldMultiplier: number;
  };
  /** I09/I10/I12/I18/I21/I23 的临时状态；未拥有对应道具时为零值。 */  readonly itemEffects?: {
    readonly regenPerFiveSeconds: number;
    readonly regenElapsedSeconds: number;
    readonly lifesteal: number;
    readonly lifestealCapPerSecond: number;
    readonly lifestealHealedThisSecond: number;
    readonly stationarySeconds: number;
    readonly stationaryDamageBonus: number;
    readonly extraProjectileCount: number;
    readonly nextJBonusArmed: boolean;
    readonly nextJBonusCooldownRemaining: number;
    readonly jHitCount: number;
    readonly jHitsUntilRicochet: number;
    readonly lowHealthShieldUsedThisWave: boolean;
    readonly lowHealthShieldRemainingSeconds: number;
  };
  /** I24 已结算的爆炸次数；非爆破手或未拥有时为 0。 */
  readonly grenadeExplosionCount?: number;
  /** P01–P08 的排队/生效层数、护盾与回复状态；旧快照缺省。 */
  readonly consumables?: ConsumableSnapshot;
  /** I17 当前经验吸取半径（逻辑像素）。 */
  readonly xpPickupRadius?: number;
  /** 本波击杀数，用于核对波末简报。 */
  readonly waveKills?: number;
  readonly remainingToSpawn: number;
  readonly pendingSpawnCount: number;
  readonly enemyProjectileCount: number;
  readonly playerProjectileCount: number;
  readonly enemies: readonly DevEnemySnapshot[];
  readonly enemyProjectiles: readonly DevEnemyProjectileSnapshot[];
  readonly boss?: DevBossSnapshot | null;
  readonly souls: readonly DevSoulSnapshot[];
  readonly summon: DevSummonSnapshot | null;
  readonly upgrades: readonly DevUpgradeSnapshot[];
  /** 本局已获得的海克斯 ID；每种最高 1 层。 */
  readonly hexes?: readonly string[];
  /** H03/H04/H09/H10/H12/H15/H19/H20/H23 的派生修正；旧快照缺省。 */
  readonly hexEffects?: HexEffectsSnapshot;
  /** H01/H02/H05/H06/H07/H08/H11/H13/H14/H16/H17/H18/H21/H22/H24 的触发、计时与计数状态；旧快照缺省。 */
  readonly combatHexes?: CombatHexSnapshot;
  /** H25–H30 爆破手专属海克斯的数值、触发计数与 H30 波纹队列；旧快照缺省。 */
  readonly bomberHexes?: BomberHexSnapshot;
  /** H31–H36 术士专属海克斯的数值、环绕术式与 H36 追加真伤计数；旧快照缺省。 */
  readonly sorcererHexes?: SorcererHexSnapshot;
  /** H37–H42 骑士专属海克斯的数值、J 计数与飞盾统计；旧快照缺省。 */
  readonly knightHexes?: KnightHexSnapshot;
  /** H43–H48 战术家专属海克斯的数值与 H48 剩余窗口；旧快照缺省。 */
  readonly tacticianHexes?: TacticianHexSnapshot;
  readonly upgradeChoice: DevUpgradeChoiceSnapshot | null;
  /** 本波场上宝箱；未出现或已移除为 null。 */
  readonly chest?: DevChestSnapshot | null;
  /** 本波已打破并记入资格的宝箱 ID；只读核对“只加一次”。 */
  readonly chestEligibleIds?: readonly string[];
}

/** 场景级输入监听计数；重开泄漏检查与基线比较。 */
export interface DevInputListenerSnapshot {
  readonly keydown: number;
  readonly keyup: number;
  readonly gameBlur: number;
  readonly sceneShutdown: number;
}

/** 场景级实体与监听计数；由开发诊断桥单独读取，不混入游戏状态快照。 */
export interface DevSceneDiagnostics {
  readonly displayObjects: number;
  readonly physicsBodies: number;
  readonly tweens: number;
  readonly timers: number;
  readonly activeScenes: number;
  /** 场景向共享设置 store 的订阅数；正常应恒为 1。 */
  readonly settingsSubscribers: number;
  readonly inputListeners: DevInputListenerSnapshot;
  readonly aliveEnemies: number;
  readonly enemyProjectiles: number;
  /** 主流形 + 远程副本数量。 */
  readonly manifolds: number;
}

export interface DevSnapshot extends DevStateSnapshot {
  readonly marker: string;
}

/** 应用壳只需要读取当前场景；用最小接口避免开发桥依赖 Phaser 运行时。 */
export interface DevSnapshotGame {
  readonly scene: {
    getScene(key: string): unknown;
  };
}

interface DevSnapshotScene {
  getDevSnapshot?: () => DevStateSnapshot | null;
  getDevDiagnostics?: () => DevSceneDiagnostics | null;
}

/** 冻结诊断快照及其嵌套的输入监听计数。 */
export function freezeDevSceneDiagnostics(
  diagnostics: DevSceneDiagnostics,
): DevSceneDiagnostics {
  Object.freeze(diagnostics.inputListeners);
  return Object.freeze(diagnostics);
}

/** 递归冻结快照及其列表，防止断言代码意外修改副本。 */
export function freezeDevSnapshot<T extends DevStateSnapshot>(snapshot: T): T {
  for (const enemy of snapshot.enemies) Object.freeze(enemy);
  for (const projectile of snapshot.enemyProjectiles) Object.freeze(projectile);
  for (const soul of snapshot.souls) Object.freeze(soul);
  for (const upgrade of snapshot.upgrades) Object.freeze(upgrade);
  Object.freeze(snapshot.enemies);
  Object.freeze(snapshot.enemyProjectiles);
  Object.freeze(snapshot.souls);
  if (snapshot.coreEligibleRewards) Object.freeze(snapshot.coreEligibleRewards);
  if (snapshot.summon) Object.freeze(snapshot.summon);
  Object.freeze(snapshot.upgrades);
  if (snapshot.hexes) Object.freeze(snapshot.hexes);
  if (snapshot.hexEffects) {
    Object.freeze(snapshot.hexEffects.attributeHexes);
    Object.freeze(snapshot.hexEffects);
  }
  if (snapshot.combatHexes) {
    Object.freeze(snapshot.combatHexes.hexes);
    Object.freeze(snapshot.combatHexes.emberTrail.patches);
    Object.freeze(snapshot.combatHexes.emberTrail);
    Object.freeze(snapshot.combatHexes.firstFreeCast);
    Object.freeze(snapshot.combatHexes.cooldownBank);
    Object.freeze(snapshot.combatHexes.dodgeAttack);
    Object.freeze(snapshot.combatHexes.combo);
    Object.freeze(snapshot.combatHexes.summonBlast);
    Object.freeze(snapshot.combatHexes.hitStreak);
    Object.freeze(snapshot.combatHexes.returnShot);
    Object.freeze(snapshot.combatHexes.barrage);
    Object.freeze(snapshot.combatHexes.stationaryFortress);
    Object.freeze(snapshot.combatHexes.hurtForGold);
    Object.freeze(snapshot.combatHexes.shieldBreathing);
    Object.freeze(snapshot.combatHexes.lowHealthBurst);
    Object.freeze(snapshot.combatHexes.eliteCollection);
    Object.freeze(snapshot.combatHexes.lethalInsurance);
    Object.freeze(snapshot.combatHexes);
  }
  if (snapshot.bomberHexes) {
    Object.freeze(snapshot.bomberHexes.hexes);
    Object.freeze(snapshot.bomberHexes.tripleShot);
    Object.freeze(snapshot.bomberHexes.soulMarch);
    Object.freeze(snapshot.bomberHexes.giantCharge);
    Object.freeze(snapshot.bomberHexes.finale);
    Object.freeze(snapshot.bomberHexes);
  }
  if (snapshot.sorcererHexes) {
    Object.freeze(snapshot.sorcererHexes.hexes);
    Object.freeze(snapshot.sorcererHexes.runePierce);
    Object.freeze(snapshot.sorcererHexes.resonance);
    Object.freeze(snapshot.sorcererHexes.doubleCast);
    Object.freeze(snapshot.sorcererHexes.contract);
    Object.freeze(snapshot.sorcererHexes.darkStar);
    Object.freeze(snapshot.sorcererHexes.runawayChimera);
    Object.freeze(snapshot.sorcererHexes);
  }
  if (snapshot.knightHexes) {
    Object.freeze(snapshot.knightHexes.hexes);
    Object.freeze(snapshot.knightHexes.healShock);
    Object.freeze(snapshot.knightHexes.field);
    Object.freeze(snapshot.knightHexes.shieldCounter);
    Object.freeze(snapshot.knightHexes.guard);
    Object.freeze(snapshot.knightHexes.throw);
    Object.freeze(snapshot.knightHexes.fortress);
    Object.freeze(snapshot.knightHexes);
  }
  if (snapshot.tacticianHexes) {
    Object.freeze(snapshot.tacticianHexes.hexes);
    Object.freeze(snapshot.tacticianHexes.dualForm);
    Object.freeze(snapshot.tacticianHexes.ecologicalRecovery);
    Object.freeze(snapshot.tacticianHexes.aggregationVortex);
    Object.freeze(snapshot.tacticianHexes.fragileLegion);
    Object.freeze(snapshot.tacticianHexes.waterMirror);
    Object.freeze(snapshot.tacticianHexes.formRelay);
    Object.freeze(snapshot.tacticianHexes);
  }
  if (snapshot.chest) Object.freeze(snapshot.chest);
  if (snapshot.chestEligibleIds) Object.freeze(snapshot.chestEligibleIds);
  if (snapshot.boss) Object.freeze(snapshot.boss);
  if (snapshot.upgradeChoice) {
    for (const card of snapshot.upgradeChoice.cards) Object.freeze(card);
    Object.freeze(snapshot.upgradeChoice.cards);
    Object.freeze(snapshot.upgradeChoice);
  }
  if (snapshot.settings) {
    Object.freeze(snapshot.settings.keyBindings);
    Object.freeze(snapshot.settings);
  }
  // 请求/生效对照只冻结副本，避免断言代码改动后影响场景侧记录。
  if (snapshot.devRequested) Object.freeze(snapshot.devRequested);
  if (snapshot.devApplied) Object.freeze(snapshot.devApplied);
  if (snapshot.items) {
    for (const item of snapshot.items) Object.freeze(item);
    Object.freeze(snapshot.items);
  }
  if (snapshot.crafted) Object.freeze(snapshot.crafted);
  if (snapshot.craftedMechanics) Object.freeze(snapshot.craftedMechanics);
  if (snapshot.recipeTracking) {
    Object.freeze(snapshot.recipeTracking.missing);
    for (const ingredient of snapshot.recipeTracking.ingredients) {
      Object.freeze(ingredient);
    }
    Object.freeze(snapshot.recipeTracking.ingredients);
    for (const recipe of snapshot.recipeTracking.trackable) {
      Object.freeze(recipe);
    }
    Object.freeze(snapshot.recipeTracking.trackable);
    Object.freeze(snapshot.recipeTracking);
  }
  if (snapshot.crafting) {
    Object.freeze(snapshot.crafting.owned);
    Object.freeze(snapshot.crafting.craftable);
    for (const material of snapshot.crafting.materials) Object.freeze(material);
    Object.freeze(snapshot.crafting.materials);
    for (const missing of snapshot.crafting.missing) Object.freeze(missing);
    Object.freeze(snapshot.crafting.missing);
    for (const modifier of snapshot.crafting.removedModifiers) {
      Object.freeze(modifier);
    }
    for (const modifier of snapshot.crafting.addedModifiers) {
      Object.freeze(modifier);
    }
    Object.freeze(snapshot.crafting.removedModifiers);
    Object.freeze(snapshot.crafting.addedModifiers);
    for (const change of snapshot.crafting.statChanges) Object.freeze(change);
    Object.freeze(snapshot.crafting.statChanges);
    Object.freeze(snapshot.crafting.mechanics);
    if (snapshot.crafting.lastResult) {
      for (const material of snapshot.crafting.lastResult.materials) {
        Object.freeze(material);
      }
      Object.freeze(snapshot.crafting.lastResult.materials);
      Object.freeze(snapshot.crafting.lastResult.crafted);
      Object.freeze(snapshot.crafting.lastResult);
    }
    Object.freeze(snapshot.crafting);
  }
  if (snapshot.freeSkills) {
    for (const slot of snapshot.freeSkills.slots) {
      if (slot.skill) Object.freeze(slot.skill);
      Object.freeze(slot);
    }
    Object.freeze(snapshot.freeSkills.slots);
    Object.freeze(snapshot.freeSkills);
  }
  if (snapshot.freeSkillEffects) {
    Object.freeze(snapshot.freeSkillEffects.spinning);
    for (const slow of snapshot.freeSkillEffects.slows) Object.freeze(slow);
    Object.freeze(snapshot.freeSkillEffects.slows);
    Object.freeze(snapshot.freeSkillEffects.chain.targetIds);
    Object.freeze(snapshot.freeSkillEffects.chain);
    if (snapshot.freeSkillEffects.gravityWell.center) {
      Object.freeze(snapshot.freeSkillEffects.gravityWell.center);
    }
    Object.freeze(snapshot.freeSkillEffects.gravityWell);
    for (const patch of snapshot.freeSkillEffects.fireTrail.patches) {
      Object.freeze(patch);
    }
    Object.freeze(snapshot.freeSkillEffects.fireTrail.patches);
    Object.freeze(snapshot.freeSkillEffects.fireTrail);
    for (const turret of snapshot.freeSkillEffects.turrets.entries) {
      Object.freeze(turret);
    }
    Object.freeze(snapshot.freeSkillEffects.turrets.entries);
    Object.freeze(snapshot.freeSkillEffects.turrets);
    for (const mirror of snapshot.freeSkillEffects.waterMirror.entries) {
      Object.freeze(mirror);
    }
    Object.freeze(snapshot.freeSkillEffects.waterMirror.entries);
    Object.freeze(snapshot.freeSkillEffects.waterMirror);
    for (const summon of snapshot.freeSkillEffects.healingPulse.summons) {
      Object.freeze(summon);
    }
    Object.freeze(snapshot.freeSkillEffects.healingPulse.summons);
    Object.freeze(snapshot.freeSkillEffects.healingPulse);
    Object.freeze(snapshot.freeSkillEffects.shieldBurst);
    if (snapshot.freeSkillEffects.warBanner.center) {
      Object.freeze(snapshot.freeSkillEffects.warBanner.center);
    }
    Object.freeze(snapshot.freeSkillEffects.warBanner);
    Object.freeze(snapshot.freeSkillEffects.shotgun);
    Object.freeze(snapshot.freeSkillEffects.bountyMark);
    Object.freeze(snapshot.freeSkillEffects);
  }
  if (snapshot.stats) Object.freeze(snapshot.stats);
  if (snapshot.itemEffects) Object.freeze(snapshot.itemEffects);
  if (snapshot.consumables) {
    Object.freeze(snapshot.consumables.pending);
    Object.freeze(snapshot.consumables.active);
    Object.freeze(snapshot.consumables);
  }
  if (snapshot.shop) {
    Object.freeze(snapshot.shop.weights);
    for (const offer of snapshot.shop.offers) Object.freeze(offer);
    Object.freeze(snapshot.shop.offers);
    Object.freeze(snapshot.shop.emergencyPotion);
    if (snapshot.shop.locked) Object.freeze(snapshot.shop.locked);
    for (const payment of snapshot.shop.payments) {
      Object.freeze(payment.paid);
      Object.freeze(payment);
    }
    Object.freeze(snapshot.shop.payments);
    Object.freeze(snapshot.shop);
  }
  if (snapshot.shopTransactionDemo) {
    for (const example of snapshot.shopTransactionDemo.priceExamples) {
      Object.freeze(example);
    }
    Object.freeze(snapshot.shopTransactionDemo.priceExamples);
    Object.freeze(snapshot.shopTransactionDemo.purchase);
    Object.freeze(snapshot.shopTransactionDemo.insufficientGold);
    Object.freeze(snapshot.shopTransactionDemo.fullStack);
    Object.freeze(snapshot.shopTransactionDemo.deliveryFailure);
    Object.freeze(snapshot.shopTransactionDemo.sell);
    Object.freeze(snapshot.shopTransactionDemo.lock);
    Object.freeze(snapshot.shopTransactionDemo.longPress);
    Object.freeze(snapshot.shopTransactionDemo);
  }
  if (snapshot.shopOps) {
    for (const step of snapshot.shopOps.steps) Object.freeze(step);
    Object.freeze(snapshot.shopOps.steps);
    Object.freeze(snapshot.shopOps);
  }
  if (snapshot.shopDemo) {
    for (const wave of snapshot.shopDemo.waves) {
      Object.freeze(wave.weights);
      for (const offer of wave.offers) Object.freeze(offer);
      for (const offer of wave.offersAfterSold) Object.freeze(offer);
      for (const offer of wave.offersAfterReroll) Object.freeze(offer);
      Object.freeze(wave.offers);
      Object.freeze(wave.offersAfterSold);
      Object.freeze(wave.offersAfterReroll);
      Object.freeze(wave.emergencyPotion);
      Object.freeze(wave.emergencyPotionAfterReroll);
      Object.freeze(wave);
    }
    Object.freeze(snapshot.shopDemo.waves);
    Object.freeze(snapshot.shopDemo);
  }
  if (snapshot.save) Object.freeze(snapshot.save);
  if (snapshot.audio) Object.freeze(snapshot.audio);
  for (const skill of snapshot.hud.skills) Object.freeze(skill);
  Object.freeze(snapshot.hud.skills);
  Object.freeze(snapshot.hud.viewport);
  Object.freeze(snapshot.hud);
  Object.freeze(snapshot.health);
  Object.freeze(snapshot.player);
  Object.freeze(snapshot.combat);
  return Object.freeze(snapshot);
}

/** 读取当前场景快照；场景尚未创建完成时返回 null。 */
export function readDevSnapshot(game: DevSnapshotGame | null): DevSnapshot | null {
  const scene = game?.scene.getScene(SCENE_KEYS.arena) as DevSnapshotScene | null | undefined;
  const state = scene?.getDevSnapshot?.() ?? null;
  if (!state) return null;
  return freezeDevSnapshot({ marker: DEV_ENTRY_MARKER, ...state });
}

/** 读取当前场景的实体与输入监听计数；场景未创建时返回 null。 */
export function readDevSceneDiagnostics(
  game: DevSnapshotGame | null,
): DevSceneDiagnostics | null {
  const scene = game?.scene.getScene(SCENE_KEYS.arena) as DevSnapshotScene | null | undefined;
  const diagnostics = scene?.getDevDiagnostics?.() ?? null;
  if (!diagnostics) return null;
  return freezeDevSceneDiagnostics(diagnostics);
}

/**
 * 安装只读开发桥。全局属性不可写、不可枚举，且对象本身冻结；
 * 重复调用只会覆盖为同一形状的新桥，不会累积入口。
 */
export function installDevSnapshotBridge(getGame: () => DevSnapshotGame | null): void {
  const bridge = Object.freeze({
    marker: DEV_ENTRY_MARKER,
    getSnapshot: (): DevSnapshot | null => readDevSnapshot(getGame()),
    getDiagnostics: (): DevSceneDiagnostics | null =>
      readDevSceneDiagnostics(getGame()),
  });

  Object.defineProperty(globalThis, DEV_SNAPSHOT_GLOBAL, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: bridge,
  });
}
