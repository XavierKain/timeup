import type DatabaseT from "better-sqlite3";
import { readFileSync } from "node:fs";
import { SCHEMA_VERSION } from "../config.js";

const schemaSql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

/**
 * Apply the schema and record the schema version via PRAGMA user_version.
 * Greenfield: a single version. Future schema changes append migration steps
 * guarded by the current user_version.
 */
export function migrate(db: DatabaseT.Database): void {
  let current = db.pragma("user_version", { simple: true }) as number;

  if (current === 0) {
    db.exec(schemaSql);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
    return;
  }

  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${current} is newer than this brain supports (${SCHEMA_VERSION}). Upgrade Timup.`,
    );
  }

  // Incremental step migrations from the on-disk version up to SCHEMA_VERSION.
  // Each step bumps user_version so a half-applied upgrade is never re-run.
  if (current < 2) {
    // v2 — soft-delete: deleting an entry moves it to a restorable trash
    // (deleted_at = ms UTC) instead of erasing it. NULL = live.
    db.exec("ALTER TABLE entries ADD COLUMN deleted_at INTEGER");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(deleted_at)");
    db.pragma("user_version = 2");
    current = 2;
  }

  if (current < 3) {
    // v3 — project "completed" flag: finished projects stay in the profitability
    // table (sorted/greyed apart) but drop out of the timer start pickers.
    db.exec("ALTER TABLE projects ADD COLUMN completed INTEGER NOT NULL DEFAULT 0");
    db.pragma("user_version = 3");
    current = 3;
  }

  if (current < 4) {
    // v4 — live description on the running timer, applied to the entry at stop.
    db.exec("ALTER TABLE timer_state ADD COLUMN description TEXT");
    db.pragma("user_version = 4");
    current = 4;
  }
}
