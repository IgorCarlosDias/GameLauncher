import React, { useState } from "react";
import {
  Monitor,
  Tv,
  Speaker,
  Headphones,
  SkipBack,
  Play,
  SkipForward,
  CornerDownLeft,
  Delete,
  Space,
  XSquare,
  Send,
  ChevronUp,
  ChevronDown,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowRight,
} from "lucide-react";
import { systemApi } from "../../api";
import { haptic } from "../../lib/haptics";
import { useToast } from "../../hooks/useToast";

export default function RemoteControls({
  audio,
  remoteInfo,
  onCloseGameSoft,
  pcOnline,
}) {
  const toast = useToast();
  const [keyboardText, setKeyboardText] = useState("");
  const [sendingKey, setSendingKey] = useState(false);

  const { stats, displayMode, switching, switchDisplay } = remoteInfo;

  async function handleKey(key, label) {
    if (key === "enter") {
      haptic.select();
    } else {
      haptic.tap();
    }
    try {
      await systemApi.key(key);
      if (label) toast.show(label, "info");
    } catch {
      toast.show("Falha ao enviar tecla", "error");
    }
  }

  async function handleMedia(action, label) {
    haptic.tap();
    try {
      await systemApi.media(action);
      if (label) toast.show(label, "info");
    } catch {
      toast.show("Falha ao controlar mídia", "error");
    }
  }

  async function handleMouseClick(button) {
    if (button === "double") {
      haptic.double();
    } else {
      haptic.tap();
    }
    try {
      await systemApi.mouseClick(button);
    } catch {
      // Silencioso
    }
  }

  async function handleScroll(delta) {
    haptic.tap();
    try {
      await systemApi.mouseScroll(delta);
    } catch {
      // Silencioso
    }
  }

  async function handleSendText(e, submitEnter = false) {
    if (e) e.preventDefault();
    if (!keyboardText) return;
    haptic.confirm();
    setSendingKey(true);
    try {
      await systemApi.typeText(keyboardText, submitEnter);
      setKeyboardText("");
      toast.show(submitEnter ? "Texto enviado com Enter" : "Texto digitado", "success");
    } catch {
      toast.show("Falha ao enviar texto", "error");
    } finally {
      setSendingKey(false);
    }
  }

  return (
    <div className="remote-controls-stack">
      {/* 1. Telemetria do PC */}
      {stats && (
        <section className="remote-card pc-telemetry-strip" aria-label="Status do Computador">
          <div className="telemetry-bar-item">
            <div className="telemetry-bar-label">
              <span>CPU</span>
              <strong>{stats.cpuPercent}%</strong>
            </div>
            <div className="meter-track">
              <div
                className="meter-fill meter-fill--cpu"
                style={{ width: `${Math.min(100, stats.cpuPercent)}%` }}
              />
            </div>
          </div>

          <div className="telemetry-bar-item">
            <div className="telemetry-bar-label">
              <span>RAM</span>
              <strong>
                {stats.ramUsedGB}/{stats.ramTotalGB} GB
              </strong>
            </div>
            <div className="meter-track">
              <div
                className="meter-fill meter-fill--ram"
                style={{ width: `${Math.min(100, stats.ramPercent)}%` }}
              />
            </div>
          </div>

          <div className="telemetry-uptime-pill">
            <span>Ativo</span>
            <strong>{stats.uptimeHours}h</strong>
          </div>
        </section>
      )}

      {/* 2. Seleção de Tela / Projeção */}
      <section className="remote-card">
        <div className="remote-card-header">
          <div className="remote-card-titles">
            <h3>Projeção de Tela</h3>
            <span className="remote-badge-status">
              {displayMode === "external"
                ? "Segunda tela (TV)"
                : displayMode === "internal"
                ? "Tela do PC"
                : displayMode === "extend"
                ? "Estendida"
                : displayMode === "clone"
                ? "Duplicada"
                : "Automático"}
            </span>
          </div>
        </div>

        <div className="remote-grid-2">
          <button
            type="button"
            className={`btn-selector ${displayMode === "internal" ? "is-active" : ""}`}
            onClick={() => switchDisplay("internal")}
            disabled={switching || !pcOnline}
          >
            <Monitor size={18} />
            <div className="btn-selector-text">
              <strong>Tela do PC</strong>
              <small>Somente PC</small>
            </div>
          </button>

          <button
            type="button"
            className={`btn-selector ${displayMode === "external" ? "is-active" : ""}`}
            onClick={() => switchDisplay("external")}
            disabled={switching || !pcOnline}
          >
            <Tv size={18} />
            <div className="btn-selector-text">
              <strong>TV da Sala</strong>
              <small>Segunda tela</small>
            </div>
          </button>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-block mt-2"
          onClick={() => switchDisplay("toggle")}
          disabled={switching || !pcOnline}
        >
          Alternar Monitor ⇄ TV
        </button>
      </section>

      {/* 3. Dispositivos de Saída de Áudio */}
      {audio.devices?.length > 0 && (
        <section className="remote-card">
          <div className="remote-card-header">
            <h3>Dispositivo de Áudio</h3>
          </div>
          <div className="audio-devices-grid">
            {audio.devices.map((dev) => (
              <button
                key={dev.id}
                type="button"
                className={`audio-device-chip ${dev.isDefault ? "is-active" : ""}`}
                onClick={() => audio.switchDevice(dev)}
                disabled={!pcOnline}
              >
                {dev.name.toLowerCase().includes("tv") ||
                dev.name.toLowerCase().includes("hdmi") ||
                dev.name.toLowerCase().includes("lg") ||
                dev.name.toLowerCase().includes("samsung") ? (
                  <Tv size={16} />
                ) : dev.name.toLowerCase().includes("headset") ||
                  dev.name.toLowerCase().includes("fone") ? (
                  <Headphones size={16} />
                ) : (
                  <Speaker size={16} />
                )}
                <span className="audio-device-name">{dev.name}</span>
                {dev.isDefault && <span className="audio-device-active-dot" />}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 4. Controles de Mídia */}
      <section className="remote-card">
        <div className="remote-card-header">
          <h3>Reprodução de Mídia</h3>
        </div>
        <div className="remote-actions-row">
          <button
            type="button"
            className="btn btn-secondary icon-btn-lg"
            onClick={() => handleMedia("prev", "Faixa anterior")}
            disabled={!pcOnline}
            aria-label="Faixa anterior"
          >
            <SkipBack size={20} />
          </button>
          <button
            type="button"
            className="btn btn-primary icon-btn-lg"
            onClick={() => handleMedia("play_pause", "Play / Pause")}
            disabled={!pcOnline}
            aria-label="Play / Pause"
          >
            <Play size={20} fill="currentColor" />
          </button>
          <button
            type="button"
            className="btn btn-secondary icon-btn-lg"
            onClick={() => handleMedia("next", "Próxima faixa")}
            disabled={!pcOnline}
            aria-label="Próxima faixa"
          >
            <SkipForward size={20} />
          </button>
        </div>
      </section>

      {/* 5. Ações Rápidas do Windows & Janelas */}
      <section className="remote-card">
        <div className="remote-card-header">
          <h3>Atalhos do Windows</h3>
        </div>
        <div className="shortcut-buttons-grid">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleKey("alttab", "Alt + Tab")}
            disabled={!pcOnline}
          >
            Alt + Tab
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleKey("wind", "Área de Trabalho")}
            disabled={!pcOnline}
            title="Área de Trabalho (Win + D)"
          >
            Desktop
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleKey("win", "Menu Iniciar")}
            disabled={!pcOnline}
          >
            Win
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleKey("escape", "Esc")}
            disabled={!pcOnline}
          >
            Esc
          </button>
        </div>

        <button
          type="button"
          className="btn btn-warning-soft btn-block mt-3"
          onClick={() => {
            haptic.heavy();
            onCloseGameSoft?.();
          }}
          disabled={!pcOnline}
        >
          <XSquare size={18} />
          <span>Fechar Janela em Foco (Alt + F4)</span>
        </button>
      </section>

      {/* 6. Digitação Remota */}
      <section className="remote-card">
        <div className="remote-card-header">
          <h3>Digitar no Computador</h3>
        </div>
        <form onSubmit={(e) => handleSendText(e, false)} className="remote-type-form">
          <input
            type="text"
            className="field__input"
            placeholder="Digite texto, pesquisa ou senha..."
            value={keyboardText}
            onChange={(e) => setKeyboardText(e.target.value)}
            disabled={!pcOnline}
          />
          <div className="remote-type-actions">
            <button
              type="submit"
              className="btn btn-secondary"
              disabled={!keyboardText || sendingKey || !pcOnline}
            >
              Digitar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={(e) => handleSendText(e, true)}
              disabled={!keyboardText || sendingKey || !pcOnline}
            >
              <Send size={16} />
              <span>Enviar ↵</span>
            </button>
          </div>
        </form>

        <div className="shortcut-buttons-grid mt-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleKey("backspace", "Backspace")}
            disabled={!pcOnline}
          >
            <Delete size={15} /> <span>Apagar</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleKey("space", "Espaço")}
            disabled={!pcOnline}
          >
            <Space size={15} /> <span>Espaço</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleKey("tab", "Tab")}
            disabled={!pcOnline}
          >
            <span>Tab</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleKey("enter", "Enter")}
            disabled={!pcOnline}
          >
            <CornerDownLeft size={15} /> <span>Enter</span>
          </button>
        </div>
      </section>

      {/* 7. Mouse Rápido & Setas */}
      <section className="remote-card">
        <div className="remote-card-header">
          <h3>Botões de Navegação</h3>
        </div>

        <div className="mouse-buttons-grid">
          <button
            type="button"
            className="btn btn-secondary mouse-btn"
            onClick={() => handleMouseClick("left")}
            disabled={!pcOnline}
          >
            Clique Esq.
          </button>
          <button
            type="button"
            className="btn btn-secondary mouse-btn"
            onClick={() => handleMouseClick("double")}
            disabled={!pcOnline}
          >
            2x Clique
          </button>
          <button
            type="button"
            className="btn btn-secondary mouse-btn"
            onClick={() => handleMouseClick("right")}
            disabled={!pcOnline}
          >
            Clique Dir.
          </button>
        </div>

        <div className="scroll-buttons-pair mt-2">
          <button
            type="button"
            className="btn btn-secondary scroll-btn"
            onClick={() => handleScroll(240)}
            disabled={!pcOnline}
            aria-label="Rolar para cima"
          >
            <ChevronUp size={16} />
            <span>Rolar Cima</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary scroll-btn"
            onClick={() => handleScroll(-240)}
            disabled={!pcOnline}
            aria-label="Rolar para baixo"
          >
            <ChevronDown size={16} />
            <span>Rolar Baixo</span>
          </button>
        </div>

        <div className="dpad-grid mt-3">
          <div />
          <button
            type="button"
            className="btn btn-secondary dpad-btn"
            onClick={() => handleKey("up")}
            disabled={!pcOnline}
            aria-label="Cima"
          >
            <ArrowUp size={18} />
          </button>
          <div />

          <button
            type="button"
            className="btn btn-secondary dpad-btn"
            onClick={() => handleKey("left")}
            disabled={!pcOnline}
            aria-label="Esquerda"
          >
            <ArrowLeft size={18} />
          </button>
          <button
            type="button"
            className="btn btn-primary dpad-btn"
            onClick={() => handleKey("enter")}
            disabled={!pcOnline}
            aria-label="OK / Enter"
          >
            OK
          </button>
          <button
            type="button"
            className="btn btn-secondary dpad-btn"
            onClick={() => handleKey("right")}
            disabled={!pcOnline}
            aria-label="Direita"
          >
            <ArrowRight size={18} />
          </button>

          <div />
          <button
            type="button"
            className="btn btn-secondary dpad-btn"
            onClick={() => handleKey("down")}
            disabled={!pcOnline}
            aria-label="Baixo"
          >
            <ArrowDown size={18} />
          </button>
          <div />
        </div>
      </section>
    </div>
  );
}
