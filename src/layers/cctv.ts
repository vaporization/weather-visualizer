import * as THREE from 'three';
import { PointCloud } from './points';
import type { GlobeLayer, LayerContext } from './types';
export type CctvSource = { id: string; name: string; region: string; attribution: string; href: string; count: number; ok: boolean };
export type CctvData = { fetchedAt: string; sources: CctvSource[]; cameras: (string | number)[][] };
const SOURCE_COLORS: Record<string, number> = { tfl: 0xffd166, caltrans: 0xffb27a, austin: 0x8fe3a8, fintraffic: 0x9ec9ff, drivebc: 0xd9a6ff, nsw: 0xff9e9e };
// A camera marker names itself on hover; pinning it loads the current still through the proxy.
export class CctvLayer implements GlobeLayer {
  readonly group = new THREE.Group();
  private cloud = new PointCloud(6, 0xffffff, 'ring');
  constructor() { this.group.add(this.cloud.points); }
  setData(data: unknown) {
    const d = data as CctvData | null, sources = new Map((d?.sources ?? []).map(s => [s.id, s]));
    this.cloud.set((d?.cameras ?? []).map(row => {
      const [sourceId, id, lat, lon, name] = row as [string, string, number, number, string], source = sources.get(sourceId);
      return { lat, lon, color: SOURCE_COLORS[sourceId] ?? 0xffffff, info: { title: name, lines: [`${source?.name ?? sourceId} · ${source?.region ?? ''}`, 'Public traffic camera · click for the current still', source?.attribution ?? ''].filter(Boolean), image: `/api/cctv/${encodeURIComponent(sourceId)}/${encodeURIComponent(id)}.jpg` } };
    }));
  }
  update(context: LayerContext) { this.cloud.points.visible = context.altitudeKm < 3000; }
  resize(width: number, height: number) { this.cloud.resize(width, height); }
  pick(camera: THREE.Camera, x: number, y: number, width: number, height: number) { return this.cloud.pick(camera, x, y, width, height); }
  dispose() { this.cloud.dispose(); }
}
