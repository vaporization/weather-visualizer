// AISStream pushes every position report worldwide over one websocket. The server keeps the newest
// report per vessel while the app is asking for them, and lets the socket go when it stops.
const STREAM = 'wss://stream.aisstream.io/v0/stream';
const POSITION_TYPES = new Set(['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport']);
export function aisTime(value, now = Date.now()) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(String(value ?? ''));
  const t = m ? Date.parse(`${m[1]}T${m[2]}Z`) : NaN;
  return Number.isFinite(t) && Math.abs(now - t) < 86400000 ? t : now;
}
// Folds one AISStream envelope into the vessel map; returns whether it carried a usable position.
export function ingestAis(vessels, statics, envelope, now = Date.now()) {
  const meta = envelope?.MetaData, type = envelope?.MessageType, body = envelope?.Message?.[type];
  const mmsi = String(meta?.MMSI ?? '').trim();
  if (!/^\d{7,9}$/.test(mmsi) || !body) return false;
  if (type === 'ShipStaticData') { statics.set(mmsi, { name: String(body.Name ?? '').trim(), type: Number(body.Type) || 0, destination: String(body.Destination ?? '').trim() }); const v = vessels.get(mmsi); if (v) Object.assign(v, statics.get(mmsi), { name: statics.get(mmsi).name || v.name }); return false; }
  if (!POSITION_TYPES.has(type)) return false;
  const lat = Number(meta?.latitude ?? body.Latitude), lon = Number(meta?.longitude ?? body.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return false;
  const heading = Number(body.TrueHeading), cog = Number(body.Cog), sog = Number(body.Sog), known = statics.get(mmsi);
  vessels.set(mmsi, {
    mmsi, lat, lon, cog: Number.isFinite(cog) && cog < 360 ? cog : null, sog: Number.isFinite(sog) && sog < 102.3 ? sog : null, heading: Number.isFinite(heading) && heading < 360 ? heading : null,
    name: String(meta?.ShipName ?? '').trim() || known?.name || '', type: known?.type ?? 0, destination: known?.destination ?? '', status: Number(body.NavigationalStatus), at: aisTime(meta?.time_utc, now),
  });
  return true;
}
export function vesselRows(vessels, now = Date.now(), limit = 30000) {
  const rows = [];
  for (const v of vessels.values()) if (now - v.at <= 1800000) rows.push(v);
  rows.sort((a, b) => b.at - a.at);
  return rows.slice(0, limit).map(v => [v.mmsi, Number(v.lat.toFixed(4)), Number(v.lon.toFixed(4)), v.cog, v.sog, v.heading, v.name.slice(0, 24), v.type, Math.round((now - v.at) / 1000)]);
}
export function registerVessels(app) {
  const vessels = new Map(), statics = new Map();
  let socket = null, opened = 0, lastAsked = 0, error = '', backoff = 5000, closer = null;
  const connect = () => {
    const key = process.env.AISSTREAM_API_KEY; if (!key || socket) return;
    error = '';
    const ws = new WebSocket(STREAM); socket = ws;
    ws.onopen = () => { opened = Date.now(); backoff = 5000; ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: [[[-90, -180], [90, 180]]], FilterMessageTypes: [...POSITION_TYPES, 'ShipStaticData'] })); };
    ws.onmessage = e => { try { const envelope = JSON.parse(typeof e.data === 'string' ? e.data : ''); if (envelope?.error) { error = String(envelope.error); ws.close(); } else ingestAis(vessels, statics, envelope); } catch { /* ignore a malformed frame */ } };
    ws.onerror = () => { error ||= 'AISStream connection failed'; };
    ws.onclose = () => { socket = null; if (Date.now() - lastAsked < 180000 && !/api key/i.test(error)) { setTimeout(connect, backoff); backoff = Math.min(60000, backoff * 2); } };
  };
  const trim = () => { const now = Date.now(); for (const [mmsi, v] of vessels) if (now - v.at > 1800000) vessels.delete(mmsi); if (vessels.size > 120000) for (const mmsi of [...vessels.keys()].slice(0, 20000)) vessels.delete(mmsi); };
  app.get('/api/vessels', (_req, res) => {
    if (!process.env.AISSTREAM_API_KEY) return res.status(503).json({ error: 'Add an AISStream API key in File > Settings (or AISSTREAM_API_KEY) to load ship positions.' });
    lastAsked = Date.now(); connect();
    if (closer) clearTimeout(closer);
    closer = setTimeout(() => { if (Date.now() - lastAsked >= 180000) { socket?.close(); socket = null; vessels.clear(); } }, 190000);
    trim();
    if (/api key/i.test(error)) return res.status(502).json({ error: 'AISStream rejected the API key. Check it in File > Settings.' });
    const rows = vesselRows(vessels);
    if (!rows.length && !socket) return res.status(502).json({ error: error || 'AISStream is unavailable. No ship positions are being shown.' });
    res.set('Cache-Control', 'no-store').json({ fetchedAt: new Date().toISOString(), source: 'AISStream', connected: !!socket && opened > 0, since: opened ? new Date(opened).toISOString() : null, warming: !!socket && Date.now() - opened < 20000, vessels: rows });
  });
}
