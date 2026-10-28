import React, { useState, useRef } from "react";
import { Sliders, MousePointer, ShieldAlert } from "lucide-react";
import Segmented from "../components/ui/Segmented";
import TouchpadCanvas from "../components/remote/TouchpadCanvas";
import RemoteControls from "../components/remote/RemoteControls";
import { systemApi } from "../api";
import { haptic } from "../lib/haptics";

export default function RemotePage({
  audio,
  remoteInfo,
  onCloseGameSoft,
  onOpenPower,
  pcOnline,
  sensitivity = 2.1,
}) {
  const [tab, setTab] = useState("controls"); // 'controls' | 'touchpad'
  const lastRightClickTimeRef = useRef(0);

  const TABS = [
    { id: "controls", label: "Sistema & Teclas", icon: Sliders },
    { id: "touchpad", label: "Touchpad Virtual", icon: MousePointer },
  ];

  async function handleMouseClick(button) {
    if (!pcOnline) return;
    haptic.tap();
    try {
      await systemApi.mouseClick(button);
    } catch {
      // Silencioso
    }
  }

  function handleRightClick(e) {
    e.preventDefault();
    const now = Date.now();
    if (now - lastRightClickTimeRef.current < 250) return;
    lastRightClickTimeRef.current = now;
    handleMouseClick("right");
  }

  return (
    <div className="remote-page-container">
      <div className="remote-top-bar">
        <Segmented
          options={TABS}
          value={tab}
          onChange={setTab}
          label="Modo do Controle Remoto"
          className="segmented--wide"
        />
      </div>

      {!pcOnline && (
        <div className="offline-warning-card">
          <ShieldAlert size={20} />
          <div>
            <strong>Computador offline</strong>
            <p>Ligue o PC pelo botão de Wake-on-LAN para enviar comandos remotos.</p>
          </div>
        </div>
      )}

      {tab === "controls" ? (
        <RemoteControls
          audio={audio}
          remoteInfo={remoteInfo}
          onCloseGameSoft={onCloseGameSoft}
          onOpenPower={onOpenPower}
          pcOnline={pcOnline}
        />
      ) : (
        <div className="touchpad-page-view">
          <div className="touchpad-fullscreen-wrapper">
            <TouchpadCanvas sensitivity={sensitivity} />
          </div>

          <div className="real-mouse-deck" role="group" aria-label="Botões do Mouse">
            <button
              type="button"
              className="real-mouse-btn real-mouse-btn--left"
              onClick={() => handleMouseClick("left")}
              disabled={!pcOnline}
              title="Botão Esquerdo do Mouse"
              aria-label="Botão Esquerdo do Mouse"
            >
              <div className="real-mouse-btn-indicator" aria-hidden="true" />
              <div className="real-mouse-btn-content">
                <svg
                  className="real-mouse-icon"
                  width="22"
                  height="28"
                  viewBox="0 0 24 32"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="2" y="2" width="20" height="28" rx="8" />
                  <line x1="12" y1="2" x2="12" y2="13" />
                  <line x1="2" y1="13" x2="22" y2="13" />
                  <path
                    d="M 2 10 C 2 5.58 5.58 2 10 2 H 12 V 13 H 2 Z"
                    fill="currentColor"
                    className="real-mouse-icon-active"
                  />
                </svg>
                <div className="real-mouse-btn-info">
                  <span className="real-mouse-btn-title">Botão Esquerdo</span>
                  <span className="real-mouse-btn-subtitle">Clique Principal</span>
                </div>
              </div>
            </button>

            <button
              type="button"
              className="real-mouse-btn real-mouse-btn--right"
              onClick={handleRightClick}
              onContextMenu={handleRightClick}
              disabled={!pcOnline}
              title="Botão Direito do Mouse"
              aria-label="Botão Direito do Mouse"
            >
              <div className="real-mouse-btn-indicator" aria-hidden="true" />
              <div className="real-mouse-btn-content">
                <svg
                  className="real-mouse-icon"
                  width="22"
                  height="28"
                  viewBox="0 0 24 32"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="2" y="2" width="20" height="28" rx="8" />
                  <line x1="12" y1="2" x2="12" y2="13" />
                  <line x1="2" y1="13" x2="22" y2="13" />
                  <path
                    d="M 12 2 H 14 C 18.42 2 22 5.58 22 10 V 13 H 12 Z"
                    fill="currentColor"
                    className="real-mouse-icon-active"
                  />
                </svg>
                <div className="real-mouse-btn-info">
                  <span className="real-mouse-btn-title">Botão Direito</span>
                  <span className="real-mouse-btn-subtitle">Menu / Secundário</span>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
