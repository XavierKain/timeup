import type { FastifyInstance } from "fastify";
import { AppError } from "../../contracts/common.js";
import type { EntryFilters } from "../../contracts/entries.js";
import {
  bulkUpdateEntriesSchema,
  createManualEntrySchema,
  entryIdsSchema,
  updateEntrySchema,
} from "../../contracts/entries.js";
import {
  bulkDeleteEntries,
  bulkUpdateEntries,
  createManualEntry,
  deleteEntry,
  getEntryById,
  listDeletedEntries,
  listEntries,
  purgeEntries,
  restoreEntries,
  updateEntry,
} from "../../services/entry.js";
import { parseBody, type Deps } from "../server.js";

function intParam(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError("VALIDATION_ERROR", "Invalid id");
  return n;
}

function parseFilters(q: Record<string, string>): EntryFilters {
  const intOr = (v: string | undefined) => (v !== undefined ? Number(v) : undefined);
  return {
    clientId: q.clientId ? intParam(q.clientId) : undefined,
    projectId: q.projectId ? intParam(q.projectId) : undefined,
    mode: q.mode === "forfait" || q.mode === "horaire" || q.mode === "prix_fixe" ? q.mode : undefined,
    from: q.from,
    to: q.to,
    tag: q.tag,
    q: q.q,
    billed: q.billed === undefined ? undefined : q.billed === "true" || q.billed === "1",
    limit: intOr(q.limit),
    offset: intOr(q.offset),
  };
}

export function registerEntryRoutes(app: FastifyInstance, { db, config }: Deps): void {
  app.post("/entries", async (req, reply) => {
    const entry = createManualEntry(db, config.tz, parseBody(createManualEntrySchema, req.body));
    reply.status(201);
    return entry;
  });

  app.get("/entries", async (req) => {
    return listEntries(db, parseFilters(req.query as Record<string, string>));
  });

  // Trash (soft-deleted entries) — kept config.trashKeepDays before auto-purge.
  app.get("/entries/trash", async () => {
    return listDeletedEntries(db);
  });

  app.post("/entries/bulk-delete", async (req) => {
    const body = parseBody(entryIdsSchema, req.body);
    return { deleted: bulkDeleteEntries(db, body.ids) };
  });

  app.post("/entries/restore", async (req) => {
    const body = parseBody(entryIdsSchema, req.body);
    return { restored: restoreEntries(db, body.ids) };
  });

  app.post("/entries/purge", async (req) => {
    const body = parseBody(entryIdsSchema, req.body);
    return { purged: purgeEntries(db, body.ids) };
  });

  app.get("/entries/:id", async (req) => {
    const id = intParam((req.params as { id: string }).id);
    const entry = getEntryById(db, id);
    if (!entry) throw new AppError("NOT_FOUND", `Entry ${id} not found`);
    return entry;
  });

  app.patch("/entries", async (req) => {
    const body = parseBody(bulkUpdateEntriesSchema, req.body);
    return { updated: bulkUpdateEntries(db, body.ids, body.patch) };
  });

  app.patch("/entries/:id", async (req) => {
    const id = intParam((req.params as { id: string }).id);
    return updateEntry(db, id, parseBody(updateEntrySchema, req.body));
  });

  app.delete("/entries/:id", async (req, reply) => {
    deleteEntry(db, intParam((req.params as { id: string }).id));
    reply.status(204);
    return null;
  });
}
