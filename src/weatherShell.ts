import { windPaletteGLSL } from './windPalette';
import * as THREE from 'three';
import type { AtmosphereState, Quality } from './atmosphere';
import type { Location } from './weather';

export const EARTH_KM = 6371;
export function globePoint(lat: number, lon: number, radius = 1) {
  const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
  return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)).multiplyScalar(radius);
}

function noiseVolume() {
  const size = 64, data = new Uint8Array(size ** 3 * 4);
  const hash = (x: number, y: number, z: number, n: number) => {
    x = ((x % n) + n) % n; y = ((y % n) + n) % n; z = ((z % n) + n) % n;
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const valueNoise = (x: number, y: number, z: number, n: number) => {
    x *= n / size; y *= n / size; z *= n / size;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let a = x - ix, b = y - iy, c = z - iz; a *= a * (3 - 2 * a); b *= b * (3 - 2 * b); c *= c * (3 - 2 * c);
    return lerp(lerp(lerp(hash(ix, iy, iz, n), hash(ix + 1, iy, iz, n), a), lerp(hash(ix, iy + 1, iz, n), hash(ix + 1, iy + 1, iz, n), a), b), lerp(lerp(hash(ix, iy, iz + 1, n), hash(ix + 1, iy, iz + 1, n), a), lerp(hash(ix, iy + 1, iz + 1, n), hash(ix + 1, iy + 1, iz + 1, n), a), b), c);
  };
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = ((z * size + y) * size + x) * 4;
    data[i] = Math.round((valueNoise(x, y, z, 4) * .55 + valueNoise(x, y, z, 8) * .3 + valueNoise(x, y, z, 16) * .15) * 255);
    let nearest = 3;
    const wx = x / 8, wy = y / 8, wz = z / 8, ix = Math.floor(wx), iy = Math.floor(wy), iz = Math.floor(wz);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const px = cx + .2 + .6 * hash(cx, cy, cz, 8), py = cy + .2 + .6 * hash(cx + 3, cy + 5, cz + 7, 8), pz = cz + .2 + .6 * hash(cx + 1, cy + 6, cz + 2, 8);
      nearest = Math.min(nearest, (wx - px) ** 2 + (wy - py) ** 2 + (wz - pz) ** 2);
    }
    data[i + 1] = Math.round((1 - Math.min(1, Math.sqrt(nearest))) * 255);
    data[i + 2] = Math.round(valueNoise(x + 17, y + 31, z + 9, 16) * 255);
    data[i + 3] = 255;
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat; texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = true;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1; texture.needsUpdate = true;
  return texture;
}

