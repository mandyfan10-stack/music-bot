import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.110.7";
import {
  JwtAuthError,
  requireGatewayVerifiedRole,
} from "../_shared/jwt_auth.ts";
import {
  type ClaimDecision,
  handleReviewComment,
  handleReviewReaction,
  REVIEW_ACTIVITY_COOLDOWN_SECONDS,
  type ReviewActivityDeps,
} from "../_shared/review_activity.ts";

function startAppUrl(releaseId: string): string {
  const miniAppUrl = Deno.env.get("MINI_APP_URL") || "";
  if (!miniAppUrl) return "";
  return `${miniAppUrl}${miniAppUrl.includes("?") ? "&" : "?"}startapp=${
    encodeURIComponent(releaseId)
  }`;
}

// Зависимости уведомлений автору рецензии: Supabase (service role) и Bot API.
function reviewActivityDeps(
  supabase: SupabaseClient,
  botToken: string,
): ReviewActivityDeps {
  return {
    async getReview(id) {
      const { data, error } = await supabase.from("reviews")
        .select("id, author_id, release_id, reaction_count")
        .eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
    async getRelease(id) {
      const { data, error } = await supabase.from("releases")
        .select("id, name, artist").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
    async getSubscriber(userId) {
      const { data, error } = await supabase.from("notification_subscribers")
        .select("chat_id, enabled").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return data
        ? { chatId: Number(data.chat_id || userId), enabled: !!data.enabled }
        : null;
    },
    async claim(reviewId, kind, actorId): Promise<ClaimDecision> {
      const { data, error } = await supabase.rpc(
        "claim_review_activity_notification",
        {
          p_review_id: reviewId,
          p_kind: kind,
          p_actor_id: actorId,
          p_cooldown_seconds: REVIEW_ACTIVITY_COOLDOWN_SECONDS,
        },
      ).single();
      if (error) throw error;
      const row = data as { decision: string; previous_sent_at: string | null };
      return {
        decision: row.decision as ClaimDecision["decision"],
        previousSentAt: row.previous_sent_at
          ? Date.parse(row.previous_sent_at)
          : null,
      };
    },
    async countOtherCommentsSince(reviewId, sinceMs, excludeId, authorId) {
      const { count, error } = await supabase.from("review_comments")
        .select("id", { count: "exact", head: true })
        .eq("review_id", reviewId)
        .gt("timestamp", sinceMs)
        .neq("id", excludeId)
        .neq("author_id", authorId);
      if (error) throw error;
      return count || 0;
    },
    async sendMessage(chatId, text, releaseId) {
      const url = startAppUrl(releaseId);
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            reply_markup: url
              ? { inline_keyboard: [[{ text: "Открыть", url }]] }
              : undefined,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (response.status === 403) {
        // Пользователь заблокировал бота — как и для релизов, выключаем.
        await supabase.from("notification_subscribers")
          .update({ enabled: false }).eq("user_id", chatId);
      }
      if (!response.ok) {
        throw new Error(`Telegram sendMessage failed: ${response.status}`);
      }
    },
  };
}

const REVIEW_ACTIVITY_HANDLERS: Record<
  string,
  typeof handleReviewReaction
> = {
  review_reactions: handleReviewReaction,
  review_comments: handleReviewComment,
};

serve(async (req) => {
  const jsonHeaders = { "Content-Type": "application/json" };
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: jsonHeaders,
      });
    }
    requireGatewayVerifiedRole(
      req.headers.get("Authorization"),
      "service_role",
    );

    const payload = await req.json();
    const activityHandler = payload.type === "INSERT"
      ? REVIEW_ACTIVITY_HANDLERS[payload.table]
      : undefined;
    if (activityHandler) {
      const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!botToken || !supabaseUrl || !supabaseServiceKey) {
        return new Response(
          JSON.stringify({ error: "Notification service is not configured" }),
          { status: 503, headers: jsonHeaders },
        );
      }
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const result = await activityHandler(
        payload.record || null,
        reviewActivityDeps(supabase, botToken),
      );
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: jsonHeaders,
      });
    }

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
    const releaseUrl = startAppUrl(release.id);
    const replyMarkup = releaseUrl
      ? {
        inline_keyboard: [[{
          text: "Открыть в приложении",
          url: releaseUrl,
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
