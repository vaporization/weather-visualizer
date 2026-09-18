// CelesTrak asks that element sets be cached rather than re-pulled: they refresh a few times a day and
// throttle clients that fetch on every load, so groups are held for hours and served stale on failure.
export const SATELLITE_GROUPS = ['stations', 'visual', 'weather', 'gps-ops'];
const TLE_LINE = /^[12] \d{5}[A-Z ] /;
export function parseTle(text, group) {
  const lines = String(text).split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean), satellites = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const name = lines[i], line1 = lines[i + 1], line2 = lines[i + 2];
    if (!TLE_LINE.test(line1) || !TLE_LINE.test(line2) || line1[0] !== '1' || line2[0] !== '2' || line1.length < 69 || line2.length < 69) continue;
    if (line1.slice(2, 7) !== line2.slice(2, 7)) continue;
    satellites.push({ name: name.trim().slice(0, 40), group, line1, line2 }); i += 2;
  }
  return satellites;
}
export function registerSatellites(app) {
  const cache = new Map(); let pending = null;
  const load = async () => {
    const results = await Promise.allSettled(SATELLITE_GROUPS.map(async group => {
      const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, { headers: { 'User-Agent': 'AtmoWeatherGlobe/0.2' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`CelesTrak returned ${r.status}`);
      const parsed = parseTle(await r.text(), group);
      if (!parsed.length) throw new Error('No element sets');
      cache.set(group, { at: Date.now(), satellites: parsed });
    }));
    if (results.every(r => r.status === 'rejected') && !cache.size) throw new Error('CelesTrak unavailable');
  };
  app.get('/api/satellites', async (_req, res) => {
    const oldest = Math.min(...SATELLITE_GROUPS.map(g => cache.get(g)?.at ?? 0));
    try {
      if (Date.now() - oldest > 7200000) { pending ??= load().finally(() => { pending = null; }); await pending; }
      const seen = new Set(), satellites = [];
      for (const group of SATELLITE_GROUPS) for (const s of cache.get(group)?.satellites ?? []) { const id = s.line1.slice(2, 7); if (!seen.has(id)) { seen.add(id); satellites.push(s); } }
      const fetchedAt = new Date(Math.min(...SATELLITE_GROUPS.map(g => cache.get(g)?.at ?? Date.now()))).toISOString();
      res.set('Cache-Control', 'no-store').json({ fetchedAt, source: 'CelesTrak', groups: SATELLITE_GROUPS.filter(g => cache.has(g)), satellites });
    } catch { res.status(502).json({ error: 'CelesTrak element sets unavailable. No satellites are being shown.' }); }
  });
}
