# Weather Visualizer — technical reference

Version 1.0 · September 2026

## Architecture

The React/TypeScript client renders a Three.js WebGL2 globe. An Express server supplies same-origin data endpoints and serves the production Vite bundle. The Windows Electron shell runs that server as a utility process bound to 127.0.0.1 on an automatically assigned port, then opens the app in a sandboxed browser window.

Camera frames reach the browser only through the local server's allowlisted proxy: the proxy looks the camera up in the cached agency list and fetches that list's URL, so no request can be directed at an address the caller supplies. Renderer Node integration is disabled and context isolation is enabled. The settings window exposes only two IPC operations (read contact / save contact), restricted to its own web contents. External web links open in the system browser. The backend exits when the desktop app quits. The app requires network access to upstream data and imagery providers.

## Source map

| Path | Responsibility |
|---|---|
| src/App.tsx | UI state, panels, forecasts and controls |
| src/GlobeScene.tsx | Three.js scene, camera and interaction integration |
| src/weatherShell.ts | Atmospheric/weather rendering |
| src/radar.ts | NOAA metadata and imagery atlas |
| server/index.mjs | Express entry point, point weather, search, storms, static serving |
| server/point-weather.mjs | Local weather retrieval and fallback caching |
| server/global-weather.mjs | Coarse global forecast field |
| server/atmosphere.mjs | Regional weather, METAR and satellite support; per-level cloud profile |
| server/radar.mjs | NOAA WMS metadata, images and legend |
| server/flights.mjs | Civilian flight filtering, freshness and provider requests |
| server/tornadoes.mjs | NWS tornado warning polygons, expiry filtering and centroids |
| src/tornado.ts | Warned-area outlines and the illustrative funnel rendering |
| server/earthquakes.mjs | USGS event feed normalisation and short cache |
| server/satellites.mjs | CelesTrak element-set proxy, hours-long cache, TLE parsing |
| server/fires.mjs | NASA FIRMS CSV parsing, per-cell merge across instruments, half-hour cache |
| server/vessels.mjs | AISStream websocket, newest report per vessel, idle disconnect |
| server/power.mjs | Regional Overpass query for lines, substations and plants; voltage parsing |
| server/transit.mjs | GTFS-Realtime feed registry and a field-number protobuf decoder |
| server/traffic.mjs | TomTom flow vector tiles around the selection, decoded to speed ratios; per-day tile budget |
| server/settings.mjs | Browser-mode provider-key entry: status without values, same-origin writes to `.env.local` |
| server/cctv.mjs | Agency camera lists, an allowlisted frame proxy, per-source normalisers |
| src/layers/ | Data-layer contract, catalogue and renderers (cables, sites, earthquakes, satellites) |
| scripts/ingest-datasets.mjs | Rebuilds the compact bundled datasets under public/data |
| server/roads.mjs | Overpass road/place retrieval |
| desktop/main.cjs | Desktop lifecycle, server startup, menus and settings |
| desktop/preload.cjs | Restricted settings bridge |
| tests | Node unit tests and browser interaction/render tests |

## Rendering and data interpretation

Earth uses a 6,371 km reference radius. Terrain is streamed with a camera-driven tile hierarchy, Mapzen Terrarium elevation and Esri imagery. Tile budgets and provider resolution constrain detail.

Tile selection covers everything inside the camera's horizon in every direction, not only the view frustum, so turning or looking behind does not wait for a fresh stream. Refinement is ordered by projected size, so the nearest terrain sharpens first and the remaining budget spreads outward. Render quality sets that budget (balanced 128, high 192, ultra 288 tiles); a wider budget raises GPU memory and the number of provider tile requests each installation makes. Level changes are continuous in both colour and shape. An arriving tile is drawn transparent on the surface it replaces and, over about 0.4 s, gains opacity while its vertices ease from that surface into its own (geomorphing); the tile beneath eases toward the arriving surface at the same rate, so the two coincide at every instant and neither can show through the other. A tile that is replaced while still appearing keeps appearing beneath its successor, so the composite never falls back toward the coarse globe during a continuous zoom. The coarse globe is cut away only beneath fully opaque tiles, and the cut list is sized to the whole budget where the GPU's uniform limit allows (otherwise the budget is capped at 128), so no transition exposes a gap and no opaque tile lacks a cut. Selection carries hysteresis: an existing split survives until it is clearly too fine and outranks a marginal newcomer for budget, and motion under 1% of altitude is ignored, so a parked or drifting camera does not churn its farthest tiles between levels. Tiles the camera leaves are retained, not discarded: returning within three minutes reuses them with no request, views overtaken mid-load keep their downloads, and retained tiles are dropped after three minutes unseen or when the retention limit is reached. Individual tile failures leave the coarse globe visible in that spot and are re-requested after 15 s; only a widely failing provider discards the view. Geographic coordinates are projected onto the globe; terrain elevation is not exaggerated. Imagery is not assumed to be current weather imagery.

