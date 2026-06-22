import { showHUD } from "@raycast/api";
import { api, fmtH, refreshMenuBar } from "./lib/api";

interface Entry {
  durationSeconds: number;
}
interface Discarded {
  discarded: true;
  durationSeconds: number;
}

export default async function StopTimer() {
  try {
    const res = await api<Entry | Discarded>("POST", "/timer/stop", {});
    await refreshMenuBar();
    if ("discarded" in res) await showHUD("⏱ Timer trop court (< 2 min) — annulé");
    else await showHUD(`⏹ Entrée enregistrée — ${fmtH(res.durationSeconds)}`);
  } catch (e) {
    await showHUD(`⚠️ ${String(e)}`);
  }
}
