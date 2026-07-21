export const BOARD_COLUMNS = 8;
export const BOARD_ROWS = 6;
export const BOARD_SIZE = BOARD_COLUMNS * BOARD_ROWS;
export const PLAYER_START_ROW = 3;
export const BENCH_SIZE = 7;
export const SHOP_SIZE = 5;
export const REFRESH_COST = 2;
export const XP_BUY_COST = 4;
export const XP_BUY_AMOUNT = 4;
export const MAX_COMMANDER_LEVEL = 8;
export const MAX_UNIT_LEVEL = 5;
export const MAX_STARS = 3;
export const FINAL_ROUND = 10;
export const ITEM_SLOTS_PER_UNIT = 3;

const COMBAT_DURATION_SECONDS = 45;
const MAX_COMBAT_ACTIONS = 1024;
const COMBAT_DECIMAL_PRECISION = 1000;
const COMBAT_EPSILON = 1e-9;

export type Side = "player" | "enemy";
export type GamePhase = "planning" | "combat" | "resolution" | "gameover";
export type Outcome = "victory" | "defeat";
export type HeroRole = "tank" | "carry" | "mage" | "shooter";
export type HeroId =
  | "bramble"
  | "boitata"
  | "sol"
  | "nix"
  | "aster"
  | "morrow"
  | "tide"
  | "vesper"
  | "piper";
export type TraitId =
  | "vanguard"
  | "nightbound"
  | "invoker"
  | "duelist"
  | "verdant"
  | "starborn"
  | "hexer";
export type ItemComponentId = "ember" | "scale" | "mote";
export type ItemId =
  | "inferno-fang"
  | "cinderplate"
  | "spirit-lantern"
  | "blazing-aegis"
  | "spellfang"
  | "warding-flame";
export type ItemTier = "full" | "enhanced";

export interface ItemStatBonuses {
  maxHp: number;
  attack: number;
  armor: number;
  startingMana: number;
}

export interface ItemComponentDefinition {
  id: ItemComponentId;
  name: string;
  glyph: string;
  description: string;
  enhancementBonuses: ItemStatBonuses;
}

export interface ItemDefinition {
  id: ItemId;
  name: string;
  description: string;
  recipe: readonly [ItemComponentId, ItemComponentId];
  bonuses: ItemStatBonuses;
}

export interface CraftedItem {
  id: string;
  itemId: ItemId;
  tier: ItemTier;
  enhancement: ItemComponentId | null;
}

export type UnitItemSlots = [
  CraftedItem | null,
  CraftedItem | null,
  CraftedItem | null,
];

export interface AbilityDefinition {
  id: string;
  name: string;
  description: string;
  manaCost: number;
  targetRule: string;
}

export interface AbilityValues {
  heroId: HeroId;
  stars: 1 | 2 | 3;
  damage: number;
  healing: number;
  shield: number;
  minTargets: number;
  maxTargets: number;
  projectiles: number;
  manaDrain: number;
  stunTurns: number;
  selfHealPercent: number;
  teamHealing: number;
  takedownMana: number;
  startingManaBonus: number;
  ignoresArmor: boolean;
}

export interface AbilityPreview {
  current: AbilityValues;
  byStar: [AbilityValues, AbilityValues, AbilityValues];
  modifiers: string[];
  scalingDescription: string;
  contextNote: string;
}

export interface HeroDefinition {
  id: HeroId;
  name: string;
  title: string;
  glyph: string;
  portrait?: string;
  cost: number;
  rarity: "common" | "uncommon" | "rare" | "mythic";
  role: HeroRole;
  traits: TraitId[];
  maxHp: number;
  attack: number;
  armor: number;
  /** Basic-attack/action opportunities per second. */
  attackSpeed: number;
  /** Mana restored per second while the unit is alive. */
  manaRegen: number;
  startingMana: number;
  ability: AbilityDefinition;
}

export interface RoleProfile {
  id: HeroRole;
  label: string;
  range: number;
  description: string;
}

export interface TraitDefinition {
  id: TraitId;
  name: string;
  glyph: string;
  thresholds: number[];
  effects: string[];
}

export interface UnitInstance {
  id: string;
  heroId: HeroId;
  side: Side;
  stars: number;
  level: number;
  xp: number;
  position: number | null;
  benchIndex: number | null;
  itemSlots: UnitItemSlots;
}

export interface ShopOffer {
  id: string;
  heroId: HeroId;
  cost: number;
}

export interface CombatUnit {
  id: string;
  heroId: HeroId;
  side: Side;
  stars: number;
  level: number;
  position: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  attack: number;
  armor: number;
  range: number;
  attackSpeed: number;
  manaRegen: number;
  shield: number;
  fireWallShield: number;
  stunned: number;
  alive: boolean;
  itemSlots?: UnitItemSlots;
}

export type CombatEventType =
  | "start"
  | "move"
  | "attack"
  | "ability"
  | "heal"
  | "defeat"
  | "outcome";

export interface CombatEvent {
  id: string;
  /** Elapsed combat time in seconds. */
  timestamp: number;
  /** Monotonic action sequence retained for playback compatibility. */
  turn: number;
  type: CombatEventType;
  actorId?: string;
  targetIds?: string[];
  amount?: number;
  amounts?: Record<string, number>;
  text: string;
  snapshot: CombatUnit[];
}

export interface IncomeBreakdown {
  base: number;
  interest: number;
  streak: number;
  victory: number;
  total: number;
}

export interface CombatReport {
  id: string;
  round: number;
  outcome: Outcome;
  events: CombatEvent[];
  initialUnits: CombatUnit[];
  finalUnits: CombatUnit[];
  income: IncomeBreakdown;
  playerDamage: number;
  commanderXp: number;
  unitXp: Record<string, number>;
}

export interface RoundResult {
  outcome: Outcome;
  round: number;
  lifeDelta: number;
  goldEarned: number;
  commanderXp: number;
  unitXp: Record<string, number>;
  income: IncomeBreakdown;
  itemComponentReward?: ItemComponentId;
}

export interface CombatStatTotals {
  damageDealt: number;
  shieldGranted: number;
  healingDone: number;
}

export interface UnitCombatStatistics extends CombatStatTotals {
  unitId: string;
  heroId: HeroId;
  side: Side;
  stars: number;
  level: number;
}

export interface CombatStatistics {
  teams: Record<Side, CombatStatTotals>;
  units: UnitCombatStatistics[];
}

export interface GameState {
  version: 1;
  seed: number;
  idCounter: number;
  round: number;
  phase: GamePhase;
  gold: number;
  life: number;
  commanderLevel: number;
  commanderXp: number;
  streak: number;
  lastOutcome: Outcome | null;
  componentInventory: Record<ItemComponentId, number>;
  craftedItemInventory: CraftedItem[];
  units: UnitInstance[];
  enemyUnits: UnitInstance[];
  shop: Array<ShopOffer | null>;
  shopLocked: boolean;
  combatReport: CombatReport | null;
  roundResult: RoundResult | null;
  campaignOutcome: Outcome | null;
}

export interface GameActionResult {
  ok: boolean;
  state: GameState;
  message: string;
  report?: CombatReport;
}

export type UnitDestination =
  | { kind: "board"; index: number }
  | { kind: "bench"; index: number };

export interface TraitStatus {
  id: TraitId;
  count: number;
  tier: number;
  nextThreshold: number | null;
  activeEffect: string;
}

export interface UnitStats {
  maxHp: number;
  attack: number;
  armor: number;
  range: number;
  attackSpeed: number;
  manaRegen: number;
  maxMana: number;
  startingMana: number;
}

export const ROLE_PROFILES: Record<HeroRole, RoleProfile> = {
  tank: {
    id: "tank",
    label: "Tank",
    range: 1,
    description: "Frontline protector that attacks adjacent targets.",
  },
  carry: {
    id: "carry",
    label: "Carry",
    range: 2,
    description: "Midline damage dealer that attacks up to two tiles away.",
  },
  mage: {
    id: "mage",
    label: "Mage",
    range: 3,
    description: "Backline caster that attacks up to three tiles away.",
  },
  shooter: {
    id: "shooter",
    label: "Shooter",
    range: 4,
    description: "Long-range marksman that attacks up to four tiles away.",
  },
};

export const ITEM_COMPONENT_IDS = ["ember", "scale", "mote"] as const satisfies readonly ItemComponentId[];

export const ITEM_COMPONENTS: Record<ItemComponentId, ItemComponentDefinition> = {
  ember: {
    id: "ember",
    name: "Ember Shard",
    glyph: "✦",
    description: "Adds raw attack power when used to enhance an item.",
    enhancementBonuses: { maxHp: 0, attack: 10, armor: 0, startingMana: 0 },
  },
  scale: {
    id: "scale",
    name: "Iron Scale",
    glyph: "◆",
    description: "Adds life and armor when used to enhance an item.",
    enhancementBonuses: { maxHp: 60, attack: 0, armor: 6, startingMana: 0 },
  },
  mote: {
    id: "mote",
    name: "Mana Mote",
    glyph: "●",
    description: "Adds starting mana when used to enhance an item.",
    enhancementBonuses: { maxHp: 0, attack: 0, armor: 0, startingMana: 18 },
  },
};

