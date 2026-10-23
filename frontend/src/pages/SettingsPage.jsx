import React, { useState, useEffect } from "react";
import axios from "axios";

export default function SettingsPage({
  api,
  onBack,
  showToast,
  triggerHaptic,
  initialTab = "steam",
  onReloadGames,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Estados de visualização de senhas/chaves
  const [showSteamKey, setShowSteamKey] = useState(false);
  const [showSteamGridKey, setShowSteamGridKey] = useState(false);
  const [showSupabaseKey, setShowSupabaseKey] = useState(false);
  const [showSupabasePassword, setShowSupabasePassword] = useState(false);
  const [showApiToken, setShowApiToken] = useState(false);

  // Metadados de segredos já salvos no backend
  const [secretsMeta, setSecretsMeta] = useState({
    hasSteamApiKey: false,
    steamApiKeyHint: "",
    steamUserId: "",
    hasSteamGridDbKey: false,
    steamGridDbKeyHint: "",
    hasSupabaseKey: false,
    supabaseKeyHint: "",
    hasSupabasePassword: false,
    hasApiToken: false,
    apiTokenHint: "",
  });

  // Formulário de configurações
  const [form, setForm] = useState({
    serverIp: "",
    port: 3060,
    frontendPort: 8060,
    gameFolder: "",
    steamApiKey: "",
    steamUserId: "",
    steamGridDbKey: "",
    supabaseUrl: "",
    supabaseKey: "",
    supabaseEmail: "",
    supabasePassword: "",
    apiToken: "",
    autoDetectGames: true,
    monitorIntervalSec: 8,
    shutdownTimerSec: 30,
    defaultCloseMode: "force",
    touchpadSensitivity: 2.1,
    volumeStep: 3,
  });

  // Validação da pasta e rede
  const [folderValidation, setFolderValidation] = useState(null);
  const [validatingFolder, setValidatingFolder] = useState(false);
  const [networkInterfaces, setNetworkInterfaces] = useState([]);

  // Testes de API
  const [testingSteamKey, setTestingSteamKey] = useState(false);
  const [steamKeyTestResult, setSteamKeyTestResult] = useState(null);
  const [detectingSteamUser, setDetectingSteamUser] = useState(false);
  const [detectedSteamData, setDetectedSteamData] = useState(null);
  const [syncingAllAchievements, setSyncingAllAchievements] = useState(false);

  const [testingGridKey, setTestingGridKey] = useState(false);
  const [gridKeyTestResult, setGridKeyTestResult] = useState(null);

  // Supabase
  const [supabaseStatus, setSupabaseStatus] = useState(null);
  const [_supabaseLoading, setSupabaseLoading] = useState(false);
  const [supabaseSyncing, setSupabaseSyncing] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const res = await axios.get(`${api}/settings`);
      if (res.data?.success) {
        const env = res.data.env || {};
        const auto = res.data.automation || {};
        const steam = res.data.steam || {};

        setSecretsMeta({
          hasSteamApiKey: Boolean(env.hasSteamApiKey || steam.hasApiKey),
          steamApiKeyHint: env.steamApiKeyHint || steam.apiKeyHint || "",
          steamUserId: env.steamUserId || steam.steamUserId || "",
          hasSteamGridDbKey: Boolean(env.hasSteamGridDbKey),
          steamGridDbKeyHint: env.steamGridDbKeyHint || "",
          hasSupabaseKey: Boolean(env.hasSupabaseKey),
          supabaseKeyHint: env.supabaseKeyHint || "",
          hasSupabasePassword: Boolean(env.hasSupabasePassword),
          hasApiToken: Boolean(env.hasApiToken),
          apiTokenHint: env.apiTokenHint || "",
        });

        if (steam.detected) {
          setDetectedSteamData(steam.detected);
        }

        setForm({
          serverIp: env.serverIp || "",
          port: env.port || 3060,
          frontendPort: env.frontendPort || 8060,
          gameFolder: env.gameFolder || "",
          steamApiKey: "",
          steamUserId: env.steamUserId || steam.steamUserId || "",
          steamGridDbKey: "",
          supabaseUrl: env.supabaseUrl || "",
          supabaseKey: "",
          supabaseEmail: env.supabaseEmail || "",
          supabasePassword: "",
          apiToken: "",
          autoDetectGames: auto.autoDetectGames !== undefined ? Boolean(auto.autoDetectGames) : true,
          monitorIntervalSec: Number(auto.monitorIntervalSec) || 8,
          shutdownTimerSec: Number(auto.shutdownTimerSec) || 30,
          defaultCloseMode: auto.defaultCloseMode || "force",
          touchpadSensitivity: Number(auto.touchpadSensitivity) || 2.1,
          volumeStep: Number(auto.volumeStep) || 3,
        });

        if (res.data.folderStatus) {
          setFolderValidation(res.data.folderStatus);
        }
        if (Array.isArray(res.data.networkInterfaces)) {
          setNetworkInterfaces(res.data.networkInterfaces);
        }

        checkSupabaseStatus();
      }
    } catch (err) {
      console.error("Erro carregando configurações:", err);
      showToast("Falha ao carregar configurações do servidor", "error");
    } finally {
      setLoading(false);
    }
  }

  // Detectar Steam automaticamente do PC
  async function detectSteamLocal() {
    if (triggerHaptic) triggerHaptic(20);
    setDetectingSteamUser(true);
    try {
      const res = await axios.post(`${api}/settings/detect-steam`);
      if (res.data?.success) {
        setDetectedSteamData(res.data);
        if (res.data.steamId64) {
          setForm((prev) => ({ ...prev, steamUserId: res.data.steamId64 }));
          showToast(
            `🎮 SteamID64 detectado: ${res.data.steamId64} (Conta: ${res.data.accountId})`,
            "success"
          );
        } else {
          showToast("Steam instalada detectada, mas nenhum usuário ativo logado.", "warning");
        }
      }
    } catch (err) {
      showToast(err.response?.data?.message || "Erro detectando Steam local", "error");
    } finally {
      setDetectingSteamUser(false);
    }
  }

  // Testar Chave da Steam
  async function testSteamKey() {
    if (triggerHaptic) triggerHaptic(25);
    setTestingSteamKey(true);
    setSteamKeyTestResult(null);
    try {
      const res = await axios.post(`${api}/settings/test-steam`, {
        steamApiKey: form.steamApiKey,
        steamUserId: form.steamUserId,
      });
      setSteamKeyTestResult(res.data);
      if (res.data?.valid) {
        showToast("🔑 Chave da API Steam válida!", "success");
      } else {
        showToast(res.data?.message || "Chave da Steam inválida", "error");
      }
    } catch (err) {
      const msg = err.response?.data?.message || "Erro testando chave Steam";
      setSteamKeyTestResult({ valid: false, message: msg });
      showToast(msg, "error");
    } finally {
      setTestingSteamKey(false);
    }
  }

  // Sincronizar Conquistas de Todos os Jogos
  async function syncAllAchievements() {
    if (triggerHaptic) triggerHaptic(30);
    setSyncingAllAchievements(true);
    try {
      const res = await axios.post(`${api}/steam/sync-all-achievements`);
      if (res.data?.success) {
        showToast(res.data.message || "Conquistas sincronizadas com sucesso!", "success");
        if (onReloadGames) onReloadGames();
      } else {
        showToast(res.data?.message || "Falha na sincronização", "error");
      }
    } catch (err) {
      showToast(err.response?.data?.message || "Erro ao sincronizar conquistas", "error");
    } finally {
      setSyncingAllAchievements(false);
    }
  }

  // Validar pasta
  async function validateFolder(pathOverride) {
    if (triggerHaptic) triggerHaptic(20);
    setValidatingFolder(true);
    try {
      const folderToTest = pathOverride !== undefined ? pathOverride : form.gameFolder;
      const res = await axios.post(`${api}/settings/validate-folder`, { gameFolder: folderToTest });
      setFolderValidation(res.data);
      if (res.data?.valid) {
        showToast(`📁 ${res.data.message}`, "success");
      } else {
        showToast(res.data?.message || "Pasta inválida", "warning");
      }
    } catch (err) {
      showToast(err.response?.data?.message || "Erro ao validar diretório", "error");
    } finally {
      setValidatingFolder(false);
    }
  }

  // Testar SteamGridDB
  async function testGridKey() {
    if (triggerHaptic) triggerHaptic(25);
    setTestingGridKey(true);
    setGridKeyTestResult(null);
    try {
      const res = await axios.post(`${api}/settings/test-steamgriddb`, {
        steamGridDbKey: form.steamGridDbKey,
      });
      setGridKeyTestResult(res.data);
      if (res.data?.valid) {
        showToast("🔑 Chave SteamGridDB válida!", "success");
      } else {
        showToast(res.data?.message || "Chave inválida", "error");
      }
    } catch (err) {
      const msg = err.response?.data?.message || "Erro ao testar SteamGridDB";
      setGridKeyTestResult({ valid: false, message: msg });
      showToast(msg, "error");
    } finally {
      setTestingGridKey(false);
    }
  }

  // Supabase status & sync
  async function checkSupabaseStatus() {
    try {
      setSupabaseLoading(true);
      const res = await axios.get(`${api}/supabase/status`);
      if (res.data?.success) setSupabaseStatus(res.data);
    } catch (err) {
      console.warn("Erro ao checar Supabase:", err);
    } finally {
      setSupabaseLoading(false);
    }
  }

  async function triggerSupabasePush() {
    if (triggerHaptic) triggerHaptic(25);
    setSupabaseSyncing(true);
    try {
      const res = await axios.post(`${api}/supabase/push`);
      if (res.data?.success) {
        showToast("☁️ Tempos enviados para o Supabase com sucesso!", "success");
        checkSupabaseStatus();
      } else {
        showToast(res.data?.message || "Falha ao enviar", "error");
      }
    } catch (err) {
      showToast(err.response?.data?.message || "Erro conectando com Supabase", "error");
    } finally {
      setSupabaseSyncing(false);
    }
  }

  async function triggerSupabasePull(mode = "merge") {
    if (triggerHaptic) triggerHaptic(25);
    setSupabaseSyncing(true);
    try {
      const res = await axios.post(`${api}/supabase/pull`, { mode });
      if (res.data?.success) {
        showToast("📥 Tempos restaurados da nuvem!", "success");
        checkSupabaseStatus();
        if (onReloadGames) onReloadGames();
      } else {
        showToast(res.data?.message || "Falha ao restaurar", "error");
      }
    } catch (err) {
      showToast(err.response?.data?.message || "Erro baixando do Supabase", "error");
    } finally {
      setSupabaseSyncing(false);
    }
  }

  // Salvar tudo
  async function handleSave(e) {
    if (e) e.preventDefault();
    if (triggerHaptic) triggerHaptic(35);
    setSaving(true);

    try {
      const newApiToken = String(form.apiToken || "").trim();
      const res = await axios.put(`${api}/settings`, {
        env: {
          serverIp: String(form.serverIp || "").trim(),
          port: Number(form.port) || 3060,
          frontendPort: Number(form.frontendPort) || 8060,
          gameFolder: String(form.gameFolder || "").trim(),
          steamApiKey: String(form.steamApiKey || "").trim(),
          steamUserId: String(form.steamUserId || "").trim(),
          steamGridDbKey: String(form.steamGridDbKey || "").trim(),
          supabaseUrl: String(form.supabaseUrl || "").trim(),
          supabaseKey: String(form.supabaseKey || "").trim(),
          supabaseEmail: String(form.supabaseEmail || "").trim(),
          supabasePassword: String(form.supabasePassword || "").trim(),
          apiToken: newApiToken,
        },
        automation: {
          autoDetectGames: Boolean(form.autoDetectGames),
          monitorIntervalSec: Number(form.monitorIntervalSec) || 8,
          shutdownTimerSec: Number(form.shutdownTimerSec) || 30,
          defaultCloseMode: form.defaultCloseMode === "soft" ? "soft" : "force",
          touchpadSensitivity: Number(form.touchpadSensitivity) || 2.1,
          volumeStep: Number(form.volumeStep) || 3,
        },
      });

      if (res.data?.success) {
        showToast(res.data.message || "Configurações salvas com sucesso!", "success");
        if (onReloadGames) onReloadGames();

        // Atualiza os metadados locais de segredos
        if (res.data.env) {
          const env = res.data.env;
          setSecretsMeta((prev) => ({
            ...prev,
            hasSteamApiKey: Boolean(env.hasSteamApiKey),
            steamApiKeyHint: env.steamApiKeyHint || prev.steamApiKeyHint,
            steamUserId: env.steamUserId || prev.steamUserId,
            hasSteamGridDbKey: Boolean(env.hasSteamGridDbKey),
            steamGridDbKeyHint: env.steamGridDbKeyHint || prev.steamGridDbKeyHint,
            hasSupabaseKey: Boolean(env.hasSupabaseKey),
            supabaseKeyHint: env.supabaseKeyHint || prev.supabaseKeyHint,
            hasSupabasePassword: Boolean(env.hasSupabasePassword),
            hasApiToken: Boolean(env.hasApiToken),
            apiTokenHint: env.apiTokenHint || prev.apiTokenHint,
          }));
        }

        // Limpa campos sensíveis do form
        setForm((prev) => ({
          ...prev,
          steamApiKey: "",
          steamGridDbKey: "",
          supabaseKey: "",
          supabasePassword: "",
          apiToken: "",
        }));

        if (res.data.folderStatus) setFolderValidation(res.data.folderStatus);
      }
    } catch (err) {
      console.error("Erro salvando:", err);
      showToast(err.response?.data?.message || "Erro ao salvar configurações", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-page-wrapper">
      {/* Topo da Página de Configuração */}
      <header className="settings-page-header">
        <div className="settings-header-left">
          <button
            className="btn btn-back-library"
            onClick={onBack}
            aria-label="Voltar para a biblioteca"
          >
            ← Voltar à Biblioteca
          </button>
          <div className="settings-header-title">
            <h1>⚙️ Configurações do Sistema</h1>
            <p>Gerencie integrações, redes, biblioteca, nuvem e automação do seu GameLauncher</p>
          </div>
        </div>

        <div className="settings-header-actions">
          <button
            type="button"
            className="btn btn-primary btn-save-header"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Salvando..." : "💾 Salvar Alterações"}
          </button>
        </div>
      </header>

      {/* Conteúdo Principal com Sidebar / Navegação por Abas */}
      <div className="settings-page-container">
        <aside className="settings-page-sidebar">
          <nav className="settings-nav-tabs">
            <button
              type="button"
              className={`settings-nav-btn ${activeTab === "steam" ? "active" : ""}`}
              onClick={() => setActiveTab("steam")}
            >
              <span className="nav-icon">🎮</span>
              <div className="nav-text">
                <strong>Steam & Conquistas</strong>
                <small>API Key, SteamID64 e Sincronização</small>
              </div>
            </button>

            <button
              type="button"
              className={`settings-nav-btn ${activeTab === "games" ? "active" : ""}`}
              onClick={() => setActiveTab("games")}
            >
              <span className="nav-icon">📁</span>
              <div className="nav-text">
                <strong>Biblioteca & Capas</strong>
                <small>Diretório de jogos e SteamGridDB</small>
              </div>
            </button>

            <button
              type="button"
              className={`settings-nav-btn ${activeTab === "network" ? "active" : ""}`}
              onClick={() => setActiveTab("network")}
            >
              <span className="nav-icon">🌐</span>
              <div className="nav-text">
                <strong>Rede & Servidor</strong>
                <small>IP local, portas e segurança</small>
              </div>
            </button>

            <button
              type="button"
              className={`settings-nav-btn ${activeTab === "supabase" ? "active" : ""}`}
              onClick={() => setActiveTab("supabase")}
            >
              <span className="nav-icon">☁️</span>
              <div className="nav-text">
                <strong>Supabase Cloud</strong>
                <small>Backup e sync de tempo de jogo</small>
              </div>
            </button>

            <button
              type="button"
              className={`settings-nav-btn ${activeTab === "automation" ? "active" : ""}`}
              onClick={() => setActiveTab("automation")}
            >
              <span className="nav-icon">⚡</span>
              <div className="nav-text">
                <strong>Automação & Processos</strong>
                <small>Detecção em segundo plano e controle</small>
              </div>
            </button>
          </nav>
        </aside>

        <main className="settings-page-content">
          {loading ? (
            <div className="settings-loading-card">
              <span className="btn-spinner"></span> Carregando configurações...
            </div>
          ) : (
            <form onSubmit={handleSave} className="settings-form">
              {/* ABA 1: STEAM & CONQUISTAS */}
              {activeTab === "steam" && (
                <section className="settings-section-card">
                  <div className="section-card-header">
                    <h2>🎮 Integração Steam & Conquistas</h2>
                    <p>
                      Importe o catálogo oficial de conquistas, ícones e o status de desbloqueio dos
                      seus jogos na Steam via Steam Web API.
                    </p>
                  </div>

                  <div className="settings-info-box">
                    <span className="info-icon">ℹ️</span>
                    <div>
                      <strong>Como funciona:</strong> O GameLauncher já detecta automaticamente seu
                      tempo de jogo via Steam local. Para carregar os troféus e conquistas
                      oficiais, informe sua <strong>Steam Web API Key</strong> gratuita e certifique-se
                      de que o seu perfil da Steam (e os detalhes de jogos) estejam definidos como{" "}
                      <strong>Públicos</strong> na Steam.
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="steamApiKey">
                      Chave da Steam Web API (STEAM_API_KEY)
                    </label>
                    <div className="input-with-actions">
                      <input
                        id="steamApiKey"
                        type={showSteamKey ? "text" : "password"}
                        className="form-control"
                        placeholder={
                          secretsMeta.hasSteamApiKey
                            ? `Chave salva: ${secretsMeta.steamApiKeyHint} (Digite para alterar)`
                            : "Cole sua chave da Steam Web API aqui..."
                        }
                        value={form.steamApiKey}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, steamApiKey: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon-only"
                        onClick={() => setShowSteamKey(!showSteamKey)}
                        title={showSteamKey ? "Ocultar chave" : "Mostrar chave"}
                      >
                        {showSteamKey ? "🙈" : "👁️"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={testSteamKey}
                        disabled={testingSteamKey}
                      >
                        {testingSteamKey ? "Testando..." : "Testar Chave"}
                      </button>
                    </div>

                    <div className="form-help-row">
                      <span className="form-help">
                        Precisa de uma chave? Obtenha instantaneamente em:{" "}
                        <a
                          href="https://steamcommunity.com/dev/apikey"
                          target="_blank"
                          rel="noreferrer"
                          className="settings-link"
                        >
                          steamcommunity.com/dev/apikey ↗
                        </a>
                      </span>
                      {secretsMeta.hasSteamApiKey && (
                        <span className="badge-status success">✓ Chave configurada no sistema</span>
                      )}
                    </div>

                    {steamKeyTestResult && (
                      <div
                        className={`test-result-box ${
                          steamKeyTestResult.valid ? "success" : "error"
                        }`}
                      >
                        <span>{steamKeyTestResult.valid ? "✓" : "✕"}</span>
                        <div>
                          <strong>{steamKeyTestResult.message}</strong>
                          {steamKeyTestResult.playerCheck && (
                            <p style={{ margin: "4px 0 0 0", fontSize: "0.85rem" }}>
                              {steamKeyTestResult.playerCheck.message}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="steamUserId">
                      SteamID64 do Jogador (STEAM_USER_ID)
                    </label>
                    <div className="input-with-actions">
                      <input
                        id="steamUserId"
                        type="text"
                        className="form-control"
                        placeholder="Ex: 76561198230860248"
                        value={form.steamUserId}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, steamUserId: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={detectSteamLocal}
                        disabled={detectingSteamUser}
                        title="Detecta a instalação da Steam e usuário ativo no seu computador"
                      >
                        {detectingSteamUser ? "Detectando..." : "🔍 Detectar do PC"}
                      </button>
                    </div>

                    {detectedSteamData && (
                      <div className="steam-detected-box">
                        <small>
                          🖥️ Steam detectada em:{" "}
                          <code>{detectedSteamData.steamPath || "Caminho padrão"}</code>
                          {detectedSteamData.accountId && (
                            <> • Conta ativa: <strong>{detectedSteamData.accountId}</strong></>
                          )}
                        </small>
                      </div>
                    )}
                  </div>

                  <div className="settings-divider" />

                  <div className="settings-action-block">
                    <div>
                      <strong>🏆 Sincronização em Massa de Conquistas</strong>
                      <p>
                        Percorre todos os jogos cadastrados na sua biblioteca que possuem identificador
                        da Steam e baixa as conquistas e status para o banco de dados local.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={syncAllAchievements}
                      disabled={syncingAllAchievements || (!secretsMeta.hasSteamApiKey && !form.steamApiKey)}
                    >
                      {syncingAllAchievements ? "Sincronizando biblioteca..." : "Sincronizar Todos os Jogos"}
                    </button>
                  </div>
                </section>
              )}

              {/* ABA 2: BIBLIOTECA & CAPAS */}
              {activeTab === "games" && (
                <section className="settings-section-card">
                  <div className="section-card-header">
                    <h2>📁 Biblioteca de Jogos & Capas</h2>
                    <p>Defina o diretório de escaneamento dos jogos e configure a busca de pôsteres em alta resolução.</p>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="gameFolder">
                      Diretório Raiz dos Jogos (GAME_FOLDER)
                    </label>
                    <div className="input-with-actions">
                      <input
                        id="gameFolder"
                        type="text"
                        className="form-control"
                        placeholder="Ex: C:\Jogos ou D:\SteamLibrary\steamapps\common"
                        value={form.gameFolder}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, gameFolder: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => validateFolder()}
                        disabled={validatingFolder}
                      >
                        {validatingFolder ? "Validando..." : "Testar Pasta"}
                      </button>
                    </div>

                    {folderValidation && (
                      <div
                        className={`folder-status-box ${
                          folderValidation.valid ? "valid" : "invalid"
                        }`}
                      >
                        <strong>
                          {folderValidation.valid ? "✓ Pasta Válida" : "⚠️ Pasta Não Encontrada"}
                        </strong>
                        <p>{folderValidation.message}</p>
                        {folderValidation.gameCount !== undefined && (
                          <small>Jogos encontrados: {folderValidation.gameCount}</small>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="settings-divider" />

                  <div className="form-group">
                    <label className="form-label" htmlFor="steamGridDbKey">
                      Chave da API SteamGridDB (Busca de Capas em Alta Resolução)
                    </label>
                    <div className="input-with-actions">
                      <input
                        id="steamGridDbKey"
                        type={showSteamGridKey ? "text" : "password"}
                        className="form-control"
                        placeholder={
                          secretsMeta.hasSteamGridDbKey
                            ? `Chave salva: ${secretsMeta.steamGridDbKeyHint} (Digite para alterar)`
                            : "Cole sua chave do SteamGridDB aqui..."
                        }
                        value={form.steamGridDbKey}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, steamGridDbKey: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon-only"
                        onClick={() => setShowSteamGridKey(!showSteamGridKey)}
                        title={showSteamGridKey ? "Ocultar chave" : "Mostrar chave"}
                      >
                        {showSteamGridKey ? "🙈" : "👁️"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={testGridKey}
                        disabled={testingGridKey}
                      >
                        {testingGridKey ? "Testando..." : "Testar Chave"}
                      </button>
                    </div>

                    <div className="form-help-row">
                      <span className="form-help">
                        Gere sua chave em:{" "}
                        <a
                          href="https://www.steamgriddb.com/profile/preferences/api"
                          target="_blank"
                          rel="noreferrer"
                          className="settings-link"
                        >
                          steamgriddb.com/profile/preferences/api ↗
                        </a>
                      </span>
                      {secretsMeta.hasSteamGridDbKey && (
                        <span className="badge-status success">✓ Chave configurada</span>
                      )}
                    </div>

                    {gridKeyTestResult && (
                      <div
                        className={`test-result-box ${
                          gridKeyTestResult.valid ? "success" : "error"
                        }`}
                      >
                        <span>{gridKeyTestResult.valid ? "✓" : "✕"}</span>
                        <strong>{gridKeyTestResult.message}</strong>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* ABA 3: REDE & SERVIDOR */}
              {activeTab === "network" && (
                <section className="settings-section-card">
                  <div className="section-card-header">
                    <h2>🌐 Rede & Servidor</h2>
                    <p>Configure o endereço IP e as portas para acessar o GameLauncher de outros dispositivos (celular, tablet ou TV).</p>
                  </div>

                  <div className="form-row-2">
                    <div className="form-group">
                      <label className="form-label" htmlFor="serverIp">
                        IP da Máquina na Rede Local (SERVER_IP)
                      </label>
                      <input
                        id="serverIp"
                        type="text"
                        className="form-control"
                        placeholder="Ex: 192.168.1.100"
                        value={form.serverIp}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, serverIp: e.target.value }))
                        }
                      />

                      {networkInterfaces.length > 0 && (
                        <div className="ip-suggestions-list">
                          <small>IPs detectados no computador:</small>
                          <div className="suggestion-chips">
                            {networkInterfaces.map((iface) => (
                              <button
                                key={iface.address}
                                type="button"
                                className="suggestion-chip"
                                onClick={() =>
                                  setForm((prev) => ({ ...prev, serverIp: iface.address }))
                                }
                                title={`Usar ${iface.address} (${iface.name})`}
                              >
                                {iface.address} <span className="chip-name">({iface.name})</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="form-row-inner">
                      <div className="form-group">
                        <label className="form-label" htmlFor="port">
                          Porta da API (PORT)
                        </label>
                        <input
                          id="port"
                          type="number"
                          className="form-control"
                          value={form.port}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, port: parseInt(e.target.value, 10) || 3060 }))
                          }
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label" htmlFor="frontendPort">
                          Porta Web (FRONTEND_PORT)
                        </label>
                        <input
                          id="frontendPort"
                          type="number"
                          className="form-control"
                          value={form.frontendPort}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              frontendPort: parseInt(e.target.value, 10) || 8060,
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="settings-divider" />

                  <div className="form-group">
                    <label className="form-label" htmlFor="apiToken">
                      Token de Segurança da API (API_TOKEN)
                    </label>
                    <div className="input-with-actions">
                      <input
                        id="apiToken"
                        type={showApiToken ? "text" : "password"}
                        className="form-control"
                        placeholder={
                          secretsMeta.hasApiToken
                            ? `Token ativo: ${secretsMeta.apiTokenHint} (Deixe em branco para manter)`
                            : "Token gerado automaticamente"
                        }
                        value={form.apiToken}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, apiToken: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon-only"
                        onClick={() => setShowApiToken(!showApiToken)}
                        title={showApiToken ? "Ocultar token" : "Mostrar token"}
                      >
                        {showApiToken ? "🙈" : "👁️"}
                      </button>
                    </div>
                    <span className="form-help">
                      Protege comandos críticos como iniciar jogos, controle remoto e encerramento de processos.
                    </span>
                  </div>
                </section>
              )}

              {/* ABA 4: SUPABASE CLOUD */}
              {activeTab === "supabase" && (
                <section className="settings-section-card">
                  <div className="section-card-header">
                    <h2>☁️ Sincronização em Nuvem (Supabase)</h2>
                    <p>Faça backup automático do tempo de jogo, contador de sessões e estatísticas na nuvem.</p>
                  </div>

                  {supabaseStatus && (
                    <div
                      className={`supabase-status-pill ${
                        supabaseStatus.connected ? "connected" : "disconnected"
                      }`}
                    >
                      <span className="status-indicator-dot" />
                      <div>
                        <strong>
                          {supabaseStatus.connected
                            ? "Supabase Conectado"
                            : "Supabase Não Conectado ou Pendente"}
                        </strong>
                        {supabaseStatus.error && <p>{supabaseStatus.error}</p>}
                      </div>
                    </div>
                  )}

                  <div className="form-group">
                    <label className="form-label" htmlFor="supabaseUrl">
                      URL do Projeto Supabase (SUPABASE_URL)
                    </label>
                    <input
                      id="supabaseUrl"
                      type="text"
                      className="form-control"
                      placeholder="https://xyzcompany.supabase.co"
                      value={form.supabaseUrl}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, supabaseUrl: e.target.value }))
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="supabaseKey">
                      Chave Supabase Anon/Public (SUPABASE_KEY)
                    </label>
                    <div className="input-with-actions">
                      <input
                        id="supabaseKey"
                        type={showSupabaseKey ? "text" : "password"}
                        className="form-control"
                        placeholder={
                          secretsMeta.hasSupabaseKey
                            ? `Chave salva: ${secretsMeta.supabaseKeyHint}`
                            : "Cole sua chave anon/public..."
                        }
                        value={form.supabaseKey}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, supabaseKey: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon-only"
                        onClick={() => setShowSupabaseKey(!showSupabaseKey)}
                        title={showSupabaseKey ? "Ocultar" : "Mostrar"}
                      >
                        {showSupabaseKey ? "🙈" : "👁️"}
                      </button>
                    </div>
                  </div>

                  <div className="form-row-2">
                    <div className="form-group">
                      <label className="form-label" htmlFor="supabaseEmail">
                        E-mail de Autenticação (Opcional)
                      </label>
                      <input
                        id="supabaseEmail"
                        type="email"
                        className="form-control"
                        placeholder="usuario@email.com"
                        value={form.supabaseEmail}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, supabaseEmail: e.target.value }))
                        }
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="supabasePassword">
                        Senha de Autenticação (Opcional)
                      </label>
                      <div className="input-with-actions">
                        <input
                          id="supabasePassword"
                          type={showSupabasePassword ? "text" : "password"}
                          className="form-control"
                          placeholder={
                            secretsMeta.hasSupabasePassword ? "•••••••• (Salva)" : "Senha..."
                          }
                          value={form.supabasePassword}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, supabasePassword: e.target.value }))
                          }
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-icon-only"
                          onClick={() => setShowSupabasePassword(!showSupabasePassword)}
                          title={showSupabasePassword ? "Ocultar" : "Mostrar"}
                        >
                          {showSupabasePassword ? "🙈" : "👁️"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="settings-divider" />

                  <div className="supabase-actions-row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={triggerSupabasePush}
                      disabled={supabaseSyncing}
                    >
                      ☁️ Enviar Dados Locais para Nuvem (Push)
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => triggerSupabasePull("merge")}
                      disabled={supabaseSyncing}
                    >
                      📥 Mesclar Dados da Nuvem (Pull)
                    </button>
                  </div>
                </section>
              )}

              {/* ABA 5: AUTOMAÇÃO & PROCESSOS */}
              {activeTab === "automation" && (
                <section className="settings-section-card">
                  <div className="section-card-header">
                    <h2>⚡ Automação & Detecção de Processos</h2>
                    <p>Ajuste o comportamento do monitor em segundo plano e do controle remoto.</p>
                  </div>

                  <div className="form-group-toggle">
                    <div>
                      <strong>Detecção Automática de Jogos em Segundo Plano</strong>
                      <p>Contabiliza o tempo mesmo se o jogo for iniciado diretamente pela Steam, Epic ou Explorer.</p>
                    </div>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={form.autoDetectGames}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, autoDetectGames: e.target.checked }))
                        }
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <div className="form-row-2">
                    <div className="form-group">
                      <label className="form-label" htmlFor="monitorInterval">
                        Intervalo do Monitor (segundos)
                      </label>
                      <input
                        id="monitorInterval"
                        type="number"
                        min="2"
                        max="60"
                        className="form-control"
                        value={form.monitorIntervalSec}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            monitorIntervalSec: parseInt(e.target.value, 10) || 8,
                          }))
                        }
                      />
                      <span className="form-help">Padrão recomendado: 8 segundos.</span>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="defaultCloseMode">
                        Método Padrão de Fechamento de Jogo
                      </label>
                      <select
                        id="defaultCloseMode"
                        className="form-control"
                        value={form.defaultCloseMode}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, defaultCloseMode: e.target.value }))
                        }
                      >
                        <option value="force">Forçar Encerramento Imediato (taskkill /F)</option>
                        <option value="soft">Fechamento Suave (WM_CLOSE / Alt+F4)</option>
                      </select>
                    </div>
                  </div>

                  <div className="form-row-2">
                    <div className="form-group">
                      <label className="form-label" htmlFor="touchpadSensitivity">
                        Sensibilidade do Touchpad Virtual
                      </label>
                      <input
                        id="touchpadSensitivity"
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="5.0"
                        className="form-control"
                        value={form.touchpadSensitivity}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            touchpadSensitivity: parseFloat(e.target.value) || 2.1,
                          }))
                        }
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="volumeStep">
                        Passo de Ajuste de Volume (%)
                      </label>
                      <input
                        id="volumeStep"
                        type="number"
                        min="1"
                        max="20"
                        className="form-control"
                        value={form.volumeStep}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            volumeStep: parseInt(e.target.value, 10) || 3,
                          }))
                        }
                      />
                    </div>
                  </div>
                </section>
              )}

              {/* Botões Inferiores Fixos */}
              <div className="settings-page-bottom-bar">
                <button type="button" className="btn btn-secondary" onClick={onBack}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
                  {saving ? "Salvando Alterações..." : "💾 Salvar Todas as Configurações"}
                </button>
              </div>
            </form>
          )}
        </main>
      </div>
    </div>
  );
}
