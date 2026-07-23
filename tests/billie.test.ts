import assert from "node:assert/strict";
import test from "node:test";

import {
  HEROES,
  createInitialGame,
  getAbilityPreview,
  getCombatStatistics,
  resolveCombat,
  type CombatEvent,
  type CombatReport,
  type CraftedItem,
  type GameState,
  type HeroId,
  type UnitInstance,
  type UnitItemSlots,
} from "../app/game-engine.ts";

const EMPTY_SLOTS: UnitItemSlots = [null, null, null];

function enhancedItem(
  id: string,
  itemId: CraftedItem["itemId"],
  enhancement: NonNullable<CraftedItem["enhancement"]>,
): CraftedItem {
  return { id, itemId, tier: "enhanced", enhancement };
}

function manaLoadout(prefix: string): UnitItemSlots {
  return [1, 2, 3].map((index) =>
    enhancedItem(`${prefix}-lantern-${index}`, "spirit-lantern", "mote"),
  ) as UnitItemSlots;
}

function fortressLoadout(prefix: string): UnitItemSlots {
  return [1, 2, 3].map((index) =>
    enhancedItem(`${prefix}-plate-${index}`, "cinderplate", "scale"),
  ) as UnitItemSlots;
}

function unit(
  base: UnitInstance,
  heroId: HeroId,
  id: string,
  position: number,
  overrides: Partial<UnitInstance> = {},
): UnitInstance {
  return {
    ...base,
    id,
    heroId,
    stars: 1,
    level: 1,
    xp: 0,
    position,
    benchIndex: null,
    itemSlots: [...EMPTY_SLOTS] as UnitItemSlots,
    ...overrides,
  };
}

function billie(
  base: UnitInstance,
  id: string,
  position: number,
  stars: 1 | 2 | 3 = 1,
): UnitInstance {
  return unit(base, "billie", id, position, {
    stars,
    itemSlots: manaLoadout(id),
  });
}

function combatState(
  seed: number,
  players: (initial: GameState) => UnitInstance[],
  enemies: (initial: GameState) => UnitInstance[],
): GameState {
  const initial = createInitialGame(seed);
  return {
    ...initial,
    commanderLevel: 8,
    units: players(initial),
    enemyUnits: enemies(initial),
  };
}

function reportFor(state: GameState): CombatReport {
  const result = resolveCombat(state);
  assert.equal(result.ok, true);
  assert.ok(result.report);
  return result.report;
}

function firstBillieCast(report: CombatReport, actorId = "billie"): CombatEvent {
  const cast = report.events.find(
    (event) => event.type === "ability" && event.actorId === actorId,
  );
  assert.ok(cast, `expected ${actorId} to cast Birds of a Feather`);
  return cast;
}

function eventBefore(report: CombatReport, event: CombatEvent) {
  const index = report.events.findIndex((candidate) => candidate.id === event.id);
  assert.ok(index >= 0, `expected ${event.id} in its combat report`);
  return index === 0 ? report.initialUnits : report.events[index - 1].snapshot;
}

function mitigatedDamage(rawDamage: number, armor: number): number {
  return Math.max(1, Math.round((rawDamage * 100) / (100 + armor)));
}

test("Billie is a mythic Invoker Duelist shooter with Birds of a Feather", () => {
  assert.deepEqual(
    {
      name: HEROES.billie.name,
      cost: HEROES.billie.cost,
      rarity: HEROES.billie.rarity,
      role: HEROES.billie.role,
      traits: HEROES.billie.traits,
      abilityId: HEROES.billie.ability.id,
      abilityName: HEROES.billie.ability.name,
    },
    {
      name: "Billie",
      cost: 4,
      rarity: "mythic",
      role: "shooter",
      traits: ["invoker", "duelist"],
      abilityId: "birds-of-a-feather",
      abilityName: "Birds of a Feather",
    },
  );
});

