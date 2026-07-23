import assert from "node:assert/strict";
import test from "node:test";
import {
  activeCombatEventsAtTime,
  combatEventEndTime,
  combatEventProgress,
  combatUnitPresentationAnchor,
  projectCombatEventAtTime,
  sampleLinearCombatClock,
} from "../app/combat-playback.ts";

function sample(
  overrides: Partial<Parameters<typeof sampleLinearCombatClock>[0]> = {},
) {
  return sampleLinearCombatClock({
    startTime: 0,
    endTime: 1,
    remainingDuration: 1,
    elapsedWallTime: 0,
    speed: 1,
    ...overrides,
  });
}

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to equal ${expected}`);
}

test("event interval end and progress come only from timestamp plus duration", () => {
  const event = { id: "attack", timestamp: 4.1, durationSeconds: 2.5 };

  assertClose(combatEventEndTime(event), 6.6);
  assert.equal(combatEventProgress(event, 4), 0);
  assert.equal(combatEventProgress(event, 4.1), 0);
  assertClose(combatEventProgress(event, 5.35), 0.5);
  assert.equal(combatEventProgress(event, 6.6), 1);
  assert.equal(combatEventProgress(event, 8), 1);
});

test("event projection uses exact half-open interval boundaries", () => {
  const first = { id: "first", timestamp: 1, durationSeconds: 1 };
  const second = { id: "second", timestamp: 2, durationSeconds: 1 };

  assert.deepEqual(projectCombatEventAtTime(first, 0.999), {
    event: first,
    startTime: 1,
    endTime: 2,
    progress: 0,
    active: false,
  });
  assert.deepEqual(projectCombatEventAtTime(first, 1), {
    event: first,
    startTime: 1,
    endTime: 2,
    progress: 0,
    active: true,
  });
  assert.deepEqual(projectCombatEventAtTime(first, 2), {
    event: first,
    startTime: 1,
    endTime: 2,
    progress: 1,
    active: false,
  });
  assert.deepEqual(
    activeCombatEventsAtTime([first, second], 2).map((event) => ({
      id: event.id,
      progress: combatEventProgress(event, 2),
    })),
    [{ id: "second", progress: 0 }],
  );
});

test("millisecond-authored intervals end exactly despite binary floating-point addition", () => {
  const move = { id: "move", timestamp: 3.572, durationSeconds: 3.571 };
  const shadowstep = { id: "shadowstep", timestamp: 6.13, durationSeconds: 1.8 };

  assert.equal(combatEventEndTime(move), 7.143);
  assert.equal(combatEventProgress(move, 7.143), 1);
  assert.equal(projectCombatEventAtTime(move, 7.143).active, false);
  assert.equal(combatEventEndTime(shadowstep), 7.93);
  assert.equal(combatEventProgress(shadowstep, 7.93), 1);
  assert.equal(projectCombatEventAtTime(shadowstep, 7.93).active, false);
});

test("active projection preserves every overlapping authoritative interval", () => {
  const attack = { id: "attack", timestamp: 1, durationSeconds: 2 };
  const move = { id: "move", timestamp: 2, durationSeconds: 2 };
  const future = { id: "future", timestamp: 4, durationSeconds: 1 };

  assert.deepEqual(
    activeCombatEventsAtTime([attack, move, future], 2.5).map((event) => ({
      id: event.id,
      progress: combatEventProgress(event, 2.5),
    })),
    [
      { id: "attack", progress: 0.75 },
      { id: "move", progress: 0.25 },
    ],
  );
  assert.deepEqual(
    activeCombatEventsAtTime([attack, move, future], 3).map((event) => ({
      id: event.id,
      progress: combatEventProgress(event, 3),
    })),
    [{ id: "move", progress: 0.5 }],
  );
});

test("presentation anchor switches at movement start and persists at its exact end", () => {
  const move = {
    timestamp: 2,
    durationSeconds: 3,
    actorId: "mover",
    fromPosition: 40,
    toPosition: 32,
  };

  assert.equal(combatUnitPresentationAnchor([move], "mover", 1.999, 40), 40);
  assert.equal(combatUnitPresentationAnchor([move], "mover", 2, 40), 32);
  assert.equal(combatUnitPresentationAnchor([move], "mover", 4.999, 40), 32);
  assert.equal(combatUnitPresentationAnchor([move], "mover", 5, 40), 32);
  assert.equal(combatUnitPresentationAnchor([move], "mover", 9, 40), 32);
});

test("presentation anchor uses the latest started move without anticipating future moves", () => {
  const events = [
    { timestamp: 8, actorId: "mover", toPosition: 16 },
    { timestamp: 1, actorId: "mover", toPosition: 32 },
    { timestamp: 4, actorId: "other", toPosition: 7 },
    { timestamp: 4, actorId: "mover", toPosition: 24 },
    { timestamp: 3, actorId: "mover" },
  ];

  assert.equal(combatUnitPresentationAnchor(events, "mover", 0.999, 40), 40);
  assert.equal(combatUnitPresentationAnchor(events, "mover", 1, 40), 32);
  assert.equal(combatUnitPresentationAnchor(events, "mover", 7.999, 40), 24);
  assert.equal(combatUnitPresentationAnchor(events, "mover", 8, 40), 16);
  assert.equal(combatUnitPresentationAnchor(events, "missing", 8, null), null);
});

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

test("pause and speed changes preserve event projection on the same timeline", () => {
  const event = { id: "cast", timestamp: 4.1, durationSeconds: 2.5 };
  const endTime = combatEventEndTime(event);
  const beforePause = sampleLinearCombatClock({
    startTime: event.timestamp,
    endTime,
    remainingDuration: event.durationSeconds,
    elapsedWallTime: 0.625,
    speed: 1,
  });
  const whilePaused = sampleLinearCombatClock({
    startTime: event.timestamp,
    endTime,
    remainingDuration: beforePause.remainingDuration,
    elapsedWallTime: 0,
    speed: 1,
  });
  const afterResumeAtTwoX = sampleLinearCombatClock({
    startTime: event.timestamp,
    endTime,
    remainingDuration: whilePaused.remainingDuration,
    elapsedWallTime: 0.3125,
    speed: 2,
  });

  assertClose(beforePause.time, 4.725);
  assertClose(projectCombatEventAtTime(event, beforePause.time).progress, 0.25);
  assertClose(whilePaused.time, beforePause.time);
  assertClose(projectCombatEventAtTime(event, whilePaused.time).progress, 0.25);
  assertClose(afterResumeAtTwoX.time, 5.35);
  assertClose(projectCombatEventAtTime(event, afterResumeAtTwoX.time).progress, 0.5);
});

test("clock reaches the exact authoritative event boundary at every speed", () => {
  const event = { id: "move", timestamp: 4.1, durationSeconds: 2.5 };
  const endTime = combatEventEndTime(event);

  for (const speed of [0.5, 1, 2]) {
    const complete = sampleLinearCombatClock({
      startTime: event.timestamp,
      endTime,
      remainingDuration: event.durationSeconds,
      elapsedWallTime: event.durationSeconds / speed,
      speed,
    });

    assertClose(complete.time, endTime);
    assert.equal(complete.remainingDuration, 0);
    assert.equal(complete.progress, 1);
    assert.equal(projectCombatEventAtTime(event, complete.time).active, false);
  }
});

test("equal combat tenths take equal wall-clock time wherever they occur", () => {
  for (const startTime of [4.1, 5.6]) {
    for (const elapsedWallTime of [0, 0.025, 0.05, 0.075, 0.1]) {
      const current = sample({
        startTime,
        endTime: startTime + 0.1,
        remainingDuration: 0.1,
        elapsedWallTime,
      });

      assertClose(current.time, startTime + elapsedWallTime);
      assertClose(current.remainingDuration, 0.1 - elapsedWallTime);
    }
  }
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
    remainingDuration: 2,
    elapsedWallTime: 0.4,
  });
  const reanchoredAtTwoX = sample({
    endTime: 2,
    remainingDuration: atOneX.remainingDuration,
    elapsedWallTime: 0,
    speed: 2,
  });
  const atTwoX = sample({
    endTime: 2,
    remainingDuration: reanchoredAtTwoX.remainingDuration,
    elapsedWallTime: 0.25,
    speed: 2,
  });
  const reanchoredAtHalfX = sample({
    endTime: 2,
    remainingDuration: atTwoX.remainingDuration,
    elapsedWallTime: 0,
    speed: 0.5,
  });
  const atHalfX = sample({
    endTime: 2,
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
    remainingDuration: 0.025,
    elapsedWallTime: 0.0125,
  });
  const complete = sample({
    startTime: 1,
    endTime: 1.025,
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
    remainingDuration: Number.NaN,
    elapsedWallTime: Number.NaN,
    speed: Number.NaN,
  });

  assertClose(anchored.time, 0.4);
  assertClose(anchored.remainingDuration, 0.6);
  assert.deepEqual(invalid, { time: 0, remainingDuration: 0, progress: 1 });
});
