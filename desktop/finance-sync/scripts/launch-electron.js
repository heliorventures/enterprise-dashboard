const {spawn}=require('node:child_process');
const path=require('node:path');
const env={...process.env};
// Editors may run their own Electron as Node. That mode must not reach our GUI.
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child=spawn(require('electron'),process.argv.slice(2),{cwd:path.resolve(__dirname,'..'),env,stdio:'inherit',windowsHide:true});
child.on('error',()=>{console.error('Unable to start Electron. Run npm ci and try again.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
