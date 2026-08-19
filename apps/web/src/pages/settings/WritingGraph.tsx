import { useEffect, useMemo, useState } from "react";
import { api } from "../../api.js";
import type { WritingActivity } from "../../api.js";

/**
 * What was written and what was cut, over time.
 *
 * Added above the line and deleted below, because they are different work and a
 * single net figure hides which one happened. A day of writing four hundred
 * words and cutting three hundred and ninety is not a day of writing ten, and
 * the word count has never been able to tell those apart.
 *
 * Minutes while a sitting is running and days otherwise — the two kinds of goal
 * ask questions at different scales, and an hour drawn in days is one bar.
 *
 * Nothing before the first recorded minute is drawn as a quiet stretch, because
 * it was not one: it is time nobody was counting, and a chart that draws
 * silence and absence identically is telling a story that did not happen.
 */

const HEIGHT = 92;
const fmt = new Intl.NumberFormat();

function label(at: string, by: "minute" | "day"): string {
  const when = new Date(at);
  return by === "minute"
    ? when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WritingGraph({ workId, by, days }: { workId: string; by: "minute" | "day"; days: number }) {
  const [data, setData] = useState<WritingActivity | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    void api
      .workActivity(workId, by, days)
      .then((got) => alive && setData(got))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [workId, by, days]);

  const shape = useMemo(() => {
    if (!data) return null;
    const peak = Math.max(1, ...data.buckets.map((b) => Math.max(b.added, b.deleted)));
    const written = data.buckets.reduce((sum, b) => sum + b.added, 0);
    const cut = data.buckets.reduce((sum, b) => sum + b.deleted, 0);
    return { peak, written, cut };
  }, [data]);

  if (failed) return <p className="tpl-note">Could not read the writing history.</p>;
  if (!data || !shape) return <p className="tpl-note">Reading the history…</p>;

  if (data.buckets.length === 0) {
    return (
      <p className="tpl-note">
        {data.since
          ? `Nothing written in the last ${by === "minute" ? "while" : `${days} days`}.`
          : "Nothing recorded yet. Brigid started keeping this when it was last updated — anything written before then was not counted, and cannot be recovered."}
      </p>
    );
  }

  // One column per bucket, sized to fit whatever came back.
  const width = Math.max(data.buckets.length * 6, 240);
  const step = width / data.buckets.length;
  const bar = Math.max(2, Math.min(14, step - 2));
  const mid = HEIGHT / 2;

  return (
    <div className="wg">
      <div className="wg-head">
        <span className="wg-key">
          <i className="wg-dot added" /> {fmt.format(shape.written)} written
        </span>
        <span className="wg-key">
          <i className="wg-dot cut" /> {fmt.format(shape.cut)} cut
        </span>
        <span className="wg-net">
          {shape.written - shape.cut >= 0 ? "+" : ""}
          {fmt.format(shape.written - shape.cut)} net
        </span>
      </div>

      <div className="wg-scroll">
        <svg
          className="wg-svg"
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`${fmt.format(shape.written)} words written and ${fmt.format(shape.cut)} cut, by ${by}`}
        >
          {data.buckets.map((b, i) => {
            const x = i * step + (step - bar) / 2;
            const up = (b.added / shape.peak) * (mid - 4);
            const down = (b.deleted / shape.peak) * (mid - 4);
            return (
              <g key={b.at}>
                <title>
                  {label(b.at, by)} — {fmt.format(b.added)} written, {fmt.format(b.deleted)} cut
                </title>
                {b.added > 0 ? (
                  <rect className="wg-bar added" x={x} y={mid - up} width={bar} height={up} rx={1} />
                ) : null}
                {b.deleted > 0 ? (
                  <rect className="wg-bar cut" x={x} y={mid} width={bar} height={down} rx={1} />
                ) : null}
              </g>
            );
          })}
          <line className="wg-zero" x1={0} y1={mid} x2={width} y2={mid} />
        </svg>
      </div>

      <p className="wg-foot">
        {label(data.buckets[0]!.at, by)} to {label(data.buckets[data.buckets.length - 1]!.at, by)},
        by {by}. Words that moved from one place to another count as neither.
      </p>
    </div>
  );
}
