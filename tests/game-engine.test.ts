import assert from "node:assert/strict";
import test from "node:test";
import {
  HEROES,
  ITEM_COMPONENTS,
  ITEM_DEFINITIONS,
  ITEM_SLOTS_PER_UNIT,
  REFRESH_COST,
  ROLE_PROFILES,
  XP_BUY_COST,
  advanceRound,
  applyCombatResult,
  buyPlayerXp,
  buyShopUnit,
  calculateWallOfFireShield,
  craftItem,
  createInitialGame,
  enhanceEquippedItem,
  enhanceItem,
  equipItem,
  getCraftedItemBonuses,
  getCraftedItemDefinition,
  getAbilityPreview,
  getInterest,
  getItemComponentRewardForRound,
  getUnitStats,
  moveUnit,
  normalizeGameState,
  refreshShop,
  resolveCombat,
  sellUnit,
  unequipItem,
  unitCapForLevel,
  validateState,
  type CraftedItem,
  type GameState,
  type HeroId,
  type UnitInstance,
  type UnitItemSlots,
} from "../app/game-engine.ts";

function fullItem(id: string, itemId: CraftedItem["itemId"]): CraftedItem {
  return { id, itemId, tier: "full", enhancement: null };
}

function abilityTestUnit(
  base: UnitInstance,
  heroId: HeroId,
  overrides: Partial<UnitInstance> = {},
): UnitInstance {
  return {
    ...base,
    id: `ability-${heroId}`,
    heroId,
    stars: 1,
    level: 1,
    xp: 0,
    position: 40,
    benchIndex: null,
    itemSlots: [null, null, null],
    ...overrides,
  };
}

function abilityCast(
  state: GameState,
  actorId: string,
) {
  const combat = resolveCombat(state);
  assert.equal(combat.ok, true);
  const cast = combat.report?.events.find(
    (event) => event.type === "ability" && event.actorId === actorId,
  );
  assert.ok(cast, `expected ${actorId} to cast an ability`);
  return cast;
}

test("initial campaign is deterministic and satisfies placement invariants", () => {
  const first = createInitialGame(12345);
  const second = createInitialGame(12345);
  assert.deepEqual(first, second);
  assert.equal(first.phase, "planning");
  assert.equal(first.gold, 18);
  assert.equal(first.commanderLevel, 3);
  assert.equal(first.units.filter((unit) => unit.position !== null).length, 3);
  assert.equal(first.shop.length, 5);
  assert.deepEqual(first.componentInventory, { ember: 0, scale: 0, mote: 0 });
  assert.deepEqual(first.craftedItemInventory, []);
  assert.ok(first.units.every((unit) => unit.itemSlots.length === ITEM_SLOTS_PER_UNIT));
  assert.ok(first.units.every((unit) => unit.itemSlots.every((item) => item === null)));
  assert.deepEqual(validateState(first), []);
});

test("entering every even round awards one deterministic component exactly once", () => {
  assert.deepEqual(
    Array.from({ length: 10 }, (_, index) => getItemComponentRewardForRound(index + 1)),
    [null, "ember", null, "scale", null, "mote", null, "ember", null, "scale"],
  );

  const initial = createInitialGame(124);
  const combat = resolveCombat(initial);
  const resolved = applyCombatResult(combat.state);
  const advanced = advanceRound(resolved.state);
  assert.equal(advanced.ok, true);
  assert.equal(advanced.state.round, 2);
  assert.equal(advanced.state.componentInventory.ember, 1);
  assert.equal(advanced.state.roundResult?.itemComponentReward, "ember");
  assert.match(advanced.message, new RegExp(ITEM_COMPONENTS.ember.name));

  const duplicate = advanceRound(advanced.state);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.state, advanced.state);
  assert.equal(duplicate.state.componentInventory.ember, 1);
});

