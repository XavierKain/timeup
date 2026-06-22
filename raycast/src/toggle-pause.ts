import { showHUD } from "@raycast/api";
import { api, refreshMenuBar, type TimerState } from "./lib/api";

export default async function TogglePause() {
  try {
    const st = await api<TimerState>("GET", "/timer");
    if (!st.running) {
      await showHUD("Aucun timer en cours");
      return;
    }
    if (st.paused) {
      await api("POST", "/timer/resume");
      await refreshMenuBar();
      await showHUD("▶︎ Timer repris");
    } else {
      await api("POST", "/timer/pause");
      await refreshMenuBar();
      await showHUD("⏸ Timer en pause");
    }
  } catch (e) {
    await showHUD(`⚠️ ${String(e)}`);
  }
}
