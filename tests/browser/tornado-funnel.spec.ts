import { test, expect } from '@playwright/test';

const LAT = 40.7128, LON = -74.006;

test('the funnel is anchored on the radar-identified cell, carried along its reported track', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async ([lat, lon]) => {
    const { funnelAnchor, funnelShape } = await import('/src/tornado.ts');
    const base = { id: 'x', area: 'x', severity: 'Extreme', observed: true, effective: '', expires: '', lat, lon, polygon: [] };
    const at = new Date('2026-09-23T00:00:00Z').getTime();
    // Reported four minutes ago, moving east-southeast at 35 km/h: about 2.3 km along the track.
    const moving = funnelAnchor({ ...base, motion: { at: new Date(at - 4 * 60000).toISOString(), lat, lon, headingDeg: 90, speedKmh: 35 } } as never, at);
    const stale = funnelAnchor({ ...base, motion: { at: new Date(at - 3 * 3600000).toISOString(), lat, lon, headingDeg: 90, speedKmh: 35 } } as never, at);
    const none = funnelAnchor(base as never, at);
    const scale = 111.32 * Math.cos(lat * Math.PI / 180);
    return {
      movedKm: +((moving.lon - lon) * scale).toFixed(2), movedLat: +(moving.lat - lat).toFixed(4), fromCell: moving.fromCell,
      staleKm: +((stale.lon - lon) * scale).toFixed(2),
      none: { lat: none.lat, lon: none.lon, fromCell: none.fromCell },
      plain: funnelShape(base as never), severe: funnelShape({ ...base, damageThreat: 'CATASTROPHIC' } as never),
      radar: funnelShape({ ...base, observed: false } as never).strength,
    };
  }, [LAT, LON]);
  expect(r.movedKm).toBeCloseTo(2.33, 1);
  expect(Math.abs(r.movedLat)).toBeLessThan(0.0001);
  expect(r.fromCell).toBe(true);
  // A three-hour-old report is not carried three hours downstream.
  expect(r.staleKm).toBeLessThan(12);
  expect(r.none.fromCell).toBe(false);
  expect(r.severe.topRadiusKm).toBeGreaterThan(r.plain.topRadiusKm);
  expect(r.radar).toBeLessThan(1);
});

test('the funnel is a volume that answers to the warning it came from', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 400)); });
  await page.goto('/');
  const out = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { TornadoLayer } = await import('/src/tornado.ts');
    const { globePoint, EARTH_KM } = await import('/src/weatherShell.ts');
    const LAT = 0, LON = 0;
    const size = 420;
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, alpha: true });
    renderer.setSize(size, size); renderer.setClearColor(0x14202c, 1);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, .000001, 80);
    const layer = new TornadoLayer(); scene.add(layer.group);
    const terrain = { elevationAt: () => 0 } as never;
    const warning = (over: Record<string, unknown> = {}) => ({
      id: 'x', area: 'x', severity: 'Extreme', observed: true, detection: 'OBSERVED',
      damageThreat: null, hail: null, motion: null,
      effective: '', expires: '', lat: LAT, lon: LON,
      polygon: [[LON - .05, LAT - .05], [LON + .05, LAT - .05], [LON + .05, LAT + .05], [LON - .05, LAT + .05]],
      ...over,
    });
    // Stand back far enough that the whole funnel fits in frame.
    const eye = globePoint(LAT - 6 / 111.32, LON, 1 + 1.3 / EARTH_KM);
    camera.position.copy(eye);
    camera.up.copy(globePoint(LAT, LON, 1)).normalize();
    camera.lookAt(globePoint(LAT, LON, 1 + .8 / EARTH_KM));
    camera.updateMatrixWorld();
    const sunDir = new THREE.Vector3().copy(globePoint(LAT, LON, 1)).normalize()
      .multiplyScalar(.5).add(new THREE.Vector3(0, 0, 1)).normalize();
    const shoot = (over: Record<string, unknown> = {}, baseKm = 1.5) => {
      layer.setData({ fetchedAt: '', source: 't', warnings: [warning(over)] } as never);
      layer.setSun(sunDir); layer.setCloudBase(baseKm);
      layer.update(terrain, 2, 3.5, camera, Date.parse('2026-09-23T00:00:00Z'));
      renderer.setRenderTarget(null); renderer.render(scene, camera);
      const bytes = new Uint8Array(size * size * 4);
      const gl = renderer.getContext();
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return { bytes };
    };
    const empty = (() => {
      layer.setData({ fetchedAt: '', source: 't', warnings: [] } as never);
      layer.update(terrain, 2, 3.5, camera, 0);
      renderer.setRenderTarget(null); renderer.render(scene, camera);
      const bytes = new Uint8Array(size * size * 4);
      const gl = renderer.getContext();
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return bytes;
    })();
    const plain = shoot();
    const severe = shoot({ damageThreat: 'CATASTROPHIC' });
    const radar = shoot({ observed: false, detection: 'RADAR INDICATED' });
    const tall = shoot({}, 2.6);
    // Count pixels that differ from the empty scene, and find how high up the frame they reach.
    const stats = (b: Uint8Array) => {
      let n = 0, top = -1, bottom = -1;
      for (let y = 0; y < size; y++) {
        let row = 0;
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          if (Math.abs(b[i] - empty[i]) + Math.abs(b[i + 1] - empty[i + 1]) + Math.abs(b[i + 2] - empty[i + 2]) > 22) row++;
        }
        n += row;
        if (row > 2) { if (bottom < 0) bottom = y; top = y; }
      }
      return { pixels: n, top, bottom };
    };
    const result = { plain: stats(plain.bytes), severe: stats(severe.bytes), radar: stats(radar.bytes), tall: stats(tall.bytes) };
    layer.dispose(); renderer.dispose();
    return { result };
  });
  expect(errors).toEqual([]);
  expect(out.result.plain.pixels).toBeGreaterThan(400);
  // A catastrophic damage threat is drawn as a wedge, not the same funnel.
  expect(out.result.severe.pixels).toBeGreaterThan(out.result.plain.pixels * 1.5);
  // A radar-indicated warning is drawn more faintly than one with a tornado observed.
  expect(out.result.radar.pixels).toBeLessThan(out.result.plain.pixels);
  // The funnel hangs from the cloud base, so a higher base makes a taller funnel.
  expect(out.result.tall.top).toBeGreaterThan(out.result.plain.top + 60);
  expect(out.result.tall.bottom).toBeCloseTo(out.result.plain.bottom, -1);
});
