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
}

export const DEFAULT_SCHEDULE: BackupSchedule = {
  enabled: true,
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
      minute: settings.backupMinute,
      keep: settings.backupKeep,
    })
    .from(settings)
    .limit(1);
  return row ?? DEFAULT_SCHEDULE;
}

/**
 * The next time the clock reads that hour and minute, in the server's own time
 * zone — which is the clock whoever set "1am" was thinking in. Today's slot if
 * it hasn't passed, tomorrow's if it has.
 */
export function nextRun(after: Date, hour: number, minute: number): Date {
  const next = new Date(after);
  next.setHours(hour, minute, 0, 0);
  if (next <= after) next.setDate(next.getDate() + 1);
  return next;
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

      const at = nextRun(new Date(), schedule.hour, schedule.minute);
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
