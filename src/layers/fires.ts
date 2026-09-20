import * as THREE from 'three';
import { PointCloud } from './points';
import type { GlobeLayer, LayerContext } from './types';
export type FireData = { fetchedAt: string; sources: string[]; fires: number[][]; stale?: boolean };
const CONFIDENCE = ['low', 'nominal', 'high'];
const SATELLITES = ['Suomi NPP', 'NOAA-20', 'NOAA-21'];
// Fire radiative power sets both size and warmth: a smouldering detection is a small dull dot,
// a crown fire a large hot one.
export class FireLayer implements GlobeLayer {
  readonly group = new THREE.Group();
  private cloud = new PointCloud(4, 0xff7a3c);
  constructor() { this.group.add(this.cloud.points); }
  setData(data: unknown) {
    const d = data as FireData | null, cool = new THREE.Color(0xe0a04a), hot = new THREE.Color(0xff3b1f), tint = new THREE.Color();
    this.cloud.set((d?.fires ?? []).map(([lat, lon, frp, confidence, hoursAgo, night, satellite]) => {
      const heat = THREE.MathUtils.clamp(Math.log10(1 + frp) / 2.5, 0, 1);
      return { lat, lon, size: 3 + heat * 5, color: tint.copy(cool).lerp(hot, heat).getHex(), info: { title: `Fire detection · ${frp.toFixed(0)} MW`, lines: [`${CONFIDENCE[confidence] ?? 'nominal'} confidence · ${night ? 'night' : 'day'} pass · ${SATELLITES[satellite] ?? 'VIIRS'}`, `${hoursAgo.toFixed(1)} h ago · ${lat.toFixed(3)}°, ${lon.toFixed(3)}°`, 'A 375 m thermal anomaly, not a fire perimeter'] } };
    }));
  }
  update(context: LayerContext) { this.cloud.drape(context.terrain, .05, context.camera, context.altitudeKm); }
  resize(width: number, height: number) { this.cloud.resize(width, height); }
  pick(camera: THREE.Camera, x: number, y: number, width: number, height: number) { return this.cloud.pick(camera, x, y, width, height); }
  dispose() { this.cloud.dispose(); }
}
