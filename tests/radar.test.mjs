import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRadarCapabilities} from '../server/radar.mjs';
const xml=`<WMS_Capabilities><Capability><Layer><Layer><Name>conus_bref_qcd</Name><EX_GeographicBoundingBox><westBoundLongitude>-130</westBoundLongitude><southBoundLatitude>20</southBoundLatitude><eastBoundLongitude>-60</eastBoundLongitude><northBoundLatitude>55</northBoundLatitude></EX_GeographicBoundingBox><Dimension name="time" default="2026-09-16T01:42:17Z">2026-09-16T01:42:17Z</Dimension></Layer></Layer></Capability></WMS_Capabilities>`;
test('NOAA radar metadata preserves observation time and longitude/latitude bounds',()=>{const r=parseRadarCapabilities(xml,'conus');assert.deepEqual(r.bounds,[-130,20,-60,55]);assert.equal(r.time,'2026-09-16T01:42:17.000Z');assert.throws(()=>parseRadarCapabilities(xml.replace('01:42:17Z','invalid'),'conus'));assert.throws(()=>parseRadarCapabilities(xml,'hawaii'));});
