#!/usr/bin/env node
// Собирает src/icons.js — только те иконки Lucide, которые использует
// приложение, вместо полного src/lucide.min.js (~400 КБ, ~1900 иконок).
//
// Имена берутся из кода: data-lucide="…" в index.html и JS, строковые
// литералы внутри data-lucide="${…}", свойства `icon: '…'` и литералы в
// объявлении `iconName`. Запуск после добавления новой иконки:
//   npm run build:icons
// tests/icons.test.js падает, если src/icons.js устарел или иконки нет.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const root = path.resolve(__dirname, '..');
const HTML_FILES = ['index.html'];
const JS_FILES = ['src/app.js', 'src/utils.js'];
// Подстановки в data-lucide="${…}", значения которых собираются из других
// мест (icon: '…' и объявление iconName). Новая динамическая подстановка
// должна попасть сюда осознанно — иначе сборка падает.
const KNOWN_DYNAMIC_EXPRESSIONS = new Set(['iconName', 'escapeHtml(b.icon)']);

function toPascal(name) {
  return name.replace(/(^|-)([a-z0-9])/g, (_, __, ch) => ch.toUpperCase());
}

function collectLiterals(node, out) {
  walk.full(node, (n) => {
    if (n.type === 'Literal' && typeof n.value === 'string') out.add(n.value);
  });
}

function collectIconNames(readFile = (file) => fs.readFileSync(path.join(root, file), 'utf8')) {
  const names = new Set();
  const unknownDynamic = [];
  const staticAttr = /data-lucide="([a-z0-9-]+)"/g;

  for (const file of [...HTML_FILES, ...JS_FILES]) {
    for (const match of readFile(file).matchAll(staticAttr)) names.add(match[1]);
  }

  for (const file of JS_FILES) {
    const src = readFile(file);
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
    walk.full(ast, (node) => {
      if (node.type === 'TemplateLiteral') {
        node.quasis.forEach((quasi, i) => {
          if (!/data-lucide="$/.test(quasi.value.cooked) || !node.expressions[i]) return;
          const expr = node.expressions[i];
          const literals = new Set();
          collectLiterals(expr, literals);
          literals.forEach((name) => names.add(name));
          const text = src.slice(expr.start, expr.end);
          const isLiteralOnly = expr.type === 'Literal'
            || (expr.type === 'ConditionalExpression'
              && expr.consequent.type === 'Literal' && expr.alternate.type === 'Literal');
          if (!isLiteralOnly && !KNOWN_DYNAMIC_EXPRESSIONS.has(text)) {
            unknownDynamic.push(`${file}:${expr.loc.start.line} \${${text}}`);
          }
        });
      }
      if (node.type === 'Property' && !node.computed
          && (node.key.name === 'icon' || node.key.value === 'icon')
          && node.value.type === 'Literal' && typeof node.value.value === 'string') {
        names.add(node.value.value);
      }
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier'
          && node.id.name === 'iconName' && node.init) {
        const literals = new Set();
        collectLiterals(node.init, literals);
        literals.forEach((name) => { if (/^[a-z0-9-]+$/.test(name)) names.add(name); });
      }
    });
  }
  return { names: [...names].sort(), unknownDynamic };
}

const RUNTIME = String.raw`
  var DEFAULT_ATTRS = {
    xmlns: 'http://www.w3.org/2000/svg', width: 24, height: 24, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  };
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function build(tag, attrs, children) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (key) { el.setAttribute(key, String(attrs[key])); });
    (children || []).forEach(function (child) { el.appendChild(build(child[0], child[1], child[2])); });
    return el;
  }

  function hasA11yAttrs(attrs) {
    for (var key in attrs) {
      if (key.indexOf('aria-') === 0 || key === 'role' || key === 'title') return true;
    }
    return false;
  }

  // Как lucide.createIcons(): <i data-lucide="name" class="…"> → <svg> с
  // теми же атрибутами и классами "lucide lucide-name …". Уже нарисованные
  // SVG с тем же именем не пересоздаются (оригинал пересоздавал их на каждом
  // вызове, а refreshIcons() вызывается после каждого рендера).
  function replaceElement(el) {
    var name = el.getAttribute('data-lucide');
    if (name == null) return;
    if (el.namespaceURI === SVG_NS && el.classList.contains('lucide-' + name)) return;
    var node = ICONS[name];
    if (!node) {
      console.warn(el.outerHTML + ' icon name was not found in src/icons.js (run npm run build:icons).');
      return;
    }
    var own = {};
    Array.prototype.forEach.call(el.attributes, function (attr) { own[attr.name] = attr.value; });
    var attrs = {};
    var key;
    for (key in DEFAULT_ATTRS) attrs[key] = DEFAULT_ATTRS[key];
    attrs['data-lucide'] = name;
    if (!hasA11yAttrs(own)) attrs['aria-hidden'] = 'true';
    for (key in own) attrs[key] = own[key];
    var classes = ['lucide', 'lucide-' + name].concat(String(own['class'] || '').split(' '));
    attrs['class'] = classes.filter(function (c, i, all) {
      return c && c.trim() !== '' && all.indexOf(c) === i;
    }).join(' ').trim();
    var svg = build('svg', attrs, node);
    if (el.parentNode) el.parentNode.replaceChild(svg, el);
  }

  function createIcons(options) {
    var rootEl = (options && options.root) || document;
    Array.prototype.forEach.call(rootEl.querySelectorAll('[data-lucide]'), replaceElement);
  }

  window.lucide = { createIcons: createIcons, icons: ICONS };
`;

function renderIconsFile(names, lucideIcons = require('lucide').icons) {
  const missing = names.filter((name) => !lucideIcons[toPascal(name)]);
  if (missing.length) throw new Error(`Unknown Lucide icons: ${missing.join(', ')}`);
  const version = require('lucide/package.json').version;
  const map = names.map((name) => `    ${JSON.stringify(name)}: ${JSON.stringify(lucideIcons[toPascal(name)])}`).join(',\n');
  return `/**
 * Lucide icons v${version} (ISC license, https://lucide.dev) — subset.
 * GENERATED by scripts/build-icons.js — do not edit; run \`npm run build:icons\`.
 * ${names.length} icons: ${names.join(', ')}
 */
(function () {
  'use strict';
  var ICONS = {
${map}
  };
${RUNTIME}})();
`;
}

if (require.main === module) {
  const { names, unknownDynamic } = collectIconNames();
  if (unknownDynamic.length) {
    console.error('Unrecognised dynamic data-lucide expressions (add their icon names and list them in KNOWN_DYNAMIC_EXPRESSIONS):');
    unknownDynamic.forEach((line) => console.error('  ' + line));
    process.exit(1);
  }
  const out = path.join(root, 'src/icons.js');
  fs.writeFileSync(out, renderIconsFile(names));
  console.log(`Wrote ${names.length} icons to src/icons.js (${fs.statSync(out).size} bytes)`);
}

module.exports = { collectIconNames, renderIconsFile, toPascal, KNOWN_DYNAMIC_EXPRESSIONS };
