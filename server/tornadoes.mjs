const ENDPOINT = 'https://api.weather.gov/alerts/active?event=Tornado+Warning';
const lonDelta = (a, b) => ((a - b + 540) % 360) - 180;
const parameter = (p, name) => { const v = p?.parameters?.[name]; return Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'string' ? v : ''; };
// A warning carries the radar-identified storm cell as well as the warned area, in the shape
// "<time>...storm...294DEG...19KT...40.5,-85.61". DEG is the direction the cell comes from, so it
// travels towards DEG + 180; that is confirmed by successive updates for the same cell. This is the
// only position in the product that refers to the storm rather than to the county-shaped area.
export function parseStormMotion(text) {
  const m = /(\d{4}-\d{2}-\d{2}T[\d:]+[^.]*)\.\.\.storm\.\.\.(\d{1,3})DEG\.\.\.(\d{1,3})KT\.\.\.(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(String(text ?? ''));
  if (!m) return null;
  const at = Date.parse(m[1]), fromDeg = Number(m[2]), speedKt = Number(m[3]), lat = Number(m[4]), lon = Number(m[5]);
  if (!Number.isFinite(at) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (!Number.isFinite(fromDeg) || fromDeg > 360 || !Number.isFinite(speedKt) || speedKt > 120) return null;
  return { at: new Date(at).toISOString(), lat, lon, headingDeg: (fromDeg + 180) % 360, speedKmh: Math.round(speedKt * 1.852 * 10) / 10 };
}
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
    const detection = parameter(p, 'tornadoDetection').toUpperCase();
    warnings.push({
      id: String(p.id || feature.id || `${lat},${lon}`).slice(0, 120), area: String(p.areaDesc || 'Warned area').slice(0, 160),
      severity: String(p.severity || 'Severe'), observed: detection === 'OBSERVED' || (!detection && p.certainty === 'Observed'),
      detection: detection || 'UNSPECIFIED',
      damageThreat: parameter(p, 'tornadoDamageThreat').toUpperCase() || null,
      hail: parameter(p, 'maxHailSize') || null,
      motion: parseStormMotion(parameter(p, 'eventMotionDescription')),
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
