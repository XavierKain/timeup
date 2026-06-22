import type { FastifyInstance } from "fastify";
import type { Deps } from "../server.js";
import type { HealthDTO } from "../../contracts/timer.js";

export function registerHealthRoutes(app: FastifyInstance, { config }: Deps): void {
  app.get("/health", async (): Promise<HealthDTO> => {
    return {
      status: "ok",
      appVersion: config.appVersion,
      schemaVersion: config.schemaVersion,
      dbPath: config.dbPath,
    };
  });
}
