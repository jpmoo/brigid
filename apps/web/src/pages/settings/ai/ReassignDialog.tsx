import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ReassignMove, ReassignProposal } from "@brigid/shared";
import { ApiError, api } from "../../../api.js";

/**
 * What becomes of a non-character's record.
 *
 * The writer has said this entry is not a person. Its actions still happened,
 * though, and dropping them would quietly weaken every profile that should have
 * had them — so each is offered to a real member of the cast, and the writer
 * settles it before anything is written.
 *
 * Every target is editable. The model is guessing from an action list without
 * the prose around it, and it will get some wrong; a proposal that could only be
 * accepted whole would be worse than no proposal, because approving it would
 * mean approving its mistakes.
 */
export function ReassignDialog({
  workId,
  name,
  cast,
  onClose,
  onApplied,
}: {
  workId: string;
  name: string;
  cast: string[];
  onClose: () => void;
  onApplied: (reprofiling: string[]) => void;
}) {
  const [proposal, setProposal] = useState<ReassignProposal | null>(null);
  const [moves, setMoves] = useState<ReassignMove[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { proposal: p } = await api.proposeReassignment(workId, name);
        if (!alive) return;
        setProposal(p);
        setMoves(p.moves);
      } catch (err) {
        if (alive) setError(err instanceof ApiError ? err.message : "could not work that out");
      }
    })();
    return () => {
      alive = false;
    };
  }, [workId, name]);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const { reprofiling } = await api.applyReassignment(workId, name, moves);
      onApplied(reprofiling);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not apply that");
      setBusy(false);
    }
  }

  const going = moves.filter((m) => m.to).length;
  const dropped = moves.length - going;
  const affected = [...new Set(moves.map((m) => m.to).filter(Boolean))] as string[];

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal wide cast-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>

        <h2 className="card-title">&ldquo;{name}&rdquo; is not a character</h2>
        <p className="card-subtitle">
          Its recorded actions still happened. Say who they belong to, and they move
          there instead of being lost.
        </p>

        <div className="modal-body">
          {error ? <div className="alert error">{error}</div> : null}

          {!proposal && !error ? (
            <p className="tpl-note">
              Working out where each action belongs&hellip; this takes a moment.
            </p>
          ) : null}

          {proposal ? (
            <>
              {proposal.reason ? <p className="fit-overview">{proposal.reason}</p> : null}

              {moves.length === 0 ? (
                <p className="tpl-note">
                  Nothing was recorded against it, so there is nothing to move. Ruling it
                  out will simply remove it.
                </p>
              ) : (
                <>
                  <p className="tpl-note">
                    {going} of {moves.length}{" "}
                    {moves.length === 1 ? "action goes" : "actions go"} to a character
                    {dropped > 0 ? `, ${dropped} belong to nobody and will be dropped` : ""}.
                    Change any of them.
                  </p>

                  {moves.map((move, i) => (
                    <div className="reassign-row" key={`${move.blockId}-${i}`}>
                      <p className="reassign-action">{move.action}</p>
                      <div className="reassign-to">
                        <select
                          value={move.to ?? ""}
                          onChange={(e) =>
                            setMoves(
                              moves.map((m, n) =>
                                n === i ? { ...m, to: e.target.value || null } : m,
                              ),
                            )
                          }
                        >
                          <option value="">Nobody &mdash; drop it</option>
                          {cast.map((who) => (
                            <option key={who} value={who}>
                              {who}
                            </option>
                          ))}
                        </select>
                        {move.why ? <span className="reassign-why">{move.why}</span> : null}
                      </div>
                    </div>
                  ))}
                </>
              )}

              <p className="tpl-note">
                {affected.length > 0 ? (
                  <>
                    Approving rewrites the reading and profiles{" "}
                    <strong>{affected.join(", ")}</strong> again &mdash; one model call each,
                    in the background. Other characters are untouched.
                  </>
                ) : (
                  <>Approving removes the entry. Nothing else changes.</>
                )}
              </p>
            </>
          ) : null}
        </div>

        <div className="modal-actions">
          <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" type="button" onClick={() => void apply()} disabled={busy || !proposal}>
            {busy ? "Applying…" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
