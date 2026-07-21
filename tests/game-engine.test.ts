import assert from "node:assert/strict";
import test from "node:test";
import {
  HEROES,
  REFRESH_COST,
  ROLE_PROFILES,
  XP_BUY_COST,
  applyCombatResult,
  buyPlayerXp,
  buyShopUnit,
  calculateWallOfFireShield,
  createInitialGame,
  getInterest,
  getUnitStats,
  moveUnit,
  refreshShop,
  resolveCombat,
  unitCapForLevel,
  validateState,
  type GameState,
} from "../app/game-engine.ts";

test("initial campaign is deterministic and satisfies placement invariants", () => {
  const first = createInitialGame(12345);
  const second = createInitialGame(12345);
  assert.deepEqual(first, second);
  assert.equal(first.phase, "planning");
  assert.equal(first.gold, 18);
  assert.equal(first.commanderLevel, 3);
  assert.equal(first.units.filter((unit) => unit.position !== null).length, 3);
  assert.equal(first.shop.length, 5);
  assert.deepEqual(validateState(first), []);
});

test("roster exposes nine distinct heroes, abilities, and real trait hooks", () => {
  const heroes = Object.values(HEROES);
  assert.equal(heroes.length, 9);
  assert.equal(new Set(heroes.map((hero) => hero.name)).size, 9);
  assert.equal(new Set(heroes.map((hero) => hero.ability.name)).size, 9);
  assert.ok(heroes.every((hero) => hero.traits.length >= 2));
  assert.equal(HEROES.boitata.portrait, "/characters/boitata.png");
  assert.equal(HEROES.boitata.ability.id, "wall-of-fire");
});

test("combat roles define distinct ranges and every hero inherits its role range", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(ROLE_PROFILES).map(([role, profile]) => [role, profile.range])),
    { tank: 1, carry: 2, mage: 3, shooter: 4 },
  );
  assert.deepEqual(new Set(Object.values(HEROES).map((hero) => hero.role)), new Set(["tank", "carry", "mage", "shooter"]));
  assert.equal(HEROES.boitata.role, "tank");

  const baseUnit = createInitialGame(71).units[0];
  for (const hero of Object.values(HEROES)) {
    const stats = getUnitStats({ ...baseUnit, heroId: hero.id });
    assert.equal(stats.range, ROLE_PROFILES[hero.role].range);
  }
  assert.equal(getUnitStats({ ...baseUnit, heroId: "boitata" }).range, 1);
});

test("Boitata's Wall of Fire shield scales with level, max life, and armor", () => {
  const baseline = calculateWallOfFireShield({ level: 1, maxHp: 216, armor: 28 });
  const higherLevel = calculateWallOfFireShield({ level: 5, maxHp: 216, armor: 28 });
  const higherLife = calculateWallOfFireShield({ level: 1, maxHp: 432, armor: 28 });
  const higherArmor = calculateWallOfFireShield({ level: 1, maxHp: 216, armor: 56 });

  assert.equal(baseline, 95);
  assert.equal(higherLevel, 123);
  assert.equal(higherLife, 134);
  assert.equal(higherArmor, 125);
  assert.ok(higherLevel > baseline);
  assert.ok(higherLife > baseline);
  assert.ok(higherArmor > baseline);
});

test("Boitata casts Wall of Fire on itself and the shield absorbs the next hit", () => {
  const initial = createInitialGame(73);
  const player = {
    ...initial.units[0],
    id: "boitata-player-test",
    heroId: "boitata" as const,
    side: "player" as const,
    position: 40,
    benchIndex: null,
    stars: 1,
    level: 1,
    xp: 0,
  };
  const enemy = {
    ...initial.enemyUnits[0],
    id: "bramble-enemy-test",
    heroId: "bramble" as const,
    side: "enemy" as const,
    position: 32,
    benchIndex: null,
    stars: 1,
    level: 1,
    xp: 0,
  };
  const combat = resolveCombat({ ...initial, units: [player], enemyUnits: [enemy] });

  assert.equal(combat.ok, true);
  const events = combat.report!.events;
  const castIndex = events.findIndex(
    (event) => event.type === "ability" && event.actorId === player.id,
  );
  assert.ok(castIndex > 0);

  const cast = events[castIndex];
  const shielded = cast.snapshot.find((unit) => unit.id === player.id)!;
  const expectedShield = calculateWallOfFireShield(shielded);
  assert.deepEqual(cast.targetIds, [player.id]);
  assert.equal(cast.amount, expectedShield);
  assert.equal(cast.amounts?.[player.id], expectedShield);
  assert.equal(shielded.shield, expectedShield);
  assert.equal(shielded.fireWallShield, expectedShield);
  assert.match(cast.text, /Wall of Fire.*shield/i);

  const absorption = events.slice(castIndex + 1).find(
    (event) => event.type === "attack" && event.targetIds?.includes(player.id),
  );
  assert.ok(absorption);
  const afterHit = absorption.snapshot.find((unit) => unit.id === player.id)!;
  assert.equal(afterHit.hp, shielded.hp);
  assert.equal(afterHit.shield, shielded.shield - absorption.amount!);
  assert.equal(afterHit.fireWallShield, shielded.fireWallShield - absorption.amount!);
});

