import { useMemo } from "react";
import { buildOutline, subtreeWordCounts } from "@brigid/shared";
import type { Block, Template, Work, WorkLevel } from "../../api.js";

/**
 * How the manuscript is doing against what it was told to aim at.
 *
 * The goals could be set and, per node, seen — the outline shades a section
 * that has reached its level's target and the canvas shades a chapter — but
 * nowhere said how it was going overall. A writer with a goal per chapter and a
 * goal for the book had to read fourteen shaded cards and add up.
 *
 * Counted on the same totals the outline shades: a section plus everything
 * under it, so a chapter is judged on its contents rather than on the words
 * sitting directly in it. Title pages and anything else non-structural are left
 * out entirely, which is what "exempt from goals" has to mean if it is to mean
 * anything — they are not short of a target, they have none.
 */

const fmt = new Intl.NumberFormat();

export interface LevelReport {
  name: string;
  goal: number;
  met: number;
  total: number;
  shortfall: number;
  worst: { label: string; words: number } | null;
}

function Bar({ done, goal }: { done: number; goal: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((done / goal) * 100)));
  return (
    <div className="gp-track" role="img" aria-label={`${pct}% of ${fmt.format(goal)} words`}>
      <div className={`gp-fill${done >= goal ? " met" : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The arithmetic, apart from the component that draws it.
 *
 * Pure and exported so it can be run against a manuscript in a test rather than
 * checked by looking at a bar — the exemptions and the subtree totals are the
 * parts most likely to be quietly wrong, and neither is visible from a
 * screenshot.
 */
export function goalReport(
  blocks: Block[],
  levels: WorkLevel[],
  templates: Template[],
): { written: number; perLevel: LevelReport[] } {
  {
    const byFormat = new Map(templates.map((t) => [t.id, t]));
    const structural = (block: Block) =>
      byFormat.get(block.formatId)?.formatSettings?.structural ?? true;

    const entries = buildOutline(blocks);
    const totals = subtreeWordCounts(entries);

    // The book's own total, on the same terms: prose that carries a goal.
    const written = blocks.filter(structural).reduce((sum, b) => sum + b.wordCount, 0);

    const perLevel: LevelReport[] = [];
    for (const level of levels) {
      if (!level.wordGoal) continue;
      const at = entries.filter((e) => e.depth === level.depth && structural(e.block));
      if (at.length === 0) continue;

      let met = 0;
      let shortfall = 0;
      let worst: LevelReport["worst"] = null;
      for (const entry of at) {
        const words = totals.get(entry.block.id) ?? entry.block.wordCount;
        if (words >= level.wordGoal) {
          met += 1;
          continue;
        }
        shortfall += level.wordGoal - words;
        if (!worst || words < worst.words) {
          worst = { label: entry.block.label || "Untitled", words };
        }
      }
      perLevel.push({
        name: level.name,
        goal: level.wordGoal,
        met,
        total: at.length,
        shortfall,
        worst,
      });
    }

    return { written, perLevel };
  }
}

export function GoalProgress({
  work,
  blocks,
  levels,
  templates,
}: {
  work: Work | null;
  blocks: Block[];
  levels: WorkLevel[];
  templates: Template[];
}) {
  const report = useMemo(() => goalReport(blocks, levels, templates), [blocks, levels, templates]);

  const bookGoal = work?.totalWordGoal ?? null;
  if (!bookGoal && report.perLevel.length === 0) {
    return (
      <p className="tpl-note">
        Nothing to report yet — no length has been set for the manuscript or for any of
        its levels. Set one below and this will fill in.
      </p>
    );
  }

  return (
    <div className="gp">
      {bookGoal ? (
        <div className="gp-row">
          <div className="gp-head">
            <span className="gp-name">The manuscript</span>
            <span className="gp-figure">
              {fmt.format(report.written)} of {fmt.format(bookGoal)}
            </span>
          </div>
          <Bar done={report.written} goal={bookGoal} />
          <p className="gp-note">
            {report.written >= bookGoal
              ? `Past it, by ${fmt.format(report.written - bookGoal)} words.`
              : `${fmt.format(bookGoal - report.written)} words to go.`}
          </p>
        </div>
      ) : null}

      {report.perLevel.map((level) => (
        <div className="gp-row" key={level.name}>
          <div className="gp-head">
            <span className="gp-name">
              {level.name} <span className="muted">· {fmt.format(level.goal)} words each</span>
            </span>
            <span className="gp-figure">
              {level.met} of {level.total}
            </span>
          </div>
          <Bar done={level.met} goal={level.total} />
          <p className="gp-note">
            {level.met === level.total ? (
              "Every one has reached it."
            ) : (
              <>
                {level.total - level.met} short, by {fmt.format(level.shortfall)} words between
                them.
                {level.worst ? (
                  <>
                    {" "}
                    Furthest behind is <strong>{level.worst.label}</strong> at{" "}
                    {fmt.format(level.worst.words)}.
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>
      ))}

      <p className="muted small">
        Counted on each section plus everything under it, the same total the outline
        shades against. Title pages and other non-structural blocks are left out — they
        have no length to fall short of.
      </p>
    </div>
  );
}
