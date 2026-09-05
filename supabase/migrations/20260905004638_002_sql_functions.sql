/*
# THE RT V2 — SQL Functions and Triggers

## Overview
Creates all SQL functions needed for the automation pipeline:
- handle_new_user: auto-creates profile + automation_settings on signup
- create_action_jobs_for_tweet: creates jobs for ALL matching active rules
- claim_pending_jobs: atomically claims jobs using FOR UPDATE SKIP LOCKED
- recover_stuck_jobs: recovers jobs stuck in processing > 10 minutes
- reset_daily_counters: resets daily counters for all X accounts
- increment_x_account_counter: atomically increments a specific counter

## Functions

### handle_new_user()
- Trigger: AFTER INSERT ON auth.users
- Creates a profile row and automation_settings row for each new user
- SECURITY DEFINER so it can insert even though RLS would block

### create_action_jobs_for_tweet(p_tweet_id, p_user_id)
- Retrieves the tweet and its monitored_account_id
- Fetches ALL active automation_rules for that monitored account
- NEVER uses LIMIT 1 — processes every rule
- For each rule, creates jobs for each enabled action (retweet, like, bookmark, reply)
- Uses ON CONFLICT (tweet_id, x_account_id, action_type) DO NOTHING
- Each job gets scheduled_for = now() + delay_seconds
- Reply jobs only created if reply_text IS NOT NULL and trimmed is not empty
- Returns the number of jobs actually created
- Logs activity via activity_logs

### claim_pending_jobs(p_now, p_limit)
- First recovers stuck jobs (processing > 10 min)
- Then atomically claims pending/scheduled jobs using FOR UPDATE SKIP LOCKED
- Sets status = 'processing', started_at = p_now
- Returns the claimed jobs with all fields needed by the queue processor
- Two concurrent processors can never claim the same job

### recover_stuck_jobs()
- Finds jobs where status = 'processing' AND started_at < now() - 10 minutes
- If retry_count < 3: resets to 'pending', clears started_at
- If retry_count >= 3: marks as 'failed' with error message
- Returns count of recovered jobs

### reset_daily_counters()
- Sets retweets_today, likes_today, bookmarks_today, replies_today to 0
- For ALL x_accounts
- Returns count of reset accounts

### increment_x_account_counter(p_account_id, p_counter)
- Atomically increments a named counter on x_accounts
- Used by queue-processor after successful actions
- SECURITY DEFINER for atomic increment

## Security
- All functions are SECURITY DEFINER with search_path = public
- EXECUTE granted to authenticated where appropriate
- Edge functions use service role which bypasses RLS
*/

-- ============================================================
-- FUNCTION: handle_new_user
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
-- Processes ALL matching active rules. NEVER uses LIMIT 1.
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
  v_scheduled_for timestamptz;
