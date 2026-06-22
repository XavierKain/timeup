import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, createProject } from "../../src/services/catalog.js";
import {
  bulkDeleteEntries,
  bulkUpdateEntries,
  createManualEntry,
  deleteEntry,
  listDeletedEntries,
  listEntries,
  purgeEntries,
  purgeExpiredEntries,
  restoreEntries,
  updateEntry,
} from "../../src/services/entry.js";
import { makeContext, type TestContext } from "../helpers.js";

const TZ = "Europe/Paris";
let ctx: TestContext;
let projectId: number;

beforeEach(() => {
  ctx = makeContext();
  const client = createClient(ctx.db, { name: "Acme" });
  projectId = createProject(ctx.db, { clientId: client.id, name: "Site", mode: "horaire" }).id;
});
afterEach(() => ctx.cleanup());

describe("manual entries (US-13)", () => {
  it("creates a manual entry from a tolerant duration", () => {
    const entry = createManualEntry(ctx.db, TZ, {
      projectId,
      duration: "1h30",
      startedAt: Date.UTC(2026, 0, 15, 12, 0),
      description: "Matomo",
      tag: "analytics",
    });
    expect(entry.durationSeconds).toBe(5400);
    expect(entry.source).toBe("manual");
    expect(entry.localDate).toBe("2026-01-15");
    expect(entry.segments).toHaveLength(1);
  });

  it("filters by date range, tag and text", () => {
    createManualEntry(ctx.db, TZ, {
      projectId,
      durationSeconds: 600,
      startedAt: Date.UTC(2026, 0, 10, 9, 0),
      description: "SMTP",
      tag: "mail",
    });
    createManualEntry(ctx.db, TZ, {
      projectId,
      durationSeconds: 600,
      startedAt: Date.UTC(2026, 0, 20, 9, 0),
      description: "Export order",
      tag: "export",
    });

    expect(listEntries(ctx.db, { projectId })).toHaveLength(2);
    expect(listEntries(ctx.db, { from: "2026-01-15", to: "2026-01-31" })).toHaveLength(1);
    expect(listEntries(ctx.db, { tag: "mail" })).toHaveLength(1);
    expect(listEntries(ctx.db, { q: "export" })).toHaveLength(1);
    expect(listEntries(ctx.db, { clientId: 999 })).toHaveLength(0);
  });

  it("filters entries by the project's billing mode", () => {
    const client = createClient(ctx.db, { name: "C" });
    const forfait = createProject(ctx.db, { clientId: client.id, name: "F", mode: "forfait" }).id;
    createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600 }); // projectId is horaire
    createManualEntry(ctx.db, TZ, { projectId: forfait, durationSeconds: 600 });
    expect(listEntries(ctx.db, { mode: "horaire" })).toHaveLength(1);
    expect(listEntries(ctx.db, { mode: "forfait" })).toHaveLength(1);
    expect(listEntries(ctx.db, { mode: "prix_fixe" })).toHaveLength(0);
  });

  it("edits duration (rewrites the segment, idle reset)", () => {
    const entry = createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600 });
    const updated = updateEntry(ctx.db, entry.id, { duration: "2h", description: "fixed" });
    expect(updated.durationSeconds).toBe(7200);
    expect(updated.idleSeconds).toBe(0);
    expect(updated.description).toBe("fixed");
    expect(updated.segments).toHaveLength(1);
    expect(updated.segments[0]!.endAt - updated.segments[0]!.startAt).toBe(7200 * 1000);
  });

  it("edits the date (localDate), preserving the local time-of-day and duration", () => {
    const entry = createManualEntry(ctx.db, TZ, {
      projectId,
      durationSeconds: 3600,
      startedAt: Date.UTC(2026, 0, 15, 12, 0), // 13:00 Europe/Paris (winter, UTC+1)
    });
    const updated = updateEntry(ctx.db, entry.id, { localDate: "2026-02-20" });
    expect(updated.localDate).toBe("2026-02-20");
    expect(updated.durationSeconds).toBe(3600); // unchanged
    expect(updated.segments).toHaveLength(1);
    // time-of-day preserved in the entry's timezone
    expect(DateTime.fromMillis(updated.startedAt, { zone: TZ }).toFormat("HH:mm")).toBe("13:00");
    expect(updated.segments[0]!.endAt - updated.segments[0]!.startAt).toBe(3600 * 1000);
  });

  it("edits date and duration together", () => {
    const entry = createManualEntry(ctx.db, TZ, {
      projectId,
      durationSeconds: 600,
      startedAt: Date.UTC(2026, 0, 15, 9, 0),
    });
    const updated = updateEntry(ctx.db, entry.id, { localDate: "2026-03-01", duration: "2h" });
    expect(updated.localDate).toBe("2026-03-01");
    expect(updated.durationSeconds).toBe(7200);
    expect(updated.segments[0]!.endAt - updated.segments[0]!.startAt).toBe(7200 * 1000);
  });

  it("marks billed and excludes from unbilled filter", () => {
    const entry = createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600 });
    updateEntry(ctx.db, entry.id, { billed: true });
    expect(listEntries(ctx.db, { billed: false })).toHaveLength(0);
    expect(listEntries(ctx.db, { billed: true })).toHaveLength(1);
  });

  it("bulk-updates the date of many entries (each keeps its time-of-day)", () => {
    const e1 = createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600, startedAt: Date.UTC(2026, 5, 17, 8, 0) });
    const e2 = createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600, startedAt: Date.UTC(2026, 5, 17, 14, 0) });
    const n = bulkUpdateEntries(ctx.db, [e1.id, e2.id], { localDate: "2026-03-01" });
    expect(n).toBe(2);
    expect(listEntries(ctx.db, {}).every((e) => e.localDate === "2026-03-01")).toBe(true);
    // time-of-day preserved per entry
    const times = listEntries(ctx.db, {}).map((e) => DateTime.fromMillis(e.startedAt, { zone: TZ }).toFormat("HH:mm")).sort();
    expect(times).toEqual(["10:00", "16:00"]); // 08:00 & 14:00 UTC in summer (UTC+2)
  });

  it("bulk-updates billed across entries", () => {
    const e1 = createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600 });
    const e2 = createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600 });
    bulkUpdateEntries(ctx.db, [e1.id, e2.id], { billed: true });
    expect(listEntries(ctx.db, { billed: true })).toHaveLength(2);
  });

  it("soft-deletes an entry to the trash (hidden but recoverable)", () => {
    const entry = createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600 });
    deleteEntry(ctx.db, entry.id);
    // Hidden from the live list, but the row + its segments are preserved.
    expect(listEntries(ctx.db, {})).toHaveLength(0);
    expect(ctx.db.prepare("SELECT COUNT(*) c FROM entry_segments").get()).toEqual({ c: 1 });
    const trash = listDeletedEntries(ctx.db);
    expect(trash).toHaveLength(1);
    expect(trash[0]!.id).toBe(entry.id);
    expect(trash[0]!.deletedAt).toBeTypeOf("number");
  });

  it("restores a trashed entry back to the live set", () => {
    const entry = createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600 });
    deleteEntry(ctx.db, entry.id);
    expect(restoreEntries(ctx.db, [entry.id])).toBe(1);
    expect(listEntries(ctx.db, {})).toHaveLength(1);
    expect(listDeletedEntries(ctx.db)).toHaveLength(0);
  });

  it("bulk-deletes many entries at once", () => {
    const e1 = createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600 });
    const e2 = createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600 });
    expect(bulkDeleteEntries(ctx.db, [e1.id, e2.id])).toBe(2);
    expect(listEntries(ctx.db, {})).toHaveLength(0);
    expect(listDeletedEntries(ctx.db)).toHaveLength(2);
  });

  it("purges a trashed entry permanently (with its segments)", () => {
    const entry = createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600 });
    deleteEntry(ctx.db, entry.id);
    expect(purgeEntries(ctx.db, [entry.id])).toBe(1);
    expect(listDeletedEntries(ctx.db)).toHaveLength(0);
    expect(ctx.db.prepare("SELECT COUNT(*) c FROM entry_segments").get()).toEqual({ c: 0 });
  });

  it("only purges trashed rows, never live ones", () => {
    const entry = createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600 });
    expect(purgeEntries(ctx.db, [entry.id])).toBe(0); // not in trash → untouched
    expect(listEntries(ctx.db, {})).toHaveLength(1);
  });

  it("auto-purges entries deleted past the retention cutoff", () => {
    const entry = createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600 });
    deleteEntry(ctx.db, entry.id);
    // Backdate the deletion to 31 days ago, then purge anything older than 30 days.
    const longAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    ctx.db.prepare("UPDATE entries SET deleted_at = ? WHERE id = ?").run(longAgo, entry.id);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(purgeExpiredEntries(ctx.db, cutoff)).toBe(1);
    expect(listDeletedEntries(ctx.db)).toHaveLength(0);
  });
});
