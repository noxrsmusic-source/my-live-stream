export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) return res.status(400).send('Missing url');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const response = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.fancode.com/',
      },
    });

    const contentType = response.headers.get('content-type') || '';
    res.setHeader('Content-Type', contentType);

    if (target.includes('.m3u8') || contentType.includes('mpegurl')) {
      let text = await response.text();
      const base = new URL(target);

      text = text.split('\n').map(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return line;
        try {
          const abs = new URL(line, base).toString();
          return `/api/proxy?url=${encodeURIComponent(abs)}`;
        } catch {
          return line;
        }
      }).join('\n');

      return res.send(text);
    }

    const buffer = await response.arrayBuffer();
    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error(err);
    res.status(500).send('Proxy error');
  }
}
