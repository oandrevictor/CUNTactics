import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { CombatEvent, CombatEventType, CombatUnit } from "../app/game-engine.ts";
import {
  MEAT_GAGA_ANIMATION_CLIPS,
  chooseMeatGagaRenderMode,
  deriveMeatGagaVisualState,
  meatGagaClipForMotion,
  type MeatGagaRenderUnit,
} from "../app/meat-gaga-3d-state.ts";

const GAGA_ID = "gaga-test";
const ENEMY_ID = "enemy-test";

function combatUnit(overrides: Partial<CombatUnit> = {}): CombatUnit {
  return {
    id: GAGA_ID,
    heroId: "meat-gaga",
    side: "player",
    stars: 1,
    level: 1,
    position: 40,
    hp: 180,
    maxHp: 180,
    mana: 0,
    maxMana: 0,
    attack: 34,
    armor: 12,
    range: 4,
    attackSpeed: 0.46,
    moveSpeed: 0.34,
    manaRegen: 0,
    shield: 0,
    fireWallShield: 0,
    meatStack: 0,
    stunned: 0,
    alive: true,
    ...overrides,
  };
}

function renderUnit(overrides: Partial<MeatGagaRenderUnit> = {}): MeatGagaRenderUnit {
  return {
    id: GAGA_ID,
    heroId: "meat-gaga",
    side: "player",
    position: 40,
    level: 1,
    hp: 180,
    maxHp: 180,
    meatStack: 0,
    stunned: 0,
    alive: true,
    ...overrides,
  };
}

function event(
  id: string,
  type: CombatEventType,
  snapshot: CombatUnit[],
  options: Partial<CombatEvent> = {},
): CombatEvent {
  return {
    id,
    timestamp: 1,
    durationSeconds: 0.8,
    turn: 1,
    type,
    text: id,
    snapshot,
    ...options,
  };
}

test("Meat Gaga walks along the engine-authored movement route", () => {
  const enemy = combatUnit({ id: ENEMY_ID, heroId: "nix", side: "enemy", position: 16 });
  const before = event("before-move", "start", [combatUnit({ position: 47 }), enemy]);
  const move = event(
    "move",
    "move",
    [combatUnit({ position: 32 }), enemy],
    {
      actorId: GAGA_ID,
      targetIds: [ENEMY_ID],
      durationSeconds: 2.25,
      fromPosition: 40,
      toPosition: 32,
    },
  );
  const state = deriveMeatGagaVisualState(renderUnit({ position: 32 }), [move], before);

  assert.equal(state.motion, "move");
  assert.equal(state.fromPosition, 40);
  assert.equal(state.position, 32);
  assert.equal(state.facingPosition, 16);
  assert.equal(state.startTime, move.timestamp);
  assert.equal(state.durationSeconds, 2.25);
  assert.equal(meatGagaClipForMotion(state.motion), MEAT_GAGA_ANIMATION_CLIPS.walking);
});

test("only an empowered basic attack plays the authored crouch-pick-throw clip", () => {
  const enemy = combatUnit({ id: ENEMY_ID, heroId: "nix", side: "enemy", position: 24 });
  const normal = event(
    "normal-shot",
    "attack",
    [combatUnit(), enemy],
    { actorId: GAGA_ID, targetIds: [ENEMY_ID], amount: 34 },
  );
  const empowered = event(
    "meat-shot",
    "attack",
    [combatUnit({ meatStack: 72 }), enemy],
    {
      actorId: GAGA_ID,
      targetIds: [ENEMY_ID],
      amount: 40,
      meatBonusDamage: 6,
      meatStackConsumed: 6,
      meatStackBefore: 78,
      meatStackAfter: 72,
    },
  );

  const normalState = deriveMeatGagaVisualState(renderUnit(), [normal]);
  const empoweredState = deriveMeatGagaVisualState(renderUnit({ meatStack: 72 }), [empowered]);
  assert.equal(normalState.motion, "attack");
  assert.equal(meatGagaClipForMotion(normalState.motion), null);
  assert.equal(empoweredState.motion, "throw");
  assert.equal(empoweredState.enhancedAttack, true);
  assert.equal(meatGagaClipForMotion(empoweredState.motion), MEAT_GAGA_ANIMATION_CLIPS.throw);
});

