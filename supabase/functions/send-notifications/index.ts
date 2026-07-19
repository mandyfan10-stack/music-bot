import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { JwtAuthError, verifyRequiredRole } from "../_shared/jwt_auth.ts";

serve(async (req) => {
  const jsonHeaders = { "Content-Type": "application/json" };
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: jsonHeaders,
      });
    }
    await verifyRequiredRole(
      req.headers.get("Authorization"),
      Deno.env.get("SUPABASE_JWT_SECRET"),
      "service_role",
    );

    const payload = await req.json();
    if (payload.type !== "INSERT" || payload.table !== "releases") {
      return new Response(
        JSON.stringify({
          status: "skipped",
          reason: "Not a release insert event",
        }),
        {
          status: 200,
          headers: jsonHeaders,
        },
      );
    }

    const release = payload.record;
    if (!release || typeof release.id !== "string" || !release.id) {
      return new Response(JSON.stringify({ error: "Missing release record" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!botToken || !supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Notification service is not configured" }),
        {
          status: 503,
          headers: jsonHeaders,
        },
      );
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: subscribers, error: dbError } = await supabase
      .from("notification_subscribers")
      .select("user_id, chat_id")
      .eq("enabled", true);
    if (dbError) throw dbError;

    const artist = String(release.artist || "").trim();
    const name = String(release.name || "").trim();
    const text = `🎵 Новый релиз в XXII SOUND\n\n${artist} — ${name}`;
    const miniAppUrl = Deno.env.get("MINI_APP_URL") || "";
    const replyMarkup = miniAppUrl
      ? {
        inline_keyboard: [[{
          text: "Открыть в приложении",
          url: `${miniAppUrl}${miniAppUrl.includes("?") ? "&" : "?"}startapp=${
            encodeURIComponent(release.id)
          }`,
        }]],
      }
      : undefined;
    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    let sentCount = 0;
    let skippedCount = 0;

    for (const subscriber of subscribers || []) {
      const userId = subscriber.user_id;
      const chatId = subscriber.chat_id || userId;
      if (!userId || !chatId) continue;

      const { error: claimError } = await supabase
        .from("notification_deliveries")
        .insert({ release_id: release.id, user_id: userId });
      if (claimError?.code === "23505") {
        skippedCount++;
        continue;
      }
      if (claimError) {
        console.error("Could not claim notification delivery:", claimError);
        continue;
      }

      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            reply_markup: replyMarkup,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          sentCount++;
          continue;
        }

        await supabase.from("notification_deliveries")
          .delete().match({ release_id: release.id, user_id: userId });
        if (response.status === 403) {
          await supabase.from("notification_subscribers")
            .update({ enabled: false }).eq("user_id", userId);
        } else {
          console.warn("Telegram notification failed:", response.status);
        }
      } catch (error) {
        await supabase.from("notification_deliveries")
          .delete().match({ release_id: release.id, user_id: userId });
        console.error("Telegram notification request failed:", error);
      }
    }

    return new Response(
      JSON.stringify({ status: "ok", sentCount, skippedCount }),
      {
        status: 200,
        headers: jsonHeaders,
      },
    );
  } catch (error) {
    if (error instanceof JwtAuthError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status,
        headers: jsonHeaders,
      });
    }
    console.error("Error in send-notifications function:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
