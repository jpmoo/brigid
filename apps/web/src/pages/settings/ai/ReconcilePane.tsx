import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Trash2 } from "lucide-react";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { rows: got, sections } = await api.getCast(workId);
      setRows(got);
      setOrder(new Map(sections.map((s) => [s.blockId, s.start])));
      setLabels(new Map(sections.map((s) => [s.blockId, s.label ?? "section"])));
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
      const key = row.characterName.trim().toLowerCase();
      const held = by.get(key) ?? { name: row.characterName.trim(), pending: [], committed: [] };
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
      .sort(
        (a, b) =>
          b.pending.length + b.committed.length - (a.pending.length + a.committed.length) ||
          a.name.localeCompare(b.name),
      );
  }, [rows, order]);

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
      const settled = draft[row.id];
      if (settled?.drop) continue;
      const name = (settled?.characterName ?? row.characterName).trim();
      const key = name.toLowerCase();
      const held = tally.get(key) ?? { name, actions: 0, sections: new Set<string>() };
      if ((settled?.action ?? row.action).trim()) held.actions += 1;
      held.sections.add(row.blockId);
      tally.set(key, held);
    }
    return [...tally.values()].filter(
      (t) => t.actions < MIN_ACTIONS || t.sections.size < MIN_SECTIONS,
    );
  }, [rows, draft]);

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const decisions = Object.entries(draft).map(([id, d]) => ({
        id,
        characterName: d.characterName,
        action: d.action,
        drop: d.drop,
      }));
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
  const dropping = Object.values(draft).filter((d) => d.drop).length;

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
          Nothing is profiled until this is committed.
        </p>
      )}

      {groups.map((group) => {
        const isOpen = open.has(group.name) || group.pending.length > 0;
        return (
          <div className="rec-group" key={group.name}>
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
              </span>
            </button>

            {isOpen ? (
              <div className="rec-body">
                {group.pending.map((row) => {
                  const d = draft[row.id] ?? {
                    characterName: row.characterName,
                    action: row.action,
                    drop: false,
                  };
                  return (
                    <div className={`rec-row${d.drop ? " dropped" : ""}`} key={row.id}>
                      <span className="rec-at">{labels.get(row.blockId) ?? "section"}</span>

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

                      <div className="rec-controls">
                        <select
                          value={d.characterName}
                          disabled={d.drop}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              [row.id]: { ...d, characterName: e.target.value },
                            })
                          }
                        >
                          {[...new Set([d.characterName, ...names])].map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={`rec-drop${d.drop ? " on" : ""}`}
                          title={d.drop ? "Keep it after all" : "Throw this out"}
                          aria-label={d.drop ? "Keep it after all" : "Throw this out"}
                          onClick={() => setDraft({ ...draft, [row.id]: { ...d, drop: !d.drop } })}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {group.committed.length > 0 ? (
                  <ul className="rec-settled">
                    {group.committed.map((row) => (
                      <li key={row.id}>
                        {row.action || <em>present, nothing recorded</em>}
                        {row.originName ? (
                          <span className="rec-was"> &mdash; read as {row.originName}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}

      {thin.length > 0 ? (
        <>
          <h6 className="cast-axes-head">Too little to profile</h6>
          <p className="tpl-note">
            The rubric wants citable events for any score above 1, so these would only
            ever produce a flat chart. Nothing to do about them &mdash; a walk-on with two
            lines is a true finding about the book, not an omission. They simply
            won&rsquo;t be profiled.
          </p>
          <p className="rec-thin">
            {thin
              .sort((a, b) => b.actions - a.actions)
              .map((t) => `${t.name} (${t.actions})`)
              .join(", ")}
          </p>
        </>
      ) : null}

      {waiting > 0 ? (
        <div className="be-line" style={{ marginTop: 14 }}>
          <button className="btn" type="button" disabled={busy} onClick={() => void commit()}>
            <Check size={14} />
            {busy ? "Committing…" : `Commit ${waiting} ${waiting === 1 ? "action" : "actions"}`}
          </button>
          {dropping > 0 ? (
            <span className="muted">
              {dropping} will be thrown out.
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
