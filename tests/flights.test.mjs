import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFlights } from '../server/flights.mjs';
test('civilian flight adapter rejects stale, restricted, ground and invalid positions',()=>{
 const now=Date.now();const a={hex:'abc123',t:'A320',flight:'TEST123',lat:40,lon:-74,alt_baro:30000,gs:400,track:90,seen_pos:2};
 const result=normalizeFlights({now,ac:[a,{...a,dbFlags:1},{...a,dbFlags:4},{...a,dbFlags:8},{...a,lat:null},{...a,seen_pos:90},{...a,alt_baro:'ground'},{...a,t:'UNKNOWN'}]},now);
 assert.equal(result.flights.length,1);assert.equal(result.flights[0].category,'airliner');assert.equal(result.flights[0].observedAt,now-2000);assert.ok(result.flights[0].altitudeKm>9);
 assert.throws(()=>normalizeFlights({now:now-120000,ac:[]},now));
});
