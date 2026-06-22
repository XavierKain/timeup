import { Action, ActionPanel, List, showToast, Toast, popToRoot } from "@raycast/api";
import { useEffect, useState } from "react";
import { api, refreshMenuBar, type Client, type Project } from "./lib/api";

export default function StartTimer() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [ps, cs] = await Promise.all([
          api<Project[]>("GET", "/projects?excludeCompleted=true"),
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

  async function start(p: Project) {
    try {
      await api("POST", "/timer/start", { projectId: p.id });
      await refreshMenuBar();
      await showToast({ style: Toast.Style.Success, title: `Timer lancé — ${p.name}` });
      await popToRoot();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Échec", message: String(e) });
    }
  }

  return (
    <List isLoading={loading} searchBarPlaceholder="Filtrer un projet…">
      {projects.map((p) => (
        <List.Item
          key={p.id}
          title={p.name}
          subtitle={clients[p.clientId] ?? ""}
          accessories={[{ tag: p.mode }]}
          actions={
            <ActionPanel>
              <Action title="Démarrer le timer" onAction={() => start(p)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
