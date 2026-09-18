import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1600,height:1000}});
await page.goto('http://localhost:5173');await page.waitForTimeout(10000);await page.screenshot({path:'artifacts/before-cloud-gaps.png'});await browser.close();
