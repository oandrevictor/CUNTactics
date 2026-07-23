import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(locale) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: {
        accept: "text/html",
        host: "localhost",
        ...(locale ? { cookie: `hexfall-locale=${locale}` } : {}),
      },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the complete HEXFALL game surface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>HEXFALL — Turn-based tactical board battler<\/title>/i);
  assert.match(html, /HEXFALL/);
  assert.match(html, /Active bonds/);
  assert.match(html, /Night Market/);
  assert.match(html, /Begin battle/);
  assert.match(html, /role="grid"/);
  assert.match(html, /Commander life/);
  assert.match(html, /data-testid="buy-xp"/);
  assert.match(html, /data-testid="bench-forge"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site|react-loading-skeleton/i);
});

test("server-renders the complete Portuguese game surface from the locale cookie", async () => {
  const response = await render("pt-BR");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<html lang="pt-BR">/i);
  assert.match(html, /<title>HEXFALL — Batalha tática de tabuleiro em turnos<\/title>/i);
  assert.match(html, /Vínculos ativos/);
  assert.match(html, /Mercado Noturno/);
  assert.match(html, /Iniciar batalha/);
  assert.match(html, /Vida do comandante/);
  assert.match(html, /data-testid="language-selector"/);
  assert.match(html, /<option value="pt-BR" selected="">Português \(Brasil\)<\/option>/);
  assert.doesNotMatch(html, />Active bonds<|>Begin battle<|>Commander life</);
});

