import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { ProseMarkType, Suggestion } from "@brigid/shared";

export interface PlacedSuggestion {
  blockId: string;
  suggestion: Suggestion;
}

/** Docs' own way of saying when: the time today or yesterday, the date otherwise. */
function when(at: string | null): string {
  if (!at) return "";
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return "";
  const time = then.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (then.toDateString() === today.toDateString()) return `${time} Today`;
  if (then.toDateString() === yesterday.toDateString()) return `${time} Yesterday`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * What on the page a suggestion is: its words, its emphasis, or the paragraph
 * whose break it proposes or proposes removing.
 */
const anchors = (id: string) => {
  const key = CSS.escape(id);
  return `.sug[data-sid="${key}"], p[data-split="${key}"], p[data-join="${key}"]`;
};

const EMPHASIS_NAME: Record<ProseMarkType, string> = { strong: "bold", em: "italic", underline: "underline" };

/** "Italic", "Bold, italic", "Not underlined" — a format card's own words, as Docs puts them. */
function formatWords(format: { added: ProseMarkType[]; removed: ProseMarkType[] }): string {
  const parts = [
    ...format.added.map((t) => EMPHASIS_NAME[t]),
    ...format.removed.map((t) => `not ${EMPHASIS_NAME[t]}`),
  ];
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Room between two cards stacked because their suggestions sit close together. */
const GAP = 8;

/**
 * The cards in the margin, one for each suggestion, level with the words it
 * concerns.
 *
 * Positioned against the page rather than laid out in a list, because a card is
 * about a place in the prose: reading down the chapter, the change and the card
 * describing it are side by side. When suggestions crowd a line, their cards
 * stack downward in reading order rather than overlap, which is how Docs
 * resolves the same collision.
 *
 * Placed by measuring the page after it is drawn, and placed again whenever the
 * page can have moved under them — a resize, a change of text size, the prose
 * reflowing as it is typed into.
 */
export function SuggestionCards({
  pane,
  placed,
  author,
  onResolve,
}: {
  pane: HTMLElement | null;
  placed: PlacedSuggestion[];
  author: string;
  onResolve: (blockId: string, id: string, accept: boolean) => void;
}) {
  const column = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const layout = useCallback(() => {
    const box = column.current;
    if (!pane || !box) return;
    const paneTop = pane.getBoundingClientRect().top - pane.scrollTop;
    let floor = 0;
    for (const card of Array.from(box.querySelectorAll<HTMLElement>(".sug-card"))) {
      const id = card.dataset.card!;
      const anchor = pane.querySelector<HTMLElement>(anchors(id));
      if (!anchor) {
        // Not on the page — in a section folded away in the outline. Its card
        // has nothing to sit beside.
        card.style.display = "none";
        continue;
      }
      card.style.display = "";
      const wanted = anchor.getBoundingClientRect().top - paneTop;
      const top = Math.max(wanted, floor);
      card.style.top = `${top}px`;
      floor = top + card.offsetHeight + GAP;
    }
  }, [pane]);

  useLayoutEffect(layout, [layout, placed]);

  useEffect(() => {
    if (!pane) return;
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };
    const observer = new ResizeObserver(soon);
    observer.observe(pane);
    for (const child of Array.from(pane.children)) observer.observe(child);
    // Typing reflows the lines below it, carrying their suggestions with them.
    pane.addEventListener("input", soon, true);
    // A suggestion on the page, pointed at, lights its card.
    const over = (event: Event) => {
      const sug = (event.target as HTMLElement).closest?.(".sug") as HTMLElement | null;
      setHovered(sug?.dataset.sid ?? null);
    };
    pane.addEventListener("mouseover", over);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      pane.removeEventListener("input", soon, true);
      pane.removeEventListener("mouseover", over);
    };
  }, [pane, layout]);

  /**
   * The suggestion a card is about, tinted on the page.
   *
   * Done to the elements directly rather than through the document, because the
   * open editor draws its own prose and a re-render to add a class would take
   * the caret with it. A class is not part of what is saved.
   */
  useEffect(() => {
    if (!pane) return;
    const lit = focused ?? hovered;
    for (const el of Array.from(pane.querySelectorAll(".sug.focused, p.focused[data-split], p.focused[data-join]"))) {
      el.classList.remove("focused");
    }
    if (!lit) return;
    for (const el of Array.from(pane.querySelectorAll(anchors(lit)))) {
      el.classList.add("focused");
    }
  }, [pane, focused, hovered, placed]);

  const initial = author.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="sug-cards" ref={column} aria-label="Suggestions">
      {placed.map(({ blockId, suggestion: s }) => (
        <div
          key={s.id}
          data-card={s.id}
          className={`sug-card${focused === s.id ? " active" : ""}${hovered === s.id ? " hover" : ""}`}
          onMouseEnter={() => setHovered(s.id)}
          onMouseLeave={() => setHovered((h) => (h === s.id ? null : h))}
          onClick={() => setFocused(focused === s.id ? null : s.id)}
        >
          <div className="sug-card-head">
            <span className="sug-avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="sug-who">
              <strong>{author || "You"}</strong>
              <small>{when(s.at)}</small>
            </span>
            <button
              type="button"
              className="sug-accept"
              title="Accept suggestion"
              aria-label="Accept suggestion"
              onClick={(event) => {
                event.stopPropagation();
                onResolve(blockId, s.id, true);
              }}
            >
              <Check size={18} />
            </button>
            <button
              type="button"
              className="sug-reject"
              title="Reject suggestion"
              aria-label="Reject suggestion"
              onClick={(event) => {
                event.stopPropagation();
                onResolve(blockId, s.id, false);
              }}
            >
              <X size={18} />
            </button>
          </div>
          <p className="sug-what">
            {s.kind === "replace" ? (
              <>
                Replace: “<span className="sug-quote">{s.removed}</span>” with “
                <span className="sug-quote">{s.added}</span>”
              </>
            ) : s.kind === "format" && s.format ? (
              <>Format: {formatWords(s.format)}</>
            ) : s.kind === "add" ? (
              <>
                Add: “<span className="sug-quote">{s.added}</span>”
              </>
            ) : (
              <>
                Delete: “<span className="sug-quote">{s.removed}</span>”
              </>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}
