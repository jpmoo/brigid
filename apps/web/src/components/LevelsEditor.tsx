import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { buildOutline } from "@brigid/shared";
import { ApiError, api } from "../api.js";
import type { Block, Template } from "../api.js";
import { useDialogs } from "./Dialogs.js";
import { useSavedFlash } from "../useSavedFlash.js";

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
 * The levels of one manuscript: what each depth of the outline is called, and
 * which break opens a block sitting at it.
 *
 * This belongs to the work, not to the app — two novels can be structured
 * differently — so it's edited from inside the work, where its effect is
 * visible, rather than from a global screen that would have to ask which
 * manuscript you meant.
 */
export function LevelsEditor({
  workId,
  blocks,
  templates,
}: {
  workId: string;
  blocks: Block[];
  templates: Template[];
}) {
  const dialogs = useDialogs();
  const [levels, setLevels] = useState<LevelRow[]>([]);
  const [original, setOriginal] = useState<LevelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, flashSaved] = useSavedFlash();
  const [busy, setBusy] = useState(false);

  const breaks = useMemo(() => templates.filter((t) => t.category === "break"), [templates]);
  const dirty = !same(levels, original);

  // Depths come from the same traversal the outline uses, so "12 blocks at this
  // level" means exactly what the outline shows.
  const depthCounts = useMemo(() => {
    const counts: number[] = [];
    for (const entry of buildOutline(blocks)) {
      counts[entry.depth] = (counts[entry.depth] ?? 0) + 1;
    }
    return Array.from(counts, (n) => n ?? 0);
  }, [blocks]);
  const deepest = depthCounts.length;

  const load = useCallback(async () => {
    try {
      const { levels: rows } = await api.listLevels(workId);
      const next = rows.map((l) => ({
        name: l.name,
        breakTemplateId: l.breakTemplateId,
        counterRestart: l.counterRestart,
      }));
      setLevels(next);
      setOriginal(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not load levels");
    } finally {
      setLoading(false);
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = (next: LevelRow[]) => setLevels(next);
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

  const remove = async (i: number) => {
    const used = depthCounts[i] ?? 0;
    if (used > 0) {
      const ok = await dialogs.confirm({
        title: "Remove this level?",
        message: `${used} block${used === 1 ? "" : "s"} sit at this level. Removing it doesn't delete them — they keep their indentation, but nothing defines a break there, so the split before them stops rendering.`,
        confirmLabel: "Remove level",
        danger: true,
      });
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
      flashSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not save levels");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3 className="card-title">Levels</h3>
        <p className="card-subtitle">
          A block&rsquo;s depth in the outline is its position in this list. Depth 0 is the
          outermost — set it to Chapter and the next to Scene, or add a Part above them. Dragging a
          block to a different indentation moves it to a different level, and so changes the break
          before it.
        </p>

        {error ? <div className="alert error">{error}</div> : null}

        {loading ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <div className="level-rows">
                <div className="level-row head">
                  <span className="level-depth">#</span>
                  <span className="lv-name">Name</span>
                  <span className="lv-break">Break before a block at this level</span>
                  <span className="lv-count">Numbering</span>
                  <span className="lv-used">Sections</span>
                  <span className="lv-actions" />
                </div>

                {levels.map((level, i) => (
                  <div className="level-row" key={i}>
                    {/* Counted as anyone would say it: the first level is the
                        first, not the zeroth. The depth stays zero-based
                        underneath, where it indexes things. */}
                    <span className="level-depth">{i + 1}</span>
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
                        set(i, {
                          counterRestart: e.target.value as "continuous" | "under-parent",
                        })
                      }
                    >
                      <option value="continuous">1, 2, 3 throughout</option>
                      <option value="under-parent">Restart under each parent</option>
                    </select>
                    <span
                      className="lv-used"
                      title={`How many sections of the manuscript are at this level`}
                    >
                      {depthCounts[i] ?? 0}
                    </span>
                    <span className="lv-actions">
                      <button
                        className="btn ghost"
                        type="button"
                        title="Move up"
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        title="Move down"
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        title="Remove level"
                        disabled={levels.length <= 1}
                        onClick={() => void remove(i)}
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
                  {levels.length === 1 ? "" : "s"} are defined. Blocks below the last level render
                  with no break before them.
                </div>
              ) : null}

              <button
                className="btn secondary"
                type="button"
                style={{ marginTop: 12 }}
                onClick={() =>
                  mutate([
                    ...levels,
                    { name: "", breakTemplateId: null, counterRestart: "continuous" },
                  ])
                }
              >
                <Plus size={14} /> Add level
              </button>
            </>
          )}

      <div className="modal-actions">
          <div className="spacer" />
          {dirty ? <span className="muted lv-dirty">Unsaved changes</span> : null}
          <button
            className={`btn${savedFlash ? " saved" : ""}`}
            type="button"
            onClick={() => void save()}
            disabled={(!dirty && !savedFlash) || busy}
          >
            {savedFlash ? (
              <>
                <Check size={15} /> Saved!
              </>
            ) : busy ? (
              "Saving…"
            ) : (
              "Save levels"
            )}
          </button>
      </div>
    </>
  );
}