test("harvesting a fallen unit does not falsely play the throw animation", () => {
  const harvest = event(
    "harvest",
    "passive",
    [combatUnit({ meatStack: 78 })],
    {
      actorId: GAGA_ID,
      meatStackBefore: 0,
      meatStackGained: 78,
      meatStackAfter: 78,
    },
  );
  const state = deriveMeatGagaVisualState(renderUnit({ meatStack: 78 }), [harvest]);

  assert.equal(state.motion, "harvest");
  assert.equal(state.meatStackGained, 78);
  assert.equal(state.enhancedAttack, false);
  assert.equal(meatGagaClipForMotion(state.motion), null);
});

test("newly applied and consumed stuns both map to the Alert clip", () => {
  const enemy = combatUnit({ id: ENEMY_ID, heroId: "vesper", side: "enemy", position: 24 });
  const before = event("before-stun", "attack", [combatUnit({ stunned: 0 }), enemy]);
  const application = event(
    "apply-stun",
    "ability",
    [combatUnit({ stunned: 1 }), enemy],
    { actorId: ENEMY_ID, targetIds: [GAGA_ID], amount: 0 },
  );
  const appliedState = deriveMeatGagaVisualState(renderUnit({ stunned: 1 }), [application], before);
  assert.equal(appliedState.motion, "stunned");
  assert.equal(meatGagaClipForMotion(appliedState.motion), MEAT_GAGA_ANIMATION_CLIPS.alert);

  const skipped = event(
    "skip-stunned-action",
    "move",
    [combatUnit({ stunned: 0 }), enemy],
    {
      actorId: GAGA_ID,
      targetIds: [ENEMY_ID],
      text: "Meat Gaga is stunned and skips the action.",
    },
  );
  const skippedState = deriveMeatGagaVisualState(renderUnit({ stunned: 0 }), [skipped], application);
  assert.equal(skippedState.motion, "stunned");
  assert.equal(meatGagaClipForMotion(skippedState.motion), MEAT_GAGA_ANIMATION_CLIPS.alert);
});

test("a frozen simultaneous empowered attack keeps Throw while retaining incoming hit feedback", () => {
  const enemy = combatUnit({ id: ENEMY_ID, heroId: "vesper", side: "enemy", position: 24 });
  const before = event("before-batch", "start", [combatUnit({ hp: 180, meatStack: 78 }), enemy]);
  const snapshot = [combatUnit({ hp: 160, meatStack: 72, stunned: 1 }), enemy];
  const throwEvent = event(
    "gaga-throws",
    "attack",
    snapshot,
    {
      actorId: GAGA_ID,
      targetIds: [ENEMY_ID],
      amount: 40,
      meatBonusDamage: 6,
      meatStackConsumed: 6,
    },
  );
  const incoming = event(
    "vesper-hits",
    "ability",
    snapshot,
    { actorId: ENEMY_ID, targetIds: [GAGA_ID], amount: 20 },
  );
  const state = deriveMeatGagaVisualState(
    renderUnit({ hp: 160, meatStack: 72, stunned: 1 }),
    [throwEvent, incoming],
    before,
  );

  assert.equal(state.motion, "throw");
  assert.equal(state.enhancedAttack, true);
  assert.equal(state.isHit, true);
  assert.equal(state.healthDamage, 20);
  assert.equal(state.cueKey, "gaga-throws:throw");
  assert.equal(state.hitCueKey, "vesper-hits:hit");
  assert.equal(state.hitStartTime, incoming.timestamp);
  assert.equal(state.hitDurationSeconds, incoming.durationSeconds);
  assert.equal(state.durationSeconds, throwEvent.durationSeconds);
});

test("keeps an authored cue stable when an unrelated overlapping action appears", () => {
  const enemy = combatUnit({ id: ENEMY_ID, heroId: "nix", side: "enemy", position: 24 });
  const other = combatUnit({ id: "other-test", heroId: "tide", side: "player", position: 41 });
  const snapshot = [combatUnit(), enemy, other];
  const shot = event(
    "gaga-shot",
    "attack",
    snapshot,
    { actorId: GAGA_ID, targetIds: [ENEMY_ID], durationSeconds: 1.6 },
  );
  const unrelated = event(
    "other-casts",
    "ability",
    snapshot,
    { actorId: other.id, targetIds: [other.id], durationSeconds: 0.5 },
  );

  const withoutOverlap = deriveMeatGagaVisualState(renderUnit(), [shot]);
  const withOverlap = deriveMeatGagaVisualState(renderUnit(), [shot, unrelated]);

  assert.equal(withOverlap.cueKey, withoutOverlap.cueKey);
  assert.equal(withOverlap.durationSeconds, 1.6);
});

