// Telegram WebApp SDK Safe Fallback
(function() {
  if (typeof window === 'undefined') return;

  function parseHashInitData() {
    var raw = '';
    try {
      var hash = window.location.hash || '';
      var search = window.location.search || '';
      var match = hash.match(/tgWebAppData=([^&]+)/) || search.match(/tgWebAppData=([^&]+)/);
      if (match && match[1]) {
        raw = decodeURIComponent(match[1]);
      }
    } catch (e) {
      console.warn('Error parsing tgWebAppData from URL:', e);
    }
    return raw;
  }

  function parseInitDataUnsafe(initDataStr) {
    var unsafe = {};
    if (!initDataStr) return unsafe;
    try {
      var sp = new URLSearchParams(initDataStr);
      for (var pair of sp.entries()) {
        var k = pair[0], v = pair[1];
        if (k === 'user' || k === 'receiver' || k === 'chat') {
          try {
            unsafe[k] = JSON.parse(v);
          } catch (_) {
            unsafe[k] = v;
          }
        } else if (k === 'auth_date' || k === 'can_send_after') {
          unsafe[k] = Number(v);
        } else {
          unsafe[k] = v;
        }
      }
    } catch (e) {
      console.warn('Error parsing initDataUnsafe:', e);
    }
    return unsafe;
  }

  function announceReady(twa) {
    if (!twa) return;
    try { if (typeof twa.ready === 'function') twa.ready(); } catch (_) {}
    try { if (typeof twa.expand === 'function') twa.expand(); } catch (_) {}
  }

  function hashParam(name) {
    try {
      var source = (window.location.hash || '').replace(/^#/, '');
      return new URLSearchParams(source).get(name) || '';
    } catch (_) {
      return '';
    }
  }

  // Официальный SDK мог не распарсить initData (специфичный hash) — помогаем.
  function patchInitData(twa) {
    if (!twa || twa.initData) return;
    var hashData = parseHashInitData();
    if (!hashData) return;
    try {
      twa.initData = hashData;
      if (!twa.initDataUnsafe || Object.keys(twa.initDataUnsafe).length === 0) {
        twa.initDataUnsafe = parseInitDataUnsafe(hashData);
      }
    } catch (_) {}
  }

  var SDK_URL = 'https://telegram.org/js/telegram-web-app.js';
  var READY_EVENT = 'xxii:telegram-sdk-ready';
  var state = window.__xxiiTelegramSdk = { loaded: false, failed: false, readyEvent: READY_EVENT };

  function markLoaded() {
    var twa = window.Telegram && window.Telegram.WebApp;
    if (!twa || twa.__xxiiFallback) {
      state.failed = true;
      return;
    }
    patchInitData(twa);
    announceReady(twa);
    state.loaded = true;
    try { window.dispatchEvent(new Event(READY_EVENT)); } catch (_) {}
  }

  // 1. Официальный SDK уже на странице (например, подключён синхронно) —
  // сохраняем его и НЕ перезаписываем.
  if (window.Telegram && window.Telegram.WebApp) {
    markLoaded();
    return;
  }

  // 2. Пока официальный SDK грузится асинхронно, ставим заглушку: initData
  // и версия берутся из hash, поэтому авторизация и первый экран не ждут
  // telegram.org. Когда SDK загрузится, он заменит window.Telegram.WebApp,
  // а app.js переподпишется по событию READY_EVENT.
  if (!window.Telegram) {
    window.Telegram = {};
  }

  function hashThemeParams() {
    try {
      var parsed = JSON.parse(hashParam('tgWebAppThemeParams') || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function colorSchemeFor(themeParams) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(themeParams.bg_color || ''));
    if (!m) return 'dark';
    var n = parseInt(m[1], 16);
    var luma = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    return luma > 127 ? 'light' : 'dark';
  }

  var fallbackThemeParams = hashThemeParams();
  var rawFallbackData = parseHashInitData();
  var unsafeFallbackData = parseInitDataUnsafe(rawFallbackData);

  window.Telegram.WebApp = {
    __xxiiFallback: true,
    initData: rawFallbackData,
    initDataUnsafe: unsafeFallbackData,
    version: hashParam('tgWebAppVersion') || '6.0',
    platform: hashParam('tgWebAppPlatform') || 'unknown',
    colorScheme: colorSchemeFor(fallbackThemeParams),
    themeParams: fallbackThemeParams,
    isExpanded: true,
    viewportHeight: window.innerHeight,
    viewportStableHeight: window.innerHeight,
    headerColor: '#000000',
    backgroundColor: '#000000',
    BackButton: {
      isVisible: false,
      onClick: function(cb) { this._cb = cb; return this; },
      offClick: function(cb) { this._cb = null; return this; },
      show: function() { this.isVisible = true; return this; },
      hide: function() { this.isVisible = false; return this; }
    },
    MainButton: {
      text: 'CONTINUE',
      color: '#ff0000',
      textColor: '#ffffff',
      isVisible: false,
      isActive: true,
      isProgressVisible: false,
      setText: function(t) { this.text = t; return this; },
      onClick: function(cb) { this._cb = cb; return this; },
      show: function() { this.isVisible = true; return this; },
      hide: function() { this.isVisible = false; return this; },
      enable: function() { this.isActive = true; return this; },
      disable: function() { this.isActive = false; return this; }
    },
    HapticFeedback: {
      impactOccurred: function() {},
      notificationOccurred: function() {},
      selectionChanged: function() {}
    },
    ready: function() {},
    expand: function() {},
    close: function() {},
    sendData: function() {},
    openLink: function(url) { window.open(url, '_blank'); },
    openTelegramLink: function(url) { window.open(url, '_blank'); }
  };

  announceReady(window.Telegram.WebApp);

  var script = document.createElement('script');
  script.src = SDK_URL;
  script.async = true;
  script.onload = markLoaded;
  script.onerror = function () { state.failed = true; };
  (document.head || document.documentElement).appendChild(script);
})();
