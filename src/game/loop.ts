/**
 * 固定步长逻辑循环（纯逻辑，不依赖 Phaser）。
 *
 * 渲染帧长变化不影响规则推进：每个逻辑步长恒为 FIXED_STEP_SECONDS，所有冷却、
 * 攻击间隔与持续效果都按步长秒数累计，不按帧数计时。单帧真实时间先被钳制，
 * 再限制单帧最多执行的逻辑步数，避免卡顿后无限追帧。
 */

/** 逻辑步长：60 Hz。 */
export const FIXED_STEP_SECONDS = 1 / 60;

/** 单帧最多消化的真实时间；切后台或长卡顿后的超大 delta 会被截断。 */
export const MAX_FRAME_DELTA_SECONDS = 0.25;

/** 单帧最多执行的逻辑步数（追帧上限）。 */
export const MAX_STEPS_PER_FRAME = 5;

const FLOAT_EPSILON = 1e-9;

export interface FixedStepLoopOptions {
  /** 逻辑步长，默认 1/60 秒。 */
  stepSeconds?: number;
  /** 单帧真实时间上限，默认 0.25 秒。 */
  maxFrameDeltaSeconds?: number;
  /** 单帧追帧上限，默认 5 步。 */
  maxStepsPerFrame?: number;
  /** 每个逻辑步长调用一次；参数恒为 stepSeconds。 */
  onStep: (stepSeconds: number) => void;
}

export interface FixedStepAdvance {
  /** 本次推进执行的逻辑步数。 */
  steps: number;
  /** 本次推进实际模拟的秒数。 */
  steppedSeconds: number;
  /** 因单帧真实时间钳制与追帧上限被丢弃的秒数。 */
  droppedSeconds: number;
  /** 尚未凑满一个步长的真实时间余额。 */
  accumulatorSeconds: number;
}

export class FixedStepLoop {
  readonly stepSeconds: number;
  readonly maxFrameDeltaSeconds: number;
  readonly maxStepsPerFrame: number;

  private readonly onStep: (stepSeconds: number) => void;
  private accumulator = 0;

  constructor(options: FixedStepLoopOptions) {
    const stepSeconds = options.stepSeconds ?? FIXED_STEP_SECONDS;
    const maxFrameDeltaSeconds = options.maxFrameDeltaSeconds ?? MAX_FRAME_DELTA_SECONDS;
    const maxStepsPerFrame = options.maxStepsPerFrame ?? MAX_STEPS_PER_FRAME;

    if (!(stepSeconds > 0)) {
      throw new Error(`stepSeconds must be positive, received ${stepSeconds}`);
    }
    if (!(maxFrameDeltaSeconds > 0)) {
      throw new Error(`maxFrameDeltaSeconds must be positive, received ${maxFrameDeltaSeconds}`);
    }
    if (!Number.isInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) {
      throw new Error(`maxStepsPerFrame must be a positive integer, received ${maxStepsPerFrame}`);
    }

    this.stepSeconds = stepSeconds;
    this.maxFrameDeltaSeconds = maxFrameDeltaSeconds;
    this.maxStepsPerFrame = maxStepsPerFrame;
    this.onStep = options.onStep;
  }

  get accumulatorSeconds(): number {
    return this.accumulator;
  }

  /**
   * 推进 deltaSeconds 的真实时间。负数、NaN 与 Infinity 视为 0。
   * 返回本次执行步数与丢弃的时间，便于测试与调试。
   */
  advance(deltaSeconds: number): FixedStepAdvance {
    const safeDelta =
      Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;

    const acceptedDelta = Math.min(safeDelta, this.maxFrameDeltaSeconds);
    const clampedDelta = safeDelta - acceptedDelta;

    this.accumulator += acceptedDelta;

    const availableSteps = Math.floor(
      (this.accumulator + FLOAT_EPSILON) / this.stepSeconds,
    );
    const steps = Math.min(availableSteps, this.maxStepsPerFrame);

    for (let step = 0; step < steps; step += 1) {
      this.onStep(this.stepSeconds);
    }

    this.accumulator -= steps * this.stepSeconds;

    // 追帧上限之外的时间不再补算；保留余额仍不超过一整帧的上限。
    const maxAccumulator = this.maxStepsPerFrame * this.stepSeconds;
    let droppedSeconds = clampedDelta;
    if (this.accumulator > maxAccumulator) {
      droppedSeconds += this.accumulator - maxAccumulator;
      this.accumulator = maxAccumulator;
    }
    if (this.accumulator < 0) {
      this.accumulator = 0;
    }

    return {
      steps,
      steppedSeconds: steps * this.stepSeconds,
      droppedSeconds,
      accumulatorSeconds: this.accumulator,
    };
  }

  /** 清空未消费的时间余额（例如场景重启或从暂停恢复时）。 */
  reset(): void {
    this.accumulator = 0;
  }
}
