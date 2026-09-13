const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('financeSync',Object.freeze({
  snapshot:()=>ipcRenderer.invoke('finance:snapshot'),
  check:()=>ipcRenderer.invoke('finance:check'),
  sync:ids=>ipcRenderer.invoke('finance:sync',ids),
  cancel:()=>ipcRenderer.invoke('finance:cancel'),
  exportDiagnostics:()=>ipcRenderer.invoke('finance:export'),
  onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('finance:state',listener);return()=>ipcRenderer.removeListener('finance:state',listener);}
}));
