/** Thin fetch wrapper. Same-origin in production, Vite-proxied in dev. */

import type {
  AnalysisDrift,
  BlockFormatSettings,
  CharacterRunProgress,
  StructureRunProgress,
  BreakTemplateSettings,
  CharacterAnalysis,
  DigestProgress,
  ImportedParagraph,
  BlockOptions,
  PlacedDigest,
  IdentityProposal,
  RosterEntry,
  StructureAnalysis,
  TemplateBody,
  Typography,
} from "@brigid/shared";
import { apiUrl } from "./base.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      credentials: "same-origin",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(0, "could not reach the server");
  }

  const text = await res.text();

  /**
   * Not every answer comes from Brigid. A proxy that gives up on a slow request
   * — Cloudflare cuts one off at 100 seconds — answers with an HTML error page,
   * and parsing that as JSON throws a SyntaxError that is not an ApiError, so
   * every caller falls through to its generic "something went wrong" branch.
   * The status is the useful part; keep it, and say where it came from.
   */
  let body: Record<string, unknown>;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new ApiError(
      res.status,
      res.status === 504 || res.status === 524 || res.status === 502
        ? `the server took too long to answer (${res.status}) — the request may still be running`
        : `the server answered ${res.status} with something that wasn't JSON`,
    );
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof body.error === "string" ? body.error : `request failed (${res.status})`,
      body.issues as { path: string; message: string }[] | undefined,
    );
  }
  return body as T;
}

const post = <T>(path: string, payload?: unknown) =>
  request<T>(path, { method: "POST", body: payload === undefined ? undefined : JSON.stringify(payload) });

// --- Types --------------------------------------------------------------

export interface Work {
  id: string;
  title: string;
  subtitle: string | null;
  authorFirstName: string | null;
  authorLastName: string | null;
  /** A length to aim at for the whole manuscript. Null means none. */
  totalWordGoal: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  wordCount: number;
  blockCount: number;
  /** The later of the work's own row and the last block written in it. */
  lastEditedAt: string;
}

export interface WorkLevel {
  id: string;
  workId: string;
  depth: number;
  name: string;
  breakTemplateId: string | null;
  counterRestart: "continuous" | "under-parent";
  /** A length to aim at for each section at this depth. Null means none. */
  wordGoal: number | null;
}

export interface BackupSchedule {
  enabled: boolean;
  /** On the server's own clock, which is what "1am" was meant in. */
  hour: number;
  minute: number;
  keep: number;
}

export interface BackupFile {
  /** The filename, which is also its id — backups are files, not rows. */
  name: string;
  takenAt: string;
  bytes: number;
}

/** One manuscript, or the whole database. There is no third answer. */
export interface RestoreRequest {
  everything?: boolean;
  workId?: string;
}

/** How the writer likes to be shown their work. Small, and they accumulate. */
export interface Preferences {
  /** A multiplier, not an index — the ladder of sizes can change. */
  textScale?: number;
  viewMode?: "book" | "manuscript";
}

/** Everything the AI panel needs to draw itself. */
export interface AnalysisBundle {
  progress: DigestProgress;
  /** A queued run of character profiles, if there has ever been one. */
  characterRun: CharacterRunProgress | null;
  /** Whether the story-shape analysis is under way. */
  structureRun: StructureRunProgress | null;
  /** Gathered actions waiting to be settled before anything is profiled. */
  pendingActions: number;
  roster: RosterEntry[];
  axisLabels: Record<string, string>;
  modelLabels: Record<string, string>;
  /** What each framework and axis claims, so a rating reads against its rubric. */
  axisBlurbs: Record<string, string>;
  modelBlurbs: Record<string, string>;
  reports: {
    kind: "structure" | "character" | "framework";
    subject: string | null;
    model: string;
    result: unknown;
    createdAt: string;
    /** False once the manuscript has moved on since this was judged. */
    current: boolean;
    /** And by how much, so a typo doesn't read like a rewrite. */
    drift: AnalysisDrift;
  }[];
}

