import * as THREE from 'three';
import { globePoint } from '../weatherShell';
export type Shape = 'circle' | 'ring' | 'diamond' | 'square' | 'arrow';
export type Info = { title: string; lines: string[]; image?: string };
export type Marker = { lat: number; lon: number; radius?: number; size?: number; color?: THREE.ColorRepresentation; shape?: Shape; heading?: number; info?: Info };
export type Pick = { info: Info; x: number; y: number };
const SHAPES: Record<Shape, number> = { circle: 0, ring: 1, diamond: 2, square: 3, arrow: 4 };
const projected = new THREE.Vector3();
// Screen-sized markers on the globe. Shape and colour tell categories apart at a glance; an arrow
// is turned in the vertex shader to point along a compass heading as it appears on screen.
export class PointCloud {
  readonly points: THREE.Points;
  private capacity = 0;
  private markers: Marker[] = [];
  private material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { opacity: { value: .95 }, viewport: { value: new THREE.Vector2(1, 1) } },
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float size;attribute vec3 tint;attribute float shape;attribute vec3 tangent;uniform vec2 viewport;
      varying vec3 shade;varying float kind;varying float turn;
      void main(){shade=tint;kind=shape;
      vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=size;
      vec4 ahead=projectionMatrix*modelViewMatrix*vec4(position+tangent*.0002,1.);
      vec2 d=(ahead.xy/ahead.w-gl_Position.xy/gl_Position.w)*viewport;
      turn=atan(d.y,d.x);
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float opacity;varying vec3 shade;varying float kind;varying float turn;
      void main(){
      #include <logdepthbuf_fragment>
      vec2 p=gl_PointCoord-.5;p.y=-p.y;
      float c=cos(turn),s=sin(turn);p=vec2(c*p.x+s*p.y,-s*p.x+c*p.y);
      float d=length(p),inside,edge;
      if(kind<.5){inside=step(d,.5);edge=1.-smoothstep(.3,.5,d);}
      else if(kind<1.5){inside=step(.3,d)*step(d,.5);edge=1.-smoothstep(.4,.5,abs(d-.4)*2.5);}
      else if(kind<2.5){float m=abs(p.x)+abs(p.y);inside=step(m,.5);edge=1.-smoothstep(.3,.5,m);}
      else if(kind<3.5){float m=max(abs(p.x),abs(p.y));inside=step(m,.42);edge=1.-smoothstep(.25,.42,m);}
      else{float m=max(-p.x-.45,max(p.y-.3,-p.y-.3)+.75*(p.x+.45)*.8);inside=step(p.x,.5)*step(m,0.);edge=1.-smoothstep(-.3,0.,m);}
      if(inside<.5)discard;
      gl_FragColor=vec4(shade,opacity*(.55+.45*edge));
      #include <colorspace_fragment>
      }`,
  });
  constructor(private readonly defaultSize = 5, private readonly defaultColor: THREE.ColorRepresentation = 0xffffff, private readonly defaultShape: Shape = 'circle') {
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material); this.points.frustumCulled = false; this.points.renderOrder = 8;
  }
  set(markers: Marker[]) {
    this.markers = markers;
    const n = markers.length, geometry = this.points.geometry;
    if (n > this.capacity || n < this.capacity / 2) {
      this.capacity = Math.max(64, n);
      const attribute = (items: number) => new THREE.BufferAttribute(new Float32Array(this.capacity * items), items).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', attribute(3)); geometry.setAttribute('size', attribute(1)); geometry.setAttribute('tint', attribute(3)); geometry.setAttribute('shape', attribute(1)); geometry.setAttribute('tangent', attribute(3));
    }
    const at = (name: string) => geometry.getAttribute(name) as THREE.BufferAttribute;
    const position = at('position'), size = at('size'), tint = at('tint'), shape = at('shape'), tangent = at('tangent');
    const color = new THREE.Color(), east = new THREE.Vector3(), north = new THREE.Vector3(), up = new THREE.Vector3(), dir = new THREE.Vector3();
    markers.forEach((m, i) => {
      up.copy(globePoint(m.lat, m.lon, 1));
      up.clone().multiplyScalar(m.radius ?? 1.0002).toArray(position.array as Float32Array, i * 3);
      (size.array as Float32Array)[i] = m.size ?? this.defaultSize;
      color.set(m.color ?? this.defaultColor).toArray(tint.array as Float32Array, i * 3);
      (shape.array as Float32Array)[i] = SHAPES[m.shape ?? this.defaultShape];
      const heading = (m.heading ?? 0) * Math.PI / 180;
      east.set(-Math.sin(m.lon * Math.PI / 180), 0, -Math.cos(m.lon * Math.PI / 180)); north.crossVectors(up, east);
      dir.copy(east).multiplyScalar(Math.sin(heading)).addScaledVector(north, Math.cos(heading)).toArray(tangent.array as Float32Array, i * 3);
    });
    position.needsUpdate = size.needsUpdate = tint.needsUpdate = shape.needsUpdate = tangent.needsUpdate = true;
    geometry.setDrawRange(0, n);
  }
  resize(width: number, height: number) { this.material.uniforms.viewport.value.set(width / 2, height / 2); }
  // Nearest marker to a screen position, within its own drawn radius plus a little slack.
  pick(camera: THREE.Camera, x: number, y: number, width: number, height: number): Pick | null {
    if (!this.points.visible) return null;
    const eye = camera.position, ray = new THREE.Vector3(), foot = new THREE.Vector3();
    let best: Pick | null = null, bestDistance = Infinity;
    for (const m of this.markers) {
      if (!m.info) continue;
      const world = globePoint(m.lat, m.lon, m.radius ?? 1.0002);
      // Skip anything the globe itself hides: the eye-to-marker segment must clear the unit sphere.
      ray.subVectors(world, eye);
      const t = THREE.MathUtils.clamp(-eye.dot(ray) / Math.max(1e-12, ray.lengthSq()), 0, 1);
      if (t > 0 && t < 1 && foot.copy(eye).addScaledVector(ray, t).lengthSq() < 1) continue;
      projected.copy(world).project(camera);
      if (projected.z > 1) continue;
      const sx = (projected.x + 1) * width / 2, sy = (1 - projected.y) * height / 2;
      const distance = Math.hypot(sx - x, sy - y), reach = (m.size ?? this.defaultSize) / 2 + 6;
      if (distance < reach && distance < bestDistance) { bestDistance = distance; best = { info: m.info, x: sx, y: sy }; }
    }
    return best;
  }
  dispose() { this.points.geometry.dispose(); this.material.dispose(); }
}
