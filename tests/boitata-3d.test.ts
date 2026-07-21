import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { CombatEvent, CombatEventType, CombatUnit } from "../app/game-engine.ts";
import {
  chooseBoitataRenderMode,
  deriveBoitataVisualState,
  type BoitataRenderUnit,
  type BoitataRendererCapabilities,
} from "../app/boitata-3d-state.ts";

const BOITATA_ID = "boitata-test";
const ENEMY_ID = "enemy-test";

function combatUnit(overrides: Partial<CombatUnit> = {}): CombatUnit {
  return {
    id: BOITATA_ID,
    heroId: "boitata",
    side: "player",
    stars: 1,
    level: 1,
    position: 40,
    hp: 200,
    maxHp: 200,
    mana: 0,
    maxMana: 80,
    attack: 30,
    armor: 28,
    range: 1,
    attackSpeed: 0.68,
    manaRegen: 10,
    shield: 0,
    fireWallShield: 0,
    stunned: 0,
    alive: true,
    ...overrides,
  };
}

function renderUnit(overrides: Partial<BoitataRenderUnit> = {}): BoitataRenderUnit {
  return {
    id: BOITATA_ID,
    heroId: "boitata",
    side: "player",
    position: 40,
    level: 1,
    hp: 200,
    maxHp: 200,
    fireWallShield: 0,
    alive: true,
    ...overrides,
  };
}

function event(
  id: string,
  type: CombatEventType,
  snapshot: CombatUnit[],
  options: Pick<CombatEvent, "actorId" | "targetIds"> = {},
): CombatEvent {
  return {
    id,
    timestamp: 1,
    turn: 1,
    type,
    text: id,
    snapshot,
    ...options,
  };
}

test("derives movement from post-action snapshots and faces the actor target", () => {
  const before = event("before-move", "start", [
    combatUnit({ position: 40 }),
    combatUnit({ id: ENEMY_ID, heroId: "bramble", side: "enemy", position: 16 }),
  ]);
  const after = event(
    "move",
    "move",
    [
      combatUnit({ position: 32 }),
      combatUnit({ id: ENEMY_ID, heroId: "bramble", side: "enemy", position: 16 }),
    ],
    { actorId: BOITATA_ID, targetIds: [ENEMY_ID] },
  );

  const state = deriveBoitataVisualState(renderUnit({ position: 32 }), after, before);
  assert.equal(state.motion, "move");
  assert.equal(state.fromPosition, 40);
  assert.equal(state.position, 32);
  assert.equal(state.facingPosition, 16);
});

test("derives an attack without replacing an already-active wall", () => {
  const enemy = combatUnit({ id: ENEMY_ID, heroId: "bramble", side: "enemy", position: 24 });
  const before = event("before-attack", "move", [
    combatUnit({ fireWallShield: 70, shield: 70 }),
    enemy,
  ]);
  const after = event(
    "basic-attack",
    "attack",
    [combatUnit({ fireWallShield: 70, shield: 70 }), enemy],
    { actorId: BOITATA_ID, targetIds: [ENEMY_ID] },
  );

  const state = deriveBoitataVisualState(
    renderUnit({ fireWallShield: 70 }),
    after,
    before,
  );
  assert.equal(state.motion, "attack");
  assert.equal(state.shieldMotion, "active");
  assert.equal(state.facingPosition, 24);
  assert.equal(state.shieldDamage, 0);
});

test("keeps body and Wall of Fire cues independent", () => {
  const beforeCast = event("before-cast", "attack", [combatUnit()]);
  const cast = event(
    "wall-cast",
    "ability",
    [combatUnit({ shield: 95, fireWallShield: 95 })],
    { actorId: BOITATA_ID, targetIds: [BOITATA_ID] },
  );
  const castState = deriveBoitataVisualState(
    renderUnit({ fireWallShield: 95 }),
    cast,
    beforeCast,
  );
  assert.equal(castState.motion, "cast");
  assert.equal(castState.shieldMotion, "cast");
  assert.equal(castState.fireWallShield, 95);

  const attacker = combatUnit({ id: ENEMY_ID, heroId: "bramble", side: "enemy", position: 32 });
  const beforeHit = event("before-shield-hit", "ability", [
    combatUnit({ shield: 95, fireWallShield: 95 }),
    attacker,
  ]);
  const shieldHit = event(
    "shield-hit",
    "attack",
    [combatUnit({ shield: 55, fireWallShield: 55 }), attacker],
    { actorId: ENEMY_ID, targetIds: [BOITATA_ID] },
  );
  const shieldHitState = deriveBoitataVisualState(
    renderUnit({ fireWallShield: 55 }),
    shieldHit,
    beforeHit,
  );
  assert.equal(shieldHitState.motion, "idle");
  assert.equal(shieldHitState.shieldMotion, "shield-hit");
  assert.equal(shieldHitState.shieldDamage, 40);
  assert.equal(shieldHitState.healthDamage, 0);
  assert.equal(shieldHitState.facingPosition, 32);
});

