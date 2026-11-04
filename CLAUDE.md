# CLAUDE.md — music-bot (XXII SOUND)

Telegram Mini App «XXII SOUND»: каталог музыкальных релизов с рецензиями,
оценками по критериям, лайками, реакциями и комментариями. Репозиторий содержит
и статический фронтенд, и единственный активный backend на Supabase. Старый
FastAPI/MongoDB-проект архивирован и не участвует в production runtime.

## Стек

- Ванильный JavaScript (ES6+), **без фреймворка; деплой без сборки**.
- Tailwind CSS — собран заранее в `src/tailwind.css` (артефакт закоммичен в
  репозиторий, рантайм-CDN убран). Supabase JS сохранён локально, иконки
  Lucide — только используемые, в сгенерированном `src/icons.js`; шрифты
  (Inter, Playfair Display, Poiret One, OFL) — локально в `src/fonts/`; с внешнего домена загружается только Telegram WebApp SDK — и то
  асинхронно, через загрузчик `src/telegram-web-app.js` (см. «Telegram SDK»).
- Backend — PostgreSQL/RLS, RPC, Realtime и Edge Functions в `supabase/`.

## Структура

- `index.html` — только разметка; CSS и JS вынесены в отдельные файлы.
- `src/tailwind.css` — собранный Tailwind (генерируется, закоммичен).
- `src/tailwind.input.css` + `tailwind.config.js` — вход и конфиг для сборки.
- `package.json` — devDependency `tailwindcss` и скрипт `build:css` (для
  регенерации; на деплой не влияет).
- `src/styles.css` — кастомные стили поверх Tailwind (подключается `<link>`).
- `src/telegram-web-app.js` — загрузчик Telegram SDK: ставит заглушку
  `window.Telegram.WebApp` (initData, версия и тема из URL hash) и асинхронно
  подгружает официальный SDK; по загрузке шлёт событие
  `xxii:telegram-sdk-ready`.
- `src/boot.js` — ранний старт: `ready()`/`expand()`, скрытие welcome у
  вернувшихся, тема до загрузки тяжёлых скриптов.
- `src/app.js` — IIFE приложения (`<script src defer>`): DOM, рендер, сеть.
  Чистые хелперы вынесены в `utils.js`; жанр/название/Yandex URL — в
  `catalog-parse.js`; сведение состояния — в `data-store.js`.
- `src/data-store.js` — слой данных без DOM и сети: намерения toggle-операций
  (`rememberIntent`/`applyIntent`), слияние снимка лайков/реакций
  (`mergeServerToggleSet`), Realtime-toggle (`applyRealtimeToggle`), дельты
  каталога (`applyCatalogDelta`), индексы (`groupReviewsByRelease`,
  `groupCommentsByReview`, `countGenres`). Подключается после `utils.js`.
- `src/auth-session.js` — сессия входа без сети: проверка JWT
  (`isUsableAccessToken`, `isValidAuthResponse`), запись и разбор
  `xxii_auth_v1` (`buildStoredSession`, `parseStoredSession` — стирает
  истёкшую, повреждённую или чужую сессию), `roleLabel`. Вызов Edge Function
  `auth` остаётся в `authenticateWithSupabase()` в `app.js`.
- `src/realtime-sync.js` — `describeRealtimeChange(table, payload, userId)`
  превращает событие postgres_changes в список действий (`delta`,
  `refetch-review`, `refetch-comment`, `own-like`, `own-reaction`,
  `blocked`); `app.js` выполняет их в `runRealtimeAction()`. Новая таблица
  Realtime = запись в `REALTIME_TABLES` + ветка в `describeRealtimeChange`.
- `src/review-drafts.js` — черновики рецензий в `localStorage`
  (`xxii_review_draft_v1:<userId>:<releaseId>`, TTL 30 дней): текст и
  критерии сохраняются на каждое изменение (`saveReviewDraft` в `app.js`),
  восстанавливаются в `openRelease` после `resetReviewInputs()`
  (`restoreReviewDraft`) и стираются после публикации. Счётчик под полем
  показывает «Черновик сохранён».
