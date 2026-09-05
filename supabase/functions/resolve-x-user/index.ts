import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const bearerToken = Deno.env.get("X_BEARER_TOKEN")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed" },
      405
    );
  }

  try {
    if (!bearerToken) {
      console.error("[RESOLVE] X_BEARER_TOKEN is missing");

      return jsonResponse(
        { error: "X API is not configured" },
        500
      );
    }

    const body = await req.json();
    const username = String(body.username || "")
      .trim()
      .replace(/^@/, "");

    if (!username) {
      return jsonResponse(
        { error: "Username is required" },
        400
      );
    }

    console.log(`[RESOLVE] Resolving @${username}`);

    const xUrl = new URL(
      `https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}`
    );

    xUrl.searchParams.set(
      "user.fields",
      "id,name,username,profile_image_url"
    );

    const xResponse = await fetch(xUrl.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    });

    const responseText = await xResponse.text();

    if (!xResponse.ok) {
      console.error(
        `[RESOLVE] X API error ${xResponse.status}:`,
        responseText
      );

      return jsonResponse(
        {
          error:
            xResponse.status === 404
              ? "X account not found"
              : "Failed to resolve X account",
        },
        xResponse.status
      );
    }

    const xData = JSON.parse(responseText);
    const xUser = xData.data;

    if (!xUser?.id) {
      console.error("[RESOLVE] X returned no user ID");

      return jsonResponse(
        { error: "X account not found" },
        404
      );
    }

    console.log(
      `[RESOLVE] Resolved @${xUser.username} -> ${xUser.id}`
    );

    return jsonResponse({
      id: xUser.id,
      username: xUser.username,
      name: xUser.name || xUser.username,
      profile_image_url: xUser.profile_image_url || null,
    });
  } catch (error) {
    console.error(
      "[RESOLVE] Unexpected error:",
      error instanceof Error ? error.message : String(error)
    );

    return jsonResponse(
      { error: "Internal server error" },
      500
    );
  }
});

function jsonResponse(
  data: unknown,
  status = 200
): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    }
  );
}