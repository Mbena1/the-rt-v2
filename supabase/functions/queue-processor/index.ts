import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const clientId = Deno.env.get("X_CLIENT_ID")!;
const clientSecret = Deno.env.get("X_CLIENT_SECRET")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface ClaimedJob {
  id: string;
  user_id: string;
  tweet_id: string;
  x_account_id: string;
  action_type: string;
  reply_text: string | null;
  status: string;
  scheduled_for: string;
  started_at: string;
  retry_count: number;
}

interface XAccount {
  id: string;
  x_user_id: string;
  username: string;
  status: string;
  retweets_today: number;
  likes_today: number;
  bookmarks_today: number;
  replies_today: number;
}

interface XAccountToken {
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
}

interface TweetInfo {
  x_post_id: string;
  author_username: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  console.log("[QUEUE] Starting queue processing cycle");

  try {
    const now = new Date().toISOString();

    // 1. Atomically claim pending jobs
    console.log(`[QUEUE] Claiming pending jobs at ${now}`);
    const { data: jobs, error: claimError } = await supabase.rpc("claim_pending_jobs", {
      p_now: now,
      p_limit: 10,
    });

    if (claimError) {
      console.error("[QUEUE] Error claiming jobs:", claimError.message);
      throw claimError;
    }

    if (!jobs || jobs.length === 0) {
      console.log("[QUEUE] No jobs to process");
      return jsonResponse({ message: "No jobs to process", processed: 0 });
    }

    console.log(`[QUEUE] Claimed ${jobs.length} jobs`);

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const job of jobs as ClaimedJob[]) {
      console.log(`[JOB] Processing job ${job.id}: ${job.action_type} (retry ${job.retry_count})`);

      try {
        // 2. Fetch the X account
        const { data: account, error: accError } = await supabase
          .from("x_accounts")
          .select("id, x_user_id, username, status, retweets_today, likes_today, bookmarks_today, replies_today")
          .eq("id", job.x_account_id)
          .single();

        if (accError || !account) {
          console.error(`[ACCOUNT] Failed to fetch X account ${job.x_account_id}:`, accError?.message || "not found");
          await markJobFailed(job, "X account not found");
          failed++;
          processed++;
          continue;
        }

        const xAccount = account as XAccount;

        if (xAccount.status !== "active") {
          console.error(`[ACCOUNT] X account @${xAccount.username} status is ${xAccount.status}, skipping job`);
          await markJobFailed(job, `X account status is ${xAccount.status}`);
          failed++;
          processed++;
          continue;
        }

        // 3. Fetch OAuth tokens from x_account_tokens (service role bypasses RLS)
        const { data: tokenRow, error: tokenError } = await supabase
          .from("x_account_tokens")
          .select("access_token, refresh_token, token_expires_at")
          .eq("x_account_id", xAccount.id)
          .single();

        if (tokenError || !tokenRow) {
          console.error(`[TOKEN] Failed to fetch tokens for @${xAccount.username}:`, tokenError?.message || "not found");
          await markAccountError(xAccount, "No OAuth tokens found");
          await markJobFailed(job, "No OAuth tokens found");
          failed++;
          processed++;
          continue;
        }

        const tokens = tokenRow as XAccountToken;

        // 4. Check token expiry — refresh if needed
        let accessToken = tokens.access_token;
        let refreshToken = tokens.refresh_token;
        const tokenExpires = new Date(tokens.token_expires_at);
        const needsRefresh = tokenExpires.getTime() - Date.now() < 5 * 60 * 1000; // 5 min buffer

        if (needsRefresh) {
          console.log(`[TOKEN] Token for @${xAccount.username} expires soon, refreshing...`);
          const refreshResult = await refreshXToken(refreshToken);

          if (refreshResult.error) {
            console.error(`[TOKEN] Refresh failed for @${xAccount.username}:`, refreshResult.error);
            await markAccountError(xAccount, "Token refresh failed: " + refreshResult.error);
            await markJobFailed(job, "Token refresh failed");
            failed++;
            processed++;
            continue;
          }

          accessToken = refreshResult.access_token!;
          refreshToken = refreshResult.refresh_token!;
          const newExpiresAt = new Date(Date.now() + (refreshResult.expires_in || 7200) * 1000).toISOString();

          // Update tokens in x_account_tokens
          await supabase
            .from("x_account_tokens")
            .update({
              access_token: accessToken,
              refresh_token: refreshToken,
              token_expires_at: newExpiresAt,
              updated_at: now,
            })
            .eq("x_account_id", xAccount.id);

          // Also update token_expires_at on x_accounts for frontend visibility
          await supabase
            .from("x_accounts")
            .update({ token_expires_at: newExpiresAt, updated_at: now })
            .eq("id", xAccount.id);

          console.log(`[TOKEN] Token refreshed for @${xAccount.username}`);
        }

        // 5. Fetch tweet info
        const { data: tweet, error: tweetError } = await supabase
          .from("tweets")
          .select("x_post_id, author_username")
          .eq("id", job.tweet_id)
          .single();

        if (tweetError || !tweet) {
          console.error(`[JOB] Tweet ${job.tweet_id} not found:`, tweetError?.message || "not found");
          await markJobFailed(job, "Tweet not found");
          failed++;
          processed++;
          continue;
        }

        const tweetInfo = tweet as TweetInfo;

        // 6. Check daily limits
        const { data: settings } = await supabase
          .from("automation_settings")
          .select("max_daily_retweets, max_daily_likes, max_daily_bookmarks, max_daily_replies")
          .eq("user_id", job.user_id)
          .maybeSingle();

        if (settings) {
          if (job.action_type === "retweet" && xAccount.retweets_today >= settings.max_daily_retweets) {
            console.log(`[LIMIT] Daily retweet limit reached for @${xAccount.username} (${xAccount.retweets_today}/${settings.max_daily_retweets})`);
            await markJobFailed(job, "Daily retweet limit reached");
            failed++;
            processed++;
            continue;
          }
          if (job.action_type === "like" && xAccount.likes_today >= settings.max_daily_likes) {
            console.log(`[LIMIT] Daily like limit reached for @${xAccount.username} (${xAccount.likes_today}/${settings.max_daily_likes})`);
            await markJobFailed(job, "Daily like limit reached");
            failed++;
            processed++;
            continue;
          }
          if (job.action_type === "bookmark" && xAccount.bookmarks_today >= settings.max_daily_bookmarks) {
            console.log(`[LIMIT] Daily bookmark limit reached for @${xAccount.username} (${xAccount.bookmarks_today}/${settings.max_daily_bookmarks})`);
            await markJobFailed(job, "Daily bookmark limit reached");
            failed++;
            processed++;
            continue;
          }
          if (job.action_type === "reply" && xAccount.replies_today >= settings.max_daily_replies) {
            console.log(`[LIMIT] Daily reply limit reached for @${xAccount.username} (${xAccount.replies_today}/${settings.max_daily_replies})`);
            await markJobFailed(job, "Daily reply limit reached");
            failed++;
            processed++;
            continue;
          }
        }

        // 7. Execute the action
        let actionResult: { success: boolean; response: unknown; error?: string; statusCode?: number };

        if (job.action_type === "retweet") {
          actionResult = await executeRetweet(accessToken, xAccount.x_user_id, tweetInfo.x_post_id);
        } else if (job.action_type === "like") {
          actionResult = await executeLike(accessToken, xAccount.x_user_id, tweetInfo.x_post_id);
        } else if (job.action_type === "bookmark") {
          actionResult = await executeBookmark(accessToken, xAccount.x_user_id, tweetInfo.x_post_id);
        } else if (job.action_type === "reply") {
          if (!job.reply_text || job.reply_text.trim() === "") {
            console.error(`[JOB] Reply text is empty for job ${job.id}`);
            await markJobFailed(job, "Reply text is empty");
            failed++;
            processed++;
            continue;
          }
          actionResult = await executeReply(accessToken, tweetInfo.x_post_id, job.reply_text);
        } else {
          await markJobFailed(job, `Unknown action type: ${job.action_type}`);
          failed++;
          processed++;
          continue;
        }

        // 8. Handle 401 — try token refresh once, then retry
        if (actionResult.statusCode === 401) {
          console.log(`[TOKEN] Got 401 for @${xAccount.username}, attempting single refresh + retry`);
          const refreshResult = await refreshXToken(refreshToken);

          if (refreshResult.error) {
            console.error(`[TOKEN] Refresh failed on 401 retry: ${refreshResult.error}`);
            await markAccountError(xAccount, "Token refresh failed on 401");
            await handleJobFailure(job, xAccount, "401 Unauthorized — token refresh failed");
            failed++;
            processed++;
            continue;
          }

          accessToken = refreshResult.access_token!;
          refreshToken = refreshResult.refresh_token!;
          const newExpiresAt = new Date(Date.now() + (refreshResult.expires_in || 7200) * 1000).toISOString();

          await supabase
            .from("x_account_tokens")
            .update({
              access_token: accessToken,
              refresh_token: refreshToken,
              token_expires_at: newExpiresAt,
              updated_at: now,
            })
            .eq("x_account_id", xAccount.id);

          // Retry the action ONCE
          if (job.action_type === "retweet") {
            actionResult = await executeRetweet(accessToken, xAccount.x_user_id, tweetInfo.x_post_id);
          } else if (job.action_type === "like") {
            actionResult = await executeLike(accessToken, xAccount.x_user_id, tweetInfo.x_post_id);
          } else if (job.action_type === "bookmark") {
            actionResult = await executeBookmark(accessToken, xAccount.x_user_id, tweetInfo.x_post_id);
          } else if (job.action_type === "reply") {
            actionResult = await executeReply(accessToken, tweetInfo.x_post_id, job.reply_text);
          }

          if (actionResult.statusCode === 401) {
            console.error(`[TOKEN] Still 401 after refresh for @${xAccount.username}, marking as error`);
            await markAccountError(xAccount, "Unauthorized — token invalid after refresh");
            await handleJobFailure(job, xAccount, "401 Unauthorized after token refresh");
            failed++;
            processed++;
            continue;
          }
        }

        if (actionResult.success) {
          // 9. Mark job completed
          console.log(`[JOB] Job ${job.id} completed successfully`);
          await supabase
            .from("action_jobs")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
              error_message: null,
              x_response: actionResult.response,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          // 10. Increment counters atomically
          await supabase.rpc("increment_x_account_counter", {
            p_account_id: xAccount.id,
            p_counter: job.action_type + "s_today",
          });
          await supabase.rpc("increment_x_account_counter", {
            p_account_id: xAccount.id,
            p_counter: job.action_type + "s_total",
          });

          await logActivity(job.user_id, "job_completed",
            `${job.action_type} completed for @${xAccount.username} on tweet ${tweetInfo.x_post_id}`,
            { job_id: job.id, action_type: job.action_type, x_account: xAccount.username }
          );

          succeeded++;
        } else {
          console.error(`[JOB] Job ${job.id} failed: ${actionResult.error}`);
          await handleJobFailure(job, xAccount, actionResult.error || "Action failed");
          failed++;
        }

        processed++;
      } catch (err) {
        console.error(`[JOB] Unexpected error processing job ${job.id}:`, err.message);
        await handleJobFailure(job, null, err.message);
        failed++;
        processed++;
      }
    }

