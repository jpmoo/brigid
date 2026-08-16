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
 * against ordinary published fiction, right where they sit high, on the centre
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
 * Where ordinary published fiction sits, for the handful of measures where
 * saying so is common knowledge rather than invention.
 *
 * Anything absent is drawn against itself instead. Making up a norm for
 * "semicolons per thousand words" would be inventing a fact and dressing it as
 * a measurement, which is worse than showing nothing.
 */
const TYPICAL: Record<string, { low: number; high: number; note: string }> = {
  length: { low: 12, high: 18, note: "most published fiction runs 12–18 words" },
  paragraph: { low: 40, high: 90, note: "most published fiction runs 40–90 words" },
  adverbs: { low: 8, high: 20, note: "most published fiction runs 8–20 per thousand" },
  dialogue: { low: 6, high: 18, note: "most published fiction runs 6–18 per thousand" },
};

const WIDTH = 460;
const ROW = 46;
const AMPLITUDE = 66;
const MARGIN = 42;

/** Where this measure sits on the axis, from 0 at the left to 1 at the right. */
function position(strand: Strand): { at: number; kind: "compared" | "own"; note: string } {
  const norm = TYPICAL[strand.key];
  if (norm) {
    // Centred when the writer sits inside the ordinary range, and running out
    // to the edges at twice the width of that range either side.
    const mid = (norm.low + norm.high) / 2;
    const half = Math.max(1e-6, (norm.high - norm.low) / 2);
    const offset = (strand.value - mid) / (half * 3);
    return {
      at: Math.max(0.04, Math.min(0.96, 0.5 + offset / 2)),
      kind: "compared",
      note: norm.note,
    };
  }

  /**
   * No published norm worth claiming, so the bead sits on the centre line and
   * the figure beside it is the reading.
   *
   * Drawing it anywhere else would imply a comparison that was never made.
   * There is a real temptation to place it against the spread across the
   * writer's own sections instead, which would fill the graph out nicely and
   * mean nothing at all: the book-wide value is the middle of those sections by
   * construction, so it would sit dead centre however it was scaled.
   */
  return {
    at: 0.5,
    kind: "own",
    note: `varies by about ${fmt(strand.spread)} between your sections`,
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
  const centre = WIDTH / 2;

  // One wave down the page and its mirror. Sampled rather than drawn as a
  // curve, so the rungs can meet it exactly at every row.
  const waveAt = (y: number, phase: number) =>
    centre + Math.sin((y / (ROW * 4)) * Math.PI * 2 + phase) * AMPLITUDE;

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
          className="dna-centre"
          x1={centre}
          y1={MARGIN - 14}
          x2={centre}
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
          const x = centre + (at - 0.5) * 2 * AMPLITUDE;
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
        A bead to the right of centre means more of that than usual, to the left
        means less. Only sentence length, paragraph length, adverbs and speech
        tags are set against published fiction — there is no norm worth quoting
        for the rest, so those sit at their own value and the figure beside them
        is what to read.
      </p>
    </div>
  );
}
