import { describe, expect, it } from "vitest";
import { isValidTimezone, localDateOf } from "../../src/domain/localdate.js";

const PARIS = "Europe/Paris";

describe("localDateOf (Europe/Paris)", () => {
  it("winter (CET, UTC+1): 22:30Z is still the same day", () => {
    expect(localDateOf(Date.UTC(2026, 0, 15, 22, 30), PARIS)).toBe("2026-01-15");
  });

  it("uses the timezone, not UTC: 23:30Z winter rolls to the next Paris day", () => {
    // UTC date is the 15th, but Paris local is 00:30 on the 16th.
    expect(localDateOf(Date.UTC(2026, 0, 15, 23, 30), PARIS)).toBe("2026-01-16");
  });

  it("summer (CEST, UTC+2): 21:30Z is still the same day", () => {
    expect(localDateOf(Date.UTC(2026, 6, 15, 21, 30), PARIS)).toBe("2026-07-15");
  });

  it("summer: 22:30Z rolls to the next Paris day", () => {
    expect(localDateOf(Date.UTC(2026, 6, 15, 22, 30), PARIS)).toBe("2026-07-16");
  });

  it("spring-forward day (2026-03-29) is dated correctly", () => {
    expect(localDateOf(Date.UTC(2026, 2, 29, 10, 0), PARIS)).toBe("2026-03-29");
  });

  it("fall-back day (2026-10-25) is dated correctly", () => {
    expect(localDateOf(Date.UTC(2026, 9, 25, 11, 0), PARIS)).toBe("2026-10-25");
  });

  it("rejects an invalid timezone", () => {
    expect(() => localDateOf(Date.now(), "Not/AZone")).toThrow();
  });
});

describe("isValidTimezone", () => {
  it("accepts known zones and rejects garbage", () => {
    expect(isValidTimezone("Europe/Paris")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
  });
});
