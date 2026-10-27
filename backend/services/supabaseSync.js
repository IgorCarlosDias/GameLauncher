const { createClient } = require("@supabase/supabase-js");

let supabaseClient = null;
let isSignedIn = false;
let lastSyncStatus = {
  configured: false,
  connected: false,
  authenticated: false,
  authMode: "anon",
  lastSyncAt: null,
  lastError: null,
  gamesSynced: 0,
  sessionsSynced: 0,
  achievementsSynced: 0,
};

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  if (!url || !key || !url.startsWith("http")) {
    supabaseClient = null;
    isSignedIn = false;
    lastSyncStatus.configured = false;
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
    isSignedIn = false;
  }

  lastSyncStatus.configured = true;
  return supabaseClient;
}

function resetClient() {
  supabaseClient = null;
  isSignedIn = false;
  return getClient();
}

async function ensureAuthenticated(client) {
  if (!client) return { ok: false, error: "Cliente Supabase não inicializado" };

  const email = (process.env.SUPABASE_EMAIL || "").trim();
  const password = (process.env.SUPABASE_PASSWORD || "").trim();

  if (!email || !password) {
    lastSyncStatus.authenticated = false;
    lastSyncStatus.authMode = "key_only";
    return { ok: true, mode: "key_only" };
  }

  if (isSignedIn) {
    const { data } = await client.auth.getSession();
    if (data?.session) {
      lastSyncStatus.authenticated = true;
      lastSyncStatus.authMode = "authenticated";
      return { ok: true, mode: "authenticated" };
    }
    isSignedIn = false;
  }

  const { data: signInData, error: signInErr } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (!signInErr && signInData?.session) {
    isSignedIn = true;
    lastSyncStatus.authenticated = true;
    lastSyncStatus.authMode = "authenticated";
    return { ok: true, mode: "authenticated" };
  }

  // Se o usuário ainda não existir no Supabase Auth, tenta criá-lo automaticamente
  if (signInErr && signInErr.message?.toLowerCase().includes("invalid login credentials")) {
    const { data: signUpData, error: signUpErr } = await client.auth.signUp({
      email,
      password,
    });

    if (!signUpErr && signUpData?.session) {
      isSignedIn = true;
      lastSyncStatus.authenticated = true;
      lastSyncStatus.authMode = "authenticated";
      return { ok: true, mode: "authenticated" };
    }

    if (!signUpErr && signUpData?.user && !signUpData?.session) {
      return {
        ok: false,
        error:
          "Usuário criado no Supabase Auth, mas exige confirmação de e-mail (desative 'Confirm email' em Authentication > Providers > Email no Supabase ou confirme o e-mail).",
      };
    }
  }

  lastSyncStatus.authenticated = false;
  return {
    ok: false,
    error: `Falha no login do Supabase Auth: ${signInErr?.message || "credenciais inválidas"}`,
  };
}

function getGameIdentifier(game) {
  if (game.steamId) return `steam:${game.steamId}`;
  const cleanName = (game.originalName || game.name || "").trim().toLowerCase();
  return `local:${cleanName}`;
}

async function testConnection() {
  const client = getClient();
  if (!client) {
    return {
      connected: false,
      configured: false,
      error: "Supabase URL ou KEY não configurados no .env",
    };
  }

  try {
    const authRes = await ensureAuthenticated(client);
    if (!authRes.ok) {
      lastSyncStatus.connected = false;
      lastSyncStatus.lastError = authRes.error;
      return {
        connected: false,
        configured: true,
        authenticated: false,
        error: authRes.error,
      };
    }

    const { error } = await client
      .from("games_playtime")
      .select("id")
      .limit(1);

    if (error) {
      if (error.code === "PGRST205" || error.message?.includes("Could not find the table")) {
        lastSyncStatus.connected = false;
        lastSyncStatus.lastError = "Tabelas ainda não criadas no Supabase.";
        return {
          connected: false,
          configured: true,
          needTables: true,
          error: "Tabelas ainda não criadas no Supabase. Execute o script SQL no SQL Editor do painel.",
        };
      }
      if (error.code === "42501" || error.message?.toLowerCase().includes("permission denied") || error.message?.toLowerCase().includes("row-level security")) {
        lastSyncStatus.connected = false;
        lastSyncStatus.lastError = "Acesso negado pela política RLS (configure SUPABASE_EMAIL e SUPABASE_PASSWORD).";
        return {
          connected: false,
          configured: true,
          needAuth: true,
          error: "Política RLS exige login: informe SUPABASE_EMAIL e SUPABASE_PASSWORD nas configurações.",
        };
      }
      lastSyncStatus.connected = false;
      lastSyncStatus.lastError = error.message;
      return { connected: false, configured: true, error: error.message };
    }

    lastSyncStatus.connected = true;
    lastSyncStatus.lastError = null;
    return {
      connected: true,
      configured: true,
      authenticated: lastSyncStatus.authenticated,
      authMode: lastSyncStatus.authMode,
      error: null,
    };
  } catch (err) {
    lastSyncStatus.connected = false;
    lastSyncStatus.lastError = err.message;
    return { connected: false, configured: true, error: err.message };
  }
}

