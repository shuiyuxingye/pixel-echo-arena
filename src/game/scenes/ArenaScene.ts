import { ENEMY_ART, ITEM_ART, EXTRA_ART, FX_ART } from '../art-manifest';
import Phaser from 'phaser';
import {
  COMBAT_SFX,
  createSoundPlayer,
  SOUND_PLAYER_REGISTRY_KEY,
  type SfxName,
  type SoundPlayer,
} from '../audio';
import { ARENA, ASSET_KEYS, ASSET_PATHS, PLAYER, SCENE_KEYS, VIEWPORT } from '../config';
import {
  createArenaLayout,
  hasLineOfSight,
  isCircleBlocked,
  moveCircleWithCollision,
  type ArenaLayout,
} from '../arena';
import {
  AttackTimer,
  Combatant,
  GRENADE_PROJECTILE_RADIUS,
  HealthState,
  PROJECTILE_RADIUS,
  TARGET_SECTOR_DEGREES,
  TargetTracker,
  beginProjectileReturn,
  createProjectile,
  distanceSquared,
  hudValue,
  projectileHitsTarget,
  projectileVisualRadius,
  registerProjectileHit,
  resolveAimAssist,
  resolveProjectileHit,
  stepProjectile,
  type AimAssistResult,
  type CombatPoint,
  type DamageResult,
  type ProjectileState,
} from '../combat';
import {
  CombatEventLog,
  DamageChainTracker,
  type CombatEvent,
  type CombatEventSink,
  type CombatEventSource,
} from '../damage-events';
import {
  CoreEffects,
  E03_INVULNERABLE_SECONDS,
  type CoreSideBulletTrigger,
} from '../core-effects';
import { TriggerGate } from '../trigger-gates';
import { runTriggerDemo, type TriggerDemoReport } from '../trigger-demo';
import { runSkillEchoDemo, type SkillEchoDemoReport } from '../skill-echo-demo';
import {
  CHEST_RADIUS,
  Chest,
  findChestSpawnPosition,
  shouldSpawnChest,
} from '../chest';
import {
  A02_HITS_PER_TRIGGER,
  A04_CHIMERA_DURATION_SECONDS,
  A04_WEAKNESS_SLOW_REMOVED,
  AmiyaCombat,
  EMOTIONAL_ABSORPTION_HITS,
  amiyaJPierce,
} from '../amiya';
import {
  M01_MELEE_MAX_STACKS,
  M01_RANGED_MAX_COPIES,
  M02_HEAL_ON_ACTIVATE_PERCENT,
  M02_HEAL_PERCENT_PER_SECOND,
  M03_PULL_RANGE_BONUS,
  M03_ROOT_BONUS_SECONDS,
  M04_DAMAGE_RATIO,
  M04_INTERNAL_COOLDOWN_SECONDS,
  MUELSYSE_COPY_ALPHA,
  MUELSYSE_COPY_DISPLAY_SCALE,
  MUELSYSE_COPY_FOOT_MARK,
  MUELSYSE_FOOT_MARK_COLOR,
  MUELSYSE_FOOT_MARK_STROKE,
  MUELSYSE_FORM_ALPHA,
  MUELSYSE_FORM_FOOT_MARK,
  MUELSYSE_MELEE_TINT,
  MUELSYSE_RANGED_TINT,
  MUELSYSE_RETURN_DISTANCE,
  MuelsyseCombat,
  type MuelsyseAttackEvent,
} from '../muelsyse';
import {
  SARIA_PASSIVE_COOLDOWN_REDUCTION_SECONDS,
  S01_RADIUS,
  S04_COOLDOWN_REDUCTION_SECONDS,
  S04_HEALS_PER_TRIGGER,
  S04_PASSIVE_COOLDOWN_REDUCTION_SECONDS,
  SariaCombat,
  calciumFieldMagicMultiplier,
  calciumFieldSlowMultiplier,
  isInsideCalciumField,
  resolveSariaAreaDamage,
  resolveShieldBash,
} from '../saria';
import {
  DEFAULT_CHARACTER_ID,
  getCharacter,
  getConsumable,
  getEliteCore,
  getEnemy,
  getFreeSkill,
  getHex,
  getShopItem,
  getUpgrade,
  getWave,
  isCharacterId,
  type AttackDefinition,
  type CharacterDefinition,
  type CharacterId,
  type DamageType,
  type HexDefinition,
  type SkillDefinition,
  type UpgradeDefinition,
  type WaveDefinition,
} from '../data';
import {
  EMPTY_HEX_POOL_PROMPT,
  HexRun,
  type HexChoice,
} from '../hex';
import { HexEffects } from '../hex-effects';
import {
  COMBAT_HEX_PARAMS,
  CombatHexEffects,
  H07_TRIGGER_RULE,
} from '../combat-hex-effects';
import {
  BOMBER_HEX_PARAMS,
  BomberHexEffects,
  planH27SmallShotAngles,
  resolveBomberSoulCapacity,
} from '../bomber-hex-effects';
import {
  SORCERER_H35_ORBIT_RADIUS,
  SorcererHexEffects,
  resolveEmotionalAbsorptionHits,
  resolveSorcererChimeraDuration,
  resolveSorcererJPierce,
  resolveSorcererWeaknessSeconds,
} from '../sorcerer-hex-effects';
import {
  KnightHexEffects,
  resolveKnightFieldDamage,
  resolveKnightHealShock,
  resolveKnightShieldCounter,
} from '../knight-hex-effects';
import {
  TacticianHexEffects,
  resolveTacticianAggregationVortex,
  resolveTacticianDualForm,
  resolveTacticianEcologicalRecovery,
  resolveTacticianWaterMirror,
} from '../tactician-hex-effects';
import {
  DEV_PERF_ENEMY_COUNT,
  DEV_PERF_ENEMY_PROJECTILE_COUNT,
  applyEliteOnlyToWave,
  applyScenarioToWave,
  resolveDevScenario,
  type DevScenario,
  type DevScenarioReport,
  type DevShopOp,
  type DevShopOpStep,
  type DevShopOpsReport,
} from '../dev-scenario';
import { runShopDemo, type ShopDemoReport } from '../shop-demo';
import {
  SHOP_LAST_WAVE,
  ShopShelf,
  buildShopMaterialSupply,
  formatShopShelfText,
  type ShopDrawState,
  type ShopLockedOffer,
  type ShopOffer,
} from '../shop-offer';
import {
  MATERIAL_SUPPLY_INTERVAL_SHOPS,
  RecipeTracker,
  listTrackableRecipes,
  trackedRecipeStatus,
  type RecipeTrackingContext,
} from '../recipe-tracking';
import {
  FreeSkillLoadout,
  FREE_SKILL_SLOT_KEYS,
  freeSkillStrength,
  type FreeSkillSlotKey,
  type FreeSkillStack,
} from '../free-skills';
import {
  FREE_SKILL_S01_DAMAGE_TYPE,
  FREE_SKILL_S01_RADIUS,
  FREE_SKILL_S02_DAMAGE,
  FREE_SKILL_S02_DAMAGE_TYPE,
  FREE_SKILL_S02_RADIUS,
  FREE_SKILL_S02_SLOW_PERCENT,
  FREE_SKILL_S03_DAMAGE,
  FREE_SKILL_S03_DAMAGE_TYPE,
  FREE_SKILL_S03_JUMPS,
  FREE_SKILL_S03_JUMP_RADIUS,
  FREE_SKILL_S03_RANGE,
  FREE_SKILL_S04_DAMAGE_TYPE,
  FREE_SKILL_S04_FIRE_DURATION_SECONDS,
  FREE_SKILL_S04_RADIUS,
  FREE_SKILL_S05_DAMAGE_TYPE,
  FREE_SKILL_S05_DURATION_SECONDS,
  FREE_SKILL_S05_RANGE,
  FREE_SKILL_S06_SUMMON_HEAL_RATIO,
  FREE_SKILL_S06_SUMMON_RADIUS,
  FREE_SKILL_S07_DAMAGE_TYPE,
  FREE_SKILL_S07_KNOCKBACK_DISTANCE,
  FREE_SKILL_S07_RADIUS,
  FREE_SKILL_S07_SHIELD_DURATION_SECONDS,
  FREE_SKILL_S08_DAMAGE_TYPE,
  FREE_SKILL_S08_MIN_PULL_DISTANCE,
  FREE_SKILL_S08_RADIUS,
  FREE_SKILL_S08_TICK_SECONDS,
  FREE_SKILL_S09_DAMAGE_RATIO,
  FREE_SKILL_S09_DURATION_SECONDS,
  FREE_SKILL_S09_FOLLOW_DISTANCE,
  FREE_SKILL_S10_ARMOR_BONUS,
  FREE_SKILL_S10_DAMAGE_TYPE,
  FREE_SKILL_S10_DURATION_SECONDS,
  FREE_SKILL_S10_RADIUS,
  FREE_SKILL_S11_DAMAGE_TYPE,
  FREE_SKILL_S11_PELLET_COUNT,
  FREE_SKILL_S11_RANGE,
  FREE_SKILL_S11_REPEAT_RATIO,
  FREE_SKILL_S11_SPREAD_DEGREES,
  FREE_SKILL_S12_DURATION_SECONDS,
  FREE_SKILL_S12_RANGE,
  BountyMarkState,
  FireTrailState,
  FreeSkillSlowState,
  GravityWellState,
  ShotgunVolleyTracker,
  ShieldBurstState,
  SpinningBladeState,
  TurretFieldState,
  WarBannerState,
  WaterMirrorState,
  beginFreeSkillSource,
  findTurretTarget,
  freeSkillSlowDurationSeconds,
  listFreeSkillTargetsInRadius,
  listTargetsInFirePatches,
  resolveChainLightningTargets,
  resolveGravityWellPlacement,
  resolveHealingPulse,
  resolveWaterMirrorEcho,
  shotgunFanDirections,
  shotgunPelletDamage,
  toBossSafeControl,
  type HealPulseSummonHeal,
  type FreeSkillEffectsSave,
  type TurretTickEntry,
  type WaterMirrorSnapshot,
} from '../free-skill-effects';
import {
  FreeSkillShop,
  type FreeSkillPurchaseResult,
  type FreeSkillQuoteResult,
} from '../free-skill-shop';
import {
  runShopTransactionDemo,
  type ShopTransactionDemoReport,
} from '../shop-transaction-demo';
import {
  ItemPaymentLedger,
  ShopSession,
  type ShopEmergencyPotionPurchaseResult,
  type ShopMaterialSupplyPurchaseResult,
  type ShopPurchaseResult,
  type ShopSellResult,
} from '../shop-transaction';
import {
  SHOP_PANEL_EVENT,
  ShopUiCursor,
  buildShopUiView,
  describeEmergencyPotionEntry,
  describeItemEntry,
  describePotionEntry,
  describeRecipeEntry,
  describeSellEntry,
  describeSkillEntry,
  describeSupplyEntry,
  indexOfShopKey,
  shopConfirmHint,
  shopConfirmLabel,
  shopFailureLabel,
  type ShopUiAction,
  type ShopUiAttribute,
  type ShopUiEntry,
  type ShopUiGroup,
  type ShopUiSkillSlot,
  type ShopUiTracking,
  type ShopUiView,
} from '../shop-ui';
import type {
  DevCraftingSnapshot,
  DevCraftResultSnapshot,
  DevRecipeTrackingSnapshot,
  DevSceneDiagnostics,
  DevShotSnapshot,
  DevStateSnapshot,
} from '../dev-snapshot';
import {
  ENEMY_WARNING,
  FRIENDLY_EFFECT_DEPTH,
  HIT_FEEDBACK,
  UPGRADE_FEEDBACK,
  characterEffectColors,
  planHitFeedback,
  type CharacterEffectColors,
} from '../feedback';
import {
  HUD_FONT_PX,
  HUD_SKILL_BAR,
  applyHudEvent,
  buildHudModel,
  computeHudFreeSkillBarLayout,
  computeHudSkillBarLayout,
  computeHudViewport,
  createHudState,
  freeSkillStatusText,
  hudFreeSkillIcon,
  hudSkillIcon,
  type HudEvent,
  type HudModel,
  type HudSkillKey,
  type HudSkillState,
  type HudState,
} from '../hud';
import {
  HUD_TOAST,
  HUD_TOAST_COLORS,
  formatGoldToast,
  formatLootToast,
  hudToastViews,
  pushHudToast,
  type HudToast,
  type HudToastKind,
} from '../hud-toast';
import {
  BOSS_CHARGE_WINDUP_SECONDS,
  BOSS_HAMMER_WARNING_SECONDS,
  BOSS_RADIUS,
  type BossBlast,
} from '../boss';
import { RETURN_TO_CHARACTER_SELECT_EVENT, RUN_CHARACTER_REGISTRY_KEY } from '../run-session';
import {
  RUN_RESULT_EVENT,
  appendRunResult,
  createRunKey,
  createRunResultRecord,
  shouldRecordCombatStats,
  type RunResultPayload,
  type RunResultUpgrade,
} from '../run-results';
import {
  RUN_CHECKPOINT_REGISTRY_KEY,
  clearRunCheckpoint,
  isWorldCheckpointKind,
  parseCheckpoint,
  restoredCombatStats,
  saveRunCheckpoint,
  type RunCheckpoint,
  type RunCheckpointDraft,
  type RunCheckpointKind,
  type RunSavedRewardStage,
  type RunShopCheckpoint,
} from '../run-save';
import type {
  PlayerProjectileWorldSnapshot,
  RunWorldSnapshot,
} from '../world-snapshot';
import {
  PAUSE_MENU_EVENT,
  PauseController,
  type PauseReason,
  type PauseResumeInput,
} from '../pause';
import {
  RUN_SETTINGS_REGISTRY_KEY,
  combatBindingActionForKeyCode,
  createSettingsStore,
  isKeyBoundToCombatAction,
  keyCodeLabel,
  type KeyBindings,
  type SettingsStore,
} from '../settings';
import { UPGRADE_LIST } from '../data/upgrades';
import {
  G01_DAMAGE_BONUS_PER_STACK,
  G02_MOVE_SPEED_BONUS_PER_STACK,
  G03_COOLDOWN_REDUCTION_PER_STACK,
  G04_MAX_HEALTH_BONUS_PER_STACK,
  G06_DAMAGE_RATIO,
  UpgradeEffects,
  describeUpgradeEffect,
} from '../upgrade-effects';
import {
  StatAggregator,
  applyHealingModifier,
  characterBaseStats,
  clampMoveSpeedMultiplier,
  type StatModifier,
} from '../stats';
import {
  CARDS_PER_HAND,
  RARITY_LABELS,
  UpgradeRun,
  type UpgradeChoice,
} from '../upgrade';
import { RunRandomStreams, createEntropySeed } from '../random';
import { BurstSystem, burstHudText } from '../burst';
import {
  BOMBER_EXPLOSION_RADIUS,
  BROODMOTHER_MAX_LARVAE,
  BULWARK_WEAK_DAMAGE_MULTIPLIER,
  CHARGE_DASH_SECONDS,
  CHARGE_DASH_SPEED,
  ENEMY_RADIUS,
  EnemySystem,
  SHOOTER_FIRE_RANGE,
  SPAWN_TELEGRAPH_SECONDS,
  bulwarkWeakPointAngle,
  enemyGrantsKillRewards,
  isBulwarkWeakPointHit,
  resolveEnemySpawnPoint,
  type EliteBlast,
  type EnemyHealEvent,
  type EnemySpawnTelegraph,
  type EnemyUnit,
} from '../enemy';
import {
  EliteCoreTracker,
  eligibleCoreIdsForWave,
} from '../elite';
import { EconomyLedger, completionGoldForWave } from '../economy';
import { ItemInventory } from '../item-inventory';
import {
  directDamageMultiplierOf,
  sustainedChannelNote,
  sustainedDamageMultiplierOf,
} from '../damage-channel';
import {
  CRAFTED_ITEM_IDS,
  CraftedInventory,
  CraftingSession,
  craftedStatModifiers,
  describeCraftedItem,
  formatCraftNetChanges,
  statLabel,
  type CraftResult,
  type CraftStatSnapshot,
  type CraftedItemId,
} from '../crafting';
import {
  CraftedEffects,
  R01_GROWTH_CAP,
  R02_DEATH_EXPLOSION_RATIO,
  R04_REFUND_COOLDOWN_RATIO,
  R05_FLOWFORM_DAMAGE,
  R05_FLOWFORM_RANGE,
  planR03SideShots,
  r01GrowthKind,
  type R03SideShotPlan,
} from '../crafted-effects';
import {
  ITEM_EFFECT_IDS,
  ITEM_EFFECT_PARAMS,
  ItemEffects,
  describeItemEffect,
  itemStatModifiers,
  previewItemCard,
  type ItemCardPreview,
  type ItemPreviewInput,
} from '../item-effects';
import { CoreInventory } from '../core-inventory';
import {
  ConsumableEffects,
  CONSUMABLE_EFFECT_PARAMS,
} from '../consumable-effects';
import {
  BUILD_PANEL_EVENT,
  buildBuildPanelView,
  buildPanelToggleAction,
  type BuildPanelView,
} from '../build-panel';
import {
  describeCoreOffers,
  drawCoreOffers,
  formatCoreFallbackPrompt,
  formatCoreOfferCard,
  resolveCoreClaim,
  type CoreOfferDraw,
} from '../core-offer';
import {
  CHEST_FALLBACK_GOLD,
  describeChestOffers,
  drawChestOffers,
  formatChestFallbackPrompt,
  formatChestOfferCard,
  resolveChestClaim,
  type ChestOfferDraw,
} from '../chest-offer';
import {
  GrenadeSystem,
  type AftershockResolution,
  type ExplosionBlast,
  type GrenadeDetonation,
} from '../grenade';
import { FixedStepLoop } from '../loop';
import {
  LEVEL_HEAL_AMOUNT,
  ProgressionSystem,
  type ExperienceOrb,
} from '../progression';
import { WaveRewardFlow, WaveRunner, scaleEnemyForWave } from '../wave';
import {
  formatWaveBriefing,
  waveEndChannel,
} from '../rewards';
import {
  RunStateMachine,
  INTERMISSION_HEAL_RATIO,
  WAVE_COUNTDOWN_SECONDS,
  applyIntermissionRecovery,
  canCastCombatSkills,
  formatIntermissionSummary,
  resolvePostDamagePhase,
  resolveStaleEnemyHint,
  type RunOutcome,
} from '../run-state';
import {
  SOUL_RADIUS,
  SoulSystem,
  W03_MAX_SUMMONS,
  resolveSoulSpawnPoint,
  type SoulSnapshot,
  type SoulTickResult,
} from '../soul';
import {
  COMBAT_PREVENT_DEFAULT_CODES,
  DODGE,
  FACING_VECTORS,
  PlayerMotion,
  facingToSpriteDirection,
  nearestFacing,
  type Facing,
} from '../movement';
import {
  PLAYER_ANIMATION_SETTINGS,
  PLAYER_DIRECTIONS,
  PLAYER_SPRITE_IDS,
  playerAnimationKey,
  playerArtFor,
  playerCastFrameIndex,
  playerFrameIndex,
  type PlayerAction,
  type PlayerArtSpec,
} from '../player-art';
import {
  COPY_MARKER,
  ENEMY_REVEAL_SECONDS,
  FORM_LABEL_OFFSET_Y,
  FORM_MARKERS,
  MARKER_RING_RADIUS,
  PLAYER_MARKER,
  enemyHudVisibility,
  enemyMarkerFor,
  facingIndicatorAt,
} from '../markers';

const ENTER_CODES: readonly string[] = ['Enter', 'NumpadEnter'];

/** 商店顶部「下波类型」的短标签。 */
const WAVE_KIND_LABELS: Readonly<Record<'normal' | 'elite' | 'boss', string>> = {
  normal: '普通',
  elite: '精英',
  boss: 'Boss',
};

/** I21 分叉导线：弹射搜索邻近敌人的半径（逻辑像素）。 */
const ITEM_RICOCHET_RADIUS = 160;

/** 强化卡片稀有度配色：边框/标题色与文字色。 */
const RARITY_COLORS: Readonly<Record<string, { readonly line: number; readonly text: string }>> = {
  silver: { line: 0xc0c6d4, text: '#d7dbe6' },
  gold: { line: 0xffc857, text: '#ffd98a' },
  prismatic: { line: 0xb388ff, text: '#d3b8ff' },
};

/** 永久道具品质配色：普通/稀有/史诗，与强化稀有度区分。 */
const ITEM_RARITY_COLORS: Readonly<Record<string, { readonly line: number; readonly text: string }>> = {
  普通: { line: 0xa8b0bd, text: '#d7dbe6' },
  稀有: { line: 0x5aa9e6, text: '#a8d8ff' },
  史诗: { line: 0xb388ff, text: '#d3b8ff' },
};

/** 海克斯品质配色：银/金/棱彩，与强化卡英文稀有度键区分。 */
const HEX_RARITY_COLORS: Readonly<Record<string, { readonly line: number; readonly text: string }>> = {
  银: { line: 0xc0c6d4, text: '#d7dbe6' },
  金: { line: 0xffc857, text: '#ffd98a' },
  棱彩: { line: 0xb388ff, text: '#d3b8ff' },
};

/** 数字键 1–3 直接跳转到对应强化卡。 */
const CARD_FOCUS_CODES: Readonly<Record<string, number>> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Numpad1: 0,
  Numpad2: 1,
  Numpad3: 2,
};

/** 强化面板可消费并阻止浏览器默认行为的按键。 */
const REWARD_PREVENT_DEFAULT_CODES: readonly string[] = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Digit1',
  'Digit2',
  'Digit3',
  'Numpad1',
  'Numpad2',
  'Numpad3',
  'KeyR',
];



/** 性能场景轮换使用的四类普通敌人（避开 Boss）。 */
const PERF_ENEMY_IDS = ['blob', 'spitter', 'charger', 'bulwark'] as const;

/** 读取技能集中配置；缺失即报错，避免静默使用与 docs 不一致的默认值。 */
function requireSkillParam(skill: SkillDefinition, key: string): number {
  const value = skill.params?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${skill.key} ${skill.name} 缺少数值参数 ${key}`);
  }
  return value;
}

/** 本局强化随机种子；开发环境允许 ?seed=123 固定，正式运行每局随机。 */
function resolveRunSeed(): number {
  if (import.meta.env.DEV && typeof location !== 'undefined') {
    const param = new URLSearchParams(location.search).get('seed');
    if (param && /^\d+$/.test(param)) return Number(param) >>> 0;
  }
  // 熵源集中在 random.ts，玩法代码不直接调用全局随机源。
  return createEntropySeed();
}

/**
 * 角色只在一局创建时读取一次：优先选角页写入 registry 的选择；
 * 开发环境仍可用 ?character=amiya 直接调试，生产环境忽略该参数。
 * 局中没有任何改角色入口。
 */
function resolvePlayableCharacterId(registry: Phaser.Data.DataManager): CharacterId {
  const selected = registry.get(RUN_CHARACTER_REGISTRY_KEY);
  if (isCharacterId(selected)) return selected;

  if (import.meta.env.DEV && typeof location !== 'undefined') {
    const param = new URLSearchParams(location.search).get('character');
    if (isCharacterId(param)) return param;
  }
  return DEFAULT_CHARACTER_ID;
}

/** 应用壳通过 registry 注入共享设置 store；场景独立运行时回退到 localStorage。 */
function resolveSettingsStore(registry: Phaser.Data.DataManager): SettingsStore {
  const stored = registry.get(RUN_SETTINGS_REGISTRY_KEY) as
    | Partial<SettingsStore>
    | undefined;
  if (stored && typeof stored.get === 'function' && typeof stored.subscribe === 'function') {
    return stored as SettingsStore;
  }
  return createSettingsStore();
}

/** 应用壳注入共享音效播放器；场景独立运行时回退到本地合成，静音读设置 store。 */
function resolveSoundPlayer(
  registry: Phaser.Data.DataManager,
  isMuted: () => boolean,
): SoundPlayer {
  const stored = registry.get(SOUND_PLAYER_REGISTRY_KEY) as Partial<SoundPlayer> | undefined;
  if (stored && typeof stored.play === 'function') {
    return stored as SoundPlayer;
  }
  return createSoundPlayer({ isMuted });
}

/** G06 战术回响：复制一次 J 攻击，直接与余震伤害按 50% 结算。 */
function echoAttackOf(attack: AttackDefinition): AttackDefinition {
  return {
    ...attack,
    damage: attack.damage * G06_DAMAGE_RATIO,
    aftershock: attack.aftershock
      ? {
          ...attack.aftershock,
          damage: attack.aftershock.damage * G06_DAMAGE_RATIO,
        }
      : undefined,
  };
}

/**
 * 同一次盾击的物理与领域追加法伤合并成一个展示结果：
 * 伤害数字只显示一次，击杀判定取两者的并集，避免重复结算击杀。
 */
function combineDamageResults(
  primary: DamageResult,
  bonus?: DamageResult,
): DamageResult {
  if (!bonus?.applied) return primary;
  return {
    ...bonus,
    rawDamage: primary.rawDamage + bonus.rawDamage,
    damage: primary.damage + bonus.damage,
    shieldAbsorbed: primary.shieldAbsorbed + bonus.shieldAbsorbed,
    healthLost: primary.healthLost + bonus.healthLost,
    died: primary.died || bonus.died,
  };
}

interface EnemyView {
  readonly unit: EnemyUnit;
  readonly label: string;
  readonly body: Phaser.GameObjects.Sprite;
  readonly visualSize: number;
  /** 命中闪白后恢复用的材质色调。 */
  readonly baseColor: number;
  readonly shadow: Phaser.GameObjects.Ellipse;
  readonly hpBackground: Phaser.GameObjects.Rectangle;
  readonly hpFill: Phaser.GameObjects.Rectangle;
  /** 血条宽度；Boss 使用更宽的血条。 */
  readonly hpWidth: number;
  readonly nameText: Phaser.GameObjects.Text;
  readonly statusText: Phaser.GameObjects.Text;
  readonly windupRing: Phaser.GameObjects.Arc;
  /** 普通蓄力攻击的方向预警线；只用于冲锋猪/喷菇，其余为 null。 */
  readonly warningLine: Phaser.GameObjects.Line | null;
  /** 盾壳蟹弱点方向线段与短标签；其他敌人为 null。 */
  readonly weakPointLine: Phaser.GameObjects.Line | null;
  readonly weakPointLabel: Phaser.GameObjects.Text | null;
  /** Boss 横向冲锋预警带；普通敌人为 null。 */
  readonly chargeWarning: Phaser.GameObjects.Rectangle | null;
  /** 上次同步的生命值；下降即视为本步受伤，触发血条/名称短暂显示。 */
  lastHealth: number;
  /** 受伤后血条/名称的剩余显示秒数；精英与 Boss 常驻，不依赖该值。 */
  revealRemaining: number;
}

interface BossBlastView {
  readonly ring: Phaser.GameObjects.Arc;
  readonly core: Phaser.GameObjects.Arc;
}

interface SpawnTelegraphView {
  readonly telegraph: EnemySpawnTelegraph;
  readonly ring: Phaser.GameObjects.Arc;
  readonly cross: Phaser.GameObjects.Arc;
}

/** 宝箱占位视图：色块箱体 + 血条 + 裂纹；受击/破碎反馈由同一视图更新。 */
interface ChestView {
  readonly chest: Chest;
  readonly shadow: Phaser.GameObjects.Ellipse;
  readonly body: Phaser.GameObjects.Image;
  readonly lid: Phaser.GameObjects.Rectangle;
  readonly hpBackground: Phaser.GameObjects.Rectangle;
  readonly hpFill: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.Text;
  readonly cracks: Phaser.GameObjects.Graphics;
}

interface EnemyProjectileView {
  readonly id: number;
  readonly sprite: Phaser.GameObjects.Arc;
}

interface ProjectileView {
  readonly state: ProjectileState;
  readonly sprite: Phaser.GameObjects.Arc;
  /** J 普攻、K 弹、E08 侧弹、S11 扇射弹或 H21 弹幕；只有原生 J 命中计数。 */
  readonly source: 'J' | 'K' | 'E08' | 'S11' | 'H21';
  /** 本发所属的原生攻击链；穿透多段命中共享同一条链。 */
  readonly eventSource: CombatEventSource;
  /**
   * R01 锻心引擎：本发 J 附带的物理反击伤害；命中首个目标后清零，
   * 穿透弹不会对后续目标重复结算。
   */
  r01CounterDamage?: number;
  /** S11 同一次施放的五枚弹共享命中记账；重复命中同一目标只结算 35%。 */
  readonly shotgunVolley?: ShotgunVolleyTracker;
  /** H30 烟花谢幕：本发是爆裂黎明最后一发，命中后排队 3 次波纹。 */
  h30Finale?: boolean;
}

interface UpgradeCardView {
  readonly artIcon: Phaser.GameObjects.Image;
  readonly background: Phaser.GameObjects.Rectangle;
  readonly accent: Phaser.GameObjects.Rectangle;
  readonly text: Phaser.GameObjects.Text;
}

/** 底部技能条中的一个槽位；图标与冷却进度都在这里更新。 */
interface HudBarSlotView {
  readonly background: Phaser.GameObjects.Rectangle;
  readonly badge: Phaser.GameObjects.Graphics;
  readonly badgeText: Phaser.GameObjects.Text;
  readonly icon: Phaser.GameObjects.Graphics;
  readonly artIcon?: Phaser.GameObjects.Image;
  readonly nameText: Phaser.GameObjects.Text;
  readonly statusText: Phaser.GameObjects.Text;
  /** 自由技能槽的说明行；J/K/L 槽没有。 */
  readonly detailText?: Phaser.GameObjects.Text;
  /** 自由技能当前绘制的技能 ID；替换后重绘图标。 */
  iconSkillId?: string;
  /** 槽位矩形；自由技能图标重绘时使用。 */
  readonly rect?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly cooldownTrack: Phaser.GameObjects.Rectangle;
  readonly cooldownFill: Phaser.GameObjects.Rectangle;
}

/**
 * 竞技场场景：绘制 1440×960 场地、四周墙壁、4 个对称短掩体，并驱动玩家走位。
 * 玩家使用 64×64 Q 版像素精灵表，脚底锚点与逻辑碰撞半径保持稳定。
 * 规则推进由纯逻辑的 FixedStepLoop + PlayerMotion 驱动；场景只负责输入、渲染与暂停。
 */
export class ArenaScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private layout!: ArenaLayout;
  private character!: CharacterDefinition;
  private motion!: PlayerMotion;
  private logicLoop!: FixedStepLoop;
  private attackTimer!: AttackTimer;
  private targetTracker!: TargetTracker;
  /** 维什戴尔专属系统；阿米娅使用 amiya，其余字段保持 null。 */
  private grenade: GrenadeSystem | null = null;
  private soul: SoulSystem | null = null;
  private burst: BurstSystem | null = null;
  /** 阿米娅专属 K 冷却、爆发连射与情绪吸收。 */
  private amiya: AmiyaCombat | null = null;
  /** 塞雷娅专属 K 冷却、护盾与精神回复；L 领域由后续故事接入。 */
  private saria: SariaCombat | null = null;
  /** 缪尔赛思主流形：形态切换、跟随与自动攻击。 */
  private muelsyse: MuelsyseCombat | null = null;
  private formSprite: Phaser.GameObjects.Sprite | null = null;
  private formShadow: Phaser.GameObjects.Ellipse | null = null;
  private formFootMark: Phaser.GameObjects.Ellipse | null = null;
  private formHpBackground: Phaser.GameObjects.Rectangle | null = null;
  private formHpFill: Phaser.GameObjects.Rectangle | null = null;
  private formLabel: Phaser.GameObjects.Text | null = null;
  /** 主流形占位外圈与八向指示；本体/主力形/副本用不同线型区分。 */
  private formMarkerRing: Phaser.GameObjects.Arc | null = null;
  private formMarkerInnerRing: Phaser.GameObjects.Arc | null = null;
  private formFacingGraphics: Phaser.GameObjects.Graphics | null = null;
  private muelsyseLRing: Phaser.GameObjects.Arc | null = null;
  private muelsyseCopyViews = new Map<
    string,
    {
      readonly sprite: Phaser.GameObjects.Sprite;
      readonly footMark: Phaser.GameObjects.Ellipse;
      readonly ring: Phaser.GameObjects.Arc;
      readonly label: Phaser.GameObjects.Text;
    }
  >();
  /** E04 幻影的占位视觉：一个半透明圆与剩余寿命短标签。 */
  private corePhantomVisual: {
    readonly body: Phaser.GameObjects.Image;
    readonly label: Phaser.GameObjects.Text;
  } | null = null;
  /** R05 小流形的占位视觉：水色小圆 + 剩余寿命短标签。 */
  private r05FlowformVisual: {
    readonly body: Phaser.GameObjects.Image;
    readonly label: Phaser.GameObjects.Text;
  } | null = null;
  private formCastSeconds = 0;
  private spiritBurstAttack: AttackDefinition | null = null;
  private enemySystem!: EnemySystem;
  private playerHealth!: HealthState;
  private progression!: ProgressionSystem;
  /** 本局金币账本：击杀即时入账，波末完成奖励也走同一入口。 */
  private economy!: EconomyLedger;
  /** 本局永久道具层数；宝箱免费获得与后续商店购买共用同一账本。 */
  private readonly itemInventory = new ItemInventory();
  /** 三件合成成品；每件唯一，不进商店叠层/出售路径。 */
  private readonly craftedInventory = new CraftedInventory();
  /** R01–R03 的战斗机制状态；成品是否拥有仍以 `craftedInventory` 为准。 */
  private readonly craftedEffects = new CraftedEffects({
    has: (recipeId) => this.craftedInventory.has(recipeId),
  });
  /** 本波间商店的合成会话；离开波间时清空。 */
  private craftingSession: CraftingSession | null = null;
  /** `?dev=1&craft=R01` 指定的开发合成面板配方；生产环境恒为 null。 */
  private devCraftRecipe: CraftedItemId | null = null;
  /** 最近一次合成结果，供开发快照与合成面板展示。 */
  private lastCraftResult: CraftResult | null = null;
  /** 两个自由技能槽（U/I）、等级、实付与冷却；只能在商店装备/替换。 */
  private readonly freeSkills = new FreeSkillLoadout();
  /** S01 旋转计时与 S02 减速；波初统一清空，不跨波保留。 */
  private readonly spinningBlades = new SpinningBladeState();
  private readonly freeSkillSlows = new FreeSkillSlowState();
  /** S08 重力井计时与落点；重复施放刷新，不叠加多个井。 */
  private readonly gravityWell = new GravityWellState();
  /** S04 火路计时与火焰团；重复施放替换上一次火路。 */
  private readonly fireTrail = new FireTrailState();
  /** S05 炮台场；默认单座，放新的顶掉最旧的。 */
  private readonly turretField = new TurretFieldState();
  /** S01 本次施放共享的原生伤害链；重施时刷新。 */
  private spinningBladesSource: CombatEventSource | null = null;
  /** S08 本次施放的共享原生伤害链；重施时刷新。 */
  private gravityWellSource: CombatEventSource | null = null;
  /** S04 本次火路的共享原生伤害链；重施时刷新。 */
  private fireTrailSource: CombatEventSource | null = null;
  /** S05 每座炮台各自的原生伤害链（不同炮台是不同召唤物）。 */
  private readonly turretSources = new Map<number, CombatEventSource>();
  /** S03 最近一次连锁命中的目标 ID 顺序；供开发快照核对跳跃去重。 */
  private lastChainTargetIds: string[] = [];
  /** S01 旋转范围的占位视觉：外圈 + 三片刃。 */
  private spinningBladesRing: Phaser.GameObjects.Arc | null = null;
  private spinningBladesBlades: Phaser.GameObjects.Container | null = null;
  /** S08 聚敌区占位视觉：外圈 + 中心核心。 */
  private gravityWellRing: Phaser.GameObjects.Arc | null = null;
  private gravityWellCore: Phaser.GameObjects.Arc | null = null;
  /** S04 火焰团占位视觉（按火焰 ID 同步）。 */
  private readonly firePatchVisuals = new Map<number, Phaser.GameObjects.Arc>();
  /** S05 炮台占位视觉：底座 + 炮管 + 短标签。 */
  private readonly turretVisuals = new Map<
    number,
    {
      readonly body: Phaser.GameObjects.Image;
      readonly barrel: Phaser.GameObjects.Rectangle;
      readonly label: Phaser.GameObjects.Text;
    }
  >();
  /** S09 水镜替身：6 秒寿命，默认 1 个，每次 J 命中复制 35% 伤害。 */
  private readonly waterMirror = new WaterMirrorState();
  /** S09 替身占位视觉（按替身 ID 同步）。 */
  private readonly waterMirrorVisuals = new Map<
    number,
    {
      readonly body: Phaser.GameObjects.Image;
      readonly label: Phaser.GameObjects.Text;
    }
  >();
  /** S09 已复制的 J 命中次数与最近一次复制伤害；供开发快照核对。 */
  private waterMirrorEchoHits = 0;
  private lastWaterMirrorEchoDamage = 0;
  /** S07 盾震：35 护盾 4 秒，同时周围物理伤害与击退。 */
  private readonly shieldBurst = new ShieldBurstState();
  /** S07 护盾期间的占位外圈，跟随玩家。 */
  private shieldBurstRing: Phaser.GameObjects.Arc | null = null;
  /** S10 反击战旗：固定区域 6 秒，区内玩家 +15 护甲，敌人首次接触受 45 物伤。 */
  private readonly warBanner = new WarBannerState();
  private warBannerSource: CombatEventSource | null = null;
  /** H16 连携对本次战旗接触伤害的倍率；护甲加成不受影响。 */
  private warBannerContactDamageMultiplier = 1;
  /** 当前通过聚合属性生效的战旗护甲；0 表示玩家不在区域内。 */
  private warBannerArmorApplied = 0;
  private warBannerVisuals: {
    readonly area: Phaser.GameObjects.Arc;
    readonly pole: Phaser.GameObjects.Rectangle;
    readonly flag: Phaser.GameObjects.Rectangle;
    readonly label: Phaser.GameObjects.Text;
  } | null = null;
  /** S06 最近一次施放的取证结果；供开发快照核对治疗量。 */
  private lastHealingPulsePlayerHeal = 0;
  private lastHealingPulseSummons: HealPulseSummonHeal[] = [];
  /** S11 霰弹扇射：最近一次施放的弹丸数与重复命中计数；供开发快照核对。 */
  private lastShotgunPelletCount = 0;
  private lastShotgunPelletDamage = 0;
  private shotgunRepeatedHits = 0;
  /** S12 赏金标记：8 秒单体增伤与每波 2 次击杀赏金。 */
  private readonly bountyMark = new BountyMarkState();
  /** S12 标记的占位视觉：跟随目标的圆环与短标签。 */
  private bountyMarkVisual: {
    readonly ring: Phaser.GameObjects.Arc;
    readonly label: Phaser.GameObjects.Text;
  } | null = null;
  /** I01–I12 的临时状态（周期回复/吸血/静止增伤）；层数真源仍在库存。 */
  private readonly itemEffects = new ItemEffects({
    stacksOf: (itemId) => this.itemInventory.stacksOf(itemId),
  });
  /** I12 静止判定用：上一个逻辑步的实际位置。 */
  private lastItemPosition: { readonly x: number; readonly y: number } | null = null;
  /** 已拥有精英核心；核心唯一，获得后不再进入候选。 */
  private readonly coreInventory = new CoreInventory();
  /** E01–E08 的触发状态；拥有关系以核心账本为唯一真源。 */
  private readonly coreEffects = new CoreEffects({
    hasCore: (coreId) => this.coreInventory.has(coreId),
  });
  /** 宝箱二选一焦点；同一资格内从 0 开始，切换条目时重置。 */
  private chestOfferFocus = 0;
  private chestOfferEntryId: string | null = null;
  /** 精英核心三选一焦点；同一资格内从 0 开始。 */
  private coreOfferFocus = 0;
  private coreOfferEntryId: string | null = null;
  private upgradeRun!: UpgradeRun;
  /** 本局两条独立随机流：战斗判定取 combat，商店/海克斯/奖励取 reward。 */
  private randomStreams!: RunRandomStreams;
  /** 所有来源（等级、强化、后续道具/海克斯）的统一属性聚合入口。 */
  private stats!: StatAggregator;
  /** 伤害来源链与事件日志：所有伤害/治疗携带来源 ID、链 ID 与原生/衍生标记。 */
  private readonly damageChains = new DamageChainTracker();
  private readonly combatEvents = new CombatEventLog();
  /** 事件出口：先落日志，再把法术命中交给 E02 计数（延迟到本步末尾结算）。 */
  private readonly combatEventSink: CombatEventSink = {
    record: (event: CombatEvent) => {
      this.combatEvents.record(event);
      this.queueCoreSpellHit(event);
    },
  };
  /** 本步待结算的法术命中；在伤害调用栈退出后统一处理，避免触发伤害重入。 */
  private pendingCoreSpellHits: CombatEvent[] = [];
  /** 统一触发闸门；后续核心/海克斯按规则 ID 注册冷却与次数上限。 */
  private readonly triggerGates = new TriggerGate();
  /** `?dev=1&triggerDemo=1` 的只读触发链演示结果。 */
  private triggerDemoReport: TriggerDemoReport | null = null;
  /** `?dev=1&triggerDemo=1` 的 E06 复施演示结果（U/I 接入前的可验证证据）。 */
  private skillEchoDemoReport: SkillEchoDemoReport | null = null;
  private buildEffects!: UpgradeEffects;
  private upgradeChoice: UpgradeChoice | null = null;
  /** 本局海克斯唯一拥有集合与奖励随机流；与强化面板互斥。 */
  private hexRun!: HexRun;
  /** 属性类海克斯的派生修正；拥有关系读取 `HexRun`，不另存层数。 */
  private readonly hexEffects = new HexEffects({
    has: (hexId) => this.hexRun.has(hexId),
  });
  /** H01/H02/H06/H08/H16 的每波次数、火路、银行与连携状态。 */
  private readonly combatHexes = new CombatHexEffects({
    has: (hexId) => this.hexRun.has(hexId),
  });
  /** H25–H30 爆破手专属海克斯的上限/跟随参数与 H30 波纹队列。 */
  private readonly bomberHexes = new BomberHexEffects({
    has: (hexId) => this.hexRun.has(hexId),
  });
  /** H31–H36 术士专属海克斯的环绕术式、命中计数与待结算追加真伤。 */
  private readonly sorcererHexes = new SorcererHexEffects({
    has: (hexId) => this.hexRun.has(hexId),
  });
  /** H37–H42 骑士专属海克斯的 J 计数、盾击加成与飞盾参数。 */
  private readonly knightHexes = new KnightHexEffects({
    has: (hexId) => this.hexRun.has(hexId),
  });
  /** H43–H48 战术家专属海克斯的召唤物加成与形态接力参数。 */
  private readonly tacticianHexes = new TacticianHexEffects({
    has: (hexId) => this.hexRun.has(hexId),
  });
  /** H35 环绕术式的占位视觉；数量与逻辑状态同步。 */
  private sorcererOrbVisuals: Phaser.GameObjects.Arc[] = [];
  private sorcererOrbAngle = 0;
  /** H35 环绕术式的伤害链；环绕物存在期间复用同一条原生来源。 */
  private sorcererOrbSource: CombatEventSource | null = null;
  /** H02 本次闪避共用一条原生伤害链；闪避开始时建立。 */
  private emberTrailSource: CombatEventSource | null = null;
  /** H02 火焰团占位视觉（按火焰 ID 同步）。 */
  private readonly emberPatchVisuals = new Map<number, Phaser.GameObjects.Arc>();
  /** H05 站定判定用的上一步位置；波初清空。 */
  private lastHexPosition: { x: number; y: number } | null = null;
  /** H05/H22 已注册进属性聚合的加成；只在数值变化时整源替换。 */
  private h05ArmorApplied = 0;
  private h22DamageApplied = 0;
  /** H18 低血爆发在敌人步进结束后统一结算，避免在受击回调里重入敌人状态。 */
  private pendingLowHealthBurst = false;
  private hexChoice: HexChoice | null = null;
  private upgradePanel!: Phaser.GameObjects.Container;
  private upgradePanelTitle!: Phaser.GameObjects.Text;
  private upgradePanelHint!: Phaser.GameObjects.Text;
  private upgradeCardViews: UpgradeCardView[] = [];
  private waveRunner: WaveRunner | null = null;
  private rewardFlow: WaveRewardFlow | null = null;
  private runState!: RunStateMachine;
  private countdownText!: Phaser.GameObjects.Text;
  private staleHintHud!: Phaser.GameObjects.Text;
  private waveNumber = 1;
  /** 本波击杀数；波末简报与续局快照使用，换波时清零。 */
  private waveKills = 0;
  private waveClearHandled = false;
  private appliedLevel = 1;
  private xpOrbViews = new Map<number, Phaser.GameObjects.Arc>();
  private soulVisuals = new Map<
    number,
    { readonly body: Phaser.GameObjects.Arc; readonly ring: Phaser.GameObjects.Arc }
  >();
  private telegraphViews = new Map<string, SpawnTelegraphView>();
  private enemyProjectileViews = new Map<number, EnemyProjectileView>();
  /** Boss 地面延迟爆破预警；按爆破 id 对齐纯逻辑状态。 */
  private bossBlastViews = new Map<number, BossBlastView>();
  /** 精英地面爆破预警；与纯逻辑使用同一爆破 id。 */
  private eliteBlastViews = new Map<number, BossBlastView>();
  /** 本局精英核心资格；只由击败指定精英 ID 记录。 */
  private readonly eliteCore = new EliteCoreTracker();
  private pauseHint!: Phaser.GameObjects.Text;
  private deathHint!: Phaser.GameObjects.Text;
  private resultHint!: Phaser.GameObjects.Text;
  private bossHud!: Phaser.GameObjects.Text;
  /** 本局结果只记录一次；死亡与胜利共用该守卫。 */
  private resultRecorded = false;
  private rewardOverlay!: Phaser.GameObjects.Text;
  private healthHud!: Phaser.GameObjects.Text;
  private targetHud!: Phaser.GameObjects.Text;
  private killHud!: Phaser.GameObjects.Text;
  private waveHud!: Phaser.GameObjects.Text;
  private dodgeHud!: Phaser.GameObjects.Text;
  private ammoHud!: Phaser.GameObjects.Text;
  /** HUD 字段与事件的单一事实来源；渲染前用纯函数生成文本。 */
  private hudState!: HudState;
  private hudReady = false;
  /** 战斗内短提示队列：金币、战利品资格等；不弹窗、不打断输入。 */
  private hudToasts: readonly HudToast[] = [];
  private readonly hudToastTexts = new Map<number, Phaser.GameObjects.Text>();
  private nextHudToastId = 1;
  private skillBar!: Phaser.GameObjects.Container;
  private skillSlotViews: Record<HudSkillKey, HudBarSlotView> | null = null;
  private dodgeSlotView!: HudBarSlotView;
  /** 自由技能 U/I 的独立两槽条（图标、说明与冷却）。 */
  private freeSkillBar!: Phaser.GameObjects.Container;
  private freeSkillSlotViews: Record<FreeSkillSlotKey, HudBarSlotView> | null = null;
  /** 阿米娅 L 奇美拉 / 塞雷娅 L 钙质化的状态与剩余秒数。 */
  private chimeraHud!: Phaser.GameObjects.Text;
  /** 塞雷娅钙质化领域范围提示，跟随玩家位置。 */
  private calciumFieldVisual?: Phaser.GameObjects.Arc;
  private buildHud!: Phaser.GameObjects.Text;
  private targetRing!: Phaser.GameObjects.Ellipse;
  /** 本体占位标记：地面外圈、短标签与八向指示线。 */
  private playerMarkerRing!: Phaser.GameObjects.Arc;
  private playerMarkerLabel!: Phaser.GameObjects.Text;
  private playerFacingGraphics!: Phaser.GameObjects.Graphics;
  private enemies: EnemyView[] = [];
  /** 本波宝箱（每波最多 1 个）；未打破时在波末移除。 */
  private chest: ChestView | null = null;
  private chestSpawned = false;
  /** 本波已打破的宝箱 ID；波末用于生成待领取资格。 */
  private brokenChestIds: string[] = [];
  private projectiles: ProjectileView[] = [];
  /** E08 侧弹先入缓冲，避免在 `stepProjectiles` 迭代中修改正在遍历的数组。 */
  private pendingDerivedBullets: ProjectileView[] = [];
  private nextProjectileId = 1;
  private jHeld = false;
  private killCount = 0;
  /** 本局对敌人实际造成的累计伤害；只统计结算成功的伤害。 */
  private damageDealt = 0;
  /** 本局成绩的唯一标识；同局结算去重只认它。 */
  private readonly resultRunId = createRunKey();
  private castPoseSeconds = 0;
  private castPoseFacing: Facing | null = null;
  /** 最近一发 J 的轻自瞄结果；开发快照用它记录瞄准角与目标。 */
  private lastShot: DevShotSnapshot | null = null;
  /** 玩家受击动画剩余秒数；播放受击帧，结束后回到待机/行走。 */
  private hurtPoseSeconds = 0;
  private combatPaused = false;
  private readonly pauseController = new PauseController();
  private settingsStore!: SettingsStore;
  private soundPlayer!: SoundPlayer;
  private unsubscribeSettings?: () => void;
  private controlsHint!: Phaser.GameObjects.Text;
  private simulatedSeconds = 0;
  /** 续局存档状态：失败时显示“本局无法保存”，并供开发快照断言。 */
  private saveHint!: Phaser.GameObjects.Text;
  private lastSaveOk = true;
  private lastCheckpointKind: RunCheckpointKind | null = null;
  /** 从快照恢复期间禁止写回，避免覆盖待选手牌。 */
  private restoringCheckpoint = false;
  /** 开发场景参数与起始波覆盖；生产环境恒为 null。 */
  private devScenario: DevScenario | null = null;
  /** 开发参数的请求/生效对照与失败原因；生产环境恒为 null。 */
  private devScenarioReport: DevScenarioReport | null = null;
  private devInitialWaveDefinition: WaveDefinition | null = null;
  private devReady = false;
  /** 开发用商店货架演示；只读、独立种子，不参与本局经济。 */
  private shopDemoReport: ShopDemoReport | null = null;
  /** 开发用商店交易演示；只读、独立钱包与库存，不参与本局经济。 */
  private shopTransactionDemoReport: ShopTransactionDemoReport | null = null;
  /** 当前波末货架；波中为 null，进入下一波时清空。 */
  private shopShelf: ShopShelf | null = null;
  /** 当前商店的交易会话；购买/重抽/出售都经它原子提交。 */
  private shopSession: ShopSession | null = null;
  /** 当前商店的自由技能交易；与货架同生共死，负责选槽、升级与替换回收。 */
  private freeSkillShop: FreeSkillShop | null = null;
  /** 上一商店锁定、要在下一商店保留的商品；跨波暂存。 */
  private pendingShopLock: ShopLockedOffer | null = null;
  /** 正式商店界面的页面/焦点/二次确认状态。 */
  private readonly shopUiCursor = new ShopUiCursor();
  /** 商店 DOM 面板是否由场景接管键盘。 */
  private shopPanelOpen = false;
  /** 构筑面板（B）是否打开；打开时场景暂停并由 DOM 面板接管键盘。 */
  private buildPanelOpen = false;
  /** 本商店已购买药剂的次数；用于「再买一个」文案与上限提示。 */
  private readonly shopPotionPurchases = new Map<string, number>();
  /** 单条配方追踪与缺件保底计数；随 V2 快照保存。 */
  private readonly recipeTracker = new RecipeTracker();
  /** 本局永久道具的逐层支付账本；跨商店保留，出售按此回收 40%。 */
  private readonly shopPayments = new ItemPaymentLedger();
  /** P01–P08 的即时治疗效果与下一波临时增益。 */
  private readonly consumables = new ConsumableEffects();
  /** `?dev=1&shopOps=...` 的执行报告；未启用或尚未进入商店为 null。 */
  private devShopOpsReport: DevShopOpsReport | null = null;
  /** 开发商店操作只在第一个商店执行一次。 */
  private devShopOpsRan = false;
  /** 隔离性能场景：跳过波次流程，维持固定同屏实体数量。 */
  private perfScenario = false;
  private perfSpawnSerial = 0;
  private perfProjectileAngle = 0;

  constructor() {
    super(SCENE_KEYS.arena);
  }

  /** 当前商店的交易会话；正式商店界面（US-046）从这里提交购买/重抽/出售。 */
  get shopTransaction(): ShopSession | null {
    return this.shopSession;
  }

  preload(): void {
    for (const [id, path] of Object.entries(ENEMY_ART)) this.load.image(`enemy-art-${id}`, path);
    for (const [id, path] of Object.entries(ITEM_ART)) this.load.image(`item-art-${id}`, path);
    this.load.image('illustrated-chest', EXTRA_ART.chest);
    this.load.spritesheet('atlas-fx', FX_ART, { frameWidth: 128, frameHeight: 128 });
    this.load.image(ASSET_KEYS.floor, ASSET_PATHS.floor);
    this.load.image(ASSET_KEYS.wall, ASSET_PATHS.wall);
    this.load.image(ASSET_KEYS.cover, ASSET_PATHS.cover);
    // 每名角色按自己的规格载入：四名角色都是 96×96 的 9 列样板。
    for (const characterId of PLAYER_SPRITE_IDS) {
      const art = playerArtFor(characterId);
      this.load.spritesheet(
        this.characterAssetKey(characterId),
        this.characterAssetPath(characterId),
        {
          frameWidth: art.frameWidth,
          frameHeight: art.frameHeight,
        },
      );
    }
  }

  create(): void {
    for (const [row, effect] of ['flame', 'ice', 'tide', 'arcane'].entries()) {
      if (!this.anims.exists(`fx-${effect}`)) this.anims.create({ key: `fx-${effect}`, frames: this.anims.generateFrameNumbers('atlas-fx', { start: row * 4, end: row * 4 + 3 }), frameRate: 16, repeat: 0 });
    }
    this.layout = createArenaLayout();
    this.settingsStore = resolveSettingsStore(this.registry);
    this.soundPlayer = resolveSoundPlayer(
      this.registry,
      () => this.settingsStore.get().muted,
    );

    this.add.image(0, 0, ASSET_KEYS.floor).setOrigin(0, 0).setDepth(0);

    for (const wall of this.layout.walls) {
      this.add
        .tileSprite(wall.x, wall.y, wall.width, wall.height, ASSET_KEYS.wall)
        .setOrigin(0, 0)
        .setDepth(2);
    }

    for (const cover of this.layout.covers) {
      this.add
        .tileSprite(cover.x, cover.y, cover.width, cover.height, ASSET_KEYS.cover)
        .setOrigin(0, 0)
        .setDepth(2);
      this.add
        .rectangle(cover.x, cover.y + cover.height, cover.width, 4, 0x000000, 0.35)
        .setOrigin(0, 0)
        .setDepth(1);
    }

    // 仅开发环境读取场景参数；生产构建会移除整段入口。
    if (import.meta.env.DEV) {
      const resolution = resolveDevScenario(location.search);
      const scenario = resolution.scenario;
      if (scenario) {
        this.devScenario = scenario;
        this.devScenarioReport = resolution.report;
        this.perfScenario = scenario.perf;
        this.devInitialWaveDefinition = scenario.enemies
          ? applyScenarioToWave(getWave(scenario.wave ?? 1), scenario.enemies)
          : null;
        // 波间合成面板：只指定展示哪条配方，材料与金币仍由 items/gold 预置。
        this.devCraftRecipe = scenario.craft
          ? (scenario.craft as CraftedItemId)
          : null;
        // 只读演示：使用独立的链与闸门实例，不触碰本局战斗状态。
        if (scenario.triggerDemo) {
          this.triggerDemoReport = runTriggerDemo();
          this.skillEchoDemoReport = runSkillEchoDemo();
        }
        // 商店货架演示同样只读：独立固定种子，不消费本局 reward 流。
        this.shopDemoReport = runShopDemo();
        this.shopTransactionDemoReport = runShopTransactionDemo();
      }
    }

    this.character = getCharacter(
      this.readCheckpoint()?.characterId ?? resolvePlayableCharacterId(this.registry),
    );
    // 基础值只读快照；所有内容来源后续通过 setSource 注册，不直接改写角色数据。
    this.stats = new StatAggregator(characterBaseStats(this.character));
    // 新局从零开始；续局随后由快照恢复剩余冷却与每波/每局计数。
    this.triggerGates.resetRun();
    // H07 分身礼炮：召唤物消失时同一秒内跨所有召唤物最多 2 次爆破。
    if (!this.triggerGates.hasRule(H07_TRIGGER_RULE.id)) {
      this.triggerGates.registerRule(H07_TRIGGER_RULE);
    }
    this.createPlayerAnimations(this.character.id);
    this.hudState = createHudState(this.character.id);

    this.attackTimer = new AttackTimer(this.character.attack.intervalSeconds);
    // 提示目标与轻自瞄共用通视判定：被墙/掩体挡住的敌人不出提示、也不抢方向。
    this.targetTracker = new TargetTracker(
      this.character.attack.range,
      TARGET_SECTOR_DEGREES,
      (from, to) => hasLineOfSight(this.layout, from, to),
    );
    this.playerHealth = new HealthState({
      id: 'player',
      events: this.combatEventSink,
      maxHealth: this.effectiveMaxHealth(),
      armor: this.stats.armor,
      magicResist: this.stats.magicResist,
    });
    this.enemySystem = new EnemySystem({
      layout: this.layout,
      events: this.combatEventSink,
    });
    this.progression = new ProgressionSystem();
    this.economy = new EconomyLedger();
    // 本局两条独立随机流；开发环境可用 ?seed= 固定种子复现。
    const runSeed = this.devScenario?.seed ?? resolveRunSeed();
    this.randomStreams = new RunRandomStreams(runSeed);
    // 强化/机制手牌与后续商店共用 reward 流，互不串线、各自可快照恢复。
    this.upgradeRun = new UpgradeRun({
      characterId: this.character.id,
      pool: UPGRADE_LIST,
      seed: runSeed,
      random: this.randomStreams.reward,
    });
    // 海克斯手牌与强化/商店共用同一条 reward 流，按顺序消费。
    this.hexRun = new HexRun({
      characterId: this.character.id,
      random: this.randomStreams.reward,
      freeSkillIds: () => this.equippedFreeSkillIds(),
    });
    // 层数真源在 UpgradeRun；实效模块只读取层数并派生倍率与临时状态。
    this.buildEffects = new UpgradeEffects({
      stacksOf: (upgradeId) => this.upgradeRun.stacksOf(upgradeId),
    });

    // 续局恢复：经验、强化层数、重抽次数与随机状态先写入，再按快照恢复生命；
    // 随机状态写入后后续抽卡与刷新前保持同一序列，不重抽。
    const checkpoint = this.readCheckpoint();
    if (checkpoint) {
      this.restoringCheckpoint = true;
      this.progression.restore({
        level: checkpoint.level,
        experience: checkpoint.experience,
        totalExperience: checkpoint.totalExperience,
        pendingLevelUps: checkpoint.pendingLevelUps,
      });
      // 金币从快照继续累计；旧存档没有该字段时回退到初始 40。
      this.economy.restore(checkpoint.gold);
      // 已获得的永久道具层数随续局保留；旧存档没有该字段时为空。
      this.itemInventory.restore(checkpoint.items);
      // 追踪的配方与缺件保底计数随续局恢复；职业不可用/已拥有时自动放弃。
      this.recipeTracker.restore(
        checkpoint.recipeTracking,
        this.recipeTrackingContext(),
      );
      // 两条随机流先恢复：后续抽卡/货架恢复都从保存位置继续，不重复消费。
      if (checkpoint.randomStates) {
        this.randomStreams.restore(checkpoint.randomStates);
      } else {
        this.randomStreams.restoreStream('reward', checkpoint.randomState);
      }
      this.upgradeRun.restore({
        stacks: checkpoint.upgrades,
        rerollsRemaining: checkpoint.rerollsRemaining,
        randomState: checkpoint.randomStates?.reward ?? checkpoint.randomState,
      });
      // 海克斯唯一层数随续局恢复；旧存档没有该字段时为空。
      this.hexRun.restore({ hexes: checkpoint.hexes });
      // 自由技能 U/I 两槽（等级/累计实付/首购补贴）随续局恢复；冷却也不再归零。
      this.freeSkills.restore(checkpoint.freeSkills);
      // 已合成成品与 R01 成长/机制计数随续局恢复；聚合属性与合成入口都以这里的账本为准。
      this.craftedInventory.restore(checkpoint.crafted);
      this.craftedEffects.restore(checkpoint.craftedMechanics);
      // 逐层支付账本随续局恢复，刷新后出售仍按实际支付回收 40%。
      this.shopPayments.restore(checkpoint.payments);
      // 生命上限由聚合器按等级与强化层数重建；恢复当前值时只做钳制，不额外回血。
      this.syncStatSources();
      this.playerHealth.setDefenses(this.stats.armor, this.stats.magicResist);
      this.playerHealth.setMaxHealth(this.effectiveMaxHealth());
      this.playerHealth.restoreHealth(
        checkpoint.health.current,
        this.effectiveMaxHealth(),
      );
      this.playerHealth.setShield(checkpoint.health.shield ?? 0);
      // 击杀与累计伤害从快照继续累计；旧存档缺字段时由纯函数按 0 起步。
      const combatStats = restoredCombatStats(checkpoint);
      this.killCount = combatStats.kills;
      this.damageDealt = combatStats.damageDealt;
      this.eliteCore.restore(checkpoint.coreRewardIds);
      // 已拥有核心随续局保留；波末当前核心候选已固定在奖励队列里，不重抽。
      this.coreInventory.restore(checkpoint.coreIds);
      // 核心效果计数/冷却与核心账本分别恢复；旧存档缺字段时归零。
      this.coreEffects.restore(checkpoint.coreEffects);
      // 快照里的生命已包含升级成长；避免 restore 后再发一次升级奖励。
      this.appliedLevel = this.progression.level;
    }

    // 开发入口可在开局预置金币，便于在第 1/7/13 次商店补足验收资金。
    // 只存在于开发构建；正常对局仍从 40 金币起步。
    if (this.devScenario && this.devScenario.gold !== null) {
      this.economy.restore(this.devScenario.gold);
    }

    if (this.character.id === 'amiya') {
      this.createAmiyaCombat();
    } else if (this.character.id === 'saria') {
      this.createSariaCombat();
    } else if (this.character.id === 'muelsyse') {
      this.createMuelsyseCombat();
    } else {
      this.createVishdalCombat();
    }

    this.motion = new PlayerMotion({
      layout: this.layout,
      moveSpeed: this.character.moveSpeed,
      startX: this.layout.spawn.x,
      startY: this.layout.spawn.y,
      radius: PLAYER.radius,
      keyBindings: this.settingsStore.get().keyBindings,
    });
    // 初始层数为 0，倍率均为 1；获得强化后再同步到各系统。
    this.syncBuildModifiers();

    const spawn = this.motion.position;
    const initialDirection = facingToSpriteDirection(this.motion.facingDirection);
    const art = this.playerArt();
    this.playerShadow = this.add
      .ellipse(spawn.x, spawn.y - PLAYER.bodyCenterOffsetY + 2, 30, 12, 0x000000, 0.4)
      .setDepth(3);

    this.player = this.physics.add
      .sprite(
        spawn.x,
        spawn.y - PLAYER.bodyCenterOffsetY,
        this.playerAssetKey(),
        playerFrameIndex(initialDirection, 'idle', 0, art),
      )
      .setOrigin(art.originX, art.originY)
      .setScale(art.displayScale)
      .setDepth(4);
    this.player.play(playerAnimationKey(initialDirection, 'idle', this.character.id));

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    // setCircle 的半径与偏移都是源码像素；乘显示缩放后世界半径仍为 12。
    body.setCircle(art.bodyRadius, art.bodyOffsetX, art.bodyOffsetY);

    this.targetRing = this.add
      .ellipse(0, 0, ENEMY_RADIUS * 2 + 14, ENEMY_RADIUS * 2 + 14, 0x000000, 0)
      .setStrokeStyle(2, 0xffd166, 0.95)
      .setDepth(5)
      .setVisible(false);

    // 本体占位标记：地面外圈 + 短标签 + 八向指示线。
    // 外圈半径只用于显示，玩家碰撞半径仍由 PLAYER.radius（12）决定。
    this.playerMarkerRing = this.add
      .circle(spawn.x, spawn.y, MARKER_RING_RADIUS.player, 0x000000, 0)
      .setStrokeStyle(PLAYER_MARKER.ringWidth, 0xffd166, PLAYER_MARKER.ringAlpha)
      .setDepth(3);
    this.playerFacingGraphics = this.add.graphics().setDepth(6);
    this.playerMarkerLabel = this.add
      .text(spawn.x, spawn.y + 8, `${PLAYER_MARKER.glyph} ${PLAYER_MARKER.label}`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffe9a8',
        stroke: '#181018',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setDepth(6);

    this.playerMarkerLabel.setVisible(false);

    // HUD 顶部左侧：目标 → 生命/护盾 → 波次/等级/经验/击杀 → 闪避 → 角色资源 → 技能详情。
    this.add.rectangle(0, 0, VIEWPORT.width, 88, 0x0b1720, 0.9).setOrigin(0).setScrollFactor(0).setDepth(48).setStrokeStyle(1, 0x766746, 0.6);
    this.targetHud = this.add
      .text(18, 68, '目标 无', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.body}px`,
        color: '#ffe9a8',
        stroke: '#181018',
        strokeThickness: 4,
      })
      .setScrollFactor(0)
      .setDepth(50);

    this.healthHud = this.add
      .text(18, 16, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.body}px`,
        color: '#ff8a8a',
        stroke: '#181018',
        strokeThickness: 4,
      })
      .setScrollFactor(0)
      .setDepth(50);

    this.waveHud = this.add
      .text(350, 16, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.body}px`,
        color: '#9be7a4',
        stroke: '#181018',
        strokeThickness: 4,
      })
      .setScrollFactor(0)
      .setDepth(50);

    this.killHud = this.add
      .text(790, 16, '击杀 0 · 金币 40', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.small}px`,
        color: '#f4ead2',
        stroke: '#181018',
        strokeThickness: 4,
      })
      .setScrollFactor(0)
      .setDepth(50);

    this.dodgeHud = this.add
      .text(790, 44, '闪避 就绪', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.small}px`,
        color: '#cfe8ff',
        stroke: '#181018',
        strokeThickness: 4,
      })
      .setScrollFactor(0)
      .setDepth(50);

    this.ammoHud = this.add
      .text(18, 42, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.small}px`,
        color: '#ffb347',
        stroke: '#181018',
        strokeThickness: 4,
      })
      .setScrollFactor(0)
      .setDepth(50);

    // 奇美拉/钙质化等长状态说明；容器与技能条共享同一份 HUD 状态。
    this.chimeraHud = this.add
      .text(18, 96, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.small}px`,
        color: '#a8d8ff',
        stroke: '#181018',
        strokeThickness: 4,
      })
      .setScrollFactor(0)
      .setDepth(50)
      .setVisible(false);

    // 存储不可写时明确提示；不允许悄悄假装已保存。
    this.saveHint = this.add
      .text(18, 120, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.small}px`,
        color: '#ffb070',
        stroke: '#181018',
        strokeThickness: 3,
      })
      .setScrollFactor(0)
      .setDepth(50)
      .setVisible(false);

    // 构筑面板：右上角显示已获得强化的实际层数与当前实效，获得后立即刷新。
    this.buildHud = this.add
      .text(VIEWPORT.width - 16, 140, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.small}px`,
        color: '#cfc4b6',
        stroke: '#181018',
        strokeThickness: 3,
        align: 'right',
        maxLines: 2,
        lineSpacing: 4,
        wordWrap: { width: 300, useAdvancedWrap: true },
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(50);
    this.updateBuildHud();

    this.controlsHint = this.add
      .text(18, 524, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.small}px`,
        color: '#cfc4b6',
        stroke: '#181018',
        strokeThickness: 3,
        maxLines: 1,
        wordWrap: { width: 920, useAdvancedWrap: true },
      })
      .setScrollFactor(0)
      .setDepth(50);
    this.updateControlsHint(this.settingsStore.get().keyBindings);

    // 底部技能条：J/K/L 图标、技能名、冷却秒数与闪避；图标与文字都固定在安全区内。
    this.skillBar = this.add.container(0, -12).setScrollFactor(0).setDepth(50);
    // 自由技能 U/I 独立成条，排在主技能条上方，名称/说明不被挤压。
    this.freeSkillBar = this.add.container(0, -12).setScrollFactor(0).setDepth(50);
    this.createHudBar();
    this.hudReady = true;
    this.refreshHud();

    this.physics.world.setBounds(0, 0, ARENA.width, ARENA.height);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, ARENA.width, ARENA.height);
    camera.centerOn(spawn.x, spawn.y);
    camera.setRoundPixels(true);
    camera.startFollow(this.player, true, 1, 1);
    camera.fadeIn(320, 12, 10, 18);

    this.pauseHint = this.add
      .text(VIEWPORT.width / 2, VIEWPORT.height / 2, '已暂停\n按 Enter 继续', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#f4ead2',
        backgroundColor: '#0d0b12',
        padding: { x: 18, y: 14 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false);

    this.deathHint = this.add
      .text(VIEWPORT.width / 2, VIEWPORT.height / 2, '生命归零\n按 Enter 返回选角', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ff8a8a',
        backgroundColor: '#0d0b12',
        padding: { x: 22, y: 16 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101)
      .setVisible(false);

    this.resultHint = this.add
      .text(VIEWPORT.width / 2, VIEWPORT.height / 2, '', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ffe9a8',
        backgroundColor: '#0d0b12',
        padding: { x: 22, y: 16 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101)
      .setVisible(false);

    // Boss 阶段与召唤计时；普通波隐藏，交给后续 HUD 故事统一排版。
    this.bossHud = this.add
      .text(VIEWPORT.width / 2, 99, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffb4a2',
        stroke: '#181018',
        strokeThickness: 4,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(50)
      .setVisible(false);

    this.rewardOverlay = this.add
      .text(VIEWPORT.width / 2, VIEWPORT.height / 2 - 30, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffe9a8',
        backgroundColor: '#0d0b12',
        padding: { x: 20, y: 14 },
        align: 'left',
        // 逻辑视口只有 960×540：长行（净变化、机制说明）必须换行，否则横向溢出。
        wordWrap: { width: VIEWPORT.width - 80 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(102)
      .setVisible(false);

    // 每波开场的 3 秒倒计时；倒计时期间不推进刷怪与战斗逻辑。
    this.countdownText = this.add
      .text(VIEWPORT.width / 2, VIEWPORT.height / 2 - 20, '', {
        fontFamily: 'monospace',
        fontSize: '30px',
        color: '#ffe9a8',
        backgroundColor: '#0d0b12',
        padding: { x: 24, y: 16 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false);

    // 普通波超过 90 秒后提示残敌方位；只做提示，不传送或隐藏敌人。
    this.staleHintHud = this.add
      .text(VIEWPORT.width / 2, 14, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffd166',
        stroke: '#181018',
        strokeThickness: 4,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(50)
      .setVisible(false);

    this.createUpgradePanel();

    // 开发场景可开局直接授予强化，分别复现 W01+W02 与 W03+W04 的可见差异。
    // 必须等 HUD 创建后再授予：G04 等提高上限的卡会走 applyAcquiredUpgrade →
    // syncHealthHud，提前授予会在 create 阶段访问尚未创建的 deathHint。
    // 重复 ID 会逐次叠层；已满层的重复项不再重复结算获取时效果。
    if (this.devScenario?.upgrades) {
      for (const id of this.devScenario.upgrades) {
        const card = getUpgrade(id);
        if (card.owner !== 'general' && card.owner !== this.character.id) continue;
        const previousStacks = this.upgradeRun.stacksOf(id);
        if (this.upgradeRun.acquire(id) > previousStacks) {
          this.applyAcquiredUpgrade(card);
        }
      }
      this.updateBuildHud();
    }

    // 开发场景可预置已拥有海克斯，用于验证唯一层数、职业池与重复获得拒绝。
    if (this.devScenario?.hexes) {
      for (const hexId of this.devScenario.hexes) {
        this.hexRun.acquire(hexId);
      }
      // 属性类海克斯在开局就进入聚合，浏览器可直接核对净属性与价格修正。
      this.syncBuildModifiers();
      this.syncHealthHud();
      this.updateBuildHud();
    }

    // 开发场景可预置已拥有核心，用于验证候选排除与通用/兼容方向。
    if (this.devScenario?.cores) {
      for (const coreId of this.devScenario.cores) {
        this.coreInventory.acquire(coreId);
      }
      // 开发场景直接授予核心后立即启用 E04 的倍率/幻影，便于实际战斗核对。
      this.syncCoreEffects();
    }

    // 开发场景可预置永久道具层数，用于在商店界面（US-046）落地前
    // 直接核对正负效果、叠层上限与构筑面板数值。
    if (this.devScenario?.items) {
      for (const itemId of this.devScenario.items) {
        this.itemInventory.acquire(itemId);
      }
      this.refreshItemBuild();
    }

    // 开发场景可直接预置成品，用于在正式商店/合成界面落地前核对
    // R01–R03 的成长、反击、爆炸连锁与侧弹；成品仍每件唯一。
    if (this.devScenario?.crafted) {
      for (const recipeId of this.devScenario.crafted) {
        this.craftedInventory.acquire(recipeId);
      }
      this.refreshItemBuild();
    }

    // 开发入口：开局追踪一条配方。已有续局追踪时不覆盖，便于验证刷新后保持。
    if (this.devScenario?.track && !this.recipeTracker.trackedRecipeId) {
      this.recipeTracker.track(this.devScenario.track, this.recipeTrackingContext());
    }

    // 开发预置自由技能槽：按第一商店价格估算累计实付，便于验证替换回收。
    if (this.devScenario?.skills) {
      this.freeSkills.reset();
      for (const preset of this.devScenario.skills) {
        const slot = this.freeSkills.firstEmptySlot();
        const definition = getFreeSkill(preset.id);
        if (!slot || !definition) break;
        let paidTotal = definition.basePrice;
        if (preset.level >= 2) paidTotal += Math.ceil(definition.basePrice * 0.6);
        if (preset.level >= 3) paidTotal += Math.ceil(definition.basePrice * 0.9);
        this.freeSkills.setSlot(slot, {
          id: preset.id,
          level: preset.level,
          paidTotal,
        });
      }
      // 预置后重新应用聚合属性：I15/P06 等冷却缩减也要作用到 U/I。
      this.syncBuildModifiers();
      this.refreshFreeSkillBar();
    }

    this.runState = new RunStateMachine();
    this.runState.enterCharacterSelect();
    if (checkpoint) {
      this.startRestoredRun(checkpoint);
    } else if (this.perfScenario) {
      this.startPerfScenario();
    } else {
      this.startWave(this.devScenario?.wave ?? 1);
      // 开发入口预置经验：用于直接触发 2 级海克斯三选一，不参与正常对局。
      if (this.devScenario?.xp) {
        this.progression.addExperience(this.devScenario.xp);
        this.syncLevelHealth();
        if (this.progression.pendingLevelUps > 0) this.refreshRewardOverlay();
      }
    }
    this.restoringCheckpoint = false;

    this.logicLoop = new FixedStepLoop({
      onStep: (stepSeconds) => {
        const wasDodging = this.motion.isDodging;
        this.motion.step(stepSeconds);
        // 闪避结束的这一逻辑步在终点结算 G07 脉冲与 H06 攻速窗口。
        if (wasDodging && !this.motion.isDodging) {
          this.triggerDodgePulse();
          this.combatHexes.endDodge();
          this.combatHexes.activateDodgeAttackBuff();
          if (this.combatHexes.dodgeAttackBuffRemaining > 0) {
            this.showSkillLabel('滑步开火 · J 攻速 +50%', '#ffd27a');
          }
        }
        this.buildEffects.step(stepSeconds);
        this.triggerGates.step(stepSeconds);
        this.coreEffects.step(stepSeconds);
        this.simulatedSeconds += stepSeconds;
        // 性能场景在伤害结算前补满生命与同屏数量，保证 60 秒内负载稳定。
        if (this.perfScenario) this.maintainPerfScenario();
        this.updateCombat(stepSeconds);
        // 短提示按模拟秒淡出；与 HUD 数值同步，暂停时一并冻结。
        this.refreshHudToasts();
        // 生命变化后实时刷新 E07；只在跨过 50% 阈值时重算属性来源。
        this.syncCoreLowHealth();
        this.syncPlayerSprite();
        this.syncPlayerAnimation();
      },
    });

    this.bindCombatInput();
    // 设置面板修改后立即推给移动系统与快捷键提示，无需重开本局。
    this.unsubscribeSettings = this.settingsStore.subscribe((settings) => {
      this.motion.setKeyBindings(settings.keyBindings);
      this.updateControlsHint(settings.keyBindings);
      this.updateSkillKeyLabels(settings.keyBindings);
    });
    // SHUTDOWN 覆盖 stop/restart；DESTROY 覆盖 game.destroy()（SceneManager 销毁
    // 场景时只发 DESTROY 不发 SHUTDOWN），两条路径都必须释放设置订阅。
    const releaseSceneResources = (): void => {
      this.unsubscribeSettings?.();
      this.unsubscribeSettings = undefined;
      // 场景销毁后立即让开发快照/诊断返回 null，避免桥在销毁中途读到半状态。
      this.devReady = false;
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, releaseSceneResources);
    this.events.once(Phaser.Scenes.Events.DESTROY, releaseSceneResources);
    // 续局恢复后先保持暂停，由暂停面板 Enter 明确继续（§9）。
    if (this.readCheckpoint()) {
      this.requestPause('checkpoint');
    }
    // 快照桥只读取创建完成后的稳定状态；此前返回 null。
    this.devReady = true;
  }

  /** 维什戴尔的榴弹/魂灵/爆裂系统；数值缺失直接报错，避免静默偏离 docs。 */
  private createVishdalCombat(): void {
    const afterimage = this.character.passive.afterimage;
    if (!afterimage) throw new Error('维什戴尔缺少残影配置');
    // 爆炸不穿墙：伤害结算前用场地几何判定爆心到目标的通视。
    this.grenade = new GrenadeSystem(
      this.character.attack,
      afterimage,
      (from, to) => hasLineOfSight(this.layout, from, to),
    );

    const soulSkill = this.character.skillK;
    if (!soulSkill.durationSeconds) throw new Error('维什戴尔 K 缺少持续时间');
    this.soul = new SoulSystem(
      {
        cooldownSeconds: soulSkill.cooldownSeconds,
        durationSeconds: soulSkill.durationSeconds,
        maxSummons: requireSkillParam(soulSkill, 'maxSummons'),
        tickSeconds: requireSkillParam(soulSkill, 'tickSeconds'),
        markRadius: requireSkillParam(soulSkill, 'markRadius'),
        slowPercent: requireSkillParam(soulSkill, 'slowPercent'),
        slowDurationSeconds: requireSkillParam(soulSkill, 'slowDurationSeconds'),
      },
      // 残影只有一个真源：魂灵写入 GrenadeSystem 维护的共享标记集合。
      this.grenade,
    );

    const burstSkill = this.character.skillL;
    this.burst = new BurstSystem({
      cooldownSeconds: burstSkill.cooldownSeconds,
      shots: requireSkillParam(burstSkill, 'shots'),
      damageMultiplier: requireSkillParam(burstSkill, 'damageMultiplier'),
      splashRadiusMultiplier: requireSkillParam(burstSkill, 'splashRadiusMultiplier'),
      fireIntervalSeconds: requireSkillParam(burstSkill, 'fireIntervalSeconds'),
      ammoExpirySeconds: requireSkillParam(burstSkill, 'ammoExpirySeconds'),
    });
  }

  /** 阿米娅的 K 冷却/连射/疲劳、L 奇美拉与被动计数。 */
  private createAmiyaCombat(): void {
    const skillK = this.character.skillK;
    const skillL = this.character.skillL;
    if (!skillK.durationSeconds) throw new Error('阿米娅 K 缺少持续时间');
    if (!skillL.durationSeconds) throw new Error('阿米娅 L 缺少持续时间');
    this.amiya = new AmiyaCombat({
      kCooldownSeconds: skillK.cooldownSeconds,
      burstDurationSeconds: skillK.durationSeconds,
      shots: requireSkillParam(skillK, 'shots'),
      damagePerShot: requireSkillParam(skillK, 'damagePerShot'),
      fatigueSeconds: requireSkillParam(skillK, 'fatigueSeconds'),
      burstDamageType: this.character.attack.damageType,
      chimeraCooldownSeconds: skillL.cooldownSeconds,
      chimeraDurationSeconds: skillL.durationSeconds,
      chimeraDamageBonus: requireSkillParam(skillL, 'damageBonus'),
      weaknessSeconds: requireSkillParam(skillL, 'weaknessSeconds'),
      weaknessMoveSpeedMultiplier: requireSkillParam(skillL, 'weaknessMoveSpeedMultiplier'),
    });
    // 精神爆发弹沿用 J 的射程与弹速，只替换伤害与名称。
    this.spiritBurstAttack = {
      ...this.character.attack,
      name: skillK.name,
      damage: requireSkillParam(skillK, 'damagePerShot'),
      damageType: 'magic',
    };
  }

  /** 塞雷娅的 K 冷却/护盾/精神回复与 L 钙质化领域。 */
  private createSariaCombat(): void {
    const skillK = this.character.skillK;
    const skillL = this.character.skillL;
    if (!skillL.durationSeconds) throw new Error('塞雷娅 L 缺少持续时间');
    this.saria = new SariaCombat({
      kCooldownSeconds: skillK.cooldownSeconds,
      healAmount: requireSkillParam(skillK, 'heal'),
      shieldAmount: requireSkillParam(skillK, 'shield'),
      shieldDurationSeconds: requireSkillParam(skillK, 'shieldDurationSeconds'),
      passiveLCooldownReductionSeconds: SARIA_PASSIVE_COOLDOWN_REDUCTION_SECONDS,
      lCooldownSeconds: skillL.cooldownSeconds,
      lDurationSeconds: skillL.durationSeconds,
      fieldRadius: requireSkillParam(skillL, 'fieldRadius'),
      fieldHealPerSecond: requireSkillParam(skillL, 'healPerSecond'),
      enemySlowPercent: requireSkillParam(skillL, 'enemySlowPercent'),
      enemyMagicVulnerability: requireSkillParam(skillL, 'enemyMagicVulnerability'),
      attackBonusMagicDamage: requireSkillParam(skillL, 'attackBonusMagicDamage'),
    });
    // 领域范围提示跟随玩家；逻辑判定仍以 SariaCombat 的半径为准。
    this.calciumFieldVisual = this.add
      .circle(0, 0, this.saria.fieldRadius, 0xffd166, 0.08)
      .setStrokeStyle(2, 0xffd166, 0.45)
      .setDepth(4)
      .setVisible(false);
  }

  /** 缪尔赛思主流形：初始近战形态、K 切换、副本分裂、L 控制与跟随自动攻击。 */
  private createMuelsyseCombat(): void {
    const skillK = this.character.skillK;
    const skillL = this.character.skillL;
    this.muelsyse = new MuelsyseCombat({
      switchCooldownSeconds: skillK.cooldownSeconds,
      melee: {
        maxHealth: requireSkillParam(skillK, 'meleeHealth'),
        attackRange: requireSkillParam(skillK, 'meleeRange'),
        attackIntervalSeconds: requireSkillParam(skillK, 'meleeIntervalSeconds'),
        damage: requireSkillParam(skillK, 'meleeDamage'),
        damageType: 'physical',
        stackDamagePerHit: requireSkillParam(skillK, 'meleeStackDamage'),
        stackArmorPerHit: requireSkillParam(skillK, 'meleeStackArmor'),
        maxStacks: requireSkillParam(skillK, 'meleeMaxStacks'),
      },
      ranged: {
        maxHealth: requireSkillParam(skillK, 'rangedHealth'),
        attackRange: requireSkillParam(skillK, 'rangedRange'),
        attackIntervalSeconds: requireSkillParam(skillK, 'rangedIntervalSeconds'),
        damage: requireSkillParam(skillK, 'rangedDamage'),
        damageType: 'magic',
      },
      copies: {
        everyAttacks: requireSkillParam(skillK, 'rangedCopyEveryAttacks'),
        durationSeconds: requireSkillParam(skillK, 'rangedCopyDurationSeconds'),
        damageRatio: requireSkillParam(skillK, 'rangedCopyDamageRatio'),
        maxCopies: requireSkillParam(skillK, 'rangedMaxCopies'),
      },
      shallowAdaptation: {
        cooldownSeconds: skillL.cooldownSeconds,
        durationSeconds: skillL.durationSeconds ?? 6,
        pullIntervalSeconds: requireSkillParam(skillL, 'pullIntervalSeconds'),
        pullRadius: requireSkillParam(skillL, 'pullRadius'),
        pullDistance: requireSkillParam(skillL, 'pullDistance'),
        stunSeconds: requireSkillParam(skillL, 'stunSeconds'),
        rootSeconds: requireSkillParam(skillL, 'rootSeconds'),
      },
      layout: this.layout,
      startX: this.layout.spawn.x,
      startY: this.layout.spawn.y,
    });
    this.muelsyseCopyViews.clear();
    this.corePhantomVisual = null;
    this.r05FlowformVisual = null;

    const position = this.muelsyse.formPosition;
    const art = playerArtFor('muelsyse');
    this.formShadow = this.add
      .ellipse(position.x, position.y + 10, 28, 10, 0x000000, 0.3)
      .setDepth(3);
    // 脚下水体标记：主流形比副本更大，和透明度一起区分本体/主流形/副本。
    this.formFootMark = this.add
      .ellipse(
        position.x,
        position.y + 10,
        MUELSYSE_FORM_FOOT_MARK.radiusX * 2,
        MUELSYSE_FORM_FOOT_MARK.radiusY * 2,
        MUELSYSE_FOOT_MARK_COLOR,
        0.08,
      )
      .setStrokeStyle(1.5, MUELSYSE_FOOT_MARK_STROKE, 0.55)
      .setDepth(4);
    this.formSprite = this.add
      .sprite(
        position.x,
        position.y - PLAYER.bodyCenterOffsetY,
        ASSET_KEYS.playerMuelsyse,
        playerFrameIndex('down', 'idle', 0, art),
      )
      .setOrigin(art.originX, art.originY)
      .setScale(art.displayScale)
      .setTint(MUELSYSE_RANGED_TINT)
      .setAlpha(MUELSYSE_FORM_ALPHA)
      .setDepth(5);
    this.formHpBackground = this.add
      .rectangle(position.x - 22, position.y - 52, 44, 6, 0x181018, 0.8)
      .setOrigin(0, 0)
      .setDepth(6);
    this.formHpFill = this.add
      .rectangle(position.x - 22, position.y - 52, 44, 6, MUELSYSE_FOOT_MARK_COLOR, 0.95)
      .setOrigin(0, 0)
      .setDepth(7);
    this.formLabel = this.add
      .text(position.x, position.y - FORM_LABEL_OFFSET_Y, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#9df2dd',
        stroke: '#16211f',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(7);
    // 主流形占位标记：双圈 + 八向指示，与本体单圈、副本细圈区分。
    this.formMarkerRing = this.add
      .circle(position.x, position.y, MARKER_RING_RADIUS.form, 0x000000, 0)
      .setStrokeStyle(
        FORM_MARKERS.melee.ringWidth,
        MUELSYSE_FOOT_MARK_STROKE,
        FORM_MARKERS.melee.ringAlpha,
      )
      .setDepth(4);
    this.formMarkerInnerRing = this.add
      .circle(position.x, position.y, MARKER_RING_RADIUS.form - 4, 0x000000, 0)
      .setStrokeStyle(1, MUELSYSE_FOOT_MARK_STROKE, 0.32)
      .setDepth(4);
    this.formFacingGraphics = this.add.graphics().setDepth(6);
    // 近战 L 的拉拽范围提示；只在生效期间显示并跟随主流形。
    this.muelsyseLRing = this.add
      .circle(
        position.x,
        position.y,
        requireSkillParam(skillL, 'pullRadius'),
        MUELSYSE_FOOT_MARK_COLOR,
        0.05,
      )
      .setStrokeStyle(1.5, MUELSYSE_FOOT_MARK_STROKE, 0.4)
      .setDepth(4)
      .setVisible(false);
    this.syncMuelsyseForm();
  }

  /**
   * 起始波可用开发场景的敌人组合覆盖；后续波仍按正常波次数据。
   * 覆盖定义里保留波次号，因此只在同一波号时命中。
   * `eliteOnly=1` 只影响精英波，普通波与 Boss 波保持原定义。
   */
  private waveDefinitionFor(wave: number): WaveDefinition {
    const definition =
      this.devInitialWaveDefinition?.wave === wave
        ? this.devInitialWaveDefinition
        : getWave(wave);
    // 生产构建不解析任何 dev 参数：整段覆盖在静态分支外被摇掉。
    if (!import.meta.env.DEV) return definition;
    return this.devScenario?.eliteOnly
      ? applyEliteOnlyToWave(definition)
      : definition;
  }

  /** 应用壳只写入已校验的快照；这里再解析一次，避免损坏值进入场景。 */
  private readCheckpoint(): RunCheckpoint | null {
    const parsed = parseCheckpoint(this.registry.get(RUN_CHECKPOINT_REGISTRY_KEY));
    return parsed.status === 'ok' ? parsed.checkpoint : null;
  }

  /** 从续局快照恢复：先还原逻辑状态，再按检查点类型重建奖励界面。 */
  private startRestoredRun(checkpoint: RunCheckpoint): void {
    this.waveNumber = checkpoint.wave;
    this.waveKills = checkpoint.waveKills ?? 0;
    // 冷却按剩余秒数恢复；每波/每局计数沿用快照，不因刷新重来。
    this.triggerGates.restore(checkpoint.triggerGates);
    const stage = checkpoint.rewardStage;
    const world = checkpoint.world;

    if (world && stage === 'none') {
      // 波中升级检查点：按快照重建世界状态，不从本波开头重来。
      this.restoreWorldState(world, checkpoint);
    } else if (
      stage === 'briefing' ||
      stage === 'chest' ||
      stage === 'core' ||
      stage === 'upgrade' ||
      stage === 'mechanic'
    ) {
      // 波末奖励：不新建 WaveRunner，不重放吸取、完成金币与补给。
      this.rewardFlow = new WaveRewardFlow(checkpoint.wave);
      this.rewardFlow.restore(
        stage,
        checkpoint.rewardPendingLevelUps,
        checkpoint.rewardQueue,
      );
      this.runState.restoreUpgrade();
      this.restoreRewardUi(checkpoint);
    } else if (stage === 'intermission') {
      this.rewardFlow = new WaveRewardFlow(checkpoint.wave);
      this.rewardFlow.restore(
        'intermission',
        checkpoint.rewardPendingLevelUps,
        checkpoint.rewardQueue,
      );
      this.runState.restoreIntermission();
      // 商店按快照原样重建：货架、售出/锁定、重抽次数与支付账本都不重抽。
      this.restoreShopFromCheckpoint(checkpoint);
      this.restoreRewardUi(checkpoint);
    } else {
      // 波初检查点：从本波开头重建刷怪。
      this.startWave(checkpoint.wave);
      // 池中无可用卡时手牌为 null，但排队升级仍必须显示可确认提示，避免冻结。
      if (
        (checkpoint.hand && checkpoint.handKind) ||
        checkpoint.pendingLevelUps > 0
      ) {
        this.runState.restoreUpgrade();
        this.countdownText?.setVisible(false);
        this.restoreRewardUi(checkpoint);
      }
    }

    // 消耗品层数/护盾账在分支之后恢复：波初检查点会重新执行 beginWave，
    // 提前恢复会让排队层数被二次转层或 P05 护盾被重复扣除。
    this.consumables.restore(checkpoint.consumables);
    // 自由技能效果只在波中检查点落盘；恢复后重建伤害来源与占位视觉。
    this.restoreFreeSkillEffects(checkpoint.freeSkillEffects);
    this.syncBuildModifiers();
    this.syncHealthHud();
    this.updateBuildHud();
    this.updateWaveHud();
    this.syncBurstHud();
    this.syncChimeraHud();
    this.syncSkillHud();
  }

  /**
   * 重建波中世界状态：玩家、敌人、弹体、召唤物、冷却、持续效果与波内时钟。
   * 恢复后仍由 `requestPause('checkpoint')` 保持暂停，Enter 才继续。
   */
  private restoreWorldState(
    world: RunWorldSnapshot,
    checkpoint: RunCheckpoint,
  ): void {
    const runner = new WaveRunner(this.waveDefinitionFor(checkpoint.wave));
    runner.restoreWorld(world.wave);
    this.waveRunner = runner;
    this.rewardFlow = null;
    this.waveClearHandled = false;
    this.jHeld = false;
    this.motion.clearKeys();
    this.logicLoop?.reset();
    this.upgradeChoice = null;
    this.hexChoice = null;
    this.hideUpgradePanel();
    this.rewardOverlay?.setVisible(false);
    this.countdownText?.setVisible(false);
    this.staleHintHud?.setVisible(false);
    this.bossHud?.setVisible(false);

    const needsReward =
      (checkpoint.hand !== null && checkpoint.handKind !== null) ||
      checkpoint.pendingLevelUps > 0;
    if (needsReward) this.runState.restoreUpgrade();
    else this.runState.restoreCombat();

    this.motion.restoreWorld(world.player);
    this.attackTimer.restoreCooldown(world.attackCooldownSeconds);
    this.enemySystem.restoreWorld(world.enemies);
    this.enemies = [];
    for (const unit of this.enemySystem.enemies) this.createEnemyView(unit);
    for (const telegraph of this.enemySystem.telegraphs) {
      this.createSpawnTelegraph(telegraph);
    }
    this.syncEnemyProjectiles();
    this.syncBossBlastWarnings();

    this.projectiles = [];
    this.pendingDerivedBullets = [];
    for (const saved of world.projectiles) this.restorePlayerProjectile(saved);
    this.nextProjectileId = world.nextProjectileId;
    this.simulatedSeconds = world.simulatedSeconds;

    this.buildEffects.restoreWorld(world.effects);
    if (world.souls) this.soul?.restoreWorld(world.souls);
    if (world.grenade) this.grenade?.restoreWorld(world.grenade);
    if (world.burst) this.burst?.restoreWorld(world.burst);
    if (world.amiya) this.amiya?.restoreWorld(world.amiya);
    if (world.saria) this.saria?.restoreWorld(world.saria);
    if (world.muelsyse) this.muelsyse?.restoreWorld(world.muelsyse);

    // 召唤物与玩家视觉按恢复后的逻辑状态重建。
    if (this.soul) {
      for (const soul of this.soul.snapshots) this.createSoulVisual(soul);
    }
    this.syncMuelsyseForm();
    this.syncMuelsyseCopies();
    this.syncCorePhantom();
    this.syncPlayerSprite();
    this.syncPlayerAnimation();
    this.syncMoveSpeed();
    // 暂停画面也要显示恢复后的真实 HUD，而不是新局的默认值。
    this.updateTargetHint();
    this.syncBurstHud();
    this.syncChimeraHud();
    this.syncSkillHud();
    this.syncBossHud();
    this.syncStaleEnemyHint();

    if (needsReward) {
      this.countdownText?.setVisible(false);
      this.restoreRewardUi(checkpoint);
    }
  }

  /** 从快照重建一发玩家弹体；颜色只用于表现，命中与冷却按逻辑状态。 */
  private restorePlayerProjectile(saved: PlayerProjectileWorldSnapshot): void {
    const state: ProjectileState = {
      id: saved.id,
      x: saved.x,
      y: saved.y,
      vx: saved.vx,
      vy: saved.vy,
      radius: saved.radius,
      attack: saved.attack,
      damage: saved.damage,
      damageType: saved.damageType,
      facing: saved.facing,
      pierce: saved.pierce ? { ...saved.pierce } : null,
      hitTargetIds: new Set(saved.hitTargetIds),
      remainingRange: saved.remainingRange,
      ...(saved.returning !== undefined ? { returning: saved.returning } : {}),
      ...(saved.returnCharges !== undefined
        ? { returnCharges: saved.returnCharges }
        : {}),
      ...(saved.returnDamageRatio !== undefined
        ? { returnDamageRatio: saved.returnDamageRatio }
        : {}),
    };
    // 恢复后的弹体沿用当前角色主色，与发射路径保持一致；不影响任何伤害结算。
    const colors = characterEffectColors(this.character.id);
    const sprite = this.add
      .circle(state.x, state.y, projectileVisualRadius(state.radius), colors.projectileFill)
      .setStrokeStyle(1.5, colors.projectileStroke)
      .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
    this.projectiles.push({
      state,
      sprite,
      source: saved.source,
      // E08 侧弹恢复后仍是衍生来源：不参与 E02/E08 的原生命中计数。
      eventSource:
        saved.source === 'E08'
          ? this.damageChains.derive(
              this.damageChains.beginNative('E08'),
              'E08',
            ) ?? this.damageChains.beginNative('E08')
          : this.damageChains.beginNative(saved.source),
      // 续局不保留同一扇射的跨弹记账：恢复后的弹丸各自从满伤开始。
      shotgunVolley:
        saved.source === 'S11' ? new ShotgunVolleyTracker() : undefined,
      ...(saved.h30Finale ? { h30Finale: true } : {}),
    });
  }

  /** 恢复待选手牌或“已无可选强化”提示；不调用抽卡，因此不会重抽。 */
  private restoreRewardUi(checkpoint: RunCheckpoint): void {
    this.resetRewardOverlayAnchor();
    if (checkpoint.hand && checkpoint.handKind) {
      if (checkpoint.handKind === 'hex') {
        const choice = this.hexRun.createChoice({
          hand: checkpoint.hand,
          focusIndex: checkpoint.focusIndex,
        });
        this.hexChoice = choice.hand.length > 0 ? choice : null;
        this.upgradeChoice = null;
      } else {
        const choice = this.upgradeRun.createChoice(checkpoint.handKind, {
          hand: checkpoint.hand,
          focusIndex: checkpoint.focusIndex,
        });
        this.upgradeChoice = choice.hand.length > 0 ? choice : null;
        this.hexChoice = null;
      }
    }

    if (this.activeChoice()) {
      this.rewardOverlay?.setVisible(false);
      this.renderUpgradePanel();
      return;
    }

    this.hideUpgradePanel();
    const stage = checkpoint.rewardStage;
    if (stage === 'briefing') {
      this.rewardOverlay?.setText(this.waveBriefingText()).setVisible(true);
      return;
    }
    if (stage === 'chest') {
      this.renderChestOfferPanel();
      return;
    }
    if (stage === 'core') {
      this.renderCoreOfferPanel();
      return;
    }
    if (stage === 'mechanic') {
      this.rewardOverlay
        ?.setText(`第 ${this.waveNumber} 波机制强化\n已无可用卡，按 Enter 继续`)
        .setVisible(true);
      return;
    }
    if (stage === 'upgrade') {
      this.rewardOverlay
        ?.setText(EMPTY_HEX_POOL_PROMPT)
        .setVisible(true);
      return;
    }
    if (stage === 'intermission') {
      this.showIntermissionOverlay();
      return;
    }
    if (checkpoint.pendingLevelUps > 0) {
      this.rewardOverlay
        ?.setText(EMPTY_HEX_POOL_PROMPT)
        .setVisible(true);
      return;
    }
    this.rewardOverlay?.setVisible(false);
  }

  /** 收集当前可序列化逻辑状态；事件快照与测试断言共用同一口径。 */
  /** 配方追踪的读取上下文：层数走道具账本，成品走唯一库存。 */
  private recipeTrackingContext(): RecipeTrackingContext {
    return {
      characterId: this.character.id,
      stacksOf: (itemId) => this.itemInventory.stacksOf(itemId),
      hasCrafted: (recipeId) => this.craftedInventory.has(recipeId),
    };
  }

  /** 当前商店的可序列化状态；波中/波初没有货架时为 undefined。 */
  private collectShopCheckpoint(): RunShopCheckpoint | undefined {
    if (!this.shopShelf || !this.shopSession) return undefined;
    return {
      ...this.shopShelf.snapshot(),
      freeRerollsUsed: this.shopSession.usedFreeRerolls,
    };
  }

  private collectCheckpointDraft(kind: RunCheckpointKind): RunCheckpointDraft {
    const flowStage = this.rewardFlow?.stage ?? 'none';
    // 同一类边界既可能发生在波内（升级/海克斯），也可能发生在波末；
    // 只有确实还有 WaveRunner 时才保存世界状态与技能效果。
    const worldBoundary = isWorldCheckpointKind(kind) && this.waveRunner !== null;
    const rewardStage: RunSavedRewardStage =
      flowStage === 'briefing' ||
      flowStage === 'chest' ||
      flowStage === 'core' ||
      flowStage === 'upgrade' ||
      flowStage === 'mechanic' ||
      flowStage === 'intermission'
        ? flowStage
        : 'none';
    return {
      kind,
      characterId: this.character.id,
      wave: this.waveNumber,
      health: {
        current: this.playerHealth.health,
        max: this.playerHealth.maxHealth,
        shield: this.playerHealth.shield,
      },
      level: this.progression.level,
      experience: this.progression.experience,
      totalExperience: this.progression.totalExperience,
      pendingLevelUps: this.progression.pendingLevelUps,
      upgrades: this.upgradeRun.ownedIds().map((id) => ({
        id,
        stacks: this.upgradeRun.stacksOf(id),
      })),
      hexes: this.hexRun.ownedIds,
      rerollsRemaining: this.upgradeRun.rerollsRemaining,
      randomState: this.randomStreams.reward.snapshotState,
      randomStates: this.randomStreams.snapshot(),
      remainingSeconds: this.waveRunner
        ? this.waveRunner.remainingSeconds
        : this.runState.phase === 'countdown'
          ? this.runState.countdownRemaining
          : 0,
      hand: this.activeChoice()?.hand.map((card) => card.id) ?? null,
      handKind: this.activeChoice()?.kind ?? null,
      focusIndex: this.activeChoice()?.focusIndex ?? 0,
      rewardStage,
      rewardPendingLevelUps: this.rewardFlow?.pendingLevelUps ?? 0,
      rewardQueue: this.rewardFlow?.isActive
        ? this.rewardFlow.rewardQueueSnapshot
        : undefined,
      waveKills: this.waveKills,
      kills: this.killCount,
      gold: this.economy.gold,
      damageDealt: this.damageDealt,
      coreRewardIds: [...this.eliteCore.rewardIds],
      items: this.itemInventory.snapshot(),
      coreIds: this.coreInventory.snapshot(),
      triggerGates: this.triggerGates.snapshot(),
      coreEffects: this.coreEffects.snapshot(),
      recipeTracking: this.recipeTracker.snapshot(),
      freeSkills: this.freeSkills.saveSnapshot(),
      crafted: this.craftedInventory.snapshot(),
      craftedMechanics: this.craftedEffects.saveSnapshot(),
      consumables: this.consumables.saveSnapshot(),
      freeSkillEffects: worldBoundary
        ? this.collectFreeSkillEffectsSnapshot()
        : undefined,
      shop: this.collectShopCheckpoint(),
      payments: this.shopPayments.snapshot(),
      // 只有可能发生在波内的提交边界需要世界状态；波初/波末/波间与商店
      // 交易边界都从稳定阶段恢复，不再重放战斗。
      world: worldBoundary ? this.collectWorldSnapshot() : null,
    };
  }

  /** 收集波中仍在生效的自由技能效果（时长、坐标与剩余冷却外的一切运行态）。 */
  private collectFreeSkillEffectsSnapshot(): FreeSkillEffectsSave {
    return {
      spinningBlades: this.spinningBlades.saveSnapshot(),
      slows: this.freeSkillSlows.saveSnapshot(),
      fireTrail: this.fireTrail.saveSnapshot(),
      turrets: this.turretField.saveSnapshot(),
      shieldBurst: this.shieldBurst.saveSnapshot(),
      gravityWell: this.gravityWell.saveSnapshot(),
      waterMirror: this.waterMirror.saveSnapshot(),
      warBanner: this.warBanner.saveSnapshot(),
      bountyMark: this.bountyMark.saveSnapshot(),
    };
  }

  /**
   * 恢复自由技能效果并把占位视觉/伤害来源重建到当前世界状态上。
   * 护盾量不在此重复授予：生命快照已包含 S07 护盾，到期仍由场景统一扣除。
   */
  private restoreFreeSkillEffects(save: FreeSkillEffectsSave | undefined): void {
    this.spinningBlades.restore(save?.spinningBlades);
    this.spinningBladesSource = this.spinningBlades.isActive
      ? beginFreeSkillSource(this.damageChains, 'S01')
      : null;
    this.syncSpinningBladesVisual();

    this.freeSkillSlows.restore(save?.slows);

    this.fireTrail.restore(save?.fireTrail);
    this.fireTrailSource = this.fireTrail.isActive
      ? beginFreeSkillSource(this.damageChains, 'S04')
      : null;
    this.syncFireTrailVisual();

    this.turretField.restore(save?.turrets);
    this.turretSources.clear();
    for (const turret of this.turretField.entries()) {
      this.turretSources.set(
        turret.id,
        beginFreeSkillSource(this.damageChains, 'S05'),
      );
    }
    this.syncTurretVisuals();

    this.shieldBurst.restore(save?.shieldBurst);
    this.syncShieldBurstVisual();

    this.gravityWell.restore(save?.gravityWell);
    this.gravityWellSource = this.gravityWell.isActive
      ? beginFreeSkillSource(this.damageChains, 'S08')
      : null;
    this.syncGravityWellVisual();

    this.waterMirror.restore(save?.waterMirror);
    this.syncWaterMirrorVisuals();

    this.warBanner.restore(save?.warBanner);
    this.warBannerSource = this.warBanner.isActive
      ? beginFreeSkillSource(this.damageChains, 'S10')
      : null;
    this.syncWarBannerVisual();
    this.syncWarBannerArmor();

    this.bountyMark.restore(save?.bountyMark);
    this.syncBountyMarkVisual();
  }

  /** 收集波中世界状态；不在波内（无 WaveRunner）时返回 null。 */
  private collectWorldSnapshot(): RunWorldSnapshot | null {
    const runner = this.waveRunner;
    if (!runner) return null;
    return {
      player: this.motion.snapshotWorld(),
      attackCooldownSeconds: this.attackTimer.cooldownRemaining,
      wave: runner.snapshotWorld(),
      enemies: this.enemySystem.snapshotWorld(),
      projectiles: this.projectiles.map(({ state, source, h30Finale }) => ({
        id: state.id,
        source,
        x: state.x,
        y: state.y,
        vx: state.vx,
        vy: state.vy,
        radius: state.radius,
        remainingRange: state.remainingRange,
        attack: state.attack,
        damage: state.damage,
        damageType: state.damageType,
        facing: state.facing,
        pierce: state.pierce ? { ...state.pierce } : null,
        hitTargetIds: [...state.hitTargetIds],
        ...(state.returning !== undefined
          ? { returning: state.returning }
          : {}),
        ...(state.returnCharges !== undefined
          ? { returnCharges: state.returnCharges }
          : {}),
        ...(state.returnDamageRatio !== undefined
          ? { returnDamageRatio: state.returnDamageRatio }
          : {}),
        ...(h30Finale ? { h30Finale: true } : {}),
      })),
      nextProjectileId: this.nextProjectileId,
      simulatedSeconds: this.simulatedSeconds,
      souls: this.soul?.snapshotWorld() ?? null,
      grenade: this.grenade?.snapshotWorld() ?? null,
      burst: this.burst?.snapshotWorld() ?? null,
      amiya: this.amiya?.snapshotWorld() ?? null,
      saria: this.saria?.snapshotWorld() ?? null,
      muelsyse: this.muelsyse?.snapshotWorld() ?? null,
      effects: this.buildEffects.snapshotWorld(),
    };
  }

  /**
   * 在安全检查点写入续局快照；存储不可写时显示“本局无法保存”，本局继续。
   * 恢复过程中不写回，避免刷新时用不完整状态覆盖待选手牌。
   */
  private saveCheckpoint(kind: RunCheckpointKind): void {
    if (this.restoringCheckpoint) return;
    if (this.playerHealth.isDead || this.runState.phase === 'result') return;

    const ok = saveRunCheckpoint(this.collectCheckpointDraft(kind));
    this.lastSaveOk = ok;
    this.lastCheckpointKind = kind;
    this.saveHint?.setText(ok ? '' : '本局无法保存').setVisible(!ok);
  }

  /**
   * 进入隔离性能场景（`?dev=1&perf=1`）：
   * 不创建 WaveRunner，直接切到战斗阶段并铺满固定数量的敌人、敌弹与流形。
   * 每个逻辑步由 `maintainPerfScenario` 补满生命与数量，保证 60 秒测量窗口内
   * 同屏负载稳定；该分支只存在于开发环境。
   */
  private startPerfScenario(): void {
    this.waveNumber = 1;
    this.waveKills = 0;
    this.waveRunner = null;
    this.rewardFlow = null;
    this.waveClearHandled = true;
    this.runState.beginWave();
    // 直接走完倒计时进入 combat；不创建 WaveRunner，避免波次清空/奖励流程介入。
    this.runState.stepCountdown(WAVE_COUNTDOWN_SECONDS);
    this.countdownText?.setVisible(false);
    this.spawnPerfEnemies();
    this.maintainPerfScenario();
    this.updateWaveHud();
    this.showSkillLabel('性能场景 · 80 敌人 / 40 弹体 / 3 流形');
  }

  /** 按三类非射手敌人均匀铺满性能场景；位置确定可复现。 */
  private spawnPerfEnemies(): void {
    for (let index = 0; index < DEV_PERF_ENEMY_COUNT; index += 1) {
      const unit = this.enemySystem.addEnemy(
        getEnemy(PERF_ENEMY_IDS[index % PERF_ENEMY_IDS.length] ?? 'blob'),
        ...this.perfEnemySpawnPoint(index),
      );
      this.createEnemyView(unit);
    }
  }

  /** 环形黄金角布点；被墙/掩体挡住时逐步外扩，仍失败则退回通用出生点。 */
  private perfEnemySpawnPoint(index: number): [number, number] {
    const center = this.layout.spawn;
    const baseAngle = index * 2.399963229728653;
    const baseRing = 150 + (index % 8) * 54;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const angle = baseAngle + attempt * 0.41;
      const distance = baseRing + attempt * 10;
      const x = center.x + Math.cos(angle) * distance;
      const y = center.y + Math.sin(angle) * distance * 0.62;
      if (!isCircleBlocked(this.layout, x, y, ENEMY_RADIUS)) return [x, y];
    }
    const point = resolveEnemySpawnPoint(this.layout, this.motion.position, index);
    return [point.x, point.y];
  }

  /**
   * 性能场景每个逻辑步的负载维护：
   * 玩家与敌人补满生命、补足 80 敌人、补足 40 敌弹，并让缪尔赛思保持
   * 远程主流形 + 2 个副本（共 3 个流形）。
   */
  private maintainPerfScenario(): void {
    this.playerHealth.restoreHealth(
      this.playerHealth.maxHealth,
      this.playerHealth.maxHealth,
    );
    let alive = 0;
    for (const unit of this.enemySystem.enemies) {
      if (!unit.combatant.isAlive) continue;
      alive += 1;
      unit.combatant.health.restoreHealth(
        unit.combatant.health.maxHealth,
        unit.combatant.health.maxHealth,
      );
    }
    // 理论上补满生命后不会减员；保留补足分支以覆盖异常伤害路径。
    for (let index = alive; index < DEV_PERF_ENEMY_COUNT; index += 1) {
      const point = this.perfEnemySpawnPoint(index + this.perfSpawnSerial);
      this.perfSpawnSerial += 1;
      const unit = this.enemySystem.addEnemy(
        getEnemy(PERF_ENEMY_IDS[index % PERF_ENEMY_IDS.length] ?? 'blob'),
        point[0],
        point[1],
      );
      this.createEnemyView(unit);
    }

    const projectileCount = this.enemySystem.projectiles.length;
    if (projectileCount > DEV_PERF_ENEMY_PROJECTILE_COUNT) {
      // 射手 AI 仍会开火；超出规格的弹体直接裁掉，保证固定 40 枚。
      this.enemySystem.trimProjectiles(DEV_PERF_ENEMY_PROJECTILE_COUNT);
    } else if (projectileCount < DEV_PERF_ENEMY_PROJECTILE_COUNT) {
      this.topUpPerfProjectiles(
        DEV_PERF_ENEMY_PROJECTILE_COUNT - projectileCount,
      );
    }

    this.maintainPerfManifolds();
  }

  /** 补足缺口的敌弹；步骤开始与结束各调用一次，保证帧间读数稳定为 40。 */
  private topUpPerfProjectiles(missing: number): void {
    for (let index = 0; index < missing; index += 1) this.spawnPerfProjectile();
  }

  /** 环形切线弹道；每 4 枚有 1 枚朝玩家，覆盖命中结算与长时间存活两条路径。 */
  private spawnPerfProjectile(): void {
    const center = this.motion.position;
    this.perfSpawnSerial += 1;
    this.perfProjectileAngle =
      (this.perfProjectileAngle + 2.399963229728653) % (Math.PI * 2);
    const angle = this.perfProjectileAngle;
    const distance = 260 + (this.perfSpawnSerial % 4) * 40;
    const x = center.x + Math.cos(angle) * distance;
    const y = center.y + Math.sin(angle) * distance * 0.6;
    const aimed = this.perfSpawnSerial % 4 === 0;
    const dx = aimed ? center.x - x : -Math.sin(angle);
    const dy = aimed ? center.y - y : Math.cos(angle) * 0.6;
    const length = Math.hypot(dx, dy) || 1;
    const speed = 160;
    this.enemySystem.addDebugProjectile(
      x,
      y,
      (dx / length) * speed,
      (dy / length) * speed,
      { damage: 2, range: 900 },
    );
  }

  /** 强制远程形态并维持主流形 + 2 个副本；副本沿用当前站位与攻击冷却。 */
  private maintainPerfManifolds(): void {
    const muelsyse = this.muelsyse;
    if (!muelsyse) return;

    const world = muelsyse.snapshotWorld();
    const used = new Set<string>();
    const offsets: ReadonlyArray<readonly [number, number]> = [
      [-38, 16],
      [38, 16],
    ];
    const copies = offsets.map((offset, slot) => {
      const existing =
        world.copies.find((copy) => copy.slot === slot && !used.has(copy.id)) ??
        world.copies.find((copy) => !used.has(copy.id));
      if (existing) {
        used.add(existing.id);
        return {
          ...existing,
          slot,
          remainingSeconds: Math.max(existing.remainingSeconds, 600),
        };
      }
      return {
        id: `perf-copy-${slot + 1}`,
        slot,
        x: world.x + offset[0],
        y: world.y + offset[1],
        remainingSeconds: 600,
        attackCooldownSeconds: 0,
      };
    });

    muelsyse.restoreWorld({
      ...world,
      form: 'ranged',
      health: muelsyse.formMaxHealth,
      copies,
      nextCopyId: Math.max(world.nextCopyId, 3),
    });
  }

  /** 开始一波：先进入 3 秒倒计时，倒计时结束才推进刷怪与战斗。 */
  private startWave(wave: number): void {
    this.waveNumber = wave;
    this.waveKills = 0;
    // 上一波剩余冷却不清入下一波：K/L/U/I 与闪避在波初统一就绪。
    this.resetWaveReadyState();
    // E03 的“每波首次”重新可用；每局次数继续累计。
    this.coreEffects.startWave();
    this.waveRunner = new WaveRunner(this.waveDefinitionFor(wave));
    this.rewardFlow = null;
    // 上一商店的货架与重抽次数不进入下一波；波末会按新波数重新抽取。
    // 锁定商品例外：先把锁定条目交给下一个商店，再清空当前货架。
    this.closeShopPanel();
    this.pendingShopLock = this.shopShelf?.lockedOffer ?? null;
    this.shopShelf = null;
    this.shopSession = null;
    this.freeSkillShop = null;
    this.craftingSession = null;
    this.waveClearHandled = false;
    this.clearWaveChest();
    this.chestSpawned = false;
    this.brokenChestIds = [];
    this.jHeld = false;
    this.motion.clearKeys();
    this.logicLoop?.reset();
    this.upgradeChoice = null;
    this.hideUpgradePanel();
    this.rewardOverlay?.setVisible(false);
    this.staleHintHud?.setVisible(false);
    this.bossHud?.setVisible(false);

    if (this.runState.beginWave() === 'countdown') {
      const remaining = Math.max(
        1,
        Math.ceil(this.runState.countdownRemaining || WAVE_COUNTDOWN_SECONDS),
      );
      this.countdownText
        ?.setText(`第 ${this.waveNumber} 波\n${remaining}`)
        .setVisible(true);
    }
    this.updateWaveHud();
    // 波初检查点：刷新后回到本波开头，而不是刷新前一帧。
    this.saveCheckpoint('wave-start');
  }

  /**
   * 波初就绪重置：清空上一波剩余冷却与进行中的技能效果，
   * 让 K/L 与闪避在下一波开始即可使用。U/I 自由技能槽尚未接入，
   * 接入时在同一入口补重置。
   */
  private resetWaveReadyState(): void {
    this.motion.resetDodgeForWaveStart();
    this.soul?.resetForWaveStart();
    this.burst?.resetForWaveStart();
    this.amiya?.resetForWaveStart();
    this.saria?.resetForWaveStart();
    this.muelsyse?.resetForWaveStart();
    // 自由技能 U/I 的冷却不跨波保留（US-055 的波初重置单一入口）；
    // 上一波尚未执行的 E06 复施同样不带入下一波。
    this.freeSkills.resetForWaveStart();
    this.coreEffects.clearSkillEcho();
    // S01 旋转与 S02 减速只在本波生效，波初清空计时与占位视觉。
    this.spinningBlades.reset();
    this.freeSkillSlows.reset();
    this.spinningBladesSource = null;
    this.destroySpinningBladesVisual();
    // S08 重力井与 S03 上一条连锁记录同样不跨波保留。
    this.gravityWell.reset();
    this.gravityWellSource = null;
    this.lastChainTargetIds = [];
    this.destroyGravityWellVisual();
    // S04 火路与 S05 炮台连同计时、伤害链和占位视觉一并清空。
    this.fireTrail.reset();
    this.fireTrailSource = null;
    this.destroyFireTrailVisuals();
    // H01 每波各一次、H08 银行与 H06 闪避窗口不跨波；H02 上一波火路清空。
    this.combatHexes.resetForWave();
    // H30 尚未结算的谢幕波纹不跨波。
    this.bomberHexes.resetForWave();
    // H35 环绕物与 H36 命中计数/待结算真伤不跨波。
    this.sorcererHexes.resetForWave();
    // H41 的「每第四次 J」按波重新计数。
    this.knightHexes.resetForWave();
    this.sorcererOrbSource = null;
    this.destroySorcererOrbVisuals();
    this.lastHexPosition = null;
    this.emberTrailSource = null;
    this.destroyEmberTrailVisuals();
    this.turretField.reset();
    this.turretSources.clear();
    this.destroyTurretVisuals();
    // S09 替身同样不跨波保留：寿命、复制计数与占位视觉一并清空。
    this.waterMirror.reset();
    this.waterMirrorEchoHits = 0;
    this.lastWaterMirrorEchoDamage = 0;
    this.destroyWaterMirrorVisuals();
    // S07 护盾与 S10 战旗不跨波：先移除仍记在名下的护盾/护甲来源，再清计时与视觉。
    if (this.shieldBurst.shieldAmount > 0) {
      this.playerHealth.setShield(
        Math.max(0, this.playerHealth.shield - this.shieldBurst.shieldAmount),
      );
    }
    this.shieldBurst.reset();
    this.destroyShieldBurstVisual();
    this.warBanner.reset();
    this.warBannerSource = null;
    this.warBannerArmorApplied = 0;
    this.warBannerContactDamageMultiplier = 1;
    this.stats.setSource('freeSkill:S10', []);
    this.destroyWarBannerVisual();
    this.lastHealingPulsePlayerHeal = 0;
    this.lastHealingPulseSummons = [];
    // S11 的弹丸在飞完射程后自然消失，只清取证计数；
    // S12 的标记与「每波最多 2 次」赏金计数都不跨波保留。
    this.lastShotgunPelletCount = 0;
    this.lastShotgunPelletDamage = 0;
    this.shotgunRepeatedHits = 0;
    this.bountyMark.resetForWave();
    this.destroyBountyMarkVisual();
    // 道具的周期计时、静止判定、I18 蓄势与 I23 护盾不跨波保留；
    // I21 的 J 命中计数跨波累计，层数与聚合属性不变。
    if (this.itemEffects.lowHealthShieldRemainingSeconds > 0) {
      this.playerHealth.setShield(
        Math.max(0, this.playerHealth.shield - this.itemEffects.lowHealthShieldAmount),
      );
    }
    this.itemEffects.resetForWave();
    // 消耗品：上一波残留护盾先移除，排队层数转为本波生效并授予 P05 初始护盾。
    const potionWave = this.consumables.beginWave();
    if (potionWave.shieldToRemove > 0) {
      this.playerHealth.setShield(
        Math.max(0, this.playerHealth.shield - potionWave.shieldToRemove),
      );
    }
    if (potionWave.shieldToGrant > 0) {
      this.playerHealth.setShield(
        this.playerHealth.shield + potionWave.shieldToGrant,
      );
    }
    // 药剂属性（伤害/移速/攻速/护甲/冷却缩减）走统一聚合入口。
    this.syncBuildModifiers();
    this.syncHealthHud();
    this.updateBuildHud();
    this.lastItemPosition = null;
    // H05 站定护甲随波初计时清零立即移除；H22 的永久加成保留。
    this.syncCombatHexStats();
    this.syncBurstHud();
    this.syncChimeraHud();
    this.syncSkillHud();
  }

  /** 推进倒计时；结束的那一步隐藏提示并进入战斗。 */
  private stepCountdown(stepSeconds: number): void {
    const phase = this.runState.stepCountdown(stepSeconds);
    if (phase === 'countdown') {
      const remaining = Math.max(1, Math.ceil(this.runState.countdownRemaining));
      this.countdownText.setText(`第 ${this.waveNumber} 波\n${remaining}`);
      return;
    }

    this.countdownText.setVisible(false);
    this.showSkillLabel(`第 ${this.waveNumber} 波开始`);
    this.updateWaveHud();
  }

  /** 每步推进波次刷怪与清空判定；出生提示交给 EnemySystem 统一倒计时。 */
  private stepWave(stepSeconds: number): void {
    const runner = this.waveRunner;
    if (!runner) return;

    const aliveEnemyCount = this.enemySystem.enemies.reduce(
      (total, unit) => (unit.combatant.isAlive ? total + 1 : total),
      0,
    );
    const pendingEnemyCount = this.enemySystem.telegraphs.length;
    // 开发验证参数 waveSpeed 只缩放波内逻辑时钟（刷怪节奏与波内时限推进），
    // 不改变每波时长、奖励或过关条件；生产构建恒为 1。
    const waveStepSeconds = stepSeconds * (this.devScenario?.waveSpeed ?? 1);
    const result = runner.step(waveStepSeconds, { aliveEnemyCount, pendingEnemyCount });

    // 宝箱在波开始 8 秒出现；出生点由当时仍待落地的敌人提示参与避让。
    if (shouldSpawnChest(this.waveNumber, runner.elapsedSeconds, this.chestSpawned)) {
      this.chestSpawned = true;
      const point = findChestSpawnPosition({
        layout: this.layout,
        player: this.motion.position,
        enemySpawnPoints: this.enemySystem.telegraphs.map((telegraph) => ({
          x: telegraph.x,
          y: telegraph.y,
        })),
        angleOffset: this.waveNumber,
      });
      this.spawnChest(
        new Chest({
          id: `chest-w${this.waveNumber}`,
          wave: this.waveNumber,
          x: point.x,
          y: point.y,
          events: this.combatEventSink,
        }),
      );
    }

    for (const request of result.spawned) {
      const telegraph = this.enemySystem.queueSpawn(
        request.enemy,
        this.motion.position,
        request.spawnIndex,
      );
      this.createSpawnTelegraph(telegraph);
    }

    if (result.timedOut) {
      this.handleWaveTimeout();
    } else if (result.cleared) {
      this.beginWaveClear();
    }
  }

  /**
   * 倒计时归零过关：本逻辑帧的伤害/死亡/击杀已在 `updateCombat` 之前结算，
   * 这里只移除残余敌人与战场临时物；存活敌人不产生击杀计数或任何奖励。
   * 经验球保留，随后与提前清场一样自动吸取并进入波末奖励。
   */
  private handleWaveTimeout(): void {
    if (this.waveClearHandled) return;

    const cleared = this.enemySystem.clearForVictory();
    for (const enemyId of cleared.enemyIds) this.removeEnemyView(enemyId);
    for (const projectileId of cleared.projectileIds) {
      this.removeEnemyProjectile(projectileId);
    }
    for (const telegraphId of cleared.telegraphIds) {
      this.removeSpawnTelegraph(telegraphId);
    }
    for (const blastId of [...this.bossBlastViews.keys()]) {
      this.removeBossBlastView(blastId);
    }
    for (const blastId of [...this.eliteBlastViews.keys()]) {
      this.removeEliteBlastView(blastId);
    }
    // 玩家弹体与待结算余震同样属于本轮战场临时物，不带入波末或下一波。
    for (const projectile of this.projectiles) projectile.sprite.destroy();
    this.projectiles.length = 0;
    for (const projectile of this.pendingDerivedBullets) projectile.sprite.destroy();
    this.pendingDerivedBullets = [];
    this.grenade?.clearTemporaryEffects();

    this.showSkillLabel('倒计时结束 · 清场');
    this.beginWaveClear();
  }

  /**
   * 波清空：完成金币与波间恢复先结算，再建立奖励队列：
   * 简报 → 宝箱 → 精英核心 → 升级/海克斯 → 机制 → 商店（波间）。
   */
  private beginWaveClear(): void {
    if (this.waveClearHandled) return;
    this.waveClearHandled = true;
    // 波次结束重置每波触发计数；冷却与每局计数保留到下一波/下一局。
    this.triggerGates.endWave();
    // E05 在波末把本波击杀金币换成下一波起生效的伤害加成。
    this.coreEffects.endWave();
    // 消耗品的临时增益与代价在同一波结束一起清除（P03–P08）。
    this.consumables.endWave();
    this.syncBuildModifiers();
    this.updateBuildHud();
    this.grenade?.setDamageMultiplier(this.jDamageMultiplier());
    this.waveRunner = null;
    // 未打破的宝箱随波结束消失，不记资格；已打破的 ID 留在 brokenChestIds。
    this.clearWaveChest();
    // 清场后不再保留未落地的精英预警，避免奖励阶段或下一波被旧爆破命中。
    this.enemySystem.clearEliteBlasts();
    for (const blastId of [...this.eliteBlastViews.keys()]) {
      this.removeEliteBlastView(blastId);
    }
    this.jHeld = false;
    this.motion.clearKeys();
    this.logicLoop?.reset();

    // 完成金币：第 1–17 波固定 18+3×波数，超时过关同样发放；第 18 波为 0。
    // I22 赌徒筹码按层数降低完成奖励（每层 −15%）；H12 拾荒者额外 +15 金币。
    const completionGold = this.economy.awardWaveCompletion(
      this.waveNumber,
      this.stats.completionGoldMultiplier,
      this.hexEffects.completionGoldBonus,
    );
    if (completionGold > 0) {
      this.showSkillLabel(`波次完成奖励 +${completionGold} 金币`, '#ffd98a');
      this.showHudToast('gold', formatGoldToast(completionGold));
    }
    this.dispatchHud({ type: 'gold', gold: this.economy.gold });

    if (!this.playerHealth.isDead) {
      // 波间恢复先于宝箱/核心/升级结算（01 §精英核心的统一顺序）。
      // R06 命运交易所：每波结束后的生命恢复减半。
      const healRatio =
        INTERMISSION_HEAL_RATIO * this.craftedEffects.intermissionHealMultiplier;
      const healed = applyIntermissionRecovery(this.playerHealth, healRatio);
      if (healed > 0) {
        this.showSkillLabel(`波间补给 · 生命 +${Math.ceil(healed)}`);
      }
      this.syncHealthHud();

      // 波末自动吸取剩余经验球，产生的升级进入同一奖励队列。
      this.progression.collectAll().orbs.forEach((orb) => this.removeXpOrb(orb.id));
      this.syncLevelHealth();
    }

    this.rewardFlow = new WaveRewardFlow(this.waveNumber);
    this.rewardFlow.begin(this.progression.pendingLevelUps);
    const eligibility = this.waveRewardEligibility();
    // 宝箱候选在资格入队时一次性抽取并随队列落盘，刷新不会重抽换奖励。
    const chestOffers = new Map<string, ChestOfferDraw>();
    for (const chestId of eligibility.chestIds) {
      chestOffers.set(
        chestId,
        drawChestOffers(
          () => this.randomStreams.reward.next(),
          this.waveNumber,
          {
            characterId: this.character.id,
            stacksOf: (itemId) => this.itemInventory.stacksOf(itemId),
          },
        ),
      );
    }
    // 核心候选同样在资格生成时固定：通用生存/经济 + 兼容标签，排除已拥有。
    const coreOffers = new Map<string, readonly string[]>();
    for (const rewardId of eligibility.coreIds) {
      const draw: CoreOfferDraw = drawCoreOffers(
        () => this.randomStreams.reward.next(),
        {
          characterId: this.character.id,
          ownedCoreIds: this.coreInventory.snapshot(),
          ownedItemTags: this.ownedItemTags(),
        },
      );
      coreOffers.set(rewardId, draw.coreIds);
    }
    this.rewardFlow.completeAbsorb(this.progression.pendingLevelUps, {
      ...eligibility,
      chestOffers,
      coreOffers,
    });
    this.syncRewardPhase();
    this.updateWaveHud();
    this.refreshRewardOverlay();
    // 简报阶段即落盘：刷新后继续当前奖励队列，不重发完成金币或补给。
    this.saveCheckpoint('wave-end');
  }

  /**
   * 本波已获得的额外资格：宝箱只认已打破的对象，精英核心只认本波指定精英的
   * 绑定 ID，避免同一资格在后续波次重复入队。
   */
  private waveRewardEligibility(): {
    chestIds: readonly string[];
    coreIds: readonly string[];
  } {
    const chestIds = [...this.brokenChestIds];
    // 只有本波指定精英已被击败才记资格；超时清场不会调用击败登记。
    const coreIds = eligibleCoreIdsForWave(this.waveNumber, this.eliteCore);
    return { chestIds, coreIds };
  }

  /** 已拥有道具的目录标签，用于核心候选的“已拥有标签”匹配。 */
  private ownedItemTags(): string[] {
    const tags: string[] = [];
    for (const entry of this.itemInventory.snapshot()) {
      const item = getShopItem(entry.id);
      if (item) tags.push(item.tag);
    }
    return tags;
  }

  /** 把奖励流转的阶段同步到局状态机；所有波末面板都冻结战斗。 */
  private syncRewardPhase(): void {
    const stage = this.rewardFlow?.stage ?? 'none';
    if (
      stage === 'briefing' ||
      stage === 'chest' ||
      stage === 'core' ||
      stage === 'upgrade' ||
      stage === 'mechanic'
    ) {
      this.runState.beginUpgrade();
    } else if (stage === 'intermission') {
      this.enterIntermission();
    } else if (this.rewardFlow === null && this.progression.pendingLevelUps === 0) {
      // 波中升级全部选完：没有波末奖励流转时立即回到战斗。
      this.runState.returnToCombat();
      // 奖励面板关闭后按系统当前值整体重写 HUD，避免面板期间的旧值残留。
      this.resyncHudFromSystems();
    }
  }

  /**
   * 进入商店/波间阶段；补给回血已在波末统一结算，这里只切阶段并落盘。
   */
  private enterIntermission(): void {
    if (this.runState.phase === 'intermission') return;
    if (this.runState.beginIntermission() !== 'intermission') return;

    // 商店在宝箱/核心/升级结算之后才固定货架：此时层数与 I22 已包含本波奖励。
    // 只消费本局 reward 流；第 1–17 波结束后进入商店，第 18 波直接结算。
    if (
      !this.shopShelf &&
      this.waveNumber >= 1 &&
      this.waveNumber <= SHOP_LAST_WAVE
    ) {
      const drawState = this.createShopDrawState();
      // 缺件保底：每个商店只推进一次（重抽不计数），到第 3 个符合条件的商店
      // 给出一件缺失材料；该件从主货架候选中排除，不重复也不挤占五格。
      const supplyDecision = this.recipeTracker.beginShop(
        this.recipeTrackingContext(),
        this.waveNumber,
      );
      const materialSupply = (() => {
        if (!supplyDecision) return null;
        const supply = buildShopMaterialSupply(drawState, supplyDecision);
        // 该材料已作为上商店锁定条目保留时，不再重复提供一件相同缺件：
        // 锁定格本身已给购买机会，保底视为已满足（计数已在 beginShop 重置）。
        if (supply && this.pendingShopLock?.id === supply.id) return null;
        return supply;
      })();
      this.shopShelf = new ShopShelf(
        () => this.randomStreams.reward.next(),
        drawState,
        this.pendingShopLock,
        materialSupply,
      );
      this.pendingShopLock = null;
      // 卡面预览读取当前聚合属性；之后每次打开/刷新时还会重算。
      this.shopShelf.refreshItemPreviews();
      // 交易会话与货架同生共死；购买/重抽/出售都从这里原子提交。
      this.createShopSessions();
      // 开发验收参数：在真实会话上按序买入/出售，随后照样进入正常波间流程。
      this.runDevShopOps();
    }

    // P05 的剩余护盾在进入商店时清除；已被伤害消耗的部分不再重复扣。
    const potionShield = this.consumables.clearPotionShield();
    if (potionShield > 0) {
      this.playerHealth.setShield(
        Math.max(0, this.playerHealth.shield - potionShield),
      );
    }

    // 补给回血已在波末统一结算；这里只同步 HUD 并落盘，刷新不会重复回血。
    this.syncHealthHud();
    this.saveCheckpoint('intermission');
    // 货架与会话就绪后打开正式商店面板；DOM 面板接管方向键/Enter/R/F/Tab/空格。
    this.openShopPanel();
  }

  /** 当前商店的抽取上下文；正常开店与续局恢复共用同一口径。 */
  private createShopDrawState(): ShopDrawState {
    return {
      shopWave: this.waveNumber,
      characterId: this.character.id,
      stacksOf: (itemId) => this.itemInventory.stacksOf(itemId),
      itemPreview: (itemId, stacks) => this.previewItem(itemId, stacks),
      // H10 购物价格 −8%；H23 药剂价格 +15% 只作用于药剂，按百分点合并一次。
      priceModifiers: this.hexEffects.shopPriceModifiers,
      potionPriceModifiers: this.hexEffects.potionPriceModifiers,
      // 开发验收：强制轮换药剂/技能，便于按 ID 购买指定商品。
      potionOverride: this.devScenario?.shopPotion ?? null,
      skillOverride: this.devScenario?.shopSkill ?? null,
    };
  }

  /**
   * 为当前货架建立交易/技能/合成会话；购买、重抽、出售与合成都从这里原子提交。
   * 续局恢复时传入已用掉的 R06 免费重抽次数，避免刷新后白拿一次免费重抽。
   */
  private createShopSessions(freeRerollsUsed = 0): void {
    const shelf = this.shopShelf;
    if (!shelf) return;
    this.shopSession = new ShopSession({
      shelf,
      gold: this.economy,
      inventory: this.itemInventory,
      payments: this.shopPayments,
      // R06 命运交易所：本商店首次重抽免费、首次永久道具 −20%。
      crafted: this.craftedEffects,
      freeRerollsUsed,
      // 永久道具入库存，药剂立即结算。
      deliver: (offer) => {
        if (offer.kind === 'item') return this.itemInventory.acquire(offer.id);
        if (offer.kind === 'potion') return this.applyConsumable(offer.id);
        return false;
      },
      supportedKinds: ['item', 'potion'],
      deliverEmergencyPotion: (potionId) => this.applyConsumable(potionId),
      // 只有永久道具可出售：核心、配方成品与未知 ID 不在道具目录里。
      isSellable: (itemId) => getShopItem(itemId) !== undefined,
    });
    // 自由技能使用独立交易：需要选槽、计算升级价与替换回收。
    this.freeSkillShop = new FreeSkillShop({
      shelf,
      gold: this.economy,
      skills: this.freeSkills,
      shopWave: this.waveNumber,
    });
    // 三件合成与商店同生共死：手续费走本局金币，材料层数走 ItemInventory，
    // 成品进入独立唯一库存；材料被消耗后裁剪支付账本，避免幽灵退款。
    this.craftingSession = new CraftingSession({
      gold: this.economy,
      inventory: this.itemInventory,
      crafted: this.craftedInventory,
      payments: this.shopPayments,
    });
  }

  /**
   * 从续局快照重建波间商店：货架身份/价格/售出/锁定、缺件供给与重抽次数原样恢复，
   * 不重新抽货、不再次推进缺件保底计数。旧存档没有商店字段时保持原行为。
   */
  private restoreShopFromCheckpoint(checkpoint: RunCheckpoint): void {
    const shop = checkpoint.shop;
    if (!shop) return;
    if (this.waveNumber < 1 || this.waveNumber > SHOP_LAST_WAVE) return;
    this.shopShelf = new ShopShelf(
      () => this.randomStreams.reward.next(),
      this.createShopDrawState(),
      null,
      null,
      shop,
    );
    // 卡面按恢复后的层数与聚合属性重算，不冻结刷新前的预览。
    this.shopShelf.refreshItemPreviews();
    this.createShopSessions(shop.freeRerollsUsed);
  }

  /** 奖励期间冻结战斗：方向键/1–3 移动焦点，Enter 只确认一次，R 重抽；Esc 不跳过。 */
  private handleRewardKey(event: KeyboardEvent): void {
    const code = event.code;
    if (REWARD_PREVENT_DEFAULT_CODES.includes(code)) {
      event.preventDefault();
    }

    // 开发合成入口（正式入口属 US-046）：波间按 C 确认当前配方。
    // Enter 仍用于进入下一波，长按 C 不重复合成。
    if (
      import.meta.env.DEV &&
      this.devCraftRecipe &&
      this.rewardFlow?.stage === 'intermission' &&
      code === 'KeyC'
    ) {
      event.preventDefault();
      if (!event.repeat) {
        const result = this.craftRecipe(this.devCraftRecipe);
        // 开发入口同样在合成边界落盘，刷新后素材/手续费不会重复消耗。
        if (result.ok) this.saveCheckpoint('shop-craft');
      }
      return;
    }

    // 正式商店面板可见时，方向键/Enter/R/F/Tab/空格全部归 DOM 面板处理；
    // 场景只保留上面的开发合成入口，避免 Enter 同时触发购买与进入下一波。
    if (this.shopPanelOpen) return;

    const choice = this.activeChoice();
    if (choice) {
      if (code === 'ArrowLeft' || code === 'KeyA') {
        choice.moveFocus(-1);
        this.renderUpgradePanel();
        return;
      }
      if (code === 'ArrowRight' || code === 'KeyD') {
        choice.moveFocus(1);
        this.renderUpgradePanel();
        return;
      }
      const digitIndex = CARD_FOCUS_CODES[code];
      if (digitIndex !== undefined) {
        choice.focusTo(digitIndex);
        this.renderUpgradePanel();
        return;
      }
      if (code === 'KeyR') {
        // 海克斯没有重抽，R 只对强化/机制手牌生效。
        if (!event.repeat && choice.kind !== 'hex' && choice.reroll()) {
          this.renderUpgradePanel();
          // 重抽完成后保存新手牌与剩余次数，刷新不会重抽或换回旧牌。
          this.saveCheckpoint('reroll');
        }
        return;
      }
    }

    // 宝箱二选一：左右/数字键切换焦点，Enter 领取，X 放弃。
    const stage = this.rewardFlow?.stage;

    // 开发配方追踪入口（正式构筑界面属 US-046）：波间按 T 在可追踪配方间轮换。
    // 变更立即落盘，刷新后恢复同一追踪。
    if (
      import.meta.env.DEV &&
      stage === 'intermission' &&
      code === 'KeyT' &&
      !event.repeat
    ) {
      event.preventDefault();
      this.cycleRecipeTracking();
      return;
    }

    const chestEntry = stage === 'chest' ? this.rewardFlow?.currentReward : null;
    const chestOffers = chestEntry?.offers ?? [];
    if (chestOffers.length > 0 && !event.repeat) {
      if (code === 'ArrowLeft' || code === 'KeyA') {
        this.chestOfferFocus =
          (this.chestOfferFocus - 1 + chestOffers.length) % chestOffers.length;
        this.renderChestOfferPanel();
        return;
      }
      if (code === 'ArrowRight' || code === 'KeyD') {
        this.chestOfferFocus = (this.chestOfferFocus + 1) % chestOffers.length;
        this.renderChestOfferPanel();
        return;
      }
      const digitIndex = CARD_FOCUS_CODES[code];
      if (digitIndex !== undefined && digitIndex < chestOffers.length) {
        this.chestOfferFocus = digitIndex;
        this.renderChestOfferPanel();
        return;
      }
    }

    // 精英核心三选一：左右/数字键切换焦点，Enter 领取，X 放弃。
    const coreEntry = stage === 'core' ? this.rewardFlow?.currentReward : null;
    const coreOffers = coreEntry?.coreOffers ?? [];
    if (coreOffers.length > 0 && !event.repeat) {
      if (code === 'ArrowLeft' || code === 'KeyA') {
        this.coreOfferFocus =
          (this.coreOfferFocus - 1 + coreOffers.length) % coreOffers.length;
        this.renderCoreOfferPanel();
        return;
      }
      if (code === 'ArrowRight' || code === 'KeyD') {
        this.coreOfferFocus = (this.coreOfferFocus + 1) % coreOffers.length;
        this.renderCoreOfferPanel();
        return;
      }
      const digitIndex = CARD_FOCUS_CODES[code];
      if (digitIndex !== undefined && digitIndex < coreOffers.length) {
        this.coreOfferFocus = digitIndex;
        this.renderCoreOfferPanel();
        return;
      }
    }

    // 宝箱/核心面板可用 X 明确放弃；升级三选一不支持放弃。
    // 宝箱完全无有效道具时自动转金币，不提供放弃分支。
    const canAbandon =
      stage === 'core' || (stage === 'chest' && chestOffers.length > 0);
    if (!event.repeat && code === 'KeyX' && canAbandon) {
      this.resolveQueuedReward('abandoned');
      return;
    }

    // Enter 按住产生的 repeat 事件不再确认，避免一次按键选两张。
    if (ENTER_CODES.includes(code) && !event.repeat) {
      this.confirmRewardStep();
    }
  }

  /** 确认当前焦点卡；升级按队列逐个消费，机制选择完成后进入波间。 */
  private confirmRewardStep(): void {
    if (this.playerHealth.isDead) return;

    const choice = this.activeChoice();
    if (choice) {
      const card = choice.confirm();
      if (!card) return;

      if (choice.kind === 'hex') {
        // 唯一层数已由 HexChoice 写入 HexRun；本轮只记录获得并推进队列。
        // 属性类海克斯立即进入统一聚合，生命上限/攻速/移速等当帧可见。
        this.syncBuildModifiers();
        this.syncHealthHud();
        this.updateBuildHud();
        this.progression.consumeLevelUp();
        if (this.rewardFlow?.stage === 'upgrade') this.rewardFlow.completeUpgrade();
        this.showSkillLabel(`海克斯 · ${card.name}`);
        this.showUpgradePulse();
        this.playSfx(COMBAT_SFX.upgrade);
        this.hexChoice = null;
        this.advanceRewardUi('hex-selected');
        return;
      }

      // 层数已由 UpgradeChoice 写入 UpgradeRun；这里立即结算即时效果与倍率。
      this.applyAcquiredUpgrade(card as UpgradeDefinition);

      if (choice.kind === 'upgrade') {
        this.progression.consumeLevelUp();
        if (this.rewardFlow?.stage === 'upgrade') this.rewardFlow.completeUpgrade();
        this.showSkillLabel(`升级 · ${card.name}`);
      } else {
        this.rewardFlow?.completeMechanic();
        this.showSkillLabel(`机制 · ${card.name}`);
      }

      this.upgradeChoice = null;
      this.advanceRewardUi();
      return;
    }

    const stage = this.rewardFlow?.stage;

    // 波末简报确认后才开始逐项领取，保证先看到金币与击杀。
    if (stage === 'briefing') {
      this.rewardFlow?.completeBriefing();
      this.advanceRewardUi();
      return;
    }
    if (stage === 'chest') {
      this.claimChestOffer();
      return;
    }
    if (stage === 'core') {
      this.claimCoreOffer();
      return;
    }

    // 池中已无可用卡时不允许卡死：升级直接消费，机制阶段直接结束。
    if (stage === 'upgrade' || (stage === undefined && this.progression.pendingLevelUps > 0)) {
      if (this.progression.pendingLevelUps > 0) this.progression.consumeLevelUp();
      this.rewardFlow?.completeUpgrade();
      this.advanceRewardUi();
      return;
    }
    if (stage === 'mechanic') {
      this.rewardFlow?.completeMechanic();
      this.advanceRewardUi();
      return;
    }
    if (stage === 'intermission') {
      this.advanceToNextWave();
    }
  }

  /** 确认/放弃当前宝箱或核心资格；面板立即推进到下一项。 */
  private resolveQueuedReward(status: 'claimed' | 'abandoned'): void {
    const flow = this.rewardFlow;
    if (!flow) return;
    const stage = flow.stage;
    if (stage !== 'chest' && stage !== 'core') return;
    const kind: RunCheckpointKind =
      stage === 'chest' ? 'chest-claimed' : 'core-claimed';
    flow.resolveCurrent(status);
    this.showSkillLabel(status === 'claimed' ? '奖励已领取' : '已放弃本次奖励');
    this.advanceRewardUi(kind);
  }

  /**
   * 领取当前宝箱资格：有候选时按焦点免费获得 1 层道具；
   * 完全没有有效道具时按设计转为 50 金币并说明“道具已满”。
   */
  private claimChestOffer(): void {
    const flow = this.rewardFlow;
    const entry = flow?.currentReward;
    if (!flow || !entry) return;
    const claim = resolveChestClaim(entry, this.chestOfferFocus);
    if (!claim) return;

    if (claim.itemId) {
      const display = describeChestOffers(
        [claim.itemId],
        (itemId) => this.itemInventory.stacksOf(itemId),
        (itemId, stacks) => this.previewItem(itemId, stacks),
      )[0];
      if (!this.itemInventory.acquire(claim.itemId)) {
        // 候选生成时已排除满层；这里只防御同波内其他来源抢先叠满。
        this.showSkillLabel('道具已满层');
        return;
      }
      // 层数变化立即进入属性聚合、构筑面板与卡面预览。
      this.refreshItemBuild();
      this.showSkillLabel(
        `宝箱战利品 · ${display?.name ?? claim.itemId} ${display?.nextStacks ?? 1}/${display?.stackCap ?? 1} 层`,
        '#ffe08a',
      );
    } else {
      this.economy.addGold(claim.gold);
      this.dispatchHud({ type: 'gold', gold: this.economy.gold });
      this.showSkillLabel(`道具已满 · 金币 +${claim.gold}`, '#ffd98a');
    }

    flow.resolveCurrent('claimed');
    this.chestOfferFocus = 0;
    this.chestOfferEntryId = null;
    this.advanceRewardUi('chest-claimed');
  }

  /**
   * 领取当前精英核心资格：按焦点获得 1 件未拥有核心并立即落盘。
   * 候选在资格生成时已排除已拥有核心；登记失败只防御损坏快照，不重复发放。
   */
  private claimCoreOffer(): void {
    const flow = this.rewardFlow;
    const entry = flow?.currentReward;
    if (!flow || !entry || entry.kind !== 'core') return;

    const coreId = resolveCoreClaim(entry, this.coreOfferFocus);
    if (coreId === null) {
      // 旧快照/池耗尽：不补金币、不重复获得，但必须推进队列避免卡死。
      flow.resolveCurrent('claimed');
      this.showSkillLabel('本波没有可领取的核心');
      this.coreOfferFocus = 0;
      this.coreOfferEntryId = null;
      this.advanceRewardUi('core-claimed');
      return;
    }

    const core = getEliteCore(coreId);
    if (!this.coreInventory.acquire(coreId)) {
      // 候选已排除已拥有核心；这里只防御损坏存档，不放宽“核心唯一”。
      this.showSkillLabel('该核心已拥有');
      flow.resolveCurrent('claimed');
      this.coreOfferFocus = 0;
      this.coreOfferEntryId = null;
      this.advanceRewardUi('core-claimed');
      return;
    }

    this.showSkillLabel(`精英核心 · ${core?.name ?? coreId}`, '#ffe08a');
    // 获得即刻生效：E04 的召唤物加成/幻影无需等到下一波。
    this.syncCoreEffects();
    flow.resolveCurrent('claimed');
    this.coreOfferFocus = 0;
    this.coreOfferEntryId = null;
    this.advanceRewardUi('core-claimed');
  }

  /** 奖励推进后统一同步阶段、刷新面板并落盘。 */
  private advanceRewardUi(kind?: RunCheckpointKind): void {
    this.syncRewardPhase();
    this.refreshRewardOverlay();
    this.saveRewardCheckpoint(kind);
  }

  /**
   * 波中选卡仍按世界检查点保存；波末奖励用稳定的 `reward-claimed`。
   * 宝箱/核心/海克斯等提交边界传入各自的检查点类型，便于刷新后确认
   * 恢复的是该边界之后的确定状态。
   */
  private saveRewardCheckpoint(kind?: RunCheckpointKind): void {
    if (kind) {
      this.saveCheckpoint(kind);
      return;
    }
    if (this.waveRunner) this.saveCheckpoint('card-selected');
    else this.saveCheckpoint('reward-claimed');
  }

  private advanceToNextWave(): void {
    const flow = this.rewardFlow;
    if (!flow || flow.stage !== 'intermission') return;
    this.closeShopPanel();
    flow.completeIntermission();
    this.rewardFlow = null;

    // 第 1–17 波进入下一波（商店由后续故事接入）；第 18 波直接结算。
    if (waveEndChannel(this.waveNumber) === 'result') return;
    this.startWave(this.waveNumber + 1);
    // 离开商店/波间面板后立即用新波次与购买后的实际数值刷新 HUD。
    this.resyncHudFromSystems();
  }

  /** 战斗冻结条件：有排队升级或波末奖励阶段尚未处理完。 */
  private isRewardActive(): boolean {
    return (
      this.progression.pendingLevelUps > 0 ||
      this.runState.isRewardPhase ||
      (this.rewardFlow?.isActive ?? false)
    );
  }

  /** 当前打开的三选一面板；海克斯与强化/机制互斥。 */
  private activeChoice(): UpgradeChoice | HexChoice | null {
    return this.hexChoice ?? this.upgradeChoice;
  }

  /** 按当前阶段创建对应手牌；阶段切换或阶段结束时丢弃旧面板。 */
  private syncRewardChoice(): void {
    const flowActive = this.rewardFlow?.isActive ?? false;
    const flowStage = this.rewardFlow?.stage ?? 'none';
    // 波末队列里的升级必须等宝箱/核心处理完才出现；波中升级仍即时弹出。
    const hexStage =
      flowStage === 'upgrade' ||
      (!flowActive && this.progression.pendingLevelUps > 0);
    const mechanicStage = flowStage === 'mechanic';

    if (!hexStage && !mechanicStage) {
      this.hexChoice = null;
      this.upgradeChoice = null;
      return;
    }

    if (hexStage) {
      // 2/4/6/8/10/12/14 级的三选一改为海克斯；手牌生成即落盘，刷新不重抽。
      if (!this.hexChoice) {
        const choice = this.hexRun.createChoice();
        this.hexChoice = choice.hand.length > 0 ? choice : null;
        this.upgradeChoice = null;
        this.saveCheckpoint('upgrade-options');
      }
      return;
    }

    this.hexChoice = null;
    if (!this.upgradeChoice || this.upgradeChoice.kind !== 'mechanic') {
      const choice = this.upgradeRun.createChoice('mechanic');
      this.upgradeChoice = choice.hand.length > 0 ? choice : null;
      // 生成强化选项即保存：刷新后仍看到同一手牌，不重抽也不重复升级。
      this.saveCheckpoint('upgrade-options');
    }
  }

  /** 重置奖励文本面板锚点；开发合成模式会临时改为左上角锚定。 */
  private resetRewardOverlayAnchor(): void {
    this.rewardOverlay
      .setFontSize(20)
      .setOrigin(0.5)
      .setPosition(VIEWPORT.width / 2, VIEWPORT.height / 2 - 30);
  }

  /**
   * 波间面板：默认居中；开发合成模式内容更长（材料 + 逐条净变化 + 机制），
   * 改为左上角锚定，保证最后一行仍落在 540 逻辑高度内。
   */
  private showIntermissionOverlay(): void {
    // 正式商店面板（US-046）负责全部信息与交互；Phaser 端不再叠一份文字。
    this.openShopPanel();
    if (this.shopPanelOpen) {
      this.rewardOverlay.setVisible(false);
      return;
    }
    const devCraft = Boolean(import.meta.env.DEV && this.devCraftRecipe);
    this.rewardOverlay
      .setFontSize(20)
      .setOrigin(devCraft ? 0 : 0.5)
      .setPosition(
        devCraft ? 16 : VIEWPORT.width / 2,
        devCraft ? 10 : VIEWPORT.height / 2 - 30,
      )
      .setText(this.intermissionSummaryText())
      .setVisible(true);
    // 面板行数随配方/强化/商店货架变化，超出 540 逻辑高度时缩字号兜底，
    // 避免最后一行「已拥有 · 合成入口关闭」被画布底边裁掉。
    const available = VIEWPORT.height - 20;
    let size = 20;
    while (this.rewardOverlay.height > available && size > 12) {
      size -= 2;
      this.rewardOverlay.setFontSize(size);
    }
  }

  private refreshRewardOverlay(): void {
    this.resetRewardOverlayAnchor();
    if (this.playerHealth.isDead) {
      this.upgradeChoice = null;
      this.hexChoice = null;
      this.hideUpgradePanel();
      this.rewardOverlay.setVisible(false);
      this.closeShopPanel();
      return;
    }

    this.syncRewardChoice();
    if (this.activeChoice()) {
      // 波中升级同样进入 upgrade 阶段；确认完后由 syncRewardPhase 回到 combat。
      if (this.activeChoice()?.kind !== 'mechanic') this.runState.beginUpgrade();
      this.renderUpgradePanel();
      this.rewardOverlay.setVisible(false);
      return;
    }

    this.hideUpgradePanel();
    const stage = this.rewardFlow?.stage ?? 'none';

    // 波末先看金币与击杀简报，再进入奖励队列。
    if (stage === 'briefing') {
      this.rewardOverlay.setText(this.waveBriefingText()).setVisible(true);
      return;
    }
    if (stage === 'chest') {
      this.renderChestOfferPanel();
      return;
    }
    if (stage === 'core') {
      this.renderCoreOfferPanel();
      return;
    }

    if (stage === 'mechanic') {
      this.rewardOverlay
        .setText(`第 ${this.waveNumber} 波机制强化\n已无可用卡，按 Enter 继续`)
        .setVisible(true);
      return;
    }

    if (stage === 'upgrade') {
      this.rewardOverlay
        .setText(EMPTY_HEX_POOL_PROMPT)
        .setVisible(true);
      return;
    }

    if (stage === 'intermission') {
      this.showIntermissionOverlay();
      return;
    }

    if (this.progression.pendingLevelUps > 0) {
      this.rewardOverlay
        .setText(EMPTY_HEX_POOL_PROMPT)
        .setVisible(true);
      return;
    }

    this.rewardOverlay.setVisible(false);
  }

  /** 波末简报文本：本波击杀、完成金币与剩余待领取数量。 */
  private waveBriefingText(): string {
    return formatWaveBriefing({
      wave: this.waveNumber,
      waveKills: this.waveKills,
      completionGold: completionGoldForWave(this.waveNumber),
      totalGold: this.economy.gold,
      remainingRewards: this.rewardFlow?.remainingRewards ?? 0,
    });
  }

  /** 波间面板：波次、当前生命、强化概览与 Enter 提示。 */
  private intermissionSummaryText(): string {
    const upgrades = this.upgradeRun.ownedIds().map((id) => {
      const card = UPGRADE_LIST.find((entry) => entry.id === id);
      return {
        id,
        name: card?.name ?? id,
        stacks: this.upgradeRun.stacksOf(id),
      };
    });
    const summary = formatIntermissionSummary({
      wave: this.waveNumber,
      health: this.playerHealth.health,
      maxHealth: this.playerHealth.maxHealth,
      upgrades,
      healRatio:
        INTERMISSION_HEAL_RATIO * this.craftedEffects.intermissionHealMultiplier,
    });
    // 正式商店界面属于 US-046；开发环境先把货架事实写进波间面板，
    // 便于在浏览器直接核对五格构成、价格、重抽费用与 P01 常驻；
    // 卡面预览按当前属性实时重算。开发合成面板本身已经很长，
    // 两者同屏会把合成段挤出 540 逻辑高度，因此合成模式下让位给商店文本。
    let shopText = '';
    const devCraft = Boolean(import.meta.env.DEV && this.devCraftRecipe);
    if (import.meta.env.DEV && this.shopShelf && !devCraft) {
      this.shopShelf.refreshItemPreviews();
      const potionState = this.consumables.snapshot();
      const queued = Object.entries(potionState.pending)
        .map(([id, count]) => `${id}×${count}`)
        .join(' ');
      shopText = `\n\n${formatShopShelfText(
        this.shopShelf,
        this.shopSession?.nextRerollCost,
      )}\n药剂排队：${queued || '无'}`;
      if (this.craftedInventory.has('R06')) {
        const freeReroll = this.shopSession?.freeRerollAvailable
          ? '本商店首次重抽免费'
          : '本商店免费重抽已用完';
        const discount = this.shopSession?.firstItemDiscountAvailable
          ? '首次永久道具 −20%'
          : '首购折扣已使用';
        shopText += `\nR06 命运交易所：${freeReroll} · ${discount} · 波后恢复减半`;
      }
    }
    // 波末面板显示持久金币，便于确认完成奖励已入账。
    const craftText = this.devCraftPanelText();
    const trackingText = `\n\n${this.formatRecipeTrackingText()}`;
    return `金币 ${this.economy.gold}\n${summary}${trackingText}${shopText}${craftText}`;
  }

  /** 配方追踪一行：当前配方、材料进度与缺件保底计数。 */
  private formatRecipeTrackingText(): string {
    const recipeId = this.recipeTracker.trackedRecipeId;
    if (!recipeId) {
      return import.meta.env.DEV
        ? '【配方追踪】未追踪 · 按 T 选择'
        : '【配方追踪】未追踪';
    }
    const status = trackedRecipeStatus(recipeId, this.recipeTrackingContext());
    if (!status) return `【配方追踪】${recipeId} · 已失效`;
    const missing =
      status.missing.length > 0
        ? ` · 缺 ${status.missing.join('/')}`
        : ' · 材料已齐，可合成';
    const guarantee = ` · 缺件保底计数 ${this.recipeTracker.shopsSinceSupply}/${MATERIAL_SUPPLY_INTERVAL_SHOPS}`;
    return `【配方追踪】${status.recipeId} ${status.name} · 已备 ${status.ownedIngredients}/3${missing}${guarantee}`;
  }

  /**
   * 开发入口：波间按 T 在「未追踪 → 可追踪配方 → 未追踪」之间轮换。
   * 正式构筑/商店界面（US-046）落地后由面板复用同一个追踪器与快照字段。
   */
  private cycleRecipeTracking(): void {
    const ctx = this.recipeTrackingContext();
    const candidates = listTrackableRecipes(ctx);
    const current = this.recipeTracker.trackedRecipeId;
    const index = candidates.findIndex((recipe) => recipe.id === current);
    if (index < 0) {
      const first = candidates[0];
      if (first) this.recipeTracker.track(first.id, ctx);
      else this.recipeTracker.clear();
    } else if (index + 1 < candidates.length) {
      const next = candidates[index + 1];
      if (next) this.recipeTracker.track(next.id, ctx);
    } else {
      this.recipeTracker.clear();
    }
    this.showSkillLabel(
      this.recipeTracker.trackedRecipeId
        ? `追踪配方 · ${this.recipeTracker.trackedRecipeId}`
        : '已取消配方追踪',
    );
    this.refreshRewardOverlay();
    this.saveCheckpoint('intermission');
  }

  /**
   * 开发合成面板：确认前的材料、净属性变化与新增机制。
   * 正式合成界面属 US-046；这里用真实键盘 C 走与正式入口相同的 `craftRecipe`。
   */
  private devCraftPanelText(): string {
    if (!import.meta.env.DEV || !this.devCraftRecipe) return '';
    const recipeId = this.devCraftRecipe;
    const inspection = this.previewCraft(recipeId);
    if (!inspection) return `\n\n【三件合成】${recipeId} · 未知配方`;

    const lines: string[] = [
      `【三件合成】${recipeId} ${inspection.recipe.name} · 手续费 ${inspection.fee} · 金币 ${this.economy.gold}`,
    ];
    // 逐件列出材料层数变化与被撤销的正负效果，确认前就能核对“不会叠第二次”。
    for (const material of inspection.materials) {
      lines.push(
        `材料 ${material.id} ${material.name} ×${material.stacksBefore} → ${material.stacksAfter}` +
          `${material.effect ? `（${material.effect}）` : ''}`,
      );
    }
    // 净变化逐条换行：4 条属性拼成一行会横向溢出 960 逻辑视口。
    const netLines = formatCraftNetChanges(
      inspection,
      this.craftStatSnapshot(),
    ).map((line) => `· ${line.text}`);
    if (netLines.length > 0) lines.push('净变化', ...netLines);
    lines.push(`新增机制 ${inspection.mechanics.join('；')}`);
    // R02 的持续伤害只在 S01/S04/S08 上兑现；合成卡面写明当前来源或缺省要求。
    if (recipeId === 'R02') {
      lines.push(`持续通道 ${sustainedChannelNote(this.equippedFreeSkillIds())}`);
    }

    if (this.craftedInventory.has(recipeId)) {
      lines.push('已拥有 · 合成入口关闭');
    } else {
      const check = this.craftingSession?.canCraft(recipeId);
      if (check && !check.ok) {
        if (check.reason === 'missing-materials') {
          lines.push(
            `不可合成：缺 ${check.missing
              .map(
                (material) =>
                  `${material.id}×${material.required - material.available}`,
              )
              .join('、')}`,
          );
        } else if (check.reason === 'insufficient-gold') {
          lines.push(`不可合成：金币差 ${check.shortfall}`);
        } else {
          lines.push(`不可合成：${check.reason}`);
        }
      } else if (check?.ok) {
        lines.push('按 C 合成 · 成品唯一且不可出售');
      }
    }

    const last = this.lastCraftResult;
    if (last && last.recipeId === recipeId) {
      lines.push(
        last.ok
          ? `最近一次合成成功：金币 ${last.goldBefore} → ${last.goldAfter}`
          : `最近一次合成失败：${last.reason}`,
      );
    }
    return `\n\n${lines.join('\n')}`;
  }

  /** 三张横排卡片的固定面板；背景半透明遮罩让冻结的战场仍可辨认。 */
  private createUpgradePanel(): void {
    const container = this.add
      .container(0, 0)
      .setScrollFactor(0)
      .setDepth(103)
      .setVisible(false);

    const dim = this.add
      .rectangle(VIEWPORT.width / 2, VIEWPORT.height / 2, VIEWPORT.width, VIEWPORT.height, 0x05040a, 0.55)
      .setOrigin(0.5);

    const title = this.add
      .text(VIEWPORT.width / 2, 54, '', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#ffe9a8',
        stroke: '#181018',
        strokeThickness: 4,
        align: 'center',
      })
      .setOrigin(0.5);

    const hint = this.add
      .text(VIEWPORT.width / 2, VIEWPORT.height - 38, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#cfc4b6',
        stroke: '#181018',
        strokeThickness: 3,
        align: 'center',
      })
      .setOrigin(0.5);

    container.add([dim, title, hint]);

    const cardWidth = 278;
    const cardHeight = 326;
    const gap = 22;
    const totalWidth = CARDS_PER_HAND * cardWidth + (CARDS_PER_HAND - 1) * gap;
    const startX = (VIEWPORT.width - totalWidth) / 2 + cardWidth / 2;
    const centerY = VIEWPORT.height / 2 + 12;

    this.upgradeCardViews = [];
    for (let index = 0; index < CARDS_PER_HAND; index += 1) {
      const x = startX + index * (cardWidth + gap);
      const background = this.add
        .rectangle(x, centerY, cardWidth, cardHeight, 0x120e18, 0.96)
        .setStrokeStyle(2, 0x5a4f66);
      const accent = this.add.rectangle(
        x,
        centerY - cardHeight / 2 + 7,
        cardWidth,
        9,
        0x5a4f66,
      );
      const text = this.add.text(
        x - cardWidth / 2 + 16,
        centerY - cardHeight / 2 + 96,
        '',
        {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#f4ead2',
          lineSpacing: 4,
          wordWrap: { width: cardWidth - 32, useAdvancedWrap: true },
        },
      );
      const artIcon = this.add.image(x, centerY - cardHeight / 2 + 51, 'item-art-hex-gold').setDisplaySize(62, 62);
      container.add([background, accent, artIcon, text]);
      this.upgradeCardViews.push({ background, accent, artIcon, text });
    }

    this.upgradePanel = container;
    this.upgradePanelTitle = title;
    this.upgradePanelHint = hint;
  }

  private renderUpgradePanel(): void {
    if (this.hexChoice) {
      this.renderHexPanel();
      return;
    }

    const choice = this.upgradeChoice;
    if (!choice) {
      this.hideUpgradePanel();
      return;
    }

    const queueRemaining = this.rewardFlow?.isActive
      ? this.rewardFlow.remainingRewards
      : 0;
    const queueSuffix =
      queueRemaining > 0 ? ` · 待领取 ${queueRemaining} 项` : '';
    const title =
      choice.kind === 'mechanic'
        ? `第 ${this.waveNumber} 波 · 机制强化${queueSuffix}`
        : this.progression.pendingLevelUps > 1
          ? `升级 · 三选一（剩余 ${this.progression.pendingLevelUps} 次选择${queueSuffix}）`
          : `升级 · 三选一${queueSuffix}`;
    this.upgradePanelTitle.setText(title);
    this.upgradePanelHint.setText(
      `← → 或 1–3 移动焦点 · Enter 确认 · R 重抽（剩余 ${choice.rerollsRemaining} 次）\nEsc 不能跳过强化`,
    );

    for (let index = 0; index < this.upgradeCardViews.length; index += 1) {
      const view = this.upgradeCardViews[index];
      if (!view) continue;
      const card = choice.hand[index];
      if (!card) {
        view.background.setVisible(false);
        view.accent.setVisible(false);
        view.text.setVisible(false);
        view.artIcon.setVisible(false);
        continue;
      }

      const focused = choice.focusIndex === index;
      const rarity = RARITY_COLORS[card.rarity] ?? RARITY_COLORS.silver;
      view.background.setVisible(true);
      view.accent.setVisible(true);
      view.text.setVisible(true);
      view.background
        .setFillStyle(focused ? 0x1d1726 : 0x120e18, 0.96)
        .setStrokeStyle(focused ? 4 : 2, focused ? 0xffe08a : (rarity?.line ?? 0x5a4f66));
      view.accent.setFillStyle(rarity?.line ?? 0x5a4f66);
      view.text.setText(this.formatUpgradeCard(index, card, focused));
      view.artIcon.setVisible(true).setTexture(this.textures.exists(`item-art-${card.id}`) ? `item-art-${card.id}` : 'item-art-hex-gold');
      view.text.setColor(rarity?.text ?? '#f4ead2');
    }

    this.upgradePanel.setVisible(true);
  }

  /**
   * 宝箱二选一面板：两张卡同屏展示收益、代价、层数与净变化。
   * 完全没有有效道具时改用文字面板说明“道具已满”与兜底金币。
   */
  private renderChestOfferPanel(): void {
    const flow = this.rewardFlow;
    const entry = flow?.currentReward;
    if (!entry || entry.kind !== 'chest') {
      this.hideUpgradePanel();
      this.rewardOverlay?.setVisible(false);
      return;
    }

    const offers = entry.offers ?? [];
    if (offers.length === 0) {
      this.hideUpgradePanel();
      this.rewardOverlay
        ?.setText(
          [
            `第 ${this.waveNumber} 波 · 宝箱战利品（剩余 ${flow?.remainingRewards ?? 0} 项）`,
            formatChestFallbackPrompt(entry.fallbackGold ?? CHEST_FALLBACK_GOLD),
          ].join('\n'),
        )
        .setVisible(true);
      return;
    }

    if (this.chestOfferEntryId !== entry.id) {
      this.chestOfferEntryId = entry.id;
      this.chestOfferFocus = 0;
    }

    const displays = describeChestOffers(
      offers,
      (itemId) => this.itemInventory.stacksOf(itemId),
      (itemId, stacks) => this.previewItem(itemId, stacks),
    );
    if (displays.length === 0) {
      this.hideUpgradePanel();
      this.rewardOverlay?.setVisible(false);
      return;
    }
    this.chestOfferFocus = Math.min(
      Math.max(0, this.chestOfferFocus),
      displays.length - 1,
    );

    this.upgradePanelTitle.setText(
      `第 ${this.waveNumber} 波 · 宝箱战利品（剩余 ${flow?.remainingRewards ?? 0} 项）`,
    );
    this.upgradePanelHint.setText(
      displays.length > 1
        ? '← → 或 1–2 选择 · Enter 领取 · X 放弃本次资格\n两件道具均已揭示，抽取结果固定'
        : '可选不足两件：本次仅 1 件有效道具\nEnter 领取 · X 放弃本次资格',
    );

    for (let index = 0; index < this.upgradeCardViews.length; index += 1) {
      const view = this.upgradeCardViews[index];
      if (!view) continue;
      const offer = displays[index];
      if (!offer) {
        view.background.setVisible(false);
        view.accent.setVisible(false);
        view.text.setVisible(false);
        view.artIcon.setVisible(false);
        continue;
      }

      const focused = this.chestOfferFocus === index;
      const rarity =
        ITEM_RARITY_COLORS[offer.rarity] ?? ITEM_RARITY_COLORS['普通'];
      view.background.setVisible(true);
      view.accent.setVisible(true);
      view.text.setVisible(true);
      view.background
        .setFillStyle(focused ? 0x1d1726 : 0x120e18, 0.96)
        .setStrokeStyle(
          focused ? 4 : 2,
          focused ? 0xffe08a : (rarity?.line ?? 0x5a4f66),
        );
      view.accent.setFillStyle(rarity?.line ?? 0x5a4f66);
      view.text.setText(formatChestOfferCard(offer, index, focused));
      view.artIcon.setVisible(true).setTexture(this.textures.exists(`item-art-${offer.itemId}`) ? `item-art-${offer.itemId}` : 'item-art-hex-gold');
      view.text.setColor(rarity?.text ?? '#f4ead2');
    }

    this.rewardOverlay?.setVisible(false);
    this.upgradePanel.setVisible(true);
  }

  /**
   * 精英核心三选一面板：三张卡同屏展示名称、标签与完整效果。
   * 候选在资格生成时已固定并排除已拥有核心，刷新不会重抽。
   */
  private renderCoreOfferPanel(): void {
    const flow = this.rewardFlow;
    const entry = flow?.currentReward;
    if (!entry || entry.kind !== 'core') {
      this.hideUpgradePanel();
      this.rewardOverlay?.setVisible(false);
      return;
    }

    const offers = entry.coreOffers ?? [];
    if (offers.length === 0) {
      this.hideUpgradePanel();
      this.rewardOverlay
        ?.setText(
          [
            `第 ${this.waveNumber} 波 · 精英核心（剩余 ${flow?.remainingRewards ?? 0} 项）`,
            formatCoreFallbackPrompt(),
          ].join('\n'),
        )
        .setVisible(true);
      return;
    }

    if (this.coreOfferEntryId !== entry.id) {
      this.coreOfferEntryId = entry.id;
      this.coreOfferFocus = 0;
    }

    const displays = describeCoreOffers(offers);
    if (displays.length === 0) {
      this.hideUpgradePanel();
      this.rewardOverlay?.setVisible(false);
      return;
    }
    this.coreOfferFocus = Math.min(
      Math.max(0, this.coreOfferFocus),
      displays.length - 1,
    );

    this.upgradePanelTitle.setText(
      `第 ${this.waveNumber} 波 · 精英核心（剩余 ${flow?.remainingRewards ?? 0} 项）`,
    );
    this.upgradePanelHint.setText(
      '← → 或 1–3 选择 · Enter 领取 · X 放弃本次资格\n核心唯一：获得后不再进入候选，不可出售',
    );

    for (let index = 0; index < this.upgradeCardViews.length; index += 1) {
      const view = this.upgradeCardViews[index];
      if (!view) continue;
      const offer = displays[index];
      if (!offer) {
        view.background.setVisible(false);
        view.accent.setVisible(false);
        view.text.setVisible(false);
        view.artIcon.setVisible(false);
        continue;
      }

      const focused = this.coreOfferFocus === index;
      view.background.setVisible(true);
      view.accent.setVisible(true);
      view.text.setVisible(true);
      view.background
        .setFillStyle(focused ? 0x1d1726 : 0x120e18, 0.96)
        .setStrokeStyle(focused ? 4 : 2, focused ? 0xffe08a : 0x8f7bd6);
      view.accent.setFillStyle(0x8f7bd6);
      view.text.setText(formatCoreOfferCard(offer, index, focused));
      view.artIcon.setVisible(true).setTexture(this.textures.exists(`item-art-${offer.coreId}`) ? `item-art-${offer.coreId}` : 'item-art-hex-gold');
      view.text.setColor('#efe6ff');
    }

    this.rewardOverlay?.setVisible(false);
    this.upgradePanel.setVisible(true);
  }

  private formatUpgradeCard(
    index: number,
    card: UpgradeDefinition,
    focused: boolean,
  ): string {
    const stacks = this.upgradeRun.stacksOf(card.id);
    const rarity = RARITY_LABELS[card.rarity] ?? card.rarity;
    const marker = focused ? '▶' : ' ';
    return [
      `${marker} [${index + 1}] ${card.name}`,
      `${rarity} · ${card.owner === 'general' ? '通用' : '角色专属'}`,
      '',
      card.description,
      '',
      `层数上限：${card.maxStacks}（已选 ${stacks} 层）`,
      `适用：${card.appliesTo}`,
    ].join('\n');
  }

  /**
   * 海克斯三选一：与强化面板共用三张卡位，但显示归属/品质与唯一层数。
   * 手牌在生成时固定并已落盘；这里只渲染，不抽取。
   */
  private renderHexPanel(): void {
    const choice = this.hexChoice;
    if (!choice) {
      this.hideUpgradePanel();
      return;
    }

    const queueRemaining = this.rewardFlow?.isActive
      ? this.rewardFlow.remainingRewards
      : 0;
    const queueSuffix =
      queueRemaining > 0 ? ` · 待领取 ${queueRemaining} 项` : '';
    const pending = this.progression.pendingLevelUps;
    this.upgradePanelTitle.setText(
      pending > 1
        ? `海克斯 · 三选一（剩余 ${pending} 次选择${queueSuffix}）`
        : `海克斯 · 三选一${queueSuffix}`,
    );
    this.upgradePanelHint.setText(
      '← → 或 1–3 移动焦点 · Enter 确认\n每种海克斯最高 1 层，获得后不再出现',
    );

    for (let index = 0; index < this.upgradeCardViews.length; index += 1) {
      const view = this.upgradeCardViews[index];
      if (!view) continue;
      const card = choice.hand[index];
      if (!card) {
        view.background.setVisible(false);
        view.accent.setVisible(false);
        view.text.setVisible(false);
        view.artIcon.setVisible(false);
        continue;
      }

      const focused = choice.focusIndex === index;
      const rarity = HEX_RARITY_COLORS[card.rarity] ?? HEX_RARITY_COLORS['银'];
      view.background.setVisible(true);
      view.accent.setVisible(true);
      view.text.setVisible(true);
      view.background
        .setFillStyle(focused ? 0x1d1726 : 0x120e18, 0.96)
        .setStrokeStyle(
          focused ? 4 : 2,
          focused ? 0xffe08a : (rarity?.line ?? 0x5a4f66),
        );
      view.accent.setFillStyle(rarity?.line ?? 0x5a4f66);
      view.text.setText(this.formatHexCard(index, card, focused));
      view.artIcon.setVisible(true).setTexture(this.textures.exists(`item-art-${card.id}`) ? `item-art-${card.id}` : 'item-art-hex-gold');
      view.text.setColor(rarity?.text ?? '#f4ead2');
    }

    this.rewardOverlay?.setVisible(false);
    this.upgradePanel.setVisible(true);
  }

  private formatHexCard(
    index: number,
    card: HexDefinition,
    focused: boolean,
  ): string {
    const marker = focused ? '▶' : ' ';
    return [
      `${marker} [${index + 1}] ${card.name}`,
      `${card.rarity} · ${card.owner}`,
      '',
      card.effect,
      '',
      '唯一 · 最高 1 层',
      '已获得后不再进入候选',
    ].join('\n');
  }

  private hideUpgradePanel(): void {
    this.upgradePanel?.setVisible(false);
  }

  /**
   * 本局玩家生命上限：开发验证参数 `maxHealth` 覆盖聚合值，只影响当前局。
   * 升级/强化仍按原规则结算治疗，但不会把上限改回聚合值；不写设置或成绩。
   */
  private effectiveMaxHealth(): number {
    return this.devScenario?.maxHealth ?? this.stats.maxHealth;
  }

  /** 升级带来的最大生命 +5 与回复 5 在获得经验时立即结算。 */
  private syncLevelHealth(): void {
    const level = this.progression.level;
    if (level <= this.appliedLevel || this.playerHealth.isDead) return;
    const gainedLevels = level - this.appliedLevel;
    this.appliedLevel = level;
    this.syncStatSources();
    // 上限由聚合器派生；升级是明示治疗来源，只回复升级奖励本身。
    this.playerHealth.setMaxHealth(this.effectiveMaxHealth());
    this.playerHealth.heal(gainedLevels * LEVEL_HEAL_AMOUNT);
    this.syncHealthHud();
  }

  /** 选卡确认后立即生效：先同步聚合属性，再结算 G04 的明示治疗。 */
  private applyAcquiredUpgrade(card: UpgradeDefinition): void {
    const effect = this.buildEffects.onAcquire(card.id);
    this.syncBuildModifiers();
    // 上限提高不自动回血；G04 卡面明示的回复是独立治疗来源。
    if (effect.heal > 0) this.playerHealth.heal(effect.heal);
    if (effect.maxHealthBonus > 0 || effect.heal > 0) this.syncHealthHud();
    this.updateBuildHud();
    // 强化变化必须可见可听：金色脉冲 + 固定音效，与普通技能启动区分。
    this.showUpgradePulse();
    this.playSfx(COMBAT_SFX.upgrade);
  }

  /**
   * 把等级与 G01–G04 注册进统一聚合入口。
   * 同一来源重复调用只替换，不会把同一加成累计多次。
   */
  private syncStatSources(): void {
    const stacks = (id: string): number => this.upgradeRun?.stacksOf(id) ?? 0;
    const source = (
      entries: readonly Omit<StatModifier, 'mode'>[],
    ): StatModifier[] =>
      entries
        .filter((entry) => Number.isFinite(entry.value) && entry.value !== 0)
        .map((entry) => ({ ...entry, mode: 'percent' }));

    this.stats.setSource(
      'level',
      this.progression
        ? [
            {
              stat: 'maxHealth',
              mode: 'flat',
              value: this.progression.maxHealthBonus,
            },
          ]
        : [],
    );
    // I01–I12 的属性类效果按稳定来源 ID 注册；层数变化时整件替换，
    // 同一次收益与代价不会因重复同步而叠算。I09/I10/I12 的非属性效果
    // 由 `itemEffects` 在逻辑步内推进。
    for (const itemId of ITEM_EFFECT_IDS) {
      this.stats.setSource(
        `item:${itemId}`,
        itemStatModifiers(itemId, this.itemInventory.stacksOf(itemId)),
      );
    }
    // P03/P04/P06/P08 的下一波临时增益；波末由 `endWave` 清空后整源替换。
    this.stats.setSource('potion:active', this.consumables.statModifiers());
    // H03/H04/H09/H15/H19/H20 的属性修正；每种海克斯唯一，整源替换不叠算。
    this.stats.setSource('hex:attribute', this.hexEffects.statModifiers);
    // H29 巨型装药：爆炸半径 +30%、攻速 −10%（发射间隔按 0.9 倍攻速折算）。
    this.stats.setSource('hex:bomber', this.bomberHexes.statModifiers);
    // R01–R06 成品属性；每件唯一，拥有即注册，合成后立即参与聚合。
    for (const recipeId of CRAFTED_ITEM_IDS) {
      this.stats.setSource(
        `craft:${recipeId}`,
        this.craftedInventory.has(recipeId)
          ? craftedStatModifiers(recipeId)
          : [],
      );
    }
    // R01 的击杀成长是独立来源：成品自带的 +80 不随成长变化。
    this.stats.setSource(
      'craft:R01:growth',
      this.craftedInventory.has('R01') && this.craftedEffects.r01Growth > 0
        ? [
            {
              stat: 'maxHealth',
              mode: 'flat',
              value: this.craftedEffects.r01Growth,
            },
          ]
        : [],
    );
    this.stats.setSource('upgrade:G01', source([
      { stat: 'damage', value: G01_DAMAGE_BONUS_PER_STACK * stacks('G01') },
    ]));
    this.stats.setSource('upgrade:G02', source([
      { stat: 'moveSpeed', value: G02_MOVE_SPEED_BONUS_PER_STACK * stacks('G02') },
    ]));
    this.stats.setSource('upgrade:G03', source([
      { stat: 'cooldownReduction', value: G03_COOLDOWN_REDUCTION_PER_STACK * stacks('G03') },
    ]));
    this.stats.setSource(
      'upgrade:G04',
      stacks('G04') > 0
        ? [
            {
              stat: 'maxHealth',
              mode: 'flat',
              value: G04_MAX_HEALTH_BONUS_PER_STACK * stacks('G04'),
            },
          ]
        : [],
    );
    // E05 的累计伤害加成与 E07 的低血伤害共用聚合入口；
    // 两者都只注册一次，E07 的开关由 `syncCoreLowHealth` 实时刷新。
    this.stats.setSource(
      'core:E05',
      this.coreEffects.e05DamageBonus > 0
        ? [{ stat: 'damage', mode: 'percent', value: this.coreEffects.e05DamageBonus }]
        : [],
    );
    this.stats.setSource(
      'core:E07',
      this.coreEffects.e07DamageBonus > 0
        ? [{ stat: 'damage', mode: 'percent', value: this.coreEffects.e07DamageBonus }]
        : [],
    );
  }

  /** I12 的静止增伤只在实际满足条件时加入；移动会立即失效。 */
  private itemConditionalDamageMultiplier(): number {
    return 1 + this.itemEffects.stationaryDamageBonus;
  }

  /** J 普攻伤害：全局伤害 × I07 普攻修正 × I16 直接伤害 × I12 静止增伤。 */
  private jDamageMultiplier(): number {
    return directDamageMultiplierOf(
      {
        damageMultiplier: this.stats.damageMultiplier,
        directDamageMultiplier: this.stats.directDamageMultiplier,
        conditionalDamageMultiplier: this.itemConditionalDamageMultiplier(),
      },
      this.stats.normalAttackDamageMultiplier,
    );
  }

  /** K/L/U/I 技能伤害：全局伤害 × I07 技能修正 × I16 直接伤害 × I12 静止增伤。 */
  private skillDamageMultiplier(): number {
    return directDamageMultiplierOf(
      {
        damageMultiplier: this.stats.damageMultiplier,
        directDamageMultiplier: this.stats.directDamageMultiplier,
        conditionalDamageMultiplier: this.itemConditionalDamageMultiplier(),
      },
      this.stats.skillDamageMultiplier,
    );
  }

  /**
   * 持续伤害通道：S01/S04/S08 的每秒结算。
   * 不乘 I16 的直接伤害 −5%，只乘 I16 与 R02 两个持续加成（各一次、彼此叠乘）。
   */
  private sustainedDamageMultiplier(): number {
    return sustainedDamageMultiplierOf({
      damageMultiplier: this.stats.damageMultiplier,
      skillDamageMultiplier: this.stats.skillDamageMultiplier,
      damageOverTimeMultiplier: this.stats.damageOverTimeMultiplier,
      recipeDamageOverTimeMultiplier:
        this.stats.recipeDamageOverTimeMultiplier,
      conditionalDamageMultiplier: this.itemConditionalDamageMultiplier(),
    });
  }

  /** 当前装备的自由技能 ID；持续伤害卡面与构筑摘要用。 */
  private equippedFreeSkillIds(): string[] {
    const ids: string[] = [];
    for (const slot of FREE_SKILL_SLOT_KEYS) {
      const stack = this.freeSkills.slotAt(slot);
      if (stack) ids.push(stack.id);
    }
    return ids;
  }

  /** 玩家弹体的伤害倍率：J 与技能分开，E08 侧弹、S11 扇射与 H21 弹幕属技能。 */
  private playerProjectileDamageMultiplier(
    source: 'J' | 'K' | 'E08' | 'S11' | 'H21',
  ): number {
    return source === 'J' ? this.jDamageMultiplier() : this.skillDamageMultiplier();
  }

  /** I04/I05 的射程修正；在发射瞬间写入本次攻击，已发弹体不受影响。 */
  private applyItemRange(attack: AttackDefinition): AttackDefinition {
    const multiplier = this.stats.attackRangeMultiplier;
    if (multiplier === 1) return attack;
    return { ...attack, range: attack.range * multiplier };
  }

  /** 按比例缩放本次攻击的直接伤害与余震；比例 1 返回原对象。 */
  private scaleAttackDamage(
    attack: AttackDefinition,
    ratio: number,
  ): AttackDefinition {
    if (!Number.isFinite(ratio) || ratio === 1) return attack;
    return {
      ...attack,
      damage: attack.damage * ratio,
      aftershock: attack.aftershock
        ? { ...attack.aftershock, damage: attack.aftershock.damage * ratio }
        : undefined,
    };
  }

  /**
   * H21 漂浮弹幕：每 12 次原生 J 命中从玩家位置发出 8 向各 22 法伤弹。
   * 弹幕来源是 J 链派生一层的 `H21`，命中不登记 J 命中，也不会再次触发。
   */
  private spawnH21Barrage(parent: CombatEventSource): void {
    if (!this.combatHexes.has('H21')) return;
    const source = this.damageChains.derive(parent, 'H21');
    if (!source) return;
    const params = COMBAT_HEX_PARAMS.H21;
    const count = Math.max(1, Math.floor(params.barrageProjectileCount ?? 8));
    const attack: AttackDefinition = {
      key: 'J',
      name: '漂浮弹幕',
      // 弹体不读取攻击间隔；沿用角色值只为让续局快照保持合法的攻击定义。
      intervalSeconds: this.character.attack.intervalSeconds,
      range: params.barrageRange ?? 220,
      damage: params.barrageDamagePerProjectile ?? 22,
      damageType: 'magic',
    };
    const origin = this.motion.position;
    const facing = this.motion.facingDirection;
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const state = createProjectile(
        this.nextProjectileId,
        origin,
        nearestFacing(direction) ?? facing,
        attack,
        {
          pierce: null,
          radius: this.itemProjectileRadius(PROJECTILE_RADIUS * 0.8),
          direction,
        },
      );
      this.nextProjectileId += 1;
      const sprite = this.add
        .circle(
          origin.x,
          origin.y,
          projectileVisualRadius(state.radius),
          0xffb3e6,
        )
        .setStrokeStyle(1.5, 0xffe6f7)
        .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
      this.pendingDerivedBullets.push({
        state,
        sprite,
        source: 'H21',
        eventSource: source,
      });
    }
    this.showSkillLabel('漂浮弹幕 · 8 向', '#ffb3e6');
  }

  /** I04 的弹体直径修正；返回碰撞半径而不是直径。 */
  private itemProjectileRadius(baseRadius: number): number {
    return baseRadius * this.stats.projectileRadiusMultiplier;
  }

  /**
   * H27 三炮齐鸣：沿准星左右各追加一枚 25% 小弹。
   * 小弹沿用本次 J 的链并派生一层 `H27`，因此不会再次触发派生链；
   * 它们不经过 `BurstSystem.consumeShot`，不会被计为爆裂黎明的下一发。
   */
  private spawnH27SmallShots(
    attack: AttackDefinition,
    parent: CombatEventSource,
    origin: CombatPoint,
    direction: { readonly x: number; readonly y: number },
    colors: CharacterEffectColors,
    radius: number,
  ): void {
    const source = this.damageChains.derive(parent, 'H27');
    if (!source) return;
    const ratio = BOMBER_HEX_PARAMS.H27.tripleShotDamageRatio ?? 0.25;
    const smallAttack = this.scaleAttackDamage(attack, ratio);
    const baseAngle = Math.atan2(direction.y, direction.x);
    for (const offset of planH27SmallShotAngles()) {
      const angle = baseAngle + offset;
      const shotDirection = { x: Math.cos(angle), y: Math.sin(angle) };
      const state = createProjectile(
        this.nextProjectileId,
        origin,
        nearestFacing(shotDirection) ?? this.motion.facingDirection,
        smallAttack,
        { radius, direction: shotDirection },
      );
      this.nextProjectileId += 1;
      const sprite = this.add
        .circle(
          origin.x,
          origin.y,
          projectileVisualRadius(state.radius),
          0xffd166,
        )
        .setStrokeStyle(1.5, colors.projectileStroke)
        .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
      this.projectiles.push({
        state,
        sprite,
        source: 'J',
        eventSource: source,
      });
    }
    this.bomberHexes.recordTripleShotTrigger();
    this.showSkillLabel('三炮齐鸣 · 小弹', '#ffd166');
  }
  /** 卡面预览的当前聚合值；每次调用都读取最新属性与层数。 */
  private itemPreviewInput(): ItemPreviewInput {
    const baseRadius = this.grenade ? GRENADE_PROJECTILE_RADIUS : PROJECTILE_RADIUS;
    return {
      maxHealth: this.stats.maxHealth,
      armor: this.stats.armor,
      moveSpeed: this.stats.moveSpeed,
      moveSpeedMultiplier: this.stats.moveSpeedMultiplier,
      attackSpeedMultiplier: this.stats.attackSpeedMultiplier,
      damageMultiplier: this.stats.damageMultiplier,
      directDamageMultiplier: this.stats.directDamageMultiplier,
      skillDamageMultiplier: this.stats.skillDamageMultiplier,
      normalAttackDamageMultiplier: this.stats.normalAttackDamageMultiplier,
      cooldownReduction: this.stats.cooldownReduction,
      attackRange: this.character.attack.range * this.stats.attackRangeMultiplier,
      attackRangeMultiplier: this.stats.attackRangeMultiplier,
      projectileDiameter:
        2 * baseRadius * this.stats.projectileRadiusMultiplier,
      projectileRadiusMultiplier: this.stats.projectileRadiusMultiplier,
      healPerFiveSeconds: this.itemEffects.regenPerFiveSeconds,
      lifesteal: this.itemEffects.lifesteal,
      lifestealCapPerSecond: this.itemEffects.lifestealCapPerSecond,
      stationaryDamageBonus: this.itemEffects.stationaryDamageBonusAtStacks(
        'I12',
        this.itemInventory.stacksOf('I12'),
      ),
      skillDurationMultiplier: this.stats.skillDurationMultiplier,
      skillCooldownMultiplier: this.stats.skillCooldownMultiplier,
      explosionRadius:
        (this.character.attack.splashRadius ?? 0) *
        this.stats.explosionRadiusMultiplier,
      explosionRadiusMultiplier: this.stats.explosionRadiusMultiplier,
      explosionDamageMultiplier: this.stats.explosionDamageMultiplier,
      damageOverTimeMultiplier: this.stats.damageOverTimeMultiplier,
      sustainedSkillIds: this.equippedFreeSkillIds(),
      xpPickupRadius: this.progression.pickupRadius,
      killGoldMultiplier: this.stats.killGoldMultiplier,
      summonDamageMultiplier: this.stats.summonDamageMultiplier,
      summonHealthMultiplier: this.stats.summonHealthMultiplier,
      completionGoldMultiplier: this.stats.completionGoldMultiplier,
    };
  }

  /** 商店/宝箱共用的道具卡预览回调；非 I01–I12 回退目录文案。 */
  private previewItem(itemId: string, stacks: number): ItemCardPreview | null {
    return previewItemCard(itemId, stacks, this.itemPreviewInput());
  }

  /** 合成净变化展示所需的当前聚合值；与道具卡预览同源。 */
  private craftStatSnapshot(): CraftStatSnapshot {
    return {
      maxHealth: this.stats.maxHealth,
      armor: this.stats.armor,
      moveSpeed: this.stats.moveSpeed,
      moveSpeedMultiplier: this.stats.moveSpeedMultiplier,
      attackSpeedMultiplier: this.stats.attackSpeedMultiplier,
      damageMultiplier: this.stats.damageMultiplier,
      directDamageMultiplier: this.stats.directDamageMultiplier,
      skillDamageMultiplier: this.stats.skillDamageMultiplier,
      normalAttackDamageMultiplier: this.stats.normalAttackDamageMultiplier,
      cooldownReduction: this.stats.cooldownReduction,
      explosionRadiusMultiplier: this.stats.explosionRadiusMultiplier,
      damageOverTimeMultiplier: this.stats.damageOverTimeMultiplier,
      recipeDamageOverTimeMultiplier:
        this.stats.recipeDamageOverTimeMultiplier,
      summonDamageMultiplier: this.stats.summonDamageMultiplier,
      summonHealthMultiplier: this.stats.summonHealthMultiplier,
    };
  }

  /** 道具层数变化后统一刷新聚合属性、构筑面板与商店卡面。 */
  private refreshItemBuild(): void {
    this.syncBuildModifiers();
    this.syncHealthHud();
    this.updateBuildHud();
    this.shopShelf?.refreshItemPreviews();
  }

  /**
   * 通过当前商店会话购买 1 格；成功后才刷新属性、生命上限、构筑面板与卡面。
   * 正式商店界面（US-046）与开发 `shopOps` 共用本入口，避免购买后漏同步。
   * 技能格改用 `FreeSkillShop`：可选目标槽位，自动处理升级/替换与回收。
   */
  purchaseShopSlot(
    slot: number,
    skillSlot?: FreeSkillSlotKey,
  ): ShopPurchaseResult | FreeSkillPurchaseResult {
    if (!this.shopSession) {
      return {
        ok: false,
        reason: 'shop-unavailable',
        shortfall: 0,
        gold: this.economy.gold,
      };
    }
    const offer = this.shopShelf?.offers.find((entry) => entry.slot === slot);
    if (offer?.kind === 'skill') {
      if (!this.freeSkillShop) {
        return {
          ok: false,
          reason: 'shop-unavailable',
          shortfall: 0,
          gold: this.economy.gold,
        };
      }
      const result = this.freeSkillShop.purchase(slot, skillSlot);
      if (!result.ok) return result;
      this.dispatchHud({ type: 'gold', gold: this.economy.gold });
      this.updateBuildHud();
      // 装备持续类技能后，I16/R02 的卡面提示要立即从「需持续类技能」切到来源列表。
      this.shopShelf?.refreshItemPreviews();
      this.refreshFreeSkillBar();
      const actionLabel =
        result.action === 'upgrade'
          ? `${result.skillName} Lv${result.level}`
          : result.action === 'replace'
            ? `${result.replaced?.name ?? '旧技能'} → ${result.skillName}`
            : `装备 ${result.skillName}`;
      const refundText = result.refund > 0 ? ` · 回收 ${result.refund}` : '';
      const subsidyText = result.subsidized ? ' · 新手首购补贴 25' : '';
      this.showSkillLabel(
        `${actionLabel}${refundText} · 实付 ${result.price}${subsidyText}`,
        '#c8b6ff',
      );
      return result;
    }
    const result = this.shopSession.purchase(slot);
    if (!result.ok) return result;
    this.refreshItemBuild();
    this.dispatchHud({ type: 'gold', gold: this.economy.gold });
    return result;
  }

  /**
   * 技能购买报价：展示替换前后名称/等级/冷却与净金币，不扣款、不改槽位。
   * 正式商店界面（US-046）用它渲染禁用态与差额。
   */
  quoteShopSkill(
    offerSlot: number,
    targetSlot?: FreeSkillSlotKey,
  ): FreeSkillQuoteResult {
    if (!this.freeSkillShop) {
      return {
        ok: false,
        reason: 'shop-unavailable',
        shortfall: 0,
        gold: this.economy.gold,
      };
    }
    return this.freeSkillShop.quote(offerSlot, targetSlot);
  }

  /**
   * 购买常驻 P01：不占货架格、可重复购买；成功后只刷新金币与生命 HUD。
   * 正式商店界面（US-046）与开发 `shopOps=buy:P01` 共用本入口。
   */
  purchaseEmergencyPotion(): ShopEmergencyPotionPurchaseResult {
    if (!this.shopSession) {
      return {
        ok: false,
        reason: 'shop-unavailable',
        shortfall: 0,
        gold: this.economy.gold,
      };
    }
    const result = this.shopSession.purchaseEmergencyPotion();
    if (!result.ok) return result;
    this.dispatchHud({ type: 'gold', gold: this.economy.gold });
    return result;
  }

  /**
   * 购买追踪配方的缺件供给：正常价格扣款，成功后重算属性并刷新 HUD。
   * 正式商店按钮属 US-046；开发 `shopOps=buy:supply` 走同一入口。
   */
  purchaseMaterialSupply(): ShopMaterialSupplyPurchaseResult {
    if (!this.shopSession) {
      return {
        ok: false,
        reason: 'shop-unavailable',
        shortfall: 0,
        gold: this.economy.gold,
      };
    }
    const result = this.shopSession.purchaseMaterialSupply();
    if (!result.ok) return result;
    this.refreshItemBuild();
    this.dispatchHud({ type: 'gold', gold: this.economy.gold });
    this.showSkillLabel(
      `配方缺件 · ${result.itemId} · ${result.price} 金币`,
      '#9df2bc',
    );
    return result;
  }

  /**
   * 消耗品发货：P01/P02 立即治疗（受治疗修正，生命上限由 `HealthState` 钳制），
   * P03–P08 排队到下一波并在同一波内受购买上限约束。
   * 返回 false 时交易会话会整笔回滚金币。
   */
  private applyConsumable(potionId: string): boolean {
    const definition = getConsumable(potionId);
    const result = this.consumables.purchase(potionId, {
      maxHealth: this.playerHealth.maxHealth,
    });
    if (!result.ok) {
      if (result.reason === 'limit-reached') {
        this.showSkillLabel(
          `${definition?.name ?? potionId} · 同一波最多 ${result.limit} 次`,
          '#ffb4a2',
        );
      }
      return false;
    }

    if (result.kind === 'immediate') {
      const healed = this.playerHealth.heal(
        applyHealingModifier(result.heal, this.stats.healingMultiplier),
      );
      if (healed > 0) {
        this.showSkillLabel(
          `${definition?.name ?? potionId} · 生命 +${hudValue(healed)}`,
          '#9df2bc',
        );
        this.syncHealthHud();
        this.updateBuildHud();
      }
      return true;
    }

    this.showSkillLabel(
      `${definition?.name ?? potionId} · 下一波生效 ${result.stacks}/${result.limit}`,
      '#ffe08a',
    );
    return true;
  }

  /**
   * 出售 1 层永久道具：账面移除并回收实际支付的 40%，随后立即重算聚合属性、
   * 最大生命（降低时钳制当前生命）、构筑面板与商店卡面。
   * 该件层数归零时清理残留临时状态（I18 蓄势、I21 计数、I23 护盾等）。
   */
  sellShopItem(itemId: string): ShopSellResult {
    if (!this.shopSession) {
      return {
        ok: false,
        reason: 'shop-unavailable',
        shortfall: 0,
        gold: this.economy.gold,
      };
    }
    const result = this.shopSession.sell(itemId);
    if (!result.ok) return result;

    const shieldToRemove = this.itemEffects.onItemRemoved(itemId);
    if (shieldToRemove > 0) {
      this.playerHealth.setShield(
        Math.max(0, this.playerHealth.shield - shieldToRemove),
      );
    }
    this.refreshItemBuild();
    this.dispatchHud({ type: 'gold', gold: this.economy.gold });
    return result;
  }

  /**
   * 正式商店界面（US-046）的动作入口。
   * DOM 面板只发意图；金币、货架、库存与二次确认都在这里提交。
   */
  handleShopPanelAction(action: ShopUiAction): void {
    if (!this.shopPanelOpen || !this.shopShelf || !this.shopSession) return;
    const cursor = this.shopUiCursor;

    switch (action.type) {
      case 'move':
        cursor.move(action.delta, this.shopUiEntryCount());
        this.publishShopPanel();
        return;
      case 'page':
        cursor.cyclePage(action.delta, 0);
        cursor.clamp(this.shopUiEntryCount());
        this.publishShopPanel();
        return;
      case 'page-to':
        cursor.setPage(action.page, 0);
        cursor.clamp(this.shopUiEntryCount());
        this.publishShopPanel();
        return;
      case 'activate': {
        const entries = this.shopUiEntries();
        cursor.focusTo(indexOfShopKey(entries, action.key), entries.length);
        this.confirmShopEntry();
        return;
      }
      case 'confirm':
        this.confirmShopEntry();
        return;
      case 'reroll':
        this.rerollShopFromPanel();
        return;
      case 'lock':
        this.lockShopFromPanel();
        return;
      case 'next-wave':
        this.closeShopPanel();
        this.advanceToNextWave();
        return;
      case 'cancel':
        if (cursor.confirm) {
          cursor.clearConfirm();
          cursor.setMessage('已取消确认', 'neutral');
        }
        this.publishShopPanel();
        return;
      default:
        this.publishShopPanel();
    }
  }

  private openShopPanel(): void {
    if (!this.shopShelf || !this.shopSession) return;
    if (this.shopPanelOpen) {
      this.publishShopPanel();
      return;
    }
    this.shopPanelOpen = true;
    this.shopUiCursor.reset();
    this.shopPotionPurchases.clear();
    this.game.events.emit(SHOP_PANEL_EVENT, {
      type: 'open',
      view: this.createShopUiView(),
    });
  }

  private publishShopPanel(): void {
    if (!this.shopPanelOpen) return;
    this.game.events.emit(SHOP_PANEL_EVENT, {
      type: 'update',
      view: this.createShopUiView(),
    });
  }

  private closeShopPanel(): void {
    if (!this.shopPanelOpen) return;
    this.shopPanelOpen = false;
    this.shopPotionPurchases.clear();
    this.game.events.emit(SHOP_PANEL_EVENT, { type: 'close' });
  }

  /** 当前页的条目数量；只做轻量读取，供焦点夹取。 */
  private shopUiEntryCount(): number {
    if (!this.shopShelf) return 0;
    if (this.shopUiCursor.page === 'equipment') {
      return this.itemInventory.snapshot().length;
    }
    if (this.shopUiCursor.page === 'recipe') {
      return listTrackableRecipes(this.recipeTrackingContext()).length;
    }
    const offers = this.shopShelf.offers.length;
    return offers + 1 + (this.shopShelf.materialSupply ? 1 : 0);
  }

  private shopUiEntries(): ShopUiEntry[] {
    if (!this.shopShelf || !this.shopSession) return [];
    if (this.shopUiCursor.page === 'equipment') {
      return this.equipmentShopEntries();
    }
    if (this.shopUiCursor.page === 'recipe') {
      return this.recipeShopEntries();
    }
    return this.shelfShopEntries();
  }

  /** 货架页：五格货物 + 常驻 P01 + 本商店缺件供给。 */
  private shelfShopEntries(): ShopUiEntry[] {
    const shelf = this.shopShelf;
    const session = this.shopSession;
    if (!shelf || !session) return [];
    const gold = this.economy.gold;
    const entries: ShopUiEntry[] = [];
    for (const offer of shelf.offers) {
      if (offer.kind === 'skill') {
        entries.push(
          describeSkillEntry({
            offer,
            quote: this.quoteShopSkill(offer.slot),
            gold,
          }),
        );
        continue;
      }
      const check = session.canPurchase(offer.slot);
      const price =
        offer.kind === 'item' ? session.effectivePrice(offer) : offer.price;
      if (offer.kind === 'potion') {
        const perWaveLimit = this.potionWaveLimit(offer.id);
        const queued = this.potionQueued(offer.id);
        entries.push(
          describePotionEntry({
            offer,
            price,
            gold,
            check,
            queued,
            perWaveLimit,
            purchases: this.shopPotionPurchases.get(offer.id) ?? 0,
            limitReached: perWaveLimit > 0 && queued >= perWaveLimit,
          }),
        );
        continue;
      }
      entries.push(describeItemEntry({ offer, price, gold, check }));
    }

    const emergency = shelf.emergencyPotion;
    entries.push(
      describeEmergencyPotionEntry({
        potion: emergency,
        effect: getConsumable(emergency.id)?.effect ?? emergency.name,
        gold,
        purchases: this.shopPotionPurchases.get(emergency.id) ?? 0,
      }),
    );

    const supply = shelf.materialSupply;
    if (supply && session) {
      entries.push(
        describeSupplyEntry({
          supply,
          price: session.effectiveMaterialSupplyPrice(),
          gold,
          full: this.itemInventory.isFull(supply.id),
        }),
      );
    }
    return entries;
  }

  /** 装备页：只把永久道具做成可出售行；核心/成品/海克斯在分组里展示。 */
  private equipmentShopEntries(): ShopUiEntry[] {
    if (!this.shopSession) return [];
    const gold = this.economy.gold;
    const sustainedSkillIds = this.equippedFreeSkillIds();
    const entries: ShopUiEntry[] = [];
    for (const owned of this.itemInventory.snapshot()) {
      const item = getShopItem(owned.id);
      if (!item) continue;
      const effect = describeItemEffect(owned.id, owned.stacks, {
        sustainedSkillIds,
      });
      entries.push(
        describeSellEntry({
          itemId: owned.id,
          name: item.name,
          stacks: owned.stacks,
          stackCap: item.stackCap,
          effect: effect || null,
          check: this.shopSession.canSell(owned.id),
          gold,
        }),
      );
    }
    return entries;
  }

  /** 配方页：所有当前职业可追踪且未拥有的配方，可直接追踪并合成。 */
  private recipeShopEntries(): ShopUiEntry[] {
    const gold = this.economy.gold;
    const ctx = this.recipeTrackingContext();
    const trackedId = this.recipeTracker.trackedRecipeId;
    const entries: ShopUiEntry[] = [];
    for (const recipe of listTrackableRecipes(ctx)) {
      const status = trackedRecipeStatus(recipe.id, ctx);
      if (!status) continue;
      const check = this.craftingSession?.canCraft(recipe.id);
      const inspection = this.previewCraft(recipe.id);
      // 净变化与开发合成面板同源；材料/技能上下文按当前装配重算。
      const netChanges = inspection
        ? formatCraftNetChanges(inspection, this.craftStatSnapshot()).map(
            (line) => ({ text: line.text, positive: line.positive }),
          )
        : [];
      const missingNames = status.ingredients
        .filter((ingredient) => ingredient.missing)
        .map((ingredient) => ingredient.name);
      entries.push(
        describeRecipeEntry({
          recipeId: recipe.id,
          name: status.name,
          tracked: trackedId === recipe.id,
          ownedIngredients: status.ownedIngredients,
          requiredIngredients: status.ingredients.length,
          ingredients: status.ingredients.map((ingredient) => ({
            id: ingredient.id,
            name: ingredient.name,
            stacks: ingredient.stacks,
            missing: ingredient.missing,
          })),
          craftable: check?.ok ?? false,
          fee: inspection?.fee ?? 0,
          gold,
          shortfall: check && !check.ok ? check.shortfall : 0,
          missing: missingNames,
          netChanges,
        }),
      );
    }
    return entries;
  }

  private potionWaveLimit(potionId: string): number {
    const params = (
      CONSUMABLE_EFFECT_PARAMS as Readonly<
        Record<string, { readonly maxPerWave?: number }>
      >
    )[potionId];
    return Math.max(0, Math.floor(params?.maxPerWave ?? 0));
  }

  private potionQueued(potionId: string): number {
    return (
      this.consumables.pendingCount(potionId) +
      this.consumables.activeCount(potionId)
    );
  }

  /** 右侧追踪栏：被追踪配方的逐件进度与可合成高亮。 */
  private shopUiTracking(): ShopUiTracking {
    const ctx = this.recipeTrackingContext();
    const recipeId = this.recipeTracker.trackedRecipeId;
    const status = recipeId ? trackedRecipeStatus(recipeId, ctx) : null;
    if (!status || !recipeId) {
      return {
        tracked: false,
        recipeId: null,
        name: null,
        ownedIngredients: 0,
        requiredIngredients: 3,
        ingredients: [],
        missingNames: [],
        craftable: false,
        fee: null,
        shortfall: 0,
      };
    }
    const check = this.craftingSession?.canCraft(recipeId);
    const inspection = this.previewCraft(recipeId);
    return {
      tracked: true,
      recipeId,
      name: status.name,
      ownedIngredients: status.ownedIngredients,
      requiredIngredients: status.ingredients.length,
      ingredients: status.ingredients.map((ingredient) => ({
        id: ingredient.id,
        name: ingredient.name,
        stacks: ingredient.stacks,
        required: 1,
        missing: ingredient.missing,
      })),
      missingNames: status.ingredients
        .filter((ingredient) => ingredient.missing)
        .map((ingredient) => ingredient.name),
      craftable: check?.ok ?? false,
      fee: inspection?.fee ?? null,
      shortfall: check && !check.ok ? check.shortfall : 0,
    };
  }

  /** 底部常驻 U/I：名称、等级与冷却。 */
  private shopUiSkills(): ShopUiSkillSlot[] {
    return this.freeSkills.snapshot().slots.map((slot) => {
      const definition = slot.skill ? getFreeSkill(slot.skill.id) : null;
      return {
        slot: slot.slot,
        name: definition?.name ?? '空槽',
        level: slot.skill?.level ?? null,
        cooldownSeconds: slot.skill ? slot.cooldownSeconds : null,
        description: definition?.effect ?? '可在货架装备自由技能',
      };
    });
  }

  /** 构筑面板：五类来源分组 + 净属性，所有数值在打开瞬间重新读取。 */
  private createBuildPanelView(): BuildPanelView {
    const stats = this.stats;
    const snapshot = this.consumables.snapshot();
    const potionIds = new Set([
      ...Object.keys(snapshot.pending),
      ...Object.keys(snapshot.active),
    ]);
    const sustainedSkillIds = this.equippedFreeSkillIds();
    return buildBuildPanelView({
      wave: this.waveNumber,
      health: this.playerHealth.health,
      maxHealth: this.playerHealth.maxHealth,
      shield: this.playerHealth.shield,
      stats: {
        armor: stats.armor,
        magicResist: stats.magicResist,
        moveSpeed: stats.moveSpeed,
        moveSpeedMultiplier: stats.moveSpeedMultiplier,
        attackSpeedMultiplier: stats.attackSpeedMultiplier,
        damageMultiplier: stats.damageMultiplier,
        skillDamageMultiplier: stats.skillDamageMultiplier,
        normalAttackDamageMultiplier: stats.normalAttackDamageMultiplier,
        cooldownReduction: stats.cooldownReduction,
        explosionRadiusMultiplier: stats.explosionRadiusMultiplier,
        damageOverTimeMultiplier: stats.damageOverTimeMultiplier,
        recipeDamageOverTimeMultiplier:
          stats.recipeDamageOverTimeMultiplier,
        summonDamageMultiplier: stats.summonDamageMultiplier,
        killGoldMultiplier: stats.killGoldMultiplier,
        completionGoldMultiplier: stats.completionGoldMultiplier,
        lifesteal: this.itemEffects.lifesteal,
        regenPerFiveSeconds: this.itemEffects.regenPerFiveSeconds,
      },
      potions: [...potionIds].map((id) => ({
        id,
        pending: snapshot.pending[id] ?? 0,
        active: snapshot.active[id] ?? 0,
      })),
      items: this.itemInventory.snapshot(),
      cores: this.coreInventory.snapshot(),
      crafted: this.craftedInventory.snapshot(),
      hexes: this.hexRun.ownedIds,
      sustainedSkillIds,
      craftedNotes: this.buildCraftedPanelNotes(sustainedSkillIds),
    });
  }

  /** 成品动态说明：R01 当前成长、R02 是否有持续伤害来源。 */
  private buildCraftedPanelNotes(
    sustainedSkillIds: readonly string[],
  ): Record<string, readonly string[]> {
    const notes: Record<string, readonly string[]> = {};
    if (this.craftedInventory.has('R01')) {
      notes.R01 = [
        `成长 +${hudValue(this.craftedEffects.r01Growth)}/${hudValue(R01_GROWTH_CAP)}`,
      ];
    }
    if (this.craftedInventory.has('R02')) {
      notes.R02 = [sustainedChannelNote(sustainedSkillIds)];
    }
    return notes;
  }

  /** 装备页属性面板：与战斗结算同源的聚合值。 */
  private shopUiAttributes(): ShopUiAttribute[] {
    const percent = (value: number): string =>
      `${Math.round((value + Number.EPSILON) * 100)}%`;
    const number = (value: number): string => {
      const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
      return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
    };
    const stats = this.stats;
    return [
      {
        label: '生命',
        value: `${hudValue(this.playerHealth.health)}/${hudValue(this.playerHealth.maxHealth)}`,
      },
      { label: '护盾', value: `${hudValue(this.playerHealth.shield)}` },
      { label: '护甲', value: number(stats.armor) },
      {
        label: '移速',
        value: `${number(stats.moveSpeed)} · ${percent(stats.moveSpeedMultiplier)}`,
      },
      { label: '攻速', value: percent(stats.attackSpeedMultiplier) },
      { label: '伤害', value: percent(stats.damageMultiplier) },
      { label: '技能伤害', value: percent(stats.skillDamageMultiplier) },
      { label: 'J 伤害', value: percent(stats.normalAttackDamageMultiplier) },
      { label: '冷却缩减', value: percent(stats.cooldownReduction) },
      { label: '爆炸半径', value: percent(stats.explosionRadiusMultiplier) },
      { label: '持续伤害', value: percent(stats.damageOverTimeMultiplier) },
      { label: '召唤物伤害', value: percent(stats.summonDamageMultiplier) },
      {
        label: '每 5 秒回复',
        value: number(this.itemEffects.regenPerFiveSeconds),
      },
      { label: '吸血', value: number(this.itemEffects.lifesteal) },
      { label: '击杀金币', value: percent(stats.killGoldMultiplier) },
      { label: '完成奖励', value: percent(stats.completionGoldMultiplier) },
    ];
  }

  /** 装备页分组：强化、海克斯、成品、核心与临时药剂分开显示。 */
  private shopUiGroups(): ShopUiGroup[] {
    const groups: ShopUiGroup[] = [];
    const upgrades = this.upgradeRun.ownedIds().map((id) => {
      const card = getUpgrade(id);
      return `${id} ${card?.name ?? id} ×${this.upgradeRun.stacksOf(id)}`;
    });
    if (upgrades.length > 0) {
      groups.push({ title: `强化（${upgrades.length}）`, lines: upgrades });
    }

    const hexes = this.hexRun.ownedIds.map(
      (id) => `${id} ${getHex(id)?.name ?? id}`,
    );
    if (hexes.length > 0) {
      groups.push({ title: `海克斯（${hexes.length}）`, lines: hexes });
    }

    const crafted = this.craftedInventory.snapshot().map((id) => {
      const description = describeCraftedItem(id);
      return `${id} ${description?.name ?? id}`;
    });
    if (crafted.length > 0) {
      groups.push({ title: `配方成品（${crafted.length}）`, lines: crafted });
    }

    const cores = this.coreInventory.snapshot().map((id) => {
      const core = getEliteCore(id);
      return `${id} ${core?.name ?? id}${core ? ` · ${core.effect}` : ''}`;
    });
    if (cores.length > 0) {
      groups.push({ title: `精英核心（${cores.length}）`, lines: cores });
    }

    const snapshot = this.consumables.snapshot();
    const potionLines: string[] = [];
    for (const [id, count] of Object.entries(snapshot.pending)) {
      potionLines.push(`${id} 排队 ×${count}`);
    }
    for (const [id, count] of Object.entries(snapshot.active)) {
      potionLines.push(`${id} 生效 ×${count}`);
    }
    if (potionLines.length > 0) {
      groups.push({ title: '临时药剂', lines: potionLines });
    }
    return groups;
  }

  /** 生成 DOM 面板的一帧；所有数值都在这里重新读取。 */
  private createShopUiView(): ShopUiView {
    const shelf = this.shopShelf;
    const session = this.shopSession;
    const cursor = this.shopUiCursor;
    const gold = this.economy.gold;
    cursor.clamp(this.shopUiEntryCount());
    const entries = this.shopUiEntries();
    const nextWave = this.waveNumber < SHOP_LAST_WAVE ? this.waveNumber + 1 : null;
    const nextWaveKind = nextWave ? WAVE_KIND_LABELS[getWave(nextWave).kind] : null;
    const rerollCost = session?.nextRerollCost ?? 0;
    const freeReroll = session?.freeRerollAvailable ?? false;
    const remaining = this.rewardFlow?.remainingRewards ?? 0;
    const tracking = this.shopUiTracking();
    const confirm = cursor.confirm
      ? {
          text: `${cursor.confirm.label} · ${cursor.confirm.hint}`,
          tone: 'warn' as const,
        }
      : null;

    return buildShopUiView({
      wave: this.waveNumber,
      gold,
      health: this.playerHealth.health,
      maxHealth: this.playerHealth.maxHealth,
      shield: this.playerHealth.shield,
      nextWave,
      nextWaveKind,
      settlementLabel:
        remaining > 0 ? `待领取 ${remaining} 项奖励` : '本波奖励已全部领取 · 结算完成',
      page: cursor.page,
      focus: cursor.focus,
      entries,
      tracking,
      skills: this.shopUiSkills(),
      attributes: this.shopUiAttributes(),
      groups: this.shopUiGroups(),
      message: cursor.message,
      confirm,
      rerollCost,
      freeReroll,
      rerollCount: shelf?.rerollCount ?? 0,
      rerollAffordable: freeReroll || rerollCost <= gold,
      rerollShortfall: Math.max(0, rerollCost - gold),
      lockedSlot: shelf?.lockedOffer?.slot ?? null,
    });
  }

  private confirmShopEntry(): void {
    const entries = this.shopUiEntries();
    const cursor = this.shopUiCursor;
    cursor.clamp(entries.length);
    const entry = entries[cursor.focus];
    if (!entry) {
      cursor.clearConfirm();
      cursor.setMessage('当前页没有可选条目', 'warn');
      this.publishShopPanel();
      return;
    }
    if (entry.disabled) {
      cursor.clearConfirm();
      cursor.setMessage(entry.disabledReason ?? '暂不可交易', 'warn');
      this.publishShopPanel();
      return;
    }

    // 未追踪配方按 Enter 只是切换追踪，不进入购买/合成二次确认。
    if (
      entry.kind === 'recipe' &&
      this.recipeTracker.trackedRecipeId !== entry.id
    ) {
      this.executeShopEntry(entry);
      return;
    }

    const step = cursor.requestConfirm(
      entry.key,
      shopConfirmLabel(entry),
      shopConfirmHint(entry),
    );
    if (step === 'first') {
      cursor.setMessage(
        `再次按 Enter 确认：${shopConfirmLabel(entry)}（Esc 取消）`,
        'warn',
      );
      this.publishShopPanel();
      return;
    }

    this.executeShopEntry(entry);
  }

  private executeShopEntry(entry: ShopUiEntry): void {
    const cursor = this.shopUiCursor;
    cursor.clearConfirm();

    if (entry.kind === 'item' || entry.kind === 'skill' || entry.kind === 'potion') {
      if (entry.kind === 'potion' && entry.slot === null) {
        const result = this.purchaseEmergencyPotion();
        if (!result.ok) {
          cursor.setMessage(
            shopFailureLabel(result.reason, result.shortfall),
            'warn',
          );
        } else {
          const count = (this.shopPotionPurchases.get(result.potionId) ?? 0) + 1;
          this.shopPotionPurchases.set(result.potionId, count);
          cursor.setMessage(
            `已购买 ${entry.name} · ${result.price} 金币 · 本商店第 ${count} 次`,
            'good',
          );
        }
        this.afterShopChange('shop-purchase');
        return;
      }

      if (entry.slot === null) {
        cursor.setMessage('该商品没有货架格', 'warn');
        this.publishShopPanel();
        return;
      }
      const result = this.purchaseShopSlot(entry.slot);
      if (!result.ok) {
        cursor.setMessage(
          shopFailureLabel(result.reason, result.shortfall),
          'warn',
        );
      } else if (entry.kind === 'skill' && 'action' in result) {
        const actionLabel =
          result.action === 'upgrade'
            ? '升级'
            : result.action === 'replace'
              ? '替换'
              : '装备';
        const refund = result.refund > 0 ? ` · 回收 ${result.refund}` : '';
        cursor.setMessage(
          `已${actionLabel} ${result.skillName} → ${result.targetSlot} 槽 Lv${result.level} · 实付 ${result.price}${refund}`,
          'good',
        );
      } else {
        const stacks =
          'stacksAfter' in result && result.stacksAfter !== null
            ? ` · 当前 ${result.stacksAfter} 层`
            : '';
        cursor.setMessage(
          `已购买 ${entry.name} · ${result.price} 金币${stacks}`,
          'good',
        );
        if (entry.kind === 'potion') {
          const count = (this.shopPotionPurchases.get(entry.id) ?? 0) + 1;
          this.shopPotionPurchases.set(entry.id, count);
        }
      }
      this.afterShopChange(
        entry.kind === 'skill' && result.ok ? 'skill-equipped' : 'shop-purchase',
      );
      return;
    }

    if (entry.kind === 'supply') {
      const result = this.purchaseMaterialSupply();
      if (!result.ok) {
        cursor.setMessage(
          shopFailureLabel(result.reason, result.shortfall),
          'warn',
        );
      } else {
        cursor.setMessage(
          `已补缺件 ${entry.name} · ${result.price} 金币 · 当前 ${result.stacksAfter} 层`,
          'good',
        );
      }
      this.afterShopChange('shop-purchase');
      return;
    }

    if (entry.kind === 'sell') {
      const result = this.sellShopItem(entry.id);
      if (!result.ok) {
        cursor.setMessage(
          shopFailureLabel(result.reason, result.shortfall),
          'warn',
        );
      } else {
        cursor.setMessage(
          `已出售 ${entry.name} · 回收 ${result.refund} 金币 · 剩余 ${result.remainingStacks} 层`,
          'good',
        );
      }
      this.afterShopChange('shop-purchase');
      return;
    }

    if (entry.kind === 'recipe') {
      // 未追踪配方：Enter 先选中追踪；已追踪配方才进入合成确认。
      if (this.recipeTracker.trackedRecipeId !== entry.id) {
        const tracked = this.recipeTracker.track(
          entry.id,
          this.recipeTrackingContext(),
        );
        cursor.setMessage(
          tracked
            ? `已追踪 ${entry.name} · 右侧显示缺件进度`
            : `无法追踪 ${entry.name}`,
          tracked ? 'good' : 'warn',
        );
        this.afterShopChange();
        return;
      }
    }

    const result = this.craftRecipe(entry.id);
    if (!result.ok) {
      const missing =
        result.missing.length > 0
          ? ` · 缺 ${result.missing.map((item) => item.name).join('/')}`
          : '';
      cursor.setMessage(
        `${shopFailureLabel(result.reason, result.shortfall)}${missing}`,
        'warn',
      );
    } else {
      cursor.setMessage(
        `已合成 ${result.name} · 手续费 ${result.fee} 金币`,
        'good',
      );
      this.showSkillLabel(`合成 · ${result.name}`, '#9df2bc');
    }
    this.afterShopChange(result.ok ? 'shop-craft' : 'intermission');
  }

  /**
   * 交易成功后统一重算卡面、HUD 与焦点，保证面板数值与战斗同源。
   * 默认写波间检查点；购买/合成/技能替换等提交边界由调用方传入专用类型，
   * 刷新后恢复到该笔交易之后的状态，金币、货架与已拥有内容都不重复。
   */
  private afterShopChange(kind: RunCheckpointKind = 'intermission'): void {
    this.shopShelf?.refreshItemPreviews();
    this.syncHealthHud();
    this.updateBuildHud();
    this.shopUiCursor.clamp(this.shopUiEntryCount());
    this.publishShopPanel();
    this.saveCheckpoint(kind);
  }

  private rerollShopFromPanel(): void {
    const cursor = this.shopUiCursor;
    if (!this.shopSession) return;
    if (cursor.page !== 'shelf') {
      cursor.setMessage('重抽只在货架页可用', 'warn');
      this.publishShopPanel();
      return;
    }
    cursor.clearConfirm();
    const result = this.shopSession.reroll();
    if (!result.ok) {
      cursor.setMessage(
        `重抽失败：${shopFailureLabel(result.reason, result.shortfall)}`,
        'warn',
      );
      this.publishShopPanel();
      return;
    }
    this.shopShelf?.refreshItemPreviews();
    cursor.clamp(this.shopUiEntryCount());
    cursor.setMessage(
      `已重抽 · ${
        result.cost > 0 ? `花费 ${result.cost} 金币` : '本商店首次免费'
      } · 剩余金币 ${result.goldAfter}`,
      'good',
    );
    this.publishShopPanel();
    this.saveCheckpoint('intermission');
  }

  private lockShopFromPanel(): void {
    const cursor = this.shopUiCursor;
    if (!this.shopSession) return;
    if (cursor.page !== 'shelf') {
      cursor.setMessage('锁定只在货架页可用', 'warn');
      this.publishShopPanel();
      return;
    }
    cursor.clearConfirm();
    const entries = this.shopUiEntries();
    const entry = entries[cursor.focus];
    if (!entry || entry.slot === null) {
      cursor.setMessage('只有五格货物可以锁定', 'warn');
      this.publishShopPanel();
      return;
    }
    const current = this.shopShelf?.lockedOffer ?? null;
    if (current && current.slot === entry.slot) {
      this.shopSession.unlock();
      cursor.setMessage(`已解除锁定 [${entry.slot + 1}] ${entry.name}`, 'neutral');
    } else if (this.shopSession.lock(entry.slot)) {
      cursor.setMessage(
        `已锁定 [${entry.slot + 1}] ${entry.name} · 重抽保留并带入下一商店`,
        'good',
      );
    } else {
      cursor.setMessage('该格无法锁定（可能已售出）', 'warn');
    }
    this.publishShopPanel();
    this.saveCheckpoint('intermission');
  }

  /** 合成确认前的报价：材料、手续费与净属性变化；不扣款、不改库存。 */
  previewCraft(recipeId: string) {
    return this.craftingSession?.inspect(recipeId) ?? null;
  }
  /**
   * 通过当前商店合成一条配方：成功后立即重算聚合属性、生命上限与构筑面板，
   * 并清理材料层数归零后残留的临时状态（I18 蓄势、I21 计数、I23 护盾等）。
   * 正式商店界面（US-046）与开发 `?craft=` 键盘入口共用本入口。
   */
  craftRecipe(recipeId: string): CraftResult {
    if (!this.craftingSession) {
      return {
        ok: false,
        reason: 'craft-unavailable',
        gold: this.economy.gold,
        shortfall: 0,
        missing: [],
        recipeId,
      };
    }
    const result = this.craftingSession.craft(recipeId);
    this.lastCraftResult = result;
    if (!result.ok) {
      this.refreshRewardOverlay();
      return result;
    }

    for (const material of result.materials) {
      const shieldToRemove = this.itemEffects.onItemRemoved(material.id);
      if (shieldToRemove > 0) {
        this.playerHealth.setShield(
          Math.max(0, this.playerHealth.shield - shieldToRemove),
        );
      }
    }
    this.refreshItemBuild();
    // 合成完成后清除旧追踪：配方已拥有，不再需要缺件保底。
    this.recipeTracker.noteCrafted(result.recipeId);
    this.dispatchHud({ type: 'gold', gold: this.economy.gold });
    this.showSkillLabel(
      `合成 · ${result.name} · 手续费 ${result.fee}`,
      '#ffe08a',
    );
    this.refreshRewardOverlay();
    return result;
  }

  /** 当前商店按槽位或商品 ID（道具/药剂）查找；开发操作报告用。 */
  private findShopOffer(target: number | string): ShopOffer | null {
    const offers = this.shopShelf?.offers ?? [];
    if (typeof target === 'number') {
      return offers.find((entry) => entry.slot === target) ?? null;
    }
    return offers.find((entry) => entry.id === target) ?? null;
  }

  private captureShopOpState(): {
    gold: number;
    health: number;
    maxHealth: number;
    armor: number;
    attackSpeed: number;
  } {
    return {
      gold: this.economy.gold,
      health: this.playerHealth.health,
      maxHealth: this.playerHealth.maxHealth,
      armor: this.stats.armor,
      attackSpeed: this.stats.attackSpeedMultiplier,
    };
  }

  /** 在第一个商店执行一次开发购买/出售序列，并把每步前后状态写入快照。 */
  private runDevShopOps(): void {
    if (!import.meta.env.DEV || this.devShopOpsRan) return;
    const ops = this.devScenario?.shopOps;
    if (!ops || ops.length === 0 || !this.shopShelf || !this.shopSession) return;
    this.devShopOpsRan = true;

    const requested = this.devScenarioReport?.devApplied.shopOps;
    const steps: DevShopOpStep[] = [];
    const failures: string[] = [];
    for (const op of ops) {
      const step = this.runDevShopOp(op);
      steps.push(step);
      if (!step.ok) failures.push(`${step.op}（${step.reason ?? '失败'}）`);
    }
    this.devShopOpsReport = {
      requested: typeof requested === 'string' ? requested : '',
      steps,
      failureReason: failures.length > 0 ? failures.join('；') : null,
    };
  }

  private runDevShopOp(op: DevShopOp): DevShopOpStep {
    const before = this.captureShopOpState();
    const opText =
      op.kind === 'reroll'
        ? 'reroll'
        : op.kind === 'sell'
          ? `sell:${op.target}`
          : `buy:${op.target}${op.slot ? `@${op.slot}` : ''}`;
    let ok = false;
    let reason: string | null = null;
    let itemId: string | null;
    let paid = 0;
    let refund = 0;
    let stacks: number | null = null;
    let skillSlot: 'U' | 'I' | null = null;
    let skillLevel: number | null = null;
    let skillCooldownSeconds: number | null = null;
    let netGold: number | null = null;
    let replacedId: string | null = null;
    let replacedLevel: number | null = null;
    let replacedCooldownSeconds: number | null = null;

    if (op.kind === 'buy') {
      // `supply` 是追踪配方的缺件供给，独立于五格与 P01 按钮。
      if (op.target === 'supply') {
        const result = this.purchaseMaterialSupply();
        itemId = result.ok ? result.itemId : null;
        if (result.ok) {
          ok = true;
          paid = result.price;
          stacks = result.stacksAfter;
        } else {
          reason = result.reason;
        }
      // P01 是货架外的常驻按钮；其余药剂按 ID 解析当手货架的药剂格。
      } else if (op.target === 'P01') {
        itemId = 'P01';
        const result = this.purchaseEmergencyPotion();
        if (result.ok) {
          ok = true;
        } else {
          reason = result.reason;
        }
      } else {
        const offer = this.findShopOffer(op.target);
        if (!offer) {
          itemId = typeof op.target === 'string' ? op.target : null;
          reason = 'not-on-shelf';
        } else {
          itemId = offer.id;
          const result = this.purchaseShopSlot(offer.slot, op.slot);
          if (result.ok) {
            ok = true;
            paid = result.price;
            stacks = result.stacksAfter;
            if ('targetSlot' in result) {
              skillSlot = result.targetSlot;
              skillLevel = result.level;
              skillCooldownSeconds = result.cooldownSeconds;
              netGold = result.netGold;
              refund = result.refund;
              replacedId = result.replaced?.id ?? null;
              replacedLevel = result.replaced?.level ?? null;
              replacedCooldownSeconds =
                result.replaced?.cooldownSeconds ?? null;
            }
          } else {
            reason = result.reason;
          }
        }
      }
    } else if (op.kind === 'sell') {
      // 槽位写法解析该格当前道具；道具 ID 写法直接出售，便于预置/宝箱获得的层数。
      const targetId =
        typeof op.target === 'string'
          ? op.target
          : this.findShopOffer(op.target)?.id ?? null;
      itemId = targetId;
      if (targetId === null) {
        reason = 'not-on-shelf';
      } else {
        const result = this.sellShopItem(targetId);
        if (result.ok) {
          ok = true;
          paid = result.paid;
          refund = result.refund;
          stacks = result.remainingStacks;
        } else {
          reason = result.reason;
        }
      }
    } else {
      // 重抽走与正式按钮相同的交易入口；R06 的免费次数由会话自行扣除。
      itemId = null;
      const result = this.shopSession?.reroll();
      if (!result) {
        reason = 'shop-unavailable';
      } else if (result.ok) {
        ok = true;
        paid = result.cost;
      } else {
        reason = result.reason;
      }
    }

    const after = this.captureShopOpState();
    return {
      op: opText,
      ok,
      reason,
      itemId,
      paid,
      refund,
      stacks,
      goldBefore: before.gold,
      goldAfter: after.gold,
      healthBefore: before.health,
      healthAfter: after.health,
      maxHealthBefore: before.maxHealth,
      maxHealthAfter: after.maxHealth,
      armorBefore: before.armor,
      armorAfter: after.armor,
      attackSpeedBefore: before.attackSpeed,
      attackSpeedAfter: after.attackSpeed,
      skillSlot,
      skillLevel,
      skillCooldownSeconds,
      netGold,
      replacedId,
      replacedLevel,
      replacedCooldownSeconds,
    };
  }

  /**
   * 推进 I09 周期回复与 I12 静止计时，并把 I10 的吸血预算交给逻辑时钟。
   * 静止按实际位移判定：贴墙推但位置没变仍算静止，与“静止”语义一致。
   */
  private stepItemEffects(stepSeconds: number): void {
    // R01 反击的内置冷却按固定逻辑步衰减；与 I18 蓄势各自独立。
    this.craftedEffects.step(stepSeconds);
    const position = this.motion.position;
    const moved =
      this.lastItemPosition !== null &&
      distanceSquared(position, this.lastItemPosition) > 1e-6;
    this.lastItemPosition = { x: position.x, y: position.y };

    const result = this.itemEffects.step(stepSeconds, moved);
    // I12 的状态会改变实际伤害；榴弹系统自己保存倍率，必须同步刷新。
    this.grenade?.setDamageMultiplier(this.jDamageMultiplier());
    // I23 护盾到期：只移除仍存在的那部分，已被伤害消耗的不再重复扣。
    if (result.shieldExpired > 0) {
      this.playerHealth.setShield(
        Math.max(0, this.playerHealth.shield - result.shieldExpired),
      );
      this.syncHealthHud();
    }
    if (this.playerHealth.isDead) return;

    // I09 周期回复；P07 的每秒回复独立结算，两者都在时各自生效。
    if (result.regenHeal > 0) {
      const healed = this.playerHealth.heal(
        result.regenHeal * this.stats.healingMultiplier,
      );
      if (healed > 0) {
        this.showSkillLabel(`治疗凝胶 · 生命 +${hudValue(healed)}`, '#9df2bc');
        this.syncHealthHud();
        this.updateBuildHud();
      }
    }

    const potionHeal = this.consumables.step(stepSeconds);
    if (potionHeal > 0) {
      const healed = this.playerHealth.heal(
        applyHealingModifier(potionHeal, this.stats.healingMultiplier),
      );
      if (healed > 0) {
        this.showSkillLabel(`生息饮剂 · 生命 +${hudValue(healed)}`, '#9df2bc');
        this.syncHealthHud();
        this.updateBuildHud();
      }
    }

    // H20 持久战：每秒回复 0.5，按整点结算，与 P07 的回复各自独立。
    const hexRegen = this.hexEffects.step(stepSeconds);
    if (hexRegen > 0) {
      const healed = this.playerHealth.heal(
        applyHealingModifier(hexRegen, this.stats.healingMultiplier),
      );
      if (healed > 0) {
        this.showSkillLabel(`持久战 · 生命 +${hudValue(healed)}`, '#9df2bc');
        this.syncHealthHud();
        this.updateBuildHud();
      }
    }
  }

  /** I10：只在实际命中敌人并造成伤害后结算吸血；宝箱不算。 */
  private applyItemLifesteal(actualDamage: number): void {
    if (actualDamage <= 0 || this.playerHealth.isDead) return;
    const healed = this.itemEffects.absorbLifesteal(
      actualDamage,
      this.stats.healingMultiplier,
      false,
    );
    if (healed <= 0) return;
    const applied = this.playerHealth.heal(healed);
    if (applied > 0) {
      this.showSkillLabel(`血循环泵 · 生命 +${hudValue(applied)}`, '#ff9fb0');
      this.syncHealthHud();
    }
  }

  /** I23：每波首次降到阈值生命时授予护盾；同波只触发一次。 */
  private tryTriggerLowHealthShield(): void {
    if (this.playerHealth.isDead) return;
    const shield = this.itemEffects.tryTriggerLowHealthShield(
      this.playerHealth.health,
      this.playerHealth.maxHealth,
    );
    if (shield <= 0) return;
    this.playerHealth.setShield(this.playerHealth.shield + shield);
    this.syncHealthHud();
    this.showSkillLabel(`保险齿轮 · 护盾 +${hudValue(shield)}`, '#cfe8ff');
  }

  /**
   * I18：给本次 J 的攻击定义乘上蓄势增伤（直接伤害与余震一起）。
   * 只有真正发射/盾击时调用一次，避免常驻倍率通道重复消费。
   */
  private applyNextJBonus(attack: AttackDefinition): AttackDefinition {
    const bonus = this.itemEffects.consumeNextJBonus();
    if (bonus <= 0) return attack;
    this.showSkillLabel(`锻心碎片 · J 伤害 +${Math.round(bonus * 100)}%`, '#ffd166');
    return {
      ...attack,
      damage: attack.damage * (1 + bonus),
      aftershock: attack.aftershock
        ? { ...attack.aftershock, damage: attack.aftershock.damage * (1 + bonus) }
        : undefined,
    };
  }

  /**
   * I21：登记一次 J 命中；每第 6 次向命中目标附近最近的另一名敌人
   * 弹射 40% 法伤。弹射伤害不登记 J 命中，因此不会递归触发。
   */
  private tryItemRicochet(
    sourceTargetId: string,
    dealtDamage: number,
    eventSource: CombatEventSource | null,
  ): void {
    if (!this.itemEffects.registerJHit()) return;
    const ratio = this.itemEffects.ricochetDamageRatio;
    if (ratio <= 0 || dealtDamage <= 0) return;
    const source = this.enemies.find(
      (enemy) => enemy.unit.combatant.id === sourceTargetId,
    );
    if (!source) return;

    let best: EnemyView | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const enemy of this.enemies) {
      if (enemy.unit.combatant.id === sourceTargetId) continue;
      if (!enemy.unit.combatant.isAlive) continue;
      const distance = distanceSquared(enemy.unit.combatant, source.unit.combatant);
      if (distance > ITEM_RICOCHET_RADIUS * ITEM_RICOCHET_RADIUS) continue;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = enemy;
      }
    }
    if (!best) return;

    const result = best.unit.combatant.applyDamage(
      dealtDamage * ratio,
      'magic',
      eventSource ?? this.damageChains.beginNative('I21'),
    );
    this.showSkillLabel('分叉导线 · 弹射', '#9ecbff');
    this.showHitResult(best.unit.combatant.id, result);
  }

  /**
   * R01：消费蓄势并返回下一发 J 附加的物伤。
   * 未蓄势返回 0；蓄势被消费即失效，即使本发落空也不保留。
   */
  private consumeCraftedCounterDamage(): number {
    const damage = this.craftedEffects.consumeCounterBonus(
      this.playerHealth.maxHealth,
    );
    if (damage > 0) {
      this.showSkillLabel(
        `锻心引擎 · 反击 ${hudValue(damage)} 物伤`,
        '#ffd166',
      );
    }
    return damage;
  }

  /**
   * R01：把反击附加伤害作为一次独立物理伤害结算。
   * 来源从本次 J 的原生链派生一层，因此不会再触发其他衍生效果。
   */
  private applyCraftedCounterDamage(
    targetId: string,
    damage: number,
    parent: CombatEventSource,
  ): void {
    if (!(damage > 0)) return;
    const enemy = this.enemies.find(
      (entry) => entry.unit.combatant.id === targetId,
    );
    const chest = this.chest?.chest;
    const target =
      enemy?.unit.combatant ?? (chest?.id === targetId ? chest : null);
    if (!target || !target.isAlive) return;
    const source = this.damageChains.derive(parent, 'R01');
    if (!source) return;
    const result = target.applyDamage(damage, 'physical', source);
    this.showHitResult(targetId, result, false);
  }

  /**
   * R03 折镜机关：沿面向左右各发射一枚 40% 侧弹。
   * 侧弹由原生 J 派生（`planR03SideShots` 已给出 depth=1 来源），
   * 命中不会再次生成侧弹；伤害倍率仍按 J 普攻计算。
   */
  private spawnCraftedSideBullets(
    attack: AttackDefinition,
    plan: R03SideShotPlan,
    origin: CombatPoint,
    facing: Facing,
    colors: CharacterEffectColors,
    radius: number,
  ): void {
    const vector = FACING_VECTORS[facing];
    const sideAttack: AttackDefinition = {
      ...attack,
      damage: attack.damage * plan.damageRatio,
      aftershock: attack.aftershock
        ? {
            ...attack.aftershock,
            damage: attack.aftershock.damage * plan.damageRatio,
          }
        : undefined,
    };
    for (let index = 0; index < plan.count; index += 1) {
      const sign = index % 2 === 0 ? 1 : -1;
      const direction = { x: -vector.y * sign, y: vector.x * sign };
      const state = createProjectile(
        this.nextProjectileId,
        origin,
        facing,
        sideAttack,
        { radius, direction },
      );
      this.nextProjectileId += 1;
      const sprite = this.add
        .circle(
          origin.x,
          origin.y,
          projectileVisualRadius(state.radius),
          colors.secondary,
        )
        .setStrokeStyle(1.5, colors.projectileStroke)
        .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
      this.projectiles.push({
        state,
        sprite,
        source: 'J',
        eventSource: plan.source,
      });
    }
    this.craftedEffects.recordSideBullets(plan.count);
    this.showSkillLabel('折镜机关 · 侧弹', '#c8b6ff');
  }

  /** I24：把追加的小爆炸画成一次金色爆炸，并显示命中伤害。 */
  private renderFissionExplosion(blast: ExplosionBlast | null): void {
    if (!blast) return;
    this.showExplosion(blast.x, blast.y, blast.radius, 0xffd166);
    for (const hit of blast.hits) this.showHitResult(hit.targetId, hit.damage);
    this.recordCoreExplosionHits(blast.hits);
  }

  /**
   * R02 连锁反应堆：播放爆炸击杀产生的小爆炸。
   * 命中伤害已由 `GrenadeSystem` 结算；击杀不再触发新的小爆炸（纯逻辑层已保证）。
   */
  private renderDeathExplosions(blasts: readonly ExplosionBlast[]): void {
    if (blasts.length === 0) return;
    this.craftedEffects.recordDeathExplosions(blasts.length);
    for (const blast of blasts) {
      this.showExplosion(blast.x, blast.y, blast.radius, 0xffa94d);
      for (const hit of blast.hits) {
        this.showHitResult(hit.targetId, hit.damage, false);
      }
      this.recordCoreExplosionHits(blast.hits);
    }
    this.showSkillLabel('连锁反应堆 · 小爆炸', '#ffa94d');
  }

  /** 把聚合后的 G01/G02/G03、攻速与 G04/等级生命推给实际结算系统。 */
  private syncBuildModifiers(): void {
    this.syncStatSources();
    this.playerHealth.setDefenses(this.stats.armor, this.stats.magicResist);
    this.playerHealth.setMaxHealth(this.effectiveMaxHealth());
    this.attackTimer.setIntervalMultiplier(this.stats.attackIntervalMultiplier);
    this.grenade?.setDamageMultiplier(this.jDamageMultiplier());
    // I13 爆炸半径/伤害与 I24 每第 5 次爆炸的小爆炸。
    this.grenade?.setExplosionModifiers(
      this.stats.explosionRadiusMultiplier,
      this.stats.explosionDamageMultiplier,
    );
    const i24Stacks = this.itemInventory.stacksOf('I24');
    this.grenade?.setFissionPowder(
      i24Stacks > 0,
      ITEM_EFFECT_PARAMS.I24.fissionEvery ?? 0,
      (ITEM_EFFECT_PARAMS.I24.fissionDamagePercent ?? 0) * Math.max(1, i24Stacks),
    );
    // R02 连锁反应堆：爆炸击杀追加 50% 小爆炸（不递归）。
    this.grenade?.setDeathExplosion(
      this.craftedInventory.has('R02'),
      R02_DEATH_EXPLOSION_RATIO,
    );
    // W01/H25 追加余震与 W02/H26 标记扩散只在拥有对应卡或海克斯时开启；
    // 两组来源效果相同，同时拥有不会叠成两次。
    const h25 = this.bomberHexes.has('H25');
    this.grenade?.setSecondAftershock(
      this.upgradeRun.stacksOf('W01') > 0 || h25,
      h25
        ? BOMBER_HEX_PARAMS.H25.secondAftershockDelaySeconds
        : undefined,
      h25
        ? BOMBER_HEX_PARAMS.H25.secondAftershockDamageRatio
        : undefined,
    );
    const h26 = this.bomberHexes.has('H26');
    this.grenade?.setMarkSpread(
      this.upgradeRun.stacksOf('W02') > 0 || h26,
      h26 ? BOMBER_HEX_PARAMS.H26.markSpreadTargets : undefined,
    );
    // H30 的波纹与 H25/H26 一样只由 `bomberHexes` 记录队列，这里无需额外同步。
    // I15 技能冷却惩罚与持续时间；I24 只额外延长爆炸技能（L 爆裂黎明）。
    const skillCooldownMultiplier =
      this.stats.cooldownMultiplier * this.stats.skillCooldownMultiplier;
    this.freeSkills.setCooldownMultiplier(skillCooldownMultiplier);
    const skillDurationMultiplier = this.stats.skillDurationMultiplier;
    this.soul?.setCooldownMultiplier(skillCooldownMultiplier);
    this.soul?.setDurationMultiplier(skillDurationMultiplier);
    if (this.soul) {
      const baseMaxSummons = requireSkillParam(this.character.skillK, 'maxSummons');
      // H28 魂灵游行：上限 +1，并缓慢跟随玩家。
      this.soul.setMaxSummons(
        resolveBomberSoulCapacity(
          baseMaxSummons,
          this.upgradeRun.stacksOf('W03') > 0 ? W03_MAX_SUMMONS - baseMaxSummons : 0,
          this.bomberHexes.has('H28'),
        ),
      );
      this.soul.setFollowPlayer(
        this.bomberHexes.has('H28'),
        this.bomberHexes.soulFollowSpeed,
        this.bomberHexes.soulFollowDistance,
      );
    }

    this.burst?.setCooldownMultiplier(
      skillCooldownMultiplier * this.stats.explosionSkillCooldownMultiplier,
    );
    this.burst?.setDurationMultiplier(skillDurationMultiplier);
    this.burst?.setAmmoUpgrade(this.upgradeRun.stacksOf('W04') > 0);
    // H27 三炮齐鸣：爆裂黎明每次启动后每第三发强化弹追加两枚小弹。
    this.burst?.setTripleShot(
      this.bomberHexes.has('H27'),
      BOMBER_HEX_PARAMS.H27.tripleShotEveryNth ?? 3,
    );
    this.amiya?.setCooldownMultiplier(skillCooldownMultiplier);
    this.amiya?.setDurationMultiplier(skillDurationMultiplier);
    // A02/H32 情绪吸收阈值、A03/H33 延迟追加连射、A04/H34 奇美拉时长与虚弱减速。
    // 旧强化与新海克斯是同效果的不同来源，按「或」合并，同时拥有不叠成两份。
    if (this.amiya) {
      const legacyA02 = (this.upgradeRun?.stacksOf('A02') ?? 0) > 0;
      const legacyA03 = (this.upgradeRun?.stacksOf('A03') ?? 0) > 0;
      const legacyA04 = (this.upgradeRun?.stacksOf('A04') ?? 0) > 0;
      const hasH32 = this.sorcererHexes.has('H32');
      const hasH33 = this.sorcererHexes.has('H33');
      const hasH34 = this.sorcererHexes.has('H34');
      this.amiya.setEmotionalAbsorptionHits(
        resolveEmotionalAbsorptionHits(
          EMOTIONAL_ABSORPTION_HITS,
          legacyA02 ? A02_HITS_PER_TRIGGER : null,
          hasH32,
        ),
      );
      this.amiya.setDoubleCast(legacyA03 || hasH33);
      this.amiya.setChimeraDuration(
        legacyA04 || hasH34
          ? resolveSorcererChimeraDuration(
              this.character.skillL.durationSeconds ??
                A04_CHIMERA_DURATION_SECONDS,
              legacyA04,
              hasH34,
            )
          : null,
      );
      this.amiya.setWeaknessSeconds(
        resolveSorcererWeaknessSeconds(
          requireSkillParam(this.character.skillL, 'weaknessSeconds'),
          hasH34,
        ),
      );
      // H36：奇美拉结束后 2 秒不能 J。
      this.amiya.setChimeraAftermathJLock(
        this.sorcererHexes.aftermathJLockSeconds,
      );
      this.amiya.setWeaknessSlowRemoved(
        legacyA04 && A04_WEAKNESS_SLOW_REMOVED,
      );
    }
    this.saria?.setCooldownMultiplier(skillCooldownMultiplier);
    this.saria?.setDurationMultiplier(skillDurationMultiplier);
    // S01–S04 的开关与数值全部从卡片 params 读取，满层/未拥有时回到基础规则。
    // H37/H38/H39 与旧强化 S01/S02/S03 同效果，按「或」合并后只调用一次 setter。
    const sariaS01 = (this.upgradeRun?.stacksOf('S01') ?? 0) > 0;
    const sariaS02 = (this.upgradeRun?.stacksOf('S02') ?? 0) > 0;
    const sariaS03 = (this.upgradeRun?.stacksOf('S03') ?? 0) > 0;
    const sariaS04 = (this.upgradeRun?.stacksOf('S04') ?? 0) > 0;
    const knightHealShock = resolveKnightHealShock(
      sariaS01,
      this.knightHexes.has('H37'),
    );
    this.saria?.setHealShock(
      knightHealShock?.ratio ?? 0,
      knightHealShock?.radius ?? S01_RADIUS,
    );
    this.saria?.setFieldDamagePerSecond(
      resolveKnightFieldDamage(sariaS02, this.knightHexes.has('H38')),
    );
    const knightShieldCounter = resolveKnightShieldCounter(
      sariaS03,
      this.knightHexes.has('H39'),
    );
    this.saria?.setShieldCounter(
      knightShieldCounter.enabled,
      knightShieldCounter.radius,
      knightShieldCounter.damage,
      knightShieldCounter.cooldownSeconds,
    );
    // H40 护盾获得量 −20%；H42 领域每秒护盾走同一个 SariaCombat 入口。
    this.saria?.setShieldGainMultiplier(this.knightHexes.shieldGainMultiplier);
    this.saria?.setFieldShieldPerSecond(this.knightHexes.fieldShieldPerSecond);
    this.saria?.setPassiveCooldownReduction(
      sariaS04
        ? S04_PASSIVE_COOLDOWN_REDUCTION_SECONDS
        : SARIA_PASSIVE_COOLDOWN_REDUCTION_SECONDS,
    );
    this.saria?.setFieldHealChain(
      sariaS04 ? S04_HEALS_PER_TRIGGER : 0,
      S04_COOLDOWN_REDUCTION_SECONDS,
    );
    this.muelsyse?.setCooldownMultiplier(skillCooldownMultiplier);
    this.muelsyse?.setDurationMultiplier(skillDurationMultiplier);
    // I19 召唤物伤害、I20 召唤物生命与每秒回复。
    this.muelsyse?.setSummonDamageMultiplier(this.stats.summonDamageMultiplier);
    this.muelsyse?.setSummonHealthMultiplier(this.stats.summonHealthMultiplier);
    const i20Stacks = this.itemInventory.stacksOf('I20');
    this.muelsyse?.setSummonRegenPercentPerSecond(
      (ITEM_EFFECT_PARAMS.I20.summonRegenPercentPerSecond ?? 0) * i20Stacks,
    );
    // M01–M04 与 H43–H45/H47 是同效果的不同来源，按「或」合并后只调用一次 setter。
    const muelsyseM01 = (this.upgradeRun?.stacksOf('M01') ?? 0) > 0;
    const muelsyseM02 = (this.upgradeRun?.stacksOf('M02') ?? 0) > 0;
    const muelsyseM03 = (this.upgradeRun?.stacksOf('M03') ?? 0) > 0;
    const muelsyseM04 = (this.upgradeRun?.stacksOf('M04') ?? 0) > 0;
    if (this.muelsyse) {
      const dualForm = resolveTacticianDualForm(
        {
          maxCopies: this.muelsyse.baseMaxCopies,
          maxMeleeStacks: this.muelsyse.baseMaxMeleeStacks,
        },
        muelsyseM01
          ? {
              maxCopies: M01_RANGED_MAX_COPIES,
              maxMeleeStacks: M01_MELEE_MAX_STACKS,
            }
          : null,
        this.tacticianHexes.has('H43'),
      );
      this.muelsyse.setDualForm(
        dualForm?.maxCopies ?? null,
        dualForm?.maxMeleeStacks ?? null,
      );
      const recovery = resolveTacticianEcologicalRecovery(
        muelsyseM02
          ? {
              healPercentPerSecond: M02_HEAL_PERCENT_PER_SECOND,
              healOnActivatePercent: M02_HEAL_ON_ACTIVATE_PERCENT,
            }
          : null,
        this.tacticianHexes.has('H44'),
      );
      this.muelsyse.setEcologicalRecovery(
        recovery?.healPercentPerSecond ?? 0,
        recovery?.healOnActivatePercent ?? 0,
      );
      const vortex = resolveTacticianAggregationVortex(
        muelsyseM03
          ? {
              pullRangeBonus: M03_PULL_RANGE_BONUS,
              rootBonusSeconds: M03_ROOT_BONUS_SECONDS,
            }
          : null,
        this.tacticianHexes.has('H45'),
      );
      this.muelsyse.setAggregationVortex(
        vortex?.pullRangeBonus ?? 0,
        vortex?.rootBonusSeconds ?? 0,
      );
      const waterMirror = resolveTacticianWaterMirror(
        muelsyseM04
          ? {
              damageRatio: M04_DAMAGE_RATIO,
              internalCooldownSeconds: M04_INTERNAL_COOLDOWN_SECONDS,
            }
          : null,
        this.tacticianHexes.has('H47'),
      );
      this.muelsyse.setWaterMirrorEcho(
        waterMirror?.damageRatio ?? 0,
        waterMirror?.internalCooldownSeconds ?? 0,
      );
      // H46 脆弱军团：召唤物伤害 +35%、生命上限 −25%。
      this.muelsyse.setTacticianSummonBonuses(
        this.tacticianHexes.summonDamageMultiplier,
        this.tacticianHexes.summonHealthMultiplier,
      );
      // H48 形态接力：切换成功后的 3 秒召唤物攻速窗口。
      this.muelsyse.setFormRelay(
        this.tacticianHexes.attackSpeedBonusRatio,
        this.tacticianHexes.attackSpeedBonusSeconds,
      );
    }
    // E04 的召唤物倍率与幻影开关同样走统一同步入口。
    this.syncCoreEffects();
    // I17 经验吸取半径；击杀金币与完成奖励在结算点读取倍率。
    this.progression.setPickupRadiusMultiplier(this.stats.xpRadiusMultiplier);
    // H23 药剂效果 +30%；购买时快照进该层，之后获得/失去不再改写已购层数。
    this.consumables.setModifiers(this.hexEffects.potionModifiers);
    // H10 击杀经验 −10%；经验球生成时按当前倍率结算一次。
    this.progression.setXpGainMultiplier(this.hexEffects.killXpMultiplier);
    this.syncMoveSpeed();
  }

  /** G02 移速与奇美拉虚弱的 −25% 共用同一个运动倍率入口，最终钳制到 0.6–1.6。 */
  private syncMoveSpeed(): void {
    this.motion.setMoveSpeedMultiplier(
      clampMoveSpeedMultiplier(
        this.stats.moveSpeedMultiplier * (this.amiya?.moveSpeedMultiplier ?? 1),
      ),
    );
  }

  /** 构筑面板：已获得强化与永久道具的层数/实效，数值与战斗结算同源。 */
  private updateBuildHud(): void {
    if (!this.buildHud || !this.upgradeRun) return;
    const owned = this.upgradeRun.ownedIds();
    const items = this.itemInventory.snapshot();
    const crafted = this.craftedInventory.snapshot();
    if (owned.length === 0 && items.length === 0 && crafted.length === 0) {
      this.buildHud.setText('构筑\n暂无强化');
      return;
    }

    const lines = [
      `构筑（强化 ${owned.length} · 道具 ${items.length} · 成品 ${crafted.length}）`,
    ];
    for (const id of owned) {
      const card = UPGRADE_LIST.find((entry) => entry.id === id);
      if (!card) continue;
      const stacks = this.upgradeRun.stacksOf(id);
      lines.push(`${card.id} ${card.name} ×${stacks} · ${describeUpgradeEffect(id, stacks)}`);
    }
    const sustainedSkillIds = this.equippedFreeSkillIds();
    for (const entry of items) {
      const item = getShopItem(entry.id);
      if (!item) continue;
      const effect = describeItemEffect(entry.id, entry.stacks, {
        sustainedSkillIds,
      });
      lines.push(
        `${item.id} ${item.name} ×${entry.stacks}${effect ? ` · ${effect}` : ''}`,
      );
    }
    for (const recipeId of crafted) {
      const description = describeCraftedItem(recipeId);
      if (!description) continue;
      const effects = [
        ...description.statModifiers
          .filter((modifier) => Number.isFinite(modifier.value) && modifier.value !== 0)
          .map((modifier) => {
            const value =
              modifier.mode === 'percent'
                ? `${Math.round(modifier.value * 100)}%`
                : `${modifier.value}`;
            const sign = modifier.value > 0 ? '+' : '';
            return `${statLabel(modifier.stat)} ${sign}${value}`;
          }),
        ...description.mechanics,
      ];
      // R01 的击杀成长是动态数值，构筑面板直接显示当前值与上限。
      if (recipeId === 'R01') {
        effects.push(
          `成长 +${hudValue(this.craftedEffects.r01Growth)}/${hudValue(R01_GROWTH_CAP)}`,
        );
      }
      // R02 的持续伤害增益只在持续类技能上兑现，摘要写明当前是否有来源。
      if (recipeId === 'R02') {
        effects.push(sustainedChannelNote(sustainedSkillIds));
      }
      lines.push(
        `${recipeId} ${description.name}${effects.length > 0 ? ` · ${effects.join(' / ')}` : ''}`,
      );
    }
    this.buildHud.setText(lines.join('\n'));
  }

  /** 单一 HUD 事件入口：更新纯状态并重绘所有字段。 */
  private dispatchHud(event: HudEvent): void {
    if (!this.hudState) return;
    this.hudState = applyHudEvent(this.hudState, event);
    this.refreshHud();
  }

  /** 把纯 HUD 模型写到顶部文本、底部技能条与角色资源行。 */
  private refreshHud(): void {
    if (!this.hudReady || !this.hudState) return;
    const model = buildHudModel(this.hudState);
    this.targetHud.setText(model.lines.target);
    this.healthHud.setText(model.lines.vitals);
    this.waveHud.setText(`${model.lines.wave}\n${model.lines.progress}`);
    this.killHud.setText(`${model.lines.kills} · ${model.lines.gold}`);
    this.dodgeHud.setText(model.lines.dodge);
    this.ammoHud
      .setText(model.lines.resource)
      .setColor(model.resourceColor)
      .setVisible(this.hudState.resource.length > 0);
    this.chimeraHud
      .setText(model.lines.skillDetail)
      .setColor(model.skillDetailColor)
      .setVisible(model.lines.skillDetail.length > 0);
    this.refreshSkillBar(model);
    this.refreshDodgeSlot(model);
    this.refreshFreeSkillBar();
  }

  /**
   * 战斗内短提示：顶部居中短句，不弹窗、不暂停、不占用输入。
   * 同一时刻最多显示 HUD_TOAST.maxVisible 条，到达持续时间后淡出。
   */
  private showHudToast(kind: HudToastKind, text: string): void {
    if (!this.hudReady) return;
    const next = pushHudToast(
      this.hudToasts,
      { kind, text },
      this.simulatedSeconds,
      this.nextHudToastId,
    );
    // pushHudToast 对空白文本返回原引用，此时不推进 ID 也不重绘。
    if (next === this.hudToasts) return;
    this.nextHudToastId += 1;
    this.hudToasts = next;
    this.refreshHudToasts();
  }

  /** 按模拟秒推进短提示的淡出与上移，并回收已消失的文本对象。 */
  private refreshHudToasts(): void {
    if (!this.hudReady) return;
    const views = hudToastViews(this.hudToasts, this.simulatedSeconds);
    const live = new Set<number>();
    for (const view of views) {
      const { toast } = view;
      live.add(toast.id);
      let text = this.hudToastTexts.get(toast.id);
      if (!text) {
        text = this.add
          .text(VIEWPORT.width / 2, HUD_TOAST.topY, '', {
            fontFamily: 'monospace',
            fontSize: `${HUD_FONT_PX.small}px`,
            color: HUD_TOAST_COLORS[toast.kind],
            stroke: '#181018',
            strokeThickness: 3,
          })
          .setOrigin(0.5, 0)
          .setScrollFactor(0)
          .setDepth(52);
        this.hudToastTexts.set(toast.id, text);
      }
      text
        .setText(toast.text)
        .setPosition(VIEWPORT.width / 2, view.y)
        .setAlpha(view.alpha);
    }
    for (const [id, text] of this.hudToastTexts) {
      if (live.has(id)) continue;
      text.destroy();
      this.hudToastTexts.delete(id);
    }
    // 队列里已过期的条目同步清掉，避免长时间不显示时数组无限增长。
    this.hudToasts = views.map((view) => view.toast);
  }

  /**
   * 暂停/商店/奖励面板关闭后，用各系统当前值整体重写 HUD。
   * 面板期间逻辑步冻结，恢复时统一刷新，避免显示暂停前的旧金币/护盾/冷却/倒计时。
   */
  private resyncHudFromSystems(): void {
    if (!this.hudReady) return;
    this.syncHealthHud();
    this.updateWaveHud();
    this.syncSkillHud();
    this.syncBurstHud();
    this.syncChimeraHud();
    this.refreshHudToasts();
  }

  /** 底部技能条的固定槽位；图标形状与配色来自 HUD 模块。 */
  private createHudBar(): void {
    const layout = computeHudSkillBarLayout();
    const bindings = this.settingsStore.get().keyBindings;
    const views = {} as Record<HudSkillKey, HudBarSlotView>;
    for (const key of ['J', 'K', 'L'] as const) {
      const icon = hudSkillIcon(this.character.id, key);
      views[key] = this.createHudBarSlot(
        layout.slots[key],
        this.hudBadgeLabel(this.skillKeyCode(key, bindings)),
        icon.shape,
        icon.color,
        icon.label,
      );
    }
    this.skillSlotViews = views;
    this.dodgeSlotView = this.createHudBarSlot(
      layout.dodge,
      this.hudBadgeLabel(bindings.dodge),
      'field',
      0xcfe8ff,
      '#cfe8ff',
    );
    this.createFreeSkillHudBar(bindings);
  }

  /**
   * 自由技能两槽条：U/I 徽标、图标、技能名、效果说明与冷却。
   * 图标按技能 ID 重绘，替换后不需要重建 HUD。
   */
  private createFreeSkillHudBar(bindings: KeyBindings): void {
    const layout = computeHudFreeSkillBarLayout();
    const views = {} as Record<FreeSkillSlotKey, HudBarSlotView>;
    for (const key of FREE_SKILL_SLOT_KEYS) {
      const rect = layout.slots[key];
      const badgeLabel = this.hudBadgeLabel(
        key === 'U' ? bindings.skillU : bindings.skillI,
      );
      const background = this.add
        .rectangle(rect.x, rect.y, rect.width, rect.height, 0x0d0b12, 0.72)
        .setOrigin(0, 0)
        .setStrokeStyle(1.5, 0x7d738c, 0.6);
      const badge = this.add.graphics();
      badge
        .fillStyle(0x7d738c, 0.18)
        .fillRoundedRect(rect.x + 8, rect.y + 8, 30, 30, 6)
        .lineStyle(1.5, 0x7d738c, 0.85)
        .strokeRoundedRect(rect.x + 8, rect.y + 8, 30, 30, 6);
      const badgeText = this.add
        .text(rect.x + 23, rect.y + 23, badgeLabel, {
          fontFamily: 'monospace',
          fontSize: `${this.hudBadgeFontSize(badgeLabel)}px`,
          color: '#a99fb7',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      const icon = this.add.graphics();
      const artIcon = this.add.image(rect.x + 50, rect.y + 25, 'item-art-spell').setDisplaySize(30, 30).setAlpha(0.35);
      const nameText = this.add.text(rect.x + 64, rect.y + 5, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_SKILL_BAR.nameFontSize}px`,
        color: '#f4ead2',
        stroke: '#181018',
        strokeThickness: 3,
        wordWrap: { width: rect.width - 72, useAdvancedWrap: true },
      });
      const detailText = this.add.text(rect.x + 64, rect.y + 22, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.micro}px`,
        color: '#b9b0a4',
        stroke: '#181018',
        strokeThickness: 2,
        wordWrap: { width: rect.width - 72, useAdvancedWrap: true },
      });
      const statusText = this.add.text(rect.x + 64, rect.y + 51, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_SKILL_BAR.statusFontSize}px`,
        color: '#cfc4b6',
        stroke: '#181018',
        strokeThickness: 3,
        wordWrap: { width: rect.width - 72, useAdvancedWrap: true },
      });
      const cooldownTrack = this.add
        .rectangle(rect.x + 8, rect.y + 74, rect.width - 16, 4, 0x2a2333, 0.9)
        .setOrigin(0, 0.5);
      const cooldownFill = this.add
        .rectangle(rect.x + 8, rect.y + 74, rect.width - 16, 4, 0x7d738c, 0.95)
        .setOrigin(0, 0.5);
      this.freeSkillBar.add([
        background,
        badge,
        badgeText,
        icon,
        artIcon,
        nameText,
        detailText,
        statusText,
        cooldownTrack,
        cooldownFill,
      ]);
      views[key] = {
        background,
        badge,
        badgeText,
        icon,
        artIcon,
        nameText,
        statusText,
        detailText,
        cooldownTrack,
        cooldownFill,
        rect,
        iconSkillId: '',
      };
    }
    this.freeSkillSlotViews = views;
    this.refreshFreeSkillBar();
  }

  /** 每步刷新自由技能槽：冷却、名称、说明与图标。 */
  private refreshFreeSkillBar(): void {
    const views = this.freeSkillSlotViews;
    if (!views) return;
    for (const key of FREE_SKILL_SLOT_KEYS) {
      const view = views[key];
      const stack = this.freeSkills.slotAt(key);
      const definition = this.freeSkills.definitionAt(key);
      const remaining = this.freeSkills.cooldownRemaining(key);
      const total = this.freeSkills.baseCooldown(key);
      const empty = !stack || !definition;
      const icon = definition
        ? hudFreeSkillIcon(definition.id)
        : { shape: 'spark' as const, color: 0x7d738c, label: '#a99fb7' };
      const skillKey = stack?.id ?? '';
      if (view.iconSkillId !== skillKey) {
        view.iconSkillId = skillKey;
        const rect = view.rect;
        if (rect) {
          view.icon.clear();
          view.artIcon?.setTexture(`item-art-${skillKey || 'spell'}`).setAlpha(empty ? 0.3 : 1);
          view.background.setStrokeStyle(1.5, icon.color, empty ? 0.35 : 0.7);
          view.badge.clear();
          view.badge
            .fillStyle(icon.color, 0.18)
            .fillRoundedRect(rect.x + 8, rect.y + 8, 30, 30, 6)
            .lineStyle(1.5, icon.color, 0.85)
            .strokeRoundedRect(rect.x + 8, rect.y + 8, 30, 30, 6);
          view.badgeText.setColor(icon.label);
        }
      }
      const name = empty
        ? `自由技能 ${key}`
        : `${definition.name}${stack && stack.level > 1 ? ` Lv${stack.level}` : ''}`;
      view.nameText.setText(name);
      view.detailText?.setText(
        empty ? '在商店购买并装备' : definition.effect,
      );
      // 通用海克斯的短状态：H01 首施、H08 银行、H06 滑步、H16 可连携。
      const hexNotes: string[] = [];
      if (this.combatHexes.has('H01')) {
        hexNotes.push(this.combatHexes.firstFreeCastAvailable(key) ? '免费' : '已用');
      }
      if (this.combatHexes.has('H08') && this.combatHexes.bankCharges > 0) {
        hexNotes.push(`银行${this.combatHexes.bankCharges}`);
      }
      if (
        this.combatHexes.has('H06') &&
        this.combatHexes.dodgeAttackBuffRemaining > 0
      ) {
        hexNotes.push('滑步');
      }
      if (
        this.combatHexes.has('H16') &&
        this.combatHexes.lastCastSlot !== null &&
        this.combatHexes.lastCastSlot !== key
      ) {
        hexNotes.push('连携');
      }
      view.statusText
        .setText(
          `${freeSkillStatusText(empty, remaining)}${
            hexNotes.length > 0 ? ` · ${hexNotes.join(' ')}` : ''
          }`,
        )
        .setColor(empty ? '#7d738c' : remaining > 0 ? '#d8cec0' : '#9be7a4');
      const progress = total > 0 ? Math.max(0.001, Math.min(1, 1 - remaining / total)) : 0;
      view.cooldownFill
        .setFillStyle(icon.color, 0.95)
        .setScale(progress, 1);
    }
  }

  private createHudBarSlot(
    rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
    badgeLabel: string,
    shape: ReturnType<typeof hudSkillIcon>['shape'],
    color: number,
    label: string,
  ): HudBarSlotView {
    const background = this.add
      .rectangle(rect.x, rect.y, rect.width, rect.height, 0x0d0b12, 0.72)
      .setOrigin(0, 0)
      .setStrokeStyle(1.5, color, 0.6);
    const badge = this.add.graphics();
    badge
      .fillStyle(color, 0.18)
      .fillRoundedRect(rect.x + 8, rect.y + 8, 30, 30, 6)
      .lineStyle(1.5, color, 0.85)
      .strokeRoundedRect(rect.x + 8, rect.y + 8, 30, 30, 6);
    const badgeText = this.add
      .text(rect.x + 23, rect.y + 23, badgeLabel, {
        fontFamily: 'monospace',
        fontSize: `${this.hudBadgeFontSize(badgeLabel)}px`,
        color: label,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const icon = this.add.graphics();
    const iconId = shape === 'shield' ? 'S07' : shape === 'field' ? 'dash' : shape === 'shell' ? 'grenade' : shape === 'wave' || shape === 'drop' ? 'S09' : 'spell';
    const artIcon = this.add.image(rect.x + 50, rect.y + 25, `item-art-${iconId}`).setDisplaySize(30, 30);
    const nameText = this.add.text(rect.x + 64, rect.y + 8, '', {
      fontFamily: 'monospace',
      fontSize: `${HUD_SKILL_BAR.nameFontSize}px`,
      color: '#f4ead2',
      stroke: '#181018',
      strokeThickness: 3,
      wordWrap: { width: rect.width - 72, useAdvancedWrap: true },
    });
    const statusText = this.add.text(rect.x + 64, rect.y + 31, '', {
      fontFamily: 'monospace',
      fontSize: `${HUD_SKILL_BAR.statusFontSize}px`,
      color: '#cfc4b6',
      stroke: '#181018',
      strokeThickness: 3,
      wordWrap: { width: rect.width - 72, useAdvancedWrap: true },
    });
    const cooldownTrack = this.add
      .rectangle(rect.x + 8, rect.y + 52, rect.width - 16, 4, 0x2a2333, 0.9)
      .setOrigin(0, 0.5);
    const cooldownFill = this.add
      .rectangle(rect.x + 8, rect.y + 52, rect.width - 16, 4, color, 0.95)
      .setOrigin(0, 0.5);
    this.skillBar.add([
      background,
      badge,
      badgeText,
      icon,
      artIcon,
      nameText,
      statusText,
      cooldownTrack,
      cooldownFill,
    ]);
    return {
      background,
      badge,
      badgeText,
      icon,
      artIcon,
      nameText,
      statusText,
      cooldownTrack,
      cooldownFill,
      rect,
    };
  }

  private skillKeyCode(key: HudSkillKey, bindings: KeyBindings): string {
    if (key === 'J') return bindings.attack;
    if (key === 'K') return bindings.skillK;
    return bindings.skillL;
  }

  /** 徽标只保留可辨识的短键名；完整绑定仍由顶部快捷键提示说明。 */
  private hudBadgeLabel(code: string): string {
    const label = keyCodeLabel(code);
    if (label.length <= 2) return label;
    if (label.includes('Shift')) return 'Shift';
    if (label.includes('Ctrl')) return 'Ctrl';
    if (label.includes('Alt')) return 'Alt';
    if (label.startsWith('小键盘')) return label.slice(-1);
    return label.slice(0, 2);
  }

  private hudBadgeFontSize(label: string): number {
    if (label.length <= 1) return 17;
    if (label.length === 2) return 14;
    return HUD_FONT_PX.micro;
  }

  /** 重绑后立即更新键帽，不必重开本局。 */
  private updateSkillKeyLabels(bindings: KeyBindings): void {
    const views = this.skillSlotViews;
    if (views) {
      for (const key of ['J', 'K', 'L'] as const) {
        const label = this.hudBadgeLabel(this.skillKeyCode(key, bindings));
        views[key].badgeText
          .setText(label)
          .setFontSize(this.hudBadgeFontSize(label));
      }
    }
    if (this.dodgeSlotView) {
      const label = this.hudBadgeLabel(bindings.dodge);
      this.dodgeSlotView.badgeText
        .setText(label)
        .setFontSize(this.hudBadgeFontSize(label));
    }
    const freeViews = this.freeSkillSlotViews;
    if (freeViews) {
      for (const key of FREE_SKILL_SLOT_KEYS) {
        const code = key === 'U' ? bindings.skillU : bindings.skillI;
        const label = this.hudBadgeLabel(code);
        freeViews[key].badgeText
          .setText(label)
          .setFontSize(this.hudBadgeFontSize(label));
      }
    }
  }

  private refreshSkillBar(model: HudModel): void {
    const views = this.skillSlotViews;
    if (!views) return;
    for (const view of model.skills) {
      const slot = views[view.key];
      const statusColor =
        view.status === 'ready'
          ? '#9be7a4'
          : view.status === 'active'
            ? view.icon.label
            : view.status === 'locked'
              ? '#ff8a8a'
              : view.status === 'empty'
                ? '#7d738c'
                : '#d8cec0';
      slot.nameText.setText(view.name);
      slot.statusText.setText(view.statusText).setColor(statusColor);
      slot.background.setStrokeStyle(
        1.5,
        view.icon.color,
        view.status === 'ready' ? 0.35 : 0.7,
      );
      slot.cooldownFill
        .setFillStyle(view.icon.color, 0.95)
        .setScale(Math.max(0.001, view.progress), 1);
    }
  }

  private refreshDodgeSlot(model: HudModel): void {
    const slot = this.dodgeSlotView;
    if (!slot) return;
    const ready = model.dodge.cooldownRemaining <= 0;
    slot.nameText.setText('闪避');
    slot.statusText
      .setText(model.dodge.statusText)
      .setColor(ready ? '#9be7a4' : '#d8cec0');
    slot.background.setStrokeStyle(1.5, 0xcfe8ff, ready ? 0.35 : 0.7);
    slot.cooldownFill
      .setFillStyle(0xcfe8ff, 0.95)
      .setScale(Math.max(0.001, model.dodge.progress), 1);
  }

  /** 每个逻辑步同步 J/K/L 冷却与闪避冷却；暂停时不推进也不刷新。 */
  private syncSkillHud(): void {
    if (!this.hudState) return;
    for (const skill of this.currentHudSkills()) {
      this.dispatchHud({ type: 'skill', skill });
    }
    this.dispatchHud({
      type: 'dodge',
      cooldownRemaining: this.motion?.dodgeCooldownRemaining ?? 0,
      // E07 低血时实际冷却更短，进度条按同一倍率显示。
      cooldownTotal:
        DODGE.cooldownSeconds * this.coreEffects.dodgeCooldownMultiplier,
    });
    this.refreshFreeSkillBar();
  }

  private currentHudSkills(): HudSkillState[] {
    const attack = this.character.attack;
    const attackRemaining = this.attackTimer?.cooldownRemaining ?? 0;
    const fatigued = this.amiya?.isJFiringLocked ?? false;
    const j: HudSkillState = {
      key: 'J',
      name: attack.name,
      status: fatigued ? 'locked' : attackRemaining > 0 ? 'cooldown' : 'ready',
      cooldownRemaining: attackRemaining,
      cooldownTotal: attack.intervalSeconds,
      effectRemaining: fatigued ? (this.amiya?.jFiringLockRemaining ?? 0) : 0,
      detail: fatigued
        ? (this.amiya?.chimeraJLockRemaining ?? 0) > 0
          ? '失控'
          : '疲劳'
        : '',
    };

    const kTotal = this.character.skillK.cooldownSeconds;
    let k: HudSkillState;
    if (this.amiya?.isBurstActive) {
      k = {
        key: 'K',
        name: this.character.skillK.name,
        status: 'active',
        cooldownRemaining: 0,
        cooldownTotal: kTotal,
        effectRemaining: 0,
        detail: `连射 ${this.amiya.shotsFiredInBurst}/${this.amiya.totalShotsPerBurst}`,
      };
    } else if (this.kCooldownRemaining() > 0) {
      k = {
        key: 'K',
        name: this.character.skillK.name,
        status: 'cooldown',
        cooldownRemaining: this.kCooldownRemaining(),
        cooldownTotal: kTotal,
        effectRemaining: 0,
        detail: '',
      };
    } else {
      k = {
        key: 'K',
        name: this.character.skillK.name,
        status: 'ready',
        cooldownRemaining: 0,
        cooldownTotal: kTotal,
        effectRemaining: 0,
        detail: this.muelsyse && !this.muelsyse.isFormAlive ? '重建' : '',
      };
    }

    const lTotal = this.character.skillL.cooldownSeconds;
    const lBase = {
      key: 'L' as const,
      name: this.character.skillL.name,
      cooldownTotal: lTotal,
      detail: '',
    };
    let l: HudSkillState;
    if (this.amiya?.isChimeraActive) {
      l = {
        ...lBase,
        status: 'active',
        cooldownRemaining: 0,
        effectRemaining: this.amiya.chimeraRemaining,
        detail: '真伤',
      };
    } else if (this.amiya?.isWeaknessActive) {
      l = {
        ...lBase,
        status: 'locked',
        cooldownRemaining: 0,
        effectRemaining: this.amiya.weaknessRemaining,
        detail: '虚弱',
      };
    } else if (this.saria?.isCalciumFieldActive) {
      l = {
        ...lBase,
        status: 'active',
        cooldownRemaining: 0,
        effectRemaining: this.saria.calciumFieldRemaining,
        detail: '领域',
      };
    } else if (this.muelsyse?.isShallowAdaptationActive) {
      l = {
        ...lBase,
        status: 'active',
        cooldownRemaining: 0,
        effectRemaining: this.muelsyse.shallowAdaptationRemaining,
        detail: this.muelsyse.form === 'melee' ? '拉拽' : '束缚',
      };
    } else if (this.burst && this.burst.ammoRemaining > 0) {
      l = {
        ...lBase,
        status: 'active',
        cooldownRemaining: 0,
        effectRemaining: this.burst.ammoExpiresInSeconds,
        detail: `弹药 ${this.burst.ammoRemaining}/${this.burst.maxAmmo}`,
      };
    } else {
      const remaining = this.lCooldownRemaining();
      l = {
        ...lBase,
        status: remaining > 0 ? 'cooldown' : 'ready',
        cooldownRemaining: remaining,
        effectRemaining: 0,
        detail: '',
      };
    }

    return [j, k, l];
  }

  /** 角色专属资源行：数值旁始终有文字标签。 */
  private characterResourceText(): { text: string; color: string } {
    const amiya = this.amiya;
    if (amiya) {
      return {
        text: `情绪吸收 ${amiya.emotionalAbsorptionProgress}/${amiya.emotionalAbsorptionThreshold}`,
        color: '#a8d8ff',
      };
    }
    const saria = this.saria;
    if (saria) {
      const shield = hudValue(this.playerHealth.shield);
      const remaining = saria.isShieldActive
        ? `（${saria.shieldRemaining.toFixed(1)}s）`
        : '';
      return {
        text: `护盾 ${shield}${remaining} · 精神回复 ${saria.passiveTriggerCount} 次`,
        color: '#ffe9a8',
      };
    }
    const muelsyse = this.muelsyse;
    if (muelsyse) {
      if (!muelsyse.isFormAlive) {
        return { text: '流形已消散 · K 重建', color: '#ff8a8a' };
      }
      const formName = muelsyse.form === 'melee' ? '近战流形' : '远程流形';
      const extra =
        muelsyse.form === 'melee'
          ? ` · 窃取 ${muelsyse.formStacks}/${muelsyse.maxMeleeStacks}`
          : ` · 副本 ${muelsyse.copyCount}/${muelsyse.maxCopies}`;
      return {
        text: `${formName} ${hudValue(muelsyse.formHealth)}/${muelsyse.formMaxHealth}${extra}`,
        color: '#9df2dd',
      };
    }
    if (this.soul) {
      const ammo =
        this.burst && this.burst.ammoRemaining > 0
          ? ` · 爆裂弹药 ${this.burst.ammoRemaining}/${this.burst.maxAmmo}`
          : '';
      return {
        text: `魂灵 ${this.soul.soulCount}/${this.soul.maxSummons}${ammo}`,
        color: '#ffb347',
      };
    }
    return { text: '', color: '#cfc4b6' };
  }

  /** 长状态说明：只在有生效/锁定窗口时显示，避免与技能条重复。 */
  private characterSkillDetail(): { text: string; color: string } {
    const amiya = this.amiya;
    if (amiya) {
      if (amiya.isChimeraActive) {
        const bonusPercent = Math.round(
          (this.character.skillL.params?.damageBonus ?? 0) * 100,
        );
        return {
          text: `奇美拉 · 真实伤害 +${bonusPercent}% · 结束进入虚弱`,
          color: '#a8d8ff',
        };
      }
      if (amiya.isWeaknessActive) {
        return {
          text: `奇美拉虚弱 · 移速 ×0.75 · 不能 K/L`,
          color: '#ff8a8a',
        };
      }
      return { text: '', color: '#cfc4b6' };
    }

    const saria = this.saria;
    if (saria?.isCalciumFieldActive) {
      const slowPercent = Math.round(saria.enemySlowPercent * 100);
      const magicPercent = Math.round(saria.enemyMagicVulnerability * 100);
      return {
        text: `钙质化领域 · 减速 ${slowPercent}% · 法伤 +${magicPercent}%`,
        color: '#ffd166',
      };
    }

    const muelsyse = this.muelsyse;
    if (muelsyse?.isShallowAdaptationActive) {
      return {
        text:
          muelsyse.form === 'melee'
            ? '浅层非熵适应 · 拉拽并眩晕敌人'
            : '浅层非熵适应 · 命中束缚目标',
        color: '#9df2dd',
      };
    }

    const burst = this.burst;
    if (burst && burst.ammoRemaining > 0) {
      return { text: burstHudText(burst), color: '#ffd166' };
    }
    return { text: '', color: '#cfc4b6' };
  }

  private updateWaveHud(): void {
    const progression = this.progression;
    const alive = this.enemySystem.enemies.reduce(
      (total, unit) => (unit.combatant.isAlive ? total + 1 : total),
      0,
    );
    const runner = this.waveRunner;
    this.dispatchHud({
      type: 'progression',
      level: progression.level,
      experience: progression.experience,
      experienceToNextLevel: progression.experienceToNextLevel,
    });
    this.dispatchHud({
      type: 'wave',
      wave: this.waveNumber,
      kills: this.killCount,
      aliveEnemies: alive,
      // Boss 波没有倒计时；无波次（波间/结算）时清空计时字段。
      remainingSeconds: runner?.hasTimeLimit ? runner.remainingSeconds : null,
      unlimited: runner ? !runner.hasTimeLimit : false,
    });
    this.dispatchHud({ type: 'gold', gold: this.economy.gold });
  }

  /** 经验球：普通绿色、精英金色，进入吸取半径后立即结算。 */
  private createXpOrbVisual(orb: ExperienceOrb): void {
    const sprite = this.add
      .circle(orb.x, orb.y, orb.isElite ? 6 : 4, orb.isElite ? 0xffd166 : 0x7ee787)
      .setStrokeStyle(1.5, 0xf4ead2, 0.85)
      .setDepth(5);
    this.xpOrbViews.set(orb.id, sprite);
  }

  private removeXpOrb(orbId: number): void {
    const sprite = this.xpOrbViews.get(orbId);
    if (!sprite) return;
    this.xpOrbViews.delete(orbId);
    sprite.destroy();
  }

  /** 出生提示：红色圆环由小放大，配合中心点，落地后移除。 */
  private createSpawnTelegraph(telegraph: EnemySpawnTelegraph): void {
    const radius =
      (telegraph.enemy.behavior === 'boss' ? BOSS_RADIUS : ENEMY_RADIUS) + 6;
    const ring = this.add
      .circle(telegraph.x, telegraph.y, radius, ENEMY_WARNING.fill, 0.16)
      .setStrokeStyle(2, ENEMY_WARNING.stroke, 0.9)
      .setDepth(ENEMY_WARNING.depth)
      .setScale(0.4);
    const cross = this.add
      .circle(telegraph.x, telegraph.y, 3, ENEMY_WARNING.core, 0.9)
      .setDepth(ENEMY_WARNING.depth);
    this.tweens.add({
      targets: ring,
      scale: 1,
      duration: SPAWN_TELEGRAPH_SECONDS * 1000,
      ease: 'Quad.easeIn',
    });
    this.telegraphViews.set(telegraph.id, { telegraph, ring, cross });
  }

  private removeSpawnTelegraph(telegraphId: string): void {
    const view = this.telegraphViews.get(telegraphId);
    if (!view) return;
    this.telegraphViews.delete(telegraphId);
    this.tweens.killTweensOf(view.ring);
    view.ring.destroy();
    view.cross.destroy();
  }

  /** 敌人落地后建立视觉；颜色按行为区分，冲锋预警用红环。 */
  private createEnemyView(unit: EnemyUnit): void {
    const x = unit.combatant.x;
    const y = unit.combatant.y;
    const isBoss = unit.enemy.behavior === 'boss';
    const color = unit.enemy.elite ? 0xffdfa1 : [0xffffff, 0xe7f0ff, 0xffebd4][unit.id.length % 3]!;
    const visualSize = isBoss ? 156 : unit.enemy.id === 'larva' ? 29 : Math.max(44, unit.radius * 3.3);
    const marker = enemyMarkerFor({
      behavior: unit.enemy.behavior,
      name: unit.enemy.name,
      elite: unit.enemy.elite === true,
      markerGlyph: unit.enemy.markerGlyph,
    });
    const label = `${marker.glyph} ${marker.label}`;
    const shadow = this.add
      .ellipse(x, y + unit.radius - 2, isBoss ? 64 : 26, isBoss ? 20 : 9, 0x000000, 0.35)
      .setDepth(3);
    const body = this.add
      .sprite(x, y + unit.radius * 0.45, `enemy-art-${unit.enemy.id}`)
      .setOrigin(0.5, 0.72)
      .setDisplaySize(visualSize, visualSize)
      .setTint(color)
      .setDepth(4);
    const hpY = y - unit.radius - 12;
    const hpWidth = isBoss ? 140 : 44;
    const hpBackground = this.add
      .rectangle(x, hpY, hpWidth, isBoss ? 9 : 6, 0x261d26)
      .setDepth(5);
    const hpFill = this.add
      .rectangle(x - hpWidth / 2, hpY, hpWidth, isBoss ? 9 : 6, isBoss ? 0xff5a3c : 0xe05a5a)
      .setOrigin(0, 0.5)
      .setDepth(5);
    const nameText = this.add
      .text(x, y + unit.radius + 8, label, {
        fontFamily: 'monospace',
        fontSize: isBoss ? '14px' : '11px',
        color: isBoss ? '#ffd7c9' : '#f4ead2',
        stroke: '#181018',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setDepth(5);
    const statusText = this.add
      .text(x, hpY - 12, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#d8b4fe',
        stroke: '#181018',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(6)
      .setVisible(false);
    const windupRingRadius =
      unit.enemy.behavior === 'explode'
        ? BOMBER_EXPLOSION_RADIUS
        : unit.radius + 16;
    const windupRing = this.add
      .circle(x, y, windupRingRadius, ENEMY_WARNING.fill, 0.12)
      .setStrokeStyle(2, ENEMY_WARNING.stroke, 0.9)
      .setDepth(ENEMY_WARNING.depth)
      .setVisible(false);
    // 普通蓄力攻击的方向线：冲锋猪/喷菇在预警期间把攻击方向画出来，
    // 与纯逻辑层锁定的方向一致，不只靠颜色变化提示危险。
    const warningLine =
      unit.enemy.behavior === 'charge' || unit.enemy.behavior === 'spit'
        ? this.add
            .line(0, 0, 0, 0, 1, 0, ENEMY_WARNING.stroke, 0.9)
            .setOrigin(0, 0)
            .setLineWidth(3)
            .setDepth(ENEMY_WARNING.depth)
            .setVisible(false)
        : null;
    // 盾壳蟹弱点：朝向背面画一条线段并标注“弱点”，玩家据此绕后。
    const isBulwark = unit.enemy.id === 'bulwark';
    const weakPointLine = isBulwark
      ? this.add
          .line(0, 0, 0, 0, 1, 0, 0xffd166, 0.95)
          .setOrigin(0, 0)
          .setLineWidth(3)
          .setDepth(ENEMY_WARNING.depth)
      : null;
    const weakPointLabel = isBulwark
      ? this.add
          .text(x, y, '弱点', {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#ffd166',
            stroke: '#181018',
            strokeThickness: 3,
          })
          .setOrigin(0.5)
          .setDepth(ENEMY_WARNING.depth)
      : null;
    // Boss 横向冲锋的整行预警带：预警期间显示，冲刺结束后隐藏。
    const chargeWarning = isBoss
      ? this.add
          .rectangle(ARENA.width / 2, y, ARENA.width - 64, 6, ENEMY_WARNING.fill, 0.16)
          .setDepth(ENEMY_WARNING.depth)
          .setVisible(false)
      : null;

    // 普通敌人不常驻血条/名称；精英与 Boss 从出生即保留。
    const alwaysShowHud = isBoss || unit.enemy.elite === true;
    hpBackground.setVisible(alwaysShowHud);
    hpFill.setVisible(alwaysShowHud);
    nameText.setVisible(alwaysShowHud);

    this.enemies.push({
      unit,
      label,
      body,
      baseColor: color,
      visualSize,
      shadow,
      hpBackground,
      hpFill,
      hpWidth,
      nameText,
      statusText,
      windupRing,
      warningLine,
      weakPointLine,
      weakPointLabel,
      chargeWarning,
      lastHealth: unit.combatant.health.health,
      revealRemaining: 0,
    });
  }

  /** 生成宝箱视图：色块箱体、血条与裂纹；不加入敌人列表，避免击杀奖励链误触。 */
  private spawnChest(chest: Chest): void {
    this.clearWaveChest();
    const { x, y } = chest;
    const shadow = this.add
      .ellipse(x, y + 12, 38, 14, 0x000000, 0.32)
      .setDepth(2);
    const body = this.add
      .image(x, y, 'illustrated-chest')
      .setDisplaySize(52, 52)
      .setOrigin(0.5, 0.65)
      .setDepth(4);
    const lid = this.add
      .rectangle(x, y - 10, CHEST_RADIUS * 2 + 2, 8, 0xe0b25c, 0)
      .setStrokeStyle(0, 0x5b3a1d)
      .setDepth(5);
    const hpBackground = this.add
      .rectangle(x, y - 26, 42, 6, 0x2a1620, 0.85)
      .setDepth(6);
    const hpFill = this.add
      .rectangle(x - 21, y - 26, 42, 6, 0x7bd88f)
      .setOrigin(0, 0.5)
      .setDepth(6);
    const label = this.add
      .text(x, y + 20, '宝箱', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffe9a8',
        stroke: '#181018',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setDepth(6);
    const cracks = this.add.graphics().setDepth(7).setVisible(false);

    this.chest = {
      chest,
      shadow,
      body,
      lid,
      hpBackground,
      hpFill,
      label,
      cracks,
    };
    this.syncChestHealthBar(this.chest);
    this.playSfx(COMBAT_SFX.enemyWarning);
  }

  /** 移除未打破的宝箱；已打破的宝箱在破碎时已单独移除。 */
  private clearWaveChest(): void {
    const view = this.chest;
    if (!view) return;
    view.shadow.destroy();
    view.body.destroy();
    view.lid.destroy();
    view.hpBackground.destroy();
    view.hpFill.destroy();
    view.label.destroy();
    view.cracks.destroy();
    this.chest = null;
  }

  /** 同步血条长度与裂纹数量：血量越低裂纹越多，提供受击后的可读状态。 */
  private syncChestHealthBar(view: ChestView): void {
    const health = view.chest.health;
    const ratio = health.maxHealth > 0 ? health.health / health.maxHealth : 0;
    view.hpFill.setSize(42 * Math.max(0, Math.min(1, ratio)), 6);
    view.hpFill.setFillStyle(ratio <= 0.33 ? 0xe2643c : ratio <= 0.66 ? 0xffd166 : 0x7bd88f);

    view.cracks.clear();
    view.cracks.setVisible(ratio <= 0.66);
    if (ratio > 0.66) return;
    const { x, y } = view.chest;
    view.cracks.lineStyle(2, 0x2a1620, 0.9);
    view.cracks.lineBetween(x - 9, y - 10, x - 2, y + 2);
    view.cracks.lineBetween(x - 2, y + 2, x - 7, y + 9);
    if (ratio <= 0.33) {
      view.cracks.lineBetween(x + 7, y - 10, x + 2, y + 1);
      view.cracks.lineBetween(x + 2, y + 1, x + 9, y + 9);
    }
  }

  /** 宝箱受击：闪白、伤害字与裂纹；不累计击杀/伤害统计。 */
  private showChestDamage(chest: Chest, result: DamageResult): void {
    if (!result.applied) return;
    const view = this.chest;
    this.playSfx(COMBAT_SFX.enemyHit);
    if (view && view.chest === chest) {
      view.body.setTintFill(0xffffff);
      this.time.delayedCall(HIT_FEEDBACK.flashDurationMs, () => {
        if (!view.body.active) return;
        view.body.clearTint();
      });
      this.showDamageNumber(chest.x, chest.y - 24, result.damage);
      this.syncChestHealthBar(view);
    }
    if (chest.isBroken) this.breakChest(chest);
  }

  /**
   * 打破宝箱：只记录 1 个待领取资格并显示「战利品 +1」。
   * 战斗内不弹窗、不发道具、不发现金，也不触发任何击杀奖励。
   */
  private breakChest(chest: Chest): void {
    if (!chest.claimBreakEligibility()) return;
    this.brokenChestIds.push(chest.id);
    this.playSfx(COMBAT_SFX.enemyDeath);
    this.showDeathBurst(chest.x, chest.y, CHEST_RADIUS * 1.6);
    this.showLootGain(chest.x, chest.y);
    if (this.chest?.chest === chest) this.clearWaveChest();
  }

  /** 宝箱破碎提示：在箱体位置显示“战利品 +1”，同时在 HUD 顶部给短提示。 */
  private showLootGain(x: number, y: number): void {
    this.showHudToast('loot', formatLootToast(1));
    const text = this.add
      .text(x, y - 30, '战利品 +1', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffd98a',
        stroke: '#181018',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({
      targets: text,
      y: text.y - 18,
      alpha: 0,
      duration: 720,
      onComplete: () => text.destroy(),
    });
  }

  /** 每步兜底：伤害来自非弹体路径时，死亡宝箱仍只记一次资格。 */
  private syncChestBroken(): void {
    const chest = this.chest?.chest;
    if (chest?.isBroken) this.breakChest(chest);
  }

  /** 推进敌人行为、出生提示、接触伤害与敌弹，并同步表现。 */
  private stepEnemies(stepSeconds: number): void {
    const form = this.muelsyse;
    const formPosition = form?.formPosition;
    // 主流形存活时作为更近目标的候选；近战敌人改打流形，远程仍攻击玩家。
    const summonContext =
      form && formPosition
        ? {
            summon: form.isFormAlive
              ? {
                  x: formPosition.x,
                  y: formPosition.y,
                  radius: form.formRadius,
                  isAlive: true,
                }
              : null,
            applySummonDamage: (rawDamage: number, damageType: 'physical' | 'magic' | 'true') =>
              form.damageForm(rawDamage, damageType),
          }
        : {};
    const result = this.enemySystem.step(stepSeconds, {
      player: {
        x: this.motion.position.x,
        y: this.motion.position.y,
        radius: PLAYER.radius,
        isInvulnerable: this.motion.isInvulnerable,
      },
      applyPlayerDamage: (rawDamage, damageType) => {
        // 同一逻辑步内 E03 刚授予的无敌也要生效：EnemySystem 的 isInvulnerable
        // 是步初快照，多段伤害同帧命中时可能已经过期。
        if (this.motion.isInvulnerable) {
          return this.playerHealth.applyDamage(
            0,
            damageType,
            this.damageChains.beginNative('enemy-attack'),
          );
        }
        // H24 要把致命伤“抵消”，需要恢复受击前的生命；零伤害分支不会走到这里。
        const healthBefore = this.playerHealth.health;
        // 每次玩家受击是一次独立的原生敌方攻击；携带来源链写入事件日志。
        // 开发验证参数 damageTaken 只放大玩家承伤，不改敌人数值与奖励。
        const result = this.playerHealth.applyDamage(
          rawDamage * (this.devScenario?.damageTaken ?? 1),
          damageType,
          this.damageChains.beginNative('enemy-attack'),
        );
        this.handleSariaShieldAbsorb(result);
        if (result.applied) {
          // I18 锻心碎片：敌人有效命中后蓄势，下一发 J 增伤（内置冷却 4 秒）。
          this.itemEffects.notifyEnemyHit();
          // H11 以伤换金：每波首次受到敌人伤害 +15 金币；
          // 同时中断 H17 护盾呼吸，并按护盾吸收量扣减 H17 自身护盾。
          const damageGold = this.combatHexes.registerPlayerDamage(
            result.shieldAbsorbed,
          );
          if (damageGold > 0) {
            const awarded = this.economy.addGold(damageGold);
            if (awarded > 0) {
              const position = this.motion.position;
              this.showGoldGain(position.x, position.y - 16, awarded);
              this.showSkillLabel(`以伤换金 · +${awarded} 金币`, '#ffe08a');
              this.dispatchHud({ type: 'gold', gold: this.economy.gold });
            }
          }
        }
        // R01 锻心引擎：每 4 秒首次受击后蓄势，下一发 J 附加 5% 最大生命物伤。
        if (result.applied && this.craftedEffects.notifyEnemyHit()) {
          this.showSkillLabel('锻心引擎 · 反击蓄势', '#ffd166');
        }
        // E03 不屈圣印：每波首次致命伤改为 1 生命 + 2 秒无敌，每局最多 3 次。
        // 与 H24 的优先级：E03 先判定，一次致命事件只触发一个保命效果。
        let savedByCore = false;
        if (result.died && this.coreEffects.tryPreventDeath()) {
          this.playerHealth.restoreHealth(1, this.playerHealth.maxHealth);
          this.motion.grantInvulnerability(E03_INVULNERABLE_SECONDS);
          this.playSfx(COMBAT_SFX.skillK);
          this.showSkillLabel(
            `不屈圣印 · 1 生命 ${E03_INVULNERABLE_SECONDS} 秒无敌`,
            '#ffe08a',
          );
          this.syncHealthHud();
          savedByCore = true;
        }
        // H24 多重保险：E03 未接住时，每波首次致命伤消耗 60 金币抵消，
        // 每局最多 2 次；金币不足不触发，玩家照常死亡。
        if (result.died && !savedByCore) {
          const save = this.combatHexes.tryLethalSave(this.economy.gold);
          if (save.triggered && this.economy.spendGold(save.goldCost)) {
            this.playerHealth.restoreHealth(
              healthBefore,
              this.playerHealth.maxHealth,
            );
            this.motion.grantInvulnerability(save.invulnerableSeconds);
            this.playSfx(COMBAT_SFX.skillK);
            this.showSkillLabel(
              `多重保险 · −${save.goldCost} 金币 ${hudValue(
                save.invulnerableSeconds,
              )} 秒无敌`,
              '#c9b6ff',
            );
            this.dispatchHud({ type: 'gold', gold: this.economy.gold });
            this.syncHealthHud();
          }
        }
        // H18 濒危爆发：生命首次低于 35% 时标记，本步敌人结算完后统一爆发。
        if (
          !this.playerHealth.isDead &&
          this.combatHexes.tryLowHealthBurst(
            this.playerHealth.health,
            this.playerHealth.maxHealth,
          )
        ) {
          this.pendingLowHealthBurst = true;
        }
        // I23 保险齿轮：每波首次降到 30% 生命时获得护盾。
        this.tryTriggerLowHealthShield();
        return result;
      },
      isStunned: (enemyId) =>
        (this.grenade?.isStunned(enemyId) ?? false) ||
        (this.muelsyse?.isEnemyStunned(enemyId) ?? false),
      // 远程 L 的束缚：不移动，但射手仍可开火。
      isRooted: (enemyId) => this.muelsyse?.isEnemyRooted(enemyId) ?? false,
      speedMultiplier: (enemyId) =>
        (this.soul?.slowMultiplier(enemyId) ?? 1) *
        this.buildEffects.slowMultiplier(enemyId) *
        this.enemySlowMultiplierFromField(enemyId) *
        this.freeSkillSlows.slowMultiplier(enemyId) *
        (this.muelsyse?.enemySlowMultiplier(enemyId) ?? 1),
      ...summonContext,
    });

    for (const telegraphId of [...this.telegraphViews.keys()]) {
      const view = this.telegraphViews.get(telegraphId);
      if (view && !this.enemySystem.telegraphs.includes(view.telegraph)) {
        this.removeSpawnTelegraph(telegraphId);
      }
    }
    for (const unit of result.spawned) this.createEnemyView(unit);
    for (const hit of result.contactHits) this.showPlayerDamage(hit.damage);
    for (const hit of result.summonHits) this.showFormDamage(hit.damage);
    for (const hit of result.projectileHits) {
      this.removeEnemyProjectile(hit.projectileId);
      if (hit.damage) this.showPlayerDamage(hit.damage);
    }
    for (const projectileId of result.blockedProjectileIds) {
      this.removeEnemyProjectile(projectileId);
    }
    for (const projectileId of result.expiredProjectileIds) {
      this.removeEnemyProjectile(projectileId);
    }

    // Boss 地面爆破：预警圈按 id 同步，落地时播放爆炸并显示伤害。
    for (const hit of result.bossBlastHits) {
      this.removeBossBlastView(hit.blastId);
      this.showExplosion(hit.x, hit.y, hit.radius, ENEMY_WARNING.projectile);
      if (hit.damage) this.showPlayerDamage(hit.damage);
    }
    // 精英地面爆破：同一 id 的预警圈落地后移除并结算。
    for (const hit of result.eliteBlastHits) {
      this.removeEliteBlastView(hit.blastId);
      this.showExplosion(hit.x, hit.y, hit.radius, ENEMY_WARNING.projectile);
      if (hit.damage) this.showPlayerDamage(hit.damage);
    }
    // 爆爆兽自爆：伤害圈在蓄力期间已显示，这里结算爆炸并保留死亡视图。
    for (const blast of result.bomberExplosions) {
      this.showExplosion(blast.x, blast.y, blast.radius, ENEMY_WARNING.projectile);
      if (blast.damage) this.showPlayerDamage(blast.damage);
      this.playSfx(COMBAT_SFX.enemyDeath);
      const view = this.enemies.find(
        (entry) => entry.unit.combatant.id === blast.enemyId,
      );
      if (view) this.markEnemySelfDestructed(view);
    }
    // 灯灵治疗：绿色连线 + 目标上方回复量，便于识别治疗对象。
    for (const heal of result.healEvents) {
      this.showEnemyHeal(heal);
    }
    // 巢母召唤：走与波次相同的 0.8 秒出生提示；幼虫计入同屏上限，
    // 但不带 `summoned` 标记，击杀仍给 1 金币/1 经验。
    for (const request of result.broodSummonRequests) {
      for (let index = 0; index < request.count; index += 1) {
        const telegraph = this.enemySystem.queueSpawn(
          scaleEnemyForWave(getEnemy(request.enemyId), this.waveNumber),
          this.motion.position,
          index,
        );
        this.createSpawnTelegraph(telegraph);
      }
    }
    // 二阶段增援：走与波次相同的 0.8 秒出生提示，不直接凭空落地；
    // 标记为增援后，击杀不会产生经验或金币收益。
    for (const request of result.bossSummonRequests) {
      for (let index = 0; index < request.count; index += 1) {
        const telegraph = this.enemySystem.queueSpawn(
          getEnemy(request.enemyId),
          this.motion.position,
          index,
          { summoned: true },
        );
        this.createSpawnTelegraph(telegraph);
      }
    }

    this.syncBossBlastWarnings();
    this.syncEliteBlastWarnings();
    this.syncEnemyProjectiles();
    this.syncEnemies(stepSeconds);
    this.syncBossHud();
    this.syncHealthHud();
  }

  /** 地面延迟爆破预警：红色圆环 + 实心危险区，形状与颜色双重提示。 */
  private syncBossBlastWarnings(): void {
    const blasts: readonly BossBlast[] = this.enemySystem.boss?.blasts ?? [];
    const live = new Set<number>();
    for (const blast of blasts) {
      live.add(blast.id);
      let view = this.bossBlastViews.get(blast.id);
      if (!view) {
        const ring = this.add
          .circle(blast.x, blast.y, blast.radius, ENEMY_WARNING.fill, 0.12)
          .setStrokeStyle(3, ENEMY_WARNING.stroke, 0.95)
          .setDepth(ENEMY_WARNING.depth)
          .setScale(0.55);
        const core = this.add
          .circle(blast.x, blast.y, blast.radius * 0.35, ENEMY_WARNING.core, 0.4)
          .setDepth(ENEMY_WARNING.depth);
        this.tweens.add({
          targets: ring,
          scale: 1,
          duration: BOSS_HAMMER_WARNING_SECONDS * 1000,
          ease: 'Quad.easeIn',
        });
        view = { ring, core };
        this.bossBlastViews.set(blast.id, view);
        // 危险范围出现时给出声音提示（形状/颜色之外的第三类提示）。
        this.playSfx(COMBAT_SFX.enemyWarning);
      }
      view.ring.setPosition(blast.x, blast.y);
      view.core.setPosition(blast.x, blast.y);
    }

    for (const [blastId, view] of this.bossBlastViews) {
      if (live.has(blastId)) continue;
      this.tweens.killTweensOf(view.ring);
      view.ring.destroy();
      view.core.destroy();
      this.bossBlastViews.delete(blastId);
    }
  }

  private removeBossBlastView(blastId: number): void {
    const view = this.bossBlastViews.get(blastId);
    if (!view) return;
    this.bossBlastViews.delete(blastId);
    this.tweens.killTweensOf(view.ring);
    view.ring.destroy();
    view.core.destroy();
  }

  /**
   * 精英地面爆破预警：与 Boss 预警同层（高于友方特效），
   * 预警圈与落地按同一个爆破 id 增删，避免范围与伤害脱节。
   */
  private syncEliteBlastWarnings(): void {
    const blasts: readonly EliteBlast[] = this.enemySystem.eliteBlasts;
    const live = new Set<number>();
    for (const blast of blasts) {
      live.add(blast.id);
      let view = this.eliteBlastViews.get(blast.id);
      if (!view) {
        const ring = this.add
          .circle(blast.x, blast.y, blast.radius, ENEMY_WARNING.fill, 0.12)
          .setStrokeStyle(3, ENEMY_WARNING.stroke, 0.95)
          .setDepth(ENEMY_WARNING.depth)
          .setScale(0.55);
        const core = this.add
          .circle(blast.x, blast.y, blast.radius * 0.35, ENEMY_WARNING.core, 0.4)
          .setDepth(ENEMY_WARNING.depth);
        this.tweens.add({
          targets: ring,
          scale: 1,
          duration: Math.max(1, blast.remainingSeconds * 1000),
          ease: 'Quad.easeIn',
        });
        view = { ring, core };
        this.eliteBlastViews.set(blast.id, view);
        this.playSfx(COMBAT_SFX.enemyWarning);
      }
      view.ring.setPosition(blast.x, blast.y);
      view.core.setPosition(blast.x, blast.y);
    }

    for (const [blastId, view] of this.eliteBlastViews) {
      if (live.has(blastId)) continue;
      this.tweens.killTweensOf(view.ring);
      view.ring.destroy();
      view.core.destroy();
      this.eliteBlastViews.delete(blastId);
    }
  }

  private removeEliteBlastView(blastId: number): void {
    const view = this.eliteBlastViews.get(blastId);
    if (!view) return;
    this.eliteBlastViews.delete(blastId);
    this.tweens.killTweensOf(view.ring);
    view.ring.destroy();
    view.core.destroy();
  }

  /** 敌弹视觉：新增/移动/移除都按弹体 id 对齐纯逻辑状态。 */
  private syncEnemyProjectiles(): void {
    const live = new Set<number>();
    for (const projectile of this.enemySystem.projectiles) {
      live.add(projectile.id);
      let view = this.enemyProjectileViews.get(projectile.id);
      if (!view) {
        const sprite = this.add
          .circle(projectile.x, projectile.y, projectile.radius, ENEMY_WARNING.projectile)
          .setStrokeStyle(1.5, ENEMY_WARNING.stroke, 0.9)
          .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
        view = { id: projectile.id, sprite };
        this.enemyProjectileViews.set(projectile.id, view);
      }
      view.sprite.setPosition(projectile.x, projectile.y);
    }
    for (const [projectileId, view] of this.enemyProjectileViews) {
      if (live.has(projectileId)) continue;
      view.sprite.destroy();
      this.enemyProjectileViews.delete(projectileId);
    }
  }

  private removeEnemyProjectile(projectileId: number): void {
    const view = this.enemyProjectileViews.get(projectileId);
    if (!view) return;
    this.enemyProjectileViews.delete(projectileId);
    view.sprite.destroy();
  }

  /** 敌人位置、血条与冲锋预警每步跟随逻辑状态。 */
  private syncEnemies(stepSeconds: number): void {
    for (const view of this.enemies) {
      const unit = view.unit;
      if (!unit.combatant.isAlive) continue;
      const x = unit.combatant.x;
      const y = unit.combatant.y;
      const hpY = y - unit.radius - 12;
      // 普通敌人受伤后短暂显示血条/名称；精英与 Boss 常驻。
      const hp = unit.combatant.health;
      if (hp.health < view.lastHealth - 1e-9) {
        view.revealRemaining = ENEMY_REVEAL_SECONDS;
      } else {
        view.revealRemaining = Math.max(0, view.revealRemaining - stepSeconds);
      }
      view.lastHealth = hp.health;
      const visibility = enemyHudVisibility({
        boss: unit.enemy.behavior === 'boss',
        elite: unit.enemy.elite === true,
        revealRemainingSeconds: view.revealRemaining,
      });
      view.hpBackground.setVisible(visibility.showHealthBar);
      view.hpFill.setVisible(visibility.showHealthBar);
      view.nameText.setVisible(visibility.showName);
      const bob = Math.sin(this.time.now * 0.007 + unit.id.length * 1.8);
      const pulse = unit.activity === 'windup' ? 0.065 : 0.018;
      view.body.setPosition(x, y + unit.radius * 0.45 - Math.abs(bob) * 1.5);
      view.body.setDisplaySize(view.visualSize * (1 + bob * pulse), view.visualSize * (1 - bob * pulse));
      view.body.setFlipX(unit.combatant.x > this.motion.position.x);
      if (unit.enemy.behavior === 'boss' && this.enemySystem.boss?.phase === 2) view.body.setTint(0xffba82);
      view.shadow.setPosition(x, y + unit.radius - 2);
      view.hpBackground.setPosition(x, hpY);
      view.hpFill.setPosition(x - view.hpWidth / 2, hpY);
      view.nameText.setPosition(x, y + unit.radius + 8);
      view.statusText.setPosition(x, hpY - 12);

      // 盾壳蟹弱点方向：线段从身体边缘指向背侧，标签跟随线段末端。
      if (view.weakPointLine && view.weakPointLabel) {
        const angle = bulwarkWeakPointAngle(unit);
        const inner = unit.radius + 4;
        const outer = unit.radius + 26;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        view.weakPointLine.setTo(
          x + cos * inner,
          y + sin * inner,
          x + cos * outer,
          y + sin * outer,
        );
        view.weakPointLabel.setPosition(
          x + cos * (outer + 10),
          y + sin * (outer + 10),
        );
      }

      // 巢母终生召唤进度直接显示在名称旁，便于判断是否还能刷怪。
      if (unit.enemy.behavior === 'summon') {
        view.nameText.setText(
          `${view.label} · 幼虫 ${unit.larvaeSummoned}/${BROODMOTHER_MAX_LARVAE}`,
        );
      }

      const isBoss = unit.enemy.behavior === 'boss';
      // Boss 名称旁同步阶段标签；半血切阶段后同一帧更新。
      if (isBoss) {
        const phase = this.enemySystem.boss?.phase === 2 ? '阶段二' : '阶段一';
        view.nameText.setText(`${view.label} · ${phase}`);
      }

      const winding = unit.activity === 'windup';
      view.windupRing.setPosition(x, y).setVisible(winding);
      view.chargeWarning
        ?.setPosition(ARENA.width / 2, y)
        .setVisible(isBoss && winding);
      if (winding) {
        // Boss 的冲锋前摇来自 boss.ts，而不是普通敌人 attack 定义。
        const total = isBoss
          ? BOSS_CHARGE_WINDUP_SECONDS
          : (unit.enemy.attack?.windupSeconds ?? 0.7);
        const progress = 1 - Math.min(1, Math.max(0, unit.windupRemaining / total));
        view.windupRing.setScale(0.55 + progress * 0.45);
      }
      if (view.warningLine) {
        const behavior = unit.enemy.behavior;
        const showLine = winding && (behavior === 'charge' || behavior === 'spit');
        view.warningLine.setVisible(showLine);
        if (showLine) {
          const player = this.motion.position;
          const dx = player.x - x;
          const dy = player.y - y;
          const distance = Math.hypot(dx, dy) || 1;
          const reach =
            behavior === 'charge'
              ? CHARGE_DASH_SPEED * CHARGE_DASH_SECONDS
              : SHOOTER_FIRE_RANGE * 0.6;
          view.warningLine.setTo(
            x,
            y,
            x + (dx / distance) * reach,
            y + (dy / distance) * reach,
          );
        }
      }
    }
  }

  private syncHealthHud(): void {
    const health = this.playerHealth;
    this.dispatchHud({
      type: 'vitals',
      health: health.health,
      maxHealth: health.maxHealth,
      shield: health.shield,
      shieldRemaining: this.saria?.isShieldActive
        ? this.saria.shieldRemaining
        : 0,
    });
    this.deathHint.setVisible(health.isDead);
  }

  /**
   * 生命归零立即结束：先结算死亡（结果阶段），再清空未发放的波次与奖励，
   * 保证同帧的升级、波间与胜利都不会覆盖失败。
   */
  private handlePlayerDeath(): void {
    if (this.resultRecorded) return;
    this.resultRecorded = true;
    const resolution = resolvePostDamagePhase({
      playerDead: true,
      waveCleared: false,
    });
    if (resolution.phase === 'result' && resolution.outcome) {
      this.runState.beginResult(resolution.outcome);
    }

    this.waveRunner = null;
    this.rewardFlow = null;
    this.waveClearHandled = true;
    this.upgradeChoice = null;
    this.hexChoice = null;
    this.hideUpgradePanel();
    this.rewardOverlay?.setVisible(false);
    this.countdownText?.setVisible(false);
    this.staleHintHud?.setVisible(false);
    this.jHeld = false;
    this.castPoseSeconds = 0;
    this.hurtPoseSeconds = 0;
    this.motion.clearKeys();
    this.syncHealthHud();
    // 结算开始即清除续局：失败后不允许刷新回到死前检查点。
    clearRunCheckpoint();
    this.lastCheckpointKind = null;
    this.playSfx(COMBAT_SFX.defeat);
    this.publishRunResult('defeat');
  }

  /** 本局最终构筑：只记录正式强化 ID 与层数。 */
  private ownedUpgradeStacks(): RunResultUpgrade[] {
    return [...this.upgradeRun.stacks.entries()]
      .filter(([, stacks]) => stacks > 0)
      .map(([id, stacks]) => ({ id, stacks }));
  }

  /**
   * 写入最近成绩并通知应用壳显示结算面板。
   * 存储层按本局 `resultRunId` 去重，胜利/失败守卫再加一层保护。
   */
  private publishRunResult(outcome: RunOutcome): void {
    const record = createRunResultRecord({
      runId: this.resultRunId,
      characterId: this.character.id,
      outcome,
      wave: this.waveNumber,
      durationSeconds: this.simulatedSeconds,
      kills: this.killCount,
      damageDealt: this.damageDealt,
      upgrades: this.ownedUpgradeStacks(),
    });
    const appended = appendRunResult(record);
    const payload: RunResultPayload = {
      record: appended.record,
      saved: appended.saved,
    };
    this.game.events.emit(RUN_RESULT_EVENT, payload);
  }

  /** 场上是否已有 Boss 且已死亡。普通波没有 Boss，恒为 false。 */
  private isBossDefeated(): boolean {
    return this.enemySystem.enemies.some(
      (unit) => unit.enemy.behavior === 'boss' && !unit.combatant.isAlive,
    );
  }

  /**
   * Boss 被击败：清除剩余敌弹、普通敌人与未落地提示，只记录一次胜利。
   * 进入结果阶段后不再推进波次、奖励或战斗逻辑。
   */
  private handleBossVictory(): void {
    if (this.resultRecorded) return;
    this.resultRecorded = true;

    const resolution = resolvePostDamagePhase({
      playerDead: false,
      waveCleared: false,
      victory: true,
    });
    if (resolution.phase === 'result' && resolution.outcome) {
      this.runState.beginResult(resolution.outcome);
    }

    const cleared = this.enemySystem.clearForVictory();
    for (const enemyId of cleared.enemyIds) this.removeEnemyView(enemyId);
    for (const projectileId of cleared.projectileIds) {
      this.removeEnemyProjectile(projectileId);
    }
    for (const telegraphId of cleared.telegraphIds) {
      this.removeSpawnTelegraph(telegraphId);
    }
    for (const blastId of [...this.bossBlastViews.keys()]) {
      this.removeBossBlastView(blastId);
    }
    for (const blastId of [...this.eliteBlastViews.keys()]) {
      this.removeEliteBlastView(blastId);
    }

    this.waveRunner = null;
    this.rewardFlow = null;
    this.waveClearHandled = true;
    this.upgradeChoice = null;
    this.hexChoice = null;
    this.hideUpgradePanel();
    this.rewardOverlay?.setVisible(false);
    this.countdownText?.setVisible(false);
    this.staleHintHud?.setVisible(false);
    this.jHeld = false;
    this.castPoseSeconds = 0;
    this.hurtPoseSeconds = 0;
    this.motion.clearKeys();
    this.logicLoop?.reset();
    this.resultHint
      .setText('胜利\nBoss 已击败\n按 Enter 返回选角')
      .setVisible(true);
    this.syncBossHud();
    this.syncHealthHud();
    this.updateWaveHud();
    // 胜利结算同样清除续局，避免刷新再次进入 Boss 战。
    clearRunCheckpoint();
    this.lastCheckpointKind = null;
    this.playSfx(COMBAT_SFX.victory);
    this.publishRunResult('victory');
  }

  /** 移除普通敌人视图；Boss 本体的死亡视图保留。 */
  private removeEnemyView(enemyId: string): void {
    const index = this.enemies.findIndex((view) => view.unit.combatant.id === enemyId);
    if (index < 0) return;
    const view = this.enemies[index];
    if (!view) return;
    view.body.destroy();
    view.shadow.destroy();
    view.hpBackground.destroy();
    view.hpFill.destroy();
    view.nameText.destroy();
    view.statusText.destroy();
    this.tweens.killTweensOf(view.windupRing);
    view.windupRing.destroy();
    view.warningLine?.destroy();
    view.weakPointLine?.destroy();
    view.weakPointLabel?.destroy();
    view.chargeWarning?.destroy();
    this.enemies.splice(index, 1);
  }

  /** Boss 阶段、生命与二阶段召唤倒计时；普通波隐藏。 */
  private syncBossHud(): void {
    const boss = this.enemySystem.boss;
    const unit = this.enemySystem.enemies.find((entry) => entry.enemy.behavior === 'boss');
    if (!boss || !unit) {
      this.bossHud?.setVisible(false);
      return;
    }

    if (!unit.combatant.isAlive) {
      this.bossHud.setText(`${unit.enemy.name} · 已击败`).setVisible(true);
      return;
    }

    const health = unit.combatant.health;
    const phaseText = boss.phase === 1 ? '阶段一' : '阶段二';
    const summonText =
      boss.phase === 2 ? ` · 增援 ${boss.summonRemainingSeconds.toFixed(1)}s` : '';
    this.bossHud
      .setText(
        `${unit.enemy.name} · ${phaseText} · 生命 ${hudValue(health.health)}/${hudValue(health.maxHealth)}${summonText}`,
      )
      .setVisible(true);
  }

  /** 普通波超过 90 秒提示最近残敌的方位；不传送、不击杀、不隐藏敌人。 */
  private syncStaleEnemyHint(): void {
    const runner = this.waveRunner;
    if (!runner || this.runState.phase !== 'combat') {
      this.staleHintHud?.setVisible(false);
      return;
    }

    const hint = resolveStaleEnemyHint(
      runner.elapsedSeconds,
      this.motion.position,
      this.enemySystem.enemies.map((unit) => ({
        id: unit.combatant.id,
        x: unit.combatant.x,
        y: unit.combatant.y,
        isAlive: unit.combatant.isAlive,
      })),
    );
    if (!hint) {
      this.staleHintHud.setVisible(false);
      return;
    }

    this.staleHintHud
      .setText(`残敌提示 · ${hint.label} · 剩余 ${hint.count}`)
      .setVisible(true);
  }

  /** 玩家受伤：闪白、受击动画与镜头轻震，伤害数字复用通用表现。 */
  private showPlayerDamage(result: DamageResult): void {
    if (!result.applied) return;
    const position = this.motion.position;
    this.showDamageNumber(position.x, position.y - 16, result.damage);
    this.playSfx(COMBAT_SFX.playerHurt);
    this.hurtPoseSeconds = HIT_FEEDBACK.playerHurtSeconds;
    this.player.setTintFill(HIT_FEEDBACK.flashColor);
    this.time.delayedCall(HIT_FEEDBACK.flashDurationMs, () => {
      if (this.player.active) this.player.clearTint();
    });
    // 屏震开关与减少动态效果立即生效：每次震动前读取当前设置。
    const settings = this.settingsStore.get();
    if (settings.screenShake && !settings.reducedMotion) {
      this.cameras.main.shake(80, 0.003);
    }
  }

  /** 固定逻辑步内的战斗推进：发射、弹体移动、命中结算与提示目标刷新。 */
  private updateCombat(stepSeconds: number): void {
    // 每波开场只推进倒计时；战斗、冷却与刷怪计时都尚未开始。
    if (this.runState.phase === 'countdown') {
      this.stepCountdown(stepSeconds);
      return;
    }
    if (this.runState.phase === 'result') return;

    if (this.castPoseSeconds > 0) {
      this.castPoseSeconds = Math.max(0, this.castPoseSeconds - stepSeconds);
    }
    if (this.hurtPoseSeconds > 0) {
      this.hurtPoseSeconds = Math.max(0, this.hurtPoseSeconds - stepSeconds);
    }

    // 阿米娅精神爆发先推进：爆发结束的那一步立即进入 J 疲劳窗口。
    this.stepAmiya(stepSeconds);
    // 塞雷娅护盾到期与 K/L 冷却按逻辑步推进。
    this.stepSaria(stepSeconds);
    // 缪尔赛思主流形：跟随、自动攻击与 K 冷却按逻辑步推进。
    this.stepMuelsyse(stepSeconds);
    // 死亡后不保留奇美拉真伤或永久虚弱；移速倍率随虚弱状态即时同步。
    if (this.playerHealth.isDead) this.amiya?.clearTemporaryEffects();
    this.syncMoveSpeed();
    // I09 周期回复、I10 吸血预算与 I12 静止计时按固定逻辑步推进。
    this.stepItemEffects(stepSeconds);
    // U/I 冷却按逻辑步推进；E06 到期复施在伤害结算前执行。
    this.freeSkills.step(stepSeconds);
    // H02 闪避火路、H06 攻速窗口与 H08 冷却银行同样按逻辑步推进。
    this.stepCombatHexEffects(stepSeconds);
    // S01 每秒 tick 与 S02 减速在敌人移动前推进，`stepEnemies` 随后读取减速倍率。
    this.stepFreeSkillEffects(stepSeconds);
    // R05 潮生母巢：每 12 秒生成 5 秒小流形，并在本步结算它的攻击。
    this.stepR05Flowform(stepSeconds);
    this.stepFreeSkillEcho();

    // L 生效期间下一发仍为强化弹时，把发射间隔切到 1.1 秒。
    const burst = this.burst;
    const overrideInterval =
      burst && burst.isActive && burst.ammoRemaining > 1
        ? burst.fireIntervalSeconds
        : undefined;
    // 精神爆发结束后的 0.5 秒只锁 J；移动与闪避不受影响。
    const jHeld = this.amiya?.isJFiringLocked ? false : this.jHeld;
    // H06 滑步开火：窗口内攻速 +50%，间隔按当前倍率实时折算。
    this.attackTimer.setIntervalMultiplier(
      this.stats.attackIntervalMultiplier /
        this.combatHexes.dodgeAttackSpeedMultiplier,
    );
    if (this.attackTimer.update(stepSeconds, jHeld, overrideInterval)) {
      if (this.saria) {
        // 塞雷娅 J 盾击：命中当前面前扇区，不生成弹体；普通敌人被击退。
        // H41 重盾远投把每第 4 次原生 J 改为 180 距离的穿透飞盾。
        const bashAttack = this.applyNextJBonus(this.character.attack);
        if (this.knightHexes.registerJAttack().isThrow) {
          this.performShieldThrow(bashAttack);
        } else {
          this.playSfx(COMBAT_SFX.attack);
          this.performShieldBash(
            bashAttack,
            true,
            this.consumeCraftedCounterDamage(),
          );
        }
        if (this.buildEffects.consumeTacticalEcho()) {
          this.performShieldBash(echoAttackOf(this.character.attack), false);
          this.showSkillLabel('战术回响');
        }
        this.castPoseSeconds = 0.16;
        this.castPoseFacing = this.motion.facingDirection;
      } else {
        // 弹药只在真正射出的这一瞬间扣除；空射同样扣弹，未射出则不扣。
        // W04 的最后一发在扣除前判定，确保该发使用额外扩大的溅射半径。
        const lastShot = burst?.nextShotIsLast ?? false;
        const empowered = burst?.consumeShot() ?? false;
        const baseAttack =
          empowered && burst
            ? burst.modifyAttack(this.character.attack, lastShot)
            : this.character.attack;
        // 奇美拉期间 J 转为真实伤害并增伤；弹体创建时固定，结束后不追溯。
        // I04/I05 的弹体尺寸与射程也在发射瞬间写入本次攻击。
        const modifiedAttack = this.amiya
          ? this.amiya.modifyAttack(baseAttack)
          : baseAttack;
        // I18 蓄势增伤在真正发射的瞬间消费一次；I04/I05 的射程同样在此写入。
        const attack = this.applyNextJBonus(this.applyItemRange(modifiedAttack));
        // H14 折返弹：每第三发原生 J 到射程终点后调头一次；派生弹不计数。
        const returnShot = this.combatHexes.registerJShot();
        const origin = this.motion.position;
        const facing = this.motion.facingDirection;
        // A01/H31 只作用于 J（含 G06 追加的 J），K 的精神爆发弹保持单目标。
        const jPierce = this.amiya
          ? resolveSorcererJPierce(
              amiyaJPierce(this.upgradeRun.stacksOf('A01')),
              this.sorcererHexes.has('H31'),
            )
          : null;
        // 轻自瞄：每发重新在 ±25°、射程内、无遮挡的候选中校正；无目标沿面向空射。
        const aim = this.resolveShotAim(origin, facing, attack.range);
        const state = createProjectile(
          this.nextProjectileId,
          origin,
          facing,
          attack,
          {
            pierce: jPierce,
            radius: this.itemProjectileRadius(
              this.grenade ? GRENADE_PROJECTILE_RADIUS : PROJECTILE_RADIUS,
            ),
            direction: aim.direction,
            ...(returnShot
              ? {
                  returnCharges: 1,
                  returnDamageRatio:
                    COMBAT_HEX_PARAMS.H14.returnDamageRatio ?? 0.35,
                }
              : {}),
          },
        );
        this.nextProjectileId += 1;
        this.lastShot = {
          targetId: aim.target?.id ?? null,
          angleDegrees: aim.angleDegrees,
          radius: state.radius,
        };

        // 阿米娅的源石术式为蓝黑术式，缪尔赛思为水色水弹，维什戴尔保持橙红炮火。
        const colors = characterEffectColors(this.character.id);
        const fill = empowered ? 0xff7b4e : colors.projectileFill;
        const stroke = empowered ? 0xffd166 : colors.projectileStroke;
        const sprite = this.add
          .circle(origin.x, origin.y, projectileVisualRadius(state.radius), fill)
          .setStrokeStyle(1.5, stroke)
          .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
        // 每发 J 是一次原生攻击；穿透命中沿用同一条链。
        const eventSource = this.damageChains.beginNative('J');
        // R01 反击蓄势在真正发射瞬间消费；只有主弹携带，侧弹与追加弹不带。
        const counterDamage = this.consumeCraftedCounterDamage();
        this.projectiles.push({
          state,
          sprite,
          source: 'J',
          eventSource,
          r01CounterDamage: counterDamage,
          // H30 烟花谢幕：最后一发强化弹命中后排队 3 次 60% 波纹。
          ...(empowered && lastShot && this.bomberHexes.has('H30')
            ? { h30Finale: true }
            : {}),
        });
        this.playSfx(COMBAT_SFX.attack);

        // H27 三炮齐鸣：每次爆裂黎明启动后每第三发追加两枚 25% 小弹；
        // 小弹由本次 J 派生（depth=1），不会再被计为一次爆裂黎明发射。
        if (empowered && burst?.tripleShotTriggered) {
          this.spawnH27SmallShots(
            attack,
            eventSource,
            origin,
            aim.direction,
            colors,
            state.radius,
          );
        }

        // R03 折镜机关：每次原生 J 追加 2 枚 40% 侧弹；
        // 侧弹来源是 `derive` 出的 depth=1，命中不会再生成侧弹。
        const r03SideShots = planR03SideShots(
          this.craftedInventory.has('R03'),
          this.damageChains,
          eventSource,
        );
        if (r03SideShots) {
          this.spawnCraftedSideBullets(
            attack,
            r03SideShots,
            origin,
            facing,
            colors,
            state.radius,
          );
        }

        // I14 分裂棱镜：非穿透 J 额外发射 1 枚 35% 伤害的弹体；
        // 额外弹不再次触发 I14，也不会让 J 获得穿透。
        if (jPierce === null && this.itemEffects.extraProjectileCount > 0) {
          const ratio = this.itemEffects.extraProjectileDamageRatio;
          const extraAttack: AttackDefinition = {
            ...attack,
            damage: attack.damage * ratio,
            aftershock: attack.aftershock
              ? {
                  ...attack.aftershock,
                  damage: attack.aftershock.damage * ratio,
                }
              : undefined,
          };
          const extraSource = this.damageChains.derive(eventSource, 'I14');
          if (extraSource) {
            const extraState = createProjectile(
              this.nextProjectileId,
              origin,
              facing,
              extraAttack,
              {
                pierce: null,
                radius: state.radius,
                direction: aim.direction,
              },
            );
            this.nextProjectileId += 1;
            const extraSprite = this.add
              .circle(
                origin.x,
                origin.y,
                projectileVisualRadius(extraState.radius),
                colors.secondary,
              )
              .setStrokeStyle(1.5, colors.projectileStroke)
              .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
            this.projectiles.push({
              state: extraState,
              sprite: extraSprite,
              source: 'J',
              eventSource: extraSource,
            });
            this.showSkillLabel('分裂棱镜 · 追加弹');
          }
        }

        // G06 战术回响：本次 J 追加一次 50% 伤害攻击；只复制 J，不复制 K/L。
        if (this.buildEffects.consumeTacticalEcho()) {
          const echoState = createProjectile(
            this.nextProjectileId,
            origin,
            facing,
            echoAttackOf(attack),
            {
              pierce: jPierce,
              radius: state.radius,
              direction: aim.direction,
            },
          );
          this.nextProjectileId += 1;
          const echoSprite = this.add
            .circle(
              origin.x,
              origin.y,
              projectileVisualRadius(echoState.radius),
              colors.secondary,
            )
            .setStrokeStyle(1.5, colors.projectileStroke)
            .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
          // 战术回响是 J 的衍生攻击：沿用同一链并标记 depth=1，不能再派生。
          const echoSource = this.damageChains.derive(eventSource, 'G06');
          if (echoSource) {
            this.projectiles.push({
              state: echoState,
              sprite: echoSprite,
              source: 'J',
              eventSource: echoSource,
            });
          }
          this.showSkillLabel('战术回响');
        }

        // 使用八向施法帧，保证斜向射击的枪口方向与画面一致；
        // 轻自瞄偏转后取最近的八向，让施法帧与真实弹道一致。
        this.castPoseSeconds = 0.16;
        this.castPoseFacing = nearestFacing(aim.direction) ?? facing;
      }
    }

    this.stepProjectiles(stepSeconds);
    this.stepEnemies(stepSeconds);
    // H18 濒危爆发在敌人步进结束后统一结算，避免在受击回调里重入敌人状态；
    // 本步被保命效果救回后才触发，真正死亡则不爆发。
    if (this.pendingLowHealthBurst) {
      this.pendingLowHealthBurst = false;
      if (!this.playerHealth.isDead) this.applyLowHealthBurst();
    }
    // 先处理本帧伤害与死亡，再处理经验、升级与波次胜利；死亡后不再发奖励。
    if (this.playerHealth.isDead) {
      this.handlePlayerDeath();
      return;
    }
    if (this.grenade) {
      for (const resolution of this.grenade.step(stepSeconds, this.collectTargets())) {
        this.renderAftershock(resolution);
      }
    }
    // H30 烟花谢幕：在敌人步进后结算到期波纹，避免重入敌人状态。
    this.stepFinaleWaves(stepSeconds);
    // H35 环绕术式与 H36 追加真伤同样在敌人步进后统一结算。
    this.stepSorcererHexEffects(stepSeconds);
    burst?.step(stepSeconds);
    this.stepSoul(stepSeconds);
    // 宝箱若被未走 showHitResult 的路径打破，仍在此只记一次资格并移除视图。
    this.syncChestBroken();
    // 本步所有原生法术命中结算完后，统一处理 E02 的第 8 次触发。
    this.flushCoreSpellHits();

    // 所有伤害来源结算完后才判定胜利：同帧玩家死亡已在上面优先返回。
    if (this.isBossDefeated()) {
      this.handleBossVictory();
      return;
    }

    // 经验球进入 55 半径即吸取；升级立即结算生命成长并冻结战斗等待选择。
    const collection = this.progression.step(this.motion.position);
    for (const orb of collection.orbs) this.removeXpOrb(orb.id);
    if (collection.amount > 0) {
      this.syncLevelHealth();
      if (this.progression.pendingLevelUps > 0) this.refreshRewardOverlay();
    }

    this.stepWave(stepSeconds);
    this.updateWaveHud();
    this.syncStaleEnemyHint();
    this.syncBurstHud();
    this.syncChimeraHud();
    this.syncSkillHud();
    for (const enemy of this.enemies) {
      this.syncEnemyHealthBar(enemy);
      this.syncEnemyStatus(enemy);
    }
    this.updateTargetHint();
    // 性能场景在一步的命中/撞墙结算之后再补满敌弹，帧间读数稳定为 40。
    if (this.perfScenario) {
      const projectileCount = this.enemySystem.projectiles.length;
      const excess = projectileCount - DEV_PERF_ENEMY_PROJECTILE_COUNT;
      if (excess > 0) {
        // 射手本步新开的火也要裁掉，避免读数超过规格。
        this.enemySystem.trimProjectiles(DEV_PERF_ENEMY_PROJECTILE_COUNT);
        this.syncEnemyProjectiles();
      } else if (excess < 0) {
        this.topUpPerfProjectiles(-excess);
        this.syncEnemyProjectiles();
      }
    }
  }

  /** 阿米娅 K：每发沿该发真正射出的瞬间面向生成，不追踪目标。 */
  private stepAmiya(stepSeconds: number): void {
    const amiya = this.amiya;
    const attack = this.spiritBurstAttack;
    if (!amiya || !attack) return;

    const shots = amiya.step(stepSeconds, this.motion.facingDirection);
    if (shots.length === 0) return;

    const origin = this.motion.position;
    // 一次 K 施放的多发术式属于同一次原生攻击，共享同一个链 ID。
    const burstSource = this.damageChains.beginNative('K');
    // I04/I05 同样作用于 K 弹体；射程在发射瞬间固定。
    const itemAttack = this.applyItemRange(attack);
    const projectileRadius = this.itemProjectileRadius(PROJECTILE_RADIUS);
    let doubleCastFired = false;
    for (const shot of shots) {
      // 精神爆发的每一发同样享受 ±25° 轻自瞄，但方向仍按该发发射瞬间锁定。
      const aim = this.resolveShotAim(origin, shot.facing, itemAttack.range);
      const state = createProjectile(this.nextProjectileId, origin, shot.facing, {
        ...itemAttack,
        damage: shot.damage,
        damageType: shot.damageType,
      }, { direction: aim.direction, radius: projectileRadius });
      this.nextProjectileId += 1;
      if (shot.source === 'doubleCast') doubleCastFired = true;
      const fill = shot.source === 'doubleCast' ? 0x8a6bff : 0x3f6fc4;
      const stroke = shot.source === 'doubleCast' ? 0xd9c9ff : 0xa8d8ff;
      const sprite = this.add
        .circle(origin.x, origin.y, projectileVisualRadius(state.radius), fill)
        .setStrokeStyle(1.5, stroke)
        .setDepth(6);
      this.projectiles.push({ state, sprite, source: 'K', eventSource: burstSource });
    }
    if (doubleCastFired) this.showSkillLabel('双重吟唱 · 追加术式');
  }

  /**
   * 塞雷娅 K/L 冷却与领域治疗按逻辑步推进；护盾到期时清理生命状态中的护盾。
   * 领域范围提示每步跟随玩家当前位置，S02 伤害与 S04 冷却返还在同一入口结算。
   */
  private stepSaria(stepSeconds: number): void {
    const saria = this.saria;
    if (!saria) return;
    const result = saria.step(stepSeconds, this.playerHealth);
    if (result.fieldDamageTicks > 0) {
      this.applyCalciumFieldDamage(result.fieldDamageTicks);
    }
    if (result.fieldHealCooldownReduction > 0) {
      this.showSkillLabel(
        `充能循环 · K 冷却 −${hudValue(result.fieldHealCooldownReduction)}s`,
      );
    }
    this.syncCalciumFieldVisual();
  }

  /**
   * S02：领域每秒伤害。目标已由领域半径筛选，法伤统一走 `enemyDamageMultiplier`，
   * 因此领域内的 16 法伤同样享受 +30%，且不会叠加两次。
   */
  private applyCalciumFieldDamage(ticks: number): void {
    const saria = this.saria;
    if (!saria?.isCalciumFieldActive) return;
    const position = this.motion.position;
    const hits = resolveSariaAreaDamage(
      position,
      saria.fieldRadius,
      saria.fieldDamagePerSecond * ticks,
      'magic',
      this.collectTargets(),
      {
        damageMultiplier: this.skillDamageMultiplier(),
        magicDamageMultiplier: (targetId) =>
          this.enemyDamageMultiplier(targetId, 'magic'),
        lineOfSight: (from, to) => hasLineOfSight(this.layout, from, to),
      },
    );
    if (hits.length === 0) return;
    this.showExplosion(position.x, position.y, saria.fieldRadius, 0xffd166);
    for (const hit of hits) this.showHitResult(hit.targetId, hit.result);
  }

  /**
   * S01：K 的实际治疗量按 80% 转化为半径 100 的法伤。
   * `healShockDamage` 已由纯逻辑层按实际治疗量计算，满血时为 0 不触发。
   */
  private applyHealShock(damage: number): void {
    const saria = this.saria;
    if (!saria || !(damage > 0)) return;
    const position = this.motion.position;
    const hits = resolveSariaAreaDamage(
      position,
      saria.healShockRadius,
      damage,
      'magic',
      this.collectTargets(),
      {
        damageMultiplier: this.skillDamageMultiplier(),
        magicDamageMultiplier: (targetId) =>
          this.enemyDamageMultiplier(targetId, 'magic'),
        lineOfSight: (from, to) => hasLineOfSight(this.layout, from, to),
      },
    );
    if (hits.length === 0) return;
    this.showExplosion(position.x, position.y, saria.healShockRadius, 0xffb3c1);
    for (const hit of hits) this.showHitResult(hit.targetId, hit.result);
  }

  /**
   * S03：护盾实际吸收伤害时触发一次半径 85、18 物伤反击。
   * 纯逻辑层负责 0.8 秒内置冷却；物理伤害不读取领域法伤增益。
   */
  private handleSariaShieldAbsorb(result: DamageResult): void {
    const saria = this.saria;
    if (!saria || !saria.registerShieldAbsorb(result.shieldAbsorbed)) return;
    const position = this.motion.position;
    const hits = resolveSariaAreaDamage(
      position,
      saria.shieldCounterRadius,
      saria.shieldCounterDamage,
      'physical',
      this.collectTargets(),
      {
        damageMultiplier: this.skillDamageMultiplier(),
        lineOfSight: (from, to) => hasLineOfSight(this.layout, from, to),
      },
    );
    this.showExplosion(
      position.x,
      position.y,
      saria.shieldCounterRadius,
      0x9be8ff,
    );
    this.showSkillLabel('坚盾反击');
    for (const hit of hits) this.showHitResult(hit.targetId, hit.result);
  }

  /**
   * 缪尔赛思主流形每步推进：跟随玩家、自动攻击射程内最近敌人、K 冷却。
   * 攻击伤害已在纯逻辑层结算，场景只播放水弹/近战脉冲与伤害结果。
   */
  private stepMuelsyse(stepSeconds: number): void {
    const muelsyse = this.muelsyse;
    if (!muelsyse) return;

    if (this.formCastSeconds > 0) {
      this.formCastSeconds = Math.max(0, this.formCastSeconds - stepSeconds);
    }

    // H07：主流形生命归零消失时按消失前坐标爆破；召唤/复活不算。
    const formWasAlive = muelsyse.isFormAlive;
    const formPositionBefore = muelsyse.formPosition;
    const result = muelsyse.step(stepSeconds, {
      player: this.motion.position,
      targets: this.collectTargets(),
      // G01「所有自身与召唤物伤害」也作用于主流形与副本。
      damageMultiplier: this.skillDamageMultiplier(),
      // Boss 的眩晕/束缚转为减速，且免疫近战 L 的强制位移。
      isBoss: (targetId) => this.isBossTarget(targetId),
    });

    if (formWasAlive && !muelsyse.isFormAlive) {
      this.tryH07SummonBlast(formPositionBefore);
    }

    for (const attack of result.attacks) {
      // 只有主流形施法会改变本体姿势，副本攻击不带动主流形。
      if (attack.source === 'form') this.formCastSeconds = 0.16;
      this.renderMuelsyseAttack(attack);
      this.showHitResult(attack.targetId, attack.result);
    }

    // M02 生态复苏：每秒回复量以绿色浮字提示，方便与承伤区分。
    if (result.formHealed > 0) this.showFormHeal(result.formHealed);

    for (const pull of result.pulls) {
      const moved = this.enemySystem.pullToward(
        pull.targetId,
        { x: pull.towardX, y: pull.towardY },
        pull.distance,
      );
      if (moved > 0) {
        this.renderMuelsysePull(pull.fromX, pull.fromY, pull.towardX, pull.towardY);
        this.showStunLabel(pull.targetId, pull.stunSeconds);
      }
    }

    if (result.spawnedCopies > 0) {
      this.showSkillLabel('流形分裂 · 副本生成');
    }
    if (result.spawnedCorePhantom) {
      this.showSkillLabel('群落意志 · 幻影复制', '#9df2dd');
    }

    if (result.teleported) {
      const position = muelsyse.formPosition;
      const pulse = this.add
        .circle(position.x, position.y, 26, 0x5fd8d0, 0.25)
        .setDepth(5);
      this.tweens.add({
        targets: pulse,
        scale: 1.6,
        alpha: 0,
        duration: 240,
        onComplete: () => pulse.destroy(),
      });
    }

    this.syncMuelsyseForm();
    this.syncMuelsyseCopies();
    this.syncCorePhantom();
  }

  /** 目标是否为 Boss；用于控制转换与强制位移免疫。 */
  private isBossTarget(targetId: string): boolean {
    return this.enemies.some(
      (enemy) => enemy.unit.combatant.id === targetId && enemy.unit.enemy.id === 'boss',
    );
  }

  /** 近战 L 拉拽表现：从敌人位置向主流形绘一条短暂的水色牵引线。 */
  private renderMuelsysePull(
    fromX: number,
    fromY: number,
    towardX: number,
    towardY: number,
  ): void {
    const line = this.add
      .line(0, 0, fromX, fromY, towardX, towardY, 0x9df2dd, 0.65)
      .setOrigin(0, 0)
      .setDepth(6);
    this.tweens.add({
      targets: line,
      alpha: 0,
      duration: 220,
      onComplete: () => line.destroy(),
    });
  }

  /** 主流形攻击表现：近战为水色脉冲，远程为飞向目标的水弹。 */
  private renderMuelsyseAttack(attack: MuelsyseAttackEvent): void {
    if (attack.form === 'melee') {
      const pulse = this.add
        .circle(attack.fromX, attack.fromY, 26, 0x5fd8d0, 0.2)
        .setStrokeStyle(2, 0xa9f0c8, 0.8)
        .setDepth(6);
      this.tweens.add({
        targets: pulse,
        scale: 1.35,
        alpha: 0,
        duration: 220,
        onComplete: () => pulse.destroy(),
      });
      return;
    }

    const bolt = this.add
      .circle(attack.fromX, attack.fromY, 5, 0x5fd8d0)
      .setStrokeStyle(1.5, 0xb9fff7)
      .setDepth(6);
    this.tweens.add({
      targets: bolt,
      x: attack.toX,
      y: attack.toY,
      duration: 120,
      onComplete: () => {
        bolt.destroy();
        const splash = this.add
          .circle(attack.toX, attack.toY, 9, 0x9df2dd, 0.4)
          .setDepth(6);
        this.tweens.add({
          targets: splash,
          scale: 1.5,
          alpha: 0,
          duration: 180,
          onComplete: () => splash.destroy(),
        });
      },
    });
  }

  /**
   * 主流形视觉与玩家精灵表共用 Q 版轮廓，用青绿色半透明表现水形分身。
   * 死亡时整组隐藏，重建后恢复；血条与窃取层数跟随流形位置。
   */
  private syncMuelsyseForm(): void {
    const muelsyse = this.muelsyse;
    const sprite = this.formSprite;
    if (!muelsyse || !sprite) return;

    const alive = muelsyse.isFormAlive;
    const position = muelsyse.formPosition;
    const art = playerArtFor('muelsyse');
    const marker = FORM_MARKERS[muelsyse.form];
    sprite.setVisible(alive);
    this.formShadow?.setVisible(alive);
    this.formFootMark?.setVisible(alive);
    this.formHpBackground?.setVisible(alive);
    this.formHpFill?.setVisible(alive);
    this.formLabel?.setVisible(alive);
    this.formMarkerRing?.setVisible(alive);
    this.formMarkerInnerRing?.setVisible(alive);
    this.formFacingGraphics?.setVisible(alive);
    if (!alive) {
      this.formFacingGraphics?.clear();
      return;
    }

    sprite.setPosition(position.x, position.y - PLAYER.bodyCenterOffsetY);
    sprite.setTint(
      muelsyse.form === 'melee' ? MUELSYSE_MELEE_TINT : MUELSYSE_RANGED_TINT,
    );
    this.formShadow?.setPosition(position.x, position.y + 10);
    this.formFootMark?.setPosition(position.x, position.y + 10);
    this.formHpBackground?.setPosition(position.x - 22, position.y - 52);
    this.formHpFill?.setPosition(position.x - 22, position.y - 52);
    this.formLabel?.setPosition(position.x, position.y - FORM_LABEL_OFFSET_Y);
    this.formMarkerRing
      ?.setPosition(position.x, position.y)
      .setStrokeStyle(marker.ringWidth, MUELSYSE_FOOT_MARK_STROKE, marker.ringAlpha);
    this.formMarkerInnerRing?.setPosition(position.x, position.y);
    const ratio = Math.min(1, Math.max(0, muelsyse.formHealth / muelsyse.formMaxHealth));
    this.formHpFill?.setSize(44 * ratio, 6);
    if (this.formFacingGraphics) {
      this.drawFacingIndicator(
        this.formFacingGraphics,
        position,
        muelsyse.formFacing,
        MUELSYSE_FOOT_MARK_COLOR,
      );
    }

    const direction = facingToSpriteDirection(muelsyse.formFacing);
    const action = this.formCastSeconds > 0 ? 'attack' : 'idle';
    sprite.setFrame(
      playerFrameIndex(
        direction,
        action,
        action === 'idle' ? Math.floor(this.simulatedSeconds * 3) % 2 : 0,
        art,
      ),
    );

    const formName = muelsyse.form === 'melee' ? '近战流形' : '远程流形';
    const stacks =
      muelsyse.form === 'melee'
        ? ` · 窃取 ${muelsyse.formStacks}/${muelsyse.maxMeleeStacks}`
        : '';
    this.formLabel?.setText(
      `${marker.glyph} ${formName} ${hudValue(muelsyse.formHealth)}/${muelsyse.formMaxHealth}${stacks}`,
    );

    // 近战 L 的拉拽范围提示跟随主流形，只在生效期间显示。
    const lRing = this.muelsyseLRing;
    if (lRing) {
      const showRing =
        alive && muelsyse.form === 'melee' && muelsyse.isShallowAdaptationActive;
      lRing.setVisible(showRing);
      if (showRing) {
        lRing.setRadius(muelsyse.meleePullRadius);
        lRing.setPosition(position.x, position.y);
      }
    }
  }

  /**
   * 同步远程副本视觉：按快照创建/移动/回收，寿命直接显示在副本上方。
   * 逻辑层的副本数组是唯一真源，视觉只消费快照。
   */
  private syncMuelsyseCopies(): void {
    const muelsyse = this.muelsyse;
    if (!muelsyse) return;
    const art = playerArtFor('muelsyse');

    const seen = new Set<string>();
    for (const copy of muelsyse.copies) {
      seen.add(copy.id);
      let view = this.muelsyseCopyViews.get(copy.id);
      if (!view) {
        const sprite = this.add
          .sprite(
            copy.x,
            copy.y - PLAYER.bodyCenterOffsetY,
            ASSET_KEYS.playerMuelsyse,
            playerFrameIndex('down', 'idle', 0, art),
          )
          .setOrigin(art.originX, art.originY)
          .setScale(MUELSYSE_COPY_DISPLAY_SCALE)
          .setTint(MUELSYSE_RANGED_TINT)
          .setAlpha(MUELSYSE_COPY_ALPHA)
          .setDepth(5);
        const footMark = this.add
          .ellipse(
            copy.x,
            copy.y + 10,
            MUELSYSE_COPY_FOOT_MARK.radiusX * 2,
            MUELSYSE_COPY_FOOT_MARK.radiusY * 2,
            MUELSYSE_FOOT_MARK_COLOR,
            0.07,
          )
          .setStrokeStyle(1, MUELSYSE_FOOT_MARK_STROKE, 0.45)
          .setDepth(4);
        // 副本用细圈 + 空心菱形短标签，与主流形双圈区分。
        const ring = this.add
          .circle(copy.x, copy.y, MARKER_RING_RADIUS.copy, 0x000000, 0)
          .setStrokeStyle(
            COPY_MARKER.ringWidth,
            MUELSYSE_FOOT_MARK_STROKE,
            COPY_MARKER.ringAlpha,
          )
          .setDepth(4);
        const label = this.add
          .text(copy.x, copy.y - 54, '', {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#9df2dd',
            stroke: '#16211f',
            strokeThickness: 3,
          })
          .setOrigin(0.5)
          .setDepth(7);
        view = { sprite, footMark, ring, label };
        this.muelsyseCopyViews.set(copy.id, view);
      }
      view.sprite.setPosition(copy.x, copy.y - PLAYER.bodyCenterOffsetY);
      view.footMark.setPosition(copy.x, copy.y + 10);
      view.ring.setPosition(copy.x, copy.y);
      view.label
        .setPosition(copy.x, copy.y - 54)
        .setText(`${COPY_MARKER.glyph} ${COPY_MARKER.label} ${copy.remainingSeconds.toFixed(1)}s`);
      const frameAction = 'idle';
      view.sprite.setFrame(
        playerFrameIndex(
          facingToSpriteDirection(muelsyse.formFacing),
          frameAction,
          Math.floor(this.simulatedSeconds * 3) % 2,
          art,
        ),
      );
    }

    for (const [id, view] of this.muelsyseCopyViews) {
      if (seen.has(id)) continue;
      view.sprite.destroy();
      view.footMark.destroy();
      view.ring.destroy();
      view.label.destroy();
      this.muelsyseCopyViews.delete(id);
    }
  }

  /**
   * E04 幻影占位视觉：半透明圆 + 剩余寿命短标签。
   * 不存在时销毁视图；美术延期阶段不新绘精灵表。
   */
  private syncCorePhantom(): void {
    const phantom = this.muelsyse?.corePhantom ?? null;
    if (!phantom) {
      if (this.corePhantomVisual) {
        this.corePhantomVisual.body.destroy();
        this.corePhantomVisual.label.destroy();
        this.corePhantomVisual = null;
      }
      return;
    }

    if (!this.corePhantomVisual) {
      const body = this.add
        .image(phantom.x, phantom.y, 'item-art-S09').setDisplaySize(38, 38).setAlpha(0.7)
        .setDepth(5);
      const label = this.add
        .text(phantom.x, phantom.y - 34, '', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#9df2dd',
          stroke: '#16211f',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(7);
      this.corePhantomVisual = { body, label };
    }
    this.corePhantomVisual.body.setPosition(phantom.x, phantom.y);
    this.corePhantomVisual.label
      .setPosition(phantom.x, phantom.y - 34)
      .setText(`幻影 ${phantom.remainingSeconds.toFixed(1)}s`);
  }

  /**
   * R05 潮生母巢：推进小流形计时与寿命，并让它在射程内攻击最近的敌人。
   * 纯逻辑只负责周期/寿命/tick；索敌复用炮台同一套规则，伤害走召唤物倍率。
   */
  private stepR05Flowform(stepSeconds: number): void {
    const visualBefore = this.r05FlowformVisual;
    const step = this.craftedEffects.stepFlowform(
      stepSeconds,
      this.motion.position,
    );
    if (!step.active && visualBefore) {
      // H07：小流形到期时在原位置爆破；视觉在 sync 里随后回收。
      this.tryH07SummonBlast({
        x: visualBefore.body.x,
        y: visualBefore.body.y,
      });
    }
    if (step.spawned) {
      this.showSkillLabel('潮生母巢 · 小流形生成', '#9df2dd');
    }
    if (step.ticks > 0) {
      const origin = { x: step.x, y: step.y };
      const target = findTurretTarget(
        origin,
        this.enemies.map((enemy) => enemy.unit.combatant),
        {
          range: R05_FLOWFORM_RANGE,
          lineOfSight: (from, to) => hasLineOfSight(this.layout, from, to),
        },
      );
      if (target) {
        const rawDamage =
          R05_FLOWFORM_DAMAGE *
          step.ticks *
          this.skillDamageMultiplier() *
          this.stats.summonDamageMultiplier;
        const source = this.damageChains.beginNative('R05');
        const result = target.applyDamage(
          rawDamage *
            this.enemyDamageMultiplier(target.id, 'magic', origin),
          'magic',
          source,
        );
        this.showHitResult(target.id, result);
        this.renderR05FlowformShot(origin, target);
      }
    }
    this.syncR05FlowformVisual(step);
  }

  /** 小流形开火表现：本体到目标的短暂水色曳光。 */
  private renderR05FlowformShot(
    origin: CombatPoint,
    target: CombatPoint,
  ): void {
    const tracer = this.add
      .line(0, 0, origin.x, origin.y, target.x, target.y, 0x9df2dd, 0.55)
      .setOrigin(0, 0)
      .setDepth(6);
    this.tweens.add({
      targets: tracer,
      alpha: 0,
      duration: 120,
      onComplete: () => tracer.destroy(),
    });
  }

  /** R05 小流形占位视觉：水色圆与剩余寿命；结束后回收。 */
  private syncR05FlowformVisual(step: {
    readonly active: boolean;
    readonly x: number;
    readonly y: number;
    readonly remainingSeconds: number;
  }): void {
    if (!step.active) {
      if (this.r05FlowformVisual) {
        this.r05FlowformVisual.body.destroy();
        this.r05FlowformVisual.label.destroy();
        this.r05FlowformVisual = null;
      }
      return;
    }

    if (!this.r05FlowformVisual) {
      const body = this.add
        .image(step.x, step.y, 'item-art-S09').setDisplaySize(30, 30).setTint(0x8affcc).setAlpha(0.8)
        .setDepth(5);
      const label = this.add
        .text(step.x, step.y - 32, '', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#9df2dd',
          stroke: '#16211f',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(7);
      this.r05FlowformVisual = { body, label };
    }
    this.r05FlowformVisual.body.setPosition(step.x, step.y);
    this.r05FlowformVisual.label
      .setPosition(step.x, step.y - 32)
      .setText(`小流形 ${step.remainingSeconds.toFixed(1)}s`);
  }

  /** 主流形被近战敌人击中：伤害数字显示在流形上方并短暂闪红。 */
  private showFormDamage(result: DamageResult): void {    if (!result.applied) return;
    const position = this.muelsyse?.formPosition;
    if (!position) return;
    this.showDamageNumber(position.x, position.y - 20, result.damage);
    this.formSprite?.setTintFill(0xff8a8a);
    this.time.delayedCall(90, () => {
      if (this.formSprite?.active) this.syncMuelsyseForm();
    });
  }

  /** 主流形回复：绿色浮字，与红色受击数字区分。 */
  private showFormHeal(amount: number): void {
    const position = this.muelsyse?.formPosition;
    if (!position || !(amount > 0)) return;
    const text = this.add
      .text(position.x, position.y - 26, `+${hudValue(amount)}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#7ee787',
        stroke: '#16211f',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({
      targets: text,
      y: text.y - 18,
      alpha: 0,
      duration: 620,
      onComplete: () => text.destroy(),
    });
  }

  /** 钙质化范围提示：只在生效期间显示，圆心始终与玩家同步。 */
  private syncCalciumFieldVisual(): void {
    const visual = this.calciumFieldVisual;
    if (!visual) return;
    const active = this.saria?.isCalciumFieldActive ?? false;
    visual.setVisible(active);
    if (!active) return;
    const position = this.motion.position;
    visual.setPosition(position.x, position.y);
  }

  /** 钙质化领域跟随玩家：以当前玩家位置为圆心实时判定敌人是否在领域内。 */
  private isEnemyInCalciumField(enemyId: string): boolean {
    const saria = this.saria;
    if (!saria?.isCalciumFieldActive) return false;
    const view = this.enemies.find((enemy) => enemy.unit.combatant.id === enemyId);
    if (!view) return false;
    const position = this.motion.position;
    return isInsideCalciumField(
      { x: position.x, y: position.y, radius: saria.fieldRadius },
      view.unit.combatant,
    );
  }

  /** 领域内敌人减速倍率；离开或领域结束立即回到 1，不累计。 */
  private enemySlowMultiplierFromField(enemyId: string): number {
    return calciumFieldSlowMultiplier(
      this.isEnemyInCalciumField(enemyId),
      this.saria?.enemySlowPercent ?? 0,
    );
  }

  /** 领域内敌人受法伤倍率；不会写回敌人状态，因此离开即失效。 */
  private enemyMagicMultiplierFromField(enemyId: string): number {
    return calciumFieldMagicMultiplier(
      this.isEnemyInCalciumField(enemyId),
      this.saria?.enemyMagicVulnerability ?? 0,
    );
  }

  /**
   * 所有对敌伤害的统一增伤入口：魔法伤害读取钙质化领域 ×1.3；
   * S12 赏金标记目标再 ×(1+15%)；命中盾壳蟹背侧弱点时再乘 1.5。
   * 每个来源只经过这里一次，避免重复乘算。
   */
  private enemyDamageMultiplier(
    enemyId: string,
    damageType: DamageType,
    hitOrigin?: { readonly x: number; readonly y: number },
  ): number {
    const fieldMultiplier =
      damageType === 'magic' ? this.enemyMagicMultiplierFromField(enemyId) : 1;
    const markedMultiplier = this.bountyMark.damageMultiplierFor(enemyId);
    const baseMultiplier = fieldMultiplier * markedMultiplier;
    if (!hitOrigin) return baseMultiplier;
    const view = this.enemies.find(
      (enemy) => enemy.unit.combatant.id === enemyId,
    );
    if (view && isBulwarkWeakPointHit(view.unit, hitOrigin)) {
      return baseMultiplier * BULWARK_WEAK_DAMAGE_MULTIPLIER;
    }
    return baseMultiplier;
  }

  /**
   * 塞雷娅 J 盾击：结算面前扇区的物理伤害与普通敌人击退，再播放扇区提示。
   * 不生成弹体；命中结果直接驱动伤害数字、击杀与经验掉落。
   */
  private performShieldBash(
    attack: AttackDefinition,
    countsForCoreJ = true,
    counterDamage = 0,
  ): void {
    const origin = this.motion.position;
    const facing = this.motion.facingDirection;
    // 盾击没有弹体事件链；E08 需要一个原生 J 来源来区分 G06 复制的盾击。
    const coreSource = countsForCoreJ
      ? this.damageChains.beginNative('J')
      : null;
    const targets = this.enemies.map((enemy) => ({
      combatant: enemy.unit.combatant,
      isElite: enemy.unit.enemy.elite === true,
    }));
    const chest = this.chest?.chest;
    if (chest?.isAlive) targets.push({ combatant: chest, isElite: false });
    // H13/H21 只认敌人：盾击可以打宝箱，但宝箱不是 J 命中。
    const enemyIds = new Set(
      this.enemies.map((enemy) => enemy.unit.combatant.id),
    );
    let barrageTriggered = false;
    // H40 守护转攻：盾击本体伤害 +35%，只作用于物理段，不放大领域/护盾附加法伤。
    const bashAttack = this.knightHexes.boostShieldBashDamage(
      this.applyItemRange(attack),
    );
    // 领域生效期间 J 追加 10 法伤；H42 再按当前护盾附加 15%，单次上限 30。
    const fieldBonusMagic = this.saria?.isCalciumFieldActive
      ? this.saria.attackBonusMagicDamage
      : 0;
    const fortressBonusMagic = this.knightHexes.shieldBashMagicDamage(
      this.playerHealth.shield,
    );
    const hits = resolveShieldBash(
      origin,
      facing,
      targets,
      bashAttack,
      this.jDamageMultiplier(),
      {
        bonusMagicDamage: fieldBonusMagic + fortressBonusMagic,
        magicDamageMultiplier: (targetId) =>
          this.enemyDamageMultiplier(targetId, 'magic'),
        // H13 连续命中按目标逐次结算；G06 复制的盾击不登记 J 命中。
        damageMultiplierFor: countsForCoreJ
          ? (targetId) => {
              if (!enemyIds.has(targetId)) return 1;
              const registration = this.combatHexes.registerJHit(targetId);
              if (registration.barrage) barrageTriggered = true;
              return registration.damageMultiplier;
            }
          : undefined,
      },
    );

    let counterApplied = false;
    for (const hit of hits) {
      const combined = combineDamageResults(hit.result, hit.bonusMagicResult);
      this.showHitResult(hit.targetId, combined);
      // R01：盾击同样消费蓄势，但只对首个命中目标追加一次物伤。
      if (!counterApplied && counterDamage > 0 && coreSource) {
        this.applyCraftedCounterDamage(hit.targetId, counterDamage, coreSource);
        counterApplied = true;
      }
      if (hit.knockbackDistance > 0) {
        this.enemySystem.knockback(hit.targetId, origin, hit.knockbackDistance);
      }
      // 宝箱不是 J 命中；只统计敌人。
      if (coreSource) {
        const enemy = this.enemies.find(
          (entry) => entry.unit.combatant.id === hit.targetId,
        );
        if (enemy) {
          this.recordCoreJHit(coreSource, bashAttack);
          // I21 盾击命中也计入每第 6 次 J 命中；弹射伤害不再登记。
          this.tryItemRicochet(hit.targetId, combined.damage, coreSource);
          // S09 只复制盾击本体的物理伤害，不含领域追加法伤。
          this.applyWaterMirrorEcho(
            enemy.unit.combatant,
            hit.result,
            attack.damageType,
            coreSource,
          );
        }
      }
    }

    if (barrageTriggered && coreSource) this.spawnH21Barrage(coreSource);

    this.showShieldBashArc(origin, facing, attack);
  }

  /**
   * H41 重盾远投：本次 J 变为穿透飞盾——180 距离、60% 伤害、遵循轻自瞄。
   * 走原生 J 弹体路径，命中计数、E08/I21/S09 与普通 J 共用同一条来源链；
   * 飞盾不参与 H14 折返（骑士 J 本就按近战过滤弹道类海克斯）。
   */
  private performShieldThrow(attack: AttackDefinition): void {
    const origin = this.motion.position;
    const facing = this.motion.facingDirection;
    const throwAttack = this.knightHexes.buildThrowAttack(
      this.applyItemRange(attack),
    );
    const aim = this.resolveShotAim(origin, facing, throwAttack.range);
    const state = createProjectile(
      this.nextProjectileId,
      origin,
      facing,
      throwAttack,
      { pierce: this.knightHexes.throwPierce, direction: aim.direction },
    );
    this.nextProjectileId += 1;
    this.lastShot = {
      targetId: aim.target?.id ?? null,
      angleDegrees: aim.angleDegrees,
      radius: state.radius,
    };
    const colors = characterEffectColors(this.character.id);
    const sprite = this.add
      .circle(
        origin.x,
        origin.y,
        projectileVisualRadius(state.radius),
        colors.projectileFill,
      )
      .setStrokeStyle(1.5, colors.projectileStroke)
      .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
    this.projectiles.push({
      state,
      sprite,
      source: 'J',
      eventSource: this.damageChains.beginNative('J'),
      r01CounterDamage: this.consumeCraftedCounterDamage(),
    });
    this.playSfx(COMBAT_SFX.attack);
    this.showSkillLabel('重盾远投 · 穿透飞盾', '#9be8ff');
  }

  /** 盾击的扇形提示：张角与命中判定同源，玩家可据此判断面向。 */
  private showShieldBashArc(
    origin: { x: number; y: number },
    facing: Facing,
    attack: AttackDefinition,
  ): void {
    const vector = FACING_VECTORS[facing];
    const centerAngle = Phaser.Math.RadToDeg(Math.atan2(vector.y, vector.x));
    const halfAngle = (attack.arcDegrees ?? 120) / 2;
    const arc = this.add
      .arc(
        origin.x,
        origin.y,
        attack.range,
        centerAngle - halfAngle,
        centerAngle + halfAngle,
        false,
        0xffd166,
        0.16,
      )
      .setStrokeStyle(2, 0xffe6a8, 0.8)
      .setDepth(7);
    this.tweens.add({
      targets: arc,
      alpha: 0,
      duration: 160,
      onComplete: () => arc.destroy(),
    });
  }

  /** 魂灵推进：每 1.5 秒的附着 tick 播放脉冲，到期移除视觉。 */
  private stepSoul(stepSeconds: number): void {
    if (!this.soul) return;
    const result = this.soul.step(
      stepSeconds,
      this.collectTargets(),
      this.motion.position,
    );
    // H28 魂灵游行：逻辑位置每步跟随，视觉同步到同一坐标；
    // 未拥有 H28 时位置不变，此循环只做无副作用的同步。
    for (const soul of this.soul.snapshots) {
      const view = this.soulVisuals.get(soul.id);
      if (!view) continue;
      view.body.setPosition(soul.x, soul.y);
      view.ring.setPosition(soul.x, soul.y);
    }
    for (const tick of result.ticks) this.renderSoulTick(tick);
    for (const soulId of result.expiredSoulIds) {
      const view = this.soulVisuals.get(soulId);
      if (view) this.tryH07SummonBlast({ x: view.body.x, y: view.body.y });
      this.removeSoulVisual(soulId);
    }
  }

  /**
   * H07 分身礼炮：召唤物消失时在消失点产生 50 法伤爆破。
   * 统一触发闸门按「每秒全局最多 2 次」统计，超出上限的消失不产生爆破。
   */
  private tryH07SummonBlast(position: CombatPoint): void {
    if (!this.combatHexes.has('H07')) return;
    const decision = this.triggerGates.tryTrigger(H07_TRIGGER_RULE.id);
    if (!decision.allowed) return;
    const params = COMBAT_HEX_PARAMS.H07;
    const damage = params.summonBlastDamage ?? 50;
    const radius = params.summonBlastRadius ?? 100;
    const radiusSquared = radius * radius;
    const source = this.damageChains.beginNative('H07');
    for (const target of this.collectTargets()) {
      if (!target.isAlive) continue;
      const dx = target.x - position.x;
      const dy = target.y - position.y;
      if (dx * dx + dy * dy > radiusSquared) continue;
      const result = target.applyDamage(
        damage *
          this.enemyDamageMultiplier(target.id, 'magic', position),
        'magic',
        source,
      );
      this.showHitResult(target.id, result);
    }
    this.showExplosion(position.x, position.y, radius, 0xffa8d8);
    this.showSkillLabel('分身礼炮 · 50 法伤', '#ffa8d8');
  }

  /**
   * H18 濒危爆发：玩家生命首次低于 35% 时，以自身为中心对半径 140 内
   * 目标造成 120 法术伤害；每波一次，是否触发由纯逻辑模块判定。
   */
  private applyLowHealthBurst(): void {
    const params = COMBAT_HEX_PARAMS.H18;
    const damage = params.burstDamage ?? 120;
    const radius = params.burstRadius ?? 140;
    const radiusSquared = radius * radius;
    const origin = this.motion.position;
    const source = this.damageChains.beginNative('H18');
    for (const target of this.collectTargets()) {
      if (!target.isAlive) continue;
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      if (dx * dx + dy * dy > radiusSquared) continue;
      const result = target.applyDamage(
        damage * this.enemyDamageMultiplier(target.id, 'magic', origin),
        'magic',
        source,
      );
      this.showHitResult(target.id, result);
    }
    this.showExplosion(origin.x, origin.y, radius, 0x8ab4ff);
    this.showSkillLabel(`濒危爆发 · ${damage} 法伤`, '#8ab4ff');
  }

  /** 角色专属资源行：维什戴尔魂灵、阿米娅情绪吸收、塞雷娅护盾、缪尔赛思流形。 */
  private syncBurstHud(): void {
    const resource = this.characterResourceText();
    this.dispatchHud({
      type: 'resource',
      text: resource.text,
      color: resource.color,
    });
  }

  /** L/角色技能的长状态说明；生效或虚弱窗口才显示。 */
  private syncChimeraHud(): void {
    const detail = this.characterSkillDetail();
    this.dispatchHud({
      type: 'skill-detail',
      text: detail.text,
      color: detail.color,
    });
  }

  private stepProjectiles(stepSeconds: number): void {
    const survivors: ProjectileView[] = [];

    for (const entry of this.projectiles) {
      const status = stepProjectile(entry.state, stepSeconds, this.layout);
      entry.sprite.setPosition(entry.state.x, entry.state.y);

      // 同一子步内多个目标重叠时按离弹体最近者结算（宝箱与敌人同线同理）。
      const candidates: Combatant[] = this.enemies.map(
        (enemy) => enemy.unit.combatant,
      );
      const chest = this.chest?.chest;
      if (chest) candidates.push(chest);
      let hitTarget: Combatant | null = null;
      let hitDistance = Number.POSITIVE_INFINITY;
      for (const target of candidates) {
        if (!target.isAlive || entry.state.hitTargetIds.has(target.id)) continue;
        if (!projectileHitsTarget(entry.state, target)) continue;
        const dx = target.x - entry.state.x;
        const dy = target.y - entry.state.y;
        const distance = dx * dx + dy * dy;
        if (distance < hitDistance) {
          hitDistance = distance;
          hitTarget = target;
        }
      }
      const hitEnemy =
        hitTarget && hitTarget.kind !== 'chest'
          ? this.enemies.find((enemy) => enemy.unit.combatant === hitTarget) ?? null
          : null;
      // 原生 J 命中才计入 H13/H21；H14 返程弹与 H21 触发弹都不计数。
      const nativeJHit =
        hitEnemy !== null &&
        entry.source === 'J' &&
        entry.state.returning !== true;
      const jHit = nativeJHit
        ? this.combatHexes.registerJHit(hitTarget?.id ?? '')
        : null;
      if (hitTarget) {
        if (
          this.grenade &&
          entry.source !== 'S11' &&
          entry.source !== 'H21'
        ) {
          entry.sprite.destroy();
          // 维什戴尔：榴弹直接命中按溅射与余震规则结算。
          // E01 蓄力时只放大本次直接爆炸的半径，余震半径保持原值。
          // H13 连击与 H14 返程比例在这里折入本次攻击定义（溅射共享同一倍率）。
          const returnRatio =
            entry.state.returning === true
              ? entry.state.returnDamageRatio ?? 1
              : 1;
          const detonateAttack = this.scaleAttackDamage(
            entry.state.attack,
            returnRatio * (jHit?.damageMultiplier ?? 1),
          );
          const detonation = this.grenade.detonate(
            { x: entry.state.x, y: entry.state.y },
            hitTarget.id,
            this.collectTargets(),
            this.applyCoreExplosionRadius(detonateAttack),
          );
          this.renderDetonation(detonation);
          this.recordCoreExplosionHits(detonation.hits);
          // H30 烟花谢幕：爆裂黎明最后一发命中后，以本次爆炸半径为界
          // 排队 3 次各 60% 直接伤害的波纹；波纹本身不再产生新波纹。
          if (entry.h30Finale) {
            entry.h30Finale = false;
            if (
              this.bomberHexes.queueFinaleWaves(
                { x: detonation.x, y: detonation.y },
                detonation.splashRadius,
                detonateAttack.damage,
              )
            ) {
              this.showSkillLabel('烟花谢幕 · 3 次波纹', '#ffd166');
            }
          }
          // R01：反击附加伤害落在主目标身上；即使主目标已被爆炸击杀
          // 也不转移给其他溅射目标，且只结算一次。
          if (hitEnemy && entry.r01CounterDamage) {
            this.applyCraftedCounterDamage(
              hitTarget.id,
              entry.r01CounterDamage,
              entry.eventSource,
            );
            entry.r01CounterDamage = 0;
          }
          // E08 只认 J 的直接命中，溅射到的其他敌人不重复计数。
          if (nativeJHit) {
            this.recordCoreJHit(entry.eventSource, entry.state.attack);
            const primaryHit = detonation.hits.find(
              (hit) => hit.targetId === hitTarget.id,
            );
            this.tryItemRicochet(
              hitTarget.id,
              primaryHit?.damage.damage ?? 0,
              entry.eventSource,
            );
            // S09 只复制直接命中的 J 伤害，不复制爆炸溅射与余震。
            if (primaryHit) {
              this.applyWaterMirrorEcho(
                hitTarget,
                primaryHit.damage,
                entry.state.damageType,
                entry.eventSource,
              );
            }
          }
          if (jHit?.barrage) this.spawnH21Barrage(entry.eventSource);
        } else {
          // 阿米娅：直线术式只伤害命中的目标；G01 全局倍率与其他伤害同源。
          // 钙质化领域内的敌人受到法伤 +30%，统一由 `enemyDamageMultiplier` 乘一次。
          // S11 同一次施放对同一目标的后续弹只吃 35%，由共享的 volley 记账决定。
          const shotgunMultiplier =
            entry.source === 'S11' && entry.shotgunVolley
              ? entry.shotgunVolley.damageMultiplierOnHit(hitTarget.id)
              : 1;
          if (shotgunMultiplier < 1) this.shotgunRepeatedHits += 1;
          const result = resolveProjectileHit(
            entry.state,
            hitTarget,
            this.playerProjectileDamageMultiplier(entry.source) *
              shotgunMultiplier *
              (jHit?.damageMultiplier ?? 1) *
              this.enemyDamageMultiplier(
                hitTarget.id,
                entry.state.damageType,
                { x: entry.state.x, y: entry.state.y },
              ),
            entry.eventSource,
          );
          this.showHitResult(hitTarget.id, result);
          // R01：反击附加物伤只跟随主弹，命中首个目标后清零；
          // 穿透弹不会对后续目标重复结算。
          if (entry.r01CounterDamage) {
            this.applyCraftedCounterDamage(
              hitTarget.id,
              entry.r01CounterDamage,
              entry.eventSource,
            );
            entry.r01CounterDamage = 0;
          }
          // E08 折光王冠：只有原生 J 命中计数；侧弹是 derived，不会再次累计。
          if (nativeJHit) {
            this.recordCoreJHit(entry.eventSource, entry.state.attack);
            // I21 分叉导线：每第 6 次 J 命中向邻近敌人弹射 40% 法伤。
            this.tryItemRicochet(hitTarget.id, result.damage, entry.eventSource);
            // S09 替身复制本次 J 直击的 35%；派生 J（分裂/回响）不会再次复制。
            this.applyWaterMirrorEcho(
              hitTarget,
              result,
              entry.state.damageType,
              entry.eventSource,
            );
          }
          // H21 漂浮弹幕：每 12 次原生 J 命中从玩家位置发出 8 向弹幕；
          // 弹幕本身不登记 J 命中，因此不会递归触发。
          if (jHit?.barrage) this.spawnH21Barrage(entry.eventSource);
          if (
            hitEnemy &&
            isBulwarkWeakPointHit(hitEnemy.unit, {
              x: entry.state.x,
              y: entry.state.y,
            })
          ) {
            this.showSkillLabel('弱点命中');
          }
          if (nativeJHit && this.amiya) {
            // 同一发弹体穿透多个敌人也只累计一次情绪吸收。
            const absorption = this.amiya.registerJHit(entry.state.id);
            if (absorption.cooldownReducedSeconds > 0) {
              this.showSkillLabel('情绪吸收 · K 冷却 −1s');
            }
            // H35 暗星轨道：每 8 次原生 J 命中生成一个 4 秒环绕术式。
            const orbit = this.sorcererHexes.registerJHit();
            if (orbit.spawnedOrb) {
              this.showSkillLabel('暗星轨道 · 环绕术式', '#c77dff');
            }
          }
          // H36 失控奇美拉：奇美拉期间的 J/K 原生命中每第 4 次追加真伤；
          // 命中回调里只排队，逻辑步末尾再结算，避免重入与同帧连锁。
          if (hitEnemy && this.amiya?.isChimeraActive) {
            const chimeraHit =
              nativeJHit || entry.source === 'K';
            if (
              chimeraHit &&
              this.sorcererHexes.registerChimeraHit(hitTarget.id)
            ) {
              this.showSkillLabel('失控奇美拉 · 真伤', '#c77dff');
            }
          }
          if (nativeJHit && this.muelsyse) {
            // M04 水镜共鸣：主流形对 J 命中的目标补一次攻击，内置冷却 0.6 秒；
            // 补攻直接走主流形结算，不进入分裂计数，也不会再触发本分支。
            const echo = this.muelsyse.resolveWaterMirrorHit(hitEnemy.unit.combatant, {
              damageMultiplier: this.skillDamageMultiplier(),
              isBoss: (targetId) => this.isBossTarget(targetId),
            });
            if (echo) {
              this.formCastSeconds = 0.16;
              this.renderMuelsyseAttack(echo);
              this.showHitResult(echo.targetId, echo.result);
              this.showSkillLabel('水镜共鸣');
            }
          }
          // A01 穿透：还有剩余目标时保留弹体继续飞行，否则命中即消失。
          if (registerProjectileHit(entry.state, hitTarget.id)) {
            survivors.push(entry);
            continue;
          }
          entry.sprite.destroy();
        }
        continue;
      }

      if (status !== 'active') {
        // H14 折返弹：射程耗尽的原生 J 先调头，返程仍可命中但按 35% 结算。
        if (
          status === 'expired' &&
          entry.source === 'J' &&
          beginProjectileReturn(entry.state)
        ) {
          this.combatHexes.recordReturnStart();
          entry.sprite.setFillStyle(0xffd166, 1);
          survivors.push(entry);
          continue;
        }
        entry.sprite.destroy();
        continue;
      }

      survivors.push(entry);
    }

    this.projectiles = survivors;
    // 本步触发的 E08 侧弹从下一步开始飞行，避免在遍历中追加新弹体。
    if (this.pendingDerivedBullets.length > 0) {
      this.projectiles.push(...this.pendingDerivedBullets);
      this.pendingDerivedBullets = [];
    }
  }

  /** 直接命中：播放溅射、伤害数字与 0.35 秒余震预警圈。 */
  private renderDetonation(detonation: GrenadeDetonation): void {
    this.showExplosion(detonation.x, detonation.y, detonation.splashRadius, 0xffb347);
    for (const hit of detonation.hits) this.showHitResult(hit.targetId, hit.damage);
    if (detonation.aftershockDelaySeconds !== null && detonation.aftershockRadius !== null) {
      this.showAftershockTelegraph(
        detonation.x,
        detonation.y,
        detonation.aftershockDelaySeconds,
        detonation.aftershockRadius,
      );
    }
    // W01 的第二发余震单独预警，让 0.7 秒后的追加伤害有可见反馈。
    if (
      detonation.extraAftershockDelaySeconds !== null &&
      detonation.extraAftershockRadius !== null
    ) {
      this.showAftershockTelegraph(
        detonation.x,
        detonation.y,
        detonation.extraAftershockDelaySeconds,
        detonation.extraAftershockRadius,
      );
    }
    // I24 裂变火药：每第 5 次爆炸追加一次小爆炸。
    this.renderFissionExplosion(detonation.fissionExplosion);
    // R02 连锁反应堆：本次爆炸击杀产生的小爆炸。
    this.renderDeathExplosions(detonation.deathExplosions);
  }

  /** 延时余震：播放余震范围，并逐个播放残影引爆与眩晕。 */
  private renderAftershock(resolution: AftershockResolution): void {
    this.showExplosion(resolution.x, resolution.y, resolution.radius, 0xff7b4e);
    for (const hit of resolution.hits) this.showHitResult(hit.targetId, hit.damage);
    // 余震与残影引爆同样是玩家爆炸，参与 E01 的不同敌人计数。
    this.recordCoreExplosionHits(resolution.hits);
    this.renderFissionExplosion(resolution.fissionExplosion);
    // R02：余震击杀产生的小爆炸在残影引爆之后播放。
    this.renderDeathExplosions(resolution.deathExplosions);
    for (const explosion of resolution.explosions) {
      this.showExplosion(explosion.x, explosion.y, explosion.radius, 0xc77dff);
      for (const hit of explosion.hits) {
        this.showHitResult(hit.targetId, hit.damage);
        this.showStunLabel(hit.targetId, explosion.stunSeconds);
      }
      this.recordCoreExplosionHits(explosion.hits);
      this.renderFissionExplosion(explosion.fissionExplosion);
      this.renderDeathExplosions(explosion.deathExplosions);
      // W02 的扩散标记用短文本提示，否则只能靠血条状态察觉。
      if (explosion.spreadTargetIds.length > 0) {
        this.showSpreadLabel(explosion.x, explosion.y, explosion.spreadTargetIds.length);
      }
    }
  }

  /**
   * H30 烟花谢幕：结算到期的 3 次波纹。
   * 波纹直接走 `GrenadeSystem.applyRipple`，不登记爆炸次数、不生成 I24/R02
   * 小爆炸，也不会再排队新的波纹，因此整条谢幕链最多衍生这一层。
   */
  private stepFinaleWaves(stepSeconds: number): void {
    const grenade = this.grenade;
    if (!grenade) return;
    for (const wave of this.bomberHexes.stepFinaleWaves(stepSeconds)) {
      const hits = grenade.applyRipple(
        { x: wave.x, y: wave.y },
        wave.radius,
        wave.damage,
        this.character.attack.damageType,
        this.collectTargets(),
      );
      this.showExplosion(wave.x, wave.y, wave.radius, 0xffd166);
      for (const hit of hits) this.showHitResult(hit.targetId, hit.damage);
      this.showSkillLabel(`烟花谢幕 · 波纹 ${wave.index}`, '#ffd166', 18);
    }
  }

  /**
   * H35/H36：同步奇美拉状态、结算环绕术式 tick 与排队的追加真伤。
   * 全部在敌人步进后执行，命中回调只登记计数，避免重入敌人状态。
   */
  private stepSorcererHexEffects(stepSeconds: number): void {
    this.sorcererHexes.trackChimera(this.amiya?.isChimeraActive ?? false);

    if (this.sorcererHexes.activeOrbCount > 0) {
      this.sorcererOrbSource ??= this.damageChains.beginNative('H35');
    } else {
      this.sorcererOrbSource = null;
    }
    const tick = this.sorcererHexes.stepOrbs(stepSeconds);
    if (tick.ticks > 0) this.applySorcererOrbDamage(tick.damage);
    this.syncSorcererOrbVisuals(stepSeconds);

    for (const bonus of this.sorcererHexes.flushChimeraBonuses()) {
      const target = this.enemies.find(
        (enemy) => enemy.unit.combatant.id === bonus.targetId,
      )?.unit.combatant;
      // 目标已死或离场时随本次命中消耗，不改判其他敌人。
      if (!target || !target.isAlive) continue;
      const result = target.applyDamage(
        bonus.damage,
        'true',
        this.damageChains.beginNative('H36'),
      );
      this.showHitResult(target.id, result);
      this.showSkillLabel(`失控奇美拉 · ${bonus.damage} 真伤`, '#c77dff', 16);
    }
  }

  /** H35：每个环绕术式每秒对半径内所有敌人结算一次法术伤害。 */
  private applySorcererOrbDamage(damage: number): void {
    const center = this.motion.position;
    const source =
      this.sorcererOrbSource ?? this.damageChains.beginNative('H35');
    const rawDamage = damage * this.skillDamageMultiplier();
    for (const target of this.freeSkillCombatantsInRadius(
      SORCERER_H35_ORBIT_RADIUS,
      center,
    )) {
      const result = target.applyDamage(
        rawDamage *
          this.enemyDamageMultiplier(target.id, 'magic', center),
        'magic',
        source,
      );
      this.showHitResult(target.id, result);
    }
    this.showExplosion(
      center.x,
      center.y,
      SORCERER_H35_ORBIT_RADIUS,
      0x9d7bff,
    );
  }

  /** 同步 H35 环绕术式占位视觉：数量对齐逻辑状态，按角速度绕玩家旋转。 */
  private syncSorcererOrbVisuals(stepSeconds = 0): void {
    const count = this.sorcererHexes.activeOrbCount;
    this.sorcererOrbAngle += stepSeconds * 2.2;
    while (this.sorcererOrbVisuals.length > count) {
      this.sorcererOrbVisuals.pop()?.destroy();
    }
    while (this.sorcererOrbVisuals.length < count) {
      this.sorcererOrbVisuals.push(
        this.add
          .circle(0, 0, 5, 0x8a6bff, 0.9)
          .setStrokeStyle(1.5, 0xd9c9ff)
          .setDepth(6),
      );
    }
    const center = this.motion.position;
    for (let index = 0; index < this.sorcererOrbVisuals.length; index += 1) {
      const orb = this.sorcererOrbVisuals[index];
      if (!orb) continue;
      const angle =
        this.sorcererOrbAngle +
        (Math.PI * 2 * index) / Math.max(1, count);
      orb.setPosition(
        center.x + Math.cos(angle) * SORCERER_H35_ORBIT_RADIUS,
        center.y + Math.sin(angle) * SORCERER_H35_ORBIT_RADIUS,
      );
    }
  }

  private destroySorcererOrbVisuals(): void {
    for (const orb of this.sorcererOrbVisuals) orb.destroy();
    this.sorcererOrbVisuals = [];
  }

  /** 魂灵视觉：暗色灵体 + 外圈；静止于召唤点，H28 时随逻辑位置缓慢跟随。 */
  private createSoulVisual(snapshot: SoulSnapshot): void {
    const body = this.add
      .circle(snapshot.x, snapshot.y, SOUL_RADIUS, 0x3b2450, 0.9)
      .setStrokeStyle(2, 0xc77dff, 0.95)
      .setDepth(5);
    const ring = this.add
      .circle(snapshot.x, snapshot.y, SOUL_RADIUS + 5, 0xc77dff, 0)
      .setStrokeStyle(1.5, 0xc77dff, 0.55)
      .setDepth(5);
    this.tweens.add({
      targets: body,
      alpha: { from: 0.9, to: 0.55 },
      duration: 620,
      yoyo: true,
      repeat: -1,
    });
    this.soulVisuals.set(snapshot.id, { body, ring });
  }

  private removeSoulVisual(soulId: number): void {
    const view = this.soulVisuals.get(soulId);
    if (!view) return;
    this.soulVisuals.delete(soulId);
    this.tweens.killTweensOf(view.body);
    this.tweens.killTweensOf(view.ring);
    view.body.destroy();
    view.ring.destroy();
  }

  /** 每 1.5 秒的附着 tick：脉冲提示，实际标记/减速已在 SoulSystem 结算。 */
  private renderSoulTick(tick: SoulTickResult): void {
    const view = this.soulVisuals.get(tick.soulId);
    if (!view) return;
    this.tweens.add({
      targets: view.ring,
      scale: { from: 1, to: 1.6 },
      alpha: { from: 0.9, to: 0 },
      duration: 360,
      onComplete: () => view.ring.setScale(1),
    });
    if (tick.affectedTargetIds.length === 0) return;
    const text = this.add
      .text(tick.x, tick.y - SOUL_RADIUS - 8, '残影附着', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#d8b4fe',
        stroke: '#181018',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({
      targets: text,
      y: text.y - 14,
      alpha: 0,
      duration: 420,
      onComplete: () => text.destroy(),
    });
  }

  /** G07：闪避终点结算范围脉冲与 20% 减速，伤害结果驱动表现与击杀。 */
  private triggerDodgePulse(): void {
    const result = this.buildEffects.resolveDodgePulse(
      this.motion.position,
      this.collectTargets(),
      {
        lineOfSight: (from, to) => hasLineOfSight(this.layout, from, to),
        magicDamageMultiplier: (targetId) =>
          this.enemyDamageMultiplier(targetId, 'magic'),
      },
    );
    if (!result) return;

    this.showExplosion(result.x, result.y, result.radius, 0x7fd7ff);
    this.showSkillLabel('闪避脉冲');
    for (const hit of result.hits) {
      this.showHitResult(hit.targetId, hit.damage, true);
    }
  }

  /** 事件出口：把敌人身上的原生法术命中放进 E02 的待结算队列。 */
  private queueCoreSpellHit(event: CombatEvent): void {
    if (!this.coreEffects.has('E02')) return;
    if (event.kind !== 'damage') return;
    // 触发伤害本身是 derived/depth=1，不进入计数，也就不会递归触发。
    if (!event.applied || event.origin !== 'native' || event.depth !== 0) return;
    if (event.damageType !== 'magic') return;
    if (event.targetId === 'player') return;
    // 宝箱不算“法术命中”；只认场上敌人。
    if (!this.enemies.some((enemy) => enemy.unit.combatant.id === event.targetId)) {
      return;
    }
    this.pendingCoreSpellHits.push(event);
  }

  /**
   * 本步末尾结算 E02：每第 8 次法术命中追加 90 真实伤害。
   * 伤害事件在原生伤害调用栈退出后统一处理，避免在 `HealthState.record` 内重入。
   */
  private flushCoreSpellHits(): void {
    if (this.pendingCoreSpellHits.length === 0) return;
    const pending = this.pendingCoreSpellHits;
    this.pendingCoreSpellHits = [];
    for (const event of pending) {
      const trigger = this.coreEffects.registerSpellHit(event, this.damageChains);
      if (!trigger) continue;
      const view = this.enemies.find(
        (enemy) => enemy.unit.combatant.id === event.targetId,
      );
      if (!view) continue;
      const result = view.unit.combatant.applyDamage(
        trigger.damage,
        'true',
        trigger.source,
      );
      // 衍生的触发伤害不得再触发击杀爆炸等其他衍生效果。
      this.showHitResult(event.targetId, result, false);
      this.showSkillLabel('星蚀之眼 · 90 真实伤害');
    }
  }

  /**
   * E01：记录一次玩家爆炸命中的敌人（宝箱不算“敌人”）。
   * 3 个不同敌人后进入蓄力；蓄力提示由本方法负责，便于玩家理解下一次爆炸变化。
   */
  private recordCoreExplosionHits(
    hits: readonly { readonly targetId: string }[],
  ): void {
    if (!this.coreEffects.has('E01')) return;
    const enemyIds = hits
      .map((hit) => hit.targetId)
      .filter((targetId) =>
        this.enemies.some((enemy) => enemy.unit.combatant.id === targetId),
      );
    if (this.coreEffects.recordExplosionHits(enemyIds)) {
      this.showSkillLabel('炉心契约 · 下次爆炸半径 +35%', '#ffb347');
    }
  }

  /** E01 蓄力时把下一次榴弹爆炸的溅射半径放大 35%；余震半径不变。 */
  private applyCoreExplosionRadius(attack: AttackDefinition): AttackDefinition {
    const multiplier = this.coreEffects.consumeExplosionRadiusMultiplier();
    if (multiplier <= 1 || attack.splashRadius === undefined) return attack;
    return { ...attack, splashRadius: attack.splashRadius * multiplier };
  }

  /**
   * E08 折光王冠：记录一次 J 命中；每第 6 次由本次攻击派生两枚侧弹。
   * 只有原生来源计数，侧弹（derived/depth=1）不会再次累计。
   */
  private recordCoreJHit(
    source: CombatEventSource,
    attack: AttackDefinition,
  ): void {
    if (!this.coreEffects.has('E08')) return;
    const trigger = this.coreEffects.registerJHit(source, this.damageChains);
    if (!trigger) return;
    this.spawnCoreSideBullets(attack, trigger);
    this.showSkillLabel('折光王冠 · 侧弹', '#9be8ff');
  }

  /** 侧弹：沿面向的左右两侧各发射一枚，伤害为触发攻击的 30%。 */
  private spawnCoreSideBullets(
    attack: AttackDefinition,
    trigger: CoreSideBulletTrigger,
  ): void {
    const origin = this.motion.position;
    const facing = this.motion.facingDirection;
    const vector = FACING_VECTORS[facing];
    const sideAttack: AttackDefinition = {
      ...attack,
      damage: attack.damage * trigger.damageRatio,
    };
    const colors = characterEffectColors(this.character.id);
    for (let index = 0; index < trigger.count; index += 1) {
      // 两个侧弹方向：面向逆时针/顺时针旋转 90°，交替取两侧。
      const sign = index % 2 === 0 ? 1 : -1;
      const direction = { x: -vector.y * sign, y: vector.x * sign };
      const state = createProjectile(
        this.nextProjectileId,
        origin,
        facing,
        sideAttack,
        {
          radius: this.itemProjectileRadius(
            this.grenade ? GRENADE_PROJECTILE_RADIUS : PROJECTILE_RADIUS,
          ),
          direction,
        },
      );
      this.nextProjectileId += 1;
      const sprite = this.add
        .circle(
          origin.x,
          origin.y,
          projectileVisualRadius(state.radius),
          colors.secondary,
        )
        .setStrokeStyle(1.5, colors.projectileStroke)
        .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
      this.pendingDerivedBullets.push({
        state,
        sprite,
        source: 'E08',
        eventSource: trigger.source,
      });
    }
  }

  /** 核心获得/恢复后把 E04/E05/E07 的倍率推给对应系统。 */
  private syncCoreEffects(): void {
    this.muelsyse?.setCoreSummonBonus(this.coreEffects.summonDamageMultiplier);
    this.muelsyse?.setCorePhantom(this.coreEffects.has('E04'));
    // E05 的累计加成与 E07 的来源立即注册；E07 的开关随后按生命实时刷新。
    this.syncStatSources();
    this.grenade?.setDamageMultiplier(this.jDamageMultiplier());
    this.motion.setDodgeCooldownMultiplier(
      this.coreEffects.dodgeCooldownMultiplier,
    );
  }

  /**
   * E07 逆风齿轮：每个逻辑步按当前生命刷新低血开关。
   * 状态变化时才重算属性来源与榴弹倍率，避免每步重复写入。
   */
  private syncCoreLowHealth(): void {
    const previous = this.coreEffects.e07Active;
    // 死亡后不再把 0 生命当作“低血增幅”，避免结算界面因状态切换刷提示。
    const active = this.playerHealth.isDead
      ? this.coreEffects.updateLowHealth(
          this.playerHealth.maxHealth,
          this.playerHealth.maxHealth,
        )
      : this.coreEffects.updateLowHealth(
          this.playerHealth.health,
          this.playerHealth.maxHealth,
        );
    this.motion.setDodgeCooldownMultiplier(
      this.coreEffects.dodgeCooldownMultiplier,
    );
    if (active === previous) return;
    this.syncStatSources();
    this.grenade?.setDamageMultiplier(this.jDamageMultiplier());
    // 闪避槽的总冷却随 E07 开关变化，立即刷新进度条基准。
    this.syncSkillHud();
    if (this.coreEffects.has('E07')) {
      this.showSkillLabel(
        active ? '逆风齿轮 · 低血增幅' : '逆风齿轮 · 增幅结束',
        active ? '#ffb347' : undefined,
      );
    }
  }

  /**
   * U/I 自由技能施法入口。真实释放走冷却并登记 E06；
   * E06 的 1 秒复施复用同一效果入口，但不消耗冷却、不累计、不再排入复施。
   */
  private castFreeSkill(
    slot: FreeSkillSlotKey,
    echoStrength: number | null = null,
  ): void {
    if (this.playerHealth.isDead) return;
    if (echoStrength === null) {
      // H01 的免费首施只在施放成功时消耗；H08 的银行层数在成功施放后清空。
      const freeCast = this.combatHexes.firstFreeCastAvailable(slot);
      const result = this.freeSkills.cast(slot, {
        skipCooldown: freeCast,
        cooldownScale: this.combatHexes.bankCooldownScale,
      });
      if (!result.ok) {
        if (result.reason === 'empty') {
          this.showSkillLabel(`${slot} 空槽 · 在商店装备自由技能`, '#a99fb7');
        } else {
          this.showSkillLabel(
            `${slot} 冷却 ${hudValue(result.cooldownRemaining * 10) / 10}s`,
          );
        }
        return;
      }
      this.playSfx(COMBAT_SFX.skillK);
      this.showCastPulse();
      this.castPoseSeconds = 0.16;
      this.castPoseFacing = this.motion.facingDirection;
      if (freeCast) this.combatHexes.markFirstFreeCastUsed(slot);
      const consumedBank = this.combatHexes.consumeBankCharges();
      // H16 只统计真实施放；本次与上一次槽位不同时，本次技能伤害 +25%。
      const comboMultiplier = this.combatHexes.registerSkillCast(slot);
      this.applyFreeSkillEffect(
        slot,
        result.skill,
        result.definition,
        1,
        comboMultiplier,
      );
      this.showCombatHexCastLabels(freeCast, consumedBank, comboMultiplier);
      this.coreEffects.registerSkillCast(slot);
      // R04：成功施放计入每第 4 次返还；只作用于刚进入冷却的这个技能。
      this.applyR04CooldownRefund(result.cooldownSeconds, (seconds) => {
        this.freeSkills.reduceCooldown(slot, seconds);
      });
      this.refreshFreeSkillBar();
      return;
    }

    const stack = this.freeSkills.slotAt(slot);
    const definition = this.freeSkills.definitionAt(slot);
    if (!stack || !definition) return;
    this.showCastPulse();
    this.applyFreeSkillEffect(slot, stack, definition, echoStrength);
    this.showSkillLabel(`${definition.name} · 回响复施`, '#c8b6ff');
  }

  /** H01/H08/H16 的施放反馈；与技能自身标签错开高度，避免文字重叠。 */
  private showCombatHexCastLabels(
    freeCast: boolean,
    consumedBank: number,
    comboMultiplier: number,
  ): void {
    const parts: string[] = [];
    if (freeCast) parts.push('双倍委托 · 不进冷却');
    if (!freeCast && consumedBank > 0) {
      const percent =
        consumedBank *
        (COMBAT_HEX_PARAMS.H08.cooldownReductionPercentPerCharge ?? 10);
      parts.push(`冷却银行 ${consumedBank} 层 · 冷却 −${percent}%`);
    }
    if (comboMultiplier > 1) {
      parts.push(
        `连携时刻 · 技能伤害 +${Math.round((comboMultiplier - 1) * 100)}%`,
      );
    }
    if (parts.length === 0) return;
    this.showSkillLabel(parts.join(' · '), '#c8b6ff', 22);
  }

  /** E06 到期的复施消费；只执行效果，不进入 `freeSkills.cast`。 */
  private stepFreeSkillEcho(): void {
    const echo = this.coreEffects.consumeSkillEcho();
    if (!echo) return;
    if (echo.slot !== 'U' && echo.slot !== 'I') return;
    this.castFreeSkill(echo.slot, echo.strength);
  }

  /**
   * 自由技能效果分发。S01–S12 已在本轮落地；
   * S11/S12 分别走扇射弹体与单体赏金标记。
   */
  private applyFreeSkillEffect(
    slot: FreeSkillSlotKey,
    stack: FreeSkillStack,
    definition: { readonly id: string; readonly name: string },
    strength: number,
    // H16 连携只放大本次技能的伤害部分；治疗/护盾/护甲不受影响。
    comboDamageMultiplier = 1,
  ): void {
    const power = freeSkillStrength(stack.level) * strength;
    const damagePower = power * comboDamageMultiplier;
    const levelSuffix = stack.level > 1 ? ` Lv${stack.level}` : '';
    const echoSuffix = strength < 1 ? ' · 回响' : '';

    if (definition.id === 'S01') {
      // 以自身为圆心旋转，不读取面向；等级与回响只放大每次 tick 的伤害。
      this.spinningBlades.start(damagePower);
      this.spinningBladesSource = beginFreeSkillSource(this.damageChains, 'S01');
      this.syncSpinningBladesVisual();
      this.showSkillLabel(
        `${definition.name}${levelSuffix}${echoSuffix} · 旋转 ${FREE_SKILL_S01_RADIUS}`,
        '#9ecbff',
      );
      return;
    }

    if (definition.id === 'S02') {
      this.applyFrostRing(damagePower, stack.level);
      this.showSkillLabel(
        `${definition.name}${levelSuffix}${echoSuffix} · 半径 ${FREE_SKILL_S02_RADIUS} · 减速 ${Math.round(FREE_SKILL_S02_SLOW_PERCENT * 100)}%`,
        '#9bd7ff',
      );
      return;
    }

    if (definition.id === 'S03') {
      this.applyChainLightning(damagePower);
      const hits = this.lastChainTargetIds.length;
      this.showSkillLabel(
        hits > 0
          ? `${definition.name}${levelSuffix}${echoSuffix} · 连锁 ${hits}/${FREE_SKILL_S03_JUMPS}`
          : `${definition.name}${levelSuffix}${echoSuffix} · 未命中`,
        '#8fd0ff',
      );
      return;
    }

    if (definition.id === 'S04') {
      this.applyFireTrail(damagePower);
      this.showSkillLabel(
        `${definition.name}${levelSuffix}${echoSuffix} · 火路 ${FREE_SKILL_S04_FIRE_DURATION_SECONDS}s`,
        '#ff9a5a',
      );
      return;
    }

    if (definition.id === 'S05') {
      const placed = this.applyPortableTurret(damagePower);
      this.showSkillLabel(
        `${definition.name}${levelSuffix}${echoSuffix} · ${placed} 座 · ${FREE_SKILL_S05_DURATION_SECONDS}s`,
        '#ffd27a',
      );
      return;
    }

    if (definition.id === 'S08') {
      this.applyGravityWell(damagePower);
      const center = this.gravityWell.center;
      this.showSkillLabel(
        center
          ? `${definition.name}${levelSuffix}${echoSuffix} · 半径 ${FREE_SKILL_S08_RADIUS}`
          : `${definition.name}${levelSuffix}${echoSuffix}`,
        '#8f7dff',
      );
      return;
    }

    if (definition.id === 'S09') {
      const placed = this.applyWaterMirror(power);
      this.showSkillLabel(
        `${definition.name}${levelSuffix}${echoSuffix} · ${placed} 个 · ${FREE_SKILL_S09_DURATION_SECONDS}s`,
        '#9be8ff',
      );
      return;
    }

    if (definition.id === 'S06') {
      const form = this.muelsyse;
      const formPosition = form?.formPosition;
      const summons =
        form && formPosition && form.isFormAlive
          ? [
              {
                id: 'muelsyse-form',
                x: formPosition.x,
                y: formPosition.y,
                health: form.formHealth,
                maxHealth: form.formMaxHealth,
              },
            ]
          : [];
      const result = resolveHealingPulse({
        center: this.motion.position,
        summons,
        strength: power,
      });
      const healed = this.playerHealth.heal(
        applyHealingModifier(result.playerHeal, this.stats.healingMultiplier),
      );
      // 没有召唤物时 summons 为空，玩家自疗仍然生效（AC）。
      const summonHeals: HealPulseSummonHeal[] = [];
      for (const entry of result.summons) {
        const applied = form ? form.healSummon(entry.amount) : 0;
        summonHeals.push({ id: entry.id, amount: entry.amount, healed: applied });
      }
      this.lastHealingPulsePlayerHeal = healed;
      this.lastHealingPulseSummons = summonHeals;
      // 绿色脉冲提示治疗范围；与召唤物治疗半径无关，仅作可读反馈。
      const center = this.motion.position;
      this.showExplosion(center.x, center.y, 120, 0x9df2bc);
      if (healed > 0 || summonHeals.some((entry) => entry.healed > 0)) {
        this.syncHealthHud();
      }
      const summonTotal = summonHeals.reduce(
        (total, entry) => total + entry.healed,
        0,
      );
      this.showSkillLabel(
        `${definition.name}${levelSuffix}${echoSuffix} · 生命 +${hudValue(healed)}${
          summonTotal > 0 ? ` · 召唤物 +${hudValue(summonTotal)}` : ''
        }`,
        '#9df2bc',
      );
      return;
    }

    if (definition.id === 'S07') {
      this.applyShieldBurst(power, comboDamageMultiplier);
      this.showSkillLabel(
        `${definition.name}${levelSuffix}${echoSuffix} · 护盾 +${hudValue(
          this.shieldBurst.shieldAmount,
        )} ${hudValue(this.shieldBurst.remainingSecondsLeft * 10) / 10}s`,
        '#cfe8ff',
      );
      return;
    }

    if (definition.id === 'S10') {
      const hits = this.applyWarBanner(power, comboDamageMultiplier);
      this.showSkillLabel(
        `${definition.name}${levelSuffix}${echoSuffix} · 护甲 +${hudValue(
          FREE_SKILL_S10_ARMOR_BONUS * power,
        )} · ${FREE_SKILL_S10_DURATION_SECONDS}s${
          hits > 0 ? ` · 接触 ${hits}` : ''
        }`,
        '#ffd08a',
      );
      return;
    }

    if (definition.id === 'S11') {
      const pellets = this.applyShotgunSpread(damagePower);
      this.showSkillLabel(
        `${definition.name}${levelSuffix}${echoSuffix} · ${pellets} 弹 ×${hudValue(
          shotgunPelletDamage(damagePower),
        )} · 后续 ${Math.round(FREE_SKILL_S11_REPEAT_RATIO * 100)}%`,
        '#ffd166',
      );
      return;
    }

    if (definition.id === 'S12') {
      const target = this.applyBountyMark(power);
      this.showSkillLabel(
        target
          ? `${definition.name}${levelSuffix}${echoSuffix} · ${
              target.label
            } · ${FREE_SKILL_S12_DURATION_SECONDS}s · +${Math.round(
              this.bountyMark.damageBonus() * 100,
            )}%`
          : `${definition.name}${levelSuffix}${echoSuffix} · 未命中`,
        '#ffe08a',
      );
      return;
    }
    this.showSkillLabel(
      `${slot} ${definition.name}${levelSuffix}${echoSuffix}`,
    );
  }

  /**
   * 推进 H01/H02/H05/H06/H08/H17 的每步状态：
   * H02 按闪避位置补火并结算 18 法伤/秒；H05 按实际位移判定站定护甲；
   * H06 与 H08 读 U/I 就绪情况计时；H17 在 3 秒未受伤后每秒生成 3 护盾；
   * 状态变化时刷新自由技能槽文本、火路占位视觉与护盾 HUD。
   */
  private stepCombatHexEffects(stepSeconds: number): void {
    const bothReady = FREE_SKILL_SLOT_KEYS.every(
      (slot) =>
        this.freeSkills.slotAt(slot) !== null &&
        this.freeSkills.cooldownRemaining(slot) <= 0,
    );
    const bankBefore = this.combatHexes.bankCharges;
    this.combatHexes.stepTimers(stepSeconds, bothReady);
    if (this.combatHexes.bankCharges > bankBefore) {
      this.showSkillLabel(
        `冷却银行 · ${this.combatHexes.bankCharges} 层`,
        '#9ecbff',
        22,
      );
    }
    // H05 与 I12 同口径：贴墙推但位置没变仍算站定。
    const position = this.motion.position;
    const moved =
      this.lastHexPosition !== null &&
      distanceSquared(position, this.lastHexPosition) > 1e-6;
    this.lastHexPosition = { x: position.x, y: position.y };
    this.combatHexes.stepStationary(stepSeconds, moved);
    this.syncCombatHexStats();
    // H17 护盾呼吸：只在未受伤 3 秒后生成，加入共享护盾池。
    const breathingShield = this.combatHexes.stepShieldBreathing(stepSeconds);
    if (breathingShield > 0) {
      this.playerHealth.setShield(
        this.playerHealth.shield + breathingShield,
      );
      this.syncHealthHud();
    }
    const emberTicks = this.combatHexes.stepEmberTrail(
      stepSeconds,
      this.motion.isDodging ? this.motion.position : null,
    );
    if (emberTicks > 0) this.applyEmberTrailDamage(emberTicks);
    this.syncEmberTrailVisual();
  }

  /**
   * H05 站定护甲与 H22 精英收藏伤害进入统一属性聚合。
   * 两者只在数值变化时整源替换，避免每帧重建修正数组。
   */
  private syncCombatHexStats(): void {
    const armor = this.combatHexes.stationaryArmorBonus;
    const eliteDamage = this.combatHexes.eliteDamageBonus;
    if (armor === this.h05ArmorApplied && eliteDamage === this.h22DamageApplied) {
      return;
    }
    this.h05ArmorApplied = armor;
    this.h22DamageApplied = eliteDamage;
    this.stats.setSource(
      'hex:H05',
      armor > 0 ? [{ stat: 'armor', mode: 'flat', value: armor }] : [],
    );
    this.stats.setSource(
      'hex:H22',
      eliteDamage > 0
        ? [{ stat: 'damage', mode: 'percent', value: eliteDamage }]
        : [],
    );
    this.playerHealth.setDefenses(this.stats.armor, this.stats.magicResist);
    this.updateBuildHud();
  }

  /** H02 每个 tick：任意一团余烬内的敌人各吃一次 18 法伤。 */
  private applyEmberTrailDamage(ticks: number): void {
    const patches = this.combatHexes.emberTrail.patches();
    if (patches.length === 0) return;
    if (!this.emberTrailSource) {
      this.emberTrailSource = this.combatHexes.beginEmberTrailSource(
        this.damageChains,
      );
    }
    const rawDamage =
      this.combatHexes.emberTrail.damagePerTick() * ticks;
    for (const target of listTargetsInFirePatches(
      patches,
      COMBAT_HEX_PARAMS.H02.radius ?? 44,
      this.enemies.map((enemy) => enemy.unit.combatant),
    )) {
      const result = target.applyDamage(
        rawDamage * this.enemyDamageMultiplier(target.id, 'magic'),
        'magic',
        this.damageChains.nativeHit(this.emberTrailSource),
      );
      this.showHitResult(target.id, result);
    }
  }

  /** H02 余烬视觉：每团火一个橙红圆，按剩余寿命淡出。 */
  private syncEmberTrailVisual(): void {
    const patches = this.combatHexes.emberTrail.patches();
    const radius = COMBAT_HEX_PARAMS.H02.radius ?? 44;
    const duration = COMBAT_HEX_PARAMS.H02.trailDurationSeconds ?? 2;
    const alive = new Set<number>();
    for (const patch of patches) {
      alive.add(patch.id);
      let circle = this.emberPatchVisuals.get(patch.id);
      if (!circle) {
        circle = this.add
          .circle(patch.x, patch.y, radius, 0xff5a2f, 0.16)
          .setStrokeStyle(1.5, 0xff8a5c, 0.5)
          .setDepth(FRIENDLY_EFFECT_DEPTH.explosion);
        this.emberPatchVisuals.set(patch.id, circle);
      }
      const ratio = Math.min(
        1,
        Math.max(0, patch.remainingSeconds / duration),
      );
      circle.setAlpha(0.08 + ratio * 0.18);
    }
    for (const [id, circle] of this.emberPatchVisuals) {
      if (alive.has(id)) continue;
      circle.destroy();
      this.emberPatchVisuals.delete(id);
    }
  }

  private destroyEmberTrailVisuals(): void {
    for (const circle of this.emberPatchVisuals.values()) circle.destroy();
    this.emberPatchVisuals.clear();
  }

  /**
   * 推进 S01 旋转、S02 减速、S04 火路、S05 炮台、S07 护盾、S08 重力井、
   * S09 替身与 S10 战旗；减速在敌人移动前生效。
   */
  private stepFreeSkillEffects(stepSeconds: number): void {
    const spinTicks = this.spinningBlades.step(stepSeconds);
    const fireTicks = this.fireTrail.step(stepSeconds, this.motion.position);
    const wellTicks = this.gravityWell.step(stepSeconds);
    // H07 需要在召唤物消失前读取其坐标；炮台与替身在 step 内移除。
    const turretsBefore = this.turretField.entries();
    const turretTicks = this.turretField.step(stepSeconds);
    const turretsAfter = new Set(
      this.turretField.entries().map((turret) => turret.id),
    );
    for (const turret of turretsBefore) {
      if (!turretsAfter.has(turret.id)) {
        this.tryH07SummonBlast({ x: turret.x, y: turret.y });
      }
    }
    // S07 护盾到期只移除仍记在本次护盾名下的部分，已消耗的不重复扣。
    const expiredShield = this.shieldBurst.step(stepSeconds);
    if (expiredShield > 0) {
      this.playerHealth.setShield(
        Math.max(0, this.playerHealth.shield - expiredShield),
      );
      this.syncHealthHud();
    }
    // S10 战旗的护甲与首次接触都按本步位置实时判定。
    this.stepWarBanner(stepSeconds);
    // S12 标记到期或目标死亡/离场时立即失效。
    this.stepBountyMark(stepSeconds);
    // 替身跟随玩家站位；寿命结束的替身在同步视觉时一并回收。
    if (this.waterMirror.count > 0) {
      const mirrorsBefore = this.waterMirror.entries();
      const expiredMirrorIds = this.waterMirror.step(
        stepSeconds,
        this.waterMirrorAnchor(),
      );
      for (const mirrorId of expiredMirrorIds) {
        const mirror = mirrorsBefore.find((entry) => entry.id === mirrorId);
        if (mirror) this.tryH07SummonBlast({ x: mirror.x, y: mirror.y });
      }
    }
    this.freeSkillSlows.step(stepSeconds);
    if (spinTicks > 0) this.applySpinningBladesDamage(spinTicks);
    if (fireTicks > 0) this.applyFireTrailDamage(fireTicks);
    if (wellTicks > 0) this.applyGravityWellDamage(wellTicks);
    if (turretTicks.length > 0) this.applyTurretDamage(turretTicks);
    this.syncSpinningBladesVisual(stepSeconds);
    this.syncFireTrailVisual();
    this.syncTurretVisuals();
    this.syncGravityWellVisual();
    this.syncWaterMirrorVisuals();
    this.syncShieldBurstVisual();
    this.syncWarBannerVisual();
  }

  /** S01：每个 tick 对半径内所有敌人结算一次物理伤害，同一次施放共享原生链。 */
  private applySpinningBladesDamage(ticks: number): void {
    const center = this.motion.position;
    const source = this.spinningBladesSource
      ? this.damageChains.nativeHit(this.spinningBladesSource)
      : beginFreeSkillSource(this.damageChains, 'S01');
    const rawDamage =
      this.spinningBlades.damagePerTick() * ticks * this.sustainedDamageMultiplier();

    for (const target of this.freeSkillCombatantsInRadius(FREE_SKILL_S01_RADIUS)) {
      const result = target.applyDamage(
        rawDamage *
          this.enemyDamageMultiplier(target.id, FREE_SKILL_S01_DAMAGE_TYPE, center),
        FREE_SKILL_S01_DAMAGE_TYPE,
        source,
      );
      this.showHitResult(target.id, result);
    }
    // 每秒一次的脉冲让玩家看清旋转仍在生效；范围与真实判定同源。
    this.showExplosion(center.x, center.y, FREE_SKILL_S01_RADIUS, 0x9ecbff);
  }

  /**
   * S02：半径 140 内一次法术伤害并按等级延长减速（控制时长增幅封顶 25%）。
   * Boss 的硬控会被转换为减速；本技能本身已是减速，因此对 Boss 同样生效。
   */
  private applyFrostRing(power: number, level: number): void {
    const center = this.motion.position;
    const source = beginFreeSkillSource(this.damageChains, 'S02');
    const rawDamage = FREE_SKILL_S02_DAMAGE * power * this.skillDamageMultiplier();
    const slowDuration = freeSkillSlowDurationSeconds(level);

    for (const target of this.freeSkillCombatantsInRadius(FREE_SKILL_S02_RADIUS)) {
      const result = target.applyDamage(
        rawDamage *
          this.enemyDamageMultiplier(target.id, FREE_SKILL_S02_DAMAGE_TYPE, center),
        FREE_SKILL_S02_DAMAGE_TYPE,
        source,
      );
      this.showHitResult(target.id, result);
      const control = toBossSafeControl(
        {
          kind: 'slow',
          percent: FREE_SKILL_S02_SLOW_PERCENT,
          durationSeconds: slowDuration,
        },
        this.isBossTarget(target.id),
      );
      this.freeSkillSlows.apply(
        target.id,
        control.percent,
        control.durationSeconds,
      );
    }
    this.showExplosion(center.x, center.y, FREE_SKILL_S02_RADIUS, 0x9bd7ff);
  }

  /**
   * S03：首目标走轻自瞄，随后在跳跃半径内向最近的未命中敌人连锁；
   * 每个目标只结算一次，最多 4 个，全部命中共享同一次原生施放链。
   */
  private applyChainLightning(power: number): void {
    const origin = this.motion.position;
    const chain = resolveChainLightningTargets({
      origin,
      facing: this.motion.facingDirection,
      targets: this.enemies.map((enemy) => enemy.unit.combatant),
      lineOfSight: (from, to) => hasLineOfSight(this.layout, from, to),
    });
    this.lastChainTargetIds = chain.map((target) => target.id);
    if (chain.length === 0) return;

    const source = beginFreeSkillSource(this.damageChains, 'S03');
    const rawDamage =
      FREE_SKILL_S03_DAMAGE * power * this.skillDamageMultiplier();
    const points: CombatPoint[] = [{ x: origin.x, y: origin.y }];
    let from: CombatPoint = origin;
    for (const target of chain) {
      const result = target.applyDamage(
        rawDamage *
          this.enemyDamageMultiplier(target.id, FREE_SKILL_S03_DAMAGE_TYPE, from),
        FREE_SKILL_S03_DAMAGE_TYPE,
        source,
      );
      this.showHitResult(target.id, result);
      from = { x: target.x, y: target.y };
      points.push(from);
    }
    this.renderChainLightning(points);
  }

  /** S03 占位视觉：从玩家到首目标、再沿跳跃顺序连线，短暂淡出。 */
  private renderChainLightning(points: readonly CombatPoint[]): void {
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      if (!start || !end) continue;
      const bolt = this.add
        .line(0, 0, start.x, start.y, end.x, end.y, 0x8fd0ff, 0.9)
        .setOrigin(0, 0)
        .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
      this.tweens.add({
        targets: bolt,
        alpha: 0,
        duration: 220,
        onComplete: () => bolt.destroy(),
      });
      const spark = this.add
        .circle(end.x, end.y, 9, 0xd8efff, 0.55)
        .setDepth(FRIENDLY_EFFECT_DEPTH.explosion);
      this.tweens.add({
        targets: spark,
        scale: 1.8,
        alpha: 0,
        duration: 220,
        onComplete: () => spark.destroy(),
      });
    }
  }

  /**
   * S04：在脚下落第一团火并打开 4 秒铺设窗口，之后沿移动路径留火。
   * 伤害按来源每秒结算一次，因此重叠火焰对同一敌人只结算一层。
   */
  private applyFireTrail(power: number): void {
    const origin = this.motion.position;
    this.fireTrail.start(origin, power);
    this.fireTrailSource = beginFreeSkillSource(this.damageChains, 'S04');
    this.syncFireTrailVisual();
    this.showExplosion(origin.x, origin.y, FREE_SKILL_S04_RADIUS, 0xff9a5a);
  }

  /** S04 每个 tick：任意一团火焰内的敌人各吃一次 22 法伤。 */
  private applyFireTrailDamage(ticks: number): void {
    const patches = this.fireTrail.patches();
    if (patches.length === 0) return;
    const source = this.fireTrailSource
      ? this.damageChains.nativeHit(this.fireTrailSource)
      : beginFreeSkillSource(this.damageChains, 'S04');
    const rawDamage =
      this.fireTrail.damagePerTick() * ticks * this.sustainedDamageMultiplier();

    for (const target of listTargetsInFirePatches(
      patches,
      FREE_SKILL_S04_RADIUS,
      this.enemies.map((enemy) => enemy.unit.combatant),
    )) {
      // 地面火不属于弹道，不判要塞弱点；抗性仍走统一入口。
      const result = target.applyDamage(
        rawDamage *
          this.enemyDamageMultiplier(target.id, FREE_SKILL_S04_DAMAGE_TYPE),
        FREE_SKILL_S04_DAMAGE_TYPE,
        source,
      );
      this.showHitResult(target.id, result);
    }
  }

  /** S05：在脚下放置炮台；超过上限时顶掉最旧的一座。返回当前座数。 */
  private applyPortableTurret(power: number): number {
    const origin = this.motion.position;
    const turretsBefore = this.turretField.entries();
    const placed = this.turretField.place(origin, power);
    for (const removedId of placed.replacedIds) {
      const replaced = turretsBefore.find((turret) => turret.id === removedId);
      if (replaced) {
        this.tryH07SummonBlast({ x: replaced.x, y: replaced.y });
      }
      this.turretSources.delete(removedId);
      this.removeTurretVisual(removedId);
    }
    this.turretSources.set(
      placed.id,
      beginFreeSkillSource(this.damageChains, 'S05'),
    );
    this.syncTurretVisuals();
    this.showExplosion(origin.x, origin.y, 26, 0xffd27a);
    return this.turretField.count;
  }

  /** S05 每个 tick：每座炮台对射程内最近的敌人开火一次。 */
  private applyTurretDamage(entries: readonly TurretTickEntry[]): void {
    const targets = this.enemies.map((enemy) => enemy.unit.combatant);
    for (const entry of entries) {
      const source = this.turretSources.get(entry.id);
      if (!source) continue;
      const turret = { x: entry.x, y: entry.y };
      const target = findTurretTarget(turret, targets, {
        range: FREE_SKILL_S05_RANGE,
        lineOfSight: (from, to) => hasLineOfSight(this.layout, from, to),
      });
      if (!target) continue;
      const rawDamage =
        this.turretField.damagePerTick(entry.strength) *
        entry.ticks *
        this.skillDamageMultiplier();
      const result = target.applyDamage(
        rawDamage *
          this.enemyDamageMultiplier(
            target.id,
            FREE_SKILL_S05_DAMAGE_TYPE,
            turret,
          ),
        FREE_SKILL_S05_DAMAGE_TYPE,
        this.damageChains.nativeHit(source),
      );
      this.showHitResult(target.id, result);
      this.renderTurretShot(turret, target);
    }
  }

  /** S05 开火表现：炮台到目标的短暂曳光，与真实命中共用同一点。 */
  private renderTurretShot(
    turret: CombatPoint,
    target: CombatPoint,
  ): void {
    const tracer = this.add
      .line(
        0,
        0,
        turret.x,
        turret.y,
        target.x,
        target.y,
        0xffe2a8,
        0.85,
      )
      .setOrigin(0, 0)
      .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
    this.tweens.add({
      targets: tracer,
      alpha: 0,
      duration: 140,
      onComplete: () => tracer.destroy(),
    });
  }

  /** S04 火焰视觉：每团火一个橙红圆，按剩余寿命淡出。 */
  private syncFireTrailVisual(): void {
    const patches = this.fireTrail.patches();
    const alive = new Set<number>();
    for (const patch of patches) {
      alive.add(patch.id);
      let circle = this.firePatchVisuals.get(patch.id);
      if (!circle) {
        circle = this.add
          .circle(patch.x, patch.y, FREE_SKILL_S04_RADIUS, 0xff7a2f, 0.18)
          .setStrokeStyle(1.5, 0xffb066, 0.5)
          .setDepth(FRIENDLY_EFFECT_DEPTH.explosion);
        this.firePatchVisuals.set(patch.id, circle);
      }
      const ratio = Math.min(
        1,
        Math.max(0, patch.remainingSeconds / FREE_SKILL_S04_FIRE_DURATION_SECONDS),
      );
      circle.setAlpha(0.1 + ratio * 0.2);
    }
    for (const [id, circle] of this.firePatchVisuals) {
      if (alive.has(id)) continue;
      circle.destroy();
      this.firePatchVisuals.delete(id);
    }
  }

  private destroyFireTrailVisuals(): void {
    for (const circle of this.firePatchVisuals.values()) circle.destroy();
    this.firePatchVisuals.clear();
  }

  /** S05 炮台视觉：底座 + 炮管 + 剩余秒短标签。 */
  private syncTurretVisuals(): void {
    const turrets = this.turretField.entries();
    const alive = new Set<number>();
    for (const turret of turrets) {
      alive.add(turret.id);
      let view = this.turretVisuals.get(turret.id);
      if (!view) {
        const body = this.add
          .image(turret.x, turret.y, 'item-art-S05').setDisplaySize(48, 48)
          .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
        const barrel = this.add
          .rectangle(turret.x + 13, turret.y, 22, 5, 0xffe2a8, 0)
          .setOrigin(0, 0.5)
          .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
        const label = this.add
          .text(turret.x, turret.y - 28, '炮台', {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#ffe2a8',
          })
          .setOrigin(0.5)
          .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
        view = { body, barrel, label };
        this.turretVisuals.set(turret.id, view);
      }
      view.label.setText(`炮台 ${Math.ceil(turret.remainingSeconds)}s`);
    }
    for (const id of [...this.turretVisuals.keys()]) {
      if (alive.has(id)) continue;
      this.removeTurretVisual(id);
      this.turretSources.delete(id);
    }
  }

  private removeTurretVisual(id: number): void {
    const view = this.turretVisuals.get(id);
    if (!view) return;
    view.body.destroy();
    view.barrel.destroy();
    view.label.destroy();
    this.turretVisuals.delete(id);
  }

  private destroyTurretVisuals(): void {
    for (const id of [...this.turretVisuals.keys()]) {
      this.removeTurretVisual(id);
    }
  }

  /** S09：在玩家左手侧生成替身；达到上限时刷新并顶掉旧替身。 */
  private applyWaterMirror(power: number): number {
    const origin = this.waterMirrorAnchor();
    const mirrorsBefore = this.waterMirror.entries();
    const placed = this.waterMirror.place(origin, power);
    for (const removedId of placed.replacedIds) {
      const replaced = mirrorsBefore.find((mirror) => mirror.id === removedId);
      if (replaced) {
        this.tryH07SummonBlast({ x: replaced.x, y: replaced.y });
      }
    }
    this.syncWaterMirrorVisuals();
    this.showExplosion(origin.x, origin.y, 24, 0x9be8ff);
    return this.waterMirror.count;
  }

  /** 替身站位：玩家面向的左手侧；被墙/掩体挡住时退回玩家位置。 */
  private waterMirrorAnchor(): CombatPoint {
    const player = this.motion.position;
    const vector = FACING_VECTORS[this.motion.facingDirection];
    const x = player.x - vector.y * FREE_SKILL_S09_FOLLOW_DISTANCE;
    const y = player.y + vector.x * FREE_SKILL_S09_FOLLOW_DISTANCE;
    if (!isCircleBlocked(this.layout, x, y, 12)) return { x, y };
    return { x: player.x, y: player.y };
  }

  /**
   * S09：替身复制一次 J 命中的 35% 伤害。
   * 只接受原生 J 来源并派生一层 S09，因此不会复制分裂/回响/侧弹/爆炸等触发链。
   */
  private applyWaterMirrorEcho(
    target: Combatant,
    result: DamageResult,
    damageType: DamageType,
    parent: CombatEventSource | null,
  ): void {
    if (this.waterMirror.count === 0) return;
    if (!result.applied || !target.isAlive) return;
    if (!parent || parent.origin !== 'native' || parent.depth !== 0) return;
    for (const mirror of this.waterMirror.entries()) {
      const echo = resolveWaterMirrorEcho({
        chains: this.damageChains,
        parent,
        jDamage: result.rawDamage,
        strength: mirror.strength,
      });
      if (!echo) return;
      const dealt = target.applyDamage(echo.damage, damageType, echo.source);
      if (!dealt.applied) continue;
      this.waterMirrorEchoHits += 1;
      this.lastWaterMirrorEchoDamage = echo.damage;
      this.showHitResult(target.id, dealt);
      this.renderWaterMirrorEcho(mirror, target);
    }
  }

  /** S09 复制表现：替身到目标的水色牵引线，与真实命中共用同一点。 */
  private renderWaterMirrorEcho(
    mirror: WaterMirrorSnapshot,
    target: CombatPoint,
  ): void {
    const tracer = this.add
      .line(0, 0, mirror.x, mirror.y, target.x, target.y, 0x9be8ff, 0.8)
      .setOrigin(0, 0)
      .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
    this.tweens.add({
      targets: tracer,
      alpha: 0,
      duration: 140,
      onComplete: () => tracer.destroy(),
    });
  }

  /** S09 替身视觉：半透明水色替身圆 + 剩余秒短标签。 */
  private syncWaterMirrorVisuals(): void {
    const mirrors = this.waterMirror.entries();
    const alive = new Set<number>();
    for (const mirror of mirrors) {
      alive.add(mirror.id);
      let view = this.waterMirrorVisuals.get(mirror.id);
      if (!view) {
        const body = this.add
          .image(mirror.x, mirror.y, 'item-art-S09').setDisplaySize(46, 46).setAlpha(0.75)
          .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
        const label = this.add
          .text(mirror.x, mirror.y - 26, '替身', {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#9be8ff',
          })
          .setOrigin(0.5)
          .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
        view = { body, label };
        this.waterMirrorVisuals.set(mirror.id, view);
      }
      view.body.setPosition(mirror.x, mirror.y);
      view.label
        .setPosition(mirror.x, mirror.y - 26)
        .setText(`替身 ${Math.ceil(mirror.remainingSeconds)}s`);
    }
    for (const id of [...this.waterMirrorVisuals.keys()]) {
      if (alive.has(id)) continue;
      this.removeWaterMirrorVisual(id);
    }
  }

  private removeWaterMirrorVisual(id: number): void {
    const view = this.waterMirrorVisuals.get(id);
    if (!view) return;
    view.body.destroy();
    view.label.destroy();
    this.waterMirrorVisuals.delete(id);
  }

  private destroyWaterMirrorVisuals(): void {
    for (const id of [...this.waterMirrorVisuals.keys()]) {
      this.removeWaterMirrorVisual(id);
    }
  }

  /**
   * S07 盾震：刷新 35 护盾 4 秒，并对半径内敌人结算 40 物伤。
   * 普通敌人被击退，精英与 Boss 只吃伤害（与 J 盾击口径一致）。
   * 护盾只写入生命对象，不产生伤害事件，因此不会触发受伤类递归。
   */
  private applyShieldBurst(power: number, damageMultiplier = 1): void {
    // 重复施放/回响复施刷新同一次护盾，不叠成两层独立计时。
    const previous = this.shieldBurst.shieldAmount;
    if (previous > 0) {
      this.playerHealth.setShield(
        Math.max(0, this.playerHealth.shield - previous),
      );
    }
    const granted = this.shieldBurst.start(power);
    this.playerHealth.setShield(this.playerHealth.shield + granted);
    this.syncHealthHud();
    this.syncShieldBurstVisual();

    const center = this.motion.position;
    const source = beginFreeSkillSource(this.damageChains, 'S07');
    const rawDamage =
      this.shieldBurst.damagePerHit() *
      this.skillDamageMultiplier() *
      damageMultiplier;
    for (const target of this.freeSkillCombatantsInRadius(
      FREE_SKILL_S07_RADIUS,
      center,
    )) {
      const result = target.applyDamage(
        rawDamage *
          this.enemyDamageMultiplier(target.id, FREE_SKILL_S07_DAMAGE_TYPE, center),
        FREE_SKILL_S07_DAMAGE_TYPE,
        source,
      );
      this.showHitResult(target.id, result);
      const view = this.enemies.find(
        (enemy) => enemy.unit.combatant.id === target.id,
      );
      const canKnockback =
        view !== undefined &&
        view.unit.enemy.elite !== true &&
        !this.isBossTarget(target.id);
      if (canKnockback) {
        this.enemySystem.knockback(
          target.id,
          center,
          FREE_SKILL_S07_KNOCKBACK_DISTANCE,
        );
      }
    }
    this.showExplosion(center.x, center.y, FREE_SKILL_S07_RADIUS, 0xcfe8ff);
  }

  /** S07 护盾视觉：跟随玩家的淡蓝外圈，剩余秒数越少越淡。 */
  private syncShieldBurstVisual(): void {
    if (!this.shieldBurst.isActive) {
      this.destroyShieldBurstVisual();
      return;
    }
    const player = this.motion.position;
    if (!this.shieldBurstRing) {
      this.shieldBurstRing = this.add
        .circle(player.x, player.y, 24, 0xcfe8ff, 0.1)
        .setStrokeStyle(2, 0xcfe8ff, 0.7)
        .setDepth(FRIENDLY_EFFECT_DEPTH.explosion);
    }
    const ratio = Math.min(
      1,
      Math.max(
        0,
        this.shieldBurst.remainingSecondsLeft /
          FREE_SKILL_S07_SHIELD_DURATION_SECONDS,
      ),
    );
    this.shieldBurstRing
      .setPosition(player.x, player.y)
      .setStrokeStyle(2, 0xcfe8ff, 0.25 + ratio * 0.5)
      .setAlpha(0.35 + ratio * 0.65);
  }

  private destroyShieldBurstVisual(): void {
    this.shieldBurstRing?.destroy();
    this.shieldBurstRing = null;
  }

  /**
   * S10 反击战旗：在脚下立起固定区域，立即结算圈内敌人的首次接触伤害。
   * 返回本次施放立即触发的敌人数；后续接触在 `stepWarBanner` 中判定。
   */
  private applyWarBanner(power: number, damageMultiplier = 1): number {
    const origin = { x: this.motion.position.x, y: this.motion.position.y };
    this.warBanner.start(origin, power);
    this.warBannerContactDamageMultiplier = damageMultiplier;
    this.warBannerSource = beginFreeSkillSource(this.damageChains, 'S10');
    // 重复施放会把战旗挪到新位置，旧位置的占位视觉必须重建。
    this.destroyWarBannerVisual();
    this.syncWarBannerVisual();
    this.syncWarBannerArmor();
    const hits = this.applyWarBannerContacts();
    this.showExplosion(origin.x, origin.y, FREE_SKILL_S10_RADIUS, 0xffd08a);
    return hits;
  }

  /**
   * 每个逻辑步推进战旗：区域到期、玩家进出区域时护甲实时增减，
   * 敌人只要本步在区域内且此前未接触过就吃一次 45 物伤。
   */
  private stepWarBanner(stepSeconds: number): void {
    this.warBanner.step(stepSeconds);
    this.syncWarBannerArmor();
    this.applyWarBannerContacts();
  }

  /** 玩家位于区域内才注册护甲来源；离开或区域结束时立即移除。 */
  private syncWarBannerArmor(): void {
    const bonus = this.warBanner.armorBonusAt(this.motion.position);
    if (bonus === this.warBannerArmorApplied) return;
    this.warBannerArmorApplied = bonus;
    // 走统一属性聚合，避免与道具/药剂护甲来源互相覆盖。
    this.stats.setSource(
      'freeSkill:S10',
      bonus > 0 ? [{ stat: 'armor', mode: 'flat', value: bonus }] : [],
    );
    this.playerHealth.setDefenses(this.stats.armor, this.stats.magicResist);
  }

  /** 对首次进入战旗区域的敌人各结算一次物理伤害；返回命中数。 */
  private applyWarBannerContacts(): number {
    if (!this.warBanner.isActive) return 0;
    const targets = this.warBanner.claimContacts(
      this.enemies.map((enemy) => enemy.unit.combatant),
    );
    if (targets.length === 0) return 0;
    const source =
      this.warBannerSource ??
      beginFreeSkillSource(this.damageChains, 'S10');
    this.warBannerSource = source;
    const rawDamage =
      this.warBanner.contactDamage() *
      this.skillDamageMultiplier() *
      this.warBannerContactDamageMultiplier;
    for (const target of targets) {
      const result = target.applyDamage(
        rawDamage *
          this.enemyDamageMultiplier(
            target.id,
            FREE_SKILL_S10_DAMAGE_TYPE,
            this.warBanner.center ?? this.motion.position,
          ),
        FREE_SKILL_S10_DAMAGE_TYPE,
        this.damageChains.nativeHit(source),
      );
      this.showHitResult(target.id, result);
    }
    return targets.length;
  }

  /** S10 战旗视觉：固定区域圈 + 旗杆/旗面 + 剩余秒短标签。 */
  private syncWarBannerVisual(): void {
    const center = this.warBanner.center;
    if (!this.warBanner.isActive || !center) {
      this.destroyWarBannerVisual();
      return;
    }
    if (!this.warBannerVisuals) {
      const area = this.add
        .circle(center.x, center.y, FREE_SKILL_S10_RADIUS, 0xffd08a, 0.06)
        .setStrokeStyle(2, 0xffd08a, 0.45)
        .setDepth(FRIENDLY_EFFECT_DEPTH.explosion);
      const pole = this.add
        .rectangle(center.x, center.y - 40, 4, 56, 0xffe2a8, 0.9)
        .setOrigin(0.5, 0)
        .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
      const flag = this.add
        .rectangle(center.x + 17, center.y - 38, 26, 16, 0xffd08a, 0.85)
        .setOrigin(0.5, 0)
        .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
      const label = this.add
        .text(center.x, center.y - 64, '战旗', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ffd08a',
        })
        .setOrigin(0.5)
        .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
      this.warBannerVisuals = { area, pole, flag, label };
    }
    this.warBannerVisuals.label.setText(
      `战旗 ${Math.ceil(this.warBanner.remainingSecondsLeft)}s`,
    );
  }

  private destroyWarBannerVisual(): void {
    const view = this.warBannerVisuals;
    if (!view) return;
    view.area.destroy();
    view.pole.destroy();
    view.flag.destroy();
    view.label.destroy();
    this.warBannerVisuals = null;
  }

  /**
   * S11 霰弹扇射：轻自瞄只校正扇面中心，随后按 50° 均分发射 5 枚直线弹。
   * 弹丸之间互不追踪，方向发射后固定；同一目标后续弹由共享记账降到 35%。
   */
  private applyShotgunSpread(power: number): number {
    const origin = this.motion.position;
    const facing = this.motion.facingDirection;
    const aim = this.resolveShotAim(origin, facing, FREE_SKILL_S11_RANGE);
    const directions = shotgunFanDirections(aim.direction, {
      spreadDegrees: FREE_SKILL_S11_SPREAD_DEGREES,
      count: FREE_SKILL_S11_PELLET_COUNT,
    });
    const attack: AttackDefinition = {
      key: 'J',
      name: '霰弹扇射',
      // 弹体不读取攻击间隔；沿用角色值只为让续局快照保持合法的攻击定义。
      intervalSeconds: this.character.attack.intervalSeconds,
      range: FREE_SKILL_S11_RANGE,
      damage: shotgunPelletDamage(power),
      damageType: FREE_SKILL_S11_DAMAGE_TYPE,
    };
    const volley = new ShotgunVolleyTracker();
    // 同一次施放共享一条原生技能链；每枚弹是这条链上的一次命中。
    const eventSource = beginFreeSkillSource(this.damageChains, 'S11');
    for (const direction of directions) {
      const state = createProjectile(
        this.nextProjectileId,
        origin,
        nearestFacing(direction) ?? facing,
        attack,
        {
          pierce: null,
          radius: this.itemProjectileRadius(PROJECTILE_RADIUS * 0.75),
          direction,
        },
      );
      this.nextProjectileId += 1;
      const sprite = this.add
        .circle(
          origin.x,
          origin.y,
          projectileVisualRadius(state.radius),
          0xffd166,
        )
        .setStrokeStyle(1.5, 0xfff0b0)
        .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
      this.projectiles.push({
        state,
        sprite,
        source: 'S11',
        eventSource,
        shotgunVolley: volley,
      });
    }
    this.lastShotgunPelletCount = directions.length;
    this.lastShotgunPelletDamage = shotgunPelletDamage(power);
    return directions.length;
  }

  /**
   * S12 赏金标记：用轻自瞄选中面向的敌人并标记 8 秒。
   * 宝箱不是赏金目标；无有效目标时只播放施法、不进入冷却回退。
   */
  private applyBountyMark(power: number): { readonly id: string; readonly label: string } | null {
    const origin = this.motion.position;
    const aim = this.resolveShotAim(
      origin,
      this.motion.facingDirection,
      FREE_SKILL_S12_RANGE,
    );
    const target = aim.target;
    if (!target || target.kind === 'chest' || target.isAlive === false) {
      return null;
    }
    const view = this.enemies.find(
      (enemy) => enemy.unit.combatant.id === target.id,
    );
    if (!view) return null;
    this.bountyMark.mark(target.id, power);
    this.syncBountyMarkVisual();
    return { id: target.id, label: view.label };
  }

  /**
   * 每步推进标记时长；目标死亡、离场或已不在敌人列表时立即失效。
   * 标记视觉始终跟随目标当前位置。
   */
  private stepBountyMark(stepSeconds: number): void {
    this.bountyMark.step(stepSeconds);
    const targetId = this.bountyMark.targetId;
    if (targetId) {
      const view = this.enemies.find(
        (enemy) => enemy.unit.combatant.id === targetId,
      );
      if (!view || !view.unit.combatant.isAlive) this.bountyMark.clear();
    }
    this.syncBountyMarkVisual();
  }

  /** S12 标记视觉：目标外圈 + 剩余秒短标签。 */
  private syncBountyMarkVisual(): void {
    const targetId = this.bountyMark.targetId;
    const view = targetId
      ? this.enemies.find((enemy) => enemy.unit.combatant.id === targetId)
      : undefined;
    if (!targetId || !view || !view.unit.combatant.isAlive) {
      this.destroyBountyMarkVisual();
      return;
    }
    const combatant = view.unit.combatant;
    if (!this.bountyMarkVisual) {
      const ring = this.add
        .circle(combatant.x, combatant.y, combatant.radius + 10, 0xffe08a, 0)
        .setStrokeStyle(2, 0xffe08a, 0.9)
        .setDepth(FRIENDLY_EFFECT_DEPTH.explosion);
      const label = this.add
        .text(combatant.x, combatant.y - combatant.radius - 24, '赏金', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#ffe08a',
          stroke: '#181018',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(30);
      this.bountyMarkVisual = { ring, label };
    }
    this.bountyMarkVisual.ring.setPosition(combatant.x, combatant.y);
    this.bountyMarkVisual.label
      .setPosition(combatant.x, combatant.y - combatant.radius - 24)
      .setText(`赏金 ${Math.ceil(this.bountyMark.remainingSecondsLeft)}s`);
  }

  private destroyBountyMarkVisual(): void {
    const view = this.bountyMarkVisual;
    if (!view) return;
    view.ring.destroy();
    view.label.destroy();
    this.bountyMarkVisual = null;
  }


  /**
   * S08：在前方或轻自瞄目标处生成重力井，落点经墙/掩体钳制。
   * 每个 tick 伤害与拉拽由纯逻辑计时驱动。
   */
  private applyGravityWell(power: number): void {
    const origin = this.motion.position;
    const placement = resolveGravityWellPlacement({
      origin,
      facing: this.motion.facingDirection,
      targets: this.enemies.map((enemy) => enemy.unit.combatant),
      lineOfSight: (from, to) => hasLineOfSight(this.layout, from, to),
    });
    const center = this.clampGravityWellCenter(placement.center);
    this.gravityWell.start(center, power);
    this.gravityWellSource = beginFreeSkillSource(this.damageChains, 'S08');
    this.syncGravityWellVisual();
    this.showExplosion(center.x, center.y, FREE_SKILL_S08_RADIUS, 0x8f7dff);
  }

  /** 落点不能越过墙体/掩体：从玩家沿直线推进到首个阻挡点。 */
  private clampGravityWellCenter(center: CombatPoint): CombatPoint {
    const origin = this.motion.position;
    const moved = moveCircleWithCollision(
      this.layout,
      origin.x,
      origin.y,
      0,
      center.x - origin.x,
      center.y - origin.y,
    );
    return { x: moved.x, y: moved.y };
  }

  /**
   * S08 每个 tick：对区域内每个敌人结算法术伤害；
   * 普通敌人向中心拉近，Boss 的拉拽经 `toBossSafeControl` 转为 40% 减速。
   */
  private applyGravityWellDamage(ticks: number): void {
    const center = this.gravityWell.center;
    if (!center) return;
    const source = this.gravityWellSource
      ? this.damageChains.nativeHit(this.gravityWellSource)
      : beginFreeSkillSource(this.damageChains, 'S08');
    const rawDamage =
      this.gravityWell.damagePerTick() * ticks * this.sustainedDamageMultiplier();
    const pullDistance = this.gravityWell.pullDistancePerTick() * ticks;

    for (const target of this.freeSkillCombatantsInRadius(
      FREE_SKILL_S08_RADIUS,
      center,
    )) {
      const result = target.applyDamage(
        rawDamage *
          this.enemyDamageMultiplier(
            target.id,
            FREE_SKILL_S08_DAMAGE_TYPE,
            center,
          ),
        FREE_SKILL_S08_DAMAGE_TYPE,
        source,
      );
      this.showHitResult(target.id, result);

      const control = toBossSafeControl(
        {
          kind: 'pull',
          percent: 1,
          durationSeconds: FREE_SKILL_S08_TICK_SECONDS,
        },
        this.isBossTarget(target.id),
      );
      if (control.kind === 'slow') {
        this.freeSkillSlows.apply(
          target.id,
          control.percent,
          control.durationSeconds,
        );
        continue;
      }
      // 已贴近中心时收窄拉拽量，避免越过中心来回抖动。
      const distance = Math.hypot(target.x - center.x, target.y - center.y);
      const pull = Math.min(
        pullDistance,
        Math.max(0, distance - FREE_SKILL_S08_MIN_PULL_DISTANCE),
      );
      if (pull <= 0) continue;
      const fromX = target.x;
      const fromY = target.y;
      const moved = this.enemySystem.pullToward(target.id, center, pull);
      if (moved > 0) {
        this.renderGravityWellPull(fromX, fromY, target.x, target.y);
      }
    }
    this.showExplosion(center.x, center.y, FREE_SKILL_S08_RADIUS, 0x8f7dff);
  }

  /** S08 拉拽表现：敌人旧位置到新位置的短牵引线。 */
  private renderGravityWellPull(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): void {
    const line = this.add
      .line(0, 0, fromX, fromY, toX, toY, 0xbfa8ff, 0.7)
      .setOrigin(0, 0)
      .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
    this.tweens.add({
      targets: line,
      alpha: 0,
      duration: 220,
      onComplete: () => line.destroy(),
    });
  }

  /** 自由技能范围只选敌人，宝箱不参与（AC 只要求对敌人结算）。 */
  private freeSkillCombatantsInRadius(
    radius: number,
    center: CombatPoint = this.motion.position,
  ): Combatant[] {
    return listFreeSkillTargetsInRadius(
      center,
      radius,
      this.enemies.map((enemy) => enemy.unit.combatant),
      (from, to) => hasLineOfSight(this.layout, from, to),
    );
  }

  /** 同步 S01 旋转占位视觉：外圈跟随玩家，三片刃持续旋转。 */
  private syncSpinningBladesVisual(stepSeconds = 0): void {
    if (!this.spinningBlades.isActive) {
      this.destroySpinningBladesVisual();
      return;
    }
    const position = this.motion.position;
    if (!this.spinningBladesRing) {
      this.spinningBladesRing = this.add
        .circle(position.x, position.y, FREE_SKILL_S01_RADIUS, 0x9ecbff, 0.06)
        .setStrokeStyle(2, 0x9ecbff, 0.5)
        .setDepth(FRIENDLY_EFFECT_DEPTH.explosion);
      const blades = this.add
        .container(position.x, position.y)
        .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
      for (let index = 0; index < 3; index += 1) {
        const angle = (index * Math.PI * 2) / 3;
        blades.add(
          this.add
            .rectangle(
              Math.cos(angle) * (FREE_SKILL_S01_RADIUS - 14),
              Math.sin(angle) * (FREE_SKILL_S01_RADIUS - 14),
              26,
              5,
              0xd8f0ff,
              0.85,
            )
            .setRotation(angle + Math.PI / 2),
        );
      }
      this.spinningBladesBlades = blades;
    }
    this.spinningBladesRing.setPosition(position.x, position.y);
    if (this.spinningBladesBlades) {
      this.spinningBladesBlades.setPosition(position.x, position.y);
      if (stepSeconds > 0) {
        this.spinningBladesBlades.rotation += stepSeconds * 5;
      }
    }
  }

  private destroySpinningBladesVisual(): void {
    this.spinningBladesRing?.destroy();
    this.spinningBladesBlades?.destroy();
    this.spinningBladesRing = null;
    this.spinningBladesBlades = null;
  }

  /** 同步 S08 重力井占位视觉：外圈 + 中心核心，固定跟随落点。 */
  private syncGravityWellVisual(): void {
    if (!this.gravityWell.isActive) {
      this.destroyGravityWellVisual();
      return;
    }
    const center = this.gravityWell.center;
    if (!center) return;
    if (!this.gravityWellRing) {
      this.gravityWellRing = this.add
        .circle(center.x, center.y, FREE_SKILL_S08_RADIUS, 0x8f7dff, 0.08)
        .setStrokeStyle(2, 0xbfa8ff, 0.6)
        .setDepth(FRIENDLY_EFFECT_DEPTH.explosion);
      this.gravityWellCore = this.add
        .circle(center.x, center.y, 12, 0xbfa8ff, 0.35)
        .setStrokeStyle(1.5, 0xd9ccff, 0.8)
        .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
    }
    this.gravityWellRing.setPosition(center.x, center.y);
    this.gravityWellCore?.setPosition(center.x, center.y);
  }

  private destroyGravityWellVisual(): void {
    this.gravityWellRing?.destroy();
    this.gravityWellCore?.destroy();
    this.gravityWellRing = null;
    this.gravityWellCore = null;
  }

  /** K：在当前面向前方 40 像素的最近合法空位召唤魂灵；冷却中不召唤。 */
  private castSoul(): void {
    if (!this.soul) return;
    const spawn = resolveSoulSpawnPoint(
      this.layout,
      this.motion.position,
      this.motion.facingDirection,
    );
    const result = this.soul.trySummon(spawn);
    if (!result) return;
    this.playSfx(COMBAT_SFX.skillK);
    this.showCastPulse();
    this.applyR04CooldownRefund(this.soul.cooldownRemaining, (seconds) =>
      this.reduceKCooldown(seconds),
    );
    if (result.replacedSoulId !== null) {
      const replaced = this.soulVisuals.get(result.replacedSoulId);
      if (replaced) {
        this.tryH07SummonBlast({ x: replaced.body.x, y: replaced.body.y });
      }
      this.removeSoulVisual(result.replacedSoulId);
    }
    this.createSoulVisual(result.soul);
    // G06：K 生效后登记下一次 J 的追加攻击，5 秒未使用自动失效。
    const echoArmed = this.buildEffects.armTacticalEcho();
    const label = result.replacedSoulId === null ? '魂灵之影' : '魂灵之影 · 替换';
    this.showSkillLabel(echoArmed ? `${label} · 回响就绪` : label);
  }

  /** 阿米娅 K：启动 0.8 秒、6 发的精神爆发；冷却中重复按键无效。 */
  private castSpiritBurst(): void {
    if (!this.amiya?.tryActivateK()) return;
    this.playSfx(COMBAT_SFX.skillK);
    this.showCastPulse();
    this.applyR04CooldownRefund(this.amiya.kCooldownRemaining, (seconds) =>
      this.reduceKCooldown(seconds),
    );
    const echoArmed = this.buildEffects.armTacticalEcho();
    this.showSkillLabel(echoArmed ? '精神爆发 · 回响就绪' : '精神爆发');
  }

  /** 阿米娅 L：启动 8 秒奇美拉；冷却中、生效中或虚弱期重复按键无效。 */
  private castChimera(): void {
    if (this.playerHealth.isDead) return;
    if (!this.amiya?.tryActivateL()) return;
    this.playSfx(COMBAT_SFX.skillL);
    this.showCastPulse();
    this.applyR04CooldownRefund(this.amiya.lCooldownRemaining, (seconds) =>
      this.reduceLCooldown(seconds),
    );
    this.showSkillLabel('奇美拉 · 真实伤害');
  }

  /** 塞雷娅 K：治疗、护盾与精神回复；冷却中重复按键无效。 */
  private castFirstAid(): void {
    if (this.playerHealth.isDead) return;
    const saria = this.saria;
    const result = saria?.tryActivateK(this.playerHealth);
    if (!result || !saria) return;
    this.playSfx(COMBAT_SFX.skillK);
    this.showCastPulse();
    this.applyR04CooldownRefund(saria.kCooldownRemaining, (seconds) =>
      this.reduceKCooldown(seconds),
    );

    this.syncHealthHud();
    // S01：实际治疗量 80% 转化为范围法伤；满血时 healed=0，不产生伤害。
    if (result.healShockDamage > 0) this.applyHealShock(result.healShockDamage);

    const parts: string[] = [];
    if (result.healed > 0) parts.push(`恢复 ${hudValue(result.healed)}`);
    else parts.push('满血');
    parts.push(`护盾 ${hudValue(result.shield)}`);
    if (result.healShockDamage > 0) {
      parts.push(`回生冲击 ${hudValue(result.healShockDamage)}`);
    }
    if (result.lCooldownReducedSeconds > 0) {
      parts.push(`精神回复 L −${hudValue(result.lCooldownReducedSeconds)}s`);
    }
    this.showSkillLabel(`急救配置 · ${parts.join(' · ')}`);
  }

  /** 塞雷娅 L：展开 8 秒钙质化领域；冷却中或已展开时重复按键无效。 */
  private castCalciumField(): void {
    if (this.playerHealth.isDead) return;
    if (!this.saria?.tryActivateL()) return;
    this.playSfx(COMBAT_SFX.skillL);
    this.showCastPulse();
    this.applyR04CooldownRefund(this.saria.lCooldownRemaining, (seconds) =>
      this.reduceLCooldown(seconds),
    );
    this.syncCalciumFieldVisual();
    this.showSkillLabel('钙质化 · 领域展开');
  }

  /**
   * 缪尔赛思 K：存活时切换近战/远程流形并保留生命百分比；
   * 流形死亡时改为重建当前形态，重建后才开始 6 秒冷却。
   */
  private castShapeShift(): void {
    if (this.playerHealth.isDead) return;
    const muelsyse = this.muelsyse;
    const result = muelsyse?.tryActivateK(this.motion.position);
    if (!result || !muelsyse) return;
    this.playSfx(COMBAT_SFX.skillK);
    this.showCastPulse();
    this.applyR04CooldownRefund(muelsyse.kCooldownRemaining, (seconds) =>
      this.reduceKCooldown(seconds),
    );

    const formName = result.form === 'melee' ? '近战流形' : '远程流形';
    const baseLabel =
      result.action === 'rebuild'
        ? `${formName} · 重建`
        : `切换 ${formName} · 生命 ${Math.round(result.healthPercent * 100)}%`;
    // G06 战术回响：K 生效后登记下一次 J 的追加攻击。
    const echoArmed = this.buildEffects.armTacticalEcho();
    this.showSkillLabel(echoArmed ? `${baseLabel} · 回响就绪` : baseLabel);
    this.syncMuelsyseForm();
    this.syncMuelsyseCopies();
  }

  /**
   * 缪尔赛思 L：近战形态每 2 秒拉拽并眩晕，远程形态刷新副本并束缚命中。
   * 无主流形时不消耗冷却，只提示先重建。
   */
  private castShallowAdaptation(): void {
    if (this.playerHealth.isDead) return;
    const muelsyse = this.muelsyse;
    const result = muelsyse?.tryActivateL();
    if (!result || !muelsyse) return;

    if (!result.activated) {
      if (result.reason === 'no-form') {
        this.showSkillLabel('流形已消散 · 先按 K 重建');
      }
      return;
    }

    const label =
      result.form === 'melee'
        ? '浅层非熵适应 · 拉拽'
        : result.refreshedCopies > 0
          ? `浅层非熵适应 · 副本 ${result.refreshedCopies} 刷新`
          : '浅层非熵适应 · 束缚';
    this.playSfx(COMBAT_SFX.skillL);
    this.showCastPulse();
    this.applyR04CooldownRefund(muelsyse.lCooldownRemaining, (seconds) =>
      this.reduceLCooldown(seconds),
    );
    this.showSkillLabel(label);
    this.syncMuelsyseForm();
    this.syncMuelsyseCopies();
  }

  /** L：启动爆裂黎明；冷却中重复按键不重置弹药。 */
  private castBurst(): void {
    if (!this.burst?.tryActivate()) return;
    this.playSfx(COMBAT_SFX.skillL);
    this.showCastPulse();
    this.applyR04CooldownRefund(this.burst.cooldownRemaining, (seconds) =>
      this.reduceLCooldown(seconds),
    );
    this.showSkillLabel('爆裂黎明');
  }

  /** 击杀金币反馈：敌人位置浮出“+N 金币”，与经验球区分。 */
  private showGoldGain(x: number, y: number, amount: number): void {
    if (!(amount > 0)) return;
    // 固定位置的短提示与击杀点浮字并存：前者保证任何位置都能读到「金币+N」。
    this.showHudToast('gold', formatGoldToast(amount));
    const text = this.add
      .text(x, y - 10, `+${amount} 金币`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffd98a',
        stroke: '#181018',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({
      targets: text,
      y: text.y - 16,
      alpha: 0,
      duration: 620,
      onComplete: () => text.destroy(),
    });
  }

  private showSkillLabel(label: string, color?: string, yOffset = 0): void {
    const position = this.motion.position;
    const text = this.add
      .text(position.x, position.y - 34 - yOffset, label, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: color ?? characterEffectColors(this.character.id).label,
        stroke: '#181018',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({
      targets: text,
      y: text.y - 18,
      alpha: 0,
      duration: 520,
      onComplete: () => text.destroy(),
    });
  }

  private showExplosion(x: number, y: number, radius: number, color: number): void {
    const effect = color === ENEMY_WARNING.projectile || color === ENEMY_WARNING.fill ? 'flame' : this.character.id === 'amiya' ? 'arcane' : this.character.id === 'muelsyse' ? 'tide' : 'flame';
    this.showArtBurst(x, y, radius * 2, effect, 0.8);
  }

  /** Transient art only: does not dispatch damage, change range or obscure enemy warnings. */
  private showArtBurst(x: number, y: number, size: number, effect: string, alpha = 0.65): void {
    const burst = this.add.sprite(x, y, 'atlas-fx').setDisplaySize(size, size).setAlpha(alpha).setDepth(FRIENDLY_EFFECT_DEPTH.castPulse);
    burst.play(`fx-${effect}`);
    burst.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => burst.destroy());
  }

  /** 技能启动的可见反馈：角色主色脉冲，与普通攻击弹体区分。 */
  private showCastPulse(): void {
    const position = this.motion.position;
    const color = characterEffectColors(this.character.id).primary;
    this.showArtBurst(position.x, position.y, 72, this.character.id === 'amiya' ? 'arcane' : this.character.id === 'muelsyse' ? 'tide' : this.character.id === 'saria' ? 'ice' : 'flame', 0.6);
    const ring = this.add
      .circle(position.x, position.y, 22, color, 0.18)
      .setStrokeStyle(2, characterEffectColors(this.character.id).secondary, 0.9)
      .setDepth(FRIENDLY_EFFECT_DEPTH.castPulse);
    this.tweens.add({
      targets: ring,
      scale: 2.1,
      alpha: 0,
      duration: 340,
      onComplete: () => ring.destroy(),
    });
  }

  /** 强化获取反馈：金色脉冲 + 技能名浮字，和技能启动区分。 */
  private showUpgradePulse(): void {
    const position = this.motion.position;
    const ring = this.add
      .circle(
        position.x,
        position.y,
        UPGRADE_FEEDBACK.pulseRadius,
        0xffd166,
        0.16,
      )
      .setStrokeStyle(2, 0xffe9a8, 0.9)
      .setDepth(FRIENDLY_EFFECT_DEPTH.explosion);
    this.tweens.add({
      targets: ring,
      scale: UPGRADE_FEEDBACK.pulseScale,
      alpha: 0,
      duration: UPGRADE_FEEDBACK.pulseDurationMs,
      onComplete: () => ring.destroy(),
    });
  }

  /** 敌人命中闪白：Arc 改填充色，短暂后恢复行为配色；死亡目标不再恢复。 */
  private flashEnemyHit(view: EnemyView): void {
    if (!view.unit.combatant.isAlive) return;
    view.body.setTintFill(HIT_FEEDBACK.flashColor);
    this.time.delayedCall(HIT_FEEDBACK.flashDurationMs, () => {
      if (!view.body.active || !view.unit.combatant.isAlive) return;
      view.body.setTint(view.baseColor);
    });
  }

  /** 所有音效统一入口；未解锁、静音或环境不支持时静默失败，不影响战斗。 */
  private playSfx(cue: SfxName): void {
    this.soundPlayer?.play(cue);
  }

  /** 余震落点预警：持续到 0.35 秒余震结算，形状与直接命中区分。 */
  private showAftershockTelegraph(
    x: number,
    y: number,
    delaySeconds: number,
    radius: number,
  ): void {
    const ring = this.add
      .circle(x, y, radius, 0xffb347, 0.12)
      .setStrokeStyle(2, 0xffe6a8, 0.8)
      .setDepth(6);
    this.tweens.add({
      targets: ring,
      scale: { from: 0.6, to: 1 },
      alpha: { from: 1, to: 0.45 },
      duration: delaySeconds * 1000,
      onComplete: () => ring.destroy(),
    });
  }

  private showHitResult(
    targetId: string,
    result: DamageResult,
    allowKillExplosion = true,
  ): void {
    const view = this.enemies.find((enemy) => enemy.unit.combatant.id === targetId);
    if (view) {
      this.showDamageResult(view, result, allowKillExplosion);
      return;
    }
    const chest = this.chest?.chest;
    if (chest && chest.id === targetId) this.showChestDamage(chest, result);
  }

  /** 伤害已在纯逻辑层结算；这里只更新伤害数字、击杀计数与死亡表现。 */
  private showDamageResult(
    view: EnemyView,
    result: DamageResult,
    allowKillExplosion = true,
  ): void {
    if (!result.applied) return;

    // 命中反馈：闪白 + 伤害字；两者都由纯逻辑返回值决定，无敌/已死目标不闪。
    const feedback = planHitFeedback(result.applied, result.damage);
    this.flashEnemyHit(view);
    this.playSfx(COMBAT_SFX.enemyHit);

    // 生命归零或已进入结果阶段后，击杀与伤害统计冻结，不再抬高本局成绩（§3、§9）。
    const countStats = shouldRecordCombatStats(
      this.playerHealth.isDead,
      this.runState.phase,
    );
    if (countStats) this.damageDealt += Math.max(0, result.damage);
    // I10：只按实际造成的伤害结算；宝箱与无伤害命中不走这里。
    this.applyItemLifesteal(result.damage);

    if (feedback?.showDamageNumber) {
      this.showDamageNumber(
        view.unit.combatant.x,
        view.unit.combatant.y - view.unit.combatant.radius,
        result.damage,
      );
    }

    if (result.died) {
      this.playSfx(COMBAT_SFX.enemyDeath);
      // 失败后既不加击杀数，也不再掉落经验球。
      if (countStats) {
        this.killCount += 1;
        this.waveKills += 1;
        // R01 锻心引擎：正式敌人击杀累积成长；宝箱不走本路径，
        // 幼虫与 Boss 增援由 `r01GrowthKind` 排除，巢母本体仍计入。
        const growth = this.craftedEffects.registerKill(
          r01GrowthKind({
            enemyId: view.unit.enemy.id,
            elite: view.unit.enemy.elite === true,
            summoned: view.unit.summoned === true,
            kind: view.unit.combatant.kind,
          }),
        );
        if (growth > 0) {
          this.syncStatSources();
          this.playerHealth.setMaxHealth(this.effectiveMaxHealth());
          this.syncHealthHud();
          this.updateBuildHud();
          this.showSkillLabel(
            `锻心引擎 · 最大生命 +${hudValue(growth)}`,
            '#ffd166',
          );
        }
        // 击杀数与金币由同一步的 HUD 事件统一刷新，避免两套格式互相覆盖。
        // 核心资格只绑定指定精英 ID：击败才记录，未击败或普通击杀都不记。
        if (view.unit.enemy.elite === true) {
          const rewardId = this.eliteCore.registerEliteDefeat(view.unit.enemy.eliteId);
          if (rewardId) this.showSkillLabel(`精英核心资格 +1（${rewardId}）`);
          // H22 精英收藏：获取后每击败一个精英永久 +6% 伤害；
          // 获取前的击杀没有登记入口，因此不会追溯。
          const eliteDamage = this.combatHexes.registerEliteKill();
          if (eliteDamage > 0) {
            this.syncCombatHexStats();
            this.showSkillLabel(
              `精英收藏 · 伤害 +${hudValue(eliteDamage * 100)}%`,
              '#ffd166',
            );
          }
        }
        // 金币即时入账：同一敌人只奖励一次；精英额外 55。召唤物击杀归玩家。
        // 经验独立结算：普通 5、精英 80。Boss 二阶段增援不给任何收益。
        if (!this.playerHealth.isDead && enemyGrantsKillRewards(view.unit)) {
          const award = this.economy.awardKill(
            view.unit.id,
            view.unit.enemy,
            view.unit.enemy.elite === true,
            this.stats.killGoldMultiplier,
          );
          if (award.awarded) {
            if (award.gold > 0) {
              // E05 只统计击杀金币；完成奖励与商店收入不进本波累计。
              this.coreEffects.recordKillGold(award.gold);
              this.showGoldGain(
                view.unit.combatant.x,
                view.unit.combatant.y - view.unit.combatant.radius,
                award.gold,
              );
              this.dispatchHud({ type: 'gold', gold: this.economy.gold });
            }
            const orb = this.progression.spawnXpOrb(
              view.unit.combatant.x,
              view.unit.combatant.y,
              view.unit.enemy.elite === true,
              view.unit.enemy.xpReward,
            );
            this.createXpOrbVisual(orb);
          }
        }
        // S12 赏金标记：击杀标记目标额外入账 12×强度，每波最多 2 次；
        // 宝箱不是敌人（宝箱伤害走 `showChestDamage`），同一目标只领取一次。
        const bounty = this.bountyMark.claimKill(view.unit.combatant.id, {
          isChest: view.unit.combatant.kind === 'chest',
        });
        if (bounty > 0) {
          const awarded = this.economy.addGold(bounty);
          if (awarded > 0) {
            this.showGoldGain(
              view.unit.combatant.x,
              view.unit.combatant.y - view.unit.combatant.radius,
              awarded,
            );
            this.showSkillLabel(`赏金标记 · +${awarded} 金币`);
            this.dispatchHud({ type: 'gold', gold: this.economy.gold });
          }
        }
      }
      view.body.setTint(view.baseColor);
      view.body.setAlpha(0.22);
      view.shadow.setVisible(false);
      view.hpBackground.setVisible(false);
      view.hpFill.setVisible(false);
      view.statusText.setVisible(false);
      view.windupRing.setVisible(false);
      view.warningLine?.setVisible(false);
      view.weakPointLine?.setVisible(false);
      view.weakPointLabel?.setVisible(false);
      view.nameText.setText(`${view.label} · 已击杀`).setColor('#8a8490').setVisible(true);
      this.showDeathBurst(view.unit.combatant.x, view.unit.combatant.y, view.unit.combatant.radius);
      this.handlePlayerKill(view, allowKillExplosion);
    } else {
      this.tweens.add({
        targets: view.body,
        alpha: { from: 1, to: 0.35 },
        duration: 60,
        yoyo: true,
      });
    }
  }

  /**
   * 玩家击杀后的强化触发：
   * - G08 的冷却返还对所有击杀生效；
   * - G05 只由直接击杀触发，爆炸自身的命中以 `allowKillExplosion=false` 禁止再次触发。
   */
  private handlePlayerKill(view: EnemyView, allowKillExplosion: boolean): void {
    if (this.playerHealth.isDead) return;

    const reduction = this.buildEffects.registerKill({
      kCooldownActive: this.kCooldownRemaining() > 0,
      lCooldownActive: this.lCooldownRemaining() > 0,
    });
    if (reduction.k > 0) this.reduceKCooldown(reduction.k);
    if (reduction.l > 0) this.reduceLCooldown(reduction.l);

    if (!allowKillExplosion) return;
    const center = view.unit.combatant;
    const explosion = this.buildEffects.resolveKillExplosion(
      { x: center.x, y: center.y },
      this.collectTargets(),
      {
        allowTrigger: true,
        lineOfSight: (from, to) => hasLineOfSight(this.layout, from, to),
        magicDamageMultiplier: (targetId) =>
          this.enemyDamageMultiplier(targetId, 'magic'),
      },
    );
    if (!explosion) return;

    this.showExplosion(explosion.x, explosion.y, explosion.radius, 0xff8a3d);
    this.showSkillLabel('余烬扩散');
    for (const hit of explosion.hits) {
      this.showHitResult(hit.targetId, hit.damage, false);
    }
    this.recordCoreExplosionHits(explosion.hits);
  }

  /** 当前角色 K 的剩余冷却；阿米娅、塞雷娅、缪尔赛思与维什戴尔各用真实系统，不另存副本。 */
  private kCooldownRemaining(): number {
    if (this.amiya) return this.amiya.kCooldownRemaining;
    if (this.saria) return this.saria.kCooldownRemaining;
    if (this.muelsyse) return this.muelsyse.kCooldownRemaining;
    return this.soul?.cooldownRemaining ?? 0;
  }

  /** 当前角色 L 的剩余冷却；缪尔赛思 L 由浅层非熵适应实时提供。 */
  private lCooldownRemaining(): number {
    if (this.amiya) return this.amiya.lCooldownRemaining;
    if (this.saria) return this.saria.lCooldownRemaining;
    if (this.muelsyse) return this.muelsyse.lCooldownRemaining;
    return this.burst?.cooldownRemaining ?? 0;
  }

  private reduceKCooldown(seconds: number): void {
    const floor = this.buildEffects.cooldownFloor(this.character.skillK.cooldownSeconds);
    if (this.amiya) {
      this.amiya.reduceCooldown(seconds, floor);
      return;
    }
    if (this.saria) {
      this.saria.reduceCooldown(seconds, floor);
      return;
    }
    if (this.muelsyse) {
      this.muelsyse.reduceCooldown(seconds, floor);
      return;
    }
    this.soul?.reduceCooldown(seconds, floor);
  }

  private reduceLCooldown(seconds: number): void {
    const floor = this.buildEffects.cooldownFloor(this.character.skillL.cooldownSeconds);
    if (this.amiya) {
      this.amiya.reduceLCooldown(seconds, floor);
      return;
    }
    if (this.saria) {
      this.saria.reduceLCooldown(seconds, floor);
      return;
    }
    if (this.muelsyse) {
      this.muelsyse.reduceLCooldown(seconds, floor);
      return;
    }
    this.burst?.reduceCooldown(seconds, floor);
  }

  /**
   * R04 永昼回路：登记一次成功技能施放；每第 4 次返还该技能当前冷却的 35%。
   * `cooldownSeconds` 必须是本次施放刚写入的完整冷却，必须在 `reduce` 之前读取。
   * 冷却中失败的施放不调用本方法，E06 复施也不调用（不累计次数）。
   */
  private applyR04CooldownRefund(
    cooldownSeconds: number,
    reduce: (seconds: number) => void,
  ): void {
    if (!this.craftedEffects.registerSkillCast()) return;
    const refund = Math.max(0, cooldownSeconds) * R04_REFUND_COOLDOWN_RATIO;
    if (!(refund > 0) || !Number.isFinite(refund)) return;
    reduce(refund);
    this.craftedEffects.recordCooldownRefund(refund);
    this.showCooldownRefundLabel(refund);
  }

  /** R04 返还提示：独立浮字，避免覆盖各技能自己的施放标签。 */
  private showCooldownRefundLabel(refund: number): void {
    const position = this.motion.position;
    const text = this.add
      .text(position.x, position.y - 50, `永昼回路 · 冷却 -${hudValue(refund)}s`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffe08a',
        stroke: '#181018',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({
      targets: text,
      y: text.y - 16,
      alpha: 0,
      duration: 700,
      onComplete: () => text.destroy(),
    });
  }

  private showStunLabel(targetId: string, stunSeconds: number): void {
    const view = this.enemies.find((enemy) => enemy.unit.combatant.id === targetId);
    if (!view) return;
    const text = this.add
      .text(
        view.unit.combatant.x,
        view.unit.combatant.y - view.unit.combatant.radius - 10,
        `眩晕 ${stunSeconds.toFixed(1)}s`,
        {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#cfe8ff',
          stroke: '#181018',
          strokeThickness: 3,
        },
      )
      .setOrigin(0.5)
      .setDepth(30);

    this.tweens.add({
      targets: text,
      y: text.y - 16,
      alpha: 0,
      duration: 420,
      onComplete: () => text.destroy(),
    });
  }

  /** W02 扩散标记的位置提示；具体标记状态仍由血条上方文字显示。 */
  private showSpreadLabel(x: number, y: number, count: number): void {
    const text = this.add
      .text(x, y - 18, `残影扩散 ×${count}`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#d8b4fe',
        stroke: '#181018',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(30);

    this.tweens.add({
      targets: text,
      y: text.y - 16,
      alpha: 0,
      duration: 480,
      onComplete: () => text.destroy(),
    });
  }

  /** 残影标记与眩晕状态显示在血条上方，便于观察连锁是否生效。 */
  private syncEnemyStatus(view: EnemyView): void {
    const combatant = view.unit.combatant;
    if (!combatant.isAlive) {
      view.statusText.setVisible(false);
      return;
    }
    // 爆爆兽蓄力：血条上方显示倒计时，与地面伤害圈同步。
    if (view.unit.enemy.behavior === 'explode' && view.unit.activity === 'windup') {
      view.statusText
        .setText(`自爆 ${view.unit.windupRemaining.toFixed(1)}s`)
        .setColor('#ff9a76')
        .setVisible(true);
      return;
    }
    if (this.grenade?.isStunned(combatant.id)) {
      const remaining = this.grenade.stunRemaining(combatant.id);
      // Boss 免疫眩晕：同一控制效果只显示为减速，与实际移动速度一致。
      const bossControlled = view.unit.enemy.behavior === 'boss';
      view.statusText
        .setText(`${bossControlled ? '减速' : '眩晕'} ${remaining.toFixed(1)}s`)
        .setColor(bossControlled ? '#9bd7ff' : '#cfe8ff')
        .setVisible(true);
      return;
    }
    const muelsyseStun = this.muelsyse?.enemyStunRemaining(combatant.id) ?? 0;
    if (muelsyseStun > 0) {
      view.statusText
        .setText(`眩晕 ${muelsyseStun.toFixed(1)}s`)
        .setColor('#cfe8ff')
        .setVisible(true);
      return;
    }
    const muelsyseRoot = this.muelsyse?.enemyRootRemaining(combatant.id) ?? 0;
    if (muelsyseRoot > 0) {
      view.statusText
        .setText(`束缚 ${muelsyseRoot.toFixed(1)}s`)
        .setColor('#9df2dd')
        .setVisible(true);
      return;
    }
    // 魂灵、G07 闪避脉冲、霜环与缪尔赛思的 Boss 减速共用减速状态显示，取较长剩余时间。
    const slowRemaining = Math.max(
      this.soul?.slowRemaining(combatant.id) ?? 0,
      this.buildEffects.slowRemaining(combatant.id),
      this.freeSkillSlows.remaining(combatant.id),
      this.muelsyse?.enemySlowRemaining(combatant.id) ?? 0,
    );
    if (this.grenade?.isMarked(combatant.id)) {
      const slow = slowRemaining > 0 ? ` · 减速 ${slowRemaining.toFixed(1)}s` : '';
      view.statusText.setText(`残影${slow}`).setColor('#d8b4fe').setVisible(true);
      return;
    }
    // 钙质化的减速跟随玩家位置实时生效，离开领域立即不再显示。
    if (this.isEnemyInCalciumField(combatant.id)) {
      const slowPercent = Math.round((this.saria?.enemySlowPercent ?? 0) * 100);
      view.statusText
        .setText(`钙质化 · 减速 ${slowPercent}%`)
        .setColor('#ffd166')
        .setVisible(true);
      return;
    }
    if (slowRemaining > 0) {
      view.statusText
        .setText(`减速 ${slowRemaining.toFixed(1)}s`)
        .setColor('#9bd7ff')
        .setVisible(true);
      return;
    }
    view.statusText.setVisible(false);
  }

  private syncEnemyHealthBar(view: EnemyView): void {
    const health = view.unit.combatant.health;
    const ratio = Math.min(1, Math.max(0, health.health / health.maxHealth));
    view.hpFill.setSize(view.hpWidth * ratio, view.unit.enemy.behavior === 'boss' ? 9 : 6);
  }

  private showDamageNumber(x: number, y: number, damage: number): void {
    const text = this.add
      .text(x, y, `${hudValue(damage)}`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffe9a8',
        stroke: '#2a1620',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(30);

    this.tweens.add({
      targets: text,
      y: y - 20,
      alpha: 0,
      duration: 520,
      onComplete: () => text.destroy(),
    });
  }

  private showDeathBurst(x: number, y: number, radius: number): void {
    const burst = this.add.circle(x, y, radius, 0xffd166, 0.55).setDepth(7);
    this.tweens.add({
      targets: burst,
      scale: 2.2,
      alpha: 0,
      duration: 320,
      onComplete: () => burst.destroy(),
    });
  }

  /** 灯灵治疗反馈：治疗者到目标的绿色连线与目标上方的回复量。 */
  private showEnemyHeal(heal: EnemyHealEvent): void {
    const line = this.add
      .line(
        0,
        0,
        heal.healerX,
        heal.healerY,
        heal.x,
        heal.y,
        0x7bf1b2,
        0.75,
      )
      .setOrigin(0, 0)
      .setLineWidth(2)
      .setDepth(FRIENDLY_EFFECT_DEPTH.explosion);
    this.tweens.add({
      targets: line,
      alpha: 0,
      duration: 240,
      onComplete: () => line.destroy(),
    });

    const text = this.add
      .text(heal.x, heal.y - 20, `+${hudValue(heal.amount)}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#7bf1b2',
        stroke: '#14241c',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({
      targets: text,
      y: text.y - 18,
      alpha: 0,
      duration: 520,
      onComplete: () => text.destroy(),
    });
  }

  /** 自爆死亡的视图：不经过玩家击杀奖励，只保留淡化残影。 */
  private markEnemySelfDestructed(view: EnemyView): void {
    view.body.setTint(view.baseColor);
    view.body.setAlpha(0.22);
    view.shadow.setVisible(false);
    view.hpBackground.setVisible(false);
    view.hpFill.setVisible(false);
    view.statusText.setVisible(false);
    view.windupRing.setVisible(false);
    view.warningLine?.setVisible(false);
    view.nameText.setText(`${view.label} · 自爆`).setColor('#8a8490').setVisible(true);
    this.showDeathBurst(view.unit.combatant.x, view.unit.combatant.y, view.unit.combatant.radius);
  }

  private collectTargets(): Combatant[] {
    const targets = this.enemies.map((enemy) => enemy.unit.combatant);
    if (this.chest?.chest.isAlive) targets.push(this.chest.chest);
    return targets;
  }

  /**
   * 轻自瞄：每发在面向 ±25°、射程内且无遮挡的候选中选择离瞄准线最近的目标。
   * 只有 Tab 手动目标才享有优先权；自动提示目标不改变「离瞄准线最近」的规则。
   * 无候选时沿面向空射，背后目标永远不会抢方向。
   */
  private resolveShotAim(
    origin: CombatPoint,
    facing: Facing,
    range: number,
  ): AimAssistResult {
    return resolveAimAssist(origin, facing, this.collectTargets(), {
      range,
      preferredTargetId: this.targetTracker.isManualSelection
        ? this.targetTracker.targetId
        : null,
      lineOfSight: (from, to) => hasLineOfSight(this.layout, from, to),
    });
  }

  /** 自动选敌只在前方 120° 扇区射程内取最近；无目标时不提示。 */
  private updateTargetHint(): void {
    const target = this.targetTracker.update(
      this.motion.position,
      this.motion.facingDirection,
      this.collectTargets(),
    );

    if (!target) {
      this.targetRing.setVisible(false);
      this.dispatchHud({ type: 'target', target: null });
      return;
    }

    this.targetRing.setPosition(target.x, target.y).setVisible(true);
    if (target.kind === 'chest') {
      const chest = this.chest?.chest;
      if (!chest || chest.id !== target.id) {
        this.dispatchHud({ type: 'target', target: null });
        return;
      }
      this.dispatchHud({
        type: 'target',
        target: {
          label: '宝箱',
          health: chest.health.health,
          maxHealth: chest.health.maxHealth,
        },
      });
      return;
    }

    const view = this.enemies.find((enemy) => enemy.unit.combatant.id === target.id);
    if (!view) return;
    const health = view.unit.combatant.health;
    this.dispatchHud({
      type: 'target',
      target: {
        label: view.label,
        health: health.health,
        maxHealth: health.maxHealth,
      },
    });
  }

  /** Tab 仅切换提示目标，不改变面向；无候选时清空。 */
  private cycleTarget(): void {
    this.targetTracker.cycle(
      this.motion.position,
      this.motion.facingDirection,
      this.collectTargets(),
    );
    this.updateTargetHint();
  }

  /** 当前角色的精灵表规格（帧尺寸、动作列、锚点与显示缩放）。 */
  private playerArt(): PlayerArtSpec {
    return playerArtFor(this.character.id);
  }

  /** 当前角色的精灵表资源键。 */
  private playerAssetKey(): string {
    return this.characterAssetKey(this.character.id);
  }

  /** 角色 ID → 精灵表资源键；新角色在此追加映射。 */
  private characterAssetKey(characterId: string): string {
    if (characterId === 'amiya') return ASSET_KEYS.playerAmiya;
    if (characterId === 'saria') return ASSET_KEYS.playerSaria;
    if (characterId === 'muelsyse') return ASSET_KEYS.playerMuelsyse;
    return ASSET_KEYS.playerVishdal;
  }

  /** 角色 ID → 精灵表路径；与资源键一一对应。 */
  private characterAssetPath(characterId: string): string {
    if (characterId === 'amiya') return ASSET_PATHS.playerAmiya;
    if (characterId === 'saria') return ASSET_PATHS.playerSaria;
    if (characterId === 'muelsyse') return ASSET_PATHS.playerMuelsyse;
    return ASSET_PATHS.playerVishdal;
  }

  /** 为当前角色的四个朝向注册待机、行走、攻击与受击动画。 */
  private createPlayerAnimations(characterId: string): void {
    const assetKey = this.characterAssetKey(characterId);
    const art = playerArtFor(characterId);
    const actions = Object.keys(art.actionColumns) as PlayerAction[];
    for (const direction of PLAYER_DIRECTIONS) {
      for (const action of actions) {
        const key = playerAnimationKey(direction, action, characterId);
        if (this.anims.exists(key)) continue;
        this.anims.create({
          key,
          frames: art.actionColumns[action].map((_column, frameIndex) => ({
            key: assetKey,
            frame: playerFrameIndex(direction, action, frameIndex, art),
          })),
          frameRate: PLAYER_ANIMATION_SETTINGS[action].frameRate,
          repeat: PLAYER_ANIMATION_SETTINGS[action].repeat,
        });
      }
    }
  }

  /**
   * 战斗输入以物理键位 code 记录，实际动作来自设置 store 的当前绑定。
   * Esc 在倒计时/战斗中暂停；暂停面板由应用壳接管，场景不再自行恢复。
   * 失焦自动暂停后必须由暂停面板的 Enter 明确继续。
   */
  private bindCombatInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    keyboard.on('keydown', this.handleKeyDown, this);
    keyboard.on('keyup', this.handleKeyUp, this);
    this.game.events.on(Phaser.Core.Events.BLUR, this.handleBlur, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard.off('keydown', this.handleKeyDown, this);
      keyboard.off('keyup', this.handleKeyUp, this);
      this.game.events.off(Phaser.Core.Events.BLUR, this.handleBlur, this);
    });
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // 场景独立运行（无应用壳共享播放器）时，首个键盘事件同样启用音频。
    this.soundPlayer?.unlock();
    const code = event.code;

    // 结果阶段（死亡或胜利）不再响应战斗输入；Enter 交给应用壳销毁本局并返回选角。
    if (this.runState.phase === 'result' || this.playerHealth.isDead) {
      if (ENTER_CODES.includes(code)) {
        event.preventDefault();
        if (!event.repeat) this.game.events.emit(RETURN_TO_CHARACTER_SELECT_EVENT);
      }
      return;
    }

    // 暂停面板拥有全部键盘输入；Space/Tab 留给面板自身，不阻止默认行为。
    if (this.combatPaused) return;

    // 奖励阶段冻结战斗：面板内移动焦点/重抽/确认；Esc 与移动攻击键都不生效。
    if (this.isRewardActive()) {
      this.handleRewardKey(event);
      return;
    }

    // 构筑面板：B 在倒计时/战斗中打开，打开时场景暂停（与暂停面板同一冻结路径）。
    // B 若被玩家重绑为战斗动作，优先执行绑定动作，避免吞掉攻击/技能。
    // 这里只做冲突判定，不解析战斗动作；战斗输入统一留给施法门禁之后。
    const buildAction = buildPanelToggleAction(code, this.buildPanelOpen);
    if (
      buildAction !== null &&
      !isKeyBoundToCombatAction(this.settingsStore.get().keyBindings, code)
    ) {
      if (
        this.runState.phase !== 'countdown' &&
        this.runState.phase !== 'combat'
      ) {
        return;
      }
      event.preventDefault();
      if (event.repeat) return;
      if (buildAction === 'open') this.openBuildPanel();
      else this.closeBuildPanel();
      return;
    }

    if (code === 'Escape') {
      if (
        this.runState.phase === 'countdown' ||
        this.runState.phase === 'combat'
      ) {
        event.preventDefault();
        if (!event.repeat) this.requestPause('manual');
      }
      return;
    }

    // 只有战斗阶段响应施法/移动/闪避：倒计时不抢跑，波末奖励与商店内不能施放技能。
    if (!canCastCombatSkills(this.runState.phase)) return;

    // 战斗时 Space/Tab 不滚屏或抢走焦点，即使被重绑到其它动作。
    if (COMBAT_PREVENT_DEFAULT_CODES.includes(code)) {
      event.preventDefault();
    }

    if (event.repeat) return;

    const bindings = this.settingsStore.get().keyBindings;
    const action = combatBindingActionForKeyCode(bindings, code);
    if (!action) return;

    if (action === 'dodge') {
      if (this.motion.requestDodge()) {
        this.playSfx(COMBAT_SFX.dodge);
        // H02：闪避起点立即落第一团火，之后按移动距离续铺。
        if (this.combatHexes.has('H02')) {
          this.combatHexes.beginDodge(this.motion.position);
          this.emberTrailSource = this.combatHexes.beginEmberTrailSource(
            this.damageChains,
          );
        }
      }
      return;
    }

    if (action === 'attack') {
      this.jHeld = true;
      return;
    }

    if (action === 'skillK') {
      if (this.amiya) {
        this.castSpiritBurst();
      } else if (this.saria) {
        this.castFirstAid();
      } else if (this.muelsyse) {
        this.castShapeShift();
      } else {
        this.castSoul();
      }
      return;
    }

    if (action === 'skillL') {
      if (this.amiya) {
        this.castChimera();
      } else if (this.saria) {
        this.castCalciumField();
      } else if (this.muelsyse) {
        this.castShallowAdaptation();
      } else {
        this.castBurst();
      }
      return;
    }

    if (action === 'skillU') {
      this.castFreeSkill('U');
      return;
    }

    if (action === 'skillI') {
      this.castFreeSkill('I');
      return;
    }

    if (action === 'cycleTarget') {
      this.cycleTarget();
      return;
    }

    this.motion.pressKey(code);
  }

  private handleKeyUp(event: KeyboardEvent): void {
    if (this.combatPaused) return;
    const action = combatBindingActionForKeyCode(
      this.settingsStore.get().keyBindings,
      event.code,
    );
    if (action === 'attack') this.jHeld = false;
    this.motion.releaseKey(event.code);
  }

  /** 失焦立即清空按键、取消闪避并冻结逻辑推进；必须由暂停面板 Enter 继续。 */
  private handleBlur(): void {
    this.jHeld = false;
    this.motion.clearKeys();
    this.motion.cancelDodge();
    this.requestPause('blur');
  }

  /**
   * 暂停并通知应用壳显示暂停面板；暂停期间固定逻辑步不再推进，
   * 敌人、弹体、冷却、持续效果与波次计时因此全部冻结。
   */
  requestPause(reason: PauseReason): boolean {
    if (this.combatPaused) return false;
    if (this.runState.phase === 'result' || this.playerHealth.isDead) return false;
    if (!this.pauseController.pause(reason)) return false;
    if (!this.freezeCombat()) {
      this.pauseController.reset();
      return false;
    }
    this.pauseHint
      .setText(
        reason === 'blur' || reason === 'checkpoint'
          ? '已暂停（失焦 / 恢复）\n按 Enter 明确继续'
          : '已暂停\n按 Enter 或 Esc 继续',
      )
      .setVisible(true);
    this.game.events.emit(PAUSE_MENU_EVENT, { reason });
    return true;
  }

  /** 打开构筑面板：暂停战斗、冻结输入与逻辑步，再由应用壳显示 DOM 面板。 */
  openBuildPanel(): boolean {
    if (this.buildPanelOpen || this.combatPaused) return false;
    if (this.runState.phase === 'result' || this.playerHealth.isDead) return false;
    if (!this.pauseController.pause('manual')) return false;
    if (!this.freezeCombat()) {
      this.pauseController.reset();
      return false;
    }
    this.buildPanelOpen = true;
    // 覆盖层取代画布内暂停提示；关闭后 resumeCombat 会统一隐藏。
    this.pauseHint.setVisible(false);
    this.game.events.emit(BUILD_PANEL_EVENT, {
      type: 'open',
      view: this.createBuildPanelView(),
    });
    return true;
  }

  /** 关闭构筑面板并恢复战斗；面板的 B/Esc 关闭都走这里。 */
  closeBuildPanel(): boolean {
    if (!this.buildPanelOpen) return this.resumeCombat('escape');
    this.buildPanelOpen = false;
    this.game.events.emit(BUILD_PANEL_EVENT, { type: 'close' });
    return this.resumeCombat('escape');
  }

  /**
   * 冻结战斗的公共路径：暂停面板与构筑面板共用，保证敌人、弹体、冷却、
   * 持续效果与波次计时在任意覆盖层打开时都停止推进。
   */
  private freezeCombat(): boolean {
    if (!this.runState.pause()) return false;
    this.combatPaused = true;
    this.jHeld = false;
    this.castPoseSeconds = 0;
    this.hurtPoseSeconds = 0;
    this.motion.clearKeys();
    this.motion.cancelDodge();
    this.logicLoop.reset();
    this.syncPlayerAnimation();
    return true;
  }

  /** 应用壳暂停面板调用：失焦/续局暂停拒绝 Esc，只接受 Enter。 */
  resumeCombat(input: PauseResumeInput = 'enter'): boolean {
    if (!this.combatPaused) return true;
    if (!this.pauseController.resume(input)) return false;
    this.combatPaused = false;
    // 暂停面板恢复可能发生在构筑面板打开期间（如外部调用），一并复位。
    this.buildPanelOpen = false;
    this.runState.resume();
    this.jHeld = false;
    this.motion.clearKeys();
    this.logicLoop.reset();
    this.pauseHint.setVisible(false);
    // 恢复后的第一帧就显示真实金币/护盾/冷却/倒计时，不留暂停前旧值。
    this.resyncHudFromSystems();
    // 暂停菜单出现时应用壳会收起商店面板；续局/手动暂停结束后重新发布，
    // 让波间商店继续可交互（场景仍认为面板打开时不重复 open）。
    if (this.shopPanelOpen) this.publishShopPanel();
    return true;
  }

  /** 暂停原因；未暂停为 null（开发快照与浏览器验收共用）。 */
  getPauseReason(): PauseReason | null {
    return this.combatPaused ? this.pauseController.reason : null;
  }

  /** 左下角战斗提示使用当前绑定；重绑后同步刷新。 */
  private updateControlsHint(bindings: KeyBindings): void {
    if (!this.controlsHint) return;
    const key = (action: keyof KeyBindings): string => keyCodeLabel(bindings[action]);
    const move = `${key('moveUp')}${key('moveLeft')}${key('moveDown')}${key('moveRight')}`;
    const attackName =
      this.character.id === 'amiya'
        ? '源石术式'
        : this.character.id === 'saria'
          ? '盾击'
          : this.character.id === 'muelsyse'
            ? '水弹'
            : '攻击';
    const kName =
      this.character.id === 'amiya'
        ? '精神爆发'
        : this.character.id === 'saria'
          ? '急救配置'
          : this.character.id === 'muelsyse'
            ? '切换流形'
            : '魂灵';
    const lName =
      this.character.id === 'amiya'
        ? '奇美拉'
        : this.character.id === 'saria'
          ? '钙质化'
          : this.character.id === 'muelsyse'
            ? '浅层非熵适应'
            : '爆裂';
    const parts = [
      `${move} 移动`,
      `${key('attack')} ${attackName}`,
      `${key('skillK')} ${kName}`,
      `${key('skillL')} ${lName}`,
      `${key('skillU')}/${key('skillI')} 自由技能`,
    ];
    parts.push(`${key('cycleTarget')} 切换目标`, `${key('dodge')} 闪避`, 'Esc 暂停');
    this.controlsHint.setText(parts.join(' · '));
  }

  private syncPlayerSprite(): void {
    const position = this.motion.position;
    const spriteY = position.y - PLAYER.bodyCenterOffsetY;
    this.player.setPosition(position.x, spriteY);
    this.playerShadow.setPosition(position.x, spriteY + 2);
    // 本体标记跟随碰撞圆心；八向指示线直接使用逻辑面向，而不是四向行走帧。
    this.playerMarkerRing.setPosition(position.x, position.y);
    this.playerMarkerLabel.setPosition(position.x, position.y + 8);
    this.drawFacingIndicator(
      this.playerFacingGraphics,
      position,
      this.motion.facingDirection,
      0xffd166,
    );
  }

  /** 地面八向指示线：方向与弹体创建共用 FACING_VECTORS，斜向也精确可见。 */
  private drawFacingIndicator(
    graphics: Phaser.GameObjects.Graphics,
    origin: { readonly x: number; readonly y: number },
    facing: Facing,
    color: number,
  ): void {
    const indicator = facingIndicatorAt(origin, facing);
    graphics.clear();
    graphics.lineStyle(2, color, 0.95);
    graphics.lineBetween(
      indicator.start.x,
      indicator.start.y,
      indicator.end.x,
      indicator.end.y,
    );
    graphics.fillStyle(color, 0.95);
    graphics.fillTriangle(
      indicator.end.x,
      indicator.end.y,
      indicator.headLeft.x,
      indicator.headLeft.y,
      indicator.headRight.x,
      indicator.headRight.y,
    );
  }

  /** 受击帧优先于施法/行走；四向素材由八向面向映射，射击瞬间播放八向施法帧。 */
  private syncPlayerAnimation(): void {
    if (this.hurtPoseSeconds > 0) {
      const direction = facingToSpriteDirection(this.motion.facingDirection);
      this.player.play(playerAnimationKey(direction, 'hurt', this.character.id), true);
      return;
    }

    if (this.castPoseSeconds > 0 && this.castPoseFacing) {
      this.player.anims.stop();
      this.player.setTexture(
        this.playerAssetKey(),
        playerCastFrameIndex(this.castPoseFacing, this.playerArt()),
      );
      return;
    }

    const action: PlayerAction = this.motion.isMoving ? 'walk' : 'idle';
    const direction = facingToSpriteDirection(this.motion.facingDirection);
    const key = playerAnimationKey(direction, action, this.character.id);
    if (!this.player.anims.isPlaying || this.player.anims.currentAnim?.key !== key) {
      this.player.play(key);
    }
  }

  /** 真实帧长只作为输入；逻辑推进固定为 1/60 秒一步，并限制追帧。 */
  update(_time: number, deltaMilliseconds: number): void {
    if (this.combatPaused) return;
    // 生命归零后立即停止逻辑推进；升级选择与波末奖励期间同样冻结。
    if (this.runState.phase === 'result') return;
    if (this.isRewardActive()) return;
    this.logicLoop.advance(deltaMilliseconds / 1000);
  }

  /** 只读的进场状态，供开发调试与后续故事复用。 */
  getPlayerPosition(): { x: number; y: number } {
    const position = this.motion.position;
    return { x: position.x, y: position.y };
  }

  getPlayerFacing(): string {
    return this.motion.facingDirection;
  }

  getDodgeCooldownRemaining(): number {
    return this.motion.dodgeCooldownRemaining;
  }

  isPlayerInvulnerable(): boolean {
    return this.motion.isInvulnerable;
  }

  isCombatPaused(): boolean {
    return this.combatPaused;
  }

  /** 已模拟的逻辑秒数，与渲染帧率无关。 */
  getSimulatedSeconds(): number {
    return this.simulatedSeconds;
  }

  /** 当前提示目标 ID；自动选敌与 Tab 共用。 */
  getTargetId(): string | null {
    return this.targetTracker.targetId;
  }

  getKillCount(): number {
    return this.killCount;
  }

  /** 本局已对敌人造成的累计伤害，供结算与调试快照读取。 */
  getDamageDealt(): number {
    return this.damageDealt;
  }

  /** 当前波次与刷怪余量，供开发调试与浏览器验收。 */
  getWave(): number {
    return this.waveNumber;
  }

  /** 波末奖励阶段；战斗中为 `none`。 */
  getRewardStage(): string {
    return this.rewardFlow?.stage ?? 'none';
  }

  getRemainingToSpawn(): number {
    return this.waveRunner?.remainingToSpawn ?? 0;
  }

  getAliveEnemyCount(): number {
    return this.enemySystem.enemies.reduce(
      (total, unit) => (unit.combatant.isAlive ? total + 1 : total),
      0,
    );
  }

  /** 等级、经验与排队升级，供开发调试与浏览器验收。 */
  getLevel(): number {
    return this.progression.level;
  }

  getExperience(): number {
    return this.progression.experience;
  }

  getExperienceToNextLevel(): number {
    return this.progression.experienceToNextLevel;
  }

  getPendingLevelUps(): number {
    return this.progression.pendingLevelUps;
  }

  /** 本局强化抽取种子与剩余重抽次数，供开发调试与浏览器验收。 */
  getRunSeed(): number {
    return this.upgradeRun.seed;
  }

  getRerollsRemaining(): number {
    return this.upgradeRun.rerollsRemaining;
  }

  /** 当前强化面板类型；未打开面板时为 null。 */
  getUpgradeChoiceKind(): 'upgrade' | 'mechanic' | 'hex' | null {
    return this.activeChoice()?.kind ?? null;
  }

  getUpgradeFocusIndex(): number {
    return this.activeChoice()?.focusIndex ?? -1;
  }

  /** 当前手牌的可序列化快照，供开发调试与浏览器验收。 */
  getUpgradeHand(): readonly {
    readonly id: string;
    readonly name: string;
    readonly rarity: string;
    readonly owner: string;
    readonly maxStacks: number;
    readonly stacks: number;
    readonly appliesTo: string;
    readonly description: string;
  }[] {
    if (this.hexChoice) {
      return this.hexChoice.hand.map((card) => ({
        id: card.id,
        name: card.name,
        rarity: card.rarity,
        owner: card.owner,
        maxStacks: 1,
        stacks: this.hexRun.has(card.id) ? 1 : 0,
        appliesTo: '海克斯',
        description: card.effect,
      }));
    }
    return (this.upgradeChoice?.hand ?? []).map((card) => ({
      id: card.id,
      name: card.name,
      rarity: card.rarity,
      owner: card.owner,
      maxStacks: card.maxStacks,
      stacks: this.upgradeRun.stacksOf(card.id),
      appliesTo: card.appliesTo,
      description: card.description,
    }));
  }

  /** 本局已获得的海克斯 ID；每种最高 1 层。 */
  getOwnedHexes(): readonly string[] {
    return this.hexRun.ownedIds;
  }

  /** 当前三选一面板的只读快照；海克斯与强化/机制共用同一字段。 */
  private choiceSnapshot(): {
    readonly kind: 'upgrade' | 'mechanic' | 'hex';
    readonly focusIndex: number;
    readonly rerollsRemaining: number;
    readonly cards: readonly {
      readonly id: string;
      readonly name: string;
      readonly rarity: string;
      readonly owner?: string;
    }[];
  } | null {
    const choice = this.activeChoice();
    if (!choice) return null;
    return {
      kind: choice.kind,
      focusIndex: choice.focusIndex,
      rerollsRemaining: choice.rerollsRemaining,
      cards: choice.hand.map((card) => ({
        id: card.id,
        name: card.name,
        rarity: card.rarity,
        owner: card.owner,
      })),
    };
  }

  /** 本局已获得强化与层数。 */
  getOwnedUpgrades(): readonly { readonly id: string; readonly stacks: number }[] {
    return this.upgradeRun.ownedIds().map((id) => ({
      id,
      stacks: this.upgradeRun.stacksOf(id),
    }));
  }

  /** G01–G08 的实际倍率与临时状态，供开发调试与浏览器验收。 */
  getBuildStats(): {
    damageMultiplier: number;
    moveSpeedMultiplier: number;
    cooldownReduction: number;
    maxHealthBonus: number;
    echoRemainingSeconds: number;
    killExplosionUnlocked: boolean;
    dodgePulseUnlocked: boolean;
    killProgress: { k: number; l: number };
  } {
    return {
      damageMultiplier: this.stats.damageMultiplier,
      moveSpeedMultiplier: this.stats.moveSpeedMultiplier,
      cooldownReduction: this.stats.cooldownReduction,
      maxHealthBonus: this.buildEffects.maxHealthBonus,
      echoRemainingSeconds: this.buildEffects.echoRemainingSeconds,
      killExplosionUnlocked: this.buildEffects.has('G05'),
      dodgePulseUnlocked: this.buildEffects.has('G07'),
      killProgress: this.buildEffects.killProgress,
    };
  }

  getXpOrbCount(): number {
    return this.progression.orbCount;
  }

  getXpOrbSnapshot(): readonly ExperienceOrb[] {
    return this.progression.orbs;
  }

  getProjectileCount(): number {
    return this.projectiles.length;
  }

  /** 尚未结算的延时余震数量，供开发调试与浏览器验收。 */
  getPendingAftershockCount(): number {
    return this.grenade?.pendingAftershockCount ?? 0;
  }

  /** 当前带残影标记的敌人 ID，供开发调试与浏览器验收。 */
  getMarkedEnemyIds(): readonly string[] {
    return this.grenade?.markedIds ?? [];
  }

  isEnemyStunned(id: string): boolean {
    // Boss 的眩晕已转换为减速，不能被报告为“眩晕”，否则与实际行为矛盾。
    if (this.enemySystem.enemies.some((unit) => unit.id === id && unit.enemy.behavior === 'boss')) {
      return false;
    }
    return (
      (this.grenade?.isStunned(id) ?? false) ||
      (this.muelsyse?.isEnemyStunned(id) ?? false)
    );
  }

  isEnemyRooted(id: string): boolean {
    // 同理，Boss 的束缚只表现为减速。
    if (this.enemySystem.enemies.some((unit) => unit.id === id && unit.enemy.behavior === 'boss')) {
      return false;
    }
    return this.muelsyse?.isEnemyRooted(id) ?? false;
  }

  /** 当前存活魂灵数量与快照，供开发调试与浏览器验收。 */
  getSoulCount(): number {
    return this.soul?.soulCount ?? 0;
  }

  getSoulSnapshots(): readonly SoulSnapshot[] {
    return this.soul?.snapshots ?? [];
  }

  /** 爆裂黎明剩余弹药与冷却，供开发调试与浏览器验收。 */
  getBurstAmmo(): number {
    return this.burst?.ammoRemaining ?? 0;
  }

  getBurstCooldownRemaining(): number {
    return this.burst?.cooldownRemaining ?? 0;
  }

  /** 当前角色 ID，供开发调试与浏览器验收。 */
  getCharacterId(): string {
    return this.character.id;
  }

  /** Boss 波只读状态；普通波返回 null。 */
  private getBossSnapshot(): {
    phase: 1 | 2;
    health: number;
    maxHealth: number;
    alive: boolean;
    summonRemainingSeconds: number;
    blastCount: number;
    reinforcementCount: number;
    activity: string;
  } | null {
    const boss = this.enemySystem.boss;
    const unit = this.enemySystem.enemies.find((entry) => entry.enemy.behavior === 'boss');
    if (!boss || !unit) return null;
    return {
      phase: boss.phase,
      health: unit.combatant.health.health,
      maxHealth: unit.combatant.health.maxHealth,
      alive: unit.combatant.isAlive,
      summonRemainingSeconds: boss.summonRemainingSeconds,
      blastCount: boss.blasts.length,
      reinforcementCount: this.enemySystem.enemies.filter(
        (entry) => entry.summoned && entry.combatant.isAlive,
      ).length,
      activity: boss.activity,
    };
  }

  /**
   * 只读状态快照：每次返回新的可序列化副本，不含渲染对象或内部可变引用。
   * 场景尚未创建完成时返回 null；没有任何写入入口。
   */
  /** 当前 CSS 画布尺寸下的 HUD 缩放与字号；开发快照与浏览器验收共用。 */
  private currentHudViewport(): ReturnType<typeof computeHudViewport> {
    const display = this.scale.displaySize;
    const width = display.width > 0 ? display.width : VIEWPORT.width;
    const height = display.height > 0 ? display.height : VIEWPORT.height;
    return computeHudViewport(width, height);
  }

  /** 最近一次合成结果的可序列化副本；失败时金币/材料应保持不变。 */
  private craftResultSnapshot(result: CraftResult): DevCraftResultSnapshot {
    const inspection = this.craftingSession?.inspect(result.recipeId) ?? null;
    if (result.ok) {
      return {
        ok: true,
        recipeId: result.recipeId,
        reason: null,
        shortfall: 0,
        fee: result.fee,
        goldBefore: result.goldBefore,
        goldAfter: result.goldAfter,
        materials: result.materials.map((material) => ({
          id: material.id,
          name: material.name,
          stacksBefore: material.stacksBefore,
          stacksAfter: material.stacksAfter,
          layersConsumed: 1,
        })),
        crafted: [...result.crafted],
      };
    }
    return {
      ok: false,
      recipeId: result.recipeId,
      reason: result.reason,
      shortfall: result.shortfall,
      fee: inspection?.fee ?? 0,
      goldBefore: result.gold,
      goldAfter: result.gold,
      materials:
        inspection?.materials.map((material) => ({
          id: material.id,
          name: material.name,
          stacksBefore: material.stacksBefore,
          stacksAfter: material.stacksBefore,
          layersConsumed: material.layersConsumed,
        })) ?? [],
      crafted: this.craftedInventory.snapshot(),
    };
  }

  /** 三件合成的开发快照：当前可合成清单、面板配方报价与最近结果。 */
  private getCraftingSnapshot(): DevCraftingSnapshot {
    const session = this.craftingSession;
    const owned = this.craftedInventory.snapshot();
    const craftable = session ? session.craftableIds() : [];
    const recipeId = this.devCraftRecipe;
    const inspection = recipeId ? session?.inspect(recipeId) ?? null : null;
    const check = recipeId ? session?.canCraft(recipeId) ?? null : null;
    const netLines = inspection
      ? formatCraftNetChanges(inspection, this.craftStatSnapshot())
      : [];

    return {
      recipeId,
      owned: [...owned],
      craftable: [...craftable],
      fee: inspection?.fee ?? null,
      gold: this.economy.gold,
      reason: check && !check.ok ? check.reason : null,
      shortfall: check && !check.ok ? check.shortfall : 0,
      missing:
        check && !check.ok
          ? check.missing.map((material) => ({ ...material }))
          : [],
      materials:
        inspection?.materials.map((material) => ({
          id: material.id,
          name: material.name,
          stacksBefore: material.stacksBefore,
          stacksAfter: material.stacksAfter,
          layersConsumed: material.layersConsumed,
        })) ?? [],
      removedModifiers:
        inspection?.removedModifiers.map((modifier) => ({
          stat: modifier.stat,
          mode: modifier.mode,
          value: modifier.value,
        })) ?? [],
      addedModifiers:
        inspection?.addedModifiers.map((modifier) => ({
          stat: modifier.stat,
          mode: modifier.mode,
          value: modifier.value,
        })) ?? [],
      statChanges:
        inspection?.statChanges.map((change, index) => ({
          stat: change.stat,
          mode: change.mode,
          label: change.label,
          removed: change.removed,
          added: change.added,
          net: change.net,
          percent: change.percent,
          before: netLines[index]?.before ?? '',
          after: netLines[index]?.after ?? '',
        })) ?? [],
      mechanics: inspection ? [...inspection.mechanics] : [],
      lastResult: this.lastCraftResult
        ? this.craftResultSnapshot(this.lastCraftResult)
        : null,
    };
  }

  /** 开发快照里的追踪状态：当前配方、材料进度与可追踪清单。 */
  private devRecipeTrackingSnapshot(): DevRecipeTrackingSnapshot {
    const ctx = this.recipeTrackingContext();
    const recipeId = this.recipeTracker.trackedRecipeId;
    const status = recipeId ? trackedRecipeStatus(recipeId, ctx) : null;
    return {
      recipeId,
      recipeName: status?.name ?? null,
      shopsSinceSupply: this.recipeTracker.shopsSinceSupply,
      ownedIngredients: status?.ownedIngredients ?? 0,
      missing: status ? [...status.missing] : [],
      ingredients: status
        ? status.ingredients.map((ingredient) => ({ ...ingredient }))
        : [],
      trackable: listTrackableRecipes(ctx).map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
      })),
    };
  }

  getDevSnapshot(): DevStateSnapshot | null {
    // 生产构建没有开发桥；静态分支让整段快照构造（含 dev 参数对照）被摇掉。
    if (!import.meta.env.DEV) return null;
    if (!this.devReady) return null;

    // 快照里的卡面必须与当前聚合属性/层数一致，不冻结抽货时的旧预览。
    this.shopShelf?.refreshItemPreviews();
    const settings = this.settingsStore.get();
    const audio = this.soundPlayer.getState();
    const marked = new Set(this.getMarkedEnemyIds());
    const hud = buildHudModel(this.hudState);
    const viewport = this.currentHudViewport();
    return {
      characterId: this.character.id,
      seed: this.upgradeRun.seed,
      randomStreams: this.randomStreams.snapshot(),
      phase: this.runState.phase,
      wave: this.waveNumber,
      countdownRemaining: this.runState.countdownRemaining,
      waveElapsedSeconds: this.waveRunner?.elapsedSeconds ?? 0,
      waveRemainingSeconds: this.waveRunner?.remainingSeconds ?? 0,
      simulatedSeconds: this.simulatedSeconds,
      paused: this.combatPaused,
      pauseReason: this.getPauseReason(),
      // 开发参数对照：请求不等于生效时，失败原因必须留在快照里。
      ...(this.devScenarioReport
        ? {
            devRequested: { ...this.devScenarioReport.devRequested },
            devApplied: { ...this.devScenarioReport.devApplied },
            devFailureReason: this.devScenarioReport.failureReason,
          }
        : {}),
      save: {
        lastSaveOk: this.lastSaveOk,
        lastCheckpointKind: this.lastCheckpointKind,
      },
      settings: {
        muted: settings.muted,
        screenShake: settings.screenShake,
        reducedMotion: settings.reducedMotion,
        keyBindings: { ...settings.keyBindings },
      },
      audio: {
        unlocked: audio.unlocked,
        muted: audio.muted,
        lastCue: audio.lastCue,
        playCount: audio.playCount,
      },
      triggerGates: this.triggerGates.snapshot(),
      coreEffects: this.coreEffects.snapshot(),
      combatEvents: this.combatEvents.snapshot().slice(-40),
      ...(this.triggerDemoReport ? { triggerDemo: this.triggerDemoReport } : {}),
      ...(this.skillEchoDemoReport
        ? { skillEchoDemo: this.skillEchoDemoReport }
        : {}),
      ...(this.shopDemoReport ? { shopDemo: this.shopDemoReport } : {}),
      ...(this.shopTransactionDemoReport
        ? { shopTransactionDemo: this.shopTransactionDemoReport }
        : {}),
      ...(this.devShopOpsReport ? { shopOps: this.devShopOpsReport } : {}),
      shop: this.shopShelf
        ? {
            wave: this.shopShelf.shopWave,
            weights: { ...this.shopShelf.weights },
            offers: this.shopShelf.offers.map((offer) => ({
              slot: offer.slot,
              kind: offer.kind,
              id: offer.id,
              name: offer.name,
              price: offer.price,
              effectivePrice: this.shopSession?.effectivePrice(offer) ?? offer.price,
              sold: offer.sold,
              locked: offer.locked,
              rarity: offer.rarity,
              prerequisite: offer.prerequisite,
              stacks: offer.stacks,
              nextStacks: offer.nextStacks,
              description: offer.description,
              cost: offer.cost,
              netChange: offer.netChange,
              previewed: offer.previewed,
            })),
            emergencyPotion: {
              id: this.shopShelf.emergencyPotion.id,
              name: this.shopShelf.emergencyPotion.name,
              price: this.shopShelf.emergencyPotion.price,
              repeatable: this.shopShelf.emergencyPotion.repeatable,
            },
            materialSupply: this.shopShelf.materialSupply
              ? {
                  recipeId: this.shopShelf.materialSupply.recipeId,
                  id: this.shopShelf.materialSupply.id,
                  name: this.shopShelf.materialSupply.name,
                  price: this.shopShelf.materialSupply.price,
                  rarity: this.shopShelf.materialSupply.rarity,
                  stacks: this.shopShelf.materialSupply.stacks,
                  stackCap: this.shopShelf.materialSupply.stackCap,
                  sold: this.shopShelf.materialSupply.sold,
                }
              : null,
            rerollCost: this.shopShelf.rerollCost,
            nextRerollCost:
              this.shopSession?.nextRerollCost ?? this.shopShelf.rerollCost,
            freeRerollAvailable: this.shopSession?.freeRerollAvailable ?? false,
            firstItemDiscountAvailable:
              this.shopSession?.firstItemDiscountAvailable ?? false,
            rerollCount: this.shopShelf.rerollCount,
            locked: this.shopShelf.lockedOffer,
            payments: this.shopPayments.snapshot(),
          }
        : null,
      recipeTracking: this.devRecipeTrackingSnapshot(),
      hud: {
        target: hud.lines.target,
        vitals: hud.lines.vitals,
        progress: hud.lines.progress,
        wave: hud.lines.wave,
        kills: hud.lines.kills,
        gold: hud.lines.gold,
        dodge: hud.lines.dodge,
        resource: hud.lines.resource,
        skillDetail: hud.lines.skillDetail,
        skills: hud.skills.map((skill) => ({
          key: skill.key,
          name: skill.name,
          status: skill.status,
          statusText: skill.statusText,
          cooldownText: skill.cooldownText,
          text: skill.text,
        })),
        viewport: {
          width: viewport.width,
          height: viewport.height,
          scale: viewport.scale,
          canvasWidth: viewport.canvasWidth,
          canvasHeight: viewport.canvasHeight,
          minCssFontSize: viewport.minCssFontSize,
          fitsMinimumFont: viewport.fitsMinimumFont,
        },
      },
      health: {
        current: this.playerHealth.health,
        max: this.playerHealth.maxHealth,
        shield: this.playerHealth.shield,
        dead: this.playerHealth.isDead,
      },
      player: {
        x: this.motion.position.x,
        y: this.motion.position.y,
        facing: this.motion.facingDirection,
        moveX: this.motion.moveDirection.x,
        moveY: this.motion.moveDirection.y,
        moving: this.motion.isMoving,
        dodging: this.motion.isDodging,
      },
      combat: {
        attackHeld: this.jHeld,
        attackCooldownRemaining: this.attackTimer.cooldownRemaining,
        dodgeCooldownRemaining: this.motion.dodgeCooldownRemaining,
        skillKCooldownRemaining: this.kCooldownRemaining(),
        skillLCooldownRemaining: this.lCooldownRemaining(),
        skillUCooldownRemaining: this.freeSkills.cooldownRemaining('U'),
        skillICooldownRemaining: this.freeSkills.cooldownRemaining('I'),
      },
      lastShot: this.lastShot ? { ...this.lastShot } : null,
      level: this.progression.level,
      experience: this.progression.experience,
      experienceToNextLevel: this.progression.experienceToNextLevel,
      pendingLevelUps: this.progression.pendingLevelUps,
      kills: this.killCount,
      gold: this.economy.gold,
      damageDealt: this.damageDealt,
      coreEligibleRewards: [...this.eliteCore.rewardIds],
      ownedCoreIds: this.coreInventory.snapshot(),
      rewardStage: this.getRewardStage(),
      rewardRemaining: this.rewardFlow?.remainingRewards ?? 0,
      rewardQueue: this.rewardFlow?.rewardQueueSnapshot.map((entry) => ({
        ...entry,
      })) ?? [],
      rewardFocus: this.chestOfferFocus,
      coreOfferFocus:
        this.rewardFlow?.stage === 'core' ? this.coreOfferFocus : 0,
      items: this.itemInventory.snapshot(),
      crafted: this.craftedInventory.snapshot(),
      craftedMechanics: this.craftedEffects.snapshot(),
      crafting: this.getCraftingSnapshot(),
      freeSkills: this.freeSkills.snapshot(),
      freeSkillEffects: {
        spinning: {
          active: this.spinningBlades.isActive,
          remainingSeconds: this.spinningBlades.remainingSecondsLeft,
          ticksFired: this.spinningBlades.ticksFired,
          radius: FREE_SKILL_S01_RADIUS,
          damagePerTick: this.spinningBlades.damagePerTick(),
          effectiveDamagePerTick:
            this.spinningBlades.damagePerTick() *
            this.sustainedDamageMultiplier(),
        },
        slows: this.freeSkillSlows.entries(),
        chain: {
          targetIds: [...this.lastChainTargetIds],
          range: FREE_SKILL_S03_RANGE,
          jumpRadius: FREE_SKILL_S03_JUMP_RADIUS,
          maxTargets: FREE_SKILL_S03_JUMPS,
        },
        gravityWell: {
          active: this.gravityWell.isActive,
          remainingSeconds: this.gravityWell.remainingSecondsLeft,
          ticksFired: this.gravityWell.ticksFired,
          radius: FREE_SKILL_S08_RADIUS,
          center: this.gravityWell.center,
          pullPerTick: this.gravityWell.pullDistancePerTick(),
          damagePerTick: this.gravityWell.damagePerTick(),
          effectiveDamagePerTick:
            this.gravityWell.damagePerTick() * this.sustainedDamageMultiplier(),
        },
        fireTrail: {
          active: this.fireTrail.isActive,
          remainingSeconds: this.fireTrail.remainingSecondsLeft,
          ticksFired: this.fireTrail.ticksFired,
          damagePerTick: this.fireTrail.damagePerTick(),
          effectiveDamagePerTick:
            this.fireTrail.damagePerTick() * this.sustainedDamageMultiplier(),
          radius: FREE_SKILL_S04_RADIUS,
          patches: this.fireTrail.patches(),
        },
        turrets: {
          count: this.turretField.count,
          maxCount: this.turretField.maxCount,
          range: FREE_SKILL_S05_RANGE,
          entries: this.turretField.entries(),
        },
        waterMirror: {
          count: this.waterMirror.count,
          maxCount: this.waterMirror.maxCount,
          damageRatio: FREE_SKILL_S09_DAMAGE_RATIO,
          echoHits: this.waterMirrorEchoHits,
          lastEchoDamage: this.lastWaterMirrorEchoDamage,
          entries: this.waterMirror.entries(),
        },
        healingPulse: {
          playerHeal: this.lastHealingPulsePlayerHeal,
          summonHealRatio: FREE_SKILL_S06_SUMMON_HEAL_RATIO,
          summonRadius: FREE_SKILL_S06_SUMMON_RADIUS,
          summons: this.lastHealingPulseSummons.map((entry) => ({
            id: entry.id,
            healed: entry.healed,
          })),
        },
        shieldBurst: {
          active: this.shieldBurst.isActive,
          remainingSeconds: this.shieldBurst.remainingSecondsLeft,
          shieldAmount: this.shieldBurst.shieldAmount,
          damagePerHit: this.shieldBurst.damagePerHit(),
          radius: FREE_SKILL_S07_RADIUS,
          knockbackDistance: FREE_SKILL_S07_KNOCKBACK_DISTANCE,
        },
        warBanner: {
          active: this.warBanner.isActive,
          remainingSeconds: this.warBanner.remainingSecondsLeft,
          radius: FREE_SKILL_S10_RADIUS,
          center: this.warBanner.center,
          armorActive: this.warBannerArmorApplied > 0,
          armorBonus: this.warBannerArmorApplied,
          contactDamage: this.warBanner.contactDamage(),
          contactHits: this.warBanner.contactHitCount,
        },
        shotgun: {
          pelletCount: this.lastShotgunPelletCount,
          spreadDegrees: FREE_SKILL_S11_SPREAD_DEGREES,
          damagePerPellet: this.lastShotgunPelletDamage,
          repeatDamageRatio: FREE_SKILL_S11_REPEAT_RATIO,
          range: FREE_SKILL_S11_RANGE,
          repeatedHits: this.shotgunRepeatedHits,
        },
        bountyMark: {
          active: this.bountyMark.isActive,
          targetId: this.bountyMark.targetId,
          remainingSeconds: this.bountyMark.remainingSecondsLeft,
          damageBonus: this.bountyMark.damageBonus(),
          gold: this.bountyMark.bountyGold(),
          claimedCount: this.bountyMark.claimedCount,
          maxPerWave: this.bountyMark.maxPerWave,
        },
      },
      stats: {
        maxHealth: this.stats.maxHealth,
        armor: this.stats.armor,
        moveSpeed: this.stats.moveSpeed,
        moveSpeedMultiplier: this.stats.moveSpeedMultiplier,
        attackSpeedMultiplier: this.stats.attackSpeedMultiplier,
        damageMultiplier: this.stats.damageMultiplier,
        directDamageMultiplier: this.stats.directDamageMultiplier,
        skillDamageMultiplier: this.stats.skillDamageMultiplier,
        normalAttackDamageMultiplier: this.stats.normalAttackDamageMultiplier,
        attackRangeMultiplier: this.stats.attackRangeMultiplier,
        projectileRadiusMultiplier: this.stats.projectileRadiusMultiplier,
        cooldownReduction: this.stats.cooldownReduction,
        skillDurationMultiplier: this.stats.skillDurationMultiplier,
        skillCooldownMultiplier: this.stats.skillCooldownMultiplier,
        explosionRadiusMultiplier: this.stats.explosionRadiusMultiplier,
        explosionDamageMultiplier: this.stats.explosionDamageMultiplier,
        explosionSkillCooldownMultiplier:
          this.stats.explosionSkillCooldownMultiplier,
        damageOverTimeMultiplier: this.stats.damageOverTimeMultiplier,
        recipeDamageOverTimeMultiplier:
          this.stats.recipeDamageOverTimeMultiplier,
        summonDamageMultiplier: this.stats.summonDamageMultiplier,
        summonHealthMultiplier: this.stats.summonHealthMultiplier,
        xpRadiusMultiplier: this.stats.xpRadiusMultiplier,
        killGoldMultiplier: this.stats.killGoldMultiplier,
        completionGoldMultiplier: this.stats.completionGoldMultiplier,
      },
      itemEffects: this.itemEffects.snapshot(),
      consumables: this.consumables.snapshot(),
      grenadeExplosionCount: this.grenade?.explosionCount ?? 0,
      xpPickupRadius: this.progression.pickupRadius,
      waveKills: this.waveKills,
      remainingToSpawn: this.getRemainingToSpawn(),
      pendingSpawnCount: this.enemySystem.telegraphs.length,
      enemyProjectileCount: this.enemySystem.projectiles.length,
      enemyProjectiles: this.enemySystem.projectiles.map((projectile) => ({
        x: projectile.x,
        y: projectile.y,
        vx: projectile.vx,
        vy: projectile.vy,
        radius: projectile.radius,
      })),
      playerProjectileCount: this.projectiles.length,
      enemies: this.enemySystem.enemies.map((unit) => ({
        id: unit.id,
        enemyId: unit.enemy.id,
        name: unit.enemy.name,
        behavior: unit.enemy.behavior,
        activity: unit.activity,
        dashX: unit.activity === 'dash' ? unit.dashX : 0,
        dashY: unit.activity === 'dash' ? unit.dashY : 0,
        x: unit.combatant.x,
        y: unit.combatant.y,
        health: unit.combatant.health.health,
        maxHealth: unit.combatant.health.maxHealth,
        shield: unit.combatant.health.shield,
        alive: unit.combatant.isAlive,
        elite: unit.enemy.elite === true,
        summoned: unit.summoned,
        eliteId: unit.enemy.eliteId,
        coreRewardId: unit.enemy.coreRewardId,
        stunned: this.isEnemyStunned(unit.id),
        rooted: this.isEnemyRooted(unit.id),
        marked: marked.has(unit.id),
        slowRemaining: this.getSlowRemaining(unit.id),
      })),
      boss: this.getBossSnapshot(),
      souls: (this.soul?.snapshots ?? []).map((soul) => ({ ...soul })),
      summon: this.muelsyse
        ? {
            form: this.muelsyse.form,
            alive: this.muelsyse.isFormAlive,
            health: this.muelsyse.formHealth,
            maxHealth: this.muelsyse.formMaxHealth,
            x: this.muelsyse.formPosition.x,
            y: this.muelsyse.formPosition.y,
            copies: this.muelsyse.copyCount,
            phantomRemainingSeconds:
              this.muelsyse.corePhantom?.remainingSeconds ?? null,
          }
        : null,
      upgrades: this.getOwnedUpgrades().map((upgrade) => ({ ...upgrade })),
      upgradeChoice: this.choiceSnapshot(),
      hexes: this.hexRun.ownedIds,
      hexEffects: this.hexEffects.snapshot(),
      combatHexes: this.combatHexes.snapshot(),
      bomberHexes: this.bomberHexes.snapshot(),
      sorcererHexes: this.sorcererHexes.snapshot(),
      knightHexes: this.knightHexes.snapshot(),
      tacticianHexes: this.tacticianHexes.snapshot(
        this.muelsyse?.formRelayRemainingSeconds ?? 0,
      ),
      chest: this.chest
        ? {
            id: this.chest.chest.id,
            wave: this.chest.chest.wave,
            x: this.chest.chest.x,
            y: this.chest.chest.y,
            health: this.chest.chest.health.health,
            maxHealth: this.chest.chest.health.maxHealth,
            alive: this.chest.chest.isAlive,
            broken: this.chest.chest.isBroken,
          }
        : null,
      chestEligibleIds: [...this.brokenChestIds],
    };
  }

  /** 当前流形总数：主流形 + 远程副本；重开泄漏检查与性能场景共用。 */
  private manifoldCount(): number {
    const muelsyse = this.muelsyse;
    if (!muelsyse) return 0;
    return (muelsyse.isFormAlive ? 1 : 0) + muelsyse.copyCount;
  }

  /**
   * 开发诊断快照：实体数量与输入监听计数，供 `tools/perf/perf-check.mjs`
   * 做 60 秒性能测试与连续 5 次重开的泄漏基线比较。只读，不改变游戏状态。
   */
  getDevDiagnostics(): DevSceneDiagnostics | null {
    if (!this.devReady || !this.physics?.world || !this.children) return null;
    const keyboard = this.input.keyboard;
    const clock = this.time as unknown as {
      _active?: readonly unknown[];
      _pendingInsertion?: readonly unknown[];
    };
    let aliveEnemies = 0;
    for (const unit of this.enemySystem.enemies) {
      if (unit.combatant.isAlive) aliveEnemies += 1;
    }
    return {
      displayObjects: this.children.list.length,
      physicsBodies: this.physics.world.bodies.size,
      tweens: this.tweens.getTweens().length,
      timers:
        (clock._active?.length ?? 0) + (clock._pendingInsertion?.length ?? 0),
      activeScenes: this.game.scene.getScenes(true).length,
      settingsSubscribers: this.settingsStore.subscriberCount,
      inputListeners: {
        keydown: keyboard?.listenerCount('keydown') ?? 0,
        keyup: keyboard?.listenerCount('keyup') ?? 0,
        gameBlur: this.game.events.listenerCount(Phaser.Core.Events.BLUR),
        sceneShutdown: this.events.listenerCount(Phaser.Scenes.Events.SHUTDOWN),
      },
      aliveEnemies,
      enemyProjectiles: this.enemySystem.projectiles.length,
      manifolds: this.manifoldCount(),
    };
  }

  /** K 剩余冷却；阿米娅与维什戴尔共用同一读取口径。 */
  getSkillKCooldownRemaining(): number {
    return this.kCooldownRemaining();
  }

  /** L 剩余冷却；阿米娅奇美拉与维什戴尔爆裂黎明共用同一读取口径。 */
  getSkillLCooldownRemaining(): number {
    return this.lCooldownRemaining();
  }

  /** 奇美拉是否生效及其剩余秒数，供开发调试与浏览器验收。 */
  isChimeraActive(): boolean {
    return this.amiya?.isChimeraActive ?? false;
  }

  getChimeraRemaining(): number {
    return this.amiya?.chimeraRemaining ?? 0;
  }

  /** 奇美拉结束后的虚弱窗口；期间不能 K/L，移速 −25%。 */
  isAmiyaWeakened(): boolean {
    return this.amiya?.isWeaknessActive ?? false;
  }

  getWeaknessRemaining(): number {
    return this.amiya?.weaknessRemaining ?? 0;
  }

  /** 当前奇美拉虚弱带来的移速倍率（1 表示无虚弱）。 */
  getAmiyaMoveSpeedMultiplier(): number {
    return this.amiya?.moveSpeedMultiplier ?? 1;
  }

  isSpiritBurstActive(): boolean {
    return this.amiya?.isBurstActive ?? false;
  }

  getSpiritBurstShotsFired(): number {
    return this.amiya?.shotsFiredInBurst ?? 0;
  }

  getSpiritBurstShotsPerBurst(): number {
    return this.amiya?.totalShotsPerBurst ?? 0;
  }

  /** 精神爆发结束后的 J 疲劳剩余秒数；0 表示可正常攻击。 */
  getJFatigueRemaining(): number {
    return this.amiya?.fatigueRemaining ?? 0;
  }

  /** 情绪吸收当前进度（0–4）与累计命中次数。 */
  getEmotionalAbsorptionProgress(): number {
    return this.amiya?.emotionalAbsorptionProgress ?? 0;
  }

  getEmotionalAbsorptionHits(): number {
    return this.amiya?.emotionalAbsorptionHits ?? 0;
  }

  /** 魂灵、G07 脉冲或霜环造成的减速剩余秒数；非正数表示未被减速。 */
  getSlowRemaining(id: string): number {
    return Math.max(
      this.soul?.slowRemaining(id) ?? 0,
      this.buildEffects.slowRemaining(id),
      this.freeSkillSlows.remaining(id),
      this.muelsyse?.enemySlowRemaining(id) ?? 0,
    );
  }

  isEnemySlowed(id: string): boolean {
    return this.getSlowRemaining(id) > 0;
  }

  /** 玩家生命，供开发调试与浏览器验收。 */
  getPlayerHealth(): { health: number; maxHealth: number; isAlive: boolean } {
    return {
      health: this.playerHealth.health,
      maxHealth: this.playerHealth.maxHealth,
      isAlive: !this.playerHealth.isDead,
    };
  }

  /** 玩家当前护盾与剩余持续时间；塞雷娅 K 的浏览器验收读取这里。 */
  getPlayerShield(): number {
    return this.playerHealth.shield;
  }

  isSariaShieldActive(): boolean {
    return this.saria?.isShieldActive ?? false;
  }

  getSariaShieldRemaining(): number {
    return this.saria?.shieldRemaining ?? 0;
  }

  /** 精神回复实际触发次数；满血施放不增加。 */
  getSariaPassiveTriggerCount(): number {
    return this.saria?.passiveTriggerCount ?? 0;
  }

  /** 缪尔赛思主流形快照，供开发调试与浏览器验收。 */
  getMuelsyseForm(): string {
    return this.muelsyse?.form ?? '';
  }

  isMuelsyseFormAlive(): boolean {
    return this.muelsyse?.isFormAlive ?? false;
  }

  getMuelsyseFormHealth(): { health: number; maxHealth: number } {
    return {
      health: this.muelsyse?.formHealth ?? 0,
      maxHealth: this.muelsyse?.formMaxHealth ?? 0,
    };
  }

  getMuelsyseStacks(): number {
    return this.muelsyse?.formStacks ?? 0;
  }

  getMuelsyseCopyCount(): number {
    return this.muelsyse?.copyCount ?? 0;
  }

  /** 远程副本快照（id/位置/剩余寿命），供浏览器验收分裂与清理。 */
  getMuelsyseCopies(): readonly { id: string; x: number; y: number; remainingSeconds: number }[] {
    return this.muelsyse?.copies ?? [];
  }

  getMuelsyseLCooldownRemaining(): number {
    return this.muelsyse?.lCooldownRemaining ?? 0;
  }

  isMuelsyseShallowAdaptationActive(): boolean {
    return this.muelsyse?.isShallowAdaptationActive ?? false;
  }

  getMuelsyseShallowAdaptationRemaining(): number {
    return this.muelsyse?.shallowAdaptationRemaining ?? 0;
  }

  getMuelsyseFormPosition(): { x: number; y: number } {
    const position = this.muelsyse?.formPosition;
    return { x: position?.x ?? 0, y: position?.y ?? 0 };
  }

  /** 流形回到玩家身边的距离阈值（240），供浏览器验收跟随回位。 */
  getMuelsyseReturnDistance(): number {
    return MUELSYSE_RETURN_DISTANCE;
  }

  /** 仍在 0.8 秒出生提示中的敌人数，供浏览器验收生成约束。 */
  getEnemySpawnTelegraphCount(): number {
    return this.enemySystem.telegraphs.length;
  }

  getEnemyProjectileCount(): number {
    return this.enemySystem.projectiles.length;
  }

  /** 只读敌人快照，便于开发调试与浏览器验收；不暴露可变对象。 */
  getEnemySnapshot(): readonly {
    id: string;
    name: string;
    behavior: string;
    elite: boolean;
    x: number;
    y: number;
    health: number;
    maxHealth: number;
    shield: number;
    isAlive: boolean;
  }[] {
    return this.enemies.map((enemy) => ({
      id: enemy.unit.combatant.id,
      name: enemy.unit.enemy.name,
      behavior: enemy.unit.enemy.behavior,
      elite: enemy.unit.enemy.elite === true,
      x: enemy.unit.combatant.x,
      y: enemy.unit.combatant.y,
      health: enemy.unit.combatant.health.health,
      maxHealth: enemy.unit.combatant.health.maxHealth,
      shield: enemy.unit.combatant.health.shield,
      isAlive: enemy.unit.combatant.isAlive,
    }));
  }
}
