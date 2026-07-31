import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { buildOutline } from "@brigid/shared";
import { ApiError, api } from "../../api.js";
import type { Template, Work } from "../../api.js";

interface LevelRow {
  name: string;
  breakTemplateId: string | null;
  counterRestart: "continuous" | "under-parent";
}

const same = (a: LevelRow[], b: LevelRow[]) =>
  a.length === b.length &&
  a.every(
    (l, i) =>
      l.name === b[i]?.name &&
      l.breakTemplateId === b[i]?.breakTemplateId &&
      l.counterRestart === b[i]?.counterRestart,
  );

/**
 * Which break each outline depth uses.
 *
 * Levels belong to a work rather than to the app — two novels can be structured
 * differently — so this edits one at a time. Depth *is* the position in this
 * list, which is why the rows reorder rather than carrying a depth field: moving
 * a level moves every block that sits at it.
 */
export function LevelsPane({ templates }: { templates: Template[] }) {
  const [works, setWorks] = useState<Work[]>([]);
  const [workId, setWorkId] = useState("");
  const [levels, setLevels] = useState<LevelRow[]>([]);
  const [original, setOriginal] = useState<LevelRow[]>([]);
  const [depthCounts, setDepthCounts] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const breaks = useMemo(() => templates.filter((t) => t.category === "break"), [templates]);
  const dirty = !same(levels, original);
  const deepest = depthCounts.length;

  useEffect(() => {
    void (async () => {
      try {
        const [live, archived] = await Promise.all([api.listWorks(false), api.listWorks(true)]);
        const all = [...live.works, ...archived.works];
        setWorks(all);
        if (all[0]) setWorkId(all[0].id);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "could not load works");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const load = useCallback(async (id: string) => {
    setError(null);
    try {
      // Block depths come from the same traversal the outline uses, so "12
      // blocks at this level" means exactly what the outline shows.
      const [{ levels: rows }, { blocks }] = await Promise.all([
        api.listLevels(id),
        api.listBlocks(id),
      ]);
      const next = rows.map((l) => ({
        name: l.name,
        breakTemplateId: l.breakTemplateId,
        counterRestart: l.counterRestart,
      }));
      setLevels(next);
      setOriginal(next);

      const counts: number[] = [];
      for (const entry of buildOutline(blocks)) {
        counts[entry.depth] = (counts[entry.depth] ?? 0) + 1;
      }
      setDepthCounts(Array.from(counts, (n) => n ?? 0));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not load levels");
    }
  }, []);

  useEffect(() => {
    if (workId) void load(workId);
  }, [workId, load]);

  const mutate = (next: LevelRow[]) => {
    setSaved(false);
    setLevels(next);
  };
  const set = (i: number, patch: Partial<LevelRow>) =>
    mutate(levels.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const move = (i: number, delta: number) => {
    const target = i + delta;
    if (target < 0 || target >= levels.length) return;
    const next = [...levels];
    const [row] = next.splice(i, 1);
    if (row) next.splice(target, 0, row);
    mutate(next);
  };

  const remove = (i: number) => {
    const used = depthCounts[i] ?? 0;
    if (used > 0) {
      const ok = confirm(
        `${used} block${used === 1 ? "" : "s"} sit at this level.\n\n` +
          "Removing it doesn't delete them — they keep their indentation, but nothing " +
          "defines a break there, so the split before them stops rendering.\n\nRemove it anyway?",
      );
      if (!ok) return;
    }
    mutate(levels.filter((_, j) => j !== i));
  };

  async function save() {
    if (levels.some((l) => !l.name.trim())) {
      setError("every level needs a name");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { levels: rows } = await api.saveLevels(workId, levels);
      const next = rows.map((l) => ({
        name: l.name,
        breakTemplateId: l.breakTemplateId,
        counterRestart: l.counterRestart,
      }));
      setLevels(next);
      setOriginal(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not save levels");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="tpl-empty">Loading…</p>;

  if (works.length === 0) {
    return (
      <p className="tpl-empty">
        No works yet. Levels belong to a manuscript — make one first, and its structure will be
        editable here.
      </p>
    );
  }

  return (
    <>
      <p className="card-subtitle">
        A block&rsquo;s depth in the outline is its position in this list. Depth 0 is the outermost
        — set it to Chapter and the next to Scene, or add a Part above them. Dragging a block to a
        different indentation moves it to a different level, and so changes the break before it.
      </p>

      {error ? <div className="alert error">{error}</div> : null}
      {saved && !dirty ? <div className="alert ok">Levels saved.</div> : null}

      <div className="field">
        <label className="field-label" htmlFor="levelWork">
          Work
        </label>
        <select
          id="levelWork"
          value={workId}
          onChange={(e) => {
            if (dirty && !confirm("Discard unsaved changes to these levels?")) return;
            setWorkId(e.target.value);
          }}
        >
          {works.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
              {w.archivedAt ? " (archived)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="level-rows">
        <div className="level-row head">
          <span className="level-depth">#</span>
          <span className="lv-name">Name</span>
          <span className="lv-break">Break before a block at this level</span>
          <span className="lv-count">Numbering</span>
          <span className="lv-used">In use</span>
          <span className="lv-actions" />
        </div>

        {levels.map((level, i) => (
          <div className="level-row" key={i}>
            <span className="level-depth">{i}</span>
            <input
              type="text"
              className="lv-name"
              value={level.name}
              placeholder={i === 0 ? "Chapter" : "Scene"}
              onChange={(e) => set(i, { name: e.target.value })}
            />
            <select
              className="lv-break"
              value={level.breakTemplateId ?? ""}
              onChange={(e) => set(i, { breakTemplateId: e.target.value || null })}
            >
              <option value="">No break — runs straight on</option>
              {breaks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <select
              className="lv-count"
              value={level.counterRestart}
              onChange={(e) =>
                set(i, { counterRestart: e.target.value as "continuous" | "under-parent" })
              }
            >
              <option value="continuous">1, 2, 3 throughout</option>
              <option value="under-parent">Restart under each parent</option>
            </select>
            <span className="lv-used" title="Blocks currently at this depth">
              {depthCounts[i] ?? 0}
            </span>
            <span className="lv-actions">
              <button className="btn ghost" type="button" title="Move up" onClick={() => move(i, -1)}>
                <ArrowUp size={13} />
              </button>
              <button className="btn ghost" type="button" title="Move down" onClick={() => move(i, 1)}>
                <ArrowDown size={13} />
              </button>
              <button
                className="btn ghost"
                type="button"
                title="Remove level"
                disabled={levels.length <= 1}
                onClick={() => remove(i)}
              >
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        ))}
      </div>

      {deepest > levels.length ? (
        <div className="alert error" style={{ marginTop: 12 }}>
          This manuscript has blocks nested {deepest} deep, but only {levels.length} level
          {levels.length === 1 ? "" : "s"} are defined. Blocks below the last level render with no
          break before them.
        </div>
      ) : null}

      <div className="modal-actions">
        <button
          className="btn secondary"
          type="button"
          onClick={() =>
            mutate([...levels, { name: "", breakTemplateId: null, counterRestart: "continuous" }])
          }
        >
          <Plus size={14} /> Add level
        </button>
        <div className="spacer" />
        {dirty ? <span className="muted lv-dirty">Unsaved changes</span> : null}
        <button
          className="btn secondary"
          type="button"
          disabled={!dirty || busy}
          onClick={() => {
            setLevels(original);
            setSaved(false);
          }}
        >
          Revert
        </button>
        <button className="btn" type="button" onClick={() => void save()} disabled={!dirty || busy}>
          {busy ? "Saving…" : "Save levels"}
        </button>
      </div>
    </>
  );
}
