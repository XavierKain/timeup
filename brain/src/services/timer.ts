import type DatabaseT from "better-sqlite3";
import { AppError } from "../contracts/common.js";
import type { EntryDTO, StopTimerBody, TimerStateDTO } from "../contracts/timer.js";
import { computeDuration, liveElapsed } from "../domain/time.js";
import { getEntryByStopRequestId, insertEntry } from "./entry.js";
import { getProjectRow } from "./catalog.js";

interface TimerStateRow {
  id: number;
  project_id: number;
  started_at: number;
  tz: string;
  description: string | null;
  created_at: number;
}

interface LiveSegmentRow {
  id: number;
  start_at: number;
  end_at: number | null;
}

function readTimerState(db: DatabaseT.Database): TimerStateRow | undefined {
  return db.prepare<[], TimerStateRow>("SELECT * FROM timer_state WHERE id = 1").get();
}

function readLiveSegments(db: DatabaseT.Database): LiveSegmentRow[] {
  return db
    .prepare<[], LiveSegmentRow>("SELECT * FROM live_segments ORDER BY start_at")
    .all();
}

function appendEvent(
  db: DatabaseT.Database,
  ts: number,
  action: "start" | "pause" | "resume" | "stop",
  projectId: number | null,
  payload: Record<string, unknown>,
): void {
  db.prepare(
    "INSERT INTO timer_events (ts, action, project_id, payload) VALUES (?, ?, ?, ?)",
  ).run(ts, action, projectId, JSON.stringify(payload));
}

export function getTimerState(db: DatabaseT.Database, now: number = Date.now()): TimerStateDTO {
  const st = readTimerState(db);
  if (!st) return { running: false };

  const segs = readLiveSegments(db);
  const paused = !segs.some((s) => s.end_at === null);
  const elapsed = liveElapsed(
    st.started_at,
    now,
    segs.map((s) => ({ start: s.start_at, end: s.end_at })),
  );

  return {
    running: true,
    projectId: st.project_id,
    startedAt: st.started_at,
    tz: st.tz,
    paused,
    elapsedRawSeconds: elapsed.rawSeconds,
    elapsedActiveSeconds: elapsed.activeSeconds,
    segments: segs.map((s) => ({ startAt: s.start_at, endAt: s.end_at })),
    description: st.description,
  };
}

/** Set/clear the running timer's description (applied to the entry on stop). */
export function setTimerDescription(
  db: DatabaseT.Database,
  description: string | null,
  now: number = Date.now(),
): TimerStateDTO {
  if (!readTimerState(db)) throw new AppError("NO_RUNNING_TIMER", "No timer is running");
  const clean = description && description.trim() ? description.trim() : null;
  db.prepare("UPDATE timer_state SET description = ? WHERE id = 1").run(clean);
  return getTimerState(db, now);
}

export function startTimer(
  db: DatabaseT.Database,
  tz: string,
  projectId: number,
  now: number = Date.now(),
): TimerStateDTO {
  const project = getProjectRow(db, projectId);
  if (!project) throw new AppError("NOT_FOUND", `Project ${projectId} not found`);
  if (project.archived !== 0) {
    throw new AppError("UNPROCESSABLE", `Project ${projectId} is archived`);
  }
  if (readTimerState(db)) {
    throw new AppError("TIMER_ALREADY_RUNNING", "A timer is already running");
  }

  db.transaction(() => {
    db.prepare(
      "INSERT INTO timer_state (id, project_id, started_at, tz, created_at) VALUES (1, ?, ?, ?, ?)",
    ).run(projectId, now, tz, now);
    db.prepare("INSERT INTO live_segments (start_at, end_at) VALUES (?, NULL)").run(now);
    appendEvent(db, now, "start", projectId, {});
  })();

  return getTimerState(db, now);
}

export function pauseTimer(db: DatabaseT.Database, now: number = Date.now()): TimerStateDTO {
  const st = readTimerState(db);
  if (!st) throw new AppError("NO_RUNNING_TIMER", "No timer is running");
  const open = readLiveSegments(db).find((s) => s.end_at === null);
  if (!open) throw new AppError("ALREADY_PAUSED", "Timer is already paused");

  db.transaction(() => {
    db.prepare("UPDATE live_segments SET end_at = ? WHERE end_at IS NULL").run(now);
    appendEvent(db, now, "pause", st.project_id, {});
  })();

  return getTimerState(db, now);
}

