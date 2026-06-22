#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
const base = `http://${config.host}:${config.port}`;

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const hasBody = method !== "GET" && method !== "HEAD";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(hasBody ? { "content-type": "application/json" } : {}),
        authorization: `Bearer ${config.token}`,
      },
      ...(hasBody ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  } catch (err) {
    if (err instanceof TypeError && /fetch failed|ECONNREFUSED/.test(String(err.cause ?? err))) {
      console.error(`[timup] cannot reach brain at ${base} — is it running? (npm run brain)`);
    } else {
      console.error("[timup] request error:", err);
    }
    process.exit(1);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    console.error(`[timup] ${res.status}`, JSON.stringify(json, null, 2));
    process.exit(1);
  }
  return json;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

const program = new Command();
program.name("timup").description("Timup brain CLI").version(config.appVersion);

const client = program.command("client").description("manage clients");
client
  .command("add")
  .argument("<name>", "client name")
  .option("--notes <notes>", "notes")
  .action(async (name: string, opts: { notes?: string }) => {
    print(await api("POST", "/clients", { name, notes: opts.notes }));
  });

const project = program.command("project").description("manage projects");
project
  .command("add")
  .requiredOption("--client <id>", "client id")
  .requiredOption("--name <name>", "project name")
  .requiredOption("--mode <mode>", "forfait | horaire | prix_fixe")
  .option("--rate <n>", "hourly rate")
  .option("--price <n>", "fixed price")
  .option("--estimated <n>", "estimated hours")
  .action(
    async (opts: {
      client: string;
      name: string;
      mode: string;
      rate?: string;
      price?: string;
      estimated?: string;
    }) => {
      print(
        await api("POST", "/projects", {
          clientId: Number(opts.client),
          name: opts.name,
          mode: opts.mode,
          hourlyRate: opts.rate ? Number(opts.rate) : undefined,
          fixedPrice: opts.price ? Number(opts.price) : undefined,
          estimatedHours: opts.estimated ? Number(opts.estimated) : undefined,
        }),
      );
    },
  );

program
  .command("start")
  .argument("<projectId>", "project id")
  .action(async (projectId: string) => {
    print(await api("POST", "/timer/start", { projectId: Number(projectId) }));
  });

program.command("pause").action(async () => print(await api("POST", "/timer/pause")));
program.command("resume").action(async () => print(await api("POST", "/timer/resume")));

program
  .command("stop")
  .option("--description <text>", "entry description")
  .option("--tag <tag>", "entry tag")
  .option("--request-id <id>", "idempotency key")
  .action(async (opts: { description?: string; tag?: string; requestId?: string }) => {
    print(
      await api("POST", "/timer/stop", {
        description: opts.description,
        tag: opts.tag,
        requestId: opts.requestId,
      }),
    );
  });

program.command("status").action(async () => print(await api("GET", "/timer")));

program
  .command("import")
  .argument("<path>", "path to the Excel workbook")
  .option("--dry-run", "parse + reconcile without writing")
  .action(async (path: string, opts: { dryRun?: boolean }) => {
    print(await api("POST", "/import", { path, dryRun: !!opts.dryRun }));
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
