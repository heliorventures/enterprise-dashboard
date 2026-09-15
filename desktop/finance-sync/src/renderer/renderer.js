const $=id=>document.getElementById(id);
let state,selection=new Set(),discoveryVersion=-1;
const date=value=>value?new Date(value).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'No completed sync yet';
function node(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
async function invoke(name,...args){const result=await window.financeSync[name](...args);if(!result.ok)$('message').textContent=result.error;return result;}
function selectionChanged(){
  const count=selection.size;$('selected-count').textContent=`${count} selected`;
  $('select-all').checked=!!state?.companies.length&&count===state.companies.length;
  $('select-all').indeterminate=count>0&&count<state.companies.length;
  $('sync').disabled=state?.testBuild||state?.busy||(state?.phase==='ready'&&count===0);
}
const phases={idle:'Ready to check Tally',checking:'Checking Tally…',ready:'Tally is connected',syncing:'Synchronization in progress',stopping:'Stopping safely…',stopped:'Sync stopped',complete:'Sync complete',attention:'Needs attention',error:'Unable to continue'};
function describe(event) {
  if(!event)return 'Preparing synchronization…';
  const company=event.company?`${event.company} · `:'';
  switch(event.event){
    case 'source_voucher_window_started':return `${company}Reading vouchers: ${event.from} to ${event.to}…`;
    case 'source_voucher_window_finished':return `${company}Vouchers captured: ${event.from} to ${event.to}`;
    case 'tally_request_pause':return 'Pausing briefly before the next Tally request…';
    case 'source_collection_started':return `${company}Reading ${event.collection.toLowerCase()}…`;
    case 'tally_export_progress':return `${company}Reading ${event.collection.toLowerCase()} · ${(event.recordsReceived||0).toLocaleString()} records received`;
    case 'source_collection_finished':return `${company}${event.collection.toLowerCase()} captured · ${(event.count||0).toLocaleString()} records`;
    case 'source_pending_retry':return `${company}Retrying a previously saved capture…`;
    case 'upload_started':return `${company}Uploading saved capture…`;
    case 'upload_progress':return `${company}Uploaded ${event.chunksAcknowledged} of ${event.chunkCount} parts`;
    case 'upload_finalizing':return `${company}Confirming upload and dashboard processing…`;
    case 'retry':return `${company}Connection interrupted. Retrying upload…`;
    case 'source_snapshot_saved':return `${company}Capture saved to Finance`;
    default:return event.message||`${company}Working…`;
  }
}
function resultDescription(row){
  if(row.uploadFailure&&row.status==='attention')return `A capture was uploaded, but another capture failed. ${row.message||'Review the pending uploads with your administrator.'}`;
  if(row.message&&row.status==='failed')return row.message;
  if(row.coverageStatus==='partial'&&!row.periodUpdate)return 'Partial capture saved. Dashboard data was not replaced. Check Tally and sync again.';
  if(row.reportingStatus==='error')return 'Data uploaded; dashboard processing failed. Ask your administrator to review Finance’s sync results.';
  if(row.reportingStatus==='unverified')return 'Data uploaded; dashboard processing could not be verified. Check Finance for the result.';
  if(row.reportingStatus==='validated')return `${(row.records||0).toLocaleString()} records uploaded · Dashboard processing validated`;
  if(row.partial)return 'Some collections could not be captured. This company needs attention.';
  if(row.status==='stopped')return 'Stopped before a complete result. Saved captures remain available for retry.';
  if(row.status==='failed')return 'No complete result was received. Check the connection and retry.';
  return row.status==='working'?'Extracting or transferring data…':'Waiting to start';
}
function render(next){
  state=next;
  if(discoveryVersion!==state.discoveryVersion){discoveryVersion=state.discoveryVersion;selection=new Set(state.companies.map(c=>c.externalId));}
  $('test-banner').hidden=!state.testBuild;$('status-dot').className=`dot ${state.phase}`;
  $('connection-label').textContent=phases[state.phase]||'Finance Sync';$('message').textContent=state.message;
  $('last-sync').textContent=date(state.lastSuccessfulSync);$('pending').textContent=`${state.pending.count} pending${state.pending.held?` · ${state.pending.held} held for review`:''}`;
  const missing=state.pending.companies.filter(p=>!state.companies.some(c=>c.externalId===p.externalId));
  $('pending-note').hidden=!state.pending.count&&!state.pending.damaged;
  $('pending-note').textContent=state.pending.damaged?'A saved upload needs administrator attention. Export a diagnostic log before making changes.':missing.length?'Some saved uploads belong to companies that are not currently available. Load those companies in Tally to retry them.':'Only saved captures matching the selected dates and companies are retried. Other captures remain saved.';
  $('period').disabled=state.busy;
  if(state.busy&&state.scope)$('period-note').textContent=`Replacing voucher dates: ${state.scope.from} to ${state.scope.to}. Other dates and manual Finance entries are preserved.`;
  else $('period-note').textContent='All data replaces Tally-imported history. A shorter period replaces only its vouchers, even on your first sync. Masters are always refreshed. Manual Finance entries are preserved.';
  $('check').disabled=state.busy;$('check').textContent=state.phase==='idle'?'Check connection':'Check again';
  $('stop').hidden=!state.busy;$('stop').disabled=false;$('stop').textContent=state.phase==='stopping'?'Force stop':state.phase==='checking'?'Stop checking':'Stop sync';
  const container=$('companies');
  // Preserve keyboard focus on checkbox changes and progress notifications.
  const signature=JSON.stringify([state.discoveryVersion,state.companies.map(c=>c.externalId)]);
  if(container.dataset.signature!==signature){
    container.dataset.signature=signature;container.replaceChildren();
    if(!state.companies.length)container.append(node('div',state.phase==='checking'?'Looking for your loaded companies…':'Your companies will appear here after checking Tally.','empty'));
    for(const company of state.companies){
      const label=node('label','','company'),input=document.createElement('input');input.type='checkbox';input.value=company.externalId;input.checked=selection.has(company.externalId);
      input.addEventListener('change',()=>{if(input.checked)selection.add(company.externalId);else selection.delete(company.externalId);selectionChanged();});
      label.append(input,node('span',company.name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase(),'initials'),node('span',company.name,'company-name'),node('span','Available in Tally','company-note'));container.append(label);
    }
  }
  for(const checkbox of container.querySelectorAll('input')){checkbox.disabled=state.busy||state.phase!=='ready';checkbox.checked=selection.has(checkbox.value);}
  $('all-row').hidden=!state.companies.length;$('select-all').disabled=state.busy||state.phase!=='ready';selectionChanged();
  $('progress-card').hidden=!state.results.length;$('progress-title').textContent=state.busy?'Sync progress':'Sync results';
  $('activity').textContent=state.busy?describe(state.current):state.message;
  const progress=$('progress');progress.hidden=!state.busy;
  if(state.current?.event==='upload_progress'){progress.max=state.current.chunkCount;progress.value=state.current.chunksAcknowledged;}else progress.removeAttribute('value');
  $('results').replaceChildren();
  for(const result of state.results){
    const row=node('div','','result'),info=document.createElement('div');info.append(node('strong',result.company),node('p',resultDescription(result)));
    const labels={waiting:'Waiting',working:'In progress',complete:'Synced',attention:'Needs attention',failed:'Failed',stopped:'Stopped'};
    row.append(info,node('span',labels[result.status]||result.status,`badge ${result.status}`));$('results').append(row);
  }
  $('history').replaceChildren();
  for(const item of state.history){const names=item.results.map(r=>r.company).join(', ');$('history').append(node('div',`${date(item.at)} · ${phases[item.phase]||item.phase} · ${names}`,'history-row'));}
  $('footer-note').textContent=state.phase==='ready'?`${selection.size} selected · Tally data stays unchanged`:!state.busy&&state.results.length?'Check again to choose companies for your next sync.':'No changes are made to your Tally data.';
}
$('check').addEventListener('click',()=>invoke('check'));
$('sync').addEventListener('click',()=>state?.phase==='ready'?invoke('sync',[...selection],$('period').value):invoke('start',$('period').value));
$('stop').addEventListener('click',()=>invoke('cancel'));
$('select-all').addEventListener('change',event=>{selection=new Set(event.target.checked?state.companies.map(c=>c.externalId):[]);for(const input of $('companies').querySelectorAll('input'))input.checked=selection.has(input.value);selectionChanged();});
$('export').addEventListener('click',async()=>{const result=await invoke('exportDiagnostics');$('export-result').textContent=result.ok&&result.value.saved?'Diagnostic log saved.':'';});
setInterval(()=>{if(state?.startedAt&&state.busy){const seconds=Math.floor((Date.now()-Date.parse(state.startedAt))/1000);$('elapsed').textContent=`${Math.floor(seconds/60)}m ${seconds%60}s elapsed`;}else $('elapsed').textContent='';},1000);
window.financeSync.onState(render);
invoke('version').then(result=>{if(result.ok){$('app-version').textContent=`v${result.value}`;document.title=`Helior Finance Sync v${result.value}`;}});
invoke('snapshot').then(result=>{if(result.ok)render(result.value);});
