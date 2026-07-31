import { runMigrations } from "@brigid/db";
import { buildApp } from "./app.js";
import { env, initConfig } from "./config.js";
import { initDb } from "./db.js";

async function main() {
  // Resolve config (env + persisted file) and mint the session secret if this is
  // the first boot. May legitimately come back with no database: that starts the
  // server in setup mode rather than failing.
  const cfg = await initConfig();

  if (cfg.databaseUrl) {
    // An operator who set DATABASE_URL by hand never visits the wizard, so this
    // is the only place their schema gets brought up to date.
    await runMigrations(cfg.databaseUrl);
    initDb(cfg.databaseUrl);
  }

  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: env.port, host: env.host });

  if (!cfg.databaseUrl) {
    app.log.info("no database configured — open the app to run first-time setup");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
