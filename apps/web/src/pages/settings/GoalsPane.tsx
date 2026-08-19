import { useState } from "react";
import { Play, Square } from "lucide-react";
import { ApiError, api } from "../../api.js";
import type { Block, Template, Work, WorkLevel } from "../../api.js";
import { useSavedFlash } from "../../useSavedFlash.js";
import { readSession, startSession, writeSession } from "../../components/SessionGoal.js";
import { GoalProgress } from "./GoalProgress.js";
import { WritingGraph } from "./WritingGraph.js";

const wordFmt = new Intl.NumberFormat();

/**
 * Goals.
 *
 * The sitting is here; the two standing goals — a length for the manuscript and
 * a length for its sections — are not built yet. A session is a decision about
 * the next hour rather than about the book, which is why it is started rather
 * than saved: it begins when you say so and it is over when it is over.
 */
export function GoalsPane({
  workId,
  work,
  blocks,
  levels,
  templates,
  onSaved,
}: {
  workId: string;
  work: Work | null;
  blocks: Block[];
  levels: WorkLevel[];
  templates: Template[];
  onSaved: () => void;
}) {
  const total = blocks.reduce((sum, b) => sum + b.wordCount, 0);

  const [total_goal, setTotalGoal] = useState<number | null>(work?.totalWordGoal ?? null);
  const [goals, setGoals] = useState<Record<number, number | null>>(() =>
    Object.fromEntries(levels.map((l) => [l.depth, l.wordGoal ?? null])),
  );
  const [saving, setSaving] = useState(false);
  const [saved, flash] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);

  /**
   * Both at once, because they are one decision.
   *
   * The levels go back as a whole list — that is how they are stored, an
   * ordered set rather than rows to be patched — so the goal travels with the
   * rest of each level rather than as a separate thing that could disagree.
   */
  async function saveGoals() {
    setSaving(true);
    setError(null);
    try {
      await api.updateWork(workId, { totalWordGoal: total_goal && total_goal > 0 ? total_goal : null });
      await api.saveLevels(
        workId,
        levels.map((l) => ({
          name: l.name,
          breakTemplateId: l.breakTemplateId,
          counterRestart: l.counterRestart,
          wordGoal: goals[l.depth] && (goals[l.depth] ?? 0) > 0 ? goals[l.depth] : null,
        })),
      );
      flash();
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not save that");
    } finally {
      setSaving(false);
    }
  }
  const [running, setRunning] = useState(() => readSession() !== null);
  const [minutes, setMinutes] = useState(25);
  const [words, setWords] = useState(500);

  function begin() {
    writeSession(startSession(minutes, words, total));
    setRunning(true);
  }

  function end() {
    writeSession(null);
    setRunning(false);
  }

  return (
    <div className="tpl-detail">
      <h4 className="tpl-section">How we're doing</h4>
      <GoalProgress work={work} blocks={blocks} levels={levels} templates={templates} />

      {/* Minutes while a sitting is running, days otherwise — the graph follows
          whichever goal is actually being worked against. */}
      <WritingGraph workId={workId} by={running ? "minute" : "day"} days={running ? 1 : 90} />

      <h4 className="tpl-section">This session</h4>
      <p className="tpl-note">
        A stretch of writing against the clock. The timer sits in the corner of the
        manuscript while it runs, counting down and keeping the tally.
      </p>

      {running ? (
        <div className="be-line" style={{ marginTop: 8 }}>
          <span className="muted">A session is running.</span>
          <span className="be-gap" />
          <button className="btn secondary" type="button" onClick={end}>
            <Square size={14} />
            End it
          </button>
        </div>
      ) : (
        <>
          <div className="be-line be-line-setting" style={{ marginTop: 8 }}>
            <label className="bk-field">
              <span>For</span>
              <input
                type="number"
                min={1}
                max={480}
                value={minutes}
                onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))}
              />
              <span>minutes,</span>
            </label>
            <label className="bk-field">
              <span>aiming for</span>
              <input
                type="number"
                min={0}
                max={100000}
                step={50}
                value={words}
                onChange={(e) => setWords(Math.max(0, Number(e.target.value) || 0))}
              />
              <span>words.</span>
            </label>
            <span className="be-gap" />
            <button className="btn" type="button" onClick={begin}>
              <Play size={14} />
              Start
            </button>
          </div>
          <p className="tpl-note">
            Counted from where the manuscript stands now &mdash; {wordFmt.format(total)} words
            &mdash; so cutting takes words back off, and the tally can go below zero. An hour
            spent cutting is still work. Set the words to nought to race only the clock.
          </p>
        </>
      )}

      <h4 className="tpl-section">Standing goals</h4>
      <p className="tpl-note">
        A length to aim at. The outline shades a section red until it is met and green once
        it is, so the shape of the book is visible without opening anything. One total, and
        one length per level &mdash; a chapter and a scene can each have their own.
      </p>

      <div className="be-line be-line-setting" style={{ marginTop: 8 }}>
        <label className="bk-field">
          <span>The whole manuscript</span>
          <input
            type="number"
            className="goal-number"
            min={0}
            step={1000}
            placeholder="No goal"
            value={total_goal ?? ""}
            onChange={(e) => setTotalGoal(e.target.value ? Number(e.target.value) : null)}
          />
          <span>words</span>
        </label>
        {total_goal === null ? null : (
          <button className="btn ghost" type="button" onClick={() => setTotalGoal(null)}>
            Clear
          </button>
        )}
      </div>

      {levels.map((level) => (
        <div className="be-line be-line-setting" key={level.id}>
          <label className="bk-field">
            <span>Each {level.name.toLowerCase()}</span>
            <input
              type="number"
              className="goal-number"
              min={0}
              step={500}
              placeholder="No goal"
              value={goals[level.depth] ?? ""}
              onChange={(e) =>
                setGoals({
                  ...goals,
                  [level.depth]: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
            <span>words</span>
          </label>
          {goals[level.depth] == null ? null : (
            <button
              className="btn ghost"
              type="button"
              onClick={() => setGoals({ ...goals, [level.depth]: null })}
            >
              Clear
            </button>
          )}
        </div>
      ))}

      <div className="be-line" style={{ marginTop: 10 }}>
        {/* Said on the button that was pressed, as everywhere else that saves. */}
        <button
          className="btn"
          type="button"
          disabled={saving || saved}
          onClick={() => void saveGoals()}
        >
          {saved ? "Saved!" : saving ? "Saving…" : "Save goals"}
        </button>
        {error ? <span className="compile-warn">{error}</span> : null}
      </div>
    </div>
  );
}
