import * as THREE from 'three';
import { EARTH_KM, SHAPED_CLOUD_GLSL, cloudNoise, globePoint } from './weatherShell';
import type { Terrain } from './terrain';
export type StormMotion = { at: string; lat: number; lon: number; headingDeg: number; speedKmh: number };
export type TornadoWarning = {
  id: string; area: string; severity: string; observed: boolean; effective: string; expires: string;
  lat: number; lon: number; polygon: number[][];
  detection?: string; damageThreat?: string | null; hail?: string | null; motion?: StormMotion | null;
};
export type TornadoData = { fetchedAt: string; source: string; warnings: TornadoWarning[] };

// A warning publishes a warned area and, separately, the radar-identified storm cell with its motion.
// The cell is the closest thing to a real position in the product, so the funnel is anchored there
// and carried forward along the reported track; the warned area's centroid is only the fallback.
// Nothing in the product says where a funnel is, how wide it is, or whether one has touched down,
// so the funnel's placement inside the cell and its shape remain an illustration.
const EXTRAPOLATION_LIMIT_MINUTES = 20;
export function funnelAnchor(warning: TornadoWarning, now: number): { lat: number; lon: number; fromCell: boolean } {
  const motion = warning.motion;
  if (!motion) return { lat: warning.lat, lon: warning.lon, fromCell: false };
  const ageMinutes = Math.min(EXTRAPOLATION_LIMIT_MINUTES, Math.max(0, (now - Date.parse(motion.at)) / 60000));
  const travelled = motion.speedKmh * ageMinutes / 60;
  const heading = motion.headingDeg * Math.PI / 180;
  const lat = motion.lat + travelled * Math.cos(heading) / 111.32;
  const lon = motion.lon + travelled * Math.sin(heading) / (111.32 * Math.max(.08, Math.cos(motion.lat * Math.PI / 180)));
  return { lat, lon: ((lon + 540) % 360) - 180, fromCell: true };
}
// A tornado's visible condensation funnel is a few hundred metres across at most. Warnings do not
// publish a width, so these are the proportions of a typical funnel, widened where the product says
// the threat is greater; the box below has to enclose whatever they produce.
export function funnelShape(warning: TornadoWarning) {
  const threat = warning.damageThreat === 'CATASTROPHIC' ? 1 : warning.damageThreat === 'CONSIDERABLE' ? .6 : 0;
  const topRadiusKm = .34 + threat * .5;
  return { topRadiusKm, footRadiusKm: .07 + threat * .16, debrisRadiusKm: .45 + threat * .6, strength: warning.observed ? 1 : .55 };
}

// The funnel is carried a little below its anchor so it always meets the ground: the elevation the
// funnel is placed at and the displaced terrain actually drawn can differ by tens of metres, and a
// funnel hanging in the air is worse than one whose foot is buried and hidden by the depth test.
const BOX_HALF_WIDTH_KM = 2.2, MAX_HEIGHT_KM = 3.4, BURY_KM = .22;

