const types = {
 airliner: 'A318,A319,A320,A321,A20N,A21N,A332,A333,A339,A359,A35K,A388,B737,B738,B739,B38M,B39M,B744,B748,B752,B763,B772,B77W,B788,B789,B78X,E170,E190,E195,E290,E295,CRJ7,CRJ9,AT72,DH8D',
 business: 'C25A,C25B,C25C,C510,C525,C550,C560,C680,C700,C750,CL30,CL35,CL60,GL5T,GL7T,GLEX,FA7X,FA8X',
 light: 'C150,C152,C172,C182,C206,PA28,PA32,SR20,SR22,DA40,DA42,DA62,BE36'
};
const categories = new Map(Object.entries(types).flatMap(([category, list]) => list.split(',').map(t => [t, category])));
export function normalizeFlights(data, now = Date.now()) {
 if (!Array.isArray(data?.ac) || !Number.isFinite(data.now)) throw new Error('Invalid flight feed');
 const timestamp = data.now > 1e12 ? data.now : data.now * 1000;
 if (Math.abs(now-timestamp)>60000) throw new Error('Flight feed is stale');
 return { timestamp, source:'ADSB.lol', flights: data.ac.filter(a => categories.has(a.t) && !(Number(a.dbFlags || 0) & 13) && a.alt_baro !== 'ground' && Number.isFinite(a.lat) && Math.abs(a.lat)<=90 && Number.isFinite(a.lon) && Math.abs(a.lon)<=180 && Number.isFinite(a.seen_pos) && a.seen_pos>=0 && a.seen_pos<=15 && Number.isFinite(a.gs) && a.gs>=0 && a.gs<800 && Number.isFinite(a.track) && Number.isFinite(a.alt_geom ?? a.alt_baro)).slice(0,10000).map(a => ({ id:a.hex, callsign:String(a.flight||a.r||a.hex).trim().slice(0,20), type:a.t, category:categories.get(a.t), lat:a.lat, lon:a.lon, altitudeKm:Math.max(.02,(a.alt_geom??a.alt_baro)*.0003048), speedKms:a.gs*.000514444, heading:a.track, observedAt:timestamp-a.seen_pos*1000 })) };
}
export function registerFlights(app) {
 let snapshot, pending, retryAt=0;
 app.get('/api/flights',async(_req,res)=>{
  if(!process.env.FLIGHT_CONTACT)return res.status(503).json({error:'Configure a flight contact in the desktop File > Settings menu (or FLIGHT_CONTACT for the web server).'});
  if(snapshot && Date.now()-snapshot.timestamp<15000)return res.json(snapshot);
  if(Date.now()<retryAt)return res.status(503).json({error:'Flight provider temporarily unavailable; retrying shortly.'});
  try {
   pending ??= (async()=>{
    const r=await fetch('https://api.adsb.lol/v2/type/'+[...categories.keys()].join(','),{headers:{'User-Agent':`AtmoWeatherVisualizer/0.3 (contact: ${process.env.FLIGHT_CONTACT})`},signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw new Error('Flight provider unavailable');
    snapshot=normalizeFlights(await r.json());return snapshot;
   })().catch(e=>{retryAt=Date.now()+60000;throw e;}).finally(()=>{pending=null;});
   res.json(await pending);
  }catch{res.status(502).json({error:'Flight provider unavailable. No live positions are being shown.'});}
 });
}
