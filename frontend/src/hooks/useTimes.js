import { useCallback, useState } from "react";
import { errorMessage, timesApi } from "../api";
import { haptic } from "../lib/haptics";

/** Resumo de tempos, backup JSON (exportar/importar) e sincronização em nuvem. */
export function useTimes({ toast, onGamesChanged }) {
  const [summary, setSummary] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [busy, setBusy] = useState(null); // "export" | "import" | "reload" | "cloud" | null

  const load = useCallback(async () => {
    try {
      const res = await timesApi.summary();
      if (res?.summary) setSummary(res.summary);
      if (Array.isArray(res?.recentSessions)) setSessions(res.recentSessions);
    } catch {
      // Silencioso: a tela exibe o que já tem.
    }
  }, []);

  const applyResult = useCallback(
    async (res) => {
      if (res?.summary) setSummary(res.summary);
      if (Array.isArray(res?.recentSessions)) setSessions(res.recentSessions);
      await onGamesChanged?.();
    },
    [onGamesChanged]
  );

  const exportJson = useCallback(async () => {
    haptic.confirm();
    setBusy("export");
    try {
      const data = await timesApi.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `gamelauncher-tempos-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      if (data?.summary) setSummary(data.summary);
      toast.show("JSON de tempos exportado", "success");
    } catch (err) {
      toast.show(errorMessage(err, "Falha ao exportar JSON de tempos"), "error");
    } finally {
      setBusy(null);
    }
  }, [toast]);

  const importFile = useCallback(
    async (file, mode) => {
      if (!file) return;
      haptic.confirm();
      setBusy("import");
      try {
        const parsed = JSON.parse(await file.text());
        const res = await timesApi.importData(parsed, mode);
        if (res?.success) {
          await applyResult(res);
          const st = res.stats || {};
          toast.show(`Importado: ${st.updatedGames || 0} jogos e ${st.importedSessions || 0} sessões`, "success");
        }
      } catch (err) {
        const fallback = err instanceof SyntaxError ? "Arquivo JSON malformado" : "Falha ao importar JSON";
        toast.show(errorMessage(err, fallback), "error");
      } finally {
        setBusy(null);
      }
    },
    [applyResult, toast]
  );

  const reloadLocal = useCallback(
    async (mode) => {
      haptic.confirm();
      setBusy("reload");
      try {
        const res = await timesApi.reloadLocal(mode);
        if (res?.success) {
          await applyResult(res);
          toast.show("Tempos recarregados do arquivo do servidor", "success");
        }
      } catch (err) {
        toast.show(errorMessage(err, "Falha ao ler playtime.json"), "error");
      } finally {
        setBusy(null);
      }
    },
    [applyResult, toast]
  );

  const cloudPush = useCallback(async () => {
    haptic.confirm();
    setBusy("cloud");
    try {
      const res = await timesApi.cloudPush();
      if (res?.success) {
        toast.show("Tempos enviados para a nuvem", "success");
        load();
      } else {
        toast.show(res?.message || "Falha ao enviar para a nuvem", "error");
      }
    } catch (err) {
      toast.show(errorMessage(err, "Erro ao conectar com o Supabase"), "error");
    } finally {
      setBusy(null);
    }
  }, [load, toast]);

  return { summary, sessions, busy, load, exportJson, importFile, reloadLocal, cloudPush };
}
