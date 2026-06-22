import { Action, ActionPanel, Form, popToRoot, showToast, Toast } from "@raycast/api";
import { useState } from "react";
import { api, refreshMenuBar, type TimerState } from "./lib/api";

/** Add a precise number of minutes to the running timer (backdate the start). */
export default function AddTime() {
  const [error, setError] = useState<string | undefined>();

  async function submit(values: { minutes: string }) {
    const minutes = Number(values.minutes.replace(",", "."));
    if (!minutes || minutes <= 0) {
      setError("Entre un nombre de minutes > 0");
      return;
    }
    try {
      const st = await api<TimerState>("GET", "/timer");
      if (!st.running) {
        await showToast({ style: Toast.Style.Failure, title: "Aucun timer en cours" });
        return;
      }
      await api("POST", "/timer/add", { minutes });
      await refreshMenuBar();
      await showToast({ style: Toast.Style.Success, title: `+${minutes} min ajoutées` });
      await popToRoot();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Échec", message: String(e) });
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Ajouter au timer" onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="minutes"
        title="Minutes à ajouter"
        placeholder="20"
        error={error}
        onChange={() => error && setError(undefined)}
      />
    </Form>
  );
}
