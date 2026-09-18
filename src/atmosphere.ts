import type { Conditions, Location } from './weather';
export type AtmosphericGrid = { gridSize: number; widthKm: number; points: { lat: number; lon: number; elevation: number; hourly: Record<string, any[]> & { time: string[] } }[] };
export type Station = { id: string; name: string; lat: number; lon: number; observed: string; distanceKm: number; elevation: number; visibilityKm: number | null; visibilityAtLeast: boolean; clouds: { cover: string; baseMetersAGL: number | null }[]; cover: string; raw: string };
export type AtmosphereState = { field: Uint8Array; widthKm: number; low: number; mid: number; high: number; baseKm: number; thicknessKm: number; visibilityKm: number; rain: number; snow: number; wind: [number, number]; elevationKm: number; validTime: string; baseSource: string; station: Station | null; source: string; gridCount: number };
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
  return { field, widthKm: grid?.widthKm ?? 160, low, mid, high, baseKm, thicknessKm: demo ? 2.7 : .8 + low / 100 * 1.8 + Math.min(1.5, (conditions?.precipitation ?? 0) * .18), visibilityKm: clamp((station && !station.visibilityAtLeast ? station.visibilityKm : null) ?? at('visibility', 40000) / 1000, .15, 100), rain: demo ? 12 : conditions?.precipitation ?? 0, snow: conditions?.snowfall ?? 0, wind: [-Math.sin(direction) * speed, Math.cos(direction) * speed], elevationKm: Math.max(0, center?.elevation ?? 0) / 1000, validTime: demo ? 'Synthetic' : center?.hourly.time[idx] ?? conditions?.time ?? '', baseSource, station, source: demo ? 'Synthetic cloud study' : grid ? '25-point regional model' : conditions ? 'Point model · regional data unavailable' : 'Waiting for weather data', gridCount: grid ? 25 : 1 };
}
export function solarDirection(location: Location, iso?: string): [number, number, number] {
  const date = iso && iso !== 'Synthetic' ? new Date(iso.endsWith('Z') ? iso : iso + 'Z') : new Date();
  const day = (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000;
  const decl = .4091 * Math.sin(2 * Math.PI * (day - 81) / 365);
  const lat = location.lat * Math.PI / 180;
  const hourAngle = ((date.getUTCHours() + date.getUTCMinutes() / 60 + location.lon / 15) - 12) * Math.PI / 12;
  return [-Math.cos(decl) * Math.sin(hourAngle), Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle), Math.sin(lat) * Math.cos(decl) * Math.cos(hourAngle) - Math.cos(lat) * Math.sin(decl)];
}
