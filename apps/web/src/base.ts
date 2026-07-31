/**
 * Where the app is mounted. Vite bakes this in at build time from
 * APP_BASE_PATH, always with a leading and trailing slash ("/" when the app is
 * at the domain root, "/brigid/" when it isn't).
 *
 * Vite rewrites asset URLs it can see statically — imports, and references in
 * index.html — but not strings built at runtime, so anything that constructs a
 * URL itself has to go through here.
 */
export const BASE: string = import.meta.env.BASE_URL || "/";

/** Router basename: no trailing slash, and empty rather than "/" at the root. */
export const ROUTER_BASENAME: string = BASE === "/" ? "" : BASE.replace(/\/$/, "");

/** Absolute URL for a file served from the web root (the logo, the wordmark). */
export function asset(path: string): string {
  return `${BASE}${path.replace(/^\//, "")}`;
}

/** Absolute URL for an API endpoint, given a path like "/works". */
export function apiUrl(path: string): string {
  return `${BASE}api${path}`;
}
