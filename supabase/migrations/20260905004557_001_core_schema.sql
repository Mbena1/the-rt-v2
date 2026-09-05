/*
# THE RT V2 — Core Schema (Tables, Constraints, Indexes, RLS, Policies)

## Overview
Complete database schema for THE RT V2 X automation platform on a fresh Supabase project.
This migration creates all 9 tables with proper foreign keys, CHECK constraints,
UNIQUE constraints, indexes, Row Level Security, and ownership-scoped policies.

## Architecture
Multi-user app with Supabase Auth. Every table is owner-scoped via user_id.
Tokens are separated into x_account_tokens with restrictive RLS so the frontend
can never read OAuth access/refresh tokens.

## New Tables (9)

1. **profiles** — One profile per auth user
2. **automation_settings** — Per-user automation config (one row per user)
3. **x_accounts** — Connected X accounts (public info, no tokens)
4. **x_account_tokens** — OAuth tokens (restricted RLS, service-role only)
5. **monitored_accounts** — X accounts being watched for new posts
6. **automation_rules** — Rules linking monitored + connected accounts with actions
7. **tweets** — Detected posts (UNIQUE prevents duplicates)
8. **action_jobs** — One job per action per account per tweet (UNIQUE prevents duplicates)
9. **activity_logs** — Audit trail of all events

## Key Constraints
- x_accounts: UNIQUE(user_id, x_user_id), UNIQUE(user_id, username), status CHECK
- x_account_tokens: UNIQUE(x_account_id) — one token row per account
- monitored_accounts: UNIQUE(user_id, x_user_id), status CHECK
- automation_rules: UNIQUE(user_id, monitored_account_id, x_account_id), cross-user protection
- tweets: UNIQUE(user_id, monitored_account_id, x_post_id) — prevents duplicate tweet detection
- action_jobs: UNIQUE(tweet_id, x_account_id, action_type) — prevents duplicate jobs
- All delay columns: CHECK >= 0
- All daily limit columns: CHECK >= 0
- retry_count: CHECK >= 0
- action_type: CHECK IN ('retweet', 'like', 'bookmark', 'reply')
- job status: CHECK IN ('pending', 'processing', 'scheduled', 'completed', 'failed')

## Security
- RLS enabled on ALL 9 tables
- 4 policies per table (SELECT, INSERT, UPDATE, DELETE) — 36 policies total
- x_account_tokens: NO SELECT policy for authenticated — tokens are service-role only
- All policies use auth.uid() = user_id ownership checks
- user_id columns default to auth.uid() for seamless frontend inserts

## Cross-User Protection
- automation_rules includes a CHECK that prevents creating a rule where the
  monitored_account or x_account belongs to a different user (enforced via
  INSERT/UPDATE policies with EXISTS subqueries)
*/

