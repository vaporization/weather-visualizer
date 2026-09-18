// Builds the compact static datasets under public/data from their upstream sources.
// TeleGeography files download from submarinecablemap.com; the OSM extracts are read
// from a local copy of Gods Eye View (MIT, github.com/halfpixel/gods-eye-view), whose
// authors compiled them. Run: node scripts/ingest-datasets.mjs [path-to-gods-eye-view]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve('public/data');
const reference = path.resolve(process.argv[2] ?? 'GodsEye FOR REFERENCE/gods-eye-view-main/gods-eye-view-main');
const local = (...p) => path.join(reference, 'src/data/local_data', ...p);
const round = (v, d) => Number(v.toFixed(d));
async function json(url, fallback) {
  try { return JSON.parse(await readFile(fallback, 'utf8')); } catch { /* fall through to download */ }
  const r = await fetch(url, { headers: { 'User-Agent': 'WeatherVisualizer ingest (dataset refresh)' } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}
function centroid(geometry) {
  const rings = geometry.type === 'Point' ? [[geometry.coordinates]] : geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.type === 'MultiPolygon' ? geometry.coordinates.map(p => p[0]) : geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
  const pts = rings.flat().filter(p => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
  if (!pts.length) return null;
  return [round(pts.reduce((s, p) => s + p[0], 0) / pts.length, 4), round(pts.reduce((s, p) => s + p[1], 0) / pts.length, 4)];
}
async function sites(file, pick) {
  const lines = (await readFile(local(file), 'utf8')).split('\n').filter(Boolean);
  const items = [];
  for (const line of lines) {
    const f = JSON.parse(line), c = centroid(f.geometry), t = f.properties?.tags ?? {};
    if (c) items.push({ lon: c[0], lat: c[1], ...pick(t) });
  }
  return items;
}
await mkdir(out, { recursive: true });
const cables = await json('https://www.submarinecablemap.com/api/v3/cable/cable-geo.json', local('telegeography_submarine_cables/cable-geo.json'));
const landings = await json('https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json', local('telegeography_submarine_cables/landing-point-geo.json'));
await writeFile(path.join(out, 'cables.json'), JSON.stringify({
  source: 'TeleGeography Submarine Cable Map', url: 'https://www.submarinecablemap.com/', license: 'CC BY-NC-SA 3.0', attribution: '© TeleGeography — submarinecablemap.com', retrieved: new Date().toISOString().slice(0, 10),
  cables: cables.features.map(f => ({ id: f.properties.id, name: f.properties.name, color: f.properties.color, lines: (f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates]).map(line => line.map(([lon, lat]) => [round(lon, 3), round(lat, 3)])) })),
  landings: landings.features.map(f => ({ id: f.properties.id, name: f.properties.name, lon: round(f.geometry.coordinates[0], 4), lat: round(f.geometry.coordinates[1], 4) })),
}));
await writeFile(path.join(out, 'datacenters.json'), JSON.stringify({
  source: 'OpenStreetMap contributors (telecom=data_centre extract compiled by Gods Eye View)', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors',
  sites: await sites('datacenters/datacenters.geojsonl', t => ({ name: t.name ?? t.operator ?? 'Data centre', operator: t.operator ?? t['operator:short'] ?? undefined })),
}));
await writeFile(path.join(out, 'dams.json'), JSON.stringify({
  source: 'OpenStreetMap contributors (waterway=dam / power=plant extract compiled by Gods Eye View)', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors',
  sites: await sites('dams/dams.geojsonl', t => ({ name: t.name ?? t['name:en'] ?? 'Dam', operator: t.operator ?? undefined, hydro: t.power === 'plant' || undefined, output: t['plant:output:electricity'] ?? undefined })),
}));
await writeFile(path.join(out, 'LICENSES.md'), `# Bundled dataset licenses

These files are data, not source code, and are **not** covered by the project's software license.

- \`cables.json\` — © TeleGeography, submarinecablemap.com, **CC BY-NC-SA 3.0**. Attribution required; non-commercial use only; adaptations stay under the same license. Remove this file, or obtain a TeleGeography license, before any commercial distribution.
- \`datacenters.json\`, \`dams.json\` — © OpenStreetMap contributors, **ODbL 1.0**. Attribution required; derived databases must be shared alike. Extracts were compiled by Gods Eye View (MIT, github.com/halfpixel/gods-eye-view) and reduced here to centroids and names.

Rebuild with \`node scripts/ingest-datasets.mjs\`.
`);
console.log(`cables ${cables.features.length}, landings ${landings.features.length} → public/data`);
