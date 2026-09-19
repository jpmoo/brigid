import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import type { PlacedSuggestion } from "./SuggestionCards.js";

/** A suggestion in a few words, for the bar's tooltip where there is no card. */
function describe(placed: PlacedSuggestion | undefined): string {
  if (!placed) return "";
  const s = placed.suggestion;
  if (s.kind === "replace") return `Replace “${s.removed}” with “${s.added}”`;
  if (s.kind === "add") return `Add “${s.added}”`;
  if (s.kind === "delete") return `Delete “${s.removed}”`;
  return "Format";
}

/**
 * Stepping through suggestions, one at a time.
 *
 * Docs' Review suggested edits: previous and next, and Accept and Reject that
 * settle the one in hand and move straight to the next — which is how a pass
 * through a proofread chapter actually goes, and what the cards alone could not
 * do without scrolling to find each in turn.
 *
 * Also the only way to review suggestions singly where the window is too narrow
 * for the cards; there the current suggestion is the tinted one on the page.
 */
export function ReviewBar({
  placed,
  current,
  onGo,
  onSettle,
}: {
  placed: PlacedSuggestion[];
  current: string | null;
  onGo: (id: string) => void;
  onSettle: (accept: boolean) => void;
}) {
  if (placed.length === 0) return null;
  const index = placed.findIndex((p) => p.suggestion.id === current);
  const step = (delta: 1 | -1) => {
    const from = index === -1 ? (delta === 1 ? -1 : 0) : index;
    const next = placed[(from + delta + placed.length) % placed.length];
    if (next) onGo(next.suggestion.id);
  };
  const here = index === -1 ? undefined : placed[index];

  return (
    <div className="review-bar" role="group" aria-label="Review suggestions">
      <button type="button" className="btn ghost" title="Previous suggestion" onClick={() => step(-1)}>
        <ChevronUp size={15} />
      </button>
      <button type="button" className="btn ghost" title="Next suggestion" onClick={() => step(1)}>
        <ChevronDown size={15} />
      </button>
      <span className="review-count" title={describe(here)}>
        {index === -1
          ? `${placed.length} ${placed.length === 1 ? "suggestion" : "suggestions"}`
          : `${index + 1} of ${placed.length}`}
      </span>
      <button
        type="button"
        className="btn ghost review-accept"
        title="Accept, and go to the next"
        disabled={!here}
        onClick={() => onSettle(true)}
      >
        <Check size={15} />
        <span className="review-label">Accept</span>
      </button>
      <button
        type="button"
        className="btn ghost review-reject"
        title="Reject, and go to the next"
        disabled={!here}
        onClick={() => onSettle(false)}
      >
        <X size={15} />
        <span className="review-label">Reject</span>
      </button>
    </div>
  );
}
