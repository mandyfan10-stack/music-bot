const GENRE_MAP = {
  'rusrap': 'Рэп',
  'rap': 'Рэп',
  'рэп': 'Рэп',
  'hip hop': 'Хип-хоп',
  'hip-hop': 'Хип-хоп',
  'hiphop': 'Хип-хоп',
  'хип-хоп': 'Хип-хоп',
  'хипхоп': 'Хип-хоп',
  'trap': 'Трэп',
  'трэп': 'Трэп',
  'drill': 'Трэп',
  'дрил': 'Трэп',
  'дрилл': 'Трэп',
  'phonk': 'Трэп',
  'фонк': 'Трэп',
  'cloud rap': 'Рэп',
  'lo-fi': 'Хип-хоп',
  'lofi': 'Хип-хоп',
  'r&b': 'R&B',
  'rnb': 'R&B',
  'рнб': 'R&B',
  'soul': 'R&B',
  'соул': 'R&B',
  'urban': 'R&B',
  'ruspop': 'Поп',
  'pop': 'Поп',
  'поп': 'Поп',
  'synthpop': 'Поп',
  'синти-поп': 'Поп',
  'k-pop': 'Поп',
  'dance pop': 'Поп',
  'rusrock': 'Рок',
  'rock': 'Рок',
  'рок': 'Рок',
  'indie': 'Рок',
  'инди': 'Рок',
  'alternative': 'Рок',
  'альтернатива': 'Рок',
  'punk': 'Рок',
  'панк': 'Рок',
  'post-punk': 'Рок',
  'пост-панк': 'Рок',
  'grunge': 'Рок',
  'поп-панк': 'Рок',
  'pop-punk': 'Рок',
  'electronics': 'Электронная',
  'electronic': 'Электронная',
  'электроника': 'Электронная',
  'электронная': 'Электронная',
  'edm': 'Электронная',
  'dance': 'Электронная',
  'танцевальная': 'Электронная',
  'club': 'Электронная',
  'house': 'Электронная',
  'хаус': 'Электронная',
  'techno': 'Электронная',
  'техно': 'Электронная',
  'trance': 'Электронная',
  'транс': 'Электронная',
  'dubstep': 'Электронная',
  'дабстеп': 'Электронная',
  'dnb': 'Электронная',
  'drum and bass': 'Электронная',
  'metal': 'Метал',
  'метал': 'Метал',
  'heavy metal': 'Метал',
  'metalcore': 'Метал',
  'hardrock': 'Метал',
  'хард-рок': 'Метал',
  'jazz': 'Джаз',
  'джаз': 'Джаз',
  'blues': 'Джаз',
  'блюз': 'Джаз'
};

function normalizeGenre(raw) {
  if (!raw) return '';
  const low = String(raw).trim().toLowerCase().replace(/_/g, '-');
  if (GENRE_MAP[low]) return GENRE_MAP[low];
  for (const [key, val] of Object.entries(GENRE_MAP)) {
    if (low === key || low.includes(key)) return val;
  }
  return 'Другое';
}

function cleanText(value, fallback, maxLength) {
  const limit = maxLength == null ? 120 : maxLength;
  const rawValue = typeof value === 'string' && value.trim() ? value : (fallback || '');
  let cleaned = String(rawValue || '').replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/^["'«`]|["'»`]$/g, '').trim();
  return cleaned.substring(0, limit);
}

function cleanTrackTitle(raw) {
  let title = (raw || '').replace(/\s+/g, ' ').trim();
  title = title.replace(
    /\s*\|\s*(Spotify|Apple Music|YouTube Music|YouTube|Yandex Music|Яндекс Музыка|VK Музыка|SoundCloud|Bandcamp)\s*$/i,
    ''
  );
  title = title.replace(
    /\s*[-–—]\s*(Spotify|Apple Music|YouTube Music|YouTube|Yandex Music|Яндекс Музыка|VK Музыка|SoundCloud|Bandcamp)\s*$/i,
    ''
  );
  title = title.replace(
    /\s*(\(Official\s*(Music\s*)?Video\)|\[Official\s*(Music\s*)?Video\]|\(Official\s*Audio\)|\(Audio\)|\(Lyric\s*Video\)|\(Lyrics\)|\(Visualizer\)|\[Audio\]|\[Премьера\s*клипа\]|\[Клип\]|\(Премьера\s*клипа\)|\(Клип\)|\(Mood\s*Video\))\s*$/gi,
    ''
  );
  return title.trim();
}

function collectYandexPathIds(parts, result) {
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === 'track' && i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
      result.track_id = parts[i + 1];
      // iframe hash: #track/<trackId>/<albumId>
      if (i + 2 < parts.length && /^\d+$/.test(parts[i + 2]) && !result.album_id) {
        result.album_id = parts[i + 2];
      }
    }
    if (parts[i] === 'album' && i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
      result.album_id = parts[i + 1];
    }
  }
}

function parseYandexMusicUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    const isYandex = /(?:^|\.)music\.yandex\.(ru|com|by|kz|uz)$/i.test(host);
    if (!isYandex) return null;

    const result = {};
    const trackParam = url.searchParams.get('track');
    if (trackParam && /^\d+$/.test(trackParam)) result.track_id = trackParam;

    collectYandexPathIds(url.pathname.split('/').filter(Boolean), result);
    collectYandexPathIds(url.hash.replace(/^#/, '').split('/').filter(Boolean), result);
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

function yandexCoverUrl(coverUri) {
  if (!coverUri) return '';
  const uri = String(coverUri).replace('%%', '1000x1000');
  if (uri.startsWith('//')) return `https:${uri}`;
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  return `https://${uri}`;
}

function joinNames(items) {
  if (!Array.isArray(items)) return '';
  const names = items
    .map((item) => (
      item && typeof item === 'object' && 'name' in item
        ? String(item.name).trim()
        : ''
    ))
    .filter(Boolean);
  return Array.from(new Set(names)).join(', ');
}

function parseArtistAndTitle(rawTitle, urlStr) {
  const title = cleanTrackTitle(rawTitle);

  const yandexSeoMatch = title.match(
    /^(.+?)\s+(?:альбом|трек|сингл|песня)\s+(.+?)\s+слушать\s+онлайн/i
  );
  if (yandexSeoMatch) {
    return { artist: cleanText(yandexSeoMatch[2]), name: cleanText(yandexSeoMatch[1]), genre: '' };
  }

  const yandexTrackMatch = title.match(/Трек\s+[«"'](.+?)[»"']\s*\((.+?)\)/i);
  if (yandexTrackMatch) {
    return { artist: cleanText(yandexTrackMatch[2]), name: cleanText(yandexTrackMatch[1]), genre: '' };
  }

  const yandexAlbumMatch = title.match(/Альбом\s+[«"'](.+?)[»"']\s*\((.+?)\)/i);
  if (yandexAlbumMatch) {
    return { artist: cleanText(yandexAlbumMatch[2]), name: cleanText(yandexAlbumMatch[1]), genre: '' };
  }

  const byMatch = title.match(/^(.+)\s+by\s+(.+)$/i);
  if (byMatch) {
    return { artist: cleanText(byMatch[2]), name: cleanText(byMatch[1]), genre: '' };
  }

  for (const separator of [' - ', ' – ', ' — ', ' : ']) {
    if (title.includes(separator)) {
      const parts = title.split(separator);
      return {
        artist: cleanText(parts[0]),
        name: cleanText(parts.slice(1).join(separator)),
        genre: ''
      };
    }
  }

  try {
    const url = new URL(urlStr || '');
    const pathName = decodeURIComponent(
      url.pathname.replace(/\/$/, '').split('/').pop() || ''
    )
      .replace(/[-_]/g, ' ')
      .trim();
    return { artist: '', name: cleanText(title || pathName, 'Релиз'), genre: '' };
  } catch {
    return { artist: '', name: cleanText(title, 'Релиз'), genre: '' };
  }
}

const catalogParseApi = {
  GENRE_MAP,
  normalizeGenre,
  cleanText,
  cleanTrackTitle,
  parseYandexMusicUrl,
  yandexCoverUrl,
  joinNames,
  parseArtistAndTitle
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = catalogParseApi;
}
