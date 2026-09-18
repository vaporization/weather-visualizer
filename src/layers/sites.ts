import * as THREE from 'three';
import { PointCloud, type Shape } from './points';
import type { GlobeLayer, LayerContext } from './types';
export type Site = { lat: number; lon: number; name: string; operator?: string; hydro?: boolean; output?: string };
export type SiteData = { attribution: string; sites: Site[] };
type Style = { kind: string; shape: Shape; color: THREE.ColorRepresentation; accent?: (site: Site) => { color: THREE.ColorRepresentation; kind: string } | undefined };
// Static mapped infrastructure drawn as fixed-size glyphs; a style rule can single out a subset.
export class SiteLayer implements GlobeLayer {
  readonly group = new THREE.Group();
  private cloud: PointCloud;
  constructor(private readonly style: Style) { this.cloud = new PointCloud(6, style.color, style.shape); this.group.add(this.cloud.points); }
  setData(data: unknown) {
    const d = data as SiteData | null;
    this.cloud.set((d?.sites ?? []).map(s => {
      const accent = this.style.accent?.(s);
      const lines = [accent?.kind ?? this.style.kind, s.operator ? `Operator: ${s.operator}` : '', s.output ? `Rated output: ${s.output}` : '', `${s.lat.toFixed(3)}°, ${s.lon.toFixed(3)}°`, d?.attribution ?? ''].filter(Boolean);
      return { lat: s.lat, lon: s.lon, color: accent?.color ?? this.style.color, info: { title: s.name, lines } };
    }));
  }
  update(_context: LayerContext) {}
  resize(width: number, height: number) { this.cloud.resize(width, height); }
  pick(camera: THREE.Camera, x: number, y: number, width: number, height: number) { return this.cloud.pick(camera, x, y, width, height); }
  dispose() { this.cloud.dispose(); }
}
