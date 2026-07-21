"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
import { Boitata3DLayer } from "./boitata-3d-layer";
import {
  BENCH_SIZE,
  BOARD_COLUMNS,
  BOARD_SIZE,
  HEROES,
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
  createInitialGame,
  getActiveTraits,
  getCopyCount,
  getInterest,
  getStreakBonus,
  getUnitStats,
  moveUnit,
  refreshShop,
  resolveCombat,
  restartGame,
  sellUnit,
  toggleShopLock,
  unitCapForLevel,
  unitXpToNext,
  validateState,
  type CombatEvent,
  type CombatUnit,
  type GameActionResult,
  type GameState,
  type HeroId,
  type TraitId,
  type UnitInstance,
} from "./game-engine";

const STORAGE_KEY = "hexfall-match-v1";
const TUTORIAL_KEY = "hexfall-tutorial-complete";
const DESKTOP_BOARD_HEIGHT_RATIO = 5.4 / 8;
const MOBILE_BOARD_HEIGHT_RATIO = 6.3 / 8;

type DisplayUnit = {
  id: string;
  heroId: HeroId;
  side: "player" | "enemy";
  stars: number;
  level: number;
  xp: number;
  position: number | null;
  benchIndex: number | null;
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
}: {
  unit: DisplayUnit;
  selected: boolean;
  highlighted: boolean;
  currentEvent: CombatEvent | null;
  previousEvent: CombatEvent | null;
  draggable: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const hero = HEROES[unit.heroId];
  const isCreatureToken = unit.heroId === "boitata";
  const isTarget = currentEvent?.targetIds?.includes(unit.id) ?? false;
  const effectKind = combatEffectKind(currentEvent);
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
      className={`unit-token ${isCreatureToken ? "unit-token-creature unit-token-boitata" : ""} ${unit.side === "player" ? "unit-ally" : "unit-enemy"} ${selected ? "unit-selected" : ""} ${highlighted ? "unit-trait-highlight" : ""} ${!unit.alive ? "unit-dead" : ""} ${isActor ? `unit-event-actor unit-event-actor-${effectKind}` : ""} ${isDamaged ? "unit-impact-damage" : ""} ${isHealed ? "unit-impact-heal" : ""} ${isShielded ? "unit-impact-shield" : ""} ${shieldLost > 0 ? "unit-shield-absorbed" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      data-testid={`unit-${unit.id}`}
      data-unit-id={unit.id}
      data-hero-id={unit.heroId}
    >
      <span className="unit-stars" data-testid={`unit-stars-${unit.id}`} aria-label={`${unit.stars} star`}>{starsLabel(unit.stars)}</span>
      <HeroArt heroId={unit.heroId} className="unit-avatar" />
      {hasFireWall ? <span className={`fire-wall ${isShielded ? "fire-wall-cast" : ""} ${fireWallShieldLost > 0 ? "fire-wall-absorb" : ""} ${fireWallBroke ? "fire-wall-break" : ""}`} aria-hidden="true" /> : null}
      <span className="unit-level">L{unit.level}</span>
      <span className="unit-name">{hero.name}</span>
      {isActor ? <span className="combat-role" aria-hidden="true">{effectKind === "shield" ? "WALL" : currentEvent?.type === "ability" ? "CAST" : "ATTACK"}</span> : null}
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
      {feedback ? <span className={`floating-text ${isHealingAbility ? "floating-heal" : isShielded ? "floating-shield" : "floating-damage"}`}>{feedback}</span> : null}
      {blockFeedback ? <span className="floating-text floating-block">{blockFeedback}</span> : null}
    </div>
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

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as GameState;
          if (parsed.version === 1 && validateState(parsed).length === 0) setGame(parsed);
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
  const selectedHero = selectedDisplay ? HEROES[selectedDisplay.heroId] : null;
  const selectedRole = selectedHero ? ROLE_PROFILES[selectedHero.role] : null;
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
  const combatBeatStyle = { "--combat-beat": `${Math.round(680 / speed)}ms` } as CSSProperties;

  useEffect(() => {
    if (boitataBoardUnits.length === 0) setBoitata3DReady(false);
  }, [boitataBoardUnits.length]);

  function commit(result: GameActionResult, onSuccess?: () => void) {
    setToast(result.message);
    if (!result.ok) return;
    setGame(result.state);
    onSuccess?.();
  }

  function handleBuy(offerId: string) {
    commit(buyShopUnit(game, offerId), () => {
      if (tutorialVisible && tutorialStage === 0) setTutorialStage(1);
    });
  }

  function handleMove(unitId: string, kind: "board" | "bench", index: number) {
    const result = moveUnit(game, unitId, { kind, index });
    commit(result, () => {
      setSelectedId(unitId);
      if (tutorialVisible && tutorialStage === 1) setTutorialStage(2);
    });
  }

  function handleBoardCell(index: number) {
    const occupant = boardUnits.find((unit) => unit.position === index) ?? null;
    if (game.phase !== "planning") {
      if (occupant) setSelectedId(occupant.id);
      return;
    }
    const selectedAlly = selectedId ? game.units.find((unit) => unit.id === selectedId) : null;
    if (selectedAlly) {
      if (occupant?.id === selectedAlly.id) {
        setSelectedId(null);
        return;
      }
      if (index >= PLAYER_START_ROW * BOARD_COLUMNS) handleMove(selectedAlly.id, "board", index);
      else setToast("Allies can only be placed in your territory.");
      return;
    }
    if (occupant) setSelectedId(occupant.id);
  }

  function handleBenchSlot(index: number) {
    const occupant = benchUnits.find((unit) => unit.benchIndex === index) ?? null;
    const selectedAlly = selectedId ? game.units.find((unit) => unit.id === selectedId) : null;
    if (selectedAlly) {
      if (occupant?.id === selectedAlly.id) {
        setSelectedId(null);
      } else {
        handleMove(selectedAlly.id, "bench", index);
      }
    } else if (occupant) {
      setSelectedId(occupant.id);
    }
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
          <strong>{tutorialStage === 0 ? "Recruit a hero from the Night Market." : tutorialStage === 1 ? "Select an ally, then choose a teal tile to move or swap." : "When your formation is ready, begin battle."}</strong>
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
            <div className={`board-grid ${boitata3DReady ? "boitata-3d-ready" : ""}`} role="grid" aria-label="Eight column by six row battle board" data-testid="game-board" style={combatBeatStyle}>
              {currentEffectKind && combatLinks.length ? (
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
              {Array.from({ length: BOARD_SIZE }, (_, index) => {
                const row = Math.floor(index / BOARD_COLUMNS);
                const column = index % BOARD_COLUMNS;
                const unit = boardUnits.find((candidate) => candidate.position === index) ?? null;
                const selectedAlly = selectedId ? game.units.find((candidate) => candidate.id === selectedId) : null;
                const playerCell = row >= PLAYER_START_ROW;
                const valid = game.phase === "planning" && !!selectedAlly && playerCell;
                const highlighted = !!unit && !!highlightedTrait && HEROES[unit.heroId].traits.includes(highlightedTrait);
                const aria = `Row ${row + 1}, column ${column + 1}, ${playerCell ? "player" : "enemy"} territory${unit ? `, ${HEROES[unit.heroId].name}, ${ROLE_PROFILES[HEROES[unit.heroId].role].label}, range ${unit.range}, level ${unit.level}, ${Math.round(clampPercent(unit.hp, unit.maxHp))} percent health${unit.shield > 0 ? `, ${Math.round(unit.shield)} shield` : ""}` : ", empty"}`;
                return (
                  <button
                    className={`board-cell ${playerCell ? "board-cell-player" : "board-cell-enemy"} ${valid ? "board-cell-valid" : ""} ${unit?.id === selectedId ? "board-cell-selected" : ""}`}
                    key={index}
                    type="button"
                    role="gridcell"
                    aria-label={aria}
                    data-testid={`board-cell-r${row}-c${column}`}
                    onClick={() => handleBoardCell(index)}
                    onDragOver={(event) => { if (playerCell && game.phase === "planning") event.preventDefault(); }}
                    onDrop={(event) => {
                      event.preventDefault();
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
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/unit-id", unit.id);
                          setSelectedId(unit.id);
                        }}
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
            <div className="territory-label territory-player">Your territory · {deployedCount}/{commanderCap} deployed</div>
          </div>
          {game.phase === "combat" && currentEvent ? (
            <div className="combat-caption" aria-live="polite">
              <span>{String(combatIndex + 1).padStart(2, "0")}/{String(combatEvents.length).padStart(2, "0")}</span>
              <strong>{currentEvent.text}</strong>
            </div>
          ) : (
            <p className="placement-hint">Tap an ally, then a teal tile to place or swap. Dragging also works with a pointer.</p>
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
              <div className="ability-box" data-testid={`ability-${selectedHero.ability.id}`}>
                <span className="eyebrow">Ability · {selectedHero.ability.manaCost} mana</span>
                <strong>{selectedHero.ability.name}</strong>
                <p>{selectedHero.ability.description}</p>
                <small>Targets: {selectedHero.ability.targetRule}</small>
              </div>
              <div className="trait-chips">{selectedHero.traits.map((trait) => <span key={trait}>{TRAITS[trait].glyph} {TRAITS[trait].name}</span>)}</div>
              {selectedPersistent?.side === "player" ? <p className="copy-progress">Copies toward next star: {selectedCopies}/3</p> : null}
              {selectedPersistent?.side === "player" && game.phase === "planning" ? (
                <button className="game-button button-danger" type="button" onClick={() => {
                  commit(sellUnit(game, selectedPersistent.id), () => setSelectedId(null));
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
        <section className="panel bench-panel" aria-label="Bench" data-testid="bench">
          <div className="panel-heading"><h2 className="panel-title">Bench</h2><span className="panel-meta">{benchUnits.length}/{BENCH_SIZE}</span></div>
          <div className="bench-grid">
            {Array.from({ length: BENCH_SIZE }, (_, index) => {
              const unit = benchUnits.find((candidate) => candidate.benchIndex === index);
              const display = unit ? persistentDisplay(unit) : null;
              return (
                <button
                  className={`bench-slot ${unit?.id === selectedId ? "board-cell-selected" : ""}`}
                  type="button"
                  key={index}
                  data-testid={`bench-slot-${index}`}
                  aria-label={display ? `Bench slot ${index + 1}, ${HEROES[display.heroId].name}, ${ROLE_PROFILES[HEROES[display.heroId].role].label}, range ${display.range}` : `Bench slot ${index + 1}, empty`}
                  disabled={game.phase !== "planning"}
                  onClick={() => handleBenchSlot(index)}
                  onDragOver={(event) => { if (game.phase === "planning") event.preventDefault(); }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const unitId = event.dataTransfer.getData("text/unit-id");
                    if (unitId) handleMove(unitId, "bench", index);
                  }}
                >
                  {display ? <UnitToken unit={display} selected={display.id === selectedId} highlighted={!!highlightedTrait && HEROES[display.heroId].traits.includes(highlightedTrait)} currentEvent={null} previousEvent={null} draggable onDragStart={(event) => { event.dataTransfer.setData("text/unit-id", display.id); setSelectedId(display.id); }} /> : <span className="empty-copy">+</span>}
                </button>
              );
            })}
          </div>
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
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="round-result-title" data-testid="round-result">
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
            <div className="modal-actions"><button className="game-button button-primary" type="button" data-testid="continue-round" onClick={() => commit(advanceRound(game))}>Continue to round {game.round + 1}</button></div>
          </section>
        </div>
      ) : null}

      {game.phase === "gameover" ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="game-result-title" data-testid="game-result">
            <span className="eyebrow">Campaign complete</span>
            <h2 id="game-result-title">{game.campaignOutcome === "victory" ? "HEXFALL answered your call." : "Mooncrest claims the arena."}</h2>
            <p>{game.campaignOutcome === "victory" ? `You survived all ${game.round} rounds with ${game.life} commander life.` : `You reached round ${game.round}. Rebuild the bond and try a new formation.`}</p>
            <div className="modal-actions"><button className="game-button button-primary" type="button" data-testid="restart-game" onClick={handleRestart}>Play again</button></div>
          </section>
        </div>
      ) : null}

      <div className="toast" role="status" aria-live="polite" aria-atomic="true" data-testid="toast-region">{toast}</div>
    </main>
  );
}
