import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  HEROES,
  createInitialGame,
  getAbilityPreview,
  refreshShop,
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

function fullItem(id: string, itemId: CraftedItem["itemId"]): CraftedItem {
  return { id, itemId, tier: "full", enhancement: null };
}

function enhancedItem(
  id: string,
  itemId: CraftedItem["itemId"],
  enhancement: NonNullable<CraftedItem["enhancement"]>,
): CraftedItem {
  return { id, itemId, tier: "enhanced", enhancement };
}

function lanterns(prefix: string): UnitItemSlots {
  return [
    fullItem(`${prefix}-lantern-1`, "spirit-lantern"),
    fullItem(`${prefix}-lantern-2`, "spirit-lantern"),
    fullItem(`${prefix}-lantern-3`, "spirit-lantern"),
  ];
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
    itemSlots: EMPTY_SLOTS,
    ...overrides,
  };
}

function elphaba(
  base: UnitInstance,
  id: string,
  position: number,
  stars: 1 | 2 | 3 = 1,
): UnitInstance {
  return unit(base, "elphaba", id, position, {
    stars,
    itemSlots: lanterns(id),
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

function firstElphabaCast(report: CombatReport, actorId = "elphaba"): CombatEvent {
  const event = report.events.find(
    (candidate) => candidate.type === "ability" && candidate.actorId === actorId,
  );
  assert.ok(event, `expected ${actorId} to cast Defying Gravity`);
  return event;
}

function firstElphabaLanding(report: CombatReport, actorId = "elphaba"): CombatEvent {
  const event = report.events.find(
    (candidate) => candidate.type === "landing" && candidate.actorId === actorId,
  );
  assert.ok(event, `expected ${actorId}'s lifted targets to land`);
  return event;
}

function snapshotBefore(report: CombatReport, timestamp: number) {
  return [...report.events]
    .reverse()
    .find((event) => event.timestamp < timestamp)?.snapshot ?? report.initialUnits;
}

function roundCombatTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

test("Elphaba is a rare three-cost Hexer and Starborn mage", () => {
  assert.deepEqual(
    {
      name: HEROES.elphaba.name,
      cost: HEROES.elphaba.cost,
      rarity: HEROES.elphaba.rarity,
      role: HEROES.elphaba.role,
      traits: HEROES.elphaba.traits,
      abilityId: HEROES.elphaba.ability.id,
      abilityName: HEROES.elphaba.ability.name,
      targetRule: HEROES.elphaba.ability.targetRule,
    },
    {
      name: "Elphaba",
      cost: 3,
      rarity: "rare",
      role: "mage",
      traits: ["hexer", "starborn"],
      abilityId: "defying-gravity",
      abilityName: "Defying Gravity",
      targetRule: "Highest-current-Life enemies",
    },
  );
  assert.equal(Object.values(HEROES).length, 11);
  assert.equal(new Set(Object.values(HEROES).map((hero) => hero.name)).size, 11);
});

test("Defying Gravity previews every exact star value and its dynamic true-damage rules", () => {
  const initial = createInitialGame(7101);
  const caster = elphaba(initial.units[0], "preview-elphaba", 40, 2);
  const preview = getAbilityPreview(caster, [caster]);

  assert.deepEqual(
    preview.byStar.map((values) => ({
      targets: values.maxTargets,
      lift: values.liftDurationSeconds,
      stun: values.stunDurationSeconds,
      currentHealthDamage: values.currentHealthDamagePercent,
      trueDamage: values.ignoresArmor,
    })),
    [
      { targets: 1, lift: 0.5, stun: 0.25, currentHealthDamage: 10, trueDamage: true },
      { targets: 1, lift: 0.65, stun: 0.25, currentHealthDamage: 12, trueDamage: true },
      { targets: 3, lift: 1, stun: 0.5, currentHealthDamage: 15, trueDamage: true },
    ],
  );
  assert.deepEqual(preview.current, preview.byStar[1]);
  assert.equal(preview.current.damage, 0, "dynamic current-Life damage must not masquerade as flat damage");
  assert.match(preview.scalingDescription, /\(1\/1\/3\)/);
  assert.match(preview.scalingDescription, /\(0\.5\/0\.65\/1\) seconds/);
  assert.match(preview.scalingDescription, /\(10\/12\/15\)%/);
  assert.match(preview.scalingDescription, /\(0\.25\/0\.25\/0\.5\) seconds/);
  assert.match(preview.contextNote, /current Life at the instant they fall/i);
  assert.match(preview.contextNote, /ignores Armor/i);
  assert.ok(!preview.modifiers.some((modifier) => /\+\d+ Attack/.test(modifier)));
});

test("Starborn scales Defying Gravity's percentage while Hexer exposes landing mana drain", () => {
  const initial = createInitialGame(7102);
  const caster = elphaba(initial.units[0], "bonded-elphaba", 40, 1);
  const sol = unit(initial.units[1], "sol", "bonded-sol", 41);
  const vesper = unit(initial.units[2], "vesper", "bonded-vesper", 42);
  const preview = getAbilityPreview(caster, [caster, sol, vesper]);

  assert.deepEqual(
    preview.byStar.map((values) => values.currentHealthDamagePercent),
    [11.5, 13.8, 17.25],
  );
  assert.ok(preview.byStar.every((values) => values.manaDrain === 12));
  assert.ok(preview.modifiers.includes("Bond · Starborn +15% ability damage"));
  assert.ok(preview.modifiers.includes("Bond · Hexer drains 12 Mana from ability targets"));
});

test("Elphaba is gated out below level five and appears as a three-cost shop offer from level five", () => {
  const initial = createInitialGame(7103);
  const shopsAt = (level: number) => Array.from({ length: 512 }, (_, seed) => {
    const market = refreshShop({
      ...initial,
      commanderLevel: level,
      gold: 999,
      seed,
    }, true);
    assert.equal(market.ok, true);
    return market.state.shop;
  });

  assert.ok(shopsAt(4).every((shop) => shop.every((offer) => offer?.heroId !== "elphaba")));
  const elphabaOffers = shopsAt(5)
    .flat()
    .filter((offer) => offer?.heroId === "elphaba");
  assert.ok(elphabaOffers.length > 0, "level-five seeded markets should be able to roll Elphaba");
  assert.ok(elphabaOffers.every((offer) => offer?.cost === 3));
});

test("Defying Gravity selects the highest-current-Life enemies with stable distance and id ties", () => {
  const oneStar = reportFor(combatState(
    7104,
    (initial) => [elphaba(initial.units[0], "elphaba", 40)],
    (initial) => [
      unit(initial.enemyUnits[0], "boitata", "z-far-high", 8),
      unit(initial.enemyUnits[1], "boitata", "z-near-high", 32),
      unit(initial.enemyUnits[2], "boitata", "a-near-high", 41),
      unit(initial.enemyUnits[3], "bramble", "lower-life", 39),
    ],
  ));
  assert.deepEqual(firstElphabaCast(oneStar).liftedTargetIds, ["a-near-high"]);

  const threeStar = reportFor(combatState(
    7105,
    (initial) => [elphaba(initial.units[0], "elphaba", 40, 3)],
    (initial) => [
      unit(initial.enemyUnits[0], "boitata", "highest", 32),
      unit(initial.enemyUnits[1], "bramble", "second", 33),
      unit(initial.enemyUnits[2], "tide", "third", 34),
      unit(initial.enemyUnits[3], "morrow", "fourth", 35),
    ],
  ));
  assert.deepEqual(firstElphabaCast(threeStar).liftedTargetIds, ["highest", "second", "third"]);
});

test("each star rank lands at the exact delayed timestamp and exposes structured metadata", () => {
  const expected = [
    { stars: 1, lift: 0.5, stun: 0.25, damage: 10, landingAt: 1.889 },
    { stars: 2, lift: 0.65, stun: 0.25, damage: 12, landingAt: 2.039 },
    { stars: 3, lift: 1, stun: 0.5, damage: 15, landingAt: 2.389 },
  ] as const;

  for (const values of expected) {
    const report = reportFor(combatState(
      7110 + values.stars,
      (initial) => [elphaba(initial.units[0], "elphaba", 40, values.stars)],
      (initial) => [unit(initial.enemyUnits[0], "boitata", "anchor", 32)],
    ));
    const cast = firstElphabaCast(report);
    const landing = firstElphabaLanding(report);
    const anchorAtCast = cast.snapshot.find((candidate) => candidate.id === "anchor")!;
    const anchorAtLanding = landing.snapshot.find((candidate) => candidate.id === "anchor")!;

    assert.equal(cast.timestamp, 1.389);
    assert.equal(cast.liftDurationSeconds, values.lift);
    assert.equal(cast.stunDurationSeconds, values.stun);
    assert.equal(cast.currentHealthDamagePercent, values.damage);
    assert.equal(cast.landingAt, values.landingAt);
    assert.deepEqual(cast.liftedTargetIds, ["anchor"]);
    assert.equal(anchorAtCast.levitatingUntil, values.landingAt);

    assert.equal(landing.timestamp, values.landingAt);
    assert.equal(landing.landingAt, values.landingAt);
    assert.equal(roundCombatTime(landing.timestamp - cast.timestamp), values.lift);
    assert.deepEqual(landing.liftedTargetIds, ["anchor"]);
    assert.deepEqual(landing.targetIds, []);
    assert.equal(anchorAtLanding.levitatingUntil, 0);
  }
});

test("a levitated unit loses scheduled actions until landing without consuming Vesper's legacy stun", () => {
  const report = reportFor(combatState(
    7114,
    (initial) => [elphaba(initial.units[0], "elphaba", 34, 2)],
    (initial) => [unit(initial.enemyUnits[0], "nix", "lifted-nix", 18, {
      stars: 3,
      level: 5,
    })],
  ));
  const cast = firstElphabaCast(report);
  const landing = firstElphabaLanding(report);
  const suppressed = report.events.find(
    (event) => event.actorId === "lifted-nix" && event.timestamp === 1.905,
  );

  assert.equal(cast.timestamp, 1.389);
  assert.equal(landing.timestamp, 2.039);
  assert.ok(suppressed);
  assert.equal(suppressed.type, "move");
  assert.match(suppressed.text, /levitating and cannot act/i);
  const suppressedNix = suppressed.snapshot.find((candidate) => candidate.id === "lifted-nix")!;
  assert.equal(suppressedNix.levitatingUntil, 2.039);
  assert.equal(suppressedNix.stunned, 0);
  assert.ok(!report.events.some((event) =>
    event.actorId === "lifted-nix"
      && event.timestamp > cast.timestamp
      && event.timestamp < landing.timestamp
      && (event.type === "attack" || event.type === "ability"),
  ));
});

test("landing hits only orthogonal non-anchor enemies", () => {
  const adjacentIds = ["north", "west", "east", "south"];
  const diagonalIds = ["north-west", "north-east", "south-west", "south-east"];
  const report = reportFor(combatState(
    7115,
    (initial) => [
      elphaba(initial.units[0], "elphaba", 42),
      unit(initial.units[1], "bramble", "frontline-decoy", 34, { stars: 3, level: 5 }),
    ],
    (initial) => [
      unit(initial.enemyUnits[0], "boitata", "anchor", 18),
      unit(initial.enemyUnits[1], "piper", "north", 10),
      unit(initial.enemyUnits[2], "piper", "west", 17),
      unit(initial.enemyUnits[3], "piper", "east", 19),
      unit(initial.enemyUnits[0], "piper", "south", 26),
      unit(initial.enemyUnits[1], "piper", "north-west", 9),
      unit(initial.enemyUnits[2], "piper", "north-east", 11),
      unit(initial.enemyUnits[3], "piper", "south-west", 25),
      unit(initial.enemyUnits[0], "piper", "south-east", 27),
    ],
  ));
  const cast = firstElphabaCast(report);
  const landing = firstElphabaLanding(report);
  const before = snapshotBefore(report, landing.timestamp);
  const anchorBefore = before.find((candidate) => candidate.id === "anchor")!;
  const expectedDamage = Math.round(anchorBefore.hp * 0.1);

  assert.deepEqual(landing.liftedTargetIds, ["anchor"]);
  assert.deepEqual(landing.targetIds, [...adjacentIds].sort());
  assert.ok(!landing.targetIds?.includes("anchor"));
  assert.equal(landing.currentHealthDamagePercent, 10);
  assert.equal(landing.amount, expectedDamage * adjacentIds.length);

  for (const targetId of adjacentIds) {
    assert.equal(landing.amounts?.[targetId], expectedDamage);
    const targetBefore = before.find((candidate) => candidate.id === targetId)!;
    const targetAfter = landing.snapshot.find((candidate) => candidate.id === targetId)!;
    assert.equal(targetBefore.hp - targetAfter.hp, expectedDamage);
    assert.equal(targetAfter.stunnedUntil, 2.139);
  }
  for (const targetId of ["anchor", ...diagonalIds]) {
    const targetAtCast = cast.snapshot.find((candidate) => candidate.id === targetId)!;
    const targetAfter = landing.snapshot.find((candidate) => candidate.id === targetId)!;
    assert.equal(targetAfter.hp, targetAtCast.hp, `${targetId} must not take landing splash`);
  }
});

test("landing damage uses the living anchor's current Life at impact rather than maximum Life", () => {
  const report = reportFor(combatState(
    7120,
    (initial) => [
      elphaba(initial.units[0], "elphaba", 42),
      unit(initial.units[1], "vesper", "opening-vesper", 34, {
        itemSlots: lanterns("opening-vesper"),
      }),
    ],
    (initial) => [
      unit(initial.enemyUnits[0], "boitata", "anchor", 18),
      unit(initial.enemyUnits[1], "piper", "victim", 19),
    ],
  ));
  const cast = firstElphabaCast(report);
  const landing = firstElphabaLanding(report);
  const before = snapshotBefore(report, landing.timestamp);
  const anchor = before.find((candidate) => candidate.id === "anchor")!;
  const expectedFromCurrentLife = Math.round(anchor.hp * 0.1);
  const incorrectFromMaximumLife = Math.round(anchor.maxHp * 0.1);

  assert.ok(anchor.hp < anchor.maxHp);
  assert.equal(cast.snapshot.find((candidate) => candidate.id === "anchor")?.hp, anchor.hp);
  assert.notEqual(expectedFromCurrentLife, incorrectFromMaximumLife);
  assert.equal(landing.amounts?.victim, expectedFromCurrentLife);
});

test("landing true damage ignores Armor but is absorbed by an existing shield", () => {
  const report = reportFor(combatState(
    7116,
    (initial) => [
      elphaba(initial.units[0], "elphaba", 34),
      unit(initial.units[1], "bramble", "armor-decoy", 16, { stars: 3, level: 5 }),
    ],
    (initial) => [
      unit(initial.enemyUnits[0], "boitata", "a-anchor", 18),
      unit(initial.enemyUnits[1], "boitata", "z-shielded", 10, {
        itemSlots: lanterns("z-shielded"),
      }),
      unit(initial.enemyUnits[2], "boitata", "armored", 17),
    ],
  ));
  const landing = firstElphabaLanding(report);
  const before = snapshotBefore(report, landing.timestamp);
  const anchor = before.find((candidate) => candidate.id === "a-anchor")!;
  const expectedDamage = Math.round(anchor.hp * 0.1);
  const shieldedBefore = before.find((candidate) => candidate.id === "z-shielded")!;
  const shieldedAfter = landing.snapshot.find((candidate) => candidate.id === "z-shielded")!;
  const armoredBefore = before.find((candidate) => candidate.id === "armored")!;
  const armoredAfter = landing.snapshot.find((candidate) => candidate.id === "armored")!;

  assert.ok(shieldedBefore.shield >= expectedDamage);
  assert.equal(landing.amounts?.["z-shielded"], expectedDamage);
  assert.equal(shieldedAfter.hp, shieldedBefore.hp);
  assert.equal(shieldedBefore.shield - shieldedAfter.shield, expectedDamage);

  assert.ok(armoredBefore.armor > 0);
  assert.equal(landing.amounts?.armored, expectedDamage);
  assert.equal(armoredBefore.hp - armoredAfter.hp, expectedDamage);
});

test("three-star overlapping shockwaves stack frozen damage and exclude every lifted anchor", () => {
  const report = reportFor(combatState(
    7117,
    (initial) => [elphaba(initial.units[0], "elphaba", 42, 3)],
    (initial) => [
      unit(initial.enemyUnits[0], "boitata", "anchor-a", 18),
      unit(initial.enemyUnits[1], "boitata", "anchor-b", 20),
      unit(initial.enemyUnits[2], "boitata", "anchor-c", 43),
      unit(initial.enemyUnits[3], "piper", "overlap", 19),
    ],
  ));
  const cast = firstElphabaCast(report);
  const landing = firstElphabaLanding(report);
  const before = snapshotBefore(report, landing.timestamp);
  const anchorIds = ["anchor-a", "anchor-b", "anchor-c"];
  const expectedOverlapDamage = anchorIds.slice(0, 2).reduce((total, id) => {
    const anchor = before.find((candidate) => candidate.id === id)!;
    return total + Math.round(anchor.hp * 0.15);
  }, 0);

  assert.deepEqual(new Set(cast.liftedTargetIds), new Set(anchorIds));
  assert.deepEqual(new Set(landing.liftedTargetIds), new Set(anchorIds));
  assert.deepEqual(landing.targetIds, ["overlap"]);
  assert.equal(landing.amounts?.overlap, expectedOverlapDamage);
  assert.equal(landing.amount, expectedOverlapDamage);
  const overlapAfter = landing.snapshot.find((candidate) => candidate.id === "overlap")!;
  assert.equal(overlapAfter.stunnedUntil, 2.889, "overlap must max, not add, the 0.5-second stun");

  for (const anchorId of anchorIds) {
    assert.ok(!landing.targetIds?.includes(anchorId));
    const atCast = cast.snapshot.find((candidate) => candidate.id === anchorId)!;
    const after = landing.snapshot.find((candidate) => candidate.id === anchorId)!;
    assert.equal(after.hp, atCast.hp);
  }
});

test("simultaneous landings globally exclude every lifted anchor from each other's splash", () => {
  const report = reportFor(combatState(
    7121,
    (initial) => [
      elphaba(initial.units[0], "elphaba-a", 34),
      elphaba(initial.units[1], "elphaba-b", 37),
    ],
    (initial) => [
      unit(initial.enemyUnits[0], "boitata", "anchor-a", 18),
      unit(initial.enemyUnits[1], "boitata", "anchor-b", 19),
      unit(initial.enemyUnits[2], "piper", "impact-a", 10),
      unit(initial.enemyUnits[3], "piper", "impact-b", 20),
    ],
  ));
  const casts = report.events.filter((event) =>
    event.type === "ability" && event.snapshot.find((candidate) => candidate.id === event.actorId)?.heroId === "elphaba",
  );
  const landings = report.events.filter((event) => event.type === "landing");

  assert.deepEqual(
    casts.map((event) => [event.timestamp, event.actorId, event.liftedTargetIds]),
    [
      [1.389, "elphaba-a", ["anchor-a"]],
      [1.389, "elphaba-b", ["anchor-b"]],
    ],
  );
  assert.deepEqual(
    landings.map((event) => [event.timestamp, event.actorId, event.targetIds]),
    [
      [1.889, "elphaba-a", ["impact-a"]],
      [1.889, "elphaba-b", ["impact-b"]],
    ],
  );
  for (const landing of landings) {
    assert.ok(!landing.targetIds?.includes("anchor-a"));
    assert.ok(!landing.targetIds?.includes("anchor-b"));
    for (const anchorId of ["anchor-a", "anchor-b"]) {
      const before = casts.at(-1)!.snapshot.find((candidate) => candidate.id === anchorId)!;
      const after = landing.snapshot.find((candidate) => candidate.id === anchorId)!;
      assert.equal(after.hp, before.hp);
    }
  }
});

test("fractional landing stun skips only opportunities strictly before its expiry", () => {
  const report = reportFor(combatState(
    7118,
    (initial) => [elphaba(initial.units[0], "elphaba", 42)],
    (initial) => [
      unit(initial.enemyUnits[0], "boitata", "anchor", 18),
      unit(initial.enemyUnits[1], "nix", "stunned-nix", 26),
    ],
  ));
  const landing = firstElphabaLanding(report);
  const nixEvents = report.events.filter((event) => event.actorId === "stunned-nix");
  const skipped = nixEvents.find((event) => event.timestamp === 1.905);
  const resumed = nixEvents.find((event) => event.timestamp === 2.857);

  assert.equal(landing.timestamp, 1.889);
  assert.equal(landing.stunDurationSeconds, 0.25);
  assert.equal(landing.snapshot.find((candidate) => candidate.id === "stunned-nix")?.stunnedUntil, 2.139);
  assert.ok(skipped);
  assert.equal(skipped.type, "move");
  assert.match(skipped.text, /stunned and skips the action/i);
  assert.equal(skipped.snapshot.find((candidate) => candidate.id === "stunned-nix")?.stunned, 0);
  assert.ok(resumed);
  assert.doesNotMatch(resumed.text, /stunned|levitat/i);
});

test("a queued landing still resolves after Elphaba dies", () => {
  const lethalNixLoadout: UnitItemSlots = [
    enhancedItem("nix-fang-1", "inferno-fang", "ember"),
    enhancedItem("nix-fang-2", "inferno-fang", "ember"),
    enhancedItem("nix-fang-3", "inferno-fang", "ember"),
  ];
  const report = reportFor(combatState(
    7119,
    (initial) => [elphaba(initial.units[0], "elphaba", 42, 2)],
    (initial) => [
      unit(initial.enemyUnits[0], "boitata", "anchor", 18),
      unit(initial.enemyUnits[1], "nix", "executioner", 34, {
        itemSlots: lethalNixLoadout,
      }),
    ],
  ));
  const cast = firstElphabaCast(report);
  const landing = firstElphabaLanding(report);
  const death = report.events.find(
    (event) => event.type === "defeat" && event.targetIds?.includes("elphaba"),
  );

  assert.equal(cast.timestamp, 1.389);
  assert.ok(death);
  assert.equal(death.timestamp, 1.905);
  assert.equal(death.snapshot.find((candidate) => candidate.id === "elphaba")?.alive, false);
  assert.equal(landing.timestamp, 2.039);
  assert.ok(landing.timestamp > death.timestamp);
  assert.deepEqual(landing.liftedTargetIds, ["anchor"]);
});

test("the combat UI renders persistent lift, landing impact, metrics, pause, and reduced-motion hooks", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(client, /event\.type === "landing"/);
  assert.match(client, /liftedTargetIds/);
  assert.match(client, /unit\.levitatingUntil/);
  assert.match(client, /unit\.stunnedUntil/);
  assert.match(client, /liftDurationSeconds/);
  assert.match(client, /stunDurationSeconds/);
  assert.match(client, /currentHealthDamagePercent/);
  assert.match(client, /data-testid="elphaba-gravity-layer"/);
  assert.match(client, /data-testid=\{`elphaba-lift-target-\$\{target\.id\}`\}/);
  assert.match(client, /data-testid=\{`elphaba-landing-center-\$\{target\.id\}`\}/);
  assert.match(client, /data-testid=\{`elphaba-impact-target-\$\{target\.id\}`\}/);
  assert.match(client, /data-testid=\{`elphaba-levitation-state-\$\{unit\.id\}`\}/);

  assert.match(styles, /\.unit-levitating\s*\{/);
  assert.match(styles, /\.elphaba-gravity-layer\s*\{/);
  assert.match(styles, /\.elphaba-gravity-landing-center/);
  assert.match(styles, /\.elphaba-gravity-impact-target/);
  assert.match(styles, /\.unit-impact-gravity/);
  assert.match(styles, /\.combat-paused[\s\S]*?\.elphaba-gravity-layer/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.elphaba-gravity-lift-target > i[\s\S]*?animation: none !important/,
  );
});
