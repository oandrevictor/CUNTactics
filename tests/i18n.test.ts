import assert from "node:assert/strict";
import test from "node:test";

import {
  GAME_LOCALES,
  LOCALE_COOKIE_KEY,
  LOCALE_STORAGE_KEY,
  formatAbilityScaling,
  formatList,
  formatNumber,
  isGameLocale,
  localeFromCookieHeader,
  localizeAbilityPreview,
  localizeAbilityText,
  localizeActionResult,
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
} from "../app/i18n.ts";
import {
  HEROES,
  ITEM_COMPONENTS,
  ITEM_DEFINITIONS,
  ROLE_PROFILES,
  TRAITS,
  createInitialGame,
  getAbilityPreview,
  resolveCombat,
  type CombatEvent,
  type HeroId,
  type ItemComponentId,
  type ItemId,
  type UnitInstance,
} from "../app/game-engine.ts";

test("locale helpers accept only supported values and safely parse cookies", () => {
  assert.deepEqual(GAME_LOCALES.map((locale) => locale.id), ["en", "pt-BR"]);
  assert.equal(LOCALE_COOKIE_KEY, "hexfall-locale");
  assert.equal(LOCALE_STORAGE_KEY, "hexfall-language");
  assert.equal(isGameLocale("en"), true);
  assert.equal(isGameLocale("pt-BR"), true);
  assert.equal(isGameLocale("pt"), false);
  assert.equal(isGameLocale(null), false);
  assert.equal(localeFromCookieHeader("theme=dark; hexfall-locale=pt-BR; session=1"), "pt-BR");
  assert.equal(localeFromCookieHeader("hexfall-locale=%70%74%2D%42%52"), "pt-BR");
  assert.equal(localeFromCookieHeader("hexfall-locale=fr"), null);
  assert.equal(localeFromCookieHeader("other=pt-BR"), null);
  assert.equal(localeFromCookieHeader(null), null);
});

test("all hero, role, trait, component, and item definitions have complete Portuguese copy", () => {
  for (const id of Object.keys(HEROES) as HeroId[]) {
    const english = localizeHero("en", id);
    const portuguese = localizeHero("pt-BR", id);
    assert.equal(english, HEROES[id], `${id} keeps the canonical English definition`);
    assert.equal(portuguese.id, id);
    assert.notEqual(portuguese.title, english.title, `${id} title`);
    assert.notEqual(portuguese.ability.name, english.ability.name, `${id} ability name`);
    assert.notEqual(portuguese.ability.description, english.ability.description, `${id} ability description`);
    assert.notEqual(portuguese.ability.targetRule, english.ability.targetRule, `${id} target rule`);
    assert.equal(portuguese.cost, english.cost);
    assert.deepEqual(portuguese.traits, english.traits);
  }

  for (const id of Object.keys(ROLE_PROFILES) as Array<keyof typeof ROLE_PROFILES>) {
    const english = localizeRole("en", id);
    const portuguese = localizeRole("pt-BR", id);
    assert.equal(english, ROLE_PROFILES[id]);
    assert.notEqual(portuguese.label, english.label, `${id} label`);
    assert.notEqual(portuguese.description, english.description, `${id} description`);
    assert.equal(portuguese.range, english.range);
  }

  for (const id of Object.keys(TRAITS) as Array<keyof typeof TRAITS>) {
    const english = localizeTrait("en", id);
    const portuguese = localizeTrait("pt-BR", id);
    assert.equal(english, TRAITS[id]);
    assert.notEqual(portuguese.name, english.name, `${id} name`);
    assert.equal(portuguese.effects.length, english.effects.length);
    portuguese.effects.forEach((effect, index) => {
      assert.notEqual(effect, english.effects[index], `${id} effect ${index + 1}`);
    });
  }

  for (const id of Object.keys(ITEM_COMPONENTS) as ItemComponentId[]) {
    const english = localizeComponent("en", id);
    const portuguese = localizeComponent("pt-BR", id);
    assert.equal(english, ITEM_COMPONENTS[id]);
    assert.notEqual(portuguese.name, english.name, `${id} name`);
    assert.notEqual(portuguese.description, english.description, `${id} description`);
    assert.deepEqual(portuguese.enhancementBonuses, english.enhancementBonuses);
  }

  for (const id of Object.keys(ITEM_DEFINITIONS) as ItemId[]) {
    const english = localizeItem("en", id);
    const portuguese = localizeItem("pt-BR", id);
    assert.equal(english, ITEM_DEFINITIONS[id]);
    assert.notEqual(portuguese.name, english.name, `${id} name`);
    assert.notEqual(portuguese.description, english.description, `${id} description`);
    assert.deepEqual(portuguese.recipe, english.recipe);
    assert.deepEqual(portuguese.bonuses, english.bonuses);
  }
});

