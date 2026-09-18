import { test, expect } from '@playwright/test';

test('live globe, search, forecast, layers, and storm study', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error' && /THREE|shader|WebGL/i.test(msg.text())) errors.push(msg.text()); });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByText('LIVE MODEL')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'New York' })).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop.png' });
  await page.getByRole('switch', { name: 'Wind Global flow' }).click();
  await expect(page.getByRole('switch', { name: 'Wind Global flow' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '+6h', exact: true }).click();
  await expect(page.locator('.hour-badge')).toHaveText('+6H');
  await page.getByRole('button', { name: 'Toggle temperature units' }).click();
  await expect(page.getByRole('button', { name: 'Toggle temperature units' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('textbox', { name: 'Search for a place' }).fill('London');
  await page.locator('.search-results button').first().click();
  await expect(page.getByRole('heading', { name: 'London', exact: true })).toBeVisible();
  await expect(page.getByText('LIVE MODEL', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.locator('canvas').evaluate(el => el.setAttribute('data-continuity-check', 'same-earth'));
  await page.getByRole('button', { name: 'Focus selected location' }).click();
  await expect(page.locator('canvas')).toHaveAttribute('data-continuity-check', 'same-earth');
  await page.getByRole('button', { name: 'Reset globe view' }).click();
  await page.waitForTimeout(4000);
  await page.locator('canvas').press('Enter');
  await expect(page.getByRole('heading', { name: 'Selected location' })).toBeVisible();
  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 25, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('heading', { name: 'Selected location' })).toBeVisible();
  await page.getByRole('button', { name: /^Tropical systems/ }).click();
  await page.getByRole('button', { name: /Explore a hurricane study/ }).click();
  await expect(page.getByText('DEMO MODE')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hurricane study' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Forecast hour' })).toBeDisabled();
  await page.getByRole('button', { name: 'Focus selected location' }).click();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: 'test-results/hurricane.png' });
  await page.getByRole('button', { name: 'About this experience' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(errors).toEqual([]);
});

test('phone layout and graceful provider failure', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/weather?**', route => route.fulfill({ status: 502, json: { error: 'Weather provider is unavailable. Please retry.' } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByText('WEATHER UNAVAILABLE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle layers panel' }).click();
  await expect(page.getByRole('switch', { name: 'Clouds 3D cloud cover' })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle layers panel' }).click();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('terrain decoding and atmosphere forecast timestamps preserve physical meaning', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const terrainPath = '/src/terrain.ts', weatherPath = '/src/atmosphere.ts';
    const { decodeHeight, mercatorTile } = await import(terrainPath);
    const { hourlyIndex, buildAtmosphere } = await import(weatherPath);
    const station = { id: 'TEST', distanceKm: 2, clouds: [{ cover: 'BKN', baseMetersAGL: 762 }], visibilityKm: 16, visibilityAtLeast: true };
    const current = buildAtmosphere(null, [station], null, '2026-09-15T12:45', 0);
    const forecast = buildAtmosphere(null, [station], null, '2026-09-15T12:45', 3);
    return { zero: decodeHeight(128, 0, 0), mountain: decodeHeight(143, 160, 0), tile: mercatorTile(0, 0, 2), index: hourlyIndex(['2026-09-15T15:00', '2026-09-15T16:00'], '2026-09-15T12:45', 3), base: current.baseKm, visibility: current.visibilityKm, futureStation: forecast.station };
  });
  expect(result.zero).toBe(0);
  expect(result.mountain).toBe(4);
  expect(result.tile).toEqual({ x: 2, y: 2 });
  expect(result.index).toBe(1);
  expect(result.base).toBe(.762);
  expect(result.visibility).toBe(40);
  expect(result.futureStation).toBeNull();
});

test('wheel zoom reaches terrain and returns to orbit; weather maps and units persist', async ({ page }) => {
  const errors: string[]=[];page.on('pageerror', e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.locator('canvas').evaluate(el=>el.setAttribute('data-continuity-check','one-globe'));
  await page.mouse.move(940,450);
  for(let i=0;i<20;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(100);}
  const altitude=async()=>Number((await page.locator('.view-caption').innerText()).match(/([\d,.]+) km/)?.[1].replaceAll(',',''));
  await expect.poll(altitude,{timeout:10000}).toBeLessThan(5);
  await expect(page.locator('canvas')).toHaveAttribute('data-continuity-check','one-globe');
  for(let i=0;i<20;i++){await page.mouse.wheel(0,120);await page.waitForTimeout(100);}
  await expect.poll(altitude,{timeout:10000}).toBeGreaterThan(10000);
  await page.getByLabel('Weather display',{exact:true}).selectOption('wind');
  await expect(page.getByLabel('Map legend')).toContainText('100+ km/h');
  await expect(page.getByLabel('Map legend')).toContainText('GFS',{timeout:30000});
  await page.getByLabel('Weather display',{exact:true}).selectOption('precipitation');
  await expect(page.getByLabel('Map legend')).toContainText('mm/h');
  await page.getByLabel('Weather display',{exact:true}).selectOption('temperature');
  await page.getByRole('button',{name:'Toggle temperature units'}).click();
  await expect(page.getByLabel('Map legend')).toContainText('°F');
  await page.reload();
  await expect(page.getByRole('button',{name:'Toggle temperature units'})).toHaveAttribute('aria-pressed','true');
  expect(errors).toEqual([]);
});


test('terrain detail surrounds a tilted camera and uses a bounded non-overlapping hierarchy', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const terrainPath='/src/terrain.ts', threePath='/node_modules/three/build/three.module.js';
    const {visibleTerrainTiles,mercatorTile}=await import(terrainPath);
    const THREE=await import(threePath);
    const camera=new THREE.PerspectiveCamera(42,1.6,.000001,80);
    camera.position.set(1+10/6371,0,0);camera.up.set(0,1,0);camera.lookAt(0,0,0);camera.rotateX(1.1);camera.updateMatrixWorld();
    const tiles=visibleTerrainTiles(camera,1000);
    const covers=(lat:number,lon:number)=>tiles.some(([z,x,y]:number[])=>{const t=mercatorTile(lat,lon,z);return Math.floor(t.x)===x && Math.floor(t.y)===y;});
    const neighborhood=[[-.07,0],[.07,0],[0,-.07],[0,.07],[0,0]].every(([lat,lon])=>covers(lat,lon));
    // The camera looks one way; terrain must already exist behind and beside it, out toward the horizon.
    const surrounding=[[-1.5,0],[1.5,0],[0,-1.5],[0,1.5],[1.1,1.1],[-1.1,-1.1]].every(([lat,lon])=>covers(lat,lon));
    const overlap=tiles.some(([z,x,y]:number[],i:number)=>tiles.some(([pz,px,py]:number[],j:number)=>i!==j && pz<z && Math.floor(x/2**(z-pz))===px && Math.floor(y/2**(z-pz))===py));
    // Feeding a set back in must reproduce it. Low and near the horizon, a drift of a few percent of
    // altitude reorders the budget cut-off; the previous set must hold rather than churn coarser.
    const stable=JSON.stringify(visibleTerrainTiles(camera,1000,128,tiles))===JSON.stringify(tiles);
    const low=new THREE.PerspectiveCamera(42,1.6,.000001,80);
    low.position.set(1+4/6371,0,0);low.up.set(0,1,0);low.lookAt(0,0,0);low.rotateX(1.3);low.updateMatrixWorld();
    const before=visibleTerrainTiles(low,1000,128);
    low.position.applyAxisAngle(new THREE.Vector3(0,1,0),.03*4/6371);low.updateMatrixWorld();
    const drifted=visibleTerrainTiles(low,1000,128,before);
    const coarsened=before.some(([z,x,y]:number[])=>drifted.some(([nz,nx,ny]:number[])=>nz<z && Math.floor(x/2**(z-nz))===nx && Math.floor(y/2**(z-nz))===ny));
    const held=JSON.stringify(drifted)===JSON.stringify(before);
    return {count:tiles.length,neighborhood,surrounding,overlap,stable,coarsened,held};
  });
  expect(result.count).toBeGreaterThan(4);expect(result.count).toBeLessThanOrEqual(128);
  expect(result.neighborhood).toBe(true);expect(result.surrounding).toBe(true);expect(result.overlap).toBe(false);
  expect(result.stable).toBe(true);expect(result.coarsened).toBe(false);expect(result.held).toBe(true);
  await page.getByRole('slider',{name:'Camera tilt'}).fill('80');
  await expect(page.getByRole('slider',{name:'Camera tilt'})).toHaveValue('80');
  await page.getByRole('button',{name:'Reset globe view'}).click();
  await expect(page.getByRole('slider',{name:'Camera tilt'})).toHaveValue('0');
});


