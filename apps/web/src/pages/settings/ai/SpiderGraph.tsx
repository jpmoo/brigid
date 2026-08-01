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
const CENTRE = SIZE / 2;
const RADIUS = SIZE / 2 - 46;
const MAX = 5;
/** Room either side for the labels. */
const PAD = 78;

function point(index: number, count: number, value: number): [number, number] {
  // Straight up for the first axis, then clockwise — a radar read like a clock.
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  const r = (value / MAX) * RADIUS;
  return [CENTRE + Math.cos(angle) * r, CENTRE + Math.sin(angle) * r];
}

export function SpiderGraph({
  profile,
  labels,
}: {
  profile: CharacterAnalysis;
  labels: Record<string, string>;
}) {
  const [openAxis, setOpenAxis] = useState<string | null>(null);
  const axes = profile.axes;
  const count = axes.length;

  const shape = axes.map((a, i) => point(i, count, a.score).join(",")).join(" ");
  const selected = axes.find((a) => a.axis === openAxis) ?? null;

  return (
    <div className="spider">
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

        {axes.map((axis, i) => {
          const [x, y] = point(i, count, MAX);
          const [lx, ly] = point(i, count, MAX + 1.15);
          return (
            <g key={axis.axis}>
              <line className="spider-spoke" x1={CENTRE} y1={CENTRE} x2={x} y2={y} />
              <text
                className={`spider-label${openAxis === axis.axis ? " open" : ""}`}
                x={lx}
                y={ly}
                textAnchor={lx < CENTRE - 4 ? "end" : lx > CENTRE + 4 ? "start" : "middle"}
                dominantBaseline="middle"
                onClick={() => setOpenAxis(openAxis === axis.axis ? null : axis.axis)}
              >
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

      {selected ? (
        <div className="spider-detail">
          <h6>
            {labels[selected.axis] ?? selected.axis}
            <span className="spider-detail-score">{selected.score} of 5</span>
          </h6>

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
      ) : (
        <p className="tpl-note spider-hint">
          Click an axis to see what the score rests on, and what cuts against it.
        </p>
      )}
    </div>
  );
}
