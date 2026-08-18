import { useMemo, useState } from "react";
import {
  buildOutline,
  levelStats,
  sentenceStats,
  subtreeWordCounts,
  wordFrequency,
} from "@brigid/shared";
import type { Block, Template, WorkLevel } from "../../api.js";
import { ProseDnaPane } from "./ai/ProseDnaPane.js";

const fmt = new Intl.NumberFormat();

/**
 * What the manuscript is made of.
 *
 * Counting, not judging: nothing here says a sentence is too long or a word
 * used too often. It says how long and how often, and the writer decides. All
 * of it is worked out in the browser from prose already loaded, so it costs a
 * request to nobody and is as current as the page.
 */
export function StatsPane({
  workId,
  blocks,
  levels,
  templates,
}: {
  workId: string;
  blocks: Block[];
  levels: WorkLevel[];
  templates: Template[];
}) {
  const [ownWords, setOwnWords] = useState(true);
  /**
   * ProseDNA belongs here rather than under AI. Almost none of it needs a
   * model: it is arithmetic over the manuscript, which is what this pane is
   * for. Only the paragraph describing what the numbers mean asks the
   * model anything, and that reads as a footnote to the measuring rather than a
   * reason to file the whole thing under the machine.
   */
  const [tab, setTab] = useState<"counts" | "dna">("counts");

  const stats = useMemo(() => {
    const formats = new Map(templates.map((t) => [t.id, t.formatSettings]));
    /** A title page is not a section, and an epigraph is not prose. */
    const counts = (block: Block) => formats.get(block.formatId)?.countsTowardWordCount !== false;
    const structural = (block: Block) => formats.get(block.formatId)?.structural !== false;

    const entries = buildOutline(blocks);
    const totals = subtreeWordCounts(entries);

    const sections = entries
      .filter((entry) => structural(entry.block))
      .map((entry) => ({
      depth: entry.depth,
      label: entry.block.label || "Untitled",
      // A chapter is as long as its scenes; counting only what was typed
      // directly into it would say every chapter was empty.
      words: totals.get(entry.block.id) ?? entry.block.wordCount,
    }));

    // Only what the manuscript counts as its own words. A title page's lines
    // and anything a format leaves out of the tally would otherwise show up in
    // the sentence lengths and, worse, in the commonest words.
    const prose = blocks
      .filter((b) => counts(b) && structural(b))
      .map((b) => b.contentText)
      .join("\n\n");

    return {
      levels: levelStats(sections, levels),
      sentences: sentenceStats(prose),
      words: wordFrequency(prose, { withoutFunctionWords: ownWords, limit: 100 }),
      total: blocks.filter(counts).reduce((sum, b) => sum + b.wordCount, 0),
    };
  }, [blocks, levels, templates, ownWords]);

  if (blocks.length === 0) return <p className="tpl-empty">Nothing written yet.</p>;

  /** The counts themselves, as a value: a component declared inside a
   *  render is a new type every time, so React would throw the whole
   *  subtree away and rebuild it on each keystroke. */
  const counts = (
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

  return (
    <>
      <nav className="subtabs" role="tablist">
        {(
          [
            ["counts", "What it is made of"],
            ["dna", "ProseDNA"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "selected" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "dna" ? <ProseDnaPane workId={workId} /> : counts}
    </>
  );
}
