import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type BrainConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/connection.js";
import { startTimer, getTimerState } from "../../src/services/timer.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedProject } from "../helpers.js";

let dir: string;
let config: BrainConfig;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "timup-persist-"));
  config = loadConfig({ dataDir: dir, port: 0, tz: "Europe/Paris", token: "t" });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("timer state persistence across restart", () => {
  it("a running timer survives closing and reopening the database", () => {
    const t0 = Date.UTC(2026, 0, 15, 9, 0);

    // First "process": start a timer, then close the connection (simulate exit).
    const db1 = openDatabase(config);
    const projectId = seedProject(db1);
    startTimer(db1, config.tz, projectId, t0);
    db1.close();

    // Second "process": reopen the same database file.
    const db2 = openDatabase(config);
    const state = getTimerState(db2, t0 + 4 * 60_000);
    expect(state.running).toBe(true);
    expect(state.running && state.projectId).toBe(projectId);
    expect(state.running && state.elapsedActiveSeconds).toBe(240);
    db2.close();
  });
});
