import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    // Supabase (server-side — for JWT verification)
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

    // MTA MySQL
    MTA_MYSQL_HOST: z.string().min(1),
    MTA_MYSQL_PORT: z.coerce.number().int().default(3306),
    MTA_MYSQL_USER: z.string().min(1),
    MTA_MYSQL_PASSWORD: z.string().min(1),
    MTA_MYSQL_DATABASE: z.string().min(1),
    MTA_MYSQL_SSL: z.enum(["true", "false"]).default("true"),

    // MTT MySQL
    MTT_MYSQL_HOST: z.string().min(1),
    MTT_MYSQL_PORT: z.coerce.number().int().default(3306),
    MTT_MYSQL_USER: z.string().min(1),
    MTT_MYSQL_PASSWORD: z.string().min(1),
    MTT_MYSQL_DATABASE: z.string().min(1),
    MTT_MYSQL_SSL: z.enum(["true", "false"]).default("true"),

    // CMS APIs
    CMS_MTA_API_BASE_URL: z.string().url()
      .refine(u => u.startsWith("https://"), "CMS URL must be HTTPS")
      .refine(u => { try { return ["athleticsolutionstech.com","matchtennisteam.com"].includes(new URL(u).hostname.replace("www.","")); } catch { return false; } }, "CMS URL hostname not in allowlist")
      .optional(),
    CMS_MTA_API_APP_KEY: z.string().optional(),
    CMS_MTA_API_USERNAME: z.string().optional(),
    CMS_MTA_API_PASSWORD: z.string().optional(),
    CMS_MTT_API_BASE_URL: z.string().url()
      .refine(u => u.startsWith("https://"), "CMS URL must be HTTPS")
      .refine(u => { try { return ["athleticsolutionstech.com","matchtennisteam.com"].includes(new URL(u).hostname.replace("www.","")); } catch { return false; } }, "CMS URL hostname not in allowlist")
      .optional(),
    CMS_MTT_API_APP_KEY: z.string().optional(),
    CMS_MTT_API_USERNAME: z.string().optional(),
    CMS_MTT_API_PASSWORD: z.string().optional(),

    // Rate limiting (Upstash Redis)
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

    // Allowed origins for CORS
    ALLOWED_ORIGINS: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  },
  runtimeEnv: {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    MTA_MYSQL_HOST: process.env.MTA_MYSQL_HOST,
    MTA_MYSQL_PORT: process.env.MTA_MYSQL_PORT,
    MTA_MYSQL_USER: process.env.MTA_MYSQL_USER,
    MTA_MYSQL_PASSWORD: process.env.MTA_MYSQL_PASSWORD,
    MTA_MYSQL_DATABASE: process.env.MTA_MYSQL_DATABASE,
    MTA_MYSQL_SSL: process.env.MTA_MYSQL_SSL,
    MTT_MYSQL_HOST: process.env.MTT_MYSQL_HOST,
    MTT_MYSQL_PORT: process.env.MTT_MYSQL_PORT,
    MTT_MYSQL_USER: process.env.MTT_MYSQL_USER,
    MTT_MYSQL_PASSWORD: process.env.MTT_MYSQL_PASSWORD,
    MTT_MYSQL_DATABASE: process.env.MTT_MYSQL_DATABASE,
    MTT_MYSQL_SSL: process.env.MTT_MYSQL_SSL,
    CMS_MTA_API_BASE_URL: process.env.CMS_MTA_API_BASE_URL,
    CMS_MTA_API_APP_KEY: process.env.CMS_MTA_API_APP_KEY,
    CMS_MTA_API_USERNAME: process.env.CMS_MTA_API_USERNAME,
    CMS_MTA_API_PASSWORD: process.env.CMS_MTA_API_PASSWORD,
    CMS_MTT_API_BASE_URL: process.env.CMS_MTT_API_BASE_URL,
    CMS_MTT_API_APP_KEY: process.env.CMS_MTT_API_APP_KEY,
    CMS_MTT_API_USERNAME: process.env.CMS_MTT_API_USERNAME,
    CMS_MTT_API_PASSWORD: process.env.CMS_MTT_API_PASSWORD,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  // Allow build to succeed even if vars are missing (validated at runtime)
  // NEVER set SKIP_ENV_VALIDATION=true in production
  skipValidation: (() => {
    if (process.env.SKIP_ENV_VALIDATION && process.env.NODE_ENV === "production") {
      throw new Error("SKIP_ENV_VALIDATION must not be set in production");
    }
    return !!process.env.SKIP_ENV_VALIDATION;
  })(),
});
