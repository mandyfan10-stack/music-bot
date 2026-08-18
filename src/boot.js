// Ранний старт Mini App: снять сплэш Telegram, спрятать welcome
// у вернувшихся и применить тему до загрузки тяжёлых скриптов.
(function () {
  try {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (tg) {
      if (typeof tg.ready === 'function') tg.ready();
      if (typeof tg.expand === 'function') tg.expand();
    }
  } catch (_) {}

  try {
    if (localStorage.getItem('xxii_welcomed_v1') || localStorage.getItem('raper_welcomed_v1')) {
      document.documentElement.classList.add('is-returning');
    }
  } catch (_) {}

  function applyEarlyTheme() {
    try {
      var theme = localStorage.getItem('xxii_theme');
      if (theme !== '#000000' && theme !== '#f2f2f7') return;
      document.documentElement.style.setProperty('--bg-color', theme);
      document.documentElement.setAttribute('data-theme', theme === '#f2f2f7' ? 'light' : 'dark');
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', theme);
      if (document.body) document.body.classList.toggle('light-theme', theme === '#f2f2f7');
    } catch (_) {}
  }

  applyEarlyTheme();
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', applyEarlyTheme);
  }
})();
