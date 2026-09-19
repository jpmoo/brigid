/**
 * Whether a manuscript is being proofread, remembered between visits.
 *
 * Per manuscript, because proofreading is something done to a book: a writer
 * marking up a finished draft while drafting the next should not find the new
 * one in proofreading too. In the browser, like the place last read, because it
 * is a way of working at this desk rather than a fact about the book.
 *
 * Every call is wrapped. Storage throws in private windows and on a full disk,
 * and a mode that failed to remember itself is a small thing; a manuscript that
 * failed to open over it is not.
 */

const KEY = "brigid.proofreading";

function all(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function readProofreading(workId: string): boolean {
  return all()[workId] === true;
}

export function writeProofreading(workId: string, on: boolean): void {
  try {
    const held = all();
    if (on) held[workId] = true;
    else delete held[workId];
    window.localStorage.setItem(KEY, JSON.stringify(held));
  } catch {
    // Nothing to do. The mode still applies for this visit.
  }
}
