import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTornadoes, parseStormMotion } from '../server/tornadoes.mjs';
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

// Real strings from the archived Grant County, IN warning of 2026-09-17. Successive updates put the
// cell at 40.54,-85.68 then 40.5,-85.61 then 40.48,-85.54: east-southeast at 19 kt, which is what
// "294DEG" means once read as the direction the storm comes from.
test('storm motion is read from the event motion description', () => {
  const m = parseStormMotion('2026-09-17T05:47:00-00:00...storm...294DEG...19KT...40.5,-85.61');
  assert.equal(m.lat, 40.5);
  assert.equal(m.lon, -85.61);
  assert.equal(m.headingDeg, 114);
  assert.equal(m.speedKmh, 35.2);
  assert.equal(m.at, '2026-09-17T05:47:00.000Z');
  const wrapped = parseStormMotion('2026-09-17T05:47:00-00:00...storm...010DEG...12KT...40.5,-85.61');
  assert.equal(wrapped.headingDeg, 190, 'a heading past north wraps rather than exceeding 360');
  for (const bad of ['', null, undefined, 'no motion here', '2026-09-17T05:47:00-00:00...storm...999DEG...19KT...40.5,-85.61', '2026-09-17T05:47:00-00:00...storm...294DEG...19KT...99.5,-85.61'])
    assert.equal(parseStormMotion(bad), null, `refused: ${bad}`);
});
test('warnings carry detection, damage threat and the storm cell alongside the warned area', () => {
  const now = Date.parse('2026-05-01T20:10:00Z');
  const detailed = warning();
  detailed.properties.parameters = {
    tornadoDetection: ['RADAR INDICATED'],
    tornadoDamageThreat: ['CONSIDERABLE'],
    maxHailSize: ['Up to 1.75'],
    eventMotionDescription: ['2026-05-01T20:05:00-00:00...storm...230DEG...31KT...35.5,-97.0'],
  };
  const [w] = normalizeTornadoes({ features: [detailed] }, now).warnings;
  assert.equal(w.detection, 'RADAR INDICATED');
  assert.equal(w.damageThreat, 'CONSIDERABLE');
  assert.equal(w.hail, 'Up to 1.75');
  assert.equal(w.motion.headingDeg, 50);
  assert.equal(w.observed, false, 'radar indicated is not an observed tornado, whatever certainty says');
  const plain = warning();
  const [p] = normalizeTornadoes({ features: [plain] }, now).warnings;
  assert.equal(p.motion, null);
  assert.equal(p.detection, 'UNSPECIFIED');
  assert.equal(p.observed, true, 'with no detection parameter the alert certainty is the fallback');
});
