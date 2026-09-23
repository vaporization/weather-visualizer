import { test, expect } from '@playwright/test';

// Fixtures are the shapes of real advisories: Polo at 150 kt published three wind-radii rings, the
// weaker Odalys two and markedly lopsided, and a potential cyclone only one.
test('advisory wind radii become per-quadrant storm geometry', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { stormShape, stormExtentKm, ringRadiiKm } = await import('/src/weather.ts');
    const centre = { lat: 14.6, lon: -101.4 };
    // Build a ring whose reach per quadrant is known, in NE, SE, SW, NW order.
    const ring = (quads: number[], lat = centre.lat) => {
      const scale = 111.32 * Math.cos(lat * Math.PI / 180);
      const points: number[][] = [];
      // Offset off the axes so no sample lands exactly on a quadrant boundary.
      for (let deg = 1.5; deg < 360; deg += 3) {
        const rad = deg * Math.PI / 180;
        const dx = Math.sin(rad), dy = Math.cos(rad);
        const km = quads[dy >= 0 ? (dx >= 0 ? 0 : 3) : (dx >= 0 ? 1 : 2)];
        points.push([centre.lon + dx * km / scale, lat + dy * km / 111.32]);
      }
      return points;
    };
    const storm = (kt: string, lat = centre.lat) => ({ id: 'x', name: 'x', classification: 'HU', intensity: kt, pressure: '940', latitudeNumeric: lat, longitudeNumeric: centre.lon, lastUpdate: '' });
    // Rings deliberately out of size order: the reader must sort them, not trust file order.
    const polo = stormShape(storm('150'), [ring([51, 56, 56, 51]), ring([139, 148, 148, 139]), ring([83, 93, 93, 83])]);
    const odalys = stormShape(storm('60', 15.1), [ring([203, 255, 184, 129], 15.1), ring([90, 120, 80, 60], 15.1)]);
    const potential = stormShape(storm('30', 30.8), [ring([180, 180, 180, 180], 30.8)]);
    const southern = stormShape(storm('150', -14.6), [ring([51, 56, 56, 51], -14.6), ring([139, 148, 148, 139], -14.6), ring([83, 93, 93, 83], -14.6)]);
    const none = stormShape(storm('45'), []);
    return {
      measured: ringRadiiKm(centre, ring([100, 200, 300, 400])).map(v => Math.round(v)),
      polo: polo && { eye: polo.eyeKm, wall: polo.eyewallKm, shield: Math.round(polo.shieldKm), quads: polo.quadrantsKm.map(Math.round), spin: polo.spin, shieldMeasured: polo.shieldMeasured, eyewallMeasured: polo.eyewallMeasured },
      odalys: odalys && { quads: odalys.quadrantsKm.map(Math.round), wall: odalys.eyewallKm, shieldMeasured: odalys.shieldMeasured, eyewallMeasured: odalys.eyewallMeasured },
      potential: potential && { shield: Math.round(potential.shieldKm), shieldMeasured: potential.shieldMeasured, eyewallMeasured: potential.eyewallMeasured },
      southSpin: southern?.spin,
      unmeasured: none && { shieldMeasured: none.shieldMeasured, shield: Math.round(none.shieldKm) },
      extent: Math.round(stormExtentKm(storm('150'), [ring([139, 148, 148, 139])])),
    };
  });
  expect(result.measured).toEqual([100, 200, 300, 400]);
  // Three rings: the smallest is hurricane force and sets the eyewall, the largest the cloud shield.
  expect(result.polo!.shield).toBe(148);
  expect(result.polo!.quads).toEqual([139, 148, 148, 139]);
  expect(result.polo!.wall).toBeGreaterThan(20);
  expect(result.polo!.wall).toBeLessThan(45);
  expect(result.polo!.eye).toBeGreaterThan(6);
  expect(result.polo!.eye).toBeLessThan(result.polo!.wall);
  expect(result.polo!.shieldMeasured).toBe(true);
  expect(result.polo!.eyewallMeasured).toBe(true);
  expect(result.polo!.spin).toBe(1);
  // Asymmetry survives instead of being flattened into one radius.
  expect(result.odalys!.quads).toEqual([203, 255, 184, 129]);
  // Only one ring published: the shield is real, but there is no hurricane-force radius to read an
  // eyewall from, so that part is inferred and says so.
  expect(result.potential!.shield).toBe(180);
  expect(result.potential!.shieldMeasured).toBe(true);
  expect(result.potential!.eyewallMeasured).toBe(false);
  expect(result.odalys!.eyewallMeasured).toBe(false);
  // Rotation follows the hemisphere; it used to be northern everywhere.
  expect(result.southSpin).toBe(-1);
  expect(result.unmeasured!.shieldMeasured).toBe(false);
  expect(result.unmeasured!.shield).toBeGreaterThan(100);
  expect(result.extent).toBeGreaterThan(148);
});