export const ITEM_DEFINITIONS: Record<ItemId, ItemDefinition> = {
  "inferno-fang": {
    id: "inferno-fang",
    name: "Inferno Fang",
    description: "A relentless weapon forged from twin embers.",
    recipe: ["ember", "ember"],
    bonuses: { maxHp: 0, attack: 22, armor: 0, startingMana: 0 },
  },
  cinderplate: {
    id: "cinderplate",
    name: "Cinderplate",
    description: "Heavy protection that hardens its bearer against focus fire.",
    recipe: ["scale", "scale"],
    bonuses: { maxHp: 110, attack: 0, armor: 14, startingMana: 0 },
  },
  "spirit-lantern": {
    id: "spirit-lantern",
    name: "Spirit Lantern",
    description: "Stores power so its bearer can cast sooner.",
    recipe: ["mote", "mote"],
    bonuses: { maxHp: 0, attack: 0, armor: 0, startingMana: 25 },
  },
  "blazing-aegis": {
    id: "blazing-aegis",
    name: "Blazing Aegis",
    description: "Balances offensive heat with frontline endurance.",
    recipe: ["ember", "scale"],
    bonuses: { maxHp: 70, attack: 12, armor: 7, startingMana: 0 },
  },
  spellfang: {
    id: "spellfang",
    name: "Spellfang",
    description: "Turns stored magic into a sharp opening assault.",
    recipe: ["ember", "mote"],
    bonuses: { maxHp: 0, attack: 14, armor: 0, startingMana: 15 },
  },
  "warding-flame": {
    id: "warding-flame",
    name: "Warding Flame",
    description: "A protective charm that also hastens the first cast.",
    recipe: ["scale", "mote"],
    bonuses: { maxHp: 75, attack: 0, armor: 9, startingMana: 10 },
  },
};

export const HEROES: Record<HeroId, HeroDefinition> = {
  bramble: {
    id: "bramble",
    name: "Bramble",
    title: "The Rootguard",
    glyph: "B",
    cost: 1,
    rarity: "common",
    role: "tank",
    traits: ["vanguard", "verdant"],
    maxHp: 190,
    attack: 18,
    armor: 24,
    attackSpeed: 0.65,
    manaRegen: 10.5,
    startingMana: 20,
    ability: {
      id: "thornwall",
      name: "Thornwall",
      description: "Gains a shield and restores life to the most wounded adjacent allies, healing more allies at 3 stars.",
      manaCost: 80,
      targetRule: "Self and lowest-life adjacent allies",
    },
  },
  boitata: {
    id: "boitata",
    name: "Boitatá",
    title: "The Embercoil",
    glyph: "O",
    portrait: "/characters/boitata.png",
    cost: 3,
    rarity: "rare",
    role: "tank",
    traits: ["vanguard", "verdant"],
    maxHp: 216,
    attack: 20,
    armor: 28,
    attackSpeed: 0.68,
    manaRegen: 10,
    startingMana: 35,
    ability: {
      id: "wall-of-fire",
      name: "Wall of Fire",
      description: "Coils into a wall of fire, gaining a shield equal to 20 + 7 per level + 18% max Life + 105% Armor.",
      manaCost: 90,
      targetRule: "Self",
    },
  },
  sol: {
    id: "sol",
    name: "Sol",
    title: "The Dawncaller",
    glyph: "S",
    cost: 2,
    rarity: "uncommon",
    role: "mage",
    traits: ["invoker", "starborn"],
    maxHp: 118,
    attack: 24,
    armor: 8,
    attackSpeed: 0.72,
    manaRegen: 12,
    startingMana: 35,
    ability: {
      id: "starfall",
      name: "Starfall",
      description: "Calls a star onto the target and every enemy in an adjacent tile.",
      manaCost: 90,
      targetRule: "Largest enemy cluster",
    },
  },
  nix: {
    id: "nix",
    name: "Nix",
    title: "The Veilblade",
    glyph: "N",
    cost: 2,
    rarity: "uncommon",
    role: "carry",
    traits: ["nightbound", "duelist"],
    maxHp: 130,
    attack: 31,
    armor: 11,
    attackSpeed: 1.05,
    manaRegen: 8.5,
    startingMana: 25,
    ability: {
      id: "shadowstep",
      name: "Shadowstep",
      description: "Leaps beside the farthest enemy and strikes through their armor.",
      manaCost: 70,
      targetRule: "Farthest enemy",
    },
  },
  aster: {
    id: "aster",
    name: "Aster",
    title: "The Sunlance",
    glyph: "A",
    cost: 3,
    rarity: "rare",
    role: "carry",
    traits: ["duelist", "starborn"],
    maxHp: 150,
    attack: 38,
    armor: 15,
    attackSpeed: 0.95,
    manaRegen: 8,
    startingMana: 10,
    ability: {
      id: "radiant-lunge",
      name: "Radiant Lunge",
      description: "Pierces the current target for heavy damage and gains a brief shield.",
      manaCost: 75,
      targetRule: "Current target",
    },
  },
  morrow: {
    id: "morrow",
    name: "Morrow",
    title: "The Hollow King",
    glyph: "M",
    cost: 4,
    rarity: "mythic",
    role: "mage",
    traits: ["hexer", "nightbound"],
    maxHp: 164,
    attack: 35,
    armor: 14,
    attackSpeed: 0.7,
    manaRegen: 11.5,
    startingMana: 30,
    ability: {
      id: "soulbind",
      name: "Soulbind",
      description: "Drains life and mana from the enemy with the most mana.",
      manaCost: 100,
      targetRule: "Enemy with most mana",
    },
  },
  tide: {
    id: "tide",
    name: "Tide",
    title: "The Stillwater",
    glyph: "T",
    cost: 1,
    rarity: "common",
    role: "tank",
    traits: ["vanguard", "invoker"],
    maxHp: 176,
    attack: 17,
    armor: 20,
    attackSpeed: 0.66,
    manaRegen: 11,
    startingMana: 40,
    ability: {
      id: "tidal-ward",
      name: "Tidal Ward",
      description: "Heals the most wounded ally and grants them a warding shield.",
      manaCost: 85,
      targetRule: "Lowest-life ally",
    },
  },
  vesper: {
    id: "vesper",
    name: "Vesper",
    title: "The Quiet Word",
    glyph: "V",
    cost: 3,
    rarity: "rare",
    role: "mage",
    traits: ["hexer", "invoker"],
    maxHp: 122,
    attack: 28,
    armor: 9,
    attackSpeed: 0.75,
    manaRegen: 12.5,
    startingMana: 45,
    ability: {
      id: "hush",
      name: "Hush",
      description: "Damages the enemy closest to casting, drains mana, and stuns them.",
      manaCost: 95,
      targetRule: "Enemy with most mana",
    },
  },
  piper: {
    id: "piper",
    name: "Piper",
    title: "The Briarstring",
    glyph: "P",
    cost: 2,
    rarity: "uncommon",
    role: "shooter",
    traits: ["verdant", "duelist"],
    maxHp: 126,
    attack: 27,
    armor: 10,
    attackSpeed: 0.92,
    manaRegen: 9,
    startingMana: 20,
    ability: {
      id: "briar-volley",
      name: "Briar Volley",
      description: "Fires binding arrows into the weakest enemies, launching a third arrow at 3 stars.",
      manaCost: 80,
      targetRule: "Weakest enemies",
    },
  },
};

export const TRAITS: Record<TraitId, TraitDefinition> = {
  vanguard: {
    id: "vanguard",
    name: "Vanguard",
    glyph: "◆",
    thresholds: [2, 4],
    effects: ["All allies gain 15 armor.", "All allies gain 35 armor."],
  },
  nightbound: {
    id: "nightbound",
    name: "Nightbound",
    glyph: "✦",
    thresholds: [2, 4],
    effects: ["Takedowns grant 20 mana.", "Takedowns grant 35 mana."],
  },
  invoker: {
    id: "invoker",
    name: "Invoker",
    glyph: "☽",
    thresholds: [2, 4],
    effects: ["All allies begin with 12 bonus mana.", "All allies begin with 28 bonus mana."],
  },
  duelist: {
    id: "duelist",
    name: "Duelist",
    glyph: "⚔",
    thresholds: [2, 4],
    effects: ["All allies gain 12% attack.", "All allies gain 28% attack."],
  },
  verdant: {
    id: "verdant",
    name: "Verdant",
    glyph: "❧",
    thresholds: [2, 4],
    effects: ["Ability casts restore 8 life to allies.", "Ability casts restore 18 life to allies."],
  },
  starborn: {
    id: "starborn",
    name: "Starborn",
    glyph: "✺",
    thresholds: [2, 4],
    effects: ["Abilities deal 15% more damage.", "Abilities deal 30% more damage."],
  },
  hexer: {
    id: "hexer",
    name: "Hexer",
    glyph: "⬡",
    thresholds: [2, 4],
    effects: ["Ability targets lose 12 mana.", "Ability targets lose 25 mana."],
  },
};

const HERO_IDS = Object.keys(HEROES) as HeroId[];
const COMMANDER_XP: Record<number, number> = {
  1: 2,
  2: 4,
  3: 8,
  4: 12,
  5: 18,
  6: 26,
  7: 36,
  8: 0,
};

function emptyItemSlots(): UnitItemSlots {
  return [null, null, null];
}

function cloneCraftedItem(item: CraftedItem): CraftedItem {
  return { ...item };
}

function cloneItemSlots(slots?: readonly (CraftedItem | null)[]): UnitItemSlots {
  return [0, 1, 2].map((index) => {
    const item = slots?.[index];
    return item ? cloneCraftedItem(item) : null;
  }) as UnitItemSlots;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    componentInventory: Object.fromEntries(
      ITEM_COMPONENT_IDS.map((id) => [id, state.componentInventory?.[id] ?? 0]),
    ) as Record<ItemComponentId, number>,
    craftedItemInventory: (state.craftedItemInventory ?? []).map(cloneCraftedItem),
    units: state.units.map((unit) => ({ ...unit, itemSlots: cloneItemSlots(unit.itemSlots) })),
    enemyUnits: state.enemyUnits.map((unit) => ({ ...unit, itemSlots: cloneItemSlots(unit.itemSlots) })),
    shop: state.shop.map((offer) => (offer ? { ...offer } : null)),
    combatReport: state.combatReport,
    roundResult: state.roundResult,
  };
}

function randomStep(seed: number): { seed: number; value: number } {
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return { seed: next, value: next / 4294967296 };
}

function nextId(state: GameState, prefix: string): string {
  state.idCounter += 1;
  return `${prefix}-${state.idCounter}`;
}

