import React, { useState, useCallback, useRef, useEffect } from "react";
import { ToastProvider } from "./context/ToastProvider";
import { useToast } from "./hooks/useToast";
import { useRoute } from "./hooks/useRoute";
import { usePcStatus } from "./hooks/usePcStatus";
import { useGameLibrary } from "./hooks/useGameLibrary";
import { useActiveGames } from "./hooks/useActiveGames";
import { useSystemAudio } from "./hooks/useSystemAudio";
import { useRemoteInfo } from "./hooks/useRemoteInfo";
import { usePower } from "./hooks/usePower";
import { useTimes } from "./hooks/useTimes";
import { useAutomationSettings } from "./hooks/useAutomationSettings";

import AppHeader from "./components/layout/AppHeader";
import BottomDock from "./components/layout/BottomDock";
import PowerSheet from "./components/layout/PowerSheet";
import ShutdownBanner from "./components/layout/ShutdownBanner";
import SphericalNotification from "./components/notifications/SphericalNotification";

import LibraryPage from "./pages/LibraryPage";
import RemotePage from "./pages/RemotePage";
import StatsPage from "./pages/StatsPage";
import SettingsPage from "./pages/SettingsPage";
import AchievementsModal from "./components/AchievementsModal";

import { API_BASE } from "./api";
import { formatPlayTimeDetailed } from "./lib/format";
import { haptic } from "./lib/haptics";

