import { memo } from "react";
import { Clock, Gamepad2, Loader2, MoreHorizontal, Play, Star } from "lucide-react";
import PlatformBadge from "../ui/PlatformBadge";
import { coverUrl } from "../../api";
import { getPlatform } from "../../lib/games";
import { formatPlayTime } from "../../lib/format";
import { useLongPress } from "../../hooks/useLongPress";

/** Variante em lista compacta (mesma interação do card: toque joga, segurar abre ações). */
function GameRow({ game, running, launching, onLaunch, onOpenActions }) {
  const { holding, handlers } = useLongPress({
    onPress: () => onLaunch(game),
    onLongPress: () => onOpenActions(game),
  });
  const cover = coverUrl(game.cover);
  const playTime = formatPlayTime(game.playTime);

  return (
    <div className={`game-row${running ? " is-running" : ""}${holding ? " is-holding" : ""}`}>
      <button type="button" className="game-row__main" disabled={launching} {...handlers}>
        <span className="game-row__thumb">
          {cover ? (
            <img src={cover} alt="" loading="lazy" decoding="async" draggable={false} />
          ) : (
            <Gamepad2 size={20} aria-hidden="true" />
          )}
        </span>

        <span className="game-row__body">
          <strong className="game-row__title">
            {game.favorite && <Star size={12} fill="currentColor" className="game-row__star" aria-label="Favorito" />}
            {game.name}
          </strong>
          <span className="game-row__meta">
            <PlatformBadge platform={getPlatform(game)} compact />
            <span>
              <Clock size={11} aria-hidden="true" /> {playTime || "Nunca jogado"}
            </span>
            {running && <span className="game-row__live">Em jogo</span>}
          </span>
        </span>

        <span className="game-row__play" aria-hidden="true">
          {launching ? <Loader2 size={18} className="spin" /> : <Play size={18} fill="currentColor" />}
        </span>
      </button>

      <button
        type="button"
        className="icon-btn icon-btn--ghost"
        onClick={() => onOpenActions(game)}
        aria-label={`Mais ações para ${game.name}`}
      >
        <MoreHorizontal size={19} />
      </button>
    </div>
  );
}

export default memo(GameRow);
