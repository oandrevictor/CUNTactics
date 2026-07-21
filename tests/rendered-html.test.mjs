import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", host: "localhost" } }),
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
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site|react-loading-skeleton/i);
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
    boardSection.indexOf('{game.phase === "combat"'),
  );

  assert.match(arenaSurface, /className="arena-plane"/);
  assert.match(arenaSurface, /className="arena-bench" aria-labelledby="bench-title" data-testid="bench"/);
  assert.match(arenaSurface, /<h2 id="bench-title">Bench<\/h2>/);
  assert.ok(
    arenaSurface.indexOf('data-testid="game-board"') < arenaSurface.indexOf('data-testid="bench"'),
    "the reserve bays should follow the battle grid inside the shared arena",
  );
  assert.doesNotMatch(arenaSurface, /bench-panel|board-bench-panel|className="panel[^\"]*bench/);
  assert.match(styles, /\.arena-plane\s*\{[^}]*rotateX\(var\(--board-tilt\)\)/s);
  assert.match(styles, /\.arena-bench\s*\{/);
  assert.match(styles, /\.bench-slot\s*\{[^}]*border:\s*1px solid/s);
  assert.match(
    styles,
    /@media \(max-width: 600px\)[\s\S]*?\.bench-grid\s*\{[^}]*overflow-x:\s*auto/s,
  );
  assert.match(styles, /@media print\s*\{[\s\S]*?\.arena-bench/);
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

test("combat autoplay schedules every playback tick without a pause toggle", async () => {
  const client = await readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8");

  assert.match(
    client,
    /\[game\.phase, playing, atCombatEnd, combatEvents\.length, speed, combatIndex\]/,
  );
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
  assert.match(client, /unit-event-actor/);
  assert.match(client, /unit-impact-damage/);
  assert.match(styles, /@keyframes combat-strike-line/);
  assert.match(styles, /@keyframes combat-impact/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Sol's Starfall traces the cluster and marks every damaged character", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(client, /currentEvent\?\.type === "ability" && currentActor\?\.heroId === "sol"/);
  assert.match(client, /combatLinks\.length && !isSolStarfall/);
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

test("character inspector presents combat role and exact basic-attack range", async () => {
  const [client, engine] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game-engine.ts", import.meta.url), "utf8"),
  ]);

  assert.match(client, /unit-role-range-/);
  assert.match(client, /Basic attack range/);
  assert.match(client, /Range \{ROLE_PROFILES\[hero\.role\]\.range\}/);
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
  assert.match(abilityCard, /abilityPreview\.scalingDescription/);
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
