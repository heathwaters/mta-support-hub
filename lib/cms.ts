/**
 * CMS API client for MTA and MTT platforms.
 *
 * Auth protocol: POST to base URL with { app_key, action: "login", username, password }
 * Returns JWT token, used as Bearer header on subsequent requests.
 * Tokens are cached for 55 minutes (5 min buffer on typical 60 min CMS JWT TTL).
 *
 * All env vars are read from lib/env.ts (Zod-validated, HTTPS-enforced, hostname allowlisted).
 */

import { env } from "@/lib/env";

type Platform = "mta" | "mtt";

interface CmsConfig {
  baseUrl: string;
  appKey: string;
  username: string;
  password: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

const ALLOWED_HOSTS = ["athleticsolutionstech.com", "matchtennisteam.com"];

// Singleton token cache — survives across requests in the same Node process
declare global {
  var __cmsTokens: Record<string, TokenCache> | undefined;
}
const tokens = (globalThis.__cmsTokens ??= {});

function getConfig(platform: Platform): CmsConfig {
  const baseUrl = platform === "mta" ? env.CMS_MTA_API_BASE_URL : env.CMS_MTT_API_BASE_URL;
  const appKey = platform === "mta" ? env.CMS_MTA_API_APP_KEY : env.CMS_MTT_API_APP_KEY;
  const username = platform === "mta" ? env.CMS_MTA_API_USERNAME : env.CMS_MTT_API_USERNAME;
  const password = platform === "mta" ? env.CMS_MTA_API_PASSWORD : env.CMS_MTT_API_PASSWORD;

  if (!baseUrl || !appKey || !username || !password) {
    throw new Error(`Missing CMS env vars for ${platform.toUpperCase()}`);
  }

  // Runtime defense-in-depth: validate protocol + hostname even if env validation is bypassed
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:") {
    throw new Error(`CMS ${platform} URL must be HTTPS`);
  }
  if (!ALLOWED_HOSTS.includes(parsed.hostname.replace("www.", ""))) {
    throw new Error(`CMS ${platform} hostname not in allowlist`);
  }

  return { baseUrl, appKey, username, password };
}

/** Sanitize CMS response/error text before logging — strip token/jwt/auth fields */
function sanitizeForLog(text: string): string {
  try {
    const obj = JSON.parse(text);
    if (typeof obj === "object" && obj !== null) {
      for (const key of Object.keys(obj)) {
        const lower = key.toLowerCase();
        if (lower.includes("token") || lower.includes("jwt") || lower.includes("authorization")) {
          obj[key] = "[REDACTED]";
        }
      }
      return JSON.stringify(obj);
    }
  } catch { /* not JSON, return as-is */ }
  return text;
}

async function cmsLogin(platform: Platform): Promise<string> {
  const cached = tokens[platform];
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const cfg = getConfig(platform);
  const res = await fetch(cfg.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      app_key: cfg.appKey,
      action: "login",
      username: cfg.username,
      password: cfg.password,
    }),
  });

  if (!res.ok) throw new Error(`CMS login failed (${res.status})`);
  const data = await res.json();
  const token = data?.token || data?.data?.token;
  if (!token) throw new Error("CMS login: no token in response");

  tokens[platform] = { token, expiresAt: Date.now() + 55 * 60 * 1000 };
  return token;
}

export async function cmsPost<T = unknown>(
  platform: Platform,
  className: string,
  methodName: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const cfg = getConfig(platform);
  let token = await cmsLogin(platform);

  const doRequest = async (jwt: string) => {
    const res = await fetch(cfg.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        app_key: cfg.appKey,
        class: className,
        method: methodName,
        params: body,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res;
  };

  let res = await doRequest(token);

  // Retry once on 401 (expired token)
  if (res.status === 401) {
    delete tokens[platform];
    token = await cmsLogin(platform);
    res = await doRequest(token);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(JSON.stringify({ type: "error", endpoint: `cms/${className}/${methodName}`, status: res.status, detail: sanitizeForLog(text) }));
    throw new Error("CMS operation failed");
  }

  const json = await res.json();

  // Validate response is a plain object
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Error("CMS returned unexpected response shape");
  }

  if (json.error) {
    console.error(JSON.stringify({ type: "error", endpoint: `cms/${className}/${methodName}`, cmsError: sanitizeForLog(String(json.error)) }));
    throw new Error("CMS operation failed");
  }

  return json as T;
}
