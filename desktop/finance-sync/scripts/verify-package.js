const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const asar=require('@electron/asar');
const root=path.resolve(__dirname,'..'),archive=path.join(root,'release/win-unpacked/resources/app.asar');
const files=asar.listPackage(archive);
const forbidden=files.filter(file=>/(?:^|[\\/])(?:\.env[^\\/]*|token\.txt|state|source-outbox|source-preview|test-artifacts|test|scripts)(?:[\\/]|$)/i.test(file));
assert.deepEqual(forbidden,[],'Developer files, plaintext token files and runtime data must not enter the installer');
for(const file of files.filter(file=>/[\\/]src[\\/].*\.(js|css|html)$/.test(file))) {
  const relative=path.normalize(file.replace(/^[\\/]/,''));
  assert.deepEqual(asar.extractFile(archive,relative),fs.readFileSync(path.join(root,relative)),`Stale application file: ${relative}`);
}
for(const name of require('./agent-files'))assert.deepEqual(asar.extractFile(archive,path.join('generated','agent',name)),fs.readFileSync(path.resolve(root,'../../deploy/tally-agent',name)),`Stale agent file: ${name}`);
const config=JSON.parse(asar.extractFile(archive,path.join('generated','build-config.json')));
require('../src/config').validatePackaged(config);
const ico=asar.extractFile(archive,path.join('generated','icon.ico'));assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),6);
const executable=fs.readFileSync(path.join(root,'release/win-unpacked/Helior Finance Sync.exe'));
assert.equal(executable.readUInt16LE(executable.readUInt32LE(0x3c)+4),0x8664,'Expected a Windows x64 executable');
console.log(`Package verified: ${files.length} entries, current shared agent and UI, six icon sizes, Windows x64, ${config.testBuild?'TEST credentials':'configured release'}. No developer env files or runtime accounting data.`);
