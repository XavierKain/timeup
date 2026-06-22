/**
 * Pure time math for the segment-based timer model.
 *
 * All inputs/outputs in epoch milliseconds (UTC) unless named *Seconds.
 * The billable duration is the sum of ACTIVE segments — idle is derived
 * (raw span minus active), never an opaque stored scalar.
 */

export interface Segment {
  /** epoch ms, inclusive */
  start: number;
  /** epoch ms, exclusive end */
  end: number;
}

export interface DurationResult {
  /** ended_at after clock-skew clamping (== startedAt if skew detected) */
  endedAt: number;
  /** round((endedAt - startedAt) / 1000) */
  rawSeconds: number;
  /** sum of active segment lengths, in seconds */
  durationSeconds: number;
  /** derived: rawSeconds - durationSeconds (>= 0) */
  idleSeconds: number;
  /** segments actually counted, after clip + merge (for entry_segments) */
  segments: Segment[];
  /** true when endedAt was clamped because ended < started */
  clockSkew: boolean;
}

/** Round milliseconds to whole seconds (half up). */
export function msToSeconds(ms: number): number {
  return Math.round(ms / 1000);
}

/**
 * Clip each segment to [spanStart, spanEnd], drop empty/zero-length results,
 * then sort and merge overlapping or touching segments. Defensive: callers
 * should already produce in-range, non-overlapping segments, but garbage in
 * must not produce double-counted time.
 */
export function clipAndMergeSegments(
  segments: readonly Segment[],
  spanStart: number,
  spanEnd: number,
): Segment[] {
  const clipped: Segment[] = [];
  for (const seg of segments) {
    const start = Math.max(seg.start, spanStart);
    const end = Math.min(seg.end, spanEnd);
    if (end > start) clipped.push({ start, end });
  }
  clipped.sort((a, b) => a.start - b.start);

  const merged: Segment[] = [];
  for (const seg of clipped) {
    const last = merged[merged.length - 1];
    if (last && seg.start <= last.end) {
      last.end = Math.max(last.end, seg.end);
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

/** Sum of active milliseconds across (already merged) segments. */
export function activeMs(segments: readonly Segment[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start), 0);
}

/**
 * Compute the billable duration of a session.
 *
 * @param startedAt session start (ms UTC)
 * @param endedAt   session stop (ms UTC); clamped to startedAt on clock skew
 * @param segments  active segments (open segment already closed at endedAt)
 */
export function computeDuration(
  startedAt: number,
  endedAt: number,
  segments: readonly Segment[],
): DurationResult {
  const clockSkew = endedAt < startedAt;
  const effectiveEnd = clockSkew ? startedAt : endedAt;

  const merged = clipAndMergeSegments(segments, startedAt, effectiveEnd);
  const rawSeconds = msToSeconds(effectiveEnd - startedAt);
  // active <= raw by construction; clamp guards against rounding edge cases.
  const durationSeconds = Math.min(msToSeconds(activeMs(merged)), rawSeconds);
  const idleSeconds = Math.max(0, rawSeconds - durationSeconds);

  return {
    endedAt: effectiveEnd,
    rawSeconds,
    durationSeconds,
    idleSeconds,
    segments: merged,
    clockSkew,
  };
}

/**
 * Live elapsed for a running timer (GET /timer). The open segment (end == null)
 * is counted up to `now`.
 */
export function liveElapsed(
  startedAt: number,
  now: number,
  segments: readonly { start: number; end: number | null }[],
): { rawSeconds: number; activeSeconds: number } {
  const end = Math.max(now, startedAt);
  const closed: Segment[] = segments.map((s) => ({
    start: s.start,
    end: s.end ?? end,
  }));
  const merged = clipAndMergeSegments(closed, startedAt, end);
  return {
    rawSeconds: msToSeconds(end - startedAt),
    activeSeconds: msToSeconds(activeMs(merged)),
  };
}
