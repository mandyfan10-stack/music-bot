// Сессия входа: проверка JWT Supabase Auth, сохранение и восстановление из
// localStorage. Чистые функции без DOM и сети — используются app.js
// (браузер) и тестами (Node). Сеть (вызов Edge Function auth) остаётся в
// app.js. Зависит от utils.js: decodeJwtPayload, getTelegramIdFromClaims.

const authSessionUtils = (typeof module !== 'undefined' && module.exports)
  ? require('./utils.js')
  : { decodeJwtPayload, getTelegramIdFromClaims };

const AUTH_STORE_KEY = 'xxii_auth_v1';
// Токен, который истекает в ближайшие 30 с, считаем уже истёкшим: иначе
// запрос уйдёт с живым токеном, а дойдёт до сервера с мёртвым.
const TOKEN_EXPIRY_MARGIN_MS = 30_000;

// Claims пользовательского токена или null, если это не токен пользователя
// Telegram (anon key, мусор, токен без telegram_user_id).
function readUserToken(token) {
  if (!token) return null;
  const claims = authSessionUtils.decodeJwtPayload(token);
  if (!claims || claims.role !== 'authenticated') return null;
  const telegramId = authSessionUtils.getTelegramIdFromClaims(claims);
  if (!telegramId) return null;
  return { claims, telegramId };
}

function isTokenFresh(claims, now) {
  const at = typeof now === 'number' ? now : Date.now();
  return Number((claims && claims.exp) || 0) * 1000 > at + TOKEN_EXPIRY_MARGIN_MS;
}

// Токен годится для запросов от имени expectedUserId (null — любой пользователь).
function isUsableAccessToken(token, expectedUserId, now) {
  const parsed = readUserToken(token);
  if (!parsed) return false;
  if (expectedUserId != null && parsed.telegramId !== String(expectedUserId)) return false;
  return isTokenFresh(parsed.claims, now);
}

// Ответ Edge Function auth: токен должен принадлежать тому же пользователю,
// что и профиль, и не быть на грани истечения.
function isValidAuthResponse(data, now) {
  if (!data || !data.user) return false;
  const parsed = readUserToken(data.token);
  return !!parsed
    && parsed.telegramId === String(data.user.userId)
    && isTokenFresh(parsed.claims, now);
}

// Запись для localStorage или null, если токен не пользовательский.
function buildStoredSession(token, profile, now) {
  const parsed = readUserToken(token);
  if (!parsed) return null;
  const p = profile || {};
  return {
    token,
    userId: p.userId != null ? p.userId : parsed.telegramId,
    username: p.username || '',
    isAdmin: !!p.isAdmin,
    isBlocked: !!p.isBlocked,
    savedAt: typeof now === 'number' ? now : Date.now()
  };
}

// Разбирает сохранённую сессию. Возвращает { session, clear }:
// session — данные для восстановления (или null), clear — запись надо стереть
// (истёкший токен, чужой пользователь, повреждённые данные).
// currentTelegramId — id из initData текущего запуска, если он известен:
// токен другого аккаунта Telegram на том же устройстве не восстанавливаем.
function parseStoredSession(rawValue, currentTelegramId, now) {
  let raw = rawValue;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { return { session: null, clear: true }; }
  }
  if (!raw || typeof raw !== 'object' || !raw.token) return { session: null, clear: false };

  const parsed = readUserToken(raw.token);
  if (!parsed || !isTokenFresh(parsed.claims, now)) return { session: null, clear: true };
  if (raw.userId != null && String(raw.userId) !== parsed.telegramId) return { session: null, clear: true };
  if (currentTelegramId != null && String(currentTelegramId) !== parsed.telegramId) {
    return { session: null, clear: true };
  }

  return {
    clear: false,
    session: {
      token: raw.token,
      userId: raw.userId != null ? raw.userId : (Number(parsed.telegramId) || parsed.telegramId),
      username: raw.username || '',
      isAdmin: !!raw.isAdmin,
      isBlocked: !!raw.isBlocked
    }
  };
}

function roleLabel(isAdmin) {
  return isAdmin ? 'Создатель' : 'Пользователь';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AUTH_STORE_KEY,
    TOKEN_EXPIRY_MARGIN_MS,
    readUserToken,
    isTokenFresh,
    isUsableAccessToken,
    isValidAuthResponse,
    buildStoredSession,
    parseStoredSession,
    roleLabel
  };
}
