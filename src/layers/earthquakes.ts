import * as THREE from 'three';
import { PointCloud } from './points';
import type { GlobeLayer, LayerContext } from './types';
export type Quake = { id: string; mag: number; depthKm: number; lat: number; lon: number; time: string; place: string };
export type QuakeData = { fetchedAt: string; feed: string; quakes: Quake[] };
// Marker size follows magnitude; colour cools with age so the newest events read first.
export class EarthquakeLayer implements GlobeLayer {
  readonly group = new THREE.Group();
  private cloud = new PointCloud(4, 0xffb347, 'ring');
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
      const when = new Date(q.time);
      return { lat: q.lat, lon: q.lon, size: 4 + Math.max(0, q.mag) * 2.4, color: tint.copy(fresh).lerp(old, age).getHex(), info: { title: `M${q.mag.toFixed(1)} · ${q.place}`, lines: [`Depth ${q.depthKm.toFixed(0)} km`, `${when.toISOString().replace('T', ' ').slice(0, 16)} UTC · ${Math.round((context.now - when.getTime()) / 3600000)} h ago`, 'USGS event; automatic solutions may be revised'] } };
    }));
  }
  resize(width: number, height: number) { this.cloud.resize(width, height); }
  pick(camera: THREE.Camera, x: number, y: number, width: number, height: number) { return this.cloud.pick(camera, x, y, width, height); }
  dispose() { this.cloud.dispose(); }
}
