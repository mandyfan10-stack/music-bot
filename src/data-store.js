// Слой данных: чистые функции, которые сводят снимки Supabase, дельты
// Realtime и оптимистичные toggle-операции в локальное состояние.
// Без DOM и сети — переиспользуется app.js (браузер) и тестами (Node).
// Зависит от utils.js: в браузере он подключён раньше, в Node — через require.

const dataStoreUtils = (typeof module !== 'undefined' && module.exports)
  ? require('./utils.js')
  : { isSameReview, upsertByMatcher, toRatingNumber };

// Сколько живёт локальное намерение пользователя (лайк/реакция). Пока оно
// действует, запоздалый Realtime-эвент или догоняющий снимок fetchDB не
// могут вернуть старое состояние (DELETE 204 → поздний INSERT).
const TOGGLE_INTENT_MS = 8000;

function rememberIntent(intents, id, on, now, ttlMs) {
  const at = typeof now === 'number' ? now : Date.now();
  const ttl = typeof ttlMs === 'number' ? ttlMs : TOGGLE_INTENT_MS;
  intents.set(String(id), { on: !!on, until: at + ttl });
}

// Накладывает живые намерения на набор id; просроченные удаляет из intents.
function applyIntent(intents, ids, now) {
  const at = typeof now === 'number' ? now : Date.now();
  const next = ids instanceof Set ? new Set(ids) : new Set(Array.isArray(ids) ? ids : []);
  intents.forEach((intent, id) => {
    if (!intent || at > intent.until) {
      intents.delete(id);
      return;
    }
    if (intent.on) next.add(id);
    else next.delete(id);
  });
  return next;
}

function isDuplicateToggleError(error) {
  const code = String((error && error.code) || '');
  const status = Number(error && error.status);
  const message = String((error && error.message) || '');
  return code === '23505' || status === 409 || /duplicate key|already exists/i.test(message);
}

// Снимок с сервера (fetchDB) для лайков/реакций: запросы в полёте сохраняют
// локальное значение, затем поверх накладываются живые намерения.
function mergeServerToggleSet(serverIds, localSet, pendingIds, intents, now) {
  const merged = new Set(serverIds || []);
  (pendingIds || new Set()).forEach((id) => {
    if (localSet && localSet.has(id)) merged.add(id);
    else merged.delete(id);
  });
  return applyIntent(intents, merged, now);
}

// Realtime INSERT/DELETE собственного лайка/реакции. Если по id есть запрос
// в полёте или живое намерение — побеждает локальное намерение.
function applyRealtimeToggle(currentSet, eventType, id, pendingIds, intents, now) {
  const next = new Set(currentSet || []);
  if (id == null || id === '') return next;
  if ((pendingIds && pendingIds.has(id)) || intents.has(String(id))) {
    return applyIntent(intents, next, now);
  }
  if (eventType === 'INSERT') next.add(id);
  else if (eventType === 'DELETE') next.delete(id);
  return next;
}

// Рецензии по релизу (новые сверху) и средняя оценка релиза.
function groupReviewsByRelease(reviews) {
  const byRelId = new Map();
  const avgByRelId = new Map();
  (reviews || []).forEach((r) => {
    if (!r) return;
    if (!byRelId.has(r.relId)) byRelId.set(r.relId, []);
    byRelId.get(r.relId).push(r);
  });
  byRelId.forEach((list, relId) => {
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const avg = list.length
      ? list.reduce((sum, r) => sum + dataStoreUtils.toRatingNumber(r.rating), 0) / list.length
      : 0;
    avgByRelId.set(relId, avg);
  });
  return { byRelId, avgByRelId };
}

// Комментарии по рецензии; в каждой ветке — по времени (старые сверху).
function groupCommentsByReview(comments) {
  const byReviewId = new Map();
  (comments || []).forEach((c) => {
    if (!c || !c.reviewId) return;
    if (!byReviewId.has(c.reviewId)) byReviewId.set(c.reviewId, []);
    byReviewId.get(c.reviewId).push(c);
  });
  byReviewId.forEach((list) => list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)));
  return byReviewId;
}

function countGenres(releases) {
  const counts = {};
  (releases || []).forEach((r) => {
    const g = (r && r.genre) || 'Другое';
    counts[g] = (counts[g] || 0) + 1;
  });
  return counts;
}

// Применяет дельту Realtime к состоянию каталога. Не мутирует вход.
// state: { releases, releasesById, reviews, comments, likedSet }
// delta: { releases, deletedReleaseIds, reviews, deletedReviewIds,
//          comments, deletedCommentIds }
function applyCatalogDelta(state, delta) {
  const d = delta || {};
  let releases = (state.releases || []).slice();
  const releasesById = new Map(state.releasesById || releases.map((r) => [r.id, r]));
  let reviews = (state.reviews || []).slice();
  let comments = (state.comments || []).slice();
  const likedSet = new Set(state.likedSet || []);
  const removedReleaseIds = [];
  let changed = false;
  let commentsChanged = false;

  (d.releases || []).forEach((r) => {
    if (!r || !r.id) return;
    const idx = releases.findIndex((x) => x.id === r.id);
    if (idx >= 0) releases[idx] = r;
    else releases.unshift(r);
    releasesById.set(r.id, r);
    changed = true;
  });

  (d.deletedReleaseIds || []).forEach((id) => {
    if (!releasesById.has(id)) return;
    releasesById.delete(id);
    releases = releases.filter((x) => x.id !== id);
    likedSet.delete(id);
    removedReleaseIds.push(id);
    changed = true;
  });

  (d.reviews || []).forEach((rv) => {
    if (!rv || !rv.id) return;
    reviews = dataStoreUtils.upsertByMatcher(reviews, rv, dataStoreUtils.isSameReview);
    changed = true;
  });

  (d.deletedReviewIds || []).forEach((id) => {
    const before = reviews.length;
    reviews = reviews.filter((x) => x.id !== id);
    if (reviews.length !== before) changed = true;
  });

  (d.comments || []).forEach((c) => {
    if (!c || !c.id) return;
    const idx = comments.findIndex((x) => x.id === c.id);
    if (idx >= 0) comments[idx] = c;
    else comments.push(c);
    commentsChanged = true;
  });

  (d.deletedCommentIds || []).forEach((id) => {
    const before = comments.length;
    comments = comments.filter((x) => x.id !== id);
    if (comments.length !== before) commentsChanged = true;
  });

  // Удалённые рецензии/релизы уносят свои комментарии (каскад).
  const goneReviewIds = new Set(d.deletedReviewIds || []);
  const goneReleaseIds = new Set(d.deletedReleaseIds || []);
  if (goneReviewIds.size || goneReleaseIds.size) {
    const before = comments.length;
    comments = comments.filter((c) => !goneReviewIds.has(c.reviewId) && !goneReleaseIds.has(c.relId));
    if (comments.length !== before) commentsChanged = true;
  }

  return {
    releases,
    releasesById,
    reviews,
    comments,
    likedSet,
    removedReleaseIds,
    changed,
    commentsChanged
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TOGGLE_INTENT_MS,
    rememberIntent,
    applyIntent,
    isDuplicateToggleError,
    mergeServerToggleSet,
    applyRealtimeToggle,
    groupReviewsByRelease,
    groupCommentsByReview,
    countGenres,
    applyCatalogDelta
  };
}