test("language selector persists independently and updates the document locale", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(client, /data-testid="language-selector"/);
  assert.match(client, /window\.localStorage\.getItem\(LOCALE_STORAGE_KEY\)/);
  assert.match(client, /window\.localStorage\.setItem\(LOCALE_STORAGE_KEY, locale\)/);
  assert.match(client, /document\.cookie = `\$\{LOCALE_COOKIE_KEY\}=/);
  assert.match(client, /document\.documentElement\.lang = locale/);
  assert.match(client, /data-locale=\{locale\} lang=\{locale\}/);
  assert.match(styles, /\.language-control\s*\{/);
});

test("integrates the bench into the arena surface without panel chrome", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  const boardSection = client.slice(
    client.indexOf('<section className="board-section"'),
    client.indexOf('<aside className="panel enemy-panel"'),
  );
  const arenaSurface = boardSection.slice(
    boardSection.indexOf('<div className="board-wrap">'),
    boardSection.indexOf('{game.phase === "combat" && currentMoment ? ('),
  );

  assert.match(arenaSurface, /className="arena-plane"/);
  assert.match(arenaSurface, /className="arena-bench" aria-labelledby="bench-title" data-testid="bench"/);
  assert.match(arenaSurface, /data-testid="bench-forge"/);
  assert.match(arenaSurface, /<h2 id="bench-title">\{t\("Bench"\)\}<\/h2>/);
  assert.ok(
    arenaSurface.indexOf('data-testid="game-board"') < arenaSurface.indexOf('data-testid="bench"'),
    "the reserve bays should follow the battle grid inside the shared arena",
  );
  assert.ok(
    arenaSurface.indexOf('data-testid="bench-forge"') < arenaSurface.indexOf("Array.from({ length: BENCH_SIZE }"),
    "the Forge should occupy the far-left bay before champion reserves",
  );
  assert.doesNotMatch(arenaSurface, /bench-panel|board-bench-panel|className="panel[^\"]*arena-bench/);
  assert.match(styles, /\.arena-plane\s*\{[^}]*rotateX\(var\(--board-tilt\)\)/s);
  assert.match(styles, /\.arena-bench\s*\{/);
  assert.match(styles, /\.bench-slot\s*\{[^}]*border:\s*1px solid/s);
  assert.match(styles, /\.bench-grid\s*\{[^}]*grid-template-columns:\s*minmax\(112px, 1\.25fr\) repeat\(7,/s);
  assert.match(styles, /\.bench-forge-drawer\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 600px\)[\s\S]*?\.bench-grid\s*\{[^}]*overflow-x:\s*auto/s,
  );
  assert.match(styles, /@media print\s*\{[\s\S]*?\.arena-bench/);
});

test("shows equipped gear as readable item-specific badges on board and bench champions", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(client, /const ITEM_SHORT_LABELS:[\s\S]*?"inferno-fang": "FANG"[\s\S]*?cinderplate: "PLATE"[\s\S]*?"spirit-lantern": "LAMP"/);
  assert.match(client, /function equippedItemSummary\(itemSlots: UnitItemSlots, locale: GameLocale\)/);
  assert.match(client, /title=\{equippedItemTitle \|\| undefined\}/);
  assert.match(client, /unit-item-pip-\$\{item\.tier\} unit-item-pip-\$\{item\.itemId\}/);
  assert.match(client, /data-testid=\{`unit-item-badge-\$\{unit\.id\}-\$\{index\}`\}/);
  assert.match(client, /data-item-id=\{item\?\.itemId \?\? "empty"\}/);
  assert.match(client, /className="unit-item-pip-glyph"[\s\S]*?definition\.recipe\.map/);
  assert.match(client, /<small>\{craftedItemShortLabel\(item, locale\)\}<\/small>/);
  assert.match(client, /className="unit-item-enhancement"/);
  assert.match(client, /equipmentSummary \? `, \$\{equipmentSummary\}`/);
  assert.match(client, /equippedItemSummary\(display\.itemSlots, locale\)/);

  assert.match(styles, /\.unit-item-pip\s*\{[^}]*width:\s*20px;[^}]*height:\s*22px;[^}]*grid-template-rows:/s);
  assert.match(styles, /\.board-grid \.unit-item-pip\s*\{[^}]*width:\s*clamp\(22px, 1\.75vw, 25px\);[^}]*height:\s*clamp\(23px, 1\.85vw, 27px\)/s);
  assert.match(styles, /\.unit-item-pip small\s*\{[^}]*font-weight:\s*900/s);
  assert.match(styles, /\.unit-item-enhancement\s*\{[^}]*border-radius:\s*50%/s);
  for (const itemClass of ["inferno-fang", "cinderplate", "spirit-lantern", "blazing-aegis", "spellfang", "warding-flame"]) {
    assert.match(styles, new RegExp(`\\.unit-item-pip-${itemClass}\\s*\\{[^}]*--item-accent:`));
  }
});

test("ships the bespoke social card and no starter preview dependency", async () => {
  const [packageJson, page, layout] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  await access(new URL("../public/og.png", import.meta.url));
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview/);
  assert.match(layout, /\/og\.png/);
  assert.match(layout, /x-forwarded-host/);
});

test("combat playback batches equal timestamps while its visible clock advances linearly", async () => {
  const [client, playback, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/combat-playback.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(client, /const LEGACY_COMBAT_EVENT_SECONDS = 0\.82/);
  assert.match(client, /const COMBAT_TIMESTAMP_EPSILON_SECONDS = 0\.0005/);
  assert.match(client, /const MIN_COMBAT_MOMENT_SECONDS = 0\.08/);
  assert.match(client, /function combatEventTimestamp\(event: CombatEvent, index: number\)/);
  assert.match(client, /\(event as Partial<CombatEvent>\)\.timestamp/);
  assert.match(client, /event\.turn \* LEGACY_COMBAT_EVENT_SECONDS/);
  assert.match(client, /index \* LEGACY_COMBAT_EVENT_SECONDS/);
  assert.match(client, /function groupCombatEventsByTimestamp\(events: readonly CombatEvent\[\]\)/);
  assert.match(client, /Math\.abs\(current\.timestamp - timestamp\) <= COMBAT_TIMESTAMP_EPSILON_SECONDS/);
  assert.match(client, /current\.events\.push\(event\)/);
  assert.match(client, /current\.snapshotEvent = event/);
  assert.match(
    client,
    /groupCombatEventsByTimestamp\(combatEvents\)/,
  );
  assert.match(
    client,
    /const combatMomentIndex = useMemo\(\(\) => \{/,
  );
  assert.match(client, /combatMoments\[index\]\.timestamp > currentCombatTime/);

  assert.match(client, /combatClockSeconds, setCombatClockSeconds/);
  assert.match(client, /combatClockSecondsRef = useRef\(0\)/);
  assert.match(client, /playbackGenerationRef = useRef\(0\)/);
  assert.match(client, /sampleLinearCombatClock\(\{/);
  assert.match(
    client,
    /const remainingSeconds = totalCombatTime - anchorTime/,
  );
  assert.match(client, /const startedAt = performance\.now\(\)/);
  assert.match(client, /endTime: totalCombatTime/);
  assert.match(client, /remainingDuration: remainingSeconds/);
  assert.match(client, /window\.requestAnimationFrame\(updateClock\)/);
  assert.match(client, /window\.cancelAnimationFrame\(animationFrame\)/);
  assert.match(client, /playbackGenerationRef\.current !== playbackGeneration/);
  assert.match(client, /combatClockSecondsRef\.current = sample\.time/);
  assert.match(client, /setCombatClockSeconds\(sample\.time\)/);
  assert.doesNotMatch(client, /playbackMomentKeyRef|playbackRemainingSecondsRef/);
  assert.doesNotMatch(client, /nextMomentTimestamp|currentMomentInterval/);
  assert.doesNotMatch(client, /COMBAT_CLOCK_RENDER_INTERVAL_MS|lastClockRenderAt/);
  assert.doesNotMatch(client, /Math\.round\(820 \/ speed\)/);

  assert.match(playback, /export function sampleLinearCombatClock/);
  assert.match(playback, /export function activeCombatEventsAtTime/);
  assert.match(playback, /export function combatEventEndTime/);
  assert.match(playback, /export function combatEventProgress/);
  assert.match(playback, /return roundCombatTime\(combatEventStartTime\(event\) \+ combatEventDuration\(event\)\)/);
  assert.match(playback, /currentTime >= startTime && currentTime < endTime/);
  assert.match(playback, /const segmentDuration = endTime - startTime/);
  assert.match(playback, /elapsedWallTime[\s\S]*?\* Math\.max\(0, finiteOr\(input\.speed, 1\)\)/);
  assert.match(playback, /Math\.max\(0, initialRemaining - elapsedTimelineTime\)/);
  assert.match(client, /<span>\{formatCombatTime\(currentCombatTime, locale\)\}<\/span>/);
  assert.doesNotMatch(client, /const currentCombatTime = currentMoment\?\.timestamp/);
  assert.match(client, /visibleCombatMoments\.flatMap/);
  assert.match(client, /<span className="log-time">\{formatCombatTime\(moment\.timestamp, locale\)\}<\/span>/);
  assert.match(client, /className="combat-caption-copy" aria-live="polite" aria-atomic="true"/);
  assert.match(client, /combat-step-preview/);
  assert.match(client, /--combat-preview-delay/);
  assert.match(client, /<span>\{t\("Combat time"\)\}<\/span>/);
  assert.match(client, />\{t\("Next moment"\)\}<\/button>/);
  assert.match(client, /activeCombatEventsAtTime\(combatEvents, currentCombatTime\)/);
  assert.match(client, /combatUnitPresentationAnchor\([\s\S]*?combatEvents,[\s\S]*?unit\.id,[\s\S]*?currentCombatTime,[\s\S]*?displayed\.position/);
  assert.match(client, /Math\.max\(latestEndTime, combatEventEndTime\(event\)\)/);
  assert.match(client, /currentCombatTime >= totalCombatTime - COMBAT_TIMESTAMP_EPSILON_SECONDS/);
  assert.match(client, /endTime: totalCombatTime/);
  assert.match(client, /setCombatClockSeconds\(totalCombatTime\)/);
  assert.doesNotMatch(client, /const movementBeatMilliseconds = currentEvents\.reduce/);
  assert.doesNotMatch(client, /const actionBeatMilliseconds = currentEvents\.reduce/);
  assert.doesNotMatch(client, /attackAnimationSeconds|movementTravelSeconds/);
  assert.doesNotMatch(client, /currentMomentPlaybackInterval/);
  assert.doesNotMatch(client, /segmentDuration:/);
  assert.match(client, /function combatEventTimingStyle/);
  assert.match(client, /event\.durationSeconds \?\? 0/);
  assert.match(client, /combatEventProgress\(event, combatTime\)/);
  assert.match(client, /"--combat-anchor-delay": `\$\{timelineDelayMilliseconds\}ms`/);
  assert.doesNotMatch(client, /durationMilliseconds \* 0\.46/);
  assert.match(client, /const delayMilliseconds = Math\.min\(/);
  assert.match(client, /"--combat-child-delay": `\$\{delayMilliseconds\}ms`/);
  assert.match(client, /"--combat-beat": `\$\{eventDurationMilliseconds - delayMilliseconds\}ms`/);
  assert.match(client, /"--move-from-x"/);
  assert.match(client, /"--move-from-y"/);
  assert.match(client, /"--move-duration"/);
  assert.match(client, /actorEvent\?\.fromPosition/);
  assert.match(client, /actorEvent\?\.toPosition/);
  assert.match(client, /const isMoveActionEvent = actorEvent\?\.type === "move"/);
  assert.match(client, /const moveFromPosition = actorEvent\?\.fromPosition \?\? null/);
  assert.match(client, /didMove \? "unit-event-actor unit-event-move"/);
  assert.match(client, /function combatActorVisualEvent/);
  assert.match(client, /return primaryEvent[\s\S]*?\?\? gravityEvent[\s\S]*?\?\? passiveEvent/);
  assert.match(client, /const actorGravityPhase = elphabaAbilityPhase\(actorEvent\)/);
  assert.match(client, /const tokenTimingEvent = actorEvent \?\? targetImpactEvent/);
  assert.match(client, /function CombatTimedCue\(/);
  assert.match(client, /key=\{`fire-wall:\$\{fireWallTimingEvent\.id\}`\}[\s\S]*?event=\{fireWallTimingEvent\}/);
  assert.match(client, /const fireWallTimingEvent = targetEffects\.findLast/);
  assert.match(client, /key=\{`block:\$\{event\.id\}`\}[\s\S]*?event=\{event\}/);
  assert.match(client, /key=\{`impact:\$\{targetImpactEvent\.id\}`\}[\s\S]*?event=\{targetImpactEvent\}/);
  assert.match(client, /key=\{`shield-impact:\$\{event\.id\}`\}[\s\S]*?event=\{event\}/);
  assert.match(styles, /\.unit-impact-layer\s*\{[\s\S]*?position: absolute/);
  assert.match(client, /function latestCombatTargetEvent[\s\S]*?activeEvents\.length - 1[\s\S]*?index >= 0/);
  assert.match(client, /combatLinkStyle\(event\.fromPosition, event\.toPosition, boardHeightRatio\)/);
  assert.match(client, /"--action-duration"/);
  assert.match(client, /style=\{tokenStyle\}/);
  assert.match(client, /key=\{`\$\{unit\.id\}:\$\{unitVisualCueEvent\?\.id \?\? "idle"\}`\}/);
  assert.match(client, /key=\{link\.key\}/);
  assert.match(client, /key=\{starfall\.event\.id\}/);
  assert.match(client, /playbackClockSampleRef = useRef/);
  assert.match(client, /const sample = playing \? playbackClockSampleRef\.current\?\.\(\) \?\? null : null/);
  assert.match(client, /playbackGenerationRef\.current \+= 1/);
  assert.doesNotMatch(client, /playbackManualReanchorRef|visualTimelineAnchor/);
  assert.match(client, /handleCombatSpeedChange\(Number\(event\.target\.value\)\)/);
  assert.match(client, /combatClockSecondsRef\.current = steppedCombatTime/);
  assert.match(styles, /\.combat-timeline-cue[\s\S]*?animation-delay: calc\(var\(--combat-anchor-delay, 0ms\) \+ var\(--combat-child-delay, 0ms\)\) !important/);
  assert.match(styles, /\.combat-timeline-cue[\s\S]*?animation-play-state: paused !important/);
  assert.match(styles, /combat-step-preview[\s\S]*?var\(--combat-anchor-delay, var\(--combat-preview-delay, 0ms\)\)[\s\S]*?var\(--combat-child-delay, 0ms\)/);
  assert.match(client, /currentEvents=\{activeVisualEvents\}/);
  assert.match(client, /<Boitata3DLayer[\s\S]*?combatTime=\{currentCombatTime\}/);
  assert.match(client, /<MeatGaga3DLayer[\s\S]*?combatTime=\{currentCombatTime\}/);
  assert.doesNotMatch(client, /function combatDurationForUnits/);
  assert.doesNotMatch(client, /actionDuration=\{(?:boitata|meatGaga)VisualDurationSeconds\}/);
  assert.doesNotMatch(client, /key=\{`\$\{unit\.id\}[:\-]\$\{currentMoment/);
});

