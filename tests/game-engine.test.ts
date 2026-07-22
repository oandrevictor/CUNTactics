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
  attackAnimationSeconds,
  buyPlayerXp,
  buyShopUnit,
  calculateMeatGagaStackConsumption,
  calculateMeatGagaStackGain,
  calculateWallOfFireShield,
  craftItem,
  createInitialGame,
  enhanceEquippedItem,
  enhanceItem,
  equipItem,
  getCraftedItemBonuses,
  getCraftedItemDefinition,
  getAbilityPreview,
  getCombatStatistics,
  getInterest,
  getItemComponentRewardForRound,
  getMeatGagaPassivePreview,
  getUnitStats,
  moveUnit,
  movementTravelSeconds,
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

function enhancedItem(
  id: string,
  itemId: CraftedItem["itemId"],
  enhancement: NonNullable<CraftedItem["enhancement"]>,
): CraftedItem {
  return { id, itemId, tier: "enhanced", enhancement };
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

const COMBAT_ACTION_TYPES = new Set(["move", "attack", "ability"]);

test("movement travel time is derived from distance and each champion's move speed", () => {
  assert.equal(movementTravelSeconds(0.5, 0, 1), 2);
  assert.equal(movementTravelSeconds(0.25, 0, 1), 4);
  assert.equal(movementTravelSeconds(0.5, 0, 9), 4);
  assert.equal(movementTravelSeconds(0, 0, 1), 0);
});

test("attack animation duration follows each champion's effective attack speed", () => {
  assert.equal(attackAnimationSeconds(0.4), 1.8);
  assert.equal(attackAnimationSeconds(0.6), 1.2);
  assert.equal(attackAnimationSeconds(0), 0);
});

function roundCombatTestValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function deterministicTimingDuel(
  playerHeroId: HeroId = "nix",
  enemyHeroId: HeroId = "bramble",
  options: { stars?: number; level?: number } = {},
): GameState {
  const initial = createInitialGame(1);
  const stars = options.stars ?? 1;
  const level = options.level ?? 1;
  return {
    ...initial,
    commanderLevel: 8,
    units: [{
      ...initial.units[0],
      id: "timing-player",
      heroId: playerHeroId,
      stars,
      level,
      xp: 0,
      position: 40,
      benchIndex: null,
      itemSlots: [null, null, null],
    }],
    enemyUnits: [{
      ...initial.enemyUnits[0],
      id: "timing-enemy",
      heroId: enemyHeroId,
      stars,
      level,
      xp: 0,
      position: 32,
      benchIndex: null,
      itemSlots: [null, null, null],
    }],
  };
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

test("enemy count and star pressure ramp gradually across the campaign", () => {
  const expected = [
    [1, [1, 1, 1]],
    [2, [1, 1, 1]],
    [3, [1, 1, 1, 1]],
    [4, [2, 1, 1, 1]],
    [5, [2, 1, 1, 1, 1]],
    [6, [2, 2, 1, 1, 1]],
    [7, [2, 2, 1, 1, 1, 1]],
    [8, [2, 2, 2, 1, 1, 1]],
    [9, [3, 2, 2, 2, 1, 1, 1]],
    [10, [3, 3, 2, 2, 2, 2, 1, 1]],
  ] as const;
  let state = createInitialGame(130);

  for (const [round, stars] of expected) {
    assert.equal(state.round, round);
    assert.deepEqual(state.enemyUnits.map((unit) => unit.stars), stars);
    if (round === 10) break;
    const combat = resolveCombat({ ...state, life: 999 });
    state = advanceRound(applyCombatResult(combat.state).state).state;
  }
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

test("roster exposes twelve distinct heroes, abilities, and real trait hooks", () => {
  const heroes = Object.values(HEROES);
  assert.equal(heroes.length, 12);
  assert.equal(new Set(heroes.map((hero) => hero.name)).size, 12);
  assert.equal(new Set(heroes.map((hero) => hero.ability.name)).size, 12);
  assert.ok(heroes.every((hero) => hero.traits.length >= 2));
  assert.equal(HEROES.boitata.portrait, "/characters/boitata.png");
  assert.equal(HEROES.boitata.ability.id, "wall-of-fire");
  assert.deepEqual(
    {
      portrait: HEROES["meat-gaga"].portrait,
      cost: HEROES["meat-gaga"].cost,
      rarity: HEROES["meat-gaga"].rarity,
      role: HEROES["meat-gaga"].role,
      manaCost: HEROES["meat-gaga"].ability.manaCost,
      manaRegen: HEROES["meat-gaga"].manaRegen,
    },
    {
      portrait: "/characters/meat-couture-npc-v3.png",
      cost: 2,
      rarity: "uncommon",
      role: "shooter",
      manaCost: 0,
      manaRegen: 0,
    },
  );
});

test("Meat Gaga is deterministically available as an uncommon from commander level three", () => {
  const initial = createInitialGame(5);
  const market = refreshShop(
    { ...initial, commanderLevel: 3, gold: 99, seed: 5 },
    true,
  );

  assert.equal(market.ok, true);
  assert.deepEqual(
    market.state.shop.map((offer) => offer?.heroId),
    ["tide", "tide", "sol", "meat-gaga", "tide"],
  );
  assert.equal(market.state.shop[3]?.cost, 2);
  assert.deepEqual(
    createInitialGame(1).enemyUnits.map((unit) => unit.heroId),
    ["boitata", "vesper", "aster"],
  );
});

test("Meat Gaga's passive preview and whole-number stack math expose exact star values", () => {
  assert.deepEqual(getMeatGagaPassivePreview(1), {
    current: { stars: 1, stackGainPercent: 60, stackConsumePercent: 7 },
    byStar: [
      { stars: 1, stackGainPercent: 60, stackConsumePercent: 7 },
      { stars: 2, stackGainPercent: 75, stackConsumePercent: 8 },
      { stars: 3, stackGainPercent: 90, stackConsumePercent: 12 },
    ],
  });
  assert.deepEqual(
    [1, 2, 3].map((stars) => calculateMeatGagaStackGain(101, stars)),
    [61, 76, 91],
  );
  assert.deepEqual(
    [1, 2, 3].map((stars) => calculateMeatGagaStackConsumption(101, stars)),
    [8, 9, 13],
  );

  for (const stars of [1, 2, 3]) {
    let stack = calculateMeatGagaStackGain(717, stars);
    let attacks = 0;
    while (stack > 0 && attacks < 1000) {
      const consumed = calculateMeatGagaStackConsumption(stack, stars);
      assert.ok(Number.isInteger(consumed) && consumed >= 1 && consumed <= stack);
      stack -= consumed;
      attacks += 1;
    }
    assert.equal(stack, 0);
    assert.ok(attacks < 1000, `${stars}-star Meat Gaga's stack should reach zero`);
  }

  const initial = createInitialGame(8001);
  const meatGaga = abilityTestUnit(initial.units[0], "meat-gaga", {
    id: "preview-meat-gaga",
    stars: 2,
  });
  const preview = getAbilityPreview(meatGaga, [meatGaga]);
  assert.deepEqual(
    preview.byStar.map((values) => [
      values.passiveStackGainPercent,
      values.passiveStackConsumePercent,
    ]),
    [[60, 7], [75, 8], [90, 12]],
  );
  assert.equal(preview.current.damage, 0);
  assert.equal(preview.current.maxTargets, 0);
  assert.match(preview.scalingDescription, /\(60\/75\/90\)%/);
  assert.match(preview.scalingDescription, /\(7\/8\/12\)%/);
  assert.match(preview.contextNote, /has no Mana, never casts/);
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
    "passiveStackGainPercent",
    "passiveStackConsumePercent",
    "summonCount",
    "summonDamage",
    "birdAttackPercent",
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
      hero.id === "piper" || hero.id === "billie",
      `${hero.name} should only expose a projectile count when it fires projectiles or summons birds`,
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
    assert.equal(stats.attackSpeed, hero.attackSpeed);
    assert.equal(stats.moveSpeed, hero.moveSpeed);
    assert.equal(stats.manaRegen, hero.manaRegen);
    assert.ok(Number.isFinite(stats.attackSpeed) && stats.attackSpeed > 0);
    assert.ok(Number.isFinite(stats.moveSpeed) && stats.moveSpeed > 0);
    assert.ok(Number.isFinite(stats.manaRegen) && stats.manaRegen >= 0);
    assert.equal(stats.manaRegen === 0, hero.id === "meat-gaga");
  }
  assert.equal(getUnitStats({ ...baseUnit, heroId: "boitata" }).range, 1);
  assert.equal(getUnitStats({ ...baseUnit, heroId: "meat-gaga" }).range, 4);
});

test("attack speed schedules absolute action opportunities without cadence drift", () => {
  const combat = resolveCombat(deterministicTimingDuel());
  assert.equal(combat.ok, true);
  const report = combat.report!;
  const initialPlayer = report.initialUnits.find((unit) => unit.id === "timing-player")!;
  const initialEnemy = report.initialUnits.find((unit) => unit.id === "timing-enemy")!;
  assert.equal(initialPlayer.attackSpeed, 0.65);
  assert.equal(initialPlayer.moveSpeed, 0.46);
  assert.equal(initialPlayer.manaRegen, 8.5);
  assert.equal(initialEnemy.attackSpeed, 0.4);
  assert.equal(initialEnemy.moveSpeed, 0.28);
  assert.equal(initialEnemy.manaRegen, 10.5);

  const actions = report.events.filter((event) => COMBAT_ACTION_TYPES.has(event.type));
  const playerActions = actions.filter((event) => event.actorId === initialPlayer.id);
  const enemyActions = actions.filter((event) => event.actorId === initialEnemy.id);
  assert.deepEqual(
    playerActions.slice(0, 4).map((event) => event.timestamp),
    Array.from(
      { length: 4 },
      (_, index) => roundCombatTestValue((index + 1) / initialPlayer.attackSpeed),
    ),
  );
  assert.deepEqual(
    enemyActions.slice(0, 3).map((event) => event.timestamp),
    Array.from(
      { length: 3 },
      (_, index) => roundCombatTestValue((index + 1) / initialEnemy.attackSpeed),
    ),
  );
});

test("attack cooldown never delays movement when the next enemy is out of range", () => {
  const initial = createInitialGame(8107);
  const weapons: UnitItemSlots = [
    enhancedItem("movement-fang-1", "inferno-fang", "ember"),
    enhancedItem("movement-fang-2", "inferno-fang", "ember"),
    enhancedItem("movement-fang-3", "inferno-fang", "ember"),
  ];
  const report = resolveCombat({
    ...initial,
    commanderLevel: 8,
    units: [{
      ...initial.units[0],
      id: "independent-mover",
      heroId: "nix",
      stars: 3,
      level: 9,
      xp: 0,
      position: 40,
      benchIndex: null,
      itemSlots: weapons,
    }],
    enemyUnits: [
      {
        ...initial.enemyUnits[0],
        id: "near-target",
        heroId: "sol",
        stars: 1,
        level: 1,
        xp: 0,
        position: 32,
        benchIndex: null,
        itemSlots: [null, null, null],
      },
      {
        ...initial.enemyUnits[1],
        id: "far-target",
        heroId: "bramble",
        stars: 3,
        level: 9,
        xp: 0,
        position: 0,
        benchIndex: null,
        itemSlots: [null, null, null],
      },
    ],
  }).report!;
  const actions = report.events.filter(
    (event) => event.actorId === "independent-mover" && COMBAT_ACTION_TYPES.has(event.type),
  );
  const firstAttack = actions.find((event) => event.type === "attack")!;
  const followingMove = actions.find(
    (event) => event.type === "move" && event.timestamp > firstAttack.timestamp,
  )!;

  assert.equal(firstAttack.snapshot.find((unit) => unit.id === "near-target")?.alive, false);
  assert.equal(firstAttack.timestamp, roundCombatTestValue(1 / HEROES.nix.attackSpeed));
  assert.equal(followingMove.timestamp, roundCombatTestValue(firstAttack.timestamp + 0.001));
  assert.ok(followingMove.timestamp < firstAttack.timestamp + 1 / HEROES.nix.attackSpeed);
});

test("living units regenerate mana continuously without attack or damage mana bonuses", () => {
  const report = resolveCombat(deterministicTimingDuel()).report!;
  const firstAction = report.events.find((event) => COMBAT_ACTION_TYPES.has(event.type))!;
  assert.equal(firstAction.type, "attack");
  assert.equal(firstAction.actorId, "timing-player");
  assert.equal(firstAction.timestamp, 1.538);

  const initialPlayer = report.initialUnits.find((unit) => unit.id === "timing-player")!;
  const initialEnemy = report.initialUnits.find((unit) => unit.id === "timing-enemy")!;
  const playerAfter = firstAction.snapshot.find((unit) => unit.id === initialPlayer.id)!;
  const enemyAfter = firstAction.snapshot.find((unit) => unit.id === initialEnemy.id)!;
  assert.ok(Math.abs(
    playerAfter.mana - (initialPlayer.mana + firstAction.timestamp * initialPlayer.manaRegen),
  ) < 0.01);
  assert.ok(Math.abs(
    enemyAfter.mana - (initialEnemy.mana + firstAction.timestamp * initialEnemy.manaRegen),
  ) < 0.01);
  assert.equal(playerAfter.mana, 38.077);
  assert.equal(enemyAfter.mana, 36.154);
});

test("a unit's mana timeline is unchanged by unrelated allies acting between its attacks", () => {
  const duel = deterministicTimingDuel();
  const withExtraAlly: GameState = {
    ...duel,
    units: [
      ...duel.units,
      {
        ...duel.units[0],
        id: "timing-sol",
        heroId: "sol",
        position: 47,
      },
    ],
  };
  const manaAtSecondAttack = (state: GameState) => {
    const report = resolveCombat(state).report!;
    const secondAttackAt = roundCombatTestValue(2 / HEROES.nix.attackSpeed);
    const event = report.events.find(
      (candidate) => candidate.actorId === "timing-player" && candidate.timestamp === secondAttackAt,
    )!;
    return event.snapshot.find((unit) => unit.id === "timing-player")!.mana;
  };

  assert.equal(manaAtSecondAttack(duel), 51.154);
  assert.equal(manaAtSecondAttack(withExtraAlly), 51.154);
});

test("an ability replaces the first scheduled attack after passive mana reaches full", () => {
  const report = resolveCombat(deterministicTimingDuel()).report!;
  const player = report.initialUnits.find((unit) => unit.id === "timing-player")!;
  const playerActions = report.events.filter(
    (event) => COMBAT_ACTION_TYPES.has(event.type) && event.actorId === player.id,
  );
  const secondsToFullMana = (player.maxMana - player.mana) / player.manaRegen;
  const opportunityNumber = Math.ceil(secondsToFullMana * player.attackSpeed);
  const expectedCastTimestamp = roundCombatTestValue(opportunityNumber / player.attackSpeed);

  assert.equal(opportunityNumber, 4);
  assert.equal(expectedCastTimestamp, 6.154);
  assert.deepEqual(playerActions.slice(0, opportunityNumber - 1).map((event) => event.type), [
    "attack",
    "attack",
    "attack",
  ]);
  const cast = playerActions[opportunityNumber - 1];
  assert.equal(cast.type, "ability");
  assert.equal(cast.timestamp, expectedCastTimestamp);
  assert.equal(cast.snapshot.find((unit) => unit.id === player.id)?.mana, 0);
});

test("combat timestamps and action sequence remain monotonic through simultaneous follow-ups", () => {
  const report = resolveCombat(deterministicTimingDuel()).report!;
  assert.equal(report.events[0].type, "start");
  assert.equal(report.events[0].timestamp, 0);
  assert.equal(report.events[0].turn, 0);

  for (let index = 0; index < report.events.length; index += 1) {
    const event = report.events[index];
    assert.ok(Number.isFinite(event.timestamp));
    assert.ok(event.timestamp >= 0 && event.timestamp <= 45);
    if (index > 0) {
      assert.ok(event.timestamp >= report.events[index - 1].timestamp);
      assert.ok(event.turn >= report.events[index - 1].turn);
    }
  }

  const actions = report.events.filter((event) => COMBAT_ACTION_TYPES.has(event.type));
  assert.deepEqual(
    actions.map((event) => event.turn),
    Array.from({ length: actions.length }, (_, index) => index + 1),
  );
  const cast = report.events.find(
    (event) => event.type === "ability" && event.actorId === "timing-player",
  )!;
  const defeat = report.events.find((event) => event.type === "defeat")!;
  const outcome = report.events.at(-1)!;
  assert.ok(defeat.timestamp >= cast.timestamp);
  assert.ok(defeat.turn >= cast.turn);
  assert.equal(outcome.type, "outcome");
  assert.equal(outcome.timestamp, defeat.timestamp);
  assert.equal(outcome.turn, defeat.turn + 1);
});

test("equal attack-speed opportunities share one simultaneous batch in stable presentation order", () => {
  const report = resolveCombat(
    deterministicTimingDuel("bramble", "bramble", { stars: 3, level: 5 }),
  ).report!;
  const actions = report.events.filter((event) => COMBAT_ACTION_TYPES.has(event.type));

  assert.deepEqual(
    actions.slice(0, 4).map((event) => [event.timestamp, event.turn, event.actorId]),
    [
      [2.5, 1, "timing-player"],
      [2.5, 1, "timing-enemy"],
      [5, 2, "timing-player"],
      [5, 2, "timing-enemy"],
    ],
  );
});

test("an actor killed in a simultaneous batch still completes its frozen lethal cast", () => {
  const initial = createInitialGame(91);
  const lethalSpellfang = (id: string): CraftedItem => ({
    id,
    itemId: "spellfang",
    tier: "enhanced",
    enhancement: "ember",
  });
  const loadout = (side: string): UnitItemSlots => [
    lethalSpellfang(`${side}-spellfang-1`),
    lethalSpellfang(`${side}-spellfang-2`),
    lethalSpellfang(`${side}-spellfang-3`),
  ];
  const state: GameState = {
    ...initial,
    commanderLevel: 8,
    units: [{
      ...initial.units[0],
      id: "simultaneous-player",
      heroId: "nix",
      position: 40,
      benchIndex: null,
      itemSlots: loadout("player"),
    }],
    enemyUnits: [{
      ...initial.enemyUnits[0],
      id: "simultaneous-enemy",
      heroId: "nix",
      position: 32,
      benchIndex: null,
      itemSlots: loadout("enemy"),
    }],
  };

  const report = resolveCombat(state).report!;
  const casts = report.events.filter((event) => event.type === "ability");
  assert.deepEqual(
    casts.map((event) => [event.timestamp, event.turn, event.actorId, event.targetIds]),
    [
      [1.538, 1, "simultaneous-player", ["simultaneous-enemy"]],
      [1.538, 1, "simultaneous-enemy", ["simultaneous-player"]],
    ],
  );
  assert.equal(casts[0].snapshot.find((unit) => unit.id === "simultaneous-enemy")?.alive, false);
  assert.equal(casts[1].snapshot.find((unit) => unit.id === "simultaneous-player")?.alive, false);
  assert.ok(report.finalUnits.every((unit) => !unit.alive));
  assert.equal(report.outcome, "defeat");
});

test("a stun applied during a batch affects the target's next opportunity, not its frozen cast", () => {
  const initial = createInitialGame(92);
  const loadedVesper = (
    base: UnitInstance,
    id: string,
    position: number,
  ): UnitInstance => ({
    ...base,
    id,
    heroId: "vesper",
    position,
    benchIndex: null,
    itemSlots: [
      fullItem(`${id}-lantern-1`, "spirit-lantern"),
      fullItem(`${id}-lantern-2`, "spirit-lantern"),
      null,
    ],
  });
  const report = resolveCombat({
    ...initial,
    commanderLevel: 8,
    units: [loadedVesper(initial.units[0], "stun-player", 40)],
    enemyUnits: [loadedVesper(initial.enemyUnits[0], "stun-enemy", 32)],
  }).report!;
  const actions = report.events.filter((event) => COMBAT_ACTION_TYPES.has(event.type));

  assert.deepEqual(
    actions.slice(0, 4).map((event) => [event.timestamp, event.turn, event.type, event.actorId]),
    [
      [2.174, 1, "ability", "stun-player"],
      [2.174, 1, "ability", "stun-enemy"],
      [4.348, 2, "move", "stun-player"],
      [4.348, 2, "move", "stun-enemy"],
    ],
  );
  assert.match(actions[2].text, /stunned and skips the action/);
  assert.match(actions[3].text, /stunned and skips the action/);
});

test("simultaneous movers reserve distinct destinations from one frozen board", () => {
  const initial = createInitialGame(93);
  const playerOne = {
    ...initial.units[0],
    id: "moving-player-1",
    heroId: "bramble" as const,
    position: 32,
    benchIndex: null,
  };
  const playerTwo = {
    ...initial.units[1],
    id: "moving-player-2",
    heroId: "bramble" as const,
    position: 34,
    benchIndex: null,
  };
  const enemy = {
    ...initial.enemyUnits[0],
    id: "moving-enemy",
    heroId: "bramble" as const,
    position: 41,
    benchIndex: null,
  };
  const report = resolveCombat({
    ...initial,
    commanderLevel: 8,
    units: [playerOne, playerTwo],
    enemyUnits: [enemy],
  }).report!;
  const firstBatch = report.events.filter(
    (event) => event.turn === 1 && COMBAT_ACTION_TYPES.has(event.type),
  );
  const batchSnapshot = firstBatch.at(-1)!.snapshot;
  const positions = batchSnapshot.filter((unit) => unit.alive).map((unit) => unit.position);

  assert.equal(firstBatch.length, 3);
  assert.ok(firstBatch.every((event) => event.timestamp === 0.001));
  assert.equal(new Set(positions).size, positions.length);
  assert.deepEqual(
    ["moving-player-1", "moving-player-2"].map(
      (id) => batchSnapshot.find((unit) => unit.id === id)?.position,
    ),
    [40, 42],
  );
});

test("rear movers immediately follow allies vacating their path", () => {
  const initial = createInitialGame(9402);
  const report = resolveCombat({
    ...initial,
    commanderLevel: 8,
    units: [
      {
        ...initial.units[0],
        id: "front-bramble",
        heroId: "bramble",
        position: 32,
        benchIndex: null,
      },
      {
        ...initial.units[1],
        id: "rear-sol",
        heroId: "sol",
        position: 40,
        benchIndex: null,
      },
      {
        ...initial.units[2],
        id: "side-blocker",
        heroId: "bramble",
        position: 41,
        benchIndex: null,
      },
    ],
    enemyUnits: [{
      ...initial.enemyUnits[0],
      id: "distant-enemy",
      heroId: "bramble",
      position: 0,
      benchIndex: null,
    }],
  }).report!;
  const openingMoves = report.events.filter(
    (event) => event.turn === 1 && event.type === "move",
  );
  const solMove = openingMoves.find((event) => event.actorId === "rear-sol");

  assert.ok(solMove);
  assert.equal(solMove.timestamp, 0.001);
  assert.match(solMove.text, /advances/);
  assert.equal(
    solMove.snapshot.find((unit) => unit.id === "rear-sol")?.position,
    32,
  );
});

test("Meat Gaga spends only her pre-moment stack and harvests deaths for her next attack", () => {
  const initial = createInitialGame(999);
  const enhancedSpellfang = (id: string): CraftedItem => ({
    id,
    itemId: "spellfang",
    tier: "enhanced",
    enhancement: "ember",
  });
  const report = resolveCombat({
    ...initial,
    commanderLevel: 8,
    units: [
      {
        ...initial.units[0],
        id: "gaga",
        heroId: "meat-gaga",
        stars: 1,
        position: 40,
        benchIndex: null,
        itemSlots: [
          fullItem("gaga-lantern-1", "spirit-lantern"),
          fullItem("gaga-lantern-2", "spirit-lantern"),
          fullItem("gaga-lantern-3", "spirit-lantern"),
        ],
      },
      {
        ...initial.units[1],
        id: "gaga-ally-vesper",
        heroId: "vesper",
        stars: 3,
        position: 47,
        benchIndex: null,
        itemSlots: [
          enhancedSpellfang("gaga-spellfang-1"),
          enhancedSpellfang("gaga-spellfang-2"),
          enhancedSpellfang("gaga-spellfang-3"),
        ],
      },
      {
        ...initial.units[2],
        id: "gaga-ally-tide",
        heroId: "tide",
        position: 46,
        benchIndex: null,
        itemSlots: [null, null, null],
      },
    ],
    enemyUnits: [
      {
        ...initial.enemyUnits[0],
        id: "gaga-victim",
        heroId: "nix",
        stars: 1,
        position: 32,
        benchIndex: null,
        itemSlots: [null, null, null],
      },
      {
        ...initial.enemyUnits[1],
        id: "gaga-survivor",
        heroId: "bramble",
        stars: 3,
        level: 5,
        position: 8,
        benchIndex: null,
        itemSlots: [null, null, null],
      },
    ],
  }).report!;
  const gagaEvents = report.events.filter((event) => event.actorId === "gaga");
  const firstAttack = gagaEvents.find((event) => event.type === "attack")!;
  const harvest = gagaEvents.find((event) => event.type === "passive")!;
  const empoweredAttack = gagaEvents.find(
    (event) => event.type === "attack" && (event.meatBonusDamage ?? 0) > 0,
  )!;
  const victim = report.initialUnits.find((unit) => unit.id === "gaga-victim")!;

  assert.equal(firstAttack.turn, harvest.turn);
  assert.equal(firstAttack.timestamp, harvest.timestamp);
  assert.equal(firstAttack.meatStackBefore, 0);
  assert.equal(firstAttack.meatBonusDamage, undefined);
  assert.ok(report.events.indexOf(firstAttack) < report.events.indexOf(harvest));
  assert.equal(harvest.meatStackGained, Math.round(victim.maxHp * 0.6));
  assert.deepEqual(harvest.targetIds, [victim.id]);
  assert.equal(harvest.amounts?.[victim.id], 78);
  assert.equal(harvest.meatStackBefore, 0);
  assert.equal(harvest.meatStackAfter, 78);
  assert.equal(empoweredAttack.timestamp, 4.348);
  assert.equal(empoweredAttack.meatStackBefore, 78);
  assert.equal(empoweredAttack.meatStackConsumed, 6);
  assert.equal(empoweredAttack.meatBonusDamage, 6);
  assert.equal(empoweredAttack.meatStackAfter, 72);
  assert.match(empoweredAttack.text, /hurls stored meat/);
  assert.ok(!report.events.some((event) => event.type === "ability" && event.actorId === "gaga"));
  assert.ok(report.events.every((event) => {
    const gaga = event.snapshot.find((unit) => unit.id === "gaga");
    return !gaga || (gaga.mana === 0 && gaga.maxMana === 0);
  }));

  const gagaDamage = getCombatStatistics(report).units.find((unit) => unit.unitId === "gaga")!;
  const recordedAttackDamage = gagaEvents
    .filter((event) => event.type === "attack")
    .reduce((total, event) => total + (event.amount ?? 0), 0);
  assert.equal(gagaDamage.damageDealt, recordedAttackDamage);
});

test("every surviving Meat Gaga harvests every death in a moment at her own star rate", () => {
  const initial = createInitialGame(1000);
  const enhancedSpellfang = (id: string): CraftedItem => ({
    id,
    itemId: "spellfang",
    tier: "enhanced",
    enhancement: "ember",
  });
  const gaga = (id: string, stars: number, position: number): UnitInstance => ({
    ...initial.units[0],
    id,
    heroId: "meat-gaga",
    stars,
    position,
    benchIndex: null,
    itemSlots: [null, null, null],
  });
  const report = resolveCombat({
    ...initial,
    commanderLevel: 8,
    units: [
      gaga("harvest-gaga-1", 1, 40),
      gaga("harvest-gaga-3", 3, 41),
      {
        ...initial.units[1],
        id: "harvest-sol",
        heroId: "sol",
        stars: 3,
        position: 47,
        benchIndex: null,
        itemSlots: [
          enhancedSpellfang("harvest-spellfang-1"),
          enhancedSpellfang("harvest-spellfang-2"),
          enhancedSpellfang("harvest-spellfang-3"),
        ],
      },
    ],
    enemyUnits: [
      {
        ...initial.enemyUnits[0],
        id: "harvest-victim-sol",
        heroId: "sol",
        stars: 1,
        position: 8,
        benchIndex: null,
        itemSlots: [null, null, null],
      },
      {
        ...initial.enemyUnits[1],
        id: "harvest-victim-piper",
        heroId: "piper",
        stars: 1,
        position: 9,
        benchIndex: null,
        itemSlots: [null, null, null],
      },
    ],
  }).report!;
  const victims = report.initialUnits.filter((unit) => unit.side === "enemy");
  const harvests = report.events.filter((event) => event.type === "passive");

  for (const [id, stars] of [["harvest-gaga-1", 1], ["harvest-gaga-3", 3]] as const) {
    const unitHarvests = harvests.filter((candidate) => candidate.actorId === id);
    assert.ok(unitHarvests.length > 0);
    assert.deepEqual(
      unitHarvests.flatMap((event) => event.targetIds ?? []).sort(),
      victims.map((victim) => victim.id).sort(),
    );
    assert.deepEqual(
      Object.assign({}, ...unitHarvests.map((event) => event.amounts ?? {})),
      Object.fromEntries(victims.map((victim) => [
        victim.id,
        calculateMeatGagaStackGain(victim.maxHp, stars),
      ])),
    );
    assert.equal(
      unitHarvests.reduce((total, event) => total + (event.meatStackGained ?? 0), 0),
      victims.reduce(
        (total, victim) => total + calculateMeatGagaStackGain(victim.maxHp, stars),
        0,
      ),
    );
  }
});

test("Meat Gaga does not harvest a simultaneous death when she also dies in that moment", () => {
  const initial = createInitialGame(1001);
  const enhanced = (
    id: string,
    itemId: "inferno-fang" | "spellfang",
  ): CraftedItem => ({ id, itemId, tier: "enhanced", enhancement: "ember" });
  const report = resolveCombat({
    ...initial,
    commanderLevel: 8,
    units: [{
      ...initial.units[0],
      id: "fallen-gaga",
      heroId: "meat-gaga",
      stars: 1,
      position: 40,
      benchIndex: null,
      itemSlots: [
        enhanced("fallen-gaga-fang-1", "inferno-fang"),
        enhanced("fallen-gaga-fang-2", "inferno-fang"),
        enhanced("fallen-gaga-fang-3", "inferno-fang"),
      ],
    }],
    enemyUnits: [
      {
        ...initial.enemyUnits[0],
        id: "fallen-gaga-victim",
        heroId: "sol",
        stars: 1,
        position: 32,
        benchIndex: null,
        itemSlots: [null, null, null],
      },
      {
        ...initial.enemyUnits[1],
        id: "fallen-gaga-killer",
        heroId: "vesper",
        stars: 3,
        position: 8,
        benchIndex: null,
        itemSlots: [
          enhanced("fallen-gaga-spellfang-1", "spellfang"),
          enhanced("fallen-gaga-spellfang-2", "spellfang"),
          enhanced("fallen-gaga-spellfang-3", "spellfang"),
        ],
      },
    ],
  }).report!;
  const deathTimestamp = report.events.find(
    (event) => event.type === "defeat" && event.targetIds?.includes("fallen-gaga"),
  )?.timestamp;
  const simultaneousDeaths = report.events.filter(
    (event) => event.type === "defeat" && event.timestamp === deathTimestamp,
  );

  assert.deepEqual(
    simultaneousDeaths.flatMap((event) => event.targetIds ?? []).sort(),
    ["fallen-gaga", "fallen-gaga-victim"],
  );
  assert.ok(!report.events.some(
    (event) => event.type === "passive" && event.actorId === "fallen-gaga",
  ));
  assert.equal(report.finalUnits.find((unit) => unit.id === "fallen-gaga")?.meatStack, 0);
});

test("same-time Wall of Fire absorbs the same hit regardless of which side owns Boitata", () => {
  const run = (casterSide: "player" | "enemy") => {
    const initial = createInitialGame(94);
    const lanterns = (prefix: string): UnitItemSlots => [
      fullItem(`${prefix}-lantern-1`, "spirit-lantern"),
      fullItem(`${prefix}-lantern-2`, "spirit-lantern"),
      fullItem(`${prefix}-lantern-3`, "spirit-lantern"),
    ];
    const unit = (
      base: UnitInstance,
      id: "shield-caster" | "shield-attacker",
      side: "player" | "enemy",
      loaded: boolean,
    ): UnitInstance => ({
      ...base,
      id,
      side,
      heroId: "boitata",
      position: side === "player" ? 40 : 32,
      benchIndex: null,
      itemSlots: loaded ? lanterns(id) : [null, null, null],
    });
    const attackerSide = casterSide === "player" ? "enemy" : "player";
    const caster = unit(
      casterSide === "player" ? initial.units[0] : initial.enemyUnits[0],
      "shield-caster",
      casterSide,
      true,
    );
    const attacker = unit(
      attackerSide === "player" ? initial.units[0] : initial.enemyUnits[0],
      "shield-attacker",
      attackerSide,
      false,
    );
    const report = resolveCombat({
      ...initial,
      commanderLevel: 8,
      units: [casterSide === "player" ? caster : attacker],
      enemyUnits: [casterSide === "enemy" ? caster : attacker],
    }).report!;
    const firstBatch = report.events.filter((event) => event.turn === 1);
    const casterAfter = firstBatch.at(-1)!.snapshot.find((candidate) => candidate.id === caster.id)!;
    const statistics = getCombatStatistics(report);
    const unitStatistics = (id: string) => {
      const stats = statistics.units.find((candidate) => candidate.unitId === id)!;
      return {
        damageDealt: stats.damageDealt,
        shieldGranted: stats.shieldGranted,
        healingDone: stats.healingDone,
      };
    };
    return {
      eventOrder: firstBatch
        .filter((event) => COMBAT_ACTION_TYPES.has(event.type))
        .map((event) => [event.type, event.actorId]),
      caster: {
        hp: casterAfter.hp,
        shield: casterAfter.shield,
        fireWallShield: casterAfter.fireWallShield,
        alive: casterAfter.alive,
      },
      casterStatistics: unitStatistics(caster.id),
      attackerStatistics: unitStatistics(attacker.id),
    };
  };

  const alliedCaster = run("player");
  const enemyCaster = run("enemy");
  assert.deepEqual(alliedCaster, enemyCaster);
  assert.deepEqual(alliedCaster.eventOrder, [
    ["ability", "shield-caster"],
    ["attack", "shield-attacker"],
  ]);
  assert.equal(alliedCaster.caster.hp, 216);
  assert.ok(alliedCaster.caster.shield > 0);
  assert.equal(alliedCaster.caster.shield, alliedCaster.caster.fireWallShield);
});

test("simultaneous Morrow damage and self-healing are invariant when sides swap", () => {
  const run = (roleASide: "player" | "enemy") => {
    const initial = createInitialGame(95);
    const aegis = (prefix: string): UnitItemSlots => [
      fullItem(`${prefix}-aegis`, "blazing-aegis"),
      null,
      null,
    ];
    const unit = (
      base: UnitInstance,
      id: "morrow-a" | "morrow-b",
      side: "player" | "enemy",
    ): UnitInstance => ({
      ...base,
      id,
      side,
      heroId: "morrow",
      stars: 1,
      position: side === "player" ? 40 : 32,
      benchIndex: null,
      itemSlots: aegis(id),
    });
    const roleBSide = roleASide === "player" ? "enemy" : "player";
    const roleA = unit(
      roleASide === "player" ? initial.units[0] : initial.enemyUnits[0],
      "morrow-a",
      roleASide,
    );
    const roleB = unit(
      roleBSide === "player" ? initial.units[0] : initial.enemyUnits[0],
      "morrow-b",
      roleBSide,
    );
    const report = resolveCombat({
      ...initial,
      commanderLevel: 8,
      units: [roleASide === "player" ? roleA : roleB],
      enemyUnits: [roleASide === "enemy" ? roleA : roleB],
    }).report!;
    const firstCast = report.events.find(
      (event) => event.type === "ability" && (event.actorId === roleA.id || event.actorId === roleB.id),
    )!;
    const castBatch = report.events.filter((event) => event.turn === firstCast.turn);
    const finalSnapshot = castBatch.at(-1)!.snapshot;
    const statistics = getCombatStatistics(report);
    const resultFor = (id: string) => {
      const combatUnit = finalSnapshot.find((candidate) => candidate.id === id)!;
      const stats = statistics.units.find((candidate) => candidate.unitId === id)!;
      return {
        hp: combatUnit.hp,
        mana: combatUnit.mana,
        alive: combatUnit.alive,
        damageDealt: stats.damageDealt,
        healingDone: stats.healingDone,
        shieldGranted: stats.shieldGranted,
      };
    };
    return {
      timestamp: firstCast.timestamp,
      roleA: resultFor(roleA.id),
      roleB: resultFor(roleB.id),
      support: castBatch
        .filter((event) => event.type === "heal")
        .map((event) => [event.actorId, event.amount])
        .sort(([first], [second]) => String(first).localeCompare(String(second))),
    };
  };

  const roleAAllied = run("player");
  const roleAEnemy = run("enemy");
  assert.deepEqual(roleAAllied, roleAEnemy);
  assert.equal(roleAAllied.timestamp, 6.977);
  assert.deepEqual(roleAAllied.support, [
    ["morrow-a", 44],
    ["morrow-b", 44],
  ]);
  assert.ok(roleAAllied.roleA.alive && roleAAllied.roleB.alive);
  assert.equal(roleAAllied.roleA.hp, 120);
  assert.equal(roleAAllied.roleB.hp, 120);
});

test("mixed abilities expose shield support separately from their offensive event", () => {
  const initial = createInitialGame(96);
  const lanterns: UnitItemSlots = [
    fullItem("aster-lantern-1", "spirit-lantern"),
    fullItem("aster-lantern-2", "spirit-lantern"),
    fullItem("aster-lantern-3", "spirit-lantern"),
  ];
  const report = resolveCombat({
    ...initial,
    commanderLevel: 8,
    units: [{
      ...initial.units[0],
      id: "mixed-aster",
      heroId: "aster",
      position: 40,
      benchIndex: null,
      itemSlots: lanterns,
    }],
    enemyUnits: [{
      ...initial.enemyUnits[0],
      id: "mixed-aster-target",
      heroId: "aster",
      position: 32,
      benchIndex: null,
      itemSlots: [null, null, null],
    }],
  }).report!;
  const firstBatch = report.events.filter((event) => event.turn === 1);
  const shield = firstBatch.find((event) => event.type === "shield")!;
  const cast = firstBatch.find(
    (event) => event.type === "ability" && event.actorId === "mixed-aster",
  )!;

  assert.equal(shield.actorId, "mixed-aster");
  assert.deepEqual(shield.targetIds, ["mixed-aster"]);
  assert.equal(shield.amounts?.["mixed-aster"], shield.amount);
  assert.ok((shield.amount ?? 0) > 0);
  assert.deepEqual(cast.targetIds, ["mixed-aster-target"]);
  assert.ok((cast.amount ?? 0) > 0);
  assert.ok(firstBatch.indexOf(shield) < firstBatch.indexOf(cast));
});

test("stuns consume the target's next scheduled action while passive mana keeps regenerating", () => {
  const report = resolveCombat(deterministicTimingDuel("vesper", "boitata")).report!;
  const cast = report.events.find(
    (event) => event.type === "ability" && event.actorId === "timing-player",
  )!;
  const nextEnemyAction = report.events.find(
    (event) => event.timestamp > cast.timestamp && event.actorId === "timing-enemy" && COMBAT_ACTION_TYPES.has(event.type),
  )!;
  const targetAtCast = cast.snapshot.find((unit) => unit.id === "timing-enemy")!;
  const targetAfterSkip = nextEnemyAction.snapshot.find((unit) => unit.id === "timing-enemy")!;

  assert.equal(cast.timestamp, 4.348);
  assert.equal(nextEnemyAction.timestamp, 4.762);
  assert.match(nextEnemyAction.text, /stunned and skips the action/);
  assert.equal(targetAfterSkip.stunned, 0);
  assert.ok(Math.abs(
    targetAfterSkip.mana
      - (targetAtCast.mana + (nextEnemyAction.timestamp - cast.timestamp) * targetAtCast.manaRegen),
  ) < 0.01);
});

test("the 45-second combat cap resolves surviving teams by health without elimination wording", () => {
  const report = resolveCombat(
    deterministicTimingDuel("bramble", "bramble", { stars: 3, level: 5 }),
  ).report!;
  const outcome = report.events.at(-1)!;

  assert.equal(outcome.type, "outcome");
  assert.equal(outcome.timestamp, 45);
  assert.match(outcome.text, /^Time expires\./);
  assert.doesNotMatch(outcome.text, /line breaks|formation falls/);
  assert.ok(report.finalUnits.some((unit) => unit.side === "player" && unit.alive));
  assert.ok(report.finalUnits.some((unit) => unit.side === "enemy" && unit.alive));
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
  const boitata = {
    ...playerBase,
    id: "mixed-shield-boitata",
    heroId: "boitata" as const,
    side: "player" as const,
    position: 40,
    benchIndex: null,
    stars: 1,
    level: 1,
    xp: 0,
    itemSlots: [
      fullItem("mixed-shield-lantern-1", "spirit-lantern"),
      fullItem("mixed-shield-lantern-2", "spirit-lantern"),
      fullItem("mixed-shield-lantern-3", "spirit-lantern"),
    ] as UnitItemSlots,
  };
  const tide = { ...playerBase, id: "mixed-shield-tide", heroId: "tide" as const, side: "player" as const, position: 47, benchIndex: null, stars: 1, level: 1, xp: 0 };
  const enemy = { ...enemyBase, id: "mixed-shield-enemy", heroId: "bramble" as const, side: "enemy" as const, position: 32, benchIndex: null, stars: 1, level: 1, xp: 0 };
  const combat = resolveCombat({ ...initial, units: [boitata, tide], enemyUnits: [enemy] });

  const events = combat.report!.events;
  const wardIndex = events.findIndex(
    (event) => event.type === "ability" && event.actorId === tide.id && event.targetIds?.includes(boitata.id),
  );
  assert.ok(wardIndex > 0);
  const afterWard = events[wardIndex].snapshot.find((unit) => unit.id === boitata.id)!;
  assert.equal(afterWard.shield - afterWard.fireWallShield, 29);

  assert.ok(afterWard.fireWallShield > 0);
  assert.ok(afterWard.shield > afterWard.fireWallShield);
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
  const firstPlayerAction = (report: NonNullable<typeof tankCombat.report>) => report.events.find(
    (event) => event.actorId === player.id && COMBAT_ACTION_TYPES.has(event.type),
  );
  assert.equal(firstPlayerAction(tankCombat.report!)?.type, "move");
  assert.equal(firstPlayerAction(shooterCombat.report!)?.type, "attack");
  assert.equal(
    firstPlayerAction(tankCombat.report!)?.timestamp,
    0.001,
  );
  assert.equal(
    firstPlayerAction(shooterCombat.report!)?.timestamp,
    roundCombatTestValue(1 / HEROES.piper.attackSpeed),
  );
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