test("newest overlapping incoming impact owns the independent hit timeline", () => {
  const olderAttacker = combatUnit({ id: ENEMY_ID, heroId: "nix", side: "enemy", position: 24 });
  const newerAttacker = combatUnit({ id: "newer-enemy", heroId: "vesper", side: "enemy", position: 32 });
  const snapshot = [combatUnit({ hp: 150 }), olderAttacker, newerAttacker];
  const olderHit = event(
    "older-hit",
    "attack",
    snapshot,
    {
      timestamp: 1,
      durationSeconds: 3,
      actorId: olderAttacker.id,
      targetIds: [GAGA_ID],
      amount: 10,
    },
  );
  const newerHit = event(
    "newer-hit",
    "ability",
    snapshot,
    {
      timestamp: 2,
      durationSeconds: 1.25,
      actorId: newerAttacker.id,
      targetIds: [GAGA_ID],
      amount: 20,
    },
  );

  const state = deriveMeatGagaVisualState(renderUnit({ hp: 150 }), [newerHit, olderHit]);

  assert.equal(state.motion, "hit");
  assert.equal(state.cueKey, "newer-hit:hit");
  assert.equal(state.hitCueKey, "newer-hit:hit");
  assert.equal(state.startTime, 2);
  assert.equal(state.durationSeconds, 1.25);
  assert.equal(state.hitStartTime, 2);
  assert.equal(state.hitDurationSeconds, 1.25);
});

test("a frozen ordinary attack completes before a newly applied simultaneous stun is shown", () => {
  const enemy = combatUnit({ id: ENEMY_ID, heroId: "vesper", side: "enemy", position: 24 });
  const before = event("before-normal-batch", "start", [combatUnit({ stunned: 0 }), enemy]);
  const snapshot = [combatUnit({ stunned: 1 }), enemy];
  const normalAttack = event(
    "gaga-normal-shot",
    "attack",
    snapshot,
    { actorId: GAGA_ID, targetIds: [ENEMY_ID], amount: 34 },
  );
  const incomingStun = event(
    "vesper-stuns",
    "ability",
    snapshot,
    { actorId: ENEMY_ID, targetIds: [GAGA_ID], amount: 0 },
  );
  const state = deriveMeatGagaVisualState(
    renderUnit({ stunned: 1 }),
    [normalAttack, incomingStun],
    before,
  );

  assert.equal(state.motion, "attack");
  assert.equal(meatGagaClipForMotion(state.motion), null);
});

test("a same-moment attack retains its action while exposing passive meat harvested later in the batch", () => {
  const enemy = combatUnit({ id: ENEMY_ID, heroId: "nix", side: "enemy", position: 24, alive: false });
  const snapshot = [combatUnit({ meatStack: 78 }), enemy];
  const normalAttack = event(
    "gaga-finishes-target",
    "attack",
    snapshot,
    { actorId: GAGA_ID, targetIds: [ENEMY_ID], amount: 34 },
  );
  const harvest = event(
    "gaga-harvests-target",
    "passive",
    snapshot,
    { actorId: GAGA_ID, meatStackBefore: 0, meatStackGained: 78, meatStackAfter: 78 },
  );
  const state = deriveMeatGagaVisualState(renderUnit({ meatStack: 78 }), [normalAttack, harvest]);

  assert.equal(state.motion, "attack");
  assert.equal(state.meatStackGained, 78);
});

test("a primary attack outranks an older harvest while their intervals overlap", () => {
  const enemy = combatUnit({ id: ENEMY_ID, heroId: "nix", side: "enemy", position: 24 });
  const snapshot = [combatUnit({ meatStack: 78 }), enemy];
  const olderHarvest = event(
    "older-harvest",
    "passive",
    snapshot,
    {
      timestamp: 1,
      durationSeconds: 2,
      actorId: GAGA_ID,
      meatStackBefore: 0,
      meatStackGained: 78,
      meatStackAfter: 78,
    },
  );
  const newerAttack = event(
    "newer-attack",
    "attack",
    snapshot,
    {
      timestamp: 2,
      durationSeconds: 1,
      actorId: GAGA_ID,
      targetIds: [ENEMY_ID],
      amount: 34,
    },
  );

  const state = deriveMeatGagaVisualState(renderUnit({ meatStack: 78 }), [olderHarvest, newerAttack]);

  assert.equal(state.motion, "attack");
  assert.equal(state.cueKey, "newer-attack:attack");
  assert.equal(state.durationSeconds, 1);
  assert.equal(state.meatStackGained, 78);
});

