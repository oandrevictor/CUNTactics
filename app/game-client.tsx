"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
import { Boitata3DLayer } from "./boitata-3d-layer";
import { sampleLinearCombatClock } from "./combat-playback";
import { MeatGaga3DLayer } from "./meat-gaga-3d-layer";
import {
  GAME_LOCALES,
  LOCALE_COOKIE_KEY,
  LOCALE_STORAGE_KEY,
  formatAbilityScaling,
  formatList,
  formatNumber,
  isGameLocale,
  localizeAbilityText,
  localizeCombatEvent,
  localizeComponent,
  localizeHero,
  localizeItem,
  localizeOutcome,
  localizePhase,
  localizeRarity,
  localizeRole,
  localizeText,
  localizeTrait,
  type GameLocale,
} from "./i18n";
import {
  BENCH_SIZE,
  BOARD_COLUMNS,
  BOARD_ROWS,
  BOARD_SIZE,
  HEROES,
  ITEM_COMPONENTS,
  ITEM_COMPONENT_IDS,
  ITEM_DEFINITIONS,
  ITEM_SLOTS_PER_UNIT,
  MAX_COMMANDER_LEVEL,
  PLAYER_START_ROW,
  REFRESH_COST,
  ROLE_PROFILES,
  TRAITS,
  XP_BUY_AMOUNT,
  XP_BUY_COST,
  advanceRound,
  applyCombatResult,
  attackAnimationSeconds,
  buyPlayerXp,
  buyShopUnit,
  calculateMeatGagaStackConsumption,
  commanderXpToNext,
  craftItem,
  createInitialGame,
  enhanceEquippedItem,
  enhanceItem,
  equipItem,
  getActiveTraits,
  getAbilityPreview,
  getCopyCount,
  getCraftedItemBonuses,
  getCraftedItemDefinition,
  getCombatStatistics,
  getInterest,
  getMeatGagaPassivePreview,
  getStreakBonus,
  getUnitStats,
  moveUnit,
  movementTravelSeconds,
  normalizeGameState,
  refreshShop,
  resolveCombat,
  restartGame,
  sellUnit,
  toggleShopLock,
  unequipItem,
  unitCapForLevel,
  unitXpToNext,
  validateState,
  type CombatEvent,
  type CombatStatistics,
  type CombatUnit,
  type AbilityPreview,
  type AbilityValues,
  type CraftedItem,
  type GameActionResult,
  type GameState,
  type HeroId,
  type ItemComponentId,
  type TraitId,
  type UnitItemSlots,
  type UnitInstance,
} from "./game-engine";

const STORAGE_KEY = "hexfall-match-v1";
const TUTORIAL_KEY = "hexfall-tutorial-complete";
const DESKTOP_BOARD_HEIGHT_RATIO = 5.4 / 8;
const MOBILE_BOARD_HEIGHT_RATIO = 6.3 / 8;
const CRAFTED_ITEM_DRAG_TYPE = "application/x-hexfall-crafted-item";
const ITEM_COMPONENT_DRAG_TYPE = "application/x-hexfall-item-component";
const LEGACY_COMBAT_EVENT_SECONDS = 0.82;
const COMBAT_TIMESTAMP_EPSILON_SECONDS = 0.0005;
const MIN_COMBAT_MOMENT_SECONDS = 0.08;
const DEFAULT_COMBAT_BEAT_SECONDS = 0.68;
const COMBAT_CLOCK_RENDER_INTERVAL_MS = 50;

type LoadoutDrag =
  | { kind: "item"; id: string }
  | { kind: "component"; id: ItemComponentId };

type LoadoutDropStatus = "ready" | "blocked" | null;

type AbilityMetric = {
  id: string;
  label: string;
  kind: string;
  applies: (values: AbilityValues) => boolean;
  format: (values: AbilityValues) => string;
};

type DisplayUnit = {
  id: string;
  heroId: HeroId;
  side: "player" | "enemy";
  stars: number;
  level: number;
  xp: number;
  position: number | null;
  benchIndex: number | null;
  itemSlots: UnitItemSlots;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  attack: number;
  armor: number;
  range: number;
  attackSpeed: number;
  moveSpeed: number;
  manaRegen: number;
  meatStack: number;
  shield: number;
  fireWallShield: number;
  stunned: number;
  levitatingUntil: number;
  stunnedUntil: number;
  alive: boolean;
};

type CombatEffectKind = "attack" | "ability" | "heal" | "shield";

type CombatMoment = {
  key: string;
  timestamp: number;
  events: CombatEvent[];
  snapshotEvent: CombatEvent;
};

type CombatLinkCue = {
  key: string;
  kind: CombatEffectKind | "move";
  style: CSSProperties;
};

type SolStarfallCue = {
  event: CombatEvent;
  actor: CombatUnit;
  targets: CombatUnit[];
  style: CSSProperties;
};

type MeatProjectileCue = {
  event: CombatEvent;
  targetId: string;
  bonusDamage: number;
  style: CSSProperties;
};

type ElphabaAbilityPhase = "lift" | "landing";

type ElphabaGravityEvent = CombatEvent & {
  liftedTargetIds?: string[];
  liftDurationSeconds?: number;
  stunDurationSeconds?: number;
  currentHealthDamagePercent?: number;
  landingAt?: number;
};

type ElphabaGravityCue = {
  event: ElphabaGravityEvent;
  phase: ElphabaAbilityPhase;
  actor: CombatUnit;
  liftedTargets: CombatUnit[];
  impactedTargets: CombatUnit[];
};

type TimedCombatUnit = CombatUnit & {
  levitatingUntil?: number;
  stunnedUntil?: number;
};

function clampPercent(value: number, maximum: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.min(100, Math.max(0, (value / maximum) * 100));
}

function meterStyle(value: number, maximum: number): CSSProperties {
  return { "--meter-value": `${clampPercent(value, maximum)}%` } as CSSProperties;
}

function combatEventTimestamp(event: CombatEvent, index: number): number {
  const runtimeTimestamp = (event as Partial<CombatEvent>).timestamp;
  if (typeof runtimeTimestamp === "number" && Number.isFinite(runtimeTimestamp)) {
    return Math.max(0, runtimeTimestamp);
  }
  if (Number.isFinite(event.turn)) return Math.max(0, event.turn * LEGACY_COMBAT_EVENT_SECONDS);
  return Math.max(0, index * LEGACY_COMBAT_EVENT_SECONDS);
}

function groupCombatEventsByTimestamp(events: readonly CombatEvent[]): CombatMoment[] {
  const moments: CombatMoment[] = [];
  events.forEach((event, index) => {
    const timestamp = combatEventTimestamp(event, index);
    const current = moments.at(-1);
    if (current && Math.abs(current.timestamp - timestamp) <= COMBAT_TIMESTAMP_EPSILON_SECONDS) {
      current.events.push(event);
      current.snapshotEvent = event;
      return;
    }
    moments.push({
      key: `${timestamp.toFixed(3)}:${event.id}`,
      timestamp,
      events: [event],
      snapshotEvent: event,
    });
  });
  return moments;
}

function combatMomentInterval(currentTimestamp: number, nextTimestamp: number | undefined): number {
  if (nextTimestamp === undefined) return DEFAULT_COMBAT_BEAT_SECONDS;
  const interval = nextTimestamp - currentTimestamp;
  return Number.isFinite(interval) && interval > 0 ? interval : 0;
}

function formatCombatTime(seconds: number, locale: GameLocale): string {
  return `${formatNumber(locale, Math.max(0, seconds), 1)}s`;
}

function formatRate(value: number, locale: GameLocale): string {
  if (!Number.isFinite(value)) return "0";
  return formatNumber(locale, value, 2);
}

function formatAbilitySeconds(value: number, locale: GameLocale): string {
  return `${formatRate(value, locale)}s`;
}

function elphabaAbilityPhase(event: CombatEvent | null): ElphabaAbilityPhase | null {
  if (!event?.actorId || (event.type !== "ability" && event.type !== "landing")) return null;
  const actor = event.snapshot.find((unit) => unit.id === event.actorId);
  if (actor?.heroId !== "elphaba") return null;
  if (event.type === "landing") return "landing";
  return event.liftedTargetIds?.length ? "lift" : null;
}

function combatEffectKind(event: CombatEvent | null): CombatEffectKind | null {
  if (event?.type === "attack") return "attack";
  if (event?.type === "heal") return "heal";
  if (event?.type === "shield") return "shield";
  if (event?.type === "landing") return "ability";
  if (event?.type !== "ability") return null;
  if (elphabaAbilityPhase(event) === "lift") return null;
  const actor = event.actorId ? event.snapshot.find((unit) => unit.id === event.actorId) : null;
  if (actor?.heroId === "boitata") return "shield";
  return actor?.heroId === "tide" || actor?.heroId === "bramble" ? "heal" : "ability";
}

function isMeatGagaEnhancedAttack(event: CombatEvent | null): event is CombatEvent & { meatBonusDamage: number } {
  if (event?.type !== "attack" || !event.actorId || !event.meatBonusDamage || event.meatBonusDamage <= 0) return false;
  return event.snapshot.find((unit) => unit.id === event.actorId)?.heroId === "meat-gaga";
}

function combatLinkStyle(actorPosition: number, targetPosition: number, boardHeightRatio: number): CSSProperties {
  const boardRows = BOARD_SIZE / BOARD_COLUMNS;
  const startX = ((actorPosition % BOARD_COLUMNS) + 0.5) / BOARD_COLUMNS * 100;
  const startY = (Math.floor(actorPosition / BOARD_COLUMNS) + 0.5) / boardRows * 100;
  const endX = ((targetPosition % BOARD_COLUMNS) + 0.5) / BOARD_COLUMNS * 100;
  const endY = (Math.floor(targetPosition / BOARD_COLUMNS) + 0.5) / boardRows * 100;
  const deltaX = endX - startX;
  const deltaY = (endY - startY) * boardHeightRatio;
  const length = Math.hypot(deltaX, deltaY);
  const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;

  return {
    "--strike-left": `${startX}%`,
    "--strike-top": `${startY}%`,
    "--strike-length": `${length}%`,
    "--strike-angle": `${angle}deg`,
  } as CSSProperties;
}

function starfallImpactStyle(position: number, index: number, speed: number): CSSProperties {
  const rowCount = BOARD_SIZE / BOARD_COLUMNS;
  const column = position % BOARD_COLUMNS;
  const row = Math.floor(position / BOARD_COLUMNS);
  return {
    "--starfall-left": `${((column + 0.5) / BOARD_COLUMNS) * 100}%`,
    "--starfall-top": `${((row + 0.5) / rowCount) * 100}%`,
    "--starfall-delay": `${Math.round((index * 28) / speed)}ms`,
  } as CSSProperties;
}

function starfallClusterStyle(
  actorPosition: number,
  targetPositions: readonly number[],
  boardHeightRatio: number,
): CSSProperties {
  const rowCount = BOARD_SIZE / BOARD_COLUMNS;
  const startX = (((actorPosition % BOARD_COLUMNS) + 0.5) / BOARD_COLUMNS) * 100;
  const startY = ((Math.floor(actorPosition / BOARD_COLUMNS) + 0.5) / rowCount) * 100;
  const points = targetPositions.map((position) => ({
    x: (((position % BOARD_COLUMNS) + 0.5) / BOARD_COLUMNS) * 100,
    y: ((Math.floor(position / BOARD_COLUMNS) + 0.5) / rowCount) * 100,
  }));
  const endX = points.reduce((total, point) => total + point.x, 0) / points.length;
  const endY = points.reduce((total, point) => total + point.y, 0) / points.length;
  const deltaX = endX - startX;
  const deltaY = (endY - startY) * boardHeightRatio;
  return {
    "--starfall-caster-left": `${startX}%`,
    "--starfall-caster-top": `${startY}%`,
    "--starfall-center-left": `${endX}%`,
    "--starfall-center-top": `${endY}%`,
    "--starfall-trail-length": `${Math.hypot(deltaX, deltaY)}%`,
    "--starfall-trail-angle": `${Math.atan2(deltaY, deltaX) * 180 / Math.PI}deg`,
  } as CSSProperties;
}

function gravityPointStyle(position: number, index = 0, speed = 1): CSSProperties {
  const rowCount = BOARD_SIZE / BOARD_COLUMNS;
  const column = position % BOARD_COLUMNS;
  const row = Math.floor(position / BOARD_COLUMNS);
  return {
    "--gravity-left": `${((column + 0.5) / BOARD_COLUMNS) * 100}%`,
    "--gravity-top": `${((row + 0.5) / rowCount) * 100}%`,
    "--gravity-delay": `${Math.round((index * 34) / Math.max(0.25, speed))}ms`,
  } as CSSProperties;
}

function persistentDisplay(unit: UnitInstance): DisplayUnit {
  const stats = getUnitStats(unit);
  return {
    ...unit,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    mana: stats.startingMana,
    maxMana: stats.maxMana,
    attack: stats.attack,
    armor: stats.armor,
    range: stats.range,
    attackSpeed: stats.attackSpeed,
    moveSpeed: stats.moveSpeed,
    manaRegen: stats.manaRegen,
    meatStack: 0,
    shield: 0,
    fireWallShield: 0,
    stunned: 0,
    levitatingUntil: 0,
    stunnedUntil: 0,
    alive: true,
  };
}

function combatDisplay(unit: CombatUnit, persistent?: UnitInstance): DisplayUnit {
  const fallbackStats = getUnitStats(persistent ?? unit);
  const timedUnit = unit as TimedCombatUnit;
  return {
    ...unit,
    attackSpeed: Number.isFinite(unit.attackSpeed) ? unit.attackSpeed : fallbackStats.attackSpeed,
    moveSpeed: Number.isFinite(unit.moveSpeed) ? unit.moveSpeed : fallbackStats.moveSpeed,
    manaRegen: Number.isFinite(unit.manaRegen) ? unit.manaRegen : fallbackStats.manaRegen,
    meatStack: Number.isFinite(unit.meatStack) ? unit.meatStack : 0,
    levitatingUntil: Number.isFinite(timedUnit.levitatingUntil) ? timedUnit.levitatingUntil! : 0,
    stunnedUntil: Number.isFinite(timedUnit.stunnedUntil) ? timedUnit.stunnedUntil! : 0,
    xp: persistent?.xp ?? 0,
    benchIndex: null,
    itemSlots: persistent?.itemSlots ?? [null, null, null],
  };
}

function phaseLabel(phase: GameState["phase"], locale: GameLocale): string {
  return localizePhase(locale, phase);
}

function starsLabel(stars: number): string {
  return `${"★".repeat(stars)}${"☆".repeat(Math.max(0, 3 - stars))}`;
}

function craftedItemName(item: CraftedItem, locale: GameLocale): string {
  const name = localizeItem(locale, item.itemId).name;
  return item.tier === "enhanced" ? localizeText(locale, `Enhanced ${name}`) : name;
}