test('automatic tilt eases between 1.5 and 0.5 km and respects the lock', async ({page}) => {
  await page.goto('/');
  const angles=await page.evaluate(async()=>{const path='/src/camera.ts';const {cameraTiltPercent}=await import(path);return [cameraTiltPercent(2,0,false),cameraTiltPercent(1.5,0,false),cameraTiltPercent(1,0,false),cameraTiltPercent(.5,0,false),cameraTiltPercent(.1,0,false),cameraTiltPercent(.1,32,true)];});
  expect(angles).toEqual([0,0,50,100,100,32]);
  await page.mouse.move(940,450);
  for(let i=0;i<24;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(100);}
  await expect(page.getByRole('slider',{name:'Camera tilt'})).toHaveValue('100',{timeout:15000});
  await page.getByRole('slider',{name:'Camera tilt'}).fill('32');
  await expect(page.getByRole('checkbox',{name:'Lock camera tilt'})).toBeChecked();
  await page.mouse.move(940,450);await page.mouse.wheel(0,120);await page.waitForTimeout(1600);
  await expect(page.getByRole('slider',{name:'Camera tilt'})).toHaveValue('32');
  await page.getByRole('checkbox',{name:'Lock camera tilt'}).click();
  await expect(page.getByRole('slider',{name:'Camera tilt'})).toHaveValue('100',{timeout:10000});
});

test('middle drag looks around without selecting a location or changing altitude',async({page})=>{
 await page.goto('/');await expect(page.locator('canvas')).toBeVisible();await page.waitForTimeout(1500);
 const caption=await page.locator('.view-caption').innerText();
 await page.mouse.move(1030,510);await page.mouse.down({button:'middle'});await page.mouse.move(1170,650,{steps:12});await page.mouse.up({button:'middle'});
 await expect(page.getByRole('checkbox',{name:'Lock camera tilt'})).toBeChecked();
 await expect.poll(async()=>Number(await page.getByRole('slider',{name:'Camera tilt'}).inputValue())).toBeGreaterThan(20);
 await expect.poll(async()=>{const v=await page.getByRole('slider',{name:'Camera tilt'}).inputValue();return await page.locator('output[for="camera-tilt"]').innerText()===`${v}%`;}).toBe(true);
 await expect(page.getByRole('heading',{name:'New York',exact:true})).toBeVisible();
 await expect(page.locator('.view-caption')).toHaveText(caption);
 await page.getByRole('button',{name:'Reset globe view'}).click();
 await expect(page.getByRole('checkbox',{name:'Lock camera tilt'})).not.toBeChecked();
 await expect(page.getByRole('slider',{name:'Camera tilt'})).toHaveValue('0');
});

test('panels move, minimize, restore and remain reachable after resizing',async({page})=>{
 await page.goto('/');
 const panel=page.getByRole('region',{name:'Weather map display'}),grip=page.getByRole('button',{name:'Move Weather display panel'});
 const before=(await panel.boundingBox())!,handle=(await grip.boundingBox())!;
 await page.mouse.move(handle.x+30,handle.y+10);await page.mouse.down();await page.mouse.move(handle.x+150,handle.y+110,{steps:8});await page.mouse.up();
 const after=(await panel.boundingBox())!;expect(after.x-before.x).toBeCloseTo(120,0);expect(after.y-before.y).toBeCloseTo(100,0);
 await page.getByRole('button',{name:'Minimize Weather display panel'}).click();
 await expect(page.getByRole('combobox',{name:'Weather display',exact:true})).toBeHidden();
 await page.getByRole('button',{name:'Restore Weather display panel'}).click();
 await expect(page.getByRole('slider',{name:'Camera tilt'})).toBeVisible();
 await page.locator('.panel-menu summary').click();await page.getByRole('button',{name:'Minimize all',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Restore .* panel$/})).toHaveCount(8);
 await page.screenshot({path:'artifacts/panels-minimized.png'});
 await page.getByRole('button',{name:'Restore all',exact:true}).click();
 await page.setViewportSize({width:600,height:800});
 const small=(await panel.boundingBox())!;expect(small.x).toBeGreaterThanOrEqual(0);expect(small.x+small.width).toBeLessThanOrEqual(600);expect(small.y).toBeLessThan(770);
 await page.getByRole('button',{name:'Reset layout',exact:true}).click();
 await expect(panel).not.toHaveAttribute('style',/fixed/);
 await page.setViewportSize({width:1440,height:1000});await page.locator('.panel-menu summary').click();
 await page.screenshot({path:'artifacts/panels-default.png'});
});


