import { useMemo, useState } from "react";
import {
  buildOutline,
  levelStats,
  sentenceStats,
  subtreeWordCounts,
  wordFrequency,
} from "@brigid/shared";
import type { Block, WorkLevel } from "../../api.js";

const fmt = new Intl.NumberFormat();

/**
 * What the manuscript is made of.
 *
 * Counting, not judging: nothing here says a sentence is too long or a word
 * used too often. It says how long and how often, and the writer decides. All
 * of it is worked out in the browser from prose already loaded, so it costs a
 * request to nobody and is as current as the page.
 */
export function StatsPane({ blocks, levels }: { blocks: Block[]; levels: WorkLevel[] }) {
  const [ownWords, setOwnWords] = useState(true);

  const stats = useMemo(() => {
    const entries = buildOutline(blocks);
    const totals = subtreeWordCounts(entries);

    const sections = entries.map((entry) => ({
      depth: entry.depth,
      label: entry.block.label || "Untitled",
      // A chapter is as long as its scenes; counting only what was typed
      // directly into it would say every chapter was empty.
      words: totals.get(entry.block.id) ?? entry.block.wordCount,
    }));

    const prose = blocks.map((b) => b.contentText).join("\n\n");

    return {
      levels: levelStats(sections, levels),
      sentences: sentenceStats(prose),
      words: wordFrequency(prose, { withoutFunctionWords: ownWords, limit: 100 }),
      total: blocks.reduce((sum, b) => sum + b.wordCount, 0),
    };
  }, [blocks, levels, ownWords]);

  if (blocks.length === 0) return <p className="tpl-empty">Nothing written yet.</p>;

  return (
    <div className="tpl-detail">
      <h4 className="tpl-section">Sections</h4>
      {stats.levels.length === 0 ? (
        <p className="tpl-empty">No sections yet.</p>
      ) : (
        <table className="stats-table">
          <thead>
            <tr>
              <th>Level</th>
              <th>How many</th>
              <th>Average</th>
              <th>Middle</th>
              <th>Longest</th>
              <th>Shortest</th>
            </tr>
          </thead>
          <tbody>
            {stats.levels.map((level) => (
              <tr key={level.depth}>
                <td>{level.name}</td>
                <td>{fmt.format(level.count)}</td>
                <td>{fmt.format(level.mean)}</td>
                <td>{fmt.format(level.median)}</td>
                <td>
                  {level.longest ? (
                    <>
                      {level.longest.label} <em>{fmt.format(level.longest.words)}</em>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {level.shortest ? (
                    <>
                      {level.shortest.label} <em>{fmt.format(level.shortest.words)}</em>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 className="tpl-section">Sentences</h4>
      <p className="tpl-note">
        {fmt.format(stats.sentences.count)} of them, averaging{" "}
        <strong>{stats.sentences.mean}</strong> words — the middle one is{" "}
        <strong>{stats.sentences.median}</strong>. The two differ when a few long sentences are
        pulling the average about.
      </p>
      {stats.sentences.longest ? (
        <p className="stats-longest">
          <em>Longest, at {fmt.format(stats.sentences.longest.words)} words:</em>{" "}
          {stats.sentences.longest.text.slice(0, 400)}
          {stats.sentences.longest.text.length > 400 ? "…" : ""}
        </p>
      ) : null}

      <h4 className="tpl-section">Words</h4>
      <div className="stack">
        <label className="check">
          <input
            type="checkbox"
            checked={ownWords}
            onChange={(e) => setOwnWords(e.target.checked)}
          />
          <span>
            Set aside the common ones{" "}
            <em>&mdash; or the first thirty are the same in every book</em>
          </span>
        </label>
      </div>

      <ol className="stats-words">
        {stats.words.map((entry, i) => (
          <li key={entry.word}>
            <span className="stats-rank">{i + 1}</span>
            <span className="stats-word">{entry.word}</span>
            <span className="stats-count">{fmt.format(entry.count)}</span>
          </li>
        ))}
      </ol>
      {stats.words.length === 0 ? <p className="tpl-empty">No prose to count yet.</p> : null}
    </div>
  );
}
