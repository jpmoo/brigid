import { useState } from "react";
import { Play, Square } from "lucide-react";
import type { Block } from "../../api.js";
import { readSession, startSession, writeSession } from "../../components/SessionGoal.js";

const wordFmt = new Intl.NumberFormat();

/**
 * Goals.
 *
 * The sitting is here; the two standing goals — a length for the manuscript and
 * a length for its sections — are not built yet. A session is a decision about
 * the next hour rather than about the book, which is why it is started rather
 * than saved: it begins when you say so and it is over when it is over.
 */
export function GoalsPane({ blocks }: { blocks: Block[] }) {
  const total = blocks.reduce((sum, b) => sum + b.wordCount, 0);
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
      <p className="card-subtitle" style={{ marginBottom: 0 }}>
        A target length for the whole manuscript, and one for its sections &mdash; the outline
        shading a section red until it is met and green once it is. One of each: a single
        total, and a single length per level, so a chapter and a scene can each have their own
        but neither can have two. Not built yet; the session above is.
      </p>
    </div>
  );
}
