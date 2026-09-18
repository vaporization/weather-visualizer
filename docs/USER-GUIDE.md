# Weather Visualizer — feature guide

Version 1.0 · Windows x64 · September 2026

## Install and start

Run `Weather-Visualizer-1.0.0-x64-Setup.exe` and follow the installer. Launch **Weather Visualizer** from Start or the desktop shortcut. Node.js and a terminal are not required. Use Windows Settings → Apps to uninstall.

This first build is unsigned; Windows may show an unknown-publisher notice. Install only a copy you trust. Windows 10/11 x64, an internet connection, and working WebGL2 graphics drivers are required. A dedicated graphics card is recommended for higher quality. macOS, Linux, ARM64, and offline operation are not validated release targets.

The desktop shell is named Weather Visualizer; the globe currently retains the ATMO interface branding. Online layers may take time to load. Provider outages and coverage gaps are possible.

## Explore Earth

| Input | Action |
|---|---|
| Left drag | Move/orbit around Earth |
| Right drag | Pan |
| Hold middle mouse and drag | Look around |
| Mouse wheel | Zoom in/out |
| Click Earth | Select a location and load its weather |
| Search | Find a named place |
| Arrow keys | Move the view |
| + / − | Zoom |
| Enter | Select the center of the view |

Click the globe to focus keyboard navigation. Typing in form fields pauses navigation. Zooming after a selection approaches that location. Terrain and imagery load progressively as you approach the surface; detail varies by source and region.

### Camera controls

**Camera tilt** moves between overhead and horizon views. Automatic tilt begins below approximately 1.5 km above sea level and reaches full tilt near 0.5 km. **Lock camera tilt** preserves the chosen tilt during zoom. Manual look controls update the tilt display.

**Keep horizon level** corrects camera roll relative to the ground. **North-up compass lock** keeps north aligned toward the screen top; these orientation modes are mutually exclusive. The compass indicates north in the current view. Direction becomes ambiguous directly at a pole.

### Xbox / gamepad

Enable gamepad in View controls → Keyboard & controller. Connect a standard-mapped controller and press a button so the browser can detect it. Keep the app focused.

| Control | Action |
|---|---|
| Left stick | Move over Earth |
| Right stick | Look around |
| LT / RT | Zoom out / in |
| A | Select screen center |
| B | Reset view |
| Y | Toggle Keep horizon level |

Nonstandard controllers may not map correctly. The application uses the browser Gamepad API; connection and focus affect availability.

## Weather layers

- **Local conditions:** selected-location temperature, feels-like temperature, humidity, wind, precipitation and cloud cover. Switch °C/°F in this panel. These are model values, not a guaranteed observation at the exact clicked point.
- **Forecast:** scrub or play the next 24 hours. Forecast clouds, model heatmaps and wind respond to the selected time. Live flights remain at the present time.
- **Weather display:** choose Natural atmosphere or a model heatmap for precipitation, wind speed or temperature. Adjust heatmap opacity to see the underlying imagery. Wind speed uses green through yellow to red.
- **Clouds:** reconstructed 3D cloud cover driven by weather data. Fine shapes, optical density and motion are illustrative, not a measured three-dimensional scan.
- **Satellite clouds:** dated NASA MODIS cloud observations. Coverage can have gaps and different observation times. This layer pauses during future forecasts rather than presenting an old satellite image as a forecast.
- **Precipitation:** NOAA observed radar in supported regions plus nearby model-driven rain/snow effects. Radar is shown in Natural atmosphere at the current time. Expand NOAA radar for timestamps, legend and opacity. Future forecasts pause observed radar.
- **Wind:** animated global flow colored by model speed: green near 0, yellow near 50, red at 100+ km/h. Animation speed is visualized for readability.
- **Coordinates:** geographic reference lines.
- **Tropical systems:** published NHC storm information and wind extents where available. Selecting a system also draws eyewall and rainband structure at its published position, sized by the analyzed wind extent where one exists and by advisory intensity otherwise. That structure is an illustration of a real storm's location and size, not observed cloud imagery. NHC coverage is regional, not a complete global cyclone feed. Any demonstration scenario is illustrative.
- **Tornado warnings:** active NWS warned polygons in red, refreshed about every minute. The funnel drawn inside a warned area is an illustration at approximate true scale, anchored at the polygon centre — the NWS publishes warned *areas*, never funnel positions, tracks or sizes, so its exact placement, width and shape are not real. Zoom below 220 km to see it. United States coverage only; an empty list means no warnings are active, not that no severe weather exists.
- **More data:** expand this section of the Atmosphere panel for submarine cables and landing points (TeleGeography snapshot), mapped data centres and dams with hydro plants (OpenStreetMap), earthquakes from the last 24 hours (USGS, sized by magnitude, coloured by age) and satellites (CelesTrak element sets propagated on your machine: stations, brightest objects, weather and GPS). Each layer states its source, what is measured and where coverage ends. Cables are drawn about 2 km above sea level so they can be seen from orbit.

