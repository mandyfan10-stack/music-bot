(function() {
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

    const SUPABASE_URL = "https://ftpofwybzvhvyukrshcm.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0cG9md3lienZodnl1a3JzaGNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5OTQ3NzEsImV4cCI6MjA5OTU3MDc3MX0.Ha6pDI9U8D_Dg6gQgggJ7UXduXHHlcHcK1Imi3dcwok";
    const SUPABASE_AUTH_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/auth`;
    const SUPABASE_RELEASE_COVER_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/release-cover`;
    const SUPABASE_PARSE_LINK_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/parse-link`;
    const SUPABASE_SHARE_MESSAGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/share-message`;

    let supabaseAccessToken = '';
    function getSupabaseAccessToken() {
      return supabaseAccessToken;
    }
    function getApiBearerToken() {
      return getSupabaseAccessToken() || SUPABASE_ANON_KEY;
    }

    let supabase = null;
    try {
      if (typeof window.supabase !== 'undefined') {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          // Telegram auth issues an application JWT for the Data API. Passing
          // it through Supabase Auth's setSession() makes GoTrue look up a
          // non-existent auth.users row and adds slow /auth/v1/user failures.
          accessToken: async () => getApiBearerToken()
        });
      }
    } catch (err) {
      console.error("Failed to initialize Supabase client:", err);
    }

    // Динамические геттеры Telegram WebApp данных
    function getTgInitData() {
      return tg.initData || window.Telegram?.WebApp?.initData || '';
    }
    function getTgUser() {
      return tg.initDataUnsafe?.user || window.Telegram?.WebApp?.initDataUnsafe?.user;
    }

    // Telegram user используется только для раннего отображения имени.
    const tgUser = getTgUser();

    // Локальный сервер используется только для статических файлов и парсера.
    // Администраторские права, в том числе локально, выдаёт только Supabase.
    const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    // Базовый display name (до ответа сервера)
    let localDisplayName = (tgUser?.username ? `@${tgUser.username}` : tgUser?.first_name) || 'Гость';
    let initialUserId = (tgUser && tgUser.id) || null;

    // Роль определяется только сервером.
    let user = {
      userId: initialUserId,
      username: localDisplayName,
      role: 'Пользователь',
      isAdmin: false,
      isBlocked: false,
      isAuthenticated: false,
      notificationsEnabled: true
    };
    let blockedUsers = [], blockedUserIds = new Set();
    let blockNoticeShown = false;

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
      'delete-all-reviews': () => requestDeleteAllReviewsByUser(),
      'open-release': (el) => openRelease(el.dataset.id, el),
      'toggle-like': (el, e) => toggleLikeAPI(e, el.dataset.id),
      'toggle-reaction': (el) => toggleReviewReaction(el.dataset.id),
      'open-confirm-review-delete': (el) => openConfirmReviewDelete(el.dataset.id, el.dataset.rel),
      'toggle-comments': (el) => toggleComments(el.dataset.id),
      'submit-comment': (el) => submitComment(el.dataset.id),
      'delete-comment': (el) => requestDeleteComment(el.dataset.id, el.dataset.review),
      'execute-confirm-action': () => executeConfirmAction(),
      'set-criterion': (el) => setCriterion(el.dataset.key, Number(el.dataset.delta)),
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
    // Enter/Space на внутренней кнопке (лайк, удаление) не должны открывать релиз.
    document.addEventListener('keydown', (event) => {
      if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('button, a, input, textarea, [data-act]:not([data-act="open-release"])')) return;
      const el = target.closest('[data-act="open-release"]');
      if (!el) return;
      event.preventDefault();
      openRelease(el.dataset.id, el);
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

    const WELCOME_KEY = 'xxii_welcomed_v1';
    if (localStorage.getItem(WELCOME_KEY) || localStorage.getItem('raper_welcomed_v1')) {
        document.getElementById('welcome-screen').classList.add('hidden');
        try {
          localStorage.setItem(WELCOME_KEY, 'true');
          localStorage.removeItem('raper_welcomed_v1');
        } catch (_) {}
    }

    function closeWelcomeScreen() {
        const ws = document.getElementById('welcome-screen');
        ws.classList.add('opacity-0');
        setTimeout(() => {
            ws.classList.add('hidden');
            try {
              localStorage.setItem(WELCOME_KEY, 'true');
              localStorage.removeItem('raper_welcomed_v1');
            } catch (_) {}
        }, 700);
    }

    function syncUserWithTelegram() {
      const currentTgUser = getTgUser();
      if (currentTgUser && (!user.isAuthenticated || !user.userId)) {
        user.userId = currentTgUser.id;
        user.username = currentTgUser.username ? `@${currentTgUser.username}` : (currentTgUser.first_name || 'Гость');
      }
    }

    // Обновление UI после получения роли с сервера
    function applyUserRole() {
      syncUserWithTelegram();
      const userNameEl = document.getElementById('user-name');
      if (userNameEl) userNameEl.innerText = user.username;
      const welcomeNameEl = document.getElementById('welcome-user-name');
      if (welcomeNameEl) welcomeNameEl.innerText = user.username;
      const headerRoleEl = document.getElementById('user-role');
      if (headerRoleEl) {
        headerRoleEl.innerText = user.isAdmin ? 'Создатель' : 'Пользователь';
        if (user.isAdmin) {
          headerRoleEl.classList.remove('text-gray-500');
          headerRoleEl.classList.add('text-red-500', 'font-bold');
          document.getElementById('btn-add-release')?.classList.remove('hidden');
        } else {
          headerRoleEl.classList.add('text-gray-500');
          headerRoleEl.classList.remove('text-red-500', 'font-bold');
          document.getElementById('btn-add-release')?.classList.add('hidden');
        }
      }
    }

    applyUserRole();

    function notifyIfBlocked() {
      if (user.isBlocked && !blockNoticeShown) {
        blockNoticeShown = true;
        showToast('Ваш аккаунт заблокирован. Только чтение.');
      }
      if (!user.isBlocked) blockNoticeShown = false;
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
        const { error } = await supabase.rpc('set_notification_enabled', {
          p_enabled: next
        });
        if (error) throw error;
        showToast(next ? 'Уведомления включены' : 'Уведомления выключены', 'success');
      } catch (e) {
        console.error('Notifications toggle error:', e);
        user.notificationsEnabled = !next; // откат
        applyNotificationsToggle();
        showToast('Не удалось сохранить настройку', 'error');
      }
    }

    document.getElementById('user-name').innerText = user.username;

    let releases = [], likedSet = new Set(), releasesById = new Map(), reviews = [], reviewsByRelId = new Map(), avgRatingByRelId = new Map(), genreCounts = {}, activeReleaseId = null, selectedCriteria = { sound: 5, production: 5, originality: 5, meaning: 5, relevance: 5, image: 5 };
    let reactedSet = new Set(); // id рецензий, на которые текущий пользователь отреагировал
    const pendingLikeIds = new Set();
    const pendingReactionIds = new Set();
    // Последнее локальное намерение перекрывает поздний Realtime и догоняющий
    // fetchDB: иначе DELETE 204 + запоздалый INSERT/снимок возвращают лайк.
    const LIKE_INTENT_MS = 8000;
    const likeIntentById = new Map();
    const reactionIntentById = new Map();

    function rememberIntent(map, id, on) {
      map.set(String(id), { on: !!on, until: Date.now() + LIKE_INTENT_MS });
    }

    function applyIntent(map, ids) {
      const next = ids instanceof Set ? new Set(ids) : new Set(Array.isArray(ids) ? ids : []);
      const now = Date.now();
      map.forEach((intent, id) => {
        if (!intent || now > intent.until) {
          map.delete(id);
          return;
        }
        if (intent.on) next.add(id);
        else next.delete(id);
      });
      return next;
    }

    function isDuplicateToggleError(error) {
      const code = String(error && error.code || '');
      const status = Number(error && error.status);
      const message = String(error && error.message || '');
      return code === '23505' || status === 409 || /duplicate key|already exists/i.test(message);
    }
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
        rvs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        let avg = 0;
        if (rvs.length > 0) {
          avg = rvs.reduce((s, r) => s + toRatingNumber(r.rating), 0) / rvs.length;
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
    let pendingConfirmAction = null;

    function openConfirmAction({ title, body, confirmText, action, icon }) {
      pendingConfirmAction = typeof action === 'function' ? action : null;
      const titleEl = document.getElementById('confirm-action-title');
      const bodyEl = document.getElementById('confirm-action-body');
      const btnEl = document.getElementById('confirm-action-btn');
      const iconWrap = document.getElementById('confirm-action-icon-wrap');
      if (titleEl) titleEl.textContent = title || 'Подтвердите действие';
      if (bodyEl) bodyEl.textContent = body || '';
      if (btnEl) btnEl.textContent = confirmText || 'Удалить';
      if (iconWrap) {
        const iconName = /^[a-z0-9-]+$/i.test(String(icon || '')) ? icon : 'trash-2';
        iconWrap.innerHTML = `<i data-lucide="${iconName}" class="w-8 h-8"></i>`;
        refreshIcons();
      }
      openModal('modal-confirm-action');
    }

    async function executeConfirmAction() {
      const action = pendingConfirmAction;
      pendingConfirmAction = null;
      closeModal('modal-confirm-action');
      if (action) await action();
    }
    let reviewPublishBlocked = false;
    let existingReviewForActiveRelease = null;
    let activeProfile = null; // { id, username, displayName }
    const REVIEW_MIN_LENGTH = 30;
    const REVIEW_MAX_LENGTH = 3000;


    function openSafeUrl(urlStr) {
      if (!urlStr) return showToast('Ссылка на релиз отсутствует');
      try {
        const url = new URL(urlStr);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          window.open(url.href, '_blank', 'noopener,noreferrer');
        } else {
          console.warn('Небезопасный URL:', urlStr);
          showToast('Некорректная ссылка');
        }
      } catch (e) {
        console.warn('Некорректный URL:', urlStr);
        showToast('Некорректная ссылка');
      }
    }

    // Фолбэк для клиентов без tg.shareMessage. Edge Function возвращает
    // канонический deep-link Mini App; при недоступном сервере остаётся ссылка
    // на сам релиз, поэтому кнопка никогда не становится бесполезной.
    function shareReleaseLink(rel, serverDeepLink = '') {
      const link = getShareTarget(serverDeepLink, rel.link);
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

      try {
        await ensureValidAuthSession();
        const token = getSupabaseAccessToken();
        if (!token) throw new Error('No authenticated session');
        const res = await fetch(SUPABASE_SHARE_MESSAGE_FUNCTION_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ releaseId: rel.id, prepare: canShareMessage })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        if (canShareMessage && data.preparedMessageId) {
          tg.shareMessage(data.preparedMessageId, (sent) => {
            if (sent) showToast('Отправлено', 'success');
          });
          return;
        }
        shareReleaseLink(rel, data.deepLink);
        return;
      } catch (e) {
        console.error('Share preparation error:', e);
      }
      shareReleaseLink(rel);
    }

    // Deep-link: открыть конкретный релиз, если приложение запущено через startapp=<id>.
    let startParamHandled = false;
    function handleStartParam() {
      if (startParamHandled) return;
      const param = tg.initDataUnsafe?.start_param || window.Telegram?.WebApp?.initDataUnsafe?.start_param;
      if (!param) { startParamHandled = true; return; }
      if (releasesById.has(param)) {
        startParamHandled = true;
        openRelease(param);
      }
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
          <span class="text-[11px] text-gray-500">${count} ${pluralReleases(count)}</span>
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
        document.getElementById('active-genre-count').innerText = `${count} ${pluralReleases(count)}`;
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
      wrap.className = 'w-full flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2';
      wrap.innerHTML = `<span class="text-[11px] text-gray-400 font-medium flex-1 min-w-0 truncate">${label}</span>`;
      const valueEl = document.createElement('span');
      valueEl.id = `criterion-${key}`;
      valueEl.className = 'text-[12px] font-bold text-white min-w-4 text-center tabular-nums';
      valueEl.innerText = '5';
      const minus = document.createElement('button');
      minus.className = 'rating-btn btn-press !w-7 !h-7 !rounded-full';
      minus.innerText = '−';
      minus.setAttribute('aria-label', 'Уменьшить оценку для ' + label);
      minus.setAttribute('data-act', 'set-criterion');
      minus.setAttribute('data-key', key);
      minus.setAttribute('data-delta', '-1');
      const plus = document.createElement('button');
      plus.className = 'rating-btn btn-press !w-7 !h-7 !rounded-full';
      plus.innerText = '+';
      plus.setAttribute('aria-label', 'Увеличить оценку для ' + label);
      plus.setAttribute('data-act', 'set-criterion');
      plus.setAttribute('data-key', key);
      plus.setAttribute('data-delta', '1');
      wrap.appendChild(minus);
      wrap.appendChild(valueEl);
      wrap.appendChild(plus);
      criteriaContainer.appendChild(wrap);
    });

    function setCriterion(key, delta) {
      const next = Math.max(1, Math.min(10, (selectedCriteria[key] || 5) + delta));
      selectedCriteria = { ...selectedCriteria, [key]: next };
      document.getElementById(`criterion-${key}`).innerText = next;
      updateRatingTotal();
    }

    function updateRatingTotal() {
      const average = getCriteriaAverage(selectedCriteria);
      const sum = criteriaConfig.reduce((total, { key }) => {
        const value = selectedCriteria[key];
        return total + (typeof value === 'number' ? value : 5);
      }, 0);
      const valueEl = document.getElementById('rating-total-value');
      const sumEl = document.getElementById('rating-total-sum');
      const fillEl = document.getElementById('rating-total-fill');
      const meterEl = document.getElementById('rating-total-meter');
      if (valueEl) valueEl.textContent = average.toFixed(1);
      if (sumEl) sumEl.textContent = `${sum} / 60`;
      if (fillEl) fillEl.style.width = `${Math.max(0, Math.min(100, (average / 10) * 100))}%`;
      if (meterEl) meterEl.setAttribute('aria-valuenow', String(average));
    }

    function resetReviewInputs() {
      selectedCriteria = { sound: 5, production: 5, originality: 5, meaning: 5, relevance: 5, image: 5 };
      criteriaConfig.forEach(({ key }) => {
        const el = document.getElementById(`criterion-${key}`);
        if (el) el.innerText = '5';
      });
      updateRatingTotal();
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

    function prefersReducedMotion() {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function bindEnterAnimations(root) {
      if (!root) return;
      root.querySelectorAll('.card-enter, .review-enter').forEach((el) => {
        if (prefersReducedMotion()) {
          el.classList.remove('card-enter', 'review-enter');
          return;
        }
        el.addEventListener('animationend', (event) => {
          if (event.target === el) el.classList.remove('card-enter', 'review-enter');
        }, { once: true });
      });
    }

    let toastHideTimer = null;
    function showToast(msg, haptic = null) {
      const t = document.getElementById('toast');
      document.getElementById('toast-msg').innerText = msg;
      t.classList.replace('opacity-0', 'opacity-100');
      t.classList.replace('pointer-events-none', 'pointer-events-auto');
      if (toastHideTimer) clearTimeout(toastHideTimer);
      toastHideTimer = setTimeout(() => {
        t.classList.replace('opacity-100', 'opacity-0');
        t.classList.replace('pointer-events-auto', 'pointer-events-none');
        toastHideTimer = null;
      }, 2500);
      if (haptic) {
        const mapped = (haptic === 'warn' || haptic === 'info') ? 'warning' : haptic;
        if (mapped === 'success' || mapped === 'error' || mapped === 'warning') {
          tgHapticNotify(mapped);
        }
      }
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

      const previousIndex = TAB_ORDER.indexOf(activeTabId);
      const nextIndex = TAB_ORDER.indexOf(tabId);
      const direction = previousIndex !== -1 && nextIndex < previousIndex ? 'backward' : 'forward';

      activeTabId = tabId;
      updateTabNav(tabId);

      if (!current || current === next || current.id === 'screen-loading' || prefersReducedMotion()) {
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
      }, 540);
    }

    // Стек открытых модалок — для нативной кнопки «Назад» Telegram.
    let openModalStack = [];
    const modalCloseGens = {};
    let releaseSheetLocked = false;
    let releaseSheetLockTimer = null;

    function lockReleaseSheet() {
      releaseSheetLocked = true;
      const sheet = document.querySelector('#modal-release .modal-container');
      if (sheet) {
        sheet.scrollTop = 0;
        sheet.classList.add('is-open-locked');
      }
      if (releaseSheetLockTimer) clearTimeout(releaseSheetLockTimer);
      releaseSheetLockTimer = setTimeout(unlockReleaseSheet, 800);
    }

    function unlockReleaseSheet() {
      releaseSheetLocked = false;
      if (releaseSheetLockTimer) {
        clearTimeout(releaseSheetLockTimer);
        releaseSheetLockTimer = null;
      }
      const sheet = document.querySelector('#modal-release .modal-container');
      if (sheet) sheet.classList.remove('is-open-locked');
    }

    function syncBackButton() {
      try {
        const back = tg?.BackButton;
        if (!back) return;
        if (openModalStack.length > 0) back.show?.();
        else back.hide?.();
      } catch (_) {}
    }

    function openModal(id) {
      modalCloseGens[id] = (modalCloseGens[id] || 0) + 1;
      const m = document.getElementById(id); m.classList.remove('hidden');
      m.setAttribute('aria-hidden', 'false');
      const c = m.querySelector('.modal-container');
      const o = m.querySelector('.modal-overlay');
      // Сброс возможных остатков inline-стилей от свайпа.
      c.style.transform = ''; c.style.transition = '';
      o.style.opacity = ''; o.style.transition = '';
      o.classList.remove('fade-out'); o.classList.add('fade-in');
      c.classList.remove('slide-down-modal'); c.classList.add('slide-up-modal');
      openModalStack = openModalStack.filter(x => x !== id);
      openModalStack.push(id);
      document.body.classList.add('modal-open'); // фон уходит вглубь
      syncBackButton();
      if (prefersReducedMotion()) {
        c.classList.remove('slide-up-modal');
        o.classList.remove('fade-in');
        return;
      }
      // После открытия снимаем slide-up-modal: иначе forwards-заливка анимации
      // перекрывает inline-transform при свайпе вниз.
      setTimeout(() => { if (!m.classList.contains('hidden')) c.classList.remove('slide-up-modal'); }, 700);
    }

    // Финальная очистка модалки — общая для обычного и свайп-закрытия.
    function finalizeModalClose(id) {
      const m = document.getElementById(id);
      const c = m.querySelector('.modal-container');
      const o = m.querySelector('.modal-overlay');
      m.classList.add('hidden');
      m.setAttribute('aria-hidden', 'true');
      c.classList.remove('slide-down-modal', 'slide-up-modal');
      o.classList.remove('fade-out', 'fade-in');
      c.style.transform = ''; c.style.transition = '';
      o.style.opacity = ''; o.style.transition = '';
      if (id === 'modal-add') {
        document.getElementById('add-form-step-1').classList.remove('hidden');
        document.getElementById('add-form-step-manual').classList.add('hidden');
        manualCoverBase64 = null;
        currentPendingLink = '';
        selectedGenreForAdd = '';
        document.getElementById('manual-cover-preview').innerHTML = `<i data-lucide="image-plus" class="w-8 h-8 text-gray-400 mb-2"></i><span class="text-[12px] text-gray-400">Загрузить обложку (необязательно)</span>`;
        document.getElementById('manual-artist').value = '';
        document.getElementById('manual-title').value = '';
        const manualLinkEl = document.getElementById('manual-link');
        if (manualLinkEl) manualLinkEl.value = '';
        const coverInput = document.getElementById('manual-cover-input');
        if (coverInput) coverInput.value = '';
        refreshIcons();
      }
      if (id === 'modal-release') {
        reviewPublishBlocked = false;
        existingReviewForActiveRelease = null;
        unlockReleaseSheet();
        clearCoverMorph();
        const relImg = document.getElementById('rel-img');
        relImg.style.opacity = '';
        relImg.style.transition = '';
      }
      if (id === 'modal-confirm-review-delete') {
        pendingReviewDelete = null;
        pendingReviewTargetReleaseId = null;
      }
      if (id === 'modal-confirm-action') {
        pendingConfirmAction = null;
      }
    }

    function closeModal(id, immediate) {
      const closeGen = modalCloseGens[id] || 0;
      openModalStack = openModalStack.filter(x => x !== id);
      // Фон возвращается, как только закрыта последняя модалка из стека.
      if (openModalStack.length === 0) document.body.classList.remove('modal-open');
      syncBackButton();
      if (immediate || prefersReducedMotion()) { finalizeModalClose(id); return; }
      const m = document.getElementById(id);
      const c = m.querySelector('.modal-container');
      const o = m.querySelector('.modal-overlay');
      c.classList.remove('slide-up-modal'); c.classList.add('slide-down-modal');
      o.classList.remove('fade-in'); o.classList.add('fade-out');
      setTimeout(() => {
        if ((modalCloseGens[id] || 0) !== closeGen) return;
        if (openModalStack.includes(id)) return;
        finalizeModalClose(id);
      }, 460);
    }

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || openModalStack.length === 0) return;
      event.preventDefault();
      closeModal(openModalStack[openModalStack.length - 1]);
    });

    function computeProfileBadgesForUser(userReviews) {
      return computeProfileBadges(userReviews, (id) => releasesById.get(id));
    }

    function renderProfileBadges(userReviews) {
      const wrap = document.getElementById('profile-badges');
      const list = document.getElementById('profile-badges-list');
      if (!wrap || !list) return;
      const badges = computeProfileBadgesForUser(userReviews);
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
        const isProfileBlocked = profile.id != null
          ? blockedUserIds.has(String(profile.id))
          : blockedUsers.includes(profileCleanName);
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
          const sum = userReviews.reduce((s, r) => s + toRatingNumber(r.rating), 0);
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

        const profileModal = document.getElementById('modal-profile');
        if (!profileModal || profileModal.classList.contains('hidden')) {
          openModal('modal-profile');
        }
        refreshIcons();
      }
    }

    // --- АДМИН-ФУНКЦИИ: блокировка и удаление ---
    async function toggleBlockUser() {
      if (!activeProfile || !user.isAdmin) return;
      if (activeProfile.id == null) return showToast('Не удалось определить Telegram ID пользователя');
      const targetId = String(activeProfile.id);
      const cleanName = activeProfile.username || cleanUsername(activeProfile.displayName);
      const isCurrentlyBlocked = blockedUserIds.has(targetId);
      try {
        const { error } = await supabase.rpc('admin_set_block', {
          p_user_id: Number(activeProfile.id),
          p_blocked: !isCurrentlyBlocked
        });
        if (error) throw error;
        if (isCurrentlyBlocked) {
          blockedUserIds.delete(targetId);
          blockedUsers = blockedUsers.filter(u => u !== cleanName);
          showToast(`@${cleanName || targetId} разблокирован`);
        } else {
          blockedUserIds.add(targetId);
          if (cleanName && !blockedUsers.includes(cleanName)) blockedUsers.push(cleanName);
          showToast(`@${cleanName || targetId} заблокирован`);
        }
        openProfileModal(activeProfile);
      } catch(e) { showToast('Ошибка: ' + e.message); }
    }

    function requestDeleteAllReviewsByUser() {
      if (!activeProfile || !user.isAdmin) return;
      if (activeProfile.id == null) return showToast('Не удалось определить Telegram ID пользователя');
      const displayName = activeProfile.displayName || activeProfile.username || activeProfile.id;
      openConfirmAction({
        title: 'Удалить все рецензии?',
        body: `Все рецензии ${displayName} будут удалены безвозвратно.`,
        confirmText: 'Удалить все',
        action: () => deleteAllReviewsByUser()
      });
    }

    async function deleteAllReviewsByUser() {
      if (!activeProfile || !user.isAdmin) return;
      if (activeProfile.id == null) return showToast('Не удалось определить Telegram ID пользователя');
      const targetId = String(activeProfile.id);
      try {
        const { data: deleted, error } = await supabase.rpc('admin_delete_reviews', {
          p_user_id: Number(activeProfile.id)
        });
        if (error) throw error;
        const goneReviewIds = new Set(
          reviews.filter(r => String(r.authorId) === targetId).map(r => r.id)
        );
        reviews = reviews.filter(r => String(r.authorId) !== targetId);
        updateReviewsMap();
        comments = comments.filter(c => !goneReviewIds.has(c.reviewId));
        updateCommentsMap();
        showToast(`Удалено ${Number(deleted) || 0} рецензий`);
        refreshCatalogViews();
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
    
    // --- КЭШИРОВАНИЕ: мгновенный старт из localStorage ---
    const CACHE_KEY = 'xxii_public_cache_v3';
    const CACHE_TTL_MS = 15 * 60 * 1000;

    function saveCache(data) {
      try {
        const payload = {
          savedAt: Date.now(),
          data: getPublicCacheData(data)
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
      } catch(e) {}
    }

    function loadCache() {
      try {
        // v2 мог содержать приватные данные другого Telegram-пользователя.
        localStorage.removeItem('xxii_cache_v2');
        const raw = JSON.parse(localStorage.getItem(CACHE_KEY));
        if (!raw) return null;

        if (!raw.savedAt || !raw.data) return null;
        if (Date.now() - raw.savedAt > CACHE_TTL_MS) return null;

        return getPublicCacheData(raw.data);
      } catch(e) {
        return null;
      }
    }

    let sessionExpiredWarned = false;

    function refreshOpenSheets() {
      if (activeReleaseId && !document.getElementById('modal-release')?.classList.contains('hidden')) {
        existingReviewForActiveRelease = getExistingReviewForRelease(activeReleaseId);
        reviewPublishBlocked = !!existingReviewForActiveRelease;
        renderReviews();
        updateReviewCharCount();
      }
      if (activeProfile && !document.getElementById('modal-profile')?.classList.contains('hidden')) {
        openProfileModal(activeProfile);
      }
    }

    function refreshCatalogViews() {
      renderReleases();
      const likesScreen = document.getElementById('screen-likes');
      const feedScreen = document.getElementById('screen-feed');
      if (likesScreen && !likesScreen.classList.contains('hidden')) renderLikes();
      if (feedScreen && !feedScreen.classList.contains('hidden')) renderFeed();
    }

    function applyPublicData(data) {
      releases = data.releases || [];
      releasesById = new Map(releases.map(r => [r.id, r]));
      reviews = data.reviews || [];
      updateReviewsMap();
      comments = data.comments || [];
      updateCommentsMap();
      updateGenreCounts();
      renderReleases();
      if (!activeTabId) switchTab('home');
      else if (activeTabId === 'likes') renderLikes();
      else if (activeTabId === 'feed') renderFeed();
      refreshOpenSheets();
      handleStartParam();
    }

    function applyAccountData(data) {
      const serverLikes = new Set(data.likes || []);
      pendingLikeIds.forEach((id) => {
        if (likedSet.has(id)) serverLikes.add(id);
        else serverLikes.delete(id);
      });
      likedSet = applyIntent(likeIntentById, serverLikes);
      const serverReactions = new Set(data.myReactions || []);
      pendingReactionIds.forEach((id) => {
        if (reactedSet.has(id)) serverReactions.add(id);
        else serverReactions.delete(id);
      });
      reactedSet = applyIntent(reactionIntentById, serverReactions);
      blockedUsers = data.blockedUsers || [];
      blockedUserIds = new Set((data.blockedUserIds || []).map(String));
      if (data.currentUser) {
        if (data.currentUser.userId != null) user.userId = data.currentUser.userId;
        user.username = data.currentUser.displayName || user.username;
        user.isAdmin = !!data.currentUser.isAdmin;
        user.isBlocked = !!data.currentUser.isBlocked;
        user.isAuthenticated = !!data.currentUser.isAuthenticated;
        user.notificationsEnabled = data.currentUser.notificationsEnabled !== false;
        user.role = user.isAdmin ? 'Создатель' : 'Пользователь';
      }
      applyUserRole();
      notifyIfBlocked();
      applyNotificationsToggle();
      renderReleases();
      if (activeTabId === 'likes') renderLikes();
      else if (activeTabId === 'feed') renderFeed();
      refreshOpenSheets();
    }

    function applyData(data) {
      applyPublicData(data);
      applyAccountData(data);
    }



    function hasUsableAccessToken(expectedUserId = user.userId) {
      const token = getSupabaseAccessToken();
      const claims = decodeJwtPayload(token);
      if (!token || !claims) return false;
      if (claims.role !== 'authenticated') return false;
      if (expectedUserId != null
          && getTelegramIdFromClaims(claims) !== String(expectedUserId)) return false;
      return Number(claims.exp || 0) * 1000 > Date.now() + 30_000;
    }

    async function setSupabaseAccessToken(token) {
      supabaseAccessToken = token;
      try {
        await supabase?.realtime?.setAuth?.(token);
      } catch (error) {
        console.warn('Realtime token update failed:', error);
      }
    }

    let authenticationPromise = null;
    async function authenticateWithSupabase(force = false) {
      if (!supabase) return false;
      if (authenticationPromise) return authenticationPromise;
      if (!force && user.isAuthenticated && hasUsableAccessToken()) return true;
      const currentInitData = getTgInitData();
      if (!currentInitData) return false;

      authenticationPromise = (async () => {
        try {
        const res = await fetch(SUPABASE_AUTH_FUNCTION_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({ initData: currentInitData })
        });
        if (!res.ok) throw new Error('Auth failed: ' + res.status);
        const data = await res.json();

        const claims = decodeJwtPayload(data.token);
        if (!data.token || !claims
            || claims.role !== 'authenticated'
            || getTelegramIdFromClaims(claims) !== String(data.user?.userId)
            || Number(claims.exp || 0) * 1000 <= Date.now() + 30_000) {
          throw new Error('Auth returned an invalid user token');
        }
        await setSupabaseAccessToken(data.token);
        user.userId = data.user.userId;
        user.username = data.user.username;
        user.isAdmin = Boolean(data.user.isAdmin);
        user.isBlocked = Boolean(data.user.isBlocked);
        user.isAuthenticated = true;
        user.role = user.isAdmin ? 'Создатель' : 'Пользователь';
        applyUserRole();
        applyNotificationsToggle();
        return true;
        } catch (err) {
          console.error("Supabase authentication failed:", err);
          return false;
        }
      })();
      try { return await authenticationPromise; }
      finally { authenticationPromise = null; }
    }

    async function ensureValidAuthSession(force = false) {
      if (!force && user.isAuthenticated && hasUsableAccessToken()) return true;
      return await authenticateWithSupabase(true);
    }



    // New servers accept p_id so Realtime can merge in place. Older schemas
    // still expose the previous signature — retry without the extra argument.
    async function rpcCreateWithOptionalId(fn, payload) {
      const first = await supabase.rpc(fn, payload).single();
      if (!first.error || !payload.p_id || !isMissingRpcSignature(first.error)) return first;
      const rest = { ...payload };
      delete rest.p_id;
      return supabase.rpc(fn, rest).single();
    }

    async function fetchDB() {
        if (!supabase) {
          console.error("Supabase client is not initialized.");
          setSyncStatus('Нет соединения', 'warn');
          if (!activeTabId) switchTab('home');
          return;
        }
        setSyncStatus('Загрузка релизов', 'syncing');

        // 1. Мгновенно показываем только публичный каталог. Личные данные
        // (лайки, реакции, роль) кэш не содержит и сбрасывать их нельзя.
        const cached = loadCache();
        if (cached) {
          applyPublicData(cached);
          setSyncStatus('Обновляем релизы', 'syncing');
        }

        // 2. Публичный каталог не зависит от авторизации: начинаем обе ветки
        // одновременно, а личные данные догружаем в фоне после Telegram auth.
        const authPromise = authenticateWithSupabase();
        const accountPromise = authPromise.then(async (authOk) => {
            if (tg.initData && !authOk && !sessionExpiredWarned) {
              sessionExpiredWarned = true;
              showToast('Сессия Telegram устарела — переоткройте приложение');
            }
            if (!authOk) return null;
            let likesPromise = Promise.resolve({ data: [] });
            let reactionsPromise = Promise.resolve({ data: [] });
            let subscriberPromise = Promise.resolve({ data: null });
            let blockedUsersPromise = Promise.resolve({ data: [] });

            if (user.isAuthenticated && user.userId) {
              likesPromise = supabase.from('likes').select('release_id').eq('user_id', user.userId);
              reactionsPromise = supabase.from('review_reactions').select('review_id').eq('user_id', user.userId);
              subscriberPromise = supabase.from('notification_subscribers').select('enabled').eq('user_id', user.userId).maybeSingle();
            }

            if (user.isAdmin) {
              blockedUsersPromise = supabase.from('blocked_users').select('user_id, username');
            }

            const [likesRes, reactionsRes, subRes, blockedRes] = await Promise.all([
              likesPromise,
              reactionsPromise,
              subscriberPromise,
              blockedUsersPromise
            ]);
            const accountError = likesRes.error || reactionsRes.error || subRes.error || blockedRes.error;
            if (accountError) throw accountError;
            const likes = (likesRes.data || []).map(l => l.release_id);
            const myReactions = (reactionsRes.data || []).map(r => r.review_id);
            const blockedList = (blockedRes.data || []).map(b => b.username);
            const blockedIds = (blockedRes.data || []).map(b => String(b.user_id));

            if (subRes.data) {
              user.notificationsEnabled = subRes.data.enabled !== false;
              applyNotificationsToggle();
            }

            return {
              likes,
              myReactions,
              blockedUsers: blockedList,
              blockedUserIds: blockedIds,
              currentUser: {
                userId: user.userId,
                displayName: user.username,
                isAdmin: user.isAdmin,
                isBlocked: user.isBlocked,
                isAuthenticated: user.isAuthenticated,
                notificationsEnabled: user.notificationsEnabled
              }
            };
        });
        accountPromise.then((accountData) => {
          if (accountData) applyAccountData(accountData);
        }).catch((error) => {
          console.error('Ошибка загрузки личных данных:', error.message || error);
          showToast('Личные данные временно недоступны');
        });

        // 3. Загружаем и показываем свежий публичный каталог независимо от auth.
        try {
            const [releasesRes, reviewsRes, commentsRes] = await Promise.all([
              supabase.from('releases').select('*').order('timestamp', { ascending: false }).limit(200),
              supabase.from('reviews_view').select('*').order('timestamp', { ascending: false }).limit(1000),
              supabase.from('comments_view').select('*').order('timestamp', { ascending: false }).limit(2000)
            ]);
            if (releasesRes.error) throw releasesRes.error;
            if (reviewsRes.error) throw reviewsRes.error;
            if (commentsRes.error) throw commentsRes.error;

            const publicData = {
              releases: releasesRes.data || [],
              reviews: reviewsRes.data || [],
              comments: commentsRes.data || []
            };
            saveCache(publicData);
            applyPublicData(publicData);
            setSyncStatus('Релизы загружены', 'ok');
        } catch(e) {
            console.error("Ошибка загрузки БД:", e.message || e);
            setSyncStatus(cached ? 'Оффлайн (кэш)' : 'Нет соединения', 'warn');
            if (!cached) showToast("Работаем в оффлайн-режиме (сервер недоступен)");
            if (!activeTabId) switchTab('home');
        }
    }

    // Применяет инкрементальную дельту от Realtime/сервера к локальному состоянию.
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
        reviews = upsertByMatcher(reviews, rv, isSameReview);
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

      // Удалённые рецензии/релизы уносят свои комментарии (каскад).
      const goneReviewIds = new Set(data.deletedReviewIds || []);
      const goneReleaseIds = new Set(data.deletedReleaseIds || []);
      if (goneReviewIds.size || goneReleaseIds.size) {
        const before = comments.length;
        comments = comments.filter(c => !goneReviewIds.has(c.reviewId) && !goneReleaseIds.has(c.relId));
        if (comments.length !== before) commentsChanged = true;
      }

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

    let supabaseChannel = null;

    function startSyncLoop() {
      if (!supabase) return;
      if (supabaseChannel) return;
      setSyncStatus('Синхронизация...', 'syncing');

      supabaseChannel = supabase
        .channel('public-db-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'releases' },
          (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              applySyncDelta({ releases: [payload.new] });
            } else if (payload.eventType === 'DELETE') {
              applySyncDelta({ deletedReleaseIds: [payload.old.id] });
            }
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'reviews' },
          async (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const { data: rev } = await supabase.from('reviews_view').select('*').eq('id', payload.new.id).maybeSingle();
              if (rev) {
                applySyncDelta({ reviews: [rev] });
              }
            } else if (payload.eventType === 'DELETE') {
              applySyncDelta({ deletedReviewIds: [payload.old.id] });
            }
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'review_comments' },
          async (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const { data: comm } = await supabase.from('comments_view').select('*').eq('id', payload.new.id).maybeSingle();
              if (comm) {
                applySyncDelta({ comments: [comm] });
              }
            } else if (payload.eventType === 'DELETE') {
              applySyncDelta({ deletedCommentIds: [payload.old.id] });
            }
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'likes' },
          (payload) => {
            if (user.userId) {
              const uId = Number(payload.new?.user_id || payload.old?.user_id);
              if (uId === Number(user.userId)) {
                const relId = payload.new?.release_id || payload.old?.release_id;
                if (relId && (pendingLikeIds.has(relId) || likeIntentById.has(String(relId)))) {
                  likedSet = applyIntent(likeIntentById, likedSet);
                } else if (payload.eventType === 'INSERT' && relId) {
                  likedSet.add(relId);
                } else if (payload.eventType === 'DELETE' && relId) {
                  likedSet.delete(relId);
                }
                renderReleases();
                if (!document.getElementById('screen-likes').classList.contains('hidden')) renderLikes();
              }
            }
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'review_reactions' },
          async (payload) => {
            const revId = payload.new?.review_id || payload.old?.review_id;
            if (revId) {
              const { data: rev } = await supabase.from('reviews_view').select('*').eq('id', revId).maybeSingle();
              if (rev) {
                applySyncDelta({ reviews: [rev] });
              }
            }
            if (user.userId) {
              const uId = Number(payload.new?.user_id || payload.old?.user_id);
              if (uId === Number(user.userId)) {
                if (revId && (pendingReactionIds.has(revId) || reactionIntentById.has(String(revId)))) {
                  reactedSet = applyIntent(reactionIntentById, reactedSet);
                } else if (payload.eventType === 'INSERT' && revId) {
                  reactedSet.add(revId);
                } else if (payload.eventType === 'DELETE' && revId) {
                  reactedSet.delete(revId);
                }
                if (activeReleaseId && !document.getElementById('modal-release')?.classList.contains('hidden')) {
                  renderReviews();
                }
                if (!document.getElementById('screen-feed').classList.contains('hidden')) renderFeed();
              }
            }
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'blocked_users' },
          (payload) => {
            if (payload.eventType === 'INSERT') {
              if (!blockedUsers.includes(payload.new.username)) blockedUsers.push(payload.new.username);
              blockedUserIds.add(String(payload.new.user_id));
              if (String(payload.new.user_id) === String(user.userId)) {
                user.isBlocked = true;
                showToast("Ваш аккаунт заблокирован администратором");
                applyUserRole();
              }
            } else if (payload.eventType === 'DELETE') {
              blockedUsers = blockedUsers.filter(u => u !== payload.old.username);
              blockedUserIds.delete(String(payload.old.user_id));
              if (String(payload.old.user_id) === String(user.userId)) {
                user.isBlocked = false;
                showToast("Ваш аккаунт разблокирован");
                applyUserRole();
              }
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            setSyncStatus('Всё актуально', 'ok');
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            setSyncStatus('Нет соединения', 'warn');
          }
        });
    }

    function stopSyncLoop() {
      if (supabaseChannel) {
        supabase.removeChannel(supabaseChannel);
        supabaseChannel = null;
      }
    }

    // Пауза при скрытой вкладке, возобновление с последнего курсора.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopSyncLoop();
      else fetchDB().finally(() => { if (!document.hidden) startSyncLoop(); });
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

    // Свайп вниз закрывает модалку-шторку (iOS sheets). Тянуть можно от верха
    // листа; если контент проскроллен — жест отдаётся прокрутке.
    (function setupSheetDrag() {
      const THRESHOLD = 110;
      let container = null, modalId = null, overlay = null;
      let startY = 0, dy = 0, dragging = false;

      document.addEventListener('touchstart', (e) => {
        container = null; dragging = false; dy = 0;
        if (e.touches.length !== 1) return;
        const c = e.target.closest('.modal-container');
        if (!c) return;
        if (e.target.closest('input, textarea')) return; // не мешаем вводу
        const modal = c.closest('[id^="modal-"]');
        if (!modal || modal.classList.contains('hidden')) return;
        if (modal.id === 'modal-release' && releaseSheetLocked) return;
        if (c.scrollTop > 0) return;
        container = c; modalId = modal.id;
        overlay = modal.querySelector('.modal-overlay');
        startY = e.touches[0].clientY;
      }, { passive: true });

      document.addEventListener('touchmove', (e) => {
        if (!container) return;
        const delta = e.touches[0].clientY - startY;
        if (!dragging) {
          if (delta > 6 && container.scrollTop <= 0) {
            dragging = true;
            container.classList.remove('slide-up-modal');
            container.style.transition = 'none';
          } else if (delta < -2) {
            container = null; // ушли вверх — отдать прокрутке
            return;
          } else {
            return;
          }
        }
        e.preventDefault();
        dy = Math.max(0, delta);
        container.style.transform = `translateY(${dy}px)`;
        if (overlay) overlay.style.opacity = String(Math.max(0.15, 1 - dy / 600));
      }, { passive: false });

      function endDrag() {
        if (!container) return;
        const c = container, id = modalId, ov = overlay, dist = dy;
        container = null; dragging = false;
        if (dist > THRESHOLD) {
          c.style.transition = 'transform 0.28s var(--ios-glide)';
          c.style.transform = 'translateY(100%)';
          if (ov) { ov.style.transition = 'opacity 0.28s var(--ios-glide)'; ov.style.opacity = '0'; }
          const swipeGen = modalCloseGens[id] || 0;
          setTimeout(() => {
            if ((modalCloseGens[id] || 0) !== swipeGen) return;
            closeModal(id, true);
          }, 280);
        } else {
          c.style.transition = 'transform 0.4s var(--ios-glide)';
          c.style.transform = 'translateY(0px)';
          if (ov) { ov.style.transition = 'opacity 0.3s var(--ios-glide)'; ov.style.opacity = ''; }
          setTimeout(() => {
            c.style.transition = ''; c.style.transform = '';
            if (ov) ov.style.transition = '';
          }, 430);
        }
      }
      document.addEventListener('touchend', endDrag, { passive: true });
      document.addEventListener('touchcancel', endDrag, { passive: true });
    })();

    function compressImageFile(file, maxWidth = 600, maxHeight = 600, quality = 0.85) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
        reader.onload = (e) => {
          const img = new Image();
          img.onerror = () => reject(new Error('Не удалось загрузить изображение'));
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              let width = img.width;
              let height = img.height;

              // Центрируем и обрезаем в идеальный квадрат 1:1
              const minSide = Math.min(width, height);
              const cropX = (width - minSide) / 2;
              const cropY = (height - minSide) / 2;

              const targetSize = Math.min(minSide, maxWidth);
              canvas.width = targetSize;
              canvas.height = targetSize;

              const ctx = canvas.getContext('2d');
              if (!ctx) {
                return resolve(e.target.result);
              }
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(img, cropX, cropY, minSide, minSide, 0, 0, targetSize, targetSize);
              const compressed = canvas.toDataURL('image/jpeg', quality);
              resolve(compressed);
            } catch (err) {
              console.warn('Canvas compression error:', err);
              resolve(e.target.result);
            }
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    async function fetchBackendParseData(link) {
      if (isLocalhost) {
        try {
          const localRes = await fetch('/api/parse-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link })
          });
          if (localRes.ok) {
            const data = await localRes.json();
            if (data.name && data.name !== 'Релиз') {
              return {
                artist: data.artist || '',
                name: data.name || '',
                cover: data.img || '',
                genre: data.genre || null
              };
            }
          }
        } catch (err) {
          console.warn('Local parser error, falling back to Supabase:', err);
        }
      }

      await ensureValidAuthSession();
      const parserToken = getSupabaseAccessToken();
      if (!parserToken) throw new Error('Telegram session is required for metadata parsing');

      const res = await fetch(SUPABASE_PARSE_LINK_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${parserToken}`,
          'X-Telegram-Init-Data': getTgInitData()
        },
        body: JSON.stringify({ link })
      });
      
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Backend parse failed (${res.status}): ${errText}`);
      }
      const data = await res.json();

      if (data.name && data.name !== 'Релиз' && data.name !== 'YouTube') {
        return {
          artist: data.artist || '',
          name: data.name || '',
          cover: data.img || '',
          genre: data.genre || null
        };
      }
      throw new Error('Could not extract valid release from backend');
    }

    const itunesCache = new Map();
    async function fetchItunesData(artist, name) {
      const cacheKey = `${artist}|${name}`.toLowerCase();
      if (itunesCache.has(cacheKey)) {
        return itunesCache.get(cacheKey);
      }

      const fetchPromise = (async () => {
        try {
          const cleanQ = cleanTrackTitle(`${artist} ${name}`).replace(/[\(\)\[\]«»"']/g, ' ');
          const query = encodeURIComponent(cleanQ).replace(/%20/g, '+');
          const itunesRes = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=1`);
          const itunesData = await itunesRes.json();

          if (itunesData.results && itunesData.results.length > 0) {
            const track = itunesData.results[0];
            return {
              cover: track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '600x600bb') : '',
              artist: track.artistName,
              name: track.trackName
            };
          }
          return null;
        } catch (error) {
          itunesCache.delete(cacheKey);
          return null;
        }
      })();

      itunesCache.set(cacheKey, fetchPromise);
      return fetchPromise;
    }

    // --- НАДЕЖНАЯ ЛОГИКА РАСПОЗНАВАНИЯ РЕЛИЗОВ ---
    async function handleAddRelease() {
      const inputEl = document.getElementById('input-link');
      const link = (inputEl ? inputEl.value : '').trim();
      if (!link) return showToast('Введите ссылку на трек или альбом', 'warn');
      if (!isSafeHttpUrl(link)) return showToast('Некорректная ссылка. Нужен адрес http или https', 'warn');

      const btnSubmit = document.getElementById('btn-submit');
      const btnText = document.getElementById('btn-add-text');
      if (btnSubmit) btnSubmit.disabled = true;
      if (btnText) btnText.innerText = 'Анализ ссылки...';

      let parsedArtist = '';
      let parsedName = '';
      let parsedCover = '';
      let parsedGenre = '';
      let isSuccess = false;

      try {
        const data = await fetchBackendParseData(link);
        parsedArtist = data.artist;
        parsedName = data.name;
        parsedCover = data.cover;
        if (data.genre) parsedGenre = data.genre;
        isSuccess = Boolean(parsedName && parsedArtist);
      } catch (err) {
        console.warn('Авто-парсинг ссылки не удался:', err);
      } finally {
        if (btnSubmit) btnSubmit.disabled = false;
        if (btnText) btnText.innerText = 'Распознать и добавить';
      }

      // Если обложка отсутствует, но артист и трек известны — ищем обложку в iTunes
      if (!parsedCover && parsedArtist && parsedName) {
        try {
          if (btnText) btnText.innerText = 'Поиск обложки...';
          const itunesData = await fetchItunesData(parsedArtist, parsedName);
          if (itunesData && itunesData.cover) {
            parsedCover = itunesData.cover;
          }
        } catch (e) {
          console.warn('iTunes cover search fallback failed:', e);
        } finally {
          if (btnText) btnText.innerText = 'Распознать и добавить';
        }
      }

      // Заполняем данные для ручного шага (предпросмотра и подтверждения)
      currentPendingLink = link;
      const manualLinkInput = document.getElementById('manual-link');
      if (manualLinkInput) manualLinkInput.value = link;

      const artistInput = document.getElementById('manual-artist');
      const titleInput = document.getElementById('manual-title');
      if (artistInput) artistInput.value = parsedArtist;
      if (titleInput) titleInput.value = parsedName;

      manualCoverBase64 = parsedCover || null;
      const previewZone = document.getElementById('manual-cover-preview');
      if (previewZone) {
        if (parsedCover) {
          previewZone.innerHTML = `<img src="${escapeHtml(parsedCover)}" alt="Превью обложки" class="w-full h-full object-cover"><div class="media-edit-overlay absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"><i data-lucide="edit-2" class="w-6 h-6 text-white"></i></div>`;
        } else {
          previewZone.innerHTML = `<i data-lucide="image-plus" class="w-8 h-8 text-gray-400 mb-2"></i><span class="text-[12px] text-gray-400">Загрузить обложку (необязательно)</span>`;
        }
      }

      if (parsedGenre) {
        selectedGenreForAdd = parsedGenre;
      }
      renderAddGenreSelector('manual-genre-selector');

      // Переключаем шаг модального окна
      document.getElementById('add-form-step-1').classList.add('hidden');
      document.getElementById('add-form-step-manual').classList.remove('hidden');

      const alertEl = document.getElementById('manual-step-alert');
      if (isSuccess) {
        alertEl.innerText = selectedGenreForAdd 
          ? `✓ Распознано! Жанр: ${selectedGenreForAdd}. Проверьте данные и сохраните.` 
          : '✓ Распознано! Выберите жанр и сохраните.';
        alertEl.className = 'text-[12px] text-green-400 bg-green-400/10 p-3 rounded-xl mb-2 text-center';
      } else {
        alertEl.innerText = 'Данные недоступны. Введите вручную:';
        alertEl.className = 'text-[12px] text-amber-400 bg-amber-400/10 p-3 rounded-xl mb-2 text-center';
        showToast('Введите данные релиза вручную', 'info');
      }
      refreshIcons();
    }

    async function handleCoverUpload(event) {
      const file = event.target.files[0];
      if (!file) return;
      
      const MAX_ORIGINAL_BYTES = 12 * 1024 * 1024; // до 12 МБ
      if (file.size > MAX_ORIGINAL_BYTES) {
        event.target.value = '';
        return showToast('Файл слишком большой (максимум 12 МБ)', 'error');
      }

      const previewZone = document.getElementById('manual-cover-preview');
      if (previewZone) {
        previewZone.innerHTML = `<div class="flex items-center justify-center gap-2 text-[12px] text-gray-300 py-6"><span class="animate-pulse">Сжатие обложки...</span></div>`;
      }

      try {
        const compressed = await compressImageFile(file, 600, 600, 0.85);
        manualCoverBase64 = compressed;
        if (previewZone) {
          previewZone.innerHTML = `<img src="${escapeHtml(manualCoverBase64)}" alt="Превью обложки" class="w-full h-full object-cover"><div class="media-edit-overlay absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"><i data-lucide="edit-2" class="w-6 h-6 text-white"></i></div>`;
          refreshIcons();
        }
      } catch (err) {
        console.error('Ошибка сжатия обложки:', err);
        showToast('Не удалось обработать изображение', 'error');
        if (previewZone) {
          previewZone.innerHTML = `<i data-lucide="image-plus" class="w-8 h-8 text-gray-400 mb-2"></i><span class="text-[12px] text-gray-400">Загрузить обложку</span>`;
          refreshIcons();
        }
      } finally {
        event.target.value = '';
      }
    }

    async function callReleaseCoverFunction(payload) {
      const res = await fetch(SUPABASE_RELEASE_COVER_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${getApiBearerToken()}`
        },
        body: JSON.stringify({ ...payload, initData: getTgInitData() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Cover upload failed: ${res.status}`);
      return data;
    }

    async function uploadReleaseCoverIfNeeded(cover, releaseId) {
      if (!String(cover || '').startsWith('data:image/')) {
        return { url: cover || '', path: '' };
      }
      const data = await callReleaseCoverFunction({
        action: 'upload',
        releaseId,
        imageData: cover
      });
      if (!data.url || !data.path) throw new Error('Сервер не вернул адрес обложки');
      return data;
    }

    async function removeUploadedReleaseCover(releaseId, path) {
      if (!path) return;
      try {
        await callReleaseCoverFunction({ action: 'delete', releaseId, path });
      } catch (error) {
        console.warn('Failed to clean up release cover:', error);
      }
    }

    async function saveManualRelease() {
      const artist = document.getElementById('manual-artist').value.trim();
      const title = document.getElementById('manual-title').value.trim();
      const manualLinkEl = document.getElementById('manual-link');
      const releaseLink = (manualLinkEl ? manualLinkEl.value : currentPendingLink || '').trim();

      if (!artist || !title) {
        return showToast('Заполните артиста и название', 'warn');
      }
      if (!releaseLink) {
        return showToast('Укажите ссылку на трек или релиз', 'warn');
      }
      if (!isSafeHttpUrl(releaseLink)) {
        return showToast('Некорректная ссылка. Нужен адрес http или https', 'warn');
      }

      const saveBtn = document.getElementById('btn-save-manual');
      const saveBtnText = document.getElementById('btn-save-manual-text');
      if (saveBtn) saveBtn.disabled = true;
      if (saveBtnText) saveBtnText.innerText = 'Сохранение...';

      const releaseId = genId();
      let uploadedCoverPath = '';
      try {
        // Гарантируем валидную авторизованную сессию
        const authOk = await ensureValidAuthSession();
        if (!authOk) {
          throw new Error('Сессия устарела. Перезапустите приложение.');
        }

        let cover = manualCoverBase64 || '';
        if (!cover) {
          try {
            const itunesData = await fetchItunesData(artist, title);
            if (itunesData && itunesData.cover) {
              cover = itunesData.cover;
            }
          } catch (e) {
            console.warn('Fallback cover search error:', e);
          }
        }

        const uploadedCover = await uploadReleaseCoverIfNeeded(cover, releaseId);
        cover = uploadedCover.url;
        uploadedCoverPath = uploadedCover.path;

        const newRel = {
          id: releaseId,
          name: title,
          artist: artist,
          img: cover || '',
          link: releaseLink,
          genre: selectedGenreForAdd || 'Другое',
          timestamp: Date.now()
        };

        let insertRes = await supabase.from('releases').insert([newRel]);
        
        // Автоматический retry при ошибке авторизации RLS (42501 / expired token).
        if (insertRes.error && (insertRes.error.code === '42501' || insertRes.error.message?.includes('JWT') || insertRes.error.message?.includes('auth') || insertRes.error.message?.includes('row-level security'))) {
          console.warn('RLS insert error, retrying with fresh auth session...');
          await ensureValidAuthSession(true);
          insertRes = await supabase.from('releases').insert([newRel]);
        }

        if (insertRes.error) {
          throw insertRes.error;
        }

        releases.unshift(newRel);
        releasesById.set(newRel.id, newRel);
        const g = newRel.genre || 'Другое';
        genreCounts[g] = (genreCounts[g] || 0) + 1;
        renderReleases();
        closeModal('modal-add');
        showToast('Релиз успешно опубликован!', 'success');

        // Очистка полей
        document.getElementById('manual-artist').value = '';
        document.getElementById('manual-title').value = '';
        if (manualLinkEl) manualLinkEl.value = '';
        currentPendingLink = '';
        manualCoverBase64 = null;
        selectedGenreForAdd = '';
      } catch (err) {
        await removeUploadedReleaseCover(releaseId, uploadedCoverPath);
        console.error('Ошибка сохранения релиза:', err);
        const userMsg = err.message ? `Ошибка: ${err.message}` : 'Ошибка сохранения — попробуйте позже';
        showToast(userMsg, 'error');
      } finally {
        if (saveBtn) saveBtn.disabled = false;
        if (saveBtnText) saveBtnText.innerText = 'Сохранить релиз';
      }
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
      if (!user.isAuthenticated) return showToast('Войдите через Telegram');
      if (user.isBlocked) return showToast('Ваш аккаунт заблокирован');
      if (pendingLikeIds.has(id)) return;
      const isLiking = !likedSet.has(id);

      if (isLiking) likedSet.add(id);
      else likedSet.delete(id);
      rememberIntent(likeIntentById, id, isLiking);
      applyLikeState(id, isLiking);

      pendingLikeIds.add(id);
      const likePromise = isLiking
        ? supabase.from('likes').insert({ release_id: id, user_id: user.userId, username: user.username.replace('@', '') })
        : supabase.from('likes').delete().eq('release_id', id).eq('user_id', user.userId).select('release_id');

      likePromise.then(({ error }) => {
        if (error && !(isLiking && isDuplicateToggleError(error))) throw error;
      }).catch(err => {
        console.error('Like save/delete error:', err);
        if (isLiking) likedSet.delete(id);
        else likedSet.add(id);
        rememberIntent(likeIntentById, id, !isLiking);
        applyLikeState(id, !isLiking);
        showToast('Не удалось обновить лайк');
      }).finally(() => {
        pendingLikeIds.delete(id);
      });
    }

    // id релизов, чьи карточки уже хоть раз отрисованы — чтобы анимация
    // появления (cardPop) не проигрывалась повторно на каждом ре-рендере.
    const seenReleaseIds = new Set();
    const seenReviewIds = new Set();

    function renderReleaseCard(r, index) {
      const isLiked = likedSet.has(r.id);
      const fb = getFallbackImg(r.name);
      const firstPaint = !seenReleaseIds.has(r.id);
      seenReleaseIds.add(r.id);
      const enterCls = firstPaint ? 'card-enter ' : '';
      const enterStyle = firstPaint ? ` style="animation-delay: ${Math.min(index, 14) * 32}ms"` : '';
      const cachedAvg = toRatingNumber(avgRatingByRelId.get(r.id));
      const avgRating = cachedAvg > 0 ? cachedAvg.toFixed(1) : null;
      const ratingBadge = avgRating ? `<div class="rating-badge absolute top-2 left-2 bg-black/60 backdrop-blur-md text-white text-[11px] font-black px-2 py-0.5 rounded-lg flex items-center gap-1"><i data-lucide="star" class="w-3 h-3 text-amber-400 fill-amber-400"></i>${avgRating}</div>` : '';
      const isNew = lastSeenTs > 0 && (r.timestamp || 0) > lastSeenTs;
      const newBadge = isNew ? `<div class="absolute top-2 right-2 bg-red-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-md tracking-wider shadow-lg">НОВОЕ</div>` : '';
      return `<div data-act="open-release" data-id="${escapeHtml(r.id)}" tabindex="0" role="button" aria-label="Открыть релиз ${escapeHtml(r.name)} от ${escapeHtml(r.artist)}" class="${enterCls}card-press flex flex-col gap-2 w-full min-w-0 relative outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-[1.5rem]"${enterStyle}>
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
          bindEnterAnimations(grid);
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
      bindEnterAnimations(grid);
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
        const rating = toRatingNumber(rv.rating);
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

    // Морфинг: обложка нажатой карточки «вырастает» в обложку модалки релиза.
    // Призрак летит из ректа карточки к месту #rel-img, лист едет вверх позади.
    let coverMorphGhost = null;
    let coverMorphTimer = null;

    function clearCoverMorph() {
      if (coverMorphTimer) {
        clearTimeout(coverMorphTimer);
        coverMorphTimer = null;
      }
      if (coverMorphGhost) {
        coverMorphGhost.remove();
        coverMorphGhost = null;
      }
    }

    function revealReleaseCover(relImg) {
      if (!relImg) return;
      relImg.style.transition = 'opacity 0.4s var(--ios-glide)';
      relImg.style.opacity = '1';
      setTimeout(() => { relImg.style.transition = ''; }, 420);
    }

    function morphCoverFromCard(cardEl) {
      clearCoverMorph();
      if (!cardEl || prefersReducedMotion()) return false;
      const srcImg = cardEl.querySelector('img');
      if (!srcImg) return false;
      const from = srcImg.getBoundingClientRect();
      if (from.width < 4 || from.height < 4) return false;

      const m = document.getElementById('modal-release');
      const relImg = document.getElementById('rel-img');
      // Прячем #rel-img ДО снятия hidden: иначе один кадр видна
      // полноразмерная обложка в уже раскрытой шторке.
      relImg.style.transition = 'none';
      relImg.style.opacity = '0';
      m.classList.remove('hidden');
      const to = relImg.getBoundingClientRect();
      if (to.width < 4) return false;

      const ghost = document.createElement('img');
      ghost.src = srcImg.currentSrc || srcImg.src || relImg.src;
      ghost.alt = '';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.cssText = `position:fixed; left:${to.left}px; top:${to.top}px; width:${to.width}px; height:${to.height}px; object-fit:cover; border-radius:2rem; z-index:80; pointer-events:none; margin:0; opacity:1;`;
      ghost.style.transformOrigin = '0 0';
      const s = from.width / to.width;
      ghost.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})`;
      document.body.appendChild(ghost);
      coverMorphGhost = ghost;
      void ghost.offsetWidth;

      ghost.style.transition = 'transform 0.62s var(--ios-glide), opacity 0.4s var(--ios-glide)';
      ghost.style.transform = 'translate(0px, 0px) scale(1)';

      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        if (coverMorphTimer) {
          clearTimeout(coverMorphTimer);
          coverMorphTimer = null;
        }
        revealReleaseCover(relImg);
        ghost.style.opacity = '0';
        coverMorphTimer = setTimeout(() => {
          if (coverMorphGhost === ghost) {
            ghost.remove();
            coverMorphGhost = null;
          }
          coverMorphTimer = null;
        }, 400);
      };
      ghost.addEventListener('transitionend', (event) => {
        if (event.propertyName === 'transform') cleanup();
      });
      coverMorphTimer = setTimeout(cleanup, 800);
      return true;
    }

    function openRelease(id, sourceEl) {
      const rel = releasesById.get(id); if (!rel) return; activeReleaseId = id;
      const profileModal = document.getElementById('modal-profile');
      if (profileModal && !profileModal.classList.contains('hidden')) {
        closeModal('modal-profile', true);
      }
      const fb = getFallbackImg(rel.name);
      const relImg = document.getElementById('rel-img');
      relImg.src = rel.img || fb;
      relImg.onerror = function() { this.src = fb; };
      relImg.style.transition = 'none';
      relImg.style.opacity = '0';

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

      resetReviewInputs(); renderReviews();
      lockReleaseSheet();
      const morphed = morphCoverFromCard(sourceEl);
      openModal('modal-release');
      if (!morphed) revealReleaseCover(relImg);
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
      openModal('modal-confirm-review-delete');
    }

    async function executeDeleteReview() {
      if (!pendingReviewDelete) return;

      await ensureValidAuthSession();
      try {
        let { error } = await supabase.from('reviews').delete().eq('id', pendingReviewDelete);
        if (error && (error.code === '42501' || error.message?.includes('JWT') || error.message?.includes('auth'))) {
          await ensureValidAuthSession(true);
          const retry = await supabase.from('reviews').delete().eq('id', pendingReviewDelete);
          error = retry.error;
        }
        if (error) throw error;
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
      existingReviewForActiveRelease = getExistingReviewForRelease(activeReleaseId);
      reviewPublishBlocked = !!existingReviewForActiveRelease;
      updateReviewCharCount();
      refreshCatalogViews();
    }

    async function executeDeleteRelease() {
      if (!releaseToDelete) return;
      
      await ensureValidAuthSession();
      try {
        let { error } = await supabase.from('releases').delete().eq('id', releaseToDelete);
        if (error && (error.code === '42501' || error.message?.includes('JWT') || error.message?.includes('auth'))) {
          await ensureValidAuthSession(true);
          const retry = await supabase.from('releases').delete().eq('id', releaseToDelete);
          error = retry.error;
        }
        if (error) throw error;
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

      reviewPublishBlocked = true;
      updateReviewCharCount();

      const objectiveRating = getCriteriaAverage(selectedCriteria);
      const newRev = {
        id: genId(),
        relId: activeReleaseId,
        author: user.username,
        authorId: user.userId,
        authorUsername: cleanUsername(user.username),
        authorIsAdmin: user.isAdmin,
        reactionCount: 0,
        text: t,
        rating: objectiveRating,
        baseRating: Math.max(1, Math.min(10, Math.round(objectiveRating))),
        criteria: { ...selectedCriteria },
        objectiveRating,
        date: new Date().toLocaleDateString('ru-RU'),
        timestamp: Date.now()
      };

      try {
        const { data: created, error } = await rpcCreateWithOptionalId('create_review', {
          p_release_id: newRev.relId,
          p_text: newRev.text,
          p_base_rating: newRev.baseRating,
          p_criteria: newRev.criteria,
          p_id: newRev.id
        });
        if (error) throw error;
        newRev.author = created.author_display_name;
        newRev.authorId = created.author_id;
        newRev.authorUsername = created.author_username;
        newRev.rating = Number(created.rating);
        newRev.objectiveRating = Number(created.objective_rating);
        newRev.timestamp = Number(created.timestamp);
        reviews = adoptCreatedRecord(reviews, newRev.id, created.id, newRev);
        newRev.id = created.id;
      } catch(e) {
        console.error('Ошибка сохранения рецензии:', e);
        reviewPublishBlocked = false;
        updateReviewCharCount();
        showToast('Ошибка сохранения — попробуйте позже', 'error');
        return;
      }

      updateReviewsMap();

      existingReviewForActiveRelease = newRev;
      reviewPublishBlocked = true;
      document.getElementById('rev-text').value = '';
      seenReviewIds.add(newRev.id);
      renderReviews();
      updateReviewCharCount();
      refreshCatalogViews();
      showToast('Опубликовано!', 'success');
      pulseNewReview(newRev.id);
    }

    // Мягкая «пульсация» только что опубликованной карточки — сдержанный
    // фидбэк об успешной публикации вместо конфетти-салюта.
    function pulseNewReview(reviewId) {
      if (prefersReducedMotion()) return;
      const card = document.querySelector(`[data-review-id="${escapeCssString(reviewId)}"]`);
      if (!card) return;
      card.classList.add('review-card-pulse');
      card.addEventListener('animationend', () => card.classList.remove('review-card-pulse'), { once: true });
    }

    // Реакция «полезно» на рецензию — оптимистичный toggle с откатом при ошибке.
    async function toggleReviewReaction(reviewId) {
      if (!user.isAuthenticated) return showToast('Войдите через Telegram');
      if (user.isBlocked) return showToast('Ваш аккаунт заблокирован');
      const review = reviews.find(r => r.id === reviewId);
      if (!review) return;
      if (pendingReactionIds.has(reviewId)) return;

      const reacted = !reactedSet.has(reviewId);
      const apply = (on) => {
        if (on) { reactedSet.add(reviewId); review.reactionCount = (review.reactionCount || 0) + 1; }
        else { reactedSet.delete(reviewId); review.reactionCount = Math.max(0, (review.reactionCount || 0) - 1); }
      };
      apply(reacted);
      rememberIntent(reactionIntentById, reviewId, reacted);
      renderReviews();

      pendingReactionIds.add(reviewId);
      try {
        const reactionPromise = reacted
          ? supabase.from('review_reactions').insert({ review_id: reviewId, user_id: user.userId, username: user.username.replace('@', '') })
          : supabase.from('review_reactions').delete().eq('review_id', reviewId).eq('user_id', user.userId).select('review_id');

        const { error } = await reactionPromise;
        if (error && !(reacted && isDuplicateToggleError(error))) throw error;
        
        const { data: rev } = await supabase.from('reviews_view').select('reactionCount').eq('id', reviewId).maybeSingle();
        if (rev && typeof rev.reactionCount === 'number') {
          review.reactionCount = rev.reactionCount;
          renderReviews();
        }
      } catch (e) {
        console.error('Reaction error:', e);
        apply(!reacted);
        rememberIntent(reactionIntentById, reviewId, !reacted);
        renderReviews();
        showToast('Не удалось сохранить реакцию', 'error');
      } finally {
        pendingReactionIds.delete(reviewId);
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
        id: genId(),
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
        const { data: created, error } = await rpcCreateWithOptionalId('create_comment', {
          p_review_id: newComment.reviewId,
          p_text: newComment.text,
          p_id: newComment.id
        });
        if (error) throw error;
        comments = adoptCreatedRecord(comments, newComment.id, created.id, {
          ...newComment,
          id: created.id,
          author: created.author_display_name,
          authorId: created.author_id,
          authorUsername: created.author_username,
          timestamp: Number(created.timestamp)
        });
        updateCommentsMap();
        renderReviews();
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

    function requestDeleteComment(commentId, reviewId) {
      openConfirmAction({
        title: 'Удалить комментарий?',
        body: 'Комментарий будет удалён без возможности восстановления.',
        confirmText: 'Удалить',
        action: () => deleteComment(commentId, reviewId)
      });
    }

    // Удаление комментария — оптимистично, с откатом при ошибке.
    async function deleteComment(commentId, reviewId) {
      const removed = comments.find(c => c.id === commentId);
      if (!removed) return;
      comments = comments.filter(c => c.id !== commentId);
      updateCommentsMap();
      renderReviews();
      try {
        const { error } = await supabase.from('review_comments').delete().eq('id', commentId);
        if (error) throw error;
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
      container.innerHTML = relReviews.map((r, i) => {
        const rating = toRatingNumber(r.rating);
        const criteria = r.criteria ? ` · ${escapeHtml(formatCriteria(r.criteria))}` : '';
        const canDelete = reviewByUser(r, user.userId, user.username) || user.isAdmin;
        const reacted = reactedSet.has(r.id);
        const reactionCount = typeof r.reactionCount === 'number' ? r.reactionCount : 0;
        const reactBtn = `<button data-act="toggle-reaction" data-id="${escapeHtml(r.id)}" aria-label="Полезная рецензия" class="btn-press shrink-0 flex items-center gap-1 px-2 py-1 rounded-full transition-colors ${reacted ? 'bg-red-500/15 border border-red-500/25 text-red-400' : 'bg-white/5 border border-white/10 text-gray-400'}"><i data-lucide="thumbs-up" class="w-3 h-3"></i><span class="text-[10px] font-bold">${reactionCount}</span></button>`;
        const firstPaint = !seenReviewIds.has(r.id);
        seenReviewIds.add(r.id);
        const enterCls = firstPaint ? 'review-enter ' : '';
        const enterStyle = firstPaint ? ` style="animation-delay: ${Math.min(i, 8) * 28}ms"` : '';
        return `<div data-review-id="${escapeHtml(r.id)}" class="${enterCls}bg-white/5 rounded-2xl p-4 border border-white/5"${enterStyle}>
          <div class="flex justify-between items-center mb-2 gap-2"><button class="text-[13px] font-bold text-white cursor-pointer hover:text-red-500 transition-colors text-left outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-sm" data-act="open-profile" data-user="${escapeHtml(r.author)}" data-author-id="${escapeHtml(r.authorId == null ? '' : r.authorId)}" data-username="${escapeHtml(r.authorUsername || '')}">${escapeHtml(r.author)}</button><div class="flex items-center gap-2"><div class="text-white bg-red-600 px-2.5 py-0.5 rounded-lg font-black text-[11px]">${escapeHtml(rating)}</div>${canDelete ? `<button data-act="open-confirm-review-delete" data-id="${escapeHtml(r.id)}" data-rel="${escapeHtml(r.relId)}" aria-label="Удалить отзыв" class="btn-press w-7 h-7 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center"><i data-lucide=\"trash-2\" class=\"w-3.5 h-3.5\"></i></button>` : ''}</div></div>
          <p class="text-[13px] text-gray-300 leading-relaxed mb-2">${escapeHtml(r.text)}</p>
          <div class="flex items-center justify-between gap-2"><span class="text-[10px] text-gray-500 font-medium">${escapeHtml(r.date)}${criteria}</span>${reactBtn}</div>
          ${renderCommentsSection(r.id)}</div>`;
      }).join('') || `<div class="text-center py-4 text-[12px] text-gray-500">Отзывов пока нет</div>`;
      bindEnterAnimations(container);
      renderCriteriaChart(activeReleaseId);
      refreshIcons();
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
          const rating = toRatingNumber(r.rating);
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

      const chromeColor = isLight ? '#f2f2f7' : '#000000';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chromeColor);
      try {
        tg.setHeaderColor?.(chromeColor);
        tg.setBackgroundColor?.(chromeColor);
      } catch (_) {}

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

      if (!btnRef) {
        refreshIcons();
        return;
      }

      btnRef.classList.remove('border-white/10');
      btnRef.classList.add('scale-110');
      btnRef.classList.add(isLight ? 'border-black' : 'border-white');
      
      btnRef.innerHTML = `<i data-lucide="check" class="w-6 h-6 ${isLight ? 'text-black' : 'text-white'}"></i>`;
      refreshIcons();
    }

    refreshIcons();
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
          if (err || (value !== '#000000' && value !== '#f2f2f7')) return;
          const local = localStorage.getItem('xxii_theme');
          if (local === '#000000' || local === '#f2f2f7') return;
          localStorage.setItem('xxii_theme', value);
          applyTheme(value, false);
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

    // Первичная загрузка из Supabase и последующая Realtime-синхронизация.
    fetchDB().finally(() => { if (!document.hidden) startSyncLoop(); });
})();