test('global wind trails carry local speed along their paths and update with the forecast',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|THREE|WebGL/.test(m.text()))errors.push(m.text());});
 const time=Array.from({length:27},(_,i)=>new Date(Date.UTC(2026,8,15,0)+i*3600000).toISOString().slice(0,16));
 const field={width:24,height:12,spacingDegrees:15,fetchedAt:'2026-09-15T00:00:00Z',source:'Test fixture',points:Array.from({length:288},(_,i)=>({time,cloud_cover:time.map(()=>0),precipitation:time.map(()=>0),temperature_2m:time.map(()=>20),wind_direction_10m:time.map(()=>270),wind_speed_10m:time.map((_,h)=>h===0?(i%24)*6:100)}))};
 await page.route('**/api/global-weather',route=>route.fulfill({json:field}));
 await page.goto('/');
 const result=await page.evaluate(async(field)=>{
  const path='/src/weatherParticles.ts';const {WeatherParticles}=await import(path);const p=new WeatherParticles();
  p.setWindData(field,'2026-09-15T00:00',0);
  const speeds=Array.from(p.wind.geometry.getAttribute('windSpeed').array) as number[];
  let changes=false;for(let i=0;i<speeds.length;i+=2)if(Math.abs(speeds[i]-speeds[i+1])>.01){changes=true;break;}
  p.setWindData(field,'2026-09-15T00:00',3);const forecast=Array.from(p.wind.geometry.getAttribute('windSpeed').array) as number[];
  const result={min:Math.min(...speeds.slice(0,50000)),max:Math.max(...speeds.slice(0,50000)),changes,forecast:forecast.every(v=>Math.abs(v-100)<.001),count:speeds.length};p.dispose();return result;
 },field);
 expect(result.min).toBeLessThan(5);expect(result.max).toBeGreaterThan(130);expect(result.changes).toBe(true);expect(result.forecast).toBe(true);expect(result.count).toBe(144000);
 await page.getByRole('switch',{name:'Wind Global flow'}).click();await page.waitForTimeout(2500);
 await page.screenshot({path:'artifacts/wind-speed-colors.png'});expect(errors).toEqual([]);
});

test('street overlays load only after selection and support independent controls',async({page})=>{
 let requests=0;const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const data={center:{lat:40.7128,lon:-74.006},radiusKm:3,segments:[[[40.71,-74.02],[40.72,-73.99]],[[40.705,-74.005],[40.725,-74.005]]],places:[{id:'node/1',name:'Test museum',lat:40.713,lon:-74.001,kind:'landmark',category:'museum'},{id:'node/2',name:'Test school',lat:40.705,lon:-74.013,kind:'marker',category:'school'}],truncated:false,source:'Test',fetchedAt:new Date().toISOString()};
 await page.route('**/api/roads?**',r=>{requests++;return r.fulfill({json:data});});
 await page.goto('/');await page.locator('.street-controls summary').filter({hasText:'Roads & places'}).click();
 await expect(page.getByRole('checkbox',{name:'Road lines',exact:true})).toBeDisabled();expect(requests).toBe(0);
 await page.getByRole('textbox',{name:'Search for a place'}).focus();await page.locator('.search-results button').filter({hasText:'New York'}).click();
 await expect(page.getByRole('checkbox',{name:'Road lines',exact:true})).toBeEnabled();expect(requests).toBe(0);
 await page.getByRole('checkbox',{name:'Road lines',exact:true}).check();await expect.poll(()=>requests).toBe(1);
 await page.getByLabel('Road color',{exact:true}).fill('#ff44aa');
 await expect(page.getByLabel('Road color',{exact:true})).toHaveValue('#ff44aa');
 await page.getByRole('checkbox',{name:'Place markers',exact:true}).check();await page.getByRole('checkbox',{name:'Landmarks',exact:true}).check();
 await page.getByRole('button',{name:'View streets',exact:false}).click();
 await expect(page.locator('.street-place.marker')).toBeVisible({timeout:15000});await expect(page.locator('.street-place.landmark')).toBeVisible();
 await page.getByRole('checkbox',{name:'Landmarks',exact:true}).uncheck();await expect(page.locator('.street-place.landmark')).toBeHidden();await expect(page.locator('.street-place.marker')).toBeVisible();
 expect(requests).toBe(1);await page.screenshot({path:'artifacts/street-overlay-controls.png'});expect(errors).toEqual([]);
});


