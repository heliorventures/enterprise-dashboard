const {app,BrowserWindow,ipcMain,utilityProcess,dialog,Tray,Menu}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {SyncController}=require('./controller');
const {Scheduler}=require('./scheduler');
async function createDesktop({config,stateDirectory,show=true,tray:useTray=false}) {
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
  const scheduler=new Scheduler({controller,stateDirectory,
    applyLoginItem:useTray&&app.isPackaged?enabled=>app.setLoginItemSettings({openAtLogin:enabled,args:['--hidden']}):()=>{}});
  const authorized=event=>event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame.url===pathToFileURL(page).href;
  const handlers={
    version:()=>version,
    snapshot:()=>controller.snapshot(),check:()=>controller.check(),start:mode=>controller.start(mode),sync:(ids,mode)=>controller.sync(ids,mode),cancel:()=>controller.cancel(),
    saveSchedule:settings=>scheduler.save(settings),resumeSchedule:externalId=>scheduler.resume(externalId),
    export:async()=>{
      const result=await dialog.showSaveDialog(window,{title:'Export diagnostic log',defaultPath:`Finance-Sync-Diagnostics-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'Diagnostic log',extensions:['json']}]});
      if(result.canceled||!result.filePath)return {saved:false};
      fs.writeFileSync(result.filePath,JSON.stringify({...controller.diagnostics(),version},null,2),{mode:0o600});return {saved:true};
    }
  };
  for(const [name,handler]of Object.entries(handlers))ipcMain.handle(`finance:${name}`,async(event,...args)=>{
    if(!authorized(event))return {ok:false,error:'This operation is unavailable.'};
    try {return {ok:true,value:await handler(...args)};}
    catch(error){return {ok:false,error:['sync','start','check','saveSchedule'].includes(name)?error.message:'The operation could not finish. Check again or contact your administrator.'};}
  });
  let closing=false,quitting=!useTray,trayNoticeShown=false,tray=null;
  const open=()=>{if(window.isDestroyed())return;if(window.isMinimized())window.restore();window.show();window.focus();};
  const allowQuit=()=>{quitting=true;};
  if(useTray) {
    app.on('before-quit',allowQuit);window.on('session-end',allowQuit);
    tray=new Tray(path.join(__dirname,'../generated/icon.ico'));
    tray.setToolTip('Helior Finance Sync');
    tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Finance Sync',click:open},{type:'separator'},{label:'Quit Finance Sync',click:()=>{quitting=true;open();window.close();}}]));
    tray.on('click',open);
  }
  window.on('close',event=>{
    if(!quitting) {
      event.preventDefault();window.hide();
      if(!trayNoticeShown){trayNoticeShown=true;tray.displayBalloon({title:'Helior Finance Sync is still running',content:'Automatic sync continues in the background. Use the tray icon to open or quit.'});}
      return;
    }
    if(controller.worker){event.preventDefault();if(closing||controller.phase==='stopping')return;
      dialog.showMessageBox(window,{type:'question',title:'Stop synchronization?',message:'A sync is running. Stop and close?',detail:'Completed captures will be kept for retry. An upload may already have reached the server.',buttons:['Keep syncing','Stop and close'],defaultId:0,cancelId:0}).then(({response})=>{
        if(response===1){closing=true;const closeAfter=()=>{if(!controller.worker){controller.off('state',closeAfter);window.close();}};controller.on('state',closeAfter);controller.cancel();}
        else if(useTray)quitting=false;
      });
    }
  });
  window.on('closed',()=>{scheduler.stop();tray?.destroy();app.off('before-quit',allowQuit);controller.cancel();for(const name of Object.keys(handlers))ipcMain.removeHandler(`finance:${name}`);});
  await window.loadFile(page);
  if(show)window.show();
  scheduler.start();
  return {window,controller,scheduler};
}
module.exports={createDesktop};
