import { DateTime } from "luxon";

/**
 * Derive the billable local date (YYYY-MM-DD) for a UTC instant in a given
 * IANA timezone. Cross-midnight sessions are attributed to their START day,
 * so callers pass the session's started_at here.
 *
 * Uses Luxon (bundled IANA data) so DST transitions and the host's ICU build
 * do not silently shift the billing day.
 */
export function localDateOf(epochMs: number, tz: string): string {
  const dt = DateTime.fromMillis(epochMs, { zone: tz });
  if (!dt.isValid) {
    throw new Error(`Invalid timezone or instant: tz=${tz} reason=${dt.invalidReason}`);
  }
  return dt.toFormat("yyyy-LL-dd");
}

/** Whether a timezone identifier is valid/known to Luxon. */
export function isValidTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}
