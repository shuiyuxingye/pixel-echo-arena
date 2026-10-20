/**
 * 开发环境只读状态快照（docs/game-design.md §10）。
 *
 * 仅在 `import.meta.env.DEV` 分支安装全局桥；生产构建不包含桥与标记字符串。
 * 桥只暴露 `getSnapshot()`，返回当帧的可序列化副本，没有任何跳关、无敌或
 * 直接修改完成状态的入口。
 */
import { SCENE_KEYS } from './config';
import type { Facing } from './movement';

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
  readonly stunned: boolean;
  readonly rooted: boolean;
  readonly marked: boolean;
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

/** 当前三选一手牌；试玩脚本据此选择构筑，只读。 */
export interface DevUpgradeChoiceSnapshot {
  readonly kind: string;
  readonly focusIndex: number;
  readonly rerollsRemaining: number;
  readonly cards: readonly {
    readonly id: string;
    readonly name: string;
    readonly rarity: string;
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
  readonly activity: string;
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
  readonly dodge: string;
  readonly resource: string;
  readonly skillDetail: string;
  readonly skills: readonly DevHudSkillSnapshot[];
  readonly viewport: DevHudViewportSnapshot;
}

/** 场景产出的纯数据快照；不含渲染对象、函数或内部可变引用。 */
export interface DevStateSnapshot {
  readonly characterId: string;
  readonly seed: number;
  readonly phase: string;
  readonly wave: number;
  readonly countdownRemaining: number;
  readonly simulatedSeconds: number;
  readonly paused: boolean;
  /** 暂停原因（manual/blur/checkpoint）；未暂停为 undefined。 */
  readonly pauseReason?: string | null;
  readonly settings?: DevSettingsSnapshot;
  readonly save?: DevSaveSnapshot;
  readonly audio?: DevAudioSnapshot;
  readonly hud: DevHudSnapshot;
  readonly health: DevHealthSnapshot;
  readonly player: DevPlayerSnapshot;
  readonly combat: DevCombatSnapshot;
  readonly level: number;
  readonly experience: number;
  readonly experienceToNextLevel: number;
  readonly pendingLevelUps: number;
  readonly kills: number;
  /** 本局对敌人造成的累计伤害；失败后冻结。 */
  readonly damageDealt: number;
  readonly rewardStage: string;
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
  readonly upgradeChoice: DevUpgradeChoiceSnapshot | null;
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
  if (snapshot.summon) Object.freeze(snapshot.summon);
  Object.freeze(snapshot.upgrades);
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
