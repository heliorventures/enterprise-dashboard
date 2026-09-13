const {app,dialog,safeStorage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {validatePackaged}=require('./config');
const {createDesktop}=require('./desktop');
app.setName('Helior Finance Sync');
app.setAppUserModelId('com.helior.finance.sync');
if(!app.requestSingleInstanceLock())app.quit();
else {
  let desktop;
  app.on('second-instance',()=>{if(desktop?.window&&!desktop.window.isDestroyed()){if(desktop.window.isMinimized())desktop.window.restore();desktop.window.show();desktop.window.focus();}});
  app.whenReady().then(async()=>{
    if(process.platform!=='win32')throw new Error('This build is for Windows 10 or 11.');
    const config=validatePackaged(JSON.parse(fs.readFileSync(path.join(__dirname,'../generated/build-config.json'),'utf8')));
    if(!safeStorage.isEncryptionAvailable())throw new Error('Windows credential protection is unavailable.');
    const data=app.getPath('userData');fs.mkdirSync(data,{recursive:true});
    const file=path.join(data,'credential.bin'),fingerprint=createHash('sha256').update(config.apiUrl+'\0'+config.token).digest('hex');
    let stored;
    try {stored=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));}catch {stored=null;}
    // A newly configured installer rotates the local protected credential automatically.
    if(stored?.fingerprint!==fingerprint){stored={fingerprint,token:config.token};fs.writeFileSync(file+'.tmp',safeStorage.encryptString(JSON.stringify(stored)));fs.renameSync(file+'.tmp',file);}
    config.token=stored.token;
    desktop=await createDesktop({config,stateDirectory:path.join(data,config.testBuild?'test-state':'state')});
  }).catch(()=>{dialog.showErrorBox('Finance Sync could not start','The installation configuration or Windows credential storage is unavailable. Ask your administrator to rebuild or reinstall Helior Finance Sync.');app.quit();});
  app.on('window-all-closed',()=>app.quit());
}
