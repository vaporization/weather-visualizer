import test from 'node:test';
import assert from 'node:assert/strict';
import { CCTV_SOURCES, acceptCameras } from '../server/cctv.mjs';
const source = id => CCTV_SOURCES.find(s => s.id === id);
test('each camera list normalises to id, name, position and a frame on the agency origin', () => {
  const tfl = acceptCameras(source('tfl'), source('tfl').normalize([{ id: 'JamCams_00002.00865', commonName: 'A406 Billet Upass E', lat: 51.60067, lon: -0.01594, additionalProperties: [{ key: 'imageUrl', value: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg' }] }, { id: 'x', commonName: 'no image', lat: 51.5, lon: 0 }]));
  assert.deepEqual(tfl, [{ id: 'JamCams_00002.00865', name: 'A406 Billet Upass E', lat: 51.60067, lon: -0.01594, image: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg' }]);
  const caltrans = acceptCameras(source('caltrans'), source('caltrans').normalize([{ data: [
    { cctv: { index: '1', inService: 'true', location: { latitude: '37.82539', longitude: '-122.27291', locationName: 'TV102 -- I-580 : West of SR-24' }, imageData: { static: { currentImageURL: 'https://cwwp2.dot.ca.gov/data/d4/cctv/image/tv102/tv102.jpg' } } } },
    { cctv: { index: '2', inService: 'false', location: { latitude: '37.8', longitude: '-122.2', locationName: 'off' }, imageData: { static: { currentImageURL: 'https://cwwp2.dot.ca.gov/x.jpg' } } } },
    { cctv: { index: '3', inService: 'true', location: { latitude: '37.8', longitude: '-122.2', locationName: 'elsewhere' }, imageData: { static: { currentImageURL: 'http://evil.example/x.jpg' } } } },
  ] }]));
  assert.equal(caltrans.length, 1, 'out-of-service cameras and frames off the agency origin are refused');
  assert.equal(caltrans[0].lat, 37.82539);
  const austin = acceptCameras(source('austin'), source('austin').normalize([{ camera_id: '1', location_name: '830 BLK W RUNDBERG LN', camera_status: 'TURNED_ON', location: { type: 'Point', coordinates: [-97.698158, 30.363686] } }, { camera_id: '2', location_name: 'off', camera_status: 'TURNED_OFF', location: { coordinates: [-97.7, 30.3] } }]));
  assert.deepEqual(austin.map(c => [c.id, c.lat, c.image]), [['1', 30.36369, 'https://cctv.austinmobility.io/image/1.jpg']]);
  const fin = acceptCameras(source('fintraffic'), source('fintraffic').normalize({ features: [{ geometry: { coordinates: [23.99616, 60.05374, 0] }, properties: { name: 'kt51_Inkoo', presets: [{ id: 'C0150301' }, { id: 'C0150302' }] } }, { geometry: { coordinates: [24, 60] }, properties: { name: 'kt52_None', presets: [] } }] }));
  assert.deepEqual(fin, [{ id: 'C0150301', name: 'Inkoo', lat: 60.05374, lon: 23.99616, image: 'https://weathercam.digitraffic.fi/C0150301.jpg' }]);
  const bc = acceptCameras(source('drivebc'), source('drivebc').normalize([{ id: 783, name: 'Midway - S', is_on: true, location: { coordinates: [-123.088139, 49.332011] } }, { id: 784, name: 'off', is_on: false, location: { coordinates: [-123, 49] } }]));
  assert.deepEqual(bc.map(c => [c.id, c.image]), [['783', 'https://www.drivebc.ca/images/783.jpg']]);
  const nsw = acceptCameras(source('nsw'), source('nsw').normalize({ features: [{ id: '5ways', geometry: { coordinates: [151.10533, -34.02977] }, properties: { title: '5 Ways (Miranda)', href: 'https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/5_ways_miranda.jpeg' } }] }));
  assert.equal(nsw[0].name, '5 Ways (Miranda)'); assert.equal(nsw[0].lon, 151.10533);
});
test('the allowlist refuses bad ids, null fixes, duplicates and foreign origins', () => {
  const s = source('drivebc');
  const cams = acceptCameras(s, [
    { id: '1', name: 'a', lat: 49, lon: -123, image: 'https://www.drivebc.ca/images/1.jpg' },
    { id: '1', name: 'dup', lat: 49, lon: -123, image: 'https://www.drivebc.ca/images/1.jpg' },
    { id: '../etc', name: 'bad id', lat: 49, lon: -123, image: 'https://www.drivebc.ca/images/2.jpg' },
    { id: '3', name: 'null fix', lat: 0, lon: 0, image: 'https://www.drivebc.ca/images/3.jpg' },
    { id: '4', name: 'foreign', lat: 49, lon: -123, image: 'https://www.drivebc.ca.evil.example/images/4.jpg' },
  ]);
  assert.deepEqual(cams.map(c => c.id), ['1']);
});
