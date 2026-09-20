import * as THREE from 'three';
import { EARTH_KM, globePoint } from '../weatherShell';
import { PointCloud } from './points';
import type { GlobeLayer, LayerContext } from './types';
export type CableData = { attribution: string; retrieved: string; cables: { id: string; name: string; color: string; lines: number[][][] }[]; landings: { id: string; name: string; lat: number; lon: number }[] };
// Routes are built on the unit sphere and scaled as one object: a hair above the globe from orbit,
// where the base mesh would otherwise swallow them, easing down to sea level as the camera descends.
const ORBIT_RADIUS = 1.0003, SURFACE_RADIUS = 1 + .03 / EARTH_KM;
// Cable routes are dense polylines already; only a long hop needs subdividing to stay above the sphere.
function* along(a: number[], b: number[]) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
  for (let i = 0; i <= steps; i++) yield [a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps];
}
export class CableLayer implements GlobeLayer {
  readonly group = new THREE.Group();
  private lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .8 }));
  private landings = new PointCloud(4, 0xf3e9c6);
  constructor() { this.lines.frustumCulled = false; this.lines.renderOrder = 7; this.group.add(this.lines, this.landings.points); }
  setData(data: unknown) {
    const d = data as CableData | null;
    if (!d) { this.lines.geometry.setDrawRange(0, 0); this.landings.set([]); return; }
    const positions: number[] = [], colors: number[] = [], color = new THREE.Color();
    for (const cable of d.cables) {
      color.set(cable.color || '#8fb8c9');
      for (const line of cable.lines) for (let i = 1; i < line.length; i++) {
        let previous: THREE.Vector3 | null = null;
        for (const [lon, lat] of along(line[i - 1], line[i])) {
          const p = globePoint(lat, lon, 1);
          if (previous) { positions.push(previous.x, previous.y, previous.z, p.x, p.y, p.z); colors.push(color.r, color.g, color.b, color.r, color.g, color.b); }
          previous = p;
        }
      }
    }
    this.lines.geometry.dispose();
    this.lines.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)).setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.landings.set(d.landings.map(l => ({ lat: l.lat, lon: l.lon, info: { title: l.name, lines: ['Cable landing point', `${l.lat.toFixed(3)}°, ${l.lon.toFixed(3)}°`, d.attribution] } })));
  }
  update(context: LayerContext) {
    this.landings.points.visible = context.altitudeKm < 6000;
    this.landings.drape(context.terrain, .03, context.camera, context.altitudeKm);
    const t = THREE.MathUtils.smoothstep(context.altitudeKm, 150, 1500);
    this.lines.scale.setScalar(SURFACE_RADIUS + (ORBIT_RADIUS - SURFACE_RADIUS) * t);
  }
  resize(width: number, height: number) { this.landings.resize(width, height); }
  pick(camera: THREE.Camera, x: number, y: number, width: number, height: number) { return this.landings.pick(camera, x, y, width, height); }
  dispose() { this.lines.geometry.dispose(); (this.lines.material as THREE.Material).dispose(); this.landings.dispose(); }
}
