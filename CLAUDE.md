# CLAUDE.md — music-bot (фронтенд XXII SOUND)

Telegram Mini App «XXII SOUND»: каталог музыкальных релизов с рецензиями,
оценками по критериям, лайками и реакциями. Это **фронтенд**. Парный
репозиторий с API — `music_backend` (FastAPI + MongoDB).

## Стек

- Ванильный JavaScript (ES6+), **без фреймворка и без сборки**.
- Tailwind CSS, Lucide Icons, Telegram WebApp SDK — всё через CDN.
- Всё приложение — один файл `index.html` (~2500 строк: HTML + CSS + JS).

## Структура

- `index.html` — всё приложение (разметка, стили в `<style>`, логика в финальном
  `<script>`).
- `src/utils.js` — утилиты экранирования, подключается отдельным `<script>`
  и переиспользуется тестами через `module.exports`.
- `tests/utils.test.js` — тесты утилит (Node встроенный `test`).
- `CODE_AUDIT_*.md` — отчёты аудитов.

## Архитектура

- **SPA с 4 вкладками**: `home`, `feed`, `likes`, `settings` (`TAB_ORDER`),
  переключение — `switchTab()`. Детали и формы — модалки (`openModal`/
  `closeModal`), стек модалок `openModalStack` для нативной кнопки «Назад».
- **Поток данных**: cache-first. `fetchDB()` мгновенно показывает кэш
  (`localStorage`, ключ `xxii_cache_v2`, TTL 15 мин), затем `GET /api/data`.
  Real-time — long-poll `GET /api/sync/releases` в `syncLoopTick()`,
  инкрементальные дельты применяет `applySyncDelta()`.
- **Состояние** — глобальные переменные: `releases`, `releasesById` (Map),
  `reviews`, `reviewsByRelId` (Map), `avgRatingByRelId` (Map), `likedSet`,
  `reactedSet`, `genreCounts`, `user`. Фреймворка нет — обновление через
  `renderReleases()` / `renderReviews()` / `renderFeed()` и `innerHTML`.
- **Telegram SDK**: авторизация через `tg.initData` (заголовок
  `X-Telegram-Init-Data`, см. `authHeaders()`); haptics (`tgHaptic`,
  `tgHapticNotify`); тема; `CloudStorage`; deep-link `start_param`
  (`handleStartParam` открывает релиз по `?startapp=<id>`).
- **Бэкенд**: `BACKEND_URL` захардкожен в `index.html`. Контракт см.
  `music_backend/CLAUDE.md`. Внешние API: noembed, iTunes (обложки),
  ui-avatars (фолбэк-аватары) — все домены перечислены в CSP `connect-src`.

## Ключевые функции

`getFilteredReleases()` (жанр + поиск + сортировка), `renderReleaseCard()`,
`openRelease()`, `addReview()`, `toggleLikeAPI()`, `toggleReviewReaction()`,
`handleAddRelease()`/`saveManualRelease()` (добавление релиза, только админ),
`renderCriteriaChart()` (график средних оценок), `toggleNotifications()`
(подписка на push), pull-to-refresh — IIFE `setupPullToRefresh()`.

## Конвенции

- **Всегда экранировать** пользовательские данные в шаблонах `innerHTML`:
  `escapeHtml` (текст), `escapeJsHtml` (внутри `onclick='...'`),
  `escapeCssString` (CSS-селекторы). Утилиты — в `src/utils.js`.
- **Роль пользователя определяет только сервер** (`currentUser` из `/api/data`),
  никогда не доверять клиенту.
- Сетевые мутации — **оптимистичные, с откатом** при ошибке (образец —
  `toggleLikeAPI`, `toggleReviewReaction`, `toggleNotifications`).
- Доступность: `aria-label`, `role="button"`, `tabindex`, поддержка
  `prefers-reduced-motion`.

## Команды

- Тесты утилит: `node --test`
- Синтаксис: `node --check src/utils.js`
- Локальный просмотр: открыть `index.html` (есть безопасный фолбэк вне Telegram).
- Полная проверка UI требует среды Telegram Mini App.

## Известные риски

- Много inline-обработчиков (`onclick`) + широкий `innerHTML` — основная
  XSS-поверхность; держать экранирование строгим.
- `unsafe-inline` в CSP (`script-src`/`style-src`) — ослабляет защиту.
- Зависимость от CDN — supply-chain риск (SRI есть только у Lucide).