test("Birds of a Feather previews every exact summon and follow-up star value", () => {
  const initial = createInitialGame(8201);
  const caster = billie(initial.units[0], "preview-billie", 40, 2);
  const preview = getAbilityPreview(caster, [caster]);

  assert.deepEqual(
    preview.byStar.map((values) => ({
      summonCount: values.summonCount,
      summonDamage: values.summonDamage,
      birdAttackPercent: values.birdAttackPercent,
      targets: values.maxTargets,
    })),
    [
      { summonCount: 2, summonDamage: 50, birdAttackPercent: 20, targets: 1 },
      { summonCount: 2, summonDamage: 75, birdAttackPercent: 25, targets: 1 },
      { summonCount: 2, summonDamage: 100, birdAttackPercent: 40, targets: 1 },
    ],
  );
  assert.deepEqual(preview.current, preview.byStar[1]);
  assert.match(preview.scalingDescription, /\(50\/75\/100\)/);
  assert.match(preview.scalingDescription, /\(20\/25\/40\)%/);
  assert.match(preview.scalingDescription, /2 birds/i);
});

test("the summoned pair locks the lowest absolute-Life enemy and deals damage once per bird", () => {
  const report = reportFor(combatState(
    8202,
    (initial) => [billie(initial.units[0], "billie", 40)],
    (initial) => [
      unit(initial.enemyUnits[0], "boitata", "a-higher-life", 32),
      unit(initial.enemyUnits[1], "piper", "z-lowest-life", 33),
    ],
  ));
  const cast = firstBillieCast(report);
  const before = eventBefore(report, cast);
  const targetBefore = before.find((candidate) => candidate.id === "z-lowest-life")!;
  const targetAfter = cast.snapshot.find((candidate) => candidate.id === "z-lowest-life")!;
  const billieAfter = cast.snapshot.find((candidate) => candidate.id === "billie")!;
  const appliedEach = mitigatedDamage(50, targetBefore.armor);

  assert.ok(
    targetBefore.hp < before.find((candidate) => candidate.id === "a-higher-life")!.hp,
    "the target fixture must distinguish absolute Life while both enemies are at 100% Life",
  );
  assert.deepEqual(cast.targetIds, ["z-lowest-life"]);
  assert.equal(cast.birdCount, 2);
  assert.equal(cast.birdDamageEach, 50);
  assert.equal(cast.birdAttackPercent, 20);
  assert.equal(cast.amount, appliedEach * 2);
  assert.equal(cast.amounts?.["z-lowest-life"], appliedEach * 2);
  assert.equal(targetBefore.hp - targetAfter.hp, appliedEach * 2);
  assert.equal(billieAfter.summonedBirds, 2);
});

test("Billie's basic attack and flock volley resolve separately against independent targets", () => {
  const report = reportFor(combatState(
    8203,
    (initial) => [billie(initial.units[0], "billie", 40, 2)],
    (initial) => [
      unit(initial.enemyUnits[0], "boitata", "near-tank", 32, {
        stars: 3,
        level: 3,
      }),
      unit(initial.enemyUnits[1], "piper", "far-wounded", 33, {
        stars: 3,
        level: 3,
      }),
    ],
  ));
  const cast = firstBillieCast(report);
  const attackIndex = report.events.findIndex((event) =>
    event.type === "attack"
      && event.actorId === "billie"
      && event.timestamp > cast.timestamp,
  );
  assert.ok(attackIndex >= 0, "expected Billie to make a basic attack after summoning");
  const attack = report.events[attackIndex];
  const volley = report.events[attackIndex + 1];
  assert.ok(volley, "expected the flock volley immediately after Billie's attack");

  const billieAtAttack = attack.snapshot.find((candidate) => candidate.id === "billie")!;
  const targetBeforeVolley = attack.snapshot.find((candidate) => candidate.id === "far-wounded")!;
  const targetAfterVolley = volley.snapshot.find((candidate) => candidate.id === "far-wounded")!;
  const rawDamageEach = Math.round(billieAtAttack.attack * 0.25);
  const appliedEach = mitigatedDamage(rawDamageEach, targetBeforeVolley.armor);

  assert.deepEqual(attack.targetIds, ["near-tank"]);
  assert.equal(volley.type, "passive");
  assert.equal(volley.actorId, "billie");
  assert.equal(volley.timestamp, attack.timestamp);
  assert.equal(volley.turn, attack.turn);
  assert.deepEqual(volley.targetIds, ["far-wounded"]);
  assert.equal(volley.birdCount, 2);
  assert.equal(volley.birdAttackPercent, 25);
  assert.equal(volley.birdDamageEach, rawDamageEach);
  assert.equal(volley.amount, appliedEach * 2);
  assert.equal(volley.amounts?.["far-wounded"], appliedEach * 2);
  assert.equal(targetBeforeVolley.hp - targetAfterVolley.hp, appliedEach * 2);
});

