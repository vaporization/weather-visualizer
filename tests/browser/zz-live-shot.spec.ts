import { test, expect } from '@playwright/test';
const shot = 'C:/Users/saweb/AppData/Local/Temp/claude/C--Users-saweb-Documents-WeatherVisualizer/5ff0f29a-c9d5-41a3-ba60-e570b2b75e1b/scratchpad';
for (const [place, file] of [['Denver', 'live-denver-high']] as const) {
  test(`live clouds at ${place}`, async ({ page }) => {
    test.setTimeout(150000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByText('LIVE MODEL')).toBeVisible({ timeout: 30000 });
    await page.getByRole('textbox', { name: 'Search for a place' }).fill(place);
    await page.locator('.search-results button').first().click();
    await expect(page.getByRole('heading', { name: place, exact: true })).toBeVisible();
    await page.waitForTimeout(6000);
    await page.getByRole('button', { name: 'Focus selected location' }).click();
    await page.waitForTimeout(2500);
    const altitude = async () => Number((await page.locator('.view-caption').innerText()).match(/([\d,.]+) km/)?.[1].replaceAll(',', ''));
    await page.mouse.move(940, 450);
    for (let i = 0; i < 60 && (await altitude()) > 70; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(140); }
    await page.locator('input[aria-label="Camera tilt"]').fill('92');
    await page.waitForTimeout(9000);
    console.log(place, 'altitude', await altitude());
    await page.screenshot({ path: `${shot}/${file}.png` });
    expect(errors).toEqual([]);
  });
}
