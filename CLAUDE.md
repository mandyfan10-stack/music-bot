# CLAUDE.md — music-bot (XXII SOUND)

Telegram Mini App «XXII SOUND»: каталог музыкальных релизов с рецензиями,
оценками по критериям, лайками, реакциями и комментариями. Репозиторий содержит
и статический фронтенд, и единственный активный backend на Supabase. Старый
FastAPI/MongoDB-проект архивирован и не участвует в production runtime.

## Стек

- Ванильный JavaScript (ES6+), **без фреймворка; деплой без сборки**.
- Tailwind CSS — собран заранее в `src/tailwind.css` (артефакт закоммичен в
  репозиторий, рантайм-CDN убран). Supabase JS и Lucide Icons сохранены
  локально; с внешнего домена загружается только Telegram WebApp SDK.
- Backend — PostgreSQL/RLS, RPC, Realtime и Edge Functions в `supabase/`.

## Структура

- `index.html` — только разметка; CSS и JS вынесены в отдельные файлы.
- `src/tailwind.css` — собранный Tailwind (генерируется, закоммичен).
- `src/tailwind.input.css` + `tailwind.config.js` — вход и конфиг для сборки.
- `package.json` — devDependency `tailwindcss` и скрипт `build:css` (для
  регенерации; на деплой не влияет).
- `src/styles.css` — кастомные стили поверх Tailwind (подключается `<link>`).
- `src/app.js` — вся логика приложения (~2900 строк, `<script src defer>`).
- `src/utils.js` — утилиты экранирования + чистые функции каталога
  (`filterAndSortReleases`); переиспользуется тестами через `module.exports`.
- `tests/utils.test.js` — тесты утилит и логики фильтрации (Node `test`).

## Архитектура

- **SPA с 4 вкладками**: `home`, `feed`, `likes`, `settings` (`TAB_ORDER`),
  переключение — `switchTab()` с анимированным переходом и морфящимся
  индикатором (`moveTabIndicator`). Детали и формы — модалки-шторки
  (`openModal`/`closeModal`), стек `openModalStack` для нативной кнопки
  «Назад». Шторку можно закрыть свайпом вниз (`setupSheetDrag`).
- **Поток данных**: cache-first. `fetchDB()` мгновенно показывает только
  публичный кэш каталога (`xxii_public_cache_v3`, TTL 15 мин) через
  `applyPublicData()` — не через `applyData()`, чтобы не обнулить лайки и
  роль. Затем читает таблицы и security-invoker views через Supabase Data API.
  Лайки, реакции, блокировки и профиль не кэшируются. Инкрементальные
  изменения приходят через Supabase Realtime и применяются `applySyncDelta()`.
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
- **Бэкенд**: URL проекта и публичный legacy anon key находятся в `app.js`;
  service-role и Telegram bot token никогда не попадают в клиент. Запись
  рецензий/комментариев идёт через RPC, остальные операции защищает RLS.
  Внешние API: iTunes (обложка), Yandex Music API и ui-avatars. Метаданные
  ссылки парсит только `parse-link` (локально — `server.js`).

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
- Шеринг: `shareRelease()` запрашивает у `share-message` prepared message или
  канонический deep-link для старых Telegram-клиентов.
- Push: `toggleNotifications()`.
- Жесты: `setupPullToRefresh()`, `setupSheetDrag()` (свайп-закрытие модалок),
  `morphCoverFromCard()` (FLIP-морф обложки карточки в модалку).

## Обработка событий

Inline-обработчиков в HTML (`onclick=` и т.п.) **нет**, поэтому
`'unsafe-inline'` отсутствует в `script-src` CSP. Вместо них — делегирование: элементы
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
  `executeDeleteRelease`). `create_review` / `create_comment` принимают
  клиентский `p_id`; клиент всё равно сливает гонку с Realtime через
  `adoptCreatedRecord` и `isSameReview` (рецензия — по id или
  `(relId, authorId)`). Подтверждения удаления — шторка
  `modal-confirm-action`, не `window.confirm`.
- Доступность: `aria-label`, `role="button"`, `tabindex`, поддержка
  `prefers-reduced-motion` (анимации и морф отключаются).

## Команды

- Тесты (утилиты, фильтрация и статические контракты): `npm test`
- Синтаксис: `node --check src/app.js`, `node --check src/utils.js` и
  `node --check server.js`
- Edge Functions: `deno fmt --check supabase/functions`,
  `deno check --frozen supabase/functions/*/index.ts` и
  `deno test --frozen supabase/functions/_shared/*_test.ts`
- База/RLS: `supabase db start && supabase test db`
- Пересобрать Tailwind после изменения классов: `npm install && npm run build:css`
- Полная проверка UI требует среды Telegram Mini App.

## Известные риски

- Широкий `innerHTML` в рендер-функциях — держать экранирование строгим.
- `'unsafe-inline'` остаётся в `style-src` CSP — нужно для inline-атрибутов
  `style` в шаблонах.
- Telegram SDK остаётся внешней зависимостью без SRI: официальный URL обновляет
  Telegram. Остальные runtime-библиотеки находятся в `src/`.
- `supabase/schema.sql` — только указатель; применяемая схема определяется
  упорядоченными файлами `supabase/migrations/`.
- `identity_contract` применён на проде 2026-08-17: PK `admins` /
  `blocked_users` — `user_id`. Down-миграции нет.
