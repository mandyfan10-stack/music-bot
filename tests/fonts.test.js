const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { rewriteCss } = require('../scripts/vendor-fonts.js');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the app makes no requests to Google Fonts', () => {
  const html = read('index.html');
  const css = read('src/fonts.css') + read('src/styles.css');
  assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/);
  assert.doesNotMatch(css, /fonts\.(googleapis|gstatic)\.com/);
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /font-src 'self' data:;/);
});

test('every font referenced by fonts.css is in the repository', () => {
  const urls = [...read('src/fonts.css').matchAll(/url\((fonts\/[^)]+)\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 10);
  const missing = urls.filter((url) => !fs.existsSync(path.join(root, 'src', url)));
  assert.deepStrictEqual(missing, []);
  const unused = fs.readdirSync(path.join(root, 'src/fonts')).filter((f) => !urls.includes(`fonts/${f}`));
  assert.deepStrictEqual(unused, []);
});

test('the families the UI uses are all declared', () => {
  const css = read('src/fonts.css');
  for (const family of ['Inter', 'Playfair Display', 'Poiret One']) {
    assert.match(css, new RegExp(`font-family: '${family}'`));
  }
  assert.match(css, /font-display: swap/);
  assert.match(css, /unicode-range:/);
});

test('font preloads point at files that fonts.css actually uses', () => {
  const html = read('index.html');
  const css = read('src/fonts.css');
  const preloads = [...html.matchAll(/rel="preload" href="src\/(fonts\/[^"]+)" as="font"[^>]*crossorigin/g)].map((m) => m[1]);
  assert.ok(preloads.length >= 1);
  preloads.forEach((p) => assert.ok(css.includes(`url(${p})`), p));
  assert.ok(html.indexOf('src/fonts.css') < html.indexOf('src/tailwind.css'));
});

test('rewriteCss maps Google URLs to stable local names', () => {
  const css = "src: url(https://fonts.gstatic.com/s/inter/v20/abc.woff2) format('woff2');";
  const once = rewriteCss(css);
  assert.match(once.css, /url\(fonts\/inter-v20-[0-9a-f]{10}\.woff2\)/);
  assert.deepStrictEqual(rewriteCss(css).css, once.css);
  assert.strictEqual(once.files.length, 1);
});
