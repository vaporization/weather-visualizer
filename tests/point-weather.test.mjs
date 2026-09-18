import test from 'node:test';
import assert from 'node:assert/strict';
import { createPointWeather } from '../server/point-weather.mjs';
const point={lat:36.14,lon:-77.45};
const data={current:{temperature_2m:24,time:'2026-09-15T22:30'},hourly:{time:['2026-09-15T23:00']}};
const ok=()=>({ok:true,json:async()=>data});
test('point weather retries a transient failure and coalesces concurrent requests',async()=>{
 let calls=0;const load=createPointWeather({fetcher:async()=>{calls++;if(calls===1)throw new Error('Network failure');return ok();},sleep:async()=>{}});
 const [a,b]=await Promise.all([load(point),load(point)]);assert.equal(calls,2);assert.deepEqual(a,b);assert.equal(a._meta.stale,false);
 await load(point);assert.equal(calls,2);
});
test('weather fallback is age bounded and never reused for a different location',async()=>{
 let clock=0,offline=false;const load=createPointWeather({now:()=>clock,sleep:async()=>{},fetcher:async()=>{if(offline)throw new Error('Offline');return ok();}});
 await load(point);clock=660000;offline=true;
 assert.equal((await load(point))._meta.stale,true);
 await assert.rejects(load({lat:40,lon:-74}));clock=3600001;await assert.rejects(load(point));
});
test('rate limits are not immediately retried',async()=>{
 let calls=0;const load=createPointWeather({fetcher:async()=>{calls++;return {ok:false,status:429};},sleep:async()=>{}});
 await assert.rejects(load(point),/429/);assert.equal(calls,1);
});
