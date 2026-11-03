// Черновики рецензий: текст и оценки по критериям переживают закрытие
// шторки, открытие другого релиза и перезапуск приложения. Чистые функции
// без DOM — хранилище (localStorage) передаётся снаружи, поэтому их можно
// тестировать в Node. Ключ привязан к пользователю и релизу: другой аккаунт
// Telegram на том же устройстве чужой черновик не увидит.

const REVIEW_DRAFT_PREFIX = 'xxii_review_draft_v1:';
const REVIEW_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REVIEW_DRAFT_MAX_TEXT = 3000;
const REVIEW_DRAFT_CRITERIA = ['sound', 'production', 'originality', 'meaning', 'relevance', 'image'];
const REVIEW_DRAFT_DEFAULT_SCORE = 5;

function reviewDraftKey(userId, releaseId) {
  if (userId == null || userId === '' || !releaseId) return '';
  return `${REVIEW_DRAFT_PREFIX}${userId}:${releaseId}`;
}

function normalizeDraftCriteria(criteria) {
  const out = {};
  REVIEW_DRAFT_CRITERIA.forEach((key) => {
    const value = Number(criteria && criteria[key]);
    out[key] = Number.isInteger(value) && value >= 1 && value <= 10 ? value : REVIEW_DRAFT_DEFAULT_SCORE;
  });
  return out;
}

// Пустой черновик (нет текста, все оценки по умолчанию) хранить незачем.
function isEmptyReviewDraft(draft) {
  if (!draft) return true;
  const text = String(draft.text || '');
  const criteria = normalizeDraftCriteria(draft.criteria);
  return text.trim() === '' && REVIEW_DRAFT_CRITERIA.every((key) => criteria[key] === REVIEW_DRAFT_DEFAULT_SCORE);
}

function serializeReviewDraft(draft, now) {
  if (isEmptyReviewDraft(draft)) return null;
  return JSON.stringify({
    text: String(draft.text || '').slice(0, REVIEW_DRAFT_MAX_TEXT),
    criteria: normalizeDraftCriteria(draft.criteria),
    savedAt: typeof now === 'number' ? now : Date.now()
  });
}

// Возвращает { text, criteria, savedAt } или null для пустого, повреждённого
// или просроченного черновика.
function parseReviewDraft(raw, now) {
  if (!raw) return null;
  let data;
  try { data = JSON.parse(raw); } catch (_) { return null; }
  if (!data || typeof data !== 'object') return null;
  const at = typeof now === 'number' ? now : Date.now();
  const savedAt = Number(data.savedAt) || 0;
  if (!savedAt || at - savedAt > REVIEW_DRAFT_TTL_MS) return null;
  const draft = {
    text: typeof data.text === 'string' ? data.text.slice(0, REVIEW_DRAFT_MAX_TEXT) : '',
    criteria: normalizeDraftCriteria(data.criteria),
    savedAt
  };
  return isEmptyReviewDraft(draft) ? null : draft;
}

// Сохраняет черновик или удаляет запись, если он пуст. Ошибки хранилища
// (переполнение, приватный режим) не должны ломать ввод рецензии.
function writeReviewDraft(storage, userId, releaseId, draft, now) {
  const key = reviewDraftKey(userId, releaseId);
  if (!key || !storage) return false;
  try {
    const value = serializeReviewDraft(draft, now);
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
    return true;
  } catch (_) {
    return false;
  }
}

function readReviewDraft(storage, userId, releaseId, now) {
  const key = reviewDraftKey(userId, releaseId);
  if (!key || !storage) return null;
  try {
    const draft = parseReviewDraft(storage.getItem(key), now);
    if (!draft) storage.removeItem(key);
    return draft;
  } catch (_) {
    return null;
  }
}

function clearReviewDraft(storage, userId, releaseId) {
  return writeReviewDraft(storage, userId, releaseId, null);
}

// Удаляет просроченные и повреждённые черновики всех пользователей.
function pruneReviewDrafts(storage, now) {
  if (!storage) return 0;
  let removed = 0;
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.indexOf(REVIEW_DRAFT_PREFIX) === 0) keys.push(key);
    }
    keys.forEach((key) => {
      if (!parseReviewDraft(storage.getItem(key), now)) {
        storage.removeItem(key);
        removed++;
      }
    });
  } catch (_) {}
  return removed;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    REVIEW_DRAFT_PREFIX,
    REVIEW_DRAFT_TTL_MS,
    reviewDraftKey,
    isEmptyReviewDraft,
    serializeReviewDraft,
    parseReviewDraft,
    writeReviewDraft,
    readReviewDraft,
    clearReviewDraft,
    pruneReviewDrafts
  };
}
