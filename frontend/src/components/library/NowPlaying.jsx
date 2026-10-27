import { EyeOff, Gamepad2, Square } from "lucide-react";
import LiveDuration from "../ui/LiveDuration";
import { useImageCache } from "../../hooks/useImageCache";
import { vibrate } from "../../lib/haptics";

function NowPlayingItem({ game, onForceClose, onDismiss }) {
  const { src: cover, onError: handleCoverError } = useImageCache(game.cover);

  return (
    <article className="now-playing__item">
      <div className="now-playing__thumb">
        {cover ? (
          <img
            src={cover}
            alt=""
            decoding="async"
            draggable={false}
            onError={handleCoverError}
          />
        ) : (
          <Gamepad2 size={20} aria-hidden="true" />
        )}
      </div>

      <div className="now-playing__info">
        <span className="now-playing__tag">
          <i aria-hidden="true" /> Jogando agora
        </span>
        <strong className="now-playing__name">{game.name}</strong>
        <span className="now-playing__timer">
          <LiveDuration startedAt={game.startedAt} />
        </span>
      </div>

      <div className="now-playing__actions">
        <button
          type="button"
          className="icon-btn icon-btn--ghost"
          onClick={() => {
            vibrate(15);
            onDismiss(game.id);
          }}
          aria-label={`Ocultar aviso de ${game.name}`}
        >
          <EyeOff size={18} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--danger"
          onClick={() => {
            vibrate([30, 40, 30]);
            onForceClose(game);
          }}
          aria-label={`Encerrar ${game.name}`}
        >
          <Square size={17} fill="currentColor" />
        </button>
      </div>
    </article>
  );
}

/** Banner “Jogando agora” com cronômetro ao vivo e encerramento rápido. */
export default function NowPlaying({ activeGames, onForceClose, onDismiss }) {
  if (!activeGames.length) return null;

  return (
    <section className="now-playing" aria-label="Jogando agora">
      {activeGames.map((game) => (
        <NowPlayingItem
          key={game.id}
          game={game}
          onForceClose={onForceClose}
          onDismiss={onDismiss}
        />
      ))}
    </section>
  );
}