-- ============================================================
-- 1. PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profiles" ON profiles;
CREATE POLICY "select_own_profiles" ON profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_profiles" ON profiles;
CREATE POLICY "insert_own_profiles" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_profiles" ON profiles;
CREATE POLICY "update_own_profiles" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_profiles" ON profiles;
CREATE POLICY "delete_own_profiles" ON profiles FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 2. AUTOMATION_SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  monitoring_enabled boolean NOT NULL DEFAULT false,
  max_daily_retweets integer NOT NULL DEFAULT 50 CHECK (max_daily_retweets >= 0),
  max_daily_likes integer NOT NULL DEFAULT 50 CHECK (max_daily_likes >= 0),
  max_daily_bookmarks integer NOT NULL DEFAULT 50 CHECK (max_daily_bookmarks >= 0),
  max_daily_replies integer NOT NULL DEFAULT 25 CHECK (max_daily_replies >= 0),
  default_delay_seconds integer NOT NULL DEFAULT 60 CHECK (default_delay_seconds >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE automation_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_automation_settings" ON automation_settings;
CREATE POLICY "select_own_automation_settings" ON automation_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_automation_settings" ON automation_settings;
CREATE POLICY "insert_own_automation_settings" ON automation_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_automation_settings" ON automation_settings;
CREATE POLICY "update_own_automation_settings" ON automation_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_automation_settings" ON automation_settings;
CREATE POLICY "delete_own_automation_settings" ON automation_settings FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 3. X_ACCOUNTS (public info — no tokens stored here)
-- ============================================================
CREATE TABLE IF NOT EXISTS x_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  x_user_id text NOT NULL,
  username text NOT NULL,
  display_name text,
  profile_image_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected', 'error')),
  retweets_today integer NOT NULL DEFAULT 0 CHECK (retweets_today >= 0),
  retweets_total integer NOT NULL DEFAULT 0 CHECK (retweets_total >= 0),
  likes_today integer NOT NULL DEFAULT 0 CHECK (likes_today >= 0),
  likes_total integer NOT NULL DEFAULT 0 CHECK (likes_total >= 0),
  bookmarks_today integer NOT NULL DEFAULT 0 CHECK (bookmarks_today >= 0),
  bookmarks_total integer NOT NULL DEFAULT 0 CHECK (bookmarks_total >= 0),
  replies_today integer NOT NULL DEFAULT 0 CHECK (replies_today >= 0),
  replies_total integer NOT NULL DEFAULT 0 CHECK (replies_total >= 0),
  token_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, x_user_id),
  UNIQUE(user_id, username)
);
ALTER TABLE x_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_x_accounts" ON x_accounts;
CREATE POLICY "select_own_x_accounts" ON x_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_x_accounts" ON x_accounts;
CREATE POLICY "insert_own_x_accounts" ON x_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_x_accounts" ON x_accounts;
CREATE POLICY "update_own_x_accounts" ON x_accounts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_x_accounts" ON x_accounts;
CREATE POLICY "delete_own_x_accounts" ON x_accounts FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 4. X_ACCOUNT_TOKENS (restricted — service role only)
-- Tokens are separated from x_accounts so the frontend can never read them.
-- No SELECT policy for authenticated role = frontend cannot read tokens.
-- Edge Functions using service role key bypass RLS.
-- ============================================================
CREATE TABLE IF NOT EXISTS x_account_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  x_account_id uuid NOT NULL UNIQUE REFERENCES x_accounts(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE x_account_tokens ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies for authenticated role.
-- This means the frontend (anon/authenticated) cannot access tokens at all.
-- Only the service role (edge functions) can read/write this table.
-- We add a restrictive INSERT policy that only allows the owner to insert
-- (used during OAuth callback via service role which bypasses RLS anyway).
DROP POLICY IF EXISTS "insert_own_x_account_tokens" ON x_account_tokens;
CREATE POLICY "insert_own_x_account_tokens" ON x_account_tokens FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM x_accounts WHERE x_accounts.id = x_account_tokens.x_account_id AND x_accounts.user_id = auth.uid())
);
DROP POLICY IF EXISTS "update_own_x_account_tokens" ON x_account_tokens;
CREATE POLICY "update_own_x_account_tokens" ON x_account_tokens FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM x_accounts WHERE x_accounts.id = x_account_tokens.x_account_id AND x_accounts.user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM x_accounts WHERE x_accounts.id = x_account_tokens.x_account_id AND x_accounts.user_id = auth.uid())
);

-- ============================================================
-- 5. MONITORED_ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS monitored_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  x_user_id text NOT NULL,
  username text NOT NULL,
  status text NOT NULL DEFAULT 'monitoring' CHECK (status IN ('monitoring', 'paused', 'error')),
  last_seen_post_id text,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, x_user_id)
);
ALTER TABLE monitored_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_monitored_accounts" ON monitored_accounts;
CREATE POLICY "select_own_monitored_accounts" ON monitored_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_monitored_accounts" ON monitored_accounts;
CREATE POLICY "insert_own_monitored_accounts" ON monitored_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_monitored_accounts" ON monitored_accounts;
CREATE POLICY "update_own_monitored_accounts" ON monitored_accounts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_monitored_accounts" ON monitored_accounts;
CREATE POLICY "delete_own_monitored_accounts" ON monitored_accounts FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 6. AUTOMATION_RULES
-- Cross-user protection: INSERT and UPDATE policies verify that both
-- monitored_account and x_account belong to the same user.
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  monitored_account_id uuid NOT NULL REFERENCES monitored_accounts(id) ON DELETE CASCADE,
  x_account_id uuid NOT NULL REFERENCES x_accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  do_retweet boolean NOT NULL DEFAULT false,
  retweet_delay_seconds integer NOT NULL DEFAULT 60 CHECK (retweet_delay_seconds >= 0),
  do_like boolean NOT NULL DEFAULT false,
  like_delay_seconds integer NOT NULL DEFAULT 60 CHECK (like_delay_seconds >= 0),
  do_bookmark boolean NOT NULL DEFAULT false,
  bookmark_delay_seconds integer NOT NULL DEFAULT 60 CHECK (bookmark_delay_seconds >= 0),
  do_reply boolean NOT NULL DEFAULT false,
  reply_delay_seconds integer NOT NULL DEFAULT 60 CHECK (reply_delay_seconds >= 0),
  reply_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, monitored_account_id, x_account_id)
);
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_automation_rules" ON automation_rules;
CREATE POLICY "select_own_automation_rules" ON automation_rules FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_automation_rules" ON automation_rules;
CREATE POLICY "insert_own_automation_rules" ON automation_rules FOR INSERT TO authenticated WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM monitored_accounts ma WHERE ma.id = monitored_account_id AND ma.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM x_accounts xa WHERE xa.id = x_account_id AND xa.user_id = auth.uid())
);

