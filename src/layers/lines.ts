import * as THREE from 'three';
import { EARTH_KM, globePoint } from '../weatherShell';
import type { Terrain } from '../terrain';
import type { Info, Pick } from './points';
export type GroundLine = { points: [number, number][]; color: THREE.ColorRepresentation; width?: number; info?: Info };
const projected = new THREE.Vector3();
// Polylines draped on the terrain: every segment is resampled along the ground and lifted by the
// local elevation, and rebuilt whenever the terrain under it refines.
export class GroundLines {
  readonly mesh = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .92, depthWrite: false }));
  private lines: GroundLine[] = [];
  private revision = -1;
  constructor(private readonly liftKm = .02, private readonly stepKm = .15) { this.mesh.renderOrder = 9; this.mesh.frustumCulled = false; }
  set(lines: GroundLine[]) { this.lines = lines; this.revision = -1; }
  update(terrain: Terrain) {
    if (this.revision === terrain.revision) return;
    this.revision = terrain.revision;
    const vertices: number[] = [], colors: number[] = [], color = new THREE.Color();
    for (const line of this.lines) {
      color.set(line.color);
      for (let i = 1; i < line.points.length; i++) {
        const a = line.points[i - 1], b = line.points[i], dlon = ((b[1] - a[1] + 540) % 360) - 180;
        const distance = Math.hypot((b[0] - a[0]) * 111.32, dlon * 111.32 * Math.cos(a[0] * Math.PI / 180));
        const steps = Math.min(48, Math.max(1, Math.ceil(distance / this.stepKm)));
        const at = (f: number) => { const lat = a[0] + (b[0] - a[0]) * f, lon = ((a[1] + dlon * f + 540) % 360) - 180; return globePoint(lat, lon, 1 + (terrain.elevationAt(lat, lon) + this.liftKm) / EARTH_KM); };
        let previous = at(0);
        for (let s = 1; s <= steps; s++) { const next = at(s / steps); vertices.push(...previous.toArray(), ...next.toArray()); colors.push(color.r, color.g, color.b, color.r, color.g, color.b); previous = next; }
      }
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)).setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  // Nearest line to a screen point, measured against the original vertices in screen space.
  pick(camera: THREE.Camera, x: number, y: number, width: number, height: number, terrain: Terrain): Pick | null {
    if (!this.mesh.visible) return null;
    const eye = camera.position;
    let best: Pick | null = null, bestDistance = 8;
    for (const line of this.lines) {
      if (!line.info) continue;
      let px = NaN, py = NaN;
      for (const [lat, lon] of line.points) {
        const world = globePoint(lat, lon, 1 + (terrain.elevationAt(lat, lon) + this.liftKm) / EARTH_KM);
        const facing = world.dot(eye) > world.lengthSq();
        projected.copy(world).project(camera);
        const sx = (projected.x + 1) * width / 2, sy = (1 - projected.y) * height / 2;
        if (facing && projected.z < 1 && Number.isFinite(px)) {
          const dx = sx - px, dy = sy - py, len2 = dx * dx + dy * dy;
          const t = len2 > 0 ? THREE.MathUtils.clamp(((x - px) * dx + (y - py) * dy) / len2, 0, 1) : 0;
          const distance = Math.hypot(px + dx * t - x, py + dy * t - y);
          if (distance < bestDistance) { bestDistance = distance; best = { info: line.info, x, y }; }
        }
        px = facing ? sx : NaN; py = sy;
      }
    }
    return best;
  }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
