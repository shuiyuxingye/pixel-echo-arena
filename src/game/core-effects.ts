/**
 * 精英核心 E01–E08 的机制状态机（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/02-content-catalog.md` §精英核心：
 * - E01 炉心契约：爆炸命中 3 个不同敌人后，下一次爆炸半径 +35%，冷却 2 秒；
 * - E02 星蚀之眼：每第 8 次法术命中触发 90 真实伤害，触发伤害不继续计数；
 * - E03 不屈圣印：每波首次生命归零改为 1 生命 + 2 秒无敌，每局最多 3 次；
 * - E04 群落意志：所有召唤物伤害 +20%（幻影本体由 `MuelsyseCombat` 维护）；
 * - E05 猎金之约：本波每 30 击杀金币，下一波起累计 +3% 伤害，上限 +30%；
 * - E06 回响之核：每第 3 次释放技能，1 秒后以 45% 强度复施一次，不递归；
 * - E07 逆风齿轮：生命低于 50% 时伤害 +20%、闪避冷却 −25%，实时开关；
 * - E08 折光王冠：每 6 次 J 命中产生 2 枚 30% 伤害侧弹，侧弹不计数。
 *
 * 所有触发伤害都必须通过 `DamageChainTracker.derive` 取得衍生来源；
 * 衍生来源（depth=1）不再计入 E02/E08 的命中次数，也不会二次派生。
 */
import { requireCoreParam } from './data';
import {
  DamageChainTracker,
  type CombatEventSource,
} from './damage-events';

/** E01：引爆所需的不同敌人数量。 */
export const E01_HITS_REQUIRED = Math.max(
  1,
  Math.floor(requireCoreParam('E01', 'hitsRequired')),
);
/** E01：下次爆炸的半径倍率加成。 */
export const E01_RADIUS_BONUS = requireCoreParam('E01', 'radiusBonus');
/** E01：触发后的冷却秒数。 */
export const E01_COOLDOWN_SECONDS = requireCoreParam('E01', 'cooldownSeconds');

/** E02：触发所需的法术命中次数。 */
export const E02_HITS_REQUIRED = Math.max(
  1,
  Math.floor(requireCoreParam('E02', 'hitsRequired')),
);
/** E02：触发伤害；真实伤害不受护甲/法抗减免。 */
export const E02_TRIGGER_DAMAGE = requireCoreParam('E02', 'damage');

/** E03：替换致命伤后的无敌秒数。 */
export const E03_INVULNERABLE_SECONDS = requireCoreParam(
  'E03',
  'invulnerableSeconds',
);
/** E03：每局最多触发次数。 */
export const E03_MAX_TRIGGERS_PER_RUN = Math.max(
  0,
  Math.floor(requireCoreParam('E03', 'maxTriggersPerRun')),
);

/** E04：所有召唤物伤害加成。 */
export const E04_SUMMON_DAMAGE_BONUS = requireCoreParam(
  'E04',
  'summonDamageBonus',
);
/** E04：主召唤物复制幻影的间隔。 */
export const E04_PHANTOM_INTERVAL_SECONDS = requireCoreParam(
  'E04',
  'phantomIntervalSeconds',
);
/** E04：幻影持续时间。 */
export const E04_PHANTOM_DURATION_SECONDS = requireCoreParam(
  'E04',
  'phantomDurationSeconds',
);
/** E04：幻影伤害相对主召唤物的比例。 */
export const E04_PHANTOM_DAMAGE_RATIO = requireCoreParam(
  'E04',
  'phantomDamageRatio',
);
/** E04：同时存在的幻影上限。 */
export const E04_MAX_PHANTOMS = Math.max(
  0,
  Math.floor(requireCoreParam('E04', 'maxPhantoms')),
);

/** E05：每多少击杀金币获得一层 +3% 伤害。 */
export const E05_GOLD_PER_STACK = Math.max(
  1,
  Math.floor(requireCoreParam('E05', 'goldPerStack')),
);
/** E05：每层追加的伤害比例。 */
export const E05_DAMAGE_BONUS_PER_STACK = requireCoreParam(
  'E05',
  'damageBonusPerStack',
);
/** E05：累计伤害加成上限。 */
export const E05_MAX_DAMAGE_BONUS = requireCoreParam('E05', 'maxDamageBonus');

