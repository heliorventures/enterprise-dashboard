const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ensureTally,settings}=require('../startup');
const config=()=>({tallyUrl:'http://localhost:9000',startup:{enabled:true,executablePath:process.execPath,
  arguments:[],workingDirectory:'',timeoutMs:20,pollIntervalMs:2,probeTimeoutMs:5,minimumCompanies:1,requiredCompanies:['Expected'],loginHelper:{enabled:false}}});
test('ready Tally is reused; unavailable Tally starts once and waits for configured companies',async()=>{
  let launches=0,probes=0;
  await ensureTally(config(),__dirname,()=>{},{discover:async()=>['Expected'],launch:async()=>{launches++;}});
  assert.equal(launches,0);
  let clock=0;
  await ensureTally(config(),__dirname,()=>{},{now:()=>clock,sleep:async ms=>{clock+=ms;},
    discover:async()=>++probes<3?['Other']:['Expected'],launch:async()=>{launches++;return {launched:true};}});
  assert.equal(launches,1);assert.equal(probes,3);
});
test('existing but locked Tally is not relaunched and timeout prevents sync',async()=>{
  let clock=0,launches=0;
  await assert.rejects(()=>ensureTally(config(),__dirname,()=>{},{now:()=>clock,sleep:async ms=>{clock+=ms;},
    discover:async()=>[],launch:async()=>{launches++;return {launched:false};}}),/timed out/);
  assert.equal(launches,1);
});
test('Windows process check round-trips configuration and reuses this running Node executable',{
  skip:process.platform!=='win32'
},async()=>{
  const input=config();input.startup.timeoutMs=30000;input.startup.probeTimeoutMs=15000;
  let probes=0;const events=[];
  await ensureTally(input,__dirname,event=>events.push(event),{discover:async()=>++probes===1?[]:['Expected']});
  assert.ok(events.some(event=>event.event==='tally_already_running'));
  assert.ok(!events.some(event=>event.event==='tally_launched'));
});
test('startup is opt-in, rejects remote launch and invokes only a configured login helper',async()=>{
  await ensureTally({},__dirname,()=>{throw new Error('disabled startup ran');});
  await assert.rejects(()=>ensureTally({...config(),tallyUrl:'http://192.0.2.1:9000'},__dirname,()=>{}),/local tallyUrl/);
  const input=config();input.startup.loginHelper={enabled:true,executablePath:process.execPath,arguments:[],timeoutMs:5};
  let authenticated=false;
  await ensureTally(input,__dirname,()=>{},{discover:async()=>authenticated?['Expected']:[],
    launch:async()=>({launched:false}),login:async()=>{authenticated=true;}});
  assert.equal(authenticated,true);
});
test('config credentials trigger built-in login and XML readiness still gates synchronization',async()=>{
  const input=config();input.startup.timeoutMs=10000;
  input.startup.login={username:'fixture-user',password:'test+$ecret{value}',timeoutMs:1000};
  let submitted=false,clock=0;const events=[];
  await ensureTally(input,__dirname,event=>events.push(event),{now:()=>clock,sleep:async ms=>{clock+=ms;},
    discover:async()=>submitted?['Expected']:[],launch:async()=>({launched:true,processId:123}),
    credentialsLogin:async value=>{assert.equal(value.login.password,'test+$ecret{value}');assert.equal(value.processId,123);submitted=true;}});
  assert.ok(events.some(event=>event.event==='tally_credentials_submitted'));
  assert.ok(events.some(event=>event.event==='tally_ready'));
  assert.ok(!JSON.stringify(events).includes('test+$ecret'));
  submitted=false;clock=0;
  await assert.rejects(()=>ensureTally(input,__dirname,()=>{},{now:()=>clock,sleep:async ms=>{clock+=ms;},
    discover:async()=>[],launch:async()=>({launched:false}),credentialsLogin:async()=>{submitted=true;}}),/timed out/);
  assert.equal(submitted,true);
});
test('incomplete config credentials and conflicting login modes fail before launch',()=>{
  const input=config();input.startup.timeoutMs=120000;
  input.startup.login={username:'fixture-user',password:''};
  assert.throws(()=>settings(input,__dirname),/both/);
  input.startup.login.password='test-only';input.startup.loginHelper.enabled=true;
  assert.throws(()=>settings(input,__dirname),/Choose/);
});