// A single-channel volume texture, filtered and clamped so edge bins do not wrap into each other.
function redVolume(data: Uint8Array, width: number, height: number, depth: number) {
  const texture = new THREE.Data3DTexture(data, width, height, depth);
  texture.format = THREE.RedFormat; texture.type = THREE.UnsignedByteType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1; texture.needsUpdate = true;
  return texture;
}
export class WeatherShell {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private noise = noiseVolume();
  private field = new THREE.DataTexture(new Uint8Array(100), 5, 5);
  private forecastClouds: THREE.Texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  private radar: THREE.Texture = new THREE.DataTexture(new Uint8Array(4),1,1);
  private global: THREE.Texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  private satellite: THREE.Texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  private profile = redVolume(new Uint8Array(1), 1, 1, 1);
  constructor() {
    this.field.minFilter = this.field.magFilter = THREE.LinearFilter; this.field.needsUpdate = true; this.satellite.needsUpdate = true; this.radar.needsUpdate=true;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
      uniforms: {
        radarMap:{value:this.radar},radarBounds:{value:Array.from({length:5},()=>new THREE.Vector4(999,999,1000,1000))},radarEnabled:{value:0},radarOpacity:{value:.75},
        forecastCloudMap: { value: this.forecastClouds }, globalMap: { value: this.global }, globalAvailable: { value: 0 }, mapMode: { value: 0 }, mapOpacity: { value: .78 }, sceneDepth: { value: null }, depthEnabled: { value: 0 }, screenSize: { value: new THREE.Vector2(1, 1) }, cameraForward: { value: new THREE.Vector3() }, cameraFar: { value: 80 },
        noiseMap: { value: this.noise }, weatherMap: { value: this.field }, satelliteMap: { value: this.satellite },
        eye: { value: new THREE.Vector3() }, sun: { value: new THREE.Vector3(1, .4, .7).normalize() },
        center: { value: new THREE.Vector3() }, east: { value: new THREE.Vector3() }, north: { value: new THREE.Vector3() },
        lowBase: { value: 1.2 }, thickness: { value: 2.5 }, widthKm: { value: 160 }, terrainHeight: { value: 0 },
        wind: { value: new THREE.Vector3() }, clock: { value: 0 }, cloudEnabled: { value: 1 }, satelliteEnabled: { value: 1 }, regionalEnabled: { value: 0 }, satelliteLod: { value: 0 }, demo: { value: 0 },
        stormEnabled: { value: 0 }, stormRadiusKm: { value: 220 },
        profileMap: { value: this.profile }, profileAvailable: { value: 0 }, profileTopKm: { value: 16 }, shear: { value: new THREE.Vector3() },
        rainEnabled: { value: 1 }, rainRate: { value: 0 }, snowRate: { value: 0 }, visibilityKm: { value: 50 }, steps: { value: 96 },
      },
      vertexShader: `out vec3 worldPoint; void main(){vec4 p=modelMatrix*vec4(position,1.);worldPoint=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
      fragmentShader: `
        precision highp float; precision highp sampler3D;
        in vec3 worldPoint;
        uniform sampler3D noiseMap;
        uniform sampler2D radarMap; uniform vec4 radarBounds[5]; uniform float radarEnabled,radarOpacity;
        uniform sampler2D weatherMap, satelliteMap, sceneDepth, globalMap, forecastCloudMap;
        uniform float globalAvailable, mapMode, mapOpacity;
        uniform float depthEnabled, cameraFar; uniform vec2 screenSize; uniform vec3 cameraForward;
        uniform vec3 eye, sun, center, east, north, wind;
        uniform float satelliteLod, lowBase, thickness, widthKm, terrainHeight, clock, cloudEnabled, satelliteEnabled, regionalEnabled, demo, rainEnabled, rainRate, snowRate, visibilityKm;
        uniform float stormEnabled, stormRadiusKm;
        uniform sampler3D profileMap; uniform float profileAvailable, profileTopKm; uniform vec3 shear;
        uniform int steps;
        out vec4 outColor;
        const float R=6371.; const float PI=3.14159265;
        float sampleFootprint=0.01;
        ${windPaletteGLSL}
        vec2 sphere(vec3 o,vec3 d,float radius){float b=dot(o,d);float c=dot(o,o)-radius*radius;float h=b*b-c;if(h<0.)return vec2(1e9,-1e9);h=sqrt(h);return vec2(-b-h,-b+h);}
        // Ordered dithering, not white noise: a random offset per pixel makes neighbours
        // sample unrelated depths, and that variance reads as grain through stacked cloud.
        float bayer2(vec2 a){a=floor(a);return fract(a.x*.5+a.y*a.y*.75);}
        float bayer8(vec2 a){return bayer2(a*.25)*.0625+bayer2(a*.5)*.25+bayer2(a);}
        vec2 geoUV(vec3 p){vec3 n=normalize(p);return vec2(.5+atan(-n.z,n.x)/(2.*PI),.5+asin(n.y)/PI);}
        float regionalWeight(vec3 p){vec3 delta=p-center;vec2 xy=vec2(dot(delta,east),dot(delta,north));return regionalEnabled*(1.-smoothstep(widthKm*.34,widthKm*.5,length(xy)));}
        vec3 forecastFormation(vec3 p,vec3 c){
              mat3 rotation=mat3(.36,-.8,.48,.8,.0,-.6,.48,.6,.64);
              float pixelKm=max(.01,sampleFootprint);
              float cloudLod=max(0.,log2(max(1.,pixelKm*.00065*64.)));
              vec3 q=p*.00065;
              vec3 warp=textureLod(noiseMap,rotation*q*.37,max(0.,cloudLod-1.43)).rgb-.5;
              float broad=textureLod(noiseMap,q+warp*.9,cloudLod).r;
              float medium=textureLod(noiseMap,rotation*q*3.71+warp,cloudLod+1.89).g;
              float fine=textureLod(noiseMap,p*.004+warp,max(0.,log2(max(1.,pixelKm*.004*64.)))).r;
              float shape=broad*.48+medium*.34+fine*.18;
              float low=smoothstep(.72-c.r*.39,.84-c.r*.39,shape)*c.r;
              float mid=smoothstep(.72-c.g*.39,.84-c.g*.39,shape)*c.g*.65;
              float high=smoothstep(.70-c.b*.34,.84-c.b*.34,medium)*c.b*.24;
          return vec3(low,mid,high);
        }
        vec3 covers(vec3 p){
          vec2 uv=geoUV(p);float observed=textureLod(satelliteMap,uv,satelliteLod).a*satelliteEnabled;
          vec3 global=satelliteEnabled>.5 ? vec3(observed*.9,observed*.25,observed*.12) : textureLod(forecastCloudMap,uv,0.).rgb*globalAvailable;
          vec3 delta=p-center;vec2 xy=vec2(dot(delta,east),dot(delta,north));
          vec3 local=textureLod(weatherMap,xy/widthKm+.5,0.).rgb;
          if(demo>.5||stormEnabled>.5){
            // Eyewall, rainbands and outer edge scale with the analyzed storm size.
            float scale=max(.25,stormRadiusKm/220.);float r=length(xy);
            float a=atan(xy.y,xy.x)+r*.035/scale;float spiral=.35+.65*pow(.5+.5*sin(a*3.),2.);
            float mask=smoothstep(12.*scale,23.*scale,r)*(1.-smoothstep(170.*scale,230.*scale,r));
            local=vec3(spiral*mask,.22*mask,.1*mask);return mix(global,local,1.-smoothstep(210.*scale,250.*scale,r));
          }
          return satelliteEnabled>.5 ? global : forecastFormation(p,global);
        }
        float cloudLayer(vec3 p,float h,float base,float depth,float cover,float scale){
          float y=(h-base)/depth;if(y<0.||y>1.||cover<.015)return 0.;
          float profile=smoothstep(0.,.12,y)*(1.-smoothstep(.52,1.,y));
          vec3 advected=p-wind*clock*regionalWeight(p)*max(demo,stormEnabled);
          // Differently rotated, incommensurate scales avoid a repeated noise cube.
          mat3 rotation=mat3(.36,-.8,.48,.8,.0,-.6,.48,.6,.64);
          vec3 q=advected*scale;
          float lod=max(0.,log2(max(.001,sampleFootprint*scale*64.)));
          vec3 warp=textureLod(noiseMap,rotation*q*.173+vec3(.17,.43,.71),max(0.,lod-2.5)).rgb-.5;
          vec4 shape=mix(textureLod(noiseMap,q+warp*.8,lod),textureLod(noiseMap,rotation*q*.713+vec3(.31,.57,.13),max(0.,lod-.49)),.48);
          float detail=textureLod(noiseMap,rotation*q*3.7,max(0.,lod+1.89)).b;
          float macro=smoothstep(.70-cover*.65,.86-cover*.65,shape.r);
          float body=shape.g*.68+shape.r*.32-(1.-cover)*.18-y*y*.32;
          float d=smoothstep(.20,.42,body)*profile*macro;
          return max(0.,d-(1.-detail)*.14*(1.-d))*1.8;
        }
        // Model cloud cover at this point's true altitude, read from the resampled column. Bin centres
        // line up with altitude/profileTopKm, so the lookup needs no offset.
        float profileCover(vec3 p,float h){
          vec3 delta=p-center;vec2 xy=vec2(dot(delta,east),dot(delta,north));
          return textureLod(profileMap,vec3(xy/widthKm+.5,clamp(h/profileTopKm,0.,1.)),0.).r;
        }
        // A convective column. The noise cube repeats over texture coordinates, not over its 64 cells:
        // the value channels carry features across a quarter of it and the cellular channel across an
        // eighth, so the scales below work out to cells about 9 km wide gathered into clusters about
        // 45 km across, which is the size convection actually organises into. The pattern is stretched
        // vertically rather than extruded, so a tower stays one body from base to anvil while still
        // changing as it rises, and deep-layer shear leans it downwind as it climbs.
        float columnDensity(vec3 p,float h){
          float cover=profileCover(p,h);
          if(cover<.02)return 0.;
          mat3 rotation=mat3(.36,-.8,.48,.8,.0,-.6,.48,.6,.64);
          vec3 column=normalize(p-shear*max(0.,h-1.))*(R+h*.22);
          float scale=.014;
          vec3 q=column*scale;
          float lod=max(0.,log2(max(.001,sampleFootprint*scale*64.)));
          vec3 warp=textureLod(noiseMap,rotation*q*.35,max(0.,lod-2.)).rgb-.5;
          float broad=textureLod(noiseMap,q*.4+warp*.2,max(0.,lod-1.)).r;
          float cell=textureLod(noiseMap,q+warp*.35,lod).g;
          // Higher cover lets more of the pattern through, so an overcast level fills in and a broken
          // one stays in separate cells; an anvil widens because the model says cover is higher there.
          float d=smoothstep(.10,.38,cell*.58+broad*.42-(1.-cover)*.40)*cover;
          if(d<=0.)return 0.;
          // Erosion at two scales breaks the silhouette so a tower billows instead of reading as a slab.
          float coarse=.083,fine=.104;
          float chew=textureLod(noiseMap,rotation*column*coarse,max(0.,log2(max(.001,sampleFootprint*coarse*64.)))).r;
          float grain=textureLod(noiseMap,column*fine,max(0.,log2(max(.001,sampleFootprint*fine*64.))+1.)).b;
          return max(0.,d-(1.-chew)*.38*(1.-d)-(1.-grain)*.14*(1.-d))*1.9;
        }
        float density(vec3 p){
          float h=length(p)-R;if(h<.08||h>16.||cloudEnabled<.5)return 0.;
          // Inside the regional box the model's column replaces the fixed slabs. The hurricane study
          // and an analyzed storm keep their own structure, so they opt out.
          float blend=profileAvailable*regionalWeight(p)*(1.-max(demo,stormEnabled));
          if(blend>=.999)return columnDensity(p,h);
          vec3 coverage=covers(p);float w=regionalWeight(p)*max(demo,stormEnabled);
          float base=mix(1.15,lowBase+terrainHeight,w),deep=mix(3.1,thickness,w);
          float low=cloudLayer(p,h,base,deep,coverage.r,.045);
          float mid=cloudLayer(p,h,max(4.8,base+deep+.3),1.4,coverage.g,.022)*.52;
          float high=cloudLayer(p*vec3(1.,.42,1.),h,10.,1.1,coverage.b,.018)*.15;
          float slabs=low+mid+high;
          return blend<=.001 ? slabs : mix(slabs,columnDensity(p,h),blend);
        }
        float lightDepth(vec3 p){float sum=0.;float stride=.16;float travel=.08;for(int j=0;j<5;j++){sum+=density(p+sun*travel)*stride;travel+=stride;stride*=1.8;}return sum;}
        void main(){
          vec3 origin=eye*R;vec3 ray=normalize(worldPoint-eye);
          vec2 air=sphere(origin,ray,R+85.);if(air.y<0.)discard;
          float start=max(air.x,0.),stop=air.y;
          vec2 ground=sphere(origin,ray,R+terrainHeight*regionalWeight(origin));
          bool hitsGround=ground.x>0. && ground.y>=ground.x;
          if(depthEnabled>.5){
            float z=textureLod(sceneDepth,gl_FragCoord.xy/screenSize,0.).r;
            hitsGround=z<.999999;
            if(hitsGround){float viewDepth=exp2(z*log2(cameraFar+1.))-1.;stop=min(stop,viewDepth*R/max(.01,dot(ray,cameraForward)));}
          }else if(hitsGround)stop=min(stop,ground.x);
          if(stop<=start)discard;
          float cameraAltitude=length(origin)-R;
          // Integrate molecular air and near-surface aerosol separately. Surface
          // visibility must not attenuate the entire mostly-clear high-altitude ray.
          float airDepth=0.,aerosolDepth=0.;
          for(int k=0;k<24;k++){
            float t=mix(start,stop,(float(k)+.5)/24.);
            float height=max(0.,length(origin+ray*t)-R);
            float stride=(stop-start)/24.;
            airDepth+=exp(-height/8.)*stride;
            aerosolDepth+=exp(-height/1.2)*stride;
          }
          vec3 midPoint=origin+ray*mix(start,stop,.5);
          float daylight=smoothstep(-.13,.12,dot(normalize(midPoint),sun));
          float mu=dot(ray,sun);float rayleigh=.75*(1.+mu*mu);
          float haze=1.-exp(-airDepth*.008-aerosolDepth*1.5/max(5.,visibilityKm));
          float insideAir=1.-smoothstep(15.,70.,cameraAltitude);
          if(!hitsGround)haze=max(haze,insideAir*.998);

          vec3 sky=mix(vec3(.012,.023,.055),mix(vec3(.045,.16,.42),vec3(.40,.55,.73),pow(1.-abs(dot(ray,normalize(origin))),6.))*rayleigh,daylight);
          sky+=vec3(1.,.74,.42)*pow(max(0.,mu),24.)*.15*daylight;
          vec4 result=vec4(0.);
          vec2 cloud=sphere(origin,ray,R+16.);
          float begin=max(max(cloud.x,0.),start),end=min(cloud.y,stop);
          // Keep the full visible cloud shell at every altitude; a near-camera
          // distance cap clips horizon clouds before the ray reaches them.
          float orbitalBlend=smoothstep(400.,1800.,cameraAltitude);vec4 orbital=vec4(0.);
          if(end>begin&&cloudEnabled>.5&&orbitalBlend>0.){
            vec2 shellHit=sphere(origin,ray,R+2.8);float t=max(shellHit.x,0.);vec3 p=origin+ray*t;
            sampleFootprint=max(length(dFdx(p)),length(dFdy(p)));
            vec3 c=covers(p);float synthetic=max(demo,stormEnabled);
            float amount=(satelliteEnabled>.5||synthetic>.5) ? clamp(c.r+c.g*.3+c.b*.12,0.,1.) : textureLod(forecastCloudMap,geoUV(p),0.).a*globalAvailable;
            if(satelliteEnabled<.5 && synthetic<.5) amount=1.-(1.-c.r)*(1.-c.g)*(1.-c.b);
            if(satelliteEnabled<.5 && synthetic<.5 && cameraAltitude<6000.){
              vec3 radial=normalize(p);
              float optical=cloudLayer(radial*(R+2.3),2.3,1.15,3.1,c.r,.045)*1.6+c.g*.45+c.b*.15;
              float resolved=1.-exp(-optical);
              amount=mix(resolved,amount,smoothstep(1800.,6000.,cameraAltitude));
            }
            float light=smoothstep(-.06,.45,dot(normalize(p),sun));
            vec3 col=mix(vec3(.045,.065,.10),vec3(.84,.88,.94),light);
            orbital=vec4(col*amount*.91,amount*.91);
          }
          if(end>begin&&cloudEnabled>.5&&orbitalBlend<1.){
            float jitter=bayer8(gl_FragCoord.xy);
            float phase=.25+.75*(1.-.55*.55)/pow(1.+.55*.55-2.*.55*mu,1.5);
            for(int i=0;i<144;i++){
              if(i>=steps)break;
              float f=(float(i)+jitter)/float(steps);
              float t=begin+pow(f,1.45)*(end-begin);
              float stride=(pow(min(1.,(float(i)+1.)/float(steps)),1.45)-pow(float(i)/float(steps),1.45))*(end-begin);
              vec3 p=origin+ray*t;sampleFootprint=max(.01,t*.78/screenSize.y);float d=density(p);
              if(d>.004){
                float shadow=exp(-lightDepth(p)*2.1);
                float day=smoothstep(-.1,.12,dot(normalize(p),sun));
                vec3 ambient=mix(vec3(.019,.027,.045),vec3(.055,.075,.11),day);
                vec3 sunlight=vec3(1.,.965,.89)*(shadow*1.05+.05)*phase*day;
                vec3 col=ambient+sunlight;
                float distanceHaze=1.-exp(-max(0.,t-max(0.,cameraAltitude-14.))*.008);col=mix(col,sky,distanceHaze*.55);
                float alpha=1.-exp(-d*stride*2.6);
                result.rgb+=(1.-result.a)*col*alpha;result.a+=(1.-result.a)*alpha;
                if(result.a>.985)break;
              }
            }
          }
          result=mix(result,orbital,orbitalBlend);
          // Atmosphere surrounds the same Earth; cloud volume and ground share one coordinate system.
          result.rgb+=sky*haze*(1.-result.a);result.a+=haze*(1.-result.a);
          float cameraHeight=length(origin)-R-terrainHeight;
          if(rainEnabled>.5&&rainRate>.01&&cameraHeight<lowBase+thickness&&regionalWeight(origin)>.5){
            float curtain=(1.-exp(-min(stop,20.)*rainRate*.008))*daylight;
            vec3 rainColor=mix(vec3(.21,.26,.30),vec3(.73,.80,.86),snowRate>0.?1.:0.);
            result.rgb=mix(result.rgb,rainColor,curtain);result.a=max(result.a,curtain);
          }
          if(mapMode>.5 && globalAvailable>.5 && hitsGround){
            vec3 groundPoint=origin+ray*stop;
            vec4 field=textureLod(globalMap,geoUV(groundPoint),0.);
            float value=mapMode<1.5 ? field.g : mapMode<2.5 ? field.b : field.a;
            vec3 color;
            if(mapMode<1.5){float v=clamp(value*4.,0.,1.);color=mix(vec3(.12,.39,.9),vec3(.16,.86,.78),smoothstep(0.,.15,v));color=mix(color,vec3(1.,.83,.15),smoothstep(.15,.5,v));color=mix(color,vec3(.92,.14,.3),smoothstep(.5,1.,v));}
            else if(mapMode<2.5){color=windSpeedColor(field.b*150.);}
            else {color=mix(vec3(.14,.34,.9),vec3(.23,.87,.79),smoothstep(.1,.5,value));color=mix(color,vec3(1.,.83,.18),smoothstep(.5,.7,value));color=mix(color,vec3(.96,.16,.14),smoothstep(.7,.95,value));}
            float alpha=mapOpacity*(mapMode<1.5 ? smoothstep(0.,.025,value) : 1.);
            outColor=vec4(color,alpha);return;
          }
          if(radarEnabled>.5 && hitsGround && mapMode<.5){
            vec2 location=(geoUV(origin+ray*stop)-.5)*vec2(360.,180.);
            vec4 radar=vec4(0.);
            for(int r=0;r<5;r++){
              vec4 b=radarBounds[r];vec2 uv=(location-b.xy)/(b.zw-b.xy);
              if(all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))){
                // Each atlas row is one NOAA mosaic; avoid filtering across row edges.
                vec2 size=vec2(textureSize(radarMap,0));
                uv=clamp(uv,vec2(.5)/vec2(size.x,size.y/5.),vec2(1.)-vec2(.5)/vec2(size.x,size.y/5.));
                vec4 observed=textureLod(radarMap,vec2(uv.x,(4.-float(r)+uv.y)/5.),0.);
                if(observed.a>radar.a)radar=observed;
              }
            }
            float a=radar.a*radarOpacity;
            result.rgb=mix(result.rgb,radar.rgb,a);result.a=a+result.a*(1.-a);
          }
          if(result.a<.003)discard;
          outColor=vec4(result.rgb/max(result.a,.001),result.a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `.replaceAll('outColor', 'pc_fragColor').replace('out vec4 pc_fragColor;', 'out vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor'),
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1 + 85 / EARTH_KM, 96, 64), this.material);
    this.mesh.renderOrder = 20;
    this.mesh.frustumCulled = false;
  }
  setAtmosphere(a: AtmosphereState, location: Location, demo: boolean) {
    (this.field.image.data as Uint8Array).set(a.field); this.field.needsUpdate = true;
    const u = this.material.uniforms;
    u.center.value.copy(globePoint(location.lat, location.lon, EARTH_KM));
    u.east.value.set(-Math.sin(location.lon * Math.PI / 180), 0, -Math.cos(location.lon * Math.PI / 180));
    u.north.value.crossVectors(globePoint(location.lat, location.lon), u.east.value);
    u.wind.value.copy(u.east.value).multiplyScalar(a.wind[0]).addScaledVector(u.north.value, -a.wind[1]);
    u.lowBase.value = a.baseKm; u.thickness.value = a.thicknessKm; u.terrainHeight.value = a.elevationKm;
    u.widthKm.value = a.widthKm; u.rainRate.value = a.rain; u.snowRate.value = a.snow; u.visibilityKm.value = a.visibilityKm;
    u.regionalEnabled.value = a.source.startsWith('Waiting') ? 0 : 1; u.demo.value = demo ? 1 : 0;
    this.setProfile(a);
  }
  // The column is a 5 x 5 grid of altitude bins; it is small enough to re-upload whenever it changes.
  private setProfile(a: AtmosphereState) {
    const u = this.material.uniforms;
    if (this.profile.image.depth !== a.profileBins) {
      this.profile.dispose();
      this.profile = redVolume(new Uint8Array(25 * a.profileBins), 5, 5, a.profileBins);
    }
    (this.profile.image.data as Uint8Array).set(a.profile); this.profile.needsUpdate = true;
    u.profileMap.value = this.profile; u.profileTopKm.value = a.profileTopKm;
    u.profileAvailable.value = a.profileAvailable ? 1 : 0;
    u.shear.value.copy(u.east.value).multiplyScalar(a.shear[0]).addScaledVector(u.north.value, a.shear[1]);
  }
  setStorm(active: boolean, radiusKm: number) {
    this.material.uniforms.stormEnabled.value = active ? 1 : 0;
    this.material.uniforms.stormRadiusKm.value = Math.max(60, Math.min(900, radiusKm));
  }
  setCloudForecast(texture: THREE.Texture) { this.forecastClouds.dispose(); this.forecastClouds = texture; this.material.uniforms.forecastCloudMap.value = texture; }
  setGlobal(texture: THREE.Texture) { this.global.dispose(); this.global = texture; this.material.uniforms.globalMap.value = texture; this.material.uniforms.globalAvailable.value = 1; }
  setRadar(texture:THREE.Texture,bounds:THREE.Vector4[]){this.radar.dispose();this.radar=texture;this.material.uniforms.radarMap.value=texture;this.material.uniforms.radarBounds.value=bounds;this.material.uniforms.radarEnabled.value=1;}
  setSatellite(texture: THREE.Texture) { this.satellite.dispose(); this.satellite = texture; this.material.uniforms.satelliteMap.value = texture; }
  setQuality(q: Quality) { this.material.uniforms.steps.value = q === 'ultra' ? 144 : q === 'high' ? 96 : 64; }
  dispose() { this.profile.dispose(); this.radar.dispose(); this.forecastClouds.dispose(); this.noise.dispose(); this.global.dispose(); this.field.dispose(); this.satellite.dispose(); this.material.dispose(); this.mesh.geometry.dispose(); }
}
