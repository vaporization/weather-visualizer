import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTornadoes } from '../server/tornadoes.mjs';
const warning = (overrides = {}, geometry) => ({
  geometry: geometry === undefined ? { type: 'Polygon', coordinates: [[[-97.1, 35.4], [-96.9, 35.4], [-96.9, 35.6], [-97.1, 35.6], [-97.1, 35.4]]] } : geometry,
  properties: { id: 'urn:oid:test.1', event: 'Tornado Warning', areaDesc: 'Oklahoma, OK', severity: 'Extreme', certainty: 'Observed', effective: '2026-05-01T20:00:00Z', expires: '2026-05-01T20:45:00Z', ...overrides },
});
test('tornado warnings keep active warned areas and centre them on the polygon', () => {
  const now = Date.parse('2026-05-01T20:10:00Z');
  const result = normalizeTornadoes({ features: [warning()] }, now);
  assert.equal(result.warnings.length, 1);
  const [w] = result.warnings;
  assert.equal(w.area, 'Oklahoma, OK');
  assert.equal(w.observed, true);
  assert.ok(Math.abs(w.lat - 35.5) < .05 && Math.abs(w.lon + 97) < .05);
  assert.equal(w.polygon.length, 5);
});
test('tornado warnings reject expired, cancelled, other events and missing geometry', () => {
  const now = Date.parse('2026-05-01T20:10:00Z');
  const features = [
    warning({ expires: '2026-05-01T20:05:00Z' }),
    warning({ messageType: 'Cancel' }),
    warning({ event: 'Severe Thunderstorm Warning' }),
    warning({}, null),
    warning({}, { type: 'Polygon', coordinates: [[[-97.1, 35.4], [-96.9, 35.4]]] }),
    warning({ effective: '2026-05-01T23:00:00Z', expires: '2026-05-01T23:45:00Z' }),
  ];
  assert.equal(normalizeTornadoes({ features }, now).warnings.length, 0);
  assert.throws(() => normalizeTornadoes({ features: undefined }, now));
});
test('tornado warnings average longitude across the date line', () => {
  const now = Date.parse('2026-05-01T20:10:00Z');
  const ring = [[179.9, 51.8], [-179.9, 51.8], [-179.9, 52.0], [179.9, 52.0], [179.9, 51.8]];
  const [w] = normalizeTornadoes({ features: [warning({}, { type: 'Polygon', coordinates: [ring] })] }, now).warnings;
  assert.ok(Math.abs(Math.abs(w.lon) - 180) < .1, `expected a longitude near the date line, received ${w.lon}`);
});
