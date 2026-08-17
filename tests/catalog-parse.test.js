const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  GENRE_MAP,
  normalizeGenre,
  cleanTrackTitle,
  parseArtistAndTitle,
  parseYandexMusicUrl,
  yandexCoverUrl
} = require('../src/catalog-parse.js');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'catalog-parse.json'), 'utf8')
);

test('catalog-parse fixtures: genres', () => {
  for (const row of fixture.genres) {
    assert.strictEqual(normalizeGenre(row.input), row.expected, row.input);
  }
});

test('catalog-parse fixtures: titles', () => {
  for (const row of fixture.titles) {
    assert.strictEqual(cleanTrackTitle(row.input), row.expected, row.input);
  }
});

test('catalog-parse fixtures: artist/title', () => {
  for (const row of fixture.artistTitle) {
    const parsed = parseArtistAndTitle(row.title, row.url);
    assert.strictEqual(parsed.artist, row.artist, row.title);
    assert.strictEqual(parsed.name, row.name, row.title);
  }
});

test('catalog-parse fixtures: yandex urls', () => {
  for (const row of fixture.yandexUrls) {
    const parsed = parseYandexMusicUrl(row.url);
    if (row.null) {
      assert.strictEqual(parsed, null, row.url);
      continue;
    }
    assert.ok(parsed, row.url);
    if (row.track_id) assert.strictEqual(parsed.track_id, row.track_id);
    if (row.album_id) assert.strictEqual(parsed.album_id, row.album_id);
  }
});

test('catalog-parse fixtures: covers', () => {
  for (const row of fixture.covers) {
    assert.strictEqual(yandexCoverUrl(row.input), row.expected, row.input);
  }
});

test('GENRE_MAP exposes the production superset keys', () => {
  assert.ok(GENRE_MAP['поп-панк']);
  assert.ok(GENRE_MAP['хаус']);
  assert.strictEqual(Object.keys(GENRE_MAP).length > 40, true);
});
