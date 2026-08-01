import { createReadStream } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { settings } from "@brigid/db";
import { authenticate, requireUser } from "../auth/middleware.js";
import { runtimeConfig } from "../config.js";
import { db } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { restoreEverything, restoreWork, worksInBackup } from "./restore.js";
import { DEFAULT_SCHEDULE, readSchedule } from "./schedule.js";
import {
  backupDir,
  backupPath,
  isBackupName,
  listBackups,
  pruneBackups,
  stampFor,
  takeBackup,
  toolsAvailable,
} from "./store.js";

function requireDatabaseUrl(): string {
  const url = runtimeConfig().databaseUrl;
  if (!url) throw badRequest("there is no database to back up yet");
  return url;
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /**
   * Everything the page needs, and never a 500.
   *
   * This is the page someone opens when something has gone wrong, so it has to
   * open. Each part is allowed to fail on its own and says so, rather than one
   * of them taking down the screen that holds the way back.
   */
  app.get("/backups", async (req) => {
    requireUser(req);

    const [schedule, files, tools] = await Promise.all([
      readSchedule().catch(() => DEFAULT_SCHEDULE),
      listBackups().catch(() => null),
      toolsAvailable().catch(() => false),
    ]);

    return {
      schedule,
      backups: files ?? [],
      // Where they are is worth saying: it is the path to point another backup
      // system at, and the first thing to check when one goes missing.
      directory: backupDir,
      tools,
      ...(files === null ? { problem: `could not read ${backupDir}` } : {}),
    };
  });

  app.patch("/backups/schedule", async (req) => {
    requireUser(req);
    const body = z
      .object({
        enabled: z.boolean().optional(),
        hour: z.number().int().min(0).max(23).optional(),
        minute: z.number().int().min(0).max(59).optional(),
        // One is the floor: keeping none would delete the backup just taken.
        keep: z.number().int().min(1).max(200).optional(),
      })
      .parse(req.body);

    const [row] = await db.select({ id: settings.id }).from(settings).limit(1);
    if (!row) throw badRequest("settings are not ready");

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.enabled !== undefined) patch.backupEnabled = body.enabled;
    if (body.hour !== undefined) patch.backupHour = body.hour;
    if (body.minute !== undefined) patch.backupMinute = body.minute;
    if (body.keep !== undefined) patch.backupKeep = body.keep;

    await db.update(settings).set(patch).where(eq(settings.id, row.id));

    const schedule = await readSchedule();
    // Lowering the count takes effect now rather than at the next nightly run,
    // which is what anyone lowering it expects to see.
    if (body.keep !== undefined) await pruneBackups(schedule.keep);
    return { schedule };
  });

  app.post("/backups", async (req, reply) => {
    requireUser(req);
    const file = await takeBackup(requireDatabaseUrl());
    const schedule = await readSchedule();
    const removed = await pruneBackups(schedule.keep);
    reply.status(201);
    return { backup: file, removed };
  });

  app.get("/backups/:name/download", async (req, reply) => {
    requireUser(req);
    const { name } = z.object({ name: z.string() }).parse(req.params);
    if (!isBackupName(name)) throw notFound("backup");

    const files = await listBackups();
    if (!files.some((f) => f.name === name)) throw notFound("backup");

    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${name}"`);
    return reply.send(createReadStream(backupPath(name)));
  });

  app.delete("/backups/:name", async (req) => {
    requireUser(req);
    const { name } = z.object({ name: z.string() }).parse(req.params);
    if (!isBackupName(name)) throw notFound("backup");
    await rm(backupPath(name), { force: true });
    return { ok: true };
  });

  /** What is inside one, so a single manuscript can be picked out of it. */
  app.get("/backups/:name/works", async (req) => {
    requireUser(req);
    const { name } = z.object({ name: z.string() }).parse(req.params);
    if (!isBackupName(name)) throw notFound("backup");
    return { works: await worksInBackup(name) };
  });

  /**
   * Bringing a file in from somewhere else. It lands in the directory under a
   * name of ours, and from that point is a backup like any other — which is why
   * the listing reads the directory rather than a table.
   */
  app.post("/backups/import", async (req, reply) => {
    requireUser(req);
    const upload = await req.file();
    if (!upload) throw badRequest("no file was uploaded");

    const buffer = await upload.toBuffer();
    // pg_dump's custom format starts with a magic string. Checking it here
    // turns "restore failed for reasons you can't see" into a clear no.
    if (buffer.subarray(0, 5).toString("latin1") !== "PGDMP") {
      throw badRequest("that is not a PostgreSQL custom-format dump");
    }

    const name = `brigid-${stampFor(new Date())}-imported.dump`;
    await writeFile(join(backupDir, name), buffer);
    reply.status(201);
    return { backup: { name, takenAt: new Date().toISOString(), bytes: buffer.length } };
  });

  /**
   * Putting one back. Everything, or a single manuscript out of it.
   *
   * Both take a backup of the current state first and hand its name back, so
   * the way out of a mistaken restore is on screen the moment it finishes.
   */
  app.post("/backups/:name/restore", async (req) => {
    requireUser(req);
    const { name } = z.object({ name: z.string() }).parse(req.params);
    if (!isBackupName(name)) throw notFound("backup");

    const files = await listBackups();
    if (!files.some((f) => f.name === name)) throw notFound("backup");

    // Two choices, not a menu. One manuscript comes back with everything that
    // decides how it reads, because those things are what it is; anything wider
    // than that is the whole database.
    const body = z
      .object({ everything: z.boolean().optional(), workId: z.string().uuid().optional() })
      .parse(req.body);

    const url = requireDatabaseUrl();

    if (!body.everything && !body.workId) throw badRequest("nothing was chosen to restore");

    // A restore that fails has to say why. Left to the default handler this is
    // a bare 500 reading "internal error", which on the one screen someone
    // opens when things have gone wrong is no help at all — the message is kept
    // and the detail goes to the log.
    try {
      if (body.everything) {
        const safety = await restoreEverything(url, name);
        return { restored: ["everything"], safety };
      }
      return await restoreWork(url, name, body.workId as string);
    } catch (err) {
      req.log.error(err);
      throw badRequest(`restore failed: ${(err as Error).message}`);
    }
  });
}
