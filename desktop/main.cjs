const { app, BrowserWindow, Menu, ipcMain, utilityProcess, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
let backend, mainWindow, settingsWindow;
const configPath = () => path.join(app.getPath('userData'), 'settings.json');
function settings() { try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; } }
function secureWindow(options = {}) { return new BrowserWindow({ width: 1440, height: 1000, backgroundColor: '#09151e', ...options, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, ...options.webPreferences } }); }
function guard(win) {
 win.webContents.setWindowOpenHandler(({url}) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return {action:'deny'}; });
 win.webContents.on('will-navigate', (event,url) => { if (url !== win.webContents.getURL()) { event.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
 win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
}
async function startBackend() {
 if (backend) { backend.removeAllListeners('exit'); backend.kill(); }
 const saved = settings();
 const env = {...process.env, WEATHER_DESKTOP:'1', PORT:'0', FLIGHT_CONTACT:String(saved.flightContact || ''), ESRI_API_KEY:String(saved.esriKey || '')};
 backend = utilityProcess.fork(path.join(__dirname,'../server/index.mjs'), ['--production'], {env});
 return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Local server startup timed out.')),20000);
  backend.once('message', message=>{clearTimeout(timer);resolve(`http://127.0.0.1:${message.port}`);});
  backend.once('exit',code=>{clearTimeout(timer);reject(new Error(`Local server exited (${code}).`));});
 });
}
function openSettings() {
 if(settingsWindow) return settingsWindow.focus();
 settingsWindow=secureWindow({width:580,height:410,resizable:false,webPreferences:{preload:path.join(__dirname,'preload.cjs')}});
 guard(settingsWindow);settingsWindow.loadFile(path.join(__dirname,'settings.html'));
 settingsWindow.on('closed',()=>settingsWindow=null);
}
function openGuide(file) { const w=secureWindow({width:1000,height:800});guard(w);w.loadFile(path.join(__dirname,'../docs',file)); }
ipcMain.handle('settings:read',event=>{if(event.sender!==settingsWindow?.webContents)throw Error('Invalid sender');const s=settings();return {flightContact:s.flightContact||'',esriKey:s.esriKey||''};});
ipcMain.handle('settings:save',async(event,values)=>{
 if(event.sender!==settingsWindow?.webContents)throw Error('Invalid sender');
 if(!values||typeof values!=='object')throw Error('Invalid settings');
 let {flightContact:contact,esriKey}=values;
 if(typeof contact!=='string'||contact.length>200||/[\r\n]/.test(contact))throw Error('Invalid contact');
 contact=contact.trim();
 if(contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) && !/^https:\/\/[^\s]+$/.test(contact))throw Error('Enter an email address or HTTPS project URL.');
 if(typeof esriKey!=='string'||esriKey.length>600)throw Error('Invalid ArcGIS key');
 esriKey=esriKey.trim();
 if(esriKey && !/^[A-Za-z0-9_.-]+$/.test(esriKey))throw Error('An ArcGIS API key is letters, digits, dots, hyphens and underscores only.');
 fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(configPath(),JSON.stringify({flightContact:contact,esriKey},null,2));
 const url=await startBackend();await mainWindow.loadURL(url);return true;
});
app.whenReady().then(async()=>{
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'File',submenu:[{label:'Settings…',click:openSettings},{role:'quit'}]},
  {label:'View',submenu:[{role:'reload'},{role:'togglefullscreen'}]},
  {label:'Help',submenu:[{label:'Feature guide',click:()=>openGuide('USER-GUIDE.html')},{label:'Technical reference',click:()=>openGuide('TECHNICAL.html')}]}
 ]));
 mainWindow=secureWindow();guard(mainWindow);
 try {await mainWindow.loadURL(await startBackend());} catch(e){dialog.showErrorBox('Unable to start',e.message);app.quit();}
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>backend?.kill());
