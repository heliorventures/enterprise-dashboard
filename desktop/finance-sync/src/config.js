function fromEnvironment(env) {
  const token=env.TALLY_INGEST_TOKEN||'';
  if(token.length<32||token.length>4096||/\s/.test(token))throw new Error('Set TALLY_INGEST_TOKEN to the deployment ingestion token (at least 32 characters, no whitespace).');
  let api,tally;
  try {api=new URL(env.FINANCE_API_URL);tally=new URL(env.TALLY_URL||'http://localhost:9000');}
  catch {throw new Error('Set valid FINANCE_API_URL and TALLY_URL values.');}
  if(api.protocol!=='https:'||api.username||api.password||api.search||api.hash||api.pathname!=='/')throw new Error('FINANCE_API_URL must be an HTTPS origin without credentials or a path.');
  if(!['http:','https:'].includes(tally.protocol)||!['localhost','127.0.0.1','[::1]'].includes(tally.hostname)||tally.username||tally.password||tally.search||tally.hash||tally.pathname!=='/')throw new Error('TALLY_URL must point to the local Tally HTTP server, without credentials or a path.');
  const requestTimeoutMs=Number(env.TALLY_REQUEST_TIMEOUT_MS||300000);
  if(!Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<1000||requestTimeoutMs>1800000)throw new Error('TALLY_REQUEST_TIMEOUT_MS must be between 1000 and 1800000.');
  return {apiUrl:api.origin,tallyUrl:tally.origin,token,requestTimeoutMs,importMode:'source',startup:{enabled:false}};
}
function validatePackaged(value) {
  const config=fromEnvironment({FINANCE_API_URL:value.apiUrl,TALLY_URL:value.tallyUrl,TALLY_INGEST_TOKEN:value.token,TALLY_REQUEST_TIMEOUT_MS:value.requestTimeoutMs});
  return {...config,testBuild:value.testBuild===true};
}
module.exports={fromEnvironment,validatePackaged};