function weightedHero(seed: number, level: number): { seed: number; heroId: HeroId } {
  const roll = randomStep(seed);
  const rarityCeiling = roll.value;
  const maxCost = level >= 7 ? 4 : level >= 5 ? 3 : 2;
  const desiredCost =
    rarityCeiling > 0.92 && maxCost >= 4
      ? 4
      : rarityCeiling > 0.7 && maxCost >= 3
        ? 3
        : rarityCeiling > 0.35
          ? 2
          : 1;
  const pool = HERO_IDS.filter((heroId) => HEROES[heroId].cost === desiredCost);
  const fallback = HERO_IDS.filter((heroId) => HEROES[heroId].cost <= maxCost);
  const candidates = pool.length ? pool : fallback;
  const pick = randomStep(roll.seed);
  return {
    seed: pick.seed,
    heroId: candidates[Math.floor(pick.value * candidates.length)] ?? "bramble",
  };
}

function rollShopMutable(state: GameState): Array<ShopOffer | null> {
  return Array.from({ length: SHOP_SIZE }, () => {
    const pick = weightedHero(state.seed, state.commanderLevel);
    state.seed = pick.seed;
    return {
      id: nextId(state, "offer"),
      heroId: pick.heroId,
      cost: HEROES[pick.heroId].cost,
    };
  });
}

function makeUnitMutable(
  state: GameState,
  heroId: HeroId,
  side: Side,
  position: number | null,
  benchIndex: number | null,
  stars = 1,
  level = 1,
): UnitInstance {
  return {
    id: nextId(state, side === "player" ? "unit" : "enemy"),
    heroId,
    side,
    stars,
    level,
    xp: 0,
    position,
    benchIndex,
    itemSlots: emptyItemSlots(),
  };
}

function enemyCountForRound(round: number): number {
  return Math.min(8, 3 + Math.ceil(round / 2));
}

function generateEnemyMutable(state: GameState): UnitInstance[] {
  const count = enemyCountForRound(state.round);
  const preferred = ["tide", "boitata", "nix", "vesper", "aster", "morrow", "piper", "sol", "bramble"] as HeroId[];
  const openPositions = [2, 5, 10, 13, 17, 20, 22, 7];
  return Array.from({ length: count }, (_, index) => {
    const variance = randomStep(state.seed);
    state.seed = variance.seed;
    const heroId = preferred[(state.round + index + Math.floor(variance.value * 3)) % preferred.length];
    const stars = state.round >= 8 && index < 2 ? 3 : state.round >= 4 && index < Math.ceil(count / 2) ? 2 : 1;
    const level = Math.min(MAX_UNIT_LEVEL, 1 + Math.floor((state.round - 1) / 3));
    return makeUnitMutable(state, heroId, "enemy", openPositions[index], null, stars, level);
  });
}

export function commanderXpToNext(level: number): number {
  return COMMANDER_XP[Math.min(MAX_COMMANDER_LEVEL, Math.max(1, level))] ?? 0;
}

export function unitXpToNext(level: number): number {
  return level >= MAX_UNIT_LEVEL ? 0 : 4 + (level - 1) * 4;
}

export function unitCapForLevel(level: number): number {
  return Math.min(8, Math.max(1, level));
}

export function getInterest(gold: number): number {
  return Math.min(5, Math.floor(Math.max(0, gold) / 10));
}

export function getStreakBonus(streak: number): number {
  const absolute = Math.abs(streak);
  return absolute >= 5 ? 3 : absolute >= 3 ? 2 : absolute >= 2 ? 1 : 0;
}

function recipeKey(first: ItemComponentId, second: ItemComponentId): string {
  return [first, second].sort().join("+");
}

export function getCraftedItemDefinition(
  first: ItemComponentId,
  second: ItemComponentId,
): ItemDefinition | null {
  const key = recipeKey(first, second);
  return Object.values(ITEM_DEFINITIONS).find(
    (definition) => recipeKey(definition.recipe[0], definition.recipe[1]) === key,
  ) ?? null;
}

export function getCraftedItemBonuses(item: CraftedItem): ItemStatBonuses {
  const base = ITEM_DEFINITIONS[item.itemId].bonuses;
  const enhancement = item.tier === "enhanced" && item.enhancement
    ? ITEM_COMPONENTS[item.enhancement].enhancementBonuses
    : null;
  return {
    maxHp: base.maxHp + (enhancement?.maxHp ?? 0),
    attack: base.attack + (enhancement?.attack ?? 0),
    armor: base.armor + (enhancement?.armor ?? 0),
    startingMana: base.startingMana + (enhancement?.startingMana ?? 0),
  };
}

function getEquippedItemBonuses(
  itemSlots?: readonly (CraftedItem | null)[],
): ItemStatBonuses {
  return (itemSlots ?? []).reduce<ItemStatBonuses>(
    (total, item) => {
      if (!item) return total;
      const bonuses = getCraftedItemBonuses(item);
      return {
        maxHp: total.maxHp + bonuses.maxHp,
        attack: total.attack + bonuses.attack,
        armor: total.armor + bonuses.armor,
        startingMana: total.startingMana + bonuses.startingMana,
      };
    },
    { maxHp: 0, attack: 0, armor: 0, startingMana: 0 },
  );
}

export function getUnitStats(
  unit: Pick<UnitInstance, "heroId" | "stars" | "level"> &
    Partial<Pick<UnitInstance, "itemSlots">>,
): UnitStats {
  const hero = HEROES[unit.heroId];
  const starScale = [1, 1, 1.65, 2.55][Math.min(MAX_STARS, Math.max(1, unit.stars))];
  const levelScale = 1 + (Math.min(MAX_UNIT_LEVEL, Math.max(1, unit.level)) - 1) * 0.12;
  const itemBonuses = getEquippedItemBonuses(unit.itemSlots);
  const maxMana = hero.ability.manaCost;
  return {
    maxHp: Math.round(hero.maxHp * starScale * levelScale) + itemBonuses.maxHp,
    attack: Math.round(hero.attack * starScale * levelScale) + itemBonuses.attack,
    armor: Math.round(hero.armor * (1 + (unit.level - 1) * 0.08)) + itemBonuses.armor,
    range: ROLE_PROFILES[hero.role].range,
    attackSpeed: hero.attackSpeed,
    manaRegen: hero.manaRegen,
    maxMana,
    startingMana: Math.min(maxMana, hero.startingMana + itemBonuses.startingMana),
  };
}

export function calculateWallOfFireShield(unit: Pick<CombatUnit, "level" | "maxHp" | "armor">): number {
  return Math.max(0, Math.round(20 + unit.level * 7 + unit.maxHp * 0.18 + unit.armor * 1.05));
}

function traitTier(id: TraitId, count: number): number {
  return TRAITS[id].thresholds.reduce((tier, threshold) => (count >= threshold ? tier + 1 : tier), 0);
}

export function getActiveTraits(units: UnitInstance[]): TraitStatus[] {
  const deployed = units.filter((unit) => unit.side === "player" && unit.position !== null);
  const counts = new Map<TraitId, number>();
  for (const unit of deployed) {
    for (const trait of HEROES[unit.heroId].traits) {
      counts.set(trait, (counts.get(trait) ?? 0) + 1);
    }
  }
  return (Object.keys(TRAITS) as TraitId[])
    .map((id) => {
      const count = counts.get(id) ?? 0;
      const tier = traitTier(id, count);
      return {
        id,
        count,
        tier,
        nextThreshold: TRAITS[id].thresholds[tier] ?? null,
        activeEffect: tier > 0 ? TRAITS[id].effects[tier - 1] : "Inactive",
      };
    })
    .filter((status) => status.count > 0)
    .sort((a, b) => b.tier - a.tier || b.count - a.count || a.id.localeCompare(b.id));
}

export function getCopyCount(state: GameState, heroId: HeroId, stars = 1): number {
  return state.units.filter((unit) => unit.heroId === heroId && unit.stars === stars).length;
}

export function createInitialGame(seed = 0xdecafbad): GameState {
  const state: GameState = {
    version: 1,
    seed: seed >>> 0,
    idCounter: 0,
    round: 1,
    phase: "planning",
    gold: 18,
    life: 72,
    commanderLevel: 3,
    commanderXp: 4,
    streak: 0,
    lastOutcome: null,
    componentInventory: { ember: 0, scale: 0, mote: 0 },
    craftedItemInventory: [],
    units: [],
    enemyUnits: [],
    shop: [],
    shopLocked: false,
    combatReport: null,
    roundResult: null,
    campaignOutcome: null,
  };
  state.units = [
    makeUnitMutable(state, "bramble", "player", 34, null),
    makeUnitMutable(state, "sol", "player", 38, null),
    makeUnitMutable(state, "nix", "player", 41, null),
  ];
  state.enemyUnits = generateEnemyMutable(state);
  state.shop = rollShopMutable(state);
  return state;
}

function fail(state: GameState, message: string): GameActionResult {
  return { ok: false, state, message };
}

function succeed(state: GameState, message: string): GameActionResult {
  return { ok: true, state, message };
}

function firstFreeBench(units: UnitInstance[]): number | null {
  for (let index = 0; index < BENCH_SIZE; index += 1) {
    if (!units.some((unit) => unit.benchIndex === index)) return index;
  }
  return null;
}

function addUnitXpMutable(unit: UnitInstance, amount: number): void {
  unit.xp += amount;
  while (unit.level < MAX_UNIT_LEVEL) {
    const needed = unitXpToNext(unit.level);
    if (needed === 0 || unit.xp < needed) break;
    unit.xp -= needed;
    unit.level += 1;
  }
  if (unit.level >= MAX_UNIT_LEVEL) unit.xp = 0;
}