Cloud rendering combines data fields with procedural geometry/detail across viewing scales. Global model cloud patterns remain independent of the clicked point, while regional data supports local interpretation and precipitation. Satellite clouds are dated observations. Neither source reconstructs exact real-world cloud geometry.

Selecting an NHC system renders procedural eyewall and rainband structure centred on the published storm position. The analyzed wind extent sizes those bands where extent polygons are available, otherwise advisory intensity does; the bands are an illustration of a real system's position and size, not observed cloud geometry. Terrain under a selected location is shaded by the regional cover field offset along the solar vector; the shading is a coarse regional approximation and is suppressed for synthetic studies, satellite view and storm rendering, where the field no longer describes what is drawn.

Data layers under **More data** follow one contract (`src/layers/types.ts`): a scene group, `setData`, a per-frame `update` and `dispose`, registered in `src/layers/catalog.ts` with the endpoint, refresh interval, attribution and a plain statement of what is and is not measured. Static layers (cables, data centres, dams) are bundled snapshots in `public/data`, rebuilt by `scripts/ingest-datasets.mjs`; their licenses are in `public/data/LICENSES.md` and `THIRD-PARTY.md`. Cable routes are drawn about 2 km above sea level so they read from orbit; they are not terrain-clamped on land. Satellite positions are SGP4 predictions from element sets that may be hours old, not tracking. Earthquake events include automatic solutions that USGS may later revise. Fire markers are 375 m thermal anomalies, not perimeters. Ship positions are self-reported AIS relayed by volunteer receivers, so coverage is coastal and receiver-dependent. The power grid is a regional layer: it follows the selected location and drapes its lines on the terrain by resampling every segment along the ground and lifting it by the local elevation, rebuilt whenever the terrain refines (`src/layers/lines.ts`, the same mechanism as the street overlay). Every marker layer answers hover and click through one inspector; glyph shape encodes category and the card states the record's provenance. A pick carries an anchor that re-reads its record, so a pinned card is repositioned every frame to the marker's current position (a ship's next report, a satellite's propagated point, an aircraft's estimated track), hides while that position is behind the globe or off-screen, and closes when the record disappears from the feed.

Tornado warnings are the NWS warned polygons. The funnel drawn inside a warned area is an illustration at approximate true scale, placed at the polygon centroid: the NWS publishes warned areas, never funnel positions, tracks or dimensions. Funnels are hidden above 220 km. Coverage is United States only.

The global GFS overview samples a 24 × 12 (15°) grid and approximately 27 hourly forecast steps. This is much coarser than a full native model grid. Regional requests sample 25 locations. Nearby recent METAR reports can inform present cloud-base estimates; they do not override future forecasts. Cloud layers, model heatmaps and wind use the selected forecast time.

NOAA radar images are projected geographically from a five-region atlas. WMS timestamps and bounds come from each provider's capabilities response. Radar is observed reflectivity, shown at the present time only. Local rain/snow particles are separate model-driven effects and are not derived as a full 3D volume from radar.

## HTTP endpoints

All endpoints are under `/api`. Consult their route modules for precise query validation and response fields.

| Endpoint | Purpose |
|---|---|
| /weather?lat=…&lon=… | Selected-location current/hourly model weather |
| /search?q=… | Place search |
| /storms | NHC active systems |
| /storms/:id/extent | Published wind extent polygons |
| /flights | Filtered fresh civilian flight positions |
| /tornadoes | Active NWS tornado warning polygons and their centroids |
| /earthquakes?feed=day | USGS events, normalised and ordered by magnitude |
| /satellites | CelesTrak element sets for the station, visual, weather and GPS groups |
| /fires | VIIRS detections from the last day, merged per ~1 km cell (needs `FIRMS_MAP_KEY`) |
| /vessels | Newest AIS report per vessel from the last 30 minutes (needs `AISSTREAM_API_KEY`) |
| /power?lat=…&lon=… | Power lines with geometry, substations and plants within 60 km |
| /transit | Vehicle positions from seven open agency feeds, decoded server-side |
| /traffic?lat=…&lon=… | Road-segment speed ratios and closures from 25 TomTom flow tiles at zoom 12 around the selection (needs `TOMTOM_API_KEY`) |
| /settings | GET: which provider keys are set (masked, never the value). POST (browser mode, same-origin JSON only): validate, apply live and merge into `.env.local` |
| /cctv | Camera positions from six agency lists |
| /cctv/:source/:id.jpg | Current still for a listed camera only; frames are never fetched for caller-supplied addresses |
| /radar | Region metadata, timestamps, bounds and image URLs |
| /radar/:id.png | Allowlisted NOAA reflectivity image at a validated time |
| /radar-legend | NOAA reflectivity legend |

`/api/atmosphere` returns a 5x5 grid of hourly columns. Alongside the surface fields it carries `cloud_cover_<level>hPa` and `geopotential_height_<level>hPa` for the fifteen levels in `CLOUD_LEVELS` (1000 to 150 hPa), plus `cape`, `boundary_layer_height`, `freezing_level_height` and winds at 850 and 500 hPa; the level list is echoed as `levels` so the client never guesses it. The client resamples each column onto 32 uniform altitude bins (`profileColumn`), reconciles it against the low/mid/high diagnostics so the result is never emptier than either view (`reconcileColumn`), and uploads a 5x5x32 single-channel volume texture the cloud shader samples at each ray's true altitude. Inside the regional box that column replaces the three fixed slabs, which had unreachable gaps at 4.25-4.8 km and 6.2-10 km. The hurricane study and an analyzed storm keep their own structure and opt out.

`stormShape` in `src/weather.ts` reads the advisory's wind-radii rings into geometry: rings are sorted by size rather than trusted to arrive in threshold order, the largest becomes the 34-knot shield with its four quadrant reaches kept separate, and the smallest of three becomes the hurricane-force radius that sets the eyewall. Eye size is not published in this feed and is inferred from intensity; `shieldMeasured` and `eyewallMeasured` record which is which so the interface can say so. The shader draws the storm as a body with height: eye and eyewall radius both grow with altitude, rainbands follow a logarithmic spiral turning with the hemisphere, and a cirrus canopy caps the top.

Additional routes: `/api/global-weather`, `/api/atmosphere`, `/api/observations`, `/api/roads`, `/api/tiles/:kind/:z/:x/:y`, `/api/satellite-palette`, and `/api/satellite/:date`. Requests validate coordinates and constrain provider paths. Failed upstream responses return explicit errors rather than synthetic live data. Cache and retry behavior varies by route.

### Cache/freshness highlights

- Global weather: approximately one-hour cache, batched upstream requests and retry backoff.
- Flights: 15-second snapshots, request coalescing and 60-second failure backoff; stale feed/position rejection.
- Radar: metadata about two minutes; image cache about five minutes; legend about 24 hours. Client marks scans over 20 minutes old delayed and hides scans over one hour old.
- Roads: approximately 24-hour cache, bounded results and concurrency.
- Tornado warnings: 45-second snapshots, request coalescing and 60-second failure backoff; expired and cancelled alerts are dropped. The client refreshes every minute.
- Earthquakes: five-minute cache; on provider failure the last good feed is returned marked `stale`.
- Satellites: element sets held for two hours and served stale on failure, per CelesTrak's request not to refetch on every load. Positions are propagated on the client with SGP4 every 200 ms.
- Fires: three world pulls every 30 minutes on the recipient's key, served stale for two minutes after a failure.
- Vessels: one websocket held while the layer is requested, closed three minutes after the last request; reports older than 30 minutes are dropped and at most 30,000 are served.
- Power grid: one Overpass request per 0.01° cell, cached 24 hours, paced five seconds apart; geometry thinned to 80 m and capped at 60,000 vertices.
- Transit: all seven feeds fetched together at most every 15 seconds; a feed that fails keeps its last rows for five minutes and is marked stale, then reports zero.
- Cameras: lists cached one hour; a frame is fetched on demand when a camera is pinned, cached 20 seconds, capped at 4 MB and required to be an image. Frames are never stored beyond that cache.
- Point weather: fallback values are explicitly marked cached; inspect returned metadata and UI age.

## Configuration and privacy

For source development, optional `.env.local` can define `FLIGHT_CONTACT`, `ESRI_API_KEY`, `FIRMS_MAP_KEY`, `AISSTREAM_API_KEY`, `TOMTOM_API_KEY`, `TOMTOM_DAILY_TILE_BUDGET` (default 20000), `PORT` and `OVERPASS_URL`. When running in a browser, the same keys can be entered under **Atmosphere → More data → Provider keys**: the page posts them to `/api/settings`, which accepts same-origin JSON only (checked via `Sec-Fetch-Site`/`Origin`), validates them with the same rules as the desktop settings window, applies them to the running process at once and merges them into `.env.local` (mode 0600). The endpoint only ever reports whether a key is set plus its last four characters. Vite is started with `envDir: false` so it neither exposes `.env.local` to the client nor restarts when it changes. Never commit or distribute local environment files. `npm run start` serves the production bundle, normally on loopback port 5173.

Desktop mode sets `WEATHER_DESKTOP=1`, skips `.env.local`, uses an ephemeral port and overrides inherited `FLIGHT_CONTACT` and `ESRI_API_KEY` with the user's saved settings. Settings are stored in `settings.json` under Electron's per-user application-data directory (`app.getPath('userData')`). The contact is not a secret API key: it identifies flight requests and is transmitted to ADSB.lol. It is stored as plain text locally. Each recipient supplies their own contact. The ArcGIS key is a real credential: with one set, imagery is requested from `ibasemaps-api.arcgis.com` and metered to that recipient's own ArcGIS Location Platform allowance (2 million tiles a month on the free tier); without one, the public `server.arcgisonline.com` endpoint is used, which Esri intends for personal use. The key is stored as plain text in settings.json and is never bundled. No centralized proxy or shared paid account is provisioned by this release.

Browser preferences are held in local storage. The desktop currently uses an ephemeral HTTP origin; browser preferences may not persist between launches when the port changes. The flight contact persists independently in settings.json. Provider requests disclose the requested geographic area and the network IP to those providers. The app does not provide an offline data archive.

## Build and development

Use Node.js 24 and npm on Windows. From the project directory:

```sh
npm ci
npm run dev
npm test
npm run build
npm run desktop
npm run package:win
```

`desktop` builds and starts Electron. `package:win` produces an NSIS x64 installer and unpacked application in `release/`. The installer is per-user and permits choosing the destination. No signing certificate is configured; this is an unsigned first release.

The package uses an explicit file allowlist: built frontend, server modules, desktop files, documentation, package metadata and production dependencies. It excludes environment files, development artifacts and local provider configuration. Rebuild after source changes; the running development site does not modify an already-built installer.

For browser tests, see `playwright.config.ts`; the current configuration targets an installed Chrome on Windows. Run `npm run test:browser` with the local app running. Hardware controller behavior and other operating systems require validation on those systems.

## Release verification

Before shipping a new release: build and run unit tests; smoke-test the packaged executable, local server and settings; check the archive for secrets/environment files; generate a SHA-256 checksum; verify layers and controls on a GPU-equipped Windows machine. Full installer/uninstaller behavior, signing and Windows reputation should be validated for a public release. Build artifacts alone do not demonstrate compatibility with every computer.

## Data sources and attribution

- Open-Meteo model weather/geocoding: https://open-meteo.com/
- NOAA Aviation Weather Center METAR: https://aviationweather.gov/
- NOAA/NCEP radar WMS: https://opengeo.ncep.noaa.gov/geoserver/www/index.html
- NOAA National Hurricane Center: https://www.nhc.noaa.gov/
- NOAA/NWS active alerts (tornado warnings): https://www.weather.gov/documentation/services-web-api
- USGS Earthquake Hazards Program feeds: https://earthquake.usgs.gov/earthquakes/feed/
- CelesTrak element sets: https://celestrak.org/
- Traffic cameras: TfL JamCams (Powered by TfL Open Data), Caltrans, City of Austin, Fintraffic/digitraffic.fi (CC BY 4.0), DriveBC (OGL-BC), Live Traffic NSW (CC BY 4.0); stills are public agency frames, credited on each camera
- GTFS-Realtime vehicle positions: MBTA/MassDOT, CapMetro (data.texas.gov), Metro Transit (Metropolitan Council), HSL (CC BY 4.0), OVapi/Stichting OpenGeo, Entur (NLOD), TransLink Queensland (CC BY 4.0); each feed's terms are recorded in `server/transit.mjs` and credited on every vehicle
- NASA FIRMS active fire data (recipient's own map key): https://firms.modaps.eosdis.nasa.gov/
- AISStream AIS relay (recipient's own key; beta service without formal terms): https://aisstream.io/
- TomTom Traffic Flow tiles (recipient's own key, free tier 2,500 tile requests a day; display requires the TomTom credit shown in the layer): https://developer.tomtom.com/
- TeleGeography Submarine Cable Map (CC BY-NC-SA 3.0, bundled): https://www.submarinecablemap.com/
- OpenStreetMap data-centre and dam extracts (ODbL, compiled by Gods Eye View, MIT): https://github.com/halfpixel/gods-eye-view
- NASA GIBS/MODIS satellite products: https://nasa-gibs.github.io/gibs-api-docs/
- Esri World Imagery: https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9
- Mapzen terrain: https://registry.opendata.aws/terrain-tiles/
- OpenStreetMap contributors / Overpass: https://www.openstreetmap.org/copyright
- ADSB.lol public flight data: https://www.adsb.lol/docs/open-data/api/

Keep the in-app source credits. Provider availability, usage limits and redistribution terms apply independently of the application. In particular, a working public endpoint is not a guarantee of unlimited usage by distributed installations. Reassess provider plans/permissions before broad commercial distribution. This release does not bundle provider data archives or a commercial data subscription.

Electron/Chromium license notices are included by the packager. Dependency license files remain with packaged dependencies. No project open-source license has been selected in this release.
