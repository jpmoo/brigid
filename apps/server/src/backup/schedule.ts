import { settings } from "@brigid/db";
import { db, isDbReady } from "../db.js";
import { runtimeConfig } from "../config.js";
import { pruneBackups, takeBackup } from "./store.js";

/**
 * The nightly backup.
 *
 * A timer rather than cron, so the schedule is the app's own and moves with it
 * — nothing to install on the host and nothing to forget when the app moves to
 * another one. It re-reads the settings each time it fires, so changing the
 * hour takes effect that same night rather than at the next restart.
 */

export interface BackupSchedule {
  enabled: boolean;
  hour: number;
  minute: number;
  keep: number;
  /** The zone the hour is read in. Null means the host's own clock. */
  timezone: string | null;
}

export const DEFAULT_SCHEDULE: BackupSchedule = {
  enabled: true,
  timezone: null,
  hour: 1,
  minute: 0,
  keep: 10,
};

export async function readSchedule(): Promise<BackupSchedule> {
  if (!isDbReady()) return DEFAULT_SCHEDULE;
  const [row] = await db
    .select({
      enabled: settings.backupEnabled,
      hour: settings.backupHour,
      timezone: settings.backupTimezone,
      minute: settings.backupMinute,
      keep: settings.backupKeep,
    })
    .from(settings)
    .limit(1);
  return row ?? DEFAULT_SCHEDULE;
}

/**
 * How far a zone is from UTC at a given instant.
 *
 * Read out of Intl rather than kept in a table, because it is not a constant:
 * the same zone is four hours from UTC in August and five in December, and a
 * table would be wrong for half the year and wrong again whenever a government
 * changes its mind.
 */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const field = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // What the wall clock reads there, read back as though it were UTC. The gap
  // between that and the real instant is the offset.
  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    // Midnight comes back as hour 24 from some locales.
    field("hour") % 24,
    field("minute"),
    field("second"),
  );
  return asIfUtc - instant.getTime();
}

/**
 * The next time the clock reads that hour and minute.
 *
 * In `timeZone` when one is set, and on the host's own clock otherwise — which
 * is what every instance did before the setting existed, and is right for a
 * machine set to the writer's own time. It is wrong for a server sitting in
 * UTC, which is the ordinary case and the reason the setting was added: 1am
 * meant 1am UTC, and the backup ran four or five hours out with nothing
 * anywhere to say why.
 *
 * Today's slot if it has not passed, tomorrow's if it has.
 */
export function nextRun(after: Date, hour: number, minute: number, timeZone?: string | null): Date {
  if (!timeZone) {
    const next = new Date(after);
    next.setHours(hour, minute, 0, 0);
    if (next <= after) next.setDate(next.getDate() + 1);
    return next;
  }

  /** The wanted wall-clock time, `days` from now, as a real instant. */
  const slot = (days: number): Date => {
    const offset = offsetAt(after, timeZone);
    // Today's date *there*, which is not always today's date here.
    const there = new Date(after.getTime() + offset);
    const wanted = Date.UTC(
      there.getUTCFullYear(),
      there.getUTCMonth(),
      there.getUTCDate() + days,
      hour,
      minute,
      0,
      0,
    );

    // Subtracting the offset gives the instant, but the offset may itself
    // differ at that instant — a slot on the far side of a DST change. Asking
    // again with the answer settles it, and settles it for good: a second
    // correction can only matter if a zone shifts twice within a day.
    const first = new Date(wanted - offset);
    return new Date(wanted - offsetAt(first, timeZone));
  };

  const today = slot(0);
  return today > after ? today : slot(1);
}

let timer: NodeJS.Timeout | null = null;

/** Result of a run, for logging. Never throws — a failed backup must not stop
 *  the next one from being attempted. */
export async function runScheduledBackup(): Promise<string | null> {
  const config = runtimeConfig();
  if (!config.databaseUrl) return null;

  const schedule = await readSchedule();
  if (!schedule.enabled) return null;

  const file = await takeBackup(config.databaseUrl, "auto");
  await pruneBackups(schedule.keep);
  return file.name;
}

/**
 * Arms the timer for the next slot, and re-arms after each firing.
 *
 * setTimeout is capped at about twenty-four days, which no schedule here comes
 * near, but the wait is also re-derived from the clock each time rather than
 * accumulated — so a server that sleeps, or a clock that moves for daylight
 * saving, lands on the right hour rather than drifting a little further each
 * night.
 */
export function startBackupSchedule(log: (message: string) => void): void {
  stopBackupSchedule();

  const arm = () => {
    void (async () => {
      let schedule = DEFAULT_SCHEDULE;
      try {
        schedule = await readSchedule();
      } catch {
        // No database yet, or it is mid-restore. Look again in an hour.
        timer = setTimeout(arm, 60 * 60 * 1000);
        return;
      }

      const at = nextRun(new Date(), schedule.hour, schedule.minute, schedule.timezone);
      timer = setTimeout(() => {
        void (async () => {
          try {
            const name = await runScheduledBackup();
            if (name) log(`scheduled backup written: ${name}`);
          } catch (err) {
            log(`scheduled backup failed: ${(err as Error).message}`);
          } finally {
            arm();
          }
        })();
      }, Math.max(1000, at.getTime() - Date.now()));
    })();
  };

  arm();
}

export function stopBackupSchedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
