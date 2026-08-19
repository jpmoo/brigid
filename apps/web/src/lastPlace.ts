/**
 * Where the writer was, per manuscript.
 *
 * The section that was current, not a scroll offset. An offset is a claim about
 * a document that has since been edited — write two paragraphs into chapter
 * three and every number below it points somewhere else — while a section is
 * the same section whatever happens above it.
 *
 * In the browser rather than the database, because it is a fact about this
 * machine's window and not about the book. Two machines open on the same
 * manuscript should each stay where they were, and neither should move the
 * other.
 *
 * Every call is wrapped. Storage throws in private windows and when a disk is
 * full, and losing your place is a small enough thing that it must never be
 * the reason a manuscript fails to open.
 */

const KEY = "brigid.lastPlace";

type Places = Record<string, string>;

function all(): Places {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Places) : {};
  } catch {
    return {};
  }
}

export function readLastPlace(workId: string): string | null {
  return all()[workId] ?? null;
}

export function writeLastPlace(workId: string, blockId: string): void {
  try {
    const held = all();
    if (held[workId] === blockId) return;
    window.localStorage.setItem(KEY, JSON.stringify({ ...held, [workId]: blockId }));
  } catch {
    // Nothing to do and nothing worth saying. The manuscript opens either way.
  }
}
