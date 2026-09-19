import { useState } from "react";
import { Check, CheckCheck, ChevronDown, Pencil, PencilLine, X } from "lucide-react";

/**
 * Editing or proofreading, as Google Docs offers editing or suggesting.
 *
 * A dropdown rather than a toggle, because the difference is not obvious from a
 * word and each choice is worth one line saying what it does. Green when
 * proofreading, in the suggestions' own color, so the mode is visible from
 * across the room — typing in the wrong one is the mistake this exists to
 * prevent.
 */
export function ModeSwitch({
  proofreading,
  onChange,
  compact = false,
  pending = 0,
  onSettleAll,
}: {
  proofreading: boolean;
  onChange: (proofreading: boolean) => void;
  /** Icon only, for the floating bar where every pixel of width counts. */
  compact?: boolean;
  /** How many suggestions are waiting, anywhere in the manuscript. */
  pending?: number;
  /** Accept or reject every one of them, after the page has asked. */
  onSettleAll?: (accept: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = (next: boolean) => {
    setOpen(false);
    if (next !== proofreading) onChange(next);
  };

  return (
    <div className="mode-switch">
      <button
        className={`btn ghost mode-button${proofreading ? " proofreading" : ""}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={proofreading ? "Proofreading — edits become suggestions" : "Editing — edits change the manuscript"}
        onClick={() => setOpen(!open)}
      >
        {proofreading ? <PencilLine size={15} /> : <Pencil size={15} />}
        {compact ? null : <span>{proofreading ? "Proofreading" : "Editing"}</span>}
        {pending > 0 ? <span className="mode-count">{pending}</span> : null}
        <ChevronDown size={13} />
      </button>

      {open ? (
        <>
          <div className="menu-scrim" role="presentation" onClick={() => setOpen(false)} />
          <div className="menu mode-menu" role="menu">
            <button type="button" role="menuitemradio" aria-checked={!proofreading} onClick={() => pick(false)}>
              <Pencil size={16} />
              <span className="mode-text">
                <strong>Editing</strong>
                <small>Edit the manuscript directly</small>
              </span>
              {proofreading ? null : <Check size={15} className="mode-check" />}
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={proofreading}
              className="proofreading"
              onClick={() => pick(true)}
            >
              <PencilLine size={16} />
              <span className="mode-text">
                <strong>Proofreading</strong>
                <small>Edits become suggestions to accept or reject</small>
              </span>
              {proofreading ? <Check size={15} className="mode-check" /> : null}
            </button>

            {/* Docs keeps these under Review suggested edits. Here they live
                with the mode, which is where a writer finishing a pass goes. */}
            {pending > 0 && onSettleAll ? (
              <>
                <hr />
                <div className="mode-pending">
                  {pending} {pending === 1 ? "suggestion" : "suggestions"} waiting
                </div>
                <button type="button" onClick={() => { setOpen(false); onSettleAll(true); }}>
                  <CheckCheck size={16} />
                  <span className="mode-text">
                    <strong>Accept all</strong>
                  </span>
                </button>
                <button type="button" onClick={() => { setOpen(false); onSettleAll(false); }}>
                  <X size={16} />
                  <span className="mode-text">
                    <strong>Reject all</strong>
                  </span>
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
