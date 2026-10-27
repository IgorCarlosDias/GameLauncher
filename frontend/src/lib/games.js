export const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "fav", label: "Favoritos" },
  { id: "steam", label: "Steam" },
  { id: "local", label: "Local" },
];

export const GENRES = [
  "Ação",
  "Luta",
  "Tiro",
  "RPG",
  "Corrida",
  "Esportes",
  "Terror",
  "Aventura",
  "MOBA",
  "Casual",
  "Estratégia",
  "Simulação",
  "Emulador",
  "Utilitário",
];

const GENRE_RULES = [
  {
    genre: "Emulador",
    pattern:
      /\b(citra|yuzu|ryujinx|pcsx2|psxfin|epsxe|duckstation|rpcs3|dolphin|cemu|ppsspp|retroarch|xenia|desmume|melonds|project64|mame|nintendo\s*switch|sony\s*playstation|playstation\s*[12345]?)\b/i,
  },
  {
    genre: "Utilitário",
    pattern: /\b(unverum|vortex|mod\s*manager|hedgemodmanager|cheat\s*engine|lossless\s*scaling)\b/i,
  },
  {
    genre: "Luta",
    pattern:
      /\b(tekken|mortal\s*kombat|mk1[12]?|street\s*fighter|king\s*of\s*fighters|kof\s*x?[ivx]*|dragon\s*ball.*(sparking|budokai|tenkaichi|fighterz|xenoverse)|sparking!?\s*zero|brawlhalla|multiversus|marvel\s*v(s\.?)?\s*capcom|guilty\s*gear|naruto.*(storm|ninja)|injustice|soulcalibur|fatal\s*fury|granblue\s*fantasy\s*versus|skullgirls|blazblue|killer\s*instinct|sifu|absurd\s*versus)\b/i,
  },
  {
    genre: "Corrida",
    pattern:
      /\b(need\s*for\s*speed|nfs|forza\s*(horizon|motorsport)|kartrider|mario\s*kart|gran\s*turismo|assetto\s*corsa|f1\s*20\d\d|f1\s*2[1-9]|dirt\s*rally|burnout|the\s*crew|trackmania|horizon\s*chase|project\s*cars|wreckfest|carx|grid\s*legends|hot\s*wheels)\b/i,
  },
  {
    genre: "Esportes",
    pattern:
      /\b(efootball|fifa|ea\s*sports\s*fc|pro\s*evolution\s*soccer|\bpes\s*20\d\d|tony\s*hawk|thps|skate\.?|nba\s*2k|madden|wwe\s*2k|pga\s*tour|rocket\s*league|rematch|riders\s*republic|steep|football\s*manager)\b/i,
  },
  {
    genre: "Terror",
    pattern:
      /\b(resident\s*evil|\bre[234789]\b|silent\s*hill|dead\s*space|outlast|phasmophobia|alan\s*wake|evil\s*within|five\s*nights\s*at\s*freddy|fnaf|dead\s*by\s*daylight|until\s*dawn|the\s*quarry|amnesia|soma|lethal\s*company|layers\s*of\s*fear|visage|tormented\s*souls|poppy\s*playtime|little\s*nightmares)\b/i,
  },
  {
    genre: "MOBA",
    pattern:
      /\b(league\s*of\s*legends|dota\s*2?|smite|supervive|heroes\s*of\s*the\s*storm|pokemon\s*unite|deadlock|eternal\s*return)\b/i,
  },
  {
    genre: "Tiro",
    pattern:
      /\b(helldivers|marvel\s*rivals|crossfire|counter[\s-]*strike|\bcs2\b|\bcsgo\b|valorant|overwatch|call\s*of\s*duty|warzone|battlefield|apex\s*legends|fortnite|pubg|rainbow\s*six|doom\b|halo\b|destiny\s*2?|left\s*4\s*dead|back\s*4\s*blood|borderlands|bioshock|sniper\s*elite|payday|titanfall|team\s*fortress|the\s*finals|fragpunk|delta\s*force|warframe|metro\s*exodus|stalker|wolfenstein|crysis|remnant)\b/i,
  },
  {
    genre: "Casual",
    pattern:
      /\b(fall\s*guys|stumble\s*guys|overcooked|dead\s*as\s*disco|speedrunners|among\s*us|party\s*animals|pummel\s*party|gang\s*beasts|moving\s*out|jackbox|human\s*fall\s*flat|golf\s*with\s*your\s*friends|uno\b|monopoly|gartic|stardew\s*valley|the\s*sims)\b/i,
  },
  {
    genre: "RPG",
    pattern:
      /\b(zenless\s*zone\s*zero|genshin\s*impact|honkai|wuthering\s*waves|crimson\s*desert|black\s*myth|wukong|maneater|final\s*fantasy|persona\s*[345]|metaphor\s*refantazio|elden\s*ring|dark\s*souls|bloodborne|the\s*witcher|cyberpunk\s*2077|skyrim|elder\s*scrolls|fallout|baldur'?s\s*gate|diablo|path\s*of\s*exile|monster\s*hunter|dragon'?s\s*dogma|kingdom\s*hearts|nier\b|tales\s*of|starfield|mass\s*effect|dragon\s*age|yakuza\s*like\s*a\s*dragon|like\s*a\s*dragon\s*infinite|chrono\s*trigger|octopath|xenoblade|undertale|deltarune)\b/i,
  },
  {
    genre: "Aventura",
    pattern:
      /\b(crash\s*bandicoot|sonic\b|split\s*fiction|it\s*takes\s*two|a\s*way\s*out|super\s*mario|legend\s*of\s*zelda|tomb\s*raider|uncharted|stray\b|ori\s*and|hollow\s*knight|celeste\b|cuphead|rayman|spyro|ratchet\s*&\s*clank|astro\s*bot|life\s*is\s*strange|detroit\s*become\s*human|heavy\s*rain|beyond\s*two\s*souls|subnautica|outer\s*wilds|sea\s*of\s*thieves|no\s*man'?s\s*sky|palworld|minecraft|terraria)\b/i,
  },
  {
    genre: "Estratégia",
    pattern:
      /\b(age\s*of\s*empires|civilization|starcraft|warcraft\s*iii|total\s*war|xcom|company\s*of\s*heroes|crusader\s*kings|hearts\s*of\s*iron|europa\s*universalis|stellaris|anno\s*1800|frostpunk|cities\s*skylines|factorio|rimworld|slay\s*the\s*spire|balatro|into\s*the\s*breach)\b/i,
  },
  {
    genre: "Simulação",
    pattern:
      /\b(euro\s*truck|american\s*truck|flight\s*simulator|farming\s*simulator|powerwash\s*simulator|pc\s*building\s*simulator|house\s*flipper|goat\s*simulator|kerbal|planet\s*coaster|planet\s*zoo|assetto)\b/i,
  },
  {
    genre: "Ação",
    pattern:
      /\b(devil\s*may\s*cry|\bdmc\b|onimusha|god\s*of\s*war|spider[\s-]*man|chivalry|grand\s*theft\s*auto|\bgta\b|red\s*dead|batman\s*arkham|assassin'?s\s*creed|metal\s*gear|ghost\s*of\s*tsushima|sekiro|bayonetta|ninja\s*gaiden|darksiders|hitman|watch\s*dogs|far\s*cry|just\s*cause|mafia\b|sleeping\s*dogs|max\s*payne|control\b|quantum\s*break|stellar\s*blade|lies\s*of\s*p|armored\s*core|hades\b|dead\s*cells)\b/i,
  },
];

/** Retorna o gênero salvo do jogo ou detecta automaticamente pelo título/executável. */
export function getGameGenre(game) {
  if (!game) return null;
  if (typeof game.genre === "string" && game.genre.trim()) {
    return game.genre.trim();
  }
  const combined = [game.name, game.originalName, game.resolvedExe]
    .filter(Boolean)
    .join(" ")
    .replace(/[._-]+/g, " ");
  if (!combined.trim()) return null;

  for (const rule of GENRE_RULES) {
    if (rule.pattern.test(combined)) {
      return rule.genre;
    }
  }
  return "Ação";
}

export const SORTS = [
  { id: "default", label: "Favoritos primeiro" },
  { id: "recent", label: "Mais recentes" },
  { id: "playtime", label: "Mais jogados" },
  { id: "az", label: "Nome (A–Z)" },
];

/** Steam = atalho de internet da Steam (.url). Todo o resto é jogo local (.lnk ou .exe). */
export function getPlatform(game) {
  return game?.extension === ".url" ? "steam" : "local";
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
const timeOf = (iso) => (iso ? new Date(iso).getTime() : 0);

export function filterAndSortGames(games, { search, filter, genre = "all", sortBy }) {
  const term = search.trim().toLowerCase();

  const result = games.filter((game) => {
    if (term && !game.name.toLowerCase().includes(term)) return false;
    if (filter === "fav" && !game.favorite) return false;
    if (filter === "steam" && getPlatform(game) !== "steam") return false;
    if (filter === "local" && getPlatform(game) !== "local") return false;
    if (genre && genre !== "all" && (getGameGenre(game) || "") !== genre) return false;
    return true;
  });

  return result.sort((a, b) => {
    if (sortBy === "recent") return timeOf(b.lastPlayed) - timeOf(a.lastPlayed);
    if (sortBy === "playtime") return (b.playTime || 0) - (a.playTime || 0);
    if (sortBy === "az") return collator.compare(a.name, b.name);
    if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}

export function countByFilter(games) {
  return {
    all: games.length,
    fav: games.filter((g) => g.favorite).length,
    steam: games.filter((g) => getPlatform(g) === "steam").length,
    local: games.filter((g) => getPlatform(g) === "local").length,
  };
}

/** Retorna os gêneros presentes na biblioteca ordenados por quantidade (desc) e nome (A-Z). */
export function getAvailableGenres(games) {
  const map = new Map();
  for (const g of games) {
    const genre = (getGameGenre(g) || "").trim();
    if (!genre) continue;
    map.set(genre, (map.get(genre) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([id, count]) => ({ id, label: id, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return collator.compare(a.label, b.label);
    });
}

export function getRecentGames(games, limit = 8) {
  return games
    .filter((g) => g.lastPlayed)
    .sort((a, b) => timeOf(b.lastPlayed) - timeOf(a.lastPlayed))
    .slice(0, limit);
}
