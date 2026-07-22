import {
  HEROES,
  ITEM_COMPONENTS,
  ITEM_DEFINITIONS,
  ROLE_PROFILES,
  TRAITS,
  type AbilityPreview,
  type CombatEvent,
  type GameActionResult,
  type GamePhase,
  type HeroDefinition,
  type HeroId,
  type HeroRole,
  type ItemComponentDefinition,
  type ItemComponentId,
  type ItemDefinition,
  type ItemId,
  type Outcome,
  type TraitDefinition,
  type TraitId,
} from "./game-engine.ts";

/** The locales supported by both the persisted preference and the game UI. */
export const GAME_LOCALE_IDS = ["en", "pt-BR"] as const;
export type GameLocale = (typeof GAME_LOCALE_IDS)[number];

export const DEFAULT_GAME_LOCALE: GameLocale = "en";
export const LOCALE_COOKIE_KEY = "hexfall-locale";
export const LOCALE_STORAGE_KEY = "hexfall-language";

export const GAME_LOCALES: ReadonlyArray<{
  id: GameLocale;
  label: string;
  shortLabel: string;
}> = [
  { id: "en", label: "English", shortLabel: "EN" },
  { id: "pt-BR", label: "Português (Brasil)", shortLabel: "PT-BR" },
];

export const GAME_LOCALE_OPTIONS = GAME_LOCALES;

const INTL_LOCALES: Record<GameLocale, string> = {
  en: "en-US",
  "pt-BR": "pt-BR",
};

export function isGameLocale(value: unknown): value is GameLocale {
  return typeof value === "string" && (GAME_LOCALE_IDS as readonly string[]).includes(value);
}

