import * as THREE from 'three';
import { twoline2satrec, propagate, gstime, eciToEcf, type SatRec } from 'satellite.js';
import { EARTH_KM } from '../weatherShell';
import { PointCloud } from './points';
import type { GlobeLayer, LayerContext } from './types';
export type SatelliteData = { fetchedAt: string; groups: string[]; satellites: { name: string; group: string; line1: string; line2: string }[] };
const GROUP_COLORS: Record<string, number> = { stations: 0xffffff, visual: 0xa8d8ff, weather: 0x8ee0c8, 'gps-ops': 0xffd27f };
const GROUP_LABELS: Record<string, string> = { stations: 'Space station', visual: 'Bright satellite', weather: 'Weather satellite', 'gps-ops': 'GPS satellite' };
// Positions come from SGP4 on the published elements, refreshed a few times a second: at globe
// scale a 7 km/s satellite moves well under a pixel between updates.
export class SatelliteLayer implements GlobeLayer {
  readonly group = new THREE.Group();
  private cloud = new PointCloud(3.5, 0xffffff);
  private records: { rec: SatRec; group: string; name: string }[] = [];
  private stamped = 0;
  constructor() { this.group.add(this.cloud.points); }
  setData(data: unknown) {
    const d = data as SatelliteData | null;
    this.records = [];
    for (const s of d?.satellites ?? []) { try { const rec = twoline2satrec(s.line1, s.line2); if (Number.isFinite(rec.no)) this.records.push({ rec, group: s.group, name: s.name }); } catch { /* malformed element set */ } }
    this.stamped = 0;
  }
  update(context: LayerContext) {
    if (context.now - this.stamped < 200) return;
    this.stamped = context.now;
    const date = new Date(context.now), gmst = gstime(date);
    const markers = [];
    for (const { rec, group, name } of this.records) {
      const state = propagate(rec, date);
      const eci = state?.position;
      if (!eci || typeof eci === 'boolean') continue;
      const ecf = eciToEcf(eci, gmst), r = Math.hypot(ecf.x, ecf.y, ecf.z);
      if (!Number.isFinite(r) || r < EARTH_KM) continue;
      // ECEF (x toward 0°E, z toward the pole) into the globe frame used by globePoint.
      const lat = Math.asin(ecf.z / r) * 180 / Math.PI, lon = Math.atan2(ecf.y, ecf.x) * 180 / Math.PI;
      markers.push({ lat, lon, radius: r / EARTH_KM, color: GROUP_COLORS[group] ?? 0xffffff, size: group === 'stations' ? 7 : 4, info: { title: name, lines: [`${GROUP_LABELS[group] ?? group} · altitude ${Math.round(r - EARTH_KM).toLocaleString()} km`, `${lat.toFixed(2)}°, ${lon.toFixed(2)}° (sub-satellite point)`, 'SGP4 prediction from CelesTrak elements'] } });
    }
    this.cloud.set(markers);
  }
  resize(width: number, height: number) { this.cloud.resize(width, height); }
  pick(camera: THREE.Camera, x: number, y: number, width: number, height: number) { return this.cloud.pick(camera, x, y, width, height); }
  dispose() { this.cloud.dispose(); }
}
