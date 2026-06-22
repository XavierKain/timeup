import type DatabaseT from "better-sqlite3";
import { DateTime } from "luxon";
import { parseDurationToSeconds } from "../domain/parseDuration.js";
import { createClient, createProject } from "./catalog.js";
import { createRecharge } from "./billing.js";
import { insertEntry } from "./entry.js";

/** Excel's day-zero epoch (1900 date system) in UTC ms. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30, 0, 0, 0, 0);

export interface ReconLine {
  client: string;
  expectedRemainingSeconds: number | null;
  computedRemainingSeconds: number;
  diffSeconds: number | null;
  match: boolean | null;
}

export interface ImportReport {
  dryRun: boolean;
  clients: number;
  forfaitProjects: number;
  recharges: number;
  entries: number;
  warnings: string[];
  reconciliation: ReconLine[];
}

/** Hours encoded in an Excel duration/forfait cell (Date or numeric serial). */
function excelHours(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) return (value.getTime() - EXCEL_EPOCH_MS) / 3_600_000;
  if (typeof value === "number") return value * 24; // serial days -> hours
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return parseDurationToSeconds(value) / 3600;
    } catch {
      return null;
    }
  }
  return null;
}

/** Calendar date (Y/M/D) of an Excel date cell, or null. */
function excelDateParts(value: unknown): { year: number; month: number; day: number } | null {
  if (value instanceof Date) {
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    };
  }
  return null;
}

interface ParsedClient {
  name: string;
  rechargeSeconds: number;
  entrySeconds: number;
  recharges: { hours: number; date: string | null }[];
  entries: { durationSeconds: number; startedAt: number; description: string | null }[];
}

function cellText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object" && value !== null && "richText" in value) {
    const rt = (value as { richText: { text: string }[] }).richText;
    return rt.map((r) => r.text).join("").trim() || null;
  }
  return String(value);
}

/**
 * Parse the user's "Forfait temps passé" workbook into per-client recharges and
 * entries, plus the cached summary ("Temps restant") for reconciliation.
 */
async function parseWorkbook(
  filePath: string,
  tz: string,
): Promise<{ clients: Map<string, ParsedClient>; summary: Map<string, number>; warnings: string[] }> {
  const { default: ExcelJS } = await import("exceljs");
  const { readFileSync, existsSync, readdirSync } = await import("node:fs");
  const { dirname, basename, join } = await import("node:path");

  // Resolve the real file even if the path's Unicode normalization differs from
  // disk (macOS stores filenames as NFD; a typed/copied path is often NFC).
  let realPath = filePath;
  if (!existsSync(realPath)) {
    const dir = dirname(filePath);
    const want = basename(filePath).normalize("NFC");
    const match = existsSync(dir)
      ? readdirSync(dir).find((e) => e.normalize("NFC") === want)
      : undefined;
    if (!match) throw new Error(`File not found: ${filePath}`);
    realPath = join(dir, match);
  }

  const wb = new ExcelJS.Workbook();
  // @types/node 22 vs exceljs Buffer-generic mismatch; cast to the method's own param type.
  const buf = readFileSync(realPath) as unknown as Parameters<typeof wb.xlsx.load>[0];
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("workbook has no worksheet");

  const clients = new Map<string, ParsedClient>();
  const warnings: string[] = [];
  const get = (name: string): ParsedClient => {
    let c = clients.get(name);
    if (!c) {
      c = { name, rechargeSeconds: 0, entrySeconds: 0, recharges: [], entries: [] };
      clients.set(name, c);
    }
    return c;
  };

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = cellText(row.getCell("A").value);
    if (!name) continue;
    const client = get(name);

    const dateParts = excelDateParts(row.getCell("C").value);
    const dateStr = dateParts
      ? `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}`
      : null;
    const startedAt = dateParts
      ? DateTime.fromObject(
          { year: dateParts.year, month: dateParts.month, day: dateParts.day, hour: 12 },
          { zone: tz },
        ).toMillis()
      : Date.now();

    // Forfait souscrit (col E) -> recharge
    const forfaitHours = excelHours(row.getCell("E").value);
    if (forfaitHours != null && forfaitHours > 0) {
      client.rechargeSeconds += Math.round(forfaitHours * 3600);
      client.recharges.push({ hours: forfaitHours, date: dateStr });
    }

    // Temps passé (col B) -> entry
    const bRaw = row.getCell("B").value;
    const bWasText = typeof bRaw === "string";
    const spentHours = excelHours(bRaw);
    if (spentHours != null && spentHours > 0) {
      const durationSeconds = Math.round(spentHours * 3600);
      client.entrySeconds += durationSeconds;
      client.entries.push({
        durationSeconds,
        startedAt,
        description: cellText(row.getCell("D").value),
      });
      if (bWasText) {
        // Excel's SUM/SUMIF ignores text cells, so the original sheet under-counted
        // this time. Timup imports it (it's real work) — this explains reconciliation gaps.
        warnings.push(
          `Row ${r} (${name}): "Temps passé" was text "${String(bRaw)}" — Excel didn't sum it; Timup counts it as ${Math.round(durationSeconds / 60)} min`,
        );
      }
    } else if (bRaw != null && spentHours == null) {
      warnings.push(`Row ${r} (${name}): unparseable "Temps passé" value, skipped`);
    }
  }

  // Summary "Temps restant" (cols I/J, cached formula results).
  const summary = new Map<string, number>();
  for (let r = 2; r <= ws.rowCount; r++) {
    const name = cellText(ws.getRow(r).getCell("I").value);
    if (!name) continue;
    const jv = ws.getRow(r).getCell("J").value;
    let resultDate: Date | null = null;
    if (jv instanceof Date) resultDate = jv;
    else if (jv && typeof jv === "object" && "result" in jv) {
      const res = (jv as { result: unknown }).result;
      if (res instanceof Date) resultDate = res;
    }
    if (resultDate) {
      summary.set(name.toLowerCase(), Math.round((resultDate.getTime() - EXCEL_EPOCH_MS) / 1000));
    }
    if (summary.size >= 200) break; // summary block is small; avoid scanning notes
  }

  return { clients, summary, warnings };
}

