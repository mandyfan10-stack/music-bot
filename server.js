const http = require('http');
const fs = require('fs');
const path = require('path');
const { cleanTrackTitle, parseArtistAndTitle, normalizeGenre } = require('./src/utils.js');

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

function parseYandexUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const result = {};
    const trackParam = url.searchParams.get('track');
    if (trackParam && /^\d+$/.test(trackParam)) result.track_id = trackParam;

    const parts = url.pathname.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === 'track' && i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
        result.track_id = parts[i + 1];
      }
      if (parts[i] === 'album' && i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
        result.album_id = parts[i + 1];
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

function yandexCoverUrl(coverUri) {
  if (!coverUri) return '';
  const uri = coverUri.replace('%%', '1000x1000');
  if (uri.startsWith('//')) return `https:${uri}`;
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  return `https://${uri}`;
}

async function handleParseLink(link) {
  const isYandex = link.includes('music.yandex.') || link.includes('yandex.ru/music');
  
  if (isYandex) {
    const ids = parseYandexUrl(link);
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
              const artists = (track.artists || []).map(a => a.name).filter(Boolean).join(', ');
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
              const artists = (album.artists || []).map(a => a.name).filter(Boolean).join(', ');
              const img = yandexCoverUrl(album.coverUri || album.ogImage || album.cover?.uri || '');
              return {
                artist: artists || 'Артист',
                name: cleanTrackTitle(album.title),
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
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
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { link } = JSON.parse(body || '{}');
        if (!link) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing link' }));
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

  let reqPath = decodeURIComponent(url.pathname);
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  const filePath = path.join(__dirname, reqPath);

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

server.listen(PORT, () => {
  console.log(`XXII SOUND local server is running at http://localhost:${PORT}`);
});