export class TornadoLayer {
  readonly group = new THREE.Group();
  private clock = { value: 0 };
  private baseKm = { value: 1.4 };
  private sun = { value: new THREE.Vector3(0, 1, 0) };
  private funnels: { warning: TornadoWarning; mesh: THREE.Mesh; eyeLocal: THREE.Vector3; uniforms: Record<string, { value: unknown }> }[] = [];
  private outlineMaterial = new THREE.LineBasicMaterial({ color: 0xff6b5a, transparent: true, opacity: .9 });
  private outlineWeak = new THREE.LineBasicMaterial({ color: 0xff6b5a, transparent: true, opacity: .45 });
  // One box per warning, raymarched in its own object space where a unit is a kilometre. The cloud
  // shell's steps are kilometres apart at this range and would step straight over a funnel, so the
  // funnel gets its own short march while sharing the shell's noise and shaping.
  private geometry = new THREE.BoxGeometry(BOX_HALF_WIDTH_KM * 2, MAX_HEIGHT_KM + BURY_KM, BOX_HALF_WIDTH_KM * 2).translate(0, (MAX_HEIGHT_KM - BURY_KM) / 2, 0);
  private makeMaterial(shape: ReturnType<typeof funnelShape>, spin: number) {
    const uniforms = {
      noiseMap: { value: cloudNoise() }, clock: this.clock, sun: { value: new THREE.Vector3(0, 1, 0) }, baseKm: this.baseKm,
      eyeLocal: { value: new THREE.Vector3() }, topRadiusKm: { value: shape.topRadiusKm },
      footRadiusKm: { value: shape.footRadiusKm }, debrisRadiusKm: { value: shape.debrisRadiusKm },
      strength: { value: shape.strength }, spin: { value: spin }, pixelKm: { value: .01 },
    };
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms, transparent: true, depthWrite: false, side: THREE.BackSide,
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        out vec3 vLocal;
        void main(){vLocal=position;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `precision highp float; precision highp sampler3D;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        in vec3 vLocal;
        uniform sampler3D noiseMap;
        uniform vec3 eyeLocal, sun;
        uniform float clock, baseKm, topRadiusKm, footRadiusKm, debrisRadiusKm, strength, spin, pixelKm;
        out vec4 pc_fragColor;
        #define gl_FragColor pc_fragColor
        ${SHAPED_CLOUD_GLSL}
        // Ordered dither, as the cloud shell uses: without it a fixed step count lays concentric
        // rings over the funnel where neighbouring rays sample at the same depths.
        float bayer2(vec2 a){a=floor(a);return fract(a.x*.5+a.y*a.y*.75);}
        float bayer8(vec2 a){return bayer2(a*.25)*.0625+bayer2(a*.5)*.25+bayer2(a);}
        // The funnel narrows toward the ground, turns as a Rankine vortex -- rigid rotation inside the
        // core and falling away as 1/r outside -- and drags a debris cloud around its foot.
        float funnel(vec3 q){
          float top=min(baseKm,${MAX_HEIGHT_KM.toFixed(2)});
          if(q.y<-${BURY_KM.toFixed(2)}||q.y>top)return 0.;
          float t=clamp(q.y,0.,top)/top;
          float radius=mix(footRadiusKm,topRadiusKm,pow(t,.55));
          float r=length(q.xz);
          if(r>debrisRadiusKm*1.9)return 0.;
          float body=1.-smoothstep(radius*.5,radius*1.2,r);
          // The circulation at the ground is wider than the condensation funnel above it: a skirt of
          // lofted debris, thickest at the surface, is what actually marks the point of contact.
          // Peaked just above the surface rather than at it, so the ground does not swallow the skirt.
          float skirt=smoothstep(-${BURY_KM.toFixed(2)},.05,q.y)*(1.-smoothstep(.08,.42,q.y))*(1.-smoothstep(debrisRadiusKm*.28,debrisRadiusKm*1.2,r));
          float flare=smoothstep(.9,1.,t);
          float cover=clamp(max(body,skirt*.9)+flare*.35*(1.-smoothstep(topRadiusKm,topRadiusKm*2.2,r)),0.,1.)*strength;
          if(cover<.02)return 0.;
          float omega=r<radius?1.:radius/max(r,1e-4);
          float swirl=clock*omega*3.2*spin-t*4.2;
          float c=cos(swirl),s=sin(swirl);
          vec3 turned=vec3(q.x*c-q.z*s,q.y*1.6,q.x*s+q.z*c);
          return shapedCloud(turned,cover,1.5,pixelKm);
        }
        void main(){
          #include <logdepthbuf_fragment>
          vec3 ro=eyeLocal, rd=normalize(vLocal-eyeLocal);
          vec3 lo=vec3(-${BOX_HALF_WIDTH_KM.toFixed(2)},-${BURY_KM.toFixed(2)},-${BOX_HALF_WIDTH_KM.toFixed(2)});
          vec3 hi=vec3(${BOX_HALF_WIDTH_KM.toFixed(2)},min(baseKm,${MAX_HEIGHT_KM.toFixed(2)}),${BOX_HALF_WIDTH_KM.toFixed(2)});
          vec3 ta=(lo-ro)/rd, tb=(hi-ro)/rd;
          vec3 tn=min(ta,tb), tf=max(ta,tb);
          float near=max(max(tn.x,tn.y),tn.z), far=min(min(tf.x,tf.y),tf.z);
          near=max(near,0.);
          if(far<=near)discard;
          float span=far-near;
          float jitter=bayer8(gl_FragCoord.xy);
          vec4 acc=vec4(0.);
          for(int i=0;i<64;i++){
            float f=(float(i)+jitter)/64.;
            vec3 p=ro+rd*(near+f*span);
            float d=funnel(p);
            if(d>.003){
              // Short shadow march toward the sun, same Beer's law the cloud shell uses.
              float shade=0.;
              for(int j=1;j<=3;j++)shade+=funnel(p+sun*float(j)*.09)*.09;
              float lit=exp(-shade*2.1);
              vec3 col=mix(vec3(.10,.10,.12),vec3(.78,.78,.82),lit);
              // Debris near the ground is dirt, not condensate.
              col=mix(vec3(.33,.28,.22),col,smoothstep(.01,.40,p.y));
              float alpha=1.-exp(-d*(span/64.)*9.);
              acc.rgb+=(1.-acc.a)*col*alpha; acc.a+=(1.-acc.a)*alpha;
              if(acc.a>.985)break;
            }
          }
          if(acc.a<.004)discard;
          gl_FragColor=vec4(acc.rgb/max(acc.a,.001),acc.a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
  }
  private clear() {
    for (const child of this.group.children.slice()) {
      this.group.remove(child);
      const line = child as THREE.Line;
      if (line.isLine) line.geometry.dispose();
      else (child as THREE.Mesh).material && ((child as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.funnels = [];
  }
  setData(data: TornadoData | null) {
    this.clear();
    if (!data) return;
    for (const warning of data.warnings.slice(0, 24)) {
      const ring = warning.polygon.map(([lon, lat]) => globePoint(lat, lon, 1.0002));
      // A radar-indicated warning is outlined more faintly than one with a tornado observed.
      if (ring.length > 2) this.group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), warning.observed ? this.outlineMaterial : this.outlineWeak));
      const shape = funnelShape(warning);
      const material = this.makeMaterial(shape, warning.lat >= 0 ? 1 : -1);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false; mesh.renderOrder = 18;
      mesh.scale.setScalar(1 / EARTH_KM);
      this.funnels.push({ warning, mesh, eyeLocal: new THREE.Vector3(), uniforms: material.uniforms });
      this.group.add(mesh);
    }
  }
  setSun(direction: THREE.Vector3) { this.sun.value.copy(direction).normalize(); }
  setCloudBase(km: number) { this.baseKm.value = Math.max(.35, Math.min(MAX_HEIGHT_KM, km)); }
  update(terrain: Terrain, altitudeKm: number, seconds: number, camera?: THREE.Camera, now = Date.now()) {
    this.clock.value = seconds;
    const up = new THREE.Vector3(0, 1, 0), local = new THREE.Vector3(), inverse = new THREE.Quaternion();
    for (const funnel of this.funnels) {
      const { warning, mesh } = funnel;
      mesh.visible = altitudeKm < 220;
      if (!mesh.visible) continue;
      const anchor = funnelAnchor(warning, now);
      const ground = 1 + terrain.elevationAt(anchor.lat, anchor.lon) / EARTH_KM;
      const normal = globePoint(anchor.lat, anchor.lon);
      mesh.position.copy(normal).multiplyScalar(ground);
      mesh.quaternion.setFromUnitVectors(up, normal);
      mesh.updateMatrixWorld();
      if (camera) {
        // The march runs in object space, where one unit is a kilometre and the ground is y = 0.
        local.copy(camera.position); mesh.worldToLocal(local);
        (funnel.uniforms.eyeLocal.value as THREE.Vector3).copy(local);
        // A funnel seen from far away must not be marched at metre detail it cannot resolve.
        funnel.uniforms.pixelKm.value = Math.max(.004, local.length() * .0016);
      }
      // Object space is oriented to the local vertical, so the sun direction is rotated into it.
      (funnel.uniforms.sun.value as THREE.Vector3).copy(this.sun.value).applyQuaternion(inverse.copy(mesh.quaternion).invert());
    }
  }
  dispose() { this.clear(); this.geometry.dispose(); this.outlineMaterial.dispose(); this.outlineWeak.dispose(); }
}
