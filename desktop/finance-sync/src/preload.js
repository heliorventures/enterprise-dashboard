const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('financeSync',Object.freeze({
  version:()=>ipcRenderer.invoke('finance:version'),
  start:mode=>ipcRenderer.invoke('finance:start',mode),
  snapshot:()=>ipcRenderer.invoke('finance:snapshot'),
  check:()=>ipcRenderer.invoke('finance:check'),
  sync:(ids,mode)=>ipcRenderer.invoke('finance:sync',ids,mode),
  cancel:()=>ipcRenderer.invoke('finance:cancel'),
  exportDiagnostics:()=>ipcRenderer.invoke('finance:export'),
  onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('finance:state',listener);return()=>ipcRenderer.removeListener('finance:state',listener);}
}));