test("unit inspector exposes effective attack, movement, and mana rates", async () => {
  const client = await readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8");

  const displayUnit = client.slice(
    client.indexOf("type DisplayUnit ="),
    client.indexOf("type CombatEffectKind"),
  );
  assert.match(displayUnit, /attackSpeed: number/);
  assert.match(displayUnit, /moveSpeed: number/);
  assert.match(displayUnit, /manaRegen: number/);

  const persistentDisplay = client.slice(
    client.indexOf("function persistentDisplay"),
    client.indexOf("function combatDisplay"),
  );
  assert.match(persistentDisplay, /attackSpeed: stats\.attackSpeed/);
  assert.match(persistentDisplay, /moveSpeed: stats\.moveSpeed/);
  assert.match(persistentDisplay, /manaRegen: stats\.manaRegen/);

  const combatDisplay = client.slice(
    client.indexOf("function combatDisplay"),
    client.indexOf("function phaseLabel"),
  );
  assert.match(combatDisplay, /const fallbackStats = getUnitStats\(persistent \?\? unit\)/);
  assert.match(
    combatDisplay,
    /attackSpeed: Number\.isFinite\(unit\.attackSpeed\) \? unit\.attackSpeed : fallbackStats\.attackSpeed/,
  );
  assert.match(
    combatDisplay,
    /moveSpeed: Number\.isFinite\(unit\.moveSpeed\) \? unit\.moveSpeed : fallbackStats\.moveSpeed/,
  );
  assert.match(
    combatDisplay,
    /manaRegen: Number\.isFinite\(unit\.manaRegen\) \? unit\.manaRegen : fallbackStats\.manaRegen/,
  );

  const inspector = client.slice(
    client.indexOf('<section className="selected-panel"'),
    client.indexOf('<section className="combat-log"'),
  );
  assert.match(inspector, /unit-attack-speed-\$\{selectedDisplay\.id\}/);
  assert.match(inspector, /<small>\{t\("Attack speed"\)\}<\/small><strong>\{formatRate\(selectedDisplay\.attackSpeed, locale\)\}\/\{t\("sec"\)\}<\/strong>/);
  assert.match(inspector, /unit-move-speed-\$\{selectedDisplay\.id\}/);
  assert.match(inspector, /<small>\{t\("Move speed"\)\}<\/small><strong>\{formatRate\(selectedDisplay\.moveSpeed, locale\)\} \{t\("tiles"\)\}\/\{t\("sec"\)\}<\/strong>/);
  assert.match(inspector, /unit-mana-regen-\$\{selectedDisplay\.id\}/);
  assert.match(inspector, /<small>\{t\("Mana regen"\)\}<\/small><strong>\{formatRate\(selectedDisplay\.manaRegen, locale\)\}\/\{t\("sec"\)\}<\/strong>/);
});

