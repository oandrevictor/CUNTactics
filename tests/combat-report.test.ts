import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyCombatResult,
  createInitialGame,
  getCombatStatistics,
  resolveCombat,
  type CombatStatistics,
  type CombatReport,
  type GameState,
  type HeroId,
} from "../app/game-engine.ts";

type ExpectedUnitStats = {
  unitId: string;
  heroId: HeroId;
  side: "player" | "enemy";
  stars: number;
  level: number;
  damageDealt: number;
  healingDone: number;
  shieldGranted: number;
};

function emptyStats(unit: CombatReport["initialUnits"][number]): ExpectedUnitStats {
  return {
    unitId: unit.id,
    heroId: unit.heroId,
    side: unit.side,
    stars: unit.stars,
    level: unit.level,
    damageDealt: 0,
    healingDone: 0,
    shieldGranted: 0,
  };
}

/**
 * Independent oracle for getCombatStatistics. Combat snapshots are post-action,
 * so every statistic is the adjacent delta credited to the event actor.
 */
function expectedStatistics(report: CombatReport): CombatStatistics {
  const ledger = Object.fromEntries(report.initialUnits.map((unit) => [unit.id, emptyStats(unit)]));
  let previous = new Map(report.initialUnits.map((unit) => [unit.id, unit]));

  for (const event of report.events) {
    const current = new Map(event.snapshot.map((unit) => [unit.id, unit]));
    const actor = event.actorId ? current.get(event.actorId) : null;
    const actorStats = actor ? ledger[actor.id] : null;

    for (const unit of event.snapshot) {
      const before = previous.get(unit.id);
      if (!before) continue;
      const hpLost = Math.max(0, before.hp - unit.hp);
      const hpGained = Math.max(0, unit.hp - before.hp);
      const shieldLost = Math.max(0, before.shield - unit.shield);
      const shieldGained = Math.max(0, unit.shield - before.shield);

      if (!actor || !actorStats) continue;
      if (unit.side !== actor.side) {
        actorStats.damageDealt += hpLost + shieldLost;
      } else {
        actorStats.healingDone += hpGained;
        actorStats.shieldGranted += shieldGained;
      }
    }
    previous = current;
  }

  const units = Object.values(ledger);
  const team = (side: "player" | "enemy") => units
    .filter((unit) => unit.side === side)
    .reduce(
      (total, unit) => ({
        damageDealt: total.damageDealt + unit.damageDealt,
        shieldGranted: total.shieldGranted + unit.shieldGranted,
        healingDone: total.healingDone + unit.healingDone,
      }),
      { damageDealt: 0, shieldGranted: 0, healingDone: 0 },
    );
  return { teams: { player: team("player"), enemy: team("enemy") }, units };
}

function stateWithBenchedUnit(seed: number): GameState {
  const initial = createInitialGame(seed);
  return {
    ...initial,
    units: initial.units.map((unit, index) => index === initial.units.length - 1
      ? { ...unit, position: null, benchIndex: 0 }
      : unit),
  };
}

test("getCombatStatistics credits adjacent snapshot deltas to the acting unit and team", () => {
  const started = resolveCombat(createInitialGame(73));
  assert.equal(started.ok, true);
  const report = started.report!;
  const actual = getCombatStatistics(report);
  const expected = expectedStatistics(report);

  assert.deepEqual(actual, expected);
  assert.equal(actual.units.length, report.initialUnits.length);
  assert.ok(actual.teams.player.damageDealt + actual.teams.enemy.damageDealt > 0);
  assert.ok(actual.units.every((unit) => (
    Number.isInteger(unit.damageDealt)
    && Number.isInteger(unit.shieldGranted)
    && Number.isInteger(unit.healingDone)
    && unit.damageDealt >= 0
    && unit.shieldGranted >= 0
    && unit.healingDone >= 0
  )));
});