function combineUnitsMutable(state: GameState): string[] {
  const messages: string[] = [];
  let merged = true;
  while (merged) {
    merged = false;
    for (const heroId of HERO_IDS) {
      for (let stars = 1; stars < MAX_STARS; stars += 1) {
        const copies = state.units
          .filter((unit) => unit.heroId === heroId && unit.stars === stars)
          .sort((a, b) => {
            const aDeployed = a.position !== null ? 0 : 1;
            const bDeployed = b.position !== null ? 0 : 1;
            return aDeployed - bDeployed || b.level - a.level || a.id.localeCompare(b.id);
          });
        if (copies.length < 3) continue;
        const [keeper, second, third] = copies;
        keeper.stars += 1;
        keeper.level = Math.max(keeper.level, second.level, third.level);
        keeper.xp = keeper.xp + second.xp + third.xp;
        addUnitXpMutable(keeper, 2);
        for (const item of [...second.itemSlots, ...third.itemSlots].filter(
          (candidate): candidate is CraftedItem => candidate !== null,
        )) {
          const freeSlot = keeper.itemSlots.findIndex((candidate) => candidate === null);
          if (freeSlot >= 0) keeper.itemSlots[freeSlot] = item;
          else state.craftedItemInventory.push(item);
        }
        state.units = state.units.filter((unit) => unit.id !== second.id && unit.id !== third.id);
        if (keeper.position === null && keeper.benchIndex === null) {
          keeper.benchIndex = firstFreeBench(state.units);
        }
        messages.push(`${HEROES[heroId].name} ascended to ${keeper.stars} stars.`);
        merged = true;
        break;
      }
      if (merged) break;
    }
  }
  return messages;
}

export function buyShopUnit(state: GameState, offerId: string): GameActionResult {
  if (state.phase !== "planning") return fail(state, "The market is closed during combat.");
  const offerIndex = state.shop.findIndex((offer) => offer?.id === offerId);
  const offer = state.shop[offerIndex];
  if (!offer) return fail(state, "That offer is no longer available.");
  if (state.gold < offer.cost) return fail(state, `Need ${offer.cost - state.gold} more gold.`);
  const mergePossible = state.units.filter((unit) => unit.heroId === offer.heroId && unit.stars === 1).length >= 2;
  const benchIndex = firstFreeBench(state.units);
  if (benchIndex === null && !mergePossible) return fail(state, "Your bench is full.");

  const next = cloneState(state);
  next.gold -= offer.cost;
  next.shop[offerIndex] = null;
  next.units.push(makeUnitMutable(next, offer.heroId, "player", null, benchIndex));
  const mergeMessages = combineUnitsMutable(next);
  return succeed(
    next,
    mergeMessages.length ? mergeMessages.join(" ") : `${HEROES[offer.heroId].name} joined your bench.`,
  );
}

export function refreshShop(state: GameState, free = false): GameActionResult {
  if (state.phase !== "planning") return fail(state, "You cannot refresh the market during combat.");
  if (!free && state.gold < REFRESH_COST) return fail(state, `Need ${REFRESH_COST - state.gold} more gold.`);
  const next = cloneState(state);
  if (!free) next.gold -= REFRESH_COST;
  next.shop = rollShopMutable(next);
  return succeed(next, free ? "A new market has arrived." : `Market refreshed for ${REFRESH_COST} gold.`);
}

function addCommanderXpMutable(state: GameState, amount: number): void {
  state.commanderXp += amount;
  while (state.commanderLevel < MAX_COMMANDER_LEVEL) {
    const needed = commanderXpToNext(state.commanderLevel);
    if (!needed || state.commanderXp < needed) break;
    state.commanderXp -= needed;
    state.commanderLevel += 1;
  }
  if (state.commanderLevel >= MAX_COMMANDER_LEVEL) state.commanderXp = 0;
}

export function buyPlayerXp(state: GameState): GameActionResult {
  if (state.phase !== "planning") return fail(state, "Training pauses during combat.");
  if (state.commanderLevel >= MAX_COMMANDER_LEVEL) return fail(state, "You are already at maximum commander level.");
  if (state.gold < XP_BUY_COST) return fail(state, `Need ${XP_BUY_COST - state.gold} more gold.`);
  const next = cloneState(state);
  const previousLevel = next.commanderLevel;
  next.gold -= XP_BUY_COST;
  addCommanderXpMutable(next, XP_BUY_AMOUNT);
  return succeed(
    next,
    next.commanderLevel > previousLevel
      ? `Commander level ${next.commanderLevel}. Team cap increased to ${unitCapForLevel(next.commanderLevel)}.`
      : `Gained ${XP_BUY_AMOUNT} commander XP.`,
  );
}

function isPlayerBoardCell(index: number): boolean {
  return Number.isInteger(index) && index >= PLAYER_START_ROW * BOARD_COLUMNS && index < BOARD_SIZE;
}

export function moveUnit(state: GameState, unitId: string, destination: UnitDestination): GameActionResult {
  if (state.phase !== "planning") return fail(state, "Formation is locked during combat.");
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit) return fail(state, "That unit is no longer available.");
  if (destination.kind === "board" && !isPlayerBoardCell(destination.index)) {
    return fail(state, "Allies can only be placed in your territory.");
  }
  if (destination.kind === "bench" && (destination.index < 0 || destination.index >= BENCH_SIZE)) {
    return fail(state, "That bench slot does not exist.");
  }
  const target = state.units.find((candidate) =>
    destination.kind === "board"
      ? candidate.position === destination.index
      : candidate.benchIndex === destination.index,
  );
  if (destination.kind === "board" && unit.position === null && !target) {
    const deployed = state.units.filter((candidate) => candidate.position !== null).length;
    if (deployed >= unitCapForLevel(state.commanderLevel)) {
      return fail(state, `Team cap reached: ${deployed}/${unitCapForLevel(state.commanderLevel)}.`);
    }
  }

  const next = cloneState(state);
  const moving = next.units.find((candidate) => candidate.id === unitId)!;
  const occupying = target ? next.units.find((candidate) => candidate.id === target.id)! : null;
  const originPosition = moving.position;
  const originBench = moving.benchIndex;

  if (destination.kind === "board") {
    moving.position = destination.index;
    moving.benchIndex = null;
  } else {
    moving.position = null;
    moving.benchIndex = destination.index;
  }
  if (occupying && occupying.id !== moving.id) {
    occupying.position = originPosition;
    occupying.benchIndex = originBench;
  }
  return succeed(next, `${HEROES[moving.heroId].name} moved into formation.`);
}

export function sellUnit(state: GameState, unitId: string): GameActionResult {
  if (state.phase !== "planning") return fail(state, "Units cannot be sold during combat.");
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit) return fail(state, "That unit is no longer available.");
  const copyValue = unit.stars === 3 ? 9 : unit.stars === 2 ? 3 : 1;
  const refund = HEROES[unit.heroId].cost * copyValue;
  const next = cloneState(state);
  const selling = next.units.find((candidate) => candidate.id === unitId)!;
  next.craftedItemInventory.push(
    ...selling.itemSlots.filter((item): item is CraftedItem => item !== null),
  );
  next.units = next.units.filter((candidate) => candidate.id !== unitId);
  next.gold += refund;
  return succeed(next, `${HEROES[unit.heroId].name} sold for ${refund} gold.`);
}

function canManageItems(state: GameState): boolean {
  return state.phase === "planning" || state.phase === "resolution";
}

export function craftItem(
  state: GameState,
  firstComponent: ItemComponentId,
  secondComponent: ItemComponentId,
): GameActionResult {
  if (!canManageItems(state)) return fail(state, "Items can only be crafted between combats.");
  const definition = getCraftedItemDefinition(firstComponent, secondComponent);
  if (!definition) return fail(state, "Those components do not form an item.");
  const needed = new Map<ItemComponentId, number>();
  needed.set(firstComponent, (needed.get(firstComponent) ?? 0) + 1);
  needed.set(secondComponent, (needed.get(secondComponent) ?? 0) + 1);
  for (const [componentId, count] of needed) {
    if ((state.componentInventory?.[componentId] ?? 0) < count) {
      return fail(state, `Need ${count} ${ITEM_COMPONENTS[componentId].name}${count === 1 ? "" : "s"}.`);
    }
  }

  const next = cloneState(state);
  for (const [componentId, count] of needed) next.componentInventory[componentId] -= count;
  next.craftedItemInventory.push({
    id: nextId(next, "item"),
    itemId: definition.id,
    tier: "full",
    enhancement: null,
  });
  return succeed(next, `${definition.name} crafted.`);
}

export function enhanceItem(
  state: GameState,
  craftedItemId: string,
  componentId: ItemComponentId,
): GameActionResult {
  if (!canManageItems(state)) return fail(state, "Items can only be enhanced between combats.");
  const item = state.craftedItemInventory?.find((candidate) => candidate.id === craftedItemId);
  if (!item) return fail(state, "That item is not in your inventory.");
  if (item.tier === "enhanced") return fail(state, "That item is already enhanced.");
  if ((state.componentInventory?.[componentId] ?? 0) < 1) {
    return fail(state, `Need 1 ${ITEM_COMPONENTS[componentId].name}.`);
  }

  const next = cloneState(state);
  const upgraded = next.craftedItemInventory.find((candidate) => candidate.id === craftedItemId)!;
  next.componentInventory[componentId] -= 1;
  upgraded.tier = "enhanced";
  upgraded.enhancement = componentId;
  return succeed(next, `${ITEM_DEFINITIONS[upgraded.itemId].name} enhanced with ${ITEM_COMPONENTS[componentId].name}.`);
}

export function enhanceEquippedItem(
  state: GameState,
  unitId: string,
  componentId: ItemComponentId,
): GameActionResult {
  if (!canManageItems(state)) return fail(state, "Items can only be enhanced between combats.");
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit) return fail(state, "That champion is no longer available.");
  const slotIndex = unit.itemSlots.findIndex((item) => item?.tier === "full");
  if (slotIndex < 0) return fail(state, "Equip a full item to this champion before enhancing it.");
  if ((state.componentInventory?.[componentId] ?? 0) < 1) {
    return fail(state, `Need 1 ${ITEM_COMPONENTS[componentId].name}.`);
  }

  const next = cloneState(state);
  const upgraded = next.units.find((candidate) => candidate.id === unitId)!.itemSlots[slotIndex]!;
  next.componentInventory[componentId] -= 1;
  upgraded.tier = "enhanced";
  upgraded.enhancement = componentId;
  return succeed(
    next,
    `${ITEM_DEFINITIONS[upgraded.itemId].name} on ${HEROES[unit.heroId].name} enhanced with ${ITEM_COMPONENTS[componentId].name}.`,
  );
}

