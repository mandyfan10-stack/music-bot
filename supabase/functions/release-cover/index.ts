import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import {
  TelegramAuthError,
  verifyTelegramInitData,
} from "../_shared/telegram_auth.ts";

const BUCKET = "release-covers";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
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

function parseImageData(imageData: unknown): {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
} {
  if (typeof imageData !== "string") {
    throw new Error("Image data is required");
  }

  const match = imageData.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!match) throw new Error("Unsupported image format");

  // Reject oversized input before allocating the decoded byte array.
  if (match[2].length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4) {
    throw new Error("Image is too large");
  }

  let binary: string;
  try {
    binary = atob(match[2]);
  } catch {
    throw new Error("Invalid base64 image");
  }
  if (binary.length > MAX_IMAGE_BYTES) throw new Error("Image is too large");

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const contentType = match[1];
  const extension = contentType === "image/jpeg"
    ? "jpg"
    : contentType.split("/")[1];
  return { bytes, contentType, extension };
}

function safeReleaseId(value: unknown): string {
  const releaseId = String(value || "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(releaseId)) {
    throw new Error("Invalid release ID");
  }
  return releaseId;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const initData = body?.initData;
    if (!initData || typeof initData !== "string") {
      return jsonResponse({ error: "Missing initData" }, 400);
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      return jsonResponse({
        error: "Telegram authentication is not configured",
      }, 500);
    }
    const maxAge = Number(Deno.env.get("INIT_DATA_MAX_AGE") || "86400");
    const telegramUser = await verifyTelegramInitData(
      initData,
      botToken,
      maxAge,
    );

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Supabase is not configured" }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: blockedUser, error: blockedError }, {
      data: admin,
      error: adminError,
    }] = await Promise.all([
      supabase.from("blocked_users").select("user_id").eq(
        "user_id",
        telegramUser.id,
      ).maybeSingle(),
      supabase.from("admins").select("user_id").eq("user_id", telegramUser.id)
        .maybeSingle(),
    ]);
    if (blockedError || adminError) {
      console.error("Cover authorization lookup failed", {
        blockedError,
        adminError,
      });
      return jsonResponse({ error: "Could not verify permissions" }, 500);
    }
    if (blockedUser || !admin) return jsonResponse({ error: "Forbidden" }, 403);

    const releaseId = safeReleaseId(body?.releaseId);
    if (body?.action === "delete") {
      const path = String(body?.path || "");
      if (
        !new RegExp(`^releases/${releaseId}\\.(?:jpg|png|webp)$`).test(path)
      ) {
        return jsonResponse({ error: "Invalid cover path" }, 400);
      }
      const { error } = await supabase.storage.from(BUCKET).remove([path]);
      if (error) throw error;
      return jsonResponse({ deleted: true }, 200);
    }

    const { bytes, contentType, extension } = parseImageData(body?.imageData);
    const path = `releases/${releaseId}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(
      path,
      bytes,
      {
        cacheControl: "31536000",
        contentType,
        upsert: true,
      },
    );
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return jsonResponse({ path, url: data.publicUrl }, 200);
  } catch (error) {
    if (error instanceof TelegramAuthError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    console.error("Release cover error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 500);
  }
});
