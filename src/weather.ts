export type Location = { lat: number; lon: number; name: string; region?: string };
export type Conditions = { temperature_2m: number; relative_humidity_2m: number; apparent_temperature: number; is_day: number; precipitation: number; rain: number; snowfall: number; weather_code: number; cloud_cover: number; pressure_msl: number; wind_speed_10m: number; wind_direction_10m: number; wind_gusts_10m: number; visibility?: number; time?: string };
export type Weather = { _meta?: { stale: boolean; fetchedAt: string }; current: Conditions; hourly: { [key: string]: any[]; time: string[] }; utc_offset_seconds: number };
export type Sample = { lat: number; lon: number } & Partial<Conditions>;
export type Storm = { id: string; name: string; classification: string; intensity: string; pressure: string; latitudeNumeric: number; longitudeNumeric: number; lastUpdate: string; publicAdvisory?: { url: string }; };
export type Layers = { clouds: boolean; precipitation: boolean; wind: boolean; grid: boolean };
export const places: Location[] = [
  { lat: 40.7128, lon: -74.006, name: 'New York', region: 'New York, United States' },
  { lat: 51.5074, lon: -0.1278, name: 'London', region: 'England, United Kingdom' },
  { lat: 35.6762, lon: 139.6503, name: 'Tokyo', region: 'Tokyo, Japan' },
  { lat: 1.3521, lon: 103.8198, name: 'Singapore', region: 'Singapore' },
  { lat: 64.1466, lon: -21.9426, name: 'Reykjavík', region: 'Iceland' },
];
export function description(code: number) {
  if (code === 0) return 'Clear skies';
  if (code < 3) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code < 50) return 'Foggy';
  if (code < 60) return 'Light drizzle';
  if (code < 70) return code >= 66 ? 'Freezing rain' : 'Rain';
  if (code < 80) return 'Snowfall';
  if (code < 85) return 'Rain showers';
  if (code < 90) return 'Snow showers';
  return 'Thunderstorms';
}
export function atHour(data: Weather, hour: number): Conditions {
  if (hour === 0) return data.current;
  const now = new Date(data.current.time + 'Z').getTime();
  const idx = data.hourly.time.findIndex(t => new Date(t + 'Z').getTime() >= now + hour * 3600000);
  if (idx < 0) return data.current;
  return Object.fromEntries(Object.entries(data.hourly).map(([key, values]) => [key, values[idx]])) as Conditions;
}
export async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Unable to load data');
  return data;
}
export function formatCoord(lat: number, lon: number) { return `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'}  /  ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`; }
// NHC publishes wind extent, not a cloud shield: the analyzed radius sizes the rendered bands.
export function stormExtentKm(storm: Storm | null, polygons: number[][][]) {
  if (!storm) return 220;
  const scale = 111.32 * Math.max(.05, Math.cos(storm.latitudeNumeric * Math.PI / 180));
  let radius = 0;
  for (const ring of polygons) for (const [lon, lat] of ring) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    radius = Math.max(radius, Math.hypot((((lon - storm.longitudeNumeric + 540) % 360) - 180) * scale, (lat - storm.latitudeNumeric) * 111.32));
  }
  if (radius > 5) return Math.min(900, radius * 2.6);
  const knots = Number.parseFloat(storm.intensity);
  return Number.isFinite(knots) ? Math.max(140, Math.min(420, 150 + knots)) : 220;
}
