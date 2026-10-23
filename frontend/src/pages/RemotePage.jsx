import React, { useState } from "react";
import { Sliders, MousePointer, ShieldAlert } from "lucide-react";
import Segmented from "../components/ui/Segmented";
import TouchpadCanvas from "../components/remote/TouchpadCanvas";
import RemoteControls from "../components/remote/RemoteControls";

export default function RemotePage({
  audio,
  remoteInfo,
  onCloseGameSoft,
  onOpenPower,
  pcOnline,
  sensitivity = 2.1,
}) {
  const [tab, setTab] = useState("controls"); // 'controls' | 'touchpad'

  const TABS = [
    { id: "controls", label: "Sistema & Teclas", icon: Sliders },
    { id: "touchpad", label: "Touchpad Virtual", icon: MousePointer },
  ];

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
        <div className="touchpad-fullscreen-wrapper">
          <TouchpadCanvas sensitivity={sensitivity} />
        </div>
      )}
    </div>
  );
}
