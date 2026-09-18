import { XMLParser } from 'fast-xml-parser';
export const radarRegions=['conus','alaska','hawaii','carib','guam'];
const labels=['Contiguous U.S.','Alaska','Hawaii','Caribbean','Guam'];
const endpoint=id=>`https://opengeo.ncep.noaa.gov/geoserver/${id}/${id}_bref_qcd/ows`;
const cache=new Map(),pending=new Map();
async function cached(key,load,ttl=120000){
 const hit=cache.get(key);if(hit&&Date.now()-hit.at<ttl)return hit.value;
 if(pending.has(key))return pending.get(key);
 const work=load().then(value=>{cache.set(key,{at:Date.now(),value});if(cache.size>40)cache.delete(cache.keys().next().value);return value;}).finally(()=>pending.delete(key));pending.set(key,work);return work;
}
async function fetchNoaa(url){const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`NOAA returned ${r.status}`);return r;}
export function parseRadarCapabilities(xml,id){
 const doc=new XMLParser({ignoreAttributes:false}).parse(xml);const root=doc.WMS_Capabilities?.Capability?.Layer;
 const layers=Array.isArray(root?.Layer)?root.Layer:[root?.Layer];const layer=layers.find(l=>l?.Name===`${id}_bref_qcd`);
 const b=layer?.EX_GeographicBoundingBox;const dims=Array.isArray(layer?.Dimension)?layer.Dimension:[layer?.Dimension];const dim=dims.find(d=>d?.['@_name']==='time');
 const time=dim?.['@_default'],bounds=[b?.westBoundLongitude,b?.southBoundLatitude,b?.eastBoundLongitude,b?.northBoundLatitude].map(Number);
 if(!time||!Number.isFinite(Date.parse(time))||bounds.some(v=>!Number.isFinite(v))||bounds[2]<=bounds[0]||bounds[3]<=bounds[1])throw new Error('Invalid NOAA radar metadata');
 return {id,name:labels[radarRegions.indexOf(id)],time:new Date(time).toISOString(),bounds};
}
async function metadata(id){return cached(`meta:${id}`,async()=>parseRadarCapabilities(await (await fetchNoaa(`${endpoint(id)}?service=WMS&version=1.3.0&request=GetCapabilities`)).text(),id));}
export function registerRadar(app){
 app.get('/api/radar',async(_req,res)=>{
  const results=await Promise.allSettled(radarRegions.map(metadata));const regions=[],unavailable=[];
  results.forEach((r,i)=>{if(r.status==='fulfilled')regions.push({...r.value,image:`/api/radar/${radarRegions[i]}.png?time=${encodeURIComponent(r.value.time)}`});else unavailable.push(labels[i]);});
  res.set('Cache-Control','no-store');if(!regions.length)return res.status(502).json({error:'NOAA radar is unavailable. No radar coverage is being shown.'});res.json({regions,unavailable,source:'NOAA/NWS MRMS base reflectivity'});
 });
 app.get('/api/radar/:id.png',async(req,res)=>{
  const id=req.params.id;if(!radarRegions.includes(id))return res.status(400).json({error:'Unknown radar region'});
  try{
   const meta=await metadata(id),time=String(req.query.time||meta.time);
   if(!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(time)||!Number.isFinite(Date.parse(time))||Math.abs(Date.parse(time)-Date.parse(meta.time))>7200000)return res.status(400).json({error:'Invalid radar time'});
   const bytes=await cached(`image:${id}:${time}`,async()=>{
    const q=new URLSearchParams({service:'WMS',version:'1.3.0',request:'GetMap',layers:`${id}_bref_qcd`,styles:'',crs:'CRS:84',bbox:meta.bounds.join(','),width:'2048',height:'1024',format:'image/png',transparent:'true',time});
    const r=await fetchNoaa(`${endpoint(id)}?${q}`);if(!r.headers.get('content-type')?.includes('image/png'))throw new Error('NOAA did not return a radar image');return Buffer.from(await r.arrayBuffer());
   },300000);res.set('Cache-Control','public, max-age=120').type('png').send(bytes);
  }catch{res.status(502).json({error:'NOAA radar image unavailable'});}
 });
 app.get('/api/radar-legend',async(_req,res)=>{try{const bytes=await cached('legend',async()=>{const r=await fetchNoaa(`${endpoint('conus')}?service=WMS&version=1.3.0&request=GetLegendGraphic&format=image/png&width=500&height=30&layer=conus_bref_qcd`);if(!r.headers.get('content-type')?.includes('image/png'))throw new Error();return Buffer.from(await r.arrayBuffer());},86400000);res.type('png').send(bytes);}catch{res.sendStatus(502);}});
}
