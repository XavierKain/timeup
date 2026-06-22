/**
 * Billing rounding. Increments are expressed in minutes (0/6/10/15 typical).
 * Time is rounded UP to the nearest increment (standard billing convention),
 * applied only at invoice-prep time — raw seconds are never mutated.
 */
export function roundSecondsUp(seconds: number, incrementMinutes: number): number {
  if (incrementMinutes <= 0) return seconds;
  const inc = incrementMinutes * 60;
  return Math.ceil(seconds / inc) * inc;
}

/** Whole + fractional hours, rounded to 2 decimals, for display. */
export function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100;
}
