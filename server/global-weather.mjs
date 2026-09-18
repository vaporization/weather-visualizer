import { cachedFetch } from './data.mjs';

export function globalPoints() {
  return Array.from({ length: 288 }, (_, i) => ({ lat: -82.5 + Math.floor(i / 24) * 15, lon: -172.5 + (i % 24) * 15 }));
}
const fields = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'precipitation', 'wind_speed_10m', 'wind_direction_10m', 'temperature_2m'];
export function validGlobalHourly(hourly, times) {
  return hourly?.time?.length === times.length && times.every((t, i) => hourly.time[i] === t) && fields.every(key => hourly[key]?.length === times.length && hourly[key].every(Number.isFinite));
}
let snapshot, pending, retryAfter = 0;
async function load() {
  const points = globalPoints(), results = new Array(points.length);
  const start = Math.floor(Date.now() / 3600000) * 3600000;
  const times = Array.from({length: 27}, (_, i) => new Date(start + i * 3600000).toISOString().slice(0,16));
  let next = 0;
  async function worker() {
    while (next < points.length) {
      const offset = next; next += 72;
      const batch = points.slice(offset, offset + 72);
      const params = new URLSearchParams({ latitude: batch.map(p => p.lat).join(','), longitude: batch.map(p => p.lon).join(','), hourly: fields.join(','), models: 'gfs_global', start_hour: times[0], end_hour: times.at(-1), timezone: 'GMT', cell_selection: 'nearest' });
      const data = await cachedFetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      if (!Array.isArray(data) || data.length !== batch.length || data.some(p => !validGlobalHourly(p.hourly, times))) throw new Error('Incomplete global model');
      data.forEach((p, i) => { results[offset + i] = p.hourly; });
    }
  }
  await worker();
  return { width: 24, height: 12, spacingDegrees: 15, fetchedAt: new Date(start).toISOString(), source: 'Open-Meteo · GFS', points: results };
}
export function registerGlobalWeather(app) {
  app.get('/api/global-weather', async (_req, res) => {
    if (snapshot && Date.now() - Date.parse(snapshot.fetchedAt) < 3600000) return res.json(snapshot);
    if (Date.now() < retryAfter) return res.status(503).json({ error: 'Global model temporarily unavailable' });
    try {
      pending ??= load().then(data => { snapshot = data; return data; }).catch(e => { console.warn('Global weather:', e.message); retryAfter = Date.now() + 60000; throw e; }).finally(() => { pending = null; });
      res.json(await pending);
    } catch { res.status(502).json({ error: 'Global model unavailable. Try again shortly.' }); }
  });
}