export function equipItem(
  state: GameState,
  unitId: string,
  craftedItemId: string,
  slotIndex?: number,
): GameActionResult {
  if (!canManageItems(state)) return fail(state, "Items can only be equipped between combats.");
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit) return fail(state, "That unit is no longer available.");
  const item = state.craftedItemInventory?.find((candidate) => candidate.id === craftedItemId);
  if (!item) return fail(state, "That item is not in your inventory.");
  const destination = slotIndex ?? unit.itemSlots.findIndex((candidate) => candidate === null);
  if (!Number.isInteger(destination) || destination < 0 || destination >= ITEM_SLOTS_PER_UNIT) {
    return fail(state, "That item slot does not exist.");
  }
  if (unit.itemSlots[destination] !== null) return fail(state, "That item slot is already occupied.");

  const next = cloneState(state);
  const inventoryIndex = next.craftedItemInventory.findIndex((candidate) => candidate.id === craftedItemId);
  const [equipped] = next.craftedItemInventory.splice(inventoryIndex, 1);
  next.units.find((candidate) => candidate.id === unitId)!.itemSlots[destination] = equipped;
  return succeed(next, `${ITEM_DEFINITIONS[equipped.itemId].name} equipped to ${HEROES[unit.heroId].name}.`);
}

export function unequipItem(
  state: GameState,
  unitId: string,
  slotIndex: number,
): GameActionResult {
  if (!canManageItems(state)) return fail(state, "Items can only be unequipped between combats.");
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit) return fail(state, "That unit is no longer available.");
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= ITEM_SLOTS_PER_UNIT) {
    return fail(state, "That item slot does not exist.");
  }
  const item = unit.itemSlots[slotIndex];
  if (!item) return fail(state, "That item slot is empty.");

  const next = cloneState(state);
  const unequipped = next.units.find((candidate) => candidate.id === unitId)!.itemSlots[slotIndex]!;
  next.units.find((candidate) => candidate.id === unitId)!.itemSlots[slotIndex] = null;
  next.craftedItemInventory.push(unequipped);
  return succeed(next, `${ITEM_DEFINITIONS[item.itemId].name} returned to inventory.`);
}

