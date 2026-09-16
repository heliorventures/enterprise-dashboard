const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('desktop check delivers saved diagnostics before sending its terminal message',async()=>{
  let listener;const events=[];
  const modules={
    '../generated/agent/source-agent':{discoverCompanies:async()=>{throw new Error('Discovery failed');}},
    '../generated/agent/launcher':{},
    '../generated/agent/diagnostic-outbox':{diagnosticQueue:()=>({add:()=>events.push('saved'),flush:async()=>{await Promise.resolve();events.push('flushed');}})},
    './events':{explainError:e=>e.message,publicEvent:e=>e},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/worker.js'),'utf8'),{
    require:name=>modules[name]||require(name),AbortController,
    process:{parentPort:{on:(_name,fn)=>{listener=fn;},postMessage:data=>events.push(data.type)},exit:()=>events.push('exit')},
  });
  await listener({data:{type:'check',config:{token:'synthetic'},stateDirectory:'unused'}});
  assert.deepEqual(events,['flushed','saved','flushed','failure']);
});
