/**
 * 统一触发闸门（纯逻辑，不依赖 Phaser）。
 *
 * 规则来源 `docs/design/v0.2/01-systems-and-balance.md` §数值初值与上限、
 * `docs/design/v0.2/02-content-catalog.md` 各触发条目：
 * - 按规则 ID 统一管理冷却、每波次数、每局次数与每秒全局上限；
 * - 达到任一上限时 `tryTrigger` 直接返回拒绝，调用方跳过本次效果；
 * - 波次结束只重置每波计数；换局重置全部计数与冷却；
 * - 冷却以剩余秒数随 V2 快照保存与恢复，不保存绝对时间。
 *
 * 每秒上限按“规则全局”统计：同一规则在一秒窗口内跨所有目标合计最多 N 次，
 * 对应 H07「每秒全局最多 2 次」一类文案。窗口按逻辑秒推进，不读渲染帧。
 */

/** 每秒窗口长度；固定为 1 秒。 */
export const TRIGGER_WINDOW_SECONDS = 1;

/** 浮点容差：冷却与窗口边界都按该精度归零。 */
const TIME_EPSILON = 1e-9;

export interface TriggerGateRule {
  readonly id: string;
  /** 触发后进入的冷却秒数；缺省表示无冷却。 */
  readonly cooldownSeconds?: number;
  /** 每波最多触发次数；缺省表示不限。 */
  readonly perWave?: number;
  /** 每局最多触发次数；缺省表示不限。 */
  readonly perRun?: number;
  /** 每秒全局最多触发次数（同一规则跨所有目标）；缺省表示不限。 */
  readonly perSecond?: number;
}

export type TriggerDeniedReason =
  | 'cooldown'
  | 'per-wave'
  | 'per-run'
  | 'per-second'
  | 'unknown-rule';

export interface TriggerDecision {
  readonly allowed: boolean;
  readonly ruleId: string;
  /** 拒绝原因；允许时为 undefined。 */
  readonly reason?: TriggerDeniedReason;
  readonly remainingCooldownSeconds: number;
  readonly waveCount: number;
  readonly runCount: number;
  /** 当前 1 秒窗口内已触发次数。 */
  readonly secondCount: number;
}

export interface TriggerGateRuleSnapshot {
  readonly id: string;
  readonly cooldownRemainingSeconds: number;
  readonly waveCount: number;
  readonly runCount: number;
}

/** 随 V2 续局快照保存的闸门状态；只含剩余冷却与计数。 */
export interface TriggerGateSnapshot {
  readonly rules: readonly TriggerGateRuleSnapshot[];
}

interface RuleState {
  readonly rule: TriggerGateRule;
  cooldownRemaining: number;
  waveCount: number;
  runCount: number;
  /** 最近一次触发时的逻辑秒；用于 1 秒窗口。 */
  triggerTimes: number[];
}

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** 校验并复制一条规则；非法配置直接抛错，避免静默忽略上限。 */
function normalizeRule(rule: TriggerGateRule): TriggerGateRule {
  if (typeof rule !== 'object' || rule === null) {
    throw new Error('TriggerGate rule must be an object');
  }
  if (typeof rule.id !== 'string' || rule.id.length === 0) {
    throw new Error('TriggerGate rule id must be a non-empty string');
  }
  if (
    rule.cooldownSeconds !== undefined &&
    !isNonNegativeNumber(rule.cooldownSeconds)
  ) {
    throw new Error(`TriggerGate rule ${rule.id} has invalid cooldownSeconds`);
  }
  if (rule.perWave !== undefined && !isPositiveInteger(rule.perWave)) {
    throw new Error(`TriggerGate rule ${rule.id} has invalid perWave`);
  }
  if (rule.perRun !== undefined && !isPositiveInteger(rule.perRun)) {
    throw new Error(`TriggerGate rule ${rule.id} has invalid perRun`);
  }
  if (rule.perSecond !== undefined && !isPositiveInteger(rule.perSecond)) {
    throw new Error(`TriggerGate rule ${rule.id} has invalid perSecond`);
  }
  return {
    id: rule.id,
    ...(rule.cooldownSeconds !== undefined
      ? { cooldownSeconds: rule.cooldownSeconds }
      : {}),
    ...(rule.perWave !== undefined ? { perWave: rule.perWave } : {}),
    ...(rule.perRun !== undefined ? { perRun: rule.perRun } : {}),
    ...(rule.perSecond !== undefined ? { perSecond: rule.perSecond } : {}),
  };
}

