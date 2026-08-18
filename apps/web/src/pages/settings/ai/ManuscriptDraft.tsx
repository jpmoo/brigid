import { useMemo, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import type { ProseDna } from "../../../api.js";
import { checkDraft, paragraphsOf, retryNote, show } from "./voice-check.js";

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

export function ManuscriptDraft({
  prose,
  dna,
  streaming,
  onRetry,
}: {
  prose: string;
  /** Null while the fingerprint is still loading, or if none has been taken. */
  dna: ProseDna | null;
  /** Still arriving. Nothing is measured or shown until it has stopped. */
  streaming: boolean;
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

  /**
   * Measured once the passage has stopped arriving.
   *
   * Not while it streams. The figures are recomputed from whatever prose exists
   * at that instant, so a half-written passage produces figures about a
   * half-written passage — wrong, and changing on every token. Worse than
   * wrong: the block grows and reflows under the reader as each number changes
   * width, which moves the text they are trying to read. A draft is a thing to
   * measure when it is finished.
   */
  const check = useMemo(() => (streaming ? null : checkDraft(prose, dna)), [prose, dna, streaming]);
  const missed = check?.rows.filter((r) => r.off) ?? [];

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
          {check.faults.length > 0 ? (
            <ul className="ms-draft-faults">
              {check.faults.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}

          {(missed.length > 0 || check.faults.length > 0) && onRetry ? (
            <div className="ms-draft-miss">
              <p>
                {missed.length === 0
                  ? "Everything above sits inside your range."
                  : `${missed.length === 1 ? "One measure sits" : `${missed.length} measures sit`} outside the range your own sections cover${
                      missed.some((r) => r.feature === "sent.sd")
                        ? " — including the swing between long sentences and short, which is the one imitation usually flattens"
                        : ""
                    }.`}{" "}
                Asking again is worth it when the passage reads wrong, not because
                a figure does — a page of yours would often measure as a departure too.
              </p>
              <button className="btn" type="button" onClick={() => onRetry(retryNote(check!.rows, check!.faults, check!.words))}>
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