test('global forecast clouds change on GPU and ignore the selected regional cloud patch',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const tp='/node_modules/.vite/deps/three.js',sp='/src/weatherShell.ts',mp='/src/weatherMap.ts',ap='/src/atmosphere.ts';
  const THREE=await import(tp),{WeatherShell}=await import(sp),{cloudTexture,globalTexture}=await import(mp),{buildAtmosphere}=await import(ap);
  const time=['2026-09-15T12:00','2026-09-15T13:00'];
  const data={width:4,height:2,points:Array.from({length:8},()=>({time,cloud_cover:[0,100],cloud_cover_low:[0,95],cloud_cover_mid:[0,60],cloud_cover_high:[0,30],precipitation:[0,0],wind_speed_10m:[0,0],temperature_2m:[20,20]}))};
  const renderer=new THREE.WebGLRenderer();renderer.setSize(128,128);const target=new THREE.WebGLRenderTarget(128,128);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.001,80),shell=new WeatherShell();
  camera.position.set(0,0,3);camera.lookAt(0,0,0);scene.add(shell.mesh);
  shell.material.uniforms.eye.value.copy(camera.position);shell.material.uniforms.sun.value.set(0,0,1);shell.material.uniforms.satelliteEnabled.value=0;shell.material.uniforms.rainEnabled.value=0;shell.material.uniforms.screenSize.value.set(128,128);
  function pixels(hour:number){shell.setGlobal(globalTexture(data,time[0],hour));shell.setCloudForecast(cloudTexture(data,time[0],hour));renderer.setRenderTarget(target);renderer.render(scene,camera);const bytes=new Uint8Array(128*128*4);renderer.readRenderTargetPixels(target,0,0,128,128,bytes);return bytes;}
  const now=pixels(0),future=pixels(1);
  const a=buildAtmosphere(null,[],null,undefined,0);shell.setAtmosphere({...a,baseKm:8,thicknessKm:5,field:new Uint8Array(100).fill(255),source:'Test'}, {lat:10,lon:20},false);
  const selected=pixels(1);let difference=0,selectionDifference=0;future.forEach((v:number,i:number)=>{difference+=Math.abs(v-now[i]);selectionDifference+=Math.abs(v-selected[i]);});
  const layers=Array.from(cloudTexture(data,time[0],1).image.data).slice(0,4);
  target.dispose();shell.dispose();renderer.dispose();return{difference,selectionDifference,layers};
 });
 expect(result.difference).toBeGreaterThan(10000);expect(result.selectionDifference).toBe(0);expect(result.layers).toEqual([242,153,77,255]);
});


test('panel background opacity applies globally and survives reload',async({page})=>{
 await page.goto('/');await page.locator('.panel-menu summary').click();
 const slider=page.getByRole('slider',{name:'Panel opacity'});await slider.fill('25');
 const values=await page.locator('.managed-panel').evaluateAll(nodes=>nodes.map(n=>({background:getComputedStyle(n).backgroundImage,opacity:getComputedStyle(n).opacity})));
 expect(values).toHaveLength(8);expect(values.every(v=>v.opacity==='0.25')).toBe(true);
 await page.reload();await page.locator('.panel-menu summary').click();await expect(slider).toHaveValue('25');await slider.fill('0');await expect(page.getByRole('button',{name:'Restore all',exact:true})).toBeVisible();
 await slider.fill('100');expect(await page.locator('.managed-panel').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).borderTopColor==='rgb(72, 96, 107)'&&getComputedStyle(n).opacity==='1'))).toBe(true);await slider.fill('70');await page.screenshot({path:'artifacts/panel-opacity.png'});
});


test('click focus aims at the selection without flying overhead and frames low-altitude selections',async({page})=>{
 await page.goto('/');await page.waitForTimeout(1500);
 await page.locator('.panel-menu summary').click();await page.getByRole('button',{name:'Minimize all',exact:true}).click();await page.locator('.panel-menu summary').click();
 const canvas=page.locator('canvas'),box=(await canvas.boundingBox())!;
 const altitude=await page.locator('.view-caption').textContent();
 await page.mouse.click(box.x+box.width*.59,box.y+box.height*.48);await page.waitForTimeout(2200);
 const coordinates=await page.locator('.coord-line').textContent();
 await expect(page.locator('.view-caption')).toHaveText(altitude!);
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.waitForTimeout(2600);
 await expect(page.locator('.view-caption')).not.toHaveText(altitude!);
 await canvas.press('Enter');await page.waitForTimeout(100);await expect(page.locator('.coord-line')).toHaveText(coordinates!);
 await page.locator('.panel-menu summary').click();await page.getByRole('button',{name:'Restore all',exact:true}).click();await page.locator('.panel-menu summary').click();
 await page.locator('.street-controls summary').filter({hasText:'Roads & places'}).click();await page.getByRole('button',{name:'View streets',exact:false}).click();await page.waitForTimeout(5500);
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.waitForTimeout(1800);
 await page.locator('.panel-menu summary').click();await page.getByRole('button',{name:'Minimize all',exact:true}).click();await page.locator('.panel-menu summary').click();
 await page.mouse.click(box.x+box.width*.58,box.y+box.height*.49);await page.waitForTimeout(4200);
 const near=await page.locator('.coord-line').textContent();await canvas.press('Enter');await page.waitForTimeout(100);await expect(page.locator('.coord-line')).toHaveText(near!);
 await page.screenshot({path:'artifacts/click-offset-focus.png'});
});


test('left-button hold preserves the view after selection and middle look',async({page})=>{
 await page.goto('/');await page.waitForTimeout(2000);
 await page.locator('.panel-menu summary').click();await page.getByRole('button',{name:'Minimize all',exact:true}).click();await page.locator('.panel-menu summary').click();
 const canvas=page.locator('canvas'),b=(await canvas.boundingBox())!,x=b.x+b.width*.57,y=b.y+b.height*.47;
 await page.mouse.click(x,y);await page.waitForTimeout(2500);
 const position=()=>page.locator('[data-pin="-1"]').getAttribute('style');
 const before=await position();await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(400);expect(await position()).toBe(before);await page.mouse.up();await page.waitForTimeout(2000);
 await page.mouse.move(x,y);await page.mouse.down({button:'middle'});await page.mouse.move(x+55,y+50,{steps:10});await page.mouse.up({button:'middle'});await page.waitForTimeout(700);
 const looked=await position();await page.mouse.down();await page.waitForTimeout(400);const after=await position();const coords=(v:string|null)=>(v?.match(/translate\(([-.\d]+)px, ([-.\d]+)px/)??[]).slice(1).map(Number);const a=coords(after),z=coords(looked);expect(Math.hypot(a[0]-z[0],a[1]-z[1])).toBeLessThan(1);
 await page.mouse.move(x+105,y+50,{steps:10});await page.mouse.up();await page.waitForTimeout(300);
 expect(await position()).not.toBe(looked);
 await page.screenshot({path:'artifacts/clouds-navigation-fixed.png'});
});


test('civilian flight layer is opt-in, renders colored trails and clears when disabled',async({page})=>{
 let calls=0;const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|THREE/.test(m.text()))errors.push(m.text());});
 const f={id:'test',callsign:'TEST123',type:'A320',category:'airliner',lat:35,lon:-65,altitudeKm:10,speedKms:.2,heading:90,observedAt:Date.now()};
 await page.route('**/api/flights',r=>{calls++;return r.fulfill({json:{timestamp:Date.now(),source:'Fixture',flights:[{...f,observedAt:Date.now()}]}});});
 await page.goto('/');expect(calls).toBe(0);await page.getByRole('checkbox',{name:'Live civilian aircraft'}).check();await expect.poll(()=>calls).toBe(1);await expect(page.getByRole('region',{name:'Flight traffic'})).toContainText('1 aircraft');
 const result=await page.evaluate(async(f)=>{const path='/src/flights.ts';const {FlightLayer,flightPosition}=await import(path);const layer=new FlightLayer();layer.setData({timestamp:f.observedAt,source:'Fixture',flights:[f]});layer.update(f.observedAt+5000);const geometry=layer.group.children[1].geometry;const op=Array.from(geometry.attributes.opacity.array);const count=geometry.attributes.position.count;const moved=flightPosition(f,f.observedAt+5000).distanceTo(flightPosition(f,f.observedAt));layer.update(f.observedAt+31000);const expired=layer.group.children[0].geometry.attributes.position.count;layer.dispose();return{op,count,moved,expired};},f);
 expect(result.op[0]).toBe(0);expect(result.op.at(-1)).toBeCloseTo(.8);expect(result.count).toBe(20);expect(result.moved).toBeGreaterThan(0);expect(result.expired).toBe(0);
 await page.screenshot({path:'artifacts/flight-layer.png'});await page.getByRole('checkbox',{name:'Live civilian aircraft'}).uncheck();await expect(page.getByRole('region',{name:'Flight traffic'})).toContainText('Enable to load');expect(errors).toEqual([]);
});

