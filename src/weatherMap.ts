import * as THREE from 'three';
import { hourlyIndex } from './atmosphere';
export type MapMode = 'natural' | 'precipitation' | 'wind' | 'temperature';
export type GlobalWeather = { width: number; height: number; spacingDegrees: number; fetchedAt: string; source: string; points: (Record<string, (number | string | null)[]> & { time: string[] })[] };
// Normalized physical values; RGB = cloud fraction, hourly precipitation / 20 mm,
// wind / 150 km/h. Alpha = temperature mapped from -50 to +50 Â°C.
export function globalPixels(data: GlobalWeather, time: string | undefined, hour: number) {
  const bytes = new Uint8Array(data.width * data.height * 4);
  data.points.forEach((p, i) => {
    const index = hourlyIndex(p.time, time, hour);
    const values = [Number(p.cloud_cover[index]) / 100, Number(p.precipitation[index]) / 20, Number(p.wind_speed_10m[index]) / 150, (Number(p.temperature_2m[index]) + 50) / 100];
    values.forEach((v, c) => { bytes[i * 4 + c] = Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255); });
  });
  return bytes;
}
export function globalTexture(data: GlobalWeather, time: string | undefined, hour: number) {
  const t = new THREE.DataTexture(globalPixels(data, time, hour), data.width, data.height);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true;
  return t;
}

// Coverage is forecast data; procedural geometry only supplies illustrative detail.
export function cloudTexture(data: GlobalWeather, time: string | undefined, hour: number) {
  const bytes = new Uint8Array(data.width * data.height * 4);
  data.points.forEach((p, i) => {
    const index = hourlyIndex(p.time, time, hour);
    ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'cloud_cover'].forEach((key, c) => {
      bytes[i * 4 + c] = Math.round(THREE.MathUtils.clamp(Number(p[key]?.[index] ?? 0) / 100, 0, 1) * 255);
    });
  });
  const t = new THREE.DataTexture(bytes, data.width, data.height);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true;
  return t;
}
