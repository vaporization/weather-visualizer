const FEEDS = { hour: 'all_hour', day: 'all_day', week: '2.5_week', month: '4.5_month' };
export function normalizeQuakes(data, feed, now = Date.now()) {
  if (!Array.isArray(data?.features)) throw new Error('Invalid earthquake feed');
  const quakes = [];
  for (const f of data.features) {
    const p = f?.properties, c = f?.geometry?.coordinates;
    if (!p || !Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) continue;
    if (!Number.isFinite(p.mag) || !Number.isFinite(p.time) || p.time > now + 3600000) continue;
    quakes.push({ id: String(f.id || p.code || `${c[1]},${c[0]},${p.time}`).slice(0, 80), mag: Number(p.mag.toFixed(1)), depthKm: Number.isFinite(c[2]) ? Number(c[2].toFixed(1)) : 0, lat: c[1], lon: c[0], time: new Date(p.time).toISOString(), place: String(p.place || 'Unnamed location').slice(0, 120), tsunami: p.tsunami === 1 });
  }
  quakes.sort((a, b) => b.mag - a.mag);
  return { fetchedAt: new Date(now).toISOString(), source: 'USGS Earthquake Hazards Program', feed, quakes: quakes.slice(0, 4000) };
}
export function registerEarthquakes(app) {
  const cache = new Map();
  app.get('/api/earthquakes', async (req, res) => {
    const feed = FEEDS[String(req.query.feed || 'day')];
    if (!feed) return res.status(400).json({ error: 'Unknown earthquake feed' });
    const hit = cache.get(feed);
    if (hit && Date.now() - hit.at < 300000) return res.json(hit.data);
    try {
      const r = await fetch(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`, { headers: { 'User-Agent': 'AtmoWeatherGlobe/0.2' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`USGS returned ${r.status}`);
      const data = normalizeQuakes(await r.json(), feed);
      cache.set(feed, { at: Date.now(), data });
      res.set('Cache-Control', 'no-store').json(data);
    } catch {
      // Recent events are still useful for a while; say so rather than pretend they are current.
      if (hit) return res.json({ ...hit.data, stale: true });
      res.status(502).json({ error: 'USGS earthquake feed unavailable. No events are being shown.' });
    }
  });
}
