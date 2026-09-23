export type Location = { lat: number; lon: number; name: string; region?: string };
export type Conditions = { temperature_2m: number; relative_humidity_2m: number; apparent_temperature: number; is_day: number; precipitation: number; rain: number; snowfall: number; weather_code: number; cloud_cover: number; pressure_msl: number; wind_speed_10m: number; wind_direction_10m: number; wind_gusts_10m: number; visibility?: number; time?: string };
export type Weather = { _meta?: { stale: boolean; fetchedAt: string }; current: Conditions; hourly: { [key: string]: any[]; time: string[] }; utc_offset_seconds: number };
export type Sample = { lat: number; lon: number } & Partial<Conditions>;
export type Storm = { id: string; name: string; classification: string; intensity: string; pressure: string; latitudeNumeric: number; longitudeNumeric: number; lastUpdate: string; publicAdvisory?: { url: string }; movementDir?: number; movementSpeed?: number; };
// Everything the renderer needs to place a real storm. Radii are per compass quadrant because the
// advisory publishes them that way and most storms are genuinely lopsided; spin is the rotation
// direction, which is set by the hemisphere and was previously hard-coded northern.
export type StormShape = { lat: number; lon: number; eyeKm: number; eyewallKm: number; shieldKm: number; quadrantsKm: [number, number, number, number]; spin: 1 | -1; intensityKt: number; motionDeg: number; shieldMeasured: boolean; eyewallMeasured: boolean };
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
// The advisory publishes wind radii as rings at 34, 50 and 64 knots, each with its own reach in the
// four compass quadrants. Rings arrive in file order, so they are sorted by size rather than trusted
// to be in threshold order. Eye and eyewall are not published in this feed: they are inferred from
// the hurricane-force ring where there is one and from intensity otherwise, and are marked as such.
const QUADRANT_LABELS = ['NE', 'SE', 'SW', 'NW'] as const;
export function ringRadiiKm(centre: { lat: number; lon: number }, ring: number[][]): [number, number, number, number] {
  const scale = 111.32 * Math.max(.05, Math.cos(centre.lat * Math.PI / 180));
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (const [lon, lat] of ring) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const dy = (lat - centre.lat) * 111.32, dx = (((lon - centre.lon + 540) % 360) - 180) * scale;
    const quadrant = dy >= 0 ? (dx >= 0 ? 0 : 3) : (dx >= 0 ? 1 : 2);
    out[quadrant] = Math.max(out[quadrant], Math.hypot(dx, dy));
  }
  return out;
}
export function stormShape(storm: Storm | null, polygons: number[][][]): StormShape | null {
  if (!storm) return null;
  const centre = { lat: storm.latitudeNumeric, lon: storm.longitudeNumeric };
  const knots = Number.parseFloat(storm.intensity);
  const intensityKt = Number.isFinite(knots) ? knots : 35;
  const rings = polygons.map(ring => ringRadiiKm(centre, ring))
    .filter(q => Math.max(...q) > 5)
    .sort((a, b) => Math.max(...b) - Math.max(...a));
  const shieldMeasured = rings.length > 0;
  // Largest ring is the 34-knot shield; the smallest, when three are published, is hurricane force.
  const shieldQuadrants = rings[0] ?? ([0, 0, 0, 0] as [number, number, number, number]);
  const shieldKm = shieldMeasured ? Math.max(...shieldQuadrants) : Math.max(140, Math.min(420, 150 + intensityKt));
  const hurricaneRing = rings.length >= 3 ? rings[rings.length - 1] : null;
  const eyewallKm = hurricaneRing ? Math.max(12, Math.max(...hurricaneRing) * .55)
    : Math.max(14, Math.min(90, shieldKm * .26));
  // A stronger storm holds a tighter eye inside its eyewall; bounded so it never closes or gapes.
  const eyeKm = Math.max(6, Math.min(eyewallKm * .72, eyewallKm * (1 - Math.min(.55, intensityKt / 260))));
  const quadrantsKm = (shieldMeasured ? shieldQuadrants : [shieldKm, shieldKm, shieldKm, shieldKm]) as [number, number, number, number];
  return {
    lat: centre.lat, lon: centre.lon,
    eyeKm, eyewallKm, shieldKm, quadrantsKm,
    spin: centre.lat >= 0 ? 1 : -1, intensityKt,
    motionDeg: Number.isFinite(storm.movementDir as number) ? (storm.movementDir as number) : 0,
    shieldMeasured, eyewallMeasured: !!hurricaneRing,
  };
}
export function stormQuadrantSummary(shape: StormShape) {
  return QUADRANT_LABELS.map((label, i) => label + ' ' + Math.round(shape.quadrantsKm[i]) + ' km').join(' · ');
}
export function stormExtentKm(storm: Storm | null, polygons: number[][][]) {
  const shape = stormShape(storm, polygons);
  return shape ? Math.min(900, Math.max(120, shape.shieldKm * 1.7)) : 220;
}