BEGIN
  -- Get the tweet's monitored account
  SELECT monitored_account_id INTO v_monitored_id
  FROM tweets WHERE id = p_tweet_id AND user_id = p_user_id;

  IF v_monitored_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Process ALL active rules for this monitored account
  -- NO LIMIT 1 — we process every matching rule
  FOR v_rule IN
    SELECT ar.*
    FROM automation_rules ar
    JOIN x_accounts xa ON xa.id = ar.x_account_id
    WHERE ar.monitored_account_id = v_monitored_id
      AND ar.user_id = p_user_id
      AND ar.enabled = true
      AND xa.status = 'active'
  LOOP
    -- Retweet job
    IF v_rule.do_retweet = true THEN
      v_scheduled_for := now() + make_interval(secs => v_rule.retweet_delay_seconds);
      INSERT INTO action_jobs (user_id, tweet_id, x_account_id, action_type, status, scheduled_for)
      VALUES (p_user_id, p_tweet_id, v_rule.x_account_id, 'retweet', 'scheduled', v_scheduled_for)
      ON CONFLICT (tweet_id, x_account_id, action_type) DO NOTHING;
      v_jobs_created := v_jobs_created + 1;
    END IF;

    -- Like job
    IF v_rule.do_like = true THEN
      v_scheduled_for := now() + make_interval(secs => v_rule.like_delay_seconds);
      INSERT INTO action_jobs (user_id, tweet_id, x_account_id, action_type, status, scheduled_for)
      VALUES (p_user_id, p_tweet_id, v_rule.x_account_id, 'like', 'scheduled', v_scheduled_for)
      ON CONFLICT (tweet_id, x_account_id, action_type) DO NOTHING;
      v_jobs_created := v_jobs_created + 1;
    END IF;

    -- Bookmark job
    IF v_rule.do_bookmark = true THEN
      v_scheduled_for := now() + make_interval(secs => v_rule.bookmark_delay_seconds);
      INSERT INTO action_jobs (user_id, tweet_id, x_account_id, action_type, status, scheduled_for)
      VALUES (p_user_id, p_tweet_id, v_rule.x_account_id, 'bookmark', 'scheduled', v_scheduled_for)
      ON CONFLICT (tweet_id, x_account_id, action_type) DO NOTHING;
      v_jobs_created := v_jobs_created + 1;
    END IF;

    -- Reply job (only if reply_text is not empty)
    IF v_rule.do_reply = true AND v_rule.reply_text IS NOT NULL AND btrim(v_rule.reply_text) <> '' THEN
      v_scheduled_for := now() + make_interval(secs => v_rule.reply_delay_seconds);
      INSERT INTO action_jobs (user_id, tweet_id, x_account_id, action_type, reply_text, status, scheduled_for)
      VALUES (p_user_id, p_tweet_id, v_rule.x_account_id, 'reply', v_rule.reply_text, 'scheduled', v_scheduled_for)
      ON CONFLICT (tweet_id, x_account_id, action_type) DO NOTHING;
      v_jobs_created := v_jobs_created + 1;
    END IF;
  END LOOP;

  -- Log activity
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
-- First recovers stuck jobs, then claims pending/scheduled jobs.
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
  started_at timestamptz,
  retry_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Step 1: Recover stuck jobs (processing > 10 minutes)
  UPDATE action_jobs
  SET status = CASE WHEN retry_count < 3 THEN 'pending' ELSE 'failed' END,
      error_message = CASE WHEN retry_count < 3 THEN NULL ELSE 'Job timed out in processing state' END,
      started_at = NULL,
      updated_at = p_now
  WHERE status = 'processing'
    AND started_at < p_now - interval '10 minutes';

  -- Step 2: Atomically claim pending/scheduled jobs
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

  -- Step 3: Return the claimed jobs
  RETURN QUERY
  SELECT
    aj.id, aj.user_id, aj.tweet_id, aj.x_account_id,
    aj.action_type, aj.reply_text, aj.status, aj.scheduled_for,
    aj.started_at, aj.retry_count
  FROM action_jobs aj
  WHERE aj.status = 'processing'
    AND aj.started_at = p_now
  ORDER BY aj.scheduled_for ASC;
END;
$$;

-- ============================================================
-- FUNCTION: recover_stuck_jobs
-- Finds jobs stuck in processing > 10 minutes and recovers them.
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
      error_message = CASE WHEN retry_count < 3 THEN NULL ELSE 'Job timed out in processing state' END,
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
-- Resets all daily counters to 0 for all X accounts.
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
      bookmarks_today = 0,
      replies_today = 0,
      updated_at = now();
  GET DIAGNOSTICS v_reset = ROW_COUNT;
  RETURN v_reset;
END;
$$;

-- ============================================================
-- FUNCTION: increment_x_account_counter
-- Atomically increments a named counter on x_accounts.
-- ============================================================
CREATE OR REPLACE FUNCTION increment_x_account_counter(
  p_account_id uuid,
  p_counter text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_counter = 'retweets_today' THEN
    UPDATE x_accounts SET retweets_today = retweets_today + 1, updated_at = now() WHERE id = p_account_id;
  ELSIF p_counter = 'retweets_total' THEN
    UPDATE x_accounts SET retweets_total = retweets_total + 1, updated_at = now() WHERE id = p_account_id;
  ELSIF p_counter = 'likes_today' THEN
    UPDATE x_accounts SET likes_today = likes_today + 1, updated_at = now() WHERE id = p_account_id;
  ELSIF p_counter = 'likes_total' THEN
    UPDATE x_accounts SET likes_total = likes_total + 1, updated_at = now() WHERE id = p_account_id;
  ELSIF p_counter = 'bookmarks_today' THEN
    UPDATE x_accounts SET bookmarks_today = bookmarks_today + 1, updated_at = now() WHERE id = p_account_id;
  ELSIF p_counter = 'bookmarks_total' THEN
    UPDATE x_accounts SET bookmarks_total = bookmarks_total + 1, updated_at = now() WHERE id = p_account_id;
  ELSIF p_counter = 'replies_today' THEN
    UPDATE x_accounts SET replies_today = replies_today + 1, updated_at = now() WHERE id = p_account_id;
  ELSIF p_counter = 'replies_total' THEN
    UPDATE x_accounts SET replies_total = replies_total + 1, updated_at = now() WHERE id = p_account_id;
  END IF;
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
GRANT EXECUTE ON FUNCTION increment_x_account_counter(uuid, text) TO authenticated;
