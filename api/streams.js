export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const raw = 'https://raw.githubusercontent.com/noxrsmusic-source/my-live-stream/main/Fancode_hls_m3u8.Json';
  const response = await fetch(raw);
  const data = await response.json();

  res.status(200).json(data);
}
