import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search, SpellCheck, X } from "lucide-react";
import { foldForSearch } from "@brigid/shared";

export interface SearchMatch {
  blockId: string;
  /** Which occurrence within that block, so the active one can be marked. */
  indexInBlock: number;
}

/**
 * Find across the whole manuscript.
 *
 * Matching runs over each block's plain text, which is the same projection the
 * word count uses — so a match is somewhere the writer can actually be sent,
 * and the tally is of the document rather than of what happens to be on screen.
 */
export function findMatches(
  blocks: { id: string; contentText: string }[],
  query: string,
): SearchMatch[] {
  // Both sides folded the same way, so a straight apostrophe typed into the box
  // finds the typeset one the manuscript actually holds.
  const needle = foldForSearch(query.trim());
  if (needle.length === 0) return [];

  const out: SearchMatch[] = [];
  for (const block of blocks) {
    const haystack = foldForSearch(block.contentText);
    let from = 0;
    let n = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      out.push({ blockId: block.id, indexInBlock: n });
      n += 1;
      from = at + needle.length;
    }
  }
  return out;
}

export function SearchBar({
  open,
  query,
  matches,
  activeIndex,
  onOpen,
  onClose,
  onQuery,
  onStep,
  onNextMisspelling,
}: {
  open: boolean;
  query: string;
  matches: SearchMatch[];
  activeIndex: number;
  onOpen: () => void;
  onClose: () => void;
  onQuery: (value: string) => void;
  onStep: (delta: 1 | -1) => void;
  /**
   * Jump to the next word the checker doesn't know, wherever it is. Absent when
   * checking is switched off, in which case the control isn't offered.
   */
  onNextMisspelling?: (() => void) | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  return (
    <div className="search-wrap">
      <button
        className={`btn ghost${open ? " on" : ""}`}
        type="button"
        title="Search the manuscript"
        aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen())}
      >
        <Search size={16} />
      </button>

      {open ? (
        <div className="search-panel" role="search">
          <input
            ref={input}
            type="text"
            value={query}
            placeholder="Find in manuscript"
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter") {
                e.preventDefault();
                onStep(e.shiftKey ? -1 : 1);
              }
            }}
          />

          {/* Only once there is something to count. The width is held so the
              tally does not jiggle between "1 of 9" and "10 of 120", but with
              no query that reserved space is just a gap between the field and
              the buttons. */}
          {query.trim().length > 0 ? (
            <span className="search-count">
              {matches.length === 0 ? "none" : `${activeIndex + 1} of ${matches.length}`}
            </span>
          ) : null}

          {/* Nothing to do with the query: a pass through the misspellings is
              the other way of walking a manuscript, and this is where the
              walking controls already are. */}
          {onNextMisspelling ? (
            <button
              className="btn ghost"
              type="button"
              title="Next misspelling"
              aria-label="Go to the next misspelling"
              onClick={onNextMisspelling}
            >
              <SpellCheck size={15} />
            </button>
          ) : null}
          <button
            className="btn ghost"
            type="button"
            title="Previous (Shift+Enter)"
            disabled={matches.length === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronUp size={15} />
          </button>
          <button
            className="btn ghost"
            type="button"
            title="Next (Enter)"
            disabled={matches.length === 0}
            onClick={() => onStep(1)}
          >
            <ChevronDown size={15} />
          </button>
          <button className="btn ghost" type="button" title="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
