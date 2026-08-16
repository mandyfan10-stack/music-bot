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
import { verifyTelegramInitData } from "../_shared/telegram_auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-telegram-init-data",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function requireParserAccess(req: Request): Promise<void> {
  try {
    requireGatewayVerifiedRole(
      req.headers.get("Authorization"),
      "authenticated",
    );
    return;
  } catch (error) {
    // Compatibility for already-deployed clients: the gateway accepts the
    // public legacy anon JWT, but the request must additionally prove that it
    // came from a genuine, recent Telegram Mini App session.
    if (!(error instanceof JwtAuthError) || error.status !== 403) throw error;
  }

  const initData = req.headers.get("X-Telegram-Init-Data") || "";
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  const maxAge = Number(Deno.env.get("INIT_DATA_MAX_AGE") || "86400");
  try {
    if (!initData || !botToken) throw new Error("Missing Telegram proof");
    await verifyTelegramInitData(initData, botToken, maxAge);
  } catch {
    throw new JwtAuthError("Authenticated Telegram user required", 403);
  }
}

const GENRE_MAP: Record<string, string> = {
  // Рэп / Хип-хоп / Трэп
  "rusrap": "Рэп",
  "rap": "Рэп",
  "рэп": "Рэп",
  "hip hop": "Хип-хоп",
  "hip-hop": "Хип-хоп",
  "hiphop": "Хип-хоп",
  "хип-хоп": "Хип-хоп",
  "хипхоп": "Хип-хоп",
  "trap": "Трэп",
  "трэп": "Трэп",
  "drill": "Трэп",
  "дрил": "Трэп",
  "дрилл": "Трэп",
  "phonk": "Трэп",
  "фонк": "Трэп",
  "cloud rap": "Рэп",
  "lo-fi": "Хип-хоп",
  "lofi": "Хип-хоп",

  // R&B / Soul
  "r&b": "R&B",
  "rnb": "R&B",
  "рнб": "R&B",
  "soul": "R&B",
  "соул": "R&B",
  "urban": "R&B",

  // Поп
  "ruspop": "Поп",
  "pop": "Поп",
  "поп": "Поп",
  "synthpop": "Поп",
  "синти-поп": "Поп",
  "k-pop": "Поп",
  "dance pop": "Поп",

  // Рок
  "rusrock": "Рок",
  "rock": "Рок",
  "рок": "Рок",
  "indie": "Рок",
  "инди": "Рок",
  "alternative": "Рок",
  "альтернатива": "Рок",
  "punk": "Рок",
  "панк": "Рок",
  "post-punk": "Рок",
  "пост-панк": "Рок",
  "grunge": "Рок",
  "поп-панк": "Рок",
  "pop-punk": "Рок",

  // Электронная
  "electronics": "Электронная",
  "electronic": "Электронная",
  "электроника": "Электронная",
  "электронная": "Электронная",
  "edm": "Электронная",
  "dance": "Электронная",
  "танцевальная": "Электронная",
  "club": "Электронная",
  "house": "Электронная",
  "хаус": "Электронная",
  "techno": "Электронная",
  "техно": "Электронная",
  "trance": "Электронная",
  "транс": "Электронная",
  "dubstep": "Электронная",
  "дабстеп": "Электронная",
  "dnb": "Электронная",
  "drum and bass": "Электронная",

  // Метал
  "metal": "Метал",
  "метал": "Метал",
  "heavy metal": "Метал",
  "metalcore": "Метал",
  "hardrock": "Метал",
  "хард-рок": "Метал",

  // Джаз
  "jazz": "Джаз",
  "джаз": "Джаз",
  "blues": "Джаз",
  "блюз": "Джаз",
};

export function normalizeGenre(raw: string): string {
  if (!raw) return "";
  const low = raw.trim().toLowerCase().replace(/_/g, "-");
  if (GENRE_MAP[low]) return GENRE_MAP[low];
  for (const [key, val] of Object.entries(GENRE_MAP)) {
    if (low === key || low.includes(key)) return val;
  }
  return "Другое";
}