function craftedItemBonusText(item: CraftedItem, locale: GameLocale, heroId?: HeroId): string {
  const bonuses = getCraftedItemBonuses(item);
  const copy = [
    bonuses.maxHp ? `+${bonuses.maxHp} HP` : null,
    bonuses.attack ? `+${bonuses.attack} damage` : null,
    bonuses.armor ? `+${bonuses.armor} armor` : null,
    bonuses.startingMana
      ? heroId === "meat-gaga"
        ? "starting mana has no effect"
        : `+${bonuses.startingMana} starting mana`
      : null,
  ].filter((entry): entry is string => Boolean(entry));
  return copy.map((entry) => localizeText(locale, entry)).join(" · ");
}

const ITEM_SHORT_LABELS: Record<CraftedItem["itemId"], string> = {
  "inferno-fang": "FANG",
  cinderplate: "PLATE",
  "spirit-lantern": "LAMP",
  "blazing-aegis": "AEGIS",
  spellfang: "SPELL",
  "warding-flame": "WARD",
};

function craftedItemShortLabel(item: CraftedItem, locale: GameLocale): string {
  return localizeText(locale, ITEM_SHORT_LABELS[item.itemId]);
}

function equippedItemSummary(itemSlots: UnitItemSlots, locale: GameLocale): string {
  const names = itemSlots.flatMap((item) => item ? [craftedItemName(item, locale)] : []);
  return names.length ? localizeText(locale, `Equipped: ${names.join(", ")}`) : "";
}

function targetCountText(values: AbilityValues, locale: GameLocale): string {
  if (values.minTargets === values.maxTargets) return String(values.maxTargets);
  if (values.minTargets === 0) return localizeText(locale, `Up to ${values.maxTargets}`);
  return `${values.minTargets}–${values.maxTargets}`;
}

function abilityMetricDefinitions(preview: AbilityPreview, locale: GameLocale): AbilityMetric[] {
  const t = (text: string) => localizeText(locale, text);
  const damageLabel = t(preview.current.ignoresArmor ? "True damage" : "Raw damage");
  const targetLabel: Record<HeroId, string> = {
    bramble: "Allies healed",
    boitata: "Target",
    sol: "Enemies hit",
    nix: "Enemies hit",
    aster: "Enemies hit",
    morrow: "Enemies drained",
    tide: "Allies healed",
    vesper: "Enemies hit",
    piper: "Enemies hit",
    "meat-gaga": "Target",
    elphaba: "Enemies levitated",
  };
  return [
    {
      id: "damage",
      label: damageLabel,
      kind: preview.current.ignoresArmor ? "true-damage" : "raw-damage",
      applies: (values) => values.damage > 0,
      format: (values) => String(values.damage),
    },
    {
      id: "current-health-true-damage",
      label: t("Landing true damage"),
      kind: "true-damage",
      applies: (values) => values.currentHealthDamagePercent > 0,
      format: (values) => `${formatRate(values.currentHealthDamagePercent, locale)}% ${t("current Life")}`,
    },
    {
      id: "healing",
      label: t("Healing"),
      kind: "healing",
      applies: (values) => values.healing > 0,
      format: (values) => String(values.healing),
    },
    {
      id: "shield",
      label: t("Shield"),
      kind: "shield",
      applies: (values) => values.shield > 0,
      format: (values) => String(values.shield),
    },
    {
      id: "targets",
      label: t(targetLabel[preview.current.heroId]),
      kind: "targets",
      applies: (values) => values.maxTargets > 0,
      format: preview.current.heroId === "boitata" ? () => t("Self") : (values) => targetCountText(values, locale),
    },
    {
      id: "levitation",
      label: t("Levitation"),
      kind: "duration",
      applies: (values) => values.liftDurationSeconds > 0,
      format: (values) => formatAbilitySeconds(values.liftDurationSeconds, locale),
    },
    {
      id: "landing-stun",
      label: t("Landing stun"),
      kind: "stun",
      applies: (values) => values.stunDurationSeconds > 0,
      format: (values) => formatAbilitySeconds(values.stunDurationSeconds, locale),
    },
    {
      id: "projectiles",
      label: t("Projectiles"),
      kind: "projectiles",
      applies: (values) => values.projectiles > 0,
      format: (values) => String(values.projectiles),
    },
    {
      id: "mana-drain",
      label: t("Mana drain"),
      kind: "mana-drain",
      applies: (values) => values.manaDrain > 0,
      format: (values) => String(values.manaDrain),
    },
    {
      id: "stun",
      label: t("Stun"),
      kind: "stun",
      applies: (values) => values.stunTurns > 0,
      format: (values) => localizeText(locale, `${values.stunTurns} ${values.stunTurns === 1 ? "action" : "actions"}`),
    },
    {
      id: "self-heal",
      label: t("Self-heal"),
      kind: "self-heal",
      applies: (values) => values.selfHealPercent > 0,
      format: (values) => `${values.selfHealPercent}%`,
    },
    {
      id: "team-heal",
      label: t("Team heal"),
      kind: "team-heal",
      applies: (values) => values.teamHealing > 0,
      format: (values) => localizeText(locale, `${values.teamHealing} each`),
    },
  ];
}

function HeroArt({ heroId, className, children }: { heroId: HeroId; className: string; children?: ReactNode }) {
  const hero = HEROES[heroId];
  const style = hero.portrait ? { "--hero-art": `url("${hero.portrait}")` } as CSSProperties : undefined;
  return (
    <span className={`${className} hero-art-${heroId} ${hero.portrait ? "hero-art-image" : ""}`} style={style} aria-hidden="true">
      {hero.portrait ? null : hero.glyph}
      {children}
    </span>
  );
}

