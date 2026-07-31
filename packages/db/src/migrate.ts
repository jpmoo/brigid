import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { runMigrations } from "./migrator.js";

// CLI entrypoint: `pnpm db:migrate`. Resolves DATABASE_URL the same way the
// server does, so the two can't disagree about which database they mean:
// .env, then .env.local on top, then the config file the setup wizard writes.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

config({ path: join(repoRoot, ".env") });
config({ path: join(repoRoot, ".env.local"), override: true });

function fromConfigFile(): string | undefined {
  const path = process.env.BRIGID_CONFIG_PATH ?? join(repoRoot, "data", "brigid.config.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { databaseUrl?: string };
    return parsed.databaseUrl;
  } catch {
    return undefined;
  }
}

const url = process.env.DATABASE_URL?.trim() || fromConfigFile();
if (!url) {
  console.error(
    "DATABASE_URL is required — set it in .env.local, or complete first-run setup so it is written to data/brigid.config.json",
  );
  process.exit(1);
}

runMigrations(url)
  .then(() => {
    console.log("migrations up to date");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
