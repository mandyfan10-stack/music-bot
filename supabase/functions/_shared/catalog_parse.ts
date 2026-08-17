export const GENRE_MAP: Record<string, string> = {
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
  "r&b": "R&B",
  "rnb": "R&B",
  "рнб": "R&B",
  "soul": "R&B",
  "соул": "R&B",
  "urban": "R&B",
  "ruspop": "Поп",
  "pop": "Поп",
  "поп": "Поп",
  "synthpop": "Поп",
  "синти-поп": "Поп",
  "k-pop": "Поп",
  "dance pop": "Поп",
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
  "metal": "Метал",
  "метал": "Метал",
  "heavy metal": "Метал",
  "metalcore": "Метал",
  "hardrock": "Метал",
  "хард-рок": "Метал",
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
  cleaned = cleaned.replace(/^["'«`]|["'»`]$/g, "").trim();
  return cleaned.substring(0, maxLength);
}

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
    const trackParam = url.searchParams.get("track");
    if (trackParam && /^\d+$/.test(trackParam)) {
      result.track_id = trackParam;
    }

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
  const uri = coverUri.replace("%%", "1000x1000");
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

export function parseArtistAndTitle(
  rawTitle: string,
  urlStr: string,
): { artist: string; name: string; genre: string } {
  const title = cleanTrackTitle(rawTitle);

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

  const yandexTrackMatch = title.match(/Трек\s+[«"'](.+?)[»"']\s*\((.+?)\)/i);
  if (yandexTrackMatch) {
    return {
      artist: cleanText(yandexTrackMatch[2]),
      name: cleanText(yandexTrackMatch[1]),
      genre: "",
    };
  }

  const yandexAlbumMatch = title.match(/Альбом\s+[«"'](.+?)[»"']\s*\((.+?)\)/i);
  if (yandexAlbumMatch) {
    return {
      artist: cleanText(yandexAlbumMatch[2]),
      name: cleanText(yandexAlbumMatch[1]),
      genre: "",
    };
  }

  const byMatch = title.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return {
      artist: cleanText(byMatch[2]),
      name: cleanText(byMatch[1]),
      genre: "",
    };
  }

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
