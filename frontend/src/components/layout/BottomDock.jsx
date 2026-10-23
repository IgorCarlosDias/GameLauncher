import { BarChart3, Gamepad2, LayoutGrid, Settings } from "lucide-react";
import QuickBar from "./QuickBar";
import { haptic } from "../../lib/haptics";

const TABS = [
  { id: "library", label: "Biblioteca", Icon: LayoutGrid },
  { id: "remote", label: "Controle", Icon: Gamepad2 },
  { id: "stats", label: "Tempo", Icon: BarChart3 },
  { id: "settings", label: "Ajustes", Icon: Settings },
];

/** Dock flutuante inferior: ações rápidas (volume/energia) + navegação por abas. */
export default function BottomDock({ page, onNavigate, pc, audio, onOpenPower, hasRunningGame }) {
  return (
    <nav className="dock" aria-label="Navegação principal">
      <QuickBar pc={pc} audio={audio} onOpenPower={onOpenPower} />

      <div className="tabbar" role="tablist">
        {TABS.map(({ id, label, Icon }) => {
          const active = page === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`tabbar__item${active ? " is-active" : ""}`}
              onClick={() => {
                if (!active) {
                  haptic.tap();
                  onNavigate(id);
                }
              }}
            >
              <span className="tabbar__icon">
                <Icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
                {id === "library" && hasRunningGame && <span className="tabbar__live" aria-label="Jogo em execução" />}
              </span>
              <span className="tabbar__label">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
