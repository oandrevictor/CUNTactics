import type { CombatEvent } from "./game-engine";

export const MEAT_GAGA_ANIMATION_CLIPS = {
  alert: "Alert",
  throw: "Female_Crouch_Pick_Throw_Forward",
  running: "Running",
  walking: "Walking",
} as const;

export interface MeatGagaRenderUnit {
  id: string;
  heroId: string;
  side: "player" | "enemy";
  position: number | null;
  level: number;
  hp: number;
  maxHp: number;
  meatStack: number;
  stunned: number;
  alive: boolean;
}

export type MeatGagaMotionState =
  | "idle"
  | "move"
  | "attack"
  | "throw"
  | "harvest"
  | "stunned"
  | "hit"
  | "death";

export interface MeatGagaVisualState {
  unitId: string;
  motion: MeatGagaMotionState;
  cueKey: string;
  fromPosition: number | null;
  position: number | null;
  facingPosition: number | null;
  isHit: boolean;
  healthDamage: number;
  meatStackGained: number;
  enhancedAttack: boolean;
  newlyDead: boolean;
}

export type MeatGagaRendererFallbackReason =
  | "webgl-unavailable"
  | "context-lost"
  | "initialization-failed"
  | "reduced-data";

export type MeatGagaRenderMode = "animated-3d" | "static-3d" | "fallback-image";

export interface MeatGagaRendererCapabilities {
  webglAvailable: boolean;
  reducedMotion?: boolean;
  saveData?: boolean;
  contextLost?: boolean;
  initializationFailed?: boolean;
}

export interface MeatGagaRenderDecision {
  mode: MeatGagaRenderMode;
  fallbackReason: MeatGagaRendererFallbackReason | null;
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

function isEnhancedAttack(event: CombatEvent | null): boolean {
  return event?.type === "attack"
    && Math.max(event.meatStackConsumed ?? 0, event.meatBonusDamage ?? 0) > 0;
}

function isStunSkip(event: CombatEvent | null): boolean {
  return event?.type === "move" && /stunned and skips/i.test(event.text);
}

/** Maps engine snapshots to stable, renderer-only animation cues. */
export function deriveMeatGagaVisualState(
  unit: MeatGagaRenderUnit,
  currentEvents: readonly CombatEvent[],
  previousSnapshotEvent: CombatEvent | null = null,
): MeatGagaVisualState {
  const currentSnapshotEvent = currentEvents.at(-1) ?? null;
  const previousUnit = snapshotUnit(previousSnapshotEvent, unit.id);
  const currentSnapshot = snapshotUnit(currentSnapshotEvent, unit.id);
  const currentPosition = unit.position ?? currentSnapshot?.position ?? null;
  const previousPosition = previousUnit?.position ?? currentPosition;
  const healthDamage = Math.max(0, (previousUnit?.hp ?? unit.hp) - unit.hp);
  const actorEvent = currentEvents.find((event) =>
    event.actorId === unit.id
      && (event.type === "move" || event.type === "attack" || event.type === "passive"),
  ) ?? null;
  const passiveEvent = currentEvents.find((event) =>
    event.actorId === unit.id && event.type === "passive" && (event.meatStackGained ?? 0) > 0,
  ) ?? null;
  const incomingDamageEvents = currentEvents.filter((event) =>
    event.actorId !== unit.id && damageAmountForTarget(event, unit.id) > 0,
  );
  const incomingEvent = incomingDamageEvents[0]
    ?? currentEvents.find((event) => event.actorId !== unit.id && event.targetIds?.includes(unit.id))
    ?? null;
  const incomingDamage = incomingDamageEvents.reduce(
    (total, event) => total + damageAmountForTarget(event, unit.id),
    0,
  );
  const isHit = healthDamage > 0 || incomingDamage > 0;
  const enhancedAttack = isEnhancedAttack(actorEvent);
  const meatStackGained = passiveEvent
    ? Math.max(0, passiveEvent.meatStackGained ?? 0)
    : 0;
  const newlyStunned = unit.stunned > (previousUnit?.stunned ?? 0);
  const skippedForStun = isStunSkip(actorEvent);
  const stunned = newlyStunned || unit.stunned > 0;
  const newlyDead = !unit.alive && previousUnit?.alive !== false;
  const eventKey = currentEvents.length
    ? `${currentEvents[0].id}:${currentEvents.at(-1)?.id ?? currentEvents[0].id}`
    : "rest";

  let motion: MeatGagaMotionState = "idle";
  if (!unit.alive) {
    motion = "death";
  } else if (enhancedAttack) {
    motion = "throw";
  } else if (actorEvent?.type === "move" && previousPosition !== currentPosition) {
    motion = "move";
  } else if (skippedForStun) {
    motion = "stunned";
  } else if (actorEvent?.type === "attack") {
    motion = "attack";
  } else if (stunned) {
    motion = "stunned";
  } else if (meatStackGained > 0) {
    motion = "harvest";
  } else if (isHit) {
    motion = "hit";
  }

  const incomingActor = incomingEvent?.actorId ? snapshotUnit(incomingEvent, incomingEvent.actorId) : null;
  const facingPosition = actorEvent
    ? firstOtherTargetPosition(actorEvent, unit.id)
    : incomingActor?.position ?? null;
  const cueKey = motion === "death"
    ? `death:${unit.id}`
    : motion === "idle"
      ? `idle:${unit.id}`
      : motion === "stunned" && !skippedForStun
        ? `stunned:${unit.id}`
        : `${eventKey}:${motion}`;

  return {
    unitId: unit.id,
    motion,
    cueKey,
    fromPosition: motion === "move" ? previousPosition : currentPosition,
    position: currentPosition,
    facingPosition,
    isHit,
    healthDamage,
    meatStackGained,
    enhancedAttack,
    newlyDead,
  };
}

/** Returns only authored clips; other states intentionally use procedural poses. */
export function meatGagaClipForMotion(motion: MeatGagaMotionState): string | null {
  if (motion === "move") return MEAT_GAGA_ANIMATION_CLIPS.walking;
  if (motion === "throw") return MEAT_GAGA_ANIMATION_CLIPS.throw;
  if (motion === "stunned") return MEAT_GAGA_ANIMATION_CLIPS.alert;
  return null;
}

export function chooseMeatGagaRenderMode(
  capabilities: MeatGagaRendererCapabilities,
): MeatGagaRenderDecision {
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