export function cleanText(
  value: string | unknown,
  fallback = "",
  maxLength = 120,
): string {
  const rawValue = typeof value === "string" && value.trim() ? value : fallback;
  let cleaned = String(rawValue || "").replace(/\s+/g, " ").trim();
  // Remove wrapping quotes and brackets
  cleaned = cleaned.replace(/^["'«`]|["'»`]$/g, "").trim();
  return cleaned.substring(0, maxLength);
}

// Удаление мусора платформ из названий треков / клипов
export function cleanTrackTitle(raw: string): string {
  let title = (raw || "").replace(/\s+/g, " ").trim();
  title = title.replace(
    /\s*\|\s*(Spotify|Apple Music|YouTube Music|YouTube|Yandex Music|Яндекс Музыка|VK Музыка|SoundCloud|Bandcamp)\s*$/i,
    "",
  );
  title = title.replace(
    /\s*[-–—]\s*(Spotify|Apple Music|YouTube Music|YouTube|Yandex Music|Яндекс Музыка|VK Музыка|SoundCloud|Bandcamp)\s*$/i,
    "",
  );
  // Очистка типовых YouTube/VK суффиксов
  title = title.replace(
    /\s*(\(Official\s*(Music\s*)?Video\)|\[Official\s*(Music\s*)?Video\]|\(Official\s*Audio\)|\(Audio\)|\(Lyric\s*Video\)|\(Lyrics\)|\(Visualizer\)|\[Audio\]|\[Премьера\s*клипа\]|\[Клип\]|\(Премьера\s*клипа\)|\(Клип\)|\(Mood\s*Video\))\s*$/gi,
    "",
  );
  return title.trim();
}

export function parseYandexMusicUrl(
  urlStr: string,
): { track_id?: string; album_id?: string } | null {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    const isYandex = host === "music.yandex.ru" ||
      host === "music.yandex.com" ||
      host === "music.yandex.by" ||
      host === "music.yandex.kz" ||
      host === "music.yandex.uz" ||
      host.endsWith(".yandex.ru") ||
      host.endsWith(".yandex.com") ||
      host.endsWith(".yandex.by") ||
      host.endsWith(".yandex.kz") ||
      host.endsWith(".yandex.uz");

    if (!isYandex) return null;

    const result: { track_id?: string; album_id?: string } = {};

    // 1. Проверяем query-параметры (?track=123)
    const trackParam = url.searchParams.get("track");
    if (trackParam && /^\d+$/.test(trackParam)) {
      result.track_id = trackParam;
    }

    // 2. Проверяем сегменты пути (/album/123/track/456 или /track/456 или /album/123)
    const parts = url.pathname.split("/").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (
        parts[i] === "track" && i + 1 < parts.length &&
        /^\d+$/.test(parts[i + 1])
      ) {
        result.track_id = parts[i + 1];
      }
      if (
        parts[i] === "album" && i + 1 < parts.length &&
        /^\d+$/.test(parts[i + 1])
      ) {
        result.album_id = parts[i + 1];
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

export function yandexCoverUrl(coverUri: string): string {
  if (!coverUri) return "";
  const size = "1000x1000";
  const uri = coverUri.replace("%%", size);
  if (uri.startsWith("//")) return `https:${uri}`;
  if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
  return `https://${uri}`;
}

export function joinNames(items: Array<{ name?: string }> | unknown): string {
  if (!Array.isArray(items)) return "";
  const names = items
    .map((item) =>
      item && typeof item === "object" && "name" in item
        ? String(item.name).trim()
        : ""
    )
    .filter(Boolean);
  return Array.from(new Set(names)).join(", ");
}

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

// Универсальное разбиение заголовка на Артист и Название
export function parseArtistAndTitle(
  rawTitle: string,
  urlStr: string,
): { artist: string; name: string; genre: string } {
  let title = cleanTrackTitle(rawTitle);

  // Шаблон Яндекс Музыки (SEO заголовок): "<Название> (альбом|трек|сингл|песня) <Артисты> слушать онлайн..."
  const yandexSeoMatch = title.match(
    /^(.+?)\s+(?:альбом|трек|сингл|песня)\s+(.+?)\s+слушать\s+онлайн/i,
  );
  if (yandexSeoMatch) {
    return {
      artist: cleanText(yandexSeoMatch[2]),
      name: cleanText(yandexSeoMatch[1]),
      genre: "",
    };
  }

  // Специфический шаблон Яндекс Музыки: "Трек «EUPHORIA» (SALUKI) слушать онлайн..."
  const yandexTrackMatch = title.match(/Трек\s+[«"'](.+?)[»"']\s*\((.+?)\)/i);
  if (yandexTrackMatch) {
    return {
      artist: cleanText(yandexTrackMatch[2]),
      name: cleanText(yandexTrackMatch[1]),
      genre: "",
    };
  }

  // Специфический шаблон Яндекс Музыки: "Альбом «WILD EA$T» (SALUKI)..."
  const yandexAlbumMatch = title.match(/Альбом\s+[«"'](.+?)[»"']\s*\((.+?)\)/i);
  if (yandexAlbumMatch) {
    return {
      artist: cleanText(yandexAlbumMatch[2]),
      name: cleanText(yandexAlbumMatch[1]),
      genre: "",
    };
  }

  // Шаблон "Track by Artist" (Spotify / Apple)
  const byMatch = title.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return {
      artist: cleanText(byMatch[2]),
      name: cleanText(byMatch[1]),
      genre: "",
    };
  }

  // Стандартные разделители "Artist - Track"
  for (const separator of [" - ", " – ", " — ", " : "]) {
    if (title.includes(separator)) {
      const parts = title.split(separator);
      return {
        artist: cleanText(parts[0]),
        name: cleanText(parts.slice(1).join(separator)),
        genre: "",
      };
    }
  }

  // Фолбэк на путь URL
  try {
    const url = new URL(urlStr);
    const pathName = decodeURIComponent(
      url.pathname.replace(/\/$/, "").split("/").pop() || "",
    )
      .replace(/[-_]/g, " ")
      .trim();
    return {
      artist: "",
      name: cleanText(title || pathName, "Релиз"),
      genre: "",
    };
  } catch {
    return { artist: "", name: cleanText(title, "Релиз"), genre: "" };
  }
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
    // authenticated application role or a signature-verified Telegram session.
    await requireParserAccess(req);

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
