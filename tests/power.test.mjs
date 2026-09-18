import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePower, voltageKv } from '../server/power.mjs';
test('voltage tags in volts, kilovolts and multi-circuit lists resolve to the highest kilovolt value', () => {
  assert.equal(voltageKv('110000'), 110);
  assert.equal(voltageKv('110000;220000'), 220);
  assert.equal(voltageKv('400 kV'), 400);
  assert.equal(voltageKv('20000/10000'), 20);
  assert.equal(voltageKv(''), null);
  assert.equal(voltageKv('unknown'), null);
});
test('power response separates lines with thinned geometry from substations and plants at their centres', () => {
  const center = { lat: 40.7, lon: -74 };
  const geometry = [{ lat: 40.70000, lon: -74.00000 }, { lat: 40.70001, lon: -74.00001 }, { lat: 40.71, lon: -74.01 }, { lat: 40.72, lon: -74.02 }];
  const data = { elements: [
    { type: 'way', id: 1, tags: { power: 'line', voltage: '345000', name: 'Branchburg', operator: 'PSE&G', circuits: '2' }, geometry },
    { type: 'way', id: 1, tags: { power: 'line' }, geometry },
    { type: 'way', id: 2, tags: { power: 'minor_line' }, geometry: [{ lat: 40.7, lon: -74 }] },
    { type: 'node', id: 3, lat: 40.75, lon: -73.99, tags: { power: 'substation', voltage: '138000', substation: 'transmission', name: 'Hell Gate' } },
    { type: 'way', id: 4, center: { lat: 40.8, lon: -73.9 }, tags: { power: 'plant', 'plant:source': 'gas', 'plant:output:electricity': '500 MW', name: 'Ravenswood' } },
    { type: 'node', id: 5, tags: { power: 'plant' } },
  ] };
  const result = normalizePower(data, center);
  assert.equal(result.lines.length, 1, 'duplicate way and a one-point way are dropped');
  assert.equal(result.lines[0].points.length, 3, 'a vertex under 80 m from the last is thinned');
  assert.deepEqual([result.lines[0].voltageKv, result.lines[0].circuits, result.lines[0].kind], [345, 2, 'line']);
  assert.deepEqual(result.substations.map(s => [s.name, s.voltageKv, s.kind]), [['Hell Gate', 138, 'transmission']]);
  assert.deepEqual(result.plants.map(p => [p.name, p.source, p.output, p.lat]), [['Ravenswood', 'gas', '500 MW', 40.8]]);
  assert.equal(result.radiusKm, 60);
  assert.throws(() => normalizePower({ elements: [], remark: 'runtime error: query timed out' }, center));
});