test("two components craft a full item and a third component enhances it immutably", () => {
  const initial = createInitialGame(125);
  const stocked: GameState = {
    ...initial,
    componentInventory: { ember: 1, scale: 1, mote: 1 },
  };
  assert.equal(getCraftedItemDefinition("scale", "ember")?.id, "blazing-aegis");

  const crafted = craftItem(stocked, "ember", "scale");
  assert.equal(crafted.ok, true);
  assert.deepEqual(crafted.state.componentInventory, { ember: 0, scale: 0, mote: 1 });
  assert.equal(crafted.state.craftedItemInventory.length, 1);
  assert.equal(crafted.state.craftedItemInventory[0].itemId, "blazing-aegis");
  assert.equal(crafted.state.craftedItemInventory[0].tier, "full");
  assert.deepEqual(stocked.componentInventory, { ember: 1, scale: 1, mote: 1 });

  const itemId = crafted.state.craftedItemInventory[0].id;
  const enhanced = enhanceItem(crafted.state, itemId, "mote");
  assert.equal(enhanced.ok, true);
  assert.equal(enhanced.state.componentInventory.mote, 0);
  assert.deepEqual(enhanced.state.craftedItemInventory[0], {
    id: itemId,
    itemId: "blazing-aegis",
    tier: "enhanced",
    enhancement: "mote",
  });
  assert.deepEqual(getCraftedItemBonuses(enhanced.state.craftedItemInventory[0]), {
    maxHp: 70,
    attack: 12,
    armor: 7,
    startingMana: 18,
  });
  const bearer = enhanced.state.units[0];
  const baseStats = getUnitStats(bearer);
  const equipped = equipItem(enhanced.state, bearer.id, itemId);
  const equippedStats = getUnitStats(equipped.state.units[0]);
  assert.equal(equippedStats.maxHp, baseStats.maxHp + 70);
  assert.equal(equippedStats.attack, baseStats.attack + 12);
  assert.equal(equippedStats.armor, baseStats.armor + 7);
  assert.equal(equippedStats.startingMana, Math.min(baseStats.maxMana, baseStats.startingMana + 18));

  const duplicateEnhancement = enhanceItem(enhanced.state, itemId, "mote");
  assert.equal(duplicateEnhancement.ok, false);
  assert.equal(duplicateEnhancement.state, enhanced.state);

  const missingComponents = craftItem(initial, "ember", "ember");
  assert.equal(missingComponents.ok, false);
  assert.equal(missingComponents.state, initial);
});

test("equipping up to three items applies combat stats and unequipping reverses them", () => {
  const initial = createInitialGame(126);
  const unit = initial.units[0];
  const items: CraftedItem[] = [0, 1, 2, 3].map((index) => ({
    id: `test-item-${index}`,
    itemId: "inferno-fang",
    tier: "full",
    enhancement: null,
  }));
  const stocked: GameState = { ...initial, craftedItemInventory: items };
  const baseline = getUnitStats(unit);
  const first = equipItem(stocked, unit.id, items[0].id);
  const second = equipItem(first.state, unit.id, items[1].id);
  const third = equipItem(second.state, unit.id, items[2].id);
  assert.equal(third.ok, true);
  assert.equal(third.state.units[0].itemSlots.filter(Boolean).length, 3);
  assert.equal(getUnitStats(third.state.units[0]).attack, baseline.attack + ITEM_DEFINITIONS["inferno-fang"].bonuses.attack * 3);

  const overflow = equipItem(third.state, unit.id, items[3].id);
  assert.equal(overflow.ok, false);
  assert.equal(overflow.state, third.state);

  const unequipped = unequipItem(third.state, unit.id, 1);
  assert.equal(unequipped.ok, true);
  assert.equal(unequipped.state.units[0].itemSlots[1], null);
  assert.ok(unequipped.state.craftedItemInventory.some((item) => item.id === items[1].id));
  assert.equal(getUnitStats(unequipped.state.units[0]).attack, baseline.attack + ITEM_DEFINITIONS["inferno-fang"].bonuses.attack * 2);

  const emptySlot = unequipItem(unequipped.state, unit.id, 1);
  assert.equal(emptySlot.ok, false);
  assert.equal(emptySlot.state, unequipped.state);
});

