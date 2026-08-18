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

  // 1. Если официальный SDK Telegram WebApp уже загружен — сохраняем его и НЕ перезаписываем!
  if (window.Telegram && window.Telegram.WebApp) {
    var twa = window.Telegram.WebApp;
    // Если нативный SDK не распарсил initData (например, при специфическом URL hash), помогаем ему:
    if (!twa.initData) {
      var hashData = parseHashInitData();
      if (hashData) {
        try {
          twa.initData = hashData;
          if (!twa.initDataUnsafe || Object.keys(twa.initDataUnsafe).length === 0) {
            twa.initDataUnsafe = parseInitDataUnsafe(hashData);
          }
        } catch (_) {}
      }
    }
    announceReady(twa);
    return;
  }

  // 2. Инициализируем фолбэк ТОЛЬКО если Telegram SDK отсутствует
  if (!window.Telegram) {
    window.Telegram = {};
  }

  var rawFallbackData = parseHashInitData();
  var unsafeFallbackData = parseInitDataUnsafe(rawFallbackData);

  window.Telegram.WebApp = {
    initData: rawFallbackData,
    initDataUnsafe: unsafeFallbackData,
    version: '7.0',
    platform: 'unknown',
    colorScheme: 'dark',
    themeParams: {},
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
})();