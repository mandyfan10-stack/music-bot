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

// Чистая фильтрация и сортировка каталога релизов.
// options:
//   genre        — точный фильтр по жанру ('' = без фильтра)
//   query        — текстовый поиск по name/artist/genre ('' = без поиска)
//   sortMode     — 'new' | 'rating-desc' | 'rating-asc' | 'reviews'
//   avgRating    — функция (id) => число (средний рейтинг релиза)
//   reviewCount  — функция (id) => число (кол-во рецензий релиза)
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
    filterAndSortReleases
  };
}
