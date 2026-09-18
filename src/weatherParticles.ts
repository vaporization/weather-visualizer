import { windPaletteGLSL } from './windPalette';
import * as THREE from 'three';
import { EARTH_KM, globePoint } from './weatherShell';
import { hourlyIndex, type AtmosphereState } from './atmosphere';
import type { GlobalWeather } from './weatherMap';
import type { Layers, Location } from './weather';

export class WeatherParticles {
  readonly rain: THREE.LineSegments;
  readonly snow: THREE.Points;
  readonly wind: THREE.LineSegments;
  private windClock = { value: 0 };
  private windReady = false;
  private uniforms = {
    clock: { value: 0 }, anchor: { value: new THREE.Vector3() }, east: { value: new THREE.Vector3() }, north: { value: new THREE.Vector3() }, radial: { value: new THREE.Vector3() },
    heightKm: { value: 1 }, elevationKm: { value: 0 }, windVector: { value: new THREE.Vector2() }, snowing: { value: 0 }, opacity: { value: .5 },
  };
  constructor() {
    const seed: number[] = [], tail: number[] = [];
    for (let i = 0; i < 6000; i++) {
      const a = Math.sin(i * 127.1 + 31.7) * 43758.5453, b = Math.sin(i * 311.7 + 9.1) * 23563.324, c = Math.sin(i * 53.3 + 78.7) * 95451.523;
      const p = [a - Math.floor(a), b - Math.floor(b), c - Math.floor(c)]; seed.push(...p, ...p); tail.push(0, 1);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(seed, 3)); geometry.setAttribute('tail', new THREE.Float32BufferAttribute(tail, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float tail;uniform vec3 anchor,east,north,radial;uniform vec2 windVector;uniform float clock,heightKm,elevationKm,snowing;varying float fade;
        void main(){float speed=mix(.009,.0012,snowing);float h=fract(position.z-clock*speed/max(.1,heightKm))*heightKm;
        vec2 offset=(position.xy-.5)*1.1;offset+=windVector*h/max(.001,speed)*.15;offset=mod(offset+.55,1.1)-.55;
        float trail=mix(.004,.0003,snowing)*tail;
        vec3 world=anchor+(east*offset.x+north*offset.y+radial*(h+elevationKm-trail))/6371.;
        fade=(1.-smoothstep(.32,.65,length(offset)))*smoothstep(0.,.02,h);
        vec4 mvPosition=viewMatrix*vec4(world,1.);gl_Position=projectionMatrix*mvPosition;gl_PointSize=2.1;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <logdepthbuf_pars_fragment>
        varying float fade;uniform float opacity,snowing;
        void main(){
        #include <logdepthbuf_fragment>
        gl_FragColor=vec4(mix(vec3(.55,.69,.79),vec3(.93,.96,1.),snowing),fade*opacity);
        #include <colorspace_fragment>
        }`,
    });
    this.rain = new THREE.LineSegments(geometry, material); this.rain.frustumCulled = false;
    this.snow = new THREE.Points(geometry, material); this.snow.frustumCulled = false;
    this.wind = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
      uniforms: { clock: this.windClock }, transparent: true, depthWrite: false,
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float progress;attribute float seed;attribute float windSpeed;uniform float clock;varying float alpha;varying float localSpeed;
        void main(){localSpeed=windSpeed;float head=fract(seed+clock*.065);float age=mod(head-progress+1.,1.);alpha=(1.-smoothstep(0.,.3,age))*smoothstep(0.,.08,progress)*(1.-smoothstep(.9,1.,progress));
        vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <logdepthbuf_pars_fragment>
        varying float alpha;varying float localSpeed;
        ${windPaletteGLSL}
        void main(){
        #include <logdepthbuf_fragment>
        gl_FragColor=vec4(windSpeedColor(localSpeed),alpha*.85);
        }`,
    }));
    this.wind.frustumCulled = false; this.wind.renderOrder = 30;
  }
  update(camera: THREE.Camera, location: Location, a: AtmosphereState, layers: Layers, seconds: number) {
    const pos = camera.position.clone().normalize(), east = new THREE.Vector3(-pos.z, 0, pos.x).normalize().negate(), north = pos.clone().cross(east);
    const cameraAltitude = (camera.position.length() - 1) * EARTH_KM;
    const distance = camera.position.clone().normalize().distanceTo(globePoint(location.lat, location.lon)) * EARTH_KM;
    const visible = layers.precipitation && a.rain > .01 && cameraAltitude < a.elevationKm + a.baseKm + a.thicknessKm && distance < 75;
    this.rain.visible = visible && a.snow <= 0; this.snow.visible = visible && a.snow > 0;
    this.uniforms.anchor.value.copy(pos); this.uniforms.radial.value.copy(pos); this.uniforms.east.value.copy(east); this.uniforms.north.value.copy(north);
    this.uniforms.heightKm.value = a.baseKm; this.uniforms.elevationKm.value = a.elevationKm; this.uniforms.clock.value = seconds; this.uniforms.snowing.value = a.snow > 0 ? 1 : 0; this.uniforms.windVector.value.set(a.wind[0], -a.wind[1]);
    this.rain.geometry.setDrawRange(0, Math.min(12000, Math.round(500 + a.rain * 1200)));
    this.windClock.value = seconds;
    this.wind.visible = layers.wind && this.windReady;
  }
  setWindData(data: GlobalWeather | null, time: string | undefined, hour: number) {
    this.windReady = false;
    if (!data || !data.points.every(p => p.wind_direction_10m)) { this.wind.geometry.dispose(); this.wind.geometry = new THREE.BufferGeometry(); return; }
    const vectors = data.points.map(p => {
      const index = hourlyIndex(p.time, time, hour), speed = Number(p.wind_speed_10m[index]), angle = Number(p.wind_direction_10m[index]) * Math.PI / 180;
      return [-Math.sin(angle) * speed, -Math.cos(angle) * speed, speed];
    });
    const sample = (lat: number, lon: number) => {
      const x = ((lon + 180) / 360 * data.width - .5 + data.width) % data.width;
      const y = THREE.MathUtils.clamp((lat + 90) / 180 * data.height - .5, 0, data.height - 1);
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const at = (dx: number, dy: number) => vectors[Math.min(data.height - 1, iy + dy) * data.width + (ix + dx) % data.width];
      return [0, 1, 2].map(c => THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(0, 0)[c], at(1, 0)[c], fx), THREE.MathUtils.lerp(at(0, 1)[c], at(1, 1)[c], fx), fy));
    };
    const positions: number[] = [], progress: number[] = [], seeds: number[] = [], speeds: number[] = [];
    for (let i = 0; i < 4500; i++) {
      let lat = Math.asin(1 - 2 * (i + .5) / 4500) * 180 / Math.PI, lon = ((i * 137.508) % 360) - 180;
      let previous = globePoint(lat, lon, 1.002);
      for (let j = 0; j < 16; j++) {
        const [u, v, speed] = sample(lat, lon);
        lat = THREE.MathUtils.clamp(lat + v / 111.32, -89.8, 89.8);
        lon = ((lon + u / (111.32 * Math.max(.08, Math.cos(lat * Math.PI / 180))) + 540) % 360) - 180;
        const next = globePoint(lat, lon, 1.002);
        speeds.push(speed, sample(lat, lon)[2]);
        positions.push(...previous.toArray(), ...next.toArray()); progress.push(j / 16, (j + 1) / 16); seeds.push((i * .618034) % 1, (i * .618034) % 1); previous = next;
      }
    }
    this.wind.geometry.dispose(); this.wind.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)).setAttribute('progress', new THREE.Float32BufferAttribute(progress, 1)).setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1)).setAttribute('windSpeed', new THREE.Float32BufferAttribute(speeds, 1));
    this.windReady = true;
  }
  dispose() { this.rain.geometry.dispose(); (this.rain.material as THREE.Material).dispose(); this.wind.geometry.dispose(); (this.wind.material as THREE.Material).dispose(); }
}
