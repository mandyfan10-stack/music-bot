# CLAUDE.md — music-bot (фронтенд XXII SOUND)

Telegram Mini App «XXII SOUND»: каталог музыкальных релизов с рецензиями,
оценками по критериям, лайками, реакциями и комментариями. Это **фронтенд**.
Парный репозиторий с API — `music_backend` (FastAPI + MongoDB).

## Стек

- Ванильный JavaScript (ES6+), **без фреймворка; деплой без сборки**.
- Tailwind CSS — собран заранее в `src/tailwind.css` (артефакт закоммичен в
  репозиторий, рантайм-CDN убран). Lucide Icons и Telegram WebApp SDK — CDN.

## Структура

- `index.html` — только разметка; CSS и JS вынесены в отдельные файлы.
- `src/tailwind.css` — собранный Tailwind (генерируется, закоммичен).
- `src/tailwind.input.css` + `tailwind.config.js` — вход и конфиг для сборки.
- `package.json` — devDependency `tailwindcss` и скрипт `build:css` (для
  регенерации; на деплой не влияет).
- `src/styles.css` — кастомные стили поверх Tailwind (подключается `<link>`).
- `src/app.js` — вся логика приложения (~2440 строк, `<script src defer>`).
- `src/utils.js` — утилиты экранирования + чистые функции каталога
  (`filterAndSortReleases`); переиспользуется тестами через `module.exports`.
- `tests/utils.test.js` — тесты утилит и логики фильтрации (Node `test`).

## Архитектура

- **SPA с 4 вкладками**: `home`, `feed`, `likes`, `settings` (`TAB_ORDER`),
  переключение — `switchTab()` с анимированным переходом и морфящимся
  индикатором (`moveTabIndicator`). Детали и формы — модалки-шторки
  (`openModal`/`closeModal`), стек `openModalStack` для нативной кнопки
  «Назад». Шторку можно закрыть свайпом вниз (`setupSheetDrag`).
- **Поток данных**: cache-first. `fetchDB()` мгновенно показывает кэш
  (`localStorage`, ключ `xxii_cache_v2`, TTL 15 мин), затем `GET /api/data`.
  Real-time — long-poll `GET /api/sync/releases` в `syncLoopTick()`;
  инкрементальные дельты (релизы, рецензии, комментарии) применяет
  `applySyncDelta()`. Статус синка — «остров» в духе iOS Dynamic Island
  (`setSyncStatus`).
- **Состояние** — глобальные переменные: `releases`, `releasesById` (Map),
  `reviews`, `reviewsByRelId` (Map), `avgRatingByRelId` (Map), `comments`,
  `commentsByReviewId` (Map), `likedSet`, `reactedSet`, `genreCounts`, `user`.
  Фреймворка нет — обновление через `renderReleases()` / `renderReviews()` /
  `renderFeed()` и `innerHTML`.
- **Telegram SDK**: авторизация через `tg.initData` (заголовок
  `X-Telegram-Init-Data`, см. `authHeaders()`); haptics (`tgHaptic`,
  `tgHapticNotify`); тема; `CloudStorage`; deep-link `start_param`
  (`handleStartParam` открывает релиз по `?startapp=<id>`); шеринг через
  `tg.shareMessage` (`shareRelease`).
- **Бэкенд**: `BACKEND_URL` захардкожен в `app.js`. Контракт см.
  `music_backend/CLAUDE.md`. Внешние API: noembed, iTunes (обложки),
  ui-avatars (фолбэк-аватары) — все домены перечислены в CSP `connect-src`.

## Ключевые функции

- Каталог: `getFilteredReleases()` (жанр + поиск + сортировка),
  `renderReleaseCard()`, `renderReleases()`, `openRelease()`.
- Рецензии/оценки: `addReview()`, `renderReviews()`, `renderCriteriaChart()`.
- Комментарии: `submitComment()`, `deleteComment()`, `toggleComments()`,
  `renderCommentsSection()` (черновики переживают ре-рендер — `commentDrafts`).
- Реакции/лайки: `toggleLikeAPI()`, `toggleReviewReaction()`.
- Профиль: `openProfileModal()`, `computeProfileBadges()` (бейджи-достижения),
  `renderProfileCriteriaChart()` (график предпочтений критика).
- Добавление релиза (только админ): `handleAddRelease()` (oEmbed → бэкенд →
  ручной ввод) и `saveManualRelease()`.
- Шеринг: `shareRelease()` (нативное TG-сообщение, фолбэк на deep-link).
- Push: `toggleNotifications()`.
- Жесты: `setupPullToRefresh()`, `setupSheetDrag()` (свайп-закрытие модалок),
  `morphCoverFromCard()` (FLIP-морф обложки карточки в модалку).

## Обработка событий

Inline-обработчиков (`onclick=` и т.п.) **нет** — это позволило убрать
`'unsafe-inline'` из `script-src` CSP. Вместо них — делегирование: элементы
помечаются `data-act` / `data-act-input` / `data-act-focus` / `data-act-change`,
параметры передаются через `data-*`. Карта действий — объект `clickActions`
в `app.js`; новые интерактивные элементы добавляют запись туда, а не `onclick`.

## Конвенции

- **Всегда экранировать** данные в шаблонах `innerHTML`: `escapeHtml` (текст и
  значения `data-*`; коэрсит non-string, пропускает `0`/`false`),
  `escapeCssString` (CSS-селекторы). Утилиты — в `src/utils.js`.
- **Роль пользователя определяет только сервер** (`currentUser` из `/api/data`),
  никогда не доверять клиенту.
- Сетевые мутации двух видов: **toggle-операции оптимистичные с откатом**
  (`toggleLikeAPI`, `toggleReviewReaction`, `toggleNotifications`,
  `submitComment`, `deleteComment`); **создание/удаление рецензий и релизов
  pessimistic** — ждут ответа сервера, затем меняют локальное состояние
  (`addReview`, `saveManualRelease`, `executeDeleteReview`,
  `executeDeleteRelease`). Серверные `id` совпадают с клиентскими, поэтому
  `applySyncDelta` обновляет такие записи на месте, без дублей.
- Доступность: `aria-label`, `role="button"`, `tabindex`, поддержка
  `prefers-reduced-motion` (анимации и морф отключаются).

## Команды

- Тесты (утилиты + логика фильтрации): `node --test`
- Синтаксис: `node --check src/app.js` и `node --check src/utils.js`
- Пересобрать Tailwind после изменения классов: `npm install && npm run build:css`
- Полная проверка UI требует среды Telegram Mini App.

## Известные риски

- Широкий `innerHTML` в рендер-функциях — держать экранирование строгим.
- `'unsafe-inline'` остаётся в `style-src` CSP — нужно для inline-атрибутов
  `style` в шаблонах.
- CDN-зависимости: Lucide (с SRI) и Telegram SDK (SRI невозможен — версию
  обновляет Telegram). Tailwind с CDN снят — собирается заранее.
