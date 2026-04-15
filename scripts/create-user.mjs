#!/usr/bin/env node
// Create a new Support Hub user with a username (no real email required).
//
// Usage:
//   node --env-file=.env.local scripts/create-user.mjs \
//     --username va-sarah --password 'long-random-pw' --role support_agent
//
// Roles: support_agent (default, no PII access) | support_admin | super_admin
//
// What it does:
//   1. Validates the username (lowercase, 3-32 chars, no @ or whitespace)
//   2. Generates a placeholder email like <uuid>@users.mta-internal.local
//   3. Creates the auth.users row via Supabase admin API with the role baked
//      into app_metadata so middleware.ts picks it up
//   4. Upserts the username into public.profiles for username login lookup
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
// Use Node 20+ so --env-file works natively.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const ROLES = new Set(["support_agent", "support_admin", "super_admin"]);
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const PLACEHOLDER_DOMAIN = "users.mta-internal.local";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function usage() {
  console.error(
    "usage: node --env-file=.env.local scripts/create-user.mjs --username <name> --password <pw> [--role support_agent|support_admin|super_admin]"
  );
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) usage();

const username = (args.username || "").toLowerCase();
const password = args.password || "";
const role = (args.role || "support_agent").toLowerCase();

if (!username) fail("--username is required");
if (!USERNAME_RE.test(username))
  fail(
    "username must be 3-32 chars, lowercase letters/digits/._-, starting with a letter or digit"
  );
if (!password || password.length < 12)
  fail("--password is required and must be at least 12 characters");
if (!ROLES.has(role)) fail(`--role must be one of: ${[...ROLES].join(", ")}`);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey)
  fail(
    "missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local or export them)"
  );

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Pre-flight: make sure the username isn't already taken. The DB unique index
// would catch this too, but a clean error message is friendlier.
const { data: existing, error: existingErr } = await admin
  .from("profiles")
  .select("id")
  .eq("username", username)
  .maybeSingle();
if (existingErr) fail(`profile lookup failed: ${existingErr.message}`);
if (existing) fail(`username "${username}" is already taken`);

const placeholderEmail = `${randomUUID()}@${PLACEHOLDER_DOMAIN}`;

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: placeholderEmail,
  password,
  email_confirm: true,
  app_metadata: { role },
});
if (createErr || !created?.user) fail(`createUser failed: ${createErr?.message ?? "unknown"}`);

// The on_auth_user_created trigger should have inserted an empty profile row
// already. Upsert with the username so this works whether or not the trigger
// has been installed yet.
const { error: profileErr } = await admin
  .from("profiles")
  .upsert({ id: created.user.id, username }, { onConflict: "id" });

if (profileErr) {
  // Roll back: don't leave a half-provisioned user with no username.
  await admin.auth.admin.deleteUser(created.user.id);
  fail(`profile upsert failed (rolled back user): ${profileErr.message}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      userId: created.user.id,
      username,
      role,
      placeholderEmail,
      message: `User created. Hand off the username + password securely (1Password). Password recovery is admin-only — reset via Supabase dashboard.`,
    },
    null,
    2
  )
);