/**
 * Envia todos os dados locais (jogos, sessões, conquistas e resumo) para o Supabase (Upsert atômico)
 */
async function pushPlaytimeToSupabase(payload) {
  const client = getClient();
  if (!client) return { success: false, reason: "not_configured" };

  if (!payload || !Array.isArray(payload.games)) {
    return { success: false, reason: "invalid_payload" };
  }

  try {
    const authRes = await ensureAuthenticated(client);
    if (!authRes.ok) {
      throw new Error(authRes.error);
    }

    const nowIso = new Date().toISOString();

    // 1. Upsert em games_playtime (deduplicado por game_identifier para evitar erro ON CONFLICT DO UPDATE)
    const gamesByIdentifier = new Map();
    for (const g of payload.games) {
      const identifier = getGameIdentifier(g);
      const row = {
        game_identifier: identifier,
        name: g.name,
        custom_name: g.customName || null,
        steam_id: g.steamId ? String(g.steamId) : null,
        play_time: Math.max(0, Math.round(Number(g.playTime) || 0)),
        play_count: Math.max(0, Math.round(Number(g.playCount) || 0)),
        favorite: Boolean(g.favorite),
        last_played: g.lastPlayed || null,
        updated_at: nowIso,
      };

      if (!gamesByIdentifier.has(identifier)) {
        gamesByIdentifier.set(identifier, row);
      } else {
        const existing = gamesByIdentifier.get(identifier);
        existing.play_time = Math.max(existing.play_time, row.play_time);
        existing.play_count = Math.max(existing.play_count, row.play_count);
        existing.favorite = existing.favorite || row.favorite;
        if (!existing.custom_name && row.custom_name) existing.custom_name = row.custom_name;
        if (!existing.steam_id && row.steam_id) existing.steam_id = row.steam_id;
        if (row.last_played) {
          const prevMs = existing.last_played ? new Date(existing.last_played).getTime() : 0;
          const nextMs = new Date(row.last_played).getTime();
          if (nextMs > prevMs) existing.last_played = row.last_played;
        }
      }
    }

    const gamesToUpsert = Array.from(gamesByIdentifier.values());
    if (gamesToUpsert.length > 0) {
      const { error: gamesErr } = await client
        .from("games_playtime")
        .upsert(gamesToUpsert, { onConflict: "game_identifier" });

      if (gamesErr) throw gamesErr;
    }

    // 2. Upsert em game_sessions (deduplicado por game_identifier + started_at)
    if (Array.isArray(payload.sessions) && payload.sessions.length > 0) {
      const sessionsMap = new Map();
      for (const s of payload.sessions) {
        if (!s.startedAt || !s.endedAt) continue;
        const gameIdentifier = s.gameId
          ? `game_id:${s.gameId}`
          : `local:${(s.gameOriginalName || s.gameName || "jogo").toLowerCase()}`;
        const key = `${gameIdentifier}|${s.startedAt}`;
        sessionsMap.set(key, {
          game_identifier: gameIdentifier,
          game_name: s.gameName || s.gameOriginalName || "Jogo",
          started_at: s.startedAt,
          ended_at: s.endedAt,
          duration: Math.max(0, Math.round(Number(s.duration) || 0)),
        });
      }

      const validSessions = Array.from(sessionsMap.values());
      if (validSessions.length > 0) {
        for (let i = 0; i < validSessions.length; i += 100) {
          const chunk = validSessions.slice(i, i + 100);
          const { error: sessErr } = await client
            .from("game_sessions")
            .upsert(chunk, { onConflict: "game_identifier,started_at", ignoreDuplicates: true });

          if (sessErr && !sessErr.message?.includes("duplicate")) {
            await client.from("game_sessions").insert(chunk).catch(() => {});
          }
        }
      }
    }

    // 3. Salva resumo e conquistas completas em launcher_meta (funciona sem exigir migração manual de tabela)
    const metaRows = [];
    if (payload.summary) {
      metaRows.push({
        key: "playtime_summary",
        value: payload.summary,
        updated_at: nowIso,
      });
    }

    const achievementsList = Array.isArray(payload.achievements) ? payload.achievements : [];
    metaRows.push({
      key: "achievements_data",
      value: {
        updatedAt: nowIso,
        total: achievementsList.length,
        unlocked: achievementsList.filter((a) => a.achieved).length,
        items: achievementsList,
      },
      updated_at: nowIso,
    });

    if (metaRows.length > 0) {
      const { error: metaErr } = await client
        .from("launcher_meta")
        .upsert(metaRows, { onConflict: "key" });
      if (metaErr) throw metaErr;
    }

    // 4. Opcional: Se a tabela dedicada `game_achievements` existir no Supabase, sincroniza nela também
    if (achievementsList.length > 0) {
      const achMap = new Map();
      for (const a of achievementsList) {
        const gameIdentifier = a.steamId
          ? `steam:${a.steamId}`
          : `local:${(a.gameOriginalName || a.gameName || "").trim().toLowerCase()}`;
        const uniqueKey = `${gameIdentifier}|${a.apiName}`;
        achMap.set(uniqueKey, {
          game_identifier: gameIdentifier,
          game_name: a.gameName || a.gameOriginalName || "Jogo",
          steam_id: a.steamId ? String(a.steamId) : null,
          api_name: a.apiName,
          name: a.name || a.apiName,
          description: a.description || "",
          icon_url: a.iconUrl || "",
          icon_gray_url: a.iconGrayUrl || "",
          hidden: Boolean(a.hidden),
          achieved: Boolean(a.achieved),
          unlock_time: Number(a.unlockTime) || 0,
          updated_at: a.updatedAt || nowIso,
        });
      }

      const achToUpsert = Array.from(achMap.values());
      for (let i = 0; i < achToUpsert.length; i += 200) {
        const chunk = achToUpsert.slice(i, i + 200);
        const { error: achTableErr } = await client
          .from("game_achievements")
          .upsert(chunk, { onConflict: "game_identifier,api_name" });
        if (achTableErr) {
          // Se a tabela opcional game_achievements não existir, ignora silenciosamente pois launcher_meta já salvou
          break;
        }
      }
    }

    lastSyncStatus.connected = true;
    lastSyncStatus.lastSyncAt = nowIso;
    lastSyncStatus.lastError = null;
    lastSyncStatus.gamesSynced = gamesToUpsert.length;
    lastSyncStatus.sessionsSynced = payload.sessions ? payload.sessions.length : 0;
    lastSyncStatus.achievementsSynced = achievementsList.length;

    return {
      success: true,
      gamesSynced: gamesToUpsert.length,
      sessionsSynced: lastSyncStatus.sessionsSynced,
      achievementsSynced: achievementsList.length,
      syncedAt: lastSyncStatus.lastSyncAt,
    };
  } catch (err) {
    lastSyncStatus.lastError = err.message;
    console.error("[Supabase Sync] Falha ao enviar tempos e conquistas para a nuvem:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Puxa todos os tempos, sessões e conquistas salvos na nuvem do Supabase
 */
async function pullPlaytimeFromSupabase() {
  const client = getClient();
  if (!client) return { success: false, reason: "not_configured" };

  try {
    const authRes = await ensureAuthenticated(client);
    if (!authRes.ok) {
      throw new Error(authRes.error);
    }

    const { data: cloudGames, error: gamesErr } = await client
      .from("games_playtime")
      .select("*");

    if (gamesErr) throw gamesErr;

    const { data: cloudMetaRows } = await client
      .from("launcher_meta")
      .select("*")
      .in("key", ["playtime_summary", "achievements_data"]);

    const summaryMeta = (cloudMetaRows || []).find((r) => r.key === "playtime_summary");
    const achievementsMeta = (cloudMetaRows || []).find((r) => r.key === "achievements_data");

    let cloudAchievements = Array.isArray(achievementsMeta?.value?.items)
      ? achievementsMeta.value.items
      : [];

    // Se não houver conquistas em launcher_meta, tenta ler da tabela dedicada game_achievements (se existir)
    if (cloudAchievements.length === 0) {
      const { data: tableAchievements, error: tableAchErr } = await client
        .from("game_achievements")
        .select("*")
        .limit(5000);

      if (!tableAchErr && Array.isArray(tableAchievements) && tableAchievements.length > 0) {
        cloudAchievements = tableAchievements.map((r) => ({
          gameIdentifier: r.game_identifier,
          gameName: r.game_name,
          steamId: r.steam_id,
          apiName: r.api_name,
          name: r.name,
          description: r.description,
          iconUrl: r.icon_url,
          iconGrayUrl: r.icon_gray_url,
          hidden: Boolean(r.hidden),
          achieved: Boolean(r.achieved),
          unlockTime: Number(r.unlock_time) || 0,
          updatedAt: r.updated_at,
        }));
      }
    }

    const { data: cloudSessions } = await client
      .from("game_sessions")
      .select("*")
      .order("started_at", { ascending: true })
      .limit(1000);

    lastSyncStatus.connected = true;
    lastSyncStatus.lastSyncAt = new Date().toISOString();
    lastSyncStatus.lastError = null;
    lastSyncStatus.achievementsSynced = cloudAchievements.length;

    return {
      success: true,
      games: cloudGames || [],
      summary: summaryMeta?.value || null,
      sessions: cloudSessions || [],
      achievements: cloudAchievements,
      syncedAt: lastSyncStatus.lastSyncAt,
    };
  } catch (err) {
    lastSyncStatus.lastError = err.message;
    console.error("[Supabase Sync] Falha ao baixar dados da nuvem:", err.message);
    return { success: false, error: err.message };
  }
}

function getSyncStatus() {
  return {
    ...lastSyncStatus,
    hasAuthCredentials: Boolean(process.env.SUPABASE_EMAIL && process.env.SUPABASE_PASSWORD),
    email: process.env.SUPABASE_EMAIL || "",
  };
}

module.exports = {
  getClient,
  resetClient,
  testConnection,
  pushPlaytimeToSupabase,
  pullPlaytimeFromSupabase,
  getSyncStatus,
};
