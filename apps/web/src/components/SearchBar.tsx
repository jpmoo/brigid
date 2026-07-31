import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

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
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];

  const out: SearchMatch[] = [];
  for (const block of blocks) {
    const haystack = block.contentText.toLowerCase();
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
}: {
  open: boolean;
  query: string;
  matches: SearchMatch[];
  activeIndex: number;
  onOpen: () => void;
  onClose: () => void;
  onQuery: (value: string) => void;
  onStep: (delta: 1 | -1) => void;
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

          <span className="search-count">
            {query.trim().length === 0
              ? ""
              : matches.length === 0
                ? "none"
                : `${activeIndex + 1} of ${matches.length}`}
          </span>

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
