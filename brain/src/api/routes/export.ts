import type { FastifyInstance } from "fastify";
import type { EntryFilters } from "../../contracts/entries.js";
import { exportEntriesCsv, exportJson } from "../../services/export.js";
import type { Deps } from "../server.js";

function parseFilters(q: Record<string, string>): EntryFilters {
  const int = (v: string | undefined) => (v !== undefined ? Number(v) : undefined);
  return {
    clientId: int(q.clientId),
    projectId: int(q.projectId),
    from: q.from,
    to: q.to,
    tag: q.tag,
    q: q.q,
    billed: q.billed === undefined ? undefined : q.billed === "true" || q.billed === "1",
  };
}

export function registerExportRoutes(app: FastifyInstance, { db }: Deps): void {
  app.get("/export/entries.csv", async (req, reply) => {
    const csv = exportEntriesCsv(db, parseFilters(req.query as Record<string, string>));
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="timup-entries.csv"');
    return csv;
  });

  app.get("/export/data.json", async () => exportJson(db));
}
