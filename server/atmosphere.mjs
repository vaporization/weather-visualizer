import { cachedFetch, coordinates } from './data.mjs';
import { XMLParser } from 'fast-xml-parser';

export function parseOpticalPalette(xml) {
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
  const maps = parsed.ColorMaps?.ColorMap;
  const entries = (Array.isArray(maps) ? maps : [maps]).flatMap(m => { const e = m?.Entries?.ColorMapEntry; return Array.isArray(e) ? e : e ? [e] : []; });
  return entries.filter(e => e['@_transparent'] === 'false' && e['@_value']).map(e => {
    const bounds = String(e['@_value']).match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    return { rgb: String(e['@_rgb']).split(',').map(Number), value: bounds.length > 1 ? (bounds[0] + bounds[1]) / 2 : bounds[0] };
  }).filter(e => Number.isFinite(e.value));
}

// Cloud cover is published per pressure level with its own geopotential height, so the column can be
// resampled to true altitude instead of collapsing into three fixed slabs. Levels stop at 150 hPa
// (about 14 km): nothing above that is inside the rendered cloud shell.
export const CLOUD_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150];
// Surface and convective fields: cloud base, glaciation level, convective energy, and the winds at
// two levels whose difference is the shear that leans a growing column downwind.
export const SURFACE_FIELDS = ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'cloud_cover', 'visibility', 'temperature_2m', 'dew_point_2m', 'precipitation', 'snowfall', 'wind_speed_10m', 'wind_direction_10m', 'cape', 'boundary_layer_height', 'freezing_level_height', 'wind_speed_850hPa', 'wind_direction_850hPa', 'wind_speed_500hPa', 'wind_direction_500hPa'];
export function regionalGrid(lat, lon) {
  const points = [];
  const widthKm = 160;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) points.push({
    lat: Math.max(-89.8, Math.min(89.8, lat + (y - 2) * widthKm / 4 / 111.32)),
    lon: ((lon + (x - 2) * widthKm / 4 / (111.32 * Math.max(.08, Math.cos(lat * Math.PI / 180))) + 540) % 360) - 180,
  });
  return { points, widthKm };
}
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function normalizeMetars(reports, point, now = Date.now()) {
  const latest = new Map();
  for (const r of reports) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !r.icaoId || !Number.isFinite(r.obsTime)) continue;
    if (now - r.obsTime * 1000 > 3 * 3600000 || r.obsTime * 1000 > now + 600000) continue;
    if (!latest.has(r.icaoId) || latest.get(r.icaoId).obsTime < r.obsTime) latest.set(r.icaoId, r);
  }
  return [...latest.values()].map(r => ({
    id: r.icaoId, name: r.name, lat: r.lat, lon: r.lon, elevation: r.elev, observed: new Date(r.obsTime * 1000).toISOString(),
    distanceKm: Math.round(distanceKm(point, r) * 10) / 10, temperature: r.temp, dewpoint: r.dewp,
    windSpeed: r.wspd == null ? null : r.wspd * 1.852, windDirection: typeof r.wdir === 'number' ? r.wdir : null,
    visibilityKm: r.visib == null ? null : parseFloat(String(r.visib)) * 1.609344,
    visibilityAtLeast: String(r.visib).includes('+'), cover: r.cover,
    clouds: (r.clouds || []).map(c => ({ cover: c.cover, baseMetersAGL: typeof c.base === 'number' ? c.base * .3048 : null })), raw: r.rawOb,
  })).filter(r => r.distanceKm <= 150).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 16);
}

