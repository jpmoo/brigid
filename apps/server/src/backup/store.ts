import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..");

/**
 * Where backups live.
 *
 * Beside the config rather than inside the checkout's source, so a deploy that
 * replaces the code doesn't replace the backups. Overridable, because the whole
 * point of a backup is that some people will want it on a different disk from
 * the thing it is backing up.
 */
export const backupDir =
  process.env.BRIGID_BACKUP_DIR ?? join(repoRoot, "data", "backups");

/**
 * A backup is one file, named for the moment it was taken.
 *
 * pg_dump's custom format: compressed, and the only format pg_restore can
 * restore selectively from. The timestamp is in the name rather than only in
 * the file's mtime so that copying a backup somewhere else doesn't lose it.
 */
const NAME = /^brigid-(\d{8}T\d{6}Z)(?:-[a-z0-9-]+)?\.dump$/;

export interface BackupFile {
  /** The filename, which is also its id — they are files, not rows. */
  name: string;
  takenAt: string;
  bytes: number;
}

/** UTC, compact, and sorts lexically in the same order as chronologically. */
export function stampFor(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function takenAtFrom(stamp: string): string {
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 11)}:${stamp.slice(
    11,
    13,
  )}:${stamp.slice(13, 15)}Z`;
  return new Date(iso).toISOString();
}

/**
 * A filename is an id, so it has to be checked like one — anything that isn't a
 * name this module produced is refused rather than joined onto a path.
 */
export function isBackupName(name: string): boolean {
  return NAME.test(name);
}

export function backupPath(name: string): string {
  if (!isBackupName(name)) throw new Error("not a backup filename");
  return join(backupDir, name);
}

export async function listBackups(): Promise<BackupFile[]> {
  await mkdir(backupDir, { recursive: true });
  const entries = await readdir(backupDir);

  const files: BackupFile[] = [];
  for (const name of entries) {
    const match = NAME.exec(name);
    if (!match?.[1]) continue;
    const info = await stat(join(backupDir, name));
    if (!info.isFile()) continue;
    files.push({ name, takenAt: takenAtFrom(match[1]), bytes: info.size });
  }
  // Newest first: that is the one anyone is looking for.
  return files.sort((a, b) => b.name.localeCompare(a.name));
}

/**
 * Deletes the oldest until only `keep` remain.
 *
 * Counted over what is actually on disk, so a backup imported by hand ages out
 * with the rest rather than being exempt from a rule it doesn't know about.
 */
export async function pruneBackups(keep: number): Promise<string[]> {
  const files = await listBackups();
  const doomed = files.slice(Math.max(1, keep));
  for (const file of doomed) await rm(join(backupDir, file.name), { force: true });
  return doomed.map((f) => f.name);
}

/** Whether pg_dump and pg_restore are actually on this machine. */
export async function toolsAvailable(): Promise<boolean> {
  for (const tool of ["pg_dump", "pg_restore"]) {
    const ok = await run(tool, ["--version"])
      .then(() => true)
      .catch(() => false);
    if (!ok) return false;
  }
  return true;
}


/**
 * Strips the password out of any connection URI in the arguments and hands it
 * over in the environment instead, where it isn't visible to `ps`.
 *
 * The arguments are rewritten in place, so callers keep passing a URI and this
 * stays the only place that has to know.
 */
function withoutPassword(args: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  args.forEach((arg, i) => {
    const at = arg.indexOf("postgres");
    if (at === -1) return;
    const prefix = arg.slice(0, at);
    let url: URL;
    try {
      url = new URL(arg.slice(at));
    } catch {
      return;
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return;
    if (!url.password) return;

    env.PGPASSWORD = decodeURIComponent(url.password);
    url.password = "";
    args[i] = prefix + url.toString();
  });

  return env;
}

/**
 * Runs one of the Postgres tools.
 *
 * The connection string is passed as an argument rather than through the
 * environment, which is what both tools document, and stderr is kept so a
 * failure can say what actually went wrong instead of only that it did.
 */
export function run(
  command: string,
  args: string[],
  options: {
    stdin?: string;
    tolerate?: (stderr: string) => boolean;
    /** Rewritten in place to strip any password; the tool reads it from here. */
    args?: string[];
  } = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      /**
       * The connection string is on the command line, and on Linux a command
       * line is world-readable through /proc — so any other local account could
       * read the database password by watching for the nightly backup. The
       * password is lifted out of the URI and passed in the environment, which
       * is what PostgreSQL documents PGPASSWORD for.
       */
      env: withoutPassword(options.args ?? args),
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on("error", (cause) => {
      reject(
        new Error(
          `could not run ${command} — is postgresql-client installed on this server? (${cause.message})`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) return resolvePromise(out);
      // Some failures are not failures. pg_restore reports what it skipped and
      // then exits non-zero, so the caller decides whether what it skipped
      // mattered rather than every skipped line being fatal.
      if (options.tolerate?.(err)) return resolvePromise(out);
      reject(new Error(err.trim() || `${command} exited with code ${code}`));
    });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

/**
 * Errors a restore is right to shrug at.
 *
 * The database's extensions belong to whoever installed them, which for a
 * self-hosted Postgres is a superuser and not the app's own role. `--clean`
 * dutifully tries to drop and re-comment them, is refused twice, ignores it,
 * and then exits non-zero — so a restore that had in fact just succeeded was
 * reported as having failed. The rows are all that is being restored here; an
 * extension the app cannot drop is an extension that is still there, which is
 * what was wanted anyway.
 *
 * Only these. Anything else in the output and the restore failed for real.
 */
export function onlyExtensionComplaints(stderr: string): boolean {
  const problems = stderr
    .split("\n")
    .filter((line) => /^pg_restore: (error|warning):/.test(line))
    .filter((line) => !/^pg_restore: warning: errors ignored on restore/.test(line));

  return (
    problems.length > 0 &&
    problems.every((line) => /must be owner of extension|extension .* does not exist/i.test(line))
  );
}

/** What was skipped, so it can be said out loud rather than swallowed. */
export function skippedLines(stderr: string): string[] {
  return stderr
    .split("\n")
    .filter((line) => /must be owner of extension/i.test(line))
    .map((line) => line.replace(/^pg_restore: error:\s*/, "").trim());
}

/** Takes a backup and returns its filename. `label` distinguishes why. */
export async function takeBackup(databaseUrl: string, label?: string): Promise<BackupFile> {
  await mkdir(backupDir, { recursive: true });
  const name = `brigid-${stampFor(new Date())}${label ? `-${label}` : ""}.dump`;
  const path = join(backupDir, name);

  await run("pg_dump", [
    "--format=custom",
    // Neither ownership nor grants survive a move to another server usefully,
    // and both make a restore fail on a role that doesn't exist there.
    "--no-owner",
    "--no-acl",
    `--file=${path}`,
    databaseUrl,
  ]);

  const info = await stat(path);
  return { name, takenAt: new Date().toISOString(), bytes: info.size };
}