export function resumeTimer(db: DatabaseT.Database, now: number = Date.now()): TimerStateDTO {
  const st = readTimerState(db);
  if (!st) throw new AppError("NO_RUNNING_TIMER", "No timer is running");
  const open = readLiveSegments(db).some((s) => s.end_at === null);
  if (open) throw new AppError("NOT_PAUSED", "Timer is running, not paused");

  db.transaction(() => {
    db.prepare("INSERT INTO live_segments (start_at, end_at) VALUES (?, NULL)").run(now);
    appendEvent(db, now, "resume", st.project_id, {});
  })();

  return getTimerState(db, now);
}

/**
 * Resume after an idle pause while KEEPING the idle time as active — reopens the
 * most recent closed segment instead of starting a fresh one, so the away period
 * counts toward the duration. Backs the "garder l'inactif" choice of the idle
 * prompt. Falls back to a normal resume if there is no segment to reopen.
 */
export function resumeKeepingIdle(
  db: DatabaseT.Database,
  now: number = Date.now(),
): TimerStateDTO {
  const st = readTimerState(db);
  if (!st) throw new AppError("NO_RUNNING_TIMER", "No timer is running");
  const segs = readLiveSegments(db);
  if (segs.some((s) => s.end_at === null)) {
    throw new AppError("NOT_PAUSED", "Timer is running, not paused");
  }
  if (segs.length === 0) return resumeTimer(db, now);

  const last = segs[segs.length - 1]!; // ordered by start_at
  db.transaction(() => {
    db.prepare("UPDATE live_segments SET end_at = NULL WHERE id = ?").run(last.id);
    appendEvent(db, now, "resume", st.project_id, { keepIdle: true });
  })();
  return getTimerState(db, now);
}

export function stopTimer(
  db: DatabaseT.Database,
  body: StopTimerBody,
  now: number = Date.now(),
): EntryDTO {
  // Idempotent replay: a previously committed stop with this requestId wins,
  // covering the lost-HTTP-ack / client-retry case.
  if (body.requestId) {
    const existing = getEntryByStopRequestId(db, body.requestId);
    if (existing) return existing;
  }

  const st = readTimerState(db);
  if (!st) throw new AppError("NO_RUNNING_TIMER", "No timer is running");

  return finalizeStop(db, st, body, now);
}

function finalizeStop(
  db: DatabaseT.Database,
  st: TimerStateRow,
  body: StopTimerBody,
  now: number,
): EntryDTO {
  const tx = db.transaction((): EntryDTO => {
    // Close the open segment (if any) at stop time.
    db.prepare("UPDATE live_segments SET end_at = ? WHERE end_at IS NULL").run(now);

    const segs = readLiveSegments(db).map((s) => ({
      start: s.start_at,
      end: s.end_at ?? now,
    }));

    const entry = insertEntry(db, {
      projectId: st.project_id,
      startedAt: st.started_at,
      endedAt: now,
      segments: segs,
      tz: st.tz,
      // An explicit stop-time description wins; otherwise use the one set live on the timer.
      description: body.description ?? st.description ?? null,
      tag: body.tag ?? null,
      source: "timer",
      stopRequestId: body.requestId ?? null,
    });

    appendEvent(db, now, "stop", st.project_id, {
      entryId: entry.id,
      requestId: body.requestId ?? null,
      clockSkew: now < st.started_at,
    });

    db.prepare("DELETE FROM live_segments").run();
    db.prepare("DELETE FROM timer_state WHERE id = 1").run();

    return entry;
  });

  return tx();
}

/**
 * Add active time to the front of the running timer by backdating its start (and
 * the earliest segment) by `addSeconds` — for "I started working before I hit
 * start". Raw and duration both grow by addSeconds, so idle is unchanged.
 */
