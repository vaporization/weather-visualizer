import { coordinates } from './data.mjs';
export const POWER_RADIUS_KM = 60;
const lonDelta = (a, b) => ((a - b + 540) % 360) - 180;
const kmBetween = (a, b) => Math.hypot((b[0] - a[0]) * 111.32, lonDelta(b[1], a[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180));
// Voltage tags are free text ("110000;220000", "400 kV"); keep the highest circuit in kilovolts.
export function voltageKv(tag) {
  const values = String(tag ?? '').split(/[;/,]/).map(v => Number(String(v).replace(/[^\d.]/g, ''))).filter(v => Number.isFinite(v) && v > 0);
  if (!values.length) return null;
  const max = Math.max(...values);
  return max > 1000 ? Math.round(max / 1000) : Math.round(max);
}
export function normalizePower(data, center) {
  if (!Array.isArray(data?.elements) || data.remark) throw new Error('Incomplete power response');
  const lines = [], substations = [], plants = [], seen = new Set();
  let points = 0;
  for (const e of data.elements) {
    const id = `${e.type}/${e.id}`; if (seen.has(id)) continue; seen.add(id);
    const t = e.tags || {};
    if (/^(line|minor_line|cable)$/.test(t.power) && Array.isArray(e.geometry)) {
      const path = [];
      for (const g of e.geometry) {
        if (!Number.isFinite(g?.lat) || !Number.isFinite(g?.lon)) continue;
        const p = [Number(g.lat.toFixed(5)), Number(g.lon.toFixed(5))];
        if (!path.length || kmBetween(path[path.length - 1], p) >= .08) path.push(p);
      }
      if (path.length < 2 || points > 60000) continue;
      points += path.length;
      lines.push({ id, name: String(t.name || t.ref || '').slice(0, 80), kind: t.power === 'cable' ? 'cable' : t.power === 'minor_line' ? 'minor' : 'line', voltageKv: voltageKv(t.voltage), operator: String(t.operator || '').slice(0, 80), circuits: Number(t.circuits) || null, points: path });
      continue;
    }
    const at = e.center || e; if (!Number.isFinite(at.lat) || !Number.isFinite(at.lon)) continue;
    const site = { id, name: String(t.name || '').slice(0, 80), operator: String(t.operator || '').slice(0, 80), lat: Number(at.lat.toFixed(5)), lon: Number(at.lon.toFixed(5)) };
    if (t.power === 'substation' && substations.length < 2000) substations.push({ ...site, voltageKv: voltageKv(t.voltage), kind: String(t.substation || '').slice(0, 30) });
    else if (t.power === 'plant' && plants.length < 1000) plants.push({ ...site, source: String(t['plant:source'] || '').slice(0, 30), method: String(t['plant:method'] || '').slice(0, 30), output: String(t['plant:output:electricity'] || '').slice(0, 20) });
  }
  return { center, radiusKm: POWER_RADIUS_KM, lines, substations, plants, truncated: points > 60000, source: 'OpenStreetMap', fetchedAt: new Date().toISOString() };
}
export function registerPower(app) {
  const cache = new Map(), pending = new Map(); let busy = false, nextRequest = 0;
  app.get('/api/power', async (req, res) => {
    let p; try { p = coordinates(req.query); } catch (e) { return res.status(400).json({ error: e.message }); }
    p = { lat: Number(p.lat.toFixed(2)), lon: Number(p.lon.toFixed(2)) }; const key = `${p.lat},${p.lon}`, hit = cache.get(key);
    if (hit && Date.now() - hit.time < 86400000) return res.json(hit.data);
    if (!pending.has(key)) {
      if (busy || Date.now() < nextRequest) return res.status(503).json({ error: 'Power grid data is busy. Please retry shortly.' });
      busy = true;
      const around = `(around:${POWER_RADIUS_KM * 1000},${p.lat},${p.lon})`;
      // Lines come with geometry; substations and plants as centres so a fenced yard is one marker.
      const query = `[out:json][timeout:30][maxsize:67108864];way[power~"^(line|minor_line|cable)$"]${around};out geom;(node[power=substation]${around};way[power=substation]${around};node[power=plant]${around};way[power=plant]${around};);out center;`;
      pending.set(key, (async () => {
        const response = await fetch(process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'AtmoWeatherGlobe/0.2' }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(45000) });
        if (!response.ok) throw new Error(`Map provider ${response.status}`);
        const data = normalizePower(await response.json(), p); cache.set(key, { time: Date.now(), data }); if (cache.size > 24) cache.delete(cache.keys().next().value); return data;
      })().finally(() => { busy = false; nextRequest = Date.now() + 5000; pending.delete(key); }));
    }
    try { res.json(await pending.get(key)); } catch { res.status(502).json({ error: 'Power grid data is temporarily unavailable. Please retry.' }); }
  });
}
