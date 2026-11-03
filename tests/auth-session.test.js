const test = require('node:test');
const assert = require('node:assert');
const {
  AUTH_STORE_KEY,
  TOKEN_EXPIRY_MARGIN_MS,
  isUsableAccessToken,
  isValidAuthResponse,
  buildStoredSession,
  parseStoredSession,
  roleLabel
} = require('../src/auth-session.js');

const NOW = 1_800_000_000_000;

function jwt(claims) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'ES256', typ: 'JWT' })}.${enc(claims)}.sig`;
}

function userToken(telegramId, { expInMs = 3600_000, role = 'authenticated' } = {}) {
  return jwt({
    role,
    sub: '6f1e0c4a-uuid',
    exp: Math.floor((NOW + expInMs) / 1000),
    app_metadata: { telegram_user_id: String(telegramId) }
  });
}

test('the storage key stays stable so existing users keep their session', () => {
  assert.strictEqual(AUTH_STORE_KEY, 'xxii_auth_v1');
});

test('isUsableAccessToken accepts a fresh token for the right user only', () => {
  const token = userToken(42);
  assert.ok(isUsableAccessToken(token, 42, NOW));
  assert.ok(isUsableAccessToken(token, '42', NOW));
  assert.ok(isUsableAccessToken(token, null, NOW));
  assert.ok(!isUsableAccessToken(token, 7, NOW), 'another Telegram user');
  assert.ok(!isUsableAccessToken('', 42, NOW));
  assert.ok(!isUsableAccessToken('not-a-jwt', 42, NOW));
});

test('isUsableAccessToken rejects anon keys and tokens about to expire', () => {
  assert.ok(!isUsableAccessToken(userToken(42, { role: 'anon' }), null, NOW));
  assert.ok(!isUsableAccessToken(userToken(42, { expInMs: TOKEN_EXPIRY_MARGIN_MS - 1000 }), 42, NOW));
  assert.ok(isUsableAccessToken(userToken(42, { expInMs: TOKEN_EXPIRY_MARGIN_MS + 1000 }), 42, NOW));
  const noTelegramId = jwt({ role: 'authenticated', sub: 'uuid', exp: Math.floor(NOW / 1000) + 3600 });
  assert.ok(!isUsableAccessToken(noTelegramId, null, NOW));
});

test('isValidAuthResponse requires the token to match the returned profile', () => {
  assert.ok(isValidAuthResponse({ token: userToken(42), user: { userId: 42 } }, NOW));
  assert.ok(!isValidAuthResponse({ token: userToken(42), user: { userId: 43 } }, NOW));
  assert.ok(!isValidAuthResponse({ token: userToken(42, { expInMs: 1000 }), user: { userId: 42 } }, NOW));
  assert.ok(!isValidAuthResponse({ token: userToken(42) }, NOW));
  assert.ok(!isValidAuthResponse(null, NOW));
});

test('buildStoredSession → parseStoredSession round-trips the profile', () => {
  const token = userToken(42);
  const stored = buildStoredSession(token, { userId: 42, username: 'neo', isAdmin: true }, NOW);
  assert.strictEqual(stored.savedAt, NOW);
  const { session, clear } = parseStoredSession(JSON.stringify(stored), 42, NOW + 1000);
  assert.ok(!clear);
  assert.deepStrictEqual(session, { token, userId: 42, username: 'neo', isAdmin: true, isBlocked: false });
});

test('buildStoredSession refuses non-user tokens', () => {
  assert.strictEqual(buildStoredSession(userToken(42, { role: 'anon' }), {}, NOW), null);
  assert.strictEqual(buildStoredSession('', {}, NOW), null);
});

test('a session without a stored userId falls back to the numeric id from the token', () => {
  const { session } = parseStoredSession({ token: userToken(42) }, null, NOW);
  assert.strictEqual(session.userId, 42);
});

test('nothing stored is not an error and nothing gets cleared', () => {
  assert.deepStrictEqual(parseStoredSession(null, 42, NOW), { session: null, clear: false });
  assert.deepStrictEqual(parseStoredSession('null', 42, NOW), { session: null, clear: false });
});

test('expired, corrupted or mismatched sessions are cleared', () => {
  const stale = buildStoredSession(userToken(42, { expInMs: 10_000 }), { userId: 42 }, NOW);
  assert.deepStrictEqual(parseStoredSession(stale, 42, NOW), { session: null, clear: true });
  assert.deepStrictEqual(parseStoredSession('{broken', 42, NOW), { session: null, clear: true });

  const forged = { ...buildStoredSession(userToken(42), { userId: 42 }, NOW), userId: 7 };
  assert.deepStrictEqual(parseStoredSession(forged, null, NOW), { session: null, clear: true });
});

test('race: another Telegram account on the same device never inherits the session', () => {
  const stored = buildStoredSession(userToken(42), { userId: 42, isAdmin: true }, NOW);
  const result = parseStoredSession(stored, 7, NOW);
  assert.strictEqual(result.session, null);
  assert.ok(result.clear);
});

test('roleLabel', () => {
  assert.strictEqual(roleLabel(true), 'Создатель');
  assert.strictEqual(roleLabel(false), 'Пользователь');
});
