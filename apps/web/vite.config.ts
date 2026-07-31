import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The logo and wordmark are repo-level assets, shared with the README and any
// future packaging. Pointing publicDir at them keeps one canonical copy rather
// than a duplicate under the web app that would drift.
const repoRoot = resolve(import.meta.dirname, "..", "..");
const assetsDir = resolve(repoRoot, "assets");

/** Vite requires a leading and trailing slash; accept any reasonable spelling. */
function normalizeBase(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
}

export default defineConfig(({ mode }) => {
  // Read .env and .env.local from the repo root with no prefix filter, so
  // APP_BASE_PATH is picked up from the same file the server reads.
  const env = loadEnv(mode, repoRoot, "");
  const base = normalizeBase(env.APP_BASE_PATH);

  return {
    plugins: [react()],
    publicDir: assetsDir,
    // Serving under e.g. /brigid means every asset URL the build emits has to
    // carry that prefix, or the browser resolves them against the domain root.
    base,
    server: {
      port: 5173,
      // Dev runs the API on 8090 and Vite on 5173; proxying keeps the browser on
      // one origin, so the session cookie behaves exactly as in production.
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8090",
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