/** E06：触发复施所需的技能释放次数。 */
export const E06_CASTS_REQUIRED = Math.max(
  1,
  Math.floor(requireCoreParam('E06', 'castsRequired')),
);
/** E06：复施延迟秒数。 */
export const E06_ECHO_DELAY_SECONDS = requireCoreParam(
  'E06',
  'echoDelaySeconds',
);
/** E06：复施强度倍率。 */
export const E06_ECHO_STRENGTH = requireCoreParam('E06', 'echoStrength');

/** E07：低血判定阈值（生命低于该比例时触发）。 */
export const E07_HEALTH_THRESHOLD = requireCoreParam('E07', 'healthThreshold');
/** E07：低血时的伤害加成。 */
export const E07_DAMAGE_BONUS = requireCoreParam('E07', 'damageBonus');
/** E07：低血时的闪避冷却缩减比例。 */
export const E07_DODGE_COOLDOWN_REDUCTION = requireCoreParam(
  'E07',
  'dodgeCooldownReduction',
);

/** E08：触发侧弹所需的 J 命中次数。 */
export const E08_HITS_REQUIRED = Math.max(
  1,
  Math.floor(requireCoreParam('E08', 'hitsRequired')),
);
/** E08：每次触发的侧弹数量。 */
export const E08_SIDE_BULLET_COUNT = Math.max(
  1,
  Math.floor(requireCoreParam('E08', 'sideBulletCount')),
);
/** E08：侧弹伤害相对触发攻击的比例。 */
export const E08_SIDE_BULLET_DAMAGE_RATIO = requireCoreParam(
  'E08',
  'sideBulletDamageRatio',
);

/** E02 触发后要施加的衍生伤害。 */
export interface CoreSpellTrigger {
  /** `origin=derived`、`depth=1`，沿用触发它的原生链 ID。 */
  readonly source: CombatEventSource;
  readonly damage: number;
}

/** E06 到期后要复施的技能槽与强度。 */
export interface CoreSkillEchoTrigger {
  /** 触发复施的技能槽（U/I；接入前由现有技能槽提供）。 */
  readonly slot: string;
  /** 复施强度倍率，例如 0.45。 */
  readonly strength: number;
}

/** E08 触发后要生成的侧弹。 */
export interface CoreSideBulletTrigger {
  /** `origin=derived`、`depth=1`，沿用触发它的原生链 ID。 */
  readonly source: CombatEventSource;
  readonly count: number;
  readonly damageRatio: number;
}

export interface CoreEffectsOptions {
  /** 查询当前是否拥有某个核心；由权威账本（CoreInventory）提供。 */
  readonly hasCore: (coreId: string) => boolean;
}

/** 核心机制的持久化状态；只保存会影响后续结算的计数与冷却。 */
export interface CoreEffectsSnapshot {
  readonly e01DistinctTargets: readonly string[];
  readonly e01Armed: boolean;
  readonly e01CooldownRemaining: number;
  readonly e02Hits: number;
  readonly e02Triggers: number;
  readonly e03UsedThisWave: boolean;
  readonly e03UsedThisRun: number;
  /** E05：本波已获得的击杀金币；旧快照缺省为 0。 */
  readonly e05KillGoldThisWave?: number;
  /** E05：已累计的下一波伤害加成；旧快照缺省为 0。 */
  readonly e05DamageBonus?: number;
  /** E06：当前累计的技能释放次数（0 到触发阈值 − 1）。 */
  readonly e06Casts?: number;
  /** E06：本局已执行的复施次数。 */
  readonly e06Echoes?: number;
  /** E06：待执行复施的剩余秒数；无待执行时为 0。 */
  readonly e06EchoRemainingSeconds?: number;
  /** E06：是否有待执行的复施（剩余时间走完即就绪）。 */
  readonly e06EchoPending?: boolean;
  /** E06：待复施的技能槽；无待执行时缺省。 */
  readonly e06EchoSlot?: string;
  /** E07：当前是否处于低血触发状态。 */
  readonly e07Active?: boolean;
  /** E08：当前累计的 J 命中次数（0 到触发阈值 − 1）。 */
  readonly e08Hits?: number;
  /** E08：本局已触发的侧弹次数。 */
  readonly e08Triggers?: number;
}

/** 浮点累计容差；与项目其他计时模块保持一致。 */
const TIME_EPSILON = 1e-9;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegative(value) && Number.isInteger(value);
}

function isTargetIdList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => typeof item === 'string' && item.length > 0,
    )
  );
}