export function localeFromCookieHeader(header: string | null | undefined): GameLocale | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== LOCALE_COOKIE_KEY) continue;
    const encodedValue = part.slice(separator + 1).trim().replace(/^"|"$/g, "");
    try {
      const value = decodeURIComponent(encodedValue);
      return isGameLocale(value) ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function formatNumber(
  locale: GameLocale,
  value: number,
  maxFractionDigits = 0,
): string {
  return new Intl.NumberFormat(INTL_LOCALES[locale], {
    maximumFractionDigits: Math.max(0, maxFractionDigits),
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatList(locale: GameLocale, items: readonly string[]): string {
  return new Intl.ListFormat(INTL_LOCALES[locale], {
    style: "long",
    type: "conjunction",
  }).format(items);
}

type HeroTranslation = Pick<HeroDefinition, "name" | "title"> & {
  ability: Pick<HeroDefinition["ability"], "name" | "description" | "targetRule">;
};

const PT_HEROES = {
  bramble: {
    name: "Bramble",
    title: "A Guarda-Raiz",
    ability: {
      name: "Muralha de Espinhos",
      description: "Recebe um escudo e restaura a Vida dos aliados adjacentes mais feridos, curando mais aliados com 3 estrelas.",
      targetRule: "Si e aliados adjacentes com menos Vida",
    },
  },
  boitata: {
    name: "Boitatá",
    title: "A Serpente de Brasas",
    ability: {
      name: "Muralha de Fogo",
      description: "Enrola-se em uma muralha de fogo e recebe um escudo igual a 20 + 7 por nível + 18% da Vida máxima + 105% da Armadura.",
      targetRule: "Si",
    },
  },
  "meat-gaga": {
    name: "Meat Gaga",
    title: "O Ícone Carnal",
    ability: {
      name: "Herança Carnal",
      description: "Colhe passivamente a Vida máxima de personagens abatidos e arremessa parte da carne armazenada como dano adicional em cada ataque básico.",
      targetRule: "Passiva · Cada personagem abatido",
    },
  },
  elphaba: {
    name: "Elphaba",
    title: "A Bruxa Esmeralda",
    ability: {
      name: "Desafiando a Gravidade",
      description: "Faz inimigos levitarem e depois os derruba sobre adversários próximos, causando dano verdadeiro com base na Vida atual e um breve atordoamento.",
      targetRule: "Inimigos com mais Vida atual",
    },
  },
  sol: {
    name: "Sol",
    title: "A Arauta da Alvorada",
    ability: {
      name: "Chuva Estelar",
      description: "Invoca uma estrela sobre o alvo e cada inimigo em uma casa adjacente.",
      targetRule: "Maior aglomerado de inimigos",
    },
  },
  nix: {
    name: "Nix",
    title: "A Lâmina do Véu",
    ability: {
      name: "Passo Sombrio",
      description: "Salta para perto do inimigo mais distante e ataca ignorando a Armadura dele.",
      targetRule: "Inimigo mais distante",
    },
  },
  aster: {
    name: "Aster",
    title: "A Lança Solar",
    ability: {
      name: "Investida Radiante",
      description: "Perfura o alvo atual, causa dano elevado e recebe um breve escudo.",
      targetRule: "Alvo atual",
    },
  },
  morrow: {
    name: "Morrow",
    title: "O Rei Oco",
    ability: {
      name: "Vínculo de Almas",
      description: "Drena Vida e Mana do inimigo com mais Mana.",
      targetRule: "Inimigo com mais Mana",
    },
  },
  tide: {
    name: "Tide",
    title: "A Água Serena",
    ability: {
      name: "Proteção das Marés",
      description: "Cura o aliado mais ferido e concede a ele um escudo protetor.",
      targetRule: "Aliado com menos Vida",
    },
  },
  vesper: {
    name: "Vesper",
    title: "A Palavra Silenciosa",
    ability: {
      name: "Silêncio",
      description: "Causa dano ao inimigo mais próximo de conjurar, drena Mana e o atordoa.",
      targetRule: "Inimigo com mais Mana",
    },
  },
  piper: {
    name: "Piper",
    title: "A Corda de Espinhos",
    ability: {
      name: "Rajada de Espinhos",
      description: "Dispara flechas imobilizadoras contra os inimigos mais fracos e lança uma terceira flecha com 3 estrelas.",
      targetRule: "Inimigos mais fracos",
    },
  },
} as const satisfies Record<HeroId, HeroTranslation>;

const PT_ROLES = {
  tank: {
    label: "Tanque",
    description: "Protetor da linha de frente que ataca alvos adjacentes.",
  },
  carry: {
    label: "Carregador",
    description: "Causador de dano da linha intermediária que ataca a até duas casas de distância.",
  },
  mage: {
    label: "Mago",
    description: "Conjurador da retaguarda que ataca a até três casas de distância.",
  },
  shooter: {
    label: "Atirador",
    description: "Especialista de longo alcance que ataca a até quatro casas de distância.",
  },
} as const satisfies Record<HeroRole, Pick<(typeof ROLE_PROFILES)[HeroRole], "label" | "description">>;

const PT_TRAITS = {
  vanguard: {
    name: "Vanguarda",
    effects: ["Todos os aliados recebem 15 de Armadura.", "Todos os aliados recebem 35 de Armadura."],
  },
  nightbound: {
    name: "Noturno",
    effects: ["Abates concedem 20 de Mana.", "Abates concedem 35 de Mana."],
  },
  invoker: {
    name: "Invocador",
    effects: ["Todos os aliados começam com 12 de Mana adicional.", "Todos os aliados começam com 28 de Mana adicional."],
  },
  duelist: {
    name: "Duelista",
    effects: ["Todos os aliados recebem 12% de Ataque.", "Todos os aliados recebem 28% de Ataque."],
  },
  verdant: {
    name: "Verdejante",
    effects: ["Conjurar habilidades restaura 8 de Vida dos aliados.", "Conjurar habilidades restaura 18 de Vida dos aliados."],
  },
  starborn: {
    name: "Estelar",
    effects: ["Habilidades causam 15% a mais de dano.", "Habilidades causam 30% a mais de dano."],
  },
  hexer: {
    name: "Feiticeiro",
    effects: ["Alvos de habilidades perdem 12 de Mana.", "Alvos de habilidades perdem 25 de Mana."],
  },
} as const satisfies Record<TraitId, Pick<TraitDefinition, "name" | "effects">>;

const PT_COMPONENTS = {
  ember: {
    name: "Fragmento de Brasa",
    description: "Adiciona poder de Ataque bruto ao aprimorar um item.",
  },
  scale: {
    name: "Escama de Ferro",
    description: "Adiciona Vida e Armadura ao aprimorar um item.",
  },
  mote: {
    name: "Partícula de Mana",
    description: "Adiciona Mana inicial ao aprimorar um item.",
  },
} as const satisfies Record<ItemComponentId, Pick<ItemComponentDefinition, "name" | "description">>;

const PT_ITEMS = {
  "inferno-fang": {
    name: "Presa Infernal",
    description: "Uma arma implacável forjada com brasas gêmeas.",
  },
  cinderplate: {
    name: "Placa de Cinzas",
    description: "Proteção pesada que fortalece seu portador contra ataques concentrados.",
  },
  "spirit-lantern": {
    name: "Lanterna Espiritual",
    description: "Armazena poder para que seu portador possa conjurar mais cedo.",
  },
  "blazing-aegis": {
    name: "Égide Flamejante",
    description: "Equilibra calor ofensivo com resistência na linha de frente.",
  },
  spellfang: {
    name: "Presa Arcana",
    description: "Transforma magia armazenada em um ataque inicial cortante.",
  },
  "warding-flame": {
    name: "Chama Protetora",
    description: "Um amuleto protetor que também acelera a primeira conjuração.",
  },
} as const satisfies Record<ItemId, Pick<ItemDefinition, "name" | "description">>;

export function localizeHero(locale: GameLocale, id: HeroId): HeroDefinition {
  const hero = HEROES[id];
  if (locale === "en") return hero;
  const copy = PT_HEROES[id];
  return { ...hero, ...copy, ability: { ...hero.ability, ...copy.ability } };
}

export function localizeRole(locale: GameLocale, id: HeroRole): (typeof ROLE_PROFILES)[HeroRole] {
  const role = ROLE_PROFILES[id];
  return locale === "en" ? role : { ...role, ...PT_ROLES[id] };
}

export function localizeTrait(locale: GameLocale, id: TraitId): TraitDefinition {
  const trait = TRAITS[id];
  if (locale === "en") return trait;
  const copy = PT_TRAITS[id];
  return { ...trait, name: copy.name, effects: [...copy.effects] };
}

export function localizeItem(locale: GameLocale, id: ItemId): ItemDefinition {
  const item = ITEM_DEFINITIONS[id];
  return locale === "en" ? item : { ...item, ...PT_ITEMS[id] };
}

export function localizeComponent(locale: GameLocale, id: ItemComponentId): ItemComponentDefinition {
  const component = ITEM_COMPONENTS[id];
  return locale === "en" ? component : { ...component, ...PT_COMPONENTS[id] };
}

const PHASE_LABELS: Record<GameLocale, Record<GamePhase, string>> = {
  en: {
    planning: "Planning",
    combat: "Combat",
    resolution: "Round complete",
    gameover: "Campaign complete",
  },
  "pt-BR": {
    planning: "Planejamento",
    combat: "Combate",
    resolution: "Rodada concluída",
    gameover: "Campanha concluída",
  },
};

const OUTCOME_LABELS: Record<GameLocale, Record<Outcome, string>> = {
  en: { victory: "Victory", defeat: "Defeat" },
  "pt-BR": { victory: "Vitória", defeat: "Derrota" },
};

const RARITY_LABELS = {
  en: { common: "Common", uncommon: "Uncommon", rare: "Rare", mythic: "Mythic" },
  "pt-BR": { common: "Comum", uncommon: "Incomum", rare: "Raro", mythic: "Mítico" },
} as const;

export function localizePhase(locale: GameLocale, phase: GamePhase): string {
  return PHASE_LABELS[locale][phase];
}

export function localizeOutcome(locale: GameLocale, outcome: Outcome): string {
  return OUTCOME_LABELS[locale][outcome];
}

export function localizeRarity(
  locale: GameLocale,
  rarity: HeroDefinition["rarity"],
): string {
  return RARITY_LABELS[locale][rarity];
}

/**
 * English source strings are stable keys. Keeping them out of game state makes
 * saved matches and deterministic combat reports locale-independent.
 */
const PT_UI_TEXT: Readonly<Record<string, string>> = {
  "HEXFALL — Turn-based tactical board battler": "HEXFALL — Batalha tática de tabuleiro em turnos",
  "Build a team, shape its bonds, and command every turn in an original tactical fantasy board battler.": "Monte uma equipe, fortaleça seus vínculos e comande cada turno em uma batalha tática de fantasia original.",
  "HEXFALL tactical arena": "Arena tática de HEXFALL",
  "Build your bond. Break their line.": "Forme seu vínculo. Rompa a linha inimiga.",
  "A fresh campaign was started because the saved match could not be restored.": "Uma nova campanha foi iniciada porque não foi possível restaurar a partida salva.",
  "A new campaign begins.": "Uma nova campanha começa.",
  "Language": "Idioma",
  "Game language": "Idioma do jogo",
  "English": "Inglês",
  "Portuguese (Brazil)": "Português (Brasil)",
  "Round": "Rodada",
  "Step": "Etapa",
  "of": "de",
  "MAX": "MÁX.",
  "Commander life": "Vida do comandante",
  "Level": "Nível",
  "L": "N",
  "Gold": "Ouro",
  "Interest": "Juros",
  "How to play": "Como jogar",
  "Tutorial": "Tutorial",
  "First battle": "Primeira batalha",
  "Recruit a hero from the Night Market.": "Recrute um herói no Mercado Noturno.",
  "Drag an ally to a teal tile or the bench to move or swap.": "Arraste um aliado para uma casa turquesa ou para o banco para mover ou trocar.",
  "When your formation is ready, begin battle.": "Quando sua formação estiver pronta, inicie a batalha.",
  "Skip tutorial": "Pular tutorial",
  "Active traits": "Características ativas",
  "Formation": "Formação",
  "Active bonds": "Vínculos ativos",
  "Inactive": "Inativo",
  "Tactical note": "Nota tática",
  "Vanguards harden the whole team. Invokers accelerate the first cast. Select a bond to reveal its champions.": "Vanguardas fortalecem toda a equipe. Invocadores aceleram a primeira conjuração. Selecione um vínculo para revelar seus campeões.",
  "Mooncrest arena": "Arena Mooncrest",
  "Hold the lower line": "Defenda a linha inferior",
  "Enemy territory": "Território inimigo",
  "Player territory": "Território do jogador",
  "Eight column by six row battle board": "Tabuleiro de batalha com oito colunas e seis linhas",
  "Bench": "Banco",
  "reserves": "reservas",
  "Your territory": "Seu território",
  "deployed": "posicionados",
  "Relic Forge inventory": "Inventário da Forja de Relíquias",
  "Left bay": "Ala esquerda",
  "Forge": "Forja",
  "parts": "peças",
  "gear": "itens",
  "Forge components": "Componentes da forja",
  "Crafted gear inventory": "Inventário de itens forjados",
  "Gear": "Itens",
  "Relic Forge": "Forja de Relíquias",
  "Components & gear": "Componentes e itens",
  "Close Relic Forge": "Fechar a Forja de Relíquias",
  "This Forge occupies the left arena bay. A component arrives every other round. Combine two for gear, then drag gear onto a champion to equip it or drag a component onto a champion with full gear to enhance it.": "Esta Forja ocupa a ala esquerda da arena. Um componente chega a cada duas rodadas. Combine dois para criar um item; depois, arraste o item até um campeão para equipá-lo ou arraste um componente até um campeão com um item completo para aprimorá-lo.",
  "New component": "Novo componente",
  "Item components": "Componentes de item",
  "Crafting tray": "Bandeja de criação",
  "Component": "Componente",
  "Recipe ready": "Receita pronta",
  "Choose one more": "Escolha mais um",
  "Craft full item": "Criar item completo",
  "2 components → full item": "2 componentes → item completo",
  "Inventory": "Inventário",
  "Crafted gear": "Itens forjados",
  "Select an allied champion to equip": "Selecione um campeão aliado para equipar",
  "Your first full item can be forged after collecting two components.": "Seu primeiro item completo pode ser forjado após coletar dois componentes.",
  "Enhance with 1 component": "Aprimorar com 1 componente",
  "Click any character to inspect. Drag allies between teal tiles and the bench to place or swap.": "Clique em qualquer personagem para inspecioná-lo. Arraste aliados entre casas turquesa e o banco para posicionar ou trocar.",
  "Unit inspector": "Inspetor de unidade",
  "Enemy scout report": "Relatório de reconhecimento inimigo",
  "Your champion": "Seu campeão",
  "Enemy champion": "Campeão inimigo",
  "HP": "Vida",
  "Resource": "Recurso",
  "Passive · No Mana": "Passiva · Sem Mana",
  "PASSIVE · NO MANA": "PASSIVA · SEM MANA",
  "Mana": "Mana",
  "Damage": "Dano",
  "Armor": "Armadura",
  "Attack speed": "Velocidade de ataque",
  "Move speed": "Velocidade de movimento",
  "Meat reserve": "Reserva de carne",
  "Mana regen": "Regeneração de Mana",
  "Wall of Fire": "Muralha de Fogo",
  "Other shields": "Outros escudos",
  "Shield": "Escudo",
  "Equipment": "Equipamento",
  "Item slots": "Espaços de item",
  "Slot": "Espaço",
  "Equip selected item": "Equipar item selecionado",
  "Empty": "Vazio",
  "Combat role · Basic attack range": "Função de combate · Alcance do ataque básico",
  "Range": "Alcance",
  "tile": "casa",
  "tiles": "casas",
  "full": "completo",
  "enhanced": "aprimorado",
  "Row": "Linha",
  "column": "coluna",
  "player": "jogador",
  "enemy": "inimigo",
  "territory": "território",
  "range": "alcance",
  "level": "nível",
  "percent health": "por cento de Vida",
  "shield": "escudo",
  "empty": "vazio",
  "available": "disponíveis",
  "selected": "selecionados",
  "Stored per death": "Armazenado por morte",
  "Spent per attack": "Gasto por ataque",
  "Current reserve": "Reserva atual",
  "Next attack bonus": "Bônus do próximo ataque",
  "Passive: Every character death · Enhances each basic attack while reserve remains": "Passiva: Toda morte de personagem · Fortalece cada ataque básico enquanto houver reserva",
  "Hover or tap for star scaling": "Passe o mouse ou toque para ver a progressão por estrelas",
  "Passive star scaling": "Progressão da passiva por estrelas",
  "No Mana, regeneration, or cast time": "Sem Mana, regeneração ou tempo de conjuração",
  "Whenever any character dies, Meat Gaga stores part of that character's maximum Life. Her next basic attack consumes part of the reserve as raw bonus damage, repeating until the reserve is empty.": "Sempre que qualquer personagem morre, Meat Gaga armazena parte da Vida máxima dele. Seu próximo ataque básico consome parte da reserva como dano bruto adicional, repetindo até a reserva acabar.",
  "Value": "Valor",
  "Max HP stored per death": "Vida máxima armazenada por morte",
  "Stack spent per attack": "Reserva gasta por ataque",
  "The reserve is not Mana. Meat Gaga never casts; every empowered hit is still a basic attack and keeps her Shooter range.": "A reserva não é Mana. Meat Gaga nunca conjura; cada golpe fortalecido ainda é um ataque básico e mantém seu alcance de Atirador.",
  "Star scaling": "Progressão por estrelas",
  "Current": "Atual",
  "Ability": "Habilidade",
  "Targets": "Alvos",
  "Same level, equipment, and bonds": "Mesmo nível, equipamento e vínculos",
  "Included ability modifiers": "Modificadores de habilidade incluídos",
  "Included": "Incluídos",
  "Live chronicle": "Crônica ao vivo",
  "Combat log": "Registro de combate",
  "Scout report": "Relatório de reconhecimento",
  "units": "unidades",
  "Read their line": "Analise a formação inimiga",
  "Coral champions begin above the center. Inspect any unit to learn its range, defenses, and casting rule.": "Os campeões de coral começam acima do centro. Inspecione qualquer unidade para conhecer seu alcance, suas defesas e sua regra de conjuração.",
  "Night Market": "Mercado Noturno",
  "Recruitment": "Recrutamento",
  "Recruit": "Recrutar",
  "copies": "cópias",
  "character combat contributions": "contribuições de combate dos personagens",
  "Select or drag onto a champion.": "Selecione ou arraste até um campeão.",
  "Add to the forge or drag onto a champion to enhance gear.": "Adicione à forja ou arraste até um campeão para aprimorar um item.",
  "Add": "Adicionar",
  "to forge, or drag it onto a champion to enhance equipped full gear": "à forja ou arraste-o até um campeão para aprimorar o item completo equipado",
  "Bench slot": "Espaço do banco",
  "click to unequip": "clique para remover",
  "Empty item slot": "Espaço de item vazio",
  "equip": "equipar",
  "Equip to": "Equipar em",
  "Equip selected champion": "Equipar no campeão selecionado",
  "Enhance full gear for": "Aprimorar o item completo de",
  "Enhance selected champion's gear": "Aprimorar o item do campeão selecionado",
  "current values": "valores atuais",
  "values by star level": "valores por nível de estrela",
  "item slots": "espaços de item",
  "Locked": "Bloqueado",
  "Refreshes next round": "Atualiza na próxima rodada",
  "Sold": "Vendido",
  "Copies": "Cópias",
  "Copies toward next star": "Cópias para a próxima estrela",
  "Round actions": "Ações da rodada",
  "Income": "Renda",
  "Next income": "Próxima renda",
  "base": "base",
  "interest": "juros",
  "streak": "sequência",
  "Refresh shop": "Atualizar loja",
  "Unlock shop": "Desbloquear loja",
  "Lock shop": "Bloquear loja",
  "Buy": "Comprar",
  "Sell for": "Vender por",
  "Begin battle": "Iniciar batalha",
  "Combat time": "Tempo de combate",
  "Outcome ready": "Resultado pronto",
  "Moment": "Momento",
  "action": "ação",
  "actions": "ações",
  "playback": "reprodução",
  "Complete": "Concluído",
  "Pause": "Pausar",
  "Play": "Reproduzir",
  "Next moment": "Próximo momento",
  "Speed": "Velocidade",
  "Skip to result": "Ir para o resultado",
  "Claim result": "Receber resultado",
  "Round resolved": "Rodada resolvida",
  "Continue to round": "Continuar para a rodada",
  "Review the result to continue": "Revise o resultado para continuar",
  "Round complete": "Rodada concluída",
  "The line holds.": "A linha resistiu.",
  "The line broke.": "A linha foi rompida.",
  "Your bond outlasted Mooncrest.": "Seu vínculo superou Mooncrest.",
  "Gold earned": "Ouro recebido",
  "Commander XP": "XP do comandante",
  "Unit XP": "XP da unidade",
  "Unit level": "Nível da unidade",
  "Streak": "Sequência",
  "Continue": "Continuar",
  "Campaign complete": "Campanha concluída",
  "HEXFALL answered your call.": "HEXFALL respondeu ao seu chamado.",
  "Mooncrest claims the arena.": "Mooncrest conquista a arena.",
  "Play again": "Jogar novamente",
  "Your team": "Sua equipe",
  "champion": "campeão",
  "champions": "campeões",
  "Damage dealt": "Dano causado",
  "Shield granted": "Escudo concedido",
  "Effective healing": "Cura efetiva",
  "Character": "Personagem",
  "Healing": "Cura",
  "Match report": "Relatório da partida",
  "Combat breakdown": "Detalhamento do combate",
  "Damage includes health and shields removed. Shield measures protection granted. Healing counts life actually restored.": "O dano inclui Vida e escudos removidos. Escudo mede a proteção concedida. Cura contabiliza a Vida realmente restaurada.",
  "Raw damage": "Dano bruto",
  "True damage": "Dano verdadeiro",
  "Landing true damage": "Dano verdadeiro da queda",
  "current Life": "Vida atual",
  "Allies healed": "Aliados curados",
  "Target": "Alvo",
  "Enemies hit": "Inimigos atingidos",
  "Enemies drained": "Inimigos drenados",
  "Enemies levitated": "Inimigos levitados",
  "Levitation": "Levitação",
  "Landing stun": "Atordoamento da queda",
  "Projectiles": "Projéteis",
  "Mana drain": "Dreno de Mana",
  "Stun": "Atordoamento",
  "Self-heal": "Cura própria",
  "Team heal": "Cura da equipe",
  "Self": "Si",
  "SHIELD": "ESCUDO",
  "MEAT": "CARNE",
  "BLOCK": "BLOQUEIO",
  "MOVE": "MOVER",
  "STUNNED": "ATORDOADO",
  "HOLD": "MANTER",
  "DEFY GRAVITY": "DESAFIAR A GRAVIDADE",
  "GRAVITY": "GRAVIDADE",
  "STARFALL": "CHUVA ESTELAR",
  "MEAT THROW": "ARREMESSO DE CARNE",
  "HARVEST": "COLHEITA",
  "WALL": "MURALHA",
  "CAST": "CONJURAR",
  "ATTACK": "ATACAR",
  "Stunned": "Atordoado",
  "FANG": "PRESA",
  "PLATE": "PLACA",
  "LAMP": "LANTERNA",
  "AEGIS": "ÉGIDE",
  "SPELL": "ARCANO",
  "WARD": "PROTEÇÃO",
  "Welcome to HEXFALL. Set your formation, then begin battle.": "Boas-vindas a HEXFALL. Organize sua formação e depois inicie a batalha.",
  "The forge opens during planning.": "A forja abre durante o planejamento.",
  "The forge tray holds two components. Remove one to change the recipe.": "A bandeja da forja comporta dois componentes. Remova um para alterar a receita.",
  "Choose two components to craft a full item.": "Escolha dois componentes para criar um item completo.",
  "Select one full item and one component to enhance it.": "Selecione um item completo e um componente para aprimorá-lo.",
  "Select one of your champions and an item from the forge.": "Selecione um de seus campeões e um item da forja.",
  "starting mana has no effect": "Mana inicial não tem efeito",
  "complete": "concluído",
  "gold": "ouro",
  "mana": "Mana",
  "max HP": "Vida máxima",
  "of stack": "da reserva",
  "raw": "bruto",
  "sec": "s",
  "victory": "vitória",
};

const ABILITY_EXACT = new Map<string, string>(
  (Object.keys(HEROES) as HeroId[]).flatMap((id) => {
    const source = HEROES[id].ability;
    const target = PT_HEROES[id].ability;
    return [
      [source.name, target.name],
      [source.description, target.description],
      [source.targetRule, target.targetRule],
    ] as Array<[string, string]>;
  }),
);

function localizedDefinitionName(name: string): string {
  for (const id of Object.keys(HEROES) as HeroId[]) {
    if (HEROES[id].name === name) return PT_HEROES[id].name;
  }
  for (const id of Object.keys(ITEM_COMPONENTS) as ItemComponentId[]) {
    if (ITEM_COMPONENTS[id].name === name || `${ITEM_COMPONENTS[id].name}s` === name) return PT_COMPONENTS[id].name;
  }
  for (const id of Object.keys(ITEM_DEFINITIONS) as ItemId[]) {
    if (ITEM_DEFINITIONS[id].name === name) return PT_ITEMS[id].name;
  }
  return name;
}

function localizeGameMessagePt(text: string): string {
  const exact = PT_UI_TEXT[text];
  if (exact) return exact;
  const abilityExact = ABILITY_EXACT.get(text);
  if (abilityExact) return abilityExact;

  const chainedAscensions = text.match(/[^.]+ ascended to \d+ stars\./g)?.map((message) => message.trim());
  if (chainedAscensions && chainedAscensions.length > 1 && chainedAscensions.join(" ") === text) {
    return chainedAscensions.map((message) => localizeGameMessagePt(message)).join(" ");
  }

  let match: RegExpMatchArray | null;
  if ((match = text.match(/^Enhanced (.+)$/))) return `${localizedDefinitionName(match[1])} aprimorado`;
  if ((match = text.match(/^Round (\d+) complete$/))) return `Rodada ${match[1]} concluída`;
  if ((match = text.match(/^Equipped: (.+)$/))) return `Equipado: ${match[1]}`;
  if ((match = text.match(/^Up to (\d+(?:[.,]\d+)?)$/))) return `Até ${match[1]}`;
  if ((match = text.match(/^(\d+) stars?$/))) return `${match[1]} ${match[1] === "1" ? "estrela" : "estrelas"}`;
  if ((match = text.match(/^(\d+(?:[.,]\d+)?) actions?$/))) return `${match[1]} ${match[1] === "1" ? "ação" : "ações"}`;
  if ((match = text.match(/^(\d+(?:[.,]\d+)?) each$/))) return `${match[1]} para cada`;
  if ((match = text.match(/^\+(\d+) HP$/))) return `+${match[1]} de Vida`;
  if ((match = text.match(/^\+(\d+) damage$/))) return `+${match[1]} de dano`;
  if ((match = text.match(/^\+(\d+) armor$/))) return `+${match[1]} de Armadura`;
  if ((match = text.match(/^\+(\d+) starting mana$/))) return `+${match[1]} de Mana inicial`;
  if ((match = text.match(/^(.+) meat stack (\d+)$/))) return `Reserva de carne de ${match[1]}: ${match[2]}`;
  if ((match = text.match(/^(.+) health (\d+) of (\d+)(?:, shield (\d+))?$/))) {
    return `Vida de ${match[1]}: ${match[2]} de ${match[3]}${match[4] ? `, escudo ${match[4]}` : ""}`;
  }
  if ((match = text.match(/^(.+) mana (\d+) of (\d+)$/))) return `Mana de ${match[1]}: ${match[2]} de ${match[3]}`;
  if ((match = text.match(/^(.+) uses a passive and has no mana$/))) return `${match[1]} usa uma passiva e não possui Mana`;
  if ((match = text.match(/^Levitating until (.+)$/))) return `Levitando até ${match[1]}`;
  if ((match = text.match(/^Stunned until (.+)$/))) return `Atordoado até ${match[1]}`;
  if ((match = text.match(/^(.+) character combat contributions$/))) return `Contribuições de combate dos personagens de ${match[1]}`;
  if ((match = text.match(/^Row (\d+), column (\d+), (player|enemy) territory(.*)$/))) {
    const details = match[4]
      .replace(/, range /g, ", alcance ")
      .replace(/, level /g, ", nível ")
      .replace(/, (\d+) percent health/g, ", $1% de Vida")
      .replace(/, (\d+) shield/g, ", $1 de escudo")
      .replace(/, empty$/g, ", vazio");
    return `Linha ${match[1]}, coluna ${match[2]}, território ${match[3] === "player" ? "do jogador" : "inimigo"}${details}`;
  }
  if ((match = text.match(/^(.+), (\d+) available\. Add to the forge or drag onto a champion to enhance gear\.$/))) return `${match[1]}, ${match[2]} disponíveis. Adicione à forja ou arraste até um campeão para aprimorar um item.`;
  if ((match = text.match(/^(.+), (\d+) available\. Select or drag onto a champion\.$/))) return `${match[1]}, ${match[2]} disponíveis. Selecione ou arraste até um campeão.`;
  if ((match = text.match(/^(.+)\. Select or drag onto a champion\.$/))) return `${match[1]}. Selecione ou arraste até um campeão.`;
  if ((match = text.match(/^Add (.+) to forge, or drag it onto a champion to enhance equipped full gear, (\d+) available(?:, (\d+) selected)?$/))) return `Adicionar ${match[1]} à forja ou arrastá-lo até um campeão para aprimorar o item completo equipado; ${match[2]} disponíveis${match[3] ? `, ${match[3]} selecionados` : ""}`;
  if ((match = text.match(/^Equip to (.+)$/))) return `Equipar em ${match[1]}`;
  if (text === "Equip selected champion") return "Equipar no campeão selecionado";
  if ((match = text.match(/^Enhance (.+)'s full gear$/))) return `Aprimorar o item completo de ${match[1]}`;
  if (text === "Enhance selected champion's gear") return "Aprimorar o item do campeão selecionado";
  if ((match = text.match(/^(.+) item slots$/))) return `Espaços de item de ${match[1]}`;
  if ((match = text.match(/^(.+), (.+), click to unequip$/))) return `${match[1]}, ${match[2]}, clique para remover`;
  if ((match = text.match(/^(.+) current values$/))) return `Valores atuais de ${match[1]}`;
  if ((match = text.match(/^(.+) values by star level$/))) return `Valores de ${match[1]} por nível de estrela`;
  if ((match = text.match(/^Recruit (.+), (.+), range (\d+), copies (\d+) of (\d+), (\d+) gold$/))) return `Recrutar ${match[1]}, ${match[2]}, alcance ${match[3]}, ${match[4]} cópias de ${match[5]}, ${match[6]} de ouro`;
  if ((match = text.match(/^No more (.+) components are available\.$/))) return `Não há mais componentes ${localizedDefinitionName(match[1])} disponíveis.`;
  if ((match = text.match(/^Equipping (.+)$/))) return `Equipando ${match[1]}`;
  if ((match = text.match(/^Empty item slot (\d+)(?:, equip (.+))?$/))) return `Espaço de item ${match[1]} vazio${match[2] ? `, equipar ${match[2]}` : ""}`;
  if ((match = text.match(/^Slot (\d+)$/))) return `Espaço ${match[1]}`;
  if ((match = text.match(/^Bench slot (\d+), empty$/))) return `Espaço ${match[1]} do banco, vazio`;
  if ((match = text.match(/^Empty craft slot (\d+)$/))) return `Espaço de criação ${match[1]} vazio`;
  if ((match = text.match(/^Remove (.+) from forge$/))) return `Remover ${localizedDefinitionName(match[1])} da forja`;
  if ((match = text.match(/^The commander lost (\d+) life, but the campaign continues\.$/))) return `O comandante perdeu ${match[1]} de Vida, mas a campanha continua.`;
  if ((match = text.match(/^You survived all (\d+) rounds with (\d+) commander life\.$/))) return `Você sobreviveu às ${match[1]} rodadas com ${match[2]} de Vida do comandante.`;
  if ((match = text.match(/^You reached round (\d+)\. Rebuild the bond and try a new formation\.$/))) return `Você chegou à rodada ${match[1]}. Refaça o vínculo e tente uma nova formação.`;

  // GameActionResult messages. These remain English inside deterministic state.
  const fixedActionMessages: Record<string, string> = {
    "The market is closed during combat.": "O mercado fica fechado durante o combate.",
    "That offer is no longer available.": "Essa oferta não está mais disponível.",
    "Your bench is full.": "Seu banco está cheio.",
    "You cannot refresh the market during combat.": "Você não pode atualizar o mercado durante o combate.",
    "A new market has arrived.": "Um novo mercado chegou.",
    "Training pauses during combat.": "O treinamento pausa durante o combate.",
    "You are already at maximum commander level.": "Você já está no nível máximo de comandante.",
    "Formation is locked during combat.": "A formação fica bloqueada durante o combate.",
    "That unit is no longer available.": "Essa unidade não está mais disponível.",
    "Allies can only be placed in your territory.": "Aliados só podem ser posicionados no seu território.",
    "That bench slot does not exist.": "Esse espaço do banco não existe.",
    "Units cannot be sold during combat.": "Unidades não podem ser vendidas durante o combate.",
    "Items can only be crafted between combats.": "Itens só podem ser criados entre combates.",
    "Those components do not form an item.": "Esses componentes não formam um item.",
    "Items can only be enhanced between combats.": "Itens só podem ser aprimorados entre combates.",
    "That item is not in your inventory.": "Esse item não está no seu inventário.",
    "That item is already enhanced.": "Esse item já está aprimorado.",
    "That champion is no longer available.": "Esse campeão não está mais disponível.",
    "Equip a full item to this champion before enhancing it.": "Equipe um item completo neste campeão antes de aprimorá-lo.",
    "Items can only be equipped between combats.": "Itens só podem ser equipados entre combates.",
    "That item slot does not exist.": "Esse espaço de item não existe.",
    "That item slot is already occupied.": "Esse espaço de item já está ocupado.",
    "Items can only be unequipped between combats.": "Itens só podem ser removidos entre combates.",
    "That item slot is empty.": "Esse espaço de item está vazio.",
    "This round is already in progress.": "Esta rodada já está em andamento.",
    "Deploy at least one ally before battle.": "Posicione pelo menos um aliado antes da batalha.",
    "Your formation exceeds the team cap.": "Sua formação excede o limite da equipe.",
    "No combat result is waiting.": "Não há resultado de combate aguardando.",
    "That combat result belongs to another round.": "Esse resultado de combate pertence a outra rodada.",
    "Victory rewards claimed.": "Recompensas da vitória recebidas.",
    "Defeat resolved. Regroup for the next round.": "Derrota resolvida. Reorganize-se para a próxima rodada.",
    "Finish the current round first.": "Conclua a rodada atual primeiro.",
    "The market cannot be changed during combat.": "O mercado não pode ser alterado durante o combate.",
    "Market locked for the next round.": "Mercado bloqueado para a próxima rodada.",
    "Market will refresh next round.": "O mercado será atualizado na próxima rodada.",
  };
  if (fixedActionMessages[text]) return fixedActionMessages[text];

  if ((match = text.match(/^Need (\d+) more gold\.$/))) return `Faltam ${match[1]} de ouro.`;
  if ((match = text.match(/^(.+) ascended to (\d+) stars\.$/))) return `${localizedDefinitionName(match[1])} ascendeu para ${match[2]} estrelas.`;
  if ((match = text.match(/^(.+) joined your bench\.$/))) return `${localizedDefinitionName(match[1])} entrou no seu banco.`;
  if ((match = text.match(/^Market refreshed for (\d+) gold\.$/))) return `Mercado atualizado por ${match[1]} de ouro.`;
  if ((match = text.match(/^Commander level (\d+)\. Team cap increased to (\d+)\.$/))) return `Comandante no nível ${match[1]}. Limite da equipe aumentado para ${match[2]}.`;
  if ((match = text.match(/^Gained (\d+) commander XP\.$/))) return `Você recebeu ${match[1]} de XP de comandante.`;
  if ((match = text.match(/^Team cap reached: (\d+)\/(\d+)\.$/))) return `Limite da equipe atingido: ${match[1]}/${match[2]}.`;
  if ((match = text.match(/^(.+) moved into formation\.$/))) return `${localizedDefinitionName(match[1])} foi movido para a formação.`;
  if ((match = text.match(/^(.+) sold for (\d+) gold\.$/))) return `${localizedDefinitionName(match[1])} foi vendido por ${match[2]} de ouro.`;
  if ((match = text.match(/^Need (\d+) (.+?)(s)?\.$/))) return `É necessário ${match[1]} ${localizedDefinitionName(match[2])}.`;
  if ((match = text.match(/^(.+) crafted\.$/))) return `${localizedDefinitionName(match[1])} criado.`;
  if ((match = text.match(/^(.+) on (.+) enhanced with (.+)\.$/))) return `${localizedDefinitionName(match[1])} de ${localizedDefinitionName(match[2])} aprimorado com ${localizedDefinitionName(match[3])}.`;
  if ((match = text.match(/^(.+) enhanced with (.+)\.$/))) return `${localizedDefinitionName(match[1])} aprimorado com ${localizedDefinitionName(match[2])}.`;
  if ((match = text.match(/^(.+) equipped to (.+)\.$/))) return `${localizedDefinitionName(match[1])} equipado em ${localizedDefinitionName(match[2])}.`;
  if ((match = text.match(/^(.+) returned to inventory\.$/))) return `${localizedDefinitionName(match[1])} devolvido ao inventário.`;
  if ((match = text.match(/^Round (\d+) combat started\.$/))) return `O combate da rodada ${match[1]} começou.`;
  if ((match = text.match(/^Round (\d+)\. (.+) added to your component inventory\. Scout the enemy and set your formation\.$/))) {
    return `Rodada ${match[1]}. ${localizedDefinitionName(match[2])} foi adicionado ao inventário de componentes. Observe o inimigo e organize sua formação.`;
  }
  if ((match = text.match(/^Round (\d+)\. Scout the enemy and set your formation\.$/))) return `Rodada ${match[1]}. Observe o inimigo e organize sua formação.`;

  // CombatEvent texts.
  if ((match = text.match(/^Round (\d+) begins\. (\d+) allies face (\d+) enemies\.$/))) {
    return `A rodada ${match[1]} começa. ${match[2]} ${match[2] === "1" ? "aliado enfrenta" : "aliados enfrentam"} ${match[3]} ${match[3] === "1" ? "inimigo" : "inimigos"}.`;
  }
  if ((match = text.match(/^(.+) coils into (.+) and gains (\d+) shield\.$/))) return `${match[1]} se enrola em ${localizeAbilityText("pt-BR", match[2])} e recebe ${match[3]} de escudo.`;
  if ((match = text.match(/^(.+) casts Defying Gravity and lifts (\d+) (?:enemy|enemies)\.$/))) return `${match[1]} conjura Desafiando a Gravidade e faz ${match[2]} ${match[2] === "1" ? "inimigo levitar" : "inimigos levitarem"}.`;
  if ((match = text.match(/^(.+) casts (.+?)(?: on (.+?))?(?: for (\d+) impact)?\.$/))) {
    const targets = match[3]?.replaceAll(" and ", " e ");
    return `${match[1]} conjura ${localizeAbilityText("pt-BR", match[2])}${targets ? ` em ${targets}` : ""}${match[4] ? `, causando ${match[4]} de impacto` : ""}.`;
  }
  if ((match = text.match(/^(.+) prepares (\d+) healing before the strike\.$/))) return `${match[1]} prepara ${match[2]} de cura antes do golpe.`;
  if ((match = text.match(/^(.+) prepares (\d+) shield before the strike\.$/))) return `${match[1]} prepara ${match[2]} de escudo antes do golpe.`;
  if ((match = text.match(/^(.+) is stunned and skips the action\.$/))) return `${match[1]} está atordoado e perde a ação.`;
  if ((match = text.match(/^(.+) is levitating and cannot act\.$/))) return `${match[1]} está levitando e não pode agir.`;
  if ((match = text.match(/^(.+) advances\.$/))) return `${match[1]} avança.`;
  if ((match = text.match(/^(.+) holds position\.$/))) return `${match[1]} mantém a posição.`;
  if ((match = text.match(/^(.+) hurls stored meat at (.+) for (\d+) damage \((\d+) bonus\)\.$/))) return `${match[1]} arremessa carne armazenada em ${match[2]} e causa ${match[3]} de dano (${match[4]} adicional).`;
  if ((match = text.match(/^(.+) strikes (.+) for (\d+) damage\.$/))) return `${match[1]} ataca ${match[2]} e causa ${match[3]} de dano.`;
  if ((match = text.match(/^(.+) strikes at an empty space\.$/))) return `${match[1]} ataca uma casa vazia.`;
  if ((match = text.match(/^(.+) is defeated\.$/))) return `${match[1]} foi derrotado.`;
  if ((match = text.match(/^(.+) harvests (\d+(?:\.\d+)?) meat from the fallen\.$/))) return `${match[1]} colhe ${formatNumber("pt-BR", Number(match[2]), 3)} de carne dos abatidos.`;
  if ((match = text.match(/^(.+) harvests (\d+(?:\.\d+)?) meat from (\d+) fallen characters\.$/))) return `${match[1]} colhe ${formatNumber("pt-BR", Number(match[2]), 3)} de carne de ${match[3]} personagens abatidos.`;
  if ((match = text.match(/^(.+) (?:falls|fall) from (.+)'s Defying Gravity, striking (\d+) nearby (?:enemy|enemies) for (\d+) true damage\.$/))) return `${match[1]} ${match[1].includes(" and ") ? "caem" : "cai"} de Desafiando a Gravidade de ${match[2]}, atingindo ${match[3]} ${match[3] === "1" ? "inimigo próximo" : "inimigos próximos"} e causando ${match[4]} de dano verdadeiro.`.replaceAll(" and ", " e ");
  if ((match = text.match(/^(.+) (?:falls|fall) from (.+)'s Defying Gravity without striking a nearby enemy\.$/))) return `${match[1]} ${match[1].includes(" and ") ? "caem" : "cai"} de Desafiando a Gravidade de ${match[2]} sem atingir um inimigo próximo.`.replaceAll(" and ", " e ");
  if (text === "The enemy line breaks. Victory.") return "A linha inimiga se rompe. Vitória.";
  if ((match = text.match(/^Your formation falls\. Commander loses (\d+) life\.$/))) return `Sua formação cai. O comandante perde ${match[1]} de Vida.`;
  if (text === "Time expires. Your formation holds the advantage. Victory.") return "O tempo acaba. Sua formação mantém a vantagem. Vitória.";
  if (text === "The clash reaches its limit. Your formation holds the advantage. Victory.") return "O confronto chega ao limite. Sua formação mantém a vantagem. Vitória.";
  if ((match = text.match(/^(Time expires|The clash reaches its limit) with the enemy ahead\. Commander loses (\d+) life\.$/))) {
    return `${match[1] === "Time expires" ? "O tempo acaba" : "O confronto chega ao limite"} com o inimigo à frente. O comandante perde ${match[2]} de Vida.`;
  }
  return text;
}

export function localizeText(locale: GameLocale, text: string): string {
  return locale === "en" ? text : localizeGameMessagePt(text);
}

export function localizeAbilityText(locale: GameLocale, text: string): string {
  if (locale === "en") return text;
  const exact = ABILITY_EXACT.get(text);
  if (exact) return exact;

  let localized = text;
  // Context notes are concatenated by the engine, so translate them as phrases.
  const phrases: Array<[string, string]> = [
    ["Current values include the deployed player formation's active bonds.", "Os valores atuais incluem os vínculos ativos da formação posicionada do jogador."],
    ["Current values include the deployed enemy formation's active bonds.", "Os valores atuais incluem os vínculos ativos da formação inimiga posicionada."],
    ["Bench preview: deploy this character to activate formation bonds.", "Prévia do banco: posicione este personagem para ativar vínculos de formação."],
    ["Passive: Meat Gaga has no Mana, never casts, and empowers only basic attacks after a character falls.", "Passiva: Meat Gaga não possui Mana, nunca conjura e fortalece apenas ataques básicos depois que um personagem é abatido."],
    ["Damage is shown before shields; this ability ignores Armor.", "O dano é exibido antes dos escudos; esta habilidade ignora a Armadura."],
    ["Damage is shown before enemy Armor, shields, and remaining-Life limits.", "O dano é exibido antes da Armadura inimiga, dos escudos e do limite de Vida restante."],
    ["Landing damage is calculated from each still-living lifted enemy's current Life at the instant they fall.", "O dano da queda é calculado com base na Vida atual de cada inimigo erguido que ainda estiver vivo no instante em que cair."],
    ["Healing is shown before missing-Life limits.", "A cura é exibida antes do limite de Vida perdida."],
    ["Self-healing uses the damage actually applied.", "A cura própria usa o dano realmente aplicado."],
    ["Team healing is shown before missing-Life limits.", "A cura da equipe é exibida antes do limite de Vida perdida."],
    ["Shield is the full amount granted.", "Escudo é o valor total concedido."],
  ];
  for (const [source, target] of phrases) localized = localized.replaceAll(source, target);

  const modifierPatterns: Array<[RegExp, (...groups: string[]) => string]> = [
    [/^Item · \+(\d+) max Life$/, (amount) => `Item · +${amount} de Vida máxima`],
    [/^Item · \+(\d+) Attack$/, (amount) => `Item · +${amount} de Ataque`],
    [/^Item · \+(\d+) Armor$/, (amount) => `Item · +${amount} de Armadura`],
    [/^Item · \+(\d+) starting Mana$/, (amount) => `Item · +${amount} de Mana inicial`],
    [/^Bond · Vanguard \+(\d+) Armor$/, (amount) => `Vínculo · Vanguarda +${amount} de Armadura`],
    [/^Bond · Duelist \+(\d+)% Attack$/, (amount) => `Vínculo · Duelista +${amount}% de Ataque`],
    [/^Bond · Starborn \+(\d+)% ability damage$/, (amount) => `Vínculo · Estelar +${amount}% de dano de habilidade`],
    [/^Bond · Hexer drains (\d+) Mana from ability targets$/, (amount) => `Vínculo · Feiticeiro drena ${amount} de Mana dos alvos da habilidade`],
    [/^Bond · Verdant heals all allies for (\d+) after casting$/, (amount) => `Vínculo · Verdejante cura todos os aliados em ${amount} após conjurar`],
    [/^Bond · Nightbound grants (\d+) Mana per takedown$/, (amount) => `Vínculo · Noturno concede ${amount} de Mana por abate`],
    [/^Bond · Invoker \+(\d+) starting Mana$/, (amount) => `Vínculo · Invocador +${amount} de Mana inicial`],
  ];
  for (const [pattern, replacement] of modifierPatterns) {
    const match = localized.match(pattern);
    if (match) return replacement(...match.slice(1));
  }
  return localized;
}

function scalingValue(locale: GameLocale, value: number): string {
  return formatNumber(locale, value, 2);
}

export function formatAbilityScaling(locale: GameLocale, preview: AbilityPreview): string {
  if (locale === "en") return preview.scalingDescription;
  const byStar = preview.byStar;
  const triplet = (read: (value: AbilityPreview["byStar"][number]) => number | string) =>
    `(${byStar.map((value) => {
      const output = read(value);
      return typeof output === "number" ? scalingValue(locale, output) : output;
    }).join("/")})`;
  const heroId = preview.current.heroId;
  if (heroId === "bramble") {
    return `Concede a si um Escudo de ${triplet((value) => value.shield)} e cura até ${triplet((value) => value.maxTargets)} aliados adjacentes em ${triplet((value) => value.healing)} de Vida cada no 1★/2★/3★.`;
  }
  if (heroId === "boitata") {
    return `Concede a si um Escudo contra ${triplet((value) => value.shield)} de dano no 1★/2★/3★.`;
  }
  if (heroId === "meat-gaga") {
    return `Armazena passivamente ${triplet((value) => value.passiveStackGainPercent)}% da Vida máxima de cada personagem abatido e consome ${triplet((value) => value.passiveStackConsumePercent)}% da reserva como dano adicional em cada ataque básico no 1★/2★/3★.`;
  }
  if (heroId === "elphaba") {
    return `Faz ${triplet((value) => value.maxTargets)} inimigo(s) levitar(em) por ${triplet((value) => value.liftDurationSeconds)} segundos. Na queda, inimigos ortogonalmente adjacentes sofrem ${triplet((value) => value.currentHealthDamagePercent)}% da Vida atual do inimigo que caiu como dano verdadeiro e ficam atordoados por ${triplet((value) => value.stunDurationSeconds)} segundos no 1★/2★/3★.`;
  }
  if (heroId === "sol") {
    return `Atinge ${triplet((value) => `${value.minTargets}–${value.maxTargets}`)} inimigos agrupados e causa ${triplet((value) => value.damage)} de dano bruto em cada um no 1★/2★/3★.`;
  }
  if (heroId === "nix") {
    return `Ataca ${triplet((value) => value.maxTargets)} inimigo e causa ${triplet((value) => value.damage)} de dano verdadeiro no 1★/2★/3★.`;
  }
  if (heroId === "aster") {
    return `Ataca ${triplet((value) => value.maxTargets)} inimigo, causa ${triplet((value) => value.damage)} de dano bruto e recebe ${triplet((value) => value.shield)} de Escudo no 1★/2★/3★.`;
  }
  if (heroId === "morrow") {
    return `Drena ${triplet((value) => value.maxTargets)} inimigo, causa ${triplet((value) => value.damage)} de dano bruto e cura a si em ${triplet((value) => value.selfHealPercent)}% do dano aplicado no 1★/2★/3★.`;
  }
  if (heroId === "tide") {
    return `Cura ${triplet((value) => value.maxTargets)} aliado em ${triplet((value) => value.healing)} de Vida e concede ${triplet((value) => value.shield)} de Escudo no 1★/2★/3★.`;
  }
  if (heroId === "vesper") {
    return `Atinge ${triplet((value) => value.maxTargets)} inimigo, causa ${triplet((value) => value.damage)} de dano bruto, drena ${triplet((value) => value.manaDrain)} de Mana e faz perder ${triplet((value) => value.stunTurns)} ação no 1★/2★/3★.`;
  }
  return `Dispara ${triplet((value) => value.projectiles)} projéteis contra até ${triplet((value) => value.maxTargets)} inimigos e causa ${triplet((value) => value.damage)} de dano bruto em cada um no 1★/2★/3★.`;
}

export function localizeAbilityPreview(locale: GameLocale, preview: AbilityPreview): AbilityPreview {
  if (locale === "en") return preview;
  return {
    ...preview,
    scalingDescription: formatAbilityScaling(locale, preview),
    modifiers: preview.modifiers.map((modifier) => localizeAbilityText(locale, modifier)),
    contextNote: localizeAbilityText(locale, preview.contextNote),
  };
}

export function localizeCombatEvent(locale: GameLocale, event: CombatEvent | string): string {
  return localizeText(locale, typeof event === "string" ? event : event.text);
}

export function localizeActionResult(locale: GameLocale, result: GameActionResult): GameActionResult {
  if (locale === "en") return result;
  return { ...result, message: localizeText(locale, result.message) };
}
