import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadConfig, type BrainConfig } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { runBackup } from "./services/backup.js";
import { purgeExpiredEntries } from "./services/entry.js";
import { buildServer } from "./api/server.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Best-effort PID lockfile. The authoritative single-instance guarantee is the
 * loopback port bind below (EADDRINUSE => another brain owns this dataDir); this
 * lockfile just catches the case where the port is momentarily free but a sibling
 * process is alive.
 */
function acquirePidLock(config: BrainConfig): void {
  if (existsSync(config.lockPath)) {
    const pid = Number(readFileSync(config.lockPath, "utf8").trim());
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0); // throws if the process is gone
        console.error(`[timup] another brain is running (pid ${pid}). Exiting.`);
        process.exit(1);
      } catch {
        // Stale lock — owner is dead; overwrite below.
      }
    }
  }
  writeFileSync(config.lockPath, String(process.pid), { mode: 0o600 });
}

async function main(): Promise<void> {
  const config = loadConfig();
  acquirePidLock(config);

  const db = openDatabase(config);
  const app = buildServer({ db, config });

  const cleanup = () => {
    try {
      rmSync(config.lockPath, { force: true });
    } catch {
      /* ignore */
    }
    try {
      db.close();
    } catch {
      /* ignore */
    }
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") {
      console.error(
        `[timup] 127.0.0.1:${config.port} is in use — another brain owns this data dir. Exiting.`,
      );
    } else {
      console.error("[timup] failed to start:", err);
    }
    cleanup();
    process.exit(1);
  }

  console.error(
    `[timup] brain listening on http://${config.host}:${config.port} (db: ${config.dbPath})`,
  );

  // Automatic daily SQLite snapshot (online backup, kept to config.backupKeep).
  const backup = () => {
    const date = new Date().toISOString().slice(0, 10);
    runBackup(db, config.backupDir, date, config.backupKeep)
      .then((path) => console.error(`[timup] backup -> ${path}`))
      .catch((err) => console.error("[timup] backup failed:", err));
  };
  backup();
  setInterval(backup, DAY_MS).unref();

  // Permanently purge entries that have sat in the trash past the retention window.
  const purgeTrash = () => {
    try {
      const cutoff = Date.now() - config.trashKeepDays * DAY_MS;
      const n = purgeExpiredEntries(db, cutoff);
      if (n > 0) console.error(`[timup] purged ${n} expired trash entr${n === 1 ? "y" : "ies"}`);
    } catch (err) {
      console.error("[timup] trash purge failed:", err);
    }
  };
  purgeTrash();
  setInterval(purgeTrash, DAY_MS).unref();
}

void main();
