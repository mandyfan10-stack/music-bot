// Telegram WebApp SDK fallback & polyfill
(function() {
  if (typeof window === 'undefined') return;
  if (!window.Telegram) {
    window.Telegram = {};
  }
  if (!window.Telegram.WebApp) {
    window.Telegram.WebApp = {
      initData: '',
      initDataUnsafe: {},
      version: '7.0',
      platform: 'web',
      colorScheme: 'dark',
      themeParams: {},
      isExpanded: true,
      viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 800,
      viewportStableHeight: typeof window !== 'undefined' ? window.innerHeight : 800,
      headerColor: '#000000',
      backgroundColor: '#000000',
      BackButton: {
        isVisible: false,
        onClick(callback) { this._cb = callback; return this; },
        offClick(callback) { this._cb = null; return this; },
        show() { this.isVisible = true; return this; },
        hide() { this.isVisible = false; return this; }
      },
      MainButton: {
        text: 'CONTINUE',
        color: '#ff0000',
        textColor: '#ffffff',
        isVisible: false,
        isActive: true,
        isProgressVisible: false,
        setText(t) { this.text = t; return this; },
        onClick(cb) { this._cb = cb; return this; },
        show() { this.isVisible = true; return this; },
        hide() { this.isVisible = false; return this; },
        enable() { this.isActive = true; return this; },
        disable() { this.isActive = false; return this; }
      },
      HapticFeedback: {
        impactOccurred(style) {},
        notificationOccurred(type) {},
        selectionChanged() {}
      },
      ready() {},
      expand() {},
      close() {},
      sendData(data) {},
      openLink(url) { window.open(url, '_blank'); },
      openTelegramLink(url) { window.open(url, '_blank'); }
    };
  }
})();
