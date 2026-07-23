import type { CombatEvent } from "./game-engine";

export interface LinearCombatClockInput {
  startTime: number;
  endTime: number;
  remainingDuration: number;
  elapsedWallTime: number;
  speed: number;
}

export interface LinearCombatClockSample {
  time: number;
  remainingDuration: number;
  progress: number;
}

export type TimedCombatEvent = Pick<CombatEvent, "timestamp" | "durationSeconds">;

export type PositionedCombatEvent = Pick<
  CombatEvent,
  "timestamp" | "actorId" | "toPosition"
>;

export interface CombatEventTimelineProjection<T extends TimedCombatEvent = TimedCombatEvent> {
  event: T;
  startTime: number;
  endTime: number;
  progress: number;
  active: boolean;
}

const COMBAT_TIME_PRECISION = 1000;

function roundCombatTime(value: number): number {
  return Math.round(value * COMBAT_TIME_PRECISION) / COMBAT_TIME_PRECISION;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function combatEventStartTime(event: TimedCombatEvent): number {
  return Math.max(0, finiteOr(event.timestamp, 0));
}

function combatEventDuration(event: TimedCombatEvent): number {
  return Math.max(0, finiteOr(event.durationSeconds, 0));
}

/** Returns the authoritative end of an event's half-open [start, end) interval. */
export function combatEventEndTime(event: TimedCombatEvent): number {
  return roundCombatTime(combatEventStartTime(event) + combatEventDuration(event));
}

/** Projects an event's clamped progress from the authoritative combat clock. */
export function combatEventProgress(
  event: TimedCombatEvent,
  combatTime: number,
): number {
  const startTime = combatEventStartTime(event);
  const endTime = combatEventEndTime(event);
  const durationSeconds = Math.max(0, endTime - startTime);
  const currentTime = Math.max(0, finiteOr(combatTime, 0));
  if (currentTime >= endTime) return 1;
  if (durationSeconds === 0) return currentTime >= startTime ? 1 : 0;
  return Math.min(1, Math.max(0, (currentTime - startTime) / durationSeconds));
}

/**
 * Projects one event without retaining visual timers. Events are active at
 * their exact start and inactive at their exact end so touching intervals do
 * not render for an extra frame.
 */
export function projectCombatEventAtTime<T extends TimedCombatEvent>(
  event: T,
  combatTime: number,
): CombatEventTimelineProjection<T> {
  const startTime = combatEventStartTime(event);
  const endTime = combatEventEndTime(event);
  const currentTime = Math.max(0, finiteOr(combatTime, 0));

  return {
    event,
    startTime,
    endTime,
    progress: combatEventProgress(event, currentTime),
    active: currentTime >= startTime && currentTime < endTime,
  };
}

/** Returns the original events whose authoritative intervals contain combatTime. */
export function activeCombatEventsAtTime<T extends TimedCombatEvent>(
  events: readonly T[],
  combatTime: number,
): T[] {
  return events
    .filter((event) => projectCombatEventAtTime(event, combatTime).active);
}

/**
 * Returns the board cell that should host a unit's rendered token. Movement is
 * drawn back from this destination with fromPosition, so the presentation
 * anchor changes at the exact event start and remains there after the interval
 * ends. A later move takes over only once its own timestamp is reached.
 */
export function combatUnitPresentationAnchor(
  events: readonly PositionedCombatEvent[],
  unitId: string,
  combatTime: number,
  fallbackPosition: number | null,
): number | null {
  const currentTime = Math.max(0, finiteOr(combatTime, 0));
  let anchorPosition = fallbackPosition;
  let anchorTimestamp = -Infinity;

  for (const event of events) {
    if (
      event.actorId !== unitId
      || typeof event.toPosition !== "number"
      || !Number.isFinite(event.toPosition)
    ) {
      continue;
    }
    const eventTimestamp = combatEventStartTime(event);
    if (eventTimestamp > currentTime || eventTimestamp < anchorTimestamp) continue;
    anchorPosition = event.toPosition;
    anchorTimestamp = eventTimestamp;
  }

  return anchorPosition;
}

/**
 * Samples a combat segment without tying the timeline to render frames.
 * The caller can pause or change speed by retaining remainingDuration and
 * beginning a new sample window; time will resume from the exact same point.
 */
export function sampleLinearCombatClock(input: LinearCombatClockInput): LinearCombatClockSample {
  const startTime = Math.max(0, finiteOr(input.startTime, 0));
  const endTime = Math.max(startTime, finiteOr(input.endTime, startTime));
  const segmentDuration = endTime - startTime;
  const initialRemaining = Math.min(
    segmentDuration,
    Math.max(0, finiteOr(input.remainingDuration, segmentDuration)),
  );
  const elapsedTimelineTime = Math.max(0, finiteOr(input.elapsedWallTime, 0))
    * Math.max(0, finiteOr(input.speed, 1));
  const remainingDuration = Math.max(0, initialRemaining - elapsedTimelineTime);
  const progress = segmentDuration > 0
    ? Math.min(1, Math.max(0, (segmentDuration - remainingDuration) / segmentDuration))
    : 1;

  return {
    time: startTime + (endTime - startTime) * progress,
    remainingDuration,
    progress,
  };
}
