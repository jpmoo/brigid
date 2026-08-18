import { eq, inArray, isNull } from "drizzle-orm";
import { blocks, digestState, sectionDigests, settings, templates, works } from "@brigid/db";
import type { DigestProgress, PlacedDigest } from "@brigid/shared";
import { buildOutline } from "@brigid/shared";
import { db, isDbReady } from "../db.js";
import { detect } from "./detect.js";
import type { Provider } from "./detect.js";
import { syncSection } from "./cast.js";
import { inspectModel } from "./client.js";
import { digestSection, hashContent } from "./digest.js";

/**
 * The walker.
 *
 * It reads the manuscript in the background and keeps reading it, because the
 * writer keeps writing. Nothing here is triggered by an edit: the walker asks,
 * on a timer, which sections have prose that no longer matches their digest,
 * and reads those. That is a deliberately dumb design and it is why edits can
 * never be missed — there is no invalidation to forget, no hook to fail to
 * fire, no queue to lose. Change a scene and the next sweep notices.
 *
 * One work at a time and one section at a time. Ollama serves a single model on
 * (usually) one machine, and firing a whole book at it concurrently would
 * neither be faster nor leave anything for the writer's own use of it.
 */

const IDLE_SWEEP_MS = 30_000;
/** After an edit lands, wait for the writer to stop typing before re-reading. */
const SETTLE_MS = 20_000;

let running = false;
let stopping: AbortController | null = null;
let timer: NodeJS.Timeout | null = null;

/** Sections worth reading: prose that counts toward the book. */
async function sectionsOf(workId: string) {
  const rows = await db
    .select({
      id: blocks.id,
      label: blocks.label,
      text: blocks.contentText,
      updatedAt: blocks.updatedAt,
      counts: templates.formatSettings,
    })
    .from(blocks)
    .innerJoin(templates, eq(blocks.formatId, templates.id))
    .where(eq(blocks.workId, workId));

  return rows
    .filter((r) => r.counts?.countsTowardWordCount !== false)
    .filter((r) => r.text.trim().length > 0)
    .map((r) => ({
      id: r.id,
      label: r.label,
      text: r.text,
      updatedAt: r.updatedAt,
      hash: hashContent(r.text),
    }));
}

/** Which model is configured, if the walk can run at all. */
async function reader(): Promise<{
  url: string;
  model: string;
  numCtx: number | null;
  thinks: boolean | null;
  provider: Provider;
} | null> {
  const [row] = await db
    .select({
      url: settings.ollamaUrl,
      model: settings.inferenceModel,
      numCtx: settings.ollamaNumCtx,
      thinks: settings.ollamaThinks,
      provider: settings.aiProvider,
    })
    .from(settings)
    .limit(1);
  if (!row?.url || !row.model) return null;

  /**
   * A model chosen before these were detected — or by a version of Brigid that
   * didn't detect them — leaves nulls here, and a null `num_ctx` means Ollama
   * serves its own small default and silently truncates every chapter. Rather
   * than require the writer to re-save the model to fix something they were
   * never told about, the walk asks once and remembers.
   */
  /**
   * What it speaks, when nothing recorded it. Same repair the shared reader
   * makes, and needed here too: this walk runs for an hour and would spend the
   * whole of it talking the wrong protocol at a server that answers 404.
   */
  let provider = row.provider ?? null;
  if (!provider) {
    const found = await detect(row.url).catch(() => null);
    provider = found?.provider ?? "ollama";
    if (found) {
      await db.update(settings).set({ aiProvider: found.provider }).where(isNull(settings.aiProvider));
    }
  }

  if (provider === "ollama" && (row.numCtx === null || row.thinks === null)) {
    const seen = await inspectModel(row.url, row.model).catch(() => null);
    if (seen && (seen.numCtx !== null || seen.thinks !== null)) {
      await db
        .update(settings)
        .set({ ollamaNumCtx: seen.numCtx, ollamaThinks: seen.thinks, updatedAt: new Date() })
        .where(eq(settings.id, 1));
      return {
        url: row.url,
        model: row.model,
        numCtx: seen.numCtx,
        thinks: seen.thinks,
        provider,
      };
    }
  }

  return {
    url: row.url,
    model: row.model,
    numCtx: row.numCtx,
    thinks: row.thinks,
    provider,
  };
}

/**
 * How far along, for one work.
 *
 * Counted from the digest rows rather than tracked in a column, so it cannot
 * drift out of step with what has actually been read. A row counts as done only
 * if it matches both the current prose and the current model.
 */
