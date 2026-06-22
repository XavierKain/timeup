import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { Deps } from "../server.js";

const html = readFileSync(new URL("../../web/dashboard.html", import.meta.url), "utf8");

/**
 * Serve the local dashboard SPA. The brain injects its own token into the page
 * so same-origin (loopback) API calls are authenticated. The page route itself
 * is unauthenticated (see the auth hook exemption in server.ts).
 */
export function registerDashboardRoutes(app: FastifyInstance, { config }: Deps): void {
  app.get("/", async (_req, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    return html.replaceAll("__TIMUP_TOKEN__", config.token);
  });
}