function manhattan(a: number, b: number): number {
  const ax = a % BOARD_COLUMNS;
  const ay = Math.floor(a / BOARD_COLUMNS);
  const bx = b % BOARD_COLUMNS;
  const by = Math.floor(b / BOARD_COLUMNS);
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function adjacent(a: number, b: number): boolean {
  return manhattan(a, b) <= 1;
}

function snapshot(units: CombatUnit[]): CombatUnit[] {
  return units.map((unit) => ({
    ...unit,
    mana: roundCombatDecimal(unit.mana),
    itemSlots: unit.itemSlots ? cloneItemSlots(unit.itemSlots) : undefined,
  }));
}

/**
 * Summarizes effective combat contributions from chronological post-action
 * snapshots. This deliberately uses total shield only; fireWallShield is a
 * tracked subset and would otherwise count Boitata's protection twice.
 */
export function getCombatStatistics(
  report: Pick<CombatReport, "initialUnits" | "events">,
): CombatStatistics {
  const units: UnitCombatStatistics[] = report.initialUnits.map((unit) => ({
    unitId: unit.id,
    heroId: unit.heroId,
    side: unit.side,
    stars: unit.stars,
    level: unit.level,
    damageDealt: 0,
    shieldGranted: 0,
    healingDone: 0,
  }));
  const statsById = new Map(units.map((unit) => [unit.unitId, unit]));
  let previousSnapshot = report.initialUnits;

  for (const event of report.events) {
    const beforeById = new Map(previousSnapshot.map((unit) => [unit.id, unit]));
    const afterById = new Map(event.snapshot.map((unit) => [unit.id, unit]));
    const actor = event.actorId
      ? afterById.get(event.actorId) ?? beforeById.get(event.actorId) ?? null
      : null;
    const actorStats = actor ? statsById.get(actor.id) ?? null : null;

    if (actor && actorStats) {
      for (const after of event.snapshot) {
        const before = beforeById.get(after.id);
        if (!before) continue;
        if (after.side !== actor.side) {
          actorStats.damageDealt +=
            Math.max(0, before.hp - after.hp) +
            Math.max(0, before.shield - after.shield);
        } else {
          actorStats.healingDone += Math.max(0, after.hp - before.hp);
          actorStats.shieldGranted += Math.max(0, after.shield - before.shield);
        }
      }
    }

    previousSnapshot = event.snapshot;
  }

  const teams: Record<Side, CombatStatTotals> = {
    player: { damageDealt: 0, shieldGranted: 0, healingDone: 0 },
    enemy: { damageDealt: 0, shieldGranted: 0, healingDone: 0 },
  };
  for (const unit of units) {
    teams[unit.side].damageDealt += unit.damageDealt;
    teams[unit.side].shieldGranted += unit.shieldGranted;
    teams[unit.side].healingDone += unit.healingDone;
  }

  return { teams, units };
}

function combatName(unit: CombatUnit): string {
  return HEROES[unit.heroId].name;
}

function traitCountsForSide(
  units: readonly Pick<CombatUnit, "heroId" | "side">[],
  side: Side,
): Record<TraitId, number> {
  const counts = Object.fromEntries((Object.keys(TRAITS) as TraitId[]).map((id) => [id, 0])) as Record<TraitId, number>;
  for (const unit of units.filter((candidate) => candidate.side === side)) {
    for (const trait of HEROES[unit.heroId].traits) counts[trait] += 1;
  }
  return counts;
}

function tierValue(id: TraitId, count: number, values: number[]): number {
  const tier = traitTier(id, count);
  return tier > 0 ? values[Math.min(values.length, tier) - 1] : 0;
}

interface FormationAbilityBonuses {
  armor: number;
  attackPercent: number;
  abilityDamagePercent: number;
  hexerManaDrain: number;
  teamHealing: number;
  takedownMana: number;
  startingManaBonus: number;
}

interface AbilityEvaluationInput {
  heroId: HeroId;
  stars: 1 | 2 | 3;
  level: number;
  attack: number;
  maxHp: number;
  armor: number;
  formation: FormationAbilityBonuses;
}

function formationAbilityBonuses(counts: Record<TraitId, number>): FormationAbilityBonuses {
  return {
    armor: tierValue("vanguard", counts.vanguard, [15, 35]),
    attackPercent: tierValue("duelist", counts.duelist, [0.12, 0.28]),
    abilityDamagePercent: tierValue("starborn", counts.starborn, [0.15, 0.3]),
    hexerManaDrain: tierValue("hexer", counts.hexer, [12, 25]),
    teamHealing: tierValue("verdant", counts.verdant, [8, 18]),
    takedownMana: tierValue("nightbound", counts.nightbound, [20, 35]),
    startingManaBonus: tierValue("invoker", counts.invoker, [12, 28]),
  };
}

function normalizeStars(stars: number): 1 | 2 | 3 {
  return Math.min(MAX_STARS, Math.max(1, Math.round(stars))) as 1 | 2 | 3;
}

/**
 * The single source of truth for scalar ability output. Values are raw,
 * pre-mitigation amounts; combat later records the amount actually applied.
 */
function evaluateAbilityValues(input: AbilityEvaluationInput): AbilityValues {
  const values: AbilityValues = {
    heroId: input.heroId,
    stars: input.stars,
    damage: 0,
    healing: 0,
    shield: 0,
    minTargets: 1,
    maxTargets: 1,
    projectiles: 0,
    manaDrain: 0,
    stunTurns: 0,
    selfHealPercent: 0,
    teamHealing: input.formation.teamHealing,
    takedownMana: 0,
    startingManaBonus: input.formation.startingManaBonus,
    ignoresArmor: false,
  };
  const scaleDamage = (amount: number) =>
    Math.round(amount * (1 + input.formation.abilityDamagePercent));

  if (input.heroId === "bramble") {
    values.healing = Math.round(23 + input.level * 6 + input.attack * 0.3);
    values.shield = Math.round(42 + input.attack * 0.8);
    values.minTargets = 0;
    values.maxTargets = input.stars >= 3 ? 2 : 1;
  } else if (input.heroId === "boitata") {
    values.shield = calculateWallOfFireShield(input);
  } else if (input.heroId === "sol") {
    values.damage = scaleDamage(48 + input.attack * 0.9);
    values.maxTargets = 5;
  } else if (input.heroId === "nix") {
    values.damage = scaleDamage(58 + input.attack * 1.15);
    values.ignoresArmor = true;
  } else if (input.heroId === "aster") {
    values.damage = scaleDamage(54 + input.attack * 1.25);
    values.shield = Math.round(28 + input.attack * 0.35);
  } else if (input.heroId === "morrow") {
    values.damage = scaleDamage(50 + input.attack);
    values.manaDrain = 28 + input.formation.hexerManaDrain;
    values.selfHealPercent = 55;
  } else if (input.heroId === "tide") {
    values.healing = Math.round(44 + input.attack * 0.7);
    values.shield = Math.round(19 + input.level * 4 + input.attack * 0.35);
  } else if (input.heroId === "vesper") {
    values.damage = scaleDamage(42 + input.attack * 0.85);
    values.manaDrain = 35 + input.formation.hexerManaDrain;
    values.stunTurns = 1;
  } else if (input.heroId === "piper") {
    values.damage = scaleDamage(31 + input.attack * 0.65);
    values.maxTargets = input.stars >= 3 ? 3 : 2;
    values.projectiles = values.maxTargets;
  }

  const isEnemyDamageAbility = values.damage > 0;
  if (isEnemyDamageAbility && input.heroId !== "morrow" && input.heroId !== "vesper") {
    values.manaDrain = input.formation.hexerManaDrain;
  }
  if (isEnemyDamageAbility) values.takedownMana = input.formation.takedownMana;
  return values;
}

function abilityScalingDescription(byStar: AbilityPreview["byStar"]): string {
  const heroId = byStar[0].heroId;
  const triplet = (read: (value: AbilityValues) => number | string) =>
    `(${byStar.map(read).join("/")})`;

  if (heroId === "bramble") {
    return `Shields self for ${triplet((value) => value.shield)} and heals up to ${triplet((value) => value.maxTargets)} adjacent allies for ${triplet((value) => value.healing)} Life each at 1★/2★/3★.`;
  }
  if (heroId === "boitata") {
    return `Shields self for ${triplet((value) => value.shield)} damage at 1★/2★/3★.`;
  }
  if (heroId === "sol") {
    return `Hits ${triplet((value) => `${value.minTargets}–${value.maxTargets}`)} clustered enemies for ${triplet((value) => value.damage)} raw damage each at 1★/2★/3★.`;
  }
  if (heroId === "nix") {
    return `Strikes ${triplet((value) => value.maxTargets)} enemy for ${triplet((value) => value.damage)} true damage at 1★/2★/3★.`;
  }
  if (heroId === "aster") {
    return `Strikes ${triplet((value) => value.maxTargets)} enemy for ${triplet((value) => value.damage)} raw damage and gains ${triplet((value) => value.shield)} Shield at 1★/2★/3★.`;
  }
  if (heroId === "morrow") {
    return `Drains ${triplet((value) => value.maxTargets)} enemy for ${triplet((value) => value.damage)} raw damage and heals self for ${triplet((value) => value.selfHealPercent)}% of applied damage at 1★/2★/3★.`;
  }
  if (heroId === "tide") {
    return `Heals ${triplet((value) => value.maxTargets)} ally for ${triplet((value) => value.healing)} Life and grants ${triplet((value) => value.shield)} Shield at 1★/2★/3★.`;
  }
  if (heroId === "vesper") {
    return `Hits ${triplet((value) => value.maxTargets)} enemy for ${triplet((value) => value.damage)} raw damage, drains ${triplet((value) => value.manaDrain)} Mana, and skips ${triplet((value) => value.stunTurns)} action at 1★/2★/3★.`;
  }
  return `Fires ${triplet((value) => value.projectiles)} projectiles into up to ${triplet((value) => value.maxTargets)} enemies for ${triplet((value) => value.damage)} raw damage each at 1★/2★/3★.`;
}

export function getAbilityPreview(
  unit: UnitInstance,
  teamUnits: readonly UnitInstance[],
): AbilityPreview {
  const isDeployed = unit.position !== null;
  const formationUnits = isDeployed
    ? teamUnits.filter((candidate) => candidate.side === unit.side && candidate.position !== null)
    : [];
  if (isDeployed && !formationUnits.some((candidate) => candidate.id === unit.id)) {
    formationUnits.push(unit);
  }
  const counts = traitCountsForSide(formationUnits, unit.side);
  const formation = formationAbilityBonuses(counts);
  const byStar = ([1, 2, 3] as const).map((stars) => {
    const base = getUnitStats({ ...unit, stars });
    return evaluateAbilityValues({
      heroId: unit.heroId,
      stars,
      level: unit.level,
      attack: Math.round(base.attack * (1 + formation.attackPercent)),
      maxHp: base.maxHp,
      armor: base.armor + formation.armor,
      formation,
    });
  }) as AbilityPreview["byStar"];
  const current = byStar[normalizeStars(unit.stars) - 1];
  const itemBonuses = getEquippedItemBonuses(unit.itemSlots);
  const currentStats = getUnitStats(unit);
  const baseStartingMana = Math.min(currentStats.maxMana, HEROES[unit.heroId].startingMana);
  const itemStartingMana = Math.max(0, currentStats.startingMana - baseStartingMana);
  const bondStartingMana = Math.max(
    0,
    Math.min(currentStats.maxMana, currentStats.startingMana + formation.startingManaBonus) - currentStats.startingMana,
  );
  const usesAttackScaling = unit.heroId !== "boitata";
  const usesDefensiveScaling = unit.heroId === "boitata";
  const modifiers: string[] = [];
  if (usesDefensiveScaling && itemBonuses.maxHp > 0) modifiers.push(`Item · +${itemBonuses.maxHp} max Life`);
  if (usesAttackScaling && itemBonuses.attack > 0) modifiers.push(`Item · +${itemBonuses.attack} Attack`);
  if (usesDefensiveScaling && itemBonuses.armor > 0) modifiers.push(`Item · +${itemBonuses.armor} Armor`);
  if (itemStartingMana > 0) modifiers.push(`Item · +${itemStartingMana} starting Mana`);
  if (usesDefensiveScaling && formation.armor > 0) modifiers.push(`Bond · Vanguard +${formation.armor} Armor`);
  if (usesAttackScaling && formation.attackPercent > 0) {
    modifiers.push(`Bond · Duelist +${Math.round(formation.attackPercent * 100)}% Attack`);
  }
  if (formation.abilityDamagePercent > 0 && current.damage > 0) {
    modifiers.push(`Bond · Starborn +${Math.round(formation.abilityDamagePercent * 100)}% ability damage`);
  }
  if (formation.hexerManaDrain > 0 && current.damage > 0) {
    modifiers.push(`Bond · Hexer drains ${formation.hexerManaDrain} Mana from ability targets`);
  }
  if (formation.teamHealing > 0) {
    modifiers.push(`Bond · Verdant heals all allies for ${formation.teamHealing} after casting`);
  }
  if (current.takedownMana > 0) {
    modifiers.push(`Bond · Nightbound grants ${current.takedownMana} Mana per takedown`);
  }
  if (bondStartingMana > 0) {
    modifiers.push(`Bond · Invoker +${bondStartingMana} starting Mana`);
  }
  const formationContext = isDeployed
    ? `Current values include the deployed ${unit.side} formation's active bonds.`
    : "Bench preview: deploy this character to activate formation bonds.";
  const outputNotes = [formationContext];
  if (current.damage > 0) {
    outputNotes.push(current.ignoresArmor
      ? "Damage is shown before shields; this ability ignores Armor."
      : "Damage is shown before enemy Armor, shields, and remaining-Life limits.");
  }
  if (current.healing > 0) outputNotes.push("Healing is shown before missing-Life limits.");
  if (current.selfHealPercent > 0) outputNotes.push("Self-healing uses the damage actually applied.");
  if (current.teamHealing > 0) outputNotes.push("Team healing is shown before missing-Life limits.");
  if (current.shield > 0) outputNotes.push("Shield is the full amount granted.");

  return {
    current,
    byStar,
    modifiers,
    scalingDescription: abilityScalingDescription(byStar),
    contextNote: outputNotes.join(" "),
  };
}

function makeCombatUnits(state: GameState): CombatUnit[] {
  const persistent = [
    ...state.units.filter((unit) => unit.position !== null),
    ...state.enemyUnits.filter((unit) => unit.position !== null),
  ];
  const base = persistent.map((unit) => {
    const stats = getUnitStats(unit);
    return {
      id: unit.id,
      heroId: unit.heroId,
      side: unit.side,
      stars: unit.stars,
      level: unit.level,
      position: unit.position!,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      mana: stats.startingMana,
      maxMana: stats.maxMana,
      attack: stats.attack,
      armor: stats.armor,
      range: stats.range,
      attackSpeed: stats.attackSpeed,
      manaRegen: stats.manaRegen,
      shield: 0,
      fireWallShield: 0,
      stunned: 0,
      alive: true,
      itemSlots: cloneItemSlots(unit.itemSlots),
    } satisfies CombatUnit;
  });
  for (const side of ["player", "enemy"] as Side[]) {
    const counts = traitCountsForSide(base, side);
    const formation = formationAbilityBonuses(counts);
    for (const unit of base.filter((candidate) => candidate.side === side)) {
      unit.armor += formation.armor;
      unit.attack = Math.round(unit.attack * (1 + formation.attackPercent));
      unit.mana = Math.min(unit.maxMana, unit.mana + formation.startingManaBonus);
    }
  }
  return base;
}

function damageUnit(target: CombatUnit, rawDamage: number, ignoreArmor = false): number {
  const mitigated = ignoreArmor ? rawDamage : Math.max(1, Math.round((rawDamage * 100) / (100 + target.armor)));
  const shieldDamage = Math.min(target.shield, mitigated);
  target.shield -= shieldDamage;
  target.fireWallShield = Math.max(0, target.fireWallShield - shieldDamage);
  const healthDamage = Math.min(target.hp, mitigated - shieldDamage);
  target.hp -= healthDamage;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
  }
  return shieldDamage + healthDamage;
}

function healUnit(target: CombatUnit, amount: number): number {
  const restored = Math.min(target.maxHp - target.hp, Math.max(0, Math.round(amount)));
  target.hp += restored;
  return restored;
}

function nearestEnemy(actor: CombatUnit, units: CombatUnit[]): CombatUnit | null {
  return (
    units
      .filter((unit) => unit.side !== actor.side && unit.alive)
      .sort((a, b) => manhattan(actor.position, a.position) - manhattan(actor.position, b.position) || a.hp - b.hp || a.id.localeCompare(b.id))[0] ??
    null
  );
}

