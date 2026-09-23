import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
const cache = new Map();
const pending = new Map();
export async function cachedFetch(url, binary = false) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < 600_000) return hit.data;
  if (pending.has(url)) return pending.get(url);
  const work = (async () => {
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000), headers: { 'User-Agent': 'AtmoWeatherGlobe/0.2' } });
  if (!response.ok) throw new Error(`Data provider returned ${response.status}`);
  let data;
  if (response.status === 204) data = [];
  else if (binary) data = new Uint8Array(await response.arrayBuffer());
  else {
    // A provider under load can answer 200 with a plain-text complaint instead of JSON.
    const text = await response.text();
    try { data = JSON.parse(text); } catch { throw new Error(`Data provider returned ${text.slice(0, 80)}`); }
  }
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(url, { time: Date.now(), data });
  return data;
  })();
  pending.set(url, work);
  try { return await work; } finally { pending.delete(url); }
}
// Desktop recipients use the Settings window; the web server reads .env.local at startup.
export const keyHint = name => process.env.WEATHER_DESKTOP ? 'File > Settings' : `Atmosphere > More data > Provider keys (or ${name} in .env.local)`;
export function coordinates(query) {
  const lat = Number(query.lat), lon = Number(query.lon);
  if (query.lat === undefined || query.lon === undefined || String(query.lat).trim() === '' || String(query.lon).trim() === '' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Valid latitude and longitude are required.');
  return { lat, lon };
}
export function extractPolygons(bytes) {
  const entry = Object.entries(unzipSync(bytes)).find(([name]) => name.endsWith('.kml'));
  if (!entry) return [];
  const xml = new XMLParser({ ignoreAttributes: false }).parse(strFromU8(entry[1]));
  const polygons = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.outerBoundaryIs?.LinearRing?.coordinates) {
      const ring = String(node.outerBoundaryIs.LinearRing.coordinates).trim().split(/\s+/).map(p => p.split(',').slice(0, 2).map(Number));
      if (ring.length > 2 && ring.every(p => p.length === 2 && p.every(Number.isFinite))) polygons.push(ring);
    }
    Object.values(node).forEach(v => Array.isArray(v) ? v.forEach(walk) : walk(v));
  }
  walk(xml);
  return polygons;
}
