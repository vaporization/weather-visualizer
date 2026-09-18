import test from 'node:test';
import assert from 'node:assert/strict';
import { PbfWriter } from 'pbf';
import { decodeVehiclePositions, normalizeTransit, TRANSIT_FEEDS } from '../server/transit.mjs';
// Encode a FeedMessage the way an agency would, straight from the field numbers.
function feedMessage(vehicles, headerTimestamp) {
  const w = new PbfWriter();
  w.writeMessage(1, (h, p) => { p.writeStringField(1, '2.0'); p.writeVarintField(3, headerTimestamp); }, null);
  vehicles.forEach((v, i) => w.writeMessage(2, (e, p) => {
    p.writeStringField(1, `e${i}`);
    p.writeMessage(4, (_, pv) => {
      if (v.route) pv.writeMessage(1, (__, pt) => { pt.writeStringField(1, 'trip'); pt.writeStringField(5, v.route); }, null);
      pv.writeMessage(2, (__, pp) => { pp.writeFloatField(1, v.lat); pp.writeFloatField(2, v.lon); if (v.bearing != null) pp.writeFloatField(3, v.bearing); if (v.speed != null) pp.writeFloatField(5, v.speed); }, null);
      if (v.timestamp) pv.writeVarintField(5, v.timestamp);
      pv.writeMessage(8, (__, pd) => { pd.writeStringField(1, v.id); if (v.label) pd.writeStringField(2, v.label); }, null);
      pv.writeVarintField(9, 2); // occupancy_status: a field we do not read must be skipped cleanly
    }, null);
  }, null));
  return new Uint8Array(w.finish());
}
test('GTFS-Realtime vehicle positions decode from the wire and normalise to compact rows', () => {
  const now = Date.parse('2026-09-18T21:00:00Z'), t = Math.floor(now / 1000);
  const bytes = feedMessage([
    { id: 'bus-1', label: '1701', route: 'Green-B', lat: 42.35, lon: -71.08, bearing: 271.6, speed: 8.2, timestamp: t - 20 },
    { id: 'bus-2', route: '39', lat: 42.30, lon: -71.10, timestamp: t - 2000 },
    { id: 'bus-3', lat: 0, lon: 0, timestamp: t },
    { id: 'bus-4', lat: 42.36, lon: -71.06 },
  ], t - 5);
  const decoded = decodeVehiclePositions(bytes);
  assert.equal(decoded.timestamp, t - 5);
  assert.equal(decoded.vehicles.length, 4);
  const rows = normalizeTransit('mbta', decoded, now);
  assert.deepEqual(rows[0], ['mbta', '1701', 42.35, -71.08, 272, 30, 'Green-B', 20]);
  assert.equal(rows.length, 2, 'a 33-minute-old report and a 0,0 fix are dropped');
  assert.deepEqual(rows[1].slice(0, 2), ['mbta', 'bus-4']);
  assert.equal(rows[1][7], 5, 'a vehicle without its own timestamp inherits the feed header time');
  assert.deepEqual(rows[1].slice(4, 7), [null, null, ''], 'missing bearing, speed and route are null or empty, never invented');
});
test('the transit registry stays keyless and attributed', () => {
  for (const feed of TRANSIT_FEEDS) { assert.match(feed.url, /^https:\/\//); assert.ok(feed.attribution && feed.href, feed.id); assert.doesNotMatch(feed.url, /key=|token=/i); }
});
