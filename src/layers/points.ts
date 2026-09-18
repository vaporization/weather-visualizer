import * as THREE from 'three';
import { globePoint } from '../weatherShell';
export type Marker = { lat: number; lon: number; radius?: number; size?: number; color?: THREE.ColorRepresentation };
// Screen-sized markers on the globe: size and colour per point, depth-tested so the far side hides them.
export class PointCloud {
  readonly points: THREE.Points;
  private capacity = 0;
  private material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { opacity: { value: .95 } },
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float size;attribute vec3 tint;varying vec3 shade;
      void main(){shade=tint;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=size;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float opacity;varying vec3 shade;
      void main(){
      #include <logdepthbuf_fragment>
      float d=length(gl_PointCoord-.5);if(d>.5)discard;
      float edge=1.-smoothstep(.3,.5,d);
      gl_FragColor=vec4(shade,opacity*(.55+.45*edge));
      #include <colorspace_fragment>
      }`,
  });
  constructor(private readonly defaultSize = 5, private readonly defaultColor: THREE.ColorRepresentation = 0xffffff) {
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material); this.points.frustumCulled = false; this.points.renderOrder = 8;
  }
  set(markers: Marker[]) {
    const n = markers.length, geometry = this.points.geometry;
    if (n > this.capacity || n < this.capacity / 2) {
      this.capacity = Math.max(64, n);
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(this.capacity), 1).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
    }
    const position = geometry.getAttribute('position') as THREE.BufferAttribute, size = geometry.getAttribute('size') as THREE.BufferAttribute, tint = geometry.getAttribute('tint') as THREE.BufferAttribute;
    const color = new THREE.Color();
    markers.forEach((m, i) => {
      globePoint(m.lat, m.lon, m.radius ?? 1.0002).toArray(position.array as Float32Array, i * 3);
      (size.array as Float32Array)[i] = m.size ?? this.defaultSize;
      color.set(m.color ?? this.defaultColor).toArray(tint.array as Float32Array, i * 3);
    });
    position.needsUpdate = size.needsUpdate = tint.needsUpdate = true;
    geometry.setDrawRange(0, n);
  }
  dispose() { this.points.geometry.dispose(); this.material.dispose(); }
}
