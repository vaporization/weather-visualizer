import { CableLayer, type CableData } from './cables';
import { EarthquakeLayer, type QuakeData } from './earthquakes';
import { SatelliteLayer, type SatelliteData } from './satellites';
import { SiteLayer, type SiteData } from './sites';
import type { LayerSpec } from './types';
const utc = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) + ' UTC';
export const layerCatalog: LayerSpec[] = [
  {
    id: 'cables', name: 'Submarine cables', detail: 'TeleGeography routes and landings', url: '/data/cables.json', refreshMs: 0,
    attribution: { text: '© TeleGeography — submarinecablemap.com', href: 'https://www.submarinecablemap.com/' },
    note: 'Published route geometry, simplified to about 100 m. Cable positions at sea are approximate by design; landing points are the published sites. Snapshot data, not live status. CC BY-NC-SA 3.0.',
    create: () => new CableLayer(), describe: d => { const c = d as CableData; return `${c.cables.length} cables · ${c.landings.length} landing points · snapshot ${c.retrieved}`; },
  },
  {
    id: 'datacenters', name: 'Data centres', detail: 'OpenStreetMap telecom sites', url: '/data/datacenters.json', refreshMs: 0,
    attribution: { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
    note: 'Sites mapped in OpenStreetMap as data centres, drawn at their centroids. Coverage follows mapping effort, not the industry: an empty region means unmapped, not absent. ODbL.',
    create: () => new SiteLayer(0x7fd1ff), describe: d => `${(d as SiteData).sites.length.toLocaleString()} mapped sites`,
  },
  {
    id: 'dams', name: 'Dams & hydro plants', detail: 'OpenStreetMap power and water', url: '/data/dams.json', refreshMs: 0,
    attribution: { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
    note: 'Mapped dams; those tagged as power plants are drawn in amber. Rated output is shown only where mappers recorded it. Coverage follows mapping effort. ODbL.',
    create: () => new SiteLayer(0x9ec9e8, s => s.hydro ? 0xffc44d : undefined), describe: d => { const s = (d as SiteData).sites; return `${s.length} dams · ${s.filter(x => x.hydro).length} hydro plants`; },
  },
  {
    id: 'earthquakes', name: 'Earthquakes', detail: 'USGS · past 24 hours', url: '/api/earthquakes', refreshMs: 300000,
    attribution: { text: 'USGS Earthquake Hazards Program', href: 'https://earthquake.usgs.gov/earthquakes/feed/' },
    note: 'All reviewed and automatic events USGS published in the last day. Marker size follows magnitude; colour fades from red to amber with age. Automatic solutions can be revised. Global coverage varies with network density.',
    create: () => new EarthquakeLayer(), describe: d => { const q = d as QuakeData; const top = q.quakes.reduce((a, b) => (b.mag > a.mag ? b : a), q.quakes[0]); return q.quakes.length ? `${q.quakes.length} events · largest M${top.mag.toFixed(1)} ${top.place} · ${utc(q.fetchedAt)}` : `No events in the feed · ${utc(q.fetchedAt)}`; },
  },
  {
    id: 'satellites', name: 'Satellites', detail: 'CelesTrak elements · SGP4', url: '/api/satellites', refreshMs: 3600000,
    attribution: { text: 'CelesTrak', href: 'https://celestrak.org/' },
    note: 'Space stations, the brightest satellites, weather and GPS constellations, propagated on this machine from CelesTrak element sets. Positions are predictions from elements that can be hours old; not tracking data. Altitude is true to scale.',
    create: () => new SatelliteLayer(), describe: d => { const s = d as SatelliteData; return `${s.satellites.length} objects · elements ${utc(s.fetchedAt)}`; },
  },
];
