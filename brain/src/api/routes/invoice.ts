import type { FastifyInstance } from "fastify";
import { AppError } from "../../contracts/common.js";
import { markBilledSchema } from "../../contracts/invoice.js";
import { markEntriesBilled, prepareInvoice } from "../../services/invoice.js";
import { parseBody, type Deps } from "../server.js";

export function registerInvoiceRoutes(app: FastifyInstance, { db }: Deps): void {
  app.get("/invoice/prep", async (req) => {
    const q = req.query as Record<string, string>;
    if (!q.clientId) throw new AppError("VALIDATION_ERROR", "clientId is required");
    const clientId = Number(q.clientId);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      throw new AppError("VALIDATION_ERROR", "Invalid clientId");
    }
    return prepareInvoice(db, {
      clientId,
      from: q.from,
      to: q.to,
      roundingMinutes: q.rounding ? Number(q.rounding) : undefined,
      includeBilled: q.includeBilled === "true" || q.includeBilled === "1",
    });
  });

  app.post("/invoice/mark-billed", async (req) => {
    const body = parseBody(markBilledSchema, req.body);
    const billed = markEntriesBilled(db, body.entryIds);
    return { billed };
  });
}