function UnitToken({
  unit,
  locale,
  selected,
  highlighted,
  currentEvents,
  previousSnapshotEvent,
  combatTime,
  boardHeightRatio,
  playbackSpeed,
  draggable,
  onDragStart,
  onDragEnd,
  loadoutDropStatus = null,
}: {
  unit: DisplayUnit;
  locale: GameLocale;
  selected: boolean;
  highlighted: boolean;
  currentEvents: readonly CombatEvent[];
  previousSnapshotEvent: CombatEvent | null;
  combatTime: number;
  boardHeightRatio: number;
  playbackSpeed: number;
  draggable: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
  loadoutDropStatus?: LoadoutDropStatus;
}) {
  const hero = HEROES[unit.heroId];
  const heroCopy = localizeHero(locale, unit.heroId);
  const t = (text: string) => localizeText(locale, text);
  const isCreatureToken = unit.heroId === "boitata";
  const isMeatGaga = unit.heroId === "meat-gaga";
  const gravityActorEvent = currentEvents.find((event) => (
    event.actorId === unit.id && elphabaAbilityPhase(event) !== null
  )) ?? null;
  const actorEvent = gravityActorEvent ?? currentEvents.find((event) =>
    event.actorId === unit.id
      && (event.type === "move" || event.type === "attack" || event.type === "ability" || event.type === "passive"),
  ) ?? currentEvents.find((event) => event.actorId === unit.id && combatEffectKind(event) !== null) ?? null;
  const actorGravityPhase = elphabaAbilityPhase(gravityActorEvent);
  const actorEffectKind = combatEffectKind(actorEvent);
  const isMeatAttack = isMeatGagaEnhancedAttack(actorEvent);
  const meatHarvestEvent = isMeatGaga
    ? currentEvents.find((event) => event.actorId === unit.id && event.type === "passive" && (event.meatStackGained ?? 0) > 0) ?? null
    : null;
  const isMeatHarvest = meatHarvestEvent !== null;
  const isActor = !!actorEvent;
  const previousUnit = previousSnapshotEvent?.snapshot.find((candidate) => candidate.id === unit.id) ?? null;
  const isMoveEvent = actorEvent?.type === "move";
  const didMove = isMoveEvent && previousUnit !== null && previousUnit.position !== unit.position;
  const movementStyle = didMove && previousUnit && previousUnit.position !== null && unit.position !== null
    ? {
        "--move-from-x": `${((previousUnit.position % BOARD_COLUMNS) - (unit.position % BOARD_COLUMNS)) * (100 / BOARD_COLUMNS)}cqw`,
        "--move-from-y": `${(Math.floor(previousUnit.position / BOARD_COLUMNS) - Math.floor(unit.position / BOARD_COLUMNS)) * (boardHeightRatio * 100 / BOARD_ROWS)}cqw`,
        "--move-duration": `${Math.round(movementTravelSeconds(unit.moveSpeed, previousUnit.position, unit.position) * 1000 / Math.max(0.01, playbackSpeed))}ms`,
      } as CSSProperties
    : undefined;
  const actionDurationSeconds = actorEvent?.type === "attack"
    ? attackAnimationSeconds(unit.attackSpeed)
    : actorEvent?.type === "ability" || actorGravityPhase
      ? hero.ability.castAnimationSeconds
      : 0;
  const actionStyle = actionDurationSeconds > 0
    ? {
        "--action-duration": `${Math.round(actionDurationSeconds * 1000 / Math.max(0.01, playbackSpeed))}ms`,
        "--combat-beat": `${Math.round(actionDurationSeconds * 1000 / Math.max(0.01, playbackSpeed))}ms`,
      } as CSSProperties
    : undefined;
  const tokenStyle = movementStyle || actionStyle
    ? { ...movementStyle, ...actionStyle } as CSSProperties
    : undefined;
  const isStunnedAction = isMoveEvent && actorEvent.text.includes("stunned");
  const gravityLiftEvent = currentEvents.find((event) => (
    elphabaAbilityPhase(event) === "lift"
      && (event as ElphabaGravityEvent).liftedTargetIds?.includes(unit.id)
  )) as ElphabaGravityEvent | undefined;
  const gravityLandingCenterEvent = currentEvents.find((event) => (
    elphabaAbilityPhase(event) === "landing"
      && (event as ElphabaGravityEvent).liftedTargetIds?.includes(unit.id)
  )) as ElphabaGravityEvent | undefined;
  const gravityImpactEvent = currentEvents.find((event) => (
    elphabaAbilityPhase(event) === "landing" && event.targetIds?.includes(unit.id)
  )) as ElphabaGravityEvent | undefined;
  const isLevitating = unit.alive && unit.levitatingUntil > combatTime + COMBAT_TIMESTAMP_EPSILON_SECONDS;
  const isTimedStunned = unit.alive && unit.stunnedUntil > combatTime + COMBAT_TIMESTAMP_EPSILON_SECONDS;
  const targetEffects = currentEvents.flatMap((event) => {
    const kind = combatEffectKind(event);
    return kind && event.targetIds?.includes(unit.id) ? [{ event, kind }] : [];
  });
  const isDamaged = targetEffects.some(({ kind }) => kind === "attack" || kind === "ability");
  const isMeatSplattered = targetEffects.some(({ event }) => isMeatGagaEnhancedAttack(event));
  const isHealed = targetEffects.some(({ kind }) => kind === "heal");
  const isShielded = targetEffects.some(({ kind }) => kind === "shield");
  const isGravityImpact = gravityImpactEvent !== undefined;
  const isSolStarfall = currentEvents.some((event) => {
    if (event.type !== "ability" || !event.targetIds?.includes(unit.id) || !event.actorId) return false;
    return event.snapshot.find((candidate) => candidate.id === event.actorId)?.heroId === "sol";
  });
  const actorIsSol = actorEvent?.type === "ability" && actorEvent.actorId
    ? actorEvent.snapshot.find((candidate) => candidate.id === actorEvent.actorId)?.heroId === "sol"
    : false;
  const shieldLost = Math.max(0, (previousUnit?.shield ?? 0) - unit.shield);
  const fireWallShieldLost = Math.max(0, (previousUnit?.fireWallShield ?? 0) - unit.fireWallShield);
  const fireWallBroke = !!previousUnit && previousUnit.fireWallShield > 0 && unit.fireWallShield === 0;
  const hasFireWall = unit.heroId === "boitata" && (unit.fireWallShield > 0 || fireWallBroke || isShielded);
  const feedback = targetEffects.flatMap(({ event, kind }) => {
    const targetAmount = event.amounts?.[unit.id]
      ?? (event.targetIds?.length === 1 ? event.amount : undefined);
    if (!targetAmount || targetAmount <= 0) return [];
    return [{
      key: `${event.id}:${unit.id}`,
      kind,
      text: kind === "shield"
        ? `+${targetAmount} ${t("SHIELD")}`
        : kind === "heal"
          ? `+${targetAmount}`
          : isMeatGagaEnhancedAttack(event)
            ? `−${targetAmount} · ${t("MEAT")} +${Math.round(event.meatBonusDamage)}`
            : `−${targetAmount}`,
      meat: isMeatGagaEnhancedAttack(event),
      starfall: event.type === "ability" && event.actorId
        ? event.snapshot.find((candidate) => candidate.id === event.actorId)?.heroId === "sol"
        : false,
      gravity: elphabaAbilityPhase(event) === "landing",
    }];
  });
  const blockFeedback = shieldLost > 0 ? `${t("BLOCK")} ${shieldLost}` : null;
  const actorLabel = isMoveEvent
    ? didMove
      ? t("MOVE")
      : isStunnedAction
        ? t("STUNNED")
        : t("HOLD")
    : actorGravityPhase === "lift"
      ? t("DEFY GRAVITY")
      : actorGravityPhase === "landing"
        ? t("GRAVITY")
        : actorIsSol
          ? t("STARFALL")
          : isMeatAttack
            ? t("MEAT THROW")
            : actorEvent?.type === "passive"
              ? `${t("HARVEST")} +${Math.round(meatHarvestEvent?.meatStackGained ?? 0)}`
              : actorEffectKind === "shield"
                ? t("WALL")
                : actorEvent?.type === "ability"
                  ? t("CAST")
                  : t("ATTACK");
  const equippedItemTitle = equippedItemSummary(unit.itemSlots, locale);

  return (
    <div
      className={`unit-token ${isCreatureToken ? "unit-token-creature unit-token-boitata" : ""} ${isMeatGaga ? "unit-token-meat-gaga" : ""} ${unit.side === "player" ? "unit-ally" : "unit-enemy"} ${selected ? "unit-selected" : ""} ${highlighted ? "unit-trait-highlight" : ""} ${!unit.alive ? "unit-dead" : ""} ${actorEffectKind ? `unit-event-actor unit-event-actor-${actorEffectKind}` : ""} ${isMoveEvent ? `unit-event-actor ${didMove ? "unit-event-move" : "unit-event-wait"}` : ""} ${actorGravityPhase ? "unit-event-actor unit-event-actor-elphaba" : ""} ${actorIsSol ? "unit-event-actor-sol" : ""} ${isMeatAttack ? "unit-event-actor-meat" : ""} ${isMeatHarvest ? "unit-event-actor unit-event-meat-harvest" : ""} ${isLevitating ? "unit-levitating" : ""} ${gravityLiftEvent ? "unit-gravity-lift-start" : ""} ${gravityLandingCenterEvent ? "unit-gravity-landing-center" : ""} ${isDamaged ? "unit-impact-damage" : ""} ${isDamaged && isSolStarfall ? "unit-impact-starfall" : ""} ${isGravityImpact ? "unit-impact-gravity" : ""} ${isMeatSplattered ? "unit-impact-meat" : ""} ${isHealed ? "unit-impact-heal" : ""} ${isShielded ? "unit-impact-shield" : ""} ${shieldLost > 0 ? "unit-shield-absorbed" : ""} ${loadoutDropStatus ? `unit-loadout-drop-${loadoutDropStatus}` : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-testid={`unit-${unit.id}`}
      data-unit-id={unit.id}
      data-hero-id={unit.heroId}
      data-levitating-until={unit.levitatingUntil || undefined}
      data-stunned-until={unit.stunnedUntil || undefined}
      title={equippedItemTitle || undefined}
      style={tokenStyle}
    >
      <span className="unit-stars" data-testid={`unit-stars-${unit.id}`} aria-label={localizeText(locale, `${unit.stars} star`)}>{starsLabel(unit.stars)}</span>
      {isLevitating || gravityLiftEvent || gravityLandingCenterEvent ? (
        <span
          className="gravity-lift-aura"
          data-testid={`elphaba-levitation-state-${unit.id}`}
          data-gravity-state={gravityLandingCenterEvent ? "landing" : isLevitating ? "levitating" : "lifting"}
          aria-hidden="true"
        ><i /><b /></span>
      ) : null}
      <HeroArt heroId={unit.heroId} className="unit-avatar" />
      {hasFireWall ? <span className={`fire-wall ${isShielded ? "fire-wall-cast" : ""} ${fireWallShieldLost > 0 ? "fire-wall-absorb" : ""} ${fireWallBroke ? "fire-wall-break" : ""}`} aria-hidden="true" /> : null}
      <span className="unit-level">{t("L")}{unit.level}</span>
      <span className="unit-item-pips" data-testid={`unit-item-slots-${unit.id}`} aria-hidden="true">
        {unit.itemSlots.map((item, index) => {
          const definition = item ? ITEM_DEFINITIONS[item.itemId] : null;
          return (
            <span
              className={`unit-item-pip ${item ? `unit-item-pip-${item.tier} unit-item-pip-${item.itemId}` : "unit-item-pip-empty"}`}
              data-testid={`unit-item-badge-${unit.id}-${index}`}
              data-item-id={item?.itemId ?? "empty"}
              key={index}
            >
              {item && definition ? (
                <>
                  <span className="unit-item-pip-glyph">{definition.recipe.map((componentId) => ITEM_COMPONENTS[componentId].glyph).join("")}</span>
                  <small>{craftedItemShortLabel(item, locale)}</small>
                  {item.enhancement ? <i className="unit-item-enhancement">{ITEM_COMPONENTS[item.enhancement].glyph}</i> : null}
                </>
              ) : null}
            </span>
          );
        })}
      </span>
      <span className="unit-name">{heroCopy.name}</span>
      {isMeatGaga ? (
        <span
          className={`unit-meat-stack ${unit.meatStack > 0 ? "unit-meat-stack-charged" : ""} ${isMeatHarvest ? "unit-meat-stack-gained" : ""}`}
          data-testid={`unit-meat-stack-${unit.id}`}
          aria-label={localizeText(locale, `${heroCopy.name} meat stack ${Math.round(unit.meatStack)}`)}
        >
          <small>{t("MEAT")}</small><strong>{Math.round(unit.meatStack)}</strong>
        </span>
      ) : null}
      {isActor ? <span className="combat-role" aria-hidden="true">{actorLabel}</span> : null}
      <span className="unit-bars">
        <span
          className="meter meter-life"
          style={meterStyle(unit.hp + unit.shield, unit.maxHp + Math.max(0, unit.shield))}
          data-testid={`unit-hp-${unit.id}`}
          aria-label={localizeText(locale, `${heroCopy.name} health ${Math.round(unit.hp)} of ${unit.maxHp}${unit.shield ? `, shield ${unit.shield}` : ""}`)}
        ><span className="meter-fill" /></span>
        {isMeatGaga ? (
          <span className="meter unit-passive-meter" aria-label={localizeText(locale, `${heroCopy.name} uses a passive and has no mana`)}><span>{t("PASSIVE · NO MANA")}</span></span>
        ) : (
          <span
            className="meter meter-mana"
            style={meterStyle(unit.mana, unit.maxMana)}
            data-testid={`unit-mana-${unit.id}`}
            aria-label={localizeText(locale, `${heroCopy.name} mana ${Math.round(unit.mana)} of ${unit.maxMana}`)}
          ><span className="meter-fill" /></span>
        )}
      </span>
      {isLevitating ? <span className="levitation-mark" aria-label={localizeText(locale, `Levitating until ${formatAbilitySeconds(unit.levitatingUntil, locale)}`)}>↑</span> : null}
      {unit.stunned > 0 || isTimedStunned ? (
        <span className="status-mark" aria-label={localizeText(locale, isTimedStunned ? `Stunned until ${formatAbilitySeconds(unit.stunnedUntil, locale)}` : "Stunned")}>×</span>
      ) : null}
      {feedback.map((entry, index) => (
        <span
          className={`floating-text ${entry.kind === "heal" ? "floating-heal" : entry.kind === "shield" ? "floating-shield" : "floating-damage"} ${entry.starfall ? "floating-starfall" : ""} ${entry.gravity ? "floating-gravity" : ""} ${entry.meat ? "floating-meat" : ""}`}
          key={entry.key}
          style={{ "--feedback-offset": `${index * 12}px` } as CSSProperties}
        >
          {entry.text}
        </span>
      ))}
      {meatHarvestEvent ? <span className="floating-text floating-meat-gain">+{Math.round(meatHarvestEvent.meatStackGained ?? 0)} {t("MEAT")}</span> : null}
      {blockFeedback ? <span className="floating-text floating-block">{blockFeedback}</span> : null}
    </div>
  );
}

function CombatTeamReport({
  side,
  statistics,
  locale,
}: {
  side: "player" | "enemy";
  statistics: CombatStatistics;
  locale: GameLocale;
}) {
  const t = (text: string) => localizeText(locale, text);
  const label = t(side === "player" ? "Your team" : "Mooncrest");
  const totals = statistics.teams[side];
  const units = statistics.units.filter((unit) => unit.side === side);

  return (
    <section
      className={`combat-team-card combat-team-${side}`}
      data-testid={`combat-team-${side}`}
      aria-labelledby={`combat-team-${side}-title`}
    >
      <div className="combat-team-heading">
        <h4 id={`combat-team-${side}-title`}>{label}</h4>
        <span>{localizeText(locale, `${units.length} ${units.length === 1 ? "champion" : "champions"}`)}</span>
      </div>
      <dl className="combat-team-totals">
        <div className="combat-total combat-total-damage">
          <dt>{t("Damage dealt")}</dt>
          <dd data-testid={`combat-total-${side}-damage`}>{totals.damageDealt}</dd>
        </div>
        <div className="combat-total combat-total-shield">
          <dt>{t("Shield granted")}</dt>
          <dd data-testid={`combat-total-${side}-shield`}>{totals.shieldGranted}</dd>
        </div>
        <div className="combat-total combat-total-healing">
          <dt>{t("Effective healing")}</dt>
          <dd data-testid={`combat-total-${side}-healing`}>{totals.healingDone}</dd>
        </div>
      </dl>
      <div className="combat-stat-scroll">
        <table className="combat-stat-table">
          <caption className="sr-only">{label} {t("character combat contributions")}</caption>
          <thead>
            <tr><th scope="col">{t("Character")}</th><th scope="col">{t("Damage")}</th><th scope="col">{t("Shield")}</th><th scope="col">{t("Healing")}</th></tr>
          </thead>
          <tbody>
            {units.map((unit) => (
              <tr key={unit.unitId} data-testid={`combat-stat-${unit.unitId}`}>
                <th scope="row">
                  <span className="combat-stat-unit">
                    <HeroArt heroId={unit.heroId} className="combat-stat-portrait" />
                    <span className="combat-stat-copy"><strong>{localizeHero(locale, unit.heroId).name}</strong><small>{t("L")}{unit.level} · {starsLabel(unit.stars)}</small></span>
                  </span>
                </th>
                <td className="combat-stat-value combat-stat-damage">{unit.damageDealt}</td>
                <td className="combat-stat-value combat-stat-shield">{unit.shieldGranted}</td>
                <td className="combat-stat-value combat-stat-healing">{unit.healingDone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CombatBreakdown({ statistics, locale }: { statistics: CombatStatistics; locale: GameLocale }) {
  const t = (text: string) => localizeText(locale, text);
  return (
    <section className="combat-breakdown" data-testid="combat-breakdown" aria-labelledby="combat-breakdown-title">
      <div className="combat-breakdown-heading">
        <div><span className="eyebrow">{t("Match report")}</span><h3 id="combat-breakdown-title">{t("Combat breakdown")}</h3></div>
        <p>{t("Damage includes health and shields removed. Shield measures protection granted. Healing counts life actually restored.")}</p>
      </div>
      <div className="combat-team-grid">
        <CombatTeamReport side="player" statistics={statistics} locale={locale} />
        <CombatTeamReport side="enemy" statistics={statistics} locale={locale} />
      </div>
    </section>
  );
}

export function GameClient({ initialLocale = "en" }: { initialLocale?: GameLocale }) {
  const [game, setGame] = useState<GameState>(() => createInitialGame());
  const [locale, setLocale] = useState<GameLocale>(initialLocale);
  const [hydrated, setHydrated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedTrait, setHighlightedTrait] = useState<TraitId | null>(null);
  const [toast, setToast] = useState("Welcome to HEXFALL. Set your formation, then begin battle.");
  const [combatMomentIndex, setCombatMomentIndex] = useState(0);
  const [combatClockSeconds, setCombatClockSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [steppedMomentKey, setSteppedMomentKey] = useState<string | null>(null);
  const [boardHeightRatio, setBoardHeightRatio] = useState(DESKTOP_BOARD_HEIGHT_RATIO);
  const [boitata3DReady, setBoitata3DReady] = useState(false);
  const [meatGaga3DReady, setMeatGaga3DReady] = useState(false);
  const [tutorialStage, setTutorialStage] = useState(0);
  const [tutorialVisible, setTutorialVisible] = useState(true);
  const [forgeOpen, setForgeOpen] = useState(false);
  const [forgeComponents, setForgeComponents] = useState<ItemComponentId[]>([]);
  const [selectedCraftedItemId, setSelectedCraftedItemId] = useState<string | null>(null);
  const [draggedLoadout, setDraggedLoadout] = useState<LoadoutDrag | null>(null);
  const [draggedUnitId, setDraggedUnitId] = useState<string | null>(null);
  const playbackMomentKeyRef = useRef<string | null>(null);
  const playbackRemainingSecondsRef = useRef<number | null>(null);
  const forgeToggleRef = useRef<HTMLButtonElement>(null);
  const forgeDrawerRef = useRef<HTMLElement>(null);
  const t = (text: string) => localizeText(locale, text);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const savedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
        if (isGameLocale(savedLocale)) setLocale(savedLocale);
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as GameState;
          const normalized = normalizeGameState(parsed);
          if (normalized.version === 1 && validateState(normalized).length === 0) setGame(normalized);
        }
        setTutorialVisible(window.localStorage.getItem(TUTORIAL_KEY) !== "1");
      } catch {
        setToast("A fresh campaign was started because the saved match could not be restored.");
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  }, [game, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.cookie = `${LOCALE_COOKIE_KEY}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = locale;
    document.title = localizeText(locale, "HEXFALL — Turn-based tactical board battler");
  }, [hydrated, locale]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!forgeOpen) return;
    const frame = window.requestAnimationFrame(() => forgeDrawerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [forgeOpen]);

  useEffect(() => {
    const mobileBoard = window.matchMedia("(max-width: 600px)");
    const syncBoardRatio = () => setBoardHeightRatio(mobileBoard.matches ? MOBILE_BOARD_HEIGHT_RATIO : DESKTOP_BOARD_HEIGHT_RATIO);
    syncBoardRatio();
    mobileBoard.addEventListener("change", syncBoardRatio);
    return () => mobileBoard.removeEventListener("change", syncBoardRatio);
  }, []);

  const combatEvents = useMemo(() => game.combatReport?.events ?? [], [game.combatReport]);
  const combatMoments = useMemo(
    () => groupCombatEventsByTimestamp(combatEvents),
    [combatEvents],
  );
  const currentMoment = game.phase === "combat"
    ? combatMoments[Math.min(combatMomentIndex, Math.max(0, combatMoments.length - 1))] ?? null
    : null;
  const previousMoment = game.phase === "combat" && combatMomentIndex > 0
    ? combatMoments[combatMomentIndex - 1] ?? null
    : null;
  const currentEvents = currentMoment?.events ?? [];
  const currentSnapshotEvent = currentMoment?.snapshotEvent ?? null;
  const previousSnapshotEvent = previousMoment?.snapshotEvent ?? null;
  const movementBeatMilliseconds = currentEvents.reduce((longestDuration, event) => {
    if (event.type !== "move" || !event.actorId || !currentSnapshotEvent || !previousSnapshotEvent) return longestDuration;
    const before = previousSnapshotEvent.snapshot.find((unit) => unit.id === event.actorId);
    const after = currentSnapshotEvent.snapshot.find((unit) => unit.id === event.actorId);
    if (!before || !after) return longestDuration;
    return Math.max(
      longestDuration,
      Math.round(movementTravelSeconds(after.moveSpeed, before.position, after.position) * 1000),
    );
  }, 0);
  const actionBeatMilliseconds = currentEvents.reduce((longestDuration, event) => {
    if (!event.actorId || !currentSnapshotEvent) return longestDuration;
    const actor = currentSnapshotEvent.snapshot.find((unit) => unit.id === event.actorId);
    if (!actor) return longestDuration;
    const durationSeconds = event.type === "attack"
      ? attackAnimationSeconds(actor.attackSpeed)
      : event.type === "ability" || event.type === "landing"
        ? HEROES[actor.heroId].ability.castAnimationSeconds
        : 0;
    return Math.max(longestDuration, Math.round(durationSeconds * 1000));
  }, 0);
  const desiredCombatBeatMilliseconds = Math.max(
    actionBeatMilliseconds,
    movementBeatMilliseconds,
    Math.round(MIN_COMBAT_MOMENT_SECONDS * 1000),
  );
  const atCombatEnd = game.phase === "combat"
    && (combatMoments.length === 0 || combatMomentIndex >= combatMoments.length - 1);
  const currentMomentTimestamp = currentMoment?.timestamp ?? 0;
  const totalCombatTime = combatMoments.at(-1)?.timestamp ?? 0;
  const nextMomentTimestamp = combatMoments[combatMomentIndex + 1]?.timestamp;
  const currentCombatTime = game.phase === "combat"
    ? Math.min(totalCombatTime, Math.max(currentMomentTimestamp, combatClockSeconds))
    : 0;
  const currentMomentInterval = combatMomentInterval(
    currentMomentTimestamp,
    nextMomentTimestamp,
  );
  const currentMomentPlaybackInterval = Math.max(
    currentMomentInterval,
    desiredCombatBeatMilliseconds / 1000,
  );
  const combatLogStart = Math.max(0, combatMomentIndex - 5);
  const visibleCombatMoments = combatMoments.slice(combatLogStart, combatMomentIndex + 1);
  const isSteppedMoment = !playing && steppedMomentKey !== null && currentMoment?.key === steppedMomentKey;
  const currentMomentActionCount = currentEvents.filter((event) =>
    event.type === "move"
      || event.type === "attack"
      || event.type === "ability"
      || event.type === "landing",
  ).length;

  useEffect(() => {
    if (game.phase !== "combat" || !currentMoment) {
      playbackMomentKeyRef.current = null;
      playbackRemainingSecondsRef.current = null;
      return;
    }

    if (atCombatEnd) {
      playbackMomentKeyRef.current = null;
      playbackRemainingSecondsRef.current = null;
      return;
    }

    if (playbackMomentKeyRef.current !== currentMoment.key) {
      playbackMomentKeyRef.current = currentMoment.key;
      playbackRemainingSecondsRef.current = currentMomentPlaybackInterval;
    }
    if (!playing) return;

    const remainingSeconds = playbackRemainingSecondsRef.current ?? currentMomentPlaybackInterval;
    const startedAt = performance.now();
    let lastClockRenderAt = startedAt - COMBAT_CLOCK_RENDER_INTERVAL_MS;
    let animationFrame = 0;
    const sampleClock = (now: number) => sampleLinearCombatClock({
      startTime: currentMoment.timestamp,
      endTime: nextMomentTimestamp ?? currentMoment.timestamp,
      segmentDuration: currentMomentPlaybackInterval,
      remainingDuration: remainingSeconds,
      elapsedWallTime: (now - startedAt) / 1000,
      speed,
    });
    const updateClock = (now: number) => {
      const sample = sampleClock(now);
      if (now - lastClockRenderAt >= COMBAT_CLOCK_RENDER_INTERVAL_MS || sample.remainingDuration === 0) {
        lastClockRenderAt = now;
        setCombatClockSeconds(sample.time);
      }
      if (sample.remainingDuration > 0) {
        animationFrame = window.requestAnimationFrame(updateClock);
      }
    };
    animationFrame = window.requestAnimationFrame(updateClock);
    const timeout = window.setTimeout(() => {
      const nextIndex = Math.min(combatMomentIndex + 1, combatMoments.length - 1);
      playbackMomentKeyRef.current = null;
      playbackRemainingSecondsRef.current = null;
      setSteppedMomentKey(null);
      setCombatClockSeconds(combatMoments[nextIndex]?.timestamp ?? currentMoment.timestamp);
      setCombatMomentIndex(nextIndex);
    }, Math.max(1, Math.round((remainingSeconds * 1000) / speed)));

    return () => {
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(animationFrame);
      if (playbackMomentKeyRef.current !== currentMoment.key) return;
      const sample = sampleClock(performance.now());
      playbackRemainingSecondsRef.current = sample.remainingDuration;
      setCombatClockSeconds(sample.time);
    };
  }, [game.phase, playing, atCombatEnd, currentMoment, currentMomentPlaybackInterval, nextMomentTimestamp, combatMomentIndex, combatMoments, speed]);

  useEffect(() => {
    const handleKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isFormControl = target?.matches("input, select, textarea, button");
      if (event.key === "Escape") {
        setSelectedId(null);
        setHighlightedTrait(null);
        if (forgeOpen) {
          setForgeOpen(false);
          window.requestAnimationFrame(() => forgeToggleRef.current?.focus());
        }
      }
      if (game.phase === "combat" && !atCombatEnd && !isFormControl && event.code === "Space") {
        event.preventDefault();
        setSteppedMomentKey(null);
        setPlaying((value) => !value);
      }
      if (game.phase === "combat" && !atCombatEnd && !isFormControl && event.key === "ArrowRight") {
        event.preventDefault();
        const nextIndex = Math.min(combatMomentIndex + 1, combatMoments.length - 1);
        playbackMomentKeyRef.current = null;
        playbackRemainingSecondsRef.current = null;
        setPlaying(false);
        setSteppedMomentKey(combatMoments[nextIndex]?.key ?? null);
        setCombatClockSeconds(combatMoments[nextIndex]?.timestamp ?? currentCombatTime);
        setCombatMomentIndex(nextIndex);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [game.phase, atCombatEnd, combatMomentIndex, combatMoments, currentCombatTime, forgeOpen]);

  const displayUnits = useMemo<DisplayUnit[]>(() => {
    if (game.phase === "combat" && currentSnapshotEvent) {
      const persistent = new Map([...game.units, ...game.enemyUnits].map((unit) => [unit.id, unit]));
      return currentSnapshotEvent.snapshot.map((unit) => combatDisplay(unit, persistent.get(unit.id)));
    }
    return [...game.units, ...game.enemyUnits].map(persistentDisplay);
  }, [game.phase, game.units, game.enemyUnits, currentSnapshotEvent]);

  const boardUnits = displayUnits.filter((unit) => unit.position !== null);
  const boitataBoardUnits = boardUnits.filter((unit) => unit.heroId === "boitata");
  const meatGagaBoardUnits = boardUnits.filter((unit) => unit.heroId === "meat-gaga");
  const benchUnits = game.units.filter((unit) => unit.benchIndex !== null);
  const selectedDisplay = selectedId ? displayUnits.find((unit) => unit.id === selectedId) ?? null : null;
  const selectedPersistent = selectedId ? game.units.find((unit) => unit.id === selectedId) ?? game.enemyUnits.find((unit) => unit.id === selectedId) ?? null : null;
  const selectedAllyForItems = selectedPersistent?.side === "player" ? selectedPersistent : null;
  const selectedCraftedItem = selectedCraftedItemId
    ? game.craftedItemInventory.find((item) => item.id === selectedCraftedItemId) ?? null
    : null;
  const forgeRecipe = forgeComponents.length === 2
    ? getCraftedItemDefinition(forgeComponents[0], forgeComponents[1])
    : null;
  const componentCount = ITEM_COMPONENT_IDS.reduce((total, id) => total + game.componentInventory[id], 0);
  const selectedHero = selectedDisplay ? HEROES[selectedDisplay.heroId] : null;
  const selectedHeroCopy = selectedDisplay ? localizeHero(locale, selectedDisplay.heroId) : null;
  const selectedRole = selectedHero ? ROLE_PROFILES[selectedHero.role] : null;
  const selectedRoleCopy = selectedHero ? localizeRole(locale, selectedHero.role) : null;
  const selectedTeamUnits = selectedPersistent
    ? selectedPersistent.side === "player" ? game.units : game.enemyUnits
    : [];
  const abilityPreview = selectedPersistent
    ? getAbilityPreview(selectedPersistent, selectedTeamUnits)
    : null;
  const meatGagaPassivePreview = selectedDisplay?.heroId === "meat-gaga"
    ? getMeatGagaPassivePreview(selectedDisplay.stars)
    : null;
  const meatGagaNextBonus = selectedDisplay?.heroId === "meat-gaga"
    ? calculateMeatGagaStackConsumption(selectedDisplay.meatStack, selectedDisplay.stars)
    : 0;
  const selectedAbilityMetrics = abilityPreview
    ? abilityMetricDefinitions(abilityPreview, locale)
    : [];
  const currentAbilityMetrics = abilityPreview
    ? selectedAbilityMetrics.filter((metric) => metric.applies(abilityPreview.current))
    : [];
  const scalingAbilityMetrics = abilityPreview
    ? selectedAbilityMetrics.filter((metric) => abilityPreview.byStar.some(metric.applies))
    : [];
  const traits = getActiveTraits(game.units);
  const deployedCount = game.units.filter((unit) => unit.position !== null).length;
  const commanderXpMaximum = commanderXpToNext(game.commanderLevel);
  const commanderCap = unitCapForLevel(game.commanderLevel);
  const interest = getInterest(game.gold);
  const projectedStreak = getStreakBonus(game.streak === 0 ? 1 : game.streak + Math.sign(game.streak));
  const projectedIncome = 5 + interest + projectedStreak;
  const solStarfalls = currentEvents.flatMap<SolStarfallCue>((event) => {
    if (event.type !== "ability" || !event.actorId || !event.targetIds?.length) return [];
    const actor = event.snapshot.find((unit) => unit.id === event.actorId);
    if (actor?.heroId !== "sol") return [];
    const targets = event.targetIds.flatMap((targetId) => {
      const target = event.snapshot.find((unit) => unit.id === targetId);
      return target ? [target] : [];
    });
    if (!targets.length) return [];
    return [{
      event,
      actor,
      targets,
      style: starfallClusterStyle(
        actor.position,
        targets.map((target) => target.position),
        boardHeightRatio,
      ),
    }];
  });
  const elphabaGravityCues = currentEvents.flatMap<ElphabaGravityCue>((event) => {
    const phase = elphabaAbilityPhase(event);
    if (!phase || !event.actorId) return [];
    const gravityEvent = event as ElphabaGravityEvent;
    const actor = event.snapshot.find((unit) => unit.id === event.actorId);
    if (!actor) return [];
    const liftedTargets = (gravityEvent.liftedTargetIds ?? []).flatMap((targetId) => {
      const target = event.snapshot.find((unit) => unit.id === targetId);
      return target ? [target] : [];
    });
    const impactedTargets = phase === "landing"
      ? (event.targetIds ?? []).flatMap((targetId) => {
          const target = event.snapshot.find((unit) => unit.id === targetId);
          return target ? [target] : [];
        })
      : [];
    return [{ event: gravityEvent, phase, actor, liftedTargets, impactedTargets }];
  });
  const meatProjectiles = currentEvents.flatMap<MeatProjectileCue>((event) => {
    if (!isMeatGagaEnhancedAttack(event) || !event.actorId || !event.targetIds?.length) return [];
    const actor = event.snapshot.find((unit) => unit.id === event.actorId);
    if (!actor) return [];
    return event.targetIds.flatMap((targetId) => {
      const target = event.snapshot.find((unit) => unit.id === targetId);
      if (!target || target.position === actor.position) return [];
      return [{
        event,
        targetId,
        bonusDamage: event.meatBonusDamage,
        style: combatLinkStyle(actor.position, target.position, boardHeightRatio),
      }];
    });
  });
  const actionLinks = currentEvents.flatMap<CombatLinkCue>((event) => {
    const kind = combatEffectKind(event);
    if (!kind || !event.actorId || !event.targetIds?.length) return [];
    if (isMeatGagaEnhancedAttack(event)) return [];
    if (elphabaAbilityPhase(event)) return [];
    const actor = event.snapshot.find((unit) => unit.id === event.actorId);
    if (!actor || (event.type === "ability" && actor.heroId === "sol")) return [];
    return event.targetIds.flatMap((targetId) => {
      const target = event.snapshot.find((unit) => unit.id === targetId);
      if (!target || target.position === actor.position) return [];
      return [{
        key: `${event.id}:${targetId}`,
        kind,
        style: combatLinkStyle(actor.position, target.position, boardHeightRatio),
      }];
    });
  });
  const movementLinks = currentEvents.flatMap<CombatLinkCue>((event) => {
    if (event.type !== "move" || !event.actorId || !currentSnapshotEvent || !previousSnapshotEvent) return [];
    const before = previousSnapshotEvent.snapshot.find((unit) => unit.id === event.actorId);
    const after = currentSnapshotEvent.snapshot.find((unit) => unit.id === event.actorId);
    if (!before || !after || before.position === after.position) return [];
    return [{
      key: `${event.id}:move`,
      kind: "move",
      style: combatLinkStyle(before.position, after.position, boardHeightRatio),
    }];
  });
  const combatLinks = [...actionLinks, ...movementLinks];
  const combatBeatMilliseconds = Math.max(
    Math.round(MIN_COMBAT_MOMENT_SECONDS * 1000),
    desiredCombatBeatMilliseconds,
  );
  const renderedCombatBeatMilliseconds = Math.round(combatBeatMilliseconds / speed);
  const combatBeatStyle = {
    "--combat-beat": `${renderedCombatBeatMilliseconds}ms`,
    "--combat-preview-delay": isSteppedMoment ? `-${Math.round(renderedCombatBeatMilliseconds * 0.46)}ms` : "0ms",
  } as CSSProperties;
  const combatStatistics = useMemo(
    () => game.combatReport ? getCombatStatistics(game.combatReport) : null,
    [game.combatReport],
  );

  function commit(result: GameActionResult, onSuccess?: () => void) {
    setToast(result.message);
    if (!result.ok) return;
    setGame(result.state);
    onSuccess?.();
  }

  function handleSelectComponent(componentId: ItemComponentId) {
    if (game.phase !== "planning") {
      setToast("The forge opens during planning.");
      return;
    }
    const alreadySelected = forgeComponents.filter((id) => id === componentId).length;
    if (alreadySelected >= game.componentInventory[componentId]) {
      setToast(`No more ${ITEM_COMPONENTS[componentId].name} components are available.`);
      return;
    }
    if (forgeComponents.length >= 2) {
      setToast("The forge tray holds two components. Remove one to change the recipe.");
      return;
    }
    setForgeComponents((components) => [...components, componentId]);
  }

  function handleCraftItem() {
    if (forgeComponents.length !== 2) {
      setToast("Choose two components to craft a full item.");
      return;
    }
    commit(craftItem(game, forgeComponents[0], forgeComponents[1]), () => {
      setForgeComponents([]);
      setSelectedCraftedItemId(null);
    });
  }

  function handleEnhanceItem() {
    if (!selectedCraftedItem || forgeComponents.length !== 1) {
      setToast("Select one full item and one component to enhance it.");
      return;
    }
    commit(enhanceItem(game, selectedCraftedItem.id, forgeComponents[0]), () => {
      setForgeComponents([]);
      setSelectedCraftedItemId(null);
    });
  }

  function handleEquipItem(slotIndex?: number) {
    if (!selectedAllyForItems || !selectedCraftedItem) {
      setToast("Select one of your champions and an item from the forge.");
      return;
    }
    commit(equipItem(game, selectedAllyForItems.id, selectedCraftedItem.id, slotIndex), () => {
      setSelectedCraftedItemId(null);
    });
  }

  function handleUnequipItem(slotIndex: number) {
    if (!selectedAllyForItems) return;
    commit(unequipItem(game, selectedAllyForItems.id, slotIndex));
  }

  function handleEnhanceEquippedGear(unitId: string, componentId: ItemComponentId) {
    commit(enhanceEquippedItem(game, unitId, componentId), () => {
      setForgeComponents((components) => {
        const selectedIndex = components.indexOf(componentId);
        return selectedIndex < 0
          ? components
          : components.filter((_, index) => index !== selectedIndex);
      });
    });
  }

  function loadoutDropStatusFor(unit: DisplayUnit): LoadoutDropStatus {
    if (!draggedLoadout || game.phase !== "planning" || unit.side !== "player") return null;
    const persistent = game.units.find((candidate) => candidate.id === unit.id);
    if (!persistent) return "blocked";
    if (draggedLoadout.kind === "item") {
      return persistent.itemSlots.some((item) => item === null) ? "ready" : "blocked";
    }
    return persistent.itemSlots.some((item) => item?.tier === "full") ? "ready" : "blocked";
  }

  function handleChampionLoadoutDrop(event: DragEvent<HTMLElement>, unitId: string): boolean {
    const craftedItemId = event.dataTransfer.getData(CRAFTED_ITEM_DRAG_TYPE);
    const rawComponentId = event.dataTransfer.getData(ITEM_COMPONENT_DRAG_TYPE);
    if (!craftedItemId && !rawComponentId) return false;

    event.preventDefault();
    event.stopPropagation();
    setDraggedLoadout(null);
    setSelectedId(unitId);

    if (craftedItemId) {
      commit(equipItem(game, unitId, craftedItemId), () => {
        setSelectedCraftedItemId((selected) => selected === craftedItemId ? null : selected);
      });
      return true;
    }

    const componentId = rawComponentId as ItemComponentId;
    if (!ITEM_COMPONENT_IDS.includes(componentId)) return false;
    handleEnhanceEquippedGear(unitId, componentId);
    return true;
  }

  function handleBuy(offerId: string) {
    commit(buyShopUnit(game, offerId), () => {
      if (tutorialVisible && tutorialStage === 0) setTutorialStage(1);
    });
  }

  function handleMove(unitId: string, kind: "board" | "bench", index: number) {
    setDraggedUnitId(null);
    const result = moveUnit(game, unitId, { kind, index });
    commit(result, () => {
      if (kind === "bench" && game.units.find((unit) => unit.id === unitId)?.heroId === "boitata") {
        setBoitata3DReady(false);
      }
      setSelectedId(unitId);
      if (tutorialVisible && tutorialStage === 1) setTutorialStage(2);
    });
  }

  function handleBoardCell(index: number) {
    const occupant = boardUnits.find((unit) => unit.position === index) ?? null;
    if (occupant) setSelectedId(occupant.id);
  }

  function handleBenchSlot(index: number) {
    const occupant = benchUnits.find((unit) => unit.benchIndex === index) ?? null;
    if (occupant) setSelectedId(occupant.id);
  }

  function handleBeginCombat() {
    const result = resolveCombat(game);
    commit(result, () => {
      playbackMomentKeyRef.current = null;
      playbackRemainingSecondsRef.current = null;
      setCombatMomentIndex(0);
      setCombatClockSeconds(0);
      setSteppedMomentKey(null);
      setPlaying(true);
      setForgeOpen(false);
      setSelectedId(null);
      if (tutorialVisible) finishTutorial();
    });
  }

  function finishTutorial() {
    setTutorialVisible(false);
    window.localStorage.setItem(TUTORIAL_KEY, "1");
  }

  function handleRestart() {
    const fresh = restartGame((Date.now() ^ 0xdecafbad) >>> 0);
    setGame(fresh);
    setSelectedId(null);
    setSelectedCraftedItemId(null);
    setForgeComponents([]);
    setForgeOpen(false);
    setBoitata3DReady(false);
    playbackMomentKeyRef.current = null;
    playbackRemainingSecondsRef.current = null;
    setCombatMomentIndex(0);
    setCombatClockSeconds(0);
    setSteppedMomentKey(null);
    setPlaying(false);
    setToast("A new campaign begins.");
  }

  const selectedUnitXpMax = selectedPersistent ? unitXpToNext(selectedPersistent.level) : 0;
  const selectedCopies = selectedPersistent ? getCopyCount(game, selectedPersistent.heroId, selectedPersistent.stars) : 0;

  return (
    <main className="game-shell" data-testid="game-screen" data-locale={locale} lang={locale}>
      <header className="game-topbar">
        <div className="brand-lockup">
          <span className="brand-name">HEXFALL</span>
          <span className="brand-kicker">{t("Build your bond. Break their line.")}</span>
        </div>
        <div className="stage-block">
          <span className="stage-label">{phaseLabel(game.phase, locale)}</span>
          <strong className="stage-value" data-testid="round-label">{t("Round")} {game.round}</strong>
        </div>
        <div className="player-hud">
          <div className="hud-stat">
            <span className="hud-icon" aria-hidden="true">♥</span>
            <span className="hud-copy"><strong className="hud-value" data-testid="player-life">{game.life}</strong><span className="hud-label">{t("Commander life")}</span></span>
          </div>
          <div className="hud-stat">
            <span className="hud-icon" aria-hidden="true">III</span>
            <span className="hud-copy">
              <strong className="hud-value" data-testid="player-level">{t("Level")} {game.commanderLevel}</strong>
              <span className="hud-label" data-testid="player-xp">XP {game.commanderXp}/{commanderXpMaximum || t("MAX")}</span>
              <span className="mini-meter" style={meterStyle(game.commanderXp, commanderXpMaximum)}><span className="mini-meter-fill" /></span>
            </span>
          </div>
          <div className="hud-stat">
            <span className="hud-icon" aria-hidden="true">●</span>
            <span className="hud-copy"><strong className="hud-value" data-testid="player-gold">{game.gold} {t("gold")}</strong><span className="hud-label">+{interest} {t("interest")}</span></span>
          </div>
          <label className="language-control" htmlFor="game-language">
            <span>{t("Language")}</span>
            <select
              id="game-language"
              data-testid="language-selector"
              value={locale}
              aria-label={t("Game language")}
              onChange={(event) => {
                const nextLocale = event.target.value;
                if (isGameLocale(nextLocale)) setLocale(nextLocale);
              }}
            >
              {GAME_LOCALES.map((option) => (
                <option value={option.id} key={option.id}>{option.id === "en" ? t("English") : option.label}</option>
              ))}
            </select>
          </label>
          <button className="game-button button-ghost help-button" type="button" onClick={() => { setTutorialStage(0); setTutorialVisible(true); }}>{t("How to play")}</button>
        </div>
      </header>

      {tutorialVisible ? (
        <section className="status-banner" data-testid={`tutorial-step-${tutorialStage}`} aria-label={t("Tutorial")}>
          <span className="eyebrow">{t("First battle")} · {t("Step")} {tutorialStage + 1} {t("of")} 3</span>
          <strong>{t(tutorialStage === 0 ? "Recruit a hero from the Night Market." : tutorialStage === 1 ? "Drag an ally to a teal tile or the bench to move or swap." : "When your formation is ready, begin battle.")}</strong>
          <button className="game-button button-ghost" type="button" data-testid="tutorial-skip" onClick={finishTutorial}>{t("Skip tutorial")}</button>
        </section>
      ) : null}

      <section className="workspace">
        <aside className="panel traits-panel" aria-label={t("Active traits")}>
          <div className="panel-heading">
            <div><span className="eyebrow">{t("Formation")}</span><h2 className="panel-title">{t("Active bonds")}</h2></div>
            <span className="panel-meta" data-testid="team-cap">{deployedCount}/{commanderCap}</span>
          </div>
          <div className="trait-list">
            {traits.map((trait) => {
              const definition = TRAITS[trait.id];
              const traitCopy = localizeTrait(locale, trait.id);
              const threshold = trait.nextThreshold ?? definition.thresholds.at(-1) ?? trait.count;
              return (
                <button
                  key={trait.id}
                  className={`trait-row ${trait.tier ? "trait-row-active" : ""} ${highlightedTrait === trait.id ? "trait-row-selected" : ""}`}
                  type="button"
                  data-testid={`trait-${trait.id}`}
                  onClick={() => setHighlightedTrait((value) => value === trait.id ? null : trait.id)}
                >
                  <span className="trait-icon" aria-hidden="true">{definition.glyph}</span>
                  <span className="trait-copy"><strong className="trait-name">{traitCopy.name}</strong><span className="trait-effect" data-testid={`trait-detail-${trait.id}`}>{trait.tier > 0 ? traitCopy.effects[trait.tier - 1] : t("Inactive")}</span></span>
                  <span className="trait-count" data-testid={`trait-count-${trait.id}`}>{trait.count}/{threshold}</span>
                </button>
              );
            })}
          </div>
          <div className="tactical-note">
            <span className="eyebrow">{t("Tactical note")}</span>
            <p>{t("Vanguards harden the whole team. Invokers accelerate the first cast. Select a bond to reveal its champions.")}</p>
          </div>
        </aside>

        <section className="board-section" aria-labelledby="board-title">
          <div className="board-header">
            <div className="board-copy">
              <span className="eyebrow">{t("Mooncrest arena")}</span>
              <h1 className="board-title" id="board-title">{t("Hold the lower line")}</h1>
            </div>
            <span className={`phase-chip phase-${game.phase}`} data-testid="phase-label">{phaseLabel(game.phase, locale)}</span>
          </div>
          <div className="board-wrap">
            <div className="territory-label territory-enemy">{t("Enemy territory")}</div>
            <div className="arena-plane">
              <div className={`board-grid ${boitata3DReady ? "boitata-3d-ready" : ""} ${meatGaga3DReady ? "meat-gaga-3d-ready" : ""} ${game.phase === "combat" && !playing ? "combat-paused" : ""} ${isSteppedMoment ? "combat-step-preview" : ""}`} role="grid" aria-label={t("Eight column by six row battle board")} data-testid="game-board" style={combatBeatStyle}>
              {combatLinks.length ? (
                <div className="combat-links" aria-hidden="true" data-testid="combat-links">
                  {combatLinks.map((link) => (
                    <span
                      className={`combat-link combat-link-${link.kind}`}
                      key={link.key}
                      style={link.style}
                    />
                  ))}
                </div>
              ) : null}
              {meatProjectiles.length ? (
                <div className="meat-projectile-layer" aria-hidden="true" data-testid="meat-projectile-layer">
                  {meatProjectiles.map((cue) => (
                    <span
                      className="meat-projectile-path"
                      data-testid={`meat-projectile-${cue.event.id}-${cue.targetId}`}
                      data-bonus-damage={Math.round(cue.bonusDamage)}
                      key={`${cue.event.id}:${cue.targetId}`}
                      style={cue.style}
                    >
                      <i className="meat-projectile" />
                      <i className="meat-splatter"><b /><b /><b /></i>
                    </span>
                  ))}
                </div>
              ) : null}
              {solStarfalls.map((starfall) => (
                <div className="sol-starfall-layer" aria-hidden="true" data-testid="sol-starfall-layer" key={starfall.event.id} style={starfall.style}>
                  <span className="sol-starfall-sky" />
                  <span className="sol-starfall-trail"><i /></span>
                  <span className="sol-starfall-sigil">
                    <span className="sol-starfall-sigil-core">✦</span>
                    <span className="sol-starfall-sigil-ring" />
                    <span className="sol-starfall-sigil-rays" />
                  </span>
                  {starfall.targets.map((target, index) => (
                    <span
                      className="sol-starfall-hit"
                      data-testid={`sol-starfall-target-${target.id}`}
                      key={`${starfall.event.id}:${target.id}`}
                      style={starfallImpactStyle(target.position, index, speed)}
                    >
                      <span className="sol-starfall-hit-star">✦</span>
                    </span>
                  ))}
                </div>
              ))}
              {elphabaGravityCues.map((cue) => (
                <div
                  className={`elphaba-gravity-layer elphaba-gravity-${cue.phase}`}
                  aria-hidden="true"
                  data-testid="elphaba-gravity-layer"
                  data-event-id={cue.event.id}
                  data-ability-phase={cue.phase}
                  data-lifted-count={cue.liftedTargets.length}
                  data-impact-count={cue.impactedTargets.length}
                  data-lift-duration-seconds={cue.event.liftDurationSeconds}
                  data-stun-duration-seconds={cue.event.stunDurationSeconds}
                  data-current-health-damage-percent={cue.event.currentHealthDamagePercent}
                  data-landing-at={cue.event.landingAt}
                  key={cue.event.id}
                >
                  <span className="elphaba-gravity-wash" />
                  <span className="elphaba-gravity-caster" style={gravityPointStyle(cue.actor.position)}><i>✦</i></span>
                  {cue.phase === "lift" ? cue.liftedTargets.map((target, index) => (
                    <span className="elphaba-gravity-lift-group" key={`${cue.event.id}:lift:${target.id}`}>
                      <span className="elphaba-gravity-link" style={combatLinkStyle(cue.actor.position, target.position, boardHeightRatio)} />
                      <span
                        className="elphaba-gravity-lift-target"
                        data-testid={`elphaba-lift-target-${target.id}`}
                        data-target-id={target.id}
                        data-levitating-until={(target as TimedCombatUnit).levitatingUntil}
                        style={gravityPointStyle(target.position, index, speed)}
                      ><i /><b /><em>↑</em></span>
                    </span>
                  )) : null}
                  {cue.phase === "landing" ? cue.liftedTargets.map((target, index) => (
                    <span
                      className="elphaba-gravity-landing-center"
                      data-testid={`elphaba-landing-center-${target.id}`}
                      data-target-id={target.id}
                      key={`${cue.event.id}:landing:${target.id}`}
                      style={gravityPointStyle(target.position, index, speed)}
                    ><i /><b /></span>
                  )) : null}
                  {cue.phase === "landing" ? cue.impactedTargets.map((target, index) => (
                    <span
                      className="elphaba-gravity-impact-target"
                      data-testid={`elphaba-impact-target-${target.id}`}
                      data-target-id={target.id}
                      data-damage={cue.event.amounts?.[target.id] ?? 0}
                      data-stun-duration-seconds={cue.event.stunDurationSeconds ?? 0}
                      key={`${cue.event.id}:impact:${target.id}`}
                      style={gravityPointStyle(target.position, index, speed)}
                    ><i>×</i></span>
                  )) : null}
                </div>
              ))}
              {Array.from({ length: BOARD_SIZE }, (_, index) => {
                const row = Math.floor(index / BOARD_COLUMNS);
                const column = index % BOARD_COLUMNS;
                const unit = boardUnits.find((candidate) => candidate.position === index) ?? null;
                const draggedAlly = draggedUnitId ? game.units.find((candidate) => candidate.id === draggedUnitId) : null;
                const playerCell = row >= PLAYER_START_ROW;
                const valid = game.phase === "planning" && !!draggedAlly && playerCell;
                const highlighted = !!unit && !!highlightedTrait && HEROES[unit.heroId].traits.includes(highlightedTrait);
                const loadoutDropStatus = unit ? loadoutDropStatusFor(unit) : null;
                const equipmentSummary = unit ? equippedItemSummary(unit.itemSlots, locale) : "";
                const aria = `${t("Row")} ${row + 1}, ${t("column")} ${column + 1}, ${t(playerCell ? "player" : "enemy")} ${t("territory")}${unit ? `, ${localizeHero(locale, unit.heroId).name}, ${localizeRole(locale, HEROES[unit.heroId].role).label}, ${t("range")} ${unit.range}, ${t("level")} ${unit.level}, ${Math.round(clampPercent(unit.hp, unit.maxHp))} ${t("percent health")}${unit.shield > 0 ? `, ${Math.round(unit.shield)} ${t("shield")}` : ""}${equipmentSummary ? `, ${equipmentSummary}` : ""}` : `, ${t("empty")}`}`;
                return (
                  <button
                    className={`board-cell ${playerCell ? "board-cell-player" : "board-cell-enemy"} ${valid ? "board-cell-valid" : ""} ${unit?.id === selectedId ? "board-cell-selected" : ""} ${loadoutDropStatus ? `loadout-cell-${loadoutDropStatus}` : ""}`}
                    key={index}
                    type="button"
                    role="gridcell"
                    aria-label={aria}
                    data-testid={`board-cell-r${row}-c${column}`}
                    onClick={() => handleBoardCell(index)}
                    onDragOver={(event) => {
                      if (draggedLoadout) {
                        if (unit?.side === "player" && game.phase === "planning") {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                        return;
                      }
                      if (playerCell && game.phase === "planning") event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (unit?.side === "player" && handleChampionLoadoutDrop(event, unit.id)) return;
                      const unitId = event.dataTransfer.getData("text/unit-id");
                      if (unitId && playerCell) handleMove(unitId, "board", index);
                    }}
                  >
                    <span className="board-coord" aria-hidden="true">{String.fromCharCode(65 + column)}{row + 1}</span>
                    {unit ? (
                      <UnitToken
                        key={`${unit.id}-${currentMoment?.key ?? "idle"}`}
                        unit={unit}
                        locale={locale}
                        selected={unit.id === selectedId}
                        highlighted={highlighted}
                        currentEvents={currentEvents}
                        previousSnapshotEvent={previousSnapshotEvent}
                        combatTime={currentCombatTime}
                        boardHeightRatio={boardHeightRatio}
                        playbackSpeed={speed}
                        draggable={game.phase === "planning" && unit.side === "player"}
                        loadoutDropStatus={loadoutDropStatus}
                        onDragStart={(event) => {
                          setDraggedLoadout(null);
                          event.dataTransfer.setData("text/unit-id", unit.id);
                          setDraggedUnitId(unit.id);
                          setSelectedId(unit.id);
                        }}
                        onDragEnd={() => setDraggedUnitId(null)}
                      />
                    ) : null}
                  </button>
                );
              })}
                {boitataBoardUnits.length > 0 ? (
                  <Boitata3DLayer
                    units={boitataBoardUnits}
                    currentEvents={currentEvents}
                    previousSnapshotEvent={previousSnapshotEvent}
                    phase={game.phase}
                    playing={playing}
                    speed={speed}
                    actionDuration={combatBeatMilliseconds / 1000}
                    boardHeightRatio={boardHeightRatio}
                    onReady={() => setBoitata3DReady(true)}
                    onFallback={() => setBoitata3DReady(false)}
                  />
                ) : null}
                {meatGagaBoardUnits.length > 0 ? (
                  <MeatGaga3DLayer
                    units={meatGagaBoardUnits}
                    currentEvents={currentEvents}
                    previousSnapshotEvent={previousSnapshotEvent}
                    phase={game.phase}
                    playing={playing}
                    previewing={isSteppedMoment}
                    speed={speed}
                    actionDuration={combatBeatMilliseconds / 1000}
                    boardHeightRatio={boardHeightRatio}
                    onReady={() => setMeatGaga3DReady(true)}
                    onFallback={() => setMeatGaga3DReady(false)}
                    onDisposed={() => setMeatGaga3DReady(false)}
                  />
                ) : null}
              </div>
              <section className="arena-bench" aria-labelledby="bench-title" data-testid="bench">
                <div className="arena-bench-rail">
                  <span className="arena-bench-territory">{t("Your territory")} · {deployedCount}/{commanderCap} {t("deployed")}</span>
                  <h2 id="bench-title">{t("Bench")}</h2>
                  <span className="arena-bench-count">{benchUnits.length}/{BENCH_SIZE} {t("reserves")}</span>
                </div>
                <div className="bench-grid">
                  <section
                    className={`bench-forge-slot ${forgeOpen ? "bench-forge-slot-open" : ""} ${game.roundResult?.itemComponentReward ? "bench-forge-slot-reward" : ""}`}
                    aria-label={t("Relic Forge inventory")}
                    data-testid="bench-forge"
                  >
                    <button
                      className="bench-forge-toggle"
                      type="button"
                      ref={forgeToggleRef}
                      aria-expanded={forgeOpen}
                      aria-controls="arena-forge-drawer"
                      onClick={() => setForgeOpen((open) => !open)}
                    >
                      <span><small>{t("Left bay")}</small><strong>{t("Forge")}</strong></span>
                      <b>{componentCount}<small> {t("parts")}</small> · {game.craftedItemInventory.length}<small> {t("gear")}</small></b>
                    </button>
                    <div className="bench-forge-components" aria-label={t("Forge components")}>
                      {ITEM_COMPONENT_IDS.map((componentId) => {
                        const component = ITEM_COMPONENTS[componentId];
                        const componentCopy = localizeComponent(locale, componentId);
                        const selectedCount = forgeComponents.filter((id) => id === componentId).length;
                        const available = game.componentInventory[componentId];
                        return (
                          <button
                            className={`bench-forge-component ${selectedCount ? "bench-forge-component-selected" : ""} ${draggedLoadout?.kind === "component" && draggedLoadout.id === componentId ? "loadout-source-dragging" : ""}`}
                            type="button"
                            key={componentId}
                            data-testid={`bench-forge-component-${componentId}`}
                            disabled={game.phase !== "planning" || available <= 0}
                            draggable={game.phase === "planning" && available > 0}
                            onClick={() => {
                              handleSelectComponent(componentId);
                              setForgeOpen(true);
                            }}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData(ITEM_COMPONENT_DRAG_TYPE, componentId);
                              setDraggedLoadout({ kind: "component", id: componentId });
                            }}
                            onDragEnd={() => setDraggedLoadout(null)}
                            aria-label={`${componentCopy.name}, ${available} ${t("available")}. ${t("Add to the forge or drag onto a champion to enhance gear.")}`}
                            title={`${componentCopy.name} ×${available}`}
                          >
                            <span aria-hidden="true">{component.glyph}</span>
                            <b>×{available}</b>
                          </button>
                        );
                      })}
                    </div>
                    <div className="bench-forge-items" aria-label={t("Crafted gear inventory")}>
                      {game.craftedItemInventory.length ? game.craftedItemInventory.map((item) => {
                        const definition = ITEM_DEFINITIONS[item.itemId];
                        return (
                          <button
                            className={`bench-forge-item ${item.id === selectedCraftedItemId ? "bench-forge-item-selected" : ""} ${item.tier === "enhanced" ? "bench-forge-item-enhanced" : ""} ${draggedLoadout?.kind === "item" && draggedLoadout.id === item.id ? "loadout-source-dragging" : ""}`}
                            type="button"
                            key={item.id}
                            data-testid={`bench-forge-item-${item.id}`}
                            aria-pressed={item.id === selectedCraftedItemId}
                            aria-label={`${craftedItemName(item, locale)}, ${craftedItemBonusText(item, locale)}. ${t("Select or drag onto a champion.")}`}
                            title={craftedItemName(item, locale)}
                            draggable={game.phase === "planning"}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData(CRAFTED_ITEM_DRAG_TYPE, item.id);
                              setDraggedLoadout({ kind: "item", id: item.id });
                            }}
                            onDragEnd={() => setDraggedLoadout(null)}
                            onClick={() => {
                              setSelectedCraftedItemId((selected) => selected === item.id ? null : item.id);
                              setForgeOpen(true);
                            }}
                          >
                            <span aria-hidden="true">{definition.recipe.map((componentId) => ITEM_COMPONENTS[componentId].glyph).join("")}</span>
                            {item.enhancement ? <i aria-hidden="true">{ITEM_COMPONENTS[item.enhancement].glyph}</i> : null}
                          </button>
                        );
                      }) : <button className="bench-forge-empty" type="button" onClick={() => setForgeOpen(true)}>{t("Gear")}</button>}
                    </div>
                  </section>
                  {Array.from({ length: BENCH_SIZE }, (_, index) => {
                    const unit = benchUnits.find((candidate) => candidate.benchIndex === index);
                    const display = unit ? persistentDisplay(unit) : null;
                    const loadoutDropStatus = display ? loadoutDropStatusFor(display) : null;
                    return (
                      <button
                        className={`bench-slot ${unit?.id === selectedId ? "board-cell-selected" : ""} ${loadoutDropStatus ? `loadout-cell-${loadoutDropStatus}` : ""}`}
                        type="button"
                        key={index}
                        data-testid={`bench-slot-${index}`}
                        aria-label={display ? `${t("Bench slot")} ${index + 1}, ${localizeHero(locale, display.heroId).name}, ${localizeRole(locale, HEROES[display.heroId].role).label}, ${t("range")} ${display.range}${equippedItemSummary(display.itemSlots, locale) ? `, ${equippedItemSummary(display.itemSlots, locale)}` : ""}` : `${t("Bench slot")} ${index + 1}, ${t("empty")}`}
                        disabled={game.phase !== "planning"}
                        onClick={() => handleBenchSlot(index)}
                        onDragOver={(event) => {
                          if (draggedLoadout) {
                            if (display && game.phase === "planning") {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                            }
                            return;
                          }
                          if (game.phase === "planning") event.preventDefault();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (display && handleChampionLoadoutDrop(event, display.id)) return;
                          const unitId = event.dataTransfer.getData("text/unit-id");
                          if (unitId) handleMove(unitId, "bench", index);
                        }}
                      >
                        {display ? (
                          <UnitToken
                            unit={display}
                            locale={locale}
                            selected={display.id === selectedId}
                            highlighted={!!highlightedTrait && HEROES[display.heroId].traits.includes(highlightedTrait)}
                            currentEvents={[]}
                            previousSnapshotEvent={null}
                            combatTime={0}
                            draggable={game.phase === "planning"}
                            loadoutDropStatus={loadoutDropStatus}
                            onDragStart={(event) => {
                              setDraggedLoadout(null);
                              event.dataTransfer.setData("text/unit-id", display.id);
                              setDraggedUnitId(display.id);
                              setSelectedId(display.id);
                            }}
                            onDragEnd={() => setDraggedUnitId(null)}
                          />
                        ) : <span className="empty-copy">+</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
            {forgeOpen ? (
              <section
                className="panel item-armory-panel bench-forge-drawer"
                id="arena-forge-drawer"
                ref={forgeDrawerRef}
                tabIndex={-1}
                aria-label={t("Relic Forge")}
                data-testid="item-armory"
              >
                <div className="panel-heading">
                  <div><span className="eyebrow">{t("Components & gear")}</span><h2 className="panel-title">{t("Relic Forge")}</h2></div>
                  <div className="bench-forge-drawer-actions">
                    <span className="panel-meta">{componentCount} {t("parts")} · {game.craftedItemInventory.length} {t("gear")}</span>
                    <button
                      className="bench-forge-close"
                      type="button"
                      onClick={() => {
                        setForgeOpen(false);
                        window.requestAnimationFrame(() => forgeToggleRef.current?.focus());
                      }}
                      aria-label={t("Close Relic Forge")}
                    >×</button>
                  </div>
                </div>
                <p className="armory-cadence">{t("This Forge occupies the left arena bay. A component arrives every other round. Combine two for gear, then drag gear onto a champion to equip it or drag a component onto a champion with full gear to enhance it.")}</p>
                {game.roundResult?.itemComponentReward ? (
                  <div className="armory-reward" data-testid="round-item-reward">
                    <span>{ITEM_COMPONENTS[game.roundResult.itemComponentReward].glyph}</span>
                    <small>{t("New component")}</small>
                    <strong>{localizeComponent(locale, game.roundResult.itemComponentReward).name}</strong>
                  </div>
                ) : null}
                <div className="component-grid" aria-label={t("Item components")}>
                  {ITEM_COMPONENT_IDS.map((componentId) => {
                    const component = ITEM_COMPONENTS[componentId];
                    const componentCopy = localizeComponent(locale, componentId);
                    const selectedCount = forgeComponents.filter((id) => id === componentId).length;
                    const available = game.componentInventory[componentId];
                    return (
                      <button
                        className={`item-component-card ${selectedCount ? "item-component-card-selected" : ""} ${draggedLoadout?.kind === "component" && draggedLoadout.id === componentId ? "loadout-source-dragging" : ""}`}
                        type="button"
                        key={componentId}
                        data-testid={`item-component-${componentId}`}
                        disabled={game.phase !== "planning" || available <= 0}
                        draggable={game.phase === "planning" && available > 0}
                        onClick={() => handleSelectComponent(componentId)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(ITEM_COMPONENT_DRAG_TYPE, componentId);
                          setDraggedLoadout({ kind: "component", id: componentId });
                        }}
                        onDragEnd={() => setDraggedLoadout(null)}
                        aria-label={`${t("Add")} ${componentCopy.name} ${t("to forge, or drag it onto a champion to enhance equipped full gear")}, ${available} ${t("available")}${selectedCount ? `, ${selectedCount} ${t("selected")}` : ""}`}
                      >
                        <span className="item-component-glyph" aria-hidden="true">{component.glyph}</span>
                        <span><strong>{componentCopy.name}</strong><small>{componentCopy.description}</small></span>
                        <b data-testid={`item-component-count-${componentId}`}>×{available}</b>
                      </button>
                    );
                  })}
                </div>
                <div className="craft-tray" aria-label={t("Crafting tray")}>
                  {[0, 1].map((index) => {
                    const componentId = forgeComponents[index];
                    return (
                      <button
                        className={`craft-slot ${componentId ? "craft-slot-filled" : ""}`}
                        type="button"
                        key={index}
                        data-testid={`item-craft-slot-${index}`}
                        disabled={!componentId}
                        onClick={() => setForgeComponents((components) => components.filter((_, componentIndex) => componentIndex !== index))}
                        aria-label={localizeText(locale, componentId ? `Remove ${localizeComponent(locale, componentId).name} from forge` : `Empty craft slot ${index + 1}`)}
                      >
                        {componentId ? <><span>{ITEM_COMPONENTS[componentId].glyph}</span><small>{localizeComponent(locale, componentId).name}</small></> : <><span>+</span><small>{t("Component")}</small></>}
                      </button>
                    );
                  })}
                  <div className="craft-preview" data-testid="item-craft-preview">
                    <small>{t(forgeRecipe ? "Recipe ready" : forgeComponents.length ? "Choose one more" : "Crafting tray")}</small>
                    <strong>{forgeRecipe ? localizeItem(locale, forgeRecipe.id).name : t("2 components → full item")}</strong>
                  </div>
                  <button className="game-button button-secondary" type="button" data-testid="craft-item" disabled={game.phase !== "planning" || !forgeRecipe} onClick={handleCraftItem}>{t("Craft full item")}</button>
                </div>
                <div className="crafted-inventory-heading">
                  <span><small>{t("Inventory")}</small><strong>{t("Crafted gear")}</strong></span>
                  <small>{localizeText(locale, selectedAllyForItems ? `Equipping ${localizeHero(locale, selectedAllyForItems.heroId).name}` : "Select an allied champion to equip")}</small>
                </div>
                <div className="crafted-item-list">
                  {game.craftedItemInventory.length ? game.craftedItemInventory.map((item) => {
                    const definition = ITEM_DEFINITIONS[item.itemId];
                    return (
                      <button
                        className={`crafted-item-card ${item.id === selectedCraftedItemId ? "crafted-item-card-selected" : ""} ${item.tier === "enhanced" ? "crafted-item-card-enhanced" : ""} ${draggedLoadout?.kind === "item" && draggedLoadout.id === item.id ? "loadout-source-dragging" : ""}`}
                        type="button"
                        key={item.id}
                        data-testid={`crafted-item-${item.id}`}
                        aria-pressed={item.id === selectedCraftedItemId}
                        draggable={game.phase === "planning"}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(CRAFTED_ITEM_DRAG_TYPE, item.id);
                          setDraggedLoadout({ kind: "item", id: item.id });
                        }}
                        onDragEnd={() => setDraggedLoadout(null)}
                        onClick={() => setSelectedCraftedItemId((selected) => selected === item.id ? null : item.id)}
                      >
                        <span className="item-mark" aria-hidden="true">{definition.recipe.map((componentId) => ITEM_COMPONENTS[componentId].glyph).join("")}{item.enhancement ? <i>{ITEM_COMPONENTS[item.enhancement].glyph}</i> : null}</span>
                        <span><strong>{craftedItemName(item, locale)}</strong><small>{craftedItemBonusText(item, locale)}</small></span>
                        <b className={`item-tier ${item.tier === "enhanced" ? "item-tier-enhanced" : ""}`}>{t(item.tier)}</b>
                      </button>
                    );
                  }) : <p className="armory-empty">{t("Your first full item can be forged after collecting two components.")}</p>}
                </div>
                {selectedCraftedItem ? (
                  <div className="item-action-row">
                    <button className="game-button button-secondary" type="button" data-testid={`equip-item-${selectedCraftedItem.id}`} disabled={game.phase !== "planning" || !selectedAllyForItems || selectedAllyForItems.itemSlots.every(Boolean)} onClick={() => handleEquipItem()}>{selectedAllyForItems ? `${t("Equip to")} ${localizeHero(locale, selectedAllyForItems.heroId).name}` : t("Equip selected champion")}</button>
                    <button className="game-button button-primary" type="button" data-testid={`enhance-item-${selectedCraftedItem.id}`} disabled={game.phase !== "planning" || selectedCraftedItem.tier === "enhanced" || forgeComponents.length !== 1} onClick={handleEnhanceItem}>{t("Enhance with 1 component")}</button>
                  </div>
                ) : null}
                {forgeComponents.length === 1 ? (
                  <div className="item-action-row item-component-action-row">
                    <button
                      className="game-button button-primary"
                      type="button"
                      data-testid="enhance-equipped-item"
                      disabled={game.phase !== "planning" || !selectedAllyForItems || !selectedAllyForItems.itemSlots.some((item) => item?.tier === "full")}
                      onClick={() => selectedAllyForItems && handleEnhanceEquippedGear(selectedAllyForItems.id, forgeComponents[0])}
                    >
                      {selectedAllyForItems ? `${t("Enhance full gear for")} ${localizeHero(locale, selectedAllyForItems.heroId).name}` : t("Enhance selected champion's gear")}
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
          {game.phase === "combat" && currentMoment ? (
            <div className="combat-caption">
              <span>{formatCombatTime(currentCombatTime, locale)}</span>
              <div className="combat-caption-copy" aria-live="polite" aria-atomic="true">
                {currentEvents.map((event) => <strong key={event.id}>{localizeCombatEvent(locale, event)}</strong>)}
              </div>
            </div>
          ) : (
            <p className="placement-hint">{t("Click any character to inspect. Drag allies between teal tiles and the bench to place or swap.")}</p>
          )}
        </section>

        <aside className="panel enemy-panel" aria-label={t(selectedDisplay ? "Unit inspector" : "Enemy scout report")}>
          {selectedDisplay && selectedHero && selectedHeroCopy ? (
            <section className="selected-panel" data-testid="unit-inspector">
              <div className="selected-head">
                <HeroArt heroId={selectedHero.id} className={`enemy-portrait ${selectedDisplay.side === "player" ? "portrait-ally" : ""}`} />
                <div><span className="eyebrow">{t(selectedDisplay.side === "player" ? "Your champion" : "Enemy champion")}</span><h2 className="panel-title">{selectedHeroCopy.name}</h2><p>{selectedHeroCopy.title}</p></div>
              </div>
              <div className="rank-line">
                <span data-testid={`unit-stars-${selectedDisplay.id}`}>{starsLabel(selectedDisplay.stars)}</span>
                <span>{t("Unit level")} {selectedDisplay.level}</span>
              </div>
              <div className="unit-xp-block" data-testid={`unit-xp-${selectedDisplay.id}`}>
                <span>XP {selectedPersistent?.xp ?? 0}/{selectedUnitXpMax || t("MAX")}</span>
                <span className="meter meter-xp" style={meterStyle(selectedPersistent?.xp ?? 0, selectedUnitXpMax)}><span className="meter-fill" /></span>
              </div>
              <div className="stat-grid">
                <span className="stat-cell"><small>{t("HP")}</small><strong>{Math.round(selectedDisplay.hp)}/{selectedDisplay.maxHp}</strong></span>
                {selectedHero.id === "meat-gaga" ? (
                  <span className="stat-cell stat-cell-passive"><small>{t("Resource")}</small><strong>{t("Passive · No Mana")}</strong></span>
                ) : (
                  <span className="stat-cell"><small>{t("Mana")}</small><strong>{Math.round(selectedDisplay.mana)}/{selectedDisplay.maxMana}</strong></span>
                )}
                <span className="stat-cell"><small>{t("Damage")}</small><strong>{selectedDisplay.attack}</strong></span>
                <span className="stat-cell"><small>{t("Armor")}</small><strong>{selectedDisplay.armor}</strong></span>
                <span className="stat-cell stat-cell-rate stat-cell-attack-speed" data-testid={`unit-attack-speed-${selectedDisplay.id}`}><small>{t("Attack speed")}</small><strong>{formatRate(selectedDisplay.attackSpeed, locale)}/{t("sec")}</strong></span>
                <span className="stat-cell stat-cell-rate stat-cell-move-speed" data-testid={`unit-move-speed-${selectedDisplay.id}`}><small>{t("Move speed")}</small><strong>{formatRate(selectedDisplay.moveSpeed, locale)} {t("tiles")}/{t("sec")}</strong></span>
                {selectedHero.id === "meat-gaga" ? (
                  <span className="stat-cell stat-cell-meat-stack" data-testid={`unit-meat-stack-inspector-${selectedDisplay.id}`}><small>{t("Meat reserve")}</small><strong>{Math.round(selectedDisplay.meatStack)}</strong></span>
                ) : (
                  <span className="stat-cell stat-cell-rate stat-cell-mana-regen" data-testid={`unit-mana-regen-${selectedDisplay.id}`}><small>{t("Mana regen")}</small><strong>{formatRate(selectedDisplay.manaRegen, locale)}/{t("sec")}</strong></span>
                )}
                {selectedHero.id === "boitata" ? (
                  <>
                    <span className="stat-cell stat-cell-shield" data-testid={`unit-fire-wall-shield-${selectedDisplay.id}`}><small>{selectedHeroCopy.ability.name}</small><strong>{Math.round(selectedDisplay.fireWallShield)}</strong></span>
                    {selectedDisplay.shield > selectedDisplay.fireWallShield ? (
                      <span className="stat-cell stat-cell-shield"><small>{t("Other shields")}</small><strong>{Math.round(selectedDisplay.shield - selectedDisplay.fireWallShield)}</strong></span>
                    ) : null}
                  </>
                ) : selectedDisplay.shield > 0 ? (
                  <span className="stat-cell stat-cell-shield" data-testid={`unit-shield-${selectedDisplay.id}`}><small>{t("Shield")}</small><strong>{Math.round(selectedDisplay.shield)}</strong></span>
                ) : null}
              </div>
              <section className="equipment-block" data-testid={`unit-equipment-${selectedDisplay.id}`} aria-label={`${selectedHeroCopy.name}: ${t("item slots")}`}>
                <div className="equipment-heading">
                  <span><small>{t("Equipment")}</small><strong>{t("Item slots")}</strong></span>
                  <span>{selectedPersistent?.itemSlots.filter(Boolean).length ?? 0}/{ITEM_SLOTS_PER_UNIT}</span>
                </div>
                <div className="equipment-slots">
                  {(selectedPersistent?.itemSlots ?? [null, null, null]).map((item, slotIndex) => {
                    const definition = item ? ITEM_DEFINITIONS[item.itemId] : null;
                    const canManageSlot = selectedPersistent?.side === "player" && game.phase === "planning";
                    const canEquip = canManageSlot && !item && !!selectedCraftedItem;
                    const canUnequip = canManageSlot && !!item;
                    return (
                      <button
                        className={`equipment-slot ${item ? "equipment-slot-filled" : "equipment-slot-empty"} ${item?.tier === "enhanced" ? "equipment-slot-enhanced" : ""}`}
                        type="button"
                        key={slotIndex}
                        data-testid={`unit-item-slot-${selectedDisplay.id}-${slotIndex}`}
                        disabled={!canEquip && !canUnequip}
                        onClick={() => item ? handleUnequipItem(slotIndex) : handleEquipItem(slotIndex)}
                        aria-label={item
                          ? `${craftedItemName(item, locale)}, ${craftedItemBonusText(item, locale, selectedHero.id)}${canUnequip ? `, ${t("click to unequip")}` : ""}`
                          : `${t("Empty item slot")} ${slotIndex + 1}${canEquip ? `, ${t("equip")} ${craftedItemName(selectedCraftedItem!, locale)}` : ""}`}
                      >
                        <span className="item-mark" aria-hidden="true">
                          {definition ? definition.recipe.map((componentId) => ITEM_COMPONENTS[componentId].glyph).join("") : "+"}
                          {item?.enhancement ? <i>{ITEM_COMPONENTS[item.enhancement].glyph}</i> : null}
                        </span>
                        <span className="equipment-slot-copy">
                          <strong>{item ? craftedItemName(item, locale) : `${t("Slot")} ${slotIndex + 1}`}</strong>
                          <small>{item ? craftedItemBonusText(item, locale, selectedHero.id) : t(canEquip ? "Equip selected item" : "Empty")}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
              {selectedRole && selectedRoleCopy ? (
                <div className={`role-range-card role-${selectedRole.id}`} data-testid={`unit-role-range-${selectedDisplay.id}`}>
                  <span className="role-range-copy">
                    <small>{t("Combat role · Basic attack range")}</small>
                    <strong>{selectedRoleCopy.label}</strong>
                    <p>{selectedRoleCopy.description}</p>
                  </span>
                  <span className="range-readout">
                    <strong>{selectedDisplay.range}</strong>
                    <small>{t(selectedDisplay.range === 1 ? "tile" : "tiles")}</small>
                  </span>
                </div>
              ) : null}
              {selectedHero.id === "meat-gaga" && meatGagaPassivePreview ? (
                <details className="passive-card ability-box ability-card" data-testid={`ability-${selectedHero.ability.id}`}>
                  <summary className="ability-summary">
                    <span className="ability-heading">
                      <span>
                        <span className="eyebrow">{t("Passive · No Mana")}</span>
                        <strong className="ability-name" id={`ability-name-${selectedHero.ability.id}`}>{selectedHeroCopy.ability.name}</strong>
                      </span>
                      <span className="ability-rank">{t("Current")} · {"★".repeat(meatGagaPassivePreview.current.stars)}</span>
                    </span>
                    <span className="ability-description">{selectedHeroCopy.ability.description}</span>
                    <span
                      className="ability-current-values"
                      data-testid="meat-gaga-passive-current-values"
                      role="list"
                      aria-label={`${selectedHeroCopy.ability.name}: ${t("current values")}`}
                    >
                      <span className="ability-value ability-value-meat-gain" role="listitem">
                        <small>{t("Stored per death")}</small>
                        <strong>{meatGagaPassivePreview.current.stackGainPercent}% {t("max HP")}</strong>
                      </span>
                      <span className="ability-value ability-value-meat-spend" role="listitem">
                        <small>{t("Spent per attack")}</small>
                        <strong>{meatGagaPassivePreview.current.stackConsumePercent}% {t("of stack")}</strong>
                      </span>
                      <span className="ability-value ability-value-meat-reserve" role="listitem">
                        <small>{t("Current reserve")}</small>
                        <strong>{Math.round(selectedDisplay.meatStack)}</strong>
                      </span>
                      <span className="ability-value ability-value-meat-bonus" role="listitem">
                        <small>{t("Next attack bonus")}</small>
                        <strong>+{meatGagaNextBonus} {t("raw")}</strong>
                      </span>
                    </span>
                    <span className="ability-target-rule">{t("Passive: Every character death · Enhances each basic attack while reserve remains")}</span>
                    <span className="ability-disclosure" aria-hidden="true">{t("Hover or tap for star scaling")}</span>
                  </summary>
                  <div className="ability-breakdown" aria-labelledby={`ability-name-${selectedHero.ability.id}`}>
                    <div className="ability-breakdown-heading">
                      <strong>{t("Passive star scaling")}</strong>
                      <small>{t("No Mana, regeneration, or cast time")}</small>
                    </div>
                    <p className="ability-scale-copy">{t("Whenever any character dies, Meat Gaga stores part of that character's maximum Life. Her next basic attack consumes part of the reserve as raw bonus damage, repeating until the reserve is empty.")}</p>
                    <table className="ability-scale-table" data-testid="meat-gaga-passive-scaling">
                      <caption className="sr-only">{selectedHeroCopy.ability.name}: {t("values by star level")}</caption>
                      <thead>
                        <tr><th scope="col">{t("Value")}</th><th scope="col">1★</th><th scope="col">2★</th><th scope="col">3★</th></tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th scope="row">{t("Max HP stored per death")}</th>
                          {meatGagaPassivePreview.byStar.map((values) => (
                            <td aria-current={values.stars === meatGagaPassivePreview.current.stars ? "true" : undefined} key={values.stars}>{values.stackGainPercent}%</td>
                          ))}
                        </tr>
                        <tr>
                          <th scope="row">{t("Stack spent per attack")}</th>
                          {meatGagaPassivePreview.byStar.map((values) => (
                            <td aria-current={values.stars === meatGagaPassivePreview.current.stars ? "true" : undefined} key={values.stars}>{values.stackConsumePercent}%</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                    <p className="ability-context-note">{t("The reserve is not Mana. Meat Gaga never casts; every empowered hit is still a basic attack and keeps her Shooter range.")}</p>
                  </div>
                </details>
              ) : abilityPreview ? (
                <details className="ability-box ability-card" data-testid={`ability-${selectedHero.ability.id}`}>
                  <summary className="ability-summary">
                    <span className="ability-heading">
                      <span>
                        <span className="eyebrow">{t("Ability")} · {selectedHero.ability.manaCost} {t("mana")}</span>
                        <strong className="ability-name" id={`ability-name-${selectedHero.ability.id}`}>{selectedHeroCopy.ability.name}</strong>
                      </span>
                      <span className="ability-rank">{t("Current")} · {"★".repeat(abilityPreview.current.stars)}</span>
                    </span>
                    <span className="ability-description">{selectedHeroCopy.ability.description}</span>
                    <span
                      className="ability-current-values"
                      data-testid={`ability-current-values-${selectedHero.ability.id}`}
                      role="list"
                      aria-label={`${selectedHeroCopy.ability.name}: ${t("current values")}`}
                    >
                      {currentAbilityMetrics.map((metric) => (
                        <span className={`ability-value ability-value-${metric.kind}`} role="listitem" key={metric.id}>
                          <small>{metric.label}</small>
                          <strong>{metric.format(abilityPreview.current)}</strong>
                        </span>
                      ))}
                    </span>
                    <span className="ability-target-rule">{t("Targets")}: {selectedHeroCopy.ability.targetRule}</span>
                    <span className="ability-disclosure" aria-hidden="true">{t("Hover or tap for star scaling")}</span>
                  </summary>
                  <div className="ability-breakdown" aria-labelledby={`ability-name-${selectedHero.ability.id}`}>
                    <div className="ability-breakdown-heading">
                      <strong>{t("Star scaling")}</strong>
                      <small>{t("Same level, equipment, and bonds")}</small>
                    </div>
                    <p className="ability-scale-copy">{formatAbilityScaling(locale, abilityPreview)}</p>
                    <table className="ability-scale-table" data-testid={`ability-scaling-${selectedHero.ability.id}`}>
                      <caption className="sr-only">{selectedHeroCopy.ability.name}: {t("values by star level")}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{t("Value")}</th>
                          <th scope="col">1★</th>
                          <th scope="col">2★</th>
                          <th scope="col">3★</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scalingAbilityMetrics.map((metric) => (
                          <tr key={metric.id}>
                            <th scope="row">{metric.label}</th>
                            {abilityPreview.byStar.map((values) => (
                              <td aria-current={values.stars === abilityPreview.current.stars ? "true" : undefined} key={values.stars}>
                                {metric.applies(values) ? metric.format(values) : "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {abilityPreview.modifiers.length ? (
                      <div className="ability-modifiers" aria-label={t("Included ability modifiers")}>
                        <span className="ability-modifier-label">{t("Included")}</span>
                        {abilityPreview.modifiers.map((modifier) => (
                          <span
                            className={`ability-modifier ${modifier.startsWith("Item ·") ? "ability-modifier-item" : modifier.startsWith("Bond ·") ? "ability-modifier-bond" : ""}`}
                            key={modifier}
                          >
                            {localizeAbilityText(locale, modifier)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {abilityPreview.contextNote ? <p className="ability-context-note">{localizeAbilityText(locale, abilityPreview.contextNote)}</p> : null}
                  </div>
                </details>
              ) : null}
              <div className="trait-chips">{selectedHero.traits.map((trait) => <span key={trait}>{TRAITS[trait].glyph} {localizeTrait(locale, trait).name}</span>)}</div>
              {selectedPersistent?.side === "player" ? <p className="copy-progress">{t("Copies toward next star")}: {selectedCopies}/3</p> : null}
              {selectedPersistent?.side === "player" && game.phase === "planning" ? (
                <button className="game-button button-danger" type="button" onClick={() => {
                  commit(sellUnit(game, selectedPersistent.id), () => {
                    if (selectedPersistent.heroId === "boitata") setBoitata3DReady(false);
                    setSelectedId(null);
                  });
                }}>{t("Sell for")} {HEROES[selectedPersistent.heroId].cost * (selectedPersistent.stars === 3 ? 9 : selectedPersistent.stars === 2 ? 3 : 1)} {t("gold")}</button>
              ) : null}
            </section>
          ) : game.phase === "combat" ? (
            <section className="combat-log" data-testid="combat-log">
              <div className="panel-heading"><div><span className="eyebrow">{t("Live chronicle")}</span><h2 className="panel-title">{t("Combat log")}</h2></div></div>
              <div className="log-list">
                {visibleCombatMoments.flatMap((moment) => moment.events.map((event) => (
                  <p className={`log-entry log-${event.type}`} key={event.id} data-testid={`combat-event-${event.id}`}><span className="log-time">{formatCombatTime(moment.timestamp, locale)}</span>{localizeCombatEvent(locale, event)}</p>
                )))}
              </div>
            </section>
          ) : (
            <section>
              <div className="panel-heading"><div><span className="eyebrow">{t("Scout report")}</span><h2 className="panel-title">Mooncrest</h2></div><span className="panel-meta">{game.enemyUnits.length} {t("units")}</span></div>
              <div className="enemy-list">
                {game.enemyUnits.map((unit) => {
                  const hero = HEROES[unit.heroId];
                  const stats = getUnitStats(unit);
                  return (
                    <button className="enemy-card" type="button" key={unit.id} onClick={() => setSelectedId(unit.id)}>
                      <HeroArt heroId={hero.id} className="enemy-portrait" />
                      <span className="enemy-copy"><strong>{localizeHero(locale, hero.id).name}</strong><small>{localizeRole(locale, hero.role).label} · {t("Range")} {stats.range} · {t("L")}{unit.level} · {starsLabel(unit.stars)}</small></span>
                      <span className="enemy-threat">{t("HP")} {stats.maxHp}</span>
                    </button>
                  );
                })}
              </div>
              <div className="scout-note"><span className="eyebrow">{t("Read their line")}</span><p>{t("Coral champions begin above the center. Inspect any unit to learn its range, defenses, and casting rule.")}</p></div>
            </section>
          )}
        </aside>
      </section>

      <section className="dock">
        <section className="panel shop-panel" aria-label={t("Night Market")} data-testid="shop">
          <div className="panel-heading"><div><span className="eyebrow">{t("Recruitment")}</span><h2 className="panel-title">{t("Night Market")}</h2></div><span className="panel-meta">{t(game.shopLocked ? "Locked" : "Refreshes next round")}</span></div>
          <div className="shop-grid">
            {game.shop.map((offer, index) => {
              if (!offer) return <div className="shop-card shop-card-empty" key={`empty-${index}`}><span>{t("Sold")}</span></div>;
              const hero = HEROES[offer.heroId];
              const copies = getCopyCount(game, offer.heroId, 1);
              return (
                <button
                  className="shop-card"
                  type="button"
                  key={offer.id}
                  data-testid={`buy-offer-${offer.id}`}
                  aria-label={`${t("Recruit")} ${localizeHero(locale, hero.id).name}, ${localizeRarity(locale, hero.rarity)} ${localizeRole(locale, hero.role).label}, ${formatList(locale, hero.traits.map((trait) => localizeTrait(locale, trait).name))}, ${t("range")} ${ROLE_PROFILES[hero.role].range}, ${t("copies")} ${copies} ${t("of")} 3, ${offer.cost} ${t("gold")}`}
                  disabled={game.phase !== "planning" || game.gold < offer.cost}
                  onClick={() => handleBuy(offer.id)}
                >
                  <HeroArt heroId={hero.id} className={`shop-art rarity-${hero.rarity}`}><small className="shop-rarity">{localizeRarity(locale, hero.rarity)}</small></HeroArt>
                  <span className="shop-meta"><strong className="shop-name">{localizeHero(locale, hero.id).name}</strong><span className="shop-traits">{hero.traits.map((trait) => localizeTrait(locale, trait).name).join(" · ")}</span><small>{localizeRole(locale, hero.role).label} · {t("Range")} {ROLE_PROFILES[hero.role].range} · {t("Copies")} {copies}/3</small></span>
                  <span className="price">{offer.cost} {t("gold")}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="actions-panel" aria-label={t("Round actions")}>
          {game.phase === "planning" ? (
            <>
              <div className="income-line" data-testid="income-breakdown"><span>{t("Next income")}</span><strong>+{projectedIncome}</strong><small>5 {t("base")} + {interest} {t("interest")}{projectedStreak ? ` + ${projectedStreak} ${t("streak")}` : ""}</small></div>
              <button className="game-button button-secondary" type="button" data-testid="shop-refresh" disabled={game.gold < REFRESH_COST} onClick={() => commit(refreshShop(game))}>{t("Refresh shop")} · {REFRESH_COST}</button>
              <button className="game-button button-secondary" type="button" data-testid="shop-lock" onClick={() => commit(toggleShopLock(game))}>{t(game.shopLocked ? "Unlock shop" : "Lock shop")}</button>
              <button className="game-button button-secondary" type="button" data-testid="buy-xp" disabled={game.commanderLevel >= MAX_COMMANDER_LEVEL || game.gold < XP_BUY_COST} onClick={() => commit(buyPlayerXp(game))}>{t("Buy")} {XP_BUY_AMOUNT} XP · {XP_BUY_COST}</button>
              <button className="game-button button-primary" type="button" data-testid="begin-combat" onClick={handleBeginCombat}>{t("Begin battle")}</button>
            </>
          ) : game.phase === "combat" ? (
            <div className="combat-controls" data-testid="combat-controls">
              <div className="income-line"><span>{t("Combat time")}</span><strong>{formatCombatTime(currentCombatTime, locale)} / {formatCombatTime(totalCombatTime, locale)}</strong><small>{atCombatEnd ? `${t("Outcome ready")} · ${t("Moment")} ${combatMomentIndex + 1}/${combatMoments.length}` : `${t("Moment")} ${combatMomentIndex + 1}/${combatMoments.length} · ${currentMomentActionCount} ${t(currentMomentActionCount === 1 ? "action" : "actions")} · ${formatNumber(locale, speed, 1)}× ${t("playback")}`}</small></div>
              <button className="game-button button-secondary" type="button" data-testid="combat-play-pause" disabled={atCombatEnd} onClick={() => { setSteppedMomentKey(null); setPlaying((value) => !value); }}>{t(atCombatEnd ? "Complete" : playing ? "Pause" : "Play")}</button>
              <button className="game-button button-secondary" type="button" data-testid="combat-step" disabled={atCombatEnd} onClick={() => {
                const nextIndex = Math.min(combatMomentIndex + 1, combatMoments.length - 1);
                playbackMomentKeyRef.current = null;
                playbackRemainingSecondsRef.current = null;
                setPlaying(false);
                setSteppedMomentKey(combatMoments[nextIndex]?.key ?? null);
                setCombatClockSeconds(combatMoments[nextIndex]?.timestamp ?? currentCombatTime);
                setCombatMomentIndex(nextIndex);
              }}>{t("Next moment")}</button>
              <label className="speed-control">{t("Speed")}<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} data-testid="combat-speed"><option value={0.5}>{formatNumber(locale, 0.5, 1)}×</option><option value={1}>{formatNumber(locale, 1, 1)}×</option><option value={2}>{formatNumber(locale, 2, 1)}×</option></select></label>
              {!atCombatEnd ? <button className="game-button button-ghost" type="button" data-testid="combat-skip" onClick={() => { playbackMomentKeyRef.current = null; playbackRemainingSecondsRef.current = null; setSteppedMomentKey(null); setPlaying(false); setCombatClockSeconds(totalCombatTime); setCombatMomentIndex(combatMoments.length - 1); }}>{t("Skip to result")}</button> : <button className="game-button button-primary" type="button" onClick={() => commit(applyCombatResult(game))}>{t("Claim result")}</button>}
            </div>
          ) : (
            <div className="income-line"><span>{t("Round resolved")}</span><strong>{localizeOutcome(locale, game.roundResult?.outcome ?? "defeat")}</strong><small>{t("Review the result to continue")}</small></div>
          )}
        </section>
      </section>

      {game.phase === "resolution" && game.roundResult ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal modal-round-result" role="dialog" aria-modal="true" aria-labelledby="round-result-title" data-testid="round-result">
            <span className="eyebrow">{localizeText(locale, `Round ${game.roundResult.round} complete`)}</span>
            <h2 id="round-result-title">{t(game.roundResult.outcome === "victory" ? "The line holds." : "The line broke.")}</h2>
            <p>{localizeText(locale, game.roundResult.outcome === "victory" ? "Your bond outlasted Mooncrest." : `The commander lost ${Math.abs(game.roundResult.lifeDelta)} life, but the campaign continues.`)}</p>
            <div className="result-grid">
              <span><small>{t("Gold earned")}</small><strong>+{game.roundResult.goldEarned}</strong></span>
              <span><small>{t("Commander XP")}</small><strong>+{game.roundResult.commanderXp}</strong></span>
              <span><small>{t("Unit XP")}</small><strong>+{game.roundResult.outcome === "victory" ? 3 : 2}</strong></span>
              <span><small>{t("Streak")}</small><strong>{game.streak > 0 ? `+${game.streak}` : game.streak}</strong></span>
            </div>
            <p className="result-formula">{t("Income")}: {game.roundResult.income.base} {t("base")} + {game.roundResult.income.interest} {t("interest")} + {game.roundResult.income.streak} {t("streak")} + {game.roundResult.income.victory} {t("victory")}.</p>
            {combatStatistics ? <CombatBreakdown statistics={combatStatistics} locale={locale} /> : null}
            <div className="modal-actions"><button className="game-button button-primary" type="button" data-testid="continue-round" onClick={() => commit(advanceRound(game))}>{t("Continue to round")} {game.round + 1}</button></div>
          </section>
        </div>
      ) : null}

      {game.phase === "gameover" ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal modal-round-result" role="dialog" aria-modal="true" aria-labelledby="game-result-title" data-testid="game-result">
            <span className="eyebrow">{t("Campaign complete")}</span>
            <h2 id="game-result-title">{t(game.campaignOutcome === "victory" ? "HEXFALL answered your call." : "Mooncrest claims the arena.")}</h2>
            <p>{localizeText(locale, game.campaignOutcome === "victory" ? `You survived all ${game.round} rounds with ${game.life} commander life.` : `You reached round ${game.round}. Rebuild the bond and try a new formation.`)}</p>
            {combatStatistics ? <CombatBreakdown statistics={combatStatistics} locale={locale} /> : null}
            <div className="modal-actions"><button className="game-button button-primary" type="button" data-testid="restart-game" onClick={handleRestart}>{t("Play again")}</button></div>
          </section>
        </div>
      ) : null}

      <div className="toast" role="status" aria-live="polite" aria-atomic="true" data-testid="toast-region">{localizeText(locale, toast)}</div>
    </main>
  );
}
