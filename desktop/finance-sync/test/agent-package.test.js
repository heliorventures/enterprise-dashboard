const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('packaged agent allowlist includes every diagnostics dependency without config or credentials',()=>{
  const files=require('../scripts/agent-files');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'finance-agent-package-'));
  const source=path.resolve(__dirname,'../../../deploy/tally-agent');
  try {
    for(const name of files){assert.ok(!/config|token|state/.test(name));fs.copyFileSync(path.join(source,name),path.join(directory,name));}
    for(const name of ['saxes','xmlchars'])fs.cpSync(path.join(source,'node_modules',name),path.join(directory,'node_modules',name),{recursive:true});
    const packaged=require(path.join(directory,'source-agent.js'));
    assert.equal(typeof packaged.run,'function');
    const identity=require(path.join(directory,'diagnostic-outbox.js')).exporterIdentity();
    assert.match(identity.buildHash,/^[a-f0-9]{64}$/);
    assert.deepEqual(identity,require(path.join(source,'diagnostic-outbox.js')).exporterIdentity());
  } finally {fs.rmSync(directory,{recursive:true});}
});
