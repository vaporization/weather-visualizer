import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuakes } from '../server/earthquakes.mjs';
import { parseTle } from '../server/satellites.mjs';
test('earthquake feed keeps valid events, orders by magnitude and drops malformed or future entries', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');
  const feature = (mag, time, coords, extra = {}) => ({ id: `us${mag}`, properties: { mag, time, place: 'Somewhere', ...extra }, geometry: { coordinates: coords } });
  const data = { features: [
    feature(2.1, now - 3600000, [-122.4, 37.8, 8.2]),
    feature(5.6, now - 7200000, [140.1, 36.2, 45.7], { tsunami: 1 }),
    feature(3.0, now + 7200000, [10, 10, 5]),
    feature(3.0, now, [200, 10, 5]),
    { id: 'bad', properties: { mag: 'x', time: now }, geometry: { coordinates: [1, 1] } },
    feature(1.5, now - 60000, [0, 0]),
  ] };
  const result = normalizeQuakes(data, 'all_day', now);
  assert.deepEqual(result.quakes.map(q => q.mag), [5.6, 2.1, 1.5]);
  assert.equal(result.quakes[0].tsunami, true);
  assert.equal(result.quakes[0].depthKm, 45.7);
  assert.equal(result.quakes[2].depthKm, 0);
  assert.equal(result.quakes[0].time, new Date(now - 7200000).toISOString());
  assert.throws(() => normalizeQuakes({ features: 'nope' }, 'all_day', now));
});
test('TLE text parses name and matching element lines and skips broken sets', () => {
  const iss1 = '1 25544U 98067A   26261.51782528  .00016717  00000-0  10270-3 0  9005';
  const iss2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';
  const text = ['ISS (ZARYA)', iss1, iss2, 'BROKEN', '1 99999U', '2 99999  51.6', 'MISMATCH', iss1, iss2.replace('25544', '25545'), ''].join('\n');
  const sats = parseTle(text, 'stations');
  assert.equal(sats.length, 1);
  assert.equal(sats[0].name, 'ISS (ZARYA)');
  assert.equal(sats[0].group, 'stations');
  assert.equal(sats[0].line2, iss2);
  assert.deepEqual(parseTle('', 'visual'), []);
});
