// Защита от XSS в шаблонах innerHTML. JWT сессии лежит в localStorage,
// поэтому любая неэкранированная подстановка пользовательских данных в
// HTML-шаблон равна угону сессии.
//
// Тест разбирает src/app.js и src/utils.js и проверяет каждую подстановку
// `${…}` внутри template literal, содержащего HTML-разметку. Подстановка
// проходит, если она безопасна по построению (escapeHtml/escapeCssString,
// литерал, число, вложенный шаблон, тернарник из безопасных веток) или
// явно перечислена в SAFE_INTERPOLATIONS с объяснением.
//
// Если тест упал на новой подстановке: оберните её в escapeHtml(). Только если
// значение гарантированно не содержит пользовательских данных (например,
// HTML, собранный из уже экранированных частей), добавьте её в список ниже.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const root = path.resolve(__dirname, '..');
const FILES = ['src/app.js', 'src/utils.js', 'src/icons.js', 'src/data-store.js', 'src/auth-session.js', 'src/realtime-sync.js', 'src/review-drafts.js'];

const SAFE_INTERPOLATIONS = new Map([
  // Числа и счётчики.
  ['count', 'число из genreCounts / list.length'],
  ['pct', 'процент, вычисленный из числовых оценок'],
  ['avgRating', 'toFixed(1) от средней оценки или null'],
  ['reactionCount', 'проверено typeof === number'],
  ['COMMENT_MAX_LENGTH', 'константа'],
  // Имя иконки lucide проверено регэкспом /^[a-z0-9-]+$/.
  ['iconName', 'проверено регэкспом [a-z0-9-]'],
  // Статические подписи из локальных конфигов.
  ['label', 'подпись критерия из criteriaConfig'],
  // Классы/атрибуты, собранные из литералов.
  ['enterCls', 'литерал класса анимации'],
  ['enterStyle', 'style с числовой задержкой'],
  // Фрагменты HTML, собранные из уже экранированных частей.
  ['bars', 'шаблоны с экранированием, проверены этим же тестом'],
  ['ratingBadge', 'шаблон с числовой оценкой'],
  ['newBadge', 'статический шаблон'],
  ['adminTag', 'статическая строка'],
  ['relName', 'escapeHtml(rel.name) или литерал'],
  ['toggle', 'шаблон с экранированием'],
  ['items', 'renderCommentItem() — экранирует сам'],
  ['inputBox', 'шаблон с экранированием'],
  ['criteria', 'escapeHtml(formatCriteria(...)) или пусто'],
  ['reactBtn', 'шаблон с экранированием'],
  ['editBtn', 'шаблон кнопки, id через escapeHtml'],
  ['renderCommentsSection(r.id)', 'возвращает шаблоны с экранированием'],
  ['pluralReleases(count)', 'словоформа из литералов'],
  ['pluralReviews(relReviews.length)', 'словоформа из литералов']
]);

const ESCAPERS = new Set(['escapeHtml', 'escapeCssString']);

function isSafeByConstruction(node) {
  switch (node.type) {
    case 'Literal':
    case 'TemplateLiteral': // его подстановки проверяются отдельно
      return true;
    case 'CallExpression':
      if (node.callee.type === 'Identifier' && ESCAPERS.has(node.callee.name)) return true;
      // Числа: x.toFixed(n)
      return node.callee.type === 'MemberExpression'
        && !node.callee.computed
        && node.callee.property.name === 'toFixed';
    case 'MemberExpression':
      return !node.computed && node.property.name === 'length';
    case 'ConditionalExpression':
      return isSafeByConstruction(node.consequent) && isSafeByConstruction(node.alternate);
    case 'LogicalExpression':
      return isSafeByConstruction(node.left) && isSafeByConstruction(node.right);
    default:
      return false;
  }
}

