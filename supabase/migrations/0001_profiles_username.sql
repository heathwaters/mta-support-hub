-- Migration: profiles table with username for hybrid email/username login
--
-- Run this in the Supabase Dashboard SQL editor (this repo does not use the
-- Supabase CLI for migrations — file is committed for documentation only).
--
-- What it does:
--   1. Creates public.profiles (1:1 with auth.users) holding an optional
--      `username` column. Username is nullable so existing email-only users
--      coexist without forcing migration.
--   2. Adds a case-insensitive unique index on username so "Sarah" and
--      "sarah" cannot both exist.
--   3. Installs an after-insert trigger on auth.users that auto-creates an
--      empty profile row for every new user (Supabase's standard pattern).
--   4. Backfills profile rows for any users that already exist.
--   5. Locks the table down with RLS — only the service_role key (used by
--      the server-side /api/auth/login route) can read or write it. The
--      anon key cannot enumerate usernames from the browser.

create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id)
  select id from auth.users
  on conflict do nothing;

alter table public.profiles enable row level security;
-- No policies defined: with RLS enabled and zero policies, only the
-- service_role bypass can SELECT/INSERT/UPDATE/DELETE this table.
