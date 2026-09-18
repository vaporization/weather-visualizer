import * as THREE from 'three';
import { EARTH_KM, globePoint } from './weatherShell';
type Tile = { z: number; x: number; y: number; mesh: THREE.Mesh; pixels: Uint8ClampedArray; texture: THREE.Texture; material: THREE.MeshPhongMaterial; fade: number; morph: { value: number } };
type Height = (lat: number, lon: number) => number;
export function mercatorTile(lat: number, lon: number, z: number) {
  const a = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
  return { x: (lon + 180) / 360 * 2 ** z, y: (1 - Math.asinh(Math.tan(a)) / Math.PI) / 2 * 2 ** z };
}
function tileLat(y: number, z: number) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI; }
function tileBounds(t: Tile) { return new THREE.Vector4(t.x / 2 ** t.z, (tileLat(t.y + 1, t.z) + 90) / 180, (t.x + 1) / 2 ** t.z, (tileLat(t.y, t.z) + 90) / 180); }
export function decodeHeight(r: number, g: number, b: number) { return (r * 256 + g + b / 256 - 32768) / 1000; }
async function image(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal }); if (!response.ok) throw new Error(`Tile unavailable (${response.status})`);
  return createImageBitmap(await response.blob());
}
function pixels(bitmap: ImageBitmap) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(bitmap, 0, 0); bitmap.close();
  return context.getImageData(0, 0, 256, 256).data;
}
function sample(data: Uint8ClampedArray, x: number, y: number, width = 256, height = 256) {
  const px = Math.max(0, Math.min(width - 1, x)), py = Math.max(0, Math.min(height - 1, y));
  const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
  const at = (x: number, y: number) => { const i = (Math.min(height - 1, y) * width + Math.min(width - 1, x)) * 4; return decodeHeight(data[i], data[i + 1], data[i + 2]); };
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), fx), THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), fx), fy);
}
const RESOLUTION = 80, SKIRT = .000025;
// Vertex order is fixed: the grid, then a skirt (top, bottom) pair per edge vertex. Both the
// true surface and a morph target are laid out with it, so a tile can be reshaped to match
// whatever surface is on screen and then eased into its own.
function tileVertices(z: number, x: number, y: number) {
  const side = RESOLUTION + 1, grid: { lat: number; lon: number; col: number; row: number }[] = [];
  for (let row = 0; row <= RESOLUTION; row++) for (let col = 0; col <= RESOLUTION; col++) grid.push({ lat: tileLat(y + row / RESOLUTION, z), lon: (x + col / RESOLUTION) / 2 ** z * 360 - 180, col, row });
  const edges = [Array.from({ length: side }, (_, i) => i), Array.from({ length: side }, (_, i) => i * side + RESOLUTION), Array.from({ length: side }, (_, i) => RESOLUTION * side + RESOLUTION - i), Array.from({ length: side }, (_, i) => (RESOLUTION - i) * side)];
  return { grid, edges };
}
function surface(vertices: ReturnType<typeof tileVertices>, height: (lat: number, lon: number, col: number, row: number) => number) {
  const { grid, edges } = vertices, out = new Float32Array((grid.length + edges.length * (RESOLUTION + 1) * 2) * 3);
  const tops = grid.map(v => globePoint(v.lat, v.lon, 1 + Math.max(0, height(v.lat, v.lon, v.col, v.row)) / EARTH_KM));
  tops.forEach((p, i) => p.toArray(out, i * 3));
  let n = grid.length;
  for (const edge of edges) for (const i of edge) { tops[i].toArray(out, n * 3); tops[i].clone().setLength(tops[i].length() - SKIRT).toArray(out, (n + 1) * 3); n += 2; }
  return out;
}
function tileGeometry(z: number, x: number, y: number, heights: Uint8ClampedArray, reference: Height) {
  const vertices = tileVertices(z, x, y), { grid, edges } = vertices, side = RESOLUTION + 1;
  const uv: number[] = [], globalUv: number[] = [], indices: number[] = [];
  for (const v of grid) {
    uv.push(v.col / RESOLUTION, 1 - v.row / RESOLUTION); globalUv.push((v.lon + 180) / 360, (v.lat + 90) / 180);
    if (v.row < RESOLUTION && v.col < RESOLUTION) { const a = v.row * side + v.col, b = a + 1, c = a + side, d = c + 1; indices.push(a, c, b, b, c, d); }
  }
  let n = grid.length;
  for (const edge of edges) edge.forEach((i, j) => {
    for (let k = 0; k < 2; k++) { uv.push(uv[i * 2], uv[i * 2 + 1]); globalUv.push(globalUv[i * 2], globalUv[i * 2 + 1]); }
    if (j < edge.length - 1) indices.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
    n += 2;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(surface(vertices, (_lat, _lon, col, row) => sample(heights, col / RESOLUTION * 255, row / RESOLUTION * 255)), 3));
  geometry.setAttribute('morphTarget', new THREE.Float32BufferAttribute(surface(vertices, reference), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setAttribute('globeUV', new THREE.Float32BufferAttribute(globalUv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}


// Cover everything inside the camera's horizon, in every direction rather than
// only the view cone, so turning or looking back never waits on a fresh stream.
// Refine by projected size regardless of selection or camera heading.
// The budget bounds GPU memory and network work even at a grazing horizon.
// The previous set gives hysteresis: a split that already exists survives until it is
// clearly too fine, and keeps its place in the budget ahead of a marginal newcomer, so
// a parked or slowly drifting camera does not churn its farthest tiles between levels.
export function visibleTerrainTiles(camera: THREE.PerspectiveCamera, viewportHeight: number, budget = 128, previous: [number, number, number][] = []) {
  camera.updateMatrixWorld();
  const split = new Set<string>();
  for (const [z, x, y] of previous) for (let level = z - 1, px = x >> 1, py = y >> 1; level >= 2; level--, px >>= 1, py >>= 1) split.add(`${level}/${px}/${py}`);
  const held = (t: { z: number; x: number; y: number }) => split.has(`${t.z}/${t.x}/${t.y}`);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const eye = camera.position.clone(), eyeLength = eye.length();
  const ground = eye.clone().normalize();
  const neighborhoodRadius = Math.max(.00015, 2 * Math.sin(Math.acos(Math.min(1, 1 / eyeLength)) / 2));
  const focal = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const describe = (z: number, x: number, y: number) => {
    const north = tileLat(y,z), south = tileLat(y+1,z), west = x / 2 ** z * 360 - 180, east = (x+1) / 2 ** z * 360 - 180;
    const center = globePoint((north+south)/2,(west+east)/2);
    const radius = Math.max(...[north,south].flatMap(lat => [west,east].map(lon => center.distanceTo(globePoint(lat,lon))))) + .002;
    const inView = frustum.intersectsSphere(new THREE.Sphere(center,radius));
    const nearby = center.distanceTo(ground) < neighborhoodRadius + radius;
    const visible = (inView || nearby) && center.dot(eye) + radius * eyeLength >= .995;
    const distance = Math.max(.00001,eye.distanceTo(center)-radius);
    return {z,x,y,visible,score:radius * 2 * focal / distance};
  };
  let leaves = Array.from({length:16},(_,i)=>describe(2,i%4,Math.floor(i/4))).filter(t=>t.visible);
  while (true) {
    const rank = (t: { score: number; z: number; x: number; y: number }) => t.score + (held(t) ? 190 : 0);
    const candidates = leaves.filter(t=>t.z<19 && (t.score>380 || (held(t) && t.score>200))).sort((a,b)=>rank(b)-rank(a));
    let refined = false;
    for(const tile of candidates) {
      const children = [0,1,2,3].map(i=>describe(tile.z+1,tile.x*2+i%2,tile.y*2+Math.floor(i/2))).filter(t=>t.visible);
      if(leaves.length-1+children.length>budget)continue;
      leaves = leaves.filter(t=>t!==tile).concat(children);refined=true;break;
    }
    if(!refined)break;
  }
  return leaves.sort((a,b)=>a.z-b.z || a.y-b.y || a.x-b.x).map(t=>[t.z,t.x,t.y] as [number,number,number]);
}

export class Terrain {
  revision = 0;
  readonly group = new THREE.Group();
  private tiles: Tile[] = [];
  private retiring: Tile[] = [];
  // Tiles the camera has left stay loaded for a while: coming back should cost no request.
  private cache = new Map<string, { tile: Tile; seen: number }>();
  private cacheLimit = 128;
  private budget = 128;
  private requests: [number, number, number][] = [];
  private loadedAt = new THREE.Vector3();
  private loadedHeight = 0;
  private basePixels: Uint8ClampedArray | null = null;
  private controller = new AbortController();
  private tileController: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentKey = '';
  private disposed = false;
  private retryAfter = 0;
  private cutCount = { value: 0 };
  private cutCapacity = 128;
  private cuts = { value: Array.from({ length: 128 }, () => new THREE.Vector4()) };
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private shadow = {
    cloudMap: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) }, cloudCenter: { value: new THREE.Vector3() },
    cloudEast: { value: new THREE.Vector3(1, 0, 0) }, cloudNorth: { value: new THREE.Vector3(0, 1, 0) }, cloudSun: { value: new THREE.Vector3(0, 1, 0) },
    cloudWidthKm: { value: 160 }, cloudBaseKm: { value: 1.2 }, cloudShadow: { value: 0 },
  };
  constructor(private base: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhongMaterial>, private report: (message: string) => void, private warm: (texture: THREE.Texture) => void = () => {}) {
    const uniforms = { terrainCuts: this.cuts, terrainCutCount: this.cutCount };
    base.material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      const n = this.cutCapacity;
      shader.vertexShader = 'varying vec2 terrainUV;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nterrainUV=uv;');
      shader.fragmentShader = `varying vec2 terrainUV; uniform vec4 terrainCuts[${n}]; uniform int terrainCutCount;\n` + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nfor(int j=0;j<${n};j++){if(j>=terrainCutCount)break;vec4 b=terrainCuts[j];if(terrainUV.x>b.x&&terrainUV.x<b.z&&terrainUV.y>b.y&&terrainUV.y<b.w)discard;}`);
      this.injectCloudShadow(shader);
    };
    this.loadGlobal();
  }
  // Every opaque tile needs a cut beneath it or the coarse globe surfaces through valleys, so the
  // cut list must hold the whole budget. Call once, before the first frame, with the GPU's limit.
  setCapacity(maxFragmentUniforms: number) {
    this.cutCapacity = maxFragmentUniforms >= 420 ? 288 : 128;
    this.cuts.value = Array.from({ length: this.cutCapacity }, () => new THREE.Vector4());
  }
  // A tile is drawn at mix(position, morphTarget, tileMorph): an arriving tile starts on the
  // surface it replaces and eases into its own; a departing one eases toward its successor.
  private injectTile(shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }, morph: { value: number }) {
    this.injectCloudShadow(shader);
    shader.uniforms.tileMorph = morph;
    shader.vertexShader = 'attribute vec3 morphTarget; uniform float tileMorph;\n' + shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed=mix(vec3(position),morphTarget,tileMorph);');
  }
  // Height of whatever is on screen at a point, sampled from the finest tile covering it.
  private referenceFor(z: number, x: number, y: number, pool: Tile[]): Height {
    const centerOf = (t: { z: number; x: number; y: number }) => ({ lat: tileLat(t.y + .5, t.z), lon: (t.x + .5) / 2 ** t.z * 360 - 180 });
    const contains = (t: { z: number; x: number; y: number }, p: { lat: number; lon: number }) => { const m = mercatorTile(p.lat, p.lon, t.z); return Math.floor(m.x) === t.x && Math.floor(m.y) === t.y; };
    const me = { z, x, y }, center = centerOf(me);
    const candidates = pool.filter(t => t.z <= z ? contains(t, center) : contains(me, centerOf(t))).sort((a, b) => b.z - a.z);
    return (lat, lon) => {
      for (const t of candidates) { const m = mercatorTile(lat, lon, t.z); if (Math.floor(m.x) === t.x && Math.floor(m.y) === t.y) return sample(t.pixels, (m.x - t.x) * 255, (m.y - t.y) * 255); }
      const m = mercatorTile(lat, lon, 2); return this.basePixels ? sample(this.basePixels, m.x * 256, m.y * 256, 1024, 1024) : 0;
    };
  }
  private retarget(tile: Tile, reference: Height) {
    const attribute = tile.mesh.geometry.getAttribute('morphTarget') as THREE.BufferAttribute;
    (attribute.array as Float32Array).set(surface(tileVertices(tile.z, tile.x, tile.y), reference)); attribute.needsUpdate = true;
  }
  // Offset the regional cover field along the sun to land the shade away from the cloud.
  private injectCloudShadow(shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }) {
    Object.assign(shader.uniforms, this.shadow);
    shader.vertexShader = 'varying vec3 cloudWorld;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ncloudWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = `varying vec3 cloudWorld; uniform sampler2D cloudMap; uniform vec3 cloudCenter,cloudEast,cloudNorth,cloudSun; uniform float cloudWidthKm,cloudBaseKm,cloudShadow;\n`
      + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        if(cloudShadow>.5){
          vec3 delta=cloudWorld*${EARTH_KM}.-cloudCenter;
          vec2 xy=vec2(dot(delta,cloudEast),dot(delta,cloudNorth));
          vec2 lit=xy-vec2(dot(cloudSun,cloudEast),dot(cloudSun,cloudNorth))*cloudBaseKm/max(.08,dot(cloudSun,normalize(cloudWorld)));
          vec3 cover=texture2D(cloudMap,lit/cloudWidthKm+.5).rgb;
          float reach=(1.-smoothstep(cloudWidthKm*.38,cloudWidthKm*.5,length(xy)))*smoothstep(0.,.12,dot(cloudSun,normalize(cloudWorld)));
          diffuseColor.rgb*=1.-clamp(cover.r*.62+cover.g*.22,0.,.66)*reach;
        }`);
  }
  setCloudShadow(map: THREE.Texture, center: THREE.Vector3, east: THREE.Vector3, north: THREE.Vector3, sun: THREE.Vector3, widthKm: number, baseKm: number, enabled: boolean) {
    this.shadow.cloudMap.value = map as THREE.DataTexture; this.shadow.cloudCenter.value.copy(center);
    this.shadow.cloudEast.value.copy(east); this.shadow.cloudNorth.value.copy(north); this.shadow.cloudSun.value.copy(sun);
    this.shadow.cloudWidthKm.value = widthKm; this.shadow.cloudBaseKm.value = baseKm; this.shadow.cloudShadow.value = enabled ? 1 : 0;
  }
  private async loadGlobal() {
    try {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const tasks = Array.from({ length: 16 }, (_, i) => async () => { const x = i % 4, y = Math.floor(i / 4); const bitmap = await image(`/api/tiles/elevation/2/${x}/${y}`, this.controller.signal); ctx.drawImage(bitmap, x * 256, y * 256); bitmap.close(); });
      // Bounded concurrent requests keep interaction responsive and avoid a tile-provider burst.
      let next = 0; await Promise.all(Array.from({ length: 4 }, async () => { while (next < tasks.length) await tasks[next++](); }));
      if (this.disposed) return;
      this.basePixels = ctx.getImageData(0, 0, 1024, 1024).data;
      const pos = this.base.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
        const lat = Math.asin(p.y) * 180 / Math.PI, lon = Math.atan2(-p.z, p.x) * 180 / Math.PI;
        const tile = mercatorTile(lat, lon, 2);
        const h = Math.abs(lat) > 85.05 ? 0 : Math.max(0, sample(this.basePixels, tile.x * 256, tile.y * 256, 1024, 1024));
        p.multiplyScalar(1 + h / EARTH_KM); pos.setXYZ(i, p.x, p.y, p.z);
      }
      this.revision++; pos.needsUpdate = true; this.base.geometry.computeVertexNormals(); this.base.geometry.computeBoundingSphere();
      if (!this.tiles.length) this.report('Global terrain · true elevation');
    } catch (e) { if (!this.disposed) this.report('Global elevation unavailable · spherical fallback'); }
  }
  elevationAt(lat: number, lon: number) {
    for (const tile of this.tiles) { const p = mercatorTile(lat, lon, tile.z); if (Math.floor(p.x) === tile.x && Math.floor(p.y) === tile.y) return Math.max(0, sample(tile.pixels, (p.x - tile.x) * 255, (p.y - tile.y) * 255)); }
    const p = mercatorTile(lat, lon, 2); return this.basePixels ? Math.max(0, sample(this.basePixels, p.x * 256, p.y * 256, 1024, 1024)) : 0;
  }
  // Detail spreads over the whole horizon, so a wider view needs more tiles to hold it.
  setDetail(quality: 'balanced' | 'high' | 'ultra') {
    const budget = Math.min(this.cutCapacity, quality === 'ultra' ? 288 : quality === 'high' ? 192 : 128);
    this.cacheLimit = quality === 'ultra' ? 256 : quality === 'high' ? 192 : 128;
    if (budget === this.budget) return;
    this.budget = budget; this.currentKey = '';
  }
  private retain(tiles: Tile[]) {
    const now = Date.now();
    for (const tile of tiles) {
      const key = `${tile.z}/${tile.x}/${tile.y}`, previous = this.cache.get(key);
      if (previous && previous.tile !== tile) this.disposeTiles([previous.tile]);
      this.group.remove(tile.mesh); this.cache.set(key, { tile, seen: now });
    }
    this.purge(now);
  }
  // Retained tiles expire three minutes after the camera last showed them. Anything on
  // screen stays out of this map entirely, so a parked camera never re-requests its view.
  private purge(now: number) {
    for (const [key, entry] of this.cache) if (now - entry.seen > 180000) { this.cache.delete(key); this.disposeTiles([entry.tile]); }
    while (this.cache.size > this.cacheLimit) {
      const oldest = this.cache.entries().next().value;
      if (!oldest) break;
      this.cache.delete(oldest[0]); this.disposeTiles([oldest[1].tile]);
    }
  }
  // The base sphere may only be cut where an opaque tile already covers it; the finest tiles
  // take the slots first because coarse cover differs from them most, should any be short.
  private applyCuts() {
    const opaque = [...this.retiring, ...this.tiles].filter(t => t.fade >= 1).sort((a, b) => b.z - a.z).slice(0, this.cutCapacity);
    opaque.forEach((t, i) => this.cuts.value[i].copy(tileBounds(t)));
    this.cutCount.value = opaque.length;
  }
  // One easing drives a swap: arriving tiles gain opacity and settle into their own shape while
  // the tiles beneath ease toward that shape, so the two surfaces coincide at every instant.
  advance(seconds: number) {
    const fading = this.tiles.filter(t => t.fade < 1);
    if (!fading.length) {
      if (!this.retiring.length) return;
      this.retain(this.retiring); this.retiring = [];
      return this.applyCuts();
    }
    for (const tile of fading) { tile.fade = Math.min(1, tile.fade + seconds * 2.5); tile.material.opacity = tile.fade; tile.morph.value = 1 - tile.fade; }
    const alpha = Math.min(...fading.map(t => t.fade));
    for (const tile of this.retiring) {
      tile.morph.value = alpha;
      // A predecessor that was itself still appearing keeps appearing, so the composite never darkens.
      if (tile.fade < 1) { tile.fade = Math.min(1, tile.fade + seconds * 2.5); tile.material.opacity = tile.fade; }
    }
    this.applyCuts();
  }
  update(camera: THREE.PerspectiveCamera, viewportHeight: number) {
    this.purge(Date.now());
    if (Date.now() < this.retryAfter) return;
    // Damping and leveling nudge a parked camera every frame; ignore motion under 1% of altitude.
    const altitude = Math.max(1e-6, camera.position.length() - 1);
    if (this.currentKey && viewportHeight === this.loadedHeight && camera.position.distanceTo(this.loadedAt) < altitude * .01) return;
    const requests = visibleTerrainTiles(camera, viewportHeight, this.budget, this.requests);
    const key = requests.map(t=>t.join('/')).join(','); if(key===this.currentKey)return;
    this.currentKey=key; this.requests=requests; this.loadedAt.copy(camera.position); this.loadedHeight=viewportHeight;
    if(this.timer)clearTimeout(this.timer);
    this.timer=setTimeout(()=>this.loadView(requests,key),350);
  }
  private async loadView(requests: [number,number,number][], key: string) {
    this.tileController?.abort(); const controller = new AbortController(); this.tileController = controller;
    this.report('Refining visible terrain');
    const tiles: Tile[] = [], created: Tile[] = [];
    try {
      let next = 0, failed = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (next < requests.length && !controller.signal.aborted) {
          const [level, x, y] = requests[next++];
          const cached = this.cache.get(`${level}/${x}/${y}`);
          const existing = this.tiles.find(t=>t.z===level && t.x===x && t.y===y) ?? this.retiring.find(t=>t.z===level && t.x===x && t.y===y) ?? cached?.tile;
          if(existing){if(cached)this.cache.delete(`${level}/${x}/${y}`);tiles.push(existing);continue;}
          const demLevel = Math.min(14, level), demScale = 2 ** (level - demLevel);
          const results = await Promise.allSettled([image(`/api/tiles/elevation/${demLevel}/${Math.floor(x / demScale)}/${Math.floor(y / demScale)}`, controller.signal), image(`/api/tiles/imagery/${level}/${x}/${y}`, controller.signal)]);
          // One missing tile leaves the coarse globe showing there; a failing provider is caught below.
          if (results.some(r => r.status === 'rejected')) { results.forEach(r => { if (r.status === 'fulfilled') r.value.close(); }); failed++; continue; }
          const dem = (results[0] as PromiseFulfilledResult<ImageBitmap>).value, rgb = (results[1] as PromiseFulfilledResult<ImageBitmap>).value;
          let heights = pixels(dem);
          if (demScale > 1) {
            const parent = heights; heights = new Uint8ClampedArray(256 * 256 * 4);
            for (let row = 0; row < 256; row++) for (let col = 0; col < 256; col++) {
              const h = sample(parent, ((x % demScale) + col / 255) / demScale * 255, ((y % demScale) + row / 255) / demScale * 255) * 1000 + 32768;
              const i = (row * 256 + col) * 4;
              heights[i] = Math.floor(h / 256); heights[i + 1] = Math.floor(h) % 256; heights[i + 2] = Math.round((h - Math.floor(h)) * 255); heights[i + 3] = 255;
            }
          }
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; canvas.getContext('2d')!.drawImage(rgb, 0, 0); rgb.close();
          const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
          this.warm(texture);
          // Tiles stay transparent so a refined level can dissolve in instead of snapping.
          const morph = { value: 1 };
          const material = new THREE.MeshPhongMaterial({ map: texture, shininess: 3, specular: 0x142229, color: 0xd5dce0, transparent: true, opacity: 0, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
          material.onBeforeCompile = shader => this.injectTile(shader, morph);
          const mesh = new THREE.Mesh(tileGeometry(level, x, y, heights, this.referenceFor(level, x, y, [...this.tiles, ...this.retiring])), material);
          const tile = { z: level, x, y, mesh, pixels: heights, texture, material, fade: 0, morph }; tiles.push(tile); created.push(tile);
        }
      }));
      if (failed > Math.max(4, requests.length * .25)) throw new Error('Incomplete terrain patch');
      // A view overtaken mid-load still paid for its tiles; keep them for the view that overtook it.
      if (this.disposed || this.currentKey !== key || controller.signal.aborted) { if (this.disposed) this.disposeTiles(created); else this.retain(created); return; }
      const carried = new Set(tiles), replaced = this.tiles.filter(t => !carried.has(t));
      this.retain(this.retiring.filter(t => !carried.has(t)));
      // Everything just replaced stays beneath its successor, including tiles still appearing, and
      // eases toward the incoming surface while the successor fades in over it.
      this.retiring = replaced;
      for (const t of this.retiring) { t.material.polygonOffsetUnits = -1; this.retarget(t, this.referenceFor(t.z, t.x, t.y, tiles)); t.morph.value = 0; }
      this.tiles = tiles.sort((a,b)=>b.z-a.z);
      for (const t of this.tiles) { t.material.polygonOffsetUnits = -2; if (!created.includes(t) && t.fade >= 1) t.morph.value = 0; }
      this.group.clear(); this.retiring.forEach(t=>this.group.add(t.mesh)); this.tiles.forEach(t=>this.group.add(t.mesh));
      this.applyCuts(); this.revision++;
      this.report(`Visible terrain · ${tiles.length} tiles · levels ${Math.min(...tiles.map(t=>t.z))}–${Math.max(...tiles.map(t=>t.z))}${failed?` · ${failed} unavailable`:''}`);
      // Missing tiles are asked for again once the provider has had a moment, without disturbing the rest.
      if (this.retryTimer) clearTimeout(this.retryTimer);
      if (failed) this.retryTimer = setTimeout(() => { if (!this.disposed && this.currentKey === key) this.currentKey = ''; }, 15000);
    } catch { this.disposeTiles(created); if (!controller.signal.aborted && !this.disposed) { this.currentKey = ''; this.retryAfter = Date.now() + 30000; this.report('Detailed terrain unavailable · global elevation retained'); } }
  }
  private disposeTiles(tiles: Tile[]) { tiles.forEach(t => { t.mesh.geometry.dispose(); (t.mesh.material as THREE.Material).dispose(); t.texture.dispose(); }); }
  dispose() { this.disposed = true; this.controller.abort(); this.tileController?.abort(); if (this.timer) clearTimeout(this.timer); if (this.retryTimer) clearTimeout(this.retryTimer); this.disposeTiles(this.tiles); this.disposeTiles(this.retiring); this.disposeTiles([...this.cache.values()].map(e => e.tile)); this.cache.clear(); }
}
