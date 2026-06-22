import { z } from "zod";

export interface InvoicePrepQuery {
  clientId: number;
  from?: string;
  to?: string;
  roundingMinutes?: number;
  includeBilled?: boolean;
}

export const markBilledSchema = z.object({
  entryIds: z.array(z.number().int().positive()).min(1),
});
export type MarkBilledBody = z.infer<typeof markBilledSchema>;

export const invoiceLineDtoSchema = z.object({
  projectId: z.number().int(),
  projectName: z.string(),
  tag: z.string().nullable(),
  entries: z.number().int(),
  rawSeconds: z.number().int(),
  roundedSeconds: z.number().int(),
  hours: z.number(),
  hourlyRate: z.number().nullable(),
  amount: z.number().nullable(),
});

export const invoicePrepDtoSchema = z.object({
  clientId: z.number().int(),
  clientName: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  roundingMinutes: z.number().int(),
  lines: z.array(invoiceLineDtoSchema),
  totalRoundedSeconds: z.number().int(),
  totalHours: z.number(),
  totalAmount: z.number().nullable(),
  entryIds: z.array(z.number().int()),
  copyText: z.string(),
});
export type InvoicePrepDTO = z.infer<typeof invoicePrepDtoSchema>;
