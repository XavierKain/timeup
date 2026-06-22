import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../../src/services/catalog.js";
import { runBackup } from "../../src/services/backup.js";
import { makeContext, type TestContext } from "../helpers.js";

let ctx: TestContext;
beforeEach(() => {
  ctx = makeContext();
});
afterEach(() => ctx.cleanup());

describe("automatic backups", () => {
  it("writes a dated snapshot that opens as a valid copy", async () => {
    createClient(ctx.db, { name: "Acmeo" });
    const dir = join(ctx.dir, "backups");

    const dest = await runBackup(ctx.db, dir, "2026-01-01", 14);
    expect(dest).toBe(join(dir, "timup-2026-01-01.db"));
    expect(existsSync(dest)).toBe(true);

    // The snapshot is a real database holding the data at backup time.
    const Database = (await import("better-sqlite3")).default;
    const copy = new Database(dest, { readonly: true });
    expect(copy.prepare("SELECT COUNT(*) AS c FROM clients").get()).toEqual({ c: 1 });
    copy.close();
  });

  it("prunes to the retention count, dropping the oldest", async () => {
    const dir = join(ctx.dir, "backups");
    await runBackup(ctx.db, dir, "2026-01-01", 2);
    await runBackup(ctx.db, dir, "2026-01-02", 2);
    await runBackup(ctx.db, dir, "2026-01-03", 2);

    const files = readdirSync(dir).filter((f) => f.startsWith("timup-")).sort();
    expect(files).toEqual(["timup-2026-01-02.db", "timup-2026-01-03.db"]);
  });
});
