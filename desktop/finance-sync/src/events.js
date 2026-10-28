function explainError(error={}) {
  const diagnostic=error.exportDiagnostic||error.diagnostic||{};
  const codes=[error.code,...(diagnostic.errorCodes||[])];
  const message=String(error.message||error.error||'');
  if(codes.includes('SOURCE_STAGING_LIMIT'))return 'Finance upload staging is full. Your completed capture is saved locally; retry after the server has capacity.';
  if(codes.includes('SOURCE_SNAPSHOT_LIMIT')||/Source snapshot exceeds (capture|transfer|configured)/.test(message))return 'This company exceeds the configured sync size limit. Ask your administrator to review Finance server capacity and the reported size budget.';
  if(codes.some(c=>['SOURCE_RECORD_LIMIT','SOURCE_CHUNK_LIMIT','SOURCE_COLLECTION_LIMIT'].includes(c)))return 'This company exceeds the supported export size or record limit. Share the diagnostic log with your administrator.';
  if(codes.includes('ERR_ENCODING_INVALID_ENCODED_DATA'))return 'Tally returned invalid UTF-8 encoding. Share the diagnostic log with your administrator; it identifies the failing byte position.';
  if(codes.includes('BATCH_LEDGER_ID_REQUIRED')||message.includes('BATCH_LEDGER_ID_REQUIRED'))return 'Tally did not return a valid ledger identifier. Share the diagnostic log with your administrator.';
  if(codes.some(code=>typeof code==='string'&&code.startsWith('BATCH_LEDGER_'))||message.includes('BATCH_LEDGER_'))return 'Tally returned an incomplete or changed ledger batch. No complete capture was uploaded. Check Tally and share the diagnostic log.';
  if(message.includes('PERIOD_CAPTURE_STALE'))return 'Finance already has newer data. This old capture is retained for investigation. Click Sync now again to take a fresh capture.';
  if(message.includes('PERIOD_BASELINE_REQUIRED'))return 'Run All data once for this company and resolve any Finance processing errors before using a shorter period.';
  if(message.includes('PERIOD_API_UPGRADE_REQUIRED'))return 'Finance needs a server update before period sync is available. Contact your administrator.';
  if(message.includes('PERIOD_VOUCHER_')||message.includes('BATCH_VOUCHER_'))return 'Tally returned a voucher with a missing identity or a date outside the requested window. Export the diagnostic log for your administrator.';
  if(message.includes('Finance processing was not validated'))return 'Finance processing was not validated. Review Finance sync results before continuing.';
  if(message.includes('Tally changed during'))return 'Tally data changed during extraction. Try again when company data is stable.';
  if(error.code==='NO_COMPANIES'||message.includes('No source companies'))return 'No company is available. Load your companies and complete their login in Tally, then check again.';
  if(message.includes('selected company'))return 'A selected company is no longer available. Load it in Tally, then check again.';
  if(/API .*HTTP (401|403)/.test(message))return 'Upload credentials were rejected. Contact your administrator for an updated Finance Sync installer.';
  if(/API .*HTTP 409/.test(message))return 'The saved upload conflicts with server data. Contact your administrator; the pending capture has been preserved.';
  if(/API .*HTTP (400|413)/.test(message))return 'The server rejected this capture or its size. Contact your administrator; the pending capture has been preserved.';
  if(/API .*HTTP/.test(message))return 'The Finance server could not accept this upload. The capture is saved locally; try again later.';
  if([401,403].includes(diagnostic.httpStatus))return 'Tally denied access. Check the user permissions in Tally, then check again.';
  if(codes.some(c=>['ENOSPC','EACCES','EPERM'].includes(c)))return 'Unable to save sync data. Check available disk space and your Windows folder permissions.';
  if(codes.includes('ECONNREFUSED'))return 'Cannot connect to Tally. Open Tally and check that its HTTP server is enabled.';
  if(codes.some(c=>['TimeoutError','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(c)))return 'Tally did not respond in time. Check that it is ready, then try again.';
  if(codes.some(c=>typeof c==='string'&&/XML|SOURCE_/.test(c)))return 'Tally returned an incomplete or unsupported export. Check Tally and share the diagnostic log with your administrator.';
  if(error.event==='source_upload_failed')return 'The upload could not finish. Check your internet connection and try again. The captured data is saved locally for retry.';
  return 'The operation could not finish. Check Tally and your network, then try again. Share the diagnostic log if this continues.';
}
const TEMPORARY_CODES=new Set(['ECONNRESET','ECONNREFUSED','ECONNABORTED','EPIPE','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','ENOTFOUND','EAI_AGAIN',
  'TimeoutError','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','SOURCE_STAGING_LIMIT',
  'BATCH_LEDGER_IDENTITIES_CHANGED','PERIOD_CAPTURE_STALE']);
const FAILURE_EVENTS=new Set(['source_upload_failed','source_capture_failed','run_failure','tally_export_failed']);
// Temporary failures clear on their own (network, server load, Tally closed or busy); everything else needs attention.
function failureKind(event={}) {
  const diagnostic=event.diagnostic||event,codes=Array.isArray(diagnostic.errorCodes)?diagnostic.errorCodes:[];
  const message=String(event.error||event.message||'');
  if(codes.some(code=>TEMPORARY_CODES.has(code)))return 'temporary';
  if(diagnostic.httpStatus===429||diagnostic.httpStatus>=500)return 'temporary';
  if(event.code==='NO_COMPANIES'||/fetch failed|Tally changed during|selected company is no longer available|No source companies|API [a-z-]+: HTTP (?:429|5\d\d)/i.test(message))return 'temporary';
  return 'data';
}
function publicEvent(event) {
  const result={};
  for(const key of ['event','at','runId','company','companyExternalId','collection','batchId','count','records','bytesReceived','recordsReceived','durationMs','chunkCount','chunksAcknowledged','succeeded','failed','cancelled','coverageStatus','reportingStatus','periodUpdate','consistency','attempt','from','to','batchNumber','batchCount','totalLedgers']) {
    if(['string','number','boolean'].includes(typeof event[key]))result[key]=typeof event[key]==='string'?event[key].slice(0,2000):event[key];
  }
  if(event.error||event.event==='tally_export_failed')result.message=explainError({...event,diagnostic:event.diagnostic||event});
  const d=event.diagnostic||event;
  if(Array.isArray(d.errorCodes))result.errorCodes=d.errorCodes.filter(c=>typeof c==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(c)).slice(0,10);
  for(const key of ['httpStatus','xmlLine','xmlColumn'])if(Number.isFinite(d[key]))result[key]=d[key];
  for(const key of ['actualBytes','limitBytes','invalidByteOffset','invalidByteValue','utf8LeadingByte','utf8SequenceStartOffset','utf8ExpectedContinuationBytes']) {
    if(Number.isSafeInteger(d[key])&&d[key]>=0)result[key]=d[key];
  }
  if(['invalid_leading_byte','invalid_continuation','incomplete_sequence'].includes(d.utf8FailureReason))result.utf8FailureReason=d.utf8FailureReason;
  if(['temporary','data'].includes(event.failureKind))result.failureKind=event.failureKind;
  else if(FAILURE_EVENTS.has(event.event))result.failureKind=failureKind(event);
  return result;
}
module.exports={publicEvent,explainError,failureKind};
