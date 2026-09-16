// Log transport/structure metadata, never response text, credentials or record
// values. In particular fetch's cause.message and XML parser messages can echo
// sensitive input; expose bounded error codes and positions instead.
function safeText(value,max=2000) {
  return String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"<>]+/gi,'[redacted credentials]')
    .replace(/(["'](?:token|password|secret|authorization|api[_-]?key)["']\s*:\s*)(["'])(.*?)\2/gi,'$1"[redacted]"')
    .replace(/<(token|password|secret|authorization|api[_-]?key)\b[^>]*>[\s\S]*?<\/\1>/gi,'<$1>[redacted]</$1>')
    .replace(/https?:\/\/[^\s<>"']+/gi,value=>{try{return new URL(value).origin;}catch{return '[redacted URL]';}})
    .replace(/\b(token|password|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,'$1=[redacted]')
    .slice(0,max);
}
function codes(error) {
  const found=new Set(),seen=new Set();
  const visit=(value,depth=0)=>{
    if(!value||seen.has(value)||depth>5)return;seen.add(value);
    for(const code of [value.code,value.name]) if(typeof code==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(code)) found.add(code);
    visit(value.cause,depth+1);
    if(Array.isArray(value.errors)) for(const child of value.errors.slice(0,8))visit(child,depth+1);
  };
  visit(error);return [...found];
}
function hint(errorCodes,stage,status) {
  if(errorCodes.includes('XML_INVALID_CHARACTER_REFERENCE'))return 'The response contains a numeric character reference rejected by XML. Use xmlPath and xmlLine/xmlColumn to identify it; do not strip source characters.';
  if(errorCodes.includes('XML_INVALID_CHARACTER'))return 'The response contains a character not allowed by the XML parser. Use the reported XML position to inspect the export encoding/control characters.';
  if(errorCodes.includes('XML_UNDEFINED_ENTITY'))return 'The response contains an undefined XML entity. Check escaping in the source export at the reported XML position.';
  if(errorCodes.includes('XML_TRUNCATED'))return 'The XML ended before its tags were closed. Check whether the export was interrupted or Tally returned an incomplete response.';
  if(errorCodes.includes('ECONNREFUSED'))return 'Open Tally, enable its HTTP/XML server, and check the configured host and port.';
  if(errorCodes.some(c=>['ENOTFOUND','EAI_AGAIN'].includes(c)))return 'Check the Tally hostname and DNS resolution on this Windows server.';
  if(errorCodes.some(c=>['TimeoutError','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(c)))return 'Tally did not finish within the request timeout. Check Tally responsiveness and collection size before increasing requestTimeoutMs.';
  if(errorCodes.some(c=>['ECONNRESET','UND_ERR_SOCKET'].includes(c)))return 'The connection ended during export. Check whether Tally closed, restarted, or a network device interrupted the transfer.';
  if(status===401||status===403)return 'Check permissions and authentication on the configured Tally HTTP endpoint.';
  if(status>=400)return 'The configured endpoint returned an HTTP error. Verify it points to Tally and check server/network logs.';
  if(stage==='decode')return 'The response could not be decoded as UTF-8. Check the reported content type and Tally export encoding.';
  if(stage==='record_handler'||errorCodes.some(c=>['ENOSPC','EACCES','EPERM'].includes(c)))return 'Check free disk space and folder permissions for the task account; the record could not be processed or saved.';
  return 'Use the collection, XML path, line/column and records received to locate the failing export. Check that this collection is available in the loaded company.';
}
function xmlCode(error) {
  const message=String(error?.message||'');
  if(/malformed character entity|invalid character reference/i.test(message))return 'XML_INVALID_CHARACTER_REFERENCE';
  if(/disallowed character/i.test(message))return 'XML_INVALID_CHARACTER';
  if(/undefined entity/i.test(message))return 'XML_UNDEFINED_ENTITY';
  if(/unclosed|unexpected end/i.test(message))return 'XML_TRUNCATED';
  if(/unexpected close tag|unmatched closing tag/i.test(message))return 'XML_TAG_MISMATCH';
  if(/duplicate attribute/i.test(message))return 'XML_DUPLICATE_ATTRIBUTE';
  return 'XML_SYNTAX_ERROR';
}
// saxes 6 keeps the completed entity in a local variable while reporting an
// error. Inspect only a bounded suffix at its cursor; never retain source text.
function xmlReference(parser) {
  const prefix=parser.entity&&parser.entity.length<=12?'&'+parser.entity:'';
  const chunk=typeof parser.chunk==='string'?parser.chunk:'';
  const end=parser.prevI||0;
  const tail=prefix+chunk.slice(Math.max(0,end-16),end);
  const match=tail.match(/&#(?:[0-9]{1,10}|x[0-9a-f]{1,8})$/i);
  return match?{xmlCharacterReference:match[0]+';'}:{};
}
async function exportXml(config,{collection,company,body,createParser,phase='export'}) {
  const log=config.exportLog||(()=>{}),started=Date.now(),requestId=require('node:crypto').randomUUID();
  const context={requestId,phase,collection,company:company||null,endpoint:new URL(config.tallyUrl).origin,
    requestHash:require('node:crypto').createHash('sha256').update(body).digest('hex'),
    ...(config.scope?{from:config.scope.from,to:config.scope.to}:{})};
  let stage='connect',status=null,bytes=0,recordsReceived=0,recordsProcessed=0,xml,contentType,charset;
  const snapshot=()=>({...context,stage,httpStatus:status,bytesReceived:bytes,recordsReceived,recordsProcessed,durationMs:Date.now()-started,contentType,charset,...xml?.diagnostics?.()});
  log({event:'tally_export_started',...context,timeoutMs:config.requestTimeoutMs,requestBytes:Buffer.byteLength(body)});
  const heartbeat=setInterval(()=>log({event:'tally_export_progress',...snapshot()}),10000);
  heartbeat.unref?.();
  try {
    config.signal?.throwIfAborted();
    const response=await fetch(config.tallyUrl,{method:'POST',headers:{'Content-Type':'application/xml; charset=utf-8'},body,
      redirect:'error',signal:config.signal?AbortSignal.any([config.signal,AbortSignal.timeout(config.requestTimeoutMs)]):AbortSignal.timeout(config.requestTimeoutMs)});
    status=response.status;
    const rawType=response.headers?.get('content-type')||'';
    contentType=rawType.match(/^[a-z0-9.+-]+\/[a-z0-9.+-]+/i)?.[0]||'unspecified';
    charset=rawType.match(/charset\s*=\s*["']?([a-z0-9_-]{1,30})/i)?.[1]||'unspecified';
    const length=response.headers?.get('content-length');
    log({event:'tally_export_response',...context,httpStatus:status,contentType,charset,
      contentLength:length&&/^\d{1,12}$/.test(length)?Number(length):null,durationMs:Date.now()-started});
    if(!response.ok){await response.body?.cancel();throw Object.assign(new Error(`Tally HTTP ${status}`),{code:'TALLY_HTTP_ERROR'});}
    xml=createParser(callback=>record=>{
      recordsReceived++;stage='record_handler';callback(record);recordsProcessed++;stage='parse';
    });
    const decoder=new TextDecoder('utf-8',{fatal:true});
    stage='read';
    for await(const part of response.body) {
      config.signal?.throwIfAborted();
      bytes+=part.length;
      if(bytes>2*1024**3)throw Object.assign(new Error('Tally collection exceeds 2 GiB'),{code:'SOURCE_COLLECTION_LIMIT'});
      stage='decode';const text=decoder.decode(part,{stream:true});stage='parse';xml.write(text);stage='read';
    }
    stage='decode';const tail=decoder.decode();stage='parse';xml.write(tail);xml.close();stage='complete';
    log({event:'tally_export_finished',...snapshot()});return bytes;
  } catch(error) {
    const errorCodes=codes(error);
    const diagnostic={...snapshot(),errorCodes,...error.xmlDiagnostic,...(error.tallyMessage?{tallyMessage:safeText(error.tallyMessage)}:{}),action:hint(errorCodes,stage,status)};
    error.exportDiagnostic=diagnostic;
    log({event:'tally_export_failed',...diagnostic});throw error;
  } finally {clearInterval(heartbeat);}
}
module.exports={exportXml,codes,xmlCode,xmlReference,safeText};
