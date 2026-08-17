import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import {
  JwtAuthError,
  requireGatewayVerifiedRole,
  requireTelegramUserId,
} from "../_shared/jwt_auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-telegram-init-data",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Gateway verifies the JWT signature. Claims then supply the Telegram ID:
    // managed Auth stores it in app_metadata, not in the UUID `sub`.
    const payload = requireGatewayVerifiedRole(
      req.headers.get("Authorization"),
      "authenticated",
    );
    const telegramUserId = requireTelegramUserId(payload);

    // 2. Parse Request
    const { releaseId, prepare = true } = await req.json();
    if (!releaseId || typeof releaseId !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing releaseId parameter" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 3. Fetch Release Info
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: release, error: dbError } = await supabase
      .from("releases")
      .select("*")
      .eq("id", releaseId)
      .maybeSingle();

    if (dbError || !release) {
      return new Response(JSON.stringify({ error: "Release not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const miniAppUrl = Deno.env.get("MINI_APP_URL");

    if (!miniAppUrl) {
      return new Response(
        JSON.stringify({ error: "Sharing is not configured on the server" }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const sep = miniAppUrl.includes("?") ? "&" : "?";
    const deepLink = `${miniAppUrl}${sep}startapp=${
      encodeURIComponent(release.id)
    }`;

    // Older Telegram clients cannot call WebApp.shareMessage, but they can
    // still share the canonical Mini App deep-link returned by this endpoint.
    if (prepare === false) {
      return new Response(JSON.stringify({ deepLink }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      return new Response(
        JSON.stringify({ error: "Telegram sharing is not configured" }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const artist = (release.artist || "").trim() || "Артист";
    const name = (release.name || "").trim() || "Релиз";
    const img = release.img || "";
    const caption = `🎵 ${artist} — ${name}`;
    const replyMarkup = {
      inline_keyboard: [[{ text: "Открыть релиз", url: deepLink }]],
    };

    let result = {};
    if (img.startsWith("http://") || img.startsWith("https://")) {
      // Photo result
      result = {
        type: "photo",
        id: release.id,
        photo_url: img,
        thumbnail_url: img,
        title: name,
        description: artist,
        caption: caption,
        reply_markup: replyMarkup,
      };
    } else {
      // Text article result
      result = {
        type: "article",
        id: release.id,
        title: `${artist} — ${name}`,
        description: "Поделиться релизом из XXII SOUND",
        input_message_content: { message_text: caption },
        reply_markup: replyMarkup,
      };
    }

    const apiUrl =
      `https://api.telegram.org/bot${botToken}/savePreparedInlineMessage`;
    const tgPayload = {
      user_id: telegramUserId,
      result: result,
      allow_user_chats: true,
      allow_group_chats: true,
      allow_channel_chats: true,
    };

    const tgRes = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tgPayload),
      signal: AbortSignal.timeout(10_000),
    });

    const tgData = await tgRes.json();
    if (!tgRes.ok || !tgData.ok) {
      console.error("savePreparedInlineMessage failed:", tgData);
      return new Response(
        JSON.stringify({
          error: "Failed to prepare share message from Telegram Bot API",
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const preparedMessageId = tgData.result?.id;
    return new Response(JSON.stringify({ preparedMessageId, deepLink }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof JwtAuthError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("Error in share-message function:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