- `src/fonts.css` + `src/fonts/*.woff2` — СГЕНЕРИРОВАНЫ
  `scripts/vendor-fonts.js` (`npm run vendor:fonts`, нужен интернет): тот же
  CSS и те же файлы, что отдаёт Google Fonts, с `unicode-range` и
  `font-display: swap`. Имена файлов версионированы (`inter-v20-<hash>`),
  поэтому `stamp-assets` их не трогает: preload в `index.html` должен
  совпадать с `url()` из `fonts.css` байт в байт. Новое начертание → поправить
  `GOOGLE_CSS_URL` и перезапустить скрипт.
- `src/icons.js` — СГЕНЕРИРОВАН `scripts/build-icons.js` (`npm run build:icons`)
  из devDependency `lucide`: только иконки, которые встречаются в коде
  (`data-lucide="…"`, литералы в `data-lucide="${…}"`, `icon: '…'`,
  `iconName`), и совместимый `lucide.createIcons()`, который не
  пересоздаёт уже нарисованные SVG. Новая иконка → `npm run build:icons` и
  коммит `src/icons.js`; `tests/icons.test.js` падает, если файл устарел.
- `src/catalog-parse.js` — общие чистые функции парсера (браузер + Node).
  TypeScript-копия — `supabase/functions/_shared/catalog_parse.ts`.
- `src/utils.js` — экранирование, кэш, фильтры, JWT claims, бейджи;
  переиспользуется тестами через `module.exports`.
- `server.js` — локальный dev-сервер (только `127.0.0.1`): раздаёт лишь
  `index.html` и `src/` (как GitHub Pages) и повторяет `parse-link`.
- `tests/` (Node `test`): `utils.test.js` — утилиты и фильтрация;
  `data-store.test.js` — сценарии гонок оптимистичных toggle и Realtime;
  `auth-session.test.js` — истёкший/чужой/повреждённый токен, смена аккаунта;
  `realtime-sync.test.js` — разбор событий Realtime по таблицам;
  `review-drafts.test.js` — черновики по релизу/аккаунту, TTL, сбои хранилища;
  `catalog-parse.test.js` — парсер по общим фикстурам;
  `server.test.js` — белый список статики; `fonts.test.js` — шрифты локальны
  и все на месте; `html-escaping.test.js` —
  AST-проверка экранирования в HTML-шаблонах и `innerHTML`;
  `stamp-assets.test.js` — хэши ассетов при деплое; `static-contract.test.js` —
  статические контракты (CSP, порядок скриптов, отсутствие старых путей).

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
  изменения приходят через Supabase Realtime и применяются `applySyncDelta()`
  (тонкая обёртка над `applyCatalogDelta()` из `data-store.js` + рендер).
  Новую логику слияния состояния добавлять в `data-store.js` с тестом, а не в
  IIFE.
- **Состояние** — глобальные переменные: `releases`, `releasesById` (Map),
  `reviews`, `reviewsByRelId` (Map), `avgRatingByRelId` (Map), `comments`,
  `commentsByReviewId` (Map), `likedSet`, `reactedSet`, `genreCounts`, `user`.
  Фреймворка нет — обновление через `renderReleases()` / `renderReviews()` /
  `renderFeed()` и `innerHTML`.