test("a dropped component enhances the first eligible item equipped to a board or bench champion", () => {
  const initial = createInitialGame(129);
  const bearer = initial.units.find((unit) => unit.benchIndex !== null) ?? initial.units[0];
  const alreadyEnhanced: CraftedItem = { id: "equipped-enhanced", itemId: "inferno-fang", tier: "enhanced", enhancement: "mote" };
  const firstFull: CraftedItem = { id: "equipped-first", itemId: "cinderplate", tier: "full", enhancement: null };
  const secondFull: CraftedItem = { id: "equipped-second", itemId: "spellfang", tier: "full", enhancement: null };
  const stocked: GameState = {
    ...initial,
    componentInventory: { ...initial.componentInventory, scale: 1 },
    units: initial.units.map((unit) => unit.id === bearer.id
      ? { ...unit, itemSlots: [alreadyEnhanced, firstFull, secondFull] }
      : unit),
  };
  const original = structuredClone(stocked);
  const statsBefore = getUnitStats(stocked.units.find((unit) => unit.id === bearer.id)!);

  const result = enhanceEquippedItem(stocked, bearer.id, "scale");

  assert.equal(result.ok, true);
  const upgradedBearer = result.state.units.find((unit) => unit.id === bearer.id)!;
  assert.deepEqual(upgradedBearer.itemSlots.map((item) => [item?.id, item?.tier, item?.enhancement]), [
    ["equipped-enhanced", "enhanced", "mote"],
    ["equipped-first", "enhanced", "scale"],
    ["equipped-second", "full", null],
  ]);
  assert.equal(result.state.componentInventory.scale, 0);
  assert.deepEqual(result.state.craftedItemInventory, stocked.craftedItemInventory);
  assert.deepEqual(stocked, original);
  assert.deepEqual(validateState(result.state), []);
  const statsAfter = getUnitStats(upgradedBearer);
  assert.equal(statsAfter.maxHp, statsBefore.maxHp + ITEM_COMPONENTS.scale.enhancementBonuses.maxHp);
  assert.equal(statsAfter.armor, statsBefore.armor + ITEM_COMPONENTS.scale.enhancementBonuses.armor);
});

test("enhancing equipped gear rejects ineligible drops without spending the component", () => {
  const initial = createInitialGame(130);
  const bearer = initial.units[0];
  const stocked: GameState = {
    ...initial,
    componentInventory: { ...initial.componentInventory, ember: 1 },
  };

  for (const result of [
    enhanceEquippedItem(stocked, bearer.id, "ember"),
    enhanceEquippedItem(stocked, initial.enemyUnits[0].id, "ember"),
    enhanceEquippedItem({ ...stocked, phase: "combat" }, bearer.id, "ember"),
  ]) {
    assert.equal(result.ok, false);
    assert.equal(result.state.componentInventory.ember, 1);
  }
});

test("selling and star-merging preserve every equipped item", () => {
  const initial = createInitialGame(127);
  const item = (id: string): CraftedItem => ({
    id,
    itemId: "cinderplate",
    tier: "full",
    enhancement: null,
  });
  const bramble = initial.units.find((unit) => unit.heroId === "bramble")!;
  const soldState: GameState = {
    ...initial,
    units: initial.units.map((unit) => unit.id === bramble.id
      ? { ...unit, itemSlots: [item("sold-1"), item("sold-2"), null] }
      : unit),
  };
  const sold = sellUnit(soldState, bramble.id);
  assert.equal(sold.ok, true);
  assert.deepEqual(sold.state.craftedItemInventory.map((candidate) => candidate.id).sort(), ["sold-1", "sold-2"]);

  const extraBramble = {
    ...bramble,
    id: "merge-bramble-extra",
    position: null,
    benchIndex: 0,
    itemSlots: [item("merge-1"), item("merge-2"), item("merge-3")] as const,
  };
  const mergeState: GameState = {
    ...initial,
    gold: 50,
    units: [
      { ...bramble, itemSlots: [item("keeper-1"), item("keeper-2"), null] },
      { ...extraBramble, itemSlots: [...extraBramble.itemSlots] },
      ...initial.units.filter((unit) => unit.id !== bramble.id),
    ],
    shop: [{ id: "merge-offer", heroId: "bramble", cost: 1 }, ...initial.shop.slice(1)],
  };
  const merged = buyShopUnit(mergeState, "merge-offer");
  assert.equal(merged.ok, true);
  const mergedBramble = merged.state.units.find((unit) => unit.heroId === "bramble")!;
  assert.equal(mergedBramble.stars, 2);
  assert.deepEqual(mergedBramble.itemSlots.map((candidate) => candidate?.id ?? null), ["keeper-1", "keeper-2", "merge-1"]);
  assert.deepEqual(merged.state.craftedItemInventory.map((candidate) => candidate.id).sort(), ["merge-2", "merge-3"]);
});

