import type { CombatEvent } from "./game-engine";

/** The subset of a displayed unit that the procedural renderer needs. */
export interface BoitataRenderUnit {
  id: string;
  heroId: string;
  side: "player" | "enemy";
  position: number | null;
  level: number;
  hp: number;
  maxHp: number;
  fireWallShield: number;
  alive: boolean;
}

export type BoitataBodyMotionState = "idle" | "move" | "attack" | "cast" | "hit" | "death";
export type BoitataShieldMotionState = "hidden" | "active" | "cast" | "shield-hit" | "shield-break";

/**
 * All named visual states supported by the procedural renderer. Body and shield
 * states are stored separately so an impact can recoil the creature and pulse
 * its wall during the same combat beat.
 */
export type BoitataMotionState = BoitataBodyMotionState | BoitataShieldMotionState;

export interface BoitataVisualState {
  unitId: string;
  motion: BoitataBodyMotionState;
  isHit: boolean;
  shieldMotion: BoitataShieldMotionState;
  bodyCueKey: string;
  hitCueKey: string;
  shieldCueKey: string;
  startTime: number | null;
  durationSeconds: number;
  hitStartTime: number | null;
  hitDurationSeconds: number;
  shieldStartTime: number | null;
  shieldDurationSeconds: number;
  fromPosition: number | null;
  position: number | null;
  facingPosition: number | null;
  fireWallShield: number;
  shieldDamage: number;
  healthDamage: number;
  newlyDead: boolean;
}

export type BoitataRendererFallbackReason =
  | "webgl-unavailable"
  | "context-lost"
  | "initialization-failed"
  | "reduced-data";

export type BoitataRenderMode = "animated-3d" | "static-3d" | "fallback-image";

export interface BoitataRendererCapabilities {
  webglAvailable: boolean;
  reducedMotion?: boolean;
  saveData?: boolean;
  contextLost?: boolean;
  initializationFailed?: boolean;
}

export interface BoitataRenderDecision {
  mode: BoitataRenderMode;
  fallbackReason: BoitataRendererFallbackReason | null;
}

function snapshotUnit(event: CombatEvent | null | undefined, unitId: string) {
  return event?.snapshot.find((candidate) => candidate.id === unitId) ?? null;
}

function firstOtherTargetPosition(event: CombatEvent | null, unitId: string): number | null {
  if (!event?.targetIds?.length) return null;
  for (const targetId of event.targetIds) {
    if (targetId === unitId) continue;
    const target = snapshotUnit(event, targetId);
    if (target) return target.position;
  }
  return null;
}

function canDamageTarget(event: CombatEvent, unitId: string): boolean {
  if (!event.targetIds?.includes(unitId)) return false;
  if (event.type !== "attack" && event.type !== "ability" && event.type !== "landing") return false;
  if (event.type === "ability") {
    const actor = event.actorId ? snapshotUnit(event, event.actorId) : null;
    if (actor?.heroId === "bramble" || actor?.heroId === "tide" || actor?.heroId === "boitata") return false;
  }
  return true;
}

