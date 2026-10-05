export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) return res.status(400).send('Missing url');

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const response = await fetch(target, {
      redirect: 'follow',   // ⚠️ IMPORTANT: redirect follow karo
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.fancode.com/',
        'Origin': 'https://www.fancode.com',
        'Accept': '*/*',
      },
    });

    const contentType = response.headers.get('content-type') || '';
    const finalUrl = response.url; // redirect ke baad ka final URL

    // Agar m3u8 playlist hai to rewrite karo
    if (target.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('application/vnd.apple')) {
      let text = await response.text();

      // Check karo ki asli m3u8 mila ya error page
      if (!text.includes('#EXTM3U')) {
        console.error('Not a valid m3u8. First 200 chars:', text.slice(0, 200));
        res.setHeader('Content-Type', 'text/plain');
        return res.status(502).send('Upstream ne valid m3u8 nahi diya. Ho sakta hai geo-blocked hai.');
      }

      const base = new URL(finalUrl);

      text = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Comment/tag lines me URLs hote hain (jaise #EXT-X-KEY:URI="...")
        if (trimmed.startsWith('#')) {
          return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
            try {
              const abs = new URL(uri, base).toString();
              return `URI="/api/proxy?url=${encodeURIComponent(abs)}"`;
            } catch {
              return match;
            }
          });
        }

        // Normal URL line
        try {
          const abs = new URL(trimmed, base).toString();
          return `/api/proxy?url=${encodeURIComponent(abs)}`;
        } catch {
          return line;
        }
      }).join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(text);
    }

    // .ts segment ya key file — binary pass through
    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(Buffer.from(buffer));

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Proxy error: ' + err.message);
  }
}
