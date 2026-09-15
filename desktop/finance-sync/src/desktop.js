const {BrowserWindow,ipcMain,utilityProcess,dialog}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {SyncController}=require('./controller');
async function createDesktop({config,stateDirectory,show=true}) {
  const version=require('../package.json').version;
  const page=path.join(__dirname,'renderer','index.html');
  const window=new BrowserWindow({width:1020,height:790,minWidth:720,minHeight:600,show:false,title:'Helior Finance Sync',
    icon:path.join(__dirname,'../generated/icon.ico'),backgroundColor:'#f5f7fb',autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webviewTag:false}});
  window.removeMenu();
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  window.webContents.session.setPermissionCheckHandler(()=>false);
  const controller=new SyncController({config,stateDirectory,workerFactory:()=>utilityProcess.fork(path.join(__dirname,'worker.js'),[],{stdio:'ignore',serviceName:'Helior Finance Sync engine'})});
  controller.on('state',state=>{if(!window.isDestroyed())window.webContents.send('finance:state',state);});
  const authorized=event=>event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame.url===pathToFileURL(page).href;
  const handlers={
    version:()=>version,
    snapshot:()=>controller.snapshot(),check:()=>controller.check(),start:mode=>controller.start(mode),sync:(ids,mode)=>controller.sync(ids,mode),cancel:()=>controller.cancel(),
    export:async()=>{
      const result=await dialog.showSaveDialog(window,{title:'Export diagnostic log',defaultPath:`Finance-Sync-Diagnostics-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'Diagnostic log',extensions:['json']}]});
      if(result.canceled||!result.filePath)return {saved:false};
      fs.writeFileSync(result.filePath,JSON.stringify({...controller.diagnostics(),version},null,2),{mode:0o600});return {saved:true};
    }
  };
  for(const [name,handler]of Object.entries(handlers))ipcMain.handle(`finance:${name}`,async(event,...args)=>{
    if(!authorized(event))return {ok:false,error:'This operation is unavailable.'};
    try {return {ok:true,value:await handler(...args)};}
    catch(error){return {ok:false,error:name==='sync'?error.message:'The operation could not finish. Check again or contact your administrator.'};}
  });
  let closing=false;
  window.on('close',event=>{
    if(controller.worker){event.preventDefault();if(closing||controller.phase==='stopping')return;
      dialog.showMessageBox(window,{type:'question',title:'Stop synchronization?',message:'A sync is running. Stop and close?',detail:'Completed captures will be kept for retry. An upload may already have reached the server.',buttons:['Keep syncing','Stop and close'],defaultId:0,cancelId:0}).then(({response})=>{
        if(response===1){closing=true;const closeAfter=()=>{if(!controller.worker){controller.off('state',closeAfter);window.close();}};controller.on('state',closeAfter);controller.cancel();}
      });
    }
  });
  window.on('closed',()=>{controller.cancel();for(const name of Object.keys(handlers))ipcMain.removeHandler(`finance:${name}`);});
  await window.loadFile(page);
  if(show)window.show();
  return {window,controller};
}
module.exports={createDesktop};
