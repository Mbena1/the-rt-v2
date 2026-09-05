import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const clientId = Deno.env.get("X_CLIENT_ID")!;
const clientSecret = Deno.env.get("X_CLIENT_SECRET")!;

const defaultRedirectUri =
  Deno.env.get("X_OAUTH_REDIRECT_URI") ||
  `${supabaseUrl}/functions/v1/oauth-callback`;

const frontendUrl =
  Deno.env.get("FRONTEND_URL") ||
  "https://the-rt-v2.netlify.app";

const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  console.log("[OAUTH] Callback received");

  try {
    if (!clientId || !clientSecret) {
      console.error("[OAUTH] X_CLIENT_ID or X_CLIENT_SECRET missing");

      return redirectToFrontend(
        "/x-accounts?oauth_error=" +
          encodeURIComponent("X OAuth server configuration is incomplete")
      );
    }

    const url = new URL(req.url);

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError) {
      const errDesc =
        url.searchParams.get("error_description") ||
        "OAuth denied by user";

      console.error("[OAUTH] X returned error:", oauthError, errDesc);

      return redirectToFrontend(
        "/x-accounts?oauth_error=" +
          encodeURIComponent(errDesc)
      );
    }

    if (!code || !state) {
      console.error("[OAUTH] Missing code or state");

      return redirectToFrontend(
        "/x-accounts?oauth_error=" +
          encodeURIComponent("Missing OAuth code or state")
      );
    }

    console.log("[OAUTH] OAuth state received");

    // ------------------------------------------------------------------
    // Retrieve the temporary PKCE state.
    // ------------------------------------------------------------------

    const { data: oauthState, error: stateError } = await supabase
      .from("x_oauth_states")
      .select(
        "id, user_id, state, code_verifier, redirect_uri, expires_at"
      )
      .eq("state", state)
      .maybeSingle();

    if (stateError) {
      console.error(
        "[OAUTH] Failed to retrieve OAuth state:",
        stateError.message
      );

      return redirectToFrontend(
        "/x-accounts?oauth_error=" +
          encodeURIComponent("Failed to retrieve OAuth session")
      );
    }

    if (!oauthState) {
      console.error("[OAUTH] Invalid or already-used OAuth state");

      return redirectToFrontend(
        "/x-accounts?oauth_error=" +
          encodeURIComponent("Invalid or expired OAuth state")
      );
    }

    // ------------------------------------------------------------------
    // Check expiration.
    // ------------------------------------------------------------------

    if (
      !oauthState.expires_at ||
      new Date(oauthState.expires_at).getTime() < Date.now()
    ) {
      console.error("[OAUTH] OAuth state expired");

      await supabase
        .from("x_oauth_states")
        .delete()
        .eq("id", oauthState.id);

      return redirectToFrontend(
        "/x-accounts?oauth_error=" +
          encodeURIComponent("OAuth session expired. Please try again.")
      );
    }

    const userId = oauthState.user_id;

    const redirectUri =
      oauthState.redirect_uri || defaultRedirectUri;

    console.log(`[OAUTH] Processing OAuth for user ${userId}`);
    console.log(`[OAUTH] Redirect URI: ${redirectUri}`);

    // ------------------------------------------------------------------
    // Exchange authorization code for OAuth tokens.
    // ------------------------------------------------------------------

    console.log("[OAUTH] Exchanging authorization code");

    const basicAuth = btoa(
      `${clientId}:${clientSecret}`
    );

    const tokenRes = await fetch(
      "https://api.x.com/2/oauth2/token",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },

        body: new URLSearchParams({
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code_verifier: oauthState.code_verifier,
        }),
      }
    );

    const tokenBody = await tokenRes.text();

    if (!tokenRes.ok) {
      console.error(
        `[OAUTH] Token exchange failed (${tokenRes.status}):`,
        tokenBody
      );

      await supabase
        .from("x_oauth_states")
        .delete()
        .eq("id", oauthState.id);

      return redirectToFrontend(
        "/x-accounts?oauth_error=" +
          encodeURIComponent(
            "X token exchange failed"
          )
      );
    }

    let tokens: any;

    try {
      tokens = JSON.parse(tokenBody);
    } catch {
      console.error(
        "[OAUTH] Invalid token response from X"
      );

      await supabase
        .from("x_oauth_states")
        .delete()
        .eq("id", oauthState.id);

      return redirectToFrontend(
        "/x-accounts?oauth_error=" +
          encodeURIComponent(
            "Invalid token response from X"
          )
      );
    }

    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;

    const expiresIn =
      Number(tokens.expires_in) || 7200;

    const tokenExpiresAt = new Date(
      Date.now() + expiresIn * 1000
    ).toISOString();

    if (!accessToken) {
      console.error(
        "[OAUTH] X did not return an access token"
      );

      await supabase
        .from("x_oauth_states")
        .delete()
        .eq("id", oauthState.id);

      return redirectToFrontend(
        "/x-accounts?oauth_error=" +
          encodeURIComponent(
            "X did not return an access token"
          )
      );
    }

    // Never log access_token or refresh_token.

    console.log(
      "[OAUTH] Token exchange successful"
    );

    if (tokens.scope) {
      console.log(
        "[OAUTH] Token scopes:",
        tokens.scope
      );
    }

    console.log(
      "[OAUTH] Token type:",
      tokens.token_type || "unknown"
    );

    console.log(
      "[OAUTH] Expires in:",
      expiresIn
    );

    // ------------------------------------------------------------------
    // Fetch authenticated X user.
    // ------------------------------------------------------------------

    console.log(
      "[OAUTH] Fetching authenticated X user"
    );

    const userRes = await fetch(
      "https://api.x.com/2/users/me?user.fields=profile_image_url,name,username",
      {
        method: "GET",

        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const userBody = await userRes.text();

    if (!userRes.ok) {
      console.error(
        `[OAUTH] Failed to fetch X user (${userRes.status}):`,
        userBody
      );

      await supabase
        .from("x_oauth_states")
        .delete()
        .eq("id", oauthState.id);

      return redirectToFrontend(
        "/x-accounts?oauth_error=" +
          encodeURIComponent(
            "Failed to fetch X user information"
          )
      );
    }

    let userData: any;

    try {
      userData = JSON.parse(userBody);
    } catch {
      console.error(
        "[OAUTH] Invalid X user response"
      );

      await supabase
        .from("x_oauth_states")
        .delete()
        .eq("id", oauthState.id);

      return redirectToFrontend(
        "/x-accounts?oauth_error=" +
          encodeURIComponent(
            "Invalid X user response"
          )
      );
    }

    const xUser = userData?.data;

    if (!xUser?.id || !xUser?.username) {
      console.error(
        "[OAUTH] Invalid authenticated X user data"
      );

      await supabase
        .from("x_oauth_states")
        .delete()
        .eq("id", oauthState.id);

      return redirectToFrontend(
        "/x-accounts?oauth_error=" +
          encodeURIComponent(
            "Invalid X account information"
          )
      );
    }

    console.log(
      `[OAUTH] X user: @${xUser.username} (${xUser.id})`
    );

    // ------------------------------------------------------------------
    // Store / update public X account information.
    // ------------------------------------------------------------------

    const { data: existingAccount } =
      await supabase
        .from("x_accounts")
        .select("id")
        .eq("user_id", userId)
        .eq("x_user_id", xUser.id)
        .maybeSingle();

    let xAccountId: string;

    if (existingAccount?.id) {
      xAccountId = existingAccount.id;

      const { error: updateError } =
        await supabase
          .from("x_accounts")
          .update({
            username: xUser.username,
            display_name:
              xUser.name || xUser.username,
            profile_image_url:
              xUser.profile_image_url || null,
            status: "active",
            token_expires_at: tokenExpiresAt,
            last_error: null,
            updated_at:
              new Date().toISOString(),
          })
          .eq("id", xAccountId)
          .eq("user_id", userId);

      if (updateError) {
        console.error(
          "[OAUTH] Failed to update X account:",
          updateError.message
        );

        throw new Error(
          "Failed to update X account"
        );
      }
    } else {
      const { data: newAccount, error: insertError } =
        await supabase
          .from("x_accounts")
          .insert({
            user_id: userId,
            x_user_id: xUser.id,
            username: xUser.username,
            display_name:
              xUser.name || xUser.username,
            profile_image_url:
              xUser.profile_image_url || null,
            status: "active",
            token_expires_at: tokenExpiresAt,
            last_error: null,
          })
          .select("id")
          .single();

      if (insertError || !newAccount) {
        console.error(
          "[OAUTH] Failed to create X account:",
          insertError?.message
        );

        throw new Error(
          "Failed to create X account"
        );
      }

      xAccountId = newAccount.id;
    }

    console.log(
      `[OAUTH] X account stored: ${xAccountId}`
    );

    // ------------------------------------------------------------------
    // Store OAuth tokens separately.
    // ------------------------------------------------------------------

    const { error: deleteTokenError } =
      await supabase
        .from("x_account_tokens")
        .delete()
        .eq("x_account_id", xAccountId);

    if (deleteTokenError) {
      console.error(
        "[OAUTH] Failed to remove previous token:",
        deleteTokenError.message
      );
    }

    const { error: tokenInsertError } =
      await supabase
        .from("x_account_tokens")
        .insert({
          x_account_id: xAccountId,
          access_token: accessToken,
          refresh_token: refreshToken || null,
          token_expires_at: tokenExpiresAt,
        });

    if (tokenInsertError) {
      console.error(
        "[OAUTH] Failed to store OAuth tokens:",
        tokenInsertError.message
      );

      await supabase
        .from("x_accounts")
        .update({
          status: "error",
          last_error:
            "Failed to store OAuth tokens",
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", xAccountId);

      await supabase
        .from("x_oauth_states")
        .delete()
        .eq("id", oauthState.id);

      return redirectToFrontend(
        "/x-accounts?oauth_error=" +
          encodeURIComponent(
            "Failed to store OAuth tokens"
          )
      );
    }

    console.log(
      "[OAUTH] OAuth tokens stored successfully"
    );

    // ------------------------------------------------------------------
    // Activity log.
    // ------------------------------------------------------------------

    await supabase
      .from("activity_logs")
      .insert({
        user_id: userId,
        event_type: "x_account_connected",
        message:
          `X account @${xUser.username} connected successfully`,
        metadata: {
          x_user_id: xUser.id,
          username: xUser.username,
        },
      });

    // ------------------------------------------------------------------
    // Delete the temporary OAuth state.
    // ------------------------------------------------------------------

    await supabase
      .from("x_oauth_states")
      .delete()
      .eq("id", oauthState.id);

    console.log(
      "[OAUTH] OAuth state deleted"
    );

    console.log(
      "[OAUTH] OAuth flow completed successfully"
    );

    return redirectToFrontend(
      "/x-accounts?oauth_success=true"
    );
  } catch (err) {
    console.error(
      "[OAUTH] Callback error:",
      err instanceof Error
        ? err.message
        : String(err)
    );

    return redirectToFrontend(
      "/x-accounts?oauth_error=" +
        encodeURIComponent(
          "Internal OAuth server error"
        )
    );
  }
});

function redirectToFrontend(path: string): Response {
  const cleanFrontendUrl =
    frontendUrl.replace(/\/+$/, "");

  return new Response(null, {
    status: 302,

    headers: {
      ...corsHeaders,

      Location:
        cleanFrontendUrl + path,
    },
  });
}