export function addTimeToTimer(
  db: DatabaseT.Database,
  addSeconds: number,
  now: number = Date.now(),
): TimerStateDTO {
  if (!Number.isFinite(addSeconds) || addSeconds <= 0) {
    throw new AppError("VALIDATION_ERROR", "addSeconds must be > 0");
  }
  const st = readTimerState(db);
  if (!st) throw new AppError("NO_RUNNING_TIMER", "No timer is running");
  const shiftMs = Math.round(addSeconds * 1000);

  db.transaction(() => {
    db.prepare("UPDATE timer_state SET started_at = started_at - ? WHERE id = 1").run(shiftMs);
    const seg = db
      .prepare<[], { id: number; start_at: number }>(
        "SELECT id, start_at FROM live_segments ORDER BY start_at LIMIT 1",
      )
      .get();
    if (seg) {
      db.prepare("UPDATE live_segments SET start_at = ? WHERE id = ?").run(seg.start_at - shiftMs, seg.id);
    }
  })();

  return getTimerState(db, now);
}

/** Most recent known activity instant of the running timer (US-5 recovery bound). */
export function lastKnownActivity(db: DatabaseT.Database): number | null {
  const st = readTimerState(db);
  if (!st) return null;
  const segEnd = db
    .prepare<[], { m: number | null }>(
      "SELECT MAX(end_at) AS m FROM live_segments WHERE end_at IS NOT NULL",
    )
    .get()!.m;
  const evt = db.prepare<[], { m: number | null }>("SELECT MAX(ts) AS m FROM timer_events").get()!.m;
  return Math.max(st.started_at, segEnd ?? 0, evt ?? 0);
}

/** Reassign the running timer to a different project (fix a wrong start). */
export function reassignTimer(
  db: DatabaseT.Database,
  projectId: number,
  now: number = Date.now(),
): TimerStateDTO {
  const st = readTimerState(db);
  if (!st) throw new AppError("NO_RUNNING_TIMER", "No timer is running");
  const project = getProjectRow(db, projectId);
  if (!project) throw new AppError("NOT_FOUND", `Project ${projectId} not found`);
  if (project.archived !== 0) {
    throw new AppError("UNPROCESSABLE", `Project ${projectId} is archived`);
  }
  db.prepare("UPDATE timer_state SET project_id = ? WHERE id = 1").run(projectId);
  return getTimerState(db, now);
}

/**
 * Last project that was actively timed — for "start the last timer". Reads the
 * most recent timer event carrying a project, so it reflects reassignments and
 * discarded (<2 min) timers, not just the original start.
 */
export function lastActiveProject(
  db: DatabaseT.Database,
): { projectId: number; projectName: string } | null {
  const row = db
    .prepare<[], { project_id: number }>(
      "SELECT project_id FROM timer_events WHERE project_id IS NOT NULL ORDER BY ts DESC, id DESC LIMIT 1",
    )
    .get();
  if (!row) return null;
  const project = getProjectRow(db, row.project_id);
  return project ? { projectId: project.id, projectName: project.name } : null;
}

/**
 * Active duration (seconds) of the running timer as of `now`, or null if none.
 * Used to auto-discard a too-short timer before writing an entry.
 */
export function runningDurationSeconds(
  db: DatabaseT.Database,
  now: number = Date.now(),
): number | null {
  const st = readTimerState(db);
  if (!st) return null;
  const segs = readLiveSegments(db).map((s) => ({ start: s.start_at, end: s.end_at ?? now }));
  return computeDuration(st.started_at, now, segs).durationSeconds;
}

/** Cancel a running timer without writing an entry (logs the discarded project). */
export function discardTimer(db: DatabaseT.Database, now: number = Date.now()): void {
  const st = readTimerState(db);
  if (!st) throw new AppError("NO_RUNNING_TIMER", "No timer is running");
  db.transaction(() => {
    appendEvent(db, now, "stop", st.project_id, { discarded: true });
    db.prepare("DELETE FROM live_segments").run();
    db.prepare("DELETE FROM timer_state WHERE id = 1").run();
  })();
}

/**
 * US-5: recover an orphaned running timer found at startup.
 * - "discard": drop it, no entry.
 * - "stop-at-last-activity": finalize with ended_at = last known activity.
 */
export function recoverTimer(
  db: DatabaseT.Database,
  strategy: "discard" | "stop-at-last-activity",
): EntryDTO | null {
  const st = readTimerState(db);
  if (!st) throw new AppError("NO_RUNNING_TIMER", "No timer to recover");
  if (strategy === "discard") {
    discardTimer(db);
    return null;
  }
  return finalizeStop(db, st, {}, lastKnownActivity(db)!);
}