function collectInterpolations(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  const found = [];
  walk.full(ast, (node) => {
    if (node.type !== 'TemplateLiteral') return;
    const markup = node.quasis.map((q) => q.value.cooked).join('');
    if (!/<[a-z!/]/i.test(markup)) return;
    node.expressions.forEach((expr) => {
      found.push({
        file,
        line: expr.loc.start.line,
        node: expr,
        text: src.slice(expr.start, expr.end).replace(/\s+/g, ' ').trim()
      });
    });
  });
  return found;
}

test('every interpolation in HTML templates is escaped or explicitly reviewed', () => {
  const offenders = FILES
    .flatMap(collectInterpolations)
    .filter((it) => !isSafeByConstruction(it.node) && !SAFE_INTERPOLATIONS.has(it.text))
    .map((it) => `${it.file}:${it.line}  \${${it.text}}`);
  assert.deepStrictEqual(offenders, [], 'Неэкранированные подстановки в HTML:\n' + offenders.join('\n'));
});

test('the reviewed allowlist has no stale entries', () => {
  const used = new Set(FILES.flatMap(collectInterpolations).map((it) => it.text));
  const stale = [...SAFE_INTERPOLATIONS.keys()].filter((key) => !used.has(key));
  assert.deepStrictEqual(stale, [], 'Уберите из SAFE_INTERPOLATIONS: ' + stale.join(', '));
});

test('the checker flags a raw user value', () => {
  const ast = acorn.parse('const h = `<b>${review.text}</b>`;', { ecmaVersion: 'latest' });
  let expr = null;
  walk.full(ast, (node) => { if (node.type === 'TemplateLiteral') expr = node.expressions[0]; });
  assert.ok(expr && !isSafeByConstruction(expr));
  const ok = acorn.parse('const h = `<b>${escapeHtml(review.text)}</b>`;', { ecmaVersion: 'latest' });
  walk.full(ok, (node) => { if (node.type === 'TemplateLiteral') expr = node.expressions[0]; });
  assert.ok(isSafeByConstruction(expr));
});

// Присваивания innerHTML/outerHTML принимают только шаблоны (их подстановки
// проверены выше), `.map(шаблон).join()` или явно разрешённые переменные с
// HTML-разметкой. Прямое `el.innerHTML = data.text` тест не пропустит.
const SAFE_HTML_IDENTIFIERS = new Set(['html', 'LIKES_EMPTY_HTML']);

function isSafeHtmlSink(node) {
  switch (node.type) {
    case 'Literal':
    case 'TemplateLiteral':
      return true;
    case 'Identifier':
      return SAFE_HTML_IDENTIFIERS.has(node.name);
    case 'ConditionalExpression':
      return isSafeHtmlSink(node.consequent) && isSafeHtmlSink(node.alternate);
    case 'LogicalExpression':
      return isSafeHtmlSink(node.left) && isSafeHtmlSink(node.right);
    case 'CallExpression': {
      const callee = node.callee;
      if (callee.type !== 'MemberExpression' || callee.computed || callee.property.name !== 'join') return false;
      const mapped = callee.object;
      return mapped.type === 'CallExpression'
        && mapped.callee.type === 'MemberExpression'
        && mapped.callee.property.name === 'map';
    }
    default:
      return false;
  }
}

test('innerHTML/outerHTML only receive templates, never raw values', () => {
  const offenders = [];
  for (const file of FILES) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
    walk.full(ast, (node) => {
      if (node.type === 'AssignmentExpression'
          && node.left.type === 'MemberExpression'
          && ['innerHTML', 'outerHTML'].includes(node.left.property.name)
          && !isSafeHtmlSink(node.right)) {
        offenders.push(`${file}:${node.loc.start.line}`);
      }
      if (node.type === 'CallExpression'
          && node.callee.type === 'MemberExpression'
          && ['insertAdjacentHTML', 'write', 'writeln'].includes(node.callee.property.name)) {
        offenders.push(`${file}:${node.loc.start.line} (${node.callee.property.name})`);
      }
    });
  }
  assert.deepStrictEqual(offenders, []);
});
