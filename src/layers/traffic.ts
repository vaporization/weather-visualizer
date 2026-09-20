import * as THREE from 'three';
import { GroundLines } from './lines';
import type { GlobeLayer, LayerContext } from './types';
export type TrafficData = { fetchedAt: string; center: { lat: number; lon: number }; tiles: number; fetched: number; failed: number; budget: { used: number; cap: number; exhausted: boolean }; segments: [number, number, [number, number][], string][] };
// Colour is the measured ratio of current to free-flow speed, nothing more: green is moving
// freely, red is at a crawl, and a closure is drawn dark. No vehicles are drawn or implied.
export function flowColor(level: number, closure: boolean): number {
  if (closure) return 0x5b2333;
  if (level >= .85) return 0x5fd68a;
  if (level >= .6) return 0xf2d35b;
  if (level >= .35) return 0xf7973f;
  return 0xe8453c;
}
export class TrafficLayer implements GlobeLayer {
  readonly group = new THREE.Group();
  private lines = new GroundLines(.015, .12);
  private terrain: LayerContext['terrain'] | null = null;
  constructor() { this.group.add(this.lines.mesh); }
  setData(data: unknown) {
    const d = data as TrafficData | null;
    this.lines.set((d?.segments ?? []).map(([level, closure, points, road]) => ({ points, color: flowColor(level, closure === 1), info: { title: closure ? 'Road closed' : `Traffic at ${Math.round(level * 100)}% of free-flow speed`, lines: [road ? `Road class ${road}` : '', 'TomTom Traffic Flow · measured segment speed, not vehicle positions', `As of ${new Date(d!.fetchedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' })} UTC`].filter(Boolean) } })));
  }
  update(context: LayerContext) { this.terrain = context.terrain; this.lines.mesh.visible = context.altitudeKm < 400; this.lines.update(context.terrain); }
  pick(camera: THREE.Camera, x: number, y: number, width: number, height: number) { return this.terrain ? this.lines.pick(camera, x, y, width, height, this.terrain) : null; }
  dispose() { this.lines.dispose(); }
}