test('standard gamepad axes move the globe only when enabled',async({page})=>{
 await page.addInitScript(()=>{(window as any).testAxes=[0,0,0,0];Object.defineProperty(navigator,'getGamepads',{value:()=>[{connected:true,mapping:'standard',axes:(window as any).testAxes,buttons:Array.from({length:17},()=>({pressed:false,value:0}))}]});});
 await page.goto('/');await page.getByLabel('Enable gamepad').check();await page.getByLabel('Enable gamepad').focus();await page.locator('canvas').focus();
 await expect(page.getByRole('region',{name:'View controls'})).toContainText('Controller connected');
 const before=await page.locator('[data-pin="-1"]').getAttribute('style');await page.evaluate(()=>{(window as any).testAxes=[.5,0,0,0];});await page.waitForTimeout(500);await page.evaluate(()=>{(window as any).testAxes=[0,0,0,0];});expect(await page.locator('[data-pin="-1"]').getAttribute('style')).not.toBe(before);
 await page.getByLabel('Enable gamepad').uncheck();await page.locator('canvas').focus();const disabled=await page.locator('[data-pin="-1"]').getAttribute('style');await page.evaluate(()=>{(window as any).testAxes=[.5,0,0,0];});await page.waitForTimeout(300);expect(await page.locator('[data-pin="-1"]').getAttribute('style')).toBe(disabled);
});


test('north-up lock aligns geographic north while preserving the viewing direction',async({page})=>{
 await page.goto('/');await page.getByRole('checkbox',{name:'North-up compass lock'}).check();
 const result=await page.evaluate(async()=>{const tp='/node_modules/.vite/deps/three.js',cp='/src/camera.ts';const T=await import(tp),{applyNorthUp}=await import(cp);const c=new T.PerspectiveCamera();c.position.set(2,1,3);c.lookAt(0,0,0);c.rotateZ(1.2);c.rotateX(.2);const before=c.getWorldDirection(new T.Vector3());applyNorthUp(c);const n=c.position.clone().normalize(),north=new T.Vector3(0,1,0).addScaledVector(n,-n.y);north.applyQuaternion(c.quaternion.clone().invert());const directionError=before.distanceTo(c.getWorldDirection(new T.Vector3()));c.position.set(0,2,0);c.lookAt(0,0,0);applyNorthUp(c);return{x:north.x,y:north.y,directionError,pole:c.quaternion.toArray().every(Number.isFinite)};});
 expect(Math.abs(result.x)).toBeLessThan(1e-6);expect(result.y).toBeGreaterThan(0);expect(result.directionError).toBeLessThan(1e-6);expect(result.pole).toBe(true);
});


test('keyboard arrows navigate without canvas focus and do not intercept search editing',async({page})=>{
 await page.goto('/');await page.waitForTimeout(1000);
 await page.locator('.panel-menu summary').click();await page.locator('.panel-menu summary').click();
 const pin=page.locator('[data-pin="-1"]'),before=await pin.getAttribute('style');
 await page.keyboard.down('ArrowRight');await page.waitForTimeout(400);await page.keyboard.up('ArrowRight');expect(await pin.getAttribute('style')).not.toBe(before);
 const search=page.getByRole('textbox',{name:'Search for a place'});await search.fill('London');await page.waitForTimeout(600);const stationary=await pin.getAttribute('style');await page.keyboard.down('ArrowLeft');await page.waitForTimeout(300);await page.keyboard.up('ArrowLeft');expect(await pin.getAttribute('style')).toBe(stationary);
});

