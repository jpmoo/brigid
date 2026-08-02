import { and, eq, isNull } from "drizzle-orm";
import { analyses, characterRuns, settings, structureRuns, works } from "@brigid/db";
import type {
  CharacterAnalysis,
  CharacterRunProgress,
  PlacedDigest,
  StructureRunProgress,
} from "@brigid/shared";
import { db, isDbReady } from "../db.js";
import { analyseCharacter, analyseStructure, dossierFromCast, reconcilePrimacy } from "./analysis.js";
import { castFor } from "./cast.js";
import { placedDigests } from "./worker.js";

/**
 * Profiling the cast, one character at a time, out of band.
 *
 * The request that asks for this records a queue and returns. Everything here
 * happens afterwards, which is the whole point: a dozen characters at a model
 * call each is the better part of an hour, and no HTTP request survives that —
 * the proxy in front gives up at a hundred seconds and answers with its own
 * error page, so the work completes and the answer has nowhere to go.
 *
 * Each profile is written the moment it is finished rather than at the end, so
 * a failure on the ninth character keeps the first eight, and a restart resumes
 * from what is left rather than starting again.
 */

let running = false;
let stopping: AbortController | null = null;
let timer: NodeJS.Timeout | null = null;
/**
 * A sweep already under way. Pressing the button calls `kick`, which can land
 * while one is running — and two sweeps on the same queue would profile the
 * same character twice, which on a self-hosted box is somebody's GPU doing an
 * hour of work for nothing.
 */
let inFlight = false;

/** How often to look for queued work when nobody has asked. */
const IDLE_MS = 20_000;

async function reader() {
  const [row] = await db
    .select({
      url: settings.ollamaUrl,
      model: settings.inferenceModel,
      numCtx: settings.ollamaNumCtx,
      thinks: settings.ollamaThinks,
    })
    .from(settings)
    .limit(1);
  if (!row?.url || !row.model) return null;
  return { url: row.url, model: row.model, numCtx: row.numCtx, thinks: row.thinks };
}

/** Each section as it stands, for measuring how far the book moves afterwards. */
function snapshot(sections: PlacedDigest[]): [string, string, number][] {
  return sections.map((s) => [
    s.blockId,
    `${s.events.length}:${s.characters.length}:${s.words}`,
    s.words,
  ]);
}

/** Queue a run, replacing whatever was queued before for this manuscript. */
export async function queueCharacterRun(
  workId: string,
  names: string[],
  fingerprint: string,
  focal: string,
): Promise<void> {
  const row = {
    workId,
    status: "queued" as const,
    wanted: names,
    done: [] as string[],
    currentSubject: null,
    focal,
    digestFingerprint: fingerprint,
    lastError: null,
    startedAt: new Date(),
    finishedAt: null,
    updatedAt: new Date(),
  };
  await db
    .insert(characterRuns)
    .values(row)
    .onConflictDoUpdate({ target: characterRuns.workId, set: row });

  // Somebody just pressed a button; don't make them wait for the next sweep.
  kick();
}

/** Stop a run, leaving what it has already written in place. */
export async function cancelCharacterRun(workId: string): Promise<void> {
  await db
    .update(characterRuns)
    .set({
      status: "idle",
      wanted: [],
      currentSubject: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(characterRuns.workId, workId));
}

export async function characterProgressOf(workId: string): Promise<CharacterRunProgress | null> {
  const [row] = await db.select().from(characterRuns).where(eq(characterRuns.workId, workId)).limit(1);
  if (!row) return null;

  const done = row.done.length;
  const remaining = row.wanted.filter((name) => !row.done.includes(name));

  /**
   * From this run's own pace rather than a guess. A character costs what it
   * costs on this machine with this model, and the only honest source for that
   * is what the last few actually took.
   */
  let etaSeconds: number | null = null;
  if (row.startedAt && done > 0 && remaining.length > 0) {
    const spent = (Date.now() - row.startedAt.getTime()) / 1000;
    etaSeconds = Math.round((spent / done) * remaining.length);
  }

  return {
    status: row.status,
    done,
    total: row.wanted.length,
    current: row.currentSubject,
    remaining,
    lastError: row.lastError,
    etaSeconds,
  };
}

/** One profile, replacing any earlier one for the same character. */
async function storeProfile(
  workId: string,
  model: string,
  fingerprint: string,
  shot: [string, string, number][],
  profile: CharacterAnalysis,
  ms: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(analyses)
      .where(
        and(
          eq(analyses.workId, workId),
          eq(analyses.kind, "character"),
          eq(analyses.subject, profile.name),
        ),
      );
    await tx.insert(analyses).values({
      workId,
      kind: "character",
      subject: profile.name,
      model,
      digestFingerprint: fingerprint,
      digestSnapshot: shot,
      result: profile as unknown as Record<string, unknown>,
      ms,
    });
  });
}

