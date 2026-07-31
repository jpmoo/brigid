import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { authRoutes } from "./auth/routes.js";
import { env, runtimeConfig } from "./config.js";
import { isDbReady } from "./db.js";
import { HttpError } from "./lib/errors.js";
import { setupRoutes } from "./setup/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });

  await app.register(cookie, { secret: runtimeConfig().sessionSecret });

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
    },
    { prefix: "/api" },
  );

  return app;
}
