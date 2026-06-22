import { describe, expect, it } from "vitest";
import { roundSecondsUp, secondsToHours } from "../../src/domain/rounding.js";

describe("roundSecondsUp", () => {
  it("rounds up to the increment", () => {
    expect(roundSecondsUp(1, 15)).toBe(900);
    expect(roundSecondsUp(900, 15)).toBe(900);
    expect(roundSecondsUp(901, 15)).toBe(1800);
    expect(roundSecondsUp(370, 6)).toBe(720); // 6-min increments
    expect(roundSecondsUp(601, 10)).toBe(1200);
  });
  it("no rounding when increment is 0", () => {
    expect(roundSecondsUp(637, 0)).toBe(637);
  });
  it("keeps zero at zero", () => {
    expect(roundSecondsUp(0, 15)).toBe(0);
  });
});

describe("secondsToHours", () => {
  it("converts to 2-decimal hours", () => {
    expect(secondsToHours(5400)).toBe(1.5);
    expect(secondsToHours(2700)).toBe(0.75);
  });
});