test('gamepad works while its enable checkbox is focused and small right-stick inputs tilt',async({page})=>{
 await page.addInitScript(()=>{(window as any).testAxes=[0,0,0,0];Object.defineProperty(navigator,'getGamepads',{value:()=>[{connected:true,mapping:'standard',axes:(window as any).testAxes,buttons:Array.from({length:17},()=>({pressed:false,value:0}))}]});});
 await page.goto('/');await page.getByLabel('Enable gamepad').check();await page.getByLabel('Enable gamepad').focus();await expect(page.getByLabel('Enable gamepad')).toBeFocused();
 const pin=page.locator('[data-pin="-1"]'),before=await pin.getAttribute('style');await page.evaluate(()=>{(window as any).testAxes=[.5,0,0,0];});await page.waitForTimeout(500);await page.evaluate(()=>{(window as any).testAxes=[0,0,0,.35];});expect(await pin.getAttribute('style')).not.toBe(before);
 await page.waitForTimeout(1200);await page.evaluate(()=>{(window as any).testAxes=[0,0,0,0];});expect(Number(await page.getByRole('slider',{name:'Camera tilt'}).inputValue())).toBeGreaterThan(5);
 const search=page.getByRole('textbox',{name:'Search for a place'});await search.focus();await page.waitForTimeout(400);const paused=await pin.getAttribute('style');await page.evaluate(()=>{(window as any).testAxes=[.5,0,0,0];});await page.waitForTimeout(300);const drift=await pin.evaluate(el=>{const m=new DOMMatrix(getComputedStyle(el).transform);return [m.m41,m.m42];});const prior=(paused?.match(/translate\(([-.\d]+)px, ([-.\d]+)px/)??[]).slice(1).map(Number);expect(Math.hypot(drift[0]-prior[0],drift[1]-prior[1])).toBeLessThan(1);
});


test('quick arrow taps and search-to-globe focus handoff navigate',async({page})=>{
 await page.goto('/');await page.waitForTimeout(1000);
 const canvas=page.locator('canvas'),pin=page.locator('[data-pin="-1"]');
 await page.locator('.panel-menu summary').click();await page.getByRole('button',{name:'Minimize all',exact:true}).click();await page.locator('.panel-menu summary').click();
 await page.getByRole('textbox',{name:'Search for a place'}).focus();
 const b=(await canvas.boundingBox())!;await page.mouse.click(b.x+b.width*.5,b.y+b.height*.55);
 await expect(canvas).toBeFocused();await page.waitForTimeout(2200);
 const before=await pin.getAttribute('style');await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);
 expect(await pin.getAttribute('style')).not.toBe(before);
});

test('north indicator follows rendered orientation and selection drag preserves roll',async({page})=>{
 await page.goto('/');await page.waitForTimeout(1000);
 const result=await page.evaluate(async()=>{const tp='/node_modules/.vite/deps/three.js',cp='/src/camera.ts';const T=await import(tp),{northScreenAngle}=await import(cp);const c=new T.PerspectiveCamera();c.position.set(0,0,3);c.lookAt(0,0,0);const a=northScreenAngle(c);c.rotateZ(Math.PI/2);return[a,northScreenAngle(c)];});
 expect(result[0]).toBeCloseTo(0);expect(result[1]).toBeCloseTo(90);
 await page.locator('.panel-menu summary').click();await page.getByRole('button',{name:'Minimize all',exact:true}).click();await page.locator('.panel-menu summary').click();
 const b=(await page.locator('canvas').boundingBox())!,x=b.x+b.width*.6,y=b.y+b.height*.48;
 await page.mouse.click(x,y);await page.waitForTimeout(2500);
 const tiltBefore=Number(await page.locator('#camera-tilt').inputValue());
 const angle=()=>page.locator('.compass svg').getAttribute('style');const before=await angle();
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+5,y,{steps:1});await page.waitForTimeout(250);await page.mouse.up();
 const after=await angle();const degrees=(s:string|null)=>Number(s?.match(/rotate\(([-.\d]+)deg/ )?.[1]);
 expect(Math.abs(degrees(after)-degrees(before))).toBeLessThan(4);
 expect(Math.abs(Number(await page.locator('#camera-tilt').inputValue())-tiltBefore)).toBeLessThan(3);
 await page.locator('.compass').click();await expect(page.locator('.compass')).toHaveAttribute('aria-pressed','true');
});


test('horizon clouds remain visible across the former 18 km cutoff',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const tp='/node_modules/.vite/deps/three.js',wp='/src/weatherShell.ts',mp='/src/weatherMap.ts';const T=await import(tp),{WeatherShell}=await import(wp),{cloudTexture}=await import(mp);
  const renderer=new T.WebGLRenderer(),target=new T.WebGLRenderTarget(96,96),scene=new T.Scene(),camera=new T.PerspectiveCamera(42,1,.000001,80),shell=new WeatherShell();scene.add(shell.mesh);renderer.setSize(96,96);
  const time=['2026-09-16T12:00'],data={width:24,height:12,spacingDegrees:15,points:Array.from({length:288},()=>({time,cloud_cover:[100],cloud_cover_low:[100],cloud_cover_mid:[100],cloud_cover_high:[60]}))};shell.setCloudForecast(cloudTexture(data,time[0],0));
  const u=shell.material.uniforms;u.sun.value.set(0,0,1);u.satelliteEnabled.value=0;u.rainEnabled.value=0;u.screenSize.value.set(96,96);u.depthEnabled.value=0;u.globalAvailable.value=1;
  const samples=[];
  for(const altitude of [22,18.1,17.9,15]){
   camera.position.set(0,0,1+altitude/6371);camera.lookAt(0,0,0);camera.rotateX(1.4);camera.updateMatrixWorld();u.eye.value.copy(camera.position);
   const pixels=[];
   for(const clouds of [0,1]){u.cloudEnabled.value=clouds;renderer.setRenderTarget(target);renderer.render(scene,camera);const bytes=new Uint8Array(96*96*4);renderer.readRenderTargetPixels(target,0,0,96,96,bytes);pixels.push(bytes);}
   let difference=0;for(let i=0;i<pixels[0].length;i++)difference+=Math.abs(pixels[1][i]-pixels[0][i]);samples.push(difference);
  }
  shell.dispose();target.dispose();renderer.dispose();return samples;
 });
 expect(result.every(x=>x>10000),JSON.stringify(result)).toBe(true);expect(result[2]/result[1]).toBeGreaterThan(.7);expect(result[2]/result[1]).toBeLessThan(1.3);expect(result[3]/result[0]).toBeGreaterThan(.4);
});


test('right stick looks in screen directions without rolling or moving the camera',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const tp='/node_modules/.vite/deps/three.js',cp='/src/camera.ts';const T=await import(tp),{lookWithStick}=await import(cp);
  const c=new T.PerspectiveCamera();c.position.set(0,0,3.8);c.lookAt(0,0,0);const initial=c.quaternion.clone(),position=c.position.clone();
  for(let i=0;i<10;i++)lookWithStick(c,.5,0,1/60);
  const right=c.getWorldDirection(new T.Vector3()).applyQuaternion(initial.clone().invert());const screenUp=new T.Vector3(0,1,0).applyQuaternion(c.quaternion).applyQuaternion(initial.clone().invert());
  c.quaternion.copy(initial);for(let i=0;i<10;i++)lookWithStick(c,0,.5,1/60);
  const down=c.getWorldDirection(new T.Vector3()).applyQuaternion(initial.clone().invert());
  for(let i=0;i<600;i++)lookWithStick(c,.5,.5,1/60);
  const tilt=Math.acos(c.getWorldDirection(new T.Vector3()).dot(position.clone().normalize().negate()));
  return {right:right.toArray(),down:down.toArray(),screenUp:screenUp.toArray(),positionError:position.distanceTo(c.position),tilt,limit:Math.asin(1/3.8)-.04,finite:c.quaternion.toArray().every(Number.isFinite)};
 });
 expect(result.right[0]).toBeGreaterThan(.01);expect(Math.abs(result.right[1])).toBeLessThan(1e-6);
 expect(result.down[1]).toBeLessThan(-.01);expect(Math.abs(result.down[0])).toBeLessThan(1e-6);
 expect(result.screenUp[0]).toBeCloseTo(0);expect(result.screenUp[1]).toBeCloseTo(1);expect(result.positionError).toBe(0);expect(result.finite).toBe(true);expect(result.tilt).toBeLessThanOrEqual(result.limit+1e-6);
});


