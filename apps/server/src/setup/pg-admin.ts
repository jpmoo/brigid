import postgres from "postgres";
import { HttpError } from "../lib/errors.js";

export interface AdminConn {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Maintenance database, usually "postgres". */
  database: string;
  ssl?: boolean;
}

export interface AppDb {
  host: string;
  port: number;
  dbName: string;
  user: string;
  password: string;
}

/** Postgres bare identifier. Enforced before any name reaches a DDL string. */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export function assertIdentifier(value: string, what: string): void {
  if (!IDENT.test(value)) {
    throw new HttpError(
      400,
      `${what} must start with a letter or underscore and contain only letters, digits, and underscores`,
    );
  }
}

// Names are validated above; quote defensively anyway.
const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

function connect(conn: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
}) {
  return postgres({
    host: conn.host,
    port: conn.port,
    username: conn.user,
    password: conn.password,
    database: conn.database,
    ssl: conn.ssl ? "require" : undefined,
    max: 1,
    connect_timeout: 10,
  });
}

/** Verify a connection string points at a reachable, usable database. */
export async function testConnection(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, connect_timeout: 10 });
  try {
    await sql`SELECT 1`;
  } catch (err) {
    throw new HttpError(
      502,
      `could not connect: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Create the application role and database using a privileged admin connection,
 * then install pgcrypto inside the new database. Returns the app connection
 * string. Idempotent where possible, so a half-finished setup can be retried.
 */
export async function provisionDatabase(admin: AdminConn, app: AppDb): Promise<string> {
  assertIdentifier(app.dbName, "database name");
  assertIdentifier(app.user, "database user");

  const adminSql = connect(admin);
  try {
    const role = await adminSql`SELECT 1 FROM pg_roles WHERE rolname = ${app.user}`;
    if (role.length === 0) {
      await adminSql.unsafe(
        `CREATE ROLE ${quoteIdent(app.user)} WITH LOGIN PASSWORD ${quoteLiteral(app.password)}`,
      );
    } else {
      await adminSql.unsafe(
        `ALTER ROLE ${quoteIdent(app.user)} WITH LOGIN PASSWORD ${quoteLiteral(app.password)}`,
      );
    }

    const dbExists = await adminSql`SELECT 1 FROM pg_database WHERE datname = ${app.dbName}`;
    if (dbExists.length === 0) {
      // CREATE DATABASE cannot run inside a transaction block.
      await adminSql.unsafe(
        `CREATE DATABASE ${quoteIdent(app.dbName)} OWNER ${quoteIdent(app.user)}`,
      );
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(
      502,
      `database provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await adminSql.end({ timeout: 5 });
  }

  // pgcrypto for gen_random_uuid(). Built in from PostgreSQL 13, so this is
  // belt-and-braces for older servers; it is a trusted extension, so the
  // database owner can create it without superuser.
  const newDbAdmin = connect({ ...admin, database: app.dbName });
  try {
    await newDbAdmin.unsafe(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await newDbAdmin.unsafe(
      `GRANT ALL ON DATABASE ${quoteIdent(app.dbName)} TO ${quoteIdent(app.user)}`,
    );
    await newDbAdmin.unsafe(`GRANT ALL ON SCHEMA public TO ${quoteIdent(app.user)}`);
  } catch (err) {
    throw new HttpError(
      502,
      `database setup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await newDbAdmin.end({ timeout: 5 });
  }

  const u = encodeURIComponent(app.user);
  const p = encodeURIComponent(app.password);
  const d = encodeURIComponent(app.dbName);
  const sslSuffix = admin.ssl ? "?sslmode=require" : "";
  return `postgres://${u}:${p}@${app.host}:${app.port}/${d}${sslSuffix}`;
}
