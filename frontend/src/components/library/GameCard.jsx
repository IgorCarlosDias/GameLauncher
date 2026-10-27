import { memo } from "react";
import { Clock, Gamepad2, Loader2, MoreHorizontal, Star, Trophy } from "lucide-react";
import PlatformBadge from "../ui/PlatformBadge";
import { getGameGenre, getPlatform } from "../../lib/games";
import { formatPlayTime } from "../../lib/format";
import { useImageCache } from "../../hooks/useImageCache";
import { useLongPress } from "../../hooks/useLongPress";
import { vibrate } from "../../lib/haptics";

const markLoaded = (el) => {
  if (el && el.complete && el.naturalWidth > 0) el.classList.add("is-loaded");
};

/**
 * Card de capa (grade / carrossel). Toque = jogar; segurar ou “⋯” = ações.
 * O feedback de pressão (scale + anel) é puro CSS (`:active` / `.is-holding`).
 */
function GameCard({ game, running, launching, variant = "grid", onLaunch, onOpenActions }) {
  const { holding, handlers } = useLongPress({
    onPress: () => {
      vibrate(20);
      onLaunch(game);
    },
    onLongPress: () => onOpenActions(game),
  });

  const platform = getPlatform(game);
  const genre = getGameGenre(game);
  const playTime = formatPlayTime(game.playTime);
  const { src: cover, isCachedBlob, onError: handleCoverError } = useImageCache(game.cover);

  const classes = [
    "game-card",
    `game-card--${variant}`,
    running && "is-running",
    launching && "is-launching",
    holding && "is-holding",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <button
        type="button"
        className="game-card__main"
        disabled={launching}
        aria-label={`Jogar ${game.name}`}
        {...handlers}
      >
        <span className="game-card__art">
          {cover ? (
            <img
              ref={markLoaded}
              className={`game-card__img${isCachedBlob ? " is-loaded" : ""}`}
              src={cover}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={(e) => e.currentTarget.classList.add("is-loaded")}
              onError={handleCoverError}
            />
          ) : (
            <span className="game-card__placeholder" aria-hidden="true">
              <Gamepad2 size={34} />
              <span className="game-card__placeholder-initials">
                {(game.name || "GL").slice(0, 2).toUpperCase()}
              </span>
            </span>
          )}
        </span>
        <span className="game-card__shade" aria-hidden="true" />

        <span className="game-card__badges">
          <span className="game-card__badges-left">
            <PlatformBadge platform={platform} compact />
            {genre && <span className="genre-badge is-compact">{genre}</span>}
          </span>
          {game.favorite && (
            <span className="game-card__fav" aria-label="Favorito">
              <Star size={12} fill="currentColor" />
            </span>
          )}
        </span>

        {running && (
          <span className="game-card__live">
            <i aria-hidden="true" /> Em jogo
          </span>
        )}

        <span className="game-card__info">
          <strong className="game-card__title">{game.name}</strong>
          <span className="game-card__meta">
            <span>
              <Clock size={11} aria-hidden="true" />
              {playTime || "Nunca jogado"}
            </span>
            {game.achievementsTotal > 0 && (
              <span
                className={`game-card__trophy${game.achievementsUnlocked > 0 ? " is-active" : ""}`}
                title={`Conquistas: ${game.achievementsUnlocked || 0} de ${game.achievementsTotal}`}
              >
                <Trophy size={11} aria-hidden="true" />
                {game.achievementsUnlocked || 0}/{game.achievementsTotal}
              </span>
            )}
          </span>
        </span>

        {launching && (
          <span className="game-card__launching" role="status">
            <Loader2 size={26} className="spin" aria-hidden="true" />
            <span>Iniciando…</span>
          </span>
        )}
      </button>

      <button
        type="button"
        className="game-card__more"
        onClick={() => {
          vibrate(15);
          onOpenActions(game);
        }}
        aria-label={`Mais ações para ${game.name}`}
      >
        <MoreHorizontal size={18} />
      </button>
    </div>
  );
}

export default memo(GameCard);
