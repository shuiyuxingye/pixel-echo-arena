/**
 * 开发专用 E06 复施演示（纯逻辑，仅在 `?dev=1&triggerDemo=1` 时由场景调用）。
 *
 * U/I 自由技能槽尚未接入正式战斗（US-027），因此这里用独立的 `CoreEffects`
 * 实例构造 Validator 需要的证据：
 * - 第 3 次释放后 1 秒才可就绪，提前取不到复施；
 * - 复施强度固定 45%；
 * - 复施执行后不会再次排入复施，也不会累计新的释放次数。
 *
 * 演示不读写本局战斗状态，也不提供跳关或改数值入口。
 */
import {
  CoreEffects,
  E06_CASTS_REQUIRED,
  E06_ECHO_DELAY_SECONDS,
  E06_ECHO_STRENGTH,
  type CoreEffectsSnapshot,
} from './core-effects';

export interface SkillEchoDemoReport {
  readonly castsRequired: number;
  readonly echoDelaySeconds: number;
  readonly echoStrength: number;
  /** 依次模拟的技能槽；第 3 次排入复施。 */
  readonly castSlots: readonly string[];
  /** 第 3 次释放是否排入复施。 */
  readonly echoScheduled: boolean;
  /** 延迟未走完时应为 false。 */
  readonly readyBeforeDelay: boolean;
  /** 延迟走完后应为 true。 */
  readonly readyAfterDelay: boolean;
  /** 复施取的技能槽。 */
  readonly echoSlot: string | null;
  /** 复施强度实际返回值。 */
  readonly echoStrengthApplied: number;
  /** 消费后是否仍残留待执行复施（应为 false）。 */
  readonly echoStillPending: boolean;
  /** 多等 5 秒后是否又冒出复施（递归证据，应为 false）。 */
  readonly recursiveEcho: boolean;
  readonly echoesAfterConsume: number;
  readonly castsAfterEcho: number;
  readonly snapshot: CoreEffectsSnapshot;
}

/** 运行一次固定演示；结果完全由纯逻辑决定，可重复单测。 */
export function runSkillEchoDemo(): SkillEchoDemoReport {
  const effects = new CoreEffects({ hasCore: (coreId) => coreId === 'E06' });

  const castSlots = ['U', 'I', 'U'];
  let echoScheduled = false;
  for (const slot of castSlots) {
    // 前两次不排入复施；第三次返回 true。
    echoScheduled = effects.registerSkillCast(slot) || echoScheduled;
  }

  const readyBeforeDelay = effects.e06EchoReady;
  effects.step(E06_ECHO_DELAY_SECONDS - 0.01);
  const readyJustBefore = effects.e06EchoReady;
  effects.step(0.01);
  const readyAfterDelay = effects.e06EchoReady;

  const trigger = effects.consumeSkillEcho();
  const echoesAfterConsume = effects.e06Echoes;
  const echoStillPending = effects.e06EchoPending;

  // 复施执行方直接应用效果，不调用 registerSkillCast；这里再等待足够长的时间，
  // 若存在递归排入，5 秒内必然出现新的待执行复施。
  effects.step(5);
  const recursiveEcho = effects.e06EchoPending;

  return {
    castsRequired: E06_CASTS_REQUIRED,
    echoDelaySeconds: E06_ECHO_DELAY_SECONDS,
    echoStrength: E06_ECHO_STRENGTH,
    castSlots,
    echoScheduled,
    readyBeforeDelay: readyBeforeDelay || readyJustBefore,
    readyAfterDelay,
    echoSlot: trigger?.slot ?? null,
    echoStrengthApplied: trigger?.strength ?? 0,
    echoStillPending,
    recursiveEcho,
    echoesAfterConsume,
    castsAfterEcho: effects.e06Casts,
    snapshot: effects.snapshot(),
  };
}
