const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { server, isPublicStaticPath } = require('../server.js');

test('isPublicStaticPath allows only index.html and src/', () => {
  assert.ok(isPublicStaticPath('index.html'));
  assert.ok(isPublicStaticPath(path.join('src', 'app.js')));
  for (const blocked of [
    '', '.env', '.git/config', 'server.js', 'package.json', 'CLAUDE.md',
    path.join('supabase', 'config.toml'), path.join('src', '.hidden'),
    path.join('..', 'etc', 'passwd'), path.join('node_modules', 'x.js')
  ]) {
    assert.ok(!isPublicStaticPath(blocked.split('/').join(path.sep)), blocked);
  }
});

test('local server serves the app but refuses repository files', async (t) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = async (p) => (await fetch(base + p)).status;

  assert.strictEqual(await status('/'), 200);
  assert.strictEqual(await status('/src/utils.js'), 200);
  assert.strictEqual(await status('/server.js'), 403);
  assert.strictEqual(await status('/package.json'), 403);
  assert.strictEqual(await status('/.git/HEAD'), 403);
  assert.strictEqual(await status('/supabase/config.toml'), 403);
  assert.strictEqual(await status('/src/..%2fserver.js'), 403);
  assert.strictEqual(await status('/src/missing.js'), 404);
});
