const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const os=require('node:os');
const {createHash,randomUUID}=require('node:crypto');
const {run}=require('./agent');
async function withLock(configFile,work) {
  const configPath=path.resolve(configFile);
  const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
  const state=path.resolve(path.dirname(configPath),config.stateDirectory || 'state');
  fs.mkdirSync(state,{recursive:true});
  const canonical=fs.realpathSync(state);
  const key=createHash('sha256').update(process.platform==='win32' ? canonical.toLowerCase() : canonical).digest('hex').slice(0,32);
  const address=process.platform==='win32' ? `\\\\.\\pipe\\finance-tally-${key}` : path.join(os.tmpdir(),`finance-tally-${key}.sock`);
  const server=net.createServer(socket=>socket.destroy());
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(address,resolve);});
  } catch(error) {
    if(error.code!=='EADDRINUSE') throw error;
    const logs=path.join(state,'logs');fs.mkdirSync(logs,{recursive:true});
    const at=new Date().toISOString(),runId=randomUUID();
    const message=JSON.stringify({at,runId,event:'run_skipped',reason:'Another run holds this state directory lock'});
    fs.writeFileSync(path.join(logs,`${at.replace(/[:.]/g,'-')}-${runId}.jsonl`),message+'\n',{mode:0o600});
    console.log(message);
    return 2;
  }
  try {return await work();}
  finally {await new Promise(resolve=>server.close(resolve));}
}
if(require.main===module) {
  const args=process.argv.slice(2);
  const configFile=args.find(arg=>!arg.startsWith('--')) || path.join(__dirname,'config.json');
  withLock(configFile,()=>run(configFile,args.includes('--dry-run')))
    .then(code=>{process.exitCode=code;})
    .catch(()=>{console.error('Sender startup failed. Check config.json, folder permissions, and runtime access.');process.exitCode=1;});
}
module.exports={withLock};
