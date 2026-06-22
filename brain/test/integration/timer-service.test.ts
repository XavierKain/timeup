import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError, type ErrorCode } from "../../src/contracts/common.js";
import {
  addTimeToTimer,
  discardTimer,
  getTimerState,
  lastActiveProject,
  pauseTimer,
  reassignTimer,
  resumeKeepingIdle,
  resumeTimer,
  runningDurationSeconds,
  setTimerDescription,
  startTimer,
  stopTimer,
} from "../../src/services/timer.js";
import { makeContext, seedProject, type TestContext } from "../helpers.js";

const M = 60_000;
const TZ = "Europe/Paris";

function expectAppError(fn: () => unknown, code: ErrorCode): void {
  try {
    fn();
    throw new Error(`expected AppError ${code} but none thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
  }
}

let ctx: TestContext;
let projectId: number;

beforeEach(() => {
  ctx = makeContext();
  projectId = seedProject(ctx.db);
});
afterEach(() => ctx.cleanup());

describe("timer service", () => {
  it("a live description set on the timer lands on the entry at stop", () => {
    const t0 = Date.UTC(2026, 0, 15, 9, 0);
    startTimer(ctx.db, TZ, projectId, t0);
    const st = setTimerDescription(ctx.db, "  Refonte page d'accueil  ", t0 + M);
    expect(st.running && st.description).toBe("Refonte page d'accueil"); // trimmed
    const entry = stopTimer(ctx.db, {}, t0 + 10 * M);
    expect(entry.description).toBe("Refonte page d'accueil");
  });

  it("an explicit stop description overrides the live one; empty clears it", () => {
    const t0 = Date.UTC(2026, 0, 15, 9, 0);
    startTimer(ctx.db, TZ, projectId, t0);
    setTimerDescription(ctx.db, "draft", t0 + M);
    const cleared = setTimerDescription(ctx.db, "   ", t0 + 2 * M);
    expect(cleared.running && cleared.description).toBeNull();
    setTimerDescription(ctx.db, "live", t0 + 3 * M);
    const entry = stopTimer(ctx.db, { description: "final" }, t0 + 10 * M);
    expect(entry.description).toBe("final"); // stop-time description wins
  });

  it("rejects setting a description with no running timer", () => {
    expectAppError(() => setTimerDescription(ctx.db, "x"), "NO_RUNNING_TIMER");
  });

  it("start -> stop writes a correct continuous entry", () => {
    const t0 = Date.UTC(2026, 0, 15, 9, 0); // 10:00 Paris
    startTimer(ctx.db, TZ, projectId, t0);
    const entry = stopTimer(ctx.db, { description: "work", tag: "dev" }, t0 + 10 * M);

    expect(entry.rawSeconds).toBe(600);
    expect(entry.durationSeconds).toBe(600);
    expect(entry.idleSeconds).toBe(0);
    expect(entry.description).toBe("work");
    expect(entry.tag).toBe("dev");
    expect(entry.source).toBe("timer");
    expect(entry.localDate).toBe("2026-01-15");
    expect(entry.segments).toHaveLength(1);

    // timer cleared after stop
    expect(getTimerState(ctx.db).running).toBe(false);
    expect(ctx.db.prepare("SELECT COUNT(*) c FROM live_segments").get()).toEqual({ c: 0 });
  });

  it("resumeKeepingIdle reopens the segment so the idle gap counts as active", () => {
    const t0 = Date.UTC(2026, 0, 15, 9, 0);
    startTimer(ctx.db, TZ, projectId, t0);
    pauseTimer(ctx.db, t0 + 5 * M);
    resumeKeepingIdle(ctx.db, t0 + 10 * M); // 5 min away, but kept
    const entry = stopTimer(ctx.db, {}, t0 + 12 * M);
    expect(entry.rawSeconds).toBe(12 * 60);
    expect(entry.durationSeconds).toBe(12 * 60); // gap NOT excluded
    expect(entry.idleSeconds).toBe(0);
    expect(entry.segments).toHaveLength(1);
  });

  it("resumeKeepingIdle requires a paused timer", () => {
    startTimer(ctx.db, TZ, projectId, Date.UTC(2026, 0, 15, 9, 0));
    expectAppError(() => resumeKeepingIdle(ctx.db), "NOT_PAUSED");
  });

  it("reassignTimer moves the running timer to another project", () => {
    const p2 = seedProject(ctx.db);
    startTimer(ctx.db, TZ, projectId, Date.UTC(2026, 0, 15, 9, 0));
    const st = reassignTimer(ctx.db, p2, Date.UTC(2026, 0, 15, 9, 5));
    expect(st.running).toBe(true);
    if (st.running) expect(st.projectId).toBe(p2);
  });

  it("reassignTimer requires a running timer", () => {
    expectAppError(() => reassignTimer(ctx.db, projectId), "NO_RUNNING_TIMER");
  });

  it("lastActiveProject returns the most recently active project", () => {
    expect(lastActiveProject(ctx.db)).toBeNull();
    startTimer(ctx.db, TZ, projectId, Date.UTC(2026, 0, 15, 9, 0));
    expect(lastActiveProject(ctx.db)?.projectId).toBe(projectId);
  });

  it("lastActiveProject follows a reassign then a discard (no entry)", () => {
    const p2 = seedProject(ctx.db);
    const t0 = Date.UTC(2026, 0, 15, 9, 0);
    startTimer(ctx.db, TZ, projectId, t0); // started on projectId
    reassignTimer(ctx.db, p2, t0 + 30 * 1000); // moved to p2
    discardTimer(ctx.db, t0 + 60 * 1000); // cancelled (<2 min, no entry)
    expect(lastActiveProject(ctx.db)?.projectId).toBe(p2); // the last *active* project
  });

  it("addTimeToTimer backdates the start so the duration includes the added time", () => {
    const t0 = Date.UTC(2026, 0, 15, 10, 0);
    startTimer(ctx.db, TZ, projectId, t0);
    addTimeToTimer(ctx.db, 10 * 60, t0 + 1000); // add 10 min, 1s after start
    const st = getTimerState(ctx.db, t0 + 1000);
    expect(st.running && st.elapsedActiveSeconds).toBe(601); // 10 min + 1 s
    const entry = stopTimer(ctx.db, {}, t0 + 1000);
    expect(entry.durationSeconds).toBe(601);
    expect(entry.idleSeconds).toBe(0);
  });

  it("addTimeToTimer rejects a non-running timer and non-positive input", () => {
    expectAppError(() => addTimeToTimer(ctx.db, 600), "NO_RUNNING_TIMER");
    startTimer(ctx.db, TZ, projectId, Date.UTC(2026, 0, 15, 10, 0));
    expectAppError(() => addTimeToTimer(ctx.db, 0), "VALIDATION_ERROR");
  });

  it("runningDurationSeconds reflects active elapsed time", () => {
    expect(runningDurationSeconds(ctx.db, 0)).toBeNull();
    const t0 = Date.UTC(2026, 0, 15, 9, 0);
    startTimer(ctx.db, TZ, projectId, t0);
    expect(runningDurationSeconds(ctx.db, t0 + 90 * 1000)).toBe(90);
  });

  it("pause/resume produces idle from the gap", () => {
    const t0 = Date.UTC(2026, 0, 15, 9, 0);
    startTimer(ctx.db, TZ, projectId, t0);
    pauseTimer(ctx.db, t0 + 5 * M);
    resumeTimer(ctx.db, t0 + 8 * M);
    const entry = stopTimer(ctx.db, {}, t0 + 10 * M);

    expect(entry.rawSeconds).toBe(600);
    expect(entry.durationSeconds).toBe(420); // 5 + 2 min active
    expect(entry.idleSeconds).toBe(180); // 3 min paused
    expect(entry.rawSeconds - entry.idleSeconds).toBe(entry.durationSeconds);
    expect(entry.segments).toHaveLength(2);
  });

  it("reflects running/paused state", () => {
    const t0 = Date.UTC(2026, 0, 15, 9, 0);
    startTimer(ctx.db, TZ, projectId, t0);
    let st = getTimerState(ctx.db, t0 + 2 * M);
    expect(st.running && st.paused).toBe(false);
    expect(st.running && st.elapsedActiveSeconds).toBe(120);

    pauseTimer(ctx.db, t0 + 2 * M);
    st = getTimerState(ctx.db, t0 + 9 * M);
    expect(st.running && st.paused).toBe(true);
    expect(st.running && st.elapsedActiveSeconds).toBe(120); // frozen while paused
    expect(st.running && st.elapsedRawSeconds).toBe(540);
  });

  it("clamps clock skew to a zero-duration entry", () => {
    const t0 = Date.UTC(2026, 0, 15, 9, 0);
    startTimer(ctx.db, TZ, projectId, t0 + 10 * M);
    const entry = stopTimer(ctx.db, {}, t0 + 5 * M); // stop before start
    expect(entry.durationSeconds).toBe(0);
    expect(entry.rawSeconds).toBe(0);
  });

  it("enforces a single running timer (service + storage)", () => {
    const t0 = Date.now();
    startTimer(ctx.db, TZ, projectId, t0);
    expectAppError(() => startTimer(ctx.db, TZ, projectId, t0 + 1000), "TIMER_ALREADY_RUNNING");

    // storage-level guarantee: a second timer row is physically impossible
    expect(() =>
      ctx.db
        .prepare(
          "INSERT INTO timer_state (id, project_id, started_at, tz, created_at) VALUES (2, ?, ?, ?, ?)",
        )
        .run(projectId, t0, TZ, t0),
    ).toThrow();
  });

  it("errors when stopping with no running timer", () => {
    expectAppError(() => stopTimer(ctx.db, {}), "NO_RUNNING_TIMER");
  });

  it("rejects start on an unknown project", () => {
    expectAppError(() => startTimer(ctx.db, TZ, 99999), "NOT_FOUND");
  });

  it("stop is idempotent for the same requestId", () => {
    const t0 = Date.UTC(2026, 0, 15, 9, 0);
    startTimer(ctx.db, TZ, projectId, t0);
    const first = stopTimer(ctx.db, { requestId: "req-1" }, t0 + 10 * M);
    // replay after the timer is already gone returns the same committed entry
    const replay = stopTimer(ctx.db, { requestId: "req-1" }, t0 + 99 * M);

    expect(replay.id).toBe(first.id);
    expect(ctx.db.prepare("SELECT COUNT(*) c FROM entries").get()).toEqual({ c: 1 });
  });
});