/** 存档边界校验：字段缺失或类型非法都拒绝，不静默修补未知结构。 */
export function validateCoreEffectsSnapshot(
  value: unknown,
): value is CoreEffectsSnapshot {
  if (
    !(
      isRecord(value) &&
      isTargetIdList(value.e01DistinctTargets) &&
      value.e01DistinctTargets.length <= E01_HITS_REQUIRED &&
      typeof value.e01Armed === 'boolean' &&
      isNonNegative(value.e01CooldownRemaining) &&
      isNonNegativeInteger(value.e02Hits) &&
      value.e02Hits < E02_HITS_REQUIRED &&
      isNonNegativeInteger(value.e02Triggers) &&
      typeof value.e03UsedThisWave === 'boolean' &&
      isNonNegativeInteger(value.e03UsedThisRun) &&
      value.e03UsedThisRun <= E03_MAX_TRIGGERS_PER_RUN
    )
  ) {
    return false;
  }

  // E05–E08 字段是后加的：旧存档可以缺省；一旦出现就必须合法。
  const optional: readonly [string, (entry: unknown) => boolean][] = [
    [
      'e05KillGoldThisWave',
      (entry) => isNonNegativeInteger(entry),
    ],
    [
      'e05DamageBonus',
      (entry) =>
        isNonNegative(entry) &&
        (entry as number) <= E05_MAX_DAMAGE_BONUS + TIME_EPSILON,
    ],
    [
      'e06Casts',
      (entry) => isNonNegativeInteger(entry) && (entry as number) < E06_CASTS_REQUIRED,
    ],
    ['e06Echoes', (entry) => isNonNegativeInteger(entry)],
    [
      'e06EchoRemainingSeconds',
      (entry) =>
        isNonNegative(entry) &&
        (entry as number) <= E06_ECHO_DELAY_SECONDS + TIME_EPSILON,
    ],
    ['e06EchoPending', (entry) => typeof entry === 'boolean'],
    [
      'e06EchoSlot',
      (entry) => typeof entry === 'string' && entry.length > 0,
    ],
    ['e07Active', (entry) => typeof entry === 'boolean'],
    [
      'e08Hits',
      (entry) => isNonNegativeInteger(entry) && (entry as number) < E08_HITS_REQUIRED,
    ],
    ['e08Triggers', (entry) => isNonNegativeInteger(entry)],
  ];
  for (const [key, isValid] of optional) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined && !isValid(entry)) return false;
  }
  return true;
}

/**
 * 四个核心的共享状态。场景只在固定逻辑步调用 `step`，
 * 并在对应结算点调用 E01/E02/E03 的入口；本类不持有 Phaser 对象。
 */
export class CoreEffects {
  private readonly hasCore: (coreId: string) => boolean;

  private readonly e01Distinct = new Set<string>();
  private e01ArmedValue = false;
  private e01CooldownSeconds = 0;

  private e02HitsValue = 0;
  private e02TriggersValue = 0;

  private e03UsedThisWaveValue = false;
  private e03UsedThisRunValue = 0;

  private e05KillGoldValue = 0;
  private e05DamageBonusValue = 0;

  private e06CastCount = 0;
  private e06EchoesValue = 0;
  private e06EchoRemaining = 0;
  private e06EchoPendingValue = false;
  private e06EchoSlot = '';

  private e07ActiveValue = false;

  private e08HitsValue = 0;
  private e08TriggersValue = 0;

  constructor(options: CoreEffectsOptions) {
    this.hasCore = options.hasCore;
  }

  has(coreId: string): boolean {
    return this.hasCore(coreId);
  }

  /** 推进逻辑时钟；衰减 E01 的再触发冷却与 E06 的复施延迟。 */
  step(seconds: number): void {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return;
    if (this.e01CooldownSeconds > 0) {
      this.e01CooldownSeconds = Math.max(0, this.e01CooldownSeconds - seconds);
      if (this.e01CooldownSeconds <= TIME_EPSILON) this.e01CooldownSeconds = 0;
    }
    if (this.e06EchoPendingValue && this.e06EchoRemaining > 0) {
      this.e06EchoRemaining = Math.max(0, this.e06EchoRemaining - seconds);
      if (this.e06EchoRemaining <= TIME_EPSILON) this.e06EchoRemaining = 0;
    }
  }

  /**
   * 新波开始：E03 的“每波首次”重新可用，每局次数继续累计；
   * E05 的本波击杀金币从 0 重新累计（上一波已在波末结算）。
   */
  startWave(): void {
    this.e03UsedThisWaveValue = false;
    this.e05KillGoldValue = 0;
  }