test("normalizing a legacy v1 state backfills item collections and slots", () => {
  const initial = createInitialGame(128);
  const legacy = {
    ...initial,
    componentInventory: undefined,
    craftedItemInventory: undefined,
    units: initial.units.map((unit) => {
      const legacyUnit = { ...unit };
      Reflect.deleteProperty(legacyUnit, "itemSlots");
      return legacyUnit;
    }),
  } as unknown as GameState;
  const normalized = normalizeGameState(legacy);
  assert.deepEqual(normalized.componentInventory, { ember: 0, scale: 0, mote: 0 });
  assert.deepEqual(normalized.craftedItemInventory, []);
  assert.ok(normalized.units.every((unit) => unit.itemSlots.length === 3));
  assert.deepEqual(validateState(normalized), []);
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

test("every hero exposes a complete three-star ability preview", () => {
  const initial = createInitialGame(800);
  const numericFields = [
    "damage",
    "healing",
    "shield",
    "minTargets",
    "maxTargets",
    "projectiles",
    "manaDrain",
    "stunTurns",
    "selfHealPercent",
    "teamHealing",
    "takedownMana",
    "startingManaBonus",
  ] as const;

  for (const hero of Object.values(HEROES)) {
    const unit = abilityTestUnit(initial.units[0], hero.id, { id: `preview-${hero.id}` });
    const preview = getAbilityPreview(unit, [unit]);

    assert.deepEqual(preview.byStar.map((values) => values.stars), [1, 2, 3]);
    assert.deepEqual(preview.current, preview.byStar[0]);
    assert.ok(preview.scalingDescription.trim().length > 0, `${hero.name} needs scaling copy`);
    assert.ok(preview.contextNote.trim().length > 0, `${hero.name} needs preview context`);
    assert.ok(preview.scalingDescription.includes("/"), `${hero.name} should expose three-star values`);
    assert.equal(
      preview.current.projectiles > 0,
      hero.id === "piper",
      `${hero.name} should only expose a projectile count when it fires projectiles`,
    );
    for (const values of preview.byStar) {
      assert.equal(values.heroId, hero.id);
      assert.equal(typeof values.ignoresArmor, "boolean");
      for (const field of numericFields) {
        assert.ok(Number.isFinite(values[field]), `${hero.name} ${field} must be numeric`);
      }
    }
  }
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

test("ability previews apply star rank, attack items, and active offensive bonds exactly", () => {
  const initial = createInitialGame(801);
  const lanterns: UnitItemSlots = [
    fullItem("preview-lantern-1", "spirit-lantern"),
    fullItem("preview-lantern-2", "spirit-lantern"),
    fullItem("preview-lantern-3", "spirit-lantern"),
  ];
  const baselineNix = abilityTestUnit(initial.units[0], "nix", {
    id: "preview-nix",
    stars: 2,
    itemSlots: lanterns,
  });
  const baseline = getAbilityPreview(baselineNix, [baselineNix]);

  assert.deepEqual(baseline.byStar.map((values) => values.damage), [94, 117, 149]);
  assert.equal(baseline.current.damage, 117);
  assert.ok(baseline.byStar.every((values) => values.ignoresArmor));
  assert.ok(baseline.modifiers.includes("Item · +45 starting Mana"));

  const armedNix: UnitInstance = {
    ...baselineNix,
    itemSlots: [fullItem("preview-fang", "inferno-fang"), lanterns[1], lanterns[2]],
  };
  const armed = getAbilityPreview(armedNix, [armedNix]);
  assert.deepEqual(armed.byStar.map((values) => values.damage), [119, 142, 174]);
  assert.ok(armed.modifiers.some((modifier) => modifier.startsWith("Item ·")));

  const sol = abilityTestUnit(initial.units[0], "sol", {
    id: "preview-support-sol",
    position: 46,
  });
  const aster = abilityTestUnit(initial.units[0], "aster", {
    id: "preview-support-aster",
    position: 47,
  });
  const bonded = getAbilityPreview(armedNix, [armedNix, sol, aster]);
  assert.deepEqual(bonded.byStar.map((values) => values.damage), [145, 175, 216]);
  assert.ok(bonded.modifiers.some((modifier) => /Bond · Duelist/.test(modifier)));
  assert.ok(bonded.modifiers.some((modifier) => /Bond · Starborn/.test(modifier)));
});

test("starting Mana modifiers report only the amount that fits below the ability cap", () => {
  const initial = createInitialGame(806);
  const tide = abilityTestUnit(initial.units[0], "tide", {
    id: "preview-capped-tide",
    itemSlots: [
      fullItem("tide-lantern-1", "spirit-lantern"),
      fullItem("tide-lantern-2", "spirit-lantern"),
      fullItem("tide-lantern-3", "spirit-lantern"),
    ],
  });
  const sol = abilityTestUnit(initial.units[0], "sol", {
    id: "preview-invoker-sol",
    position: 41,
  });
  const capped = getAbilityPreview(tide, [tide, sol]);
  assert.ok(capped.modifiers.includes("Item · +45 starting Mana"));
  assert.ok(!capped.modifiers.some((modifier) => modifier.startsWith("Bond · Invoker")));

  const uncappedTide = { ...tide, itemSlots: [null, null, null] } satisfies UnitInstance;
  const uncapped = getAbilityPreview(uncappedTide, [uncappedTide, sol]);
  assert.ok(uncapped.modifiers.includes("Bond · Invoker +12 starting Mana"));
});

test("Nix's displayed true damage matches the amount resolved by combat", () => {
  const initial = createInitialGame(802);
  const caster = abilityTestUnit(initial.units[0], "nix", {
    id: "a-preview-nix",
    itemSlots: [
      fullItem("combat-lantern-1", "spirit-lantern"),
      fullItem("combat-lantern-2", "spirit-lantern"),
      fullItem("combat-lantern-3", "spirit-lantern"),
    ],
  });
  const enemy = abilityTestUnit(initial.enemyUnits[0], "bramble", {
    id: "z-preview-target",
    position: 8,
    stars: 3,
    level: 5,
  });
  const preview = getAbilityPreview(caster, [caster]);
  const cast = abilityCast(
    { ...initial, commanderLevel: 8, units: [caster], enemyUnits: [enemy] },
    caster.id,
  );

  assert.equal(preview.current.damage, 94);
  assert.equal(cast.amount, preview.current.damage);
  assert.equal(cast.amounts?.[enemy.id], preview.current.damage);
});

test("Boitata's preview includes defensive item stats and Vanguard armor", () => {
  const initial = createInitialGame(803);
  const boitata = abilityTestUnit(initial.units[0], "boitata", {
    id: "preview-boitata",
    itemSlots: [
      fullItem("preview-ward", "warding-flame"),
      fullItem("preview-wall-lantern-1", "spirit-lantern"),
      fullItem("preview-wall-lantern-2", "spirit-lantern"),
    ],
  });
  const itemPreview = getAbilityPreview(boitata, [boitata]);
  assert.deepEqual(itemPreview.byStar.map((values) => values.shield), [118, 143, 179]);
  assert.ok(itemPreview.modifiers.some((modifier) => modifier.startsWith("Item ·")));

  const bramble = abilityTestUnit(initial.units[0], "bramble", {
    id: "preview-vanguard-bramble",
    position: 47,
  });
  const bondedPreview = getAbilityPreview(boitata, [boitata, bramble]);
  assert.deepEqual(bondedPreview.byStar.map((values) => values.shield), [134, 159, 194]);
  assert.ok(bondedPreview.modifiers.some((modifier) => /Bond · Vanguard/.test(modifier)));
});

test("Bramble's preview exposes star-scaled healing and ally target count", () => {
  const initial = createInitialGame(804);
  const bramble = abilityTestUnit(initial.units[0], "bramble", { id: "preview-bramble" });
  const preview = getAbilityPreview(bramble, [bramble]);
  const healing = preview.byStar.map((values) => values.healing);

  assert.deepEqual(preview.byStar.map((values) => values.maxTargets), [1, 1, 2]);
  assert.deepEqual(preview.byStar.map((values) => values.minTargets), [0, 0, 0]);
  assert.ok(healing[0] < healing[1] && healing[1] < healing[2]);
});

test("Piper's third star previews and fires a three-projectile volley", () => {
  const initial = createInitialGame(805);
  const piper = abilityTestUnit(initial.units[0], "piper", {
    id: "a-preview-piper",
    stars: 3,
    itemSlots: [
      fullItem("piper-lantern-1", "spirit-lantern"),
      fullItem("piper-lantern-2", "spirit-lantern"),
      fullItem("piper-lantern-3", "spirit-lantern"),
    ],
  });
  const preview = getAbilityPreview(piper, [piper]);
  assert.deepEqual(preview.byStar.map((values) => values.maxTargets), [2, 2, 3]);
  assert.deepEqual(preview.byStar.map((values) => values.projectiles), [2, 2, 3]);
  assert.equal(preview.current.maxTargets, 3);
  assert.equal(preview.current.projectiles, 3);

  const enemies = [8, 10, 12].map((position, index) => abilityTestUnit(
    initial.enemyUnits[0],
    "bramble",
    {
      id: `z-volley-target-${index}`,
      position,
      stars: 3,
      level: 5,
    },
  ));
  const cast = abilityCast(
    { ...initial, commanderLevel: 8, units: [piper], enemyUnits: enemies },
    piper.id,
  );

  assert.equal(cast.targetIds?.length, 3);
  assert.equal(Object.keys(cast.amounts ?? {}).length, 3);
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
