import type DatabaseT from "better-sqlite3";
import { AppError } from "../contracts/common.js";
import type { InvoicePrepDTO, InvoicePrepQuery } from "../contracts/invoice.js";
import { roundSecondsUp, secondsToHours } from "../domain/rounding.js";
import { getClient } from "./catalog.js";

interface InvoiceEntryRow {
  id: number;
  project_id: number;
  tag: string | null;
  duration_seconds: number;
  proj_name: string;
  hourly_rate: number | null;
}

interface Line {
  projectId: number;
  projectName: string;
  tag: string | null;
  entries: number;
  rawSeconds: number;
  roundedSeconds: number;
  hourlyRate: number | null;
  entryIds: number[];
}

export function prepareInvoice(db: DatabaseT.Database, query: InvoicePrepQuery): InvoicePrepDTO {
  const client = getClient(db, query.clientId);
  if (!client) throw new AppError("NOT_FOUND", `Client ${query.clientId} not found`);

  const roundingMinutes = query.roundingMinutes ?? 0;
  // Only hourly-billed work belongs on an invoice: forfait is prepaid and
  // prix_fixe is billed as a lump sum, so both are excluded here.
  const where = ["p.client_id = ?", "p.mode = 'horaire'", "e.deleted_at IS NULL"];
  const params: unknown[] = [query.clientId];
  if (query.from) (where.push("e.local_date >= ?"), params.push(query.from));
  if (query.to) (where.push("e.local_date <= ?"), params.push(query.to));
  if (!query.includeBilled) where.push("e.billed = 0");

  const rows = db
    .prepare<unknown[], InvoiceEntryRow>(
      `SELECT e.id, e.project_id, e.tag, e.duration_seconds, p.name AS proj_name, p.hourly_rate
       FROM entries e JOIN projects p ON p.id = e.project_id
       WHERE ${where.join(" AND ")}
       ORDER BY p.name, e.tag`,
    )
    .all(...params);

  const groups = new Map<string, Line>();
  for (const r of rows) {
    const key = `${r.project_id}|${r.tag ?? ""}`;
    let line = groups.get(key);
    if (!line) {
      line = {
        projectId: r.project_id,
        projectName: r.proj_name,
        tag: r.tag,
        entries: 0,
        rawSeconds: 0,
        roundedSeconds: 0,
        hourlyRate: r.hourly_rate,
        entryIds: [],
      };
      groups.set(key, line);
    }
    line.entries += 1;
    line.rawSeconds += r.duration_seconds;
    line.roundedSeconds += roundSecondsUp(r.duration_seconds, roundingMinutes);
    line.entryIds.push(r.id);
  }

  const lines = [...groups.values()].map((l) => {
    const hours = secondsToHours(l.roundedSeconds);
    const amount = l.hourlyRate != null ? Math.round(hours * l.hourlyRate * 100) / 100 : null;
    return {
      projectId: l.projectId,
      projectName: l.projectName,
      tag: l.tag,
      entries: l.entries,
      rawSeconds: l.rawSeconds,
      roundedSeconds: l.roundedSeconds,
      hours,
      hourlyRate: l.hourlyRate,
      amount,
    };
  });

  const totalRoundedSeconds = lines.reduce((s, l) => s + l.roundedSeconds, 0);
  const totalHours = secondsToHours(totalRoundedSeconds);
  const withAmount = lines.filter((l) => l.amount != null);
  const totalAmount =
    withAmount.length > 0
      ? Math.round(withAmount.reduce((s, l) => s + (l.amount ?? 0), 0) * 100) / 100
      : null;
  const entryIds = [...groups.values()].flatMap((l) => l.entryIds);

  return {
    clientId: client.id,
    clientName: client.name,
    from: query.from ?? null,
    to: query.to ?? null,
    roundingMinutes,
    lines,
    totalRoundedSeconds,
    totalHours,
    totalAmount,
    entryIds,
    copyText: buildCopyText(client.name, query, lines, totalHours, totalAmount),
  };
}

function buildCopyText(
  clientName: string,
  query: InvoicePrepQuery,
  lines: InvoicePrepDTO["lines"],
  totalHours: number,
  totalAmount: number | null,
): string {
  const period = query.from || query.to ? ` (${query.from ?? "…"} → ${query.to ?? "…"})` : "";
  const head = `Facture — ${clientName}${period}`;
  const body = lines.map((l) => {
    const label = l.tag ? `${l.projectName} / ${l.tag}` : l.projectName;
    const money = l.amount != null ? ` × ${l.hourlyRate} €/h = ${l.amount} €` : "";
    return `- ${label} : ${l.hours} h${money} (${l.entries} entrée${l.entries > 1 ? "s" : ""})`;
  });
  const total = `Total : ${totalHours} h${totalAmount != null ? ` — ${totalAmount} €` : ""}`;
  return [head, "", ...body, "", total].join("\n");
}

export function markEntriesBilled(db: DatabaseT.Database, entryIds: number[]): number {
  const now = Date.now();
  const stmt = db.prepare("UPDATE entries SET billed = 1, billed_at = ? WHERE id = ?");
  const tx = db.transaction((ids: number[]) => {
    let changed = 0;
    for (const id of ids) changed += stmt.run(now, id).changes;
    return changed;
  });
  return tx(entryIds);
}
