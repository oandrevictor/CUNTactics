"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
import { Boitata3DLayer } from "./boitata-3d-layer";
import {
  BENCH_SIZE,
  BOARD_COLUMNS,
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
  buyPlayerXp,
  buyShopUnit,
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
  getStreakBonus,
  getUnitStats,
  moveUnit,
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
  shield: number;
  fireWallShield: number;
  stunned: number;
  alive: boolean;
};

type CombatEffectKind = "attack" | "ability" | "heal" | "shield";

function clampPercent(value: number, maximum: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.min(100, Math.max(0, (value / maximum) * 100));
}

function meterStyle(value: number, maximum: number): CSSProperties {
  return { "--meter-value": `${clampPercent(value, maximum)}%` } as CSSProperties;
}

function combatEffectKind(event: CombatEvent | null): CombatEffectKind | null {
  if (event?.type === "attack") return "attack";
  if (event?.type !== "ability") return null;
  const actor = event.actorId ? event.snapshot.find((unit) => unit.id === event.actorId) : null;
  if (actor?.heroId === "boitata") return "shield";
  return actor?.heroId === "tide" || actor?.heroId === "bramble" ? "heal" : "ability";
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
    shield: 0,
    fireWallShield: 0,
    stunned: 0,
    alive: true,
  };
}

function combatDisplay(unit: CombatUnit, persistent?: UnitInstance): DisplayUnit {
  return {
    ...unit,
    xp: persistent?.xp ?? 0,
    benchIndex: null,
    itemSlots: persistent?.itemSlots ?? [null, null, null],
  };
}

function phaseLabel(phase: GameState["phase"]): string {
  if (phase === "planning") return "Planning";
  if (phase === "combat") return "Combat";
  if (phase === "resolution") return "Round complete";
  return "Campaign complete";
}

function starsLabel(stars: number): string {
  return `${"★".repeat(stars)}${"☆".repeat(Math.max(0, 3 - stars))}`;
}

function craftedItemName(item: CraftedItem): string {
  const name = ITEM_DEFINITIONS[item.itemId].name;
  return item.tier === "enhanced" ? `Enhanced ${name}` : name;
}

function craftedItemBonusText(item: CraftedItem): string {
  const bonuses = getCraftedItemBonuses(item);
  return [
    bonuses.maxHp ? `+${bonuses.maxHp} HP` : null,
    bonuses.attack ? `+${bonuses.attack} damage` : null,
    bonuses.armor ? `+${bonuses.armor} armor` : null,
    bonuses.startingMana ? `+${bonuses.startingMana} starting mana` : null,
  ].filter(Boolean).join(" · ");
}

function targetCountText(values: AbilityValues): string {
  if (values.minTargets === values.maxTargets) return String(values.maxTargets);
  if (values.minTargets === 0) return `Up to ${values.maxTargets}`;
  return `${values.minTargets}–${values.maxTargets}`;
}

function abilityMetricDefinitions(preview: AbilityPreview): AbilityMetric[] {
  const damageLabel = preview.current.ignoresArmor ? "True damage" : "Raw damage";
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
      id: "healing",
      label: "Healing",
      kind: "healing",
      applies: (values) => values.healing > 0,
      format: (values) => String(values.healing),
    },
    {
      id: "shield",
      label: "Shield",
      kind: "shield",
      applies: (values) => values.shield > 0,
      format: (values) => String(values.shield),
    },
    {
      id: "targets",
      label: targetLabel[preview.current.heroId],
      kind: "targets",
      applies: (values) => values.maxTargets > 0,
      format: preview.current.heroId === "boitata" ? () => "Self" : targetCountText,
    },
    {
      id: "projectiles",
      label: "Projectiles",
      kind: "projectiles",
      applies: (values) => values.projectiles > 0,
      format: (values) => String(values.projectiles),
    },
    {
      id: "mana-drain",
      label: "Mana drain",
      kind: "mana-drain",
      applies: (values) => values.manaDrain > 0,
      format: (values) => String(values.manaDrain),
    },
    {
      id: "stun",
      label: "Stun",
      kind: "stun",
      applies: (values) => values.stunTurns > 0,
      format: (values) => `${values.stunTurns} ${values.stunTurns === 1 ? "turn" : "turns"}`,
    },
    {
      id: "self-heal",
      label: "Self-heal",
      kind: "self-heal",
      applies: (values) => values.selfHealPercent > 0,
      format: (values) => `${values.selfHealPercent}%`,
    },
    {
      id: "team-heal",
      label: "Team heal",
      kind: "team-heal",
      applies: (values) => values.teamHealing > 0,
      format: (values) => `${values.teamHealing} each`,
    },
  ];
}

function HeroArt({ heroId, className, children }: { heroId: HeroId; className: string; children?: ReactNode }) {
  const hero = HEROES[heroId];
  const style = hero.portrait ? { "--hero-art": `url("${hero.portrait}")` } as CSSProperties : undefined;
  return (
    <span className={`${className} ${hero.portrait ? "hero-art-image" : ""}`} style={style} aria-hidden="true">
      {hero.portrait ? null : hero.glyph}
      {children}
    </span>
  );
}

