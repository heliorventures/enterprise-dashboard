const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const tally=require('./tally');

function settings(config,base) {
  const value=config.startup;
  if (!value || value.enabled===false) return null;
  if (value.enabled!==true) throw new Error('startup.enabled must be true or false');
  const local=['localhost','127.0.0.1','[::1]'].includes(new URL(config.tallyUrl).hostname);
  if (!local) throw new Error('Automatic startup requires a local tallyUrl; remote Tally must be started on its own server');
  const result={...value};
  for(const key of ['timeoutMs','pollIntervalMs','probeTimeoutMs','minimumCompanies']) {
    if(!Number.isSafeInteger(result[key]) || result[key]<1) throw new Error(`Configure startup.${key} as a positive integer`);
  }
  if(result.timeoutMs>1800000 || result.probeTimeoutMs>result.timeoutMs || result.pollIntervalMs>result.timeoutMs) throw new Error('Invalid startup time limits');
  if(!Array.isArray(result.requiredCompanies) || result.requiredCompanies.some(name=>typeof name!=='string' || !name.trim())) throw new Error('startup.requiredCompanies must be a list of company names');
  function executable(options,label) {
    if(typeof options.executablePath!=='string' || !options.executablePath.trim()) throw new Error(`Configure ${label}.executablePath`);
    if(!Array.isArray(options.arguments) || options.arguments.some(arg=>typeof arg!=='string')) throw new Error(`${label}.arguments must be a string array`);
    const file=path.resolve(base,options.executablePath);
    if(!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label} executable was not found`);
    const directory=options.workingDirectory ? path.resolve(base,options.workingDirectory) : path.dirname(file);
    if(!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error(`${label} workingDirectory was not found`);
    return {...options,executablePath:file,workingDirectory:directory};
  }
  Object.assign(result,executable(result,'startup'));
  const login=result.login || {};
  const hasUsername=typeof login.username==='string' && login.username.length>0;
  const hasPassword=typeof login.password==='string' && login.password.length>0;
  if(hasUsername!==hasPassword || (login.username!=null && typeof login.username!=='string') || (login.password!=null && typeof login.password!=='string')) throw new Error('Configure both startup.login.username and startup.login.password');
  if(hasUsername) {
    if(/[\r\n\0]/.test(login.username+login.password) || login.username.length>1000 || login.password.length>1000) throw new Error('Invalid login credential format');
    result.login={timeoutMs:60000,pollIntervalMs:1000,windowTitle:'',usernameAutomationId:'',passwordAutomationId:'',submitAutomationId:'',submitButtonName:'',...login};
    if(!Number.isSafeInteger(result.login.timeoutMs) || result.login.timeoutMs<1 || result.login.timeoutMs>result.timeoutMs || !Number.isSafeInteger(result.login.pollIntervalMs) || result.login.pollIntervalMs<1) throw new Error('Invalid built-in login time limits');
    for(const key of ['windowTitle','usernameAutomationId','passwordAutomationId','submitAutomationId','submitButtonName']) if(typeof result.login[key]!=='string') throw new Error(`startup.login.${key} must be a string`);
    if(result.loginHelper?.enabled) throw new Error('Choose built-in credentials or an external login helper, not both');
    result.login.enabled=true;
  } else result.login={enabled:false};
  if(result.loginHelper && typeof result.loginHelper.enabled!=='boolean') throw new Error('startup.loginHelper.enabled must be true or false');
  if(result.loginHelper?.enabled===true) {
    result.loginHelper=executable(result.loginHelper,'startup.loginHelper');
    if(!Number.isSafeInteger(result.loginHelper.timeoutMs) || result.loginHelper.timeoutMs<1 || result.loginHelper.timeoutMs>result.timeoutMs) throw new Error('Invalid login helper timeout');
  }
  return result;
}

function processCommand(file,args,{input='',timeoutMs,workingDirectory}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd:workingDirectory,windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
    let output='',finished=false;
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('Configured startup operation timed out'));},timeoutMs);
    child.stdout.on('data',part=>{output+=part;if(output.length>65536){child.kill();finish(new Error('Startup operation returned excessive output'));}});
    // Helper output may contain credentials. Never forward stdout/stderr to logs.
    child.stderr.on('data',()=>{});
    child.on('error',()=>finish(new Error('Unable to execute configured startup operation')));
    child.stdin.on('error',()=>{});
    child.on('close',code=>finish(code===0?null:new Error('Configured startup operation failed'),output));
    child.stdin.end(input);
  });
}
async function launchIfAbsent(options) {
  if(process.platform!=='win32') throw new Error('Automatic Tally startup supports Windows only');
  // Configuration travels on stdin; never interpolate paths or arguments into code.
  const script=String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
$settings=[Console]::In.ReadToEnd() | ConvertFrom-Json
$name=[IO.Path]::GetFileNameWithoutExtension($settings.executablePath)
$matches=@(Get-Process -Name $name -ErrorAction SilentlyContinue)
if ($matches.Count) {
  $exact=@($matches | Where-Object { $_.Path -and $_.Path -eq $settings.executablePath })
  if (-not $exact.Count) { throw 'Existing process could not be matched safely' }
  @{launched=$false} | ConvertTo-Json -Compress
} else {
  $info=New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName=$settings.executablePath
  $info.WorkingDirectory=$settings.workingDirectory
  $info.UseShellExecute=$true
  $info.WindowStyle=if($settings.interactiveLogin){[Diagnostics.ProcessWindowStyle]::Normal}else{[Diagnostics.ProcessWindowStyle]::Hidden}
  $info.Arguments=$settings.commandLine
  $process=[Diagnostics.Process]::Start($info)
  if (-not $process) { throw 'Process was not started' }
  @{launched=$true;processId=$process.Id} | ConvertTo-Json -Compress
}`;
  // Windows CommandLineToArgvW quoting, including quotes and trailing backslashes.
  const quote=arg=>'"'+arg.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';
  const output=await processCommand(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
    ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{timeoutMs:options.probeTimeoutMs,
      input:JSON.stringify({executablePath:options.executablePath,workingDirectory:options.workingDirectory,
        interactiveLogin:options.login?.enabled===true,commandLine:options.arguments.map(quote).join(' ')})});
  const result=JSON.parse(output.trim());
  if(typeof result.launched!=='boolean') throw new Error('Invalid process startup acknowledgement');
  return result;
}
async function enterCredentials(options) {
  if(process.platform!=='win32') throw new Error('Built-in Tally login supports Windows only');
  const script=fs.readFileSync(path.join(__dirname,'login-windows.ps1'),'utf8');
  const output=await processCommand(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
    ['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {input:JSON.stringify(options),timeoutMs:options.login.timeoutMs+2000});
  let result;try{result=JSON.parse(output.trim());}catch{throw new Error('Tally login helper did not return a valid result');}
  if(result.ok===true && result.submitted===true) return;
  const messages={
    controls:'Tally login fields could not be identified; configure their Automation IDs or check accessibility support',
    ambiguous:'Multiple matching Tally login windows or controls were found; configure a unique window title and Automation IDs',
    process:'The configured Tally process is unavailable in this Windows session',
    desktop:'Tally login requires an interactive, unlocked Windows desktop',
    writable:'Tally login fields do not support writable UI Automation values',
    failed:'Windows could not complete Tally credential entry'
  };
  throw new Error(messages[result.code] || messages.failed);
}
async function ensureTally(config,base,log,dependencies={}) {
  const options=settings(config,base);
  if(!options) return;
  const now=dependencies.now || Date.now;
  const sleep=dependencies.sleep || (ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  const discover=dependencies.discover || (async timeout=>{
    const names=[];
    await tally.extract({...config,requestTimeoutMs:timeout},'COMPANY',null,row=>{
      tally.required(row.GUID,200,'company GUID');names.push(tally.required(row.NAME,200,'company name'));
    });
    return names;
  });
  const deadline=now()+options.timeoutMs;
  const probe=async()=>{
    if(now()>=deadline) return false;
    try {
      const names=await discover(Math.max(1,Math.min(options.probeTimeoutMs,deadline-now())));
      return names.length>=options.minimumCompanies && options.requiredCompanies.every(name=>names.includes(name));
    } catch {return false;}
  };
  log({event:'tally_readiness_started'});
  if(await probe()) {log({event:'tally_ready',launched:false});return;}
  if(now()>=deadline) throw new Error('Tally readiness timed out before startup');
  const launch=dependencies.launch || launchIfAbsent;
  const result=await launch({...options,probeTimeoutMs:Math.max(1,Math.min(options.probeTimeoutMs,deadline-now()))});
  log({event:result.launched?'tally_launched':'tally_already_running'});
  if(options.login?.enabled) {
    if(await probe()) {log({event:'tally_ready',launched:result.launched});return;}
    const remaining=deadline-now();
    if(remaining<=2000) throw new Error('Tally readiness timed out before credential entry');
    const authenticate=dependencies.credentialsLogin || enterCredentials;
    await authenticate({executablePath:options.executablePath,processId:result.processId,
      login:{...options.login,timeoutMs:Math.min(options.login.timeoutMs,remaining-2000)}});
    log({event:'tally_credentials_submitted'});
  }
  if(options.loginHelper?.enabled) {
    const remaining=deadline-now();
    if(remaining<=0) throw new Error('Tally readiness timed out before login helper');
    const helper=dependencies.login || (value=>processCommand(value.executablePath,value.arguments,{workingDirectory:value.workingDirectory,timeoutMs:value.timeoutMs}));
    await helper({...options.loginHelper,timeoutMs:Math.min(options.loginHelper.timeoutMs,remaining)});
    log({event:'tally_login_helper_finished'});
  }
  while(now()<deadline) {
    if(await probe()) {log({event:'tally_ready',launched:result.launched});return;}
    await sleep(Math.max(1,Math.min(options.pollIntervalMs,deadline-now())));
  }
  throw new Error('Tally readiness timed out: check the company login, loaded companies and XML server');
}
module.exports={ensureTally,settings};
