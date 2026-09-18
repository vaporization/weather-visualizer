import * as THREE from 'three';
import { EARTH_KM, globePoint } from './weatherShell';
import type { Terrain } from './terrain';
export type StreetPlace={id:string;name:string;lat:number;lon:number;kind:'marker'|'landmark';category:string};
export type StreetData={center:{lat:number;lon:number};radiusKm:number;segments:[[number,number],[number,number]][];places:StreetPlace[];truncated:boolean;source:string;fetchedAt:string};
export type StreetOptions={roads:boolean;markers:boolean;landmarks:boolean;color:string};
export class StreetOverlay {
  readonly mesh=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#ffd166',transparent:true,opacity:.9,depthWrite:false}));
  private data:StreetData|null=null;
  private revision=-1;
  constructor(){this.mesh.renderOrder=10;this.mesh.frustumCulled=false;}
  setData(data:StreetData|null){this.data=data;this.revision=-1;}
  update(terrain:Terrain,camera:THREE.Camera,options:StreetOptions){
    this.mesh.visible=!!this.data&&options.roads&&(camera.position.length()-1)*EARTH_KM<180;
    (this.mesh.material as THREE.LineBasicMaterial).color.set(options.color);
    if(this.revision===terrain.revision)return;
    this.revision=terrain.revision;
    const vertices:number[]=[];
    for(const [a,b] of this.data?.segments??[]){
      const dlon=((b[1]-a[1]+540)%360)-180;
      const distance=Math.hypot((b[0]-a[0])*111.32,dlon*111.32*Math.cos(a[0]*Math.PI/180));
      const steps=Math.min(64,Math.max(1,Math.ceil(distance/.08)));
      const point=(f:number)=>{const lat=a[0]+(b[0]-a[0])*f,lon=((a[1]+dlon*f+540)%360)-180;return globePoint(lat,lon,1+(terrain.elevationAt(lat,lon)+.012)/EARTH_KM);};
      let previous=point(0);
      for(let i=1;i<=steps;i++){const next=point(i/steps);vertices.push(...previous.toArray(),...next.toArray());previous=next;}
    }
    this.mesh.geometry.dispose();this.mesh.geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  }
  dispose(){this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose();}
}
