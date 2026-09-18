import * as THREE from 'three';
import { PointCloud } from './points';
import type { GlobeLayer, LayerContext } from './types';
export type Quake = { id: string; mag: number; depthKm: number; lat: number; lon: number; time: string; place: string };
export type QuakeData = { fetchedAt: string; feed: string; quakes: Quake[] };
// Marker size follows magnitude; colour cools with age so the newest events read first.
export class EarthquakeLayer implements GlobeLayer {
  readonly group = new THREE.Group();
  private cloud = new PointCloud(4, 0xffb347);
  private quakes: Quake[] = [];
  private stamped = 0;
  constructor() { this.group.add(this.cloud.points); }
  setData(data: unknown) { this.quakes = (data as QuakeData | null)?.quakes ?? []; this.stamped = 0; }
  update(context: LayerContext) {
    if (context.now - this.stamped < 60000) return;
    this.stamped = context.now;
    const fresh = new THREE.Color(0xff5a3c), old = new THREE.Color(0xe0b86a), tint = new THREE.Color();
    this.cloud.set(this.quakes.map(q => {
      const age = THREE.MathUtils.clamp((context.now - Date.parse(q.time)) / 86400000, 0, 1);
      return { lat: q.lat, lon: q.lon, size: 3 + Math.max(0, q.mag) * 2.2, color: tint.copy(fresh).lerp(old, age).getHex() };
    }));
  }
  dispose() { this.cloud.dispose(); }
}
