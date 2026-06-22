import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importWorkbook } from "../../src/services/import.js";
import { forfaitSummary } from "../../src/services/billing.js";
import { listEntries } from "../../src/services/entry.js";
import { makeContext, type TestContext } from "../helpers.js";

const FIXTURE = "test/fixtures-real.xlsx";
const TZ = "Europe/Paris";

let ctx: TestContext;
beforeEach(() => {
  ctx = makeContext();
});
afterEach(() => ctx.cleanup());

// Regression test against a copy of the user's real workbook.
describe.skipIf(!existsSync(FIXTURE))("Excel import (US-17)", () => {
  it("dry-run parses the real workbook and reconciles against the Excel summary", async () => {
    const report = await importWorkbook(ctx.db, FIXTURE, { tz: TZ, dryRun: true });

    expect(report.clients).toBe(10);
    expect(report.forfaitProjects).toBe(10);
    expect(report.recharges).toBe(24);
    expect(report.entries).toBe(477);
    expect(report.reconciliation).toHaveLength(10);

    const byName = new Map(report.reconciliation.map((r) => [r.client, r]));
    // 8 clients match the Excel cached "Temps restant" exactly.
    for (const name of [
      "Atelier Nord",
      "Orbit",
      "Voile & Co",
      "Infodata",
      "M&Co",
      "Studio Mira",
      "Bellevue",
      "Famille & Co",
    ]) {
      expect(byName.get(name)?.match, name).toBe(true);
    }
    // Two differ because the sheet had text-typed durations Excel didn't sum.
    expect(byName.get("Acmeo")?.match).toBe(false);
    expect(byName.get("Eduskills")?.match).toBe(false);

    // The discrepancy is explained by a warning about the text cell.
    expect(report.warnings.some((w) => w.includes("12h35"))).toBe(true);
  });

  it("real import persists clients, recharges and entries via the write-path", async () => {
    const report = await importWorkbook(ctx.db, FIXTURE, { tz: TZ });
    expect(report.dryRun).toBe(false);

    expect(forfaitSummary(ctx.db)).toHaveLength(10);
    expect(listEntries(ctx.db, { limit: 100000 })).toHaveLength(477);
  });
});
