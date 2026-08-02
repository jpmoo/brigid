import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { IdentityProposal } from "@brigid/shared";
import { ApiError, api } from "../../../api.js";

/**
 * Who in this cast is the same person.
 *
 * The reading is done section by section, so it cannot see this: the section
 * that wrote "the housekeeper" had no way of knowing a later one would write
 * "Mrs Reynolds". Name folding catches the mechanical cases and those two share
 * no letters, so only something that has read the book can join them.
 *
 * Nothing is merged without approval, and the default is not to merge. A wrong
 * fold silently fuses two people into a character who is not in the book, which
 * is far worse than the duplicate it was fixing — so every group is opt-in
 * rather than opt-out.
 */
export function IdentityDialog({
  workId,
  onClose,
  onApplied,
}: {
  workId: string;
  onClose: () => void;
  onApplied: (reprofiling: string[]) => void;
}) {
  const [proposal, setProposal] = useState<IdentityProposal | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [canonical, setCanonical] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { proposal: p } = await api.proposeIdentities(workId);
        if (!alive) return;
        setProposal(p);
        setCanonical(Object.fromEntries(p.groups.map((g, i) => [i, g.canonical])));
      } catch (err) {
        if (alive) setError(err instanceof ApiError ? err.message : "could not work that out");
      }
    })();
    return () => {
      alive = false;
    };
  }, [workId]);

  async function apply() {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      const groups = [...chosen].map((i) => ({
        canonical: canonical[i] ?? proposal.groups[i]!.canonical,
        names: proposal.groups[i]!.names,
      }));
      const { reprofiling } = await api.applyIdentities(workId, groups);
      onApplied(reprofiling);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not apply that");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal wide cast-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>

        <h2 className="card-title">Reconcile the cast</h2>
        <p className="card-subtitle">
          The book was read a section at a time, so one person may have been recorded
          under several names. Tick the ones you agree with.
        </p>

        <div className="modal-body">
          {error ? <div className="alert error">{error}</div> : null}

          {!proposal && !error ? (
            <p className="tpl-note">Comparing the whole cast&hellip; this takes a moment.</p>
          ) : null}

          {proposal ? (
            <>
              {proposal.groups.length === 0 ? (
                <p className="tpl-note">
                  Nothing in the cast reads as the same person recorded twice.
                </p>
              ) : (
                proposal.groups.map((group, i) => (
                  <div className="identity-group" key={i}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={chosen.has(i)}
                        onChange={(e) => {
                          const next = new Set(chosen);
                          if (e.target.checked) next.add(i);
                          else next.delete(i);
                          setChosen(next);
                        }}
                      />
                      <span className="identity-names">{group.names.join("  =  ")}</span>
                    </label>

                    <p className="identity-why">{group.why}</p>

                    {chosen.has(i) ? (
                      <label className="bk-field">
                        <span>Keep the name</span>
                        <select
                          value={canonical[i] ?? group.canonical}
                          onChange={(e) => setCanonical({ ...canonical, [i]: e.target.value })}
                        >
                          {group.names.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                ))
              )}

              {proposal.suspects.length > 0 ? (
                <>
                  <h6 className="cast-axes-head">One name, two people?</h6>
                  <p className="tpl-note">
                    These read as though the same name has been applied to more than one
                    character. Splitting them isn&rsquo;t automatic &mdash; use{" "}
                    <em>is not a character</em> on the tile to reassign the actions by hand.
                  </p>
                  <ul className="fit-list">
                    {proposal.suspects.map((s) => (
                      <li key={s.name}>
                        <strong>{s.name}</strong> <span className="fit-ev">{s.why}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {chosen.size > 0 ? (
                <p className="tpl-note">
                  Approving rewrites the reading and profiles the{" "}
                  {chosen.size === 1 ? "merged character" : `${chosen.size} merged characters`}{" "}
                  again. Everyone else is untouched.
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="modal-actions">
          <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => void apply()}
            disabled={busy || chosen.size === 0}
          >
            {busy ? "Merging…" : `Merge ${chosen.size || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