  /**
   * 波末结算 E05：本波每满 30 击杀金币追加一层 +3%，累计到上限为止。
   * 完成奖励金币不进本计数；下一波起由 `e05DamageBonus` 生效。
   */
  endWave(): void {
    if (this.has('E05') && this.e05KillGoldValue > 0) {
      const stacks = Math.floor(this.e05KillGoldValue / E05_GOLD_PER_STACK);
      if (stacks > 0) {
        this.e05DamageBonusValue = Math.min(
          E05_MAX_DAMAGE_BONUS,
          this.e05DamageBonusValue + stacks * E05_DAMAGE_BONUS_PER_STACK,
        );
      }
    }
    this.e05KillGoldValue = 0;
  }

  resetRun(): void {
    this.e01Distinct.clear();
    this.e01ArmedValue = false;
    this.e01CooldownSeconds = 0;
    this.e02HitsValue = 0;
    this.e02TriggersValue = 0;
    this.e03UsedThisWaveValue = false;
    this.e03UsedThisRunValue = 0;
    this.e05KillGoldValue = 0;
    this.e05DamageBonusValue = 0;
    this.e06CastCount = 0;
    this.e06EchoesValue = 0;
    this.e06EchoRemaining = 0;
    this.e06EchoPendingValue = false;
    this.e06EchoSlot = '';
    this.e07ActiveValue = false;
    this.e08HitsValue = 0;
    this.e08TriggersValue = 0;
  }

  // ---------------------------------------------------------------- E01

  get e01Armed(): boolean {
    return this.e01ArmedValue;
  }

  get e01CooldownRemaining(): number {
    return this.e01CooldownSeconds;
  }

  get e01ChargedTargetIds(): readonly string[] {
    return [...this.e01Distinct];
  }

  /**
   * 记录一次玩家爆炸命中的敌人 ID。只有 3 个不同敌人、且不在冷却/已蓄力时
   * 才进入“下次爆炸半径 +35%”状态；重复命中同一敌人不累计。
   * 返回本次调用是否刚刚完成蓄力。
   */
  recordExplosionHits(targetIds: readonly string[]): boolean {
    if (!this.has('E01')) return false;
    if (this.e01ArmedValue || this.e01CooldownSeconds > 0) return false;

    for (const targetId of targetIds) {
      if (typeof targetId !== 'string' || targetId.length === 0) continue;
      this.e01Distinct.add(targetId);
    }
    if (this.e01Distinct.size < E01_HITS_REQUIRED) return false;

    this.e01Distinct.clear();
    this.e01ArmedValue = true;
    this.e01CooldownSeconds = E01_COOLDOWN_SECONDS;
    return true;
  }

  /**
   * 在下一次玩家爆炸结算前调用：蓄力时返回 1.35 并消耗蓄力，否则返回 1。
   * 冷却从蓄力瞬间开始，即使未消耗也不会提前结束。
   */
  consumeExplosionRadiusMultiplier(): number {
    if (!this.e01ArmedValue) return 1;
    this.e01ArmedValue = false;
    return 1 + E01_RADIUS_BONUS;
  }

  // ---------------------------------------------------------------- E02

  get e02Hits(): number {
    return this.e02HitsValue;
  }

  get e02Triggers(): number {
    return this.e02TriggersValue;
  }

  /**
   * 记录一次法术命中。只有原生来源（depth=0）才计数；
   * 第 8 次触发时返回衍生来源与 90 真实伤害，计数清零。
   * 衍生来源直接返回 null，保证触发伤害不会继续计数或再次触发。
   */
  registerSpellHit(
    parent: CombatEventSource,
    chains: DamageChainTracker,
  ): CoreSpellTrigger | null {
    if (!this.has('E02')) return null;
    if (parent.origin !== 'native' || parent.depth !== 0) return null;

    const source = chains.derive(parent, 'E02');
    if (!source) return null;

    this.e02HitsValue += 1;
    if (this.e02HitsValue < E02_HITS_REQUIRED) return null;

    this.e02HitsValue = 0;
    this.e02TriggersValue += 1;
    return { source, damage: E02_TRIGGER_DAMAGE };
  }

  // ---------------------------------------------------------------- E03

  get e03UsedThisWave(): boolean {
    return this.e03UsedThisWaveValue;
  }

  get e03UsedThisRun(): number {
    return this.e03UsedThisRunValue;
  }

