# Third-party code and data

## Code

- **Gods Eye View** — Copyright (c) 2026 Bilawal Sidhu, MIT License (https://github.com/halfpixel/gods-eye-view). The data-layer catalogue in this project (submarine cables, data centres, dams, earthquakes, satellites, fires, ships, transit, traffic cameras) was designed with reference to that project's layer sources and its per-dataset provenance notes, and the OpenStreetMap extracts under `public/data` were compiled by its authors. No Cesium rendering code was reused; every layer here is rendered with this project's own Three.js code.
- **satellite.js** — MIT License. SGP4 propagation of published element sets.
- **pbf** — BSD-3-Clause. Protocol-buffer reader used to decode GTFS-Realtime feeds and TomTom flow tiles.
- **@mapbox/vector-tile** — BSD-3-Clause. Mapbox Vector Tile parser used for TomTom traffic-flow tiles.
- Other dependencies carry their own licenses in `node_modules` and in the packaged application's license notices.

## Bundled data

See `public/data/LICENSES.md`. In short: the TeleGeography cable and landing-point files are **CC BY-NC-SA 3.0** (attribution, non-commercial, share-alike) and must be removed or separately licensed before any commercial distribution; the OpenStreetMap extracts are **ODbL 1.0**.

## Live providers

Attribution for every live provider is shown in the application beside the layer it feeds and is listed in `docs/TECHNICAL.md`.
