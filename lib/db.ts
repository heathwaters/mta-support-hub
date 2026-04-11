/**
 * MySQL connection pools for MTA and MTT databases.
 *
 * All env vars are read from lib/env.ts (Zod-validated).
 * Pools are stored as globalThis singletons and initialized lazily on the
 * first `query()` call so that `next build`'s page-data collection does not
 * evaluate the pool factory before env vars are available.
 */

import mysql from "mysql2/promise";
import { env } from "@/lib/env";

/**
 * Validate that SSL is enforced for the given prefix in production.
 * Extracted so it can be unit-tested without standing up a real pool.
 * Throws with a clear error if SSL is disabled in a production environment.
 */
export function assertProductionSsl(
  prefix: "MTA" | "MTT",
  sslFlag: "true" | "false",
  nodeEnv: string | undefined
): void {
  if (sslFlag === "false" && nodeEnv === "production") {
    throw new Error(`${prefix}_MYSQL_SSL must be "true" in production`);
  }
}

function pool(prefix: "MTA" | "MTT") {
  const host = prefix === "MTA" ? env.MTA_MYSQL_HOST : env.MTT_MYSQL_HOST;
  const port = prefix === "MTA" ? env.MTA_MYSQL_PORT : env.MTT_MYSQL_PORT;
  const user = prefix === "MTA" ? env.MTA_MYSQL_USER : env.MTT_MYSQL_USER;
  const password = prefix === "MTA" ? env.MTA_MYSQL_PASSWORD : env.MTT_MYSQL_PASSWORD;
  const database = prefix === "MTA" ? env.MTA_MYSQL_DATABASE : env.MTT_MYSQL_DATABASE;
  const sslFlag = prefix === "MTA" ? env.MTA_MYSQL_SSL : env.MTT_MYSQL_SSL;

  // Production SSL guard: never allow unencrypted DB connections in production
  try {
    assertProductionSsl(prefix, sslFlag, process.env.NODE_ENV);
  } catch (e) {
    console.error(JSON.stringify({ type: "critical", msg: `${prefix} MySQL SSL disabled in production — refusing to connect` }));
    throw e;
  }

  return mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    // Default to SSL ON with CA verification. Set to "false" only in development.
    ssl: sslFlag === "false" ? undefined : { rejectUnauthorized: true },
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 20,
    connectTimeout: 5000,
    // Without dateStrings, mysql2 converts DATE/DATETIME columns to JS Date objects
    // using the server's timezone, causing off-by-one-day errors. dateStrings returns raw SQL strings.
    dateStrings: true,
  });
}

// Lazy module-level singletons — reused across requests in the same Node process.
// Initialization is deferred until first query so that `next build`'s page-data
// collection phase does not fail when env vars are missing or SSL is off locally.
declare global {
  var __mtaPool: mysql.Pool | undefined;
  var __mttPool: mysql.Pool | undefined;
}

export function getPool(db: "mta" | "mtt"): mysql.Pool {
  if (db === "mta") {
    return globalThis.__mtaPool ?? (globalThis.__mtaPool = pool("MTA"));
  }
  return globalThis.__mttPool ?? (globalThis.__mttPool = pool("MTT"));
}

/**
 * Default per-query execution ceiling. `connectTimeout` on the pool only
 * bounds connection establishment; without an execution ceiling a slow
 * query can hang a serverless function up to the platform max duration.
 * 10s gives headroom for complex joins while still failing fast.
 */
export const DEFAULT_QUERY_TIMEOUT_MS = 10_000;

export async function query<T = unknown>(
  db: "mta" | "mtt",
  sql: string,
  params: (string | number | null)[] = [],
  timeoutMs: number = DEFAULT_QUERY_TIMEOUT_MS
): Promise<T[]> {
  const p = getPool(db);
  const [rows] = await p.execute({ sql, timeout: timeoutMs }, params);
  return rows as T[];
}

export function cleanQ(raw: string | null): string | null {
  if (!raw) return null;
  const q = raw.trim().replace(/[\x00-\x1F\x7F]/g, "").slice(0, 100);
  return q.length >= 2 ? q : null;
}

/**
 * Escape LIKE wildcard characters (% and _) in user input
 * before wrapping with %..% for LIKE queries.
 */
export function escapeLike(q: string): string {
  return q.replace(/[%_\\]/g, "\\$&");
}
