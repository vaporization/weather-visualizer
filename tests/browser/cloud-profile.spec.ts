import { test, expect } from '@playwright/test';

// The model publishes cloud two ways that disagree, so the column has to carry the profile's shape
// without ever showing less than the low/mid/high diagnostics. All three fixtures below are real
// readings taken from GFS, including the case where every pressure level is empty under overcast.
test('the model column keeps profile shape and never shows less cloud than the layer diagnostics', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { profileColumn, reconcileColumn, buildProfileField, shearLean, PROFILE_BINS, PROFILE_TOP_KM } = await import('/src/atmosphere.ts');
    const levels = [1000, 925, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150];
    const heights = [90, 780, 1580, 2090, 3150, 4420, 5880, 7610, 9540, 10750, 12500, 14300];
    const hourlyFor = (covers: number[], low: number, mid: number, high: number) => {
      const h: Record<string, any[]> = { time: ['2026-09-22T12:00'] };
      levels.forEach((l, i) => { h['geopotential_height_' + l + 'hPa'] = [heights[i]]; h['cloud_cover_' + l + 'hPa'] = [covers[i]]; });
      h.cloud_cover_low = [low]; h.cloud_cover_mid = [mid]; h.cloud_cover_high = [high];
      return h;
    };
    const bin = (km: number) => Math.floor(km / PROFILE_TOP_KM * PROFILE_BINS);
    const column = (covers: number[], low: number, mid: number, high: number, base = 1.2) => {
      const h = hourlyFor(covers, low, mid, high);
      const raw = profileColumn(levels, h, 0);
      const reconciled = reconcileColumn(profileColumn(levels, h, 0), h, 0, base);
      return {
        raw: Array.from(raw), reconciled: Array.from(reconciled),
        at: (km: number) => reconciled[bin(km)],
        between: (a: number, b: number) => Array.from(reconciled.slice(bin(a), bin(b))),
      };
    };
    // Guatemala: deep convection, continuous through the altitudes the old fixed slabs could not reach.
    const deep = column([0, 34, 21, 32, 11, 78, 100, 100, 100, 100, 63, 0], 22, 100, 100);
    // New Orleans: overcast that the pressure levels do not see at all.
    const unseen = column([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 100, 0, 0, 1.4);
    // London: real cloud at 300 hPa while the high diagnostic reports none.
    const aloft = column([0, 4, 11, 78, 0, 0, 0, 0, 90, 69, 0, 0], 100, 0, 0);
    const hourly = hourlyFor([0, 34, 21, 32, 11, 78, 100, 100, 100, 100, 63, 0], 22, 100, 100);
    const grid = { gridSize: 5, widthKm: 160, levels, points: Array.from({ length: 25 }, () => ({ lat: 0, lon: 0, elevation: 0, hourly })) };
    const field = buildProfileField(grid as never, 0, 1.2);
    return {
      bins: PROFILE_BINS,
      deepAt4p5: deep.at(4.5), deepAt8: deep.at(8), deepAbove: deep.at(15),
      deepContinuous: deep.between(1.5, 12).every(v => v > .05),
      unseenRawEmpty: unseen.raw.every(v => v === 0), unseenDeck: unseen.at(2.2), unseenBelowBase: unseen.at(.8), unseenMid: unseen.at(5),
      aloftHigh: aloft.at(9.5),
      neverLess: [deep, unseen, aloft].every(c => c.reconciled.every((v, i) => v >= c.raw[i] - 1e-6)),
      fieldLength: field.length, fieldHigh: field[bin(9.5) * 25 + 12],
      emptyGrid: Array.from(buildProfileField(null, 0)).every(v => v === 0),
      shear: shearLean({ wind_speed_850hPa: [10], wind_direction_850hPa: [270], wind_speed_500hPa: [50], wind_direction_500hPa: [270] }, 0),
    };
  });
  expect(result.bins).toBe(32);
  // 4.25-4.8 km and 6.2-10 km fell between the old low/mid/high slabs and could never draw.
  expect(result.deepAt4p5).toBeGreaterThan(.7);
  expect(result.deepAt8).toBeGreaterThan(.9);
  expect(result.deepContinuous).toBe(true);
  expect(result.deepAbove).toBe(0);
  expect(result.unseenRawEmpty).toBe(true);
  expect(result.unseenDeck).toBeGreaterThan(.9);
  expect(result.unseenBelowBase).toBe(0);
  expect(result.unseenMid).toBe(0);
  expect(result.aloftHigh).toBeGreaterThan(.8);
  expect(result.neverLess).toBe(true);
  expect(result.fieldLength).toBe(25 * 32);
  expect(result.fieldHigh).toBeGreaterThan(200);
  expect(result.emptyGrid).toBe(true);
  // Wind from due west, stronger aloft: the column leans east and nowhere else.
  expect(result.shear[0]).toBeCloseTo(.4, 5);
  expect(Math.abs(result.shear[1])).toBeLessThan(1e-9);
});

