import { Action, ActionPanel, List, popToRoot, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import { api, refreshMenuBar, type Client, type Project, type TimerState } from "./lib/api";

/** Reassign the running timer to a different project (fix a wrong start). */
export default function ReassignTimer() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Record<number, string>>({});
  const [currentProjectId, setCurrentProjectId] = useState<number | undefined>();
  const [running, setRunning] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const st = await api<TimerState>("GET", "/timer");
        setRunning(st.running);
        if (st.running) setCurrentProjectId(st.projectId);
        const [ps, cs] = await Promise.all([
          api<Project[]>("GET", "/projects"),
          api<Client[]>("GET", "/clients"),
        ]);
        setProjects(ps);
        setClients(Object.fromEntries(cs.map((c) => [c.id, c.name])));
      } catch (e) {
        await showToast({ style: Toast.Style.Failure, title: "Brain injoignable", message: String(e) });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function reassign(p: Project) {
    try {
      await api("POST", "/timer/reassign", { projectId: p.id });
      await refreshMenuBar();
      await showToast({ style: Toast.Style.Success, title: `Timer réassigné — ${p.name}` });
      await popToRoot();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Échec", message: String(e) });
    }
  }

  if (running === false) {
    return (
      <List isLoading={loading}>
        <List.EmptyView title="Aucun timer en cours" description="Lance un timer avant de le réassigner." />
      </List>
    );
  }

  return (
    <List isLoading={loading} searchBarPlaceholder="Réassigner le timer à…">
      {projects.map((p) => (
        <List.Item
          key={p.id}
          title={p.name}
          subtitle={clients[p.clientId] ?? ""}
          accessories={[p.id === currentProjectId ? { tag: "actuel" } : { tag: p.mode }]}
          actions={
            <ActionPanel>
              <Action title="Réassigner le timer" onAction={() => reassign(p)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
