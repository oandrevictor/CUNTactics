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

test("places the bench directly beneath the battle board", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  const boardSection = client.slice(
    client.indexOf('<section className="board-section"'),
    client.indexOf('<aside className="panel enemy-panel"'),
  );
  const dockSection = client.slice(
    client.indexOf('<section className="dock">'),
    client.indexOf('{game.phase === "resolution"'),
  );

  assert.match(boardSection, /className="panel bench-panel board-bench-panel"/);
  assert.doesNotMatch(dockSection, /data-testid="bench"/);
  assert.match(styles, /\.board-bench-panel\s*\{/);
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

test("tilts the battle board with a reduced perspective angle on mobile", async () => {
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
    /\.board-grid\s*\{[^}]*\btransform\s*:[^;}]*rotateX\(\s*var\(--board-tilt\)\s*\)/s,
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