/**
 * Settle the cast against itself.
 *
 * The rubric says only one character in a story ordinarily holds a 5 on a given
 * axis — they are its primary carrier — and that is a judgment across the whole
 * cast, not one a character can make alone. Profiles now land one at a time, so
 * it cannot be applied as they are written; it is applied once, when the queue
 * empties and there is a whole cast to compare.
 */
async function reconcile(workId: string): Promise<void> {
  const rows = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.workId, workId), eq(analyses.kind, "character")));
  if (rows.length < 2) return;

  const before = rows.map((r) => r.result as unknown as CharacterAnalysis);
  const after = reconcilePrimacy(before);

  for (const [i, profile] of after.entries()) {
    // Only write back what actually moved.
    if (JSON.stringify(profile) === JSON.stringify(before[i])) continue;
    await db
      .update(analyses)
      .set({ result: profile as unknown as Record<string, unknown> })
      .where(eq(analyses.id, rows[i]!.id));
  }
}

/** Queue the story-shape analysis. One thing to do, so no list. */
export async function queueStructureRun(workId: string, fingerprint: string): Promise<void> {
  const row = {
    workId,
    status: "queued" as const,
    digestFingerprint: fingerprint,
    lastError: null,
    startedAt: new Date(),
    finishedAt: null,
    updatedAt: new Date(),
  };
  await db
    .insert(structureRuns)
    .values(row)
    .onConflictDoUpdate({ target: structureRuns.workId, set: row });
  kick();
}

export async function structureProgressOf(workId: string): Promise<StructureRunProgress | null> {
  const [row] = await db.select().from(structureRuns).where(eq(structureRuns.workId, workId)).limit(1);
  if (!row) return null;
  const live = row.status === "queued" || row.status === "running";
  return {
    status: row.status,
    lastError: row.lastError,
    elapsedSeconds:
      live && row.startedAt ? Math.round((Date.now() - row.startedAt.getTime()) / 1000) : null,
  };
}