function GameLauncherApp() {
  const toast = useToast();
  const { page, settingsTab, navigate } = useRoute();

  // 1. Notificação Rica Esférica (v1.2.0)
  const [notification, setNotification] = useState(null);
  const [notificationLeaving, setNotificationLeaving] = useState(false);
  const notifLeaveTimerRef = useRef(null);

  const showNotification = useCallback((data) => {
    if (notifLeaveTimerRef.current) clearTimeout(notifLeaveTimerRef.current);
    setNotificationLeaving(false);
    setNotification({ ...data, key: Date.now() });
  }, []);

  const dismissNotification = useCallback(() => {
    if (notifLeaveTimerRef.current) clearTimeout(notifLeaveTimerRef.current);
    setNotificationLeaving(true);
    notifLeaveTimerRef.current = setTimeout(() => {
      setNotification(null);
      setNotificationLeaving(false);
    }, 450);
  }, []);

  useEffect(() => {
    if (!notification) return undefined;
    const timer = setTimeout(() => {
      dismissNotification();
    }, 5400);
    return () => clearTimeout(timer);
  }, [notification, dismissNotification]);

  // 2. Gerenciador de Biblioteca de Jogos
  const library = useGameLibrary({ toast });

  // 3. Status do PC & Wake-on-LAN
  const pcStatus = usePcStatus({
    toast,
    onOnline: ({ recovered }) => {
      if (recovered) {
        library.load();
        toast.show("Conexão com o PC restabelecida", "success");
      }
    },
  });

  // 4. Configurações de automação
  const autoSettings = useAutomationSettings({ enabled: pcStatus.online });

  // 5. Jogos em Execução
  const activeGamesManager = useActiveGames({
    enabled: pcStatus.online,
    toast,
    onStarted: (game) => {
      showNotification({
        kind: "started",
        name: game.name,
        cover: game.cover,
        detail: formatPlayTimeDetailed(game.playTime) || "Primeira vez",
      });
      library.load();
    },
    onEnded: (game, sessionSec) => {
      showNotification({
        kind: "ended",
        name: game.name,
        cover: game.cover,
        detail: formatPlayTimeDetailed(sessionSec),
      });
      library.load();
    },
    onChanged: () => {
      library.load();
    },
  });

  // 6. Áudio & Volume
  const audio = useSystemAudio({
    enabled: pcStatus.online,
    toast,
  });

  // 7. Informações remotas (CPU, RAM, Display)
  const remoteInfo = useRemoteInfo({
    enabled: pcStatus.online && page === "remote",
    toast,
  });

  // 8. Energia do Computador
  const power = usePower({ toast });
  const [powerSheetOpen, setPowerSheetOpen] = useState(false);

  // 9. Tempos & Sincronização
  const times = useTimes({
    toast,
    onGamesChanged: library.load,
  });

  // 10. Modal de Conquistas Steam
  const [achievementsGame, setAchievementsGame] = useState(null);

  // Fechamento suave de jogo em foco via Alt+F4
  const handleSoftCloseGame = useCallback(
    (game) => {
      activeGamesManager.close({
        force: false,
        target: game ? { id: game.id, exeName: game.resolvedExe } : {},
      });
    },
    [activeGamesManager]
  );

  // Carrega a biblioteca na montagem
  useEffect(() => {
    library.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app-layout">
      {/* Notificação esférica de início/término de jogo */}
      <SphericalNotification
        notification={notification}
        isLeaving={notificationLeaving}
        onDismiss={dismissNotification}
      />

      {/* Alerta flutuante se houver desligamento agendado */}
      {power.shutdownScheduled && (
        <ShutdownBanner
          onCancel={() => power.run("cancel")}
          busy={power.busy}
        />
      )}

      {/* Header Fixo com Status do PC e Botão WoL */}
      <AppHeader
        pc={pcStatus}
        onRefresh={library.rescan}
        refreshing={library.refreshing}
      />

      {/* Conteúdo da Página Ativa */}
      <main className="app-main">
        {page === "library" && (
          <LibraryPage
            library={library}
            activeGamesManager={activeGamesManager}
            pcStatus={pcStatus}
            onOpenAchievements={(game) => {
              haptic.tap();
              setAchievementsGame(game);
            }}
            onOpenStats={() => navigate("stats")}
            onSoftClose={handleSoftCloseGame}
          />
        )}

        {page === "remote" && (
          <RemotePage
            audio={audio}
            remoteInfo={remoteInfo}
            onCloseGameSoft={() => handleSoftCloseGame(activeGamesManager.activeGames[0])}
            onOpenPower={() => setPowerSheetOpen(true)}
            pcOnline={pcStatus.online}
            sensitivity={autoSettings.touchpadSensitivity}
          />
        )}

        {page === "stats" && (
          <StatsPage
            times={times}
            games={library.games}
            activeSession={activeGamesManager.activeGames[0]}
            onOpenGame={(_game) => {
              navigate("library");
            }}
          />
        )}

        {page === "settings" && (
          <SettingsPage
            api={API_BASE}
            onBack={() => navigate("library")}
            showToast={toast.show}
            triggerHaptic={haptic}
            initialTab={settingsTab}
            onReloadGames={() => library.load()}
          />
        )}
      </main>

      {/* Dock Inferior com Quick Actions e Barra de Abas */}
      <BottomDock
        page={page}
        onNavigate={navigate}
        pc={pcStatus}
        audio={audio}
        onOpenPower={() => setPowerSheetOpen(true)}
        hasRunningGame={activeGamesManager.activeGames.length > 0}
      />

      {/* Folha de Energia (Suspender / Desligar) */}
      <PowerSheet
        open={powerSheetOpen}
        onClose={() => setPowerSheetOpen(false)}
        shutdownScheduled={power.shutdownScheduled}
        timerSec={autoSettings.shutdownTimerSec}
        busy={power.busy}
        onRun={power.run}
      />

      {/* Modal de Conquistas da Steam */}
      {achievementsGame && (
        <AchievementsModal
          game={achievementsGame}
          api={API_BASE}
          onClose={() => setAchievementsGame(null)}
          onOpenSettings={(tab) => {
            setAchievementsGame(null);
            navigate("settings", { tab });
          }}
          onAchievementsUpdated={library.load}
          showToast={toast.show}
          triggerHaptic={haptic}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <GameLauncherApp />
    </ToastProvider>
  );
}
