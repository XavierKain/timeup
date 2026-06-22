import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authHeaders, makeApp, type AppContext } from "../helpers.js";

let ctx: AppContext;

beforeEach(async () => {
  ctx = await makeApp();
});
afterEach(() => ctx.cleanup());

describe("HTTP API", () => {
  it("GET /health needs no auth and exposes schema version", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.schemaVersion).toBe(ctx.config.schemaVersion);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/timer" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("accepts authenticated requests", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/timer", headers: authHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.json().running).toBe(false);
  });

  it("validates request bodies (400)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/clients",
      headers: authHeaders,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("runs the full capture flow over HTTP", async () => {
    const client = await ctx.app.inject({
      method: "POST",
      url: "/clients",
      headers: authHeaders,
      payload: { name: "Acme" },
    });
    expect(client.statusCode).toBe(201);

    const project = await ctx.app.inject({
      method: "POST",
      url: "/projects",
      headers: authHeaders,
      payload: { clientId: client.json().id, name: "Site", mode: "horaire" },
    });
    expect(project.statusCode).toBe(201);
    const projectId = project.json().id;

    const start = await ctx.app.inject({
      method: "POST",
      url: "/timer/start",
      headers: authHeaders,
      payload: { projectId },
    });
    expect(start.statusCode).toBe(201);
    expect(start.json().running).toBe(true);

    const status = await ctx.app.inject({ method: "GET", url: "/timer", headers: authHeaders });
    expect(status.json().running).toBe(true);
    expect(status.json().projectId).toBe(projectId);

    const stop = await ctx.app.inject({
      method: "POST",
      url: "/timer/stop",
      headers: authHeaders,
      payload: { description: "first task" },
    });
    expect(stop.statusCode).toBe(201);
    const entry = stop.json();
    expect(entry.projectId).toBe(projectId);
    expect(entry.source).toBe("timer");
    expect(entry.description).toBe("first task");
    expect(entry.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it("auto-discards a timer shorter than minEntrySeconds (no entry written)", async () => {
    const app2 = await makeApp({ minEntrySeconds: 120 });
    try {
      const c = await app2.app.inject({ method: "POST", url: "/clients", headers: authHeaders, payload: { name: "A" } });
      const p = await app2.app.inject({
        method: "POST", url: "/projects", headers: authHeaders,
        payload: { clientId: c.json().id, name: "P", mode: "horaire" },
      });
      await app2.app.inject({ method: "POST", url: "/timer/start", headers: authHeaders, payload: { projectId: p.json().id } });
      const stop = await app2.app.inject({ method: "POST", url: "/timer/stop", headers: authHeaders, payload: {} });
      expect(stop.statusCode).toBe(200);
      expect(stop.json().discarded).toBe(true);
      expect((await app2.app.inject({ method: "GET", url: "/entries", headers: authHeaders })).json()).toHaveLength(0);
      expect((await app2.app.inject({ method: "GET", url: "/timer", headers: authHeaders })).json().running).toBe(false);
    } finally {
      app2.cleanup();
    }
  });

  it("returns 409 when stopping with no running timer", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/timer/stop",
      headers: authHeaders,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NO_RUNNING_TIMER");
  });

  it("returns 409 when starting a second timer", async () => {
    const projectId = (() => {
      const c = ctx.db
        .prepare("INSERT INTO clients (name, archived, created_at, updated_at) VALUES ('X',0,0,0)")
        .run();
      const p = ctx.db
        .prepare(
          "INSERT INTO projects (client_id, name, mode, archived, created_at, updated_at) VALUES (?, 'P', 'horaire', 0, 0, 0)",
        )
        .run(Number(c.lastInsertRowid));
      return Number(p.lastInsertRowid);
    })();

    await ctx.app.inject({
      method: "POST",
      url: "/timer/start",
      headers: authHeaders,
      payload: { projectId },
    });
    const second = await ctx.app.inject({
      method: "POST",
      url: "/timer/start",
      headers: authHeaders,
      payload: { projectId },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("TIMER_ALREADY_RUNNING");
  });
});