test("recasts add two birds, damage only with the new pair, and unleash the accumulated flock", () => {
  const report = reportFor(combatState(
    8204,
    (initial) => [
      billie(initial.units[0], "billie", 40, 3),
      unit(initial.units[1], "boitata", "guardian", 24, {
        stars: 3,
        level: 5,
        itemSlots: fortressLoadout("guardian"),
      }),
    ],
    (initial) => [
      unit(initial.enemyUnits[0], "boitata", "fortress", 16, {
        stars: 3,
        level: 5,
        itemSlots: fortressLoadout("fortress"),
      }),
    ],
  ));
  const casts = report.events.filter(
    (event) => event.type === "ability" && event.actorId === "billie",
  );
  assert.ok(casts.length >= 2, "the durable duel should allow Billie to summon twice");
  const [firstCast, secondCast] = casts;
  const firstBillie = firstCast.snapshot.find((candidate) => candidate.id === "billie")!;
  const secondBillie = secondCast.snapshot.find((candidate) => candidate.id === "billie")!;
  const fortressBeforeSecondCast = eventBefore(report, secondCast)
    .find((candidate) => candidate.id === "fortress")!;
  const secondSummonDamageEach = mitigatedDamage(100, fortressBeforeSecondCast.armor);

  assert.equal(firstCast.birdCount, 2);
  assert.equal(firstCast.birdDamageEach, 100);
  assert.equal(firstBillie.summonedBirds, 2);
  assert.equal(secondCast.birdCount, 2, "only the newly summoned pair attacks on a cast");
  assert.equal(secondCast.birdDamageEach, 100);
  assert.equal(secondCast.amount, secondSummonDamageEach * 2);
  assert.equal(secondBillie.summonedBirds, 4);

  const accumulatedVolley = report.events.find((event) =>
    event.type === "passive"
      && event.actorId === "billie"
      && event.timestamp > secondCast.timestamp
      && event.birdCount === 4,
  );
  assert.ok(accumulatedVolley, "Billie's next attack should command all four birds");
  const beforeVolley = eventBefore(report, accumulatedVolley);
  const billieBeforeVolley = beforeVolley.find((candidate) => candidate.id === "billie")!;
  const fortressBeforeVolley = beforeVolley.find((candidate) => candidate.id === "fortress")!;
  const rawDamageEach = Math.round(billieBeforeVolley.attack * 0.4);
  const appliedEach = mitigatedDamage(rawDamageEach, fortressBeforeVolley.armor);

  assert.equal(accumulatedVolley.birdAttackPercent, 40);
  assert.equal(accumulatedVolley.birdDamageEach, rawDamageEach);
  assert.equal(accumulatedVolley.amount, appliedEach * 4);
  assert.equal(
    accumulatedVolley.amounts?.fortress,
    appliedEach * 4,
  );
  assert.equal(report.initialUnits.find((candidate) => candidate.id === "billie")?.summonedBirds, 0);
});

test("combat statistics credit every summon and flock hit to Billie", () => {
  const report = reportFor(combatState(
    8205,
    (initial) => [billie(initial.units[0], "billie", 40)],
    (initial) => [
      unit(initial.enemyUnits[0], "boitata", "statistics-target", 32, {
        stars: 3,
        level: 5,
        itemSlots: fortressLoadout("statistics-target"),
      }),
    ],
  ));
  const recordedDamage = report.events
    .filter((event) => event.actorId === "billie")
    .reduce((total, event) => total + (event.amount ?? 0), 0);
  const statistics = getCombatStatistics(report);
  const billieStatistics = statistics.units.find((unitStats) => unitStats.unitId === "billie")!;

  assert.ok(report.events.some((event) => event.actorId === "billie" && event.type === "passive"));
  assert.ok(recordedDamage > 0);
  assert.equal(billieStatistics.damageDealt, recordedDamage);
});
