import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, createProject } from "../../src/services/catalog.js";
import { deleteEntry, insertEntry } from "../../src/services/entry.js";
import {
  createRecharge,
  deleteRecharge,
  forfaitSummary,
  hourlySummary,
  listAllRecharges,
  profitabilitySummary,
  projectStats,
  updateRecharge,
} from "../../src/services/billing.js";
import { makeContext, type TestContext } from "../helpers.js";

const H = 3600 * 1000;
const TZ = "Europe/Paris";

let ctx: TestContext;
beforeEach(() => {
  ctx = makeContext();
});
afterEach(() => ctx.cleanup());

/** Insert a manual entry of `hours` for a project, ending at epoch 0 + offset. */
function addHours(projectId: number, hours: number, billed = false): number {
  const entry = insertEntry(ctx.db, {
    projectId,
    startedAt: 0,
    endedAt: hours * H,
    segments: [{ start: 0, end: hours * H }],
    tz: TZ,
    source: "manual",
  });
  if (billed) {
    ctx.db.prepare("UPDATE entries SET billed = 1 WHERE id = ?").run(entry.id);
  }
  return entry.id;
}

describe("forfait balances (US-8/US-11)", () => {
  it("remaining = sum(recharges) - sum(duration)", () => {
    const client = createClient(ctx.db, { name: "Acmeo" });
    const project = createProject(ctx.db, { clientId: client.id, name: "Site", mode: "forfait" });
    createRecharge(ctx.db, { projectId: project.id, date: "2026-01-01", hours: 5 });
    createRecharge(ctx.db, { projectId: project.id, date: "2026-02-01", hours: 10 });
    addHours(project.id, 6);

    const stats = projectStats(ctx.db, project.id);
    expect(stats.rechargedSeconds).toBe(15 * 3600);
    expect(stats.totalSeconds).toBe(6 * 3600);
    expect(stats.remainingSeconds).toBe(9 * 3600);

    const summary = forfaitSummary(ctx.db);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.remainingSeconds).toBe(9 * 3600);
  });

  it("shows a negative balance when over budget (Acmeo case)", () => {
    const client = createClient(ctx.db, { name: "Acmeo" });
    const project = createProject(ctx.db, { clientId: client.id, name: "Site", mode: "forfait" });
    createRecharge(ctx.db, { projectId: project.id, date: "2026-01-01", hours: 40 });
    addHours(project.id, 41);
    expect(projectStats(ctx.db, project.id).remainingSeconds).toBe(-3600);
  });

  it("rejects recharges on non-forfait projects", () => {
    const client = createClient(ctx.db, { name: "X" });
    const project = createProject(ctx.db, { clientId: client.id, name: "P", mode: "horaire" });
    expect(() =>
      createRecharge(ctx.db, { projectId: project.id, date: "2026-01-01", hours: 5 }),
    ).toThrow();
  });

  it("lists all recharges (recent first) and deletes one", () => {
    const client = createClient(ctx.db, { name: "Acmeo" });
    const project = createProject(ctx.db, { clientId: client.id, name: "Site", mode: "forfait" });
    const r1 = createRecharge(ctx.db, { projectId: project.id, date: "2026-01-01", hours: 5 });
    createRecharge(ctx.db, { projectId: project.id, date: "2026-02-01", hours: 10 });

    const all = listAllRecharges(ctx.db);
    expect(all).toHaveLength(2);
    expect(all[0]!.date).toBe("2026-02-01"); // most recent first

    deleteRecharge(ctx.db, r1.id);
    expect(listAllRecharges(ctx.db)).toHaveLength(1);
    expect(projectStats(ctx.db, project.id).rechargedSeconds).toBe(10 * 3600);
  });

  it("throws deleting an unknown recharge", () => {
    expect(() => deleteRecharge(ctx.db, 999)).toThrow();
  });

  it("edits a recharge (hours/date/price/note) and the balance follows", () => {
    const client = createClient(ctx.db, { name: "Acmeo" });
    const project = createProject(ctx.db, { clientId: client.id, name: "Site", mode: "forfait" });
    const r = createRecharge(ctx.db, { projectId: project.id, date: "2026-01-01", hours: 5 });

    const updated = updateRecharge(ctx.db, r.id, {
      hours: 12,
      date: "2026-02-15",
      price: 1080,
      note: "corrigé",
    });
    expect(updated.hours).toBe(12);
    expect(updated.date).toBe("2026-02-15");
    expect(updated.price).toBe(1080);
    expect(updated.note).toBe("corrigé");
    expect(projectStats(ctx.db, project.id).rechargedSeconds).toBe(12 * 3600);
  });

  it("throws editing an unknown recharge", () => {
    expect(() => updateRecharge(ctx.db, 999, { hours: 1 })).toThrow();
  });
});

