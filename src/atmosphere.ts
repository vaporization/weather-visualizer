import type { Conditions, Location } from './weather';
export type AtmosphericGrid = { gridSize: number; widthKm: number; levels?: number[]; points: { lat: number; lon: number; elevation: number; hourly: Record<string, any[]> & { time: string[] } }[] };
export type Station = { id: string; name: string; lat: number; lon: number; observed: string; distanceKm: number; elevation: number; visibilityKm: number | null; visibilityAtLeast: boolean; clouds: { cover: string; baseMetersAGL: number | null }[]; cover: string; raw: string };
export type AtmosphereState = { field: Uint8Array; profile: Uint8Array; profileAvailable: boolean; profileBins: number; profileTopKm: number; cape: number; shear: [number, number]; widthKm: number; low: number; mid: number; high: number; baseKm: number; thicknessKm: number; visibilityKm: number; rain: number; snow: number; wind: [number, number]; elevationKm: number; validTime: string; baseSource: string; station: Station | null; source: string; gridCount: number };
export type Quality = 'balanced' | 'high' | 'ultra';
export function hourlyIndex(times: string[], time: string | undefined, hour: number) {
  const requested = (time ? Date.parse(time + (time.endsWith('Z') ? '' : 'Z')) : Date.now()) + hour * 3600000;
  if (hour > 0) { const i = times.findIndex(t => Date.parse(t.endsWith('Z') ? t : t + 'Z') >= requested); return i < 0 ? Math.max(0, times.length - 1) : i; }
  let best = 0;
  times.forEach((t, i) => { if (Math.abs(Date.parse(t + 'Z') - requested) < Math.abs(Date.parse(times[best] + 'Z') - requested)) best = i; });
  return best;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const value = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
export const PROFILE_BINS = 32, PROFILE_TOP_KM = 16;
// Cloud cover against true altitude. Each pressure level carries its own geopotential height, so a
// column is placed where the model puts it instead of in fixed slabs, and a deep convective tower
// stays continuous from base to anvil. Returns cover 0..1 per uniform altitude bin above sea level.
export function profileColumn(levels: number[] | undefined, hourly: Record<string, any[]> | undefined, idx: number): Float32Array {
  const out = new Float32Array(PROFILE_BINS);
  const heights: number[] = [], covers: number[] = [];
  for (const level of levels ?? []) {
    const h = hourly?.[`geopotential_height_${level}hPa`]?.[idx], c = hourly?.[`cloud_cover_${level}hPa`]?.[idx];
    if (typeof h !== 'number' || !Number.isFinite(h) || typeof c !== 'number' || !Number.isFinite(c)) continue;
    heights.push(h / 1000); covers.push(clamp(c, 0, 100) / 100);
  }
  if (heights.length < 2) return out;
  const order = heights.map((_, i) => i).sort((a, b) => heights[a] - heights[b]);
  const hs = order.map(i => heights[i]), cs = order.map(i => covers[i]);
  for (let b = 0; b < PROFILE_BINS; b++) {
    const km = (b + .5) / PROFILE_BINS * PROFILE_TOP_KM;
    // Below the lowest level the nearest-surface value holds; above the highest there is no cloud.
    if (km <= hs[0]) { out[b] = cs[0]; continue; }
    if (km >= hs[hs.length - 1]) continue;
    let i = 1; while (i < hs.length && hs[i] < km) i++;
    out[b] = cs[i - 1] + (cs[i] - cs[i - 1]) * (km - hs[i - 1]) / Math.max(1e-6, hs[i] - hs[i - 1]);
  }
  return out;
}
// The model publishes two views of cloud that do not agree: per-level cover, which carries real
// vertical structure, and the low/mid/high diagnostics, which carry the amount but no shape. Neither
// contains the other — a point can report 100% low cloud with every pressure level at zero, or 90%
// at 300 hPa with the high diagnostic at zero. So the column keeps the profile's shape where it has
// any and is lifted to the diagnostic's amount where it does not, and never ends up below either.
// Band edges follow the provider's definition: low below 3 km, middle 3-8 km, high above 8 km.
const BANDS: [number, number, string][] = [[0, 3, 'cloud_cover_low'], [3, 8, 'cloud_cover_mid'], [8, 13, 'cloud_cover_high']];
export function reconcileColumn(column: Float32Array, hourly: Record<string, any[]> | undefined, idx: number, baseKm: number) {
  const binKm = PROFILE_TOP_KM / PROFILE_BINS;
  for (const [lowKm, highKm, key] of BANDS) {
    const diagnostic = clamp(value(hourly?.[key]?.[idx], 0), 0, 100) / 100;
    if (diagnostic <= .02) continue;
    const first = Math.floor(lowKm / binKm), last = Math.min(PROFILE_BINS, Math.ceil(highKm / binKm));
    let peak = 0;
    for (let b = first; b < last; b++) peak = Math.max(peak, column[b]);
    if (peak >= diagnostic) continue;
    if (peak > .05) { const gain = diagnostic / peak; for (let b = first; b < last; b++) column[b] = Math.min(1, column[b] * gain); continue; }
    // No shape to keep: fill the band as a deck, starting at the estimated base in the lowest one.
    const from = Math.max(first, Math.floor((lowKm > 0 ? lowKm : Math.min(baseKm, highKm - .5)) / binKm));
    for (let b = from; b < last; b++) column[b] = Math.max(column[b], diagnostic);
  }
  return column;
}
// One byte of cover per grid point per altitude bin, laid out for a 5 x 5 x bins volume texture.
export function buildProfileField(grid: AtmosphericGrid | null, idx: number, baseKm = 1.2): Uint8Array {
  const data = new Uint8Array(25 * PROFILE_BINS);
  if (!grid?.points?.length) return data;
  for (let i = 0; i < 25; i++) {
    const hourly = grid.points[i]?.hourly;
    const column = reconcileColumn(profileColumn(grid.levels, hourly, idx), hourly, idx, baseKm);
    for (let b = 0; b < PROFILE_BINS; b++) data[b * 25 + i] = Math.round(column[b] * 255);
  }
  return data;
}
// Wind direction is the direction the air comes from; this returns where it is going.
const towards = (speedKmh: number, fromDegrees: number): [number, number] => {
  const d = fromDegrees * Math.PI / 180;
  return [-Math.sin(d) * speedKmh, -Math.cos(d) * speedKmh];
};
// Deep-layer shear leans a growing column downwind. Direction and relative strength are the model's
// 850-to-500 hPa difference; the constant below sets how far that reads on screen, and is capped.
export function shearLean(hourly: Record<string, any[]> | undefined, idx: number): [number, number] {
  const low = towards(value(hourly?.wind_speed_850hPa?.[idx], 0), value(hourly?.wind_direction_850hPa?.[idx], 0));
  const high = towards(value(hourly?.wind_speed_500hPa?.[idx], 0), value(hourly?.wind_direction_500hPa?.[idx], 0));
  let east = (high[0] - low[0]) * .01, north = (high[1] - low[1]) * .01;
  const magnitude = Math.hypot(east, north);
  if (magnitude > .6) { east *= .6 / magnitude; north *= .6 / magnitude; }
  return [east, north];
}
export function buildAtmosphere(grid: AtmosphericGrid | null, stations: Station[], conditions: Conditions | null, currentTime: string | undefined, hour: number, demo = false): AtmosphereState {
  const center = grid?.points[12]; const idx = center ? hourlyIndex(center.hourly.time, currentTime, hour) : 0;
  const at = (key: string, fallback: number) => value(center?.hourly[key]?.[idx], fallback);
  const low = demo ? 70 : at('cloud_cover_low', conditions?.cloud_cover ?? 0);
  const mid = demo ? 25 : at('cloud_cover_mid', 0), high = demo ? 30 : at('cloud_cover_high', 0);
  const temperature = at('temperature_2m', conditions?.temperature_2m ?? 15);
  const dew = at('dew_point_2m', temperature - (100 - (conditions?.relative_humidity_2m ?? 70)) / 5);
  let baseKm = clamp((temperature - dew) * .125, .25, 3);
  let baseSource = 'Estimated from temperature / dew point';
  const station = !demo && hour === 0 ? stations.find(s => s.distanceKm <= 40 && s.clouds.some(c => c.baseMetersAGL !== null && ['FEW', 'SCT', 'BKN', 'OVC', 'OVX'].includes(c.cover))) ?? null : null;
  if (station) { baseKm = clamp(Math.min(...station.clouds.filter(c => c.baseMetersAGL !== null).map(c => c.baseMetersAGL!)) / 1000, .08, 10); baseSource = `${station.id} reported cloud base · ${station.distanceKm} km away`; }
  if (demo) { baseKm = 1.15; baseSource = 'Cloud study · synthetic'; }
  const field = new Uint8Array(5 * 5 * 4);
  for (let i = 0; i < 25; i++) {
    const h = grid?.points[i]?.hourly;
    field[i * 4] = Math.round(clamp(demo ? 70 : value(h?.cloud_cover_low?.[idx], low), 0, 100) * 2.55);
    field[i * 4 + 1] = Math.round(clamp(demo ? 25 : value(h?.cloud_cover_mid?.[idx], mid), 0, 100) * 2.55);
    field[i * 4 + 2] = Math.round(clamp(demo ? 30 : value(h?.cloud_cover_high?.[idx], high), 0, 100) * 2.55);
    field[i * 4 + 3] = Math.round(clamp(value(h?.precipitation?.[idx], conditions?.precipitation ?? 0) / 10, 0, 1) * 255);
  }
  const speed = (conditions?.wind_speed_10m ?? at('wind_speed_10m', 10)) / 3600;
  const direction = (conditions?.wind_direction_10m ?? at('wind_direction_10m', 0)) * Math.PI / 180;
  return { field, profile: buildProfileField(grid, idx, baseKm), profileAvailable: !demo && !!grid?.points?.length,
    profileBins: PROFILE_BINS, profileTopKm: PROFILE_TOP_KM,
    cape: demo ? 2200 : at('cape', 0), shear: demo ? [.18, .06] : shearLean(center?.hourly, idx),
    widthKm: grid?.widthKm ?? 160, low, mid, high, baseKm, thicknessKm: demo ? 2.7 : .8 + low / 100 * 1.8 + Math.min(1.5, (conditions?.precipitation ?? 0) * .18), visibilityKm: clamp((station && !station.visibilityAtLeast ? station.visibilityKm : null) ?? at('visibility', 40000) / 1000, .15, 100), rain: demo ? 12 : conditions?.precipitation ?? 0, snow: conditions?.snowfall ?? 0, wind: [-Math.sin(direction) * speed, Math.cos(direction) * speed], elevationKm: Math.max(0, center?.elevation ?? 0) / 1000, validTime: demo ? 'Synthetic' : center?.hourly.time[idx] ?? conditions?.time ?? '', baseSource, station, source: demo ? 'Synthetic cloud study' : grid ? '25-point regional model' : conditions ? 'Point model · regional data unavailable' : 'Waiting for weather data', gridCount: grid ? 25 : 1 };
}
export function solarDirection(location: Location, iso?: string): [number, number, number] {
  const date = iso && iso !== 'Synthetic' ? new Date(iso.endsWith('Z') ? iso : iso + 'Z') : new Date();
  const day = (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000;
  const decl = .4091 * Math.sin(2 * Math.PI * (day - 81) / 365);
  const lat = location.lat * Math.PI / 180;
  const hourAngle = ((date.getUTCHours() + date.getUTCMinutes() / 60 + location.lon / 15) - 12) * Math.PI / 12;
  return [-Math.cos(decl) * Math.sin(hourAngle), Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle), Math.sin(lat) * Math.cos(decl) * Math.cos(hourAngle) - Math.cos(lat) * Math.sin(decl)];
}
