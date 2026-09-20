import { loadRadarAtlas, type RadarData } from './radar';
import { FlightLayer, type FlightData } from './flights';
import { connectedPads, readPad } from './gamepad';
import { StreetOverlay, type StreetData, type StreetOptions } from './StreetOverlay';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { type Layers, type Location, places } from './weather';
import { type AtmosphereState, type Quality, solarDirection } from './atmosphere';
import { EARTH_KM, globePoint, WeatherShell } from './weatherShell';
import { Terrain } from './terrain';
import { applyNorthUp, cameraTiltPercent, northScreenAngle, lookWithStick, moveOverGlobe, levelSurfaceHorizon } from './camera';
import { loadSatellite } from './satellite';
import { WeatherParticles } from './weatherParticles';
import { cloudTexture, globalTexture, type GlobalWeather, type MapMode } from './weatherMap';
import { TornadoLayer, type TornadoData } from './tornado';
import { layerCatalog } from './layers/catalog';
import type { GlobeLayer } from './layers/types';
import type { Anchor, Info } from './layers/points';
import { flightPosition } from './flights';

export type GlobeAPI = { zoom: (factor: number) => void; reset: () => void; focus: () => void; streets: () => void };
export type RenderStats = { fps: number; tiltPercent: number; altitudeKm: number; gpu: string; terrain: string; satellite: string };
type Props = { radarOpacity:number; onRadarStatus:(status:string)=>void; horizonLevel: boolean; onToggleHorizon: () => void; onCompassChange: (angle: number | null) => void; northUp: boolean; flightData: FlightData | null; gamepadEnabled: boolean; streetData: StreetData | null; streetOptions: StreetOptions; onTiltChange: (tilt: number) => void; onLook: (tilt: number) => void; tiltLocked: boolean; cameraTilt: number; mapOpacity: number; globalWeather: GlobalWeather | null; mapMode: MapMode; time?: string; hour: number; location: Location; atmosphere: AtmosphereState; layers: Layers; polygons: number[][][]; demo: boolean; stormActive: boolean; stormRadiusKm: number; tornadoData: TornadoData | null; extraLayers: Record<string, unknown>; quality: Quality; satellite: boolean; onSelect: (p: Location) => void; onReady: (api: GlobeAPI) => void; onStats: (stats: RenderStats) => void };
function coordinates(p: THREE.Vector3): Location { const n = p.clone().normalize(); return { lat: Math.asin(n.y) * 180 / Math.PI, lon: Math.atan2(-n.z, n.x) * 180 / Math.PI, name: 'Selected location', region: 'Earth · geographic selection' }; }
function dispose(group: THREE.Object3D) { group.traverse(obj => { const m = obj as THREE.Mesh; m.geometry?.dispose(); if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mat => mat.dispose()); }); }
function sunGlow() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!, gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(.12, 'rgba(255,248,226,.98)');
  gradient.addColorStop(.3, 'rgba(255,214,140,.32)'); gradient.addColorStop(.62, 'rgba(255,186,104,.08)'); gradient.addColorStop(1, 'rgba(255,186,104,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export default function GlobeScene(props: Props) {
  const host = useRef<HTMLDivElement>(null); const latest = useRef(props); latest.current = props;
  const state = useRef<{ flights: FlightLayer; streets: StreetOverlay; shell: WeatherShell; particles: WeatherParticles; grid: THREE.Group; extent: THREE.Group; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; focus: (near: boolean) => void; marker: THREE.Group; sun: THREE.DirectionalLight; sunSprite: THREE.Sprite; terrain: Terrain; tornadoes: TornadoLayer; scene: THREE.Scene; dataLayers: Map<string, GlobeLayer>; ambient: THREE.AmbientLight } | null>(null);
  const clickedLocation = useRef<Location | null>(null);
  const mountedLocation = useRef<Location>(props.location);
  useEffect(() => {
    const el = host.current!; let alive = true;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true }); }
    catch { el.insertAdjacentHTML('beforeend', '<div class="webgl-error">WebGL2 could not start. Enable browser hardware acceleration and reload to render the globe.</div>'); return; }
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0, 0); el.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute('aria-label', 'Interactive Earth. Drag to orbit; scroll to enter the atmosphere. Right-drag to pan. Hold the middle mouse button and drag to look around.');
    const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string : 'WebGL2 hardware renderer';
    const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(42, 1, .000001, 80);
    camera.position.copy(globePoint(25, -60, 3.8));
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .075;
    controls.enableZoom = false; controls.minDistance = 1.00001; controls.maxDistance = 7; controls.rotateSpeed = .42; controls.zoomSpeed = .65; controls.panSpeed = .3;
    const map = new THREE.TextureLoader().load('/textures/earth.jpg'); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 512, 256), new THREE.MeshPhongMaterial({ map, shininess: 7, specular: 0x223540, color: 0xcbd4d9 })); scene.add(earth);
    const sun = new THREE.DirectionalLight(0xfff7e5, 2.5); scene.add(sun);
    // The globe occludes the disc through the depth buffer, so it sets behind the horizon.
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunGlow(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sunSprite.scale.setScalar(1.4); sunSprite.renderOrder = 5; scene.add(sunSprite);
    const ambient = new THREE.AmbientLight(0x9baccc, .5); scene.add(ambient);
    let terrainStatus = 'Loading global elevation…', satelliteStatus = 'Loading NASA satellite coverage…';
    const terrain = new Terrain(earth, message => { terrainStatus = message; }, texture => renderer.initTexture(texture));
    terrain.setCapacity(renderer.capabilities.maxFragmentUniforms); scene.add(terrain.group);
    const streets = new StreetOverlay(); scene.add(streets.mesh);
    const shell = new WeatherShell(); scene.add(shell.mesh);
    const terrainDepth = new THREE.WebGLRenderTarget(1, 1);
    terrainDepth.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    shell.material.uniforms.sceneDepth.value = terrainDepth.depthTexture;
    const flights = new FlightLayer(); scene.add(flights.group); let flightTick=0;
    const particles = new WeatherParticles(); scene.add(particles.rain, particles.snow, particles.wind);
    const tornadoes = new TornadoLayer(); scene.add(tornadoes.group);
    const dataLayers = new Map<string, GlobeLayer>();
    const satelliteController = new AbortController();
    const date = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    loadSatellite(date, satelliteController.signal).then(({ texture, instruments }) => {
      if (!alive) { texture.dispose(); return; }
      shell.setSatellite(texture); satelliteStatus = `NASA MODIS · ${date} · ${instruments} satellite pass products`;
    }).catch(() => { if (alive) satelliteStatus = 'Satellite unavailable · model volume only'; });


    const grid = new THREE.Group(); const gridMat = new THREE.LineBasicMaterial({ color: 0x8dc2cf, transparent: true, opacity: .1 });
    for (let lat = -60; lat <= 60; lat += 30) grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 181 }, (_, i) => globePoint(lat, i * 2 - 180, 1.0016))), gridMat));
    for (let lon = -180; lon < 180; lon += 30) grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 91 }, (_, i) => globePoint(i * 2 - 90, lon, 1.0016))), gridMat));
    scene.add(grid);
    const starPoints = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) starPoints.set(globePoint(Math.sin(i * 9.31) * 90, i * 137.5 % 360, 25).toArray(), i * 3);
    const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(starPoints, 3)), new THREE.PointsMaterial({ color: 0x99afcb, size: .012, transparent: true, opacity: .5 })); scene.add(stars);
    const extent = new THREE.Group(), marker = new THREE.Group(); scene.add(extent, marker);
    marker.add(new THREE.Mesh(new THREE.SphereGeometry(.004, 12, 12), new THREE.MeshBasicMaterial({ color: 0xbcffe0 })), new THREE.Mesh(new THREE.RingGeometry(.009, .011, 40), new THREE.MeshBasicMaterial({ color: 0xbcffe0, side: THREE.DoubleSide, transparent: true, opacity: .8 })));
    let destination: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 } | null = null;
    let previousTiltSetting = latest.current.cameraTilt, previousTiltLock = latest.current.tiltLocked;
    let clickAim: THREE.Vector3 | null = null;
    const toggleHorizon=()=>latest.current.onToggleHorizon();
    const previousOrientation = new THREE.Quaternion();
    let tilt = 0, heading = 0, roll = 0, reportedTilt = -1;
    const viewDirection = new THREE.Vector3(), nadir = new THREE.Vector3();
    let zoomRadius: number | null = null;
    const zoom = (factor: number) => {
      if (clickAim) {
        const position = (destination?.position ?? camera.position).clone().sub(clickAim).multiplyScalar(factor).add(clickAim);
        const at = coordinates(position), minimum = 1 + (terrain.elevationAt(at.lat, at.lon) + .065) / EARTH_KM;
        position.clampLength(minimum, 7);
        destination = { position, target: new THREE.Vector3(), up: camera.up.clone() };
        zoomRadius = null;
        return;
      }
      destination = null;
      const p = coordinates(camera.position), ground = 1 + terrain.elevationAt(p.lat, p.lon) / EARTH_KM;
      zoomRadius = Math.min(7, ground + Math.max(.065 / EARTH_KM, ((zoomRadius ?? camera.position.length()) - ground) * factor));
    };
    const reset = () => { clickAim = null; heading = 0; roll = 0; zoomRadius = null; destination = { position: globePoint(latest.current.location.lat, latest.current.location.lon, 3.8), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }; };
    const focus = (_near: boolean) => {
      clickAim = null; heading = 0; roll = 0; zoomRadius = null;
      destination = { position: globePoint(latest.current.location.lat, latest.current.location.lon, Math.max(1.00002, camera.position.length())), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
    };
    state.current = { flights, streets, shell, particles, grid, extent, camera, renderer, focus, marker, sun, sunSprite, terrain, tornadoes, scene, dataLayers, ambient };
    latest.current.onReady({ reset, focus: () => focus(false), zoom, streets: () => {
      focus(false);if(destination)destination.position.setLength(1+(terrain.elevationAt(latest.current.location.lat,latest.current.location.lon)+5)/EARTH_KM);
    } });
    const adoptLook = () => {
      const orientation=camera.quaternion.clone();
      const direction = camera.getWorldDirection(new THREE.Vector3());
      camera.lookAt(controls.target);
      direction.applyQuaternion(camera.quaternion.clone().invert());
      tilt = Math.acos(THREE.MathUtils.clamp(-direction.z,-1,1));
      if(Math.sin(tilt)>.00001) heading = Math.atan2(-direction.x,direction.y);
      const limit=Math.min(1.4,Math.max(0,Math.asin(Math.min(1,1/camera.position.length()))-.04));
      if(clickAim) latest.current.onLook(THREE.MathUtils.clamp(tilt/Math.max(.0001,limit)*100,0,100));
      camera.rotateZ(heading);camera.rotateX(tilt);
      const residual=camera.quaternion.clone().invert().multiply(orientation);
      roll=2*Math.atan2(residual.z,residual.w);
      camera.quaternion.copy(orientation);camera.updateMatrixWorld();
      clickAim=null;destination=null;
    };
    controls.addEventListener('start', () => { destination = null; });
    const ray = new THREE.Raycaster(); let downPoint = new THREE.Vector2(), moved = false; const pointers = new Set<number>();
    const touches = new Map<number, THREE.Vector2>(); let pinchDistance = 0;
    const down = (e: PointerEvent) => { if (e.pointerType === 'touch') { touches.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY)); if (touches.size === 2) { const p = [...touches.values()]; pinchDistance = p[0].distanceTo(p[1]); } } pointers.add(e.pointerId); downPoint.set(e.clientX, e.clientY); moved = pointers.size > 1; };
    const move = (e: PointerEvent) => { if (touches.has(e.pointerId)) { touches.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY)); if (touches.size === 2) { const p = [...touches.values()], distance = p[0].distanceTo(p[1]); if (pinchDistance > 0 && distance > 0) zoom(pinchDistance / distance); pinchDistance = distance; moved = true; } } if (Math.hypot(e.clientX - downPoint.x, e.clientY - downPoint.y) > 5) moved = true; };
    const select = (x: number, y: number) => {
      ray.setFromCamera(new THREE.Vector2(x, y), camera); const hits = ray.intersectObjects([earth, ...terrain.group.children], false);
      if (hits[0]) {
        const location = coordinates(hits[0].point);
        clickedLocation.current = location;
        clickAim = hits[0].point.clone(); zoomRadius = null;
        const altitude = (camera.position.length() - 1) * EARTH_KM;
        if (altitude <= 5) {
          const normal = clickAim.clone().normalize();
          const side = camera.position.clone().addScaledVector(normal, -camera.position.dot(normal));
          if (side.lengthSq() < 1e-14) { camera.getWorldDirection(side); side.addScaledVector(normal, -side.dot(normal)); }
          if (side.lengthSq() < 1e-14) side.set(0,1,0).cross(normal);
          side.normalize();
          const groundKm = (clickAim.length()-1)*EARTH_KM;
          const height = Math.max(.15, altitude-groundKm);
          const position = normal.clone().multiplyScalar(1+Math.max(altitude,groundKm+.15)/EARTH_KM).addScaledVector(side,height*1.3/EARTH_KM);
          destination = {position, target: new THREE.Vector3(), up: camera.up.clone()};
        } else destination = null;
        latest.current.onSelect(location);
      }
    };
    // One inspector for every marker layer: hover names it, a click pins the card until dismissed.
    const tip=document.createElement('div');tip.className='inspect-tip';tip.style.display='none';el.appendChild(tip);
    const card=document.createElement('div');card.className='inspect-card';card.style.display='none';el.appendChild(card);
    const fill=(node:HTMLElement,info:Info,pinned:boolean)=>{
      node.replaceChildren();
      const title=document.createElement('strong');title.textContent=info.title;node.append(title);
      if(pinned){const close=document.createElement('button');close.type='button';close.setAttribute('aria-label','Close');close.textContent='×';close.onclick=()=>unpin();node.append(close);}
      for(const line of info.lines){const p=document.createElement('span');p.textContent=line;node.append(p);}
      if(pinned&&info.image){const img=document.createElement('img');img.alt=`Current still from ${info.title}`;img.src=`${info.image}${info.image.includes('?')?'&':'?'}t=${Date.now()}`;img.onerror=()=>{const gone=document.createElement('span');gone.textContent='Frame unavailable right now.';img.replaceWith(gone);};node.append(img);}
    };
    const place=(node:HTMLElement,x:number,y:number,width:number)=>{const b=canvas.getBoundingClientRect();node.style.left=`${Math.min(b.width-width-8,Math.max(8,x+14))}px`;node.style.top=`${Math.max(8,Math.min(b.height-40,y-16))}px`;};
    const pickAt=(clientX:number,clientY:number):{info:Info;anchor:Anchor}|null=>{
      const b=canvas.getBoundingClientRect(),x=clientX-b.left,y=clientY-b.top;
      if(latest.current.flightData){const f=flights.pick(camera,x/b.width*2-1,-y/b.height*2+1,b.width,b.height,Date.now());if(f){const id=f.id;return {info:{title:`${f.callsign} · ${f.type}`,lines:[`${f.category} aircraft`,`${(f.altitudeKm*1000).toFixed(0)} m · ${Math.round(f.speedKms*3600)} km/h · heading ${Math.round(f.heading)}°`,'ADSB.lol · estimated between 15-second updates']},anchor:()=>{const live=flights.find(id);return live&&Date.now()-live.observedAt<30000?flightPosition(live,Date.now()):null;}};}}
      for(const layer of dataLayers.values()){const hit=layer.pick?.(camera,x,y,b.width,b.height);if(hit)return {info:hit.info,anchor:hit.anchor};}
      return null;
    };
    // The pinned card stays with its record: each frame it is moved to the anchor's current
    // screen position, hidden while that is behind the globe or off-screen, and closed if the
    // record has gone.
    let pinned:{anchor:Anchor}|null=null;
    const anchorRay=new THREE.Vector3(),anchorFoot=new THREE.Vector3(),anchorScreen=new THREE.Vector3();
    const followPinned=()=>{
      if(!pinned)return;
      const world=pinned.anchor();
      if(!world){pinned=null;card.style.display='none';return;}
      anchorRay.subVectors(world,camera.position);
      const t=THREE.MathUtils.clamp(-camera.position.dot(anchorRay)/Math.max(1e-12,anchorRay.lengthSq()),0,1);
      const hidden=(t>0&&t<1&&anchorFoot.copy(camera.position).addScaledVector(anchorRay,t).lengthSq()<1);
      anchorScreen.copy(world).project(camera);
      const b=canvas.getBoundingClientRect(),sx=(anchorScreen.x+1)*b.width/2,sy=(1-anchorScreen.y)*b.height/2;
      const onScreen=!hidden&&anchorScreen.z<1&&sx>-40&&sx<b.width+40&&sy>-40&&sy<b.height+40;
      card.style.display=onScreen?'flex':'none';
      if(onScreen)place(card,sx,sy,340);
    };
    let hoverTick=0;
    const hover=(e:PointerEvent)=>{
      if(e.buttons){tip.style.display='none';return;}
      if(performance.now()-hoverTick<80)return;hoverTick=performance.now();
      const info=pickAt(e.clientX,e.clientY)?.info??null;tip.style.display=info?'flex':'none';canvas.style.cursor=info?'pointer':'';
      if(info){fill(tip,info,false);const b=canvas.getBoundingClientRect();place(tip,e.clientX-b.left,e.clientY-b.top,300);}
    };
    const unpin=()=>{pinned=null;card.style.display='none';};
    const pin=(clientX:number,clientY:number)=>{
      const hit=pickAt(clientX,clientY);if(!hit)return false;
      fill(card,hit.info,true);pinned={anchor:hit.anchor};tip.style.display='none';followPinned();return true;
    };
    const clickAt=(clientX:number,clientY:number)=>{if(pin(clientX,clientY))return;unpin();const b=canvas.getBoundingClientRect();select((clientX-b.left)/b.width*2-1,-(clientY-b.top)/b.height*2+1);};
    const dismiss=(e:KeyboardEvent)=>{if(e.key==='Escape')unpin();};
    window.addEventListener('keydown',dismiss);
    renderer.domElement.addEventListener('pointermove',hover);renderer.domElement.addEventListener('pointerleave',()=>{tip.style.display='none';});
    const up = (e: PointerEvent) => { pointers.delete(e.pointerId); touches.delete(e.pointerId); pinchDistance = 0; if (moved || e.button !== 0) return; clickAt(e.clientX, e.clientY); };
    const cancel = (e: PointerEvent) => { pointers.delete(e.pointerId); touches.delete(e.pointerId); pinchDistance = 0; moved = true; };
    const heldKeys=new Set<string>();
    const moveNavigation=(x:number,y:number,seconds:number)=>{
      adoptLook();zoomRadius=null;
      moveOverGlobe(camera,controls.target,x,y,seconds);
    };
    const editingText=()=>document.activeElement?.matches('textarea,select,[contenteditable="true"],input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="color"])')??false;
    const key = (e: KeyboardEvent) => {
      if(e.defaultPrevented || editingText() || (e.target as HTMLElement)?.closest('input[type="range"],input[type="color"],select,textarea,.panel-grip,[contenteditable="true"]'))return;
      if(!['Enter','+','=','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
      if(e.key==='Enter' && (e.target as HTMLElement)?.closest('button,a,summary'))return;
      e.preventDefault();
      if(e.key==='Enter'){if(!e.repeat)select(0,0);return;}
      if(!heldKeys.has(e.key)){
        const x=Number(e.key==='ArrowRight')-Number(e.key==='ArrowLeft'),y=Number(e.key==='ArrowDown')-Number(e.key==='ArrowUp');
        if(x||y)moveNavigation(x,y,.06);
        if(['+','=','-'].includes(e.key))zoom(Math.exp((e.key==='-'?1:-1)*.08));
      }
      heldKeys.add(e.key);
    };
    const keyUp=(e:KeyboardEvent)=>{heldKeys.delete(e.key);};
    const clearKeys=()=>heldKeys.clear();
    window.addEventListener('keydown',key);window.addEventListener('keyup',keyUp);window.addEventListener('blur',clearKeys);document.addEventListener('visibilitychange',clearKeys);
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown',()=>canvas.focus({preventScroll:true}),true);

    const wheel = (e: WheelEvent) => { e.preventDefault(); zoom(Math.exp(THREE.MathUtils.clamp(e.deltaY * (e.deltaMode === 1 ? 16 : 1), -160, 160) * .004)); };
    let dragPointer: number | null = null, dragX=0, dragY=0, dragging=false;
    const dragDown=(e:PointerEvent)=>{
      if(e.button!==0||e.pointerType!=='mouse')return;
      e.preventDefault();e.stopImmediatePropagation();
      dragPointer=e.pointerId;dragX=e.clientX;dragY=e.clientY;dragging=false;
      canvas.setPointerCapture(e.pointerId);
    };
    const dragMove=(e:PointerEvent)=>{
      if(e.pointerId!==dragPointer)return;
      e.preventDefault();e.stopImmediatePropagation();
      const dx=e.clientX-dragX,dy=e.clientY-dragY;
      if(!dragging && Math.hypot(dx,dy)<4)return;
      if(!dragging){adoptLook();dragging=true;zoomRadius=null;}
      const height=Math.max(.065,(camera.position.length()-1)*EARTH_KM);
      const scale=.0025*Math.min(1,height/3000);
      const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
      const upAxis=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
      const turn=new THREE.Quaternion().setFromAxisAngle(upAxis,-dx*scale).multiply(new THREE.Quaternion().setFromAxisAngle(right,-dy*scale));
      camera.position.applyQuaternion(turn);camera.up.applyQuaternion(turn);controls.target.applyQuaternion(turn);
      dragX=e.clientX;dragY=e.clientY;
    };
    const dragEnd=(e:PointerEvent)=>{
      if(e.pointerId!==dragPointer)return;
      e.preventDefault();e.stopImmediatePropagation();dragPointer=null;
      if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
      if(!dragging&&e.type==='pointerup')clickAt(e.clientX,e.clientY);
    };
    canvas.addEventListener('pointerdown',dragDown,true);canvas.addEventListener('pointermove',dragMove,true);canvas.addEventListener('pointerup',dragEnd,true);canvas.addEventListener('pointercancel',dragEnd,true);
    let lookPointer: number | null = null, lookX = 0, lookY = 0, lookTilt = 0;
    const lookDown = (e: PointerEvent) => {
      if (e.button !== 1 || e.pointerType !== 'mouse') return;
      e.preventDefault(); e.stopImmediatePropagation();
      adoptLook(); zoomRadius = null; moved = true;
      lookPointer = e.pointerId; lookX = e.clientX; lookY = e.clientY;
      const limit = Math.min(1.4, Math.max(0, Math.asin(Math.min(1, 1 / camera.position.length())) - .04));
      lookTilt = THREE.MathUtils.clamp(tilt / Math.max(.0001, limit) * 100, 0, 100);
      latest.current.onLook(Math.round(lookTilt));
      canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing';
    };
    const lookMove = (e: PointerEvent) => {
      if (e.pointerId !== lookPointer) return;
      e.preventDefault(); e.stopImmediatePropagation();
      heading -= (e.clientX - lookX) * .006;
      lookTilt = THREE.MathUtils.clamp(lookTilt + (e.clientY - lookY) * .22, 0, 100);
      lookX = e.clientX; lookY = e.clientY; latest.current.onLook(Math.round(lookTilt));
    };
    const lookEnd = (e: PointerEvent) => {
      if (e.pointerId !== lookPointer) return;
      e.preventDefault(); e.stopImmediatePropagation(); lookPointer = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = '';
    };
    const auxClick = (e: MouseEvent) => { if(e.button===1)e.preventDefault(); };
    canvas.addEventListener('pointerdown', lookDown, true);
    canvas.addEventListener('pointermove', lookMove, true);
    canvas.addEventListener('pointerup', lookEnd, true);
    canvas.addEventListener('pointercancel', lookEnd, true);
    canvas.addEventListener('lostpointercapture', lookEnd, true);
    canvas.addEventListener('auxclick', auxClick);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', cancel);
    const resize = () => { camera.aspect = el.clientWidth / el.clientHeight; camera.clearViewOffset(); camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth, el.clientHeight); for (const l of dataLayers.values()) l.resize?.(el.clientWidth, el.clientHeight); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let frame = 0, previous = performance.now(), statsTime = previous, frames = 0, terrainTick = previous;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let previousA=false,previousB=false,previousY=false;let reportedNorth:number|null|undefined;
    const animate = (now: number) => {
      frame = requestAnimationFrame(animate); if (document.hidden) { previous = now; return; }
      const dt = Math.min((now - previous) / 1000, .25); previous = now; frames++;
      const acceptsPad=latest.current.gamepadEnabled && document.hasFocus() && !editingText();
      if(heldKeys.size && !editingText()){
        const x=Number(heldKeys.has('ArrowRight'))-Number(heldKeys.has('ArrowLeft'));
        const y=Number(heldKeys.has('ArrowDown'))-Number(heldKeys.has('ArrowUp'));
        if(x||y)moveNavigation(x,y,dt);
        const zoomInput=Number(heldKeys.has('-'))-Number(heldKeys.has('+')||heldKeys.has('='));if(zoomInput)zoom(Math.exp(zoomInput*dt*1.4));
      }
      const pad=acceptsPad?readPad(connectedPads().find(p=>p.mapping==='standard')??null):null;
      if(pad){
        if(pad.moveX||pad.moveY)moveNavigation(pad.moveX,pad.moveY,dt);
        if(pad.lookX||pad.lookY){
          lookWithStick(camera,pad.lookX,pad.lookY,dt);
          adoptLook();
          const limit=Math.min(1.4,Math.max(0,Math.asin(Math.min(1,1/camera.position.length()))-.04));
          latest.current.onLook(tilt/Math.max(.0001,limit)*100);
        }
        if(Math.abs(pad.zoom)>.05)zoom(Math.exp(pad.zoom*dt*1.4));
        if(pad.level&&!previousY)toggleHorizon();
        if(pad.select&&!previousA)select(0,0);if(pad.reset&&!previousB){latest.current.onLook(0);reset();}
      }
      previousA=pad?.select??false;previousB=pad?.reset??false;previousY=pad?.level??false;
      if (destination) {
        const alpha = reduced ? 1 : 1 - Math.exp(-dt * 3.1); const distance = THREE.MathUtils.lerp(camera.position.length(), destination.position.length(), alpha);
        const q = new THREE.Quaternion().setFromUnitVectors(camera.position.clone().normalize(), destination.position.clone().normalize());
        camera.position.applyQuaternion(new THREE.Quaternion().slerp(q, alpha)).setLength(distance);
        controls.target.lerp(destination.target, alpha); camera.up.lerp(destination.up, alpha).normalize();
        if (camera.position.distanceTo(destination.position) < .000001 && controls.target.distanceTo(destination.target) < .000001) { camera.position.copy(destination.position); controls.target.copy(destination.target); destination = null; }
      }
      if (zoomRadius !== null) {
        camera.position.setLength(THREE.MathUtils.lerp(camera.position.length(), zoomRadius, 1 - Math.exp(-dt * 12)));
        if (Math.abs(camera.position.length() - zoomRadius) < 1e-8) zoomRadius = null;
      }
      let altitude = (camera.position.length() - 1) * EARTH_KM;
      controls.rotateSpeed = Math.max(.00003, .42 * Math.min(1, altitude / 3000));
      controls.panSpeed = .3 * Math.min(1, altitude / 3000);
      if (previousTiltSetting !== latest.current.cameraTilt || previousTiltLock !== latest.current.tiltLocked) clickAim = null;
      previousTiltSetting = latest.current.cameraTilt; previousTiltLock = latest.current.tiltLocked;
      previousOrientation.copy(camera.quaternion);
      controls.update();
      const horizonAngle = Math.max(0, Math.asin(Math.min(1, 1 / camera.position.length())) - .04);
      const requestedTilt = cameraTiltPercent(altitude, latest.current.cameraTilt, latest.current.tiltLocked) / 100 * Math.min(1.4, horizonAngle);
      tilt = THREE.MathUtils.lerp(tilt, pad && (pad.lookX||pad.lookY) ? tilt : requestedTilt, reduced ? 1 : 1 - Math.exp(-dt * 10));
      camera.rotateZ(heading); camera.rotateX(tilt); camera.rotateZ(roll);
      if (clickAim) {
        camera.lookAt(clickAim);
        const desired = camera.quaternion.clone();
        camera.quaternion.copy(previousOrientation).slerp(desired, reduced ? 1 : 1-Math.exp(-dt*6));
      }
      if(latest.current.horizonLevel)levelSurfaceHorizon(camera,true);
      if(latest.current.northUp) applyNorthUp(camera);
      camera.updateMatrixWorld();
      const northAngle=northScreenAngle(camera),roundedNorth=northAngle===null?null:Math.round(northAngle);
      if(roundedNorth!==reportedNorth){reportedNorth=roundedNorth;latest.current.onCompassChange(roundedNorth);}
      // Read the rendered orientation, including pan and look controls, rather than the requested target.
      camera.getWorldDirection(viewDirection); nadir.copy(camera.position).normalize().negate();
      const actualAngle = Math.acos(THREE.MathUtils.clamp(viewDirection.dot(nadir), -1, 1));
      const actualTilt = Math.round(THREE.MathUtils.clamp(actualAngle / Math.max(.0001, Math.min(1.4, horizonAngle)) * 100, 0, 100));
      if (actualTilt !== reportedTilt) { reportedTilt = actualTilt; latest.current.onTiltChange(actualTilt); }
      const atCamera = coordinates(camera.position); const minimum = 1 + (terrain.elevationAt(atCamera.lat, atCamera.lon) + .065) / EARTH_KM;
      if (camera.position.length() < minimum) { camera.position.setLength(minimum); if (zoomRadius !== null && zoomRadius < minimum) zoomRadius = null; }
      if (!destination) controls.target.clampLength(0, Math.min(.3, altitude / EARTH_KM * .1));
      altitude = (camera.position.length() - 1) * EARTH_KM;
      shell.material.uniforms.satelliteLod.value = Math.max(0, Math.log2(Math.max(1, altitude / 6000))); shell.material.uniforms.eye.value.copy(camera.position); shell.material.uniforms.clock.value = reduced ? 0 : now / 1000;
      grid.visible = latest.current.layers.grid && altitude > 150; stars.visible = altitude > 100;
      marker.scale.setScalar(Math.max(.00004, Math.min(1, camera.position.distanceTo(marker.position) * .5))); marker.visible = altitude > 20;
      particles.update(camera, latest.current.location, latest.current.atmosphere, latest.current.layers, reduced ? 0 : now / 1000);
      tornadoes.update(terrain, altitude, reduced ? 0 : now / 1000);
      for (const layer of dataLayers.values()) layer.update({ camera, terrain, altitudeKm: altitude, seconds: reduced ? 0 : now / 1000, now: Date.now() });
      followPinned();
      terrain.advance(reduced ? 1 : dt);
      if (now - terrainTick > 750) { terrainTick = now; terrain.update(camera, renderer.domElement.clientHeight); }
      streets.update(terrain,camera,latest.current.streetOptions);
      renderer.getDrawingBufferSize(shell.material.uniforms.screenSize.value);
      if (altitude < 350) {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        if (terrainDepth.width !== size.x || terrainDepth.height !== size.y) terrainDepth.setSize(size.x, size.y);
        shell.mesh.visible = false;
        renderer.setRenderTarget(terrainDepth); renderer.render(scene, camera); renderer.setRenderTarget(null);
        shell.mesh.visible = true;
        shell.material.uniforms.screenSize.value.copy(size);
        camera.getWorldDirection(shell.material.uniforms.cameraForward.value);
        shell.material.uniforms.depthEnabled.value = 1;
      } else shell.material.uniforms.depthEnabled.value = 0;
      if(now-flightTick>100){flights.update(Date.now());flightTick=now;}
      renderer.render(scene, camera);
      el.querySelectorAll<HTMLElement>('[data-pin]').forEach(label => {
        const index = Number(label.dataset.pin); const p = index < 0 ? latest.current.location : places[index];
        const world = globePoint(p.lat, p.lon, 1.0004); const visible = world.dot(camera.position.clone().sub(world)) > 0 && altitude > 60;
        const screen = world.project(camera); label.style.display = visible && screen.z < 1 && Math.abs(screen.x) < .96 && Math.abs(screen.y) < .92 ? 'flex' : 'none';
        label.style.transform = `translate(${(screen.x + 1) * el.clientWidth / 2}px,${(1 - screen.y) * el.clientHeight / 2}px)`;
      });
      const occupied: {x:number;y:number}[]=[];
      el.querySelectorAll<HTMLElement>('[data-street-place]').forEach(label=>{
        const place=latest.current.streetData?.places[Number(label.dataset.streetPlace)];
        if(!place){label.style.display='none';return;}
        const enabled=place.kind==='landmark'?latest.current.streetOptions.landmarks:latest.current.streetOptions.markers;
        const world=globePoint(place.lat,place.lon,1+(terrain.elevationAt(place.lat,place.lon)+.02)/EARTH_KM);
        const facing=world.dot(camera.position.clone().sub(world))>0,screen=world.clone().project(camera);
        const x=(screen.x+1)*el.clientWidth/2,y=(1-screen.y)*el.clientHeight/2;
        const visible=enabled&&altitude<80&&facing&&screen.z<1&&Math.abs(screen.x)<.85&&Math.abs(screen.y)<.9&&occupied.length<22&&!occupied.some(p=>Math.abs(p.x-x)<130&&Math.abs(p.y-y)<27);
        label.style.display=visible?'flex':'none';if(visible){occupied.push({x,y});label.style.transform=`translate(${x}px,${y}px)`;}
      });
      if (now - statsTime > 1250) { latest.current.onStats({ fps: Math.round(frames * 1000 / (now - statsTime)), tiltPercent: actualTilt, altitudeKm: altitude, gpu, terrain: terrainStatus, satellite: satelliteStatus }); frames = 0; statsTime = now; }
    }; frame = requestAnimationFrame(animate);
    return () => { alive = false; window.removeEventListener('keydown',key);window.removeEventListener('keyup',keyUp);window.removeEventListener('blur',clearKeys);document.removeEventListener('visibilitychange',clearKeys); satelliteController.abort(); cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); flights.dispose(); scene.remove(flights.group); terrain.dispose(); streets.dispose(); scene.remove(streets.mesh); terrainDepth.dispose(); shell.dispose(); particles.dispose(); tornadoes.dispose(); dataLayers.forEach(l => { scene.remove(l.group); l.dispose(); }); dataLayers.clear(); scene.remove(shell.mesh, terrain.group, tornadoes.group, particles.rain, particles.snow, particles.wind); dispose(scene); map.dispose(); sunSprite.material.map?.dispose(); renderer.dispose(); canvas.removeEventListener('wheel', wheel); tip.remove(); card.remove(); window.removeEventListener('keydown',dismiss); canvas.remove(); state.current = null; };
  }, []);
  useEffect(() => {
    const s = state.current; if (!s) return;
    s.marker.position.copy(globePoint(props.location.lat, props.location.lon, 1.0005)); s.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.marker.position.clone().normalize());
    if (mountedLocation.current !== props.location && clickedLocation.current !== props.location) s.focus(false); mountedLocation.current = props.location; clickedLocation.current = null;
  }, [props.location]);
  useEffect(() => {
    const s = state.current; if (!s) return;
    s.shell.setAtmosphere(props.atmosphere, props.location, props.demo);
    s.shell.setStorm(props.stormActive, props.stormRadiusKm);
    s.shell.material.uniforms.cloudEnabled.value = props.layers.clouds ? 1 : 0; s.shell.material.uniforms.rainEnabled.value = props.layers.precipitation ? 1 : 0; s.shell.material.uniforms.satelliteEnabled.value = props.satellite ? 1 : 0;
    const normal = globePoint(props.location.lat, props.location.lon), east = new THREE.Vector3(-Math.sin(props.location.lon * Math.PI / 180), 0, -Math.cos(props.location.lon * Math.PI / 180)), north = normal.clone().cross(east);
    const solar = props.demo ? [.4, .7, .4] : solarDirection(props.location, props.time ? new Date(Date.parse(props.time.endsWith('Z') ? props.time : props.time + 'Z') + props.hour * 3600000).toISOString() : undefined);
    const light = normal.clone().multiplyScalar(solar[1]).addScaledVector(east, solar[0]).addScaledVector(north, -solar[2]).normalize();
    s.sun.position.copy(light).multiplyScalar(10); s.shell.material.uniforms.sun.value.copy(light);
    s.sunSprite.position.copy(light).multiplyScalar(22);
    // The regional field only describes real conditions; synthetic studies cast no shade.
    const realClouds = props.layers.clouds && !props.demo && !props.stormActive && !props.satellite && !props.atmosphere.source.startsWith('Waiting');
    s.terrain.setCloudShadow(s.shell.material.uniforms.weatherMap.value, s.shell.material.uniforms.center.value, east, north, light, props.atmosphere.widthKm, props.atmosphere.baseKm, realClouds);
  }, [props.atmosphere, props.location, props.layers, props.demo, props.stormActive, props.stormRadiusKm, props.satellite, props.time, props.hour]);
  useEffect(() => {
    const s = state.current; if (!s) return;
    s.shell.material.uniforms.mapMode.value = ['natural', 'precipitation', 'wind', 'temperature'].indexOf(props.mapMode);
    if (props.globalWeather) { s.shell.setGlobal(globalTexture(props.globalWeather, props.time, props.hour)); s.shell.setCloudForecast(cloudTexture(props.globalWeather, props.time, props.hour)); }
    else s.shell.material.uniforms.globalAvailable.value = 0;
  }, [props.globalWeather, props.time, props.hour, props.mapMode]);
  useEffect(() => {
    state.current?.particles.setWindData(props.demo ? null : props.globalWeather, props.time, props.hour);
  }, [props.globalWeather, props.time, props.hour, props.demo]);
  useEffect(() => {
    if (state.current) state.current.shell.material.uniforms.mapOpacity.value = props.mapOpacity;
  }, [props.mapOpacity]);
  useEffect(() => { const s = state.current; if (!s) return; s.shell.setQuality(props.quality); s.terrain.setDetail(props.quality); s.renderer.setPixelRatio(Math.min(devicePixelRatio, props.quality === 'ultra' ? 1.7 : props.quality === 'high' ? 1.15 : .8)); }, [props.quality]);
  useEffect(() => {
    const s = state.current; if (!s) return; dispose(s.extent); s.extent.clear();
    for (const ring of props.polygons) s.extent.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring.map(p => globePoint(p[1], p[0], 1.0003))), new THREE.LineBasicMaterial({ color: 0xf5b976, transparent: true, opacity: .85 })));
  }, [props.polygons]);
  useEffect(()=>{state.current?.tornadoes.setData(props.tornadoData);},[props.tornadoData]);
  useEffect(() => {
    const s = state.current; if (!s) return;
    for (const spec of layerCatalog) {
      const data = props.extraLayers[spec.id], existing = s.dataLayers.get(spec.id);
      if (data != null) { const layer = existing ?? spec.create(); if (!existing) { s.dataLayers.set(spec.id, layer); s.scene.add(layer.group); layer.resize?.(s.renderer.domElement.clientWidth, s.renderer.domElement.clientHeight); }
        // A malformed payload disables that one layer; it must never unmount the scene.
        try { layer.setData(data); } catch (e) { console.error(`Layer ${spec.id} rejected its data`, e); s.scene.remove(layer.group); layer.dispose(); s.dataLayers.delete(spec.id); } }
      else if (existing) { s.scene.remove(existing.group); existing.dispose(); s.dataLayers.delete(spec.id); }
    }
  }, [props.extraLayers]);
  useEffect(()=>{state.current?.flights.setData(props.flightData);},[props.flightData]);
  useEffect(()=>{state.current?.streets.setData(props.streetData);},[props.streetData]);
  useEffect(()=>{if(state.current)state.current.shell.material.uniforms.radarOpacity.value=props.radarOpacity;},[props.radarOpacity]);
  useEffect(()=>{
    const s=state.current;if(!s)return;
    s.shell.material.uniforms.radarEnabled.value=0;
    if(!props.layers.precipitation||props.demo||props.hour>0||props.mapMode!=='natural')return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const refresh=async()=>{
      if(document.hidden){timer=setTimeout(refresh,120000);return;}
      try{
        latest.current.onRadarStatus('Loading NOAA radar observations…');
        const response=await fetch('/api/radar',{signal:controller.signal});if(!response.ok)throw new Error();
        const data:RadarData=await response.json();
        const stale=data.regions.filter(r=>Date.now()-Date.parse(r.time)>3600000);
        data.regions=data.regions.filter(r=>Date.now()-Date.parse(r.time)<=3600000);
        const atlas=await loadRadarAtlas(data,controller.signal,s.renderer.capabilities.maxTextureSize);
        if(controller.signal.aborted){atlas.texture.dispose();return;}
        s.shell.setRadar(atlas.texture,atlas.bounds);
        const times=atlas.loaded.map(r=>`${r.name}: ${new Date(r.time).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'})} UTC${Date.now()-Date.parse(r.time)>1200000?' (delayed)':''}`);
        const missing=[...data.unavailable,...atlas.failed,...stale.map(r=>`${r.name} (stale)` )];
        latest.current.onRadarStatus((times.length?times.join(' · '):'No radar imagery available.')+(missing.length?` · Unavailable: ${missing.join(', ')}`:''));
      }catch{if(!controller.signal.aborted){s.shell.material.uniforms.radarEnabled.value=0;latest.current.onRadarStatus('NOAA radar unavailable. Missing coverage does not mean dry weather.');}}
      if(!controller.signal.aborted)timer=setTimeout(refresh,120000);
    };void refresh();return()=>{controller.abort();clearTimeout(timer);s.shell.material.uniforms.radarEnabled.value=0;};
  },[props.layers.precipitation,props.demo,props.hour,props.mapMode]);
  return <div className="globe-stage continuous-globe" ref={host}>
    {props.streetData?.places.map((place,index)=><div key={place.id} data-street-place={index} className={`street-place ${place.kind}`} title={`${place.name} · ${place.category.replaceAll('_',' ')}`}><span>{place.kind==='landmark'?'◆':'●'}</span>{place.name}</div>)}
    {places.map((place, index) => <button key={place.name} data-pin={index} className={`map-label ${place.name === props.location.name ? 'hidden-pin' : ''}`} onClick={() => props.onSelect(place)}><span/>{place.name}</button>)}
    <div data-pin="-1" className="map-label selected-label"><span/><div>{props.location.name}<small>{props.demo ? 'SYNTHETIC WEATHER STUDY' : 'SELECTED LOCATION'}</small></div></div>
  </div>;
}
