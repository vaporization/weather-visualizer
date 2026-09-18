import * as THREE from 'three';
export type RadarRegion={id:string;name:string;time:string;bounds:number[];image:string};
export type RadarData={regions:RadarRegion[];unavailable:string[];source:string};
export async function loadRadarAtlas(data:RadarData,signal:AbortSignal,maxTextureSize:number){
 const width=Math.min(2048,maxTextureSize),height=Math.min(1024,Math.floor(maxTextureSize/5));
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height*5;const ctx=canvas.getContext('2d')!;
 const loaded:RadarRegion[]=[],failed:string[]=[];
 await Promise.all(data.regions.slice(0,5).map(async(region,index)=>{
  try{const r=await fetch(region.image,{signal});if(!r.ok)throw new Error();const bitmap=await createImageBitmap(await r.blob());if(!signal.aborted){ctx.drawImage(bitmap,0,index*height,width,height);loaded[index]=region;}bitmap.close();}catch{failed.push(region.name);}
 }));
 if(signal.aborted)throw new DOMException('Aborted','AbortError');
 const bounds=Array.from({length:5},(_,i)=>loaded[i]?new THREE.Vector4(...loaded[i].bounds as [number,number,number,number]):new THREE.Vector4(999,999,1000,1000));
 const texture=new THREE.CanvasTexture(canvas);texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;
 return {texture,bounds,loaded:loaded.filter(Boolean),failed};
}
