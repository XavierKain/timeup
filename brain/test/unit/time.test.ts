import { describe, expect, it } from "vitest";
import {
  activeMs,
  clipAndMergeSegments,
  computeDuration,
  liveElapsed,
  msToSeconds,
} from "../../src/domain/time.js";

const S = 1000;
const M = 60 * S;

describe("msToSeconds", () => {
  it("rounds half up", () => {
    expect(msToSeconds(1499)).toBe(1);
    expect(msToSeconds(1500)).toBe(2);
    expect(msToSeconds(0)).toBe(0);
  });
});

describe("clipAndMergeSegments", () => {
  it("clips segments to the span", () => {
    const merged = clipAndMergeSegments([{ start: 0, end: 100 }], 50, 80);
    expect(merged).toEqual([{ start: 50, end: 80 }]);
  });

  it("drops zero-length and out-of-range segments", () => {
    const merged = clipAndMergeSegments(
      [
        { start: 0, end: 10 }, // before span
        { start: 50, end: 50 }, // zero length
      ],
      20,
      100,
    );
    expect(merged).toEqual([]);
  });

  it("merges overlapping and touching segments (no double count)", () => {
    const merged = clipAndMergeSegments(
      [
        { start: 0, end: 30 },
        { start: 20, end: 40 }, // overlaps previous
        { start: 40, end: 50 }, // touches previous
      ],
      0,
      100,
    );
    expect(merged).toEqual([{ start: 0, end: 50 }]);
    expect(activeMs(merged)).toBe(50);
  });
});

describe("computeDuration", () => {
  it("single continuous segment => duration == raw, idle 0", () => {
    const r = computeDuration(0, 10 * M, [{ start: 0, end: 10 * M }]);
    expect(r.rawSeconds).toBe(600);
    expect(r.durationSeconds).toBe(600);
    expect(r.idleSeconds).toBe(0);
    expect(r.clockSkew).toBe(false);
  });

  it("idle is derived from gaps between segments", () => {
    // worked 0-5min, idle 5-8min, worked 8-10min => active 7min, idle 3min
    const r = computeDuration(0, 10 * M, [
      { start: 0, end: 5 * M },
      { start: 8 * M, end: 10 * M },
    ]);
    expect(r.rawSeconds).toBe(600);
    expect(r.durationSeconds).toBe(7 * 60);
    expect(r.idleSeconds).toBe(3 * 60);
    expect(r.rawSeconds - r.idleSeconds).toBe(r.durationSeconds); // audit invariant
  });

  it("clamps on clock skew (ended < started)", () => {
    const r = computeDuration(10 * M, 5 * M, [{ start: 10 * M, end: 5 * M }]);
    expect(r.clockSkew).toBe(true);
    expect(r.endedAt).toBe(10 * M);
    expect(r.rawSeconds).toBe(0);
    expect(r.durationSeconds).toBe(0);
    expect(r.idleSeconds).toBe(0);
  });

  it("idle >= span keeps duration >= 0", () => {
    const r = computeDuration(0, 5 * M, []); // no active segments at all
    expect(r.durationSeconds).toBe(0);
    expect(r.idleSeconds).toBe(300);
  });

  it("zero-duration session is allowed", () => {
    const r = computeDuration(1000, 1000, [{ start: 1000, end: 1000 }]);
    expect(r.rawSeconds).toBe(0);
    expect(r.durationSeconds).toBe(0);
  });
});

describe("liveElapsed", () => {
  it("counts the open segment up to now", () => {
    const e = liveElapsed(0, 3 * M, [{ start: 0, end: null }]);
    expect(e.rawSeconds).toBe(180);
    expect(e.activeSeconds).toBe(180);
  });

  it("excludes a paused gap (closed segment + no open segment)", () => {
    // active 0-2min, paused since 2min, now at 5min
    const e = liveElapsed(0, 5 * M, [{ start: 0, end: 2 * M }]);
    expect(e.rawSeconds).toBe(300);
    expect(e.activeSeconds).toBe(120);
  });
});