  /**
   * 生命归零时的保命判定：每波首次、每局最多 3 次。
   * 成功时立即消费次数，由场景把生命改为 1 并授予无敌。
   */
  tryPreventDeath(): boolean {
    if (!this.has('E03')) return false;
    if (this.e03UsedThisWaveValue) return false;
    if (this.e03UsedThisRunValue >= E03_MAX_TRIGGERS_PER_RUN) return false;

    this.e03UsedThisWaveValue = true;
    this.e03UsedThisRunValue += 1;
    return true;
  }

  // ---------------------------------------------------------------- E04

  /** 所有召唤物伤害倍率；未拥有 E04 时为 1。 */
  get summonDamageMultiplier(): number {
    return this.has('E04') ? 1 + E04_SUMMON_DAMAGE_BONUS : 1;
  }

  // ---------------------------------------------------------------- E05

  get e05KillGoldThisWave(): number {
    return this.e05KillGoldValue;
  }

  /** 下一波生效的累计伤害加成（0 到 0.30）。 */
  get e05DamageBonus(): number {
    return this.e05DamageBonusValue;
  }

  /** 当前已累计的层数；加成按每层 3% 换算。 */
  get e05Stacks(): number {
    return Math.round(this.e05DamageBonusValue / E05_DAMAGE_BONUS_PER_STACK);
  }

  /** 记录一次击杀金币；只有实际入账的击杀金币才交给本方法。 */
  recordKillGold(amount: number): void {
    if (!this.has('E05')) return;
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.e05KillGoldValue += Math.floor(amount);
  }

  // ---------------------------------------------------------------- E06

  get e06Casts(): number {
    return this.e06CastCount;
  }

  get e06Echoes(): number {
    return this.e06EchoesValue;
  }

  get e06EchoRemainingSeconds(): number {
    return this.e06EchoRemaining;
  }

  /** 复施延迟已走完、等待场景消费时为 true。 */
  get e06EchoReady(): boolean {
    return this.e06EchoPendingValue && this.e06EchoRemaining <= TIME_EPSILON;
  }

  /** 是否有待执行（含尚未到期）的复施。 */
  get e06EchoPending(): boolean {
    return this.e06EchoPendingValue;
  }

  /**
   * 记录一次技能释放（U/I；接入前由现有技能槽调用）。
   * 每第 3 次排入一次 1 秒后的复施；复施本身不得再调用本方法，
   * 因此不会递归触发。返回本次是否排入了新的复施。
   */
  registerSkillCast(slot: string): boolean {
    if (!this.has('E06')) return false;
    if (typeof slot !== 'string' || slot.length === 0) return false;

    this.e06CastCount += 1;
    if (this.e06CastCount < E06_CASTS_REQUIRED) return false;

    this.e06CastCount = 0;
    if (this.e06EchoPendingValue) return false;
    this.e06EchoPendingValue = true;
    this.e06EchoRemaining = E06_ECHO_DELAY_SECONDS;
    this.e06EchoSlot = slot;
    return true;
  }

  /**
   * 波初清空尚未执行的 E06 复施：上一波的施法不应在下一波开场自动复施。
   * 已累计的释放次数保留，冷却与触发计数照常跨波。
   */
  clearSkillEcho(): void {
    this.e06EchoPendingValue = false;
    this.e06EchoRemaining = 0;
    this.e06EchoSlot = '';
  }

  /**
   * 到期后取走复施：返回技能槽与 45% 强度。复施执行方直接应用效果，
   * 不进入 `registerSkillCast`，因此不会再次累计或再次排入复施。
   */
  consumeSkillEcho(): CoreSkillEchoTrigger | null {
    if (!this.e06EchoReady) return null;
    const slot = this.e06EchoSlot;
    this.e06EchoPendingValue = false;
    this.e06EchoRemaining = 0;
    this.e06EchoSlot = '';
    this.e06EchoesValue += 1;
    return { slot, strength: E06_ECHO_STRENGTH };
  }

  // ---------------------------------------------------------------- E07

  get e07Active(): boolean {
    return this.e07ActiveValue;
  }

  /** 低血时的伤害加成；未触发或未拥有 E07 时为 0。 */
  get e07DamageBonus(): number {
    return this.e07ActiveValue ? E07_DAMAGE_BONUS : 0;
  }

  /** 低血时的闪避冷却倍率（−25% → 0.75）；未触发时为 1。 */
  get dodgeCooldownMultiplier(): number {
    return this.e07ActiveValue ? 1 - E07_DODGE_COOLDOWN_REDUCTION : 1;
  }

