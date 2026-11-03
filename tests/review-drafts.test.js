const test = require('node:test');
const assert = require('node:assert');
const {
  REVIEW_DRAFT_TTL_MS,
  reviewDraftKey,
  isEmptyReviewDraft,
  parseReviewDraft,
  writeReviewDraft,
  readReviewDraft,
  clearReviewDraft,
  pruneReviewDrafts
} = require('../src/review-drafts.js');

const NOW = 1_800_000_000_000;
const DEFAULTS = { sound: 5, production: 5, originality: 5, meaning: 5, relevance: 5, image: 5 };

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    dump: () => Object.fromEntries(data)
  };
}

test('a draft survives closing the sheet and coming back', () => {
  const storage = memoryStorage();
  const draft = { text: 'Плотный бас и живые барабаны', criteria: { ...DEFAULTS, sound: 9 } };
  assert.ok(writeReviewDraft(storage, 42, 'r1', draft, NOW));
  const restored = readReviewDraft(storage, 42, 'r1', NOW + 60_000);
  assert.strictEqual(restored.text, draft.text);
  assert.deepStrictEqual(restored.criteria, draft.criteria);
});

test('drafts are separate per release and per Telegram account', () => {
  const storage = memoryStorage();
  writeReviewDraft(storage, 42, 'r1', { text: 'про первый', criteria: DEFAULTS }, NOW);
  writeReviewDraft(storage, 42, 'r2', { text: 'про второй', criteria: DEFAULTS }, NOW);
  assert.strictEqual(readReviewDraft(storage, 42, 'r1', NOW).text, 'про первый');
  assert.strictEqual(readReviewDraft(storage, 42, 'r2', NOW).text, 'про второй');
  assert.strictEqual(readReviewDraft(storage, 7, 'r1', NOW), null, 'another account sees nothing');
  assert.strictEqual(reviewDraftKey(42, 'r1'), reviewDraftKey('42', 'r1'));
});

test('criteria-only drafts are kept; an untouched form is not stored', () => {
  const storage = memoryStorage();
  writeReviewDraft(storage, 42, 'r1', { text: '', criteria: { ...DEFAULTS, meaning: 2 } }, NOW);
  assert.strictEqual(readReviewDraft(storage, 42, 'r1', NOW).criteria.meaning, 2);
  writeReviewDraft(storage, 42, 'r1', { text: '   ', criteria: DEFAULTS }, NOW);
  assert.deepStrictEqual(storage.dump(), {}, 'emptying the form removes the draft');
  assert.ok(isEmptyReviewDraft({ text: '', criteria: {} }));
});

test('publishing clears the draft', () => {
  const storage = memoryStorage();
  writeReviewDraft(storage, 42, 'r1', { text: 'текст', criteria: DEFAULTS }, NOW);
  clearReviewDraft(storage, 42, 'r1');
  assert.strictEqual(readReviewDraft(storage, 42, 'r1', NOW), null);
});

test('no user or no release means nothing is written', () => {
  const storage = memoryStorage();
  assert.strictEqual(writeReviewDraft(storage, null, 'r1', { text: 'x', criteria: DEFAULTS }, NOW), false);
  assert.strictEqual(writeReviewDraft(storage, 42, '', { text: 'x', criteria: DEFAULTS }, NOW), false);
  assert.deepStrictEqual(storage.dump(), {});
});

test('tampered values are clamped and junk is dropped', () => {
  const raw = JSON.stringify({ text: 'x'.repeat(5000), criteria: { sound: 99, image: 0, meaning: '7', bogus: 3 }, savedAt: NOW });
  const draft = parseReviewDraft(raw, NOW);
  assert.strictEqual(draft.text.length, 3000);
  assert.deepStrictEqual(draft.criteria, { ...DEFAULTS, meaning: 7 });
  assert.strictEqual(parseReviewDraft('{broken', NOW), null);
  assert.strictEqual(parseReviewDraft(JSON.stringify({ text: 'x' }), NOW), null, 'no savedAt');
});

test('drafts expire after 30 days and are pruned', () => {
  const storage = memoryStorage();
  writeReviewDraft(storage, 42, 'old', { text: 'старый', criteria: DEFAULTS }, NOW);
  writeReviewDraft(storage, 42, 'new', { text: 'свежий', criteria: DEFAULTS }, NOW + REVIEW_DRAFT_TTL_MS);
  storage.setItem('xxii_review_draft_v1:42:junk', '{broken');
  storage.setItem('xxii_theme', '#000000');
  const later = NOW + REVIEW_DRAFT_TTL_MS + 1;
  assert.strictEqual(pruneReviewDrafts(storage, later), 2);
  assert.deepStrictEqual(Object.keys(storage.dump()).sort(), ['xxii_review_draft_v1:42:new', 'xxii_theme']);
});

test('a failing storage never throws into the review form', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); }, length: 0, key: () => null };
  assert.strictEqual(writeReviewDraft(broken, 42, 'r1', { text: 'x', criteria: DEFAULTS }, NOW), false);
  assert.strictEqual(readReviewDraft(broken, 42, 'r1', NOW), null);
  assert.strictEqual(pruneReviewDrafts(broken, NOW), 0);
});
