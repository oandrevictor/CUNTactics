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

test("derives movement from the engine-authored route and faces the actor target", () => {
  const before = event("before-move", "start", [
    combatUnit({ position: 47 }),
    combatUnit({ id: ENEMY_ID, heroId: "bramble", side: "enemy", position: 16 }),
  ]);
  const after = event(
    "move",
    "move",
    [
      combatUnit({ position: 32 }),
      combatUnit({ id: ENEMY_ID, heroId: "bramble", side: "enemy", position: 16 }),
    ],
    {
      actorId: BOITATA_ID,
      targetIds: [ENEMY_ID],
      durationSeconds: 2.4,
      fromPosition: 40,
      toPosition: 32,
    },
  );

  const state = deriveBoitataVisualState(renderUnit({ position: 32 }), [after], before);
  assert.equal(state.motion, "move");
  assert.equal(state.fromPosition, 40);
  assert.equal(state.position, 32);
  assert.equal(state.facingPosition, 16);
  assert.equal(state.startTime, after.timestamp);
  assert.equal(state.durationSeconds, 2.4);
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
  assert.equal(state.bodyCueKey, "boitata-attacks:attack");
  assert.equal(state.hitCueKey, "enemy-attacks:hit");
  assert.equal(state.hitStartTime, incomingAttack.timestamp);
  assert.equal(state.hitDurationSeconds, incomingAttack.durationSeconds);
  assert.equal(state.durationSeconds, ownAttack.durationSeconds);
});

test("does not restart a body cue when an unrelated overlapping event appears", () => {
  const enemy = combatUnit({ id: ENEMY_ID, heroId: "nix", side: "enemy", position: 24 });
  const healer = combatUnit({ id: HEALER_ID, heroId: "tide", side: "player", position: 41 });
  const snapshot = [combatUnit(), enemy, healer];
  const ownAttack = event(
    "boitata-attacks",
    "attack",
    snapshot,
    { actorId: BOITATA_ID, targetIds: [ENEMY_ID], durationSeconds: 1.7 },
  );
  const unrelatedHeal = event(
    "healer-acts",
    "heal",
    snapshot,
    { actorId: HEALER_ID, targetIds: [HEALER_ID], durationSeconds: 0.6 },
  );

  const withoutOverlap = deriveBoitataVisualState(renderUnit(), [ownAttack]);
  const withOverlap = deriveBoitataVisualState(renderUnit(), [ownAttack, unrelatedHeal]);

  assert.equal(withOverlap.bodyCueKey, withoutOverlap.bodyCueKey);
  assert.equal(withOverlap.durationSeconds, 1.7);
});

