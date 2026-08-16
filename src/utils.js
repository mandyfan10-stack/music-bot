function cleanUsername(username) {
  if (!username) return '';
  return String(username).replace(/^@/, '').toLowerCase();
}

function escapeHtml(str) {
  // Проверяем именно на null/undefined: число 0 и false — валидные значения,
  // которые должны рендериться как "0"/"false", а не теряться.
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeCssString(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '\\D ')
    .replace(/\f/g, '\\C ');
}

// Глобально уникальный id для создаваемых сущностей (релизы, рецензии,
// комментарии). На поле `id` в БД стоят unique-индексы, а Date.now() у двух
// пользователей в одну миллисекунду совпадёт → коллизия и ложная ошибка вставки.
// crypto.randomUUID — основной путь, фолбэк — для старых WebView без него.
function genId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (e) { /* нет crypto — используем фолбэк ниже */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// В офлайн-кэш попадают только публичные данные каталога. Лайки, реакции,
// блокировки и профиль текущего пользователя намеренно исключены, чтобы
// данные одного Telegram-аккаунта не показывались другому в том же WebView.
function getPublicCacheData(data) {
  const source = data && typeof data === 'object' ? data : {};
  return {
    releases: Array.isArray(source.releases) ? source.releases : [],
    reviews: Array.isArray(source.reviews) ? source.reviews : [],
    comments: Array.isArray(source.comments) ? source.comments : []
  };
}

// Серверный deep-link предпочтительнее ссылки на музыкальную площадку, но
// обе ссылки должны быть обычными HTTP(S) URL.
function getShareTarget(serverDeepLink, releaseLink) {
  for (const candidate of [serverDeepLink, releaseLink]) {
    if (!candidate) continue;
    try {
      const url = new URL(String(candidate));
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    } catch (_) {}
  }
  return '';
}

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
  'grunge': 'Рок',
  'pop-punk': 'Рок',
  'electronics': 'Электронная',
  'electronic': 'Электронная',
  'электроника': 'Электронная',
  'электронная': 'Электронная',
  'edm': 'Электронная',
  'dance': 'Электронная',
  'club': 'Электронная',
  'house': 'Электронная',
  'techno': 'Электронная',
  'trance': 'Электронная',
  'dubstep': 'Электронная',
  'dnb': 'Электронная',
  'metal': 'Метал',
  'метал': 'Метал',
  'heavy metal': 'Метал',
  'metalcore': 'Метал',
  'hardrock': 'Метал',
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

function parseArtistAndTitle(rawTitle, urlStr) {
  let title = cleanTrackTitle(rawTitle);

  // Шаблон Яндекс Музыки (SEO заголовок): "<Название> (альбом|трек|сингл|песня) <Артисты> слушать онлайн..."
  const yandexSeoMatch = title.match(/^(.+?)\s+(?:альбом|трек|сингл|песня)\s+(.+?)\s+слушать\s+онлайн/i);
  if (yandexSeoMatch) {
    return {
      artist: yandexSeoMatch[2].trim(),
      name: yandexSeoMatch[1].trim(),
      genre: ''
    };
  }

  // Шаблон Яндекс Музыки: "Трек «EUPHORIA» (SALUKI) слушать онлайн..."
  const yandexTrackMatch = title.match(/Трек\s+[«"'](.+?)[»"']\s*\((.+?)\)/i);
  if (yandexTrackMatch) {
    return {
      artist: yandexTrackMatch[2].trim(),
      name: yandexTrackMatch[1].trim(),
      genre: ''
    };
  }

  // Шаблон Яндекс Музыки: "Альбом «WILD EA$T» (SALUKI)..."
  const yandexAlbumMatch = title.match(/Альбом\s+[«"'](.+?)[»"']\s*\((.+?)\)/i);
  if (yandexAlbumMatch) {
    return {
      artist: yandexAlbumMatch[2].trim(),
      name: yandexAlbumMatch[1].trim(),
      genre: ''
    };
  }

  // Шаблон "Track by Artist"
  const byMatch = title.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return {
      artist: byMatch[2].trim(),
      name: byMatch[1].trim(),
      genre: ''
    };
  }

  // Разделители "Artist - Track"
  for (const separator of [' - ', ' – ', ' — ', ' : ']) {
    if (title.includes(separator)) {
      const parts = title.split(separator);
      return {
        artist: parts[0].trim(),
        name: parts.slice(1).join(separator).trim(),
        genre: ''
      };
    }
  }

  try {
    const url = new URL(urlStr || '');
    const pathName = decodeURIComponent(url.pathname.replace(/\/$/, '').split('/').pop() || '')
      .replace(/[-_]/g, ' ')
      .trim();
    return {
      artist: '',
      name: title || pathName || 'Релиз',
      genre: ''
    };
  } catch {
    return { artist: '', name: title || 'Релиз', genre: '' };
  }
}

// Чистая фильтрация и сортировка каталога релизов.
function filterAndSortReleases(releases, options) {
  const opts = options || {};
  const genre = opts.genre || '';
  const query = (opts.query || '').toLowerCase();
  const sortMode = opts.sortMode || 'new';
  const avgRating = typeof opts.avgRating === 'function' ? opts.avgRating : () => 0;
  const reviewCount = typeof opts.reviewCount === 'function' ? opts.reviewCount : () => 0;

  let filtered = Array.isArray(releases) ? releases.slice() : [];

  if (genre) {
    filtered = filtered.filter(r => (r.genre || 'Другое') === genre);
  }

  if (query) {
    filtered = filtered.filter(r =>
      (r.name || '').toLowerCase().includes(query) ||
      (r.artist || '').toLowerCase().includes(query) ||
      (r.genre || '').toLowerCase().includes(query)
    );
  }

  switch (sortMode) {
    case 'rating-desc':
      filtered.sort((a, b) => avgRating(b.id) - avgRating(a.id));
      break;
    case 'rating-asc':
      filtered.sort((a, b) => avgRating(a.id) - avgRating(b.id));
      break;
    case 'reviews':
      filtered.sort((a, b) => reviewCount(b.id) - reviewCount(a.id));
      break;
    default: // 'new'
      filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  return filtered;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cleanUsername,
    escapeHtml,
    escapeCssString,
    genId,
    getPublicCacheData,
    getShareTarget,
    normalizeGenre,
    cleanTrackTitle,
    parseArtistAndTitle,
    filterAndSortReleases
  };
}
