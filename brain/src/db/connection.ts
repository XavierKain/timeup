import Database from "better-sqlite3";
import type { BrainConfig } from "../config.js";
import { migrate } from "./migrate.js";

/**
 * Open the SQLite database owned by the brain and apply pragmas + schema.
 *
 * Single-writer is guaranteed at the process level by the HTTP port bind in
 * the service entrypoint (EADDRINUSE => another brain owns this dataDir).
 * This function intentionally does no instance-locking so it stays reusable
 * by tests (which open isolated temp databases).
 */
export function openDatabase(config: BrainConfig): Database.Database {
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}