test("character clicks inspect while formation changes require dragging", async () => {
  const client = await readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8");
  const boardClickHandler = client.slice(
    client.indexOf("function handleBoardCell"),
    client.indexOf("function handleBenchSlot"),
  );
  const benchClickHandler = client.slice(
    client.indexOf("function handleBenchSlot"),
    client.indexOf("function handleBeginCombat"),
  );

  assert.match(boardClickHandler, /if \(occupant\) setSelectedId\(occupant\.id\)/);
  assert.match(benchClickHandler, /if \(occupant\) setSelectedId\(occupant\.id\)/);
  assert.doesNotMatch(boardClickHandler, /handleMove|moveUnit/);
  assert.doesNotMatch(benchClickHandler, /handleMove|moveUnit/);
  assert.match(client, /const \[draggedUnitId, setDraggedUnitId\]/);
  assert.match(client, /const valid = game\.phase === "planning" && !!draggedAlly && playerCell/);
  assert.match(client, /event\.dataTransfer\.setData\("text\/unit-id", unit\.id\)/);
  assert.match(client, /if \(unitId && playerCell\) handleMove\(unitId, "board", index\)/);
  assert.match(client, /if \(unitId\) handleMove\(unitId, "bench", index\)/);
  assert.match(client, /Click any character to inspect\. Drag allies between teal tiles and the bench/);
  assert.match(client, /Drag an ally to a teal tile or the bench to move or swap/);
});

