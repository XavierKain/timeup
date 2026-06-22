import type { InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authHeaders, makeApp, type AppContext } from "../helpers.js";

let ctx: AppContext;
beforeEach(async () => {
  ctx = await makeApp();
});
afterEach(() => ctx.cleanup());

type Payload = InjectOptions["payload"];

function post(url: string, payload: Payload) {
  return ctx.app.inject({ method: "POST", url, headers: authHeaders, payload });
}
function patch(url: string, payload: Payload) {
  return ctx.app.inject({ method: "PATCH", url, headers: authHeaders, payload });
}
function get(url: string) {
  return ctx.app.inject({ method: "GET", url, headers: authHeaders });
}

describe("catalog CRUD", () => {
  it("creates, lists, gets and updates clients", async () => {
    const created = await post("/clients", { name: "Acmeo", notes: "web" });
    const id = created.json().id;

    expect((await get("/clients")).json()).toHaveLength(1);
    expect((await get(`/clients/${id}`)).json().name).toBe("Acmeo");

    const updated = await patch(`/clients/${id}`, { name: "Acmeo SAS" });
    expect(updated.json().name).toBe("Acmeo SAS");
  });

  it("archives clients out of the default list", async () => {
    const a = (await post("/clients", { name: "A" })).json();
    await post("/clients", { name: "B" });
    await patch(`/clients/${a.id}`, { archived: true });

    expect((await get("/clients")).json()).toHaveLength(1);
    expect((await get("/clients?includeArchived=true")).json()).toHaveLength(2);
  });

  it("creates and filters projects by client", async () => {
    const c1 = (await post("/clients", { name: "C1" })).json();
    const c2 = (await post("/clients", { name: "C2" })).json();
    await post("/projects", { clientId: c1.id, name: "P1", mode: "forfait" });
    await post("/projects", { clientId: c2.id, name: "P2", mode: "horaire", hourlyRate: 90 });

    expect((await get(`/projects?clientId=${c1.id}`)).json()).toHaveLength(1);
    expect((await get("/projects")).json()).toHaveLength(2);

    const p2 = (await get(`/projects?clientId=${c2.id}`)).json()[0];
    expect(p2.hourlyRate).toBe(90);
  });

  it("rejects a project on an unknown client (404)", async () => {
    const res = await post("/projects", { clientId: 999, name: "X", mode: "forfait" });
    expect(res.statusCode).toBe(404);
  });

  it("reassigns a project to another client", async () => {
    const c1 = (await post("/clients", { name: "C1" })).json();
    const c2 = (await post("/clients", { name: "C2" })).json();
    const p = (await post("/projects", { clientId: c1.id, name: "P", mode: "horaire" })).json();

    const moved = await patch(`/projects/${p.id}`, { clientId: c2.id });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().clientId).toBe(c2.id);
    expect((await get(`/projects?clientId=${c2.id}`)).json()).toHaveLength(1);
    expect((await get(`/projects?clientId=${c1.id}`)).json()).toHaveLength(0);
  });

  it("rejects reassigning a project to an unknown client (404)", async () => {
    const c = (await post("/clients", { name: "C" })).json();
    const p = (await post("/projects", { clientId: c.id, name: "P", mode: "forfait" })).json();
    const res = await patch(`/projects/${p.id}`, { clientId: 999 });
    expect(res.statusCode).toBe(404);
  });

  it("validates empty update bodies", async () => {
    const c = (await post("/clients", { name: "C" })).json();
    const res = await patch(`/clients/${c.id}`, {});
    expect(res.statusCode).toBe(400);
  });

  it("archiving a client cascades to its projects (and unarchiving restores them)", async () => {
    const c = (await post("/clients", { name: "Acme" })).json();
    const p = (await post("/projects", { clientId: c.id, name: "Site", mode: "horaire" })).json();

    await patch(`/clients/${c.id}`, { archived: true });
    // Project is archived too → hidden from the default list, never orphaned.
    expect((await get("/projects")).json()).toHaveLength(0);
    const archived = (await get("/projects?includeArchived=true")).json();
    expect(archived).toHaveLength(1);
    expect(archived[0].archived).toBe(true);
    expect(archived[0].clientId).toBe(c.id); // still linked

    await patch(`/clients/${c.id}`, { archived: false });
    const back = (await get("/projects")).json();
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe(p.id);
    expect(back[0].archived).toBe(false);
  });

  it("marks a project completed and hides it from the timer picker", async () => {
    const c = (await post("/clients", { name: "C" })).json();
    const live = (await post("/projects", { clientId: c.id, name: "Live", mode: "horaire" })).json();
    const done = (await post("/projects", { clientId: c.id, name: "Done", mode: "prix_fixe", fixedPrice: 1000 })).json();
    expect(live.completed).toBe(false);

    const upd = await patch(`/projects/${done.id}`, { completed: true });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().completed).toBe(true);

    // Default list still shows both; the timer picker (excludeCompleted) drops the finished one.
    expect((await get("/projects")).json()).toHaveLength(2);
    const active = (await get("/projects?excludeCompleted=true")).json();
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe("Live");
  });
});
