const test = require('node:test');
const assert = require('node:assert');
const {
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
} = require('../src/data-store.js');
const { adoptCreatedRecord } = require('../src/utils.js');

const T0 = 1_000_000;

function catalogState(overrides = {}) {
  const releases = overrides.releases || [
    { id: 'r1', name: 'One', genre: 'Rap' },
    { id: 'r2', name: 'Two', genre: 'Pop' }
  ];
  return {
    releases,
    releasesById: new Map(releases.map((r) => [r.id, r])),
    reviews: overrides.reviews || [],
    comments: overrides.comments || [],
    likedSet: overrides.likedSet || new Set()
  };
}

// --- Лайки/реакции: оптимистичный toggle против Realtime и fetchDB ---

test('race: unlike then a late Realtime INSERT does not bring the like back', () => {
  const intents = new Map();
  const pending = new Set(['r1']);
  let liked = new Set(['r1']);
  liked.delete('r1');
  rememberIntent(intents, 'r1', false, T0);

  liked = applyRealtimeToggle(liked, 'INSERT', 'r1', pending, intents, T0 + 100);
  assert.ok(!liked.has('r1'));

  pending.delete('r1');
  liked = applyRealtimeToggle(liked, 'INSERT', 'r1', pending, intents, T0 + 500);
  assert.ok(!liked.has('r1'), 'intent still wins after the request settled');
});

test('race: like then a stale fetchDB snapshot without it keeps the like', () => {
  const intents = new Map();
  const pending = new Set(['r1']);
  const local = new Set(['r1']);
  rememberIntent(intents, 'r1', true, T0);

  const merged = mergeServerToggleSet([], local, pending, intents, T0 + 50);
  assert.ok(merged.has('r1'));

  const afterSettled = mergeServerToggleSet([], local, new Set(), intents, T0 + 50);
  assert.ok(afterSettled.has('r1'), 'live intent survives once the request is no longer pending');
});

test('race: pending request keeps the local value even without an intent', () => {
  const merged = mergeServerToggleSet(['r1', 'r2'], new Set(['r2']), new Set(['r1']), new Map(), T0);
  assert.deepStrictEqual([...merged].sort(), ['r2']);
});

test('race: after the intent expires the server snapshot wins again', () => {
  const intents = new Map();
  rememberIntent(intents, 'r1', false, T0);
  const merged = mergeServerToggleSet(['r1'], new Set(), new Set(), intents, T0 + TOGGLE_INTENT_MS + 1);
  assert.ok(merged.has('r1'));
  assert.strictEqual(intents.size, 0, 'expired intents are pruned');
});

test('race: rollback intent overrides the optimistic one', () => {
  const intents = new Map();
  rememberIntent(intents, 'rv1', true, T0);
  rememberIntent(intents, 'rv1', false, T0 + 10);
  const set = applyIntent(intents, new Set(['rv1']), T0 + 20);
  assert.ok(!set.has('rv1'));
});

test('Realtime toggles without pending work follow the event', () => {
  const intents = new Map();
  let set = new Set();
  set = applyRealtimeToggle(set, 'INSERT', 'r1', new Set(), intents, T0);
  assert.ok(set.has('r1'));
  set = applyRealtimeToggle(set, 'DELETE', 'r1', new Set(), intents, T0);
  assert.ok(!set.has('r1'));
  const same = applyRealtimeToggle(set, 'INSERT', null, new Set(), intents, T0);
  assert.strictEqual(same.size, 0);
});

test('applyRealtimeToggle and mergeServerToggleSet never mutate their input set', () => {
  const input = new Set(['r1']);
  applyRealtimeToggle(input, 'DELETE', 'r1', new Set(), new Map(), T0);
  mergeServerToggleSet([], input, new Set(['r1']), new Map(), T0);
  assert.deepStrictEqual([...input], ['r1']);
});

test('isDuplicateToggleError recognises unique-violation shapes', () => {
  assert.ok(isDuplicateToggleError({ code: '23505' }));
  assert.ok(isDuplicateToggleError({ status: 409 }));
  assert.ok(isDuplicateToggleError({ message: 'duplicate key value violates unique constraint' }));
  assert.ok(!isDuplicateToggleError({ code: '42501', status: 403, message: 'denied' }));
  assert.ok(!isDuplicateToggleError(null));
});

// --- Каталог: Realtime-дельты ---

test('race: Realtime INSERT of my review before the RPC response does not duplicate it', () => {
  const localId = 'local-1';
  const optimistic = { id: localId, relId: 'r1', authorId: 42, rating: 30, timestamp: 1 };
  let state = catalogState({ reviews: [optimistic] });

  // Realtime приходит раньше ответа RPC и несёт серверный id.
  const fromRealtime = { id: 'srv-1', relId: 'r1', authorId: '42', rating: 30, reactionCount: 0, timestamp: 2 };
  state = { ...state, ...applyCatalogDelta(state, { reviews: [fromRealtime] }) };
  assert.strictEqual(state.reviews.length, 1);
  assert.strictEqual(state.reviews[0].id, 'srv-1');

  // Затем приходит ответ RPC — adoptCreatedRecord не создаёт вторую копию.
  state.reviews = adoptCreatedRecord(state.reviews, localId, 'srv-1', { text: 'hi' });
  assert.strictEqual(state.reviews.length, 1);
  assert.strictEqual(state.reviews[0].text, 'hi');
});

