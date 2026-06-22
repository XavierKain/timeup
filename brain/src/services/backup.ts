import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type DatabaseT from "better-sqlite3";

const BACKUP_RE = /^timup-\d{4}-\d{2}-\d{2}\.db$/;

/**
 * Write an online snapshot of the database to `<backupDir>/timup-<date>.db`
 * (one file per day — re-running the same day overwrites it), then prune to the
 * `keep` most recent dated backups.
 *
 * Uses better-sqlite3's online backup API, which is safe to run while the brain
 * is live (WAL-aware, no need to stop writes). Returns the snapshot path.
 */
export async function runBackup(
  db: DatabaseT.Database,
  backupDir: string,
  date: string,
  keep: number,
): Promise<string> {
  mkdirSync(backupDir, { recursive: true });
  const dest = join(backupDir, `timup-${date}.db`);
  await db.backup(dest);

  // Retention: dated filenames sort chronologically, so drop the oldest first.
  const files = readdirSync(backupDir).filter((f) => BACKUP_RE.test(f)).sort();
  while (files.length > keep) {
    const old = files.shift()!;
    rmSync(join(backupDir, old), { force: true });
  }
  return dest;
}
