// Telegram WebApp SDK Helper & Resilient Fallback
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

  if (!window.Telegram) {
    window.Telegram = {};
  }

  var existing = window.Telegram.WebApp || {};
  var rawInitData = existing.initData || parseHashInitData();
  var parsedUnsafe = (existing.initDataUnsafe && Object.keys(existing.initDataUnsafe).length > 0)
    ? existing.initDataUnsafe
    : parseInitDataUnsafe(rawInitData);

  window.Telegram.WebApp = {
    initData: rawInitData,
    initDataUnsafe: parsedUnsafe,
    version: existing.version || '7.0',
    platform: existing.platform || 'unknown',
    colorScheme: existing.colorScheme || 'dark',
    themeParams: existing.themeParams || {},
    isExpanded: existing.isExpanded !== undefined ? existing.isExpanded : true,
    viewportHeight: existing.viewportHeight || window.innerHeight,
    viewportStableHeight: existing.viewportStableHeight || window.innerHeight,
    headerColor: existing.headerColor || '#000000',
    backgroundColor: existing.backgroundColor || '#000000',
    BackButton: existing.BackButton || {
      isVisible: false,
      onClick: function(cb) { this._cb = cb; return this; },
      offClick: function(cb) { this._cb = null; return this; },
      show: function() { this.isVisible = true; return this; },
      hide: function() { this.isVisible = false; return this; }
    },
    MainButton: existing.MainButton || {
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
    HapticFeedback: existing.HapticFeedback || {
      impactOccurred: function() {},
      notificationOccurred: function() {},
      selectionChanged: function() {}
    },
    ready: function() {
      if (typeof existing.ready === 'function') existing.ready();
    },
    expand: function() {
      if (typeof existing.expand === 'function') existing.expand();
    },
    close: function() {
      if (typeof existing.close === 'function') existing.close();
    },
    sendData: function(data) {
      if (typeof existing.sendData === 'function') existing.sendData(data);
    },
    openLink: function(url) {
      if (typeof existing.openLink === 'function') existing.openLink(url);
      else window.open(url, '_blank');
    },
    openTelegramLink: function(url) {
      if (typeof existing.openTelegramLink === 'function') existing.openTelegramLink(url);
      else window.open(url, '_blank');
    }
  };
})();