import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The logo and wordmark are repo-level assets, shared with the README and any
// future packaging. Pointing publicDir at them keeps one canonical copy rather
// than a duplicate under the web app that would drift.
const assetsDir = resolve(import.meta.dirname, "..", "..", "assets");

export default defineConfig({
  plugins: [react()],
  publicDir: assetsDir,
  server: {
    port: 5173,
    // Dev runs the API on 8090 and Vite on 5173; proxying keeps the browser on
    // one origin, so the session cookie behaves exactly as it does in production.
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
});
