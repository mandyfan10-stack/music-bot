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

// Managed Supabase Auth sessions use a UUID in `sub`; the stable Telegram ID
// is an admin-owned app_metadata claim. Numeric `sub` remains a compatibility
// fallback for already-issued legacy application JWTs during rollout.
function getTelegramIdFromClaims(claims) {
  const managedId = claims?.app_metadata?.telegram_user_id;
  if (managedId != null && String(managedId)) return String(managedId);
  return /^\d+$/.test(String(claims?.sub || '')) ? String(claims.sub) : '';
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

function isSameReview(left, right) {
  if (!left || !right) return false;
  if (left.id && right.id && left.id === right.id) return true;
  const leftAuthor = left.authorId != null ? String(left.authorId) : '';
  const rightAuthor = right.authorId != null ? String(right.authorId) : '';
  return !!(left.relId && left.relId === right.relId && leftAuthor && leftAuthor === rightAuthor);
}

function upsertByMatcher(list, item, isSame) {
  const items = Array.isArray(list) ? list.slice() : [];
  if (!item || typeof isSame !== 'function') return items;
  const idx = items.findIndex((existing) => isSame(existing, item));
  if (idx >= 0) items[idx] = Object.assign({}, items[idx], item);
  else items.unshift(item);
  return items;
}

const DEFAULT_CRITERIA_KEYS = [
  'sound', 'production', 'originality', 'meaning', 'relevance', 'image'
];

function reviewByUser(review, userId, displayName) {
  if (!review) return false;
  if (userId != null && review.authorId != null) {
    return String(review.authorId) === String(userId);
  }
  return !!displayName && review.author === displayName;
}

function computeProfileBadges(userReviews, getRelease) {
  const badges = [];
  const reviews = Array.isArray(userReviews) ? userReviews : [];
  const lookup = typeof getRelease === 'function' ? getRelease : () => null;
  const count = reviews.length;
  if (count >= 1) badges.push({ icon: 'pen-line', label: 'Первая рецензия' });
  if (count >= 10) badges.push({ icon: 'flame', label: 'Плодовитый' });
  if (count >= 25) badges.push({ icon: 'crown', label: 'Ветеран' });

  const genres = new Set();
  reviews.forEach((review) => {
    const rel = lookup(review && review.relId);
    genres.add((rel && rel.genre) || 'Другое');
  });
  if (genres.size >= 5) badges.push({ icon: 'disc-3', label: 'Меломан' });

  if (count >= 3) {
    const avg = reviews.reduce((sum, review) => sum + (Number(review.rating) || 0), 0) / count;
    if (avg < 5) badges.push({ icon: 'gavel', label: 'Строгий критик' });
    else if (avg >= 8) badges.push({ icon: 'sparkles', label: 'Щедрый' });
  }
  return badges;
}

function getCriteriaAverage(criteria, keys) {
  const list = Array.isArray(keys) && keys.length ? keys : DEFAULT_CRITERIA_KEYS;
  const source = criteria && typeof criteria === 'object' ? criteria : {};
  const values = list.map((key) => typeof source[key] === 'number' ? source[key] : 5);
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function formatCriteria(criteria, keys) {
  const list = Array.isArray(keys) && keys.length ? keys : DEFAULT_CRITERIA_KEYS;
  const source = criteria && typeof criteria === 'object' ? criteria : {};
  return list.map((key) => typeof source[key] === 'number' ? source[key] : 5).join('/');
}

function decodeJwtPayload(token) {
  try {
    const encoded = String(token || '').split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch (_) {
    return null;
  }
}

function isMissingRpcSignature(error) {
  const message = String(error && error.message || '');
  return error && error.code === 'PGRST202' || /could not find the function/i.test(message);
}

function pluralReviews(n) {
  const count = Number(n) || 0;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'рецензия';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'рецензии';
  return 'рецензий';
}

// Replaces a locally created row after the server assigns (or echoes) an id,
// and drops a Realtime duplicate that already arrived with the server id.
function adoptCreatedRecord(list, localId, createdId, item) {
  const items = Array.isArray(list) ? list.slice() : [];
  const nextId = createdId || localId;
  if (!nextId) return items;
  const kept = items.filter((existing) => existing && existing.id !== localId && existing.id !== nextId);
  const existing = items.find((entry) => entry && (entry.id === nextId || entry.id === localId));
  kept.unshift(Object.assign({}, existing || {}, item || {}, { id: nextId }));
  return kept;
}

if (typeof module !== 'undefined' && module.exports) {
  const catalogParse = require('./catalog-parse.js');
  module.exports = {
    cleanUsername,
    escapeHtml,
    escapeCssString,
    genId,
    getPublicCacheData,
    getTelegramIdFromClaims,
    getShareTarget,
    filterAndSortReleases,
    isSameReview,
    upsertByMatcher,
    adoptCreatedRecord,
    reviewByUser,
    computeProfileBadges,
    getCriteriaAverage,
    formatCriteria,
    decodeJwtPayload,
    isMissingRpcSignature,
    pluralReviews,
    ...catalogParse
  };
}
