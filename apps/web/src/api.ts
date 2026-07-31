/** Thin fetch wrapper. Same-origin in production, Vite-proxied in dev. */

import type {
  BlockFormatSettings,
  BreakTemplateSettings,
  ImportedParagraph,
  BlockOptions,
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
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

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
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  wordCount: number;
  blockCount: number;
}

export interface WorkLevel {
  id: string;
  workId: string;
  depth: number;
  name: string;
  breakTemplateId: string | null;
  counterRestart: "continuous" | "under-parent";
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
    levels: { name: string; breakTemplateId: string | null; counterRestart: "continuous" | "under-parent" }[],
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
