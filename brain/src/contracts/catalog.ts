import { z } from "zod";

export const projectModes = ["forfait", "horaire", "prix_fixe"] as const;

export const createClientSchema = z.object({
  name: z.string().trim().min(1),
  notes: z.string().optional(),
});
export type CreateClientBody = z.infer<typeof createClientSchema>;

export const createProjectSchema = z.object({
  clientId: z.number().int().positive(),
  name: z.string().trim().min(1),
  mode: z.enum(projectModes),
  hourlyRate: z.number().nonnegative().optional(),
  fixedPrice: z.number().nonnegative().optional(),
  estimatedHours: z.number().nonnegative().optional(),
});
export type CreateProjectBody = z.infer<typeof createProjectSchema>;

export const updateClientSchema = z
  .object({
    name: z.string().trim().min(1),
    notes: z.string().nullable(),
    archived: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "no fields to update" });
export type UpdateClientBody = z.infer<typeof updateClientSchema>;

export const updateProjectSchema = z
  .object({
    clientId: z.number().int().positive(),
    name: z.string().trim().min(1),
    mode: z.enum(projectModes),
    hourlyRate: z.number().nonnegative().nullable(),
    fixedPrice: z.number().nonnegative().nullable(),
    estimatedHours: z.number().nonnegative().nullable(),
    archived: z.boolean(),
    completed: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "no fields to update" });
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;

export const clientDtoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  notes: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type ClientDTO = z.infer<typeof clientDtoSchema>;

export const projectDtoSchema = z.object({
  id: z.number().int(),
  clientId: z.number().int(),
  name: z.string(),
  mode: z.enum(projectModes),
  hourlyRate: z.number().nullable(),
  fixedPrice: z.number().nullable(),
  estimatedHours: z.number().nullable(),
  archived: z.boolean(),
  completed: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type ProjectDTO = z.infer<typeof projectDtoSchema>;
