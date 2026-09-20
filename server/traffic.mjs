import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { coordinates, keyHint } from './data.mjs';
// TomTom traffic-flow vector tiles around the selected location. Segment speeds are real
// measurements; nothing here invents vehicles. Tiles cost against the recipient's own daily
// allowance, so they are cached two minutes and counted against a soft cap.
export const FLOW_ZOOM = 12, FLOW_REACH = 2;
const DAILY_CAP = Number(process.env.TOMTOM_DAILY_TILE_BUDGET) || 20000;
export function tileAt(lat, lon, z) {
  const n = 2 ** z, a = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
  return { x: Math.floor((lon + 180) / 360 * n), y: Math.floor((1 - Math.asinh(Math.tan(a)) / Math.PI) / 2 * n) };
}
export function tilesAround(lat, lon, z = FLOW_ZOOM, reach = FLOW_REACH) {
  const { x, y } = tileAt(lat, lon, z), n = 2 ** z, tiles = [];
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) { const ty = y + dy; if (ty >= 0 && ty < n) tiles.push({ z, x: ((x + dx) % n + n) % n, y: ty }); }
  return tiles;
}
// Mapbox Vector Tile "Traffic flow" layer → [level, closure, [[lat, lon], …]] per feature.
export function decodeFlow(bytes, z, x, y) {
  let layer;
  try { layer = new VectorTile(new PbfReader(bytes)).layers['Traffic flow']; } catch { return []; }
  if (!layer) return [];
  const segments = [];
  for (let i = 0; i < layer.length && segments.length < 6000; i++) {
    let feature, geometry;
    try { feature = layer.feature(i); geometry = feature.toGeoJSON(x, y, z).geometry; } catch { continue; }
    const p = feature.properties || {}, closure = p.road_closure === true || p.road_closure === 'true';
    const level = typeof p.traffic_level === 'number' && Number.isFinite(p.traffic_level) ? Math.min(1, Math.max(0, p.traffic_level)) : closure ? 0 : null;
    if (level === null) continue;
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const coords of lines) {
      const points = coords.filter(c => Number.isFinite(c?.[0]) && Number.isFinite(c?.[1])).map(([lon, lat]) => [Number(lat.toFixed(5)), Number(lon.toFixed(5))]);
      if (points.length > 1) segments.push([Number(level.toFixed(2)), closure ? 1 : 0, points, String(p.road_type || '').slice(0, 20)]);
    }
  }
  return segments;
}
export function registerTraffic(app) {
  const tiles = new Map(); let day = '', used = 0;
  const today = () => new Date().toISOString().slice(0, 10);
  app.get('/api/traffic', async (req, res) => {
    const key = process.env.TOMTOM_API_KEY;
    if (!key) return res.status(503).json({ error: `Add a free TomTom API key via ${keyHint('TOMTOM_API_KEY')} to load traffic flow.` });
    let p; try { p = coordinates(req.query); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (day !== today()) { day = today(); used = 0; }
    const wanted = tilesAround(p.lat, p.lon), segments = [], now = Date.now(); let fetched = 0, failed = 0, budgeted = false, refused = 0;
    let next = 0;
    await Promise.all(Array.from({ length: 5 }, async () => {
      while (next < wanted.length) {
        const t = wanted[next++], id = `${t.z}/${t.x}/${t.y}`, hit = tiles.get(id);
        if (hit && now - hit.at < 120000) { segments.push(...hit.segments); continue; }
        if (used >= DAILY_CAP) { budgeted = true; if (hit) segments.push(...hit.segments); continue; }
        try {
          used++; fetched++;
          const r = await fetch(`https://api.tomtom.com/traffic/map/4/tile/flow/relative/${id}.pbf?key=${encodeURIComponent(key)}`, { headers: { 'User-Agent': 'AtmoWeatherGlobe/0.2' }, signal: AbortSignal.timeout(12000) });
          if (r.status === 401 || r.status === 403 || r.status === 429) { refused = r.status; throw new Error(`refused ${r.status}`); }
          if (!r.ok) throw new Error(`tile ${r.status}`);
          const decoded = decodeFlow(new Uint8Array(await r.arrayBuffer()), t.z, t.x, t.y);
          tiles.set(id, { at: now, segments: decoded }); segments.push(...decoded);
          if (tiles.size > 400) tiles.delete(tiles.keys().next().value);
        } catch { failed++; if (hit) segments.push(...hit.segments); }
      }
    }));
    // TomTom answers an unknown key, a key without the Traffic products and a spent daily allowance alike, so say so.
    if (refused === 429) return res.status(502).json({ error: 'TomTom is rate-limiting this key; traffic resumes when the allowance resets.' });
    if (refused) return res.status(502).json({ error: `TomTom refused the key (HTTP ${refused}): it is mistyped, lacks the Traffic API products, or its daily allowance is spent. Check ${keyHint('TOMTOM_API_KEY')}.` });
    if (!segments.length && failed === wanted.length) return res.status(502).json({ error: 'TomTom traffic flow is unavailable. No congestion is being shown.' });
    res.set('Cache-Control', 'no-store').json({ fetchedAt: new Date(now).toISOString(), source: 'TomTom Traffic Flow', center: p, zoom: FLOW_ZOOM, tiles: wanted.length, fetched, failed, budget: { used, cap: DAILY_CAP, exhausted: budgeted }, segments: segments.slice(0, 40000) });
  });
}
