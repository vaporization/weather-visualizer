import { coordinates } from './data.mjs';
export const ROAD_RADIUS_KM = 3;
const lonDelta = (a,b) => ((a-b+540)%360)-180;
// Clip long ways to the selected neighborhood, including date-line crossings.
export function clipRoadSegment(a,b,center,radius=ROAD_RADIUS_KM) {
  const scale=111.32*Math.max(.001,Math.cos(center.lat*Math.PI/180));
  const ax=lonDelta(a.lon,center.lon)*scale, ay=(a.lat-center.lat)*111.32;
  const bx=lonDelta(b.lon,center.lon)*scale, by=(b.lat-center.lat)*111.32;
  const dx=bx-ax,dy=by-ay,A=dx*dx+dy*dy,B=2*(ax*dx+ay*dy),C=ax*ax+ay*ay-radius*radius;
  if(A<1e-14)return null;
  const discriminant=B*B-4*A*C;if(discriminant<0)return null;
  const lo=Math.max(0,(-B-Math.sqrt(discriminant))/(2*A)),hi=Math.min(1,(-B+Math.sqrt(discriminant))/(2*A));
  if(lo>=hi)return null;
  const at=t=>[center.lat+(ay+t*dy)/111.32,((center.lon+(ax+t*dx)/scale+540)%360)-180];
  return [at(lo),at(hi)];
}
export function normalizeRoads(data,center) {
  if(!Array.isArray(data.elements)||data.remark)throw new Error('Incomplete map response');
  const segments=[],places=[],seen=new Set();let truncated=false;
  for(const e of data.elements){
    const id=`${e.type}/${e.id}`;if(seen.has(id))continue;seen.add(id);
    const tags=e.tags||{};
    if(tags.highway && Array.isArray(e.geometry)){
      for(let i=1;i<e.geometry.length;i++){
        const a=e.geometry[i-1],b=e.geometry[i];if(!a||!b||![a.lat,a.lon,b.lat,b.lon].every(Number.isFinite))continue;
        const line=clipRoadSegment(a,b,center);if(!line)continue;
        if(segments.length<60000)segments.push(line);else truncated=true;
      }
    }else if(tags.name){
      const p=e.center||e;if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon))continue;
      const dx=lonDelta(p.lon,center.lon)*111.32*Math.cos(center.lat*Math.PI/180),dy=(p.lat-center.lat)*111.32;
      const distance=Math.hypot(dx,dy);if(distance>ROAD_RADIUS_KM)continue;
      places.push({id,name:String(tags.name).slice(0,100),lat:p.lat,lon:p.lon,kind:tags.tourism||tags.historic||tags.natural?'landmark':'marker',category:tags.tourism||tags.historic||tags.natural||tags.amenity||tags.place||'Place',distance});
    }
  }
  places.sort((a,b)=>a.distance-b.distance);
  return {center,radiusKm:ROAD_RADIUS_KM,segments,places:places.slice(0,100),truncated:truncated||places.length>100,source:'OpenStreetMap',fetchedAt:new Date().toISOString()};
}
export function registerRoads(app){
  const cache=new Map(),pending=new Map();let busy=false,nextRequest=0;
  app.get('/api/roads',async(req,res)=>{
    let p;try{p=coordinates(req.query);}catch(e){return res.status(400).json({error:e.message});}
    p={lat:Number(p.lat.toFixed(4)),lon:Number(p.lon.toFixed(4))};const key=`${p.lat},${p.lon}`,hit=cache.get(key);
    if(hit&&Date.now()-hit.time<86400000)return res.json(hit.data);
    if(!pending.has(key)){
      if(busy||Date.now()<nextRequest)return res.status(503).json({error:'Street data is busy. Please retry shortly.'});
      busy=true;
      const around=`(around:3000,${p.lat},${p.lon})`;
      const query=`[out:json][timeout:20][maxsize:33554432];way[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]${around};out geom; (nwr[tourism~"^(attraction|museum|viewpoint|gallery)$"][name]${around};nwr[historic][name]${around};node[natural=peak][name]${around};node[place~"^(suburb|neighbourhood|village|town)$"][name]${around};nwr[amenity~"^(hospital|school|university|bus_station|library)$"][name]${around};);out center;`;
      pending.set(key,(async()=>{
        const response=await fetch(process.env.OVERPASS_URL||'https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'AtmoWeatherGlobe/0.2'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error(`Map provider ${response.status}`);
        const data=normalizeRoads(await response.json(),p);cache.set(key,{time:Date.now(),data});if(cache.size>32)cache.delete(cache.keys().next().value);return data;
      })().finally(()=>{busy=false;nextRequest=Date.now()+3000;pending.delete(key);}));
    }
    try{res.json(await pending.get(key));}catch{res.status(502).json({error:'Street data is temporarily unavailable. Please retry.'});}
  });
}