test('left stick moves along the ground consistently at overhead and horizon angles',async({page})=>{
 await page.goto('/');const samples=await page.evaluate(async()=>{
  const tp='/node_modules/.vite/deps/three.js',cp='/src/camera.ts';const T=await import(tp),{moveOverGlobe}=await import(cp);
  return [0,1.4].map(tilt=>{
   const c=new T.PerspectiveCamera();c.position.set(0,0,1.01);c.lookAt(0,0,0);c.rotateX(tilt);const target=new T.Vector3();
   const radius=c.position.length(),angle=()=>Math.acos(T.MathUtils.clamp(c.getWorldDirection(new T.Vector3()).dot(c.position.clone().normalize().negate()),-1,1));
   const before=angle();moveOverGlobe(c,target,1,0,1/60);const right=c.position.x;
   moveOverGlobe(c,target,0,-1,1/60);return {right,up:c.position.y,altitudeError:Math.abs(c.position.length()-radius),angleError:Math.abs(angle()-before)};
  });
 });
 for(const s of samples){expect(s.right).toBeGreaterThan(0);expect(s.up).toBeGreaterThan(0);expect(s.altitudeError).toBeLessThan(1e-10);expect(s.angleError).toBeLessThan(1e-6);}
 expect(samples[0].right).toBeCloseTo(samples[1].right,8);expect(samples[0].up).toBeCloseTo(samples[1].up,8);
});


test('ground approach removes sideways bank without moving the camera or changing its aim',async({page})=>{
 await page.goto('/');const samples=await page.evaluate(async()=>{
  const tp='/node_modules/.vite/deps/three.js',cp='/src/camera.ts';const T=await import(tp),{levelSurfaceHorizon,lookWithStick}=await import(cp);
  return [0,Math.PI/2,-Math.PI/2,Math.PI].flatMap(bank=>[20,5,.85,.065].map(altitude=>{
   const c=new T.PerspectiveCamera();c.position.set(0,0,1+altitude/6371);c.lookAt(0,0,0);c.rotateX(1.4);c.rotateZ(bank);
   const before=c.getWorldDirection(new T.Vector3()),position=c.position.clone();levelSurfaceHorizon(c);
   const up=c.position.clone().normalize().applyQuaternion(c.quaternion.clone().invert());
   const directionError=before.distanceTo(c.getWorldDirection(new T.Vector3()));
   for(let i=0;i<90;i++){lookWithStick(c,.5,.2,1/60);levelSurfaceHorizon(c);}
   const after=c.position.clone().normalize().applyQuaternion(c.quaternion.clone().invert());
   return{x:up.x,y:up.y,directionError,positionError:position.distanceTo(c.position),afterX:after.x,afterY:after.y};
  }));
 });
 for(const s of samples){expect(Math.abs(s.x)).toBeLessThan(1e-6);expect(s.y).toBeGreaterThan(0);expect(s.directionError).toBeLessThan(1e-6);expect(s.positionError).toBe(0);expect(Math.abs(s.afterX)).toBeLessThan(1e-6);expect(s.afterY).toBeGreaterThan(0);}
});


test('horizon leveling toggle and controller Y stay synchronized and preserve altitude',async({page})=>{
 await page.addInitScript(()=>{(window as any).pressY=false;Object.defineProperty(navigator,'getGamepads',{value:()=>[{connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},(_,i)=>({pressed:i===3&&(window as any).pressY,value:0}))}]});});
 await page.goto('/');await page.waitForTimeout(1500);const lock=page.getByRole('checkbox',{name:'North-up compass lock'});await lock.check();const altitude=await page.locator('.view-caption').textContent();
 const level=page.getByRole('checkbox',{name:'Keep horizon level Y'});await level.check();await expect(lock).not.toBeChecked();await expect(page.locator('.view-caption')).toHaveText(altitude!);
 await lock.check();await expect(level).not.toBeChecked();await page.locator('canvas').focus();await page.evaluate(()=>{(window as any).pressY=true;});await expect(lock).not.toBeChecked();await expect(level).toBeChecked();await page.waitForTimeout(200);await expect(level).toBeChecked();await page.evaluate(()=>{(window as any).pressY=false;});await page.waitForTimeout(100);await page.evaluate(()=>{(window as any).pressY=true;});await expect(level).not.toBeChecked();await page.evaluate(()=>{(window as any).pressY=false;});await expect(page.locator('.view-caption')).toHaveText(altitude!);
 const result=await page.evaluate(async()=>{const tp='/node_modules/.vite/deps/three.js',cp='/src/camera.ts';const T=await import(tp),{levelSurfaceHorizon}=await import(cp);const c=new T.PerspectiveCamera();c.position.set(0,0,2);c.lookAt(0,0,0);c.rotateX(.2);c.rotateZ(1.2);const before=c.getWorldDirection(new T.Vector3());levelSurfaceHorizon(c,true);const up=c.position.clone().normalize().applyQuaternion(c.quaternion.clone().invert());return{x:up.x,y:up.y,error:before.distanceTo(c.getWorldDirection(new T.Vector3()))};});
 expect(Math.abs(result.x)).toBeLessThan(1e-6);expect(result.y).toBeGreaterThan(0);expect(result.error).toBeLessThan(1e-6);
});