test("prioritizes wall break while retaining the creature hit reaction", () => {
  const attacker = combatUnit({ id: ENEMY_ID, heroId: "bramble", side: "enemy", position: 32 });
  const before = event("before-break", "attack", [
    combatUnit({ hp: 200, shield: 20, fireWallShield: 20 }),
    attacker,
  ]);
  const after = event(
    "break",
    "attack",
    [combatUnit({ hp: 188, shield: 0, fireWallShield: 0 }), attacker],
    { actorId: ENEMY_ID, targetIds: [BOITATA_ID] },
  );

  const state = deriveBoitataVisualState(
    renderUnit({ hp: 188, fireWallShield: 0 }),
    after,
    before,
  );
  assert.equal(state.motion, "hit");
  assert.equal(state.shieldMotion, "shield-break");
  assert.equal(state.shieldDamage, 20);
  assert.equal(state.healthDamage, 12);
});

test("uses one stable death cue instead of retriggering on later events", () => {
  const alive = event("before-death", "attack", [combatUnit({ hp: 9, alive: true })]);
  const defeated = event(
    "fatal-hit",
    "attack",
    [combatUnit({ hp: 0, alive: false })],
    { actorId: ENEMY_ID, targetIds: [BOITATA_ID] },
  );
  const corpse = renderUnit({ hp: 0, alive: false });
  const first = deriveBoitataVisualState(corpse, defeated, alive);
  assert.equal(first.motion, "death");
  assert.equal(first.newlyDead, true);

  const outcome = event("outcome", "outcome", [combatUnit({ hp: 0, alive: false })]);
  const held = deriveBoitataVisualState(corpse, outcome, defeated);
  assert.equal(held.motion, "death");
  assert.equal(held.newlyDead, false);
  assert.equal(held.bodyCueKey, first.bodyCueKey);
});

test("capability policy preserves static 3D for reduced motion and names every fallback", () => {
  const cases: Array<[
    BoitataRendererCapabilities,
    ReturnType<typeof chooseBoitataRenderMode>,
  ]> = [
    [{ webglAvailable: true }, { mode: "animated-3d", fallbackReason: null }],
    [{ webglAvailable: true, reducedMotion: true }, { mode: "static-3d", fallbackReason: null }],
    [{ webglAvailable: false }, { mode: "fallback-image", fallbackReason: "webgl-unavailable" }],
    [{ webglAvailable: true, contextLost: true }, { mode: "fallback-image", fallbackReason: "context-lost" }],
    [{ webglAvailable: true, initializationFailed: true }, { mode: "fallback-image", fallbackReason: "initialization-failed" }],
    [{ webglAvailable: true, saveData: true }, { mode: "fallback-image", fallbackReason: "reduced-data" }],
  ];

  for (const [capabilities, expected] of cases) {
    assert.deepEqual(chooseBoitataRenderMode(capabilities), expected);
  }
});

test("3D layer is decorative and exposes stable fallback hooks", async () => {
  const source = await readFile(new URL("../app/boitata-3d-layer.tsx", import.meta.url), "utf8");
  assert.match(source, /data-testid=["']boitata-3d-layer["']/);
  assert.match(source, /data-testid=["']boitata-3d-canvas["']/);
  assert.match(source, /aria-hidden=["']true["']/);
  assert.match(source, /pointerEvents:\s*["']none["']/);
  assert.match(source, /onReady\?/);
  assert.match(source, /onFallback\?/);
  assert.match(source, /onReducedMotionChange\?/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
  assert.match(source, /navigator\.connection/);
  assert.match(source, /webglcontextlost/);
});

test("3D creature uses a model-local visual anchor without moving its board position", async () => {
  const source = await readFile(new URL("../app/boitata-3d-layer.tsx", import.meta.url), "utf8");
  const biasMatch = source.match(/const BOITATA_MODEL_VERTICAL_ANCHOR_BIAS = ([\d.]+);/);
  assert.ok(biasMatch, "the updated rig should define an explicit visual anchor bias");
  const bias = Number(biasMatch[1]);
  assert.ok(bias >= 0.07 && bias <= 0.09, "the visual anchor should lift the lower-weighted model by about 8% of its height");
  assert.match(
    source,
    /\(-rigCenter\.y \+ rigSize\.y \* BOITATA_MODEL_VERTICAL_ANCHOR_BIAS\) \* rigNormalizationScale/,
  );
  assert.match(source, /root\.position\.set\(startX, startY,/);
  assert.doesNotMatch(source, /root\.position\.(?:x|y)[^;]*BOITATA_MODEL_VERTICAL_ANCHOR_BIAS/);
});
