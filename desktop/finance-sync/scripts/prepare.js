const fs=require('node:fs');
const path=require('node:path');
const {parseEnv}=require('node:util');
const {Resvg}=require('@resvg/resvg-js');
const {fromEnvironment}=require('../src/config');
const root=path.resolve(__dirname,'..');
const testBuild=process.argv.includes('--test');
function prepare() {
  let env;
  if(testBuild)env={FINANCE_API_URL:'https://finance-sync-test.invalid',TALLY_INGEST_TOKEN:'TEST-ONLY-NOT-A-REAL-INGESTION-TOKEN-000000',TALLY_URL:'http://localhost:9000'};
  else {
    const file=path.join(root,'.env.local');
    if(!fs.existsSync(file))throw new Error('Copy .env.example to .env.local and supply the deployment token before building.');
    env=parseEnv(fs.readFileSync(file,'utf8'));
  }
  // Validate before touching previous generated files. Do not print the environment.
  const config={...fromEnvironment(env),testBuild};
  const output=path.join(root,'generated'),agent=path.join(output,'agent');
  fs.mkdirSync(agent,{recursive:true});
  const origin=path.resolve(root,'../../deploy/tally-agent');
  for(const name of require('./agent-files'))fs.copyFileSync(path.join(origin,name),path.join(agent,name));
  const svg=fs.readFileSync(path.resolve(root,'../../ui/public/brand-mark.svg'));
  fs.writeFileSync(path.join(output,'brand-mark.svg'),svg);
  const sizes=[16,32,48,64,128,256];
  const images=sizes.map(width=>Buffer.from(new Resvg(svg,{fitTo:{mode:'width',value:width}}).render().asPng()));
  const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
  let offset=header.length;
  for(let i=0;i<sizes.length;i++) {
    const at=6+16*i;header[at]=header[at+1]=sizes[i]%256;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);
    header.writeUInt32LE(images[i].length,at+8);header.writeUInt32LE(offset,at+12);offset+=images[i].length;
  }
  fs.writeFileSync(path.join(output,'icon.ico'),Buffer.concat([header,...images]));
  fs.writeFileSync(path.join(output,'build-config.json'),JSON.stringify(config),{mode:0o600});
  console.log(testBuild?'Prepared TEST build with dummy credentials. Not for customer distribution.':'Prepared configured release resources. Keep the generated installer private.');
}
try {prepare();}catch(error){console.error(error.message);process.exitCode=1;}
