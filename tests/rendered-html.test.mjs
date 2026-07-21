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