test('race: RPC response before Realtime INSERT keeps a single review', () => {
  let reviews = adoptCreatedRecord([], 'srv-1', 'srv-1', { relId: 'r1', authorId: 42, rating: 30 });
  const next = applyCatalogDelta(catalogState({ reviews }), {
    reviews: [{ id: 'srv-1', relId: 'r1', authorId: 42, rating: 30, reactionCount: 3 }]
  });
  assert.strictEqual(next.reviews.length, 1);
  assert.strictEqual(next.reviews[0].reactionCount, 3);
});

test('race: duplicate Realtime comment INSERTs are idempotent', () => {
  const c = { id: 'c1', reviewId: 'rv1', relId: 'r1', text: 'a', timestamp: 1 };
  let state = catalogState();
  state = { ...state, ...applyCatalogDelta(state, { comments: [c] }) };
  const again = applyCatalogDelta(state, { comments: [{ ...c, text: 'edited' }] });
  assert.strictEqual(again.comments.length, 1);
  assert.strictEqual(again.comments[0].text, 'edited');
  assert.ok(again.commentsChanged);
});

test('deleting a review cascades its comments; deleting a release drops like and comments', () => {
  const state = catalogState({
    reviews: [{ id: 'rv1', relId: 'r1' }, { id: 'rv2', relId: 'r2' }],
    comments: [
      { id: 'c1', reviewId: 'rv1', relId: 'r1' },
      { id: 'c2', reviewId: 'rv2', relId: 'r2' }
    ],
    likedSet: new Set(['r1', 'r2'])
  });

  const afterReview = applyCatalogDelta(state, { deletedReviewIds: ['rv1'] });
  assert.deepStrictEqual(afterReview.reviews.map((r) => r.id), ['rv2']);
  assert.deepStrictEqual(afterReview.comments.map((c) => c.id), ['c2']);
  assert.ok(afterReview.changed && afterReview.commentsChanged);

  const afterRelease = applyCatalogDelta(state, { deletedReleaseIds: ['r2'] });
  assert.deepStrictEqual(afterRelease.releases.map((r) => r.id), ['r1']);
  assert.ok(!afterRelease.releasesById.has('r2'));
  assert.ok(!afterRelease.likedSet.has('r2'));
  assert.deepStrictEqual(afterRelease.removedReleaseIds, ['r2']);
  assert.deepStrictEqual(afterRelease.comments.map((c) => c.id), ['c1']);
});

test('late DELETE for an unknown release or review is a no-op', () => {
  const state = catalogState({ reviews: [{ id: 'rv1', relId: 'r1' }] });
  const next = applyCatalogDelta(state, { deletedReleaseIds: ['nope'], deletedReviewIds: ['nope'] });
  assert.ok(!next.changed);
  assert.ok(!next.commentsChanged);
  assert.deepStrictEqual(next.removedReleaseIds, []);
});

test('release UPDATE replaces in place, INSERT goes to the top', () => {
  const state = catalogState();
  const next = applyCatalogDelta(state, {
    releases: [{ id: 'r2', name: 'Two v2', genre: 'Pop' }, { id: 'r3', name: 'Three' }]
  });
  assert.deepStrictEqual(next.releases.map((r) => r.id), ['r3', 'r1', 'r2']);
  assert.strictEqual(next.releasesById.get('r2').name, 'Two v2');
  assert.ok(next.changed);
});

test('applyCatalogDelta does not mutate the previous state', () => {
  const state = catalogState({ likedSet: new Set(['r1']) });
  const snapshot = JSON.stringify(state.releases);
  applyCatalogDelta(state, { releases: [{ id: 'r1', name: 'X' }], deletedReleaseIds: ['r1'] });
  assert.strictEqual(JSON.stringify(state.releases), snapshot);
  assert.ok(state.releasesById.has('r1'));
  assert.ok(state.likedSet.has('r1'));
});

// --- Индексы ---

test('groupReviewsByRelease sorts newest first and averages numeric ratings', () => {
  const { byRelId, avgByRelId } = groupReviewsByRelease([
    { id: 'a', relId: 'r1', rating: 40, timestamp: 1 },
    { id: 'b', relId: 'r1', rating: '20', timestamp: 3 },
    { id: 'c', relId: 'r2', rating: 'bad', timestamp: 2 }
  ]);
  assert.deepStrictEqual(byRelId.get('r1').map((r) => r.id), ['b', 'a']);
  assert.strictEqual(avgByRelId.get('r1'), 30);
  assert.strictEqual(avgByRelId.get('r2'), 0);
});

test('groupCommentsByReview sorts oldest first and skips orphans', () => {
  const map = groupCommentsByReview([
    { id: 'c2', reviewId: 'rv1', timestamp: 5 },
    { id: 'c1', reviewId: 'rv1', timestamp: 1 },
    { id: 'x', timestamp: 0 },
    null
  ]);
  assert.deepStrictEqual(map.get('rv1').map((c) => c.id), ['c1', 'c2']);
  assert.strictEqual(map.size, 1);
});

test('countGenres buckets missing genres as «Другое»', () => {
  assert.deepStrictEqual(countGenres([{ genre: 'Rap' }, { genre: 'Rap' }, {}]), { Rap: 2, 'Другое': 1 });
});
