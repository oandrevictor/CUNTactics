import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Relic Forge exposes component crafting, enhancement, and inventory equipment actions", async () => {
  const client = await readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8");

  assert.match(client, /data-testid="item-armory"/);
  assert.match(client, /data-testid=\{`item-component-\$\{componentId\}`\}/);
  assert.match(client, /data-testid=\{`item-component-count-\$\{componentId\}`\}/);
  assert.match(client, /data-testid=\{`item-craft-slot-\$\{index\}`\}/);
  assert.match(client, /data-testid="item-craft-preview"/);
  assert.match(client, /data-testid="craft-item"/);
  assert.match(client, /craftItem\(game, forgeComponents\[0\], forgeComponents\[1\]\)/);
  assert.match(client, /enhanceItem\(game, selectedCraftedItem\.id, forgeComponents\[0\]\)/);
  assert.match(client, /equipItem\(game, selectedAllyForItems\.id, selectedCraftedItem\.id, slotIndex\)/);
});

test("every character exposes three visible item slots with equip and unequip controls", async () => {
  const [client, engine] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game-engine.ts", import.meta.url), "utf8"),
  ]);

  assert.match(engine, /ITEM_SLOTS_PER_UNIT\s*=\s*3/);
  assert.match(client, /data-testid=\{`unit-equipment-\$\{selectedDisplay\.id\}`\}/);
  assert.match(client, /data-testid=\{`unit-item-slot-\$\{selectedDisplay\.id\}-\$\{slotIndex\}`\}/);
  assert.match(client, /data-testid=\{`unit-item-slots-\$\{unit\.id\}`\}/);
  assert.match(client, /handleUnequipItem\(slotIndex\)/);
  assert.match(client, /handleEquipItem\(slotIndex\)/);
  assert.match(client, /normalizeGameState\(parsed\)/);
});

test("item interface is styled for forge cards, enhanced gear, and compact slot markers", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  for (const selector of [
    ".item-armory-panel",
    ".item-component-card",
    ".craft-tray",
    ".crafted-item-card",
    ".equipment-slot",
    ".equipment-slot-enhanced",
    ".unit-item-pips",
    ".unit-item-pip-enhanced",
  ]) {
    assert.match(styles, new RegExp(selector.replace(".", "\\.")));
  }
});

test("items and components can be dragged onto board or bench champions", async () => {
  const [client, engine, styles] = await Promise.all([
    readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(client, /CRAFTED_ITEM_DRAG_TYPE/);
  assert.match(client, /ITEM_COMPONENT_DRAG_TYPE/);
  assert.match(client, /handleChampionLoadoutDrop\(event, unit\.id\)/);
  assert.match(client, /handleChampionLoadoutDrop\(event, display\.id\)/);
  assert.match(client, /draggable=\{game\.phase === "planning" && available > 0\}/);
  assert.match(client, /draggable=\{game\.phase === "planning"\}/);
  assert.match(client, /equipItem\(game, unitId, craftedItemId\)/);
  assert.match(client, /enhanceEquippedItem\(game, unitId, componentId\)/);
  assert.match(client, /data-testid="enhance-equipped-item"/);
  assert.match(engine, /export function enhanceEquippedItem/);
  assert.match(styles, /\.loadout-cell-ready/);
  assert.match(styles, /\.unit-loadout-drop-ready/);
  assert.match(styles, /\.loadout-source-dragging/);
});
