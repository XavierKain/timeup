import { z } from "zod";

const durationFields = {
  durationSeconds: z.number().nonnegative().optional(),
  duration: z.string().min(1).optional(),
};

export const createManualEntrySchema = z
  .object({
    projectId: z.number().int().positive(),
    startedAt: z.number().int().optional(), // ms UTC, defaults to now
    description: z.string().optional(),
    tag: z.string().optional(),
    ...durationFields,
  })
  .refine((o) => o.durationSeconds !== undefined || o.duration !== undefined, {
    message: "provide durationSeconds or duration",
  });
export type CreateManualEntryBody = z.infer<typeof createManualEntrySchema>;

export const updateEntrySchema = z
  .object({
    projectId: z.number().int().positive(),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
    description: z.string().nullable(),
    tag: z.string().nullable(),
    billed: z.boolean(),
    ...durationFields,
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "no fields to update" });
export type UpdateEntryBody = z.infer<typeof updateEntrySchema>;

/** Apply the same patch to many entries at once (bulk edit). */
export const bulkUpdateEntriesSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
  patch: updateEntrySchema,
});
export type BulkUpdateEntriesBody = z.infer<typeof bulkUpdateEntriesSchema>;

/** A set of entry ids — used by bulk delete / restore / permanent purge. */
export const entryIdsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});
export type EntryIdsBody = z.infer<typeof entryIdsSchema>;

export interface EntryFilters {
  clientId?: number;
  projectId?: number;
  mode?: "forfait" | "horaire" | "prix_fixe"; // filter by the project's billing mode
  from?: string; // YYYY-MM-DD inclusive
  to?: string; // YYYY-MM-DD inclusive
  tag?: string;
  q?: string; // search in description/tag
  billed?: boolean;
  limit?: number;
  offset?: number;
}
