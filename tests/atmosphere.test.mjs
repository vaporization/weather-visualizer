import test from 'node:test';
import assert from 'node:assert/strict';
import { regionalGrid, normalizeMetars, parseOpticalPalette } from '../server/atmosphere.mjs';

test('regional sampling wraps the date line and preserves the selected center', () => {
  const grid = regionalGrid(45, 179.9);
  assert.equal(grid.points.length, 25);
  assert.ok(Math.abs(grid.points[12].lon - 179.9) < 1e-8);
  assert.ok(grid.points.some(p => p.lon < -179));
  assert.ok(grid.points.every(p => p.lon >= -180 && p.lon <= 180));
  assert.ok(regionalGrid(90, 0).points.every(p => Number.isFinite(p.lon) && Math.abs(p.lat) < 90));
});
test('airport reports retain newest recent observations and convert cloud bases and visibility', () => {
  const now = Date.UTC(2026, 8, 15, 12);
  const report = { icaoId: 'KTEST', lat: 40, lon: -74, obsTime: now / 1000 - 600, clouds: [{ cover: 'BKN', base: 2500 }], visib: '10+', wspd: 10 };
  const result = normalizeMetars([report, { ...report, obsTime: now / 1000 - 1200 }, { ...report, icaoId: 'OLD', obsTime: now / 1000 - 14400 }, { ...report, icaoId: 'FUTURE', obsTime: now / 1000 + 3600 }, { ...report, icaoId: 'FAR', lat: 0 }], { lat: 40, lon: -74 }, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].clouds[0].baseMetersAGL, 762);
  assert.equal(result[0].visibilityAtLeast, true);
  assert.equal(result[0].windSpeed, 18.52);
  assert.equal(result[0].observed, new Date(report.obsTime * 1000).toISOString());
});
test('satellite palette ignores missing data and decodes numeric optical thickness bins', () => {
  const xml = '<ColorMaps><ColorMap><Entries><ColorMapEntry rgb="0,0,0" transparent="true"/><ColorMapEntry rgb="1,2,3" transparent="false" value="[2,4)"/></Entries></ColorMap></ColorMaps>';
  assert.deepEqual(parseOpticalPalette(xml), [{ rgb: [1, 2, 3], value: 3 }]);
});

import { globalPoints } from '../server/global-weather.mjs';
test('global model sampling covers the globe in texture row order without duplicate seams', () => {
  const points = globalPoints();
  assert.equal(points.length, 288);
  assert.deepEqual(points[0], {lat:-82.5,lon:-172.5});
  assert.deepEqual(points[23], {lat:-82.5,lon:172.5});
  assert.deepEqual(points[287], {lat:82.5,lon:172.5});
  assert.equal(new Set(points.map(p=>`${p.lat}/${p.lon}`)).size,288);
});

import { validGlobalHourly } from '../server/global-weather.mjs';
test('global cloud layers reject missing values and mismatched forecast hours', () => {
 const times=['2026-09-15T23:00','2026-09-16T00:00'];
 const hourly=Object.fromEntries(['cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','precipitation','wind_speed_10m','wind_direction_10m','temperature_2m'].map(k=>[k,[10,20]]));
 hourly.time=times;
 assert.equal(validGlobalHourly(hourly,times),true);
 assert.equal(validGlobalHourly({...hourly,cloud_cover_mid:[null,20]},times),false);
 assert.equal(validGlobalHourly({...hourly,cloud_cover_high:[]},times),false);
 assert.equal(validGlobalHourly({...hourly,time:[times[1],times[0]]},times),false);
});