function damageAmountForTarget(event: CombatEvent, unitId: string): number {
  if (!canDamageTarget(event, unitId)) return 0;
  const amount = event.amounts?.[unitId]
    ?? (event.targetIds?.length === 1 ? event.amount : undefined)
    ?? 0;
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function newestEvent(
  events: readonly CombatEvent[],
  predicate: (event: CombatEvent) => boolean,
): CombatEvent | null {
  let newest: CombatEvent | null = null;
  let newestIndex = -1;
  events.forEach((event, index) => {
    if (!predicate(event)) return;
    if (
      newest === null
      || event.timestamp > newest.timestamp
      || (event.timestamp === newest.timestamp && index > newestIndex)
    ) {
      newest = event;
      newestIndex = index;
    }
  });
  return newest;
}

/**
 * Converts active combat events and post-action snapshots into deterministic
 * renderer cues.
 *
 * Damage-event metadata owns shield reactions for its full authoritative
 * interval. Snapshots remain as fallbacks for movement, health, and death. A
 * dead unit keeps the stable `death:<id>` cue across later defeat/outcome events,
 * preventing its death animation from restarting.
 */
export function deriveBoitataVisualState(
  unit: BoitataRenderUnit,
  activeEvents: readonly CombatEvent[],
  previousSnapshotEvent: CombatEvent | null = null,
): BoitataVisualState {
  const currentSnapshotEvent = activeEvents.at(-1) ?? null;
  const previousUnit = snapshotUnit(previousSnapshotEvent, unit.id);
  const currentSnapshot = snapshotUnit(currentSnapshotEvent, unit.id);
  const currentPosition = unit.position ?? currentSnapshot?.position ?? null;
  const previousPosition = previousUnit?.position ?? currentPosition;
  const snapshotHealthDamage = Math.max(0, (previousUnit?.hp ?? unit.hp) - unit.hp);
  const actorEvent = newestEvent(activeEvents, (event) =>
    event.actorId === unit.id && (event.type === "move" || event.type === "attack" || event.type === "ability"),
  );
  const shieldCastEvent = newestEvent(activeEvents, (event) =>
    event.actorId === unit.id && event.type === "ability",
  );
  const incomingDamageEvents = activeEvents.filter((event) =>
    event.actorId !== unit.id && damageAmountForTarget(event, unit.id) > 0,
  );
  const incomingDamageEvent = newestEvent(incomingDamageEvents, () => true);
  const incomingHitEvent = newestEvent(activeEvents, (event) =>
    event.actorId !== unit.id && canDamageTarget(event, unit.id),
  );
  const shieldImpactEvent = newestEvent(activeEvents, (event) =>
    event.actorId !== unit.id
      && (
        (event.fireWallAbsorbedAmounts?.[unit.id] ?? 0) > 0
        || (event.fireWallBrokenTargetIds?.includes(unit.id) ?? false)
      ),
  );
  const shieldEvent = newestEvent(activeEvents, (event) =>
    event === shieldCastEvent || event === shieldImpactEvent,
  );
  const incomingEvent = incomingDamageEvent
    ?? incomingHitEvent
    ?? newestEvent(activeEvents, (event) =>
      event.actorId !== unit.id && (event.targetIds?.includes(unit.id) ?? false),
    );
  const isTarget = activeEvents.some((event) => event.targetIds?.includes(unit.id) ?? false);
  const incomingDamage = incomingDamageEvents.reduce(
    (total, event) => total + damageAmountForTarget(event, unit.id),
    0,
  );
  const healthDamage = incomingHitEvent ? snapshotHealthDamage : 0;
  const shieldDamage = shieldImpactEvent?.fireWallAbsorbedAmounts?.[unit.id] ?? 0;
  const fireWallBroke = shieldImpactEvent?.fireWallBrokenTargetIds?.includes(unit.id) ?? false;
  const isHit = isTarget && (healthDamage > 0 || incomingDamage > 0);
  const newlyDead = !unit.alive && previousUnit?.alive !== false;
  const actorFromPosition = actorEvent?.fromPosition ?? previousPosition;
  const actorToPosition = actorEvent?.toPosition ?? currentPosition;

  let motion: BoitataBodyMotionState = "idle";
  if (!unit.alive) {
    motion = "death";
  } else if (actorEvent?.type === "ability") {
    motion = "cast";
  } else if (actorEvent?.type === "attack") {
    motion = "attack";
  } else if (actorEvent?.type === "move" && actorFromPosition !== actorToPosition) {
    motion = "move";
  } else if (isHit) {
    motion = "hit";
  }

  let shieldMotion: BoitataShieldMotionState = "hidden";
  if (shieldImpactEvent && shieldEvent === shieldImpactEvent && fireWallBroke) {
    shieldMotion = "shield-break";
  } else if (shieldImpactEvent && shieldEvent === shieldImpactEvent && shieldDamage > 0) {
    shieldMotion = "shield-hit";
  } else if (shieldCastEvent && shieldEvent === shieldCastEvent) {
    shieldMotion = "cast";
  } else if (unit.fireWallShield > 0) {
    shieldMotion = "active";
  }

  const incomingActor = incomingEvent?.actorId ? snapshotUnit(incomingEvent, incomingEvent.actorId) : null;
  const facingPosition = actorEvent
    ? firstOtherTargetPosition(actorEvent, unit.id)
    : incomingEvent
      ? incomingActor?.position ?? null
      : null;
  const bodyEvent = motion === "death"
    ? incomingEvent
    : motion === "hit"
      ? incomingEvent
      : motion === "idle"
        ? null
        : actorEvent;
  const timedShieldEvent = shieldMotion === "cast"
    || shieldMotion === "shield-hit"
    || shieldMotion === "shield-break"
    ? shieldEvent
    : null;
  const durationSeconds = Math.max(0, bodyEvent?.durationSeconds ?? 0);
  const hitDurationSeconds = Math.max(0, incomingHitEvent?.durationSeconds ?? 0);
  const shieldDurationSeconds = Math.max(0, timedShieldEvent?.durationSeconds ?? 0);

  return {
    unitId: unit.id,
    motion,
    isHit,
    shieldMotion,
    bodyCueKey: motion === "death"
      ? `death:${unit.id}`
      : motion === "idle"
        ? `idle:${unit.id}`
        : `${bodyEvent?.id ?? "rest"}:${motion}`,
    hitCueKey: incomingHitEvent ? `${incomingHitEvent.id}:hit` : `rest:${unit.id}:hit`,
    shieldCueKey: shieldMotion === "active" || shieldMotion === "hidden"
      ? `${shieldMotion}:${unit.id}`
      : `${timedShieldEvent?.id ?? "rest"}:${shieldMotion}`,
    startTime: bodyEvent?.timestamp ?? null,
    durationSeconds,
    hitStartTime: incomingHitEvent?.timestamp ?? null,
    hitDurationSeconds,
    shieldStartTime: timedShieldEvent?.timestamp ?? null,
    shieldDurationSeconds,
    fromPosition: motion === "move" ? actorFromPosition : currentPosition,
    position: motion === "move" ? actorToPosition : currentPosition,
    facingPosition,
    fireWallShield: Math.max(0, unit.fireWallShield),
    shieldDamage,
    healthDamage,
    newlyDead,
  };
}

/** Pure capability policy used by both the component and its fallback tests. */
export function chooseBoitataRenderMode(
  capabilities: BoitataRendererCapabilities,
): BoitataRenderDecision {
  if (!capabilities.webglAvailable) {
    return { mode: "fallback-image", fallbackReason: "webgl-unavailable" };
  }
  if (capabilities.contextLost) {
    return { mode: "fallback-image", fallbackReason: "context-lost" };
  }
  if (capabilities.initializationFailed) {
    return { mode: "fallback-image", fallbackReason: "initialization-failed" };
  }
  if (capabilities.saveData) {
    return { mode: "fallback-image", fallbackReason: "reduced-data" };
  }
  return {
    mode: capabilities.reducedMotion ? "static-3d" : "animated-3d",
    fallbackReason: null,
  };
}
