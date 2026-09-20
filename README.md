# Weather Visualizer

A GPU-rendered weather globe with terrain, forecast layers, NOAA radar, local conditions, roads, civilian aircraft, NHC tropical systems, NWS tornado warnings, submarine cables, data centres, dams and hydro plants, earthquakes, satellites, active fires, ships, the regional power grid, live transit vehicles, public traffic cameras with on-demand stills, TomTom traffic congestion around the selected place, a hover/click inspector for every marker, and mouse/keyboard/gamepad navigation. Third-party code and bundled-data licenses are listed in THIRD-PARTY.md. The interface currently retains ATMO branding.

## Documentation

- [Feature list and user guide](docs/USER-GUIDE.md): installation, controls, layers and troubleshooting.
- [Technical reference](docs/TECHNICAL.md): architecture, endpoints, data interpretation, configuration and releases.
- [Provider keys](docs/API-KEYS.md): step-by-step acquisition of the free ArcGIS, NASA FIRMS, AISStream and TomTom keys, what each unlocks and costs, and where to enter them.
- Standalone HTML copies are in `docs/` and available in the desktop Help menu.

## Develop and package

Use Node.js 24 and npm. Run `npm ci`, then `npm run dev`; open http://localhost:5173.

- `npm test`: unit tests.
- `npm run build`: TypeScript check and production frontend.
- `npm run desktop`: launch the desktop app.
- `npm run package:win`: build the Windows x64 installer in `release/`.

Optional `.env.local` contains development-only provider configuration. Never distribute it. Desktop recipients configure their own flight contact and, optionally, their own free ArcGIS, NASA FIRMS, AISStream and TomTom keys through File → Settings; in a browser the same keys are entered under Atmosphere → More data → Provider keys, which saves them to `.env.local`.

The installer bundles the runtime; recipients do not need Node.js. This first release is unsigned and requires internet and WebGL2 graphics support. macOS/Linux installers are not included. See the technical reference for source credits, data limitations and verification requirements. No project open-source license has been selected.
