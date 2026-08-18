const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  cleanTrackTitle,
  parseArtistAndTitle,
  normalizeGenre,
  parseYandexMusicUrl,
  yandexCoverUrl,
  joinNames
} = require('./src/catalog-parse.js');

const PORT = process.env.PORT || 3000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

async function handleParseLink(link) {
  const ids = parseYandexMusicUrl(link);

  if (ids) {
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
      };

      if (ids.track_id) {
        const res = await fetch(`https://api.music.yandex.net/tracks/${ids.track_id}`, { headers });
        if (res.ok) {
          const data = await res.json();
          const track = data.result?.[0];
          if (track && track.title) {
            const album = track.albums?.[0] || {};
            const artists = joinNames(track.artists) || joinNames(album.artists) || joinNames(album.labels);
            const img = yandexCoverUrl(track.coverUri || track.ogImage || album.coverUri || album.ogImage || '');
            return {
              artist: artists || 'Артист',
              name: cleanTrackTitle(track.title),
              img: img,
              genre: normalizeGenre(track.genre || album.genre || '')
            };
          }
        }
      }

      if (ids.album_id) {
        const res = await fetch(`https://api.music.yandex.net/albums/${ids.album_id}/with-tracks`, { headers });
        if (res.ok) {
          const data = await res.json();
          const album = data.result || {};
          if (album.title) {
            const artists = joinNames(album.artists) || joinNames(album.labels);
            const img = yandexCoverUrl(album.coverUri || album.ogImage || album.cover?.uri || '');
            return {
              artist: artists || 'Артист',
              name: album.title,
              img: img,
              genre: normalizeGenre(album.genre || '')
            };
          }
        }
      }
    } catch (err) {
      console.warn('[Local Server] Yandex API fetch error:', err.message);
    }
  }

  // oEmbed / HTML Scraping fallback
  try {
    const oembedRes = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(link)}`);
    const oembedData = await oembedRes.json();
    if (!oembedData.error && oembedData.title) {
      const parsed = parseArtistAndTitle(oembedData.title, link);
      return {
        artist: parsed.artist || (oembedData.author_name ? oembedData.author_name.replace(/ - Topic/gi, '').trim() : 'Артист'),
        name: parsed.name || cleanTrackTitle(oembedData.title),
        img: oembedData.thumbnail_url || '',
        genre: ''
      };
    }
  } catch {}

  // Plain HTML fetch fallback
  try {
    const res = await fetch(link, {
      headers: {
        'User-Agent': 'TelegramBot (like TwitterBot)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    if (res.ok) {
      const html = await res.text();
      const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/i) || html.match(/<title>(.*?)<\/title>/i);
      const imgMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["'](.*?)["']/i);
      const title = titleMatch ? titleMatch[1] : '';
      let img = imgMatch ? imgMatch[1] : '';
      if (img.includes('avatars.yandex.net')) img = yandexCoverUrl(img);
      const parsed = parseArtistAndTitle(title, link);
      return {
        artist: parsed.artist || 'Артист',
        name: parsed.name || 'Релиз',
        img: img,
        genre: ''
      };
    }
  } catch {}

  return { artist: '', name: 'Релиз', img: '', genre: '' };
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API эндпоинт для локального тестирования парсинга
  if (url.pathname === '/api/parse-link' && req.method === 'POST') {
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 8192) {
        tooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });
    req.on('end', async () => {
      if (tooLarge) return;
      try {
        const { link } = JSON.parse(body || '{}');
        if (!link || typeof link !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing link' }));
        }
        let parsed;
        try { parsed = new URL(link); } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid link' }));
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Unsupported URL scheme' }));
        }
        const host = parsed.hostname.toLowerCase();
        const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
        const isPrivate = host === 'localhost' || host.endsWith('.localhost') ||
          host === '0.0.0.0' || host === '::1' || host === '[::1]' ||
          (ipv4 && (
            Number(ipv4[1]) === 10 || Number(ipv4[1]) === 127 || Number(ipv4[1]) === 0 ||
            (Number(ipv4[1]) === 169 && Number(ipv4[2]) === 254) ||
            (Number(ipv4[1]) === 172 && Number(ipv4[2]) >= 16 && Number(ipv4[2]) <= 31) ||
            (Number(ipv4[1]) === 192 && Number(ipv4[2]) === 168)
          ));
        if (isPrivate) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Private hosts are not allowed' }));
        }
        const data = await handleParseLink(link);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  let reqPath;
  try {
    reqPath = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad Request');
  }
  if (reqPath.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad Request');
  }
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  const root = path.resolve(__dirname);
  const filePath = path.resolve(root, '.' + reqPath);
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`XXII SOUND local server is running at http://127.0.0.1:${PORT}`);
});
