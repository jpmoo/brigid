import { useState } from "react";
import type { CharacterAnalysis } from "@brigid/shared";

/**
 * A character's ten axes, as a radar.
 *
 * The chart is the shape; the reading is underneath it. Both matter, and the
 * reference document is firm about why: a score of 2 or higher must rest on
 * citable events, so a profile whose evidence can't be reached is a profile
 * nobody can check. Clicking a spoke opens what the reading rested on — and
 * what cuts against it.
 */

const SIZE = 300;
const CENTER = SIZE / 2;
const RADIUS = SIZE / 2 - 46;
const MAX = 5;
/** Room either side for the labels. */
const PAD = 78;

function point(index: number, count: number, value: number): [number, number] {
  // Straight up for the first axis, then clockwise — a radar read like a clock.
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  const r = (value / MAX) * RADIUS;
  return [CENTER + Math.cos(angle) * r, CENTER + Math.sin(angle) * r];
}

export function SpiderGraph({
  profile,
  labels,
  blurbs,
  compact = false,
}: {
  profile: CharacterAnalysis;
  labels: Record<string, string>;
  /** One line on what each axis measures — a function, not a job title. */
  blurbs?: Record<string, string>;
  /**
   * Tile size: the shape only, with no spoke-picking underneath. On a tile the
   * whole card is the click target, so an inner one would fight it.
   */
  compact?: boolean;
}) {
  const [openAxis, setOpenAxis] = useState<string | null>(null);
  const axes = profile.axes;
  const count = axes.length;

  const shape = axes.map((a, i) => point(i, count, a.score).join(",")).join(" ");
  const selected = axes.find((a) => a.axis === openAxis) ?? null;

  return (
    <div className={`spider${compact ? " compact" : ""}`}>
      {/* The box is wider than the chart: axis labels sit outside the radius,
          and "Rival / False Hero" on the left runs well past it. */}
      <svg viewBox={`${-PAD} -8 ${SIZE + PAD * 2} ${SIZE + 16}`} className="spider-svg" role="img"
           aria-label={`Role profile for ${profile.name}`}>
        {/* Rings at each whole score, so a 3 can be read off the chart. */}
        {[1, 2, 3, 4, 5].map((ring) => (
          <polygon
            key={ring}
            className="spider-ring"
            points={axes.map((_, i) => point(i, count, ring).join(",")).join(" ")}
          />
        ))}

        {/**
          * The one line worth drawing through the middle.
          *
          * Five diameters would only be the spokes again, in a heavier pen. But
          * the axes are now arranged so that each faces its opposite, and that
          * arrangement puts every function which carries or supports the arc on
          * one side — Hero, Ally, Mentor, Sacrifice, Beloved — and every
          * function which resists or complicates it on the other. That boundary
          * was not designed; it fell out of the pairing, which is a decent sign
          * it is real.
          *
          * So a character who leans is visible as a lean rather than as a shape
          * to be read spoke by spoke. Drawn between the spokes rather than
          * along one, because it separates them rather than belonging to any.
          */}
        {count % 2 === 0 ? (
          <line
            className="spider-divide"
            x1={point(count - 0.5, count, MAX + 0.5)[0]}
            y1={point(count - 0.5, count, MAX + 0.5)[1]}
            x2={point(count / 2 - 0.5, count, MAX + 0.5)[0]}
            y2={point(count / 2 - 0.5, count, MAX + 0.5)[1]}
          >
            <title>
              Functions that carry the arc on one side, functions that resist it on the
              other.
            </title>
          </line>
        ) : null}

        {axes.map((axis, i) => {
          const [x, y] = point(i, count, MAX);
          const [lx, ly] = point(i, count, MAX + 1.15);
          return (
            <g key={axis.axis}>
              <line className="spider-spoke" x1={CENTER} y1={CENTER} x2={x} y2={y} />
              <text
                className={`spider-label${openAxis === axis.axis ? " open" : ""}`}

                x={lx}
                y={ly}
                textAnchor={lx < CENTER - 4 ? "end" : lx > CENTER + 4 ? "start" : "middle"}
                dominantBaseline="middle"
                onClick={compact ? undefined : () => setOpenAxis(openAxis === axis.axis ? null : axis.axis)}
              >
                {/* SVG's own tooltip: a <title> child, which hovers and is
                    read out. An aria-label here would do neither. */}
                {blurbs?.[axis.axis] ? <title>{blurbs[axis.axis]}</title> : null}
                {labels[axis.axis] ?? axis.axis}
                <tspan className="spider-score"> {axis.score}</tspan>
              </text>
            </g>
          );
        })}

        <polygon className="spider-shape" points={shape} />

        {axes.map((axis, i) => {
          const [x, y] = point(i, count, axis.score);
          return (
            <circle
              key={axis.axis}
              className={`spider-dot${openAxis === axis.axis ? " open" : ""}`}
              cx={x}
              cy={y}
              r={axis.score === 0 ? 2 : 4}
              onClick={() => setOpenAxis(openAxis === axis.axis ? null : axis.axis)}
            />
          );
        })}
      </svg>

      {selected && !compact ? (
        <div className="spider-detail">
          <h6>
            {labels[selected.axis] ?? selected.axis}
            <span className="spider-detail-score">{selected.score} of 5</span>
          </h6>

          {/* What the axis measures, before what it scored. These are story
              functions rather than identities, and the difference is exactly
              what a bare number hides. */}
          {blurbs?.[selected.axis] ? (
            <p className="axis-blurb">{blurbs[selected.axis]}</p>
          ) : null}

          <p className="axis-head">Most aligned actions</p>
          {selected.aligned.length > 0 ? (
            <ul className="axis-list aligned">
              {selected.aligned.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          ) : (
            <p className="tpl-note">
              Nothing in the manuscript instantiates this function for {profile.name}.
            </p>
          )}

          <p className="axis-head">Least aligned / contradictory actions</p>
          {selected.contradictory.length > 0 ? (
            <ul className="axis-list against">
              {selected.contradictory.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          ) : (
            <p className="tpl-note">Nothing recorded cuts against this reading.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
