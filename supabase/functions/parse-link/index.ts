import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";
import {
  fetchPublicHtml,
  isSafePublicUrl,
  METADATA_TIMEOUT_MS,
} from "../_shared/network_security.ts";
import {
  JwtAuthError,
  requireGatewayVerifiedRole,
} from "../_shared/jwt_auth.ts";
import {
  cleanText,
  cleanTrackTitle,
  joinNames,
  normalizeGenre,
  parseArtistAndTitle,
  parseYandexMusicUrl,
  yandexCoverUrl,
} from "../_shared/catalog_parse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-telegram-init-data",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function getYandexMusicRelease(urlStr: string) {
  const ids = parseYandexMusicUrl(urlStr);
  if (!ids) return null;

  const apiBase = Deno.env.get("YANDEX_MUSIC_API_BASE") ||
    "https://api.music.yandex.net";
  const token = Deno.env.get("YANDEX_MUSIC_TOKEN");
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  };
  if (token) {
    headers["Authorization"] = `OAuth ${token}`;
  }

  try {
    // Если есть track_id — запрашиваем конкретный трек
    if (ids.track_id) {
      const res = await fetch(`${apiBase}/tracks/${ids.track_id}`, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = await res.json();
        const track = data.result?.[0];
        if (track && track.title) {
          const album = track.albums?.[0] || {};
          const artist = joinNames(track.artists) ||
            joinNames(album.artists) ||
            joinNames(album.labels);
          const img = yandexCoverUrl(
            track.coverUri || track.ogImage || album.coverUri ||
              album.ogImage || "",
          );
          const rawGenre = track.genre || album.genre || "";
          return {
            artist: cleanText(artist, "Артист"),
            name: cleanText(cleanTrackTitle(track.title), "Релиз"),
            img,
            genre: normalizeGenre(rawGenre),
          };
        }
      }
    }

    // Если есть только album_id — запрашиваем альбом
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
          const artist = joinNames(album.artists) ||
            joinNames(album.labels);
          const img = yandexCoverUrl(
            album.coverUri || album.ogImage || album.cover?.uri || "",
          );
          const rawGenre = album.genre || "";
          return {
            artist: cleanText(artist, "Артист"),
            name: cleanText(album.title, "Релиз"),
            img,
            genre: normalizeGenre(rawGenre),
          };
        }
      }
    }
  } catch (err) {
    console.warn("Yandex Music API parser error:", err);
  }
  return null;
}

export async function scrapeMetadataFromPage(
  urlStr: string,
): Promise<
  { artist: string; name: string; img: string; genre: string } | null
> {
  const headers = {
    "User-Agent": "TelegramBot (like TwitterBot)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  };

  try {
    const { html: htmlText, finalUrl: currentUrl } = await fetchPublicHtml(
      urlStr,
      { headers },
    );
    const doc = new DOMParser().parseFromString(htmlText, "text/html");
    if (!doc) return null;

    let parsedArtist = "";
    let parsedName = "";
    let parsedImg = "";
    let parsedGenre = "";

    // 1. Поиск микроразметки JSON-LD (внедряется Яндексом, Spotify, Apple, YouTube)
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of Array.from(scripts)) {
      try {
        const text = script.textContent || "";
        const ld = JSON.parse(text);
        const item = ld["@graph"]?.[0] || ld;

        if (item) {
          if (item.name && typeof item.name === "string") {
            parsedName = item.name;
          }
          if (item.byArtist) {
            if (typeof item.byArtist === "string") parsedArtist = item.byArtist;
            else if (typeof item.byArtist?.name === "string") {
              parsedArtist = item.byArtist.name;
            } else if (Array.isArray(item.byArtist)) {
              parsedArtist = item.byArtist
                .map((a: { name?: string }) => a.name || "")
                .filter(Boolean)
                .join(", ");
            }
          }
          if (item.image) {
            const rawImg = typeof item.image === "string"
              ? item.image
              : item.image?.url;
            if (rawImg) parsedImg = rawImg;
          }
          if (item.genre) {
            parsedGenre = Array.isArray(item.genre)
              ? item.genre.join(", ")
              : String(item.genre);
          }
          if (parsedName && parsedArtist) break;
        }
      } catch {
        // Продолжаем поиск
      }
    }

    // 2. OpenGraph теги
    const ogTitle =
      doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
      doc.querySelector('meta[name="twitter:title"]')?.getAttribute(
        "content",
      ) ||
      doc.querySelector("title")?.textContent || "";

    const ogImage =
      doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
      doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content");

    if (ogImage && !parsedImg) {
      const candidateImg = new URL(ogImage.trim(), currentUrl).toString();
      if (
        candidateImg.startsWith("https://") &&
        (await isSafePublicUrl(candidateImg))
      ) {
        parsedImg = candidateImg;
      }
    }

    for (const prop of ["og:music:genre", "music:genre", "genre"]) {
      const content =
        doc.querySelector(`meta[property="${prop}"]`)?.getAttribute(
          "content",
        ) ||
        doc.querySelector(`meta[name="${prop}"]`)?.getAttribute("content");
      if (content && !parsedGenre) {
        parsedGenre = content.trim();
        break;
      }
    }

    // Обработка обложки Яндекса, если она содержит %%
    if (parsedImg.includes("avatars.yandex.net")) {
      parsedImg = yandexCoverUrl(parsedImg);
    }

    // Если JSON-LD не дал готового артиста/названия — разбиваем заголовок
    if (!parsedName || !parsedArtist) {
      const split = parseArtistAndTitle(ogTitle, currentUrl);
      if (!parsedArtist) parsedArtist = split.artist;
      if (!parsedName) parsedName = split.name;
    }

    return {
      artist: cleanText(parsedArtist),
      name: cleanText(parsedName),
      img: parsedImg,
      genre: normalizeGenre(parsedGenre),
    };
  } catch (err) {
    console.warn("HTML Scraping failed:", err);
    return null;
  }
}

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
    // The gateway validates the JWT signature. The handler then requires an
    // authenticated application role from that already-verified token.
    requireGatewayVerifiedRole(
      req.headers.get("Authorization"),
      "authenticated",
    );

    // Чтение ссылки из тела запроса
    const { link } = await req.json();
    if (!link || typeof link !== "string") {
      return new Response(JSON.stringify({ error: "Missing link parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Защита от SSRF
    if (!(await isSafePublicUrl(link))) {
      return new Response(
        JSON.stringify({ error: "Unsafe or unsupported URL" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 1. ЭТАП 1: Яндекс.Музыка — специализированный прямой парсинг по ID
    const yandexResult = await getYandexMusicRelease(link);
    if (yandexResult && yandexResult.name && yandexResult.name !== "Релиз") {
      return new Response(JSON.stringify(yandexResult), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. ЭТАП 2: HTML парсинг (JSON-LD + OpenGraph + разделение артист/трек)
    const scraped = await scrapeMetadataFromPage(link);
    if (scraped && scraped.name && scraped.name !== "Релиз") {
      return new Response(JSON.stringify(scraped), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Если ничего не удалось извлечь
    return new Response(
      JSON.stringify({ error: "Could not extract metadata from link" }),
      {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    if (err instanceof JwtAuthError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("Error in parse-link function:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
