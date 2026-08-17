const test = require('node:test');
const assert = require('node:assert');
const {
  cleanUsername,
  escapeHtml,
  escapeCssString,
  genId,
  getPublicCacheData,
  getTelegramIdFromClaims,
  getShareTarget,
  normalizeGenre,
  cleanTrackTitle,
  parseArtistAndTitle,
  filterAndSortReleases,
  isSameReview,
  upsertByMatcher,
  adoptCreatedRecord
} = require('../src/utils.js');

test('cleanUsername: should remove leading @ and convert to lowercase', () => {
  assert.strictEqual(cleanUsername('@User'), 'user');
  assert.strictEqual(cleanUsername('@admin'), 'admin');
});

test('cleanUsername: should convert to lowercase even if no @ is present', () => {
  assert.strictEqual(cleanUsername('User'), 'user');
  assert.strictEqual(cleanUsername('ADMIN'), 'admin');
});

test('cleanUsername: should handle empty strings and null/undefined', () => {
  assert.strictEqual(cleanUsername(''), '');
  assert.strictEqual(cleanUsername(null), '');
  assert.strictEqual(cleanUsername(undefined), '');
});

test('cleanUsername: should handle non-string inputs by converting to string first', () => {
  assert.strictEqual(cleanUsername(123), '123');
});

test('cleanUsername: should only remove the first @ if it is at the start', () => {
  assert.strictEqual(cleanUsername('user@domain'), 'user@domain');
  assert.strictEqual(cleanUsername('@@user'), '@user');
});

test('escapeHtml: should escape HTML special characters', () => {
    assert.strictEqual(escapeHtml('10/10/10<script>alert(1)</script>'), '10/10/10&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.strictEqual(escapeHtml('10/10/"onclick="alert(1)"'), '10/10/&quot;onclick=&quot;alert(1)&quot;');
});

test('escapeHtml: should return empty string for null, undefined, or empty string', () => {
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
    assert.strictEqual(escapeHtml(''), '');
});

test('escapeHtml: should escape all occurrences of special characters', () => {
    assert.strictEqual(escapeHtml('&&&'), '&amp;&amp;&amp;');
    assert.strictEqual(escapeHtml('<<<'), '&lt;&lt;&lt;');
    assert.strictEqual(escapeHtml('>>>'), '&gt;&gt;&gt;');
    assert.strictEqual(escapeHtml('"""'), '&quot;&quot;&quot;');
    assert.strictEqual(escapeHtml("'''"), '&#39;&#39;&#39;');
});

test('escapeHtml: should convert non-strings to strings and escape them', () => {
    assert.strictEqual(escapeHtml(123), '123');
    assert.strictEqual(escapeHtml(true), 'true');
});

test('escapeHtml: should preserve falsy non-nullish values like 0 and false', () => {
    assert.strictEqual(escapeHtml(0), '0');
    assert.strictEqual(escapeHtml(false), 'false');
});

test('escapeHtml: should escape a complex mix of characters', () => {
    assert.strictEqual(
        escapeHtml('Text with & < > " and \''),
        'Text with &amp; &lt; &gt; &quot; and &#39;'
    );
});

test('escapeCssString: should escape selector string delimiters', () => {
    assert.strictEqual(escapeCssString('release"one\\two'), 'release\\"one\\\\two');
});

test('escapeCssString: should escape CSS line terminators', () => {
    assert.strictEqual(escapeCssString('a\nb\rc\f'), 'a\\A b\\D c\\C ');
});

// --- genId ---
test('genId: returns a non-empty string', () => {
    const id = genId();
    assert.strictEqual(typeof id, 'string');
    assert.ok(id.length > 0);
});

test('genId: consecutive calls do not collide', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) ids.add(genId());
    assert.strictEqual(ids.size, 1000);
});

test('getPublicCacheData: excludes account-specific and privileged state', () => {
  const cached = getPublicCacheData({
    releases: [{ id: 'r1' }],
    reviews: [{ id: 'v1' }],
    comments: [{ id: 'c1' }],
    likes: ['r1'],
    myReactions: ['v1'],
    blockedUsers: ['private-user'],
    blockedUserIds: ['123'],
    currentUser: { userId: 123, isAdmin: true }
  });
  assert.deepStrictEqual(cached, {
    releases: [{ id: 'r1' }],
    reviews: [{ id: 'v1' }],
    comments: [{ id: 'c1' }]
  });
});

test('getPublicCacheData: normalizes malformed cache arrays', () => {
  assert.deepStrictEqual(getPublicCacheData({ releases: null }), {
    releases: [], reviews: [], comments: []
  });
});

test('getTelegramIdFromClaims: reads managed Auth app_metadata', () => {
  assert.strictEqual(getTelegramIdFromClaims({
    sub: '00000000-0000-0000-0000-000000000123',
    app_metadata: { telegram_user_id: '123456' }
  }), '123456');
});

