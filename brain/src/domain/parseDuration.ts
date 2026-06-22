/**
 * Tolerant duration parsing → seconds. Accepts the formats found in the user's
 * Excel and common time-tracker conventions:
 *
 *   "1:02"   -> 1h02            (h:mm)
 *   "1h02"   -> 1h02
 *   "1h"     -> 1h
 *   "90m"    -> 90 minutes
 *   "45min"  -> 45 minutes
 *   "0.5h"   -> 0.5 hour
 *   "1.5"    -> 1.5 hours       (bare number defaults to HOURS)
 *   "30s"    -> 30 seconds
 *
 * Returns whole seconds. Throws on unparseable / negative input.
 */
export function parseDurationToSeconds(input: string): number {
  const raw = input.trim().toLowerCase().replace(",", ".");
  if (raw === "") throw new Error("empty duration");

  let m: RegExpMatchArray | null;

  // h:mm
  if ((m = raw.match(/^(\d+):([0-5]?\d)$/))) {
    return Number(m[1]) * 3600 + Number(m[2]) * 60;
  }
  // XhYY or Xh
  if ((m = raw.match(/^(\d+)\s*h\s*([0-5]?\d)?$/))) {
    return Number(m[1]) * 3600 + (m[2] ? Number(m[2]) * 60 : 0);
  }
  // decimal hours with explicit h
  if ((m = raw.match(/^(\d*\.?\d+)\s*h$/))) {
    return Math.round(Number(m[1]) * 3600);
  }
  // minutes
  if ((m = raw.match(/^(\d*\.?\d+)\s*m(in)?$/))) {
    return Math.round(Number(m[1]) * 60);
  }
  // seconds
  if ((m = raw.match(/^(\d+)\s*s$/))) {
    return Number(m[1]);
  }
  // bare number => hours
  if ((m = raw.match(/^(\d*\.?\d+)$/))) {
    return Math.round(Number(m[1]) * 3600);
  }

  throw new Error(`unparseable duration: "${input}"`);
}

/** Resolve a duration from either explicit seconds or a tolerant string. */
export function resolveDurationSeconds(opts: {
  durationSeconds?: number;
  duration?: string;
}): number {
  if (opts.durationSeconds !== undefined) {
    if (!Number.isFinite(opts.durationSeconds) || opts.durationSeconds < 0) {
      throw new Error("durationSeconds must be >= 0");
    }
    return Math.round(opts.durationSeconds);
  }
  if (opts.duration !== undefined) return parseDurationToSeconds(opts.duration);
  throw new Error("provide durationSeconds or duration");
}
