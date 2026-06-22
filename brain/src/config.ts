import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Version of the SQLite schema. Bumped whenever db/schema.sql changes in a way
 * that requires a migration. Surfaced via PRAGMA user_version and GET /health.
 */
export const SCHEMA_VERSION = 4;

/** Application version (kept in sync with package.json manually for now). */
export const APP_VERSION = "0.1.0";

/** Default timezone used to derive an entry's billable local_date. */
const DEFAULT_TZ = "Europe/Paris";

/** Default loopback port for the brain HTTP API. */
const DEFAULT_PORT = 47823;

export interface BrainConfig {
  dataDir: string;
  dbPath: string;
  lockPath: string;
  backupDir: string;
  backupKeep: number;
  /** Timer stops shorter than this are auto-discarded (no entry written). */
  minEntrySeconds: number;
  /** Trashed entries are kept this many days before being purged permanently. */
  trashKeepDays: number;
  host: string;
  port: number;
  token: string;
  tz: string;
  appVersion: string;
  schemaVersion: number;
}

export interface ConfigOverrides {
  dataDir?: string;
  port?: number;
  tz?: string;
  token?: string;
  minEntrySeconds?: number;
}

function defaultDataDir(): string {
  if (process.env.TIMUP_DATA_DIR) return process.env.TIMUP_DATA_DIR;
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return join(xdg, "timup");
  return join(homedir(), ".local", "share", "timup");
}

interface PersistedConfig {
  token: string;
}

/**
 * Read the persisted token from <dataDir>/config.json, generating and writing a
 * fresh one (0600) on first run. The token gates every API route except /health.
 */
function loadOrCreateToken(dataDir: string): string {
  const configPath = join(dataDir, "config.json");
  if (existsSync(configPath)) {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as PersistedConfig;
    if (parsed.token && typeof parsed.token === "string") return parsed.token;
  }
  const token = randomBytes(32).toString("hex");
  const payload: PersistedConfig = { token };
  writeFileSync(configPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  return token;
}

/**
 * Resolve the full brain configuration. Overrides are primarily for tests
 * (isolated dataDir/port/tz). The data directory is created if missing.
 */
export function loadConfig(overrides: ConfigOverrides = {}): BrainConfig {
  const dataDir = overrides.dataDir ?? defaultDataDir();
  mkdirSync(dataDir, { recursive: true });

  const token = overrides.token ?? loadOrCreateToken(dataDir);
  const port =
    overrides.port ??
    (process.env.TIMUP_PORT ? Number(process.env.TIMUP_PORT) : DEFAULT_PORT);
  const tz = overrides.tz ?? process.env.TIMUP_TZ ?? DEFAULT_TZ;
  const backupKeep = process.env.TIMUP_BACKUP_KEEP ? Number(process.env.TIMUP_BACKUP_KEEP) : 14;
  const minEntry =
    overrides.minEntrySeconds ??
    (process.env.TIMUP_MIN_ENTRY_SECONDS ? Number(process.env.TIMUP_MIN_ENTRY_SECONDS) : 120);
  const trashKeep = process.env.TIMUP_TRASH_KEEP_DAYS ? Number(process.env.TIMUP_TRASH_KEEP_DAYS) : 30;

  return {
    dataDir,
    dbPath: join(dataDir, "timup.db"),
    lockPath: join(dataDir, "brain.lock"),
    backupDir: process.env.TIMUP_BACKUP_DIR ?? join(dataDir, "backups"),
    backupKeep: Number.isFinite(backupKeep) && backupKeep > 0 ? Math.floor(backupKeep) : 14,
    minEntrySeconds: Number.isFinite(minEntry) && minEntry >= 0 ? Math.floor(minEntry) : 120,
    trashKeepDays: Number.isFinite(trashKeep) && trashKeep > 0 ? Math.floor(trashKeep) : 30,
    host: "127.0.0.1",
    port,
    token,
    tz,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
  };
}
