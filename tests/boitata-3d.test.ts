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
const HEALER_ID = "healer-test";

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
    attackSpeed: 0.42,
    moveSpeed: 0.29,
    manaRegen: 10,
    shield: 0,
    fireWallShield: 0,
    meatStack: 0,
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
  options: Pick<CombatEvent, "actorId" | "targetIds" | "amount" | "amounts"> = {},
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

  const state = deriveBoitataVisualState(renderUnit({ position: 32 }), [after], before);
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
    [after],
    before,
  );
  assert.equal(state.motion, "attack");
  assert.equal(state.shieldMotion, "active");
  assert.equal(state.facingPosition, 24);
  assert.equal(state.shieldDamage, 0);
});

test("keeps an attack cue while reacting to a simultaneous incoming hit", () => {
  const enemy = combatUnit({ id: ENEMY_ID, heroId: "nix", side: "enemy", position: 24 });
  const before = event("before-simultaneous", "start", [combatUnit({ hp: 200 }), enemy]);
  const finalSnapshot = [combatUnit({ hp: 170 }), enemy];
  const ownAttack = event(
    "boitata-attacks",
    "attack",
    finalSnapshot,
    { actorId: BOITATA_ID, targetIds: [ENEMY_ID] },
  );
  const incomingAttack = event(
    "enemy-attacks",
    "attack",
    finalSnapshot,
    { actorId: ENEMY_ID, targetIds: [BOITATA_ID] },
  );

  const state = deriveBoitataVisualState(
    renderUnit({ hp: 170 }),
    [ownAttack, incomingAttack],
    before,
  );

  assert.equal(state.motion, "attack");
  assert.equal(state.isHit, true);
  assert.equal(state.healthDamage, 30);
  assert.equal(state.facingPosition, 24);
  assert.match(state.bodyCueKey, /boitata-attacks:enemy-attacks/);
});

test("reacts to incoming damage even when simultaneous healing masks the net health loss", () => {
  const enemy = combatUnit({ id: ENEMY_ID, heroId: "nix", side: "enemy", position: 32 });
  const healer = combatUnit({ id: HEALER_ID, heroId: "tide", side: "player", position: 41 });
  const before = event("before-masked-hit", "start", [combatUnit({ hp: 200 }), enemy, healer]);
  const finalSnapshot = [combatUnit({ hp: 200 }), enemy, healer];
  const incomingAttack = event(
    "masked-attack",
    "attack",
    finalSnapshot,
    { actorId: ENEMY_ID, targetIds: [BOITATA_ID], amount: 30 },
  );
  const simultaneousHeal = event(
    "masking-heal",
    "ability",
    finalSnapshot,
    { actorId: HEALER_ID, targetIds: [BOITATA_ID], amount: 30, amounts: { [BOITATA_ID]: 30 } },
  );

  const state = deriveBoitataVisualState(
    renderUnit({ hp: 200 }),
    [incomingAttack, simultaneousHeal],
    before,
  );

  assert.equal(state.healthDamage, 0);
  assert.equal(state.isHit, true);
  assert.equal(state.motion, "hit");
  assert.equal(state.facingPosition, 32);
});

test("reacts to Defying Gravity landing damage even when a shield masks the health delta", () => {
  const elphaba = combatUnit({ id: ENEMY_ID, heroId: "elphaba", side: "enemy", position: 32 });
  const before = event("before-gravity-landing", "start", [combatUnit({ hp: 200 }), elphaba]);
  const snapshot = [combatUnit({ hp: 200 }), elphaba];
  const landing = event(
    "gravity-landing",
    "landing",
    snapshot,
    { actorId: ENEMY_ID, targetIds: [BOITATA_ID], amounts: { [BOITATA_ID]: 24 } },
  );

  const state = deriveBoitataVisualState(renderUnit({ hp: 200 }), [landing], before);

  assert.equal(state.motion, "hit");
  assert.equal(state.isHit, true);
  assert.equal(state.healthDamage, 0);
  assert.equal(state.facingPosition, 32);
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
    [cast],
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
    [shieldHit],
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
    [after],
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
  const first = deriveBoitataVisualState(corpse, [defeated], alive);
  assert.equal(first.motion, "death");
  assert.equal(first.newlyDead, true);

  const outcome = event("outcome", "outcome", [combatUnit({ hp: 0, alive: false })]);
  const held = deriveBoitataVisualState(corpse, [outcome], defeated);
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

test("3D creature flips its visible side and leans toward the camera without disturbing tactical facing", async () => {
  const source = await readFile(new URL("../app/boitata-3d-layer.tsx", import.meta.url), "utf8");
  const tiltMatch = source.match(/const BOITATA_MODEL_FORWARD_TILT_RADIANS = \((\d+) \* Math\.PI\) \/ 180;/);

  assert.match(source, /const BOITATA_MODEL_YAW_FLIP_RADIANS = Math\.PI;/);
  assert.ok(tiltMatch, "the model should define a small forward tilt in degrees");
  const tiltDegrees = Number(tiltMatch[1]);
  assert.ok(tiltDegrees >= 5 && tiltDegrees <= 15, "the forward tilt should remain subtle");
  assert.match(
    source,
    /rigTemplate\.rotation\.set\(\s*BOITATA_MODEL_FORWARD_TILT_RADIANS,\s*BOITATA_MODEL_YAW_FLIP_RADIANS,\s*0,\s*\)/s,
  );
  assert.ok(
    source.indexOf("rigTemplate.rotation.set(") < source.indexOf("rigTemplate.updateMatrixWorld(true)"),
    "the corrected orientation should be included in model bounds and centering",
  );
  assert.match(source, /modelPivot\.add\(model\);/);
  assert.match(source, /entity\.root\.rotation\.z = entity\.facing \+ deathProgress \* 0\.78;/);
});
