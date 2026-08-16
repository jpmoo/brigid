import { useMemo, useState } from "react";
import {
  REFERENCE_WORKS,
  alikeBand,
  distanceNote,
  howAlike,
  place,
  resemblance,
} from "@brigid/shared";
import type { ReferenceWork } from "@brigid/shared";

/**
 * Where a manuscript sits among books that were actually measured.
 *
 * This replaced a drawing of a double helix. The helix was legible and it was
 * decoration: the waving carried nothing, the rungs were a list, and eight of
 * the twelve had no comparison behind them at all because there was nothing
 * honest to compare them to. Now there is — seventy-odd public-domain novels
 * run through this application's own extractor — so the picture can be the
 * comparison itself rather than an illustration of the idea of one.
 *
 * Every row is one measure, drawn as a track spanning what the reference novels
 * actually do. The faint ticks are those novels. The solid marker is the
 * writer. Anything they choose to sit beside is drawn on the same track, so the
 * two are read against each other rather than against two separate pictures.
 */

/** The rows, in an order that reads: shape first, then texture, then distance. */
const ROWS: { key: string; label: string; low: string; high: string }[] = [
  { key: "sent.mean", label: "Sentence length", low: "clipped", high: "long" },
  { key: "sent.sd", label: "Sentence variety", low: "even", high: "varied" },
  { key: "punct.comma", label: "Commas", low: "sparse", high: "heavy" },
  { key: "punct.semicolon", label: "Semicolons", low: "none", high: "frequent" },
  { key: "punct.dash", label: "Dashes", low: "none", high: "frequent" },
  { key: "para.words", label: "Paragraph length", low: "short", high: "long" },
  { key: "lex.ttr", label: "Vocabulary range", low: "narrow", high: "wide" },
  { key: "lex.syllables", label: "Word length", low: "plain", high: "polysyllabic" },
  { key: "lex.latinate", label: "Latinate words", low: "few", high: "many" },
  { key: "mod.adverb", label: "-ly adverbs", low: "few", high: "many" },
  { key: "pov.filtering", label: "Filtering", low: "close in", high: "held back" },
  { key: "pov.first", label: "First person", low: "little", high: "throughout" },
  { key: "tag.rate", label: "Speech tags", low: "few", high: "many" },
  { key: "tag.said", label: "“Said” among them", low: "varied verbs", high: "always “said”" },
];

const fmt = (value: number): string =>
  value === 0 ? "0" : value >= 10 ? value.toFixed(0) : value.toFixed(2);

const nameOf = (work: ReferenceWork): string =>
  `${work.author.split(" ").at(-1)}, ${work.title}`;

