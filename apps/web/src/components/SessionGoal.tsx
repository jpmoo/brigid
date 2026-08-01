import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Square } from "lucide-react";

/**
 * A writing session, against the clock.
 *
 * The pill sits in the corner of the manuscript and stays there — a session is
 * something you are in the middle of, and a control you have to go and find is
 * one you stop noticing. It counts down rather than up: what is left is the
 * thing being watched.
 *
 * Words are counted as a difference from where the manuscript stood when the
 * session began, so cutting a paragraph takes the words back off. That can go
 * below zero, and it should: an hour spent cutting is work, and a session that
 * quietly floored at nought would be flattering rather than honest.
 */

const KEY = "brigid.session";
const wordFmt = new Intl.NumberFormat();

export interface Session {
  /** Target length of the sitting, in minutes. */
  minutes: number;
  /** Words hoped for. Zero means the clock is the whole goal. */
  words: number;
  /** The manuscript's total when the session began. */
  from: number;
  /** Seconds already spent, banked whenever the session is paused. */
  spent: number;
  /** When the current run began, or null while paused. */
  since: number | null;
  /** Set once the word goal has been reached and acknowledged. */
  celebrated?: boolean;
  /** Set once the one extension has been spent. There is only ever one. */
  extended?: boolean;
  /**
   * Words gained and words lost, accumulated rather than netted.
   *
   * The tally on the pill is a net figure and cannot tell "wrote a thousand,
   * cut two hundred" from "wrote eight hundred". These two can, which is the
   * only way an afternoon of revising reads as work rather than as nothing
   * happening. Counted per save, so a sentence rewritten inside one save
   * settles to its net before it is seen — the alternative is counting every
   * keystroke, which would make deleting a typo a deletion.
   */
  added?: number;
  removed?: number;
}

/**
 * A little longer, as a share of the sitting rather than a fixed number.
 *
 * Five minutes on top of five is a different proposition from five on top of
 * ninety. A fifth keeps it in proportion — and below a whole minute it isn't
 * worth offering, so it isn't.
 */
const EXTENSION_SHARE = 0.2;

function extensionFor(minutes: number): number {
  return Math.floor(minutes * EXTENSION_SHARE);
}

/**
 * A session begins paused.
 *
 * It is started from the settings, which is not where the writing happens — so
 * the clock would otherwise be counting the walk back to the manuscript. Typing
 * is what starts it, the same thing that starts it again after any other pause.
 */
export function startSession(minutes: number, words: number, total: number): Session {
  return { minutes, words, from: total, spent: 0, since: null, added: 0, removed: 0 };
}

/** Records one save's worth of change, whichever way it went. */
export function recordChange(session: Session, delta: number): Session {
  if (delta === 0) return session;
  return delta > 0
    ? { ...session, added: (session.added ?? 0) + delta }
    : { ...session, removed: (session.removed ?? 0) - delta };
}

/**
 * How the sitting went.
 *
 * Words a minute is over time actually spent, so pausing to think doesn't
 * flatter it and neither does leaving the room. "Kept" is what survived of
 * what was written — below zero when more came out than went in, which is a
 * real way to spend an hour and worth saying plainly.
 */
export function stats(session: Session, seconds: number): {
  perMinute: number;
  added: number;
  removed: number;
  kept: number | null;
} {
  const added = session.added ?? 0;
  const removed = session.removed ?? 0;
  const minutes = seconds / 60;
  return {
    perMinute: minutes > 0 ? Math.round(added / minutes) : 0,
    added,
    removed,
    kept: added > 0 ? Math.round(((added - removed) / added) * 100) : null,
  };
}

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.minutes !== "number" || typeof parsed.from !== "number") return null;
    return {
      minutes: parsed.minutes,
      words: typeof parsed.words === "number" ? parsed.words : 0,
      from: parsed.from,
      spent: typeof parsed.spent === "number" ? parsed.spent : 0,
      since: typeof parsed.since === "number" ? parsed.since : null,
      ...(parsed.celebrated ? { celebrated: true } : {}),
      ...(parsed.extended ? { extended: true } : {}),
      added: typeof parsed.added === "number" ? parsed.added : 0,
      removed: typeof parsed.removed === "number" ? parsed.removed : 0,
    };
  } catch {
    return null;
  }
}

export function writeSession(session: Session | null): void {
  if (session) localStorage.setItem(KEY, JSON.stringify(session));
  else localStorage.removeItem(KEY);
}

/**
 * Stops the clock without ending the session.
 *
 * Leaving the manuscript — for the settings, for the library — is not writing,
 * so the clock shouldn't run through it. It is a pause and not a cancel: the
 * session is still yours when you come back, and typing starts it again.
 */
export function pauseSession(session: Session): Session {
  if (session.since === null) return session;
  return { ...session, spent: elapsed(session), since: null };
}

export function resumeSession(session: Session): Session {
  if (session.since !== null) return session;
  return { ...session, since: Date.now() };
}

/** Seconds spent, counting the run in progress. */
function elapsed(session: Session): number {
  const running = session.since === null ? 0 : (Date.now() - session.since) / 1000;
  return session.spent + running;
}

