import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

// .env first, then .env.local on top — a shared base with per-host overrides.
loadEnv({ path: join(repoRoot, ".env") });
loadEnv({ path: join(repoRoot, ".env.local"), override: true });

export const env = {
  port: Number(process.env.PORT ?? 8090),
  host: process.env.HOST ?? "0.0.0.0",
  appOrigin: process.env.APP_ORIGIN ?? null,
  secureCookies: process.env.SECURE_COOKIES === "1",
};

export const configPath =
  process.env.BRIGID_CONFIG_PATH ?? join(repoRoot, "data", "brigid.config.json");

/**
 * The two values Brigid can't keep in the database, because one of them *is*
 * the database. `databaseUrl` is absent until the first-run wizard establishes
 * it; `sessionSecret` is always present, minted at first boot.
 */
interface StoredConfig {
  databaseUrl?: string;
  sessionSecret: string;
}

export interface RuntimeConfig {
  /** Null means no database yet — the server starts in setup mode. */
  databaseUrl: string | null;
  sessionSecret: string;
}

let current: RuntimeConfig | null = null;

async function readStored(): Promise<Partial<StoredConfig>> {
  try {
    return JSON.parse(await readFile(configPath, "utf8")) as Partial<StoredConfig>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writeStored(cfg: StoredConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  // 0600: the file holds the database password and the cookie signing key.
  await writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Resolve config from env, falling back to the persisted file. The session
 * secret is generated and persisted here rather than during setup, so that
 * @fastify/cookie can bind a stable secret at registration and completing setup
 * never requires a restart.
 */
export async function initConfig(): Promise<RuntimeConfig> {
  const stored = await readStored();

  const envSecret = process.env.SESSION_SECRET?.trim();
  let sessionSecret = envSecret || stored.sessionSecret;
  let needsWrite = false;
  if (!sessionSecret) {
    sessionSecret = randomBytes(48).toString("base64");
    needsWrite = true;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim() || stored.databaseUrl || null;

  // Only persist a secret we minted, and only when it isn't coming from env.
  if (needsWrite && !envSecret) {
    await writeStored({
      sessionSecret,
      ...(stored.databaseUrl ? { databaseUrl: stored.databaseUrl } : {}),
    });
  }

  current = { databaseUrl, sessionSecret };
  return current;
}

export function runtimeConfig(): RuntimeConfig {
  if (!current) throw new Error("config not initialized");
  return current;
}

/** Record the database established by the setup wizard. */
export async function persistDatabaseUrl(databaseUrl: string): Promise<void> {
  const cfg = runtimeConfig();
  const stored = await readStored();
  await writeStored({ sessionSecret: stored.sessionSecret ?? cfg.sessionSecret, databaseUrl });
  current = { ...cfg, databaseUrl };
}
