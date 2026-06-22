import { z } from "zod";

/** Stable error codes shared by every client. */
export const ERROR_CODES = [
  "UNAUTHORIZED",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "UNPROCESSABLE",
  "TIMER_ALREADY_RUNNING",
  "NO_RUNNING_TIMER",
  "NOT_PAUSED",
  "ALREADY_PAUSED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  UNPROCESSABLE: 422,
  TIMER_ALREADY_RUNNING: 409,
  NO_RUNNING_TIMER: 409,
  NOT_PAUSED: 409,
  ALREADY_PAUSED: 409,
  INTERNAL: 500,
};

/** Domain/transport error carrying a stable code, HTTP status, and details. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.details = details;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}