test("Boitata's fire wall stays distinct from an ally's ordinary ward", () => {
  const initial = createInitialGame(79);
  const playerBase = initial.units[0];
  const enemyBase = initial.enemyUnits[0];
  const boitata = { ...playerBase, id: "mixed-shield-boitata", heroId: "boitata" as const, side: "player" as const, position: 40, benchIndex: null, stars: 1, level: 1, xp: 0 };
  const tide = { ...playerBase, id: "mixed-shield-tide", heroId: "tide" as const, side: "player" as const, position: 47, benchIndex: null, stars: 1, level: 1, xp: 0 };
  const enemy = { ...enemyBase, id: "mixed-shield-enemy", heroId: "bramble" as const, side: "enemy" as const, position: 32, benchIndex: null, stars: 3, level: 5, xp: 0 };
  const combat = resolveCombat({ ...initial, units: [boitata, tide], enemyUnits: [enemy] });

  const events = combat.report!.events;
  const wardIndex = events.findIndex(
    (event) => event.type === "ability" && event.actorId === tide.id && event.targetIds?.includes(boitata.id),
  );
  assert.ok(wardIndex > 0);
  const afterWard = events[wardIndex].snapshot.find((unit) => unit.id === boitata.id)!;
  assert.equal(afterWard.shield - afterWard.fireWallShield, 29);

  const wallBreakWithWardRemaining = events.slice(wardIndex + 1).find((event) => {
    const unit = event.snapshot.find((candidate) => candidate.id === boitata.id);
    return unit && unit.fireWallShield === 0 && unit.shield > 0;
  });
  assert.ok(wallBreakWithWardRemaining);
});

test("basic combat attacks only after a target enters the actor role range", () => {
  const initial = createInitialGame(72);
  const player = initial.units[0];
  const enemy = initial.enemyUnits[0];
  const duel = (heroId: "bramble" | "piper"): GameState => ({
    ...initial,
    units: [{ ...player, heroId, position: 40, benchIndex: null }],
    enemyUnits: [{ ...enemy, heroId: "bramble", position: 8, benchIndex: null }],
  });

  const tankCombat = resolveCombat(duel("bramble"));
  const shooterCombat = resolveCombat(duel("piper"));
  assert.equal(tankCombat.report?.events[1]?.type, "move");
  assert.equal(shooterCombat.report?.events[1]?.type, "attack");
});

test("economy charges exact costs and never mutates a failed transaction", () => {
  const initial = createInitialGame(9);
  const offer = initial.shop.find(Boolean)!;
  const bought = buyShopUnit(initial, offer.id);
  assert.equal(bought.ok, true);
  assert.equal(bought.state.gold, initial.gold - offer.cost);
  assert.equal(initial.gold, 18);

  const refreshed = refreshShop(bought.state);
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.state.gold, bought.state.gold - REFRESH_COST);
  assert.notDeepEqual(refreshed.state.shop, bought.state.shop);

  const poor = { ...initial, gold: 0 };
  const rejected = buyShopUnit(poor, offer.id);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state, poor);
  assert.equal(rejected.state.gold, 0);
  assert.equal(getInterest(100), 5);
});

test("commander XP preserves overflow and increases team cap", () => {
  const initial = createInitialGame(12);
  const result = buyPlayerXp(initial);
  assert.equal(result.ok, true);
  assert.equal(result.state.gold, initial.gold - XP_BUY_COST);
  assert.equal(result.state.commanderLevel, 4);
  assert.equal(result.state.commanderXp, 0);
  assert.equal(unitCapForLevel(result.state.commanderLevel), 4);
});