test('the storm body has a clear eye, turns with its hemisphere and is lopsided where the advisory is', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const out = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { WeatherShell, globePoint, EARTH_KM } = await import('/src/weatherShell.ts');
    const { buildAtmosphere } = await import('/src/atmosphere.ts');
    const size = 320;
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(size, size);
    const target = new THREE.WebGLRenderTarget(size, size);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, .001, 80), shell = new WeatherShell();
    scene.add(shell.mesh);
    const u = shell.material.uniforms;
    u.satelliteEnabled.value = 0; u.rainEnabled.value = 0; u.globalAvailable.value = 0;
    u.screenSize.value.set(size, size); u.steps.value = 144;
    const atmosphere = buildAtmosphere(null, [], null, '2026-09-22T12:00', 0);
    const shape = (quads: number[], spin: 1 | -1) => ({ eyeKm: 16, eyewallKm: 34, shieldKm: Math.max(...quads), quadrantsKm: quads, spin, intensityKt: 140, motionDeg: 0, measured: true });
    const render = (lat: number, quads: number[], spin: 1 | -1) => {
      shell.setAtmosphere(atmosphere, { lat, lon: 0, name: 'x', region: 'x' }, false);
      shell.setStorm(true, 300, shape(quads, spin) as never);
      u.sun.value.copy(globePoint(lat, 0, 1)).normalize();
      const eye = globePoint(lat, 0, 1 + 900 / EARTH_KM);
      camera.position.copy(eye);
      camera.up.copy(new THREE.Vector3(0, 1, 0).projectOnPlane(globePoint(lat, 0, 1).normalize()).normalize());
      camera.lookAt(globePoint(lat, 0, 1)); camera.updateMatrixWorld();
      u.eye.value.copy(eye);
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      const bytes = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, bytes);
      return bytes;
    };
    const brightness = (b: Uint8Array, x0: number, x1: number, y0: number, y1: number) => {
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * size + x) * 4; sum += (b[i] + b[i + 1] + b[i + 2]) / 3; n++; }
      return sum / Math.max(1, n);
    };
    const north = render(16, [200, 200, 200, 200], 1);
    const south = render(-16, [200, 200, 200, 200], -1);
    const lopsided = render(16, [260, 240, 120, 110], 1);
    const c = size / 2, box = 10;
    let mirrorDiff = 0, sameDiff = 0;
    for (let y = 45; y < size - 45; y += 2) for (let x = 45; x < size - 45; x += 2) {
      const i = (y * size + x) * 4, m = (y * size + (size - 1 - x)) * 4;
      mirrorDiff += Math.abs(north[i] - south[m]);
      sameDiff += Math.abs(north[i] - south[i]);
    }
    const result = {
      eyeCentre: brightness(north, c - box, c + box, c - box, c + box),
      wallRing: brightness(north, c + 40, c + 70, c - 15, c + 15),
      mirrorDiff, sameDiff,
      wide: brightness(lopsided, c, c + 110, c, c + 110),
      narrow: brightness(lopsided, c - 110, c, c - 110, c),
    };
    target.dispose(); shell.dispose(); renderer.dispose();
    return result;
  });
  // The eye is a hole through the cloud, not a dimmer patch of it.
  expect(out.wallRing).toBeGreaterThan(out.eyeCentre * 1.4);
  // A southern storm is the mirror of a northern one, so it matches better flipped than unflipped.
  expect(out.mirrorDiff).toBeLessThan(out.sameDiff * 0.75);
  // Wide quadrants carry more cloud than narrow ones.
  expect(out.wide).toBeGreaterThan(out.narrow * 1.15);
  expect(errors).toEqual([]);
});