test('a deep column renders as a tall body and a shallow one stays low', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { WeatherShell, globePoint, EARTH_KM } = await import('/src/weatherShell.ts');
    const { buildAtmosphere } = await import('/src/atmosphere.ts');
    const levels = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150];
    const heights = [90, 766, 1500, 3145, 4415, 5878, 7614, 9739, 11019, 12514, 14316];
    const grid = (covers: number[]) => {
      const hourly: Record<string, unknown[]> = { time: ['2026-09-22T12:00'], cloud_cover_low: [0], cloud_cover_mid: [0], cloud_cover_high: [0] };
      levels.forEach((l, i) => { hourly['geopotential_height_' + l + 'hPa'] = [heights[i]]; hourly['cloud_cover_' + l + 'hPa'] = [covers[i]]; });
      return { gridSize: 5, widthKm: 160, levels, points: Array.from({ length: 25 }, () => ({ lat: 0, lon: 0, elevation: 0, hourly })) };
    };
    const size = 160;
    const renderer = new THREE.WebGLRenderer({ antialias: false }); renderer.setSize(size, size);
    const target = new THREE.WebGLRenderTarget(size, size);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, .0001, 80), shell = new WeatherShell();
    scene.add(shell.mesh);
    // Sit at 6 km and look level across the region, so cloud height reads vertically in the frame.
    const eye = globePoint(0, -1.1, 1 + 6 / EARTH_KM);
    camera.position.copy(eye); camera.up.copy(globePoint(0, -1.1, 1)).normalize();
    camera.lookAt(globePoint(0, 0, 1 + 6 / EARTH_KM)); camera.updateMatrixWorld();
    const u = shell.material.uniforms;
    u.sun.value.set(1, .35, .2).normalize(); u.screenSize.value.set(size, size); u.steps.value = 144;
    u.satelliteEnabled.value = 0; u.rainEnabled.value = 0; u.globalAvailable.value = 0;
    const shoot = (source: unknown, clouds = 1) => {
      shell.setAtmosphere(buildAtmosphere(source as never, [], null, '2026-09-22T12:00', 0), { lat: 0, lon: 0, name: 'x', region: 'x' }, false);
      u.eye.value.copy(eye); u.cloudEnabled.value = clouds;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      const bytes = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, bytes);
      return bytes;
    };
    const deepGrid = grid([0, 90, 85, 90, 95, 100, 100, 100, 95, 70, 0]);
    const sky = shoot(deepGrid, 0);
    const measure = (bytes: Uint8Array) => {
      const rows: number[] = [];
      for (let y = 0; y < size; y++) {
        let n = 0;
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          if (Math.abs(bytes[i] - sky[i]) + Math.abs(bytes[i + 1] - sky[i + 1]) + Math.abs(bytes[i + 2] - sky[i + 2]) + Math.abs(bytes[i + 3] - sky[i + 3]) > 28) n++;
        }
        rows.push(n);
      }
      return { topRow: rows.reduce((acc, n, y) => n > size * .05 ? y : acc, -1), total: rows.reduce((a, b) => a + b, 0) };
    };
    const shallow = measure(shoot(grid([0, 90, 85, 20, 0, 0, 0, 0, 0, 0, 0])));
    const shallowAvailable = u.profileAvailable.value;
    const deep = measure(shoot(deepGrid));
    const none = measure(shoot(null));
    const noneAvailable = u.profileAvailable.value;
    target.dispose(); shell.dispose(); renderer.dispose();
    return { shallow, deep, none, shallowAvailable, noneAvailable };
  });
  expect(result.shallowAvailable).toBe(1);
  expect(result.noneAvailable).toBe(0);
  // Cloud to 12.5 km must reach well above cloud that stops at 3 km, and there must be more of it.
  expect(result.deep.topRow).toBeGreaterThan(result.shallow.topRow + 12);
  expect(result.deep.total).toBeGreaterThan(result.shallow.total * 1.5);
  expect(result.none.total).toBe(0);
  expect(errors).toEqual([]);
});
