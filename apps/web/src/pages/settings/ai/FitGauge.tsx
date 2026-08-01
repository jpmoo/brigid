import type { FitRating, ModelFit } from "@brigid/shared";

/**
 * How well the book fits one framework, as a bar across a spectrum.
 *
 * Four bands, running bad → low → moderate → good. The one rule the drawing has
 * to respect: **"not applicable" is not a low score.** Fifteen timed beats
 * cannot be asked of a three-thousand-word story, and rendering that as an
 * empty bar would read as "your manuscript fails Save the Cat" — an accusation
 * the reference document never makes. It gets its own greyed treatment and no
 * bar at all.
 */

const BANDS: { key: Exclude<FitRating, "na">; label: string }[] = [
  { key: "bad", label: "Bad fit" },
  { key: "low", label: "Low fit" },
  { key: "moderate", label: "Moderate fit" },
  { key: "good", label: "Good fit" },
];

/** How far across the spectrum each rating reaches. */
const REACH: Record<Exclude<FitRating, "na">, number> = {
  bad: 0.16,
  low: 0.42,
  moderate: 0.68,
  good: 1,
};

export function FitGauge({
  fit,
  label,
  onOpen,
  open,
}: {
  fit: ModelFit;
  label: string;
  onOpen: () => void;
  open: boolean;
}) {
  const notApplicable = fit.fit === "na";
  const band = notApplicable ? null : (fit.fit as Exclude<FitRating, "na">);

  return (
    <div className={`fit-row${notApplicable ? " na" : ""}`}>
      <button
        type="button"
        className="fit-head"
        onClick={onOpen}
        aria-expanded={open}
        title={open ? "Hide the reasoning" : "Show the reasoning"}
      >
        <span className="fit-name">{label}</span>
        <span className={`fit-verdict ${fit.fit}`}>
          {notApplicable ? "Not applicable" : BANDS.find((b) => b.key === fit.fit)?.label}
        </span>
      </button>

      {notApplicable ? (
        <p className="fit-na">
          This manuscript is the wrong length class for this framework, so the question
          can&rsquo;t be asked of it. That is not a poor score.
        </p>
      ) : (
        <div className="fit-track" role="img" aria-label={`${label}: ${fit.fit} fit`}>
          <div className={`fit-fill ${fit.fit}`} style={{ width: `${REACH[band!] * 100}%` }} />
          {/* The band edges, so a bar reaching two-thirds reads as "moderate"
              rather than as an unlabelled two-thirds of something. */}
          {BANDS.slice(0, -1).map((band) => (
            <span key={band.key} className="fit-tick" style={{ left: `${REACH[band.key] * 100}%` }} />
          ))}
        </div>
      )}

      {!notApplicable ? (
        <div className="fit-scale" aria-hidden="true">
          {BANDS.map((band) => (
            <span key={band.key}>{band.label}</span>
          ))}
        </div>
      ) : null}

      {open ? (
        <div className="fit-detail">
          <p className="fit-summary">{fit.summary}</p>

          {fit.evidence.length > 0 ? (
            <>
              <h6>What&rsquo;s there</h6>
              <ul className="fit-list">
                {fit.evidence.map((e, i) => (
                  <li key={i}>
                    <strong>{e.element}</strong>
                    {typeof e.position === "number" ? (
                      <span className="fit-at">{Math.round(e.position * (e.position <= 1 ? 100 : 1))}%</span>
                    ) : null}
                    <span className="fit-ev">{e.event}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {fit.gaps.length > 0 ? (
            <>
              <h6>What&rsquo;s missing or misplaced</h6>
              <ul className="fit-list gaps">
                {fit.gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
