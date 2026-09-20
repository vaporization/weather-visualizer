import * as THREE from 'three';
import { PointCloud } from './points';
import type { GlobeLayer, LayerContext } from './types';
export type TransitFeed = { id: string; name: string; region: string; attribution: string; href: string; count: number; ok: boolean; stale: boolean };
export type TransitData = { fetchedAt: string; feeds: TransitFeed[]; vehicles: (string | number | null)[][] };
const FEED_COLORS: Record<string, number> = { mbta: 0xffd166, capmetro: 0x8fe3a8, metrotransit: 0x7fd1ff, hsl: 0x9ec9ff, ovapi: 0xffb27a, entur: 0xd9a6ff, translink: 0xff9e9e };
// Each agency keeps one colour so a city's fleet reads as one system; arrows follow reported bearing.
export class TransitLayer implements GlobeLayer {
  readonly group = new THREE.Group();
  private cloud = new PointCloud(8, 0xffffff, 'arrow');
  constructor() { this.group.add(this.cloud.points); }
  setData(data: unknown) {
    const d = data as TransitData | null, feeds = new Map((d?.feeds ?? []).map(f => [f.id, f]));
    this.cloud.set((d?.vehicles ?? []).map(row => {
      const [feedId, label, lat, lon, bearing, speed, route, ageS] = row as [string, string, number, number, number | null, number | null, string, number];
      const feed = feeds.get(feedId);
      return { key: `${feedId}/${label || `${lat},${lon}`}`, lat, lon, heading: bearing ?? 0, shape: bearing == null ? 'circle' : 'arrow', size: bearing == null ? 5 : 8, color: FEED_COLORS[feedId] ?? 0xffffff, info: { title: `${feed?.name ?? feedId}${route ? ` · route ${route}` : ''}`, lines: [`${feed?.region ?? ''}${label ? ` · vehicle ${label}` : ''}`, `${speed != null ? `${speed} km/h · ` : ''}${bearing != null ? `${bearing}° · ` : ''}reported ${ageS < 90 ? `${ageS} s` : `${Math.round(ageS / 60)} min`} ago`, `GTFS-Realtime · ${feed?.attribution ?? ''}`].filter(Boolean) } } as const;
    }));
  }
  update(_context: LayerContext) {}
  resize(width: number, height: number) { this.cloud.resize(width, height); }
  pick(camera: THREE.Camera, x: number, y: number, width: number, height: number) { return this.cloud.pick(camera, x, y, width, height); }
  dispose() { this.cloud.dispose(); }
}
