import { CableLayer, type CableData } from './cables';
import { EarthquakeLayer, type QuakeData } from './earthquakes';
import { SatelliteLayer, type SatelliteData } from './satellites';
import { SiteLayer, type SiteData } from './sites';
import { FireLayer, type FireData } from './fires';
import { VesselLayer, type VesselData } from './vessels';
import { PowerLayer, type PowerData } from './power';
import { TransitLayer, type TransitData } from './transit';
import { CctvLayer, type CctvData } from './cctv';
import { TrafficLayer, type TrafficData } from './traffic';
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
    create: () => new SiteLayer({ kind: 'Data centre (OpenStreetMap)', shape: 'square', color: 0x7fd1ff }), describe: d => `${(d as SiteData).sites.length.toLocaleString()} mapped sites`,
  },
  {
    id: 'dams', name: 'Dams & hydro plants', detail: 'OpenStreetMap power and water', url: '/data/dams.json', refreshMs: 0,
    attribution: { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
    note: 'Mapped dams; those tagged as power plants are drawn in amber. Rated output is shown only where mappers recorded it. Coverage follows mapping effort. ODbL.',
    create: () => new SiteLayer({ kind: 'Dam (OpenStreetMap)', shape: 'diamond', color: 0x9ec9e8, accent: s => s.hydro ? { color: 0xffc44d, kind: 'Hydroelectric plant (OpenStreetMap)' } : undefined }), describe: d => { const s = (d as SiteData).sites; return `${s.length} dams · ${s.filter(x => x.hydro).length} hydro plants`; },
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
  {
    id: 'power', name: 'Power grid', detail: 'OpenStreetMap · 60 km around selection', url: l => `/api/power?lat=${l.lat.toFixed(4)}&lon=${l.lon.toFixed(4)}`, refreshMs: 0,
    attribution: { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
    note: 'Transmission and distribution lines, substations and plants mapped in OpenStreetMap within 60 km of the selected location, draped on the terrain. Line colour follows recorded voltage (bright above 300 kV, amber above 100 kV, grey for minor or unknown). Coverage follows mapping effort; an unmapped region is blank, not unpowered. Lines appear below 2,500 km. ODbL.',
    create: () => new PowerLayer(), describe: d => { const p = d as PowerData; return `${p.lines.length.toLocaleString()} lines · ${p.substations.length} substations · ${p.plants.length} plants within ${p.radiusKm} km${p.truncated ? ' · trimmed' : ''}`; },
  },
  {
    id: 'transit', name: 'Transit vehicles', detail: 'GTFS-Realtime · 7 open agency feeds', url: '/api/transit', refreshMs: 15000,
    attribution: { text: 'Agency GTFS-Realtime feeds (credits per vehicle)', href: 'https://gtfs.org/documentation/realtime/reference/' },
    note: 'Live buses, trams, trains and ferries from agencies that publish open, keyless vehicle-position feeds: Boston, Austin, Minneapolis–St Paul, Helsinki, the Netherlands, Norway and South East Queensland. Only those regions are covered; everywhere else is simply not published, not empty. Each vehicle credits its agency.',
    create: () => new TransitLayer(), describe: d => { const t = d as TransitData; const live = t.feeds.filter(f => f.ok).length; return `${t.vehicles.length.toLocaleString()} vehicles · ${live}/${t.feeds.length} feeds answering · ${utc(t.fetchedAt)}`; },
  },
  {
    id: 'cctv', name: 'Traffic cameras', detail: 'Public agency stills · 6 regions', url: '/api/cctv', refreshMs: 3600000,
    attribution: { text: 'Agency camera feeds (credits per camera)', href: 'https://www.livetraffic.com/' },
    note: 'Road and traffic cameras whose agencies publish open camera lists: London (TfL), California (Caltrans), Austin, Finland (Fintraffic), British Columbia (DriveBC) and New South Wales. Click a camera to load its current still through this app; frames are fetched on demand, not recorded, and each carries the agency credit. Other regions are not published, not empty. Markers appear below 3,000 km.',
    create: () => new CctvLayer(), describe: d => { const c = d as CctvData; return `${c.cameras.length.toLocaleString()} cameras · ${c.sources.filter(s => s.ok).length}/${c.sources.length} lists answering`; },
  },
  {
    id: 'fires', name: 'Active fires', detail: 'NASA FIRMS · VIIRS · your key', url: '/api/fires', refreshMs: 1800000,
    attribution: { text: 'NASA FIRMS', href: 'https://firms.modaps.eosdis.nasa.gov/' },
    note: 'Thermal anomalies from the last day seen by three VIIRS instruments at 375 m, one marker per kilometre cell. A detection is a hot spot, not a fire perimeter; clouds hide fires, and gas flares and industry also register. Needs a free FIRMS map key in Settings.',
    create: () => new FireLayer(), describe: d => { const f = d as FireData; return `${f.fires.length.toLocaleString()} detections · ${utc(f.fetchedAt)}`; },
  },
  {
    id: 'vessels', name: 'Ships', detail: 'AIS via AISStream · your key', url: '/api/vessels', refreshMs: 15000,
    attribution: { text: 'AISStream', href: 'https://aisstream.io/' },
    note: 'Self-reported AIS positions relayed by volunteer receivers. Coverage is coastal and receiver-dependent: open ocean and quiet coasts are blank, not empty. Arrows point along the reported heading. Ships broadcast their own identity and class. Needs a free AISStream key in Settings.',
    create: () => new VesselLayer(), describe: d => { const v = d as VesselData; return v.warming ? `Connected · collecting reports (${v.vessels.length.toLocaleString()} so far)` : `${v.vessels.length.toLocaleString()} ships in the last 30 min · ${utc(v.fetchedAt)}`; },
  },
  {
    id: 'traffic', name: 'Traffic congestion', detail: 'TomTom flow · around selection · your key', url: l => `/api/traffic?lat=${l.lat.toFixed(3)}&lon=${l.lon.toFixed(3)}`, refreshMs: 120000,
    attribution: { text: '© TomTom Traffic', href: 'https://www.tomtom.com/products/traffic-apis/' },
    note: 'Measured road-segment speeds as a share of free-flow speed, drawn on the terrain around the selected location (about 20 km): green is moving freely, amber is slowing, red is at a crawl, dark is closed. These are aggregate speeds; no vehicle positions are shown or implied. Refreshes every two minutes and counts against the free daily tile allowance of your own TomTom key. Needs a free TomTom key in Settings.',
    create: () => new TrafficLayer(), describe: d => { const t = d as TrafficData; return `${t.segments.length.toLocaleString()} road segments · ${t.tiles} tiles${t.budget.exhausted ? ' · daily tile budget reached' : ''} · ${utc(t.fetchedAt)}`; },
  },
];
