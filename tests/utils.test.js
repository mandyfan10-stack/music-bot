const test = require('node:test');
const assert = require('node:assert');
const { cleanUsername, escapeHtml, escapeJs, escapeJsHtml } = require('../src/utils.js');

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

test('escapeHtml: should escape a complex mix of characters', () => {
    assert.strictEqual(
        escapeHtml('Text with & < > " and \''),
        'Text with &amp; &lt; &gt; &quot; and &#39;'
    );
});

test('escapeJs: should escape quotes and backslashes', () => {
    assert.strictEqual(escapeJs(`a'b\"c\\d`), `a\\'b\\\"c\\\\d`);
});

test('escapeJs: should return empty string for nullish values', () => {
    assert.strictEqual(escapeJs(null), '');
    assert.strictEqual(escapeJs(undefined), '');
});


test('escapeJs: should escape all occurrences of quotes and backslashes', () => {
    assert.strictEqual(escapeJs("'''"), "\\'\\'\\'");
    assert.strictEqual(escapeJs('"""'), '\\"\\"\\"');
    assert.strictEqual(escapeJs('a\\b\\c'), 'a\\\\b\\\\c');
});

test('escapeJs: should return empty string for empty string input', () => {
    assert.strictEqual(escapeJs(''), '');
});

test('escapeJs: should convert non-strings to strings and escape them', () => {
    assert.strictEqual(escapeJs(123), '123');
    assert.strictEqual(escapeJs(true), 'true');
});

test('escapeJs: should escape a complex mix of characters', () => {
    assert.strictEqual(
        escapeJs(`Text with \\ and " and '`),
        `Text with \\\\ and \\" and \\'`
    );
});

test('escapeJsHtml: should combine JS and HTML escaping safely', () => {
    assert.strictEqual(
        escapeJsHtml(`'"><script>alert(1)</script>`),
        `\\&#39;\\&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;`
    );
});
