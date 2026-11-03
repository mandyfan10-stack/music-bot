const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { collectIconNames, renderIconsFile, toPascal } = require('../scripts/build-icons.js');

const root = path.resolve(__dirname, '..');

test('src/icons.js is up to date with the icons the code uses', () => {
  const { names, unknownDynamic } = collectIconNames();
  assert.deepStrictEqual(unknownDynamic, [], 'new dynamic data-lucide expression — see scripts/build-icons.js');
  const expected = renderIconsFile(names);
  const actual = fs.readFileSync(path.join(root, 'src/icons.js'), 'utf8');
  assert.strictEqual(actual, expected, 'run `npm run build:icons` and commit src/icons.js');
});

test('icons used in markup, dynamic templates and badges are all collected', () => {
  const { names } = collectIconNames();
  for (const name of ['heart', 'chevron-up', 'chevron-down', 'trash-2', 'crown', 'disc-3', 'sparkles']) {
    assert.ok(names.includes(name), name);
  }
});

test('collector picks up new icons from every supported place', () => {
  const files = {
    'index.html': '<i data-lucide="music"></i>',
    'src/app.js': [
      'const a = `<i data-lucide="${on ? \'eye\' : \'eye-off\'}"></i>`;',
      'const iconName = ok ? icon : \'bell\';',
      'const b = `<i data-lucide="${iconName}"></i>`;'
    ].join('\n'),
    'src/utils.js': "const badges = [{ icon: 'medal', label: 'x' }];"
  };
  const { names, unknownDynamic } = collectIconNames((file) => files[file]);
  assert.deepStrictEqual(names, ['bell', 'eye', 'eye-off', 'medal', 'music']);
  assert.deepStrictEqual(unknownDynamic, []);
});

test('collector rejects an unrecognised dynamic icon expression', () => {
  const files = {
    'index.html': '',
    'src/app.js': 'const a = `<i data-lucide="${row.iconFromServer}"></i>`;',
    'src/utils.js': ''
  };
  const { unknownDynamic } = collectIconNames((file) => files[file]);
  assert.strictEqual(unknownDynamic.length, 1);
});

test('unknown icon names fail the build instead of rendering nothing', () => {
  assert.throws(() => renderIconsFile(['heart', 'definitely-not-an-icon']), /definitely-not-an-icon/);
  assert.strictEqual(toPascal('loader-2'), 'Loader2');
});

test('the subset is a small fraction of the full Lucide bundle', () => {
  const size = fs.statSync(path.join(root, 'src/icons.js')).size;
  assert.ok(size < 30 * 1024, `src/icons.js is ${size} bytes`);
  assert.ok(!fs.existsSync(path.join(root, 'src/lucide.min.js')));
});
