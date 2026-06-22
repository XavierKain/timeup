import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeApp, TEST_TOKEN, type AppContext } from "../helpers.js";

let ctx: AppContext;
beforeEach(async () => {
  ctx = await makeApp();
});
afterEach(() => ctx.cleanup());

describe("dashboard", () => {
  it("serves the SPA at / without auth and injects the token", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<title>Timup</title>");
    expect(res.body).toContain(TEST_TOKEN);
    expect(res.body).not.toContain("__TIMUP_TOKEN__");
  });

  it("allows export via ?token= query param (browser download links)", async () => {
    const ok = await ctx.app.inject({ method: "GET", url: `/export/data.json?token=${TEST_TOKEN}` });
    expect(ok.statusCode).toBe(200);
    const denied = await ctx.app.inject({ method: "GET", url: "/export/data.json?token=wrong" });
    expect(denied.statusCode).toBe(401);
  });
});
