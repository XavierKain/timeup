import type DatabaseT from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { loadConfig, type BrainConfig, type ConfigOverrides } from "../src/config.js";
import { openDatabase } from "../src/db/connection.js";
import { buildServer } from "../src/api/server.js";

export const TEST_TOKEN = "test-token";

export interface TestContext {
  db: DatabaseT.Database;
  config: BrainConfig;
  dir: string;
  cleanup: () => void;
}

export function makeContext(overrides: ConfigOverrides = {}): TestContext {
  const dir = mkdtempSync(join(tmpdir(), "timup-test-"));
  const config = loadConfig({
    dataDir: dir,
    port: 0,
    tz: "Europe/Paris",
    token: TEST_TOKEN,
    minEntrySeconds: 0, // tests stop near-zero timers and expect entries
    ...overrides,
  });
  const db = openDatabase(config);
  return {
    db,
    config,
    dir,
    cleanup: () => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface AppContext extends TestContext {
  app: FastifyInstance;
}

export async function makeApp(overrides: ConfigOverrides = {}): Promise<AppContext> {
  const ctx = makeContext(overrides);
  const app = buildServer({ db: ctx.db, config: ctx.config });
  await app.ready();
  return {
    ...ctx,
    app,
    cleanup: () => {
      void app.close();
      ctx.cleanup();
    },
  };
}

export const authHeaders = { authorization: `Bearer ${TEST_TOKEN}` };

type Payload = import("fastify").InjectOptions["payload"];

/** Authenticated HTTP helpers bound to a Fastify instance (for integration tests). */
export function httpClient(app: FastifyInstance) {
  return {
    post: (url: string, payload?: Payload) =>
      app.inject({ method: "POST", url, headers: authHeaders, payload }),
    patch: (url: string, payload?: Payload) =>
      app.inject({ method: "PATCH", url, headers: authHeaders, payload }),
    del: (url: string) => app.inject({ method: "DELETE", url, headers: authHeaders }),
    get: (url: string) => app.inject({ method: "GET", url, headers: authHeaders }),
  };
}

/** Seed a client + project directly via SQL, returning the project id. */
export function seedProject(
  db: DatabaseT.Database,
  mode: "forfait" | "horaire" | "prix_fixe" = "horaire",
): number {
  const now = Date.now();
  const client = db
    .prepare(
      "INSERT INTO clients (name, archived, created_at, updated_at) VALUES ('Acme', 0, ?, ?)",
    )
    .run(now, now);
  const project = db
    .prepare(
      "INSERT INTO projects (client_id, name, mode, archived, created_at, updated_at) VALUES (?, 'Site', ?, 0, ?, ?)",
    )
    .run(Number(client.lastInsertRowid), mode, now, now);
  return Number(project.lastInsertRowid);
}
