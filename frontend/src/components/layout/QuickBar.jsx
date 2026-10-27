import { Loader2, Power, Volume1, Volume2, VolumeX } from "lucide-react";
import Slider from "../ui/Slider";
import { haptic, vibrate } from "../../lib/haptics";

function VolumeIcon({ muted, volume }) {
  if (muted || volume === 0) return <VolumeX size={21} />;
  return volume < 50 ? <Volume1 size={21} /> : <Volume2 size={21} />;
}

/**
 * Barra de ação rápida na zona do polegar: mudo + volume + energia.
 * Com o PC offline, o botão de energia vira atalho de Wake-on-LAN.
 */
export default function QuickBar({ pc, audio, onOpenPower }) {
  const disabled = !pc.online;
  const waking = pc.wakeState === "sending" || pc.wakeState === "waiting";

  const handleMute = () => {
    vibrate(15);
    audio.toggleMute();
  };

  const handlePower = () => {
    haptic.select();
    if (pc.online) onOpenPower();
    else pc.wake();
  };

  return (
    <div className={`quickbar${disabled ? " is-disabled" : ""}`}>
      <button
        type="button"
        className={`icon-btn quickbar__mute${audio.muted ? " is-active" : ""}`}
        onClick={handleMute}
        disabled={disabled}
        aria-label={audio.muted ? "Ativar som" : "Silenciar"}
        aria-pressed={audio.muted}
      >
        <VolumeIcon muted={audio.muted} volume={audio.volume} />
      </button>

      <Slider
        label="Volume do PC"
        value={audio.muted ? 0 : audio.volume}
        onDragStart={audio.startDrag}
        onChange={audio.setLevel}
        onCommit={audio.commitLevel}
        disabled={disabled}
        className={audio.muted ? "is-muted" : ""}
      />

      <output className="quickbar__value" aria-live="off">
        {audio.muted ? "Mudo" : `${audio.volume}%`}
      </output>

      <button
        type="button"
        className={`icon-btn quickbar__power${pc.offline ? " is-wake" : ""}`}
        onClick={handlePower}
        disabled={waking}
        aria-label={pc.online ? "Energia do PC" : "Ligar PC"}
      >
        {waking ? <Loader2 size={21} className="spin" /> : <Power size={21} />}
      </button>
    </div>
  );
}
