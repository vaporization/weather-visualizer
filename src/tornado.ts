import * as THREE from 'three';
import { EARTH_KM, globePoint } from './weatherShell';
import type { Terrain } from './terrain';
export type TornadoWarning = { id: string; area: string; severity: string; observed: boolean; effective: string; expires: string; lat: number; lon: number; polygon: number[][] };
export type TornadoData = { fetchedAt: string; source: string; warnings: TornadoWarning[] };
// Warned areas are measured; the funnel is an illustration placed inside one.
const FUNNEL_TOP_KM = 1.6, FUNNEL_TOP_RADIUS_KM = .5, FUNNEL_FOOT_RADIUS_KM = .11;
export class TornadoLayer {
  readonly group = new THREE.Group();
  private clock = { value: 0 };
  private funnels: { warning: TornadoWarning; mesh: THREE.Mesh }[] = [];
  private outlineMaterial = new THREE.LineBasicMaterial({ color: 0xff6b5a, transparent: true, opacity: .9 });
  private geometry = new THREE.CylinderGeometry(FUNNEL_TOP_RADIUS_KM / EARTH_KM, FUNNEL_FOOT_RADIUS_KM / EARTH_KM, FUNNEL_TOP_KM / EARTH_KM, 22, 14, true);
  private material = new THREE.ShaderMaterial({
    uniforms: { clock: this.clock }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float clock;varying vec2 shape;
      void main(){
      shape=uv;
      float lean=(1.-uv.y);
      vec3 p=position;
      p.x+=sin(clock*1.7+uv.y*7.)*lean*lean*${(FUNNEL_TOP_RADIUS_KM * .7 / EARTH_KM).toFixed(9)};
      p.z+=cos(clock*1.4+uv.y*6.)*lean*lean*${(FUNNEL_TOP_RADIUS_KM * .7 / EARTH_KM).toFixed(9)};
      vec4 mvPosition=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float clock;varying vec2 shape;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float swirl(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){
      #include <logdepthbuf_fragment>
      float spin=shape.x*7.+clock*2.6-shape.y*3.1;
      float turbulence=swirl(vec2(spin,shape.y*9.-clock*1.9))*.6+swirl(vec2(spin*2.3,shape.y*17.))*.4;
      float body=smoothstep(.06,.3,shape.y)*(1.-smoothstep(.86,1.,shape.y));
      float alpha=body*(.24+turbulence*.66);
      if(alpha<.01)discard;
      vec3 debris=mix(vec3(.15,.14,.13),vec3(.52,.53,.55),turbulence);
      gl_FragColor=vec4(mix(debris,vec3(.62,.63,.66),shape.y*.6),alpha*.9);
      #include <colorspace_fragment>
      }`,
  });
  // Funnel meshes share one geometry; only the per-warning outlines own theirs.
  private clear() {
    this.funnels.forEach(f => this.group.remove(f.mesh));
    this.group.children.slice().forEach(child => { this.group.remove(child); (child as THREE.Line).geometry.dispose(); });
    this.funnels = [];
  }
  setData(data: TornadoData | null) {
    this.clear();
    if (!data) return;
    for (const warning of data.warnings.slice(0, 24)) {
      const ring = warning.polygon.map(([lon, lat]) => globePoint(lat, lon, 1.0002));
      if (ring.length > 2) this.group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), this.outlineMaterial));
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.frustumCulled = false; this.funnels.push({ warning, mesh }); this.group.add(mesh);
    }
  }
  update(terrain: Terrain, altitudeKm: number, seconds: number) {
    this.clock.value = seconds;
    const up = new THREE.Vector3(0, 1, 0);
    for (const { warning, mesh } of this.funnels) {
      mesh.visible = altitudeKm < 220;
      if (!mesh.visible) continue;
      const ground = 1 + terrain.elevationAt(warning.lat, warning.lon) / EARTH_KM;
      const normal = globePoint(warning.lat, warning.lon);
      mesh.position.copy(normal).multiplyScalar(ground + FUNNEL_TOP_KM / EARTH_KM / 2);
      mesh.quaternion.setFromUnitVectors(up, normal);
    }
  }
  dispose() { this.clear(); this.geometry.dispose(); this.material.dispose(); this.outlineMaterial.dispose(); }
}
