const ENDPOINT = 'https://api.weather.gov/alerts/active?event=Tornado+Warning';
const lonDelta = (a, b) => ((a - b + 540) % 360) - 180;
// NWS publishes a warned area, never a funnel position: the centroid only anchors the rendering.
export function normalizeTornadoes(data, now = Date.now()) {
  if (!Array.isArray(data?.features)) throw new Error('Invalid alert feed');
  const warnings = [];
  for (const feature of data.features) {
    const p = feature?.properties;
    if (!p || p.event !== 'Tornado Warning' || p.messageType === 'Cancel') continue;
    const expires = Date.parse(p.expires), effective = Date.parse(p.effective);
    if (!Number.isFinite(expires) || expires <= now || !Number.isFinite(effective) || effective > now + 3600000) continue;
    const shape = feature.geometry?.type === 'Polygon' ? feature.geometry.coordinates?.[0]
      : feature.geometry?.type === 'MultiPolygon' ? feature.geometry.coordinates?.[0]?.[0] : null;
    const polygon = Array.isArray(shape) ? shape.filter(pt => Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1]) && Math.abs(pt[0]) <= 180 && Math.abs(pt[1]) <= 90).map(pt => [pt[0], pt[1]]) : null;
    if (!polygon || polygon.length < 3) continue;
    const lat = polygon.reduce((sum, pt) => sum + pt[1], 0) / polygon.length;
    const lon = ((polygon[0][0] + polygon.reduce((sum, pt) => sum + lonDelta(pt[0], polygon[0][0]), 0) / polygon.length + 540) % 360) - 180;
    warnings.push({
      id: String(p.id || feature.id || `${lat},${lon}`).slice(0, 120), area: String(p.areaDesc || 'Warned area').slice(0, 160),
      severity: String(p.severity || 'Severe'), observed: p.certainty === 'Observed',
      effective: new Date(effective).toISOString(), expires: new Date(expires).toISOString(), lat, lon, polygon,
    });
  }
  return { fetchedAt: new Date(now).toISOString(), source: 'NOAA/NWS active alerts', warnings: warnings.slice(0, 60) };
}
export function registerTornadoes(app) {
  let snapshot, pending, retryAt = 0;
  app.get('/api/tornadoes', async (_req, res) => {
    if (snapshot && Date.now() - Date.parse(snapshot.fetchedAt) < 45000) return res.json(snapshot);
    if (Date.now() < retryAt) return res.status(503).json({ error: 'Tornado warning feed temporarily unavailable; retrying shortly.' });
    try {
      pending ??= (async () => {
        const r = await fetch(ENDPOINT, { headers: { 'User-Agent': 'AtmoWeatherGlobe/0.2', Accept: 'application/geo+json' }, signal: AbortSignal.timeout(12000) });
        if (!r.ok) throw new Error(`NWS returned ${r.status}`);
        snapshot = normalizeTornadoes(await r.json());
        return snapshot;
      })().catch(e => { retryAt = Date.now() + 60000; throw e; }).finally(() => { pending = null; });
      res.set('Cache-Control', 'no-store').json(await pending);
    } catch { res.status(502).json({ error: 'NWS tornado warnings unavailable. No warned areas are being shown.' }); }
  });
}
