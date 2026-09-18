// Public traffic and road cameras from agencies that publish open camera lists with still-image
// URLs. Lists are cached for an hour; frames are proxied only for cameras in those lists, so the
// proxy can never be pointed at an arbitrary address. Registry derived from Gods Eye View (MIT).
const UA = { 'User-Agent': 'AtmoWeatherGlobe/0.2' };
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const ok = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
const clean = (s, max = 80) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
async function json(url, headers = {}) { const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json(); }
export const CCTV_SOURCES = [
  { id: 'tfl', name: 'TfL JamCams', region: 'London', attribution: 'Powered by TfL Open Data', href: 'https://tfl.gov.uk/info-for/open-data-users/', origin: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/',
    normalize: places => places.map(p => ({ id: clean(p.id, 60), name: clean(p.commonName), lat: num(p.lat), lon: num(p.lon), image: clean((p.additionalProperties || []).find(a => a.key === 'imageUrl')?.value, 300) })),
    load: async function () { return this.normalize(await json('https://api.tfl.gov.uk/Place/Type/JamCam')); } },
  { id: 'caltrans', name: 'Caltrans', region: 'California', attribution: 'Caltrans CCTV (public highway camera frames)', href: 'https://cwwp2.dot.ca.gov/', origin: 'https://cwwp2.dot.ca.gov/',
    normalize: payloads => payloads.flatMap(({ data }) => (data || []).map(({ cctv }) => cctv).filter(c => c && String(c.inService) === 'true').map(c => ({ id: clean(c.index ?? c.location?.locationName, 60), name: clean(c.location?.locationName), lat: num(c.location?.latitude), lon: num(c.location?.longitude), image: clean(c.imageData?.static?.currentImageURL, 300) }))),
    load: async function () { return this.normalize(await Promise.all(['3', '4', '7', '11'].map(d => json(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${d.padStart(2, '0')}.json`)))); } },
  { id: 'austin', name: 'Austin Transportation', region: 'Austin, TX', attribution: 'City of Austin Transportation & Public Works (public camera frames)', href: 'https://data.austintexas.gov/', origin: 'https://cctv.austinmobility.io/',
    normalize: rows => rows.filter(r => r.camera_status === 'TURNED_ON' && r.location?.coordinates).map(r => ({ id: clean(r.camera_id, 20), name: clean(r.location_name), lat: num(r.location.coordinates[1]), lon: num(r.location.coordinates[0]), image: `https://cctv.austinmobility.io/image/${encodeURIComponent(clean(r.camera_id, 20))}.jpg` })),
    load: async function () { return this.normalize(await json('https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=3000')); } },
  { id: 'fintraffic', name: 'Fintraffic weathercams', region: 'Finland', attribution: 'Fintraffic / digitraffic.fi (CC BY 4.0)', href: 'https://www.digitraffic.fi/en/road-traffic/', origin: 'https://weathercam.digitraffic.fi/',
    normalize: geo => (geo.features || []).map(f => { const preset = (f.properties?.presets || [])[0]; return { id: clean(preset?.id, 20), name: clean(f.properties?.name).replace(/^[a-z]+\d*_/, ''), lat: num(f.geometry?.coordinates?.[1]), lon: num(f.geometry?.coordinates?.[0]), image: preset ? `https://weathercam.digitraffic.fi/${encodeURIComponent(clean(preset.id, 20))}.jpg` : '' }; }),
    load: async function () { return this.normalize(await json('https://tie.digitraffic.fi/api/weathercam/v1/stations', { 'Digitraffic-User': 'weathervisualizer' })); } },
  { id: 'drivebc', name: 'DriveBC', region: 'British Columbia', attribution: 'DriveBC — Open Government Licence, British Columbia', href: 'https://www.drivebc.ca/', origin: 'https://www.drivebc.ca/images/',
    normalize: rows => rows.filter(r => r.is_on !== false && r.location?.coordinates).map(r => ({ id: clean(r.id, 20), name: clean(r.name), lat: num(r.location.coordinates[1]), lon: num(r.location.coordinates[0]), image: `https://www.drivebc.ca/images/${encodeURIComponent(clean(r.id, 20))}.jpg` })),
    load: async function () { return this.normalize(await json('https://www.drivebc.ca/api/webcams/')); } },
  { id: 'nsw', name: 'Live Traffic NSW', region: 'New South Wales', attribution: 'Live Traffic NSW — Transport for NSW (CC BY 4.0)', href: 'https://www.livetraffic.com/', origin: 'https://webcams.transport.nsw.gov.au/',
    normalize: geo => (geo.features || []).map(f => ({ id: clean(f.id ?? f.properties?.title, 60), name: clean(f.properties?.title), lat: num(f.geometry?.coordinates?.[1]), lon: num(f.geometry?.coordinates?.[0]), image: clean(f.properties?.href, 300) })),
    load: async function () { return this.normalize(await json('https://data.livetraffic.com/cameras/traffic-cam.json')); } },
];
const ID = /^[A-Za-z0-9._ -]{1,80}$/;
// Keeps only cameras with a real position and a frame URL on the source's own origin.
export function acceptCameras(source, cameras) {
  const seen = new Set(), out = [];
  for (const c of cameras) {
    if (!ID.test(c.id) || seen.has(c.id) || !ok(c.lat, c.lon) || !c.image.startsWith(source.origin)) continue;
    seen.add(c.id); out.push({ id: c.id, name: c.name || `${source.name} camera ${c.id}`, lat: Number(c.lat.toFixed(5)), lon: Number(c.lon.toFixed(5)), image: c.image });
    if (out.length >= 3000) break;
  }
  return out;
}
export function registerCctv(app) {
  const lists = new Map(), frames = new Map(); let pending = null;
  const load = async () => { await Promise.allSettled(CCTV_SOURCES.map(async s => { try { lists.set(s.id, { at: Date.now(), cameras: acceptCameras(s, await s.load()), error: '' }); } catch (e) { const prior = lists.get(s.id); lists.set(s.id, { at: prior?.at ?? 0, cameras: prior?.cameras ?? [], error: e.message }); } })); };
  app.get('/api/cctv', async (_req, res) => {
    const oldest = Math.min(...CCTV_SOURCES.map(s => lists.get(s.id)?.at ?? 0));
    try {
      if (Date.now() - oldest > 3600000) { pending ??= load().finally(() => { pending = null; }); await pending; }
      const sources = CCTV_SOURCES.map(s => { const l = lists.get(s.id); return { id: s.id, name: s.name, region: s.region, attribution: s.attribution, href: s.href, count: l?.cameras.length ?? 0, ok: !!l && !l.error }; });
      const cameras = CCTV_SOURCES.flatMap(s => (lists.get(s.id)?.cameras ?? []).map(c => [s.id, c.id, c.lat, c.lon, c.name]));
      if (!cameras.length) return res.status(502).json({ error: 'No camera list answered. No cameras are being shown.' });
      res.set('Cache-Control', 'no-store').json({ fetchedAt: new Date().toISOString(), source: 'Public agency camera lists', sources, cameras });
    } catch { res.status(502).json({ error: 'Camera lists unavailable.' }); }
  });
  app.get('/api/cctv/:source/:id.jpg', async (req, res) => {
    const source = CCTV_SOURCES.find(s => s.id === req.params.source), camera = source && ID.test(req.params.id) ? lists.get(source.id)?.cameras.find(c => c.id === req.params.id) : null;
    if (!camera) return res.status(404).json({ error: 'Unknown camera' });
    const key = `${source.id}/${camera.id}`, hit = frames.get(key);
    if (hit && Date.now() - hit.at < 20000) return res.set('Cache-Control', 'no-store').type(hit.type).send(hit.bytes);
    try {
      const r = await fetch(camera.image, { headers: UA, signal: AbortSignal.timeout(12000) });
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !type.startsWith('image/')) throw new Error(`frame ${r.status} ${type}`);
      const length = Number(r.headers.get('content-length') || 0); if (length > 4000000) throw new Error('frame too large');
      const bytes = Buffer.from(await r.arrayBuffer()); if (bytes.length > 4000000) throw new Error('frame too large');
      if (frames.size > 200) frames.delete(frames.keys().next().value);
      frames.set(key, { at: Date.now(), type, bytes });
      res.set('Cache-Control', 'no-store').type(type).send(bytes);
    } catch { res.status(502).json({ error: 'Camera frame unavailable' }); }
  });
}