  /**
   * 按当前生命实时更新 E07 的开关；“低于 50%”为严格小于。
   * 返回更新后的激活状态，调用方据此同步属性来源。
   */
  updateLowHealth(current: number, max: number): boolean {
    const active =
      this.has('E07') &&
      Number.isFinite(current) &&
      Number.isFinite(max) &&
      max > 0 &&
      current >= 0 &&
      current / max < E07_HEALTH_THRESHOLD;
    this.e07ActiveValue = active;
    return active;
  }

  // ---------------------------------------------------------------- E08

  get e08Hits(): number {
    return this.e08HitsValue;
  }

  get e08Triggers(): number {
    return this.e08TriggersValue;
  }

  /**
   * 记录一次 J 命中。只有原生来源（depth=0）才计数；每第 6 次返回
   * 衍生来源与侧弹数量/伤害比例。侧弹本身是 derived，不会再次计数。
   */
  registerJHit(
    parent: CombatEventSource,
    chains: DamageChainTracker,
  ): CoreSideBulletTrigger | null {
    if (!this.has('E08')) return null;
    if (parent.origin !== 'native' || parent.depth !== 0) return null;

    const source = chains.derive(parent, 'E08');
    if (!source) return null;

    this.e08HitsValue += 1;
    if (this.e08HitsValue < E08_HITS_REQUIRED) return null;

    this.e08HitsValue = 0;
    this.e08TriggersValue += 1;
    return {
      source,
      count: E08_SIDE_BULLET_COUNT,
      damageRatio: E08_SIDE_BULLET_DAMAGE_RATIO,
    };
  }

  // ------------------------------------------------------------- 快照

  snapshot(): CoreEffectsSnapshot {
    return {
      e01DistinctTargets: [...this.e01Distinct],
      e01Armed: this.e01ArmedValue,
      e01CooldownRemaining: this.e01CooldownSeconds,
      e02Hits: this.e02HitsValue,
      e02Triggers: this.e02TriggersValue,
      e03UsedThisWave: this.e03UsedThisWaveValue,
      e03UsedThisRun: this.e03UsedThisRunValue,
      e05KillGoldThisWave: this.e05KillGoldValue,
      e05DamageBonus: this.e05DamageBonusValue,
      e06Casts: this.e06CastCount,
      e06Echoes: this.e06EchoesValue,
      e06EchoRemainingSeconds: this.e06EchoRemaining,
      e06EchoPending: this.e06EchoPendingValue,
      ...(this.e06EchoPendingValue ? { e06EchoSlot: this.e06EchoSlot } : {}),
      e07Active: this.e07ActiveValue,
      e08Hits: this.e08HitsValue,
      e08Triggers: this.e08TriggersValue,
    };
  }

  /**
   * 从快照恢复；结构非法时重置为初始状态，避免损坏数据放大计数。
   * 正式存档已由 `run-save` 严格校验，这里只做最后一道防线。
   */
  restore(state: CoreEffectsSnapshot | undefined): void {
    this.resetRun();
    if (!validateCoreEffectsSnapshot(state)) return;

    for (const targetId of state.e01DistinctTargets) {
      this.e01Distinct.add(targetId);
    }
    this.e01ArmedValue = state.e01Armed;
    this.e01CooldownSeconds = state.e01CooldownRemaining;
    this.e02HitsValue = state.e02Hits;
    this.e02TriggersValue = state.e02Triggers;
    this.e03UsedThisWaveValue = state.e03UsedThisWave;
    this.e03UsedThisRunValue = state.e03UsedThisRun;
    // E05–E08 字段在旧存档中缺省，按 0/false 恢复。
    this.e05KillGoldValue = state.e05KillGoldThisWave ?? 0;
    this.e05DamageBonusValue = state.e05DamageBonus ?? 0;
    this.e06CastCount = state.e06Casts ?? 0;
    this.e06EchoesValue = state.e06Echoes ?? 0;
    this.e06EchoRemaining = state.e06EchoRemainingSeconds ?? 0;
    this.e06EchoPendingValue = state.e06EchoPending ?? false;
    this.e06EchoSlot = this.e06EchoPendingValue ? (state.e06EchoSlot ?? 'U') : '';
    this.e07ActiveValue = state.e07Active ?? false;
    this.e08HitsValue = state.e08Hits ?? 0;
    this.e08TriggersValue = state.e08Triggers ?? 0;
  }
}
