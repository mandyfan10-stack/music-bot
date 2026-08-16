import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
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
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({
        error: "Supabase authentication is not configured",
      }, 500);
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const [{ data: blockedUser, error: blockedError }, {
      data: adminRecord,
      error: adminError,
    }] = await Promise.all([
      supabase.from("blocked_users").select("user_id").eq("user_id", userId)
        .maybeSingle(),
      supabase.from("admins").select("user_id").eq("user_id", userId)
        .maybeSingle(),
    ]);
    if (blockedError) {
      console.error("Blocked-user lookup failed:", blockedError);
      return jsonResponse({ error: "Could not verify account status" }, 500);
    }
    if (blockedUser) return jsonResponse({ error: "User is blocked" }, 403);

    if (adminError) {
      console.error("Admin lookup failed:", adminError);
      return jsonResponse({ error: "Could not verify account role" }, 500);
    }
    const isAdmin = Boolean(adminRecord);

    // Mint a normal Supabase Auth session rather than hand-signing a JWT.
    // The hosted project uses managed signing keys, so Edge Functions do not
    // have access to the active private key. Admin-generated magic links let
    // the server exchange verified Telegram identity for a standard session
    // without sending an email or exposing a reusable password.
    const email = `telegram-${userId}@telegram.invalid`;
    const appMetadata = {
      telegram_user_id: String(userId),
      username: cleanUsername,
      display_name: displayName,
      is_admin: isAdmin,
    };
    const { data: linkData, error: linkError } = await supabase.auth.admin
      .generateLink({ type: "magiclink", email });
    const authUserId = linkData?.user?.id;
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkError || !authUserId || !tokenHash) {
      console.error("Auth link generation failed:", linkError);
      return jsonResponse({ error: "Could not prepare user session" }, 500);
    }

    const currentMetadata = linkData.user?.app_metadata || {};
    const metadataChanged = String(currentMetadata.telegram_user_id || "") !==
        appMetadata.telegram_user_id ||
      String(currentMetadata.username || "") !== appMetadata.username ||
      String(currentMetadata.display_name || "") !== appMetadata.display_name ||
      Boolean(currentMetadata.is_admin) !== appMetadata.is_admin;
    if (metadataChanged) {
      const { error: updateUserError } = await supabase.auth.admin
        .updateUserById(
          authUserId,
          { app_metadata: { ...currentMetadata, ...appMetadata } },
        );
      if (updateUserError) {
        console.error("Auth metadata update failed:", updateUserError);
        return jsonResponse({ error: "Could not update user session" }, 500);
      }
    }

    const sessionClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { data: sessionData, error: verifyError } = await sessionClient.auth
      .verifyOtp({ token_hash: tokenHash, type: "email" });
    const accessToken = sessionData.session?.access_token;
    if (verifyError || !accessToken) {
      console.error("Auth token exchange failed:", verifyError);
      return jsonResponse({ error: "Could not exchange user session" }, 500);
    }

    // Subscriber RLS and its server-fields trigger require the Telegram user's
    // session. Keep privileged role lookups on the service client above, then
    // run this account-owned write with the freshly issued user token.
    const userSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      accessToken: async () => accessToken,
    });
    const { error: subscriberError } = await userSupabase
      .from("notification_subscribers")
      .upsert({
        user_id: userId,
        username: cleanUsername,
        chat_id: userId,
      }, { onConflict: "user_id" });
    if (subscriberError) {
      console.error("Subscriber registration failed:", subscriberError);
      return jsonResponse({ error: "Could not validate user session" }, 500);
    }

    return jsonResponse({
      token: accessToken,
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