function openStepToward(actor: CombatUnit, target: CombatUnit, units: CombatUnit[]): number | null {
  const occupied = new Set(units.filter((unit) => unit.alive && unit.id !== actor.id).map((unit) => unit.position));
  const x = actor.position % BOARD_COLUMNS;
  const y = Math.floor(actor.position / BOARD_COLUMNS);
  const candidates = [
    x < BOARD_COLUMNS - 1 ? actor.position + 1 : -1,
    x > 0 ? actor.position - 1 : -1,
    y < BOARD_ROWS - 1 ? actor.position + BOARD_COLUMNS : -1,
    y > 0 ? actor.position - BOARD_COLUMNS : -1,
  ]
    .filter((position) => position >= 0 && !occupied.has(position))
    .sort((a, b) => manhattan(a, target.position) - manhattan(b, target.position) || a - b);
  return candidates[0] ?? null;
}

function addEvent(
  events: CombatEvent[],
  units: CombatUnit[],
  turn: number,
  timestamp: number,
  type: CombatEventType,
  text: string,
  options: Pick<CombatEvent, "actorId" | "targetIds" | "amount" | "amounts"> = {},
): void {
  events.push({
    id: `event-${events.length + 1}`,
    turn,
    timestamp,
    type,
    text,
    snapshot: snapshot(units),
    ...options,
  });
}

function strongestClusterTarget(actor: CombatUnit, units: CombatUnit[]): CombatUnit | null {
  const enemies = units.filter((unit) => unit.side !== actor.side && unit.alive);
  return (
    enemies
      .map((enemy) => ({ enemy, cluster: enemies.filter((candidate) => adjacent(enemy.position, candidate.position)).length }))
      .sort((a, b) => b.cluster - a.cluster || a.enemy.hp - b.enemy.hp || a.enemy.id.localeCompare(b.enemy.id))[0]?.enemy ?? null
  );
}

function castAbility(
  actor: CombatUnit,
  units: CombatUnit[],
  events: CombatEvent[],
  turn: number,
  timestamp: number,
): void {
  const hero = HEROES[actor.heroId];
  const allies = units.filter((unit) => unit.side === actor.side && unit.alive);
  const enemies = units.filter((unit) => unit.side !== actor.side && unit.alive);
  const counts = traitCountsForSide(units, actor.side);
  const values = evaluateAbilityValues({
    heroId: actor.heroId,
    stars: normalizeStars(actor.stars),
    level: actor.level,
    attack: actor.attack,
    maxHp: actor.maxHp,
    armor: actor.armor,
    formation: formationAbilityBonuses(counts),
  });
  const targets: CombatUnit[] = [];
  let amount = 0;
  const amounts: Record<string, number> = {};
  const addTarget = (target: CombatUnit, impact: number) => {
    targets.push(target);
    amounts[target.id] = impact;
    amount += impact;
  };

  actor.mana = 0;
  if (actor.heroId === "bramble") {
    actor.shield += values.shield;
    const woundedAllies = allies
      .filter((unit) => unit.id !== actor.id && adjacent(unit.position, actor.position))
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
      .slice(0, values.maxTargets);
    for (const ally of woundedAllies) {
      addTarget(ally, healUnit(ally, values.healing));
    }
  } else if (actor.heroId === "boitata") {
    const gainedShield = values.shield;
    actor.shield += gainedShield;
    actor.fireWallShield += gainedShield;
    addTarget(actor, gainedShield);
  } else if (actor.heroId === "sol") {
    const center = strongestClusterTarget(actor, units);
    if (center) {
      for (const target of enemies.filter((enemy) => adjacent(enemy.position, center.position))) {
        const impact = damageUnit(target, values.damage);
        target.mana = Math.max(0, target.mana - values.manaDrain);
        addTarget(target, impact);
      }
    }
  } else if (actor.heroId === "nix") {
    const target = enemies.sort((a, b) => manhattan(actor.position, b.position) - manhattan(actor.position, a.position))[0];
    if (target) {
      const impact = damageUnit(target, values.damage, values.ignoresArmor);
      target.mana = Math.max(0, target.mana - values.manaDrain);
      const step = openStepToward(actor, target, units);
      if (step !== null) actor.position = step;
      addTarget(target, impact);
    }
  } else if (actor.heroId === "aster") {
    const target = nearestEnemy(actor, units);
    if (target) {
      const impact = damageUnit(target, values.damage);
      target.mana = Math.max(0, target.mana - values.manaDrain);
      actor.shield += values.shield;
      addTarget(target, impact);
    }
  } else if (actor.heroId === "morrow") {
    const target = enemies.sort((a, b) => b.mana - a.mana || a.hp - b.hp)[0];
    if (target) {
      const impact = damageUnit(target, values.damage);
      target.mana = Math.max(0, target.mana - values.manaDrain);
      healUnit(actor, impact * (values.selfHealPercent / 100));
      addTarget(target, impact);
    }
  } else if (actor.heroId === "tide") {
    const target = allies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (target) {
      const impact = healUnit(target, values.healing);
      target.shield += values.shield;
      addTarget(target, impact);
    }
  } else if (actor.heroId === "vesper") {
    const target = enemies.sort((a, b) => b.mana - a.mana || a.hp - b.hp)[0];
    if (target) {
      const impact = damageUnit(target, values.damage);
      target.mana = Math.max(0, target.mana - values.manaDrain);
      target.stunned = Math.max(target.stunned, values.stunTurns);
      addTarget(target, impact);
    }
  } else if (actor.heroId === "piper") {
    for (const target of enemies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp).slice(0, values.maxTargets)) {
      const impact = damageUnit(target, values.damage);
      target.mana = Math.max(0, target.mana - values.manaDrain);
      addTarget(target, impact);
    }
  }

  if (values.teamHealing > 0) {
    for (const ally of allies) healUnit(ally, values.teamHealing);
  }
  const abilityText = actor.heroId === "boitata"
    ? `${combatName(actor)} coils into ${hero.ability.name} and gains ${Math.round(amount)} shield.`
    : `${combatName(actor)} casts ${hero.ability.name}${targets.length ? ` on ${targets.map(combatName).join(" and ")}` : ""}${amount ? ` for ${Math.round(amount)} impact` : ""}.`;
  addEvent(
    events,
    units,
    turn,
    timestamp,
    "ability",
    abilityText,
    { actorId: actor.id, targetIds: targets.map((target) => target.id), amount, amounts },
  );
  const defeatedEnemies = targets.filter((unit) => unit.side !== actor.side && !unit.alive);
  if (defeatedEnemies.length > 0) {
    actor.mana = Math.min(actor.maxMana, actor.mana + values.takedownMana * defeatedEnemies.length);
  }
  for (const target of defeatedEnemies) {
    addEvent(events, units, turn, timestamp, "defeat", `${combatName(target)} is defeated.`, {
      actorId: actor.id,
      targetIds: [target.id],
    });
  }
}

function projectedIncome(state: GameState, outcome: Outcome): IncomeBreakdown {
  const base = 5;
  const interest = getInterest(state.gold);
  const nextStreak =
    outcome === "victory"
      ? state.streak >= 0
        ? state.streak + 1
        : 1
      : state.streak <= 0
        ? state.streak - 1
        : -1;
  const streak = getStreakBonus(nextStreak);
  const victory = outcome === "victory" ? 1 : 0;
  return { base, interest, streak, victory, total: base + interest + streak + victory };
}

function roundCombatDecimal(value: number): number {
  return Math.round(value * COMBAT_DECIMAL_PRECISION) / COMBAT_DECIMAL_PRECISION;
}

function regenerateMana(units: CombatUnit[], elapsedSeconds: number): void {
  if (elapsedSeconds <= 0) return;
  for (const unit of units) {
    if (!unit.alive || unit.mana >= unit.maxMana) continue;
    const regeneratedMana = unit.mana + elapsedSeconds * unit.manaRegen;
    unit.mana = regeneratedMana >= unit.maxMana - COMBAT_EPSILON
      ? unit.maxMana
      : regeneratedMana;
  }
}

function nextOpportunityTime(unit: CombatUnit, completedOpportunities: number): number {
  return roundCombatDecimal((completedOpportunities + 1) / unit.attackSpeed);
}