/** One gathered action, as the reconcile screen shows it. */
export interface CastRow {
  id: string;
  blockId: string;
  characterName: string;
  action: string;
  /** What the reading said, when the writer has changed it. Null when unedited. */
  originName: string | null;
  originAction: string | null;
  state: "pending" | "committed" | "dropped";
}

export interface OllamaSettings {
  /** The model's full context window, as detected. */
  numCtx?: number | null;
  /** Origin only — no path, no trailing slash. Null until a host is set. */
  url: string | null;
  analysisModel: string | null;
}

export interface DictionaryWord {
  id: string;
  word: string;
  wordFolded: string;
  createdAt: string;
}

export interface Block {
  id: string;
  workId: string;
  parentId: string | null;
  sortKey: string;
  label: string | null;
  formatId: string;
  content: Record<string, unknown> | null;
  contentText: string;
  wordCount: number;
  breakTemplateId: string | null;
  breakBody: TemplateBody | null;
  formatBody: TemplateBody | null;
  formatTypography: Typography | null;
  options: BlockOptions | null;
}

export interface Template {
  id: string;
  category: "break" | "block-format";
  name: string;
  builtinKey: string | null;
  body: TemplateBody;
  breakSettings: BreakTemplateSettings | null;
  formatSettings: BlockFormatSettings | null;
}

export interface Bookmark {
  id: string;
  workId: string;
  blockId: string;
  name: string;
  sortKey: string;
  createdAt: string;
  updatedAt: string;
}

export type Placement = "root" | "sibling" | "sibling-before" | "child" | "parent";

export interface ProvisionInput {
  admin: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl?: boolean;
  };
  app: { dbName: string; user: string; password: string };
}

export type SetupDatabase =
  | { mode: "existing"; url: string }
  | ({ mode: "provision" } & ProvisionInput);

// --- Endpoints ----------------------------------------------------------

