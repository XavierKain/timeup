import { Icon, MenuBarExtra, open, launchCommand, LaunchType } from "@raycast/api";
import { useEffect, useState } from "react";
import { api, fmtH, type Client, type Project, type ProjectStats, type TimerState } from "./lib/api";

interface LastProject {
  projectId: number;
  projectName: string;
}

interface State {
  loading: boolean;
  timer?: TimerState;
  clientName?: string;
  projectName?: string;
  remainingSeconds?: number | null;
  projects: Project[];
  clientsById: Record<number, string>;
  lastProject: LastProject | null;
}

const EMPTY: State = { loading: true, projects: [], clientsById: {}, lastProject: null };

export default function TimerMenuBar() {
  const [s, setS] = useState<State>(EMPTY);

  // Re-fetch and re-render in place. Calling this after an in-menu action keeps
  // the menu-bar title in sync immediately (a launchCommand background refresh
  // does NOT update the command from within itself).
  async function load() {
    try {
      const timer = await api<TimerState>("GET", "/timer");
      const [projects, clients] = await Promise.all([
        api<Project[]>("GET", "/projects"),
        api<Client[]>("GET", "/clients"),
      ]);
      const clientsById = Object.fromEntries(clients.map((c) => [c.id, c.name]));

      if (!timer.running) {
        const last = await api<{ projectId: number | null; projectName?: string }>("GET", "/timer/last").catch(
          () => ({ projectId: null }),
        );
        setS({
          ...EMPTY,
          loading: false,
          timer,
          projects,
          clientsById,
          lastProject: last.projectId ? { projectId: last.projectId, projectName: last.projectName ?? "projet" } : null,
        });
        return;
      }

      const stats = await api<ProjectStats>("GET", `/projects/${timer.projectId}/stats`).catch(() => null);
      const project = projects.find((p) => p.id === timer.projectId);
      setS({
        ...EMPTY,
        loading: false,
        timer,
        projects,
        clientsById,
        clientName: project ? clientsById[project.clientId] : undefined,
        projectName: project?.name,
        remainingSeconds: stats?.remainingSeconds ?? null,
      });
    } catch {
      setS({ ...EMPTY, loading: false });
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reassign(projectId: number) {
    try {
      await api("POST", "/timer/reassign", { projectId });
      await load();
    } catch {
      /* ignore */
    }
  }
  async function startProject(projectId: number) {
    try {
      await api("POST", "/timer/start", { projectId });
      await load();
    } catch {
      /* ignore */
    }
  }
  async function discard() {
    try {
      await api("POST", "/timer/discard");
      await load();
    } catch {
      /* ignore */
    }
  }
  async function addTime(minutes: number) {
    try {
      await api("POST", "/timer/add", { minutes });
      await load();
    } catch {
      /* ignore */
    }
  }

  const running = s.timer?.running ? s.timer : null;
  const title = running
    ? `${s.clientName ?? "Timup"} · ${fmtH(running.elapsedActiveSeconds)}`
    : undefined; // no title when idle => compact icon only

  return (
    <MenuBarExtra icon={Icon.Clock} title={title} isLoading={s.loading}>
      {running ? (
        <>
          <MenuBarExtra.Item
            title={`${s.clientName ?? "?"} — ${s.projectName ?? "Projet"} · ${running.paused ? "en pause" : "en cours"}`}
            tooltip="Ajouter / modifier la description"
            onAction={() => launchCommand({ name: "set-description", type: LaunchType.UserInitiated })}
          />
          <MenuBarExtra.Item
            icon={Icon.Pencil}
            title={running.description ? `📝 ${running.description}` : "Ajouter une description…"}
            onAction={() => launchCommand({ name: "set-description", type: LaunchType.UserInitiated })}
          />
          {s.remainingSeconds != null && (
            <MenuBarExtra.Item title={`Restant forfait : ${fmtH(s.remainingSeconds)}`} />
          )}
          <MenuBarExtra.Separator />
          <MenuBarExtra.Item
            title={running.paused ? "Reprendre" : "Pause"}
            onAction={() => launchCommand({ name: "toggle-pause", type: LaunchType.UserInitiated })}
          />
          <MenuBarExtra.Item
            title="Arrêter"
            onAction={() => launchCommand({ name: "stop-timer", type: LaunchType.UserInitiated })}
          />
          <MenuBarExtra.Item title="Annuler (sans enregistrer)" onAction={discard} />
          <MenuBarExtra.Separator />
          <MenuBarExtra.Submenu title="Changer de projet" icon={Icon.Pencil}>
            {s.projects
              .filter((p) => !p.completed)
              .map((p) => (
                <MenuBarExtra.Item
                  key={p.id}
                  title={`${s.clientsById[p.clientId] ?? "?"} — ${p.name}`}
                  onAction={() => reassign(p.id)}
                />
              ))}
          </MenuBarExtra.Submenu>
          <MenuBarExtra.Submenu title="Ajouter du temps" icon={Icon.Clock}>
            {[5, 10, 15, 30].map((m) => (
              <MenuBarExtra.Item key={m} title={`+${m} min`} onAction={() => addTime(m)} />
            ))}
            <MenuBarExtra.Item
              title="Autre… (saisir)"
              icon={Icon.Pencil}
              onAction={() => launchCommand({ name: "add-time", type: LaunchType.UserInitiated })}
            />
          </MenuBarExtra.Submenu>
        </>
      ) : (
        <>
          <MenuBarExtra.Item title="Aucun timer en cours" />
          {s.lastProject && (
            <MenuBarExtra.Item
              icon={Icon.Play}
              title={`Démarrer le dernier : ${s.lastProject.projectName}`}
              onAction={() => startProject(s.lastProject!.projectId)}
            />
          )}
          <MenuBarExtra.Submenu title="Démarrer un projet" icon={Icon.Play}>
            {s.projects
              .filter((p) => !p.completed)
              .map((p) => (
                <MenuBarExtra.Item
                  key={p.id}
                  title={`${s.clientsById[p.clientId] ?? "?"} — ${p.name}`}
                  onAction={() => startProject(p.id)}
                />
              ))}
          </MenuBarExtra.Submenu>
        </>
      )}
      <MenuBarExtra.Separator />
      <MenuBarExtra.Item title="Ouvrir le dashboard" onAction={() => open("http://127.0.0.1:47823/")} />
    </MenuBarExtra>
  );
}