test("placement supports bench moves and swaps while rejecting enemy territory", () => {
  const initial = createInitialGame(18);
  const bramble = initial.units.find((unit) => unit.heroId === "bramble")!;
  const benched = moveUnit(initial, bramble.id, { kind: "bench", index: 0 });
  assert.equal(benched.ok, true);
  assert.equal(benched.state.units.find((unit) => unit.id === bramble.id)?.benchIndex, 0);
  assert.equal(benched.state.units.find((unit) => unit.id === bramble.id)?.position, null);

  const illegal = moveUnit(benched.state, bramble.id, { kind: "board", index: 2 });
  assert.equal(illegal.ok, false);
  assert.equal(illegal.state, benched.state);

  const nix = benched.state.units.find((unit) => unit.heroId === "nix")!;
  const swapped = moveUnit(benched.state, bramble.id, { kind: "board", index: nix.position! });
  assert.equal(swapped.ok, true);
  assert.equal(swapped.state.units.find((unit) => unit.id === bramble.id)?.position, nix.position);
  assert.equal(swapped.state.units.find((unit) => unit.id === nix.id)?.benchIndex, 0);
  assert.deepEqual(validateState(swapped.state), []);
});

test("three matching copies combine into a higher-star unit with character XP", () => {
  const initial = createInitialGame(21);
  const custom: GameState = {
    ...initial,
    gold: 50,
    shop: [
      { id: "offer-b1", heroId: "bramble", cost: 1 },
      { id: "offer-b2", heroId: "bramble", cost: 1 },
      ...initial.shop.slice(2),
    ],
  };
  const first = buyShopUnit(custom, "offer-b1");
  const second = buyShopUnit(first.state, "offer-b2");
  assert.equal(second.ok, true);
  const brambles = second.state.units.filter((unit) => unit.heroId === "bramble");
  assert.equal(brambles.length, 1);
  assert.equal(brambles[0].stars, 2);
  assert.ok(brambles[0].xp > 0 || brambles[0].level > 1);
});

test("traits alter real combat stats and combat produces attacks, abilities, and bounded meters", () => {
  const initial = createInitialGame(33);
  const tide = {
    ...initial.units[0],
    id: "unit-tide-test",
    heroId: "tide" as const,
    position: 35,
  };
  const custom: GameState = {
    ...initial,
    commanderLevel: 4,
    units: [...initial.units, tide],
  };
  const baseArmor = getUnitStats(initial.units[0]).armor;
  const started = resolveCombat(custom);
  assert.equal(started.ok, true);
  assert.equal(started.state.phase, "combat");
  const report = started.report!;
  const bramble = report.initialUnits.find((unit) => unit.heroId === "bramble")!;
  assert.equal(bramble.armor, baseArmor + 15);
  assert.ok(report.events.some((event) => event.type === "attack"));
  assert.ok(report.events.some((event) => event.type === "ability"));
  assert.ok(report.events.some((event) => event.type === "outcome"));
  for (const event of report.events) {
    for (const unit of event.snapshot) {
      assert.ok(unit.hp >= 0 && unit.hp <= unit.maxHp);
      assert.ok(unit.mana >= 0 && unit.mana <= unit.maxMana);
      assert.ok(unit.shield >= 0);
    }
  }
});

test("round result applies income, life, XP, and rewards exactly once", () => {
  const initial = createInitialGame(44);
  const started = resolveCombat(initial);
  assert.equal(started.ok, true);
  const applied = applyCombatResult(started.state);
  assert.equal(applied.ok, true);
  assert.notEqual(applied.state.phase, "combat");
  assert.equal(applied.state.gold, initial.gold + started.report!.income.total);
  assert.equal(applied.state.life, initial.life - started.report!.playerDamage);
  assert.ok(applied.state.units.some((unit) => unit.xp > 0 || unit.level > 1));

  const duplicate = applyCombatResult(applied.state);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.state, applied.state);
});

test("round ten always closes the campaign with the combat outcome", () => {
  const state = createInitialGame(818);
  state.round = 10;
  const combat = resolveCombat(state);
  assert.equal(combat.ok, true);
  assert.ok(combat.report);
  const forcedDefeat: GameState = {
    ...combat.state,
    combatReport: {
      ...combat.report!,
      outcome: "defeat",
      playerDamage: 3,
    },
  };
  const resolved = applyCombatResult(forcedDefeat);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.state.phase, "gameover");
  assert.equal(resolved.state.campaignOutcome, "defeat");
});
