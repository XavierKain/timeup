import { z } from "zod";

export const startTimerSchema = z.object({
  projectId: z.number().int().positive(),
});
export type StartTimerBody = z.infer<typeof startTimerSchema>;

export const stopTimerSchema = z.object({
  description: z.string().optional(),
  tag: z.string().optional(),
  /** Optional client-supplied id making stop idempotent across retries. */
  requestId: z.string().min(1).optional(),
});
export type StopTimerBody = z.infer<typeof stopTimerSchema>;

export const recoverTimerSchema = z.object({
  strategy: z.enum(["discard", "stop-at-last-activity"]),
});
export type RecoverTimerBody = z.infer<typeof recoverTimerSchema>;

export const reassignTimerSchema = z.object({
  projectId: z.number().int().positive(),
});
export type ReassignTimerBody = z.infer<typeof reassignTimerSchema>;

/** Backdate the running timer's start to count work done before you hit start. */
export const addTimeSchema = z.object({
  minutes: z.number().positive(),
});
export type AddTimeBody = z.infer<typeof addTimeSchema>;

/** Set (or clear, via empty string) the running timer's live description. */
export const setDescriptionSchema = z.object({
  description: z.string(),
});
export type SetDescriptionBody = z.infer<typeof setDescriptionSchema>;

export const segmentDtoSchema = z.object({
  startAt: z.number().int(),
  endAt: z.number().int(),
});

export const entryDtoSchema = z.object({
  id: z.number().int(),
  projectId: z.number().int(),
  startedAt: z.number().int(),
  endedAt: z.number().int(),
  rawSeconds: z.number().int(),
  idleSeconds: z.number().int(),
  durationSeconds: z.number().int(),
  tz: z.string(),
  localDate: z.string(),
  description: z.string().nullable(),
  tag: z.string().nullable(),
  billed: z.boolean(),
  source: z.enum(["timer", "manual"]),
  segments: z.array(segmentDtoSchema),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable().optional(), // ms UTC when trashed; absent/null = live
});
export type EntryDTO = z.infer<typeof entryDtoSchema>;

const liveSegmentDtoSchema = z.object({
  startAt: z.number().int(),
  endAt: z.number().int().nullable(),
});

export const timerStateDtoSchema = z.discriminatedUnion("running", [
  z.object({ running: z.literal(false) }),
  z.object({
    running: z.literal(true),
    projectId: z.number().int(),
    startedAt: z.number().int(),
    tz: z.string(),
    paused: z.boolean(),
    elapsedRawSeconds: z.number().int(),
    elapsedActiveSeconds: z.number().int(),
    segments: z.array(liveSegmentDtoSchema),
    description: z.string().nullable(),
  }),
]);
export type TimerStateDTO = z.infer<typeof timerStateDtoSchema>;

export const healthDtoSchema = z.object({
  status: z.literal("ok"),
  appVersion: z.string(),
  schemaVersion: z.number().int(),
  dbPath: z.string(),
});
export type HealthDTO = z.infer<typeof healthDtoSchema>;
