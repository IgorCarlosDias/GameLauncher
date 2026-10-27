const axios = require("axios");

const GENRES = [
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

// Cache em memória para consultas da Steam Store API (steamId -> genre | null)
const steamGenreCache = new Map();

// Regras heurísticas prioritárias por nome/executável (mais precisas que tags genéricas "Action" da Steam)
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

// Mapeia descrições de gênero da Steam Store (PT-BR e EN) para os gêneros padronizados
function mapSteamGenresToPrimary(steamGenres = [], shortDesc = "") {
  const names = steamGenres.map((g) => String(g.description || "").toLowerCase());
  const desc = String(shortDesc || "").toLowerCase();

  // Verifica descrições mais específicas primeiro
  if (/\b(fighting|luta|beat\s*'em\s*up|brawler|arena\s*fighter)\b/i.test(desc)) return "Luta";
  if (/\b(survival\s*horror|terror|horror\s*psicol[oó]gico|psychological\s*horror)\b/i.test(desc)) return "Terror";
  if (/\b(moba)\b/i.test(desc)) return "MOBA";
  if (/\b(fps|first-person\s*shooter|third-person\s*shooter|hero\s*shooter|tiro\s*em\s*(primeira|terceira)\s*pessoa|extraction\s*shooter|co-op\s*shooter)\b/i.test(desc)) {
    return "Tiro";
  }

  const has = (re) => names.some((n) => re.test(n));

  if (has(/corrida|racing/)) return "Corrida";
  if (has(/esporte|sports/)) return "Esportes";
  if (has(/rpg/)) return "RPG";
  if (has(/estrat[eé]gia|strategy/)) return "Estratégia";
  if (has(/simula[cç][aã]o|simulation/)) return "Simulação";
  if (has(/casual/) && !has(/a[cç][aã]o|action/)) return "Casual";
  if (has(/aventura|adventure/) && !has(/a[cç][aã]o|action/)) return "Aventura";
  if (has(/a[cç][aã]o|action/)) return "Ação";
  if (has(/aventura|adventure/)) return "Aventura";
  if (has(/casual/)) return "Casual";

  return null;
}

/**
 * Detecta gênero instantaneamente por regras locais (nome, originalName e executável)
 */
function detectGenreFromLocalRules({ name, originalName, resolvedExe }) {
  const combined = [name, originalName, resolvedExe]
    .filter(Boolean)
    .join(" ")
    .replace(/[._-]+/g, " ");

  if (!combined.trim()) return null;

  for (const rule of GENRE_RULES) {
    if (rule.pattern.test(combined)) {
      return rule.genre;
    }
  }
  return null;
}

/**
 * Consulta a Steam Store API pelo AppID para descobrir o gênero oficial do jogo
 */
async function fetchSteamStoreGenre(steamId) {
  const cleanId = String(steamId || "").trim().replace(/\D/g, "");
  if (!cleanId) return null;

  if (steamGenreCache.has(cleanId)) {
    return steamGenreCache.get(cleanId);
  }

  try {
    const res = await axios.get("https://store.steampowered.com/api/appdetails", {
      params: { appids: cleanId, l: "brazilian" },
      timeout: 4500,
    });

    const entry = res.data?.[cleanId];
    if (!entry || !entry.success || !entry.data) {
      steamGenreCache.set(cleanId, null);
      return null;
    }

    const data = entry.data;
    // Primeiro testa as regras por nome oficial da Steam
    const fromOfficialTitle = detectGenreFromLocalRules({
      name: data.name,
      originalName: data.name,
      resolvedExe: "",
    });
    if (fromOfficialTitle) {
      steamGenreCache.set(cleanId, fromOfficialTitle);
      return fromOfficialTitle;
    }

    const mapped = mapSteamGenresToPrimary(data.genres || [], data.short_description || "");
    steamGenreCache.set(cleanId, mapped);
    return mapped;
  } catch {
    return null;
  }
}

/**
 * Detecta o gênero principal de um jogo combinando regras heurísticas + Steam Store API
 */
async function detectGameGenre({ name, originalName, resolvedExe, steamId }, { allowNetwork = true } = {}) {
  const localMatch = detectGenreFromLocalRules({ name, originalName, resolvedExe });
  if (localMatch) return localMatch;

  if (allowNetwork && steamId) {
    const steamMatch = await fetchSteamStoreGenre(steamId);
    if (steamMatch) return steamMatch;
  }

  return "Ação";
}

module.exports = {
  GENRES,
  detectGenreFromLocalRules,
  fetchSteamStoreGenre,
  detectGameGenre,
};