export async function progressOf(workId: string): Promise<DigestProgress> {
  const config = await reader();
  const sections = await sectionsOf(workId);
  const stored = await db
    .select({
      blockId: sectionDigests.blockId,
      hash: sectionDigests.contentHash,
      model: sectionDigests.model,
      ms: sectionDigests.ms,
    })
    .from(sectionDigests)
    .where(eq(sectionDigests.workId, workId));

  const fresh = new Map(stored.map((s) => [s.blockId, s]));
  const done = sections.filter((s) => {
    const held = fresh.get(s.id);
    return held?.hash === s.hash && held.model === config?.model;
  });

  const [state] = await db
    .select({ status: digestState.status, lastError: digestState.lastError })
    .from(digestState)
    .where(eq(digestState.workId, workId))
    .limit(1);

  // From what reading has actually cost here, not from a guess about hardware.
  const timings = stored.map((s) => s.ms).filter((m): m is number => typeof m === "number" && m > 0);
  const average = timings.length > 0 ? timings.reduce((a, b) => a + b, 0) / timings.length : null;
  const left = sections.length - done.length;

  return {
    status: state?.status ?? "idle",
    done: done.length,
    total: sections.length,
    lastError: state?.lastError ?? null,
    etaSeconds: average && left > 0 ? Math.round((average * left) / 1000) : null,
    // An empty manuscript is not ready — there is nothing to analyze.
    ready: sections.length > 0 && left === 0,
  };
}

async function setState(
  workId: string,
  patch: { status?: "idle" | "walking" | "failed"; lastError?: string | null; finished?: boolean },
): Promise<void> {
  const values = {
    workId,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
    ...(patch.status === "walking" ? { startedAt: new Date() } : {}),
    ...(patch.finished ? { finishedAt: new Date() } : {}),
    updatedAt: new Date(),
  };
  await db
    .insert(digestState)
    .values(values)
    .onConflictDoUpdate({ target: digestState.workId, set: values });
}

/**
 * One pass over one work.
 *
 * Returns whether it read anything, so the sweep can tell a quiet manuscript
 * from a busy one and slow down accordingly.
 */
