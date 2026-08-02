import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Eraser, RotateCcw, Trash2, UserMinus } from "lucide-react";
import { foldName } from "@brigid/shared";
import { ApiError, api } from "../../../api.js";
import type { CastRow } from "../../../api.js";

/**
 * Settling what the reading gathered, before anything is scored.
 *
 * The reading proposes and this is where the writer disposes. Every gathered
 * action can be moved to whoever actually did it, reworded, or thrown out, and
 * nothing reaches a profile until it has been committed — which is the whole
 * reason this screen exists. A chart built on a misattributed line is not a
 * weaker answer than one built on a good line; it is a wrong one, and there was
 * previously no moment at which anyone could have noticed.
 */

/** Below this a character cannot produce a profile the rubric would accept. */
const MIN_ACTIONS = 6;
const MIN_SECTIONS = 2;

interface Draft {
  characterName: string;
  action: string;
  drop: boolean;
}

export function ReconcilePane({
  workId,
  pending,
  onCommitted,
}: {
  workId: string;
  pending: number;
  onCommitted: (affected: string[]) => void;
}) {
  const [rows, setRows] = useState<CastRow[] | null>(null);
  const [order, setOrder] = useState<Map<string, number>>(new Map());
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Who each thrown-out line would come back to. */
  const [revive, setRevive] = useState<Record<string, string>>({});
  /** A character whose blank-slate reset is waiting on its confirmation. */
  const [resetting, setResetting] = useState<string | null>(null);
  /** A name whose removal from the cast is waiting on its confirmation. */
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { rows: got, sections } = await api.getCast(workId);
      setRows(got);
      setOrder(new Map(sections.map((s) => [s.blockId, s.start])));
      setLabels(new Map(sections.map((s) => [s.blockId, s.label ?? "section"])));
      setPicked(new Set());
      /**
       * Characters with new material start open, so the queue shows what it is
       * asking about — but only as a starting position. The toggle then means
       * what it says, which it did not when a pending row forced a group open
       * and left the chevron pointing at something that would not move.
       */
      setOpen(
        new Set(got.filter((r) => r.state === "pending").map((r) => r.characterName.trim())),
      );
      setDraft(
        Object.fromEntries(
          got
            .filter((r) => r.state === "pending")
            .map((r) => [r.id, { characterName: r.characterName, action: r.action, drop: false }]),
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not load what was gathered");
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load, pending]);

  /**
   * Grouped by character, in book order within each. The queue is read as "what
   * does this book say about this person", not as a list of rows in the order a
   * machine happened to produce them.
   */
  const groups = useMemo(() => {
    if (!rows) return [];
    const by = new Map<string, { name: string; pending: CastRow[]; committed: CastRow[] }>();
    for (const row of rows) {
      if (row.state === "dropped") continue;
      /**
       * By where the draft puts it, not by where the reading did. Reassigning a
       * thin character's actions to the person they belong to is how that
       * person clears the threshold — so the row has to move the moment it is
       * reassigned, or it would sit in a group that cannot commit it and could
       * never leave. Folded, as the roster folds, so "Brother Tuan" and "Tuan"
       * are one group here as they are everywhere else.
       */
      const key = foldName(draft[row.id]?.characterName ?? row.characterName);
      const held =
        by.get(key) ??
        { name: (draft[row.id]?.characterName ?? row.characterName).trim(), pending: [], committed: [] };
      // A draft may have moved this row to someone else since it loaded.
      if (row.state === "pending") held.pending.push(row);
      else held.committed.push(row);
      by.set(key, held);
    }
    const at = (r: CastRow) => order.get(r.blockId) ?? 0;
    return [...by.values()]
      .map((g) => ({
        ...g,
        pending: [...g.pending].sort((a, b) => at(a) - at(b)),
        committed: [...g.committed].sort((a, b) => at(a) - at(b)),
      }))
      /**
       * Most actions first. The characters with the most gathered are the ones
       * worth settling, and the ones a mistake costs most on — a walk-on with
       * two lines can wait at the bottom.
       */
      .sort(
        (a, b) =>
          b.pending.length + b.committed.length - (a.pending.length + a.committed.length) ||
          a.name.localeCompare(b.name),
      );
  }, [rows, order, draft]);

  /**
   * How many actions each group would have once committed. The threshold is a
   * property of the whole record, so it is counted here rather than inferred
   * from whatever is on screen.
   */
  const strength = useMemo(() => {
    const by = new Map<string, { actions: number; sections: Set<string> }>();
    for (const group of groups) {
      const held = { actions: 0, sections: new Set<string>() };
      for (const row of [...group.pending, ...group.committed]) {
        if (draft[row.id]?.drop) continue;
        if ((draft[row.id]?.action ?? row.action).trim()) held.actions += 1;
        held.sections.add(row.blockId);
      }
      by.set(foldName(group.name), held);
    }
    return by;
  }, [groups, draft]);

  const tooThin = (name: string): boolean => {
    const held = strength.get(foldName(name));
    if (!held) return true;
    return held.actions < MIN_ACTIONS || held.sections.size < MIN_SECTIONS;
  };

  /** Every name currently in play, for the "move to" menus. */
  const names = useMemo(
    () => [...new Set(groups.map((g) => g.name))].sort((a, b) => a.localeCompare(b)),
    [groups],
  );

  /**
   * Who would be too thin to profile once this is committed.
   *
   * Listed rather than acted on. A walk-on with two lines is a correct finding
   * about the book, not an omission to be corrected, and making the writer
   * dispose of each one before they can profile anybody would be busywork.
   */
  const thin = useMemo(() => {
    const tally = new Map<string, { name: string; actions: number; sections: Set<string> }>();
    for (const row of rows ?? []) {
      if (row.state === "dropped") continue;
      const settled = draft[row.id];
      if (settled?.drop) continue;
      const name = (settled?.characterName ?? row.characterName).trim();
      const key = foldName(name);
      const held = tally.get(key) ?? { name, actions: 0, sections: new Set<string>() };
      if ((settled?.action ?? row.action).trim()) held.actions += 1;
      held.sections.add(row.blockId);
      tally.set(key, held);
    }
    return [...tally.values()].filter(
      (t) => t.actions < MIN_ACTIONS || t.sections.size < MIN_SECTIONS,
    );
  }, [rows, draft]);

  /** Put a thrown-out line back. Takes effect at once — it only re-queues it. */
  async function restore(id: string, characterName?: string) {
    setBusy(true);
    setError(null);
    try {
      await api.commitCast(workId, [{ id, restore: true, characterName }]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not put that back");
    } finally {
      setBusy(false);
    }
  }

  /** Every line for one character back into the queue, and the profile gone. */
  async function reset(name: string) {
    setBusy(true);
    setError(null);
    try {
      await api.resetCharacter(workId, name);
      setResetting(null);
      await load();
      onCommitted([name]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `could not reset ${name}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Moving a line, at once.
   *
   * It has to be at once: a line under a character too thin to commit could
   * otherwise never leave, since that character has no tick. It stays pending
   * — it now needs reviewing under whoever it landed on, which is a different
   * question from the one just answered.
   */
  async function assign(id: string, characterName: string) {
    setBusy(true);
    setError(null);
    try {
      await api.commitCast(workId, [{ id, characterName, assign: true }]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not move that");
    } finally {
      setBusy(false);
    }
  }

  /** Throwing one out, at once. Reversible from the list below. */
  async function discard(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.commitCast(workId, [{ id, drop: true }]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not throw that out");
    } finally {
      setBusy(false);
    }
  }

  /** Take a name out of the cast entirely. It stays out across re-readings. */
  async function remove(name: string) {
    setBusy(true);
    setError(null);
    try {
      await api.notACharacter(workId, name);
      setRemoving(null);
      await load();
      onCommitted([name]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `could not remove ${name}`);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      /**
       * Only what is selected. Settling a queue of hundreds is done in
       * sittings, and a Commit that swept in every row the writer had merely
       * scrolled past would make the gate meaningless — the whole point is that
       * nothing is committed by omission.
       */
      const decisions = [...picked]
        .map((id) => {
          const d = draft[id];
          return d
            ? { id, characterName: d.characterName, action: d.action, drop: d.drop }
            : null;
        })
        .filter((d): d is NonNullable<typeof d> => d !== null);
      const { affected } = await api.commitCast(workId, decisions);
      await load();
      onCommitted(affected);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not commit that");
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return <p className="tpl-note">{error ?? "Loading…"}</p>;

  const waiting = rows.filter((r) => r.state === "pending").length;
  const binned = rows.filter((r) => r.state === "dropped");


  return (
    <>
      {error ? <div className="alert error">{error}</div> : null}

      {waiting === 0 ? (
        <p className="tpl-note">
          Everything gathered has been settled. New material from later reading will
          appear here to be reviewed before it changes anything.
        </p>
      ) : (
        <p className="tpl-note">
          <strong>
            {waiting} {waiting === 1 ? "action" : "actions"} to review
          </strong>{" "}
          &mdash; move any to whoever actually did it, reword it, or throw it out.
          Tick what you have settled and commit it; the rest waits here, and can wait
          indefinitely &mdash; only committed actions are profiled, so anything still
          outstanding is simply not counted yet.
        </p>
      )}

      {thin.length > 0 ? (
        <div className="rec-thin-panel">
          <h6 className="cast-axes-head" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
            Not enough yet to profile
          </h6>
          <p className="tpl-note">
            The rubric wants citable events for any score above 1, so on this much these
            would only produce a flat chart. They have no tick and cannot be committed
            &mdash; committing them would settle a record that still cannot be used.
          </p>
          <p className="tpl-note">
            Two things move them off this list. Later sections may bring more. And several
            of these are usually one person the reading named twice: reassign their actions
            to whoever they belong to and the row moves into that character straight away,
            where it can be committed. Genuine walk-ons stay here, which is a true finding
            about the book rather than an omission.
          </p>
          <p className="rec-thin">
            {thin
              .sort((a, b) => b.actions - a.actions)
              .map((t) => `${t.name} (${t.actions})`)
              .join(", ")}
          </p>
        </div>
      ) : null}

      {waiting > 0 ? (
        <div className="rec-bar">
          <label className="check rec-all">
            <input
              type="checkbox"
              checked={picked.size > 0 && picked.size === waiting}
              ref={(el) => {
                // Some but not all: the box should say so rather than reading
                // as "none selected" while a dozen are.
                if (el) el.indeterminate = picked.size > 0 && picked.size < waiting;
              }}
              onChange={(e) =>
                setPicked(
                  e.target.checked
                    ? // Select-all means everything that could actually be
                      // committed, which excludes anyone still too thin.
                      new Set(
                        groups
                          .filter((g) => !tooThin(g.name))
                          .flatMap((g) => g.pending.map((r) => r.id)),
                      )
                    : new Set(),
                )
              }
            />
            <span>{picked.size > 0 ? `${picked.size} selected` : "Select all"}</span>
          </label>

          {picked.size > 0 ? (
            <>
              <span className="be-gap" />
              <span className="muted">
                Ticks are for committing. Move or throw out a line with the controls
                beside it &mdash; those take effect at once.
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      {removing ? (
        <div className="modal-backdrop" onClick={() => setRemoving(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="card-title">Remove {removing} from the cast?</h2>
            <p className="card-subtitle">
              Nothing is recorded against {removing}, so they are either not a character
              at all &mdash; a crowd, a place, a title read as a name &mdash; or everything
              they did has been moved to someone else.
            </p>
            <p className="tpl-note">
              Removing keeps them out even when the manuscript is read again. Leaving them
              costs nothing: they sit in the cast collecting whatever later sections bring,
              and can be removed at any time.
            </p>
            <div className="modal-actions">
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={() => setRemoving(null)}
              >
                Leave them to gather
              </button>
              <button
                className="btn danger"
                type="button"
                disabled={busy}
                onClick={() => void remove(removing)}
              >
                {busy ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetting ? (
        <div className="modal-backdrop" onClick={() => setResetting(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="card-title">Start {resetting} over?</h2>
            <p className="card-subtitle">
              Every line ever gathered for {resetting} comes back into the queue &mdash;
              the ones you settled and the ones you threw out &mdash; worded as the
              reading first recorded them. Their profile is deleted.
            </p>
            <p className="tpl-note">
              This is the way back from settling someone wrongly. Nothing else is touched,
              and the manuscript does not have to be read again.
            </p>
            <div className="modal-actions">
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={() => setResetting(null)}
              >
                Leave it as it is
              </button>
              <button
                className="btn danger"
                type="button"
                disabled={busy}
                onClick={() => void reset(resetting)}
              >
                {busy ? "Resetting…" : "Start over"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {groups.map((group) => {
        const isOpen = open.has(group.name);
        return (
          <div className="rec-group" key={group.name}>
            <div className="rec-head-row">
              {/* Selection is by character: the decision "everything this
                  reading said about Tuan is wrong" is a real one, and far more
                  common than picking rows out of a list at random. */}
              {group.pending.length > 0 && !tooThin(group.name) ? (
                <input
                  type="checkbox"
                  aria-label={`Select every new action for ${group.name}`}
                  checked={group.pending.every((r) => picked.has(r.id))}
                  ref={(el) => {
                    if (el) {
                      const some = group.pending.some((r) => picked.has(r.id));
                      el.indeterminate = some && !group.pending.every((r) => picked.has(r.id));
                    }
                  }}
                  onChange={(e) => {
                    const next = new Set(picked);
                    for (const row of group.pending) {
                      if (e.target.checked) next.add(row.id);
                      else next.delete(row.id);
                    }
                    setPicked(next);
                  }}
                />
              ) : (
                <span className="rec-nopick" />
              )}

              <button
                type="button"
                className="rec-head"
                aria-expanded={isOpen}
                onClick={() => {
                  const next = new Set(open);
                  if (!next.delete(group.name)) next.add(group.name);
                  setOpen(next);
                }}
              >
                <ChevronRight size={14} className="fit-caret" aria-hidden="true" />
                <span className="rec-name">{group.name}</span>
                <span className="rec-tally">
                  {group.pending.length > 0 ? (
                    <span className="rec-new">{group.pending.length} new</span>
                  ) : null}
                  {group.committed.length} settled
                  {tooThin(group.name) ? (
                    <span className="rec-thin-badge">not enough to profile</span>
                  ) : null}
                </span>
              </button>

              {/* Nobody does anything: either a name the reading raised that is
                  not a character, or someone whose actions have all been moved
                  away. Removing is offered rather than done — a name with
                  nothing yet may still be someone the book gets to. */}
              {strength.get(foldName(group.name))?.actions === 0 ? (
                <button
                  type="button"
                  className="rec-reset"
                  title={`Remove ${group.name} from the cast`}
                  aria-label={`Remove ${group.name} from the cast`}
                  disabled={busy}
                  onClick={() => setRemoving(group.name)}
                >
                  <UserMinus size={13} />
                </button>
              ) : null}

              {group.committed.length > 0 ? (
                <button
                  type="button"
                  className="rec-reset"
                  title={`Start ${group.name} over`}
                  aria-label={`Start ${group.name} over`}
                  onClick={() => setResetting(group.name)}
                >
                  <Eraser size={13} />
                </button>
              ) : null}
            </div>

            {isOpen ? (
              <div className="rec-body">
                {group.pending.length > 0 ? (
                  <div className="rec-table-wrap">
                    <table className="rec-table">
                      <tbody>
                {group.pending.map((row) => {
                  const d = draft[row.id] ?? {
                    characterName: row.characterName,
                    action: row.action,
                    drop: false,
                  };
                  return (
                    <tr className={`rec-row${d.drop ? " dropped" : ""}`} key={row.id}>
                      <td className="rec-cell-pick">
                        {tooThin(group.name) ? null : (
                        <input
                          type="checkbox"
                          aria-label="Select this action"
                          checked={picked.has(row.id)}
                          onChange={(e) => {
                            const next = new Set(picked);
                            if (e.target.checked) next.add(row.id);
                            else next.delete(row.id);
                            setPicked(next);
                          }}
                        />
                        )}
                      </td>
                      <td className="rec-cell-at">{labels.get(row.blockId) ?? "section"}</td>
                      <td className="rec-cell-action">
                      {row.action ? (
                        <textarea
                          className="rec-action"
                          rows={2}
                          value={d.action}
                          disabled={d.drop}
                          onChange={(e) =>
                            setDraft({ ...draft, [row.id]: { ...d, action: e.target.value } })
                          }
                        />
                      ) : (
                        <span className="rec-empty">
                          Recorded as present, with nothing done.
                        </span>
                      )}

                      </td>
                      <td className="rec-cell-to">
                        <div className="rec-to-inner">
                        <select
                          value={d.characterName}
                          disabled={busy}
                          onChange={(e) => void assign(row.id, e.target.value)}
                        >
                          {[...new Set([d.characterName, ...names])].map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="rec-drop"
                          title="Throw this out"
                          aria-label="Throw this out"
                          disabled={busy}
                          onClick={() => void discard(row.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                      </tbody>
                    </table>
                  </div>
                ) : null}

                {group.committed.length > 0 ? (
                  <div className="rec-table-wrap">
                    <table className="rec-table settled">
                      <tbody>
                        {group.committed.map((row) => (
                          // Settled: shown for reference, not for editing. There
                          // is one way to reopen these, and it is the whole
                          // character at once — see "Start this character over".
                          <tr className="rec-row locked" key={row.id}>
                            <td className="rec-cell-pick" />
                            <td className="rec-cell-at">{labels.get(row.blockId) ?? "section"}</td>
                            <td className="rec-cell-action">
                              {row.action || <em>present, nothing recorded</em>}
                              {row.originName ? (
                                <span className="rec-was"> &mdash; read as {row.originName}</span>
                              ) : null}
                            </td>
                            <td className="rec-cell-to">
                              <span className="rec-locked-note">settled</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}

      {binned.length > 0 ? (
        <>
          <h6 className="cast-axes-head">Thrown out</h6>
          <p className="tpl-note">
            Kept rather than deleted, so a line thrown out in a batch of forty can come
            back without re-reading the section. Restoring one puts it back in the queue
            to be settled again.
          </p>
          <ul className="rec-binned">
            {binned.map((row) => (
              <li key={row.id}>
                <span>{row.action || <em>present, nothing recorded</em>}</span>
                {/* Put it back somewhere, not just back. A line usually gets
                    thrown out because it was filed under the wrong person, so
                    reviving it without saying who did it invites the same
                    decision a second time. */}
                <select
                  value={revive[row.id] ?? row.characterName}
                  onChange={(e) => setRevive({ ...revive, [row.id]: e.target.value })}
                >
                  {[...new Set([row.characterName, ...names])].map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rec-restore"
                  title="Put it back in the queue"
                  aria-label="Put it back in the queue"
                  disabled={busy}
                  onClick={() => void restore(row.id, revive[row.id] ?? row.characterName)}
                >
                  <RotateCcw size={13} />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {waiting > 0 ? (
        <div className="be-line" style={{ marginTop: 14 }}>
          <button
            className="btn"
            type="button"
            disabled={busy || picked.size === 0}
            onClick={() => void commit()}
          >
            <Check size={14} />
            {busy
              ? "Committing…"
              : picked.size === 0
                ? "Select what to commit"
                : `Commit ${picked.size} ${picked.size === 1 ? "action" : "actions"}`}
          </button>

        </div>
      ) : null}
    </>
  );
}
