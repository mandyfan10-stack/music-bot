const test = require('node:test');
const assert = require('node:assert');
const { REALTIME_TABLES, describeRealtimeChange } = require('../src/realtime-sync.js');

const ME = 42;

// supabase-js шлёт пустой объект в new для DELETE и в old для INSERT.
const insert = (row) => ({ eventType: 'INSERT', new: row, old: {} });
const update = (row) => ({ eventType: 'UPDATE', new: row, old: { id: row.id } });
const remove = (row) => ({ eventType: 'DELETE', new: {}, old: row });

test('subscribes to every table the app syncs', () => {
  assert.deepStrictEqual(REALTIME_TABLES, [
    'releases', 'reviews', 'review_comments', 'likes', 'review_reactions', 'blocked_users'
  ]);
});

test('release rows are applied directly as deltas', () => {
  const row = { id: 'r1', name: 'One' };
  assert.deepStrictEqual(describeRealtimeChange('releases', insert(row), ME),
    [{ kind: 'delta', delta: { releases: [row] } }]);
  assert.deepStrictEqual(describeRealtimeChange('releases', update(row), ME),
    [{ kind: 'delta', delta: { releases: [row] } }]);
  assert.deepStrictEqual(describeRealtimeChange('releases', remove({ id: 'r1' }), ME),
    [{ kind: 'delta', delta: { deletedReleaseIds: ['r1'] } }]);
});

test('reviews and comments are re-read from their views, deletes become deltas', () => {
  assert.deepStrictEqual(describeRealtimeChange('reviews', insert({ id: 'rv1' }), ME),
    [{ kind: 'refetch-review', id: 'rv1' }]);
  assert.deepStrictEqual(describeRealtimeChange('reviews', remove({ id: 'rv1' }), ME),
    [{ kind: 'delta', delta: { deletedReviewIds: ['rv1'] } }]);
  assert.deepStrictEqual(describeRealtimeChange('review_comments', update({ id: 'c1' }), ME),
    [{ kind: 'refetch-comment', id: 'c1' }]);
  assert.deepStrictEqual(describeRealtimeChange('review_comments', remove({ id: 'c1' }), ME),
    [{ kind: 'delta', delta: { deletedCommentIds: ['c1'] } }]);
});

test('only my own likes touch my liked set, regardless of id type', () => {
  assert.deepStrictEqual(describeRealtimeChange('likes', insert({ release_id: 'r1', user_id: '42' }), ME),
    [{ kind: 'own-like', eventType: 'INSERT', id: 'r1' }]);
  assert.deepStrictEqual(describeRealtimeChange('likes', remove({ release_id: 'r1', user_id: 42 }), '42'),
    [{ kind: 'own-like', eventType: 'DELETE', id: 'r1' }]);
  assert.deepStrictEqual(describeRealtimeChange('likes', insert({ release_id: 'r1', user_id: 7 }), ME), []);
});

test('likes are ignored before the user is known', () => {
  assert.deepStrictEqual(describeRealtimeChange('likes', insert({ release_id: 'r1', user_id: 42 }), null), []);
  assert.deepStrictEqual(describeRealtimeChange('likes', insert({ release_id: 'r1', user_id: 42 }), ''), []);
});

test('a DELETE without user_id (default replica identity) is not mistaken for mine', () => {
  assert.deepStrictEqual(describeRealtimeChange('likes', remove({ id: 'like-1' }), ME), []);
});

test('any reaction refreshes the review counter; mine also updates my set, after the refetch', () => {
  assert.deepStrictEqual(describeRealtimeChange('review_reactions', insert({ review_id: 'rv1', user_id: 7 }), ME),
    [{ kind: 'refetch-review', id: 'rv1' }]);
  assert.deepStrictEqual(describeRealtimeChange('review_reactions', remove({ review_id: 'rv1', user_id: 42 }), ME), [
    { kind: 'refetch-review', id: 'rv1' },
    { kind: 'own-reaction', eventType: 'DELETE', id: 'rv1' }
  ]);
});

test('block events report whether they target the current user', () => {
  assert.deepStrictEqual(describeRealtimeChange('blocked_users', insert({ user_id: 42, username: 'me' }), ME),
    [{ kind: 'blocked', on: true, userId: '42', username: 'me', isMe: true }]);
  assert.deepStrictEqual(describeRealtimeChange('blocked_users', remove({ user_id: 7, username: 'x' }), ME),
    [{ kind: 'blocked', on: false, userId: '7', username: 'x', isMe: false }]);
  assert.deepStrictEqual(describeRealtimeChange('blocked_users', update({ user_id: 7 }), ME), []);
});

test('malformed payloads and unknown tables produce no actions', () => {
  assert.deepStrictEqual(describeRealtimeChange('releases', null, ME), []);
  assert.deepStrictEqual(describeRealtimeChange('releases', { eventType: 'DELETE', old: {} }, ME), []);
  assert.deepStrictEqual(describeRealtimeChange('reviews', insert({}), ME), []);
  assert.deepStrictEqual(describeRealtimeChange('profiles', insert({ id: 'x' }), ME), []);
});
