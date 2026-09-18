import * as THREE from 'three';
import { PointCloud } from './points';
import type { GlobeLayer, LayerContext } from './types';
export type Site = { lat: number; lon: number; name: string; operator?: string; hydro?: boolean; output?: string };
export type SiteData = { attribution: string; sites: Site[] };
// Static mapped infrastructure drawn as fixed-size markers; a colour rule can single out a subset.
export class SiteLayer implements GlobeLayer {
  readonly group = new THREE.Group();
  private cloud: PointCloud;
  constructor(private readonly color: THREE.ColorRepresentation, private readonly accent?: (site: Site) => THREE.ColorRepresentation | undefined) {
    this.cloud = new PointCloud(5, color); this.group.add(this.cloud.points);
  }
  setData(data: unknown) {
    const d = data as SiteData | null;
    this.cloud.set((d?.sites ?? []).map(s => ({ lat: s.lat, lon: s.lon, color: this.accent?.(s) ?? this.color })));
  }
  update(_context: LayerContext) {}
  dispose() { this.cloud.dispose(); }
}
