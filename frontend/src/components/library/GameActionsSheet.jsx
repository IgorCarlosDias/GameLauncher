import { Pencil, Play, Power, Square, Star, Trophy, XSquare } from "lucide-react";
import Sheet from "../ui/Sheet";
import PlatformBadge from "../ui/PlatformBadge";
import { coverUrl } from "../../api";
import { getPlatform } from "../../lib/games";
import { formatPlayTime } from "../../lib/format";

function Action({ icon: Icon, label, hint, tone, onClick, disabled }) {
  return (
    <button type="button" className={`action-row${tone ? ` action-row--${tone}` : ""}`} onClick={onClick} disabled={disabled}>
      <span className="action-row__icon">
        <Icon size={20} />
      </span>
      <span className="action-row__text">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </button>
  );
}

/** Folha de ações de um jogo (aberta por toque longo ou pelo botão “⋯”). */
export default function GameActionsSheet({
  game,
  running,
  pcOnline,
  onClose,
  onLaunch,
  onFavorite,
  onEdit,
  onAchievements,
  onSoftClose,
  onForceClose,
}) {
  const open = Boolean(game);
  // Mantém os dados durante a animação de saída.
  const current = game || {};
  const cover = coverUrl(current.cover);

  const act = (fn) => () => {
    onClose();
    fn(current);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={current.name || ""}
      subtitle={current.name ? formatPlayTime(current.playTime) || "Nunca jogado" : ""}
    >
      {open && (
        <>
          <div className="actions-hero">
            <div className="actions-hero__cover">{cover && <img src={cover} alt="" decoding="async" />}</div>
            <PlatformBadge platform={getPlatform(current)} />
          </div>

          <div className="action-list">
            {!running && (
              <Action icon={Play} label="Jogar" hint="Abrir no PC" tone="primary" disabled={!pcOnline} onClick={act(onLaunch)} />
            )}
            <Action
              icon={Star}
              label={current.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
              onClick={act(onFavorite)}
            />
            <Action icon={Pencil} label="Editar jogo" hint="Nome, capa e Steam AppID" onClick={act(onEdit)} />
            {(current.steamId || current.achievementsTotal > 0) && (
              <Action
                icon={Trophy}
                label="Conquistas"
                hint={
                  current.achievementsTotal > 0
                    ? `${current.achievementsUnlocked || 0} de ${current.achievementsTotal} desbloqueadas`
                    : "Ver e sincronizar conquistas"
                }
                onClick={act(onAchievements)}
              />
            )}
            {running && (
              <>
                <Action icon={XSquare} label="Fechar janela" hint="Envia Alt+F4" onClick={act(onSoftClose)} />
                <Action icon={Square} label="Forçar encerramento" hint="taskkill — pode perder progresso" tone="danger" onClick={act(onForceClose)} />
              </>
            )}
            {!pcOnline && (
              <p className="action-note">
                <Power size={14} /> PC offline — ligue-o para controlar este jogo.
              </p>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
