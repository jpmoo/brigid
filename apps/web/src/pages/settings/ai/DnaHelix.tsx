import { useState } from "react";

/**
 * The fingerprint as a helix.
 *
 * Two hundred numbers is not a picture. A dozen is, if each one stands for
 * something a writer can name — how long the sentences run, how heavily the
 * prose is punctuated, how far the narrator stands back — and the rest stays
 * underneath for anything that asks.
 *
 * The two backbones are the same wave half a turn apart, which is what makes it
 * read as a helix rather than as a ribbon. Every rung is one measure. The bead
 * on it is the only thing carrying information: left where the writer sits low
 * against ordinary published fiction, right where they sit high, on the center
 * line where the two agree. The waving is decoration and says so — which is
 * why the bead is placed against a fixed width rather than along its rung.
 *
 * The comparisons are deliberately few. There is a rough published norm for
 * sentence length, paragraph length, adverbs and the share of dialogue, and
 * there is nothing worth claiming about the rest — so the rest is drawn at its
 * own value against the range found in this manuscript, and the tooltip says
 * which kind of reading it is.
 */

export interface Strand {
  key: string;
  name: string;
  unit: string;
  value: number;
  spread: number;
}

/**
 * What "usual" means here, said out loud.
 *
 * These are rules of thumb about published fiction — the kind of figure that
 * turns up in style guidance and in rough surveys of novels. They are not
 * measured from a corpus, because there is no corpus in this application to
 * measure: nothing leaves the machine, so there is nothing here to compare a
 * manuscript against except numbers written down in advance.
 *
 * That is a real limitation and the reason it is stated on the graph rather
 * than buried. A band is drawn for each so the range is visible instead of
 * asserted, and a writer who disagrees with one can see exactly what they are
 * disagreeing with.
 *
 * There are only four because there are only four worth claiming. Inventing a
 * usual rate of semicolons would be dressing a guess as a measurement, which
 * is worse than showing nothing — so the rest are drawn with no comparison at
 * all and only their own figure beside them.
 */
const TYPICAL: Record<string, { low: number; high: number; unit: string }> = {
  length: { low: 12, high: 18, unit: "words" },
  paragraph: { low: 40, high: 90, unit: "words" },
  adverbs: { low: 8, high: 20, unit: "per thousand words" },
  dialogue: { low: 6, high: 18, unit: "per thousand words" },
};

const WIDTH = 460;
const ROW = 46;
const AMPLITUDE = 66;
const MARGIN = 42;

/** Where this measure sits on the axis, from 0 at the left to 1 at the right. */
function position(strand: Strand): { at: number; kind: "compared" | "own"; note: string } {
  const norm = TYPICAL[strand.key];
  if (norm) {
    // Centered when the writer sits inside the ordinary range, and running out
    // to the edges at twice the width of that range either side.
    const mid = (norm.low + norm.high) / 2;
    const half = Math.max(1e-6, (norm.high - norm.low) / 2);
    const offset = (strand.value - mid) / (half * 3);
    return {
      at: Math.max(0.04, Math.min(0.96, 0.5 + offset / 2)),
      kind: "compared",
      note: `most published fiction runs ${norm.low}–${norm.high} ${norm.unit}`,
    };
  }

  /**
   * No published norm worth claiming, so the bead sits on the center line and
   * the figure beside it is the reading.
   *
   * Drawing it anywhere else would imply a comparison that was never made.
   * There is a real temptation to place it against the spread across the
   * writer's own sections instead, which would fill the graph out nicely and
   * mean nothing at all: the book-wide value is the middle of those sections by
   * construction, so it would sit dead center however it was scaled.
   */
  return {
    at: 0.5,
    kind: "own",
    note: `no published figure worth quoting — yours varies by about ${fmt(
      strand.spread,
    )} between sections`,
  };
}

function fmt(value: number): string {
  if (value === 0) return "0";
  return value >= 10 ? value.toFixed(0) : value.toFixed(2);
}

