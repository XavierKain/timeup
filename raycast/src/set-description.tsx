import { Action, ActionPanel, Form, popToRoot, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import { api, refreshMenuBar, type TimerState } from "./lib/api";

/** Set/edit the running timer's description (typed or dictated). Applied to the entry on stop. */
export default function SetDescription() {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const st = await api<TimerState>("GET", "/timer");
        if (st.running) setDescription(st.description ?? "");
      } catch {
        /* brain unreachable — leave empty */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function submit(values: { description: string }) {
    try {
      const st = await api<TimerState>("GET", "/timer");
      if (!st.running) {
        await showToast({ style: Toast.Style.Failure, title: "Aucun timer en cours" });
        return;
      }
      await api("POST", "/timer/description", { description: values.description });
      await refreshMenuBar();
      await showToast({
        style: Toast.Style.Success,
        title: values.description.trim() ? "Description enregistrée" : "Description effacée",
      });
      await popToRoot();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Échec", message: String(e) });
    }
  }

  return (
    <Form
      isLoading={loading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Enregistrer" onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="description"
        title="Description"
        value={description}
        onChange={setDescription}
        placeholder="Ce sur quoi tu travailles (saisie ou dictée)…"
      />
    </Form>
  );
}
