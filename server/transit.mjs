import { PbfReader } from 'pbf';
// Keyless, openly licensed GTFS-Realtime vehicle-position feeds. Each one is a public agency
// endpoint; the registry mirrors the one compiled by Gods Eye View (MIT) and keeps its terms.
export const TRANSIT_FEEDS = [
  { id: 'mbta', name: 'MBTA', region: 'Boston', url: 'https://cdn.mbta.com/realtime/VehiclePositions.pb', attribution: 'MBTA / MassDOT', href: 'https://www.mbta.com/developers/gtfs-realtime' },
  { id: 'capmetro', name: 'CapMetro', region: 'Austin', url: 'https://data.texas.gov/download/eiei-9rpf/application%2Foctet-stream', attribution: 'CapMetro — data.texas.gov', href: 'https://data.texas.gov/' },
  { id: 'metrotransit', name: 'Metro Transit', region: 'Minneapolis–St Paul', url: 'https://svc.metrotransit.org/mtgtfs/vehiclepositions.pb', attribution: 'Metro Transit — Metropolitan Council', href: 'https://svc.metrotransit.org/' },
  { id: 'hsl', name: 'HSL', region: 'Helsinki', url: 'https://realtime.hsl.fi/realtime/vehicle-positions/v2/hsl', attribution: 'HSL (CC BY 4.0)', href: 'https://www.hsl.fi/en/hsl/open-data' },
  { id: 'ovapi', name: 'OVapi', region: 'Netherlands', url: 'https://gtfs.ovapi.nl/nl/vehiclePositions.pb', attribution: 'OVapi / Stichting OpenGeo', href: 'https://gtfs.ovapi.nl/' },
  { id: 'entur', name: 'Entur', region: 'Norway', url: 'https://api.entur.io/realtime/v1/gtfs-rt/vehicle-positions', headers: { 'ET-Client-Name': 'weathervisualizer-transit' }, attribution: 'Entur (NLOD)', href: 'https://developer.entur.org/' },
  { id: 'translink', name: 'TransLink', region: 'South East Queensland', url: 'https://gtfsrt.api.translink.com.au/api/realtime/seq/VehiclePositions', attribution: 'TransLink — Queensland Government (CC BY 4.0)', href: 'https://translink.com.au/about-translink/open-data' },
];
// gtfs-realtime.proto field numbers: FeedMessage{1 header, 2 entity}, FeedHeader{3 timestamp},
// FeedEntity{4 vehicle}, VehiclePosition{1 trip, 2 position, 5 timestamp, 8 vehicle},
// TripDescriptor{5 route_id}, Position{1 lat, 2 lon, 3 bearing, 5 speed}, VehicleDescriptor{1 id, 2 label}.
const text = (pbf, max = 40) => { const s = pbf.readString(); return s.length > max ? s.slice(0, max) : s; };
export function decodeVehiclePositions(bytes, limit = 6000) {
  const feed = { timestamp: null, vehicles: [] };
  new PbfReader(bytes).readFields((tag, feed, pbf) => {
    if (tag === 1) pbf.readMessage((t, h, p) => { if (t === 3) h.timestamp = p.readVarint(); else p.skip(t === 0 ? 0 : p.type); }, feed);
    else if (tag === 2 && feed.vehicles.length < limit) {
      const entity = pbf.readMessage((t, e, p) => {
        if (t === 4) e.vehicle = p.readMessage((tv, v, pv) => {
          if (tv === 1) pv.readMessage((tt, trip, pt) => { if (tt === 5) trip.route = text(pt); else pt.skip(pt.type); }, v);
          else if (tv === 2) pv.readMessage((tp, pos, pp) => { if (tp === 1) pos.lat = pp.readFloat(); else if (tp === 2) pos.lon = pp.readFloat(); else if (tp === 3) pos.bearing = pp.readFloat(); else if (tp === 5) pos.speed = pp.readFloat(); else pp.skip(pp.type); }, v);
          else if (tv === 5) v.timestamp = pv.readVarint();
          else if (tv === 8) pv.readMessage((td, d, pd) => { if (td === 1) d.id = text(pd); else if (td === 2) d.label = text(pd); else pd.skip(pd.type); }, v);
          else pv.skip(pv.type);
        }, {});
        else p.skip(p.type);
      }, {});
      if (entity.vehicle) feed.vehicles.push(entity.vehicle);
    } else pbf.skip(pbf.type);
  }, feed);
  return feed;
}
export function normalizeTransit(feedId, decoded, now = Date.now()) {
  const rows = [];
  for (const v of decoded.vehicles) {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon) || Math.abs(v.lat) > 90 || Math.abs(v.lon) > 180 || (v.lat === 0 && v.lon === 0)) continue;
    const at = Number.isFinite(v.timestamp) && v.timestamp > 0 ? v.timestamp * 1000 : Number.isFinite(decoded.timestamp) ? decoded.timestamp * 1000 : now;
    if (now - at > 900000) continue;
    rows.push([feedId, String(v.label || v.id || '').slice(0, 24), Number(v.lat.toFixed(5)), Number(v.lon.toFixed(5)), Number.isFinite(v.bearing) ? Math.round(v.bearing) % 360 : null, Number.isFinite(v.speed) ? Math.round(v.speed * 3.6) : null, String(v.route || '').slice(0, 24), Math.max(0, Math.round((now - at) / 1000))]);
  }
  return rows;
}
export function registerTransit(app) {
  const cache = new Map(); let pending = null;
  const load = async () => {
    await Promise.allSettled(TRANSIT_FEEDS.map(async feed => {
      try {
        const r = await fetch(feed.url, { headers: { 'User-Agent': 'AtmoWeatherGlobe/0.2', ...(feed.headers || {}) }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(`${r.status}`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length > 12000000) throw new Error('feed too large');
        cache.set(feed.id, { at: Date.now(), rows: normalizeTransit(feed.id, decodeVehiclePositions(bytes)), error: '' });
      } catch (e) { const prior = cache.get(feed.id); cache.set(feed.id, { at: prior?.at ?? 0, rows: prior && Date.now() - prior.at < 300000 ? prior.rows : [], error: e.message }); }
    }));
  };
  app.get('/api/transit', async (_req, res) => {
    const newest = Math.max(0, ...[...cache.values()].map(c => c.at));
    try {
      if (Date.now() - newest > 15000) { pending ??= load().finally(() => { pending = null; }); await pending; }
      const feeds = TRANSIT_FEEDS.map(f => { const c = cache.get(f.id); return { id: f.id, name: f.name, region: f.region, attribution: f.attribution, href: f.href, count: c?.rows.length ?? 0, ok: !!c && !c.error, stale: !!c?.error && c.rows.length > 0 }; });
      const vehicles = TRANSIT_FEEDS.flatMap(f => cache.get(f.id)?.rows ?? []);
      if (!vehicles.length) return res.status(502).json({ error: 'No transit feed answered. No vehicles are being shown.' });
      res.set('Cache-Control', 'no-store').json({ fetchedAt: new Date().toISOString(), source: 'GTFS-Realtime agency feeds', feeds, vehicles });
    } catch { res.status(502).json({ error: 'Transit feeds unavailable.' }); }
  });
}