test("combat actions expose directional links, actor emphasis, impacts, and reduced-motion fallbacks", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(client, /data-testid="combat-links"/);
  assert.match(client, /activeVisualEvents\.flatMap<CombatLinkCue>/);
  assert.doesNotMatch(client, /currentEvents\.flatMap/);
  assert.match(client, /unit-event-actor/);
  assert.match(client, /unit-event-move/);
  assert.match(client, /!isActor && isDamaged \? "unit-impact-damage"/);
  assert.match(client, /if \(event\?\.type === "shield"\) return "shield"/);
  assert.match(client, /event\.type === "move" \|\| event\.type === "attack" \|\| event\.type === "ability"/);
  assert.match(styles, /@keyframes combat-strike-line/);
  assert.match(styles, /@keyframes combat-impact/);
  assert.match(styles, /\.combat-link-move\s*\{/);
  assert.match(styles, /\.combat-step-preview/);
  assert.match(styles, /\.log-shield\s*\{/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("shield reactions stay attached to their source combat event", async () => {
  const [engine, client, boitataState] = await Promise.all([
    readFile(new URL("../app/game-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/boitata-3d-state.ts", import.meta.url), "utf8"),
  ]);

  assert.match(engine, /shieldAbsorbedAmounts\?: Record<string, number>/);
  assert.match(engine, /fireWallAbsorbedAmounts\?: Record<string, number>/);
  assert.match(engine, /fireWallBrokenTargetIds\?: string\[\]/);
  assert.match(client, /event\.shieldAbsorbedAmounts\?\.\[unit\.id\]/);
  assert.match(client, /event\.fireWallAbsorbedAmounts\?\.\[unit\.id\]/);
  assert.match(client, /event\.fireWallBrokenTargetIds\?\.includes\(unit\.id\)/);
  assert.doesNotMatch(client, /\(previousUnit\?\.shield \?\? 0\) - unit\.shield/);
  assert.doesNotMatch(client, /previousUnit\.fireWallShield - unit\.fireWallShield/);
  assert.match(boitataState, /const shieldImpactEvent = newestEvent/);
  assert.match(boitataState, /shieldImpactEvent\?\.fireWallAbsorbedAmounts\?\.\[unit\.id\]/);
  assert.doesNotMatch(boitataState, /snapshotShieldDamage/);
});

test("Sol's Starfall traces the cluster and marks every damaged character", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(client, /activeVisualEvents\.flatMap<SolStarfallCue>/);
  assert.match(client, /solStarfalls\.map\(\(starfall\) =>/);
  assert.match(client, /actor\?\.heroId !== "sol"/);
  assert.match(client, /data-testid="sol-starfall-layer"/);
  assert.match(client, /data-testid=\{`sol-starfall-target-\$\{target\.id\}`\}/);
  assert.match(client, /"STARFALL"/);
  assert.match(styles, /\.sol-starfall-layer\s*\{/);
  assert.match(styles, /\.sol-starfall-trail\s*\{/);
  assert.match(styles, /\.sol-starfall-sigil\s*\{/);
  assert.match(styles, /\.sol-starfall-hit\s*\{/);
  assert.match(styles, /\.unit-event-actor-sol\s*\{/);
  assert.match(styles, /\.unit-impact-starfall\s*\{/);
  assert.match(styles, /@keyframes sol-starfall-comet/);
  assert.match(styles, /@keyframes sol-starfall-impact/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.sol-starfall-trail[\s\S]*?animation: none !important/,
  );
});

test("Meat Gaga exposes a mana-free passive, live reserve, and exact star scaling", async () => {
  const [client, engine, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  await access(new URL("../public/characters/meat-couture-npc-v3.png", import.meta.url));
  assert.match(engine, /id: "meat-gaga"/);
  assert.match(engine, /portrait: "\/characters\/meat-couture-npc-v3\.png"/);
  assert.match(engine, /role: "shooter"/);
  assert.match(engine, /MEAT_GAGA_STACK_GAIN_PERCENTAGES = \[60, 75, 90\]/);
  assert.match(engine, /MEAT_GAGA_STACK_CONSUME_PERCENTAGES = \[7, 8, 12\]/);
  assert.match(client, /getMeatGagaPassivePreview\(selectedDisplay\.stars\)/);
  assert.match(client, /calculateMeatGagaStackConsumption\(selectedDisplay\.meatStack, selectedDisplay\.stars\)/);
  assert.match(client, /<span className="eyebrow">\{t\("Passive · No Mana"\)\}<\/span>/);
  assert.match(client, /data-testid="meat-gaga-passive-current-values"/);
  assert.match(client, /data-testid="meat-gaga-passive-scaling"/);
  assert.match(client, /meatGagaPassivePreview\.current\.stackGainPercent/);
  assert.match(client, /meatGagaPassivePreview\.current\.stackConsumePercent/);
  assert.match(client, /meatGagaPassivePreview\.byStar\.map/);
  assert.match(client, /<small>\{t\("Next attack bonus"\)\}<\/small>/);
  assert.match(client, /unit-meat-stack-inspector-/);
  assert.match(client, /unit-meat-stack-/);
  assert.match(client, /event\.type === "passive"/);
  assert.match(client, /unit-meat-stack-gained/);
  assert.match(client, /t\("HARVEST"\)[\s\S]*?Math\.round\(meatHarvestEvent/);
  assert.match(client, /heroId === "meat-gaga"[\s\S]*?"starting mana has no effect"/);
  assert.match(client, /selectedHero\.id === "meat-gaga"[\s\S]*?t\("Passive · No Mana"\)[\s\S]*?: \([\s\S]*?<small>\{t\("Mana"\)\}<\/small>/);
  assert.match(styles, /\.unit-token-meat-gaga \.unit-avatar\.hero-art-image/);
  assert.match(styles, /\.stat-cell-meat-stack/);
  assert.match(styles, /\.passive-card/);
});

test("empowered Meat Gaga attacks throw concurrent meat projectiles and splatter", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(client, /function isMeatGagaEnhancedAttack/);
  assert.match(client, /event\.meatBonusDamage/);
  assert.match(client, /activeVisualEvents\.flatMap<MeatProjectileCue>/);
  assert.match(client, /meatProjectiles\.map\(\(cue\) =>/);
  assert.match(client, /data-testid="meat-projectile-layer"/);
  assert.match(client, /data-testid=\{`meat-projectile-\$\{cue\.event\.id\}-\$\{cue\.targetId\}`\}/);
  assert.match(client, /MEAT THROW/);
  assert.match(client, /unit-impact-meat/);
  assert.match(client, /floating-meat/);
  assert.match(styles, /\.meat-projectile-layer\s*\{/);
  assert.match(styles, /\.meat-projectile\s*\{/);
  assert.match(styles, /\.meat-splatter\s*\{/);
  assert.match(styles, /@keyframes meat-throw/);
  assert.match(styles, /@keyframes meat-splatter/);
  assert.match(styles, /\.combat-paused[\s\S]*?\.meat-projectile-layer/);
  assert.match(styles, /\.combat-step-preview[\s\S]*?\.meat-projectile-layer/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.meat-projectile[\s\S]*?animation: none !important/,
  );
});

test("character inspector presents combat role and exact basic-attack range", async () => {
  const [client, engine] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game-engine.ts", import.meta.url), "utf8"),
  ]);

  assert.match(client, /unit-role-range-/);
  assert.match(client, /Basic attack range/);
  assert.match(client, /\{t\("Range"\)\} \{ROLE_PROFILES\[hero\.role\]\.range\}/);
  assert.match(engine, /tank:[\s\S]*?range: 1/);
  assert.match(engine, /shooter:[\s\S]*?range: 4/);
});

test("ability inspector shows current values and an accessible star-scaling breakdown", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(client, /\bgetAbilityPreview\(/);
  const cardStart = client.indexOf('<details className="ability-box ability-card"');
  const cardEnd = client.indexOf('<div className="trait-chips">', cardStart);
  assert.ok(cardStart >= 0 && cardEnd > cardStart, "the inspector should render the ability as a disclosure card");
  const abilityCard = client.slice(cardStart, cardEnd);
  const summaryEnd = abilityCard.indexOf("</summary>");

  assert.match(abilityCard, /<summary className="ability-summary">/);
  assert.match(abilityCard, /className="ability-current-values"/);
  assert.ok(
    abilityCard.indexOf('className="ability-current-values"') < summaryEnd,
    "current ability metrics should remain visible before the expanded breakdown",
  );
  assert.match(abilityCard, /ability-value-/);
  assert.match(abilityCard, /className="ability-breakdown"/);
  assert.match(abilityCard, /formatAbilityScaling\(locale, abilityPreview\)/);
  assert.match(abilityCard, /className="ability-scale-table"/);
  assert.match(abilityCard, /data-testid=\{`ability-scaling-\$\{selectedHero\.ability\.id\}`\}/);
  assert.match(abilityCard, /className="ability-modifiers"/);
  assert.match(abilityCard, /abilityPreview\.modifiers/);
  assert.match(abilityCard, /className="ability-context-note"/);
  assert.match(abilityCard, /abilityPreview\.contextNote/);

  assert.match(styles, /\.ability-card:hover\s*>?\s*\.ability-breakdown/);
  assert.match(styles, /\.ability-card:focus-within\s*>?\s*\.ability-breakdown/);
  assert.match(styles, /\.ability-card\[open\]\s*>?\s*\.ability-breakdown/);
  assert.match(styles, /\.ability-summary:focus-visible/);
  assert.match(
    styles,
    /@media\s*\(hover:\s*none\)[^{]*\{[\s\S]*?\.ability-card\[open\]\s*>?\s*\.ability-breakdown/,
  );
});

test("ships Boitata's portrait and fire-wall shield animation states", async () => {
  const [client, engine, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  await access(new URL("../public/characters/boitata.png", import.meta.url));
  assert.match(engine, /id: "boitata"/);
  assert.match(engine, /portrait: "\/characters\/boitata\.png"/);
  assert.match(engine, /id: "wall-of-fire"/);
  assert.match(client, /function HeroArt/);
  assert.match(client, /unit-impact-shield/);
  assert.match(client, /unit-shield-absorbed/);
  assert.match(client, /fire-wall-cast/);
  assert.match(client, /fire-wall-absorb/);
  assert.match(client, /fire-wall-break/);
  assert.match(client, /floating-shield/);
  assert.match(client, /floating-block/);
  assert.match(styles, /@keyframes fire-wall-cast/);
  assert.match(styles, /@keyframes fire-wall-absorb/);
  assert.match(styles, /@keyframes fire-wall-break/);
});

test("tilts the full arena surface with a reduced perspective angle on mobile", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(styles, /\.board-wrap\s*\{[^}]*\bperspective\s*:/s);

  const desktopTilt = styles.match(
    /\.board-wrap\s*\{[^}]*--board-tilt\s*:\s*(-?\d+(?:\.\d+)?)deg/s,
  );
  assert.ok(desktopTilt, "the board wrapper should define a static perspective angle");
  assert.match(
    styles,
    /\.arena-plane\s*\{[^}]*\btransform\s*:[^;}]*rotateX\(\s*var\(--board-tilt\)\s*\)/s,
  );

  const mobileTilt = styles.match(
    /@media\s*\(max-width:\s*\d+px\)[\s\S]*?\.board-wrap\s*\{[^}]*--board-tilt\s*:\s*(-?\d+(?:\.\d+)?)deg/,
  );
  assert.ok(mobileTilt, "a mobile breakpoint should reduce the board's tilt");
  assert.ok(
    Math.abs(Number(mobileTilt[1])) < Math.abs(Number(desktopTilt[1])),
    "the mobile rotateX angle should be gentler than the desktop angle",
  );
  assert.match(client, /MOBILE_BOARD_HEIGHT_RATIO\s*=\s*6\.3\s*\/\s*8/);
  assert.match(client, /matchMedia\(["']\(max-width:\s*600px\)["']\)/);
  assert.match(client, /combatLinkStyle\([^)]*boardHeightRatio\)/);
});

test("renders Boitata as a transparent creature token blended into the board", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  const unitTokenSource = client.slice(
    client.indexOf("function UnitToken"),
    client.indexOf("export function GameClient"),
  );
  assert.match(unitTokenSource, /unit\.heroId\s*===\s*["']boitata["']/);
  assert.match(
    unitTokenSource,
    /\?\s*["'][^"']*\bunit-token-creature\b[^"']*\bunit-token-boitata\b[^"']*["']/,
  );

  const boitataRules = [...styles.matchAll(/[^{}]*\.unit-token-(?:creature|boitata)[^{}]*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .join("\n");
  assert.ok(boitataRules, "Boitata should have board-token-specific styling");
  assert.match(boitataRules, /\bbackground(?:-color)?\s*:\s*(?:none|transparent)\b/);
  assert.match(boitataRules, /\bborder(?:-color)?\s*:\s*(?:0|none|transparent)\b/);
  assert.match(boitataRules, /\bfilter\s*:[^;}]*drop-shadow\(/);
  assert.match(boitataRules, /\bpointer-events\s*:\s*auto\b/);
});
