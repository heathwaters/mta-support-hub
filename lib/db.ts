/**
 * MySQL connection pools for MTA and MTT databases.
 *
 * All env vars are read from lib/env.ts (Zod-validated).
 * Pools are module-level singletons reused across requests in the same Node process.
 */

import mysql from "mysql2/promise";
import { env } from "@/lib/env";

function pool(prefix: "MTA" | "MTT") {
  const host = prefix === "MTA" ? env.MTA_MYSQL_HOST : env.MTT_MYSQL_HOST;
  const port = prefix === "MTA" ? env.MTA_MYSQL_PORT : env.MTT_MYSQL_PORT;
  const user = prefix === "MTA" ? env.MTA_MYSQL_USER : env.MTT_MYSQL_USER;
  const password = prefix === "MTA" ? env.MTA_MYSQL_PASSWORD : env.MTT_MYSQL_PASSWORD;
  const database = prefix === "MTA" ? env.MTA_MYSQL_DATABASE : env.MTT_MYSQL_DATABASE;
  const sslFlag = prefix === "MTA" ? env.MTA_MYSQL_SSL : env.MTT_MYSQL_SSL;

  // Production SSL guard: never allow unencrypted DB connections in production
  if (sslFlag === "false" && process.env.NODE_ENV === "production") {
    console.error(JSON.stringify({ type: "critical", msg: `${prefix} MySQL SSL disabled in production — refusing to connect` }));
    throw new Error(`${prefix}_MYSQL_SSL must be "true" in production`);
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

// Module-level singletons — reused across requests in the same Node process
declare global {
  var __mtaPool: mysql.Pool | undefined;
  var __mttPool: mysql.Pool | undefined;
}

export const mtaPool = globalThis.__mtaPool ?? (globalThis.__mtaPool = pool("MTA"));
export const mttPool = globalThis.__mttPool ?? (globalThis.__mttPool = pool("MTT"));

export async function query<T = unknown>(
  db: "mta" | "mtt",
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  const p = db === "mta" ? mtaPool : mttPool;
  const [rows] = await p.execute(sql, params);
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
