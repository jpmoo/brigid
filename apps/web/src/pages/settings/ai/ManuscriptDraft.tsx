import { useMemo, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { measure } from "@brigid/shared";
import type { ProseDna } from "../../../api.js";

/**
 * Prose the model wrote, measured against the writer's own.
 *
 * This is the whole point of measuring rather than judging. The model was
 * given a description of a voice and two passages of it and asked to imitate
 * them; whether it managed is not something it can be asked, and not something
 * a reader can tell at a glance. But the same arithmetic that produced the
 * fingerprint runs over the answer in a millisecond and says how close it
 * landed — so the fingerprint grades the output as well as specifying it.
 *
 * Measured in the browser, because the extractor is shared and pure: there is
 * nothing to ask the server and nothing to wait for.
 *
 * What it cannot say is whether the passage is any good. It reports distance
 * from a habit, and a writer's own best page would often measure as a
 * departure too.
 */

/**
 * The handful worth reporting: enough to see the shape, few enough to read.
 *
 * Each names the strand the graph draws and the feature it is measured from,
 * in one place — two lists would eventually disagree about which is which.
 */
const SHOWN = [
  { feature: "sent.mean", label: "words per sentence", round: 1, percent: false },
  /**
   * The range, not just the average — and the one most worth watching.
   *
   * A model asked to write like someone who mixes four-word sentences with
   * fifty-word ones returns the average and loses the swing: everything lands
   * near the mean, the long sentences vanish, and the subordination that filled
   * them goes with them. Every figure below can match while the passage reads
   * nothing like the writer, because sameness is what was added and no average
   * can show it.
   */
  { feature: "sent.sd", label: "how much that varies", round: 1, percent: false },
  { feature: "sent.long", label: "long sentences", round: 0, percent: true },
  { feature: "punct.comma", label: "commas per sentence", round: 2, percent: false },
  { feature: "para.words", label: "words per paragraph", round: 0, percent: false },
  { feature: "mod.adverb", label: "-ly adverbs per 1,000", round: 1, percent: false },
] as const;

/**
 * Far enough from the writer to be worth saying so.
 *
 * Against their own variation between sections, not a percentage picked from
 * the air: a writer whose sections run from 12 to 15 words a sentence and one
 * whose sections run from 4 to 30 have not both departed when a passage comes
 * back at 6. Two of their own standard deviations is a passage outside the
 * range the book itself covers.
 *
 * The floor matters as much as the multiplier. A figure that barely moves
 * between sections has a spread near zero, and without a floor every draft
 * would be flagged for missing it by a rounding error.
 */
const OFF = 2;
function departed(got: number, want: number, spread: number): boolean {
  const room = Math.max(spread, Math.abs(want) * 0.15, 1e-6);
  return Math.abs(got - want) / room > OFF;
}

/**
 * The passage as paragraphs.
 *
 * A blank line is what separates them in the manuscript and what the model is
 * told to use. But a model that forgets and puts single line breaks between
 * paragraphs has still written paragraphs, and rendering the lot as one wall
 * would misreport what it did — so a single break counts when there are no
 * blank ones to be found.
 */
function paragraphsOf(prose: string): string[] {
  const blank = prose
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (blank.length > 1) return blank;
  return prose
    .split(/\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** A figure as the writer reads it, share or rate. */
function show(v: number, row: { round: number; percent: boolean }): string {
  return row.percent ? `${Math.round(v * 100)}%` : v.toFixed(row.round);
}

/**
 * What to tell the model it missed.
 *
 * Named and numbered, because "write it more like me" is what was asked the
 * first time and is what produced this. A second attempt is only worth the wait
 * if it is told the thing the measurements caught and the first prompt did not
 * convey.
 */
function retryNote(missed: { label: string; got: number; want: number; round: number; percent: boolean }[]): string {
  const misses = missed
    .map((r) => `${r.label} came out at ${show(r.got, r)} against my usual ${show(r.want, r)}`)
    .join("; ");
  return `Rewrite that passage. Keep the events, the order and the point of view exactly as they are — the problem is the prose, not the content. Measured against my own sections it missed: ${misses}. Fix those specifically. If the sentence-length range is among them, that means varying the lengths far more: some genuinely long sentences carrying subordinate clauses, set against the short ones, rather than every sentence landing near the same length.`;
}

export function ManuscriptDraft({
  prose,
  dna,
  onRetry,
}: {
  prose: string;
  /** Null while the fingerprint is still loading, or if none has been taken. */
  dna: ProseDna | null;
  /**
   * Ask again, naming what the passage missed. Absent while a reply streams.
   *
   * Offered rather than done automatically. The writer watched this draft
   * arrive, and replacing it under them with a second one they did not ask for
   * would be the machine overruling a judgment they have not made yet — the
   * measurements say a habit was missed, which is not the same as the passage
   * being wrong. Sometimes a scene should break the pattern, and only the
   * writer knows which.
   */
  onRetry?: (note: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const check = useMemo(() => {
    if (!dna) return null;
    const words = prose.trim().split(/\s+/).filter(Boolean).length;
    // Below this the measurements are noise, and a comparison would be worse
    // than none — the same threshold a short section is spared by.
    if (words < 120) return null;

    const mine = measure(prose);

    const rows = SHOWN.map(({ feature, label, round, percent }) => {
      const want = dna.features[feature];
      const got = mine.overall[feature];
      if (want === undefined || got === undefined) return null;
      const spread = dna.spread?.[feature] ?? 0;
      return { feature, label, got, want, round, percent, off: departed(got, want, spread) };
    }).filter((r): r is NonNullable<typeof r> => r !== null);

    return { words, rows, missed: rows.filter((r) => r.off) };
  }, [prose, dna]);

  return (
    <div className="ms-draft">
      <div className="ms-draft-head">
        <span className="ms-draft-tag">Written for the manuscript</span>
        <button
          className="btn ghost"
          type="button"
          title="Copy this passage"
          onClick={async () => {
            await navigator.clipboard.writeText(prose);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="ms-draft-body">
        {paragraphsOf(prose).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      {check && check.rows.length > 0 ? (
        <div className="ms-draft-check">
          <span className="ms-draft-tag">How close it landed</span>
          <ul>
            {check.rows.map((row) => (
              <li key={row.label} className={row.off ? "off" : undefined}>
                <span>{row.label}</span>
                <strong>{show(row.got, row)}</strong>
                <span className="muted">against your {show(row.want, row)}</span>
              </li>
            ))}
          </ul>
          {check.missed.length > 0 && onRetry ? (
            <div className="ms-draft-miss">
              <p>
                {check.missed.length === 1 ? "One measure sits" : `${check.missed.length} measures sit`}{" "}
                outside the range your own sections cover
                {check.missed.some((r) => r.feature === "sent.sd")
                  ? " — including the swing between long sentences and short, which is the one imitation usually flattens"
                  : ""}
                .
              </p>
              <button className="btn" type="button" onClick={() => onRetry(retryNote(check.missed))}>
                <RefreshCw size={13} />
                Ask again, closer to my rhythm
              </button>
            </div>
          ) : null}

          <p className="muted small">
            Measured the same way your own sections are. It says how near the
            passage sits to your habits — not whether it is any good, which is
            yours to judge and often means departing from them.
          </p>
        </div>
      ) : null}
    </div>
  );
}
