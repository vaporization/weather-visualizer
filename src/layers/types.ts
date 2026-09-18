import type * as THREE from 'three';
import type { Terrain } from '../terrain';
import type { Pick } from './points';
export type LayerContext = { camera: THREE.PerspectiveCamera; terrain: Terrain; altitudeKm: number; seconds: number; now: number };
// Every data layer is a scene group fed by one JSON endpoint and ticked once a frame. Layers that
// can name what is under the pointer answer pick() with the marker's own record.
export interface GlobeLayer {
  readonly group: THREE.Group;
  setData(data: unknown): void;
  update(context: LayerContext): void;
  dispose(): void;
  resize?(width: number, height: number): void;
  pick?(camera: THREE.Camera, x: number, y: number, width: number, height: number): Pick | null;
}
export type LayerSpec = {
  id: string; name: string; detail: string; url: string;
  refreshMs: number; // 0 loads once
  attribution: { text: string; href: string };
  note: string; // what is measured, what is not, and where coverage ends
  create: () => GlobeLayer;
  describe: (data: unknown) => string;
};