### Radar coverage and meaning

NOAA radar covers the contiguous US, Alaska, Hawaii, the Caribbean and Guam where the selected products provide data. It does not cover the whole Earth. Reflectivity in dBZ indicates radar return strength; it is not itself a surface rainfall measurement. Blank areas may mean missing coverage rather than dry weather. Delayed scans are marked; scans older than one hour are hidden.

### Why clouds and local conditions can differ

The local forecast, coarse global model and dated satellite passes describe different spatial areas and times. Cloud geometry adds procedural detail. A clear point forecast does not imply that every visible part of the surrounding region is clear. Inspect Atmospheric data for provenance, timestamps and availability.

## Terrain, roads and places

Satellite imagery and elevation tiles load all around the camera out to the horizon, not only where you are facing, so turning or looking behind you does not wait for new tiles. Detail fills in nearest-first and fades in rather than snapping. **Render quality** in the Atmosphere panel sets how many tiles are kept: higher settings hold high-resolution ground further out, at the cost of memory and more tile requests. Recently viewed ground stays loaded for three minutes, so returning to it is instant. Mountains use measured terrain elevations at true scale; close imagery may be blurry where source detail is limited.

After selecting a place, expand **Roads & places** in View controls. Toggle road lines, place markers and landmarks, and choose a road color. Data covers roughly 3 km around the selection. Roads appear below 180 km and place labels below 80 km. **View streets** brings you closer. This is a local overlay, not a complete global road database loaded at once.

## Surface imagery key

Surface imagery comes from Esri World Imagery. Open the desktop **File → Settings** menu and paste an API key from a free ArcGIS Location Platform account (2 million tiles a month) so imagery is metered to your own allowance. Without a key the public endpoint is used, which Esri intends for personal use only; heavy use may be throttled.

## Live aircraft

First open the desktop **File → Settings** menu and enter your own contact email or HTTPS project URL. Save, then enable **Live civilian aircraft**. The contact is sent to ADSB.lol in the request identification header. The installer does not include the developer's email. Leaving it blank disables flight requests; other layers still work.

Airliner, business and light aircraft types use different colors. Supported civilian types only are shown; known military/privacy-flagged entries are filtered. Coverage is incomplete and this is not a comprehensive aircraft-classification service. Positions refresh about every 15 seconds; movement between updates is estimated. Trails fade over five seconds. Stale or failed feeds are not represented as live positions.

## Arrange the interface

Drag panel headers to move panels. Minimize individual panels or use **Panels** to minimize/restore all, reset the layout and change opacity. Opacity affects the entire panel, including text and borders. Temperature preference, panel layout and some control preferences are saved locally.

## Troubleshooting

| Symptom | Try |
|---|---|
| Weather unavailable / cached model | Check the connection and retry later; cached values show their age. |
| No clouds or radar | Select Natural atmosphere, check layer switches and forecast time. Check source availability. |
| No aircraft | Configure the flight contact, enable traffic, and allow time for the feed. |
| Keyboard/controller ignored | Focus the globe; leave text inputs; press a controller button and check detection status. |
| Sideways horizon | Enable Keep horizon level. |
| Slow rendering | Lower Render quality; disable unnecessary overlays; update graphics drivers. |
| Blurry terrain | Wait for tiles; source resolution varies. |
| Panels obscure the globe | Minimize them or reset the layout through Panels. |

This is an exploratory visualization. Its reconstructed weather and estimated aircraft motion are not suitable for navigation, dispatch or safety decisions.
