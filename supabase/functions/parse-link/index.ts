import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";
import { verify } from "https://deno.land/x/djwt@v2.9/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import {
  fetchPublicHtml,
  isSafePublicUrl,
  METADATA_TIMEOUT_MS,
} from "../_shared/network_security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-telegram-init-data",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GENRE_MAP: Record<string, string> = {
  "rap": "Рэп",
  "hip hop": "Хип-хоп",
  "hip-hop": "Хип-хоп",
  "hiphop": "Хип-хоп",
  "trap": "Трэп",
  "r&b": "R&B",
  "rnb": "R&B",
  "pop": "Поп",
  "rock": "Рок",
  "electronic": "Электронная",
  "edm": "Электронная",
  "jazz": "Джаз",
  "metal": "Метал",
  "рэп": "Рэп",
  "хип-хоп": "Хип-хоп",
  "трэп": "Трэп",
  "поп": "Поп",
  "рок": "Рок",
  "электронная": "Электронная",
  "джаз": "Джаз",
  "метал": "Метал",
  "indie": "Рок",
  "alternative": "Рок",
  "soul": "R&B",
  "drill": "Трэп",
  "phonk": "Трэп",
  "lo-fi": "Хип-хоп",
};

function normalizeGenre(raw: string): string {
  if (!raw) return "";
  const low = raw.trim().toLowerCase();
  if (GENRE_MAP[low]) return GENRE_MAP[low];
  for (const [key, val] of Object.entries(GENRE_MAP)) {
    if (low.includes(key)) return val;
  }
  return "Другое";
}