/**
 * 触发闸门：所有触发型效果在真正生效前调用 `tryTrigger(ruleId)`。
 * 返回 `allowed=false` 时调用方必须跳过本次效果，不得自行重试或绕过。
 */
export class TriggerGate {
  private readonly states = new Map<string, RuleState>();
  private elapsed = 0;

  constructor(rules: readonly TriggerGateRule[] = []) {
    for (const rule of rules) this.registerRule(rule);
  }

  get ruleIds(): readonly string[] {
    return [...this.states.keys()];
  }

  /** 运行期注册规则（后续故事按效果落地时调用）；重复 ID 抛错。 */
  registerRule(rule: TriggerGateRule): void {
    const normalized = normalizeRule(rule);
    if (this.states.has(normalized.id)) {
      throw new Error(`TriggerGate rule ${normalized.id} already registered`);
    }
    this.states.set(normalized.id, {
      rule: normalized,
      cooldownRemaining: 0,
      waveCount: 0,
      runCount: 0,
      triggerTimes: [],
    });
  }

  hasRule(ruleId: string): boolean {
    return this.states.has(ruleId);
  }

  /** 推进逻辑时钟：衰减冷却并清理过期窗口记录。 */
  step(seconds: number): void {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return;
    this.elapsed += seconds;

    for (const state of this.states.values()) {
      if (state.cooldownRemaining > 0) {
        state.cooldownRemaining -= seconds;
        if (state.cooldownRemaining <= TIME_EPSILON) state.cooldownRemaining = 0;
      }
      this.pruneWindow(state);
    }
  }

  /** 只检查不消费；用于预览或界面提示。 */
  canTrigger(ruleId: string): TriggerDecision {
    return this.evaluate(ruleId);
  }

  /**
   * 尝试触发：允许时消费次数并进入冷却；超限直接拒绝，不改任何计数。
   * 检查顺序固定为 冷却 → 每波 → 每局 → 每秒，便于日志与测试定位原因。
   */
  tryTrigger(ruleId: string): TriggerDecision {
    const decision = this.evaluate(ruleId);
    if (!decision.allowed) return decision;

    const state = this.states.get(ruleId);
    if (!state) return decision;

    state.waveCount += 1;
    state.runCount += 1;
    if (state.rule.cooldownSeconds !== undefined) {
      state.cooldownRemaining = state.rule.cooldownSeconds;
    }
    state.triggerTimes.push(this.elapsed);
    if (state.triggerTimes.length > 64) state.triggerTimes.shift();

    // 成功消费后不能再走 evaluate：达到每波/每局上限的那一次本身是允许的。
    return {
      allowed: true,
      ruleId,
      remainingCooldownSeconds: state.cooldownRemaining,
      waveCount: state.waveCount,
      runCount: state.runCount,
      secondCount: this.countWindow(state),
    };
  }

  /** 波次结束：重置每波计数；冷却与每局计数保持不变。 */
  endWave(): void {
    for (const state of this.states.values()) {
      state.waveCount = 0;
      this.pruneWindow(state);
    }
  }

  /** 换局：重置全部计数、冷却与逻辑时钟。 */
  resetRun(): void {
    this.elapsed = 0;
    for (const state of this.states.values()) {
      state.cooldownRemaining = 0;
      state.waveCount = 0;
      state.runCount = 0;
      state.triggerTimes = [];
    }
  }

  /** 只读状态；冷却按剩余秒数输出，随 V2 快照保存。 */
  snapshot(): TriggerGateSnapshot {
    return {
      rules: [...this.states.values()].map((state) => ({
        id: state.rule.id,
        cooldownRemainingSeconds: state.cooldownRemaining,
        waveCount: state.waveCount,
        runCount: state.runCount,
      })),
    };
  }