test("incoming damage still triggers hit feedback when simultaneous healing masks the health delta", () => {
  const enemy = combatUnit({ id: ENEMY_ID, heroId: "nix", side: "enemy", position: 24 });
  const healer = combatUnit({ id: "healer", heroId: "bramble", side: "player", position: 41 });
  const before = event("before-masked-hit", "start", [combatUnit({ hp: 180 }), enemy, healer]);
  const snapshot = [combatUnit({ hp: 180 }), enemy, healer];
  const incoming = event(
    "masked-hit",
    "attack",
    snapshot,
    { actorId: ENEMY_ID, targetIds: [GAGA_ID], amount: 24 },
  );
  const heal = event(
    "masking-heal",
    "ability",
    snapshot,
    { actorId: healer.id, targetIds: [GAGA_ID], amount: 24, amounts: { [GAGA_ID]: 24 } },
  );
  const state = deriveMeatGagaVisualState(renderUnit({ hp: 180 }), [incoming, heal], before);

  assert.equal(state.motion, "hit");
  assert.equal(state.isHit, true);
  assert.equal(state.healthDamage, 0);
});

test("Defying Gravity landing damage triggers the authored hit feedback", () => {
  const elphaba = combatUnit({ id: ENEMY_ID, heroId: "elphaba", side: "enemy", position: 24 });
  const before = event("before-gravity-landing", "start", [combatUnit({ hp: 180 }), elphaba]);
  const snapshot = [combatUnit({ hp: 180 }), elphaba];
  const landing = event(
    "gravity-landing",
    "landing",
    snapshot,
    { actorId: ENEMY_ID, targetIds: [GAGA_ID], amounts: { [GAGA_ID]: 21 } },
  );

  const state = deriveMeatGagaVisualState(renderUnit({ hp: 180 }), [landing], before);

  assert.equal(state.motion, "hit");
  assert.equal(state.isHit, true);
  assert.equal(state.healthDamage, 0);
  assert.equal(state.facingPosition, 24);
});

test("death uses one stable procedural cue across later combat moments", () => {
  const before = event("before-death", "attack", [combatUnit({ hp: 8, alive: true })]);
  const defeated = event(
    "fatal-hit",
    "attack",
    [combatUnit({ hp: 0, alive: false })],
    { actorId: ENEMY_ID, targetIds: [GAGA_ID], amount: 8 },
  );
  const first = deriveMeatGagaVisualState(renderUnit({ hp: 0, alive: false }), [defeated], before);
  const outcome = event("outcome", "outcome", [combatUnit({ hp: 0, alive: false })]);
  const held = deriveMeatGagaVisualState(renderUnit({ hp: 0, alive: false }), [outcome], defeated);

  assert.equal(first.motion, "death");
  assert.equal(first.newlyDead, true);
  assert.equal(meatGagaClipForMotion(first.motion), null);
  assert.equal(held.cueKey, first.cueKey);
});

test("Meat Gaga render policy keeps static 3D for reduced motion and a PNG fallback for constrained devices", () => {
  assert.deepEqual(chooseMeatGagaRenderMode({ webglAvailable: true }), {
    mode: "animated-3d",
    fallbackReason: null,
  });
  assert.deepEqual(chooseMeatGagaRenderMode({ webglAvailable: true, reducedMotion: true }), {
    mode: "static-3d",
    fallbackReason: null,
  });
  assert.deepEqual(chooseMeatGagaRenderMode({ webglAvailable: true, saveData: true }), {
    mode: "fallback-image",
    fallbackReason: "reduced-data",
  });
  assert.deepEqual(chooseMeatGagaRenderMode({ webglAvailable: false }), {
    mode: "fallback-image",
    fallbackReason: "webgl-unavailable",
  });
});