- **Авторизация**: `authenticateWithSupabase()` отправляет `tg.initData` в
  Edge Function `auth`. Она проверяет подпись бота и `auth_date`
  (`INIT_DATA_MAX_AGE`, по умолчанию 24 ч), читает роль из `admins` /
  `blocked_users` и выпускает обычную сессию Supabase Auth (через
  `generateLink` magic link, `app_metadata.telegram_user_id`). Клиент хранит
  JWT в `localStorage` (`xxii_auth_v1`, восстанавливает до `/auth`) и
  передаёт его Data API через опцию `accessToken` клиента Supabase и
  `Authorization: Bearer` в Edge Functions. `X-Telegram-Init-Data`
  дополнительно шлётся только в `parse-link`. RLS опирается на claims JWT.
  После выдачи новой сессии `auth` отзывает прежние сессии пользователя
  (`revokeOtherSessions`, `_shared/session_revoke.ts`, scope `others`) уже
  после ответа (`EdgeRuntime.waitUntil`): иначе каждый вход оставлял в
  `auth.sessions` бессрочную сессию с неиспользуемым refresh-токеном. Edge
  Functions CI не деплоит — выкладываются вручную.
- **Telegram SDK**: официальный скрипт грузится асинхронно, поэтому `tg` в
  `app.js` — Proxy к текущему `window.Telegram.WebApp` (сначала заглушка,
  потом реальный SDK). Подписки на SDK (BackButton, `themeChanged`,
  CloudStorage, цвета шапки) делает `bindTelegramSdk()` — он вызывается при
  старте и повторно по `xxii:telegram-sdk-ready`; новые подписки добавлять
  туда. Возможности: haptics (`tgHaptic`,
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
  Правка своей рецензии: `startEditReview()` переводит форму в режим
  «Редактировать рецензию», `saveReviewEdit()` вызывает RPC `update_review`
  (pessimistic), `cancelEditReview()`. Кнопка видна только если в строке из
  `reviews_view` есть `editedAt` (миграция `20261104090000_review_editing`
  применена); правка помечается «изменено».
- Комментарии: `submitComment()`, `deleteComment()`, `toggleComments()`,
  `renderCommentsSection()` (черновики переживают ре-рендер — `commentDrafts`).
- Реакции/лайки: `toggleLikeAPI()`, `toggleReviewReaction()`.
- Профиль: `openProfileModal()`, `computeProfileBadges()` (бейджи-достижения),
  `renderProfileCriteriaChart()` (график предпочтений критика).
- Добавление релиза (только админ): `handleAddRelease()` (oEmbed → бэкенд →
  ручной ввод) и `saveManualRelease()`.
- Шеринг: `shareRelease()` запрашивает у `share-message` prepared message или
  канонический deep-link для старых Telegram-клиентов.
- Push: `toggleNotifications()` (общий выключатель для всех уведомлений бота).
  Новый релиз → всем подписчикам. Реакция «полезно» или комментарий к
  рецензии → её автору: триггеры `tr_review_reactions_insert_notification` /
  `tr_review_comments_insert_notification` шлют строку в `send-notifications`,
  логика — `_shared/review_activity.ts`. Свои действия не уведомляют; кто
  поставил реакцию, не раскрывается; по рецензии не чаще раза в 30 минут на
  вид (`claim_review_activity_notification`, таблица
  `review_activity_notifications`), повторная реакция того же человека —
  никогда (`review_reaction_notified`).
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
  `escapeCssString` (CSS-селекторы). Утилиты — в `src/utils.js`. Это
  проверяет `tests/html-escaping.test.js`: каждая `${…}` в HTML-шаблоне
  `app.js`/`utils.js` должна быть `escapeHtml(...)`, литералом, числом или
  вложенным шаблоном, а `innerHTML` — получать только шаблоны или
  `.map(шаблон).join()`. Исключения — только в `SAFE_INTERPOLATIONS` с
  объяснением, почему там нет пользовательских данных.
- **Роль пользователя определяет только сервер**: `isAdmin`/`isBlocked` из
  ответа функции `auth`, а права на запись проверяют RLS и RPC. Флаги в
  `localStorage` нужны только для раннего UI — никогда не доверять клиенту.
- Сетевые мутации двух видов: **toggle-операции оптимистичные с откатом**
  (`toggleLikeAPI`, `toggleReviewReaction`, `toggleNotifications`,
  `submitComment`, `deleteComment`); **создание/удаление рецензий и релизов
  pessimistic** — ждут ответа сервера, затем меняют локальное состояние
  (`addReview`, `saveManualRelease`, `executeDeleteReview`,
  `executeDeleteRelease`, `saveReviewEdit`). У `authenticated` на
  `public.reviews` только колоночные права: INSERT тех полей, что пишет
  `create_review`, UPDATE — `text, criteria, base_rating`; триггер
  `set_review_server_fields` сам ставит автора, время, рейтинг, `edited_at` и
  не даёт клиенту менять `reaction_count`, `release_id`, `id`.
  `create_review` / `create_comment` принимают
  клиентский `p_id`; клиент всё равно сливает гонку с Realtime через
  `adoptCreatedRecord` и `isSameReview` (рецензия — по id или
  `(relId, authorId)`). Подтверждения удаления — шторка
  `modal-confirm-action`, не `window.confirm`.
- Доступность: `aria-label`, `role="button"`, `tabindex`, поддержка
  `prefers-reduced-motion` (анимации и морф отключаются).

## Команды

- Тесты (утилиты, фильтрация и статические контракты): `npm test`
- Синтаксис (как в CI): `node --check` для `src/app.js`, `src/utils.js`,
  `src/catalog-parse.js`, `src/data-store.js`, `src/auth-session.js`,
  `src/realtime-sync.js`, `src/review-drafts.js`, `scripts/stamp-assets.js`, `src/boot.js`,
  `src/telegram-web-app.js` и `server.js`
- Аудит зависимостей: `npm audit --audit-level=high`
- Tailwind в синхроне (CI): `npm run build:css && git diff --exit-code -- src/tailwind.css`
- Edge Functions: `deno fmt --check supabase/functions`,
  `deno check --frozen supabase/functions/*/index.ts` и
  `deno test --frozen --allow-read=tests/fixtures supabase/functions/_shared/*_test.ts`
- База/RLS: `supabase db start && supabase test db`
- Пересобрать Tailwind после изменения классов: `npm install && npm run build:css`
- Пересобрать иконки после новой `data-lucide`: `npm run build:icons`
- Новая npm-зависимость → добавить её и в `workspace.packageJson.dependencies`
  в `deno.lock` (иначе `deno check --frozen` в CI падает)
- Локальный запуск: `node server.js` → `http://127.0.0.1:3000`
- Сброс кэша Telegram WebView автоматический: при деплое
  `node scripts/stamp-assets.js _site` заменяет `?v=…` у каждого локального
  `src/…` в `index.html` на хэш содержимого. Ручные `?v=N` в репозитории
  поднимать не нужно; новый скрипт/стиль просто подключается из `src/`.
- Полная проверка UI требует среды Telegram Mini App.

## Известные риски

- Широкий `innerHTML` в рендер-функциях — держать экранирование строгим
  (страхует `html-escaping.test.js`, но он не видит HTML, собранный
  конкатенацией строк через `+`).
- `'unsafe-inline'` остаётся в `style-src` CSP — нужно для inline-атрибутов
  `style` в шаблонах.
- Telegram SDK остаётся внешней зависимостью без SRI: официальный URL обновляет
  Telegram. Остальные runtime-библиотеки находятся в `src/`. Пока SDK не
  загрузился (или telegram.org недоступен), работает заглушка: initData есть,
  но haptics, CloudStorage и `shareMessage` недоступны.
- JWT сессии лежит в `localStorage` — XSS через `innerHTML` равен угону
  сессии, поэтому экранирование критично.
- Edge Functions отвечают с `Access-Control-Allow-Origin: *`; защита — Bearer
  JWT и проверка initData, а не CORS.
- `supabase/schema.sql` — только указатель; применяемая схема определяется
  упорядоченными файлами `supabase/migrations/`.
- `identity_contract` применён на проде 2026-08-17: PK `admins` /
  `blocked_users` — `user_id`. Down-миграции нет.
