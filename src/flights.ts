import * as THREE from 'three';
import { globePoint, EARTH_KM } from './weatherShell';
export type Flight = {id:string;callsign:string;type:string;category:'airliner'|'business'|'light';lat:number;lon:number;altitudeKm:number;speedKms:number;heading:number;observedAt:number};
export type FlightData = {timestamp:number;source:string;flights:Flight[]};
export const flightColors = {airliner:0x55c9ff,business:0xffce70,light:0xc198ff};
export function flightPosition(f:Flight, time:number) {
 const seconds=Math.max(0,Math.min(15,(time-f.observedAt)/1000));
 const a=f.lat*Math.PI/180,b=f.lon*Math.PI/180,h=f.heading*Math.PI/180,d=f.speedKms*seconds/EARTH_KM;
 const lat=Math.asin(Math.sin(a)*Math.cos(d)+Math.cos(a)*Math.sin(d)*Math.cos(h));
 const lon=b+Math.atan2(Math.sin(h)*Math.sin(d)*Math.cos(a),Math.cos(d)-Math.sin(a)*Math.sin(lat));
 return globePoint(lat*180/Math.PI,lon*180/Math.PI,1+f.altitudeKm/EARTH_KM);
}
export class FlightLayer {
 readonly group=new THREE.Group();
 private data:FlightData|null=null;
 private points=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({size:4,sizeAttenuation:false,vertexColors:true,transparent:true,opacity:.95,depthWrite:false}));
 private trails=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,vertexShader:`#include <common>
 #include <logdepthbuf_pars_vertex>
 attribute float opacity;varying float alpha;varying vec3 tint;
 void main(){alpha=opacity;tint=color;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
 #include <logdepthbuf_vertex>
 }`,fragmentShader:`#include <logdepthbuf_pars_fragment>
 varying float alpha;varying vec3 tint;void main(){
 #include <logdepthbuf_fragment>
 gl_FragColor=vec4(tint,alpha);}`}));
 constructor(){this.points.material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('void main() {','void main() { if(length(gl_PointCoord-vec2(.5))>.5)discard;');};this.points.renderOrder=25;this.trails.renderOrder=25;this.group.add(this.points,this.trails);}
 setData(data:FlightData|null){this.data=data;}
 find(id:string){return this.data?.flights.find(f=>f.id===id)??null;}
 pick(camera:THREE.Camera,x:number,y:number,width:number,height:number,now:number){
  let best:Flight|null=null,distance=100;
  for(const f of this.data?.flights??[]){if(now-f.observedAt>30000)continue;const p=flightPosition(f,now);if(p.dot(camera.position.clone().sub(p))<=0)continue;const screen=p.project(camera);if(screen.z>1)continue;const d=((screen.x-x)*width/2)**2+((screen.y-y)*height/2)**2;if(d<distance){distance=d;best=f;}}
  return best;
 }
 update(now:number){
  const positions:number[]=[],colors:number[]=[],line:number[]=[],tints:number[]=[],opacity:number[]=[];
  for(const f of this.data?.flights??[]){
   if(now-f.observedAt>30000)continue;
   const color=new THREE.Color(flightColors[f.category]);
   positions.push(...flightPosition(f,now).toArray());colors.push(...color.toArray());
   // Only the last five seconds of the displayed, estimated motion remain.
   for(let i=0;i<10;i++)for(const age of [5-i*.5,4.5-i*.5]){
    line.push(...flightPosition(f,now-age*1000).toArray());tints.push(...color.toArray());opacity.push(Math.max(0,1-age/5)*.8);
   }
  }
  this.points.geometry.dispose();this.points.geometry=new THREE.BufferGeometry();
  this.points.geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));this.points.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  this.trails.geometry.dispose();this.trails.geometry=new THREE.BufferGeometry();
  this.trails.geometry.setAttribute('position',new THREE.Float32BufferAttribute(line,3));this.trails.geometry.setAttribute('color',new THREE.Float32BufferAttribute(tints,3));this.trails.geometry.setAttribute('opacity',new THREE.Float32BufferAttribute(opacity,1));
 }
 dispose(){this.points.geometry.dispose();this.points.material.dispose();this.trails.geometry.dispose();this.trails.material.dispose();}
}
