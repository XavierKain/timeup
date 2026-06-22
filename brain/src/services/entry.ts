import type DatabaseT from "better-sqlite3";
import { DateTime } from "luxon";
import { AppError } from "../contracts/common.js";
import type {
  CreateManualEntryBody,
  EntryFilters,
  UpdateEntryBody,
} from "../contracts/entries.js";
import type { EntryDTO } from "../contracts/timer.js";
import { localDateOf } from "../domain/localdate.js";
import { resolveDurationSeconds } from "../domain/parseDuration.js";
import { computeDuration, type Segment } from "../domain/time.js";
import { getProjectRow } from "./catalog.js";

export interface InsertEntryInput {
  projectId: number;
  /** ms UTC */
  startedAt: number;
  /** ms UTC (clamped internally on clock skew) */
  endedAt: number;
  /** active segments (open segment must already be closed at endedAt) */
  segments: Segment[];
  tz: string;
  description?: string | null;
  tag?: string | null;
  source: "timer" | "manual";
  stopRequestId?: string | null;
}

interface EntryRow {
  id: number;
  project_id: number;
  started_at: number;
  ended_at: number;
  raw_seconds: number;
  idle_seconds: number;
  duration_seconds: number;
  tz: string;
  local_date: string;
  description: string | null;
  tag: string | null;
  billed: number;
  source: "timer" | "manual";
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function rowToDto(db: DatabaseT.Database, row: EntryRow): EntryDTO {
  const segments = db
    .prepare<[number], { start_at: number; end_at: number }>(
      "SELECT start_at, end_at FROM entry_segments WHERE entry_id = ? ORDER BY start_at",
    )
    .all(row.id)
    .map((s) => ({ startAt: s.start_at, endAt: s.end_at }));

  return {
    id: row.id,
    projectId: row.project_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    rawSeconds: row.raw_seconds,
    idleSeconds: row.idle_seconds,
    durationSeconds: row.duration_seconds,
    tz: row.tz,
    localDate: row.local_date,
    description: row.description,
    tag: row.tag,
    billed: row.billed !== 0,
    source: row.source,
    segments,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function getEntryById(db: DatabaseT.Database, id: number): EntryDTO | undefined {
  const row = db.prepare<[number], EntryRow>("SELECT * FROM entries WHERE id = ?").get(id);
  return row ? rowToDto(db, row) : undefined;
}

export function getEntryByStopRequestId(
  db: DatabaseT.Database,
  requestId: string,
): EntryDTO | undefined {
  const row = db
    .prepare<[string], EntryRow>("SELECT * FROM entries WHERE stop_request_id = ?")
    .get(requestId);
  return row ? rowToDto(db, row) : undefined;
}

/**
 * The single write-path for time entries. Used by timer stop, test seeding, and
 * (later) Excel import (US-17). Computes duration/idle/local_date from the raw
 * span + active segments, then persists the entry and its finalized segments.
 *
 * Must be called inside a transaction when atomicity with other writes matters
 * (e.g. clearing the running timer).
 */
export function insertEntry(db: DatabaseT.Database, input: InsertEntryInput): EntryDTO {
  const result = computeDuration(input.startedAt, input.endedAt, input.segments);
  const localDate = localDateOf(input.startedAt, input.tz);
  const now = Date.now();

  const info = db
    .prepare(
      `INSERT INTO entries (
         project_id, started_at, ended_at, raw_seconds, idle_seconds, duration_seconds,
         tz, local_date, description, tag, billed, billed_at, source, stop_request_id,
         created_at, updated_at
       ) VALUES (
         @project_id, @started_at, @ended_at, @raw_seconds, @idle_seconds, @duration_seconds,
         @tz, @local_date, @description, @tag, 0, NULL, @source, @stop_request_id,
         @created_at, @updated_at
       )`,
    )
    .run({
      project_id: input.projectId,
      started_at: input.startedAt,
      ended_at: result.endedAt,
      raw_seconds: result.rawSeconds,
      idle_seconds: result.idleSeconds,
      duration_seconds: result.durationSeconds,
      tz: input.tz,
      local_date: localDate,
      description: input.description ?? null,
      tag: input.tag ?? null,
      source: input.source,
      stop_request_id: input.stopRequestId ?? null,
      created_at: now,
      updated_at: now,
    });

  const entryId = Number(info.lastInsertRowid);

  const insertSegment = db.prepare(
    "INSERT INTO entry_segments (entry_id, start_at, end_at) VALUES (?, ?, ?)",
  );
  for (const seg of result.segments) {
    insertSegment.run(entryId, seg.start, seg.end);
  }

  const created = getEntryById(db, entryId);
  if (!created) throw new Error("entry vanished immediately after insert");
  return created;
}

/** US-13: create a manual entry from a duration (string or seconds). */
export function createManualEntry(
  db: DatabaseT.Database,
  tz: string,
  body: CreateManualEntryBody,
): EntryDTO {
  if (!getProjectRow(db, body.projectId)) {
    throw new AppError("NOT_FOUND", `Project ${body.projectId} not found`);
  }
  const startedAt = body.startedAt ?? Date.now();
  const durationSeconds = resolveDurationSeconds(body);
  const endedAt = startedAt + durationSeconds * 1000;
  return insertEntry(db, {
    projectId: body.projectId,
    startedAt,
    endedAt,
    segments: [{ start: startedAt, end: endedAt }],
    tz,
    description: body.description ?? null,
    tag: body.tag ?? null,
    source: "manual",
  });
}

export function listEntries(db: DatabaseT.Database, filters: EntryFilters): EntryDTO[] {
  const where: string[] = ["e.deleted_at IS NULL"]; // trashed entries are hidden from all normal views
  const params: unknown[] = [];
  if (filters.projectId !== undefined) (where.push("e.project_id = ?"), params.push(filters.projectId));
  if (filters.clientId !== undefined) (where.push("p.client_id = ?"), params.push(filters.clientId));
  if (filters.mode !== undefined) (where.push("p.mode = ?"), params.push(filters.mode));
  if (filters.from !== undefined) (where.push("e.local_date >= ?"), params.push(filters.from));
  if (filters.to !== undefined) (where.push("e.local_date <= ?"), params.push(filters.to));
  if (filters.tag !== undefined) (where.push("e.tag = ?"), params.push(filters.tag));
  if (filters.billed !== undefined) (where.push("e.billed = ?"), params.push(filters.billed ? 1 : 0));
  if (filters.q !== undefined) {
    where.push("(e.description LIKE ? OR e.tag LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = filters.limit ?? 500;
  const offset = filters.offset ?? 0;
  params.push(limit, offset);

  const ids = db
    .prepare<unknown[], { id: number }>(
      `SELECT e.id FROM entries e JOIN projects p ON p.id = e.project_id
       ${clause} ORDER BY e.started_at DESC, e.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params);
  return ids.map((r) => getEntryById(db, r.id)!);
}

export function updateEntry(
  db: DatabaseT.Database,
  id: number,
  body: UpdateEntryBody,
): EntryDTO {
  const existing = db
    .prepare<[number], { started_at: number; tz: string; duration_seconds: number }>(
      "SELECT started_at, tz, duration_seconds FROM entries WHERE id = ?",
    )
    .get(id);
  if (!existing) throw new AppError("NOT_FOUND", `Entry ${id} not found`);

  if (body.projectId !== undefined && !getProjectRow(db, body.projectId)) {
    throw new AppError("NOT_FOUND", `Project ${body.projectId} not found`);
  }

  const now = Date.now();
  const durationChanged = body.durationSeconds !== undefined || body.duration !== undefined;
  const dateChanged = body.localDate !== undefined;

  // Moving an entry to a new billable date keeps its local time-of-day, so a
  // 14:00 session stays a 14:00 session — DST-safe via Luxon (entry's own tz).
  const newStart = dateChanged
    ? moveToLocalDate(existing.started_at, existing.tz, body.localDate!)
    : existing.started_at;

  db.transaction(() => {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.projectId !== undefined) (sets.push("project_id = ?"), params.push(body.projectId));
    if (body.description !== undefined) (sets.push("description = ?"), params.push(body.description));
    if (body.tag !== undefined) (sets.push("tag = ?"), params.push(body.tag));
    if (body.billed !== undefined) {
      sets.push("billed = ?", "billed_at = ?");
      params.push(body.billed ? 1 : 0, body.billed ? now : null);
    }

    if (durationChanged || dateChanged) {
      // Editing the duration and/or date rewrites the entry as a single
      // continuous segment of that length from the (possibly new) start, with
      // idle reset to 0 and local_date re-derived from the new start.
      const durationSeconds = durationChanged
        ? resolveDurationSeconds(body)
        : existing.duration_seconds;
      const endedAt = newStart + durationSeconds * 1000;
      sets.push(
        "started_at = ?",
        "ended_at = ?",
        "raw_seconds = ?",
        "idle_seconds = ?",
        "duration_seconds = ?",
        "local_date = ?",
      );
      params.push(newStart, endedAt, durationSeconds, 0, durationSeconds, localDateOf(newStart, existing.tz));
      db.prepare("DELETE FROM entry_segments WHERE entry_id = ?").run(id);
      db.prepare("INSERT INTO entry_segments (entry_id, start_at, end_at) VALUES (?, ?, ?)").run(
        id,
        newStart,
        endedAt,
      );
    }

    sets.push("updated_at = ?");
    params.push(now, id);
    db.prepare(`UPDATE entries SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  })();

  return getEntryById(db, id)!;
}

/**
 * Shift a UTC instant to a new local calendar date in the given tz while keeping
 * its local time-of-day (hour/minute/second). Used when re-dating an entry.
 */
function moveToLocalDate(startedAt: number, tz: string, localDate: string): number {
  const orig = DateTime.fromMillis(startedAt, { zone: tz });
  const [year, month, day] = localDate.split("-").map(Number);
  const moved = DateTime.fromObject(
    { year, month, day, hour: orig.hour, minute: orig.minute, second: orig.second },
    { zone: tz },
  );
  if (!moved.isValid) throw new AppError("VALIDATION_ERROR", `Invalid date: ${localDate}`);
  return moved.toMillis();
}

/**
 * Soft-delete: move a live entry to the trash (sets deleted_at) instead of
 * erasing it, so it can be restored until the retention window lapses.
 */
export function deleteEntry(db: DatabaseT.Database, id: number): void {
  const info = db
    .prepare("UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .run(Date.now(), Date.now(), id);
  if (info.changes === 0) throw new AppError("NOT_FOUND", `Entry ${id} not found`);
}

/** Soft-delete many entries at once (bulk trash). Returns how many were trashed. */
export function bulkDeleteEntries(db: DatabaseT.Database, ids: number[]): number {
  const now = Date.now();
  const stmt = db.prepare(
    "UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
  );
  const tx = db.transaction((list: number[]) => {
    let n = 0;
    for (const id of list) n += stmt.run(now, now, id).changes;
    return n;
  });
  return tx(ids);
}

/** List trashed entries (most recently deleted first). */
export function listDeletedEntries(db: DatabaseT.Database): EntryDTO[] {
  const ids = db
    .prepare<[], { id: number }>(
      "SELECT id FROM entries WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC",
    )
    .all();
  return ids.map((r) => getEntryById(db, r.id)!);
}

/** Restore trashed entries back to the live set. Returns how many were restored. */
export function restoreEntries(db: DatabaseT.Database, ids: number[]): number {
  const now = Date.now();
  const stmt = db.prepare(
    "UPDATE entries SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL",
  );
  const tx = db.transaction((list: number[]) => {
    let n = 0;
    for (const id of list) n += stmt.run(now, id).changes;
    return n;
  });
  return tx(ids);
}

/**
 * Permanently erase trashed entries (only ones already in the trash). Segments
 * cascade via FK. Returns how many rows were removed.
 */
export function purgeEntries(db: DatabaseT.Database, ids: number[]): number {
  const stmt = db.prepare("DELETE FROM entries WHERE id = ? AND deleted_at IS NOT NULL");
  const tx = db.transaction((list: number[]) => {
    let n = 0;
    for (const id of list) n += stmt.run(id).changes;
    return n;
  });
  return tx(ids);
}

/**
 * Purge trashed entries deleted before `cutoffMs` (retention expiry). Called on
 * startup and daily. Returns how many rows were permanently removed.
 */
export function purgeExpiredEntries(db: DatabaseT.Database, cutoffMs: number): number {
  return db
    .prepare("DELETE FROM entries WHERE deleted_at IS NOT NULL AND deleted_at < ?")
    .run(cutoffMs).changes;
}

/** Apply the same patch to every listed entry, atomically. Returns the count. */
export function bulkUpdateEntries(
  db: DatabaseT.Database,
  ids: number[],
  patch: UpdateEntryBody,
): number {
  const tx = db.transaction((list: number[]) => {
    for (const id of list) updateEntry(db, id, patch);
    return list.length;
  });
  return tx(ids);
}
