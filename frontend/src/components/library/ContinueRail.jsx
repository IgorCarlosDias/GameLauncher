import GameCard from "./GameCard";

/** Carrossel horizontal com scroll-snap dos últimos jogos abertos. */
export default function ContinueRail({ games, runningIds, launchingId, onLaunch, onOpenActions }) {
  if (!games.length) return null;

  return (
    <section className="section" aria-label="Continuar jogando">
      <div className="section__head">
        <h2 className="section__title">Continuar jogando</h2>
      </div>
      <div className="rail">
        {games.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            variant="rail"
            running={runningIds.has(game.id)}
            launching={launchingId === game.id}
            onLaunch={onLaunch}
            onOpenActions={onOpenActions}
          />
        ))}
      </div>
    </section>
  );
}
