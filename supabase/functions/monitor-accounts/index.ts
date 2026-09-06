import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const bearerToken = Deno.env.get("X_BEARER_TOKEN")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface MonitoredAccount {
  id: string;
  user_id: string;
  x_user_id: string;
  username: string;
  status: string;
  last_seen_post_id: string | null;
}

interface XPost {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  console.log("[MONITOR] Starting monitoring cycle");

  try {
    // 1. Fetch all monitored accounts with status = monitoring
    const { data: monitoredAccounts, error: maError } = await supabase
      .from("monitored_accounts")
      .select("id, user_id, x_user_id, username, status, last_seen_post_id")
      .eq("status", "monitoring");

    if (maError) {
      console.error("[MONITOR] Failed to fetch monitored accounts:", maError.message);
      throw maError;
    }

    if (!monitoredAccounts || monitoredAccounts.length === 0) {
      console.log("[MONITOR] No monitored accounts to process");
      return jsonResponse({ message: "No monitored accounts", processed: 0 });
    }

    console.log(`[MONITOR] Found ${monitoredAccounts.length} monitored accounts`);

    let totalProcessed = 0;
    let totalNewTweets = 0;
    let totalJobsCreated = 0;
    let totalErrors = 0;

    for (const account of monitoredAccounts as MonitoredAccount[]) {
      console.log(`[MONITOR] Processing @${account.username} (user_id: ${account.user_id})`);

      try {
        // 2. Check automation_settings for this user
        const { data: settings, error: settingsError } = await supabase
          .from("automation_settings")
          .select("enabled, monitoring_enabled")
          .eq("user_id", account.user_id)
          .maybeSingle();

        if (settingsError) {
          console.error(`[SETTINGS] Error fetching settings for user ${account.user_id}:`, settingsError.message);
          totalErrors++;
          continue;
        }

        if (!settings) {
          console.log(`[SETTINGS] No settings found for user ${account.user_id}, skipping`);
          continue;
        }

        if (!settings.enabled) {
          console.log(`[SETTINGS] Automation disabled for user ${account.user_id}, skipping @${account.username}`);
          continue;
        }

        if (!settings.monitoring_enabled) {
          console.log(`[SETTINGS] Monitoring disabled for user ${account.user_id}, skipping @${account.username}`);
          continue;
        }

        console.log(`[SETTINGS] Settings OK for @${account.username}: enabled=${settings.enabled}, monitoring=${settings.monitoring_enabled}`);

        // 3. Fetch recent tweets from X API
        const tweetsUrl = new URL(`https://api.twitter.com/2/users/${account.x_user_id}/tweets`);
        tweetsUrl.searchParams.set("max_results", "10");
        tweetsUrl.searchParams.set("tweet.fields", "created_at,author_id,referenced_tweets");
        tweetsUrl.searchParams.set("exclude", "retweets,replies");

        console.log(`[X API] Fetching tweets for @${account.username} (x_user_id: ${account.x_user_id})`);

        const tweetsRes = await fetch(tweetsUrl, {
          headers: { Authorization: `Bearer ${bearerToken}` },
        });

        if (!tweetsRes.ok) {
          const errBody = await tweetsRes.text();
          console.error(`[X API] Error for @${account.username}: ${tweetsRes.status} - ${errBody}`);
          await logActivity(account.user_id, "monitor_error", `X API error for @${account.username}: ${errBody}`);
          await supabase
            .from("monitored_accounts")
            .update({ status: "error", last_error: `X API error: ${tweetsRes.status}`, updated_at: new Date().toISOString() })
            .eq("id", account.id);
          totalErrors++;
          continue;
        }

        const tweetsData = await tweetsRes.json();
        const posts: XPost[] = tweetsData.data || [];

        console.log(`[X API] Received ${posts.length} posts for @${account.username}`);

        if (posts.length === 0) {
          console.log(`[POST] No posts found for @${account.username}, updating last_checked_at`);
          await supabase
            .from("monitored_accounts")
            .update({ last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", account.id);
          totalProcessed++;
          continue;
        }

        // 4. Check each post individually against the database
        let newestPostId: string | null = null;
        let newestCreatedAt: Date | null = null;
        let newTweetsForThisAccount = 0;

        for (const post of posts) {
          console.log(`[TWEET] Checking post ${post.id} for @${account.username}`);

          // Check if tweet already exists in database
          const { data: existingTweet, error: checkError } = await supabase
            .from("tweets")
            .select("id")
            .eq("monitored_account_id", account.id)
            .eq("x_post_id", post.id)
            .maybeSingle();

          if (checkError) {
            console.error(`[TWEET] Error checking existing tweet ${post.id}:`, checkError.message);
            continue;
          }

          if (existingTweet) {
            console.log(`[TWEET] Post ${post.id} already exists in database, skipping`);
            continue;
          }

          // 5. Insert new tweet
          const postUrl = `https://x.com/${account.username}/status/${post.id}`;
          console.log(`[TWEET] Inserting new tweet ${post.id} for @${account.username}`);

          const { data: newTweet, error: tweetError } = await supabase
            .from("tweets")
            .insert({
              user_id: account.user_id,
              monitored_account_id: account.id,
              x_post_id: post.id,
              author_username: account.username,
              text: post.text,
              published_at: post.created_at,
              post_url: postUrl,
            })
            .select("id")
            .single();

          if (tweetError) {
            // 23505 = unique constraint violation — tweet already inserted by concurrent run
            if (tweetError.code === "23505") {
              console.log(`[TWEET] Post ${post.id} was already inserted (unique constraint), skipping`);
              continue;
            }
            console.error(`[TWEET] Failed to insert tweet ${post.id}:`, tweetError.message);
            continue;
          }

          console.log(`[TWEET] Tweet ${post.id} inserted with id ${newTweet.id}`);
          totalNewTweets++;
          newTweetsForThisAccount++;

          // 6. Create action jobs for this tweet via RPC
          console.log(`[RULES] Creating action jobs for tweet ${newTweet.id}`);
          const { data: jobsCreated, error: jobsError } = await supabase.rpc(
            "create_action_jobs_for_tweet",
            { p_tweet_id: newTweet.id, p_user_id: account.user_id }
          );

          if (jobsError) {
            console.error(`[RULES] Failed to create jobs for tweet ${newTweet.id}:`, jobsError.message);
          } else {
            console.log(`[JOBS] Created ${jobsCreated} jobs for tweet ${newTweet.id}`);
            totalJobsCreated += jobsCreated || 0;
          }

          // Track newest post by created_at date
          const postDate = new Date(post.created_at);
          if (!newestCreatedAt || postDate > newestCreatedAt) {
            newestCreatedAt = postDate;
            newestPostId = post.id;
          }
        }

        // 7. Update last_seen_post_id with the chronologically most recent post
        // Don't just use posts[0] — verify by date
        if (newestPostId) {
          console.log(`[MONITOR] Updating last_seen_post_id to ${newestPostId} for @${account.username}`);
        }

        await supabase
          .from("monitored_accounts")
          .update({
            last_seen_post_id: newestPostId || account.last_seen_post_id,
            last_checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", account.id);

        console.log(`[MONITOR] Processed @${account.username}: ${newTweetsForThisAccount} new tweets`);
        totalProcessed++;
      } catch (err) {
        // Log error but continue with next account — never stop the whole loop
        console.error(`[MONITOR] Error processing @${account.username}:`, err.message);
        await logActivity(account.user_id, "monitor_error", `Error monitoring @${account.username}: ${err.message}`);
        await supabase
          .from("monitored_accounts")
          .update({ last_error: err.message, updated_at: new Date().toISOString() })
          .eq("id", account.id);
        totalErrors++;
      }
    }

    console.log(`[MONITOR] Cycle complete: processed=${totalProcessed}, newTweets=${totalNewTweets}, jobsCreated=${totalJobsCreated}, errors=${totalErrors}`);

    return jsonResponse({
      message: "Monitoring complete",
      processed: totalProcessed,
      newTweets: totalNewTweets,
      jobsCreated: totalJobsCreated,
      errors: totalErrors,
    });
  } catch (err) {
    console.error("[MONITOR] Fatal error:", err.message);
    return jsonResponse({ error: err.message }, 500);
  }
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function logActivity(userId: string, eventType: string, message: string) {
  await supabase.from("activity_logs").insert({
    user_id: userId,
    event_type: eventType,
    message,
  });
}