async function walkWork(workId: string, signal: AbortSignal): Promise<boolean> {
  // Called off by the writer. Nothing is undone; it simply stops being read.
  const [calledOff] = await db
    .select({ status: digestState.status })
    .from(digestState)
    .where(eq(digestState.workId, workId))
    .limit(1);
  if (calledOff?.status === "stopped") return false;

  const config = await reader();
  if (!config) return false;

  const sections = await sectionsOf(workId);
  if (sections.length === 0) return false;

  const stored = await db
    .select({
      blockId: sectionDigests.blockId,
      hash: sectionDigests.contentHash,
      model: sectionDigests.model,
    })
    .from(sectionDigests)
    .where(eq(sectionDigests.workId, workId));
  const held = new Map(stored.map((s) => [s.blockId, s]));

  // A section being edited right now will be edited again in a moment. Reading
  // it on every keystroke would keep a GPU busy producing digests that are
  // stale before they land, so it has to sit still first.
  const settled = Date.now() - SETTLE_MS;
  const stale = sections.filter((s) => {
    const row = held.get(s.id);
    if (row?.hash === s.hash && row.model === config.model) return false;
    return s.updatedAt.getTime() <= settled;
  });

  // Digests for sections that no longer exist or no longer count.
  const live = new Set(sections.map((s) => s.id));
  const orphaned = stored.filter((s) => !live.has(s.blockId)).map((s) => s.blockId);
  if (orphaned.length > 0) {
    await db.delete(sectionDigests).where(inArray(sectionDigests.blockId, orphaned));
  }

  if (stale.length === 0) return false;

  await setState(workId, { status: "walking", lastError: null });

  try {
    /**
     * Who this book has already named. Read once per walk rather than per
     * section — it only grows, and a fresh query for every chapter would be a
     * lot of database for a list that barely moves.
     */
    const known = new Set<string>();
    for (const row of await db
      .select({ characters: sectionDigests.characters })
      .from(sectionDigests)
      .where(eq(sectionDigests.workId, workId))) {
      for (const character of row.characters) {
        if (character.name?.trim()) known.add(character.name.trim());
      }
    }

    for (const section of stale) {
      if (signal.aborted) break;

      // Which section failed matters: one chapter the model chokes on reads
      // very differently from a host that has gone away, and the panel shows
      // whatever this says.
      const where = section.label ? `“${section.label}”` : "an untitled section";
      const { digest, ms } = await digestSection({
        url: config.url,
        model: config.model,
        numCtx: config.numCtx,
        thinks: config.thinks,
        provider: config.provider,
        known: [...known],
        label: section.label,
        text: section.text,
        signal,
      }).catch((err: unknown) => {
        throw new Error(
          `reading ${where}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      // The prose may have moved on while the model was reading. Storing the
      // digest under the hash it was made from means a section edited mid-read
      // simply looks stale again on the next sweep, rather than being recorded
      // as a current reading of prose that no longer exists.
      const values = {
        blockId: section.id,
        workId,
        contentHash: section.hash,
        model: config.model,
        characters: digest.characters,
        events: digest.events,
        ms,
        updatedAt: new Date(),
      };
      for (const character of digest.characters) {
        if (character.name?.trim()) known.add(character.name.trim());
      }

      await db
        .insert(sectionDigests)
        .values(values)
        .onConflictDoUpdate({ target: sectionDigests.blockId, set: values });

      // Into the queue, where the writer settles it before anything is scored.
      await syncSection(workId, section.id, digest.characters);
    }

    await setState(workId, { status: "idle", lastError: null, finished: true });
    return true;
  } catch (err) {
    // A host that has gone away is the common case, and it is not a failure of
    // this manuscript — it just means nothing can be read until it is back. It
    // is recorded so the panel can say so rather than sitting at a silent 40%.
    await setState(workId, {
      status: "failed",
      lastError: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** One sweep across every manuscript that isn't archived. */
async function sweep(signal: AbortSignal): Promise<void> {
  if (!isDbReady()) return;
  if (!(await reader())) return;

  const rows = await db.select({ id: works.id, archivedAt: works.archivedAt }).from(works);
  for (const work of rows) {
    if (signal.aborted) return;
    if (work.archivedAt) continue;
    await walkWork(work.id, signal);
  }
}

export function startDigestWorker(): void {
  if (running) return;
  running = true;
  stopping = new AbortController();
  const signal = stopping.signal;

  const tick = async () => {
    try {
      await sweep(signal);
    } catch {
      // A sweep that throws is a bug or a database that went away; either way
      // the next one is 30 seconds off, and a background reader is not worth
      // taking the server down for.
    }
    if (!signal.aborted) timer = setTimeout(() => void tick(), IDLE_SWEEP_MS);
  };

  // Not on the boot path: a slow first sweep shouldn't delay the server coming
  // up, and there is nothing to read in the first few seconds anyway.
  timer = setTimeout(() => void tick(), 5_000);
}

export function stopDigestWorker(): void {
  running = false;
  stopping?.abort();
  stopping = null;
  if (timer) clearTimeout(timer);
  timer = null;
}

/**
 * Everything read so far, placed in the finished book.
 *
 * This is both what the writer can inspect and what the judging pass consumes.
 * The placement is the reason it exists in this shape: five of the seven
 * structure models make proportional claims, and the reference document is
 * explicit that a mapping doesn\'t count if the midpoint has to be dragged to
 * the 80% mark to work. A model asked to eyeball proportions from prose will
 * invent them; handed "this section spans 47–53% of the book", it can be held
 * to the standard. Positions are computed here, every time, because they shift
 * whenever any section changes length.
 */
export async function placedDigests(workId: string): Promise<PlacedDigest[]> {
  const rows = await db
    .select({
      id: blocks.id,
      parentId: blocks.parentId,
      sortKey: blocks.sortKey,
      formatId: blocks.formatId,
      label: blocks.label,
      wordCount: blocks.wordCount,
      counts: templates.formatSettings,
    })
    .from(blocks)
    .innerJoin(templates, eq(blocks.formatId, templates.id))
    .where(eq(blocks.workId, workId));

  const digests = await db
    .select({
      blockId: sectionDigests.blockId,
      characters: sectionDigests.characters,
      events: sectionDigests.events,
    })
    .from(sectionDigests)
    .where(eq(sectionDigests.workId, workId));
  const byBlock = new Map(digests.map((d) => [d.blockId, d]));

  // Reading order, which is the order positions are measured along.
  const ordered = buildOutline(rows).map((e) => e.block);

  // Only counted prose contributes to position, so a title page doesn\'t push
  // chapter one away from 0% and front matter doesn\'t skew every proportion
  // after it.
  const counted = ordered.filter((b) => b.counts?.countsTowardWordCount !== false);
  const total = counted.reduce((sum, b) => sum + b.wordCount, 0);

  const placed: PlacedDigest[] = [];
  let running = 0;
  for (const block of counted) {
    const digest = byBlock.get(block.id);
    const start = total > 0 ? running / total : 0;
    running += block.wordCount;
    if (!digest) continue;
    placed.push({
      blockId: block.id,
      label: block.label,
      start,
      end: total > 0 ? running / total : 0,
      words: block.wordCount,
      characters: digest.characters,
      events: digest.events,
    });
  }
  return placed;
}
