import type { FastifyInstance } from "fastify";
import {
  addTimeSchema,
  reassignTimerSchema,
  recoverTimerSchema,
  setDescriptionSchema,
  startTimerSchema,
  stopTimerSchema,
} from "../../contracts/timer.js";
import {
  addTimeToTimer,
  discardTimer,
  getTimerState,
  lastActiveProject,
  pauseTimer,
  reassignTimer,
  recoverTimer,
  resumeKeepingIdle,
  resumeTimer,
  runningDurationSeconds,
  setTimerDescription,
  startTimer,
  stopTimer,
} from "../../services/timer.js";
import { parseBody, type Deps } from "../server.js";

export function registerTimerRoutes(app: FastifyInstance, { db, config }: Deps): void {
  app.get("/timer", async () => getTimerState(db));

  app.post("/timer/start", async (req, reply) => {
    const body = parseBody(startTimerSchema, req.body);
    const state = startTimer(db, config.tz, body.projectId);
    reply.status(201);
    return state;
  });

  app.post("/timer/pause", async () => pauseTimer(db));

  // `keepIdle: true` reopens the last segment so the away time counts (idle
  // prompt "garder"); otherwise a normal resume excludes the gap ("retirer").
  app.post("/timer/resume", async (req) => {
    const keepIdle = (req.body as { keepIdle?: boolean } | null)?.keepIdle === true;
    return keepIdle ? resumeKeepingIdle(db) : resumeTimer(db);
  });

  app.post("/timer/stop", async (req, reply) => {
    const body = parseBody(stopTimerSchema, req.body);
    // Auto-discard a too-short timer (no entry). Skip when replaying a stop by
    // requestId, which has its own idempotent path in stopTimer.
    if (config.minEntrySeconds > 0 && !body.requestId) {
      const dur = runningDurationSeconds(db);
      if (dur !== null && dur < config.minEntrySeconds) {
        discardTimer(db);
        reply.status(200);
        return { discarded: true, reason: "too_short", durationSeconds: dur };
      }
    }
    const entry = stopTimer(db, body);
    reply.status(201);
    return entry;
  });

  app.post("/timer/discard", async () => {
    discardTimer(db);
    return { discarded: true };
  });

  app.post("/timer/reassign", async (req) => {
    const body = parseBody(reassignTimerSchema, req.body);
    return reassignTimer(db, body.projectId);
  });

  app.post("/timer/description", async (req) => {
    const body = parseBody(setDescriptionSchema, req.body);
    return setTimerDescription(db, body.description);
  });

  app.get("/timer/last", async () => lastActiveProject(db) ?? { projectId: null });

  app.post("/timer/add", async (req) => {
    const body = parseBody(addTimeSchema, req.body);
    return addTimeToTimer(db, body.minutes * 60);
  });

  app.post("/timer/recover", async (req) => {
    const body = parseBody(recoverTimerSchema, req.body);
    const entry = recoverTimer(db, body.strategy);
    return { recovered: body.strategy, entry };
  });
}
