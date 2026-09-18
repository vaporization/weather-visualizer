import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { coordinates, extractPolygons } from '../server/data.mjs';

test('coordinate validation accepts poles and rejects invalid or missing input', () => {
  assert.deepEqual(coordinates({ lat: '90', lon: '-180' }), { lat: 90, lon: -180 });
  for (const p of [{}, { lat: '', lon: '' }, { lat: 'no', lon: 1 }, { lat: 91, lon: 0 }, { lat: 0, lon: 181 }]) assert.throws(() => coordinates(p));
});
test('NHC KML wind rings retain longitude/latitude order and all disjoint polygons', () => {
  const polygon = coords => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  const xml = `<kml><Document><Folder><Placemark><MultiGeometry>${polygon('-70,20,0 -69,20,0 -69,21,0 -70,20,0')}${polygon('179,5,0 -179,5,0 179,6,0 179,5,0')}</MultiGeometry></Placemark></Folder></Document></kml>`;
  const rings = extractPolygons(zipSync({ 'doc.kml': strToU8(xml) }));
  assert.equal(rings.length, 2); assert.deepEqual(rings[0][0], [-70, 20]); assert.deepEqual(rings[1][1], [-179, 5]);
});
test('KMZ without KML provides no fabricated extent', () => { assert.deepEqual(extractPolygons(zipSync({ 'readme.txt': strToU8('no data') })), []); });