  /**
   * 恢复快照：已知规则按保存值恢复，未知规则忽略，缺失规则归零。
   * 非法数值按 0 处理，保证损坏存档不会卡住本章节之后的触发。
   */
  restore(snapshot: TriggerGateSnapshot | undefined | null): void {
    const restored = new Map<string, TriggerGateRuleSnapshot>();
    if (snapshot && Array.isArray(snapshot.rules)) {
      for (const entry of snapshot.rules) {
        if (!entry || typeof entry.id !== 'string') continue;
        if (restored.has(entry.id)) continue;
        restored.set(entry.id, entry);
      }
    }

    for (const state of this.states.values()) {
      const saved = restored.get(state.rule.id);
      state.cooldownRemaining =
        saved && isNonNegativeNumber(saved.cooldownRemainingSeconds)
          ? saved.cooldownRemainingSeconds
          : 0;
      state.waveCount =
        saved && isNonNegativeInteger(saved.waveCount) ? saved.waveCount : 0;
      state.runCount =
        saved && isNonNegativeInteger(saved.runCount) ? saved.runCount : 0;
      state.triggerTimes = [];
    }
  }

  private evaluate(ruleId: string): TriggerDecision {
    const state = this.states.get(ruleId);
    if (!state) {
      return {
        allowed: false,
        ruleId,
        reason: 'unknown-rule',
        remainingCooldownSeconds: 0,
        waveCount: 0,
        runCount: 0,
        secondCount: 0,
      };
    }

    const secondCount = this.countWindow(state);
    const base = {
      ruleId,
      remainingCooldownSeconds: state.cooldownRemaining,
      waveCount: state.waveCount,
      runCount: state.runCount,
      secondCount,
    } as const;

    if (state.cooldownRemaining > TIME_EPSILON) {
      return { ...base, allowed: false, reason: 'cooldown' };
    }
    if (state.rule.perWave !== undefined && state.waveCount >= state.rule.perWave) {
      return { ...base, allowed: false, reason: 'per-wave' };
    }
    if (state.rule.perRun !== undefined && state.runCount >= state.rule.perRun) {
      return { ...base, allowed: false, reason: 'per-run' };
    }
    if (
      state.rule.perSecond !== undefined &&
      secondCount >= state.rule.perSecond
    ) {
      return { ...base, allowed: false, reason: 'per-second' };
    }
    return { ...base, allowed: true };
  }

  private countWindow(state: RuleState): number {
    const cutoff = this.elapsed - TRIGGER_WINDOW_SECONDS + TIME_EPSILON;
    let count = 0;
    for (const timestamp of state.triggerTimes) {
      if (timestamp > cutoff) count += 1;
    }
    return count;
  }

  private pruneWindow(state: RuleState): void {
    const cutoff = this.elapsed - TRIGGER_WINDOW_SECONDS + TIME_EPSILON;
    state.triggerTimes = state.triggerTimes.filter(
      (timestamp) => timestamp > cutoff,
    );
  }
}

/**
 * 结构校验：续局快照只接受合法字段，未知规则由 `restore` 忽略。
 * 返回复制后的值，非法时返回 null。
 */
export function validateTriggerGateSnapshot(
  value: unknown,
): TriggerGateSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.rules)) return null;

  const rules: TriggerGateRuleSnapshot[] = [];
  const seen = new Set<string>();
  for (const entry of record.rules) {
    if (typeof entry !== 'object' || entry === null) return null;
    const rule = entry as Record<string, unknown>;
    if (typeof rule.id !== 'string' || rule.id.length === 0) return null;
    if (seen.has(rule.id)) return null;
    if (!isNonNegativeNumber(rule.cooldownRemainingSeconds)) return null;
    if (!isNonNegativeInteger(rule.waveCount)) return null;
    if (!isNonNegativeInteger(rule.runCount)) return null;
    seen.add(rule.id);
    rules.push({
      id: rule.id,
      cooldownRemainingSeconds: rule.cooldownRemainingSeconds,
      waveCount: rule.waveCount,
      runCount: rule.runCount,
    });
  }
  return { rules };
}