test('getTelegramIdFromClaims: supports numeric legacy sub during rollout', () => {
  assert.strictEqual(getTelegramIdFromClaims({ sub: '987654' }), '987654');
});

test('getTelegramIdFromClaims: rejects UUID sub without the managed claim', () => {
  assert.strictEqual(getTelegramIdFromClaims({
    sub: '00000000-0000-0000-0000-000000000123'
  }), '');
});

test('getShareTarget: prefers a valid server deep-link', () => {
  assert.strictEqual(
    getShareTarget('https://t.me/example/app?startapp=r1', 'https://music.example/r1'),
    'https://t.me/example/app?startapp=r1'
  );
});

test('getShareTarget: falls back to release URL and rejects unsafe schemes', () => {
  assert.strictEqual(
    getShareTarget('javascript:alert(1)', 'https://music.example/r1'),
    'https://music.example/r1'
  );
  assert.strictEqual(getShareTarget('data:text/html,x', 'file:///tmp/release'), '');
});

// --- normalizeGenre ---
test('normalizeGenre: correctly maps russian and english genres', () => {
  assert.strictEqual(normalizeGenre('rusrap'), 'Рэп');
  assert.strictEqual(normalizeGenre('trap'), 'Трэп');
  assert.strictEqual(normalizeGenre('rusrock'), 'Рок');
  assert.strictEqual(normalizeGenre('ruspop'), 'Поп');
  assert.strictEqual(normalizeGenre('electronics'), 'Электронная');
  assert.strictEqual(normalizeGenre('r&b'), 'R&B');
  assert.strictEqual(normalizeGenre('unknown_genre_xyz'), 'Другое');
  assert.strictEqual(normalizeGenre(''), '');
});

// --- cleanTrackTitle ---
test('cleanTrackTitle: removes platform names and video suffixes', () => {
  assert.strictEqual(cleanTrackTitle('SALUKI - EUPHORIA (Official Video)'), 'SALUKI - EUPHORIA');
  assert.strictEqual(cleanTrackTitle('OG Buda - Слёзы [Премьера клипа] | YouTube'), 'OG Buda - Слёзы');
  assert.strictEqual(cleanTrackTitle('Big Baby Tape - Like A G6 (Lyric Video) - Spotify'), 'Big Baby Tape - Like A G6');
  assert.strictEqual(cleanTrackTitle('Macan - Самый пьяный округ в мире (Audio)'), 'Macan - Самый пьяный округ в мире');
});

test('parseArtistAndTitle: handles Yandex Music SEO title format', () => {
  const parsedAlbum = parseArtistAndTitle(
    'ммлк1 альбом мистер модератор, lafkrat слушать онлайн бесплатно на Яндекс Музыке в хорошем качестве',
    'https://music.yandex.ru/album/43309876'
  );
  assert.strictEqual(parsedAlbum.artist, 'мистер модератор, lafkrat');
  assert.strictEqual(parsedAlbum.name, 'ммлк1');

  const parsedTrack = parseArtistAndTitle(
    'некрономикон трек мистер модератор, lafkrat слушать онлайн бесплатно на Яндекс Музыке в хорошем качестве',
    'https://music.yandex.ru/album/43309876/track/154249627'
  );
  assert.strictEqual(parsedTrack.artist, 'мистер модератор, lafkrat');
  assert.strictEqual(parsedTrack.name, 'некрономикон');
});

test('parseArtistAndTitle: handles Yandex Music track format', () => {
  const parsed = parseArtistAndTitle('Трек «EUPHORIA» (SALUKI) слушать онлайн на Яндекс Музыке', 'https://music.yandex.ru/album/25394013/track/112638848');
  assert.strictEqual(parsed.artist, 'SALUKI');
  assert.strictEqual(parsed.name, 'EUPHORIA');
});

test('parseArtistAndTitle: handles Yandex Music album format', () => {
  const parsed = parseArtistAndTitle('Альбом «WILD EA$T» (SALUKI) слушать онлайн на Яндекс Музыке', 'https://music.yandex.ru/album/25394013');
  assert.strictEqual(parsed.artist, 'SALUKI');
  assert.strictEqual(parsed.name, 'WILD EA$T');
});

test('parseArtistAndTitle: handles standard Artist - Track format', () => {
  const parsed = parseArtistAndTitle('SALUKI — EUPHORIA (Official Video)', 'https://youtube.com/watch?v=123');
  assert.strictEqual(parsed.artist, 'SALUKI');
  assert.strictEqual(parsed.name, 'EUPHORIA');
});

test('parseArtistAndTitle: handles Track by Artist format', () => {
  const parsed = parseArtistAndTitle('EUPHORIA by SALUKI', 'https://open.spotify.com/track/123');
  assert.strictEqual(parsed.artist, 'SALUKI');
  assert.strictEqual(parsed.name, 'EUPHORIA');
});