test("fire-wall accounting uses total shield deltas without double-counting fireWallShield", () => {
  const initial = createInitialGame(173);
  const player = {
    ...initial.units[0],
    id: "report-boitata",
    heroId: "boitata" as const,
    position: 40,
    benchIndex: null,
  };
  const enemy = {
    ...initial.enemyUnits[0],
    id: "report-bramble",
    heroId: "bramble" as const,
    position: 32,
    benchIndex: null,
  };
  const started = resolveCombat({ ...initial, units: [player], enemyUnits: [enemy] });
  const report = started.report!;
  const actual = getCombatStatistics(report);
  const expected = expectedStatistics(report);
  const boitata = actual.units.find((unit) => unit.unitId === player.id)!;

  assert.deepEqual(actual, expected);
  assert.ok(boitata.shieldGranted > 0, "Boitata's casts should credit generated shield");
  assert.equal(
    boitata.shieldGranted,
    expected.units.find((unit) => unit.unitId === player.id)!.shieldGranted,
    "fireWallShield is descriptive state, not a second shield pool",
  );
});

test("report rewards reconcile exactly into RoundResult and exclude benched units", () => {
  const initial = stateWithBenchedUnit(244);
  const deployedIds = initial.units
    .filter((unit) => unit.position !== null)
    .map((unit) => unit.id)
    .sort();
  const benched = initial.units.find((unit) => unit.position === null)!;
  const started = resolveCombat(initial);
  assert.equal(started.ok, true);
  const report = started.report!;

  assert.equal(
    report.income.total,
    report.income.base + report.income.interest + report.income.streak + report.income.victory,
  );
  assert.deepEqual(Object.keys(report.unitXp).sort(), deployedIds);
  assert.ok(Object.values(report.unitXp).every((xp) => xp === (report.outcome === "victory" ? 3 : 2)));
  assert.deepEqual(report.finalUnits, report.events.at(-1)?.snapshot);

  const applied = applyCombatResult(started.state);
  assert.equal(applied.ok, true);
  assert.equal(applied.state.gold - initial.gold, report.income.total);
  assert.equal(initial.life - applied.state.life, report.playerDamage);
  assert.deepEqual(applied.state.roundResult, {
    outcome: report.outcome,
    round: report.round,
    lifeDelta: -report.playerDamage,
    goldEarned: report.income.total,
    commanderXp: report.commanderXp,
    unitXp: report.unitXp,
    income: report.income,
  });
  assert.deepEqual(
    applied.state.units.find((unit) => unit.id === benched.id),
    benched,
    "a benched unit should not receive combat XP",
  );
});

test("the rendered round report exposes team totals and unit rows with stable test ids", async () => {
  const client = await readFile(new URL("../app/game-client.tsx", import.meta.url), "utf8");
  const resultSection = client.slice(
    client.indexOf('game.phase === "resolution" && game.roundResult'),
    client.indexOf('game.phase === "gameover"'),
  );

  assert.match(resultSection, /data-testid="round-result"/);
  assert.match(resultSection, /game\.roundResult\.goldEarned/);
  assert.match(resultSection, /game\.roundResult\.commanderXp/);
  assert.match(resultSection, /game\.roundResult\.outcome\s*===\s*"victory"\s*\?\s*3\s*:\s*2/);
  assert.match(resultSection, /game\.roundResult\.income\.base/);
  assert.match(resultSection, /game\.roundResult\.income\.interest/);
  assert.match(resultSection, /game\.roundResult\.income\.streak/);
  assert.match(resultSection, /game\.roundResult\.income\.victory/);
  assert.match(client, /getCombatStatistics/);
  assert.match(resultSection, /<CombatBreakdown statistics=\{combatStatistics\}/);
  assert.match(client, /data-testid="combat-breakdown"/);
  assert.match(client, /data-testid=\{`combat-team-\$\{side\}`\}/);
  assert.match(client, /combat-total-\$\{side\}-damage/);
  assert.match(client, /combat-total-\$\{side\}-shield/);
  assert.match(client, /combat-total-\$\{side\}-healing/);
  assert.match(client, /combat-stat-\$\{unit\.unitId\}/);
});
