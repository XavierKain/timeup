import { z } from "zod";
import { projectModes } from "./catalog.js";

export const createRechargeSchema = z.object({
  projectId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  hours: z.number().positive(),
  price: z.number().nonnegative().optional(),
  note: z.string().optional(),
});
export type CreateRechargeBody = z.infer<typeof createRechargeSchema>;

export const updateRechargeSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
    hours: z.number().positive(),
    price: z.number().nonnegative().nullable(),
    note: z.string().nullable(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "no fields to update" });
export type UpdateRechargeBody = z.infer<typeof updateRechargeSchema>;

export const rechargeDtoSchema = z.object({
  id: z.number().int(),
  projectId: z.number().int(),
  date: z.string(),
  hours: z.number(),
  price: z.number().nullable(),
  note: z.string().nullable(),
  createdAt: z.number().int(),
});
export type RechargeDTO = z.infer<typeof rechargeDtoSchema>;

/** Per-project aggregated stats; mode-specific fields are null when N/A. */
export const projectStatsDtoSchema = z.object({
  projectId: z.number().int(),
  clientId: z.number().int(),
  clientName: z.string(),
  projectName: z.string(),
  mode: z.enum(projectModes),
  totalSeconds: z.number().int(),
  unbilledSeconds: z.number().int(),
  // forfait
  rechargedSeconds: z.number().int().nullable(),
  remainingSeconds: z.number().int().nullable(),
  // horaire
  hourlyRate: z.number().nullable(),
  billableAmount: z.number().nullable(),
  // prix_fixe
  fixedPrice: z.number().nullable(),
  estimatedHours: z.number().nullable(),
  hoursSpent: z.number().nullable(),
  effectiveHourlyRate: z.number().nullable(),
  varianceHours: z.number().nullable(),
  firstEntryDate: z.string().nullable(), // YYYY-MM-DD of the first non-trashed entry
  lastEntryDate: z.string().nullable(), // YYYY-MM-DD of the last non-trashed entry
  completed: z.boolean(), // project marked finished (kept in stats, hidden from timer pickers)
});
export type ProjectStatsDTO = z.infer<typeof projectStatsDtoSchema>;
