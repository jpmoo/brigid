/** Thin fetch wrapper. Same-origin in production, Vite-proxied in dev. */

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
}

export interface WorkLevel {
  id: string;
  workId: string;
  depth: number;
  name: string;
  breakTemplateId: string | null;
  counterRestart: "continuous" | "under-parent";
}

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
};
