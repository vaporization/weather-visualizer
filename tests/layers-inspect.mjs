import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE|shader|WebGL/.test(m.text()))errors.push(m.text());});
await page.goto('http://localhost:5173');await page.waitForTimeout(10000);
await page.screenshot({path:'artifacts/updated-clouds.png'});
for(const mode of ['wind','precipitation','temperature']){await page.getByLabel('Weather display',{exact:true}).selectOption(mode);await page.waitForTimeout(500);await page.screenshot({path:`artifacts/map-${mode}.png`});}
await page.getByLabel('Weather display',{exact:true}).selectOption('natural');
await page.getByRole('button',{name:'Focus selected location',exact:true}).click();await page.waitForTimeout(3500);
await page.mouse.move(1010,440);
for(let i=0;i<20;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(120);}
await page.waitForTimeout(40000);await page.screenshot({path:'artifacts/scroll-close.png'});
await page.locator('.data-inspector summary').click();console.log('DETAIL',await page.locator('.data-inspector').innerText());await page.locator('.data-inspector summary').click();
console.log('CLOSE',await page.locator('.view-caption').innerText());
await page.mouse.move(1010,440);for(let i=0;i<20;i++){await page.mouse.wheel(0,120);await page.waitForTimeout(120);}
await page.waitForTimeout(2000);console.log('OUT',await page.locator('.view-caption').innerText());console.log('ERRORS',errors);await browser.close();