export function resolveCombat(state: GameState): GameActionResult {
  if (state.phase !== "planning") return fail(state, "This round is already in progress.");
  const deployed = state.units.filter((unit) => unit.position !== null);
  if (deployed.length === 0) return fail(state, "Deploy at least one ally before battle.");
  if (deployed.length > unitCapForLevel(state.commanderLevel)) return fail(state, "Your formation exceeds the team cap.");

  const units = makeCombatUnits(state);
  const initialUnits = snapshot(units);
  const events: CombatEvent[] = [];
  addEvent(
    events,
    units,
    0,
    0,
    "start",
    `Round ${state.round} begins. ${deployed.length} allies face ${state.enemyUnits.length} enemies.`,
  );
  let turn = 0;
  let elapsedTime = 0;
  let reachedTimeLimit = false;
  const completedOpportunities = new Map(units.map((unit) => [unit.id, 0]));
  const nextActionAt = new Map(
    units.map((unit) => [unit.id, nextOpportunityTime(unit, 0)]),
  );

  while (
    turn < MAX_COMBAT_ACTIONS &&
    units.some((unit) => unit.side === "player" && unit.alive) &&
    units.some((unit) => unit.side === "enemy" && unit.alive)
  ) {
    const actor = units
      .filter((unit) => unit.alive)
      .sort((a, b) => {
        const timeDelta = (nextActionAt.get(a.id) ?? Infinity) - (nextActionAt.get(b.id) ?? Infinity);
        if (timeDelta !== 0) return timeDelta;
        if (a.side !== b.side) return a.side === "player" ? -1 : 1;
        return a.id.localeCompare(b.id);
      })[0];
    if (!actor) break;

    const actionTime = nextActionAt.get(actor.id) ?? Infinity;
    if (actionTime > COMBAT_DURATION_SECONDS) {
      regenerateMana(units, COMBAT_DURATION_SECONDS - elapsedTime);
      elapsedTime = COMBAT_DURATION_SECONDS;
      reachedTimeLimit = true;
      break;
    }
    regenerateMana(units, actionTime - elapsedTime);
    elapsedTime = actionTime;
    turn += 1;
    const actorOpportunities = (completedOpportunities.get(actor.id) ?? 0) + 1;
    completedOpportunities.set(actor.id, actorOpportunities);
    nextActionAt.set(actor.id, nextOpportunityTime(actor, actorOpportunities));

    if (actor.stunned > 0) {
      actor.stunned -= 1;
      addEvent(
        events,
        units,
        turn,
        elapsedTime,
        "move",
        `${combatName(actor)} is stunned and skips the action.`,
        { actorId: actor.id },
      );
      continue;
    }
    if (actor.mana >= actor.maxMana) {
      castAbility(actor, units, events, turn, elapsedTime);
      continue;
    }
    const target = nearestEnemy(actor, units);
    if (!target) break;
    if (manhattan(actor.position, target.position) > actor.range) {
      const step = openStepToward(actor, target, units);
      if (step !== null) {
        actor.position = step;
        addEvent(events, units, turn, elapsedTime, "move", `${combatName(actor)} advances.`, {
          actorId: actor.id,
          targetIds: [target.id],
        });
      } else {
        addEvent(events, units, turn, elapsedTime, "move", `${combatName(actor)} holds position.`, {
          actorId: actor.id,
        });
      }
      continue;
    }

    const damage = damageUnit(target, actor.attack);
    addEvent(
      events,
      units,
      turn,
      elapsedTime,
      "attack",
      `${combatName(actor)} strikes ${combatName(target)} for ${damage} damage.`,
      {
        actorId: actor.id,
        targetIds: [target.id],
        amount: damage,
      },
    );
    if (!target.alive) {
      const counts = traitCountsForSide(units, actor.side);
      actor.mana = Math.min(actor.maxMana, actor.mana + tierValue("nightbound", counts.nightbound, [20, 35]));
      addEvent(events, units, turn, elapsedTime, "defeat", `${combatName(target)} is defeated.`, {
        actorId: actor.id,
        targetIds: [target.id],
      });
    }
  }

  const playerAlive = units.filter((unit) => unit.side === "player" && unit.alive);
  const enemyAlive = units.filter((unit) => unit.side === "enemy" && unit.alive);
  const playerHealth = playerAlive.reduce((total, unit) => total + unit.hp, 0);
  const enemyHealth = enemyAlive.reduce((total, unit) => total + unit.hp, 0);
  const outcome: Outcome = playerAlive.length > 0 && (enemyAlive.length === 0 || playerHealth >= enemyHealth) ? "victory" : "defeat";
  const reachedActionLimit = turn >= MAX_COMBAT_ACTIONS && playerAlive.length > 0 && enemyAlive.length > 0;
  const reachedCombatLimit = reachedTimeLimit || reachedActionLimit;
  const playerDamage =
    outcome === "defeat" ? Math.max(3, enemyAlive.reduce((total, unit) => total + unit.stars * 2 + 1, 0)) : 0;
  const income = projectedIncome(state, outcome);
  const unitXp = Object.fromEntries(deployed.map((unit) => [unit.id, outcome === "victory" ? 3 : 2]));
  const outcomeText = reachedCombatLimit
    ? outcome === "victory"
      ? `${reachedTimeLimit ? "Time expires" : "The clash reaches its limit"}. Your formation holds the advantage. Victory.`
      : `${reachedTimeLimit ? "Time expires" : "The clash reaches its limit"} with the enemy ahead. Commander loses ${playerDamage} life.`
    : outcome === "victory"
      ? "The enemy line breaks. Victory."
      : `Your formation falls. Commander loses ${playerDamage} life.`;
  addEvent(
    events,
    units,
    turn + 1,
    elapsedTime,
    "outcome",
    outcomeText,
  );

  const report: CombatReport = {
    id: `combat-${state.round}-${state.seed}`,
    round: state.round,
    outcome,
    events,
    initialUnits,
    finalUnits: snapshot(units),
    income,
    playerDamage,
    commanderXp: 2,
    unitXp,
  };
  const next = cloneState(state);
  next.phase = "combat";
  next.combatReport = report;
  next.roundResult = null;
  return { ok: true, state: next, message: `Round ${state.round} combat started.`, report };
}

export function applyCombatResult(state: GameState): GameActionResult {
  if (state.phase !== "combat" || !state.combatReport) return fail(state, "No combat result is waiting.");
  const report = state.combatReport;
  if (report.round !== state.round) return fail(state, "That combat result belongs to another round.");

  const next = cloneState(state);
  next.gold += report.income.total;
  next.life = Math.max(0, next.life - report.playerDamage);
  next.lastOutcome = report.outcome;
  next.streak =
    report.outcome === "victory"
      ? next.streak >= 0
        ? next.streak + 1
        : 1
      : next.streak <= 0
        ? next.streak - 1
        : -1;
  addCommanderXpMutable(next, report.commanderXp);
  for (const unit of next.units) {
    const gained = report.unitXp[unit.id] ?? 0;
    if (gained) addUnitXpMutable(unit, gained);
  }
  next.roundResult = {
    outcome: report.outcome,
    round: report.round,
    lifeDelta: -report.playerDamage,
    goldEarned: report.income.total,
    commanderXp: report.commanderXp,
    unitXp: report.unitXp,
    income: report.income,
  };
  if (next.life <= 0) {
    next.phase = "gameover";
    next.campaignOutcome = "defeat";
  } else if (next.round >= FINAL_ROUND) {
    next.phase = "gameover";
    next.campaignOutcome = report.outcome;
  } else {
    next.phase = "resolution";
  }
  return succeed(next, report.outcome === "victory" ? "Victory rewards claimed." : "Defeat resolved. Regroup for the next round.");
}

export function getItemComponentRewardForRound(round: number): ItemComponentId | null {
  if (round < 2 || round > FINAL_ROUND || round % 2 !== 0) return null;
  return ITEM_COMPONENT_IDS[(round / 2 - 1) % ITEM_COMPONENT_IDS.length];
}

export function advanceRound(state: GameState): GameActionResult {
  if (state.phase !== "resolution") return fail(state, "Finish the current round first.");
  const next = cloneState(state);
  next.round += 1;
  next.phase = "planning";
  next.combatReport = null;
  const componentReward = getItemComponentRewardForRound(next.round);
  if (componentReward) {
    next.componentInventory[componentReward] += 1;
    if (next.roundResult) {
      next.roundResult = { ...next.roundResult, itemComponentReward: componentReward };
    }
  } else {
    next.roundResult = null;
  }
  next.enemyUnits = generateEnemyMutable(next);
  if (!next.shopLocked) next.shop = rollShopMutable(next);
  const rewardMessage = componentReward
    ? ` ${ITEM_COMPONENTS[componentReward].name} added to your component inventory.`
    : "";
  return succeed(next, `Round ${next.round}.${rewardMessage} Scout the enemy and set your formation.`);
}

export function toggleShopLock(state: GameState): GameActionResult {
  if (state.phase !== "planning") return fail(state, "The market cannot be changed during combat.");
  const next = cloneState(state);
  next.shopLocked = !next.shopLocked;
  return succeed(next, next.shopLocked ? "Market locked for the next round." : "Market will refresh next round.");
}

export function restartGame(seed = 0xdecafbad): GameState {
  return createInitialGame(seed);
}

export function normalizeGameState(state: GameState): GameState {
  return cloneState(state);
}

export function validateState(state: GameState): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(state.gold) || state.gold < 0) problems.push("Gold must be finite and non-negative.");
  if (!Number.isFinite(state.life) || state.life < 0) problems.push("Commander life must be finite and non-negative.");
  const boardPositions = state.units.filter((unit) => unit.position !== null).map((unit) => unit.position as number);
  if (new Set(boardPositions).size !== boardPositions.length) problems.push("Allied board positions must be unique.");
  const benchPositions = state.units.filter((unit) => unit.benchIndex !== null).map((unit) => unit.benchIndex as number);
  if (new Set(benchPositions).size !== benchPositions.length) problems.push("Bench positions must be unique.");
  if (boardPositions.some((index) => !isPlayerBoardCell(index))) problems.push("Allies must remain in player territory.");
  if (state.units.some((unit) => unit.position === null && unit.benchIndex === null)) problems.push("Every allied unit must be deployed or benched.");
  if (state.units.some((unit) => unit.stars < 1 || unit.stars > MAX_STARS)) problems.push("Unit star rank is out of range.");
  if (state.units.some((unit) => unit.level < 1 || unit.level > MAX_UNIT_LEVEL)) problems.push("Unit level is out of range.");
  if (state.units.some((unit) => !Array.isArray(unit.itemSlots) || unit.itemSlots.length !== ITEM_SLOTS_PER_UNIT)) {
    problems.push(`Every allied unit must have exactly ${ITEM_SLOTS_PER_UNIT} item slots.`);
  }
  if (ITEM_COMPONENT_IDS.some((id) => {
    const count = state.componentInventory?.[id];
    return !Number.isInteger(count) || count < 0;
  })) {
    problems.push("Item component counts must be non-negative integers.");
  }
  const inventoryItems = state.craftedItemInventory ?? [];
  const equippedItems = state.units.flatMap((unit) =>
    Array.isArray(unit.itemSlots)
      ? unit.itemSlots.filter((item): item is CraftedItem => item !== null)
      : [],
  );
  const allItems = [...inventoryItems, ...equippedItems];
  if (new Set(allItems.map((item) => item.id)).size !== allItems.length) {
    problems.push("Crafted item instance IDs must be unique.");
  }
  if (allItems.some((item) => !ITEM_DEFINITIONS[item.itemId])) {
    problems.push("Every crafted item must reference a known definition.");
  }
  if (allItems.some((item) =>
    (item.tier === "full" && item.enhancement !== null) ||
    (item.tier === "enhanced" && !item.enhancement),
  )) {
    problems.push("Crafted item enhancement state is invalid.");
  }
  return problems;
}
