import { describe, expect, it, vi } from 'vitest';
import {
  FIXED_STEP_SECONDS,
  FixedStepLoop,
  MAX_FRAME_DELTA_SECONDS,
  MAX_STEPS_PER_FRAME,
} from '../src/game/loop';

function createLoop(
  options: Partial<ConstructorParameters<typeof FixedStepLoop>[0]> = {},
): { loop: FixedStepLoop; onStep: ReturnType<typeof vi.fn> } {
  const onStep = vi.fn();
  const loop = new FixedStepLoop({ onStep, ...options });
  return { loop, onStep };
}

describe('fixed step loop', () => {
  it('exposes a 60 Hz step and bounded catch-up defaults', () => {
    expect(FIXED_STEP_SECONDS).toBe(1 / 60);
    expect(MAX_FRAME_DELTA_SECONDS).toBe(0.25);
    expect(MAX_STEPS_PER_FRAME).toBe(5);
  });

  it('accumulates frame time into fixed steps (100 x 10ms -> 60 steps)', () => {
    const { loop, onStep } = createLoop();
    let totalSteps = 0;
    for (let frame = 0; frame < 100; frame += 1) {
      totalSteps += loop.advance(0.01).steps;
    }

    expect(totalSteps).toBe(60);
    expect(onStep).toHaveBeenCalledTimes(60);
    for (const call of onStep.mock.calls) {
      expect(call[0]).toBe(FIXED_STEP_SECONDS);
    }
  });

  it('is independent of render frame rate', () => {
    const sixtyHertz = createLoop();
    const oneTwentyHertz = createLoop();

    for (let frame = 0; frame < 60; frame += 1) {
      sixtyHertz.loop.advance(1 / 60);
    }
    for (let frame = 0; frame < 120; frame += 1) {
      oneTwentyHertz.loop.advance(1 / 120);
    }

    expect(sixtyHertz.onStep).toHaveBeenCalledTimes(60);
    expect(oneTwentyHertz.onStep).toHaveBeenCalledTimes(60);
    expect(sixtyHertz.loop.accumulatorSeconds).toBeCloseTo(0, 9);
    expect(oneTwentyHertz.loop.accumulatorSeconds).toBeCloseTo(0, 9);
  });

  it('caps catch-up steps per frame after a long stall', () => {
    const { loop, onStep } = createLoop();

    const result = loop.advance(0.1);

    expect(result.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(result.steppedSeconds).toBeCloseTo(MAX_STEPS_PER_FRAME * FIXED_STEP_SECONDS, 9);
    expect(onStep).toHaveBeenCalledTimes(MAX_STEPS_PER_FRAME);
    expect(loop.accumulatorSeconds).toBeLessThanOrEqual(
      MAX_STEPS_PER_FRAME * FIXED_STEP_SECONDS + 1e-9,
    );
  });

  it('clamps an oversized frame delta and reports dropped time', () => {
    const { loop } = createLoop();

    const result = loop.advance(5);

    expect(result.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(result.droppedSeconds).toBeGreaterThan(4);
    expect(result.accumulatorSeconds).toBeLessThanOrEqual(
      MAX_STEPS_PER_FRAME * FIXED_STEP_SECONDS + 1e-9,
    );
  });

  it('keeps sub-step time as an accumulator until it adds up', () => {
    const { loop, onStep } = createLoop();

    const first = loop.advance(0.01);
    expect(first.steps).toBe(0);
    expect(first.accumulatorSeconds).toBeCloseTo(0.01, 9);

    const second = loop.advance(0.01);
    expect(second.steps).toBe(1);
    expect(second.accumulatorSeconds).toBeCloseTo(0.003333, 6);
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it('ignores negative, NaN and infinite deltas', () => {
    const { loop, onStep } = createLoop();

    expect(loop.advance(-1).steps).toBe(0);
    expect(loop.advance(Number.NaN).steps).toBe(0);
    expect(loop.advance(Number.POSITIVE_INFINITY).steps).toBe(0);
    expect(onStep).not.toHaveBeenCalled();
    expect(loop.accumulatorSeconds).toBe(0);
  });

  it('resets the accumulator without changing the step size', () => {
    const { loop } = createLoop();
    loop.advance(0.01);

    loop.reset();

    expect(loop.accumulatorSeconds).toBe(0);
    expect(loop.stepSeconds).toBe(FIXED_STEP_SECONDS);
  });

  it('rejects invalid loop options', () => {
    expect(() => new FixedStepLoop({ stepSeconds: 0, onStep: vi.fn() })).toThrow(/stepSeconds/);
    expect(
      () => new FixedStepLoop({ maxFrameDeltaSeconds: -1, onStep: vi.fn() }),
    ).toThrow(/maxFrameDeltaSeconds/);
    expect(() => new FixedStepLoop({ maxStepsPerFrame: 0, onStep: vi.fn() })).toThrow(
      /maxStepsPerFrame/,
    );
  });
});
