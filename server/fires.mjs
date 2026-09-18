// NASA FIRMS active-fire detections. A recipient's own MAP_KEY meters requests to their allowance
// (5,000 per 10 minutes); three world pulls every half hour is a rounding error against it.
export const FIRE_SOURCES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'];
const CONFIDENCE = { l: 0, n: 1, h: 2 };
export function parseFirmsCsv(text, source) {
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const columns = lines[0].split(',').map(c => c.trim()), col = name => columns.indexOf(name);
  const iLat = col('latitude'), iLon = col('longitude'), iFrp = col('frp'), iConf = col('confidence'), iDate = col('acq_date'), iTime = col('acq_time'), iDay = col('daynight');
  if (iLat < 0 || iLon < 0 || iDate < 0 || iTime < 0) throw new Error(`Unexpected FIRMS columns for ${source}`);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(','), lat = Number(f[iLat]), lon = Number(f[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const hhmm = String(f[iTime] ?? '').padStart(4, '0'), at = Date.parse(`${f[iDate]}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00Z`);
    if (!Number.isFinite(at)) continue;
    rows.push({ lat, lon, frp: Math.max(0, Number(f[iFrp]) || 0), confidence: CONFIDENCE[String(f[iConf] ?? '').trim().toLowerCase()[0]] ?? 1, at, night: String(f[iDay] ?? '').trim().toUpperCase() === 'N', source });
  }
  return rows;
}
// Three instruments see the same fire; keep the strongest detection per ~1 km cell so one blaze is one marker.
export function mergeFires(rowsBySource, now = Date.now()) {
  const cells = new Map();
  for (const rows of rowsBySource) for (const r of rows) {
    if (now - r.at > 172800000 || r.at > now + 3600000) continue;
    const key = `${Math.round(r.lat * 100)},${Math.round(r.lon * 100)}`, prior = cells.get(key);
    if (!prior || r.frp > prior.frp || (r.frp === prior.frp && r.at > prior.at)) cells.set(key, r);
  }
  const fires = [...cells.values()].sort((a, b) => b.frp - a.frp).slice(0, 150000)
    .map(r => [Number(r.lat.toFixed(3)), Number(r.lon.toFixed(3)), Number(r.frp.toFixed(1)), r.confidence, Number(((now - r.at) / 3600000).toFixed(1)), r.night ? 1 : 0, FIRE_SOURCES.indexOf(r.source)]);
  return { fetchedAt: new Date(now).toISOString(), source: 'NASA FIRMS · VIIRS 375 m', sources: FIRE_SOURCES, fires };
}
export function registerFires(app) {
  let snapshot = null, pending = null, retryAt = 0;
  app.get('/api/fires', async (_req, res) => {
    const key = process.env.FIRMS_MAP_KEY;
    if (!key) return res.status(503).json({ error: 'Add a NASA FIRMS map key in File > Settings (or FIRMS_MAP_KEY) to load active fires.' });
    if (snapshot && Date.now() - Date.parse(snapshot.fetchedAt) < 1800000) return res.json(snapshot);
    if (Date.now() < retryAt && snapshot) return res.json({ ...snapshot, stale: true });
    try {
      pending ??= (async () => {
        const pulls = await Promise.allSettled(FIRE_SOURCES.map(async source => {
          const r = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/world/1`, { headers: { 'User-Agent': 'AtmoWeatherGlobe/0.2' }, signal: AbortSignal.timeout(60000) });
          if (!r.ok) throw new Error(`FIRMS returned ${r.status}`);
          const text = await r.text();
          if (/invalid map key/i.test(text)) throw new Error('FIRMS rejected the map key');
          return parseFirmsCsv(text, source);
        }));
        const good = pulls.filter(p => p.status === 'fulfilled').map(p => p.value);
        if (!good.length) throw new Error(pulls[0].reason?.message || 'FIRMS unavailable');
        snapshot = mergeFires(good);
        return snapshot;
      })().catch(e => { retryAt = Date.now() + 120000; throw e; }).finally(() => { pending = null; });
      res.set('Cache-Control', 'no-store').json(await pending);
    } catch (e) {
      if (snapshot) return res.json({ ...snapshot, stale: true });
      res.status(502).json({ error: /map key/i.test(e.message) ? 'NASA FIRMS rejected the map key. Check it in File > Settings.' : 'NASA FIRMS is unavailable. No fire detections are being shown.' });
    }
  });
}
