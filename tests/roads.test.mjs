import test from 'node:test';
import assert from 'node:assert/strict';
import { clipRoadSegment, normalizeRoads } from '../server/roads.mjs';
test('road geometry is clipped to the selected radius, including the date line',()=>{
 const line=clipRoadSegment({lat:0,lon:-1},{lat:0,lon:1},{lat:0,lon:0});
 assert.ok(Math.abs(line[0][1]*111.32+3)<1e-7);assert.ok(Math.abs(line[1][1]*111.32-3)<1e-7);
 assert.equal(clipRoadSegment({lat:1,lon:1},{lat:2,lon:2},{lat:0,lon:0}),null);
 assert.ok(clipRoadSegment({lat:0,lon:179.98},{lat:0,lon:-179.98},{lat:0,lon:180}));
});
test('street data separates landmarks and place markers and rejects partial provider results',()=>{
 const elements=[{type:'way',id:1,tags:{highway:'residential'},geometry:[{lat:0,lon:-.01},{lat:0,lon:.01}]},{type:'node',id:2,lat:0,lon:0,tags:{name:'Museum',tourism:'museum'}},{type:'way',id:3,center:{lat:0,lon:.01},tags:{name:'School',amenity:'school'}},{type:'node',id:4,lat:60,lon:20,tags:{name:'Distant',tourism:'museum'}}];
 const result=normalizeRoads({elements},{lat:0,lon:0});assert.equal(result.segments.length,1);assert.deepEqual(result.places.map(p=>p.kind),['landmark','marker']);
 assert.throws(()=>normalizeRoads({elements,remark:'runtime error'},{lat:0,lon:0}));
});