test("the shared animated layer is decorative and preserves the interactive portrait fallback", async () => {
  const [layer, client, styles] = await Promise.all([
    readFile(new URL("../app/meat-gaga-3d-layer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(layer, /GLTFLoader/);
  assert.match(layer, /SkeletonUtils\.clone/);
  assert.match(layer, /const MEAT_GAGA_MODEL_FORWARD_TILT_RADIANS = \(-?\d+ \* Math\.PI\) \/ 180;/);
  assert.match(layer, /const MEAT_GAGA_MODEL_YAW_RADIANS = \((-?\d+ \* Math\.PI\) \/ 180|0);/);
  assert.match(
    layer,
    /rigTemplate\.rotation\.set\(\s*MEAT_GAGA_MODEL_FORWARD_TILT_RADIANS,\s*MEAT_GAGA_MODEL_YAW_RADIANS,\s*0,\s*\)/s,
  );
  assert.ok(
    layer.indexOf("rigTemplate.rotation.set(") < layer.indexOf("rigTemplate.updateMatrixWorld(true)"),
    "orientation must be applied before measuring rig bounds",
  );
  assert.match(layer, /MODEL_TARGET_HEIGHT \/ rigLongestSide/);
  assert.match(layer, /function sideYaw\(side: MeatGagaRenderUnit\["side"\]\): number/);
  assert.match(layer, /side === "player" \? 0 : Math\.PI/);
  assert.match(layer, /facingYaw: sideYaw\(unit\.side\)/);
  assert.match(layer, /sideYaw\(unit\.side\)\s*\+\s*targetYaw\(/);
  assert.match(layer, /new THREE\.AnimationMixer/);
  assert.match(layer, /LoopRepeat/);
  assert.match(layer, /LoopOnce/);
  assert.match(layer, /action\.setDuration/);
  assert.match(layer, /mixer\.update\(0\)/);
  assert.match(layer, /combatTime: number/);
  assert.match(layer, /combatEventProgress\(\{ timestamp: startTime, durationSeconds \}, combatTime\)/);
  assert.match(layer, /visual\.startTime,[\s\S]+visual\.durationSeconds,[\s\S]+latest\.combatTime/);
  assert.match(layer, /visual\.hitStartTime,[\s\S]+visual\.hitDurationSeconds,[\s\S]+latest\.combatTime/);
  assert.match(layer, /entity\.activeAction\.time = entity\.activeAction\.getClip\(\)\.duration \* actionProgress/);
  assert.doesNotMatch(layer, /attackAnimationSeconds|movementTravelSeconds|bodyElapsed|clipElapsed|actionDuration|latest\.speed|latest\.previewing/);
  assert.doesNotMatch(layer, /\?\s*0\.46|\?\s*0\.72/);
  assert.match(layer, /idleAction\.time = idleAction\.getClip\(\)\.duration \* IDLE_POSE_PROGRESS/);
  assert.match(layer, /entity\.activeAction = idleAction \?\? null/);
  assert.match(layer, /action\.stopFading\(\)/);
  assert.match(layer, /action\.setEffectiveWeight\(1\)/);
  assert.match(layer, /previousAction && previousAction !== action/);
  assert.doesNotMatch(layer, /\.skeleton\.pose\(\)/);
  assert.match(layer, /mesh\.onAfterRender/);
  assert.match(layer, /bone\.getWorldPosition\(jointPosition\)/);
  assert.match(layer, /bodyHeight >= MODEL_TARGET_HEIGHT \* 0\.45/);
  assert.match(layer, /pendingEntities = \[\.\.\.entities\.values\(\)\]\.filter/);
  assert.match(layer, /entity\.bodyValidated = true/);
  assert.match(layer, /entity\.bodyDrawn = false;\s+entity\.bodyValidated = false/);
  assert.match(layer, /Meat Gaga did not produce a renderable body/);
  assert.match(layer, /fallback\("initialization-failed"\)/);
  assert.match(layer, /window\.cancelAnimationFrame\(frame\);\s+fallback\("context-lost"\)/);
  assert.match(layer, /webglcontextlost/);
  assert.match(layer, /navigator\.connection\?\.saveData/);
  assert.match(layer, /prefers-reduced-motion: reduce/);
  assert.match(layer, /data-testid="meat-gaga-3d-layer"/);
  assert.match(layer, /data-testid="meat-gaga-3d-canvas"/);
  assert.match(layer, /aria-hidden="true"/);
  assert.match(layer, /role="presentation"/);
  assert.match(layer, /tabIndex=\{-1\}/);

  assert.equal(client.match(/<MeatGaga3DLayer\b/g)?.length, 1);
  assert.match(client, /meatGagaBoardUnits/);
  assert.match(client, /onReady=\{\(\) => setMeatGaga3DReady\(true\)\}/);
  assert.match(client, /onFallback=\{\(\) => setMeatGaga3DReady\(false\)\}/);
  assert.match(client, /onDisposed=\{\(\) => setMeatGaga3DReady\(false\)\}/);
  assert.match(client, /aria-label=\{localizeText\(locale, isTimedStunned \?/);
  assert.match(client, /`Stunned until \$\{formatAbilitySeconds\(unit\.stunnedUntil, locale\)\}` : "Stunned"/);
  assert.match(styles, /\.meat-gaga-3d-ready \.unit-token-meat-gaga \.unit-avatar\.hero-art-image/);
  assert.match(styles, /opacity: 0/);
  assert.match(styles, /\.unit-token-meat-gaga \.unit-avatar\.hero-art-image \{[^}]*transition: opacity 180ms ease;/);
  assert.match(styles, /\.meat-gaga-3d-layer/);
});
