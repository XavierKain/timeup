import type { FastifyInstance } from "fastify";
import {
  createClientSchema,
  createProjectSchema,
  updateClientSchema,
  updateProjectSchema,
} from "../../contracts/catalog.js";
import { AppError } from "../../contracts/common.js";
import {
  createClient,
  createProject,
  getClient,
  getProject,
  listClients,
  listProjects,
  updateClient,
  updateProject,
} from "../../services/catalog.js";
import { parseBody, type Deps } from "../server.js";

function intParam(value: string, what: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError("VALIDATION_ERROR", `Invalid ${what} id`);
  return n;
}

function boolQuery(value: unknown): boolean {
  return value === "true" || value === "1";
}

export function registerCatalogRoutes(app: FastifyInstance, { db }: Deps): void {
  // Clients
  app.post("/clients", async (req, reply) => {
    const client = createClient(db, parseBody(createClientSchema, req.body));
    reply.status(201);
    return client;
  });

  app.get("/clients", async (req) => {
    const q = req.query as Record<string, string>;
    return listClients(db, boolQuery(q.includeArchived));
  });

  app.get("/clients/:id", async (req) => {
    const id = intParam((req.params as { id: string }).id, "client");
    const client = getClient(db, id);
    if (!client) throw new AppError("NOT_FOUND", `Client ${id} not found`);
    return client;
  });

  app.patch("/clients/:id", async (req) => {
    const id = intParam((req.params as { id: string }).id, "client");
    return updateClient(db, id, parseBody(updateClientSchema, req.body));
  });

  // Projects
  app.post("/projects", async (req, reply) => {
    const project = createProject(db, parseBody(createProjectSchema, req.body));
    reply.status(201);
    return project;
  });

  app.get("/projects", async (req) => {
    const q = req.query as Record<string, string>;
    return listProjects(db, {
      clientId: q.clientId ? intParam(q.clientId, "client") : undefined,
      includeArchived: boolQuery(q.includeArchived),
      excludeCompleted: boolQuery(q.excludeCompleted),
    });
  });

  app.get("/projects/:id", async (req) => {
    const id = intParam((req.params as { id: string }).id, "project");
    const project = getProject(db, id);
    if (!project) throw new AppError("NOT_FOUND", `Project ${id} not found`);
    return project;
  });

  app.patch("/projects/:id", async (req) => {
    const id = intParam((req.params as { id: string }).id, "project");
    return updateProject(db, id, parseBody(updateProjectSchema, req.body));
  });
}