/** The sitting in a sentence, for the end of it. */
function summary(figures: ReturnType<typeof stats>): string {
  const parts = [`${figures.perMinute} words a minute`];
  if (figures.added > 0) {
    parts.push(`${wordFmt.format(figures.added)} written, ${wordFmt.format(figures.removed)} cut`);
    if (figures.kept !== null) parts.push(`${figures.kept}% kept`);
  }
  return parts.join(" · ");
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * How near the end it is.
 *
 * Two warnings rather than one, at a fifth and a tenth of the time left, so the
 * first is a nudge and the second is the last of it.
 */
function urgency(left: number, total: number): "" | " warm" | " hot" {
  if (total <= 0) return "";
  const fraction = left / total;
  if (fraction <= 0.1) return " hot";
  if (fraction <= 0.2) return " warm";
  return "";
}

export function SessionPill({
  session,
  totalWords,
  onChange,
}: {
  session: Session;
  /** The manuscript's total now, so the difference is the session's work. */
  totalWords: number;
  onChange: (session: Session | null) => void;
}) {
  // Only to force a repaint each second: the truth is in the timestamps, so a
  // tab that was asleep comes back with the right time rather than the number
  // of ticks it managed to run.
  const [, tick] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (session.since === null) return;
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [session.since]);

  useEffect(() => {
    return () => {
      if (frame.current) window.cancelAnimationFrame(frame.current);
    };
  }, []);

  const spent = elapsed(session);
  const target = session.minutes * 60;
  const left = target - spent;
  const done = left <= 0;
  const written = totalWords - session.from;

  /**
   * The two moments worth interrupting for.
   *
   * Reaching the words is the good one and can happen at any point, so it is
   * offered while there is still time on the clock: carry on, or stop here.
   * Running out without them is the other, and it comes with the one extension
   * a session gets — once, or it isn't a session, it's an afternoon.
   */
  const figures = stats(session, spent);
  const met = session.words > 0 && written >= session.words;
  const celebrating = met && session.celebrated !== true;
  const ran_out = done && !celebrating;

  const pause = useCallback(() => onChange(pauseSession(session)), [session, onChange]);
  const resume = useCallback(() => onChange(resumeSession(session)), [session, onChange]);

  const carryOn = () => onChange({ ...session, celebrated: true });
  const extension = extensionFor(session.minutes);
  const longer = () =>
    onChange({
      ...session,
      minutes: session.minutes + extension,
      extended: true,
      // The clock stopped when it ran out; more time means it runs again.
      since: session.since ?? Date.now(),
    });

  return (
    <div
      className={`session-pill${celebrating ? " met" : done ? " done" : urgency(left, target)}${
        session.since === null && !celebrating ? " paused" : ""
      }`}
      role="status"
      aria-live={celebrating || ran_out ? "polite" : "off"}
    >
      {celebrating ? (
        <>
          <span className="session-cheer">
            {wordFmt.format(written)} words. That&rsquo;s the goal.
            <em>{summary(figures)}</em>
          </span>
          <span className="session-controls wide">
            {/* Only if there is a session left to carry on with: reaching the
                words on the last tick is worth saying so about, but there is
                nothing to go back to. */}
            {done ? null : (
              <button type="button" onClick={carryOn}>
                Keep going
              </button>
            )}
            <button type="button" onClick={() => onChange(null)}>
              Finish
            </button>
          </span>
        </>
      ) : ran_out ? (
        <>
          <span className="session-cheer">
            Time. {wordFmt.format(written)}
            {session.words > 0 ? ` of ${wordFmt.format(session.words)}` : ""} words.
            <em>{summary(figures)}</em>
          </span>
          <span className="session-controls wide">
            {session.extended === true || extension < 1 ? null : (
              <button type="button" onClick={longer}>
                {extension} more {extension === 1 ? "minute" : "minutes"}
              </button>
            )}
            <button type="button" onClick={() => onChange(null)}>
              Finish
            </button>
          </span>
        </>
      ) : (
        <>
          <span className="session-clock">{clock(left)}</span>

      <span className="session-words">
        {/* Below zero is a real answer, and the sign says so rather than the
            number quietly starting again from nothing. */}
        {written < 0 ? "−" : ""}
        {wordFmt.format(Math.abs(written))}
        {session.words > 0 ? <em> / {wordFmt.format(session.words)}</em> : null}
      </span>

      {/* Only once there is enough of it to mean anything: a rate over ten
          seconds is a number about nothing. */}
      {spent > 30 && figures.perMinute > 0 ? (
        <span className="session-rate" title={summary(figures)}>
          {figures.perMinute}/min
        </span>
      ) : null}

      <span className="session-controls">
        {celebrating || ran_out ? null : session.since === null ? (
          <button type="button" title="Resume" aria-label="Resume" onClick={resume}>
            <Play size={12} />
          </button>
        ) : (
          <button type="button" title="Pause" aria-label="Pause" onClick={pause}>
            <Pause size={12} />
          </button>
        )}
        <button
          type="button"
          title="End the session"
          aria-label="End the session"
          onClick={() => onChange(null)}
        >
          <Square size={12} />
        </button>
      </span>
        </>
      )}
    </div>
  );
}
