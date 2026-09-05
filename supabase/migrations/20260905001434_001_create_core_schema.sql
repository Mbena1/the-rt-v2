/*
# THE RT — Core Schema: tables, constraints, RLS, and SQL functions

## Overview
Creates the complete database schema for the THE RT X automation platform.
All tables have Row Level Security enabled with owner-scoped policies.
Critical SQL functions handle job creation, atomic job claiming, and stuck-job recovery.

## New Tables
1. profiles, 2. automation_settings, 3. x_accounts, 4. monitored_accounts,
5. automation_rules, 6. tweets, 7. action_jobs, 8. activity_logs

## SQL Functions
1. handle_new_user() — auto-creates profile + settings on signup
2. create_action_jobs_for_tweet(p_tweet_id, p_user_id) — creates jobs for ALL matching rules
3. claim_pending_jobs(p_now, p_limit) — atomic job claiming with FOR UPDATE SKIP LOCKED
4. recover_stuck_jobs() — recovers jobs stuck in processing > 10 minutes
5. reset_daily_counters() — resets daily counters

## Security
- RLS on ALL tables, owner-scoped (auth.uid() = user_id)
- 4 separate policies per table (SELECT, INSERT, UPDATE, DELETE)
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
  max_daily_retweets integer NOT NULL DEFAULT 50,
  max_daily_likes integer NOT NULL DEFAULT 50,
  max_daily_replies integer NOT NULL DEFAULT 25,
  default_delay_seconds integer NOT NULL DEFAULT 60,
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
-- 3. X_ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS x_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  x_user_id text NOT NULL,
  username text NOT NULL,
  name text,
  profile_image_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected', 'error')),
  access_token_reference text,
  refresh_token_reference text,
  token_expires_at timestamptz,
  retweets_total integer NOT NULL DEFAULT 0,
  retweets_today integer NOT NULL DEFAULT 0,
  likes_total integer NOT NULL DEFAULT 0,
  likes_today integer NOT NULL DEFAULT 0,
  replies_total integer NOT NULL DEFAULT 0,
  replies_today integer NOT NULL DEFAULT 0,
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
-- 4. MONITORED_ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS monitored_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  x_user_id text NOT NULL,
  username text NOT NULL,
  status text NOT NULL DEFAULT 'monitoring' CHECK (status IN ('monitoring', 'paused', 'error')),
  last_seen_post_id text,
  last_checked_at timestamptz,
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
-- 5. AUTOMATION_RULES
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  monitored_account_id uuid NOT NULL REFERENCES monitored_accounts(id) ON DELETE CASCADE,
  x_account_id uuid NOT NULL REFERENCES x_accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  do_retweet boolean NOT NULL DEFAULT false,
  retweet_delay_seconds integer NOT NULL DEFAULT 60,
  do_like boolean NOT NULL DEFAULT false,
  like_delay_seconds integer NOT NULL DEFAULT 60,
  do_reply boolean NOT NULL DEFAULT false,
  reply_delay_seconds integer NOT NULL DEFAULT 60,
  reply_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, monitored_account_id, x_account_id)
);
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_automation_rules" ON automation_rules;
CREATE POLICY "select_own_automation_rules" ON automation_rules FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_automation_rules" ON automation_rules;
CREATE POLICY "insert_own_automation_rules" ON automation_rules FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_automation_rules" ON automation_rules;
CREATE POLICY "update_own_automation_rules" ON automation_rules FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_automation_rules" ON automation_rules;
CREATE POLICY "delete_own_automation_rules" ON automation_rules FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 6. TWEETS
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
  UNIQUE(monitored_account_id, x_post_id)
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
-- 7. ACTION_JOBS
-- ============================================================
CREATE TABLE IF NOT EXISTS action_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  tweet_id uuid NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
  x_account_id uuid NOT NULL REFERENCES x_accounts(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('retweet', 'like', 'reply')),
  reply_text text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'scheduled', 'completed', 'failed')),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
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
-- 8. ACTIVITY_LOGS
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
CREATE INDEX IF NOT EXISTS idx_x_accounts_user_id ON x_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_x_accounts_status ON x_accounts(status);
CREATE INDEX IF NOT EXISTS idx_monitored_accounts_user_id ON monitored_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_monitored_accounts_status ON monitored_accounts(status);
CREATE INDEX IF NOT EXISTS idx_automation_rules_user_id ON automation_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_automation_rules_monitored ON automation_rules(monitored_account_id);
CREATE INDEX IF NOT EXISTS idx_tweets_monitored_account_id ON tweets(monitored_account_id);
CREATE INDEX IF NOT EXISTS idx_tweets_user_id ON tweets(user_id);
CREATE INDEX IF NOT EXISTS idx_action_jobs_status ON action_jobs(status);
CREATE INDEX IF NOT EXISTS idx_action_jobs_scheduled_for ON action_jobs(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_action_jobs_user_id ON action_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_action_jobs_x_account_id ON action_jobs(x_account_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);

-- ============================================================
-- TRIGGER: Auto-create profile + automation_settings on signup
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (user_id) VALUES (NEW.id);
  INSERT INTO automation_settings (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- FUNCTION: create_action_jobs_for_tweet
-- Creates jobs for ALL matching active automation rules.
-- Uses ON CONFLICT DO NOTHING to prevent duplicate jobs.
-- ============================================================
CREATE OR REPLACE FUNCTION create_action_jobs_for_tweet(
  p_tweet_id uuid,
  p_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_monitored_id uuid;
  v_rule RECORD;
  v_jobs_created integer := 0;
  v_delay integer;
  v_scheduled_for timestamptz;
BEGIN
  SELECT monitored_account_id INTO v_monitored_id
  FROM tweets WHERE id = p_tweet_id AND user_id = p_user_id;

  IF v_monitored_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_rule IN
    SELECT ar.*
    FROM automation_rules ar
    JOIN x_accounts xa ON xa.id = ar.x_account_id
    WHERE ar.monitored_account_id = v_monitored_id
      AND ar.user_id = p_user_id
      AND ar.enabled = true
      AND xa.status = 'active'
  LOOP
    IF v_rule.do_retweet = true THEN
      v_delay := v_rule.retweet_delay_seconds;
      v_scheduled_for := now() + make_interval(secs => v_delay);
      INSERT INTO action_jobs (user_id, tweet_id, x_account_id, action_type, status, scheduled_for)
      VALUES (p_user_id, p_tweet_id, v_rule.x_account_id, 'retweet', 'scheduled', v_scheduled_for)
      ON CONFLICT (tweet_id, x_account_id, action_type) DO NOTHING;
      v_jobs_created := v_jobs_created + 1;
    END IF;

    IF v_rule.do_like = true THEN
      v_delay := v_rule.like_delay_seconds;
      v_scheduled_for := now() + make_interval(secs => v_delay);
      INSERT INTO action_jobs (user_id, tweet_id, x_account_id, action_type, status, scheduled_for)
      VALUES (p_user_id, p_tweet_id, v_rule.x_account_id, 'like', 'scheduled', v_scheduled_for)
      ON CONFLICT (tweet_id, x_account_id, action_type) DO NOTHING;
      v_jobs_created := v_jobs_created + 1;
    END IF;

    IF v_rule.do_reply = true AND v_rule.reply_text IS NOT NULL AND btrim(v_rule.reply_text) <> '' THEN
      v_delay := v_rule.reply_delay_seconds;
      v_scheduled_for := now() + make_interval(secs => v_delay);
      INSERT INTO action_jobs (user_id, tweet_id, x_account_id, action_type, reply_text, status, scheduled_for)
      VALUES (p_user_id, p_tweet_id, v_rule.x_account_id, 'reply', v_rule.reply_text, 'scheduled', v_scheduled_for)
      ON CONFLICT (tweet_id, x_account_id, action_type) DO NOTHING;
      v_jobs_created := v_jobs_created + 1;
    END IF;
  END LOOP;

  INSERT INTO activity_logs (user_id, event_type, message, metadata)
  VALUES (
    p_user_id,
    'jobs_created',
    v_jobs_created || ' action jobs created for tweet ' || p_tweet_id,
    jsonb_build_object('tweet_id', p_tweet_id, 'jobs_count', v_jobs_created)
  );

  RETURN v_jobs_created;
END;
$$;

-- ============================================================
-- FUNCTION: claim_pending_jobs
-- Atomically claims jobs using FOR UPDATE SKIP LOCKED.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_pending_jobs(
  p_now timestamptz,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  tweet_id uuid,
  x_account_id uuid,
  action_type text,
  reply_text text,
  status text,
  scheduled_for timestamptz,
  retry_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Recover stuck jobs first (processing > 10 min)
  UPDATE action_jobs
  SET status = CASE WHEN retry_count < 3 THEN 'pending' ELSE 'failed' END,
      error_message = CASE WHEN retry_count < 3 THEN NULL ELSE 'Job timed out in processing' END,
      started_at = NULL,
      updated_at = p_now
  WHERE status = 'processing'
    AND started_at < p_now - interval '10 minutes';

  -- Atomically claim jobs
  UPDATE action_jobs
  SET status = 'processing',
      started_at = p_now,
      updated_at = p_now
  WHERE id IN (
    SELECT j.id FROM action_jobs j
    WHERE j.status IN ('pending', 'scheduled')
      AND j.scheduled_for <= p_now
    ORDER BY j.scheduled_for ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  );

  RETURN QUERY
  SELECT
    aj.id, aj.user_id, aj.tweet_id, aj.x_account_id,
    aj.action_type, aj.reply_text, aj.status, aj.scheduled_for, aj.retry_count
  FROM action_jobs aj
  WHERE aj.status = 'processing'
    AND aj.started_at = p_now
  ORDER BY aj.scheduled_for ASC;
END;
$$;

-- ============================================================
-- FUNCTION: recover_stuck_jobs
-- ============================================================
CREATE OR REPLACE FUNCTION recover_stuck_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recovered integer;
BEGIN
  UPDATE action_jobs
  SET status = CASE WHEN retry_count < 3 THEN 'pending' ELSE 'failed' END,
      error_message = CASE WHEN retry_count < 3 THEN NULL ELSE 'Job timed out in processing' END,
      started_at = NULL,
      updated_at = now()
  WHERE status = 'processing'
    AND started_at < now() - interval '10 minutes';

  GET DIAGNOSTICS v_recovered = ROW_COUNT;
  RETURN v_recovered;
END;
$$;

-- ============================================================
-- FUNCTION: reset_daily_counters
-- ============================================================
CREATE OR REPLACE FUNCTION reset_daily_counters()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reset integer;
BEGIN
  UPDATE x_accounts
  SET retweets_today = 0,
      likes_today = 0,
      replies_today = 0,
      updated_at = now();
  GET DIAGNOSTICS v_reset = ROW_COUNT;
  RETURN v_reset;
END;
$$;

-- ============================================================
-- GRANTS
-- ============================================================
GRANT EXECUTE ON FUNCTION handle_new_user() TO authenticated;
GRANT EXECUTE ON FUNCTION create_action_jobs_for_tweet(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION claim_pending_jobs(timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION recover_stuck_jobs() TO authenticated;
GRANT EXECUTE ON FUNCTION reset_daily_counters() TO authenticated;
