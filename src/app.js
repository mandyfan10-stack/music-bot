    const tg = window.Telegram?.WebApp || {
      initData: '',
      initDataUnsafe: {},
      expand() {},
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} }
    };
    tg.expand?.();

    // Нативная кнопка «Назад» закрывает верхнюю открытую модалку.
    try {
      tg.BackButton?.onClick?.(() => {
        if (openModalStack.length > 0) closeModal(openModalStack[openModalStack.length - 1]);
      });
    } catch (_) {}

    const BACKEND_URL = "https://music-backend-qjvk.onrender.com";
    // URL Mini App для deep-link шеринга (?startapp=<id>) — приходит из /api/data.
    let miniAppUrl = '';

    // Telegram initData — подписанная строка для серверной проверки
    const tgInitData = tg.initData || '';
    const tgUser = tg.initDataUnsafe?.user;

    // Базовый display name (до ответа сервера)
    const localDisplayName = (tgUser?.username ? `@${tgUser.username}` : tgUser?.first_name) || 'Гость';

    // Роль определяется ТОЛЬКО сервером, не клиентом!
    let user = {
      userId: (tgUser && tgUser.id) || null,
      username: localDisplayName,
      role: 'Пользователь',
      isAdmin: false,
      isBlocked: false,
      isAuthenticated: false,
      notificationsEnabled: true
    };
    let blockedUsers = [];

    // Заголовки авторизации для всех API-запросов
    function authHeaders(extra = {}) {
      return {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': tgInitData,
        ...extra
      };
    }

    function tgHaptic(style = 'light') {
      try {
        const version = Number.parseFloat(tg?.version || '0');
        if (!version || version < 6.1) return;
        tg?.HapticFeedback?.impactOccurred(style);
      } catch (_) {}
    }

    // Нативный отклик на успех/ошибку/предупреждение.
    function tgHapticNotify(type = 'success') {
      try {
        const version = Number.parseFloat(tg?.version || '0');
        if (!version || version < 6.1) return;
        tg?.HapticFeedback?.notificationOccurred(type);
      } catch (_) {}
    }

    function getHapticTarget(event) {
      const source = event.target instanceof Element ? event.target : null;
      if (!source) return null;
      const target = source.closest('button, [role="button"], .modal-overlay');
      if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return null;
      return target;
    }

    // Перерисовка иконок Lucide. Lucide грузится с CDN — если он не доступен,
    // приложение не должно падать с ReferenceError.
    function refreshIcons() {
      try {
        if (typeof lucide !== 'undefined') lucide.createIcons();
      } catch (_) {}
    }

    // Остров статуса синхронизации (в духе iOS Dynamic Island): при синке и
    // оффлайне развёрнут с текстом, при «всё актуально» — кратко показывается
    // и плавно сворачивается в точку.
    let syncCollapseTimer = null;
    function setSyncStatus(text, mode = 'idle') {
      const el = document.getElementById('sync-status');
      if (!el) return;
      const textEl = el.querySelector('.sync-island-text');
      if (textEl) textEl.textContent = text;
      else el.textContent = text;
      el.classList.remove('is-ok', 'is-warn', 'is-syncing');
      if (syncCollapseTimer) { clearTimeout(syncCollapseTimer); syncCollapseTimer = null; }

      if (mode === 'ok') {
        el.classList.add('is-ok');
        el.classList.remove('is-collapsed');
        // Свернуть в точку после короткой паузы.
        syncCollapseTimer = setTimeout(() => el.classList.add('is-collapsed'), 1800);
      } else if (mode === 'warn') {
        el.classList.add('is-warn');
        el.classList.remove('is-collapsed');
      } else {
        el.classList.add('is-syncing');
        el.classList.remove('is-collapsed');
      }
    }

    document.addEventListener('pointerdown', (event) => {
      const btn = event.target.closest('.btn-press');
      if (!btn || btn.disabled) return;
      const rect = btn.getBoundingClientRect();
      btn.style.setProperty('--press-x', `${event.clientX - rect.left}px`);
      btn.style.setProperty('--press-y', `${event.clientY - rect.top}px`);

      const ripple = document.createElement('span');
      ripple.className = 'press-ripple';
      btn.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    });

    document.addEventListener('click', (event) => {
      if (getHapticTarget(event)) tgHaptic('light');
    });

    document.addEventListener('keydown', (event) => {
      if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
      const target = getHapticTarget(event);
      if (target?.matches('[role="button"]')) tgHaptic('light');
    });

    // =====================================================
    // ДЕЛЕГИРОВАНИЕ СОБЫТИЙ
    // Inline-обработчики (onclick и т.п.) убраны — это позволяет
    // не держать 'unsafe-inline' в script-src CSP. Интерактивные
    // элементы помечаются data-act / data-act-input / data-act-focus /
    // data-act-change, а параметры передаются через data-* атрибуты.
    // =====================================================
    const clickActions = {
      'close-welcome': () => closeWelcomeScreen(),
      'open-profile': (el) => openProfileModal(el.dataset.user ? {
        id: el.dataset.authorId || null,
        username: el.dataset.username || '',
        displayName: el.dataset.user
      } : null),
      'open-add': () => openAddModal(),
      'clear-search': () => clearSearch(),
      'clear-genre': () => clearGenreFilter(),
      'set-sort': (el) => setSortMode(el.dataset.sort),
      'reset-filters': () => resetFilters(),
      'select-genre': (el) => selectGenreFilter(el.dataset.genre),
      'select-genre-add': (el) => selectGenreForAdd(el.dataset.genre),
      'set-theme': (el) => changeTheme(el.dataset.theme, el),
      'toggle-notifications': () => toggleNotifications(),
      'switch-tab': (el) => switchTab(el.dataset.tab),
      'close-modal': (el) => closeModal(el.dataset.modal),
      'handle-add-release': () => handleAddRelease(),
      'pick-cover': () => document.getElementById('manual-cover-input')?.click(),
      'save-manual-release': () => saveManualRelease(),
      'share-release': () => shareRelease(),
      'submit-review': () => addReview(),
      'execute-delete-release': () => executeDeleteRelease(),
      'execute-delete-review': () => executeDeleteReview(),
      'toggle-block-user': () => toggleBlockUser(),
      'delete-all-reviews': () => deleteAllReviewsByUser(),
      'open-release': (el) => openRelease(el.dataset.id),
      'toggle-like': (el, e) => toggleLikeAPI(e, el.dataset.id),
      'toggle-reaction': (el) => toggleReviewReaction(el.dataset.id),
      'open-confirm-review-delete': (el) => openConfirmReviewDelete(el.dataset.id, el.dataset.rel),
      'toggle-comments': (el) => toggleComments(el.dataset.id),
      'submit-comment': (el) => submitComment(el.dataset.id),
      'delete-comment': (el) => deleteComment(el.dataset.id, el.dataset.review),
    };

    document.addEventListener('click', (event) => {
      const el = event.target.closest('[data-act]');
      if (!el || el.disabled) return;
      const handler = clickActions[el.dataset.act];
      if (handler) handler(el, event);
    });

    document.addEventListener('input', (event) => {
      const el = event.target.closest('[data-act-input]');
      if (!el) return;
      if (el.dataset.actInput === 'search') onSearchInput();
      else if (el.dataset.actInput === 'review-char-count') updateReviewCharCount();
      else if (el.dataset.actInput === 'comment-draft') commentDrafts.set(el.dataset.id, el.value);
    });

    document.addEventListener('focusin', (event) => {
      const el = event.target.closest('[data-act-focus]');
      if (el && el.dataset.actFocus === 'show-genre-dd') showGenreDropdown();
    });

    document.addEventListener('change', (event) => {
      const el = event.target.closest('[data-act-change]');
      if (el && el.dataset.actChange === 'cover-upload') handleCoverUpload(event);
    });

    // Активация карточек-релизов (div role=button) с клавиатуры.
    document.addEventListener('keydown', (event) => {
      if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
      const el = event.target.closest('[data-act="open-release"]');
      if (!el || ['BUTTON', 'A', 'INPUT', 'TEXTAREA'].includes(el.tagName)) return;
      event.preventDefault();
      openRelease(el.dataset.id);
    });

    // Глобальный перехват ошибок — приложение не падает молча: логируем и
    // показываем тост (не чаще раза в 8 с, чтобы не спамить).
    let lastErrorToastTs = 0;
    function reportGlobalError(label, err) {
      console.error('[' + label + ']', err);
      const now = Date.now();
      if (now - lastErrorToastTs > 8000) {
        lastErrorToastTs = now;
        try { showToast('Что-то пошло не так'); } catch (_) {}
      }
    }
    window.addEventListener('error', (e) => reportGlobalError('error', e.error || e.message));
    window.addEventListener('unhandledrejection', (e) => reportGlobalError('promise', e.reason));

    // Фолбэк-обложка: событие error не всплывает — слушаем в фазе перехвата.
    document.addEventListener('error', (event) => {
      const img = event.target;
      if (img && img.tagName === 'IMG' && img.dataset.fallback && img.src !== img.dataset.fallback) {
        img.src = img.dataset.fallback;
      }
    }, true);

    document.getElementById('welcome-user-name').innerText = user.username;

    if (localStorage.getItem('raper_welcomed_v1')) {
        document.getElementById('welcome-screen').classList.add('hidden');
    }

    function closeWelcomeScreen() {
        const ws = document.getElementById('welcome-screen');
        ws.classList.add('opacity-0');
        setTimeout(() => {
            ws.classList.add('hidden');
            localStorage.setItem('raper_welcomed_v1', 'true');
        }, 700);
    }

    // Обновление UI после получения роли с сервера
    function applyUserRole() {
      document.getElementById('user-name').innerText = user.username;
      const headerRoleEl = document.getElementById('user-role');
      headerRoleEl.innerText = user.isAdmin ? 'Создатель' : 'Пользователь';
      if (user.isAdmin) {
        headerRoleEl.classList.remove('text-gray-500');
        headerRoleEl.classList.add('text-red-500', 'font-bold');
        document.getElementById('btn-add-release').classList.remove('hidden');
      } else {
        headerRoleEl.classList.add('text-gray-500');
        headerRoleEl.classList.remove('text-red-500', 'font-bold');
        document.getElementById('btn-add-release').classList.add('hidden');
      }
      if (user.isBlocked) {
        showToast('Ваш аккаунт заблокирован. Только чтение.');
      }
    }

    // Отражает текущее состояние подписки на push в переключателе «Настроек».
    function applyNotificationsToggle() {
      const toggle = document.getElementById('notif-toggle');
      if (!toggle) return;
      const on = !!user.notificationsEnabled;
      toggle.classList.toggle('on', on);
      toggle.setAttribute('aria-checked', on ? 'true' : 'false');
      toggle.disabled = !user.isAuthenticated;
    }

    // Включение/выключение push-уведомлений — оптимистично, с откатом при ошибке.
    async function toggleNotifications() {
      if (!user.isAuthenticated) return showToast('Войдите через Telegram');
      const next = !user.notificationsEnabled;
      user.notificationsEnabled = next;
      applyNotificationsToggle();
      try {
        const res = await fetch(`${BACKEND_URL}/api/notifications/subscribe`, {
          method: 'POST', headers: authHeaders(), body: JSON.stringify({ enabled: next })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showToast(next ? 'Уведомления включены' : 'Уведомления выключены', 'success');
      } catch (e) {
        console.error('Notifications toggle error:', e);
        user.notificationsEnabled = !next; // откат
        applyNotificationsToggle();
        showToast('Не удалось сохранить настройку', 'error');
      }
    }

    document.getElementById('user-name').innerText = user.username;

    let releases = [], likedSet = new Set(), releasesById = new Map(), reviews = [], reviewsByRelId = new Map(), avgRatingByRelId = new Map(), genreCounts = {}, activeReleaseId = null, selectedRating = 10, selectedCriteria = { sound: 5, production: 5, originality: 5, meaning: 5, relevance: 5, image: 5 };
    let reactedSet = new Set(); // id рецензий, на которые текущий пользователь отреагировал
    let comments = [], commentsByReviewId = new Map();
    let expandedComments = new Set(); // id рецензий с раскрытой веткой комментариев
    let commentDrafts = new Map();    // reviewId → черновик комментария (переживает ре-рендер)
    const COMMENT_MAX_LENGTH = 1000;

    // Метка последнего визита — для бейджа «новое» (читаем старое значение, пишем текущее).
    const lastSeenTs = parseInt(localStorage.getItem('xxii_last_seen') || '0', 10);
    (function markVisit() {
      const now = String(Date.now());
      try { localStorage.setItem('xxii_last_seen', now); } catch (_) {}
      try { tg.CloudStorage?.setItem?.('xxii_last_seen', now); } catch (_) {}
    })();

    function updateGenreCounts() {
      genreCounts = {};
      releases.forEach(r => {
        const g = r.genre || 'Другое';
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      });
    }

    function updateReviewsMap() {
      reviewsByRelId.clear();
      avgRatingByRelId.clear();
      reviews.forEach(r => {
        if (!reviewsByRelId.has(r.relId)) {
          reviewsByRelId.set(r.relId, []);
        }
        reviewsByRelId.get(r.relId).push(r);
      });
      reviewsByRelId.forEach((rvs, relId) => {
        let avg = 0;
        if (rvs.length > 0) {
          avg = rvs.reduce((s, r) => s + (r.rating || 0), 0) / rvs.length;
        }
        avgRatingByRelId.set(relId, avg);
      });
    }

    // Группировка комментариев по рецензии; в каждой группе — по времени (старые сверху).
    function updateCommentsMap() {
      commentsByReviewId.clear();
      comments.forEach(c => {
        if (!c || !c.reviewId) return;
        if (!commentsByReviewId.has(c.reviewId)) commentsByReviewId.set(c.reviewId, []);
        commentsByReviewId.get(c.reviewId).push(c);
      });
      commentsByReviewId.forEach(list => list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)));
    }
    let pendingReviewDelete = null;
    let pendingReviewTargetReleaseId = null;
    let reviewDeleteMode = false;
    let reviewPublishBlocked = false;
    let existingReviewForActiveRelease = null;
    let activeProfile = null; // { id, username, displayName }
    let activeReleaseReviews = [];
    const REVIEW_MIN_LENGTH = 30;
    const REVIEW_MAX_LENGTH = 3000;


    function openSafeUrl(urlStr) {
      if (!urlStr) return;
      try {
        const url = new URL(urlStr);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          window.open(url.href, '_blank', 'noopener,noreferrer');
        } else {
          console.warn('Небезопасный URL:', urlStr);
        }
      } catch (e) {
        console.warn('Некорректный URL:', urlStr);
      }
    }

    // Deep-link на Mini App, открывающий этот релиз (?startapp=<id>).
    function releaseDeepLink(relId) {
      if (!miniAppUrl) return '';
      const sep = miniAppUrl.includes('?') ? '&' : '?';
      return `${miniAppUrl}${sep}startapp=${encodeURIComponent(relId)}`;
    }

    // Фолбэк-шеринг для клиентов без tg.shareMessage: пересылаем deep-link в бота
    // (а не ссылку на стороннюю площадку).
    function shareReleaseLink(rel) {
      const link = releaseDeepLink(rel.id);
      if (!link) return showToast('Шеринг недоступен');
      const text = `${rel.artist} — ${rel.name}`;
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
      try {
        if (tg.openTelegramLink) tg.openTelegramLink(shareUrl);
        else window.open(shareUrl, '_blank', 'noopener,noreferrer');
      } catch (_) {
        window.open(shareUrl, '_blank', 'noopener,noreferrer');
      }
    }

    // Поделиться релизом: нативное Telegram-сообщение с кнопкой в бота
    // (tg.shareMessage), с фолбэком на deep-link для клиентов старше Bot API 8.0.
    async function shareRelease() {
      const rel = releasesById.get(activeReleaseId);
      if (!rel) return showToast('Нечем поделиться');
      tgHaptic('light');

      const canShareMessage = typeof tg.shareMessage === 'function'
        && parseFloat(tg.version || '0') >= 8;

      if (canShareMessage) {
        try {
          const res = await fetch(`${BACKEND_URL}/api/releases/${encodeURIComponent(rel.id)}/share-message`, {
            method: 'POST', headers: authHeaders()
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = await res.json();
          if (!data.preparedMessageId) throw new Error('No preparedMessageId');
          tg.shareMessage(data.preparedMessageId, (sent) => {
            if (sent) showToast('Отправлено', 'success');
          });
          return;
        } catch (e) {
          console.error('shareMessage error:', e);
          // Фолбэк ниже.
        }
      }
      shareReleaseLink(rel);
    }

    // Deep-link: открыть конкретный релиз, если приложение запущено через startapp=<id>.
    let startParamHandled = false;
    function handleStartParam() {
      if (startParamHandled) return;
      const param = tg.initDataUnsafe?.start_param;
      if (!param) { startParamHandled = true; return; }
      if (releasesById.has(param)) {
        startParamHandled = true;
        openRelease(param);
      }
    }

    function getCriteriaAverage(criteria = {}) {
      const values = criteriaConfig.map(({ key }) => typeof criteria[key] === 'number' ? criteria[key] : 5);
      return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
    }

    function formatCriteria(criteria = {}) {
      return criteriaConfig
        .map(({ key }) => typeof criteria[key] === 'number' ? criteria[key] : 5)
        .join('/');
    }
    let currentPendingLink = '';
    let manualCoverBase64 = null;
    let releaseToDelete = null;

    // --- ПОИСК ПО ЖАНРУ ---
    const GENRES = ['Рэп', 'Хип-хоп', 'Трэп', 'R&B', 'Поп', 'Рок', 'Электронная', 'Джаз', 'Метал', 'Другое'];
    let activeGenreFilter = ''; // текущий активный жанр
    let sortMode = 'new';
    let selectedGenreForAdd = '';
    let genreDropdownOpen = false;
    let searchQuery = ''; // текстовый поиск по релизу, артисту и жанру

    function renderAddGenreSelector(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;
      container.innerHTML = GENRES.map(g => {
        const active = selectedGenreForAdd === g;
        return `<button type="button" data-act="select-genre-add" data-genre="${escapeHtml(g)}" class="btn-press px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
          active ? 'bg-red-500 border-red-500 text-white' : 'bg-white/5 border-white/10 text-gray-300'
        }">${escapeHtml(g)}</button>`;
      }).join('');
    }

    function selectGenreForAdd(genre) {
      selectedGenreForAdd = selectedGenreForAdd === genre ? '' : genre;
      renderAddGenreSelector('manual-genre-selector');
    }

    // Единый поиск: фильтрует каталог по релизу/артисту/жанру и показывает
    // подсказки жанров в дропдауне.
    function onSearchInput() {
      const input = document.getElementById('genre-search');
      searchQuery = input.value.trim();
      document.getElementById('genre-search-clear').classList.toggle('hidden', !searchQuery);
      if (searchQuery.length > 0 || document.activeElement === input) {
        showGenreDropdown();
      } else {
        hideGenreDropdown();
      }
      renderReleases();
      updateResetBtn();
    }

    function renderGenreDropdown(query = '') {
      const list = document.getElementById('genre-dropdown-list');
      const low = query.toLowerCase();

      const matched = GENRES.filter(g => !low || g.toLowerCase().includes(low));

      // Нет подходящего жанра — прячем дропдаун; поиск по каталогу продолжает работать.
      if (matched.length === 0) {
        hideGenreDropdown();
        return;
      }

      list.innerHTML = matched.map(g => {
        const count = genreCounts[g] || 0;
        const isActive = activeGenreFilter === g;
        return `<button data-act="select-genre" data-genre="${escapeHtml(g)}" class="w-full text-left px-4 py-2.5 flex items-center justify-between transition-colors ${
          isActive ? 'bg-red-500/10 text-red-400' : 'text-white hover:bg-white/5'
        }">
          <span class="text-[13px] font-medium">${escapeHtml(g)}</span>
          <span class="text-[11px] text-gray-500">${count} релиз${count === 1 ? '' : count > 1 && count < 5 ? 'а' : 'ов'}</span>
        </button>`;
      }).join('');
    }

    // Тап по подсказке жанра — точный фильтр; текстовый запрос при этом сбрасываем.
    function selectGenreFilter(genre) {
      const input = document.getElementById('genre-search');
      activeGenreFilter = activeGenreFilter === genre ? '' : genre;
      input.value = '';
      searchQuery = '';
      document.getElementById('genre-search-clear').classList.add('hidden');
      hideGenreDropdown();
      updateGenreBadge();
      renderReleases();
      updateResetBtn();
    }

    // Очистка текстового запроса (крестик в поле поиска).
    function clearSearch() {
      const input = document.getElementById('genre-search');
      input.value = '';
      searchQuery = '';
      document.getElementById('genre-search-clear').classList.add('hidden');
      hideGenreDropdown();
      renderReleases();
      updateResetBtn();
    }

    // Снятие фильтра по жанру (крестик на бейдже).
    function clearGenreFilter() {
      activeGenreFilter = '';
      updateGenreBadge();
      renderReleases();
      updateResetBtn();
    }

    function showGenreDropdown() {
      const val = document.getElementById('genre-search').value.trim();
      const dd = document.getElementById('genre-dropdown');
      dd.classList.remove('hidden');
      genreDropdownOpen = true;
      renderGenreDropdown(val);
    }

    function hideGenreDropdown() {
      document.getElementById('genre-dropdown').classList.add('hidden');
      genreDropdownOpen = false;
    }

    function updateGenreBadge() {
      const badge = document.getElementById('active-genre-badge');
      if (activeGenreFilter) {
        badge.classList.remove('hidden');
        document.getElementById('active-genre-name').innerText = activeGenreFilter;
        const count = genreCounts[activeGenreFilter] || 0;
        document.getElementById('active-genre-count').innerText = `${count} релиз${count === 1 ? '' : count > 1 && count < 5 ? 'а' : 'ов'}`;
        refreshIcons();
      } else {
        badge.classList.add('hidden');
      }
    }

    // Закрываем дропдаун при клике вне
    document.addEventListener('click', function(e) {
      if (genreDropdownOpen && !e.target.closest('#filter-bar .relative')) {
        hideGenreDropdown();
      }
    });

    function setSortMode(mode) {
      sortMode = mode;
      document.querySelectorAll('.sort-btn').forEach(b => {
        b.classList.remove('active');
        b.classList.remove('bg-white', 'text-black', 'border-white');
        b.classList.add('bg-white/5', 'border-white/10', 'text-gray-300');
      });
      const active = document.getElementById('sort-' + mode);
      if (active) {
        active.classList.add('active');
        active.classList.add('bg-white', 'text-black', 'border-white');
        active.classList.remove('bg-white/5', 'border-white/10', 'text-gray-300');
      }
      renderReleases();
      updateResetBtn();
    }

    function resetFilters() {
      activeGenreFilter = '';
      sortMode = 'new';
      searchQuery = '';
      document.getElementById('genre-search').value = '';
      document.getElementById('genre-search-clear').classList.add('hidden');
      hideGenreDropdown();
      updateGenreBadge();
      setSortMode('new');
      renderReleases();
    }

    function updateResetBtn() {
      const btn = document.getElementById('btn-reset-filters');
      const hasFilters = activeGenreFilter || sortMode !== 'new' || searchQuery;
      btn.classList.toggle('hidden', !hasFilters);
    }

    // Чистая логика фильтрации/сортировки вынесена в utils.js (filterAndSortReleases)
    // и покрыта тестами; здесь только подстановка текущего состояния.
    function getFilteredReleases() {
      return filterAndSortReleases(releases, {
        genre: activeGenreFilter,
        query: searchQuery,
        sortMode: sortMode,
        avgRating: (id) => avgRatingByRelId.get(id) || 0,
        reviewCount: (id) => (reviewsByRelId.get(id) || []).length,
      });
    }

    const ratingContainer = document.getElementById('rating-buttons-container');
    for(let i=1; i<=10; i++) {
        const btn = document.createElement('button');
        btn.className = 'rating-btn btn-press';
        btn.id = `rate-${i}`;
        btn.innerText = i;
        btn.setAttribute('aria-label', `Оценка ${i} из 10`);
        btn.onclick = () => selectRating(i);
        ratingContainer.appendChild(btn);
    }

    const criteriaContainer = document.getElementById('criteria-buttons-container');
    const criteriaConfig = [
      { key: 'sound', label: 'Звук' },
      { key: 'production', label: 'Продакшн' },
      { key: 'originality', label: 'Оригинальность' },
      { key: 'meaning', label: 'Смысл текста' },
      { key: 'relevance', label: 'Актуальность' },
      { key: 'image', label: 'Сохранение образа' }
    ];
    criteriaConfig.forEach(({ key, label }) => {
      const wrap = document.createElement('div');
      wrap.className = 'flex items-center gap-2 rounded-full bg-white/5 border border-white/10 px-3 py-2';
      wrap.innerHTML = `<span class="text-[11px] text-gray-400 font-medium">${label}</span>`;
      const valueEl = document.createElement('span');
      valueEl.id = `criterion-${key}`;
      valueEl.className = 'text-[12px] font-bold text-white min-w-4 text-center';
      valueEl.innerText = '5';
      wrap.appendChild(valueEl);
      const minus = document.createElement('button');
      minus.className = 'rating-btn btn-press !w-7 !h-7 !rounded-full';
      minus.innerText = '−';
      minus.setAttribute('aria-label', 'Уменьшить оценку для ' + label);
      minus.onclick = () => setCriterion(key, -1);
      const plus = document.createElement('button');
      plus.className = 'rating-btn btn-press !w-7 !h-7 !rounded-full';
      plus.innerText = '+';
      plus.setAttribute('aria-label', 'Увеличить оценку для ' + label);
      plus.onclick = () => setCriterion(key, 1);
      wrap.appendChild(minus);
      wrap.appendChild(plus);
      criteriaContainer.appendChild(wrap);
    });

    function setCriterion(key, delta) {
      const next = Math.max(1, Math.min(10, (selectedCriteria[key] || 5) + delta));
      selectedCriteria = { ...selectedCriteria, [key]: next };
      document.getElementById(`criterion-${key}`).innerText = next;
    }

    function resetReviewInputs() {
      selectedRating = 10;
      selectedCriteria = { sound: 5, production: 5, originality: 5, meaning: 5, relevance: 5, image: 5 };
      selectRating(10);
      criteriaConfig.forEach(({ key }) => {
        const el = document.getElementById(`criterion-${key}`);
        if (el) el.innerText = '5';
      });
      const text = document.getElementById('rev-text');
      if (text) text.value = '';
      updateReviewCharCount();
    }

    function updateReviewCharCount() {
      const textarea = document.getElementById('rev-text');
      const counter = document.getElementById('rev-char-count');
      const submitBtn = document.getElementById('btn-submit-review');
      if (!textarea || !counter || !submitBtn) return;

      const rawLen = textarea.value.length;
      const len = textarea.value.trim().length;
      counter.innerText = `${rawLen} / ${REVIEW_MAX_LENGTH}`;

      const isInvalidLength = len > 0 && (len < REVIEW_MIN_LENGTH || len > REVIEW_MAX_LENGTH);
      if (isInvalidLength) {
        counter.classList.add('text-red-400');
        counter.classList.remove('text-gray-500');
      } else {
        counter.classList.remove('text-red-400');
        counter.classList.add('text-gray-500');
      }

      if (reviewPublishBlocked) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Рецензия уже опубликована';
      } else if (isInvalidLength || len === 0) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Опубликовать';
      } else {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Опубликовать';
      }
    }

    function showToast(msg, haptic = null) {
      const t = document.getElementById('toast');
      document.getElementById('toast-msg').innerText = msg;
      t.classList.replace('opacity-0', 'opacity-100');
      t.classList.replace('pointer-events-none', 'pointer-events-auto');
      setTimeout(() => { t.classList.replace('opacity-100', 'opacity-0'); t.classList.replace('pointer-events-auto', 'pointer-events-none'); }, 2500);
      if (haptic) tgHapticNotify(haptic);
    }

    const TAB_ORDER = ['home', 'feed', 'likes', 'settings'];
    let activeTabId = null;
    let tabTransitionTimer = null;

    function updateTabNav(tabId) {
      document.querySelectorAll('nav > button[id^="tab-"]').forEach(btn => {
        const id = btn.id.replace('tab-', '');
        const icon = btn.querySelector('svg') || btn.querySelector('i');
        const active = id === tabId;
        btn.className = `flex flex-col items-center gap-1 ${active ? 'text-red-500' : 'text-gray-500'} btn-press transition-colors${active ? ' tab-active' : ''}`;
        if (icon) icon.classList.toggle('stroke-[2.5px]', active);
      });
      moveTabIndicator(tabId);
    }

    // Морфящийся индикатор активной вкладки: пружиной перетекает к выбранной.
    let tabIndicatorReady = false;
    function moveTabIndicator(tabId) {
      const ind = document.getElementById('tab-indicator');
      const btn = document.getElementById('tab-' + tabId);
      if (!ind || !btn) return;
      if (!tabIndicatorReady) ind.style.transition = 'none';
      ind.style.width = btn.offsetWidth + 'px';
      ind.style.height = btn.offsetHeight + 'px';
      ind.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
      if (!tabIndicatorReady) {
        void ind.offsetWidth; // первое размещение — без анимации из угла
        ind.style.transition = '';
        ind.classList.add('ready');
        tabIndicatorReady = true;
      }
    }
    window.addEventListener('resize', () => { if (activeTabId) moveTabIndicator(activeTabId); });

    function cleanupTabTransition(screen) {
      if (!screen) return;
      screen.classList.remove(
        'fade-in',
        'tab-screen-entering',
        'tab-screen-exiting',
        'tab-enter-forward',
        'tab-exit-forward',
        'tab-enter-backward',
        'tab-exit-backward'
      );
    }

    function switchTab(tabId) {
      const next = document.getElementById('screen-' + tabId);
      if (!next) return;
      if (tabId === 'likes') renderLikes();
      if (tabId === 'feed') renderFeed();

      const screens = Array.from(document.querySelectorAll('main > div[id^="screen-"]'));
      const current = activeTabId
        ? document.getElementById('screen-' + activeTabId)
        : document.querySelector('main > div[id^="screen-"]:not(.hidden)');

      if (current === next && !next.classList.contains('hidden')) {
        updateTabNav(tabId);
        return;
      }

      if (tabTransitionTimer) {
        clearTimeout(tabTransitionTimer);
        tabTransitionTimer = null;
      }

      screens.forEach(screen => {
        cleanupTabTransition(screen);
        if (screen !== current && screen !== next) screen.classList.add('hidden');
      });

      const main = document.querySelector('main');
      if (main) main.scrollTo({ top: 0, behavior: 'auto' });

      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const previousIndex = TAB_ORDER.indexOf(activeTabId);
      const nextIndex = TAB_ORDER.indexOf(tabId);
      const direction = previousIndex !== -1 && nextIndex < previousIndex ? 'backward' : 'forward';

      activeTabId = tabId;
      updateTabNav(tabId);

      if (!current || current === next || current.id === 'screen-loading' || prefersReducedMotion) {
        screens.forEach(screen => screen.classList.toggle('hidden', screen !== next));
        next.classList.remove('hidden');
        return;
      }

      current.classList.remove('hidden');
      next.classList.remove('hidden');
      void next.offsetWidth;

      current.classList.add('tab-screen-exiting', `tab-exit-${direction}`);
      next.classList.add('tab-screen-entering', `tab-enter-${direction}`);

      tabTransitionTimer = setTimeout(() => {
        current.classList.add('hidden');
        cleanupTabTransition(current);
        cleanupTabTransition(next);
        tabTransitionTimer = null;
      }, 540); // совпадает с длительностью пружинного входа вкладки
    }

    // Стек открытых модалок — для нативной кнопки «Назад» Telegram.
    let openModalStack = [];

    function syncBackButton() {
      try {
        const back = tg?.BackButton;
        if (!back) return;
        if (openModalStack.length > 0) back.show?.();
        else back.hide?.();
      } catch (_) {}
    }

    function openModal(id) {
      const m = document.getElementById(id); m.classList.remove('hidden');
      m.querySelector('.modal-overlay').classList.add('fade-in');
      m.querySelector('.modal-container').classList.add('slide-up-modal');
      openModalStack = openModalStack.filter(x => x !== id);
      openModalStack.push(id);
      document.body.classList.add('modal-open'); // фон уходит вглубь
      syncBackButton();
    }

    function closeModal(id) {
      openModalStack = openModalStack.filter(x => x !== id);
      // Фон возвращается, как только закрыта последняя модалка из стека.
      if (openModalStack.length === 0) document.body.classList.remove('modal-open');
      syncBackButton();
      const m = document.getElementById(id); const c = m.querySelector('.modal-container'); const o = m.querySelector('.modal-overlay');
      c.classList.replace('slide-up-modal', 'slide-down-modal'); o.classList.replace('fade-in', 'fade-out');
      setTimeout(() => {
        m.classList.add('hidden'); c.classList.remove('slide-down-modal'); o.classList.remove('fade-out');
        if(id === 'modal-add') {
          document.getElementById('add-form-step-1').classList.remove('hidden');
          document.getElementById('add-form-step-manual').classList.add('hidden');
          manualCoverBase64 = null;
          document.getElementById('manual-cover-preview').innerHTML = `<i data-lucide="image-plus" class="w-8 h-8 text-gray-400 mb-2"></i><span class="text-[12px] text-gray-400">Загрузить обложку (необязательно)</span>`;
          document.getElementById('manual-artist').value = '';
          document.getElementById('manual-title').value = '';
          refreshIcons();
        }
        if(id === 'modal-release') {
          reviewPublishBlocked = false;
          existingReviewForActiveRelease = null;
        }
        if(id === 'modal-confirm-review-delete') {
          pendingReviewDelete = null;
          pendingReviewTargetReleaseId = null;
          reviewDeleteMode = false;
        }
      }, 500); // совпадает с длительностью slideDown — анимация не обрезается
    }

    // Принадлежит ли рецензия пользователю. authorId приходит с сервера и
    // надёжен; displayName — фолбэк для старых записей без authorId.
    function reviewByUser(review, userId, displayName) {
      if (userId != null && review.authorId != null) {
        return String(review.authorId) === String(userId);
      }
      return !!displayName && review.author === displayName;
    }

    // --- СТАТИСТИКА ПРОФИЛЯ ---
    // Бейджи-достижения, вычисляемые из рецензий пользователя.
    function computeProfileBadges(userReviews) {
      const badges = [];
      const count = userReviews.length;
      if (count >= 1) badges.push({ icon: 'pen-line', label: 'Первая рецензия' });
      if (count >= 10) badges.push({ icon: 'flame', label: 'Плодовитый' });
      if (count >= 25) badges.push({ icon: 'crown', label: 'Ветеран' });

      const genres = new Set();
      userReviews.forEach(r => {
        const rel = releasesById.get(r.relId);
        genres.add((rel && rel.genre) || 'Другое');
      });
      if (genres.size >= 5) badges.push({ icon: 'disc-3', label: 'Меломан' });

      if (count >= 3) {
        const avg = userReviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / count;
        if (avg < 5) badges.push({ icon: 'gavel', label: 'Строгий критик' });
        else if (avg >= 8) badges.push({ icon: 'sparkles', label: 'Щедрый' });
      }
      return badges;
    }

    function renderProfileBadges(userReviews) {
      const wrap = document.getElementById('profile-badges');
      const list = document.getElementById('profile-badges-list');
      if (!wrap || !list) return;
      const badges = computeProfileBadges(userReviews);
      if (!badges.length) {
        wrap.classList.add('hidden');
        list.innerHTML = '';
        return;
      }
      list.innerHTML = badges.map(b => `<span class="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-[11px] font-bold text-gray-200">
          <i data-lucide="${escapeHtml(b.icon)}" class="w-3.5 h-3.5 text-amber-400"></i>${escapeHtml(b.label)}</span>`).join('');
      wrap.classList.remove('hidden');
    }

    // График средних оценок пользователя по 6 критериям (предпочтения критика).
    function renderProfileCriteriaChart(userReviews) {
      const container = document.getElementById('profile-criteria-chart');
      if (!container) return;
      if (!userReviews.length) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
      }
      const sums = {};
      criteriaConfig.forEach(({ key }) => { sums[key] = 0; });
      userReviews.forEach(r => {
        const c = r.criteria || {};
        criteriaConfig.forEach(({ key }) => {
          sums[key] += typeof c[key] === 'number' ? c[key] : 5;
        });
      });
      const bars = criteriaConfig.map(({ key, label }) => {
        const avg = sums[key] / userReviews.length;
        const pct = Math.max(0, Math.min(100, avg * 10));
        return `<div class="flex items-center gap-2">
          <span class="text-[10px] text-gray-400 w-24 shrink-0 truncate" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
          <div class="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
            <div class="h-full rounded-full bg-red-500" style="width: ${pct}%"></div>
          </div>
          <span class="text-[11px] font-bold text-white w-7 text-right">${avg.toFixed(1)}</span>
        </div>`;
      }).join('');
      container.innerHTML = `
        <h3 class="text-[13px] font-bold text-white mb-3 pl-1">Средние оценки по критериям</h3>
        <div class="bg-white/5 border border-white/10 rounded-[1.5rem] p-5 space-y-3">${bars}</div>`;
      container.classList.remove('hidden');
    }

    // target: null → собственный профиль; иначе { id, username, displayName }.
    function openProfileModal(target = null) {
      const profile = (target && typeof target === 'object')
        ? { id: target.id != null ? target.id : null, username: target.username || '', displayName: target.displayName || '' }
        : { id: user.userId != null ? user.userId : null, username: cleanUsername(user.username), displayName: user.username };
      activeProfile = profile;

      const nameEl = document.getElementById('profile-name');
      if(nameEl) {
        // Профиль и его рецензии ищутся по authorId, а не по отображаемому
        // имени — иначе тёзки без @username сливаются в один профиль.
        const userReviews = reviews.filter(r => reviewByUser(r, profile.id, profile.displayName));
        nameEl.textContent = profile.displayName || (profile.username ? '@' + profile.username : '—');

        const isMe = (profile.id != null && user.userId != null)
          ? String(profile.id) === String(user.userId)
          : profile.displayName === user.username;
        // Роль определяется сервером: для себя — из user, для других — по флагу authorIsAdmin в их рецензиях.
        const profileCleanName = profile.username || cleanUsername(profile.displayName);
        const isProfileAdmin = isMe
          ? user.isAdmin
          : userReviews.some(r => r.authorIsAdmin);
        let role = isProfileAdmin ? 'Создатель' : 'Пользователь';

        const pRole = document.getElementById('profile-role');
        pRole.innerText = role;
        if (isProfileAdmin) {
            pRole.className = "px-3 py-1 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-[11px] font-black uppercase tracking-widest mb-6";
        } else {
            pRole.className = "px-3 py-1 bg-white/10 border border-white/20 text-white rounded-lg text-[11px] font-black uppercase tracking-widest mb-6";
        }

        // Проверяем блокировку профиля
        const isProfileBlocked = blockedUsers.includes(profileCleanName);
        if (isProfileBlocked) {
            pRole.innerText = 'Заблокирован';
            pRole.className = "px-3 py-1 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-[11px] font-black uppercase tracking-widest mb-6";
        }

        document.getElementById('profile-reviews-count').innerText = userReviews.length;
        document.getElementById('profile-likes-count').innerText = isMe ? likedSet.size : '?';

        // Средняя выставленная оценка и любимый жанр — по рецензиям пользователя.
        let avgEl = document.getElementById('profile-avg-rating');
        let genreEl = document.getElementById('profile-top-genre');
        if (userReviews.length) {
          const sum = userReviews.reduce((s, r) => s + (typeof r.rating === 'number' ? r.rating : Number(r.rating) || 0), 0);
          avgEl.innerText = (sum / userReviews.length).toFixed(1);
          const genreTally = {};
          userReviews.forEach(r => {
            const rel = releasesById.get(r.relId);
            const g = (rel && rel.genre) || 'Другое';
            genreTally[g] = (genreTally[g] || 0) + 1;
          });
          const topGenre = Object.keys(genreTally).sort((a, b) => genreTally[b] - genreTally[a])[0];
          genreEl.innerText = topGenre || '—';
        } else {
          avgEl.innerText = '—';
          genreEl.innerText = '—';
        }

        // Админ-функции: блокировка + удаление всех рецензий
        const adminActions = document.getElementById('profile-admin-actions');
        if (user.isAdmin && !isMe) {
            adminActions.classList.remove('hidden');
            const blockBtn = document.getElementById('profile-block-text');
            blockBtn.innerText = isProfileBlocked ? 'Разблокировать' : 'Заблокировать';
        } else {
            adminActions.classList.add('hidden');
        }

        renderProfileBadges(userReviews);
        renderProfileCriteriaChart(userReviews);
        renderUserReviews(userReviews, isMe);

        const safeName = (profile.displayName || profile.username || 'XX').replace('@', '').substring(0, 2).toUpperCase() || 'XX';
        document.getElementById('profile-avatar').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(safeName)}&background=1c1c1e&color=fff&size=300`;

        openModal('modal-profile');
        refreshIcons();
      }
    }

    // --- АДМИН-ФУНКЦИИ: блокировка и удаление ---
    async function toggleBlockUser() {
      if (!activeProfile || !user.isAdmin) return;
      const cleanName = activeProfile.username || cleanUsername(activeProfile.displayName);
      if (!cleanName) return showToast('У пользователя нет @username');
      const isCurrentlyBlocked = blockedUsers.includes(cleanName);
      try {
        const res = await fetch(`${BACKEND_URL}/api/block`, {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ username: cleanName, blocked: !isCurrentlyBlocked })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (isCurrentlyBlocked) {
          blockedUsers = blockedUsers.filter(u => u !== cleanName);
          showToast(`@${cleanName} разблокирован`);
        } else {
          blockedUsers.push(cleanName);
          showToast(`@${cleanName} заблокирован`);
        }
        openProfileModal(activeProfile);
      } catch(e) { showToast('Ошибка: ' + e.message); }
    }

    async function deleteAllReviewsByUser() {
      if (!activeProfile || !user.isAdmin) return;
      const cleanName = activeProfile.username || cleanUsername(activeProfile.displayName);
      if (!cleanName) return showToast('У пользователя нет @username');
      if (!confirm(`Удалить ВСЕ рецензии @${cleanName}?`)) return;
      try {
        const res = await fetch(`${BACKEND_URL}/api/reviews/by-author/${encodeURIComponent(cleanName)}`, {
          method: 'DELETE', headers: authHeaders()
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const goneReviewIds = new Set(
          reviews.filter(r => cleanUsername(r.authorUsername || r.author) === cleanName).map(r => r.id)
        );
        reviews = reviews.filter(r => cleanUsername(r.authorUsername || r.author) !== cleanName);
        updateReviewsMap();
        comments = comments.filter(c => !goneReviewIds.has(c.reviewId));
        updateCommentsMap();
        showToast(`Удалено ${data.deleted} рецензий`);
        openProfileModal(activeProfile);
      } catch(e) { showToast('Ошибка: ' + e.message); }
    }

    function openAddModal() {
      openModal('modal-add');
      document.getElementById('input-link').value = '';
      document.getElementById('btn-add-text').innerText = 'Распознать и добавить';
      selectedGenreForAdd = '';
      renderAddGenreSelector('manual-genre-selector');
    }
    
    function selectRating(val) { 
      selectedRating = val; 
      document.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('active')); 
      document.getElementById(`rate-${val}`).classList.add('active'); 
    }

    // --- КЭШИРОВАНИЕ: мгновенный старт из localStorage ---
    const CACHE_KEY = 'xxii_cache_v2';
    const CACHE_TTL_MS = 15 * 60 * 1000;

    function saveCache(data) {
      try {
        // currentUser (роль/блокировка) не кэшируем — статус может устареть.
        const { currentUser, ...cacheable } = data;
        const payload = {
          savedAt: Date.now(),
          data: cacheable
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
      } catch(e) {}
    }

    function loadCache() {
      try {
        const raw = JSON.parse(localStorage.getItem(CACHE_KEY));
        if (!raw) return null;

        // Старый формат не содержал timestamp, поэтому не показываем потенциально вечные stale-данные.
        if (Array.isArray(raw.releases) || Array.isArray(raw.reviews)) {
          localStorage.removeItem(CACHE_KEY);
          return null;
        }

        if (!raw.savedAt || !raw.data) return null;
        if (Date.now() - raw.savedAt > CACHE_TTL_MS) return null;

        return raw.data;
      } catch(e) {
        return null;
      }
    }

    let sessionExpiredWarned = false;
    function applyData(data) {
      releases = data.releases || [];
      releasesById = new Map(releases.map(r => [r.id, r]));
      reviews = data.reviews || [];
      updateReviewsMap();
      comments = data.comments || [];
      updateCommentsMap();
      updateGenreCounts();
      likedSet = new Set(data.likes || []);
      reactedSet = new Set(data.myReactions || []);
      blockedUsers = data.blockedUsers || [];
      if (typeof data.miniAppUrl === 'string') miniAppUrl = data.miniAppUrl;
      if (data.syncCursor != null) syncCursor = String(data.syncCursor);
      if (data.currentUser) {
        if (data.currentUser.userId != null) user.userId = data.currentUser.userId;
        user.username = data.currentUser.displayName || user.username;
        user.isAdmin = !!data.currentUser.isAdmin;
        user.isBlocked = !!data.currentUser.isBlocked;
        user.isAuthenticated = !!data.currentUser.isAuthenticated;
        user.notificationsEnabled = data.currentUser.notificationsEnabled !== false;
        user.role = user.isAdmin ? 'Создатель' : 'Пользователь';
        // initData отправлена, но сервер не принял её — сессия Telegram устарела.
        if (tg.initData && !user.isAuthenticated && !sessionExpiredWarned) {
          sessionExpiredWarned = true;
          showToast('Сессия Telegram устарела — переоткройте приложение');
        }
      }
      applyUserRole();
      applyNotificationsToggle();
      renderReleases();
      switchTab('home');
      handleStartParam();
    }

    // Загрузка: кэш мгновенно → сервер фоном
    async function fetchDB() {
        setSyncStatus('Загрузка релизов', 'syncing');

        // 1. Мгновенно показываем кэш
        const cached = loadCache();
        if (cached) {
          applyData(cached);
          setSyncStatus('Обновляем релизы', 'syncing');
        }

        // 2. Загружаем свежие данные с сервера
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);

            const res = await fetch(`${BACKEND_URL}/api/data`, {
                signal: controller.signal,
                headers: authHeaders()
            });
            clearTimeout(timeoutId);

            if(!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();

            // Сохраняем в кэш и обновляем UI
            saveCache(data);
            applyData(data);
            setSyncStatus('Всё актуально', 'ok');
        } catch(e) {
            if (e.name === 'AbortError') {
                console.error("Сервер Render не успел проснуться за 60 секунд.");
            } else {
                console.error("Ошибка загрузки БД:", e.message || e);
            }
            setSyncStatus(cached ? 'Оффлайн (кэш)' : 'Нет соединения', 'warn');
            if (!cached) showToast("Работаем в оффлайн-режиме (сервер недоступен)");
        }
    }

    // --- REAL-TIME СИНХРОНИЗАЦИЯ (long-poll /api/sync/releases) ---
    // Курсор — строка: токены (time_ns) превышают Number.MAX_SAFE_INTEGER,
    // числом JS терял бы точность и переотдавал бы те же события в цикле.
    let syncCursor = '0';
    let syncLoopActive = false;
    let syncAbortController = null;
    let syncRetryTimer = null;
    const SYNC_RETRY_BASE_MS = 5000, SYNC_RETRY_MAX_MS = 30000;
    let syncRetryDelay = SYNC_RETRY_BASE_MS;

    // Применяет инкрементальную дельту от сервера к локальному состоянию.
    function applySyncDelta(data) {
      let changed = false;

      (data.releases || []).forEach(r => {
        if (!r || !r.id) return;
        const idx = releases.findIndex(x => x.id === r.id);
        if (idx >= 0) releases[idx] = r;
        else releases.unshift(r);
        releasesById.set(r.id, r);
        changed = true;
      });

      (data.deletedReleaseIds || []).forEach(id => {
        if (!releasesById.has(id)) return;
        releasesById.delete(id);
        releases = releases.filter(x => x.id !== id);
        likedSet.delete(id);
        if (activeReleaseId === id) closeModal('modal-release');
        changed = true;
      });

      (data.reviews || []).forEach(rv => {
        if (!rv || !rv.id) return;
        const idx = reviews.findIndex(x => x.id === rv.id);
        if (idx >= 0) reviews[idx] = rv;
        else reviews.unshift(rv);
        changed = true;
      });

      (data.deletedReviewIds || []).forEach(id => {
        const before = reviews.length;
        reviews = reviews.filter(x => x.id !== id);
        if (reviews.length !== before) changed = true;
      });

      let commentsChanged = false;

      (data.comments || []).forEach(c => {
        if (!c || !c.id) return;
        const idx = comments.findIndex(x => x.id === c.id);
        if (idx >= 0) comments[idx] = c;
        else comments.push(c);
        commentsChanged = true;
      });

      (data.deletedCommentIds || []).forEach(id => {
        const before = comments.length;
        comments = comments.filter(x => x.id !== id);
        if (comments.length !== before) commentsChanged = true;
      });

      // Удалённые рецензии/релизы уносят свои комментарии (каскад на сервере).
      const goneReviewIds = new Set(data.deletedReviewIds || []);
      const goneReleaseIds = new Set(data.deletedReleaseIds || []);
      if (goneReviewIds.size || goneReleaseIds.size) {
        const before = comments.length;
        comments = comments.filter(c => !goneReviewIds.has(c.reviewId) && !goneReleaseIds.has(c.relId));
        if (comments.length !== before) commentsChanged = true;
      }

      if (data.cursor != null && String(data.cursor) !== '0') syncCursor = String(data.cursor);

      if (commentsChanged) updateCommentsMap();

      if (changed) {
        updateReviewsMap();
        updateGenreCounts();
        updateGenreBadge();
        renderReleases();
        if (!document.getElementById('screen-likes').classList.contains('hidden')) renderLikes();
        if (!document.getElementById('screen-feed').classList.contains('hidden')) renderFeed();
      }
      if ((changed || commentsChanged) && activeReleaseId
          && !document.getElementById('modal-release').classList.contains('hidden')) {
        existingReviewForActiveRelease = getExistingReviewForRelease(activeReleaseId);
        reviewPublishBlocked = !!existingReviewForActiveRelease;
        renderReviews();
        updateReviewCharCount();
      }
    }

    async function syncLoopTick() {
      if (!syncLoopActive) return;
      syncAbortController = new AbortController();
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/sync/releases?since=${syncCursor}&waitMs=25000`,
          { headers: authHeaders(), signal: syncAbortController.signal }
        );
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        applySyncDelta(data);
        setSyncStatus('Всё актуально', 'ok');
        syncRetryDelay = SYNC_RETRY_BASE_MS; // успех — сбрасываем backoff
        if (syncLoopActive) {
          // Сервер сам держит long-poll до 25 с. Небольшой зазор — защита от
          // tight-loop, если сервер вдруг начнёт отвечать мгновенно.
          syncRetryTimer = setTimeout(syncLoopTick, 600);
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.error('Sync error:', e.message || e);
        setSyncStatus('Оффлайн (кэш)', 'warn');
        if (syncLoopActive) {
          // Экспоненциальный backoff: 5с → 10с → 20с → 30с (потолок).
          syncRetryTimer = setTimeout(syncLoopTick, syncRetryDelay);
          syncRetryDelay = Math.min(syncRetryDelay * 2, SYNC_RETRY_MAX_MS);
        }
      }
    }

    function startSyncLoop() {
      if (syncLoopActive) return;
      syncLoopActive = true;
      syncLoopTick();
    }

    function stopSyncLoop() {
      syncLoopActive = false;
      if (syncAbortController) syncAbortController.abort();
      if (syncRetryTimer) { clearTimeout(syncRetryTimer); syncRetryTimer = null; }
    }

    // Пауза при скрытой вкладке, возобновление с последнего курсора.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopSyncLoop();
      else startSyncLoop();
    });

    // --- PULL-TO-REFRESH ---
    (function setupPullToRefresh() {
      const main = document.querySelector('main');
      const indicator = document.getElementById('ptr-indicator');
      if (!main || !indicator) return;

      const THRESHOLD = 70;   // минимальное смещение для запуска обновления
      const MAX_PULL = 110;   // максимальное визуальное смещение индикатора
      let startY = 0, pull = 0, tracking = false, refreshing = false;

      function resetIndicator() {
        pull = 0;
        indicator.classList.remove('ptr-pulling', 'ptr-refreshing');
        indicator.style.transform = '';
        indicator.style.opacity = '';
      }

      function triggerRefresh() {
        refreshing = true;
        pull = 0;
        indicator.classList.remove('ptr-pulling');
        indicator.style.transform = '';
        indicator.style.opacity = '';
        indicator.classList.add('ptr-refreshing');
        tgHaptic('medium');
        Promise.resolve(fetchDB()).finally(() => {
          refreshing = false;
          resetIndicator();
        });
      }

      main.addEventListener('touchstart', (e) => {
        if (refreshing || main.scrollTop > 0) { tracking = false; return; }
        startY = e.touches[0].clientY;
        tracking = true;
        pull = 0;
      }, { passive: true });

      main.addEventListener('touchmove', (e) => {
        if (!tracking || refreshing) return;
        const delta = e.touches[0].clientY - startY;
        if (delta <= 0 || main.scrollTop > 0) {
          if (pull > 0) resetIndicator();
          tracking = false;
          return;
        }
        pull = Math.min(MAX_PULL, delta * 0.5); // демпфирование жеста
        indicator.classList.add('ptr-pulling');
        indicator.style.transform = `translate(-50%, ${pull - 44}px)`;
        indicator.style.opacity = String(Math.min(1, pull / THRESHOLD));
      }, { passive: true });

      main.addEventListener('touchend', () => {
        if (!tracking || refreshing) return;
        tracking = false;
        if (pull >= THRESHOLD) triggerRefresh();
        else resetIndicator();
      });

      // Прерванный системой жест (touchcancel) не должен оставлять флаг взведённым.
      main.addEventListener('touchcancel', () => {
        if (!tracking) return;
        tracking = false;
        if (!refreshing) resetIndicator();
      });
    })();

    async function fetchOEmbedData(link) {
        const embedRes = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(link)}`);
        const embedData = await embedRes.json();
        
        if (!embedData.error && embedData.title) {
            let title = embedData.title;
            let author = embedData.author_name || 'Артист';
            
            // Очищаем мусор из названия (Official Video, Audio и т.д.)
            title = title.replace(/(\(Official.*?\)|\[Official.*?\]|\(Lyric.*?\)|\[Lyric.*?\]|\(Audio\)|\[Audio\]|ft\..*?|feat\..*?)/gi, '').trim();
            
            let parsedArtist, parsedName;
            if (title.includes(' - ')) {
                const parts = title.split(' - ');
                parsedArtist = parts[0].trim();
                parsedName = parts.slice(1).join(' - ').trim();
            } else {
                parsedArtist = author.replace(/ - Topic/gi, '').trim();
                parsedName = title;
            }
            
            return { artist: parsedArtist, name: parsedName, cover: embedData.thumbnail_url || '' };
        }
        throw new Error('noembed failed');
    }

    async function fetchBackendParseData(link) {
        const res = await fetch(`${BACKEND_URL}/api/parse_link`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ link }) });
        if (!res.ok) throw new Error('Backend Fail');
        const data = await res.json();

        if (data.name && data.name !== 'Релиз' && data.name !== 'YouTube') {
            return { artist: data.artist, name: data.name, cover: data.img || '', genre: data.genre || null };
        }
        throw new Error('AI Parse Fail');
    }

    const itunesCache = new Map();
    async function fetchItunesData(artist, name) {
        const cacheKey = `${artist}|${name}`.toLowerCase();
        if (itunesCache.has(cacheKey)) {
            return itunesCache.get(cacheKey);
        }

        const fetchPromise = (async () => {
            try {
                const query = encodeURIComponent(`${artist} ${name}`).replace(/%20/g, '+');
                const itunesRes = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=1`);
                const itunesData = await itunesRes.json();

                if (itunesData.results && itunesData.results.length > 0) {
                    const track = itunesData.results[0];
                    return {
                        cover: track.artworkUrl100.replace('100x100bb', '600x600bb'),
                        artist: track.artistName,
                        name: track.trackName
                    };
                }
                return null;
            } catch (error) {
                // Remove from cache on failure so we can retry later
                itunesCache.delete(cacheKey);
                throw error;
            }
        })();

        itunesCache.set(cacheKey, fetchPromise);
        return fetchPromise;
    }

    // --- НОВАЯ УМНАЯ ЛОГИКА РАСПОЗНАВАНИЯ ---
    async function handleAddRelease() {
      const link = document.getElementById('input-link').value.trim();
      if (!link) return showToast('Введите ссылку');

      const btnText = document.getElementById('btn-add-text');
      btnText.innerText = 'Анализ ссылки...';

      let parsedArtist = 'Артист';
      let parsedName = 'Неизвестный релиз';
      let parsedCover = '';
      let isSuccess = false;

      try {
        // 1. СНАЧАЛА используем oEmbed (Идеально и безошибочно читает YouTube, Spotify и т.д.)
        const data = await fetchOEmbedData(link);
        parsedArtist = data.artist;
        parsedName = data.name;
        parsedCover = data.cover;
        isSuccess = true;
      } catch(e) {
        // 2. Если oEmbed не помог (редкие сайты) - используем ИИ бэкенд
        try {
            const data = await fetchBackendParseData(link);
            parsedArtist = data.artist;
            parsedName = data.name;
            parsedCover = data.cover;
            if (data.genre) selectedGenreForAdd = data.genre;
            isSuccess = true;
        } catch (err) {
            // 3. Если всё сломалось - ФОЛЛБЕК НА РУЧНОЙ ВВОД
            document.getElementById('add-form-step-1').classList.add('hidden');
            document.getElementById('add-form-step-manual').classList.remove('hidden');
            document.getElementById('manual-step-alert').innerText = 'Данные недоступны. Введите вручную:';
            document.getElementById('manual-step-alert').className = 'text-[12px] text-amber-400 bg-amber-400/10 p-3 rounded-xl mb-2 text-center';
            currentPendingLink = link;
            renderAddGenreSelector('manual-genre-selector');
            btnText.innerText = 'Распознать и добавить';
            return showToast('Не удалось считать. Введите вручную.');
        }
      }

      if (isSuccess) {
          // Пытаемся найти качественную квадратную обложку 1:1 в iTunes
          try {
              btnText.innerText = 'Поиск обложки...';
              const itunesData = await fetchItunesData(parsedArtist, parsedName);
              
              if (itunesData) {
                  parsedCover = itunesData.cover;
                  parsedArtist = itunesData.artist;
                  parsedName = itunesData.name;
              }
          } catch(e) {
              console.error("iTunes search error:", e);
          }
          
          // Показываем форму подтверждения с жанром (вместо прямого сохранения)
          currentPendingLink = link;
          document.getElementById('manual-artist').value = parsedArtist;
          document.getElementById('manual-title').value = parsedName;
          if (parsedCover) {
              manualCoverBase64 = parsedCover;
              document.getElementById('manual-cover-preview').innerHTML = `<img src="${escapeHtml(parsedCover)}" alt="Превью обложки" class="w-full h-full object-cover"><div class="media-edit-overlay absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"><i data-lucide="edit-2" class="w-6 h-6 text-white"></i></div>`;
          }
          renderAddGenreSelector('manual-genre-selector');
          
          document.getElementById('add-form-step-1').classList.add('hidden');
          document.getElementById('add-form-step-manual').classList.remove('hidden');
          document.getElementById('manual-step-alert').innerText = selectedGenreForAdd 
            ? `✓ Распознано! Жанр: ${selectedGenreForAdd}. Проверьте и сохраните.` 
            : '✓ Распознано! Выберите жанр и сохраните.';
          document.getElementById('manual-step-alert').className = 'text-[12px] text-green-400 bg-green-400/10 p-3 rounded-xl mb-2 text-center';
          btnText.innerText = 'Распознать и добавить';
          refreshIcons();
      }
    }

    function handleCoverUpload(event) {
      const file = event.target.files[0];
      if (!file) return;
      // Лимит размера: base64 крупнее оригинала, а сервер режет data:image > ~3 МБ.
      const MAX_COVER_BYTES = 2 * 1024 * 1024;
      if (file.size > MAX_COVER_BYTES) {
        event.target.value = '';
        return showToast('Файл слишком большой (максимум 2 МБ)', 'error');
      }
      const reader = new FileReader();
      reader.onload = function(e) {
          manualCoverBase64 = e.target.result;
          const previewZone = document.getElementById('manual-cover-preview');
          previewZone.innerHTML = `<img src="${escapeHtml(manualCoverBase64)}" alt="Превью обложки" class="w-full h-full object-cover"><div class="media-edit-overlay absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"><i data-lucide="edit-2" class="w-6 h-6 text-white"></i></div>`;
          refreshIcons();
      }
      reader.readAsDataURL(file);
    }

    async function saveManualRelease() {
      const artist = document.getElementById('manual-artist').value.trim(); const title = document.getElementById('manual-title').value.trim();
      if(!artist || !title) return showToast('Заполните оба поля');
      
      let cover = manualCoverBase64; 
      
      if (!cover) {
        showToast('Ищем обложку...');
        try {
          const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artist + ' ' + title)}&limit=1`);
          const itunesData = await itunesRes.json();
          cover = itunesData.results?.[0]?.artworkUrl100?.replace('100x100bb', '400x400bb') || '';
        } catch(e) {}
      }
      
      const newRel = { id: Date.now().toString(), name: title, artist: artist, img: cover, link: currentPendingLink, genre: selectedGenreForAdd, timestamp: Date.now() };
      
      // Отправка в БД Render (с обработкой ошибок)
      try {
        const saveRes = await fetch(`${BACKEND_URL}/api/releases`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(newRel) });
        if (!saveRes.ok) throw new Error('HTTP ' + saveRes.status);
      } catch(e) {
        console.error('Ошибка сохранения релиза:', e);
        showToast('Ошибка сохранения — попробуйте позже', 'error');
        return;
      }
      
      releases.unshift(newRel);
      releasesById.set(newRel.id, newRel);
      const g = newRel.genre || 'Другое';
      genreCounts[g] = (genreCounts[g] || 0) + 1;
      renderReleases(); closeModal('modal-add'); showToast('Релиз сохранен!', 'success');
      document.getElementById('manual-artist').value = ''; document.getElementById('manual-title').value = '';
    }

    function getFallbackImg(name) {
        const safeName = name && name !== 'Неизвестный релиз' ? name.substring(0, 2) : 'XX';
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(safeName)}&background=1c1c1e&color=fff&size=300`;
    }
    
    function applyLikeState(id, liked) {
      const safeId = escapeCssString(id);
      document.querySelectorAll(`button[data-like-id="${safeId}"]`).forEach(btn => {
        const icon = btn.querySelector('svg') || btn.querySelector('i');
        if (!icon) return;
        if (liked) {
          icon.classList.add('fill-red-500', 'text-red-500');
          icon.classList.remove('text-white');
        } else {
          icon.classList.remove('fill-red-500', 'text-red-500');
          icon.classList.add('text-white');
        }
      });
      if (!document.getElementById('screen-likes').classList.contains('hidden')) {
        renderLikes();
      }
    }

    function toggleLikeAPI(e, id) {
      e.stopPropagation();
      const isLiking = !likedSet.has(id);

      // Оптимистично обновляем UI
      if (isLiking) likedSet.add(id);
      else likedSet.delete(id);
      applyLikeState(id, isLiking);

      // Отправка в БД Render с откатом при ошибке
      fetch(`${BACKEND_URL}/api/likes`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ releaseId: id, isLike: isLiking })
      }).then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
      }).catch(err => {
        console.error('Like save error:', err);
        // Откат оптимистичного изменения
        if (isLiking) likedSet.delete(id);
        else likedSet.add(id);
        applyLikeState(id, !isLiking);
        showToast('Не удалось сохранить лайк');
      });
    }

    // id релизов, чьи карточки уже хоть раз отрисованы — чтобы анимация
    // появления (cardPop) не проигрывалась повторно на каждом ре-рендере.
    const seenReleaseIds = new Set();

    function renderReleaseCard(r, index) {
      const isLiked = likedSet.has(r.id);
      const fb = getFallbackImg(r.name);
      const firstPaint = !seenReleaseIds.has(r.id);
      seenReleaseIds.add(r.id);
      const enterCls = firstPaint ? 'card-enter ' : '';
      const enterStyle = firstPaint ? ` style="animation-delay: ${Math.min(index, 14) * 32}ms"` : '';
      const cachedAvg = avgRatingByRelId.get(r.id);
      const avgRating = cachedAvg ? cachedAvg.toFixed(1) : null;
      const ratingBadge = avgRating ? `<div class="rating-badge absolute top-2 left-2 bg-black/60 backdrop-blur-md text-white text-[11px] font-black px-2 py-0.5 rounded-lg flex items-center gap-1"><i data-lucide="star" class="w-3 h-3 text-amber-400 fill-amber-400"></i>${avgRating}</div>` : '';
      const isNew = lastSeenTs > 0 && (r.timestamp || 0) > lastSeenTs;
      const newBadge = isNew ? `<div class="absolute top-2 right-2 bg-red-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-md tracking-wider shadow-lg">NEW</div>` : '';
      return `<div data-act="open-release" data-id="${escapeHtml(r.id)}" tabindex="0" role="button" aria-label="Открыть релиз ${escapeHtml(r.name)} от ${escapeHtml(r.artist)}" class="${enterCls}flex flex-col gap-2 w-full min-w-0 active:scale-95 transition-transform relative outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-[1.5rem]"${enterStyle}>
          <div class="w-full aspect-square rounded-[1.5rem] overflow-hidden relative shadow-lg bg-[#1c1c1e] border border-white/[0.05]">
            <img src="${escapeHtml(r.img) || fb}" alt="Обложка релиза" data-fallback="${escapeHtml(fb)}" loading="lazy" decoding="async" class="w-full h-full object-cover">
            ${ratingBadge}
            ${newBadge}
          <button data-act="toggle-like" data-id="${escapeHtml(r.id)}" data-like-id="${escapeHtml(r.id)}" aria-label="Нравится" class="absolute bottom-2 right-2 p-2 bg-black/40 rounded-full backdrop-blur-md transition-transform btn-press">
              <i data-lucide="heart" class="w-4 h-4 ${isLiked?'fill-red-500 text-red-500':'text-white'}"></i>
            </button>
          </div>
          <div class="px-1"><div class="text-[13px] font-bold text-white truncate">${escapeHtml(r.name)}</div><div class="text-[11px] text-gray-500 truncate">${escapeHtml(r.artist)}</div></div>
        </div>`;
    }

    function renderReleases() {
      const grid = document.getElementById('releases-grid');
      const empty = document.getElementById('empty-state');
      const noResults = document.getElementById('no-filter-results');

      if (releases.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        noResults.classList.add('hidden');
      } else {
        empty.classList.add('hidden');
        const filtered = getFilteredReleases();
        if (filtered.length === 0) {
          grid.innerHTML = '';
          noResults.classList.remove('hidden');
        } else {
          noResults.classList.add('hidden');
          grid.innerHTML = filtered.map((r, i) => renderReleaseCard(r, i)).join('');
        }
        refreshIcons();
      }
    }

    const LIKES_EMPTY_HTML = `<div class="col-span-2 flex flex-col items-center justify-center py-20 text-center">
        <i data-lucide="heart" class="w-12 h-12 text-gray-500 mb-4" stroke-width="1"></i>
        <p class="text-gray-400 text-[14px] mb-4">Здесь появятся релизы, которые вам понравились</p>
        <button data-act="switch-tab" data-tab="home" class="btn-press px-5 py-2.5 bg-red-600 text-white text-[12px] font-bold rounded-full">К каталогу</button>
      </div>`;

    function renderLikes() {
      const grid = document.getElementById('likes-grid'); const likedArr = releases.filter(r => likedSet.has(r.id));
      grid.innerHTML = likedArr.length ? likedArr.map((r, i) => renderReleaseCard(r, i)).join('') : LIKES_EMPTY_HTML;
      refreshIcons();
    }

    // Лента активности: последние релизы и рецензии, отсортированные по времени.
    function renderFeed() {
      const container = document.getElementById('feed-list');
      if (!container) return;
      const items = [];
      releases.forEach(r => items.push({ type: 'release', ts: r.timestamp || 0, rel: r }));
      reviews.forEach(rv => items.push({ type: 'review', ts: rv.timestamp || 0, rv }));
      items.sort((a, b) => b.ts - a.ts);
      const top = items.slice(0, 40);

      if (!top.length) {
        container.innerHTML = `<div class="text-center py-20 opacity-50 text-sm text-gray-400">Лента пока пуста</div>`;
        return;
      }

      container.innerHTML = top.map(it => {
        if (it.type === 'release') {
          const r = it.rel;
          const fb = getFallbackImg(r.name);
          return `<div data-act="open-release" data-id="${escapeHtml(r.id)}" role="button" tabindex="0" class="bg-white/5 border border-white/5 rounded-2xl p-3 flex items-center gap-3 cursor-pointer hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-red-500">
            <img src="${escapeHtml(r.img) || fb}" data-fallback="${escapeHtml(fb)}" alt="" loading="lazy" decoding="async" class="w-12 h-12 rounded-xl object-cover shrink-0">
            <div class="min-w-0 flex-1">
              <div class="text-[10px] font-bold text-red-500 uppercase tracking-wider flex items-center gap-1"><i data-lucide="disc-3" class="w-3 h-3"></i>Новый релиз</div>
              <div class="text-[13px] font-bold text-white truncate">${escapeHtml(r.name)}</div>
              <div class="text-[11px] text-gray-500 truncate">${escapeHtml(r.artist)}</div>
            </div>
          </div>`;
        }
        const rv = it.rv;
        const rel = releasesById.get(rv.relId);
        const relName = rel ? escapeHtml(rel.name) : 'Удалённый релиз';
        const rating = typeof rv.rating === 'number' ? rv.rating : Number(rv.rating) || 0;
        return `<div data-act="open-release" data-id="${escapeHtml(rv.relId)}" role="button" tabindex="0" class="bg-white/5 border border-white/5 rounded-2xl p-3 cursor-pointer hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-red-500">
            <div class="flex items-center justify-between gap-2 mb-1">
              <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1 min-w-0"><i data-lucide="message-square" class="w-3 h-3 shrink-0"></i><span class="truncate">${escapeHtml(rv.author)} · ${relName}</span></div>
              <div class="text-white bg-red-600 px-2 py-0.5 rounded-lg font-black text-[10px] shrink-0">${escapeHtml(rating)}</div>
            </div>
            <p class="text-[12px] text-gray-300 leading-relaxed line-clamp-2">${escapeHtml(rv.text)}</p>
          </div>`;
      }).join('');
      refreshIcons();
    }

    function openRelease(id) {
      const rel = releasesById.get(id); if (!rel) return; activeReleaseId = id;
      const fb = getFallbackImg(rel.name);
      document.getElementById('rel-img').src = rel.img || fb;
      document.getElementById('rel-img').onerror = function() { this.src = fb; };

      document.getElementById('rel-title').textContent = rel.name;
      document.getElementById('rel-artist').textContent = rel.artist;
      document.getElementById('rel-play-btn').onclick = () => openSafeUrl(rel.link);

      existingReviewForActiveRelease = getExistingReviewForRelease(id);
      reviewPublishBlocked = !!existingReviewForActiveRelease;

      const delBtn = document.getElementById('rel-delete-btn');
      if (user.isAdmin) {
        delBtn.classList.remove('hidden');
        delBtn.classList.add('flex');
        delBtn.onclick = () => openConfirmDelete(id);
      } else {
        delBtn.classList.add('hidden');
        delBtn.classList.remove('flex');
      }

      resetReviewInputs(); renderReviews(); openModal('modal-release');
    }

    function openConfirmDelete(id) {
      releaseToDelete = id;
      openModal('modal-confirm-delete');
    }

    function getExistingReviewForRelease(releaseId) {
      const relReviews = reviewsByRelId.get(releaseId);
      if (!relReviews) return null;
      return relReviews.find(r => reviewByUser(r, user.userId, user.username)) || null;
    }

    function openConfirmReviewDelete(reviewId, releaseId) {
      pendingReviewDelete = reviewId;
      pendingReviewTargetReleaseId = releaseId;
      reviewDeleteMode = true;
      openModal('modal-confirm-review-delete');
    }

    async function executeDeleteReview() {
      if (!pendingReviewDelete) return;

      try {
        const res = await fetch(`${BACKEND_URL}/api/reviews/${pendingReviewDelete}`, { method: 'DELETE', headers: authHeaders() });
        if (!res.ok) throw new Error('HTTP ' + res.status);
      } catch(e) {
        console.error('Ошибка удаления рецензии:', e);
        showToast('Ошибка удаления — попробуйте позже', 'error');
        return;
      }

      reviews = reviews.filter(r => r.id !== pendingReviewDelete);
      updateReviewsMap();
      // Комментарии удалённой рецензии каскадно удаляются и на сервере.
      comments = comments.filter(c => c.reviewId !== pendingReviewDelete);
      updateCommentsMap();
      if (activeReleaseId && pendingReviewTargetReleaseId === activeReleaseId) {
        renderReviews();
      }
      if (document.getElementById('modal-profile') && !document.getElementById('modal-profile').classList.contains('hidden')) {
        openProfileModal(activeProfile);
      }
      if (!document.getElementById('screen-likes').classList.contains('hidden')) renderLikes();

      closeModal('modal-confirm-review-delete');
      showToast('Рецензия удалена!', 'success');
      pendingReviewDelete = null;
      pendingReviewTargetReleaseId = null;
      reviewDeleteMode = false;
      reviewPublishBlocked = false;
      existingReviewForActiveRelease = null;
      updateReviewCharCount();
    }

    async function executeDeleteRelease() {
      if (!releaseToDelete) return;
      
      try {
        const res = await fetch(`${BACKEND_URL}/api/releases/${releaseToDelete}`, { method: 'DELETE', headers: authHeaders() });
        if (!res.ok) throw new Error('HTTP ' + res.status);
      } catch(e) {
        console.error('Ошибка удаления релиза:', e);
        showToast('Ошибка удаления — попробуйте позже', 'error');
        return;
      }
      
      const relToDeleteObj = releasesById.get(releaseToDelete);
      if (relToDeleteObj) {
        const g = relToDeleteObj.genre || 'Другое';
        if (genreCounts[g]) {
          genreCounts[g]--;
          if (genreCounts[g] === 0) delete genreCounts[g];
        }
      }

      releases = releases.filter(r => r.id !== releaseToDelete);
      releasesById.delete(releaseToDelete);
      if (likedSet.has(releaseToDelete)) likedSet.delete(releaseToDelete);
      reviews = reviews.filter(r => r.relId !== releaseToDelete);

      reviewsByRelId.delete(releaseToDelete);
      avgRatingByRelId.delete(releaseToDelete);
      // Комментарии релиза каскадно удаляются и на сервере.
      comments = comments.filter(c => c.relId !== releaseToDelete);
      updateCommentsMap();
      
      renderReleases();
      if (!document.getElementById('screen-likes').classList.contains('hidden')) renderLikes();
      
      closeModal('modal-confirm-delete');
      closeModal('modal-release');
      showToast('Удалено!', 'success');
      releaseToDelete = null;
    }

    async function addReview() {
      if (user.isBlocked) return showToast('Ваш аккаунт заблокирован');
      if (!user.isAuthenticated) return showToast('Войдите через Telegram');
      if (reviewPublishBlocked) return showToast('На этот трек уже есть ваша рецензия');
      const t = document.getElementById('rev-text').value.trim();
      if (!t) return showToast('Напишите текст');
      if (t.length < REVIEW_MIN_LENGTH) return showToast(`Минимум ${REVIEW_MIN_LENGTH} символов`);
      if (t.length > REVIEW_MAX_LENGTH) return showToast(`Максимум ${REVIEW_MAX_LENGTH} символов`);
      if (reviews.some(r => r.relId === activeReleaseId && reviewByUser(r, user.userId, user.username))) return showToast('На этот трек уже есть ваша рецензия');

      const objectiveRating = getCriteriaAverage(selectedCriteria);
      const finalRating = Math.round((objectiveRating + selectedRating) / 2 * 10) / 10;
      const newRev = {
        id: Date.now().toString(),
        relId: activeReleaseId,
        author: user.username,
        authorId: user.userId,
        authorUsername: cleanUsername(user.username),
        authorIsAdmin: user.isAdmin,
        reactionCount: 0,
        text: t,
        rating: finalRating,
        baseRating: selectedRating,
        criteria: { ...selectedCriteria },
        objectiveRating,
        date: new Date().toLocaleDateString('ru-RU'),
        timestamp: Date.now()
      };

      try {
        const res = await fetch(`${BACKEND_URL}/api/reviews`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(newRev) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
      } catch(e) {
        console.error('Ошибка сохранения рецензии:', e);
        showToast('Ошибка сохранения — попробуйте позже', 'error');
        return;
      }

      reviews.unshift(newRev);
      if (!reviewsByRelId.has(activeReleaseId)) reviewsByRelId.set(activeReleaseId, []);
      reviewsByRelId.get(activeReleaseId).push(newRev);
      const rvs = reviewsByRelId.get(activeReleaseId);
      const avg = rvs.length > 0 ? rvs.reduce((s, r) => s + (r.rating || 0), 0) / rvs.length : 0;
      avgRatingByRelId.set(activeReleaseId, avg);

      existingReviewForActiveRelease = newRev;
      reviewPublishBlocked = true;
      document.getElementById('rev-text').value = '';
      renderReviews();
      updateReviewCharCount();
      showToast('Опубликовано!', 'success');
      celebrate();
    }

    // Небольшой залп конфетти — отклик на успешную публикацию рецензии.
    function celebrate() {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const colors = ['#ff0000', '#ffffff', '#fbbf24', '#fb7185'];
      const count = 26;
      for (let i = 0; i < count; i++) {
        const piece = document.createElement('span');
        piece.className = 'confetti-piece';
        piece.style.background = colors[i % colors.length];
        document.body.appendChild(piece);
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
        const dist = 130 + Math.random() * 170;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist + 90;
        const rot = Math.random() * 720 - 360;
        const anim = piece.animate([
          { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot}deg)`, opacity: 0 }
        ], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(0.18, 0.9, 0.22, 1)' });
        anim.onfinish = () => piece.remove();
      }
    }

    // Реакция «полезно» на рецензию — оптимистичный toggle с откатом при ошибке.
    async function toggleReviewReaction(reviewId) {
      if (!user.isAuthenticated) return showToast('Войдите через Telegram');
      if (user.isBlocked) return showToast('Ваш аккаунт заблокирован');
      const review = reviews.find(r => r.id === reviewId);
      if (!review) return;

      const reacted = !reactedSet.has(reviewId);
      const apply = (on) => {
        if (on) { reactedSet.add(reviewId); review.reactionCount = (review.reactionCount || 0) + 1; }
        else { reactedSet.delete(reviewId); review.reactionCount = Math.max(0, (review.reactionCount || 0) - 1); }
      };
      apply(reacted);
      renderReviews();

      try {
        const res = await fetch(`${BACKEND_URL}/api/reviews/${encodeURIComponent(reviewId)}/react`, {
          method: 'POST', headers: authHeaders(), body: JSON.stringify({ reacted })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (typeof data.reactionCount === 'number') {
          review.reactionCount = data.reactionCount;
          renderReviews();
        }
      } catch (e) {
        console.error('Reaction error:', e);
        apply(!reacted); // откат
        renderReviews();
        showToast('Не удалось сохранить реакцию', 'error');
      }
    }

    // --- КОММЕНТАРИИ К РЕЦЕНЗИЯМ ---
    function renderCommentItem(c) {
      const canDel = reviewByUser(c, user.userId, user.username) || user.isAdmin;
      const adminTag = c.authorIsAdmin
        ? '<span class="text-[9px] text-red-400 font-bold uppercase ml-1">Создатель</span>' : '';
      return `<div class="bg-black/20 rounded-xl p-3 border border-white/5">
        <div class="flex justify-between items-center gap-2 mb-1">
          <button data-act="open-profile" data-user="${escapeHtml(c.author)}" data-author-id="${escapeHtml(c.authorId == null ? '' : c.authorId)}" data-username="${escapeHtml(c.authorUsername || '')}" class="text-[12px] font-bold text-white hover:text-red-500 transition-colors text-left outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-sm">${escapeHtml(c.author)}${adminTag}</button>
          ${canDel ? `<button data-act="delete-comment" data-id="${escapeHtml(c.id)}" data-review="${escapeHtml(c.reviewId)}" aria-label="Удалить комментарий" class="btn-press w-6 h-6 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center shrink-0"><i data-lucide="trash-2" class="w-3 h-3"></i></button>` : ''}
        </div>
        <p class="text-[12px] text-gray-300 leading-relaxed break-words">${escapeHtml(c.text)}</p>
        <span class="text-[9px] text-gray-500 font-medium">${escapeHtml(c.date || '')}</span>
      </div>`;
    }

    function renderCommentsSection(reviewId) {
      const list = commentsByReviewId.get(reviewId) || [];
      const count = list.length;
      const expanded = expandedComments.has(reviewId);
      const toggle = `<button data-act="toggle-comments" data-id="${escapeHtml(reviewId)}" class="btn-press flex items-center gap-1.5 text-[11px] font-bold text-gray-400 hover:text-white transition-colors mt-2">
          <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
          <span>Комментарии${count ? ` (${count})` : ''}</span>
          <i data-lucide="${expanded ? 'chevron-up' : 'chevron-down'}" class="w-3 h-3"></i>
        </button>`;
      if (!expanded) return toggle;

      const items = list.map(renderCommentItem).join('')
        || `<div class="text-[11px] text-gray-500 text-center py-2">Комментариев пока нет</div>`;
      const draft = commentDrafts.get(reviewId) || '';
      const inputBox = user.isAuthenticated ? `<div class="flex items-end gap-2 mt-1">
          <textarea data-act-input="comment-draft" data-id="${escapeHtml(reviewId)}" rows="1" maxlength="${COMMENT_MAX_LENGTH}" aria-label="Текст комментария" placeholder="Ваш комментарий..." class="flex-1 bg-black/20 border border-white/5 rounded-xl outline-none p-2.5 text-[12px] text-white resize-none transition-all focus:border-red-500/30">${escapeHtml(draft)}</textarea>
          <button data-act="submit-comment" data-id="${escapeHtml(reviewId)}" class="btn-press shrink-0 px-3 py-2.5 bg-white/10 border border-white/10 text-white text-[12px] font-bold rounded-xl">Отправить</button>
        </div>` : '';
      return `${toggle}<div class="comments-reveal mt-2 space-y-2">${items}${inputBox}</div>`;
    }

    function toggleComments(reviewId) {
      if (expandedComments.has(reviewId)) expandedComments.delete(reviewId);
      else expandedComments.add(reviewId);
      renderReviews();
    }

    // Добавление комментария — оптимистично, с откатом при ошибке.
    async function submitComment(reviewId) {
      if (!user.isAuthenticated) return showToast('Войдите через Telegram');
      if (user.isBlocked) return showToast('Ваш аккаунт заблокирован');
      const text = (commentDrafts.get(reviewId) || '').trim();
      if (!text) return showToast('Напишите комментарий');
      if (text.length > COMMENT_MAX_LENGTH) return showToast(`Максимум ${COMMENT_MAX_LENGTH} символов`);

      const newComment = {
        id: Date.now().toString(),
        reviewId: reviewId,
        relId: activeReleaseId,
        text: text,
        author: user.username,
        authorId: user.userId,
        authorUsername: cleanUsername(user.username),
        authorIsAdmin: user.isAdmin,
        date: new Date().toLocaleDateString('ru-RU'),
        timestamp: Date.now()
      };

      comments.push(newComment);
      commentDrafts.delete(reviewId);
      expandedComments.add(reviewId);
      updateCommentsMap();
      renderReviews();

      try {
        const res = await fetch(`${BACKEND_URL}/api/reviews/${encodeURIComponent(reviewId)}/comments`, {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ id: newComment.id, text: text })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showToast('Комментарий добавлен', 'success');
      } catch (e) {
        console.error('Comment add error:', e);
        comments = comments.filter(c => c.id !== newComment.id); // откат
        commentDrafts.set(reviewId, text);
        updateCommentsMap();
        renderReviews();
        showToast('Не удалось отправить комментарий', 'error');
      }
    }

    // Удаление комментария — оптимистично, с откатом при ошибке.
    async function deleteComment(commentId, reviewId) {
      if (!confirm('Удалить комментарий?')) return;
      const removed = comments.find(c => c.id === commentId);
      if (!removed) return;
      comments = comments.filter(c => c.id !== commentId);
      updateCommentsMap();
      renderReviews();
      try {
        const res = await fetch(`${BACKEND_URL}/api/comments/${encodeURIComponent(commentId)}`, {
          method: 'DELETE', headers: authHeaders()
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showToast('Комментарий удалён', 'success');
      } catch (e) {
        console.error('Comment delete error:', e);
        comments.push(removed); // откат
        updateCommentsMap();
        renderReviews();
        showToast('Не удалось удалить комментарий', 'error');
      }
    }

    function renderReviews() {
      const container = document.getElementById('reviews-container'); const relReviews = reviewsByRelId.get(activeReleaseId) || [];
      activeReleaseReviews = relReviews;
      container.innerHTML = relReviews.map((r, i) => {
        const objective = typeof r.objectiveRating === 'number' ? r.objectiveRating : r.rating;
        const rating = typeof r.rating === 'number' ? r.rating : Number(r.rating) || 0;
        const criteria = r.criteria ? ` · ${escapeHtml(formatCriteria(r.criteria))}` : '';
        const canDelete = reviewByUser(r, user.userId, user.username) || user.isAdmin;
        const reacted = reactedSet.has(r.id);
        const reactionCount = typeof r.reactionCount === 'number' ? r.reactionCount : 0;
        const reactBtn = `<button data-act="toggle-reaction" data-id="${escapeHtml(r.id)}" aria-label="Полезная рецензия" class="btn-press shrink-0 flex items-center gap-1 px-2 py-1 rounded-full transition-colors ${reacted ? 'bg-red-500/15 border border-red-500/25 text-red-400' : 'bg-white/5 border border-white/10 text-gray-400'}"><i data-lucide="thumbs-up" class="w-3 h-3"></i><span class="text-[10px] font-bold">${reactionCount}</span></button>`;
        return `<div class="bg-white/5 rounded-2xl p-4 border border-white/5 fade-in" style="animation-delay: ${Math.min(i, 12) * 36}ms">
          <div class="flex justify-between items-center mb-2 gap-2"><button class="text-[13px] font-bold text-white cursor-pointer hover:text-red-500 transition-colors text-left outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-sm" data-act="open-profile" data-user="${escapeHtml(r.author)}" data-author-id="${escapeHtml(r.authorId == null ? '' : r.authorId)}" data-username="${escapeHtml(r.authorUsername || '')}">${escapeHtml(r.author)}</button><div class="flex items-center gap-2"><div class="text-white bg-red-600 px-2.5 py-0.5 rounded-lg font-black text-[11px]">${escapeHtml(rating)}</div>${canDelete ? `<button data-act="open-confirm-review-delete" data-id="${escapeHtml(r.id)}" data-rel="${escapeHtml(r.relId)}" aria-label="Удалить отзыв" class="btn-press w-7 h-7 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center"><i data-lucide=\"trash-2\" class=\"w-3.5 h-3.5\"></i></button>` : ''}</div></div>
          <p class="text-[13px] text-gray-300 leading-relaxed mb-2">${escapeHtml(r.text)}</p>
          <div class="flex items-center justify-between gap-2"><span class="text-[10px] text-gray-500 font-medium">${escapeHtml(r.date)}${criteria} · объективно ${escapeHtml(objective)}</span>${reactBtn}</div>
          ${renderCommentsSection(r.id)}</div>`;
      }).join('') || `<div class="text-center py-4 text-[12px] text-gray-500">Отзывов пока нет</div>`;
      renderCriteriaChart(activeReleaseId);
      refreshIcons();
    }

    // Множественное число для слова «рецензия» по правилам русского языка.
    function pluralReviews(n) {
      const mod10 = n % 10, mod100 = n % 100;
      if (mod10 === 1 && mod100 !== 11) return 'рецензия';
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'рецензии';
      return 'рецензий';
    }

    // График средних оценок по 6 критериям для активного релиза.
    function renderCriteriaChart(relId) {
      const container = document.getElementById('criteria-chart');
      if (!container) return;
      const relReviews = reviewsByRelId.get(relId) || [];
      if (!relReviews.length) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
      }

      const sums = {};
      criteriaConfig.forEach(({ key }) => { sums[key] = 0; });
      relReviews.forEach(rv => {
        const c = rv.criteria || {};
        criteriaConfig.forEach(({ key }) => {
          sums[key] += typeof c[key] === 'number' ? c[key] : 5;
        });
      });

      const overall = avgRatingByRelId.get(relId) || 0;
      const bars = criteriaConfig.map(({ key, label }) => {
        const avg = sums[key] / relReviews.length;
        const pct = Math.max(0, Math.min(100, avg * 10));
        return `<div class="flex items-center gap-2">
          <span class="text-[10px] text-gray-400 w-24 shrink-0 truncate" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
          <div class="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
            <div class="h-full rounded-full bg-red-500" style="width: ${pct}%"></div>
          </div>
          <span class="text-[11px] font-bold text-white w-7 text-right">${avg.toFixed(1)}</span>
        </div>`;
      }).join('');

      container.innerHTML = `
        <h3 class="text-lg font-bold text-white mb-4">Оценки по критериям</h3>
        <div class="bg-white/5 border border-white/10 rounded-[1.5rem] p-5 space-y-3">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[12px] text-gray-400">Средний рейтинг</span>
            <span class="text-white bg-red-600 px-2.5 py-0.5 rounded-lg font-black text-[12px]">${overall.toFixed(1)}</span>
          </div>
          ${bars}
          <p class="text-[10px] text-gray-500 pt-1">По ${relReviews.length} ${pluralReviews(relReviews.length)}</p>
        </div>`;
      container.classList.remove('hidden');
    }

    function renderUserReviews(userReviews, isMe) {
      const revContainer = document.getElementById('profile-user-reviews');
      if (userReviews.length > 0) {
        revContainer.innerHTML = userReviews.map(r => {
          const rel = releasesById.get(r.relId);
          const relName = rel ? escapeHtml(rel.name) : 'Удаленный релиз';
          const canDelete = isMe || user.isAdmin;
          const rating = typeof r.rating === 'number' ? r.rating : Number(r.rating) || 0;
          return `<div class="bg-white/5 rounded-2xl p-4 border border-white/5 text-left cursor-pointer hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-red-500" data-act="open-release" data-id="${escapeHtml(r.relId)}" tabindex="0" role="button" aria-label="Открыть релиз: ${relName}">
            <div class="flex justify-between items-center mb-2 gap-2">
              <span class="text-[13px] font-bold text-gray-300 truncate pr-2">${relName}</span>
              <div class="flex items-center gap-2 shrink-0">
                <div class="text-white bg-red-600 px-2 py-0.5 rounded-lg font-black text-[10px]">${escapeHtml(rating)}</div>
                ${canDelete ? `<button data-act="open-confirm-review-delete" data-id="${escapeHtml(r.id)}" data-rel="${escapeHtml(r.relId)}" aria-label="Удалить отзыв" class="btn-press w-7 h-7 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center"><i data-lucide=\"trash-2\" class=\"w-3.5 h-3.5\"></i></button>` : ''}
              </div>
            </div>
            <p class="text-[13px] text-gray-200 leading-relaxed mb-2">${escapeHtml(r.text)}</p>
            <span class="text-[10px] text-gray-500 font-medium">${escapeHtml(r.date)}</span>
          </div>`;
        }).join('');
      } else {
        revContainer.innerHTML = `<div class="text-center py-6 text-[13px] text-gray-500">${isMe ? 'Вы еще не написали' : 'Пользователь еще не написал'} ни одной рецензии</div>`;
      }
    }

    function changeTheme(hex, btnRef, persist = true) {
      document.documentElement.style.setProperty('--bg-color', hex);

      const isLight = hex === '#f2f2f7';
      if(isLight) document.body.classList.add('light-theme');
      else document.body.classList.remove('light-theme');

      // Сохраняем выбор темы (persist=false — авто-тема Telegram, не считается ручным выбором)
      if (persist) {
        localStorage.setItem('xxii_theme', hex);
        try { tg.CloudStorage?.setItem?.('xxii_theme', hex); } catch (_) {}
      }

      document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.remove('border-white', 'border-black', 'scale-110');
        btn.classList.add('border-white/10');
        btn.innerHTML = ''; 
      }); 

      btnRef.classList.remove('border-white/10');
      btnRef.classList.add('scale-110');
      btnRef.classList.add(isLight ? 'border-black' : 'border-white');
      
      btnRef.innerHTML = `<i data-lucide="check" class="w-6 h-6 ${isLight ? 'text-black' : 'text-white'}"></i>`;
      refreshIcons();
    }

    refreshIcons();
    selectRating(10);
    resetReviewInputs();
    setSortMode('new');

    function applyTheme(hex, persist = false) {
      const btns = document.querySelectorAll('.theme-btn');
      const target = hex === '#f2f2f7' ? btns[1] : btns[0];
      if (target) changeTheme(hex, target, persist);
    }

    // Восстановление темы: ручной выбор → Telegram → CloudStorage (между устройствами)
    (function restoreTheme() {
      const saved = localStorage.getItem('xxii_theme');
      if (saved === '#000000' || saved === '#f2f2f7') {
        applyTheme(saved, false);
      } else {
        applyTheme(tg.colorScheme === 'light' ? '#f2f2f7' : '#000000', false);
      }

      try {
        tg.CloudStorage?.getItem?.('xxii_theme', (err, value) => {
          if (!err && (value === '#000000' || value === '#f2f2f7')) {
            localStorage.setItem('xxii_theme', value);
            applyTheme(value, false);
          }
        });
      } catch (_) {}

      // Пока пользователь не выбрал тему вручную — следуем теме клиента Telegram.
      try {
        tg.onEvent?.('themeChanged', () => {
          if (!localStorage.getItem('xxii_theme')) {
            applyTheme(tg.colorScheme === 'light' ? '#f2f2f7' : '#000000', false);
          }
        });
      } catch (_) {}
    })();

    // Скелетон-заглушки на экране загрузки, пока не пришли данные.
    function renderSkeletonGrid() {
      const grid = document.getElementById('skeleton-grid');
      if (!grid || grid.children.length) return;
      let html = '';
      for (let i = 0; i < 6; i++) {
        html += `<div class="flex flex-col gap-2">
          <div class="w-full aspect-square skeleton-card"></div>
          <div class="px-1 space-y-1.5">
            <div class="skeleton-card" style="height:12px;width:75%;border-radius:5px"></div>
            <div class="skeleton-card" style="height:10px;width:50%;border-radius:5px"></div>
          </div>
        </div>`;
      }
      grid.innerHTML = html;
    }
    renderSkeletonGrid();

    // Запуск синхронизации с БД Render + real-time long-poll
    fetchDB().finally(() => { if (!document.hidden) startSyncLoop(); });
