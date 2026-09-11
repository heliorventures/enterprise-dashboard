const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {withLock}=require('../launcher');
test('portable launcher excludes overlapping runs and releases the lock',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-lock-test-'));
  const config=path.join(directory,'config.json');
  fs.writeFileSync(config,JSON.stringify({stateDirectory:'state'}));
  try {
    const result=await withLock(config,async()=>{
      assert.equal(await withLock(config,async()=>{throw new Error('Overlapping work ran');}),2);
      return 0;
    });
    assert.equal(result,0);
    assert.equal(await withLock(config,async()=>0),0);
    await assert.rejects(()=>withLock(config,async()=>{throw new Error('simulated failure');}));
    assert.equal(await withLock(config,async()=>0),0);
  } finally {fs.rmSync(directory,{recursive:true});}
});