test('atmosphere preserves terrain visibility at 47, 21 and 3.41 km',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const tp='/node_modules/.vite/deps/three.js',wp='/src/weatherShell.ts';const T=await import(tp),{WeatherShell}=await import(wp);
  const renderer=new T.WebGLRenderer({alpha:true,logarithmicDepthBuffer:true});renderer.setClearColor(0,0);renderer.setSize(96,96);
  const target=new T.WebGLRenderTarget(96,96),scene=new T.Scene(),camera=new T.PerspectiveCamera(42,1,.000001,80),shell=new WeatherShell();scene.add(shell.mesh);
  const u=shell.material.uniforms;u.cloudEnabled.value=0;u.rainEnabled.value=0;u.sun.value.set(0,0,1);u.depthEnabled.value=0;u.screenSize.value.set(96,96);
  const depth=new T.WebGLRenderTarget(96,96);depth.depthTexture=new T.DepthTexture(96,96,T.UnsignedIntType);
  const earth=new T.Mesh(new T.SphereGeometry(1,96,64),new T.MeshBasicMaterial({color:0x345c27}));scene.add(earth);
  const samples=[],depthSamples=[];
  for(const altitude of [47,21,3.41]){
   camera.position.set(0,0,1+altitude/6371);camera.lookAt(0,0,0);camera.rotateX(1.25);camera.updateMatrixWorld();u.eye.value.copy(camera.position);
   earth.visible=false;u.depthEnabled.value=0;renderer.setRenderTarget(target);renderer.render(scene,camera);const pixels=new Uint8Array(96*96*4);renderer.readRenderTargetPixels(target,0,0,96,96,pixels);
   samples.push(pixels[(48*96+48)*4+3]/255);
   shell.mesh.visible=false;earth.visible=true;renderer.setRenderTarget(depth);renderer.render(scene,camera);
   earth.visible=false;shell.mesh.visible=true;u.depthEnabled.value=1;u.sceneDepth.value=depth.depthTexture;camera.getWorldDirection(u.cameraForward.value);
   renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,96,96,pixels);depthSamples.push(pixels[(48*96+48)*4+3]/255);
  }
  shell.dispose();target.dispose();depth.dispose();earth.geometry.dispose();earth.material.dispose();renderer.dispose();return {samples,depthSamples};
 });
 expect([...result.samples,...result.depthSamples].every(alpha=>alpha>.01&&alpha<.65),JSON.stringify(result)).toBe(true);
 expect(Math.abs(result.samples[1]-result.samples[0])).toBeLessThan(.2);
});


test('NOAA radar toggle, opacity and forecast pause are explicit',async({page})=>{
 await page.route('**/api/radar',r=>r.fulfill({json:{source:'NOAA fixture',unavailable:[],regions:[{id:'conus',name:'Contiguous U.S.',time:new Date().toISOString(),bounds:[-130,20,-60,55],image:'/radar-fixture.png'}]}}));
 await page.route('**/radar-fixture.png',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/cetH5QAAAABJRU5ErkJggg==','base64')}));
 await page.route('**/api/weather?*',r=>r.fulfill({json:{current:{time:new Date().toISOString().slice(0,16),temperature_2m:20,apparent_temperature:20,weather_code:0,wind_speed_10m:5,wind_direction_10m:0,relative_humidity_2m:50,cloud_cover:0,precipitation:0,rain:0,snowfall:0},hourly:{time:[]},utc_offset_seconds:0}}));
 await page.goto('/');await page.locator('.radar-controls summary').click();await expect(page.locator('.radar-controls')).toContainText('Contiguous U.S.:');
 await page.getByRole('slider',{name:'Radar opacity',exact:true}).fill('35');await expect(page.locator('.radar-controls output')).toHaveText('35%');
 await page.getByRole('switch',{name:/^Precipitation/}).click();await expect(page.locator('.radar-controls')).toHaveCount(0);
 await page.getByRole('switch',{name:/^Precipitation/}).click();await page.locator('.radar-controls summary').click();await expect(page.locator('.radar-controls')).toContainText('Contiguous U.S.:');
 await page.getByRole('slider',{name:'Forecast hour',exact:true}).fill('3');await expect(page.locator('.radar-controls')).toContainText('Observed radar paused');await page.getByRole('slider',{name:'Forecast hour',exact:true}).fill('0');await expect(page.locator('.radar-controls')).toContainText('Contiguous U.S.:');
 await page.getByRole('combobox',{name:'Weather display',exact:true}).selectOption('wind');await expect(page.locator('.radar-controls')).toContainText('Switch to Natural atmosphere');
});

test('radar atlas is geographically aligned and opacity zero removes it',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const tp='/node_modules/.vite/deps/three.js',wp='/src/weatherShell.ts';const T=await import(tp),{WeatherShell,globePoint}=await import(wp);const renderer=new T.WebGLRenderer({alpha:true});renderer.setSize(32,32);const target=new T.WebGLRenderTarget(32,32),scene=new T.Scene(),camera=new T.PerspectiveCamera(42,1,.000001,80),shell=new WeatherShell();scene.add(shell.mesh);
  const canvas=document.createElement('canvas');canvas.width=8;canvas.height=40;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#ff0000';ctx.fillRect(0,0,8,8);
  shell.setRadar(new T.CanvasTexture(canvas),[new T.Vector4(-130,20,-60,55),...Array.from({length:4},()=>new T.Vector4(999,999,1000,1000))]);const u=shell.material.uniforms;u.cloudEnabled.value=0;u.rainEnabled.value=0;u.sun.value.set(0,0,1);
  function sample(lat:number,lon:number,opacity:number){camera.position.copy(globePoint(lat,lon,3.8));camera.lookAt(0,0,0);u.eye.value.copy(camera.position);u.radarOpacity.value=opacity;renderer.setRenderTarget(target);renderer.render(scene,camera);const b=new Uint8Array(32*32*4);renderer.readRenderTargetPixels(target,0,0,32,32,b);return Array.from(b.slice((16*32+16)*4,(16*32+16)*4+4));}
  const inside=sample(37,-95,1),off=sample(37,-95,0),outside=sample(45,10,1);shell.dispose();target.dispose();renderer.dispose();return {inside,off,outside};
 });expect(result.inside[0]).toBeGreaterThan(result.inside[1]+100);expect(result.inside[0]).toBeGreaterThan(result.off[0]+100);expect(result.outside[0]).toBeLessThan(100);
});
