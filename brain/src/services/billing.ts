import type DatabaseT from "better-sqlite3";
import { AppError } from "../contracts/common.js";
import type {
  CreateRechargeBody,
  ProjectStatsDTO,
  RechargeDTO,
  UpdateRechargeBody,
} from "../contracts/billing.js";
import { getProjectRow } from "./catalog.js";

interface RechargeRow {
  id: number;
  project_id: number;
  date: string;
  hours: number;
  price: number | null;
  note: string | null;
  created_at: number;
}

function rechargeRowToDto(row: RechargeRow): RechargeDTO {
  return {
    id: row.id,
    projectId: row.project_id,
    date: row.date,
    hours: row.hours,
    price: row.price,
    note: row.note,
    createdAt: row.created_at,
  };
}

export function createRecharge(db: DatabaseT.Database, body: CreateRechargeBody): RechargeDTO {
  const project = getProjectRow(db, body.projectId);
  if (!project) throw new AppError("NOT_FOUND", `Project ${body.projectId} not found`);
  if (project.mode !== "forfait") {
    throw new AppError("UNPROCESSABLE", `Project ${body.projectId} is not a forfait project`);
  }
  const info = db
    .prepare(
      "INSERT INTO recharges (project_id, date, hours, price, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(body.projectId, body.date, body.hours, body.price ?? null, body.note ?? null, Date.now());
  const row = db
    .prepare<[number], RechargeRow>("SELECT * FROM recharges WHERE id = ?")
    .get(Number(info.lastInsertRowid));
  if (!row) throw new Error("recharge vanished after insert");
  return rechargeRowToDto(row);
}

export function listRecharges(db: DatabaseT.Database, projectId: number): RechargeDTO[] {
  return db
    .prepare<[number], RechargeRow>(
      "SELECT * FROM recharges WHERE project_id = ? ORDER BY date, id",
    )
    .all(projectId)
    .map(rechargeRowToDto);
}

/** All recharges across every project, most recent first (forfait history view). */
export function listAllRecharges(db: DatabaseT.Database): RechargeDTO[] {
  return db
    .prepare<[], RechargeRow>("SELECT * FROM recharges ORDER BY date DESC, id DESC")
    .all()
    .map(rechargeRowToDto);
}

export function deleteRecharge(db: DatabaseT.Database, id: number): void {
  const info = db.prepare("DELETE FROM recharges WHERE id = ?").run(id);
  if (info.changes === 0) throw new AppError("NOT_FOUND", `Recharge ${id} not found`);
}

export function updateRecharge(
  db: DatabaseT.Database,
  id: number,
  body: UpdateRechargeBody,
): RechargeDTO {
  const existing = db.prepare<[number], RechargeRow>("SELECT * FROM recharges WHERE id = ?").get(id);
  if (!existing) throw new AppError("NOT_FOUND", `Recharge ${id} not found`);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.date !== undefined) (sets.push("date = ?"), params.push(body.date));
  if (body.hours !== undefined) (sets.push("hours = ?"), params.push(body.hours));
  if (body.price !== undefined) (sets.push("price = ?"), params.push(body.price));
  if (body.note !== undefined) (sets.push("note = ?"), params.push(body.note));
  params.push(id);
  db.prepare(`UPDATE recharges SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return rechargeRowToDto(
    db.prepare<[number], RechargeRow>("SELECT * FROM recharges WHERE id = ?").get(id)!,
  );
}

/** First/last local work date for a project (trashed entries excluded). */
function entryDateRange(
  db: DatabaseT.Database,
  projectId: number,
): { first: string | null; last: string | null } {
  const row = db
    .prepare<[number], { first: string | null; last: string | null }>(
      `SELECT MIN(local_date) AS first, MAX(local_date) AS last FROM entries
       WHERE project_id = ? AND deleted_at IS NULL`,
    )
    .get(projectId)!;
  return { first: row.first ?? null, last: row.last ?? null };
}

function sumDuration(db: DatabaseT.Database, projectId: number, onlyUnbilled = false): number {
  const row = db
    .prepare<[number], { total: number }>(
      `SELECT COALESCE(SUM(duration_seconds), 0) AS total FROM entries
       WHERE project_id = ? AND deleted_at IS NULL ${onlyUnbilled ? "AND billed = 0" : ""}`,
    )
    .get(projectId)!;
  return row.total;
}

function sumRechargeSeconds(db: DatabaseT.Database, projectId: number): number {
  const row = db
    .prepare<[number], { total: number }>(
      "SELECT COALESCE(SUM(hours), 0) AS total FROM recharges WHERE project_id = ?",
    )
    .get(projectId)!;
  return Math.round(row.total * 3600);
}

interface StatsJoinRow {
  id: number;
  client_id: number;
  client_name: string;
  name: string;
  mode: "forfait" | "horaire" | "prix_fixe";
  hourly_rate: number | null;
  fixed_price: number | null;
  estimated_hours: number | null;
  completed: number;
}

function buildStats(db: DatabaseT.Database, row: StatsJoinRow): ProjectStatsDTO {
  const totalSeconds = sumDuration(db, row.id);
  const unbilledSeconds = sumDuration(db, row.id, true);

  const stats: ProjectStatsDTO = {
    projectId: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    projectName: row.name,
    mode: row.mode,
    totalSeconds,
    unbilledSeconds,
    rechargedSeconds: null,
    remainingSeconds: null,
    hourlyRate: row.hourly_rate,
    billableAmount: null,
    fixedPrice: row.fixed_price,
    estimatedHours: row.estimated_hours,
    hoursSpent: null,
    effectiveHourlyRate: null,
    varianceHours: null,
    firstEntryDate: null,
    lastEntryDate: null,
    completed: row.completed !== 0,
  };

  if (row.mode === "forfait") {
    const recharged = sumRechargeSeconds(db, row.id);
    stats.rechargedSeconds = recharged;
    stats.remainingSeconds = recharged - totalSeconds;
  } else if (row.mode === "horaire") {
    stats.billableAmount =
      row.hourly_rate != null ? round2((unbilledSeconds / 3600) * row.hourly_rate) : null;
  } else {
    const hoursSpent = totalSeconds / 3600;
    stats.hoursSpent = round2(hoursSpent);
    stats.effectiveHourlyRate =
      row.fixed_price != null && hoursSpent > 0 ? round2(row.fixed_price / hoursSpent) : null;
    stats.varianceHours =
      row.estimated_hours != null ? round2(hoursSpent - row.estimated_hours) : null;
    const range = entryDateRange(db, row.id);
    stats.firstEntryDate = range.first;
    stats.lastEntryDate = range.last;
  }

  return stats;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const STATS_SELECT = `
  SELECT p.id, p.client_id, c.name AS client_name, p.name, p.mode,
         p.hourly_rate, p.fixed_price, p.estimated_hours, p.completed
  FROM projects p JOIN clients c ON c.id = p.client_id`;

export function projectStats(db: DatabaseT.Database, projectId: number): ProjectStatsDTO {
  const row = db
    .prepare<[number], StatsJoinRow>(`${STATS_SELECT} WHERE p.id = ?`)
    .get(projectId);
  if (!row) throw new AppError("NOT_FOUND", `Project ${projectId} not found`);
  return buildStats(db, row);
}

function statsByMode(db: DatabaseT.Database, mode: string): ProjectStatsDTO[] {
  const rows = db
    .prepare<[string], StatsJoinRow>(
      `${STATS_SELECT} WHERE p.mode = ? AND p.archived = 0 ORDER BY c.name, p.name`,
    )
    .all(mode);
  return rows.map((r) => buildStats(db, r));
}

/** US-11: remaining time per forfait project (replaces the Excel summary table). */
export function forfaitSummary(db: DatabaseT.Database): ProjectStatsDTO[] {
  return statsByMode(db, "forfait");
}

/** US-12: profitability of fixed-price projects. */
export function profitabilitySummary(db: DatabaseT.Database): ProjectStatsDTO[] {
  return statsByMode(db, "prix_fixe").sort(
    (a, b) =>
      // En-cours first, then completed; within each group, best effective rate first.
      Number(a.completed) - Number(b.completed) ||
      (b.effectiveHourlyRate ?? -1) - (a.effectiveHourlyRate ?? -1),
  );
}

/** Billable summary for hourly projects. */
export function hourlySummary(db: DatabaseT.Database): ProjectStatsDTO[] {
  return statsByMode(db, "horaire");
}