test("body and wall reactions keep their own overlapping source timelines", () => {
  const olderAttacker = combatUnit({ id: ENEMY_ID, heroId: "nix", side: "enemy", position: 24 });
  const newerAttacker = combatUnit({ id: "newer-enemy", heroId: "vesper", side: "enemy", position: 32 });
  const snapshot = [combatUnit({ hp: 170, shield: 20, fireWallShield: 20 }), olderAttacker, newerAttacker];
  const before = event(
    "before-overlap",
    "start",
    [combatUnit({ hp: 180, shield: 50, fireWallShield: 50 }), olderAttacker, newerAttacker],
  );
  const olderHit = event(
    "older-hit",
    "attack",
    snapshot,
    {
      timestamp: 1,
      durationSeconds: 3,
      actorId: olderAttacker.id,
      targetIds: [BOITATA_ID],
      amount: 10,
      shieldAbsorbedAmounts: { [BOITATA_ID]: 10 },
      fireWallAbsorbedAmounts: { [BOITATA_ID]: 10 },
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
      targetIds: [BOITATA_ID],
      amount: 20,
    },
  );

  const state = deriveBoitataVisualState(
    renderUnit({ hp: 170, fireWallShield: 20 }),
    [newerHit, olderHit],
    before,
  );

  assert.equal(state.motion, "hit");
  assert.equal(state.bodyCueKey, "newer-hit:hit");
  assert.equal(state.hitCueKey, "newer-hit:hit");
  assert.equal(state.startTime, 2);
  assert.equal(state.durationSeconds, 1.25);
  assert.equal(state.hitStartTime, 2);
  assert.equal(state.hitDurationSeconds, 1.25);
  assert.equal(state.shieldDamage, 10);
  assert.equal(state.shieldCueKey, "older-hit:shield-hit");
  assert.equal(state.shieldStartTime, 1);
  assert.equal(state.shieldDurationSeconds, 3);
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
    {
      actorId: ENEMY_ID,
      targetIds: [BOITATA_ID],
      shieldAbsorbedAmounts: { [BOITATA_ID]: 40 },
      fireWallAbsorbedAmounts: { [BOITATA_ID]: 40 },
    },
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

test("the newest overlapping wall source controls the 3D shield timeline", () => {
  const attacker = combatUnit({ id: ENEMY_ID, heroId: "nix", side: "enemy", position: 32 });
  const snapshot = [
    combatUnit({ shield: 71, fireWallShield: 71 }),
    attacker,
  ];
  const olderCast = event(
    "older-wall-cast",
    "ability",
    snapshot,
    {
      timestamp: 1,
      durationSeconds: 3,
      actorId: BOITATA_ID,
      targetIds: [BOITATA_ID],
    },
  );
  const newerImpact = event(
    "newer-wall-impact",
    "attack",
    snapshot,
    {
      timestamp: 2,
      durationSeconds: 1.25,
      actorId: ENEMY_ID,
      targetIds: [BOITATA_ID],
      amount: 24,
      shieldAbsorbedAmounts: { [BOITATA_ID]: 24 },
      fireWallAbsorbedAmounts: { [BOITATA_ID]: 24 },
    },
  );

  const impactState = deriveBoitataVisualState(
    renderUnit({ fireWallShield: 71 }),
    [newerImpact, olderCast],
  );
  assert.equal(impactState.motion, "cast");
  assert.equal(impactState.bodyCueKey, "older-wall-cast:cast");
  assert.equal(impactState.hitCueKey, "newer-wall-impact:hit");
  assert.equal(impactState.shieldMotion, "shield-hit");
  assert.equal(impactState.shieldCueKey, "newer-wall-impact:shield-hit");
  assert.equal(impactState.shieldStartTime, 2);
  assert.equal(impactState.shieldDurationSeconds, 1.25);

  const olderBreak = event(
    "older-wall-break",
    "attack",
    snapshot,
    {
      timestamp: 1,
      durationSeconds: 3,
      actorId: ENEMY_ID,
      targetIds: [BOITATA_ID],
      amount: 24,
      shieldAbsorbedAmounts: { [BOITATA_ID]: 24 },
      fireWallAbsorbedAmounts: { [BOITATA_ID]: 24 },
      fireWallBrokenTargetIds: [BOITATA_ID],
    },
  );
  const newerCast = event(
    "newer-wall-cast",
    "ability",
    snapshot,
    {
      timestamp: 2,
      durationSeconds: 1.8,
      actorId: BOITATA_ID,
      targetIds: [BOITATA_ID],
    },
  );

  const castState = deriveBoitataVisualState(
    renderUnit({ fireWallShield: 71 }),
    [newerCast, olderBreak],
  );
  assert.equal(castState.shieldMotion, "cast");
  assert.equal(castState.shieldCueKey, "newer-wall-cast:cast");
  assert.equal(castState.shieldStartTime, 2);
  assert.equal(castState.shieldDurationSeconds, 1.8);
});

test("keeps a wall impact on its source interval after an unrelated later snapshot", () => {
  const attacker = combatUnit({ id: ENEMY_ID, heroId: "bramble", side: "enemy", position: 32 });
  const healer = combatUnit({ id: HEALER_ID, heroId: "tide", side: "player", position: 41 });
  const afterHitSnapshot = [
    combatUnit({ shield: 55, fireWallShield: 55 }),
    attacker,
    healer,
  ];
  const shieldHit = event(
    "persistent-shield-hit",
    "attack",
    afterHitSnapshot,
    {
      timestamp: 1,
      durationSeconds: 3,
      actorId: ENEMY_ID,
      targetIds: [BOITATA_ID],
      amount: 40,
      shieldAbsorbedAmounts: { [BOITATA_ID]: 40 },
      fireWallAbsorbedAmounts: { [BOITATA_ID]: 40 },
    },
  );
  const unrelatedHeal = event(
    "later-unrelated-heal",
    "heal",
    afterHitSnapshot,
    {
      timestamp: 2,
      durationSeconds: 0.6,
      actorId: HEALER_ID,
      targetIds: [HEALER_ID],
      amount: 10,
    },
  );

  const state = deriveBoitataVisualState(
    renderUnit({ fireWallShield: 55 }),
    [shieldHit, unrelatedHeal],
    shieldHit,
  );

  assert.equal(state.shieldMotion, "shield-hit");
  assert.equal(state.shieldDamage, 40);
  assert.equal(state.shieldCueKey, "persistent-shield-hit:shield-hit");
  assert.equal(state.shieldStartTime, 1);
  assert.equal(state.shieldDurationSeconds, 3);
});

test("keeps a wall break on its source interval after an unrelated later snapshot", () => {
  const attacker = combatUnit({ id: ENEMY_ID, heroId: "bramble", side: "enemy", position: 32 });
  const healer = combatUnit({ id: HEALER_ID, heroId: "tide", side: "player", position: 41 });
  const afterBreakSnapshot = [
    combatUnit({ shield: 0, fireWallShield: 0 }),
    attacker,
    healer,
  ];
  const shieldBreak = event(
    "persistent-shield-break",
    "attack",
    afterBreakSnapshot,
    {
      timestamp: 1,
      durationSeconds: 3,
      actorId: ENEMY_ID,
      targetIds: [BOITATA_ID],
      amount: 20,
      shieldAbsorbedAmounts: { [BOITATA_ID]: 20 },
      fireWallAbsorbedAmounts: { [BOITATA_ID]: 20 },
      fireWallBrokenTargetIds: [BOITATA_ID],
    },
  );
  const unrelatedHeal = event(
    "later-unrelated-heal",
    "heal",
    afterBreakSnapshot,
    {
      timestamp: 2,
      durationSeconds: 0.6,
      actorId: HEALER_ID,
      targetIds: [HEALER_ID],
      amount: 10,
    },
  );

  const state = deriveBoitataVisualState(
    renderUnit({ fireWallShield: 0 }),
    [shieldBreak, unrelatedHeal],
    shieldBreak,
  );

  assert.equal(state.shieldMotion, "shield-break");
  assert.equal(state.shieldDamage, 20);
  assert.equal(state.shieldCueKey, "persistent-shield-break:shield-break");
  assert.equal(state.shieldStartTime, 1);
  assert.equal(state.shieldDurationSeconds, 3);
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
    {
      actorId: ENEMY_ID,
      targetIds: [BOITATA_ID],
      amount: 32,
      shieldAbsorbedAmounts: { [BOITATA_ID]: 20 },
      fireWallAbsorbedAmounts: { [BOITATA_ID]: 20 },
      fireWallBrokenTargetIds: [BOITATA_ID],
    },
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

test("3D action poses project directly from the authoritative combat clock", async () => {
  const source = await readFile(new URL("../app/boitata-3d-layer.tsx", import.meta.url), "utf8");

  assert.match(source, /combatTime: number/);
  assert.match(source, /combatEventProgress\(\{ timestamp: startTime, durationSeconds \}, combatTime\)/);
  assert.match(source, /visual\.startTime,[\s\S]+visual\.durationSeconds,[\s\S]+latest\.combatTime/);
  assert.match(source, /visual\.hitStartTime,[\s\S]+visual\.hitDurationSeconds,[\s\S]+latest\.combatTime/);
  assert.match(source, /visual\.shieldStartTime,[\s\S]+visual\.shieldDurationSeconds,[\s\S]+latest\.combatTime/);
  assert.doesNotMatch(source, /attackAnimationSeconds|movementTravelSeconds|bodyElapsed|shieldElapsed|actionDuration|latest\.speed/);
  assert.doesNotMatch(source, /\?\s*0\.46|\?\s*0\.72/);
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
