import type DatabaseT from "better-sqlite3";
import type {
  ClientDTO,
  CreateClientBody,
  CreateProjectBody,
  ProjectDTO,
  UpdateClientBody,
  UpdateProjectBody,
} from "../contracts/catalog.js";
import { AppError } from "../contracts/common.js";

interface ClientRow {
  id: number;
  name: string;
  notes: string | null;
  archived: number;
  created_at: number;
  updated_at: number;
}

interface ProjectRow {
  id: number;
  client_id: number;
  name: string;
  mode: "forfait" | "horaire" | "prix_fixe";
  hourly_rate: number | null;
  fixed_price: number | null;
  estimated_hours: number | null;
  archived: number;
  completed: number;
  created_at: number;
  updated_at: number;
}

export function clientRowToDto(row: ClientRow): ClientDTO {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    archived: row.archived !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function projectRowToDto(row: ProjectRow): ProjectDTO {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    mode: row.mode,
    hourlyRate: row.hourly_rate,
    fixedPrice: row.fixed_price,
    estimatedHours: row.estimated_hours,
    archived: row.archived !== 0,
    completed: row.completed !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---- Clients ----

export function createClient(db: DatabaseT.Database, body: CreateClientBody): ClientDTO {
  const now = Date.now();
  const info = db
    .prepare(
      "INSERT INTO clients (name, notes, archived, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
    )
    .run(body.name, body.notes ?? null, now, now);
  return getClient(db, Number(info.lastInsertRowid))!;
}

export function getClient(db: DatabaseT.Database, id: number): ClientDTO | undefined {
  const row = db.prepare<[number], ClientRow>("SELECT * FROM clients WHERE id = ?").get(id);
  return row ? clientRowToDto(row) : undefined;
}

export function listClients(db: DatabaseT.Database, includeArchived = false): ClientDTO[] {
  const rows = db
    .prepare<[], ClientRow>(
      `SELECT * FROM clients ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY name`,
    )
    .all();
  return rows.map(clientRowToDto);
}

export function updateClient(
  db: DatabaseT.Database,
  id: number,
  body: UpdateClientBody,
): ClientDTO {
  if (!getClient(db, id)) throw new AppError("NOT_FOUND", `Client ${id} not found`);
  const now = Date.now();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.name !== undefined) (sets.push("name = ?"), params.push(body.name));
  if (body.notes !== undefined) (sets.push("notes = ?"), params.push(body.notes));
  if (body.archived !== undefined) (sets.push("archived = ?"), params.push(body.archived ? 1 : 0));
  sets.push("updated_at = ?");
  params.push(now, id);
  db.transaction(() => {
    db.prepare(`UPDATE clients SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    // Archiving/unarchiving a client cascades to its projects so they stay in
    // sync (an archived project never gets orphaned from a hidden client).
    if (body.archived !== undefined) {
      db.prepare("UPDATE projects SET archived = ?, updated_at = ? WHERE client_id = ?").run(
        body.archived ? 1 : 0,
        now,
        id,
      );
    }
  })();
  return getClient(db, id)!;
}

// ---- Projects ----

export function getProjectRow(db: DatabaseT.Database, id: number): ProjectRow | undefined {
  return db.prepare<[number], ProjectRow>("SELECT * FROM projects WHERE id = ?").get(id);
}

export function getProject(db: DatabaseT.Database, id: number): ProjectDTO | undefined {
  const row = getProjectRow(db, id);
  return row ? projectRowToDto(row) : undefined;
}

export function listProjects(
  db: DatabaseT.Database,
  opts: { clientId?: number; includeArchived?: boolean; excludeCompleted?: boolean } = {},
): ProjectDTO[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.clientId !== undefined) (where.push("client_id = ?"), params.push(opts.clientId));
  if (!opts.includeArchived) where.push("archived = 0");
  if (opts.excludeCompleted) where.push("completed = 0");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare<unknown[], ProjectRow>(`SELECT * FROM projects ${clause} ORDER BY name`)
    .all(...params);
  return rows.map(projectRowToDto);
}

export function createProject(db: DatabaseT.Database, body: CreateProjectBody): ProjectDTO {
  const client = getClient(db, body.clientId);
  if (!client) throw new AppError("NOT_FOUND", `Client ${body.clientId} not found`);

  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO projects (client_id, name, mode, hourly_rate, fixed_price, estimated_hours, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      body.clientId,
      body.name,
      body.mode,
      body.hourlyRate ?? null,
      body.fixedPrice ?? null,
      body.estimatedHours ?? null,
      now,
      now,
    );
  return getProject(db, Number(info.lastInsertRowid))!;
}

export function updateProject(
  db: DatabaseT.Database,
  id: number,
  body: UpdateProjectBody,
): ProjectDTO {
  if (!getProjectRow(db, id)) throw new AppError("NOT_FOUND", `Project ${id} not found`);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.clientId !== undefined) {
    if (!getClient(db, body.clientId)) {
      throw new AppError("NOT_FOUND", `Client ${body.clientId} not found`);
    }
    sets.push("client_id = ?"), params.push(body.clientId);
  }
  if (body.name !== undefined) (sets.push("name = ?"), params.push(body.name));
  if (body.mode !== undefined) (sets.push("mode = ?"), params.push(body.mode));
  if (body.hourlyRate !== undefined) (sets.push("hourly_rate = ?"), params.push(body.hourlyRate));
  if (body.fixedPrice !== undefined) (sets.push("fixed_price = ?"), params.push(body.fixedPrice));
  if (body.estimatedHours !== undefined)
    (sets.push("estimated_hours = ?"), params.push(body.estimatedHours));
  if (body.archived !== undefined) (sets.push("archived = ?"), params.push(body.archived ? 1 : 0));
  if (body.completed !== undefined)
    (sets.push("completed = ?"), params.push(body.completed ? 1 : 0));
  sets.push("updated_at = ?");
  params.push(Date.now(), id);
  db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getProject(db, id)!;
}
