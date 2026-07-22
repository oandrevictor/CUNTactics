export interface LinearCombatClockInput {
  startTime: number;
  endTime: number;
  segmentDuration: number;
  remainingDuration: number;
  elapsedWallTime: number;
  speed: number;
}

export interface LinearCombatClockSample {
  time: number;
  remainingDuration: number;
  progress: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Samples a combat segment without tying the timeline to render frames.
 * The caller can pause or change speed by retaining remainingDuration and
 * beginning a new sample window; time will resume from the exact same point.
 */
export function sampleLinearCombatClock(input: LinearCombatClockInput): LinearCombatClockSample {
  const startTime = Math.max(0, finiteOr(input.startTime, 0));
  const endTime = Math.max(startTime, finiteOr(input.endTime, startTime));
  const segmentDuration = Math.max(0, finiteOr(input.segmentDuration, 0));
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
