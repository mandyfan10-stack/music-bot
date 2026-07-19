import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { create, getNumericDate } from "https://deno.land/x/djwt@v2.9/mod.ts";
import {
  parseTelegramUser,
  TelegramAuthError,
  verifyTelegramInitData,
} from "../_shared/telegram_auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-telegram-init-data",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { initData } = await req.json();
    if (!initData || typeof initData !== "string") {
      return jsonResponse({ error: "Missing initData" }, 400);
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const devMode = Deno.env.get("DEV_MODE") === "true";
    const maxAge = Number(Deno.env.get("INIT_DATA_MAX_AGE") || "86400");
    let telegramUser;
    try {
      if (botToken) {
        telegramUser = await verifyTelegramInitData(initData, botToken, maxAge);
      } else if (devMode) {
        console.warn("DEV MODE: Telegram signature verification is disabled");
        telegramUser = parseTelegramUser(initData);
      } else {
        return jsonResponse(
          { error: "TELEGRAM_BOT_TOKEN is not configured" },
          500,
        );
      }
    } catch (error) {
      if (error instanceof TelegramAuthError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      throw error;
    }

    const userId = telegramUser.id;
    const username = String(telegramUser.username || "").trim();
    const cleanUsername = username.toLowerCase().replace(/^@/, "");
    const firstName = String(telegramUser.first_name || "").trim();
    const displayName = username
      ? `@${username}`
      : (firstName || `user-${userId}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (!supabaseUrl || !supabaseServiceKey || !jwtSecret) {
      return jsonResponse({
        error: "Supabase authentication is not configured",
      }, 500);
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: blockedUser, error: blockedError } = await supabase
      .from("blocked_users")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (blockedError) {
      console.error("Blocked-user lookup failed:", blockedError);
      return jsonResponse({ error: "Could not verify account status" }, 500);
    }
    if (blockedUser) return jsonResponse({ error: "User is blocked" }, 403);

    const { data: adminRecord, error: adminError } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (adminError) {
      console.error("Admin lookup failed:", adminError);
      return jsonResponse({ error: "Could not verify account role" }, 500);
    }
    const isAdmin = Boolean(adminRecord);

    const { error: subscriberError } = await supabase
      .from("notification_subscribers")
      .upsert({
        user_id: userId,
        username: cleanUsername,
        chat_id: userId,
      }, { onConflict: "user_id" });
    if (subscriberError) {
      console.error("Subscriber registration failed:", subscriberError);
    }

    const signingKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const jwt = await create(
      { alg: "HS256", typ: "JWT" },
      {
        iss: supabaseUrl,
        aud: "authenticated",
        role: "authenticated",
        sub: String(userId),
        iat: getNumericDate(0),
        exp: getNumericDate(60 * 60 * 24),
        app_metadata: { is_admin: isAdmin },
        user_metadata: {
          username: cleanUsername,
          display_name: displayName,
        },
      },
      signingKey,
    );

    return jsonResponse({
      token: jwt,
      user: {
        userId,
        username: displayName,
        role: isAdmin ? "Администратор" : "Пользователь",
        isAdmin,
        isBlocked: false,
        isAuthenticated: true,
      },
    }, 200);
  } catch (error) {
    console.error("Error in auth function:", error);
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 500);
  }
});
