import { chromium } from '@playwright/test';
import fs from 'node:fs';
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && /THREE|shader|WebGL/.test(m.text())) errors.push(m.text()); });
// Deterministic cloud fixture; terrain and imagery remain real provider data.
await page.route('**/api/atmosphere?**', async route => {
  const response = await route.fetch(); const data = await response.json();
  if (data.points) data.points.forEach(p => { p.hourly.cloud_cover_low.fill(68); p.hourly.cloud_cover_mid.fill(10); p.hourly.cloud_cover_high.fill(12); p.hourly.dew_point_2m = p.hourly.temperature_2m.map(v => v - 8); });
  await route.fulfill({ response, json: data });
});
await page.route('**/api/observations?**', route => route.fulfill({ json: { stations: [] } }));
await page.goto('http://localhost:5173');
await page.waitForTimeout(12000);
await page.screenshot({ path: 'artifacts/orbit-refined.png' });
await page.getByRole('button', { name: 'Focus selected location' }).click();
await page.waitForTimeout(3000);await page.mouse.move(1000,440);
for(let i=0;i<20;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(120);}
await page.waitForTimeout(18000);
await page.screenshot({ path: 'artifacts/cloud-volume.png' });
await page.locator('.data-inspector summary').click();
console.log('DATA', await page.locator('.data-inspector').innerText());
console.log('ERRORS', errors);
await browser.close();
