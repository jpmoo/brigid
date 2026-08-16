import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
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
  { strand: "length", feature: "sent.mean", label: "words per sentence", round: 1 },
  { strand: "punctuation", feature: "punct.comma", label: "commas per sentence", round: 2 },
  { strand: "paragraph", feature: "para.words", label: "words per paragraph", round: 0 },
  { strand: "adverbs", feature: "mod.adverb", label: "-ly adverbs per 1,000", round: 1 },
] as const;

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

export function ManuscriptDraft({
  prose,
  dna,
}: {
  prose: string;
  /** Null while the fingerprint is still loading, or if none has been taken. */
  dna: ProseDna | null;
}) {
  const [copied, setCopied] = useState(false);

  const check = useMemo(() => {
    if (!dna) return null;
    const words = prose.trim().split(/\s+/).filter(Boolean).length;
    // Below this the measurements are noise, and a comparison would be worse
    // than none — the same threshold a short section is spared by.
    if (words < 120) return null;

    const mine = measure(prose);
    const yours = new Map(dna.strands.map((s) => [s.key, s]));

    const rows = SHOWN.map(({ strand, feature, label, round }) => {
      const target = yours.get(strand);
      const got = mine.overall[feature];
      if (!target || got === undefined) return null;
      return { label, got, want: target.value, round };
    }).filter((r): r is NonNullable<typeof r> => r !== null);

    return { words, rows };
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
              <li key={row.label}>
                <span>{row.label}</span>
                <strong>{row.got.toFixed(row.round)}</strong>
                <span className="muted">against your {row.want.toFixed(row.round)}</span>
              </li>
            ))}
          </ul>
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
