#!/usr/bin/env node
// Сброс кэша Telegram WebView при деплое: в index.html собранного сайта
// ставит каждому локальному src/… вместо ручного ?v=N хэш содержимого файла.
// Запуск: node scripts/stamp-assets.js _site
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UNSTAMPED_PREFIXES = ['src/fonts/'];
const ASSET_REF = /(\s(?:src|href)=")(src\/[^"?#]+)(?:\?[^"#]*)?(")/g;

function contentHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 12);
}

function stampHtml(html, siteDir) {
  const missing = [];
  const stamped = html.replace(ASSET_REF, (match, prefix, assetPath, suffix) => {
    // Шрифты уже версионированы в имени файла, а preload должен совпадать с
    // url() из fonts.css байт в байт — иначе браузер скачает шрифт дважды.
    if (UNSTAMPED_PREFIXES.some((prefix_) => assetPath.startsWith(prefix_))) return match;
    const filePath = path.join(siteDir, assetPath);
    if (!fs.existsSync(filePath)) {
      missing.push(assetPath);
      return match;
    }
    return `${prefix}${assetPath}?v=${contentHash(filePath)}${suffix}`;
  });
  return { html: stamped, missing };
}

function stampSite(siteDir) {
  const indexPath = path.join(siteDir, 'index.html');
  const { html, missing } = stampHtml(fs.readFileSync(indexPath, 'utf8'), siteDir);
  if (missing.length) {
    throw new Error(`index.html references missing assets: ${missing.join(', ')}`);
  }
  fs.writeFileSync(indexPath, html);
  return html;
}

if (require.main === module) {
  const siteDir = process.argv[2];
  if (!siteDir) {
    console.error('Usage: node scripts/stamp-assets.js <site-dir>');
    process.exit(2);
  }
  const html = stampSite(path.resolve(siteDir));
  const count = (html.match(/\?v=[0-9a-f]{12}"/g) || []).length;
  console.log(`Stamped ${count} asset references in ${siteDir}/index.html`);
}

module.exports = { stampHtml, stampSite, contentHash };