    console.log(`[QUEUE] Cycle complete: processed=${processed}, succeeded=${succeeded}, failed=${failed}`);

    return jsonResponse({
      message: "Queue processed",
      processed,
      succeeded,
      failed,
    });
  } catch (err) {
    console.error("[QUEUE] Fatal error:", err.message);
    return jsonResponse({ error: err.message }, 500);
  }
});

// ============================================================
// Action executors
// ============================================================

async function executeRetweet(
  accessToken: string,
  xUserId: string,
  tweetId: string
): Promise<{ success: boolean; response: unknown; error?: string; statusCode?: number }> {
  try {
    console.log(`[X API] Retweet: user=${xUserId}, tweet=${tweetId}`);
    const res = await fetch(`https://api.twitter.com/2/users/${xUserId}/retweets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tweet_id: tweetId }),
    });
    const data = await res.json();

    if (res.status === 401) return { success: false, response: data, error: "401 Unauthorized", statusCode: 401 };
    if (res.status === 429 || (res.status >= 500 && res.status < 600))
      return { success: false, response: data, error: `${res.status} — retryable error`, statusCode: res.status };
    if (res.status === 400 || res.status === 403 || res.status === 404)
      return { success: false, response: data, error: `${res.status} — permanent error: ${data.detail || data.title || ""}`, statusCode: res.status };

    if (data.data && data.data.retweeted === true) return { success: true, response: data };
    return { success: false, response: data, error: "Retweet confirmation failed: retweeted !== true", statusCode: res.status };
  } catch (err) {
    return { success: false, response: null, error: err.message };
  }
}

async function executeLike(
  accessToken: string,
  xUserId: string,
  tweetId: string
): Promise<{ success: boolean; response: unknown; error?: string; statusCode?: number }> {
  try {
    console.log(`[X API] Like: user=${xUserId}, tweet=${tweetId}`);
    const res = await fetch(`https://api.twitter.com/2/users/${xUserId}/likes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tweet_id: tweetId }),
    });
    const data = await res.json();

    if (res.status === 401) return { success: false, response: data, error: "401 Unauthorized", statusCode: 401 };
    if (res.status === 429 || (res.status >= 500 && res.status < 600))
      return { success: false, response: data, error: `${res.status} — retryable error`, statusCode: res.status };
    if (res.status === 400 || res.status === 403 || res.status === 404)
      return { success: false, response: data, error: `${res.status} — permanent error: ${data.detail || data.title || ""}`, statusCode: res.status };

    if (data.data && data.data.liked === true) return { success: true, response: data };
    return { success: false, response: data, error: "Like confirmation failed: liked !== true", statusCode: res.status };
  } catch (err) {
    return { success: false, response: null, error: err.message };
  }
}

