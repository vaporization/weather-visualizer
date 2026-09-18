import { registerRadar } from './radar.mjs';
import { registerFlights } from './flights.mjs';
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cachedFetch, coordinates, extractPolygons } from './data.mjs';
import { registerAtmosphereRoutes } from './atmosphere.mjs';
import { registerGlobalWeather } from './global-weather.mjs';
import { createPointWeather } from './point-weather.mjs';
import { registerRoads } from './roads.mjs';
import { registerTornadoes } from './tornadoes.mjs';
try { if (!process.env.WEATHER_DESKTOP) process.loadEnvFile('.env.local'); } catch { /* Optional local configuration. */ }
const app = express();
registerFlights(app);
registerRadar(app);
registerRoads(app);
registerTornadoes(app);
registerGlobalWeather(app);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
registerAtmosphereRoutes(app);
const pointWeather = createPointWeather();
app.get('/api/weather', async (req, res) => {
  try {
    let p;
    try { p = coordinates(req.query); } catch (e) { return res.status(400).json({ error: e.message }); }
    res.json(await pointWeather(p));
  } catch (e) { res.status(502).json({ error: 'Weather provider is unavailable. Please retry.', detail: e.message }); }
});
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q.length < 2) return res.json({ results: [] });
  try { res.json(await cachedFetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: '6', language: 'en', format: 'json' })}`)); }
  catch { res.status(502).json({ error: 'Place search unavailable. You can still click the globe.' }); }
});
app.get('/api/storms', async (_req, res) => {
  try { res.json(await cachedFetch('https://www.nhc.noaa.gov/CurrentStorms.json')); }
  catch { res.status(502).json({ error: 'NHC storm feed is unavailable.' }); }
});
app.get('/api/storms/:id/extent', async (req, res) => {
  try {
    const { activeStorms } = await cachedFetch('https://www.nhc.noaa.gov/CurrentStorms.json');
    const storm = activeStorms.find(s => s.id === req.params.id);
    if (!storm) return res.status(404).json({ error: 'Storm is no longer in the active feed.' });
    const url = storm.initialWindExtent?.kmzFile;
    if (!url || !url.startsWith('https://www.nhc.noaa.gov/storm_graphics/api/')) return res.json({ polygons: [], updated: storm.lastUpdate });
    res.json({ polygons: extractPolygons(await cachedFetch(url, true)), updated: storm.lastUpdate });
  } catch { res.status(502).json({ error: 'Observed wind extent is unavailable.' }); }
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint' }));
if (process.argv.includes('--production')) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const listener = app.listen(Number(process.env.PORT || 5173), '127.0.0.1', () => {
 const port = listener.address().port;
 console.log(`Weather Visualizer ready at http://127.0.0.1:${port}`);
 process.parentPort?.postMessage({ port });
});