export function registerAtmosphereRoutes(app) {
  app.get('/api/atmosphere', async (req, res) => {
    let p;
    try { p = coordinates(req.query); } catch (e) { return res.status(400).json({ error: e.message }); }
    try {
      const { points, widthKm } = regionalGrid(p.lat, p.lon);
      const query = fields => new URLSearchParams({ latitude: points.map(q => q.lat.toFixed(4)).join(','), longitude: points.map(q => q.lon.toFixed(4)).join(','), hourly: fields.join(','), forecast_hours: '26', cell_selection: 'nearest', timezone: 'GMT' });
      const request = async fields => {
        const data = await cachedFetch(`https://api.open-meteo.com/v1/forecast?${query(fields)}`);
        if (!Array.isArray(data) || data.length !== 25 || !data[12].hourly?.time?.length) throw new Error('Incomplete regional model data');
        return data;
      };
      // Asking for every pressure level is a much larger request than the surface fields alone, and
      // the provider drops it when it is busy. Losing the column is worth far less than losing the
      // whole regional grid, so a failure falls back to the surface fields and says which arrived.
      let data, levels = CLOUD_LEVELS;
      try {
        data = await request([...SURFACE_FIELDS, ...CLOUD_LEVELS.map(l => `cloud_cover_${l}hPa`), ...CLOUD_LEVELS.map(l => `geopotential_height_${l}hPa`)]);
      } catch {
        data = await request(SURFACE_FIELDS);
        levels = [];
      }
      res.json({ widthKm, gridSize: 5, source: 'Open-Meteo', levels, points: points.map((q, i) => ({ ...q, elevation: data[i].elevation, hourly: data[i].hourly })) });
    } catch { res.status(502).json({ error: 'Layered atmosphere unavailable. Using the selected point forecast.' }); }
  });
  app.get('/api/observations', async (req, res) => {
    let p;
    try { p = coordinates(req.query); } catch (e) { return res.status(400).json({ error: e.message }); }
    try {
      const south = Math.max(-90, p.lat - 1.4), north = Math.min(90, p.lat + 1.4);
      const dx = Math.min(20, 1.8 / Math.max(.1, Math.cos(p.lat * Math.PI / 180)));
      const west = p.lon - dx, east = p.lon + dx;
      const boxes = west < -180 ? [[south, west + 360, north, 180], [south, -180, north, east]] : east > 180 ? [[south, west, north, 180], [south, -180, north, east - 360]] : [[south, west, north, east]];
      const data = (await Promise.all(boxes.map(box => cachedFetch(`https://aviationweather.gov/api/data/metar?${new URLSearchParams({ bbox: box.join(','), format: 'json', hours: '2' })}`)))).flat();
      res.json({ source: 'NOAA Aviation Weather Center', stations: normalizeMetars(data, p) });
    } catch { res.status(502).json({ error: 'Airport observations unavailable. Model data remains available.' }); }
  });
  let keyRefusedUntil = 0;
  const esriError = bytes => { try { const e = JSON.parse(new TextDecoder().decode(bytes.subarray(0, 400))).error; return `${e.code} ${e.message}`.trim(); } catch { return 'non-image response'; } };
  app.get('/api/tiles/:kind/:z/:x/:y', async (req, res) => {
    const { kind } = req.params; const z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.y);
    if (!['imagery', 'elevation'].includes(kind) || ![z, x, y].every(Number.isInteger) || z < 0 || z > (kind === 'imagery' ? 19 : 14) || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return res.status(400).json({ error: 'Invalid tile' });
    try {
      // A recipient's own ArcGIS key meters imagery to their free allowance; without one the public endpoint serves personal use.
      // A key Esri refuses (expired, revoked, missing the basemap privilege) falls back to the public endpoint for ten minutes at a time.
      const key = process.env.ESRI_API_KEY, keyed = !!key && Date.now() > keyRefusedUntil;
      const publicUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
      const elevationUrl = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
      let bytes;
      if (kind !== 'imagery') bytes = await cachedFetch(elevationUrl, true);
      else if (!keyed) bytes = await cachedFetch(publicUrl, true);
      else {
        // Esri answers a refused token either with an HTTP error or with a 200 whose body is a JSON error instead of a JPEG.
        let refusal = '';
        try { bytes = await cachedFetch(`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?token=${encodeURIComponent(key)}`, true); if (bytes[0] !== 0xff || bytes[1] !== 0xd8) refusal = esriError(bytes); }
        catch (e) { if (!/ 4(0[13]|98|99)$/.test(e.message)) throw e; refusal = e.message.slice(-3); }
        if (refusal) {
          keyRefusedUntil = Date.now() + 600000;
          console.warn(`Esri refused the ArcGIS API key (${refusal}); serving public imagery for ten minutes. Check the key's expiry and basemap privileges.`);
          bytes = await cachedFetch(publicUrl, true);
        }
      }
      res.set('Cache-Control', 'public, max-age=86400').type(kind === 'imagery' ? 'image/jpeg' : 'image/png').send(Buffer.from(bytes));
    } catch { res.status(502).json({ error: 'Terrain tile unavailable' }); }
  });
  app.get('/api/satellite-palette', async (_req, res) => {
    try { const bytes = await cachedFetch('https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_VIIRS_Cloud_Optical_Thickness.xml', true); res.json({ entries: parseOpticalPalette(new TextDecoder().decode(bytes)) }); }
    catch { res.status(502).json({ error: 'Satellite optical-thickness legend unavailable' }); }
  });
  app.get('/api/satellite/:date', async (req, res) => {
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || Date.parse(date) > Date.now() || Date.parse(date) < Date.now() - 8 * 86400000) return res.status(400).json({ error: 'Satellite date must be within the previous week' });
    try {
      const instrument = req.query.instrument === 'aqua' ? 'Aqua' : 'Terra';
      const params = new URLSearchParams({ SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.1.1', LAYERS: `MODIS_${instrument}_Cloud_Optical_Thickness`, STYLES: '', FORMAT: 'image/png', TRANSPARENT: 'TRUE', SRS: 'EPSG:4326', BBOX: '-180,-90,180,90', WIDTH: '2048', HEIGHT: '1024', TIME: date });
      const bytes = await cachedFetch(`https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params}`, true);
      if (bytes[0] !== 137 || bytes[1] !== 80) throw new Error('Satellite layer returned no image');
      res.set('Cache-Control', 'public, max-age=3600').type('image/png').send(Buffer.from(bytes));
    } catch { res.status(502).json({ error: 'Satellite imagery unavailable' }); }
  });
}
