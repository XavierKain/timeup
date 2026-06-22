import type { FastifyInstance } from "fastify";
import { createRechargeSchema, updateRechargeSchema } from "../../contracts/billing.js";
import { AppError } from "../../contracts/common.js";
import {
  createRecharge,
  deleteRecharge,
  forfaitSummary,
  hourlySummary,
  listAllRecharges,
  listRecharges,
  profitabilitySummary,
  projectStats,
  updateRecharge,
} from "../../services/billing.js";
import { parseBody, type Deps } from "../server.js";

function intParam(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError("VALIDATION_ERROR", "Invalid id");
  return n;
}

export function registerBillingRoutes(app: FastifyInstance, { db }: Deps): void {
  app.post("/recharges", async (req, reply) => {
    const recharge = createRecharge(db, parseBody(createRechargeSchema, req.body));
    reply.status(201);
    return recharge;
  });

  app.get("/recharges", async () => listAllRecharges(db));

  app.get("/projects/:id/recharges", async (req) => {
    return listRecharges(db, intParam((req.params as { id: string }).id));
  });

  app.patch("/recharges/:id", async (req) => {
    const id = intParam((req.params as { id: string }).id);
    return updateRecharge(db, id, parseBody(updateRechargeSchema, req.body));
  });

  app.delete("/recharges/:id", async (req, reply) => {
    deleteRecharge(db, intParam((req.params as { id: string }).id));
    reply.status(204);
    return null;
  });

  app.get("/projects/:id/stats", async (req) => {
    return projectStats(db, intParam((req.params as { id: string }).id));
  });

  app.get("/summary/forfaits", async () => forfaitSummary(db));
  app.get("/summary/profitability", async () => profitabilitySummary(db));
  app.get("/summary/hourly", async () => hourlySummary(db));
}
