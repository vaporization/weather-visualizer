import * as THREE from 'three';
import { GroundLines } from './lines';
import { PointCloud } from './points';
import type { GlobeLayer, LayerContext } from './types';
export type PowerLine = { id: string; name: string; kind: 'line' | 'minor' | 'cable'; voltageKv: number | null; operator: string; circuits: number | null; points: [number, number][] };
export type PowerSite = { id: string; name: string; operator: string; lat: number; lon: number };
export type PowerData = { center: { lat: number; lon: number }; radiusKm: number; lines: PowerLine[]; substations: (PowerSite & { voltageKv: number | null; kind: string })[]; plants: (PowerSite & { source: string; method: string; output: string })[]; truncated: boolean; fetchedAt: string };
const SOURCE_COLORS: Record<string, number> = { wind: 0x8fe3a8, solar: 0xffe066, nuclear: 0xd9a6ff, hydro: 0x7fc8ff, gas: 0xffb27a, coal: 0xb9a89a, oil: 0xc9a27e, geothermal: 0xff9e9e, biomass: 0xb6d97a, waste: 0xb6d97a, battery: 0xa9f0e6 };
// Voltage sets the line's colour and weight: transmission reads bright, distribution dims.
function lineStyle(line: PowerLine) {
  const kv = line.voltageKv ?? 0;
  if (line.kind === 'cable') return { color: 0x9fb8c8 };
  if (kv >= 300) return { color: 0xfff1a8 };
  if (kv >= 100) return { color: 0xffc46b };
  if (line.kind === 'minor' || kv < 40) return { color: 0x8a95a0 };
  return { color: 0xd8b07a };
}
export class PowerLayer implements GlobeLayer {
  readonly group = new THREE.Group();
  private lines = new GroundLines(.02, .2);
  private substations = new PointCloud(6, 0xffd27f, 'square');
  private plants = new PointCloud(8, 0xffffff, 'diamond');
  private terrain: LayerContext['terrain'] | null = null;
  constructor() { this.group.add(this.lines.mesh, this.substations.points, this.plants.points); }
  setData(data: unknown) {
    const d = data as PowerData | null;
    this.lines.set((d?.lines ?? []).map(l => ({ points: l.points, ...lineStyle(l), info: { title: l.name || (l.kind === 'cable' ? 'Underground cable' : l.kind === 'minor' ? 'Minor power line' : 'Power line'), lines: [l.voltageKv ? `${l.voltageKv} kV${l.circuits ? ` · ${l.circuits} circuits` : ''}` : 'Voltage not recorded', l.operator ? `Operator: ${l.operator}` : '', 'OpenStreetMap power=line; routing as mapped'].filter(Boolean) } })));
    this.substations.set((d?.substations ?? []).map(s => ({ lat: s.lat, lon: s.lon, info: { title: s.name || 'Substation', lines: [`Substation${s.kind ? ` (${s.kind})` : ''}${s.voltageKv ? ` · ${s.voltageKv} kV` : ''}`, s.operator ? `Operator: ${s.operator}` : '', '© OpenStreetMap contributors'].filter(Boolean) } })));
    this.plants.set((d?.plants ?? []).map(p => ({ lat: p.lat, lon: p.lon, color: SOURCE_COLORS[p.source] ?? 0xe6eef2, info: { title: p.name || 'Power plant', lines: [`${p.source ? p.source[0].toUpperCase() + p.source.slice(1) : 'Unspecified'} plant${p.method ? ` · ${p.method}` : ''}${p.output ? ` · ${p.output}` : ''}`, p.operator ? `Operator: ${p.operator}` : '', '© OpenStreetMap contributors'].filter(Boolean) } })));
  }
  update(context: LayerContext) { this.terrain = context.terrain; this.lines.mesh.visible = context.altitudeKm < 2500; this.lines.update(context.terrain); this.substations.drape(context.terrain, .03, context.camera, context.altitudeKm); this.plants.drape(context.terrain, .03, context.camera, context.altitudeKm); }
  resize(width: number, height: number) { this.substations.resize(width, height); this.plants.resize(width, height); }
  pick(camera: THREE.Camera, x: number, y: number, width: number, height: number) {
    return this.plants.pick(camera, x, y, width, height) ?? this.substations.pick(camera, x, y, width, height) ?? (this.terrain ? this.lines.pick(camera, x, y, width, height, this.terrain) : null);
  }
  dispose() { this.lines.dispose(); this.substations.dispose(); this.plants.dispose(); }
}
