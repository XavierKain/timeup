import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, createProject } from "../../src/services/catalog.js";
import { createManualEntry } from "../../src/services/entry.js";
import { markEntriesBilled, prepareInvoice } from "../../src/services/invoice.js";
import { makeContext, type TestContext } from "../helpers.js";

const TZ = "Europe/Paris";
let ctx: TestContext;
let clientId: number;
let projectId: number;

beforeEach(() => {
  ctx = makeContext();
  clientId = createClient(ctx.db, { name: "M&Co" }).id;
  projectId = createProject(ctx.db, {
    clientId,
    name: "Support",
    mode: "horaire",
    hourlyRate: 100,
  }).id;
});
afterEach(() => ctx.cleanup());

describe("invoice prep (US-15/16)", () => {
  it("groups by tag, rounds up, and computes the amount", () => {
    createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 1500, tag: "dev" }); // 25min
    createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 600, tag: "dev" }); // 10min

    const prep = prepareInvoice(ctx.db, { clientId, roundingMinutes: 15 });
    expect(prep.lines).toHaveLength(1);
    expect(prep.lines[0]!.entries).toBe(2);
    expect(prep.lines[0]!.rawSeconds).toBe(2100);
    expect(prep.lines[0]!.roundedSeconds).toBe(2700); // 30min + 15min
    expect(prep.lines[0]!.hours).toBe(0.75);
    expect(prep.totalAmount).toBe(75);
    expect(prep.copyText).toContain("M&Co");
    expect(prep.copyText).toContain("Total");
  });

  it("excludes already-billed entries, then includes them on demand", () => {
    createManualEntry(ctx.db, TZ, { projectId, durationSeconds: 3600 });
    const prep = prepareInvoice(ctx.db, { clientId });
    expect(prep.entryIds).toHaveLength(1);

    const billed = markEntriesBilled(ctx.db, prep.entryIds);
    expect(billed).toBe(1);

    expect(prepareInvoice(ctx.db, { clientId }).lines).toHaveLength(0);
    expect(prepareInvoice(ctx.db, { clientId, includeBilled: true }).lines).toHaveLength(1);
  });

  it("filters by date range", () => {
    createManualEntry(ctx.db, TZ, {
      projectId,
      durationSeconds: 600,
      startedAt: Date.UTC(2026, 0, 10, 9, 0),
    });
    createManualEntry(ctx.db, TZ, {
      projectId,
      durationSeconds: 600,
      startedAt: Date.UTC(2026, 0, 25, 9, 0),
    });
    const prep = prepareInvoice(ctx.db, { clientId, from: "2026-01-15", to: "2026-01-31" });
    expect(prep.lines[0]!.entries).toBe(1);
  });

  it("no rate => no amount but still totals hours", () => {
    const c2 = createClient(ctx.db, { name: "NoRate" }).id;
    // Hourly project with no rate set: still invoiced (hours), just no amount.
    const p2 = createProject(ctx.db, { clientId: c2, name: "P", mode: "horaire" }).id;
    createManualEntry(ctx.db, TZ, { projectId: p2, durationSeconds: 3600 });
    const prep = prepareInvoice(ctx.db, { clientId: c2 });
    expect(prep.totalAmount).toBeNull();
    expect(prep.totalHours).toBe(1);
  });

  it("invoices only hourly work — excludes forfait and prix_fixe", () => {
    const c = createClient(ctx.db, { name: "MixedModes" }).id;
    const horaire = createProject(ctx.db, { clientId: c, name: "Horaire", mode: "horaire", hourlyRate: 100 }).id;
    const forfait = createProject(ctx.db, { clientId: c, name: "Forfait", mode: "forfait" }).id;
    const fixe = createProject(ctx.db, { clientId: c, name: "Fixe", mode: "prix_fixe", fixedPrice: 5000 }).id;
    createManualEntry(ctx.db, TZ, { projectId: horaire, durationSeconds: 3600 });
    createManualEntry(ctx.db, TZ, { projectId: forfait, durationSeconds: 7200 });
    createManualEntry(ctx.db, TZ, { projectId: fixe, durationSeconds: 1800 });

    const prep = prepareInvoice(ctx.db, { clientId: c });
    expect(prep.lines).toHaveLength(1);
    expect(prep.lines[0]!.projectName).toBe("Horaire");
    expect(prep.totalHours).toBe(1); // only the 1h hourly entry, not the forfait/prix_fixe ones
    expect(prep.totalAmount).toBe(100);
    expect(prep.entryIds).toHaveLength(1); // mark-billed won't touch forfait/prix_fixe entries
  });
});
