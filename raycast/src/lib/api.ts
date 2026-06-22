import { getPreferenceValues, launchCommand, LaunchType } from "@raycast/api";

interface Prefs {
  port?: string;
  token: string;
}

function base(): { url: string; token: string } {
  const prefs = getPreferenceValues<Prefs>();
  const port = prefs.port?.trim() || "47823";
  return { url: `http://127.0.0.1:${port}`, token: prefs.token };
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { url, token } = base();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = json?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json as T;
}

/**
 * Force the menu-bar command to re-render now instead of waiting for its 30s
 * interval — called right after start/stop/pause so the bar reflects the change
 * instantly. No-op if the menu-bar command is disabled.
 */
export async function refreshMenuBar(): Promise<void> {
  try {
    await launchCommand({ name: "timer-menu-bar", type: LaunchType.Background });
  } catch {
    /* menu-bar command not enabled — ignore */
  }
}

export interface Project {
  id: number;
  clientId: number;
  name: string;
  mode: "forfait" | "horaire" | "prix_fixe";
  completed?: boolean; // finished projects are hidden from the start pickers
}
export interface Client {
  id: number;
  name: string;
}
export type TimerState =
  | { running: false }
  | {
      running: true;
      projectId: number;
      paused: boolean;
      elapsedActiveSeconds: number;
      elapsedRawSeconds: number;
      description?: string | null;
    };
export interface ProjectStats {
  projectId: number;
  mode: string;
  remainingSeconds: number | null;
}

export function fmtH(sec: number): string {
  const s = Math.abs(sec);
  return `${sec < 0 ? "-" : ""}${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}
