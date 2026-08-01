import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Maximize2,
  Play,
  X,
  RefreshCw,
} from "lucide-react";
import type {
  AnalysisDrift,
  CharacterAnalysis,
  CharacterRunProgress,
  ModelFit,
  PlacedDigest,
  StructureAnalysis,
  StructureRunProgress,
} from "@brigid/shared";
import { ApiError, api } from "../../api.js";
import type { AnalysisBundle } from "../../api.js";
import { FitGauge } from "./ai/FitGauge.js";
import { SpiderGraph } from "./ai/SpiderGraph.js";

/**
 * The AI tools for one manuscript.
 *
 * Nothing here can run until the book has been read. That reading happens in
 * the background and keeps up with the writing on its own, so the honest thing
 * while it is under way is to say how far it has got rather than to offer
 * buttons that would refuse.
 */

type Tab = "structure" | "characters" | "raw";

export function AiPane({ workId }: { workId: string }) {
  const [bundle, setBundle] = useState<AnalysisBundle | null>(null);
  const [tab, setTab] = useState<Tab>("structure");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setBundle(await api.getAnalysis(workId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not load the analysis");
    }
  }, [workId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * While the walk is under way the counts move, so they are re-read. Once it
   * is done the polling stops — there is nothing left to watch, and a settings
   * page left open shouldn't keep a server busy all afternoon.
   */
  const run = bundle?.characterRun ?? null;
  const shapeRun = bundle?.structureRun ?? null;
  const profiling = run?.status === "queued" || run?.status === "running";
  const shaping = shapeRun?.status === "queued" || shapeRun?.status === "running";
  // Anything happening on the server is a reason to keep looking.
  const walking = bundle ? !bundle.progress.ready || profiling || shaping : false;
  useEffect(() => {
    if (!walking) return;
    const id = setInterval(() => void reload(), 5000);
    return () => clearInterval(id);
  }, [walking, reload]);

  async function start(what: "structure" | "characters") {
    setBusy(what);
    setError(null);
    try {
      if (what === "structure") await api.runStructureAnalysis(workId);
      else await api.runCharacterAnalysis(workId, {});
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `the analysis did not finish: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    try {
      await api.cancelCharacterRun(workId);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not stop the run");
    }
  }

  if (!bundle) {
    return <p className="tpl-note">{error ?? "Loading…"}</p>;
  }

  const { progress } = bundle;
  const structure = bundle.reports.find((r) => r.kind === "structure");
  const characters = bundle.reports.filter((r) => r.kind === "character");

  return (
    <div className="tpl-detail">
      <ReadingState progress={progress} />

      {progress.ready ? (
        <>
          <nav className="subtabs" role="tablist" style={{ marginTop: 14 }}>
            {(
              [
                ["structure", "Story shape"],
                ["characters", "Characters"],
                ["raw", "What was collected"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "selected" : ""}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </nav>

          {error ? <div className="alert error">{error}</div> : null}

          {tab === "structure" ? (
            <StructurePane
              report={structure}
              labels={bundle.modelLabels}
              blurbs={bundle.modelBlurbs}
              run={shapeRun}
              busy={busy === "structure"}
              onRun={() => void start("structure")}
            />
          ) : tab === "characters" ? (
            <CharactersPane
              bundle={bundle}
              reports={characters}
              run={run}
              busy={busy === "characters"}
              onRun={() => void start("characters")}
              onCancel={() => void cancel()}
            />
          ) : (
            <RawPane workId={workId} />
          )}
        </>
      ) : null}
    </div>
  );
}

/** How far the reading has got. */
function ReadingState({ progress }: { progress: AnalysisBundle["progress"] }) {
  if (progress.total === 0) {
    return (
      <p className="tpl-note">
        There is nothing written to read yet. Once the manuscript has some prose in it,
        Brigid will read it in the background and the tools here will open.
      </p>
    );
  }

  if (progress.ready) {
    return (
      <p className="tpl-note">
        All {progress.total} sections have been read
        {progress.status === "walking" ? " — re-reading what has changed since" : ""}. The
        analyses below are built from that reading, not from the manuscript directly.
      </p>
    );
  }

  const left = progress.total - progress.done;
  const pct = Math.round((progress.done / progress.total) * 100);

  return (
    <>
      <h4 className="tpl-section">Reading the manuscript</h4>
      <div className="digest-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="digest-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="tpl-note">
        <strong>
          {progress.done} of {progress.total} sections read
        </strong>{" "}
        &mdash; {left} to go
        {progress.etaSeconds !== null ? <>, about {humanDuration(progress.etaSeconds)} left</> : null}.
        This happens in the background and keeps up with your edits on its own; the
        analyses open when it finishes. You can carry on writing.
      </p>

      {progress.status === "failed" && progress.lastError ? (
        <div className="alert error">
          <AlertTriangle size={14} /> The reading stopped: {progress.lastError}. It will try
          again shortly.
        </div>
      ) : null}
    </>
  );
}

function humanDuration(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * How far the book has moved since a report was written.
 *
 * A bar rather than a warning, because the decision it informs is "is this
 * worth twenty minutes of the GPU again", and that turns entirely on the size
 * of the change. A fixed typo and three new chapters both make a report "no
 * longer current"; only one of them makes it wrong.
 */
function Stale({ drift }: { drift?: AnalysisDrift }) {
  // Reports written before drift was recorded can only offer the flag.
  if (!drift?.measurable) {
    return (
      <div className="alert warn">
        <AlertTriangle size={14} /> The manuscript has changed since this was written. Run
        it again for a current reading.
      </div>
    );
  }

  const pct = Math.round(drift.fraction * 100);
  const band = pct >= 25 ? "heavy" : pct >= 10 ? "moderate" : "slight";
  const verdict =
    band === "heavy"
      ? "Worth running again — this is about a book that has substantially changed."
      : band === "moderate"
        ? "Enough has changed that the proportions may have shifted. Worth a re-run before trusting the positions."
        : "Small enough that the findings below should still hold.";

  return (
    <div className={`drift ${band}`}>
      <div className="drift-head">
        <span className="drift-label">Changed since this was written</span>
        <span className="drift-figure">
          {drift.words.toLocaleString()} {drift.words === 1 ? "word" : "words"}
          {pct >= 1 ? ` · ${pct}%` : ""}
        </span>
      </div>
      <div
        className="drift-track"
        role="img"
        aria-label={`${pct}% of the manuscript has changed since this analysis`}
      >
        <div className="drift-fill" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </div>
      <p className="drift-note">
        Across {drift.sections} {drift.sections === 1 ? "section" : "sections"}. {verdict}
      </p>
    </div>
  );
}

function StructurePane({
  report,
  labels,
  blurbs,
  run,
  busy,
  onRun,
}: {
  report: AnalysisBundle["reports"][number] | undefined;
  labels: Record<string, string>;
  blurbs: Record<string, string>;
  run: StructureRunProgress | null;
  busy: boolean;
  onRun: () => void;
}) {
  const result = report?.result as StructureAnalysis | undefined;
  /**
   * A set rather than one at a time: the point of these is comparison, and a
   * panel that shut Freytag to show you Three-Act made comparing them a memory
   * exercise.
   */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((held) => {
      const next = new Set(held);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const allOpen = (result?.models.length ?? 0) > 0 && open.size >= (result?.models.length ?? 0);
  const working = run?.status === "queued" || run?.status === "running";

  return (
    <>
      <div className="be-line" style={{ marginTop: 12 }}>
        <button className="btn" type="button" disabled={busy || working} onClick={onRun}>
          {result ? <RefreshCw size={14} /> : <Play size={14} />}
          {working ? "Reading the shape…" : result ? "Run again" : "Analyse the story's shape"}
        </button>
        {working ? (
          <span className="muted">
            Running on the server &mdash; you can leave this page
            {run?.elapsedSeconds && run.elapsedSeconds > 45
              ? `, ${humanDuration(run.elapsedSeconds)} so far`
              : ""}
            .
          </span>
        ) : null}
      </div>

      {run?.status === "failed" && run.lastError ? (
        <div className="alert error">
          <AlertTriangle size={14} /> The analysis stopped: {run.lastError}
        </div>
      ) : null}

      {!result ? (
        <p className="tpl-note">
          Seven frameworks, each rated on how well the manuscript actually fits it &mdash;
          judged on where the turns fall, not just whether they exist. A weak fit to all
          seven is a legitimate finding, not a failure.
        </p>
      ) : (
        <>
          {report && !report.current ? <Stale drift={report.drift} /> : null}

          <h4 className="tpl-section">Overall</h4>
          <p className="fit-overview">{result.overview}</p>
          <p className="fit-overview">
            <strong>
              {result.bestFit
                ? `Best fit: ${labels[result.bestFit] ?? result.bestFit}.`
                : "No single framework fits this manuscript best."}
            </strong>{" "}
            {result.bestFitWhy}
          </p>

          {/* Same control as the outline's, because it does the same thing. */}
          <div className="outline-head-bar fit-head-bar">
            <span>Framework by framework</span>
            <button
              className="outline-toggle-all"
              type="button"
              title={allOpen ? "Collapse all" : "Expand all"}
              aria-label={allOpen ? "Collapse all" : "Expand all"}
              onClick={() =>
                setOpen(allOpen ? new Set() : new Set(result.models.map((m) => m.model)))
              }
            >
              {allOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
            </button>
          </div>
          {byFit(result.models).map((fit) => (
            <FitGauge
              key={fit.model}
              fit={fit}
              label={labels[fit.model] ?? fit.model}
              blurb={blurbs[fit.model]}
              open={open.has(fit.model)}
              onOpen={() => toggle(fit.model)}
            />
          ))}
        </>
      )}
    </>
  );
}

/**
 * Best fit first.
 *
 * "Not applicable" sorts last rather than lowest: the framework was never
 * asked, so it belongs after the answers rather than at the bottom of them,
 * where it would read as the worst result. Within a band the canonical order
 * is kept — sorting a copy, and JS sorts stably — so the seven don't reshuffle
 * between runs that rate them the same.
 */
const FIT_ORDER: Record<ModelFit["fit"], number> = {
  good: 0,
  moderate: 1,
  low: 2,
  bad: 3,
  na: 4,
};

function byFit(models: ModelFit[]): ModelFit[] {
  return [...models].sort((a, b) => FIT_ORDER[a.fit] - FIT_ORDER[b.fit]);
}

function CharactersPane({
  bundle,
  reports,
  run,
  busy,
  onRun,
  onCancel,
}: {
  bundle: AnalysisBundle;
  reports: AnalysisBundle["reports"];
  run: CharacterRunProgress | null;
  busy: boolean;
  onRun: () => void;
  onCancel: () => void;
}) {
  const working = run?.status === "queued" || run?.status === "running";
  const judgeable = bundle.roster.filter((r) => r.judgeable);
  const thin = bundle.roster.filter((r) => !r.judgeable);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showThin, setShowThin] = useState(false);

  /**
   * Most prominent first, and stably so.
   *
   * The roster is already ordered by how much of the book a character actually
   * occupies, which is the order these should arrive in — a tile grid that
   * re-sorted itself as each profile landed would move the one being read.
   */
  const rank = new Map(bundle.roster.map((r, i) => [r.name.toLowerCase(), i]));
  const ordered = reports
    .map((report) => ({ profile: report.result as CharacterAnalysis, report }))
    .sort(
      (a, b) =>
        (rank.get(a.profile.name.toLowerCase()) ?? 999) -
        (rank.get(b.profile.name.toLowerCase()) ?? 999),
    );
  const shownProfile = ordered.find((o) => o.profile.name === expanded) ?? null;

  const profiles = reports.map((r) => r.result as CharacterAnalysis);

  return (
    <>
      <div className="be-line" style={{ marginTop: 12 }}>
        <button
          className="btn"
          type="button"
          disabled={busy || working || judgeable.length === 0}
          onClick={onRun}
        >
          {profiles.length > 0 ? <RefreshCw size={14} /> : <Play size={14} />}
          {working
            ? "Profiling…"
            : profiles.length > 0
              ? "Run again"
              : `Profile ${judgeable.length} character${judgeable.length === 1 ? "" : "s"}`}
        </button>
        {working ? (
          <button className="btn secondary" type="button" onClick={onCancel}>
            Stop
          </button>
        ) : null}
      </div>

      {working ? <RunProgress run={run!} /> : null}
      {!working && run?.lastError ? (
        <div className="alert warn">
          <AlertTriangle size={14} /> {run.lastError}. The rest of the cast was profiled.
        </div>
      ) : null}

      {judgeable.length === 0 ? (
        <p className="tpl-note">
          No character in this manuscript has enough recorded action to score a profile
          against. Every axis would rest on too little to cite, so running the model would
          only confirm that.
        </p>
      ) : null}

      {profiles.length > 0 ? (
        <>
          {/* Readable now, but not yet final: the rule that only one character
              ordinarily carries a 5 on an axis can only be applied once there
              is a whole cast to compare, so a score read mid-run may drop. */}
          {working ? (
            <p className="tpl-note">
              These are readable as they land, but not settled &mdash; a score of 5 means
              &ldquo;the story&rsquo;s primary carrier of this&rdquo;, and only one character
              can hold it. That comparison runs when the cast is complete, so a 5 here may
              become a 4.
            </p>
          ) : null}

          <div className="cast-grid">
            {ordered.map(({ profile, report }) => {
              return (
                <div key={profile.name} className="cast-tile">
                  <div className="cast-tile-head">
                    <div className="cast-tile-titles">
                      <span className="cast-tile-name">{profile.name}</span>
                      {profile.epithet ? (
                        <span className="cast-tile-epithet">{profile.epithet}</span>
                      ) : null}
                      <span className="cast-tile-shape">
                        {shapeOf(profile, bundle.axisLabels)}
                      </span>
                    </div>
                    {/* The whole report needs room the tile hasn't got, so it
                        opens over the page rather than pushing the grid apart. */}
                    <button
                      type="button"
                      className="cast-tile-expand"
                      title={`Open ${profile.name}'s full profile`}
                      aria-label={`Open ${profile.name}'s full profile`}
                      onClick={() => setExpanded(profile.name)}
                    >
                      <Maximize2 size={14} />
                    </button>
                  </div>

                  <SpiderGraph
                    profile={profile}
                    labels={bundle.axisLabels}
                    blurbs={bundle.axisBlurbs}
                    compact
                  />

                </div>
              );
            })}
          </div>

          {shownProfile ? (
            <div
              className="modal-backdrop"
              onClick={() => setExpanded(null)}
              role="presentation"
            >
              <div className="modal wide cast-modal" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="modal-close"
                  aria-label="Close"
                  onClick={() => setExpanded(null)}
                >
                  <X size={16} />
                </button>

                <h2 className="card-title">{shownProfile.profile.name}</h2>
                {shownProfile.profile.epithet ? (
                  <p className="card-subtitle cast-modal-epithet">
                    {shownProfile.profile.epithet}
                  </p>
                ) : null}

                <div className="modal-body">
                  {shownProfile.report && !shownProfile.report.current ? (
                    <Stale drift={shownProfile.report.drift} />
                  ) : null}

                  {/* Full size, and interactive: a spoke opens what its score
                      rested on, which is the whole reason to be in here. */}
                  <SpiderGraph
                    profile={shownProfile.profile}
                    labels={bundle.axisLabels}
                    blurbs={bundle.axisBlurbs}
                  />

                  <p className="tpl-note">
                    Scored against <strong>{shownProfile.profile.focal}</strong>&rsquo;s arc.
                  </p>

                  <p className="fit-overview">{shownProfile.profile.summary}</p>

                  {shownProfile.profile.phaseShifts.length > 0 ? (
                    <>
                      <h6>Phase shifts</h6>
                      <ul className="fit-list">
                        {shownProfile.profile.phaseShifts.map((shift, n) => (
                          <li key={n}>{shift}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  {/* Every axis laid out, rather than one at a time behind a
                      click. The rubric's whole discipline is that a score of 2
                      or higher rests on events you can point at — so in the
                      full report they are all on the page, including what cuts
                      against each reading. */}
                  <h6 className="cast-axes-head">Axis by axis</h6>
                  {[...shownProfile.profile.axes]
                    .sort((a, b) => b.score - a.score)
                    .map((axis) => (
                      <div className="cast-axis" key={axis.axis}>
                        <div className="cast-axis-head">
                          <span className="cast-axis-name">
                            {bundle.axisLabels[axis.axis] ?? axis.axis}
                          </span>
                          <span className={`cast-axis-score s${axis.score}`}>
                            {axis.score} of 5
                          </span>
                        </div>

                        {bundle.axisBlurbs[axis.axis] ? (
                          <p className="axis-blurb">{bundle.axisBlurbs[axis.axis]}</p>
                        ) : null}

                        <p className="axis-head">Most aligned actions</p>
                        {axis.aligned.length > 0 ? (
                          <ul className="axis-list aligned">
                            {axis.aligned.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="tpl-note">
                            Nothing in the manuscript instantiates this function for{" "}
                            {shownProfile.profile.name}.
                          </p>
                        )}

                        <p className="axis-head">What cuts against it</p>
                        {axis.contradictory.length > 0 ? (
                          <ul className="axis-list contradictory">
                            {axis.contradictory.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="tpl-note">Nothing recorded cuts against this reading.</p>
                        )}
                      </div>
                    ))}

                  {shownProfile.profile.confidence ? (
                    <>
                      <h6 className="cast-axes-head">Confidence</h6>
                      <p className="tpl-note">{shownProfile.profile.confidence}</p>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* Not an omission but a finding, and one worth being able to put away:
          the rubric requires citable events for any score of 2 or higher, so a
          character with four recorded actions can only ever produce a flat row
          of noughts and ones. Spending a model on that reaches a conclusion
          already known. Shut by default — this is the answer to a question
          nobody has asked yet. */}
      {thin.length > 0 ? (
        <div className="thin-cast">
          <button
            type="button"
            className="thin-head"
            aria-expanded={showThin}
            onClick={() => setShowThin(!showThin)}
          >
            <ChevronRight size={14} className="fit-caret" aria-hidden="true" />
            <span className="thin-title">
              {thin.length} {thin.length === 1 ? "character was" : "characters were"} not
              profiled
            </span>
          </button>

          {showThin ? (
            <>
              <p className="tpl-note">
                Every score of 2 or higher has to rest on events that can be pointed at, so
                these appear too little for a profile to say anything a flat row of noughts
                wouldn&rsquo;t. Writing them further and re-reading will bring them in.
              </p>
              <ul className="thin-list">
                {thin.map((entry) => (
                  <li key={entry.name}>
                    <strong>{entry.name}</strong>
                    {entry.reason ? <span className="thin-reason">{entry.reason}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * The raw reading.
 *
 * Shown because the analyses are only as good as this, and a spider graph
 * nobody can check is a spider graph nobody should believe.
 */
/**
 * A queued run, as it happens.
 *
 * Worth showing character by character rather than as a single bar: each one is
 * minutes long, and "profiling Elizabeth Bennet, 4 of 12" is a different kind
 * of reassurance from a bar that has not moved for six minutes.
 */
/**
 * What the shape is, in two words.
 *
 * The chart's value is the combination of its axes, so the tile is captioned
 * with the two the character actually carries rather than with a single label
 * that would flatten exactly what the radar exists to show.
 */
function shapeOf(profile: CharacterAnalysis, labels: Record<string, string>): string {
  const top = [...profile.axes]
    .filter((a) => a.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((a) => labels[a.axis] ?? a.axis);
  return top.length > 0 ? top.join(" · ") : "Flat profile";
}

function RunProgress({ run }: { run: CharacterRunProgress }) {
  const pct = run.total > 0 ? Math.round((run.done / run.total) * 100) : 0;
  return (
    <>
      <div className="digest-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="digest-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="tpl-note">
        <strong>
          {run.done} of {run.total} profiled
        </strong>
        {run.current ? <> &mdash; working on {run.current}</> : null}
        {run.etaSeconds !== null ? <>, about {humanDuration(run.etaSeconds)} left</> : null}. This
        runs on the server, so you can close this page and come back to it.
      </p>
      {run.lastError ? (
        <p className="tpl-note">
          <AlertTriangle size={13} /> {run.lastError} &mdash; the run carried on.
        </p>
      ) : null}
    </>
  );
}

function RawPane({ workId }: { workId: string }) {
  const [sections, setSections] = useState<PlacedDigest[] | null>(null);
  /** A set: reading one section against another is the usual reason to be here. */
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    void api.getDigest(workId).then((d) => setSections(d.sections));
  }, [workId]);

  if (!sections) return <p className="tpl-note">Loading…</p>;

  const allOpen = sections.length > 0 && open.size >= sections.length;

  return (
    <>
      <p className="tpl-note" style={{ marginTop: 12 }}>
        What the reading collected, section by section, with each section&rsquo;s position in
        the finished book. This is everything the frameworks were judged from &mdash; the
        model never sees your prose at analysis time, only this.
      </p>

      {/* Same control as the outline's, for the same job. */}
      <div className="outline-head-bar fit-head-bar">
        <span>
          {sections.length} {sections.length === 1 ? "section" : "sections"}
        </span>
        <button
          className="outline-toggle-all"
          type="button"
          title={allOpen ? "Collapse all" : "Expand all"}
          aria-label={allOpen ? "Collapse all" : "Expand all"}
          onClick={() =>
            setOpen(allOpen ? new Set() : new Set(sections.map((sec) => sec.blockId)))
          }
        >
          {allOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
        </button>
      </div>

      {sections.map((section) => (
        <div className="raw-section" key={section.blockId}>
          <button
            type="button"
            className="raw-head"
            onClick={() =>
              setOpen((held) => {
                const next = new Set(held);
                if (!next.delete(section.blockId)) next.add(section.blockId);
                return next;
              })
            }
            aria-expanded={open.has(section.blockId)}
          >
            <ChevronRight size={13} className="fit-caret" aria-hidden="true" />
            <span className="raw-at">
              {Math.round(section.start * 100)}&ndash;{Math.round(section.end * 100)}%
            </span>
            <span className="raw-name">{section.label ?? "Untitled section"}</span>
            <span className="raw-count">
              {section.events.length} event{section.events.length === 1 ? "" : "s"},{" "}
              {section.characters.length} character{section.characters.length === 1 ? "" : "s"}
            </span>
          </button>

          {open.has(section.blockId) ? (
            <div className="raw-body">
              {section.events.length > 0 ? (
                <>
                  <h6>Events</h6>
                  <ul className="fit-list">
                    {section.events.map((e, i) => (
                      <li key={i}>
                        {e.what}
                        {e.kind ? <span className="raw-kind">{e.kind}</span> : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {section.characters.map((c) => (
                <div key={c.name} className="raw-character">
                  <h6>
                    {c.name}
                    {c.aliases?.length ? <span className="raw-alias">also {c.aliases.join(", ")}</span> : null}
                  </h6>
                  <ul className="fit-list">
                    {c.actions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                  {c.wants?.length ? <p className="raw-wants">Wants: {c.wants.join("; ")}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}
