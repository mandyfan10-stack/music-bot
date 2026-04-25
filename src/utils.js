function cleanUsername(username) {
  if (!username) return '';
  return String(username).replace(/^@/, '').toLowerCase();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeJs(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function escapeJsHtml(str) {
  return escapeHtml(escapeJs(str));
}

function escapeCssString(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '\\D ')
    .replace(/\f/g, '\\C ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cleanUsername,
    escapeHtml,
    escapeJs,
    escapeJsHtml,
    escapeCssString
  };
}
