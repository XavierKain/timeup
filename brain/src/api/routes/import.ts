import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { importWorkbook } from "../../services/import.js";
import { parseBody, type Deps } from "../server.js";

const importSchema = z.object({
  path: z.string().min(1),
  dryRun: z.boolean().optional(),
});

export function registerImportRoutes(app: FastifyInstance, { db, config }: Deps): void {
  app.post("/import", async (req) => {
    const body = parseBody(importSchema, req.body);
    return importWorkbook(db, body.path, { tz: config.tz, dryRun: body.dryRun });
  });
}