export function DnaHelix({ strands }: { strands: Strand[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  if (strands.length === 0) return null;

  const height = strands.length * ROW + MARGIN * 2;
  const center = WIDTH / 2;

  // One wave down the page and its mirror. Sampled rather than drawn as a
  // curve, so the rungs can meet it exactly at every row.
  const waveAt = (y: number, phase: number) =>
    center + Math.sin((y / (ROW * 4)) * Math.PI * 2 + phase) * AMPLITUDE;

  const backbone = (phase: number) => {
    const points: string[] = [];
    for (let y = MARGIN / 2; y <= height - MARGIN / 2; y += 4) {
      points.push(`${waveAt(y, phase).toFixed(1)},${y.toFixed(1)}`);
    }
    return `M ${points.join(" L ")}`;
  };

  return (
    <div className="dna-wrap">
      <svg
        className="dna"
        viewBox={`0 0 ${WIDTH} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Your prose measured across a dozen features"
      >
        {/* Where a measure sits when it matches ordinary published fiction. */}
        <line
          className="dna-center"
          x1={center}
          y1={MARGIN - 14}
          x2={center}
          y2={MARGIN + (strands.length - 1) * ROW + 14}
        />
        <path className="dna-backbone" d={backbone(0)} />
        <path className="dna-backbone" d={backbone(Math.PI)} />

        {strands.map((strand, i) => {
          const y = MARGIN + i * ROW;
          const a = waveAt(y, 0);
          const b = waveAt(y, Math.PI);
          const { at, kind, note } = position(strand);
          /**
           * On a fixed axis, not along the rung.
           *
           * The rung is as wide as the two backbones happen to be apart at that
           * height, which is a fact about the drawing and not about the prose —
           * so a bead placed as a fraction of it would mean one thing on a wide
           * rung and another on a narrow one, and two measures at the same
           * distance from normal would sit at visibly different places. The
           * beads read down the column against each other, so they are spaced
           * against the same width whatever the rung behind them is doing.
           */
          const x = center + (at - 0.5) * 2 * AMPLITUDE;
          const on = hovered === strand.key;

          return (
            <g
              key={strand.key}
              className={`dna-rung${on ? " on" : ""}${kind === "own" ? " own" : ""}`}
              onMouseEnter={() => setHovered(strand.key)}
              onMouseLeave={() => setHovered((h) => (h === strand.key ? null : h))}
            >
              {/* The rung itself, and a fatter invisible one to grab. */}
              <line
                x1={Math.min(a, b, x)}
                y1={y}
                x2={Math.max(a, b, x)}
                y2={y}
                className="dna-bar"
              />
              <line
                x1={Math.min(a, b, x)}
                y1={y}
                x2={Math.max(a, b, x)}
                y2={y}
                className="dna-hit"
              />
              {/* The range itself. Always the middle third of the axis, since
                  the scale is defined from it — so "inside the band" reads the
                  same on every rung that has one. */}
              {kind === "compared" ? (
                <line
                  x1={center - AMPLITUDE / 3}
                  y1={y}
                  x2={center + AMPLITUDE / 3}
                  y2={y}
                  className="dna-band"
                />
              ) : null}
              <circle cx={x} cy={y} r={on ? 7 : 5} className="dna-bead" />

              <text x={12} y={y + 4} className="dna-name">
                {strand.name}
              </text>
              <text x={WIDTH - 12} y={y + 4} className="dna-value" textAnchor="end">
                {fmt(strand.value)}
              </text>

              {on ? (
                <title>
                  {`${strand.name}: ${fmt(strand.value)} ${strand.unit} — ${note}`}
                </title>
              ) : null}
            </g>
          );
        })}
      </svg>

      <p className="dna-key">
        The four thicker rungs are the only ones compared to anything. The bar
        across them is roughly where published fiction sits — sentences of
        12–18 words, paragraphs of 40–90, 8–20 <i>-ly</i> adverbs and 6–18
        speech tags per thousand words — and your bead sits inside it, or to the
        left for less, or to the right for more. Those are rules of thumb rather
        than a measured survey: nothing leaves this machine, so there is no
        library of novels here to compare you against.
      </p>
      <p className="dna-key">
        The hollow beads have no comparison at all. There is no honest figure
        for how many semicolons a novel usually has, so those sit on the center
        line and the number beside them is the whole of the reading. What they
        are useful for is further down — a section is compared to{" "}
        <em>the rest of your own book</em>, which needs no outside authority.
      </p>
    </div>
  );
}