describe("hourly billable (US-9)", () => {
  it("billable amount = unbilled hours * rate", () => {
    const client = createClient(ctx.db, { name: "M&Co" });
    const project = createProject(ctx.db, {
      clientId: client.id,
      name: "Support",
      mode: "horaire",
      hourlyRate: 100,
    });
    addHours(project.id, 2);
    addHours(project.id, 1, true); // already billed -> excluded

    const stats = projectStats(ctx.db, project.id);
    expect(stats.totalSeconds).toBe(3 * 3600);
    expect(stats.unbilledSeconds).toBe(2 * 3600);
    expect(stats.billableAmount).toBe(200);
    expect(hourlySummary(ctx.db)[0]!.billableAmount).toBe(200);
  });
});

describe("fixed-price profitability (US-10/US-12)", () => {
  it("effective rate = price / hours; variance vs estimate", () => {
    const client = createClient(ctx.db, { name: "Gros projet" });
    const project = createProject(ctx.db, {
      clientId: client.id,
      name: "Refonte",
      mode: "prix_fixe",
      fixedPrice: 3000,
      estimatedHours: 30,
    });
    addHours(project.id, 20);

    const stats = projectStats(ctx.db, project.id);
    expect(stats.hoursSpent).toBe(20);
    expect(stats.effectiveHourlyRate).toBe(150);
    expect(stats.varianceHours).toBe(-10);

    expect(profitabilitySummary(ctx.db)[0]!.effectiveHourlyRate).toBe(150);
  });

  it("sorts profitability with in-progress projects before completed ones", () => {
    const client = createClient(ctx.db, { name: "C" });
    // 'Done' has the better effective rate but is completed → must rank below 'Live'.
    const done = createProject(ctx.db, { clientId: client.id, name: "Done", mode: "prix_fixe", fixedPrice: 4000 }).id;
    const live = createProject(ctx.db, { clientId: client.id, name: "Live", mode: "prix_fixe", fixedPrice: 1000 }).id;
    addHours(done, 10); // 400 €/h
    addHours(live, 10); // 100 €/h
    ctx.db.prepare("UPDATE projects SET completed = 1 WHERE id = ?").run(done);

    const summary = profitabilitySummary(ctx.db);
    expect(summary.map((s) => s.projectName)).toEqual(["Live", "Done"]);
    expect(summary[0]!.completed).toBe(false);
    expect(summary[1]!.completed).toBe(true);
  });

  it("no effective rate before any time is logged", () => {
    const client = createClient(ctx.db, { name: "C" });
    const project = createProject(ctx.db, {
      clientId: client.id,
      name: "P",
      mode: "prix_fixe",
      fixedPrice: 1000,
    });
    expect(projectStats(ctx.db, project.id).effectiveHourlyRate).toBeNull();
    expect(projectStats(ctx.db, project.id).firstEntryDate).toBeNull();
    expect(projectStats(ctx.db, project.id).lastEntryDate).toBeNull();
  });

  it("reports the first/last work date of a fixed-price project", () => {
    const client = createClient(ctx.db, { name: "Span" });
    const project = createProject(ctx.db, {
      clientId: client.id,
      name: "Refonte",
      mode: "prix_fixe",
      fixedPrice: 1000,
    });
    const at = (m: number, d: number) => ({
      projectId: project.id,
      startedAt: Date.UTC(2026, m, d, 12, 0),
      endedAt: Date.UTC(2026, m, d, 13, 0),
      segments: [{ start: Date.UTC(2026, m, d, 12, 0), end: Date.UTC(2026, m, d, 13, 0) }],
      tz: TZ,
      source: "manual" as const,
    });
    insertEntry(ctx.db, at(2, 15)); // 2026-03-15
    insertEntry(ctx.db, at(0, 10)); // 2026-01-10 (inserted out of order)

    const stats = projectStats(ctx.db, project.id);
    expect(stats.firstEntryDate).toBe("2026-01-10");
    expect(stats.lastEntryDate).toBe("2026-03-15");
  });

  it("excludes trashed entries from hours, rate and date range", () => {
    const client = createClient(ctx.db, { name: "Trash" });
    const project = createProject(ctx.db, {
      clientId: client.id,
      name: "Refonte",
      mode: "prix_fixe",
      fixedPrice: 3000,
      estimatedHours: 30,
    });
    addHours(project.id, 20);
    const doomed = addHours(project.id, 5);
    deleteEntry(ctx.db, doomed); // soft-delete → must not count toward profitability

    const stats = projectStats(ctx.db, project.id);
    expect(stats.hoursSpent).toBe(20); // not 25
    expect(stats.effectiveHourlyRate).toBe(150); // 3000 / 20
    expect(profitabilitySummary(ctx.db)[0]!.hoursSpent).toBe(20);
  });
});
