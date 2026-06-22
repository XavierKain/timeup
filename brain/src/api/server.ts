import type DatabaseT from "better-sqlite3";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";
import type { BrainConfig } from "../config.js";
import { AppError } from "../contracts/common.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerEntryRoutes } from "./routes/entries.js";
import { registerExportRoutes } from "./routes/export.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerImportRoutes } from "./routes/import.js";
import { registerInvoiceRoutes } from "./routes/invoice.js";
import { registerTimerRoutes } from "./routes/timer.js";

export interface Deps {
  db: DatabaseT.Database;
  config: BrainConfig;
}

/** Parse + validate a request body against a Zod schema, or throw VALIDATION_ERROR. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid request body", result.error.flatten());
  }
  return result.data;
}

function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme !== "Bearer" || !value) return null;
  return value;
}

export function buildServer(deps: Deps): FastifyInstance {
  const app = Fastify({ logger: false });

  // Auth: every route except GET /health requires the local bearer token.
  const publicGet = new Set(["/health", "/"]);
  app.addHook("onRequest", async (req) => {
    if (req.method === "GET" && publicGet.has(req.url.split("?")[0]!)) return;
    // Bearer header for API clients; ?token= fallback for browser download links.
    const queryToken = (req.query as { token?: string } | undefined)?.token;
    const token = bearerToken(req) ?? queryToken ?? null;
    if (token !== deps.config.token) {
      throw new AppError("UNAUTHORIZED", "Missing or invalid token");
    }
  });

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.httpStatus).send(err.toEnvelope());
      return;
    }
    // Malformed JSON / Fastify client errors.
    if (typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 500) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: err.message },
      });
      return;
    }
    app.log.error(err);
    reply.status(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });

  registerDashboardRoutes(app, deps);
  registerHealthRoutes(app, deps);
  registerCatalogRoutes(app, deps);
  registerTimerRoutes(app, deps);
  registerBillingRoutes(app, deps);
  registerEntryRoutes(app, deps);
  registerInvoiceRoutes(app, deps);
  registerExportRoutes(app, deps);
  registerImportRoutes(app, deps);

  return app;
}