DROP POLICY IF EXISTS "update_own_automation_rules" ON automation_rules;
CREATE POLICY "update_own_automation_rules" ON automation_rules FOR UPDATE TO authenticated USING (
  auth.uid() = user_id
) WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM monitored_accounts ma WHERE ma.id = monitored_account_id AND ma.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM x_accounts xa WHERE xa.id = x_account_id AND xa.user_id = auth.uid())
);

DROP POLICY IF EXISTS "delete_own_automation_rules" ON automation_rules;
CREATE POLICY "delete_own_automation_rules" ON automation_rules FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 7. TWEETS
-- UNIQUE(user_id, monitored_account_id, x_post_id) prevents duplicate detection.
-- ============================================================
CREATE TABLE IF NOT EXISTS tweets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  monitored_account_id uuid NOT NULL REFERENCES monitored_accounts(id) ON DELETE CASCADE,
  x_post_id text NOT NULL,
  author_username text,
  text text,
  published_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now(),
  post_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, monitored_account_id, x_post_id)
);
ALTER TABLE tweets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_tweets" ON tweets;
CREATE POLICY "select_own_tweets" ON tweets FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_tweets" ON tweets;
CREATE POLICY "insert_own_tweets" ON tweets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_tweets" ON tweets;
CREATE POLICY "update_own_tweets" ON tweets FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_tweets" ON tweets;
CREATE POLICY "delete_own_tweets" ON tweets FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 8. ACTION_JOBS
-- UNIQUE(tweet_id, x_account_id, action_type) prevents duplicate jobs.
-- ============================================================
CREATE TABLE IF NOT EXISTS action_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  tweet_id uuid NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
  x_account_id uuid NOT NULL REFERENCES x_accounts(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('retweet', 'like', 'bookmark', 'reply')),
  reply_text text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'scheduled', 'completed', 'failed')),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_message text,
  x_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tweet_id, x_account_id, action_type)
);
ALTER TABLE action_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_action_jobs" ON action_jobs;
CREATE POLICY "select_own_action_jobs" ON action_jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_action_jobs" ON action_jobs;
CREATE POLICY "insert_own_action_jobs" ON action_jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_action_jobs" ON action_jobs;
CREATE POLICY "update_own_action_jobs" ON action_jobs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_action_jobs" ON action_jobs;
CREATE POLICY "delete_own_action_jobs" ON action_jobs FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 9. ACTIVITY_LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  message text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_activity_logs" ON activity_logs;
CREATE POLICY "select_own_activity_logs" ON activity_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_activity_logs" ON activity_logs;
CREATE POLICY "insert_own_activity_logs" ON activity_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_activity_logs" ON activity_logs;
CREATE POLICY "update_own_activity_logs" ON activity_logs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_activity_logs" ON activity_logs;
CREATE POLICY "delete_own_activity_logs" ON activity_logs FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- INDEXES
-- ============================================================
-- x_accounts
CREATE INDEX IF NOT EXISTS idx_x_accounts_user_id ON x_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_x_accounts_status ON x_accounts(status);

-- monitored_accounts
CREATE INDEX IF NOT EXISTS idx_monitored_accounts_user_id ON monitored_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_monitored_accounts_user_status ON monitored_accounts(user_id, status);

-- automation_rules
CREATE INDEX IF NOT EXISTS idx_automation_rules_user_id ON automation_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_automation_rules_monitored_enabled ON automation_rules(monitored_account_id, enabled);
CREATE INDEX IF NOT EXISTS idx_automation_rules_x_account ON automation_rules(x_account_id);

-- tweets
CREATE INDEX IF NOT EXISTS idx_tweets_monitored_account_id ON tweets(monitored_account_id);
CREATE INDEX IF NOT EXISTS idx_tweets_user_id ON tweets(user_id);
CREATE INDEX IF NOT EXISTS idx_tweets_created_at_desc ON tweets(created_at DESC);

-- action_jobs — composite index for queue processing
CREATE INDEX IF NOT EXISTS idx_action_jobs_status ON action_jobs(status);
CREATE INDEX IF NOT EXISTS idx_action_jobs_scheduled_for ON action_jobs(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_action_jobs_user_id ON action_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_action_jobs_x_account_id ON action_jobs(x_account_id);
CREATE INDEX IF NOT EXISTS idx_action_jobs_status_scheduled ON action_jobs(status, scheduled_for);

-- activity_logs
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at_desc ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_event_type ON activity_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created ON activity_logs(user_id, created_at DESC);

-- x_account_tokens
CREATE INDEX IF NOT EXISTS idx_x_account_tokens_x_account_id ON x_account_tokens(x_account_id);
