import { useEffect, useState } from "react";
import { Loader2, Search, Trophy } from "lucide-react";
import Sheet from "../ui/Sheet";
import { useCoverSearch } from "../../hooks/useCoverSearch";
import { useToast } from "../../hooks/useToast";
import { formatPlayTime } from "../../lib/format";
import { GENRES, getGameGenre } from "../../lib/games";

/** Editor de jogo: nome, gênero, tempo jogado e galeria de capas do SteamGridDB. */
export default function EditGameSheet({ game, saving, onClose, onSave, onAchievements }) {
  const toast = useToast();
  const covers = useCoverSearch({ toast });

  const [name, setName] = useState("");
  const [genre, setGenre] = useState("auto");
  const [playTime, setPlayTime] = useState("");
  const [steamId, setSteamId] = useState("");
  const [query, setQuery] = useState("");
  const [customUrl, setCustomUrl] = useState("");

  const { search, reset } = covers;
  const gameId = game?.id;
  const gameName = game?.name;

  useEffect(() => {
    if (!gameId) return;
    setName(game.name);
    setGenre(getGameGenre(game) || "auto");
    setPlayTime(formatPlayTime(game.playTime) || (game.playTime ? `${game.playTime}s` : "0m"));
    setSteamId(game.steamId || "");
    setQuery(game.name);
    setCustomUrl("");
    reset();
    search(gameId, gameName);
    // Executa apenas ao abrir outro jogo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const submit = (coverUrl) =>
    onSave(game.id, {
      customName: name.trim(),
      genre,
      coverUrl: coverUrl || customUrl.trim() || undefined,
      playTime: playTime.trim(),
      steamId: steamId.trim(),
    });

  return (
    <Sheet
      open={Boolean(game)}
      onClose={onClose}
      title="Editar jogo"
      subtitle={game?.originalName}
      footer={
        <>
          {(steamId.trim() || game?.steamId) && (
            <button type="button" className="btn btn-secondary" onClick={() => onAchievements(game)}>
              <Trophy size={16} /> Conquistas
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => submit()} disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : null}
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </>
      }
    >
      {game && (
        <div className="form-stack">
          <label className="field">
            <span className="field__label">Nome de exibição</span>
            <input
              className="field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={game.originalName}
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span className="field__label">Gênero principal</span>
            <select
              className="field__input"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
            >
              <option value="auto">✨ Detectar automaticamente</option>
              {game.genre && !GENRES.includes(game.genre) && (
                <option value={game.genre}>{game.genre}</option>
              )}
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              <option value="">Sem gênero</option>
            </select>
          </label>

          <label className="field">
            <span className="field__label">Steam AppID (para conquistas e metadados)</span>
            <input
              className="field__input"
              value={steamId}
              onChange={(e) => setSteamId(e.target.value)}
              placeholder="Ex.: 731490 (vazio para desvincular)"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span className="field__label">Tempo jogado (ex.: 12h 30m)</span>
            <input
              className="field__input"
              value={playTime}
              onChange={(e) => setPlayTime(e.target.value)}
              placeholder="5h 30m ou 0m"
              autoComplete="off"
            />
          </label>

          <div className="field">
            <span className="field__label">Capa (SteamGridDB)</span>
            <form
              className="field__row"
              onSubmit={(e) => {
                e.preventDefault();
                search(game.id, query);
              }}
            >
              <input
                className="field__input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nome do jogo"
                enterKeyHint="search"
              />
              <button type="submit" className="btn btn-secondary btn-icon-only" disabled={covers.loading} aria-label="Buscar capas">
                {covers.loading ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
              </button>
            </form>
          </div>

          {covers.loading ? (
            <p className="muted-hint">Buscando capas…</p>
          ) : covers.results.length > 0 ? (
            <div className="cover-gallery">
              {covers.results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="cover-option"
                  onClick={() => submit(item.url)}
                  disabled={saving}
                  aria-label={`Usar capa de ${item.gameName}`}
                >
                  <img src={item.thumb} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          ) : (
            <p className="muted-hint">Nenhuma capa encontrada. Tente outro termo ou cole uma URL.</p>
          )}

          <label className="field">
            <span className="field__label">Ou URL direta da imagem</span>
            <input
              className="field__input"
              type="url"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://exemplo.com/capa.jpg"
              inputMode="url"
            />
          </label>
        </div>
      )}
    </Sheet>
  );
}