async function executeBookmark(
  accessToken: string,
  xUserId: string,
  tweetId: string
): Promise<{ success: boolean; response: unknown; error?: string; statusCode?: number }> {
  try {
    console.log(`[X API] Bookmark: user=${xUserId}, tweet=${tweetId}`);
    const res = await fetch(`https://api.twitter.com/2/users/${xUserId}/bookmarks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tweet_id: tweetId }),
    });
    const data = await res.json();

    if (res.status === 401) return { success: false, response: data, error: "401 Unauthorized", statusCode: 401 };
    if (res.status === 429 || (res.status >= 500 && res.status < 600))
      return { success: false, response: data, error: `${res.status} — retryable error`, statusCode: res.status };
    if (res.status === 400 || res.status === 403 || res.status === 404)
      return { success: false, response: data, error: `${res.status} — permanent error: ${data.detail || data.title || ""}`, statusCode: res.status };

    if (data.data && data.data.bookmarked === true) return { success: true, response: data };
    return { success: false, response: data, error: "Bookmark confirmation failed: bookmarked !== true", statusCode: res.status };
  } catch (err) {
    return { success: false, response: null, error: err.message };
  }
}

async function executeReply(
  accessToken: string,
  inReplyToTweetId: string,
  replyText: string
): Promise<{ success: boolean; response: unknown; error?: string; statusCode?: number }> {
  try {
    console.log(`[X API] Reply: in_reply_to=${inReplyToTweetId}`);
    const res = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: replyText,
        reply: { in_reply_to_tweet_id: inReplyToTweetId },
      }),
    });
    const data = await res.json();

    if (res.status === 401) return { success: false, response: data, error: "401 Unauthorized", statusCode: 401 };
    if (res.status === 429 || (res.status >= 500 && res.status < 600))
      return { success: false, response: data, error: `${res.status} — retryable error`, statusCode: res.status };
    if (res.status === 400 || res.status === 403 || res.status === 404)
      return { success: false, response: data, error: `${res.status} — permanent error: ${data.detail || data.title || ""}`, statusCode: res.status };

    if (data.data && data.data.id) return { success: true, response: data };
    return { success: false, response: data, error: "Reply failed: no tweet id returned", statusCode: res.status };
  } catch (err) {
    return { success: false, response: null, error: err.message };
  }
}

// ============================================================
// Token refresh
// ============================================================

async function refreshXToken(
  refreshToken: string
): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number; error?: string }> {
  try {
    const res = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + btoa(clientId + ":" + clientSecret),
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error_description || data.error || "Token refresh failed" };
    return { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in };
  } catch (err) {
    return { error: err.message };
  }
}

// ============================================================
// Job failure handler with retry logic
// ============================================================

async function handleJobFailure(job: ClaimedJob, account: XAccount | null, errorMessage: string) {
  const isRetryable = errorMessage.includes("429") || errorMessage.includes("5") || errorMessage.includes("retryable");
  const maxRetries = 3;

  if (isRetryable && job.retry_count < maxRetries) {
    // Backoff: 1 min, 2 min, 4 min
    const backoffSeconds = Math.pow(2, job.retry_count) * 60;
    const newScheduledFor = new Date(Date.now() + backoffSeconds * 1000).toISOString();
    console.log(`[RETRY] Job ${job.id} retry ${job.retry_count + 1}/${maxRetries}, scheduled for ${newScheduledFor}`);

    await supabase
      .from("action_jobs")
      .update({
        status: "pending",
        scheduled_for: newScheduledFor,
        retry_count: job.retry_count + 1,
        error_message: errorMessage,
        started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  } else {
    await markJobFailed(job, errorMessage);
    if (errorMessage.includes("401") && account) {
      await markAccountError(account, "Unauthorized — token invalid");
    }
  }

  await logActivity(job.user_id, "job_failed",
    `${job.action_type} job failed: ${errorMessage}`,
    { job_id: job.id, action_type: job.action_type, retry_count: job.retry_count }
  );
}

async function markJobFailed(job: ClaimedJob, errorMessage: string) {
  await supabase
    .from("action_jobs")
    .update({
      status: "failed",
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}

async function markAccountError(account: XAccount, errorMessage: string) {
  await supabase
    .from("x_accounts")
    .update({ status: "error", last_error: errorMessage, updated_at: new Date().toISOString() })
    .eq("id", account.id);
}

async function logActivity(userId: string, eventType: string, message: string, metadata?: Record<string, unknown>) {
  await supabase.from("activity_logs").insert({
    user_id: userId,
    event_type: eventType,
    message,
    metadata: metadata || null,
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
