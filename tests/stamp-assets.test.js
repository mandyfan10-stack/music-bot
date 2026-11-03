const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stampHtml, stampSite } = require('../scripts/stamp-assets.js');

function makeSite(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

test('replaces manual ?v=N with a content hash and leaves external URLs alone', () => {
  const dir = makeSite({ 'src/app.js': 'a', 'src/styles.css': 'b' });
  const { html, missing } = stampHtml(
    '<link href="src/styles.css?v=13"><script src="src/app.js?v=20" defer></script>'
    + '<script src="src/app.js"></script><link href="https://fonts.googleapis.com/x?v=1">',
    dir
  );
  assert.deepStrictEqual(missing, []);
  const hashes = [...html.matchAll(/src\/app\.js\?v=([0-9a-f]{12})"/g)].map((m) => m[1]);
  assert.strictEqual(hashes.length, 2);
  assert.strictEqual(hashes[0], hashes[1]);
  assert.match(html, /src\/styles\.css\?v=[0-9a-f]{12}"/);
  assert.match(html, /https:\/\/fonts\.googleapis\.com\/x\?v=1"/);
});

test('the hash changes only when the file content changes', () => {
  const dir = makeSite({ 'src/app.js': 'one' });
  const first = stampHtml('<script src="src/app.js"></script>', dir).html;
  assert.strictEqual(stampHtml('<script src="src/app.js?v=99"></script>', dir).html, first);
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'two');
  assert.notStrictEqual(stampHtml('<script src="src/app.js"></script>', dir).html, first);
});

test('stampSite fails the deploy on a reference to a missing asset', () => {
  const dir = makeSite({ 'index.html': '<script src="src/gone.js?v=1"></script>' });
  assert.throws(() => stampSite(dir), /missing assets: src\/gone\.js/);
});

test('the real index.html stamps every local asset', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const { html: stamped, missing } = stampHtml(html, root);
  assert.deepStrictEqual(missing, []);
  assert.doesNotMatch(stamped, /\s(?:src|href)="src\/[^"]*\?v=\d{1,4}"/);
  const local = [...html.matchAll(/\s(?:src|href)="(src\/(?!fonts\/)[^"?]+)/g)].length;
  assert.ok(local >= 9);
  assert.strictEqual((stamped.match(/\?v=[0-9a-f]{12}"/g) || []).length, local);
});

test('font preloads keep their exact URL so they match url() in fonts.css', () => {
  const dir = makeSite({ 'src/fonts/inter-v20-abc.woff2': 'f', 'src/fonts.css': 'x' });
  const { html } = stampHtml(
    '<link rel="preload" href="src/fonts/inter-v20-abc.woff2" as="font"><link href="src/fonts.css">', dir
  );
  assert.match(html, /href="src\/fonts\/inter-v20-abc\.woff2"/);
  assert.match(html, /href="src\/fonts\.css\?v=[0-9a-f]{12}"/);
});
