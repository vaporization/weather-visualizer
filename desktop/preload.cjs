const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('settings',{read:()=>ipcRenderer.invoke('settings:read'),save:values=>ipcRenderer.invoke('settings:save',values)});
