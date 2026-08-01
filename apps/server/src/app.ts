import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { authRoutes } from "./auth/routes.js";
import { blocksRoutes } from "./blocks/routes.js";
import { bookmarksRoutes } from "./bookmarks/routes.js";
import { env, runtimeConfig } from "./config.js";
import { isDbReady } from "./db.js";
import { importRoutes } from "./import/routes.js";
import { ollamaRoutes } from "./ollama/routes.js";
import { analysisRoutes } from "./ollama/analysis-routes.js";
import { HttpError } from "./lib/errors.js";
import { backupRoutes } from "./backup/routes.js";
import { compileRoutes } from "./compile/routes.js";
import { preferencesRoutes } from "./preferences/routes.js";
import { setupRoutes } from "./setup/routes.js";
import { spellingRoutes } from "./spelling/routes.js";
import { templatesRoutes } from "./templates/routes.js";
import { worksRoutes } from "./works/routes.js";

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, "..", "..", "web", "dist");

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });

  await app.register(cookie, { secret: runtimeConfig().sessionSecret });
  // A novel-length .docx is a few megabytes; the ceiling is generous but finite.
  await app.register(multipart, { limits: { fileSize: 32 * 1024 * 1024, files: 1 } });

  if (env.appOrigin) {
    await app.register(cors, { origin: env.appOrigin, credentials: true });
  }

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.message });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: "invalid request",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    req.log.error(err);
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    return reply.status(status).send({ error: status === 500 ? "internal error" : err.message });
  });

  app.get("/api/health", async () => ({ ok: true, database: isDbReady() }));

  await app.register(setupRoutes, { prefix: "/api" });

  /**
   * Everything past setup needs a database. Registering these behind a guard
   * rather than skipping registration means the routes exist even when Brigid
   * starts unconfigured, so the client gets a clear 503 instead of a 404 that
   * looks like a bad build.
   */
  await app.register(
    async (scope) => {
      scope.addHook("onRequest", async () => {
        if (!isDbReady()) throw new HttpError(503, "Brigid is not set up yet");
      });
      await scope.register(authRoutes);
      await scope.register(worksRoutes);
      await scope.register(blocksRoutes);
      await scope.register(bookmarksRoutes);
      await scope.register(templatesRoutes);
      await scope.register(importRoutes);
      await scope.register(spellingRoutes);
      await scope.register(preferencesRoutes);
      await scope.register(backupRoutes);
      await scope.register(compileRoutes);
      await scope.register(ollamaRoutes);
      await scope.register(analysisRoutes);
    },
    { prefix: "/api" },
  );

  await registerWebApp(app);

  return app;
}

/**
 * Serve the built web app, when there is one. In development the app is served
 * by Vite on its own port and proxied to this one, so a missing dist directory
 * is normal rather than an error — the API still needs to come up.
 */
async function registerWebApp(app: FastifyInstance): Promise<void> {
  if (!existsSync(join(webDist, "index.html"))) {
    app.log.info("no web build found — API only (run `pnpm build:web`)");
    app.setNotFoundHandler((req, reply) =>
      reply.status(404).send({ error: `no route for ${req.method} ${req.url}` }),
    );
    return;
  }

  await app.register(fastifyStatic, { root: webDist, index: ["index.html"] });

  // Serve the shell at the root explicitly rather than leaning on the static
  // plugin's directory handling: with `index` disabled it answers GET / with a
  // 403, and an explicit route takes precedence over the plugin's wildcard
  // either way, so the root can't depend on that option's default.
  app.get("/", (_req, reply) => reply.sendFile("index.html"));

  // Client-side routing: any GET that isn't an API call or a real file is a
  // route the browser should resolve, so hand back the shell. Anything under
  // /api that reaches here is a genuine 404 and must stay one — returning HTML
  // would turn a typo'd endpoint into an unparseable client error.
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== "GET" || req.url.startsWith("/api/")) {
      return reply.status(404).send({ error: `no route for ${req.method} ${req.url}` });
    }
    return reply.sendFile("index.html");
  });
}
