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
  shieldCueKey: string;
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

function damageAmountForTarget(event: CombatEvent, unitId: string): number {
  if (!event.targetIds?.includes(unitId)) return 0;
  if (event.type !== "attack" && event.type !== "ability" && event.type !== "landing") return 0;
  if (event.type === "ability") {
    const actor = event.actorId ? snapshotUnit(event, event.actorId) : null;
    if (actor?.heroId === "bramble" || actor?.heroId === "tide" || actor?.heroId === "boitata") return 0;
  }
  const amount = event.amounts?.[unitId]
    ?? (event.targetIds.length === 1 ? event.amount : undefined)
    ?? 0;
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

/**
 * Converts post-action combat snapshots into deterministic renderer cues.
 *
 * The game records snapshots after each action, so damage and movement are
 * derived by comparing the current displayed unit with the preceding event.
 * A dead unit keeps the stable `death:<id>` cue across later defeat/outcome
 * events, preventing its death animation from restarting.
 */
export function deriveBoitataVisualState(
  unit: BoitataRenderUnit,
  currentEvents: readonly CombatEvent[],
  previousSnapshotEvent: CombatEvent | null = null,
): BoitataVisualState {
  const currentSnapshotEvent = currentEvents.at(-1) ?? null;
  const previousUnit = snapshotUnit(previousSnapshotEvent, unit.id);
  const currentSnapshot = snapshotUnit(currentSnapshotEvent, unit.id);
  const currentPosition = unit.position ?? currentSnapshot?.position ?? null;
  const previousPosition = previousUnit?.position ?? currentPosition;
  const healthDamage = Math.max(0, (previousUnit?.hp ?? unit.hp) - unit.hp);
  const previousFireWall = previousUnit?.fireWallShield ?? unit.fireWallShield;
  const shieldDamage = Math.max(0, previousFireWall - unit.fireWallShield);
  const actorEvent = currentEvents.find((event) =>
    event.actorId === unit.id && (event.type === "move" || event.type === "attack" || event.type === "ability"),
  ) ?? null;
  const incomingDamageEvents = currentEvents.filter((event) =>
    event.actorId !== unit.id && damageAmountForTarget(event, unit.id) > 0,
  );
  const incomingEvent = incomingDamageEvents[0]
    ?? currentEvents.find((event) => event.actorId !== unit.id && event.targetIds?.includes(unit.id))
    ?? null;
  const isTarget = currentEvents.some((event) => event.targetIds?.includes(unit.id) ?? false);
  const incomingDamage = incomingDamageEvents.reduce(
    (total, event) => total + damageAmountForTarget(event, unit.id),
    0,
  );
  const isHit = isTarget && (healthDamage > 0 || incomingDamage > 0);
  const newlyDead = !unit.alive && previousUnit?.alive !== false;
  const eventKey = currentEvents.length
    ? `${currentEvents[0].id}:${currentEvents.at(-1)?.id ?? currentEvents[0].id}`
    : "rest";

  let motion: BoitataBodyMotionState = "idle";
  if (!unit.alive) {
    motion = "death";
  } else if (actorEvent?.type === "ability") {
    motion = "cast";
  } else if (actorEvent?.type === "attack") {
    motion = "attack";
  } else if (actorEvent?.type === "move" && previousPosition !== currentPosition) {
    motion = "move";
  } else if (isHit) {
    motion = "hit";
  }

  let shieldMotion: BoitataShieldMotionState = "hidden";
  if (actorEvent?.type === "ability" && unit.fireWallShield > previousFireWall) {
    shieldMotion = "cast";
  } else if (previousFireWall > 0 && unit.fireWallShield <= 0) {
    shieldMotion = "shield-break";
  } else if (shieldDamage > 0) {
    shieldMotion = "shield-hit";
  } else if (unit.fireWallShield > 0) {
    shieldMotion = "active";
  }

  const incomingActor = incomingEvent?.actorId ? snapshotUnit(incomingEvent, incomingEvent.actorId) : null;
  const facingPosition = actorEvent
    ? firstOtherTargetPosition(actorEvent, unit.id)
    : incomingEvent
      ? incomingActor?.position ?? null
      : null;

  return {
    unitId: unit.id,
    motion,
    isHit,
    shieldMotion,
    bodyCueKey: motion === "death" ? `death:${unit.id}` : `${eventKey}:${motion}`,
    shieldCueKey: shieldMotion === "active" || shieldMotion === "hidden"
      ? `${shieldMotion}:${unit.id}`
      : `${eventKey}:${shieldMotion}`,
    fromPosition: motion === "move" ? previousPosition : currentPosition,
    position: currentPosition,
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
