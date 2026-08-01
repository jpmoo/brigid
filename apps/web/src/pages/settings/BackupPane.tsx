import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Trash2, Upload } from "lucide-react";
import { ApiError, api } from "../../api.js";
import type { BackupFile, BackupSchedule, RestoreRequest } from "../../api.js";
import { HoldToConfirm } from "../../components/HoldToConfirm.js";
import { useDialogs } from "../../components/Dialogs.js";
import { useSavedFlash } from "../../useSavedFlash.js";

const KEEP_MIN = 1;
const KEEP_MAX = 200;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function taken(at: string): string {
  return new Date(at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Backups: when they are taken, how many are kept, and putting one back.
 *
 * Whole-database, because that is what a Postgres dump is — the schedule below
 * is the app's, not any one manuscript's. Restoring is where it narrows: a
 * backup holds everything, and most of the time what is wanted out of it is one
 * manuscript rather than the lot.
 */
export function BackupPane({ workId }: { workId: string | null }) {
  const dialogs = useDialogs();
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [directory, setDirectory] = useState("");
  const [tools, setTools] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [chosen, setChosen] = useState<BackupFile | null>(null);
  const [flashing, flash] = useSavedFlash();
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const data = await api.getBackups();
    setSchedule(data.schedule);
    setBackups(data.backups);
    setDirectory(data.directory);
    setTools(data.tools);
    setError(data.problem ?? null);
  }, []);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof ApiError ? err.message : "could not read the backups"),
    );
  }, [load]);

  async function patch(next: Partial<BackupSchedule>) {
    if (!schedule) return;
    const optimistic = { ...schedule, ...next };
    setSchedule(optimistic);
    try {
      const { schedule: saved } = await api.setBackupSchedule(next);
      setSchedule(saved);
      flash();
      // Lowering the count prunes on the server, so the list has changed.
      if (next.keep !== undefined) await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not save that");
      await load();
    }
  }

  async function guarded(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const backupNow = () =>
    guarded("now", async () => {
      const { backup } = await api.backupNow();
      await load();
      setNote(`Backed up — ${backup.name}`);
    });

  const importFile = (file: File) =>
    guarded("import", async () => {
      const { backup } = await api.importBackup(file);
      await load();
      setNote(`Imported — ${backup.name}`);
    });

  async function remove(file: BackupFile) {
    const ok = await dialogs.confirm({
      title: "Delete this backup",
      message: `${taken(file.takenAt)} · ${size(file.bytes)}. The file is removed from the server.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await guarded("delete", async () => {
      await api.deleteBackup(file.name);
      await load();
    });
  }

  if (error && !schedule) return <div className="alert error">{error}</div>;
  if (!schedule) return <p className="tpl-empty">Reading backups…</p>;

  return (
    <div className="tpl-detail">
      {!tools ? (
        <div className="alert error">
          <strong>pg_dump isn&rsquo;t on this server.</strong> Backups need the PostgreSQL
          client tools — on Ubuntu, <code>sudo apt install postgresql-client</code>. Nothing
          below will work until they are installed.
        </div>
      ) : null}

      <h4 className="tpl-section">Every night</h4>
      <div className="stack">
        <label className="check">
          <input
            type="checkbox"
            checked={schedule.enabled}
            onChange={(e) => void patch({ enabled: e.target.checked })}
          />
          <span>
            Back up automatically <em>&mdash; on the server&rsquo;s own clock</em>
          </span>
        </label>
      </div>

      <div className="be-line be-line-setting" style={{ marginTop: 10 }}>
        <label className="bk-field">
          <span>Back up at</span>
          <input
            type="time"
            value={`${pad(schedule.hour)}:${pad(schedule.minute)}`}
            disabled={!schedule.enabled}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":");
              if (h === undefined || m === undefined) return;
              void patch({ hour: Number(h), minute: Number(m) });
            }}
          />
        </label>
        <label className="bk-field">
          <span>keeping</span>
          <input
            type="number"
            min={KEEP_MIN}
            max={KEEP_MAX}
            value={schedule.keep}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (!Number.isInteger(value) || value < KEEP_MIN || value > KEEP_MAX) return;
              void patch({ keep: value });
            }}
          />
          <span>backups in total.</span>
        </label>
        <span className="be-gap" />
        <button className="btn" type="button" disabled={busy !== null} onClick={backupNow}>
          {busy === "now" ? "Backing up…" : "Back up now"}
        </button>
        {flashing ? <span className="saved-flash">Saved</span> : null}
      </div>

      <p className="tpl-note">
        Written to <code>{directory}</code>. Older ones past the number kept are deleted as
        new ones arrive.
      </p>

      {error ? <div className="alert error">{error}</div> : null}
      {note ? <div className="alert ok">{note}</div> : null}

      <h4 className="tpl-section">Restore a backup</h4>
      <div className="be-line">
        <input
          ref={fileInput}
          type="file"
          accept=".dump"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importFile(file);
          }}
        />
        <button
          className="btn secondary"
          type="button"
          disabled={busy !== null}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={15} />
          {busy === "import" ? "Reading…" : "Import a file"}
        </button>
      </div>

      {backups.length === 0 ? (
        <p className="tpl-empty">None yet.</p>
      ) : (
        <ul className="bk-list">
          {backups.map((file) => (
            <li key={file.name} className={chosen?.name === file.name ? "selected" : ""}>
              <button
                type="button"
                className="bk-pick"
                onClick={() => setChosen(chosen?.name === file.name ? null : file)}
              >
                <span className="bk-when">{taken(file.takenAt)}</span>
                <span className="bk-meta">
                  {size(file.bytes)}
                  {file.name.includes("-auto") ? " · nightly" : ""}
                  {file.name.includes("-imported") ? " · imported" : ""}
                  {file.name.includes("-before-restore") ? " · safety copy" : ""}
                </span>
              </button>
              <a
                className="btn ghost"
                href={api.backupDownloadUrl(file.name)}
                title="Download"
                aria-label={`Download ${file.name}`}
              >
                <Download size={14} />
              </a>
              <button
                className="btn ghost"
                type="button"
                title="Delete"
                aria-label={`Delete ${file.name}`}
                onClick={() => void remove(file)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {chosen ? (
        <RestorePanel
          file={chosen}
          currentWorkId={workId}
          onDone={async (message) => {
            setChosen(null);
            setNote(message);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * What to take out of the chosen backup.
 *
 * Restoring is destructive, so it is held to the same confirmation as deleting a
 * manuscript — read what it says, then hold the button. The safety copy taken
 * automatically beforehand is named in the result, because the moment anyone
 * needs it is the moment straight after.
 */
function RestorePanel({
  file,
  currentWorkId,
  onDone,
}: {
  file: BackupFile;
  currentWorkId: string | null;
  onDone: (message: string) => Promise<void>;
}) {
  const [works, setWorks] = useState<{ id: string; title: string }[] | null>(null);
  const [everything, setEverything] = useState(false);
  const [workId, setWorkId] = useState<string>("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWorks(null);
    setEverything(false);
    setUnderstood(false);
    void api
      .worksInBackup(file.name)
      .then(({ works: found }) => {
        setWorks(found);
        // The manuscript this was opened from, when the backup has it.
        setWorkId(found.some((w) => w.id === currentWorkId) ? (currentWorkId ?? "") : "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "could not read it"));
  }, [file.name, currentWorkId]);

  const chosenAnything = everything || workId !== "";

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      const what: RestoreRequest = everything ? { everything: true } : { workId };
      const result = await api.restoreBackup(file.name, what);
      await onDone(
        `Restored ${result.restored.join(", ")}. The state before this was saved as ${result.safety}.`,
      );
      if (everything) window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bk-restore">
      <h4 className="tpl-section">Restore from {taken(file.takenAt)}</h4>

      <div className="stack">
        <label className="check">
          <input type="radio" checked={!everything} onChange={() => setEverything(false)} />
          <span>
            One manuscript <em>&mdash; nothing else in the backup is touched</em>
          </span>
        </label>

        {!everything ? (
          <div className="bk-parts">
            <label className="check">
              <span className="bk-part-label">Manuscript</span>
              <select value={workId} onChange={(e) => setWorkId(e.target.value)}>
                <option value="">Choose one</option>
                {(works ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
            </label>
            {works?.length === 0 ? (
              <p className="tpl-note">This backup holds no manuscripts.</p>
            ) : (
              <p className="tpl-note">
                It comes back with everything that decides how it reads &mdash; its levels, the
                breaks and formats it had edited for itself, and any format it uses that has
                since been deleted. Nothing outside it changes.
              </p>
            )}
          </div>
        ) : null}

        <label className="check">
          <input type="radio" checked={everything} onChange={() => setEverything(true)} />
          <span>
            Everything <em>&mdash; every manuscript, the formats, the dictionary, the settings, and your account</em>
          </span>
        </label>
      </div>

      {error ? <div className="alert error">{error}</div> : null}

      <label className="check bk-understood">
        <input
          type="checkbox"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
        />
        <span>
          I understand this replaces what is there now. A copy of the current state is saved
          first.
        </span>
      </label>

      <div className="be-line">
        <HoldToConfirm
          seconds={3}
          disabled={!understood || busy || !chosenAnything}
          label={busy ? "Restoring…" : "Hold to restore"}
          holdingLabel="Keep holding to restore…"
          onConfirm={() => void restore()}
        />
      </div>
    </div>
  );
}
