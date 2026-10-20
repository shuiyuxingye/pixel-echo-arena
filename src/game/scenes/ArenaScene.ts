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
  type ArenaLayout,
} from '../arena';
import {
  AttackTimer,
  Combatant,
  HealthState,
  TargetTracker,
  createProjectile,
  hudValue,
  projectileHitsTarget,
  registerProjectileHit,
  resolveProjectileHit,
  stepProjectile,
  type DamageResult,
  type ProjectileState,
} from '../combat';
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
  MUELSYSE_RETURN_DISTANCE,
  MuelsyseCombat,
  type MuelsyseAttackEvent,
} from '../muelsyse';
import {
  SARIA_PASSIVE_COOLDOWN_REDUCTION_SECONDS,
  S01_HEAL_DAMAGE_RATIO,
  S01_RADIUS,
  S02_DAMAGE_PER_SECOND,
  S03_DAMAGE,
  S03_INTERNAL_COOLDOWN_SECONDS,
  S03_RADIUS,
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
  getEnemy,
  getUpgrade,
  getWave,
  isCharacterId,
  type AttackDefinition,
  type CharacterDefinition,
  type CharacterId,
  type DamageType,
  type SkillDefinition,
  type UpgradeDefinition,
  type WaveDefinition,
} from '../data';
import {
  DEV_PERF_ENEMY_COUNT,
  DEV_PERF_ENEMY_PROJECTILE_COUNT,
  applyScenarioToWave,
  parseDevScenario,
  type DevScenario,
} from '../dev-scenario';
import type { DevSceneDiagnostics, DevStateSnapshot } from '../dev-snapshot';
import {
  ENEMY_WARNING,
  FRIENDLY_EFFECT_DEPTH,
  HIT_FEEDBACK,
  UPGRADE_FEEDBACK,
  characterEffectColors,
  planHitFeedback,
} from '../feedback';
import {
  HUD_FONT_PX,
  HUD_SKILL_BAR,
  applyHudEvent,
  buildHudModel,
  computeHudSkillBarLayout,
  computeHudViewport,
  createHudState,
  hudSkillIcon,
  type HudEvent,
  type HudModel,
  type HudSkillKey,
  type HudSkillState,
  type HudState,
} from '../hud';
import {
  BOSS_BLAST_WARNING_SECONDS,
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
  parseCheckpoint,
  restoredCombatStats,
  saveRunCheckpoint,
  type RunCheckpoint,
  type RunCheckpointDraft,
  type RunCheckpointKind,
  type RunSavedRewardStage,
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
  keyCodeLabel,
  type KeyBindings,
  type SettingsStore,
} from '../settings';
import { UPGRADE_LIST } from '../data/upgrades';
import {
  G06_DAMAGE_RATIO,
  UpgradeEffects,
  describeUpgradeEffect,
} from '../upgrade-effects';
import {
  CARDS_PER_HAND,
  RARITY_LABELS,
  UpgradeRun,
  type UpgradeChoice,
} from '../upgrade';
import { BurstSystem, burstHudText } from '../burst';
import {
  ENEMY_RADIUS,
  EnemySystem,
  SPAWN_TELEGRAPH_SECONDS,
  resolveEnemySpawnPoint,
  type EnemySpawnTelegraph,
  type EnemyUnit,
} from '../enemy';
import { GrenadeSystem, type AftershockResolution, type GrenadeDetonation } from '../grenade';
import { FixedStepLoop } from '../loop';
import {
  LEVEL_HEAL_AMOUNT,
  LEVEL_HEALTH_BONUS,
  ProgressionSystem,
  type ExperienceOrb,
} from '../progression';
import { WaveRewardFlow, WaveRunner } from '../wave';
import {
  RunStateMachine,
  WAVE_COUNTDOWN_SECONDS,
  applyIntermissionRecovery,
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
  type Facing,
} from '../movement';
import {
  PLAYER_ACTION_COLUMNS,
  PLAYER_ANIMATION_SETTINGS,
  PLAYER_DIRECTIONS,
  playerAnimationKey,
  playerCastFrameIndex,
  playerFrameIndex,
  type PlayerAction,
} from '../player-art';

const ENTER_CODES: readonly string[] = ['Enter', 'NumpadEnter'];

