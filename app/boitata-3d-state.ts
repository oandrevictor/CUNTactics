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
  currentEvent: CombatEvent | null,
  previousEvent: CombatEvent | null = null,
): BoitataVisualState {
  const previousUnit = snapshotUnit(previousEvent, unit.id);
  const currentSnapshot = snapshotUnit(currentEvent, unit.id);
  const currentPosition = unit.position ?? currentSnapshot?.position ?? null;
  const previousPosition = previousUnit?.position ?? currentPosition;
  const healthDamage = Math.max(0, (previousUnit?.hp ?? unit.hp) - unit.hp);
  const previousFireWall = previousUnit?.fireWallShield ?? unit.fireWallShield;
  const shieldDamage = Math.max(0, previousFireWall - unit.fireWallShield);
  const isActor = currentEvent?.actorId === unit.id;
  const isTarget = currentEvent?.targetIds?.includes(unit.id) ?? false;
  const newlyDead = !unit.alive && previousUnit?.alive !== false;
  const eventKey = currentEvent?.id ?? "rest";

  let motion: BoitataBodyMotionState = "idle";
  if (!unit.alive) {
    motion = "death";
  } else if (isActor && currentEvent?.type === "ability") {
    motion = "cast";
  } else if (isActor && currentEvent?.type === "attack") {
    motion = "attack";
  } else if (isActor && currentEvent?.type === "move" && previousPosition !== currentPosition) {
    motion = "move";
  } else if (isTarget && healthDamage > 0) {
    motion = "hit";
  }

  let shieldMotion: BoitataShieldMotionState = "hidden";
  if (isActor && currentEvent?.type === "ability" && unit.fireWallShield > previousFireWall) {
    shieldMotion = "cast";
  } else if (previousFireWall > 0 && unit.fireWallShield <= 0) {
    shieldMotion = "shield-break";
  } else if (shieldDamage > 0) {
    shieldMotion = "shield-hit";
  } else if (unit.fireWallShield > 0) {
    shieldMotion = "active";
  }

  const actor = currentEvent?.actorId ? snapshotUnit(currentEvent, currentEvent.actorId) : null;
  const facingPosition = isActor
    ? firstOtherTargetPosition(currentEvent, unit.id)
    : isTarget
      ? actor?.position ?? null
      : null;

  return {
    unitId: unit.id,
    motion,
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
