import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

// --- Rate limiters per endpoint category ---

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const LIMITS: Record<string, RateLimitConfig> = {
  search: { maxRequests: 30, windowMs: 60_000 },
  read: { maxRequests: 60, windowMs: 60_000 },
  write: { maxRequests: 10, windowMs: 60_000 },
  "write-sensitive": { maxRequests: 5, windowMs: 60_000 },
  unauthenticated: { maxRequests: 5, windowMs: 60_000 },
};

const _limiters: Record<string, Ratelimit> = {};

function getLimiter(category: string): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;

  if (_limiters[category]) return _limiters[category];

  const config = LIMITS[category] || LIMITS.read;
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(config.maxRequests, `${config.windowMs} ms`),
    prefix: `ratelimit:${category}`,
  });
  _limiters[category] = limiter;
  return limiter;
}

/**
 * Classify an endpoint into a rate limit category.
 */
export function classifyEndpoint(pathname: string, method: string): string {
  if (pathname.includes("/actions/reset-password")) return "write-sensitive";
  if (pathname.includes("/actions/")) return "write";
  if (pathname.includes("/search")) return "search";
  if (method !== "GET") return "write";
  return "read";
}

/**
 * Check rate limit for a user+endpoint combination.
 * Returns null if allowed, or a 429 NextResponse if rate limited.
 *
 * If Upstash Redis is not configured, rate limiting is disabled (dev mode).
 */
export async function checkRateLimit(
  identifier: string,
  category: string
): Promise<NextResponse | null> {
  const limiter = getLimiter(category);
  if (!limiter) {
    if (process.env.NODE_ENV === "production") {
      console.error(JSON.stringify({ type: "critical", msg: "Rate limiting disabled — Upstash Redis not configured in production" }));
      return NextResponse.json(
        { ok: false, error: "service unavailable", code: "RATE_LIMIT_UNAVAILABLE" },
        { status: 503, headers: { "Retry-After": "60" } }
      );
    }
    return null; // No Redis configured — allow in dev
  }

  const { success, reset } = await limiter.limit(identifier);
  if (success) return null;

  const retryAfter = Math.ceil((reset - Date.now()) / 1000);
  return NextResponse.json(
    { ok: false, error: "rate limit exceeded", code: "RATE_LIMITED", retryAfter },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    }
  );
}