/** 强化卡片稀有度配色：边框/标题色与文字色。 */
const RARITY_COLORS: Readonly<Record<string, { readonly line: number; readonly text: string }>> = {
  silver: { line: 0xc0c6d4, text: '#d7dbe6' },
  gold: { line: 0xffc857, text: '#ffd98a' },
  prismatic: { line: 0xb388ff, text: '#d3b8ff' },
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


/** 四种普通敌人的场景配色，只用于区分行为，不影响规则。 */
const ENEMY_COLORS: Readonly<Record<string, number>> = {
  chase: 0xd0574a,
  shoot: 0xd9963f,
  charge: 0xc061cb,
  heavy: 0x708396,
  boss: 0x8f2b2b,
};

/** 普通波清空后进入下一波；第 9 波由 Boss 击败判定胜利。 */
const MAX_WAVE = 9;

/** 性能场景轮换使用的四类普通敌人（避开 Boss）。 */
const PERF_ENEMY_IDS = ['chaser', 'shooter', 'charger', 'heavy'] as const;

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
  return Math.floor(Math.random() * 0x100000000) >>> 0;
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
  readonly body: Phaser.GameObjects.Arc;
  /** 命中闪白后恢复用的行为配色。 */
  readonly baseColor: number;
  readonly shadow: Phaser.GameObjects.Ellipse;
  readonly hpBackground: Phaser.GameObjects.Rectangle;
  readonly hpFill: Phaser.GameObjects.Rectangle;
  /** 血条宽度；Boss 使用更宽的血条。 */
  readonly hpWidth: number;
  readonly nameText: Phaser.GameObjects.Text;
  readonly statusText: Phaser.GameObjects.Text;
  readonly windupRing: Phaser.GameObjects.Arc;
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

interface EnemyProjectileView {
  readonly id: number;
  readonly sprite: Phaser.GameObjects.Arc;
}

interface ProjectileView {
  readonly state: ProjectileState;
  readonly sprite: Phaser.GameObjects.Arc;
  /** J 普通攻击或 K 精神爆发弹；只有 J 命中计入情绪吸收。 */
  readonly source: 'J' | 'K';
}

interface UpgradeCardView {
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
  readonly nameText: Phaser.GameObjects.Text;
  readonly statusText: Phaser.GameObjects.Text;
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
  private formRing: Phaser.GameObjects.Arc | null = null;
  private formHpBackground: Phaser.GameObjects.Rectangle | null = null;
  private formHpFill: Phaser.GameObjects.Rectangle | null = null;
  private formLabel: Phaser.GameObjects.Text | null = null;
  private muelsyseLRing: Phaser.GameObjects.Arc | null = null;
  private muelsyseCopyViews = new Map<
    string,
    {
      readonly sprite: Phaser.GameObjects.Sprite;
      readonly ring: Phaser.GameObjects.Arc;
      readonly label: Phaser.GameObjects.Text;
    }
  >();
  private formCastSeconds = 0;
  private spiritBurstAttack: AttackDefinition | null = null;
  private enemySystem!: EnemySystem;
  private playerHealth!: HealthState;
  private progression!: ProgressionSystem;
  private upgradeRun!: UpgradeRun;
  private buildEffects!: UpgradeEffects;
  private upgradeChoice: UpgradeChoice | null = null;
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
  private skillBar!: Phaser.GameObjects.Container;
  private skillSlotViews: Record<HudSkillKey, HudBarSlotView> | null = null;
  private dodgeSlotView!: HudBarSlotView;
  /** 阿米娅 L 奇美拉 / 塞雷娅 L 钙质化的状态与剩余秒数。 */
  private chimeraHud!: Phaser.GameObjects.Text;
  /** 塞雷娅钙质化领域范围提示，跟随玩家位置。 */
  private calciumFieldVisual?: Phaser.GameObjects.Arc;
  private buildHud!: Phaser.GameObjects.Text;
  private targetRing!: Phaser.GameObjects.Ellipse;
  private enemies: EnemyView[] = [];
  private projectiles: ProjectileView[] = [];
  private nextProjectileId = 1;
  private jHeld = false;
  private killCount = 0;
  /** 本局对敌人实际造成的累计伤害；只统计结算成功的伤害。 */
  private damageDealt = 0;
  /** 本局成绩的唯一标识；同局结算去重只认它。 */
  private readonly resultRunId = createRunKey();
  private castPoseSeconds = 0;
  private castPoseFacing: Facing | null = null;
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
  private devInitialWaveDefinition: WaveDefinition | null = null;
  private devReady = false;
  /** 隔离性能场景：跳过波次流程，维持固定同屏实体数量。 */
  private perfScenario = false;
  private perfSpawnSerial = 0;
  private perfProjectileAngle = 0;

  constructor() {
    super(SCENE_KEYS.arena);
  }

  preload(): void {
    this.load.image(ASSET_KEYS.floor, ASSET_PATHS.floor);
    this.load.image(ASSET_KEYS.wall, ASSET_PATHS.wall);
    this.load.image(ASSET_KEYS.cover, ASSET_PATHS.cover);
    this.load.spritesheet(ASSET_KEYS.playerVishdal, ASSET_PATHS.playerVishdal, {
      frameWidth: PLAYER.frameWidth,
      frameHeight: PLAYER.frameHeight,
    });
    this.load.spritesheet(ASSET_KEYS.playerAmiya, ASSET_PATHS.playerAmiya, {
      frameWidth: PLAYER.frameWidth,
      frameHeight: PLAYER.frameHeight,
    });
    this.load.spritesheet(ASSET_KEYS.playerSaria, ASSET_PATHS.playerSaria, {
      frameWidth: PLAYER.frameWidth,
      frameHeight: PLAYER.frameHeight,
    });
    this.load.spritesheet(ASSET_KEYS.playerMuelsyse, ASSET_PATHS.playerMuelsyse, {
      frameWidth: PLAYER.frameWidth,
      frameHeight: PLAYER.frameHeight,
    });
  }

  create(): void {
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
      const scenario = parseDevScenario(location.search);
      if (scenario) {
        this.devScenario = scenario;
        this.perfScenario = scenario.perf;
        this.devInitialWaveDefinition = scenario.enemies
          ? applyScenarioToWave(getWave(scenario.wave ?? 1), scenario.enemies)
          : null;
      }
    }

    this.character = getCharacter(
      this.readCheckpoint()?.characterId ?? resolvePlayableCharacterId(this.registry),
    );
    this.createPlayerAnimations(this.character.id);
    this.hudState = createHudState(this.character.id);

    this.attackTimer = new AttackTimer(this.character.attack.intervalSeconds);
    this.targetTracker = new TargetTracker(this.character.attack.range);
    this.playerHealth = new HealthState({
      maxHealth: this.character.maxHealth,
      armor: this.character.armor,
      magicResist: this.character.magicResist,
    });
    this.enemySystem = new EnemySystem({ layout: this.layout });
    this.progression = new ProgressionSystem();
    // 本局强化抽取使用独立种子序列；开发环境可用 ?seed= 固定种子复现。
    this.upgradeRun = new UpgradeRun({
      characterId: this.character.id,
      pool: UPGRADE_LIST,
      seed: this.devScenario?.seed ?? resolveRunSeed(),
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
      this.upgradeRun.restore({
        stacks: checkpoint.upgrades,
        rerollsRemaining: checkpoint.rerollsRemaining,
        randomState: checkpoint.randomState,
      });
      this.playerHealth.restoreHealth(
        checkpoint.health.current,
        checkpoint.health.max,
      );
      this.playerHealth.setShield(checkpoint.health.shield ?? 0);
      // 击杀与累计伤害从快照继续累计；旧存档缺字段时由纯函数按 0 起步。
      const combatStats = restoredCombatStats(checkpoint);
      this.killCount = combatStats.kills;
      this.damageDealt = combatStats.damageDealt;
      // 快照里的生命已包含升级成长；避免 restore 后再发一次升级奖励。
      this.appliedLevel = this.progression.level;
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
    this.playerShadow = this.add
      .ellipse(spawn.x, spawn.y - PLAYER.bodyCenterOffsetY + 2, 30, 12, 0x000000, 0.4)
      .setDepth(3);

    this.player = this.physics.add
      .sprite(
        spawn.x,
        spawn.y - PLAYER.bodyCenterOffsetY,
        this.playerAssetKey(),
        playerFrameIndex(initialDirection, 'idle'),
      )
      .setOrigin(PLAYER.originX, PLAYER.originY)
      .setDepth(4);
    this.player.play(playerAnimationKey(initialDirection, 'idle', this.character.id));

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCircle(PLAYER.radius, PLAYER.bodyOffsetX, PLAYER.bodyOffsetY);

    this.targetRing = this.add
      .ellipse(0, 0, ENEMY_RADIUS * 2 + 14, ENEMY_RADIUS * 2 + 14, 0x000000, 0)
      .setStrokeStyle(2, 0xffd166, 0.95)
      .setDepth(5)
      .setVisible(false);

    // HUD 顶部左侧：目标 → 生命/护盾 → 波次/等级/经验/击杀 → 闪避 → 角色资源 → 技能详情。
    this.targetHud = this.add
      .text(16, 12, '目标 无', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.body}px`,
        color: '#ffe9a8',
        stroke: '#181018',
        strokeThickness: 4,
      })
      .setScrollFactor(0)
      .setDepth(50);

    this.healthHud = this.add
      .text(16, 36, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.body}px`,
        color: '#ff8a8a',
        stroke: '#181018',
        strokeThickness: 4,
      })
      .setScrollFactor(0)
      .setDepth(50);

    this.waveHud = this.add
      .text(16, 60, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.body}px`,
        color: '#9be7a4',
        stroke: '#181018',
        strokeThickness: 4,
      })
      .setScrollFactor(0)
      .setDepth(50);

    this.killHud = this.add
      .text(16, 86, '击杀 0', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.small}px`,
        color: '#f4ead2',
        stroke: '#181018',
        strokeThickness: 4,
      })
      .setScrollFactor(0)
      .setDepth(50);

    this.dodgeHud = this.add
      .text(16, 110, '闪避 就绪', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.small}px`,
        color: '#cfe8ff',
        stroke: '#181018',
        strokeThickness: 4,
      })
      .setScrollFactor(0)
      .setDepth(50);

    this.ammoHud = this.add
      .text(16, 134, '', {
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
      .text(16, 158, '', {
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
      .text(16, 182, '', {
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
      .text(VIEWPORT.width - 16, 14, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.small}px`,
        color: '#cfc4b6',
        stroke: '#181018',
        strokeThickness: 3,
        align: 'right',
        lineSpacing: 4,
        wordWrap: { width: 300, useAdvancedWrap: true },
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(50);
    this.updateBuildHud();

    this.controlsHint = this.add
      .text(16, 206, '', {
        fontFamily: 'monospace',
        fontSize: `${HUD_FONT_PX.small}px`,
        color: '#cfc4b6',
        stroke: '#181018',
        strokeThickness: 3,
        wordWrap: { width: 560, useAdvancedWrap: true },
      })
      .setScrollFactor(0)
      .setDepth(50);
    this.updateControlsHint(this.settingsStore.get().keyBindings);

    // 底部技能条：J/K/L 图标、技能名、冷却秒数与闪避；图标与文字都固定在安全区内。
    this.skillBar = this.add.container(0, 0).setScrollFactor(0).setDepth(50);
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
      .text(VIEWPORT.width / 2, 38, '', {
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
        align: 'center',
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

    this.runState = new RunStateMachine();
    this.runState.enterCharacterSelect();
    if (checkpoint) {
      this.startRestoredRun(checkpoint);
    } else if (this.perfScenario) {
      this.startPerfScenario();
    } else {
      this.startWave(this.devScenario?.wave ?? 1);
    }
    this.restoringCheckpoint = false;

    this.logicLoop = new FixedStepLoop({
      onStep: (stepSeconds) => {
        const wasDodging = this.motion.isDodging;
        this.motion.step(stepSeconds);
        // 闪避结束的这一逻辑步在终点结算 G07 脉冲。
        if (wasDodging && !this.motion.isDodging) this.triggerDodgePulse();
        this.buildEffects.step(stepSeconds);
        this.simulatedSeconds += stepSeconds;
        // 性能场景在伤害结算前补满生命与同屏数量，保证 60 秒内负载稳定。
        if (this.perfScenario) this.maintainPerfScenario();
        this.updateCombat(stepSeconds);
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

    const position = this.muelsyse.formPosition;
    this.formShadow = this.add
      .ellipse(position.x, position.y + 10, 28, 10, 0x000000, 0.3)
      .setDepth(3);
    this.formRing = this.add
      .circle(position.x, position.y, 21, 0x5fd8d0, 0.08)
      .setStrokeStyle(1.5, 0x9df2dd, 0.55)
      .setDepth(4);
    this.formSprite = this.add
      .sprite(
        position.x,
        position.y - PLAYER.bodyCenterOffsetY,
        ASSET_KEYS.playerMuelsyse,
        playerFrameIndex('down', 'idle'),
      )
      .setOrigin(PLAYER.originX, PLAYER.originY)
      .setScale(0.9)
      .setTint(0x9df2dd)
      .setAlpha(0.84)
      .setDepth(5);
    this.formHpBackground = this.add
      .rectangle(position.x - 22, position.y - 52, 44, 6, 0x181018, 0.8)
      .setOrigin(0, 0)
      .setDepth(6);
    this.formHpFill = this.add
      .rectangle(position.x - 22, position.y - 52, 44, 6, 0x5fd8d0, 0.95)
      .setOrigin(0, 0)
      .setDepth(7);
    this.formLabel = this.add
      .text(position.x, position.y - 64, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#9df2dd',
        stroke: '#16211f',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(7);
    // 近战 L 的拉拽范围提示；只在生效期间显示并跟随主流形。
    this.muelsyseLRing = this.add
      .circle(
        position.x,
        position.y,
        requireSkillParam(skillL, 'pullRadius'),
        0x5fd8d0,
        0.05,
      )
      .setStrokeStyle(1.5, 0x9df2dd, 0.4)
      .setDepth(4)
      .setVisible(false);
    this.syncMuelsyseForm();
  }

  /**
   * 起始波可用开发场景的敌人组合覆盖；后续波仍按正常波次数据。
   * 覆盖定义里保留波次号，因此只在同一波号时命中。
   */
  private waveDefinitionFor(wave: number): WaveDefinition {
    if (this.devInitialWaveDefinition?.wave === wave) return this.devInitialWaveDefinition;
    return getWave(wave);
  }

  /** 应用壳只写入已校验的快照；这里再解析一次，避免损坏值进入场景。 */
  private readCheckpoint(): RunCheckpoint | null {
    const parsed = parseCheckpoint(this.registry.get(RUN_CHECKPOINT_REGISTRY_KEY));
    return parsed.status === 'ok' ? parsed.checkpoint : null;
  }

  /** 从续局快照恢复：先还原逻辑状态，再按检查点类型重建奖励界面。 */
  private startRestoredRun(checkpoint: RunCheckpoint): void {
    this.waveNumber = checkpoint.wave;
    const stage = checkpoint.rewardStage;
    const world = checkpoint.world;

    if (world && stage === 'none') {
      // 波中升级检查点：按快照重建世界状态，不从本波开头重来。
      this.restoreWorldState(world, checkpoint);
    } else if (stage === 'upgrade' || stage === 'mechanic') {
      // 波末奖励：不新建 WaveRunner，不重放吸取与补给。
      this.rewardFlow = new WaveRewardFlow(checkpoint.wave);
      this.rewardFlow.restore(stage, checkpoint.rewardPendingLevelUps);
      this.runState.restoreUpgrade();
      this.restoreRewardUi(checkpoint);
    } else if (stage === 'intermission') {
      this.rewardFlow = new WaveRewardFlow(checkpoint.wave);
      this.rewardFlow.restore('intermission', checkpoint.rewardPendingLevelUps);
      this.runState.restoreIntermission();
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
    };
    // 恢复后的弹体沿用当前角色主色，与发射路径保持一致；不影响任何伤害结算。
    const colors = characterEffectColors(this.character.id);
    const sprite = this.add
      .circle(state.x, state.y, state.radius, colors.projectileFill)
      .setStrokeStyle(1.5, colors.projectileStroke)
      .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
    this.projectiles.push({ state, sprite, source: saved.source });
  }

  /** 恢复待选手牌或“已无可选强化”提示；不调用抽卡，因此不会重抽。 */
  private restoreRewardUi(checkpoint: RunCheckpoint): void {
    if (checkpoint.hand && checkpoint.handKind) {
      const choice = this.upgradeRun.createChoice(checkpoint.handKind, {
        hand: checkpoint.hand,
        focusIndex: checkpoint.focusIndex,
      });
      this.upgradeChoice = choice.hand.length > 0 ? choice : null;
    }

    if (this.upgradeChoice) {
      this.rewardOverlay?.setVisible(false);
      this.renderUpgradePanel();
      return;
    }

    this.hideUpgradePanel();
    if (checkpoint.rewardStage === 'mechanic') {
      this.rewardOverlay
        ?.setText(`第 ${this.waveNumber} 波机制强化\n已无可用卡，按 Enter 继续`)
        .setVisible(true);
      return;
    }
    if (checkpoint.rewardStage === 'upgrade' || checkpoint.pendingLevelUps > 0) {
      this.rewardOverlay
        ?.setText('升级！\n已无可选强化，按 Enter 继续')
        .setVisible(true);
      return;
    }
    if (checkpoint.rewardStage === 'intermission') {
      this.rewardOverlay?.setText(this.intermissionSummaryText()).setVisible(true);
      return;
    }
    this.rewardOverlay?.setVisible(false);
  }

  /** 收集当前可序列化逻辑状态；事件快照与测试断言共用同一口径。 */
  private collectCheckpointDraft(kind: RunCheckpointKind): RunCheckpointDraft {
    const flowStage = this.rewardFlow?.stage ?? 'none';
    const rewardStage: RunSavedRewardStage =
      flowStage === 'upgrade' || flowStage === 'mechanic' || flowStage === 'intermission'
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
      rerollsRemaining: this.upgradeRun.rerollsRemaining,
      randomState: this.upgradeRun.randomState,
      hand: this.upgradeChoice?.hand.map((card) => card.id) ?? null,
      handKind: this.upgradeChoice?.kind ?? null,
      focusIndex: this.upgradeChoice?.focusIndex ?? 0,
      rewardStage,
      rewardPendingLevelUps: this.rewardFlow?.pendingLevelUps ?? 0,
      kills: this.killCount,
      damageDealt: this.damageDealt,
      // 只有波中升级检查点需要世界状态；波初仍从本波开头重建。
      world:
        kind !== 'wave-start' && kind !== 'intermission'
          ? this.collectWorldSnapshot()
          : null,
    };
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
      projectiles: this.projectiles.map(({ state, source }) => ({
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
        getEnemy(PERF_ENEMY_IDS[index % PERF_ENEMY_IDS.length] ?? 'chaser'),
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
        getEnemy(PERF_ENEMY_IDS[index % PERF_ENEMY_IDS.length] ?? 'chaser'),
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
    this.waveRunner = new WaveRunner(this.waveDefinitionFor(wave));
    this.rewardFlow = null;
    this.waveClearHandled = false;
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
    const result = runner.step(stepSeconds, { aliveEnemyCount, pendingEnemyCount });

    for (const request of result.spawned) {
      const telegraph = this.enemySystem.queueSpawn(
        request.enemy,
        this.motion.position,
        request.spawnIndex,
      );
      this.createSpawnTelegraph(telegraph);
    }

    if (result.cleared) this.beginWaveClear();
  }

  /** 波清空：自动吸取经验，再按“升级 → 机制 → 波间补给”顺序冻结处理。 */
  private beginWaveClear(): void {
    if (this.waveClearHandled) return;
    this.waveClearHandled = true;
    this.waveRunner = null;
    this.jHeld = false;
    this.motion.clearKeys();
    this.logicLoop?.reset();

    if (!this.playerHealth.isDead) {
      // 波末自动吸取剩余经验球，产生的升级进入同一队列。
      this.progression.collectAll().orbs.forEach((orb) => this.removeXpOrb(orb.id));
      this.syncLevelHealth();
    }

    this.rewardFlow = new WaveRewardFlow(this.waveNumber);
    this.rewardFlow.begin(this.progression.pendingLevelUps);
    this.rewardFlow.completeAbsorb(this.progression.pendingLevelUps);
    this.syncRewardPhase();
    this.updateWaveHud();
    this.refreshRewardOverlay();
  }

  /** 把奖励流转的阶段同步到局状态机；机制三选一同样使用 upgrade 阶段。 */
  private syncRewardPhase(): void {
    const stage = this.rewardFlow?.stage ?? 'none';
    if (stage === 'upgrade' || stage === 'mechanic') {
      this.runState.beginUpgrade();
    } else if (stage === 'intermission') {
      this.enterIntermission();
    } else if (this.rewardFlow === null && this.progression.pendingLevelUps === 0) {
      // 波中升级全部选完：没有波末奖励流转时立即回到战斗。
      this.runState.returnToCombat();
    }
  }

  /**
   * 进入波间补给：回复最大生命 15%，死亡角色不复活。
   * 同一次波间只结算一次，重复调用不会重复回血。
   */
  private enterIntermission(): void {
    if (this.runState.phase === 'intermission') return;
    if (this.runState.beginIntermission() !== 'intermission') return;

    const healed = applyIntermissionRecovery(this.playerHealth);
    if (healed > 0) {
      this.showSkillLabel(`波间补给 · 生命 +${Math.ceil(healed)}`);
    }
    this.syncHealthHud();
    // 补给结算后才写快照：刷新不会重复回血。
    this.saveCheckpoint('intermission');
  }

  /** 奖励期间冻结战斗：方向键/1–3 移动焦点，Enter 只确认一次，R 重抽；Esc 不跳过。 */
  private handleRewardKey(event: KeyboardEvent): void {
    const code = event.code;
    if (REWARD_PREVENT_DEFAULT_CODES.includes(code)) {
      event.preventDefault();
    }

    const choice = this.upgradeChoice;
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
        if (!event.repeat && choice.reroll()) {
          this.renderUpgradePanel();
          // 重抽完成后保存新手牌与剩余次数，刷新不会重抽或换回旧牌。
          this.saveCheckpoint('reroll');
        }
        return;
      }
    }

    // Enter 按住产生的 repeat 事件不再确认，避免一次按键选两张。
    if (ENTER_CODES.includes(code) && !event.repeat) {
      this.confirmRewardStep();
    }
  }

  /** 确认当前焦点卡；升级按队列逐个消费，机制选择完成后进入波间。 */
  private confirmRewardStep(): void {
    if (this.playerHealth.isDead) return;

    const choice = this.upgradeChoice;
    if (choice) {
      const card = choice.confirm();
      if (!card) return;

      // 层数已由 UpgradeChoice 写入 UpgradeRun；这里立即结算即时效果与倍率。
      this.applyAcquiredUpgrade(card);

      if (choice.kind === 'upgrade') {
        this.progression.consumeLevelUp();
        if (this.rewardFlow?.stage === 'upgrade') this.rewardFlow.completeUpgrade();
        this.showSkillLabel(`升级 · ${card.name}`);
      } else {
        this.rewardFlow?.completeMechanic();
        this.showSkillLabel(`机制 · ${card.name}`);
      }

      this.upgradeChoice = null;
      this.syncRewardPhase();
      this.refreshRewardOverlay();
      // 选卡完成（含自动进入下一阶段）后保存：刷新不会重新发同一奖励。
      this.saveCheckpoint('card-selected');
      return;
    }

    // 池中已无可用卡时不允许卡死：升级直接消费，机制阶段直接结束。
    if (this.progression.pendingLevelUps > 0) {
      this.progression.consumeLevelUp();
      if (this.rewardFlow?.stage === 'upgrade') this.rewardFlow.completeUpgrade();
      this.syncRewardPhase();
      this.refreshRewardOverlay();
      this.saveCheckpoint('card-selected');
      return;
    }
    if (this.rewardFlow?.stage === 'mechanic') {
      this.rewardFlow.completeMechanic();
      this.syncRewardPhase();
      this.refreshRewardOverlay();
      this.saveCheckpoint('card-selected');
      return;
    }
    if (this.rewardFlow?.stage === 'upgrade') {
      // 防御：快照恢复到升级阶段但队列已空时，仍可进入机制/波间，避免卡死。
      this.rewardFlow.completeUpgrade();
      this.syncRewardPhase();
      this.refreshRewardOverlay();
      this.saveCheckpoint('card-selected');
      return;
    }
    if (this.rewardFlow?.stage === 'intermission') {
      this.advanceToNextWave();
    }
  }

  private advanceToNextWave(): void {
    const flow = this.rewardFlow;
    if (!flow || flow.stage !== 'intermission') return;
    flow.completeIntermission();
    this.rewardFlow = null;

    // 第 8 波之后进入第 9 波 Boss；Boss 波不再返回波间。
    if (this.waveNumber >= MAX_WAVE) return;
    this.startWave(this.waveNumber + 1);
  }

  /** 战斗冻结条件：有排队升级或波末奖励阶段尚未处理完。 */
  private isRewardActive(): boolean {
    return (
      this.progression.pendingLevelUps > 0 ||
      this.runState.isRewardPhase ||
      (this.rewardFlow?.isActive ?? false)
    );
  }

  /** 按当前阶段创建对应手牌；阶段切换或阶段结束时丢弃旧面板。 */
  private syncRewardChoice(): void {
    const upgradeStage =
      this.progression.pendingLevelUps > 0 || this.rewardFlow?.stage === 'upgrade';
    const mechanicStage = this.rewardFlow?.stage === 'mechanic';

    if (!upgradeStage && !mechanicStage) {
      this.upgradeChoice = null;
      return;
    }

    const kind = upgradeStage ? 'upgrade' : 'mechanic';
    if (!this.upgradeChoice || this.upgradeChoice.kind !== kind) {
      const choice = this.upgradeRun.createChoice(kind);
      this.upgradeChoice = choice.hand.length > 0 ? choice : null;
      // 生成强化选项即保存：刷新后仍看到同一手牌，不重抽也不重复升级。
      this.saveCheckpoint('upgrade-options');
    }
  }

  private refreshRewardOverlay(): void {
    if (this.playerHealth.isDead) {
      this.upgradeChoice = null;
      this.hideUpgradePanel();
      this.rewardOverlay.setVisible(false);
      return;
    }

    this.syncRewardChoice();
    if (this.upgradeChoice) {
      // 波中升级同样进入 upgrade 阶段；确认完后由 syncRewardPhase 回到 combat。
      if (this.upgradeChoice.kind === 'upgrade') this.runState.beginUpgrade();
      this.renderUpgradePanel();
      this.rewardOverlay.setVisible(false);
      return;
    }

    this.hideUpgradePanel();

    if (this.progression.pendingLevelUps > 0) {
      this.rewardOverlay
        .setText(`升级！\n已无可选强化，按 Enter 继续`)
        .setVisible(true);
      return;
    }

    if (this.rewardFlow?.stage === 'mechanic') {
      this.rewardOverlay
        .setText(`第 ${this.waveNumber} 波机制强化\n已无可用卡，按 Enter 继续`)
        .setVisible(true);
      return;
    }

    if (this.rewardFlow?.stage === 'intermission') {
      this.rewardOverlay.setText(this.intermissionSummaryText()).setVisible(true);
      return;
    }

    this.rewardOverlay.setVisible(false);
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
    return formatIntermissionSummary({
      wave: this.waveNumber,
      health: this.playerHealth.health,
      maxHealth: this.playerHealth.maxHealth,
      upgrades,
    });
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
    const cardHeight = 288;
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
        centerY - cardHeight / 2 + 32,
        '',
        {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#f4ead2',
          lineSpacing: 7,
          wordWrap: { width: cardWidth - 32, useAdvancedWrap: true },
        },
      );
      container.add([background, accent, text]);
      this.upgradeCardViews.push({ background, accent, text });
    }

    this.upgradePanel = container;
    this.upgradePanelTitle = title;
    this.upgradePanelHint = hint;
  }

  private renderUpgradePanel(): void {
    const choice = this.upgradeChoice;
    if (!choice) {
      this.hideUpgradePanel();
      return;
    }

    const title =
      choice.kind === 'mechanic'
        ? `第 ${this.waveNumber} 波 · 机制强化`
        : this.progression.pendingLevelUps > 1
          ? `升级 · 三选一（剩余 ${this.progression.pendingLevelUps} 次选择）`
          : '升级 · 三选一';
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
      view.text.setColor(rarity?.text ?? '#f4ead2');
    }

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

  private hideUpgradePanel(): void {
    this.upgradePanel?.setVisible(false);
  }

  /** 升级带来的最大生命 +5 与回复 5 在获得经验时立即结算。 */
  private syncLevelHealth(): void {
    const level = this.progression.level;
    if (level <= this.appliedLevel || this.playerHealth.isDead) return;
    const gainedLevels = level - this.appliedLevel;
    this.appliedLevel = level;
    this.playerHealth.increaseMaxHealth(
      gainedLevels * LEVEL_HEALTH_BONUS,
      gainedLevels * LEVEL_HEAL_AMOUNT,
    );
    this.syncHealthHud();
  }

  /** 选卡确认后立即生效：G04 提高上限并回复，其余倍率同步到各系统。 */
  private applyAcquiredUpgrade(card: UpgradeDefinition): void {
    const effect = this.buildEffects.onAcquire(card.id);
    if (effect.maxHealthBonus > 0) {
      this.playerHealth.increaseMaxHealth(effect.maxHealthBonus, effect.heal);
      this.syncHealthHud();
    }
    this.syncBuildModifiers();
    this.updateBuildHud();
    // 强化变化必须可见可听：金色脉冲 + 固定音效，与普通技能启动区分。
    this.showUpgradePulse();
    this.playSfx(COMBAT_SFX.upgrade);
  }

  /** 把 G01/G02/G03 与维什戴尔 W01–W04 的实效推给实际结算系统。 */
  private syncBuildModifiers(): void {
    this.grenade?.setDamageMultiplier(this.buildEffects.damageMultiplier);
    // W01 追加余震与 W02 标记扩散只在拥有对应卡时开启。
    this.grenade?.setSecondAftershock(this.upgradeRun.stacksOf('W01') > 0);
    this.grenade?.setMarkSpread(this.upgradeRun.stacksOf('W02') > 0);
    this.soul?.setCooldownMultiplier(this.buildEffects.cooldownMultiplier);
    if (this.soul) {
      const baseMaxSummons = requireSkillParam(this.character.skillK, 'maxSummons');
      this.soul.setMaxSummons(
        this.upgradeRun.stacksOf('W03') > 0 ? W03_MAX_SUMMONS : baseMaxSummons,
      );
    }
    this.burst?.setCooldownMultiplier(this.buildEffects.cooldownMultiplier);
    this.burst?.setAmmoUpgrade(this.upgradeRun.stacksOf('W04') > 0);
    this.amiya?.setCooldownMultiplier(this.buildEffects.cooldownMultiplier);
    // A02 情绪吸收阈值、A03 延迟追加连射、A04 奇美拉时长与虚弱减速。
    this.amiya?.setEmotionalAbsorptionHits(
      this.upgradeRun?.stacksOf('A02')
        ? A02_HITS_PER_TRIGGER
        : EMOTIONAL_ABSORPTION_HITS,
    );
    this.amiya?.setDoubleCast((this.upgradeRun?.stacksOf('A03') ?? 0) > 0);
    this.amiya?.setChimeraDuration(
      (this.upgradeRun?.stacksOf('A04') ?? 0) > 0
        ? A04_CHIMERA_DURATION_SECONDS
        : null,
    );
    this.amiya?.setWeaknessSlowRemoved(
      (this.upgradeRun?.stacksOf('A04') ?? 0) > 0 && A04_WEAKNESS_SLOW_REMOVED,
    );
    this.saria?.setCooldownMultiplier(this.buildEffects.cooldownMultiplier);
    // S01–S04 的开关与数值全部从卡片 params 读取，满层/未拥有时回到基础规则。
    const sariaS01 = (this.upgradeRun?.stacksOf('S01') ?? 0) > 0;
    const sariaS02 = (this.upgradeRun?.stacksOf('S02') ?? 0) > 0;
    const sariaS03 = (this.upgradeRun?.stacksOf('S03') ?? 0) > 0;
    const sariaS04 = (this.upgradeRun?.stacksOf('S04') ?? 0) > 0;
    this.saria?.setHealShock(sariaS01 ? S01_HEAL_DAMAGE_RATIO : 0, S01_RADIUS);
    this.saria?.setFieldDamagePerSecond(sariaS02 ? S02_DAMAGE_PER_SECOND : 0);
    this.saria?.setShieldCounter(sariaS03, S03_RADIUS, S03_DAMAGE, S03_INTERNAL_COOLDOWN_SECONDS);
    this.saria?.setPassiveCooldownReduction(
      sariaS04
        ? S04_PASSIVE_COOLDOWN_REDUCTION_SECONDS
        : SARIA_PASSIVE_COOLDOWN_REDUCTION_SECONDS,
    );
    this.saria?.setFieldHealChain(
      sariaS04 ? S04_HEALS_PER_TRIGGER : 0,
      S04_COOLDOWN_REDUCTION_SECONDS,
    );
    this.muelsyse?.setCooldownMultiplier(this.buildEffects.cooldownMultiplier);
    // M01–M04：上限、回复、L 范围/束缚与 J 补攻全部从卡片 params 读取。
    const muelsyseM01 = (this.upgradeRun?.stacksOf('M01') ?? 0) > 0;
    const muelsyseM02 = (this.upgradeRun?.stacksOf('M02') ?? 0) > 0;
    const muelsyseM03 = (this.upgradeRun?.stacksOf('M03') ?? 0) > 0;
    const muelsyseM04 = (this.upgradeRun?.stacksOf('M04') ?? 0) > 0;
    this.muelsyse?.setDualForm(
      muelsyseM01 ? M01_RANGED_MAX_COPIES : null,
      muelsyseM01 ? M01_MELEE_MAX_STACKS : null,
    );
    this.muelsyse?.setEcologicalRecovery(
      muelsyseM02 ? M02_HEAL_PERCENT_PER_SECOND : 0,
      muelsyseM02 ? M02_HEAL_ON_ACTIVATE_PERCENT : 0,
    );
    this.muelsyse?.setAggregationVortex(
      muelsyseM03 ? M03_PULL_RANGE_BONUS : 0,
      muelsyseM03 ? M03_ROOT_BONUS_SECONDS : 0,
    );
    this.muelsyse?.setWaterMirrorEcho(
      muelsyseM04 ? M04_DAMAGE_RATIO : 0,
      muelsyseM04 ? M04_INTERNAL_COOLDOWN_SECONDS : 0,
    );
    this.syncMoveSpeed();
  }

  /** G02 移速与奇美拉虚弱的 −25% 共用同一个运动倍率入口。 */
  private syncMoveSpeed(): void {
    this.motion.setMoveSpeedMultiplier(
      this.buildEffects.moveSpeedMultiplier * (this.amiya?.moveSpeedMultiplier ?? 1),
    );
  }

  /** 构筑面板：已获得强化的层数与实效，数值与战斗结算同源。 */
  private updateBuildHud(): void {
    if (!this.buildHud || !this.upgradeRun) return;
    const owned = this.upgradeRun.ownedIds();
    if (owned.length === 0) {
      this.buildHud.setText('构筑\n暂无强化');
      return;
    }

    const lines = [`构筑（${owned.length}）`];
    for (const id of owned) {
      const card = UPGRADE_LIST.find((entry) => entry.id === id);
      if (!card) continue;
      const stacks = this.upgradeRun.stacksOf(id);
      lines.push(`${card.id} ${card.name} ×${stacks} · ${describeUpgradeEffect(id, stacks)}`);
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
    this.waveHud.setText(`${model.lines.wave} · ${model.lines.progress}`);
    this.killHud.setText(model.lines.kills);
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
  }

  private createHudBarSlot(
    rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
    badgeLabel: string,
    shape: Parameters<ArenaScene['drawHudIcon']>[1],
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
    this.drawHudIcon(icon, shape, rect.x + 50, rect.y + 22, color);
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
      nameText,
      statusText,
      cooldownTrack,
      cooldownFill,
    };
  }

  /** 小型几何图标；不用 Emoji 或字母图代替技能辨识。 */
  private drawHudIcon(
    graphics: Phaser.GameObjects.Graphics,
    shape: ReturnType<typeof hudSkillIcon>['shape'],
    cx: number,
    cy: number,
    color: number,
  ): void {
    graphics.clear();
    graphics.fillStyle(color, 0.95).lineStyle(2, color, 0.95);
    switch (shape) {
      case 'shell':
        graphics.fillCircle(cx, cy, 7);
        graphics.lineStyle(2, 0x181018, 0.75).strokeCircle(cx, cy, 3);
        break;
      case 'bolt':
        graphics.fillTriangle(cx - 6, cy + 7, cx + 1, cy - 8, cx + 6, cy + 5);
        break;
      case 'spark':
        graphics.fillTriangle(cx, cy - 8, cx + 7, cy, cx, cy + 8);
        graphics.fillTriangle(cx, cy - 8, cx - 7, cy, cx, cy + 8);
        break;
      case 'orb':
        graphics.fillCircle(cx, cy, 6);
        graphics.lineStyle(2, 0x181018, 0.7).strokeCircle(cx, cy, 2.5);
        break;
      case 'shield':
        graphics.fillRect(cx - 6, cy - 7, 12, 9);
        graphics.fillTriangle(cx - 6, cy + 2, cx + 6, cy + 2, cx, cy + 8);
        break;
      case 'wave':
        graphics.lineStyle(2, color, 0.95);
        graphics.lineBetween(cx - 7, cy - 4, cx + 7, cy - 4);
        graphics.lineBetween(cx - 5, cy, cx + 5, cy);
        graphics.lineBetween(cx - 7, cy + 4, cx + 7, cy + 4);
        break;
      case 'field':
        graphics.fillCircle(cx, cy, 2.5);
        graphics.lineStyle(2, color, 0.95).strokeCircle(cx, cy, 6);
        break;
      case 'drop':
        graphics.fillCircle(cx, cy - 2, 5);
        graphics.fillTriangle(cx - 4, cy + 1, cx + 4, cy + 1, cx, cy + 8);
        break;
    }
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
      cooldownTotal: DODGE.cooldownSeconds,
    });
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
      effectRemaining: fatigued ? (this.amiya?.fatigueRemaining ?? 0) : 0,
      detail: fatigued ? '疲劳' : '',
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
    });
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
    const color = ENEMY_COLORS[unit.enemy.behavior] ?? 0xd0574a;
    const label = unit.enemy.name;
    const shadow = this.add
      .ellipse(x, y + unit.radius - 2, isBoss ? 64 : 26, isBoss ? 20 : 9, 0x000000, 0.35)
      .setDepth(3);
    const body = this.add
      .circle(x, y, unit.radius, color)
      .setStrokeStyle(isBoss ? 4 : 2, isBoss ? ENEMY_WARNING.stroke : 0x241a22)
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
    const windupRing = this.add
      .circle(x, y, unit.radius + 16, ENEMY_WARNING.fill, 0.12)
      .setStrokeStyle(2, ENEMY_WARNING.stroke, 0.9)
      .setDepth(ENEMY_WARNING.depth)
      .setVisible(false);

    this.enemies.push({
      unit,
      label,
      body,
      baseColor: color,
      shadow,
      hpBackground,
      hpFill,
      hpWidth,
      nameText,
      statusText,
      windupRing,
    });
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
        const result = this.playerHealth.applyDamage(rawDamage, damageType);
        this.handleSariaShieldAbsorb(result);
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
    // 二阶段召唤：走与波次相同的 0.8 秒出生提示，不直接凭空落地。
    for (const request of result.bossSummonRequests) {
      for (let index = 0; index < request.count; index += 1) {
        const telegraph = this.enemySystem.queueSpawn(
          getEnemy(request.enemyId),
          this.motion.position,
          index,
        );
        this.createSpawnTelegraph(telegraph);
      }
    }

    this.syncBossBlastWarnings();
    this.syncEnemyProjectiles();
    this.syncEnemies();
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
          duration: BOSS_BLAST_WARNING_SECONDS * 1000,
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
  private syncEnemies(): void {
    for (const view of this.enemies) {
      const unit = view.unit;
      if (!unit.combatant.isAlive) continue;
      const x = unit.combatant.x;
      const y = unit.combatant.y;
      const hpY = y - unit.radius - 12;
      view.body.setPosition(x, y);
      view.shadow.setPosition(x, y + unit.radius - 2);
      view.hpBackground.setPosition(x, hpY);
      view.hpFill.setPosition(x - view.hpWidth / 2, hpY);
      view.nameText.setPosition(x, y + unit.radius + 8);
      view.statusText.setPosition(x, hpY - 12);

      const winding = unit.activity === 'windup';
      view.windupRing.setPosition(x, y).setVisible(winding);
      if (winding) {
        const total = unit.enemy.attack?.windupSeconds ?? 0.7;
        const progress = 1 - Math.min(1, Math.max(0, unit.windupRemaining / total));
        view.windupRing.setScale(0.55 + progress * 0.45);
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

    this.waveRunner = null;
    this.rewardFlow = null;
    this.waveClearHandled = true;
    this.upgradeChoice = null;
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
      this.bossHud.setText('失控实验体 · 已击败').setVisible(true);
      return;
    }

    const health = unit.combatant.health;
    const phaseText = boss.phase === 1 ? '阶段一' : '阶段二';
    const summonText =
      boss.phase === 2 ? ` · 召唤 ${boss.summonRemainingSeconds.toFixed(1)}s` : '';
    this.bossHud
      .setText(
        `失控实验体 · ${phaseText} · 生命 ${hudValue(health.health)}/${hudValue(health.maxHealth)}${summonText}`,
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

    // L 生效期间下一发仍为强化弹时，把发射间隔切到 1.1 秒。
    const burst = this.burst;
    const overrideInterval =
      burst && burst.isActive && burst.ammoRemaining > 1
        ? burst.fireIntervalSeconds
        : undefined;
    // 精神爆发结束后的 0.5 秒只锁 J；移动与闪避不受影响。
    const jHeld = this.amiya?.isJFiringLocked ? false : this.jHeld;
    if (this.attackTimer.update(stepSeconds, jHeld, overrideInterval)) {
      if (this.saria) {
        // 塞雷娅 J 盾击：命中当前面前扇区，不生成弹体；普通敌人被击退。
        this.playSfx(COMBAT_SFX.attack);
        this.performShieldBash(this.character.attack);
        if (this.buildEffects.consumeTacticalEcho()) {
          this.performShieldBash(echoAttackOf(this.character.attack));
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
        const attack = this.amiya ? this.amiya.modifyAttack(baseAttack) : baseAttack;
        const origin = this.motion.position;
        const facing = this.motion.facingDirection;
        // A01 只作用于 J（含 G06 追加的 J），K 的精神爆发弹保持单目标。
        const jPierce = this.amiya
          ? amiyaJPierce(this.upgradeRun.stacksOf('A01'))
          : null;
        const state = createProjectile(
          this.nextProjectileId,
          origin,
          facing,
          attack,
          jPierce,
        );
        this.nextProjectileId += 1;

        // 阿米娅的源石术式为蓝黑术式，缪尔赛思为水色水弹，维什戴尔保持橙红炮火。
        const colors = characterEffectColors(this.character.id);
        const fill = empowered ? 0xff7b4e : colors.projectileFill;
        const stroke = empowered ? 0xffd166 : colors.projectileStroke;
        const sprite = this.add
          .circle(origin.x, origin.y, state.radius, fill)
          .setStrokeStyle(1.5, stroke)
          .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
        this.projectiles.push({ state, sprite, source: 'J' });
        this.playSfx(COMBAT_SFX.attack);

        // G06 战术回响：本次 J 追加一次 50% 伤害攻击；只复制 J，不复制 K/L。
        if (this.buildEffects.consumeTacticalEcho()) {
          const echoState = createProjectile(
            this.nextProjectileId,
            origin,
            facing,
            echoAttackOf(attack),
            jPierce,
          );
          this.nextProjectileId += 1;
          const echoSprite = this.add
            .circle(origin.x, origin.y, echoState.radius, colors.secondary)
            .setStrokeStyle(1.5, colors.projectileStroke)
            .setDepth(FRIENDLY_EFFECT_DEPTH.projectile);
          this.projectiles.push({ state: echoState, sprite: echoSprite, source: 'J' });
          this.showSkillLabel('战术回响');
        }

        // 使用八向施法帧，保证斜向射击的枪口方向与画面一致。
        this.castPoseSeconds = 0.16;
        this.castPoseFacing = facing;
      }
    }

    this.stepProjectiles(stepSeconds);
    this.stepEnemies(stepSeconds);
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
    burst?.step(stepSeconds);
    this.stepSoul(stepSeconds);

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
    let doubleCastFired = false;
    for (const shot of shots) {
      const state = createProjectile(this.nextProjectileId, origin, shot.facing, {
        ...attack,
        damage: shot.damage,
        damageType: shot.damageType,
      });
      this.nextProjectileId += 1;
      if (shot.source === 'doubleCast') doubleCastFired = true;
      const fill = shot.source === 'doubleCast' ? 0x8a6bff : 0x3f6fc4;
      const stroke = shot.source === 'doubleCast' ? 0xd9c9ff : 0xa8d8ff;
      const sprite = this.add
        .circle(origin.x, origin.y, state.radius, fill)
        .setStrokeStyle(1.5, stroke)
        .setDepth(6);
      this.projectiles.push({ state, sprite, source: 'K' });
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
        damageMultiplier: this.buildEffects.damageMultiplier,
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
        damageMultiplier: this.buildEffects.damageMultiplier,
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
        damageMultiplier: this.buildEffects.damageMultiplier,
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

    const result = muelsyse.step(stepSeconds, {
      player: this.motion.position,
      targets: this.collectTargets(),
      // G01「所有自身与召唤物伤害」也作用于主流形与副本。
      damageMultiplier: this.buildEffects.damageMultiplier,
      // Boss 的眩晕/束缚转为减速，且免疫近战 L 的强制位移。
      isBoss: (targetId) => this.isBossTarget(targetId),
    });

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
    sprite.setVisible(alive);
    this.formShadow?.setVisible(alive);
    this.formRing?.setVisible(alive);
    this.formHpBackground?.setVisible(alive);
    this.formHpFill?.setVisible(alive);
    this.formLabel?.setVisible(alive);
    if (!alive) return;

    sprite.setPosition(position.x, position.y - PLAYER.bodyCenterOffsetY);
    sprite.setTint(muelsyse.form === 'melee' ? 0x7fe0b8 : 0x9df2dd);
    this.formShadow?.setPosition(position.x, position.y + 10);
    this.formRing?.setPosition(position.x, position.y);
    this.formHpBackground?.setPosition(position.x - 22, position.y - 52);
    this.formHpFill?.setPosition(position.x - 22, position.y - 52);
    const ratio = Math.min(1, Math.max(0, muelsyse.formHealth / muelsyse.formMaxHealth));
    this.formHpFill?.setSize(44 * ratio, 6);

    const direction = facingToSpriteDirection(muelsyse.formFacing);
    const action = this.formCastSeconds > 0 ? 'attack' : 'idle';
    sprite.setFrame(
      playerFrameIndex(
        direction,
        action,
        action === 'idle' ? Math.floor(this.simulatedSeconds * 3) % 2 : 0,
      ),
    );

    const formName = muelsyse.form === 'melee' ? '近战流形' : '远程流形';
    const stacks =
      muelsyse.form === 'melee'
        ? ` · 窃取 ${muelsyse.formStacks}/${muelsyse.maxMeleeStacks}`
        : '';
    this.formLabel?.setText(
      `${formName} ${hudValue(muelsyse.formHealth)}/${muelsyse.formMaxHealth}${stacks}`,
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
            playerFrameIndex('down', 'idle'),
          )
          .setOrigin(PLAYER.originX, PLAYER.originY)
          .setScale(0.78)
          .setTint(0x9df2dd)
          .setAlpha(0.66)
          .setDepth(5);
        const ring = this.add
          .circle(copy.x, copy.y, 17, 0x5fd8d0, 0.07)
          .setStrokeStyle(1, 0x9df2dd, 0.45)
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
        view = { sprite, ring, label };
        this.muelsyseCopyViews.set(copy.id, view);
      }
      view.sprite.setPosition(copy.x, copy.y - PLAYER.bodyCenterOffsetY);
      view.ring.setPosition(copy.x, copy.y);
      view.label
        .setPosition(copy.x, copy.y - 54)
        .setText(`副本 ${copy.remainingSeconds.toFixed(1)}s`);
      const frameAction = 'idle';
      view.sprite.setFrame(
        playerFrameIndex(
          facingToSpriteDirection(muelsyse.formFacing),
          frameAction,
          Math.floor(this.simulatedSeconds * 3) % 2,
        ),
      );
    }

    for (const [id, view] of this.muelsyseCopyViews) {
      if (seen.has(id)) continue;
      view.sprite.destroy();
      view.ring.destroy();
      view.label.destroy();
      this.muelsyseCopyViews.delete(id);
    }
  }

  /** 主流形被近战敌人击中：伤害数字显示在流形上方并短暂闪红。 */
  private showFormDamage(result: DamageResult): void {
    if (!result.applied) return;
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
   * 所有对敌伤害的统一增伤入口：只有魔法伤害读取钙质化领域 ×1.3。
   * 弹体、S01/S02、S03（物理不乘）、G05/G07 都只经过这里一次，避免重复乘算。
   */
  private enemyDamageMultiplier(enemyId: string, damageType: DamageType): number {
    return damageType === 'magic' ? this.enemyMagicMultiplierFromField(enemyId) : 1;
  }

  /**
   * 塞雷娅 J 盾击：结算面前扇区的物理伤害与普通敌人击退，再播放扇区提示。
   * 不生成弹体；命中结果直接驱动伤害数字、击杀与经验掉落。
   */
  private performShieldBash(attack: AttackDefinition): void {
    const origin = this.motion.position;
    const facing = this.motion.facingDirection;
    const targets = this.enemies.map((enemy) => ({
      combatant: enemy.unit.combatant,
      isElite: enemy.unit.enemy.elite === true,
    }));
    const hits = resolveShieldBash(
      origin,
      facing,
      targets,
      attack,
      this.buildEffects.damageMultiplier,
      {
        // 领域生效期间 J 追加 10 法伤；法伤仍按领域内 +30% 结算一次。
        bonusMagicDamage: this.saria?.isCalciumFieldActive
          ? this.saria.attackBonusMagicDamage
          : 0,
        magicDamageMultiplier: (targetId) =>
          this.enemyDamageMultiplier(targetId, 'magic'),
      },
    );

    for (const hit of hits) {
      this.showHitResult(
        hit.targetId,
        combineDamageResults(hit.result, hit.bonusMagicResult),
      );
      if (hit.knockbackDistance > 0) {
        this.enemySystem.knockback(hit.targetId, origin, hit.knockbackDistance);
      }
    }

    this.showShieldBashArc(origin, facing, attack);
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
    const result = this.soul.step(stepSeconds, this.collectTargets());
    for (const tick of result.ticks) this.renderSoulTick(tick);
    for (const soulId of result.expiredSoulIds) this.removeSoulVisual(soulId);
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

      const hit = this.enemies.find(
        (enemy) =>
          enemy.unit.combatant.isAlive &&
          !entry.state.hitTargetIds.has(enemy.unit.combatant.id) &&
          projectileHitsTarget(entry.state, enemy.unit.combatant),
      );
      if (hit) {
        if (this.grenade) {
          entry.sprite.destroy();
          // 维什戴尔：榴弹直接命中按溅射与余震规则结算。
          const detonation = this.grenade.detonate(
            { x: entry.state.x, y: entry.state.y },
            hit.unit.combatant.id,
            this.collectTargets(),
            entry.state.attack,
          );
          this.renderDetonation(detonation);
        } else {
          // 阿米娅：直线术式只伤害命中的目标；G01 全局倍率与其他伤害同源。
          // 钙质化领域内的敌人受到法伤 +30%，统一由 `enemyDamageMultiplier` 乘一次。
          const result = resolveProjectileHit(
            entry.state,
            hit.unit.combatant,
            this.buildEffects.damageMultiplier *
              this.enemyDamageMultiplier(
                hit.unit.combatant.id,
                entry.state.damageType,
              ),
          );
          this.showHitResult(hit.unit.combatant.id, result);
          if (entry.source === 'J' && this.amiya) {
            // 同一发弹体穿透多个敌人也只累计一次情绪吸收。
            const absorption = this.amiya.registerJHit(entry.state.id);
            if (absorption.cooldownReducedSeconds > 0) {
              this.showSkillLabel('情绪吸收 · K 冷却 −1s');
            }
          }
          if (entry.source === 'J' && this.muelsyse) {
            // M04 水镜共鸣：主流形对 J 命中的目标补一次攻击，内置冷却 0.6 秒；
            // 补攻直接走主流形结算，不进入分裂计数，也不会再触发本分支。
            const echo = this.muelsyse.resolveWaterMirrorHit(hit.unit.combatant, {
              damageMultiplier: this.buildEffects.damageMultiplier,
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
          if (registerProjectileHit(entry.state, hit.unit.combatant.id)) {
            survivors.push(entry);
            continue;
          }
          entry.sprite.destroy();
        }
        continue;
      }

      if (status !== 'active') {
        entry.sprite.destroy();
        continue;
      }

      survivors.push(entry);
    }

    this.projectiles = survivors;
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
  }

  /** 延时余震：播放余震范围，并逐个播放残影引爆与眩晕。 */
  private renderAftershock(resolution: AftershockResolution): void {
    this.showExplosion(resolution.x, resolution.y, resolution.radius, 0xff7b4e);
    for (const hit of resolution.hits) this.showHitResult(hit.targetId, hit.damage);
    for (const explosion of resolution.explosions) {
      this.showExplosion(explosion.x, explosion.y, explosion.radius, 0xc77dff);
      for (const hit of explosion.hits) {
        this.showHitResult(hit.targetId, hit.damage);
        this.showStunLabel(hit.targetId, explosion.stunSeconds);
      }
      // W02 的扩散标记用短文本提示，否则只能靠血条状态察觉。
      if (explosion.spreadTargetIds.length > 0) {
        this.showSpreadLabel(explosion.x, explosion.y, explosion.spreadTargetIds.length);
      }
    }
  }

  /** 魂灵视觉：暗色灵体 + 外圈，静止在召唤点；不参与碰撞与受击。 */
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
    if (result.replacedSoulId !== null) this.removeSoulVisual(result.replacedSoulId);
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
    const echoArmed = this.buildEffects.armTacticalEcho();
    this.showSkillLabel(echoArmed ? '精神爆发 · 回响就绪' : '精神爆发');
  }

  /** 阿米娅 L：启动 8 秒奇美拉；冷却中、生效中或虚弱期重复按键无效。 */
  private castChimera(): void {
    if (this.playerHealth.isDead) return;
    if (!this.amiya?.tryActivateL()) return;
    this.playSfx(COMBAT_SFX.skillL);
    this.showCastPulse();
    this.showSkillLabel('奇美拉 · 真实伤害');
  }

  /** 塞雷娅 K：治疗、护盾与精神回复；冷却中重复按键无效。 */
  private castFirstAid(): void {
    if (this.playerHealth.isDead) return;
    const result = this.saria?.tryActivateK(this.playerHealth);
    if (!result) return;
    this.playSfx(COMBAT_SFX.skillK);
    this.showCastPulse();

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
    const result = this.muelsyse?.tryActivateL();
    if (!result) return;

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
    this.showSkillLabel(label);
    this.syncMuelsyseForm();
    this.syncMuelsyseCopies();
  }

  /** L：启动爆裂黎明；冷却中重复按键不重置弹药。 */
  private castBurst(): void {
    if (!this.burst?.tryActivate()) return;
    this.playSfx(COMBAT_SFX.skillL);
    this.showCastPulse();
    this.showSkillLabel('爆裂黎明');
  }

  private showSkillLabel(label: string, color?: string): void {
    const position = this.motion.position;
    const text = this.add
      .text(position.x, position.y - 34, label, {
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
    const burst = this.add
      .circle(x, y, radius, color, 0.35)
      .setDepth(FRIENDLY_EFFECT_DEPTH.explosion);
    this.tweens.add({
      targets: burst,
      scale: 1.35,
      alpha: 0,
      duration: 260,
      onComplete: () => burst.destroy(),
    });
  }

  /** 技能启动的可见反馈：角色主色脉冲，与普通攻击弹体区分。 */
  private showCastPulse(): void {
    const position = this.motion.position;
    const color = characterEffectColors(this.character.id).primary;
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
    view.body.setFillStyle(HIT_FEEDBACK.flashColor, 1);
    this.time.delayedCall(HIT_FEEDBACK.flashDurationMs, () => {
      if (!view.body.active || !view.unit.combatant.isAlive) return;
      view.body.setFillStyle(view.baseColor, 1);
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
    if (view) this.showDamageResult(view, result, allowKillExplosion);
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
        this.killHud.setText(`击杀：${this.killCount}`);
        // 经验由击杀掉落：普通 5、精英 25；死亡玩家不再获得经验。
        if (!this.playerHealth.isDead) {
          const orb = this.progression.spawnXpOrb(
            view.unit.combatant.x,
            view.unit.combatant.y,
            view.unit.enemy.elite === true,
          );
          this.createXpOrbVisual(orb);
        }
      }
      view.body.setFillStyle(view.baseColor, 1);
      view.body.setAlpha(0.22);
      view.shadow.setVisible(false);
      view.hpBackground.setVisible(false);
      view.hpFill.setVisible(false);
      view.statusText.setVisible(false);
      view.nameText.setText(`${view.label} · 已击杀`).setColor('#8a8490');
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
    if (this.grenade?.isStunned(combatant.id)) {
      view.statusText
        .setText(`眩晕 ${this.grenade.stunRemaining(combatant.id).toFixed(1)}s`)
        .setColor('#cfe8ff')
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
    // 魂灵、G07 闪避脉冲与缪尔赛思的 Boss 减速共用减速状态显示，取较长剩余时间。
    const slowRemaining = Math.max(
      this.soul?.slowRemaining(combatant.id) ?? 0,
      this.buildEffects.slowRemaining(combatant.id),
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

  private collectTargets(): Combatant[] {
    return this.enemies.map((enemy) => enemy.unit.combatant);
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

  /** 当前角色的 64×64 精灵表资源键。 */
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

  /** 为当前角色的四个朝向注册待机、行走、攻击与受击动画。 */
  private createPlayerAnimations(characterId: string): void {
    const assetKey = this.characterAssetKey(characterId);
    const actions = Object.keys(PLAYER_ACTION_COLUMNS) as PlayerAction[];
    for (const direction of PLAYER_DIRECTIONS) {
      for (const action of actions) {
        const key = playerAnimationKey(direction, action, characterId);
        if (this.anims.exists(key)) continue;
        this.anims.create({
          key,
          frames: PLAYER_ACTION_COLUMNS[action].map((frame) => ({
            key: assetKey,
            frame: playerFrameIndex(direction, action, frame),
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

    // 开场倒计时期间不响应战斗输入，避免提前消耗技能或按住 J 抢跑。
    if (this.runState.phase === 'countdown') return;

    // 战斗时 Space/Tab 不滚屏或抢走焦点，即使被重绑到其它动作。
    if (COMBAT_PREVENT_DEFAULT_CODES.includes(code)) {
      event.preventDefault();
    }

    if (event.repeat) return;

    const bindings = this.settingsStore.get().keyBindings;
    const action = combatBindingActionForKeyCode(bindings, code);
    if (!action) return;

    if (action === 'dodge') {
      if (this.motion.requestDodge()) this.playSfx(COMBAT_SFX.dodge);
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
    if (!this.runState.pause()) {
      this.pauseController.reset();
      return false;
    }
    this.combatPaused = true;
    this.jHeld = false;
    this.castPoseSeconds = 0;
    this.hurtPoseSeconds = 0;
    this.motion.clearKeys();
    this.motion.cancelDodge();
    this.logicLoop.reset();
    this.syncPlayerAnimation();
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

  /** 应用壳暂停面板调用：失焦/续局暂停拒绝 Esc，只接受 Enter。 */
  resumeCombat(input: PauseResumeInput = 'enter'): boolean {
    if (!this.combatPaused) return true;
    if (!this.pauseController.resume(input)) return false;
    this.combatPaused = false;
    this.runState.resume();
    this.jHeld = false;
    this.motion.clearKeys();
    this.logicLoop.reset();
    this.pauseHint.setVisible(false);
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
    ];
    parts.push(`${key('cycleTarget')} 切换目标`, `${key('dodge')} 闪避`, 'Esc 暂停');
    this.controlsHint.setText(parts.join(' · '));
  }

  private syncPlayerSprite(): void {
    const position = this.motion.position;
    const spriteY = position.y - PLAYER.bodyCenterOffsetY;
    this.player.setPosition(position.x, spriteY);
    this.playerShadow.setPosition(position.x, spriteY + 2);
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
        playerCastFrameIndex(this.castPoseFacing),
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
  getUpgradeChoiceKind(): 'upgrade' | 'mechanic' | null {
    return this.upgradeChoice?.kind ?? null;
  }

  getUpgradeFocusIndex(): number {
    return this.upgradeChoice?.focusIndex ?? -1;
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
      damageMultiplier: this.buildEffects.damageMultiplier,
      moveSpeedMultiplier: this.buildEffects.moveSpeedMultiplier,
      cooldownReduction: this.buildEffects.cooldownReduction,
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
    return (
      (this.grenade?.isStunned(id) ?? false) ||
      (this.muelsyse?.isEnemyStunned(id) ?? false)
    );
  }

  isEnemyRooted(id: string): boolean {
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

  getDevSnapshot(): DevStateSnapshot | null {
    if (!this.devReady) return null;

    const settings = this.settingsStore.get();
    const audio = this.soundPlayer.getState();
    const marked = new Set(this.getMarkedEnemyIds());
    const hud = buildHudModel(this.hudState);
    const viewport = this.currentHudViewport();
    return {
      characterId: this.character.id,
      seed: this.upgradeRun.seed,
      phase: this.runState.phase,
      wave: this.waveNumber,
      countdownRemaining: this.runState.countdownRemaining,
      simulatedSeconds: this.simulatedSeconds,
      paused: this.combatPaused,
      pauseReason: this.getPauseReason(),
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
      hud: {
        target: hud.lines.target,
        vitals: hud.lines.vitals,
        progress: hud.lines.progress,
        wave: hud.lines.wave,
        kills: hud.lines.kills,
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
      },
      level: this.progression.level,
      experience: this.progression.experience,
      experienceToNextLevel: this.progression.experienceToNextLevel,
      pendingLevelUps: this.progression.pendingLevelUps,
      kills: this.killCount,
      damageDealt: this.damageDealt,
      rewardStage: this.getRewardStage(),
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
        stunned: this.isEnemyStunned(unit.id),
        rooted: this.isEnemyRooted(unit.id),
        marked: marked.has(unit.id),
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
          }
        : null,
      upgrades: this.getOwnedUpgrades().map((upgrade) => ({ ...upgrade })),
      upgradeChoice: this.upgradeChoice
        ? {
            kind: this.upgradeChoice.kind,
            focusIndex: this.upgradeChoice.focusIndex,
            rerollsRemaining: this.upgradeChoice.rerollsRemaining,
            cards: this.upgradeChoice.hand.map((card) => ({
              id: card.id,
              name: card.name,
              rarity: card.rarity,
            })),
          }
        : null,
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

  /** 魂灵或 G07 脉冲造成的减速剩余秒数；非正数表示未被减速。 */
  getSlowRemaining(id: string): number {
    return Math.max(
      this.soul?.slowRemaining(id) ?? 0,
      this.buildEffects.slowRemaining(id),
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
