import { showHUD } from "@raycast/api";
import { api, fmtH, refreshMenuBar, type TimerState } from "./lib/api";

interface Entry {
  durationSeconds: number;
}
interface Discarded {
  discarded: true;
  durationSeconds: number;
}
interface LastProject {
  projectId: number | null;
  projectName?: string;
}

/**
 * One hotkey to rule the timer: if one is running, stop it; otherwise restart
 * the most recently started project. Handy when you forgot to start tracking.
 */
export default async function ToggleLastTimer() {
  try {
    const st = await api<TimerState>("GET", "/timer");
    if (st.running) {
      const res = await api<Entry | Discarded>("POST", "/timer/stop", {});
      await refreshMenuBar();
      await showHUD("discarded" in res ? "⏱ Trop court (< 2 min) — annulé" : `⏹ Timer arrêté — ${fmtH(res.durationSeconds)}`);
      return;
    }
    const last = await api<LastProject>("GET", "/timer/last");
    if (!last.projectId) {
      await showHUD("Aucun timer récent à relancer");
      return;
    }
    await api("POST", "/timer/start", { projectId: last.projectId });
    await refreshMenuBar();
    await showHUD(`▶︎ Relancé — ${last.projectName ?? "dernier projet"}`);
  } catch (e) {
    await showHUD(`⚠️ ${String(e)}`);
  }
}
