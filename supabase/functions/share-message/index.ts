import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify } from "https://deno.land/x/djwt@v2.9/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-init-data",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Verify User Session
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.substring(7);
    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (!jwtSecret) {
      return new Response(JSON.stringify({ error: "Missing SUPABASE_JWT_SECRET variable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const signingKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    let payload;
    try {
      payload = await verify(token, signingKey);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid token signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const telegramUserId = payload.sub; // User's Telegram ID
    if (!telegramUserId) {
      return new Response(JSON.stringify({ error: "Missing user ID in token claims" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Parse Request
    const { releaseId } = await req.json();
    if (!releaseId) {
      return new Response(JSON.stringify({ error: "Missing releaseId parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const miniAppUrl = Deno.env.get("MINI_APP_URL");

    if (!botToken || !miniAppUrl) {
      return new Response(JSON.stringify({ error: "Sharing is not configured on the server" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sep = miniAppUrl.includes("?") ? "&" : "?";
    const deepLink = `${miniAppUrl}${sep}startapp=${release.id}`;

    const artist = (release.artist || "").trim() || "Артист";
    const name = (release.name || "").trim() || "Релиз";
    const img = release.img || "";
    const caption = `🎵 ${artist} — ${name}`;
    const replyMarkup = { inline_keyboard: [[{ text: "Открыть релиз", url: deepLink }]] };

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

    const apiUrl = `https://api.telegram.org/bot${botToken}/savePreparedInlineMessage`;
    const tgPayload = {
      user_id: parseInt(telegramUserId, 10),
      result: result,
      allow_user_chats: true,
      allow_group_chats: true,
      allow_channel_chats: true,
    };

    const tgRes = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tgPayload),
    });

    const tgData = await tgRes.json();
    if (!tgRes.ok || !tgData.ok) {
      console.error("savePreparedInlineMessage failed:", tgData);
      return new Response(JSON.stringify({ error: "Failed to prepare share message from Telegram Bot API" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const preparedMessageId = tgData.result?.id;
    return new Response(JSON.stringify({ preparedMessageId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error in share-message function:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
