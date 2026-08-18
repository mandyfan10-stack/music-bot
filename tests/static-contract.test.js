const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('CSP does not allow inline scripts or obsolete script CDNs', () => {
  const html = read('index.html');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1] || '';
  const scriptSrc = csp.split(';').find((directive) => directive.trim().startsWith('script-src')) || '';
  assert.ok(scriptSrc);
  assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
  assert.doesNotMatch(scriptSrc, /unpkg\.com|cdn\.jsdelivr\.net/);
  assert.doesNotMatch(html, /\son(?:click|load|error|input|change)=/i);
});

test('all static data actions have delegated handlers', () => {
  const html = read('index.html');
  const app = read('src/app.js');
  const actions = [...html.matchAll(/data-act="([^"]+)"/g)].map((match) => match[1]);
  const handlers = new Set([...app.matchAll(/^\s*'([^']+)'\s*:/gm)].map((match) => match[1]));
  assert.deepStrictEqual([...new Set(actions)].filter((action) => !handlers.has(action)), []);
});

test('HTML element IDs are unique', () => {
  const ids = [...read('index.html').matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('visual chrome keeps sync status in the header and a single settings label', () => {
  const html = read('index.html');
  const css = read('src/styles.css');
  const app = read('src/app.js');
  const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] || '';
  assert.match(header, /id="sync-status"/);
  assert.match(header, /class="app-header/);
  assert.match(html, />Настройки<\/span><\/button>/);
  assert.doesNotMatch(html, />Опции</);
  assert.match(app, />НОВОЕ</);
  assert.doesNotMatch(app, />NEW</);
  assert.match(css, /--accent-red:\s*#ff0000/);
  assert.match(css, /header\.app-header/);
  assert.match(css, /color-scheme:\s*light/);
});

test('review form shows a criteria-total meter instead of a bare 1-10 row', () => {
  const html = read('index.html');
  const app = read('src/app.js');
  assert.match(html, /id="rating-total"/);
  assert.match(html, /id="rating-total-fill"/);
  assert.doesNotMatch(html, /id="rating-buttons-container"/);
  assert.match(app, /function updateRatingTotal/);
  assert.doesNotMatch(app, /function selectRating/);
  assert.doesNotMatch(app, /selectedRating/);
});

test('release sheet locks scroll while the cover morph plays', () => {
  const app = read('src/app.js');
  const css = read('src/styles.css');
  assert.match(app, /function lockReleaseSheet/);
  assert.match(app, /releaseSheetLocked/);
  assert.match(css, /#modal-release \.modal-container\.is-open-locked/);
});

test('opening a release from a profile closes the profile sheet first', () => {
  const app = read('src/app.js');
  assert.match(
    app,
    /function openRelease\([\s\S]*?closeModal\('modal-profile',\s*true\)/
  );
});

test('motion keeps iOS springs without review re-fade or tab blur', () => {
  const css = read('src/styles.css');
  const app = read('src/app.js');
  assert.match(css, /--ios-spring/);
  assert.match(css, /\.review-enter/);
  assert.match(css, /\.card-press:has\(button:active\)/);
  assert.doesNotMatch(css, /tabExitForward[^}]*blur\(/);
  assert.match(app, /seenReviewIds/);
  assert.match(app, /toastHideTimer/);
  assert.match(app, /bindEnterAnimations/);
  assert.match(app, /relImg\.style\.opacity = '0'/);
  assert.match(app, /revealReleaseCover/);
});

test('Telegram bootstrap auth explicitly bypasses gateway JWT verification', () => {
  const config = read('supabase/config.toml');
  assert.match(config, /\[functions\.auth\][\s\S]*?verify_jwt\s*=\s*false/);
});

test('remote metadata parser requires an authenticated user JWT', () => {
  const config = read('supabase/config.toml');
  const parser = read('supabase/functions/parse-link/index.ts');
  const app = read('src/app.js');
  assert.match(config, /\[functions\.parse-link\][\s\S]*?verify_jwt\s*=\s*true/);
  assert.match(parser, /requireGatewayVerifiedRole\([\s\S]*?"authenticated"/);
  assert.doesNotMatch(parser, /verifyTelegramInitData\(/);
  assert.doesNotMatch(parser, /requireParserAccess/);
  assert.match(app, /Authorization':\s*`Bearer \$\{parserToken\}`/);
  assert.doesNotMatch(app, /fetchOEmbedData|noembed\.com/);
});

test('share-message uses gateway role and managed Telegram claims', () => {
  const config = read('supabase/config.toml');
  const share = read('supabase/functions/share-message/index.ts');
  assert.match(config, /\[functions\.share-message\][\s\S]*?verify_jwt\s*=\s*true/);
  assert.match(share, /requireGatewayVerifiedRole\([\s\S]*?"authenticated"/);
  assert.match(share, /requireTelegramUserId\(/);
  assert.doesNotMatch(share, /Number\(payload\.sub\)/);
  assert.doesNotMatch(share, /JWT_SECRET|djwt/);
});

test('auth registers notification subscribers with the issued user JWT', () => {
  const auth = read('supabase/functions/auth/index.ts');
  assert.match(auth, /auth\.admin[\s\S]*?generateLink/);
  assert.match(auth, /verifyOtp\(/);
  assert.match(auth, /accessToken:\s*async \(\) => accessToken/);
  assert.match(auth, /userSupabase[\s\S]*?notification_subscribers/);
  assert.match(auth, /verifyTelegramInitData\(/);
  assert.doesNotMatch(auth, /DEV_MODE/);
  assert.doesNotMatch(auth, /parseTelegramUser\(/);
  assert.doesNotMatch(auth, /SUPABASE_JWT_SECRET/);
  assert.doesNotMatch(auth, /Deno\.env\.get\("JWT_SECRET"\)/);
});

test('Telegram application JWT bypasses GoTrue session APIs', () => {
  const app = read('src/app.js');
  const utils = read('src/utils.js');
  assert.match(app, /accessToken:\s*async \(\) => getApiBearerToken\(\)/);
  assert.match(app, /getTelegramIdFromClaims\(claims\)/);
  assert.match(utils, /claims\?\.app_metadata\?\.telegram_user_id/);
  assert.doesNotMatch(app, /supabase\??\.auth\.|\.auth\.setSession|\.auth\.getSession/);
});

test('public catalog starts in parallel with Telegram authentication', () => {
  const app = read('src/app.js');
  assert.match(app, /const authPromise = authenticateWithSupabase\(\);[\s\S]*?Promise\.all\(\[[\s\S]*?from\('releases'\)/);
  assert.doesNotMatch(app, /await authenticateWithSupabase\(\);[\s\S]{0,500}?from\('releases'\)/);
});

test('first catalog paint does not wait for comments_view', () => {
  const app = read('src/app.js');
  assert.match(app, /const commentsPromise = supabase\.from\('comments_view'\)/);
  assert.match(app, /const \[releasesRes, reviewsRes\] = await Promise\.all\(/);
  assert.doesNotMatch(app, /const \[releasesRes, reviewsRes, commentsRes\]/);
});

test('Telegram JWT is restored from localStorage before /auth', () => {
  const app = read('src/app.js');
  assert.match(app, /xxii_auth_v1/);
  assert.match(app, /function restoreAuthSession/);
  assert.match(app, /function persistAuthSession/);
  assert.match(app, /restoreAuthSession\(\)/);
});

test('boot path hides welcome early, announces Telegram ready, and defers heavy scripts', () => {
  const html = read('index.html');
  const boot = read('src/boot.js');
  const tw = read('src/telegram-web-app.js');
  const css = read('src/styles.css');
  assert.match(html, /rel="preconnect"[^>]+ftpofwybzvhvyukrshcm\.supabase\.co/);
  assert.match(html, /src="src\/boot\.js/);
  assert.match(html, /src="src\/supabase\.min\.js[^"]*" defer/);
  assert.match(html, /src="src\/lucide\.min\.js[^"]*" defer/);
  assert.match(html, /src="src\/app\.js[^"]*" defer/);
  assert.doesNotMatch(html, /@import url\('https:\/\/fonts\.googleapis\.com/);
  assert.match(boot, /is-returning/);
  assert.match(boot, /\.ready\(/);
  assert.match(tw, /function announceReady/);
  assert.match(css, /html\.is-returning #welcome-screen/);
});

test('public cache hydrates catalog without replacing account state', () => {
  const app = read('src/app.js');
  assert.match(app, /applyPublicData\(cached\)/);
  assert.doesNotMatch(app, /applyData\(cached\)/);
});

test('review and comment creates send a client id and merge Realtime races', () => {
  const app = read('src/app.js');
  const migration = read('supabase/migrations/20260817120000_accept_client_entity_ids.sql');
  assert.match(app, /rpcCreateWithOptionalId\('create_review'/);
  assert.match(app, /rpcCreateWithOptionalId\('create_comment'/);
  assert.match(app, /adoptCreatedRecord\(reviews/);
  assert.match(app, /upsertByMatcher\(reviews, rv, isSameReview\)/);
  assert.match(migration, /p_id TEXT DEFAULT NULL/);
});

test('release covers use a Telegram-authenticated server upload', () => {
  const config = read('supabase/config.toml');
  const cover = read('supabase/functions/release-cover/index.ts');
  const app = read('src/app.js');
  assert.match(config, /\[functions\.release-cover\][\s\S]*?verify_jwt\s*=\s*false/);
  assert.match(cover, /verifyTelegramInitData\(/);
  assert.match(cover, /from\("admins"\)/);
  assert.match(cover, /from\(BUCKET\)\.upload/);
  assert.match(app, /uploadReleaseCoverIfNeeded\(cover, releaseId\)/);
});

test('removed backend and local-admin compatibility paths do not return', () => {
  const app = read('src/app.js');
  assert.doesNotMatch(app, /syncLoopTick|dev_create_release|dev_delete_release|isExplicitAdmin/);
  assert.doesNotMatch(app, /xxii_cache_v2(?!(?:'\);))/);
});

test('JS and TS catalog-parse maps stay in lockstep', () => {
  const js = read('src/catalog-parse.js');
  const ts = read('supabase/functions/_shared/catalog_parse.ts');
  const keys = (source) => {
    const block = source.match(/GENRE_MAP[\s\S]*?=\s*\{([\s\S]*?)\n\};/)?.[1] || '';
    return [...block.matchAll(/['"]([^'"]+)['"]\s*:/g)].map((match) => match[1]).sort();
  };
  assert.deepStrictEqual(keys(js), keys(ts));
  assert.match(js, /function parseYandexMusicUrl/);
  assert.match(ts, /export function parseYandexMusicUrl/);
  assert.doesNotMatch(read('supabase/functions/parse-link/index.ts'), /const GENRE_MAP/);
});

test('pure app helpers live in utils.js, not in the IIFE', () => {
  const app = read('src/app.js');
  const utils = read('src/utils.js');
  assert.match(utils, /function reviewByUser/);
  assert.match(utils, /function computeProfileBadges/);
  assert.match(utils, /function decodeJwtPayload/);
  assert.match(utils, /function pluralReviews/);
  assert.doesNotMatch(app, /function reviewByUser\(/);
  assert.doesNotMatch(app, /function decodeJwtPayload\(/);
  assert.doesNotMatch(app, /function pluralReviews\(/);
});

test('database migration removes hosted development bypass RPCs', () => {
  const migration = read('supabase/migrations/20260816074509_protect_private_reactions_and_counts.sql');
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.dev_create_release/i);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.dev_delete_release/i);
});
