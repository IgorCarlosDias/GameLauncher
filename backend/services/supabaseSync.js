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
 * Envia todos os dados locais (jogos, sessões, resumo) para o Supabase (Upsert atômico)
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

    // 1. Upsert em games_playtime
    const gamesToUpsert = payload.games.map((g) => ({
      game_identifier: getGameIdentifier(g),
      name: g.name,
      custom_name: g.customName || null,
      steam_id: g.steamId ? String(g.steamId) : null,
      play_time: Math.max(0, Math.round(Number(g.playTime) || 0)),
      play_count: Math.max(0, Math.round(Number(g.playCount) || 0)),
      favorite: Boolean(g.favorite),
      last_played: g.lastPlayed || null,
      updated_at: new Date().toISOString(),
    }));

    if (gamesToUpsert.length > 0) {
      const { error: gamesErr } = await client
        .from("games_playtime")
        .upsert(gamesToUpsert, { onConflict: "game_identifier" });

      if (gamesErr) throw gamesErr;
    }

    // 2. Upsert em game_sessions (apenas sessões válidas com data de início e fim)
    if (Array.isArray(payload.sessions) && payload.sessions.length > 0) {
      const validSessions = payload.sessions
        .filter((s) => s.startedAt && s.endedAt)
        .map((s) => ({
          game_identifier: s.gameId ? `game_id:${s.gameId}` : `local:${(s.gameOriginalName || s.gameName).toLowerCase()}`,
          game_name: s.gameName || s.gameOriginalName || "Jogo",
          started_at: s.startedAt,
          ended_at: s.endedAt,
          duration: Math.max(0, Math.round(Number(s.duration) || 0)),
        }));

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

    // 3. Salva resumo e meta no launcher_meta
    if (payload.summary) {
      const { error: metaErr } = await client.from("launcher_meta").upsert(
        [
          {
            key: "playtime_summary",
            value: payload.summary,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: "key" }
      );
      if (metaErr) throw metaErr;
    }

    lastSyncStatus.connected = true;
    lastSyncStatus.lastSyncAt = new Date().toISOString();
    lastSyncStatus.lastError = null;
    lastSyncStatus.gamesSynced = gamesToUpsert.length;
    lastSyncStatus.sessionsSynced = payload.sessions ? payload.sessions.length : 0;

    return {
      success: true,
      gamesSynced: gamesToUpsert.length,
      sessionsSynced: lastSyncStatus.sessionsSynced,
      syncedAt: lastSyncStatus.lastSyncAt,
    };
  } catch (err) {
    lastSyncStatus.lastError = err.message;
    console.error("[Supabase Sync] Falha ao enviar tempos para a nuvem:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Puxa todos os tempos salvos na nuvem do Supabase
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

    const { data: cloudMeta } = await client
      .from("launcher_meta")
      .select("*")
      .eq("key", "playtime_summary")
      .maybeSingle();

    const { data: cloudSessions } = await client
      .from("game_sessions")
      .select("*")
      .order("started_at", { ascending: true })
      .limit(1000);

    lastSyncStatus.connected = true;
    lastSyncStatus.lastSyncAt = new Date().toISOString();
    lastSyncStatus.lastError = null;

    return {
      success: true,
      games: cloudGames || [],
      summary: cloudMeta?.value || null,
      sessions: cloudSessions || [],
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
