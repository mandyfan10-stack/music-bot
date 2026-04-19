const test = require('node:test');
const assert = require('node:assert');
const { cleanUsername } = require('../src/utils.js');

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
