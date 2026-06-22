import type DatabaseT from "better-sqlite3";
import type { EntryFilters } from "../contracts/entries.js";
import { listEntries } from "./entry.js";
import { listClients, listProjects } from "./catalog.js";

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = [
  "id",
  "client",
  "project",
  "mode",
  "local_date",
  "started_at",
  "ended_at",
  "duration_seconds",
  "idle_seconds",
  "description",
  "tag",
  "billed",
];

interface ExportRow {
  id: number;
  client_name: string;
  project_name: string;
  mode: string;
  local_date: string;
  started_at: number;
  ended_at: number;
  duration_seconds: number;
  idle_seconds: number;
  description: string | null;
  tag: string | null;
  billed: number;
}

/** US-18: entries as CSV, honoring the same filters as the entries list. */
export function exportEntriesCsv(db: DatabaseT.Database, filters: EntryFilters): string {
  // Reuse listEntries to get the filtered id set in a consistent order.
  const entries = listEntries(db, { ...filters, limit: filters.limit ?? 100000 });
  if (entries.length === 0) return CSV_HEADER.join(",") + "\n";

  const ids = entries.map((e) => e.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare<unknown[], ExportRow>(
      `SELECT e.id, c.name AS client_name, p.name AS project_name, p.mode,
              e.local_date, e.started_at, e.ended_at, e.duration_seconds, e.idle_seconds,
              e.description, e.tag, e.billed
       FROM entries e JOIN projects p ON p.id = e.project_id JOIN clients c ON c.id = p.client_id
       WHERE e.id IN (${placeholders})
       ORDER BY e.started_at DESC, e.id DESC`,
    )
    .all(...ids);

  const lines = rows.map((r) =>
    [
      r.id,
      r.client_name,
      r.project_name,
      r.mode,
      r.local_date,
      new Date(r.started_at).toISOString(),
      new Date(r.ended_at).toISOString(),
      r.duration_seconds,
      r.idle_seconds,
      r.description,
      r.tag,
      r.billed ? 1 : 0,
    ]
      .map(csvField)
      .join(","),
  );
  return [CSV_HEADER.join(","), ...lines].join("\n") + "\n";
}

/** US-18: full local-first data dump (clients, projects, recharges, entries). */
export function exportJson(db: DatabaseT.Database): {
  exportedAt: string;
  clients: unknown[];
  projects: unknown[];
  recharges: unknown[];
  entries: unknown[];
} {
  return {
    exportedAt: new Date().toISOString(),
    clients: listClients(db, true),
    projects: listProjects(db, { includeArchived: true }),
    recharges: db.prepare("SELECT * FROM recharges ORDER BY id").all(),
    entries: db.prepare("SELECT * FROM entries ORDER BY id").all(),
  };
}