test("phase, outcome, rarity, static UI, and ability copy localize without changing English", () => {
  assert.equal(localizePhase("en", "planning"), "Planning");
  assert.equal(localizePhase("pt-BR", "planning"), "Planejamento");
  assert.equal(localizePhase("pt-BR", "resolution"), "Rodada concluída");
  assert.equal(localizeOutcome("pt-BR", "victory"), "Vitória");
  assert.equal(localizeOutcome("pt-BR", "defeat"), "Derrota");
  assert.equal(localizeRarity("pt-BR", "common"), "Comum");
  assert.equal(localizeRarity("pt-BR", "mythic"), "Mítico");
  assert.equal(localizeText("en", "Begin battle"), "Begin battle");
  assert.equal(localizeText("pt-BR", "Begin battle"), "Iniciar batalha");
  assert.equal(localizeText("pt-BR", "L"), "N");
  assert.equal(localizeText("pt-BR", "Round 4 complete"), "Rodada 4 concluída");
  assert.equal(localizeAbilityText("pt-BR", HEROES.boitata.ability.description), localizeHero("pt-BR", "boitata").ability.description);
  assert.equal(localizeAbilityText("pt-BR", "Item · +60 max Life"), "Item · +60 de Vida máxima");
  assert.match(
    localizeAbilityText("pt-BR", "Bench preview: deploy this character to activate formation bonds. Shield is the full amount granted."),
    /Prévia do banco.+Escudo é o valor total concedido/u,
  );
  assert.equal(localizeText("pt-BR", "Unrecognized proper noun"), "Unrecognized proper noun");
});

test("Portuguese number and list formatting uses Brazilian punctuation and conjunctions", () => {
  assert.equal(formatNumber("en", 1234.5, 2), "1,234.5");
  assert.equal(formatNumber("pt-BR", 1234.5, 2), "1.234,5");
  assert.equal(formatNumber("pt-BR", 0.65, 2), "0,65");
  assert.equal(formatList("en", ["Bramble", "Sol", "Nix"]), "Bramble, Sol, and Nix");
  assert.equal(formatList("pt-BR", ["Bramble", "Sol", "Nix"]), "Bramble, Sol e Nix");
});

function previewUnit(heroId: HeroId): UnitInstance {
  return {
    id: `preview-${heroId}`,
    heroId,
    side: "player",
    stars: 2,
    level: 3,
    xp: 0,
    position: 32,
    benchIndex: null,
    itemSlots: [null, null, null],
  };
}

test("ability scaling is generated from numeric preview values for every hero", () => {
  for (const id of Object.keys(HEROES) as HeroId[]) {
    const unit = previewUnit(id);
    const preview = getAbilityPreview(unit, [unit]);
    assert.equal(formatAbilityScaling("en", preview), preview.scalingDescription);
    const portuguese = formatAbilityScaling("pt-BR", preview);
    assert.notEqual(portuguese, preview.scalingDescription, id);
    assert.match(portuguese, /1★\/2★\/3★/u, id);
    assert.doesNotMatch(portuguese, /\b(?:Shields|Passively|Levitates|Hits|Strikes|Drains|Heals|Fires)\b/u, id);
  }

  const elphaba = previewUnit("elphaba");
  const preview = getAbilityPreview(elphaba, [elphaba]);
  assert.match(formatAbilityScaling("pt-BR", preview), /\(0,5\/0,65\/1\) segundos/u);
  const localized = localizeAbilityPreview("pt-BR", preview);
  assert.equal(localized.current, preview.current);
  assert.match(localized.contextNote, /vínculos ativos/u);
  assert.match(localized.scalingDescription, /dano verdadeiro/u);
});