export const api = {
  health: () => request<{ ok: boolean; database: boolean }>("/health"),

  setupStatus: () => request<{ needsSetup: boolean }>("/setup/status"),
  testConnection: (url: string) => post<{ ok: true }>("/setup/test-connection", { url }),
  completeSetup: (database: SetupDatabase, account: { username: string; password: string }) =>
    post<{ ok: true; username: string }>("/setup/complete", { database, account }),

  me: () => request<{ username: string | null }>("/auth/me"),
  login: (username: string, password: string) =>
    post<{ username: string }>("/auth/login", { username, password }),
  logout: () => post<{ ok: true }>("/auth/logout"),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: true }>("/auth/password", { currentPassword, newPassword }),

  listWorks: (archived = false) =>
    request<{ works: Work[] }>(`/works${archived ? "?archived=true" : ""}`),
  createWork: (input: {
    title: string;
    subtitle?: string | null;
    authorFirstName?: string | null;
    authorLastName?: string | null;
  }) => post<{ work: Work }>("/works", input),
  getWork: (id: string) => request<{ work: Work; levels: WorkLevel[] }>(`/works/${id}`),
  updateWork: (id: string, patch: { totalWordGoal?: number | null }) =>
    request<{ work: Work }>(`/works/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  archiveWork: (id: string, archived: boolean) =>
    post<{ work: Work }>(`/works/${id}/archive`, { archived }),
  deleteWork: (id: string) =>
    request<{ ok: true; title: string }>(`/works/${id}`, { method: "DELETE" }),

  listTemplates: () => request<{ templates: Template[] }>("/templates"),
  createTemplate: (input: {
    category: "break" | "block-format";
    name: string;
    body: TemplateBody;
    breakSettings?: BreakTemplateSettings;
    formatSettings?: BlockFormatSettings;
  }) => post<{ template: Template }>("/templates", input),
  updateTemplate: (
    id: string,
    patch: {
      name?: string;
      body?: TemplateBody;
      breakSettings?: BreakTemplateSettings;
      formatSettings?: BlockFormatSettings;
    },
  ) => request<{ template: Template }>(`/templates/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTemplate: (id: string) => request<{ ok: true }>(`/templates/${id}`, { method: "DELETE" }),

  /**
   * XHR rather than fetch, because fetch cannot report upload progress and a
   * novel-sized .docx is worth showing progress for. `onProgress` reports the
   * upload only — once the bytes are up, the server is parsing, and that part
   * has no measurable fraction.
   */
  analyzeDocx: (file: File, onProgress?: (fraction: number) => void) =>
    new Promise<{ filename: string; paragraphs: ImportedParagraph[]; hasPageBreaks: boolean }>(
      (resolve, reject) => {
        const form = new FormData();
        form.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", apiUrl("/import/analyze"));
        xhr.withCredentials = true;

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable && event.total > 0) {
            onProgress?.(event.loaded / event.total);
          }
        });

        xhr.addEventListener("load", () => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = xhr.responseText ? (JSON.parse(xhr.responseText) as Record<string, unknown>) : {};
          } catch {
            reject(new ApiError(xhr.status, "the server sent something unreadable"));
            return;
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(
              new ApiError(
                xhr.status,
                typeof parsed.error === "string" ? parsed.error : "could not read that file",
              ),
            );
            return;
          }
          onProgress?.(1);
          resolve(
            parsed as unknown as {
              filename: string;
              paragraphs: ImportedParagraph[];
              hasPageBreaks: boolean;
            },
          );
        });

        xhr.addEventListener("error", () => reject(new ApiError(0, "could not reach the server")));
        xhr.addEventListener("abort", () => reject(new ApiError(0, "upload cancelled")));
        xhr.send(form);
      },
    ),
  createFromImport: (input: {
    title: string;
    subtitle?: string | null;
    authorFirstName?: string | null;
    authorLastName?: string | null;
    paragraphs: ImportedParagraph[];
    markers: {
      depth: number;
      name: string;
      prefix: string;
      breakTemplateId: string | null;
      counterRestart: "continuous" | "under-parent";
    }[];
    firstPageIsTitlePage: boolean;
    titlePageParagraphs?: number;
  }) =>
    post<{ work: Work; matches: { depth: number; prefix: string; count: number }[]; blockCount: number }>(
      "/import/create",
      input,
    ),

  listBookmarks: (workId: string) =>
    request<{ bookmarks: Bookmark[] }>(`/works/${workId}/bookmarks`),
  createBookmark: (workId: string, blockId: string, name?: string) =>
    post<{ bookmark: Bookmark }>(`/works/${workId}/bookmarks`, { blockId, ...(name ? { name } : {}) }),
  renameBookmark: (id: string, name: string) =>
    request<{ bookmark: Bookmark }>(`/bookmarks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteBookmark: (id: string) => request<{ ok: true }>(`/bookmarks/${id}`, { method: "DELETE" }),

  listLevels: (workId: string) => request<{ levels: WorkLevel[] }>(`/works/${workId}/levels`),
  saveLevels: (
    workId: string,
    levels: {
      name: string;
      breakTemplateId: string | null;
      counterRestart: "continuous" | "under-parent";
      wordGoal?: number | null;
    }[],
  ) =>
    request<{ levels: WorkLevel[] }>(`/works/${workId}/levels`, {
      method: "PUT",
      body: JSON.stringify({ levels }),
    }),

  listBlocks: (workId: string) => request<{ blocks: Block[] }>(`/works/${workId}/blocks`),
  createBlock: (
    workId: string,
    input: { formatId: string; placement: Placement; relativeTo?: string | null; label?: string | null },
  ) => post<{ block: Block }>(`/works/${workId}/blocks`, input),
  updateBlock: (
    id: string,
    patch: {
      label?: string | null;
      formatId?: string;
      content?: Record<string, unknown> | null;
      options?: BlockOptions | null;
    },
  ) => request<{ block: Block }>(`/blocks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  moveBlock: (id: string, parentId: string | null, afterId: string | null) =>
    post<{ block: Block }>(`/blocks/${id}/move`, { parentId, afterId }),
  deleteBlock: (id: string) => request<{ ok: true }>(`/blocks/${id}`, { method: "DELETE" }),

  getBackups: () =>
    request<{
      schedule: BackupSchedule;
      backups: BackupFile[];
      directory: string;
      tools: boolean;
      /** Set when a part of the page couldn't be read, rather than failing it all. */
      problem?: string;
    }>("/backups"),
  setBackupSchedule: (patch: Partial<BackupSchedule>) =>
    request<{ schedule: BackupSchedule }>("/backups/schedule", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  backupNow: () => post<{ backup: BackupFile; removed: string[] }>("/backups"),
  deleteBackup: (name: string) =>
    request<{ ok: true }>(`/backups/${encodeURIComponent(name)}`, { method: "DELETE" }),
  worksInBackup: (name: string) =>
    request<{ works: { id: string; title: string }[] }>(
      `/backups/${encodeURIComponent(name)}/works`,
    ),
  restoreBackup: (name: string, what: RestoreRequest) =>
    post<{ restored: string[]; safety: string }>(
      `/backups/${encodeURIComponent(name)}/restore`,
      what,
    ),
  backupDownloadUrl: (name: string) => apiUrl(`/backups/${encodeURIComponent(name)}/download`),
  /** Brings a file in from elsewhere; it becomes a backup like any other. */
  importBackup: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(apiUrl("/backups/import"), {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new ApiError(
        res.status,
        typeof body.error === "string" ? body.error : "could not read that file",
      );
    }
    return body as unknown as { backup: BackupFile };
  },

  /**
   * Returns the file itself rather than JSON, and the name the server chose for
   * it — which encodes the author and the short title, so it is worth keeping
   * rather than inventing a second one here.
   */
  compileWork: async (
    workId: string,
    body: {
      format: "docx" | "pdf";
      include: string[];
      runningHeads: boolean;
      /** Only wanted when there are heads to put it in. */
      shortTitle?: string;
    },
  ) => {
    const res = await fetch(apiUrl(`/works/${workId}/compile`), {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      let message = "could not compile that";
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        /* not JSON; the default says enough */
      }
      throw new ApiError(res.status, message);
    }
    const disposition = res.headers.get("content-disposition") ?? "";
    const named = /filename="([^"]+)"/.exec(disposition);
    return {
      blob: await res.blob(),
      filename: named?.[1] ?? `manuscript.${body.format}`,
    };
  },

  getPreferences: () => request<{ preferences: Preferences }>("/preferences"),
  savePreferences: (patch: Preferences) =>
    request<{ preferences: Preferences }>("/preferences", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  getSpelling: () => request<{ enabled: boolean; words: DictionaryWord[] }>("/spelling"),
  setSpellcheckEnabled: (enabled: boolean) =>
    request<{ enabled: boolean }>("/spelling", {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  addDictionaryWord: (word: string) => post<{ word: DictionaryWord }>("/spelling/words", { word }),
  deleteDictionaryWord: (id: string) =>
    request<{ ok: true }>(`/spelling/words/${id}`, { method: "DELETE" }),
  getDictionary: () => request<{ aff: string; dic: string }>("/spelling/dictionary"),

  getDigest: (workId: string) =>
    request<{ progress: DigestProgress; sections: PlacedDigest[] }>(`/works/${workId}/digest`),
  getDigestProgress: (workId: string) =>
    request<DigestProgress>(`/works/${workId}/digest/progress`),
  getAnalysis: (workId: string) => request<AnalysisBundle>(`/works/${workId}/analysis`),
  /** Queues it and returns at once; watch `structureRun` for progress. */
  runStructureAnalysis: (workId: string) =>
    post<{ progress: StructureRunProgress | null }>(`/works/${workId}/analysis/structure`),
  /** Queues the run and returns at once; watch `characterRun` for progress. */
  runCharacterAnalysis: (workId: string, body: { name?: string; focal?: string }) =>
    post<{ queued: string[]; progress: CharacterRunProgress | null }>(
      `/works/${workId}/analysis/character`,
      body,
    ),
  /** Stop the reading, set it going again, or throw it away and start over. */
  controlDigest: (workId: string, action: "stop" | "resume" | "restart") =>
    post<{ progress: DigestProgress }>(`/works/${workId}/digest/${action}`),
  /** One character back to a blank slate: every line re-queued, profile gone. */
  resetCharacter: (workId: string, name: string) =>
    post<{ ok: true; restored: number; pending: number }>(`/works/${workId}/cast/reset`, { name }),
  /** Everything gathered, for the reconcile screen. */
  getCast: (workId: string) =>
    request<{
      rows: CastRow[];
      excluded: string[];
      sections: { blockId: string; label: string | null; start: number }[];
    }>(`/works/${workId}/cast`),
  /** Settle the queue. Returns whose profiles were dropped as a result. */
  commitCast: (
    workId: string,
    decisions: {
      id: string;
      characterName?: string;
      action?: string;
      drop?: boolean;
      restore?: boolean;
      assign?: boolean;
    }[],
  ) =>
    post<{ ok: true; affected: string[]; pending: number }>(`/works/${workId}/cast/commit`, {
      decisions,
    }),
  /** Who in this cast is the same person. A proposal; nothing is written. */
  proposeIdentities: (workId: string) =>
    post<{ proposal: IdentityProposal; ms: number }>(`/works/${workId}/analysis/identities`),
  /** Fold the approved groups together in the reading itself. */
  applyIdentities: (workId: string, groups: { canonical: string; names: string[] }[]) =>
    post<{ ok: true; reprofiling: string[] }>(`/works/${workId}/analysis/identities/apply`, {
      groups,
    }),
  /** Rule that an entry is not a character. Survives re-reads of its section. */
  notACharacter: (workId: string, name: string) =>
    post<{ ok: true }>(`/works/${workId}/analysis/not-a-character`, { name }),
  /** One character's profile. The reading stays, so a re-run is one call. */
  dismissCharacter: (workId: string, name: string) =>
    request<{ ok: true }>(
      `/works/${workId}/analysis/character/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),
  /**
   * Everything AI-derived, the reading included, or — scoped to characters —
   * only the profiles and the decisions about who did what. The reading is the
   * expensive part, so the narrow one leaves it alone.
   */
  clearAllAnalysis: (workId: string, scope?: "character") =>
    request<{ ok: true }>(
      `/works/${workId}/analysis?everything=true${scope ? `&kind=${scope}` : ""}`,
      { method: "DELETE" },
    ),
  cancelCharacterRun: (workId: string) =>
    request<{ progress: CharacterRunProgress | null }>(
      `/works/${workId}/analysis/characters/run`,
      { method: "DELETE" },
    ),

  getOllama: () => request<OllamaSettings>("/ollama"),
  // The address is passed rather than read, so a host can be tried before it is kept.
  listOllamaModels: (url?: string) =>
    request<{ url: string; models: string[] }>(
      url ? `/ollama/models?url=${encodeURIComponent(url)}` : "/ollama/models",
    ),
  saveOllama: (patch: Partial<OllamaSettings>) =>
    request<OllamaSettings>("/ollama", { method: "PATCH", body: JSON.stringify(patch) }),

  detachBreak: (id: string) => post<{ block: Block }>(`/blocks/${id}/break/detach`),
  updateBreak: (id: string, body: TemplateBody) =>
    request<{ block: Block }>(`/blocks/${id}/break`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    }),
  revertBreak: (id: string) => request<{ block: Block }>(`/blocks/${id}/break`, { method: "DELETE" }),

  detachFormat: (id: string) => post<{ block: Block }>(`/blocks/${id}/format/detach`),
  updateFormat: (id: string, patch: { body?: TemplateBody; typography?: Typography | null }) =>
    request<{ block: Block }>(`/blocks/${id}/format`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  revertFormat: (id: string) =>
    request<{ block: Block }>(`/blocks/${id}/format`, { method: "DELETE" }),
};