export async function importWorkbook(
  db: DatabaseT.Database,
  filePath: string,
  opts: { tz: string; dryRun?: boolean },
): Promise<ImportReport> {
  const { clients, summary, warnings } = await parseWorkbook(filePath, opts.tz);

  const reconciliation: ReconLine[] = [...clients.values()].map((c) => {
    const computed = c.rechargeSeconds - c.entrySeconds;
    const expected = summary.get(c.name.toLowerCase()) ?? null;
    const diff = expected == null ? null : computed - expected;
    return {
      client: c.name,
      expectedRemainingSeconds: expected,
      computedRemainingSeconds: computed,
      diffSeconds: diff,
      match: diff == null ? null : Math.abs(diff) <= 60,
    };
  });

  let recharges = 0;
  let entries = 0;
  let forfaitProjects = 0;

  if (!opts.dryRun) {
    db.transaction(() => {
      for (const c of clients.values()) {
        const client = createClient(db, { name: c.name });
        const isForfait = c.recharges.length > 0;
        const project = createProject(db, {
          clientId: client.id,
          name: c.name,
          mode: isForfait ? "forfait" : "horaire",
        });
        if (isForfait) forfaitProjects += 1;

        for (const rch of c.recharges) {
          createRecharge(db, {
            projectId: project.id,
            date: rch.date ?? "1970-01-01",
            hours: rch.hours,
          });
          recharges += 1;
        }
        for (const e of c.entries) {
          insertEntry(db, {
            projectId: project.id,
            startedAt: e.startedAt,
            endedAt: e.startedAt + e.durationSeconds * 1000,
            segments: [{ start: e.startedAt, end: e.startedAt + e.durationSeconds * 1000 }],
            tz: opts.tz,
            description: e.description,
            source: "manual",
          });
          entries += 1;
        }
      }
    })();
  } else {
    for (const c of clients.values()) {
      if (c.recharges.length > 0) forfaitProjects += 1;
      recharges += c.recharges.length;
      entries += c.entries.length;
    }
  }

  return {
    dryRun: !!opts.dryRun,
    clients: clients.size,
    forfaitProjects,
    recharges,
    entries,
    warnings,
    reconciliation,
  };
}
