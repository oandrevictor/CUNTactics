import assert from "node:assert/strict";
import test from "node:test";
import { sampleLinearCombatClock } from "../app/combat-playback.ts";

function sample(
  overrides: Partial<Parameters<typeof sampleLinearCombatClock>[0]> = {},
) {
  return sampleLinearCombatClock({
    startTime: 0,
    endTime: 1,
    segmentDuration: 1,
    remainingDuration: 1,
    elapsedWallTime: 0,
    speed: 1,
    ...overrides,
  });
}

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to equal ${expected}`);
}

test("combat clock advances linearly between discrete action timestamps", () => {
  assert.deepEqual(sample({ elapsedWallTime: 0.25 }), {
    time: 0.25,
    remainingDuration: 0.75,
    progress: 0.25,
  });
  assert.deepEqual(sample({ elapsedWallTime: 0.75 }), {
    time: 0.75,
    remainingDuration: 0.25,
    progress: 0.75,
  });
});

test("pause and resume preserve the exact fractional combat time", () => {
  const beforePause = sample({ elapsedWallTime: 0.375 });
  const whilePaused = sample({
    remainingDuration: beforePause.remainingDuration,
    elapsedWallTime: 0,
  });
  const afterResume = sample({
    remainingDuration: whilePaused.remainingDuration,
    elapsedWallTime: 0.125,
  });

  assertClose(beforePause.time, 0.375);
  assertClose(whilePaused.time, 0.375);
  assertClose(afterResume.time, 0.5);
});

test("speed changes re-anchor without a jump and scale only future time", () => {
  const atOneX = sample({
    endTime: 2,
    segmentDuration: 2,
    remainingDuration: 2,
    elapsedWallTime: 0.4,
  });
  const reanchoredAtTwoX = sample({
    endTime: 2,
    segmentDuration: 2,
    remainingDuration: atOneX.remainingDuration,
    elapsedWallTime: 0,
    speed: 2,
  });
  const atTwoX = sample({
    endTime: 2,
    segmentDuration: 2,
    remainingDuration: reanchoredAtTwoX.remainingDuration,
    elapsedWallTime: 0.25,
    speed: 2,
  });
  const reanchoredAtHalfX = sample({
    endTime: 2,
    segmentDuration: 2,
    remainingDuration: atTwoX.remainingDuration,
    elapsedWallTime: 0,
    speed: 0.5,
  });
  const atHalfX = sample({
    endTime: 2,
    segmentDuration: 2,
    remainingDuration: reanchoredAtHalfX.remainingDuration,
    elapsedWallTime: 0.4,
    speed: 0.5,
  });

  assertClose(atOneX.time, 0.4);
  assertClose(reanchoredAtTwoX.time, 0.4);
  assertClose(atTwoX.time, 0.9);
  assertClose(reanchoredAtHalfX.time, 0.9);
  assertClose(atHalfX.time, 1.1);
});

test("short real gaps remain linear and overshoot clamps to the exact endpoint", () => {
  const halfway = sample({
    startTime: 1,
    endTime: 1.025,
    segmentDuration: 0.025,
    remainingDuration: 0.025,
    elapsedWallTime: 0.0125,
  });
  const complete = sample({
    startTime: 1,
    endTime: 1.025,
    segmentDuration: 0.025,
    remainingDuration: 0.025,
    elapsedWallTime: 1,
    speed: 2,
  });

  assertClose(halfway.time, 1.0125);
  assertClose(halfway.remainingDuration, 0.0125);
  assertClose(complete.time, 1.025);
  assert.equal(complete.remainingDuration, 0);
  assert.equal(complete.progress, 1);
});

test("invalid or backwards wall-clock samples never rewind the timeline", () => {
  const anchored = sample({ remainingDuration: 0.6, elapsedWallTime: -1 });
  const invalid = sample({
    startTime: Number.NaN,
    endTime: Number.NaN,
    segmentDuration: Number.NaN,
    remainingDuration: Number.NaN,
    elapsedWallTime: Number.NaN,
    speed: Number.NaN,
  });

  assertClose(anchored.time, 0.4);
  assertClose(anchored.remainingDuration, 0.6);
  assert.deepEqual(invalid, { time: 0, remainingDuration: 0, progress: 1 });
});