// --- filterAndSortReleases ---
const SAMPLE = [
  { id: 'a', name: 'Закат', artist: 'Гром', genre: 'Рэп', timestamp: 30 },
  { id: 'b', name: 'Рассвет', artist: 'Луна', genre: 'Поп', timestamp: 10 },
  { id: 'c', name: 'Полдень', artist: 'Гром', genre: 'Рэп', timestamp: 20 },
];

test('filterAndSortReleases: default sort is newest first by timestamp', () => {
  const out = filterAndSortReleases(SAMPLE, {});
  assert.deepStrictEqual(out.map(r => r.id), ['a', 'c', 'b']);
});

test('filterAndSortReleases: genre filter keeps only matching releases', () => {
  const out = filterAndSortReleases(SAMPLE, { genre: 'Поп' });
  assert.deepStrictEqual(out.map(r => r.id), ['b']);
});

test('filterAndSortReleases: missing genre falls back to "Другое"', () => {
  const items = [{ id: 'x', name: 'X', timestamp: 1 }];
  assert.strictEqual(filterAndSortReleases(items, { genre: 'Другое' }).length, 1);
  assert.strictEqual(filterAndSortReleases(items, { genre: 'Рэп' }).length, 0);
});

test('filterAndSortReleases: query matches name, artist or genre, case-insensitive', () => {
  assert.deepStrictEqual(filterAndSortReleases(SAMPLE, { query: 'закат' }).map(r => r.id), ['a']);
  assert.deepStrictEqual(filterAndSortReleases(SAMPLE, { query: 'гром' }).map(r => r.id), ['a', 'c']);
  assert.deepStrictEqual(filterAndSortReleases(SAMPLE, { query: 'поп' }).map(r => r.id), ['b']);
});

test('filterAndSortReleases: genre filter and query combine', () => {
  const out = filterAndSortReleases(SAMPLE, { genre: 'Рэп', query: 'полдень' });
  assert.deepStrictEqual(out.map(r => r.id), ['c']);
});

test('filterAndSortReleases: rating sort uses the avgRating lookup', () => {
  const avg = { a: 4, b: 9, c: 6 };
  const opts = { avgRating: (id) => avg[id] || 0 };
  assert.deepStrictEqual(
    filterAndSortReleases(SAMPLE, { ...opts, sortMode: 'rating-desc' }).map(r => r.id),
    ['b', 'c', 'a']
  );
  assert.deepStrictEqual(
    filterAndSortReleases(SAMPLE, { ...opts, sortMode: 'rating-asc' }).map(r => r.id),
    ['a', 'c', 'b']
  );
});

test('filterAndSortReleases: reviews sort uses the reviewCount lookup', () => {
  const counts = { a: 1, b: 5, c: 2 };
  const out = filterAndSortReleases(SAMPLE, {
    sortMode: 'reviews',
    reviewCount: (id) => counts[id] || 0,
  });
  assert.deepStrictEqual(out.map(r => r.id), ['b', 'c', 'a']);
});

test('filterAndSortReleases: does not mutate the input array', () => {
  const input = SAMPLE.slice();
  const before = input.map(r => r.id);
  filterAndSortReleases(input, { sortMode: 'new' });
  assert.deepStrictEqual(input.map(r => r.id), before);
});

test('filterAndSortReleases: tolerates nullish input', () => {
  assert.deepStrictEqual(filterAndSortReleases(null, {}), []);
  assert.deepStrictEqual(filterAndSortReleases(undefined), []);
});

test('isSameReview: matches by id or by release plus author', () => {
  assert.strictEqual(isSameReview({ id: 'a' }, { id: 'a' }), true);
  assert.strictEqual(isSameReview(
    { id: 'temp', relId: 'r1', authorId: 7 },
    { id: 'server', relId: 'r1', authorId: '7' }
  ), true);
  assert.strictEqual(isSameReview(
    { id: 'temp', relId: 'r1', authorId: 7 },
    { id: 'other', relId: 'r1', authorId: 8 }
  ), false);
});

test('upsertByMatcher: updates an existing review in place', () => {
  const out = upsertByMatcher(
    [{ id: 'temp', relId: 'r1', authorId: 1, text: 'old' }],
    { id: 'server', relId: 'r1', authorId: 1, text: 'new' },
    isSameReview
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'server');
  assert.strictEqual(out[0].text, 'new');
});

test('adoptCreatedRecord: drops a Realtime duplicate and keeps one row', () => {
  const out = adoptCreatedRecord(
    [
      { id: 'temp', text: 'local' },
      { id: 'server', text: 'realtime' }
    ],
    'temp',
    'server',
    { id: 'server', text: 'saved', author: 'Alice' }
  );
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0], { id: 'server', text: 'saved', author: 'Alice' });
});
