import { describe, expect, it } from "vitest";
import { parseDurationToSeconds, resolveDurationSeconds } from "../../src/domain/parseDuration.js";

describe("parseDurationToSeconds", () => {
  it.each([
    ["1:02", 3720],
    ["1h02", 3720],
    ["1h", 3600],
    ["2h30", 9000],
    ["90m", 5400],
    ["45min", 2700],
    ["0.5h", 1800],
    ["0,5h", 1800],
    ["1.5", 5400],
    ["2", 7200],
    ["30s", 30],
  ])("parses %s -> %d s", (input, expected) => {
    expect(parseDurationToSeconds(input)).toBe(expected);
  });

  it.each(["", "abc", "1:99", "h", "1.2.3"])("rejects %s", (input) => {
    expect(() => parseDurationToSeconds(input)).toThrow();
  });
});

describe("resolveDurationSeconds", () => {
  it("prefers explicit seconds", () => {
    expect(resolveDurationSeconds({ durationSeconds: 120 })).toBe(120);
  });
  it("falls back to string parsing", () => {
    expect(resolveDurationSeconds({ duration: "1h" })).toBe(3600);
  });
  it("throws when neither provided", () => {
    expect(() => resolveDurationSeconds({})).toThrow();
  });
});
