import type * as THREE from 'three';
import type { Terrain } from '../terrain';
export type LayerContext = { camera: THREE.PerspectiveCamera; terrain: Terrain; altitudeKm: number; seconds: number; now: number };
// Every data layer is a scene group fed by one JSON endpoint and ticked once a frame.
export interface GlobeLayer { readonly group: THREE.Group; setData(data: unknown): void; update(context: LayerContext): void; dispose(): void }
export type LayerSpec = {
  id: string; name: string; detail: string; url: string;
  refreshMs: number; // 0 loads once
  attribution: { text: string; href: string };
  note: string; // what is measured, what is not, and where coverage ends
  create: () => GlobeLayer;
  describe: (data: unknown) => string;
};