function cleanAiText(
  value: string | unknown,
  fallback: string,
  maxLength = 120,
): string {
  const rawValue = typeof value === "string" && value.trim() ? value : fallback;
  let cleaned = String(rawValue || "").replace(/\s+/g, " ").trim();
  // Remove wrapping quotes
  cleaned = cleaned.replace(/^["'`]|["'`]$/g, "");
  return cleaned.substring(0, maxLength);
}

function parseYandexMusicUrl(urlStr: string) {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    if (host !== "music.yandex.ru" && host !== "music.yandex.com") return null;

    const parts = url.pathname.split("/").filter(Boolean);
    const result: Record<string, string> = {};

    for (let i = 0; i < parts.length; i++) {
      if (
        (parts[i] === "album" || parts[i] === "track") && i + 1 < parts.length
      ) {
        const val = parts[i + 1];
        if (/^\d+$/.test(val)) {
          result[`${parts[i]}_id`] = val;
        }
      }
    }
    const trackId = url.searchParams.get("track");
    if (trackId && /^\d+$/.test(trackId)) {
      result["track_id"] = trackId;
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

function yandexCoverUrl(coverUri: string): string {
  if (!coverUri) return "";
  const size = Deno.env.get("YANDEX_COVER_SIZE") || "1000x1000";
  const uri = coverUri.replace("%%", size);
  if (uri.startsWith("//")) return `https:${uri}`;
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  return `https://${uri}`;
}

function joinYandexNames(items: Array<{ name?: string }> | unknown): string {
  if (!Array.isArray(items)) return "";
  const names = items
    .map((
      item,
    ) => (item && typeof item === "object" && "name" in item
      ? String(item.name).trim()
      : "")
    )
    .filter(Boolean);
  return Array.from(new Set(names)).join(", ");
}

async function getYandexMusicRelease(urlStr: string) {
  const ids = parseYandexMusicUrl(urlStr);
  if (!ids) return null;

  const apiBase = Deno.env.get("YANDEX_MUSIC_API_BASE") ||
    "https://api.music.yandex.net";
  const headers = { "User-Agent": "Mozilla/5.0", "Accept": "application/json" };

  try {
    if (ids.track_id) {
      const res = await fetch(`${apiBase}/tracks/${ids.track_id}`, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = await res.json();
        const track = data.result?.[0];
        if (track) {
          const album = track.albums?.[0] || {};
          const artist = joinYandexNames(track.artists) ||
            joinYandexNames(album.artists) || joinYandexNames(album.labels);
          const img = yandexCoverUrl(
            track.coverUri || track.ogImage || album.coverUri ||
              album.ogImage || "",
          );
          const genre = track.genre || album.genre || "";
          return {
            artist: cleanAiText(artist, "Артист"),
            name: cleanAiText(track.title, "Релиз"),
            img,
            genre: normalizeGenre(genre),
          };
        }
      }
    }

    if (ids.album_id) {
      const res = await fetch(`${apiBase}/albums/${ids.album_id}/with-tracks`, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = await res.json();
        const album = data.result || {};
        if (album.title) {
          const artist = joinYandexNames(album.artists) ||
            joinYandexNames(album.labels);
          const img = yandexCoverUrl(
            album.coverUri || album.ogImage || album.cover?.uri || "",
          );
          const genre = album.genre || "";
          return {
            artist: cleanAiText(artist, "Артист"),
            name: cleanAiText(album.title, "Релиз"),
            img,
            genre: normalizeGenre(genre),
          };
        }
      }
    }
  } catch (err) {
    console.warn("Yandex Music API parser error:", err);
  }
  return null;
}

function guessReleaseFromTitle(rawTitle: string, link: string) {
  let title = (rawTitle || "").replace(/\s+/g, " ").trim();
  title = title.replace(
    /\s*\|\s*(Spotify|Apple Music|YouTube Music|Yandex Music|Яндекс Музыка)\s*$/i,
    "",
  );
  title = title.replace(
    /\s*[-–—]\s*(Spotify|Apple Music|YouTube Music|Yandex Music|Яндекс Музыка)\s*$/i,
    "",
  );

  const byMatch = title.match(/(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return {
      artist: byMatch[2].trim(),
      name: byMatch[1].trim(),
      genre: "",
    };
  }

  for (const separator of [" - ", " – ", " — "]) {
    if (title.includes(separator)) {
      const parts = title.split(separator);
      return {
        artist: parts[0].trim(),
        name: parts[1].trim(),
        genre: "",
      };
    }
  }

  try {
    const url = new URL(link);
    const pathName = decodeURIComponent(
      url.pathname.replace(/\/$/, "").split("/").pop() || "",
    )
      .replace(/-/g, " ")
      .trim();
    return {
      artist: "",
      name: title || pathName,
      genre: "",
    };
  } catch {
    return { artist: "", name: title, genre: "" };
  }
}

async function scrapeMetadataFromPage(
  urlStr: string,
): Promise<[string, string, string]> {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };

  try {
    const { html: htmlText, finalUrl: currentUrl } = await fetchPublicHtml(
      urlStr,
      { headers },
    );
    const doc = new DOMParser().parseFromString(htmlText, "text/html");
    if (!doc) return ["", "", ""];

    const ogTitle = doc.querySelector('meta[property="og:title"]')
      ?.getAttribute("content");
    const title = ogTitle || doc.querySelector("title")?.textContent || "";

    let img = "";
    const ogImage = doc.querySelector('meta[property="og:image"]')
      ?.getAttribute("content");
    if (ogImage) {
      const candidateImg = new URL(ogImage.trim(), currentUrl).toString();
      if (
        candidateImg.startsWith("https://") &&
        (await isSafePublicUrl(candidateImg))
      ) {
        img = candidateImg;
      }
    }

    let genre = "";
    for (const prop of ["og:music:genre", "music:genre", "genre"]) {
      const content =
        doc.querySelector(`meta[property="${prop}"]`)?.getAttribute(
          "content",
        ) ||
        doc.querySelector(`meta[name="${prop}"]`)?.getAttribute("content");
      if (content) {
        genre = content.trim();
        break;
      }
    }

    if (urlStr.includes("music.yandex")) {
      // Try JSON-LD
      const scripts = doc.querySelectorAll(
        'script[type="application/ld+json"]',
      );
      for (const script of scripts) {
        try {
          const ld = JSON.parse(script.textContent || "");
          const g = ld.genre || ld["@graph"]?.[0]?.genre;
          if (g) {
            genre = Array.isArray(g) ? g.join(", ") : String(g);
            break;
          }
        } catch {
          // ignore
        }
      }
      if (!genre) {
        const links = doc.querySelectorAll("a");
        for (const a of Array.from(links)) {
          const linkElement = a as unknown as {
            getAttribute(name: string): string | null;
            textContent?: string | null;
          };
          const cls = (linkElement.getAttribute("class") || "").toLowerCase();
          if (cls.includes("genre")) {
            genre = linkElement.textContent || "";
            if (genre) break;
          }
        }
      }
    }

    if (urlStr.includes("spotify.com") && !genre) {
      const ogDesc = doc.querySelector('meta[property="og:description"]')
        ?.getAttribute("content");
      if (ogDesc) {
        const parts = ogDesc.split(/\s*[·•]\s*/);
        if (parts.length >= 2) {
          const candidate = parts[parts.length - 1].trim().replace(/\.$/, "");
          if (candidate.length < 30 && !/^\d+$/.test(candidate)) {
            genre = candidate;
          }
        }
      }
    }

    return [title.trim(), img, cleanAiText(genre, "", 60)];
  } catch (err) {
    console.error("Scraping failed:", err);
    return ["", "", ""];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Verify Admin Role
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.substring(7);
    const jwtSecret = Deno.env.get("JWT_SECRET") ||
      Deno.env.get("SUPABASE_JWT_SECRET");
    if (!jwtSecret) {
      return new Response(
        JSON.stringify({ error: "Missing SUPABASE_JWT_SECRET variable" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const signingKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    let payload: { sub?: string };
    try {
      payload = await verify(token, signingKey) as typeof payload;
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid token signature" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!payload.sub) {
      return new Response(
        JSON.stringify({ error: "Missing user ID in token claims" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Supabase service configuration is missing" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: admin, error: adminError } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", payload.sub)
      .maybeSingle();
    if (adminError) {
      console.error("Admin lookup failed:", adminError);
      return new Response(
        JSON.stringify({ error: "Could not verify admin access" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (!admin) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Admin access required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 2. Parse Request
    const { link } = await req.json();
    if (!link) {
      return new Response(JSON.stringify({ error: "Missing link parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. SSRF Check
    if (!(await isSafePublicUrl(link))) {
      return new Response(
        JSON.stringify({ error: "Unsafe or unsupported URL" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 4. Try Yandex API First
    const yandexResult = await getYandexMusicRelease(link);
    if (yandexResult) {
      return new Response(JSON.stringify(yandexResult), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (link.includes("music.yandex.ru") || link.includes("music.yandex.com")) {
      return new Response(
        JSON.stringify({ error: "Could not fetch Yandex Music metadata" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 5. Scrape HTML metadata
    const [rawTitle, foundImage, rawGenre] = await scrapeMetadataFromPage(link);
    if (!rawTitle) {
      return new Response(
        JSON.stringify({ error: "Could not read release metadata from link" }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const detectedGenre = normalizeGenre(rawGenre);

    // 6. Call Groq AI Fallback
    let result = { artist: "", name: "", genre: detectedGenre };
    const guessed = guessReleaseFromTitle(rawTitle, link);

    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    if (groqApiKey) {
      const groqModel = Deno.env.get("GROQ_MODEL_PRIMARY") ||
        "llama-3.3-70b-versatile";
      const systemPrompt =
        `Extract a music release from the page title or URL. Return only compact JSON with string keys: artist, name${
          detectedGenre ? "" : ", genre"
        }. Use only the provided page title. Do not invent missing data. Remove platform names, marketing words, and quotes.`;

      try {
        const aiRes = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
            headers: {
              "Authorization": `Bearer ${groqApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: groqModel,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: rawTitle },
              ],
              response_format: { type: "json_object" },
              temperature: 0,
              max_tokens: 160,
            }),
          },
        );

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const parsedAi = JSON.parse(
            aiData.choices?.[0]?.message?.content || "{}",
          );

          result.artist = cleanAiText(parsedAi.artist, guessed.artist, 120);
          result.name = cleanAiText(parsedAi.name, guessed.name, 160);

          const g = parsedAi.genre || "";
          result.genre = detectedGenre || normalizeGenre(g);
        } else {
          console.warn("Groq API returned non-OK status:", aiRes.status);
          result.artist = guessed.artist;
          result.name = guessed.name;
        }
      } catch (err) {
        console.warn("Groq AI API error:", err);
        result.artist = guessed.artist;
        result.name = guessed.name;
      }
    } else {
      result.artist = guessed.artist;
      result.name = guessed.name;
    }

    return new Response(
      JSON.stringify({
        artist: result.artist,
        name: result.name,
        img: foundImage,
        genre: result.genre,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Error in parse-link function:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
