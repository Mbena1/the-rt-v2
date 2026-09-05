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
const redirectUri = Deno.env.get("X_OAUTH_REDIRECT_URI")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  console.log("[OAUTH] Callback received");

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      const errDesc = url.searchParams.get("error_description") || "OAuth denied by user";
      console.error("[OAUTH] OAuth error:", errDesc);
      return redirectToFrontend("/x-accounts?oauth_error=" + encodeURIComponent(errDesc));
    }

    if (!code || !state) {
      console.error("[OAUTH] Missing code or state");
      return redirectToFrontend("/x-accounts?oauth_error=" + encodeURIComponent("Missing code or state parameter"));
    }

    const userId = state;
    console.log(`[OAUTH] Processing OAuth for user ${userId}`);

    // Exchange code for tokens
    console.log("[OAUTH] Exchanging code for tokens");
    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + btoa(clientId + ":" + clientSecret),
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: Deno.env.get("X_CODE_VERIFIER_" + userId) || "",
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error("[OAUTH] Token exchange failed:", errBody);
      return redirectToFrontend("/x-accounts?oauth_error=" + encodeURIComponent("Token exchange failed"));
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresIn = tokens.expires_in || 7200;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    console.log("[OAUTH] Tokens received, fetching user info");

    // Fetch user info from X
    const userRes = await fetch("https://api.twitter.com/2/users/me", {
      headers: { Authorization: "Bearer " + accessToken },
    });

    if (!userRes.ok) {
      console.error("[OAUTH] Failed to fetch X user:", await userRes.text());
      return redirectToFrontend("/x-accounts?oauth_error=" + encodeURIComponent("Failed to fetch X user info"));
    }

    const userData = await userRes.json();
    const xUser = userData.data;

    if (!xUser || !xUser.id) {
      console.error("[OAUTH] Invalid X user data");
      return redirectToFrontend("/x-accounts?oauth_error=" + encodeURIComponent("Invalid X user data"));
    }

    console.log(`[OAUTH] X user: @${xUser.username} (id: ${xUser.id})`);

    // Upsert the X account (public info — no tokens here)
    const { data: xAccount, error: upsertError } = await supabase
      .from("x_accounts")
      .upsert({
        user_id: userId,
        x_user_id: xUser.id,
        username: xUser.username,
        display_name: xUser.name || xUser.username,
        profile_image_url: xUser.profile_image_url || null,
        status: "active",
        token_expires_at: tokenExpiresAt,
        last_error: null,
      }, {
        onConflict: "user_id,x_user_id",
      })
      .select("id")
      .single();

    if (upsertError || !xAccount) {
      console.error("[OAUTH] Failed to store X account:", upsertError?.message);
      return redirectToFrontend("/x-accounts?oauth_error=" + encodeURIComponent("Failed to store account"));
    }

    console.log(`[OAUTH] X account stored with id ${xAccount.id}`);

    // Store tokens in x_account_tokens (separate table)
    // Delete existing token row first, then insert new one
    await supabase
      .from("x_account_tokens")
      .delete()
      .eq("x_account_id", xAccount.id);

    const { error: tokenInsertError } = await supabase
      .from("x_account_tokens")
      .insert({
        x_account_id: xAccount.id,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: tokenExpiresAt,
      });

    if (tokenInsertError) {
      console.error("[OAUTH] Failed to store tokens:", tokenInsertError.message);
      // Account is created but tokens failed — mark as error
      await supabase
        .from("x_accounts")
        .update({ status: "error", last_error: "Failed to store OAuth tokens", updated_at: new Date().toISOString() })
        .eq("id", xAccount.id);
      return redirectToFrontend("/x-accounts?oauth_error=" + encodeURIComponent("Failed to store OAuth tokens"));
    }

    console.log("[OAUTH] Tokens stored successfully");

    // Log activity
    await supabase.from("activity_logs").insert({
      user_id: userId,
      event_type: "x_account_connected",
      message: `X account @${xUser.username} connected successfully`,
      metadata: { x_user_id: xUser.id, username: xUser.username },
    });

    console.log("[OAUTH] Redirecting to frontend with success");
    return redirectToFrontend("/x-accounts?oauth_success=true");
  } catch (err) {
    console.error("[OAUTH] Callback error:", err.message);
    return redirectToFrontend("/x-accounts?oauth_error=" + encodeURIComponent("Internal server error"));
  }
});

function redirectToFrontend(path: string): Response {
  const frontendUrl = Deno.env.get("FRONTEND_URL") || "http://localhost:5173";
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: frontendUrl + path,
    },
  });
}
