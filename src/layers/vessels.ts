import * as THREE from 'three';
import { PointCloud } from './points';
import type { GlobeLayer, LayerContext } from './types';
export type VesselData = { fetchedAt: string; connected: boolean; warming: boolean; vessels: (string | number | null)[][] };
// AIS ship-type codes group into a handful of classes; each gets a colour so a tanker lane reads
// differently from a fishing fleet at a glance.
export function vesselClass(type: number): { label: string; color: number } {
// Colours are deliberately absent from sea, land and haze: warm and saturated, never blue-grey.
  if (type >= 70 && type <= 79) return { label: 'Cargo', color: 0xff7a1a };
  if (type >= 80 && type <= 89) return { label: 'Tanker', color: 0xff3040 };
  if (type >= 60 && type <= 69) return { label: 'Passenger', color: 0xffd60a };
  if (type === 30) return { label: 'Fishing', color: 0x35e0ff };
  if (type === 36 || type === 37) return { label: 'Sailing / pleasure', color: 0xb388ff };
  if (type >= 50 && type <= 59) return { label: 'Tug, pilot or service', color: 0xffffff };
  if (type >= 40 && type <= 49) return { label: 'High-speed craft', color: 0x7dff5c };
  if (type >= 20 && type <= 29) return { label: 'Wing-in-ground', color: 0xffffff };
  return { label: type ? `Type ${type}` : 'Type not reported', color: 0xff4fd8 };
}
export class VesselLayer implements GlobeLayer {
  readonly group = new THREE.Group();
  private cloud = new PointCloud(13, 0xff4fd8, 'ship');
  constructor() { this.group.add(this.cloud.points); }
  setData(data: unknown) {
    const d = data as VesselData | null;
    this.cloud.set((d?.vessels ?? []).map(row => {
      const [mmsi, lat, lon, cog, sog, heading, name, type, ageS] = row as [string, number, number, number | null, number | null, number | null, string, number, number];
      const cls = vesselClass(type), course = heading ?? cog;
      return { key: mmsi, lat, lon, heading: course ?? 0, shape: course == null ? 'circle' : 'ship', color: cls.color, size: course == null ? 6 : 13, info: { title: name || `MMSI ${mmsi}`, lines: [`${cls.label}${sog != null ? ` · ${sog.toFixed(1)} kn` : ''}${course != null ? ` · ${Math.round(course)}°` : ''}`, `MMSI ${mmsi} · reported ${ageS < 90 ? `${ageS} s` : `${Math.round(ageS / 60)} min`} ago`, 'AIS via AISStream · self-reported position'] } } as const;
    }));
  }
  update(context: LayerContext) { this.cloud.drape(context.terrain, .03, context.camera, context.altitudeKm); }
  resize(width: number, height: number) { this.cloud.resize(width, height); }
  pick(camera: THREE.Camera, x: number, y: number, width: number, height: number) { return this.cloud.pick(camera, x, y, width, height); }
  dispose() { this.cloud.dispose(); }
}
