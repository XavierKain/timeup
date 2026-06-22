import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, createProject } from "../../src/services/catalog.js";
import { createManualEntry } from "../../src/services/entry.js";
import { exportEntriesCsv, exportJson } from "../../src/services/export.js";
import {
  getTimerState,
  lastKnownActivity,
  recoverTimer,
  startTimer,
} from "../../src/services/timer.js";
import { makeContext, seedProject, type TestContext } from "../helpers.js";

const TZ = "Europe/Paris";
const M = 60_000;
let ctx: TestContext;
beforeEach(() => {
  ctx = makeContext();
});
afterEach(() => ctx.cleanup());

describe("export (US-18)", () => {
  it("exports entries as CSV with a header and one row per entry", () => {
    const c = createClient(ctx.db, { name: "Acme" }).id;
    const p = createProject(ctx.db, { clientId: c, name: "Site", mode: "horaire" }).id;
    createManualEntry(ctx.db, TZ, { projectId: p, durationSeconds: 600, description: "a,b" });

    const csv = exportEntriesCsv(ctx.db, {});
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("client");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"a,b"'); // comma-containing field is quoted
  });

  it("dumps full JSON", () => {
    const c = createClient(ctx.db, { name: "Acme" }).id;
    createProject(ctx.db, { clientId: c, name: "Site", mode: "forfait" });
    const dump = exportJson(ctx.db);
    expect(dump.clients).toHaveLength(1);
    expect(dump.projects).toHaveLength(1);
    expect(dump.exportedAt).toBeTruthy();
  });
});

describe("orphan recovery (US-5)", () => {
  it("stop-at-last-activity finalizes using the last known activity", () => {
    const projectId = seedProject(ctx.db);
    const t0 = Date.UTC(2026, 0, 15, 9, 0);
    startTimer(ctx.db, TZ, projectId, t0);
    // simulate a pause event at t0+5m as the last activity
    ctx.db
      .prepare("UPDATE live_segments SET end_at = ? WHERE end_at IS NULL")
      .run(t0 + 5 * M);
    ctx.db
      .prepare("INSERT INTO timer_events (ts, action, project_id, payload) VALUES (?, 'pause', ?, '{}')")
      .run(t0 + 5 * M, projectId);

    expect(lastKnownActivity(ctx.db)).toBe(t0 + 5 * M);
    const entry = recoverTimer(ctx.db, "stop-at-last-activity");
    expect(entry).not.toBeNull();
    expect(entry!.durationSeconds).toBe(5 * 60);
    expect(getTimerState(ctx.db).running).toBe(false);
  });

  it("discard drops the timer without writing an entry", () => {
    const projectId = seedProject(ctx.db);
    startTimer(ctx.db, TZ, projectId, Date.now());
    const res = recoverTimer(ctx.db, "discard");
    expect(res).toBeNull();
    expect(getTimerState(ctx.db).running).toBe(false);
    expect(ctx.db.prepare("SELECT COUNT(*) c FROM entries").get()).toEqual({ c: 0 });
  });
});