export function ProseProfile({
  features,
  dialogueShare,
}: {
  features: Record<string, number>;
  dialogueShare: number;
}) {
  const [beside, setBeside] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);

  const ranked = useMemo(() => resemblance(features), [features]);

  const chosen = useMemo(
    () => REFERENCE_WORKS.filter((w) => beside.includes(`${w.author}|${w.title}`)),
    [beside],
  );

  const toggle = (work: ReferenceWork) => {
    const id = `${work.author}|${work.title}`;
    setBeside((held) =>
      held.includes(id) ? held.filter((h) => h !== id) : [...held, id].slice(-3),
    );
  };

  return (
    <div className="pp">
      <div className="pp-tracks">
        {ROWS.map((row) => {
          const value = features[row.key];
          if (value === undefined) return null;
          const at = place(row.key, value);
          if (at === null) return null;
          const on = hovered === row.key;

          return (
            <div
              key={row.key}
              className={`pp-row${on ? " on" : ""}`}
              onMouseEnter={() => setHovered(row.key)}
              onMouseLeave={() => setHovered((h) => (h === row.key ? null : h))}
            >
              <span className="pp-label">{row.label}</span>

              <span className="pp-track">
                <span className="pp-rail" />
                {/* Every reference novel, so the range is the books rather than
                    an assertion about them. */}
                {REFERENCE_WORKS.map((work) => {
                  const theirs = work.features[row.key];
                  if (theirs === undefined) return null;
                  const spot = place(row.key, theirs);
                  if (spot === null) return null;
                  return (
                    <span
                      key={`${work.author}|${work.title}`}
                      className="pp-tick"
                      style={{ left: `${spot * 100}%` }}
                      title={`${nameOf(work)} — ${fmt(theirs)}`}
                    />
                  );
                })}

                {chosen.map((work, i) => {
                  const theirs = work.features[row.key];
                  if (theirs === undefined) return null;
                  const spot = place(row.key, theirs);
                  if (spot === null) return null;
                  return (
                    <span
                      key={`${work.author}|${work.title}`}
                      className={`pp-them c${i}`}
                      style={{ left: `${spot * 100}%` }}
                      title={`${nameOf(work)} — ${fmt(theirs)}`}
                    />
                  );
                })}

                <span className="pp-me" style={{ left: `${at * 100}%` }} title={`You — ${fmt(value)}`} />
              </span>

              <span className="pp-value">{fmt(value)}</span>
              {on ? (
                <span className="pp-ends">
                  {row.low} → {row.high}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="pp-key">
        Each track spans what {REFERENCE_WORKS.length} published novels actually
        do — the faint marks are those books, measured by this application with
        the same arithmetic it measures you with. Nothing here is a rule of thumb or a
        target. Sitting at one end means you write unlike most of them, which is
        a fact and not a fault.
      </p>

      <Resemblances
        ranked={ranked}
        beside={beside}
        onToggle={toggle}
        dialogueShare={dialogueShare}
      />
    </div>
  );
}

function Resemblances({
  ranked,
  beside,
  onToggle,
  dialogueShare,
}: {
  ranked: ReturnType<typeof resemblance>;
  beside: string[];
  onToggle: (work: ReferenceWork) => void;
  dialogueShare: number;
}) {
  const [all, setAll] = useState(false);
  const top = ranked[0];
  /**
   * All of them, nearest first, in something that scrolls.
   *
   * It used to show the six nearest and the three furthest and nothing else,
   * which reads as a list that has been cut off rather than one that is
   * complete — and the interesting question is often not "who am I nearest" but
   * "where does this particular book sit", which the short list cannot answer.
   */
  const shown = all ? ranked : ranked.slice(0, 12);

  return (
    <section className="pp-alike">
      <h4>Which of them you measure like</h4>

      {top ? (
        <p className="pp-verdict">
          Of the {REFERENCE_WORKS.length}, your prose {howAlike(top.distance)}{" "}
          <strong>
            {top.work.author}&rsquo;s <em>{top.work.title}</em>
          </strong>
          . Where you differ most:{" "}
          {top.apart
            .slice(0, 3)
            .map((a) => `${a.label.toLowerCase()} ${a.gap > 0 ? "higher" : "lower"}`)
            .join(", ")}
          .
        </p>
      ) : null}

      <p className="muted small">
        This says some numbers sit close together. It does not say two books read
        alike, and it is not a compliment or a criticism — resembling nobody in
        the set is an ordinary result. Pick up to three to lay over the tracks
        above.
      </p>

      <div className={`pp-list${all ? " tall" : ""}`}>
        {shown.map((r) => {
          const id = `${r.work.author}|${r.work.title}`;
          const on = beside.includes(id);
          const colour = beside.indexOf(id);
          return (
            <button
              key={id}
              type="button"
              className={`pp-pick${on ? ` on c${colour}` : ""}`}
              onClick={() => onToggle(r.work)}
              title={distanceNote(r.distance)}
            >
              <span className="pp-pick-name">
                {r.work.author} — {r.work.title}
              </span>
              <span className="pp-pick-meta">
                {r.work.kind} · {r.work.year < 0 ? `${-r.work.year} BC` : r.work.year}
                {/* What was measured is the translator's English, not the
                    author's. Worth saying on the row rather than in a footnote:
                    nothing of Homer's sentences survives into a count of a
                    translation of them. */}
                {r.work.translated ? " · translated" : ""}
                {/* The band, not the figure. A bare decimal beside a year reads
                    as a score out of one, and the distance has no ceiling — so
                    1.17 looked like a broken scale rather than "about one
                    standard deviation apart on the average measure". The number
                    is on the hover for anyone who wants it. */}
                <span className={`pp-band r${alikeBand(r.distance).rank}`}>
                  {alikeBand(r.distance).label}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <button className="btn ghost" type="button" onClick={() => setAll(!all)}>
        {all ? "Show the nearest few" : `Show all ${ranked.length}, nearest first`}
      </button>

      <p className="muted small">
        Your dialogue is {Math.round(dialogueShare * 100)}% of your words.
        Speech is found by its quotation marks, so a book that marks it another
        way — Joyce uses dashes — measures as having none, and its figure here
        is wrong rather than low.
      </p>
    </section>
  );
}
