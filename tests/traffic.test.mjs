import test from 'node:test';
import assert from 'node:assert/strict';
import { PbfWriter } from 'pbf';
import { FLOW_ZOOM, decodeFlow, tileAt, tilesAround } from '../server/traffic.mjs';
import { mergeEnv, validateKeys } from '../server/settings.mjs';
// A minimal Mapbox Vector Tile writer: enough of the spec to build a "Traffic flow" layer fixture.
const zig = n => (n << 1) ^ (n >> 31);
function encodeTile(layerName, features, extent = 4096) {
  const keys = [], values = [], keyOf = k => { let i = keys.indexOf(k); if (i < 0) { keys.push(k); i = keys.length - 1; } return i; };
  const valueOf = v => { const s = JSON.stringify(v); let i = values.findIndex(x => JSON.stringify(x) === s); if (i < 0) { values.push(v); i = values.length - 1; } return i; };
  const writeFeature = (f, pbf) => {
    pbf.writeVarintField(1, f.id);
    pbf.writePackedVarint(2, Object.entries(f.props).flatMap(([k, v]) => [keyOf(k), valueOf(v)]));
    pbf.writeVarintField(3, 2); // LINESTRING
    const geom = []; let px = 0, py = 0;
    for (const line of f.lines) { geom.push((1 << 3) | 1, zig(line[0][0] - px), zig(line[0][1] - py)); [px, py] = line[0]; geom.push(((line.length - 1) << 3) | 2); for (const [x, y] of line.slice(1)) { geom.push(zig(x - px), zig(y - py)); px = x; py = y; } }
    pbf.writePackedVarint(4, geom);
  };
  const writeValue = (v, pbf) => { if (typeof v === 'string') pbf.writeStringField(1, v); else if (typeof v === 'boolean') pbf.writeBooleanField(7, v); else pbf.writeDoubleField(3, v); };
  const writeLayer = (_, pbf) => {
    pbf.writeVarintField(15, 2); pbf.writeStringField(1, layerName);
    for (const f of features) pbf.writeMessage(2, writeFeature, f);
    for (const k of keys) pbf.writeStringField(3, k);
    for (const v of values) pbf.writeMessage(4, writeValue, v);
    pbf.writeVarintField(5, extent);
  };
  const out = new PbfWriter(); out.writeMessage(3, writeLayer, null); return out.finish();
}
test('tile arithmetic matches the slippy-map convention and wraps at the antimeridian', () => {
  assert.deepEqual(tileAt(0, 0, 1), { x: 1, y: 1 });
  assert.deepEqual(tileAt(51.5074, -0.1278, 12), { x: 2046, y: 1362 }, 'London at z12');
  const around = tilesAround(0, 179.99, 3, 1);
  assert.equal(around.length, 9);
  assert.ok(around.some(t => t.x === 0) && around.some(t => t.x === 7), 'neighbours wrap around x');
  assert.equal(tilesAround(89.9, 0, 3, 1).filter(t => t.y < 0).length, 0, 'rows never leave the grid');
  assert.equal(tilesAround(51.5, -0.1).length, 25, `default reach covers a 5×5 block at z${FLOW_ZOOM}`);
});
test('flow tiles decode to clamped levels, closures and rounded lat/lon paths', () => {
  const bytes = encodeTile('Traffic flow', [
    { id: 1, props: { traffic_level: 0.42, road_type: 'Motorway' }, lines: [[[0, 0], [4096, 4096]]] },
    { id: 2, props: { road_closure: true, road_type: 'Local road' }, lines: [[[100, 100], [200, 100], [200, 200]]] },
    { id: 3, props: { traffic_level: 1.7 }, lines: [[[10, 10], [20, 20]]] },
    { id: 4, props: { road_type: 'no level' }, lines: [[[10, 10], [20, 20]]] },
  ]);
  const segments = decodeFlow(bytes, 1, 1, 1);
  assert.equal(segments.length, 3, 'a feature without a level or closure is skipped');
  const [level, closure, points, road] = segments[0];
  assert.equal(level, 0.42); assert.equal(closure, 0); assert.equal(road, 'Motorway');
  assert.deepEqual(points[0], [0, 0], 'tile 1/1/1 starts at the equator and prime meridian');
  assert.equal(points[1][1], 180); assert.ok(points[1][0] < -85);
  assert.deepEqual(segments[1].slice(0, 2), [0, 1], 'a closure with no level is drawn as closed');
  assert.equal(segments[1][2].length, 3);
  assert.equal(segments[2][0], 1, 'levels are clamped to 0–1');
  assert.deepEqual(decodeFlow(encodeTile('Other', []), 1, 1, 1), [], 'a tile without the flow layer is empty');
  assert.deepEqual(decodeFlow(new Uint8Array([1, 2, 3]), 1, 1, 1), [], 'garbage does not throw');
});
test('browser-mode key entry validates like the desktop settings and merges into .env.local', () => {
  assert.deepEqual(validateKeys({ TOMTOM_API_KEY: ' abc-123 ', unknown: 'x' }), { TOMTOM_API_KEY: 'abc-123' });
  assert.throws(() => validateKeys({ TOMTOM_API_KEY: 'has space' }), /letters, digits/);
  assert.throws(() => validateKeys({ FLIGHT_CONTACT: 'not-an-email' }), /email address/);
  assert.throws(() => validateKeys({ FIRMS_MAP_KEY: 'a\nb' }), /too long/);
  assert.deepEqual(validateKeys({ FIRMS_MAP_KEY: '' }), { FIRMS_MAP_KEY: '' }, 'an empty value clears a key');
  const merged = mergeEnv('# comment\nESRI_API_KEY=old\nFIRMS_MAP_KEY=keep\n', { ESRI_API_KEY: 'new', TOMTOM_API_KEY: 'tt', AISSTREAM_API_KEY: '' });
  assert.equal(merged, '# comment\nESRI_API_KEY=new\nFIRMS_MAP_KEY=keep\nTOMTOM_API_KEY=tt\n');
  assert.equal(mergeEnv('AISSTREAM_API_KEY=gone\nOTHER=1\n', { AISSTREAM_API_KEY: '' }), 'OTHER=1\n', 'clearing removes the line');
  assert.equal(mergeEnv('', { TOMTOM_API_KEY: 'tt' }), 'TOMTOM_API_KEY=tt\n');
});
