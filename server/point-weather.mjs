export const pointFields = 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m';

export function createPointWeather({ fetcher = fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  // Kept separately from the much larger stream of imagery/elevation tiles.
  const cache = new Map(), pending = new Map();
  return async ({ lat, lon }) => {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`, hit = cache.get(key);
    const result = (entry, stale = false) => ({ ...entry.data, _meta: { stale, fetchedAt: new Date(entry.time).toISOString() } });
    if (hit && now() - hit.time < 600000) return result(hit);
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
      const params = new URLSearchParams({ latitude: lat.toFixed(4), longitude: lon.toFixed(4), current: pointFields, hourly: `${pointFields},visibility`, forecast_days: '3', timezone: 'GMT', cell_selection: 'nearest' });
      let failure;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetcher(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'AtmoWeatherGlobe/0.2' } });
          if (!response.ok) {
            const error = new Error(`Weather provider returned ${response.status}`);
            error.retryable = response.status === 408 || response.status >= 500;
            // Do not immediately repeat a rate-limited request.
            throw error;
          }
          const data = await response.json();
          if (!Number.isFinite(data.current?.temperature_2m) || !data.current?.time || !data.hourly?.time?.length) throw new Error('Incomplete weather response');
          const entry = { data, time: now() };cache.delete(key);cache.set(key, entry);
          if (cache.size > 256) cache.delete(cache.keys().next().value);
          return result(entry);
        } catch (error) {
          failure = error;
          if (error.retryable === false) break;
          if (attempt === 0) await sleep(600);
        }
      }
      // Only this exact location, with a bounded age, may supply a stale result.
      if (hit && now() - hit.time < 3600000) return result(hit, true);
      throw failure;
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  };
}
