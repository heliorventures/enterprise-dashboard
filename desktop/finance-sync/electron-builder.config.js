const fs=require('node:fs');
const path=require('node:path');
const {version}=require('./package.json');
// Preparation runs before packaging; test releases follow the current version too.
const testBuild=JSON.parse(fs.readFileSync(path.join(__dirname,'generated/build-config.json'),'utf8')).testBuild===true;
module.exports={
  extraMetadata:{version:testBuild?`${version}-test`:version},
  appId:'com.helior.finance.sync',productName:'Helior Finance Sync',
  directories:{output:'release',buildResources:'generated'},
  files:['src/**/*',...require('./scripts/agent-files').map(name=>`generated/agent/${name}`),'generated/brand-mark.svg','generated/icon.ico','generated/build-config.json','package.json'],
  asar:true,
  win:{target:[{target:'nsis',arch:['x64']}],icon:'generated/icon.ico',requestedExecutionLevel:'asInvoker',signExecutable:false},
  nsis:{oneClick:true,perMachine:false,allowElevation:false,createDesktopShortcut:true,createStartMenuShortcut:true,
    shortcutName:'Helior Finance Sync',deleteAppDataOnUninstall:false,runAfterFinish:false,
    installerIcon:'generated/icon.ico',uninstallerIcon:'generated/icon.ico',include:'installer.nsh'},
  artifactName:'Helior-Finance-Sync-${version}-Setup.${ext}',
  publish:null
};
