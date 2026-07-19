import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v2.9/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-init-data",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const encoder = new TextEncoder();
    const { initData } = await req.json();
    if (!initData) {
      return new Response(JSON.stringify({ error: "Missing initData" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse initData
    const parsed = new URLSearchParams(initData);
    const rawUser = parsed.get("user");
    if (!rawUser) {
      return new Response(JSON.stringify({ error: "No user in initData" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let userData;
    try {
      userData = JSON.parse(rawUser);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid user payload" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.id;
    const username = userData.username || "";
    const firstName = userData.first_name || "";
    const cleanUsername = username.trim().toLowerCase().replace("@", "");

    // Verify Telegram Signature
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const devMode = Deno.env.get("DEV_MODE") === "true";

    if (!botToken) {
      if (!devMode) {
        return new Response(JSON.stringify({ error: "Server configuration error: TELEGRAM_BOT_TOKEN is not set" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.warn("DEV MODE: Telegram signature NOT verified (set TELEGRAM_BOT_TOKEN for production)");
    } else {
      const receivedHash = parsed.get("hash");
      if (!receivedHash) {
        return new Response(JSON.stringify({ error: "Missing hash in initData" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check date
      const rawAuthDate = parsed.get("auth_date");
      if (!rawAuthDate) {
        return new Response(JSON.stringify({ error: "Missing auth_date in initData" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const authDate = parseInt(rawAuthDate, 10);
      const now = Math.floor(Date.now() / 1000);
      const maxAge = parseInt(Deno.env.get("INIT_DATA_MAX_AGE") || "86400", 10);

      if (authDate > now + 60) {
        return new Response(JSON.stringify({ error: "auth_date is in the future" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (maxAge > 0 && (now - authDate) > maxAge) {
        return new Response(JSON.stringify({ error: "initData expired" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Calculate hash
      const checkPairs: string[] = [];
      const keys = Array.from(parsed.keys()).sort();
      for (const key of keys) {
        if (key === "hash") continue;
        checkPairs.push(`${key}=${parsed.get(key)}`);
      }
      const dataCheckString = checkPairs.join("\n");

      const hmacKeyData = encoder.encode("WebAppData");
      const key = await crypto.subtle.importKey(
        "raw",
        hmacKeyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const secretKeyBuf = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(botToken)
      );
      const secretKey = await crypto.subtle.importKey(
        "raw",
        secretKeyBuf,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const calculatedHashBuf = await crypto.subtle.sign(
        "HMAC",
        secretKey,
        encoder.encode(dataCheckString)
      );
      const calculatedHash = Array.from(new Uint8Array(calculatedHashBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      if (calculatedHash !== receivedHash) {
        return new Response(JSON.stringify({ error: "Invalid Telegram signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Check if user is blocked in database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: blockedUser, error: dbError } = await supabase
      .from("blocked_users")
      .select("username")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (dbError) {
      console.error("Database error checking blocked users:", dbError);
    }

    if (blockedUser) {
      return new Response(JSON.stringify({ error: "User is blocked" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Register/update user in notification subscribers (opt-in by default)
    const { error: subError } = await supabase
      .from("notification_subscribers")
      .upsert({
        user_id: userId,
        username: username,
        chat_id: userId,
      }, { onConflict: "user_id" });

    if (subError) {
      console.error("Database error registering subscriber:", subError);
    }


    // Check admin status in database
    const { data: adminRecord, error: adminError } = await supabase
      .from("admins")
      .select("username")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (adminError) {
      console.error("Database error checking admin status:", adminError);
    }
    const isAdmin = !!adminRecord;


    // Generate JWT signed with Supabase JWT Secret
    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (!jwtSecret) {
      return new Response(JSON.stringify({ error: "Missing SUPABASE_JWT_SECRET environment variable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const signingKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const displayName = username ? `@${username}` : (firstName || `user-${userId}`);

    const jwt = await create(
      { alg: "HS256", typ: "JWT" },
      {
        aud: "authenticated",
        role: "authenticated",
        sub: userId.toString(),
        exp: getNumericDate(60 * 60 * 24), // Valid for 24 hours
        app_metadata: {
          is_admin: isAdmin,
        },
        user_metadata: {
          username: username,
          display_name: displayName,
        },
      },
      signingKey
    );

    return new Response(
      JSON.stringify({
        token: jwt,
        user: {
          userId: userId,
          username: displayName,
          role: isAdmin ? "Администратор" : "Пользователь",
          isAdmin: isAdmin,
          isBlocked: false,
          isAuthenticated: true,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Error in auth function:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