/** The story-shape analysis, if one is waiting. */
async function drainStructure(workId: string, signal: AbortSignal): Promise<void> {
  const [row] = await db.select().from(structureRuns).where(eq(structureRuns.workId, workId)).limit(1);
  if (!row || (row.status !== "queued" && row.status !== "running")) return;

  const config = await reader();
  if (!config) return;

  const [work] = await db
    .select({ title: works.title })
    .from(works)
    .where(eq(works.id, workId))
    .limit(1);
  if (!work) return;

  const sections = await placedDigests(workId);
  if (sections.length === 0) return;

  await db
    .update(structureRuns)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(structureRuns.workId, workId));

  try {
    const { result, ms } = await analyseStructure({
      url: config.url,
      model: config.model,
      numCtx: config.numCtx,
      thinks: config.thinks,
      title: work.title,
      totalWords: sections.reduce((sum, sec) => sum + sec.words, 0),
      sections,
      signal,
    });

    const shot = snapshot(sections);
    await db.transaction(async (tx) => {
      await tx
        .delete(analyses)
        .where(and(eq(analyses.workId, workId), eq(analyses.kind, "structure")));
      await tx.insert(analyses).values({
        workId,
        kind: "structure",
        subject: null,
        model: config.model,
        digestFingerprint: row.digestFingerprint ?? "",
        digestSnapshot: shot,
        result: result as unknown as Record<string, unknown>,
        ms,
      });
    });

    await db
      .update(structureRuns)
      .set({ status: "idle", lastError: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(structureRuns.workId, workId));
  } catch (err) {
    await db
      .update(structureRuns)
      .set({
        status: "failed",
        lastError: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(structureRuns.workId, workId));
  }
}

/**
 * Work through one manuscript's queue.
 *
 * One character per pass rather than the whole queue in a loop, so a stop is
 * never more than one model call away and the sweep stays responsive to other
 * manuscripts.
 */
async function drainOne(workId: string, signal: AbortSignal): Promise<boolean> {
  const [row] = await db.select().from(characterRuns).where(eq(characterRuns.workId, workId)).limit(1);
  if (!row || (row.status !== "queued" && row.status !== "running")) return false;

  const next = row.wanted.find((name) => !row.done.includes(name));
  if (!next) {
    // The queue is empty: settle the cast against itself before finishing.
    if (row.status === "running" || row.status === "queued") await reconcile(workId);
    await db
      .update(characterRuns)
      .set({ status: "idle", currentSubject: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(characterRuns.workId, workId));
    return false;
  }

  const config = await reader();
  if (!config) return false;

  const [work] = await db
    .select({ title: works.title })
    .from(works)
    .where(eq(works.id, workId))
    .limit(1);
  if (!work) return false;

  const sections = await placedDigests(workId);
  if (sections.length === 0) return false;

  await db
    .update(characterRuns)
    .set({ status: "running", currentSubject: next, updatedAt: new Date() })
    .where(eq(characterRuns.workId, workId));

  /**
   * Each character is a separate call, so the model cannot see what it wrote
   * for the others and will happily give three of them the same wry line. The
   * ones already written are handed over as forbidden.
   */
  const written = await db
    .select({ result: analyses.result })
    .from(analyses)
    .where(and(eq(analyses.workId, workId), eq(analyses.kind, "character")));
  const taken = written
    .map((r) => (r.result as unknown as CharacterAnalysis).epithet)
    .filter((line): line is string => Boolean(line));

  try {
    const { result, ms } = await analyseCharacter({
      url: config.url,
      model: config.model,
      numCtx: config.numCtx,
      thinks: config.thinks,
      title: work.title,
      name: next,
      // The settled record, not the reading: an action the writer moved or
      // dropped must not turn up in the prompt it was moved out of.
      dossier: dossierFromCast(await castFor(workId), sections, next),
      taken,
      // Fixed for the run: one chart is one perspective.
      focal: row.focal ?? row.wanted[0] ?? next,
      sections,
      signal,
    });

    await storeProfile(
      workId,
      config.model,
      row.digestFingerprint ?? "",
      snapshot(sections),
      result,
      ms,
    );

    await db
      .update(characterRuns)
      .set({
        done: [...row.done, next],
        currentSubject: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(characterRuns.workId, workId));
    return true;
  } catch (err) {
    /**
     * One awkward character does not cost the rest of the cast. The name is
     * marked done so the queue moves past it, and the reason is kept — the run
     * carries on and the panel says what was missed.
     */
    await db
      .update(characterRuns)
      .set({
        done: [...row.done, next],
        currentSubject: null,
        lastError: `${next}: ${err instanceof Error ? err.message : String(err)}`,
        updatedAt: new Date(),
      })
      .where(eq(characterRuns.workId, workId));
    return true;
  }
}

async function sweep(signal: AbortSignal): Promise<void> {
  if (!isDbReady()) return;

  const pending = await db
    .select({ workId: works.id })
    .from(works)
    .where(isNull(works.archivedAt));

  for (const row of pending) {
    if (signal.aborted) return;
    // The shape first: it is one call, and it is what most people press.
    await drainStructure(row.workId, signal);
    if (signal.aborted) return;
    // Keep going while this manuscript has queue left, so a run finishes
    // rather than trickling one character per sweep.
    while (!signal.aborted && (await drainOne(row.workId, signal))) {
      /* next character */
    }
  }
}

function kick(): void {
  if (!running) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void tick(), 250);
}

async function tick(): Promise<void> {
  const signal = stopping?.signal;
  if (!signal) return;
  if (inFlight) return;
  inFlight = true;
  try {
    await sweep(signal);
  } catch {
    // A failure inside a run is recorded against that run; anything reaching
    // here is a database that went away, and the next tick is not far off.
  } finally {
    inFlight = false;
  }
  if (!signal.aborted) timer = setTimeout(() => void tick(), IDLE_MS);
}

export function startProfileWorker(): void {
  if (running) return;
  running = true;
  stopping = new AbortController();
  // Not on the boot path — a queue left over from last time can wait a moment.
  timer = setTimeout(() => void tick(), 8_000);
}

export function stopProfileWorker(): void {
  running = false;
  stopping?.abort();
  if (timer) clearTimeout(timer);
  timer = null;
}