test("dynamic action-result messages localize at the render boundary", () => {
  const examples: Array<[string, RegExp]> = [
    ["Need 3 more gold.", /Faltam 3 de ouro/u],
    ["Boitatá ascended to 2 stars.", /ascendeu para 2 estrelas/u],
    ["Bramble ascended to 2 stars. Bramble ascended to 3 stars.", /ascendeu para 2 estrelas\. Bramble ascendeu para 3 estrelas/u],
    ["Meat Gaga joined your bench.", /entrou no seu banco/u],
    ["Market refreshed for 2 gold.", /atualizado por 2 de ouro/u],
    ["Commander level 4. Team cap increased to 4.", /Comandante no nível 4/u],
    ["Team cap reached: 3/3.", /Limite da equipe atingido/u],
    ["Boitatá moved into formation.", /movido para a formação/u],
    ["Presa Infernal crafted.", /criado/u],
    ["Inferno Fang enhanced with Ember Shard.", /Presa Infernal aprimorado com Fragmento de Brasa/u],
    ["Cinderplate equipped to Bramble.", /Placa de Cinzas equipado em Bramble/u],
    ["Round 2. Ember Shard added to your component inventory. Scout the enemy and set your formation.", /Rodada 2.+Fragmento de Brasa/u],
  ];
  for (const [english, expected] of examples) {
    assert.match(localizeText("pt-BR", english), expected, english);
    assert.equal(localizeText("en", english), english);
  }

  const state = createInitialGame(101);
  const result = {
    ok: false,
    state,
    message: "The market is closed during combat.",
  };
  assert.equal(localizeActionResult("en", result), result);
  assert.equal(localizeActionResult("pt-BR", result).message, "O mercado fica fechado durante o combate.");
  assert.equal(result.message, "The market is closed during combat.");
});

function event(text: string, type: CombatEvent["type"] = "attack"): CombatEvent {
  return {
    id: `event-${text}`,
    timestamp: 1,
    turn: 1,
    type,
    text,
    snapshot: [],
  };
}

test("dynamic combat log lines localize while the canonical event remains English", () => {
  const examples: Array<[string, RegExp]> = [
    ["Round 3 begins. 2 allies face 1 enemies.", /A rodada 3 começa\. 2 aliados enfrentam 1 inimigo/u],
    ["Boitatá coils into Wall of Fire and gains 86 shield.", /Muralha de Fogo.+86 de escudo/u],
    ["Elphaba casts Defying Gravity and lifts 3 enemies.", /faz 3 inimigos levitarem/u],
    ["Sol casts Starfall on Bramble and Nix for 92 impact.", /conjura Chuva Estelar em Bramble e Nix, causando 92/u],
    ["Tide prepares 42 healing before the strike.", /prepara 42 de cura/u],
    ["Aster prepares 31 shield before the strike.", /prepara 31 de escudo/u],
    ["Nix is stunned and skips the action.", /está atordoado e perde a ação/u],
    ["Bramble is levitating and cannot act.", /está levitando e não pode agir/u],
    ["Bramble advances.", /Bramble avança/u],
    ["Bramble holds position.", /mantém a posição/u],
    ["Meat Gaga hurls stored meat at Nix for 52 damage (12 bonus).", /arremessa carne armazenada.+52 de dano \(12 adicional\)/u],
    ["Nix strikes Bramble for 24 damage.", /ataca Bramble e causa 24 de dano/u],
    ["Bramble is defeated.", /foi derrotado/u],
    ["Meat Gaga harvests 85 meat from 2 fallen characters.", /colhe 85 de carne de 2 personagens abatidos/u],
    ["Bramble and Nix fall from Elphaba's Defying Gravity, striking 2 nearby enemies for 34 true damage.", /Bramble e Nix caem.+34 de dano verdadeiro/u],
    ["The enemy line breaks. Victory.", /linha inimiga se rompe\. Vitória/u],
    ["Your formation falls. Commander loses 6 life.", /comandante perde 6 de Vida/u],
  ];
  for (const [english, expected] of examples) {
    const source = event(english);
    assert.match(localizeCombatEvent("pt-BR", source), expected, english);
    assert.equal(localizeCombatEvent("en", source), english);
    assert.equal(source.text, english);
  }
});

test("a resolved combat report can be rendered in Portuguese without mutating engine events", () => {
  const state = createInitialGame(0xdecafbad);
  const result = resolveCombat(state);
  assert.equal(result.ok, true);
  assert.ok(result.report);
  const translated = result.report.events.map((combatEvent) => localizeCombatEvent("pt-BR", combatEvent));
  assert.equal(translated.length, result.report.events.length);
  assert.ok(translated.every((line, index) => line !== result.report!.events[index].text));
  assert.match(translated[0], /A rodada 1 começa/u);
  assert.equal(result.report.events[0].text.startsWith("Round 1 begins"), true);
});
