import React, { useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { ENV_DEFAULT_TOKEN, apiFetch, getApiToken, setApiToken } from "../../api";
import { haptic } from "../../lib/haptics";

/**
 * Modal minimalista de autenticação para pareamento seguro com o PC Host.
 * Armazena o token em `localStorage` sob a chave `gamelauncher_auth_token`
 * quando "Lembrar neste aparelho" está marcado.
 */
export default function AuthModal({ open, reason, onAuthenticated }) {
  const [tokenInput, setTokenInput] = useState(() => getApiToken() || "");
  const [remember, setRemember] = useState(true);
  const [showSecret, setShowSecret] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    const cleaned = tokenInput.trim();
    if (!cleaned) {
      setError("Informe a chave de acesso (AUTH_TOKEN) do host.");
      haptic.warn();
      return;
    }

    setVerifying(true);
    setError("");

    try {
      const response = await apiFetch("/auth/verify", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${cleaned}`,
          "x-api-token": cleaned,
        },
        skipAuthPrompt: true,
      });

      if (response.status === 401 || response.status === 403) {
        setError("Chave de acesso inválida ou recusada pelo host.");
        haptic.warn();
        return;
      }

      if (!response.ok) {
        setError("Não foi possível validar a chave no momento. Verifique se o PC está online.");
        haptic.warn();
        return;
      }

      setApiToken(cleaned, { remember });
      haptic.success();
      onAuthenticated?.(cleaned);
    } catch {
      // Se o PC estiver iniciando ou offline, salva localmente para reconectar assim que responder
      setApiToken(cleaned, { remember });
      onAuthenticated?.(cleaned);
    } finally {
      setVerifying(false);
    }
  }

  function handleUseEnvToken() {
    if (!ENV_DEFAULT_TOKEN) return;
    haptic.tap();
    setTokenInput(ENV_DEFAULT_TOKEN);
    setError("");
  }

  return (
    <div className="auth-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <div className="auth-modal-card">
        <div className="auth-modal-icon-wrap" aria-hidden="true">
          <KeyRound size={24} />
        </div>

        <h2 id="auth-modal-title" className="auth-modal-title">
          Chave de Acesso do Host
        </h2>

        <p className="auth-modal-desc">
          {reason === "http_401" || reason === "axios_401"
            ? "Sessão não autorizada (401). Insira o Bearer Token configurado no PC para liberar o controle remoto."
            : "Para proteger seu computador na rede local, insira o AUTH_TOKEN definido no arquivo .env do servidor."}
        </p>

        <form onSubmit={handleSubmit} className="auth-modal-form">
          <div className="auth-input-group">
            <input
              type={showSecret ? "text" : "password"}
              className="field__input auth-input"
              placeholder="Ex: gl_sec_..."
              value={tokenInput}
              onChange={(e) => {
                setTokenInput(e.target.value);
                if (error) setError("");
              }}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="icon-btn auth-eye-btn"
              onClick={() => setShowSecret((prev) => !prev)}
              aria-label={showSecret ? "Ocultar chave" : "Mostrar chave"}
            >
              {showSecret ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {ENV_DEFAULT_TOKEN && tokenInput !== ENV_DEFAULT_TOKEN && (
            <button
              type="button"
              className="auth-env-hint-btn"
              onClick={handleUseEnvToken}
            >
              <Sparkles size={14} />
              <span>Usar chave detectada no ambiente local</span>
            </button>
          )}

          <label className="auth-remember-row">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Lembrar neste aparelho</span>
          </label>

          {error && (
            <p className="auth-error-msg" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block auth-submit-btn"
            disabled={verifying}
          >
            {verifying ? (
              <>
                <Loader2 size={18} className="spin" />
                <span>Validando credencial…</span>
              </>
            ) : (
              <>
                <ShieldCheck size={18} />
                <span>Autenticar Dispositivo</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