function UnitToken({
  unit,
  selected,
  highlighted,
  currentEvent,
  previousEvent,
  draggable,
  onDragStart,
  onDragEnd,
  loadoutDropStatus = null,
}: {
  unit: DisplayUnit;
  selected: boolean;
  highlighted: boolean;
  currentEvent: CombatEvent | null;
  previousEvent: CombatEvent | null;
  draggable: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
  loadoutDropStatus?: LoadoutDropStatus;
}) {
  const hero = HEROES[unit.heroId];
  const isCreatureToken = unit.heroId === "boitata";
  const isTarget = currentEvent?.targetIds?.includes(unit.id) ?? false;
  const effectKind = combatEffectKind(currentEvent);
  const eventActor = currentEvent?.actorId
    ? currentEvent.snapshot.find((candidate) => candidate.id === currentEvent.actorId) ?? null
    : null;
  const isSolStarfall = currentEvent?.type === "ability" && eventActor?.heroId === "sol";
  const isActor = !!effectKind && currentEvent?.actorId === unit.id;
  const isHealingAbility = effectKind === "heal";
  const isDamaged = isTarget && (effectKind === "attack" || effectKind === "ability");
  const isHealed = isTarget && effectKind === "heal";
  const isShielded = isTarget && effectKind === "shield";
  const previousUnit = previousEvent?.snapshot.find((candidate) => candidate.id === unit.id) ?? null;
  const shieldLost = Math.max(0, (previousUnit?.shield ?? 0) - unit.shield);
  const fireWallShieldLost = Math.max(0, (previousUnit?.fireWallShield ?? 0) - unit.fireWallShield);
  const healthLost = Math.max(0, (previousUnit?.hp ?? unit.hp) - unit.hp);
  const fireWallBroke = !!previousUnit && previousUnit.fireWallShield > 0 && unit.fireWallShield === 0;
  const hasFireWall = unit.heroId === "boitata" && (unit.fireWallShield > 0 || fireWallBroke || isShielded);
  const targetAmount = currentEvent?.amounts?.[unit.id] ?? currentEvent?.amount;
  const visibleDamage = previousUnit ? healthLost : targetAmount ?? 0;
  const feedback = isShielded && targetAmount
    ? `+${targetAmount} SHIELD`
    : isHealed && targetAmount
      ? `+${targetAmount}`
      : isDamaged && visibleDamage > 0
        ? `−${visibleDamage}`
        : null;
  const blockFeedback = shieldLost > 0 ? `BLOCK ${shieldLost}` : null;

  return (
    <div
      className={`unit-token ${isCreatureToken ? "unit-token-creature unit-token-boitata" : ""} ${unit.side === "player" ? "unit-ally" : "unit-enemy"} ${selected ? "unit-selected" : ""} ${highlighted ? "unit-trait-highlight" : ""} ${!unit.alive ? "unit-dead" : ""} ${isActor ? `unit-event-actor unit-event-actor-${effectKind}` : ""} ${isActor && isSolStarfall ? "unit-event-actor-sol" : ""} ${isDamaged ? "unit-impact-damage" : ""} ${isDamaged && isSolStarfall ? "unit-impact-starfall" : ""} ${isHealed ? "unit-impact-heal" : ""} ${isShielded ? "unit-impact-shield" : ""} ${shieldLost > 0 ? "unit-shield-absorbed" : ""} ${loadoutDropStatus ? `unit-loadout-drop-${loadoutDropStatus}` : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-testid={`unit-${unit.id}`}
      data-unit-id={unit.id}
      data-hero-id={unit.heroId}
    >
      <span className="unit-stars" data-testid={`unit-stars-${unit.id}`} aria-label={`${unit.stars} star`}>{starsLabel(unit.stars)}</span>
      <HeroArt heroId={unit.heroId} className="unit-avatar" />
      {hasFireWall ? <span className={`fire-wall ${isShielded ? "fire-wall-cast" : ""} ${fireWallShieldLost > 0 ? "fire-wall-absorb" : ""} ${fireWallBroke ? "fire-wall-break" : ""}`} aria-hidden="true" /> : null}
      <span className="unit-level">L{unit.level}</span>
      <span className="unit-item-pips" data-testid={`unit-item-slots-${unit.id}`} aria-hidden="true">
        {unit.itemSlots.map((item, index) => (
          <span className={`unit-item-pip ${item ? `unit-item-pip-${item.tier}` : "unit-item-pip-empty"}`} key={index}>{item ? item.tier === "enhanced" ? "✦" : "◆" : ""}</span>
        ))}
      </span>
      <span className="unit-name">{hero.name}</span>
      {isActor ? <span className="combat-role" aria-hidden="true">{isSolStarfall ? "STARFALL" : effectKind === "shield" ? "WALL" : currentEvent?.type === "ability" ? "CAST" : "ATTACK"}</span> : null}
      <span className="unit-bars">
        <span
          className="meter meter-life"
          style={meterStyle(unit.hp + unit.shield, unit.maxHp + Math.max(0, unit.shield))}
          data-testid={`unit-hp-${unit.id}`}
          aria-label={`${hero.name} health ${Math.round(unit.hp)} of ${unit.maxHp}${unit.shield ? `, shield ${unit.shield}` : ""}`}
        ><span className="meter-fill" /></span>
        <span
          className="meter meter-mana"
          style={meterStyle(unit.mana, unit.maxMana)}
          data-testid={`unit-mana-${unit.id}`}
          aria-label={`${hero.name} mana ${Math.round(unit.mana)} of ${unit.maxMana}`}
        ><span className="meter-fill" /></span>
      </span>
      {unit.stunned > 0 ? <span className="status-mark" aria-label="Silenced">×</span> : null}
      {feedback ? <span className={`floating-text ${isHealingAbility ? "floating-heal" : isShielded ? "floating-shield" : "floating-damage"} ${isDamaged && isSolStarfall ? "floating-starfall" : ""}`}>{feedback}</span> : null}
      {blockFeedback ? <span className="floating-text floating-block">{blockFeedback}</span> : null}
    </div>
  );
}

function CombatTeamReport({
  side,
  statistics,
}: {
  side: "player" | "enemy";
  statistics: CombatStatistics;
}) {
  const label = side === "player" ? "Your team" : "Mooncrest";
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
        <span>{units.length} {units.length === 1 ? "champion" : "champions"}</span>
      </div>
      <dl className="combat-team-totals">
        <div className="combat-total combat-total-damage">
          <dt>Damage dealt</dt>
          <dd data-testid={`combat-total-${side}-damage`}>{totals.damageDealt}</dd>
        </div>
        <div className="combat-total combat-total-shield">
          <dt>Shield granted</dt>
          <dd data-testid={`combat-total-${side}-shield`}>{totals.shieldGranted}</dd>
        </div>
        <div className="combat-total combat-total-healing">
          <dt>Effective healing</dt>
          <dd data-testid={`combat-total-${side}-healing`}>{totals.healingDone}</dd>
        </div>
      </dl>
      <div className="combat-stat-scroll">
        <table className="combat-stat-table">
          <caption className="sr-only">{label} character combat contributions</caption>
          <thead>
            <tr><th scope="col">Character</th><th scope="col">Damage</th><th scope="col">Shield</th><th scope="col">Healing</th></tr>
          </thead>
          <tbody>
            {units.map((unit) => (
              <tr key={unit.unitId} data-testid={`combat-stat-${unit.unitId}`}>
                <th scope="row">
                  <span className="combat-stat-unit">
                    <HeroArt heroId={unit.heroId} className="combat-stat-portrait" />
                    <span className="combat-stat-copy"><strong>{HEROES[unit.heroId].name}</strong><small>L{unit.level} · {starsLabel(unit.stars)}</small></span>
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

function CombatBreakdown({ statistics }: { statistics: CombatStatistics }) {
  return (
    <section className="combat-breakdown" data-testid="combat-breakdown" aria-labelledby="combat-breakdown-title">
      <div className="combat-breakdown-heading">
        <div><span className="eyebrow">Match report</span><h3 id="combat-breakdown-title">Combat breakdown</h3></div>
        <p>Damage includes health and shields removed. Shield measures protection granted. Healing counts life actually restored.</p>
      </div>
      <div className="combat-team-grid">
        <CombatTeamReport side="player" statistics={statistics} />
        <CombatTeamReport side="enemy" statistics={statistics} />
      </div>
    </section>
  );
}

export function GameClient() {
  const [game, setGame] = useState<GameState>(() => createInitialGame());
  const [hydrated, setHydrated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedTrait, setHighlightedTrait] = useState<TraitId | null>(null);
  const [toast, setToast] = useState("Welcome to HEXFALL. Set your formation, then begin battle.");
  const [combatIndex, setCombatIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [boardHeightRatio, setBoardHeightRatio] = useState(DESKTOP_BOARD_HEIGHT_RATIO);
  const [boitata3DReady, setBoitata3DReady] = useState(false);
  const [tutorialStage, setTutorialStage] = useState(0);
  const [tutorialVisible, setTutorialVisible] = useState(true);
  const [forgeComponents, setForgeComponents] = useState<ItemComponentId[]>([]);
  const [selectedCraftedItemId, setSelectedCraftedItemId] = useState<string | null>(null);
  const [draggedLoadout, setDraggedLoadout] = useState<LoadoutDrag | null>(null);
  const [draggedUnitId, setDraggedUnitId] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
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
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const mobileBoard = window.matchMedia("(max-width: 600px)");
    const syncBoardRatio = () => setBoardHeightRatio(mobileBoard.matches ? MOBILE_BOARD_HEIGHT_RATIO : DESKTOP_BOARD_HEIGHT_RATIO);
    syncBoardRatio();
    mobileBoard.addEventListener("change", syncBoardRatio);
    return () => mobileBoard.removeEventListener("change", syncBoardRatio);
  }, []);

  const combatEvents = game.combatReport?.events ?? [];
  const currentEvent = game.phase === "combat" ? combatEvents[Math.min(combatIndex, Math.max(0, combatEvents.length - 1))] ?? null : null;
  const previousEvent = game.phase === "combat" && combatIndex > 0 ? combatEvents[combatIndex - 1] ?? null : null;
  const atCombatEnd = game.phase === "combat" && combatEvents.length > 0 && combatIndex >= combatEvents.length - 1;
  const currentEffectKind = combatEffectKind(currentEvent);

  useEffect(() => {
    if (game.phase !== "combat" || !playing || atCombatEnd) return;
    const timeout = window.setTimeout(
      () => setCombatIndex((index) => Math.min(index + 1, combatEvents.length - 1)),
      Math.round(820 / speed),
    );
    return () => window.clearTimeout(timeout);
  }, [game.phase, playing, atCombatEnd, combatEvents.length, speed, combatIndex]);

  useEffect(() => {
    const handleKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isFormControl = target?.matches("input, select, textarea, button");
      if (event.key === "Escape") {
        setSelectedId(null);
        setHighlightedTrait(null);
      }
      if (game.phase === "combat" && !isFormControl && event.code === "Space") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
      if (game.phase === "combat" && !isFormControl && event.key === "ArrowRight") {
        event.preventDefault();
        setPlaying(false);
        setCombatIndex((index) => Math.min(index + 1, combatEvents.length - 1));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [game.phase, combatEvents.length]);

  const displayUnits = useMemo<DisplayUnit[]>(() => {
    if (game.phase === "combat" && currentEvent) {
      const persistent = new Map([...game.units, ...game.enemyUnits].map((unit) => [unit.id, unit]));
      return currentEvent.snapshot.map((unit) => combatDisplay(unit, persistent.get(unit.id)));
    }
    return [...game.units, ...game.enemyUnits].map(persistentDisplay);
  }, [game.phase, game.units, game.enemyUnits, currentEvent]);

  const boardUnits = displayUnits.filter((unit) => unit.position !== null);
  const boitataBoardUnits = boardUnits.filter((unit) => unit.heroId === "boitata");
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
  const selectedRole = selectedHero ? ROLE_PROFILES[selectedHero.role] : null;
  const selectedTeamUnits = selectedPersistent
    ? selectedPersistent.side === "player" ? game.units : game.enemyUnits
    : [];
  const abilityPreview = selectedPersistent
    ? getAbilityPreview(selectedPersistent, selectedTeamUnits)
    : null;
  const selectedAbilityMetrics = abilityPreview
    ? abilityMetricDefinitions(abilityPreview)
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
  const currentActor = currentEffectKind && currentEvent?.actorId
    ? currentEvent.snapshot.find((unit) => unit.id === currentEvent.actorId) ?? null
    : null;
  const combatLinks = currentActor && currentEvent?.targetIds
    ? currentEvent.targetIds.flatMap((targetId) => {
        const target = currentEvent.snapshot.find((unit) => unit.id === targetId);
        if (!target || target.position === currentActor.position) return [];
        return [{ targetId, style: combatLinkStyle(currentActor.position, target.position, boardHeightRatio) }];
      })
    : [];
  const isSolStarfall = currentEvent?.type === "ability" && currentActor?.heroId === "sol";
  const solStarfallTargets = isSolStarfall && currentEvent?.targetIds
    ? currentEvent.targetIds.flatMap((targetId) => {
        const target = currentEvent.snapshot.find((unit) => unit.id === targetId);
        return target ? [target] : [];
      })
    : [];
  const solStarfallStyle = isSolStarfall && currentActor && solStarfallTargets.length
    ? starfallClusterStyle(
        currentActor.position,
        solStarfallTargets.map((target) => target.position),
        boardHeightRatio,
      )
    : undefined;
  const combatBeatStyle = { "--combat-beat": `${Math.round(680 / speed)}ms` } as CSSProperties;
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
      setCombatIndex(0);
      setPlaying(true);
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
    setBoitata3DReady(false);
    setCombatIndex(0);
    setPlaying(false);
    setToast("A new campaign begins.");
  }

  const selectedUnitXpMax = selectedPersistent ? unitXpToNext(selectedPersistent.level) : 0;
  const selectedCopies = selectedPersistent ? getCopyCount(game, selectedPersistent.heroId, selectedPersistent.stars) : 0;

  return (
    <main className="game-shell" data-testid="game-screen">
      <header className="game-topbar">
        <div className="brand-lockup">
          <span className="brand-name">HEXFALL</span>
          <span className="brand-kicker">Build your bond. Break their line.</span>
        </div>
        <div className="stage-block">
          <span className="stage-label">{phaseLabel(game.phase)}</span>
          <strong className="stage-value" data-testid="round-label">Round {game.round}</strong>
        </div>
        <div className="player-hud">
          <div className="hud-stat">
            <span className="hud-icon" aria-hidden="true">♥</span>
            <span className="hud-copy"><strong className="hud-value" data-testid="player-life">{game.life}</strong><span className="hud-label">Commander life</span></span>
          </div>
          <div className="hud-stat">
            <span className="hud-icon" aria-hidden="true">III</span>
            <span className="hud-copy">
              <strong className="hud-value" data-testid="player-level">Level {game.commanderLevel}</strong>
              <span className="hud-label" data-testid="player-xp">XP {game.commanderXp}/{commanderXpMaximum || "MAX"}</span>
              <span className="mini-meter" style={meterStyle(game.commanderXp, commanderXpMaximum)}><span className="mini-meter-fill" /></span>
            </span>
          </div>
          <div className="hud-stat">
            <span className="hud-icon" aria-hidden="true">●</span>
            <span className="hud-copy"><strong className="hud-value" data-testid="player-gold">{game.gold} gold</strong><span className="hud-label">+{interest} interest</span></span>
          </div>
          <button className="game-button button-ghost help-button" type="button" onClick={() => { setTutorialStage(0); setTutorialVisible(true); }}>How to play</button>
        </div>
      </header>

      {tutorialVisible ? (
        <section className="status-banner" data-testid={`tutorial-step-${tutorialStage}`} aria-label="Tutorial">
          <span className="eyebrow">First battle · Step {tutorialStage + 1} of 3</span>
          <strong>{tutorialStage === 0 ? "Recruit a hero from the Night Market." : tutorialStage === 1 ? "Drag an ally to a teal tile or the bench to move or swap." : "When your formation is ready, begin battle."}</strong>
          <button className="game-button button-ghost" type="button" data-testid="tutorial-skip" onClick={finishTutorial}>Skip tutorial</button>
        </section>
      ) : null}

      <section className="workspace">
        <aside className="panel traits-panel" aria-label="Active traits">
          <div className="panel-heading">
            <div><span className="eyebrow">Formation</span><h2 className="panel-title">Active bonds</h2></div>
            <span className="panel-meta" data-testid="team-cap">{deployedCount}/{commanderCap}</span>
          </div>
          <div className="trait-list">
            {traits.map((trait) => {
              const definition = TRAITS[trait.id];
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
                  <span className="trait-copy"><strong className="trait-name">{definition.name}</strong><span className="trait-effect" data-testid={`trait-detail-${trait.id}`}>{trait.activeEffect}</span></span>
                  <span className="trait-count" data-testid={`trait-count-${trait.id}`}>{trait.count}/{threshold}</span>
                </button>
              );
            })}
          </div>
          <div className="tactical-note">
            <span className="eyebrow">Tactical note</span>
            <p>Vanguards harden the whole team. Invokers accelerate the first cast. Select a bond to reveal its champions.</p>
          </div>
        </aside>

        <section className="board-section" aria-labelledby="board-title">
          <div className="board-header">
            <div className="board-copy">
              <span className="eyebrow">Mooncrest arena</span>
              <h1 className="board-title" id="board-title">Hold the lower line</h1>
            </div>
            <span className={`phase-chip phase-${game.phase}`} data-testid="phase-label">{phaseLabel(game.phase)}</span>
          </div>
          <div className="board-wrap">
            <div className="territory-label territory-enemy">Enemy territory</div>
            <div className="arena-plane">
              <div className={`board-grid ${boitata3DReady ? "boitata-3d-ready" : ""}`} role="grid" aria-label="Eight column by six row battle board" data-testid="game-board" style={combatBeatStyle}>
              {currentEffectKind && combatLinks.length && !isSolStarfall ? (
                <div className="combat-links" aria-hidden="true" data-testid="combat-links">
                  {combatLinks.map((link) => (
                    <span
                      className={`combat-link combat-link-${currentEffectKind}`}
                      key={`${currentEvent?.id}-${link.targetId}`}
                      style={link.style}
                    />
                  ))}
                </div>
              ) : null}
              {isSolStarfall && solStarfallTargets.length ? (
                <div className="sol-starfall-layer" aria-hidden="true" data-testid="sol-starfall-layer" key={currentEvent?.id} style={solStarfallStyle}>
                  <span className="sol-starfall-sky" />
                  <span className="sol-starfall-trail"><i /></span>
                  <span className="sol-starfall-sigil">
                    <span className="sol-starfall-sigil-core">✦</span>
                    <span className="sol-starfall-sigil-ring" />
                    <span className="sol-starfall-sigil-rays" />
                  </span>
                  {solStarfallTargets.map((target, index) => (
                    <span
                      className="sol-starfall-hit"
                      data-testid={`sol-starfall-target-${target.id}`}
                      key={target.id}
                      style={starfallImpactStyle(target.position, index, speed)}
                    >
                      <span className="sol-starfall-hit-star">✦</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {Array.from({ length: BOARD_SIZE }, (_, index) => {
                const row = Math.floor(index / BOARD_COLUMNS);
                const column = index % BOARD_COLUMNS;
                const unit = boardUnits.find((candidate) => candidate.position === index) ?? null;
                const draggedAlly = draggedUnitId ? game.units.find((candidate) => candidate.id === draggedUnitId) : null;
                const playerCell = row >= PLAYER_START_ROW;
                const valid = game.phase === "planning" && !!draggedAlly && playerCell;
                const highlighted = !!unit && !!highlightedTrait && HEROES[unit.heroId].traits.includes(highlightedTrait);
                const loadoutDropStatus = unit ? loadoutDropStatusFor(unit) : null;
                const aria = `Row ${row + 1}, column ${column + 1}, ${playerCell ? "player" : "enemy"} territory${unit ? `, ${HEROES[unit.heroId].name}, ${ROLE_PROFILES[HEROES[unit.heroId].role].label}, range ${unit.range}, level ${unit.level}, ${Math.round(clampPercent(unit.hp, unit.maxHp))} percent health${unit.shield > 0 ? `, ${Math.round(unit.shield)} shield` : ""}` : ", empty"}`;
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
                        key={`${unit.id}-${currentEvent?.id ?? "idle"}`}
                        unit={unit}
                        selected={unit.id === selectedId}
                        highlighted={highlighted}
                        currentEvent={currentEvent}
                        previousEvent={previousEvent}
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
                    currentEvent={currentEvent}
                    previousEvent={previousEvent}
                    phase={game.phase}
                    playing={playing}
                    speed={speed}
                    boardHeightRatio={boardHeightRatio}
                    onReady={() => setBoitata3DReady(true)}
                    onFallback={() => setBoitata3DReady(false)}
                  />
                ) : null}
              </div>
              <section className="arena-bench" aria-labelledby="bench-title" data-testid="bench">
                <div className="arena-bench-rail">
                  <span className="arena-bench-territory">Your territory · {deployedCount}/{commanderCap} deployed</span>
                  <h2 id="bench-title">Bench</h2>
                  <span className="arena-bench-count">{benchUnits.length}/{BENCH_SIZE} reserves</span>
                </div>
                <div className="bench-grid">
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
                        aria-label={display ? `Bench slot ${index + 1}, ${HEROES[display.heroId].name}, ${ROLE_PROFILES[HEROES[display.heroId].role].label}, range ${display.range}` : `Bench slot ${index + 1}, empty`}
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
                            selected={display.id === selectedId}
                            highlighted={!!highlightedTrait && HEROES[display.heroId].traits.includes(highlightedTrait)}
                            currentEvent={null}
                            previousEvent={null}
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
          </div>
          {game.phase === "combat" && currentEvent ? (
            <div className="combat-caption" aria-live="polite">
              <span>{String(combatIndex + 1).padStart(2, "0")}/{String(combatEvents.length).padStart(2, "0")}</span>
              <strong>{currentEvent.text}</strong>
            </div>
          ) : (
            <p className="placement-hint">Click any character to inspect. Drag allies between teal tiles and the bench to place or swap.</p>
          )}
        </section>

        <aside className="panel enemy-panel" aria-label={selectedDisplay ? "Unit inspector" : "Enemy scout report"}>
          {selectedDisplay && selectedHero ? (
            <section className="selected-panel" data-testid="unit-inspector">
              <div className="selected-head">
                <HeroArt heroId={selectedHero.id} className={`enemy-portrait ${selectedDisplay.side === "player" ? "portrait-ally" : ""}`} />
                <div><span className="eyebrow">{selectedDisplay.side === "player" ? "Your champion" : "Enemy champion"}</span><h2 className="panel-title">{selectedHero.name}</h2><p>{selectedHero.title}</p></div>
              </div>
              <div className="rank-line">
                <span data-testid={`unit-stars-${selectedDisplay.id}`}>{starsLabel(selectedDisplay.stars)}</span>
                <span>Unit level {selectedDisplay.level}</span>
              </div>
              <div className="unit-xp-block" data-testid={`unit-xp-${selectedDisplay.id}`}>
                <span>XP {selectedPersistent?.xp ?? 0}/{selectedUnitXpMax || "MAX"}</span>
                <span className="meter meter-xp" style={meterStyle(selectedPersistent?.xp ?? 0, selectedUnitXpMax)}><span className="meter-fill" /></span>
              </div>
              <div className="stat-grid">
                <span className="stat-cell"><small>HP</small><strong>{Math.round(selectedDisplay.hp)}/{selectedDisplay.maxHp}</strong></span>
                <span className="stat-cell"><small>Mana</small><strong>{Math.round(selectedDisplay.mana)}/{selectedDisplay.maxMana}</strong></span>
                <span className="stat-cell"><small>Damage</small><strong>{selectedDisplay.attack}</strong></span>
                <span className="stat-cell"><small>Armor</small><strong>{selectedDisplay.armor}</strong></span>
                {selectedHero.id === "boitata" ? (
                  <>
                    <span className="stat-cell stat-cell-shield" data-testid={`unit-fire-wall-shield-${selectedDisplay.id}`}><small>Wall of Fire</small><strong>{Math.round(selectedDisplay.fireWallShield)}</strong></span>
                    {selectedDisplay.shield > selectedDisplay.fireWallShield ? (
                      <span className="stat-cell stat-cell-shield"><small>Other shields</small><strong>{Math.round(selectedDisplay.shield - selectedDisplay.fireWallShield)}</strong></span>
                    ) : null}
                  </>
                ) : selectedDisplay.shield > 0 ? (
                  <span className="stat-cell stat-cell-shield" data-testid={`unit-shield-${selectedDisplay.id}`}><small>Shield</small><strong>{Math.round(selectedDisplay.shield)}</strong></span>
                ) : null}
              </div>
              <section className="equipment-block" data-testid={`unit-equipment-${selectedDisplay.id}`} aria-label={`${selectedHero.name} item slots`}>
                <div className="equipment-heading">
                  <span><small>Equipment</small><strong>Item slots</strong></span>
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
                          ? `${craftedItemName(item)}, ${craftedItemBonusText(item)}${canUnequip ? ", click to unequip" : ""}`
                          : `Empty item slot ${slotIndex + 1}${canEquip ? `, equip ${craftedItemName(selectedCraftedItem!)}` : ""}`}
                      >
                        <span className="item-mark" aria-hidden="true">
                          {definition ? definition.recipe.map((componentId) => ITEM_COMPONENTS[componentId].glyph).join("") : "+"}
                          {item?.enhancement ? <i>{ITEM_COMPONENTS[item.enhancement].glyph}</i> : null}
                        </span>
                        <span className="equipment-slot-copy">
                          <strong>{item ? craftedItemName(item) : `Slot ${slotIndex + 1}`}</strong>
                          <small>{item ? craftedItemBonusText(item) : canEquip ? "Equip selected item" : "Empty"}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
              {selectedRole ? (
                <div className={`role-range-card role-${selectedRole.id}`} data-testid={`unit-role-range-${selectedDisplay.id}`}>
                  <span className="role-range-copy">
                    <small>Combat role · Basic attack range</small>
                    <strong>{selectedRole.label}</strong>
                    <p>{selectedRole.description}</p>
                  </span>
                  <span className="range-readout">
                    <strong>{selectedDisplay.range}</strong>
                    <small>{selectedDisplay.range === 1 ? "tile" : "tiles"}</small>
                  </span>
                </div>
              ) : null}
              {abilityPreview ? (
                <details className="ability-box ability-card" data-testid={`ability-${selectedHero.ability.id}`}>
                  <summary className="ability-summary">
                    <span className="ability-heading">
                      <span>
                        <span className="eyebrow">Ability · {selectedHero.ability.manaCost} mana</span>
                        <strong className="ability-name" id={`ability-name-${selectedHero.ability.id}`}>{selectedHero.ability.name}</strong>
                      </span>
                      <span className="ability-rank">Current · {"★".repeat(abilityPreview.current.stars)}</span>
                    </span>
                    <span className="ability-description">{selectedHero.ability.description}</span>
                    <span
                      className="ability-current-values"
                      data-testid={`ability-current-values-${selectedHero.ability.id}`}
                      role="list"
                      aria-label={`${selectedHero.ability.name} current values`}
                    >
                      {currentAbilityMetrics.map((metric) => (
                        <span className={`ability-value ability-value-${metric.kind}`} role="listitem" key={metric.id}>
                          <small>{metric.label}</small>
                          <strong>{metric.format(abilityPreview.current)}</strong>
                        </span>
                      ))}
                    </span>
                    <span className="ability-target-rule">Targets: {selectedHero.ability.targetRule}</span>
                    <span className="ability-disclosure" aria-hidden="true">Hover or tap for star scaling</span>
                  </summary>
                  <div className="ability-breakdown" aria-labelledby={`ability-name-${selectedHero.ability.id}`}>
                    <div className="ability-breakdown-heading">
                      <strong>Star scaling</strong>
                      <small>Same level, equipment, and bonds</small>
                    </div>
                    <p className="ability-scale-copy">{abilityPreview.scalingDescription}</p>
                    <table className="ability-scale-table" data-testid={`ability-scaling-${selectedHero.ability.id}`}>
                      <caption className="sr-only">{selectedHero.ability.name} values by star level</caption>
                      <thead>
                        <tr>
                          <th scope="col">Value</th>
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
                      <div className="ability-modifiers" aria-label="Included ability modifiers">
                        <span className="ability-modifier-label">Included</span>
                        {abilityPreview.modifiers.map((modifier) => (
                          <span
                            className={`ability-modifier ${modifier.startsWith("Item ·") ? "ability-modifier-item" : modifier.startsWith("Bond ·") ? "ability-modifier-bond" : ""}`}
                            key={modifier}
                          >
                            {modifier}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {abilityPreview.contextNote ? <p className="ability-context-note">{abilityPreview.contextNote}</p> : null}
                  </div>
                </details>
              ) : null}
              <div className="trait-chips">{selectedHero.traits.map((trait) => <span key={trait}>{TRAITS[trait].glyph} {TRAITS[trait].name}</span>)}</div>
              {selectedPersistent?.side === "player" ? <p className="copy-progress">Copies toward next star: {selectedCopies}/3</p> : null}
              {selectedPersistent?.side === "player" && game.phase === "planning" ? (
                <button className="game-button button-danger" type="button" onClick={() => {
                  commit(sellUnit(game, selectedPersistent.id), () => {
                    if (selectedPersistent.heroId === "boitata") setBoitata3DReady(false);
                    setSelectedId(null);
                  });
                }}>Sell for {HEROES[selectedPersistent.heroId].cost * (selectedPersistent.stars === 3 ? 9 : selectedPersistent.stars === 2 ? 3 : 1)} gold</button>
              ) : null}
            </section>
          ) : game.phase === "combat" ? (
            <section className="combat-log" data-testid="combat-log">
              <div className="panel-heading"><div><span className="eyebrow">Live chronicle</span><h2 className="panel-title">Combat log</h2></div></div>
              <div className="log-list">
                {combatEvents.slice(Math.max(0, combatIndex - 5), combatIndex + 1).map((event) => (
                  <p className={`log-entry log-${event.type}`} key={event.id} data-testid={`combat-event-${event.id}`}><span className="log-time">T{event.turn}</span>{event.text}</p>
                ))}
              </div>
            </section>
          ) : (
            <section>
              <div className="panel-heading"><div><span className="eyebrow">Scout report</span><h2 className="panel-title">Mooncrest</h2></div><span className="panel-meta">{game.enemyUnits.length} units</span></div>
              <div className="enemy-list">
                {game.enemyUnits.map((unit) => {
                  const hero = HEROES[unit.heroId];
                  const stats = getUnitStats(unit);
                  return (
                    <button className="enemy-card" type="button" key={unit.id} onClick={() => setSelectedId(unit.id)}>
                      <HeroArt heroId={hero.id} className="enemy-portrait" />
                      <span className="enemy-copy"><strong>{hero.name}</strong><small>{ROLE_PROFILES[hero.role].label} · Range {stats.range} · L{unit.level} · {starsLabel(unit.stars)}</small></span>
                      <span className="enemy-threat">HP {stats.maxHp}</span>
                    </button>
                  );
                })}
              </div>
              <div className="scout-note"><span className="eyebrow">Read their line</span><p>Coral champions begin above the center. Inspect any unit to learn its range, defenses, and casting rule.</p></div>
            </section>
          )}
        </aside>
      </section>

      <section className="dock">
        <section className="panel item-armory-panel" aria-label="Relic Forge" data-testid="item-armory">
          <div className="panel-heading">
            <div><span className="eyebrow">Components & gear</span><h2 className="panel-title">Relic Forge</h2></div>
            <span className="panel-meta">{componentCount} parts · {game.craftedItemInventory.length} gear</span>
          </div>
          <p className="armory-cadence">A component arrives when rounds 2, 4, 6, 8, and 10 begin. Combine two for gear. Drag gear onto a champion to equip it, or drag a component onto a champion with full gear to enhance it.</p>
          {game.roundResult?.itemComponentReward ? (
            <div className="armory-reward" data-testid="round-item-reward">
              <span>{ITEM_COMPONENTS[game.roundResult.itemComponentReward].glyph}</span>
              <small>New component</small>
              <strong>{ITEM_COMPONENTS[game.roundResult.itemComponentReward].name}</strong>
            </div>
          ) : null}
          <div className="component-grid" aria-label="Item components">
            {ITEM_COMPONENT_IDS.map((componentId) => {
              const component = ITEM_COMPONENTS[componentId];
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
                  aria-label={`Add ${component.name} to forge, or drag it onto a champion to enhance equipped full gear, ${available} available${selectedCount ? `, ${selectedCount} selected` : ""}`}
                >
                  <span className="item-component-glyph" aria-hidden="true">{component.glyph}</span>
                  <span><strong>{component.name}</strong><small>{component.description}</small></span>
                  <b data-testid={`item-component-count-${componentId}`}>×{available}</b>
                </button>
              );
            })}
          </div>
          <div className="craft-tray" aria-label="Crafting tray">
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
                  aria-label={componentId ? `Remove ${ITEM_COMPONENTS[componentId].name} from forge` : `Empty craft slot ${index + 1}`}
                >
                  {componentId ? <><span>{ITEM_COMPONENTS[componentId].glyph}</span><small>{ITEM_COMPONENTS[componentId].name}</small></> : <><span>+</span><small>Component</small></>}
                </button>
              );
            })}
            <div className="craft-preview" data-testid="item-craft-preview">
              <small>{forgeRecipe ? "Recipe ready" : forgeComponents.length ? "Choose one more" : "Crafting tray"}</small>
              <strong>{forgeRecipe?.name ?? "2 components → full item"}</strong>
            </div>
            <button className="game-button button-secondary" type="button" data-testid="craft-item" disabled={game.phase !== "planning" || !forgeRecipe} onClick={handleCraftItem}>Craft full item</button>
          </div>
          <div className="crafted-inventory-heading">
            <span><small>Inventory</small><strong>Crafted gear</strong></span>
            <small>{selectedAllyForItems ? `Equipping ${HEROES[selectedAllyForItems.heroId].name}` : "Select an allied champion to equip"}</small>
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
                  <span><strong>{craftedItemName(item)}</strong><small>{craftedItemBonusText(item)}</small></span>
                  <b className={`item-tier ${item.tier === "enhanced" ? "item-tier-enhanced" : ""}`}>{item.tier}</b>
                </button>
              );
            }) : <p className="armory-empty">Your first full item can be forged after collecting two components.</p>}
          </div>
          {selectedCraftedItem ? (
            <div className="item-action-row">
              <button className="game-button button-secondary" type="button" data-testid={`equip-item-${selectedCraftedItem.id}`} disabled={game.phase !== "planning" || !selectedAllyForItems || selectedAllyForItems.itemSlots.every(Boolean)} onClick={() => handleEquipItem()}>Equip{selectedAllyForItems ? ` to ${HEROES[selectedAllyForItems.heroId].name}` : " selected champion"}</button>
              <button className="game-button button-primary" type="button" data-testid={`enhance-item-${selectedCraftedItem.id}`} disabled={game.phase !== "planning" || selectedCraftedItem.tier === "enhanced" || forgeComponents.length !== 1} onClick={handleEnhanceItem}>Enhance with 1 component</button>
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
                Enhance {selectedAllyForItems ? `${HEROES[selectedAllyForItems.heroId].name}'s full gear` : "selected champion's gear"}
              </button>
            </div>
          ) : null}
        </section>

        <section className="panel shop-panel" aria-label="Night Market" data-testid="shop">
          <div className="panel-heading"><div><span className="eyebrow">Recruitment</span><h2 className="panel-title">Night Market</h2></div><span className="panel-meta">{game.shopLocked ? "Locked" : "Refreshes next round"}</span></div>
          <div className="shop-grid">
            {game.shop.map((offer, index) => {
              if (!offer) return <div className="shop-card shop-card-empty" key={`empty-${index}`}><span>Sold</span></div>;
              const hero = HEROES[offer.heroId];
              const copies = getCopyCount(game, offer.heroId, 1);
              return (
                <button
                  className="shop-card"
                  type="button"
                  key={offer.id}
                  data-testid={`buy-offer-${offer.id}`}
                  aria-label={`Recruit ${hero.name}, ${hero.rarity} ${ROLE_PROFILES[hero.role].label}, ${hero.traits.map((trait) => TRAITS[trait].name).join(" and ")}, range ${ROLE_PROFILES[hero.role].range}, copies ${copies} of 3, ${offer.cost} gold`}
                  disabled={game.phase !== "planning" || game.gold < offer.cost}
                  onClick={() => handleBuy(offer.id)}
                >
                  <HeroArt heroId={hero.id} className={`shop-art rarity-${hero.rarity}`}><small className="shop-rarity">{hero.rarity}</small></HeroArt>
                  <span className="shop-meta"><strong className="shop-name">{hero.name}</strong><span className="shop-traits">{hero.traits.map((trait) => TRAITS[trait].name).join(" · ")}</span><small>{ROLE_PROFILES[hero.role].label} · Range {ROLE_PROFILES[hero.role].range} · Copies {copies}/3</small></span>
                  <span className="price">{offer.cost} gold</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="actions-panel" aria-label="Round actions">
          {game.phase === "planning" ? (
            <>
              <div className="income-line" data-testid="income-breakdown"><span>Next income</span><strong>+{projectedIncome}</strong><small>5 base + {interest} interest{projectedStreak ? ` + ${projectedStreak} streak` : ""}</small></div>
              <button className="game-button button-secondary" type="button" data-testid="shop-refresh" disabled={game.gold < REFRESH_COST} onClick={() => commit(refreshShop(game))}>Refresh shop · {REFRESH_COST}</button>
              <button className="game-button button-secondary" type="button" data-testid="shop-lock" onClick={() => commit(toggleShopLock(game))}>{game.shopLocked ? "Unlock shop" : "Lock shop"}</button>
              <button className="game-button button-secondary" type="button" data-testid="buy-xp" disabled={game.commanderLevel >= MAX_COMMANDER_LEVEL || game.gold < XP_BUY_COST} onClick={() => commit(buyPlayerXp(game))}>Buy {XP_BUY_AMOUNT} XP · {XP_BUY_COST}</button>
              <button className="game-button button-primary" type="button" data-testid="begin-combat" onClick={handleBeginCombat}>Begin battle</button>
            </>
          ) : game.phase === "combat" ? (
            <div className="combat-controls" data-testid="combat-controls">
              <div className="income-line"><span>Combat turn</span><strong>{combatIndex + 1}/{combatEvents.length}</strong><small>{atCombatEnd ? "Outcome ready" : `${speed}× playback`}</small></div>
              <button className="game-button button-secondary" type="button" data-testid="combat-play-pause" disabled={atCombatEnd} onClick={() => setPlaying((value) => !value)}>{atCombatEnd ? "Complete" : playing ? "Pause" : "Play"}</button>
              <button className="game-button button-secondary" type="button" data-testid="combat-step" disabled={atCombatEnd} onClick={() => { setPlaying(false); setCombatIndex((index) => Math.min(index + 1, combatEvents.length - 1)); }}>Step</button>
              <label className="speed-control">Speed<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} data-testid="combat-speed"><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
              {!atCombatEnd ? <button className="game-button button-ghost" type="button" data-testid="combat-skip" onClick={() => { setPlaying(false); setCombatIndex(combatEvents.length - 1); }}>Skip to result</button> : <button className="game-button button-primary" type="button" onClick={() => commit(applyCombatResult(game))}>Claim result</button>}
            </div>
          ) : (
            <div className="income-line"><span>Round resolved</span><strong>{game.roundResult?.outcome === "victory" ? "Victory" : "Defeat"}</strong><small>Review the result to continue</small></div>
          )}
        </section>
      </section>

      {game.phase === "resolution" && game.roundResult ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal modal-round-result" role="dialog" aria-modal="true" aria-labelledby="round-result-title" data-testid="round-result">
            <span className="eyebrow">Round {game.roundResult.round} complete</span>
            <h2 id="round-result-title">{game.roundResult.outcome === "victory" ? "The line holds." : "The line broke."}</h2>
            <p>{game.roundResult.outcome === "victory" ? "Your bond outlasted Mooncrest." : `The commander lost ${Math.abs(game.roundResult.lifeDelta)} life, but the campaign continues.`}</p>
            <div className="result-grid">
              <span><small>Gold earned</small><strong>+{game.roundResult.goldEarned}</strong></span>
              <span><small>Commander XP</small><strong>+{game.roundResult.commanderXp}</strong></span>
              <span><small>Unit XP</small><strong>+{game.roundResult.outcome === "victory" ? 3 : 2}</strong></span>
              <span><small>Streak</small><strong>{game.streak > 0 ? `+${game.streak}` : game.streak}</strong></span>
            </div>
            <p className="result-formula">Income: {game.roundResult.income.base} base + {game.roundResult.income.interest} interest + {game.roundResult.income.streak} streak + {game.roundResult.income.victory} victory.</p>
            {combatStatistics ? <CombatBreakdown statistics={combatStatistics} /> : null}
            <div className="modal-actions"><button className="game-button button-primary" type="button" data-testid="continue-round" onClick={() => commit(advanceRound(game))}>Continue to round {game.round + 1}</button></div>
          </section>
        </div>
      ) : null}

      {game.phase === "gameover" ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal modal-round-result" role="dialog" aria-modal="true" aria-labelledby="game-result-title" data-testid="game-result">
            <span className="eyebrow">Campaign complete</span>
            <h2 id="game-result-title">{game.campaignOutcome === "victory" ? "HEXFALL answered your call." : "Mooncrest claims the arena."}</h2>
            <p>{game.campaignOutcome === "victory" ? `You survived all ${game.round} rounds with ${game.life} commander life.` : `You reached round ${game.round}. Rebuild the bond and try a new formation.`}</p>
            {combatStatistics ? <CombatBreakdown statistics={combatStatistics} /> : null}
            <div className="modal-actions"><button className="game-button button-primary" type="button" data-testid="restart-game" onClick={handleRestart}>Play again</button></div>
          </section>
        </div>
      ) : null}

      <div className="toast" role="status" aria-live="polite" aria-atomic="true" data-testid="toast-region">{toast}</div>
    </main>
  );
}
