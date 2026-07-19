import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const payload = await req.json();
    console.log("Notification webhook payload received:", payload);

    if (payload.type !== "INSERT" || payload.table !== "releases") {
      return new Response(JSON.stringify({ status: "skipped", reason: "Not a release insert event" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const release = payload.record;
    if (!release) {
      return new Response(JSON.stringify({ error: "Missing record data" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      console.warn("TELEGRAM_BOT_TOKEN not set, skipping notifications");
      return new Response(JSON.stringify({ status: "skipped", reason: "TELEGRAM_BOT_TOKEN not configured" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch subscribers
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: subscribers, error: dbError } = await supabase
      .from("notification_subscribers")
      .select("user_id, chat_id")
      .eq("enabled", true);

    if (dbError) {
      console.error("Database error fetching notification subscribers:", dbError);
      return new Response(JSON.stringify({ error: "DB error fetching subscribers" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!subscribers || subscribers.length === 0) {
      console.log("No subscribers found, skipping notifications");
      return new Response(JSON.stringify({ status: "ok", sentCount: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const artist = (release.artist || "").trim();
    const name = (release.name || "").trim();
    const text = `🎵 Новый релиз в XXII SOUND\n\n${artist} — ${name}`;

    let replyMarkup = null;
    const miniAppUrl = Deno.env.get("MINI_APP_URL") || "";
    if (miniAppUrl) {
      const sep = miniAppUrl.includes("?") ? "&" : "?";
      const deepLink = `${miniAppUrl}${sep}startapp=${release.id}`;
      replyMarkup = {
        inline_keyboard: [[{ text: "Открыть в приложении", url: deepLink }]],
      };
    }

    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    let sentCount = 0;

    // Send notifications to all subscribers
    for (const sub of subscribers) {
      const chatId = sub.chat_id || sub.user_id;
      if (!chatId) continue;

      const body = {
        chat_id: chatId,
        text: text,
        reply_markup: replyMarkup ? replyMarkup : undefined,
      };

      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (response.status === 403) {
          // User blocked the bot - disable their subscription
          console.log(`User ${sub.user_id} blocked the bot, disabling subscription`);
          await supabase
            .from("notification_subscribers")
            .update({ enabled: false })
            .eq("user_id", sub.user_id);
        } else if (response.ok) {
          sentCount++;
        } else {
          console.warn(`Telegram API warning for user ${chatId}:`, await response.text());
        }
      } catch (err) {
        console.error(`Failed to send notification to ${chatId}:`, err);
      }
    }

    console.log(`Successfully sent ${sentCount} notifications`);
    return new Response(JSON.stringify({ status: "ok", sentCount }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error in send-notifications function:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
