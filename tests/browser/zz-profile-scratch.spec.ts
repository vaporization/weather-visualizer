import { test, expect } from '@playwright/test';
test('column reconciliation never shows less cloud than either model view', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const m = await import('/src/atmosphere.ts');
    const { profileColumn, reconcileColumn, PROFILE_BINS, PROFILE_TOP_KM } = m;
    const levels = [1000, 925, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150];
    const heights = [90, 780, 1580, 2090, 3150, 4420, 5880, 7610, 9540, 10750, 12500, 14300];
    const make = (covers: number[], low: number, mid: number, high: number) => {
      const h: Record<string, any[]> = {};
      levels.forEach((l, i) => { h[`geopotential_height_${l}hPa`] = [heights[i]]; h[`cloud_cover_${l}hPa`] = [covers[i]]; });
      h.cloud_cover_low = [low]; h.cloud_cover_mid = [mid]; h.cloud_cover_high = [high];
      return h;
    };
    const at = (c: Float32Array, km: number) => c[Math.floor(km / PROFILE_TOP_KM * PROFILE_BINS)];
    const run = (covers: number[], low: number, mid: number, high: number, base = 1.2) => {
      const h = make(covers, low, mid, high);
      const raw = profileColumn(levels, h, 0);
      const rec = reconcileColumn(profileColumn(levels, h, 0), h, 0, base);
      return { raw: Array.from(raw), rec: Array.from(rec), at: (km: number) => at(rec, km) };
    };
    // New Orleans: every pressure level empty, diagnostics say fully overcast low cloud.
    const nola = run([0,0,0,0,0,0,0,0,0,0,0,0], 100, 0, 0, 1.4);
    // London: real structure at 800 hPa and aloft, diagnostics claim no high cloud at all.
    const london = run([0,4,11,78,0,0,0,0,90,69,0,0], 100, 0, 0);
    // Denver: a genuinely deep column the profile describes well.
    const denver = run([0,0,0,0,13,66,100,90,78,95,95,0], 100, 100, 100);
    return {
      nolaBelowBase: nola.at(0.8), nolaDeck: nola.at(2.2), nolaMid: nola.at(5), nolaRawEmpty: nola.raw.every(v => v === 0),
      londonHigh: london.at(9.5), londonLow: london.at(2.1),
      denverDeep: denver.at(9.5), denverMid: denver.at(5.5), denverLow: denver.at(1.5),
      denverContinuous: denver.rec.slice(Math.floor(5 / PROFILE_TOP_KM * PROFILE_BINS), Math.floor(12 / PROFILE_TOP_KM * PROFILE_BINS)).every(v => v > 0.5),
      neverLess: [nola, london, denver].every(c => c.rec.every((v, i) => v >= c.raw[i] - 1e-6)),
    };
  });
  console.log(JSON.stringify(r, null, 1));
  expect(r.nolaRawEmpty).toBe(true);
  expect(r.nolaDeck).toBeGreaterThan(0.9);          // overcast the profile could not see is restored
  expect(r.nolaBelowBase).toBe(0);                  // and it starts at the cloud base, not the ground
  expect(r.nolaMid).toBe(0);                        // without inventing cloud in an empty band
  expect(r.londonHigh).toBeGreaterThan(0.8);        // profile-only cloud survives a zero diagnostic
  expect(r.denverContinuous).toBe(true);
  expect(r.neverLess).toBe(true);
});
